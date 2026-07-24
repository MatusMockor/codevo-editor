import { describe, expect, it } from "vitest";
import type { JsTestCoverageReport } from "./jsTestCoverage";
import { jsTestCoverageDecorationsForFile } from "./jsTestCoverageDecorations";

const report: JsTestCoverageReport = {
  files: [
    {
      firstUncoveredLine: 3,
      lines: [
        { hits: 4, lineNumber: 1 },
        { hits: 0, lineNumber: 3 },
        { hits: 1, lineNumber: 8 },
      ],
      path: "src/math.ts",
      summary: { covered: 2, percentage: (2 / 3) * 100, total: 3 },
    },
  ],
  summary: { covered: 2, percentage: (2 / 3) * 100, total: 3 },
};

describe("jsTestCoverageDecorationsForFile", () => {
  it("projects covered and uncovered lines without Monaco details", () => {
    expect(jsTestCoverageDecorationsForFile(report, "src/math.ts")).toEqual([
      { hits: 4, lineNumber: 1, status: "covered" },
      { hits: 0, lineNumber: 3, status: "uncovered" },
      { hits: 1, lineNumber: 8, status: "covered" },
    ]);
  });

  it("normalizes safe Windows separators for lookup", () => {
    expect(jsTestCoverageDecorationsForFile(report, "src\\math.ts")).toHaveLength(3);
  });

  it.each([null, "", "src/other.ts", "/workspace/src/math.ts", "../math.ts", "src//math.ts"])(
    "fails closed for absent or unsafe lookup path %s",
    (path) => {
      expect(jsTestCoverageDecorationsForFile(report, path)).toEqual([]);
    },
  );

  it("returns a detached projection and never mutates report lines", () => {
    const decorations = jsTestCoverageDecorationsForFile(report, "src/math.ts");
    expect(decorations).not.toBe(report.files[0]?.lines);
    expect(report.files[0]?.lines[0]).toEqual({ hits: 4, lineNumber: 1 });
  });
});
