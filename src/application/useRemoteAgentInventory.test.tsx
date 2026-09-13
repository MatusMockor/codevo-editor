// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
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
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
async function setup() {
  const gateway = {
    getRunner: vi.fn().mockResolvedValue(descriptor),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTasks: vi
      .fn()
      .mockImplementation(async ({ after }: { after: number }) => ({
        items: after === 0 ? [task] : [],
        nextCursor: null,
      })),
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
  const render = async (owner = "A", servers: readonly RemoteRunnerServer[] = [server]) => {
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
