import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DebugGateway, DebugScope, DebugVariable } from "../domain/debug";
import {
  debugEvaluationPolicyForContext,
  type DebugEvaluationContext,
  type DebugEvaluationResult,
} from "../domain/debugEvaluationPolicy";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";
import { debugMutationOwnerKey } from "./useDebugSetVariable";

interface FrameSelection {
  readonly frameId: number;
  readonly scopes: DebugScope[];
}

interface DebugEvaluationOptions {
  readonly activeEvaluationRequestsRef: MutableRefObject<Set<number>>;
  readonly activeSessionId: () => number | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly evaluationRequestIdRef: MutableRefObject<number>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, FrameSelection | null>>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pauseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly pendingControlsRef: MutableRefObject<Map<string, Promise<unknown>>>;
  readonly setEvaluationHistoryBySession: Dispatch<SetStateAction<Record<string, string[]>>>;
  readonly sideEffectingEvaluationFlightsRef: MutableRefObject<Set<string>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<{ readonly epoch: number }>;
}

const inactiveSnapshot = initialDebuggerSnapshot();

export function useDebugEvaluation({
  activeEvaluationRequestsRef,
  activeSessionId,
  currentRootRef,
  currentWorkspaceIdRef,
  debugAdapterKind,
  evaluationRequestIdRef,
  frameSelectionByRootRef,
  frameSelectionGenerationByRootRef,
  gateway,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
  mountedRef,
  pauseGenerationByRootRef,
  pendingControlsRef,
  setEvaluationHistoryBySession,
  sideEffectingEvaluationFlightsRef,
  snapshotsRef,
  workspaceOwnerEpochRef,
}: DebugEvaluationOptions) {
  const evaluateWithContext = useCallback(
    async (
      expression: string,
      context: DebugEvaluationContext,
    ): Promise<DebugEvaluationResult | null> => {
      const normalizedExpression = expression.trim();
      const root = currentRootRef.current;
      const sessionId = activeSessionId();
      const workspaceId = currentWorkspaceIdRef.current;
      const workspaceOwnerEpoch = workspaceOwnerEpochRef.current.epoch;
      if (
        !root ||
        sessionId === null ||
        normalizedExpression === "" ||
        !trustedWorkspace(isWorkspaceTrusted) ||
        !isExactWorkspaceOwnerCurrent(root, workspaceId)
      ) {
        return null;
      }

      const key = normalizedWorkspaceRootKey(root);
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      const frameId =
        frameSelectionByRootRef.current[key]?.frameId ??
        (state.kind === "stopped" ? (state.topFrame?.frameId ?? null) : null);
      if (state.kind !== "stopped" || frameId === null) return null;
      if (context !== "repl" && debugAdapterKind !== "node") {
        return {
          status: "error",
          kind: "unsupported",
          message:
            context === "watch"
              ? "Safe automatic watch evaluation is only available for Node.js debugging."
              : "Clipboard evaluation is only available for Node.js debugging.",
        };
      }

      const pauseGeneration = pauseGenerationByRootRef.current[key] ?? 0;
      const sideEffectingOwnerKey = debugMutationOwnerKey(key, sessionId, pauseGeneration, frameId);
      if (
        context === "repl" &&
        (pendingControlsRef.current.has(key) ||
          sideEffectingEvaluationFlightsRef.current.has(sideEffectingOwnerKey))
      ) {
        return null;
      }
      if (context === "repl") {
        sideEffectingEvaluationFlightsRef.current.add(sideEffectingOwnerKey);
        setEvaluationHistoryBySession((current) => ({
          ...current,
          [`${key}\0${sessionId}`]: [
            normalizedExpression,
            ...(current[`${key}\0${sessionId}`] ?? []).filter(
              (candidate) => candidate !== normalizedExpression,
            ),
          ].slice(0, 100),
        }));
      }

      evaluationRequestIdRef.current += 1;
      const requestId = evaluationRequestIdRef.current;
      activeEvaluationRequestsRef.current.add(requestId);
      const frameSelectionGeneration = frameSelectionGenerationByRootRef.current[key] ?? 0;
      const evaluationIsCurrent = () => {
        if (
          !mountedRef.current ||
          !trustedWorkspace(isWorkspaceTrusted) ||
          !activeEvaluationRequestsRef.current.has(requestId) ||
          workspaceOwnerEpochRef.current.epoch !== workspaceOwnerEpoch ||
          !isExactWorkspaceOwnerCurrent(root, workspaceId) ||
          activeSessionId() !== sessionId
        ) {
          return false;
        }
        const currentState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        const currentFrameId =
          frameSelectionByRootRef.current[key]?.frameId ??
          (currentState.kind === "stopped" ? (currentState.topFrame?.frameId ?? null) : null);
        return (
          currentState.kind === "stopped" &&
          currentFrameId === frameId &&
          (frameSelectionGenerationByRootRef.current[key] ?? 0) === frameSelectionGeneration &&
          (pauseGenerationByRootRef.current[key] ?? 0) === pauseGeneration
        );
      };

      try {
        const policy = debugEvaluationPolicyForContext(context);
        const result = await gateway.evaluate(
          root,
          sessionId,
          frameId,
          normalizedExpression,
          policy.context,
          policy.allowSideEffects,
          pauseGeneration,
        );
        return evaluationIsCurrent() ? result : null;
      } catch (error) {
        if (!evaluationIsCurrent()) return null;
        throw error;
      } finally {
        activeEvaluationRequestsRef.current.delete(requestId);
        if (context === "repl") {
          sideEffectingEvaluationFlightsRef.current.delete(sideEffectingOwnerKey);
        }
      }
    },
    [
      activeEvaluationRequestsRef,
      activeSessionId,
      currentRootRef,
      currentWorkspaceIdRef,
      debugAdapterKind,
      evaluationRequestIdRef,
      frameSelectionByRootRef,
      frameSelectionGenerationByRootRef,
      gateway,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      mountedRef,
      pauseGenerationByRootRef,
      pendingControlsRef,
      setEvaluationHistoryBySession,
      sideEffectingEvaluationFlightsRef,
      snapshotsRef,
      workspaceOwnerEpochRef,
    ],
  );

  const evaluate = useCallback(
    async (expression: string): Promise<DebugVariable | null> => {
      const result = await evaluateWithContext(expression, "repl");
      if (!result) return null;
      if (result.status === "error") throw new Error(result.message);
      return {
        name: expression.trim(),
        value: result.value,
        type: result.type,
        variablesReference: result.variablesReference ?? 0,
      };
    },
    [evaluateWithContext],
  );
  const evaluateWatch = useCallback(
    (expression: string) => evaluateWithContext(expression, "watch"),
    [evaluateWithContext],
  );
  const evaluateClipboard = useCallback(
    (expression: string) => evaluateWithContext(expression, "clipboard"),
    [evaluateWithContext],
  );
  return { evaluate, evaluateClipboard, evaluateWatch };
}

function trustedWorkspace(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted();
  } catch {
    return false;
  }
}
