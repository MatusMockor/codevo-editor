import { describe, expect, it } from "vitest";
import { createLatencyTracker } from "./latencyTracker";
import {
  formatLatencyMs,
  latencyMetricRows,
  latencyMetricTone,
} from "./latencyMetricsView";

describe("formatLatencyMs", () => {
  it("renders sub-millisecond values with two decimals", () => {
    expect(formatLatencyMs(0.056)).toBe("0.06 ms");
  });

  it("renders small values with one decimal", () => {
    expect(formatLatencyMs(12.34)).toBe("12.3 ms");
  });

  it("renders large values as whole milliseconds", () => {
    expect(formatLatencyMs(204.7)).toBe("205 ms");
  });
});

describe("latencyMetricTone", () => {
  it("is ok below the warn threshold for a kind", () => {
    expect(latencyMetricTone("quickOpen", 20)).toBe("ok");
  });

  it("is warn at or above the warn threshold but below error", () => {
    expect(latencyMetricTone("quickOpen", 60)).toBe("warn");
  });

  it("is error at or above the error threshold", () => {
    expect(latencyMetricTone("definition", 250)).toBe("error");
  });

  it("uses a higher budget for folder expand than for quick open", () => {
    // 120ms is fine for folder expand (warn budget 200) but already an error for
    // quick open (error budget 100); 70ms is only a warn for quick open.
    expect(latencyMetricTone("folderExpand", 120)).toBe("ok");
    expect(latencyMetricTone("quickOpen", 120)).toBe("error");
    expect(latencyMetricTone("quickOpen", 70)).toBe("warn");
  });
});

describe("latencyMetricRows", () => {
  it("returns an empty list when nothing has been recorded", () => {
    const tracker = createLatencyTracker();

    expect(latencyMetricRows(tracker.snapshot())).toEqual([]);
  });

  it("maps a snapshot into labelled, formatted, toned rows", () => {
    const tracker = createLatencyTracker();
    tracker.record("quickOpen", 12);
    tracker.record("quickOpen", 18);

    const rows = latencyMetricRows(tracker.snapshot());

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("quickOpen");
    expect(rows[0].label).toBe("Quick Open");
    expect(rows[0].count).toBe(2);
    expect(rows[0].medianText).toBe("15.0 ms");
    expect(rows[0].p95Text).toMatch(/ ms$/);
    expect(rows[0].lastText).toBe("18.0 ms");
    expect(rows[0].tone).toBe("ok");
  });

  it("flags a slow operation with a non-ok tone driven by the median", () => {
    const tracker = createLatencyTracker();
    tracker.record("definition", 300);

    const rows = latencyMetricRows(tracker.snapshot());

    expect(rows[0].tone).toBe("error");
  });
});
