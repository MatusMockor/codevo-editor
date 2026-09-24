export const MAX_PALETTE_QUERY_CHARS = 256;
export const MAX_PALETTE_QUERY_TOKENS = 8;
const MAX_FUZZY_TEXT_CHARS = 1_024;
const MAX_FUZZY_STARTS = 64;

export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

export interface FuzzyMatch {
  readonly indexes: readonly number[];
  readonly span: number;
}

export function paletteQueryTokens(query: string): readonly string[] {
  return query
    .slice(0, MAX_PALETTE_QUERY_CHARS)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, MAX_PALETTE_QUERY_TOKENS);
}

export function matchesAllTokens(terms: readonly string[], tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = terms.join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function tokenHighlightRanges(
  text: string,
  tokens: readonly string[],
): readonly HighlightRange[] {
  const lower = text.toLowerCase();
  if (tokens.length === 0 || lower.length !== text.length) return [];
  const hits: HighlightRange[] = [];
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index >= 0) {
      hits.push({ start: index, end: index + token.length });
      index = lower.indexOf(token, index + token.length);
    }
  }
  return mergeRanges(hits);
}

export function fuzzySubsequence(text: string, query: string): FuzzyMatch | null {
  const needle = query.toLowerCase().replace(/\s+/g, "").slice(0, MAX_PALETTE_QUERY_CHARS);
  const haystack = text.slice(0, MAX_FUZZY_TEXT_CHARS);
  const lower = haystack.toLowerCase();
  if (needle.length === 0 || lower.length !== haystack.length) return null;
  let best: FuzzyMatch | null = null;
  let starts = 0;
  for (
    let start = lower.indexOf(needle[0] ?? "");
    start >= 0;
    start = lower.indexOf(needle[0] ?? "", start + 1)
  ) {
    if (starts >= MAX_FUZZY_STARTS) break;
    starts += 1;
    const indexes = subsequenceFrom(lower, needle, start);
    if (indexes === null) break;
    const span = (indexes[indexes.length - 1] ?? start) - start;
    if (best === null || span < best.span) best = { indexes, span };
  }
  return best;
}

export function fuzzyHighlightRanges(match: FuzzyMatch | null): readonly HighlightRange[] {
  if (match === null) return [];
  return mergeRanges(match.indexes.map((index) => ({ start: index, end: index + 1 })));
}

function subsequenceFrom(lower: string, needle: string, start: number): number[] | null {
  const indexes = [start];
  let position = start + 1;
  for (let offset = 1; offset < needle.length; offset += 1) {
    const found = lower.indexOf(needle[offset] ?? "", position);
    if (found < 0) return null;
    indexes.push(found);
    position = found + 1;
  }
  return indexes;
}

function mergeRanges(ranges: readonly HighlightRange[]): readonly HighlightRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last === undefined || range.start > last.end) {
      merged.push(range);
      continue;
    }
    merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
  }
  return merged;
}
