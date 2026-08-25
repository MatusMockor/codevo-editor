import { useCallback } from "react";
import { collapseEditorAction } from "../domain/agentWorkbenchLayout";
import {
  workbenchAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "./agentViewCommandBridge";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";

export function useAgentEditorCollapse(
  agentLayout: AgentWorkbenchLayoutState,
  viewCommands: AgentViewCommandBridge = workbenchAgentViewCommandBridge,
): () => void {
  return useCallback(
    () =>
      agentLayout.dispatch(
        collapseEditorAction(agentLayout.layout, (surface) => viewCommands.surfaceBlocked(surface)),
      ),
    [agentLayout, viewCommands],
  );
}
