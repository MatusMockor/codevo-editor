import type { AgentTurn } from "../../domain/agentThread";

export type AgentTurnTiming =
  | { readonly kind: "untimed" }
  | { readonly kind: "running"; readonly startedAtEpochMs: number }
  | { readonly kind: "elapsed"; readonly elapsedMs: number };

export const AGENT_TURN_UNTIMED: AgentTurnTiming = { kind: "untimed" };

export function agentTurnTiming(turn: AgentTurn): AgentTurnTiming {
  const status = turn.status.kind;
  if (status === "pending" || status === "running") {
    return { kind: "running", startedAtEpochMs: turn.startedAtEpochMs };
  }

  const endedAtEpochMs = turn.endedAtEpochMs;
  if (endedAtEpochMs === null) return AGENT_TURN_UNTIMED;
  if (endedAtEpochMs < turn.startedAtEpochMs) return AGENT_TURN_UNTIMED;

  return { kind: "elapsed", elapsedMs: endedAtEpochMs - turn.startedAtEpochMs };
}
