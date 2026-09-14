// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { useRemoteRunnerTasks, type RemoteRunnerTasksSurface } from "./useRemoteRunnerTasks";

const task = (id = "task-1", sequence = 1): RemoteRunnerTask => ({
  id,
  sequence,
  runnerId: "runner-1",
  provider: "claude",
  status: "succeeded",
  projectId: "project-1",
  parts: [{ type: "text", text: "Fix the tests" }],
  createdAt: "2026-09-13T00:00:00Z",
});
const patch = { patch: "+fixed", truncated: false, untrackedFiles: [] };
function gateway() {
  return {
    listServers: vi.fn().mockResolvedValue([]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner-1",
      name: "Linux",
      capabilities: { taskExecution: true, eventReplay: true },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project-1", name: "Project" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn().mockResolvedValue({ task: { ...task(), status: "draft" }, created: true }),
    startTask: vi.fn().mockResolvedValue({ ...task(), status: "queued" }),
    getTask: vi.fn().mockImplementation(async ({ taskId }: { taskId: string }) => task(taskId)),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn().mockResolvedValue({ ...task(), status: "cancelled" }),
    listEvents: vi.fn().mockImplementation(async ({ taskId }: { taskId: string }) => ({
      items: [
        {
          sequence: 1,
          taskId,
          type: "task.output",
          text: "tests passed",
          createdAt: "2026-09-13T00:00:00Z",
        },
      ],
      nextCursor: null,
    })),
    getDiff: vi.fn().mockResolvedValue(patch),
    uploadAttachment: vi
      .fn()
      .mockImplementation(async ({ attachmentId }: { attachmentId: string }) => ({
        attachment: { id: attachmentId, runnerId: "runner-1" },
        created: true,
      })),
  } satisfies RemoteRunnerGateway;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});
async function render(gw: RemoteRunnerGateway) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let surface: RemoteRunnerTasksSurface;
  function Harness({ workspaceOwner }: { workspaceOwner: string }) {
    surface = useRemoteRunnerTasks({ gateway: gw, serverId: "server-1", workspaceOwner });
    return null;
  }
  async function workspace(workspaceOwner: string) {
    await act(async () => {
      root.render(createElement(Harness, { workspaceOwner }));
    });
  }
  disposers.push(() => act(() => root.unmount()));
  await workspace("A");
  return { current: () => surface!, workspace };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const input = {
  projectId: "project-1",
  provider: "claude" as const,
  prompt: "Fix this",
  attachments: [{ name: "screen.png", mediaType: "image/png" as const, base64: "aGVsbG8=" }],
};

describe("useRemoteRunnerTasks", () => {
  it("restores server projects, task history, output, and final diff", async () => {
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    const view = await render(gw);
    expect(view.current().projects).toEqual([{ id: "project-1", name: "Project" }]);
    expect(view.current().selectedTask?.id).toBe("task-1");
    expect(view.current().events[0]?.text).toBe("tests passed");
    expect(view.current().diff).toEqual(patch);
    expect(view.current().loading).toBe(false);
  });

  it("uploads images before creating and starting a task in the selected server project", async () => {
    const gw = gateway();
    const view = await render(gw);
    await act(async () => {
      await view.current().submit(input);
    });
    expect(gw.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "server-1", name: "screen.png" }),
    );
    expect(gw.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: "text", text: "Fix this" },
          { type: "attachment", attachmentId: expect.any(String) },
        ],
      }),
    );
    expect(gw.startTask).toHaveBeenCalledWith({
      serverId: "server-1",
      taskId: "task-1",
      projectId: "project-1",
    });
    expect(gw.uploadAttachment.mock.invocationCallOrder[0]).toBeLessThan(
      gw.createTask.mock.invocationCallOrder[0]!,
    );
    expect(gw.createTask.mock.invocationCallOrder[0]).toBeLessThan(
      gw.startTask.mock.invocationCallOrder[0]!,
    );
    expect(view.current().busy).toBe(false);
  });

  it.each(["upload", "create"] as const)(
    "revokes pending %s authority across workspace A → B → A",
    async (stage) => {
      const gw = gateway();
      const pending = deferred<unknown>();
      if (stage === "upload") gw.uploadAttachment.mockReturnValueOnce(pending.promise);
      else gw.createTask.mockReturnValueOnce(pending.promise);
      const view = await render(gw);
      let submission!: Promise<RemoteRunnerTask | null>;
      await act(async () => {
        submission = view.current().submit(input);
      });
      await view.workspace("B");
      await view.workspace("A");
      await act(async () => {
        pending.resolve(
          stage === "upload"
            ? { attachment: { id: "image-1" }, created: true }
            : { task: task(), created: true },
        );
        expect(await submission).toBeNull();
      });
      expect(gw.startTask).not.toHaveBeenCalled();
      if (stage === "upload") expect(gw.createTask).not.toHaveBeenCalled();
      expect(view.current().tasks).toEqual([]);
      expect(view.current().selectedTask).toBeNull();
      expect(view.current().busy).toBe(false);
    },
  );

  it("discards a delayed poll after selecting another task", async () => {
    const gw = gateway();
    const pending = deferred<RemoteRunnerTask>();
    gw.listTasks.mockResolvedValue({
      items: [task("older", 1), task("newer", 2)],
      nextCursor: null,
    });
    gw.getTask.mockImplementation(async ({ taskId }: { taskId: string }) =>
      taskId === "newer" ? pending.promise : task(taskId),
    );
    const view = await render(gw);
    await act(async () => {
      view.current().selectTask("older");
    });
    await act(async () => {
      pending.resolve(task("newer", 2));
    });
    expect(view.current().selectedTask?.id).toBe("older");
    expect(view.current().events.every((event) => event.taskId === "older")).toBe(true);
  });

  it("retains visible history during disconnection and recovers on refresh", async () => {
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    const view = await render(gw);
    gw.getRunner.mockRejectedValueOnce(new Error("SSH disconnected"));
    await act(async () => {
      await view.current().refresh();
    });
    expect(view.current().error).toBe("SSH disconnected");
    expect(view.current().tasks).toHaveLength(1);
    expect(view.current().events[0]?.text).toBe("tests passed");
    await act(async () => {
      await view.current().refresh();
    });
    expect(view.current().error).toBeNull();
    expect(view.current().tasks).toHaveLength(1);
  });
  it("rejects an attachment from another runner before creating a task", async () => {
    const gw = gateway();
    gw.uploadAttachment.mockImplementation(async ({ attachmentId }: { attachmentId: string }) => ({
      attachment: { id: attachmentId, runnerId: "foreign" },
      created: true,
    }));
    const view = await render(gw);
    await act(async () => {
      expect(await view.current().submit(input)).toBeNull();
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(gw.startTask).not.toHaveBeenCalled();
    expect(view.current().error).toContain("different attachment");
  });

  it("rejects foreign drafts before starting execution", async () => {
    const gw = gateway();
    gw.createTask.mockResolvedValue({
      task: { ...task(), status: "draft", runnerId: "foreign" },
      created: true,
    });
    const view = await render(gw);
    await act(async () => {
      expect(await view.current().submit(input)).toBeNull();
    });
    expect(gw.startTask).not.toHaveBeenCalled();
    expect(view.current().tasks).toEqual([]);
    expect(view.current().error).toContain("different task draft");
  });

  it("rejects foreign event output instead of publishing it", async () => {
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    gw.listEvents.mockResolvedValue({
      items: [
        {
          sequence: 1,
          taskId: "foreign",
          type: "task.output",
          text: "private",
          createdAt: "2026-09-13T00:00:00Z",
        },
      ],
      nextCursor: null,
    });
    const view = await render(gw);
    expect(view.current().events).toEqual([]);
    expect(view.current().diff).toEqual(patch);
    expect(view.current().error).toContain("invalid event ordering");
  });

  it("replays all event pages before restoring a completed task diff", async () => {
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    gw.listEvents.mockResolvedValueOnce({
      items: [
        {
          sequence: 1,
          taskId: "task-1",
          type: "task.output",
          text: "first",
          createdAt: "2026-09-13T00:00:00Z",
        },
      ],
      nextCursor: 1,
    });
    gw.listEvents.mockResolvedValueOnce({
      items: [
        {
          sequence: 2,
          taskId: "task-1",
          type: "task.output",
          text: "second",
          createdAt: "2026-09-13T00:00:00Z",
        },
      ],
      nextCursor: null,
    });
    const view = await render(gw);
    expect(view.current().events.map((event) => event.text)).toEqual(["first", "second"]);
    expect(gw.listEvents).toHaveBeenNthCalledWith(2, {
      serverId: "server-1",
      taskId: "task-1",
      after: 1,
    });
    expect(view.current().diff).toEqual(patch);
  });
  it("retries disconnected output polling and preserves the task history", async () => {
    vi.useFakeTimers();
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    gw.getTask.mockRejectedValueOnce(new Error("SSH disconnected"));
    const view = await render(gw);
    expect(view.current().tasks).toHaveLength(1);
    expect(view.current().error).toBe("SSH disconnected");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(view.current().error).toBeNull();
    expect(view.current().events[0]?.text).toBe("tests passed");
    expect(view.current().diff).toEqual(patch);
  });
  it("shows completed status and diff even when output exceeds the display cap", async () => {
    const gw = gateway();
    gw.listTasks.mockResolvedValue({ items: [{ ...task(), status: "running" }], nextCursor: null });
    gw.listEvents.mockResolvedValue({
      items: Array.from({ length: 1101 }, (_, index) => ({
        sequence: index + 1,
        taskId: "task-1",
        type: "task.output",
        text: "line",
        createdAt: "2026-09-13T00:00:00Z",
      })),
      nextCursor: null,
    });
    const view = await render(gw);
    expect(view.current().selectedTask?.status).toBe("succeeded");
    expect(view.current().tasks[0]?.status).toBe("succeeded");
    expect(view.current().diff).toEqual(patch);
    expect(view.current().events).toEqual([]);
    expect(view.current().error).toContain("displayed output is incomplete");
  });

  it("does not let a refresh started before submission erase the new task", async () => {
    const gw = gateway();
    const view = await render(gw);
    const pending = deferred<{ items: RemoteRunnerTask[]; nextCursor: null }>();
    gw.listTasks.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = view.current().refresh();
    });
    expect(gw.listTasks).toHaveBeenCalledTimes(2);
    await act(async () => {
      await view.current().submit(input);
    });
    expect(view.current().tasks.map((item) => item.id)).toEqual(["task-1"]);
    await act(async () => {
      pending.resolve({ items: [], nextCursor: null });
      await refresh;
    });
    expect(view.current().tasks.map((item) => item.id)).toEqual(["task-1"]);
    expect(view.current().selectedTask?.id).toBe("task-1");
    expect(view.current().loading).toBe(false);
  });
});

describe("remote session continuation", () => {
  function continuableGateway() {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner-1",
      name: "Linux",
      capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
    });
    gw.listTasks.mockResolvedValue({ items: [task()], nextCursor: null });
    gw.continueTask.mockImplementation(async ({ parts }: { parts: RemoteRunnerTask["parts"] }) => ({
      task: {
        ...task("task-2", 2),
        parts: parts.map((part) =>
          part.type === "text"
            ? { text: part.text, type: part.type }
            : { attachmentId: part.attachmentId, type: part.type },
        ),
        parentTaskId: "task-1",
        conversationId: "task-1",
        status: "queued",
      },
      created: true,
    }));
    return gw;
  }
  it("keeps the replay cursor across status updates and checks resume only at completion", async () => {
    vi.useFakeTimers();
    const gw = continuableGateway();
    gw.listTasks.mockResolvedValue({ items: [{ ...task(), status: "queued" }], nextCursor: null });
    gw.getTask.mockResolvedValueOnce({ ...task(), status: "running" });
    gw.listEvents.mockImplementation(
      async ({ taskId, after }: { taskId: string; after: number }) => ({
        items: [
          {
            sequence: after + 1,
            taskId,
            type: "task.output",
            text: `chunk ${after + 1}`,
            createdAt: "2026-09-13T00:00:00Z",
          },
        ],
        nextCursor: null,
      }),
    );
    const hook = await render(gw);
    expect(hook.current().selectedTask?.status).toBe("running");
    expect(gw.getTask).toHaveBeenCalledTimes(1);
    expect(gw.getTaskResume).not.toHaveBeenCalled();
    await hook.workspace("A");
    expect(gw.getTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(hook.current().selectedTask?.status).toBe("succeeded");
    expect(hook.current().events.map((event) => event.text)).toEqual(["chunk 1", "chunk 2"]);
    expect(gw.listEvents).toHaveBeenNthCalledWith(2, {
      serverId: "server-1",
      taskId: "task-1",
      after: 1,
    });
    expect(gw.getTaskResume).toHaveBeenCalledTimes(1);
    expect(hook.current().resume?.available).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(gw.getTask).toHaveBeenCalledTimes(2);
    expect(gw.getTaskResume).toHaveBeenCalledTimes(1);
  });

  it("continues the original provider and project without creating a fresh draft", async () => {
    const gw = continuableGateway();
    const hook = await render(gw);
    expect(hook.current().resume).toEqual({ available: true, reason: null });
    await act(async () => {
      await hook.current().continueTask(input);
    });
    expect(gw.continueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "server-1",
        taskId: "task-1",
        parts: [
          { type: "text", text: input.prompt },
          { type: "attachment", attachmentId: expect.any(String) },
        ],
      }),
    );
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(gw.startTask).not.toHaveBeenCalled();
    expect(hook.current().selectedTask?.id).toBe("task-2");
  });
  it("retains the exact command after a lost response and reconciles it through refresh", async () => {
    const gw = continuableGateway();
    gw.continueTask.mockRejectedValueOnce(new Error("Connection lost"));
    const hook = await render(gw);
    await act(async () => {
      await hook.current().continueTask(input);
    });
    expect(hook.current().continuationUncertain).toBe(true);
    const original = gw.continueTask.mock.calls[0];
    await act(async () => {
      await hook.current().continueTask({ ...input, prompt: "Changed message" });
    });
    expect(gw.continueTask).toHaveBeenCalledTimes(1);
    act(() => hook.current().resetSelection());
    expect(hook.current().selectedTask?.id).toBe("task-1");
    await act(async () => {
      await hook.current().submit(input);
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    await act(async () => {
      await hook.current().refresh();
    });
    expect(gw.continueTask.mock.calls[1]).toEqual(original);
    expect(gw.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(hook.current().continuationUncertain).toBe(false);
    expect(hook.current().selectedTask?.id).toBe("task-2");
  });
  it("does not dispatch after an attachment resolves for an old workspace generation", async () => {
    const gw = continuableGateway();
    const upload = deferred<{ attachment: { id: string; runnerId: string }; created: boolean }>();
    gw.uploadAttachment.mockReturnValueOnce(upload.promise);
    const hook = await render(gw);
    let work!: Promise<RemoteRunnerTask | null>;
    act(() => {
      work = hook.current().continueTask(input);
    });
    const attachmentId = gw.uploadAttachment.mock.calls[0]![0].attachmentId;
    await hook.workspace("B");
    await hook.workspace("A");
    await act(async () => {
      upload.resolve({ attachment: { id: attachmentId, runnerId: "runner-1" }, created: true });
      await work;
    });
    expect(gw.continueTask).not.toHaveBeenCalled();
    expect(hook.current().busy).toBe(false);
  });
  it("keeps a deliberately empty new conversation selected across refresh", async () => {
    const hook = await render(continuableGateway());
    act(() => hook.current().resetSelection());
    await act(async () => {
      await hook.current().refresh();
    });
    expect(hook.current().selectedTask).toBeNull();
    expect(hook.current().resume).toBeNull();
  });
  it("rejects a provider change and a foreign returned parent", async () => {
    const gw = continuableGateway();
    const hook = await render(gw);
    await act(async () => {
      await hook.current().continueTask({ ...input, provider: "codex" });
    });
    expect(gw.continueTask).not.toHaveBeenCalled();
    gw.continueTask.mockResolvedValueOnce({
      task: { ...task("task-2", 2), parentTaskId: "foreign" },
      created: true,
    });
    await act(async () => {
      await hook.current().continueTask(input);
    });
    expect(hook.current().selectedTask?.id).toBe("task-1");
    expect(hook.current().continuationUncertain).toBe(true);
  });
  it("unlocks navigation on an authoritative rejection and rechecks resume availability", async () => {
    const gw = continuableGateway();
    const hook = await render(gw);
    gw.continueTask.mockRejectedValueOnce(
      new RemoteRunnerRequestRejectedError("A newer turn exists."),
    );
    gw.getTaskResume.mockResolvedValue({ available: false, reason: "newer_turn_exists" });
    await act(async () => {
      await hook.current().continueTask(input);
    });
    expect(hook.current().continuationUncertain).toBe(false);
    expect(hook.current().resume).toEqual({ available: false, reason: "newer_turn_exists" });
    act(() => hook.current().resetSelection());
    expect(hook.current().selectedTask).toBeNull();
  });
  it("rejects oversized UTF-8 input before dispatch without locking recovery", async () => {
    const gw = continuableGateway();
    const hook = await render(gw);
    await act(async () => {
      await hook.current().continueTask({ ...input, prompt: "ž".repeat(24001) });
    });
    expect(gw.continueTask).not.toHaveBeenCalled();
    expect(gw.uploadAttachment).not.toHaveBeenCalled();
    expect(hook.current().continuationUncertain).toBe(false);
  });
  it("rejects a continuation callback captured before New conversation", async () => {
    const gw = continuableGateway();
    const hook = await render(gw);
    const staleContinue = hook.current().continueTask;
    act(() => hook.current().resetSelection());
    await act(async () => {
      await staleContinue(input);
    });
    expect(gw.uploadAttachment).not.toHaveBeenCalled();
    expect(gw.continueTask).not.toHaveBeenCalled();
    expect(hook.current().selectedTask).toBeNull();
  });
  it("does not publish a late continuation response after workspace A to B to A", async () => {
    const gw = continuableGateway();
    const response = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    gw.continueTask.mockReturnValueOnce(response.promise);
    const hook = await render(gw);
    let work!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      work = hook.current().continueTask({ ...input, attachments: [] });
    });
    await hook.workspace("B");
    await hook.workspace("A");
    await act(async () => {
      response.resolve({
        task: {
          ...task("late", 2),
          parentTaskId: "task-1",
          conversationId: "task-1",
          parts: [{ type: "text", text: input.prompt }],
        },
        created: true,
      });
      await work;
    });
    expect(hook.current().selectedTask?.id).toBe("task-1");
    expect(hook.current().tasks.some((item) => item.id === "late")).toBe(false);
    expect(hook.current().busy).toBe(false);
  });
});
