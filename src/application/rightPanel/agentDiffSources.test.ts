import { describe, expect, it } from "vitest";
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../../domain/git";
import {
  MAX_AGENT_DIFF_FILES,
  agentDiffTruncationNote,
  agentDiffRevisionKey,
  turnDiffSource,
  workingTreeDiffSource,
  type AgentDiffLineStatsPort,
} from "./agentDiffSources";

function change(
  relativePath: string,
  status: GitChangedFile["status"] = "modified",
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: status === "untracked",
    oldPath: null,
    oldRelativePath: null,
    path: `/repo/${relativePath}`,
    relativePath,
    status,
  };
}

describe("turnDiffSource", () => {
  it("lists recorded files with their line counts and reads both sides", async () => {
    const summary: AgentTurnChangeSummary = {
      turnId: "t1",
      state: "ready",
      truncated: false,
      reason: null,
      files: [
        {
          relativePath: "src/a.ts",
          oldRelativePath: null,
          status: "modified",
          addedLines: 3,
          deletedLines: 1,
        },
      ],
    };
    const fileDiff: AgentTurnFileDiff = {
      relativePath: "src/a.ts",
      original: { text: "a\n", truncated: false },
      modified: { text: "b\n", truncated: true },
      unavailableReason: null,
    };
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: "/repo",
      revision: 1,
      getTurnChanges: async () => summary,
      getTurnFileDiff: async () => fileDiff,
    });

    const list = await source.listFiles();
    expect(list.files).toEqual([
      {
        repositoryRoot: "/repo",
        relativePath: "src/a.ts",
        displayPath: "src/a.ts",
        oldRelativePath: null,
        status: "modified",
        added: 3,
        deleted: 1,
      },
    ]);
    const first = list.files[0];
    if (first === undefined) return;
    await expect(source.readSides(first)).resolves.toEqual({
      original: "a\n",
      modified: "b\n",
      truncated: true,
      unavailableReason: null,
    });
  });

  it("reports an unavailable recorded turn truthfully", async () => {
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: "/repo",
      revision: 1,
      getTurnChanges: async () => ({
        turnId: "t1",
        state: "unavailable",
        files: [],
        truncated: false,
        reason: "Recorded changes were pruned.",
      }),
      getTurnFileDiff: async () => ({
        relativePath: "",
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    });
    await expect(source.listFiles()).resolves.toMatchObject({
      files: [],
      unavailableReason: "Recorded changes were pruned.",
    });
  });
});

describe("turnDiffSource unsupported turns", () => {
  it("never shows the internal unsupported reason code", async () => {
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: "/repo",
      revision: 1,
      getTurnChanges: async () => ({
        turnId: "t1",
        state: "unsupported",
        files: [],
        truncated: false,
        reason: "notGitRepository",
      }),
      getTurnFileDiff: async () => ({
        relativePath: "",
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    });
    await expect(source.listFiles()).resolves.toEqual({
      files: [],
      truncated: false,
      statsPartial: false,
      unavailableReason: "Recorded changes are not available for this project.",
    });
  });
});

describe("workingTreeDiffSource", () => {
  const status = (root: string, changes: GitChangedFile[]): GitStatus => ({
    branch: "main",
    changes,
    isRepository: true,
    rootPath: root,
  });

  it("merges line stats, prefixes nested repositories and reads through getDiff", async () => {
    const git = {
      getStatus: async (root: string) =>
        root === "/repo"
          ? status(root, [change("src/a.ts")])
          : status(root, [change("index.ts", "untracked")]),
      getDiff: async (_root: string, file: GitChangedFile): Promise<GitFileDiff> => ({
        change: file,
        language: "typescript",
        originalContent: "old\n",
        modifiedContent: "new\n",
        previewUnavailableReason: null,
      }),
    };
    const lineStats: AgentDiffLineStatsPort = {
      lineStats: async () => ({
        stats: [{ relativePath: "src/a.ts", added: 4, deleted: 2 }],
        truncated: false,
      }),
    };
    const source = workingTreeDiffSource({
      repositories: [
        { root: "/repo", prefix: "" },
        { root: "/repo/packages/api", prefix: "packages/api/" },
      ],
      worktreePath: null,
      revision: "0",
      git,
      lineStats,
    });

    const list = await source.listFiles();
    expect(list.files.map((file) => [file.displayPath, file.added, file.deleted])).toEqual([
      ["src/a.ts", 4, 2],
      ["packages/api/index.ts", null, null],
    ]);
    const nested = list.files[1];
    if (nested === undefined) return;
    await expect(source.readSides(nested)).resolves.toEqual({
      original: "old\n",
      modified: "new\n",
      truncated: false,
      unavailableReason: null,
    });
  });

  it("marks a file that disappeared since listing as missing", async () => {
    const source = workingTreeDiffSource({
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      revision: "0",
      git: {
        getStatus: async () => status("/repo", []),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: null,
    });
    await expect(
      source.readSides({
        repositoryRoot: "/repo",
        relativePath: "gone.ts",
        displayPath: "gone.ts",
        oldRelativePath: null,
        status: "modified",
        added: null,
        deleted: null,
      }),
    ).resolves.toMatchObject({ unavailableReason: "missing" });
  });

  it("keeps working when line stats fail", async () => {
    const source = workingTreeDiffSource({
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      revision: "0",
      git: {
        getStatus: async () => status("/repo", [change("a.ts")]),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: { lineStats: () => Promise.reject(new Error("offline")) },
    });
    await expect(source.listFiles()).resolves.toMatchObject({
      files: [{ added: null }],
      statsPartial: true,
    });
  });

  it("reports partial line stats when the backend truncated them", async () => {
    const source = workingTreeDiffSource({
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      revision: "0",
      git: {
        getStatus: async () => status("/repo", [change("a.ts"), change("b.ts")]),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: {
        lineStats: async () => ({
          stats: [{ relativePath: "a.ts", added: 1, deleted: 0 }],
          truncated: true,
        }),
      },
    });
    await expect(source.listFiles()).resolves.toMatchObject({
      files: [{ added: 1 }, { added: null }],
      statsPartial: true,
    });
  });

  it("keeps the identity stable across revisions", () => {
    const input = {
      repositories: [{ root: "/repo", prefix: "" }],
      worktreePath: null,
      git: {
        getStatus: async () => status("/repo", []),
        getDiff: async (_root: string, file: GitChangedFile) => ({
          change: file,
          language: "text",
          originalContent: "",
          modifiedContent: "",
        }),
      },
      lineStats: null,
    };
    const first = workingTreeDiffSource({ ...input, revision: "1" });
    const second = workingTreeDiffSource({ ...input, revision: "2" });
    expect(first.identity).toBe(second.identity);
    expect(first.key).not.toBe(second.key);
  });
});

describe("turnDiffSource without a checkout root", () => {
  it("lists files without inventing an absolute root", async () => {
    const source = turnDiffSource({
      threadId: "thread-1",
      turnId: "t1",
      repositoryRoot: null,
      revision: 1,
      getTurnChanges: async () => ({
        turnId: "t1",
        state: "ready",
        truncated: false,
        reason: null,
        files: [
          {
            relativePath: "src/a.ts",
            oldRelativePath: null,
            status: "modified",
            addedLines: 1,
            deletedLines: 0,
          },
        ],
      }),
      getTurnFileDiff: async () => ({
        relativePath: "src/a.ts",
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      }),
    });
    await expect(source.listFiles()).resolves.toMatchObject({
      files: [{ repositoryRoot: null, relativePath: "src/a.ts" }],
    });
  });
});

describe("agentDiffRevisionKey", () => {
  it("gives each revision object a stable distinct number", () => {
    const a = {};
    const b = {};
    expect(agentDiffRevisionKey(a)).toBe(agentDiffRevisionKey(a));
    expect(agentDiffRevisionKey(a)).not.toBe(agentDiffRevisionKey(b));
    expect(agentDiffRevisionKey(undefined)).toBe(0);
  });
});

describe("agentDiffTruncationNote", () => {
  it("names the file cap only when the list reached it", () => {
    expect(agentDiffTruncationNote(MAX_AGENT_DIFF_FILES)).toBe(
      `Showing the first ${MAX_AGENT_DIFF_FILES} changed files.`,
    );
    expect(agentDiffTruncationNote(42)).toBe(
      "Showing the first 42 changed files. The full change list is too large to read.",
    );
  });
});
