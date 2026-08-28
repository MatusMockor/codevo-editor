import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { PanelLeftClose, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentThreadSearchMatch } from "../../domain/agentThreadSearch";
import { AgentRailHeader } from "./AgentRailHeader";
import { AgentProviderRailFooter } from "./AgentProviderRailFooter";
import { AgentUsagePanel } from "./AgentUsagePanel";
import { useJumpHints, useStableCallback } from "./agentRailHooks";
import { AgentThreadList } from "./AgentThreadList";
import { AgentThreadSearchResults } from "./AgentThreadSearchResults";
import { agentThreadDisplayTitle, type AgentProjectGroup } from "./agentModePresentation";
import {
  ARCHIVED_PAGE_COUNT,
  agentJumpSlots,
  agentRailEmptyState,
  agentRailProjectLabels,
  agentRailSections,
  agentRailViews,
  agentThreadRevealForMatch,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
  type AgentRailScope,
  type AgentRailScopeEntry,
  type AgentRailSections,
  type AgentThreadMenuCommand,
  type AgentThreadRevealRequest,
} from "./agentSidebarPresentation";

export const SEARCH_LISTBOX_ID = "agent-rail-search-results";
export const SEARCH_OPTION_PREFIX = "agent-rail-search-result-";
const EMPTY_JUMP_LABELS: ReadonlyMap<string, string> = new Map();
const EMPTY_MATCHES: ReadonlyArray<AgentThreadSearchMatch> = [];
const EMPTY_TITLES: ReadonlyMap<string, string> = new Map();

export interface AgentThreadsSidebarProps {
  readonly addProjectAvailable: boolean;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly search: AgentThreadSearchSurface;
  readonly scope: AgentRailScope;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly selectedThreadId: string | null;
  readonly providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>>;
  readonly providerManagement: AgentProviderManagementSurface;
  onOpenProviderSettings(): void;
  onOpenSourceControl(): void;
  onCollapseSidebar?(): void;
  onSelectThread(threadId: string, reveal?: AgentThreadRevealRequest): void;
  onTogglePin(threadId: string): void;
  onChangeScope(scope: AgentRailScope): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onAddProject(): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export const AgentThreadsSidebar = memo(function AgentThreadsSidebar({
  addProjectAvailable,
  groups,
  onAddProject,
  onChangeScope,
  onCollapseSidebar,
  onNewThread,
  onProjectCommand,
  providerEnabled,
  providerManagement,
  onOpenProviderSettings,
  onOpenSourceControl,
  onReleaseProject,
  onSelectThread,
  onThreadMenuCommand,
  onTogglePin,
  onTrustProject,
  overflowRootPaths,
  scope,
  scopeEntries,
  search,
  selectedThreadId,
}: AgentThreadsSidebarProps) {
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedShown, setArchivedShown] = useState(ARCHIVED_PAGE_COUNT);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const jumpHints = useJumpHints();
  const railRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const usageDialogRef = useRef<HTMLDivElement | null>(null);
  const usageButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeUsage = useCallback(() => {
    setUsageOpen(false);
    usageButtonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const trigger = usageButtonRef.current;
    return () => {
      if (rail?.contains(document.activeElement) !== true) return;
      queueMicrotask(() => focusUsageSuccessor(trigger));
    };
  }, []);

  const selectThread = useStableCallback(onSelectThread);
  const togglePin = useStableCallback(onTogglePin);
  const menuCommand = useStableCallback(onThreadMenuCommand);

  const views = useMemo(() => agentRailViews(groups), [groups]);
  const projectLabels = useMemo(() => agentRailProjectLabels(groups), [groups]);
  const usageProjectLabels = useMemo(
    () => new Map(groups.map((group) => [group.projectRootKey, group.label])),
    [groups],
  );

  useLayoutEffect(() => {
    if (!usageOpen) return;
    const dialog = usageDialogRef.current;
    const trigger = usageButtonRef.current;
    dialog?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (dialog?.contains(event.target as Node)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('button[aria-label="Open Usage"]') !== null
      ) {
        return;
      }
      closeUsage();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      if (dialog?.contains(document.activeElement) !== true) return;
      queueMicrotask(() => focusUsageSuccessor(trigger));
    };
  }, [closeUsage, usageOpen]);
  const sections = useMemo(
    () => agentRailSections(views, scope, archivedExpanded, archivedShown),
    [archivedExpanded, archivedShown, scope, views],
  );
  const empty = useMemo(
    () => agentRailEmptyState(groups, sections, scope, scopeEntries),
    [groups, scope, scopeEntries, sections],
  );
  const jumpLabels = useMemo(
    () => (jumpHints.shown ? jumpLabelsFor(sections, jumpHints.glyph) : EMPTY_JUMP_LABELS),
    [jumpHints, sections],
  );
  const visibleThreadIds = useMemo(
    () =>
      [...sections.pinned, ...sections.active, ...sections.archived].map(
        (view) => view.thread.threadId,
      ),
    [sections],
  );
  const focusedThreadId = rovingThreadId(focusRequest, selectedThreadId, visibleThreadIds);

  const moveFocus = useCallback((threadId: string | undefined) => {
    if (threadId === undefined) return;
    setFocusRequest(threadId);
    focusRow(listRef.current, threadId);
  }, []);

  const toggleArchived = useCallback(() => {
    setArchivedExpanded((current) => !current);
    setArchivedShown(ARCHIVED_PAGE_COUNT);
  }, []);

  const showMoreArchived = useCallback(() => {
    setArchivedShown((current) => current + ARCHIVED_PAGE_COUNT);
  }, []);

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;
      if (visibleThreadIds.length === 0) return;
      const index = focusedThreadId === null ? -1 : visibleThreadIds.indexOf(focusedThreadId);
      const target = nextThreadIndex(event.key, index, visibleThreadIds.length);
      if (target !== null) {
        event.preventDefault();
        moveFocus(visibleThreadIds[target]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (focusedThreadId === null) return;
      if (!isThreadRow(event.target, focusedThreadId)) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectThread(focusedThreadId);
        return;
      }
      if (event.key !== "p" && event.key !== "P") return;
      event.preventDefault();
      togglePin(focusedThreadId);
    },
    [focusedThreadId, moveFocus, selectThread, togglePin, visibleThreadIds],
  );

  const matches = search.result?.matches ?? EMPTY_MATCHES;
  const [highlightedHit, setHighlightedHit] = useState(0);
  const activeHit = matches.length === 0 ? 0 : Math.min(highlightedHit, matches.length - 1);
  const searchActive = search.active;
  const titles = useMemo(
    () =>
      searchActive
        ? new Map(views.map((view) => [view.thread.threadId, agentThreadDisplayTitle(view.thread)]))
        : EMPTY_TITLES,
    [searchActive, views],
  );

  const selectHit = useCallback(
    (threadId: string, reveal: AgentThreadRevealRequest | null) => {
      onSelectThread(threadId, reveal ?? undefined);
      search.clear();
    },
    [onSelectThread, search],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!search.active || matches.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlightedHit((activeHit + step + matches.length) % matches.length);
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const hit = matches[activeHit];
      if (hit === undefined) return;
      selectHit(hit.threadId, agentThreadRevealForMatch(search.query, hit));
    },
    [activeHit, matches, search.active, search.query, selectHit],
  );

  return (
    <aside aria-label="Agent threads" className="agent-rail" ref={railRef}>
      <div className="agent-rail__chrome">
        <button
          aria-expanded="true"
          aria-label="Collapse sidebar"
          className="agent-iconbutton"
          onClick={() => onCollapseSidebar?.()}
          title="Collapse sidebar (⌘B)"
          type="button"
        >
          <PanelLeftClose aria-hidden="true" size={16} />
        </button>
      </div>
      <AgentRailHeader
        addProjectAvailable={addProjectAvailable}
        groups={groups}
        onAddProject={onAddProject}
        onChangeScope={onChangeScope}
        onNewThread={onNewThread}
        onProjectCommand={onProjectCommand}
        onReleaseProject={onReleaseProject}
        onTrustProject={onTrustProject}
        overflowRootPaths={overflowRootPaths}
        scope={scope}
        scopeEntries={scopeEntries}
        onSearchKeyDown={handleSearchKeyDown}
        search={search}
        searchActiveDescendant={
          search.active && matches.length > 0 ? `${SEARCH_OPTION_PREFIX}${activeHit}` : null
        }
        searchRef={searchRef}
      />
      <div className="agent-rail__scroll" onKeyDown={handleListKeyDown} ref={listRef}>
        {search.active ? (
          <AgentThreadSearchResults
            activeIndex={activeHit}
            documentsTruncated={search.result?.documentsTruncated ?? false}
            listboxId={SEARCH_LISTBOX_ID}
            matches={matches}
            onHighlight={setHighlightedHit}
            onSelect={selectHit}
            optionPrefix={SEARCH_OPTION_PREFIX}
            pending={search.pending}
            query={search.query}
            titles={titles}
            truncated={search.result?.truncated ?? false}
          />
        ) : (
          <AgentThreadList
            archivedExpanded={archivedExpanded}
            empty={empty}
            focusedThreadId={focusedThreadId}
            jumpLabels={jumpLabels}
            onSelectThread={selectThread}
            onShowMoreArchived={showMoreArchived}
            onThreadMenuCommand={menuCommand}
            onToggleArchived={toggleArchived}
            onTogglePin={togglePin}
            projectLabels={projectLabels}
            sections={sections}
            selectedThreadId={selectedThreadId}
          />
        )}
      </div>
      <AgentProviderRailFooter
        management={providerManagement}
        onOpenSourceControl={onOpenSourceControl}
        onOpenSettings={onOpenProviderSettings}
        onOpenUsage={() => (usageOpen ? closeUsage() : setUsageOpen(true))}
        providerEnabled={providerEnabled}
        usageButtonRef={usageButtonRef}
        usageOpen={usageOpen}
      />
      {usageOpen
        ? createPortal(
            <div className="agent-usage-layer">
              <div
                aria-label="Usage details"
                className="agent-usage-popover"
                id="agent-usage-panel-dialog"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  closeUsage();
                }}
                ref={usageDialogRef}
                role="dialog"
                tabIndex={-1}
              >
                <button
                  aria-label="Close Usage"
                  className="agent-iconbutton agent-usage-popover__close"
                  onClick={closeUsage}
                  title="Close Usage"
                  type="button"
                >
                  <X aria-hidden="true" size={14} />
                </button>
                <AgentUsagePanel
                  projectLabels={usageProjectLabels}
                  threads={views.map((view) => view.thread)}
                />
              </div>
            </div>,
            document.querySelector(".app-shell") ?? document.body,
          )
        : null}
    </aside>
  );
});

function rovingThreadId(
  request: string | null,
  selected: string | null,
  visible: ReadonlyArray<string>,
): string | null {
  if (request !== null && visible.includes(request)) return request;
  if (selected !== null && visible.includes(selected)) return selected;
  return visible[0] ?? null;
}

function nextThreadIndex(key: string, index: number, length: number): number | null {
  if (key === "ArrowDown") return Math.min(index + 1, length - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

function jumpLabelsFor(sections: AgentRailSections, glyph: string): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const [threadId, slot] of agentJumpSlots(sections)) labels.set(threadId, `${glyph}${slot}`);
  return labels;
}

function isThreadRow(target: EventTarget, threadId: string): boolean {
  return target instanceof HTMLElement && target.dataset.threadId === threadId;
}

function focusRow(list: HTMLDivElement | null, threadId: string): void {
  const rows = list?.querySelectorAll<HTMLElement>("[data-thread-id]");
  for (const row of Array.from(rows ?? [])) {
    if (row.dataset.threadId !== threadId) continue;
    row.focus();
    return;
  }
}

function focusUsageSuccessor(trigger: HTMLButtonElement | null): void {
  if (isConnectedVisibleButton(trigger)) {
    trigger.focus();
    return;
  }
  const expand = document.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]');
  if (isConnectedVisibleButton(expand)) expand.focus();
}

function isConnectedVisibleButton(button: HTMLButtonElement | null): button is HTMLButtonElement {
  if (button === null || !button.isConnected || button.disabled || button.hidden) return false;
  if (button.closest('[hidden], [aria-hidden="true"]') !== null) return false;
  const style = getComputedStyle(button);
  return style.display !== "none" && style.visibility !== "hidden";
}
