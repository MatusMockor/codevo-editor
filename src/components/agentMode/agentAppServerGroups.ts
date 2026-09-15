import type { AgentTurnEvent, AgentTurnUsage } from "../../domain/agentThread";

export interface AgentAppServerGroup {
  readonly agentThreadId: string;
  readonly path: string;
  readonly state: string;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly hiddenCount: number;
  readonly sourceOffsets: ReadonlyArray<number>;
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
  revealEventIndex: number | null = null,
): ReadonlyMap<string, AgentAppServerGroup> {
  const groups = new Map<string, AgentAppServerGroup>();
  const target = revealEventIndex === null ? undefined : events[revealEventIndex];
  const targetId = target === undefined ? null : appServerGroupId(target);
  let targetOrdinal = 0;
  if (targetId !== null && revealEventIndex !== null) {
    for (let index = 0; index < revealEventIndex; index += 1) {
      const candidate = events[index];
      if (candidate?.kind === "subagentEvent" && candidate.agentThreadId === targetId)
        targetOrdinal += 1;
    }
  }
  const targetStart = Math.max(0, targetOrdinal - 128);
  const counts = new Map<string, number>();
  for (const [sourceOffset, event] of events.entries()) {
    const id = appServerGroupId(event);
    if (id === null) continue;
    const groupLimit = targetId !== null && id !== targetId && !groups.has(targetId) ? 31 : 32;
    if (!groups.has(id) && groups.size >= groupLimit) continue;
    const prior = groups.get(id) ?? {
      agentThreadId: id,
      path: "Subagent",
      state: "Activity",
      events: [],
      hiddenCount: 0,
      sourceOffsets: [],
      usage: null,
      durationMs: null,
    };
    switch (event.kind) {
      case "subagentActivity":
        groups.set(id, { ...prior, path: event.agentPath || prior.path, state: event.activity });
        break;
      case "subagentEvent": {
        const ordinal = counts.get(id) ?? 0;
        counts.set(id, ordinal + 1);
        const targeted = id === targetId;
        const retain = !targeted || (ordinal >= targetStart && ordinal < targetStart + 256);
        const retained = retain ? [...prior.events.slice(-255), event.event] : prior.events;
        groups.set(id, {
          ...prior,
          events: retained,
          sourceOffsets: retain
            ? [...prior.sourceOffsets.slice(-255), sourceOffset]
            : prior.sourceOffsets,
          hiddenCount: ordinal + 1 - retained.length,
        });
        break;
      }
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
