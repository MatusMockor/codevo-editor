import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { CHECKOUT_REPOSITORY_PAGE_SIZE, CHECKOUT_SEARCH_QUERY_LIMIT } from "./agentCheckoutSearch";
import "./agentCheckoutSearch.css";

interface SearchInputProps {
  readonly subject?: "repositories" | "branches";
  readonly query: string;
  readonly listId: string;
  onQuery(query: string): void;
  onClose(): void;
  onFocusList(): void;
}

export function AgentCheckoutSearchInput({
  subject = "repositories",
  query,
  listId,
  onQuery,
  onClose,
  onFocusList,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => inputRef.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") event.preventDefault();
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    onFocusList();
  };
  return (
    <div className="agent-checkout-search">
      <Search size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        aria-label={`Search ${subject}`}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
        maxLength={CHECKOUT_SEARCH_QUERY_LIMIT}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${subject}…`}
        type="search"
        value={query}
      />
    </div>
  );
}

interface SearchPagesProps {
  readonly subject?: "repositories" | "branches";
  readonly page: number;
  readonly total: number | null;
  readonly excluded: number;
  onPage(page: number): void;
  onClose(): void;
}

export function AgentCheckoutSearchPages({
  subject = "repositories",
  page,
  total,
  excluded,
  onPage,
  onClose,
}: SearchPagesProps) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / CHECKOUT_REPOSITORY_PAGE_SIZE));
  const summary =
    total === null
      ? `Searching ${subject}…`
      : total === 0
        ? `No matching ${subject}`
        : `${page * CHECKOUT_REPOSITORY_PAGE_SIZE + 1}–${Math.min((page + 1) * CHECKOUT_REPOSITORY_PAGE_SIZE, total)} of ${total} ${subject}`;
  return (
    <div
      className="agent-checkout-pages"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <span role="status" aria-live="polite">
        {summary}
        {excluded > 0 &&
          ` · ${excluded} ${subject} exceed the search limit. Clear search to browse them.`}
      </span>
      <button
        type="button"
        aria-label={`Previous ${subject === "branches" ? "branch" : "repository"} page`}
        disabled={total === null || page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Next ${subject === "branches" ? "branch" : "repository"} page`}
        disabled={total === null || page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
