import { FileSearch, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { TextSearchResult } from "../domain/workspace";

interface TextSearchProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  results: TextSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpen(result: TextSearchResult): void;
}

export function TextSearch({
  isOpen,
  isLoading,
  onChangeQuery,
  onClose,
  onOpen,
  query,
  results,
}: TextSearchProps) {
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
        aria-label="Text search"
        className="text-search"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search text"
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
            placeholder="Search text"
            value={query}
          />
        </div>

        <div className="text-search-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {!isLoading && query.trim() && results.length === 0 ? (
            <div className="quick-open-state">No matches found</div>
          ) : null}
          {!isLoading && !query.trim() ? (
            <div className="quick-open-state">Enter a search term</div>
          ) : null}
          {results.map((result, index) => (
            <button
              className={
                index === activeIndex
                  ? "text-search-result active"
                  : "text-search-result"
              }
              key={`${result.path}:${result.lineNumber}:${result.column}`}
              onClick={() => onOpen(result)}
              onMouseEnter={() => setActiveIndex(index)}
              title={result.path}
              type="button"
            >
              <FileSearch aria-hidden="true" size={16} />
              <span>
                <strong>
                  {result.relativePath}:{result.lineNumber}:{result.column}
                </strong>
                <small>{result.lineText}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
