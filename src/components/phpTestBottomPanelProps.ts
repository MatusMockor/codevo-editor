import type { PhpCloverCoverageState } from "../application/usePhpCloverCoverage";
import type { PhpTestResultsState } from "../application/usePhpTestResults";
import type { PhpCoverageMetric } from "../domain/phpCloverCoverage";
import type { PhpTestCase, PhpTestRunOk } from "../domain/phpTestResults";

export interface PhpTestBottomPanelProps {
  readonly onClearPhpTestCoverage: () => void;
  readonly onOpenPhpTestCase: (testCase: PhpTestCase) => void;
  readonly onRunPhpTestCase: (testCase: PhpTestCase) => void;
  readonly onRunPhpTestCoverage: () => void;
  readonly onRunPhpTests: () => void;
  readonly phpTestCanRunCoverage: boolean;
  readonly phpTestCoverageError: string | null;
  readonly phpTestCoverageRunning: boolean;
  readonly phpTestCoverageSummary: PhpCoverageMetric | null;
  readonly phpTestCoverageUnavailable: string | null;
  readonly phpTestError: string | null;
  readonly phpTestFilter: string | null;
  readonly phpTestIsRunning: boolean;
  readonly phpTestResult: PhpTestRunOk | null;
  readonly phpTestUnavailable: string | null;
}

/** Maps headless PHP test controllers to the presentation-only BottomPanel contract. */
export function phpTestBottomPanelProps(
  coverage: PhpCloverCoverageState,
  results: PhpTestResultsState,
  onOpenTestCase: (testCase: PhpTestCase) => void | Promise<unknown>,
): PhpTestBottomPanelProps {
  return {
    onClearPhpTestCoverage: coverage.clear,
    onOpenPhpTestCase: (testCase) => void onOpenTestCase(testCase),
    onRunPhpTestCase: (testCase) => void results.runCase(testCase),
    onRunPhpTestCoverage: () => void coverage.run(),
    onRunPhpTests: () => void results.run(),
    phpTestCanRunCoverage: coverage.canRun(),
    phpTestCoverageError: coverage.error,
    phpTestCoverageRunning: coverage.isRunning,
    phpTestCoverageSummary: coverage.report?.summary ?? null,
    phpTestCoverageUnavailable: coverage.unavailable,
    phpTestError: results.error,
    phpTestFilter: results.filter,
    phpTestIsRunning: results.isRunning,
    phpTestResult: results.result,
    phpTestUnavailable: results.unavailable,
  };
}
