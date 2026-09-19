import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_AGENT_RUNTIME_SUBAGENTS,
  reconcileAgentRuntimeSubagents,
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentAgentsPanelProps } from "./AgentAgentsPanel";
import {
  agentAgentsPanelRowKey,
  type AgentAgentsPanelGroup,
  type AgentSubagentStatusCounts,
} from "./agentAgentsPanelPresentation";
import { createAgentElapsedTicker } from "./agentElapsedTicker";
import { agentTurnRuntimeSubagents } from "./agentRuntimeSubagentPresentation";

interface CachedTurnSubagents {
  readonly turn: AgentTurn;
  readonly subagents: AgentRuntimeSubagents;
}

interface OpenAgentsPanel {
  readonly threadId: string;
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
  readonly panel: Omit<AgentAgentsPanelProps, "modal"> | null;
}

export function agentThreadSubagentGroups(
  cache: Map<string, CachedTurnSubagents>,
  turns: ReadonlyArray<AgentTurn>,
): ReadonlyArray<AgentAgentsPanelGroup> {
  const retained = new Set<string>();
  const groups = turns.map((turn): AgentAgentsPanelGroup => {
    retained.add(turn.turnId);
    const cached = cache.get(turn.turnId);
    if (cached?.turn === turn) return { key: turn.turnId, subagents: cached.subagents };
    const subagents = reconcileAgentRuntimeSubagents(
      cached?.subagents ?? null,
      agentTurnRuntimeSubagents(turn),
    );
    cache.set(turn.turnId, { turn, subagents });
    return { key: turn.turnId, subagents };
  });
  for (const turnId of [...cache.keys()]) {
    if (!retained.has(turnId)) cache.delete(turnId);
  }
  return groups;
}

export function useAgentThreadAgents(
  threadId: string,
  turns: ReadonlyArray<AgentTurn>,
): AgentThreadAgents {
  const [cache] = useState(() => new Map<string, CachedTurnSubagents>());
  const [ticker] = useState(() => createAgentElapsedTicker());
  const [open, setOpen] = useState<OpenAgentsPanel | null>(null);
  if (open !== null && open.threadId !== threadId) setOpen(null);
  const groups = useMemo(() => agentThreadSubagentGroups(cache, turns), [cache, turns]);
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
        if (agent.elapsed.kind !== "live") continue;
        ticker.observe(
          agentAgentsPanelRowKey(group.key, agent.id),
          agent.elapsed.observedDurationMs,
        );
      }
    }
  }, [groups, ticker]);

  const openPanel = useCallback(() => setOpen({ threadId }), [threadId]);
  const closePanel = useCallback(() => setOpen(null), []);
  const subagentsFor = useCallback(
    (turnId: string) => byTurn.get(turnId) ?? EMPTY_AGENT_RUNTIME_SUBAGENTS,
    [byTurn],
  );
  const panelOpen = open !== null && open.threadId === threadId;
  const panel = useMemo(
    () => (panelOpen ? { groups, onClose: closePanel, autoFocus: true, ticker } : null),
    [panelOpen, groups, closePanel, ticker],
  );
  return { subagentsFor, threadId, groups, tracked, working, counts, truncated, openPanel, panel };
}
