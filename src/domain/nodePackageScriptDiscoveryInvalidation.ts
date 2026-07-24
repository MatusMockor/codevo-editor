import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const NODE_PACKAGE_METADATA_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
]);

export function workspaceFileChangeInvalidatesNodePackageScriptDiscovery(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
  }
  return [event.relativePath, event.previousRelativePath].some(
    (path) => path !== null && path !== undefined && isNodePackageMetadataPath(path),
  );
}

export function isNodePackageMetadataPath(relativePath: string): boolean {
  const normalized = relativePath.split("\\").join("/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return NODE_PACKAGE_METADATA_FILES.has(fileName);
}
