import { describe, expect, it } from "vitest";
import {
  exceedsHighlightBatchBudget,
  exceedsHighlightBudget,
  MAX_HIGHLIGHT_BATCH_TEXTS,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINES,
  splitCodeLines,
} from "./highlightedCode";

describe("highlight budget", () => {
  it("accepts input at the limits", () => {
    expect(exceedsHighlightBudget("a".repeat(MAX_HIGHLIGHT_CHARS))).toBe(false);
    expect(exceedsHighlightBudget("\n".repeat(MAX_HIGHLIGHT_LINES - 1))).toBe(false);
  });

  it("rejects input above the char or line limits", () => {
    expect(exceedsHighlightBudget("a".repeat(MAX_HIGHLIGHT_CHARS + 1))).toBe(true);
    expect(exceedsHighlightBudget("\n".repeat(MAX_HIGHLIGHT_LINES))).toBe(true);
  });
});

describe("splitCodeLines", () => {
  it("splits on LF and CRLF like Shiki", () => {
    expect(splitCodeLines("a\r\nb\nc")).toEqual(["a", "b", "c"]);
    expect(splitCodeLines("")).toEqual([""]);
    expect(splitCodeLines("x\n")).toEqual(["x", ""]);
  });
});

describe("highlight batch budget", () => {
  it("bounds the text count, total chars and total lines", () => {
    expect(exceedsHighlightBatchBudget([])).toBe(false);
    expect(
      exceedsHighlightBatchBudget(Array.from({ length: MAX_HIGHLIGHT_BATCH_TEXTS }, () => "a")),
    ).toBe(false);
    expect(
      exceedsHighlightBatchBudget(Array.from({ length: MAX_HIGHLIGHT_BATCH_TEXTS + 1 }, () => "a")),
    ).toBe(true);
    const half = "a".repeat(MAX_HIGHLIGHT_CHARS / 2);
    expect(exceedsHighlightBatchBudget([half, half])).toBe(false);
    expect(exceedsHighlightBatchBudget([half, `${half}a`])).toBe(true);
    const lines = "\n".repeat(MAX_HIGHLIGHT_LINES / 2 - 1);
    expect(exceedsHighlightBatchBudget([lines, lines])).toBe(false);
    expect(exceedsHighlightBatchBudget([lines, lines, ""])).toBe(true);
  });
});
