//! Headless smoke test for the core crate: pipes stdin to a port and the
//! port to stdout.
//!
//! ```text
//! cargo run -p serio-serial --example cat -- /dev/ttyUSB0 115200
//! ```

use std::io::{self, Read, Write};
use std::process;
use std::sync::Arc;

use serio_serial::{EventSink, SerialConfig, SerialEvent, SerialManager};

struct StdoutSink;

impl EventSink for StdoutSink {
    fn emit(&self, event: SerialEvent) {
        match event {
            SerialEvent::Data(bytes) => {
                let mut out = io::stdout().lock();
                let _ = out.write_all(&bytes);
                let _ = out.flush();
            }
            SerialEvent::Error { message } => eprintln!("serial error: {message}"),
            SerialEvent::Closed { reason } => {
                eprintln!("connection closed ({reason:?})");
                process::exit(0);
            }
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: cat <port-path> [baud]");
        process::exit(2);
    };
    let baud: u32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(115_200);

    let manager = SerialManager::new(Arc::new(StdoutSink));
    if let Err(e) = manager.open(SerialConfig::new(&path, baud)) {
        eprintln!("cannot open {path}: {e}");
        process::exit(1);
    }
    eprintln!("connected to {path} @ {baud}; Ctrl-D to quit");

    let mut stdin = io::stdin().lock();
    let mut buf = [0u8; 1024];
    loop {
        match stdin.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Err(e) = manager.write(&buf[..n]) {
                    eprintln!("write failed: {e}");
                    break;
                }
            }
            Err(e) => {
                eprintln!("stdin: {e}");
                break;
            }
        }
    }
    manager.close();
}
