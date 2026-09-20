import { compactPersistedAgentSubagentLifecycle } from "./agentLifecyclePersistence";
import { readAgentSubagentLifecycle, type AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import {
  agentSubagentLifecycleHasRetainedDetail,
  sameLegacyAgentSubagentLifecycle,
} from "./agentSubagentLifecycleLegacy";

export const MAX_AGENT_TURN_LIFECYCLE_RESTORES_PER_THREAD = 64;

export interface AgentTurnLifecycleSubject {
  readonly turnId: string;
  readonly settled: boolean;
  readonly subagentLifecycle?: AgentSubagentLifecycle;
}

export interface AgentTurnLoggedLifecycle {
  readonly turnId: string;
  readonly lifecycle: AgentSubagentLifecycle | null;
  readonly lifecycleOmitted: boolean;
  readonly sealed: boolean;
}

export interface AgentTurnLifecycleStep {
  readonly turnId: string;
  readonly lifecycle: AgentSubagentLifecycle;
}

export interface AgentTurnLifecycleRestorePlan {
  readonly restore: ReadonlyArray<AgentTurnLifecycleStep>;
  readonly migrate: ReadonlyArray<AgentTurnLifecycleStep>;
}

export function restorableAgentTurnLifecycle(
  current: AgentSubagentLifecycle | undefined,
  logged: AgentSubagentLifecycle,
): AgentSubagentLifecycle | null {
  if (current === undefined) return null;
  if (agentSubagentLifecycleHasRetainedDetail(current)) return null;
  const validated = readAgentSubagentLifecycle(logged);
  if (validated === undefined) return null;
  const compact = compactPersistedAgentSubagentLifecycle(validated);
  if (
    compact !== undefined &&
    sameLegacyAgentSubagentLifecycle(current, compact) &&
    !sameLegacyAgentSubagentLifecycle(current, validated)
  )
    return validated;
  if (!agentSubagentLifecycleHasRetainedDetail(validated)) return null;
  if (!sameLegacyAgentSubagentLifecycle(current, validated)) return null;
  return validated;
}

export function agentThreadNeedsLoggedLifecycles(
  turns: ReadonlyArray<AgentTurnLifecycleSubject>,
): boolean {
  return turns.some((turn) => turn.settled && turn.subagentLifecycle !== undefined);
}

export function planAgentTurnLifecycleRestore(
  turns: ReadonlyArray<AgentTurnLifecycleSubject>,
  logged: ReadonlyArray<AgentTurnLoggedLifecycle>,
): AgentTurnLifecycleRestorePlan {
  const byTurn = new Map(logged.map((entry) => [entry.turnId, entry]));
  const restore: AgentTurnLifecycleStep[] = [];
  const migrate: AgentTurnLifecycleStep[] = [];
  for (const turn of turns.slice(-MAX_AGENT_TURN_LIFECYCLE_RESTORES_PER_THREAD)) {
    const current = turn.subagentLifecycle;
    if (!turn.settled || current === undefined) continue;
    const entry = byTurn.get(turn.turnId);
    if (entry?.lifecycleOmitted === true) continue;
    const stored = entry?.lifecycle ?? null;
    if (stored === null) {
      if (entry?.sealed === false) continue;
      if (agentSubagentLifecycleHasRetainedDetail(current) || current.entries.length > 1)
        migrate.push({ turnId: turn.turnId, lifecycle: current });
      continue;
    }
    const restored = restorableAgentTurnLifecycle(current, stored);
    if (restored !== null) restore.push({ turnId: turn.turnId, lifecycle: restored });
  }
  return { restore, migrate };
}
