import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".svn",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

/**
 * Selects filesystem changes that can alter a Jest/Vitest run. This is kept
 * separate from result/coverage invalidation so non-watcher invalidations can
 * never accidentally start Continuous Run.
 */
export function workspaceFileChangeTriggersJsTestContinuousRun(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;

  const paths = [event.relativePath, event.previousRelativePath].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );
  if (event.fileKind === "directory") {
    return (
      (event.kind === "created" || event.kind === "deleted" || event.kind === "renamed") &&
      paths.some((path) => !isIgnoredPath(path))
    );
  }
  // Without a runner dependency graph, narrowing by extension is not safe:
  // tests may import fixtures, snapshots, styles, templates or generated data.
  return paths.some((path) => !isIgnoredPath(path));
}

function isIgnoredPath(path: string): boolean {
  return path
    .split(/[\\/]/)
    .filter(Boolean)
    .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment.toLowerCase()));
}
