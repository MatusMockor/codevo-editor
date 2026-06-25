import { Asterisk, CaseSensitive, FileSearch, Regex, Search, WholeWord } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  TextSearchOptions,
  TextSearchResult,
} from "../domain/workspace";

interface TextSearchProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  options: TextSearchOptions;
  results: TextSearchResult[];
  onChangeQuery(query: string): void;
  onChangeOptions(options: TextSearchOptions): void;
  onClose(): void;
  onOpen(result: TextSearchResult): void;
}

/**
 * Splits a result line into the text before the match, the matched span, and the
 * text after it so the match can be highlighted without re-running the query in
 * JS. Offsets are 0-based char positions reported by the backend; out-of-range
 * or absent spans degrade to "no highlight" rather than throwing.
 */
export function splitMatchHighlight(result: TextSearchResult): {
  before: string;
  match: string;
  after: string;
} {
  const chars = Array.from(result.lineText);
  const start = clampOffset(result.matchStart ?? 0, chars.length);
  const end = clampOffset(result.matchEnd ?? 0, chars.length);

  if (end <= start) {
    return { before: result.lineText, match: "", after: "" };
  }

  return {
    before: chars.slice(0, start).join(""),
    match: chars.slice(start, end).join(""),
    after: chars.slice(end).join(""),
  };
}

function clampOffset(value: number, length: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(Math.trunc(value), length);
}

export function TextSearch({
  isLoading,
  isOpen,
  onChangeOptions,
  onChangeQuery,
  onClose,
  onOpen,
  options,
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
  }, [query, options]);

  if (!isOpen) {
    return null;
  }

  const activeResult = results[activeIndex];

  const toggleOption = (key: "caseSensitive" | "wholeWord" | "isRegex") => {
    onChangeOptions({ ...options, [key]: !options[key] });
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Find in path"
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
            placeholder="Find in path"
            value={query}
          />
        </div>

        <div className="text-search-filters">
          <button
            aria-label="Match case"
            aria-pressed={options.caseSensitive}
            className={
              options.caseSensitive
                ? "text-search-toggle active"
                : "text-search-toggle"
            }
            onClick={() => toggleOption("caseSensitive")}
            title="Match case"
            type="button"
          >
            <CaseSensitive aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Match whole word"
            aria-pressed={options.wholeWord}
            className={
              options.wholeWord
                ? "text-search-toggle active"
                : "text-search-toggle"
            }
            onClick={() => toggleOption("wholeWord")}
            title="Match whole word"
            type="button"
          >
            <WholeWord aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Use regular expression"
            aria-pressed={options.isRegex}
            className={
              options.isRegex
                ? "text-search-toggle active"
                : "text-search-toggle"
            }
            onClick={() => toggleOption("isRegex")}
            title="Use regular expression"
            type="button"
          >
            <Regex aria-hidden="true" size={16} />
          </button>
          <label className="text-search-mask">
            <Asterisk aria-hidden="true" size={15} />
            <input
              aria-label="File mask"
              onChange={(event) =>
                onChangeOptions({
                  ...options,
                  fileMask: event.currentTarget.value,
                })
              }
              placeholder="File mask, e.g. *.php, !vendor"
              value={options.fileMask}
            />
          </label>
        </div>

        <div className="text-search-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {!isLoading && query.trim() && results.length === 0 ? (
            <div className="quick-open-state">No matches found</div>
          ) : null}
          {!isLoading && !query.trim() ? (
            <div className="quick-open-state">Enter a search term</div>
          ) : null}
          {results.map((result, index) => {
            const { before, match, after } = splitMatchHighlight(result);

            return (
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
                  <small className="text-search-preview">
                    {before}
                    {match ? (
                      <mark className="text-search-match">{match}</mark>
                    ) : null}
                    {after}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
