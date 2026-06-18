import { ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, RefObject, UIEvent } from "react";
import {
  gitStatusLabel,
  gitStatusTitle,
  type GitChangeStatus,
} from "../domain/git";
import type { FileEntry } from "../domain/workspace";

const TREE_ROW_HEIGHT = 32;
const TREE_ROW_OVERSCAN = 8;
const TREE_VIEWPORT_FALLBACK_HEIGHT = 360;
const TREE_PADDING_TOP = 6;
const TREE_PADDING_BOTTOM = 10;

interface VisibleTreeRow {
  entry: FileEntry;
  level: number;
  status?: GitChangeStatus;
}

interface VisibleTreeState {
  rows: VisibleTreeRow[];
  indexByPath: Map<string, number>;
}

interface FileTreeProps {
  rootPath: string | null;
  entriesByDirectory: Record<string, FileEntry[]>;
  fileStatusesByPath?: Record<string, GitChangeStatus>;
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
  fileStatusesByPath,
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
  const treeContainerRef = useRef<HTMLElement | null>(null);
  const previousActivePathRef = useRef<string | null>(null);
  const previousRevealSignalRef = useRef<number>(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const visibleTreeState = useMemo(
    () =>
      getVisibleTreeRows({
        rootPath,
        entriesByDirectory,
        expandedDirectories,
        fileStatusesByPath,
      }),
    [rootPath, entriesByDirectory, expandedDirectories, fileStatusesByPath],
  );
  const visibleRows = visibleTreeState.rows;

  const activeRowIndex = useMemo(() => {
    if (!activePath) {
      return -1;
    }

    return visibleTreeState.indexByPath.get(activePath) ?? -1;
  }, [activePath, visibleTreeState]);

  const itemCount = visibleRows.length;
  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : TREE_VIEWPORT_FALLBACK_HEIGHT;
  const totalContentHeight = itemCount * TREE_ROW_HEIGHT;
  const totalScrollHeight =
    totalContentHeight + TREE_PADDING_TOP + TREE_PADDING_BOTTOM;
  const maxScrollTop = Math.max(0, totalScrollHeight - effectiveViewportHeight);
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop);
  const normalizedScrollTop = Math.max(0, clampedScrollTop);
  const normalizedRowsScrollTop = Math.max(
    0,
    normalizedScrollTop - TREE_PADDING_TOP,
  );
  const startIndex = Math.max(
    0,
    Math.floor(normalizedRowsScrollTop / TREE_ROW_HEIGHT) - TREE_ROW_OVERSCAN,
  );
  const endIndex = Math.min(
    itemCount,
    startIndex +
      Math.ceil(effectiveViewportHeight / TREE_ROW_HEIGHT) +
      TREE_ROW_OVERSCAN * 2,
  );
  const rowsToRender = visibleRows.slice(startIndex, endIndex);
  const renderedWindowOffset = startIndex * TREE_ROW_HEIGHT;
  const virtualContentHeight = Math.max(totalScrollHeight, effectiveViewportHeight);

  useEffect(() => {
    if (!revealActivePath || !activePath) {
      pendingRevealKeyRef.current = null;
      return;
    }

    const currentRevealKey = `${activePath}:${revealActivePathSignal}`;
    const activePathChanged = previousActivePathRef.current !== activePath;
    const signalChanged =
      previousRevealSignalRef.current !== revealActivePathSignal;

    if (activePathChanged || signalChanged) {
      pendingRevealKeyRef.current = currentRevealKey;
    }

    previousActivePathRef.current = activePath;
    previousRevealSignalRef.current = revealActivePathSignal;
  }, [activePath, rootPath, revealActivePath, revealActivePathSignal]);

  useEffect(() => {
    if (!pendingRevealKeyRef.current || !treeContainerRef.current || activeRowIndex < 0) {
      return;
    }

    const container = treeContainerRef.current;
    const rowTop = TREE_PADDING_TOP + activeRowIndex * TREE_ROW_HEIGHT;
    const adjustedRowBottom = rowTop + TREE_ROW_HEIGHT;
    const currentScrollTop = container.scrollTop;
    const rowIsVisible =
      rowTop >= currentScrollTop && adjustedRowBottom <= currentScrollTop + effectiveViewportHeight;

    if (rowIsVisible && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        block: "nearest",
      });
      pendingRevealKeyRef.current = null;
      return;
    }

    const nextScrollTop = Math.min(
      Math.max(0, rowTop),
      maxScrollTop,
    );
    container.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
    pendingRevealKeyRef.current = null;
  }, [
    activePath,
    effectiveViewportHeight,
    itemCount,
    activeRowIndex,
    revealActivePath,
    revealActivePathSignal,
  ]);

  useEffect(() => {
    if (clampedScrollTop !== scrollTop && treeContainerRef.current) {
      treeContainerRef.current.scrollTop = clampedScrollTop;
      setScrollTop(clampedScrollTop);
    }
  }, [clampedScrollTop, scrollTop]);

  useLayoutEffect(() => {
    if (!treeContainerRef.current) {
      return;
    }

    const container = treeContainerRef.current;
    const updateViewportHeight = () => {
      const nextViewportHeight = Math.max(
        container.clientHeight,
        container.offsetHeight,
        container.getBoundingClientRect().height,
      );

      setViewportHeight(nextViewportHeight);
    };

    updateViewportHeight();
    const animationFrame = requestAnimationFrame(updateViewportHeight);

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(animationFrame);
    }

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(container);
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  const handleScroll = (event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  if (!rootPath) {
    return (
      <div className="empty-tree">
        <p>No workspace</p>
      </div>
    );
  }

  return (
    <nav
      aria-label="Workspace files"
      className="file-tree"
      onScroll={handleScroll}
      ref={treeContainerRef}
    >
      <div
        className="tree-virtual-content"
        style={{ height: `${virtualContentHeight}px` }}
      >
        <div
          className="tree-virtual-window"
          style={{
            transform: `translateY(${renderedWindowOffset}px)`,
          }}
        >
          {rowsToRender.map((row) => (
            <TreeRow
              activePath={activePath}
              activeRowRef={activeRowRef}
              expandedDirectories={expandedDirectories}
              key={row.entry.path}
              loadingDirectories={loadingDirectories}
              onOpenFile={onOpenFile}
              onPreviewFile={onPreviewFile}
              onToggleDirectory={onToggleDirectory}
              row={row}
              rowStyle={{
                "--tree-level": row.level,
                height: `${TREE_ROW_HEIGHT}px`,
              } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

interface TreeRowProps {
  row: VisibleTreeRow;
  expandedDirectories: Set<string>;
  loadingDirectories: Set<string>;
  activePath: string | null;
  activeRowRef: RefObject<HTMLButtonElement | null>;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
  onToggleDirectory(path: string): void;
  rowStyle: CSSProperties;
}

function TreeRow({
  row,
  expandedDirectories,
  loadingDirectories,
  activePath,
  activeRowRef,
  onOpenFile,
  onPreviewFile,
  onToggleDirectory,
  rowStyle,
}: TreeRowProps) {
  const { entry, status } = row;
  const isDirectory = entry.kind === "directory";
  const isExpandable = isDirectory;
  const isExpanded = isDirectory && expandedDirectories.has(entry.path);
  const isLoading = isDirectory && loadingDirectories.has(entry.path);
  const title = status ? `${entry.path} (${gitStatusTitle(status)})` : entry.path;

  return (
    <button
      aria-expanded={isExpandable ? isExpanded : undefined}
      className={
        entry.path === activePath ? "tree-row tree-row-virtual active" : "tree-row tree-row-virtual"
      }
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
      style={rowStyle}
      title={title}
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
      {isLoading ? (
        <small aria-live="polite" className="tree-row-meta">
          Loading...
        </small>
      ) : null}
      {status ? (
        <span aria-label={gitStatusTitle(status)} className={getTreeRowStatusClassName(status)}>
          {gitStatusLabel(status)}
        </span>
      ) : null}
    </button>
  );
}

function getVisibleTreeRows({
  rootPath,
  entriesByDirectory,
  expandedDirectories,
  fileStatusesByPath,
}: {
  rootPath: string | null;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  fileStatusesByPath?: Record<string, GitChangeStatus>;
}): VisibleTreeState {
  if (!rootPath) {
    return { rows: [], indexByPath: new Map() };
  }

  const rows: VisibleTreeRow[] = [];
  const indexByPath = new Map<string, number>();
  const rootEntries = entriesByDirectory[rootPath] || [];
  const stack: Array<{ entries: FileEntry[]; index: number; level: number }> = [
    { entries: rootEntries, index: 0, level: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.index >= frame.entries.length) {
      stack.pop();
      continue;
    }

    const entry = frame.entries[frame.index++];
    indexByPath.set(entry.path, rows.length);
    rows.push({
      entry,
      level: frame.level,
      status: fileStatusesByPath?.[entry.path],
    });

    if (entry.kind === "directory" && expandedDirectories.has(entry.path)) {
      const children = entriesByDirectory[entry.path] || [];
      stack.push({ entries: children, index: 0, level: frame.level + 1 });
    }
  }

  return {
    indexByPath,
    rows,
  };
}

function getTreeRowStatusClassName(status: GitChangeStatus): string {
  if (status === "added" || status === "renamed") {
    return "tree-row-status tree-row-status-added";
  }

  if (status === "modified") {
    return "tree-row-status tree-row-status-modified";
  }

  return `tree-row-status tree-row-status-${status}`;
}

function getChevronClassName(
  isExpandable: boolean,
  isExpanded: boolean,
): string {
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
