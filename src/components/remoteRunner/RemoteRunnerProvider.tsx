import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import { useState, type ReactNode } from "react";
import { useRemoteRunnerConnections } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";

import { RemoteRunnerContext } from "./remoteRunnerContext";

export function RemoteRunnerProvider({
  children,
  gateway,
  metadataRepository,
  repositoryLookup,
  surfacesGateway,
}: {
  readonly children: ReactNode;
  readonly gateway: RemoteRunnerGateway;
  readonly surfacesGateway?: RemoteRunnerSurfacesGateway | null;
  readonly repositoryLookup?: RepositoryLookupGateway | null;
  readonly metadataRepository?: RemoteAgentMetadataRepository;
}) {
  const connections = useRemoteRunnerConnections({ gateway });
  const [selectedServerId, selectServer] = useState<string | null>(null);

  return (
    <RemoteRunnerContext.Provider
      value={{
        ...connections,
        gateway,
        surfacesGateway,
        repositoryLookup,
        selectedServerId,
        selectServer,
        metadataRepository,
      }}
    >
      {children}
    </RemoteRunnerContext.Provider>
  );
}
