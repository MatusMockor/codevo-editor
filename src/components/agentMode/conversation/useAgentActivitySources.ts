import { useState } from "react";
import {
  agentHistoryActivitySourceIdentity,
  type AgentHistoryActivitySource,
} from "../../../application/useAgentHistoryActivity";
import type { AgentThreadHistorySurface } from "../../../application/useAgentThreadHistory";
import type { AgentTurn } from "../../../domain/agentThread";

type ActivitySources = ReadonlyMap<string, AgentHistoryActivitySource | null>;

interface ResolvedSource {
  readonly turnId: string;
  readonly identity: string | null;
  readonly source: AgentHistoryActivitySource | null;
}

interface CachedSources {
  readonly key: string;
  readonly sources: ActivitySources;
}

const EMPTY: CachedSources = { key: "[]", sources: new Map() };

export function useAgentActivitySources(
  history: AgentThreadHistorySurface | undefined,
  threadId: string,
  turns: ReadonlyArray<AgentTurn>,
): ActivitySources {
  const [cached, setCached] = useState<CachedSources>(EMPTY);
  const resolved = turns.map((turn) => resolveSource(history, threadId, turn));
  const key = JSON.stringify(resolved.map((entry) => [entry.turnId, entry.identity]));
  if (cached.key === key) return cached.sources;
  const next = { key, sources: stableSources(resolved, cached.sources) };
  setCached(next);
  return next.sources;
}

function resolveSource(
  history: AgentThreadHistorySurface | undefined,
  threadId: string,
  turn: AgentTurn,
): ResolvedSource {
  const source = turn.eventsTruncated
    ? (history?.activitySource?.(threadId, turn.turnId) ?? null)
    : null;
  const identity = agentHistoryActivitySourceIdentity(source);
  if (source === null || identity === null)
    return { turnId: turn.turnId, identity: null, source: null };
  return { turnId: turn.turnId, identity, source };
}

function stableSources(
  resolved: ReadonlyArray<ResolvedSource>,
  previous: ActivitySources,
): ActivitySources {
  const sources = new Map<string, AgentHistoryActivitySource | null>();
  for (const entry of resolved) {
    const earlier = previous.get(entry.turnId) ?? null;
    const same = earlier !== null && agentHistoryActivitySourceIdentity(earlier) === entry.identity;
    sources.set(entry.turnId, same ? earlier : entry.source);
  }
  return sources;
}
