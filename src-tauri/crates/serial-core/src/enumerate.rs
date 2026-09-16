//! Port discovery.

use std::collections::HashSet;

use serde::Serialize;
use serialport::{SerialPortInfo, SerialPortType};

use crate::error::SerialError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortKind {
    Usb,
    Bluetooth,
    Pci,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    /// Device path to pass to `SerialConfig::path`.
    pub path: String,
    pub kind: PortKind,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
}

impl PortInfo {
    fn bare(path: String, kind: PortKind) -> Self {
        Self {
            path,
            kind,
            vid: None,
            pid: None,
            manufacturer: None,
            product: None,
            serial_number: None,
        }
    }
}

impl From<SerialPortInfo> for PortInfo {
    fn from(info: SerialPortInfo) -> Self {
        match info.port_type {
            SerialPortType::UsbPort(usb) => Self {
                path: info.port_name,
                kind: PortKind::Usb,
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                manufacturer: usb.manufacturer,
                product: usb.product,
                serial_number: usb.serial_number,
            },
            SerialPortType::BluetoothPort => Self::bare(info.port_name, PortKind::Bluetooth),
            SerialPortType::PciPort => Self::bare(info.port_name, PortKind::Pci),
            SerialPortType::Unknown => Self::bare(info.port_name, PortKind::Unknown),
        }
    }
}

/// Enumerate serial ports, sorted by path.
///
/// Pseudo-terminals (`/dev/pts/N`, socat ptys) are not reported by the OS
/// enumeration; the UI offers a manual path entry for those.
pub fn list_ports() -> Result<Vec<PortInfo>, SerialError> {
    let ports: Vec<PortInfo> = serialport::available_ports()?
        .into_iter()
        .map(PortInfo::from)
        .collect();
    let mut ports = if cfg!(target_os = "macos") {
        prefer_cu(ports)
    } else {
        ports
    };
    ports.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ports)
}

/// macOS exposes every device as both `/dev/tty.X` (dial-in, blocks until
/// carrier) and `/dev/cu.X` (call-out). Keep only the `cu.` one when both
/// are present.
fn prefer_cu(ports: Vec<PortInfo>) -> Vec<PortInfo> {
    let cu_names: HashSet<String> = ports
        .iter()
        .filter_map(|p| p.path.strip_prefix("/dev/cu.").map(str::to_owned))
        .collect();
    ports
        .into_iter()
        .filter(|p| match p.path.strip_prefix("/dev/tty.") {
            Some(name) => !cu_names.contains(name),
            None => true,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(path: &str) -> PortInfo {
        PortInfo::bare(path.to_string(), PortKind::Unknown)
    }

    #[test]
    fn prefer_cu_drops_tty_twins_but_keeps_orphans() {
        let ports = vec![
            port("/dev/tty.usbserial-1"),
            port("/dev/cu.usbserial-1"),
            port("/dev/tty.Bluetooth-Incoming-Port"),
            port("/dev/ttyUSB0"),
        ];
        let kept: Vec<String> = prefer_cu(ports).into_iter().map(|p| p.path).collect();
        assert_eq!(
            kept,
            vec![
                "/dev/cu.usbserial-1",
                "/dev/tty.Bluetooth-Incoming-Port",
                "/dev/ttyUSB0"
            ]
        );
    }

    #[test]
    fn port_info_serializes_camel_case() {
        let json = serde_json::to_string(&port("/dev/ttyUSB0")).unwrap();
        assert_eq!(
            json,
            r#"{"path":"/dev/ttyUSB0","kind":"unknown","vid":null,"pid":null,"manufacturer":null,"product":null,"serialNumber":null}"#
        );
    }
}
