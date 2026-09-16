import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../bytes";

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("matches the standard alphabet with padding", () => {
    expect(toBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
    expect(new TextDecoder().decode(fromBase64("aGVsbG8="))).toBe("hello");
  });

  it("handles payloads larger than one chunk", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) & 0xff);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("handles empty input", () => {
    expect(toBase64(new Uint8Array())).toBe("");
    expect(fromBase64("")).toEqual(new Uint8Array());
  });
});
