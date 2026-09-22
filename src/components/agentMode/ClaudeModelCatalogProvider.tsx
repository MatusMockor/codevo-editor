import type { ReactNode } from "react";
import type { ClaudeModelCatalogGateway } from "../../application/claudeModelCatalogGateway";
import { useClaudeModelCatalog } from "../../application/useClaudeModelCatalog";
import { ClaudeModelCatalogContext } from "./useAgentClaudeModelCatalog";

export function ClaudeModelCatalogProvider({
  gateway,
  children,
}: {
  readonly gateway: ClaudeModelCatalogGateway;
  readonly children: ReactNode;
}) {
  const catalog = useClaudeModelCatalog(gateway);
  return (
    <ClaudeModelCatalogContext.Provider value={catalog}>
      {children}
    </ClaudeModelCatalogContext.Provider>
  );
}
