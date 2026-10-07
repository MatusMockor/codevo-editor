import { invoke } from "@tauri-apps/api/core";
import type { AgentMcpServersGateway } from "../application/agentMcpServersGateway";
import {
  parseAgentMcpServers,
  parseAgentMcpServersRequest,
  type AgentMcpServers,
  type AgentMcpServersRequest,
} from "../domain/agentMcpServers";

export const GET_AGENT_MCP_SERVERS_IPC_COMMAND = "get_agent_mcp_servers" as const;

export class TauriAgentMcpServersGateway implements AgentMcpServersGateway {
  async check(request: AgentMcpServersRequest): Promise<AgentMcpServers> {
    const { repositoryRoot, provider } = parseAgentMcpServersRequest(request);
    const servers = parseAgentMcpServers(
      await invoke<unknown>(GET_AGENT_MCP_SERVERS_IPC_COMMAND, {
        request: { repositoryRoot, provider },
      }),
    );
    if (servers.provider !== provider)
      throw new TypeError("Agent MCP servers answered for a different provider.");
    return servers;
  }
}
