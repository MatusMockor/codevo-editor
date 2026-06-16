import { ListTree, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  flattenPhpFileOutlineNodes,
  isNavigablePhpFileOutlineNode,
  type FlatPhpFileOutlineNode,
  type PhpFileOutline,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";

interface FileStructureProps {
  fileName: string | null;
  isLoading: boolean;
  isOpen: boolean;
  outline: PhpFileOutline | null;
  onClose(): void;
  onOpenNode(node: PhpFileOutlineNode): void;
}

export function FileStructure({
  fileName,
  isLoading,
  isOpen,
  onClose,
  onOpenNode,
  outline,
}: FileStructureProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => filteredRows(outline?.nodes ?? [], query),
    [outline, query],
  );
  const activeRow = rows[activeIndex];

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      setQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="File structure"
        className="file-structure"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search symbols"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
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
                onOpenNode(activeRow.node);
                onClose();
              }
            }}
            placeholder={fileName ? `Structure in ${fileName}` : "File structure"}
            value={query}
          />
        </div>

        <div className="quick-open-results">
          {isLoading ? <div className="quick-open-state">Loading symbols...</div> : null}
          {!isLoading && !outline ? (
            <div className="quick-open-state">Open a PHP file first</div>
          ) : null}
          {!isLoading && outline && rows.length === 0 ? (
            <div className="quick-open-state">No symbols found</div>
          ) : null}
          {rows.map((row, index) => (
            <button
              className={
                index === activeIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              disabled={!isNavigablePhpFileOutlineNode(row.node)}
              key={row.node.id}
              onClick={() => {
                onOpenNode(row.node);
                onClose();
              }}
              onMouseEnter={() => setActiveIndex(index)}
              title={row.node.fullyQualifiedName || row.node.label}
              type="button"
            >
              <ListTree aria-hidden="true" size={16} />
              <span
                style={
                  { "--structure-indent": `${row.depth * 14}px` } as CSSProperties
                }
              >
                <strong>{row.node.label}</strong>
                <small>{symbolDetail(row)}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function filteredRows(
  nodes: PhpFileOutlineNode[],
  query: string,
): FlatPhpFileOutlineNode[] {
  const rows = flattenPhpFileOutlineNodes(nodes);
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => {
    const haystack = [
      row.node.fullyQualifiedName,
      row.node.kind,
      row.node.label,
      row.node.relativePath,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function symbolDetail(row: FlatPhpFileOutlineNode): string {
  const location = row.node.lineNumber ? `:${row.node.lineNumber}` : "";
  return `${row.node.kind}${location}`;
}
