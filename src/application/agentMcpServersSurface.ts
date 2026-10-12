import {
  timerAgentMcpServerManagementScheduler,
  type AgentMcpServerManagementScheduler,
} from "./agentMcpServerManagementScheduler";
import {
  agentMcpServerManagement,
  type AgentMcpServerManagementGateway,
  type RemoteAgentMcpServerManagementGateway,
} from "./agentMcpServerManagementGateway";
import {
  AgentMcpServerManagementCoordinator,
  UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT,
  type AgentMcpServerManagementStore,
} from "./agentMcpServerManagementStore";
import {
  AgentMcpServerProjectsStore,
  type AgentMcpServerProjects,
  type AgentMcpServerProjectsGateway,
} from "./agentMcpServerProjects";
import {
  agentMcpServersSource,
  type AgentMcpServersGateway,
  type RemoteAgentMcpServersGateway,
} from "./agentMcpServersGateway";
import {
  AgentMcpServersProjectChoiceStore,
  type AgentMcpServersProjectChoice,
} from "./agentMcpServersProjectChoice";
import { AgentMcpServersStatusStore, type AgentMcpServersStore } from "./agentMcpServersStore";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";

export type AgentMcpServersRemoteGateway = RemoteAgentMcpServersGateway &
  AgentMcpServerProjectsGateway &
  RemoteAgentMcpServerManagementGateway;

export interface AgentMcpServersManagementWiring {
  readonly gateway: AgentMcpServerManagementGateway;
  readonly urlOpener: ExternalUrlOpenerPort;
  readonly scheduler?: AgentMcpServerManagementScheduler;
}

export interface AgentMcpServersSurface {
  readonly store: AgentMcpServersStore;
  readonly projectChoice: AgentMcpServersProjectChoice;
  readonly serverProjects: AgentMcpServerProjects;
  readonly management: AgentMcpServerManagementStore;
}

export function createAgentMcpServersSurface(
  gateway: AgentMcpServersGateway,
  remote: AgentMcpServersRemoteGateway | null = null,
  management: AgentMcpServersManagementWiring | null = null,
): AgentMcpServersSurface {
  const serverProjects = new AgentMcpServerProjectsStore(remote);
  const store = new AgentMcpServersStatusStore(
    agentMcpServersSource(gateway, remote, serverProjects),
  );
  return Object.freeze({
    store,
    projectChoice: new AgentMcpServersProjectChoiceStore(),
    serverProjects,
    management: managementStore(store, remote, serverProjects, management),
  });
}

function managementStore(
  statuses: AgentMcpServersStore,
  remote: AgentMcpServersRemoteGateway | null,
  serverProjects: AgentMcpServerProjectsStore,
  wiring: AgentMcpServersManagementWiring | null,
): AgentMcpServerManagementStore {
  if (wiring === null) return UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT;
  return new AgentMcpServerManagementCoordinator({
    management: agentMcpServerManagement(wiring.gateway, remote, serverProjects),
    statuses,
    urlOpener: wiring.urlOpener,
    scheduler: wiring.scheduler ?? timerAgentMcpServerManagementScheduler,
  });
}
