import type { EditorPosition } from "./languageServerFeatures";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

export type TestStatus = "passed" | "failed" | "error" | "skipped";

export interface TestCase {
  name: string | null;
  classname: string | null;
  file: string | null;
  line: number | null;
  time: number | null;
  status: TestStatus;
  message: string | null;
}

export interface TestSuite {
  name: string | null;
  tests: number | null;
  failures: number | null;
  errors: number | null;
  skipped: number | null;
  time: number | null;
  cases: TestCase[];
}

export interface TestTotals {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number | null;
}

export interface TestRunOk {
  status: "ok";
  suites: TestSuite[];
  totals: TestTotals;
}

export type TestRunResponse =
  | TestRunOk
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export interface TestGateway {
  run(rootPath: string, filter?: string): Promise<TestRunResponse>;
}

export interface TestCaseNavigationTarget {
  path: string;
  position: EditorPosition;
}

export function testStatusRank(status: TestStatus): number {
  if (status === "error" || status === "failed") {
    return 0;
  }

  if (status === "skipped") {
    return 1;
  }

  return 2;
}

export function sortTestCasesFailedFirst(
  cases: readonly TestCase[],
): TestCase[] {
  return cases
    .map((testCase, index) => ({ index, testCase }))
    .sort(
      (left, right) =>
        testStatusRank(left.testCase.status) -
          testStatusRank(right.testCase.status) || left.index - right.index,
    )
    .map(({ testCase }) => testCase);
}

export function testSuiteStatus(suite: TestSuite): TestStatus {
  if ((suite.errors ?? 0) > 0) {
    return "error";
  }

  if ((suite.failures ?? 0) > 0) {
    return "failed";
  }

  if ((suite.tests ?? 0) > 0 && suite.skipped === suite.tests) {
    return "skipped";
  }

  return "passed";
}

export function testCaseNavigationTarget(
  rootPath: string,
  testCase: TestCase,
): TestCaseNavigationTarget | null {
  if (
    !testCase.file ||
    (testCase.status !== "failed" && testCase.status !== "error")
  ) {
    return null;
  }

  const file = testCase.file.trim();

  if (!file) {
    return null;
  }

  const relativePath = isAbsolutePath(file)
    ? workspaceRelativePath(rootPath, file)
    : file;

  if (!relativePath) {
    return null;
  }

  return {
    path: joinWorkspacePath(rootPath, relativePath),
    position: {
      column: 1,
      lineNumber: testCase.line && testCase.line > 0 ? testCase.line : 1,
    },
  };
}

export function testCaseCanNavigate(
  rootPath: string,
  testCase: TestCase,
): boolean {
  return testCaseNavigationTarget(rootPath, testCase) !== null;
}

export function testCaseCanRun(testCase: TestCase): boolean {
  if (testCase.status !== "failed" && testCase.status !== "error") {
    return false;
  }

  if (!testCase.name) {
    return false;
  }

  return isValidTestFilter(testCase.name);
}

export function isValidTestFilter(filter: string): boolean {
  if (!filter) {
    return false;
  }

  return !/[\x00-\x1f\x7f]/.test(filter);
}

export function testTotalsSummary(totals: TestTotals): string {
  const failed = totals.failures + totals.errors;
  const parts = [
    `${totals.tests.toLocaleString("en-US")} tests`,
    `${failed.toLocaleString("en-US")} failed`,
    `${totals.skipped.toLocaleString("en-US")} skipped`,
  ];

  if (totals.time !== null) {
    parts.push(
      `${totals.time.toLocaleString("en-US", { maximumFractionDigits: 3 })}s`,
    );
  }

  return parts.join(" · ");
}

function isAbsolutePath(path: string): boolean {
  const normalizedPath = path.split("\\").join("/");

  return (
    normalizedPath.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPath)
  );
}
