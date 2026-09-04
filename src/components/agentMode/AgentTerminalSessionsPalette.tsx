import { CornerDownLeft, Folder, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type { AgentCliKind } from "../../domain/agentTask";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentCompactRelativeTime, AgentRelativeTime } from "./agentClock";
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
  terminalSessionRoleChip,
  terminalSessionsEmptyNote,
  type AgentTerminalSessionMetaSegment,
  type AgentTerminalSessionPreviewView,
  type AgentTerminalSessionsStateKey,
} from "./agentTerminalSessionsPresentation";

const LISTBOX_ID = "agent-terminal-sessions-listbox";
const OPTION_PREFIX = "agent-terminal-sessions-option-";

type KeyOrigin = "input" | "row" | "other";

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
  const canActivate = surface.state === "ready" && !surface.importPending;
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
  const continueLabel = terminalSessionActionLabel(active, surface.importPending);
  const continueDisabled = active === undefined || !canActivate;

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Terminal sessions"
        className="agent-tsp agent-terminal-sessions"
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
            aria-activedescendant={listboxRendered ? `${OPTION_PREFIX}${boundedIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls={listboxRendered ? LISTBOX_ID : undefined}
            aria-expanded={listboxRendered}
            aria-label="Filter terminal sessions"
            className="agent-tsp__input"
            maxLength={MAX_TERMINAL_SESSION_FILTER_CHARS}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search sessions"
            ref={inputRef}
            role="combobox"
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
            <SessionListBody
              activeIndex={boundedIndex}
              filtered={filtered}
              onHighlight={setActiveIndex}
              onOpen={activate}
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
            onClick={() => activate(active)}
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
  projectLabel,
  query,
  repositoryRoot,
  surface,
}: {
  readonly activeIndex: number;
  readonly filtered: ReadonlyArray<ExternalAgentSessionView>;
  onHighlight(index: number): void;
  onOpen(session: ExternalAgentSessionView): void;
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
      role="listbox"
    >
      {filtered.map((session, index) => (
        <button
          aria-selected={index === activeIndex}
          className="agent-tsp__row"
          data-provider={session.provider}
          id={`${OPTION_PREFIX}${index}`}
          key={`${session.provider}:${session.sessionId}`}
          onClick={() => onHighlight(index)}
          onDoubleClick={() => onOpen(session)}
          role="option"
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
      ))}
    </div>
  );
}

function SessionListState({
  projectLabel,
  surface,
}: {
  readonly projectLabel: string | null;
  readonly surface: ExternalSessionsSurface;
}) {
  if (surface.state === "loading") {
    return <StateBlock label="Loading" note="Loading terminal sessions…" stateKey="loading" />;
  }
  if (surface.state === "failed") {
    return (
      <StateBlock
        label="Unavailable"
        note="Terminal sessions could not be loaded."
        stateKey="failed"
        tone="bad"
      >
        <button className="agent-linkbutton" onClick={() => void surface.reload()} type="button">
          Retry
        </button>
      </StateBlock>
    );
  }
  return (
    <StateBlock
      label="Nothing yet"
      note={terminalSessionsEmptyNote(projectLabel)}
      stateKey="empty"
    />
  );
}

function MetaSegments({
  segments,
}: {
  readonly segments: ReadonlyArray<AgentTerminalSessionMetaSegment>;
}) {
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment.kind}>
          {index > 0 && (
            <span aria-hidden="true" className="agent-tsp__sep">
              ·
            </span>
          )}
          <span className={metaSegmentClassName(segment)}>{segment.text}</span>
        </Fragment>
      ))}
    </>
  );
}

function metaSegmentClassName(segment: AgentTerminalSessionMetaSegment): string {
  if (segment.kind === "turns") return "agent-tsp__meta-segment agent-num";
  return "agent-tsp__meta-segment";
}

function StateBlock({
  children,
  label,
  note,
  stateKey,
  tone = "neutral",
}: {
  readonly children?: ReactNode;
  readonly label: string;
  readonly note: string;
  readonly stateKey: AgentTerminalSessionsStateKey;
  readonly tone?: "neutral" | "bad";
}) {
  const labelClassName =
    tone === "bad" ? "agent-microlabel agent-microlabel--bad" : "agent-microlabel";
  return (
    <div className="agent-tsp__state" data-state={stateKey}>
      <span className={labelClassName}>{label}</span>
      <p className="agent-tsp__note">{note}</p>
      {children}
    </div>
  );
}

function PreviewDrawer({
  active,
  onRetry,
  repositoryRoot,
  view,
}: {
  readonly active: ExternalAgentSessionView | null;
  onRetry(): void;
  readonly repositoryRoot: string | null;
  readonly view: AgentTerminalSessionPreviewView;
}) {
  if (active === null || view.kind === "idle") {
    return (
      <StateBlock label="Preview" note="Select a session to preview it." stateKey="preview-idle" />
    );
  }

  return (
    <>
      <div className="agent-tsp__drawer-head">
        <div className="agent-tsp__drawer-title">{agentExternalSessionRowTitle(active)}</div>
        <div className="agent-tsp__drawer-meta">
          <AgentProviderGlyph decorative kind={active.provider} />
          <MetaSegments segments={terminalSessionMetaSegments(active, repositoryRoot)} />
          <span aria-hidden="true" className="agent-tsp__sep">
            ·
          </span>
          <span className="agent-tsp__meta-segment">
            <AgentRelativeTime epochMs={active.lastActivityEpochMs} />
          </span>
        </div>
      </div>
      <PreviewBody onRetry={onRetry} view={view} />
    </>
  );
}

function PreviewBody({
  onRetry,
  view,
}: {
  onRetry(): void;
  readonly view: Exclude<AgentTerminalSessionPreviewView, { readonly kind: "idle" }>;
}) {
  if (view.kind === "loading") {
    return <StateBlock label="Preview" note="Loading preview…" stateKey="preview-loading" />;
  }
  if (view.kind === "failed") {
    return (
      <StateBlock
        label="Unavailable"
        note="The preview could not be loaded."
        stateKey="preview-failed"
        tone="bad"
      >
        <button className="agent-linkbutton" onClick={onRetry} type="button">
          Retry
        </button>
      </StateBlock>
    );
  }
  if (view.preview.exchanges.length === 0) {
    return (
      <StateBlock
        label="Preview"
        note="No readable messages in this session."
        stateKey="preview-empty"
      />
    );
  }

  return (
    <div className="agent-tsp__log">
      {view.preview.exchanges.map((exchange, index) => {
        const chip = terminalSessionRoleChip(exchange.role);
        return (
          <article className="agent-tsp__exchange" data-role={exchange.role} key={index}>
            <span className={chip.className}>{chip.label}</span>
            <p className="agent-tsp__exchange-text">{exchange.text}</p>
          </article>
        );
      })}
      {view.preview.exchangesTruncated && (
        <p className="agent-tsp__note agent-tsp__note--footnote">
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
