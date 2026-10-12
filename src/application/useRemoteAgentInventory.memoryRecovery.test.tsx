import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { builtinEnvironments, type EnvironmentReturn } from "vitest/environments";
import type { RemoteRunnerDescriptor, RemoteRunnerServer } from "../domain/remoteRunner";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import { deferred, fakeRunnerGateway, remoteTurn } from "./remoteAgentTailFirstTestSupport";
import { FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";
import {
  useRemoteAgentInventory,
  type RemoteAgentInventorySurface,
} from "./useRemoteAgentInventory";

const SERVER: RemoteRunnerServer = {
  id: "server",
  host: "host",
  username: "user",
  port: 22,
  name: "Server",
  connected: true,
};
const THREAD_A = remoteAgentThreadKey("server", "runner", "turn-1");
const THREAD_B = remoteAgentThreadKey("server", "runner", "turn-2");
const TAIL = Number.MAX_SAFE_INTEGER;
let environment: EnvironmentReturn;
const disposers: (() => void)[] = [];

beforeAll(async () => {
  environment = await builtinEnvironments.jsdom.setup(globalThis, {});
});
afterAll(async () => {
  await environment.teardown(globalThis);
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

interface Props {
  readonly selectedThreadId: string;
  readonly server: RemoteRunnerServer;
}

function mount(h: ReturnType<typeof fakeRunnerGateway>) {
  let surface!: RemoteAgentInventorySurface;
  const root = createRoot(document.createElement("div"));
  function Harness({ server, selectedThreadId }: Props) {
    surface = useRemoteAgentInventory({
      gateway: h.gateway,
      servers: [server],
      workspaceOwner: "owner",
      selectedThreadId,
    });
    return null;
  }
  const render = async (selectedThreadId = THREAD_A, server = SERVER) => {
    await act(async () => {
      root.render(createElement(Harness, { selectedThreadId, server }));
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const refresh = async () => {
    await act(async () => surface.refresh());
  };
  disposers.push(() => act(() => root.unmount()));
  return {
    render,
    refresh,
    get surface() {
      return surface;
    },
    get snapshot() {
      return surface.snapshots[0];
    },
  };
}

function runnerGateway() {
  const runner = new FakeRunnerEvents();
  for (const taskId of ["turn-1", "turn-2"]) {
    runner.output(taskId, `${taskId} output\n`);
    runner.lifecycle(taskId, "task.succeeded");
  }
  const h = fakeRunnerGateway(runner, [
    remoteTurn(1),
    remoteTurn(2, { conversationId: "turn-2", parentTaskId: undefined }),
  ]);
  return { h, runner };
}

async function replaceRunner(
  h: ReturnType<typeof fakeRunnerGateway>,
  view: ReturnType<typeof mount>,
) {
  const original = await h.gateway.getRunner({ serverId: "server" });
  h.calls.getRunner.mockResolvedValue({ ...original, runnerId: "replacement" });
  await view.refresh();
  expect(view.surface.reachability.get("server")).toEqual({
    kind: "disconnected",
    reason: "runnerReplaced",
  });
  return original;
}

it("remembers threads again after the original pinned runner successfully returns", async () => {
  const { h, runner } = runnerGateway();
  const view = mount(h);
  await view.render();
  const original = await replaceRunner(h, view);
  h.calls.getRunner.mockResolvedValue(original);
  await view.refresh();
  expect(view.surface.reachability.get("server")).toEqual({ kind: "reachable" });
  const remembered = view.snapshot?.replays.get("turn-1");
  expect(remembered).toEqual(runner.eventsOf("turn-1"));
  await view.render(THREAD_B);
  h.calls.listEvents.mockClear();
  h.calls.listEventsBefore.mockClear();
  const descriptor = deferred<RemoteRunnerDescriptor>();
  h.calls.getRunner.mockReturnValueOnce(descriptor.promise);

  await view.render();

  expect(view.snapshot?.replays.get("turn-1")).toBe(remembered);
  expect(view.snapshot?.replayRestore?.has("turn-1")).toBe(true);
  await act(async () => {
    descriptor.resolve(original);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(h.forward()).toEqual([{ serverId: "server", taskId: "turn-1", after: 2 }]);
  expect(h.backward()).toEqual([]);
  expect(view.snapshot?.replays.get("turn-1")).toBe(remembered);
  expect(view.snapshot?.connected).toBe(true);
  expect(view.snapshot?.error).toBeNull();
});

it("remembers nothing while the replacement verdict continues to hold", async () => {
  const { h } = runnerGateway();
  const view = mount(h);
  await view.render();
  await replaceRunner(h, view);
  await view.refresh();
  await view.render(THREAD_B);
  await view.render();

  expect(view.snapshot?.replays.size).toBe(0);
  expect(view.snapshot?.replayRestore).toBeUndefined();
  expect(view.surface.reachability.get("server")).toEqual({
    kind: "disconnected",
    reason: "runnerReplaced",
  });
  h.calls.listEvents.mockClear();
  h.calls.listEventsBefore.mockClear();
  await view.refresh();
  expect(h.forward()).toEqual([]);
  expect(h.backward()).toEqual([]);
  expect(view.snapshot?.replays.size).toBe(0);
});

it("keeps remembering excluded after the pinned descriptor returns but its refresh fails", async () => {
  const { h, runner } = runnerGateway();
  const view = mount(h);
  await view.render();
  const original = await replaceRunner(h, view);
  h.calls.getRunner.mockResolvedValue(original);
  h.calls.getTaskResume.mockRejectedValue(new Error("Request timed out."));
  await view.refresh();
  await view.render(THREAD_B);
  h.calls.listEventsBefore.mockClear();
  await view.render();

  expect(h.backward()[0]).toEqual({ serverId: "server", taskId: "turn-1", before: TAIL });
  expect(view.snapshot?.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
  expect(view.snapshot?.replayRestore).toBeUndefined();
  expect(view.snapshot?.error).toContain("Request timed out.");
});

it("does not clear a replacement exclusion when the pinned runner answers a changed endpoint", async () => {
  const { h } = runnerGateway();
  const view = mount(h);
  await view.render();
  const original = await replaceRunner(h, view);
  h.calls.getRunner.mockResolvedValue(original);
  const changed = { ...SERVER, host: "changed-host" };
  await view.render(THREAD_A, changed);
  expect(view.snapshot?.connected).toBe(true);
  await view.render(THREAD_B, changed);
  h.calls.listEventsBefore.mockClear();
  await view.render(THREAD_A, changed);

  expect(h.backward()[0]).toEqual({ serverId: "server", taskId: "turn-1", before: TAIL });
  expect(view.snapshot?.replayRestore).toBeUndefined();
});
