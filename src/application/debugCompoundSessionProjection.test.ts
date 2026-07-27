import { describe, expect, it } from "vitest";
import type { DebugEvent, DebugStopReason } from "../domain/debug";
import {
  DebugCompoundSessionProjection,
  MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS,
} from "./debugCompoundSessionProjection";
import { MAX_NODE_DEBUG_COMPOUND_MEMBERS } from "./nodeDebugCompoundSessionCoordinator";

const event = (
  sessionId: number,
  seq: number,
  kind: "resumed" | "started" | "stopped" | "terminated",
  rootPath = "/workspace",
): DebugEvent => ({
  payload:
    kind === "started"
      ? { kind, sessionId }
      : kind === "stopped"
        ? {
            frames: [],
            kind,
            pauseGeneration: seq,
            reason: "breakpoint" as DebugStopReason,
          }
        : kind === "terminated"
          ? { exitCode: 0, kind }
          : { kind },
  rootPath,
  seq,
  sessionId,
});
const EXACT_UTF8_ROOT = `/${"😀".repeat(1_023)}abc`;
const OVERSIZED_UTF8_ROOT = `${EXACT_UTF8_ROOT}😀`;

describe("DebugCompoundSessionProjection", () => {
  it("derives pending lifecycle capacity from the compound member bound", () => {
    expect(MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS).toBe(MAX_NODE_DEBUG_COMPOUND_MEMBERS * 4);
  });

  it("projects two to eight exact children and initially selects the first live child", () => {
    for (const sessionIds of [
      [11, 12],
      [11, 12, 13],
      [11, 12, 13, 14],
      [11, 12, 13, 14, 15, 16, 17, 18],
    ]) {
      const projection = new DebugCompoundSessionProjection();
      const lease = projection.begin("/workspace", sessionIds);
      expect(lease).not.toBeNull();
      expect(projection.selectedSessionId(lease!)).toBe(11);
      expect(projection.snapshot()).toEqual({
        hasSelectedSession: true,
        kind: "active",
        memberCount: sessionIds.length,
        runningCount: 0,
        startingCount: sessionIds.length,
        stoppedCount: 0,
      });
    }
  });

  it("models started, stopped and resumed while selecting the latest stopped child", () => {
    const projection = new DebugCompoundSessionProjection();
    const lease = projection.begin("/workspace", [11, 12, 13])!;

    expect(projection.handleEvent(event(11, 1, "started"))).toBe(true);
    expect(projection.handleEvent(event(12, 1, "started"))).toBe(true);
    expect(projection.handleEvent(event(13, 1, "started"))).toBe(true);
    expect(projection.handleEvent(event(11, 2, "stopped"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(11);
    expect(projection.handleEvent(event(12, 2, "stopped"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(12);
    expect(projection.handleEvent(event(12, 3, "resumed"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(11);
    expect(projection.handleEvent(event(11, 3, "resumed"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(11);
    expect(projection.snapshot()).toMatchObject({
      kind: "active",
      runningCount: 3,
      stoppedCount: 0,
    });
  });

  it("enters ending on the first terminal, clears selection and becomes idle only when all end", () => {
    const projection = new DebugCompoundSessionProjection();
    const lease = projection.begin("/workspace", [11, 12])!;
    projection.handleEvent(event(11, 1, "started"));
    projection.handleEvent(event(12, 1, "started"));
    projection.handleEvent(event(12, 2, "stopped"));

    expect(projection.handleEvent(event(12, 3, "terminated"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBeNull();
    expect(projection.snapshot()).toEqual({
      kind: "ending",
      memberCount: 2,
      remainingCount: 1,
    });
    expect(projection.handleEvent(event(11, 2, "stopped"))).toBe(false);
    expect(projection.handleEvent(event(11, 2, "terminated"))).toBe(true);
    expect(projection.snapshot()).toEqual({ kind: "idle" });
  });

  it("fans lifecycle events across eight children and retires after the last terminal", () => {
    const projection = new DebugCompoundSessionProjection();
    const sessionIds = Array.from({ length: 8 }, (_, index) => index + 21);
    const lease = projection.begin("/workspace", sessionIds)!;
    for (const sessionId of sessionIds) {
      expect(projection.handleEvent(event(sessionId, 1, "started"))).toBe(true);
    }
    expect(projection.snapshot()).toMatchObject({ kind: "active", runningCount: 8 });
    expect(projection.handleEvent(event(sessionIds[7]!, 2, "stopped"))).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(sessionIds[7]);
    expect(projection.handleEvent(event(sessionIds[0]!, 2, "terminated"))).toBe(true);
    for (const sessionId of sessionIds.slice(1)) {
      expect(projection.handleEvent(event(sessionId, 3, "terminated"))).toBe(true);
    }
    expect(projection.snapshot()).toEqual({ kind: "idle" });
  });

  it("rejects invalid groups, foreign leases, roots and session identities", () => {
    const projection = new DebugCompoundSessionProjection();
    expect(projection.begin("", [1, 2])).toBeNull();
    expect(projection.begin("/workspace", [1])).toBeNull();
    expect(projection.begin("/workspace", [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    expect(projection.begin("/workspace", [1, 1])).toBeNull();
    expect(projection.begin("/workspace", [0, 2])).toBeNull();
    const lease = projection.begin("/workspace", [11, 12])!;
    const foreignLease = new DebugCompoundSessionProjection().begin("/workspace", [11, 12])!;
    expect(projection.selectedSessionId(foreignLease)).toBeNull();
    expect(projection.handleEvent(event(11, 1, "started", "/foreign"))).toBe(false);
    expect(projection.handleEvent(event(99, 1, "started"))).toBe(false);
    expect(projection.invalidate(foreignLease)).toBe(false);
    expect(projection.invalidate(lease)).toBe(true);
    expect(projection.snapshot()).toEqual({ kind: "idle" });
  });

  it("bounds roots by UTF-8 bytes and rejects control characters", () => {
    expect(new TextEncoder().encode(EXACT_UTF8_ROOT).byteLength).toBe(4_096);
    expect(new DebugCompoundSessionProjection().begin(EXACT_UTF8_ROOT, [11, 12])).not.toBeNull();
    expect(new DebugCompoundSessionProjection().begin(OVERSIZED_UTF8_ROOT, [11, 12])).toBeNull();
    expect(new DebugCompoundSessionProjection().begin("/workspace\nsecret", [11, 12])).toBeNull();
  });

  it("fails closed for duplicate, stale, malformed and invalid-transition events", () => {
    const projection = new DebugCompoundSessionProjection();
    projection.begin("/workspace", [11, 12]);
    expect(projection.handleEvent(event(11, 1, "started"))).toBe(true);
    expect(projection.handleEvent(event(11, 1, "started"))).toBe(false);
    expect(projection.handleEvent(event(11, 0, "stopped"))).toBe(false);
    expect(projection.handleEvent(event(11, 2, "started"))).toBe(false);
    expect(projection.handleEvent(event(12, 1, "resumed"))).toBe(false);
    expect(
      projection.handleEvent({
        ...event(12, 1, "started"),
        payload: { kind: "started", sessionId: 99 },
      }),
    ).toBe(false);
    expect(
      projection.handleEvent({
        ...event(12, 1, "stopped"),
        payload: { frames: [], kind: "stopped", pauseGeneration: -1, reason: "breakpoint" },
      }),
    ).toBe(false);
    expect(projection.snapshot()).toMatchObject({ kind: "active", runningCount: 1 });
  });

  it("sorts early replay by sequence instead of arrival order", () => {
    const projection = new DebugCompoundSessionProjection();
    expect(projection.handleEvent(event(11, 3, "resumed"))).toBe(false);
    expect(projection.handleEvent(event(11, 2, "stopped"))).toBe(false);
    expect(projection.handleEvent(event(11, 1, "started"))).toBe(false);

    const lease = projection.begin("/workspace/", [11, 12])!;
    expect(projection.selectedSessionId(lease)).toBe(11);
    expect(projection.snapshot()).toEqual({
      hasSelectedSession: true,
      kind: "active",
      memberCount: 2,
      runningCount: 1,
      startingCount: 1,
      stoppedCount: 0,
    });
  });

  it("replays early stopped children deterministically by sorted sequence", () => {
    const projection = new DebugCompoundSessionProjection();
    projection.handleEvent(event(12, 4, "stopped"));
    projection.handleEvent(event(11, 3, "stopped"));
    projection.handleEvent(event(12, 1, "started"));
    projection.handleEvent(event(11, 1, "started"));

    const lease = projection.begin("/workspace", [11, 12])!;
    expect(projection.selectedSessionId(lease)).toBe(12);
    expect(projection.snapshot()).toMatchObject({ stoppedCount: 2 });
  });

  it("bounds early events and fails the affected root closed once after overflow", () => {
    const projection = new DebugCompoundSessionProjection();
    for (let index = 1; index <= MAX_PENDING_DEBUG_COMPOUND_PROJECTION_EVENTS + 1; index += 1) {
      projection.handleEvent(event(index, 1, "started"));
    }

    expect(projection.begin("/workspace", [1, 2])).toBeNull();
    const lease = projection.begin("/workspace", [1, 2]);
    expect(lease).not.toBeNull();
    expect(projection.snapshot()).toMatchObject({ kind: "active", startingCount: 2 });
  });

  it("does not expose identities, collections or debug payloads in public snapshots", () => {
    const projection = new DebugCompoundSessionProjection();
    const lease = projection.begin("/workspace", [11, 12])!;
    projection.handleEvent({
      ...event(11, 1, "started"),
      payload: { kind: "started", sessionId: 11 },
    });
    projection.handleEvent({
      ...event(11, 2, "stopped"),
      payload: {
        frames: [
          {
            column: 2,
            filePath: "/secret/source.ts",
            frameId: 7,
            lineNumber: 1,
            name: "secretFrame",
          },
        ],
        kind: "stopped",
        pauseGeneration: 1,
        reason: "breakpoint",
      },
    });

    const serialized = JSON.stringify(projection.snapshot());
    expect(serialized).not.toContain("11");
    expect(serialized).not.toContain("12");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("args");
    expect(serialized).not.toContain("env");
    expect(Object.isFrozen(projection.snapshot())).toBe(true);
    expect(projection.selectedSessionId(lease)).toBe(11);
  });
});
