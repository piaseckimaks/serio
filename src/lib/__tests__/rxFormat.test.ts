import { describe, expect, it } from "vitest";
import {
  formatHexLine,
  formatTimestamp,
  HEX_BYTES_PER_LINE,
  RxFormatter,
  timestampPrefix,
} from "../rxFormat";

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (s: string) => enc.encode(s);
const text = (b: Uint8Array) => dec.decode(b);

// A fixed local time; built with local-time setters so the expected string
// does not depend on the machine's timezone.
const at = new Date(2026, 0, 2, 3, 4, 5, 6);
const STAMP = "[03:04:05.006] ";

describe("formatTimestamp", () => {
  it("zero-pads to HH:MM:SS.mmm", () => {
    expect(formatTimestamp(at)).toBe("03:04:05.006");
    expect(timestampPrefix(at)).toBe(STAMP);
  });
});

describe("formatHexLine", () => {
  it("renders a full line with offset, split hex columns and ascii", () => {
    const line = formatHexLine(
      0x10,
      Uint8Array.of(...bytes("Hello world"), 0x0d, 0x0a, 0x00, 0xff, 0x7f),
    );
    expect(line).toBe(
      "00000010  48 65 6c 6c 6f 20 77 6f  72 6c 64 0d 0a 00 ff 7f  |Hello world.....|",
    );
  });

  it("pads short lines so the ascii column stays aligned", () => {
    const full = formatHexLine(0, new Uint8Array(HEX_BYTES_PER_LINE));
    const short = formatHexLine(0, bytes("ab"));
    expect(short).toBe("00000000  61 62                                             |ab|");
    expect(short.indexOf("|")).toBe(full.indexOf("|"));
  });
});

describe("RxFormatter in text mode", () => {
  it("passes bytes through untouched without timestamps", () => {
    const f = new RxFormatter({ mode: "text", timestamps: false });
    const input = bytes("a\r\nb\x1b[31m");
    expect(f.push(input, at)).toBe(input);
    expect(f.flush()).toHaveLength(0);
  });

  it("stamps the start of every line, across chunk boundaries", () => {
    const f = new RxFormatter({ mode: "text", timestamps: true });
    expect(text(f.push(bytes("one\r\ntwo"), at))).toBe(`\r${STAMP}one\r\n\r${STAMP}two`);
    // Continuation of "two": no stamp until the next line.
    expect(text(f.push(bytes(" more\n"), at))).toBe(" more\n");
    expect(text(f.push(bytes("three"), at))).toBe(`\r${STAMP}three`);
  });

  it("does not stamp until a byte actually arrives on the new line", () => {
    const f = new RxFormatter({ mode: "text", timestamps: true });
    expect(text(f.push(bytes("x\n"), at))).toBe(`\r${STAMP}x\n`);
    expect(f.push(new Uint8Array(0), at)).toHaveLength(0);
  });

  it("tracks line starts while timestamps are off so enabling them mid-stream is right", () => {
    const f = new RxFormatter({ mode: "text", timestamps: false });
    f.push(bytes("partial"), at);
    f.setOptions({ mode: "text", timestamps: true });
    expect(text(f.push(bytes(" line\nnext"), at))).toBe(` line\n\r${STAMP}next`);
  });
});

describe("RxFormatter in hex mode", () => {
  it("emits complete lines and keeps the remainder pending", () => {
    const f = new RxFormatter({ mode: "hex", timestamps: false });
    const payload = new Uint8Array(20).map((_, i) => i);
    const out = text(f.push(payload, at));
    expect(out).toBe(
      "00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|\r\n",
    );
    expect(f.hasPending).toBe(true);
    expect(text(f.flush())).toBe(
      "00000010  10 11 12 13                                       |....|\r\n",
    );
    expect(f.hasPending).toBe(false);
    // The offset keeps counting from the true byte position.
    expect(text(f.push(bytes("A"), at))).toBe("");
    expect(text(f.flush())).toMatch(/^00000014  41 /);
  });

  it("assembles a line from several small chunks", () => {
    const f = new RxFormatter({ mode: "hex", timestamps: false });
    let out = "";
    for (let i = 0; i < HEX_BYTES_PER_LINE; i++) out += text(f.push(Uint8Array.of(0x41 + i), at));
    expect(out).toBe(
      "00000000  41 42 43 44 45 46 47 48  49 4a 4b 4c 4d 4e 4f 50  |ABCDEFGHIJKLMNOP|\r\n",
    );
  });

  it("stamps each line with the arrival time of its first byte", () => {
    const f = new RxFormatter({ mode: "hex", timestamps: true });
    const later = new Date(2026, 0, 2, 3, 4, 6, 0);
    f.push(bytes("ab"), at);
    const out = text(f.push(new Uint8Array(14), later));
    expect(out.startsWith(`${STAMP}00000000  61 62 00`)).toBe(true);
    f.push(bytes("z"), later);
    expect(text(f.flush()).startsWith("[03:04:06.000] 00000010  7a")).toBe(true);
  });
});

describe("RxFormatter.setOptions", () => {
  it("resets only when the display mode changes", () => {
    const f = new RxFormatter({ mode: "hex", timestamps: false });
    f.push(bytes("abc"), at);
    expect(f.setOptions({ mode: "hex", timestamps: true })).toBe(false);
    expect(f.hasPending).toBe(true);
    expect(f.setOptions({ mode: "text", timestamps: true })).toBe(true);
    expect(f.hasPending).toBe(false);
    expect(f.mode).toBe("text");
  });
});
