import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";

export interface JsTestEditorSurfaceProps {
  readonly jsTestCoverageReport: JsTestCoverageReport | null;
  readonly jsTestProblemCurrentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly jsTestProblemSnapshot: JsTestProblemsSnapshot | null;
}

export interface JsTestEditorSurfaceSource {
  readonly coverageReport: JsTestCoverageReport | null;
  readonly currentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly problemSnapshot: JsTestProblemsSnapshot | null;
}

const inactiveJsTestSurface: JsTestEditorSurfaceProps = Object.freeze({
  jsTestCoverageReport: null,
  jsTestProblemCurrentFileIdentity: null,
  jsTestProblemSnapshot: null,
});

/** Restricts current-file test failures to the active editor group. */
export function jsTestEditorSurfaceProps(
  active: boolean,
  source: JsTestEditorSurfaceSource,
): JsTestEditorSurfaceProps {
  return active
    ? {
        jsTestCoverageReport: source.coverageReport,
        jsTestProblemCurrentFileIdentity: source.currentFileIdentity,
        jsTestProblemSnapshot: source.problemSnapshot,
      }
    : inactiveJsTestSurface;
}
