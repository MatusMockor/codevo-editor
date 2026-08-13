import { RefreshCw, X } from "lucide-react";
import {
  MAX_AGENT_TASK_CHANGE_ROWS,
  type AgentTaskChangeSummary,
  type AgentTaskView,
} from "../../application/useAgentTasks";
import type { GitChangedFile } from "../../domain/git";
import {
  agentChangeStatusLetter,
  agentIsolationBadgeLabel,
  agentThreadStatusLabel,
  agentThreadTimeLabel,
  agentThreadTitle,
  agentThreadTone,
} from "./agentModePresentation";

export interface AgentThreadSessionProps {
  readonly thread: AgentTaskView | null;
  readonly composerRepositoryLabel: string | null;
  readonly now: number;
  onHideChanges(taskId: string): void;
  onHideFileDiff(taskId: string): void;
  onRefreshChanges(taskId: string): void;
  onShowFileDiff(taskId: string, change: GitChangedFile): void;
}

export function AgentThreadSession({
  composerRepositoryLabel,
  now,
  onHideChanges,
  onHideFileDiff,
  onRefreshChanges,
  onShowFileDiff,
  thread,
}: AgentThreadSessionProps) {
  if (thread === null) {
    return <AgentThreadSessionEmpty repositoryLabel={composerRepositoryLabel} />;
  }

  const { record } = thread;
  const taskId = record.owner.taskId;
  const tone = agentThreadTone(record.status);
  const running = !thread.terminal;

  return (
    <section aria-label={`Agent thread ${taskId}`} className="agent-session">
      <header className="agent-session__head">
        <span className="agent-session__repo">{thread.repositoryLabel}</span>
        <span className="agent-session__title">{agentThreadTitle(record.prompt)}</span>
        <span className="agent-session__spacer" />
        <span className={`agent-session__status agent-session__status--${tone}`}>
          <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
          {agentThreadStatusLabel(record.status)}
        </span>
      </header>

      <div className="agent-session__scroll">
        <div className="agent-session__body">
          <article className="agent-prompt">
            <div className="agent-prompt__body">{record.prompt}</div>
            <div className="agent-prompt__meta agent-num">
              <span>you</span>
              <span aria-hidden="true" className="agent-prompt__sep" />
              <span>{agentThreadTimeLabel(record.startedAtEpochMs, now)}</span>
              <span aria-hidden="true" className="agent-prompt__sep" />
              <span>{agentIsolationBadgeLabel(record.isolation).toLowerCase()}</span>
            </div>
          </article>

          <section className="agent-well">
            <header className="agent-well__head">
              <span className="agent-microlabel">agent output</span>
              <span className="agent-well__task agent-num">{taskId}</span>
            </header>
            <pre aria-label={`Agent output ${taskId}`} className="agent-well__stream">
              {record.outputTail === "" ? "Waiting for output…" : record.outputTail}
              {running && <span aria-hidden="true" className="agent-well__caret" />}
            </pre>
          </section>

          {record.outputTruncated && (
            <p className="agent-note agent-note--warning">
              Earlier output was dropped to bound memory.
            </p>
          )}

          {record.status.kind === "failed" && (
            <section className="agent-finale agent-finale--bad">
              <span className="agent-microlabel agent-microlabel--bad">run failed</span>
              <p className="agent-finale__body">{record.status.message}</p>
            </section>
          )}

          {thread.worktreeRemoved && (
            <p className="agent-note">The worktree was removed. Its branch was kept.</p>
          )}

          {thread.changeSummary && (
            <AgentThreadChanges
              onHideChanges={onHideChanges}
              onHideFileDiff={onHideFileDiff}
              onRefreshChanges={onRefreshChanges}
              onShowFileDiff={onShowFileDiff}
              summary={thread.changeSummary}
              taskId={taskId}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function AgentThreadSessionEmpty({ repositoryLabel }: { readonly repositoryLabel: string | null }) {
  return (
    <section aria-label="New agent thread" className="agent-session">
      <header className="agent-session__head">
        <span className="agent-session__repo">{repositoryLabel ?? "No repository"}</span>
        <span className="agent-session__title">New thread</span>
        <span className="agent-session__spacer" />
      </header>
      <div className="agent-session__scroll">
        <div className="agent-session__body agent-session__body--empty">
          <AgentEmptyFigure />
          <h2 className="agent-empty__title">
            {repositoryLabel === null
              ? "No Git repository detected"
              : `Start a thread in ${repositoryLabel}`}
          </h2>
          <p className="agent-empty__text">
            Describe the change. The agent picks up the repository below, works through the task,
            and comes back with output you can review.
          </p>
          {repositoryLabel !== null && (
            <p className="agent-empty__hints">
              <span className="agent-empty__hint">
                <kbd>⌘</kbd>
                <kbd>↩</kbd> starts the run
              </span>
              <span aria-hidden="true" className="agent-prompt__sep" />
              <span className="agent-empty__hint">
                <span className="agent-empty__chip">worktree</span> keeps your working tree
                untouched
              </span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentEmptyFigure() {
  return (
    <svg
      aria-hidden="true"
      className="agent-empty__figure"
      fill="none"
      height="56"
      viewBox="0 0 72 56"
      width="72"
    >
      <path d="M8 8v40" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="48" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 20c0 10 22 4 30 10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        className="agent-empty__accent"
        d="M38 30h18"
        stroke="currentColor"
        strokeDasharray="1 5"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle
        className="agent-empty__accent"
        cx="61"
        cy="30"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function AgentThreadChanges({
  onHideChanges,
  onHideFileDiff,
  onRefreshChanges,
  onShowFileDiff,
  summary,
  taskId,
}: {
  readonly summary: AgentTaskChangeSummary;
  readonly taskId: string;
  onHideChanges(taskId: string): void;
  onHideFileDiff(taskId: string): void;
  onRefreshChanges(taskId: string): void;
  onShowFileDiff(taskId: string, change: GitChangedFile): void;
}) {
  return (
    <section aria-label={`Changes for agent ${taskId}`} className="agent-changes">
      <header className="agent-changes__head">
        <span className="agent-microlabel">changes</span>
        <span className="agent-session__spacer" />
        <button
          aria-label={`Refresh changes for agent ${taskId}`}
          className="agent-linkbutton"
          disabled={summary.loading}
          onClick={() => onRefreshChanges(taskId)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={11} /> Refresh
        </button>
        <button
          aria-expanded
          aria-label={`Hide changes for agent ${taskId}`}
          className="agent-linkbutton"
          onClick={() => onHideChanges(taskId)}
          type="button"
        >
          Hide
        </button>
      </header>

      {summary.loading && <p className="agent-note">Reading the worktree changes…</p>}
      {summary.error && <p className="agent-note agent-note--bad">{summary.error}</p>}

      {!summary.loading && summary.error === null && summary.files.length === 0 && (
        <p className="agent-note">The agent left no uncommitted changes.</p>
      )}

      {summary.files.length > 0 && (
        <ul aria-label={`Changed files for agent ${taskId}`} className="agent-files">
          {summary.files.map((file) => (
            <li className="agent-files__row" key={`${file.relativePath} ${file.isStaged}`}>
              <span
                className={`agent-files__status agent-files__status--${file.status}`}
                title={file.status}
              >
                {agentChangeStatusLetter(file.status)}
              </span>
              <button
                className="agent-files__path"
                onClick={() => onShowFileDiff(taskId, file)}
                type="button"
              >
                {file.relativePath}
              </button>
            </li>
          ))}
        </ul>
      )}

      {summary.truncated && (
        <p className="agent-note agent-note--warning">
          Only the first {MAX_AGENT_TASK_CHANGE_ROWS} changed files are listed.
        </p>
      )}

      {summary.diff && (
        <AgentThreadDiff diff={summary.diff} onClose={() => onHideFileDiff(taskId)} />
      )}
    </section>
  );
}

function AgentThreadDiff({
  diff,
  onClose,
}: {
  readonly diff: NonNullable<AgentTaskChangeSummary["diff"]>;
  onClose(): void;
}) {
  return (
    <section aria-label={`Diff for ${diff.relativePath}`} className="agent-diff">
      <header className="agent-diff__head">
        <span className="agent-diff__path">{diff.relativePath}</span>
        <span className="agent-session__spacer" />
        <button
          aria-label="Close file diff"
          className="agent-linkbutton"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={11} />
        </button>
      </header>
      {diff.loading && <p className="agent-note">Reading the file diff…</p>}
      {diff.error && <p className="agent-note agent-note--bad">{diff.error}</p>}
      {diff.unavailableReason && (
        <p className="agent-note agent-note--warning">
          {diff.unavailableReason === "binary"
            ? "This file is binary, so no text diff is shown."
            : "This file is too large to preview."}
        </p>
      )}
      {!diff.loading && diff.error === null && diff.unavailableReason === null && (
        <div className="agent-diff__grid">
          <AgentDiffPane label="Before" side={diff.original} />
          <AgentDiffPane label="After" side={diff.modified} />
        </div>
      )}
    </section>
  );
}

function AgentDiffPane({
  label,
  side,
}: {
  readonly label: string;
  readonly side: { readonly text: string; readonly truncated: boolean };
}) {
  return (
    <div className="agent-diff__pane">
      <span className="agent-microlabel">{label}</span>
      <pre aria-label={`${label} content`} className="agent-diff__text">
        {side.text === "" ? "Empty file." : side.text}
      </pre>
      {side.truncated && (
        <p className="agent-note agent-note--warning">This side was truncated to stay bounded.</p>
      )}
    </div>
  );
}
