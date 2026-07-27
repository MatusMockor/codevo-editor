import { useCallback, useRef, type MutableRefObject } from "react";
import type { DebugGateway } from "../domain/debug";
import type {
  DebugConsoleCompletionQuery,
  DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";

interface UseDebugConsoleCompletionOptions {
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly gateway: DebugGateway;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly workspaceOwnerEpochRef: MutableRefObject<{ readonly epoch: number }>;
}

export function useDebugConsoleCompletion({
  currentRootRef,
  currentWorkspaceIdRef,
  gateway,
  inspectionOwner,
  isExactWorkspaceOwnerCurrent,
  workspaceOwnerEpochRef,
}: UseDebugConsoleCompletionOptions) {
  const inspectionOwnerRef = useRef(inspectionOwner);
  inspectionOwnerRef.current = inspectionOwner;

  return useCallback(
    async (
      owner: DebugInspectionOwner,
      query: DebugConsoleCompletionQuery,
    ): Promise<DebugConsoleCompletionResponse | null> => {
      const rootPath = currentRootRef.current;
      const requestedWorkspaceId = currentWorkspaceIdRef.current;
      const requestedOwnerEpoch = workspaceOwnerEpochRef.current.epoch;
      const complete = gateway.completions;
      if (
        !rootPath ||
        !complete ||
        !debugInspectionOwnersEqual(owner, inspectionOwnerRef.current) ||
        !isExactWorkspaceOwnerCurrent(rootPath, requestedWorkspaceId)
      ) {
        return null;
      }
      try {
        const response = await complete.call(gateway, {
          rootPath,
          sessionId: owner.sessionId,
          pauseGeneration: owner.pauseGeneration,
          frameId: owner.frameId,
          query,
        });
        return workspaceOwnerEpochRef.current.epoch === requestedOwnerEpoch &&
          isExactWorkspaceOwnerCurrent(rootPath, requestedWorkspaceId) &&
          debugInspectionOwnersEqual(owner, inspectionOwnerRef.current)
          ? response
          : null;
      } catch {
        return null;
      }
    },
    [
      currentRootRef,
      currentWorkspaceIdRef,
      gateway,
      isExactWorkspaceOwnerCurrent,
      workspaceOwnerEpochRef,
    ],
  );
}
