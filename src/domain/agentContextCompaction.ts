import type { AgentThread } from "./agentThread";
import { agentContextWindow, type AgentContextWindow } from "./agentContextWindow";

export const CLAUDE_COMPACTION_CONTEXT_TOKENS = 100_000;
export const CLAUDE_COMPACTION_IDLE_MS = 70 * 60 * 1_000;

export interface AgentContextCompactionOffer {
  readonly key: string;
  readonly contextTokens: number;
}

export function agentContextCompactionOffer(
  thread: AgentThread | null,
  nowEpochMs: number,
  loggedWindow: AgentContextWindow | null = null,
): AgentContextCompactionOffer | null {
  if (thread === null || thread.archived) return null;
  if (thread.provider.kind !== "claudeCode" || thread.provider.sessionId === null) return null;
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs <= 0) return null;

  for (const turn of thread.turns) {
    if (turn.status.kind === "pending" || turn.status.kind === "running") return null;
  }
  const latestUsage = agentContextWindow(thread, loggedWindow);
  if (latestUsage === null || latestUsage.usedTokens < CLAUDE_COMPACTION_CONTEXT_TOKENS)
    return null;
  // Legacy usage had no timestamp. A settled turn's immutable end time is a
  // conservative fallback; mutable thread metadata (rename, pin, etc.) is not.
  const lastTurn = thread.turns[thread.turns.length - 1];
  const observedAt = latestUsage.observedAtEpochMs ?? lastTurn?.endedAtEpochMs;
  if (
    observedAt === undefined ||
    observedAt === null ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    nowEpochMs - observedAt < CLAUDE_COMPACTION_IDLE_MS
  )
    return null;
  return {
    key: `${thread.owner.ownerId}:${thread.threadId}:${lastTurn?.turnId}:${observedAt}:${latestUsage.usedTokens}`,
    contextTokens: latestUsage.usedTokens,
  };
}
