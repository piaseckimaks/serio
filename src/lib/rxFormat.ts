// Turns received bytes into what the terminal should display: the raw
// stream ("text"), or a hex dump ("hex"), each optionally prefixed with a
// per-line arrival timestamp. Pure and stateful, so partial lines and the
// running hex offset survive across chunks. Unit-tested.

export type DisplayMode = "text" | "hex";

export interface RxFormatOptions {
  mode: DisplayMode;
  /** Prefix each line with the local time the line's first byte arrived. */
  timestamps: boolean;
}

export const DEFAULT_RX_FORMAT: RxFormatOptions = { mode: "text", timestamps: false };

/** Bytes per hex-dump line. */
export const HEX_BYTES_PER_LINE = 16;

const LF = 0x0a;
const encoder = new TextEncoder();

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/** Local wall-clock time as `HH:MM:SS.mmm`. */
export function formatTimestamp(date: Date): string {
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
}

/** The text inserted before a line when timestamps are on. */
export function timestampPrefix(date: Date): string {
  return `[${formatTimestamp(date)}] `;
}

/**
 * One hex-dump line: `00000010  48 65 6c 6c 6f 20 77 6f  72 6c 64 0d 0a        |Hello world..|`.
 * Short lines (the tail of a burst) are padded so the ASCII column lines up.
 */
export function formatHexLine(offset: number, bytes: ArrayLike<number>): string {
  const hex: string[] = [];
  let ascii = "";
  for (let i = 0; i < HEX_BYTES_PER_LINE; i++) {
    if (i < bytes.length) {
      const b = bytes[i];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
    } else {
      hex.push("  ");
    }
    if (i === HEX_BYTES_PER_LINE / 2 - 1) hex.push("");
  }
  return `${offset.toString(16).padStart(8, "0")}  ${hex.join(" ")}  |${ascii}|`;
}

export class RxFormatter {
  private options: RxFormatOptions;
  /** Text mode: the next byte starts a new line. */
  private atLineStart = true;
  /** Hex mode: bytes seen so far; the offset of the next line. */
  private hexOffset = 0;
  private hexPending: number[] = [];
  private hexPendingStamp = "";

  constructor(options: RxFormatOptions = DEFAULT_RX_FORMAT) {
    this.options = { ...options };
  }

  get mode(): DisplayMode {
    return this.options.mode;
  }

  /**
   * Change options. Switching display mode resets the formatter, since the
   * two views are not continuous with each other. Returns whether a reset
   * happened (the caller should clear the terminal then).
   */
  setOptions(next: RxFormatOptions): boolean {
    const modeChanged = next.mode !== this.options.mode;
    this.options = { ...next };
    if (modeChanged) this.reset();
    return modeChanged;
  }

  /** Forget all state, e.g. when the terminal is cleared. */
  reset(): void {
    this.atLineStart = true;
    this.hexOffset = 0;
    this.hexPending = [];
    this.hexPendingStamp = "";
  }

  /** Whether `flush()` would emit anything (hex mode with a partial line). */
  get hasPending(): boolean {
    return this.hexPending.length > 0;
  }

  /** Format a received chunk. `now` is the arrival time used for timestamps. */
  push(bytes: Uint8Array, now: Date = new Date()): Uint8Array {
    return this.options.mode === "hex" ? this.pushHex(bytes, now) : this.pushText(bytes, now);
  }

  /**
   * Emit the partial hex line, if any, so a short message shows up without
   * waiting for the line to fill. Following bytes start a fresh line at the
   * true offset. No-op in text mode.
   */
  flush(): Uint8Array {
    if (this.hexPending.length === 0) return new Uint8Array(0);
    const line = this.completeHexLine();
    return encoder.encode(line);
  }

  private pushText(bytes: Uint8Array, now: Date): Uint8Array {
    if (!this.options.timestamps) {
      // Still track line starts so turning timestamps on later works.
      if (bytes.length > 0) this.atLineStart = bytes[bytes.length - 1] === LF;
      return bytes;
    }
    // `\r` before the stamp: LF-only output would otherwise leave the stamp
    // hanging at the previous line's end column.
    const prefix = encoder.encode(`\r${timestampPrefix(now)}`);
    const out: number[] = [];
    for (const b of bytes) {
      if (this.atLineStart) {
        for (const p of prefix) out.push(p);
        this.atLineStart = false;
      }
      out.push(b);
      if (b === LF) this.atLineStart = true;
    }
    return Uint8Array.from(out);
  }

  private pushHex(bytes: Uint8Array, now: Date): Uint8Array {
    let text = "";
    for (const b of bytes) {
      if (this.hexPending.length === 0) {
        this.hexPendingStamp = this.options.timestamps ? timestampPrefix(now) : "";
      }
      this.hexPending.push(b);
      if (this.hexPending.length === HEX_BYTES_PER_LINE) text += this.completeHexLine();
    }
    return encoder.encode(text);
  }

  private completeHexLine(): string {
    const line = `${this.hexPendingStamp}${formatHexLine(this.hexOffset, this.hexPending)}\r\n`;
    this.hexOffset += this.hexPending.length;
    this.hexPending = [];
    this.hexPendingStamp = "";
    return line;
  }
}
