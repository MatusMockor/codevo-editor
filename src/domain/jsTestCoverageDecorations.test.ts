import { describe, expect, it } from "vitest";
import type { JsTestCoverageReport } from "./jsTestCoverage";
import {
  jsTestCoverageDecorationsForFile,
  MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS,
} from "./jsTestCoverageDecorations";

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
      branches: { covered: 0, percentage: null, total: 0 },
      functions: { covered: 0, percentage: null, total: 0 },
    },
  ],
  summary: { covered: 2, percentage: (2 / 3) * 100, total: 3 },
  branches: { covered: 0, percentage: null, total: 0 },
  functions: { covered: 0, percentage: null, total: 0 },
  truncated: false,
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

  it("a file exceeding the inline hit-count cap keeps band decorations, truncates hit-count content deterministically, and reports truncation", () => {
    const lineCount = MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS + 2;
    const lines = Array.from({ length: lineCount }, (_, index) => ({
      hits: index + 1,
      lineNumber: lineCount - index,
    }));
    const overflowingReport: JsTestCoverageReport = {
      ...report,
      files: [
        {
          ...report.files[0]!,
          lines,
          summary: { covered: lineCount, percentage: 100, total: lineCount },
        },
      ],
    };

    const decorations = jsTestCoverageDecorationsForFile(overflowingReport, "src/math.ts");

    expect(decorations).toHaveLength(lineCount);
    expect(decorations.map(({ lineNumber }) => lineNumber)).toEqual(
      Array.from({ length: lineCount }, (_, index) => index + 1),
    );
    expect(decorations.every(({ hitCountsTruncated }) => hitCountsTruncated)).toBe(true);
    expect(
      decorations
        .filter(({ renderInlineHitCount }) => renderInlineHitCount !== false)
        .map(({ lineNumber }) => lineNumber),
    ).toEqual(
      Array.from(
        { length: MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS },
        (_, index) => index + 1,
      ),
    );
    expect(
      decorations
        .filter(({ renderInlineHitCount }) => renderInlineHitCount === false)
        .map(({ lineNumber }) => lineNumber),
    ).toEqual([
      MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS + 1,
      MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS + 2,
    ]);
    expect(overflowingReport.files[0]?.lines).toEqual(lines);
  });
});
