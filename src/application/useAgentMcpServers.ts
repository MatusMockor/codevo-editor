import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  agentMcpServersProjectOfKey,
  agentMcpServersTarget,
  type AgentMcpServersProject,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import type { AgentCliKind } from "../domain/agentTask";
import type { RemoteRunnerServer } from "../domain/remoteRunner";
import {
  NO_AGENT_MCP_SERVER_HOSTS,
  type AgentMcpConnectedServer,
  type AgentMcpServerHosts,
  type AgentMcpServerProjects,
} from "./agentMcpServerProjects";
import type { AgentMcpServersProjectChoice } from "./agentMcpServersProjectChoice";
import {
  IDLE_AGENT_MCP_SERVERS_STATE,
  type AgentMcpServersState,
  type AgentMcpServersStore,
} from "./agentMcpServersStore";

type ConnectableServer = Pick<RemoteRunnerServer, "id" | "name" | "connected">;

export function useAgentMcpServersTarget(
  projectKey: string | null,
  provider: AgentCliKind,
): AgentMcpServersTarget | null {
  return useMemo(
    () =>
      agentMcpServersTarget(
        projectKey === null ? null : agentMcpServersProjectOfKey(projectKey),
        provider,
      ),
    [projectKey, provider],
  );
}

export function useAgentMcpServersState(
  store: AgentMcpServersStore | null,
  target: AgentMcpServersTarget | null,
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
): AgentMcpServersProject | null {
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

export function useAgentMcpServerHosts(
  serverProjects: AgentMcpServerProjects | null,
): AgentMcpServerHosts {
  const subscribe = useCallback(
    (listener: () => void) =>
      serverProjects === null ? ignoreSubscription() : serverProjects.subscribe(listener),
    [serverProjects],
  );
  const snapshot = useCallback(
    () => (serverProjects === null ? NO_AGENT_MCP_SERVER_HOSTS : serverProjects.state()),
    [serverProjects],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

export function useAgentMcpConnectedServers(
  serverProjects: AgentMcpServerProjects,
  servers: ReadonlyArray<ConnectableServer>,
): void {
  const connected = useMemo(() => connectedAgentMcpServers(servers), [servers]);
  useEffect(() => {
    serverProjects.connect(connected);
  }, [serverProjects, connected]);
  useEffect(() => () => serverProjects.connect([]), [serverProjects]);
}

export function connectedAgentMcpServers(
  servers: ReadonlyArray<ConnectableServer>,
): ReadonlyArray<AgentMcpConnectedServer> {
  return servers
    .filter((server) => server.connected)
    .map((server) => ({ id: server.id, name: server.name, connection: server }));
}

function ignoreSubscription(): () => void {
  return unsubscribeFromNothing;
}

function unsubscribeFromNothing(): void {}
