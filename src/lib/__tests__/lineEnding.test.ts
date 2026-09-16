import { describe, expect, it } from "vitest";
import { applyLineEnding } from "../lineEnding";

describe("applyLineEnding", () => {
  it("rewrites Enter according to the mode", () => {
    expect(applyLineEnding("\r", "none")).toBe("");
    expect(applyLineEnding("\r", "cr")).toBe("\r");
    expect(applyLineEnding("\r", "lf")).toBe("\n");
    expect(applyLineEnding("\r", "crlf")).toBe("\r\n");
  });

  it("handles pasted multi-line text", () => {
    expect(applyLineEnding("a\rb\r", "lf")).toBe("a\nb\n");
    expect(applyLineEnding("a\rb\r", "crlf")).toBe("a\r\nb\r\n");
  });

  it("passes other input through unchanged", () => {
    const escapes = "\x1b[A\x03hello\t";
    expect(applyLineEnding(escapes, "none")).toBe(escapes);
    expect(applyLineEnding(escapes, "lf")).toBe(escapes);
  });
});
