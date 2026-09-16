//! Session logging: raw received (and optionally sent) bytes appended to a
//! file. Independent of the connection, so a log can span reconnects. This
//! is a plain utility; it does not touch the `SerialEvent` contract.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::error::{ErrorKind, SerialError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogOptions {
    /// File to write. Created or truncated unless `append` is set.
    pub path: PathBuf,
    /// Also record bytes sent to the device, interleaved with received ones.
    #[serde(default)]
    pub include_tx: bool,
    #[serde(default)]
    pub append: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatus {
    pub path: PathBuf,
    pub include_tx: bool,
    /// Bytes written to the file since `start`.
    pub bytes_written: u64,
}

struct Active {
    file: BufWriter<File>,
    options: LogOptions,
    bytes_written: u64,
}

impl Active {
    fn status(&self) -> LogStatus {
        LogStatus {
            path: self.options.path.clone(),
            include_tx: self.options.include_tx,
            bytes_written: self.bytes_written,
        }
    }
}

/// A session log that can be started and stopped at any time. Records are
/// flushed to the OS on every call, so `tail -f` on the file works.
#[derive(Default)]
pub struct SessionLog {
    inner: Mutex<Option<Active>>,
}

impl SessionLog {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Option<Active>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_active(&self) -> bool {
        self.lock().is_some()
    }

    pub fn status(&self) -> Option<LogStatus> {
        self.lock().as_ref().map(Active::status)
    }

    /// Open the log file. Fails if a log is already active.
    pub fn start(&self, options: LogOptions) -> Result<LogStatus, SerialError> {
        let mut guard = self.lock();
        if guard.is_some() {
            return Err(SerialError::new(
                ErrorKind::AlreadyOpen,
                "a session log is already open; stop it first",
            ));
        }
        if options.path.as_os_str().is_empty() {
            return Err(SerialError::new(
                ErrorKind::InvalidInput,
                "no log file chosen",
            ));
        }
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(options.append)
            .truncate(!options.append)
            .open(&options.path)
            .map_err(|e| SerialError::from_io_with_context(e, &options.path))?;
        let active = Active {
            file: BufWriter::new(file),
            options,
            bytes_written: 0,
        };
        let status = active.status();
        *guard = Some(active);
        Ok(status)
    }

    /// Flush and close the log. Returns the final status, or `None` when no
    /// log was active.
    pub fn stop(&self) -> Result<Option<LogStatus>, SerialError> {
        let Some(mut active) = self.lock().take() else {
            return Ok(None);
        };
        let status = active.status();
        active
            .file
            .flush()
            .map_err(|e| SerialError::from_io_with_context(e, &active.options.path))?;
        Ok(Some(status))
    }

    /// Record received bytes. No-op when no log is active. On a write
    /// failure the log is closed and the error returned, so the caller can
    /// surface it once instead of on every batch.
    pub fn record_rx(&self, bytes: &[u8]) -> Result<(), SerialError> {
        self.record(bytes, false)
    }

    /// Record sent bytes; only written when `include_tx` was requested.
    pub fn record_tx(&self, bytes: &[u8]) -> Result<(), SerialError> {
        self.record(bytes, true)
    }

    fn record(&self, bytes: &[u8], is_tx: bool) -> Result<(), SerialError> {
        let mut guard = self.lock();
        let Some(active) = guard.as_mut() else {
            return Ok(());
        };
        if is_tx && !active.options.include_tx {
            return Ok(());
        }
        let result = active
            .file
            .write_all(bytes)
            .and_then(|()| active.file.flush());
        match result {
            Ok(()) => {
                active.bytes_written += bytes.len() as u64;
                Ok(())
            }
            Err(e) => {
                let err = SerialError::from_io_with_context(e, &active.options.path);
                *guard = None;
                Err(err)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_path(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("serio-log-test-{}-{n}-{name}", std::process::id()))
    }

    fn options(path: &Path, include_tx: bool) -> LogOptions {
        LogOptions {
            path: path.to_path_buf(),
            include_tx,
            append: false,
        }
    }

    #[test]
    fn records_rx_and_skips_tx_by_default() {
        let path = temp_path("rx");
        let log = SessionLog::new();
        assert!(!log.is_active());
        assert!(log.record_rx(b"ignored").is_ok(), "inactive log is a no-op");

        let status = log.start(options(&path, false)).unwrap();
        assert_eq!(status.bytes_written, 0);
        log.record_rx(b"hello ").unwrap();
        log.record_tx(b"SENT").unwrap();
        log.record_rx(b"world").unwrap();
        assert_eq!(log.status().unwrap().bytes_written, 11);

        // Flushed on every record: readable before stop.
        assert_eq!(std::fs::read(&path).unwrap(), b"hello world");

        let final_status = log.stop().unwrap().expect("was active");
        assert_eq!(final_status.bytes_written, 11);
        assert!(!log.is_active());
        assert_eq!(log.stop().unwrap(), None);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn includes_tx_when_asked_and_can_append() {
        let path = temp_path("tx");
        let log = SessionLog::new();
        log.start(options(&path, true)).unwrap();
        log.record_rx(b"rx1").unwrap();
        log.record_tx(b"tx1").unwrap();
        log.stop().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"rx1tx1");

        let mut again = options(&path, false);
        again.append = true;
        log.start(again).unwrap();
        log.record_rx(b"rx2").unwrap();
        log.stop().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"rx1tx1rx2");

        // Without append the file is truncated.
        log.start(options(&path, false)).unwrap();
        log.stop().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn second_start_is_rejected_until_stop() {
        let path = temp_path("twice");
        let log = SessionLog::new();
        log.start(options(&path, false)).unwrap();
        let err = log.start(options(&path, false)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::AlreadyOpen);
        assert!(log.is_active());
        log.stop().unwrap();
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn unwritable_path_fails_to_start_with_the_path_in_the_message() {
        let path = temp_path("missing-dir").join("nested").join("x.log");
        let log = SessionLog::new();
        let err = log.start(options(&path, false)).unwrap_err();
        assert!(!log.is_active());
        assert!(
            err.message.contains("x.log"),
            "message should name the file: {}",
            err.message
        );
        let err = log
            .start(LogOptions {
                path: PathBuf::new(),
                include_tx: false,
                append: false,
            })
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }

    #[test]
    fn options_and_status_use_camel_case_json() {
        let opts: LogOptions = serde_json::from_str(r#"{"path":"/tmp/a.log"}"#).unwrap();
        assert_eq!(opts.path, PathBuf::from("/tmp/a.log"));
        assert!(!opts.include_tx);
        assert!(!opts.append);
        let status = LogStatus {
            path: PathBuf::from("/tmp/a.log"),
            include_tx: true,
            bytes_written: 7,
        };
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"path":"/tmp/a.log","includeTx":true,"bytesWritten":7}"#
        );
    }
}
