import { describe, expect, it, vi } from "vitest";
import {
  decodeJsTestCoverageResponse,
  TauriJsTestCoverageGateway,
} from "./tauriJsTestCoverageGateway";

const validResponse = {
  status: "ok",
  report: {
    summary: { covered: 1, total: 2, percentage: 50 },
    files: [
      {
        path: "src/math.ts",
        lines: [
          { lineNumber: 1, hits: 2 },
          { lineNumber: 3, hits: 0 },
        ],
        summary: { covered: 1, total: 2, percentage: 50 },
        firstUncoveredLine: 3,
      },
    ],
  },
} as const;

describe("TauriJsTestCoverageGateway", () => {
  it("invokes the coverage command with the workspace root", async () => {
    const invoke = vi.fn(async () => validResponse);
    await expect(new TauriJsTestCoverageGateway(invoke).run("/workspace")).resolves.toEqual(
      validResponse,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_test_coverage_json", {
      rootPath: "/workspace",
    });
  });

  it.each(["", "bad\0root", "bad\nroot"])('rejects unsafe root "%s" before IPC', async (root) => {
    const invoke = vi.fn();
    await expect(new TauriJsTestCoverageGateway(invoke).run(root)).rejects.toThrow(
      "workspace root",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("decodeJsTestCoverageResponse", () => {
  it("strictly decodes a consistent coverage report", () => {
    expect(decodeJsTestCoverageResponse(validResponse)).toEqual(validResponse);
  });

  it.each(["unavailable", "error"] as const)("decodes %s responses", (status) => {
    expect(decodeJsTestCoverageResponse({ status, message: "Coverage provider missing." })).toEqual(
      {
        status,
        message: "Coverage provider missing.",
      },
    );
  });

  it.each([
    ["unknown response field", { ...validResponse, extra: true }, "response.extra"],
    ["unknown status", { status: "done", report: validResponse.report }, "response.status"],
    ["missing report", { status: "ok" }, "response.report"],
    ["absolute path", withFile({ path: "/workspace/src/math.ts" }), ".path"],
    ["drive path", withFile({ path: "C:\\workspace\\src\\math.ts" }), ".path"],
    ["traversal path", withFile({ path: "src/../math.ts" }), ".path"],
    [
      "duplicate path",
      withFiles([validResponse.report.files[0], validResponse.report.files[0]]),
      "unique",
    ],
    [
      "duplicate line",
      withFile({
        lines: [
          { lineNumber: 1, hits: 1 },
          { lineNumber: 1, hits: 0 },
        ],
      }),
      "increasing",
    ],
    [
      "unsorted line",
      withFile({
        lines: [
          { lineNumber: 2, hits: 1 },
          { lineNumber: 1, hits: 0 },
        ],
      }),
      "increasing",
    ],
    ["zero line", withFile({ lines: [{ lineNumber: 0, hits: 1 }] }), "positive safe"],
    ["negative hits", withFile({ lines: [{ lineNumber: 1, hits: -1 }] }), "non-negative"],
    [
      "non-finite hits",
      withFile({ lines: [{ lineNumber: 1, hits: Number.POSITIVE_INFINITY }] }),
      "non-negative",
    ],
    [
      "unsafe hits",
      withFile({ lines: [{ lineNumber: 1, hits: Number.MAX_SAFE_INTEGER + 1 }] }),
      "non-negative",
    ],
    [
      "wrong file counts",
      withFile({ summary: { covered: 2, total: 2, percentage: 100 } }),
      "matching",
    ],
    [
      "wrong aggregate",
      {
        ...validResponse,
        report: { ...validResponse.report, summary: { covered: 2, total: 2, percentage: 100 } },
      },
      "matching",
    ],
    [
      "wrong percentage",
      withFile({ summary: { covered: 1, total: 2, percentage: 49 } }),
      "derived",
    ],
    [
      "NaN percentage",
      withFile({ summary: { covered: 1, total: 2, percentage: Number.NaN } }),
      "derived",
    ],
    ["non-null empty percentage", emptyResponse({ covered: 0, total: 0, percentage: 0 }), "null"],
    ["wrong first uncovered", withFile({ firstUncoveredLine: 1 }), "derived"],
    ["unknown line field", withFile({ lines: [{ lineNumber: 1, hits: 1, branch: 1 }] }), "branch"],
    ["control message", { status: "error", message: "bad\0message" }, "message"],
  ])("rejects %s", (_name, response, expected) => {
    expect(() => decodeJsTestCoverageResponse(response)).toThrow(String(expected));
  });

  it("enforces file and line record caps", () => {
    const repeatedFiles = Array.from({ length: 20_001 }, (_, index) => ({
      path: `src/${index}.ts`,
      lines: [],
      summary: { covered: 0, total: 0, percentage: null },
      firstUncoveredLine: null,
    }));
    expect(() =>
      decodeJsTestCoverageResponse({
        status: "ok",
        report: { summary: { covered: 0, total: 0, percentage: null }, files: repeatedFiles },
      }),
    ).toThrow("at most 20000 files");

    const tooManyLines = Array.from({ length: 1_000_001 }, (_, index) => ({
      lineNumber: index + 1,
      hits: 0,
    }));
    expect(() => decodeJsTestCoverageResponse(withFile({ lines: tooManyLines }))).toThrow(
      "at most 1000000 line records",
    );
  });
});

function withFile(overrides: Record<string, unknown>) {
  return {
    ...validResponse,
    report: {
      ...validResponse.report,
      files: [{ ...validResponse.report.files[0], ...overrides }],
    },
  };
}

function withFiles(files: readonly unknown[]) {
  return { ...validResponse, report: { ...validResponse.report, files } };
}

function emptyResponse(summary: Record<string, unknown>) {
  return { status: "ok", report: { summary, files: [] } };
}
