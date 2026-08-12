import { describe, expect, it, vi } from "vitest";
import { TauriGitWorktreeGateway } from "./tauriGitWorktreeGateway";
import type { InvokeGitWorktreeCommand } from "./tauriGitWorktreeIpcContract";

const repositoryRoot = "/repository";
const descriptor = {
  worktreePath: "/repository/.worktrees/agt-1",
  branch: "agent/agt-1",
  head: "0123456789abcdef",
  isPrimary: false,
  locked: false,
  prunable: false,
};

describe("TauriGitWorktreeGateway", () => {
  it("delegates all worktree operations through the contract", async () => {
    const receipt = {
      worktreePath: descriptor.worktreePath,
      branch: descriptor.branch,
      trusted: true,
    };
    const invoke = vi
      .fn<InvokeGitWorktreeCommand>()
      .mockResolvedValueOnce([descriptor])
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([descriptor.worktreePath]);
    const gateway = new TauriGitWorktreeGateway(invoke, () => true);
    await expect(gateway.listWorktrees(repositoryRoot)).resolves.toEqual([descriptor]);
    await expect(gateway.addAgentWorktree(repositoryRoot, "agt-123-1a2b")).resolves.toEqual(
      receipt,
    );
    await expect(
      gateway.removeWorktree(repositoryRoot, descriptor.worktreePath, false),
    ).resolves.toBeUndefined();
    await expect(gateway.pruneWorktrees(repositoryRoot)).resolves.toEqual([
      descriptor.worktreePath,
    ]);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("returns empty read defaults outside Tauri", async () => {
    const invoke = vi.fn<InvokeGitWorktreeCommand>();
    const gateway = new TauriGitWorktreeGateway(invoke, () => false);
    await expect(gateway.listWorktrees(repositoryRoot)).resolves.toEqual([]);
    await expect(gateway.pruneWorktrees(repositoryRoot)).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a clipped worktree list instead of presenting it as complete", async () => {
    const invoke = vi.fn<InvokeGitWorktreeCommand>().mockResolvedValue(
      Array.from({ length: 17 }, (_, index) => ({
        ...descriptor,
        worktreePath: `${descriptor.worktreePath}-${index}`,
      })),
    );
    const gateway = new TauriGitWorktreeGateway(invoke, () => true);
    await expect(gateway.listWorktrees(repositoryRoot)).rejects.toThrow("truncated");
  });

  it("no-ops removal outside Tauri", async () => {
    const invoke = vi.fn<InvokeGitWorktreeCommand>();
    const gateway = new TauriGitWorktreeGateway(invoke, () => false);
    await expect(
      gateway.removeWorktree(repositoryRoot, descriptor.worktreePath, true),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects receipt-producing add outside Tauri", async () => {
    const invoke = vi.fn<InvokeGitWorktreeCommand>();
    const gateway = new TauriGitWorktreeGateway(invoke, () => false);
    await expect(gateway.addAgentWorktree(repositoryRoot, "agt-123-1a2b")).rejects.toThrow(
      "Git unavailable.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
