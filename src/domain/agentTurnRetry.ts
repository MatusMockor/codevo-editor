import { agentLaunchIsDangerous, type AgentLaunchOptions } from "./agentLaunch";
import { agentPromptLooksClipped } from "./agentPromptClipping";
import { normalizeStoredAgentLaunch } from "./agentStoredLaunch";
import { runningTurn, type AgentThread, type AgentTurn, type AgentTurnStatus } from "./agentThread";

export const RETRY_CLIPPED_REASON =
  "This message was too long to keep in full. Send it again from the composer.";
export const RETRY_ATTACHMENTS_REASON =
  "This message had attachments. Send it again from the composer.";
export const RETRY_NO_LAUNCH_REASON =
  "The settings of this run were not saved. Send it again from the composer.";
export const RETRY_ARCHIVED_REASON = "Unarchive the thread to retry.";

export type AgentTurnRetryLaunchSource = "stored" | "lastUsed";

export type AgentTurnRetryPlan =
  | {
      readonly kind: "ready";
      readonly threadId: string;
      readonly failedTurnId: string;
      readonly prompt: string;
      readonly launch: AgentLaunchOptions;
      readonly source: AgentTurnRetryLaunchSource;
      readonly dangerous: boolean;
    }
  | { readonly kind: "unavailable"; readonly failedTurnId: string; readonly reason: string };

export type AgentTurnRetryReadyPlan = Extract<AgentTurnRetryPlan, { kind: "ready" }>;

export function agentTurnFailed(status: AgentTurnStatus): boolean {
  return status.kind === "failed" || (status.kind === "exited" && status.exitCode !== 0);
}

export function agentFailedLastTurn(thread: AgentThread): AgentTurn | null {
  if (runningTurn(thread) !== null) return null;
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined || !agentTurnFailed(last.status)) return null;
  return last;
}

export function agentTurnRetryPlan(
  thread: AgentThread,
  fallbackLaunch: AgentLaunchOptions | null,
): AgentTurnRetryPlan | null {
  const failed = agentFailedLastTurn(thread);
  if (failed === null) return null;
  const unavailable = (reason: string): AgentTurnRetryPlan => ({
    kind: "unavailable",
    failedTurnId: failed.turnId,
    reason,
  });
  if (thread.archived) return unavailable(RETRY_ARCHIVED_REASON);
  if (agentPromptLooksClipped(failed.prompt)) return unavailable(RETRY_CLIPPED_REASON);
  if ((failed.attachments?.length ?? 0) > 0) return unavailable(RETRY_ATTACHMENTS_REASON);
  const fallback = fallbackLaunch?.provider === thread.provider.kind ? fallbackLaunch : null;
  const stored = failed.launch ?? null;
  const launch = stored ?? fallback;
  if (launch === null) return unavailable(RETRY_NO_LAUNCH_REASON);
  return {
    kind: "ready",
    threadId: thread.threadId,
    failedTurnId: failed.turnId,
    prompt: failed.prompt,
    launch,
    source: stored === null ? "lastUsed" : "stored",
    dangerous: agentLaunchIsDangerous(normalizeStoredAgentLaunch(launch)),
  };
}
