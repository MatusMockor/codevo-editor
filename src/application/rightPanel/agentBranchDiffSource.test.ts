import { describe, expect, it } from "vitest";
import type { GitBranchDiffGateway, GitBranchFileSidesRequest } from "../../domain/gitBranchDiff";
import { branchDiffSource } from "./agentBranchDiffSource";

const renamedFile = {
  repositoryRoot: "/repo/.worktrees/t",
  relativePath: "new.ts",
  displayPath: "new.ts",
  oldRelativePath: "old.ts",
  status: "renamed",
  added: 1,
  deleted: 0,
} as const;

describe("branchDiffSource", () => {
  it("lists branch files and reads sides against the merge base and head it listed", async () => {
    const reads: GitBranchFileSidesRequest[] = [];
    const gateway: GitBranchDiffGateway = {
      getBranchChanges: async () => ({
        mergeBase: "d".repeat(40),
        headCommit: "e".repeat(40),
        files: [
          {
            relativePath: "new.ts",
            oldRelativePath: "old.ts",
            status: "renamed",
            added: 1,
            deleted: 0,
          },
        ],
        truncated: false,
        statsTruncated: true,
      }),
      getBranchFileSides: async (request) => {
        reads.push(request);
        return {
          original: { text: "a" },
          modified: { text: "b" },
          unavailableReason: null,
        };
      },
    };
    const source = branchDiffSource({
      repositoryRoot: "/repo",
      worktreePath: "/repo/.worktrees/t",
      baseRef: "main",
      revision: 0,
      gateway,
    });

    const list = await source.listFiles();
    const sides = await source.readSides(renamedFile);

    expect(list).toEqual({
      files: [renamedFile],
      truncated: false,
      statsPartial: true,
      unavailableReason: null,
    });
    expect(sides).toEqual({
      original: "a",
      modified: "b",
      truncated: false,
      unavailableReason: null,
    });
    expect(reads).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: "/repo/.worktrees/t",
        mergeBase: "d".repeat(40),
        headCommit: "e".repeat(40),
        relativePath: "new.ts",
        oldRelativePath: "old.ts",
      },
    ]);
  });

  it("reports a missing merge base as unavailable", async () => {
    const source = branchDiffSource({
      repositoryRoot: "/repo",
      worktreePath: null,
      baseRef: "orphan",
      revision: 0,
      gateway: {
        getBranchChanges: () =>
          Promise.reject(new Error("orphan has no common history with this branch.")),
        getBranchFileSides: () => Promise.reject(new Error("unused")),
      },
    });
    await expect(source.listFiles()).resolves.toEqual({
      files: [],
      truncated: false,
      statsPartial: false,
      unavailableReason: "orphan has no common history with this branch.",
    });
  });

  it("reports sides as missing before any list and keys by base and revision", async () => {
    let sideReads = 0;
    const gateway: GitBranchDiffGateway = {
      getBranchChanges: () => Promise.reject(new Error("unused")),
      getBranchFileSides: () => {
        sideReads += 1;
        return Promise.reject(new Error("unused"));
      },
    };
    const input = {
      repositoryRoot: "/repo",
      worktreePath: null,
      baseRef: "main",
      revision: 1,
      gateway,
    };
    const source = branchDiffSource(input);

    await expect(source.readSides(renamedFile)).resolves.toEqual({
      original: "",
      modified: "",
      truncated: false,
      unavailableReason: "missing",
    });
    expect(sideReads).toBe(0);
    expect(branchDiffSource({ ...input, baseRef: "develop" }).key).not.toBe(source.key);
    expect(branchDiffSource({ ...input, revision: 2 }).key).not.toBe(source.key);
    expect(branchDiffSource(input).key).toBe(source.key);
    expect(branchDiffSource({ ...input, revision: 2 }).identity).toBe(source.identity);
    expect(branchDiffSource({ ...input, baseRef: "develop" }).identity).not.toBe(source.identity);
  });
});
