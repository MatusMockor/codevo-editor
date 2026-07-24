import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";

export function isEditorConfigPath(path: string | null | undefined): boolean {
  return path?.split(/[\\/]/).pop()?.toLowerCase() === ".editorconfig";
}

export function workspaceFileChangeTouchesEditorConfig(
  event: WorkspaceFileChangeEvent,
): boolean {
  return (
    event.kind === "rescanRequired" ||
    isEditorConfigPath(event.path) ||
    isEditorConfigPath(event.previousPath)
  );
}

export function refreshEditorConfigForFileChange(
  event: WorkspaceFileChangeEvent,
  refreshRoot: (rootPath: string) => void,
): boolean {
  if (!workspaceFileChangeTouchesEditorConfig(event)) return false;
  refreshRoot(event.rootPath);
  return true;
}

export function refreshEditorConfigAfterDocumentSave(
  rootPath: string,
  path: string,
  refreshRoot: (rootPath: string) => void,
): boolean {
  if (!isEditorConfigPath(path)) return false;
  refreshRoot(rootPath);
  return true;
}
