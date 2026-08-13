import { ChevronDown, Pin } from "lucide-react";
import type { AgentTaskView } from "../../application/useAgentTasks";
import {
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTitle,
  agentThreadTone,
  type AgentRepositoryGroup,
} from "./agentModePresentation";

export interface AgentThreadsSidebarProps {
  readonly groups: ReadonlyArray<AgentRepositoryGroup>;
  readonly collapsedRepositoryRoots: ReadonlySet<string>;
  readonly selectedTaskId: string | null;
  readonly pinnedTaskIds: ReadonlySet<string>;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly now: number;
  onToggleGroup(repositoryRoot: string): void;
  onSelectThread(taskId: string): void;
  onTogglePin(taskId: string): void;
  onNewThread(repositoryRoot: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}

export function AgentThreadsSidebar({
  collapsedRepositoryRoots,
  groups,
  liveTaskCount,
  maxConcurrentAgentTasks,
  now,
  onNewThread,
  onPruneOrphans,
  onRemoveOrphan,
  onSelectThread,
  onToggleGroup,
  onTogglePin,
  pinnedTaskIds,
  selectedTaskId,
}: AgentThreadsSidebarProps) {
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
          <AgentRepositoryGroupSection
            collapsed={collapsedRepositoryRoots.has(group.repositoryRoot)}
            group={group}
            key={group.repositoryRoot}
            now={now}
            onNewThread={onNewThread}
            onPruneOrphans={onPruneOrphans}
            onRemoveOrphan={onRemoveOrphan}
            onSelectThread={onSelectThread}
            onToggleGroup={onToggleGroup}
            onTogglePin={onTogglePin}
            pinnedTaskIds={pinnedTaskIds}
            selectedTaskId={selectedTaskId}
          />
        ))}
      </div>
    </aside>
  );
}

function AgentRepositoryGroupSection({
  collapsed,
  group,
  now,
  onNewThread,
  onPruneOrphans,
  onRemoveOrphan,
  onSelectThread,
  onToggleGroup,
  onTogglePin,
  pinnedTaskIds,
  selectedTaskId,
}: {
  readonly collapsed: boolean;
  readonly group: AgentRepositoryGroup;
  readonly now: number;
  readonly pinnedTaskIds: ReadonlySet<string>;
  readonly selectedTaskId: string | null;
  onToggleGroup(repositoryRoot: string): void;
  onSelectThread(taskId: string): void;
  onTogglePin(taskId: string): void;
  onNewThread(repositoryRoot: string): void;
  onRemoveOrphan(worktreePath: string): void;
  onPruneOrphans(repositoryRoot: string): void;
}) {
  const groupClassName = collapsed ? "agent-group agent-group--closed" : "agent-group";

  return (
    <section aria-label={`Repository ${group.label}`} className={groupClassName}>
      <button
        aria-expanded={!collapsed}
        className="agent-group__head"
        onClick={() => onToggleGroup(group.repositoryRoot)}
        type="button"
      >
        <ChevronDown aria-hidden="true" className="agent-group__chevron" size={12} />
        <span className="agent-group__name">{group.label}</span>
        <span className="agent-group__count agent-num">{group.threads.length}</span>
      </button>

      {!collapsed && (
        <div className="agent-group__threads">
          {group.threads.map((thread) => (
            <AgentThreadRow
              key={thread.record.owner.taskId}
              now={now}
              onSelect={onSelectThread}
              onTogglePin={onTogglePin}
              pinned={pinnedTaskIds.has(thread.record.owner.taskId)}
              selected={selectedTaskId === thread.record.owner.taskId}
              thread={thread}
            />
          ))}
          {group.repositoryResolved ? (
            <button
              className="agent-group__new"
              onClick={() => onNewThread(group.repositoryRoot)}
              type="button"
            >
              + New thread
            </button>
          ) : (
            <p className="agent-rail__empty">
              This repository is no longer available in the current workspace.
            </p>
          )}
          {group.orphans.length > 0 && (
            <AgentOrphanList
              group={group}
              onPruneOrphans={onPruneOrphans}
              onRemoveOrphan={onRemoveOrphan}
            />
          )}
        </div>
      )}
    </section>
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
