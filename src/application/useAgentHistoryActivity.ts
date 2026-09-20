import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";

export interface AgentHistoryActivitySource {
  readonly scope: AgentTurnLogScope;
  readonly generation: number;
  readonly leaseToken: number | null;
  readPage(request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage>;
}

type ActivityState =
  | { readonly kind: "latest" }
  | { readonly kind: "loading"; readonly page: AgentTurnLogPage | null }
  | { readonly kind: "ready"; readonly page: AgentTurnLogPage }
  | {
      readonly kind: "failed";
      readonly page: AgentTurnLogPage | null;
      readonly anchor: AgentTurnLogAnchor;
    };
interface OwnedState {
  readonly identity: string;
  readonly state: ActivityState;
}
const LATEST: ActivityState = { kind: "latest" };

/** One display-only event page; never writes into authoritative turn state. */
export function useAgentHistoryActivity(source: AgentHistoryActivitySource | null) {
  const identity = sourceIdentity(source);
  const currentSource = useRef(source);
  const current = useRef<OwnedState | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const [owned, setOwned] = useState<OwnedState | null>(null);
  useLayoutEffect(() => {
    currentSource.current = source;
    if (current.current !== null && current.current.identity !== identity) {
      epoch.current += 1;
      current.current = null;
      setOwned(null);
    }
  }, [identity, source]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);
  const latest = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setOwned(null);
  }, []);
  const read = useCallback(async (anchor: AgentTurnLogAnchor): Promise<void> => {
    const source = currentSource.current;
    const identity = sourceIdentity(source);
    if (!mounted.current || source === null || identity === null) return;
    const previous = current.current?.state;
    if (previous?.kind === "loading") return;
    const page = previous && previous.kind !== "latest" ? previous.page : null;
    const ticket = ++epoch.current;
    const publish = (state: ActivityState) => {
      const next = { identity, state };
      current.current = next;
      setOwned(next);
    };
    const owns = () =>
      mounted.current &&
      ticket === epoch.current &&
      sourceIdentity(currentSource.current) === identity;
    publish({ kind: "loading", page });
    try {
      const result = await source.readPage({
        scope: source.scope,
        anchor,
        maxEvents: AGENT_TURN_LOG_LIMITS.pageEvents,
        maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
      });
      if (!owns()) return;
      if (
        result.entries.length > AGENT_TURN_LOG_LIMITS.pageEvents ||
        (result.entries.length > 0 &&
          ((anchor.at === "before" && result.lastSeq >= anchor.seq) ||
            (anchor.at === "after" && result.firstSeq <= anchor.seq))) ||
        (result.entries.length === 0 && (result.hasEarlier || result.hasLater))
      )
        throw new TypeError("Saved activity page did not advance.");
      publish({ kind: "ready", page: result });
    } catch {
      if (!owns()) return;
      publish({ kind: "failed", page, anchor });
    }
  }, []);
  const state = owned?.identity === identity ? owned.state : LATEST;
  return { state, read, latest };
}

function sourceIdentity(source: AgentHistoryActivitySource | null): string | null {
  if (source === null) return null;
  return JSON.stringify([
    source.scope.rootKey,
    source.scope.ownerId,
    source.scope.threadId,
    source.scope.turnId,
    source.generation,
    source.leaseToken,
  ]);
}
