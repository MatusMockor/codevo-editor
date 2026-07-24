import { describe, expect, it } from "vitest";
import type { PhpCloverCoverageReport } from "./phpCloverCoverage";
import {
  phpCoverageInvalidationIdentitiesEqual,
  projectPhpCoverageForActiveFile,
} from "./phpCoverageProjection";

const report: PhpCloverCoverageReport = {
  files: [
    {
      path: "src/Presenter/HomePresenter.php",
      lines: [
        { lineNumber: 8, hits: 0 },
        { lineNumber: 2, hits: 3 },
        { lineNumber: 8, hits: 2 },
      ],
      summary: { covered: 99, total: 99, percentage: 100 },
      firstUncoveredLine: null,
    },
  ],
  summary: { covered: 99, total: 99, percentage: 100 },
};

const selection = {
  activeFileDirty: false,
  activeFilePath: "/workspace/src/Presenter/HomePresenter.php",
  report,
  workspaceRoot: "/workspace",
} as const;

describe("projectPhpCoverageForActiveFile", () => {
  it("projects sorted unique gutter states and derives rather than trusts summary", () => {
    const projection = projectPhpCoverageForActiveFile(selection);
    expect(projection).toEqual({
      identity: {
        activeFilePath: "/workspace/src/Presenter/HomePresenter.php",
        relativePath: "src/Presenter/HomePresenter.php",
        rootPath: "/workspace",
      },
      lines: [
        { lineNumber: 2, hits: 3, status: "covered" },
        { lineNumber: 8, hits: 2, status: "covered" },
      ],
      summary: { covered: 2, total: 2, percentage: 100 },
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection?.identity)).toBe(true);
    expect(Object.isFrozen(projection?.lines)).toBe(true);
    expect(Object.isFrozen(projection?.lines[0])).toBe(true);
  });

  it("canonicalizes Windows separators, trailing roots, and filesystem-root workspaces", () => {
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        activeFilePath: "C:\\workspace\\src\\Presenter\\HomePresenter.php",
        workspaceRoot: "C:\\workspace\\",
      })?.identity,
    ).toEqual({
      activeFilePath: "C:/workspace/src/Presenter/HomePresenter.php",
      relativePath: "src/Presenter/HomePresenter.php",
      rootPath: "C:/workspace",
    });
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        activeFilePath: "/src/Presenter/HomePresenter.php",
        workspaceRoot: "/",
      })?.lines,
    ).toHaveLength(2);
  });

  it("matches report paths through Windows filesystem case aliases", () => {
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        activeFilePath: "c:\\WORKSPACE\\src\\presenter\\homepresenter.php",
        workspaceRoot: "C:\\workspace",
      })?.lines,
    ).toHaveLength(2);
  });

  it("returns an immutable empty projection for a reported file without executable lines", () => {
    const emptyReport: PhpCloverCoverageReport = {
      files: [
        {
          path: "src/Types.php",
          lines: [],
          summary: { covered: 0, total: 0, percentage: null },
          firstUncoveredLine: null,
        },
      ],
      summary: { covered: 0, total: 0, percentage: null },
    };
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        activeFilePath: "/workspace/src/Types.php",
        report: emptyReport,
      }),
    ).toMatchObject({ lines: [], summary: { covered: 0, total: 0, percentage: null } });
  });

  it.each([
    ["dirty", { activeFileDirty: true }],
    ["missing file", { activeFilePath: null }],
    ["missing root", { workspaceRoot: null }],
    ["missing report", { report: null }],
    ["outside root", { activeFilePath: "/other/HomePresenter.php" }],
    ["prefix collision", { activeFilePath: "/workspace-other/HomePresenter.php" }],
    ["root itself", { activeFilePath: "/workspace" }],
    ["traversal", { activeFilePath: "/workspace/src/../secret.php" }],
    ["repeated separator", { activeFilePath: "/workspace/src//HomePresenter.php" }],
    ["non-PHP", { activeFilePath: "/workspace/src/HomePresenter.ts" }],
    ["unreported PHP", { activeFilePath: "/workspace/src/Missing.php" }],
  ] as const)("fails closed for %s", (_case, overrides) => {
    expect(projectPhpCoverageForActiveFile({ ...selection, ...overrides })).toBeNull();
  });

  it.each([
    { lineNumber: 0, hits: 1 },
    { lineNumber: 1.5, hits: 1 },
    { lineNumber: 1, hits: -1 },
    { lineNumber: 1, hits: Number.POSITIVE_INFINITY },
  ])("fails closed for forged line %#", (line) => {
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        report: {
          ...report,
          files: [{ ...report.files[0]!, lines: [line] }],
        },
      }),
    ).toBeNull();
  });

  it("merges duplicate matching file entries but ignores unsafe unrelated entries", () => {
    const projection = projectPhpCoverageForActiveFile({
      ...selection,
      report: {
        ...report,
        files: [
          ...report.files,
          { ...report.files[0]!, lines: [{ lineNumber: 4, hits: 0 }] },
          { ...report.files[0]!, path: "../secret.php", lines: [{ lineNumber: 1, hits: 1 }] },
        ],
      },
    });
    expect(projection?.lines).toEqual([
      { lineNumber: 2, hits: 3, status: "covered" },
      { lineNumber: 4, hits: 0, status: "uncovered" },
      { lineNumber: 8, hits: 2, status: "covered" },
    ]);
  });

  it("fails closed for a forged non-array or null file collection", () => {
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        report: { ...report, files: null } as unknown as PhpCloverCoverageReport,
      }),
    ).toBeNull();
    expect(
      projectPhpCoverageForActiveFile({
        ...selection,
        report: { ...report, files: [null] } as unknown as PhpCloverCoverageReport,
      }),
    ).toBeNull();
  });
});

describe("phpCoverageInvalidationIdentitiesEqual", () => {
  const identity = projectPhpCoverageForActiveFile(selection)!.identity;

  it("compares every canonical path component", () => {
    expect(phpCoverageInvalidationIdentitiesEqual(identity, { ...identity })).toBe(true);
    expect(
      phpCoverageInvalidationIdentitiesEqual(identity, {
        ...identity,
        activeFilePath: "/workspace/src/Other.php",
      }),
    ).toBe(false);
    expect(
      phpCoverageInvalidationIdentitiesEqual(identity, {
        ...identity,
        relativePath: "src/Other.php",
      }),
    ).toBe(false);
    expect(
      phpCoverageInvalidationIdentitiesEqual(identity, { ...identity, rootPath: "/other" }),
    ).toBe(false);
    expect(phpCoverageInvalidationIdentitiesEqual(null, null)).toBe(true);
    expect(phpCoverageInvalidationIdentitiesEqual(identity, null)).toBe(false);
  });
});
