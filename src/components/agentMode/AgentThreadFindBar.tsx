import { ChevronDown, ChevronUp, X } from "lucide-react";
import { MAX_THREAD_SEARCH_QUERY_CHARS } from "../../domain/agentThreadSearch";

export interface AgentThreadFindBarProps {
  readonly query: string;
  readonly hitCount: number;
  readonly currentIndex: number;
  readonly pending?: boolean;
  readonly truncated?: boolean;
  onChangeQuery(query: string): void;
  onNavigate(index: number): void;
  onClose(): void;
}

export function AgentThreadFindBar({
  currentIndex,
  hitCount,
  onChangeQuery,
  onClose,
  onNavigate,
  pending = false,
  query,
  truncated = false,
}: AgentThreadFindBarProps) {
  const step = (delta: number): void => {
    if (hitCount === 0) return;
    onNavigate(wrapIndex(currentIndex, delta, hitCount));
  };

  return (
    <div className="agent-find" role="search">
      <input
        aria-label="Find in thread"
        autoFocus
        className="agent-find__input"
        maxLength={MAX_THREAD_SEARCH_QUERY_CHARS}
        onChange={(event) => onChangeQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          step(event.shiftKey ? -1 : 1);
        }}
        placeholder="Find in thread"
        value={query}
      />

      <span aria-live="polite" className="agent-find__count" role="status">
        {countLabel(pending, hitCount, currentIndex)}
      </span>

      {truncated && <span className="agent-find__note">first {hitCount}</span>}

      <button
        aria-label="Previous match"
        className="agent-find__step"
        disabled={hitCount === 0}
        onClick={() => step(-1)}
        type="button"
      >
        <ChevronUp aria-hidden="true" size={14} />
      </button>

      <button
        aria-label="Next match"
        className="agent-find__step"
        disabled={hitCount === 0}
        onClick={() => step(1)}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={14} />
      </button>

      <button
        aria-label="Close find bar"
        className="agent-find__close"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function wrapIndex(currentIndex: number, delta: number, count: number): number {
  const base = currentIndex < 0 ? -1 : currentIndex;
  return (((base + delta) % count) + count) % count;
}

function countLabel(pending: boolean, hitCount: number, currentIndex: number): string {
  if (pending) return "Searching…";
  if (hitCount === 0) return "No results";
  if (currentIndex < 0) return `${hitCount} results`;
  return `${currentIndex + 1} of ${hitCount}`;
}
