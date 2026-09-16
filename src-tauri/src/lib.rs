//! Tauri glue for serio. All serial logic lives in the `serio-serial` crate;
//! this crate only wires it to commands and events.

mod commands;
mod events;

use std::sync::Arc;

use serio_serial::{SerialManager, SessionLog};
use tauri::Manager;

use events::TauriSink;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The sink records received bytes into the log before forwarding
            // them, so the log sees exactly what the terminal sees.
            let log = Arc::new(SessionLog::new());
            let sink = Arc::new(TauriSink::new(app.handle().clone(), Arc::clone(&log)));
            app.manage(log);
            app.manage(SerialManager::new(sink));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::open_port,
            commands::close_port,
            commands::write_bytes,
            commands::port_status,
            commands::start_log,
            commands::stop_log,
            commands::log_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running serio");
}
