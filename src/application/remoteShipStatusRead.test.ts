import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE } from "../domain/remoteRunnerErrors";
import {
  REMOTE_SHIP_STATUS_BUSY_RETRY_DELAYS_MS,
  createRemoteShipStatusPauses,
  readRemoteShipStatus,
} from "./remoteShipStatusRead";

const BUSY = new Error(REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE);
const RUNNER_UNAVAILABLE = new Error("Runner request failed (HTTP 503).");
const CONNECTION_FAILED = new Error(
  "Runner connection failed. The request outcome may be unknown.",
);

function harness(read: () => Promise<string>, currentFor = Number.POSITIVE_INFINITY) {
  const pauses: number[] = [];
  let checks = 0;
  return {
    pauses,
    run: () =>
      readRemoteShipStatus({
        read,
        isCurrent: () => {
          checks += 1;
          return checks <= currentFor;
        },
        pause: async (delayMs) => {
          pauses.push(delayMs);
        },
      }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readRemoteShipStatus", () => {
  it("waits one, three and nine seconds between refused reads", () => {
    expect(REMOTE_SHIP_STATUS_BUSY_RETRY_DELAYS_MS).toEqual([1_000, 3_000, 9_000]);
    expect(Object.isFrozen(REMOTE_SHIP_STATUS_BUSY_RETRY_DELAYS_MS)).toBe(true);
  });

  it("settles a successful read without pausing", async () => {
    const read = vi.fn().mockResolvedValue("status");
    const h = harness(read);

    await expect(h.run()).resolves.toEqual({
      kind: "settled",
      result: { ok: true, value: "status" },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(h.pauses).toEqual([]);
  });

  it.each([BUSY, RUNNER_UNAVAILABLE])(
    "reads again after a busy refusal until the read is admitted (%s)",
    async (refusal) => {
      const read = vi
        .fn()
        .mockRejectedValueOnce(refusal)
        .mockRejectedValueOnce(refusal)
        .mockResolvedValue("status");
      const h = harness(read);

      await expect(h.run()).resolves.toEqual({
        kind: "settled",
        result: { ok: true, value: "status" },
      });
      expect(read).toHaveBeenCalledTimes(3);
      expect(h.pauses).toEqual([1_000, 3_000]);
    },
  );

  it("settles with the refusal once the bounded retry budget is spent", async () => {
    const read = vi.fn().mockRejectedValue(BUSY);
    const h = harness(read);

    await expect(h.run()).resolves.toEqual({
      kind: "settled",
      result: { ok: false, error: BUSY },
    });
    expect(read).toHaveBeenCalledTimes(4);
    expect(h.pauses).toEqual([1_000, 3_000, 9_000]);
  });

  it("settles any other failure at once", async () => {
    const read = vi.fn().mockRejectedValue(CONNECTION_FAILED);
    const h = harness(read);

    await expect(h.run()).resolves.toEqual({
      kind: "settled",
      result: { ok: false, error: CONNECTION_FAILED },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(h.pauses).toEqual([]);
  });

  it("stops after a read whose owner was replaced, even when the read succeeded", async () => {
    const read = vi.fn().mockResolvedValue("late");
    const h = harness(read, 0);

    await expect(h.run()).resolves.toEqual({ kind: "superseded" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not read again when the owner was replaced during the pause", async () => {
    const read = vi.fn().mockRejectedValue(BUSY);
    const h = harness(read, 1);

    await expect(h.run()).resolves.toEqual({ kind: "superseded" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(h.pauses).toEqual([1_000]);
  });
});

describe("createRemoteShipStatusPauses", () => {
  it("resolves a pause when its delay elapses and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const pauses = createRemoteShipStatusPauses();
    const settled = vi.fn();
    void pauses.pause("thread", 1_000).then(settled);

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a canceled pause at once and clears its timer", async () => {
    vi.useFakeTimers();
    const pauses = createRemoteShipStatusPauses();
    const settled = vi.fn();
    const other = vi.fn();
    void pauses.pause("thread", 9_000).then(settled);
    void pauses.pause("other", 9_000).then(other);

    pauses.cancel("thread");
    pauses.cancel("unknown");
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    pauses.cancelAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(other).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one pause per thread: a newer pause releases the older one", async () => {
    vi.useFakeTimers();
    const pauses = createRemoteShipStatusPauses();
    const older = vi.fn();
    const newer = vi.fn();
    void pauses.pause("thread", 9_000).then(older);
    void pauses.pause("thread", 3_000).then(newer);

    await vi.advanceTimersByTimeAsync(0);
    expect(older).toHaveBeenCalledTimes(1);
    expect(newer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
