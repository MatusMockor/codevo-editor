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

export type AgentMcpServersRemoteGateway = RemoteAgentMcpServersGateway &
  AgentMcpServerProjectsGateway;

export interface AgentMcpServersSurface {
  readonly store: AgentMcpServersStore;
  readonly projectChoice: AgentMcpServersProjectChoice;
  readonly serverProjects: AgentMcpServerProjects;
}

export function createAgentMcpServersSurface(
  gateway: AgentMcpServersGateway,
  remote: AgentMcpServersRemoteGateway | null = null,
): AgentMcpServersSurface {
  const serverProjects = new AgentMcpServerProjectsStore(remote);
  return Object.freeze({
    store: new AgentMcpServersStatusStore(agentMcpServersSource(gateway, remote, serverProjects)),
    projectChoice: new AgentMcpServersProjectChoiceStore(),
    serverProjects,
  });
}
