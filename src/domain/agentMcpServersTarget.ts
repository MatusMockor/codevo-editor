import { agentMcpServersRequest, type AgentMcpServersRequest } from "./agentMcpServers";
import type { AgentCliKind } from "./agentTask";
import type { RemoteRunnerMcpServersRequest } from "./remoteRunner";
import { remoteRunnerProviderOf } from "./remoteRunnerProvider";
import { remoteRunnerChecks } from "./remoteRunnerValidation";

export const AGENT_MCP_SERVERS_RUNNER_CAPABILITY = "mcpServers" as const;

export interface AgentMcpServersServerProject {
  readonly serverId: string;
  readonly runnerId: string;
  readonly projectId: string;
}

export interface AgentMcpServersLocalProject {
  readonly kind: "local";
  readonly repositoryRoot: string;
}

export type AgentMcpServersRemoteProject = AgentMcpServersServerProject & {
  readonly kind: "server";
};

export type AgentMcpServersProject = AgentMcpServersLocalProject | AgentMcpServersRemoteProject;

export type AgentMcpServersLocalTarget = AgentMcpServersRequest & {
  readonly kind: "local";
};

export type AgentMcpServersServerTarget = AgentMcpServersServerProject & {
  readonly kind: "server";
  readonly provider: AgentCliKind;
};

export type AgentMcpServersTarget = AgentMcpServersLocalTarget | AgentMcpServersServerTarget;

export function localAgentMcpServersTarget(
  repositoryRoot: string | null,
  provider: AgentCliKind,
): AgentMcpServersLocalTarget | null {
  const request = agentMcpServersRequest(repositoryRoot, provider);
  if (request === null) return null;
  return Object.freeze({ kind: "local", ...request });
}

export function serverAgentMcpServersTarget(
  project: AgentMcpServersServerProject | null,
  provider: AgentCliKind,
): AgentMcpServersServerTarget | null {
  if (project === null) return null;
  const { serverId, runnerId, projectId } = project;
  const target: AgentMcpServersServerTarget = Object.freeze({
    kind: "server",
    serverId,
    runnerId,
    projectId,
    provider,
  });
  if (!remoteRunnerChecks.getMcpServers.request(remoteMcpServersRequest(target))) return null;
  return target;
}

export function agentMcpServersTarget(
  project: AgentMcpServersProject | null,
  provider: AgentCliKind,
): AgentMcpServersTarget | null {
  if (project === null) return null;
  switch (project.kind) {
    case "local":
      return localAgentMcpServersTarget(project.repositoryRoot, provider);
    case "server":
      return serverAgentMcpServersTarget(project, provider);
    default: {
      const unreachable: never = project;
      return unreachable;
    }
  }
}

export function localAgentMcpServersProject(
  repositoryRoot: string | null,
): AgentMcpServersLocalProject | null {
  const target = localAgentMcpServersTarget(repositoryRoot, "claudeCode");
  if (target === null) return null;
  return Object.freeze({ kind: "local", repositoryRoot: target.repositoryRoot });
}

export function serverAgentMcpServersProject(
  project: AgentMcpServersServerProject | null,
): AgentMcpServersRemoteProject | null {
  const target = serverAgentMcpServersTarget(project, "claudeCode");
  if (target === null) return null;
  const { serverId, runnerId, projectId } = target;
  return Object.freeze({ kind: "server", serverId, runnerId, projectId });
}

export function remoteMcpServersRequest(
  target: AgentMcpServersServerTarget,
): RemoteRunnerMcpServersRequest {
  return {
    serverId: target.serverId,
    runnerId: target.runnerId,
    projectId: target.projectId,
    provider: remoteRunnerProviderOf(target.provider),
  };
}

export function agentMcpServersProjectKey(project: AgentMcpServersProject): string {
  switch (project.kind) {
    case "local":
      return JSON.stringify(["local", project.repositoryRoot]);
    case "server":
      return JSON.stringify(["server", project.serverId, project.runnerId, project.projectId]);
    default: {
      const unreachable: never = project;
      return unreachable;
    }
  }
}

export function agentMcpServersProjectOfKey(key: string): AgentMcpServersProject | null {
  const parts = keyParts(key);
  if (parts === null || !parts.every((part) => typeof part === "string")) return null;
  const [kind, first, second, third] = parts as ReadonlyArray<string>;
  if (kind === "local" && parts.length === 2 && first !== undefined)
    return localAgentMcpServersProject(first);
  if (kind !== "server" || parts.length !== 4) return null;
  if (first === undefined || second === undefined || third === undefined) return null;
  return serverAgentMcpServersProject({ serverId: first, runnerId: second, projectId: third });
}

export function agentMcpServersTargetKey(target: AgentMcpServersTarget): string {
  switch (target.kind) {
    case "local":
      return JSON.stringify(["local", target.provider, target.repositoryRoot]);
    case "server":
      return JSON.stringify([
        "server",
        target.provider,
        target.serverId,
        target.runnerId,
        target.projectId,
      ]);
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

function keyParts(key: string): ReadonlyArray<unknown> | null {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
