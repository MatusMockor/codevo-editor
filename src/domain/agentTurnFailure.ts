import type { AgentCliKind } from "./agentTask";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "./agentThread";
import {
  classifyAgentProviderError,
  type AgentProviderError,
} from "./agentOutput/agentProviderError";
import { agentFailedLastTurn } from "./agentTurnRetry";

const PROVIDER_REPORTED_FAILURE = "provider_reported_failure";
const SYNTHETIC_API_ERROR_PREFIX = "API Error:";
const METADATA_EVENT_KINDS: ReadonlySet<AgentTurnEvent["kind"]> = new Set([
  "contextUsage",
  "contextCompactionStatus",
  "backgroundTask",
  "unknownLine",
]);

type FailedTurn = Pick<AgentTurn, "status" | "events">;

export function agentTurnFailureError(
  turn: FailedTurn,
  provider: AgentCliKind,
): AgentProviderError | null {
  const status = turn.status;
  if (status.kind === "exited") {
    return status.exitCode === 0 ? null : agentTurnReportedFailure(turn, provider);
  }
  if (status.kind !== "failed") return null;
  const error = classifyAgentProviderError(status.message, provider);
  if (error.message !== PROVIDER_REPORTED_FAILURE) return error;
  return agentTurnReportedFailure(turn, provider) ?? error;
}

export function agentTurnReportedFailure(
  turn: Pick<AgentTurn, "events">,
  provider: AgentCliKind,
): AgentProviderError | null {
  const events = turn.events;
  let continued = false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.kind === "result") {
      if (!event.isError) return null;
      const reported = recognized(classifyAgentProviderError(event.text, provider));
      if (reported !== null || event.text.trim() !== "") return reported;
      return precedingApiErrorNotice(events, index, provider);
    }
    if (event.kind === "assistantText") return continued ? null : apiErrorNotice(event, provider);
    if (event.kind === "toolCall") return null;
    if (event.kind !== "error") {
      continued ||= !METADATA_EVENT_KINDS.has(event.kind);
      continue;
    }
    const error = classifyAgentProviderError(event.message, provider);
    if (error.detail.kind !== "advisory") return recognized(error);
  }
  return null;
}

export function agentThreadRequiresNewThread(thread: AgentThread): boolean {
  const failed = agentFailedLastTurn(thread);
  if (failed === null) return false;
  const error = agentTurnFailureError(failed, thread.provider.kind);
  return error?.detail.kind === "conversationImagesTooLarge";
}

function precedingApiErrorNotice(
  events: ReadonlyArray<AgentTurnEvent>,
  resultIndex: number,
  provider: AgentCliKind,
): AgentProviderError | null {
  for (let index = resultIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.kind === "assistantText") return apiErrorNotice(event, provider);
    if (event.kind === "error" || METADATA_EVENT_KINDS.has(event.kind)) continue;
    return null;
  }
  return null;
}

function apiErrorNotice(
  event: Extract<AgentTurnEvent, { kind: "assistantText" }>,
  provider: AgentCliKind,
): AgentProviderError | null {
  if (event.parentToolId !== undefined) return null;
  if (!event.text.startsWith(SYNTHETIC_API_ERROR_PREFIX)) return null;
  const error = classifyAgentProviderError(event.text, provider);
  return error.detail.kind === "conversationImagesTooLarge" ? error : null;
}

function recognized(error: AgentProviderError): AgentProviderError | null {
  return error.detail.kind === "unknown" ? null : error;
}
