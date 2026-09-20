// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import type { AgentThreadHistorySurface } from "./useAgentThreadHistory";
import { useRemoteAgentThreadHistory } from "./useRemoteAgentThreadHistory";
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});
const task = (sequence: number): RemoteRunnerTask => ({
  id: `task-${sequence}`,
  runnerId: "runner",
  sequence,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: `Prompt ${sequence}` }],
  createdAt: "2026-09-13T00:00:00Z",
  conversationId: "task-1",
  ...(sequence > 1 ? { parentTaskId: `task-${sequence - 1}` } : {}),
});
function harness() {
  let owner: object = {};
  const getTask = vi.fn(async ({ taskId }: { taskId: string }) => task(Number(taskId.slice(5))));
  const listEvents = vi.fn(async (_request: { taskId: string; after: number }) => ({
    items: [],
    nextCursor: null as number | null,
  }));
  const gateway = { getTask, listEvents } as unknown as RemoteRunnerGateway;
  let snapshot: RemoteAgentInventorySnapshot = {
    ...emptyRemoteInventory("server", true),
    descriptor: {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Server",
      capabilities: { instructionSync: true, taskExecution: true, eventReplay: true },
    },
    tasks: [task(70)],
  };
  const views = projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" });
  const threadId = views[0]!.thread.threadId;
  let surface!: AgentThreadHistorySurface;
  function Probe() {
    surface = useRemoteAgentThreadHistory({
      gateway,
      snapshots: [snapshot],
      views,
      selectedThreadId: threadId,
      owner,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  return {
    getTask,
    listEvents,
    views,
    threadId,
    surface: () => surface,
    render: async () => {
      await act(async () => root!.render(<Probe />));
    },
    disconnect: async () => {
      snapshot = { ...snapshot, connected: false };
      await act(async () => root!.render(<Probe />));
    },
    replace: async () => {
      owner = {};
      await act(async () => root!.render(<Probe />));
    },
  };
}
it("replaces bounded ancestor pages without altering latest execution or inventory", async () => {
  const h = harness();
  await h.render();
  await act(async () => h.surface().older(h.threadId));
  expect(h.surface().page?.turns).toHaveLength(32);
  expect(h.surface().page?.turns[0].turnId).toBe("task-38");
  expect(h.getTask).toHaveBeenCalledTimes(32);
  await act(async () => h.surface().older(h.threadId));
  expect(h.surface().page?.turns[0].turnId).toBe("task-6");
  await act(async () => h.surface().older(h.threadId));
  expect(h.surface().page?.turns).toHaveLength(5);
  expect(h.surface().page?.hasEarlier).toBe(false);
  await act(async () => h.surface().newer?.(h.threadId));
  expect(h.surface().page?.turns[0].turnId).toBe("task-6");
  await act(async () => h.surface().newer?.(h.threadId));
  expect(h.surface().page?.turns[0].turnId).toBe("task-38");
  expect(h.views[0].thread.turns[0].turnId).toBe("task-70");
  expect(h.views[0].execution).toMatchObject({ latestTaskId: "task-70" });
  await act(async () => h.surface().latest());
  expect(h.surface().page).toBeNull();
});
it.each([
  { runnerId: "foreign" },
  { projectId: "foreign" },
  { provider: "codex" },
  { isolation: "in-place" },
  { sequence: 70 },
  { conversationId: "foreign" },
])("rejects foreign ancestor %j before events", async (changes) => {
  const h = harness();
  await h.render();
  h.getTask.mockResolvedValueOnce({ ...task(69), ...changes } as RemoteRunnerTask);
  await act(async () => h.surface().older(h.threadId));
  expect(h.surface().page?.error).toContain("Could not load");
  expect(h.listEvents).not.toHaveBeenCalled();
});
it("discards late ancestry after owner replacement", async () => {
  const h = harness();
  await h.render();
  let resolve!: (task: RemoteRunnerTask) => void;
  h.getTask.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = h.surface().older(h.threadId);
  });
  await h.replace();
  await act(async () => {
    resolve(task(69));
    await pending;
  });
  expect(h.surface().page).toBeNull();
  expect(h.listEvents).not.toHaveBeenCalled();
});
it("marks a bounded unfinished event replay as truncated", async () => {
  const h = harness();
  await h.render();
  h.listEvents.mockImplementation(
    async ({ taskId, after }) =>
      ({
        items: [
          {
            taskId,
            sequence: after + 1,
            type: "task.output",
            text: "partial",
            createdAt: "2026-09-13T00:00:00Z",
          },
        ],
        nextCursor: after + 1,
      }) as unknown as Awaited<ReturnType<typeof h.listEvents>>,
  );
  await act(async () => h.surface().older(h.threadId));
  expect(h.listEvents).toHaveBeenCalledTimes(32 * 24);
  expect(h.surface().page?.turns.every((turn) => turn.eventsTruncated)).toBe(true);
});

it.each(["latest", "disconnect", "replace"] as const)(
  "revokes pending replay on %s",
  async (action) => {
    const h = harness();
    await h.render();
    let resolve!: (value: Awaited<ReturnType<typeof h.listEvents>>) => void;
    h.listEvents.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.surface().older(h.threadId);
    });
    if (action === "latest") await act(async () => h.surface().latest());
    else if (action === "disconnect") await h.disconnect();
    else {
      await h.replace();
      await h.replace();
    }
    await act(async () => {
      resolve({ items: [], nextCursor: null });
      await pending;
    });
    expect(h.surface().page).toBeNull();
    expect(h.listEvents).toHaveBeenCalledTimes(1);
  },
);
