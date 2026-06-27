import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import { PaletteFooter } from "./PaletteFooter";
import { SymbolKindIcon } from "./SymbolKindIcon";

interface ClassOpenProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  results: ProjectSymbolSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpen(result: ProjectSymbolSearchResult): void;
}

export function ClassOpen({
  isOpen,
  isLoading,
  onChangeQuery,
  onClose,
  onOpen,
  query,
  results,
}: ClassOpenProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      onChangeQuery("");
    }
  }, [isOpen, onChangeQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) {
    return null;
  }

  const activeResult = results[activeIndex];

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Open class or interface"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search classes and interfaces"
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
                  Math.min(current + 1, Math.max(results.length - 1, 0)),
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }

              if (event.key === "Enter" && activeResult) {
                event.preventDefault();
                onOpen(activeResult);
              }
            }}
            placeholder="Open class, interface, trait, or enum"
            value={query}
          />
        </div>

        <div className="quick-open-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {!isLoading && results.length === 0 ? (
            <div className="quick-open-state">No types found</div>
          ) : null}
          {results.map((result, index) => (
            <button
              className={
                index === activeIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              key={result.fullyQualifiedName}
              onClick={() => onOpen(result)}
              onMouseEnter={() => setActiveIndex(index)}
              title={result.fullyQualifiedName}
              type="button"
            >
              <SymbolKindIcon kind={result.kind} />
              <span>
                <strong>{result.name}</strong>
                <small>
                  {result.kind} · {result.fullyQualifiedName}
                </small>
              </span>
            </button>
          ))}
        </div>

        <PaletteFooter />
      </section>
    </div>
  );
}
