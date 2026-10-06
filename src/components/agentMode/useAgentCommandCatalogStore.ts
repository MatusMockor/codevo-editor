import { createContext, useContext } from "react";
import type { AgentCommandCatalogStore } from "../../application/agentCommandCatalogStore";
import type { AgentCommandCatalogServerProject } from "../../domain/agentCommandCatalogTarget";

export const AgentCommandCatalogContext = createContext<AgentCommandCatalogStore | null>(null);

/** The remote project the enclosing composer addresses, when its runner serves a catalog. */
export const AgentCommandCatalogProjectContext =
  createContext<AgentCommandCatalogServerProject | null>(null);

export function useAgentCommandCatalogProject() {
  return useContext(AgentCommandCatalogProjectContext);
}

export function useAgentCommandCatalogStore() {
  return useContext(AgentCommandCatalogContext);
}
