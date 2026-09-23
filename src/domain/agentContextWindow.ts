import type { AgentThread, AgentTurn, AgentTurnEvent } from "./agentThread";

export interface AgentContextWindow {
  readonly observedAtEpochMs?: number;
  readonly usedTokens: number;
  readonly contextWindow: number;
}

/** Latest measured main request occupancy; result totals and subagents never count. */
export function agentContextWindow(
  thread: AgentThread | null,
  loggedWindow: AgentContextWindow | null = null,
): AgentContextWindow | null {
  if (thread === null) return null;
  let current: AgentContextWindow | null = null;
  let primary: { model: string; inputTokens: number; observedAtEpochMs?: number } | null = null;
  const capacities = new Map<string, number>();
  // Never pair a new request with an older launch's capacity (for example a changed 1M option).
  const turn = thread.turns[thread.turns.length - 1];
  if (turn === undefined) return null;
  const provider = thread.provider.kind;
  if (turn.eventsTruncated) return settledContextWindow(provider, turn.status, loggedWindow);
  for (const event of turn.events) {
    if (invalidatesContext(provider, event)) {
      current = null;
      primary = null;
      capacities.clear();
    } else if (event.kind === "contextUsage") {
      if (event.contextWindow !== null && positive(event.contextWindow)) {
        // Bound retained model metadata even for manually constructed domain values.
        if (!capacities.has(event.model) && capacities.size >= 16)
          capacities.delete(capacities.keys().next().value!);
        capacities.set(event.model, event.contextWindow);
      }
      if (event.inputTokens !== null && nonnegative(event.inputTokens))
        primary = {
          model: event.model,
          inputTokens: event.inputTokens,
          ...observationTimestamp(event),
        };
      const capacity = primary === null ? undefined : capacities.get(primary.model);
      current =
        primary !== null && capacity !== undefined
          ? {
              usedTokens: primary.inputTokens,
              contextWindow: capacity,
              ...observationTimestamp(primary),
            }
          : null;
    } else if (provider === "codex" && event.kind === "result") {
      const usage = event.usage?.appServerUsage;
      if (usage !== undefined)
        current =
          positive(usage.contextWindow) && nonnegative(usage.last.totalTokens)
            ? { usedTokens: usage.last.totalTokens, contextWindow: usage.contextWindow }
            : null;
    }
  }
  return settledContextWindow(provider, turn.status, current);
}

function settledContextWindow(
  provider: AgentThread["provider"]["kind"],
  status: AgentTurn["status"],
  current: AgentContextWindow | null,
): AgentContextWindow | null {
  if (provider === "codex") return current;
  if (
    status.kind === "failed" ||
    status.kind === "interrupted" ||
    status.kind === "stopped" ||
    (status.kind === "exited" && status.exitCode !== 0)
  ) {
    return null;
  }
  return current;
}

function invalidatesContext(
  provider: AgentThread["provider"]["kind"],
  event: AgentTurnEvent,
): boolean {
  return (
    event.kind === "contextCompaction" ||
    event.kind === "error" ||
    (event.kind === "result" && event.isError && provider !== "codex") ||
    (event.kind === "contextCompactionStatus" && event.status !== "idle")
  );
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0;
}

/** Preserve source observation time; never manufacture freshness while projecting history. */
export function observationTimestamp(value: { readonly observedAtEpochMs?: number }): {
  readonly observedAtEpochMs?: number;
} {
  return nonnegative(value.observedAtEpochMs) ? { observedAtEpochMs: value.observedAtEpochMs } : {};
}
