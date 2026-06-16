export type FileEntryKind = "directory" | "file";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
}

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
}

export interface TextSearchResult {
  path: string;
  relativePath: string;
  lineNumber: number;
  column: number;
  lineText: string;
}

export interface WorkspaceDescriptor {
  rootPath: string;
  php: PhpProjectDescriptor | null;
}

export interface PhpProjectDescriptor {
  classmapRoots: ClassmapRoot[];
  hasComposer: boolean;
  packageName: string | null;
  packages: ComposerPackageDescriptor[];
  psr4Roots: Psr4Root[];
}

export interface ClassmapRoot {
  paths: string[];
  dev: boolean;
}

export interface ComposerPackageDescriptor {
  classmapRoots: ClassmapRoot[];
  dev: boolean;
  installPath: string | null;
  name: string;
  packageType: string | null;
  psr4Roots: Psr4Root[];
  version: string | null;
}

export interface Psr4Root {
  namespace: string;
  paths: string[];
  dev: boolean;
}

export interface PhpToolAvailability {
  phpactor: ToolLocation | null;
  intelephense: ToolLocation | null;
}

export interface ToolLocation {
  executable: string;
  path: string;
  source: "managed" | "workspaceVendorBin" | "path";
}

export interface EditorDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
}

export type IntelligenceMode = "basic" | "lightSmart" | "fullSmart";

export interface WorkspaceFileGateway {
  createDirectory(path: string): Promise<void>;
  createTextFile(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

export interface WorkspaceDetectionGateway {
  detectWorkspace(path: string): Promise<WorkspaceDescriptor>;
}

export interface PhpToolGateway {
  detectPhpTools(workspaceRoot: string | null): Promise<PhpToolAvailability>;
}

export interface FileSearchGateway {
  searchFiles(
    root: string,
    query: string,
    limit: number,
  ): Promise<FileSearchResult[]>;
}

export interface TextSearchGateway {
  searchText(
    root: string,
    query: string,
    limit: number,
  ): Promise<TextSearchResult[]>;
}

export function getFileName(path: string): string {
  const normalized = path.split("\\").join("/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function detectLanguage(path: string): string {
  const parts = getFileName(path).split(".");
  const extension = parts[parts.length - 1]?.toLowerCase();

  if (!extension) {
    return "plaintext";
  }

  const languages: Record<string, string> = {
    css: "css",
    html: "html",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    php: "php",
    rs: "rust",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };

  return languages[extension] || "plaintext";
}

export function isDirty(document: EditorDocument): boolean {
  return document.content !== document.savedContent;
}

export function visibleEditorPaths(
  openPaths: string[],
  previewPath: string | null,
): string[] {
  if (!previewPath) {
    return openPaths;
  }

  if (openPaths.includes(previewPath)) {
    return openPaths;
  }

  return [...openPaths, previewPath];
}

export function nextActiveEditorPathAfterClose(
  closedPath: string,
  openPaths: string[],
  previewPath: string | null,
): string | null {
  const remainingPaths = visibleEditorPaths(openPaths, previewPath).filter(
    (path) => path !== closedPath,
  );

  return remainingPaths[remainingPaths.length - 1] || null;
}

export function getParentPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const index = normalized.lastIndexOf("/");

  if (index <= 0) {
    return normalized;
  }

  return normalized.slice(0, index);
}

export function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const normalizedRootPath = rootPath
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/+$/, "");
  const normalizedRelativePath = relativePath
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\/+/, "");

  if (!normalizedRelativePath) {
    return normalizedRootPath;
  }

  return `${normalizedRootPath}/${normalizedRelativePath}`;
}
