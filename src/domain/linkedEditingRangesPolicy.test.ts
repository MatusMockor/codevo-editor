import { describe, expect, it } from "vitest";
import type { LanguageServerRange } from "./languageServerFeatures";
import {
  isSafeLinkedEditingWordPattern,
  linkedEditingRangesFitProjection,
  MAX_LINKED_EDITING_RANGES,
  MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES,
} from "./linkedEditingRangesPolicy";

const range: LanguageServerRange = {
  end: { character: 1, line: 0 },
  start: { character: 0, line: 0 },
};

describe("linkedEditingRangesFitProjection", () => {
  it("accepts exact item and pattern limits", () => {
    expect(
      linkedEditingRangesFitProjection({
        ranges: Array.from({ length: MAX_LINKED_EDITING_RANGES }, () => range),
        wordPattern: "a".repeat(MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES),
      }),
    ).toBe(true);
  });

  it("rejects either limit at N+1 without truncating", () => {
    expect(
      linkedEditingRangesFitProjection({
        ranges: Array.from({ length: MAX_LINKED_EDITING_RANGES + 1 }, () => range),
        wordPattern: null,
      }),
    ).toBe(false);
    expect(
      linkedEditingRangesFitProjection({
        ranges: [range],
        wordPattern: "a".repeat(MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES + 1),
      }),
    ).toBe(false);
  });

  it("measures the word-pattern limit in UTF-8 bytes", () => {
    expect(
      linkedEditingRangesFitProjection({
        ranges: [range],
        wordPattern: "€".repeat(Math.floor(MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES / 3)),
      }),
    ).toBe(true);
    expect(
      linkedEditingRangesFitProjection({
        ranges: [range],
        wordPattern: `${"€".repeat(Math.floor(MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES / 3))}€`,
      }),
    ).toBe(false);
  });
});

describe("isSafeLinkedEditingWordPattern", () => {
  it("accepts the bounded non-branching identifier pattern used by linked tags", () => {
    expect(isSafeLinkedEditingWordPattern("[A-Za-z][A-Za-z0-9]*")).toBe(true);
  });

  it("rejects grouped, branching, backreference and multiply-quantified patterns", () => {
    expect(isSafeLinkedEditingWordPattern("(a+)+$")).toBe(false);
    expect(isSafeLinkedEditingWordPattern("a|b")).toBe(false);
    expect(isSafeLinkedEditingWordPattern("[a-z]*[a-z]*")).toBe(false);
    expect(isSafeLinkedEditingWordPattern("(a)\\1")).toBe(false);
  });
});
