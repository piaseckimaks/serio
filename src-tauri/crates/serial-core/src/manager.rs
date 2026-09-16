//! Owns the single active connection: opens the port, runs the reader
//! thread, and hands out the writer half.
//!
//! Threading model:
//! - `SerialManager` is `Send + Sync` and lives in Tauri managed state.
//! - The reader thread never locks the manager, so `close()` can join it
//!   without deadlocking.
//! - Reads use a short timeout ([`READ_TIMEOUT`]) so the loop can poll its
//!   stop flag; that timeout is also the worst-case latency of `close()`.
//! - Received bytes are batched ([`FLUSH_INTERVAL`], [`MAX_BATCH`]) so a fast
//!   device produces a few events per frame instead of thousands.

use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::SerialConfig;
use crate::error::SerialError;
use crate::event::{CloseReason, EventSink, SerialEvent};
use crate::transport::Transport;

/// Read timeout used on the port. Bounds `close()` latency.
pub const READ_TIMEOUT: Duration = Duration::from_millis(20);
/// Maximum time received bytes sit in the batch buffer while data keeps flowing.
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(16);
/// Maximum payload of a single `Data` event.
pub const MAX_BATCH: usize = 8 * 1024;
const READ_CHUNK: usize = 4096;

/// What `status()` reports about the current connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    pub config: SerialConfig,
    /// `false` once the reader thread has died (device unplugged) but the
    /// connection has not been reaped with `close()` yet.
    pub alive: bool,
}

struct Connection {
    config: SerialConfig,
    writer: Box<dyn Transport>,
    stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

pub struct SerialManager {
    inner: Mutex<Option<Connection>>,
    sink: Arc<dyn EventSink>,
}

impl SerialManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            inner: Mutex::new(None),
            sink,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<Connection>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_open(&self) -> bool {
        self.lock().is_some()
    }

    pub fn status(&self) -> Option<PortStatus> {
        self.lock().as_ref().map(|conn| PortStatus {
            config: conn.config.clone(),
            alive: !conn.stop.load(Ordering::Acquire),
        })
    }

    /// Open a real serial port with `config` and start reading from it.
    pub fn open(&self, config: SerialConfig) -> Result<(), SerialError> {
        if self.is_open() {
            return Err(SerialError::already_open());
        }
        let port = serialport::new(config.path.as_str(), config.baud_rate)
            .data_bits(config.data_bits.into())
            .parity(config.parity.into())
            .stop_bits(config.stop_bits.into())
            .flow_control(config.flow_control.into())
            .timeout(READ_TIMEOUT)
            .open()?;
        self.open_with_transport(Box::new(port), config)
    }

    /// Start a connection over an already-open transport. This is what
    /// `open` uses; tests call it directly with a pty or a mock.
    pub fn open_with_transport(
        &self,
        mut transport: Box<dyn Transport>,
        config: SerialConfig,
    ) -> Result<(), SerialError> {
        let mut guard = self.lock();
        if guard.is_some() {
            return Err(SerialError::already_open());
        }
        transport.set_timeout(READ_TIMEOUT)?;
        let mut reader = transport.try_clone_box()?;

        let stop = Arc::new(AtomicBool::new(false));
        let reader_stop = Arc::clone(&stop);
        let sink = Arc::clone(&self.sink);
        let handle = thread::Builder::new()
            .name("serio-reader".into())
            .spawn(move || read_loop(reader.as_mut(), &reader_stop, sink.as_ref()))?;

        *guard = Some(Connection {
            config,
            writer: transport,
            stop,
            reader: Some(handle),
        });
        Ok(())
    }

    /// Send bytes to the device.
    pub fn write(&self, bytes: &[u8]) -> Result<(), SerialError> {
        let mut guard = self.lock();
        let conn = guard.as_mut().ok_or_else(SerialError::not_open)?;
        if conn.stop.load(Ordering::Acquire) {
            return Err(SerialError::disconnected());
        }
        conn.writer.write_all(bytes)?;
        conn.writer.flush()?;
        Ok(())
    }

    /// Stop the reader thread and drop the port. Idempotent: returns `false`
    /// when nothing was open. Emits `Closed { reason: User }` unless the
    /// reader already ended the connection on its own.
    pub fn close(&self) -> bool {
        let Some(mut conn) = self.lock().take() else {
            return false;
        };
        // The lock is released here, so the reader can finish in-flight emits.
        let was_alive = !conn.stop.swap(true, Ordering::AcqRel);
        if let Some(handle) = conn.reader.take() {
            let _ = handle.join();
        }
        drop(conn);
        if was_alive {
            self.sink.emit(SerialEvent::Closed {
                reason: CloseReason::User,
            });
        }
        true
    }
}

fn read_loop(reader: &mut dyn Transport, stop: &AtomicBool, sink: &dyn EventSink) {
    let mut chunk = [0u8; READ_CHUNK];
    let mut pending: Vec<u8> = Vec::with_capacity(MAX_BATCH);
    let mut last_flush = Instant::now();

    loop {
        if stop.load(Ordering::Acquire) {
            flush(&mut pending, &mut last_flush, sink);
            return;
        }
        match reader.read(&mut chunk) {
            Ok(0) => {
                flush(&mut pending, &mut last_flush, sink);
                fatal(stop, sink, "the device closed the connection");
                return;
            }
            Ok(n) => {
                if pending.len() + n > MAX_BATCH {
                    flush(&mut pending, &mut last_flush, sink);
                }
                pending.extend_from_slice(&chunk[..n]);
                if pending.len() >= MAX_BATCH || last_flush.elapsed() >= FLUSH_INTERVAL {
                    flush(&mut pending, &mut last_flush, sink);
                }
            }
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) =>
            {
                // Quiet moment: deliver whatever the burst left behind.
                flush(&mut pending, &mut last_flush, sink);
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => {
                flush(&mut pending, &mut last_flush, sink);
                fatal(stop, sink, &e.to_string());
                return;
            }
        }
    }
}

fn flush(pending: &mut Vec<u8>, last_flush: &mut Instant, sink: &dyn EventSink) {
    if !pending.is_empty() {
        let batch = std::mem::replace(pending, Vec::with_capacity(MAX_BATCH));
        sink.emit(SerialEvent::Data(batch));
    }
    *last_flush = Instant::now();
}

/// End the connection from the reader side. If `close()` already claimed the
/// shutdown (the flag was set), stay silent so exactly one `Closed` is emitted.
fn fatal(stop: &AtomicBool, sink: &dyn EventSink, message: &str) {
    if stop.swap(true, Ordering::AcqRel) {
        return;
    }
    sink.emit(SerialEvent::Error {
        message: message.to_string(),
    });
    sink.emit(SerialEvent::Closed {
        reason: CloseReason::Error,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::event::CollectingSink;
    use crate::transport::mock::MockTransport;

    const WAIT: Duration = Duration::from_secs(2);

    fn received(events: &[SerialEvent]) -> Vec<u8> {
        events
            .iter()
            .filter_map(|e| match e {
                SerialEvent::Data(bytes) => Some(bytes.as_slice()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }

    fn closed_count(events: &[SerialEvent]) -> usize {
        events
            .iter()
            .filter(|e| matches!(e, SerialEvent::Closed { .. }))
            .count()
    }

    fn connected() -> (SerialManager, Arc<CollectingSink>, MockTransport) {
        let sink = Arc::new(CollectingSink::new());
        let manager = SerialManager::new(sink.clone());
        let mock = MockTransport::new();
        manager
            .open_with_transport(Box::new(mock.clone()), SerialConfig::new("mock", 115_200))
            .unwrap();
        (manager, sink, mock)
    }

    #[test]
    fn forwards_received_bytes() {
        let (manager, sink, mock) = connected();
        mock.push_incoming(b"hello");
        assert!(sink.wait_for(WAIT, |ev| received(ev) == b"hello"));
        assert!(manager.close());
        let events = sink.events();
        assert_eq!(
            events.last(),
            Some(&SerialEvent::Closed {
                reason: CloseReason::User
            })
        );
        assert_eq!(closed_count(&events), 1);
    }

    #[test]
    fn writes_reach_the_device() {
        let (manager, _sink, mock) = connected();
        manager.write(b"abc").unwrap();
        manager.write(b"def").unwrap();
        assert_eq!(mock.written(), b"abcdef");
        manager.close();
    }

    #[test]
    fn large_bursts_are_split_into_bounded_batches() {
        let (manager, sink, mock) = connected();
        let payload: Vec<u8> = (0..20_000u32).map(|i| i as u8).collect();
        mock.push_incoming(&payload);
        assert!(sink.wait_for(WAIT, |ev| received(ev).len() == payload.len()));
        let events = sink.events();
        assert_eq!(received(&events), payload);
        let sizes: Vec<usize> = events
            .iter()
            .filter_map(|e| match e {
                SerialEvent::Data(b) => Some(b.len()),
                _ => None,
            })
            .collect();
        assert!(sizes.len() > 1, "expected several batches, got {sizes:?}");
        assert!(
            sizes.iter().all(|&n| n <= MAX_BATCH),
            "batch too large: {sizes:?}"
        );
        manager.close();
    }

    #[test]
    fn close_is_prompt_and_idempotent() {
        let (manager, sink, _mock) = connected();
        let started = Instant::now();
        assert!(manager.close());
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "close took {:?}",
            started.elapsed()
        );
        assert_eq!(
            sink.events(),
            vec![SerialEvent::Closed {
                reason: CloseReason::User
            }]
        );
        assert!(manager.status().is_none());
        assert!(!manager.close());
        assert_eq!(sink.events().len(), 1);
    }

    #[test]
    fn read_failure_emits_error_then_closed_and_poisons_writes() {
        let (manager, sink, mock) = connected();
        mock.fail_next_read();
        assert!(sink.wait_for(WAIT, |ev| matches!(
            ev.last(),
            Some(SerialEvent::Closed {
                reason: CloseReason::Error
            })
        )));
        let events = sink.events();
        assert!(matches!(events.first(), Some(SerialEvent::Error { .. })));
        assert_eq!(events.len(), 2);

        let status = manager
            .status()
            .expect("connection still registered until reaped");
        assert!(!status.alive);
        assert_eq!(
            manager.write(b"x").unwrap_err().kind,
            ErrorKind::Disconnected
        );

        assert!(manager.close());
        assert_eq!(
            closed_count(&sink.events()),
            1,
            "close() must not emit a second Closed"
        );
        assert!(manager.status().is_none());
    }

    #[test]
    fn remote_eof_is_treated_as_disconnect() {
        let (manager, sink, mock) = connected();
        mock.push_incoming(b"bye");
        mock.close_remote();
        assert!(sink.wait_for(WAIT, |ev| matches!(
            ev.last(),
            Some(SerialEvent::Closed {
                reason: CloseReason::Error
            })
        )));
        assert_eq!(
            received(&sink.events()),
            b"bye",
            "pending bytes flushed before closing"
        );
        manager.close();
    }

    #[test]
    fn second_open_is_rejected() {
        let (manager, _sink, _mock) = connected();
        let err = manager
            .open_with_transport(
                Box::new(MockTransport::new()),
                SerialConfig::new("other", 9600),
            )
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::AlreadyOpen);
        manager.close();
    }

    #[test]
    fn write_without_connection_fails() {
        let manager = SerialManager::new(Arc::new(CollectingSink::new()));
        assert_eq!(manager.write(b"x").unwrap_err().kind, ErrorKind::NotOpen);
        assert!(!manager.is_open());
    }
}
