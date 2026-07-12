import type { EditorPosition } from "./languageServerFeatures";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

export type PhpTestStatus = "passed" | "failed" | "error" | "skipped";

export interface PhpTestCase {
  name: string | null;
  classname: string | null;
  file: string | null;
  line: number | null;
  time: number | null;
  status: PhpTestStatus;
  message: string | null;
}

export interface PhpTestSuite {
  name: string | null;
  tests: number | null;
  failures: number | null;
  errors: number | null;
  skipped: number | null;
  time: number | null;
  cases: PhpTestCase[];
}

export interface PhpTestTotals {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number | null;
}

export interface PhpTestRunOk {
  status: "ok";
  suites: PhpTestSuite[];
  totals: PhpTestTotals;
}

export type PhpTestRunResponse =
  | PhpTestRunOk
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export interface PhpTestGateway {
  run(rootPath: string): Promise<PhpTestRunResponse>;
}

export interface PhpTestCaseNavigationTarget {
  path: string;
  position: EditorPosition;
}

export function phpTestSuiteStatus(suite: PhpTestSuite): PhpTestStatus {
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

export function phpTestCaseNavigationTarget(
  rootPath: string,
  testCase: PhpTestCase,
): PhpTestCaseNavigationTarget | null {
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

export function phpTestCaseCanNavigate(
  rootPath: string,
  testCase: PhpTestCase,
): boolean {
  return phpTestCaseNavigationTarget(rootPath, testCase) !== null;
}

export function phpTestTotalsSummary(totals: PhpTestTotals): string {
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
