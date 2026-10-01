import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { persistedAgentEventBytes } from "../domain/agentThreadTailCap";
import { isAgentMainReply } from "../domain/agentTurnTailSelection";
import { agentTurnConversationChunk } from "../domain/agentTurnConversationCore";
import type { AgentTurnLogAnchor, AgentTurnLogPage } from "../domain/agentTurnLog";

export const MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES = 96;
export const MAX_AGENT_TURN_CONVERSATION_EVENTS = MAX_AGENT_EVENTS_PER_TURN;
export const MAX_AGENT_TURN_CONVERSATION_BYTES = MAX_AGENT_EVENT_BYTES_PER_TURN;

export type AgentTurnLogConversationScan =
  | { readonly kind: "dropped" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly events: ReadonlyArray<AgentTurnEvent> };

export interface AgentTurnLogConversationScanPorts {
  readonly read: (anchor: AgentTurnLogAnchor) => Promise<AgentTurnLogPage | null>;
  readonly owns: () => boolean;
}

export interface AgentTurnLogConversationStart {
  readonly beforeSeq: number;
  readonly firstEvent: AgentTurnEvent;
}

const DROPPED: AgentTurnLogConversationScan = { kind: "dropped" };
const FAILED: AgentTurnLogConversationScan = { kind: "failed" };

export async function scanAgentTurnLogConversation(
  ports: AgentTurnLogConversationScanPorts,
  start: AgentTurnLogConversationStart,
): Promise<AgentTurnLogConversationScan> {
  const chunks: Array<ReadonlyArray<AgentTurnEvent>> = [];
  let anchor: AgentTurnLogAnchor = { at: "before", seq: start.beforeSeq };
  let needsBoundary = isAgentMainReply(start.firstEvent);
  let count = 0;
  let bytes = 0;
  for (let index = 0; index < MAX_AGENT_TURN_CONVERSATION_SCAN_PAGES; index += 1) {
    const page = await ports.read(anchor);
    if (!ports.owns()) return DROPPED;
    if (page === null) return FAILED;
    const chunk = agentTurnConversationChunk(
      page.entries.map((entry) => entry.event),
      needsBoundary,
    );
    chunks.unshift(chunk.events);
    count += chunk.events.length;
    bytes += chunk.events.reduce((total, event) => total + persistedAgentEventBytes(event), 0);
    needsBoundary = chunk.needsBoundary;
    if (!page.hasEarlier) break;
    if (count >= MAX_AGENT_TURN_CONVERSATION_EVENTS) break;
    if (bytes >= MAX_AGENT_TURN_CONVERSATION_BYTES) break;
    anchor = { at: "before", seq: page.firstSeq };
  }
  return { kind: "read", events: newestWithinBudget(chunks.flat()) };
}

function newestWithinBudget(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  let start = events.length;
  let bytes = 0;
  while (start > 0 && events.length - start < MAX_AGENT_TURN_CONVERSATION_EVENTS) {
    const size = persistedAgentEventBytes(events[start - 1]!);
    if (bytes + size > MAX_AGENT_TURN_CONVERSATION_BYTES) break;
    bytes += size;
    start -= 1;
  }
  return start === 0 ? events : events.slice(start);
}
