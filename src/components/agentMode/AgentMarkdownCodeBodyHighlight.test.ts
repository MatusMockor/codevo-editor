import { describe, expect, it } from "vitest";
import type { HighlightedLines } from "../../domain/codeHighlight/highlightedCode";
import { stablePrefixLines } from "./AgentMarkdownCodeBodyHighlight";

const RED = { color: "#ff0000", italic: false, bold: false };
const PREVIOUS: HighlightedLines = [
  [
    { text: "const ", ...RED },
    { text: "a", ...RED },
  ],
  [{ text: "let b", ...RED }],
  [{ text: "c", ...RED }],
];

describe("stablePrefixLines", () => {
  it("reuses tokens only for the unchanged leading lines", () => {
    expect(stablePrefixLines(PREVIOUS, "const a\nlet b2\nc")).toEqual([
      PREVIOUS[0],
      [{ text: "let b2", color: null, italic: false, bold: false }],
      [{ text: "c", color: null, italic: false, bold: false }],
    ]);
  });

  it("returns null when the first line changed", () => {
    expect(stablePrefixLines(PREVIOUS, "const x\nlet b\nc")).toBeNull();
  });

  it("appends new lines as plain tokens", () => {
    const lines = stablePrefixLines(PREVIOUS, "const a\nlet b\nc\nd");
    expect(lines?.slice(0, 3)).toEqual(PREVIOUS);
    expect(lines?.[3]).toEqual([{ text: "d", color: null, italic: false, bold: false }]);
  });
});
