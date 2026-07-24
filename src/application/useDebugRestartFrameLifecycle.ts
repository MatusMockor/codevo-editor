import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DebugEvent, DebugGateway, DebugScope, StackFrame } from "../domain/debug";
import {
  createDebugVariablePagesState,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ActiveDebugAdapterKind, DebugRestartFrameCandidate } from "./debugSessionContracts";

const RESTART_FRAME_LIFECYCLE_TIMEOUT_MS = 10_000;

interface RestartFrameContext {
  readonly frameId: number;
  readonly key: string;
  readonly pauseGeneration: number;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceOwnerKey: string;
}

interface PendingRestartFrameControl {
  freshPauseObserved: boolean;
  readonly pauseGeneration: number;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly sessionId: number;
}

interface UseDebugRestartFrameLifecycleOptions {
  readonly gateway: Pick<DebugGateway, "restartFrame">;
  readonly pendingControls: Map<string, Promise<unknown>>;
  getAdapterKind(rootPath: string, sessionId: number): ActiveDebugAdapterKind;
  getCurrentRoot(): string | null;
  getCurrentWorkspaceOwnerKey(): string | null;
  getPauseGeneration(key: string): number;
  getSelectedFrameId(key: string): number | null;
  getSessionOwner(
    key: string,
  ): { readonly sessionId: number; readonly workspaceId: string | null } | null;
  getSnapshot(key: string): DebuggerSessionSnapshot;
  invalidatePause(context: RestartFrameContext): void;
  isBlocked(key: string): boolean;
  isMounted(): boolean;
  isTrusted(): boolean;
  isWorkspaceOwnerCurrent(rootPath: string, workspaceOwnerKey: string): boolean;
  setControlPending(key: string, pending: boolean): void;
}

export interface DebugRestartFrameLifecycle {
  canRestartFrame(): boolean;
  observeEvent(event: DebugEvent): void;
  restartFrame(candidate: DebugRestartFrameCandidate): Promise<boolean>;
}

interface DebugRestartFrameSessionBindings {
  readonly activeEvaluationRequestsRef: MutableRefObject<Set<number>>;
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => ActiveDebugAdapterKind;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionByRootRef: MutableRefObject<
    Record<string, { readonly frameId: number; readonly scopes: DebugScope[] } | null>
  >;
  readonly gateway: Pick<DebugGateway, "restartFrame">;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, ownerKey: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pauseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly pendingActiveStopsRef: MutableRefObject<ReadonlyMap<string, unknown>>;
  readonly pendingBreakpointBulkMutationsRef: MutableRefObject<ReadonlyMap<string, unknown>>;
  readonly pendingControlsRef: MutableRefObject<Map<string, Promise<unknown>>>;
  readonly pendingRestartsRef: MutableRefObject<ReadonlyMap<string, unknown>>;
  readonly pendingStartKeysRef: MutableRefObject<ReadonlySet<string>>;
  readonly sessionOwnersRef: MutableRefObject<
    ReadonlyMap<string, { readonly sessionId: number; readonly workspaceId: string | null }>
  >;
  readonly setControlPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly setFrameSelectionByRoot: Dispatch<
    SetStateAction<Record<string, { frameId: number; scopes: DebugScope[] } | null>>
  >;
  readonly setPauseGeneration: (key: string, generation: number) => void;
  readonly setSnapshots: Dispatch<SetStateAction<Record<string, DebuggerSessionSnapshot>>>;
  readonly setVariablePages: Dispatch<SetStateAction<DebugVariablePagesState>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly variablePageRequestsRef: MutableRefObject<Map<string, string>>;
}

/** Adapts the session stores to the narrow Restart Frame lifecycle. */
export function useDebugRestartFrameSessionLifecycle(
  bindings: DebugRestartFrameSessionBindings,
): DebugRestartFrameLifecycle {
  const inactiveSnapshot = initialDebuggerSnapshot();
  return useDebugRestartFrameLifecycle({
    gateway: bindings.gateway,
    pendingControls: bindings.pendingControlsRef.current,
    getAdapterKind: bindings.adapterKindForSession,
    getCurrentRoot: () => bindings.currentRootRef.current,
    getCurrentWorkspaceOwnerKey: () => bindings.currentWorkspaceIdRef.current,
    getPauseGeneration: (key) => bindings.pauseGenerationByRootRef.current[key] ?? 0,
    getSelectedFrameId: (key) => bindings.frameSelectionByRootRef.current[key]?.frameId ?? null,
    getSessionOwner: (key) => bindings.sessionOwnersRef.current.get(key) ?? null,
    getSnapshot: (key) => bindings.snapshotsRef.current[key] ?? inactiveSnapshot,
    invalidatePause: (context) => invalidatePause(bindings, context, inactiveSnapshot),
    isBlocked: (key) =>
      bindings.pendingStartKeysRef.current.has(key) ||
      bindings.pendingRestartsRef.current.has(key) ||
      bindings.pendingActiveStopsRef.current.has(key) ||
      bindings.pendingControlsRef.current.has(key) ||
      bindings.pendingBreakpointBulkMutationsRef.current.has(key),
    isMounted: () => bindings.mountedRef.current,
    isTrusted: () => safeBoolean(bindings.isWorkspaceTrusted),
    isWorkspaceOwnerCurrent: bindings.isExactWorkspaceOwnerCurrent,
    setControlPending: (key, pending) =>
      bindings.setControlPendingByRoot((current) => ({ ...current, [key]: pending })),
  });
}

/** Owns Restart Frame's ACK-to-fresh-pause lifetime while sharing the session control flight. */
export function useDebugRestartFrameLifecycle(
  options: UseDebugRestartFrameLifecycleOptions,
): DebugRestartFrameLifecycle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingRef = useRef(new Map<string, PendingRestartFrameControl>());

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const control of pending.values()) {
        control.reject(new Error("Restart Frame control was cancelled."));
      }
      pending.clear();
    };
  }, []);

  const canRestartFrame = useCallback(() => currentContext(optionsRef.current) !== null, []);

  const observeEvent = useCallback((event: DebugEvent) => {
    const pending = pendingRef.current.get(normalizedWorkspaceRootKey(event.rootPath));
    if (pending?.sessionId !== event.sessionId) return;
    const payload = event.payload;
    if (
      payload.kind === "terminated" ||
      (payload.kind === "stopped" && payload.pauseGeneration > pending.pauseGeneration)
    ) {
      if (payload.kind === "stopped") pending.freshPauseObserved = true;
      pending.resolve();
    }
  }, []);

  const restartFrame = useCallback(async (candidate: DebugRestartFrameCandidate) => {
    const live = optionsRef.current;
    const context = currentContext(live, candidate);
    if (!context) return false;

    let resolveLifecycle!: () => void;
    let rejectLifecycle!: (error: Error) => void;
    const lifecycle = new Promise<void>((resolve, reject) => {
      resolveLifecycle = resolve;
      rejectLifecycle = reject;
    });
    let resolveAcknowledgement!: () => void;
    let rejectAcknowledgement!: (reason?: unknown) => void;
    const acknowledgement = new Promise<void>((resolve, reject) => {
      resolveAcknowledgement = resolve;
      rejectAcknowledgement = reject;
    });
    const operation = Promise.all([acknowledgement, lifecycle]).then(() => undefined);
    let watchdog: number | null = null;
    pendingRef.current.set(context.key, {
      freshPauseObserved: false,
      pauseGeneration: context.pauseGeneration,
      reject: rejectLifecycle,
      resolve: resolveLifecycle,
      sessionId: context.sessionId,
    });
    live.pendingControls.set(context.key, operation);
    live.setControlPending(context.key, true);

    try {
      let gatewayAcknowledgement: Promise<void> | null;
      try {
        gatewayAcknowledgement = live.gateway.restartFrame({
          frameId: context.frameId,
          pauseGeneration: context.pauseGeneration,
          rootPath: context.rootPath,
          sessionId: context.sessionId,
        });
      } catch (error) {
        rejectAcknowledgement(error);
        gatewayAcknowledgement = null;
      }
      if (gatewayAcknowledgement) {
        void gatewayAcknowledgement.then(() => {
          const current = optionsRef.current;
          const pending = pendingRef.current.get(context.key);
          if (
            current.isMounted() &&
            !pending?.freshPauseObserved &&
            pauseIsCurrent(current, context)
          ) {
            current.invalidatePause(context);
          }
          if (pending?.resolve === resolveLifecycle && !pending.freshPauseObserved) {
            watchdog = window.setTimeout(
              () => rejectLifecycle(new Error("Restart Frame did not reach a fresh pause.")),
              RESTART_FRAME_LIFECYCLE_TIMEOUT_MS,
            );
          }
          resolveAcknowledgement();
        }, rejectAcknowledgement);
      }
      await operation;
      return true;
    } finally {
      if (watchdog !== null) window.clearTimeout(watchdog);
      if (pendingRef.current.get(context.key)?.resolve === resolveLifecycle) {
        pendingRef.current.delete(context.key);
      }
      if (live.pendingControls.get(context.key) === operation) {
        live.pendingControls.delete(context.key);
        if (optionsRef.current.isMounted()) {
          optionsRef.current.setControlPending(context.key, false);
        }
      }
    }
  }, []);

  return { canRestartFrame, observeEvent, restartFrame };
}

function currentContext(
  options: UseDebugRestartFrameLifecycleOptions,
  candidate?: DebugRestartFrameCandidate,
): RestartFrameContext | null {
  if (!options.isMounted()) return null;
  const rootPath = options.getCurrentRoot();
  if (!rootPath || !safeBoolean(options.isTrusted)) return null;
  const key = normalizedWorkspaceRootKey(rootPath);
  if (options.isBlocked(key)) return null;
  const state = options.getSnapshot(key).state;
  if (state.kind !== "stopped") return null;
  const owner = options.getSessionOwner(key);
  const workspaceOwnerKey = options.getCurrentWorkspaceOwnerKey();
  const pauseGeneration = options.getPauseGeneration(key);
  const frameId = options.getSelectedFrameId(key) ?? state.topFrame?.frameId ?? null;
  const frame = state.frames.find((value) => value.frameId === frameId);
  if (
    workspaceOwnerKey === null ||
    owner?.sessionId !== state.sessionId ||
    owner.workspaceId !== workspaceOwnerKey ||
    pauseGeneration < 1 ||
    options.getAdapterKind(rootPath, state.sessionId) !== "node" ||
    !validFrame(frame) ||
    !safeBoolean(() => options.isWorkspaceOwnerCurrent(rootPath, workspaceOwnerKey))
  ) {
    return null;
  }
  if (
    candidate &&
    (!safeBoolean(candidate.isCurrent) ||
      !workspaceRootKeysEqual(candidate.rootPath, rootPath) ||
      candidate.workspaceOwnerKey !== workspaceOwnerKey ||
      candidate.sessionId !== state.sessionId ||
      candidate.pauseGeneration !== pauseGeneration ||
      candidate.frameId !== frame.frameId)
  ) {
    return null;
  }
  return {
    frameId: frame.frameId,
    key,
    pauseGeneration,
    rootPath,
    sessionId: state.sessionId,
    workspaceOwnerKey,
  };
}

function pauseIsCurrent(
  options: UseDebugRestartFrameLifecycleOptions,
  context: RestartFrameContext,
): boolean {
  const state = options.getSnapshot(context.key).state;
  const owner = options.getSessionOwner(context.key);
  return (
    state.kind === "stopped" &&
    state.sessionId === context.sessionId &&
    options.getPauseGeneration(context.key) === context.pauseGeneration &&
    owner?.sessionId === context.sessionId &&
    owner.workspaceId === context.workspaceOwnerKey
  );
}

function invalidatePause(
  bindings: DebugRestartFrameSessionBindings,
  context: RestartFrameContext,
  inactiveSnapshot: DebuggerSessionSnapshot,
): void {
  const current = bindings.snapshotsRef.current[context.key] ?? inactiveSnapshot;
  if (
    current.state.kind !== "stopped" ||
    current.state.sessionId !== context.sessionId ||
    (bindings.pauseGenerationByRootRef.current[context.key] ?? 0) !== context.pauseGeneration
  ) {
    return;
  }
  const updated = {
    ...bindings.snapshotsRef.current,
    [context.key]: { ...current, state: { ...current.state, frames: [], topFrame: null } },
  };
  bindings.snapshotsRef.current = updated;
  bindings.setSnapshots(updated);
  bindings.setPauseGeneration(context.key, 0);
  bindings.frameSelectionByRootRef.current = {
    ...bindings.frameSelectionByRootRef.current,
    [context.key]: null,
  };
  bindings.setFrameSelectionByRoot(bindings.frameSelectionByRootRef.current);
  bindings.setVariablePages(createDebugVariablePagesState());
  bindings.variablePageRequestsRef.current.clear();
  bindings.activeEvaluationRequestsRef.current.clear();
}

function validFrame(frame: StackFrame | undefined): frame is StackFrame {
  return frame !== undefined && Number.isSafeInteger(frame.frameId) && frame.frameId >= 1;
}

function safeBoolean(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
