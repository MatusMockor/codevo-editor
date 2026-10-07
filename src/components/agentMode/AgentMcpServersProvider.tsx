import { useMemo, type ReactNode } from "react";
import type { AgentMcpServersGateway } from "../../application/agentMcpServersGateway";
import { createAgentMcpServersSurface } from "../../application/agentMcpServersSurface";
import { AgentMcpServersContext } from "./useAgentMcpServersSurface";

export function AgentMcpServersProvider({
  gateway,
  children,
}: {
  readonly gateway: AgentMcpServersGateway;
  readonly children: ReactNode;
}) {
  const surface = useMemo(() => createAgentMcpServersSurface(gateway), [gateway]);
  return (
    <AgentMcpServersContext.Provider value={surface}>{children}</AgentMcpServersContext.Provider>
  );
}
