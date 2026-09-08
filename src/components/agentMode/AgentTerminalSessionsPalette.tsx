import { CornerDownLeft, Folder, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type { AgentCliKind } from "../../domain/agentTask";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentCompactRelativeTime } from "./agentClock";
import {
  AGENT_IMPORTED_BADGE_LABEL,
  agentExternalSessionRowTitle,
  agentExternalSessionsStatusNote,
} from "./agentSidebarPresentation";
import {
  MAX_TERMINAL_SESSION_FILTER_CHARS,
  filterTerminalSessions,
  resolveTerminalSessionPreview,
  terminalSessionActionLabel,
  terminalSessionMetaSegments,
  terminalSessionRepositoryLabel,
} from "./agentTerminalSessionsPresentation";

import {
  MetaSegments,
  PreviewDrawer,
  SessionListState,
  StateBlock,
} from "./AgentTerminalSessionsContent";
import {
  useTerminalSessionSelection,
  terminalSessionSelectionKey,
  MAX_SESSION_SELECTION,
} from "./useTerminalSessionSelection";

const LISTBOX_ID = "agent-terminal-sessions-listbox";
const OPTION_PREFIX = "agent-terminal-sessions-option-";

type KeyOrigin = "input" | "row" | "other";

export interface AgentTerminalSessionsPaletteProps {
  readonly isOpen: boolean;
  readonly surface: ExternalSessionsSurface;
  readonly projectLabel?: string | null;
  onImportMany?(
    sessions: ReadonlyArray<{ readonly sessionId: string; readonly provider: AgentCliKind }>,
  ): void;
  readonly importProgress?: { readonly completed: number; readonly total: number } | null;
  readonly importNotice?: string | null;
  onClose(): void;
  onImport(sessionId: string, provider: AgentCliKind): void;
  onSelectImported(threadId: string): void;
}

export function AgentTerminalSessionsPalette({
  isOpen,
  onClose,
  onImport,
  onSelectImported,
  onImportMany,
  importProgress = null,
  importNotice = null,
  projectLabel = null,
  surface,
}: AgentTerminalSessionsPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sessions = surface.sessions;
  const selection = useTerminalSessionSelection(isOpen, surface.target, sessions);
  const batchEnabled = onImportMany !== undefined;
  const importRunning = surface.importPending || importProgress !== null;
  const filtered = useMemo(() => filterTerminalSessions(sessions, query), [query, sessions]);

  useEffect(() => {
    if (isOpen) return;
    setQuery("");
    setRequestedSessionId(null);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [isOpen, query, filtered]);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [isOpen]);

  const boundedIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);
  const active = boundedIndex >= 0 ? filtered[boundedIndex] : undefined;
  const activeSessionId = active?.sessionId ?? null;

  useEffect(() => {
    if (!isOpen || activeSessionId === null) return;
    if (requestedSessionId === activeSessionId) return;
    setRequestedSessionId(activeSessionId);
    void surface.loadPreview(activeSessionId);
  }, [activeSessionId, isOpen, requestedSessionId, surface]);

  if (!isOpen) return null;

  const repositoryRoot = surface.target?.repositoryRoot ?? null;
  const listboxRendered = filtered.length > 0;
  const refreshing = surface.state === "loading" && sessions.length > 0;
  const canActivate = surface.state === "ready" && !importRunning;
  const previewView = resolveTerminalSessionPreview(surface, active ?? null, requestedSessionId);
  const statusNote = agentExternalSessionsStatusNote(
    surface.skipped,
    surface.truncated,
    sessions.length,
  );

  const retryPreview = (): void => {
    if (activeSessionId === null) return;
    setRequestedSessionId(activeSessionId);
    void surface.loadPreview(activeSessionId);
  };

  const activate = (session: ExternalAgentSessionView | undefined): void => {
    if (session === undefined || !canActivate) return;
    if (session.alreadyImportedThreadId !== null) {
      onSelectImported(session.alreadyImportedThreadId);
      return;
    }
    onImport(session.sessionId, session.provider);
  };

  const activateSelection = (): void => {
    if (!canActivate) return;
    if (selection.selected.length > 0 && onImportMany !== undefined) {
      onImportMany(selection.selected.map(({ sessionId, provider }) => ({ sessionId, provider })));
      return;
    }
    activate(active);
  };

  const handleKeyDown = (key: string, origin: KeyOrigin): boolean => {
    if (key === "Escape") {
      if (origin === "input" && query !== "") {
        setQuery("");
        return true;
      }
      onClose();
      return true;
    }
    if (origin === "other") return false;
    if (key === "Enter") {
      activateSelection();
      return true;
    }
    if (!listboxRendered) return false;
    if (key === "ArrowDown") {
      setActiveIndex((current) => (current + 1) % filtered.length);
      return true;
    }
    if (key === "ArrowUp") {
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (key === "Home") {
      setActiveIndex(0);
      return true;
    }
    if (key === "End") {
      setActiveIndex(filtered.length - 1);
      return true;
    }
    return false;
  };

  const label = projectLabel ?? terminalSessionRepositoryLabel(repositoryRoot);
  const continueLabel =
    importProgress !== null
      ? `Importing ${importProgress.completed} of ${importProgress.total}…`
      : importRunning
        ? "Importing…"
        : selection.selected.length > 0
          ? `Import ${selection.selected.length} ${selection.selected.length === 1 ? "session" : "sessions"}`
          : terminalSessionActionLabel(active, importRunning);
  const continueDisabled =
    (active === undefined && selection.selected.length === 0) || !canActivate;

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Terminal sessions"
        className="agent-tsp"
        onKeyDown={(event) => {
          if (!handleKeyDown(event.key, keyOrigin(event.target, inputRef.current))) return;
          event.preventDefault();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="agent-tsp__search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-activedescendant={
              !batchEnabled && listboxRendered ? `${OPTION_PREFIX}${boundedIndex}` : undefined
            }
            aria-autocomplete={batchEnabled ? undefined : "list"}
            aria-controls={listboxRendered ? LISTBOX_ID : undefined}
            aria-expanded={batchEnabled ? undefined : listboxRendered}
            aria-label="Filter terminal sessions"
            className="agent-tsp__input"
            maxLength={MAX_TERMINAL_SESSION_FILTER_CHARS}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search sessions"
            ref={inputRef}
            role={batchEnabled ? "searchbox" : "combobox"}
            value={query}
          />
          {label !== null && (
            <span
              className="agent-tsp__chip"
              data-chip="repository"
              title={repositoryRoot ?? undefined}
            >
              <Folder aria-hidden="true" size={11} />
              <span className="agent-tsp__chip-label">{label}</span>
            </span>
          )}
        </div>

        <div className="agent-tsp__body">
          <div className="agent-tsp__list">
            {listboxRendered && (
              <div className="agent-microlabel agent-tsp__seclabel">
                Sessions
                {refreshing && (
                  <span className="agent-tsp__refresh" data-refreshing="true">
                    refreshing…
                  </span>
                )}
              </div>
            )}
            {batchEnabled && sessions.length > 0 && (
              <div className="agent-tsp__selection">
                <span>{selection.selected.length} selected</span>
                <button
                  className="agent-linkbutton"
                  disabled={
                    !canActivate ||
                    selection.selected.length >= MAX_SESSION_SELECTION ||
                    !filtered.some(
                      (session) =>
                        session.alreadyImportedThreadId === null &&
                        !selection.keys.has(terminalSessionSelectionKey(session)),
                    )
                  }
                  onClick={() => selection.select(filtered)}
                  type="button"
                >
                  Select filtered
                </button>
                <button
                  className="agent-linkbutton"
                  disabled={!canActivate || selection.selected.length === 0}
                  onClick={selection.clear}
                  type="button"
                >
                  Clear
                </button>
                <span className="agent-tsp__selection-limit">
                  Up to {MAX_SESSION_SELECTION} at a time
                </span>
              </div>
            )}
            <SessionListBody
              activeIndex={boundedIndex}
              filtered={filtered}
              onHighlight={setActiveIndex}
              onOpen={(session) => {
                if (selection.selected.length > 0) return;
                activate(session);
              }}
              selection={batchEnabled ? selection.keys : null}
              selectionDisabled={!canActivate}
              onToggle={selection.toggle}
              projectLabel={label}
              query={query}
              repositoryRoot={repositoryRoot}
              surface={surface}
            />
          </div>
          <aside aria-label="Session preview" className="agent-tsp__drawer">
            <PreviewDrawer
              active={active ?? null}
              onRetry={retryPreview}
              repositoryRoot={repositoryRoot}
              view={previewView}
            />
          </aside>
        </div>

        {importNotice !== null && (
          <p className="agent-tsp__import-notice" role="status">
            {importNotice}
          </p>
        )}
        {importProgress !== null && (
          <p className="agent-tsp__import-notice" role="status">
            Importing {importProgress.completed} of {importProgress.total} sessions…
          </p>
        )}
        <footer className="agent-tsp__footer">
          <span aria-hidden="true" className="agent-tsp__hints">
            <span className="agent-tsp__hint">
              <kbd className="agent-tsp__kbd">↑</kbd>
              <kbd className="agent-tsp__kbd">↓</kbd> navigate
            </span>
            <span className="agent-tsp__hint">
              <kbd className="agent-tsp__kbd">↵</kbd> continue
            </span>
            <span className="agent-tsp__hint">
              <kbd className="agent-tsp__kbd">esc</kbd> close
            </span>
          </span>
          <span className="agent-tsp__spacer" />
          {statusNote !== null && <span className="agent-tsp__count">{statusNote}</span>}
          <button
            className="agent-tsp__continue"
            disabled={continueDisabled}
            onClick={activateSelection}
            type="button"
          >
            {continueLabel}
            <CornerDownLeft aria-hidden="true" size={12} />
          </button>
        </footer>
      </section>
    </div>
  );
}

function SessionListBody({
  activeIndex,
  filtered,
  onHighlight,
  onOpen,
  selection,
  selectionDisabled,
  onToggle,
  projectLabel,
  query,
  repositoryRoot,
  surface,
}: {
  readonly activeIndex: number;
  readonly filtered: ReadonlyArray<ExternalAgentSessionView>;
  onHighlight(index: number): void;
  onOpen(session: ExternalAgentSessionView): void;
  readonly selection: ReadonlySet<string> | null;
  readonly selectionDisabled: boolean;
  onToggle(session: ExternalAgentSessionView): void;
  readonly projectLabel: string | null;
  readonly query: string;
  readonly repositoryRoot: string | null;
  readonly surface: ExternalSessionsSurface;
}) {
  if (surface.sessions.length === 0) {
    return <SessionListState projectLabel={projectLabel} surface={surface} />;
  }
  if (filtered.length === 0) {
    return (
      <StateBlock
        label="No matches"
        note={`No sessions match “${query.trim()}”.`}
        stateKey="no-matches"
      />
    );
  }

  return (
    <div
      aria-label="Terminal sessions"
      className="agent-tsp__listbox"
      id={LISTBOX_ID}
      role={selection === null ? "listbox" : "group"}
    >
      {filtered.map((session, index) => (
        <div className="agent-tsp__selectable-row" key={terminalSessionSelectionKey(session)}>
          {selection !== null && (
            <input
              type="checkbox"
              aria-label={`Select ${agentExternalSessionRowTitle(session)} for import`}
              checked={selection.has(terminalSessionSelectionKey(session))}
              disabled={
                selectionDisabled ||
                session.alreadyImportedThreadId !== null ||
                (selection.size >= MAX_SESSION_SELECTION &&
                  !selection.has(terminalSessionSelectionKey(session)))
              }
              onChange={() => onToggle(session)}
            />
          )}
          <button
            aria-selected={selection === null ? index === activeIndex : undefined}
            aria-label={
              selection === null ? undefined : `Preview ${agentExternalSessionRowTitle(session)}`
            }
            aria-current={selection !== null && index === activeIndex ? "true" : undefined}
            data-highlighted={index === activeIndex}
            className="agent-tsp__row"
            data-provider={session.provider}
            id={`${OPTION_PREFIX}${index}`}
            onClick={() => onHighlight(index)}
            onDoubleClick={() => onOpen(session)}
            role={selection === null ? "option" : undefined}
            type="button"
          >
            <AgentProviderGlyph decorative kind={session.provider} />
            <span className="agent-tsp__text">
              <span className="agent-tsp__title">{agentExternalSessionRowTitle(session)}</span>
              <span className="agent-tsp__meta">
                <MetaSegments segments={terminalSessionMetaSegments(session, repositoryRoot)} />
                {session.alreadyImportedThreadId !== null && (
                  <span className="agent-tsp__badge">{AGENT_IMPORTED_BADGE_LABEL}</span>
                )}
              </span>
            </span>
            <span className="agent-tsp__time agent-num">
              <AgentCompactRelativeTime epochMs={session.lastActivityEpochMs} />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function keyOrigin(target: EventTarget | null, input: HTMLInputElement | null): KeyOrigin {
  if (target === null) return "other";
  if (target === input) return "input";
  if (
    target instanceof HTMLElement &&
    (target.getAttribute("role") === "option" ||
      target.hasAttribute("data-highlighted") ||
      (target instanceof HTMLInputElement && target.type === "checkbox"))
  )
    return "row";
  return "other";
}
