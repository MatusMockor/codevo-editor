// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
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
  let pending!: Promise<void>;
  await act(async () => {
    pending = h.current().update(view.thread.threadId, { pinned: true });
  });
  await h.current().update(view.thread.threadId, { archived: true });
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
  await expect(h.current().update(view.thread.threadId, { pinned: true })).resolves.toBeUndefined();
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
