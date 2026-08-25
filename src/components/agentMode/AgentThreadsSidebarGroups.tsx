import { ChevronDown, ShieldAlert } from "lucide-react";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { AgentThreadRow } from "./AgentThreadRow";
import {
  agentProjectOriginBadge,
  agentProjectTrustNotice,
  agentThreadBands,
  type AgentProjectGroup,
  type AgentRepositoryGroup,
  type AgentThreadBand,
} from "./agentModePresentation";

export interface ThreadListHandlers {
  readonly expandedArchivedRoots: ReadonlySet<string>;
  readonly selectedThreadId: string | null;
  readonly focusedThreadId: string | null;
  onSelectThread(threadId: string): void;
  onTogglePin(threadId: string): void;
  onToggleArchived(repositoryRoot: string): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}

export function AgentProjectSection({
  collapsed,
  collapsedRepositoryRoots,
  group,
  handlers,
  onReleaseProject,
  onToggleGroup,
  onToggleProject,
  onTrustProject,
}: {
  readonly collapsed: boolean;
  readonly collapsedRepositoryRoots: ReadonlySet<string>;
  readonly group: AgentProjectGroup;
  readonly handlers: ThreadListHandlers;
  onToggleProject(projectRootKey: string): void;
  onToggleGroup(repositoryRoot: string): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
}) {
  const detached = group.kind === "detached";
  const trustNotice = detached ? null : agentProjectTrustNotice(group.trust);
  const badge = detached ? null : agentProjectOriginBadge(group.origin);
  const dispatchable = !detached && trustNotice === null;
  const flatRepo = group.singleRepo ? (group.repos[0] ?? null) : null;
  const threadCount = group.repos.reduce((total, repo) => total + repo.threads.length, 0);
  const releasable = !detached && group.origin === "closed-tab-live-tasks" && group.liveCount === 0;

  return (
    <section
      aria-label={detached ? group.label : `Project ${group.label}`}
      className={projectClassName(collapsed, detached, trustNotice !== null)}
    >
      <button
        aria-expanded={!collapsed}
        className="agent-project__head"
        onClick={() => onToggleProject(group.projectRootKey)}
        type="button"
      >
        <ChevronDown aria-hidden="true" className="agent-project__chevron" size={12} />
        <span className="agent-project__name">{group.label}</span>
        {badge && <span className="agent-project__badge">{badge}</span>}
        {group.liveCount > 0 && (
          <span className="agent-project__live agent-num">{group.liveCount} live</span>
        )}
        <span className="agent-project__count agent-num">{threadCount}</span>
      </button>

      {!collapsed && (
        <div className="agent-project__body">
          {trustNotice && (
            <div className="agent-trust">
              <ShieldAlert aria-hidden="true" className="agent-trust__icon" size={12} />
              <span className="agent-trust__text">{trustNotice}</span>
              <button
                aria-label={`Trust project ${group.label}`}
                className="agent-linkbutton"
                onClick={() => onTrustProject(group.projectRootKey)}
                type="button"
              >
                Trust to enable
              </button>
            </div>
          )}

          {group.repos.length === 0 && (
            <p className="agent-rail__empty">No Git repository was detected in this project.</p>
          )}

          {flatRepo !== null && (
            <AgentRepositoryThreads
              dispatchable={dispatchable}
              group={flatRepo}
              handlers={handlers}
              projectRootKey={group.projectRootKey}
            />
          )}

          {flatRepo === null &&
            group.repos.map((repo) => (
              <AgentRepositorySubsection
                collapsed={collapsedRepositoryRoots.has(repo.repositoryRoot)}
                dispatchable={dispatchable}
                group={repo}
                handlers={handlers}
                key={repo.repositoryRoot}
                onToggleGroup={onToggleGroup}
                projectRootKey={group.projectRootKey}
              />
            ))}

          {releasable && (
            <button
              aria-label={`Release project ${group.label}`}
              className="agent-project__release"
              onClick={() => onReleaseProject(group.projectRootKey)}
              type="button"
            >
              Release project
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function projectClassName(collapsed: boolean, detached: boolean, untrusted: boolean): string {
  const classes = ["agent-project"];
  if (collapsed) classes.push("agent-project--closed");
  if (detached) classes.push("agent-project--detached");
  if (untrusted) classes.push("agent-project--untrusted");
  return classes.join(" ");
}

function AgentRepositorySubsection({
  collapsed,
  dispatchable,
  group,
  handlers,
  onToggleGroup,
  projectRootKey,
}: {
  readonly collapsed: boolean;
  readonly dispatchable: boolean;
  readonly group: AgentRepositoryGroup;
  readonly handlers: ThreadListHandlers;
  readonly projectRootKey: string;
  onToggleGroup(repositoryRoot: string): void;
}) {
  const className = collapsed ? "agent-group agent-group--closed" : "agent-group";

  return (
    <section aria-label={`Repository ${group.label}`} className={className}>
      <button
        aria-expanded={!collapsed}
        className="agent-group__head"
        onClick={() => onToggleGroup(group.repositoryRoot)}
        type="button"
      >
        <ChevronDown aria-hidden="true" className="agent-group__chevron" size={12} />
        <span className="agent-group__name">{group.label}</span>
        {group.liveCount > 0 && (
          <span className="agent-group__live agent-num">{group.liveCount} live</span>
        )}
        <span className="agent-group__count agent-num">{group.threads.length}</span>
      </button>

      {!collapsed && (
        <AgentRepositoryThreads
          dispatchable={dispatchable}
          group={group}
          handlers={handlers}
          projectRootKey={projectRootKey}
        />
      )}
    </section>
  );
}

function AgentRepositoryThreads({
  dispatchable,
  group,
  handlers,
  projectRootKey,
}: {
  readonly dispatchable: boolean;
  readonly group: AgentRepositoryGroup;
  readonly handlers: ThreadListHandlers;
  readonly projectRootKey: string;
}) {
  const bands = agentThreadBands(group.threads);

  return (
    <div className="agent-group__threads">
      {bands.map((band) => (
        <AgentThreadBandSection
          band={band}
          handlers={handlers}
          key={band.attention}
          labelled={bands.length > 1}
        />
      ))}
      {group.archived.length > 0 && (
        <AgentArchivedGroup
          expanded={handlers.expandedArchivedRoots.has(group.repositoryRoot)}
          group={group}
          handlers={handlers}
        />
      )}
      {!group.repositoryResolved && (
        <p className="agent-rail__empty">
          This repository is no longer available in the current workspace.
        </p>
      )}
      {group.repositoryResolved && dispatchable && (
        <button
          className="agent-group__new"
          onClick={() => handlers.onNewThread(projectRootKey, group.repositoryRoot)}
          type="button"
        >
          + New thread
        </button>
      )}
      {group.orphans.length > 0 && (
        <AgentOrphanList
          group={group}
          onPruneOrphans={handlers.onPruneOrphans}
          onRemoveOrphan={handlers.onRemoveOrphan}
        />
      )}
    </div>
  );
}

function AgentThreadBandSection({
  band,
  handlers,
  labelled,
}: {
  readonly band: AgentThreadBand;
  readonly handlers: ThreadListHandlers;
  readonly labelled: boolean;
}) {
  return (
    <div className={`agent-band agent-band--${band.attention}`} data-attention={band.attention}>
      {labelled && <p className="agent-band__label">{band.label}</p>}
      {band.threads.map((view) => (
        <AgentThreadRow
          focused={handlers.focusedThreadId === view.thread.threadId}
          key={view.thread.threadId}
          onSelect={handlers.onSelectThread}
          onTogglePin={handlers.onTogglePin}
          selected={handlers.selectedThreadId === view.thread.threadId}
          view={view}
        />
      ))}
    </div>
  );
}

function AgentArchivedGroup({
  expanded,
  group,
  handlers,
}: {
  readonly expanded: boolean;
  readonly group: AgentRepositoryGroup;
  readonly handlers: ThreadListHandlers;
}) {
  return (
    <section
      aria-label={`Archived threads in ${group.label}`}
      className={expanded ? "agent-archived" : "agent-archived agent-archived--closed"}
    >
      <button
        aria-expanded={expanded}
        className="agent-archived__head"
        onClick={() => handlers.onToggleArchived(group.repositoryRoot)}
        type="button"
      >
        <ChevronDown aria-hidden="true" className="agent-archived__chevron" size={11} />
        <span className="agent-archived__name">Archived</span>
        <span className="agent-archived__count agent-num">{group.archived.length}</span>
      </button>
      {expanded &&
        group.archived.map((view) => (
          <AgentThreadRow
            focused={handlers.focusedThreadId === view.thread.threadId}
            key={view.thread.threadId}
            onSelect={handlers.onSelectThread}
            onTogglePin={handlers.onTogglePin}
            selected={handlers.selectedThreadId === view.thread.threadId}
            view={view}
          />
        ))}
    </section>
  );
}

export function AgentOverflowRow({ rootPaths }: { readonly rootPaths: ReadonlyArray<string> }) {
  const suffix = rootPaths.length === 1 ? "project is" : "projects are";

  return (
    <p className="agent-rail__overflow" title={rootPaths.join("\n")}>
      {rootPaths.length} more {suffix} not shown (limit {MAX_AGENT_PROJECT_ROOTS})
    </p>
  );
}

function AgentOrphanList({
  group,
  onPruneOrphans,
  onRemoveOrphan,
}: {
  readonly group: AgentRepositoryGroup;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}) {
  return (
    <section aria-label={`Orphaned worktrees in ${group.label}`} className="agent-orphans">
      <span className="agent-orphans__title">Orphaned worktrees</span>
      <p className="agent-orphans__hint">
        These agent worktrees have no thread in this session. Removing them frees the repository
        worktree limit and keeps the branches.
      </p>
      {group.orphans.map((orphan) => (
        <div className="agent-orphans__row" key={orphan.worktreePath}>
          <span className="agent-orphans__path">{orphan.worktreePath}</span>
          {orphan.branch && <span className="agent-orphans__branch">{orphan.branch}</span>}
          {orphan.prunable ? (
            <button
              aria-label={`Prune stale worktrees for ${orphan.repositoryRoot}`}
              className="agent-linkbutton"
              onClick={() => onPruneOrphans(orphan.repositoryRoot)}
              type="button"
            >
              Prune
            </button>
          ) : (
            <button
              aria-label={`Remove orphaned worktree ${orphan.worktreePath}`}
              className="agent-linkbutton"
              disabled={orphan.removing}
              onClick={() => onRemoveOrphan(orphan.worktreePath)}
              type="button"
            >
              {orphan.removing ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
