import type { JsTestRunScope } from "./jsTestRunScope";
import type { JsTestExplorerStatus, JsTestExplorerTestDiscovery } from "./jsTestExplorerTree";
import type { TestCase, TestRunResponse } from "./testResults";

export function markJsTestExplorerScopeRunning(
  discoveries: readonly JsTestExplorerTestDiscovery[],
  scope: JsTestRunScope,
): JsTestExplorerTestDiscovery[] {
  return discoveries.map((discovery) =>
    discoveryMatchesScope(discovery, scope) ? { ...discovery, status: "running" } : discovery,
  );
}

export function mergeJsTestExplorerRunResponse(
  previous: readonly JsTestExplorerTestDiscovery[],
  scope: JsTestRunScope,
  response: TestRunResponse,
  rootPath = "",
): JsTestExplorerTestDiscovery[] {
  if (response.status !== "ok") {
    return previous.map((discovery) =>
      discoveryMatchesScope(discovery, scope) && discovery.status === "running"
        ? { ...discovery, status: "idle" }
        : discovery,
    );
  }

  const cases = response.suites.flatMap((suite) => suite.cases);
  return previous.map((discovery) => {
    if (!discoveryMatchesScope(discovery, scope)) return discovery;
    const exactMatches = cases.filter((testCase) =>
      caseMatchesDiscovery(testCase, discovery, rootPath),
    );
    if (exactMatches.length === 1) {
      return { ...discovery, status: explorerStatus(exactMatches[0]!) };
    }
    if (exactMatches.length > 1) {
      return discovery.parameterized
        ? { ...discovery, status: aggregateRuntimeStatuses(exactMatches) }
        : { ...discovery, status: "idle" };
    }

    // Parameterized `.each` declarations have one stable source prefix but report one runtime
    // case per generated title. Aggregate those cases only when no exact case exists; an exact
    // declaration always wins, and duplicate exact cases remain deliberately ambiguous.
    const expandedMatches = discovery.parameterized
      ? cases.filter((testCase) => caseMatchesParameterizedDiscovery(testCase, discovery, rootPath))
      : [];
    return expandedMatches.length > 0
      ? { ...discovery, status: aggregateRuntimeStatuses(expandedMatches) }
      : { ...discovery, status: "idle" };
  });
}

export function jsTestScopeForDiscovery(discovery: JsTestExplorerTestDiscovery): JsTestRunScope {
  return {
    fullName: [...discovery.suitePath, discovery.target.filter].join(" "),
    kind: "test",
    relativeFilePath: discovery.filePath,
    ...(discovery.parameterized ? { nameMatch: "prefix" as const } : {}),
  };
}

function discoveryMatchesScope(
  discovery: JsTestExplorerTestDiscovery,
  scope: JsTestRunScope,
): boolean {
  if (scope.kind === "all") return true;
  if (normalizePath(discovery.filePath) !== normalizePath(scope.relativeFilePath)) return false;
  if (scope.kind === "file") return true;

  const fullName = [...discovery.suitePath, discovery.target.filter].join(" ");
  return scope.kind === "suite"
    ? fullName === scope.fullName || fullName.startsWith(`${scope.fullName} `)
    : fullName === scope.fullName;
}

function caseMatchesDiscovery(
  testCase: TestCase,
  discovery: JsTestExplorerTestDiscovery,
  rootPath: string,
): boolean {
  if (!testCase.name) return false;
  const fullName = [...discovery.suitePath, discovery.target.filter].join(" ");
  if (testCase.name !== fullName) return false;
  if (!testCase.file || !sameFile(testCase.file, discovery.filePath, rootPath)) return false;
  return testCase.line === null || testCase.line === discovery.target.position.lineNumber;
}

function caseMatchesParameterizedDiscovery(
  testCase: TestCase,
  discovery: JsTestExplorerTestDiscovery,
  rootPath: string,
): boolean {
  if (!testCase.name) return false;
  const fullName = [...discovery.suitePath, discovery.target.filter].join(" ");
  if (!testCase.name.startsWith(`${fullName} `)) return false;
  if (!testCase.file || !sameFile(testCase.file, discovery.filePath, rootPath)) return false;
  return testCase.line === null || testCase.line === discovery.target.position.lineNumber;
}

function aggregateRuntimeStatuses(testCases: readonly TestCase[]): JsTestExplorerStatus {
  if (testCases.some(({ status }) => status === "failed" || status === "error")) return "failed";
  if (testCases.some(({ status }) => status === "passed")) return "passed";
  return "skipped";
}

function sameFile(reportedPath: string, relativePath: string, rootPath: string): boolean {
  const reported = normalizePath(reportedPath);
  const relative = normalizePath(relativePath);
  const root = normalizePath(rootPath).replace(/\/$/, "");
  return reported === relative || Boolean(root && reported === `${root}/${relative}`);
}

function explorerStatus(testCase: TestCase): JsTestExplorerStatus {
  if (testCase.status === "failed" || testCase.status === "error") return "failed";
  return testCase.status;
}

function normalizePath(path: string): string {
  return path
    .split("\\")
    .join("/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}
