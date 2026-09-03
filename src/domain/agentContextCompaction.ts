import type { AgentThread, AgentTurnEvent } from "./agentThread";

export const CLAUDE_COMPACTION_CONTEXT_TOKENS = 100_000;
export const CLAUDE_COMPACTION_IDLE_MS = 70 * 60 * 1_000;

export interface AgentContextCompactionOffer {
  readonly key: string;
  readonly contextTokens: number;
}

export function agentContextCompactionOffer(
  thread: AgentThread | null,
  nowEpochMs: number,
): AgentContextCompactionOffer | null {
  if (thread === null || thread.archived) return null;
  if (thread.provider.kind !== "claudeCode" || thread.provider.sessionId === null) return null;
  if (nowEpochMs - thread.updatedAtEpochMs < CLAUDE_COMPACTION_IDLE_MS) return null;

  let latestUsage: { readonly index: number; readonly contextTokens: number } | null = null;
  let latestCompactionIndex = -1;
  let eventIndex = 0;
  for (const turn of thread.turns) {
    if (turn.status.kind === "pending" || turn.status.kind === "running") return null;
    for (const event of turn.events) {
      if (event.kind === "contextCompaction") latestCompactionIndex = eventIndex;
      const tokens = resultContextTokens(event);
      if (tokens !== null) latestUsage = { index: eventIndex, contextTokens: tokens };
      eventIndex += 1;
    }
  }
  if (latestUsage === null || latestUsage.index < latestCompactionIndex) return null;
  if (latestUsage.contextTokens < CLAUDE_COMPACTION_CONTEXT_TOKENS) return null;
  return {
    key: `${thread.threadId}:${thread.updatedAtEpochMs}:${latestUsage.contextTokens}`,
    contextTokens: latestUsage.contextTokens,
  };
}

function resultContextTokens(event: AgentTurnEvent): number | null {
  if (event.kind !== "result" || event.usage === null) return null;
  return event.usage.contextTokens;
}
