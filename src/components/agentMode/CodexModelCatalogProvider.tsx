import type { ReactNode } from "react";
import type { CodexModelCatalogGateway } from "../../application/codexModelCatalogGateway";
import { useCodexModelCatalog } from "../../application/useCodexModelCatalog";
import { CodexModelCatalogContext } from "./useAgentCodexModelCatalog";

export function CodexModelCatalogProvider({
  gateway,
  children,
}: {
  readonly gateway: CodexModelCatalogGateway;
  readonly children: ReactNode;
}) {
  const catalog = useCodexModelCatalog(gateway);
  return (
    <CodexModelCatalogContext.Provider value={catalog}>
      {children}
    </CodexModelCatalogContext.Provider>
  );
}
