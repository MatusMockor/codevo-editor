import { ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CSSProperties, MouseEvent, RefObject } from "react";
import type { FileEntry } from "../domain/workspace";

interface FileTreeProps {
  rootPath: string | null;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  activePath: string | null;
  revealActivePath: boolean;
  revealActivePathSignal: number;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
  onToggleDirectory(path: string): void;
}

export function FileTree({
  rootPath,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  revealActivePath,
  revealActivePathSignal,
  onOpenFile,
  onPreviewFile,
  onToggleDirectory,
}: FileTreeProps) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const pendingRevealKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!revealActivePath || !activePath) {
      pendingRevealKeyRef.current = null;
      return;
    }

    pendingRevealKeyRef.current = `${activePath}:${revealActivePathSignal}`;
  }, [activePath, revealActivePath, revealActivePathSignal]);

  useEffect(() => {
    if (!pendingRevealKeyRef.current || !activeRowRef.current) {
      return;
    }

    activeRowRef.current.scrollIntoView({
      block: "nearest",
    });
    pendingRevealKeyRef.current = null;
  });

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
          activeRowRef={activeRowRef}
          entriesByDirectory={entriesByDirectory}
          entry={entry}
          expandedDirectories={expandedDirectories}
          key={entry.path}
          level={0}
          loadingDirectories={loadingDirectories}
          onOpenFile={onOpenFile}
          onPreviewFile={onPreviewFile}
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
  activeRowRef: RefObject<HTMLButtonElement | null>;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
  onToggleDirectory(path: string): void;
}

function TreeEntry({
  entry,
  level,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  activeRowRef,
  onOpenFile,
  onPreviewFile,
  onToggleDirectory,
}: TreeEntryProps) {
  const isDirectory = entry.kind === "directory";
  const isExpandable = isDirectory;
  const isExpanded = isDirectory && expandedDirectories.has(entry.path);
  const isLoading = isDirectory && loadingDirectories.has(entry.path);
  const children = entriesByDirectory[entry.path] || [];

  return (
    <div className="tree-row-group">
      <button
        aria-expanded={isExpandable ? isExpanded : undefined}
        className={entry.path === activePath ? "tree-row active" : "tree-row"}
        onClick={(event) => {
          if (event.detail > 1) {
            return;
          }

          if (isDirectory) {
            onToggleDirectory(entry.path);
            return;
          }

          onPreviewFile(entry);
        }}
        onDoubleClick={(event) => handleDoubleClick(event, entry, onOpenFile)}
        ref={entry.path === activePath ? activeRowRef : undefined}
        style={{ "--tree-level": level } as CSSProperties}
        title={entry.path}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={getChevronClassName(isExpandable, isExpanded)}
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
              activeRowRef={activeRowRef}
              entriesByDirectory={entriesByDirectory}
              entry={child}
              expandedDirectories={expandedDirectories}
              key={child.path}
              level={level + 1}
              loadingDirectories={loadingDirectories}
              onOpenFile={onOpenFile}
              onPreviewFile={onPreviewFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))
        : null}
    </div>
  );
}

function getChevronClassName(isExpandable: boolean, isExpanded: boolean): string {
  if (!isExpandable) {
    return "tree-chevron placeholder";
  }

  if (isExpanded) {
    return "tree-chevron expanded";
  }

  return "tree-chevron";
}

function handleDoubleClick(
  event: MouseEvent<HTMLButtonElement>,
  entry: FileEntry,
  onOpenFile: (entry: FileEntry) => void,
): void {
  if (entry.kind === "directory") {
    return;
  }

  event.preventDefault();
  onOpenFile(entry);
}
