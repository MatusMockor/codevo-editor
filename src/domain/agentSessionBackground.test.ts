import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_SESSION_BACKGROUNDS,
  NO_AGENT_SESSION_BACKGROUNDS,
  agentSessionBackgroundFor,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
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
};
const DRAINED: AgentSessionBackgroundTasksEvent = { ...RESUMED, total: 0, agents: 0, tasks: [] };

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
  it("tracks a resumed agent from its first live level until the drained level", () => {
    const live = applyAgentSessionBackgroundLevel(NO_AGENT_SESSION_BACKGROUNDS, RESUMED, 1_000);
    expect(agentSessionBackgroundFor(live, thread())).toEqual({
      ownerId: "ws-1",
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 1_000,
      taskSinceEpochMs: new Map([["a4b355dcf6056a875", 1_000]]),
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
    const again = applyAgentSessionBackgroundLevel(drained, RESUMED, 12_000);
    expect(agentSessionBackgroundFor(again, thread())?.sinceEpochMs).toBe(12_000);
    expect(agentSessionBackgroundFor(again, thread())?.taskSinceEpochMs).toEqual(
      new Map([["a4b355dcf6056a875", 12_000]]),
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
});
