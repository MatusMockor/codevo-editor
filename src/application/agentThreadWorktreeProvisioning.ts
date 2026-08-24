import {
  MAX_WORKTREES_PER_REPOSITORY,
  type AgentWorktreeReceipt,
  type GitWorktreeGateway,
} from "../domain/gitWorktree";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  isCurrentProjectOwner,
  type AgentProjectAuthority,
  type AgentProjectsRef,
  type MountedRef,
} from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export interface AgentThreadWorktreeDependencies {
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
}

export interface CreatedAgentWorktree {
  readonly receipt: AgentWorktreeReceipt;
  readonly repositoryRoot: string;
}

type WorktreeDependenciesRef = AgentProjectsRef & {
  readonly current: AgentThreadWorktreeDependencies;
};

const UNTRUSTED_REPOSITORY_ERROR_MARKER = "Agent tasks require a trusted repository.";
const UNTRUSTED_WORKTREE_NOTICE =
  "The agent worktree was not trusted, so the agent was not started.";

export async function createThreadWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentProjectAuthority,
  repositoryRoot: string,
  threadId: string,
): Promise<CreatedAgentWorktree | null> {
  const deps = dependenciesRef.current;
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return null;
  const gateway = deps.gitWorktreeGateway;
  const receipt = await attempt(() => gateway.addAgentWorktree(repositoryRoot, threadId));
  if (!receipt.ok) {
    noteTrustRejection(deps, authority, receipt.error);
    if (isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
      deps.reportError(AGENT_TASKS_SOURCE, receipt.error);
      deps.setNotice(failure(worktreeCreationFailureNotice(receipt.error)));
    }
    return null;
  }
  const created: CreatedAgentWorktree = { receipt: receipt.value, repositoryRoot };
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
    return null;
  }
  if (receipt.value.trusted) return created;
  const cleaned = await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
  if (!mountedRef.current) return null;
  deps.setNotice(
    failure(
      cleaned ? UNTRUSTED_WORKTREE_NOTICE : orphanedWorktreeNotice(UNTRUSTED_WORKTREE_NOTICE),
    ),
  );
  return null;
}

export async function compensateCreatedWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentProjectAuthority,
  created: CreatedAgentWorktree,
): Promise<boolean> {
  const removed = await attempt(() =>
    dependenciesRef.current.gitWorktreeGateway.removeWorktree(
      created.repositoryRoot,
      created.receipt.worktreePath,
      false,
    ),
  );
  if (removed.ok) return true;
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, created.repositoryRoot)) {
    return false;
  }
  dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, removed.error);
  dependenciesRef.current.setNotice(failure(orphanedWorktreeNotice("The agent was not started.")));
  return false;
}

export function noteTrustRejection(
  deps: AgentThreadWorktreeDependencies,
  authority: AgentProjectAuthority,
  error: unknown,
): void {
  if (!errorMessageOf(error).includes(UNTRUSTED_REPOSITORY_ERROR_MARKER)) return;
  deps.onProjectDispatchTrustRejected?.(authority.rootKey);
}

function worktreeCreationFailureNotice(error: unknown): string {
  const capMarker = `maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees`;
  if (errorMessageOf(error).includes(capMarker)) {
    return `The repository already holds the maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees. Remove orphaned worktrees listed in the Agents panel first.`;
  }
  return "The agent worktree could not be created.";
}

function orphanedWorktreeNotice(prefix: string): string {
  return `${prefix} Cleanup could not be confirmed, so its worktree may remain orphaned.`;
}
