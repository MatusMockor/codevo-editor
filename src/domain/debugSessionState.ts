import type { DebugEvent, DebuggerState } from "./debug";

export interface DebuggerSessionSnapshot {
  state: DebuggerState;
  lastSeq: number;
}

export function initialDebuggerSnapshot(): DebuggerSessionSnapshot {
  return { state: { kind: "inactive" }, lastSeq: 0 };
}

export function startingDebuggerSnapshot(
  sessionId: number,
): DebuggerSessionSnapshot {
  return { state: { kind: "starting", sessionId }, lastSeq: 0 };
}

type SessionBoundState = Exclude<DebuggerState, { kind: "inactive" }>;

function nextState(state: SessionBoundState, event: DebugEvent): DebuggerState {
  const payload = event.payload;

  if (payload.kind === "terminated") {
    return {
      kind: "terminated",
      sessionId: state.sessionId,
      exitCode: payload.exitCode,
    };
  }

  if (state.kind === "starting") {
    return state;
  }

  if (payload.kind === "stopped") {
    return {
      kind: "stopped",
      sessionId: state.sessionId,
      reason: payload.reason,
      frames: payload.frames,
      topFrame: payload.frames[0] ?? null,
    };
  }

  if (payload.kind === "resumed" && state.kind === "stopped") {
    return { kind: "running", sessionId: state.sessionId };
  }

  return state;
}

export function reduceDebuggerSnapshot(
  snapshot: DebuggerSessionSnapshot,
  event: DebugEvent,
): DebuggerSessionSnapshot {
  const state = snapshot.state;

  if (state.kind === "inactive") {
    return snapshot;
  }

  if (state.kind === "terminated") {
    return snapshot;
  }

  if (state.kind === "starting" && event.payload.kind === "started") {
    return {
      state: { kind: "running", sessionId: event.payload.sessionId },
      lastSeq: event.seq,
    };
  }

  if (event.sessionId !== state.sessionId) {
    return snapshot;
  }

  if (event.seq <= snapshot.lastSeq) {
    return snapshot;
  }

  return { state: nextState(state, event), lastSeq: event.seq };
}
