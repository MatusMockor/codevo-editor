import { useMemo, type ReactNode } from "react";
import {
  agentCommandCatalogSource,
  type AgentCommandCatalogGateway,
  type RemoteAgentCommandCatalogGateway,
} from "../../application/agentCommandCatalogGateway";
import { AgentCommandCatalogCache } from "../../application/agentCommandCatalogStore";
import { AgentCommandCatalogContext } from "./useAgentCommandCatalogStore";

export function AgentCommandCatalogProvider({
  gateway,
  remoteGateway = null,
  children,
}: {
  readonly gateway: AgentCommandCatalogGateway;
  readonly remoteGateway?: RemoteAgentCommandCatalogGateway | null;
  readonly children: ReactNode;
}) {
  const store = useMemo(
    () => new AgentCommandCatalogCache(agentCommandCatalogSource(gateway, remoteGateway)),
    [gateway, remoteGateway],
  );
  return (
    <AgentCommandCatalogContext.Provider value={store}>
      {children}
    </AgentCommandCatalogContext.Provider>
  );
}
