import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  canRefreshWatches,
  watchEvaluationRequestCurrent,
  watchRefreshOwner,
  watchRefreshOwnersEqual,
  workspaceTrustedNow,
  type PendingWatchRefreshEvaluations,
  type WatchRefreshAuthority,
} from "./debugWatchRefreshPolicy";

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
  readonly scheduleEvaluationPublication?: DebugWatchEvaluationPublicationScheduler;
}

export interface UseDebugWatchExpressionsResult {
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, DebugWatchEvaluation>>;
  readonly pendingIds: readonly string[];
  readonly refreshPending: boolean;
  add(expression: string, enabled?: boolean): boolean;
  canAdd(expression: string, enabled?: boolean): boolean;
  clear(): void;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  update(id: string, expression: string): void;
  canInvalidateEvaluations(): boolean;
  invalidateEvaluations(): boolean;
}

interface RootWatchState {
  readonly rootKey: string | null;
  readonly state: DebugWatchState;
}

interface CommittedWatchRefreshInputs {
  readonly authority: WatchRefreshAuthority | null;
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, DebugWatchEvaluation>>;
  readonly evaluateWatch: UseDebugWatchExpressionsOptions["evaluateWatch"];
  readonly pending: PendingWatchRefreshEvaluations;
  readonly token: object | null;
  readonly trustReader: () => boolean;
}

interface ScheduledWatchEvaluation {
  readonly generation: number;
  execute(): Promise<void>;
}

export type DebugWatchEvaluationPublicationScheduler = (publish: () => void) => () => void;

const emptyWatchState = createDebugWatchState();
export const MAX_CONCURRENT_DEBUG_WATCH_EVALUATIONS = 16;

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
  scheduleEvaluationPublication = defaultEvaluationPublicationScheduler,
}: UseDebugWatchExpressionsOptions): UseDebugWatchExpressionsResult {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  const trusted = workspaceTrustedNow(isWorkspaceTrusted);
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
  const [pending, setPending] = useState<PendingWatchRefreshEvaluations>({
    owner: null,
    ids: [],
  });
  const evaluationGenerationRef = useRef(0);
  const evaluationSchedulerRef = useRef<{
    flights: number;
    queue: ScheduledWatchEvaluation[];
  }>({ flights: 0, queue: [] });
  const drainEvaluationSchedulerRef = useRef<() => void>(() => undefined);
  drainEvaluationSchedulerRef.current = () => {
    const scheduler = evaluationSchedulerRef.current;
    while (
      scheduler.flights < MAX_CONCURRENT_DEBUG_WATCH_EVALUATIONS &&
      scheduler.queue.length > 0
    ) {
      const task = scheduler.queue.shift();
      if (!task) return;
      scheduler.flights += 1;
      void task.execute().finally(() => {
        const current = evaluationSchedulerRef.current;
        current.flights = Math.max(0, current.flights - 1);
        drainEvaluationSchedulerRef.current();
      });
    }
  };
  const [evaluationInvalidation, setEvaluationInvalidation] = useState(0);
  const manualRefreshLeaseRef = useRef<WatchRefreshAuthority | null>(null);
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
  const refreshAuthorityRef = useRef<{
    readonly authority: WatchRefreshAuthority | null;
    readonly epoch: number;
  }>({ authority: null, epoch: 0 });
  const [, publishRefreshAuthority] = useState(0);
  const nextRefreshOwner = watchRefreshOwner({
    debugAdapterKind,
    externalRefreshVersion: refreshVersion,
    inspectionOwner,
    rootKey,
    rootRevision: rootState.state.revision,
    rootStateKey: rootState.rootKey,
    sessionStateKind,
    snapshot,
    stoppedFrameId,
    trusted,
    workspaceRoot,
  });
  const refreshAuthority = watchRefreshOwnersEqual(
    refreshAuthorityRef.current.authority,
    nextRefreshOwner,
  )
    ? refreshAuthorityRef.current.authority
    : null;
  const renderRefreshReady = canRefreshWatches({
    captured: refreshAuthority,
    current: refreshAuthority,
    definitions,
    evaluations,
    lease: manualRefreshLeaseRef.current,
    pending,
    trustReader: isWorkspaceTrusted,
  });
  const refreshCommandToken = useMemo(
    () => Object.freeze({ authority: refreshAuthority, ready: renderRefreshReady }),
    [refreshAuthority, renderRefreshReady],
  );
  const committedRefreshInputsRef = useRef<CommittedWatchRefreshInputs>({
    authority: null,
    definitions: [],
    evaluations: {},
    evaluateWatch,
    pending: { owner: null, ids: [] },
    token: null,
    trustReader: isWorkspaceTrusted,
  });
  useLayoutEffect(() => {
    const authorityChanged = !watchRefreshOwnersEqual(
      refreshAuthorityRef.current.authority,
      nextRefreshOwner,
    );
    if (authorityChanged) {
      const epoch = refreshAuthorityRef.current.epoch + 1;
      refreshAuthorityRef.current = {
        authority: nextRefreshOwner ? { ...nextRefreshOwner, epoch } : null,
        epoch,
      };
      manualRefreshLeaseRef.current = null;
    }
    const tokenChanged = committedRefreshInputsRef.current.token !== refreshCommandToken;
    committedRefreshInputsRef.current = {
      authority: refreshAuthorityRef.current.authority,
      definitions,
      evaluations,
      evaluateWatch,
      pending,
      token: refreshCommandToken,
      trustReader: isWorkspaceTrusted,
    };
    if (authorityChanged || tokenChanged) {
      publishRefreshAuthority((current) => current + 1);
    }
  }, [
    definitions,
    evaluateWatch,
    evaluations,
    isWorkspaceTrusted,
    nextRefreshOwner,
    pending,
    refreshCommandToken,
  ]);

  useEffect(() => {
    const evaluationScheduler = evaluationSchedulerRef.current;
    const generation = evaluationGenerationRef.current + 1;
    evaluationGenerationRef.current = generation;
    const enabled = definitions.filter((definition) => definition.enabled);
    const requestAuthority = refreshAuthority;
    if (
      !workspaceRoot ||
      !rootKey ||
      rootState.rootKey !== rootKey ||
      !trusted ||
      debugAdapterKind !== "node" ||
      sessionStateKind !== "stopped" ||
      stoppedFrameId === null ||
      inspectionOwner === null ||
      requestAuthority === null ||
      enabled.length === 0
    ) {
      setEvaluations({});
      setPending({ owner: null, ids: [] });
      manualRefreshLeaseRef.current = null;
      return;
    }

    setEvaluations({});
    setPending({ owner: inspectionOwner, ids: enabled.map((definition) => definition.id) });
    let remaining = enabled.length;
    let cancelled = false;
    let bufferedEvaluations: Record<string, DebugWatchEvaluation> = {};
    const completedIds = new Set<string>();
    let cancelPublication: (() => void) | null = null;
    const requestInputs = committedRefreshInputsRef.current;

    const requestIsCurrent = (): boolean =>
      !cancelled &&
      watchEvaluationRequestCurrent({
        current: committedRefreshInputsRef.current.authority,
        generation,
        request: requestAuthority,
        requestGeneration: evaluationGenerationRef.current,
        trustReader: committedRefreshInputsRef.current.trustReader,
      });
    const publishSettled = (): void => {
      cancelPublication = null;
      if (!requestIsCurrent()) {
        bufferedEvaluations = {};
        completedIds.clear();
        return;
      }
      const evaluationsBatch = bufferedEvaluations;
      const settledIds = new Set(completedIds);
      bufferedEvaluations = {};
      completedIds.clear();
      if (Object.keys(evaluationsBatch).length > 0) {
        setEvaluations((current) => ({ ...current, ...evaluationsBatch }));
      }
      if (settledIds.size > 0) {
        setPending((current) =>
          debugInspectionOwnersEqual(current.owner, inspectionOwner)
            ? { ...current, ids: current.ids.filter((id) => !settledIds.has(id)) }
            : current,
        );
      }
    };
    const schedulePublication = (): void => {
      if (cancelPublication) return;
      cancelPublication = scheduleEvaluationPublication(publishSettled);
    };
    const retireStaleGeneration = (): void => {
      if (evaluationGenerationRef.current !== generation) return;
      evaluationGenerationRef.current += 1;
      const lease = manualRefreshLeaseRef.current;
      if (
        lease &&
        refreshAuthorityRef.current.authority?.epoch === lease.epoch &&
        watchRefreshOwnersEqual(lease, refreshAuthorityRef.current.authority)
      ) {
        manualRefreshLeaseRef.current = null;
      }
      setEvaluations({});
      setPending({ owner: null, ids: [] });
    };
    const settleDefinition = (
      definition: DebugWatchDefinition,
      result: DebugEvaluationResult | null,
    ): void => {
      if (!requestIsCurrent()) {
        retireStaleGeneration();
        return;
      }
      if (result !== null) {
        bufferedEvaluations[definition.id] = {
          owner: inspectionOwner,
          definitionRevision: definition.revision,
          frameId: stoppedFrameId,
          result,
        };
      }
      completedIds.add(definition.id);
      remaining -= 1;
      if (remaining === 0) {
        const lease = manualRefreshLeaseRef.current;
        if (
          lease &&
          refreshAuthorityRef.current.authority?.epoch === lease.epoch &&
          watchRefreshOwnersEqual(lease, refreshAuthorityRef.current.authority)
        ) {
          manualRefreshLeaseRef.current = null;
        }
      }
      schedulePublication();
    };
    evaluationScheduler.queue.push(
      ...enabled.map((definition) => ({
        generation,
        execute: async (): Promise<void> => {
          if (!requestIsCurrent()) return;
          try {
            settleDefinition(definition, await requestInputs.evaluateWatch(definition.expression));
          } catch (error: unknown) {
            settleDefinition(definition, {
              status: "error",
              kind: "exception",
              message: error instanceof Error ? error.message : "Watch evaluation failed.",
            });
          }
        },
      })),
    );
    drainEvaluationSchedulerRef.current();

    return () => {
      cancelled = true;
      cancelPublication?.();
      cancelPublication = null;
      evaluationScheduler.queue = evaluationScheduler.queue.filter(
        (task) => task.generation !== generation,
      );
      bufferedEvaluations = {};
      completedIds.clear();
      const lease = manualRefreshLeaseRef.current;
      if (
        lease &&
        refreshAuthorityRef.current.authority?.epoch === lease.epoch &&
        watchRefreshOwnersEqual(lease, refreshAuthorityRef.current.authority)
      ) {
        manualRefreshLeaseRef.current = null;
      }
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
    refreshAuthority,
    refreshVersion,
    scheduleEvaluationPublication,
  ]);

  const canInvalidateEvaluations = useCallback(() => {
    const committed = committedRefreshInputsRef.current;
    if (committed.token !== refreshCommandToken) return false;
    return canRefreshWatches({
      captured: refreshAuthority,
      current: committed.authority,
      definitions: committed.definitions,
      evaluations: committed.evaluations,
      lease: manualRefreshLeaseRef.current,
      pending: committed.pending,
      trustReader: committed.trustReader,
    });
  }, [refreshAuthority, refreshCommandToken]);
  const invalidateEvaluations = useCallback((): boolean => {
    const committed = committedRefreshInputsRef.current;
    if (
      committed.token !== refreshCommandToken ||
      !canRefreshWatches({
        captured: refreshAuthority,
        current: committed.authority,
        definitions: committed.definitions,
        evaluations: committed.evaluations,
        lease: manualRefreshLeaseRef.current,
        pending: committed.pending,
        trustReader: committed.trustReader,
      }) ||
      !refreshAuthority
    ) {
      return false;
    }
    manualRefreshLeaseRef.current = refreshAuthority;
    setEvaluationInvalidation((current) => current + 1);
    return true;
  }, [refreshAuthority, refreshCommandToken]);

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
  const visiblePendingIds = debugInspectionOwnersEqual(pending.owner, inspectionOwner)
    ? pending.ids
    : [];

  return {
    definitions,
    evaluations: visibleEvaluations,
    pendingIds: visiblePendingIds,
    refreshPending: manualRefreshLeaseRef.current !== null || visiblePendingIds.length > 0,
    add: (expression, enabled) => dispatch({ type: "add", expression, enabled }),
    canAdd,
    clear: () => dispatch({ type: "clear" }),
    remove: (id) => dispatch({ type: "remove", id }),
    setEnabled: (id, enabled) => dispatch({ type: "set-enabled", id, enabled }),
    update: (id, expression) => dispatch({ type: "update", id, expression }),
    canInvalidateEvaluations,
    invalidateEvaluations,
  };
}

function browserStorage(): DebugWatchStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function defaultEvaluationPublicationScheduler(publish: () => void): () => void {
  if (
    typeof globalThis.requestAnimationFrame === "function" &&
    typeof globalThis.cancelAnimationFrame === "function"
  ) {
    const frame = globalThis.requestAnimationFrame(publish);
    return () => globalThis.cancelAnimationFrame(frame);
  }
  const timer = globalThis.setTimeout(publish, 0);
  return () => globalThis.clearTimeout(timer);
}
