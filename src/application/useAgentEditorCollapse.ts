import { useCallback } from "react";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";

export function useAgentEditorCollapse(agentLayout: AgentWorkbenchLayoutState): () => void {
  return useCallback(() => agentLayout.dispatch({ kind: "collapseEditor" }), [agentLayout]);
}
