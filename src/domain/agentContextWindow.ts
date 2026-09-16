import type { AgentThread, AgentTurnEvent } from "./agentThread";

export interface AgentContextWindow {
  readonly usedTokens: number;
  readonly contextWindow: number;
}

/** Latest measured main request occupancy; result totals and subagents never count. */
export function agentContextWindow(thread: AgentThread | null): AgentContextWindow | null {
  if (thread === null) return null;
  let current: AgentContextWindow | null = null;
  let primary: { model: string; inputTokens: number } | null = null;
  const capacities = new Map<string, number>();
  // Never pair a new request with an older launch's capacity (for example a changed 1M option).
  const turn = thread.turns[thread.turns.length - 1];
  if (turn === undefined || turn.eventsTruncated) return null;
  for (const event of turn.events) {
    if (invalidatesContext(event)) {
      current = null;
      primary = null;
      capacities.clear();
    } else if (thread.provider.kind === "claudeCode" && event.kind === "contextUsage") {
      if (event.contextWindow !== null && positive(event.contextWindow)) {
        // Bound retained model metadata even for manually constructed domain values.
        if (!capacities.has(event.model) && capacities.size >= 16)
          capacities.delete(capacities.keys().next().value!);
        capacities.set(event.model, event.contextWindow);
      }
      if (event.inputTokens !== null && nonnegative(event.inputTokens))
        primary = { model: event.model, inputTokens: event.inputTokens };
      const capacity = primary === null ? undefined : capacities.get(primary.model);
      current =
        primary !== null && capacity !== undefined
          ? { usedTokens: primary.inputTokens, contextWindow: capacity }
          : null;
    } else if (thread.provider.kind === "codex" && event.kind === "result" && !event.isError) {
      const usage = event.usage?.appServerUsage;
      if (usage !== undefined)
        current =
          positive(usage.contextWindow) && nonnegative(usage.last.totalTokens)
            ? { usedTokens: usage.last.totalTokens, contextWindow: usage.contextWindow }
            : null;
    }
  }
  if (
    turn.status.kind === "failed" ||
    turn.status.kind === "interrupted" ||
    turn.status.kind === "stopped" ||
    (turn.status.kind === "exited" && turn.status.exitCode !== 0)
  ) {
    return null;
  }
  return current;
}

function invalidatesContext(event: AgentTurnEvent): boolean {
  return (
    event.kind === "contextCompaction" ||
    event.kind === "error" ||
    (event.kind === "result" && event.isError) ||
    (event.kind === "contextCompactionStatus" && event.status !== "idle")
  );
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0;
}
