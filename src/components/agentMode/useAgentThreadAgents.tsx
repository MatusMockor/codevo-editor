import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_AGENT_RUNTIME_SUBAGENTS,
  reconcileAgentRuntimeSubagents,
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import type { AgentTurn } from "../../domain/agentThread";
import {
  agentAgentsPanelRowKey,
  type AgentAgentsPanelGroup,
  type AgentSubagentStatusCounts,
} from "./agentAgentsPanelPresentation";
import { useAgentAgentsPanelOpener } from "./agents/agentAgentsPanelHooks";
import {
  agentElapsedObservation,
  createAgentElapsedTicker,
  type AgentElapsedTicker,
} from "./agentElapsedTicker";
import { agentTurnRuntimeSubagents } from "./agentRuntimeSubagentPresentation";

interface CachedTurnSubagents {
  readonly turn: AgentTurn;
  readonly group: AgentAgentsPanelGroup;
}

export interface AgentThreadAgents {
  subagentsFor(turnId: string): AgentRuntimeSubagents;
  readonly threadId: string;
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly tracked: boolean;
  readonly working: number;
  readonly counts: AgentSubagentStatusCounts;
  readonly truncated: boolean;
  readonly openPanel: () => void;
  readonly ticker: AgentElapsedTicker;
}

export function agentThreadSubagentGroups(
  cache: Map<string, CachedTurnSubagents>,
  turns: ReadonlyArray<AgentTurn>,
  previous: ReadonlyArray<AgentAgentsPanelGroup> | null = null,
): ReadonlyArray<AgentAgentsPanelGroup> {
  const retained = new Set<string>();
  const groups = turns.map((turn): AgentAgentsPanelGroup => {
    retained.add(turn.turnId);
    const cached = cache.get(turn.turnId);
    if (cached?.turn === turn) return cached.group;
    const subagents = reconcileAgentRuntimeSubagents(
      cached?.group.subagents ?? null,
      agentTurnRuntimeSubagents(turn),
    );
    const group =
      cached?.group.subagents === subagents ? cached.group : { key: turn.turnId, subagents };
    cache.set(turn.turnId, { turn, group });
    return group;
  });
  for (const turnId of [...cache.keys()]) {
    if (!retained.has(turnId)) cache.delete(turnId);
  }
  if (previous !== null && sameGroups(previous, groups)) return previous;
  return groups;
}

function sameGroups(
  left: ReadonlyArray<AgentAgentsPanelGroup>,
  right: ReadonlyArray<AgentAgentsPanelGroup>,
): boolean {
  return left.length === right.length && left.every((group, index) => group === right[index]);
}

export function useAgentThreadAgents(
  threadId: string,
  turns: ReadonlyArray<AgentTurn>,
): AgentThreadAgents {
  const [cache] = useState(() => new Map<string, CachedTurnSubagents>());
  const [ticker] = useState(() => createAgentElapsedTicker());
  const previousGroups = useRef<ReadonlyArray<AgentAgentsPanelGroup> | null>(null);
  const groups = useMemo(
    () => agentThreadSubagentGroups(cache, turns, previousGroups.current),
    [cache, turns],
  );
  useLayoutEffect(() => {
    previousGroups.current = groups;
  }, [groups]);
  const byTurn = useMemo(
    () => new Map(groups.map((group) => [group.key, group.subagents])),
    [groups],
  );
  const counts = useMemo(
    () => summarizeAgentRuntimeSubagents(groups.flatMap((group) => group.subagents.agents)).counts,
    [groups],
  );
  const working = counts.working;
  const truncated = useMemo(() => groups.some((group) => group.subagents.truncated), [groups]);
  const tracked = useMemo(
    () => truncated || groups.some((group) => group.subagents.agents.length > 0),
    [groups, truncated],
  );

  useEffect(() => () => ticker.dispose(), [ticker]);

  useEffect(() => {
    for (const group of groups) {
      for (const agent of group.subagents.agents) {
        const observedDurationMs = agentElapsedObservation(agent.elapsed);
        if (observedDurationMs === undefined) continue;
        ticker.observe(agentAgentsPanelRowKey(group.key, agent.id), observedDurationMs);
      }
    }
  }, [groups, ticker]);

  const openPanel = useAgentAgentsPanelOpener();
  const subagentsFor = useCallback(
    (turnId: string) => byTurn.get(turnId) ?? EMPTY_AGENT_RUNTIME_SUBAGENTS,
    [byTurn],
  );
  return useMemo(
    () => ({
      subagentsFor,
      threadId,
      groups,
      tracked,
      working,
      counts,
      truncated,
      openPanel,
      ticker,
    }),
    [subagentsFor, threadId, groups, tracked, working, counts, truncated, openPanel, ticker],
  );
}
