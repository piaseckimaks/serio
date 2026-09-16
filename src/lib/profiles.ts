// Saved connection profiles and "last used" settings, persisted as JSON in a
// key/value store (the webview's localStorage in the app). Pure: the store
// is injected, so this is unit-tested with an in-memory map.

import type { DisplayMode, RxFormatOptions } from "./rxFormat";
import type {
  DataBits,
  FlowControl,
  LineEnding,
  Parity,
  SerialConfig,
  StopBits,
} from "../types/serial";

/** The subset of the Web Storage API we use. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Profile {
  name: string;
  config: SerialConfig;
  lineEnding: LineEnding;
}

/** What is restored on launch. */
export interface LastSettings {
  config: SerialConfig;
  lineEnding: LineEnding;
  format: RxFormatOptions;
}

export const PROFILES_KEY = "serio.profiles.v1";
export const LAST_SETTINGS_KEY = "serio.lastSettings.v1";

const DATA_BITS: readonly number[] = [5, 6, 7, 8];
const STOP_BITS: readonly number[] = [1, 2];
const PARITIES: readonly string[] = ["none", "odd", "even"];
const FLOW_CONTROLS: readonly string[] = ["none", "software", "hardware"];
const LINE_ENDINGS: readonly string[] = ["none", "cr", "lf", "crlf"];
const DISPLAY_MODES: readonly string[] = ["text", "hex"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate untrusted JSON into a `SerialConfig`, or `null`. */
export function parseSerialConfig(value: unknown): SerialConfig | null {
  if (!isRecord(value)) return null;
  const { path, baudRate, dataBits, parity, stopBits, flowControl } = value;
  if (typeof path !== "string") return null;
  if (typeof baudRate !== "number" || !Number.isInteger(baudRate) || baudRate <= 0) return null;
  if (typeof dataBits !== "number" || !DATA_BITS.includes(dataBits)) return null;
  if (typeof parity !== "string" || !PARITIES.includes(parity)) return null;
  if (typeof stopBits !== "number" || !STOP_BITS.includes(stopBits)) return null;
  if (typeof flowControl !== "string" || !FLOW_CONTROLS.includes(flowControl)) return null;
  return {
    path,
    baudRate,
    dataBits: dataBits as DataBits,
    parity: parity as Parity,
    stopBits: stopBits as StopBits,
    flowControl: flowControl as FlowControl,
  };
}

function parseLineEnding(value: unknown): LineEnding | null {
  return typeof value === "string" && LINE_ENDINGS.includes(value) ? (value as LineEnding) : null;
}

function parseFormat(value: unknown): RxFormatOptions | null {
  if (!isRecord(value)) return null;
  const { mode, timestamps } = value;
  if (typeof mode !== "string" || !DISPLAY_MODES.includes(mode)) return null;
  if (typeof timestamps !== "boolean") return null;
  return { mode: mode as DisplayMode, timestamps };
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const config = parseSerialConfig(value.config);
  const lineEnding = parseLineEnding(value.lineEnding);
  if (!name || !config || !lineEnding) return null;
  return { name, config, lineEnding };
}

/**
 * Decode a stored profile list. Malformed entries are dropped rather than
 * failing the whole list; duplicate names keep the first occurrence.
 */
export function parseProfiles(json: string | null): Profile[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const entry of raw) {
    const profile = parseProfile(entry);
    if (profile && !seen.has(profile.name)) {
      seen.add(profile.name);
      profiles.push(profile);
    }
  }
  return sortProfiles(profiles);
}

function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function read(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be unavailable or full; the app keeps working without it.
  }
}

export function loadProfiles(storage: KeyValueStorage): Profile[] {
  return parseProfiles(read(storage, PROFILES_KEY));
}

function storeProfiles(storage: KeyValueStorage, profiles: Profile[]): Profile[] {
  const sorted = sortProfiles(profiles);
  write(storage, PROFILES_KEY, JSON.stringify(sorted));
  return sorted;
}

/** Add or replace (by name) a profile. Returns the new sorted list. */
export function saveProfile(storage: KeyValueStorage, profile: Profile): Profile[] {
  const name = profile.name.trim();
  if (!name) throw new Error("profile name must not be empty");
  const others = loadProfiles(storage).filter((p) => p.name !== name);
  return storeProfiles(storage, [...others, { ...profile, name }]);
}

/** Remove a profile by name. Returns the new list. */
export function removeProfile(storage: KeyValueStorage, name: string): Profile[] {
  return storeProfiles(
    storage,
    loadProfiles(storage).filter((p) => p.name !== name),
  );
}

export function loadLastSettings(storage: KeyValueStorage): LastSettings | null {
  const json = read(storage, LAST_SETTINGS_KEY);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const config = parseSerialConfig(raw.config);
  const lineEnding = parseLineEnding(raw.lineEnding);
  const format = parseFormat(raw.format);
  if (!config || !lineEnding || !format) return null;
  return { config, lineEnding, format };
}

export function saveLastSettings(storage: KeyValueStorage, settings: LastSettings): void {
  write(storage, LAST_SETTINGS_KEY, JSON.stringify(settings));
}

export function sameConfig(a: SerialConfig, b: SerialConfig): boolean {
  return (
    a.path === b.path &&
    a.baudRate === b.baudRate &&
    a.dataBits === b.dataBits &&
    a.parity === b.parity &&
    a.stopBits === b.stopBits &&
    a.flowControl === b.flowControl
  );
}

/** The profile whose settings match exactly, if any. */
export function findMatchingProfile(
  profiles: Profile[],
  config: SerialConfig,
  lineEnding: LineEnding,
): Profile | undefined {
  return profiles.find((p) => p.lineEnding === lineEnding && sameConfig(p.config, config));
}

/** A reasonable default name for a new profile, e.g. `ttyUSB0 115200 8N1`. */
export function suggestProfileName(config: SerialConfig): string {
  const device = config.path.split(/[\\/]/).pop() || config.path || "port";
  const parity = { none: "N", odd: "O", even: "E" }[config.parity];
  return `${device} ${config.baudRate} ${config.dataBits}${parity}${config.stopBits}`;
}
