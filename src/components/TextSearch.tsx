import {
  Asterisk,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReplacePreview } from "../domain/replacePreview";
import { searchQueryHistorySession } from "../domain/searchQueryHistory";
import {
  groupTextSearchResults,
  type TextSearchResultGroup,
} from "../domain/textSearchResultGroups";
import { splitMatchHighlight } from "../domain/textSearchHighlight";
import type { TextSearchOptions, TextSearchResult } from "../domain/workspace";
import { useWindowedRows } from "./useWindowedRows";

interface TextSearchProps {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  options: TextSearchOptions;
  results: TextSearchResult[];
  dismissedPaths: ReadonlySet<string>;
  replacement: string;
  replaceBusy: boolean;
  hasMoreResults?: boolean;
  resultsTruncated?: boolean;
  resultCountLowerBound?: number;
  onChangeQuery(query: string): void;
  onChangeReplacement(replacement: string): void;
  onChangeOptions(options: TextSearchOptions): void;
  onClose(): void;
  onDismissFile(path: string): void;
  onLoadMore?(): void;
  onOpen(result: TextSearchResult): void;
  onReturnFocus?(): void;
  onReplaceAll(): void;
  onReplaceInFile(path: string): void;
  onRestoreDismissedFiles(): void;
}

interface GroupRow {
  readonly group: TextSearchResultGroup;
  readonly kind: "group";
}

interface MatchRow {
  readonly group: TextSearchResultGroup;
  readonly kind: "match";
  readonly result: TextSearchResult;
}

type SearchRow = GroupRow | MatchRow;

export function TextSearch({
  dismissedPaths,
  hasMoreResults = false,
  isLoading,
  isOpen,
  onChangeOptions,
  onChangeQuery,
  onChangeReplacement,
  onClose,
  onDismissFile,
  onLoadMore = () => undefined,
  onOpen,
  onReturnFocus,
  onReplaceAll,
  onReplaceInFile,
  onRestoreDismissedFiles,
  options,
  query,
  replacement,
  replaceBusy,
  resultCountLowerBound,
  resultsTruncated,
  results,
}: TextSearchProps) {
  const [activeRowIndex, setActiveRowIndex] = useState(1);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set());
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState("");
  const activeHistoryRoot = searchQueryHistorySession.root();
  const visibleResults = useMemo(
    () =>
      Array.isArray(results) ? results.filter((result) => !dismissedPaths.has(result.path)) : [],
    [dismissedPaths, results],
  );
  const groups = useMemo(() => groupTextSearchResults(visibleResults), [visibleResults]);
  const rows = useMemo<SearchRow[]>(() => {
    const nextRows: SearchRow[] = [];

    for (const group of groups) {
      nextRows.push({ group, kind: "group" });

      for (const result of group.results) {
        if (!collapsedPaths.has(group.path)) {
          nextRows.push({ group, kind: "match", result });
        }
      }
    }

    return nextRows;
  }, [collapsedPaths, groups]);
  const activeRow = rows[activeRowIndex];
  const activeResult = activeRow?.kind === "match" ? activeRow.result : undefined;
  const focusActiveRowRef = useRef(false);
  const keyForIndex = useCallback((index: number) => searchRowKey(rows[index], index), [rows]);
  const estimateHeight = useCallback(
    (index: number) => (rows[index]?.kind === "group" ? 34 : 48),
    [rows],
  );
  const windowed = useWindowedRows({
    enabled: isOpen,
    estimateHeight,
    fallbackViewportHeight: 360,
    itemCount: rows.length,
    keyForIndex,
    overscan: 6,
    pinnedIndices: activeRowIndex >= 0 ? [activeRowIndex] : [],
    preserveScrollAnchor: true,
  });
  const scrollToIndex = windowed.scrollToIndex;
  const previewPattern = typeof query === "string" ? query : "";
  const computeReplacePreview = useMemo(
    () =>
      createReplacePreview({
        pattern: previewPattern,
        isRegex: options.isRegex,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        preserveCase: options.preserveCase,
      }),
    [
      options.caseSensitive,
      options.isRegex,
      options.preserveCase,
      options.wholeWord,
      previewPattern,
    ],
  );

  useEffect(() => {
    setActiveRowIndex(1);
    setCollapsedPaths(new Set());
  }, [query, options]);

  useEffect(() => {
    setHistoryIndex(null);
    setHistoryDraft("");
  }, [activeHistoryRoot]);

  useEffect(() => {
    setActiveRowIndex((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    if (activeRowIndex < 0) {
      return;
    }

    scrollToIndex(activeRowIndex, "nearest");
    if (focusActiveRowRef.current) {
      focusActiveRowRef.current = false;
      document.getElementById(textSearchRowId(activeRowIndex))?.focus();
    }
  }, [activeRowIndex, scrollToIndex]);

  if (!isOpen) {
    return null;
  }

  const truncated = resultsTruncated ?? hasMoreResults;
  const lowerBound = resultCountLowerBound ?? (truncated ? results.length : visibleResults.length);
  const canReplace =
    !isLoading && !replaceBusy && Boolean(query.trim()) && visibleResults.length > 0;
  const returnFocus = onReturnFocus ?? onClose;

  const toggleOption = (key: "caseSensitive" | "wholeWord" | "isRegex" | "preserveCase") => {
    onChangeOptions({ ...options, [key]: !options[key] });
  };

  const recallQuery = (direction: "older" | "newer") => {
    const history = searchQueryHistorySession.active();

    if (history.length === 0) {
      return;
    }

    if (direction === "older") {
      const nextIndex = Math.min((historyIndex ?? -1) + 1, history.length - 1);

      if (historyIndex === null) {
        setHistoryDraft(query);
      }

      setHistoryIndex(nextIndex);
      onChangeQuery(history[nextIndex]);
      return;
    }

    if (historyIndex === null) {
      return;
    }

    if (historyIndex === 0) {
      setHistoryIndex(null);
      onChangeQuery(historyDraft);
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    onChangeQuery(history[nextIndex]);
  };

  const handleResultKeyDown = (event: React.KeyboardEvent) => {
    const fromSearchInput =
      event.currentTarget instanceof HTMLInputElement || event.target instanceof HTMLInputElement;
    if (event.key === "Escape") {
      event.preventDefault();
      returnFocus();
      return;
    }

    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      recallQuery("newer");
      return;
    }

    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      recallQuery("older");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (fromSearchInput) {
        const matchRows = rows.flatMap((row, index) => (row.kind === "match" ? [index] : []));
        const currentMatch = matchRows.indexOf(activeRowIndex);
        setActiveRowIndex(matchRows[Math.min(currentMatch + 1, matchRows.length - 1)] ?? 0);
      } else {
        focusActiveRowRef.current = true;
        setActiveRowIndex((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (fromSearchInput) {
        const matchRows = rows.flatMap((row, index) => (row.kind === "match" ? [index] : []));
        const currentMatch = matchRows.indexOf(activeRowIndex);
        setActiveRowIndex(matchRows[Math.max(currentMatch - 1, 0)] ?? 0);
      } else {
        focusActiveRowRef.current = true;
        setActiveRowIndex((current) => Math.max(current - 1, 0));
      }
      return;
    }

    if (event.key === "ArrowRight" && activeRow?.kind === "group") {
      event.preventDefault();
      if (collapsedPaths.has(activeRow.group.path)) {
        setCollapsedPaths((current) => toggledPathSet(current, activeRow.group.path));
      } else if (rows[activeRowIndex + 1]?.kind === "match") {
        focusActiveRowRef.current = true;
        setActiveRowIndex(activeRowIndex + 1);
      }
      return;
    }

    if (event.key === "ArrowLeft" && activeRow) {
      event.preventDefault();
      if (activeRow.kind === "group") {
        if (!collapsedPaths.has(activeRow.group.path)) {
          setCollapsedPaths((current) => toggledPathSet(current, activeRow.group.path));
        }
      } else {
        const groupIndex = rows.findIndex(
          (row) => row.kind === "group" && row.group.path === activeRow.group.path,
        );
        if (groupIndex >= 0) {
          focusActiveRowRef.current = true;
          setActiveRowIndex(groupIndex);
        }
      }
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (activeRow?.kind === "group") {
      setCollapsedPaths((current) => toggledPathSet(current, activeRow.group.path));
    } else if (activeResult) {
      onOpen(activeResult);
    }
  };

  return (
    <section
      aria-label="Find in path"
      className="text-search"
      role="tabpanel"
      style={{
        border: 0,
        borderRadius: 0,
        boxShadow: "none",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "none",
        width: "100%",
      }}
    >
      <div className="palette-search">
        <Search aria-hidden="true" size={17} />
        <input
          aria-label="Search text"
          autoFocus
          onChange={(event) => {
            setHistoryIndex(null);
            setHistoryDraft("");
            onChangeQuery(event.currentTarget.value);
          }}
          onKeyDown={handleResultKeyDown}
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
              returnFocus();
              return;
            }

            if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) || !canReplace) {
              return;
            }

            event.preventDefault();
            onReplaceAll();
          }}
          placeholder={
            options.isRegex ? "Replace with (use $1, ${name} for capture groups)" : "Replace with"
          }
          value={replacement}
        />
        <button
          aria-label="Preserve case"
          aria-pressed={options.preserveCase}
          className={options.preserveCase ? "text-search-toggle active" : "text-search-toggle"}
          onClick={() => toggleOption("preserveCase")}
          title="Preserve case"
          type="button"
        >
          <span aria-hidden="true">AB</span>
        </button>
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
          className={options.caseSensitive ? "text-search-toggle active" : "text-search-toggle"}
          onClick={() => toggleOption("caseSensitive")}
          title="Match case"
          type="button"
        >
          <CaseSensitive aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Match whole word"
          aria-pressed={options.wholeWord}
          className={options.wholeWord ? "text-search-toggle active" : "text-search-toggle"}
          onClick={() => toggleOption("wholeWord")}
          title="Match whole word"
          type="button"
        >
          <WholeWord aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Use regular expression"
          aria-pressed={options.isRegex}
          className={options.isRegex ? "text-search-toggle active" : "text-search-toggle"}
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

      {isLoading ? <div className="quick-open-state">Searching...</div> : null}
      {!isLoading && query.trim() && visibleResults.length === 0 ? (
        <div className="quick-open-state">No matches found</div>
      ) : null}
      {!isLoading && !query.trim() ? (
        <div className="quick-open-state">Enter a search term</div>
      ) : null}
      {!isLoading && query.trim() && (visibleResults.length > 0 || dismissedPaths.size > 0) ? (
        <div className="text-search-summary-row" aria-live="polite">
          {visibleResults.length > 0 ? (
            <div className="text-search-summary">
              {resultCountLowerBound !== undefined ? (
                <>
                  Showing {visibleResults.length} of {truncated ? "at least " : ""}
                  {lowerBound} matches in {groups.length} file
                  {groups.length === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  {truncated ? "at least " : ""}
                  {visibleResults.length} occurrence
                  {visibleResults.length === 1 ? "" : "s"} in {truncated ? "at least " : ""}
                  {groups.length} file
                  {groups.length === 1 ? "" : "s"}
                </>
              )}
            </div>
          ) : null}
          {dismissedPaths.size > 0 ? (
            <button
              aria-label="Restore dismissed search files"
              className="text-search-restore-dismissed"
              onClick={onRestoreDismissedFiles}
              type="button"
            >
              {dismissedPaths.size} dismissed - Restore
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        aria-label="Search results"
        className="text-search-results"
        onKeyDown={handleResultKeyDown}
        onScroll={windowed.onScroll}
        ref={windowed.containerRef}
        role="tree"
        aria-activedescendant={rows[activeRowIndex] ? textSearchRowId(activeRowIndex) : undefined}
        style={{ flex: "1 1 auto", minHeight: 0 }}
      >
        <div
          className="text-search-window"
          style={{ height: windowed.totalHeight, position: "relative" }}
        >
          {windowed.rows.map((windowRow) => {
            const row = rows[windowRow.index];

            if (!row) {
              return null;
            }

            const key = searchRowKey(row, windowRow.index);

            return (
              <div
                key={key}
                ref={(element) => windowed.measureRow(key, element)}
                style={{
                  left: 0,
                  position: "absolute",
                  right: 0,
                  top: windowRow.offsetTop,
                }}
              >
                {row.kind === "group" ? (
                  <FileGroupRow
                    active={windowRow.index === activeRowIndex}
                    collapsed={collapsedPaths.has(row.group.path)}
                    group={row.group}
                    id={textSearchRowId(windowRow.index)}
                    onDismissFile={onDismissFile}
                    onActivate={() => setActiveRowIndex(windowRow.index)}
                    onReplaceInFile={onReplaceInFile}
                    onToggle={() =>
                      setCollapsedPaths((current) => toggledPathSet(current, row.group.path))
                    }
                    query={query}
                    replaceBusy={replaceBusy || isLoading}
                  />
                ) : (
                  <MatchResultRow
                    active={windowRow.index === activeRowIndex}
                    computeReplacePreview={computeReplacePreview}
                    id={textSearchRowId(windowRow.index)}
                    onActivate={() => setActiveRowIndex(windowRow.index)}
                    onOpen={() => onOpen(row.result)}
                    replacement={replacement}
                    result={row.result}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {hasMoreResults ? (
        <button
          aria-label="Load more search results"
          className="text-search-restore-dismissed"
          disabled={isLoading}
          onClick={onLoadMore}
          type="button"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}

function FileGroupRow({
  active,
  collapsed,
  group,
  id,
  onActivate,
  onDismissFile,
  onReplaceInFile,
  onToggle,
  query,
  replaceBusy,
}: {
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly group: TextSearchResultGroup;
  readonly id: string;
  readonly onActivate: () => void;
  readonly onDismissFile: (path: string) => void;
  readonly onReplaceInFile: (path: string) => void;
  readonly onToggle: () => void;
  readonly query: string;
  readonly replaceBusy: boolean;
}) {
  const count = group.results.length;
  const action = collapsed ? "Expand" : "Collapse";

  return (
    <div className="text-search-result-row">
      <button
        aria-expanded={!collapsed}
        aria-label={`${action} ${group.relativePath}, ${count} match${count === 1 ? "" : "es"}`}
        aria-selected={active}
        className={
          active
            ? "quick-open-result text-search-group active"
            : "quick-open-result text-search-group"
        }
        id={id}
        onClick={onToggle}
        onFocus={onActivate}
        onMouseEnter={onActivate}
        role="treeitem"
        tabIndex={active ? 0 : -1}
        type="button"
      >
        {collapsed ? (
          <ChevronRight aria-hidden="true" size={16} />
        ) : (
          <ChevronDown aria-hidden="true" size={16} />
        )}
        <span>
          <strong>{group.relativePath}</strong>
          <small>
            {count} match{count === 1 ? "" : "es"}
          </small>
        </span>
      </button>
      <div className="text-search-file-actions">
        <button
          aria-label={`Replace ${count} occurrence${count === 1 ? "" : "s"} in ${group.relativePath}`}
          className="text-search-replace-file"
          disabled={replaceBusy || !query.trim()}
          onClick={() => onReplaceInFile(group.path)}
          title={`Replace in ${group.relativePath}`}
          type="button"
        >
          <Replace aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={`Dismiss ${group.relativePath} from Replace All`}
          className="text-search-dismiss-file"
          disabled={replaceBusy}
          onClick={() => onDismissFile(group.path)}
          title={`Dismiss ${group.relativePath}`}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
    </div>
  );
}

function MatchResultRow({
  active,
  computeReplacePreview,
  id,
  onActivate,
  onOpen,
  replacement,
  result,
}: {
  readonly active: boolean;
  readonly computeReplacePreview: (
    match: string,
    lineText: string,
    replacement: string,
    matchStart: number,
  ) => string | null;
  readonly id: string;
  readonly onActivate: () => void;
  readonly onOpen: () => void;
  readonly replacement: string;
  readonly result: TextSearchResult;
}) {
  const { before, match, after } = splitMatchHighlight(result);
  const replacementPreview =
    replacement && match
      ? computeReplacePreview(match, result.lineText, replacement, result.matchStart ?? 0)
      : null;
  const truncationLabel =
    result.matchTruncated && result.previewTruncated
      ? "Match and preview clipped"
      : result.matchTruncated
        ? "Match clipped"
        : result.previewTruncated
          ? "Preview clipped"
          : null;
  const resultLabel = `${result.relativePath}, line ${result.lineNumber}, column ${result.column}${
    truncationLabel ? `, ${truncationLabel.toLowerCase()}` : ""
  }`;

  return (
    <div className="text-search-result-row">
      <button
        aria-label={resultLabel}
        aria-selected={active}
        className={active ? "text-search-result active" : "text-search-result"}
        id={id}
        onClick={onOpen}
        onFocus={onActivate}
        onMouseEnter={onActivate}
        role="treeitem"
        tabIndex={active ? 0 : -1}
        title={truncationLabel ? `${result.path} — ${truncationLabel}` : result.path}
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
                <del className="text-search-replaced-match">{match}</del>
                <ins className="text-search-replacement">{replacementPreview}</ins>
              </>
            ) : match ? (
              <mark className="text-search-match">{match}</mark>
            ) : null}
            {after}
            {truncationLabel ? (
              <span className="text-search-preview-truncation"> … ({truncationLabel})</span>
            ) : null}
          </small>
        </span>
      </button>
    </div>
  );
}

function toggledPathSet(current: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(current);

  if (next.has(path)) {
    next.delete(path);
    return next;
  }

  next.add(path);
  return next;
}

function searchRowKey(row: SearchRow | undefined, index: number): string {
  if (!row) {
    return `missing:${index}`;
  }

  if (row.kind === "group") {
    return `group:${row.group.path}`;
  }

  return `match:${row.result.path}:${row.result.lineNumber}:${row.result.column}:${index}`;
}

function textSearchRowId(index: number): string {
  return `text-search-row-${index}`;
}
