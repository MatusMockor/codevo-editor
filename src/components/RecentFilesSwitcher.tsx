import { FileCode2, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import type { RecentFileEntry } from "../domain/recentFiles";
import { PaletteFooter } from "./PaletteFooter";

interface RecentFilesSwitcherProps {
  entries: RecentFileEntry[];
  isOpen: boolean;
  onClose(): void;
  onOpen(entry: RecentFileEntry): void;
}

interface MruEntry {
  readonly name: string;
  readonly path: string;
}

interface MruEntriesOverlayProps<Entry extends MruEntry> {
  readonly activeIndex: number;
  readonly ariaLabel: string;
  readonly emptyLabel: string;
  readonly entries: readonly Entry[];
  readonly heading: string;
  readonly footer?: ReactNode;
  readonly listRef?: Ref<HTMLDivElement>;
  readonly onBackdrop: () => void;
  readonly onEntry: (entry: Entry) => void;
  readonly onHover?: (index: number) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

function optionId(label: string, entry: MruEntry): string {
  return `${label.toLowerCase().replace(/ /gu, "-")}-${entry.path}`;
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
    setActiveIndex((current) => Math.min(current, Math.max(entries.length - 1, 0)));
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
      setActiveIndex((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)));
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
    <MruEntriesOverlay
      activeIndex={activeIndex}
      ariaLabel="Recent files"
      emptyLabel="No recent files"
      entries={entries}
      heading="Recent Files"
      listRef={listRef}
      onBackdrop={onClose}
      onEntry={onOpen}
      onHover={setActiveIndex}
      onKeyDown={handleKeyDown}
      footer={<PaletteFooter />}
    />
  );
}

export function MruEntriesOverlay<Entry extends MruEntry>({
  activeIndex,
  ariaLabel,
  emptyLabel,
  entries,
  footer,
  heading,
  listRef,
  onBackdrop,
  onEntry,
  onHover,
  onKeyDown,
}: MruEntriesOverlayProps<Entry>) {
  const activeEntry = entries[activeIndex];
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeEntry?.path, activeIndex]);

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onBackdrop}>
      <section
        aria-label={ariaLabel}
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <History aria-hidden="true" size={17} />
          <div className="recent-files-heading">{heading}</div>
        </div>

        <div aria-live="polite" className="mru-switcher-status" role="status">
          {activeEntry?.name ?? emptyLabel}
        </div>
        <div
          aria-activedescendant={activeEntry ? optionId(ariaLabel, activeEntry) : undefined}
          aria-label={ariaLabel}
          className="quick-open-results"
          onKeyDown={onKeyDown}
          ref={listRef}
          role="listbox"
          tabIndex={0}
        >
          {entries.length === 0 ? <div className="quick-open-state">{emptyLabel}</div> : null}
          {entries.map((entry, index) => (
            <button
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "quick-open-result active" : "quick-open-result"}
              id={optionId(ariaLabel, entry)}
              key={entry.path}
              onClick={() => onEntry(entry)}
              onMouseEnter={() => onHover?.(index)}
              ref={index === activeIndex ? activeOptionRef : undefined}
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

        {footer}
      </section>
    </div>
  );
}
