import { describe, expect, it } from "vitest";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import {
  selectActiveJsTestCoverageDecorations,
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
  snapshot: { report, rootPath: "/workspace", workspaceId: "workspace-a" },
  workspaceId: "workspace-a",
};

describe("selectActiveJsTestCoverageDecorations", () => {
  it("selects decorations for the unchanged active workspace file", () => {
    expect(selectActiveJsTestCoverageDecorations(selection)).toEqual([
      { hits: 1, lineNumber: 1, status: "covered" },
      { hits: 0, lineNumber: 2, status: "uncovered" },
    ]);
  });

  it("accepts equivalent roots with trailing or Windows separators", () => {
    expect(
      selectActiveJsTestCoverageDecorations({
        ...selection,
        activeFilePath: "C:\\workspace\\src\\example.ts",
        rootPath: "C:\\workspace\\",
        snapshot: { report, rootPath: "C:\\workspace", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(2);
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
      expect(selectActiveJsTestCoverageDecorations({ ...selection, ...overrides })).toEqual([]);
    },
  );

  it("supports a filesystem-root workspace without prefix confusion", () => {
    expect(
      selectActiveJsTestCoverageDecorations({
        ...selection,
        activeFilePath: "/src/example.ts",
        rootPath: "/",
        snapshot: { report, rootPath: "/", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(2);
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
        selectActiveJsTestCoverageDecorations({
          ...selection,
          activeFilePath: `/workspace/${path}`,
          snapshot: { report: extensionReport, rootPath: "/workspace", workspaceId: "workspace-a" },
        }),
      ).toHaveLength(2);
    },
  );
});
