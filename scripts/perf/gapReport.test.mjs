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
