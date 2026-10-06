import type {
  AgentCommandCatalog,
  AgentCommandCatalogRequest,
} from "../domain/agentCommandCatalog";
import {
  remoteCommandCatalogRequest,
  type AgentCommandCatalogTarget,
} from "../domain/agentCommandCatalogTarget";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";

/** Workspace- and provider-scoped; a result is only valid for the exact request that asked. */
export interface AgentCommandCatalogGateway {
  read(request: AgentCommandCatalogRequest): Promise<AgentCommandCatalog>;
}

export type RemoteAgentCommandCatalogGateway = Pick<RemoteRunnerGateway, "getCommandCatalog">;

/** Reads the catalog from wherever the target's provider CLI actually runs. */
export interface AgentCommandCatalogSource {
  read(target: AgentCommandCatalogTarget): Promise<AgentCommandCatalog>;
}

export function agentCommandCatalogSource(
  local: AgentCommandCatalogGateway,
  remote: RemoteAgentCommandCatalogGateway | null,
): AgentCommandCatalogSource {
  return {
    async read(target) {
      switch (target.kind) {
        case "local":
          return local.read({ repositoryRoot: target.repositoryRoot, provider: target.provider });
        case "server": {
          if (remote?.getCommandCatalog === undefined)
            throw new Error("Remote command catalogs are unavailable.");
          return remote.getCommandCatalog(remoteCommandCatalogRequest(target));
        }
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    },
  };
}
