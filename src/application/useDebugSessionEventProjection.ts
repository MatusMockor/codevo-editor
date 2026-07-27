import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DebugEvent, DebugGateway } from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import {
  reduceDebuggerSnapshot,
  startingDebuggerSnapshot,
  type DebuggerSessionSnapshot,
} from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  decodableLifecycleEvent,
  MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS,
  type DebugCompoundSessionProjection,
} from "./debugCompoundSessionProjection";
import { applyCompoundChildEvent, type ActiveDebugCompound } from "./debugCompoundStart";
import {
  retainPendingDebugStartEvent,
  type PendingDebugStartEvents,
} from "./debugPendingStartEvents";
import type { DebugFrameSelection } from "./debugFrameSelection";
import type { DebugRestartCoordinator } from "./debugRestartCoordinator";
import type { ActiveDebugAdapterKind, DebugOutputLine } from "./debugSessionContracts";
import { inactiveSnapshot } from "./debugSessionDefaults";
import { trustedWorkspace } from "./debugSessionOwnership";
import {
  createDebugOutputBatchCoordinator,
  type DebugOutputOwner,
} from "./debugOutputBatchCoordinator";
import type { DebugSessionOwner } from "./useDebugSessionEnd";
import type { NodeDebugCompoundSessionCoordinator } from "./nodeDebugCompoundSessionCoordinator";

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
  readonly applyBreakpointsVerifiedEvent: (event: DebugEvent) => void;
  readonly adoptBreakpointsActivation: (key: string, sessionId: number) => void;
  readonly adoptExceptionPauseSession: (
    rootPath: string,
    sessionId: number,
    adapterKind: "node" | "php",
  ) => void;
  readonly clearBreakpointsActivation: (key: string, sessionId: number) => void;
  readonly compoundCoordinatorRef: MutableRefObject<NodeDebugCompoundSessionCoordinator>;
  readonly compoundProjectionRef: MutableRefObject<DebugCompoundSessionProjection>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, DebugFrameSelection | null>>;
  readonly finalizeExactSession: (key: string, sessionId: number) => void;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly observeRestartFrameEvent: (event: DebugEvent) => void;
  readonly outputOwnersBySessionRef: MutableRefObject<Map<number, DebugOutputOwner>>;
  readonly pendingConfirmedStartEventsRef: MutableRefObject<PendingDebugStartEvents>;
  readonly pendingConfirmedStartKeysRef: MutableRefObject<Set<string>>;
  readonly pendingRestartsRef: MutableRefObject<Map<string, PendingRestartProjection>>;
  readonly pendingStartKeysRef: MutableRefObject<Set<string>>;
  readonly restartCoordinatorsRef: MutableRefObject<Map<string, DebugRestartCoordinator>>;
  readonly selectFrame: (frameId: number) => Promise<void>;
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
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const gateway = bindings.gateway;

  useEffect(() => {
    const isOutputOwnerCurrent = (owner: DebugOutputOwner): boolean => {
      const bindings = bindingsRef.current;
      const sessionOwner = bindings.sessionOwnersRef.current.get(owner.rootKey);
      return (
        bindings.mountedRef.current &&
        trustedWorkspace(bindings.isWorkspaceTrusted) &&
        bindings.isExactWorkspaceOwnerCurrent(owner.rootPath, owner.workspaceId) &&
        owner.workspaceEpoch === bindings.workspaceOwnerEpochRef.current.epoch &&
        owner.workspaceId === bindings.currentWorkspaceIdRef.current &&
        sessionOwner?.sessionId === owner.sessionId &&
        sessionOwner.workspaceEpoch === owner.workspaceEpoch &&
        sessionOwner.workspaceId === owner.workspaceId
      );
    };
    const outputCoordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: isOutputOwnerCurrent,
      publish: (batches) => {
        const bindings = bindingsRef.current;
        const accepted = batches.filter(({ owner }) => isOutputOwnerCurrent(owner));
        if (accepted.length === 0) return;
        for (const { owner } of accepted) {
          bindings.outputOwnersBySessionRef.current.set(owner.sessionId, owner);
        }
        // Output events advance the private sequence snapshot without publishing per event.
        // Publish the latest snapshot once alongside the coalesced output batch.
        bindings.setSnapshots(bindings.snapshotsRef.current);
        bindings.setOutputBySession((current) => {
          let next = current;
          for (const batch of accepted) {
            if (next === current) next = { ...current };
            next[batch.owner.sessionId] = [...batch.lines];
          }
          return next;
        });
      },
    });
    const outputOwner = (
      key: string,
      rootPath: string,
      sessionId: number,
    ): DebugOutputOwner | null => {
      const bindings = bindingsRef.current;
      const owner = bindings.sessionOwnersRef.current.get(key);
      if (!owner || owner.sessionId !== sessionId) return null;
      return {
        rootKey: key,
        rootPath,
        sessionId,
        workspaceEpoch: owner.workspaceEpoch,
        workspaceId: owner.workspaceId,
      };
    };
    const unsubscribe = gateway.subscribe((event) => {
      const bindings = bindingsRef.current;
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
        const lifecycleEvent =
          event.payload.kind === "started" ||
          event.payload.kind === "stopped" ||
          event.payload.kind === "resumed" ||
          event.payload.kind === "terminated";
        const decodable = decodableLifecycleEvent(event);
        const selectedOwnerBeforeLifecycle = decodable
          ? bindings.sessionOwnersRef.current.get(key)
          : undefined;
        const projectionChanged =
          decodable && bindings.compoundProjectionRef.current.handleEvent(event);
        if (projectionChanged && selectedOwnerBeforeLifecycle) {
          const owner = outputOwner(key, event.rootPath, selectedOwnerBeforeLifecycle.sessionId);
          if (owner) outputCoordinator.flushOwner(owner);
        }
        if (
          decodable &&
          (event.payload.kind === "stopped" || event.payload.kind === "terminated")
        ) {
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
          if (decodable) {
            if (
              compound.pendingLifecycleEvents.length >= MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS
            ) {
              compound.pendingLifecycleEvents.shift();
              compound.lifecycleBufferOverflowed = true;
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

        if (decodable && projectionChanged) {
          applyCompoundChildEvent(compound, event);
        }
        const selectedSessionId = bindings.compoundProjectionRef.current.selectedSessionId(
          compound.projectionLease,
        );
        if (selectedSessionId === null) return;
        const existing = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
        const selectedSnapshot = compound.childSnapshots.get(selectedSessionId);
        if (decodable && selectedSnapshot) {
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
            workspaceEpoch: compound.owner.workspaceEpoch,
            workspaceId: compound.owner.workspaceId,
          });
          bindings.adoptBreakpointsActivation(key, selectedSessionId);
          bindings.adoptExceptionPauseSession(event.rootPath, selectedSessionId, "node");
        }
        if (decodable) {
          if (selectedSnapshot !== existing) {
            if (selectedSnapshot?.state.kind === "stopped" && selectedSnapshot.state.frames[0]) {
              void bindings.selectFrame(selectedSnapshot.state.frames[0].frameId);
            } else {
              const cleared = {
                ...bindings.frameSelectionByRootRef.current,
                [key]: null,
              };
              bindings.frameSelectionByRootRef.current = cleared;
              bindings.setFrameSelectionByRoot(cleared);
            }
          }
          return;
        }
        if (lifecycleEvent) return;
        if (event.sessionId !== selectedSessionId) return;
      }
      if (
        event.payload.kind === "terminated" &&
        bindings.sessionOwnersRef.current.get(key)?.sessionId === event.sessionId
      ) {
        const owner = outputOwner(key, event.rootPath, event.sessionId);
        if (owner) outputCoordinator.flushOwner(owner);
        bindings.sessionOwnersRef.current.delete(key);
      }
      if (event.payload.kind === "terminated") {
        bindings.clearBreakpointsActivation(key, event.sessionId);
      }
      const existing = bindings.snapshotsRef.current[key] ?? inactiveSnapshot;
      if (bindings.pendingStartKeysRef.current.has(key)) {
        if (
          event.payload.kind === "started" ||
          event.payload.kind === "stopped" ||
          event.payload.kind === "resumed" ||
          event.payload.kind === "terminated" ||
          event.payload.kind === "breakpointsVerified" ||
          event.payload.kind === "functionBreakpointsVerified"
        ) {
          retainPendingDebugStartEvent(bindings.pendingConfirmedStartEventsRef.current, key, event);
        }
        if (event.payload.kind === "functionBreakpointsVerified") return;
      }
      // A native-watch session is deliberately registered while Node is still
      // held at --inspect-brk. Events may arrive before the exact clean-target
      // lease has been rechecked and confirmed. Lifecycle events are retained
      // in a small bounded queue; the start owner replays only its exact
      // session after successful confirmation. User output remains hidden.
      if (bindings.pendingConfirmedStartKeysRef.current.has(key)) {
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
      if (event.payload.kind !== "output") bindings.setSnapshots(updated);

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
        const topFrame = payload.frames[0];
        if (topFrame && exactEventOwnerIsCurrent(bindings, key, event)) {
          void bindings.selectFrame(topFrame.frameId);
        } else {
          const cleared = {
            ...bindings.frameSelectionByRootRef.current,
            [key]: null,
          };
          bindings.frameSelectionByRootRef.current = cleared;
          bindings.setFrameSelectionByRoot(cleared);
        }
      }
      if (payload.kind === "resumed" || payload.kind === "terminated") {
        bindings.setPauseGeneration(key, 0);
      }

      if (payload.kind === "output") {
        const owner = outputOwner(key, event.rootPath, event.sessionId);
        if (owner) {
          outputCoordinator.enqueue(owner, {
            stream: payload.stream,
            text: payload.text,
            truncated: payload.truncated,
          });
        }
        return;
      }

      if (payload.kind === "breakpointsVerified") {
        bindings.applyBreakpointsVerifiedEvent(event);
        return;
      }

      if (payload.kind === "resumed" || payload.kind === "terminated") {
        const cleared = {
          ...bindings.frameSelectionByRootRef.current,
          [key]: null,
        };
        bindings.frameSelectionByRootRef.current = cleared;
        bindings.setFrameSelectionByRoot(cleared);
      }
    });

    return () => {
      outputCoordinator.dispose();
      unsubscribe();
    };
  }, [gateway]);
}

function exactEventOwnerIsCurrent(
  bindings: DebugSessionEventProjectionBindings,
  key: string,
  event: DebugEvent,
): boolean {
  const owner = bindings.sessionOwnersRef.current.get(key);
  if (
    !bindings.mountedRef.current ||
    owner?.sessionId !== event.sessionId ||
    owner.workspaceEpoch !== bindings.workspaceOwnerEpochRef.current.epoch ||
    owner.workspaceId !== bindings.currentWorkspaceIdRef.current ||
    !trustedWorkspace(bindings.isWorkspaceTrusted)
  ) {
    return false;
  }
  try {
    return bindings.isExactWorkspaceOwnerCurrent(event.rootPath, owner.workspaceId);
  } catch {
    return false;
  }
}
