import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { AgentFilesSearch } from "../../../../application/rightPanel/useAgentFilesSearch";
import { MAX_FILES_SEARCH_RESULTS } from "../../../../application/rightPanel/useAgentFilesSearch";
import type { FileSearchResult } from "../../../../domain/workspace";

export interface AgentFilesSearchResultsProps {
  readonly search: AgentFilesSearch;
  readonly listRef: RefObject<HTMLUListElement | null>;
  onPreview(result: FileSearchResult): void;
  onOpen(result: FileSearchResult): void;
}

export function AgentFilesSearchResults({
  listRef,
  onOpen,
  onPreview,
  search,
}: AgentFilesSearchResultsProps) {
  const [selected, setSelected] = useState(0);
  const note = resultsNote(search);
  const lastIndex = search.results.length - 1;
  const current = Math.min(selected, Math.max(lastIndex, 0));
  const itemsRef = useRef<Array<HTMLLIElement | null>>([]);
  const stale = search.status === "searching";

  const focusIndex = (index: number) => {
    if (index < 0 || index > lastIndex) return;
    setSelected(index);
    itemsRef.current[index]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    index: number,
    result: FileSearchResult,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusIndex(index + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex(index - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (stale) return;
      onOpen(result);
    }
  };

  return (
    <div className="cv-files__results">
      {search.results.length > 0 && (
        <ul
          aria-busy={stale || undefined}
          aria-label="Matching files"
          className={stale ? "cv-files__list cv-files__list--stale" : "cv-files__list"}
          ref={listRef}
          role="listbox"
        >
          {search.results.map((result, index) => (
            <li
              aria-disabled={stale || undefined}
              aria-selected={index === current}
              className="cv-files__result"
              key={result.path}
              onClick={() => {
                if (stale) return;
                setSelected(index);
                onPreview(result);
              }}
              onDoubleClick={() => {
                if (stale) return;
                onOpen(result);
              }}
              onFocus={() => setSelected(index)}
              onKeyDown={(event) => onKeyDown(event, index, result)}
              ref={(element) => {
                itemsRef.current[index] = element;
              }}
              role="option"
              tabIndex={!stale && index === current ? 0 : -1}
              title={result.relativePath}
            >
              <span className="cv-files__result-name">{result.name}</span>
              <span className="cv-files__result-dir">{directoryOf(result.relativePath)}</span>
            </li>
          ))}
        </ul>
      )}
      {note !== null && (
        <p aria-live="polite" className="cv-files__results-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

function resultsNote(search: AgentFilesSearch): string | null {
  switch (search.status) {
    case "idle":
      return null;
    case "searching":
      return search.results.length === 0 ? "Searching…" : null;
    case "failed":
      return search.message;
    case "ready":
      if (search.results.length === 0) return "No matching files.";
      if (!search.truncated) return null;
      return `Showing the first ${MAX_FILES_SEARCH_RESULTS} matches. Refine the search to narrow them.`;
    default: {
      const exhaustive: never = search.status;
      return exhaustive;
    }
  }
}

function directoryOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash < 0 ? "" : relativePath.slice(0, slash);
}
