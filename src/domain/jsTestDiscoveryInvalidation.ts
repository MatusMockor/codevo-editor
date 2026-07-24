import { isJsTestRelativePath } from "./jsTestFilePatterns";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

export function workspaceFileChangeInvalidatesJsTestDiscovery(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") {
    return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
  }
  return [event.relativePath, event.previousRelativePath].some((path) =>
    Boolean(path && isJsTestRelativePath(path)),
  );
}
