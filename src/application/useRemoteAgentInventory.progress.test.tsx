// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
  RemoteRunnerInventoryEvent,
  RemoteRunnerServer,
} from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  emitStreamTurn,
  fakeRunnerGateway,
  lastOf,
  loadUntilSettled,
  projectedTurn,
  projectedTurns,
  remoteTurn,
  replayState,
  TAIL_FIRST_THREAD,
} from "./remoteAgentTailFirstTestSupport";
import {
  MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS,
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
} from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";
import { REMOTE_INVENTORY_PROGRESS_INTERVAL_MS } from "./remoteInventoryProgress";
import { REMOTE_INVENTORY_CONTINUATION_DELAY_MS } from "./remoteInventoryRefresh";
import {
  useRemoteAgentInventory,
  type RemoteAgentInventorySurface,
} from "./useRemoteAgentInventory";

const TAIL = Number.MAX_SAFE_INTEGER;
const SERVER: RemoteRunnerServer = {
  id: "server",
  host: "host",
  username: "user",
  port: 22,
  name: "Server",
  connected: true,
};

interface Props {
  readonly owner: string;
  readonly servers: readonly RemoteRunnerServer[];
  readonly selectedThreadId: string | null;
}

const disposers: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

function longTurn(runner: FakeRunnerEvents, taskId: string): void {
  emitStreamTurn(runner, taskId, { lines: 300 });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function mount(h: ReturnType<typeof fakeRunnerGateway>) {
  let surface!: RemoteAgentInventorySurface;
  const published: RemoteAgentInventorySnapshot[] = [];
  const root = createRoot(document.createElement("div"));
  function Harness({ owner, servers, selectedThreadId }: Props) {
    surface = useRemoteAgentInventory({
      gateway: h.gateway,
      servers,
      workspaceOwner: owner,
      selectedThreadId,
    });
    const snapshot = surface.snapshots[0];
    if (snapshot !== undefined && lastOf(published) !== snapshot) published.push(snapshot);
    return null;
  }
  const render = async (change: Partial<Props> = {}) => {
    const props = { owner: "A", servers: [SERVER], selectedThreadId: TAIL_FIRST_THREAD, ...change };
    await act(async () => {
      root.render(createElement(Harness, props));
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const unmount = () => act(() => root.unmount());
  disposers.push(unmount);
  return {
    render,
    unmount,
    published,
    get surface() {
      return surface;
    },
    get snapshot() {
      return surface.snapshots[0];
    },
  };
}

function gatedBackwardPages(h: ReturnType<typeof fakeRunnerGateway>, runner: FakeRunnerEvents) {
  const waiting: { request: RemoteRunnerEventsBeforeRequest; release(): void }[] = [];
  h.calls.listEventsBefore.mockImplementation(
    (request: RemoteRunnerEventsBeforeRequest) =>
      new Promise<RemoteRunnerEventPage>((resolve) => {
        waiting.push({ request, release: () => resolve(runner.listEventsBefore(request)) });
      }),
  );
  return {
    waiting,
    release: async () => {
      const next = waiting.shift();
      await act(async () => {
        next?.release();
        await vi.advanceTimersByTimeAsync(0);
      });
      return next?.request;
    },
  };
}

it("publishes the tasks and then the newest tail at once while older turns are still loading", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  longTurn(runner, "turn-2");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();

  expect(pages.waiting.map((entry) => entry.request)).toEqual([
    { serverId: "server", taskId: "turn-2", before: TAIL },
  ]);
  expect(view.snapshot?.tasks.map((task) => task.id)).toEqual(["turn-2", "turn-1"]);
  expect(view.snapshot?.replays.size).toBe(0);
  expect([...(view.snapshot?.replayTruncated ?? [])]).toEqual(["turn-2", "turn-1"]);
  expect(view.snapshot?.connected).toBe(true);
  expect(view.surface.loading).toBe(true);

  await pages.release();
  const tail = runner.eventsOf("turn-2").slice(-50);

  expect(pages.waiting.map((entry) => entry.request)).toEqual([
    { serverId: "server", taskId: "turn-1", before: TAIL },
  ]);
  expect(h.forward()).toEqual([]);
  expect(view.snapshot?.replays.get("turn-2")).toEqual(tail);
  expect(view.snapshot?.replayCursors?.get("turn-2")).toBe(lastOf(tail)?.sequence);
  expect(view.snapshot?.replayTruncated.has("turn-2")).toBe(true);
  expect(view.snapshot?.replays.has("turn-1")).toBe(false);
  expect(view.snapshot?.connected).toBe(true);
  expect(view.snapshot?.error).toBeNull();
  expect(view.surface.reachability.get("server")).toEqual({ kind: "reachable" });
  expect(view.surface.loading).toBe(true);
  expect(view.published).toHaveLength(2);
});

it("coalesces the publications of a pass by time and always ends with the latest snapshot", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  longTurn(runner, "turn-2");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();
  await pages.release();
  expect(view.published).toHaveLength(2);

  await pages.release();
  await pages.release();
  await pages.release();
  expect(view.published).toHaveLength(2);
  expect(view.snapshot?.replays.has("turn-1")).toBe(false);

  await advance(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS - 1);
  expect(view.published).toHaveLength(2);
  await advance(1);
  expect(view.published).toHaveLength(3);
  expect(view.snapshot?.replays.get("turn-2")).toHaveLength(150);
  expect(view.snapshot?.replays.get("turn-1")).toHaveLength(50);

  await pages.release();
  await pages.release();
  expect(view.published).toHaveLength(3);
  await advance(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
  expect(view.published).toHaveLength(4);

  await advance(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
  await pages.release();
  expect(view.published).toHaveLength(5);

  for (let page = 0; page < 40 && pages.waiting.length > 0; page += 1) await pages.release();

  expect(view.surface.loading).toBe(false);
  expect(view.published).toHaveLength(6);
  expect(view.snapshot?.replays.get("turn-2")).toEqual(runner.eventsOf("turn-2"));
  expect(view.snapshot?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
  expect(view.snapshot?.replayTruncated.size).toBe(0);
  expect(view.snapshot?.resumes.get("turn-2")).toEqual({ available: true, reason: null });
});

it("keeps the published replay and its cursors when a later request fails", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  longTurn(runner, "turn-2");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
  h.calls.listEventsBefore.mockImplementation(async (request: RemoteRunnerEventsBeforeRequest) => {
    if (h.backward().length === 4) return Promise.reject(new Error("Request timed out."));
    return runner.listEventsBefore(request);
  });
  const view = mount(h);

  await view.render();
  const newest = runner.eventsOf("turn-2");

  expect(view.surface.loading).toBe(false);
  expect(view.snapshot?.replays.get("turn-2")).toEqual(newest.slice(-100));
  expect(view.snapshot?.replayCursors?.get("turn-2")).toBe(lastOf(newest)?.sequence);
  expect(view.snapshot?.replayBackfill?.get("turn-2")).toMatchObject({
    kind: "pending",
    before: newest[newest.length - 100]!.sequence,
  });
  expect(view.snapshot?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1").slice(-50));
  expect(view.snapshot?.error).toContain("Request timed out.");

  h.calls.listEventsBefore.mockClear();
  h.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
  expect(h.backward()).toEqual([]);
  await advance(2_000 - REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

  expect(h.backward()[0]).toEqual({
    serverId: "server",
    taskId: "turn-2",
    before: newest[newest.length - 100]!.sequence,
  });
  expect(h.forward()).toEqual([]);
  expect(view.snapshot?.replays.get("turn-2")).toEqual(newest);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
  expect(view.snapshot?.replayTruncated.size).toBe(0);
  expect(view.snapshot?.connected).toBe(true);
  expect(view.snapshot?.error).toBeNull();
});

it("runs the next pass promptly while a backfill is unfinished and then returns to polling", async () => {
  const runner = new FakeRunnerEvents(10);
  emitStreamTurn(runner, "turn-1", { lines: 600 });
  const all = runner.eventsOf("turn-1");
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const view = mount(h);

  await view.render();

  expect(h.calls.getRunner).toHaveBeenCalledTimes(1);
  expect(h.backward()).toHaveLength(1 + MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(all.slice(-250));
  expect(view.snapshot?.replayTruncated.has("turn-1")).toBe(true);

  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS - 1);
  expect(h.calls.getRunner).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(h.calls.getRunner).toHaveBeenCalledTimes(2);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(all.slice(-490));

  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
  expect(h.calls.getRunner).toHaveBeenCalledTimes(3);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(all);
  expect(view.snapshot?.replayTruncated.size).toBe(0);

  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
  expect(h.calls.getRunner).toHaveBeenCalledTimes(3);
  await advance(2_000);
  expect(h.calls.getRunner).toHaveBeenCalledTimes(4);
});

it("never publishes the late backfill page of a deselected thread into the selected one", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  longTurn(runner, "turn-9");
  const otherTurn = { ...remoteTurn(1), id: "turn-9", sequence: 9, conversationId: "turn-9" };
  const otherThread = remoteAgentThreadKey("server", "runner", "turn-9");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), otherTurn]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();
  await pages.release();
  await pages.release();
  const stale = pages.waiting.shift()!;

  expect(stale.request.taskId).toBe("turn-1");
  expect(stale.request.before).not.toBe(TAIL);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1").slice(-50));

  h.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
  await view.render({ selectedThreadId: otherThread });
  const selected = view.snapshot;
  const count = view.published.length;

  expect(view.surface.loading).toBe(false);
  expect(selected?.replays.get("turn-9")).toEqual(runner.eventsOf("turn-9"));
  expect(selected?.replays.has("turn-1")).toBe(false);

  await act(async () => {
    stale.release();
    await vi.advanceTimersByTimeAsync(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
  });

  expect(view.snapshot).toBe(selected);
  expect(view.published).toHaveLength(count);
});

it("drops a backfill page that arrives after the workspace owner was replaced and restored", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();
  await pages.release();
  const stale = pages.waiting.shift()!;
  h.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
  await view.render({ owner: "B" });
  await view.render({ owner: "A" });
  const restored = view.snapshot;
  const count = view.published.length;

  expect(stale.request.before).not.toBe(TAIL);
  expect(restored?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));

  await act(async () => {
    stale.release();
    await vi.advanceTimersByTimeAsync(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
  });

  expect(view.snapshot).toBe(restored);
  expect(view.published).toHaveLength(count);
});

it("keeps the loaded replay and ignores the pending page when the server disconnects mid-backfill", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();
  await pages.release();
  const pending = pages.waiting.shift()!;
  const tail = runner.eventsOf("turn-1").slice(-50);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(tail);

  await view.render({ servers: [{ ...SERVER, connected: false }] });

  expect(view.snapshot?.connected).toBe(false);
  expect(view.snapshot?.replays.get("turn-1")).toEqual(tail);
  expect(view.surface.reachability.get("server")).toEqual({
    kind: "disconnected",
    reason: "serverDisconnected",
  });

  await act(async () => {
    pending.release();
    await vi.advanceTimersByTimeAsync(REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
  });

  expect(view.snapshot?.replays.get("turn-1")).toEqual(tail);
  expect(view.snapshot?.connected).toBe(false);
});

it("cancels a coalesced publication when it unmounts", async () => {
  const runner = new FakeRunnerEvents();
  longTurn(runner, "turn-1");
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const pages = gatedBackwardPages(h, runner);
  const view = mount(h);

  await view.render();
  await pages.release();
  await pages.release();
  expect(vi.getTimerCount()).toBe(1);

  disposers.splice(0);
  await view.unmount();

  expect(vi.getTimerCount()).toBe(0);
});

it("continues after the global backward budget and resumes the exact stored cursors", async () => {
  const runner = new FakeRunnerEvents(10);
  for (const index of [1, 2, 3])
    for (let event = 0; event < 800; event += 1) runner.output(`turn-${index}`, "");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);
  const view = mount(h);

  await view.render();
  const first = view.snapshot!;
  const reads = h.backward().length;

  expect(reads).toBe(3 + MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS);
  expect(view.surface.loading).toBe(false);
  expect(first.replays.get("turn-1")).toHaveLength(10);
  expect(first.replays.get("turn-2")).toHaveLength(250);
  expect(first.replays.get("turn-3")).toHaveLength(250);
  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS - 1);
  expect(h.backward()).toHaveLength(reads);
  await advance(1);

  expect(h.calls.getRunner).toHaveBeenCalledTimes(2);
  const resumed = h.backward().slice(reads);
  expect(resumed).toHaveLength(MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS);
  for (const taskId of ["turn-3", "turn-2"]) {
    const stored = first.replayBackfill?.get(taskId);
    expect(stored?.kind).toBe("pending");
    expect(resumed.find((request) => request.taskId === taskId)?.before).toBe(
      stored?.kind === "pending" ? stored.before : undefined,
    );
    expect(view.snapshot?.replays.get(taskId)).toHaveLength(490);
  }
  expect(view.snapshot?.replays.get("turn-1")).toEqual(first.replays.get("turn-1"));
  const requested = h.backward().map((request) => `${request.taskId}:${request.before}`);
  expect(new Set(requested).size).toBe(requested.length);
});

it("backs off repeated failures without returning to continuation when no page advances", async () => {
  const runner = new FakeRunnerEvents(10);
  for (const index of [1, 2, 3])
    for (let event = 0; event < 800; event += 1) runner.output(`turn-${index}`, "");
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);
  Object.assign(h.gateway, {
    watchInventory: async (
      _request: { readonly serverId: string },
      listener: (event: RemoteRunnerInventoryEvent) => void,
    ) => {
      listener({ type: "connected" });
      return vi.fn();
    },
  });
  const view = mount(h);

  await view.render();
  const beforeFailure = view.snapshot!;
  const pending = beforeFailure.replayBackfill?.get("turn-3");
  const successfulReads = h.backward().length;
  expect(pending?.kind).toBe("pending");
  h.calls.listEventsBefore.mockRejectedValue(new Error("Request timed out."));
  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

  expect(h.backward()).toHaveLength(successfulReads + 1);
  expect(view.surface.loading).toBe(false);
  expect(view.snapshot?.replayBackfill).toEqual(beforeFailure.replayBackfill);
  expect(view.snapshot?.replays).toEqual(beforeFailure.replays);
  for (const delay of [2_000, 4_000, 8_000]) {
    const count = h.backward().length;
    await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
    expect(h.backward()).toHaveLength(count);
    await advance(delay - REMOTE_INVENTORY_CONTINUATION_DELAY_MS - 1);
    expect(h.backward()).toHaveLength(count);
    await advance(1);
    expect(h.backward()).toHaveLength(count + 1);
    expect(lastOf(h.backward())?.before).toBe(
      pending?.kind === "pending" ? pending.before : undefined,
    );
    expect(view.snapshot?.replayBackfill).toEqual(beforeFailure.replayBackfill);
    expect(view.snapshot?.replays).toEqual(beforeFailure.replays);
  }
});

it.each([
  { phase: "pending", capability: "runner" },
  { phase: "pending", capability: "gateway" },
  { phase: "scanningInputs", capability: "runner" },
  { phase: "scanningInputs", capability: "gateway" },
] as const)(
  "settles suspended $phase work while the $capability backward capability is absent",
  async ({ phase, capability }) => {
    const runner = new FakeRunnerEvents(phase === "pending" ? 10 : 50);
    runner.lifecycle("turn-1", "task.created");
    runner.input("turn-1", "early-input", "earlier steer");
    const count = phase === "pending" ? 800 : 2_400;
    for (let index = 0; index < count; index += 1)
      runner.output("turn-1", claudeTextLine(`line ${index} `));
    runner.lifecycle("turn-1", "task.succeeded");
    const original = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const h = { ...original, gateway: { ...original.gateway } };
    Object.assign(h.gateway, {
      watchInventory: async (
        _request: { readonly serverId: string },
        listener: (event: RemoteRunnerInventoryEvent) => void,
      ) => {
        listener({ type: "connected" });
        return vi.fn();
      },
    });
    const view = mount(h);
    await view.render();
    const first = view.snapshot!;
    const stored = first.replayBackfill?.get("turn-1");
    const reads = h.backward().length;
    expect(stored?.kind).toBe(phase);
    expect(h.calls.getRunner).toHaveBeenCalledTimes(1);
    if (capability === "runner")
      h.calls.getRunner.mockResolvedValue({
        protocolVersion: 1,
        runnerId: "runner",
        name: "Server",
        capabilities: {
          taskExecution: true,
          eventReplay: true,
          taskContinuation: true,
        },
      });
    if (capability === "gateway") Object.assign(h.gateway, { listEventsBefore: undefined });

    await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

    expect(h.calls.getRunner).toHaveBeenCalledTimes(2);
    expect(view.surface.loading).toBe(false);
    expect(view.snapshot?.replayBackfill).toEqual(first.replayBackfill);
    expect(view.snapshot?.replays).toEqual(first.replays);
    expect(view.snapshot?.replayTruncated.has("turn-1")).toBe(true);
    expect(h.backward()).toHaveLength(reads);
    expect(h.forward()).toEqual([]);
    for (const callCount of [3, 4]) {
      await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
      expect(h.calls.getRunner).toHaveBeenCalledTimes(callCount - 1);
      await advance(60_000 - REMOTE_INVENTORY_CONTINUATION_DELAY_MS - 1);
      expect(h.calls.getRunner).toHaveBeenCalledTimes(callCount - 1);
      await advance(1);
      expect(h.calls.getRunner).toHaveBeenCalledTimes(callCount);
      expect(view.surface.loading).toBe(false);
      expect(view.snapshot?.replayBackfill).toEqual(first.replayBackfill);
      expect(view.snapshot?.replays).toEqual(first.replays);
      expect(view.snapshot?.replayGaps).toEqual(first.replayGaps);
      expect(view.snapshot?.replayTruncated.has("turn-1")).toBe(true);
      expect(h.backward()).toHaveLength(reads);
      expect(h.forward()).toEqual([]);
    }
  },
);

it.each(["pending", "scanningInputs"] as const)(
  "restarts unfinished %s history from the tail when the server endpoint changes",
  async (phase) => {
    const runner = new FakeRunnerEvents(phase === "pending" ? 10 : 50);
    runner.lifecycle("turn-1", "task.created");
    runner.input("turn-1", "old-input", "old endpoint steer");
    const count = phase === "pending" ? 800 : 2_400;
    for (let index = 0; index < count; index += 1)
      runner.output("turn-1", claudeTextLine(`old endpoint ${index} `));
    runner.lifecycle("turn-1", "task.succeeded");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const view = mount(h);
    await view.render();
    const stored = view.snapshot?.replayBackfill?.get("turn-1");
    const reads = h.backward().length;
    expect(stored?.kind).toBe(phase);
    const replacement = new FakeRunnerEvents();
    replacement.lifecycle("turn-1", "task.created");
    replacement.output("turn-1", claudeTextLine("new endpoint output"));
    replacement.lifecycle("turn-1", "task.succeeded");
    h.calls.listEventsBefore.mockImplementation(replacement.listEventsBefore);
    h.calls.listEvents.mockImplementation(replacement.listEvents);

    await view.render({ servers: [{ ...SERVER, port: 2_222 }] });

    expect(h.backward().slice(reads)).toEqual([
      { serverId: "server", taskId: "turn-1", before: TAIL },
    ]);
    expect(view.surface.loading).toBe(false);
    expect(view.snapshot?.replays.get("turn-1")).toEqual(replacement.eventsOf("turn-1"));
    expect(view.snapshot?.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(view.snapshot?.replayCursors?.get("turn-1")).toBe(3);
    expect(view.snapshot?.replayTruncated.has("turn-1")).toBe(false);
    expect(view.snapshot?.replayGaps?.has("turn-1")).toBe(false);
    expect(h.forward()).toEqual([]);
  },
);

function boundaryScanRunner(): FakeRunnerEvents {
  const runner = new FakeRunnerEvents();
  runner.output("turn-1", claudeTextLine("older line"));
  for (let index = 0; index < 117; index += 1) runner.lifecycle("turn-1", "task.created");
  for (let index = 0; index < 32; index += 1)
    runner.input("turn-1", `input-${index}`, `steer ${index}`);
  for (let index = 0; index < 1_100; index += 1) runner.lifecycle("turn-1", "task.created");
  runner.output("turn-1", claudeTextLine("retained line"));
  return runner;
}

function boundaryCursors(h: ReturnType<typeof fakeRunnerGateway>): number[] {
  return h
    .backward()
    .filter((request) => request.taskId === "turn-1")
    .map((request) => request.before);
}

function expectedBoundaryCursors(): number[] {
  return [
    TAIL,
    ...Array.from(
      { length: MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS },
      (_, index) => 1_202 - index * 50,
    ),
  ];
}

function truthfulBoundary(snapshot: RemoteAgentInventorySnapshot): void {
  const turn = projectedTurn(snapshot, "turn-1");
  expect(turn?.status, "The terminal turn must stay terminal during boundary suspension").toEqual({
    kind: "exited",
    exitCode: 0,
  });
  expect(turn?.eventsRetention, "The local retention window remains visible").toBe("clientWindow");
  expect(turn?.eventsTruncated, "Over-limit history remains visibly truncated").toBe(true);
}

it.each([
  { missing: "runner", passes: 1 },
  { missing: "runner", passes: 3 },
  { missing: "gateway", passes: 1 },
  { missing: "gateway", passes: 3 },
] as const)(
  "settles scanningBoundary for $passes passes while the $missing capability is absent and resumes its cursor",
  async ({ missing, passes }) => {
    const runner = boundaryScanRunner();
    const original = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const h = { ...original, gateway: { ...original.gateway } };
    Object.assign(h.gateway, {
      watchInventory: async (
        _request: { readonly serverId: string },
        listener: (event: RemoteRunnerInventoryEvent) => void,
      ) => {
        listener({ type: "connected" });
        return vi.fn();
      },
    });
    const view = mount(h);
    await view.render();
    const first = view.snapshot!;
    expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
    expect(boundaryCursors(h)).toEqual(expectedBoundaryCursors());
    truthfulBoundary(first);
    if (missing === "runner")
      h.calls.getRunner.mockResolvedValue({
        protocolVersion: 1,
        runnerId: "runner",
        name: "Server",
        capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
      });
    if (missing === "gateway") Object.assign(h.gateway, { listEventsBefore: undefined });

    await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
    for (let pass = 0; pass < passes; pass += 1) {
      expect(h.calls.getRunner).toHaveBeenCalledTimes(pass + 2);
      expect(view.surface.loading).toBe(false);
      expect(replayState(view.snapshot!)).toEqual(replayState(first));
      truthfulBoundary(view.snapshot!);
      expect(boundaryCursors(h)).toEqual(expectedBoundaryCursors());
      expect(h.forward()).toEqual([]);
      await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
      expect(
        h.calls.getRunner,
        "Suspension must settle instead of scheduling continuation",
      ).toHaveBeenCalledTimes(pass + 2);
      if (pass + 1 === passes) continue;
      await advance(60_000 - REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
    }

    if (missing === "runner")
      h.calls.getRunner.mockResolvedValue({
        protocolVersion: 1,
        runnerId: "runner",
        name: "Server",
        capabilities: {
          taskExecution: true,
          eventReplay: true,
          taskContinuation: true,
          eventBackwardPaging: true,
        },
      });
    if (missing === "gateway")
      Object.assign(h.gateway, { listEventsBefore: h.calls.listEventsBefore });
    await advance(60_000 - REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

    expect(
      boundaryCursors(h),
      "Restoration must read the suspended boundary cursor exactly once",
    ).toEqual([...expectedBoundaryCursors(), 2]);
    expect(view.snapshot?.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
    expect(view.surface.loading).toBe(false);
    truthfulBoundary(view.snapshot!);
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const expected = await loadUntilSettled(forward.gateway, runner);
    expect(replayState(view.snapshot!)).toEqual(replayState(expected));
    expect(projectedTurns(view.snapshot!)).toEqual(projectedTurns(expected));
  },
);

it("restarts a deselected over-limit thread from its newest tail when it is selected again", async () => {
  const runner = boundaryScanRunner();
  const other = remoteTurn(2, { conversationId: "turn-2", parentTaskId: undefined });
  const h = fakeRunnerGateway(runner, [remoteTurn(1), other]);
  const view = mount(h);
  await view.render();
  const first = view.snapshot!;
  expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
  const earlierReads = boundaryCursors(h).length;

  await view.render({ selectedThreadId: remoteAgentThreadKey("server", "runner", "turn-2") });
  await view.render();

  expect(
    boundaryCursors(h)[earlierReads],
    "A reselected thread must start again from its newest tail",
  ).toBe(TAIL);
  expect(
    lastOf(view.snapshot?.replays.get("turn-1") ?? []),
    "The newest output must be visible as soon as the thread is selected again",
  ).toEqual(lastOf(first.replays.get("turn-1") ?? []));
  expect(h.forward().filter((request) => request.taskId === "turn-1")).toEqual([]);
  truthfulBoundary(view.snapshot!);

  for (let pass = 0; pass < 4; pass += 1) await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

  expect(view.snapshot?.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  const legacy = fakeRunnerGateway(runner, [remoteTurn(1), other], {});
  const expected = await loadUntilSettled(legacy.gateway, runner);
  expect(replayState(view.snapshot!)).toEqual(replayState(expected));
  expect(projectedTurns(view.snapshot!)).toEqual(projectedTurns(expected));
});

it("restarts a deselected over-limit thread through the legacy loader while backward paging is absent", async () => {
  const runner = boundaryScanRunner();
  const other = remoteTurn(2, { conversationId: "turn-2", parentTaskId: undefined });
  const h = fakeRunnerGateway(runner, [remoteTurn(1), other]);
  const view = mount(h);
  await view.render();
  expect(view.snapshot?.replayBackfill?.get("turn-1")).toEqual({
    kind: "scanningBoundary",
    before: 2,
  });
  h.calls.getRunner.mockResolvedValue({
    protocolVersion: 1,
    runnerId: "runner",
    name: "Server",
    capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
  });

  await view.render({ selectedThreadId: remoteAgentThreadKey("server", "runner", "turn-2") });
  await view.render();
  for (let pass = 0; pass < 3; pass += 1) await act(async () => view.surface.refresh());

  expect(
    boundaryCursors(h),
    "A deselected thread must not continue its dropped backward scan",
  ).toEqual(expectedBoundaryCursors());
  expect(
    h.forward().filter((request) => request.taskId === "turn-1").length,
    "Without backward paging the reselected thread is read by the legacy loader",
  ).toBeGreaterThan(0);
  const legacy = fakeRunnerGateway(runner, [remoteTurn(1), other], {});
  const expected = await loadUntilSettled(legacy.gateway, runner);
  expect(replayState(view.snapshot!)).toEqual(replayState(expected));
  expect(projectedTurns(view.snapshot!)).toEqual(projectedTurns(expected));
});

it("backs off a failed scanningBoundary page and retries its exact cursor with truthful history", async () => {
  const runner = boundaryScanRunner();
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  Object.assign(h.gateway, {
    watchInventory: async (
      _request: { readonly serverId: string },
      listener: (event: RemoteRunnerInventoryEvent) => void,
    ) => {
      listener({ type: "connected" });
      return vi.fn();
    },
  });
  const view = mount(h);
  await view.render();
  const first = view.snapshot!;
  expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
  h.calls.listEventsBefore.mockRejectedValueOnce(new Error("Boundary page unavailable."));

  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);

  expect(boundaryCursors(h)).toEqual([...expectedBoundaryCursors(), 2]);
  expect(view.snapshot?.replayBackfill).toEqual(first.replayBackfill);
  expect(view.snapshot?.replays).toEqual(first.replays);
  expect(view.surface.loading).toBe(false);
  truthfulBoundary(view.snapshot!);
  await advance(REMOTE_INVENTORY_CONTINUATION_DELAY_MS);
  expect(boundaryCursors(h), "A failed scan must back off instead of continuing promptly").toEqual([
    ...expectedBoundaryCursors(),
    2,
  ]);
  await advance(2_000 - REMOTE_INVENTORY_CONTINUATION_DELAY_MS - 1);
  expect(boundaryCursors(h)).toEqual([...expectedBoundaryCursors(), 2]);
  await advance(1);

  expect(boundaryCursors(h), "The retry must repeat only the failed cursor").toEqual([
    ...expectedBoundaryCursors(),
    2,
    2,
  ]);
  expect(view.snapshot?.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  truthfulBoundary(view.snapshot!);
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const expected = await loadUntilSettled(forward.gateway, runner);
  expect(replayState(view.snapshot!)).toEqual(replayState(expected));
  expect(projectedTurns(view.snapshot!)).toEqual(projectedTurns(expected));
});
