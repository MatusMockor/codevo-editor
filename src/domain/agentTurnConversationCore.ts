import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  type AgentTurnEvent,
} from "./agentThread";
import { capTurnTail } from "./agentThreadTailCap";
import { isAgentMainReply } from "./agentTurnTailSelection";
import { planHydratedAgentTurnEvents } from "./agentTurnHydrationCarry";

export interface AgentTurnConversationChunk {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly needsBoundary: boolean;
}

export function isAgentTurnConversationEvent(event: AgentTurnEvent): boolean {
  return event.kind === "userMessage" || isAgentMainReply(event);
}

export function agentTurnConversationChunk(
  events: ReadonlyArray<AgentTurnEvent>,
  laterNeedsBoundary: boolean,
): AgentTurnConversationChunk {
  const kept: AgentTurnEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (isAgentTurnConversationEvent(event) || precedesReply(events, index, laterNeedsBoundary)) {
      kept.push(event);
    }
  }
  const first = events[0];
  return { events: kept, needsBoundary: first !== undefined && isAgentMainReply(first) };
}

function precedesReply(
  events: ReadonlyArray<AgentTurnEvent>,
  index: number,
  laterNeedsBoundary: boolean,
): boolean {
  const next = events[index + 1];
  if (next === undefined) return laterNeedsBoundary;
  return isAgentMainReply(next);
}

export function agentTurnHydratedEvents(
  current: ReadonlyArray<AgentTurnEvent>,
  conversation: ReadonlyArray<AgentTurnEvent>,
  window: ReadonlyArray<AgentTurnEvent>,
): { readonly events: ReadonlyArray<AgentTurnEvent>; readonly truncated: boolean } {
  const range = conversation.length === 0 ? window : [...conversation, ...window];
  const planned = planHydratedAgentTurnEvents(current, range);
  const events = capTurnTail(planned, MAX_AGENT_EVENTS_PER_TURN, MAX_AGENT_EVENT_BYTES_PER_TURN);
  return { events, truncated: events !== planned };
}

export function agentTurnConversationPreserved(
  current: ReadonlyArray<AgentTurnEvent>,
  hydrated: ReadonlyArray<AgentTurnEvent>,
): boolean {
  const shown = new Set<string>();
  for (const event of hydrated) {
    const key = conversationKey(event);
    if (key !== null) shown.add(key);
  }
  return current.every((event) => {
    const key = conversationKey(event);
    return key === null || shown.has(key);
  });
}

function conversationKey(event: AgentTurnEvent): string | null {
  if (event.kind === "userMessage") return JSON.stringify([event.kind, event.text]);
  if (event.kind !== "assistantText" || event.parentToolId !== undefined) return null;
  return JSON.stringify([event.kind, event.text]);
}
