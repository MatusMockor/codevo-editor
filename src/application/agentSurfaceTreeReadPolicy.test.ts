import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SURFACE_TREE_BUSY_JITTER_RATIO,
  AgentSurfaceTreeReadSuperseded,
  AgentSurfaceTreeReadTimedOut,
  createDirectoryReadSlots,
  createRetryTimers,
  jitteredBusyRetryDelay,
  readInSlot,
  readRetryingWhileBusy,
  type ReadSlotLease,
} from "./agentSurfaceTreeReadPolicy";

const BUSY = "WORKSPACE_DIRECTORY_BUSY: this directory is already being read";

describe("agentSurfaceTreeReadPolicy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants free slots synchronously, queues the rest in order and forgets leases on reset", async () => {
    const slots = createDirectoryReadSlots(2);
    const first = syncLease(slots.acquire());
    const second = syncLease(slots.acquire());
    const order: string[] = [];
    const third = slots.acquire();
    const fourth = slots.acquire();
    expect(third).toBeInstanceOf(Promise);
    const track = (name: string, lease: ReadSlotLease | null) =>
      order.push(`${name}:${lease === null ? "cancelled" : "granted"}`);
    const thirdLease = Promise.resolve(third).then((lease) => {
      track("third", lease);
      return lease;
    });
    void Promise.resolve(fourth).then((lease) => track("fourth", lease));

    first.release();
    first.release();
    await thirdLease;
    expect(order).toEqual(["third:granted"]);

    slots.reset();
    await Promise.resolve(fourth);
    expect(order).toEqual(["third:granted", "fourth:cancelled"]);

    second.release();
    (await thirdLease)?.release();
    syncLease(slots.acquire());
    syncLease(slots.acquire());
    expect(slots.acquire()).toBeInstanceOf(Promise);
  });

  it("skips a superseded read after waiting for a slot and always returns the slot", async () => {
    const slots = createDirectoryReadSlots(1);
    const timers = createRetryTimers();
    let current = true;
    let reads = 0;
    const read = async () => {
      reads += 1;
      return reads;
    };
    const held = syncLease(slots.acquire());
    const queued = readInSlot(slots, () => current, read, timers, 1_000);
    current = false;
    held.release();
    await expect(queued).rejects.toBeInstanceOf(AgentSurfaceTreeReadSuperseded);
    expect(reads).toBe(0);

    current = true;
    await expect(readInSlot(slots, () => current, read, timers, 1_000)).resolves.toBe(1);
    await expect(
      readInSlot(
        slots,
        () => true,
        () => Promise.reject(new Error("EACCES")),
        timers,
        1_000,
      ),
    ).rejects.toThrow("EACCES");
    syncLease(slots.acquire());
  });

  it("gives up a hung read at its deadline, frees the slot and stops on dismissal", async () => {
    vi.useFakeTimers();
    const slots = createDirectoryReadSlots(1);
    const timers = createRetryTimers();
    const hung = () => new Promise<number>(() => undefined);

    const timedOut = expect(
      readInSlot(slots, () => true, hung, timers, 10_000),
    ).rejects.toBeInstanceOf(AgentSurfaceTreeReadTimedOut);
    expect(slots.acquire()).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;

    const fresh = createDirectoryReadSlots(1);
    const dismissed = expect(
      readInSlot(fresh, () => true, hung, timers, 10_000),
    ).rejects.toBeInstanceOf(AgentSurfaceTreeReadSuperseded);
    timers.dismissAll();
    await dismissed;
    syncLease(fresh.acquire());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles scheduled waits once as elapsed, woken or dismissed", async () => {
    vi.useFakeTimers();
    const timers = createRetryTimers();
    const elapsed = timers.schedule(100);
    const woken = timers.schedule(100);
    const dismissed = timers.schedule(100);
    woken.wake();
    woken.dismiss();
    timers.dismissAll();
    elapsed.wake();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(woken.settled).resolves.toBe("woken");
    await expect(dismissed.settled).resolves.toBe("dismissed");
    await expect(elapsed.settled).resolves.toBe("dismissed");
    const later = timers.schedule(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(later.settled).resolves.toBe("elapsed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the jittered delay between the base delay and its jitter ceiling", () => {
    const ceiling = (base: number) =>
      base + Math.floor(base * AGENT_SURFACE_TREE_BUSY_JITTER_RATIO);
    expect(jitteredBusyRetryDelay(100, () => 0)).toBe(100);
    expect(jitteredBusyRetryDelay(100, () => 0.5)).toBe(125);
    expect(jitteredBusyRetryDelay(100, () => 1)).toBe(ceiling(100));
    expect(jitteredBusyRetryDelay(2_000, () => 7)).toBe(ceiling(2_000));
    expect(jitteredBusyRetryDelay(2_000, () => -1)).toBe(2_000);
  });

  it("retries only busy failures, once per delay, and stops when the wait is cancelled", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const alwaysBusy = (): Promise<number> => {
      attempts += 1;
      return Promise.reject(new Error(BUSY));
    };
    await expect(
      readRetryingWhileBusy(
        alwaysBusy,
        () => true,
        async (delay) => {
          waits.push(delay);
          return true;
        },
        [100, 250, 500],
      ),
    ).rejects.toThrow(BUSY);
    expect(attempts).toBe(4);
    expect(waits).toEqual([100, 250, 500]);

    attempts = 0;
    await expect(
      readRetryingWhileBusy(
        alwaysBusy,
        () => true,
        async () => false,
        [100, 250],
      ),
    ).rejects.toThrow(BUSY);
    expect(attempts).toBe(1);

    attempts = 0;
    await expect(
      readRetryingWhileBusy(
        () => {
          attempts += 1;
          return Promise.reject(new Error("EACCES"));
        },
        () => true,
        async () => true,
        [100],
      ),
    ).rejects.toThrow("EACCES");
    expect(attempts).toBe(1);

    attempts = 0;
    await expect(
      readRetryingWhileBusy(
        alwaysBusy,
        () => true,
        async () => true,
        [],
      ),
    ).rejects.toThrow(BUSY);
    expect(attempts).toBe(1);
  });
});

function syncLease(granted: ReadSlotLease | Promise<ReadSlotLease | null>): ReadSlotLease {
  expect(granted).not.toBeInstanceOf(Promise);
  return granted as ReadSlotLease;
}
