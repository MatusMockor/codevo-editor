import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTaskIsolation } from "../domain/agentTask";
import type { AgentThread } from "../domain/agentThread";
import { projectByRootKey, warning, type AgentProjectAuthority } from "./agentProjectAuthority";
import type {
  AgentTasksNotice,
  AgentThreadStoreSurface,
  AgentThreadWorktreeReuse,
} from "./agentThreadPorts";
import type { AgentWorktreeStartLease, AgentWorktreeUseRegistry } from "./agentWorktreeUseRegistry";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";

export const PREVIOUS_WORKTREE_UNAVAILABLE_NOTICE =
  "The previous worktree is no longer available. Pick a checkout again.";

export interface AgentPreviousWorktreeReuseDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly store: Pick<AgentThreadStoreSurface, "currentState">;
  readonly isWorktreeMissing: (threadId: string) => boolean;
  readonly worktreeUses?: AgentWorktreeUseRegistry;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
}

export interface AgentPreviousWorktreeReuseClaim {
  readonly authority: AgentProjectAuthority;
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
  readonly reuse: AgentThreadWorktreeReuse;
}

export function admitPreviousWorktreeReuse(
  deps: AgentPreviousWorktreeReuseDependencies,
  claim: AgentPreviousWorktreeReuseClaim,
): boolean {
  if (previousWorktreeReuseIsCurrent(deps, claim)) return true;
  deps.setNotice(warning(PREVIOUS_WORKTREE_UNAVAILABLE_NOTICE));
  return false;
}

export function claimPreviousWorktree(
  deps: AgentPreviousWorktreeReuseDependencies,
  claim: AgentPreviousWorktreeReuseClaim,
): AgentWorktreeStartLease | null {
  const lease = previousWorktreeReuseIsCurrent(deps, claim)
    ? (deps.worktreeUses?.claimStart(claim.reuse.worktreePath) ?? null)
    : null;
  if (lease !== null) return lease;
  deps.setNotice(warning(PREVIOUS_WORKTREE_UNAVAILABLE_NOTICE));
  return null;
}

function previousWorktreeReuseIsCurrent(
  deps: AgentPreviousWorktreeReuseDependencies,
  claim: AgentPreviousWorktreeReuseClaim,
): boolean {
  if (claim.isolation !== "worktree") return false;
  if (deps.worktreeUses === undefined) return false;
  const project = projectByRootKey(deps.projects, claim.authority.rootKey);
  if (project === undefined || project.generation !== claim.authority.generation) return false;
  for (const thread of deps.store.currentState().threads.values()) {
    if (usesReusableWorktree(deps, project, claim, thread)) return true;
  }
  return false;
}

function usesReusableWorktree(
  deps: AgentPreviousWorktreeReuseDependencies,
  project: AgentProjectDescriptor,
  { authority, repositoryRoot, reuse }: AgentPreviousWorktreeReuseClaim,
  thread: AgentThread,
): boolean {
  if (thread.archived) return false;
  if (isRemoteAgentIdentity(thread.threadId)) return false;
  if (thread.owner.rootKey !== authority.rootKey) return false;
  if (thread.owner.repositoryRoot !== repositoryRoot) return false;
  if (thread.target.isolation !== "worktree") return false;
  if (thread.target.worktreePath !== reuse.worktreePath) return false;
  if (!agentProjectOwnsOwner(project, thread.owner)) return false;
  return !deps.isWorktreeMissing(thread.threadId);
}
