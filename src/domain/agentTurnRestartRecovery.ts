import type { AgentTurn, AgentTurnStatus } from "./agentThread";

/** A provider result ends the foreground turn independently of its host process. */
export function recoverAgentTurnResultStatus(turn: AgentTurn): AgentTurnStatus | null {
  if (
    turn.status.kind !== "running" &&
    turn.status.kind !== "pending" &&
    turn.status.kind !== "interrupted"
  )
    return null;
  if (
    turn.subagentLifecycle?.truncated === true ||
    turn.subagentLifecycle?.entries.some((entry) => entry.state === "running")
  )
    return null;
  for (let index = turn.events.length - 1; index >= 0; index -= 1) {
    const event = turn.events[index];
    switch (event.kind) {
      case "result":
        return event.isError
          ? { kind: "failed", message: "The provider reported a failed turn." }
          : { kind: "exited", exitCode: 0 };
      case "contextUsage":
      case "subagentUsage":
        continue;
      default:
        // Prose is not completion evidence. Activity after a result may belong to
        // another queued prompt; missing or ambiguous tails remain interrupted.
        return null;
    }
  }
  return null;
}
