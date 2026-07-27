import { describe, expect, it } from "vitest";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS,
  NodeDebugCompoundSessionCoordinator,
  type NodeDebugCompoundOwner,
} from "./nodeDebugCompoundSessionCoordinator";

const OWNER: NodeDebugCompoundOwner = {
  launchConfigurationVersion: 3,
  rootPath: "/workspace",
  workspaceEpoch: 7,
  workspaceId: "workspace-a",
};
const EXACT_UTF8_ROOT = `/${"😀".repeat(1_023)}abc`;
const OVERSIZED_UTF8_ROOT = `${EXACT_UTF8_ROOT}😀`;

describe("NodeDebugCompoundSessionCoordinator", () => {
  it("derives pending event capacity from the member bound", () => {
    expect(MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS).toBe(MAX_NODE_DEBUG_COMPOUND_MEMBERS * 4);
  });

  it("accepts eight exact members and rejects nine", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 8);
    expect(lease).not.toBeNull();
    expect(coordinator.snapshot()).toEqual({
      acceptedCount: 0,
      kind: "starting",
      memberCount: 8,
    });
    for (let index = 0; index < 7; index += 1) {
      expect(coordinator.accept(lease!, index, index + 11)).toEqual({ kind: "accepted" });
    }
    expect(coordinator.accept(lease!, 7, 18)).toEqual({ kind: "ready" });
    expect(coordinator.snapshot()).toEqual({
      activeCount: 8,
      hasSelectedSession: false,
      kind: "active",
      memberCount: 8,
    });
    expect(new NodeDebugCompoundSessionCoordinator().begin(OWNER, 9)).toBeNull();
  });

  it("rejects invalid bounds, duplicate slots, duplicate sessions and foreign leases", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    expect(coordinator.begin(OWNER, 1)).toBeNull();
    expect(coordinator.begin(OWNER, 9)).toBeNull();
    const lease = coordinator.begin(OWNER, 2)!;
    const foreign = new NodeDebugCompoundSessionCoordinator().begin(OWNER, 2)!;
    expect(coordinator.accept(foreign, 0, 1)).toEqual({ kind: "rejected" });
    expect(coordinator.accept(lease, 0, 1)).toEqual({ kind: "accepted" });
    expect(coordinator.accept(lease, 0, 2)).toEqual({ kind: "rejected" });
    expect(coordinator.accept(lease, 1, 1)).toEqual({ kind: "rejected" });
  });

  it("bounds owner identities by UTF-8 bytes and rejects control characters", () => {
    expect(new TextEncoder().encode(EXACT_UTF8_ROOT).byteLength).toBe(4_096);
    const exact = new NodeDebugCompoundSessionCoordinator();
    expect(exact.begin({ ...OWNER, rootPath: EXACT_UTF8_ROOT }, 2)).not.toBeNull();

    const oversized = new NodeDebugCompoundSessionCoordinator();
    expect(oversized.begin({ ...OWNER, rootPath: OVERSIZED_UTF8_ROOT }, 2)).toBeNull();
    const controlled = new NodeDebugCompoundSessionCoordinator();
    expect(controlled.begin({ ...OWNER, workspaceId: "workspace\nowner" }, 2)).toBeNull();
  });

  it("enters ending and clears selection after one terminal while retaining live siblings", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 2)!;
    coordinator.accept(lease, 0, 11);
    coordinator.accept(lease, 1, 12);

    expect(
      coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace/", sessionId: 12 }),
    ).toBe(true);
    expect(coordinator.selectedSession(lease)).toBe(12);
    expect(
      coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 12 }),
    ).toBe(true);
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(coordinator.snapshot()).toEqual({
      acceptedCount: 2,
      kind: "ending",
      memberCount: 2,
      remainingCount: 1,
    });
    expect(coordinator.stopAll(lease)).toEqual([11]);
  });

  it("ignores stopped events after ending begins and never selects a sibling", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 2)!;
    coordinator.accept(lease, 0, 11);
    coordinator.accept(lease, 1, 12);
    coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace", sessionId: 11 });
    coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace", sessionId: 12 });
    expect(coordinator.selectedSession(lease)).toBe(12);
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 12 });
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(
      coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace", sessionId: 11 }),
    ).toBe(true);
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(coordinator.snapshot()).toMatchObject({ kind: "ending", remainingCount: 1 });
  });

  it("returns exact member-order rollback and stop-all plans only for the lease", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 3)!;
    const foreign = new NodeDebugCompoundSessionCoordinator().begin(OWNER, 3)!;
    coordinator.accept(lease, 2, 30);
    coordinator.accept(lease, 0, 10);
    expect(coordinator.stopAll(foreign)).toEqual([]);
    expect(coordinator.stopAll(lease)).toEqual([10, 30]);
    expect(coordinator.rollback(lease)).toEqual([10, 30]);
    expect(coordinator.snapshot()).toEqual({ kind: "idle" });
    expect(coordinator.rollback(lease)).toEqual([]);
  });

  it("returns all eight live members for stopAll and retires only after every terminal event", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const sessionIds = Array.from({ length: 8 }, (_, index) => index + 41);
    const lease = coordinator.begin(OWNER, sessionIds.length)!;
    sessionIds.forEach((sessionId, index) => coordinator.accept(lease, index, sessionId));

    expect(coordinator.stopAll(lease)).toEqual(sessionIds);
    for (const sessionId of sessionIds.slice(0, -1)) {
      expect(
        coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId }),
      ).toBe(true);
      expect(coordinator.snapshot()).toMatchObject({ kind: "ending" });
    }
    expect(coordinator.stopAll(lease)).toEqual([sessionIds[7]]);
    expect(
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/workspace",
        sessionId: sessionIds[7]!,
      }),
    ).toBe(true);
    expect(coordinator.snapshot()).toEqual({ kind: "idle" });
  });

  it("invalidates only the exact owner generation and canonical root", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 2)!;
    coordinator.accept(lease, 0, 11);
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 12 });
    expect(coordinator.invalidate({ ...OWNER, workspaceEpoch: 8 })).toEqual([]);
    expect(coordinator.accept(lease, 1, 12)).toEqual({ kind: "ready" });
    expect(coordinator.stopAll(lease)).toEqual([11]);
    expect(coordinator.invalidate({ ...OWNER, rootPath: "/workspace/" })).toEqual([11]);
    expect(coordinator.snapshot()).toEqual({ kind: "idle" });
  });

  it("clears early events for an invalidated idle workspace generation", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace/", sessionId: 11 });
    expect(coordinator.invalidate(OWNER)).toEqual([]);
    const lease = coordinator.begin(OWNER, 2)!;
    expect(coordinator.accept(lease, 0, 11)).toEqual({ kind: "accepted" });
    expect(coordinator.stopAll(lease)).toEqual([11]);
  });

  it("bridges early stopped and terminal events without reviving a dead group", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace/", sessionId: 11 });
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 12 });
    const lease = coordinator.begin(OWNER, 2)!;
    expect(coordinator.accept(lease, 0, 11)).toEqual({ kind: "accepted" });
    expect(coordinator.selectedSession(lease)).toBe(11);
    expect(coordinator.accept(lease, 1, 12)).toEqual({ kind: "ready" });
    expect(coordinator.snapshot()).toMatchObject({ kind: "ending", remainingCount: 1 });

    expect(
      coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 11 }),
    ).toBe(true);
    expect(coordinator.snapshot()).toEqual({ kind: "idle" });
  });

  it("gives an early terminal precedence over an earlier stopped event", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    coordinator.handleEvent({ kind: "stopped", rootPath: "/workspace", sessionId: 11 });
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace/", sessionId: 11 });
    const lease = coordinator.begin(OWNER, 2)!;
    expect(coordinator.accept(lease, 0, 11)).toEqual({ kind: "accepted" });
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(coordinator.stopAll(lease)).toEqual([]);
  });

  it("bounds unknown early events and ignores malformed or foreign active events", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    for (let index = 1; index <= MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS + 4; index += 1) {
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/foreign",
        sessionId: index,
      });
    }
    expect(coordinator.handleEvent({ kind: "terminated", rootPath: "", sessionId: 1 })).toBe(false);
    expect(
      coordinator.handleEvent({
        kind: "resumed",
        rootPath: "/workspace",
        sessionId: 11,
      } as unknown as Parameters<NodeDebugCompoundSessionCoordinator["handleEvent"]>[0]),
    ).toBe(false);
    const lease = coordinator.begin(OWNER, 2)!;
    coordinator.accept(lease, 0, 11);
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 12 });
    for (let index = 1; index <= MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS + 4; index += 1) {
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/foreign",
        sessionId: 100 + index,
      });
    }
    expect(coordinator.handleEvent({ kind: "stopped", rootPath: "/other", sessionId: 11 })).toBe(
      false,
    );
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(coordinator.accept(lease, 1, 12)).toEqual({ kind: "ready" });
    expect(coordinator.snapshot()).toMatchObject({ kind: "ending", remainingCount: 1 });
    expect(coordinator.stopAll(lease)).toEqual([11]);
  });

  it("fails closed when an early terminal is adopted before the remaining members", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    coordinator.handleEvent({ kind: "terminated", rootPath: "/workspace", sessionId: 11 });
    const lease = coordinator.begin(OWNER, 2)!;

    expect(coordinator.accept(lease, 0, 11)).toEqual({ kind: "accepted" });
    expect(coordinator.snapshot()).toEqual({
      acceptedCount: 1,
      kind: "ending",
      memberCount: 2,
      remainingCount: 0,
    });
    expect(coordinator.accept(lease, 1, 12)).toEqual({ kind: "ready" });
    expect(coordinator.selectedSession(lease)).toBeNull();
    expect(coordinator.snapshot()).toEqual({
      acceptedCount: 2,
      kind: "ending",
      memberCount: 2,
      remainingCount: 1,
    });
    expect(coordinator.rollback(lease)).toEqual([12]);
  });

  it("fails closed when same-root early events overflow without losing rollback ownership", () => {
    const coordinator = new NodeDebugCompoundSessionCoordinator();
    const lease = coordinator.begin(OWNER, 2)!;
    coordinator.handleEvent({
      kind: "terminated",
      rootPath: "/workspace",
      sessionId: 51,
    });
    for (let index = 0; index < MAX_PENDING_NODE_DEBUG_COMPOUND_EVENTS; index += 1) {
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/workspace/",
        sessionId: 100 + index,
      });
    }

    // The exact event for 51 may have been evicted. It must not be revived as a ready member, but
    // its accepted ID remains owned by this lease so rollback can stop the native group.
    expect(coordinator.accept(lease, 0, 51)).toEqual({ kind: "rejected" });
    expect(coordinator.rollback(lease)).toEqual([51]);
    expect(coordinator.snapshot()).toEqual({ kind: "idle" });
  });
});
