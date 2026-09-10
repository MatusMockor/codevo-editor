import { useCallback, useMemo } from "react";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";
import type { AgentPanelResizeCommit } from "./useWorkbenchResizeHandles";

export function useAgentPanelResizeCommit(
  agentLayout: AgentWorkbenchLayoutState,
): AgentPanelResizeCommit {
  const onResizeRightPanel = useCallback(
    (width: number) => agentLayout.dispatch({ kind: "resizeRightPanel", width }),
    [agentLayout],
  );
  const onResizeBottomPanel = useCallback(
    (height: number) => agentLayout.dispatch({ kind: "resizeBottomPanel", height }),
    [agentLayout],
  );

  return useMemo(
    () => ({ layout: agentLayout.layout, onResizeRightPanel, onResizeBottomPanel }),
    [agentLayout.layout, onResizeBottomPanel, onResizeRightPanel],
  );
}
