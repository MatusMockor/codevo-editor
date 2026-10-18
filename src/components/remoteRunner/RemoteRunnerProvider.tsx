import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import { useEffect, useState, type ReactNode } from "react";
import { useRemoteRunnerConnections } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import {
  initialRemoteServerListAuthority,
  observeRemoteServerListStatus,
  remoteServerListState,
  retainedRemoteServerSelection,
  type RemoteServerListAuthority,
} from "../../domain/remoteThreadSelection";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import type { SpeechDictationPorts } from "../../application/speechDictationPorts";

import { RemoteRunnerContext } from "./remoteRunnerContext";

export function RemoteRunnerProvider({
  children,
  gateway,
  metadataRepository,
  repositoryLookup,
  speechDictation = null,
  surfacesGateway,
}: {
  readonly children: ReactNode;
  readonly gateway: RemoteRunnerGateway;
  readonly surfacesGateway?: RemoteRunnerSurfacesGateway | null;
  readonly repositoryLookup?: RepositoryLookupGateway | null;
  readonly speechDictation?: SpeechDictationPorts | null;
  readonly metadataRepository?: RemoteAgentMetadataRepository;
}) {
  const connections = useRemoteRunnerConnections({ gateway });
  const [storedServerId, selectServer] = useState<string | null>(null);
  const serverList = remoteServerListState(useServerListAuthority(gateway, connections.status));
  const selectedServerId = retainedRemoteServerSelection(
    storedServerId,
    serverList,
    connections.servers,
  );
  useEffect(() => {
    if (storedServerId === null || selectedServerId !== null) return;
    selectServer(null);
  }, [selectedServerId, storedServerId]);

  return (
    <RemoteRunnerContext.Provider
      value={{
        ...connections,
        gateway,
        surfacesGateway,
        repositoryLookup,
        speechDictation,
        serverList,
        selectedServerId,
        selectServer,
        metadataRepository,
      }}
    >
      {children}
    </RemoteRunnerContext.Provider>
  );
}

function useServerListAuthority(
  gateway: RemoteRunnerGateway,
  status: RemoteServerListAuthority["status"],
): RemoteServerListAuthority {
  const [owned, setOwned] = useState(() => ({
    gateway,
    authority: initialRemoteServerListAuthority(status),
  }));
  if (owned.gateway !== gateway) {
    const next = { gateway, authority: initialRemoteServerListAuthority(status) };
    setOwned(next);
    return next.authority;
  }
  const authority = observeRemoteServerListStatus(owned.authority, status);
  if (authority !== owned.authority) setOwned({ gateway, authority });
  return authority;
}
