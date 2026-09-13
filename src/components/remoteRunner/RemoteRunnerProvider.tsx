import { useState, type ReactNode } from "react";
import { useRemoteRunnerConnections } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";

import { RemoteRunnerContext } from "./remoteRunnerContext";

export function RemoteRunnerProvider({
  children,
  gateway,
  metadataRepository,
}: {
  readonly children: ReactNode;
  readonly gateway: RemoteRunnerGateway;
  readonly metadataRepository?: RemoteAgentMetadataRepository;
}) {
  const connections = useRemoteRunnerConnections({ gateway });
  const [selectedServerId, selectServer] = useState<string | null>(null);

  return (
    <RemoteRunnerContext.Provider
      value={{ ...connections, gateway, selectedServerId, selectServer, metadataRepository }}
    >
      {children}
    </RemoteRunnerContext.Provider>
  );
}
