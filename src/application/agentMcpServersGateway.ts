import {
  AGENT_MCP_SERVERS_ERRORS,
  type AgentMcpServers,
  type AgentMcpServersErrorKind,
  type AgentMcpServersRequest,
} from "../domain/agentMcpServers";
import {
  remoteMcpServersRequest,
  type AgentMcpServersServerTarget,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";

export interface AgentMcpServersGateway {
  check(request: AgentMcpServersRequest): Promise<AgentMcpServers>;
}

export type RemoteAgentMcpServersGateway = Pick<RemoteRunnerGateway, "getMcpServers">;

export type AgentMcpRunnerSupport = "supported" | "unsupported" | "unavailable";

export interface AgentMcpServersRunners {
  confirm(serverId: string, runnerId: string): Promise<AgentMcpRunnerSupport>;
  support(serverId: string, runnerId: string): AgentMcpRunnerSupport;
}

export interface AgentMcpServersSource {
  check(target: AgentMcpServersTarget): Promise<AgentMcpServers>;
}

export function agentMcpServersSource(
  local: AgentMcpServersGateway,
  remote: RemoteAgentMcpServersGateway | null,
  runners: AgentMcpServersRunners,
): AgentMcpServersSource {
  return {
    async check(target) {
      switch (target.kind) {
        case "local":
          return local.check({ repositoryRoot: target.repositoryRoot, provider: target.provider });
        case "server":
          return checkOnServer(remote, runners, target);
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    },
  };
}

async function checkOnServer(
  remote: RemoteAgentMcpServersGateway | null,
  runners: AgentMcpServersRunners,
  target: AgentMcpServersServerTarget,
): Promise<AgentMcpServers> {
  if (remote?.getMcpServers === undefined) throw refusal("serverUnavailable");
  const request = remoteMcpServersRequest(target);
  const refused = supportRefusal(await runners.confirm(request.serverId, request.runnerId));
  if (refused !== null) throw refusal(refused);
  const servers = await remote.getMcpServers(request);
  if (runners.support(request.serverId, request.runnerId) !== "supported")
    throw refusal("serverUnavailable");
  return servers;
}

function supportRefusal(support: AgentMcpRunnerSupport): AgentMcpServersErrorKind | null {
  switch (support) {
    case "supported":
      return null;
    case "unsupported":
      return "unsupportedRunner";
    case "unavailable":
      return "serverUnavailable";
    default: {
      const unreachable: never = support;
      return unreachable;
    }
  }
}

function refusal(kind: AgentMcpServersErrorKind): Error {
  return new Error(AGENT_MCP_SERVERS_ERRORS[kind]);
}
