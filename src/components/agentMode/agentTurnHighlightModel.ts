import type { AgentItemHighlight } from "./AgentAssistantText";
import { agentTurnEventIndexFromKey } from "./agentTurnItemKeys";

export type AgentTurnHighlightCursor =
  | { readonly kind: "prompt"; readonly occurrence: number }
  | { readonly kind: "event"; readonly eventIndex: number; readonly occurrence: number };

export interface AgentTurnHighlight {
  readonly query: string;
  readonly current: AgentTurnHighlightCursor | null;
}

export function itemHighlight(
  highlight: AgentTurnHighlight | null,
  key: string,
  firstEventOffset = 0,
): AgentItemHighlight | null {
  if (highlight === null || highlight.query === "") return null;
  const eventIndex = agentTurnEventIndexFromKey(key, firstEventOffset);
  const cursor = highlight.current;
  if (cursor === null || cursor.kind !== "event" || cursor.eventIndex !== eventIndex) {
    return { query: highlight.query, current: null };
  }
  return { query: highlight.query, current: cursor.occurrence };
}
