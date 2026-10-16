import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  MAX_AGENT_SHIP_FAILURE_BYTES,
  type AgentShipFailure,
  type AgentShipStep,
  type AgentShipStepResult,
} from "../../domain/agentShip";
import type { AgentThreadIntegration } from "../../domain/agentThread";
import { STALE_COMMIT_SELECTION_MESSAGE } from "../../domain/gitCommitSelection";
import { MAX_GIT_INTEGRATION_MESSAGE_BYTES } from "../../domain/gitIntegration";
import { errorMessageOf } from "../agentProjectAuthority";

const PUSH_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "noRemote",
  "rejected",
  "authRequired",
  "gitError",
]);

export const EMPTY_RECEIPT: AgentThreadIntegration = Object.freeze({
  lastCommitSha: null,
  pushed: null,
  integrated: null,
  branchDeleted: false,
});

export const THREAD_UNAVAILABLE_MESSAGE = "This thread cannot ship changes right now.";
export const STOP_AGENT_MESSAGE = "Stop the agent before shipping its changes.";
export const MISSING_WORKTREE_MESSAGE = "The worktree no longer exists.";
export const COMMIT_MESSAGE_LIMIT_MESSAGE = `Enter a commit message of at most ${MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES} bytes.`;
export const COMMITTED_STATUS_UNAVAILABLE_MESSAGE =
  "The commit was created, but its status could not be refreshed.";
export const STEP_IN_FLIGHT_MESSAGE = "Another Git step is still running for this thread.";
export const STEP_SUCCEEDED: AgentShipStepResult = Object.freeze({ kind: "succeeded" });

export function notRun(message: string): AgentShipStepResult {
  return { kind: "notRun", message };
}

export function boundedCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed === "" || trimmed.includes("\u0000")) return null;
  if (new TextEncoder().encode(trimmed).byteLength > MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES)
    return null;
  return trimmed;
}

export function selectionFailure(kind: "empty" | "stale"): AgentShipFailure {
  if (kind === "stale") {
    return { step: "commit", reason: "staleSelection", message: STALE_COMMIT_SELECTION_MESSAGE };
  }
  return { step: "commit", reason: "nothingToCommit", message: "Nothing to commit." };
}

export function mergeMessage(branch: string, title: string): string {
  const cleanTitle = title.replace(/\p{Cc}/gu, " ").trim();
  const message = cleanTitle === "" ? `Merge ${branch}` : `Merge ${branch} (${cleanTitle})`;
  return truncateUtf8(message, MAX_GIT_INTEGRATION_MESSAGE_BYTES);
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  return new TextDecoder("utf-8").decode(encoded.subarray(0, maxBytes)).replace(/�+$/u, "");
}

export function boundedMessage(error: unknown): string {
  const message = errorMessageOf(error)
    .replace(/[^\P{Cc}\n]/gu, "")
    .trim();
  return truncateUtf8(message, MAX_AGENT_SHIP_FAILURE_BYTES);
}

export function gitErrorFailure(step: AgentShipStep, error: unknown): AgentShipFailure {
  const message = boundedMessage(error);
  switch (step) {
    case "commit":
      return { step, reason: "gitError", message };
    case "push":
      return { step, reason: "gitError", message };
    case "removeWorktree":
      return { step, reason: "gitError", message };
    case "integrate":
      return { step, reason: "gitError", message: message === "" ? "Git failed." : message };
    default:
      return unsupportedStep(step);
  }
}

export function pushFailure(error: unknown): AgentShipFailure {
  const message = boundedMessage(error);
  if (typeof error !== "object" || error === null || !("reason" in error)) {
    return { step: "push", reason: "gitError", message };
  }
  const reason = (error as { reason: unknown }).reason;
  if (typeof reason !== "string" || !PUSH_FAILURE_REASONS.has(reason)) {
    return { step: "push", reason: "gitError", message };
  }
  return {
    step: "push",
    reason: reason as "noRemote" | "rejected" | "authRequired" | "gitError",
    message,
  };
}

export function branchDeleteFailure(branch: string, error: unknown): AgentShipFailure {
  const detail = boundedMessage(error);
  const notMerged = /not fully merged/iu.test(detail);
  return {
    step: "removeWorktree",
    reason: notMerged ? "branchNotMerged" : "gitError",
    message: truncateUtf8(
      `The worktree was removed, but branch ${branch} was kept. ${detail}`.trim(),
      MAX_AGENT_SHIP_FAILURE_BYTES,
    ),
  };
}

function unsupportedStep(step: never): never {
  throw new TypeError(`Unsupported agent ship step: ${String(step)}.`);
}
