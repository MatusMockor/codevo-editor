import { describe, expect, it } from "vitest";
import { buildGapReport, renderGapReportMarkdown, DEFAULT_TOLERANCES } from "./gapReport.mjs";

const codevo = {
  scenarios: [
    { id: "typing-large-20k", p95: 10 },
    { id: "references-large-20k", p95: 160 },
    { id: "rename-large-20k", p95: 0, skipped: true },
  ],
};
const baseline = {
  scenarios: [
    { id: "typing-large-20k", p95: 8 },
    { id: "references-large-20k", p95: 100 },
  ],
};

describe("buildGapReport", () => {
  it("marks pass and fail against the right budgets", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    const typing = report.rows.find((row) => row.id === "typing-large-20k");
    expect(typing.budget).toBe(1.25);
    expect(typing.status).toBe("pass");
    const references = report.rows.find((row) => row.id === "references-large-20k");
    expect(references.budget).toBe(1.5);
    expect(references.status).toBe("fail");
    expect(report.failures).toHaveLength(1);
  });

  it("marks skipped and missing-baseline rows", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    expect(report.rows.find((row) => row.id === "rename-large-20k").status).toBe("skipped");
  });
});

describe("renderGapReportMarkdown", () => {
  it("renders one table row per scenario", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    const markdown = renderGapReportMarkdown(report);
    expect(markdown).toContain("| typing-large-20k |");
    expect(markdown).toContain("1.25");
  });
});

const realShapeCodevo = {
  scenarios: [
    { id: "typing-large-20k", unit: "ms", samples: [8, 9, 10], p50: 9, p95: 9 },
    {
      id: "rename-large-20k",
      unit: "ms",
      status: "skipped",
      reason: "Rename produced no latency tracker data.",
    },
    {
      id: "memory-sample",
      unit: "count-bytes",
      retainedCounts: { models: 1, editors: 2 },
      memorySample: { usedJsHeapBytes: 123 },
    },
    { id: "startup-cold", unit: "ms", samples: [5], p50: 5, p95: 5 },
  ],
  failedPaths: ["src/foo.ts", "src/bar.ts"],
};
const realShapeBaseline = {
  scenarios: [
    { id: "typing-large-20k", p95: 8 },
    { id: "rename-large-20k", p95: 50 },
    { id: "startup-cold", p95: 4 },
    { id: "completion-large-20k", p95: 12 },
  ],
};

describe("buildGapReport against real codevo-*.json shape", () => {
  it("detects skipped scenarios via status, never producing NaN", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    const rename = report.rows.find((row) => row.id === "rename-large-20k");
    expect(rename.status).toBe("skipped");
    expect(rename.codevoP95).toBeNull();
    expect(rename.ratio).toBeNull();
    expect(Number.isNaN(rename.ratio)).toBe(false);
  });

  it("excludes the memory-sample scenario from rows", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    expect(report.rows.find((row) => row.id === "memory-sample")).toBeUndefined();
  });

  it("adds a no-result row for baseline ids missing from the codevo run", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    const completion = report.rows.find((row) => row.id === "completion-large-20k");
    expect(completion.status).toBe("no-result");
    expect(completion.codevoP95).toBeNull();
    expect(completion.vscodeP95).toBe(12);
    expect(completion.ratio).toBeNull();
  });

  it("marks ids matching no tolerance pattern as no-budget instead of pass", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    const startup = report.rows.find((row) => row.id === "startup-cold");
    expect(startup.budget).toBeNull();
    expect(startup.status).toBe("no-budget");
  });

  it("never marks no-result or no-budget rows as failures", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    expect(report.failures).toHaveLength(0);
  });

  it("surfaces failedPaths on the report", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    expect(report.failedPaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });
});

describe("renderGapReportMarkdown with real-shape data", () => {
  it("renders a failed-paths note when failedPaths is non-empty", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    const markdown = renderGapReportMarkdown(report);
    expect(markdown).toContain("Failed paths: 2");
    expect(markdown).toContain("src/foo.ts");
    expect(markdown).toContain("src/bar.ts");
  });

  it("never renders a literal NaN", () => {
    const report = buildGapReport({
      codevo: realShapeCodevo,
      baseline: realShapeBaseline,
      tolerances: DEFAULT_TOLERANCES,
    });
    const markdown = renderGapReportMarkdown(report);
    expect(markdown).not.toContain("NaN");
  });
});
