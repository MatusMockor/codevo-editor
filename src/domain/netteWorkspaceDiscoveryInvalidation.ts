import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const ROOT_METADATA_PATHS = new Set(["composer.json", "composer.lock"]);

export function workspaceFileChangeInvalidatesNetteServicesDiscovery(
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
    return paths.some(isNetteDiscoveryDirectory);
  }

  return paths.some(
    (path) =>
      ROOT_METADATA_PATHS.has(path) ||
      path.toLowerCase().endsWith(".neon") ||
      path.toLowerCase().endsWith(".latte") ||
      (path.toLowerCase().startsWith("app/") && path.toLowerCase().endsWith(".php")),
  );
}

function isNetteDiscoveryDirectory(path: string): boolean {
  return ["config", "app"].some(
    (directory) => path === directory || path.startsWith(`${directory}/`),
  );
}

function normalizeRelativePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\.\//, "").replace(/\/+$/, "");
}
