import type { AgentThread } from "./agentThread";
import { agentContextWindow } from "./agentContextWindow";

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

  for (const turn of thread.turns) {
    if (turn.status.kind === "pending" || turn.status.kind === "running") return null;
  }
  const latestUsage = agentContextWindow(thread);
  if (latestUsage === null || latestUsage.usedTokens < CLAUDE_COMPACTION_CONTEXT_TOKENS)
    return null;
  return {
    key: `${thread.threadId}:${thread.updatedAtEpochMs}:${latestUsage.usedTokens}`,
    contextTokens: latestUsage.usedTokens,
  };
}
