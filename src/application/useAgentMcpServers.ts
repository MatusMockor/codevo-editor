import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentMcpServersRequest, type AgentMcpServersRequest } from "../domain/agentMcpServers";
import type { AgentCliKind } from "../domain/agentTask";
import type { AgentMcpServersProjectChoice } from "./agentMcpServersProjectChoice";
import {
  IDLE_AGENT_MCP_SERVERS_STATE,
  type AgentMcpServersState,
  type AgentMcpServersStore,
} from "./agentMcpServersStore";

export function useAgentMcpServersTarget(
  repositoryRoot: string | null,
  provider: AgentCliKind,
): AgentMcpServersRequest | null {
  return useMemo(
    () => agentMcpServersRequest(repositoryRoot, provider),
    [repositoryRoot, provider],
  );
}

export function useAgentMcpServersState(
  store: AgentMcpServersStore | null,
  target: AgentMcpServersRequest | null,
): AgentMcpServersState {
  const subscribe = useCallback(
    (listener: () => void) =>
      store === null || target === null ? ignoreSubscription() : store.subscribe(target, listener),
    [store, target],
  );
  const snapshot = useCallback(
    () => (store === null || target === null ? IDLE_AGENT_MCP_SERVERS_STATE : store.state(target)),
    [store, target],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

export function useAgentMcpServersChosenProject(
  choice: AgentMcpServersProjectChoice | null,
  scope: string | null,
): string | null {
  const subscribe = useCallback(
    (listener: () => void) => (choice === null ? ignoreSubscription() : choice.subscribe(listener)),
    [choice],
  );
  const snapshot = useCallback(
    () => (choice === null ? null : choice.chosen(scope)),
    [choice, scope],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

function ignoreSubscription(): () => void {
  return unsubscribeFromNothing;
}

function unsubscribeFromNothing(): void {}
