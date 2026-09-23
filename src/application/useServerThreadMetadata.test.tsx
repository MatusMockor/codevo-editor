// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads, remoteAgentThreadKey } from "./remoteAgentProjection";
import { useServerThreadMetadata } from "./useServerThreadMetadata";

const task = {
  id: "t",
  runnerId: "r",
  projectId: "p",
  sequence: 1,
  provider: "codex" as const,
  status: "succeeded" as const,
  parts: [{ type: "text" as const, text: "Original" }],
  createdAt: "2026-09-13T00:00:00Z",
};
const view = projectRemoteAgentThreads({
  serverId: "s",
  runnerId: "r",
  projects: [{ id: "p", name: "Project" }],
  tasks: [task],
  replays: new Map(),
  resumes: new Map(),
})[0]!;
const record = (change: Partial<RemoteThreadMetadata> = {}): RemoteThreadMetadata => ({
  taskId: "t",
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
const snapshot = (metadata = record(), connected = true, capable = true) => ({
  ...emptyRemoteInventory("s", connected),
  descriptor: {
    protocolVersion: 1 as const,
    runnerId: "r",
    name: "Runner",
    capabilities: { taskExecution: true, eventReplay: true, threadManagement: capable },
  },
  tasks: [task],
  threadMetadata: new Map([["t", metadata]]),
});
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function harness(options: Partial<Parameters<typeof useServerThreadMetadata>[0]> = {}) {
  const gateway = {
    getThreadMetadata: vi.fn().mockResolvedValue(record()),
    updateThreadMetadata: vi.fn().mockResolvedValue(record({ revision: 1 })),
    reorderThread: vi.fn().mockResolvedValue(undefined),
  };
  let owner = {};
  const refresh = vi.fn().mockResolvedValue(undefined);
  const report = vi.fn();
  let props = {
    gateway: gateway as unknown as RemoteRunnerGateway,
    snapshots: [snapshot()],
    owner,
    valid: (candidate: object) => candidate === owner,
    report,
    refresh,
    ...options,
  };
  let surface!: ReturnType<typeof useServerThreadMetadata>;
  function Harness() {
    surface = useServerThreadMetadata(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () => {
      root.render(createElement(Harness));
    });
  await render();
  disposers.push(() => act(() => root.unmount()));
  return {
    gateway,
    refresh,
    report,
    current: () => surface,
    async snapshots(snapshots: typeof props.snapshots) {
      props = { ...props, snapshots };
      await render();
    },
    async replaceOwner() {
      owner = {};
      props = { ...props, owner };
      await render();
    },
  };
}
it("uses server state over stale local preferences and does not migrate nonzero revisions", async () => {
  const h = await harness({
    snapshots: [snapshot(record({ revision: 2, title: "Server", archived: false }))],
    repository: {
      load: () => [{ threadId: view.thread.threadId, title: "Old", archived: true, removed: true }],
      save: vi.fn(),
    },
  });
  expect(h.current().project(view)?.thread.title).toBe("Server");
  expect(h.current().project(view)?.thread.archived).toBe(false);
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
});
it("migrates archived and removed legacy preferences using revision-zero CAS", async () => {
  const h = await harness({
    repository: {
      load: () => [{ threadId: view.thread.threadId, archived: true, removed: true }],
      save: vi.fn(),
    },
  });
  expect(h.current().project(view)).toBeNull();
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledWith({
    serverId: "s",
    taskId: "t",
    patch: { expectedRevision: 0, archived: true, removed: true },
  });
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it.each([
  [false, true],
  [true, false],
])("blocks offline or unsupported mutations (%s,%s)", async (connected, capable) => {
  const h = await harness({ snapshots: [snapshot(record(), connected, capable)] });
  await act(async () => h.current().update(view.thread.threadId, { pinned: true }));
  expect(h.gateway.getThreadMetadata).not.toHaveBeenCalled();
  expect(h.report).toHaveBeenCalledTimes(1);
});
it("fetches the latest revision and only refreshes after successful persistence", async () => {
  const h = await harness();
  h.gateway.getThreadMetadata.mockResolvedValue(record({ revision: 7 }));
  await act(async () => h.current().update(view.thread.threadId, { pinned: true }));
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledWith({
    serverId: "s",
    taskId: "t",
    patch: { pinned: true, expectedRevision: 7 },
  });
  expect(h.current().project(view)?.thread.pinned).toBe(false);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("does not write after an owner A-B-A replacement while reading metadata", async () => {
  const h = await harness();
  let settle!: (value: RemoteThreadMetadata) => void;
  h.gateway.getThreadMetadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = h.current().update(view.thread.threadId, { pinned: true });
  await h.replaceOwner();
  await h.replaceOwner();
  await act(async () => {
    settle(record());
    await pending;
  });
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
  expect(h.refresh).not.toHaveBeenCalled();
});
it("locks concurrent writes and ignores late persistence after owner revocation", async () => {
  const h = await harness();
  let settle!: () => void;
  h.gateway.updateThreadMetadata.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = h.current().update(view.thread.threadId, { pinned: true });
  });
  expect(await h.current().update(view.thread.threadId, { archived: true })).toBe(false);
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(1);
  await h.replaceOwner();
  await act(async () => {
    settle();
    await pending;
  });
  expect(h.refresh).not.toHaveBeenCalled();
});
it("reports a conflict and refreshes authoritative state without optimistic changes", async () => {
  const h = await harness();
  h.gateway.updateThreadMetadata.mockRejectedValue(new Error("revision conflict"));
  await act(async () => h.current().update(view.thread.threadId, { archived: true }));
  expect(h.report).toHaveBeenCalledTimes(1);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(h.current().project(view)?.thread.archived).toBe(false);
});
it("does not reject to callers if saving and refreshing both fail", async () => {
  const h = await harness();
  h.gateway.updateThreadMetadata.mockRejectedValue(new Error("disconnected"));
  h.refresh.mockRejectedValue(new Error("disconnected"));
  await expect(h.current().update(view.thread.threadId, { pinned: true })).resolves.toBe(false);
});
it("does not invoke optional commands when a capable descriptor lacks an adapter", async () => {
  const report = vi.fn();
  const h = await harness({ gateway: {} as RemoteRunnerGateway, report });
  await h.current().update(view.thread.threadId, { pinned: true });
  expect(report).toHaveBeenCalledWith("Update the server to manage conversations across devices.");
});
it("keeps reorder on the selected server and refreshes after persistence", async () => {
  const source = snapshot();
  const other = { ...task, id: "other", sequence: 2 };
  const h = await harness({ snapshots: [{ ...source, tasks: [task, other] }] });
  const targetView = projectRemoteAgentThreads({
    serverId: "s",
    runnerId: "r",
    projects: [{ id: "p", name: "Project" }],
    tasks: [other],
    replays: new Map(),
    resumes: new Map(),
  })[0]!;
  await h.current().reorder(view.thread.threadId, targetView.thread.threadId, "before");
  expect(h.gateway.reorderThread).toHaveBeenCalledWith({
    serverId: "s",
    taskId: "t",
    targetTaskId: "other",
    placement: "before",
  });
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "revokes a pending write when runner identity changes, including A-B-A (%s)",
  async (returnToOriginal) => {
    const h = await harness();
    let settle!: (value: RemoteThreadMetadata) => void;
    h.gateway.getThreadMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending = h.current().update(view.thread.threadId, { pinned: true });
    const replacement = snapshot();
    await h.snapshots([
      { ...replacement, descriptor: { ...replacement.descriptor, runnerId: "replacement" } },
    ]);
    if (returnToOriginal) await h.snapshots([snapshot()]);
    await act(async () => {
      settle(record());
      await pending;
    });
    expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  },
);
it("retains pending writes across metadata-only inventory refresh", async () => {
  const h = await harness();
  let settle!: (value: RemoteThreadMetadata) => void;
  h.gateway.getThreadMetadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = h.current().update(view.thread.threadId, { pinned: true });
  await h.snapshots([snapshot(record({ revision: 5 }))]);
  await act(async () => {
    settle(record({ revision: 5 }));
    await pending;
  });
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledWith({
    serverId: "s",
    taskId: "t",
    patch: { pinned: true, expectedRevision: 5 },
  });
});
it("persists a section change before ordering and refreshes a partial failure", async () => {
  const base = snapshot();
  const h = await harness({
    snapshots: [
      {
        ...base,
        tasks: [task, { ...task, id: "other" }],
        threadMetadata: new Map([
          ["t", record()],
          ["other", record({ taskId: "other", pinned: true })],
        ]),
      },
    ],
  });
  h.gateway.getThreadMetadata.mockImplementation(async ({ taskId }: { taskId: string }) =>
    record({ taskId, revision: 3, pinned: taskId === "other" }),
  );
  h.gateway.reorderThread.mockRejectedValue(new Error("conflict"));
  await h
    .current()
    .reorder(view.thread.threadId, view.thread.threadId.replace(/t$/, "other"), "before", "pinned");
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledWith({
    serverId: "s",
    taskId: "t",
    patch: {
      expectedRevision: 3,
      pinned: true,
      snoozedUntil: null,
      settledAt: null,
    },
  });
  expect(h.gateway.updateThreadMetadata.mock.invocationCallOrder[0]).toBeLessThan(
    h.gateway.reorderThread.mock.invocationCallOrder[0]!,
  );
  expect(h.report).toHaveBeenCalledTimes(1);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("supports an empty-section drop without a reorder request", async () => {
  const h = await harness();
  await h.current().reorder(view.thread.threadId, view.thread.threadId, "after", "pinned");
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(1);
  expect(h.gateway.reorderThread).not.toHaveBeenCalled();
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("does not order after section persistence if its target disappears", async () => {
  const base = snapshot();
  const targetId = view.thread.threadId.replace(/t$/, "other");
  const h = await harness({
    snapshots: [
      {
        ...base,
        tasks: [task, { ...task, id: "other" }],
        threadMetadata: new Map([
          ["t", record()],
          ["other", record({ taskId: "other", pinned: true })],
        ]),
      },
    ],
  });
  h.gateway.getThreadMetadata.mockImplementation(async ({ taskId }: { taskId: string }) =>
    record({ taskId, pinned: taskId === "other" }),
  );
  let settle!: () => void;
  h.gateway.updateThreadMetadata.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = h.current().reorder(view.thread.threadId, targetId, "before", "pinned");
  });
  await h.snapshots([base]);
  settle();
  await pending;
  expect(h.gateway.reorderThread).not.toHaveBeenCalled();
  expect(h.refresh).not.toHaveBeenCalled();
});
it("rejects cross-project drops and settling running conversations", async () => {
  const h = await harness({
    snapshots: [{ ...snapshot(), tasks: [task, { ...task, id: "other", projectId: "foreign" }] }],
  });
  await h
    .current()
    .reorder(view.thread.threadId, view.thread.threadId.replace(/t$/, "other"), "before", "active");
  await h.snapshots([{ ...snapshot(), tasks: [{ ...task, status: "running" }] }]);
  await h.current().reorder(view.thread.threadId, view.thread.threadId, "after", "settled");
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
  expect(h.gateway.reorderThread).not.toHaveBeenCalled();
});
it("does not move when the target section changes during the metadata read", async () => {
  const base = snapshot();
  const other = { ...task, id: "other" };
  const withTarget = {
    ...base,
    tasks: [task, other],
    threadMetadata: new Map([
      ["t", record()],
      ["other", record({ taskId: "other", pinned: true })],
    ]),
  };
  const h = await harness({ snapshots: [withTarget] });
  let settle!: (value: RemoteThreadMetadata) => void;
  h.gateway.getThreadMetadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const pending = h
    .current()
    .reorder(view.thread.threadId, view.thread.threadId.replace(/t$/, "other"), "before", "pinned");
  await h.snapshots([
    {
      ...withTarget,
      threadMetadata: new Map([
        ["t", record()],
        ["other", record({ taskId: "other" })],
      ]),
    },
  ]);
  settle(record());
  await pending;
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
  expect(h.gateway.reorderThread).not.toHaveBeenCalled();
});
it("reconciles a saved section when the target moves while persistence is pending", async () => {
  const withTarget = {
    ...snapshot(),
    tasks: [task, { ...task, id: "other" }],
    threadMetadata: new Map([
      ["t", record()],
      ["other", record({ taskId: "other", pinned: true })],
    ]),
  };
  const h = await harness({ snapshots: [withTarget] });
  h.gateway.getThreadMetadata.mockImplementation(async ({ taskId }: { taskId: string }) =>
    record({ taskId, pinned: taskId === "other" }),
  );
  let settle!: () => void;
  h.gateway.updateThreadMetadata.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = h
      .current()
      .reorder(
        view.thread.threadId,
        view.thread.threadId.replace(/t$/, "other"),
        "before",
        "pinned",
      );
  });
  await h.snapshots([
    {
      ...withTarget,
      threadMetadata: new Map([
        ["t", record()],
        ["other", record({ taskId: "other" })],
      ]),
    },
  ]);
  settle();
  await pending;
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(1);
  expect(h.gateway.reorderThread).not.toHaveBeenCalled();
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining("section was saved"));
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("refreshes the inventory once after a batch of saves instead of after every save", async () => {
  const h = await harness();
  let outcomes: ReadonlyArray<boolean> = [];
  await act(async () => {
    outcomes = await h.current().batch(async () => {
      const first = await h.current().update(view.thread.threadId, { archived: true });
      const second = await h.current().update(view.thread.threadId, { pinned: true });
      expect(h.refresh).not.toHaveBeenCalled();
      return [first, second];
    });
  });
  expect(outcomes).toEqual([true, true]);
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(2);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  await act(async () => h.current().update(view.thread.threadId, { pinned: false }));
  expect(h.refresh).toHaveBeenCalledTimes(2);
});
it("skips the deferred batch refresh when the owner changed during the batch", async () => {
  const h = await harness();
  await act(async () => {
    await h.current().batch(async () => {
      await h.current().update(view.thread.threadId, { archived: true });
      await h.replaceOwner();
    });
  });
  expect(h.refresh).not.toHaveBeenCalled();
});
it("reports unread only for threads with a stored view marker on a capable server", async () => {
  const finished = { ...view.thread, viewedAtEpochMs: null };
  const untracked = await harness();
  expect(untracked.current().project({ ...view, thread: finished })?.unread).toBe(false);

  const legacyOnly = await harness({
    snapshots: [snapshot(record(), true, false)],
    repository: {
      load: () => [{ threadId: view.thread.threadId, viewedAtEpochMs: 1 }],
      save: vi.fn(),
    },
  });
  const unsupported = legacyOnly.current().project(view);
  expect(unsupported?.unread).toBe(false);
  expect(unsupported?.attention).toBe("settled");

  const tracked = await harness({
    snapshots: [snapshot(record({ revision: 3, viewedAtEpochMs: 1 }))],
  });
  expect(tracked.current().project(view)?.unread).toBe(true);
  const seen = await harness({
    snapshots: [snapshot(record({ revision: 3, viewedAtEpochMs: view.thread.updatedAtEpochMs }))],
  });
  expect(seen.current().project(view)?.unread).toBe(false);
});
it("coalesces view marks that arrive while a save is in flight and never warns about them", async () => {
  const h = await harness();
  let settle!: () => void;
  h.gateway.updateThreadMetadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = () => resolve(record({ revision: 1 }));
      }),
  );
  let first!: Promise<boolean>;
  await act(async () => {
    first = h.current().update(view.thread.threadId, { viewedAtEpochMs: 10 });
  });
  await act(async () => {
    await h.current().update(view.thread.threadId, { viewedAtEpochMs: 30 });
    await h.current().update(view.thread.threadId, { viewedAtEpochMs: 20 });
  });
  expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(1);
  await act(async () => {
    settle();
    await first;
  });
  await vi.waitFor(() => expect(h.gateway.updateThreadMetadata).toHaveBeenCalledTimes(2));
  expect(h.gateway.updateThreadMetadata.mock.calls[1]?.[0].patch).toMatchObject({
    viewedAtEpochMs: 30,
  });
  expect(h.report).not.toHaveBeenCalled();
});
it("never warns when a view mark cannot be stored on an unsupported server", async () => {
  const h = await harness({ snapshots: [snapshot(record(), true, false)] });
  await act(async () => h.current().update(view.thread.threadId, { viewedAtEpochMs: 5 }));
  expect(h.report).not.toHaveBeenCalled();
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
});
it("skips a view mark the server already recorded at a later time", async () => {
  const h = await harness();
  h.gateway.getThreadMetadata.mockResolvedValueOnce(record({ revision: 2, viewedAtEpochMs: 50 }));
  let saved = false;
  await act(async () => {
    saved = await h.current().update(view.thread.threadId, { viewedAtEpochMs: 40 });
  });
  expect(saved).toBe(true);
  expect(h.gateway.updateThreadMetadata).not.toHaveBeenCalled();
});
it("makes a save wait for a free slot instead of failing when the budget is exhausted", async () => {
  const ids = ["t1", "t2", "t3", "t4", "t5"];
  const tasks = ids.map((id, index) => ({ ...task, id, sequence: index + 1 }));
  const many = {
    ...snapshot(),
    tasks,
    threadMetadata: new Map(ids.map((id) => [id, record({ taskId: id })])),
  };
  const h = await harness({ snapshots: [many] });
  const releases: Array<() => void> = [];
  h.gateway.updateThreadMetadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(() => resolve(record({ revision: 1 })));
      }),
  );
  const key = (id: string) => remoteAgentThreadKey("s", "r", id);
  const saves: Promise<boolean>[] = [];
  await act(async () => {
    for (const id of ids) saves.push(h.current().update(key(id), { archived: true }));
    await vi.waitFor(() => expect(releases).toHaveLength(4));
  });
  expect(h.report).not.toHaveBeenCalled();
  await act(async () => {
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(5));
    for (const release of releases.slice(1)) release();
  });
  expect(await Promise.all(saves)).toEqual([true, true, true, true, true]);
  expect(h.report).not.toHaveBeenCalled();
});
