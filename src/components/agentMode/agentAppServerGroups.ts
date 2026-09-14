import type { AgentTurnEvent, AgentTurnUsage } from "../../domain/agentThread";

export interface AgentAppServerGroup {
  readonly agentThreadId: string;
  readonly path: string;
  readonly state: string;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly hiddenCount: number;
  readonly usage: AgentTurnUsage | null;
  readonly durationMs: number | null;
}

export function appServerGroupId(event: AgentTurnEvent): string | null {
  switch (event.kind) {
    case "subagentActivity":
    case "subagentEvent":
    case "subagentUsage":
    case "subagentTurnDone":
      return event.agentThreadId;
    default:
      return null;
  }
}

export function appServerGroups(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyMap<string, AgentAppServerGroup> {
  const groups = new Map<string, AgentAppServerGroup>();
  for (const event of events) {
    const id = appServerGroupId(event);
    if (id === null) continue;
    if (!groups.has(id) && groups.size >= 32) continue;
    const prior = groups.get(id) ?? {
      agentThreadId: id,
      path: "Subagent",
      state: "Activity",
      events: [],
      hiddenCount: 0,
      usage: null,
      durationMs: null,
    };
    switch (event.kind) {
      case "subagentActivity":
        groups.set(id, { ...prior, path: event.agentPath || prior.path, state: event.activity });
        break;
      case "subagentEvent":
        groups.set(id, {
          ...prior,
          events: [...prior.events.slice(-255), event.event],
          hiddenCount: prior.hiddenCount + (prior.events.length >= 256 ? 1 : 0),
        });
        break;
      case "subagentUsage":
        groups.set(id, { ...prior, usage: event.usage });
        break;
      case "subagentTurnDone":
        groups.set(id, {
          ...prior,
          durationMs: event.durationMs,
          state: event.isError ? "failed" : "completed",
        });
        break;
    }
  }
  return groups;
}
