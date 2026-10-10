import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import { ChevronDown } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import {
  AgentHistoryCatalogRow,
  SAVED_CONVERSATION_ROW_SELECTOR,
  type AgentHistoryCatalogRowActions,
} from "./AgentHistoryCatalogRow";
import {
  agentHistoryCatalogScopeIncludes,
  type AgentHistoryCatalogScope,
} from "./agentHistoryCatalogScope";
import { agentProjectMonogram } from "./agentProjectMonogram";
import { boundedSavedConversationTitle } from "../../domain/agentSavedConversationTitle";
import "./agentSidebar.css";
import "./agentHistoryCatalog.css";

export function AgentHistoryCatalog({
  catalog,
  onSelect,
  scope,
  shownInRailThreadIds = NO_THREAD_IDS,
}: {
  readonly catalog: AgentHistoryCatalogSurface;
  readonly onSelect: (threadId: string) => void;
  readonly scope: AgentHistoryCatalogScope;
  readonly shownInRailThreadIds?: ReadonlySet<string>;
}) {
  const { choose, close } = catalog;
  const openRootKey = catalog.page?.rootKey ?? null;
  const inScope = agentHistoryCatalogScopeIncludes(scope, openRootKey);
  const page = inScope ? catalog.page : null;
  const strayRootKey = inScope ? null : openRootKey;
  const strayDeleting = strayRootKey !== null && catalog.page?.deletingThreadId != null;
  const targetRootKey = scope.kind === "available" ? scope.defaultRootKey : null;
  const rows = useMemo(
    () =>
      inScope ? catalog.rows.filter((row) => !shownInRailThreadIds.has(row.threadId)) : NO_ROWS,
    [catalog.rows, inScope, shownInRailThreadIds],
  );
  const mounted = useRef(true);
  const listRef = useRef<HTMLUListElement | null>(null);
  const focusAfterDelete = useRef<PendingDeleteFocus | null>(null);
  useLayoutEffect(() => {
    const pending = focusAfterDelete.current;
    if (pending === null || page?.deletingThreadId != null) return;
    if (rows.some((row) => row.threadId === pending.threadId)) return;
    focusAfterDelete.current = null;
    const elements = rowElements(listRef.current);
    elements[Math.min(pending.index, elements.length - 1)]?.focus();
  }, [page?.deletingThreadId, rows]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (strayRootKey === null || strayDeleting) return;
    if (targetRootKey === null) {
      close();
      return;
    }
    void choose(targetRootKey);
  }, [choose, close, strayDeleting, strayRootKey, targetRootKey]);
  const actions = useMemo<AgentHistoryCatalogRowActions>(
    () => ({
      open: (threadId) => {
        void catalog.open(threadId).then((opened) => {
          if (opened && mounted.current) onSelect(threadId);
        });
      },
      rename: (threadId, title) => void catalog.rename(threadId, title),
      setArchived: (threadId, archived) => void catalog.setArchived(threadId, archived),
      remove: (threadId) => {
        const index = Math.max(
          rows.findIndex((row) => row.threadId === threadId),
          0,
        );
        focusAfterDelete.current = { threadId, index };
        void catalog.remove(threadId).then((removed) => {
          if (!removed && focusAfterDelete.current?.threadId === threadId)
            focusAfterDelete.current = null;
        });
      },
    }),
    [catalog, onSelect, rows],
  );
  if (scope.kind === "unavailable") return null;
  const { projects, defaultRootKey } = scope;
  const project = projects.find((candidate) => candidate.rootKey === page?.rootKey);
  const busy = page !== null && (page.loading || page.deletingThreadId !== null);
  const deleting = catalog.rows.find((row) => row.threadId === page?.deletingThreadId);
  const empty =
    page === null || busy || page.error || page.notice
      ? null
      : emptyMessage({
          listed: rows.length,
          onPage: catalog.rows.length,
          hasEarlier: page.hasEarlier,
          atNewest: page.atNewest,
        });
  const headed = projects.length > 1 || rows.length > 0;
  const offersOlder = page !== null && page.hasEarlier;
  const offersNewest = page !== null && !page.atNewest;
  const offersRefresh = page !== null && page.error !== null && page.atNewest;
  return (
    <section aria-label="Saved conversations" className="agent-history-catalog">
      <button
        aria-expanded={page !== null}
        className="cv-sb-shelf agent-history-catalog__toggle"
        data-shelf="saved-conversations"
        disabled={strayDeleting}
        onClick={() => {
          if (page) {
            close();
            return;
          }
          void choose(defaultRootKey);
        }}
        type="button"
      >
        Saved conversations
        <span aria-hidden="true" className="cv-sb-shelf__rule" />
        <ChevronDown aria-hidden="true" className="cv-sb-shelf__chevron" size={12} />
      </button>
      {page && (
        <>
          {headed && (
            <header className="agent-history-catalog__header">
              <span aria-hidden="true" className="cv-favicon">
                {agentProjectMonogram(project?.label ?? "")}
              </span>
              {projects.length > 1 ? (
                <select
                  aria-label="Saved conversation project"
                  className="agent-history-catalog__project"
                  disabled={busy}
                  value={page.rootKey}
                  onChange={(event) => void choose(event.target.value)}
                >
                  {projects.map((candidate) => (
                    <option key={candidate.rootKey} value={candidate.rootKey}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              ) : (
                <h3 className="agent-history-catalog__project">{project?.label}</h3>
              )}
            </header>
          )}
          {page.loading && <p role="status">Loading saved conversations…</p>}
          {deleting && (
            <p role="status">{`Deleting “${boundedSavedConversationTitle(deleting.title, 60)}”…`}</p>
          )}
          {page.notice && <p role="status">{page.notice}</p>}
          {page.error && <p role="alert">{page.error}</p>}
          {rows.length > 0 && (
            <ul
              aria-label={`Saved conversations in ${project?.label ?? "this project"}`}
              className="agent-history-catalog__list"
              onKeyDown={moveRowFocus}
              ref={listRef}
            >
              {rows.map((row) => (
                <AgentHistoryCatalogRow
                  actions={actions}
                  busy={busy}
                  key={row.threadId}
                  row={row}
                />
              ))}
            </ul>
          )}
          {empty && <p className="agent-history-catalog__empty">{empty}</p>}
          {(offersOlder || offersNewest || offersRefresh) && (
            <footer className="agent-history-catalog__paging">
              {offersOlder && (
                <Button
                  disabled={busy}
                  onClick={() => void catalog.older()}
                  size="sm"
                  variant="ghost"
                >
                  Older conversations
                </Button>
              )}
              {offersNewest && (
                <Button
                  disabled={busy}
                  onClick={() => void catalog.latest()}
                  size="sm"
                  variant="ghost"
                >
                  Back to newest
                </Button>
              )}
              {offersRefresh && (
                <Button
                  disabled={busy}
                  onClick={() => void catalog.latest()}
                  size="sm"
                  variant="ghost"
                >
                  Refresh
                </Button>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );
}

interface PendingDeleteFocus {
  readonly threadId: string;
  readonly index: number;
}

interface ShelfListing {
  readonly listed: number;
  readonly onPage: number;
  readonly hasEarlier: boolean;
  readonly atNewest: boolean;
}

const NO_THREAD_IDS: ReadonlySet<string> = new Set();
const NO_ROWS: AgentHistoryCatalogSurface["rows"] = [];
const ROW_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);
const NO_SAVED_CONVERSATIONS = "No saved conversations.";
const SAVED_CONVERSATIONS_ALREADY_OPEN = "Conversations on this page are already open.";
const ALL_SAVED_CONVERSATIONS_ALREADY_OPEN = "All saved conversations are already open.";

function emptyMessage({ listed, onPage, hasEarlier, atNewest }: ShelfListing): string | null {
  if (listed > 0) return null;
  if (onPage === 0 && (hasEarlier || !atNewest)) return null;
  if (onPage === 0) return NO_SAVED_CONVERSATIONS;
  if (!hasEarlier && atNewest) return ALL_SAVED_CONVERSATIONS_ALREADY_OPEN;
  return SAVED_CONVERSATIONS_ALREADY_OPEN;
}

function rowElements(list: HTMLUListElement | null): ReadonlyArray<HTMLButtonElement> {
  if (list === null) return [];
  return Array.from(
    list.querySelectorAll<HTMLButtonElement>(SAVED_CONVERSATION_ROW_SELECTOR),
  ).filter((row) => !row.disabled);
}

function moveRowFocus(event: KeyboardEvent<HTMLUListElement>): void {
  if (!ROW_NAVIGATION_KEYS.has(event.key)) return;
  const rows = rowElements(event.currentTarget);
  const active = document.activeElement;
  const index = rows.findIndex((row) => row.closest("li")?.contains(active) === true);
  const next = nextRowIndex(event.key, index, rows.length);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  rows[next]?.focus();
}

function nextRowIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (index === -1) return null;
  const step = key === "ArrowDown" ? 1 : -1;
  return Math.min(count - 1, Math.max(0, index + step));
}
