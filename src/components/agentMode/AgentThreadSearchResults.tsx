import type { ReactNode } from "react";
import {
  MAX_THREAD_SEARCH_RESULTS,
  type AgentThreadSearchMatch,
  type AgentThreadSearchRange,
} from "../../domain/agentThreadSearch";
import {
  agentThreadRevealForMatch,
  type AgentThreadRevealRequest,
} from "./agentSidebarPresentation";

export const AGENT_THREAD_SEARCH_LISTBOX_ID = "agent-thread-search-listbox";
export const AGENT_THREAD_SEARCH_OPTION_PREFIX = "agent-thread-search-option-";

export interface AgentThreadSearchResultsProps {
  readonly matches: ReadonlyArray<AgentThreadSearchMatch>;
  readonly titles: ReadonlyMap<string, string>;
  readonly query: string;
  readonly pending: boolean;
  readonly truncated: boolean;
  readonly documentsTruncated?: boolean;
  readonly activeIndex: number;
  readonly listboxId?: string;
  readonly optionPrefix?: string;
  readonly label?: string;
  onHighlight(index: number): void;
  onSelect(threadId: string, reveal: AgentThreadRevealRequest | null): void;
}

export function AgentThreadSearchResults({
  activeIndex,
  documentsTruncated = false,
  label = "Thread search results",
  listboxId = AGENT_THREAD_SEARCH_LISTBOX_ID,
  matches,
  onHighlight,
  onSelect,
  optionPrefix = AGENT_THREAD_SEARCH_OPTION_PREFIX,
  pending,
  query,
  titles,
  truncated,
}: AgentThreadSearchResultsProps) {
  const empty = !pending && matches.length === 0;

  return (
    <div className="agent-search-results">
      <p aria-live="polite" className="agent-search-results__status" role="status">
        {statusLabel(pending, matches.length)}
      </p>

      <ul aria-label={label} className="agent-search-results__list" id={listboxId} role="listbox">
        {matches.map((match, index) => (
          <li
            aria-selected={index === activeIndex}
            className={rowClassName(index === activeIndex)}
            id={`${optionPrefix}${index}`}
            key={matchKey(match)}
            onClick={() => onSelect(match.threadId, agentThreadRevealForMatch(query, match))}
            onMouseMove={() => onHighlight(index)}
            role="option"
          >
            <span className="agent-search-row__title">
              {titles.get(match.threadId) ?? match.threadId}
            </span>
            {match.source !== "title" && (
              <span className="agent-search-row__snippet">
                <span className={whoClassName(match.source)}>{whoLabel(match.source)}</span>{" "}
                {marked(match.snippet, match.ranges)}
              </span>
            )}
          </li>
        ))}
      </ul>

      {empty && <p className="agent-search-results__empty">No threads found</p>}

      {truncated && (
        <p className="agent-search-results__note">Showing first {MAX_THREAD_SEARCH_RESULTS}</p>
      )}

      {documentsTruncated && (
        <p className="agent-search-results__note">Older messages not searched</p>
      )}
    </div>
  );
}

function statusLabel(pending: boolean, count: number): string {
  if (pending) return "Searching…";
  if (count === 1) return "1 result";
  return `${count} results`;
}

function rowClassName(active: boolean): string {
  return active ? "agent-search-row agent-search-row--active" : "agent-search-row";
}

function whoLabel(source: AgentThreadSearchMatch["source"]): string {
  return source === "user" ? "You:" : "Agent:";
}

function whoClassName(source: AgentThreadSearchMatch["source"]): string {
  return source === "user"
    ? "agent-search-row__who agent-search-row__who--user"
    : "agent-search-row__who agent-search-row__who--agent";
}

function matchKey(match: AgentThreadSearchMatch): string {
  return `${match.threadId}:${match.turnId ?? "title"}:${match.eventIndex ?? -1}`;
}

function marked(text: string, ranges: ReadonlyArray<AgentThreadSearchRange>): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (end <= start) return;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(<mark key={`m${index}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  });

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
