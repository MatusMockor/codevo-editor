import type { DebuggerSessionSnapshot } from "../../domain/debugSessionState";

export interface DebugSessionActivityInput {
  readonly snapshot: DebuggerSessionSnapshot;
  readonly debugStartPending?: boolean;
  readonly debugStartBlockedByOtherOwner?: boolean;
  readonly debugCompoundStartPending?: boolean;
}

export function debugSessionActive(input: DebugSessionActivityInput): boolean {
  if (debugSessionIdOf(input.snapshot) !== null) return true;
  return (
    input.debugStartPending === true ||
    input.debugStartBlockedByOtherOwner === true ||
    input.debugCompoundStartPending === true
  );
}

export function debugSessionIdOf(snapshot: DebuggerSessionSnapshot): number | null {
  const state = snapshot.state;
  switch (state.kind) {
    case "starting":
    case "running":
    case "stopped":
      return state.sessionId;
    case "inactive":
    case "terminated":
      return null;
    default:
      return unsupportedDebuggerState(state);
  }
}

export function debuggerStatusLabel(
  snapshot: DebuggerSessionSnapshot,
  startPending: boolean,
  stopPending: boolean,
  startBlockedByOtherOwner: boolean,
): string {
  const state = snapshot.state;

  if (startPending && stopPending) {
    return "Stopping";
  }

  if (startPending || state.kind === "starting") {
    return "Starting";
  }

  if (startBlockedByOtherOwner) {
    return "Waiting for another debug session";
  }

  if (state.kind === "running") {
    return "Running";
  }

  if (state.kind === "stopped") {
    const reason = state.reason === "entry" ? "Entry" : state.reason;
    return `Paused (${reason})`;
  }

  if (state.kind === "terminated") {
    if (state.exitCode === null) {
      return "Terminated";
    }

    return `Terminated (exit code ${state.exitCode})`;
  }

  return "Inactive";
}

function unsupportedDebuggerState(state: never): never {
  throw new TypeError(`Unsupported debugger state: ${JSON.stringify(state)}.`);
}
