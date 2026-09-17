import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import { useState, type ReactNode } from "react";
import { useRemoteRunnerConnections } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";

import { RemoteRunnerContext } from "./remoteRunnerContext";

export function RemoteRunnerProvider({
  children,
  gateway,
  metadataRepository,
  surfacesGateway,
}: {
  readonly children: ReactNode;
  readonly gateway: RemoteRunnerGateway;
  readonly surfacesGateway?: RemoteRunnerSurfacesGateway | null;
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
        selectedServerId,
        selectServer,
        metadataRepository,
      }}
    >
      {children}
    </RemoteRunnerContext.Provider>
  );
}
