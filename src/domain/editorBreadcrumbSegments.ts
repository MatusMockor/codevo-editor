import { workspaceRelativePath } from "./pathDerivation";

export const MAX_EDITOR_BREADCRUMB_FOLDERS = 4;

export type EditorBreadcrumbSegmentKind = "folder" | "file" | "overflow";

export interface EditorBreadcrumbSegment {
  readonly kind: EditorBreadcrumbSegmentKind;
  readonly label: string;
  readonly path: string;
}

export function editorBreadcrumbSegments(
  rootPath: string | null,
  filePath: string,
): ReadonlyArray<EditorBreadcrumbSegment> {
  if (rootPath === null) return [fileSegment(filePath)];
  const relative = workspaceRelativePath(rootPath, filePath);
  if (relative === null || relative === "") return [fileSegment(filePath)];

  const folders = relative
    .split("/")
    .filter((part) => part.length > 0)
    .slice(0, -1);
  const base = forwardSlashes(rootPath).replace(/\/+$/, "");
  const folderSegments = folders.map<EditorBreadcrumbSegment>((label, index) => ({
    kind: "folder",
    label,
    path: `${base}/${folders.slice(0, index + 1).join("/")}`,
  }));
  return [...boundFolders(folderSegments), fileSegment(filePath)];
}

function boundFolders(
  folders: ReadonlyArray<EditorBreadcrumbSegment>,
): ReadonlyArray<EditorBreadcrumbSegment> {
  if (folders.length <= MAX_EDITOR_BREADCRUMB_FOLDERS) return folders;
  const hidden = folders.length - MAX_EDITOR_BREADCRUMB_FOLDERS;
  const lastHidden = folders[hidden - 1];
  const overflow: EditorBreadcrumbSegment = {
    kind: "overflow",
    label: "…",
    path: lastHidden === undefined ? "" : lastHidden.path,
  };
  return [overflow, ...folders.slice(hidden)];
}

function fileSegment(filePath: string): EditorBreadcrumbSegment {
  const normalized = forwardSlashes(filePath);
  const label = normalized.slice(normalized.lastIndexOf("/") + 1) || filePath;
  return { kind: "file", label, path: filePath };
}

function forwardSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}
