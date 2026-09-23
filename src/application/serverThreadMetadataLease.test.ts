import { describe, expect, it } from "vitest";
import {
  MAX_METADATA_SAVES_IN_FLIGHT,
  nextMetadataSlotWake,
  releaseMetadataSlot,
  rememberPendingViewed,
  serverThreadMetadataLease,
  takeRunnableViewed,
  viewedOnlyChange,
} from "./serverThreadMetadataLease";

describe("server thread metadata lease", () => {
  it("recognizes only a lone numeric view mark as coalescible", () => {
    expect(viewedOnlyChange({ viewedAtEpochMs: 5 })).toBe(5);
    expect(viewedOnlyChange({ viewedAtEpochMs: null })).toBeNull();
    expect(viewedOnlyChange({ viewedAtEpochMs: 5, pinned: true })).toBeNull();
    expect(viewedOnlyChange({ viewedAtEpochMs: -1 })).toBeNull();
  });

  it("keeps the highest pending view mark and releases it only once the thread is idle", () => {
    const lease = serverThreadMetadataLease({});
    lease.busy.add("a");
    rememberPendingViewed(lease, "a", 30);
    rememberPendingViewed(lease, "a", 20);
    rememberPendingViewed(lease, "b", 7);
    expect(takeRunnableViewed(lease)).toEqual([["b", 7]]);
    releaseMetadataSlot(lease, "a");
    expect(takeRunnableViewed(lease)).toEqual([["a", 30]]);
    expect(takeRunnableViewed(lease)).toEqual([]);
  });

  it("never hands out more pending marks than free slots", () => {
    const lease = serverThreadMetadataLease({});
    for (let index = 0; index < MAX_METADATA_SAVES_IN_FLIGHT - 1; index += 1)
      lease.busy.add(`busy-${index}`);
    rememberPendingViewed(lease, "x", 1);
    rememberPendingViewed(lease, "y", 2);
    expect(takeRunnableViewed(lease)).toEqual([["x", 1]]);
    expect(lease.pendingViewed.get("y")).toBe(2);
  });

  it("wakes exactly one waiter per released slot and drops it from the queue", async () => {
    const lease = serverThreadMetadataLease({});
    lease.busy.add("a");
    const woken = nextMetadataSlotWake(lease);
    expect(lease.waiters).toHaveLength(1);
    releaseMetadataSlot(lease, "a");
    await woken;
    expect(lease.waiters).toHaveLength(0);
  });
});
