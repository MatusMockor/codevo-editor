import { AgentHistoryCatalog } from "./AgentHistoryCatalog";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PanelLeftClose } from "lucide-react";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import type { RemoteAddProjectPendingClone } from "../../application/useRemoteAddProject";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentThreadSearchMatch } from "../../domain/agentThreadSearch";
import {
  agentThreadBulkOwnerKey,
  type AgentThreadBulkAction,
  type AgentThreadBulkCommand,
} from "../../domain/agentThreadBulkAction";
import { detectKeymapPlatform } from "../../domain/keymap";
import {
  listSelectionGesture,
  type ListSelectionModifiers,
  type ListSelectionOwner,
} from "../../domain/listSelection";
import { IconButton } from "../../ui/foundation/IconButton";
import { TopBar } from "../../ui/shell/TopBar";
import { COLLAPSE_SIDEBAR_LABEL } from "./AgentSidebarReveal";
import {
  agentControlTooltip,
  defaultAgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";
import { AgentRailCloneRow } from "./remoteAddProject/AgentRailCloneRow";
import { AgentRailHeader } from "./AgentRailHeader";
import { AgentRowServerNamesContext, useAgentRowServerNames } from "./agentRowServerNamesContext";
import { AgentProviderRailFooter } from "./AgentProviderRailFooter";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentTurnLogFactsSource } from "../../application/agentTurnLogStatusStore";
import { useJumpHints, useStableCallback } from "./agentRailHooks";
import {
  agentRailFilterKey,
  agentRailFilterLabel,
  agentThreadsInFilter,
  type AgentRailFilter,
} from "./agentRailFilter";
import { AgentThreadList } from "./AgentThreadList";
import {
  focusRow,
  isThreadRow,
  jumpLabelsFor,
  nextThreadIndex,
  rovingThreadId,
} from "./agentThreadListNavigation";
import "./agentSidebar.css";
import { AgentThreadSelectionBar } from "./AgentThreadSelectionBar";
import { useAgentThreadSelection } from "./useAgentThreadSelection";
import {
  AgentThreadSearchResults,
  type AgentThreadSearchResultRow,
} from "./AgentThreadSearchResults";
import { agentThreadDisplayTitle, type AgentProjectGroup } from "./agentModePresentation";
import {
  agentRailEmptyState,
  agentRailProjectLabels,
  agentRowProjectLabel,
  agentRailSections,
  agentRailViews,
  agentThreadRevealForMatch,
  type AgentRailScope,
  type AgentRailScopeEntry,
  type AgentThreadMenuCommand,
  type AgentThreadRevealRequest,
} from "./agentSidebarPresentation";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";

export const SEARCH_LISTBOX_ID = "agent-rail-search-results";
export const SEARCH_OPTION_PREFIX = "agent-rail-search-result-";
const EMPTY_JUMP_LABELS: ReadonlyMap<string, string> = new Map();
const EMPTY_MATCHES: ReadonlyArray<AgentThreadSearchMatch> = [];
const EMPTY_TITLES: ReadonlyMap<string, string> = new Map();
const EMPTY_SEARCH_ROWS: ReadonlyMap<string, AgentThreadSearchResultRow> = new Map();
const NO_BULK_COMMAND: (command: AgentThreadBulkCommand) => void = () => undefined;
const MAX_AGENT_RAIL_FACTS_REQUESTS = 8;
export interface AgentThreadsSidebarProps {
  readonly catalog?: AgentHistoryCatalogSurface;
  readonly addProjectAvailable: boolean;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly search: AgentThreadSearchSurface;
  readonly scope: AgentRailScope | null;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly selectedThreadId: string | null;
  readonly providerEnabled: Readonly<Record<"claudeCode" | "codex", boolean>>;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly pendingClones?: ReadonlyArray<RemoteAddProjectPendingClone>;
  readonly pendingClone?: RemoteAddProjectPendingClone | null;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly turnLog?: AgentTurnLogFactsSource | null;
  onOpenPendingClone?(id?: string): void;
  onCancelPendingClone?(id?: string): void;
  onDismissPendingClone?(id?: string): void;
  onOpenProviderSettings(): void;
  onOpenSourceControl(): void;
  onOpenUsage?(): void;
  onCollapseSidebar?(): void;
  readonly collapseShortcut?: string | null;
  readonly footerActivity?: ReactNode;
  onSelectThread(threadId: string, reveal?: AgentThreadRevealRequest): void;
  onTogglePin(threadId: string): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  onThreadBulkCommand?(command: AgentThreadBulkCommand): void;
  onNewThread(shiftKey: boolean): void;
  onAddProject(): void;
  readonly railFilter: AgentRailFilter;
  readonly pendingInteractions?: ReadonlyMap<string, AgentPendingInteraction>;
  onChangeFilter(filter: AgentRailFilter): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export const AgentThreadsSidebar = memo(function AgentThreadsSidebar({
  catalog,
  addProjectAvailable,
  evidenceOf,
  groups,
  onAddProject,
  onCancelPendingClone,
  onChangeFilter,
  onCollapseSidebar,
  collapseShortcut = null,
  footerActivity = null,
  onDismissPendingClone,
  onNewThread,
  onProjectCommand,
  pendingClone = null,
  pendingClones,
  onOpenPendingClone,
  providerEnabled,
  providerManagement,
  onOpenProviderSettings,
  onOpenSourceControl,
  onOpenUsage,
  onSelectThread,
  onThreadBulkCommand,
  onThreadMenuCommand,
  onTogglePin,
  overflowRootPaths,
  pendingInteractions,
  railFilter,
  scope,
  scopeEntries,
  search,
  selectedThreadId,
  turnLog = null,
}: AgentThreadsSidebarProps) {
  const [settledExpanded, setSettledExpanded] = useState(false);
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const jumpHints = useJumpHints();
  const railRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const rail = railRef.current;
    return () => {
      if (rail?.contains(document.activeElement) !== true) return;
      queueMicrotask(focusExpandSidebar);
    };
  }, []);

  const selectThread = useStableCallback(onSelectThread);
  const togglePin = useStableCallback(onTogglePin);
  const menuCommand = useStableCallback(onThreadMenuCommand);

  const serverNames = useAgentRowServerNames();
  const views = useMemo(() => agentRailViews(groups), [groups]);
  const projectLabels = useMemo(() => agentRailProjectLabels(groups), [groups]);

  const [organizationNow, setOrganizationNow] = useState(() => Date.now());
  useEffect(() => {
    const now = Date.now();
    const future = views
      .map((view) => view.thread.snoozedUntil ?? 0)
      .filter((until) => until > now);
    if (future.length === 0) return;
    const next = future.reduce(
      (minimum, until) => Math.min(minimum, until),
      Number.MAX_SAFE_INTEGER,
    );
    const timer = setTimeout(
      () => setOrganizationNow(Date.now()),
      Math.min(2_147_483_647, Math.max(1, next - now)),
    );
    return () => clearTimeout(timer);
  }, [views, organizationNow]);
  const filteredViews = useMemo(
    () => agentThreadsInFilter(views, railFilter, scopeEntries),
    [railFilter, scopeEntries, views],
  );
  const sections = useMemo(
    () => agentRailSections(filteredViews, Math.max(organizationNow, Date.now())),
    [filteredViews, organizationNow],
  );
  useEffect(() => {
    if (turnLog === null) return;
    const visible = [
      ...sections.pinned,
      ...sections.active,
      ...(snoozedExpanded ? (sections.snoozed ?? []) : []),
      ...(settledExpanded ? (sections.settled ?? []) : []),
    ];
    for (const view of visible.slice(0, MAX_AGENT_RAIL_FACTS_REQUESTS)) {
      void turnLog.ensureThreadFacts(
        view.thread.threadId,
        view.thread.turns.map((turn) => turn.turnId),
      );
    }
  }, [sections, settledExpanded, snoozedExpanded, turnLog]);
  const empty = useMemo(
    () =>
      agentRailEmptyState(
        groups,
        sections,
        railFilter.kind === "all" ? null : agentRailFilterLabel(railFilter, scopeEntries),
      ),
    [groups, railFilter, scopeEntries, sections],
  );
  const jumpLabels = useMemo(
    () => (jumpHints.shown ? jumpLabelsFor(sections, jumpHints.glyph) : EMPTY_JUMP_LABELS),
    [jumpHints, sections],
  );
  const visibleThreadIds = useMemo(
    () =>
      [
        ...sections.pinned,
        ...sections.active,
        ...(snoozedExpanded ? (sections.snoozed ?? []) : []),
        ...(settledExpanded ? (sections.settled ?? []) : []),
      ].map((view) => view.thread.threadId),
    [sections, settledExpanded, snoozedExpanded],
  );
  const focusedThreadId = rovingThreadId(focusRequest, selectedThreadId, visibleThreadIds);

  const platform = useMemo(() => detectKeymapPlatform(), []);
  const threadOwners = useMemo(
    () =>
      new Map(
        views.map((view) => [view.thread.threadId, agentThreadBulkOwnerKey(view.thread.owner)]),
      ),
    [views],
  );
  const selection = useAgentThreadSelection(
    agentRailFilterKey(railFilter),
    visibleThreadIds,
    threadOwners,
  );
  const bulkCommand = useStableCallback(onThreadBulkCommand ?? NO_BULK_COMMAND);

  const moveFocus = useCallback((threadId: string | undefined) => {
    if (threadId === undefined) return;
    setFocusRequest(threadId);
    focusRow(listRef.current, threadId);
  }, []);

  const rowSelect = useStableCallback((threadId: string, modifiers: ListSelectionModifiers) => {
    const gesture = listSelectionGesture(modifiers, platform);
    selection.apply(threadId, gesture);
    if (gesture !== "open") return;
    selectThread(threadId);
  });

  const runBulkAction = useCallback(
    (action: AgentThreadBulkAction, capturedOwner: ListSelectionOwner) => {
      const commit = selection.commit(capturedOwner);
      selection.clear();
      if (commit.kind === "ownerChanged") {
        bulkCommand({ kind: "stale", action });
        return;
      }
      bulkCommand({
        kind: "apply",
        request: {
          action,
          threadIds: commit.ids,
          missingIds: commit.missingIds,
          ownerKeys: commit.ownerKeys,
        },
      });
    },
    [bulkCommand, selection],
  );

  const toggleSettled = useCallback(() => setSettledExpanded((current) => !current), []);
  const toggleSnoozed = useCallback(() => setSnoozedExpanded((current) => !current), []);

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      if (event.target instanceof HTMLInputElement) return;
      if (visibleThreadIds.length === 0) return;
      const fromRow = focusedThreadId !== null && isThreadRow(event.target, focusedThreadId);
      const index = focusedThreadId === null ? -1 : visibleThreadIds.indexOf(focusedThreadId);
      const target = nextThreadIndex(event.key, index, visibleThreadIds.length);
      if (target !== null) {
        event.preventDefault();
        const nextThreadId = visibleThreadIds[target];
        moveFocus(nextThreadId);
        if (!fromRow || nextThreadId === undefined) return;
        selection.apply(nextThreadId, event.shiftKey ? "extend" : "open");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (selection.hasMarkBeyond(selectedThreadId)) {
          selection.clear();
          return;
        }
        searchRef.current?.focus();
        return;
      }
      if (focusedThreadId === null || !fromRow) return;
      if (event.key === " ") {
        event.preventDefault();
        selection.apply(focusedThreadId, "toggle");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selection.apply(focusedThreadId, "open");
        selectThread(focusedThreadId);
        return;
      }
      if (event.key !== "p" && event.key !== "P") return;
      event.preventDefault();
      togglePin(focusedThreadId);
    },
    [
      focusedThreadId,
      moveFocus,
      selectThread,
      selectedThreadId,
      selection,
      togglePin,
      visibleThreadIds,
    ],
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

  const searchRows = useMemo(
    () =>
      searchActive
        ? new Map(
            views.map((view) => [
              view.thread.threadId,
              {
                projectLabel: agentRowProjectLabel(projectLabels, view),
                updatedAtEpochMs: view.thread.updatedAtEpochMs,
              },
            ]),
          )
        : EMPTY_SEARCH_ROWS,
    [projectLabels, searchActive, views],
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
      <TopBar
        label="Sidebar"
        region="sidebar"
        trailing={
          <IconButton
            aria-expanded
            icon={<PanelLeftClose size={16} />}
            label={COLLAPSE_SIDEBAR_LABEL}
            onClick={() => onCollapseSidebar?.()}
            title={agentControlTooltip(
              COLLAPSE_SIDEBAR_LABEL,
              collapseShortcut ?? defaultAgentPanelLayoutShortcuts().sidebar,
            )}
          />
        }
      />
      <AgentRailHeader
        addProjectAvailable={addProjectAvailable}
        groups={groups}
        onAddProject={onAddProject}
        onChangeFilter={onChangeFilter}
        onNewThread={onNewThread}
        onProjectCommand={onProjectCommand}
        overflowRootPaths={overflowRootPaths}
        railFilter={railFilter}
        scope={scope}
        scopeEntries={scopeEntries}
        onSearchKeyDown={handleSearchKeyDown}
        search={search}
        searchActiveDescendant={
          search.active && matches.length > 0 ? `${SEARCH_OPTION_PREFIX}${activeHit}` : null
        }
        searchRef={searchRef}
      />
      {(pendingClones ?? (pendingClone === null ? [] : [pendingClone])).map((clone) => (
        <AgentRailCloneRow
          key={clone.id}
          clone={clone}
          onOpen={onOpenPendingClone === undefined ? undefined : () => onOpenPendingClone(clone.id)}
          onCancel={() => onCancelPendingClone?.(clone.id)}
          onDismiss={() => onDismissPendingClone?.(clone.id)}
        />
      ))}
      {!search.active && selection.count > 1 && (
        <AgentThreadSelectionBar
          onAction={runBulkAction}
          onClear={selection.clear}
          owner={selection.owner}
          selectedIds={selection.orderedIds}
        />
      )}
      <div className="agent-rail__scroll" onKeyDown={handleListKeyDown} ref={listRef}>
        {catalog !== undefined && (
          <AgentHistoryCatalog catalog={catalog} onSelect={onSelectThread} />
        )}
        {search.active ? (
          <AgentThreadSearchResults
            activeIndex={activeHit}
            appearance="sidebar"
            rows={searchRows}
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
          <AgentRowServerNamesContext.Provider value={serverNames}>
            <AgentThreadList
              settledExpanded={settledExpanded}
              snoozedExpanded={snoozedExpanded}
              onToggleSettled={toggleSettled}
              onToggleSnoozed={toggleSnoozed}
              empty={empty}
              evidenceOf={evidenceOf}
              focusedThreadId={focusedThreadId}
              jumpLabels={jumpLabels}
              markedThreadIds={selection.selectedIds}
              onSelectThread={rowSelect}
              onThreadMenuCommand={menuCommand}
              pendingInteractions={pendingInteractions}
              projectLabels={projectLabels}
              sections={sections}
              selectedThreadId={selectedThreadId}
            />
          </AgentRowServerNamesContext.Provider>
        )}
      </div>
      <AgentProviderRailFooter
        activity={footerActivity}
        management={providerManagement}
        onOpenSourceControl={onOpenSourceControl}
        onOpenSettings={onOpenProviderSettings}
        onOpenUsage={onOpenUsage}
        providerEnabled={providerEnabled}
      />
    </aside>
  );
});

function focusExpandSidebar(): void {
  const expand = document.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]');
  if (expand === null || !expand.isConnected || expand.disabled || expand.hidden) return;
  if (expand.closest('[hidden], [aria-hidden="true"]') !== null) return;
  const style = getComputedStyle(expand);
  if (style.display === "none" || style.visibility === "hidden") return;
  expand.focus();
}
