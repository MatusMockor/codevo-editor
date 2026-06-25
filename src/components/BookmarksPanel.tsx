import { Bookmark as BookmarkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { sortBookmarks, type Bookmark } from "../domain/bookmarks";

interface BookmarksPanelProps {
  bookmarks: Bookmark[];
  isOpen: boolean;
  onClose(): void;
  onOpenBookmark(bookmark: Bookmark): void;
  workspaceRoot: string | null;
}

interface BookmarkGroup {
  path: string;
  relativePath: string;
  bookmarks: Bookmark[];
}

export function BookmarksPanel({
  bookmarks,
  isOpen,
  onClose,
  onOpenBookmark,
  workspaceRoot,
}: BookmarksPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const sorted = useMemo(() => sortBookmarks(bookmarks), [bookmarks]);
  const groups = useMemo(
    () => groupBookmarks(sorted, workspaceRoot),
    [sorted, workspaceRoot],
  );
  const activeBookmark = sorted[activeIndex];

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(sorted.length - 1, 0)),
    );
  }, [sorted.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(sorted.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeBookmark) {
      event.preventDefault();
      onOpenBookmark(activeBookmark);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Bookmarks"
        aria-modal="true"
        className="todo-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="todo-panel-header">
          <span>
            <strong>Bookmarks</strong>
            <small>{summaryLabel(sorted.length)}</small>
          </span>
        </header>

        <div className="todo-panel-results" role="listbox">
          {sorted.length === 0 ? (
            <div className="todo-panel-empty">No bookmarks</div>
          ) : null}
          {groups.map((group) => (
            <section className="todo-panel-group" key={group.path}>
              <h2 title={group.path}>{group.relativePath}</h2>
              {group.bookmarks.map((bookmark) => {
                const index = sorted.indexOf(bookmark);

                return (
                  <button
                    aria-selected={index === activeIndex}
                    className={
                      index === activeIndex
                        ? "todo-panel-row active"
                        : "todo-panel-row"
                    }
                    key={bookmarkKey(bookmark)}
                    onClick={() => onOpenBookmark(bookmark)}
                    onMouseEnter={() => setActiveIndex(index)}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    role="option"
                    title={`${group.relativePath}:${bookmark.lineNumber}`}
                    type="button"
                  >
                    <BookmarkIcon aria-hidden="true" size={15} />
                    <span>
                      <strong>{bookmark.preview || group.relativePath}</strong>
                      <small>
                        {group.relativePath}:{bookmark.lineNumber}
                      </small>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function summaryLabel(count: number): string {
  if (count === 0) {
    return "No bookmarks";
  }

  return count === 1 ? "1 bookmark" : `${count} bookmarks`;
}

function groupBookmarks(
  bookmarks: Bookmark[],
  workspaceRoot: string | null,
): BookmarkGroup[] {
  const groups: BookmarkGroup[] = [];

  bookmarks.forEach((bookmark) => {
    const last = groups[groups.length - 1];

    if (last && last.path === bookmark.path) {
      last.bookmarks.push(bookmark);
      return;
    }

    groups.push({
      bookmarks: [bookmark],
      path: bookmark.path,
      relativePath: relativeWorkspacePath(workspaceRoot, bookmark.path),
    });
  });

  return groups;
}

function relativeWorkspacePath(
  workspaceRoot: string | null,
  path: string,
): string {
  if (!workspaceRoot) {
    return path.split("/").slice(-1)[0] ?? path;
  }

  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const rootPrefix = `${normalizedRoot}/`;

  if (path.startsWith(rootPrefix)) {
    return path.slice(rootPrefix.length);
  }

  return path.split("/").slice(-2).join("/");
}

function bookmarkKey(bookmark: Bookmark): string {
  return `${bookmark.path}:${bookmark.lineNumber}`;
}
