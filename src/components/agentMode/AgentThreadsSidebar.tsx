import { ChevronDown, Pin, ShieldAlert } from "lucide-react";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import type { AgentTaskView } from "../../application/useAgentTasks";
import {
  agentProjectOriginBadge,
  agentProjectTrustNotice,
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTitle,
  agentThreadTone,
  type AgentProjectGroup,
  type AgentRepositoryGroup,
} from "./agentModePresentation";

export interface AgentThreadsSidebarProps {
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly collapsedProjectRootKeys: ReadonlySet<string>;
  readonly collapsedRepositoryRoots: ReadonlySet<string>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly selectedTaskId: string | null;
  readonly pinnedTaskIds: ReadonlySet<string>;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly now: number;
  onToggleProject(projectRootKey: string): void;
  onToggleGroup(repositoryRoot: string): void;
  onSelectThread(taskId: string): void;
  onTogglePin(taskId: string): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}

interface ThreadListHandlers {
  readonly now: number;
  readonly pinnedTaskIds: ReadonlySet<string>;
  readonly selectedTaskId: string | null;
  onSelectThread(taskId: string): void;
  onTogglePin(taskId: string): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}

export function AgentThreadsSidebar({
  collapsedProjectRootKeys,
  collapsedRepositoryRoots,
  groups,
  liveTaskCount,
  maxConcurrentAgentTasks,
  now,
  onNewThread,
  onPruneOrphans,
  onReleaseProject,
  onRemoveOrphan,
  onSelectThread,
  onToggleGroup,
  onToggleProject,
  onTogglePin,
  onTrustProject,
  overflowRootPaths,
  pinnedTaskIds,
  selectedTaskId,
}: AgentThreadsSidebarProps) {
  const handlers: ThreadListHandlers = {
    now,
    onNewThread,
    onPruneOrphans,
    onRemoveOrphan,
    onSelectThread,
    onTogglePin,
    pinnedTaskIds,
    selectedTaskId,
  };

  return (
    <aside aria-label="Agent threads" className="agent-rail">
      <header className="agent-rail__head">
        <h1 className="agent-rail__title">Threads</h1>
        <span className="agent-rail__count agent-num">
          {liveTaskCount}/{maxConcurrentAgentTasks} running
        </span>
      </header>

      <div className="agent-rail__groups">
        {groups.length === 0 && (
          <p className="agent-rail__empty">No Git repository was detected in this workspace.</p>
        )}
        {groups.map((group) => (
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
        {overflowRootPaths.length > 0 && <AgentOverflowRow rootPaths={overflowRootPaths} />}
      </div>
    </aside>
  );
}

function AgentProjectSection({
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
  return (
    <div className="agent-group__threads">
      {group.threads.map((thread) => (
        <AgentThreadRow
          key={thread.record.owner.taskId}
          now={handlers.now}
          onSelect={handlers.onSelectThread}
          onTogglePin={handlers.onTogglePin}
          pinned={handlers.pinnedTaskIds.has(thread.record.owner.taskId)}
          selected={handlers.selectedTaskId === thread.record.owner.taskId}
          thread={thread}
        />
      ))}
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

function AgentThreadRow({
  now,
  onSelect,
  onTogglePin,
  pinned,
  selected,
  thread,
}: {
  readonly now: number;
  readonly pinned: boolean;
  readonly selected: boolean;
  readonly thread: AgentTaskView;
  onSelect(taskId: string): void;
  onTogglePin(taskId: string): void;
}) {
  const tone = agentThreadTone(thread.record.status);
  const taskId = thread.record.owner.taskId;
  const className = selected ? "agent-thread agent-thread--on" : "agent-thread";
  const pinClassName = pinned ? "agent-thread__pin agent-thread__pin--on" : "agent-thread__pin";

  return (
    <div className="agent-thread-slot">
      <button
        aria-current={selected}
        className={className}
        onClick={() => onSelect(taskId)}
        type="button"
      >
        <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
        <span className="agent-thread__text">
          <span className="agent-thread__title">{agentThreadTitle(thread.record.prompt)}</span>
          <span className="agent-thread__meta agent-num">
            {agentThreadStatusLabel(thread.record.status)} ·{" "}
            {agentThreadTimeLabel(thread.record.startedAtEpochMs, now)}
          </span>
        </span>
      </button>
      <button
        aria-label={pinned ? `Unpin thread ${taskId}` : `Pin thread ${taskId}`}
        aria-pressed={pinned}
        className={pinClassName}
        onClick={() => onTogglePin(taskId)}
        title={pinned ? "Unpin thread" : "Pin thread"}
        type="button"
      >
        <Pin aria-hidden="true" size={11} />
      </button>
    </div>
  );
}

function AgentOverflowRow({ rootPaths }: { readonly rootPaths: ReadonlyArray<string> }) {
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
