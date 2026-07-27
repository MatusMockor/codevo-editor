import type {
  JsTestCoverageLine,
  JsTestCoverageReport,
  JsTestFileCoverage,
} from "./jsTestCoverage";

export type JsTestCoverageDecorationStatus = "covered" | "uncovered";

export interface JsTestCoverageReportIndex {
  readonly report: JsTestCoverageReport;
  find(relativePath: string | null): JsTestFileCoverage | null;
}

interface JsTestCoverageLineDecorationBase {
  readonly hits: number;
  readonly lineNumber: number;
  readonly status: JsTestCoverageDecorationStatus;
  readonly visibleRangesTruncated?: boolean;
}

export type JsTestCoverageLineDecoration = JsTestCoverageLineDecorationBase &
  (
    | {
        readonly hitCountsTruncated?: false;
        readonly renderInlineHitCount?: true;
      }
    | {
        readonly hitCountsTruncated: true;
        readonly renderInlineHitCount: boolean;
      }
  );

/**
 * Builds one immutable lookup facade for one decoded report. Callers own the
 * facade for exactly the report identity they captured, so tab and viewport
 * changes never rescan the full file list.
 */
export function createJsTestCoverageReportIndex(
  report: JsTestCoverageReport,
): JsTestCoverageReportIndex {
  const files = new Map<string, JsTestFileCoverage>();
  for (const file of report.files) files.set(file.path, file);
  return Object.freeze({
    report,
    find(relativePath: string | null): JsTestFileCoverage | null {
      const path = normalizedRelativePath(relativePath);
      return path ? (files.get(path) ?? null) : null;
    },
  });
}

export function jsTestCoverageDecorationForLine(
  line: JsTestCoverageLine,
): JsTestCoverageLineDecoration {
  return {
    hits: line.hits,
    lineNumber: line.lineNumber,
    status: line.hits > 0 ? "covered" : "uncovered",
  };
}

function normalizedRelativePath(path: string | null): string | null {
  if (!path || /[\x00-\x1f\x7f]/.test(path)) return null;
  const normalized = path.split("\\").join("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}
