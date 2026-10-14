import { useEffect, useMemo, useRef } from "react";
import { isTerminalAgentTurnStatus, type AgentTurn } from "../domain/agentThread";
import type { AgentThreadRequestFeed, AgentThreadRequestScope } from "./agentThreadRequestPorts";
import type { RemoteAgentThreadExecution } from "./agentThreadPorts";
import {
  type RemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestSource,
} from "./remoteAgentThreadRequestFeed";
import type { RemoteAgentThreadRequestTurn } from "./remoteAgentThreadRequestPorts";
import {
  agentThreadRequestScopeKey,
  agentThreadRequestScopeOfKey,
} from "./agentThreadRequestViewScope";
import { remoteAgentThreadRequestControl } from "./unifiedAgentThreadRequestFeed";
import { MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS } from "./remoteAgentThreadRequestWatch";

export interface RemoteAgentThreadRequestTarget {
  readonly scope: AgentThreadRequestScope;
  readonly execution: RemoteAgentThreadExecution;
  readonly turns: readonly AgentTurn[];
}

const DEFAULT_SOURCE: RemoteAgentThreadRequestSource = "legacy";

export function remoteAgentThreadRequestTurns<Turn extends { readonly turnId: string }>(
  turns: readonly Turn[],
): readonly Turn[] {
  return turns.slice(-MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS);
}

export function remoteAgentThreadRequestDescription(
  execution: RemoteAgentThreadExecution,
  turns: readonly AgentTurn[],
): RemoteAgentThreadRequestDescription {
  const facts = execution.requests;
  return {
    source: facts?.source ?? DEFAULT_SOURCE,
    reachable: execution.reachability.kind === "reachable",
    turns: remoteAgentThreadRequestTurns(turns).map((turn): RemoteAgentThreadRequestTurn => ({
      turnId: turn.turnId,
      startedAtEpochMs: turn.startedAtEpochMs,
      interactionSequence: facts?.sequences[turn.turnId] ?? null,
      terminal: isTerminalAgentTurnStatus(turn.status),
    })),
    awaiting: facts?.awaitingApproval ?? [],
  };
}

export function useRemoteAgentThreadRequestSync(
  feed: AgentThreadRequestFeed | null,
  target: RemoteAgentThreadRequestTarget | null,
): void {
  const control = remoteAgentThreadRequestControl(feed);
  const scopeKey = agentThreadRequestScopeKey(target?.scope ?? null);
  const scope = useMemo(() => agentThreadRequestScopeOfKey(scopeKey), [scopeKey]);
  const execution = target?.execution ?? null;
  const turns = target?.turns ?? null;
  const description = useMemo(
    () =>
      execution === null || turns === null
        ? null
        : remoteAgentThreadRequestDescription(execution, turns),
    [execution, turns],
  );
  const serverId = execution?.serverId ?? null;
  const reachable = description?.reachable ?? false;
  const reachability = useRef<{ readonly serverId: string | null; readonly reachable: boolean }>({
    serverId: null,
    reachable: false,
  });

  useEffect(() => {
    if (control === null || scope === null) return undefined;
    return () => control.release(scope);
  }, [control, scope]);

  useEffect(() => {
    if (control === null || scope === null || description === null) return;
    control.describe(scope, description);
  }, [control, description, scope]);

  useEffect(() => {
    const previous = reachability.current;
    reachability.current = { serverId, reachable };
    if (control === null || serverId === null || !reachable) return;
    if (previous.serverId !== serverId || previous.reachable) return;
    control.reconnected(serverId);
  }, [control, reachable, serverId]);
}
