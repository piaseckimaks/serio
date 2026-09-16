//! End-to-end test over a real pseudo-terminal pair: no hardware needed.
#![cfg(unix)]

use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serialport::{SerialPort, TTYPort};
use serio_serial::{CloseReason, CollectingSink, SerialConfig, SerialEvent, SerialManager};

const WAIT: Duration = Duration::from_secs(3);

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

/// Returns (device side, manager, sink) with the manager attached to the
/// slave end of a fresh pty pair.
fn connect_over_pty() -> (TTYPort, SerialManager, Arc<CollectingSink>) {
    let (mut master, slave) = TTYPort::pair().expect("pty pair");
    master
        .set_timeout(Duration::from_millis(100))
        .expect("master timeout");
    let path = slave.name().unwrap_or_else(|| "pty".to_string());
    let slave: Box<dyn SerialPort> = Box::new(slave);

    let sink = Arc::new(CollectingSink::new());
    let manager = SerialManager::new(sink.clone());
    manager
        .open_with_transport(Box::new(slave), SerialConfig::new(path, 115_200))
        .expect("open over pty");
    (master, manager, sink)
}

fn read_exact_with_deadline(port: &mut TTYPort, len: usize) -> Vec<u8> {
    let mut got = Vec::with_capacity(len);
    let mut buf = [0u8; 256];
    let deadline = Instant::now() + WAIT;
    while got.len() < len && Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(n) => got.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => panic!("device-side read failed: {e}"),
        }
    }
    got
}

#[test]
fn bytes_flow_both_ways_over_a_pty_pair() {
    let (mut master, manager, sink) = connect_over_pty();

    master.write_all(b"hello from the device").unwrap();
    master.flush().unwrap();
    assert!(
        sink.wait_for(WAIT, |ev| received(ev) == b"hello from the device"),
        "received so far: {:?}",
        String::from_utf8_lossy(&received(&sink.events()))
    );

    manager.write(b"hi device").unwrap();
    assert_eq!(read_exact_with_deadline(&mut master, 9), b"hi device");

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

#[cfg(target_os = "linux")]
#[test]
fn losing_the_peer_ends_the_connection_with_an_error() {
    let (master, manager, sink) = connect_over_pty();

    drop(master);
    assert!(sink.wait_for(WAIT, |ev| matches!(
        ev.last(),
        Some(SerialEvent::Closed {
            reason: CloseReason::Error
        })
    )));
    assert!(matches!(
        sink.events().first(),
        Some(SerialEvent::Error { .. })
    ));
    assert!(manager.write(b"x").is_err());

    // Reaping the dead connection must not produce a second Closed.
    assert!(manager.close());
    assert_eq!(closed_count(&sink.events()), 1);
    assert!(manager.status().is_none());
}
