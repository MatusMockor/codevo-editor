import { useCallback, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { FolderPlus, Search, SquarePen, X } from "lucide-react";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import { MAX_THREAD_SEARCH_QUERY_CHARS } from "../../domain/agentThreadSearch";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { IconButton } from "../../ui/foundation/IconButton";
import { AgentProjectFilterMenu } from "./AgentProjectFilterMenu";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  agentProjectMenuTarget,
  agentRailScopeState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { agentNewThreadTooltip } from "./agentNewThreadRequest";
import { ALL_PROJECTS_FILTER, type AgentRailFilter } from "./agentRailFilter";
import {
  agentRailDetachedThreadCount,
  agentRailNewThreadTarget,
  agentRailOrphanCount,
  agentRailScopeLabel,
  type AgentRailScope,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

export interface AgentRailHeaderProps {
  readonly addProjectAvailable: boolean;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly search: AgentThreadSearchSurface;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly scope: AgentRailScope | null;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly railFilter: AgentRailFilter;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly searchActiveDescendant: string | null;
  onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onChangeFilter(filter: AgentRailFilter): void;
  onNewThread(shiftKey: boolean): void;
  onAddProject(): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentRailHeader({
  addProjectAvailable,
  groups,
  onAddProject,
  onChangeFilter,
  onNewThread,
  onProjectCommand,
  onSearchKeyDown,
  overflowRootPaths,
  railFilter,
  scope,
  scopeEntries,
  search,
  searchActiveDescendant,
  searchRef,
}: AgentRailHeaderProps) {
  const newThreadTarget = agentRailNewThreadTarget(scope, scopeEntries);
  const orphanCount = agentRailOrphanCount(groups, railFilter);
  const detachedCount = agentRailDetachedThreadCount(groups);
  const filteredEntry =
    railFilter.kind === "project"
      ? (scopeEntries.find((entry) => entry.projectRootKey === railFilter.projectRootKey) ?? null)
      : null;
  const filteredState = headerScopeState(filteredEntry);

  const selectProject = useCallback(
    (entry: AgentRailScopeEntry) =>
      onChangeFilter({ kind: "project", projectRootKey: entry.projectRootKey }),
    [onChangeFilter],
  );
  const newThreadTitle = agentNewThreadTooltip(
    NEW_THREAD_TOOLTIP,
    scopeEntries.length,
    scope === null ? null : agentRailScopeLabel(scope, scopeEntries),
  );

  const selectAll = useCallback(() => onChangeFilter(ALL_PROJECTS_FILTER), [onChangeFilter]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") {
        onSearchKeyDown(event);
        return;
      }
      event.preventDefault();
      if (search.query === "") {
        event.currentTarget.blur();
        return;
      }
      search.clear();
    },
    [onSearchKeyDown, search],
  );

  return (
    <div className="cv-sb-head">
      <div className="cv-sb-search">
        <label className="cv-sb-search__field" data-active={search.active ? "true" : undefined}>
          <Search aria-hidden="true" size={16} />
          <input
            aria-activedescendant={searchActiveDescendant ?? undefined}
            aria-autocomplete="list"
            aria-controls="agent-rail-search-results"
            aria-expanded={search.active}
            aria-label="Search threads"
            className="cv-sb-search__input"
            maxLength={MAX_THREAD_SEARCH_QUERY_CHARS}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            ref={searchRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={search.query}
          />
          {search.query !== "" && (
            <IconButton
              className="cv-sb-search__clear"
              icon={<X size={12} />}
              label="Clear thread search"
              onClick={() => search.clear()}
              size="xs"
              title="Clear"
            />
          )}
        </label>
        <IconButton
          disabled={!addProjectAvailable}
          icon={<FolderPlus size={16} />}
          label="Add project"
          onClick={onAddProject}
        />
        <IconButton
          disabled={newThreadTarget === null}
          icon={<SquarePen size={16} />}
          label="New thread"
          onClick={(event: MouseEvent<HTMLButtonElement>) => onNewThread(event.shiftKey)}
          title={newThreadTitle}
        />
      </div>
      <div className="cv-sb-show">
        <span aria-hidden="true">Show</span>
        <AgentProjectFilterMenu
          entries={scopeEntries}
          filter={railFilter}
          onProjectCommand={onProjectCommand}
          onSelectAll={selectAll}
          onSelectProject={selectProject}
        />
      </div>
      {filteredEntry !== null && filteredState !== null && (
        <p className="cv-sb-note cv-sb-state">
          {filteredState.label}
          {filteredState.action === "release" && (
            <>
              {" · "}
              <button
                aria-label={`Release project ${filteredEntry.label}`}
                className="cv-sb-state__action"
                onClick={() => onProjectCommand(agentProjectMenuTarget(filteredEntry), "release")}
                type="button"
              >
                Release
              </button>
            </>
          )}
        </p>
      )}
      {orphanCount > 0 && <p className="cv-sb-note">{orphanLabel(orphanCount)}</p>}
      {detachedCount > 0 && <p className="cv-sb-note">{detachedLabel(detachedCount)}</p>}
      {overflowRootPaths.length > 0 && (
        <p className="cv-sb-note" title={overflowRootPaths.join("\n")}>
          {overflowLabel(overflowRootPaths.length)}
        </p>
      )}
    </div>
  );
}

const NEW_THREAD_TOOLTIP = "New thread (⌘N)";

function headerScopeState(entry: AgentRailScopeEntry | null) {
  const state = agentRailScopeState(entry);
  if (entry === null || state === null) return null;
  if (state.action === "release" || entry.trust === "untrusted") return state;
  return null;
}

function orphanLabel(count: number): string {
  return count === 1 ? "1 orphaned worktree" : `${count} orphaned worktrees`;
}

function detachedLabel(count: number): string {
  const suffix = count === 1 ? "thread from a removed project" : "threads from removed projects";
  return `${count} ${suffix} hidden`;
}

function overflowLabel(count: number): string {
  const suffix = count === 1 ? "project is" : "projects are";
  return `${count} more ${suffix} not shown (limit ${MAX_AGENT_PROJECT_ROOTS})`;
}
