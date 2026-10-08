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
  type AgentThreadSessionWork,
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
      agentThreadNotificationState(
        thread([turn("u1", { kind: "exited", exitCode: 0 })]),
        null,
        "idle",
      ),
    ).toEqual(DONE);
  });

  it("reports genuine failures and non-zero exits", () => {
    for (const status of [
      { kind: "failed", message: "boom" },
      { kind: "exited", exitCode: 2 },
    ] satisfies AgentTurnStatus[]) {
      expect(agentThreadNotificationState(thread([turn("u1", status)]), null, "idle")).toEqual({
        kind: "signal",
        signal: { kind: "failed", key: "u1:failed" },
      });
    }
  });

  it("stays quiet for stopped and interrupted turns the user prompted or stopped", () => {
    expect(
      agentThreadNotificationState(thread([turn("u1", { kind: "stopped" })]), null, "idle"),
    ).toEqual(QUIET);
    expect(
      agentThreadNotificationState(thread([turn("u1", { kind: "interrupted" })]), null, "idle"),
    ).toEqual(QUIET);
    for (const work of ["idle", "live"] as const) {
      expect(
        agentThreadNotificationState(
          thread([turn("u2", { kind: "stopped" }, "background")]),
          null,
          work,
        ),
      ).toEqual(QUIET);
      expect(
        agentThreadNotificationState(thread([turn("u1", { kind: "interrupted" })]), null, work),
      ).toEqual(QUIET);
    }
  });

  it("releases what was held when an unprompted reply was cut off, and keeps holding while work is live", () => {
    const cutOff = thread([
      turn("u1", { kind: "exited", exitCode: 0 }),
      turn("u2", { kind: "interrupted" }, "background"),
    ]);
    expect(agentThreadNotificationState(cutOff, null, "idle")).toEqual({ kind: "released" });
    expect(agentThreadNotificationState(cutOff, null, "live")).toEqual({ kind: "withheld" });
    expect(agentThreadNotificationState({ ...cutOff, archived: true }, null, "idle")).toEqual(
      QUIET,
    );
  });

  it("keys a pending interaction by its exact request while the turn runs", () => {
    const running = thread([turn("u2", { kind: "running" })]);
    expect(
      agentThreadNotificationState(running, { kind: "approval", id: "req-9" }, "idle"),
    ).toEqual(approval("req-9"));
    expect(agentThreadNotificationState(running, { kind: "input", id: "q-1" }, "idle")).toEqual({
      kind: "signal",
      signal: { kind: "input", key: "input:q-1" },
    });
    expect(agentThreadNotificationState(running, null, "idle")).toEqual(QUIET);
    expect(agentThreadNotificationState(running, undefined, "idle")).toEqual(UNKNOWN);
  });

  it("never reports archived or empty threads", () => {
    expect(
      agentThreadNotificationState(
        thread([turn("u1", { kind: "exited", exitCode: 0 })], { archived: true }),
        null,
        "idle",
      ),
    ).toEqual(QUIET);
    expect(agentThreadNotificationState(thread([]), null, "idle")).toEqual(QUIET);
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

describe("completion while session background work is live", () => {
  const exitedCleanly: AgentTurnStatus = { kind: "exited", exitCode: 0 };
  const running = thread([turn("u1", { kind: "running" })]);
  const settled = thread([turn("u1", exitedCleanly)]);
  const failed = thread([turn("u1", { kind: "exited", exitCode: 2 })]);
  const replying = thread([
    turn("u1", exitedCleanly),
    turn("u2", { kind: "running" }, "background"),
  ]);
  const replied = thread([turn("u1", exitedCleanly), turn("u2", exitedCleanly, "background")]);

  const at = (observed: AgentThread, work: AgentThreadSessionWork) =>
    agentThreadNotificationState(observed, null, work);

  function signalKeys(steps: ReadonlyArray<AgentThreadNotificationState>): ReadonlyArray<string> {
    let baseline: AgentThreadNotificationBaseline = new Map();
    const keys: string[] = [];
    for (const state of steps) {
      const detection = detectAgentThreadNotifications(baseline, [subject("t1", state)]);
      baseline = detection.baseline;
      keys.push(...detection.events.map((event) => event.signalKey));
    }
    return keys;
  }

  it("holds a completion back as a state naming the completion it holds", () => {
    expect(at(settled, "live")).toEqual({ kind: "held", signal: DONE.signal });
    expect(at(replied, "live")).toEqual({
      kind: "held",
      signal: { kind: "completed", key: "u2:completed" },
    });
  });

  it("leaves failed, stopped, archived and running threads as they were", () => {
    expect(at(failed, "live")).toEqual(at(failed, "idle"));
    expect(at(thread([turn("u1", { kind: "failed", message: "boom" })]), "live")).toEqual({
      kind: "signal",
      signal: { kind: "failed", key: "u1:failed" },
    });
    expect(at(thread([turn("u1", { kind: "stopped" })]), "live")).toEqual(QUIET);
    expect(at(thread([turn("u1", exitedCleanly)], { archived: true }), "live")).toEqual(QUIET);
    expect(at(running, "live")).toEqual(QUIET);
    expect(agentThreadNotificationState(running, undefined, "live")).toEqual(UNKNOWN);
    expect(agentThreadNotificationState(running, { kind: "approval", id: "a" }, "live")).toEqual(
      approval("a"),
    );
  });

  it("fires the held completion once when the background work ends without a reply", () => {
    const held = [at(running, "live"), at(settled, "live"), at(settled, "live")];
    expect(signalKeys(held)).toEqual([]);
    expect(signalKeys([...held, at(settled, "idle"), at(settled, "idle")])).toEqual([
      "u1:completed",
    ]);
  });

  it("fires once for the background reply turn that ends the work", () => {
    expect(
      signalKeys([
        at(running, "idle"),
        at(settled, "live"),
        at(replying, "live"),
        at(replied, "live"),
        at(replied, "idle"),
        at(replied, "idle"),
      ]),
    ).toEqual(["u2:completed"]);
  });

  it("reports a failure at once and does not repeat it when the work ends", () => {
    expect(signalKeys([at(running, "live"), at(failed, "live"), at(failed, "idle")])).toEqual([
      "u1:failed",
    ]);
  });

  it("does not repeat a completion delivered before the work was observed", () => {
    expect(
      signalKeys([
        at(running, "idle"),
        at(settled, "idle"),
        at(settled, "live"),
        at(settled, "idle"),
      ]),
    ).toEqual(["u1:completed"]);
  });

  it.each(["approval", "input"] as const)(
    "retires a resolved %s request once its turn's completion is held, then fires that completion once",
    (kind) => {
      const observe = (
        previous: AgentThreadNotificationBaseline,
        state: AgentThreadNotificationState,
      ) => detectAgentThreadNotifications(previous, [subject("t1", state)]);
      const started = observe(new Map(), at(running, "live"));
      const asked = observe(
        started.baseline,
        agentThreadNotificationState(running, { kind, id: "r1" }, "live"),
      );
      const request = asked.events[0];
      expect(request?.kind).toBe(kind);
      if (request === undefined) return;
      expect(agentThreadNotificationStillCurrent(asked.baseline, request)).toBe(true);

      const held = observe(asked.baseline, at(settled, "live"));
      expect(held.events).toEqual([]);
      expect(agentThreadNotificationStillCurrent(held.baseline, request)).toBe(false);

      const ended = observe(held.baseline, at(settled, "idle"));
      expect(ended.events.map((event) => event.signalKey)).toEqual(["u1:completed"]);
      expect(observe(ended.baseline, at(settled, "idle")).events).toEqual([]);
    },
  );

  it("remembers nothing for a completion first seen while held and reports it when the work ends", () => {
    const first = detectAgentThreadNotifications(new Map(), [subject("t1", at(settled, "live"))]);
    expect(first.events).toEqual([]);
    expect(first.baseline.get("t1")?.signalKey).toBeNull();
    expect(signalKeys([at(settled, "live"), at(settled, "idle"), at(settled, "idle")])).toEqual([
      "u1:completed",
    ]);
    expect(
      run([
        [subject("t1", at(settled, "live"), "owner-a")],
        [subject("t1", at(settled, "live"), "owner-b")],
        [subject("t1", at(settled, "idle"), "owner-b")],
      ]),
    ).toEqual(["t1:completed"]);
  });

  it("stays silent when the owner is replaced while the completion is held", () => {
    expect(
      run([
        [subject("t1", at(running, "live"), "owner-a")],
        [subject("t1", at(settled, "live"), "owner-a")],
        [subject("t1", at(settled, "idle"), "owner-b")],
        [subject("t1", at(settled, "idle"), "owner-b")],
      ]),
    ).toEqual([]);
  });

  describe("when the follow-up reply is cut off", () => {
    const cutOff = thread([
      turn("u1", exitedCleanly),
      turn("u2", { kind: "interrupted" }, "background"),
    ]);
    const cutOffAfterReply = thread([
      turn("u1", exitedCleanly),
      turn("u2", exitedCleanly, "background"),
      turn("u3", { kind: "interrupted" }, "background"),
    ]);
    const stoppedReply = thread([
      turn("u1", exitedCleanly),
      turn("u2", { kind: "stopped" }, "background"),
    ]);
    const failedReply = thread([
      turn("u1", exitedCleanly),
      turn("u2", { kind: "failed", message: "boom" }, "background"),
    ]);

    it("delivers the held completion once when the session dies while the reply is written", () => {
      expect(
        signalKeys([
          at(running, "live"),
          at(settled, "live"),
          at(cutOff, "live"),
          at(cutOff, "idle"),
          at(cutOff, "idle"),
        ]),
      ).toEqual(["u1:completed"]);
    });

    it("delivers the latest held completion, not an earlier one it replaced", () => {
      expect(
        signalKeys([
          at(running, "live"),
          at(settled, "live"),
          at(replied, "live"),
          at(cutOffAfterReply, "live"),
          at(cutOffAfterReply, "idle"),
          at(cutOffAfterReply, "idle"),
        ]),
      ).toEqual(["u2:completed"]);
    });

    it("keeps the held completion across an unknown poll and a hold that goes on", () => {
      const observed = [
        at(running, "live"),
        at(settled, "live"),
        agentThreadNotificationState(running, undefined, "live"),
        at(cutOff, "live"),
        at(cutOff, "live"),
      ];
      expect(signalKeys(observed)).toEqual([]);
      expect(signalKeys([...observed, at(cutOff, "idle")])).toEqual(["u1:completed"]);
    });

    it("says nothing again for a completion that was already delivered before the hold", () => {
      expect(
        signalKeys([
          at(running, "idle"),
          at(settled, "idle"),
          at(settled, "live"),
          at(cutOff, "live"),
          at(cutOff, "idle"),
        ]),
      ).toEqual(["u1:completed"]);
    });

    it("stays quiet when the user stopped the reply, also once the work ends", () => {
      expect(
        signalKeys([
          at(running, "live"),
          at(settled, "live"),
          at(stoppedReply, "live"),
          at(stoppedReply, "idle"),
          at(cutOff, "idle"),
        ]),
      ).toEqual([]);
    });

    it("reports a failed reply as failed and never the completion it replaced", () => {
      expect(
        signalKeys([
          at(running, "live"),
          at(settled, "live"),
          at(failedReply, "live"),
          at(failedReply, "idle"),
          at(cutOff, "idle"),
        ]),
      ).toEqual(["u2:failed"]);
    });

    it("drops the held completion when a new turn starts before the hold ends", () => {
      const next = thread([turn("u1", exitedCleanly), turn("u3", { kind: "running" })]);
      expect(
        signalKeys([
          at(running, "live"),
          at(settled, "live"),
          at(next, "live"),
          at(cutOff, "idle"),
        ]),
      ).toEqual([]);
    });

    it("drops the held completion with its owner, its thread or an archive", () => {
      expect(
        run([
          [subject("t1", at(running, "live"), "owner-a")],
          [subject("t1", at(settled, "live"), "owner-a")],
          [subject("t1", at(cutOff, "idle"), "owner-b")],
          [subject("t1", at(cutOff, "idle"), "owner-a")],
        ]),
      ).toEqual([]);
      expect(
        run([
          [subject("t1", at(running, "live"))],
          [subject("t1", at(settled, "live"))],
          [],
          [subject("t1", at(cutOff, "idle"))],
        ]),
      ).toEqual([]);
      expect(
        run([
          [subject("t1", at(running, "live"))],
          [subject("t1", at(settled, "live"))],
          [subject("t1", at({ ...settled, archived: true }, "live"))],
          [subject("t1", at(cutOff, "idle"))],
        ]),
      ).toEqual([]);
    });

    it("keeps the held completion of a remote thread that is briefly missing", () => {
      const remote = (state: AgentThreadNotificationState) =>
        subject("r1", state, "remote-owner", "retain");
      expect(
        run([
          [remote(at(running, "live"))],
          [remote(at(settled, "live"))],
          [],
          [remote(at(cutOff, "idle"))],
          [remote(at(cutOff, "idle"))],
        ]),
      ).toEqual(["r1:completed"]);
    });

    it("adopts a reply that was already cut off when first seen without a notification", () => {
      expect(signalKeys([at(cutOff, "idle"), at(cutOff, "idle")])).toEqual([]);
      expect(signalKeys([at(cutOff, "live"), at(cutOff, "idle")])).toEqual([]);
    });

    it("delivers a completion first seen held, as after a reload, when its reply is then cut off", () => {
      const first = detectAgentThreadNotifications(new Map(), [subject("t1", at(settled, "live"))]);
      expect(first.events).toEqual([]);
      expect(first.baseline.get("t1")).toMatchObject({
        signalKey: null,
        heldCompletion: { kind: "completed", key: "u1:completed" },
      });
      const released = detectAgentThreadNotifications(first.baseline, [
        subject("t1", at(cutOff, "idle")),
      ]);
      expect(released.events.map((event) => [event.kind, event.signalKey])).toEqual([
        ["completed", "u1:completed"],
      ]);
      expect(released.baseline.get("t1")).toMatchObject({
        signalKey: "u1:completed",
        heldCompletion: null,
      });
    });
  });
});
