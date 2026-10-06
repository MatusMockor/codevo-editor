import { boundedUtf8Text } from "@codevo/agent-events";
import {
  MAX_AGENT_SHIP_FAILURE_BYTES,
  agentShipReducer,
  type AgentShipFailure,
  type AgentShipState,
  type AgentShipStepResult,
} from "../domain/agentShip";
import type { GitPushReceipt, GitShipStatus } from "../domain/gitIntegration";
import {
  REMOTE_GIT_REMOTE_NAME,
  remoteCompareUrl,
  remoteGitErrorMessage,
  remoteThreadBranchName,
  remoteThreadShipStatus,
  type RemoteGitErrorCode,
  type RemoteGitOperationOutcome,
  type RemoteGitPushTarget,
  type RemoteGitThreadKey,
  type RemoteThreadGitStatus,
} from "../domain/remoteGitSync";
import { isRemoteGitCommitMessage } from "../domain/remoteGitSyncWire";
import { reconcile } from "./agentShipPolicy";

export const REMOTE_SHIP_STOP_AGENT_MESSAGE = "Stop the agent before shipping its changes.";
export const REMOTE_SHIP_STEP_IN_FLIGHT_MESSAGE =
  "Another Git step is still running for this thread.";
export const REMOTE_SHIP_COMMIT_MESSAGE_INVALID =
  "Enter a commit message of at most 4096 bytes without control characters.";
export const REMOTE_SHIP_PUSH_UNCONFIRMED =
  "The push result could not be confirmed. Check the Git status before pushing again.";
export const REMOTE_SHIP_PUSH_STATUS_UNAVAILABLE =
  "The branch was pushed, but its status could not be refreshed.";

const PUBLISHED_REF_PREFIX = "refs/heads/";

export interface RemoteShipTarget {
  readonly threadId: string;
  readonly serverId: string;
  readonly runnerId: string;
  readonly conversationId: string;
  readonly repositoryKey: string | null;
  readonly running: boolean;
}

export function sameRemoteShipTarget(
  left: RemoteShipTarget | null,
  right: RemoteShipTarget,
): boolean {
  return (
    left !== null &&
    left.threadId === right.threadId &&
    left.serverId === right.serverId &&
    left.runnerId === right.runnerId &&
    left.conversationId === right.conversationId
  );
}

export function remoteShipThreadKey(target: RemoteShipTarget): RemoteGitThreadKey {
  return {
    serverId: target.serverId,
    runnerId: target.runnerId,
    taskId: target.conversationId,
  };
}

export function remoteShipStatus(
  target: RemoteShipTarget,
  status: RemoteThreadGitStatus,
): GitShipStatus {
  return remoteThreadShipStatus(status, target.conversationId, target.repositoryKey);
}

export function remoteShipStatusLoaded(
  state: AgentShipState,
  status: GitShipStatus,
): AgentShipState {
  return reconcile(agentShipReducer(state, { kind: "statusLoaded", status }), status);
}

export function remoteCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  return isRemoteGitCommitMessage(trimmed) ? trimmed : null;
}

export function remoteCommitFailure(code: RemoteGitErrorCode): AgentShipFailure {
  return {
    step: "commit",
    reason: code === "git_nothing_to_commit" ? "nothingToCommit" : "gitError",
    message: remoteGitErrorMessage(code),
  };
}

export function remotePushFailure(code: RemoteGitErrorCode): AgentShipFailure {
  return { step: "push", reason: pushReason(code), message: remoteGitErrorMessage(code) };
}

function pushReason(
  code: RemoteGitErrorCode,
): "noRemote" | "rejected" | "authRequired" | "gitError" {
  switch (code) {
    case "git_no_remote":
      return "noRemote";
    case "git_rejected":
    case "git_rejected_non_fast_forward":
      return "rejected";
    case "git_auth_failed":
      return "authRequired";
    default:
      return "gitError";
  }
}

export function remoteStepFailure(step: "commit" | "push", message: string): AgentShipFailure {
  const bounded = boundedUtf8Text(
    message.replace(/[^\P{Cc}\n]/gu, "").trim(),
    MAX_AGENT_SHIP_FAILURE_BYTES,
  );
  return { step, reason: "gitError", message: bounded === "" ? "Git failed." : bounded };
}

export type RemotePushSettlement =
  | Readonly<{ kind: "pushed"; receipt: GitPushReceipt }>
  | Readonly<{ kind: "failed"; failure: AgentShipFailure }>;

function expectedPushBranch(
  target: RemoteShipTarget,
  status: RemoteThreadGitStatus | null,
  pushTarget: RemoteGitPushTarget,
): string | null {
  if (status === null) return null;
  if (pushTarget === "base-branch") return status.base?.branch ?? null;
  return remoteThreadBranchName(status, target.conversationId);
}

export function remotePushSettlement(
  outcome: RemoteGitOperationOutcome,
  target: RemoteShipTarget,
  status: RemoteThreadGitStatus | null,
  pushTarget: RemoteGitPushTarget,
): RemotePushSettlement {
  switch (outcome.kind) {
    case "succeeded": {
      const result = outcome.result;
      const expected = expectedPushBranch(target, status, pushTarget);
      if (
        result.kind !== "push" ||
        expected === null ||
        result.remoteRef !== `${PUBLISHED_REF_PREFIX}${expected}`
      ) {
        return { kind: "failed", failure: remoteStepFailure("push", REMOTE_SHIP_PUSH_UNCONFIRMED) };
      }
      const branch = result.remoteRef.slice(PUBLISHED_REF_PREFIX.length);
      const base = status?.base ?? null;
      return {
        kind: "pushed",
        receipt: {
          remote: REMOTE_GIT_REMOTE_NAME,
          branch,
          compareUrl:
            base === null || base.branch === branch
              ? null
              : remoteCompareUrl(target.repositoryKey, base.branch, branch),
        },
      };
    }
    case "failed":
      return { kind: "failed", failure: remotePushFailure(outcome.error) };
    case "unknown":
    case "timedOut":
    case "aborted":
      return {
        kind: "failed",
        failure: remoteStepFailure("push", REMOTE_SHIP_PUSH_UNCONFIRMED),
      };
    default:
      return unsupported(outcome);
  }
}

export function notRun(message: string): AgentShipStepResult {
  return { kind: "notRun", message };
}

function unsupported(value: never): never {
  throw new TypeError(`Unsupported remote push outcome: ${JSON.stringify(value)}.`);
}
