import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

const NODE_PACKAGE_METADATA_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
]);
const VSCODE_TASKS_DIRECTORY = ".vscode";
const VSCODE_TASKS_FILE = ".vscode/tasks.json";

export function fileChangeInvalidatesNodePackageScripts(event: WorkspaceFileChangeEvent): boolean {
  if (event.kind === "rescanRequired") return true;
  if (event.fileKind === "directory") return structuralDirectoryChange(event);
  return watcherRelativePaths(event).some((path) =>
    NODE_PACKAGE_METADATA_FILES.has(path.slice(path.lastIndexOf("/") + 1)),
  );
}

export function fileChangeInvalidatesVscodeProcessTasks(event: WorkspaceFileChangeEvent): boolean {
  if (event.kind === "rescanRequired") return true;
  const paths = watcherRelativePaths(event);
  if (event.fileKind === "directory") {
    return structuralDirectoryChange(event) && paths.includes(VSCODE_TASKS_DIRECTORY);
  }
  return paths.includes(VSCODE_TASKS_FILE);
}

function structuralDirectoryChange(event: WorkspaceFileChangeEvent): boolean {
  return event.kind === "created" || event.kind === "deleted" || event.kind === "renamed";
}

function watcherRelativePaths(event: WorkspaceFileChangeEvent): readonly string[] {
  return [event.relativePath, event.previousRelativePath]
    .filter((path): path is string => path !== null && path !== undefined)
    .map(normalizeWatcherRelativePath);
}

function normalizeWatcherRelativePath(path: string): string {
  return path
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}
