import { isJsSourceRelativePath } from "./jsTestFilePatterns";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

export function workspaceFileChangeInvalidatesExpressRouteDiscovery(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
  }
  return [event.relativePath, event.previousRelativePath].some((path) =>
    Boolean(path && (isJsSourceRelativePath(path) || isPackageJsonRelativePath(path))),
  );
}

function isPackageJsonRelativePath(relativePath: string): boolean {
  const normalized = relativePath.split("\\").join("/");
  if (normalized.split("/").includes("node_modules")) return false;
  return normalized === "package.json" || normalized.endsWith("/package.json");
}
