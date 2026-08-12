import {
  parseAgentWorktreeReceipt,
  parseGitWorktreeDescriptors,
  parsePrunedGitWorktreePaths,
  validateAgentWorktreeTaskId,
  validateGitWorktreePath,
  validateGitWorktreeRepositoryRoot,
  type AgentWorktreeReceipt,
} from "../domain/gitWorktree";

export const LIST_GIT_WORKTREES_IPC_COMMAND = "list_git_worktrees" as const;
export const ADD_GIT_WORKTREE_IPC_COMMAND = "add_git_worktree" as const;
export const REMOVE_GIT_WORKTREE_IPC_COMMAND = "remove_git_worktree" as const;
export const PRUNE_GIT_WORKTREES_IPC_COMMAND = "prune_git_worktrees" as const;

export type InvokeGitWorktreeCommand = (
  command: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export async function invokeListGitWorktreesIpc(
  invokeCommand: InvokeGitWorktreeCommand,
  repositoryRoot: string,
): Promise<ReturnType<typeof parseGitWorktreeDescriptors>> {
  const validatedRepositoryRoot = validateGitWorktreeRepositoryRoot(repositoryRoot);
  return parseGitWorktreeDescriptors(
    await invokeCommand(LIST_GIT_WORKTREES_IPC_COMMAND, {
      repositoryRoot: validatedRepositoryRoot,
    }),
  );
}

export async function invokeAddGitWorktreeIpc(
  invokeCommand: InvokeGitWorktreeCommand,
  repositoryRoot: string,
  taskId: string,
): Promise<AgentWorktreeReceipt> {
  const validatedRepositoryRoot = validateGitWorktreeRepositoryRoot(repositoryRoot);
  const validatedTaskId = validateAgentWorktreeTaskId(taskId);
  return parseAgentWorktreeReceipt(
    await invokeCommand(ADD_GIT_WORKTREE_IPC_COMMAND, {
      repositoryRoot: validatedRepositoryRoot,
      taskId: validatedTaskId,
    }),
  );
}

export async function invokeRemoveGitWorktreeIpc(
  invokeCommand: InvokeGitWorktreeCommand,
  repositoryRoot: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  const validatedRepositoryRoot = validateGitWorktreeRepositoryRoot(repositoryRoot);
  const validatedWorktreePath = validateGitWorktreePath(worktreePath);
  if (typeof force !== "boolean") {
    throw new TypeError("Invalid Git worktree value at force: expected a boolean.");
  }
  return invokeUnit(invokeCommand, REMOVE_GIT_WORKTREE_IPC_COMMAND, {
    repositoryRoot: validatedRepositoryRoot,
    worktreePath: validatedWorktreePath,
    force,
  });
}

export async function invokePruneGitWorktreesIpc(
  invokeCommand: InvokeGitWorktreeCommand,
  repositoryRoot: string,
): Promise<ReadonlyArray<string>> {
  const validatedRepositoryRoot = validateGitWorktreeRepositoryRoot(repositoryRoot);
  return parsePrunedGitWorktreePaths(
    await invokeCommand(PRUNE_GIT_WORKTREES_IPC_COMMAND, {
      repositoryRoot: validatedRepositoryRoot,
    }),
  );
}

async function invokeUnit(
  invokeCommand: InvokeGitWorktreeCommand,
  command: string,
  args: Readonly<Record<string, unknown>>,
): Promise<void> {
  const value = await invokeCommand(command, args);
  if (value !== null) {
    throw new TypeError("Invalid Git worktree value at result: expected null.");
  }
}
