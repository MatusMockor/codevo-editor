import { describe, expect, it } from "vitest";
import {
  AGENT_SESSION_FOLLOW_UP_GRACE_MS,
  MAX_AGENT_SESSION_BACKGROUNDS,
  NO_AGENT_SESSION_BACKGROUNDS,
  agentSessionAwaitsFollowUp,
  agentSessionBackgroundFor,
  agentSessionReplySince,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
  expireAgentSessionBackgroundReplies,
  nextAgentSessionReplyExpiry,
} from "./agentSessionBackground";
import type { AgentThread } from "./agentThread";
import type { AgentSessionBackgroundTasksEvent } from "./agentThreadSession";

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
const SHELL_ONLY: AgentSessionBackgroundTasksEvent = {
  ...RESUMED,
  total: 1,
  agents: 0,
  tasks: [{ taskId: "b1", taskType: "shell" }],
};

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
    const drained = expireAgentSessionBackgroundReplies(
      applyAgentSessionBackgroundLevel(second, DRAINED, 9_000),
      9_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    );
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
    expect(levels.has("agt-0-0001")).toBe(false);
    expect(levels.has(`agt-${MAX_AGENT_SESSION_BACKGROUNDS}-0001`)).toBe(true);
  });

  it("awaits a follow-up reply while a background agent is live or its reply is expected or being written", () => {
    const withAgent = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      RESUMED,
      1_000,
    );
    const shellOnly = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      { ...RESUMED, total: 1, agents: 0, tasks: [{ taskId: "b1", taskType: "shell" }] },
      1_000,
    );

    expect(agentSessionAwaitsFollowUp(undefined)).toBe(false);
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(shellOnly, thread()))).toBe(false);
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(withAgent, thread()))).toBe(true);
    const replyOnly = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      REPLYING,
      1_000,
    );
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(replyOnly, thread()))).toBe(true);
    const shellWhileReplying = applyAgentSessionBackgroundLevel(
      shellOnly,
      {
        ...RESUMED,
        total: 1,
        agents: 0,
        tasks: [{ taskId: "b1", taskType: "shell" }],
        reply: "inProgress",
      },
      2_000,
    );
    expect(
      agentSessionAwaitsFollowUp(agentSessionBackgroundFor(shellWhileReplying, thread())),
    ).toBe(true);
    const drained = applyAgentSessionBackgroundLevel(withAgent, DRAINED, 2_000);
    expect(agentSessionBackgroundFor(drained, thread())?.reply.kind).toBe("expected");
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(drained, thread()))).toBe(true);
    const lapsed = expireAgentSessionBackgroundReplies(
      drained,
      2_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    );
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(lapsed, thread()))).toBe(false);
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
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(ended, thread()))).toBe(false);
  });

  it("never shows a reply to a later owner generation of the same thread", () => {
    const first = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, REPLYING, 1_000);
    const reopenedOwner = thread({
      owner: { rootKey: "/repo", ownerId: "ws-1-again", repositoryRoot: "/repo" },
    });
    expect(agentSessionBackgroundFor(first, reopenedOwner)).toBeUndefined();
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(first, reopenedOwner))).toBe(false);
    const replaced = applyAgentSessionBackgroundLevel(
      first,
      { ...REPLYING, workspaceId: "ws-1-again" },
      4_000,
    );
    expect(agentSessionBackgroundFor(replaced, reopenedOwner)).toMatchObject({
      sinceEpochMs: 4_000,
      reply: { kind: "inProgress", sinceEpochMs: 4_000 },
    });
    expect(agentSessionBackgroundFor(replaced, thread())).toBeUndefined();
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
    expect(levels.has("agt-0-0001")).toBe(false);
    expect(levels.get(`agt-${MAX_AGENT_SESSION_BACKGROUNDS}-0001`)?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: MAX_AGENT_SESSION_BACKGROUNDS,
    });
  });
});

describe("agent session expected follow-up reply", () => {
  const working = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
  const drained = applyAgentSessionBackgroundLevel(working, DRAINED, 4_000);
  const expected = {
    kind: "expected",
    sinceEpochMs: 4_000,
    untilEpochMs: 4_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
  };
  const replyOf = (levels: typeof working) => agentSessionBackgroundFor(levels, thread())?.reply;

  it("expects the reply from the level that drains the last agent until the reply starts and lands", () => {
    expect(AGENT_SESSION_FOLLOW_UP_GRACE_MS).toBe(5_000);
    expect(agentSessionBackgroundFor(drained, thread())).toEqual({
      ownerId: "ws-1",
      total: 0,
      agents: 0,
      tasks: [],
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map(),
      reply: expected,
    });
    const duplicate = applyAgentSessionBackgroundLevel(drained, DRAINED, 6_000);
    expect(replyOf(duplicate)).toEqual(expected);
    const replying = applyAgentSessionBackgroundLevel(duplicate, REPLYING, 7_000);
    expect(replyOf(replying)).toEqual({ kind: "inProgress", sinceEpochMs: 4_000 });
    const landed = applyAgentSessionBackgroundLevel(replying, DRAINED, 8_000);
    expect(landed.has(THREAD)).toBe(false);
  });

  it("keeps expecting the reply beside other live tasks and keeps those tasks once it lapses", () => {
    const mixed = applyAgentSessionBackgroundLevel(
      NO_AGENT_SESSION_BACKGROUNDS,
      { ...RESUMED, total: 2, tasks: [...RESUMED.tasks, ...SHELL_ONLY.tasks] },
      1_000,
    );
    const agentGone = applyAgentSessionBackgroundLevel(mixed, SHELL_ONLY, 4_000);
    expect(agentSessionBackgroundFor(agentGone, thread())).toMatchObject({
      total: 1,
      agents: 0,
      tasks: SHELL_ONLY.tasks,
      reply: expected,
    });
    const repeated = applyAgentSessionBackgroundLevel(agentGone, SHELL_ONLY, 5_000);
    expect(replyOf(repeated)).toEqual(expected);
    const lapsed = expireAgentSessionBackgroundReplies(repeated, expected.untilEpochMs);
    expect(agentSessionBackgroundFor(lapsed, thread())).toEqual({
      ...agentSessionBackgroundFor(repeated, thread()),
      reply: { kind: "none" },
    });
    expect(nextAgentSessionReplyExpiry(lapsed)).toBeNull();
  });

  it("drops the expectation when agents are live again and starts a fresh one at their drain", () => {
    const resumed = applyAgentSessionBackgroundLevel(drained, RESUMED, 5_000);
    expect(replyOf(resumed)).toEqual({ kind: "none" });
    expect(nextAgentSessionReplyExpiry(resumed)).toBeNull();
    const drainedAgain = applyAgentSessionBackgroundLevel(resumed, DRAINED, 6_000);
    expect(replyOf(drainedAgain)).toEqual({
      kind: "expected",
      sinceEpochMs: 6_000,
      untilEpochMs: 6_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    });
  });

  it("expects no reply where no agent drained", () => {
    expect(applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, DRAINED, 1_000)).toBe(
      NO_AGENT_SESSION_BACKGROUNDS,
    );
    const shell = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, SHELL_ONLY, 1_000);
    expect(replyOf(shell)).toEqual({ kind: "none" });
    expect(applyAgentSessionBackgroundLevel(shell, DRAINED, 2_000).has(THREAD)).toBe(false);
    const replying = applyAgentSessionBackgroundLevel(shell, REPLYING, 2_000);
    expect(applyAgentSessionBackgroundLevel(replying, DRAINED, 3_000).has(THREAD)).toBe(false);
    expect(replyOf(applyAgentSessionBackgroundLevel(replying, SHELL_ONLY, 3_000))).toEqual({
      kind: "none",
    });
  });

  it("expects another reply when the last agent drains in the level that ends a reply", () => {
    const replyingBesideAgent = applyAgentSessionBackgroundLevel(
      working,
      { ...RESUMED, reply: "inProgress" },
      2_000,
    );
    const both = applyAgentSessionBackgroundLevel(replyingBesideAgent, DRAINED, 3_000);
    expect(replyOf(both)).toEqual({
      kind: "expected",
      sinceEpochMs: 3_000,
      untilEpochMs: 3_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    });
  });

  it("never lets another owner cancel, inherit or see an expectation", () => {
    const next = { ...DRAINED, workspaceId: "ws-1-again" };
    const reopenedOwner = thread({
      owner: { rootKey: "/repo", ownerId: "ws-1-again", repositoryRoot: "/repo" },
    });
    expect(applyAgentSessionBackgroundLevel(working, next, 4_000)).toBe(working);
    expect(applyAgentSessionBackgroundLevel(drained, next, 5_000)).toBe(drained);
    expect(agentSessionBackgroundFor(drained, reopenedOwner)).toBeUndefined();
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(drained, reopenedOwner))).toBe(
      false,
    );
    const replaced = applyAgentSessionBackgroundLevel(
      drained,
      { ...next, reply: "inProgress" },
      6_000,
    );
    expect(agentSessionBackgroundFor(replaced, reopenedOwner)).toMatchObject({
      sinceEpochMs: 6_000,
      reply: { kind: "inProgress", sinceEpochMs: 6_000 },
    });
    const otherShell = applyAgentSessionBackgroundLevel(
      drained,
      { ...SHELL_ONLY, workspaceId: "ws-1-again" },
      6_000,
    );
    expect(agentSessionBackgroundFor(otherShell, reopenedOwner)?.reply).toEqual({ kind: "none" });
  });

  it("lapses at exactly its deadline and leaves everything else by reference", () => {
    expect(nextAgentSessionReplyExpiry(NO_AGENT_SESSION_BACKGROUNDS)).toBeNull();
    expect(expireAgentSessionBackgroundReplies(NO_AGENT_SESSION_BACKGROUNDS, 1)).toBe(
      NO_AGENT_SESSION_BACKGROUNDS,
    );
    expect(nextAgentSessionReplyExpiry(working)).toBeNull();
    expect(nextAgentSessionReplyExpiry(drained)).toBe(expected.untilEpochMs);
    expect(expireAgentSessionBackgroundReplies(drained, expected.untilEpochMs - 1)).toBe(drained);
    expect(expireAgentSessionBackgroundReplies(drained, expected.untilEpochMs).size).toBe(0);
    expect(
      replyOf(applyAgentSessionBackgroundLevel(drained, DRAINED, expected.untilEpochMs - 1)),
    ).toEqual(expected);
    expect(
      applyAgentSessionBackgroundLevel(drained, DRAINED, expected.untilEpochMs).has(THREAD),
    ).toBe(false);

    const replying = applyAgentSessionBackgroundLevel(drained, REPLYING, 5_000);
    expect(nextAgentSessionReplyExpiry(replying)).toBeNull();
    expect(expireAgentSessionBackgroundReplies(replying, Number.MAX_SAFE_INTEGER)).toBe(replying);

    const other = "agt-other-0001";
    const two = applyAgentSessionBackgroundLevel(
      applyAgentSessionBackgroundLevel(drained, { ...RESUMED, threadId: other }, 1_000),
      { ...DRAINED, threadId: other },
      2_000,
    );
    expect(nextAgentSessionReplyExpiry(two)).toBe(2_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    const first = expireAgentSessionBackgroundReplies(
      two,
      2_000 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    );
    expect(first.has(other)).toBe(false);
    expect(first.get(THREAD)).toBe(two.get(THREAD));
    expect(nextAgentSessionReplyExpiry(first)).toBe(expected.untilEpochMs);
  });

  it("clears an expectation when the exact owner's session ends", () => {
    const foreign = endAgentSessionBackground(drained, {
      workspaceId: "ws-2",
      threadId: THREAD,
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(foreign).toBe(drained);
    const ended = endAgentSessionBackground(drained, {
      workspaceId: "ws-1",
      threadId: THREAD,
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(ended.size).toBe(0);
    expect(nextAgentSessionReplyExpiry(ended)).toBeNull();
    expect(agentSessionAwaitsFollowUp(agentSessionBackgroundFor(ended, thread()))).toBe(false);
  });

  it("keeps expected-only levels inside the same bound and evicts the oldest", () => {
    let levels = NO_AGENT_SESSION_BACKGROUNDS;
    for (let index = 0; index <= MAX_AGENT_SESSION_BACKGROUNDS; index += 1) {
      const threadId = `agt-${index}-0001`;
      levels = applyAgentSessionBackgroundLevel(levels, { ...RESUMED, threadId }, index);
      levels = applyAgentSessionBackgroundLevel(levels, { ...DRAINED, threadId }, index);
    }
    expect(levels.size).toBe(MAX_AGENT_SESSION_BACKGROUNDS);
    expect(levels.has("agt-0-0001")).toBe(false);
    expect([...levels.values()].every((level) => level.reply.kind === "expected")).toBe(true);
    expect(nextAgentSessionReplyExpiry(levels)).toBe(1 + AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    expect(
      expireAgentSessionBackgroundReplies(
        levels,
        MAX_AGENT_SESSION_BACKGROUNDS + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
      ).size,
    ).toBe(0);
  });

  it("times an expected and an in-progress reply from the same start", () => {
    expect(agentSessionReplySince({ kind: "none" })).toBeNull();
    expect(agentSessionReplySince({ kind: "inProgress", sinceEpochMs: 7 })).toBe(7);
    expect(agentSessionReplySince({ kind: "expected", sinceEpochMs: 7, untilEpochMs: 9 })).toBe(7);
  });
});
