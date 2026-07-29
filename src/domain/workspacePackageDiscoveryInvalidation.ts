import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const PACKAGE_DISCOVERY_IGNORED_DIRECTORY_SEGMENTS = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

export function workspaceFileChangeInvalidatesPackageDiscovery(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    if (event.kind === "modified") return false;
    // A directory event does not reveal whether a pre-populated package subtree
    // appeared or disappeared. Keep topology changes conservative, except where
    // the authoritative Rust enumerator never descends.
    return [event.relativePath, event.previousRelativePath].some((path) =>
      Boolean(path && isPackageDiscoveryDirectory(path)),
    );
  }
  return [event.relativePath, event.previousRelativePath].some((path) =>
    Boolean(path && isPackageTopologyFile(path)),
  );
}

function isPackageTopologyFile(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === ".git/info/exclude") return true;
  if (hasIgnoredDirectorySegment(normalized)) return false;
  return (
    normalized === "package.json" ||
    normalized.endsWith("/package.json") ||
    normalized === "pnpm-workspace.yaml" ||
    normalized === ".gitignore" ||
    normalized.endsWith("/.gitignore") ||
    normalized === ".ignore" ||
    normalized.endsWith("/.ignore")
  );
}

function isPackageDiscoveryDirectory(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return (
    normalized.length > 0 && (normalized === ".git" || !hasIgnoredDirectorySegment(normalized))
  );
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/+$/u, "");
}

function hasIgnoredDirectorySegment(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => PACKAGE_DISCOVERY_IGNORED_DIRECTORY_SEGMENTS.has(segment));
}
