import { FolderGit2, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { AgentHistoryCheckoutAction } from "./AgentHistoryCheckoutAction";
import { AgentHistoryGraph } from "./AgentHistoryGraph";
import { historyDate, historyMessage } from "./agentHistoryPresentation";
import { AgentHistoryBranchPicker } from "./AgentHistoryBranchPicker";
import { useAgentGitHistory } from "../../application/useAgentGitHistory";
import { AgentTextDiffView } from "./rightPanel/diff/AgentTextDiffView";
import "./agentHistory.css";
import type { AgentSurfaceHistoryProps } from "./AgentSurfaceHistory";

export function AgentHistoryContent({
  scope,
  gateway,
  repositoryPicker,
  checkout,
  fileChanges,
}: AgentSurfaceHistoryProps & { readonly repositoryPicker?: ReactNode }) {
  const target = scope.kind === "available" ? scope.target : null;
  const history = useAgentGitHistory({ target, gateway, fileChanges });
  const message =
    history.details === null ? "" : historyMessage(history.details.subject, history.details.body);
  const diff = history.diff;
  return (
    <section aria-label="Git history" className="agent-history">
      <header className="agent-history__toolbar">
        {repositoryPicker ??
          (scope.kind === "available" && (
            <span className="agent-history__root" title={scope.target.rootPath}>
              <FolderGit2 size={13} />
              {scope.target.rootPath.split("/").filter(Boolean).slice(-1)[0]}
            </span>
          ))}
        {scope.kind === "available" && (
          <>
            <AgentHistoryBranchPicker
              identity={`${target?.ownerKey}:${target?.rootPath}`}
              branches={history.branches}
              value={history.branchFilter}
              disabled={history.branches === null}
              onChange={history.selectBranch}
            />
            <span className="agent-session__spacer" />
            <button
              aria-label="Refresh Git history"
              className="agent-iconbutton"
              disabled={history.status === "loading" || history.loadingMore}
              onClick={history.refresh}
              type="button"
            >
              <RefreshCw size={13} />
            </button>
          </>
        )}
      </header>
      {target !== null && history.branches !== null && (
        <AgentHistoryCheckoutAction
          target={target}
          branches={history.branches}
          filter={history.branchFilter}
          checkout={checkout}
          onSuccess={history.refresh}
        />
      )}
      {scope.kind === "unavailable" && <p className="agent-note">{scope.reason}</p>}
      {scope.kind === "available" && history.status === "loading" && (
        <p className="agent-note" role="status">
          Loading commits…
        </p>
      )}
      {scope.kind === "available" && history.reason !== null && (
        <p className="agent-note" role="status">
          {history.reason}
        </p>
      )}
      {history.status === "ready" && (
        <>
          <AgentHistoryGraph
            commits={history.commits}
            selectedHash={history.selectedHash}
            onSelect={history.selectCommit}
          />
          <div className="agent-history__graph-footer">
            <span>{history.commits.length} commits</span>
            {history.hasNext && (
              <button
                type="button"
                aria-label="Load more commits"
                disabled={history.loadingMore}
                onClick={history.loadMore}
              >
                {history.loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
          {history.selectedHash !== null && (
            <section className="agent-history__details" aria-label="Commit details">
              <header className="agent-history__inspector-heading">
                <span>Commit details</span>
                <button
                  aria-label="Close commit details"
                  className="agent-iconbutton"
                  onClick={history.clearSelection}
                  type="button"
                >
                  <X size={13} />
                </button>
              </header>
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
              {history.details !== null && (
                <>
                  <h3>{history.details.subject}</h3>
                  <p className="agent-history__metadata">
                    {history.details.authorName} · {historyDate(history.details.date)} ·{" "}
                    <code title={history.details.hash}>{history.details.abbrevHash}</code>
                  </p>
                  {message !== "" && <p className="agent-history__message">{message}</p>}
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
            </section>
          )}
        </>
      )}
      {history.diffError !== null && (
        <p className="agent-note" role="alert">
          {history.diffError}
        </p>
      )}
      {(history.diffLoading || diff !== null) && (
        <div className="agent-history__diff">
          <header className="agent-history__inspector-heading">
            <span title={diff?.oldPath ?? undefined}>
              {diff?.path ?? history.selectedFile?.path ?? "Diff"}
            </span>
            <button
              aria-label="Close diff"
              className="agent-iconbutton"
              onClick={history.closeDiff}
              type="button"
            >
              <X size={13} />
            </button>
          </header>
          <AgentTextDiffView
            labels={{
              original: history.details?.parents.length === 0 ? "Empty tree" : "Parent",
              modified:
                history.details?.abbrevHash ?? history.selectedHash?.slice(0, 8) ?? "Commit",
            }}
            loading={history.diffLoading}
            modified={diff?.modifiedContent ?? ""}
            original={diff?.originalContent ?? ""}
            path={diff?.path ?? history.selectedFile?.path ?? ""}
          />
        </div>
      )}
    </section>
  );
}
