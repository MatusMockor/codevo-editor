import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import {
  RemoteAgentProjection,
  projectRemoteAgentThreads,
  type RemoteAgentProjectionInput,
} from "./remoteAgentProjection";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentTurn } from "../domain/agentThread";
import { RUNTIME_SUBAGENT_LEGACY_BATCH_ID } from "../domain/agentRuntimeSubagent";
import { parseAgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { agentTurnRuntimeSubagents } from "../components/agentMode/agentRuntimeSubagentPresentation";
const root: RemoteRunnerTask = {
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: "First prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
};
const child: RemoteRunnerTask = {
  ...root,
  id: "child",
  sequence: 2,
  conversationId: "root",
  parentTaskId: "root",
  parts: [{ type: "text", text: "Follow-up" }],
};
function input(tasks: readonly RemoteRunnerTask[] = [root, child]): RemoteAgentProjectionInput {
  return {
    serverId: "server",
    runnerId: "runner",
    projects: [{ id: "project", name: "Project" }],
    tasks,
    replays: new Map(),
    resumes: new Map(),
  };
}
describe("remote original thread projection", () => {
  it.each([undefined, "worktree", "in-place"] as const)(
    "projects actual isolation %s",
    (isolation) => {
      const view = projectRemoteAgentThreads(input([{ ...root, isolation }]))[0]!;
      expect(view.thread.target.isolation).toBe(isolation ?? "worktree");
    },
  );
  it("rejects changed task isolation and mixed conversation modes", () => {
    const cache = new RemoteAgentProjection();
    cache.project(input([root]));
    expect(() => cache.project(input([{ ...root, isolation: "in-place" }]))).toThrow("identity");
    expect(() =>
      projectRemoteAgentThreads(input([root, { ...child, isolation: "in-place" }])),
    ).toThrow();
    expect(() =>
      projectRemoteAgentThreads(input([{ ...root, isolation: "worktree" }, child])),
    ).not.toThrow();
  });
  it("reuses all unchanged turns and views across equivalent fresh inventory objects", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(input());
    const second = cache.project(input(structuredClone([root, child])));
    expect(second).toBe(first);
    expect(second[0]!.thread.turns[0]).toBe(first[0]!.thread.turns[0]);
  });
  it("replaces only the changed turn while preserving completed history", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(input());
    const second = cache.project(input([root, { ...child, status: "running" }]));
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.thread.turns[0]).toBe(first[0]!.thread.turns[0]);
    expect(second[0]!.thread.turns[1]).not.toBe(first[0]!.thread.turns[1]);
    expect(second[0]!.thread.turns[1]!.status.kind).toBe("running");
  });
  it("publishes fresh resume availability and attachment metadata without losing history", () => {
    const cache = new RemoteAgentProjection();
    const snapshot = {
      ...input(),
      resumes: new Map([["child", { available: true as const, reason: null }]]),
    };
    const first = cache.project(snapshot);
    const second = cache.project({
      ...snapshot,
      resumes: new Map([["child", { available: false, reason: "session_unavailable" }]]),
    });
    expect(second[0]!.thread).toBe(first[0]!.thread);
    expect(second[0]!.execution?.resume?.available).toBe(false);
    const third = cache.project({
      ...snapshot,
      attachmentsByTask: new Map([
        ["child", [{ kind: "reference", name: "README", path: "/README", bytes: 20 }]],
      ]),
    });
    expect(third[0]!.thread.turns[0]).toBe(first[0]!.thread.turns[0]);
    expect(third[0]!.thread.turns[1]!.attachments).toHaveLength(1);
  });
  it("resets empty completed replay metadata when replay authority disappears", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project({ ...input([root]), replayComplete: new Set(["root"]) });
    expect(first[0]!.thread.turns[0]!.streamMetrics?.complete).toBe(true);
    expect(cache.project(input([root]))[0]!.thread.turns[0]!.streamMetrics?.complete).toBe(false);
  });
  it("updates project display metadata without replacing the history", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(input());
    const second = cache.project({ ...input(), projects: [{ id: "project", name: "Renamed" }] });
    expect(second[0]!.repositoryLabel).toBe("Renamed");
    expect(second[0]!.thread).toBe(first[0]!.thread);
  });
  it("does not reuse removed or different-owner history and isolates speculative views", () => {
    const cache = new RemoteAgentProjection();
    const first = cache.project(input());
    const fork = cache.fork();
    fork.project(input([root, { ...child, status: "running" }]));
    expect(cache.project(input())).toBe(first);
    cache.project(input([]));
    expect(cache.project(input())[0]).not.toBe(first[0]);
    cache.project({ ...input(), serverId: "other" });
    expect(cache.project(input())[0]).not.toBe(first[0]);
  });

  it("forks parser cursors without advancing the committed cache", () => {
    const cache = new RemoteAgentProjection();
    const line =
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }) + "\n";
    const events = [
      {
        taskId: "root",
        sequence: 1,
        type: "task.output" as const,
        channel: "stdout" as const,
        createdAt: root.createdAt,
        text: line.slice(0, 15),
      },
    ];
    const first = { ...input([root]), replays: new Map([["root", events]]) };
    cache.project(first);
    const fork = cache.fork();
    const finished = {
      ...first,
      replays: new Map([
        ["root", [...events, { ...events[0]!, sequence: 2, text: line.slice(15) }]],
      ]),
      replayComplete: new Set(["root"]),
    };
    expect(fork.project(finished)[0]!.thread.turns[0]!.events).toContainEqual({
      kind: "assistantText",
      text: "hello",
    });
    expect(cache.project(first)[0]!.thread.turns[0]!.events).toEqual([]);
    expect(cache.fork().project(finished)[0]!.thread.turns[0]!.events).toContainEqual({
      kind: "assistantText",
      text: "hello",
    });
  });
  it("rejects known foreign parents and cached task identity changes", () => {
    const other = { ...root, id: "other", sequence: 3 };
    expect(() =>
      projectRemoteAgentThreads(input([root, other, { ...child, parentTaskId: "other" }])),
    ).toThrow();
    const cache = new RemoteAgentProjection();
    cache.project(input([root]));
    expect(() => cache.project(input([{ ...root, provider: "codex" }]))).toThrow();
  });
  it("allows a draft to bind its server project once", () => {
    const cache = new RemoteAgentProjection();
    cache.project(input([{ ...root, status: "draft", projectId: undefined }]));
    expect(cache.project(input([root]))[0]!.execution?.projectId).toBe("project");
  });
  it("groups child turns into one original thread and leaves session authority on server", () => {
    const views = projectRemoteAgentThreads(input());
    expect(views).toHaveLength(1);
    const view = views[0]!;
    expect(view.thread.turns.map((turn) => turn.prompt)).toEqual(["First prompt", "Follow-up"]);
    expect(view.thread.provider.sessionId).toBeNull();
    expect(view.thread.target.worktreePath).toBeNull();
    expect(view.execution?.latestTaskId).toBe("child");
    expect(view.lifecycle).toBe("settled");
  });
  it("rejects foreign owners, duplicate tasks, contradictory projects and forks", () => {
    expect(() => projectRemoteAgentThreads(input([{ ...root, runnerId: "other" }]))).toThrow();
    expect(() => projectRemoteAgentThreads(input([root, root]))).toThrow();
    expect(() =>
      projectRemoteAgentThreads(input([root, { ...child, projectId: "other" }])),
    ).toThrow();
    expect(() =>
      projectRemoteAgentThreads(input([root, child, { ...child, id: "fork", sequence: 3 }])),
    ).toThrow();
  });
  it("does not append duplicate output on repeated snapshots and resets across server ownership", () => {
    const cache = new RemoteAgentProjection();
    const snapshot = {
      ...input([root]),
      replays: new Map([
        [
          "root",
          [
            {
              taskId: "root",
              sequence: 2,
              type: "task.output" as const,
              createdAt: root.createdAt,
              channel: "stdout" as const,
              text:
                JSON.stringify({
                  type: "assistant",
                  message: { content: [{ type: "text", text: "hello" }] },
                }) + "\n",
            },
          ],
        ],
      ]),
    };
    const first = cache.project(snapshot);
    const second = cache.project(snapshot);
    expect(second).toBe(first);
    expect(second[0]!.thread.turns[0]!.events).toBe(first[0]!.thread.turns[0]!.events);
    expect(
      cache.project({ ...input([root]), serverId: "other" })[0]!.thread.turns[0]!.events,
    ).toEqual([]);
  });
});
it("replays accepted image messages with late metadata and stable owner-specific views", () => {
  const cache = new RemoteAgentProjection();
  const snapshot: RemoteAgentProjectionInput = {
    ...input([root]),
    replays: new Map([
      [
        "root",
        [
          {
            type: "task.input",
            taskId: "root",
            sequence: 1,
            createdAt: root.createdAt,
            messageId: "message",
            parts: [
              { type: "text", text: "Check image" },
              { type: "attachment", attachmentId: "ab-cd" },
            ],
          },
        ],
      ],
    ]),
  };
  const first = cache.project(snapshot);
  expect(first[0]!.thread.turns[0]!.events[0]).toMatchObject({
    kind: "userMessage",
    text: "Check image",
    remoteMessageId: "message",
  });
  const attachment = {
    kind: "image" as const,
    attachmentId: "abcd",
    remote: { serverId: "server", attachmentId: "ab-cd" },
    name: "image.png",
    mime: "image/png" as const,
    bytes: 12,
    width: 1,
    height: 1,
  };
  const withImages = { ...snapshot, attachmentsByTask: new Map([["root", [attachment]]]) };
  const second = cache.project(withImages);
  expect(second[0]!.thread.turns[0]!.events[0]).toMatchObject({ attachments: [attachment] });
  expect(second[0]!.thread.turns[0]!.attachments).toEqual([]);
  expect(cache.project(withImages)).toBe(second);
  expect(projectRemoteAgentThreads(withImages)[0]!.thread.turns[0]!.events).toEqual(
    second[0]!.thread.turns[0]!.events,
  );
});
it("uses durable server subagent summaries when historical output was already evicted", () => {
  const lifecycle = {
    entries: [
      {
        id: "tool:spawn",
        toolId: "spawn",
        name: "Agent",
        description: "Review",
        state: "completed" as const,
      },
    ],
    truncated: false,
  };
  const projected = projectRemoteAgentThreads({
    ...input([root]),
    replayTruncated: new Set(["root"]),
    subagentLifecycles: new Map([["root", lifecycle]]),
  });
  expect(projected[0]!.thread.turns[0]!.subagentLifecycle).toBe(lifecycle);
  expect(projected[0]!.thread.turns[0]!.eventsTruncated).toBe(true);
});

describe("remote subagent lifecycle wire compatibility", () => {
  function projectLifecyclePage(lifecycle: unknown, status: RemoteRunnerTask["status"]): AgentTurn {
    const page = { items: [], nextCursor: null, subagentLifecycle: lifecycle };
    validateRemoteRunnerValue("listEvents", "response", page);
    const parsed = parseAgentSubagentLifecycle(page.subagentLifecycle);
    expect(parsed).toEqual(page.subagentLifecycle);
    const views = projectRemoteAgentThreads({
      ...input([{ ...root, status }]),
      subagentLifecycles: new Map(parsed === undefined ? [] : [["root", parsed]]),
    });
    const turn = views[0]!.thread.turns[0]!;
    expect(turn.subagentLifecycle).toBe(parsed);
    return turn;
  }

  it("keeps retained spawn identity from the runner page through the presentation path", () => {
    const turn = projectLifecyclePage(wire.valid.retained, "running");
    expect(turn.subagentLifecycle?.openBatchKey).toBe("spawn:toolu_parent");
    expect(turn.subagentLifecycle?.countedNestedToolIds).toEqual(["toolu_nested_overflow"]);
    const runtime = agentTurnRuntimeSubagents(turn);
    expect(runtime.agents).toHaveLength(1);
    expect(runtime.agents[0]).toMatchObject({
      batchId: "spawn:toolu_parent",
      title: "Fix subagent view findings",
      titleKnown: true,
      nestedAgents: 1,
      status: "working",
    });
    expect(runtime.batches.map((batch) => batch.id)).toEqual(["spawn:toolu_parent"]);
  });

  it("still loads a legacy lifecycle page from a runner without retention", () => {
    const turn = projectLifecyclePage(wire.valid.legacy, "succeeded");
    expect(turn.subagentLifecycle?.openBatchKey).toBeUndefined();
    expect(turn.subagentLifecycle?.entries[0]?.taskTitle).toBeUndefined();
    const runtime = agentTurnRuntimeSubagents(turn);
    expect(runtime.agents).toHaveLength(1);
    expect(runtime.agents[0]).toMatchObject({
      batchId: RUNTIME_SUBAGENT_LEGACY_BATCH_ID,
      role: "general-purpose",
      nestedAgents: 0,
      status: "completed",
    });
  });
});
