import { useCallback, useRef } from "react";
import type { StackFrame } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type {
  ActiveDebugAdapterKind,
  DebugPauseOwner,
  DebugRestartFrameCandidate,
} from "./debugSessionContracts";

export interface DebugRestartFrameCommands {
  canRestartFrame(): boolean;
  restartFrame(): boolean;
}

export interface UseDebugRestartFrameOptions {
  canRestartFrame(): boolean;
  getDebugAdapterKind(): ActiveDebugAdapterKind;
  getPauseOwner(): DebugPauseOwner | null;
  getSelectedFrameId(): number | null;
  getSnapshot(): DebuggerSessionSnapshot;
  isWorkspaceTrusted(): boolean;
  restartFrame(candidate: DebugRestartFrameCandidate): Promise<boolean>;
}

/** Captures one exact selected pause frame and delegates locking to the session control port. */
export function useDebugRestartFrame(
  options: UseDebugRestartFrameOptions,
): DebugRestartFrameCommands {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const canRestartFrame = useCallback(() => currentInvocation(optionsRef.current) !== null, []);

  const restartFrame = useCallback((): boolean => {
    const invocation = currentInvocation(optionsRef.current);
    if (!invocation) return false;
    const isCurrent = () => invocationIsCurrent(optionsRef.current, invocation);
    if (!isCurrent()) return false;
    try {
      void optionsRef.current
        .restartFrame({
          frameId: invocation.frame.frameId,
          isCurrent,
          pauseGeneration: invocation.owner.pauseGeneration,
          rootPath: invocation.owner.rootKey,
          sessionId: invocation.owner.sessionId,
          workspaceOwnerKey: invocation.owner.workspaceOwnerKey,
        })
        .catch(() => undefined);
    } catch {
      return false;
    }
    return true;
  }, []);

  return { canRestartFrame, restartFrame };
}

interface DebugRestartFrameInvocation {
  readonly frame: Readonly<StackFrame>;
  readonly owner: Readonly<DebugPauseOwner>;
  readonly selectedFrameId: number | null;
  readonly snapshot: DebuggerSessionSnapshot;
}

function currentInvocation(
  options: UseDebugRestartFrameOptions,
): DebugRestartFrameInvocation | null {
  try {
    if (
      !options.canRestartFrame() ||
      options.getDebugAdapterKind() !== "node" ||
      !options.isWorkspaceTrusted()
    ) {
      return null;
    }
    const snapshot = options.getSnapshot();
    const owner = options.getPauseOwner();
    const selectedFrameId = options.getSelectedFrameId();
    if (snapshot.state.kind !== "stopped" || !validOwner(snapshot, owner)) return null;
    const frameId = selectedFrameId ?? snapshot.state.topFrame?.frameId ?? null;
    const frame = snapshot.state.frames.find((candidate) => candidate.frameId === frameId);
    if (!frame || !validFrame(frame) || !frameAllowsRestart(frame)) return null;
    const invocation = {
      frame: Object.freeze({ ...frame }),
      owner: Object.freeze({ ...owner }),
      selectedFrameId,
      snapshot,
    };
    return invocationIsCurrent(options, invocation) ? invocation : null;
  } catch {
    return null;
  }
}

function invocationIsCurrent(
  options: UseDebugRestartFrameOptions,
  invocation: DebugRestartFrameInvocation,
): boolean {
  try {
    if (
      !options.canRestartFrame() ||
      options.getDebugAdapterKind() !== "node" ||
      !options.isWorkspaceTrusted() ||
      options.getSnapshot() !== invocation.snapshot ||
      options.getSelectedFrameId() !== invocation.selectedFrameId
    ) {
      return false;
    }
    const owner = options.getPauseOwner();
    if (!ownersEqual(owner, invocation.owner) || invocation.snapshot.state.kind !== "stopped") {
      return false;
    }
    const frame = invocation.snapshot.state.frames.find(
      (candidate) => candidate.frameId === invocation.frame.frameId,
    );
    return frame !== undefined && framesEqual(frame, invocation.frame);
  } catch {
    return false;
  }
}

function validOwner(
  snapshot: DebuggerSessionSnapshot,
  owner: DebugPauseOwner | null,
): owner is DebugPauseOwner {
  return (
    owner !== null &&
    snapshot.state.kind === "stopped" &&
    owner.sessionId === snapshot.state.sessionId &&
    Number.isSafeInteger(owner.pauseGeneration) &&
    owner.pauseGeneration >= 1 &&
    owner.rootKey.length > 0 &&
    owner.workspaceOwnerKey.length > 0
  );
}

function validFrame(frame: StackFrame): boolean {
  return (
    Number.isSafeInteger(frame.frameId) &&
    frame.frameId >= 1 &&
    Number.isSafeInteger(frame.lineNumber) &&
    frame.lineNumber >= 1 &&
    Number.isSafeInteger(frame.column) &&
    frame.column >= 1
  );
}

function frameAllowsRestart(frame: StackFrame): boolean {
  const presentationHint = (frame as StackFrame & { presentationHint?: unknown }).presentationHint;
  return presentationHint !== "label" && presentationHint !== "subtle";
}

function ownersEqual(left: DebugPauseOwner | null, right: DebugPauseOwner): boolean {
  return (
    left !== null &&
    left.pauseGeneration === right.pauseGeneration &&
    left.rootKey === right.rootKey &&
    left.sessionId === right.sessionId &&
    left.workspaceOwnerKey === right.workspaceOwnerKey
  );
}

function framesEqual(left: StackFrame, right: StackFrame): boolean {
  return (
    left.column === right.column &&
    left.filePath === right.filePath &&
    left.frameId === right.frameId &&
    left.lineNumber === right.lineNumber &&
    left.name === right.name &&
    (left as StackFrame & { presentationHint?: unknown }).presentationHint ===
      (right as StackFrame & { presentationHint?: unknown }).presentationHint
  );
}
