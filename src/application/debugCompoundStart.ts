import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  Breakpoint,
  DebugCompoundLaunchTarget,
  DebugEvent,
  DebugGateway,
} from "../domain/debug";
import { breakpointsForDebugSession } from "../domain/debugBreakpointPolicy";
import {
  initialDebuggerSnapshot,
  reduceDebuggerSnapshot,
  startingDebuggerSnapshot,
  type DebuggerSessionSnapshot,
} from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type {
  DebugCompoundProjectionLease,
  DebugCompoundSessionProjection,
} from "./debugCompoundSessionProjection";
import type {
  NodeDebugCompoundLease,
  NodeDebugCompoundOwner,
  NodeDebugCompoundSessionCoordinator,
} from "./nodeDebugCompoundSessionCoordinator";
import type { DebugSessionOwner } from "./useDebugSessionEnd";

interface PendingRegistry {
  has(key: string): boolean;
}

interface WorkspaceOwnerEpoch {
  readonly epoch: number;
}

interface ExceptionPausePolicy {
  readonly adapterKind: "node" | "php";
  readonly mode: Parameters<DebugGateway["setExceptionPause"]>[2];
  readonly exceptionTypeFilter: Parameters<DebugGateway["setExceptionPause"]>[3];
}

export interface ActiveDebugCompound {
  cancelPromise: Promise<void> | null;
  cancelRequested: boolean;
  readonly childPauseGenerations: Map<number, number>;
  readonly childSnapshots: Map<number, DebuggerSessionSnapshot>;
  readonly lease: NodeDebugCompoundLease;
  readonly owner: NodeDebugCompoundOwner;
  readonly pendingLifecycleEvents: DebugEvent[];
  policyDiverged: boolean;
  projectionLease: DebugCompoundProjectionLease | null;
  representativeSessionId: number | null;
  readonly resolveStartSettlement: () => void;
  readonly startSettlement: Promise<void>;
  stopPromise: Promise<void> | null;
}

export interface DebugCompoundStartContext {
  readonly activeCompoundRef: MutableRefObject<ActiveDebugCompound | null>;
  adoptBreakpointsActivation(key: string, sessionId: number): void;
  adoptExceptionPauseSession(
    rootPath: string,
    sessionId: number,
    adapterKind: "node" | "php",
  ): void;
  readonly breakpointsByRootRef: MutableRefObject<Record<string, Breakpoint[]>>;
  readonly compoundCoordinator: NodeDebugCompoundSessionCoordinator;
  readonly compoundProjection: DebugCompoundSessionProjection;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  exceptionPauseStartPolicy(
    rootPath: string,
    launch: DebugCompoundLaunchTarget,
  ): ExceptionPausePolicy;
  readonly gateway: DebugGateway;
  isExactWorkspaceOwnerCurrent(rootPath: string, workspaceId: string | null): boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pendingActiveStopsRef: MutableRefObject<PendingRegistry>;
  readonly pendingControlsRef: MutableRefObject<PendingRegistry>;
  readonly pendingRestartsRef: MutableRefObject<PendingRegistry>;
  readonly pendingStartKeysRef: MutableRefObject<Set<string>>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly sessionsByRootRef: MutableRefObject<Record<string, number[]>>;
  setDebugCompoundActive(active: boolean): void;
  setDebugCompoundStartPending(pending: boolean): void;
  clearFrameSelection(key: string): void;
  readonly setOutputBySession: Dispatch<
    SetStateAction<Record<number, { stream: "stdout" | "stderr"; text: string }[]>>
  >;
  setPauseGeneration(key: string, generation: number): void;
  readonly setSnapshots: Dispatch<SetStateAction<Record<string, DebuggerSessionSnapshot>>>;
  readonly setStartErrors: Dispatch<SetStateAction<Record<string, string>>>;
  readonly setStartPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<WorkspaceOwnerEpoch>;
}

/** Atomically starts and adopts the exact 2–4 member Node compound. */
export async function startDebugCompoundAccepted(
  context: DebugCompoundStartContext,
  members: readonly DebugCompoundLaunchTarget[],
): Promise<boolean> {
  const requestedRoot = context.currentRootRef.current;
  const requestedWorkspaceId = context.currentWorkspaceIdRef.current;
  const startCompound = context.gateway.startCompound?.bind(context.gateway);
  if (
    !requestedRoot ||
    !requestedWorkspaceId ||
    !startCompound ||
    !Array.isArray(members) ||
    members.length < 2 ||
    members.length > 4 ||
    members.some((member) => !isNodeCompoundLaunchTarget(member)) ||
    !trustedWorkspace(context.isWorkspaceTrusted) ||
    !context.isExactWorkspaceOwnerCurrent(requestedRoot, requestedWorkspaceId)
  ) {
    return false;
  }

  const key = normalizedWorkspaceRootKey(requestedRoot);
  const state = (context.snapshotsRef.current[key] ?? initialDebuggerSnapshot()).state;
  if (
    context.activeCompoundRef.current ||
    context.pendingStartKeysRef.current.has(key) ||
    context.pendingActiveStopsRef.current.has(key) ||
    context.pendingControlsRef.current.has(key) ||
    context.pendingRestartsRef.current.has(key) ||
    (state.kind !== "inactive" && state.kind !== "terminated")
  ) {
    return false;
  }

  const owner: NodeDebugCompoundOwner = {
    launchConfigurationVersion: 0,
    rootPath: requestedRoot,
    workspaceEpoch: context.workspaceOwnerEpochRef.current.epoch,
    workspaceId: requestedWorkspaceId,
  };
  const lease = context.compoundCoordinator.begin(owner, members.length);
  if (!lease) return false;
  const startSettlement = deferredVoid();
  const compound: ActiveDebugCompound = {
    cancelPromise: null,
    cancelRequested: false,
    childPauseGenerations: new Map(),
    childSnapshots: new Map(),
    lease,
    owner,
    pendingLifecycleEvents: [],
    policyDiverged: false,
    projectionLease: null,
    representativeSessionId: null,
    resolveStartSettlement: startSettlement.resolve,
    startSettlement: startSettlement.promise,
    stopPromise: null,
  };
  context.activeCompoundRef.current = compound;
  context.pendingStartKeysRef.current.add(key);
  context.setStartPendingByRoot((current) => ({ ...current, [key]: true }));
  context.setDebugCompoundStartPending(true);

  const rollback = async (): Promise<void> => {
    const exactLive = context.compoundCoordinator.rollback(lease);
    if (compound.projectionLease) context.compoundProjection.invalidate(compound.projectionLease);
    const representative = exactLive[0] ?? compound.representativeSessionId;
    if (representative !== null && compound.stopPromise === null) {
      compound.stopPromise = context.gateway.stop(representative).catch(() => undefined);
      await compound.stopPromise;
    }
    if (context.activeCompoundRef.current === compound) {
      context.activeCompoundRef.current = null;
      if (context.mountedRef.current) context.setDebugCompoundActive(false);
    }
  };

  try {
    const policy = context.exceptionPauseStartPolicy(requestedRoot, members[0]!);
    const currentBreakpoints = breakpointsForDebugSession(
      requestedRoot,
      "node",
      context.breakpointsByRootRef.current[key] ?? [],
    );
    const status = await startCompound({
      rootPath: requestedRoot,
      members: members.map((launchTarget) => ({
        launch: launchTarget,
        breakpoints: currentBreakpoints,
        exceptionPauseMode: policy.mode,
        exceptionTypeFilter: policy.exceptionTypeFilter ?? [],
      })),
      stopAll: true,
    });
    if (status.kind !== "ok" || !Array.isArray(status.sessionIds)) {
      await rollback();
      return false;
    }
    compound.representativeSessionId = status.sessionIds.find(validDebugSessionId) ?? null;
    if (compound.cancelRequested || status.sessionIds.length !== members.length) {
      await rollback();
      return false;
    }

    let ready = false;
    for (const [index, sessionId] of status.sessionIds.entries()) {
      const acceptance = context.compoundCoordinator.accept(lease, index, sessionId);
      if (acceptance.kind === "rejected") {
        await rollback();
        return false;
      }
      ready = acceptance.kind === "ready";
    }
    if (!ready) {
      await rollback();
      return false;
    }

    const projectionLease = context.compoundProjection.begin(requestedRoot, status.sessionIds);
    compound.projectionLease = projectionLease;
    initializeCompoundChildSnapshots(compound, status.sessionIds);
    if (
      !projectionLease ||
      context.compoundProjection.snapshot().kind === "ending" ||
      !context.mountedRef.current ||
      !trustedWorkspace(context.isWorkspaceTrusted) ||
      !context.isExactWorkspaceOwnerCurrent(requestedRoot, requestedWorkspaceId) ||
      context.workspaceOwnerEpochRef.current.epoch !== owner.workspaceEpoch
    ) {
      await rollback();
      return false;
    }

    const selectedSessionId =
      context.compoundProjection.selectedSessionId(projectionLease) ??
      context.compoundCoordinator.selectedSession(lease);
    if (selectedSessionId === null) {
      await rollback();
      return false;
    }

    context.sessionsByRootRef.current = {
      ...context.sessionsByRootRef.current,
      [key]: [...status.sessionIds],
    };
    const selectedSnapshot =
      compound.childSnapshots.get(selectedSessionId) ??
      Object.freeze({
        lastSeq: 0,
        state: { kind: "running" as const, sessionId: selectedSessionId },
      });
    context.snapshotsRef.current = { ...context.snapshotsRef.current, [key]: selectedSnapshot };
    context.setSnapshots(context.snapshotsRef.current);
    context.sessionOwnersRef.current.set(key, {
      sessionId: selectedSessionId,
      targetKind: "node-script",
      workspaceId: requestedWorkspaceId,
    });
    context.setOutputBySession((current) => ({
      ...current,
      [selectedSessionId]: current[selectedSessionId] ?? [],
    }));
    context.setPauseGeneration(key, compound.childPauseGenerations.get(selectedSessionId) ?? 0);
    context.clearFrameSelection(key);
    context.adoptBreakpointsActivation(key, selectedSessionId);
    context.adoptExceptionPauseSession(requestedRoot, selectedSessionId, policy.adapterKind);
    context.setStartErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    context.setDebugCompoundActive(true);
    return true;
  } catch {
    await rollback();
    return false;
  } finally {
    context.pendingStartKeysRef.current.delete(key);
    compound.resolveStartSettlement();
    if (context.mountedRef.current) {
      context.setStartPendingByRoot((current) => ({ ...current, [key]: false }));
      context.setDebugCompoundStartPending(false);
    }
  }
}

export function initializeCompoundChildSnapshots(
  compound: ActiveDebugCompound,
  sessionIds: readonly number[],
): void {
  compound.childSnapshots.clear();
  compound.childPauseGenerations.clear();
  for (const sessionId of sessionIds) {
    compound.childSnapshots.set(sessionId, startingDebuggerSnapshot(sessionId));
    compound.childPauseGenerations.set(sessionId, 0);
  }
  const exactSessionIds = new Set(sessionIds);
  const replay = compound.pendingLifecycleEvents
    .filter((event) => exactSessionIds.has(event.sessionId))
    .sort((left, right) => left.seq - right.seq);
  compound.pendingLifecycleEvents.length = 0;
  for (const event of replay) applyCompoundChildEvent(compound, event);
  for (const [sessionId, snapshot] of compound.childSnapshots) {
    if (snapshot.state.kind !== "starting") continue;
    compound.childSnapshots.set(sessionId, {
      lastSeq: snapshot.lastSeq,
      state: { kind: "running", sessionId },
    });
  }
}

export function applyCompoundChildEvent(compound: ActiveDebugCompound, event: DebugEvent): boolean {
  const current = compound.childSnapshots.get(event.sessionId);
  if (!current || event.seq <= current.lastSeq) return false;
  const kind = event.payload.kind;
  const state = current.state;
  if (
    (kind === "started" && state.kind !== "starting") ||
    (kind === "stopped" && state.kind !== "running") ||
    (kind === "resumed" && state.kind !== "stopped") ||
    state.kind === "terminated" ||
    (kind !== "started" && kind !== "stopped" && kind !== "resumed" && kind !== "terminated")
  ) {
    return false;
  }
  compound.childSnapshots.set(event.sessionId, reduceDebuggerSnapshot(current, event));
  if (kind === "stopped") {
    compound.childPauseGenerations.set(event.sessionId, event.payload.pauseGeneration);
  } else if (kind === "resumed" || kind === "terminated") {
    compound.childPauseGenerations.set(event.sessionId, 0);
  }
  return true;
}

function deferredVoid(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function trustedWorkspace(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function isNodeCompoundLaunchTarget(value: unknown): value is DebugCompoundLaunchTarget {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === "node-script" || kind === "node-configured-script" || kind === "node-npm-script";
}

function validDebugSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
