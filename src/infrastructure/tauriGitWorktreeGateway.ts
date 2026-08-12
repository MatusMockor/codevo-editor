import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentWorktreeReceipt,
  GitWorktreeDescriptor,
  GitWorktreeGateway,
} from "../domain/gitWorktree";
import {
  invokeAddGitWorktreeIpc,
  invokeListGitWorktreesIpc,
  invokePruneGitWorktreesIpc,
  invokeRemoveGitWorktreeIpc,
  type InvokeGitWorktreeCommand,
} from "./tauriGitWorktreeIpcContract";

type RuntimeDetector = () => boolean;

const invokeGitWorktreeCommand: InvokeGitWorktreeCommand = (command, args) => invoke(command, args);

export class TauriGitWorktreeGateway implements GitWorktreeGateway {
  constructor(
    private readonly invokeCommand: InvokeGitWorktreeCommand = invokeGitWorktreeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async listWorktrees(repositoryRoot: string): Promise<ReadonlyArray<GitWorktreeDescriptor>> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }
    const result = await invokeListGitWorktreesIpc(this.invokeCommand, repositoryRoot);
    if (result.truncated) {
      throw new TypeError("Invalid Git worktree result: worktree list was truncated.");
    }
    return result.worktrees;
  }

  async addAgentWorktree(repositoryRoot: string, taskId: string): Promise<AgentWorktreeReceipt> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Git unavailable.");
    }
    return invokeAddGitWorktreeIpc(this.invokeCommand, repositoryRoot, taskId);
  }

  async removeWorktree(
    repositoryRoot: string,
    worktreePath: string,
    force: boolean,
  ): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }
    return invokeRemoveGitWorktreeIpc(this.invokeCommand, repositoryRoot, worktreePath, force);
  }

  async pruneWorktrees(repositoryRoot: string): Promise<ReadonlyArray<string>> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }
    return invokePruneGitWorktreesIpc(this.invokeCommand, repositoryRoot);
  }
}
