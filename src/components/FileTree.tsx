import { ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import type { CSSProperties } from "react";
import type { MouseEvent } from "react";
import {
  canExpandPhpFileEntry,
  type PhpFileOutline,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import type { FileEntry } from "../domain/workspace";
import { PhpFileOutlineRows } from "./PhpFileOutlineRows";

interface FileTreeProps {
  rootPath: string | null;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedPhpFilePaths: Set<string>;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  loadingPhpFileOutlinePaths: Set<string>;
  phpFileOutlineExpandedNodeIds: Set<string>;
  phpFileOutlinesByPath: Record<string, PhpFileOutline>;
  activePath: string | null;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
  onOpenPhpFileOutlineNode(node: PhpFileOutlineNode): void;
  onToggleDirectory(path: string): void;
  onTogglePhpFileOutline(path: string): void;
  onTogglePhpFileOutlineNode(id: string): void;
}

export function FileTree({
  rootPath,
  entriesByDirectory,
  expandedPhpFilePaths,
  expandedDirectories,
  loadingDirectories,
  loadingPhpFileOutlinePaths,
  phpFileOutlineExpandedNodeIds,
  phpFileOutlinesByPath,
  activePath,
  onOpenFile,
  onPreviewFile,
  onOpenPhpFileOutlineNode,
  onToggleDirectory,
  onTogglePhpFileOutline,
  onTogglePhpFileOutlineNode,
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
          expandedPhpFilePaths={expandedPhpFilePaths}
          expandedDirectories={expandedDirectories}
          key={entry.path}
          level={0}
          loadingDirectories={loadingDirectories}
          loadingPhpFileOutlinePaths={loadingPhpFileOutlinePaths}
          onOpenFile={onOpenFile}
          onPreviewFile={onPreviewFile}
          onOpenPhpFileOutlineNode={onOpenPhpFileOutlineNode}
          onToggleDirectory={onToggleDirectory}
          onTogglePhpFileOutline={onTogglePhpFileOutline}
          onTogglePhpFileOutlineNode={onTogglePhpFileOutlineNode}
          phpFileOutlineExpandedNodeIds={phpFileOutlineExpandedNodeIds}
          phpFileOutlinesByPath={phpFileOutlinesByPath}
        />
      ))}
    </nav>
  );
}

interface TreeEntryProps {
  entry: FileEntry;
  level: number;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedPhpFilePaths: Set<string>;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  loadingPhpFileOutlinePaths: Set<string>;
  phpFileOutlineExpandedNodeIds: Set<string>;
  phpFileOutlinesByPath: Record<string, PhpFileOutline>;
  activePath: string | null;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
  onOpenPhpFileOutlineNode(node: PhpFileOutlineNode): void;
  onToggleDirectory(path: string): void;
  onTogglePhpFileOutline(path: string): void;
  onTogglePhpFileOutlineNode(id: string): void;
}

function TreeEntry({
  entry,
  level,
  entriesByDirectory,
  expandedPhpFilePaths,
  expandedDirectories,
  loadingDirectories,
  loadingPhpFileOutlinePaths,
  phpFileOutlineExpandedNodeIds,
  phpFileOutlinesByPath,
  activePath,
  onOpenFile,
  onPreviewFile,
  onOpenPhpFileOutlineNode,
  onToggleDirectory,
  onTogglePhpFileOutline,
  onTogglePhpFileOutlineNode,
}: TreeEntryProps) {
  const isDirectory = entry.kind === "directory";
  const isPhpFileEntry = canExpandPhpFileEntry(entry);
  const isExpandable = isDirectory || isPhpFileEntry;
  const isExpanded = isDirectory
    ? expandedDirectories.has(entry.path)
    : expandedPhpFilePaths.has(entry.path);
  const isLoading = isDirectory
    ? loadingDirectories.has(entry.path)
    : loadingPhpFileOutlinePaths.has(entry.path);
  const children = entriesByDirectory[entry.path] || [];
  const phpFileOutline = phpFileOutlinesByPath[entry.path];
  const hasEmptyPhpSymbols = Boolean(
    isPhpFileEntry &&
      isExpanded &&
      phpFileOutline &&
      phpFileOutline.nodes.length === 0 &&
      !isLoading,
  );

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

          if (isPhpFileEntry) {
            onTogglePhpFileOutline(entry.path);
          }

          onPreviewFile(entry);
        }}
        onDoubleClick={(event) => handleDoubleClick(event, entry, onOpenFile)}
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
        {hasEmptyPhpSymbols ? <small>No symbols</small> : null}
      </button>

      {isDirectory && isExpanded
        ? children.map((child) => (
            <TreeEntry
              activePath={activePath}
              entriesByDirectory={entriesByDirectory}
              entry={child}
              expandedPhpFilePaths={expandedPhpFilePaths}
              expandedDirectories={expandedDirectories}
              key={child.path}
              level={level + 1}
              loadingDirectories={loadingDirectories}
              loadingPhpFileOutlinePaths={loadingPhpFileOutlinePaths}
              onOpenFile={onOpenFile}
              onPreviewFile={onPreviewFile}
              onOpenPhpFileOutlineNode={onOpenPhpFileOutlineNode}
              onToggleDirectory={onToggleDirectory}
              onTogglePhpFileOutline={onTogglePhpFileOutline}
              onTogglePhpFileOutlineNode={onTogglePhpFileOutlineNode}
              phpFileOutlineExpandedNodeIds={phpFileOutlineExpandedNodeIds}
              phpFileOutlinesByPath={phpFileOutlinesByPath}
            />
          ))
        : null}

      {isPhpFileEntry && isExpanded && phpFileOutline ? (
        <PhpFileOutlineRows
          expandedNodeIds={phpFileOutlineExpandedNodeIds}
          level={level + 1}
          nodes={phpFileOutline.nodes}
          onOpenNode={onOpenPhpFileOutlineNode}
          onToggleNode={onTogglePhpFileOutlineNode}
        />
      ) : null}
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
