import { boundedUtf8Text } from "../domain/agentOutput/utf8Text";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  agentShipStatus,
  isAgentShipBusy,
  type AgentShipAvailability,
  type AgentShipIntegrationMode,
  type AgentShipState,
} from "../domain/agentShip";
import { UNTITLED_AGENT_THREAD_TITLE, type AgentThread } from "../domain/agentThread";
import type { GitShipRemote, GitShipStatus } from "../domain/gitIntegration";
import type { AgentThreadView } from "./agentThreadPorts";

export type { AgentShipAvailability } from "../domain/agentShip";

export const AGENT_STILL_RUNNING_REASON = "Stop the agent first.";
export const WORKTREE_GONE_REASON = "The worktree no longer exists.";
export const NOTHING_TO_COMMIT_REASON = "Nothing to commit.";
export const COMMIT_BEFORE_PUSHING_REASON = "Commit before pushing.";
export const NO_REMOTE_REASON = "No remote is configured for this repository.";
export const PRIMARY_DIRTY_REASON = "The main checkout has uncommitted changes.";
export const PRIMARY_DETACHED_REASON = "The main checkout is detached.";
export const BEHIND_PRIMARY_REASON =
  "The branch is behind the main checkout; use Merge instead of Fast-forward.";
export const INTEGRATE_BEFORE_DELETING_REASON = "Integrate the branch before deleting it.";
export const IN_PLACE_INTEGRATE_REASON = "In-place threads have nothing to integrate.";
export const IN_PLACE_REMOVE_REASON = "In-place threads have no worktree to remove.";
export const SHIP_STEP_RUNNING_REASON = "Another ship step is already running.";
export const SHIP_STATUS_UNAVAILABLE_REASON = "The branch status is not loaded yet.";
export const NOTHING_TO_INTEGRATE_REASON = "The branch has no commits to integrate.";

const AVAILABLE: AgentShipAvailability = Object.freeze({ kind: "available" });

export function commitAvailability(
  view: AgentThreadView,
  state: AgentShipState,
): AgentShipAvailability {
  const gate = shipGate(view, state);
  if (gate !== null) return gate;
  const status = agentShipStatus(state);
  if (status === null) return blocked(SHIP_STATUS_UNAVAILABLE_REASON);
  if (status.worktree.changeCount === 0) return blocked(NOTHING_TO_COMMIT_REASON);
  return AVAILABLE;
}

export function pushAvailability(
  view: AgentThreadView,
  state: AgentShipState,
): AgentShipAvailability {
  const gate = shipGate(view, state);
  if (gate !== null) return gate;
  const status = agentShipStatus(state);
  if (status === null) return blocked(SHIP_STATUS_UNAVAILABLE_REASON);
  if (status.remote === null) return blocked(NO_REMOTE_REASON);
  if (!hasPushableCommits(state, status, status.remote)) {
    return blocked(COMMIT_BEFORE_PUSHING_REASON);
  }
  return AVAILABLE;
}

export function integrateAvailability(
  view: AgentThreadView,
  state: AgentShipState,
  mode: AgentShipIntegrationMode,
): AgentShipAvailability {
  if (view.thread.target.isolation === "in-place") return blocked(IN_PLACE_INTEGRATE_REASON);
  const gate = shipGate(view, state);
  if (gate !== null) return gate;
  const status = agentShipStatus(state);
  if (status === null) return blocked(SHIP_STATUS_UNAVAILABLE_REASON);
  if (status.primary.branch === null) return blocked(PRIMARY_DETACHED_REASON);
  if (status.primary.dirty) return blocked(PRIMARY_DIRTY_REASON);
  if (status.relation.aheadOfPrimary === 0) return blocked(NOTHING_TO_INTEGRATE_REASON);
  if (mode === "fastForward" && !isFastForwardable(status)) return blocked(BEHIND_PRIMARY_REASON);
  return AVAILABLE;
}

export function removeAvailability(
  view: AgentThreadView,
  state: AgentShipState,
): AgentShipAvailability {
  if (view.thread.target.isolation === "in-place") return blocked(IN_PLACE_REMOVE_REASON);
  const gate = shipGate(view, state);
  if (gate !== null) return gate;
  if (state.kind !== "integrated") return blocked(INTEGRATE_BEFORE_DELETING_REASON);
  return AVAILABLE;
}

export function reconcile(state: AgentShipState, status: GitShipStatus): AgentShipState {
  switch (state.kind) {
    case "idle":
      return { kind: "idle", status, loadingStatus: false };
    case "committed":
      if (status.worktree.head !== state.commitSha) return derivedFromStatus(status);
      return { kind: "committed", status, commitSha: state.commitSha };
    case "pushed":
      if (!isPushConfirmed(state.receipt.remote, state.receipt.branch, status)) {
        return derivedFromStatus(status);
      }
      return { kind: "pushed", status, receipt: state.receipt };
    case "integrated":
      if (!isIntegrationConfirmed(state.intoBranch, status)) return derivedFromStatus(status);
      return {
        kind: "integrated",
        status,
        mergeSha: state.mergeSha,
        intoBranch: state.intoBranch,
      };
    case "failed":
      return {
        kind: "failed",
        status,
        failure: state.failure,
        resumeFrom: state.resumeFrom,
      };
    case "committing":
    case "pushing":
    case "integrating":
    case "removingWorktree":
    case "worktreeRemoved":
      return state;
    default:
      return unsupportedState(state);
  }
}

export function defaultCommitMessage(thread: AgentThread): string {
  const title = boundedUtf8Text(thread.title, MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES).trim();
  if (title === "") return UNTITLED_AGENT_THREAD_TITLE;
  return title;
}

export function defaultIntegrationMode(status: GitShipStatus): AgentShipIntegrationMode {
  if (isFastForwardable(status)) return "fastForward";
  return "merge";
}

function shipGate(view: AgentThreadView, state: AgentShipState): AgentShipAvailability | null {
  if (view.lifecycle === "running") return blocked(AGENT_STILL_RUNNING_REASON);
  if (view.worktreeRemoved || view.worktreeMissing) return blocked(WORKTREE_GONE_REASON);
  if (state.kind === "worktreeRemoved") return blocked(WORKTREE_GONE_REASON);
  if (isAgentShipBusy(state)) return blocked(SHIP_STEP_RUNNING_REASON);
  return null;
}

function hasPushableCommits(
  state: AgentShipState,
  status: GitShipStatus,
  remote: GitShipRemote,
): boolean {
  if (state.kind === "committed") return true;
  if (status.relation.aheadOfPrimary > 0) return true;
  if (remote.upstream === null) return false;
  return remote.upstream.ahead > 0;
}

function isPushConfirmed(remote: string, branch: string, status: GitShipStatus): boolean {
  if (status.remote === null || status.remote.name !== remote) return false;
  if (status.worktree.branch !== branch) return false;
  if (status.remote.upstream === null) return false;
  return status.remote.upstream.ahead === 0;
}

function isIntegrationConfirmed(intoBranch: string, status: GitShipStatus): boolean {
  if (status.primary.branch !== intoBranch) return false;
  return status.relation.aheadOfPrimary === 0;
}

function derivedFromStatus(status: GitShipStatus): AgentShipState {
  if (status.relation.aheadOfPrimary > 0) {
    return { kind: "committed", status, commitSha: status.worktree.head };
  }
  return { kind: "idle", status, loadingStatus: false };
}

function isFastForwardable(status: GitShipStatus): boolean {
  return status.relation.fastForwardable && status.relation.behindPrimary === 0;
}

function blocked(reason: string): AgentShipAvailability {
  return { kind: "blocked", reason };
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported agent ship state: ${JSON.stringify(state)}.`);
}
