import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DebugGateway, DebugLaunchTarget } from "../domain/debug";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DebugRestartAttempt, DebugRestartCoordinator } from "./debugRestartCoordinator";

export interface DebugSessionOwner {
  readonly sessionId: number;
  readonly targetKind: DebugLaunchTarget["kind"];
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export interface PendingActiveStop {
  promise: Promise<void>;
  readonly sessionId: number;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export interface PendingSessionRestart {
  readonly attempt: DebugRestartAttempt;
  readonly coordinator: DebugRestartCoordinator;
  cancelled: boolean;
  promise: Promise<void>;
}

export interface PendingStartOwner {
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

interface Options {
  activeSessionId(): number | null;
  currentRootRef: MutableRefObject<string | null>;
  currentWorkspaceIdRef: MutableRefObject<string | null>;
  finalizeExactSession(key: string, sessionId: number): void;
  gateway: Pick<DebugGateway, "disconnect" | "stop">;
  isExactWorkspaceOwnerCurrent(rootPath: string, workspaceId: string | null): boolean;
  mountedRef: MutableRefObject<boolean>;
  pendingActiveStopsRef: MutableRefObject<Map<string, PendingActiveStop>>;
  pendingControlsRef: MutableRefObject<Map<string, Promise<unknown>>>;
  pendingRestartsRef: MutableRefObject<Map<string, PendingSessionRestart>>;
  pendingStartKeysRef: MutableRefObject<Set<string>>;
  pendingStartOwnersRef: MutableRefObject<Map<string, PendingStartOwner>>;
  pendingStartStopOwnersRef: MutableRefObject<Map<string, PendingStartOwner>>;
  pendingStopKeysRef: MutableRefObject<Set<string>>;
  restartCoordinatorsRef: MutableRefObject<Map<string, DebugRestartCoordinator>>;
  sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  setStopPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
  workspaceOwnerEpochRef: MutableRefObject<{
    readonly epoch: number;
    readonly workspaceId: string | null;
    readonly workspaceRoot: string | null;
  }>;
}

export function useDebugSessionEnd(options: Options) {
  const {
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
    pendingStartOwnersRef,
    pendingStartStopOwnersRef,
    pendingStopKeysRef,
    restartCoordinatorsRef,
    sessionOwnersRef,
    setStopPendingByRoot,
    workspaceOwnerEpochRef,
  } = options;
  const endDebugSession = useCallback(
    async (
      intent: "disconnect" | "stop",
      expectedSessionId: number | null = null,
    ): Promise<boolean> => {
      const root = currentRootRef.current;
      const requestedWorkspaceId = currentWorkspaceIdRef.current;
      if (!root) return false;
      const key = normalizedWorkspaceRootKey(root);
      const pendingControl = pendingControlsRef.current.get(key);
      if (pendingControl) {
        try {
          await pendingControl;
        } catch {
          // Session cleanup must not inherit a failed control request.
        }
        if (
          !workspaceRootKeysEqual(root, currentRootRef.current) ||
          !isExactWorkspaceOwnerCurrent(root, requestedWorkspaceId)
        )
          return false;
      }
      const pendingRestart = pendingRestartsRef.current.get(key);
      if (pendingRestart) {
        pendingRestart.cancelled = true;
        pendingRestart.coordinator.cancel(pendingRestart.attempt);
        await pendingRestart.promise;
        return false;
      }
      const existing = pendingActiveStopsRef.current.get(key);
      if (existing) {
        if (
          (expectedSessionId !== null && existing.sessionId !== expectedSessionId) ||
          existing.workspaceEpoch !== workspaceOwnerEpochRef.current.epoch ||
          existing.workspaceId !== requestedWorkspaceId
        ) {
          return false;
        }
        await existing.promise;
        return true;
      }
      if (!isExactWorkspaceOwnerCurrent(root, requestedWorkspaceId)) return false;
      const sessionId = activeSessionId();
      if (sessionId === null) {
        const pendingStartOwner = pendingStartOwnersRef.current.get(key);
        if (
          intent === "stop" &&
          pendingStartKeysRef.current.has(key) &&
          pendingStartOwner?.workspaceEpoch === workspaceOwnerEpochRef.current.epoch &&
          pendingStartOwner.workspaceId === requestedWorkspaceId
        ) {
          pendingStopKeysRef.current.add(key);
          pendingStartStopOwnersRef.current.set(key, {
            workspaceEpoch: workspaceOwnerEpochRef.current.epoch,
            workspaceId: requestedWorkspaceId,
          });
          if (mountedRef.current) {
            setStopPendingByRoot((current) => ({ ...current, [key]: true }));
          }
        }
        return false;
      }
      if (expectedSessionId !== null && sessionId !== expectedSessionId) return false;
      const owner = sessionOwnersRef.current.get(key);
      if (
        owner?.sessionId !== sessionId ||
        owner.workspaceEpoch !== workspaceOwnerEpochRef.current.epoch ||
        owner.workspaceId !== requestedWorkspaceId
      ) {
        if (intent === "stop" && pendingStartKeysRef.current.has(key)) {
          pendingStopKeysRef.current.add(key);
        }
        return false;
      }
      if (intent === "disconnect" && owner.targetKind !== "node-attach") {
        return false;
      }
      const pending: PendingActiveStop = {
        sessionId,
        promise: Promise.resolve(),
        workspaceEpoch: workspaceOwnerEpochRef.current.epoch,
        workspaceId: requestedWorkspaceId,
      };
      const operation = (async () => {
        if (intent === "disconnect") {
          await gateway.disconnect({ rootPath: root, sessionId });
        } else {
          await gateway.stop(sessionId);
        }
        restartCoordinatorsRef.current.get(key)?.release(root, sessionId);
        finalizeExactSession(key, sessionId);
      })();
      pending.promise = operation;
      pendingActiveStopsRef.current.set(key, pending);
      setStopPendingByRoot((current) => ({ ...current, [key]: true }));
      try {
        await operation;
        return true;
      } finally {
        if (pendingActiveStopsRef.current.get(key) === pending) {
          pendingActiveStopsRef.current.delete(key);
          if (mountedRef.current) {
            setStopPendingByRoot((current) => ({ ...current, [key]: false }));
          }
        }
      }
    },
    [
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
      pendingStartOwnersRef,
      pendingStartStopOwnersRef,
      pendingStopKeysRef,
      restartCoordinatorsRef,
      sessionOwnersRef,
      setStopPendingByRoot,
      workspaceOwnerEpochRef,
    ],
  );

  return {
    disconnectDebug: useCallback(async () => {
      await endDebugSession("disconnect");
    }, [endDebugSession]),
    disconnectExactDebugSession: useCallback(
      (sessionId: number) => endDebugSession("disconnect", sessionId),
      [endDebugSession],
    ),
    stopDebug: useCallback(async () => {
      await endDebugSession("stop");
    }, [endDebugSession]),
    stopExactDebugSession: useCallback(
      (sessionId: number) => endDebugSession("stop", sessionId),
      [endDebugSession],
    ),
  };
}
