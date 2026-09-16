//! Connection settings. These are our own types (not the `serialport` crate's)
//! so the IPC contract with the frontend stays stable and serde-friendly.

use serde::{Deserialize, Serialize};

/// Number of data bits per character.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub enum DataBits {
    Five,
    Six,
    Seven,
    #[default]
    Eight,
}

impl From<DataBits> for u8 {
    fn from(value: DataBits) -> Self {
        match value {
            DataBits::Five => 5,
            DataBits::Six => 6,
            DataBits::Seven => 7,
            DataBits::Eight => 8,
        }
    }
}

impl TryFrom<u8> for DataBits {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            5 => Ok(DataBits::Five),
            6 => Ok(DataBits::Six),
            7 => Ok(DataBits::Seven),
            8 => Ok(DataBits::Eight),
            other => Err(format!(
                "invalid data bits: {other} (expected 5, 6, 7 or 8)"
            )),
        }
    }
}

impl From<DataBits> for serialport::DataBits {
    fn from(value: DataBits) -> Self {
        match value {
            DataBits::Five => serialport::DataBits::Five,
            DataBits::Six => serialport::DataBits::Six,
            DataBits::Seven => serialport::DataBits::Seven,
            DataBits::Eight => serialport::DataBits::Eight,
        }
    }
}

/// Parity checking mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Parity {
    #[default]
    None,
    Odd,
    Even,
}

impl From<Parity> for serialport::Parity {
    fn from(value: Parity) -> Self {
        match value {
            Parity::None => serialport::Parity::None,
            Parity::Odd => serialport::Parity::Odd,
            Parity::Even => serialport::Parity::Even,
        }
    }
}

/// Number of stop bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub enum StopBits {
    #[default]
    One,
    Two,
}

impl From<StopBits> for u8 {
    fn from(value: StopBits) -> Self {
        match value {
            StopBits::One => 1,
            StopBits::Two => 2,
        }
    }
}

impl TryFrom<u8> for StopBits {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(StopBits::One),
            2 => Ok(StopBits::Two),
            other => Err(format!("invalid stop bits: {other} (expected 1 or 2)")),
        }
    }
}

impl From<StopBits> for serialport::StopBits {
    fn from(value: StopBits) -> Self {
        match value {
            StopBits::One => serialport::StopBits::One,
            StopBits::Two => serialport::StopBits::Two,
        }
    }
}

/// Flow control mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowControl {
    #[default]
    None,
    /// XON/XOFF.
    Software,
    /// RTS/CTS.
    Hardware,
}

impl From<FlowControl> for serialport::FlowControl {
    fn from(value: FlowControl) -> Self {
        match value {
            FlowControl::None => serialport::FlowControl::None,
            FlowControl::Software => serialport::FlowControl::Software,
            FlowControl::Hardware => serialport::FlowControl::Hardware,
        }
    }
}

/// Everything needed to open a port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    /// Device path, e.g. `/dev/ttyUSB0`, `/dev/cu.usbserial-1420` or `COM3`.
    pub path: String,
    pub baud_rate: u32,
    #[serde(default)]
    pub data_bits: DataBits,
    #[serde(default)]
    pub parity: Parity,
    #[serde(default)]
    pub stop_bits: StopBits,
    #[serde(default)]
    pub flow_control: FlowControl,
}

impl SerialConfig {
    /// A config with the common `8N1`, no-flow-control defaults.
    pub fn new(path: impl Into<String>, baud_rate: u32) -> Self {
        Self {
            path: path.into(),
            baud_rate,
            data_bits: DataBits::default(),
            parity: Parity::default(),
            stop_bits: StopBits::default(),
            flow_control: FlowControl::default(),
        }
    }

    /// Short human-readable framing summary such as `8N1`.
    pub fn framing(&self) -> String {
        let parity = match self.parity {
            Parity::None => 'N',
            Parity::Odd => 'O',
            Parity::Even => 'E',
        };
        format!(
            "{}{}{}",
            u8::from(self.data_bits),
            parity,
            u8::from(self.stop_bits)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_round_trips_through_json_with_camel_case_keys() {
        let cfg = SerialConfig {
            path: "/dev/ttyUSB0".into(),
            baud_rate: 115_200,
            data_bits: DataBits::Seven,
            parity: Parity::Even,
            stop_bits: StopBits::Two,
            flow_control: FlowControl::Hardware,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(
            json,
            r#"{"path":"/dev/ttyUSB0","baudRate":115200,"dataBits":7,"parity":"even","stopBits":2,"flowControl":"hardware"}"#
        );
        let back: SerialConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn missing_optional_fields_use_8n1_defaults() {
        let cfg: SerialConfig = serde_json::from_str(r#"{"path":"COM3","baudRate":9600}"#).unwrap();
        assert_eq!(cfg, SerialConfig::new("COM3", 9600));
        assert_eq!(cfg.framing(), "8N1");
    }

    #[test]
    fn invalid_data_bits_are_rejected() {
        let err =
            serde_json::from_str::<SerialConfig>(r#"{"path":"COM3","baudRate":9600,"dataBits":9}"#)
                .unwrap_err();
        assert!(err.to_string().contains("invalid data bits"));
    }
}
