// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import type {
  RemoteThreadMetadata,
  RemoteThreadMetadataPage,
} from "../domain/remoteThreadMetadata";
import { MAX_UNCONFIRMED_THREAD_METADATA } from "./remoteThreadMetadataInventory";
import {
  useRemoteAgentInventory,
  type RemoteAgentInventorySurface,
} from "./useRemoteAgentInventory";
const server: RemoteRunnerServer = {
  id: "server",
  host: "host",
  username: "user",
  port: 22,
  name: "Server",
  connected: true,
};
const task = {
  id: "task",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  parts: [],
  createdAt: "date",
};
const descriptor = { runnerId: "runner", capabilities: { taskExecution: true, eventReplay: true } };
const other: RemoteRunnerServer = { ...server, id: "other", host: "other-host", name: "Other" };
const managed = {
  runnerId: "runner",
  capabilities: { taskExecution: true, eventReplay: true, threadManagement: true },
};
const record = (change: Partial<RemoteThreadMetadata> = {}): RemoteThreadMetadata => ({
  taskId: "task",
  revision: 1,
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
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
async function setup(
  runner: typeof descriptor = descriptor,
  configured: readonly RemoteRunnerServer[] = [server],
) {
  const gateway = {
    getRunner: vi.fn().mockResolvedValue(runner),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTasks: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items: after === 0 ? [task] : [],
      nextCursor: null,
    })),
    listThreadMetadata: vi
      .fn<() => Promise<RemoteThreadMetadataPage>>()
      .mockResolvedValue({ items: [record()], nextAfter: null }),
  };
  let surface: RemoteAgentInventorySurface;
  const root = createRoot(document.createElement("div"));
  function Harness({ owner, servers }: { owner: string; servers: readonly RemoteRunnerServer[] }) {
    surface = useRemoteAgentInventory({
      gateway: gateway as unknown as RemoteRunnerGateway,
      servers,
      workspaceOwner: owner,
      selectedThreadId: null,
    });
    return null;
  }
  const render = async (owner = "A", servers: readonly RemoteRunnerServer[] = configured) => {
    await act(async () => {
      root.render(createElement(Harness, { owner, servers }));
    });
  };
  disposers.push(() => act(() => root.unmount()));
  await render();
  return {
    gateway,
    render,
    get surface() {
      return surface!;
    },
  };
}
it("retains disconnected history, removes deleted servers, and revokes host replacement", async () => {
  const h = await setup();
  expect(h.surface.snapshots[0]?.connected).toBe(true);
  await h.render("A", [{ ...server, connected: false }]);
  expect(h.surface.snapshots[0]?.tasks).toHaveLength(1);
  expect(h.surface.snapshots[0]?.connected).toBe(false);
  h.gateway.getRunner.mockRejectedValue(new Error("Unavailable"));
  await h.render("A", [{ ...server, host: "other" }]);
  expect(h.surface.snapshots[0]?.connected).toBe(false);
  await h.render("A", []);
  expect(h.surface.snapshots).toHaveLength(0);
});
it("rejects late reads across A to B to A workspace ownership", async () => {
  const h = await setup();
  let resolve: ((value: typeof descriptor) => void) | undefined;
  h.gateway.getRunner.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let pending: Promise<void>;
  await act(async () => {
    pending = h.surface.refresh();
  });
  await h.render("B");
  await h.render("A");
  const before = h.surface.snapshots;
  await act(async () => {
    resolve?.(descriptor);
    await pending;
  });
  expect(h.surface.snapshots).toEqual(before);
});
it("preserves a task published while inventory refresh is pending", async () => {
  const h = await setup();
  let resolve: ((value: { items: never[]; nextCursor: null }) => void) | undefined;
  h.gateway.listTasks.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let pending: Promise<void>;
  await act(async () => {
    pending = h.surface.refresh();
  });
  await act(async () => {
    h.surface.publishTask("server", {
      ...task,
      id: "new",
      sequence: 2,
      provider: "claude",
      status: "queued",
    });
  });
  await act(async () => {
    resolve?.({ items: [], nextCursor: null });
    await pending;
  });
  expect(h.surface.snapshots[0]?.tasks.map((item) => item.id)).toEqual(["new", "task"]);
});

it("does not overwrite acknowledged queue mutations with an older inventory read", async () => {
  const h = await setup();
  let resolve!: (value: { items: never[]; nextCursor: null }) => void;
  h.gateway.listTasks.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = h.surface.refresh();
  });
  const item = {
    id: "pending",
    conversationId: "task",
    status: "queued" as const,
    parts: [{ type: "text" as const, text: "Next" }],
    createdAt: "2026-09-15T00:00:00Z",
    taskId: null,
  };
  await act(async () => {
    h.surface.publishPending("server", "thread", [item]);
  });
  await act(async () => {
    resolve({ items: [], nextCursor: null });
    await refreshing;
  });
  expect(h.surface.snapshots[0]?.pendingMessages?.get("thread")).toEqual([item]);
});

function suspendListing(h: Awaited<ReturnType<typeof setup>>) {
  const listing = {
    land: (_page: RemoteThreadMetadataPage): void => undefined,
    fail: (_error: Error): void => undefined,
  };
  h.gateway.listThreadMetadata.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        listing.land = resolve;
        listing.fail = reject;
      }),
  );
  return listing;
}
const page = (...items: RemoteThreadMetadata[]): RemoteThreadMetadataPage => ({
  items,
  nextAfter: null,
});
const metadataOf = (h: Awaited<ReturnType<typeof setup>>, serverId = "server") =>
  h.surface.snapshots.find((item) => item.serverId === serverId)?.threadMetadata;

it("publishes saved thread metadata into the cached snapshot without a reload", async () => {
  const h = await setup(managed);
  const before = h.surface.snapshots[0];
  const calls = h.gateway.getRunner.mock.calls.length;
  const saved = record({ revision: 2, pinned: true });
  let applied = false;
  await act(async () => {
    applied = h.surface.publishThreadMetadata("server", saved);
  });
  expect(applied).toBe(true);
  expect(metadataOf(h)?.get("task")).toBe(saved);
  expect(before?.threadMetadata?.get("task")).toEqual(record());
  expect(h.surface.snapshots[0]?.tasks).toEqual(before?.tasks);
  expect(h.gateway.getRunner).toHaveBeenCalledTimes(calls);
  expect(h.gateway.listThreadMetadata).toHaveBeenCalledTimes(1);
});

it("reports an equal or lower revision as already current and never lowers the cache", async () => {
  const h = await setup(managed);
  await act(async () => {
    h.surface.publishThreadMetadata("server", record({ revision: 3, pinned: true }));
  });
  const current = h.surface.snapshots;
  const outcomes: boolean[] = [];
  await act(async () => {
    outcomes.push(
      h.surface.publishThreadMetadata("server", record({ revision: 3, archived: true })),
      h.surface.publishThreadMetadata("server", record({ revision: 2, archived: true })),
    );
  });
  expect(outcomes).toEqual([true, true]);
  expect(metadataOf(h)?.get("task")).toEqual(record({ revision: 3, pinned: true }));
  expect(h.surface.snapshots[0]).toBe(current[0]);
});

it("reports thread metadata for an unknown conversation or server as not applied", async () => {
  const h = await setup(managed);
  const current = h.surface.snapshots;
  const outcomes: boolean[] = [];
  await act(async () => {
    outcomes.push(
      h.surface.publishThreadMetadata("server", record({ taskId: "foreign", revision: 9 })),
      h.surface.publishThreadMetadata("other", record({ revision: 9 })),
    );
  });
  expect(outcomes).toEqual([false, false]);
  expect(h.surface.snapshots[0]).toBe(current[0]);
  expect(metadataOf(h)?.has("foreign")).toBe(false);
  expect(h.surface.snapshots).toHaveLength(1);
});

it("reports thread metadata as not applied before the runner is identified", async () => {
  const h = await setup(managed);
  h.gateway.getRunner.mockRejectedValue(new Error("Unavailable"));
  await h.render("B");
  expect(h.surface.snapshots[0]?.descriptor).toBeNull();
  let applied = true;
  await act(async () => {
    applied = h.surface.publishThreadMetadata("server", record({ revision: 2 }));
  });
  expect(applied).toBe(false);
  expect(metadataOf(h)).toBeUndefined();
});

it("rejects thread metadata published by a replaced owner across A to B to A", async () => {
  const h = await setup(managed);
  const stale = h.surface.publishThreadMetadata;
  const outcomes: boolean[] = [];
  await h.render("B");
  await act(async () => {
    outcomes.push(stale("server", record({ revision: 9, pinned: true })));
  });
  expect(metadataOf(h)?.get("task")).toEqual(record());
  await h.render("A");
  await act(async () => {
    outcomes.push(stale("server", record({ revision: 9, pinned: true })));
  });
  expect(metadataOf(h)?.get("task")).toEqual(record());
  await act(async () => {
    outcomes.push(h.surface.publishThreadMetadata("server", record({ revision: 2, pinned: true })));
  });
  expect(outcomes).toEqual([false, false, true]);
  expect(metadataOf(h)?.get("task")?.revision).toBe(2);
});

it("does not let a reload that predates a save overwrite the published revision", async () => {
  const h = await setup(managed);
  const listing = suspendListing(h);
  let reloading!: Promise<void>;
  await act(async () => {
    reloading = h.surface.refresh();
  });
  const saved = record({ revision: 2, removed: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  await act(async () => {
    listing.land(page(record()));
    await reloading;
  });
  expect(metadataOf(h)?.get("task")).toBe(saved);

  const newer = record({ revision: 3 });
  h.gateway.listThreadMetadata.mockResolvedValueOnce(page(newer));
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toBe(newer);
});

it("keeps a first saved record until the server lists it and then follows the server", async () => {
  const h = await setup(managed);
  h.gateway.listThreadMetadata.mockResolvedValue(page());
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.size).toBe(0);
  const listing = suspendListing(h);
  let reloading!: Promise<void>;
  await act(async () => {
    reloading = h.surface.refresh();
  });
  const saved = record({ revision: 1, removed: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  await act(async () => {
    listing.land(page());
    await reloading;
  });
  expect(metadataOf(h)?.get("task")).toBe(saved);

  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toBe(saved);

  const listed = record({ revision: 1, removed: true });
  h.gateway.listThreadMetadata.mockResolvedValueOnce(page(listed));
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toBe(listed);

  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.has("task")).toBe(false);
});

it("keeps a published record when the reload it raced with fails", async () => {
  const h = await setup(managed);
  const listing = suspendListing(h);
  let reloading!: Promise<void>;
  await act(async () => {
    reloading = h.surface.refresh();
  });
  const saved = record({ revision: 2, pinned: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  await act(async () => {
    listing.fail(new Error("Runner request failed (HTTP 503)."));
    await reloading;
  });
  expect(h.surface.snapshots[0]?.connected).toBe(false);
  expect(h.surface.snapshots[0]?.error).toBe("Runner request failed (HTTP 503).");
  expect(metadataOf(h)?.get("task")).toBe(saved);

  await act(async () => h.surface.refresh());
  expect(h.surface.snapshots[0]?.connected).toBe(true);
  expect(metadataOf(h)?.get("task")).toBe(saved);

  const listed = record({ revision: 2, pinned: true });
  h.gateway.listThreadMetadata.mockResolvedValueOnce(page(listed));
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toBe(listed);
});

it("does not treat a failed reload as confirmation of an earlier published record", async () => {
  const h = await setup(managed);
  const saved = record({ revision: 2, pinned: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  h.gateway.getRunner.mockRejectedValueOnce(new Error("Unavailable"));
  await act(async () => h.surface.refresh());
  expect(h.surface.snapshots[0]?.error).toBe("Unavailable");
  expect(metadataOf(h)?.get("task")).toBe(saved);

  await act(async () => h.surface.refresh());
  expect(h.surface.snapshots[0]?.error).toBeNull();
  expect(metadataOf(h)?.get("task")).toBe(saved);
});

it("keeps a reload of one server and a publish to another server independent", async () => {
  const h = await setup(managed, [server, other]);
  expect(metadataOf(h, "server")?.get("task")).toEqual(record());
  expect(metadataOf(h, "other")?.get("task")).toEqual(record());
  const first = suspendListing(h);
  let reloading!: Promise<void>;
  await act(async () => {
    reloading = h.surface.refresh();
  });
  expect(h.gateway.listThreadMetadata).toHaveBeenLastCalledWith({ serverId: "server" });
  const saved = record({ revision: 2, pinned: true });
  let applied = false;
  await act(async () => {
    applied = h.surface.publishThreadMetadata("other", saved);
  });
  expect(applied).toBe(true);
  expect(metadataOf(h, "other")?.get("task")).toBe(saved);
  expect(metadataOf(h, "server")?.get("task")).toEqual(record());

  const second = suspendListing(h);
  await act(async () => {
    first.land(page());
  });
  expect(h.gateway.listThreadMetadata).toHaveBeenLastCalledWith({ serverId: "other" });
  expect(metadataOf(h, "server")?.size).toBe(0);
  expect(metadataOf(h, "other")?.get("task")).toBe(saved);

  await act(async () => {
    second.land(page(record()));
    await reloading;
  });
  expect(metadataOf(h, "server")?.size).toBe(0);
  expect(metadataOf(h, "other")?.get("task")).toBe(saved);

  const listed = record({ revision: 2, pinned: true });
  h.gateway.listThreadMetadata
    .mockResolvedValueOnce(page(record({ revision: 4 })))
    .mockResolvedValueOnce(page(listed));
  await act(async () => h.surface.refresh());
  expect(metadataOf(h, "server")?.get("task")).toEqual(record({ revision: 4 }));
  expect(metadataOf(h, "other")?.get("task")).toBe(listed);
});

it.each([
  ["the same revision", record({ revision: 2, title: "Server" }), "server"],
  ["a newer revision", record({ revision: 3, title: "Server" }), "server"],
  ["an older revision", record({ revision: 1, title: "Server" }), "published"],
] as const)(
  "ends a coalesced reload after a publish with the right record when the server lists %s",
  async (_name, listed, winner) => {
    const h = await setup(managed);
    const passes = h.gateway.getRunner.mock.calls.length;
    const listing = suspendListing(h);
    let reloading!: Promise<void>;
    let coalesced!: Promise<void>;
    await act(async () => {
      reloading = h.surface.refresh();
    });
    await act(async () => {
      coalesced = h.surface.refresh();
    });
    const saved = record({ revision: 2, pinned: true });
    await act(async () => {
      h.surface.publishThreadMetadata("server", saved);
    });
    h.gateway.listThreadMetadata.mockResolvedValueOnce(page(listed));
    await act(async () => {
      listing.land(page(record()));
      await reloading;
      await coalesced;
    });
    expect(h.gateway.getRunner).toHaveBeenCalledTimes(passes + 2);
    expect(metadataOf(h)?.get("task")).toBe(winner === "server" ? listed : saved);
  },
);

it("refuses a new conversation once every unconfirmed slot is taken and frees slots on confirmation", async () => {
  const h = await setup(managed);
  const total = MAX_UNCONFIRMED_THREAD_METADATA + 1;
  h.gateway.listTasks.mockImplementation(async ({ after }: { after: number }) => {
    const items = Array.from({ length: Math.min(64, total - after) }, (_, item) => ({
      ...task,
      id: `task-${after + item + 1}`,
      sequence: after + item + 1,
    }));
    const last = after + items.length;
    return { items, nextCursor: last < total ? last : null };
  });
  h.gateway.listThreadMetadata.mockResolvedValue(page());
  await act(async () => h.surface.refresh());
  expect(h.surface.snapshots[0]?.tasks).toHaveLength(total);
  expect(metadataOf(h)?.size).toBe(0);
  const ids = ["task", ...Array.from({ length: total - 1 }, (_, item) => `task-${item + 2}`)];
  const refused = ids[total - 1]!;
  const outcomes: boolean[] = [];
  await act(async () => {
    for (const taskId of ids)
      outcomes.push(
        h.surface.publishThreadMetadata("server", record({ taskId, revision: 1, pinned: true })),
      );
  });
  expect(outcomes.slice(0, MAX_UNCONFIRMED_THREAD_METADATA).every((applied) => applied)).toBe(true);
  expect(outcomes[MAX_UNCONFIRMED_THREAD_METADATA]).toBe(false);
  expect(metadataOf(h)?.size).toBe(MAX_UNCONFIRMED_THREAD_METADATA);
  expect(metadataOf(h)?.has(refused)).toBe(false);
  expect(metadataOf(h)?.get("task")).toEqual(record({ revision: 1, pinned: true }));

  const newer = record({ revision: 2, archived: true });
  const later: boolean[] = [];
  await act(async () => {
    later.push(
      h.surface.publishThreadMetadata("server", newer),
      h.surface.publishThreadMetadata("server", record({ taskId: refused, revision: 1 })),
    );
  });
  expect(later).toEqual([true, false]);
  expect(metadataOf(h)?.get("task")).toBe(newer);
  expect(metadataOf(h)?.size).toBe(MAX_UNCONFIRMED_THREAD_METADATA);

  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.size).toBe(MAX_UNCONFIRMED_THREAD_METADATA);
  expect(metadataOf(h)?.get("task")).toBe(newer);
  expect(metadataOf(h)?.get("task-2")).toEqual(
    record({ taskId: "task-2", revision: 1, pinned: true }),
  );

  h.gateway.listThreadMetadata.mockResolvedValueOnce(page(record({ revision: 2, archived: true })));
  await act(async () => h.surface.refresh());
  const admitted = record({ taskId: refused, revision: 1, pinned: true });
  let applied = false;
  await act(async () => {
    applied = h.surface.publishThreadMetadata("server", admitted);
  });
  expect(applied).toBe(true);
  expect(metadataOf(h)?.get(refused)).toBe(admitted);
  expect(metadataOf(h)?.size).toBe(total);
});

it("discards an unconfirmed record when the server keeps its id but changes its endpoint", async () => {
  const h = await setup(managed);
  const saved = record({ revision: 2, pinned: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toBe(saved);

  await h.render("A", [{ ...server, host: "replacement" }]);
  expect(h.surface.snapshots[0]?.connected).toBe(true);
  expect(metadataOf(h)?.get("task")).toEqual(record());

  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toEqual(record());
});

it("does not resurrect an unconfirmed record after the last server is removed and added back", async () => {
  const h = await setup(managed);
  const saved = record({ revision: 2, removed: true });
  await act(async () => {
    h.surface.publishThreadMetadata("server", saved);
  });
  expect(metadataOf(h)?.get("task")).toBe(saved);

  await h.render("A", []);
  expect(h.surface.snapshots).toHaveLength(0);
  let applied = true;
  await act(async () => {
    applied = h.surface.publishThreadMetadata("server", record({ revision: 3, removed: true }));
  });
  expect(applied).toBe(false);

  await h.render("A", [server]);
  expect(h.surface.snapshots[0]?.connected).toBe(true);
  expect(metadataOf(h)?.get("task")).toEqual(record());
  await act(async () => h.surface.refresh());
  expect(metadataOf(h)?.get("task")).toEqual(record());
});
