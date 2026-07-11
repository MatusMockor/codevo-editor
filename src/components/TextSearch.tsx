import {
  Asterisk,
  CaseSensitive,
  FileSearch,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createReplacePreview } from "../domain/replacePreview";
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
  replacement: string;
  replaceBusy: boolean;
  onChangeQuery(query: string): void;
  onChangeReplacement(replacement: string): void;
  onChangeOptions(options: TextSearchOptions): void;
  onClose(): void;
  onOpen(result: TextSearchResult): void;
  onReplaceAll(): void;
  onReplaceInFile(path: string): void;
}

/**
 * Distinct file paths in `results`, preserving first-seen order, with their
 * match count. Drives the "Replace in file" affordance and the per-file count
 * shown in the confirmation/preview.
 */
function distinctMatchedFiles(
  results: TextSearchResult[],
): Array<{ path: string; relativePath: string; matchCount: number }> {
  const order: string[] = [];
  const byPath = new Map<
    string,
    { path: string; relativePath: string; matchCount: number }
  >();

  for (const result of results) {
    const existing = byPath.get(result.path);

    if (!existing) {
      order.push(result.path);
      byPath.set(result.path, {
        path: result.path,
        relativePath: result.relativePath,
        matchCount: 1,
      });
      continue;
    }

    existing.matchCount += 1;
  }

  return order.map((path) => byPath.get(path)!);
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
  onChangeReplacement,
  onClose,
  onOpen,
  onReplaceAll,
  onReplaceInFile,
  options,
  query,
  replacement,
  replaceBusy,
  results,
}: TextSearchProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const previewPattern = typeof query === "string" ? query : "";
  const computeReplacePreview = useMemo(
    () =>
      createReplacePreview({
        pattern: previewPattern,
        isRegex: options.isRegex,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
      }),
    [
      options.caseSensitive,
      options.isRegex,
      options.wholeWord,
      previewPattern,
    ],
  );

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      onChangeQuery("");
      onChangeReplacement("");
    }
  }, [isOpen, onChangeQuery, onChangeReplacement]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, options]);

  if (!isOpen) {
    return null;
  }

  const activeResult = results[activeIndex];
  const matchedFiles = distinctMatchedFiles(results);
  const canReplace =
    !replaceBusy && Boolean(query.trim()) && results.length > 0;

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

        <div className="palette-search text-search-replace">
          <Replace aria-hidden="true" size={17} />
          <input
            aria-label="Replace with"
            onChange={(event) => onChangeReplacement(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }

              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                canReplace
              ) {
                event.preventDefault();
                onReplaceAll();
              }
            }}
            placeholder={
              options.isRegex
                ? "Replace with (use $1, ${name} for capture groups)"
                : "Replace with"
            }
            value={replacement}
          />
          <button
            aria-label="Replace all"
            className="text-search-replace-all"
            disabled={!canReplace}
            onClick={onReplaceAll}
            title="Replace all matches in all files"
            type="button"
          >
            <ReplaceAll aria-hidden="true" size={16} />
            <span>Replace All</span>
          </button>
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
            const replacementPreview =
              replacement && match
                ? computeReplacePreview(
                    match,
                    result.lineText,
                    replacement,
                    result.matchStart ?? 0,
                  )
                : null;
            const isFirstOfFile =
              results.findIndex((other) => other.path === result.path) === index;
            const fileMatchCount =
              matchedFiles.find((file) => file.path === result.path)
                ?.matchCount ?? 1;

            return (
              <div
                className="text-search-result-row"
                key={`${result.path}:${result.lineNumber}:${result.column}`}
              >
                <button
                  className={
                    index === activeIndex
                      ? "text-search-result active"
                      : "text-search-result"
                  }
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
                      {match && replacementPreview !== null ? (
                        <>
                          <del className="text-search-replaced-match">
                            {match}
                          </del>
                          <ins className="text-search-replacement">
                            {replacementPreview}
                          </ins>
                        </>
                      ) : match ? (
                        <mark className="text-search-match">{match}</mark>
                      ) : null}
                      {after}
                    </small>
                  </span>
                </button>
                {isFirstOfFile ? (
                  <button
                    aria-label={`Replace ${fileMatchCount} occurrence${fileMatchCount === 1 ? "" : "s"} in ${result.relativePath}`}
                    className="text-search-replace-file"
                    disabled={replaceBusy || !query.trim()}
                    onClick={() => onReplaceInFile(result.path)}
                    title={`Replace in ${result.relativePath}`}
                    type="button"
                  >
                    <Replace aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
