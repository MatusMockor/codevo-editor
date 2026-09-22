import { useRef } from "react";
import {
  createRemoteProjectDirectoryGateway,
  createRemoteRepositoryLookupGateway,
} from "../../application/remoteRepositoryLookupGateway";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import type {
  AgentProjectCreationSession,
  AgentProjectRemotePorts,
} from "./agentProjectCreationSession";

/** Adapter identity survives keyed view remounts; credentials belong to this server only. */
export function useAgentRemoteClonePorts(
  runnerGateway: RemoteRunnerGateway | null,
  serverId: string | null,
  session: AgentProjectCreationSession | undefined,
): AgentProjectRemotePorts {
  const retained = useRef(session?.remotePorts);
  if (
    retained.current?.runnerGateway !== runnerGateway ||
    retained.current?.serverId !== serverId
  ) {
    retained.current = {
      runnerGateway,
      serverId,
      lookupGateway: createRemoteRepositoryLookupGateway(runnerGateway, serverId),
      directoryGateway: createRemoteProjectDirectoryGateway(runnerGateway, serverId),
    };
  }
  if (session) session.remotePorts = retained.current;
  return retained.current;
}
