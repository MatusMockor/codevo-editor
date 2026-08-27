import { useCallback, useLayoutEffect, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadScriptsSurface } from "../../application/useAgentThreadScripts";
import type { AgentTurnStatus } from "../../domain/agentThread";

export function useAgentThreadPresentationViews(
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<AgentThreadView> {
  const previousRef = useRef<ReadonlyArray<AgentThreadView>>([]);
  const previousById = new Map(
    previousRef.current.map((view) => [view.thread.threadId, view] as const),
  );
  let changed = views.length !== previousRef.current.length;
  const next = views.map((view, index) => {
    const previous = previousById.get(view.thread.threadId);
    if (previous === undefined || !samePresentationView(previous, view)) {
      changed = true;
      return view;
    }
    if (previousRef.current[index] !== previous) changed = true;
    return previous;
  });
  if (!changed) return previousRef.current;
  previousRef.current = next;
  return next;
}

export function useAgentLatestCallback<Args extends ReadonlyArray<unknown>, Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

export function useAgentSurfacePresentationView(
  view: AgentThreadView | null,
): AgentThreadView | null {
  const previousRef = useRef<AgentThreadView | null>(null);
  if (view === null) {
    previousRef.current = null;
    return null;
  }
  const previous = previousRef.current;
  if (previous !== null && sameSurfaceView(previous, view)) return previous;
  previousRef.current = view;
  return view;
}

export function useAgentThreadScriptPresentation(
  surface: AgentThreadScriptsSurface,
): AgentThreadScriptsSurface {
  const previousRef = useRef(surface);
  const previous = previousRef.current;
  if (
    previous.entries === surface.entries &&
    previous.preferred === surface.preferred &&
    previous.run === surface.run &&
    previous.runScript === surface.runScript &&
    previous.stopScript === surface.stopScript &&
    previous.truncated === surface.truncated
  ) {
    return previous;
  }
  previousRef.current = surface;
  return surface;
}

function samePresentationView(left: AgentThreadView, right: AgentThreadView): boolean {
  const leftThread = left.thread;
  const rightThread = right.thread;
  return (
    left.lifecycle === right.lifecycle &&
    left.repositoryLabel === right.repositoryLabel &&
    left.projectOrigin === right.projectOrigin &&
    left.worktreeRemoved === right.worktreeRemoved &&
    left.worktreeMissing === right.worktreeMissing &&
    left.changeSummary === right.changeSummary &&
    left.ship === right.ship &&
    left.editorAvailability === right.editorAvailability &&
    left.attention === right.attention &&
    left.unread === right.unread &&
    leftThread.threadId === rightThread.threadId &&
    leftThread.owner.rootKey === rightThread.owner.rootKey &&
    leftThread.owner.ownerId === rightThread.owner.ownerId &&
    leftThread.owner.repositoryRoot === rightThread.owner.repositoryRoot &&
    leftThread.target.isolation === rightThread.target.isolation &&
    leftThread.target.worktreePath === rightThread.target.worktreePath &&
    leftThread.provider.kind === rightThread.provider.kind &&
    leftThread.provider.sessionId === rightThread.provider.sessionId &&
    leftThread.title === rightThread.title &&
    leftThread.pinned === rightThread.pinned &&
    leftThread.archived === rightThread.archived &&
    leftThread.createdAtEpochMs === rightThread.createdAtEpochMs &&
    leftThread.integration === rightThread.integration &&
    leftThread.viewedAtEpochMs === rightThread.viewedAtEpochMs &&
    sameLastTurnPresentation(left, right)
  );
}

function sameSurfaceView(left: AgentThreadView, right: AgentThreadView): boolean {
  return (
    left.thread.threadId === right.thread.threadId &&
    left.thread.owner.rootKey === right.thread.owner.rootKey &&
    left.thread.owner.ownerId === right.thread.owner.ownerId &&
    left.thread.owner.repositoryRoot === right.thread.owner.repositoryRoot &&
    left.thread.target.isolation === right.thread.target.isolation &&
    left.thread.target.worktreePath === right.thread.target.worktreePath &&
    left.worktreeRemoved === right.worktreeRemoved &&
    left.worktreeMissing === right.worktreeMissing &&
    left.changeSummary === right.changeSummary &&
    left.editorAvailability === right.editorAvailability
  );
}

function sameLastTurnPresentation(left: AgentThreadView, right: AgentThreadView): boolean {
  const leftTurn = left.thread.turns[left.thread.turns.length - 1];
  const rightTurn = right.thread.turns[right.thread.turns.length - 1];
  if (leftTurn === undefined || rightTurn === undefined) return leftTurn === rightTurn;
  return (
    leftTurn.turnId === rightTurn.turnId &&
    sameTurnStatus(leftTurn.status, rightTurn.status) &&
    leftTurn.launch === rightTurn.launch &&
    leftTurn.cliVersion === rightTurn.cliVersion
  );
}

function sameTurnStatus(left: AgentTurnStatus, right: AgentTurnStatus): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "pending":
    case "running":
    case "interrupted":
    case "stopped":
      return true;
    case "exited":
      return right.kind === "exited" && left.exitCode === right.exitCode;
    case "failed":
      return right.kind === "failed" && left.message === right.message;
  }
}
