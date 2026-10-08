import { describe, expect, it } from "vitest";
import {
  AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
  MAX_AGENT_SESSION_BACKGROUNDS,
  NO_AGENT_SESSION_BACKGROUNDS,
  agentOwnerHasLiveSessionBackground,
  agentSessionBackgroundFor,
  agentSessionBackgroundActivity,
  agentSessionBackgroundIsLive,
  agentSessionBackgroundKey,
  agentSessionBackgroundOf,
  agentSessionReplySince,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
  expireAgentSessionBackgroundReplies,
  forgetAgentSessionBackground,
  nextAgentSessionReplyExpiry,
  recoverAgentSessionBackgrounds,
  type AgentSessionBackground,
  type AgentSessionBackgrounds,
} from "./agentSessionBackground";
import type { AgentThread } from "./agentThread";
import {
  MAX_AGENT_SESSION_BACKGROUND_LEVELS,
  type AgentSessionBackgroundTasksEvent,
} from "./agentThreadSession";

const THREAD = "agt-mue1wenj-7ede";
const RESUMED: AgentSessionBackgroundTasksEvent = {
  workspaceId: "ws-1",
  threadId: THREAD,
  total: 1,
  agents: 1,
  tasks: [
    {
      taskId: "a4b355dcf6056a875",
      taskType: "agent",
      description: "Live Codex model catalog like Claude",
    },
  ],
  reply: "none",
};
const DRAINED: AgentSessionBackgroundTasksEvent = { ...RESUMED, total: 0, agents: 0, tasks: [] };
const REPLYING: AgentSessionBackgroundTasksEvent = { ...DRAINED, reply: "inProgress" };
const EXPECTING: AgentSessionBackgroundTasksEvent = { ...DRAINED, reply: "expected" };
const SHELL_ONLY: AgentSessionBackgroundTasksEvent = {
  ...RESUMED,
  total: 1,
  agents: 0,
  tasks: [{ taskId: "b1", taskType: "shell" }],
};

function entryOf(levels: AgentSessionBackgrounds, threadId = THREAD, ownerId = "ws-1") {
  return agentSessionBackgroundOf(levels, ownerId, threadId);
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD,
    owner: { rootKey: "/repo", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Codex model catalog",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_790_716_525_713,
    updatedAtEpochMs: 1_790_716_525_713,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

describe("agent session background levels", () => {
  it("tracks a resumed agent from its first live level until its drain is no longer awaited", () => {
    const live = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
    expect(agentSessionBackgroundFor(live, thread())).toEqual({
      ownerId: "ws-1",
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map([["a4b355dcf6056a875", 1_000]]),
      reply: { kind: "none" },
    });
    const second = applyAgentSessionBackgroundLevel(
      live,
      { ...RESUMED, total: 2, tasks: [...RESUMED.tasks, { taskId: "b1", taskType: "shell" }] },
      5_000,
    );
    expect(agentSessionBackgroundFor(second, thread())?.sinceEpochMs).toBe(1_000);
    expect(agentSessionBackgroundFor(second, thread())?.total).toBe(2);
    expect(agentSessionBackgroundFor(second, thread())?.taskSinceEpochMs).toEqual(
      new Map([
        ["a4b355dcf6056a875", 1_000],
        ["b1", 5_000],
      ]),
    );
    const shellOnly = applyAgentSessionBackgroundLevel(
      second,
      { ...RESUMED, total: 1, agents: 0, tasks: [{ taskId: "b1", taskType: "shell" }] },
      7_000,
    );
    expect(agentSessionBackgroundFor(shellOnly, thread())?.taskSinceEpochMs).toEqual(
      new Map([["b1", 5_000]]),
    );
    const drained = applyAgentSessionBackgroundLevel(second, DRAINED, 9_000);
    expect(agentSessionBackgroundFor(drained, thread())).toBeUndefined();
    const again = applyAgentSessionBackgroundLevel(drained, RESUMED, 20_000);
    expect(agentSessionBackgroundFor(again, thread())?.sinceEpochMs).toBe(20_000);
    expect(agentSessionBackgroundFor(again, thread())?.taskSinceEpochMs).toEqual(
      new Map([["a4b355dcf6056a875", 20_000]]),
    );
  });

  it("clears the level when the exact owner's session ends and ignores foreign owners", () => {
    const live = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
    const foreignEnd = endAgentSessionBackground(live, {
      workspaceId: "ws-2",
      threadId: THREAD,
      reason: "stopped",
      backgroundTasksLive: true,
    });
    expect(foreignEnd).toBe(live);
    const foreignDrain = applyAgentSessionBackgroundLevel(
      live,
      { ...DRAINED, workspaceId: "ws-2" },
      2_000,
    );
    expect(agentSessionBackgroundFor(foreignDrain, thread())).toBeDefined();
    const ended = endAgentSessionBackground(live, {
      workspaceId: "ws-1",
      threadId: THREAD,
      reason: "idleTimeout",
      backgroundTasksLive: true,
    });
    expect(agentSessionBackgroundFor(ended, thread())).toBeUndefined();
  });

  it("never attributes a level to another owner, provider or thread", () => {
    const live = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
    expect(
      agentSessionBackgroundFor(
        live,
        thread({ owner: { rootKey: "/repo", ownerId: "ws-2", repositoryRoot: "/repo" } }),
      ),
    ).toBeUndefined();
    expect(
      agentSessionBackgroundFor(live, thread({ provider: { kind: "codex", sessionId: null } })),
    ).toBeUndefined();
    expect(agentSessionBackgroundFor(live, thread({ threadId: "agt-other-0001" }))).toBeUndefined();
  });

  it("keeps a bounded number of thread levels and evicts the oldest", () => {
    let levels = NO_AGENT_SESSION_BACKGROUNDS;
    for (let index = 0; index <= MAX_AGENT_SESSION_BACKGROUNDS; index += 1) {
      levels = applyAgentSessionBackgroundLevel(
        levels,
        { ...RESUMED, threadId: `agt-${index}-0001` },
        index,
      );
    }
    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(entryOf(levels, "agt-0-0001")).toBeUndefined();
    expect(entryOf(levels, `agt-${MAX_AGENT_SESSION_BACKGROUNDS}-0001`)).toBeDefined();
  });

  it("is live while any task of the session runs or a reply is expected or being written", () => {
    const liveAfter = (...events: ReadonlyArray<AgentSessionBackgroundTasksEvent>) =>
      agentSessionBackgroundIsLive(
        agentSessionBackgroundFor(
          events.reduce(
            (levels, event, index) =>
              applyAgentSessionBackgroundLevel(levels, event, 1_000 * (index + 1)),
            NO_AGENT_SESSION_BACKGROUNDS,
          ),
          thread(),
        ),
      );
    const only = (taskType: "shell" | "monitor" | "other"): AgentSessionBackgroundTasksEvent => ({
      ...SHELL_ONLY,
      tasks: [{ taskId: "b1", taskType }],
    });

    expect(agentSessionBackgroundIsLive(undefined)).toBe(false);
    expect(liveAfter(RESUMED)).toBe(true);
    expect(liveAfter(only("shell"))).toBe(true);
    expect(liveAfter(only("monitor"))).toBe(true);
    expect(liveAfter(only("other"))).toBe(true);
    expect(liveAfter({ ...SHELL_ONLY, total: 40, tasks: [] })).toBe(true);
    expect(liveAfter(REPLYING)).toBe(true);
    expect(liveAfter(EXPECTING)).toBe(true);
    expect(liveAfter(SHELL_ONLY, { ...SHELL_ONLY, reply: "inProgress" })).toBe(true);
    expect(liveAfter(RESUMED, EXPECTING)).toBe(true);
    expect(liveAfter(SHELL_ONLY, EXPECTING)).toBe(true);
    expect(liveAfter(RESUMED, DRAINED)).toBe(false);
    expect(liveAfter(SHELL_ONLY, DRAINED)).toBe(false);
    expect(liveAfter(REPLYING, DRAINED)).toBe(false);
    expect(liveAfter(EXPECTING, DRAINED)).toBe(false);
    expect(liveAfter(DRAINED)).toBe(false);

    const expecting = applyAgentSessionBackgroundLevel(
      applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, SHELL_ONLY, 1_000),
      EXPECTING,
      2_000,
    );
    const lapsed = expireAgentSessionBackgroundReplies(
      expecting,
      2_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    );
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(lapsed, thread()))).toBe(false);
  });

  it("classifies a level once as idle, monitoring or working", () => {
    const level: AgentSessionBackground = {
      ownerId: "ws-1",
      total: 1,
      agents: 0,
      tasks: [{ taskId: "m1", taskType: "monitor" }],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map(),
      reply: { kind: "none" },
    };
    const second = { taskId: "m2", taskType: "monitor" } as const;

    expect(agentSessionBackgroundActivity(undefined)).toBe("idle");
    expect(agentSessionBackgroundActivity({ ...level, total: 0, tasks: [] })).toBe("idle");
    expect(agentSessionBackgroundActivity(level)).toBe("monitoring");
    expect(
      agentSessionBackgroundActivity({ ...level, total: 2, tasks: [...level.tasks, second] }),
    ).toBe("monitoring");
    expect(agentSessionBackgroundActivity({ ...level, total: 2 })).toBe("working");
    expect(agentSessionBackgroundActivity({ ...level, agents: 1 })).toBe("working");
    expect(
      agentSessionBackgroundActivity({ ...level, reply: { kind: "inProgress", sinceEpochMs: 1 } }),
    ).toBe("working");
    expect(
      agentSessionBackgroundActivity({
        ...level,
        reply: { kind: "expected", sinceEpochMs: 1, untilEpochMs: 2 },
      }),
    ).toBe("working");
    for (const taskType of ["shell", "agent", "other"] as const) {
      expect(
        agentSessionBackgroundActivity({ ...level, tasks: [{ taskId: "t1", taskType }] }),
      ).toBe("working");
      expect(
        agentSessionBackgroundActivity({
          ...level,
          total: 2,
          tasks: [...level.tasks, { taskId: "t1", taskType }],
        }),
      ).toBe("working");
    }
  });

  it("is not live for a level that lists no task, no agent and no reply", () => {
    const idle = {
      ownerId: "ws-1",
      total: 0,
      agents: 0,
      tasks: [],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map<string, number>(),
      reply: { kind: "none" },
    } as const;

    expect(agentSessionBackgroundIsLive(idle)).toBe(false);
    expect(agentSessionBackgroundIsLive({ ...idle, total: 1 })).toBe(true);
    expect(agentSessionBackgroundIsLive({ ...idle, agents: 1 })).toBe(true);
    expect(
      agentSessionBackgroundIsLive({ ...idle, reply: { kind: "inProgress", sinceEpochMs: 1 } }),
    ).toBe(true);
    expect(
      agentSessionBackgroundIsLive({
        ...idle,
        reply: { kind: "expected", sinceEpochMs: 1, untilEpochMs: 2 },
      }),
    ).toBe(true);
  });
});

describe("agent session follow-up reply level", () => {
  it("keeps a session live for a reply with no tasks until the level says none", () => {
    const replying = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      REPLYING,
      1_000,
    );
    expect(agentSessionBackgroundFor(replying, thread())).toEqual({
      ownerId: "ws-1",
      total: 0,
      agents: 0,
      tasks: [],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map(),
      reply: { kind: "inProgress", sinceEpochMs: 1_000 },
    });
    const landed = applyAgentSessionBackgroundLevel(replying, DRAINED, 2_000);
    expect(agentSessionBackgroundFor(landed, thread())).toBeUndefined();
    expect(landed.size).toBe(0);
    expect(applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, DRAINED, 3_000)).toBe(
      NO_AGENT_SESSION_BACKGROUNDS,
    );
  });

  it("keeps the entry when the last task drains into the reply and times the reply from its own start", () => {
    const working = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
    const replying = applyAgentSessionBackgroundLevel(working, REPLYING, 5_000);
    expect(agentSessionBackgroundFor(replying, thread())).toEqual({
      ownerId: "ws-1",
      total: 0,
      agents: 0,
      tasks: [],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map(),
      reply: { kind: "inProgress", sinceEpochMs: 5_000 },
    });
    const repeated = applyAgentSessionBackgroundLevel(replying, REPLYING, 7_000);
    expect(agentSessionBackgroundFor(repeated, thread())?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: 5_000,
    });
    const paused = applyAgentSessionBackgroundLevel(repeated, RESUMED, 8_000);
    expect(agentSessionBackgroundFor(paused, thread())?.reply).toEqual({ kind: "none" });
    const again = applyAgentSessionBackgroundLevel(
      paused,
      { ...RESUMED, reply: "inProgress" },
      9_000,
    );
    expect(agentSessionBackgroundFor(again, thread())?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: 9_000,
    });
    expect(agentSessionBackgroundFor(again, thread())?.sinceEpochMs).toBe(1_000);
  });

  it("keeps the live tasks when a reply written beside them ends", () => {
    const both = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      { ...RESUMED, reply: "inProgress" },
      1_000,
    );
    const byLevel = applyAgentSessionBackgroundLevel(both, RESUMED, 2_000);
    expect(agentSessionBackgroundFor(byLevel, thread())).toMatchObject({
      total: 1,
      tasks: RESUMED.tasks,
      reply: { kind: "none" },
    });
  });

  it("clears a reply when the exact owner's session ends mid-reply and ignores a foreign end or level", () => {
    const replying = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      REPLYING,
      1_000,
    );
    expect(
      endAgentSessionBackground(replying, {
        workspaceId: "ws-2",
        threadId: THREAD,
        reason: "crashed",
        backgroundTasksLive: false,
      }),
    ).toBe(replying);
    expect(
      applyAgentSessionBackgroundLevel(replying, { ...DRAINED, workspaceId: "ws-2" }, 2_000),
    ).toBe(replying);
    const ended = endAgentSessionBackground(replying, {
      workspaceId: "ws-1",
      threadId: THREAD,
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(agentSessionBackgroundFor(ended, thread())).toBeUndefined();
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(ended, thread()))).toBe(false);
  });

  it("never shows a reply to a later owner generation of the same thread", () => {
    const first = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, REPLYING, 1_000);
    const reopenedOwner = thread({
      owner: { rootKey: "/repo", ownerId: "ws-1-again", repositoryRoot: "/repo" },
    });
    expect(agentSessionBackgroundFor(first, reopenedOwner)).toBeUndefined();
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(first, reopenedOwner))).toBe(
      false,
    );
    const replaced = applyAgentSessionBackgroundLevel(
      first,
      { ...REPLYING, workspaceId: "ws-1-again" },
      4_000,
    );
    expect(agentSessionBackgroundFor(replaced, reopenedOwner)).toMatchObject({
      sinceEpochMs: 4_000,
      reply: { kind: "inProgress", sinceEpochMs: 4_000 },
    });
    expect(agentSessionBackgroundFor(replaced, thread())).toBe(
      agentSessionBackgroundFor(first, thread()),
    );
  });

  it("keeps reply-only levels inside the same bound and evicts the oldest", () => {
    let levels = NO_AGENT_SESSION_BACKGROUNDS;
    for (let index = 0; index <= MAX_AGENT_SESSION_BACKGROUNDS; index += 1) {
      levels = applyAgentSessionBackgroundLevel(
        levels,
        { ...REPLYING, threadId: `agt-${index}-0001` },
        index,
      );
    }
    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(entryOf(levels, "agt-0-0001")).toBeUndefined();
    expect(entryOf(levels, `agt-${MAX_AGENT_SESSION_BACKGROUNDS}-0001`)?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: MAX_AGENT_SESSION_BACKGROUNDS,
    });
  });
});

describe("agent session expected follow-up reply", () => {
  const working = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
  const expecting = applyAgentSessionBackgroundLevel(working, EXPECTING, 4_000);
  const expected = {
    kind: "expected",
    sinceEpochMs: 4_000,
    untilEpochMs: 4_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
  };
  const replyOf = (levels: typeof working) => agentSessionBackgroundFor(levels, thread())?.reply;

  it("expects the reply the session reports as pending until that reply starts and lands", () => {
    expect(AGENT_SESSION_REPLY_EXPECTED_CAP_MS).toBe(30_000);
    expect(agentSessionBackgroundFor(expecting, thread())).toEqual({
      ownerId: "ws-1",
      total: 0,
      agents: 0,
      tasks: [],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map(),
      reply: expected,
    });
    const repeated = applyAgentSessionBackgroundLevel(expecting, EXPECTING, 6_000);
    expect(replyOf(repeated)).toEqual(expected);
    const replying = applyAgentSessionBackgroundLevel(repeated, REPLYING, 7_000);
    expect(replyOf(replying)).toEqual({ kind: "inProgress", sinceEpochMs: 4_000 });
    const landed = applyAgentSessionBackgroundLevel(replying, DRAINED, 8_000);
    expect(entryOf(landed)).toBeUndefined();
  });

  it.each(["agent", "shell", "monitor", "other"] as const)(
    "releases at once when the last %s task ends and the session expects no reply",
    (taskType) => {
      const live: AgentSessionBackgroundTasksEvent = {
        ...SHELL_ONLY,
        agents: taskType === "agent" ? 1 : 0,
        tasks: [{ taskId: "b1", taskType }],
      };
      const running = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, live, 1_000);
      const stopped = applyAgentSessionBackgroundLevel(running, DRAINED, 4_000);
      expect(entryOf(stopped)).toBeUndefined();
      expect(nextAgentSessionReplyExpiry(stopped)).toBeNull();
    },
  );

  it("expects the reply beside other live tasks and keeps those tasks once it lapses or is withdrawn", () => {
    const beside = applyAgentSessionBackgroundLevel(
      applyAgentSessionBackgroundLevel(
        NO_AGENT_SESSION_BACKGROUNDS,
        { ...RESUMED, total: 2, tasks: [...RESUMED.tasks, ...SHELL_ONLY.tasks] },
        1_000,
      ),
      { ...SHELL_ONLY, reply: "expected" },
      4_000,
    );
    expect(agentSessionBackgroundFor(beside, thread())).toMatchObject({
      total: 1,
      agents: 0,
      tasks: SHELL_ONLY.tasks,
      reply: expected,
    });
    const lapsed = expireAgentSessionBackgroundReplies(beside, expected.untilEpochMs);
    expect(agentSessionBackgroundFor(lapsed, thread())).toEqual({
      ...agentSessionBackgroundFor(beside, thread()),
      reply: { kind: "none" },
    });
    expect(nextAgentSessionReplyExpiry(lapsed)).toBeNull();
    const withdrawn = applyAgentSessionBackgroundLevel(beside, SHELL_ONLY, 5_000);
    expect(replyOf(withdrawn)).toEqual({ kind: "none" });
    expect(agentSessionBackgroundFor(withdrawn, thread())?.tasks).toEqual(SHELL_ONLY.tasks);
  });

  it("starts a fresh expectation only after the session withdrew or answered the earlier one", () => {
    const withdrawn = applyAgentSessionBackgroundLevel(expecting, RESUMED, 5_000);
    expect(replyOf(withdrawn)).toEqual({ kind: "none" });
    expect(nextAgentSessionReplyExpiry(withdrawn)).toBeNull();
    const again = applyAgentSessionBackgroundLevel(withdrawn, EXPECTING, 6_000);
    expect(replyOf(again)).toEqual({
      kind: "expected",
      sinceEpochMs: 6_000,
      untilEpochMs: 6_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    });
    const answered = applyAgentSessionBackgroundLevel(
      applyAgentSessionBackgroundLevel(expecting, REPLYING, 5_000),
      EXPECTING,
      9_000,
    );
    expect(replyOf(answered)).toEqual({
      kind: "expected",
      sinceEpochMs: 9_000,
      untilEpochMs: 9_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    });
  });

  it("expects no reply the session did not report", () => {
    expect(applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, DRAINED, 1_000)).toBe(
      NO_AGENT_SESSION_BACKGROUNDS,
    );
    const shell = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, SHELL_ONLY, 1_000);
    expect(replyOf(shell)).toEqual({ kind: "none" });
    expect(replyOf(applyAgentSessionBackgroundLevel(shell, SHELL_ONLY, 2_000))).toEqual({
      kind: "none",
    });
    const replying = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      REPLYING,
      2_000,
    );
    expect(entryOf(applyAgentSessionBackgroundLevel(replying, DRAINED, 3_000))).toBeUndefined();
    expect(replyOf(applyAgentSessionBackgroundLevel(replying, SHELL_ONLY, 3_000))).toEqual({
      kind: "none",
    });
    const fromNothing = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      EXPECTING,
      3_000,
    );
    expect(replyOf(fromNothing)).toEqual({
      kind: "expected",
      sinceEpochMs: 3_000,
      untilEpochMs: 3_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    });
  });

  it("never lets another owner cancel, inherit or see an expectation", () => {
    const next = { ...DRAINED, workspaceId: "ws-1-again" };
    const reopenedOwner = thread({
      owner: { rootKey: "/repo", ownerId: "ws-1-again", repositoryRoot: "/repo" },
    });
    expect(applyAgentSessionBackgroundLevel(working, next, 4_000)).toBe(working);
    expect(applyAgentSessionBackgroundLevel(expecting, next, 5_000)).toBe(expecting);
    expect(agentSessionBackgroundFor(expecting, reopenedOwner)).toBeUndefined();
    const replaced = applyAgentSessionBackgroundLevel(
      expecting,
      { ...next, reply: "inProgress" },
      6_000,
    );
    expect(agentSessionBackgroundFor(replaced, reopenedOwner)).toMatchObject({
      sinceEpochMs: 6_000,
      reply: { kind: "inProgress", sinceEpochMs: 6_000 },
    });
    expect(replyOf(replaced)).toEqual(expected);
    const otherExpecting = applyAgentSessionBackgroundLevel(
      expecting,
      { ...next, reply: "expected" },
      6_000,
    );
    expect(agentSessionBackgroundFor(otherExpecting, reopenedOwner)?.reply).toEqual({
      kind: "expected",
      sinceEpochMs: 6_000,
      untilEpochMs: 6_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    });
    expect(replyOf(otherExpecting)).toEqual(expected);
  });

  it("lapses at exactly its deadline and leaves everything else by reference", () => {
    expect(nextAgentSessionReplyExpiry(NO_AGENT_SESSION_BACKGROUNDS)).toBeNull();
    expect(expireAgentSessionBackgroundReplies(NO_AGENT_SESSION_BACKGROUNDS, 1)).toBe(
      NO_AGENT_SESSION_BACKGROUNDS,
    );
    expect(nextAgentSessionReplyExpiry(working)).toBeNull();
    expect(nextAgentSessionReplyExpiry(expecting)).toBe(expected.untilEpochMs);
    expect(expireAgentSessionBackgroundReplies(expecting, expected.untilEpochMs - 1)).toBe(
      expecting,
    );
    expect(expireAgentSessionBackgroundReplies(expecting, expected.untilEpochMs).size).toBe(0);

    const replying = applyAgentSessionBackgroundLevel(expecting, REPLYING, 5_000);
    expect(nextAgentSessionReplyExpiry(replying)).toBeNull();
    expect(expireAgentSessionBackgroundReplies(replying, Number.MAX_SAFE_INTEGER)).toBe(replying);

    const other = "agt-other-0001";
    const two = applyAgentSessionBackgroundLevel(
      expecting,
      { ...EXPECTING, threadId: other },
      2_000,
    );
    expect(nextAgentSessionReplyExpiry(two)).toBe(2_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    const first = expireAgentSessionBackgroundReplies(
      two,
      2_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    );
    expect(entryOf(first, other)).toBeUndefined();
    expect(entryOf(first)).toBeDefined();
    expect(entryOf(first)).toBe(entryOf(two));
    expect(nextAgentSessionReplyExpiry(first)).toBe(expected.untilEpochMs);
  });

  it("clears an expectation when the exact owner's session ends", () => {
    const foreign = endAgentSessionBackground(expecting, {
      workspaceId: "ws-2",
      threadId: THREAD,
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(foreign).toBe(expecting);
    const ended = endAgentSessionBackground(expecting, {
      workspaceId: "ws-1",
      threadId: THREAD,
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(ended.size).toBe(0);
    expect(nextAgentSessionReplyExpiry(ended)).toBeNull();
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(ended, thread()))).toBe(false);
  });

  it("keeps expected-only levels inside the same bound and evicts the oldest", () => {
    let levels = NO_AGENT_SESSION_BACKGROUNDS;
    for (let index = 0; index <= MAX_AGENT_SESSION_BACKGROUNDS; index += 1) {
      levels = applyAgentSessionBackgroundLevel(
        levels,
        { ...EXPECTING, threadId: `agt-${index}-0001` },
        index,
      );
    }
    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(entryOf(levels, "agt-0-0001")).toBeUndefined();
    expect([...levels.values()].every((level) => level.reply.kind === "expected")).toBe(true);
    expect(nextAgentSessionReplyExpiry(levels)).toBe(1 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    expect(
      expireAgentSessionBackgroundReplies(
        levels,
        MAX_AGENT_SESSION_BACKGROUNDS + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
      ).size,
    ).toBe(0);
  });

  it("times an expected and an in-progress reply from the same start", () => {
    expect(agentSessionReplySince({ kind: "none" })).toBeNull();
    expect(agentSessionReplySince({ kind: "inProgress", sinceEpochMs: 7 })).toBe(7);
    expect(agentSessionReplySince({ kind: "expected", sinceEpochMs: 7, untilEpochMs: 9 })).toBe(7);
  });
});

describe("recovering session levels after the frontend reloaded", () => {
  const key = (workspaceId: string, threadId = THREAD) =>
    agentSessionBackgroundKey({ workspaceId, threadId });

  it("adopts every recovered level under its exact owner and thread", () => {
    const recovered = recoverAgentSessionBackgrounds(
      NO_AGENT_SESSION_BACKGROUNDS,
      [SHELL_ONLY, { ...RESUMED, workspaceId: "ws-2" }, { ...EXPECTING, threadId: "agt-x-0001" }],
      new Set(),
      9_000,
    );
    expect(recovered.size).toBe(3);
    expect(entryOf(recovered)).toMatchObject({ ownerId: "ws-1", total: 1, sinceEpochMs: 9_000 });
    expect(entryOf(recovered, THREAD, "ws-2")).toMatchObject({ ownerId: "ws-2", agents: 1 });
    expect(entryOf(recovered, "agt-x-0001")?.reply).toEqual({
      kind: "expected",
      sinceEpochMs: 9_000,
      untilEpochMs: 9_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    });
  });

  it("never overwrites a session that reported or ended while the recovery was in flight", () => {
    const live = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 5_000);
    const reported = recoverAgentSessionBackgrounds(
      live,
      [SHELL_ONLY],
      new Set([key("ws-1")]),
      9_000,
    );
    expect(reported).toBe(live);
    const drainedMeanwhile = recoverAgentSessionBackgrounds(
      NO_AGENT_SESSION_BACKGROUNDS,
      [SHELL_ONLY, { ...SHELL_ONLY, workspaceId: "ws-2" }],
      new Set([key("ws-1")]),
      9_000,
    );
    expect(entryOf(drainedMeanwhile)).toBeUndefined();
    expect(entryOf(drainedMeanwhile, THREAD, "ws-2")).toMatchObject({ total: 1 });
  });

  it("drops a level the listing no longer has unless its session reported during the recovery", () => {
    const early = applyAgentSessionBackgroundLevel(
      applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, SHELL_ONLY, 1_000),
      { ...RESUMED, workspaceId: "ws-2" },
      2_000,
    );
    const dead = recoverAgentSessionBackgrounds(early, [], new Set(), 9_000);
    expect(dead.size).toBe(0);

    const oneReported = recoverAgentSessionBackgrounds(early, [], new Set([key("ws-2")]), 9_000);
    expect(entryOf(oneReported)).toBeUndefined();
    expect(entryOf(oneReported, THREAD, "ws-2")).toBe(entryOf(early, THREAD, "ws-2"));

    const stillListed = recoverAgentSessionBackgrounds(early, [SHELL_ONLY], new Set(), 9_000);
    expect(entryOf(stillListed)).toMatchObject({ total: 1, sinceEpochMs: 1_000 });
    expect(entryOf(stillListed, THREAD, "ws-2")).toBeUndefined();
    expect(recoverAgentSessionBackgrounds(early, [], new Set([key("ws-1"), key("ws-2")]), 1)).toBe(
      early,
    );
  });

  it("recovers at most as many levels as it retains and ignores an idle one", () => {
    expect(MAX_AGENT_SESSION_BACKGROUND_LEVELS).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    const many = Array.from({ length: MAX_AGENT_SESSION_BACKGROUNDS + 5 }, (_, index) => ({
      ...SHELL_ONLY,
      threadId: `agt-${index}-0001`,
    }));
    const recovered = recoverAgentSessionBackgrounds(
      NO_AGENT_SESSION_BACKGROUNDS,
      many,
      new Set(),
      1,
    );
    expect(recovered.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(entryOf(recovered, `agt-${MAX_AGENT_SESSION_BACKGROUNDS}-0001`)).toBeUndefined();
    expect(
      recoverAgentSessionBackgrounds(NO_AGENT_SESSION_BACKGROUNDS, [DRAINED], new Set(), 1),
    ).toBe(NO_AGENT_SESSION_BACKGROUNDS);
  });
});

describe("agent session background levels of several owners of one thread", () => {
  const FOREIGN = "ws-2";
  const foreign = (event: AgentSessionBackgroundTasksEvent): AgentSessionBackgroundTasksEvent => ({
    ...event,
    workspaceId: FOREIGN,
  });
  const foreignThread = thread({
    owner: { rootKey: "/repo", ownerId: FOREIGN, repositoryRoot: "/repo" },
  });
  const own = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, SHELL_ONLY, 1_000);
  const both = applyAgentSessionBackgroundLevel(own, foreign(RESUMED), 2_000);

  it("keeps an owner's live level when another owner reports live work for the same thread", () => {
    expect(both.size).toBe(2);
    expect(agentSessionBackgroundFor(both, thread())).toBe(
      agentSessionBackgroundFor(own, thread()),
    );
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(both, thread()))).toBe(true);
    expect(agentSessionBackgroundFor(both, foreignThread)).toEqual({
      ownerId: FOREIGN,
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 2_000,
      taskSinceEpochMs: new Map([["a4b355dcf6056a875", 2_000]]),
      reply: { kind: "none" },
    });
    expect(entryOf(both, THREAD, "ws-3")).toBeUndefined();
  });

  it("keeps each owner's clock, tasks and reply apart across later levels", () => {
    const foreignReplying = applyAgentSessionBackgroundLevel(
      both,
      foreign({ ...RESUMED, reply: "inProgress" }),
      3_000,
    );
    expect(entryOf(foreignReplying)).toBe(entryOf(both));
    const ownAgain = applyAgentSessionBackgroundLevel(foreignReplying, SHELL_ONLY, 4_000);
    expect(entryOf(ownAgain)).toMatchObject({
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map([["b1", 1_000]]),
      reply: { kind: "none" },
    });
    expect(entryOf(ownAgain, THREAD, FOREIGN)).toBe(entryOf(foreignReplying, THREAD, FOREIGN));
  });

  it("never lets one owner's drain or lapsed reply touch the other owner's level", () => {
    const foreignDrained = applyAgentSessionBackgroundLevel(both, foreign(EXPECTING), 3_000);
    expect(entryOf(foreignDrained)).toBe(entryOf(both));
    expect(entryOf(foreignDrained, THREAD, FOREIGN)?.reply.kind).toBe("expected");
    const lapsed = expireAgentSessionBackgroundReplies(
      foreignDrained,
      3_000 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    );
    expect(entryOf(lapsed, THREAD, FOREIGN)).toBeUndefined();
    expect(entryOf(lapsed)).toBe(entryOf(both));
    expect(agentSessionBackgroundIsLive(agentSessionBackgroundFor(lapsed, thread()))).toBe(true);
  });

  it("ends exactly the named owner's session and leaves the other owner's level", () => {
    const foreignEnded = endAgentSessionBackground(both, {
      workspaceId: FOREIGN,
      threadId: THREAD,
      reason: "stopped",
      backgroundTasksLive: true,
    });
    expect(entryOf(foreignEnded, THREAD, FOREIGN)).toBeUndefined();
    expect(entryOf(foreignEnded)).toBe(entryOf(both));
    const ownMissing = endAgentSessionBackground(both, { workspaceId: "ws-1", threadId: THREAD });
    expect(entryOf(ownMissing)).toBeUndefined();
    expect(entryOf(ownMissing, THREAD, FOREIGN)).toBe(entryOf(both, THREAD, FOREIGN));
    expect(endAgentSessionBackground(both, { workspaceId: "ws-3", threadId: THREAD })).toBe(both);
    expect(endAgentSessionBackground(both, { workspaceId: "ws-1", threadId: "agt-x-0001" })).toBe(
      both,
    );
  });

  it("starts afresh for an owner that returns after another owner worked on the thread", () => {
    const ownEnded = endAgentSessionBackground(both, { workspaceId: "ws-1", threadId: THREAD });
    expect(agentSessionBackgroundFor(ownEnded, thread())).toBeUndefined();
    const returned = applyAgentSessionBackgroundLevel(ownEnded, SHELL_ONLY, 9_000);
    expect(entryOf(returned)).toMatchObject({
      sinceEpochMs: 9_000,
      taskSinceEpochMs: new Map([["b1", 9_000]]),
    });
    expect(entryOf(returned, THREAD, FOREIGN)).toBe(entryOf(both, THREAD, FOREIGN));
  });

  it("evicts the least recently reported level first across owners of the same thread", () => {
    const ownerOf = (index: number) => `ws-owner-${index}`;
    const report = (levels: AgentSessionBackgrounds, index: number) =>
      applyAgentSessionBackgroundLevel(
        levels,
        { ...SHELL_ONLY, workspaceId: ownerOf(index) },
        index,
      );
    let levels = NO_AGENT_SESSION_BACKGROUNDS;
    for (let index = 0; index < MAX_AGENT_SESSION_BACKGROUNDS; index += 1) {
      levels = report(levels, index);
    }
    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    levels = report(report(levels, 0), MAX_AGENT_SESSION_BACKGROUNDS);

    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(entryOf(levels, THREAD, ownerOf(1))).toBeUndefined();
    expect(entryOf(levels, THREAD, ownerOf(0))?.sinceEpochMs).toBe(0);
    expect(entryOf(levels, THREAD, ownerOf(2))).toBeDefined();
    expect(entryOf(levels, THREAD, ownerOf(MAX_AGENT_SESSION_BACKGROUNDS))).toBeDefined();
  });

  it("tells apart owner and thread ids that only match once joined", () => {
    const joined = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      { ...SHELL_ONLY, workspaceId: 'ws","agt', threadId: "x" },
      1_000,
    );
    expect(entryOf(joined, 'agt","x', "ws")).toBeUndefined();
    expect(entryOf(joined, "x", 'ws","agt')).toBeDefined();
  });

  it("forgets a missing session only while the level observed when it was asked about is still retained", () => {
    const session = { workspaceId: "ws-1", threadId: THREAD };
    const observed = entryOf(both);
    expect(observed).toBeDefined();

    const forgotten = forgetAgentSessionBackground(both, session, observed);
    expect(entryOf(forgotten)).toBeUndefined();
    expect(entryOf(forgotten, THREAD, FOREIGN)).toBe(entryOf(both, THREAD, FOREIGN));

    const repeated = applyAgentSessionBackgroundLevel(both, SHELL_ONLY, 3_000);
    expect(entryOf(repeated)).toEqual(observed);
    expect(entryOf(repeated)).not.toBe(observed);
    expect(forgetAgentSessionBackground(repeated, session, observed)).toBe(repeated);

    const replaced = applyAgentSessionBackgroundLevel(
      endAgentSessionBackground(both, session),
      RESUMED,
      4_000,
    );
    expect(forgetAgentSessionBackground(replaced, session, observed)).toBe(replaced);
    expect(forgetAgentSessionBackground(replaced, session, undefined)).toBe(replaced);
    expect(forgetAgentSessionBackground(both, session, undefined)).toBe(both);
    expect(forgetAgentSessionBackground(both, { ...session, workspaceId: FOREIGN }, observed)).toBe(
      both,
    );
    expect(forgetAgentSessionBackground(forgotten, session, observed)).toBe(forgotten);
  });
});

describe("session-level work that keeps an owner live", () => {
  const MONITORING: AgentSessionBackgroundTasksEvent = {
    ...SHELL_ONLY,
    tasks: [{ taskId: "watch", taskType: "monitor" }],
  };
  const settled = [thread()];

  function liveFor(level: AgentSessionBackgroundTasksEvent, ownerId = "ws-1"): boolean {
    const levels = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, level, 1_000);
    return agentOwnerHasLiveSessionBackground(levels, settled, ownerId);
  }

  it.each([
    ["a live monitor", MONITORING],
    ["a live shell", SHELL_ONLY],
    ["a live agent", RESUMED],
    ["an expected reply", EXPECTING],
    ["a reply in progress", REPLYING],
  ])("counts %s of the owner's settled thread", (_work, level) => {
    expect(liveFor(level)).toBe(true);
  });

  it("counts nothing once the level is idle or when no level is retained", () => {
    expect(liveFor(DRAINED)).toBe(false);
    expect(agentOwnerHasLiveSessionBackground(NO_AGENT_SESSION_BACKGROUNDS, settled, "ws-1")).toBe(
      false,
    );
  });

  it("never counts another owner's level, even for the same thread id", () => {
    expect(liveFor({ ...MONITORING, workspaceId: "ws-2" })).toBe(false);
    expect(liveFor({ ...MONITORING, workspaceId: "ws-2" }, "ws-2")).toBe(false);
    expect(liveFor(MONITORING, "ws-2")).toBe(false);
    expect(liveFor(MONITORING, "ws")).toBe(false);
  });

  it("never counts a level whose thread the owner no longer has", () => {
    const levels = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, MONITORING, 1);
    const others = [thread({ threadId: "agt-other-0001" })];
    const codex = [thread({ provider: { kind: "codex", sessionId: "session-abcdefgh" } })];

    expect(agentOwnerHasLiveSessionBackground(levels, [], "ws-1")).toBe(false);
    expect(agentOwnerHasLiveSessionBackground(levels, others, "ws-1")).toBe(false);
    expect(agentOwnerHasLiveSessionBackground(levels, codex, "ws-1")).toBe(false);
  });
});
