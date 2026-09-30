import type { GitRepositoryStatus } from "../../domain/gitRepositoryMapping";

export type AgentLiveCheckoutBranches = ReadonlyMap<string, string | null>;

export const NO_LIVE_CHECKOUT_BRANCHES: AgentLiveCheckoutBranches = new Map();

export function agentLiveCheckoutBranches(
  statuses: ReadonlyArray<GitRepositoryStatus>,
): AgentLiveCheckoutBranches {
  const branches = new Map<string, string | null>();
  for (const entry of statuses) {
    if (entry.failed || !entry.status.isRepository) continue;
    branches.set(entry.root, entry.status.branch);
  }
  return branches.size === 0 ? NO_LIVE_CHECKOUT_BRANCHES : branches;
}

export function agentLiveCheckoutBranch(
  live: AgentLiveCheckoutBranches | null | undefined,
  repositoryRoot: string | null,
): string | null {
  if (live === null || live === undefined || repositoryRoot === null) return null;
  return live.get(repositoryRoot) ?? null;
}
