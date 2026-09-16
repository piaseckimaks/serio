//! Forwards `SerialEvent`s from the reader thread to the webview as Tauri
//! events. Payload bytes travel as base64: serde_json would otherwise turn a
//! `Vec<u8>` into a JSON array of numbers.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;
use serio_serial::{CloseReason, EventSink, SerialEvent};
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "serial:data";
pub const EVENT_CLOSED: &str = "serial:closed";
pub const EVENT_ERROR: &str = "serial:error";

#[derive(Debug, Clone, Serialize)]
struct DataPayload {
    /// Base64-encoded received bytes.
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct ClosedPayload {
    reason: CloseReason,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorPayload {
    message: String,
}

pub struct TauriSink {
    app: AppHandle,
}

impl TauriSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriSink {
    fn emit(&self, event: SerialEvent) {
        let result = match event {
            SerialEvent::Data(bytes) => self.app.emit(
                EVENT_DATA,
                DataPayload {
                    data: STANDARD.encode(bytes),
                },
            ),
            SerialEvent::Closed { reason } => self.app.emit(EVENT_CLOSED, ClosedPayload { reason }),
            SerialEvent::Error { message } => self.app.emit(EVENT_ERROR, ErrorPayload { message }),
        };
        if let Err(err) = result {
            eprintln!("serio: failed to emit serial event: {err}");
        }
    }
}
