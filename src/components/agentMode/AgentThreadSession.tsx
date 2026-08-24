import { memo } from "react";
import { RefreshCw, X } from "lucide-react";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import type { GitChangedFile } from "../../domain/git";
import {
  agentChangeStatusLetter,
  agentIsolationBadgeLabel,
  agentThreadDisplayTitle,
  agentThreadLifecycleLabel,
  agentThreadTimeLabel,
  agentThreadTone,
  agentTurnProjection,
  agentTurnStatusLabel,
  lastAgentTurnStatus,
  type AgentTurnItem,
} from "./agentModePresentation";

export interface AgentThreadSessionProps {
  readonly thread: AgentThreadView | null;
  readonly composerRepositoryLabel: string | null;
  readonly now: number;
  readonly turnRenderProbe?: (turnId: string) => void;
  onHideChanges(threadId: string): void;
  onHideFileDiff(threadId: string): void;
  onRefreshChanges(threadId: string): void;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
}

export function AgentThreadSession({
  composerRepositoryLabel,
  now,
  onHideChanges,
  onHideFileDiff,
  onRefreshChanges,
  onShowFileDiff,
  thread,
  turnRenderProbe,
}: AgentThreadSessionProps) {
  if (thread === null) {
    return <AgentThreadSessionEmpty repositoryLabel={composerRepositoryLabel} />;
  }

  const record = thread.thread;
  const threadId = record.threadId;
  const tone = agentThreadTone(thread.lifecycle, lastAgentTurnStatus(record));

  return (
    <section aria-label={`Agent thread ${threadId}`} className="agent-session">
      <header className="agent-session__head">
        <span className="agent-session__repo">{thread.repositoryLabel}</span>
        <span className="agent-session__title">{agentThreadDisplayTitle(record)}</span>
        <span className="agent-session__spacer" />
        <span className={`agent-session__status agent-session__status--${tone}`}>
          <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
          {agentThreadLifecycleLabel(thread.lifecycle)}
        </span>
      </header>

      <div className="agent-session__scroll">
        <div className="agent-session__body">
          {record.turnsTruncated && (
            <p className="agent-note agent-note--warning">
              Earlier turns were dropped to bound memory.
            </p>
          )}

          {record.turns.map((turn) => (
            <AgentTurnView
              isolationLabel={record.target.isolation}
              key={turn.turnId}
              renderProbe={turnRenderProbe}
              startedLabel={agentThreadTimeLabel(turn.startedAtEpochMs, now)}
              turn={turn}
            />
          ))}

          {thread.worktreeMissing && (
            <p className="agent-note agent-note--warning">
              The worktree for this thread no longer exists.
            </p>
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
              threadId={threadId}
            />
          )}
        </div>
      </div>
    </section>
  );
}

const AgentTurnView = memo(function AgentTurnView({
  isolationLabel,
  renderProbe,
  startedLabel,
  turn,
}: {
  readonly isolationLabel: AgentThreadView["thread"]["target"]["isolation"];
  readonly renderProbe?: (turnId: string) => void;
  readonly startedLabel: string;
  readonly turn: AgentTurn;
}) {
  renderProbe?.(turn.turnId);
  const projection = agentTurnProjection(turn.events);
  const running = turn.status.kind === "pending" || turn.status.kind === "running";
  const empty = projection.items.length === 0 && projection.rawLines.length === 0;

  return (
    <article aria-label={`Agent turn ${turn.turnId}`} className="agent-turn">
      <article className="agent-prompt">
        <div className="agent-prompt__body">{turn.prompt}</div>
        <div className="agent-prompt__meta agent-num">
          <span>you</span>
          <span aria-hidden="true" className="agent-prompt__sep" />
          <span>{startedLabel}</span>
          <span aria-hidden="true" className="agent-prompt__sep" />
          <span>{agentIsolationBadgeLabel(isolationLabel).toLowerCase()}</span>
          <span aria-hidden="true" className="agent-prompt__sep" />
          <span>{agentTurnStatusLabel(turn.status).toLowerCase()}</span>
        </div>
      </article>

      {projection.hiddenCount > 0 && (
        <p className="agent-note">{projection.hiddenCount} earlier events hidden</p>
      )}

      <div className="agent-turn__events">
        {projection.items.map((item) => (
          <AgentTurnItemView item={item} key={item.key} />
        ))}
        {empty && running && (
          <p className="agent-note">
            Waiting for output…
            <span aria-hidden="true" className="agent-well__caret" />
          </p>
        )}
      </div>

      {projection.rawLines.length > 0 && (
        <details className="agent-raw">
          <summary className="agent-microlabel">raw output</summary>
          <pre className="agent-raw__lines">
            {projection.rawLines.map((line) => line.raw).join("\n")}
          </pre>
        </details>
      )}

      {turn.eventsTruncated && (
        <p className="agent-note agent-note--warning">Later output was dropped to bound memory.</p>
      )}

      {turn.status.kind === "interrupted" && (
        <p className="agent-note agent-note--warning">Interrupted by app restart</p>
      )}

      {turn.status.kind === "failed" && (
        <section className="agent-finale agent-finale--bad">
          <span className="agent-microlabel agent-microlabel--bad">run failed</span>
          <p className="agent-finale__body">{turn.status.message}</p>
        </section>
      )}
    </article>
  );
});

function AgentTurnItemView({ item }: { readonly item: AgentTurnItem }) {
  if (item.kind === "assistantText") {
    return (
      <div className="agent-text">
        {item.paragraphs.map((paragraph, index) => (
          <p className="agent-text__paragraph" key={`${item.key}p${index}`}>
            {paragraph}
          </p>
        ))}
      </div>
    );
  }

  if (item.kind === "reasoning") {
    return (
      <details className="agent-reasoning">
        <summary className="agent-microlabel">reasoning</summary>
        <p className="agent-reasoning__body">{item.text}</p>
      </details>
    );
  }

  if (item.kind === "tool") {
    return <AgentToolRow item={item} />;
  }

  if (item.kind === "result") {
    return (
      <section className={item.isError ? "agent-finale agent-finale--bad" : "agent-finale"}>
        <span
          className={item.isError ? "agent-microlabel agent-microlabel--bad" : "agent-microlabel"}
        >
          {item.isError ? "run failed" : "result"}
        </span>
        {item.text !== "" && <p className="agent-finale__body">{item.text}</p>}
      </section>
    );
  }

  return (
    <section className="agent-finale agent-finale--bad">
      <span className="agent-microlabel agent-microlabel--bad">error</span>
      <p className="agent-finale__body">{item.message}</p>
    </section>
  );
}

function AgentToolRow({ item }: { readonly item: Extract<AgentTurnItem, { kind: "tool" }> }) {
  const outcome = item.outcome;
  const statusClassName =
    outcome === null
      ? "agent-tool__status"
      : `agent-tool__status agent-tool__status--${outcome.isError ? "bad" : "ok"}`;
  const statusLabel = outcome === null ? "running" : outcome.isError ? "error" : "ok";

  return (
    <div className="agent-tool" title={outcome?.outputSummary ?? undefined}>
      <span className="agent-tool__name">{item.name}</span>
      <span className="agent-tool__input">{item.inputSummary}</span>
      <span className={statusClassName}>{statusLabel}</span>
    </div>
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
  threadId,
}: {
  readonly summary: AgentTaskChangeSummary;
  readonly threadId: string;
  onHideChanges(threadId: string): void;
  onHideFileDiff(threadId: string): void;
  onRefreshChanges(threadId: string): void;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
}) {
  return (
    <section aria-label={`Changes for agent ${threadId}`} className="agent-changes">
      <header className="agent-changes__head">
        <span className="agent-microlabel">changes</span>
        <span className="agent-session__spacer" />
        <button
          aria-label={`Refresh changes for agent ${threadId}`}
          className="agent-linkbutton"
          disabled={summary.loading}
          onClick={() => onRefreshChanges(threadId)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={11} /> Refresh
        </button>
        <button
          aria-expanded
          aria-label={`Hide changes for agent ${threadId}`}
          className="agent-linkbutton"
          onClick={() => onHideChanges(threadId)}
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
        <ul aria-label={`Changed files for agent ${threadId}`} className="agent-files">
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
                onClick={() => onShowFileDiff(threadId, file)}
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
          More changed files exist than are listed here.
        </p>
      )}

      {summary.diff && (
        <AgentThreadDiff diff={summary.diff} onClose={() => onHideFileDiff(threadId)} />
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
