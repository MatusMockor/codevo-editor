import type { AgentCliKind } from "./agentTask";
import { isTerminalAgentTurnStatus, type AgentTurn } from "./agentThread";

export type AgentCompactionState =
  | { readonly kind: "idle" }
  | { readonly kind: "compacting" }
  | { readonly kind: "failed"; readonly message: string | null };

/** Derive activity from this turn only; completion remains an explicit provider event. */
export function agentCompactionState(
  provider: AgentCliKind,
  turn: Pick<AgentTurn, "prompt" | "events" | "status">,
): AgentCompactionState {
  let state: AgentCompactionState =
    provider === "claudeCode" && /^\/compact(?:\s|$)/.test(turn.prompt.trim())
      ? { kind: "compacting" }
      : { kind: "idle" };
  for (const event of turn.events) {
    switch (event.kind) {
      case "contextCompactionStatus":
        state =
          event.status === "failed"
            ? { kind: "failed", message: event.message }
            : { kind: event.status };
        break;
      case "contextCompaction":
        state = { kind: "idle" };
        break;
      case "error":
      case "result":
        return state.kind === "failed" ? state : { kind: "idle" };
    }
  }
  return isTerminalAgentTurnStatus(turn.status) && state.kind === "compacting"
    ? { kind: "idle" }
    : state;
}
