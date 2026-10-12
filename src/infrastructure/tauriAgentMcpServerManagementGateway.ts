import { invoke } from "@tauri-apps/api/core";
import type { AgentMcpServerManagementGateway } from "../application/agentMcpServerManagementGateway";
import {
  agentMcpServerRetainedLoginId,
  parseAgentMcpServerChangeReceipt,
  parseAgentMcpServerChangeRequest,
  parseAgentMcpServerLoginIdRequest,
  parseAgentMcpServerLoginRequest,
  parseAgentMcpServerLoginStarted,
  parseAgentMcpServerLoginStatus,
  type AgentMcpServerChangeRequest,
  type AgentMcpServerLoginIdRequest,
  type AgentMcpServerLoginRequest,
  type AgentMcpServerLoginState,
  type AgentMcpServerLoginStep,
} from "../domain/agentMcpServerManagement";

export const AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS = Object.freeze({
  change: "change_agent_mcp_server",
  startLogin: "start_agent_mcp_server_login",
  loginState: "get_agent_mcp_server_login",
  cancelLogin: "cancel_agent_mcp_server_login",
} as const);

export class TauriAgentMcpServerManagementGateway implements AgentMcpServerManagementGateway {
  async change(request: AgentMcpServerChangeRequest): Promise<void> {
    const { repositoryRoot, provider, change } = parseAgentMcpServerChangeRequest(request);
    parseAgentMcpServerChangeReceipt(
      await invoke<unknown>(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS.change, {
        request: { repositoryRoot, provider, change },
      }),
    );
  }

  async startLogin(request: AgentMcpServerLoginRequest): Promise<AgentMcpServerLoginStep> {
    const { repositoryRoot, provider, name, mode } = parseAgentMcpServerLoginRequest(request);
    const answer = await invoke<unknown>(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS.startLogin, {
      request: { repositoryRoot, provider, name, mode },
    });
    try {
      return parseAgentMcpServerLoginStarted(answer);
    } catch (error) {
      void cancelRetainedLogin(answer);
      throw error;
    }
  }

  async loginState(request: AgentMcpServerLoginIdRequest): Promise<AgentMcpServerLoginState> {
    const { loginId } = parseAgentMcpServerLoginIdRequest(request);
    return parseAgentMcpServerLoginStatus(
      await invoke<unknown>(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS.loginState, {
        request: { loginId },
      }),
    );
  }

  async cancelLogin(request: AgentMcpServerLoginIdRequest): Promise<void> {
    const { loginId } = parseAgentMcpServerLoginIdRequest(request);
    parseAgentMcpServerChangeReceipt(
      await invoke<unknown>(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS.cancelLogin, {
        request: { loginId },
      }),
    );
  }
}

async function cancelRetainedLogin(answer: unknown): Promise<void> {
  const loginId = agentMcpServerRetainedLoginId(answer);
  if (loginId === null) return;
  try {
    await invoke<unknown>(AGENT_MCP_SERVER_MANAGEMENT_IPC_COMMANDS.cancelLogin, {
      request: { loginId },
    });
  } catch {
    return;
  }
}
