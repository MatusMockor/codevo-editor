import { createContext, useContext } from "react";
import { BUNDLED_CODEX_MODEL_CATALOG } from "../../domain/codexModelCatalog";

export const CodexModelCatalogContext = createContext(BUNDLED_CODEX_MODEL_CATALOG);

export function useAgentCodexModelCatalog() {
  return useContext(CodexModelCatalogContext);
}
