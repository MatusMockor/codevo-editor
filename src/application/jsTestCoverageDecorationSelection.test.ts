import { describe, expect, it } from "vitest";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { createJsTestCoverageReportIndex } from "../domain/jsTestCoverageDecorations";
import {
  selectActiveJsTestCoverageFile,
  type ActiveJsTestCoverageDecorationSelection,
} from "./jsTestCoverageDecorationSelection";

const report: JsTestCoverageReport = {
  files: [
    {
      firstUncoveredLine: 2,
      lines: [
        { hits: 1, lineNumber: 1 },
        { hits: 0, lineNumber: 2 },
      ],
      path: "src/example.ts",
      summary: { covered: 1, percentage: 50, total: 2 },
      branches: { covered: 0, percentage: null, total: 0 },
      functions: { covered: 0, percentage: null, total: 0 },
    },
  ],
  summary: { covered: 1, percentage: 50, total: 2 },
  branches: { covered: 0, percentage: null, total: 0 },
  functions: { covered: 0, percentage: null, total: 0 },
  truncated: false,
};

const selection: ActiveJsTestCoverageDecorationSelection = {
  activeFileDirty: false,
  activeFilePath: "/workspace/src/example.ts",
  rootPath: "/workspace",
  snapshot: {
    index: createJsTestCoverageReportIndex(report),
    report,
    rootPath: "/workspace",
    workspaceId: "workspace-a",
  },
  workspaceId: "workspace-a",
};

describe("selectActiveJsTestCoverageFile", () => {
  it("selects the indexed file for the unchanged active workspace file", () => {
    expect(selectActiveJsTestCoverageFile(selection)).toBe(report.files[0]);
  });

  it("accepts equivalent roots with trailing or Windows separators", () => {
    expect(
      selectActiveJsTestCoverageFile({
        ...selection,
        activeFilePath: "C:\\workspace\\src\\example.ts",
        rootPath: "C:\\workspace\\",
        snapshot: {
          index: createJsTestCoverageReportIndex(report),
          report,
          rootPath: "C:\\workspace",
          workspaceId: "workspace-a",
        },
      }),
    ).toBe(report.files[0]);
  });

  it.each([
    ["missing snapshot", { snapshot: null }],
    ["stale workspace identity", { workspaceId: "workspace-b" }],
    ["stale root", { rootPath: "/workspace-b" }],
    ["outside active file", { activeFilePath: "/other/example.ts" }],
    ["missing active file", { activeFilePath: null }],
    ["dirty active file", { activeFileDirty: true }],
    ["JSON active file", { activeFilePath: "/workspace/src/example.json" }],
    ["Vue active file", { activeFilePath: "/workspace/src/example.vue" }],
  ] satisfies readonly [string, Partial<ActiveJsTestCoverageDecorationSelection>][])(
    "fails closed for %s",
    (_name, overrides) => {
      expect(selectActiveJsTestCoverageFile({ ...selection, ...overrides })).toBeNull();
    },
  );

  it("supports a filesystem-root workspace without prefix confusion", () => {
    expect(
      selectActiveJsTestCoverageFile({
        ...selection,
        activeFilePath: "/src/example.ts",
        rootPath: "/",
        snapshot: {
          index: createJsTestCoverageReportIndex(report),
          report,
          rootPath: "/",
          workspaceId: "workspace-a",
        },
      }),
    ).toBe(report.files[0]);
  });

  it.each(["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"])(
    "supports the .%s JavaScript/TypeScript editor extension",
    (extension) => {
      const path = `src/example.${extension}`;
      const extensionReport: JsTestCoverageReport = {
        ...report,
        files: [{ ...report.files[0]!, path }],
      };
      expect(
        selectActiveJsTestCoverageFile({
          ...selection,
          activeFilePath: `/workspace/${path}`,
          snapshot: {
            index: createJsTestCoverageReportIndex(extensionReport),
            report: extensionReport,
            rootPath: "/workspace",
            workspaceId: "workspace-a",
          },
        }),
      ).toBe(extensionReport.files[0]);
    },
  );

  it("rejects an index retained from an A owner after report identity changes A-B-A", () => {
    const replacement = { ...report, files: [...report.files] };
    expect(
      selectActiveJsTestCoverageFile({
        ...selection,
        snapshot: {
          index: createJsTestCoverageReportIndex(report),
          report: replacement,
          rootPath: "/workspace",
          workspaceId: "workspace-a",
        },
      }),
    ).toBeNull();
  });
});
