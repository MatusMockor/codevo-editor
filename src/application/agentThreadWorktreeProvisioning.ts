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
  isCurrentTaskLaunchAuthority,
  type AgentProjectAuthority,
  type AgentLaunchProjectsRef,
  type AgentTaskLaunchAuthority,
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

type WorktreeDependenciesRef = AgentLaunchProjectsRef & {
  readonly current: AgentThreadWorktreeDependencies;
};

const TRUST_REJECTION_ERROR_MARKERS = [
  "Agent tasks require a trusted repository.",
  "Agent worktrees require a trusted repository.",
] as const;
const UNTRUSTED_WORKTREE_NOTICE =
  "The agent worktree was not trusted, so the agent was not started.";

export async function createThreadWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
  threadId: string,
): Promise<CreatedAgentWorktree | null> {
  const deps = dependenciesRef.current;
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
    return null;
  const gateway = deps.gitWorktreeGateway;
  const receipt = await attempt(() => gateway.addAgentWorktree(repositoryRoot, threadId));
  if (!receipt.ok) {
    if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
      return null;
    const currentDeps = dependenciesRef.current;
    const trustRejected = noteTrustRejection(currentDeps, authority, receipt.error);
    if (trustRejected) return null;
    currentDeps.reportError(AGENT_TASKS_SOURCE, receipt.error);
    currentDeps.setNotice(failure(worktreeCreationFailureNotice(receipt.error)));
    return null;
  }
  const created: CreatedAgentWorktree = { receipt: receipt.value, repositoryRoot };
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
    return null;
  }
  if (receipt.value.trusted) return created;
  const cleaned = await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
    return null;
  dependenciesRef.current.setNotice(
    failure(
      cleaned ? UNTRUSTED_WORKTREE_NOTICE : orphanedWorktreeNotice(UNTRUSTED_WORKTREE_NOTICE),
    ),
  );
  return null;
}

export async function compensateCreatedWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
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
): boolean {
  if (!isAgentDispatchTrustRejection(error)) return false;
  deps.onProjectDispatchTrustRejected?.(authority.rootKey);
  return true;
}

export function isAgentDispatchTrustRejection(error: unknown): boolean {
  const message = errorMessageOf(error);
  return TRUST_REJECTION_ERROR_MARKERS.some((marker) => message === marker);
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
