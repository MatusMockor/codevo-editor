import type { AgentMcpServers, AgentMcpServersRequest } from "../domain/agentMcpServers";

export interface AgentMcpServersGateway {
  check(request: AgentMcpServersRequest): Promise<AgentMcpServers>;
}
