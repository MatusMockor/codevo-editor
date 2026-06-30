import { describe, expect, it } from "vitest";
import {
  LATENCY_OPERATION_KINDS,
  createLatencyTracker,
  latencyOperationLabel,
  measureLatency,
  type LatencyOperationKind,
} from "./latencyTracker";

describe("createLatencyTracker", () => {
  it("starts with no samples for any operation kind", () => {
    const tracker = createLatencyTracker();

    expect(tracker.snapshot()).toEqual([]);
    expect(tracker.statsFor("quickOpen")).toBeNull();
  });

  it("records a sample and exposes count, last, min, max and median", () => {
    const tracker = createLatencyTracker();

    tracker.record("quickOpen", 10);
    tracker.record("quickOpen", 30);
    tracker.record("quickOpen", 20);

    const stats = tracker.statsFor("quickOpen");

    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(3);
    expect(stats?.last).toBe(20);
    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(30);
    expect(stats?.median).toBe(20);
  });

  it("computes the median of an even sample count as the mean of the two middle values", () => {
    const tracker = createLatencyTracker();

    tracker.record("definition", 10);
    tracker.record("definition", 20);
    tracker.record("definition", 30);
    tracker.record("definition", 40);

    expect(tracker.statsFor("definition")?.median).toBe(25);
  });

  it("computes a p95 that tracks the high tail", () => {
    const tracker = createLatencyTracker();

    for (let value = 1; value <= 100; value += 1) {
      tracker.record("completion", value);
    }

    const stats = tracker.statsFor("completion");

    expect(stats?.p95).toBeGreaterThanOrEqual(95);
    expect(stats?.p95).toBeLessThanOrEqual(100);
  });

  it("keeps only the most recent samples up to the configured capacity", () => {
    const tracker = createLatencyTracker({ capacity: 3 });

    tracker.record("quickOpen", 1);
    tracker.record("quickOpen", 2);
    tracker.record("quickOpen", 3);
    tracker.record("quickOpen", 4);

    const stats = tracker.statsFor("quickOpen");

    // The oldest sample (1) is dropped; window is [2, 3, 4].
    expect(stats?.count).toBe(3);
    expect(stats?.min).toBe(2);
    expect(stats?.max).toBe(4);
    expect(stats?.last).toBe(4);
  });

  it("ignores non-finite or negative samples without throwing", () => {
    const tracker = createLatencyTracker();

    tracker.record("quickOpen", Number.NaN);
    tracker.record("quickOpen", -5);
    tracker.record("quickOpen", Number.POSITIVE_INFINITY);
    tracker.record("quickOpen", 12);

    const stats = tracker.statsFor("quickOpen");

    expect(stats?.count).toBe(1);
    expect(stats?.last).toBe(12);
  });

  it("keeps operation kinds isolated from each other", () => {
    const tracker = createLatencyTracker();

    tracker.record("quickOpen", 5);
    tracker.record("definition", 50);

    expect(tracker.statsFor("quickOpen")?.median).toBe(5);
    expect(tracker.statsFor("definition")?.median).toBe(50);
  });

  it("snapshots every operation kind that has samples, sorted by kind order", () => {
    const tracker = createLatencyTracker();

    tracker.record("folderExpand", 2);
    tracker.record("quickOpen", 8);

    const snapshot = tracker.snapshot();
    const kinds = snapshot.map((entry) => entry.kind);

    expect(kinds).toContain("quickOpen");
    expect(kinds).toContain("folderExpand");
    expect(kinds.indexOf("quickOpen")).toBeLessThan(kinds.indexOf("folderExpand"));
  });

  it("clears all recorded samples", () => {
    const tracker = createLatencyTracker();

    tracker.record("quickOpen", 5);
    tracker.clear();

    expect(tracker.snapshot()).toEqual([]);
    expect(tracker.statsFor("quickOpen")).toBeNull();
  });
});

describe("measureLatency", () => {
  it("records the elapsed time of a resolved promise and returns its value", async () => {
    const tracker = createLatencyTracker();
    let now = 1000;
    const clock = () => now;

    const promise = measureLatency(
      tracker,
      "searchEverywhere",
      async () => {
        now += 42;
        return "done";
      },
      clock,
    );

    await expect(promise).resolves.toBe("done");
    expect(tracker.statsFor("searchEverywhere")?.last).toBe(42);
  });

  it("records elapsed time even when the operation rejects, then rethrows", async () => {
    const tracker = createLatencyTracker();
    let now = 0;
    const clock = () => now;

    const failure = measureLatency(
      tracker,
      "definition",
      async () => {
        now += 17;
        throw new Error("boom");
      },
      clock,
    );

    await expect(failure).rejects.toThrow("boom");
    expect(tracker.statsFor("definition")?.last).toBe(17);
  });
});

describe("latencyOperationLabel", () => {
  it("provides a human label for every operation kind", () => {
    for (const kind of LATENCY_OPERATION_KINDS) {
      const label = latencyOperationLabel(kind as LatencyOperationKind);

      expect(label.length).toBeGreaterThan(0);
    }
  });
});
