export type FileEntryKind = "directory" | "file";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
  ignored?: boolean;
}

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
}

export interface FileSearchResponse {
  readonly requestGeneration: string;
  readonly results: readonly FileSearchResult[];
  readonly truncated: boolean;
}

export interface WorkspaceFileGateway {
  readDirectory(path: string): Promise<FileEntry[]>;
  readDirectoryBounded?(
    path: string,
    maxEntries: number,
  ): Promise<{ readonly entries: readonly FileEntry[]; readonly truncated: boolean }>;
}

/** Writes through one admitted native workspace instead of path-based routing. */
export interface WorkspaceOwnerFileGateway {
  createDirectoryForWorkspace(workspaceId: string, path: string): Promise<void>;
  createTextFileWithContentForWorkspace(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<WorkspaceWriteResult>;
}

export type WorkspaceWriteResult =
  | { status: "success"; revision: WorkspaceFileRevision | null }
  | { status: "conflict"; message: string }
  | { status: "partial"; message: string; revision: WorkspaceFileRevision | null }
  | { status: "error"; message: string };

export interface WorkspaceFileRevision {
  device: string;
  inode: string;
  size: number;
  modifiedSeconds: number;
  modifiedNanoseconds: number;
  contentHash: string;
}

export type WorkspaceMutationResult =
  | { status: "success" }
  | { status: "partial"; message: string }
  | { status: "error"; message: string };

export interface FileSearchGateway {
  searchFiles(root: string, query: string, limit: number): Promise<FileSearchResult[]>;
  searchFilesWithMetadata?(
    root: string,
    query: string,
    limit: number,
    requestGeneration?: string,
  ): Promise<FileSearchResponse>;
}

export function getFileName(path: string): string {
  const normalized = path.split("\\").join("/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function detectLanguage(path: string): string {
  const fileName = getFileName(path).toLowerCase();

  if (fileName.endsWith(".blade.php")) {
    return "blade";
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "dotenv";
  }

  if (fileName === "env") {
    return "plaintext";
  }

  const parts = fileName.split(".");
  const extension = parts[parts.length - 1]?.toLowerCase();

  if (!extension) {
    return "plaintext";
  }

  const languages: Record<string, string> = {
    css: "css",
    html: "html",
    cjs: "javascript",
    cts: "typescript",
    env: "dotenv",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    latte: "latte",
    md: "markdown",
    mjs: "javascript",
    mts: "typescript",
    neon: "neon",
    php: "php",
    rs: "rust",
    ts: "typescript",
    tsx: "typescript",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };

  return languages[extension] || "plaintext";
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
  const normalizedRootPath = rootPath.trim().split("\\").join("/").replace(/\/+$/, "");
  const normalizedRelativePath = relativePath.trim().split("\\").join("/").replace(/^\/+/, "");

  if (!normalizedRelativePath) {
    return normalizedRootPath;
  }

  return `${normalizedRootPath}/${normalizedRelativePath}`;
}

export function workspaceRelativePath(rootPath: string, absolutePath: string): string | null {
  const normalizedRootPath = rootPath.trim().split("\\").join("/").replace(/\/+$/, "");
  const normalizedAbsolutePath = absolutePath.trim().split("\\").join("/").replace(/\/+$/, "");
  const prefix = `${normalizedRootPath}/`;

  if (!normalizedAbsolutePath.startsWith(prefix)) {
    return null;
  }

  const relativePath = normalizedAbsolutePath.slice(prefix.length);

  return relativePath || null;
}
