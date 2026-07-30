import { CornerDownLeft, FileSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  referenceGroups,
  referenceRows,
  referencesSummaryLabel,
  type ReferenceRow,
  type ReferencesView,
} from "../domain/referencesView";

interface ReferencesPanelProps {
  isOpen: boolean;
  onClose(): void;
  onOpen(row: ReferenceRow): void;
  view: ReferencesView | null;
  workspaceRoot: string | null;
}

export const REFERENCES_PANEL_PAGE_SIZE = 100;

export function ReferencesPanel({
  isOpen,
  onClose,
  onOpen,
  view,
  workspaceRoot,
}: ReferencesPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const rows = useMemo(
    () => (view ? referenceRows(view, workspaceRoot) : []),
    [view, workspaceRoot],
  );
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [rows]);
  const activeRow = rows[activeIndex];
  const pageStart =
    Math.floor(activeIndex / REFERENCES_PANEL_PAGE_SIZE) * REFERENCES_PANEL_PAGE_SIZE;
  const visibleRows = useMemo(
    () => rows.slice(pageStart, pageStart + REFERENCES_PANEL_PAGE_SIZE),
    [pageStart, rows],
  );
  const visibleGroups = useMemo(() => referenceGroups(visibleRows), [visibleRows]);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex(0);
    containerRef.current?.focus();
  }, [isOpen, view]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen || !view) {
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
      setActiveIndex((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeRow) {
      event.preventDefault();
      onOpen(activeRow);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={`References to ${view.symbol}`}
        aria-modal="true"
        className="references-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="references-panel-header">
          <span>
            <strong>References to {view.symbol}</strong>
            <small>{referencesSummaryLabel(rows.length, view.totalCount, view.isIncomplete)}</small>
            {view.isIncomplete ? (
              <small role="status">Some references were omitted by safety limits.</small>
            ) : null}
          </span>
          <CornerDownLeft aria-hidden="true" size={15} />
        </header>

        <div className="references-panel-results" role="listbox">
          {rows.length === 0 ? (
            <div className="references-panel-empty">No references found</div>
          ) : null}
          {visibleGroups.map((group) => (
            <section className="references-panel-group" key={group.path}>
              <h2 title={group.path}>{group.relativePath}</h2>
              {group.rows.map((row) => {
                const index = indexById.get(row.id) ?? -1;

                return (
                  <button
                    aria-selected={index === activeIndex}
                    className={
                      index === activeIndex ? "references-panel-row active" : "references-panel-row"
                    }
                    key={row.id}
                    onClick={() => onOpen(row)}
                    onMouseEnter={() => setActiveIndex(index)}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    role="option"
                    title={`${row.relativePath}:${row.line}:${row.column}`}
                    type="button"
                  >
                    <FileSearch aria-hidden="true" size={15} />
                    <span>
                      <strong>
                        {row.relativePath}:{row.line}
                      </strong>
                      <small>
                        Line {row.line}, column {row.column}
                      </small>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        {rows.length > REFERENCES_PANEL_PAGE_SIZE ? (
          <footer className="references-panel-pagination">
            <button
              disabled={pageStart === 0}
              onClick={() => setActiveIndex(Math.max(0, pageStart - REFERENCES_PANEL_PAGE_SIZE))}
              type="button"
            >
              Previous
            </button>
            <span>
              {pageStart + 1}–{Math.min(pageStart + REFERENCES_PANEL_PAGE_SIZE, rows.length)} of{" "}
              {rows.length}
            </span>
            <button
              disabled={pageStart + REFERENCES_PANEL_PAGE_SIZE >= rows.length}
              onClick={() =>
                setActiveIndex(Math.min(rows.length - 1, pageStart + REFERENCES_PANEL_PAGE_SIZE))
              }
              type="button"
            >
              Next
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
