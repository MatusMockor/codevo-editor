import { useMemo } from "react";
import type { AgentCommandCatalogServerProject } from "../domain/agentCommandCatalogTarget";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import type { AgentThreadView, RemoteAgentCommandCatalogAccess } from "./agentThreadPorts";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteAgentProjectKeyParts } from "./remoteAgentProjection";
import { remoteComposerProjectRootKey } from "./useRemoteDraftGitBase";

export const MAX_REMOTE_COMMAND_CATALOG_RUNNERS = 64;

type InventoryRunner = Pick<RemoteAgentInventorySnapshot, "serverId" | "connected" | "descriptor">;

interface Options {
  readonly gateway: Pick<RemoteRunnerGateway, "getCommandCatalog"> | null;
  readonly servers: readonly Pick<RemoteRunnerServer, "id" | "connected">[];
  readonly snapshots: readonly InventoryRunner[];
}

const runnerKey = (serverId: string, runnerId: string) => JSON.stringify([serverId, runnerId]);

/** Exact (server, runner identity) pairs that are connected and announce command catalogs. */
export function remoteCommandCatalogRunners({
  gateway,
  servers,
  snapshots,
}: Options): ReadonlyArray<string> {
  if (gateway?.getCommandCatalog === undefined) return [];
  const connected = new Set(
    servers
      .slice(0, MAX_REMOTE_COMMAND_CATALOG_RUNNERS)
      .filter((server) => server.connected)
      .map((server) => server.id),
  );
  return snapshots.flatMap((snapshot) => {
    const descriptor = snapshot.descriptor;
    if (descriptor === null || !snapshot.connected || !connected.has(snapshot.serverId)) return [];
    if (descriptor.capabilities.commandCatalog !== true) return [];
    return [runnerKey(snapshot.serverId, descriptor.runnerId)];
  });
}

export function remoteCommandCatalogAccess(
  runners: ReadonlyArray<string>,
): RemoteAgentCommandCatalogAccess | undefined {
  if (runners.length === 0) return undefined;
  const capable = new Set(runners);
  return {
    project(projectRootKey) {
      const project = remoteAgentProjectKeyParts(projectRootKey);
      if (project === null || !capable.has(runnerKey(project.serverId, project.runnerId)))
        return null;
      return project;
    },
  };
}

export function useRemoteAgentCommandCatalogAccess(
  options: Options,
): RemoteAgentCommandCatalogAccess | undefined {
  const signature = JSON.stringify(remoteCommandCatalogRunners(options));
  return useMemo(
    () => remoteCommandCatalogAccess(JSON.parse(signature) as ReadonlyArray<string>),
    [signature],
  );
}

/** The remote project a composer addresses, or null when its runner cannot serve a catalog. */
export function remoteComposerCommandCatalogProject(
  access: RemoteAgentCommandCatalogAccess | undefined,
  projectRootKey: string | null,
  thread: AgentThreadView | null,
): AgentCommandCatalogServerProject | null {
  const rootKey = remoteComposerProjectRootKey(projectRootKey, thread);
  if (rootKey === null) return null;
  return access?.project(rootKey) ?? null;
}
