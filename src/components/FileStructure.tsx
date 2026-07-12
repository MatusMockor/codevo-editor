import { Search } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import {
  flattenPhpFileOutlineNodes,
  isNavigablePhpFileOutlineNode,
  type FlatPhpFileOutlineNode,
  type PhpFileOutline,
  type PhpFileOutlineNodeKind,
  type PhpFileStructureScope,
  type PhpFileOutlineNode,
  type PhpSymbolVisibility,
} from "../domain/phpFileOutline";
import { PaletteFooter } from "./PaletteFooter";
import { symbolKindLetter } from "./SymbolKindIcon";

interface FileStructureProps {
  canIncludeInheritedMembers: boolean;
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
  canIncludeInheritedMembers,
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const rows = useMemo(
    () => filteredRows(structureRows(outline?.nodes ?? []), query),
    [outline, query],
  );
  const activeRow = rows[activeIndex];

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusInput = () => {
      const input = inputRef.current;
      const popup = popupRef.current;

      if (!input || !popup) {
        return;
      }

      if (document.activeElement && popup.contains(document.activeElement)) {
        return;
      }

      input.focus({ preventScroll: true });
    };
    focusInput();

    const animationFrame = window.requestAnimationFrame?.(focusInput);
    const timeout = window.setTimeout(focusInput, 0);

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame?.(animationFrame);
      }
      window.clearTimeout(timeout);
    };
  }, [isOpen]);

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const hasTextModifier = event.altKey || event.ctrlKey || event.metaKey;
      const targetIsInsidePopup = containsEventTarget(
        popupRef.current,
        event.target,
      );

      if (event.key === "Escape") {
        consumePopupKey(event, inputRef.current);
        onClose();
        return;
      }

      if (hasTextModifier || event.isComposing) {
        return;
      }

      if (event.key === "ArrowDown") {
        consumePopupKey(event, inputRef.current);
        setActiveIndex((current) =>
          Math.min(current + 1, Math.max(rows.length - 1, 0)),
        );
        return;
      }

      if (event.key === "ArrowUp") {
        consumePopupKey(event, inputRef.current);
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter" && shouldOpenActiveElement(event.target)) {
        consumePopupKey(event, inputRef.current);

        if (activeRow) {
          onOpenNode(activeRow.node);
          onClose();
        }
        return;
      }

      if (event.key === "Backspace") {
        if (targetIsInsidePopup && event.target !== inputRef.current) {
          return;
        }

        routeTextKey(event, inputRef.current, () =>
          setQuery((current) => current.slice(0, -1)),
        );
        return;
      }

      if (event.key.length === 1) {
        if (targetIsInsidePopup && event.target !== inputRef.current) {
          return;
        }

        routeTextKey(event, inputRef.current, () =>
          setQuery((current) => `${current}${event.key}`),
        );
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [activeRow, isOpen, onClose, onOpenNode, rows.length]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="File structure"
        aria-modal="true"
        className="file-structure"
        onMouseDown={(event) => event.stopPropagation()}
        ref={popupRef}
        role="dialog"
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={
              activeRow ? structureOptionId(listboxId, activeIndex) : undefined
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-label="Search symbols"
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={structurePlaceholder(fileName, scope)}
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </div>

        {canIncludeInheritedMembers ? (
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
        ) : null}

        <div className="quick-open-results" id={listboxId} role="listbox">
          {isLoading ? <div className="quick-open-state">Loading symbols...</div> : null}
          {!isLoading && !outline ? (
            <div className="quick-open-state">Open a supported file first</div>
          ) : null}
          {!isLoading && outline && rows.length === 0 ? (
            <div className="quick-open-state">No symbols found</div>
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
              id={structureOptionId(listboxId, index)}
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
              <span
                aria-hidden="true"
                className="symbol-icon"
                data-kind={row.node.kind}
                data-static={row.node.isStatic ? "true" : undefined}
              >
                {symbolIconLetter(row.node.kind)}
              </span>
              {row.node.visibility ? (
                <span
                  aria-hidden="true"
                  className="symbol-visibility"
                  data-visibility={row.node.visibility}
                >
                  {visibilityGlyph(row.node.visibility)}
                </span>
              ) : (
                <span aria-hidden="true" className="symbol-visibility-spacer" />
              )}
              <span
                className="symbol-label"
                style={
                  { "--structure-indent": `${row.depth * 14}px` } as CSSProperties
                }
              >
                <strong>{row.node.label}</strong>
                {symbolSignature(row.node) ? (
                  <span className="signature">{symbolSignature(row.node)}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>

        <PaletteFooter />
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

function shouldOpenActiveElement(target: EventTarget | null): boolean {
  if (target instanceof HTMLButtonElement) {
    return false;
  }

  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    return false;
  }

  return true;
}

function containsEventTarget(
  container: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  return container !== null && target instanceof Node && container.contains(target);
}

function structureOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function consumePopupKey(
  event: globalThis.KeyboardEvent,
  input: HTMLInputElement | null,
): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  input?.focus({ preventScroll: true });
}

function routeTextKey(
  event: globalThis.KeyboardEvent,
  input: HTMLInputElement | null,
  updateQuery: () => void,
): void {
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (event.target === input) {
    return;
  }

  event.preventDefault();
  input?.focus({ preventScroll: true });
  updateQuery();
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
  return ["constant", "function", "method", "property", "variable"].includes(
    node.kind,
  );
}

function structureKindOrder(node: PhpFileOutlineNode): number {
  const order: Record<string, number> = {
    property: 0,
    method: 1,
    constant: 2,
    function: 3,
    variable: 4,
  };

  return order[node.kind] ?? 4;
}

const VISIBILITY_GLYPHS: Record<PhpSymbolVisibility, string> = {
  private: "−",
  protected: "#",
  public: "+",
};

function symbolIconLetter(kind: PhpFileOutlineNodeKind): string {
  return symbolKindLetter(kind);
}

function visibilityGlyph(visibility: PhpSymbolVisibility): string {
  return VISIBILITY_GLYPHS[visibility];
}

function symbolSignature(node: PhpFileOutlineNode): string {
  if (node.kind === "method" || node.kind === "function") {
    return methodSignature(node);
  }

  if (node.returnType) {
    return `: ${node.returnType}`;
  }

  return "";
}

function methodSignature(node: PhpFileOutlineNode): string {
  if (!node.parameters) {
    return node.returnType ? `: ${node.returnType}` : "";
  }

  const params = node.parameters
    .map((parameter) =>
      parameter.type ? `${parameter.type} ${parameter.name}` : parameter.name,
    )
    .join(", ");
  const returnSuffix = node.returnType ? `: ${node.returnType}` : "";

  return `(${params})${returnSuffix}`;
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
