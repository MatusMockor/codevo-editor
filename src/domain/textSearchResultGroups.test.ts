import { describe, expect, it } from "vitest";
import type { TextSearchResult } from "./workspace";
import { groupTextSearchResults } from "./textSearchResultGroups";

describe("groupTextSearchResults", () => {
  it("groups matches by file in first-seen order with truthful counts", () => {
    const groups = groupTextSearchResults([
      result("/workspace/a.ts", "a.ts", 1),
      result("/workspace/b.ts", "b.ts", 2),
      result("/workspace/a.ts", "a.ts", 3),
    ]);

    expect(
      groups.map((group) => ({
        matchCount: group.results.length,
        path: group.path,
        lines: group.results.map((match) => match.lineNumber),
      })),
    ).toEqual([
      { matchCount: 2, path: "/workspace/a.ts", lines: [1, 3] },
      { matchCount: 1, path: "/workspace/b.ts", lines: [2] },
    ]);
  });
});

function result(path: string, relativePath: string, lineNumber: number): TextSearchResult {
  return {
    column: 1,
    lineNumber,
    lineText: "needle",
    matchEnd: 6,
    matchStart: 0,
    path,
    relativePath,
  };
}
