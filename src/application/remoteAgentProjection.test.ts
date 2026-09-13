import { describe, expect, it } from "vitest";
import {
  RemoteAgentProjection,
  projectRemoteAgentThreads,
  type RemoteAgentProjectionInput,
} from "./remoteAgentProjection";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
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
    expect(second[0]!.thread.turns[0]!.events).toEqual(first[0]!.thread.turns[0]!.events);
    expect(
      cache.project({ ...input([root]), serverId: "other" })[0]!.thread.turns[0]!.events,
    ).toEqual([]);
  });
});
