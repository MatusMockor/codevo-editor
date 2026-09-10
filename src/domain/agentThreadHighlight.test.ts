import { describe, expect, it } from "vitest";
import {
  foldCasePreservingLength,
  highlightOccurrences,
  highlightRanges,
} from "./agentThreadHighlight";

describe("highlightRanges", () => {
  it("finds every case-insensitive occurrence in source order", () => {
    expect(highlightRanges("Parser and parser", "PARSER")).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 },
    ]);
    expect(highlightOccurrences("Parser and parser", "parser")).toBe(2);
  });

  it("ignores queries below the searchable minimum", () => {
    expect(highlightRanges("parser", "p")).toEqual([]);
    expect(highlightRanges("parser", "  ")).toEqual([]);
  });

  it("keeps offsets exact when lowercasing would change the string length", () => {
    const text = "İstanbul parser";
    expect(text.toLowerCase().length).not.toBe(text.length);
    const [range] = highlightRanges(text, "parser");
    expect(range).toEqual({ start: 9, end: 15 });
    expect(text.slice(range?.start, range?.end)).toBe("parser");
  });

  it("folds case without changing the length", () => {
    expect(foldCasePreservingLength("İa")).toHaveLength(2);
    expect(foldCasePreservingLength("ABC")).toBe("abc");
  });
});
