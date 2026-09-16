//! IPC commands invoked from the frontend (see `src/lib/tauri.ts`).
//!
//! All commands are `async` so they run off the main thread: `open_port` and
//! `close_port` can block for up to one read timeout. Async commands that
//! borrow `State` must return a `Result`.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serio_serial::{ErrorKind, PortInfo, PortStatus, SerialConfig, SerialError, SerialManager};
use tauri::State;

#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortInfo>, SerialError> {
    serio_serial::list_ports()
}

#[tauri::command]
pub async fn open_port(
    manager: State<'_, SerialManager>,
    config: SerialConfig,
) -> Result<(), SerialError> {
    if config.baud_rate == 0 {
        return Err(SerialError::new(
            ErrorKind::InvalidInput,
            "baud rate must be greater than zero",
        ));
    }
    if config.path.trim().is_empty() {
        return Err(SerialError::new(
            ErrorKind::InvalidInput,
            "no port selected",
        ));
    }
    manager.open(config)
}

#[tauri::command]
pub async fn close_port(manager: State<'_, SerialManager>) -> Result<bool, SerialError> {
    Ok(manager.close())
}

/// `data` is base64-encoded.
#[tauri::command]
pub async fn write_bytes(
    manager: State<'_, SerialManager>,
    data: String,
) -> Result<(), SerialError> {
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| {
        SerialError::new(
            ErrorKind::InvalidInput,
            format!("payload is not base64: {e}"),
        )
    })?;
    manager.write(&bytes)
}

#[tauri::command]
pub async fn port_status(
    manager: State<'_, SerialManager>,
) -> Result<Option<PortStatus>, SerialError> {
    Ok(manager.status())
}
