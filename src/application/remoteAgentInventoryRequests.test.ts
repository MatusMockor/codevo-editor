import { expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import { emptyRemoteInventory, loadRemoteAgentInventory } from "./remoteAgentInventoryLoad";
import { remoteAgentThreadKey } from "./remoteAgentProjection";

function fixture(count: number) {
  const tasks: RemoteRunnerTask[] = Array.from({ length: count }, (_, index) => ({
    id: `turn-${index + 1}`,
    sequence: index + 1,
    runnerId: "runner",
    provider: "claude",
    status: "succeeded",
    conversationId: "turn-1",
    ...(index > 0 ? { parentTaskId: `turn-${index}` } : {}),
    createdAt: "2026-09-15T00:00:00Z",
    parts: [{ type: "text", text: `Searchable original prompt ${index + 1}` }],
  }));
  const calls = {
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listTasks: vi.fn().mockResolvedValue({ items: tasks, nextCursor: null }),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        tasks.find((task) => task.id === taskId),
      ),
    listEvents: vi.fn().mockImplementation(async ({ taskId }: { taskId: string }) => ({
      items: [
        {
          taskId,
          sequence: 1,
          type: "task.output",
          channel: "stdout",
          text: `Original ${taskId}`,
          createdAt: "date",
        },
      ],
      nextCursor: null,
    })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
  };
  const load = (previous = emptyRemoteInventory("server", true)) =>
    loadRemoteAgentInventory(
      calls as unknown as RemoteRunnerGateway,
      previous,
      remoteAgentThreadKey("server", "runner", "turn-1"),
      () => true,
    );
  const reset = () => Object.values(calls).forEach((call) => call.mockClear());
  const requests = () =>
    Object.values(calls).reduce((sum, call) => sum + call.mock.calls.length, 0);
  return { calls, tasks, load, reset, requests };
}

it.each([1, 16, 64])(
  "refreshes a completed %i-turn conversation in four requests without discarding history",
  async (count) => {
    const h = fixture(count);
    const first = await h.load();
    expect(h.requests()).toBe(4 + count * 2);
    expect(h.calls.getTaskResume).toHaveBeenCalledExactlyOnceWith({
      serverId: "server",
      taskId: `turn-${count}`,
    });
    h.calls.listTasks.mockResolvedValue({ items: [], nextCursor: null });
    h.reset();
    const second = await h.load(first);
    expect(h.requests()).toBe(4);
    expect(h.calls.getTask).not.toHaveBeenCalled();
    expect(h.calls.listEvents).not.toHaveBeenCalled();
    expect(second.tasks).toHaveLength(count);
    for (const task of h.tasks) {
      expect(second.tasks.find((entry) => entry.id === task.id)?.parts).toEqual(task.parts);
      expect(second.replays.get(task.id)).toBe(first.replays.get(task.id));
      expect(second.replayComplete.has(task.id)).toBe(true);
    }
  },
);

it("checks the newly published latest turn and does not carry its parent's resume authority", async () => {
  const h = fixture(1);
  const first = await h.load();
  const child: RemoteRunnerTask = {
    ...h.tasks[0]!,
    id: "turn-2",
    sequence: 2,
    parentTaskId: "turn-1",
  };
  h.tasks.push(child);
  h.calls.listTasks.mockResolvedValue({ items: [child], nextCursor: null });
  h.calls.getTaskResume.mockResolvedValue({ available: false, reason: "session_unavailable" });
  h.reset();
  const second = await h.load(first);
  expect(h.calls.getTaskResume).toHaveBeenCalledExactlyOnceWith({
    serverId: "server",
    taskId: "turn-2",
  });
  expect(second.resumes.has("turn-1")).toBe(false);
  expect(second.resumes.get("turn-2")).toEqual({ available: false, reason: "session_unavailable" });
  expect(second.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
});

it("refreshes availability even when completed task metadata did not change", async () => {
  const h = fixture(1);
  const first = await h.load();
  h.calls.listTasks.mockResolvedValue({ items: [], nextCursor: null });
  h.calls.getTaskResume.mockResolvedValue({ available: false, reason: "session_unavailable" });
  const second = await h.load(first);
  expect(second.resumes.get("turn-1")).toEqual({ available: false, reason: "session_unavailable" });
});

it("checks the latest child even when its missing older ancestor is appended during hydration", async () => {
  const h = fixture(2);
  h.calls.listTasks.mockResolvedValue({ items: [h.tasks[1]!], nextCursor: null });
  const result = await h.load();
  expect(result.tasks).toHaveLength(2);
  expect(result.replays.size).toBe(2);
  expect(h.calls.getTaskResume).toHaveBeenCalledExactlyOnceWith({
    serverId: "server",
    taskId: "turn-2",
  });
});

it("starts no external request for an already revoked inventory owner", async () => {
  const h = fixture(1);
  await expect(
    loadRemoteAgentInventory(
      h.calls as unknown as RemoteRunnerGateway,
      emptyRemoteInventory("server", true),
      remoteAgentThreadKey("server", "runner", "turn-1"),
      () => false,
    ),
  ).rejects.toThrow();
  expect(h.requests()).toBe(0);
});
