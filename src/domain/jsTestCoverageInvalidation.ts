import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const COVERAGE_SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const TEST_RUNNER_CONFIG_FILE =
  /^(?:jest|vite|vitest)\.config\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|json)$/i;
const TYPESCRIPT_PROJECT_CONFIG_FILE = /^(?:ts|js)config(?:\.[^/\\]+)?\.json$/i;

const PACKAGE_GRAPH_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/**
 * Coverage belongs to the exact source and test-runner configuration that
 * produced it. Any relevant file-system change therefore makes the snapshot
 * stale, independently from the narrower test-discovery invalidation policy.
 */
export function workspaceFileChangeInvalidatesJsTestCoverage(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
  }

  return [event.relativePath, event.previousRelativePath].some((path) =>
    Boolean(path && isJsTestCoverageInputPath(path)),
  );
}

function isJsTestCoverageInputPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return (
    COVERAGE_SOURCE_EXTENSION.test(fileName) ||
    PACKAGE_GRAPH_FILES.has(fileName) ||
    TEST_RUNNER_CONFIG_FILE.test(fileName) ||
    TYPESCRIPT_PROJECT_CONFIG_FILE.test(fileName)
  );
}
