import type { LineEnding } from "../types/serial";

const ENDINGS: Record<LineEnding, string> = {
  none: "",
  cr: "\r",
  lf: "\n",
  crlf: "\r\n",
};

export const LINE_ENDING_LABELS: Record<LineEnding, string> = {
  none: "No line ending",
  cr: "CR",
  lf: "LF",
  crlf: "CR+LF",
};

/**
 * Translate terminal input before it goes to the port.
 *
 * xterm.js reports Enter as `\r` and normalizes pasted newlines to `\r` too,
 * so every `\r` in `input` is a line end to be rewritten. Everything else
 * (escape sequences, control characters) passes through untouched. This is
 * the only place line endings are translated; the backend is byte-transparent.
 */
export function applyLineEnding(input: string, mode: LineEnding): string {
  if (mode === "cr") return input;
  return input.replace(/\r/g, ENDINGS[mode]);
}
