import type { JsTestCoverageReport } from "./jsTestCoverage";

export type JsTestCoverageDecorationStatus = "covered" | "uncovered";

export interface JsTestCoverageLineDecoration {
  readonly hits: number;
  readonly lineNumber: number;
  readonly status: JsTestCoverageDecorationStatus;
}

/**
 * Projects a decoded coverage report to editor-neutral line markers for one
 * workspace-relative file. The report decoder owns numeric/path validation;
 * this projection still fails closed for unsafe lookup paths so callers cannot
 * accidentally match a file outside the active workspace.
 */
export function jsTestCoverageDecorationsForFile(
  report: JsTestCoverageReport | null,
  relativePath: string | null,
): readonly JsTestCoverageLineDecoration[] {
  const path = normalizedRelativePath(relativePath);
  if (!report || !path) return [];
  const file = report.files.find((candidate) => candidate.path === path);
  if (!file) return [];
  return file.lines.map((line) => ({
    hits: line.hits,
    lineNumber: line.lineNumber,
    status: line.hits > 0 ? "covered" : "uncovered",
  }));
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
