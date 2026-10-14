import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AgentThreadRequestDeliveryLedger } from "../../application/agentThreadRequestDeliveryLedger";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadRequestScopeKey,
  agentThreadRequestScopeOfKey,
  agentThreadRequestViewScope,
} from "../../application/agentThreadRequestViewScope";
import { useAgentThreadRuntimeRequests } from "../../application/useAgentThreadRuntimeRequests";
import {
  remoteAgentThreadRequestTurns,
  useRemoteAgentThreadRequestSync,
  type RemoteAgentThreadRequestTarget,
} from "../../application/useRemoteAgentThreadRequestSync";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentThreadRequestFeedContext } from "./agentThreadRequestFeedContext";
import {
  AgentThreadRequestDeliveriesContext,
  AgentThreadRequestsScopeContext,
  AgentThreadRequestTurnsReportContext,
  type AgentThreadRequestsScopeValue,
} from "./agentThreadRequestsScopeContext";

interface ReportedTurns {
  readonly threadId: string;
  readonly turnIds: readonly string[];
}

const NO_TURNS: readonly AgentTurn[] = Object.freeze([]);

export function AgentThreadRequestsScope({
  children,
  thread,
}: {
  readonly children: ReactNode;
  readonly thread: AgentThreadView | null;
}) {
  const feed = useContext(AgentThreadRequestFeedContext);
  const [reported, setReported] = useState<ReportedTurns | null>(null);
  const [deliveries] = useState(() => new AgentThreadRequestDeliveryLedger());
  const threadId = thread?.thread.threadId ?? null;
  const execution = thread?.execution ?? null;
  const turns = thread?.thread.turns ?? NO_TURNS;
  const scopeKey = agentThreadRequestScopeKey(agentThreadRequestViewScope(thread));
  const scope = useMemo(() => agentThreadRequestScopeOfKey(scopeKey), [scopeKey]);
  const remoteTarget = useMemo<RemoteAgentThreadRequestTarget | null>(
    () => (execution === null || scope === null ? null : { scope, execution, turns }),
    [execution, scope, turns],
  );
  useRemoteAgentThreadRequestSync(feed, remoteTarget);
  const shown = reported !== null && reported.threadId === threadId ? reported.turnIds : null;
  const turnIds = useMemo(
    () =>
      execution === null
        ? watchedLocalTurns(turns, shown)
        : remoteAgentThreadRequestTurns(turns).map((turn) => turn.turnId),
    [execution, shown, turns],
  );
  const requests = useAgentThreadRuntimeRequests(feed, scope, turnIds);
  const reachable = execution === null || execution.reachability.kind === "reachable";
  const value = useMemo<AgentThreadRequestsScopeValue | null>(
    () =>
      feed === null || threadId === null || scope === null || scopeKey === null
        ? null
        : { threadId, scope, scopeKey, remote: execution !== null, reachable, requests },
    [execution, feed, reachable, requests, scope, scopeKey, threadId],
  );
  const report = useCallback((owner: string, next: readonly string[] | null) => {
    setReported((current) => {
      if (next === null) return current?.threadId === owner ? null : current;
      if (current?.threadId === owner && sameTurns(current.turnIds, next)) return current;
      return { threadId: owner, turnIds: next };
    });
  }, []);
  return (
    <AgentThreadRequestTurnsReportContext.Provider value={report}>
      <AgentThreadRequestDeliveriesContext.Provider value={deliveries}>
        <AgentThreadRequestsScopeContext.Provider value={value}>
          {children}
        </AgentThreadRequestsScopeContext.Provider>
      </AgentThreadRequestDeliveriesContext.Provider>
    </AgentThreadRequestTurnsReportContext.Provider>
  );
}

function watchedLocalTurns(
  turns: readonly AgentTurn[],
  shown: readonly string[] | null,
): readonly string[] {
  const recorded = turns.map((turn) => turn.turnId);
  if (shown === null) return recorded;
  const known = new Set(shown);
  return [...shown, ...recorded.filter((turnId) => !known.has(turnId))];
}

function sameTurns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((turnId, index) => turnId === right[index]);
}
