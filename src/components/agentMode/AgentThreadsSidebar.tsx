import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AgentOverflowRow,
  AgentProjectSection,
  type ThreadListHandlers,
} from "./AgentThreadsSidebarGroups";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";
import {
  AGENT_THREAD_STATUS_FILTERS,
  MAX_AGENT_THREAD_FILTER_CHARS,
  agentThreadListQuery,
  agentThreadListQueryActive,
  agentThreadStatusCounts,
  agentThreadStatusFilterLabel,
  applyAgentThreadListQuery,
  clipAgentThreadFilterText,
  visibleAgentThreadIds,
  type AgentProjectGroup,
  type AgentThreadStatusFilter,
} from "./agentModePresentation";

export interface AgentThreadsSidebarProps {
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly collapsedProjectRootKeys: ReadonlySet<string>;
  readonly collapsedRepositoryRoots: ReadonlySet<string>;
  readonly expandedArchivedRoots: ReadonlySet<string>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly selectedThreadId: string | null;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  onToggleProject(projectRootKey: string): void;
  onToggleGroup(repositoryRoot: string): void;
  onToggleArchived(repositoryRoot: string): void;
  onSelectThread(threadId: string): void;
  onTogglePin(threadId: string): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}

export function AgentThreadsSidebar({
  collapsedProjectRootKeys,
  collapsedRepositoryRoots,
  expandedArchivedRoots,
  groups,
  liveTaskCount,
  maxConcurrentAgentTasks,
  onNewThread,
  onPruneOrphans,
  onReleaseProject,
  onRemoveOrphan,
  onSelectThread,
  onToggleArchived,
  onToggleGroup,
  onToggleProject,
  onTogglePin,
  onTrustProject,
  overflowRootPaths,
  selectedThreadId,
}: AgentThreadsSidebarProps) {
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentThreadStatusFilter>("all");
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectThread = useThreadCallback(onSelectThread);
  const togglePin = useThreadCallback(onTogglePin);

  const deferredText = useDeferredValue(filterText);
  const query = useMemo(
    () => agentThreadListQuery(deferredText, statusFilter),
    [deferredText, statusFilter],
  );
  const filtering = agentThreadListQueryActive(query);
  const visibleGroups = useMemo(() => applyAgentThreadListQuery(groups, query), [groups, query]);
  const statusOptions = useMemo(() => {
    const matched = applyAgentThreadListQuery(groups, agentThreadListQuery(deferredText, "all"));
    const counts = agentThreadStatusCounts(matched);
    return AGENT_THREAD_STATUS_FILTERS.map((filter) =>
      agentPickerOption(filter, agentThreadStatusFilterLabel(filter), null, null, counts[filter]),
    );
  }, [deferredText, groups]);
  const visibleThreadIds = useMemo(
    () =>
      visibleAgentThreadIds(
        visibleGroups,
        collapsedProjectRootKeys,
        collapsedRepositoryRoots,
        expandedArchivedRoots,
      ),
    [collapsedProjectRootKeys, collapsedRepositoryRoots, expandedArchivedRoots, visibleGroups],
  );
  const focusedThreadId = rovingThreadId(focusRequest, selectedThreadId, visibleThreadIds);

  const clearFilters = useCallback(() => {
    setFilterText("");
    setStatusFilter("all");
  }, []);

  const moveFocus = useCallback((threadId: string | undefined) => {
    if (threadId === undefined) return;
    setFocusRequest(threadId);
    focusRow(listRef.current, threadId);
  }, []);

  const handlers = useMemo<ThreadListHandlers>(
    () => ({
      expandedArchivedRoots,
      focusedThreadId,
      onNewThread,
      onPruneOrphans,
      onRemoveOrphan,
      onSelectThread: selectThread,
      onToggleArchived,
      onTogglePin: togglePin,
      selectedThreadId,
    }),
    [
      expandedArchivedRoots,
      focusedThreadId,
      onNewThread,
      onPruneOrphans,
      onRemoveOrphan,
      onToggleArchived,
      selectThread,
      selectedThreadId,
      togglePin,
    ],
  );

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
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
        filterRef.current?.focus();
        return;
      }
      if (focusedThreadId === null) return;
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

  const handleFilterKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clearFilters();
    },
    [clearFilters],
  );

  return (
    <aside aria-label="Agent threads" className="agent-rail">
      <header className="agent-rail__head">
        <h1 className="agent-rail__title">Threads</h1>
        <span className="agent-rail__count agent-num">
          {liveTaskCount}/{maxConcurrentAgentTasks} running
        </span>
      </header>

      <div className="agent-rail__filters">
        <input
          aria-label="Filter threads"
          className="agent-rail__filter"
          maxLength={MAX_AGENT_THREAD_FILTER_CHARS}
          onChange={(event) => setFilterText(clipAgentThreadFilterText(event.target.value))}
          onKeyDown={handleFilterKeyDown}
          placeholder="Filter threads"
          ref={filterRef}
          type="text"
          value={filterText}
        />
        <AgentPickerMenu
          align="end"
          describedBy={null}
          disabled={false}
          id="agent-rail-status"
          label="Filter threads by status"
          onChange={(value) => setStatusFilter(parseStatusFilter(value))}
          options={statusOptions}
          prefix="Status"
          tone={null}
          value={statusFilter}
        />
      </div>

      <div
        aria-label="Thread list"
        className="agent-rail__groups"
        onKeyDown={handleListKeyDown}
        ref={listRef}
        role="list"
      >
        {groups.length === 0 && (
          <p className="agent-rail__empty">No Git repository was detected in this workspace.</p>
        )}
        {groups.length > 0 && visibleGroups.length === 0 && (
          <div className="agent-rail__nomatch">
            <p className="agent-rail__empty">No threads match</p>
            <button className="agent-linkbutton" onClick={clearFilters} type="button">
              Clear filters
            </button>
          </div>
        )}
        {visibleGroups.map((group) => (
          <AgentProjectSection
            collapsed={collapsedProjectRootKeys.has(group.projectRootKey)}
            collapsedRepositoryRoots={collapsedRepositoryRoots}
            group={group}
            handlers={handlers}
            key={group.projectRootKey}
            onReleaseProject={onReleaseProject}
            onToggleGroup={onToggleGroup}
            onToggleProject={onToggleProject}
            onTrustProject={onTrustProject}
          />
        ))}
        {!filtering && overflowRootPaths.length > 0 && (
          <AgentOverflowRow rootPaths={overflowRootPaths} />
        )}
      </div>
    </aside>
  );
}

function useThreadCallback(handler: (threadId: string) => void): (threadId: string) => void {
  const ref = useRef(handler);

  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  return useCallback((threadId: string) => ref.current(threadId), []);
}

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

function focusRow(list: HTMLDivElement | null, threadId: string): void {
  const rows = list?.querySelectorAll<HTMLElement>("[data-thread-id]");
  for (const row of Array.from(rows ?? [])) {
    if (row.dataset.threadId !== threadId) continue;
    row.focus();
    return;
  }
}

function parseStatusFilter(value: string): AgentThreadStatusFilter {
  const match = AGENT_THREAD_STATUS_FILTERS.find((filter) => filter === value);
  return match ?? "all";
}
