import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "./git";
import {
  ALL_CHANGES,
  includeSelection,
  includeSummary,
  gitChangeRowKey,
  mergeChangesByPath,
  pruneExcluded,
  selectCommitChanges,
  setAllIncluded,
  setIncluded,
} from "./gitCommitSelection";

function change(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/r/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

describe("commit selection", () => {
  const changes = [change("a.ts"), change("b.ts"), change(".env.example")];

  it("commits everything for the all selection", () => {
    expect(selectCommitChanges(changes, ALL_CHANGES)).toEqual({ kind: "ok", changes });
  });

  it("commits exactly the selected paths that still changed", () => {
    expect(
      selectCommitChanges(changes, { kind: "paths", relativePaths: ["b.ts", "a.ts"] }),
    ).toEqual({
      kind: "ok",
      changes: [changes[0], changes[1]],
    });
  });

  it("fails closed when a selected path no longer has changes", () => {
    expect(
      selectCommitChanges(changes, { kind: "paths", relativePaths: ["a.ts", "gone.ts"] }),
    ).toEqual({
      kind: "stale",
      missing: ["gone.ts"],
    });
  });

  it("never commits a truncated prefix of a large selection", () => {
    const many = Array.from({ length: 2_500 }, (_unused, index) => change(`f${index}.ts`));
    const result = selectCommitChanges(many, {
      kind: "paths",
      relativePaths: many.slice(1).map((item) => item.relativePath),
    });
    expect(result).toEqual({ kind: "ok", changes: many.slice(1) });
  });

  it("ignores duplicate selected paths", () => {
    expect(
      selectCommitChanges(changes, { kind: "paths", relativePaths: ["a.ts", "a.ts"] }),
    ).toEqual({ kind: "ok", changes: [changes[0]] });
  });

  it("reports nothing to commit", () => {
    expect(selectCommitChanges([], ALL_CHANGES)).toEqual({ kind: "empty" });
    expect(selectCommitChanges(changes, { kind: "paths", relativePaths: [] })).toEqual({
      kind: "empty",
    });
  });

  it("tracks include checkboxes as an excluded set", () => {
    const paths = changes.map(gitChangeRowKey);
    const excluded = setIncluded(new Set(), "tracked:.env.example", false);
    expect(includeSummary(paths, excluded)).toEqual({ included: 2, total: 3, checked: "mixed" });
    expect(includeSelection(paths, excluded)).toEqual({
      kind: "rows",
      rowKeys: ["tracked:a.ts", "tracked:b.ts"],
    });
    expect(includeSelection(paths, new Set())).toEqual({ kind: "rows", rowKeys: paths });
    expect(includeSummary(paths, setAllIncluded(paths, false))).toEqual({
      included: 0,
      total: 3,
      checked: false,
    });
    expect(setIncluded(excluded, "tracked:.env.example", true)).toEqual(new Set());
    expect(pruneExcluded(new Set(["tracked:gone.ts", "tracked:a.ts"]), paths)).toEqual(
      new Set(["tracked:a.ts"]),
    );
  });

  it("never widens an all-included selection to changes that were not listed", () => {
    expect(includeSelection(["tracked:a.ts"], new Set())).toEqual({
      kind: "rows",
      rowKeys: ["tracked:a.ts"],
    });
  });

  it("merges the staged and unstaged entries of a partially staged file into one", () => {
    const staged = { ...change("a.ts"), isStaged: true, status: "added" as const };
    const unstaged = change("a.ts");
    const merged = mergeChangesByPath([staged, change("b.ts"), unstaged]);

    expect(merged.map((item) => [item.relativePath, item.status, item.isStaged])).toEqual([
      ["a.ts", "added", false],
      ["b.ts", "modified", false],
    ]);
    expect(
      mergeChangesByPath([unstaged, { ...change("a.ts"), isStaged: true, status: "conflicted" }]),
    ).toEqual([{ ...change("a.ts"), isStaged: false, status: "conflicted" }]);
  });

  it("keeps a staged delete and its recreated untracked file as two rows", () => {
    const deleted = { ...change("secrets.env"), isStaged: true, status: "deleted" as const };
    const untracked = {
      ...change("secrets.env"),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const merged = mergeChangesByPath([deleted, untracked]);

    expect(merged.map(gitChangeRowKey)).toEqual(["tracked:secrets.env", "untracked:secrets.env"]);
    expect(
      selectCommitChanges([deleted, untracked], { kind: "rows", rowKeys: ["tracked:secrets.env"] }),
    ).toEqual({ kind: "ok", changes: [deleted] });
    expect(
      selectCommitChanges([deleted], {
        kind: "rows",
        rowKeys: ["tracked:secrets.env", "untracked:secrets.env"],
      }),
    ).toEqual({ kind: "stale", missing: ["untracked:secrets.env"] });
  });
});
