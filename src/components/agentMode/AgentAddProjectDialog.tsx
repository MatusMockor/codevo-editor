import { ArrowLeft, ExternalLink, Folder, FolderOpen, Link, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDirectoryBrowser } from "../../application/useDirectoryBrowser";
import {
  directoryDisplayPath,
  MAX_DIRECTORY_FILTER_QUERY_CHARS,
  type DirectoryEntry,
  type DirectoryListingGateway,
} from "../../domain/directoryListing";
import {
  agentAddProjectActionLabel,
  agentAddProjectIntent,
  agentAddProjectIntentReason,
} from "./agentAddProjectIntent";

const LISTBOX_ID = "agent-add-project-listbox";
const OPTION_PREFIX = "agent-add-project-option-";
const REASON_ID = "agent-add-project-reason";
const MAX_NOTICE_CHARS = 200;
export const MAX_RENDERED_DIRECTORY_ROWS = 200;

export interface AgentAddProjectDialogProps {
  readonly gateway: DirectoryListingGateway;
  readonly projectRootPaths: ReadonlyArray<string>;
  onClose(): void;
  onAdd(path: string): void;
  onOpenExisting(rootPath: string): void;
  onNotice?(message: string): void;
}

export function AgentAddProjectDialog({
  gateway,
  onAdd,
  onClose,
  onNotice,
  onOpenExisting,
  projectRootPaths,
}: AgentAddProjectDialogProps) {
  const browser = useDirectoryBrowser(gateway);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { listing, query, showHidden, status } = browser;
  const { ascend, descend, goBack, reload, setQuery, setShowHidden } = browser;
  const visibleEntries = browser.visibleEntries.slice(0, MAX_RENDERED_DIRECTORY_ROWS);
  const hiddenByRenderCap = browser.visibleEntries.length - visibleEntries.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [browser.visibleEntries]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [listing]);

  const boundedIndex =
    visibleEntries.length === 0 ? -1 : Math.min(activeIndex, visibleEntries.length - 1);
  const currentPath = listing?.path ?? null;
  const intent = agentAddProjectIntent({
    currentPath,
    hasListing: listing !== null,
    projectRootPaths,
    status,
  });
  const intentReason = agentAddProjectIntentReason(intent);
  const actionLabel = agentAddProjectActionLabel(intent);

  const openInFinder = useCallback(() => {
    if (currentPath === null) return;
    void gateway.revealDirectory(currentPath).catch((error: unknown) => {
      onNotice?.(boundedNotice(error));
    });
  }, [currentPath, gateway, onNotice]);

  const commitKind = intent.kind;
  const commitRootPath = intent.kind === "blocked" ? null : intent.rootPath;
  const commit = useCallback(() => {
    if (commitRootPath === null) return;
    if (commitKind === "openExisting") {
      onOpenExisting(commitRootPath);
      return;
    }
    onAdd(commitRootPath);
  }, [commitKind, commitRootPath, onAdd, onOpenExisting]);

  const openHighlighted = useCallback(() => {
    const entry = visibleEntries[boundedIndex];
    if (entry === undefined) return;
    descend(entry.name);
  }, [boundedIndex, descend, visibleEntries]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          commit();
          return;
        }
        openHighlighted();
        return;
      }
      if (event.key === "Backspace") {
        if (query !== "") return;
        event.preventDefault();
        ascend();
        return;
      }
      if (visibleEntries.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % visibleEntries.length);
        return;
      }
      if (event.key !== "ArrowUp") return;
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + visibleEntries.length) % visibleEntries.length);
    },
    [ascend, commit, onClose, openHighlighted, query, visibleEntries.length],
  );

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Add project"
        className="quick-open agent-add-project"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agent-add-project__path">
          <button
            aria-label="Go back"
            className="agent-iconbutton agent-add-project__back"
            disabled={!browser.canGoBack}
            onClick={goBack}
            title="Go back"
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={15} />
          </button>
          <FolderOpen aria-hidden="true" size={15} />
          <span className="agent-add-project__path-value" title={currentPath ?? undefined}>
            {directoryDisplayPath(currentPath ?? "", browser.homePath)}
          </span>
        </div>

        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={
              boundedIndex >= 0 ? `${OPTION_PREFIX}${boundedIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-expanded={visibleEntries.length > 0}
            aria-label="Filter directories"
            autoFocus
            maxLength={MAX_DIRECTORY_FILTER_QUERY_CHARS}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Filter directories"
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </div>

        <div className="quick-open-results agent-add-project__results">
          <div className="search-everywhere-section-label">Directories</div>
          <div
            aria-label="Directories"
            className="agent-add-project__list"
            id={LISTBOX_ID}
            role="listbox"
          >
            {visibleEntries.map((entry, index) => (
              <button
                aria-selected={index === boundedIndex}
                className={rowClassName(index === boundedIndex)}
                id={`${OPTION_PREFIX}${index}`}
                key={entry.name}
                onClick={() => descend(entry.name)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <EntryGlyph entry={entry} />
                <span>
                  <strong>{entry.name}</strong>
                </span>
              </button>
            ))}
          </div>
          {status === "loading" && <p className="quick-open-state">Loading…</p>}
          {status === "error" && browser.error !== null && (
            <p className="quick-open-state agent-add-project__error">
              <span>{browser.error}</span>
              <button className="agent-linkbutton" onClick={reload} type="button">
                Retry
              </button>
            </p>
          )}
          {hiddenByRenderCap > 0 && (
            <p className="agent-add-project__note">
              {hiddenByRenderCap} more not shown, refine the filter
            </p>
          )}
          {listing?.truncated === true && (
            <p className="agent-add-project__note">
              Showing the first {listing.entries.length} entries
            </p>
          )}
        </div>

        <div className="agent-add-project__options">
          <label className="agent-add-project__toggle">
            <input
              checked={showHidden}
              onChange={(event) => setShowHidden(event.currentTarget.checked)}
              type="checkbox"
            />
            Show hidden
          </label>
          {intentReason !== null && (
            <span className="agent-add-project__reason" id={REASON_ID}>
              {intentReason}
            </span>
          )}
        </div>

        <div className="palette-footer agent-add-project__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌫</kbd> up
          </span>
          <span>
            <kbd>⌘↵</kbd> {intent.kind === "openExisting" ? "open project" : "add"}
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="agent-add-project__spacer" />
          <button
            className="agent-linkbutton"
            disabled={currentPath === null}
            onClick={openInFinder}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={13} />
            Open in Finder
          </button>
          <button
            aria-describedby={intentReason === null ? undefined : REASON_ID}
            className="agent-add-project__add"
            disabled={intent.kind === "blocked"}
            onClick={commit}
            type="button"
          >
            {actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function EntryGlyph({ entry }: { readonly entry: DirectoryEntry }) {
  if (entry.kind === "symlink") return <Link aria-hidden="true" size={15} />;
  return <Folder aria-hidden="true" size={15} />;
}

function rowClassName(active: boolean): string {
  const base = "quick-open-result agent-add-project__row";
  return active ? `${base} active` : base;
}

function boundedNotice(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_NOTICE_CHARS);
}
