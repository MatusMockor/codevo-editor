import { useCallback, useRef } from "react";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import {
  selectDebugCallStackNavigationTarget,
  type DebugCallStackNavigationDirection,
} from "../domain/debugCallStackNavigation";
import type { DebugPauseOwner } from "./debugSessionContracts";

export interface DebugCallStackNavigationCommands {
  canSelectCallStackFrame(): boolean;
  selectCallStackTop(): boolean;
  selectCallStackBottom(): boolean;
  selectCallStackUp(): boolean;
  selectCallStackDown(): boolean;
}

export interface UseDebugCallStackNavigationOptions {
  getPauseOwner(): DebugPauseOwner | null;
  getSelectedFrameId(): number | null;
  getSnapshot(): DebuggerSessionSnapshot;
  selectFrame(frameId: number, shouldCommit?: () => boolean): Promise<void>;
}

/** Owner-fenced command adapter over the existing asynchronous frame-selection port. */
export function useDebugCallStackNavigation(
  options: UseDebugCallStackNavigationOptions,
): DebugCallStackNavigationCommands {
  const currentRef = useRef(options);
  currentRef.current = options;
  const pendingRef = useRef(false);

  const canSelectCallStackFrame = useCallback(
    () => !pendingRef.current && currentInvocation(currentRef.current, "top") !== null,
    [],
  );

  const navigate = useCallback((direction: DebugCallStackNavigationDirection): boolean => {
    if (pendingRef.current) return false;
    const invocation = currentInvocation(currentRef.current, direction);
    if (!invocation) return false;
    const shouldCommit = () => invocationIsCurrent(currentRef.current, invocation);
    if (!shouldCommit()) return false;

    pendingRef.current = true;
    let selection: Promise<void>;
    try {
      selection = currentRef.current.selectFrame(invocation.targetFrameId, shouldCommit);
    } catch {
      pendingRef.current = false;
      return false;
    }
    void Promise.resolve(selection).then(
      () => {
        pendingRef.current = false;
      },
      () => {
        pendingRef.current = false;
      },
    );
    return true;
  }, []);

  return {
    canSelectCallStackFrame,
    selectCallStackTop: () => navigate("top"),
    selectCallStackBottom: () => navigate("bottom"),
    selectCallStackUp: () => navigate("up"),
    selectCallStackDown: () => navigate("down"),
  };
}

interface DebugCallStackNavigationInvocation {
  readonly owner: DebugPauseOwner;
  readonly selectedFrameId: number | null;
  readonly snapshot: DebuggerSessionSnapshot;
  readonly targetFrameId: number;
}

function currentInvocation(
  options: UseDebugCallStackNavigationOptions,
  direction: DebugCallStackNavigationDirection,
): DebugCallStackNavigationInvocation | null {
  try {
    const snapshot = options.getSnapshot();
    const owner = options.getPauseOwner();
    const selectedFrameId = options.getSelectedFrameId();
    if (!validOwnedStoppedSnapshot(snapshot, owner, selectedFrameId)) return null;
    if (snapshot.state.kind !== "stopped") return null;
    const target = selectDebugCallStackNavigationTarget(
      snapshot.state.frames,
      selectedFrameId,
      direction,
    );
    if (!target || !owner) return null;
    const invocation = {
      owner: Object.freeze({ ...owner }),
      selectedFrameId,
      snapshot,
      targetFrameId: target.frameId,
    };
    return invocationIsCurrent(options, invocation) ? invocation : null;
  } catch {
    return null;
  }
}

function validOwnedStoppedSnapshot(
  snapshot: DebuggerSessionSnapshot,
  owner: DebugPauseOwner | null,
  selectedFrameId: number | null,
): boolean {
  if (
    snapshot.state.kind !== "stopped" ||
    !owner ||
    snapshot.state.sessionId !== owner.sessionId ||
    !Number.isSafeInteger(snapshot.lastSeq) ||
    snapshot.lastSeq < 0 ||
    !Number.isSafeInteger(owner.pauseGeneration) ||
    owner.pauseGeneration < 1 ||
    owner.rootKey.length === 0 ||
    owner.workspaceOwnerKey.length === 0
  ) {
    return false;
  }
  return (
    selectedFrameId === null ||
    snapshot.state.frames.some(({ frameId }) => frameId === selectedFrameId)
  );
}

function invocationIsCurrent(
  options: UseDebugCallStackNavigationOptions,
  invocation: DebugCallStackNavigationInvocation,
): boolean {
  try {
    const snapshot = options.getSnapshot();
    const owner = options.getPauseOwner();
    return (
      snapshot === invocation.snapshot &&
      options.getSelectedFrameId() === invocation.selectedFrameId &&
      owner !== null &&
      owner.rootKey === invocation.owner.rootKey &&
      owner.sessionId === invocation.owner.sessionId &&
      owner.pauseGeneration === invocation.owner.pauseGeneration &&
      owner.workspaceOwnerKey === invocation.owner.workspaceOwnerKey &&
      validOwnedStoppedSnapshot(snapshot, owner, invocation.selectedFrameId) &&
      snapshot.state.kind === "stopped" &&
      snapshot.state.frames.some(({ frameId }) => frameId === invocation.targetFrameId)
    );
  } catch {
    return false;
  }
}
