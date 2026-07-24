import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Breakpoint, DebugEvent, DebugGateway } from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import { isBreakpointPathSupported } from "../domain/debugBreakpointPolicy";
import { applyVerification } from "../domain/debugBreakpoints";
import {
  reduceDebuggerSnapshot,
  startingDebuggerSnapshot,
  type DebuggerSessionSnapshot,
} from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DebugBreakpointSynchronization } from "./debugBreakpointSynchronization";
import {
  MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS,
  type DebugCompoundSessionProjection,
} from "./debugCompoundSessionProjection";
import { applyCompoundChildEvent, type ActiveDebugCompound } from "./debugCompoundStart";
import type { DebugFrameSelection } from "./debugFrameSelection";
import type { DebugRestartCoordinator } from "./debugRestartCoordinator";
import type { ActiveDebugAdapterKind, DebugOutputLine } from "./debugSessionContracts";
import { inactiveSnapshot } from "./debugSessionDefaults";
import { trustedWorkspace } from "./debugSessionOwnership";
import type { DebugSessionOwner } from "./useDebugSessionEnd";
import type { NodeDebugCompoundSessionCoordinator } from "./nodeDebugCompoundSessionCoordinator";

const OUTPUT_LINE_CAP = 5000;
const OUTPUT_TRIM_THRESHOLD = 5500;

interface PendingRestartProjection {
  readonly attempt: { readonly sessionId: number };
  cancelled: boolean;
}

interface WorkspaceOwnerEpoch {
  readonly epoch: number;
}

export interface DebugSessionEventProjectionBindings {
  readonly activeCompoundRef: MutableRefObject<ActiveDebugCompound | null>;
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => ActiveDebugAdapterKind;
  readonly adoptBreakpointsActivation: (key: string, sessionId: number) => void;
  readonly adoptExceptionPauseSession: (
    rootPath: string,
    sessionId: number,
    adapterKind: "node" | "php",
  ) => void;
  readonly breakpointSynchronizationRef: MutableRefObject<DebugBreakpointSynchronization>;
  readonly breakpointsByRootRef: MutableRefObject<Record<string, Breakpoint[]>>;
  readonly clearBreakpointsActivation: (key: string, sessionId: number) => void;
  readonly commitBreakpoints: (key: string, list: Breakpoint[]) => void;
  readonly compoundCoordinatorRef: MutableRefObject<NodeDebugCompoundSessionCoordinator>;
  readonly compoundProjectionRef: MutableRefObject<DebugCompoundSessionProjection>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly finalizeExactSession: (key: string, sessionId: number) => void;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly observeRestartFrameEvent: (event: DebugEvent) => void;
  readonly pendingBreakpointAdaptersRef: MutableRefObject<Record<string, "node" | "php">>;
  readonly pendingConfirmedStartKeysRef: MutableRefObject<Set<string>>;
  readonly pendingRestartsRef: MutableRefObject<Map<string, PendingRestartProjection>>;
  readonly pendingStartKeysRef: MutableRefObject<Set<string>>;
  readonly restartCoordinatorsRef: MutableRefObject<Map<string, DebugRestartCoordinator>>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly setDebugCompoundActive: Dispatch<SetStateAction<boolean>>;
  readonly setFrameSelectionByRoot: Dispatch<
    SetStateAction<Record<string, DebugFrameSelection | null>>
  >;
  readonly setOutputBySession: Dispatch<SetStateAction<Record<number, DebugOutputLine[]>>>;
  readonly setPauseGeneration: (key: string, generation: number) => void;
  readonly setSnapshots: Dispatch<SetStateAction<Record<string, DebuggerSessionSnapshot>>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<WorkspaceOwnerEpoch>;
}

export function useDebugSessionEventProjection(
  bindings: DebugSessionEventProjectionBindings,
): void {
  useEffect(() => {
    const unsubscribe = bindings.gateway.subscribe((event) => {
      if (typeof event?.payload?.kind !== "string") {
        return;
      }

      const key = normalizedWorkspaceRootKey(event.rootPath);
      const compound = bindings.activeCompoundRef.current;
      const isCompoundRoot =
        compound !== null && workspaceRootKeysEqual(compound.owner.rootPath, event.rootPath);
      if (isCompoundRoot && compound) {
        const exactCompoundOwnerCurrent =
          compound.owner.workspaceEpoch === bindings.workspaceOwnerEpochRef.current.epoch &&
          compound.owner.workspaceId === bindings.currentWorkspaceIdRef.current &&
          trustedWorkspace(bindings.isWorkspaceTrusted) &&
          bindings.isExactWorkspaceOwnerCurrent(
            compound.owner.rootPath,
            compound.owner.workspaceId,
          );
        if (!exactCompoundOwnerCurrent) {
          const live = bindings.compoundCoordinatorRef.current.invalidate(compound.owner);
          if (compound.projectionLease) {
            bindings.compoundProjectionRef.current.invalidate(compound.projectionLease);
          }
          const representative = live[0] ?? compound.representativeSessionId;
          if (representative !== null && compound.stopPromise === null) {
            compound.stopPromise = bindings.gateway.stop(representative).catch(() => undefined);
          }
          bindings.activeCompoundRef.current = null;
          if (bindings.mountedRef.current) {
            const current = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
            const selected =
              current.state.kind === "inactive" ? null : debuggerSessionId(current.state);
            if (selected !== null) bindings.finalizeExactSession(key, selected);
            bindings.setDebugCompoundActive(false);
          }
          return;
        }
        const projectionChanged = bindings.compoundProjectionRef.current.handleEvent(event);
        const isLifecycleEvent =
          event.payload.kind === "started" ||
          event.payload.kind === "stopped" ||
          event.payload.kind === "resumed" ||
          event.payload.kind === "terminated";
        if (event.payload.kind === "stopped" || event.payload.kind === "terminated") {
          bindings.compoundCoordinatorRef.current.handleEvent({
            kind: event.payload.kind,
            rootPath: event.rootPath,
            sessionId: event.sessionId,
          });
        }

        // While native start is still returning its ordered IDs, exact-root events are retained
        // only by the private compound seams. They must not accidentally adopt a child as a
        // legacy single session.
        if (!compound.projectionLease) {
          if (isLifecycleEvent) {
            if (
              compound.pendingLifecycleEvents.length >= MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS
            ) {
              compound.pendingLifecycleEvents.shift();
            }
            compound.pendingLifecycleEvents.push(event);
          }
          return;
        }

        const compoundSnapshot = bindings.compoundProjectionRef.current.snapshot();
        if (compoundSnapshot.kind === "idle") {
          bindings.compoundProjectionRef.current.invalidate(compound.projectionLease);
          bindings.activeCompoundRef.current = null;
          bindings.setDebugCompoundActive(false);
          return;
        }
        if (compoundSnapshot.kind === "ending") {
          const current = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
          const selected =
            current.state.kind === "inactive" ? null : debuggerSessionId(current.state);
          if (selected !== null) bindings.finalizeExactSession(key, selected);
          return;
        }

        if (isLifecycleEvent && projectionChanged) {
          applyCompoundChildEvent(compound, event);
        }
        const selectedSessionId = bindings.compoundProjectionRef.current.selectedSessionId(
          compound.projectionLease,
        );
        if (selectedSessionId === null) return;
        const existing = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
        const selectedSnapshot = compound.childSnapshots.get(selectedSessionId);
        if (isLifecycleEvent && selectedSnapshot) {
          bindings.snapshotsRef.current = {
            ...bindings.snapshotsRef.current,
            [key]: selectedSnapshot,
          };
          bindings.setSnapshots(bindings.snapshotsRef.current);
          bindings.setPauseGeneration(
            key,
            compound.childPauseGenerations.get(selectedSessionId) ?? 0,
          );
        }
        if (
          existing.state.kind === "inactive" ||
          existing.state.kind === "terminated" ||
          debuggerSessionId(existing.state) !== selectedSessionId
        ) {
          if (!selectedSnapshot) {
            bindings.snapshotsRef.current = {
              ...bindings.snapshotsRef.current,
              [key]: startingDebuggerSnapshot(selectedSessionId),
            };
            bindings.setSnapshots(bindings.snapshotsRef.current);
          }
          bindings.sessionOwnersRef.current.set(key, {
            sessionId: selectedSessionId,
            targetKind: "node-script",
            workspaceId: compound.owner.workspaceId,
          });
          bindings.adoptBreakpointsActivation(key, selectedSessionId);
          bindings.adoptExceptionPauseSession(event.rootPath, selectedSessionId, "node");
        }
        if (isLifecycleEvent) {
          bindings.setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
          return;
        }
        if (event.sessionId !== selectedSessionId) return;
      }
      if (
        event.payload.kind === "terminated" &&
        bindings.sessionOwnersRef.current.get(key)?.sessionId === event.sessionId
      ) {
        bindings.sessionOwnersRef.current.delete(key);
      }
      if (event.payload.kind === "terminated") {
        bindings.clearBreakpointsActivation(key, event.sessionId);
      }
      const existing = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
      // A native-watch session is deliberately registered while Node is still
      // held at --inspect-brk. Its backend `started` event may arrive before
      // the start IPC response and therefore before the exact clean-target
      // lease has been rechecked and confirmed. Do not let that transport
      // event adopt the session early; the start owner publishes the running
      // snapshot only after the single-use confirmation succeeds.
      if (
        event.payload.kind === "started" &&
        bindings.pendingConfirmedStartKeysRef.current.has(key)
      ) {
        return;
      }
      const seed =
        bindings.pendingStartKeysRef.current.has(key) &&
        event.payload.kind === "started" &&
        (existing.state.kind === "inactive" ||
          existing.state.kind === "terminated" ||
          debuggerSessionId(existing.state) !== event.sessionId)
          ? startingDebuggerSnapshot(event.sessionId)
          : existing;
      const next = reduceDebuggerSnapshot(seed, event);
      if (next === seed) return;
      const updated = { ...bindings.snapshotsRef.current, [key]: next };
      bindings.snapshotsRef.current = updated;
      bindings.setSnapshots(updated);

      const payload = event.payload;

      bindings.observeRestartFrameEvent(event);

      if (payload.kind === "terminated") {
        const pendingRestart = bindings.pendingRestartsRef.current.get(key);
        if (
          !pendingRestart ||
          pendingRestart.cancelled ||
          pendingRestart.attempt.sessionId !== event.sessionId
        ) {
          bindings.restartCoordinatorsRef.current
            .get(key)
            ?.release(event.rootPath, event.sessionId);
        }
      }

      if (payload.kind === "stopped") {
        bindings.setPauseGeneration(key, payload.pauseGeneration);
      }
      if (payload.kind === "resumed" || payload.kind === "terminated") {
        bindings.setPauseGeneration(key, 0);
      }

      if (payload.kind === "output") {
        bindings.setOutputBySession((current) => {
          const appended = [
            ...(current[event.sessionId] ?? []),
            { stream: payload.stream, text: payload.text },
          ];
          const trimmed =
            appended.length > OUTPUT_TRIM_THRESHOLD ? appended.slice(-OUTPUT_LINE_CAP) : appended;

          return { ...current, [event.sessionId]: trimmed };
        });
        return;
      }

      if (payload.kind === "breakpointsVerified") {
        const adapterKind =
          bindings.adapterKindForSession(event.rootPath, event.sessionId) ??
          bindings.pendingBreakpointAdaptersRef.current[key] ??
          null;
        if (
          adapterKind === null ||
          !isBreakpointPathSupported(event.rootPath, adapterKind, payload.filePath)
        ) {
          return;
        }
        bindings.breakpointSynchronizationRef.current.begin(key, event.sessionId, payload.filePath);
        bindings.commitBreakpoints(
          key,
          applyVerification(
            bindings.breakpointsByRootRef.current[key] ?? [],
            payload.filePath,
            payload.breakpoints,
          ),
        );
        return;
      }

      if (
        payload.kind === "stopped" ||
        payload.kind === "resumed" ||
        payload.kind === "terminated"
      ) {
        bindings.setFrameSelectionByRoot((current) => ({ ...current, [key]: null }));
      }
    });

    return unsubscribe;
  }, [
    bindings.adapterKindForSession,
    bindings.adoptBreakpointsActivation,
    bindings.adoptExceptionPauseSession,
    bindings.clearBreakpointsActivation,
    bindings.commitBreakpoints,
    bindings.finalizeExactSession,
    bindings.gateway,
    bindings.isExactWorkspaceOwnerCurrent,
    bindings.isWorkspaceTrusted,
    bindings.observeRestartFrameEvent,
    bindings.setPauseGeneration,
  ]);
}
