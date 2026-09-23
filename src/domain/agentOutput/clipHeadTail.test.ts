import { describe, expect, it } from "vitest";
import { clipHeadTail, headTailOmissionMarker } from "./clipHeadTail";
import { utf8ByteLength } from "./utf8Text";

const MARKER_PATTERN = /\n… (\d+) bytes omitted …\n/u;

describe("clipHeadTail", () => {
  it("returns text within the budget unchanged", () => {
    expect(clipHeadTail("short output", 512)).toEqual({ text: "short output", clipped: false });
  });

  it("keeps the head and the failing tail with an explicit omission marker", () => {
    const output = `${"ok line\n".repeat(400)}FAIL src/a.test.ts: expected 1 to be 2\n`;
    const clipped = clipHeadTail(output, 512);

    expect(clipped.clipped).toBe(true);
    expect(clipped.text.startsWith("ok line\n")).toBe(true);
    expect(clipped.text.endsWith("FAIL src/a.test.ts: expected 1 to be 2\n")).toBe(true);
    expect(utf8ByteLength(clipped.text)).toBeLessThanOrEqual(512);
  });

  it.each([0, 1, 8, 31, 32, 64, 65, 200, 512])(
    "is UTF-8 safe, bounded, and accounts for every omitted byte at %i bytes",
    (limit) => {
      for (const unit of ["a", "é", "€", "𝄞"]) {
        const text = unit.repeat(300);
        const clipped = clipHeadTail(text, limit);
        const bytes = utf8ByteLength(text);

        expect(utf8ByteLength(clipped.text)).toBeLessThanOrEqual(limit);
        expect(clipped.text).not.toContain("�");
        if (bytes <= limit) {
          expect(clipped).toEqual({ text, clipped: false });
          continue;
        }
        expect(clipped.clipped).toBe(true);
        const match = MARKER_PATTERN.exec(clipped.text);
        if (match === null) {
          expect(text.startsWith(clipped.text)).toBe(true);
          continue;
        }
        const head = clipped.text.slice(0, match.index);
        const tail = clipped.text.slice(match.index + match[0].length);
        expect(utf8ByteLength(head) + Number(match[1]) + utf8ByteLength(tail)).toBe(bytes);
        expect(text.startsWith(head)).toBe(true);
        expect(text.endsWith(tail)).toBe(true);
      }
    },
  );

  it("strips NUL bytes and reports them as clipped", () => {
    expect(clipHeadTail("a\0b", 64)).toEqual({ text: "ab", clipped: true });
  });

  it("formats the omission marker like the Rust Codex projection", () => {
    expect(headTailOmissionMarker(42)).toBe("\n… 42 bytes omitted …\n");
  });
});
