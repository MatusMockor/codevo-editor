import { useCallback, useMemo, type KeyboardEvent, type RefObject } from "react";
import { Search, SquarePen, X } from "lucide-react";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import { MAX_THREAD_SEARCH_QUERY_CHARS } from "../../domain/agentThreadSearch";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  agentRailNewThreadTarget,
  agentRailOrphanCount,
  agentRailScopeEntryValue,
  agentRailScopeFromEntry,
  agentRailScopeState,
  type AgentRailScope,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

export interface AgentRailHeaderProps {
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly search: AgentThreadSearchSurface;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly scope: AgentRailScope;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly searchActiveDescendant: string | null;
  onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onChangeScope(scope: AgentRailScope): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
}

export function AgentRailHeader({
  groups,
  onChangeScope,
  onNewThread,
  onReleaseProject,
  onSearchKeyDown,
  onTrustProject,
  overflowRootPaths,
  scope,
  scopeEntries,
  search,
  searchActiveDescendant,
  searchRef,
}: AgentRailHeaderProps) {
  const scopeValue = agentRailScopeEntryValue(scope);
  const scopeEntry = scopeEntries.find((entry) => entry.value === scopeValue) ?? null;
  const scopeState = agentRailScopeState(scopeEntry);
  const scopeOptions = useMemo(
    () =>
      scopeEntries.map((entry) =>
        agentPickerOption(entry.value, entry.label, null, null, scopeDetail(entry)),
      ),
    [scopeEntries],
  );
  const newThreadTarget = agentRailNewThreadTarget(scope, scopeEntries);
  const orphanCount = agentRailOrphanCount(groups, scope);

  const changeScope = useCallback(
    (value: string) => {
      const entry = scopeEntries.find((candidate) => candidate.value === value);
      if (entry === undefined) return;
      onChangeScope(agentRailScopeFromEntry(entry));
    },
    [onChangeScope, scopeEntries],
  );

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
    <div className="agent-rail__head">
      <div className="agent-rail__row">
        <div className="agent-search" data-active={search.active ? "true" : undefined}>
          <Search aria-hidden="true" className="agent-search__icon" size={16} />
          <input
            aria-activedescendant={searchActiveDescendant ?? undefined}
            aria-autocomplete="list"
            aria-controls="agent-rail-search-results"
            aria-expanded={search.active}
            aria-label="Search threads"
            className="agent-search__input"
            maxLength={MAX_THREAD_SEARCH_QUERY_CHARS}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            ref={searchRef}
            role="combobox"
            type="search"
            value={search.query}
          />
          {search.query !== "" && (
            <button
              aria-label="Clear thread search"
              className="agent-search__clear"
              onClick={() => search.clear()}
              type="button"
            >
              <X aria-hidden="true" size={12} />
            </button>
          )}
        </div>
        <button
          aria-label="New thread"
          className="agent-iconbutton"
          disabled={newThreadTarget === null}
          onClick={() =>
            newThreadTarget !== null &&
            onNewThread(newThreadTarget.projectRootKey, newThreadTarget.repositoryRoot)
          }
          title="New thread (⌘N)"
          type="button"
        >
          <SquarePen aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="agent-rail__row agent-scope">
        <AgentPickerMenu
          align="start"
          describedBy={null}
          disabled={scopeEntries.length <= 1}
          id="agent-rail-scope"
          label="Project scope"
          onChange={changeScope}
          options={scopeOptions}
          prefix={null}
          tone={null}
          value={scopeValue}
        />
      </div>
      {scopeState !== null && scopeEntry?.kind === "repository" && (
        <div className="agent-rail__row agent-scope__state">
          <span className="agent-scope__state-label">{scopeState.label}</span>
          {scopeState.action === "trust" && (
            <button
              aria-label={`Trust project ${scopeEntry.label}`}
              className="agent-linkbutton"
              onClick={() => onTrustProject(scopeEntry.projectRootKey)}
              type="button"
            >
              Trust
            </button>
          )}
          {scopeState.action === "release" && (
            <button
              aria-label={`Release project ${scopeEntry.label}`}
              className="agent-linkbutton"
              onClick={() => onReleaseProject(scopeEntry.projectRootKey)}
              type="button"
            >
              Release
            </button>
          )}
        </div>
      )}
      {orphanCount > 0 && <p className="agent-rail__note">{orphanLabel(orphanCount)}</p>}
      {overflowRootPaths.length > 0 && (
        <p className="agent-rail__note agent-rail__overflow" title={overflowRootPaths.join("\n")}>
          {overflowLabel(overflowRootPaths.length)}
        </p>
      )}
    </div>
  );
}

function scopeDetail(entry: AgentRailScopeEntry): string | null {
  return agentRailScopeState(entry)?.label ?? null;
}

function orphanLabel(count: number): string {
  return count === 1 ? "1 orphaned worktree" : `${count} orphaned worktrees`;
}

function overflowLabel(count: number): string {
  const suffix = count === 1 ? "project is" : "projects are";
  return `${count} more ${suffix} not shown (limit ${MAX_AGENT_PROJECT_ROOTS})`;
}
