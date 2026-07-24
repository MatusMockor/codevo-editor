import type { NodePackageTaskEvent, NodePackageTaskOwner } from "../domain/nodePackageScripts";

interface TaskIdentity {
  readonly runId: string;
  readonly workspaceId: string;
  readonly manifestRelativePath: string;
  readonly scriptName: string;
}

export type NodePackageTaskState =
  | (TaskIdentity & { readonly status: "acquiring-terminal"; readonly sessionId: null })
  | (NodePackageTaskOwner & { readonly status: "starting" | "running" | "stopping" })
  | (TaskIdentity & {
      readonly status: "exited";
      readonly sessionId: null;
      readonly exitCode: number | null;
    })
  | (TaskIdentity & {
      readonly status: "failed";
      readonly sessionId: null;
      readonly message: string;
    })
  | (TaskIdentity & { readonly status: "stopped"; readonly sessionId: null });

export type NodePackageTaskAction =
  | { readonly type: "stage"; readonly identity: TaskIdentity }
  | { readonly type: "terminal-acquired"; readonly runId: string; readonly sessionId: number }
  | { readonly type: "start-accepted"; readonly runId: string }
  | { readonly type: "start-rejected"; readonly runId: string; readonly message: string }
  | { readonly type: "stopping"; readonly runId: string }
  | { readonly type: "stop-accepted"; readonly runId: string }
  | { readonly type: "stop-rejected"; readonly runId: string }
  | { readonly type: "event"; readonly event: NodePackageTaskEvent }
  | { readonly type: "reset" };

export function reduceNodePackageTaskState(
  state: NodePackageTaskState | null,
  action: NodePackageTaskAction,
): NodePackageTaskState | null {
  if (action.type === "stage") {
    return { ...action.identity, status: "acquiring-terminal", sessionId: null };
  }
  if (action.type === "reset") return null;
  if (action.type === "event") {
    if (!state || !eventBelongsToState(action.event, state)) return state;
    if (action.event.status === "running") {
      return isTerminal(state) || state.status === "stopping" ? state : { ...action.event };
    }
    if (action.event.status === "exited") {
      return {
        ...taskIdentity(action.event),
        status: "exited",
        sessionId: null,
        exitCode: action.event.exitCode,
      };
    }
    if (action.event.status === "failed") {
      return {
        ...taskIdentity(action.event),
        status: "failed",
        sessionId: null,
        message: action.event.message,
      };
    }
    return { ...taskIdentity(action.event), status: "stopped", sessionId: null };
  }
  if (!state || state.runId !== action.runId) return state;
  if (action.type === "terminal-acquired") {
    return state.status === "acquiring-terminal"
      ? { ...taskIdentity(state), status: "starting", sessionId: action.sessionId }
      : state;
  }
  if (action.type === "start-accepted") {
    return state.status === "starting" ? { ...state, status: "running" } : state;
  }
  if (action.type === "start-rejected") {
    return isTerminal(state)
      ? state
      : { ...taskIdentity(state), status: "failed", sessionId: null, message: action.message };
  }
  if (action.type === "stopping") {
    if (state.status === "acquiring-terminal") {
      return { ...taskIdentity(state), status: "stopped", sessionId: null };
    }
    return state.status === "starting" || state.status === "running"
      ? { ...state, status: "stopping" }
      : state;
  }
  if (action.type === "stop-rejected") {
    return state;
  }
  if (action.type === "stop-accepted") {
    return state.status === "stopping"
      ? { ...taskIdentity(state), status: "stopped", sessionId: null }
      : state;
  }
  return state;
}

export function nodePackageTaskIsActive(state: NodePackageTaskState | null): boolean {
  return state !== null && !isTerminal(state);
}

function eventBelongsToState(event: NodePackageTaskEvent, state: NodePackageTaskState): boolean {
  return (
    event.runId === state.runId &&
    event.workspaceId === state.workspaceId &&
    event.manifestRelativePath === state.manifestRelativePath &&
    event.scriptName === state.scriptName &&
    (state.sessionId === null || event.sessionId === state.sessionId)
  );
}

function taskIdentity(value: TaskIdentity): TaskIdentity {
  return {
    runId: value.runId,
    workspaceId: value.workspaceId,
    manifestRelativePath: value.manifestRelativePath,
    scriptName: value.scriptName,
  };
}

function isTerminal(state: NodePackageTaskState): boolean {
  return state.status === "exited" || state.status === "failed" || state.status === "stopped";
}
