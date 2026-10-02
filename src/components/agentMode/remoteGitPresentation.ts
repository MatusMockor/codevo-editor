import type { RemoteProjectGitNetwork } from "../../application/useRemoteProjectGit";
import type { AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import { remoteOriginBranchOf } from "../../domain/remoteDraftGitBase";
import { REMOTE_GIT_REMOTE_NAME, type RemoteGitCheckoutStatus } from "../../domain/remoteGitSync";
import { relativeAge } from "./rightPanel/git/agentGitPresentation";

export const REMOTE_CHECKOUT_LABEL = "Server checkout";
export const REMOTE_DETACHED_LABEL = "Detached HEAD";
export const REMOTE_BRANCHES_TRUNCATED_NOTE = "Only the 500 most recent branches are listed.";
export const REMOTE_UPDATE_SUCCEEDED = "Updated from origin.";

export function remoteBaseLabel(base: AgentWorktreeBase): string {
  if (base.kind === "head") return REMOTE_CHECKOUT_LABEL;
  const branch = remoteOriginBranchOf(base);
  return branch === null ? "Choose a branch" : `${REMOTE_GIT_REMOTE_NAME}/${branch}`;
}

export function remoteFetchedLabel(
  fetchedAt: string | null,
  network: RemoteProjectGitNetwork,
  nowMs: number,
): string {
  if (network.kind === "running" && network.action === "fetch") return "Fetching from origin…";
  if (network.kind === "running") return "Updating from origin…";
  if (fetchedAt === null) return "Not fetched yet";
  const epochMs = Date.parse(fetchedAt);
  if (Number.isNaN(epochMs)) return "Not fetched yet";
  const age = relativeAge(epochMs / 1000, nowMs);
  return age === "now" ? "Fetched just now" : `Fetched ${age} ago`;
}

export function remoteSyncCounts(status: RemoteGitCheckoutStatus): string | null {
  const upstream = status.upstream;
  if (upstream === null) return null;
  const parts: string[] = [];
  if (upstream.ahead > 0) parts.push(`↑${upstream.ahead}`);
  if (upstream.behind > 0) parts.push(`↓${upstream.behind}`);
  return parts.length === 0 ? null : parts.join(" ");
}

export function remoteSyncSummary(status: RemoteGitCheckoutStatus): string {
  const upstream = status.upstream;
  if (upstream === null) return "Not tracking a branch on origin";
  const { ahead, behind, ref } = upstream;
  if (ahead === 0 && behind === 0) return `Up to date with ${ref}`;
  if (ahead === 0) return `${behind} behind ${ref}`;
  if (behind === 0) return `${ahead} ahead of ${ref}`;
  return `${ahead} ahead, ${behind} behind ${ref}`;
}

export function remoteDirtySummary(status: RemoteGitCheckoutStatus): string | null {
  const { tracked, truncated, untracked } = status.dirty;
  if (tracked === 0 && untracked === 0 && !truncated) return null;
  const more = truncated ? "+" : "";
  const parts: string[] = [];
  if (tracked > 0) parts.push(`${tracked}${more} changed`);
  if (untracked > 0) parts.push(`${untracked}${more} untracked`);
  if (parts.length === 0) parts.push("changes");
  return `Uncommitted: ${parts.join(", ")}`;
}
