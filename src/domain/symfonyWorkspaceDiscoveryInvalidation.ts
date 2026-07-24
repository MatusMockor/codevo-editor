import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const ROOT_METADATA_PATHS = new Set(["composer.json", "composer.lock", "bin/console"]);

export function workspaceFileChangeInvalidatesSymfonyDiscovery(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;

  const paths = [event.relativePath, event.previousRelativePath]
    .filter((path): path is string => Boolean(path))
    .map(normalizeRelativePath);

  if (event.fileKind === "directory") {
    if (event.kind !== "created" && event.kind !== "deleted" && event.kind !== "renamed") {
      return false;
    }
    return paths.some(isSymfonyDiscoveryDirectory);
  }

  return paths.some(isSymfonyDiscoveryFile);
}

function isSymfonyDiscoveryFile(path: string): boolean {
  if (ROOT_METADATA_PATHS.has(path) || path.startsWith(".env")) return true;
  if (path === "config" || path.startsWith("config/")) return true;
  return path.startsWith("src/") && path.toLowerCase().endsWith(".php");
}

function isSymfonyDiscoveryDirectory(path: string): boolean {
  return (
    path === "config" ||
    path.startsWith("config/") ||
    path === "src" ||
    path.startsWith("src/")
  );
}

function normalizeRelativePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\.\//, "").replace(/\/+$/, "");
}
