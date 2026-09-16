// Mirrors the serde contract of the `serio-serial` crate (camelCase keys).

export type DataBits = 5 | 6 | 7 | 8;
export type StopBits = 1 | 2;
export type Parity = "none" | "odd" | "even";
export type FlowControl = "none" | "software" | "hardware";

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
  flowControl: FlowControl;
}

export type PortKind = "usb" | "bluetooth" | "pci" | "unknown";

export interface PortInfo {
  path: string;
  kind: PortKind;
  vid: number | null;
  pid: number | null;
  manufacturer: string | null;
  product: string | null;
  serialNumber: string | null;
}

export interface PortStatus {
  config: SerialConfig;
  alive: boolean;
}

export type SerialErrorKind =
  | "notFound"
  | "permissionDenied"
  | "busy"
  | "alreadyOpen"
  | "notOpen"
  | "disconnected"
  | "invalidInput"
  | "io";

export interface SerialError {
  kind: SerialErrorKind;
  message: string;
}

export type CloseReason = "user" | "error";

export interface DataEventPayload {
  /** Base64-encoded bytes. */
  data: string;
}

export interface ClosedEventPayload {
  reason: CloseReason;
}

export interface ErrorEventPayload {
  message: string;
}

/** What is appended in place of Enter before sending. */
export type LineEnding = "none" | "cr" | "lf" | "crlf";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600,
  1000000, 2000000, 3000000,
] as const;

export const DEFAULT_CONFIG: SerialConfig = {
  path: "",
  baudRate: 115200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  flowControl: "none",
};

/** Short framing summary such as `8N1`. */
export function framing(config: SerialConfig): string {
  const parity = { none: "N", odd: "O", even: "E" }[config.parity];
  return `${config.dataBits}${parity}${config.stopBits}`;
}
