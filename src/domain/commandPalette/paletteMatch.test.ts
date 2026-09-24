import { describe, expect, it } from "vitest";
import {
  MAX_PALETTE_QUERY_CHARS,
  fuzzyHighlightRanges,
  fuzzySubsequence,
  matchesAllTokens,
  paletteQueryTokens,
  tokenHighlightRanges,
} from "./paletteMatch";

describe("paletteQueryTokens", () => {
  it("lowercases, splits on whitespace and drops empties", () => {
    expect(paletteQueryTokens("  Order   API ")).toEqual(["order", "api"]);
    expect(paletteQueryTokens(" \t\n ")).toEqual([]);
  });

  it("bounds pasted input to the character and token caps", () => {
    const tokens = paletteQueryTokens(`${"a ".repeat(40)}${"b".repeat(10_000)}`);
    expect(tokens).toHaveLength(8);
    expect(tokens.join(" ").length).toBeLessThanOrEqual(MAX_PALETTE_QUERY_CHARS);
  });
});

describe("matchesAllTokens", () => {
  it("requires every token somewhere in the joined terms", () => {
    expect(matchesAllTokens(["Idempotency keys", "orders-api"], ["idem", "orders"])).toBe(true);
    expect(matchesAllTokens(["Idempotency keys"], ["idem", "billing"])).toBe(false);
    expect(matchesAllTokens(["anything"], [])).toBe(true);
  });

  it("treats regex metacharacters literally", () => {
    expect(matchesAllTokens(["a+b (c)"], ["+b", "(c)"])).toBe(true);
    expect(matchesAllTokens(["abc"], [".*"])).toBe(false);
  });
});

describe("tokenHighlightRanges", () => {
  it("marks every occurrence of every token and merges overlaps", () => {
    expect(tokenHighlightRanges("orders order", ["order", "rs"])).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 12 },
    ]);
  });

  it("returns no ranges when case folding changes the string length", () => {
    expect(tokenHighlightRanges("İstanbul orders", ["orders"])).toEqual([]);
  });
});

describe("fuzzySubsequence", () => {
  it("prefers the tightest span", () => {
    const match = fuzzySubsequence("src/middleware/idempotency.ts", "idm");
    expect(match?.span).toBeLessThan(6);
    expect(fuzzyHighlightRanges(match)).toEqual([
      { start: 15, end: 17 },
      { start: 18, end: 19 },
    ]);
  });

  it("returns null for a missing character and for an empty query", () => {
    expect(fuzzySubsequence("orders.ts", "oz")).toBeNull();
    expect(fuzzySubsequence("orders.ts", "")).toBeNull();
  });

  it("stays bounded for long adversarial input", () => {
    const text = "a".repeat(4_000);
    const query = `${"a".repeat(200)}b`;
    const started = performance.now();
    expect(fuzzySubsequence(text, query)).toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
