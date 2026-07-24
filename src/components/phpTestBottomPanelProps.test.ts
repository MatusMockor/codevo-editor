import { describe, expect, it, vi } from "vitest";
import type { PhpCloverCoverageState } from "../application/usePhpCloverCoverage";
import type { PhpTestResultsState } from "../application/usePhpTestResults";
import type { PhpTestCase } from "../domain/phpTestResults";
import { phpTestBottomPanelProps } from "./phpTestBottomPanelProps";

const testCase: PhpTestCase = {
  classname: "Tests\\HomeTest",
  file: "tests/HomeTest.php",
  line: 12,
  message: null,
  name: "testHome",
  status: "passed",
  time: 0.01,
};

describe("phpTestBottomPanelProps", () => {
  it("projects controller state and delegates every action without exposing promises", () => {
    const clear = vi.fn();
    const coverageRun = vi.fn(async () => true);
    const openTestCase = vi.fn(async () => true);
    const resultsRun = vi.fn(async () => undefined);
    const runCase = vi.fn(async () => undefined);
    const coverage: PhpCloverCoverageState = {
      canRun: () => true,
      clear,
      error: "coverage error",
      isRunning: true,
      report: {
        files: [],
        summary: { covered: 7, percentage: 70, total: 10 },
      },
      run: coverageRun,
      unavailable: "coverage unavailable",
    };
    const results: PhpTestResultsState = {
      clear: vi.fn(),
      error: "test error",
      filter: "HomeTest",
      isRunning: false,
      result: {
        status: "ok",
        suites: [],
        totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
      },
      run: resultsRun,
      runCase,
      suites: [],
      totals: null,
      unavailable: "tests unavailable",
    };

    const props = phpTestBottomPanelProps(coverage, results, openTestCase);

    expect(props).toMatchObject({
      phpTestCanRunCoverage: true,
      phpTestCoverageError: "coverage error",
      phpTestCoverageRunning: true,
      phpTestCoverageSummary: { covered: 7, percentage: 70, total: 10 },
      phpTestCoverageUnavailable: "coverage unavailable",
      phpTestError: "test error",
      phpTestFilter: "HomeTest",
      phpTestIsRunning: false,
      phpTestUnavailable: "tests unavailable",
    });
    expect(props.onClearPhpTestCoverage()).toBeUndefined();
    expect(props.onOpenPhpTestCase(testCase)).toBeUndefined();
    expect(props.onRunPhpTestCase(testCase)).toBeUndefined();
    expect(props.onRunPhpTestCoverage()).toBeUndefined();
    expect(props.onRunPhpTests()).toBeUndefined();
    expect(clear).toHaveBeenCalledOnce();
    expect(openTestCase).toHaveBeenCalledWith(testCase);
    expect(runCase).toHaveBeenCalledWith(testCase);
    expect(coverageRun).toHaveBeenCalledOnce();
    expect(resultsRun).toHaveBeenCalledOnce();
  });
});
