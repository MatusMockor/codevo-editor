import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
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

interface AgentFindCount {
  readonly head: string;
  readonly tail: string;
  readonly spoken: string;
  readonly capped: boolean;
  readonly empty: boolean;
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
  const count = countLabel(pending, hitCount, currentIndex, truncated);

  return (
    <div className="agent-find" role="search">
      <Search aria-hidden="true" className="agent-find__glyph" size={14} />

      <input
        aria-label="Find in thread"
        autoComplete="off"
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
        spellCheck={false}
        value={query}
      />

      <span className="agent-find__meta">
        <span
          aria-hidden="true"
          className={
            count.empty ? "agent-find__count agent-find__count--empty" : "agent-find__count"
          }
        >
          {count.head}
          {count.capped && <span className="agent-find__plus">+</span>}
          {count.tail}
        </span>
        <span aria-live="polite" className="agent-visually-hidden" role="status">
          {count.spoken}
        </span>
        {truncated && <span className="agent-find__note">capped at {hitCount}</span>}
      </span>

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

function countLabel(
  pending: boolean,
  hitCount: number,
  currentIndex: number,
  truncated: boolean,
): AgentFindCount {
  if (pending) {
    return { head: "Searching…", tail: "", spoken: "Searching…", capped: false, empty: false };
  }

  if (hitCount === 0) {
    return { head: "No matches", tail: "", spoken: "No matches", capped: false, empty: true };
  }

  const more = truncated ? " or more" : "";

  if (currentIndex < 0) {
    return {
      head: `${hitCount}`,
      tail: " matches",
      spoken: `${hitCount}${more} matches`,
      capped: truncated,
      empty: false,
    };
  }

  return {
    head: `${currentIndex + 1} of ${hitCount}`,
    tail: "",
    spoken: `${currentIndex + 1} of ${hitCount}${more}`,
    capped: truncated,
    empty: false,
  };
}
