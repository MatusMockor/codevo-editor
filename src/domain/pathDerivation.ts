import type { FileEntry } from "./workspace";

export function workspaceRelativePath(
  rootPath: string,
  path: string,
): string | null {
  const normalizedRoot = normalizePathSeparators(rootPath);
  const root = normalizedRoot === "/" ? "/" : normalizedRoot.replace(/\/+$/, "");
  const candidate = normalizePathSeparators(path);

  if (!root || candidate === root) {
    return candidate === root ? "" : null;
  }

  const prefix = root === "/" ? "/" : `${root}/`;

  if (!candidate.startsWith(prefix)) {
    return null;
  }

  const relativePath = candidate.slice(prefix.length);

  if (relativePath.split("/").some((part) => part === "..")) {
    return null;
  }

  return relativePath;
}

export function terminalDirectoryForEntry(
  rootPath: string,
  entry: FileEntry,
): string | null {
  if (workspaceRelativePath(rootPath, entry.path) === null) {
    return null;
  }

  const path = normalizePathSeparators(entry.path);

  if (entry.kind === "directory") {
    return path;
  }

  const separatorIndex = path.lastIndexOf("/");

  if (separatorIndex < 0) {
    return null;
  }

  return path.slice(0, separatorIndex) || "/";
}

export function quoteShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}
