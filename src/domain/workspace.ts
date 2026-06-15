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

export interface EditorDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
}

export type IntelligenceMode = "basic" | "lightSmart" | "fullSmart";

export interface WorkspaceGateway {
  createDirectory(path: string): Promise<void>;
  createTextFile(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<void>;
  searchFiles(root: string, query: string, limit: number): Promise<FileSearchResult[]>;
  writeTextFile(path: string, content: string): Promise<void>;
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
