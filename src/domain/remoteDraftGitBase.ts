import type { AgentTaskIsolation } from "./agentTask";
import { remoteBranchRef, type AgentWorktreeBase } from "./agentWorktreeBase";
import { REMOTE_GIT_REMOTE_NAME, type RemoteGitErrorCode } from "./remoteGitSync";
import {
  isRemoteStartBase,
  type RemoteGitBranch,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteStartBase,
} from "./remoteGitSyncWire";

export const REMOTE_START_BASE_INVALID =
  "Choose a branch on origin or the current server checkout.";
export const MAX_REMOTE_BRANCH_QUERY_LENGTH = 256;

const ORIGIN_REF_PREFIX = `refs/remotes/${REMOTE_GIT_REMOTE_NAME}/`;

export type RemoteStartBaseChoice =
  Readonly<{ kind: "ready"; base: RemoteStartBase | undefined }> | Readonly<{ kind: "invalid" }>;

export function remoteOriginBase(branch: string): AgentWorktreeBase | null {
  const ref = remoteBranchRef(REMOTE_GIT_REMOTE_NAME, branch);
  return ref === null ? null : { kind: "ref", ref };
}

export function remoteOriginBranchOf(base: AgentWorktreeBase): string | null {
  if (base.kind !== "ref" || !base.ref.startsWith(ORIGIN_REF_PREFIX)) return null;
  return base.ref.slice(ORIGIN_REF_PREFIX.length);
}

export function remoteStartBaseFor(
  isolation: AgentTaskIsolation,
  base: AgentWorktreeBase | undefined,
): RemoteStartBaseChoice {
  if (isolation !== "worktree" || base === undefined) return { kind: "ready", base: undefined };
  if (base.kind === "head") return { kind: "ready", base: { kind: "checkout-head" } };
  const branch = remoteOriginBranchOf(base);
  const start: RemoteStartBase | null = branch === null ? null : { kind: "origin-branch", branch };
  if (start === null || !isRemoteStartBase(start)) return { kind: "invalid" };
  return { kind: "ready", base: start };
}

export function remoteDefaultBase(list: RemoteGitBranchList): AgentWorktreeBase | null {
  if (list.defaultBranch === null) return null;
  return remoteOriginBase(list.defaultBranch);
}

export function remoteBranchMatches(
  list: RemoteGitBranchList,
  query: string,
): readonly RemoteGitBranch[] {
  const needle = query.trim().toLowerCase();
  const selectable = list.branches.filter((branch) => remoteOriginBase(branch.name) !== null);
  const matches =
    needle === ""
      ? selectable
      : selectable.filter((branch) => branch.name.toLowerCase().includes(needle));
  const preferred = matches.find((branch) => branch.name === list.defaultBranch);
  if (preferred === undefined) return matches;
  return [preferred, ...matches.filter((branch) => branch !== preferred)];
}

export function remoteCheckoutUpdateBlock(
  status: RemoteGitCheckoutStatus,
): RemoteGitErrorCode | null {
  if (status.inPlaceTaskActive) return "busy";
  if (status.operation !== "none") return "git_operation_in_progress";
  if (status.branch === null) return "git_detached_head";
  if (status.upstream === null) return "git_no_upstream";
  if (status.dirty.tracked > 0) return "git_dirty";
  if (status.upstream.ahead > 0 && status.upstream.behind > 0) return "git_diverged";
  return null;
}

export function remoteCheckoutDirty(status: RemoteGitCheckoutStatus): boolean {
  return status.dirty.tracked + status.dirty.untracked > 0 || status.dirty.truncated;
}
