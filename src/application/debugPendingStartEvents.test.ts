import { describe, expect, it } from "vitest";
import type { DebugEvent } from "../domain/debug";
import {
  pendingDebugStartEventsForSession,
  retainPendingDebugStartEvent,
  type PendingDebugStartEvents,
} from "./debugPendingStartEvents";

function verification(sessionId: number, seq: number): DebugEvent {
  return {
    rootPath: "/workspace",
    sessionId,
    seq,
    payload: {
      kind: "functionBreakpointsVerified",
      generation: 1,
      breakpoints: [],
    },
  };
}

describe("debugPendingStartEvents", () => {
  it("retains only the exact requested session while the registry is bounded", () => {
    const registry: PendingDebugStartEvents = new Map();
    retainPendingDebugStartEvent(registry, "/workspace", verification(7, 1));
    retainPendingDebugStartEvent(registry, "/workspace", verification(8, 1));

    expect(pendingDebugStartEventsForSession(registry, "/workspace", 7)).toEqual([
      verification(7, 1),
    ]);
    expect(pendingDebugStartEventsForSession(registry, "/workspace", 9)).toEqual([]);
  });

  it("marks a distinct-session flood as overflow for every eventual session", () => {
    const registry: PendingDebugStartEvents = new Map();
    for (let sessionId = 1; sessionId <= 5; sessionId += 1) {
      retainPendingDebugStartEvent(registry, "/workspace", verification(sessionId, 1));
    }

    expect(pendingDebugStartEventsForSession(registry, "/workspace", 99)).toHaveLength(33);
    expect(registry.get("/workspace")?.size).toBe(1);
  });

  it("marks a per-session event flood as overflow without unbounded growth", () => {
    const registry: PendingDebugStartEvents = new Map();
    for (let seq = 1; seq <= 100; seq += 1) {
      retainPendingDebugStartEvent(registry, "/workspace", verification(7, seq));
    }

    expect(pendingDebugStartEventsForSession(registry, "/workspace", 7)).toHaveLength(33);
  });
});
