import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerInventoryEvent } from "../domain/remoteRunner";
import {
  startRemoteInventoryRefresh,
  type RemoteInventoryRefreshOutcome,
} from "./remoteInventoryRefresh";

afterEach(() => vi.useRealTimers());
function setup(serverIds = ["server"]) {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: RemoteRunnerInventoryEvent) => void>();
  const unsubscribe = vi.fn();
  const refresh = vi
    .fn<() => Promise<RemoteInventoryRefreshOutcome>>()
    .mockResolvedValue("settled");
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
      new Promise((resolve) => {
        settle = () => resolve("settled");
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
      new Promise<RemoteInventoryRefreshOutcome>((resolve) => {
        complete = () => resolve("settled");
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
  const refresh = vi
    .fn<() => Promise<RemoteInventoryRefreshOutcome>>()
    .mockResolvedValue("settled");
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

async function liveAfterFirstRefresh(h: ReturnType<typeof setup>): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  h.listeners.get("server")!({ type: "connected" });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.refresh).toHaveBeenCalledTimes(2);
}

async function expectNextRefreshAfter(
  h: ReturnType<typeof setup>,
  milliseconds: number,
): Promise<void> {
  const count = h.refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(milliseconds - 1);
  expect(h.refresh).toHaveBeenCalledTimes(count);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.refresh).toHaveBeenCalledTimes(count + 1);
}

it("retries a recovering inventory with a capped backoff and resets after it settles", async () => {
  const h = setup();
  h.refresh.mockResolvedValue("recovering");
  await liveAfterFirstRefresh(h);
  for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000])
    await expectNextRefreshAfter(h, delay);

  h.refresh.mockResolvedValue("settled");
  await expectNextRefreshAfter(h, 30_000);
  await expectNextRefreshAfter(h, 60_000);

  h.refresh.mockResolvedValueOnce("recovering");
  await expectNextRefreshAfter(h, 60_000);
  await expectNextRefreshAfter(h, 2_000);
  await expectNextRefreshAfter(h, 60_000);
  h.stop();
});

it("backs off a rejected refresh the same way as a recovering one", async () => {
  const h = setup();
  await liveAfterFirstRefresh(h);
  h.refresh.mockRejectedValue(new Error("Unavailable"));
  await expectNextRefreshAfter(h, 60_000);
  await expectNextRefreshAfter(h, 2_000);
  await expectNextRefreshAfter(h, 4_000);
  h.stop();
});

it("keeps the fallback polling cadence while a recovering server has no live watch", async () => {
  const h = setup();
  h.refresh.mockResolvedValue("recovering");
  await vi.advanceTimersByTimeAsync(0);
  for (let attempt = 0; attempt < 6; attempt++) await expectNextRefreshAfter(h, 2_000);
  h.stop();
});

it("cancels a pending backoff retry when it is disposed", async () => {
  const h = setup();
  h.refresh.mockResolvedValue("recovering");
  await liveAfterFirstRefresh(h);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(vi.getTimerCount()).toBe(1);

  h.stop();

  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

it("coalesces an inventory event storm during a backoff into one refresh", async () => {
  const h = setup();
  h.refresh.mockResolvedValue("recovering");
  await liveAfterFirstRefresh(h);
  await vi.advanceTimersByTimeAsync(1_000);
  for (let index = 0; index < 1000; index++) h.listeners.get("server")!({ type: "changed" });
  expect(vi.getTimerCount()).toBe(1);

  await vi.advanceTimersByTimeAsync(250);
  expect(h.refresh).toHaveBeenCalledTimes(3);
  await expectNextRefreshAfter(h, 4_000);
  h.stop();
});
