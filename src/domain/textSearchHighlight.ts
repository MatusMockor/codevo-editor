import type { TextSearchResult } from "./workspace";

export function splitMatchHighlight(result: TextSearchResult): {
  before: string;
  match: string;
  after: string;
} {
  const chars = Array.from(result.lineText);
  const start = clampOffset(result.matchStart ?? 0, chars.length);
  const end = clampOffset(result.matchEnd ?? 0, chars.length);

  if (end <= start) {
    return { before: result.lineText, match: "", after: "" };
  }

  return {
    before: chars.slice(0, start).join(""),
    match: chars.slice(start, end).join(""),
    after: chars.slice(end).join(""),
  };
}

function clampOffset(value: number, length: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(Math.trunc(value), length);
}
