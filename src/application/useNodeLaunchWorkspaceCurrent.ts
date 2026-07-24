import { useCallback, type RefObject } from "react";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { isNodeDebugConfigurationWorkspaceCurrent } from "./useWorkbenchDebugOrchestration";

export function useNodeLaunchWorkspaceCurrent(
  currentRootRef: RefObject<string | null>,
  currentOwnerRef: RefObject<WorkspaceRuntimeOwner | null>,
) {
  return useCallback(
    (requestedRoot: string, requestedWorkspaceId: string) => {
      return isNodeDebugConfigurationWorkspaceCurrent(
        currentRootRef.current,
        currentOwnerRef.current,
        requestedRoot,
        requestedWorkspaceId,
      );
    },
    [currentOwnerRef, currentRootRef],
  );
}
