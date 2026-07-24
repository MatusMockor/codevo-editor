import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DebugGateway } from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import type { DebugSessionOwner } from "./useDebugSessionEnd";

interface BreakpointsActivation {
  readonly sessionId: number;
  readonly active: boolean;
}

interface UseDebugBreakpointActivationOptions {
  readonly activeControlSessionId: () => number | null;
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => "node" | "php" | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pendingBreakpointBulkMutationsRef: MutableRefObject<Map<string, Promise<void>>>;
  readonly pendingControlsRef: MutableRefObject<Map<string, Promise<unknown>>>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly setBreakpointsActiveForSession?: (
    request: Parameters<NonNullable<DebugGateway["setBreakpointsActive"]>>[0],
  ) => Promise<void>;
  readonly setControlPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<{
    readonly epoch: number;
    readonly workspaceId: string | null;
    readonly workspaceRoot: string | null;
  }>;
}

const inactiveSnapshot = initialDebuggerSnapshot();

function trusted(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

export function useDebugBreakpointActivation({
  activeControlSessionId,
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
}: UseDebugBreakpointActivationOptions) {
  const [byRoot, setByRoot] = useState<Record<string, BreakpointsActivation>>({});
  const byRootRef = useRef(byRoot);
  byRootRef.current = byRoot;

  const clear = useCallback((key: string, sessionId: number) => {
    if (byRootRef.current[key]?.sessionId !== sessionId) return;
    const next = { ...byRootRef.current };
    delete next[key];
    byRootRef.current = next;
    setByRoot(next);
  }, []);

  const adopt = useCallback((key: string, sessionId: number) => {
    const next = { ...byRootRef.current, [key]: { active: true, sessionId } };
    byRootRef.current = next;
    setByRoot(next);
  }, []);

  const canToggle = useCallback((): boolean => {
    const root = currentRootRef.current;
    if (!root || !mountedRef.current || !trusted(isWorkspaceTrusted)) return false;
    const key = normalizedWorkspaceRootKey(root);
    if (!gateway.setBreakpointsActive || pendingBreakpointBulkMutationsRef.current.has(key)) {
      return false;
    }
    const sessionId = activeControlSessionId();
    return sessionId !== null && adapterKindForSession(root, sessionId) === "node";
  }, [
    activeControlSessionId,
    adapterKindForSession,
    currentRootRef,
    gateway,
    isWorkspaceTrusted,
    mountedRef,
    pendingBreakpointBulkMutationsRef,
  ]);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (!canToggle()) return false;
    const root = currentRootRef.current;
    const setActive = gateway.setBreakpointsActive;
    if (!root || !setActive) return false;
    const key = normalizedWorkspaceRootKey(root);
    const sessionId = activeControlSessionId();
    if (sessionId === null || adapterKindForSession(root, sessionId) !== "node") return false;
    const requestedWorkspaceId = currentWorkspaceIdRef.current;
    const requestedOwnerEpoch = workspaceOwnerEpochRef.current.epoch;
    const current = byRootRef.current[key];
    const nextActive = !(current?.sessionId === sessionId ? current.active : true);
    const request = {
      rootPath: root,
      sessionId,
      active: nextActive,
    };
    const operation = setBreakpointsActiveForSession?.(request) ?? setActive.call(gateway, request);
    pendingControlsRef.current.set(key, operation);
    setControlPendingByRoot((pending) => ({ ...pending, [key]: true }));
    try {
      await operation;
      const state = (snapshotsRef.current[key] ?? inactiveSnapshot).state;
      const owner = sessionOwnersRef.current.get(key);
      if (
        !mountedRef.current ||
        !trusted(isWorkspaceTrusted) ||
        workspaceOwnerEpochRef.current.epoch !== requestedOwnerEpoch ||
        !isExactWorkspaceOwnerCurrent(root, requestedWorkspaceId) ||
        pendingControlsRef.current.get(key) !== operation ||
        state.kind === "inactive" ||
        state.kind === "terminated" ||
        debuggerSessionId(state) !== sessionId ||
        owner?.sessionId !== sessionId ||
        owner.workspaceId !== requestedWorkspaceId ||
        adapterKindForSession(root, sessionId) !== "node"
      ) {
        return false;
      }
      const next = { ...byRootRef.current, [key]: { active: nextActive, sessionId } };
      byRootRef.current = next;
      setByRoot(next);
      return true;
    } finally {
      if (pendingControlsRef.current.get(key) === operation) {
        pendingControlsRef.current.delete(key);
        if (mountedRef.current) {
          setControlPendingByRoot((pending) => ({ ...pending, [key]: false }));
        }
      }
    }
  }, [
    activeControlSessionId,
    adapterKindForSession,
    canToggle,
    currentRootRef,
    currentWorkspaceIdRef,
    gateway,
    isExactWorkspaceOwnerCurrent,
    isWorkspaceTrusted,
    mountedRef,
    pendingControlsRef,
    sessionOwnersRef,
    setBreakpointsActiveForSession,
    setControlPendingByRoot,
    snapshotsRef,
    workspaceOwnerEpochRef,
  ]);

  const activatedFor = useCallback(
    (key: string, sessionId: number | null): boolean => {
      const activation = byRoot[key];
      return sessionId === null || activation?.sessionId !== sessionId ? true : activation.active;
    },
    [byRoot],
  );

  return { activatedFor, adopt, canToggle, clear, toggle };
}
