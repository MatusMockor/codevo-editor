import { FileCode2, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { RecentFileEntry } from "../domain/recentFiles";

interface RecentFilesSwitcherProps {
  entries: RecentFileEntry[];
  isOpen: boolean;
  onClose(): void;
  onOpen(entry: RecentFileEntry): void;
}

function optionId(entry: RecentFileEntry): string {
  return `recent-file-${entry.path}`;
}

// PhpStorm-style recent files switcher (Cmd+E). The list is already ordered by
// the controller (most-recent first, current file dropped) so this component is
// presentation only: no fuzzy file search, just keyboard navigation over the
// MRU list. The first row is pre-selected so a single Cmd+E + Enter flips back
// to the previously edited file.
export function RecentFilesSwitcher({
  entries,
  isOpen,
  onClose,
  onOpen,
}: RecentFilesSwitcherProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex(0);
    listRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(entries.length - 1, 0)),
    );
  }, [entries.length]);

  if (!isOpen) {
    return null;
  }

  const activeEntry = entries[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(entries.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeEntry) {
      event.preventDefault();
      onOpen(activeEntry);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Recent files"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <History aria-hidden="true" size={17} />
          <div className="recent-files-heading">Recent Files</div>
        </div>

        <div
          aria-activedescendant={
            activeEntry ? optionId(activeEntry) : undefined
          }
          aria-label="Recent files"
          className="quick-open-results"
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
          tabIndex={0}
        >
          {entries.length === 0 ? (
            <div className="quick-open-state">No recent files</div>
          ) : null}
          {entries.map((entry, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              id={optionId(entry)}
              key={entry.path}
              onClick={() => onOpen(entry)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              title={entry.path}
              type="button"
            >
              <FileCode2 aria-hidden="true" size={16} />
              <span>
                <strong>{entry.name}</strong>
                <small>{entry.path}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
