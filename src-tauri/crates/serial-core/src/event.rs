//! Events flowing from the reader thread to whoever is listening (the Tauri
//! layer in the app, a collecting sink in tests).

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Why a connection ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseReason {
    /// `SerialManager::close` was called.
    User,
    /// The reader thread hit a fatal error (device unplugged, EOF, ...).
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SerialEvent {
    /// Bytes received from the device. Batched; one event may hold many reads.
    Data(Vec<u8>),
    /// The connection is gone. Always the last event for a connection.
    Closed { reason: CloseReason },
    /// A fatal reader error. Followed by `Closed { reason: Error }`.
    Error { message: String },
}

/// Receives events from the reader thread. Implementations must be cheap and
/// must never block for long: they run on the reader thread.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: SerialEvent);
}

/// An [`EventSink`] that stores every event. Used by the tests and the
/// `cat` example; handy for any headless consumer.
#[derive(Debug, Default)]
pub struct CollectingSink {
    events: Mutex<Vec<SerialEvent>>,
}

impl CollectingSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot of all events received so far.
    pub fn events(&self) -> Vec<SerialEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// All received bytes, concatenated across `Data` events.
    pub fn data(&self) -> Vec<u8> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SerialEvent::Data(bytes) => Some(bytes),
                _ => None,
            })
            .flatten()
            .collect()
    }

    /// Poll until `pred` holds for the event list or `timeout` elapses.
    pub fn wait_for(&self, timeout: Duration, pred: impl Fn(&[SerialEvent]) -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if pred(&self.events()) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl EventSink for CollectingSink {
    fn emit(&self, event: SerialEvent) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event);
    }
}
