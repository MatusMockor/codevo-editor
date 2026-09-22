import { createContext, useContext } from "react";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../../domain/claudeModelCatalog";

export const ClaudeModelCatalogContext = createContext(BUNDLED_CLAUDE_MODEL_MANIFEST);

export function useAgentClaudeModelCatalog() {
  return useContext(ClaudeModelCatalogContext);
}
