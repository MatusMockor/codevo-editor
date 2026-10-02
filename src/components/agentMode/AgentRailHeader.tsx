import { useCallback, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { FolderPlus, Search, SquarePen, X } from "lucide-react";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import { MAX_THREAD_SEARCH_QUERY_CHARS } from "../../domain/agentThreadSearch";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { IconButton } from "../../ui/foundation/IconButton";
import type { AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";
import type { AgentProjectGroup } from "./agentModePresentation";
import { AgentProjectSwitcher } from "./AgentProjectSwitcher";
import { agentNewThreadTooltip } from "./agentNewThreadRequest";
import { defaultAgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";
import {
  agentRailDetachedThreadCount,
  agentRailNewThreadTarget,
  agentRailOrphanCount,
  agentRailScopeEntryFor,
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
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly searchActiveDescendant: string | null;
  readonly newThreadTitle?: string;
  readonly projectFocus: AgentRailProjectFocus;
  onShowAllProjects(): void;
  onSwitchProject(projectRootKey: string): void;
  onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onNewThread(shiftKey: boolean): void;
  onAddProject(): void;
}

export function AgentRailHeader({
  addProjectAvailable,
  groups,
  newThreadTitle,
  onAddProject,
  onNewThread,
  onSearchKeyDown,
  onShowAllProjects,
  onSwitchProject,
  overflowRootPaths,
  projectFocus,
  scope,
  scopeEntries,
  search,
  searchActiveDescendant,
  searchRef,
}: AgentRailHeaderProps) {
  const newThreadTarget = agentRailNewThreadTarget(scope, scopeEntries);
  const orphanCount = agentRailOrphanCount(groups);
  const detachedCount = agentRailDetachedThreadCount(groups);
  const defaultShortcuts = defaultAgentPanelLayoutShortcuts();
  const activeEntry =
    scope === null ? null : agentRailScopeEntryFor(scopeEntries, scope.projectRootKey);
  const fallbackNewThreadTitle = agentNewThreadTooltip({
    shortcut: defaultShortcuts.newThread,
    pickerShortcut: defaultShortcuts.newThreadIn ?? "",
    projectLabel: activeEntry?.label ?? null,
    projectCount: scopeEntries.length,
  });

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
        <AgentProjectSwitcher
          activeEntry={activeEntry}
          entries={scopeEntries}
          focus={projectFocus}
          onSelectAll={onShowAllProjects}
          onSelectProject={onSwitchProject}
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
          onClick={(event: MouseEvent<HTMLButtonElement>) => onNewThread(event.shiftKey)}
          title={newThreadTitle ?? fallbackNewThreadTitle}
        />
      </div>
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
