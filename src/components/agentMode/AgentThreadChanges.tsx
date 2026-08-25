import { ExternalLink, GitCompare, RefreshCw, X } from "lucide-react";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipAvailability } from "../../domain/agentShip";
import type { GitChangedFile } from "../../domain/git";
import { agentChangeOpenAvailability, agentChangeStatusLetter } from "./agentModePresentation";

export interface AgentThreadChangesProps {
  readonly thread: AgentThreadView;
  readonly summary: AgentTaskChangeSummary;
  onHideChanges(threadId: string): void;
  onHideFileDiff(threadId: string): void;
  onRefreshChanges(threadId: string): void;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
  onOpenChangedFile(threadId: string, change: GitChangedFile): void;
  onOpenChangedFileDiff(threadId: string, change: GitChangedFile): void;
}

export function AgentThreadChanges({
  onHideChanges,
  onHideFileDiff,
  onOpenChangedFile,
  onOpenChangedFileDiff,
  onRefreshChanges,
  onShowFileDiff,
  summary,
  thread,
}: AgentThreadChangesProps) {
  const threadId = thread.thread.threadId;

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
            <AgentChangedFileRow
              file={file}
              key={`${file.relativePath} ${file.isStaged}`}
              onOpenChangedFile={onOpenChangedFile}
              onOpenChangedFileDiff={onOpenChangedFileDiff}
              onShowFileDiff={onShowFileDiff}
              thread={thread}
            />
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

function AgentChangedFileRow({
  file,
  onOpenChangedFile,
  onOpenChangedFileDiff,
  onShowFileDiff,
  thread,
}: {
  readonly file: GitChangedFile;
  readonly thread: AgentThreadView;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
  onOpenChangedFile(threadId: string, change: GitChangedFile): void;
  onOpenChangedFileDiff(threadId: string, change: GitChangedFile): void;
}) {
  const threadId = thread.thread.threadId;
  const openAvailability = agentChangeOpenAvailability(thread, file);
  const diffAvailability = thread.editorAvailability;
  const openBlocked = openAvailability.kind === "blocked";
  const diffBlocked = diffAvailability.kind === "blocked";
  const blockedReason = rowBlockedReason(openAvailability, diffAvailability);

  return (
    <li className="agent-files__row">
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
      <span className="agent-files__actions">
        <button
          aria-label={`Open ${file.relativePath} in the editor`}
          className="agent-linkbutton"
          disabled={openBlocked}
          onClick={() => onOpenChangedFile(threadId, file)}
          title={openBlocked ? openAvailability.reason : undefined}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={11} /> Open
        </button>
        <button
          aria-label={`Open a diff document for ${file.relativePath}`}
          className="agent-linkbutton"
          disabled={diffBlocked}
          onClick={() => onOpenChangedFileDiff(threadId, file)}
          title={diffBlocked ? diffAvailability.reason : undefined}
          type="button"
        >
          <GitCompare aria-hidden="true" size={11} /> Diff
        </button>
      </span>
      {blockedReason !== null && <span className="agent-files__reason">{blockedReason}</span>}
    </li>
  );
}

function rowBlockedReason(open: AgentShipAvailability, diff: AgentShipAvailability): string | null {
  if (diff.kind === "blocked") return diff.reason;
  if (open.kind === "blocked") return open.reason;
  return null;
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
