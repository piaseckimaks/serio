//! Error type shared with the frontend. It serializes to `{ kind, message }`
//! so the UI can branch on `kind` and show `message` as-is.

use std::io;

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// The device path does not exist.
    NotFound,
    /// The OS refused access (on Linux usually a missing `dialout`/`uucp` group membership).
    PermissionDenied,
    /// Another process holds the port.
    Busy,
    /// `open` was called while a port is already open.
    AlreadyOpen,
    /// An operation needing an open port was called while disconnected.
    NotOpen,
    /// The reader thread hit a fatal error (typically the device was unplugged).
    Disconnected,
    /// A parameter was rejected (bad baud rate, undecodable payload, ...).
    InvalidInput,
    /// Any other I/O failure.
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
#[error("{message}")]
pub struct SerialError {
    pub kind: ErrorKind,
    pub message: String,
}

impl SerialError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn already_open() -> Self {
        Self::new(
            ErrorKind::AlreadyOpen,
            "a port is already open; disconnect first",
        )
    }

    pub fn not_open() -> Self {
        Self::new(ErrorKind::NotOpen, "no port is open")
    }

    pub fn disconnected() -> Self {
        Self::new(
            ErrorKind::Disconnected,
            "the port was disconnected; close and reconnect",
        )
    }

    /// Classify an I/O error and attach a hint where the fix is well known.
    fn from_io_parts(kind: io::ErrorKind, description: &str) -> Self {
        let lower = description.to_ascii_lowercase();
        match kind {
            io::ErrorKind::NotFound => Self::new(ErrorKind::NotFound, description),
            io::ErrorKind::PermissionDenied => Self::new(
                ErrorKind::PermissionDenied,
                format!(
                    "{description} (on Linux, add your user to the `dialout` or `uucp` group and log in again)"
                ),
            ),
            _ if lower.contains("busy") || lower.contains("in use") => Self::new(
                ErrorKind::Busy,
                format!("{description} (another program may have the port open)"),
            ),
            _ => Self::new(ErrorKind::Io, description),
        }
    }
}

impl From<serialport::Error> for SerialError {
    fn from(err: serialport::Error) -> Self {
        match err.kind() {
            serialport::ErrorKind::NoDevice => Self::new(ErrorKind::NotFound, err.description),
            serialport::ErrorKind::InvalidInput => {
                Self::new(ErrorKind::InvalidInput, err.description)
            }
            serialport::ErrorKind::Io(io_kind) => Self::from_io_parts(io_kind, &err.description),
            serialport::ErrorKind::Unknown => {
                Self::from_io_parts(io::ErrorKind::Other, &err.description)
            }
        }
    }
}

impl From<io::Error> for SerialError {
    fn from(err: io::Error) -> Self {
        Self::from_io_parts(err.kind(), &err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_denied_gets_a_hint() {
        let err = SerialError::from(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Permission denied",
        ));
        assert_eq!(err.kind, ErrorKind::PermissionDenied);
        assert!(err.message.contains("dialout"));
    }

    #[test]
    fn busy_is_detected_from_description() {
        let err = SerialError::from(serialport::Error::new(
            serialport::ErrorKind::Io(io::ErrorKind::Other),
            "Device or resource busy",
        ));
        assert_eq!(err.kind, ErrorKind::Busy);
    }

    #[test]
    fn serializes_with_camel_case_kind() {
        let json = serde_json::to_string(&SerialError::not_open()).unwrap();
        assert_eq!(json, r#"{"kind":"notOpen","message":"no port is open"}"#);
    }
}
