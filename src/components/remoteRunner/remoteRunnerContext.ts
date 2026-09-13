import { createContext, useContext } from "react";
import type { RemoteRunnerConnectionsSurface } from "../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type { RemoteAgentMetadataRepository } from "../../application/remoteAgentMetadata";

export type RemoteRunnerContextValue = RemoteRunnerConnectionsSurface & {
  readonly gateway: RemoteRunnerGateway;
  readonly selectedServerId: string | null;
  readonly metadataRepository?: RemoteAgentMetadataRepository;
  selectServer(serverId: string | null): void;
};

export const RemoteRunnerContext = createContext<RemoteRunnerContextValue | null>(null);

export function useRemoteRunnerContext() {
  return useContext(RemoteRunnerContext);
}
