import { Eye, Pin, Square, Trash2, X } from "lucide-react";
import type { AgentTaskView } from "../../application/useAgentTasks";
import {
  agentIsolationBadgeLabel,
  agentIsolationBadgeReason,
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTone,
} from "./agentModePresentation";

export interface AgentThreadInfoColumnProps {
  readonly thread: AgentTaskView | null;
  readonly pinned: boolean;
  readonly now: number;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly composerRepositoryLabel: string | null;
  readonly composerRepositoryRoot: string | null;
  readonly composerIsolationReason: string | null;
  onStop(taskId: string): void;
  onDismiss(taskId: string): void;
  onShowChanges(taskId: string): void;
  onRemoveWorktree(taskId: string): void;
  onTogglePin(taskId: string): void;
}

export function AgentThreadInfoColumn({
  composerIsolationReason,
  composerRepositoryLabel,
  composerRepositoryRoot,
  liveTaskCount,
  maxConcurrentAgentTasks,
  now,
  onDismiss,
  onRemoveWorktree,
  onShowChanges,
  onStop,
  onTogglePin,
  pinned,
  thread,
}: AgentThreadInfoColumnProps) {
  if (thread === null) {
    return (
      <aside aria-label="Agent thread details" className="agent-info">
        <section className="agent-info__section">
          <span className="agent-microlabel">repository</span>
          <p className="agent-info__value">{composerRepositoryLabel ?? "No repository"}</p>
          {composerRepositoryRoot && (
            <p className="agent-info__value agent-info__value--dim">{composerRepositoryRoot}</p>
          )}
        </section>
        {composerIsolationReason && (
          <section className="agent-info__section">
            <span className="agent-microlabel">isolation preview</span>
            <p className="agent-info__prose">{composerIsolationReason}</p>
          </section>
        )}
        <section className="agent-info__section">
          <span className="agent-microlabel">slots</span>
          <p className="agent-info__value agent-num">
            {liveTaskCount} of {maxConcurrentAgentTasks} running
          </p>
        </section>
      </aside>
    );
  }

  const { record } = thread;
  const taskId = record.owner.taskId;
  const tone = agentThreadTone(record.status);
  const changedFiles = thread.changeSummary?.files.length ?? null;
  const reviewable = thread.terminal && record.isolation === "worktree" && !thread.worktreeRemoved;

  return (
    <aside aria-label="Agent thread details" className="agent-info">
      <section className="agent-info__section">
        <span className="agent-microlabel">status</span>
        <div className="agent-info__status">
          <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
          <span className={`agent-info__word agent-info__word--${tone}`}>
            {agentThreadStatusLabel(record.status)}
          </span>
          <span className="agent-info__since agent-num">
            {agentThreadTimeLabel(record.startedAtEpochMs, now)}
          </span>
        </div>
      </section>

      <section className="agent-info__section">
        <span className="agent-microlabel">isolation</span>
        <p className="agent-info__value">{agentIsolationBadgeLabel(record.isolation)}</p>
        <p className="agent-info__prose">{agentIsolationBadgeReason(record.isolation)}</p>
      </section>

      {record.worktreePath && (
        <section className="agent-info__section">
          <span className="agent-microlabel">worktree</span>
          <p className="agent-info__value agent-info__value--dim">{record.worktreePath}</p>
        </section>
      )}

      {changedFiles !== null && (
        <section className="agent-info__section">
          <span className="agent-microlabel">changed files</span>
          <p className="agent-info__value agent-num">
            {changedFiles}
            {thread.changeSummary?.truncated ? "+" : ""}
          </p>
        </section>
      )}

      <section className="agent-info__section">
        <span className="agent-microlabel">actions</span>
        <div className="agent-info__actions">
          <button
            aria-label={pinned ? `Unpin agent ${taskId}` : `Pin agent ${taskId}`}
            aria-pressed={pinned}
            className={pinned ? "agent-info__action--pinned" : undefined}
            onClick={() => onTogglePin(taskId)}
            type="button"
          >
            <Pin aria-hidden="true" size={12} /> {pinned ? "Unpin thread" : "Pin thread"}
          </button>
          {!thread.terminal && (
            <button
              aria-label={`Stop agent ${taskId}`}
              onClick={() => onStop(taskId)}
              type="button"
            >
              <Square aria-hidden="true" size={12} /> Stop
            </button>
          )}
          {reviewable && thread.changeSummary === null && (
            <button
              aria-label={`Show changes for agent ${taskId}`}
              className="agent-info__action--main"
              onClick={() => onShowChanges(taskId)}
              type="button"
            >
              <Eye aria-hidden="true" size={12} /> Show changes
            </button>
          )}
          {reviewable && (
            <button
              aria-label={`Remove worktree for agent ${taskId}`}
              className="agent-info__action--danger"
              disabled={thread.changeSummary?.removing ?? false}
              onClick={() => onRemoveWorktree(taskId)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={12} />{" "}
              {thread.changeSummary?.removing ? "Removing…" : "Remove worktree"}
            </button>
          )}
          {thread.terminal && (
            <button
              aria-label={`Dismiss agent ${taskId}`}
              onClick={() => onDismiss(taskId)}
              type="button"
            >
              <X aria-hidden="true" size={12} /> Dismiss
            </button>
          )}
        </div>
      </section>
    </aside>
  );
}
