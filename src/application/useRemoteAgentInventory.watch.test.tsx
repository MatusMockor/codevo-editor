// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerInventoryEvent } from "../domain/remoteRunner";
import {
  useRemoteAgentInventory,
  type RemoteAgentInventorySurface,
} from "./useRemoteAgentInventory";

it("does not lose an inventory invalidation behind an explicit refresh", async () => {
  vi.useFakeTimers();
  const descriptor = {
    runnerId: "runner",
    capabilities: { taskExecution: true, eventReplay: true },
  };
  let listener!: (event: RemoteRunnerInventoryEvent) => void;
  const gateway = {
    getRunner: vi.fn().mockResolvedValue(descriptor),
    listProjects: vi.fn().mockResolvedValue({ items: [] }),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    watchInventory: vi.fn(async (_request, callback) => {
      listener = callback;
      return vi.fn();
    }),
  };
  let surface!: RemoteAgentInventorySurface;
  function Harness() {
    surface = useRemoteAgentInventory({
      gateway: gateway as unknown as RemoteRunnerGateway,
      workspaceOwner: "A",
      selectedThreadId: null,
      servers: [
        { id: "server", host: "host", username: "user", port: 22, name: "Server", connected: true },
      ],
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await act(async () => {
      listener({ type: "connected" });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(gateway.getRunner).toHaveBeenCalledTimes(2);
    let settle!: (value: typeof descriptor) => void;
    gateway.getRunner.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    let manual!: Promise<void>;
    await act(async () => {
      manual = surface.refresh();
    });
    const pending: Promise<void>[] = [];
    await act(async () => {
      for (let index = 0; index < 100; index++) pending.push(surface.refresh());
      listener({ type: "changed" });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(gateway.getRunner).toHaveBeenCalledTimes(3);
    await act(async () => {
      settle(descriptor);
      await manual;
      await Promise.all(pending);
    });
    expect(gateway.getRunner).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
