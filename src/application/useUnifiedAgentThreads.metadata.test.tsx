// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerGateway,
  RemoteRunnerInventoryEvent,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import type {
  RemoteThreadMetadata,
  RemoteThreadMetadataPatch,
} from "../domain/remoteThreadMetadata";
import {
  projectFixture,
  threadsSurfaceFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import { useUnifiedAgentThreads, type UnifiedAgentThreadsOptions } from "./useUnifiedAgentThreads";

const server: RemoteRunnerServer = {
  id: "server",
  name: "Linux",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
const launch = { provider: "codex", model: "default", mode: "default" } as const;
const task = (overrides: Partial<RemoteRunnerTask>): RemoteRunnerTask => ({
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "codex",
  launch,
  projectId: "project",
  status: "succeeded",
  parts: [{ type: "text", text: "Prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
  ...overrides,
});
const running = task({ id: "running", sequence: 1, status: "running" });
const finished = task({ id: "finished", sequence: 2, createdAt: "2026-09-14T00:00:00Z" });
const runningId = remoteAgentThreadKey(server.id, "runner", "running");
const finishedId = remoteAgentThreadKey(server.id, "runner", "finished");
const record = (change: Partial<RemoteThreadMetadata>): RemoteThreadMetadata => ({
  taskId: "unset",
  revision: 0,
  title: null,
  pinned: false,
  archived: false,
  removed: false,
  viewedAtEpochMs: null,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: null,
  ...change,
});
const SERVER_CHANGE_DEBOUNCE_MS = 100;

function metadataGateway() {
  const store = new Map<string, RemoteThreadMetadata>([
    ["running", record({ taskId: "running", revision: 2, viewedAtEpochMs: 1 })],
  ]);
  const listeners = new Set<(event: RemoteRunnerInventoryEvent) => void>();
  const tasks = [running, finished];
  return {
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    createTask: vi.fn(),
    startTask: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        taskLaunchOptions: true,
        threadManagement: true,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "App" }] }),
    listTasks: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items: after === 0 ? tasks : [],
      nextCursor: null,
    })),
    getTask: vi
      .fn()
      .mockImplementation(async ({ taskId }: { taskId: string }) =>
        tasks.find((item) => item.id === taskId)!,
      ),
    getTaskResume: vi.fn().mockResolvedValue({ available: false, reason: "task_not_finished" }),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getThreadMetadata: vi
      .fn()
      .mockImplementation(
        async ({ taskId }: { taskId: string }) => store.get(taskId) ?? record({ taskId }),
      ),
    listThreadMetadata: vi
      .fn()
      .mockImplementation(async () => ({ items: [...store.values()], nextAfter: null })),
    updateThreadMetadata: vi
      .fn()
      .mockImplementation(
        async ({ taskId, patch }: { taskId: string; patch: RemoteThreadMetadataPatch }) => {
          const current = store.get(taskId) ?? record({ taskId });
          if (patch.expectedRevision !== current.revision)
            throw new Error("Runner request failed (HTTP 409).");
          const { expectedRevision: _expected, ...change } = patch;
          const next = { ...current, ...change, revision: current.revision + 1 };
          store.set(taskId, next);
          setTimeout(() => {
            for (const listener of listeners) listener({ type: "changed" });
          }, SERVER_CHANGE_DEBOUNCE_MS);
          return next;
        },
      ),
    reorderThread: vi.fn(),
    watchInventory: vi
      .fn()
      .mockImplementation(
        async (
          _request: unknown,
          listener: (event: RemoteRunnerInventoryEvent) => void,
        ): Promise<() => void> => {
          listeners.add(listener);
          listener({ type: "connected" });
          return () => {
            listeners.delete(listener);
          };
        },
      ),
  } satisfies RemoteRunnerGateway;
}

type Gateway = ReturnType<typeof metadataGateway>;
const inventoryCalls = (gw: Gateway) => ({
  getRunner: gw.getRunner.mock.calls.length,
  listProjects: gw.listProjects.mock.calls.length,
  listTasks: gw.listTasks.mock.calls.length,
  getTask: gw.getTask.mock.calls.length,
  listEvents: gw.listEvents.mock.calls.length,
  listThreadMetadata: gw.listThreadMetadata.mock.calls.length,
  watchInventory: gw.watchInventory.mock.calls.length,
});

const disposers: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

async function setup(selectedThreadId: string | null = null) {
  const gw = metadataGateway();
  const options: UnifiedAgentThreadsOptions = {
    local: threadsSurfaceFixture(),
    gateway: gw,
    servers: [server],
    selectedServerId: null,
    workspaceOwner: "A",
    selectedThreadId,
    localProjects: [projectFixture()],
    gitSync: null,
    repositoryIdentity: null,
    externalUrlOpener: null,
  };
  let current!: ReturnType<typeof useUnifiedAgentThreads>;
  const root = createRoot(document.createElement("div"));
  function Harness() {
    current = useUnifiedAgentThreads(options);
    return null;
  }
  disposers.push(() => act(() => root.unmount()));
  await act(async () => {
    root.render(createElement(Harness));
  });
  const viewOf = (id: string) => current.agents.threads.find((view) => view.thread.threadId === id);
  expect(viewOf(runningId)?.lifecycle).toBe("running");
  expect(viewOf(finishedId)).toBeDefined();
  return {
    gw,
    viewOf,
    get current() {
      return current;
    },
  };
}

describe("server conversation metadata changes", () => {
  it("removes a server conversation without reloading the inventory while another one runs", async () => {
    const h = await setup();
    const baseline = inventoryCalls(h.gw);
    const runningBefore = h.viewOf(runningId);
    await act(async () => {
      expect(await h.current.agents.remove(finishedId)).toBe(true);
    });
    expect(h.gw.getThreadMetadata).toHaveBeenCalledTimes(1);
    expect(h.gw.updateThreadMetadata).toHaveBeenCalledExactlyOnceWith({
      serverId: server.id,
      taskId: "finished",
      patch: { removed: true, expectedRevision: 0 },
    });
    expect(h.viewOf(finishedId)).toBeUndefined();
    expect(inventoryCalls(h.gw)).toEqual(baseline);
    expect(h.viewOf(runningId)).toBe(runningBefore);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_CHANGE_DEBOUNCE_MS + 250);
    });
    expect(inventoryCalls(h.gw)).toEqual({
      ...baseline,
      getRunner: baseline.getRunner + 1,
      listProjects: baseline.listProjects + 1,
      listTasks: baseline.listTasks + 1,
      getTask: baseline.getTask + 1,
      listThreadMetadata: baseline.listThreadMetadata + 1,
    });
    expect(h.viewOf(finishedId)).toBeUndefined();
    expect(h.viewOf(runningId)).toBe(runningBefore);
  });

  it("removes the selected server conversation without reloading the inventory", async () => {
    const h = await setup(finishedId);
    const baseline = inventoryCalls(h.gw);
    const runningBefore = h.viewOf(runningId);
    await act(async () => {
      expect(await h.current.agents.remove(finishedId)).toBe(true);
    });
    expect(h.viewOf(finishedId)).toBeUndefined();
    expect(inventoryCalls(h.gw)).toEqual(baseline);
    expect(h.viewOf(runningId)).toBe(runningBefore);
  });

  it.each([
    {
      name: "pin",
      threadId: runningId,
      act: (agents: ReturnType<typeof useUnifiedAgentThreads>["agents"]) =>
        agents.togglePin(runningId),
      verify: (h: Awaited<ReturnType<typeof setup>>) =>
        expect(h.viewOf(runningId)?.thread.pinned).toBe(true),
    },
    {
      name: "archive",
      threadId: finishedId,
      act: (agents: ReturnType<typeof useUnifiedAgentThreads>["agents"]) =>
        agents.archive(finishedId),
      verify: (h: Awaited<ReturnType<typeof setup>>) =>
        expect(h.viewOf(finishedId)?.thread.archived).toBe(true),
    },
    {
      name: "settle",
      threadId: finishedId,
      act: (agents: ReturnType<typeof useUnifiedAgentThreads>["agents"]) =>
        agents.updateThreadOrganization?.(finishedId, { settledAt: 5 }),
      verify: (h: Awaited<ReturnType<typeof setup>>) =>
        expect(h.viewOf(finishedId)?.thread.settledAt).toBe(5),
    },
    {
      name: "rename",
      threadId: runningId,
      act: (agents: ReturnType<typeof useUnifiedAgentThreads>["agents"]) => {
        agents.renameThread(runningId, "Renamed");
      },
      verify: (h: Awaited<ReturnType<typeof setup>>) =>
        expect(h.viewOf(runningId)?.thread.title).toBe("Renamed"),
    },
    {
      name: "mark viewed",
      threadId: runningId,
      act: (agents: ReturnType<typeof useUnifiedAgentThreads>["agents"]) => {
        agents.markThreadViewed(runningId);
      },
      verify: (h: Awaited<ReturnType<typeof setup>>) =>
        expect(h.viewOf(runningId)?.thread.viewedAtEpochMs).toBe(
          h.viewOf(runningId)?.thread.updatedAtEpochMs,
        ),
    },
  ])("applies $name without reloading the inventory", async ({ threadId, act: run, verify }) => {
    const h = await setup();
    const baseline = inventoryCalls(h.gw);
    const other = threadId === runningId ? finishedId : runningId;
    const otherBefore = h.viewOf(other);
    await act(async () => {
      await run(h.current.agents);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.gw.updateThreadMetadata).toHaveBeenCalledTimes(1);
    verify(h);
    expect(inventoryCalls(h.gw)).toEqual(baseline);
    expect(h.viewOf(other)).toBe(otherBefore);
  });
});
