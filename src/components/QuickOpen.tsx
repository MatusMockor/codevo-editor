import { FileCode2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileSearchResult } from "../domain/workspace";
import { HighlightedText } from "./HighlightedText";
import { PaletteFooter } from "./PaletteFooter";

interface QuickOpenProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  results: FileSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpen(result: FileSearchResult): void;
}

export function QuickOpen({
  isOpen,
  isLoading,
  onChangeQuery,
  onClose,
  onOpen,
  query,
  results,
}: QuickOpenProps) {
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

  useEffect(() => {
    setActiveIndex((current) =>
      results.length === 0 ? 0 : Math.min(current, results.length - 1),
    );
  }, [results.length]);

  if (!isOpen) {
    return null;
  }

  const safeActiveIndex =
    results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const activeResult = safeActiveIndex >= 0 ? results[safeActiveIndex] : undefined;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Quick open"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search files"
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
            placeholder="Open file"
            value={query}
          />
        </div>

        <div className="quick-open-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {!isLoading && results.length === 0 ? (
            <div className="quick-open-state">No files found</div>
          ) : null}
          {results.map((result, index) => (
            <button
              className={
                index === safeActiveIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              key={result.path}
              onClick={() => onOpen(result)}
              onMouseEnter={() => setActiveIndex(index)}
              title={result.path}
              type="button"
            >
              <FileCode2 aria-hidden="true" size={16} />
              <span>
                <strong>
                  <HighlightedText query={query} text={result.name} />
                </strong>
                <small>
                  <HighlightedText query={query} text={result.relativePath} />
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
