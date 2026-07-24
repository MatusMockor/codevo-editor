import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Breakpoint,
  DebugCompoundLaunchTarget,
  DebugEvent,
  DebugExceptionPauseMode,
  DebugLaunchTarget,
  DebugSetBreakpointsActiveRequest,
  DebugVariable,
  StepKind,
} from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import {
  breakpointsForDebugSession,
  isBreakpointPathSupported,
} from "../domain/debugBreakpointPolicy";
import {
  applyVerification,
  countBreakpoints,
  sequentialBreakpointIdFactory,
} from "../domain/debugBreakpoints";
import { reduceDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  DebugOutputLine,
  DebugRunToLocationCandidate,
  UseDebugSessionOptions,
  UseDebugSessionResult,
} from "./debugSessionContracts";
import { useDebugExceptionPause } from "./useDebugExceptionPause";
import { useDebugEvaluation } from "./useDebugEvaluation";
import { useDebugBreakpointManagement } from "./useDebugBreakpointManagement";
import { createDebugBreakpointSynchronization } from "./debugBreakpointSynchronization";
import { useDebugRestartFrameSessionLifecycle } from "./useDebugRestartFrameLifecycle";
import { useDebugSessionEventProjection } from "./useDebugSessionEventProjection";
import { useDebugSetVariable } from "./useDebugSetVariable";
import { useDebugSetExpression } from "./useDebugSetExpression";
import { useDebugVariableMutationRows } from "./useDebugVariableMutationRows";
import {
  useDebugSessionEnd,
  type DebugSessionOwner,
  type PendingActiveStop,
} from "./useDebugSessionEnd";
import { DebugRestartCoordinator, type DebugRestartAttempt } from "./debugRestartCoordinator";
import { useDebugBreakpointActivation } from "./useDebugBreakpointActivation";
import {
  createDebugVariablePagesState,
  debugInspectionOwnersEqual,
  MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS,
  reduceDebugVariablePages,
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import type { DebugConsoleCompletionQuery } from "../domain/debugConsoleCompletions";
import { DebugCompoundSessionProjection } from "./debugCompoundSessionProjection";
import { NodeDebugCompoundSessionCoordinator } from "./nodeDebugCompoundSessionCoordinator";
import {
  startDebugCompoundAccepted as startDebugCompound,
  type ActiveDebugCompound,
} from "./debugCompoundStart";
import { selectDebugFrame, type DebugFrameSelection } from "./debugFrameSelection";
import {
  activeDebugSessionId,
  exactWorkspaceOwnerCurrent,
  trustedWorkspace,
} from "./debugSessionOwnership";
import {
  acceptLegacyDebugStart,
  acceptNodeAttachCandidateStart,
  classifyDebugStartAcceptance,
  legacyDebugStartDescriptor,
  type DebugStartDescriptor,
} from "./debugStartDescriptor";
import { confirmDebugStart } from "./debugStartConfirmation";
import {
  emptyBreakpoints,
  emptyCompoundSessionIds,
  emptyEvaluationHistory,
  emptyOutput,
  emptyScopes,
  inactiveSnapshot,
} from "./debugSessionDefaults";

export type {
  ActiveDebugAdapterKind,
  DebugOutputLine,
  NodeDebugAttachCandidateStartPort,
  UseDebugSessionOptions,
  UseDebugSessionResult,
} from "./debugSessionContracts";

const COMPOUND_POLICY_SYNC_ERROR = "Unable to synchronize the active debug compound.";

interface PendingRestart {
  readonly attempt: DebugRestartAttempt;
  readonly coordinator: DebugRestartCoordinator;
  cancelled: boolean;
  promise: Promise<void>;
  readonly workspaceId: string | null;
}

export function useDebugSession(options: UseDebugSessionOptions): UseDebugSessionResult {
  return useWorkbenchDebugSession(options).session;
}

/** Internal workbench composition seam; capability-bearing start ports stay out of public session state. */
export function useWorkbenchDebugSession({
  gateway,
  isWorkspaceCurrent,
  isWorkspaceTrusted = () => true,
  nodeDebugAttachCandidateStart,
  workspaceId = null,
  workspaceRoot,
}: UseDebugSessionOptions) {
  const [snapshots, setSnapshots] = useState<Record<string, DebuggerSessionSnapshot>>({});
  const [breakpointsByRoot, setBreakpointsByRoot] = useState<Record<string, Breakpoint[]>>({});
  const [breakpointBulkPendingByRoot, setBreakpointBulkPendingByRoot] = useState<
    Record<string, boolean>
  >({});
  const [outputBySession, setOutputBySession] = useState<Record<number, DebugOutputLine[]>>({});
  const [evaluationHistoryBySession, setEvaluationHistoryBySession] = useState<
    Record<string, string[]>
  >({});
  const [pauseGenerationByRoot, setPauseGenerationByRoot] = useState<Record<string, number>>({});
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const [restartPendingByRoot, setRestartPendingByRoot] = useState<Record<string, boolean>>({});
  const [controlPendingByRoot, setControlPendingByRoot] = useState<Record<string, boolean>>({});
  const [stopPendingByRoot, setStopPendingByRoot] = useState<Record<string, boolean>>({});
  const [startPendingByRoot, setStartPendingByRoot] = useState<Record<string, boolean>>({});
  const [debugCompoundActive, setDebugCompoundActive] = useState(false);
  const [debugCompoundStartPending, setDebugCompoundStartPending] = useState(false);
  const [frameSelectionByRoot, setFrameSelectionByRoot] = useState<
    Record<string, DebugFrameSelection | null>
  >({});
  const [variablePages, setVariablePages] = useState<DebugVariablePagesState>(() =>
    createDebugVariablePagesState(),
  );
  const [debugInspectionRevision, setDebugInspectionRevision] = useState(0);

  const [createBreakpointId] = useState(() => sequentialBreakpointIdFactory());
  const currentRootRef = useRef(workspaceRoot);
  currentRootRef.current = workspaceRoot;
  const currentWorkspaceIdRef = useRef(workspaceId);
  currentWorkspaceIdRef.current = workspaceId;
  const workspaceOwnerEpochRef = useRef({ epoch: 0, workspaceId, workspaceRoot });
  if (
    workspaceOwnerEpochRef.current.workspaceId !== workspaceId ||
    workspaceOwnerEpochRef.current.workspaceRoot !== workspaceRoot
  ) {
    workspaceOwnerEpochRef.current = {
      epoch: workspaceOwnerEpochRef.current.epoch + 1,
      workspaceId,
      workspaceRoot,
    };
  }
  const isWorkspaceCurrentRef = useRef(isWorkspaceCurrent);
  isWorkspaceCurrentRef.current = isWorkspaceCurrent;
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const breakpointsByRootRef = useRef(breakpointsByRoot);
  const frameSelectionByRootRef = useRef(frameSelectionByRoot);
  frameSelectionByRootRef.current = frameSelectionByRoot;
  const mountedRef = useRef(true);
  const pendingStartKeysRef = useRef(new Set<string>());
  const pendingConfirmedStartKeysRef = useRef(new Set<string>());
  const pendingConfirmedStartEventsRef = useRef(new Map<string, Map<number, DebugEvent[]>>());
  const pendingStopKeysRef = useRef(new Set<string>());
  const pendingActiveStopsRef = useRef(new Map<string, PendingActiveStop>());
  const pendingRestartsRef = useRef(new Map<string, PendingRestart>());
  const pendingControlsRef = useRef(new Map<string, Promise<unknown>>());
  const restartCoordinatorsRef = useRef(new Map<string, DebugRestartCoordinator>());
  const restartOwnerIdsRef = useRef(new Map<string, string | null>());
  const sessionOwnersRef = useRef(new Map<string, DebugSessionOwner>());
  const sessionsByRootRef = useRef<Record<string, number[]>>({});
  const pendingBreakpointBulkMutationsRef = useRef(new Map<string, Promise<void>>());
  const breakpointSynchronizationRef = useRef(createDebugBreakpointSynchronization());
  const pendingBreakpointAdaptersRef = useRef<Record<string, "node" | "php">>({});
  const pauseGenerationByRootRef = useRef<Record<string, number>>({});
  const compoundCoordinatorRef = useRef(new NodeDebugCompoundSessionCoordinator());
  const compoundProjectionRef = useRef(new DebugCompoundSessionProjection());
  const activeCompoundRef = useRef<ActiveDebugCompound | null>(null);
  const failClosedCompoundPolicyRef = useRef<
    (rootPath: string, selectedSessionId: number) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    if (!workspaceRoot) return;
    const key = normalizedWorkspaceRootKey(workspaceRoot);
    if (
      restartOwnerIdsRef.current.has(key) &&
      restartOwnerIdsRef.current.get(key) !== workspaceId
    ) {
      restartCoordinatorsRef.current.get(key)?.clear();
      restartOwnerIdsRef.current.delete(key);
    }
  }, [workspaceId, workspaceRoot]);
  const variablePagesRef = useRef(variablePages);
  variablePagesRef.current = variablePages;
  const variablePageRequestsRef = useRef(new Map<string, string>());
  const variablePageFlightsRef = useRef(new Set<string>());
  const variablePageRequestIdRef = useRef(0);
  const evaluationRequestIdRef = useRef(0);
  const activeEvaluationRequestsRef = useRef(new Set<number>());
  const sideEffectingEvaluationFlightsRef = useRef(new Set<string>());
  const frameSelectionGenerationByRootRef = useRef<Record<string, number>>({});

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commitBreakpoints = useCallback((key: string, list: Breakpoint[]) => {
    breakpointsByRootRef.current = {
      ...breakpointsByRootRef.current,
      [key]: list,
    };
    setBreakpointsByRoot(breakpointsByRootRef.current);
  }, []);

  const setPauseGeneration = useCallback((key: string, generation: number) => {
    pauseGenerationByRootRef.current = {
      ...pauseGenerationByRootRef.current,
      [key]: generation,
    };
    setPauseGenerationByRoot(pauseGenerationByRootRef.current);
  }, []);

  const activeSessionId = useCallback((): number | null => {
    return activeDebugSessionId(currentRootRef.current, snapshotsRef.current);
  }, []);
  const isExactWorkspaceOwnerCurrent = useCallback(
    (rootPath: string, requestedWorkspaceId: string | null): boolean =>
      exactWorkspaceOwnerCurrent(
        currentRootRef.current,
        currentWorkspaceIdRef.current,
        isWorkspaceCurrentRef.current,
        rootPath,
        requestedWorkspaceId,
      ),
    [],
  );
  const exactLiveCompoundSessionIds = useCallback(
    (rootPath: string, selectedSessionId: number): readonly number[] | null => {
      const compound = activeCompoundRef.current;
      if (!compound) return null;
      if (
        compound.policyDiverged ||
        !compound.projectionLease ||
        !workspaceRootKeysEqual(rootPath, compound.owner.rootPath) ||
        compound.owner.workspaceEpoch !== workspaceOwnerEpochRef.current.epoch ||
        compound.owner.workspaceId !== currentWorkspaceIdRef.current ||
        !isExactWorkspaceOwnerCurrent(compound.owner.rootPath, compound.owner.workspaceId) ||
        !trustedWorkspace(isWorkspaceTrusted) ||
        compoundProjectionRef.current.snapshot().kind !== "active" ||
        compoundProjectionRef.current.selectedSessionId(compound.projectionLease) !==
          selectedSessionId
      ) {
        return emptyCompoundSessionIds;
      }
      const live = [...compound.childSnapshots.entries()]
        .filter(([, snapshot]) => snapshot.state.kind !== "terminated")
        .map(([sessionId]) => sessionId);
      return live.length >= 2 && live.length <= 4 ? Object.freeze(live) : emptyCompoundSessionIds;
    },
    [isExactWorkspaceOwnerCurrent, isWorkspaceTrusted],
  );
  const setExceptionPauseForSession = useCallback(
    async (rootPath: string, sessionId: number, mode: DebugExceptionPauseMode) => {
      const compoundSessionIds = exactLiveCompoundSessionIds(rootPath, sessionId);
      if (compoundSessionIds === null) {
        await gateway.setExceptionPause(sessionId, mode);
        return;
      }
      if (compoundSessionIds.length === 0) throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      try {
        await Promise.all(
          compoundSessionIds.map((compoundSessionId) =>
            gateway.setExceptionPause(compoundSessionId, mode),
          ),
        );
      } catch {
        await failClosedCompoundPolicyRef.current(rootPath, sessionId);
        throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      }
    },
    [exactLiveCompoundSessionIds, gateway],
  );
  const setBreakpointsActiveForSession = useCallback(
    async (request: DebugSetBreakpointsActiveRequest) => {
      const setActive = gateway.setBreakpointsActive;
      if (!setActive) throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      const compoundSessionIds = exactLiveCompoundSessionIds(request.rootPath, request.sessionId);
      if (compoundSessionIds === null) {
        await setActive.call(gateway, request);
        return;
      }
      if (compoundSessionIds.length === 0) throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      try {
        await Promise.all(
          compoundSessionIds.map((sessionId) => setActive.call(gateway, { ...request, sessionId })),
        );
      } catch {
        await failClosedCompoundPolicyRef.current(request.rootPath, request.sessionId);
        throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      }
    },
    [exactLiveCompoundSessionIds, gateway],
  );
  const {
    adapterKindForSession,
    adoptSession: adoptExceptionPauseSession,
    debugAdapterKind,
    exceptionPauseError,
    exceptionPauseMode,
    exceptionPausePending,
    setExceptionPauseMode,
    startPolicy: exceptionPauseStartPolicy,
    startPolicyForAdapter: exceptionPauseStartPolicyForAdapter,
  } = useDebugExceptionPause({
    activeSessionId,
    gateway,
    setExceptionPauseForSession,
    workspaceRoot,
  });

  const applyBreakpointsVerifiedEvent = useCallback(
    (event: DebugEvent) => {
      if (event.payload.kind !== "breakpointsVerified") return;
      const key = normalizedWorkspaceRootKey(event.rootPath);
      const adapterKind =
        adapterKindForSession(event.rootPath, event.sessionId) ??
        pendingBreakpointAdaptersRef.current[key] ??
        null;
      if (
        adapterKind === null ||
        !isBreakpointPathSupported(event.rootPath, adapterKind, event.payload.filePath)
      ) {
        return;
      }
      breakpointSynchronizationRef.current.begin(key, event.sessionId, event.payload.filePath);
      commitBreakpoints(
        key,
        applyVerification(
          breakpointsByRootRef.current[key] ?? [],
          event.payload.filePath,
          event.payload.breakpoints,
        ),
      );
    },
    [adapterKindForSession, commitBreakpoints],
  );

  const activeControlSessionIdRef = useRef<() => number | null>(() => null);
  const {
    activatedFor: breakpointsActivatedFor,
    adopt: adoptBreakpointsActivation,
    canToggle: canToggleBreakpointsActivated,
    clear: clearBreakpointsActivation,
    toggle: toggleBreakpointsActivated,
  } = useDebugBreakpointActivation({
    activeControlSessionId: () => activeControlSessionIdRef.current(),
    adapterKindForSession,
    currentRootRef,
    currentWorkspaceIdRef,
    gateway,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
    mountedRef,
    pendingBreakpointBulkMutationsRef,
    pendingControlsRef,
    sessionOwnersRef,
    setBreakpointsActiveForSession,
    setControlPendingByRoot,
    snapshotsRef,
    workspaceOwnerEpochRef,
  });

  const finalizeExactSession = useCallback(
    (key: string, sessionId: number) => {
      const currentSnapshot = snapshotsRef.current[key] ?? inactiveSnapshot;
      const currentState = currentSnapshot.state;
      if (
        currentState.kind === "inactive" ||
        currentState.kind === "terminated" ||
        debuggerSessionId(currentState) !== sessionId
      ) {
        return;
      }
      const updated = {
        ...snapshotsRef.current,
        [key]: {
          lastSeq: currentSnapshot.lastSeq,
          state: { exitCode: null, kind: "terminated" as const, sessionId },
        },
      };
      snapshotsRef.current = updated;
      setSnapshots(updated);
      setPauseGeneration(key, 0);
      clearBreakpointsActivation(key, sessionId);
      setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
      const owner = sessionOwnersRef.current.get(key);
      if (owner?.sessionId === sessionId) sessionOwnersRef.current.delete(key);
    },
    [clearBreakpointsActivation, setPauseGeneration],
  );

  const restartFrameLifecycle = useDebugRestartFrameSessionLifecycle({
    activeEvaluationRequestsRef,
    adapterKindForSession,
    currentRootRef,
    currentWorkspaceIdRef,
    frameSelectionByRootRef,
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
    setFrameSelectionByRoot,
    setPauseGeneration,
    setSnapshots,
    setVariablePages,
    snapshotsRef,
    variablePageRequestsRef,
  });
  const observeRestartFrameEvent = restartFrameLifecycle.observeEvent;

  useDebugSessionEventProjection({
    activeCompoundRef,
    adapterKindForSession,
    applyBreakpointsVerifiedEvent,
    adoptBreakpointsActivation,
    adoptExceptionPauseSession,
    clearBreakpointsActivation,
    compoundCoordinatorRef,
    compoundProjectionRef,
    currentWorkspaceIdRef,
    finalizeExactSession,
    gateway,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
    mountedRef,
    observeRestartFrameEvent,
    pendingConfirmedStartEventsRef,
    pendingConfirmedStartKeysRef,
    pendingRestartsRef,
    pendingStartKeysRef,
    restartCoordinatorsRef,
    sessionOwnersRef,
    setDebugCompoundActive,
    setFrameSelectionByRoot,
    setOutputBySession,
    setPauseGeneration,
    setSnapshots,
    snapshotsRef,
    workspaceOwnerEpochRef,
  });

  const startDebugRequest = useCallback(
    async (
      descriptor: DebugStartDescriptor,
      alreadyStoppedSessionId: number | null = null,
      acceptAlreadyTerminatedSession = false,
    ) => {
      const requestedRoot = currentRootRef.current;
      const requestedWorkspaceId = currentWorkspaceIdRef.current;

      if (
        !requestedRoot ||
        !trustedWorkspace(isWorkspaceTrusted) ||
        !isExactWorkspaceOwnerCurrent(requestedRoot, requestedWorkspaceId)
      ) {
        return;
      }

      const key = normalizedWorkspaceRootKey(requestedRoot);

      const pendingRestart = pendingRestartsRef.current.get(key);
      if (
        activeCompoundRef.current !== null ||
        pendingStartKeysRef.current.has(key) ||
        pendingActiveStopsRef.current.has(key) ||
        pendingControlsRef.current.has(key) ||
        (pendingRestart && pendingRestart.attempt.sessionId !== alreadyStoppedSessionId)
      ) {
        return;
      }

      pendingStartKeysRef.current.add(key);
      if (descriptor.confirmStart) pendingConfirmedStartKeysRef.current.add(key);
      pendingBreakpointAdaptersRef.current = {
        ...pendingBreakpointAdaptersRef.current,
        [key]: descriptor.adapterKind,
      };
      setStartPendingByRoot((current) => ({ ...current, [key]: true }));
      const policy = exceptionPauseStartPolicyForAdapter(requestedRoot, descriptor.adapterKind);

      try {
        if (!startDescriptorAuthorized(descriptor)) return;
        const status = await descriptor.start(
          requestedRoot,
          breakpointsForDebugSession(
            requestedRoot,
            descriptor.adapterKind,
            breakpointsByRootRef.current[key] ?? [],
          ),
          policy.mode,
        );
        if (status.kind !== "ok") {
          if (
            !isExactWorkspaceOwnerCurrent(requestedRoot, requestedWorkspaceId) ||
            !trustedWorkspace(isWorkspaceTrusted) ||
            !startDescriptorAuthorized(descriptor) ||
            !mountedRef.current
          ) {
            return;
          }

          setStartErrors((current) => ({ ...current, [key]: status.message }));
          return;
        }

        const accepted = await confirmDebugStart({
          descriptor,
          gateway,
          isAuthorized: () =>
            isExactWorkspaceOwnerCurrent(requestedRoot, requestedWorkspaceId) &&
            trustedWorkspace(isWorkspaceTrusted) &&
            startDescriptorAuthorized(descriptor),
          isMounted: () => mountedRef.current,
          rootPath: requestedRoot,
          sessionId: status.sessionId,
          takeStopRequest: () => pendingStopKeysRef.current.delete(key),
        });
        if (!accepted) return;
        const existing = snapshotsRef.current[key] ?? inactiveSnapshot;
        const supersededSessionId =
          existing.state.kind === "terminated" ? null : debuggerSessionId(existing.state);

        // A successful backend start atomically supersedes the root's previous runtime session.
        // Do not issue a second stop: the old backend session has already been removed and a
        // best-effort promise here could reject after the new session has been accepted.
        if (supersededSessionId !== status.sessionId) setPauseGeneration(key, 0);

        const previousSessions = sessionsByRootRef.current[key] ?? [];
        sessionsByRootRef.current = {
          ...sessionsByRootRef.current,
          [key]: [status.sessionId],
        };
        setStartErrors((current) => {
          const next = { ...current };
          delete next[key];

          return next;
        });
        setOutputBySession((current) => {
          const next = { ...current };

          for (const sessionId of previousSessions) {
            delete next[sessionId];
          }

          next[status.sessionId] = [];

          return next;
        });
        setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
        const currentSnapshot = snapshotsRef.current[key] ?? inactiveSnapshot;
        const currentSessionId = debuggerSessionId(currentSnapshot.state);
        if (currentSessionId !== status.sessionId || currentSnapshot.lastSeq === 0) {
          const updated: Record<string, DebuggerSessionSnapshot> = {
            ...snapshotsRef.current,
            [key]: {
              state: { kind: "running", sessionId: status.sessionId },
              lastSeq: 0,
            },
          };
          snapshotsRef.current = updated;
          setSnapshots(updated);
        }
        const pendingConfirmedEvents =
          pendingConfirmedStartEventsRef.current.get(key)?.get(status.sessionId) ?? [];
        pendingConfirmedStartEventsRef.current.delete(key);
        let replayedSnapshot = snapshotsRef.current[key] ?? inactiveSnapshot;
        for (const event of pendingConfirmedEvents) {
          if (event.sessionId !== status.sessionId) continue;
          const next = reduceDebuggerSnapshot(replayedSnapshot, event);
          if (next === replayedSnapshot) continue;
          replayedSnapshot = next;
          if (event.payload.kind === "stopped") {
            setPauseGeneration(key, event.payload.pauseGeneration);
          } else if (event.payload.kind === "resumed" || event.payload.kind === "terminated") {
            setPauseGeneration(key, 0);
          } else if (event.payload.kind === "breakpointsVerified") {
            applyBreakpointsVerifiedEvent(event);
          }
        }
        if (replayedSnapshot !== snapshotsRef.current[key]) {
          snapshotsRef.current = {
            ...snapshotsRef.current,
            [key]: replayedSnapshot,
          };
          setSnapshots(snapshotsRef.current);
        }
        const acceptance = classifyDebugStartAcceptance(
          snapshotsRef.current[key] ?? inactiveSnapshot,
          status.sessionId,
          acceptAlreadyTerminatedSession,
        );
        if (acceptance.kind !== "live") {
          return acceptance.kind === "terminated" ? acceptance.sessionId : undefined;
        }

        const restartCoordinator =
          restartCoordinatorsRef.current.get(key) ?? new DebugRestartCoordinator();
        restartCoordinatorsRef.current.set(key, restartCoordinator);
        sessionOwnersRef.current.set(key, {
          sessionId: status.sessionId,
          targetKind: descriptor.targetKind,
          workspaceId: requestedWorkspaceId,
        });
        adoptBreakpointsActivation(key, status.sessionId);
        if (
          descriptor.restartLaunch !== null &&
          restartCoordinator.retain(requestedRoot, status.sessionId, descriptor.restartLaunch)
        ) {
          restartOwnerIdsRef.current.set(key, requestedWorkspaceId);
        } else {
          restartCoordinator.clear();
          restartOwnerIdsRef.current.delete(key);
        }
        adoptExceptionPauseSession(requestedRoot, status.sessionId, policy.adapterKind);
        return status.sessionId;
      } finally {
        pendingStopKeysRef.current.delete(key);
        pendingConfirmedStartEventsRef.current.delete(key);
        pendingConfirmedStartKeysRef.current.delete(key);
        pendingStartKeysRef.current.delete(key);
        const nextPendingAdapters = { ...pendingBreakpointAdaptersRef.current };
        delete nextPendingAdapters[key];
        pendingBreakpointAdaptersRef.current = nextPendingAdapters;
        if (mountedRef.current) {
          setStartPendingByRoot((current) => ({ ...current, [key]: false }));
        }
      }
    },
    [
      adoptExceptionPauseSession,
      adoptBreakpointsActivation,
      applyBreakpointsVerifiedEvent,
      exceptionPauseStartPolicyForAdapter,
      gateway,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      setPauseGeneration,
    ],
  );

  const startDebugAccepted = useCallback(
    (launch: DebugLaunchTarget) => acceptLegacyDebugStart(gateway, startDebugRequest, launch),
    [gateway, startDebugRequest],
  );
  const startDebugSessionAccepted = useCallback(
    async (launch: DebugLaunchTarget) =>
      (await startDebugRequest(legacyDebugStartDescriptor(gateway, launch), null, true)) ?? null,
    [gateway, startDebugRequest],
  );
  const startDebugDescriptorSessionAccepted = useCallback(
    async (descriptor: DebugStartDescriptor) =>
      (await startDebugRequest(descriptor, null, true)) ?? null,
    [startDebugRequest],
  );
  const startNodeAttachCandidateAccepted = useCallback(
    (candidateLeaseId: string) =>
      acceptNodeAttachCandidateStart(
        nodeDebugAttachCandidateStart,
        startDebugRequest,
        candidateLeaseId,
      ),
    [nodeDebugAttachCandidateStart, startDebugRequest],
  );
  const startDebug = useCallback(
    async (launch: DebugLaunchTarget) => {
      await startDebugAccepted(launch);
    },
    [startDebugAccepted],
  );

  const startDebugCompoundAccepted = useCallback(
    (members: readonly DebugCompoundLaunchTarget[]) =>
      startDebugCompound(
        {
          activeCompoundRef,
          adoptBreakpointsActivation,
          adoptExceptionPauseSession,
          breakpointsByRootRef,
          clearFrameSelection: (key) =>
            setFrameSelectionByRoot((current) => ({ ...current, [key]: null })),
          compoundCoordinator: compoundCoordinatorRef.current,
          compoundProjection: compoundProjectionRef.current,
          currentRootRef,
          currentWorkspaceIdRef,
          exceptionPauseStartPolicy,
          gateway,
          isExactWorkspaceOwnerCurrent,
          isWorkspaceTrusted,
          mountedRef,
          pendingActiveStopsRef,
          pendingControlsRef,
          pendingRestartsRef,
          pendingStartKeysRef,
          sessionOwnersRef,
          sessionsByRootRef,
          setDebugCompoundActive,
          setDebugCompoundStartPending,
          setOutputBySession,
          setPauseGeneration,
          setSnapshots,
          setStartErrors,
          setStartPendingByRoot,
          snapshotsRef,
          workspaceOwnerEpochRef,
        },
        members,
      ),
    [
      adoptBreakpointsActivation,
      adoptExceptionPauseSession,
      exceptionPauseStartPolicy,
      gateway,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      setPauseGeneration,
    ],
  );

  const {
    disconnectDebug: disconnectSingleDebug,
    disconnectExactDebugSession: disconnectExactSingleDebugSession,
    stopDebug: stopSingleDebug,
    stopExactDebugSession: stopExactSingleDebugSession,
  } = useDebugSessionEnd({
    activeSessionId,
    currentRootRef,
    currentWorkspaceIdRef,
    finalizeExactSession,
    gateway,
    isExactWorkspaceOwnerCurrent,
    mountedRef,
    pendingActiveStopsRef,
    pendingControlsRef,
    pendingRestartsRef,
    pendingStartKeysRef,
    pendingStopKeysRef,
    restartCoordinatorsRef,
    sessionOwnersRef,
    setStopPendingByRoot,
  });

  const stopDebug = useCallback(async () => {
    const compound = activeCompoundRef.current;
    if (!compound) {
      await stopSingleDebug();
      return;
    }
    const root = currentRootRef.current;
    if (
      !root ||
      !workspaceRootKeysEqual(root, compound.owner.rootPath) ||
      !isExactWorkspaceOwnerCurrent(compound.owner.rootPath, compound.owner.workspaceId)
    ) {
      return;
    }
    if (compound.stopPromise) {
      await compound.stopPromise;
      return;
    }
    if (compound.representativeSessionId === null) {
      if (compound.cancelPromise) {
        await compound.cancelPromise;
        return;
      }
      const key = normalizedWorkspaceRootKey(root);
      compound.cancelRequested = true;
      const cancellation = (async () => {
        await compound.startSettlement;
        if (compound.stopPromise) await compound.stopPromise;
      })();
      compound.cancelPromise = cancellation;
      setStopPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        await cancellation;
      } finally {
        if (mountedRef.current) {
          setStopPendingByRoot((current) => ({ ...current, [key]: false }));
        }
      }
      return;
    }
    const representative =
      compoundCoordinatorRef.current.stopAll(compound.lease)[0] ?? compound.representativeSessionId;
    if (representative === null) return;
    const key = normalizedWorkspaceRootKey(root);
    const operation = gateway.stop(representative);
    compound.stopPromise = operation;
    setStopPendingByRoot((current) => ({ ...current, [key]: true }));
    try {
      await operation;
      compoundCoordinatorRef.current.rollback(compound.lease);
      if (compound.projectionLease) {
        compoundProjectionRef.current.invalidate(compound.projectionLease);
      }
      if (activeCompoundRef.current === compound) {
        activeCompoundRef.current = null;
        setDebugCompoundActive(false);
      }
      const current = snapshotsRef.current[key] ?? inactiveSnapshot;
      const selected = current.state.kind === "inactive" ? null : debuggerSessionId(current.state);
      if (selected !== null) finalizeExactSession(key, selected);
    } catch (error) {
      if (activeCompoundRef.current === compound && compound.stopPromise === operation) {
        compound.stopPromise = null;
      }
      throw error;
    } finally {
      if (mountedRef.current) {
        setStopPendingByRoot((current) => ({ ...current, [key]: false }));
      }
    }
  }, [
    finalizeExactSession,
    gateway,
    isExactWorkspaceOwnerCurrent,
    setStopPendingByRoot,
    stopSingleDebug,
  ]);

  const failClosedCompoundPolicy = useCallback(
    async (rootPath: string, selectedSessionId: number): Promise<void> => {
      const compound = activeCompoundRef.current;
      if (
        !compound ||
        compound.policyDiverged ||
        !compound.projectionLease ||
        !workspaceRootKeysEqual(rootPath, compound.owner.rootPath) ||
        compound.owner.workspaceEpoch !== workspaceOwnerEpochRef.current.epoch ||
        compound.owner.workspaceId !== currentWorkspaceIdRef.current ||
        compoundProjectionRef.current.selectedSessionId(compound.projectionLease) !==
          selectedSessionId
      ) {
        return;
      }
      compound.policyDiverged = true;
      try {
        await stopDebug();
      } catch {
        // Keep the exact group owned for an explicit Stop retry, but block every
        // non-stop control while its policy state is unknown.
      }
    },
    [stopDebug],
  );
  failClosedCompoundPolicyRef.current = failClosedCompoundPolicy;

  const stopExactDebugSession = useCallback(
    async (sessionId: number): Promise<boolean> => {
      if (activeCompoundRef.current) return false;
      return stopExactSingleDebugSession(sessionId);
    },
    [stopExactSingleDebugSession],
  );
  const disconnectDebug = useCallback(async () => {
    if (activeCompoundRef.current) return;
    await disconnectSingleDebug();
  }, [disconnectSingleDebug]);
  const disconnectExactDebugSession = useCallback(
    async (sessionId: number): Promise<boolean> => {
      if (activeCompoundRef.current) return false;
      return disconnectExactSingleDebugSession(sessionId);
    },
    [disconnectExactSingleDebugSession],
  );

  const compoundBoundaryTrusted = trustedWorkspace(isWorkspaceTrusted);
  useEffect(() => {
    const boundaryRoot = workspaceRoot;
    const boundaryWorkspaceId = workspaceId;
    const boundaryEpoch = workspaceOwnerEpochRef.current.epoch;

    const invalidateBoundaryCompound = () => {
      const compound = activeCompoundRef.current;
      if (
        !compound ||
        compound.owner.workspaceEpoch !== boundaryEpoch ||
        compound.owner.workspaceId !== boundaryWorkspaceId ||
        !workspaceRootKeysEqual(compound.owner.rootPath, boundaryRoot)
      ) {
        return;
      }
      const live = compoundCoordinatorRef.current.invalidate(compound.owner);
      if (compound.projectionLease) {
        compoundProjectionRef.current.invalidate(compound.projectionLease);
      }
      const representative = live[0] ?? compound.representativeSessionId;
      if (representative !== null && compound.stopPromise === null) {
        compound.stopPromise = gateway.stop(representative).catch(() => undefined);
      }
      activeCompoundRef.current = null;
      if (mountedRef.current) {
        const key = normalizedWorkspaceRootKey(compound.owner.rootPath);
        const current = snapshotsRef.current[key] ?? inactiveSnapshot;
        const selected =
          current.state.kind === "inactive" ? null : debuggerSessionId(current.state);
        if (selected !== null) finalizeExactSession(key, selected);
        setDebugCompoundActive(false);
      }
    };

    if (!compoundBoundaryTrusted) invalidateBoundaryCompound();
    return invalidateBoundaryCompound;
  }, [compoundBoundaryTrusted, finalizeExactSession, gateway, workspaceId, workspaceRoot]);

  const canRestartDebug = useCallback(() => {
    if (activeCompoundRef.current) return false;
    const root = currentRootRef.current;
    if (!root || !trustedWorkspace(isWorkspaceTrusted)) return false;
    const key = normalizedWorkspaceRootKey(root);
    if (
      pendingRestartsRef.current.has(key) ||
      pendingControlsRef.current.has(key) ||
      pendingActiveStopsRef.current.has(key) ||
      pendingStartKeysRef.current.has(key) ||
      !restartOwnerIdsRef.current.has(key) ||
      restartOwnerIdsRef.current.get(key) !== currentWorkspaceIdRef.current ||
      !isExactWorkspaceOwnerCurrent(root, currentWorkspaceIdRef.current)
    )
      return false;
    const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
    const sessionId = state.kind === "inactive" ? null : debuggerSessionId(state);
    return (
      restartCoordinatorsRef.current.get(key)?.availability({
        rootPath: root,
        sessionId,
        stateKind: state.kind,
        workspaceTrusted: true,
      }).canRestart ?? false
    );
  }, [isExactWorkspaceOwnerCurrent, isWorkspaceTrusted]);

  const restartDebug = useCallback(async () => {
    if (activeCompoundRef.current) return;
    const root = currentRootRef.current;
    if (!root) return;
    const key = normalizedWorkspaceRootKey(root);
    const existing = pendingRestartsRef.current.get(key);
    if (existing) {
      await existing.promise;
      return;
    }
    const pendingActiveStop = pendingActiveStopsRef.current.get(key);
    if (pendingActiveStop) {
      await pendingActiveStop.promise;
      return;
    }
    if (
      !trustedWorkspace(isWorkspaceTrusted) ||
      pendingStartKeysRef.current.has(key) ||
      pendingControlsRef.current.has(key)
    )
      return;
    const requestedWorkspaceId = currentWorkspaceIdRef.current;
    if (
      !restartOwnerIdsRef.current.has(key) ||
      restartOwnerIdsRef.current.get(key) !== requestedWorkspaceId ||
      !isExactWorkspaceOwnerCurrent(root, requestedWorkspaceId)
    ) {
      return;
    }
    const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
    const coordinator = restartCoordinatorsRef.current.get(key);
    const attempt = coordinator?.begin({
      rootPath: root,
      sessionId: state.kind === "inactive" ? null : debuggerSessionId(state),
      stateKind: state.kind,
      workspaceTrusted: true,
    });
    if (!coordinator || !attempt) return;

    const pending: PendingRestart = {
      attempt,
      coordinator,
      cancelled: false,
      promise: Promise.resolve(),
      workspaceId: requestedWorkspaceId,
    };
    const operation = (async () => {
      let oldSessionStopped = false;
      try {
        await gateway.stop(attempt.sessionId);
        oldSessionStopped = true;
        finalizeExactSession(key, attempt.sessionId);
      } catch (error) {
        coordinator.cancel(attempt);
        throw error;
      }
      try {
        const currentRoot = currentRootRef.current;
        const currentState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        if (
          pending.cancelled ||
          !mountedRef.current ||
          pendingStartKeysRef.current.has(key) ||
          !isExactWorkspaceOwnerCurrent(root, pending.workspaceId)
        ) {
          coordinator.cancel(attempt);
          return;
        }
        const replacementTarget = coordinator.resolve(attempt, {
          rootPath: currentRoot,
          sessionId: currentState.kind === "inactive" ? null : debuggerSessionId(currentState),
          workspaceTrusted: trustedWorkspace(isWorkspaceTrusted),
        });
        if (!replacementTarget) return;
        const replacementSessionId = await startDebugRequest(
          legacyDebugStartDescriptor(gateway, replacementTarget),
          attempt.sessionId,
        );
        if (replacementSessionId === undefined) return;
        const replacementState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        if (
          pending.cancelled ||
          !mountedRef.current ||
          pendingRestartsRef.current.get(key) !== pending ||
          !isExactWorkspaceOwnerCurrent(root, pending.workspaceId) ||
          !trustedWorkspace(isWorkspaceTrusted) ||
          replacementState.kind === "inactive" ||
          replacementState.kind === "terminated" ||
          debuggerSessionId(replacementState) !== replacementSessionId
        ) {
          coordinator.release(root, replacementSessionId);
          await gateway.stop(replacementSessionId);
          finalizeExactSession(key, replacementSessionId);
        }
      } finally {
        if (oldSessionStopped) coordinator.release(root, attempt.sessionId);
      }
    })();
    pending.promise = operation;
    pendingRestartsRef.current.set(key, pending);
    setRestartPendingByRoot((current) => ({ ...current, [key]: true }));
    try {
      await operation;
    } finally {
      if (pendingRestartsRef.current.get(key) === pending) {
        pendingRestartsRef.current.delete(key);
        if (mountedRef.current) {
          setRestartPendingByRoot((current) => ({ ...current, [key]: false }));
        }
      }
    }
  }, [
    finalizeExactSession,
    gateway,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
    startDebugRequest,
  ]);

  const activeControlSessionId = useCallback((): number | null => {
    const root = currentRootRef.current;
    if (!root || !trustedWorkspace(isWorkspaceTrusted)) return null;
    if (activeCompoundRef.current?.policyDiverged) return null;
    const key = normalizedWorkspaceRootKey(root);
    if (
      pendingActiveStopsRef.current.has(key) ||
      pendingRestartsRef.current.has(key) ||
      pendingControlsRef.current.has(key)
    )
      return null;
    const sessionId = activeSessionId();
    if (sessionId === null) return null;
    const owner = sessionOwnersRef.current.get(key);
    if (
      !owner ||
      owner.sessionId !== sessionId ||
      owner.workspaceId !== currentWorkspaceIdRef.current
    ) {
      return null;
    }
    if (!workspaceRootKeysEqual(root, currentRootRef.current)) return null;
    if (
      !trustedWorkspace(isWorkspaceTrusted) ||
      !isExactWorkspaceOwnerCurrent(root, owner.workspaceId) ||
      pendingActiveStopsRef.current.has(key) ||
      pendingRestartsRef.current.has(key) ||
      pendingControlsRef.current.has(key)
    )
      return null;
    const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
    if (state.kind === "inactive" || state.kind === "terminated") return null;
    return debuggerSessionId(state) === sessionId ? sessionId : null;
  }, [activeSessionId, isExactWorkspaceOwnerCurrent, isWorkspaceTrusted]);
  activeControlSessionIdRef.current = activeControlSessionId;

  const { canRestartFrame, restartFrame } = restartFrameLifecycle;

  const canRunToLocation = useCallback((): boolean => {
    const root = currentRootRef.current;
    if (!root || !trustedWorkspace(isWorkspaceTrusted)) return false;
    const key = normalizedWorkspaceRootKey(root);
    const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
    if (state.kind !== "stopped") return false;
    const owner = sessionOwnersRef.current.get(key);
    return (
      mountedRef.current &&
      currentWorkspaceIdRef.current !== null &&
      owner?.sessionId === state.sessionId &&
      owner.workspaceId === currentWorkspaceIdRef.current &&
      adapterKindForSession(root, state.sessionId) === "node" &&
      (pauseGenerationByRootRef.current[key] ?? 0) > 0 &&
      isExactWorkspaceOwnerCurrent(root, owner.workspaceId) &&
      !pendingStartKeysRef.current.has(key) &&
      !pendingRestartsRef.current.has(key) &&
      !pendingActiveStopsRef.current.has(key) &&
      !pendingControlsRef.current.has(key) &&
      !pendingBreakpointBulkMutationsRef.current.has(key)
    );
  }, [adapterKindForSession, isExactWorkspaceOwnerCurrent, isWorkspaceTrusted]);

  const runToLocation = useCallback(
    async (candidate: DebugRunToLocationCandidate): Promise<boolean> => {
      if (!canRunToLocation()) return false;
      const root = currentRootRef.current;
      if (!root) return false;
      const key = normalizedWorkspaceRootKey(root);
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      if (state.kind !== "stopped") return false;
      const requestedWorkspaceId = currentWorkspaceIdRef.current;
      const sessionId = state.sessionId;
      const pauseGeneration = pauseGenerationByRootRef.current[key] ?? 0;
      if (!canRunToLocation() || !candidate.isCurrent()) return false;

      const operation = (async () => {
        await gateway.runToLocation({
          rootPath: root,
          sessionId,
          pauseGeneration,
          filePath: candidate.filePath,
          lineNumber: candidate.lineNumber,
          columnNumber: candidate.columnNumber,
        });
      })();
      pendingControlsRef.current.set(key, operation);
      setControlPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        await operation;
        const currentState = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        return (
          mountedRef.current &&
          trustedWorkspace(isWorkspaceTrusted) &&
          isExactWorkspaceOwnerCurrent(root, requestedWorkspaceId) &&
          currentState.kind !== "inactive" &&
          currentState.kind !== "terminated" &&
          debuggerSessionId(currentState) === sessionId
        );
      } finally {
        if (pendingControlsRef.current.get(key) === operation) {
          pendingControlsRef.current.delete(key);
          if (mountedRef.current) {
            setControlPendingByRoot((current) => ({ ...current, [key]: false }));
          }
        }
      }
    },
    [canRunToLocation, gateway, isExactWorkspaceOwnerCurrent, isWorkspaceTrusted],
  );

  const runSessionControl = useCallback(
    async (control: (sessionId: number) => Promise<void>) => {
      const sessionId = activeControlSessionId();
      if (sessionId === null) return;
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      if (pendingBreakpointBulkMutationsRef.current.has(key)) return;
      const operation = control(sessionId);
      pendingControlsRef.current.set(key, operation);
      setControlPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        await operation;
      } finally {
        if (pendingControlsRef.current.get(key) === operation) {
          pendingControlsRef.current.delete(key);
          if (mountedRef.current) {
            setControlPendingByRoot((current) => ({ ...current, [key]: false }));
          }
        }
      }
    },
    [activeControlSessionId],
  );

  const stepDebug = useCallback(
    (kind: StepKind) => runSessionControl((sessionId) => gateway.step(sessionId, kind)),
    [gateway, runSessionControl],
  );

  const pauseDebug = useCallback(
    () => runSessionControl((sessionId) => gateway.pause(sessionId)),
    [gateway, runSessionControl],
  );

  const {
    addInlineBreakpoint,
    disableAllBreakpoints,
    enableAllBreakpoints,
    relocateBreakpoint,
    removeAllBreakpoints,
    removeBreakpoint,
    restoreBreakpoints,
    setBreakpointCondition,
    setBreakpointEnabled,
    setBreakpointHitCondition,
    setBreakpointLogMessage,
    toggleBreakpoint,
  } = useDebugBreakpointManagement({
    activeControlSessionId,
    activeSessionId,
    adapterKindForSession,
    breakpointsByRootRef,
    commitBreakpoints,
    createBreakpointId,
    currentRootRef,
    currentWorkspaceIdRef,
    exactLiveCompoundSessionIds,
    failClosedCompoundPolicy,
    gateway,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
    mountedRef,
    pendingActiveStopsRef,
    pendingBreakpointBulkMutationsRef,
    pendingControlsRef,
    pendingRestartsRef,
    pendingStartKeysRef,
    setBreakpointBulkPendingByRoot,
  });

  const selectFrame = useCallback(
    (frameId: number) =>
      selectDebugFrame(
        {
          activeSessionId,
          currentRootRef,
          frameSelectionGenerationByRootRef,
          gateway,
          isWorkspaceTrusted,
          mountedRef,
          pauseGenerationByRootRef,
          setFrameSelectionByRoot,
          snapshotsRef,
        },
        frameId,
      ),
    [activeSessionId, gateway, isWorkspaceTrusted],
  );

  const loadVariablePage = useCallback(
    async (owner: DebugInspectionOwner, variablesReference: number, start: number) => {
      if (!isWorkspaceTrusted()) return;
      const requestKey = `${owner.rootKey}\0${owner.sessionId}\0${owner.pauseGeneration}\0${owner.frameId}\0${variablesReference}\0${start}`;
      if (variablePageRequestsRef.current.has(requestKey)) return;
      if (variablePageFlightsRef.current.size >= MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS) return;
      const expansion = selectDebugVariableExpansion(
        variablePagesRef.current,
        owner,
        variablesReference,
      );
      if (
        expansion.kind === "stale" ||
        expansion.kind === "leaf" ||
        expansion.kind === "circular" ||
        expansion.kind === "limit" ||
        (expansion.kind !== "idle" && expansion.nextStart !== start)
      ) {
        return;
      }
      variablePageRequestIdRef.current += 1;
      const requestId = `variables-${variablePageRequestIdRef.current}`;
      variablePageRequestsRef.current.set(requestKey, requestId);
      variablePageFlightsRef.current.add(requestId);
      setVariablePages((current) =>
        reduceDebugVariablePages(current, {
          type: "request",
          owner,
          variablesReference,
          start,
          requestId,
        }),
      );
      try {
        const page = await gateway.variablesPage({
          rootPath: owner.rootKey,
          sessionId: owner.sessionId,
          pauseGeneration: owner.pauseGeneration,
          frameId: owner.frameId,
          variablesReference,
          start,
          count: 100,
        });
        if (!mountedRef.current || !isWorkspaceTrusted()) return;
        const root = currentRootRef.current;
        if (!root || normalizedWorkspaceRootKey(root) !== owner.rootKey) return;
        const key = normalizedWorkspaceRootKey(root);
        const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
        const selectedFrame =
          frameSelectionByRootRef.current[key]?.frameId ??
          (state.kind === "stopped" ? (state.topFrame?.frameId ?? null) : null);
        if (
          state.kind !== "stopped" ||
          state.sessionId !== owner.sessionId ||
          (pauseGenerationByRootRef.current[key] ?? 0) !== owner.pauseGeneration ||
          selectedFrame !== owner.frameId
        )
          return;
        setVariablePages((current) =>
          reduceDebugVariablePages(current, {
            type: "resolve",
            owner,
            variablesReference,
            start,
            requestId,
            result: {
              variablesReference,
              start: page.start,
              variables: page.variables,
              nextStart: page.nextStart ?? null,
            },
          }),
        );
      } catch (error) {
        setVariablePages((current) =>
          reduceDebugVariablePages(current, {
            type: "reject",
            owner,
            variablesReference,
            start,
            requestId,
            message: error instanceof Error ? error.message : "Variable loading failed.",
          }),
        );
      } finally {
        if (variablePageRequestsRef.current.get(requestKey) === requestId) {
          variablePageRequestsRef.current.delete(requestKey);
        }
        variablePageFlightsRef.current.delete(requestId);
      }
    },
    [gateway, isWorkspaceTrusted],
  );

  const loadVariables = useCallback(
    async (variablesReference: number) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      const frameId =
        frameSelectionByRootRef.current[key]?.frameId ??
        (state.kind === "stopped" ? (state.topFrame?.frameId ?? null) : null);
      const pauseGeneration = pauseGenerationByRootRef.current[key] ?? 0;
      if (state.kind !== "stopped" || frameId === null || pauseGeneration <= 0) return;
      await loadVariablePage(
        { rootKey: key, sessionId: state.sessionId, pauseGeneration, frameId },
        variablesReference,
        0,
      );
    },
    [loadVariablePage],
  );

  const invalidateDebugInspection = useCallback(() => {
    variablePageRequestsRef.current.clear();
    variablePageFlightsRef.current.clear();
    setVariablePages((current) => createDebugVariablePagesState(current.owner));
    setDebugInspectionRevision((current) => current + 1);
  }, []);

  const setWatchExpression = useDebugSetExpression({
    adapterKindForSession,
    currentRootRef,
    currentWorkspaceIdRef,
    frameSelectionByRootRef,
    frameSelectionGenerationByRootRef,
    gateway,
    invalidateWatchEvaluations: invalidateDebugInspection,
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
  });

  const setVariable = useDebugSetVariable({
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
  });
  const variableMutationRows = useDebugVariableMutationRows({
    setVariable,
    setVariablePages,
    variablePageRequestsRef,
    variablePagesRef,
  });

  const { evaluate, evaluateClipboard, evaluateWatch } = useDebugEvaluation({
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
  });

  const isDebugStartBlocked = useCallback(() => {
    const root = currentRootRef.current;
    if (!root) return false;
    const key = normalizedWorkspaceRootKey(root);
    const kind = (snapshotsRef.current[key] ?? inactiveSnapshot).state.kind;
    return (
      activeCompoundRef.current !== null ||
      pendingStartKeysRef.current.has(key) ||
      pendingRestartsRef.current.has(key) ||
      pendingActiveStopsRef.current.has(key) ||
      pendingControlsRef.current.has(key) ||
      kind === "starting" ||
      kind === "running" ||
      kind === "stopped"
    );
  }, []);

  const activeKey = normalizedWorkspaceRootKey(workspaceRoot);
  const snapshot = snapshots[activeKey] ?? inactiveSnapshot;
  const pendingCompound = activeCompoundRef.current;
  const compoundStartPendingForActiveRoot =
    debugCompoundStartPending &&
    pendingCompound !== null &&
    pendingCompound.owner.workspaceId === workspaceId &&
    workspaceRootKeysEqual(pendingCompound.owner.rootPath, workspaceRoot);
  const sessionId = debuggerSessionId(snapshot.state);
  const selection = frameSelectionByRoot[activeKey] ?? null;
  const activePauseGeneration = pauseGenerationByRoot[activeKey] ?? 0;
  const activeSessionOwner = sessionOwnersRef.current.get(activeKey);
  const debugSessionAttached =
    snapshot.state.kind !== "inactive" &&
    snapshot.state.kind !== "terminated" &&
    activeSessionOwner?.sessionId === sessionId &&
    activeSessionOwner.workspaceId === workspaceId &&
    activeSessionOwner.targetKind === "node-attach";
  const activePauseOwnedByCurrentWorkspace =
    snapshot.state.kind === "stopped" &&
    activeSessionOwner?.sessionId === snapshot.state.sessionId &&
    activeSessionOwner.workspaceId === workspaceId;
  const pauseOwner =
    snapshot.state.kind === "stopped" &&
    activeSessionOwner !== undefined &&
    activeSessionOwner.sessionId === snapshot.state.sessionId &&
    activeSessionOwner.workspaceId === workspaceId &&
    activePauseGeneration > 0 &&
    activeSessionOwner.workspaceId !== null
      ? {
          rootKey: activeKey,
          sessionId: activeSessionOwner.sessionId,
          pauseGeneration: activePauseGeneration,
          workspaceOwnerKey: activeSessionOwner.workspaceId,
        }
      : null;
  let inspectionWorkspaceTrusted = false;
  try {
    inspectionWorkspaceTrusted = isWorkspaceTrusted();
  } catch {
    // A failed trust lookup must invalidate all pause-owned inspection data.
  }
  const inspectionOwner = useMemo<DebugInspectionOwner | null>(() => {
    if (
      !inspectionWorkspaceTrusted ||
      !activePauseOwnedByCurrentWorkspace ||
      snapshot.state.kind !== "stopped" ||
      activePauseGeneration <= 0
    )
      return null;
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
    activePauseOwnedByCurrentWorkspace,
    activePauseGeneration,
    inspectionWorkspaceTrusted,
    selection?.frameId,
    snapshot.state,
  ]);
  const inspectionOwnerRef = useRef(inspectionOwner);
  inspectionOwnerRef.current = inspectionOwner;
  const completeDebugConsole = useCallback(
    async (owner: DebugInspectionOwner, query: DebugConsoleCompletionQuery) => {
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
    [gateway, isExactWorkspaceOwnerCurrent],
  );

  useEffect(() => {
    setVariablePages((current) =>
      reduceDebugVariablePages(current, { type: "own", owner: inspectionOwner }),
    );
  }, [inspectionOwner]);

  const visibleVariablePages = debugInspectionOwnersEqual(variablePages.owner, inspectionOwner)
    ? variablePages
    : createDebugVariablePagesState(inspectionOwner);
  const variablesByReference = useMemo(() => {
    const flattened: Record<number, DebugVariable[]> = {};
    for (const [reference, entry] of Object.entries(visibleVariablePages.references)) {
      flattened[Number(reference)] = Object.values(entry.pages)
        .sort((left, right) => left.start - right.start)
        .flatMap((page) => page.variables);
    }
    return flattened;
  }, [visibleVariablePages]);

  const activeBreakpoints = breakpointsByRoot[activeKey] ?? emptyBreakpoints;
  const breakpointsActivated = breakpointsActivatedFor(activeKey, sessionId);

  return {
    startDebugCompoundAccepted,
    startNodeAttachCandidateAccepted,
    session: {
      debugAdapterKind,
      debugCompoundActive,
      debugCompoundStartPending: compoundStartPendingForActiveRoot,
      debugRestartPending: restartPendingByRoot[activeKey] ?? false,
      debugControlPending: controlPendingByRoot[activeKey] ?? false,
      debugInspectionRevision,
      debugStopPending: stopPendingByRoot[activeKey] ?? false,
      debugSessionAttached,
      debugStartPending: startPendingByRoot[activeKey] ?? false,
      snapshot,
      breakpoints: activeBreakpoints,
      breakpointCounts: countBreakpoints(activeBreakpoints),
      breakpointsActivated,
      breakpointBulkMutationPending: breakpointBulkPendingByRoot[activeKey] ?? false,
      evaluationHistory:
        sessionId === null
          ? emptyEvaluationHistory
          : (evaluationHistoryBySession[`${activeKey}\0${sessionId}`] ?? emptyEvaluationHistory),
      pauseGeneration: activePauseGeneration,
      pauseOwner,
      exceptionPauseError,
      exceptionPauseMode,
      exceptionPausePending,
      output: sessionId === null ? emptyOutput : (outputBySession[sessionId] ?? emptyOutput),
      lastStartError: startErrors[activeKey] ?? null,
      selectedFrameId: selection?.frameId ?? null,
      scopes: selection?.scopes ?? emptyScopes,
      variablesByReference,
      inspectionOwner,
      variablePages: visibleVariablePages,
      variableMutationRows,
      setWatchExpression,
      canRestartDebug,
      canToggleBreakpointsActivated,
      canRestartFrame,
      canRunToLocation,
      isDebugStartBlocked,
      restartDebug,
      restartFrame,
      runToLocation,
      startDebug,
      startDebugAccepted,
      startDebugSessionAccepted,
      startDebugDescriptorSessionAccepted,
      stopDebug,
      stopExactDebugSession,
      disconnectDebug,
      disconnectExactDebugSession,
      stepDebug,
      pauseDebug,
      toggleBreakpointsActivated,
      addInlineBreakpoint,
      relocateBreakpoint,
      setExceptionPauseMode,
      toggleBreakpoint,
      setBreakpointEnabled,
      setBreakpointCondition,
      setBreakpointHitCondition,
      setBreakpointLogMessage,
      removeBreakpoint,
      enableAllBreakpoints,
      disableAllBreakpoints,
      removeAllBreakpoints,
      restoreBreakpoints,
      selectFrame,
      loadVariables,
      loadVariablePage,
      evaluate,
      evaluateClipboard,
      evaluateWatch,
      completeDebugConsole,
    },
  };
}

function startDescriptorAuthorized(descriptor: DebugStartDescriptor): boolean {
  try {
    return descriptor.isStartAuthorized?.() !== false;
  } catch {
    return false;
  }
}
