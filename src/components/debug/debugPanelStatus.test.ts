import { describe, expect, it } from "vitest";
import type { DebuggerSessionSnapshot } from "../../domain/debugSessionState";
import { debugSessionActive, debugSessionIdOf, debuggerStatusLabel } from "./debugPanelStatus";

const inactive: DebuggerSessionSnapshot = { state: { kind: "inactive" }, lastSeq: 0 };
const running: DebuggerSessionSnapshot = { state: { kind: "running", sessionId: 4 }, lastSeq: 1 };
const terminated: DebuggerSessionSnapshot = {
  state: { kind: "terminated", sessionId: 4, exitCode: 0 },
  lastSeq: 2,
};

describe("debug session status", () => {
  it("is active while starting, running, stopped or pending and idle otherwise", () => {
    expect(debugSessionActive({ snapshot: inactive })).toBe(false);
    expect(debugSessionActive({ snapshot: inactive, debugStartPending: true })).toBe(true);
    expect(debugSessionActive({ snapshot: inactive, debugCompoundStartPending: true })).toBe(true);
    expect(debugSessionActive({ snapshot: inactive, debugStartBlockedByOtherOwner: true })).toBe(
      true,
    );
    expect(debugSessionActive({ snapshot: running })).toBe(true);
    expect(debugSessionActive({ snapshot: terminated })).toBe(false);
  });

  it("exposes the session id only for a live session", () => {
    expect(debugSessionIdOf(inactive)).toBeNull();
    expect(debugSessionIdOf(terminated)).toBeNull();
    expect(debugSessionIdOf(running)).toBe(4);
    expect(debugSessionIdOf({ state: { kind: "starting", sessionId: 9 }, lastSeq: 0 })).toBe(9);
  });

  it("keeps the old status labels", () => {
    expect(debuggerStatusLabel(running, false, false, false)).toBe("Running");
    expect(debuggerStatusLabel(inactive, true, false, false)).toBe("Starting");
    expect(debuggerStatusLabel(inactive, true, true, false)).toBe("Stopping");
    expect(debuggerStatusLabel(inactive, false, false, true)).toBe(
      "Waiting for another debug session",
    );
    expect(debuggerStatusLabel(terminated, false, false, false)).toBe("Terminated (exit code 0)");
  });
});
