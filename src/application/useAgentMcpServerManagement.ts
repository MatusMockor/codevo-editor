import { useCallback, useSyncExternalStore } from "react";
import type { AgentMcpServersTarget } from "../domain/agentMcpServersTarget";
import type { AgentMcpServerManagementSupport } from "./agentMcpServerManagementGateway";
import {
  IDLE_AGENT_MCP_SERVER_ACTIVITY,
  type AgentMcpServerActivity,
  type AgentMcpServerManagementStore,
} from "./agentMcpServerManagementStore";
import type { AgentMcpServersSurface } from "./agentMcpServersSurface";

type ManagementSurface = Pick<AgentMcpServersSurface, "management" | "serverProjects">;

export function useAgentMcpServerManagementSupport(
  surface: ManagementSurface | null,
  target: AgentMcpServersTarget | null,
): AgentMcpServerManagementSupport {
  const serverProjects = surface?.serverProjects ?? null;
  const management = surface?.management ?? null;
  const subscribe = useCallback(
    (listener: () => void) =>
      serverProjects === null ? unsubscribeFromNothing : serverProjects.subscribe(listener),
    [serverProjects],
  );
  const snapshot = useCallback(
    (): AgentMcpServerManagementSupport =>
      management === null || target === null ? "unsupported" : management.support(target),
    [management, target],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

export function useAgentMcpServerActivity(
  management: AgentMcpServerManagementStore | null,
  target: AgentMcpServersTarget | null,
  name: string | null,
): AgentMcpServerActivity {
  const subscribe = useCallback(
    (listener: () => void) =>
      management === null ? unsubscribeFromNothing : management.subscribe(listener),
    [management],
  );
  const snapshot = useCallback(
    () =>
      management === null || target === null || name === null
        ? IDLE_AGENT_MCP_SERVER_ACTIVITY
        : management.activity(target, name),
    [management, target, name],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

function unsubscribeFromNothing(): void {}
