import { ListTree, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { KeyboardEvent } from "react";
import {
  flattenPhpFileOutlineNodes,
  isNavigablePhpFileOutlineNode,
  type FlatPhpFileOutlineNode,
  type PhpFileOutline,
  type PhpFileStructureScope,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";

interface FileStructureProps {
  fileName: string | null;
  isLoading: boolean;
  isOpen: boolean;
  outline: PhpFileOutline | null;
  scope: PhpFileStructureScope;
  onChangeScope(scope: PhpFileStructureScope): void;
  onClose(): void;
  onOpenNode(node: PhpFileOutlineNode): void;
}

export function FileStructure({
  fileName,
  isLoading,
  isOpen,
  onChangeScope,
  onClose,
  onOpenNode,
  outline,
  scope,
}: FileStructureProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const rows = useMemo(
    () => filteredRows(structureRows(outline?.nodes ?? []), query),
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

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, rows.length]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
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

    if (!shouldOpenActiveRow(event)) {
      return;
    }

    if (activeRow) {
      event.preventDefault();
      onOpenNode(activeRow.node);
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="File structure"
        aria-modal="true"
        className="file-structure"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search symbols"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={structurePlaceholder(fileName, scope)}
            value={query}
          />
        </div>

        <label className="file-structure-option">
          <input
            checked={scope === "inherited"}
            onChange={(event) => {
              const nextScope = event.currentTarget.checked
                ? "inherited"
                : "current";
              onChangeScope(nextScope);
            }}
            type="checkbox"
          />
          <span>Include inherited members</span>
        </label>

        <div className="quick-open-results" role="listbox">
          {isLoading ? <div className="quick-open-state">Loading symbols...</div> : null}
          {!isLoading && !outline ? (
            <div className="quick-open-state">Open a PHP file first</div>
          ) : null}
          {!isLoading && outline && rows.length === 0 ? (
            <div className="quick-open-state">No methods or properties found</div>
          ) : null}
          {rows.map((row, index) => (
            <button
              aria-selected={index === activeIndex}
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
              ref={index === activeIndex ? activeRowRef : undefined}
              role="option"
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
  rows: FlatPhpFileOutlineNode[],
  query: string,
): FlatPhpFileOutlineNode[] {
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

function structureRows(nodes: PhpFileOutlineNode[]): FlatPhpFileOutlineNode[] {
  const memberRows = nodes
    .map(memberRowsForNode)
    .filter((rows) => rows.length > 0)
    .flatMap((rows) => [...rows].sort(compareStructureRows));

  if (memberRows.length > 0) {
    return memberRows;
  }

  return flattenPhpFileOutlineNodes(nodes);
}

function shouldOpenActiveRow(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter") {
    return false;
  }

  const target = event.target;

  if (target instanceof HTMLButtonElement) {
    return false;
  }

  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    return false;
  }

  return true;
}

function memberRowsForNode(node: PhpFileOutlineNode): FlatPhpFileOutlineNode[] {
  if (isTypeNode(node)) {
    return node.children
      .filter(isStructureMemberNode)
      .map((child) => ({ depth: 0, node: child }));
  }

  if (isStructureMemberNode(node)) {
    return [{ depth: 0, node }];
  }

  return [];
}

function compareStructureRows(
  left: FlatPhpFileOutlineNode,
  right: FlatPhpFileOutlineNode,
): number {
  const kindOrder = structureKindOrder(left.node) - structureKindOrder(right.node);

  if (kindOrder !== 0) {
    return kindOrder;
  }

  return (left.node.lineNumber ?? 0) - (right.node.lineNumber ?? 0);
}

function isTypeNode(node: PhpFileOutlineNode): boolean {
  return ["class", "enum", "interface", "trait"].includes(node.kind);
}

function isStructureMemberNode(node: PhpFileOutlineNode): boolean {
  return ["constant", "function", "method", "property"].includes(node.kind);
}

function structureKindOrder(node: PhpFileOutlineNode): number {
  const order: Record<string, number> = {
    property: 0,
    method: 1,
    constant: 2,
    function: 3,
  };

  return order[node.kind] ?? 4;
}

function symbolDetail(row: FlatPhpFileOutlineNode): string {
  const location = row.node.lineNumber ? `:${row.node.lineNumber}` : "";
  const owner = symbolOwner(row.node);

  if (owner) {
    return `${row.node.kind} · ${owner}${location}`;
  }

  return `${row.node.kind}${location}`;
}

function symbolOwner(node: PhpFileOutlineNode): string | null {
  const container = node.fullyQualifiedName?.split("::")[0];

  if (!container || container === node.fullyQualifiedName) {
    return null;
  }

  const parts = container.split("\\");
  return parts[parts.length - 1] || container;
}

function structurePlaceholder(
  fileName: string | null,
  scope: PhpFileStructureScope,
): string {
  const prefix = scope === "inherited" ? "Current + inherited" : "Structure";

  if (!fileName) {
    return prefix;
  }

  return `${prefix} in ${fileName}`;
}
