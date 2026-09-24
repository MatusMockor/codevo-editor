import { useCallback, type KeyboardEvent, type RefObject } from "react";
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
import { ALL_PROJECTS_FILTER, type AgentRailFilter } from "./agentRailFilter";
import {
  agentRailDetachedThreadCount,
  agentRailNewThreadTarget,
  agentRailOrphanCount,
  agentRailScopeFromEntry,
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
  onChangeScope(scope: AgentRailScope): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onAddProject(): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentRailHeader({
  addProjectAvailable,
  groups,
  onAddProject,
  onChangeFilter,
  onChangeScope,
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
    (entry: AgentRailScopeEntry) => {
      onChangeFilter({ kind: "project", projectRootKey: entry.projectRootKey });
      onChangeScope(agentRailScopeFromEntry(entry));
    },
    [onChangeFilter, onChangeScope],
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
        <AgentProjectFilterMenu
          entries={scopeEntries}
          filter={railFilter}
          onProjectCommand={onProjectCommand}
          onSelectAll={selectAll}
          onSelectProject={selectProject}
        />
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
          onClick={() =>
            newThreadTarget !== null &&
            onNewThread(newThreadTarget.projectRootKey, newThreadTarget.repositoryRoot)
          }
          title={
            scope === null
              ? "New thread (⌘N)"
              : `New thread in ${agentRailScopeLabel(scope, scopeEntries)} (⌘N)`
          }
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
