// Typed wrappers over the Tauri IPC surface defined in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import type { PortInfo, PortStatus, SerialConfig, SerialError } from "../types/serial";
import { toBase64 } from "./bytes";

export const EVENTS = {
  data: "serial:data",
  closed: "serial:closed",
  error: "serial:error",
} as const;

export function listPorts(): Promise<PortInfo[]> {
  return invoke<PortInfo[]>("list_ports");
}

export function openPort(config: SerialConfig): Promise<void> {
  return invoke<void>("open_port", { config });
}

/** Resolves to `true` when a port was actually open. */
export function closePort(): Promise<boolean> {
  return invoke<boolean>("close_port");
}

export function writeBytes(bytes: Uint8Array): Promise<void> {
  return invoke<void>("write_bytes", { data: toBase64(bytes) });
}

export function portStatus(): Promise<PortStatus | null> {
  return invoke<PortStatus | null>("port_status");
}

/** Normalize whatever `invoke` rejected with into a `SerialError`. */
export function toSerialError(err: unknown): SerialError {
  if (typeof err === "object" && err !== null && "kind" in err && "message" in err) {
    return err as SerialError;
  }
  return { kind: "io", message: err instanceof Error ? err.message : String(err) };
}
