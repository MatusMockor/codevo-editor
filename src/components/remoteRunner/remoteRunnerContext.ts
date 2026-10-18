import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import { createContext, useContext } from "react";
import type { RemoteRunnerConnectionsSurface } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import type { SpeechDictationPorts } from "../../application/speechDictationPorts";
import type { RemoteServerListState } from "../../domain/remoteThreadSelection";

export type RemoteRunnerContextValue = RemoteRunnerConnectionsSurface & {
  readonly gateway: RemoteRunnerGateway;
  readonly surfacesGateway?: RemoteRunnerSurfacesGateway | null;
  readonly repositoryLookup?: RepositoryLookupGateway | null;
  readonly speechDictation?: SpeechDictationPorts | null;
  readonly serverList?: RemoteServerListState;
  readonly selectedServerId: string | null;
  readonly metadataRepository?: RemoteAgentMetadataRepository;
  selectServer(serverId: string | null): void;
};

export const RemoteRunnerContext = createContext<RemoteRunnerContextValue | null>(null);

export function useRemoteRunnerContext() {
  return useContext(RemoteRunnerContext);
}
