import type { ReactNode } from "react";
import type { ModelFirstSeenRepository } from "../../application/modelFirstSeenRepository";
import { useModelNewness } from "../../application/useModelNewness";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import { useAgentCodexModelCatalog } from "./useAgentCodexModelCatalog";
import { ModelNewnessContext } from "./useAgentModelNewness";

export function ModelNewnessProvider({
  repository,
  children,
}: {
  readonly repository: ModelFirstSeenRepository;
  readonly children: ReactNode;
}) {
  const newness = useModelNewness(
    repository,
    useAgentClaudeModelCatalog(),
    useAgentCodexModelCatalog(),
  );
  return <ModelNewnessContext.Provider value={newness}>{children}</ModelNewnessContext.Provider>;
}
