export const TITLE_EXACT_SCORE = 0;
export const TITLE_PREFIX_SCORE = 100;
export const TITLE_INCLUDES_SCORE = 200;
export const CONTENT_INCLUDES_SCORE = 400;

export interface RankedSearchEntry {
  readonly score: number;
  readonly recencyEpochMs: number;
  readonly tieBreakKey: string;
}

export function titleMatchScore(titleLower: string, query: string): number | null {
  if (titleLower === query) return TITLE_EXACT_SCORE;
  if (titleLower.startsWith(query)) return TITLE_PREFIX_SCORE + titleLower.length;
  const index = titleLower.indexOf(query);
  if (index === -1) return null;
  return TITLE_INCLUDES_SCORE + 2 * index;
}

export function compareRankedSearchEntries(
  left: RankedSearchEntry,
  right: RankedSearchEntry,
): number {
  if (left.score !== right.score) return left.score - right.score;
  if (left.recencyEpochMs !== right.recencyEpochMs) {
    return right.recencyEpochMs - left.recencyEpochMs;
  }
  if (left.tieBreakKey < right.tieBreakKey) return -1;
  if (left.tieBreakKey > right.tieBreakKey) return 1;
  return 0;
}

export function insertRankedSearchResult<Entry extends RankedSearchEntry>(
  ranked: Entry[],
  candidate: Entry,
  limit: number,
): boolean {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
  if (cap === 0) return false;

  const last = ranked[ranked.length - 1];
  if (ranked.length >= cap && last !== undefined) {
    if (compareRankedSearchEntries(candidate, last) >= 0) return false;
    ranked.pop();
  }

  ranked.splice(rankedInsertIndex(ranked, candidate), 0, candidate);
  return true;
}

function rankedInsertIndex<Entry extends RankedSearchEntry>(
  ranked: ReadonlyArray<Entry>,
  candidate: Entry,
): number {
  let low = 0;
  let high = ranked.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = ranked[middle];
    if (entry === undefined) return middle;
    if (compareRankedSearchEntries(entry, candidate) <= 0) {
      low = middle + 1;
      continue;
    }
    high = middle;
  }
  return low;
}
