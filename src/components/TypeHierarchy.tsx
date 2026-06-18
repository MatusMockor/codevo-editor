import { ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
  typeHierarchyRows,
  typeHierarchySectionTitle,
  type TypeHierarchyDirection,
  type TypeHierarchyRow,
  type TypeHierarchyView,
} from "../domain/typeHierarchy";

interface TypeHierarchyProps {
  isOpen: boolean;
  onClose(): void;
  onOpen(row: TypeHierarchyRow): void;
  view: TypeHierarchyView | null;
}

export function TypeHierarchy({
  isOpen,
  onClose,
  onOpen,
  view,
}: TypeHierarchyProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const rows = useMemo(() => (view ? typeHierarchyRows(view) : []), [view]);
  const activeRow = rows[activeIndex];

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
    });
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
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(rows.length - 1, 0)),
      );
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
        aria-label={`Type hierarchy of ${view.item.name}`}
        aria-modal="true"
        className="call-hierarchy"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="call-hierarchy-header">
          <span>
            <strong>Type hierarchy of {view.item.name}</strong>
            <small>{view.item.detail || view.item.uri}</small>
          </span>
          <CornerDownLeft aria-hidden="true" size={15} />
        </header>

        <div className="call-hierarchy-results" role="listbox">
          {renderSection(
            "supertype",
            rows,
            activeIndex,
            activeRowRef,
            setActiveIndex,
            onOpen,
          )}
          {renderSection(
            "subtype",
            rows,
            activeIndex,
            activeRowRef,
            setActiveIndex,
            onOpen,
          )}
        </div>
      </section>
    </div>
  );
}

function renderSection(
  direction: TypeHierarchyDirection,
  rows: TypeHierarchyRow[],
  activeIndex: number,
  activeRowRef: RefObject<HTMLButtonElement | null>,
  setActiveIndex: (index: number) => void,
  onOpen: (row: TypeHierarchyRow) => void,
) {
  const sectionRows = rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row.direction === direction);

  return (
    <section className="call-hierarchy-section">
      <h2>{typeHierarchySectionTitle(direction)}</h2>
      {sectionRows.length === 0 ? (
        <div className="call-hierarchy-empty">No types found</div>
      ) : null}
      {sectionRows.map(({ index, row }) => (
        <button
          aria-selected={index === activeIndex}
          className={
            index === activeIndex
              ? "call-hierarchy-row active"
              : "call-hierarchy-row"
          }
          key={row.id}
          onClick={() => onOpen(row)}
          onMouseEnter={() => setActiveIndex(index)}
          ref={index === activeIndex ? activeRowRef : undefined}
          role="option"
          title={row.detail}
          type="button"
        >
          {direction === "supertype" ? (
            <ArrowUp aria-hidden="true" size={15} />
          ) : (
            <ArrowDown aria-hidden="true" size={15} />
          )}
          <span>
            <strong>{row.label}</strong>
            <small>
              {row.kindLabel} · {row.detail}
            </small>
          </span>
        </button>
      ))}
    </section>
  );
}
