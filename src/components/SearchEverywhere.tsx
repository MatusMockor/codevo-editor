import { FileCode2, Search, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  flattenSearchEverywhereItems,
  type SearchEverywhereItem,
  type SearchEverywhereModel,
} from "../domain/searchEverywhere";
import { PaletteFooter } from "./PaletteFooter";
import { SymbolKindIcon } from "./SymbolKindIcon";

interface SearchEverywhereProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  model: SearchEverywhereModel;
  onChangeQuery(query: string): void;
  onClose(): void;
  onActivate(item: SearchEverywhereItem): void;
}

// Files and actions keep their subtle lucide glyph; symbols get the shared,
// kind-coloured round badge so they match the File Structure / Class Open
// palettes (theme-aware via the --symbol-* tokens).
function itemIcon(item: SearchEverywhereItem): ReactNode {
  if (item.kind === "symbol") {
    return <SymbolKindIcon kind={item.symbol.kind} />;
  }

  if (item.kind === "file") {
    return <FileCode2 aria-hidden="true" size={16} />;
  }

  return <Terminal aria-hidden="true" size={16} />;
}

// PhpStorm "Search Everywhere" (double-Shift). One dialog aggregating the
// existing file / symbol / command searches into categorized sections. The
// component is presentation only: the controller does the (per-root, debounced,
// drop-stale) searching and hands in a ready-built model. Keyboard navigation
// runs over the flattened item list so Up/Down crosses section boundaries, and
// Enter routes back through a single onActivate callback that the controller
// maps to open-file / reveal-symbol / run-command.
export function SearchEverywhere({
  isLoading,
  isOpen,
  model,
  onActivate,
  onChangeQuery,
  onClose,
  query,
}: SearchEverywhereProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const flatItems = useMemo(
    () => flattenSearchEverywhereItems(model),
    [model],
  );

  // Presentation only: the controller owns the query (reset on open and on
  // workspace switch), so this component just keeps its local selection in sync.
  useEffect(() => {
    setActiveIndex(0);
  }, [isOpen, query, model]);

  if (!isOpen) {
    return null;
  }

  const activeItem = flatItems[activeIndex];
  const hasResults = flatItems.length > 0;

  const handleActivate = (item: SearchEverywhereItem) => {
    onActivate(item);
  };

  let runningIndex = 0;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Search everywhere"
        className="quick-open search-everywhere"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search everywhere"
            autoFocus
            onChange={(event) => onChangeQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  Math.min(current + 1, Math.max(flatItems.length - 1, 0)),
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }

              if (event.key === "Enter" && activeItem) {
                event.preventDefault();
                handleActivate(activeItem);
              }
            }}
            placeholder="Search files, symbols and actions"
            value={query}
          />
        </div>

        <div className="quick-open-results search-everywhere-results">
          {isLoading ? (
            <div className="quick-open-state search-everywhere-state">
              Searching...
            </div>
          ) : null}
          {!isLoading && !hasResults ? (
            <div className="quick-open-state search-everywhere-state">
              No results
            </div>
          ) : null}
          {model.sections.map((section) => (
            <div className="search-everywhere-section" key={section.kind}>
              <div className="search-everywhere-section-label">
                {section.label}
              </div>
              {section.items.map((item) => {
                const index = runningIndex;
                runningIndex += 1;

                return (
                  <button
                    className={
                      index === activeIndex
                        ? "quick-open-result search-everywhere-result active"
                        : "quick-open-result search-everywhere-result"
                    }
                    key={item.id}
                    onClick={() => handleActivate(item)}
                    onMouseEnter={() => setActiveIndex(index)}
                    title={item.detail}
                    type="button"
                  >
                    {itemIcon(item)}
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    {item.kind === "action" && item.shortcut ? (
                      <kbd>{item.shortcut}</kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <PaletteFooter />
      </section>
    </div>
  );
}
