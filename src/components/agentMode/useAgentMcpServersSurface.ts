import { createContext, useContext } from "react";
import type { AgentMcpServersSurface } from "../../application/agentMcpServersSurface";

export const AgentMcpServersContext = createContext<AgentMcpServersSurface | null>(null);

export function useAgentMcpServersSurface() {
  return useContext(AgentMcpServersContext);
}
