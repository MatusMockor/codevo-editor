import { matchesQuery } from "./matchHighlight";
import type { FileSearchResult } from "./workspace";

export const QUICK_OPEN_RESULT_LIMIT = 80;

export function mergeQuickOpenResults(
  mruPaths: readonly FileSearchResult[],
  backendResults: readonly FileSearchResult[],
  query: string,
  limit: number = QUICK_OPEN_RESULT_LIMIT,
): FileSearchResult[] {
  const merged: FileSearchResult[] = [];
  const seen = new Set<string>();

  for (const result of mruPaths) {
    if (!matchesQuery(result.relativePath, query)) {
      continue;
    }

    if (seen.has(result.path)) {
      continue;
    }

    seen.add(result.path);
    merged.push(result);
  }

  for (const result of backendResults) {
    if (seen.has(result.path)) {
      continue;
    }

    seen.add(result.path);
    merged.push(result);
  }

  return merged.slice(0, Math.max(limit, 0));
}
