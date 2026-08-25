import { ExternalLink, GitCompare } from "lucide-react";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipAvailability } from "../../domain/agentShip";
import type { GitChangedFile } from "../../domain/git";
import { agentChangeOpenAvailability, agentChangeStatusLetter } from "./agentModePresentation";

export interface AgentThreadChangesProps {
  readonly thread: AgentThreadView;
  readonly summary: AgentTaskChangeSummary;
  readonly selectedRelativePath: string | null;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
  onOpenChangedFile(threadId: string, change: GitChangedFile): void;
  onOpenChangedFileDiff(threadId: string, change: GitChangedFile): void;
}

export function AgentThreadChanges({
  onOpenChangedFile,
  onOpenChangedFileDiff,
  onShowFileDiff,
  selectedRelativePath,
  summary,
  thread,
}: AgentThreadChangesProps) {
  const threadId = thread.thread.threadId;

  return (
    <div aria-label={`Changes for agent ${threadId}`} className="agent-changes" role="group">
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
              selected={file.relativePath === selectedRelativePath}
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
    </div>
  );
}

function AgentChangedFileRow({
  file,
  onOpenChangedFile,
  onOpenChangedFileDiff,
  onShowFileDiff,
  selected,
  thread,
}: {
  readonly file: GitChangedFile;
  readonly selected: boolean;
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
    <li
      aria-current={selected ? "true" : undefined}
      className={selected ? "agent-files__row agent-files__row--selected" : "agent-files__row"}
    >
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
