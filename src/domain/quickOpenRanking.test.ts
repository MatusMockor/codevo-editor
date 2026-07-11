import { describe, expect, it } from "vitest";
import type { FileSearchResult } from "./workspace";
import {
  QUICK_OPEN_RESULT_LIMIT,
  mergeQuickOpenResults,
} from "./quickOpenRanking";

function result(relativePath: string): FileSearchResult {
  const parts = relativePath.split("/");
  return {
    name: parts[parts.length - 1] ?? relativePath,
    path: `/workspace/${relativePath}`,
    relativePath,
  };
}

describe("mergeQuickOpenResults", () => {
  it("puts matching MRU entries above backend results in most-recent-first order", () => {
    expect(
      mergeQuickOpenResults(
        [result("src/UserController.ts"), result("src/UserService.ts")],
        [result("src/UserModel.ts")],
        "user",
      ),
    ).toEqual([
      result("src/UserController.ts"),
      result("src/UserService.ts"),
      result("src/UserModel.ts"),
    ]);
  });

  it("deduplicates by path with the MRU entry winning", () => {
    const recent = {
      ...result("src/User.ts"),
      name: "Recent User.ts",
    };

    expect(
      mergeQuickOpenResults(
        [recent],
        [result("src/User.ts"), result("src/User.test.ts")],
        "user",
      ),
    ).toEqual([recent, result("src/User.test.ts")]);
  });

  it("excludes MRU entries that do not fuzzy-match the query", () => {
    expect(
      mergeQuickOpenResults(
        [result("src/OrderController.ts"), result("src/UserController.ts")],
        [result("src/UserModel.ts")],
        "usr ctrl",
      ),
    ).toEqual([result("src/UserController.ts"), result("src/UserModel.ts")]);
  });

  it("keeps the supplied active-file-free MRU first for an empty query", () => {
    expect(
      mergeQuickOpenResults(
        [result("src/Previous.ts"), result("src/Older.ts")],
        [result("src/Active.ts"), result("src/Previous.ts")],
        "",
      ),
    ).toEqual([
      result("src/Previous.ts"),
      result("src/Older.ts"),
      result("src/Active.ts"),
    ]);
  });

  it("caps the merged result count at the existing quick-open limit", () => {
    const backend = Array.from(
      { length: QUICK_OPEN_RESULT_LIMIT + 10 },
      (_, index) => result(`src/File${index}.ts`),
    );

    expect(
      mergeQuickOpenResults([result("src/Recent.ts")], backend, ""),
    ).toHaveLength(QUICK_OPEN_RESULT_LIMIT);
  });
});
