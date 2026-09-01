import { History, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type { AgentCliKind } from "../../domain/agentTask";
import type {
  ExternalAgentSessionPreview,
  ExternalAgentSessionView,
} from "../../domain/externalAgentSession";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentCompactRelativeTime } from "./agentClock";
import {
  AGENT_IMPORTED_BADGE_LABEL,
  agentExternalSessionRowTitle,
  agentExternalSessionsStatusNote,
  agentSessionTurnCountLabel,
} from "./agentSidebarPresentation";

const LISTBOX_ID = "agent-terminal-sessions-listbox";
const OPTION_PREFIX = "agent-terminal-sessions-option-";
export const MAX_TERMINAL_SESSION_FILTER_CHARS = 200;

type KeyOrigin = "input" | "row" | "other";

type PreviewView =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly preview: ExternalAgentSessionPreview };

export interface AgentTerminalSessionsPaletteProps {
  readonly isOpen: boolean;
  readonly surface: ExternalSessionsSurface;
  readonly projectLabel?: string | null;
  onClose(): void;
  onImport(sessionId: string, provider: AgentCliKind): void;
  onSelectImported(threadId: string): void;
}

export function AgentTerminalSessionsPalette({
  isOpen,
  onClose,
  onImport,
  onSelectImported,
  projectLabel = null,
  surface,
}: AgentTerminalSessionsPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sessions = surface.sessions;
  const filtered = useMemo(() => filterSessions(sessions, query), [query, sessions]);

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

  const previewView = resolvePreviewView(surface, active ?? null, requestedSessionId);
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
    if (session === undefined || surface.importPending) return;
    if (session.alreadyImportedThreadId !== null) {
      onSelectImported(session.alreadyImportedThreadId);
      return;
    }
    onImport(session.sessionId, session.provider);
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
      activate(active);
      return true;
    }
    if (filtered.length === 0) return false;
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

  const label = projectLabel ?? repositoryLabel(surface.target?.repositoryRoot ?? null);
  const heading = label === null ? "Terminal sessions" : `Terminal sessions - ${label}`;
  const continueLabel = actionLabel(active, surface.importPending);
  const continueDisabled =
    active === undefined || surface.importPending || surface.state !== "ready";

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Terminal sessions"
        className="quick-open agent-terminal-sessions"
        onKeyDown={(event) => {
          if (!handleKeyDown(event.key, keyOrigin(event.target, inputRef.current))) return;
          event.preventDefault();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agent-terminal-sessions__header">
          <History aria-hidden="true" size={15} />
          <span className="agent-terminal-sessions__heading">{heading}</span>
        </div>

        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={
              boundedIndex >= 0 ? `${OPTION_PREFIX}${boundedIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-expanded={filtered.length > 0}
            aria-label="Filter terminal sessions"
            maxLength={MAX_TERMINAL_SESSION_FILTER_CHARS}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter by title or session id"
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </div>

        <div className="quick-open-results agent-terminal-sessions__body">
          <div className="agent-terminal-sessions__results">
            <div className="search-everywhere-section-label">Sessions</div>
            <SessionListBody
              activeIndex={boundedIndex}
              filtered={filtered}
              onHighlight={setActiveIndex}
              onOpen={activate}
              query={query}
              surface={surface}
            />
          </div>
          <aside aria-label="Session preview" className="agent-terminal-sessions__preview">
            <div className="search-everywhere-section-label">Preview</div>
            <PreviewBody onRetry={retryPreview} view={previewView} />
          </aside>
        </div>

        <footer className="palette-footer agent-terminal-sessions__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> continue
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="agent-terminal-sessions__spacer" />
          {statusNote !== null && (
            <span className="agent-terminal-sessions__status">{statusNote}</span>
          )}
          <button
            className="agent-terminal-sessions__continue"
            disabled={continueDisabled}
            onClick={() => activate(active)}
            type="button"
          >
            {continueLabel}
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
  query,
  surface,
}: {
  readonly activeIndex: number;
  readonly filtered: ReadonlyArray<ExternalAgentSessionView>;
  onHighlight(index: number): void;
  onOpen(session: ExternalAgentSessionView): void;
  readonly query: string;
  readonly surface: ExternalSessionsSurface;
}) {
  if (surface.state === "loading") {
    return <p className="quick-open-state">Loading terminal sessions…</p>;
  }
  if (surface.state === "failed") {
    return (
      <p className="quick-open-state agent-terminal-sessions__error">
        <span>Terminal sessions could not be loaded.</span>
        <button className="agent-linkbutton" onClick={() => void surface.reload()} type="button">
          Retry
        </button>
      </p>
    );
  }
  if (surface.sessions.length === 0) {
    return <p className="quick-open-state">No terminal sessions for this project.</p>;
  }
  if (filtered.length === 0) {
    return <p className="quick-open-state">No sessions match “{query.trim()}”.</p>;
  }

  return (
    <div aria-label="Terminal sessions" id={LISTBOX_ID} role="listbox">
      {filtered.map((session, index) => (
        <button
          aria-selected={index === activeIndex}
          className={rowClassName(index === activeIndex)}
          id={`${OPTION_PREFIX}${index}`}
          key={`${session.provider}:${session.sessionId}`}
          onClick={() => onHighlight(index)}
          onDoubleClick={() => onOpen(session)}
          role="option"
          type="button"
        >
          <AgentProviderGlyph kind={session.provider} />
          <span className="agent-terminal-sessions__row-title">
            {agentExternalSessionRowTitle(session)}
          </span>
          <span className="agent-terminal-sessions__row-meta agent-num">
            {session.alreadyImportedThreadId !== null && (
              <span className="agent-terminal-sessions__badge">{AGENT_IMPORTED_BADGE_LABEL}</span>
            )}
            <span>{agentSessionTurnCountLabel(session.turnCount, session.turnCountExact)}</span>
            <span>
              <AgentCompactRelativeTime epochMs={session.lastActivityEpochMs} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PreviewBody({ onRetry, view }: { onRetry(): void; readonly view: PreviewView }) {
  if (view.kind === "idle") {
    return <p className="agent-terminal-sessions__note">Select a session to preview it.</p>;
  }
  if (view.kind === "loading") {
    return <p className="agent-terminal-sessions__note">Loading preview…</p>;
  }
  if (view.kind === "failed") {
    return (
      <p className="agent-terminal-sessions__note agent-terminal-sessions__note--error">
        <span>The preview could not be loaded.</span>
        <button className="agent-linkbutton" onClick={onRetry} type="button">
          Retry
        </button>
      </p>
    );
  }
  if (view.preview.exchanges.length === 0) {
    return <p className="agent-terminal-sessions__note">No readable messages in this session.</p>;
  }

  return (
    <div className="agent-terminal-sessions__exchanges">
      {view.preview.exchanges.map((exchange, index) => (
        <article
          className={`agent-terminal-sessions__exchange agent-terminal-sessions__exchange--${exchange.role}`}
          key={index}
        >
          <span className="agent-microlabel">{exchange.role === "user" ? "you" : "agent"}</span>
          <p className="agent-terminal-sessions__exchange-text">{exchange.text}</p>
        </article>
      ))}
      {view.preview.exchangesTruncated && (
        <p className="agent-terminal-sessions__note">
          Preview shows the beginning and end of a long session.
        </p>
      )}
    </div>
  );
}

function keyOrigin(target: EventTarget | null, input: HTMLInputElement | null): KeyOrigin {
  if (target === null) return "other";
  if (target === input) return "input";
  if (target instanceof HTMLElement && target.getAttribute("role") === "option") return "row";
  return "other";
}

function resolvePreviewView(
  surface: ExternalSessionsSurface,
  active: ExternalAgentSessionView | null,
  requested: string | null,
): PreviewView {
  if (active === null) return { kind: "idle" };
  const preview = surface.preview;
  if (preview !== null && preview.sessionId === active.sessionId) {
    return { kind: "ready", preview };
  }
  if (surface.previewPending) return { kind: "loading" };
  if (requested === active.sessionId) return { kind: "failed" };
  return { kind: "loading" };
}

function filterSessions(
  sessions: ReadonlyArray<ExternalAgentSessionView>,
  rawQuery: string,
): ReadonlyArray<ExternalAgentSessionView> {
  const needle = rawQuery.slice(0, MAX_TERMINAL_SESSION_FILTER_CHARS).trim().toLowerCase();
  if (needle === "") return sessions;
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(needle) ||
      session.sessionId.toLowerCase().includes(needle),
  );
}

function actionLabel(active: ExternalAgentSessionView | undefined, importPending: boolean): string {
  if (importPending) return "Importing…";
  if (active !== undefined && active.alreadyImportedThreadId !== null) {
    return "Open imported thread";
  }
  return "Continue in Codevo";
}

function repositoryLabel(repositoryRoot: string | null): string | null {
  if (repositoryRoot === null) return null;
  const segments = repositoryRoot.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? null;
}

function rowClassName(activeRow: boolean): string {
  const base = "quick-open-result agent-terminal-sessions__row";
  if (activeRow) return `${base} active`;
  return base;
}
