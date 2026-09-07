import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Suspense, lazy, useMemo } from "react";
import {
  useAgentGitHistory,
  type AgentGitHistoryGateway,
} from "../../application/useAgentGitHistory";
import type { DiffPayload, GitFileDiff } from "../../domain/git";
import type { AgentGitHistoryScope } from "./agentGitHistoryTarget";
import type { AgentWorkbenchDiffChrome } from "./agentWorkbenchChrome";
import "./agentHistory.css";

const LazyGitDiffPreview = lazy(() =>
  import("../GitDiffPreview").then((module) => ({ default: module.GitDiffPreview })),
);

export interface AgentSurfaceHistoryProps extends AgentWorkbenchDiffChrome {
  readonly scope: AgentGitHistoryScope;
  readonly gateway: AgentGitHistoryGateway | null;
}

export function AgentSurfaceHistory({ scope, gateway, ...editor }: AgentSurfaceHistoryProps) {
  const target = scope.kind === "available" ? scope.target : null;
  const history = useAgentGitHistory({ target, gateway });
  const diff = useMemo(() => historyDiff(history.diff), [history.diff]);
  if (scope.kind === "unavailable") return <p className="agent-note">{scope.reason}</p>;
  return (
    <section aria-label="Git history" className="agent-history">
      <header className="agent-surface__subhead">
        <span className="agent-history__root" title={scope.target.rootPath}>
          {scope.target.rootPath.split("/").filter(Boolean).slice(-1)[0]}
        </span>
        <span className="agent-session__spacer" />
        <button
          aria-label="Refresh Git history"
          className="agent-iconbutton"
          disabled={history.status === "loading"}
          onClick={history.refresh}
          type="button"
        >
          <RefreshCw size={13} />
        </button>
      </header>
      {history.status === "loading" && (
        <p className="agent-note" role="status">
          Loading commits…
        </p>
      )}
      {history.reason !== null && (
        <p className="agent-note" role="status">
          {history.reason}
        </p>
      )}
      {history.status === "ready" && (
        <>
          <div className="agent-history__commits" aria-label="Commits">
            {history.commits.length === 0 && (
              <p className="agent-note">No commits in this repository yet.</p>
            )}
            {history.commits.map((commit) => (
              <button
                type="button"
                className="agent-history__commit"
                aria-pressed={history.selectedHash === commit.hash}
                key={commit.hash}
                onClick={() => history.selectCommit(commit.hash)}
              >
                <span className="agent-history__subject" title={commit.subject}>
                  {commit.subject}
                </span>
                <span className="agent-history__metadata">
                  <span>{commit.authorName}</span>
                  <time dateTime={commit.date} title={commit.date}>
                    {historyDate(commit.date)}
                  </time>
                  <code>{commit.abbrevHash}</code>
                </span>
              </button>
            ))}
          </div>
          <nav aria-label="Commit pages" className="agent-history__pages">
            <button
              aria-label="Newer commits"
              className="agent-iconbutton"
              disabled={history.page === 0}
              onClick={history.previousPage}
              type="button"
            >
              <ChevronLeft size={14} />
            </button>
            <span>Page {history.page + 1}</span>
            <button
              aria-label="Older commits"
              className="agent-iconbutton"
              disabled={!history.hasNext}
              onClick={history.nextPage}
              type="button"
            >
              <ChevronRight size={14} />
            </button>
          </nav>
          <div className="agent-history__details">
            {history.detailsLoading && (
              <p className="agent-note" role="status">
                Loading commit…
              </p>
            )}
            {history.detailsError !== null && (
              <p className="agent-note" role="alert">
                {history.detailsError}
              </p>
            )}
            {history.selectedHash === null && (
              <p className="agent-note">Select a commit to see its details and changed files.</p>
            )}
            {history.details !== null && (
              <>
                <h3>{history.details.subject}</h3>
                <p className="agent-history__metadata">
                  {history.details.authorName} · {historyDate(history.details.date)} ·{" "}
                  <code title={history.details.hash}>{history.details.abbrevHash}</code>
                </p>
                {history.details.body !== "" && (
                  <p className="agent-history__message">{history.details.body}</p>
                )}
                <div className="agent-history__files" aria-label="Commit files">
                  {history.files.length === 0 && <p className="agent-note">No changed files.</p>}
                  {history.files.map((file) => (
                    <button
                      aria-pressed={history.selectedFile?.path === file.path}
                      className="agent-history__file"
                      key={file.path}
                      onClick={() => history.selectFile(file)}
                      title={file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`}
                      type="button"
                    >
                      <span data-status={file.status}>{file.status}</span>
                      <span>{file.path}</span>
                    </button>
                  ))}
                  {history.filesTruncated && (
                    <p className="agent-note">Showing the first 200 changed files.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {history.diffError !== null && (
        <p className="agent-note" role="alert">
          {history.diffError}
        </p>
      )}
      {(history.diffLoading || diff !== null) && (
        <div className="agent-history__diff">
          <Suspense fallback={<p className="agent-note">Loading diff…</p>}>
            <LazyGitDiffPreview
              {...editor}
              canRevertChange={false}
              comparisonLabels={{
                original: history.details?.parents.length === 0 ? "Empty tree" : "Parent",
                modified:
                  history.details?.abbrevHash ?? history.selectedHash?.slice(0, 8) ?? "Commit",
              }}
              diff={diff}
              isLoading={history.diffLoading}
              onClose={history.closeDiff}
              previewIdentity={`${scope.target.ownerKey}:${history.selectedHash}:${history.selectedFile?.path}`}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}

function historyDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function historyDiff(payload: DiffPayload | null): GitFileDiff | null {
  if (payload === null) return null;
  const status =
    payload.status === "A"
      ? "added"
      : payload.status === "D"
        ? "deleted"
        : payload.status === "R"
          ? "renamed"
          : "modified";
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      path: payload.path,
      relativePath: payload.path,
      oldPath: payload.oldPath,
      oldRelativePath: payload.oldPath,
      status,
    },
    language: payload.language,
    originalContent: payload.originalContent,
    modifiedContent: payload.modifiedContent,
  };
}
