import { RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { GitChangedFile } from "../../domain/git";
import { AgentThreadChanges } from "./AgentThreadChanges";
import { agentFileDiffTruncated, agentSurfaceTargetGone } from "./agentModePresentation";
import { AgentTextDiffView } from "./rightPanel/diff/AgentTextDiffView";

export const SURFACE_DIFF_GONE_MESSAGE = "This thread's checkout is gone.";
export const SURFACE_DIFF_TRUNCATED_MESSAGE =
  "This diff was truncated to stay bounded. Open the diff document for the full file.";
const SURFACE_DIFF_UNAVAILABLE_MESSAGES = {
  binary: "This file is binary and cannot be shown as a text diff.",
  large: "This file is too large to show as a text diff.",
} as const;

export interface AgentSurfaceDiffProps {
  readonly thread: AgentThreadView;
  readonly summary: AgentTaskChangeSummary | null;
  onShowChanges(threadId: string): void;
  onRefreshChanges(threadId: string): void;
  onShowFileDiff(threadId: string, change: GitChangedFile): void;
  onHideFileDiff(threadId: string): void;
  onOpenChangedFile(threadId: string, change: GitChangedFile): void;
  onOpenChangedFileDiff(threadId: string, change: GitChangedFile): void;
}

export function AgentSurfaceDiff(props: AgentSurfaceDiffProps) {
  return <AgentWorkingTreeDiff {...props} />;
}

function AgentWorkingTreeDiff({
  onHideFileDiff,
  onOpenChangedFile,
  onOpenChangedFileDiff,
  onRefreshChanges,
  onShowChanges,
  onShowFileDiff,
  summary,
  thread,
}: AgentSurfaceDiffProps) {
  const threadId = thread.thread.threadId;
  const gone = agentSurfaceTargetGone(thread);
  const summaryMissing = summary === null;

  useEffect(() => {
    if (gone || !summaryMissing) return;
    onShowChanges(threadId);
  }, [gone, onShowChanges, summaryMissing, threadId]);

  const diff = summary?.diff ?? null;

  return (
    <section aria-label="Thread diff" className="agent-surface-diff" data-agent-surface-diff>
      <header className="agent-surface__subhead">
        <span aria-label="Diff scope: Working tree" className="agent-microlabel">
          working tree
        </span>
        <span className="agent-session__spacer" />
        <button
          aria-label={`Refresh changes for agent ${threadId}`}
          className="agent-iconbutton"
          disabled={gone || summary === null || summary.loading}
          onClick={() => onRefreshChanges(threadId)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={12} />
        </button>
      </header>

      {gone && <p className="agent-note agent-note--warning">{SURFACE_DIFF_GONE_MESSAGE}</p>}

      {!gone && (
        <div className="agent-surface-diff__body">
          <div className="agent-surface-diff__list">
            {summary === null && <p className="agent-note">Reading the worktree changes…</p>}
            {summary !== null && (
              <AgentThreadChanges
                onOpenChangedFile={onOpenChangedFile}
                onOpenChangedFileDiff={onOpenChangedFileDiff}
                onShowFileDiff={onShowFileDiff}
                selectedRelativePath={diff?.relativePath ?? null}
                summary={summary}
                thread={thread}
              />
            )}
          </div>
          <div className="agent-surface-diff__preview">
            {diff === null && (
              <p className="agent-note agent-surface-diff__placeholder">
                Select a file to review its diff.
              </p>
            )}
            {diff !== null && diff.error !== null && (
              <p className="agent-note agent-note--bad">{diff.error}</p>
            )}
            {diff !== null && agentFileDiffTruncated(diff) && (
              <p className="agent-note agent-note--warning agent-surface-diff__banner">
                {SURFACE_DIFF_TRUNCATED_MESSAGE}
              </p>
            )}
            {diff !== null && diff.error === null && (
              <>
                <header className="agent-surface__subhead">
                  <span className="agent-microlabel">{diff.relativePath}</span>
                  <span className="agent-session__spacer" />
                  <button
                    aria-label="Close diff"
                    className="agent-iconbutton"
                    onClick={() => onHideFileDiff(threadId)}
                    type="button"
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </header>
                {diff.unavailableReason !== null ? (
                  <p className="agent-note">
                    {SURFACE_DIFF_UNAVAILABLE_MESSAGES[diff.unavailableReason]}
                  </p>
                ) : (
                  <AgentTextDiffView
                    loading={diff.loading}
                    modified={diff.modified.text}
                    original={diff.original.text}
                    path={diff.relativePath}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
