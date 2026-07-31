import { describe, expect, it } from "vitest";
import {
  inPagePerfRunnerSource,
  percentilesFromSamples,
  shapeRunResult,
  PERF_SCENARIOS,
} from "./perfScenarios.mjs";
import { MONOREPO_PACKAGE_COUNT } from "./monorepoFixture.mjs";

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
      trackerSnapshot: [
        { kind: "completion", stats: { count: 3, last: 9, min: 5, max: 9, median: 7, p95: 9 } },
      ],
    });
    const typing = result.scenarios.find((s) => s.id === "typing-large-5k");
    expect(typing.p95).toBe(4);
    const completion = result.scenarios.find((s) => s.trackerKind === "completion");
    expect(completion.p95).toBe(9);
  });

  it("persists the memory sample scenario", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      retainedCounts: { models: 12, editors: 2 },
      memorySample: { usedJsHeapBytes: 4096 },
    });
    const memory = result.scenarios.find((s) => s.id === "memory-sample");
    expect(memory).toEqual({
      id: "memory-sample",
      unit: "count-bytes",
      retainedCounts: { models: 12, editors: 2 },
      memorySample: { usedJsHeapBytes: 4096 },
    });
  });

  it("emits an entry for every advertised scenario id", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: PERF_SCENARIOS.filter(
        (s) => s.kind === "bridge" && s.id !== "memory-sample",
      ).map((s) => ({ id: s.id, samples: [1] })),
    });
    expect(result.scenarios.map((s) => s.id).sort()).toEqual(
      PERF_SCENARIOS.map((s) => s.id).sort(),
    );
  });

  it("reports fixture paths that could not be opened", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      failedPaths: ["/monorepo/packages/pkg-50/src/extra/file-010.ts"],
    });
    expect(result.failedPaths).toEqual(["/monorepo/packages/pkg-50/src/extra/file-010.ts"]);
  });

  it("defaults the memory sample and failed paths when the run reports none", () => {
    const result = shapeRunResult({ capturedAt: "2026-07-31T00:00:00.000Z" });
    const memory = result.scenarios.find((s) => s.id === "memory-sample");
    expect(memory.retainedCounts).toBeNull();
    expect(memory.memorySample).toBeNull();
    expect(result.failedPaths).toEqual([]);
  });

  it("marks a tracker scenario absent from the snapshot as not-run instead of fabricating zero samples", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      trackerSnapshot: [],
    });
    const completion = result.scenarios.find((s) => s.id === "completion-large-20k");
    expect(completion.status).toBe("not-run");
    expect(completion.reason).toBeTruthy();
    expect(completion.p50).toBeUndefined();
    expect(completion.p95).toBeUndefined();
    expect(completion.samples).toBeUndefined();

    const quickOpen = result.scenarios.find((s) => s.id === "quickopen-monorepo");
    expect(quickOpen.status).toBe("not-run");
    expect(quickOpen.reason).toBeTruthy();
  });

  it("still marks rename-large-20k as skipped (not not-run) when no rename data was recorded", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      trackerSnapshot: [],
    });
    const rename = result.scenarios.find((s) => s.id === "rename-large-20k");
    expect(rename.status).toBe("skipped");
    expect(rename.reason).toBe("Rename produced no latency tracker data.");
  });
});

describe("inPagePerfRunnerSource", () => {
  it("only references monorepo packages that the fixture generates", () => {
    const source = inPagePerfRunnerSource();
    const packageNumbers = /\[([\d, ]+)\]\.map\(\(packageNumber/.exec(source);
    expect(packageNumbers).not.toBeNull();
    const parsed = packageNumbers[1].split(",").map((value) => Number(value.trim()));
    expect(parsed.every((value) => value >= 0 && value < MONOREPO_PACKAGE_COUNT)).toBe(true);
  });

  it("drives quick open through the perf bridge", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("runQuickOpenQuery");
    expect(source).toContain('captureTrackerKinds(monorepoPerf, trackerSnapshot, ["quickOpen"])');
  });

  it("records paths that openWorkspaceFile refuses to open", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("failedPaths.push(path)");
    expect(source).toContain("const opened = await bridge.openWorkspaceFile(path);");
    expect(source.match(/\.openWorkspaceFile\(/g)).toHaveLength(1);
  });
});

describe("PERF_SCENARIOS", () => {
  it("has unique ids", () => {
    const ids = PERF_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
