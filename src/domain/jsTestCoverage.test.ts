import { describe, expect, it } from "vitest";
import { coverageMetric, parseLcovReport } from "./jsTestCoverage";

describe("parseLcovReport", () => {
  it("parses, sorts, summarizes, and merges repeated file records", () => {
    const report = parseLcovReport(
      [
        "TN:",
        "SF:/workspace/src/b.ts",
        "DA:8,0",
        "DA:2,3",
        "FN:2,covered",
        "FNDA:3,covered",
        "BRDA:2,0,0,3",
        "BRDA:8,0,1,-",
        "LF:2",
        "LH:1",
        "end_of_record",
        "SF:/workspace/src/a.ts",
        "DA:1,1,checksum",
        "end_of_record",
        "SF:/workspace/src/b.ts",
        "DA:8,2",
        "DA:10,0",
        "end_of_record",
        "",
      ].join("\n"),
      "/workspace",
    );

    expect(report).toEqual({
      summary: { covered: 3, total: 4, percentage: 75 },
      branches: { covered: 1, total: 2, percentage: 50 },
      functions: { covered: 1, total: 1, percentage: 100 },
      truncated: false,
      files: [
        {
          path: "src/a.ts",
          lines: [{ lineNumber: 1, hits: 1 }],
          summary: { covered: 1, total: 1, percentage: 100 },
          branches: { covered: 0, total: 0, percentage: null },
          functions: { covered: 0, total: 0, percentage: null },
          firstUncoveredLine: null,
        },
        {
          path: "src/b.ts",
          lines: [
            { lineNumber: 2, hits: 3 },
            { lineNumber: 8, hits: 2 },
            { lineNumber: 10, hits: 0 },
          ],
          summary: { covered: 2, total: 3, percentage: (2 / 3) * 100 },
          branches: { covered: 1, total: 2, percentage: 50 },
          functions: { covered: 1, total: 1, percentage: 100 },
          firstUncoveredLine: 10,
        },
      ],
    });
  });

  it("accepts safe workspace-relative paths and Windows separators", () => {
    expect(
      parseLcovReport("SF:src\\math.ts\nDA:1,0\nend_of_record\n", "C:\\workspace"),
    ).toMatchObject({ files: [{ path: "src/math.ts", firstUncoveredLine: 1 }] });
  });

  it("represents reports and files without executable lines", () => {
    expect(parseLcovReport("SF:src/types.ts\nend_of_record\n", "/workspace")).toEqual({
      summary: { covered: 0, total: 0, percentage: null },
      branches: { covered: 0, total: 0, percentage: null },
      functions: { covered: 0, total: 0, percentage: null },
      truncated: false,
      files: [
        {
          path: "src/types.ts",
          lines: [],
          summary: { covered: 0, total: 0, percentage: null },
          branches: { covered: 0, total: 0, percentage: null },
          functions: { covered: 0, total: 0, percentage: null },
          firstUncoveredLine: null,
        },
      ],
    });
  });

  it.each([
    ["DA before SF", "DA:1,1\n", "outside an SF record"],
    ["nested SF", "SF:src/a.ts\nSF:src/b.ts\n", "nested SF"],
    ["missing terminator", "SF:src/a.ts\nDA:1,1\n", "unterminated"],
    ["bad line", "SF:src/a.ts\nDA:0,1\nend_of_record\n", "DA line is invalid"],
    ["bad hits", "SF:src/a.ts\nDA:1,-1\nend_of_record\n", "DA hits is invalid"],
    ["BRDA before SF", "BRDA:1,0,0,1\n", "outside an SF record"],
    ["bad BRDA", "SF:src/a.ts\nBRDA:1,0,0,bad\nend_of_record\n", "BRDA hits is invalid"],
    ["signed BRDA", "SF:src/a.ts\nBRDA:+1,+0,+0,+1\nend_of_record\n", "BRDA line is invalid"],
    [
      "zero-padded BRDA line",
      "SF:src/a.ts\nBRDA:01,0,0,1\nend_of_record\n",
      "BRDA line is invalid",
    ],
    ["FN before SF", "FN:1,fn\n", "outside an SF record"],
    ["bad FN", "SF:src/a.ts\nFN:1,\nend_of_record\n", "malformed FN record"],
    ["signed FN line", "SF:src/a.ts\nFN:+1,fn\nend_of_record\n", "FN line is invalid"],
    ["zero-padded FN line", "SF:src/a.ts\nFN:01,fn\nend_of_record\n", "FN line is invalid"],
    ["bad FNDA", "SF:src/a.ts\nFNDA:bad,fn\nend_of_record\n", "FNDA hits is invalid"],
    ["bad summary count", "SF:src/a.ts\nBRF:bad\nend_of_record\n", "summary count is invalid"],
    ["unsafe hits", `SF:src/a.ts\nDA:1,${Number.MAX_SAFE_INTEGER + 1}\nend_of_record\n`, "unsafe"],
    ["unknown record", "SF:src/a.ts\nXX:1\nend_of_record\n", "unsupported record"],
    ["garbage outside record", "garbage\n", "unsupported record"],
    ["outside absolute path", "SF:/other/a.ts\nend_of_record\n", "workspace-relative"],
    ["traversal", "SF:src/../secret.ts\nend_of_record\n", "workspace-relative"],
    ["empty segment", "SF:src//a.ts\nend_of_record\n", "workspace-relative"],
    ["control path", "SF:src/a\0.ts\nend_of_record\n", "invalid SF path"],
  ])("rejects %s", (_name, source, message) => {
    expect(() => parseLcovReport(source, "/workspace")).toThrow(message);
  });

  it("enforces byte, file, path, and line-record bounds", () => {
    expect(() => parseLcovReport("12345", "/workspace", { maxLcovBytes: 4 })).toThrow(
      "exceeds 4 UTF-8 bytes",
    );
    expect(() =>
      parseLcovReport("SF:a.ts\nend_of_record\nSF:b.ts\nend_of_record\n", "/workspace", {
        maxFiles: 1,
      }),
    ).toThrow("exceeds 1 files");
    expect(() =>
      parseLcovReport("SF:long.ts\nend_of_record\n", "/workspace", { maxPathBytes: 4 }),
    ).toThrow("invalid SF path");
    expect(() =>
      parseLcovReport("SF:a.ts\nDA:1,0\nDA:2,0\nend_of_record\n", "/workspace", {
        maxLineRecords: 1,
      }),
    ).toThrow("exceeds 1 line records");
  });

  it("truncates branch and function records at explicit deterministic bounds", () => {
    expect(
      parseLcovReport(
        "SF:a.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,1\nFN:1,kept\nFNDA:1,kept\nFN:1,discarded\nend_of_record\n",
        "/workspace",
        { maxBranchRecords: 1, maxFunctionRecords: 2 },
      ),
    ).toMatchObject({
      branches: { covered: 1, total: 1 },
      functions: { covered: 1, total: 1 },
      truncated: true,
    });
  });

  it("merges duplicate branch and function identities additively", () => {
    expect(
      parseLcovReport(
        "SF:a.ts\nBRDA:1,0,0,-\nFN:1,fn\nend_of_record\nSF:a.ts\nBRDA:1,0,0,2\nFNDA:3,fn\nend_of_record\n",
        "/workspace",
      ),
    ).toMatchObject({
      branches: { covered: 1, total: 1 },
      functions: { covered: 1, total: 1 },
      files: [
        {
          branches: { covered: 1, total: 1 },
          functions: { covered: 1, total: 1 },
        },
      ],
    });
  });

  it("rejects unsafe accumulated duplicate hit counts", () => {
    expect(() =>
      parseLcovReport(
        `SF:a.ts\nDA:1,${Number.MAX_SAFE_INTEGER}\nend_of_record\nSF:a.ts\nDA:1,1\nend_of_record\n`,
        "/workspace",
      ),
    ).toThrow("accumulated hit count is unsafe");
  });

  it("rejects invalid parser limits", () => {
    expect(() => parseLcovReport("", "/workspace", { maxFiles: 0 })).toThrow(
      "maxFiles must be a positive safe integer",
    );
  });
});

describe("coverageMetric", () => {
  it("derives percentages and the empty-state null", () => {
    expect(coverageMetric(1, 4)).toEqual({ covered: 1, total: 4, percentage: 25 });
    expect(coverageMetric(0, 0)).toEqual({ covered: 0, total: 0, percentage: null });
  });

  it.each([
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects invalid counts %s/%s", (covered, total) => {
    expect(() => coverageMetric(covered, total)).toThrow();
  });
});
