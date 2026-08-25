import { describe, expect, it, vi } from "vitest";
import {
  COMPARE_URL_OPEN_FAILED,
  GIT_INTEGRATION_UNAVAILABLE_ERROR,
  GitPushFailureError,
  MAX_GIT_PUSH_FAILURE_MESSAGE_BYTES,
  TauriCompareUrlOpener,
  TauriGitIntegrationGateway,
  classifyPushFailure,
} from "./tauriGitIntegrationGateway";
import {
  GET_GIT_SHIP_STATUS_IPC_COMMAND,
  INTEGRATE_GIT_WORKTREE_BRANCH_IPC_COMMAND,
  PUSH_GIT_BRANCH_UPSTREAM_IPC_COMMAND,
  type InvokeGitIntegrationCommand,
} from "./tauriGitIntegrationIpcContract";

const REPOSITORY_ROOT = "/repository";
const WORKTREE_PATH = "/repository/.worktrees/agt-1";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const shipStatus = {
  worktree: { branch: "agent/agt-1", head: SHA_A, dirty: false, changeCount: 0 },
  primary: { branch: "main", head: SHA_B, dirty: false },
  relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
  remote: { name: "origin", upstream: null, compareUrl: "https://github.com/o/r/compare/x" },
};

describe("TauriGitIntegrationGateway", () => {
  it("parses ship status, push receipts and integration outcomes through the contract", async () => {
    const invoke = vi
      .fn<InvokeGitIntegrationCommand>()
      .mockResolvedValueOnce(shipStatus)
      .mockResolvedValueOnce({ remote: "origin", branch: "agent/agt-1", compareUrl: null })
      .mockResolvedValueOnce({ kind: "integrated", mergeSha: SHA_B, intoBranch: "main" });
    const gateway = new TauriGitIntegrationGateway(invoke, () => true);

    await expect(
      gateway.getShipStatus({ repositoryRoot: REPOSITORY_ROOT, worktreePath: WORKTREE_PATH }),
    ).resolves.toEqual(shipStatus);
    await expect(
      gateway.pushBranchUpstream({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null }),
    ).resolves.toEqual({ remote: "origin", branch: "agent/agt-1", compareUrl: null });
    await expect(
      gateway.integrateWorktreeBranch({
        repositoryRoot: REPOSITORY_ROOT,
        worktreePath: WORKTREE_PATH,
        mode: "fastForward",
        expectedPrimaryBranch: "main",
        expectedPrimaryHead: SHA_B,
        expectedBranchHead: SHA_A,
        mergeMessage: "Merge agent/agt-1",
      }),
    ).resolves.toEqual({ kind: "integrated", mergeSha: SHA_B, intoBranch: "main" });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      GET_GIT_SHIP_STATUS_IPC_COMMAND,
      PUSH_GIT_BRANCH_UPSTREAM_IPC_COMMAND,
      INTEGRATE_GIT_WORKTREE_BRANCH_IPC_COMMAND,
    ]);
    expect(invoke.mock.calls[2]?.[1]).toEqual({
      request: {
        repositoryRoot: REPOSITORY_ROOT,
        worktreePath: WORKTREE_PATH,
        mode: "fastForward",
        expectedPrimaryBranch: "main",
        expectedPrimaryHead: SHA_B,
        expectedBranchHead: SHA_A,
        mergeMessage: "Merge agent/agt-1",
      },
    });
  });

  it("rejects every operation outside Tauri without invoking", async () => {
    const invoke = vi.fn<InvokeGitIntegrationCommand>();
    const gateway = new TauriGitIntegrationGateway(invoke, () => false);
    await expect(
      gateway.getShipStatus({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null }),
    ).rejects.toThrow(GIT_INTEGRATION_UNAVAILABLE_ERROR);
    await expect(
      gateway.pushBranchUpstream({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null }),
    ).rejects.toThrow(GIT_INTEGRATION_UNAVAILABLE_ERROR);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed responses fail-closed", async () => {
    const invoke = vi
      .fn<InvokeGitIntegrationCommand>()
      .mockResolvedValueOnce({ ...shipStatus, extra: true });
    const gateway = new TauriGitIntegrationGateway(invoke, () => true);
    await expect(
      gateway.getShipStatus({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null }),
    ).rejects.toThrow("Invalid Git integration value");
  });

  it.each([
    ["noRemote: no remote configured", "noRemote", "no remote configured"],
    ["rejected: non-fast-forward", "rejected", "non-fast-forward"],
    ["authRequired: could not read Username", "authRequired", "could not read Username"],
    ["gitError: fatal: boom", "gitError", "fatal: boom"],
    ["something unexpected", "gitError", "something unexpected"],
  ] as const)("maps push rejection %j to a typed failure", async (rejection, reason, message) => {
    const invoke = vi.fn<InvokeGitIntegrationCommand>().mockRejectedValueOnce(rejection);
    const gateway = new TauriGitIntegrationGateway(invoke, () => true);
    const failure = await gateway
      .pushBranchUpstream({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GitPushFailureError);
    expect((failure as GitPushFailureError).reason).toBe(reason);
    expect((failure as GitPushFailureError).message).toBe(message);
  });

  it("treats a malformed push receipt as a git error", async () => {
    const invoke = vi.fn<InvokeGitIntegrationCommand>().mockResolvedValueOnce({ remote: "origin" });
    const gateway = new TauriGitIntegrationGateway(invoke, () => true);
    const failure = await gateway
      .pushBranchUpstream({ repositoryRoot: REPOSITORY_ROOT, worktreePath: null })
      .catch((error: unknown) => error);
    expect((failure as GitPushFailureError).reason).toBe("gitError");
  });

  it("bounds and sanitizes push failure messages", () => {
    const failure = classifyPushFailure(`gitError: \u0007${"x".repeat(5_000)}`);
    expect(failure.reason).toBe("gitError");
    expect(failure.message).not.toContain("\u0007");
    expect(new TextEncoder().encode(failure.message).byteLength).toBe(
      MAX_GIT_PUSH_FAILURE_MESSAGE_BYTES,
    );
    expect(classifyPushFailure({ weird: true }).message).toBe("");
  });
});

describe("TauriCompareUrlOpener", () => {
  it("opens https compare URLs on known hosts only", async () => {
    const openUrl = vi.fn(async () => undefined);
    const opener = new TauriCompareUrlOpener(openUrl);
    await opener.openExternal("https://github.com/o/r/compare/main...agent/x?expand=1");
    expect(openUrl).toHaveBeenCalledTimes(1);
    await expect(opener.openExternal("http://github.com/o/r")).rejects.toThrow(
      COMPARE_URL_OPEN_FAILED,
    );
    await expect(opener.openExternal("https://evil.example/o/r")).rejects.toThrow(
      COMPARE_URL_OPEN_FAILED,
    );
    await expect(opener.openExternal("https://user:pw@github.com/o/r")).rejects.toThrow(
      COMPARE_URL_OPEN_FAILED,
    );
    await expect(opener.openExternal("not a url")).rejects.toThrow(COMPARE_URL_OPEN_FAILED);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("wraps opener failures in the closed error", async () => {
    const opener = new TauriCompareUrlOpener(async () => {
      throw new Error("denied");
    });
    await expect(
      opener.openExternal("https://gitlab.com/o/r/-/merge_requests/new"),
    ).rejects.toThrow(COMPARE_URL_OPEN_FAILED);
  });
});
