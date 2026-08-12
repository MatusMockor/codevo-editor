import { describe, expect, it, vi } from "vitest";
import { MAX_WORKTREES_PER_REPOSITORY } from "../domain/gitWorktree";
import {
  ADD_GIT_WORKTREE_IPC_COMMAND,
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
    await expect(invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-123-1a2b")).resolves.toEqual(
      receipt,
    );
    expect(invoke).toHaveBeenCalledWith("add_git_worktree", {
      repositoryRoot,
      taskId: "agt-123-1a2b",
    });
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
  return invokeAddGitWorktreeIpc(invoke, root, taskId);
}

function invokeMalformedInboundCase(
  invoke: InvokeGitWorktreeCommand,
  kind: string,
): Promise<unknown> {
  if (kind === "list") {
    return invokeListGitWorktreesIpc(invoke, repositoryRoot);
  }
  if (kind === "add") {
    return invokeAddGitWorktreeIpc(invoke, repositoryRoot, "agt-123-1a2b");
  }
  return invokePruneGitWorktreesIpc(invoke, repositoryRoot);
}
