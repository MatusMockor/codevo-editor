import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerInventoryEvent } from "../domain/remoteRunner";
import { startRemoteInventoryRefresh } from "./remoteInventoryRefresh";

afterEach(() => vi.useRealTimers());
function setup(serverIds = ["server"]) {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: RemoteRunnerInventoryEvent) => void>();
  const unsubscribe = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const watchInventory = vi.fn(async ({ serverId }, listener) => {
    listeners.set(serverId, listener);
    return unsubscribe;
  });
  const gateway = { watchInventory } as unknown as RemoteRunnerGateway;
  const stop = startRemoteInventoryRefresh({ gateway, serverIds, refresh });
  return { refresh, stop, unsubscribe, listeners };
}

it("replaces two-second polling with bounded reconciliation while live", async () => {
  const h = setup();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  h.listeners.get("server")!({ type: "connected" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(h.refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.refresh).toHaveBeenCalledTimes(3);
  h.stop();
});

it("coalesces an output storm without postponing refresh indefinitely", async () => {
  const h = setup();
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 1000; index++) h.listeners.get("server")!({ type: "changed" });
  await vi.advanceTimersByTimeAsync(200);
  h.listeners.get("server")!({ type: "changed" });
  await vi.advanceTimersByTimeAsync(50);
  expect(h.refresh).toHaveBeenCalledTimes(2);
  h.stop();
});

it("retains one refresh behind in-flight work and rejects disposed callbacks", async () => {
  const h = setup();
  await vi.advanceTimersByTimeAsync(0);
  let settle!: () => void;
  h.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  h.listeners.get("server")!({ type: "changed" });
  await vi.advanceTimersByTimeAsync(250);
  for (let index = 0; index < 1000; index++) h.listeners.get("server")!({ type: "changed" });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.refresh).toHaveBeenCalledTimes(2);
  settle();
  await vi.advanceTimersByTimeAsync(250);
  expect(h.refresh).toHaveBeenCalledTimes(3);
  h.stop();
  h.listeners.get("server")!({ type: "changed" });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(h.refresh).toHaveBeenCalledTimes(3);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

it("falls back when one server disconnects and reconciles on reconnect", async () => {
  const h = setup(["A", "B"]);
  await vi.advanceTimersByTimeAsync(0);
  h.listeners.get("A")!({ type: "connected" });
  h.listeners.get("B")!({ type: "connected" });
  await vi.advanceTimersByTimeAsync(250);
  h.listeners.get("B")!({ type: "disconnected" });
  await vi.advanceTimersByTimeAsync(250);
  const count = h.refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.refresh).toHaveBeenCalledTimes(count + 1);
  h.listeners.get("B")!({ type: "connected" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.refresh).toHaveBeenCalledTimes(count + 2);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.refresh).toHaveBeenCalledTimes(count + 2);
  h.stop();
});

it("disposes subscriptions that settle after revocation and stops pending refresh", async () => {
  vi.useFakeTimers();
  let subscribe!: (value: () => void) => void;
  let complete!: () => void;
  const unsubscribe = vi.fn();
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const gateway = {
    watchInventory: () =>
      new Promise<() => void>((resolve) => {
        subscribe = resolve;
      }),
  } as unknown as RemoteRunnerGateway;
  const stop = startRemoteInventoryRefresh({ gateway, serverIds: ["server"], refresh });
  stop();
  subscribe(unsubscribe);
  complete();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps fallback polling when watching fails or is unsupported", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const gateway = {
    watchInventory: vi.fn().mockRejectedValue(new Error("Old runner")),
  } as unknown as RemoteRunnerGateway;
  const stop = startRemoteInventoryRefresh({ gateway, serverIds: ["server"], refresh });
  await vi.advanceTimersByTimeAsync(250);
  const count = refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(refresh).toHaveBeenCalledTimes(count + 1);
  stop();
  const unsupported = startRemoteInventoryRefresh({
    gateway: null,
    serverIds: ["server"],
    refresh,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(refresh).toHaveBeenCalledTimes(count + 3);
  unsupported();
});
