import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MAX_THREAD_SEARCH_QUERY_CHARS,
  type AgentThreadSearchMatch,
  type AgentThreadSearchResult,
} from "../../domain/agentThreadSearch";
import { PaletteFooter } from "../PaletteFooter";
import {
  agentThreadRevealForMatch,
  type AgentThreadRevealRequest,
} from "./agentSidebarPresentation";
import { AgentThreadSearchResults } from "./AgentThreadSearchResults";

const PALETTE_LISTBOX_ID = "agent-thread-palette-listbox";
const PALETTE_OPTION_PREFIX = "agent-thread-palette-option-";

export interface AgentThreadSearchPaletteProps {
  readonly isOpen: boolean;
  readonly query: string;
  readonly result: AgentThreadSearchResult | null;
  readonly pending: boolean;
  readonly titles: ReadonlyMap<string, string>;
  readonly archivedThreadIds: ReadonlySet<string>;
  onChangeQuery(query: string): void;
  onClose(): void;
  onActivate(threadId: string, reveal: AgentThreadRevealRequest | null): void;
}

export function AgentThreadSearchPalette({
  archivedThreadIds,
  isOpen,
  onActivate,
  onChangeQuery,
  onClose,
  pending,
  query,
  result,
  titles,
}: AgentThreadSearchPaletteProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(
    () => selectableMatches(result, titles, archivedThreadIds),
    [archivedThreadIds, result, titles],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [isOpen, query, matches]);

  if (!isOpen) return null;

  const boundedIndex = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);

  const activate = (index: number): void => {
    const match = matches[index];
    if (match === undefined) return;
    onActivate(match.threadId, agentThreadRevealForMatch(result?.query ?? query, match));
  };

  const handleKeyDown = (key: string): boolean => {
    if (key === "Escape") {
      onClose();
      return true;
    }
    if (matches.length === 0) return false;
    if (key === "ArrowDown") {
      setActiveIndex((current) => (current + 1) % matches.length);
      return true;
    }
    if (key === "ArrowUp") {
      setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
      return true;
    }
    if (key === "Home") {
      setActiveIndex(0);
      return true;
    }
    if (key === "End") {
      setActiveIndex(matches.length - 1);
      return true;
    }
    if (key === "Enter") {
      activate(boundedIndex);
      return true;
    }
    return false;
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Search threads"
        className="quick-open agent-thread-palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={
              boundedIndex >= 0 ? `${PALETTE_OPTION_PREFIX}${boundedIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={PALETTE_LISTBOX_ID}
            aria-label="Search threads"
            autoFocus
            maxLength={MAX_THREAD_SEARCH_QUERY_CHARS}
            onChange={(event) => onChangeQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (!handleKeyDown(event.key)) return;
              event.preventDefault();
            }}
            placeholder="Search threads and messages"
            role="combobox"
            aria-expanded={matches.length > 0}
            value={query}
          />
        </div>

        <div className="quick-open-results agent-thread-palette__results">
          <div className="search-everywhere-section-label">Threads</div>
          <AgentThreadSearchResults
            activeIndex={boundedIndex}
            documentsTruncated={result?.documentsTruncated ?? false}
            label="Thread search results"
            listboxId={PALETTE_LISTBOX_ID}
            matches={matches}
            onHighlight={setActiveIndex}
            onSelect={onActivate}
            optionPrefix={PALETTE_OPTION_PREFIX}
            pending={pending}
            query={result?.query ?? query}
            titles={titles}
            truncated={result?.truncated ?? false}
          />
        </div>

        <PaletteFooter />
      </section>
    </div>
  );
}

function selectableMatches(
  result: AgentThreadSearchResult | null,
  titles: ReadonlyMap<string, string>,
  archivedThreadIds: ReadonlySet<string>,
): ReadonlyArray<AgentThreadSearchMatch> {
  if (result === null) return [];
  return result.matches.filter(
    (match) => titles.has(match.threadId) && !archivedThreadIds.has(match.threadId),
  );
}
