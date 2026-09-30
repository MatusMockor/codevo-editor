import type { FileEntry } from "./workspace";

const VSCODE_DEFAULT_FILES_EXCLUDE: ReadonlySet<string> = new Set([
  ".git",
  ".svn",
  ".hg",
  "CVS",
  ".DS_Store",
  "Thumbs.db",
]);

export function isExplorerExcludedEntry(entry: Pick<FileEntry, "name">): boolean {
  return VSCODE_DEFAULT_FILES_EXCLUDE.has(entry.name);
}

export function withoutExplorerExcludedEntries<T extends Pick<FileEntry, "name">>(
  entries: ReadonlyArray<T>,
): T[] {
  return entries.filter((entry) => !isExplorerExcludedEntry(entry));
}
