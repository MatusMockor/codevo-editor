import { useMemo, type ReactNode } from "react";
import type { AgentMcpServersGateway } from "../../application/agentMcpServersGateway";
import {
  createAgentMcpServersSurface,
  type AgentMcpServersRemoteGateway,
} from "../../application/agentMcpServersSurface";
import { useAgentMcpConnectedServers } from "../../application/useAgentMcpServers";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentMcpServersContext } from "./useAgentMcpServersSurface";

const NO_SERVERS: ReadonlyArray<RemoteRunnerServer> = [];

export function AgentMcpServersProvider({
  gateway,
  remoteGateway = null,
  children,
}: {
  readonly gateway: AgentMcpServersGateway;
  readonly remoteGateway?: AgentMcpServersRemoteGateway | null;
  readonly children: ReactNode;
}) {
  const surface = useMemo(
    () => createAgentMcpServersSurface(gateway, remoteGateway),
    [gateway, remoteGateway],
  );
  useAgentMcpConnectedServers(
    surface.serverProjects,
    useRemoteRunnerContext()?.servers ?? NO_SERVERS,
  );
  return (
    <AgentMcpServersContext.Provider value={surface}>{children}</AgentMcpServersContext.Provider>
  );
}
