import type { AgentMcpServersGateway } from "./agentMcpServersGateway";
import {
  AgentMcpServersProjectChoiceStore,
  type AgentMcpServersProjectChoice,
} from "./agentMcpServersProjectChoice";
import { AgentMcpServersStatusStore, type AgentMcpServersStore } from "./agentMcpServersStore";

export interface AgentMcpServersSurface {
  readonly store: AgentMcpServersStore;
  readonly projectChoice: AgentMcpServersProjectChoice;
}

export function createAgentMcpServersSurface(
  gateway: AgentMcpServersGateway,
): AgentMcpServersSurface {
  return Object.freeze({
    store: new AgentMcpServersStatusStore(gateway),
    projectChoice: new AgentMcpServersProjectChoiceStore(),
  });
}
