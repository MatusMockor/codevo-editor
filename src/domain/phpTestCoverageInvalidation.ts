import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const PHP_SOURCE_FILE = /\.php$/i;
const PHPUNIT_CONFIG_FILE = /^(?:phpunit\.xml(?:\.dist)?|phpunit\.dist\.xml)$/i;
const COMPOSER_GRAPH_FILES = new Set(["composer.json", "composer.lock"]);

/**
 * A Clover snapshot belongs to the exact PHP sources and runner configuration
 * that produced it. Structural directory changes are conservative because a
 * watcher may not enumerate every descendant before reporting the parent.
 */
export function workspaceFileChangeInvalidatesPhpTestCoverage(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
  }
  return [event.relativePath, event.previousRelativePath].some((path) =>
    Boolean(path && isPhpTestCoverageInputPath(path)),
  );
}

function isPhpTestCoverageInputPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return (
    PHP_SOURCE_FILE.test(fileName) ||
    PHPUNIT_CONFIG_FILE.test(fileName) ||
    COMPOSER_GRAPH_FILES.has(fileName)
  );
}
