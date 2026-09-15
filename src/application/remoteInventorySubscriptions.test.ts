import { afterEach, expect, it, vi } from "vitest";
import type { RemoteRunnerInventoryEvent } from "../domain/remoteRunner";
import { subscribeRemoteInventory } from "./remoteInventorySubscriptions";

afterEach(() => vi.useRealTimers());
it("retries failed setup, rejects old callbacks, and leaves successful reconnects to gateway", async () => {
  vi.useFakeTimers();
  const callbacks: ((event: RemoteRunnerInventoryEvent) => void)[] = [];
  const unsubscribe = vi.fn();
  const listener = vi.fn();
  const watch = vi.fn(async (_request, callback) => {
    callbacks.push(callback);
    if (callbacks.length === 1) throw new Error("temporary failure");
    callback({ type: "connected" });
    return unsubscribe;
  });
  const stop = subscribeRemoteInventory(watch, "server", listener);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(watch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(watch).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenLastCalledWith({ type: "connected" });
  callbacks[0]!({ type: "changed" });
  expect(listener).toHaveBeenCalledTimes(2);
  callbacks[1]!({ type: "disconnected" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(watch).toHaveBeenCalledTimes(2);
  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("bounds exponential retry and cancels setup retry on disposal", async () => {
  vi.useFakeTimers();
  const watch = vi.fn(() => {
    throw new Error("sync setup failure");
  });
  const stop = subscribeRemoteInventory(watch, "server", vi.fn());
  await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 30_000);
  expect(watch).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(watch).toHaveBeenCalledTimes(6);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(watch).toHaveBeenCalledTimes(6);
  expect(vi.getTimerCount()).toBe(0);
});
