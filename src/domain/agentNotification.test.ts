import { describe, expect, it } from "vitest";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "./agentThread";
import {
  MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS,
  agentThreadNotificationState,
  agentThreadNotificationStillCurrent,
  detectAgentThreadNotifications,
  type AgentThreadNotificationBaseline,
  type AgentThreadNotificationState,
  type AgentThreadNotificationSubject,
} from "./agentNotification";

function turn(turnId: string, status: AgentTurnStatus, origin?: "background"): AgentTurn {
  return {
    ...(origin === undefined ? {} : { origin }),
    turnId,
    prompt: "do it",
    status,
    startedAtEpochMs: 1,
    endedAtEpochMs: status.kind === "running" || status.kind === "pending" ? null : 2,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(turns: AgentTurn[], overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "t1",
    owner: { rootKey: "/a", ownerId: "owner-a", repositoryRoot: "/a" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "s" },
    title: "Fix parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turns,
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    ...overrides,
  };
}

const QUIET: AgentThreadNotificationState = { kind: "quiet" };
const UNKNOWN: AgentThreadNotificationState = { kind: "unknown" };
const DONE: AgentThreadNotificationState = {
  kind: "signal",
  signal: { kind: "completed", key: "u1:completed" },
};
const approval = (id: string): AgentThreadNotificationState => ({
  kind: "signal",
  signal: { kind: "approval", key: `approval:${id}` },
});

function subject(
  threadId: string,
  state: AgentThreadNotificationState,
  ownerKey = "owner-a",
  whenMissing: "forget" | "retain" = "forget",
): AgentThreadNotificationSubject {
  return {
    threadId,
    ownerKey,
    whenMissing,
    title: `Thread ${threadId}`,
    projectLabel: "app",
    state,
  };
}

function run(
  steps: ReadonlyArray<ReadonlyArray<AgentThreadNotificationSubject>>,
): ReadonlyArray<string> {
  let baseline: AgentThreadNotificationBaseline = new Map();
  const kinds: string[] = [];
  for (const step of steps) {
    const detection = detectAgentThreadNotifications(baseline, step);
    baseline = detection.baseline;
    kinds.push(...detection.events.map((event) => `${event.threadId}:${event.kind}`));
  }
  return kinds;
}

describe("agentThreadNotificationState", () => {
  it("reports completion of a successfully exited turn", () => {
    expect(
      agentThreadNotificationState(thread([turn("u1", { kind: "exited", exitCode: 0 })]), null),
    ).toEqual(DONE);
  });

  it("reports genuine failures and non-zero exits", () => {
    for (const status of [
      { kind: "failed", message: "boom" },
      { kind: "exited", exitCode: 2 },
    ] satisfies AgentTurnStatus[]) {
      expect(agentThreadNotificationState(thread([turn("u1", status)]), null)).toEqual({
        kind: "signal",
        signal: { kind: "failed", key: "u1:failed" },
      });
    }
  });

  it("stays quiet for stopped and interrupted turns, including interrupted background replies", () => {
    expect(agentThreadNotificationState(thread([turn("u1", { kind: "stopped" })]), null)).toEqual(
      QUIET,
    );
    expect(
      agentThreadNotificationState(thread([turn("u1", { kind: "interrupted" })]), null),
    ).toEqual(QUIET);
    expect(
      agentThreadNotificationState(
        thread([turn("u2", { kind: "interrupted" }, "background")]),
        null,
      ),
    ).toEqual(QUIET);
  });

  it("keys a pending interaction by its exact request while the turn runs", () => {
    const running = thread([turn("u2", { kind: "running" })]);
    expect(agentThreadNotificationState(running, { kind: "approval", id: "req-9" })).toEqual(
      approval("req-9"),
    );
    expect(agentThreadNotificationState(running, { kind: "input", id: "q-1" })).toEqual({
      kind: "signal",
      signal: { kind: "input", key: "input:q-1" },
    });
    expect(agentThreadNotificationState(running, null)).toEqual(QUIET);
    expect(agentThreadNotificationState(running, undefined)).toEqual(UNKNOWN);
  });

  it("never reports archived or empty threads", () => {
    expect(
      agentThreadNotificationState(
        thread([turn("u1", { kind: "exited", exitCode: 0 })], { archived: true }),
        null,
      ),
    ).toEqual(QUIET);
    expect(agentThreadNotificationState(thread([]), null)).toEqual(QUIET);
  });
});

describe("detectAgentThreadNotifications", () => {
  it("treats the first observation as a baseline", () => {
    expect(run([[subject("t1", DONE)]])).toEqual([]);
  });

  it("emits an event when a known thread reaches a new signal", () => {
    const first = detectAgentThreadNotifications(new Map(), [subject("t1", QUIET)]);
    const second = detectAgentThreadNotifications(first.baseline, [subject("t1", DONE)]);
    expect(second.events).toEqual([
      {
        threadId: "t1",
        ownerKey: "owner-a",
        title: "Thread t1",
        projectLabel: "app",
        kind: "completed",
        signalKey: "u1:completed",
        key: "t1\u0001owner-a\u0001u1:completed",
      },
    ]);
  });

  it("does not repeat an unchanged signal", () => {
    expect(run([[subject("t1", QUIET)], [subject("t1", DONE)], [subject("t1", DONE)]])).toEqual([
      "t1:completed",
    ]);
  });

  it("keeps the last known interaction while the thread is not polled", () => {
    expect(
      run([
        [subject("t1", QUIET)],
        [subject("t1", approval("a"))],
        [subject("t1", UNKNOWN)],
        [subject("t1", approval("a"))],
      ]),
    ).toEqual(["t1:approval"]);
  });

  it("notifies a different request in the same turn", () => {
    expect(
      run([
        [subject("t1", QUIET)],
        [subject("t1", approval("a"))],
        [subject("t1", QUIET)],
        [subject("t1", approval("b"))],
      ]),
    ).toEqual(["t1:approval", "t1:approval"]);
  });

  it("reports the first approval of a thread that was first seen running", () => {
    expect(run([[subject("t1", UNKNOWN)], [subject("t1", approval("a"))]])).toEqual([
      "t1:approval",
    ]);
  });

  it("still reports completion after an unknown running start", () => {
    expect(run([[subject("t1", UNKNOWN)], [subject("t1", DONE)]])).toEqual(["t1:completed"]);
  });

  it("treats a replaced owner as a new identity rather than a transition", () => {
    expect(run([[subject("t1", QUIET, "owner-a")], [subject("t1", DONE, "owner-b")]])).toEqual([]);
  });

  it("re-baselines threads that disappear and come back", () => {
    expect(run([[subject("t1", QUIET)], [], [subject("t1", DONE)]])).toEqual([]);
  });

  it("tells whether an event still matches the latest observation", () => {
    const first = detectAgentThreadNotifications(new Map(), [subject("t1", QUIET)]);
    const raised = detectAgentThreadNotifications(first.baseline, [subject("t1", approval("a"))]);
    const event = raised.events[0];
    expect(event).toBeDefined();
    if (event === undefined) return;

    expect(agentThreadNotificationStillCurrent(raised.baseline, event)).toBe(true);
    const unknown = detectAgentThreadNotifications(raised.baseline, [subject("t1", UNKNOWN)]);
    expect(agentThreadNotificationStillCurrent(unknown.baseline, event)).toBe(true);
    const resolved = detectAgentThreadNotifications(raised.baseline, [subject("t1", QUIET)]);
    expect(agentThreadNotificationStillCurrent(resolved.baseline, event)).toBe(false);
    const gone = detectAgentThreadNotifications(raised.baseline, []);
    expect(agentThreadNotificationStillCurrent(gone.baseline, event)).toBe(false);
    const moved = detectAgentThreadNotifications(raised.baseline, [
      subject("t1", approval("a"), "owner-b"),
    ]);
    expect(agentThreadNotificationStillCurrent(moved.baseline, event)).toBe(false);
  });

  it("keeps a finished event current when the next turn starts, but not a deleted thread", () => {
    const first = detectAgentThreadNotifications(new Map(), [subject("t1", QUIET)]);
    const raised = detectAgentThreadNotifications(first.baseline, [subject("t1", DONE)]);
    const event = raised.events[0];
    expect(event).toBeDefined();
    if (event === undefined) return;

    const nextTurn = detectAgentThreadNotifications(raised.baseline, [subject("t1", QUIET)]);
    expect(agentThreadNotificationStillCurrent(nextTurn.baseline, event)).toBe(true);
    const deleted = detectAgentThreadNotifications(raised.baseline, []);
    expect(agentThreadNotificationStillCurrent(deleted.baseline, event)).toBe(false);
  });

  it("retains a temporarily missing remote thread instead of re-baselining it", () => {
    const remote = (state: AgentThreadNotificationState) =>
      subject("r1", state, "remote-owner", "retain");
    expect(run([[remote(QUIET)], [], [remote(DONE)]])).toEqual(["r1:completed"]);
    expect(run([[remote(QUIET)], [remote(DONE)], [], [remote(DONE)]])).toEqual(["r1:completed"]);
  });

  it("bounds retained remote threads by the subject cap", () => {
    const remote = Array.from({ length: MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS }, (_, index) =>
      subject(`r${index}`, QUIET, "remote-owner", "retain"),
    );
    const first = detectAgentThreadNotifications(new Map(), remote);
    const next = detectAgentThreadNotifications(first.baseline, [subject("local", QUIET)]);
    expect(next.baseline.size).toBe(MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS);
    expect(next.baseline.has("local")).toBe(true);
  });

  it("bounds the number of observed subjects", () => {
    const many = Array.from({ length: MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS + 5 }, (_, index) =>
      subject(`t${index}`, QUIET),
    );
    expect(detectAgentThreadNotifications(new Map(), many).baseline.size).toBe(
      MAX_AGENT_THREAD_NOTIFICATION_SUBJECTS,
    );
  });
});
