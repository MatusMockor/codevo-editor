import type { AgentTurnEvent } from "./agentThread";
import {
  MAX_PERSISTED_AGENT_EVENTS_PER_TURN,
  persistedAgentEventBytes,
} from "./agentThreadTailCap";

export const MAX_AGENT_HISTORY_DELTA_EDITS = MAX_PERSISTED_AGENT_EVENTS_PER_TURN;

export type AgentHistoryEventEdit =
  | { readonly kind: "copy"; readonly start: number; readonly count: number }
  | { readonly kind: "insert"; readonly events: ReadonlyArray<AgentTurnEvent> };

export interface AgentHistoryTurnDeltaPlan {
  readonly baseEventCount: number;
  readonly edits: ReadonlyArray<AgentHistoryEventEdit>;
  readonly retainedBytes: number;
  readonly insertedBytes: number;
}

type EditDraft =
  | { readonly kind: "copy"; readonly start: number; count: number }
  | { readonly kind: "insert"; readonly events: AgentTurnEvent[] };

export function planAgentHistoryTurnDelta(
  base: ReadonlyArray<AgentTurnEvent>,
  next: ReadonlyArray<AgentTurnEvent>,
): AgentHistoryTurnDeltaPlan | null {
  if (
    next.length === 0 ||
    base.length > MAX_PERSISTED_AGENT_EVENTS_PER_TURN ||
    next.length > MAX_PERSISTED_AGENT_EVENTS_PER_TURN
  )
    return null;
  const positions = new Map<AgentTurnEvent, number>();
  base.forEach((event, index) => positions.set(event, index));
  const drafts: EditDraft[] = [];
  let retainedBytes = 0;
  let insertedBytes = 0;
  for (const event of next) {
    const bytes = persistedAgentEventBytes(event);
    const position = positions.get(event);
    const last = drafts[drafts.length - 1];
    if (position === undefined) {
      insertedBytes += bytes;
      if (last?.kind === "insert") last.events.push(event);
      else drafts.push({ kind: "insert", events: [event] });
      continue;
    }
    retainedBytes += bytes;
    if (last?.kind === "copy" && last.start + last.count === position) last.count += 1;
    else drafts.push({ kind: "copy", start: position, count: 1 });
  }
  if (drafts.length > MAX_AGENT_HISTORY_DELTA_EDITS) return null;
  return { baseEventCount: base.length, edits: drafts, retainedBytes, insertedBytes };
}
