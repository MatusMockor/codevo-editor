import type { AgentThreadStoreOwnerRequest } from "../application/agentThreadPorts";
import type { AgentHistoryTurnDeltaPlan } from "../domain/agentHistoryTurnDelta";
import { parseAgentThread, type AgentThread, type AgentTurn } from "../domain/agentThread";
import { serializeAgentHistoryTurnHeader, serializeTurnEvent } from "../domain/agentThreadWire";
import { serializeAgentTurnHaltRequests } from "../domain/agentTurnHaltRecord";
import {
  parseAgentHistoryEventsDigest,
  type AgentHistorySaveReceipt,
} from "./tauriAgentHistoryIpcContract";
import {
  validateAgentThreadStoreOwnerRequest,
  type InvokeAgentThreadStoreCommand,
} from "./tauriAgentThreadStoreIpcContract";

export const SAVE_AGENT_HISTORY_TURN_DELTA_IPC_COMMAND = "save_agent_history_turn_delta" as const;
export const AGENT_HISTORY_DELTA_REFUSAL_REASONS = [
  "baseMismatch",
  "missingBase",
  "invalidDelta",
] as const;

export interface PreparedAgentHistoryTurnDelta extends AgentThreadStoreOwnerRequest {
  readonly thread: Record<string, unknown>;
  readonly expectedRevision: number;
  readonly delta: {
    readonly baseEventCount: number;
    readonly baseEventsDigest: string;
    readonly edits: ReadonlyArray<Record<string, unknown>>;
  };
  readonly haltRequests: ReadonlyArray<Record<string, unknown>>;
}

export function prepareAgentHistoryTurnDelta(
  owner: AgentThreadStoreOwnerRequest,
  thread: AgentThread,
  projected: AgentTurn,
  plan: AgentHistoryTurnDeltaPlan,
  baseEventsDigest: string,
  expectedRevision: number,
): PreparedAgentHistoryTurnDelta {
  const request = validateAgentThreadStoreOwnerRequest(owner);
  revision(expectedRevision);
  parseAgentHistoryEventsDigest(baseEventsDigest);
  const document = serializeAgentHistoryTurnHeader(thread, projected);
  const parsed = parseAgentThread(document);
  if (parsed.owner.rootKey !== request.rootKey || parsed.owner.ownerId !== request.ownerId)
    throw new TypeError("Foreign agent history owner.");
  return {
    ...request,
    thread: document,
    expectedRevision,
    delta: {
      baseEventCount: plan.baseEventCount,
      baseEventsDigest,
      edits: plan.edits.map((edit) =>
        edit.kind === "copy"
          ? { kind: "copy", start: edit.start, count: edit.count }
          : { kind: "insert", events: edit.events.map(serializeTurnEvent) },
      ),
    },
    haltRequests: serializeAgentTurnHaltRequests([projected]),
  };
}

export async function savePreparedAgentHistoryTurnDelta(
  invoke: InvokeAgentThreadStoreCommand,
  request: PreparedAgentHistoryTurnDelta,
): Promise<AgentHistorySaveReceipt | null> {
  const outcome = await invoke(SAVE_AGENT_HISTORY_TURN_DELTA_IPC_COMMAND, { request });
  return parseAgentHistoryTurnDeltaOutcome(outcome, request.expectedRevision);
}

export function parseAgentHistoryTurnDeltaOutcome(
  value: unknown,
  expectedRevision: number,
): AgentHistorySaveReceipt | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid agent history delta response.");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (record.kind === "saved" && keys === "eventsDigest,kind,revision") {
    const saved = revision(record.revision);
    if (saved !== expectedRevision + 1) throw new TypeError("Invalid agent history save revision.");
    return { revision: saved, eventsDigest: parseAgentHistoryEventsDigest(record.eventsDigest) };
  }
  if (
    record.kind === "needsFullSave" &&
    keys === "kind,reason" &&
    AGENT_HISTORY_DELTA_REFUSAL_REASONS.some((reason) => reason === record.reason)
  )
    return null;
  throw new TypeError("Invalid agent history delta response.");
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError("Invalid history revision.");
  return value as number;
}
