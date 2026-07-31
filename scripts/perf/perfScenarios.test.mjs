import { describe, expect, it } from "vitest";
import { percentilesFromSamples, shapeRunResult, PERF_SCENARIOS } from "./perfScenarios.mjs";

describe("percentilesFromSamples", () => {
  it("computes p50 and p95", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentilesFromSamples(samples)).toEqual({ p50: 50.5, p95: 95 });
  });

  it("handles empty input", () => {
    expect(percentilesFromSamples([])).toEqual({ p50: 0, p95: 0 });
  });
});

describe("shapeRunResult", () => {
  it("merges bridge samples and tracker snapshot entries", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [{ id: "typing-large-5k", samples: [2, 4] }],
      trackerSnapshot: [{ kind: "completion", stats: { count: 3, last: 9, min: 5, max: 9, median: 7, p95: 9 } }],
    });
    const typing = result.scenarios.find((s) => s.id === "typing-large-5k");
    expect(typing.p95).toBe(4);
    const completion = result.scenarios.find((s) => s.trackerKind === "completion");
    expect(completion.p95).toBe(9);
  });
});

describe("PERF_SCENARIOS", () => {
  it("has unique ids", () => {
    const ids = PERF_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
