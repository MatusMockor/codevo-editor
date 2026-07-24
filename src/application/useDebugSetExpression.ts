import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DebugGateway } from "../domain/debug";
import type { DebugEvaluationSuccess } from "../domain/debugEvaluationPolicy";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { DebugSessionOwner } from "./useDebugSessionEnd";
import { debugMutationOwnerKey } from "./useDebugSetVariable";

interface FrameSelection {
  readonly frameId: number;
}

interface WorkspaceOwnerEpoch {
  readonly epoch: number;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}

export interface DebugSetExpressionCandidate {
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly expression: string;
  readonly owner: DebugInspectionOwner;
  readonly setExpressionReference: number;
  /** Exact definition/evaluation object generation guard; prevents A→B→A reuse. */
  isCurrent(): boolean;
}

interface DebugSetExpressionOptions {
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => "node" | "php" | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, FrameSelection | null>>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
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
  /** Invalidates Watch caches after any dispatched mutation whose outcome may have changed state. */
  readonly invalidateWatchEvaluations: () => void;
}

const inactiveSnapshot = initialDebuggerSnapshot();

export function useDebugSetExpression({
  adapterKindForSession,
  currentRootRef,
  currentWorkspaceIdRef,
  frameSelectionByRootRef,
  frameSelectionGenerationByRootRef,
  gateway,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
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
  invalidateWatchEvaluations,
}: DebugSetExpressionOptions) {
  return useCallback(
    async (
      candidate: DebugSetExpressionCandidate,
      value: string,
    ): Promise<DebugEvaluationSuccess | null> => {
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
      if (
        state.kind !== "stopped" ||
        frameId === null ||
        pauseGeneration <= 0 ||
        !Number.isSafeInteger(candidate.setExpressionReference) ||
        candidate.setExpressionReference <= 0 ||
        candidate.owner.rootKey !== key ||
        candidate.owner.sessionId !== state.sessionId ||
        candidate.owner.pauseGeneration !== pauseGeneration ||
        candidate.owner.frameId !== frameId
      ) {
        return null;
      }
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
        const currentState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        const currentOwner = sessionOwnersRef.current.get(key);
        const currentSelection = frameSelectionByRootRef.current[key];
        const currentFrameId =
          currentSelection?.frameId ??
          (currentState.kind === "stopped" ? (currentState.topFrame?.frameId ?? null) : null);
        return (
          mountedRef.current &&
          trustedWorkspace(isWorkspaceTrusted) &&
          workspaceOwnerEpochRef.current.epoch === workspaceOwnerEpoch &&
          workspaceOwnerCurrent &&
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
          !sideEffectingEvaluationFlightsRef.current.has(mutationOwnerKey) &&
          candidateIsCurrent(candidate)
        );
      };

      if (!ownerIsCurrent() || pendingControlsRef.current.has(key)) return null;
      if (!ownerIsCurrent()) return null;
      const operation = gateway.setExpression({
        rootPath: root,
        sessionId: state.sessionId,
        pauseGeneration,
        frameId,
        setExpressionReference: candidate.setExpressionReference,
        expression: candidate.expression,
        value,
      });
      pendingControlsRef.current.set(key, operation);
      setControlPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        const result = await operation;
        return ownerIsCurrent() && pendingControlsRef.current.get(key) === operation
          ? result.value
          : null;
      } catch (error) {
        if (!ownerIsCurrent() || pendingControlsRef.current.get(key) !== operation) return null;
        throw error;
      } finally {
        // Once dispatched, success and transport failure are both conservative invalidation points.
        invalidateWatchEvaluations();
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
      invalidateWatchEvaluations,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
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

function trustedWorkspace(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted();
  } catch {
    return false;
  }
}

function candidateIsCurrent(candidate: DebugSetExpressionCandidate): boolean {
  try {
    return candidate.isCurrent();
  } catch {
    return false;
  }
}
