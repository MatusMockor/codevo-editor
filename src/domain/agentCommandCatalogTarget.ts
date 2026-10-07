import { agentCommandCatalogRequest, type AgentCommandCatalogRequest } from "./agentCommandCatalog";
import type { AgentCliKind } from "./agentTask";
import type { RemoteRunnerCommandCatalogRequest } from "./remoteRunner";
import { remoteRunnerProviderOf } from "./remoteRunnerProvider";
import { remoteRunnerChecks } from "./remoteRunnerValidation";

export interface AgentCommandCatalogServerProject {
  readonly serverId: string;
  readonly runnerId: string;
  readonly projectId: string;
}

export type AgentCommandCatalogLocalTarget = AgentCommandCatalogRequest & {
  readonly kind: "local";
};

export type AgentCommandCatalogServerTarget = AgentCommandCatalogServerProject & {
  readonly kind: "server";
  readonly provider: AgentCliKind;
};

export type AgentCommandCatalogTarget =
  AgentCommandCatalogLocalTarget | AgentCommandCatalogServerTarget;

const PROVIDERS: ReadonlyArray<unknown> = ["claudeCode", "codex"] satisfies AgentCliKind[];

export function localAgentCommandCatalogTarget(
  repositoryRoot: string | null,
  provider: AgentCliKind,
): AgentCommandCatalogLocalTarget | null {
  const request = agentCommandCatalogRequest(repositoryRoot, provider);
  if (request === null) return null;
  return Object.freeze({ kind: "local", ...request });
}

export function serverAgentCommandCatalogTarget(
  project: AgentCommandCatalogServerProject | null,
  provider: AgentCliKind,
): AgentCommandCatalogServerTarget | null {
  if (project === null) return null;
  const { serverId, runnerId, projectId } = project;
  const target: AgentCommandCatalogServerTarget = Object.freeze({
    kind: "server",
    serverId,
    runnerId,
    projectId,
    provider,
  });
  if (!remoteRunnerChecks.getCommandCatalog.request(remoteCommandCatalogRequest(target)))
    return null;
  return target;
}

export function remoteCommandCatalogRequest(
  target: AgentCommandCatalogServerTarget,
): RemoteRunnerCommandCatalogRequest {
  return {
    serverId: target.serverId,
    runnerId: target.runnerId,
    projectId: target.projectId,
    provider: remoteRunnerProviderOf(target.provider),
  };
}

export function agentCommandCatalogTargetKey(target: AgentCommandCatalogTarget): string {
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

export function agentCommandCatalogTargetOfKey(key: string): AgentCommandCatalogTarget | null {
  const parts = keyParts(key);
  if (parts === null) return null;
  const [kind, provider, ...identity] = parts;
  if (!isProvider(provider) || !identity.every((part) => typeof part === "string")) return null;
  const [first, second, third] = identity as ReadonlyArray<string>;
  if (kind === "local" && identity.length === 1 && first !== undefined)
    return localAgentCommandCatalogTarget(first, provider);
  if (kind !== "server" || identity.length !== 3) return null;
  if (first === undefined || second === undefined || third === undefined) return null;
  return serverAgentCommandCatalogTarget(
    { serverId: first, runnerId: second, projectId: third },
    provider,
  );
}

function keyParts(key: string): ReadonlyArray<unknown> | null {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isProvider(value: unknown): value is AgentCliKind {
  return PROVIDERS.includes(value);
}
