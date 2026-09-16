import { describe, expect, it } from "vitest";
import {
  findMatchingProfile,
  type KeyValueStorage,
  LAST_SETTINGS_KEY,
  loadLastSettings,
  loadProfiles,
  parseProfiles,
  parseSerialConfig,
  type Profile,
  PROFILES_KEY,
  removeProfile,
  saveLastSettings,
  saveProfile,
  suggestProfileName,
} from "../profiles";
import { DEFAULT_CONFIG, type SerialConfig } from "../../types/serial";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const usb: SerialConfig = { ...DEFAULT_CONFIG, path: "/dev/ttyUSB0" };
const profile = (name: string, config = usb): Profile => ({ name, config, lineEnding: "lf" });

describe("parseSerialConfig", () => {
  it("accepts a valid config and rejects bad fields", () => {
    expect(parseSerialConfig(usb)).toEqual(usb);
    expect(parseSerialConfig(null)).toBeNull();
    expect(parseSerialConfig({ ...usb, baudRate: 0 })).toBeNull();
    expect(parseSerialConfig({ ...usb, baudRate: "9600" })).toBeNull();
    expect(parseSerialConfig({ ...usb, dataBits: 9 })).toBeNull();
    expect(parseSerialConfig({ ...usb, parity: "mark" })).toBeNull();
    expect(parseSerialConfig({ ...usb, stopBits: 3 })).toBeNull();
    expect(parseSerialConfig({ ...usb, flowControl: "rts" })).toBeNull();
  });

  it("ignores unknown extra fields", () => {
    expect(parseSerialConfig({ ...usb, future: true })).toEqual(usb);
  });
});

describe("parseProfiles", () => {
  it("returns an empty list for missing or corrupt data", () => {
    expect(parseProfiles(null)).toEqual([]);
    expect(parseProfiles("")).toEqual([]);
    expect(parseProfiles("{not json")).toEqual([]);
    expect(parseProfiles('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries, dedupes names and sorts case-insensitively", () => {
    const stored = JSON.stringify([
      profile("zeta"),
      { name: "", config: usb, lineEnding: "lf" },
      { name: "broken", config: { path: 1 }, lineEnding: "lf" },
      { name: "bad-eol", config: usb, lineEnding: "crlfx" },
      profile("Alpha"),
      { ...profile("alpha"), lineEnding: "cr" },
      profile("beta"),
    ]);
    const names = parseProfiles(stored).map((p) => p.name);
    expect(names).toEqual(["Alpha", "alpha", "beta", "zeta"]);
  });
});

describe("profile store", () => {
  it("saves, overwrites by name, removes and persists as JSON", () => {
    const storage = memoryStorage();
    expect(loadProfiles(storage)).toEqual([]);

    saveProfile(storage, profile("lab"));
    saveProfile(storage, profile("bench"));
    expect(loadProfiles(storage).map((p) => p.name)).toEqual(["bench", "lab"]);

    const updated = saveProfile(storage, { ...profile("lab"), lineEnding: "crlf" });
    expect(updated).toHaveLength(2);
    expect(loadProfiles(storage).find((p) => p.name === "lab")?.lineEnding).toBe("crlf");

    expect(removeProfile(storage, "bench").map((p) => p.name)).toEqual(["lab"]);
    expect(removeProfile(storage, "missing")).toHaveLength(1);
    expect(JSON.parse(storage.map.get(PROFILES_KEY)!)).toHaveLength(1);
  });

  it("trims names and rejects empty ones", () => {
    const storage = memoryStorage();
    expect(saveProfile(storage, profile("  padded  "))[0].name).toBe("padded");
    expect(() => saveProfile(storage, profile("   "))).toThrow();
  });

  it("survives a storage that throws", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadProfiles(broken)).toEqual([]);
    expect(saveProfile(broken, profile("x")).map((p) => p.name)).toEqual(["x"]);
    expect(loadLastSettings(broken)).toBeNull();
    expect(() =>
      saveLastSettings(broken, { config: usb, lineEnding: "lf", format: { mode: "text", timestamps: false } }),
    ).not.toThrow();
  });
});

describe("last settings", () => {
  it("round-trips and validates", () => {
    const storage = memoryStorage();
    expect(loadLastSettings(storage)).toBeNull();
    const settings = { config: usb, lineEnding: "cr" as const, format: { mode: "hex" as const, timestamps: true } };
    saveLastSettings(storage, settings);
    expect(loadLastSettings(storage)).toEqual(settings);

    storage.setItem(LAST_SETTINGS_KEY, JSON.stringify({ ...settings, format: { mode: "octal" } }));
    expect(loadLastSettings(storage)).toBeNull();
    storage.setItem(LAST_SETTINGS_KEY, "garbage");
    expect(loadLastSettings(storage)).toBeNull();
  });
});

describe("helpers", () => {
  it("finds the profile matching the current settings exactly", () => {
    const profiles = [profile("a"), { ...profile("b"), lineEnding: "crlf" as const }];
    expect(findMatchingProfile(profiles, usb, "lf")?.name).toBe("a");
    expect(findMatchingProfile(profiles, usb, "crlf")?.name).toBe("b");
    expect(findMatchingProfile(profiles, { ...usb, baudRate: 9600 }, "lf")).toBeUndefined();
  });

  it("suggests a name from the device and framing", () => {
    expect(suggestProfileName(usb)).toBe("ttyUSB0 115200 8N1");
    expect(suggestProfileName({ ...usb, path: "COM3", parity: "even", stopBits: 2 })).toBe(
      "COM3 115200 8E2",
    );
    expect(suggestProfileName({ ...usb, path: "" })).toBe("port 115200 8N1");
  });
});
