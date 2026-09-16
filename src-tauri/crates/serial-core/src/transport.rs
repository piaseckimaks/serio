//! The byte-level abstraction under [`crate::SerialManager`]. Real ports are
//! `Box<dyn serialport::SerialPort>`; tests use an in-memory mock.

use std::io::{self, Read, Write};
use std::time::Duration;

/// A bidirectional byte stream with a read timeout. `read` must return
/// `Err(io::ErrorKind::TimedOut)` when no data arrives within the timeout,
/// like a real serial port does, so the reader thread can poll its stop flag.
pub trait Transport: Read + Write + Send {
    /// A second handle on the same stream, used for the reader thread while
    /// the original stays with the writer.
    fn try_clone_box(&self) -> io::Result<Box<dyn Transport>>;

    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()>;
}

impl Transport for Box<dyn serialport::SerialPort> {
    fn try_clone_box(&self) -> io::Result<Box<dyn Transport>> {
        let cloned = serialport::SerialPort::try_clone(self.as_ref())?;
        Ok(Box::new(cloned))
    }

    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
        serialport::SerialPort::set_timeout(self.as_mut(), timeout)?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod mock {
    use super::Transport;
    use std::collections::VecDeque;
    use std::io::{self, Read, Write};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct Shared {
        /// Bytes the fake device has sent to us, waiting to be read.
        incoming: VecDeque<u8>,
        /// Bytes we wrote to the fake device.
        written: Vec<u8>,
        /// Next read fails with a non-timeout error (simulates an unplug).
        fail_reads: bool,
        /// Reads return `Ok(0)` (simulates the peer closing).
        eof: bool,
    }

    /// In-memory [`Transport`]. Clones share the same buffers, so a test can
    /// keep one handle to drive the "device" side.
    #[derive(Clone)]
    pub struct MockTransport {
        shared: Arc<(Mutex<Shared>, Condvar)>,
        timeout: Duration,
    }

    impl Default for MockTransport {
        fn default() -> Self {
            Self::new()
        }
    }

    impl MockTransport {
        pub fn new() -> Self {
            Self {
                shared: Arc::new((Mutex::new(Shared::default()), Condvar::new())),
                timeout: Duration::from_millis(100),
            }
        }

        fn with_shared<R>(&self, f: impl FnOnce(&mut Shared) -> R) -> R {
            let (lock, cv) = &*self.shared;
            let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            let result = f(&mut guard);
            cv.notify_all();
            result
        }

        /// Make bytes available for the next `read`.
        pub fn push_incoming(&self, bytes: &[u8]) {
            self.with_shared(|s| s.incoming.extend(bytes.iter().copied()));
        }

        /// Everything written through the transport so far.
        pub fn written(&self) -> Vec<u8> {
            self.with_shared(|s| s.written.clone())
        }

        pub fn fail_next_read(&self) {
            self.with_shared(|s| s.fail_reads = true);
        }

        pub fn close_remote(&self) {
            self.with_shared(|s| s.eof = true);
        }
    }

    impl Read for MockTransport {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let (lock, cv) = &*self.shared;
            let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            let deadline = Instant::now() + self.timeout;
            loop {
                if guard.fail_reads {
                    return Err(io::Error::other("simulated device failure"));
                }
                if !guard.incoming.is_empty() {
                    let n = buf.len().min(guard.incoming.len());
                    for (slot, byte) in buf.iter_mut().zip(guard.incoming.drain(..n)) {
                        *slot = byte;
                    }
                    return Ok(n);
                }
                if guard.eof {
                    return Ok(0);
                }
                let now = Instant::now();
                if now >= deadline {
                    return Err(io::Error::new(io::ErrorKind::TimedOut, "read timed out"));
                }
                guard = cv
                    .wait_timeout(guard, deadline - now)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
        }
    }

    impl Write for MockTransport {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.with_shared(|s| s.written.extend_from_slice(buf));
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Transport for MockTransport {
        fn try_clone_box(&self) -> io::Result<Box<dyn Transport>> {
            Ok(Box::new(self.clone()))
        }

        fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
            self.timeout = timeout;
            Ok(())
        }
    }
}
