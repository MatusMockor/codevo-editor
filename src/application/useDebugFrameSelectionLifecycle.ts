import { useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import type { DebugGateway, DebugScope } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import type { DebugScopeLoadState } from "./debugSessionContracts";
import { emptyScopes } from "./debugSessionDefaults";
import {
  selectDebugFrame,
  type DebugFrameSelection,
  type DebugFrameSelectionContext,
} from "./debugFrameSelection";

type SelectionCommandContext = Omit<DebugFrameSelectionContext, "activeSessionId" | "gateway">;

interface UseDebugFrameSelectionCommandOptions extends SelectionCommandContext {
  readonly activeSessionId: () => number | null;
  readonly gateway: DebugGateway;
}

/** Owns the stable frame-selection command while the coordinator fences each async request. */
export function useDebugFrameSelectionCommand({
  activeSessionId,
  currentRootRef,
  currentWorkspaceEpochRef,
  currentWorkspaceIdRef,
  frameSelectionGenerationByRootRef,
  frameSelectionByRootRef,
  gateway,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
  mountedRef,
  pauseGenerationByRootRef,
  sessionOwnersRef,
  setFrameSelectionByRoot,
  snapshotsRef,
}: UseDebugFrameSelectionCommandOptions): (frameId: number) => Promise<void> {
  return useCallback(
    (frameId: number) =>
      selectDebugFrame(
        {
          activeSessionId,
          currentRootRef,
          currentWorkspaceEpochRef,
          currentWorkspaceIdRef,
          frameSelectionGenerationByRootRef,
          frameSelectionByRootRef,
          gateway,
          isExactWorkspaceOwnerCurrent,
          isWorkspaceTrusted,
          mountedRef,
          pauseGenerationByRootRef,
          sessionOwnersRef,
          setFrameSelectionByRoot,
          snapshotsRef,
        },
        frameId,
      ),
    [
      activeSessionId,
      currentRootRef,
      currentWorkspaceEpochRef,
      currentWorkspaceIdRef,
      frameSelectionGenerationByRootRef,
      frameSelectionByRootRef,
      gateway,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      mountedRef,
      pauseGenerationByRootRef,
      sessionOwnersRef,
      setFrameSelectionByRoot,
      snapshotsRef,
    ],
  );
}

interface UseDebugFrameSelectionProjectionOptions {
  readonly activeKey: string;
  readonly activePauseGeneration: number;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, DebugFrameSelection | null>>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly pauseOwned: boolean;
  readonly selection: DebugFrameSelection | null;
  readonly selectFrame: (frameId: number) => Promise<void>;
  readonly setFrameSelectionByRoot: (value: Record<string, DebugFrameSelection | null>) => void;
  readonly snapshot: DebuggerSessionSnapshot;
}

export interface DebugFrameSelectionProjection {
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly scopeLoadState: DebugScopeLoadState;
  readonly scopes: DebugScope[];
  readonly selectedFrameId: number | null;
}

/** Projects a closed Variables state and reacquires scopes after trust is restored. */
export function useDebugFrameSelectionProjection({
  activeKey,
  activePauseGeneration,
  currentRootRef,
  currentWorkspaceIdRef,
  frameSelectionByRootRef,
  frameSelectionGenerationByRootRef,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
  pauseOwned,
  selection,
  selectFrame,
  setFrameSelectionByRoot,
  snapshot,
}: UseDebugFrameSelectionProjectionOptions): DebugFrameSelectionProjection {
  const workspaceAuthorized = exactWorkspaceAuthorized(
    currentRootRef.current,
    currentWorkspaceIdRef.current,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
  );
  useEffect(() => {
    if (workspaceAuthorized || frameSelectionByRootRef.current[activeKey] === null) return;
    frameSelectionGenerationByRootRef.current = {
      ...frameSelectionGenerationByRootRef.current,
      [activeKey]: (frameSelectionGenerationByRootRef.current[activeKey] ?? 0) + 1,
    };
    const cleared = {
      ...frameSelectionByRootRef.current,
      [activeKey]: null,
    };
    frameSelectionByRootRef.current = cleared;
    setFrameSelectionByRoot(cleared);
  }, [
    activeKey,
    frameSelectionByRootRef,
    frameSelectionGenerationByRootRef,
    setFrameSelectionByRoot,
    workspaceAuthorized,
  ]);

  useEffect(() => {
    if (
      !workspaceAuthorized ||
      !pauseOwned ||
      snapshot.state.kind !== "stopped" ||
      selection !== null
    ) {
      return;
    }
    const topFrame = snapshot.state.frames[0];
    if (topFrame) void selectFrame(topFrame.frameId);
  }, [pauseOwned, selectFrame, selection, snapshot.state, workspaceAuthorized]);

  const inspectionOwner = useMemo<DebugInspectionOwner | null>(() => {
    if (
      !workspaceAuthorized ||
      !pauseOwned ||
      snapshot.state.kind !== "stopped" ||
      activePauseGeneration <= 0
    ) {
      return null;
    }
    const frameId = selection?.frameId ?? snapshot.state.topFrame?.frameId ?? null;
    return frameId === null
      ? null
      : {
          rootKey: activeKey,
          sessionId: snapshot.state.sessionId,
          pauseGeneration: activePauseGeneration,
          frameId,
        };
  }, [
    activeKey,
    activePauseGeneration,
    pauseOwned,
    selection?.frameId,
    snapshot.state,
    workspaceAuthorized,
  ]);

  if (!workspaceAuthorized || !pauseOwned || snapshot.state.kind !== "stopped") {
    return {
      inspectionOwner,
      scopeLoadState: { kind: "inactive" },
      scopes: emptyScopes,
      selectedFrameId: null,
    };
  }
  if (!selection) {
    const topFrame = snapshot.state.frames[0];
    return {
      inspectionOwner,
      scopeLoadState: topFrame
        ? { frameId: topFrame.frameId, kind: "loading" }
        : { kind: "unavailable" },
      scopes: emptyScopes,
      selectedFrameId: null,
    };
  }
  return {
    inspectionOwner,
    scopeLoadState:
      selection.loadState.kind === "error"
        ? {
            frameId: selection.frameId,
            kind: "error",
            message: selection.loadState.message,
          }
        : { frameId: selection.frameId, kind: selection.loadState.kind },
    scopes: selection.scopes,
    selectedFrameId: selection.frameId,
  };
}

function exactWorkspaceAuthorized(
  rootPath: string | null,
  workspaceId: string | null,
  isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean,
  isWorkspaceTrusted: () => boolean,
): boolean {
  if (!rootPath) return false;
  try {
    return isWorkspaceTrusted() && isExactWorkspaceOwnerCurrent(rootPath, workspaceId);
  } catch {
    return false;
  }
}
