import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
} from "../test/agentThreadRequestFeedFake";
import { agentThreadHasPendingInput } from "./agentThreadPendingInput";
import { AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS } from "./agentThreadRequestStore";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";

const WORKSPACE = "workspace";
const TASK = "task";
const ROOT = "/repo";
const THREAD_SCOPE = { workspaceId: WORKSPACE };

function thread(): AgentThread {
  const view = projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    interactiveQuestionsSupported: true,
    projects: [],
    tasks: [
      {
        id: TASK,
        runnerId: "runner",
        sequence: 1,
        provider: "codex",
        status: "running",
        parts: [{ type: "text", text: "Prompt" }],
        createdAt: "2026-09-16T12:00:00Z",
      },
    ],
    replays: new Map(),
    resumes: new Map(),
  })[0];
  return {
    ...view.thread,
    owner: { rootKey: ROOT, ownerId: WORKSPACE, repositoryRoot: "/repo/nested" },
  };
}

function scopeOf(subject: AgentThread) {
  return { ...THREAD_SCOPE, threadId: subject.threadId };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await vi.advanceTimersByTimeAsync(1);
}

describe("agentThreadHasPendingInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the running turn from the thread request store and reports its pending question", async () => {
    const subject = thread();
    const feed = agentThreadRequestFeedFake();
    feed.record(
      agentThreadRequestsOf(scopeOf(subject), [
        agentRuntimeRequestOf("cancelledByProvider", { turnId: TASK }),
        agentRuntimeRequestOf("pendingQuestion", { turnId: TASK }),
      ]),
    );

    const answer = agentThreadHasPendingInput(feed, subject);
    await settle();

    await expect(answer).resolves.toBe(true);
    expect(feed.currentThreadRequests.mock.calls[0]?.slice(0, 2)).toEqual([
      {
        rootKey: ROOT,
        ownerId: agentRootOwnerId(ROOT),
        threadId: subject.threadId,
        workspaceId: WORKSPACE,
      },
      [TASK],
    ]);
    expect(feed.subscribers()).toBe(0);
  });

  it.each([
    { name: "no records", records: [] },
    {
      name: "only settled questions",
      records: [
        agentRuntimeRequestOf("cancelledByProvider", { turnId: TASK }),
        agentRuntimeRequestOf("resolvedQuestion", { turnId: TASK }),
      ],
    },
    {
      name: "only a pending approval",
      records: [agentRuntimeRequestOf("pendingApproval", { turnId: TASK })],
    },
    {
      name: "a pending question of another turn",
      records: [agentRuntimeRequestOf("pendingQuestion", { turnId: "agt-turn-other" })],
    },
  ])("reports no pending input for $name", async ({ records }) => {
    const subject = thread();
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(scopeOf(subject), records));

    const answer = agentThreadHasPendingInput(feed, subject);
    await settle();

    await expect(answer).resolves.toBe(false);
  });

  it("reports no pending input without a feed", async () => {
    await expect(agentThreadHasPendingInput(undefined, thread())).resolves.toBe(false);
  });

  it("keeps the input when the thread or its running turn is missing", async () => {
    const feed = agentThreadRequestFeedFake();
    await expect(agentThreadHasPendingInput(feed, undefined)).resolves.toBe(true);
    await expect(agentThreadHasPendingInput(feed, { ...thread(), turns: [] })).resolves.toBe(true);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
  });

  it("rejects when the store cannot read the thread's requests", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockRejectedValue(new Error("Agent task is unavailable."));

    const answer = agentThreadHasPendingInput(feed, thread());
    const settled = expect(answer).rejects.toThrow("Pending requests are unavailable.");
    await vi.advanceTimersByTimeAsync(AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS);

    await settled;
  });
});
