import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/git-surface-wire.json";
import {
  GET_GIT_BRANCH_CHANGES_IPC_COMMAND,
  GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND,
  GET_GIT_SURFACE_STATUS_IPC_COMMAND,
  invokeGetGitBranchChangesIpc,
  invokeGetGitBranchFileDiffIpc,
  invokeGetGitSurfaceStatusIpc,
  validateGitBranchChangesRequest,
  validateGitBranchFileDiffRequest,
  validateGitSurfaceTargetRequest,
} from "./tauriGitSurfaceIpcContract";

const EMPTY_STATUS = {
  branch: null,
  defaultBase: null,
  hasRemote: false,
  upstream: null,
  unpushed: [],
  unpushedTruncated: false,
  lineStats: [],
  lineStatsTruncated: false,
  localBranches: [],
  remoteBranches: [],
  worktreeBranches: [],
  branchesTruncated: false,
};

describe("git surface IPC contract", () => {
  it("sends exactly the validated request under the documented command", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const extended = { repositoryRoot: "/repo", worktreePath: null, shell: "rm -rf /" };
    await invokeGetGitSurfaceStatusIpc(async (command, args) => {
      calls.push({ command, args });
      return EMPTY_STATUS;
    }, extended);
    expect(calls).toEqual([
      {
        command: GET_GIT_SURFACE_STATUS_IPC_COMMAND,
        args: { request: { repositoryRoot: "/repo", worktreePath: null } },
      },
    ]);
  });

  it("sends the branch file diff request and parses its sides", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const sides = await invokeGetGitBranchFileDiffIpc(
      async (command, args) => {
        calls.push({ command, args });
        return {
          original: { text: "a" },
          modified: { text: "b" },
          unavailableReason: null,
        };
      },
      {
        repositoryRoot: "/repo",
        worktreePath: "/repo/.worktrees/t",
        mergeBase: "c".repeat(40),
        headCommit: "d".repeat(40),
        relativePath: "new.ts",
        oldRelativePath: "old.ts",
      },
    );
    expect(sides.modified.text).toBe("b");
    expect(calls).toEqual([
      {
        command: GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND,
        args: {
          request: {
            repositoryRoot: "/repo",
            worktreePath: "/repo/.worktrees/t",
            mergeBase: "c".repeat(40),
            headCommit: "d".repeat(40),
            relativePath: "new.ts",
            oldRelativePath: "old.ts",
          },
        },
      },
    ]);
  });

  it("rejects relative roots and hostile paths before invoking", () => {
    expect(() =>
      validateGitSurfaceTargetRequest({ repositoryRoot: "repo", worktreePath: null }),
    ).toThrow();
    expect(() =>
      validateGitBranchFileDiffRequest({
        repositoryRoot: "/repo",
        worktreePath: null,
        mergeBase: "c".repeat(40),
        headCommit: "d".repeat(40),
        relativePath: "../secret",
        oldRelativePath: null,
      }),
    ).toThrow();
    expect(() =>
      validateGitBranchFileDiffRequest({
        repositoryRoot: "/repo",
        worktreePath: null,
        mergeBase: "c".repeat(40),
        headCommit: "HEAD",
        relativePath: "a.ts",
        oldRelativePath: null,
      }),
    ).toThrow();
  });

  it("rejects an invalid base ref without invoking", async () => {
    let invoked = false;
    await expect(
      invokeGetGitBranchChangesIpc(
        async () => {
          invoked = true;
          return null;
        },
        { repositoryRoot: "/repo", worktreePath: null, baseRef: "--output=/tmp/x" },
      ),
    ).rejects.toThrow();
    expect(invoked).toBe(false);
    expect(GET_GIT_BRANCH_CHANGES_IPC_COMMAND).toBe("get_git_branch_changes");
  });

  it("rejects a malformed response", async () => {
    await expect(
      invokeGetGitSurfaceStatusIpc(async () => ({ ...EMPTY_STATUS, extra: true }), {
        repositoryRoot: "/repo",
        worktreePath: null,
      }),
    ).rejects.toThrow();
  });
});

describe("git surface shared request contract", () => {
  it("sends exactly the fixture request keys", () => {
    const { requests } = wireContract;
    expect(validateGitSurfaceTargetRequest(requests.surfaceTarget)).toEqual(requests.surfaceTarget);
    expect(validateGitBranchChangesRequest(requests.branchChanges)).toEqual(requests.branchChanges);
    expect(validateGitBranchFileDiffRequest(requests.branchFileSides)).toEqual(
      requests.branchFileSides,
    );
    expect(
      validateGitBranchFileDiffRequest({ ...requests.branchFileSides, extra: 1 } as never),
    ).toEqual(requests.branchFileSides);
  });
});
