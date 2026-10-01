import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import { Button } from "../../ui/foundation/Button";
import {
  AgentHistoryCatalogRow,
  SAVED_CONVERSATION_ROW_SELECTOR,
  type AgentHistoryCatalogRowActions,
} from "./AgentHistoryCatalogRow";
import { agentProjectMonogram } from "./agentRailFilter";
import { boundedSavedConversationTitle } from "../../domain/agentSavedConversationTitle";
import "./agentHistoryCatalog.css";

export function AgentHistoryCatalog({
  catalog,
  onSelect,
}: {
  readonly catalog: AgentHistoryCatalogSurface;
  readonly onSelect: (threadId: string) => void;
}) {
  const mounted = useRef(true);
  const listRef = useRef<HTMLUListElement | null>(null);
  const focusAfterDelete = useRef<PendingDeleteFocus | null>(null);
  useLayoutEffect(() => {
    const pending = focusAfterDelete.current;
    if (pending === null || catalog.page?.deletingThreadId != null) return;
    if (catalog.rows.some((row) => row.threadId === pending.threadId)) return;
    focusAfterDelete.current = null;
    const rows = rowElements(listRef.current);
    rows[Math.min(pending.index, rows.length - 1)]?.focus();
  }, [catalog.page?.deletingThreadId, catalog.rows]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
          catalog.rows.findIndex((row) => row.threadId === threadId),
          0,
        );
        focusAfterDelete.current = { threadId, index };
        void catalog.remove(threadId).then((removed) => {
          if (!removed && focusAfterDelete.current?.threadId === threadId)
            focusAfterDelete.current = null;
        });
      },
    }),
    [catalog, onSelect],
  );
  const page = catalog.page;
  if (catalog.projects.length === 0) return null;
  const project = catalog.projects.find((candidate) => candidate.rootKey === page?.rootKey);
  const busy = page !== null && (page.loading || page.deletingThreadId !== null);
  const deleting = catalog.rows.find((row) => row.threadId === page?.deletingThreadId);
  return (
    <section aria-label="Saved conversations" className="agent-history-catalog">
      <Button
        aria-expanded={page !== null}
        onClick={() => {
          if (page) catalog.close();
          else void catalog.choose(catalog.projects[0].rootKey);
        }}
        size="sm"
        variant="ghost"
      >
        Saved conversations
      </Button>
      {page && (
        <>
          <header className="agent-history-catalog__header">
            <span aria-hidden="true" className="cv-favicon">
              {agentProjectMonogram(project?.label ?? "")}
            </span>
            {catalog.projects.length > 1 ? (
              <select
                aria-label="Saved conversation project"
                className="agent-history-catalog__project"
                disabled={busy}
                value={page.rootKey}
                onChange={(event) => void catalog.choose(event.target.value)}
              >
                {catalog.projects.map((candidate) => (
                  <option key={candidate.rootKey} value={candidate.rootKey}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            ) : (
              <h3 className="agent-history-catalog__project">{project?.label}</h3>
            )}
          </header>
          {page.loading && <p role="status">Loading saved conversations…</p>}
          {deleting && (
            <p role="status">{`Deleting “${boundedSavedConversationTitle(deleting.title, 60)}”…`}</p>
          )}
          {page.notice && <p role="status">{page.notice}</p>}
          {page.error && <p role="alert">{page.error}</p>}
          {catalog.rows.length > 0 && (
            <ul
              aria-label={`Saved conversations in ${project?.label ?? "this project"}`}
              className="agent-history-catalog__list"
              onKeyDown={moveRowFocus}
              ref={listRef}
            >
              {catalog.rows.map((row) => (
                <AgentHistoryCatalogRow
                  actions={actions}
                  busy={busy}
                  key={row.threadId}
                  row={row}
                />
              ))}
            </ul>
          )}
          {!busy && !page.error && !page.notice && catalog.rows.length === 0 && (
            <p className="agent-history-catalog__empty">No saved conversations.</p>
          )}
          <footer className="agent-history-catalog__paging">
            <Button
              disabled={busy || !page.hasEarlier}
              onClick={() => void catalog.older()}
              size="sm"
              variant="ghost"
            >
              Older conversations
            </Button>
            <Button disabled={busy} onClick={() => void catalog.latest()} size="sm" variant="ghost">
              Back to newest
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

interface PendingDeleteFocus {
  readonly threadId: string;
  readonly index: number;
}

const ROW_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

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
