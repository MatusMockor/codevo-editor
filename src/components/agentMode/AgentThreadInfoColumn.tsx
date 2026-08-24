import { Archive, Eye, Pin, Square, Trash, Trash2 } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentIsolationBadgeLabel,
  agentIsolationBadgeReason,
  agentRunningTurnCount,
  agentThreadLifecycleLabel,
  agentThreadTimeLabel,
  agentThreadTone,
  agentTurnStatusLabel,
  lastAgentTurnStatus,
} from "./agentModePresentation";

export interface AgentThreadInfoColumnProps {
  readonly thread: AgentThreadView | null;
  readonly now: number;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly composerRepositoryLabel: string | null;
  readonly composerRepositoryRoot: string | null;
  readonly composerIsolationReason: string | null;
  onStop(threadId: string): void;
  onArchive(threadId: string): void;
  onRemove(threadId: string): void;
  onShowChanges(threadId: string): void;
  onRemoveWorktree(threadId: string): void;
  onTogglePin(threadId: string): void;
}

export function AgentThreadInfoColumn({
  composerIsolationReason,
  composerRepositoryLabel,
  composerRepositoryRoot,
  liveTaskCount,
  maxConcurrentAgentTasks,
  now,
  onArchive,
  onRemove,
  onRemoveWorktree,
  onShowChanges,
  onStop,
  onTogglePin,
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

  const record = thread.thread;
  const threadId = record.threadId;
  const lastStatus = lastAgentTurnStatus(record);
  const tone = agentThreadTone(thread.lifecycle, lastStatus);
  const pinned = record.pinned;
  const running = thread.lifecycle === "running";
  const changedFiles = thread.changeSummary?.files.length ?? null;
  const isolation = record.target.isolation;
  const reviewable = !running && isolation === "worktree" && !thread.worktreeRemoved;

  return (
    <aside aria-label="Agent thread details" className="agent-info">
      <section className="agent-info__section">
        <span className="agent-microlabel">status</span>
        <div className="agent-info__status">
          <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
          <span className={`agent-info__word agent-info__word--${tone}`}>
            {agentThreadLifecycleLabel(thread.lifecycle)}
          </span>
          <span className="agent-info__since agent-num">
            {agentThreadTimeLabel(record.updatedAtEpochMs, now)}
          </span>
        </div>
        {lastStatus && (
          <p className="agent-info__prose">Last turn: {agentTurnStatusLabel(lastStatus)}.</p>
        )}
      </section>

      <section className="agent-info__section">
        <span className="agent-microlabel">turns</span>
        <p className="agent-info__value agent-num">
          {record.turns.length}
          {record.turnsTruncated ? "+" : ""} · {agentRunningTurnCount(record)} running
        </p>
      </section>

      <section className="agent-info__section">
        <span className="agent-microlabel">isolation</span>
        <p className="agent-info__value">{agentIsolationBadgeLabel(isolation)}</p>
        <p className="agent-info__prose">{agentIsolationBadgeReason(isolation)}</p>
      </section>

      {record.target.worktreePath && (
        <section className="agent-info__section">
          <span className="agent-microlabel">worktree</span>
          <p className="agent-info__value agent-info__value--dim">{record.target.worktreePath}</p>
          {thread.worktreeMissing && (
            <p className="agent-note agent-note--warning">
              The worktree for this thread no longer exists.
            </p>
          )}
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
            aria-label={pinned ? `Unpin thread ${threadId}` : `Pin thread ${threadId}`}
            aria-pressed={pinned}
            className={pinned ? "agent-info__action--pinned" : undefined}
            onClick={() => onTogglePin(threadId)}
            type="button"
          >
            <Pin aria-hidden="true" size={12} /> {pinned ? "Unpin thread" : "Pin thread"}
          </button>
          {running && (
            <button
              aria-label={`Stop agent ${threadId}`}
              onClick={() => onStop(threadId)}
              type="button"
            >
              <Square aria-hidden="true" size={12} /> Stop
            </button>
          )}
          {reviewable && thread.changeSummary === null && (
            <button
              aria-label={`Show changes for agent ${threadId}`}
              className="agent-info__action--main"
              onClick={() => onShowChanges(threadId)}
              type="button"
            >
              <Eye aria-hidden="true" size={12} /> Show changes
            </button>
          )}
          {reviewable && (
            <button
              aria-label={`Remove worktree for agent ${threadId}`}
              className="agent-info__action--danger"
              disabled={thread.changeSummary?.removing ?? false}
              onClick={() => onRemoveWorktree(threadId)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={12} />{" "}
              {thread.changeSummary?.removing ? "Removing…" : "Remove worktree"}
            </button>
          )}
          {!running && thread.lifecycle !== "archived" && (
            <button
              aria-label={`Archive thread ${threadId}`}
              onClick={() => onArchive(threadId)}
              type="button"
            >
              <Archive aria-hidden="true" size={12} /> Archive
            </button>
          )}
          {!running && (
            <button
              aria-label={`Remove thread ${threadId}`}
              className="agent-info__action--danger"
              onClick={() => onRemove(threadId)}
              type="button"
            >
              <Trash aria-hidden="true" size={12} /> Remove thread
            </button>
          )}
        </div>
      </section>
    </aside>
  );
}
