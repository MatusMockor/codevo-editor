import { Code2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";

interface WorkspaceSymbolsProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  results: ProjectSymbolSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpen(result: ProjectSymbolSearchResult): void;
}

export function WorkspaceSymbols({
  isLoading,
  isOpen,
  onChangeQuery,
  onClose,
  onOpen,
  query,
  results,
}: WorkspaceSymbolsProps) {
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
        aria-label="Go to symbol in workspace"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search workspace symbols"
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
            placeholder="Search workspace symbols"
            value={query}
          />
        </div>

        <div className="quick-open-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {!isLoading && results.length === 0 ? (
            <div className="quick-open-state">No symbols found</div>
          ) : null}
          {results.map((result, index) => (
            <button
              className={
                index === activeIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              key={workspaceSymbolKey(result, index)}
              onClick={() => onOpen(result)}
              onMouseEnter={() => setActiveIndex(index)}
              title={result.fullyQualifiedName}
              type="button"
            >
              <Code2 aria-hidden="true" size={16} />
              <span>
                <strong>{result.name}</strong>
                <small>
                  {result.kind} · {result.relativePath}:{result.lineNumber}
                </small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function workspaceSymbolKey(
  result: ProjectSymbolSearchResult,
  index: number,
): string {
  return [
    index,
    result.kind,
    result.fullyQualifiedName,
    result.path,
    result.lineNumber,
    result.column,
  ].join("\0");
}
