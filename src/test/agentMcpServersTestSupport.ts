import type { AgentMcpServersGateway } from "../application/agentMcpServersGateway";
import {
  parseAgentMcpServers,
  type AgentMcpServer,
  type AgentMcpServers,
  type AgentMcpServersRequest,
} from "../domain/agentMcpServers";
import type { AgentCliKind } from "../domain/agentTask";

interface PendingAgentMcpServersCheck {
  readonly request: AgentMcpServersRequest;
  resolve(result: AgentMcpServers): void;
  reject(reason: unknown): void;
}

export class DeferredAgentMcpServersGateway implements AgentMcpServersGateway {
  readonly checks: Array<PendingAgentMcpServersCheck> = [];

  requests(): ReadonlyArray<AgentMcpServersRequest> {
    return this.checks.map((check) => check.request);
  }

  check(request: AgentMcpServersRequest): Promise<AgentMcpServers> {
    return new Promise((resolve, reject) => {
      this.checks.push({ request, resolve, reject });
    });
  }
}

export function agentMcpServersFixture(
  provider: AgentCliKind,
  servers: ReadonlyArray<Partial<AgentMcpServer> & { readonly name: string }>,
  truncated = false,
): AgentMcpServers {
  return parseAgentMcpServers({
    version: 1,
    provider,
    truncated,
    servers: servers.map((server) => ({
      status: "connected",
      scope: "user",
      transport: "stdio",
      endpointOrigin: null,
      toolCount: null,
      detail: null,
      ...server,
    })),
  });
}
