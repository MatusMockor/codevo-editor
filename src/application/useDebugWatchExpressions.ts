import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import {
  createDebugWatchState,
  reduceDebugWatchState,
  type DebugWatchDefinition,
  type DebugWatchState,
} from "../domain/debugWatchExpressions";
import {
  loadPersistedDebugWatchDefinitions,
  savePersistedDebugWatchDefinitions,
  type DebugWatchStorage,
} from "../domain/debugWatchPersistence";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
} from "../domain/debugVariablePages";

export interface DebugWatchEvaluation {
  readonly owner: DebugInspectionOwner;
  readonly definitionRevision: number;
  readonly frameId: number;
  readonly result: DebugEvaluationResult;
}

export interface UseDebugWatchExpressionsOptions {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly evaluateWatch: (expression: string) => Promise<DebugEvaluationResult | null>;
  readonly isWorkspaceTrusted?: () => boolean;
  readonly inspectionOwner: DebugInspectionOwner | null;
  readonly selectedFrameId: number | null;
  readonly snapshot: DebuggerSessionSnapshot;
  readonly storage?: DebugWatchStorage | null;
  readonly workspaceRoot: string | null;
  readonly refreshVersion?: number;
}

export interface UseDebugWatchExpressionsResult {
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, DebugWatchEvaluation>>;
  readonly pendingIds: readonly string[];
  add(expression: string, enabled?: boolean): boolean;
  canAdd(expression: string, enabled?: boolean): boolean;
  clear(): void;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  update(id: string, expression: string): void;
  invalidateEvaluations(): void;
}

interface RootWatchState {
  readonly rootKey: string | null;
  readonly state: DebugWatchState;
}

interface PendingWatchEvaluations {
  readonly owner: DebugInspectionOwner | null;
  readonly ids: readonly string[];
}

const emptyWatchState = createDebugWatchState();

export function useDebugWatchExpressions({
  debugAdapterKind,
  evaluateWatch,
  isWorkspaceTrusted = () => true,
  inspectionOwner,
  selectedFrameId,
  snapshot,
  storage,
  workspaceRoot,
  refreshVersion = 0,
}: UseDebugWatchExpressionsOptions): UseDebugWatchExpressionsResult {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  const trusted = isWorkspaceTrusted();
  const resolvedStorage = useMemo(
    () => (storage === undefined ? browserStorage() : storage),
    [storage],
  );
  const [rootState, setRootState] = useState<RootWatchState>({
    rootKey: null,
    state: emptyWatchState,
  });
  const rootStateRef = useRef(rootState);
  rootStateRef.current = rootState;
  const [evaluations, setEvaluations] = useState<Record<string, DebugWatchEvaluation>>({});
  const [pending, setPending] = useState<PendingWatchEvaluations>({ owner: null, ids: [] });
  const evaluationGenerationRef = useRef(0);
  const [evaluationInvalidation, setEvaluationInvalidation] = useState(0);
  const evaluateWatchRef = useRef(evaluateWatch);
  evaluateWatchRef.current = evaluateWatch;
  const skipPersistenceForRootRef = useRef<string | null>(null);
  const persistedStateRef = useRef<RootWatchState>({ rootKey: null, state: emptyWatchState });

  useEffect(() => {
    evaluationGenerationRef.current += 1;
    setEvaluations({});
    setPending({ owner: null, ids: [] });
    if (!workspaceRoot || !rootKey) {
      const empty = { rootKey: null, state: emptyWatchState };
      persistedStateRef.current = empty;
      rootStateRef.current = empty;
      setRootState(empty);
      return;
    }
    skipPersistenceForRootRef.current = rootKey;
    const definitions = resolvedStorage
      ? loadPersistedDebugWatchDefinitions(resolvedStorage, workspaceRoot)
      : [];
    const loaded = { rootKey, state: createDebugWatchState(definitions) };
    persistedStateRef.current = loaded;
    rootStateRef.current = loaded;
    setRootState(loaded);
  }, [resolvedStorage, rootKey, workspaceRoot]);

  useEffect(() => {
    if (!resolvedStorage || !workspaceRoot || rootState.rootKey !== rootKey) return;
    if (skipPersistenceForRootRef.current === rootKey) {
      skipPersistenceForRootRef.current = null;
      return;
    }
    if (
      persistedStateRef.current.rootKey === rootKey &&
      persistedStateRef.current.state === rootState.state
    ) {
      return;
    }
    if (
      savePersistedDebugWatchDefinitions(
        resolvedStorage,
        workspaceRoot,
        rootState.state.definitions,
      )
    ) {
      persistedStateRef.current = rootState;
      return;
    }

    const persisted = persistedStateRef.current;
    console.error("Failed to persist debug watches; reverting the in-memory change.");
    setRootState((current) =>
      current.rootKey === rootKey &&
      current.state === rootState.state &&
      persisted.rootKey === rootKey
        ? (rootStateRef.current = persisted)
        : current,
    );
  }, [resolvedStorage, rootKey, rootState, workspaceRoot]);

  const dispatch = useCallback(
    (action: Parameters<typeof reduceDebugWatchState>[1]) => {
      const current = rootStateRef.current;
      if (current.rootKey !== rootKey) return false;
      const next = reduceDebugWatchState(current.state, action);
      if (next === current.state) return false;
      const committed = { ...current, state: next };
      rootStateRef.current = committed;
      setRootState(committed);
      return true;
    },
    [rootKey],
  );

  const definitions = useMemo(
    () => (rootState.rootKey === rootKey ? rootState.state.definitions : []),
    [rootKey, rootState],
  );
  const sessionStateKind = snapshot.state.kind;
  const sessionId = snapshot.state.kind === "inactive" ? null : snapshot.state.sessionId;
  const stoppedFrameId =
    snapshot.state.kind === "stopped"
      ? (selectedFrameId ?? snapshot.state.topFrame?.frameId ?? null)
      : null;

  useEffect(() => {
    const generation = evaluationGenerationRef.current + 1;
    evaluationGenerationRef.current = generation;
    const enabled = definitions.filter((definition) => definition.enabled);
    if (
      !workspaceRoot ||
      !rootKey ||
      rootState.rootKey !== rootKey ||
      !trusted ||
      debugAdapterKind !== "node" ||
      sessionStateKind !== "stopped" ||
      stoppedFrameId === null ||
      inspectionOwner === null ||
      enabled.length === 0
    ) {
      setEvaluations({});
      setPending({ owner: null, ids: [] });
      return;
    }

    setEvaluations({});
    setPending({ owner: inspectionOwner, ids: enabled.map((definition) => definition.id) });
    for (const definition of enabled) {
      void evaluateWatchRef
        .current(definition.expression)
        .then((result) => {
          if (evaluationGenerationRef.current !== generation || result === null) return;
          setEvaluations((current) => ({
            ...current,
            [definition.id]: {
              owner: inspectionOwner,
              definitionRevision: definition.revision,
              frameId: stoppedFrameId,
              result,
            },
          }));
        })
        .catch((error: unknown) => {
          if (evaluationGenerationRef.current !== generation) return;
          setEvaluations((current) => ({
            ...current,
            [definition.id]: {
              owner: inspectionOwner,
              definitionRevision: definition.revision,
              frameId: stoppedFrameId,
              result: {
                status: "error",
                kind: "exception",
                message: error instanceof Error ? error.message : "Watch evaluation failed.",
              },
            },
          }));
        })
        .finally(() => {
          if (evaluationGenerationRef.current !== generation) return;
          setPending((current) =>
            debugInspectionOwnersEqual(current.owner, inspectionOwner)
              ? { ...current, ids: current.ids.filter((id) => id !== definition.id) }
              : current,
          );
        });
    }

    return () => {
      if (evaluationGenerationRef.current === generation) {
        evaluationGenerationRef.current += 1;
      }
    };
  }, [
    debugAdapterKind,
    definitions,
    inspectionOwner,
    rootKey,
    rootState.rootKey,
    sessionId,
    sessionStateKind,
    stoppedFrameId,
    trusted,
    workspaceRoot,
    evaluationInvalidation,
    refreshVersion,
  ]);

  const visibleEvaluations = Object.fromEntries(
    Object.entries(evaluations).filter(([id, evaluation]) => {
      const definition = definitions.find((candidate) => candidate.id === id);
      return (
        definition !== undefined &&
        definition.revision === evaluation.definitionRevision &&
        debugInspectionOwnersEqual(evaluation.owner, inspectionOwner)
      );
    }),
  );
  const canAdd = (expression: string, enabled = true): boolean => {
    const current = rootStateRef.current;
    if (current.rootKey !== rootKey) return false;
    return (
      reduceDebugWatchState(current.state, {
        type: "add",
        expression,
        enabled,
      }) !== current.state
    );
  };

  return {
    definitions,
    evaluations: visibleEvaluations,
    pendingIds: debugInspectionOwnersEqual(pending.owner, inspectionOwner) ? pending.ids : [],
    add: (expression, enabled) => dispatch({ type: "add", expression, enabled }),
    canAdd,
    clear: () => dispatch({ type: "clear" }),
    remove: (id) => dispatch({ type: "remove", id }),
    setEnabled: (id, enabled) => dispatch({ type: "set-enabled", id, enabled }),
    update: (id, expression) => dispatch({ type: "update", id, expression }),
    invalidateEvaluations: () => setEvaluationInvalidation((current) => current + 1),
  };
}

function browserStorage(): DebugWatchStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
