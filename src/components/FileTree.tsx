import { ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import type { CSSProperties } from "react";
import type { FileEntry } from "../domain/workspace";

interface FileTreeProps {
  rootPath: string | null;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  activePath: string | null;
  onOpenFile(entry: FileEntry): void;
  onToggleDirectory(path: string): void;
}

export function FileTree({
  rootPath,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  onOpenFile,
  onToggleDirectory,
}: FileTreeProps) {
  if (!rootPath) {
    return (
      <div className="empty-tree">
        <p>No workspace</p>
      </div>
    );
  }

  const rootEntries = entriesByDirectory[rootPath] || [];

  return (
    <nav aria-label="Workspace files" className="file-tree">
      {rootEntries.map((entry) => (
        <TreeEntry
          activePath={activePath}
          entriesByDirectory={entriesByDirectory}
          entry={entry}
          expandedDirectories={expandedDirectories}
          key={entry.path}
          level={0}
          loadingDirectories={loadingDirectories}
          onOpenFile={onOpenFile}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
    </nav>
  );
}

interface TreeEntryProps {
  entry: FileEntry;
  level: number;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  activePath: string | null;
  onOpenFile(entry: FileEntry): void;
  onToggleDirectory(path: string): void;
}

function TreeEntry({
  entry,
  level,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  onOpenFile,
  onToggleDirectory,
}: TreeEntryProps) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = expandedDirectories.has(entry.path);
  const isLoading = loadingDirectories.has(entry.path);
  const children = entriesByDirectory[entry.path] || [];

  return (
    <div className="tree-row-group">
      <button
        aria-expanded={isDirectory ? isExpanded : undefined}
        className={entry.path === activePath ? "tree-row active" : "tree-row"}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(entry.path);
            return;
          }

          onOpenFile(entry);
        }}
        style={{ "--tree-level": level } as CSSProperties}
        title={entry.path}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={getChevronClassName(isDirectory, isExpanded)}
          size={15}
        />
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen aria-hidden="true" size={16} />
          ) : (
            <Folder aria-hidden="true" size={16} />
          )
        ) : (
          <FileCode2 aria-hidden="true" size={16} />
        )}
        <span>{entry.name}</span>
        {isLoading ? <small aria-live="polite">Loading...</small> : null}
      </button>

      {isDirectory && isExpanded
        ? children.map((child) => (
            <TreeEntry
              activePath={activePath}
              entriesByDirectory={entriesByDirectory}
              entry={child}
              expandedDirectories={expandedDirectories}
              key={child.path}
              level={level + 1}
              loadingDirectories={loadingDirectories}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))
        : null}
    </div>
  );
}

function getChevronClassName(isDirectory: boolean, isExpanded: boolean): string {
  if (!isDirectory) {
    return "tree-chevron placeholder";
  }

  if (isExpanded) {
    return "tree-chevron expanded";
  }

  return "tree-chevron";
}
