import { describe, expect, it } from "vitest";
import type { JsTestCoverageReport } from "./jsTestCoverage";
import {
  createJsTestCoverageReportIndex,
  jsTestCoverageDecorationForLine,
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

describe("JavaScript test coverage decoration domain", () => {
  it("indexes one immutable report and projects individual lines without Monaco details", () => {
    const index = createJsTestCoverageReportIndex(report);

    expect(index.report).toBe(report);
    expect(index.find("src/math.ts")).toBe(report.files[0]);
    expect(jsTestCoverageDecorationForLine(report.files[0]!.lines[0]!)).toEqual({
      hits: 4,
      lineNumber: 1,
      status: "covered",
    });
    expect(jsTestCoverageDecorationForLine(report.files[0]!.lines[1]!)).toEqual({
      hits: 0,
      lineNumber: 3,
      status: "uncovered",
    });
  });

  it("normalizes safe Windows separators for lookup", () => {
    expect(createJsTestCoverageReportIndex(report).find("src\\math.ts")).toBe(report.files[0]);
  });

  it.each([null, "", "src/other.ts", "/workspace/src/math.ts", "../math.ts", "src//math.ts"])(
    "fails closed for absent or unsafe lookup path %s",
    (path) => {
      expect(createJsTestCoverageReportIndex(report).find(path)).toBeNull();
    },
  );

  it("builds a 20k-file index once and performs later lookups without rescanning report files", () => {
    const files = Array.from({ length: 20_000 }, (_, index) => ({
      ...report.files[0]!,
      path: `src/file-${index}.ts`,
    }));
    let indexReads = 0;
    let built = false;
    const guardedFiles = new Proxy(files, {
      get(target, property, receiver) {
        if (built && typeof property === "string" && /^\d+$/.test(property)) {
          indexReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const largeReport: JsTestCoverageReport = {
      ...report,
      files: guardedFiles,
    };

    const index = createJsTestCoverageReportIndex(largeReport);
    built = true;
    for (let lookup = 0; lookup < 1_000; lookup += 1) {
      expect(index.find("src/file-19999.ts")?.path).toBe("src/file-19999.ts");
    }
    expect(indexReads).toBe(0);
  });
});
