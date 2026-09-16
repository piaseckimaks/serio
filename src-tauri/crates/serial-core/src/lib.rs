//! `serio-serial`: the serial-port core of serio, independent of Tauri.
//!
//! - [`list_ports`] enumerates devices.
//! - [`SerialManager`] owns the one active connection, runs the reader thread
//!   and pushes [`SerialEvent`]s into an [`EventSink`].
//! - [`Transport`] abstracts the byte stream so everything above it can be
//!   tested with a pty pair or an in-memory mock.
//! - [`SessionLog`] appends received (and optionally sent) bytes to a file.

pub mod config;
pub mod enumerate;
pub mod error;
pub mod event;
pub mod log;
pub mod manager;
pub mod transport;

pub use config::{DataBits, FlowControl, Parity, SerialConfig, StopBits};
pub use enumerate::{list_ports, PortInfo, PortKind};
pub use error::{ErrorKind, SerialError};
pub use event::{CloseReason, CollectingSink, EventSink, SerialEvent};
pub use log::{LogOptions, LogStatus, SessionLog};
pub use manager::{PortStatus, SerialManager, FLUSH_INTERVAL, MAX_BATCH, READ_TIMEOUT};
pub use transport::Transport;
