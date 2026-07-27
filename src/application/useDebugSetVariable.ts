import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DebugGateway, DebugScope, DebugVariable } from "../domain/debug";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { DebugSessionOwner } from "./useDebugSessionEnd";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";

interface FrameSelection {
  readonly frameId: number;
  readonly scopes: DebugScope[];
}

interface WorkspaceOwnerEpoch {
  readonly epoch: number;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}

interface DebugSetVariableOptions {
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => "node" | "php" | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, FrameSelection | null>>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly invalidateDebugInspectionOwner: (owner: DebugInspectionOwner) => void;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pauseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly pendingActiveStopsRef: MutableRefObject<Map<string, unknown>>;
  readonly pendingBreakpointBulkMutationsRef: MutableRefObject<Map<string, Promise<void>>>;
  readonly pendingControlsRef: MutableRefObject<Map<string, Promise<unknown>>>;
  readonly pendingRestartsRef: MutableRefObject<Map<string, unknown>>;
  readonly pendingStartKeysRef: MutableRefObject<Set<string>>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly setControlPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly sideEffectingEvaluationFlightsRef: MutableRefObject<Set<string>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<WorkspaceOwnerEpoch>;
}

const inactiveSnapshot = initialDebuggerSnapshot();

export function useDebugSetVariable({
  adapterKindForSession,
  currentRootRef,
  currentWorkspaceIdRef,
  frameSelectionByRootRef,
  frameSelectionGenerationByRootRef,
  gateway,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
  invalidateDebugInspectionOwner,
  mountedRef,
  pauseGenerationByRootRef,
  pendingActiveStopsRef,
  pendingBreakpointBulkMutationsRef,
  pendingControlsRef,
  pendingRestartsRef,
  pendingStartKeysRef,
  sessionOwnersRef,
  setControlPendingByRoot,
  sideEffectingEvaluationFlightsRef,
  snapshotsRef,
  workspaceOwnerEpochRef,
}: DebugSetVariableOptions) {
  return useCallback(
    async (
      variablesReference: number,
      name: string,
      value: string,
    ): Promise<DebugVariable | null> => {
      const root = currentRootRef.current;
      const workspaceId = currentWorkspaceIdRef.current;
      const workspaceOwnerEpoch = workspaceOwnerEpochRef.current.epoch;
      if (!root || !mountedRef.current || !trustedWorkspace(isWorkspaceTrusted)) return null;

      const key = normalizedWorkspaceRootKey(root);
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      const owner = sessionOwnersRef.current.get(key);
      const selection = frameSelectionByRootRef.current[key];
      const frameId =
        selection?.frameId ?? (state.kind === "stopped" ? (state.topFrame?.frameId ?? null) : null);
      const pauseGeneration = pauseGenerationByRootRef.current[key] ?? 0;
      const frameSelectionGeneration = frameSelectionGenerationByRootRef.current[key] ?? 0;
      if (state.kind !== "stopped" || frameId === null || pauseGeneration <= 0) return null;
      const mutationOwnerKey = debugMutationOwnerKey(
        key,
        state.sessionId,
        pauseGeneration,
        frameId,
      );

      const ownerIsCurrent = (): boolean => {
        let workspaceOwnerCurrent = false;
        try {
          workspaceOwnerCurrent = isExactWorkspaceOwnerCurrent(root, workspaceId);
        } catch {
          return false;
        }
        if (
          !mountedRef.current ||
          !trustedWorkspace(isWorkspaceTrusted) ||
          workspaceOwnerEpochRef.current.epoch !== workspaceOwnerEpoch ||
          !workspaceOwnerCurrent
        ) {
          return false;
        }
        const currentState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        const currentOwner = sessionOwnersRef.current.get(key);
        const currentSelection = frameSelectionByRootRef.current[key];
        const currentFrameId =
          currentSelection?.frameId ??
          (currentState.kind === "stopped" ? (currentState.topFrame?.frameId ?? null) : null);
        return (
          currentState.kind === "stopped" &&
          currentState.sessionId === state.sessionId &&
          owner?.sessionId === state.sessionId &&
          owner.workspaceId === workspaceId &&
          currentOwner?.sessionId === state.sessionId &&
          currentOwner.workspaceId === workspaceId &&
          (pauseGenerationByRootRef.current[key] ?? 0) === pauseGeneration &&
          currentFrameId === frameId &&
          (frameSelectionGenerationByRootRef.current[key] ?? 0) === frameSelectionGeneration &&
          adapterKindForSession(root, state.sessionId) === "node" &&
          !pendingStartKeysRef.current.has(key) &&
          !pendingRestartsRef.current.has(key) &&
          !pendingActiveStopsRef.current.has(key) &&
          !pendingBreakpointBulkMutationsRef.current.has(key) &&
          !sideEffectingEvaluationFlightsRef.current.has(mutationOwnerKey)
        );
      };

      if (!ownerIsCurrent() || pendingControlsRef.current.has(key)) return null;
      if (!ownerIsCurrent()) return null;
      const operation = gateway.setVariable({
        rootPath: root,
        sessionId: state.sessionId,
        pauseGeneration,
        frameId,
        variablesReference,
        name,
        value,
      });
      pendingControlsRef.current.set(key, operation);
      setControlPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        const result = await operation;
        return ownerIsCurrent() && pendingControlsRef.current.get(key) === operation
          ? result
          : null;
      } catch (error) {
        if (!ownerIsCurrent() || pendingControlsRef.current.get(key) !== operation) return null;
        throw error;
      } finally {
        invalidateDebugInspectionOwner({
          rootKey: key,
          workspaceId,
          workspaceEpoch: workspaceOwnerEpoch,
          sessionId: state.sessionId,
          pauseGeneration,
          frameId,
        });
        if (pendingControlsRef.current.get(key) === operation) {
          pendingControlsRef.current.delete(key);
          if (mountedRef.current) {
            setControlPendingByRoot((current) => ({ ...current, [key]: false }));
          }
        }
      }
    },
    [
      adapterKindForSession,
      currentRootRef,
      currentWorkspaceIdRef,
      frameSelectionByRootRef,
      frameSelectionGenerationByRootRef,
      gateway,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      invalidateDebugInspectionOwner,
      mountedRef,
      pauseGenerationByRootRef,
      pendingActiveStopsRef,
      pendingBreakpointBulkMutationsRef,
      pendingControlsRef,
      pendingRestartsRef,
      pendingStartKeysRef,
      sessionOwnersRef,
      setControlPendingByRoot,
      sideEffectingEvaluationFlightsRef,
      snapshotsRef,
      workspaceOwnerEpochRef,
    ],
  );
}

export function debugMutationOwnerKey(
  rootKey: string,
  sessionId: number,
  pauseGeneration: number,
  frameId: number,
): string {
  return `${rootKey}\0${sessionId}\0${pauseGeneration}\0${frameId}`;
}

function trustedWorkspace(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted();
  } catch {
    return false;
  }
}
