import { describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/git-surface-wire.json";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../domain/agentWorktreeBase";
import { MAX_WORKTREES_PER_REPOSITORY } from "../domain/gitWorktree";
import {
  ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND,
  ADD_GIT_WORKTREE_IPC_COMMAND,
  invokeAddBranchWorktreeIpc,
  invokeAddGitWorktreeIpc,
  invokeListGitWorktreesIpc,
  invokePruneGitWorktreesIpc,
  invokeRemoveGitWorktreeIpc,
  LIST_GIT_WORKTREES_IPC_COMMAND,
  PRUNE_GIT_WORKTREES_IPC_COMMAND,
  REMOVE_GIT_WORKTREE_IPC_COMMAND,
  type InvokeGitWorktreeCommand,
} from "./tauriGitWorktreeIpcContract";

const repositoryRoot = "/repository";
const descriptor = {
  worktreePath: "/repository/.worktrees/agt-1",
  branch: "agent/agt-1",
  head: "0123456789abcdef",
  isPrimary: false,
  locked: false,
  prunable: false,
};

describe("Git worktree IPC contract", () => {
  it("keeps exact command names", () => {
    expect(LIST_GIT_WORKTREES_IPC_COMMAND).toBe("list_git_worktrees");
    expect(ADD_GIT_WORKTREE_IPC_COMMAND).toBe("add_git_worktree");
    expect(REMOVE_GIT_WORKTREE_IPC_COMMAND).toBe("remove_git_worktree");
    expect(PRUNE_GIT_WORKTREES_IPC_COMMAND).toBe("prune_git_worktrees");
  });

  it("lists through validated arguments and labels inbound clipping", async () => {
    const descriptors = Array.from({ length: MAX_WORKTREES_PER_REPOSITORY + 1 }, (_, index) => ({
      ...descriptor,
      worktreePath: `${descriptor.worktreePath}-${index}`,
    }));
    const invoke = vi.fn(async () => descriptors);
    await expect(invokeListGitWorktreesIpc(invoke, repositoryRoot)).resolves.toEqual({
      worktrees: descriptors.slice(0, MAX_WORKTREES_PER_REPOSITORY),
      truncated: true,
    });
    expect(invoke).toHaveBeenCalledWith("list_git_worktrees", { repositoryRoot });
  });

  it("adds through validated arguments and preserves an untrusted receipt", async () => {
    const receipt = {
      worktreePath: descriptor.worktreePath,
      branch: "agent/agt-123-1a2b",
      trusted: false,
    };
    const invoke = vi.fn(async () => receipt);
    await expect(
      invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-123-1a2b", HEAD_WORKTREE_BASE),
    ).resolves.toEqual(receipt);
    expect(invoke).toHaveBeenCalledWith("add_git_worktree", {
      repositoryRoot,
      taskId: "agt-123-1a2b",
      base: { kind: "head" },
    });
  });

  it("sends the worktree base as a closed wire value", async () => {
    const invoke = vi.fn(async () => ({
      worktreePath: descriptor.worktreePath,
      branch: "agent/agt-base-0001",
      trusted: true,
    }));
    await invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-base-0001", {
      kind: "ref",
      ref: "refs/heads/feature",
    });
    expect(invoke).toHaveBeenCalledWith(ADD_GIT_WORKTREE_IPC_COMMAND, {
      repositoryRoot,
      taskId: "agt-base-0001",
      base: { kind: "ref", ref: "refs/heads/feature" },
    });
  });

  it.each([
    "refs/heads/--upload-pack=x",
    "refs/heads/-b",
    "HEAD~1",
    "refs/heads/a..b",
    "refs/heads/@{-1}",
    "refs/tags/v1",
    "refs/heads/ma\u0007in",
    `refs/heads/${"a".repeat(600)}`,
  ])("rejects the hostile base ref %s before IPC", async (ref) => {
    const invoke = vi.fn();
    const base = { kind: "ref", ref } as unknown as AgentWorktreeBase;
    await expect(
      invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-base-0003", base),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a base with unknown fields before IPC", async () => {
    const invoke = vi.fn();
    const base = { kind: "head", ref: "refs/heads/main" } as unknown as AgentWorktreeBase;
    await expect(
      invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-base-0004", base),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["list", "", "agt-123-1a2b"],
    ["add root", "\0", "agt-123-1a2b"],
    ["add task", repositoryRoot, "unsafe_task"],
    ["add task", repositoryRoot, "a--b"],
  ])("rejects invalid outbound %s before transport", async (kind, root, taskId) => {
    const invoke = vi.fn(async () => []);
    const operation = invokeInvalidOutboundCase(invoke, kind, root, taskId);
    await expect(operation).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("removes through validated arguments and requires a unit response", async () => {
    const invoke = vi.fn(async () => null);
    await expect(
      invokeRemoveGitWorktreeIpc(invoke, repositoryRoot, descriptor.worktreePath, true),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("remove_git_worktree", {
      repositoryRoot,
      worktreePath: descriptor.worktreePath,
      force: true,
    });
    await expect(
      invokeRemoveGitWorktreeIpc(
        vi.fn(async () => ({})),
        repositoryRoot,
        descriptor.worktreePath,
        false,
      ),
    ).rejects.toThrow("result");
  });

  it.each([
    ["", false],
    [descriptor.worktreePath, "false"],
  ])("rejects invalid remove arguments before transport %#", async (worktreePath, force) => {
    const invoke = vi.fn(async () => null);
    await expect(
      invokeRemoveGitWorktreeIpc(invoke, repositoryRoot, worktreePath, force as never),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("prunes through validated arguments and parses bounded paths", async () => {
    const invoke = vi.fn(async () => [descriptor.worktreePath]);
    await expect(invokePruneGitWorktreesIpc(invoke, repositoryRoot)).resolves.toEqual([
      descriptor.worktreePath,
    ]);
    expect(invoke).toHaveBeenCalledWith("prune_git_worktrees", { repositoryRoot });
  });

  it.each([
    ["list", { worktrees: [] }],
    ["list", [{ ...descriptor, extra: true }]],
    ["add", { worktreePath: descriptor.worktreePath, branch: descriptor.branch }],
    ["prune", [""]],
  ])("rejects malformed inbound %s responses fail-closed", async (kind, response) => {
    const invoke = vi.fn(async () => response);
    const operation = invokeMalformedInboundCase(invoke, kind);
    await expect(operation).rejects.toThrow(TypeError);
  });
});

function invokeInvalidOutboundCase(
  invoke: InvokeGitWorktreeCommand,
  kind: string,
  root: string,
  taskId: string,
): Promise<unknown> {
  if (kind === "list") {
    return invokeListGitWorktreesIpc(invoke, root);
  }
  return invokeAddGitWorktreeIpc(invoke, root, taskId, HEAD_WORKTREE_BASE);
}

function invokeMalformedInboundCase(
  invoke: InvokeGitWorktreeCommand,
  kind: string,
): Promise<unknown> {
  if (kind === "list") {
    return invokeListGitWorktreesIpc(invoke, repositoryRoot);
  }
  if (kind === "add") {
    return invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-123-1a2b", HEAD_WORKTREE_BASE);
  }
  return invokePruneGitWorktreesIpc(invoke, repositoryRoot);
}

describe("add_git_branch_worktree", () => {
  it("keeps the exact command name", () => {
    expect(ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND).toBe("add_git_branch_worktree");
  });

  it("sends the validated request and parses the receipt", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const receipt = await invokeAddBranchWorktreeIpc(
      async (command, args) => {
        calls.push({ command, args });
        return { worktreePath: "/repo/.worktrees/branch-feat-x", branch: "feat/x", trusted: true };
      },
      { repositoryRoot: "/repo", branch: "feat/x", startPoint: "main" },
    );
    expect(calls).toEqual([
      {
        command: ADD_GIT_BRANCH_WORKTREE_IPC_COMMAND,
        args: { request: { repositoryRoot: "/repo", branch: "feat/x", startPoint: "main" } },
      },
    ]);
    expect(receipt).toEqual({
      worktreePath: "/repo/.worktrees/branch-feat-x",
      branch: "feat/x",
      trusted: true,
    });
  });

  it("parses the shared contract receipt and request", async () => {
    const { branchWorktreeReceipt, requests } = wireContract;
    const calls: unknown[] = [];

    const receipt = await invokeAddBranchWorktreeIpc(async (_command, args) => {
      calls.push(args);
      return branchWorktreeReceipt;
    }, requests.addBranchWorktree);

    expect(receipt).toEqual(branchWorktreeReceipt);
    expect(receipt.trusted).toBe(false);
    expect(calls).toEqual([{ request: requests.addBranchWorktree }]);
  });

  it("rejects option-like and range names before invoking", async () => {
    const invoked: string[] = [];
    const record: InvokeGitWorktreeCommand = async (command) => {
      invoked.push(command);
      return null;
    };
    await expect(
      invokeAddBranchWorktreeIpc(record, {
        repositoryRoot: "/repo",
        branch: "--force",
        startPoint: null,
      }),
    ).rejects.toThrow();
    await expect(
      invokeAddBranchWorktreeIpc(record, {
        repositoryRoot: "/repo",
        branch: "a..b",
        startPoint: null,
      }),
    ).rejects.toThrow();
    await expect(
      invokeAddBranchWorktreeIpc(record, {
        repositoryRoot: "/repo",
        branch: "feat/x",
        startPoint: "--help",
      }),
    ).rejects.toThrow();
    await expect(
      invokeAddBranchWorktreeIpc(record, {
        repositoryRoot: "repo",
        branch: "feat/x",
        startPoint: null,
      }),
    ).rejects.toThrow();
    expect(invoked).toEqual([]);
  });

  it("rejects receipts with extra keys, relative paths or a different branch", async () => {
    const request = { repositoryRoot: "/repo", branch: "feat/x", startPoint: null };
    const respond = (value: unknown) => invokeAddBranchWorktreeIpc(async () => value, request);
    const valid = {
      worktreePath: "/repo/.worktrees/branch-feat-x",
      branch: "feat/x",
      trusted: true,
    };

    await expect(respond({ ...valid, locked: false })).rejects.toThrow();
    await expect(respond({ ...valid, worktreePath: "branch-feat-x" })).rejects.toThrow();
    await expect(
      respond({ ...valid, worktreePath: "/repo/.worktrees/branch-feat-y", branch: "feat/y" }),
    ).rejects.toThrow();
  });

  it("rejects receipts without a boolean trust verdict", async () => {
    const request = { repositoryRoot: "/repo", branch: "feat/x", startPoint: null };
    const respond = (value: unknown) => invokeAddBranchWorktreeIpc(async () => value, request);
    const worktree = { worktreePath: "/repo/.worktrees/branch-feat-x", branch: "feat/x" };

    await expect(respond(worktree)).rejects.toThrow();
    await expect(respond({ ...worktree, trusted: "true" })).rejects.toThrow();
    await expect(respond({ ...worktree, trusted: null })).rejects.toThrow();
    await expect(respond({ ...worktree, trusted: 1 })).rejects.toThrow();
  });
});
