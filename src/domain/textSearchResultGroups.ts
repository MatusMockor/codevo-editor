import type { TextSearchResult } from "./workspace";

export interface TextSearchResultGroup {
  readonly path: string;
  readonly relativePath: string;
  readonly results: readonly TextSearchResult[];
}

export function groupTextSearchResults(
  results: readonly TextSearchResult[],
): readonly TextSearchResultGroup[] {
  const groups: Array<{
    path: string;
    relativePath: string;
    results: TextSearchResult[];
  }> = [];
  const indicesByPath = new Map<string, number>();

  for (const result of results) {
    const existingIndex = indicesByPath.get(result.path);

    if (existingIndex !== undefined) {
      groups[existingIndex]?.results.push(result);
      continue;
    }

    indicesByPath.set(result.path, groups.length);
    groups.push({
      path: result.path,
      relativePath: result.relativePath,
      results: [result],
    });
  }

  return groups;
}
