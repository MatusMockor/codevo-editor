import { describe, expect, it } from "vitest";
import type { DebugEvent, DebugEventPayload, StackFrame } from "./debug";
import {
  type DebuggerSessionSnapshot,
  initialDebuggerSnapshot,
  reduceDebuggerSnapshot,
  startingDebuggerSnapshot,
} from "./debugSessionState";

function frame(overrides: Partial<StackFrame> = {}): StackFrame {
  return {
    frameId: 1,
    name: "main",
    filePath: "/app/index.ts",
    lineNumber: 10,
    column: 3,
    ...overrides,
  };
}

function event(
  seq: number,
  payload: DebugEventPayload,
  sessionId = 1,
): DebugEvent {
  return { rootPath: "/root", sessionId, seq, payload };
}

function runningSnapshot(lastSeq = 1): DebuggerSessionSnapshot {
  return reduceDebuggerSnapshot(
    startingDebuggerSnapshot(1),
    event(lastSeq, { kind: "started", sessionId: 1 }),
  );
}

describe("initialDebuggerSnapshot", () => {
  it("starts inactive with no processed events", () => {
    expect(initialDebuggerSnapshot()).toEqual({
      state: { kind: "inactive" },
      lastSeq: 0,
    });
  });
});

describe("startingDebuggerSnapshot", () => {
  it("binds the pending session id with no processed events", () => {
    expect(startingDebuggerSnapshot(1)).toEqual({
      state: { kind: "starting", sessionId: 1 },
      lastSeq: 0,
    });
  });
});

describe("reduceDebuggerSnapshot", () => {
  it("ignores every event while inactive", () => {
    const snapshot = initialDebuggerSnapshot();
    const payloads: DebugEventPayload[] = [
      { kind: "started", sessionId: 1 },
      { kind: "stopped", reason: "breakpoint", frames: [] },
      { kind: "resumed" },
      { kind: "terminated", exitCode: 0 },
      { kind: "output", stream: "stdout", text: "x" },
    ];

    for (const [index, payload] of payloads.entries()) {
      expect(reduceDebuggerSnapshot(snapshot, event(index + 1, payload))).toBe(
        snapshot,
      );
    }
  });

  it("transitions starting to running on the started event", () => {
    const next = reduceDebuggerSnapshot(
      startingDebuggerSnapshot(1),
      event(1, { kind: "started", sessionId: 1 }),
    );

    expect(next).toEqual({
      state: { kind: "running", sessionId: 1 },
      lastSeq: 1,
    });
  });

  it("adopts the started event session id while starting", () => {
    const next = reduceDebuggerSnapshot(
      startingDebuggerSnapshot(99),
      event(1, { kind: "started", sessionId: 2 }, 2),
    );

    expect(next).toEqual({
      state: { kind: "running", sessionId: 2 },
      lastSeq: 1,
    });
  });

  it("ignores stopped and resumed events while still starting", () => {
    const snapshot = startingDebuggerSnapshot(1);

    const afterStopped = reduceDebuggerSnapshot(
      snapshot,
      event(1, { kind: "stopped", reason: "entry", frames: [frame()] }),
    );
    const afterResumed = reduceDebuggerSnapshot(
      snapshot,
      event(1, { kind: "resumed" }),
    );

    expect(afterStopped.state).toEqual({ kind: "starting", sessionId: 1 });
    expect(afterStopped.lastSeq).toBe(1);
    expect(afterResumed.state).toEqual({ kind: "starting", sessionId: 1 });
    expect(afterResumed.lastSeq).toBe(1);
  });

  it("terminates a session that dies while starting", () => {
    const next = reduceDebuggerSnapshot(
      startingDebuggerSnapshot(1),
      event(1, { kind: "terminated", exitCode: 1 }),
    );

    expect(next.state).toEqual({
      kind: "terminated",
      sessionId: 1,
      exitCode: 1,
    });
  });

  it("transitions running to stopped with the top frame precomputed", () => {
    const top = frame({ frameId: 7, name: "handler" });
    const next = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, {
        kind: "stopped",
        reason: "breakpoint",
        frames: [top, frame({ frameId: 8 })],
      }),
    );

    expect(next.state).toEqual({
      kind: "stopped",
      sessionId: 1,
      reason: "breakpoint",
      frames: [top, frame({ frameId: 8 })],
      topFrame: top,
    });
    expect(next.lastSeq).toBe(2);
  });

  it("stops with a null top frame when no frames arrive", () => {
    const next = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "stopped", reason: "pause", frames: [] }),
    );

    expect(next.state).toEqual({
      kind: "stopped",
      sessionId: 1,
      reason: "pause",
      frames: [],
      topFrame: null,
    });
  });

  it("resumes a stopped session back to running", () => {
    const stopped = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "stopped", reason: "breakpoint", frames: [] }),
    );
    const next = reduceDebuggerSnapshot(stopped, event(3, { kind: "resumed" }));

    expect(next).toEqual({
      state: { kind: "running", sessionId: 1 },
      lastSeq: 3,
    });
  });

  it("replaces one stop with the next when a step lands", () => {
    const stopped = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "stopped", reason: "breakpoint", frames: [frame()] }),
    );
    const next = reduceDebuggerSnapshot(
      stopped,
      event(3, {
        kind: "stopped",
        reason: "step",
        frames: [frame({ lineNumber: 11 })],
      }),
    );

    expect(next.state).toEqual({
      kind: "stopped",
      sessionId: 1,
      reason: "step",
      frames: [frame({ lineNumber: 11 })],
      topFrame: frame({ lineNumber: 11 }),
    });
  });

  it("transitions running to terminated and records the exit code", () => {
    const next = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "terminated", exitCode: null }),
    );

    expect(next.state).toEqual({
      kind: "terminated",
      sessionId: 1,
      exitCode: null,
    });
  });

  it("treats terminated as terminal and ignores later session events", () => {
    const terminated = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "terminated", exitCode: 0 }),
    );
    const payloads: DebugEventPayload[] = [
      { kind: "started", sessionId: 1 },
      { kind: "stopped", reason: "breakpoint", frames: [] },
      { kind: "resumed" },
      { kind: "output", stream: "stderr", text: "late" },
    ];

    for (const [index, payload] of payloads.entries()) {
      expect(reduceDebuggerSnapshot(terminated, event(index + 3, payload))).toBe(
        terminated,
      );
    }
  });

  it("ignores events from a foreign session", () => {
    const snapshot = runningSnapshot();
    const foreign = event(
      2,
      { kind: "stopped", reason: "breakpoint", frames: [] },
      2,
    );

    expect(reduceDebuggerSnapshot(snapshot, foreign)).toBe(snapshot);
  });

  it("ignores replayed events with a seq at or below the last processed", () => {
    const stopped = reduceDebuggerSnapshot(
      runningSnapshot(),
      event(2, { kind: "stopped", reason: "breakpoint", frames: [] }),
    );
    const resumed = reduceDebuggerSnapshot(stopped, event(3, { kind: "resumed" }));

    const replayedStop = reduceDebuggerSnapshot(
      resumed,
      event(2, { kind: "stopped", reason: "breakpoint", frames: [] }),
    );
    const sameSeq = reduceDebuggerSnapshot(
      resumed,
      event(3, { kind: "stopped", reason: "breakpoint", frames: [] }),
    );

    expect(replayedStop).toBe(resumed);
    expect(sameSeq).toBe(resumed);
  });

  it("passes output events through without changing the state", () => {
    const snapshot = runningSnapshot();
    const next = reduceDebuggerSnapshot(
      snapshot,
      event(2, { kind: "output", stream: "stdout", text: "log line" }),
    );

    expect(next.state).toBe(snapshot.state);
    expect(next.lastSeq).toBe(2);
  });

  it("passes breakpointsVerified events through without changing the state", () => {
    const snapshot = runningSnapshot();
    const next = reduceDebuggerSnapshot(
      snapshot,
      event(2, {
        kind: "breakpointsVerified",
        filePath: "/app/index.ts",
        breakpoints: [],
      }),
    );

    expect(next.state).toBe(snapshot.state);
    expect(next.lastSeq).toBe(2);
  });

  it("ignores a duplicate started event while already running", () => {
    const snapshot = runningSnapshot();
    const next = reduceDebuggerSnapshot(
      snapshot,
      event(2, { kind: "started", sessionId: 1 }),
    );

    expect(next.state).toBe(snapshot.state);
    expect(next.lastSeq).toBe(2);
  });
});
