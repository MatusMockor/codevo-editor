import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "./agentProject";
import type { AgentThread, AgentThreadOwner } from "./agentThread";
import type { AgentTaskIsolation } from "./agentTask";

export const MAX_PREVIOUS_WORKTREE_CANDIDATES = 1_024;

export type AgentPreviousWorktreePlacement = "local" | "remote";

export type AgentPreviousWorktreeState = "present" | "removing" | "removed" | "missing";

export interface AgentPreviousWorktreeCandidate {
  readonly threadId: string;
  readonly owner: AgentThreadOwner;
  readonly placement: AgentPreviousWorktreePlacement;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly archived: boolean;
  readonly worktreeState: AgentPreviousWorktreeState;
  readonly updatedAtEpochMs: number;
  readonly branch: string | null;
}

export interface AgentPreviousWorktreeDraft {
  readonly project: Pick<AgentProjectDescriptor, "rootKey" | "ownerId" | "runtimeOwnerIds">;
  readonly repositoryRoot: string;
}

export interface AgentPreviousWorktreeSeed {
  readonly threadId: string;
  readonly worktreePath: string;
  readonly branch: string | null;
}

interface RankedSeed {
  readonly seed: AgentPreviousWorktreeSeed;
  readonly updatedAtEpochMs: number;
}

export function resolveAgentPreviousWorktreeSeed(
  draft: AgentPreviousWorktreeDraft,
  candidates: ReadonlyArray<AgentPreviousWorktreeCandidate>,
): AgentPreviousWorktreeSeed | null {
  return latestEligibleSeed(draft, candidates, null);
}

export function resolveAgentWorktreeUser(
  draft: AgentPreviousWorktreeDraft,
  candidates: ReadonlyArray<AgentPreviousWorktreeCandidate>,
  worktreePath: string,
): AgentPreviousWorktreeSeed | null {
  return latestEligibleSeed(draft, candidates, worktreePath);
}

function latestEligibleSeed(
  draft: AgentPreviousWorktreeDraft,
  candidates: ReadonlyArray<AgentPreviousWorktreeCandidate>,
  worktreePath: string | null,
): AgentPreviousWorktreeSeed | null {
  let latest: RankedSeed | null = null;
  const bound = Math.min(candidates.length, MAX_PREVIOUS_WORKTREE_CANDIDATES);
  for (let index = 0; index < bound; index += 1) {
    const ranked = eligibleSeed(draft, candidates[index]);
    if (ranked === null) continue;
    if (worktreePath !== null && ranked.seed.worktreePath !== worktreePath) continue;
    if (latest !== null && !outranks(ranked, latest)) continue;
    latest = ranked;
  }
  return latest?.seed ?? null;
}

function eligibleSeed(
  draft: AgentPreviousWorktreeDraft,
  candidate: AgentPreviousWorktreeCandidate | undefined,
): RankedSeed | null {
  if (candidate === undefined) return null;
  if (candidate.placement !== "local") return null;
  if (candidate.isolation !== "worktree") return null;
  if (candidate.worktreePath === null) return null;
  if (candidate.archived) return null;
  if (candidate.worktreeState !== "present") return null;
  if (!Number.isFinite(candidate.updatedAtEpochMs)) return null;
  if (candidate.owner.repositoryRoot !== draft.repositoryRoot) return null;
  if (!agentProjectOwnsOwner(draft.project, candidate.owner)) return null;
  return {
    seed: {
      threadId: candidate.threadId,
      worktreePath: candidate.worktreePath,
      branch: candidate.branch,
    },
    updatedAtEpochMs: candidate.updatedAtEpochMs,
  };
}

function outranks(candidate: RankedSeed, current: RankedSeed): boolean {
  if (candidate.updatedAtEpochMs !== current.updatedAtEpochMs) {
    return candidate.updatedAtEpochMs > current.updatedAtEpochMs;
  }
  return candidate.seed.threadId < current.seed.threadId;
}

export function agentWorktreeCoTenant(
  threads: Iterable<AgentThread>,
  threadId: string,
  worktreePath: string,
): AgentThread | null {
  let tenant: AgentThread | null = null;
  for (const thread of threads) {
    if (thread.threadId === threadId) continue;
    if (thread.archived) continue;
    if (thread.target.worktreePath !== worktreePath) continue;
    if (tenant !== null && !tenantOutranks(thread, tenant)) continue;
    tenant = thread;
  }
  return tenant;
}

function tenantOutranks(candidate: AgentThread, current: AgentThread): boolean {
  if (candidate.updatedAtEpochMs !== current.updatedAtEpochMs) {
    return candidate.updatedAtEpochMs > current.updatedAtEpochMs;
  }
  return candidate.threadId < current.threadId;
}
