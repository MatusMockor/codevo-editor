import "./agentSurfaceProjectDiff.css";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { isInsideAgentSurfaceRoot } from "../../application/useAgentSurfaceFileTree";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../../domain/git";
import type { GitRepositoryStatus } from "../../domain/gitRepositoryMapping";
import type { AgentWorkbenchDiffChrome } from "./agentWorkbenchChrome";
import { agentChangeStatusLetter } from "./agentModePresentation";

const LazyGitDiffPreview = lazy(() =>
  import("../GitDiffPreview").then((module) => ({ default: module.GitDiffPreview })),
);
const MAX_PROJECT_DIFF_FILES = 1000;

export interface AgentSurfaceProjectDiffState {
  readonly rootPath: string;
  readonly status: GitStatus;
  readonly repositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
  readonly loading: boolean;
  readonly diff: GitFileDiff | null;
  readonly diffLoading: boolean;
  onRefresh(): void;
  onPreviewChange(change: GitChangedFile, repositoryRoot: string): void;
  onOpenChange(change: GitChangedFile, repositoryRoot: string): void;
  onClosePreview(): void;
}

export type AgentSurfaceProjectDiffProps = AgentSurfaceProjectDiffState & AgentWorkbenchDiffChrome;

export function AgentSurfaceProjectDiff(props: AgentSurfaceProjectDiffProps) {
  const failed = props.repositoryStatuses.some(
    (entry) => entry.failed && isInsideAgentSurfaceRoot(props.rootPath, entry.root),
  );
  const repositories =
    props.repositoryStatuses.length === 0
      ? [props.status]
      : props.repositoryStatuses.map((entry) => entry.status);
  const ownedRepositories = repositories.filter((status) =>
    isInsideAgentSurfaceRoot(props.rootPath, status.rootPath),
  );
  const files = ownedRepositories.flatMap((status) =>
    status.changes
      .filter((change) => isInsideAgentSurfaceRoot(status.rootPath, change.path))
      .map((change) => ({ change, repositoryRoot: status.rootPath })),
  );
  const diff =
    props.diff !== null && isInsideAgentSurfaceRoot(props.rootPath, props.diff.change.path)
      ? props.diff
      : null;
  return (
    <section aria-label="Project diff" className="agent-surface-diff agent-project-diff">
      <header className="agent-surface__subhead">
        <span className="agent-microlabel">Project changes</span>
        <span className="agent-session__spacer" />
        <button
          aria-label="Refresh project changes"
          className="agent-iconbutton"
          disabled={props.loading}
          onClick={props.onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={12} />
        </button>
      </header>
      <div className="agent-surface-diff__body">
        <div className="agent-surface-diff__list">
          {props.loading && <p className="agent-note">Reading project changes…</p>}
          {failed && (
            <p className="agent-note agent-note--warning">
              Some repositories could not be read. Refresh to try again.
            </p>
          )}
          {!props.loading && !failed && files.length === 0 && (
            <p className="agent-note">
              {ownedRepositories.some((status) => status.isRepository)
                ? "No uncommitted changes in this project."
                : "No Git repository in this project."}
            </p>
          )}
          <ul aria-label="Project changed files" className="agent-files">
            {files.slice(0, MAX_PROJECT_DIFF_FILES).map(({ change, repositoryRoot }) => (
              <li className="agent-files__row" key={`${change.path}:${change.isStaged}`}>
                <span
                  className={`agent-files__status agent-files__status--${change.status}`}
                  title={change.status}
                >
                  {agentChangeStatusLetter(change.status)}
                </span>
                <button
                  className="agent-files__path"
                  onClick={() => props.onPreviewChange(change, repositoryRoot)}
                  type="button"
                >
                  {change.path.slice(props.rootPath.length + 1)}
                  {change.isStaged ? " (staged)" : ""}
                </button>
                <button
                  aria-label={`Open diff document for ${change.relativePath}`}
                  className="agent-linkbutton"
                  onClick={() => props.onOpenChange(change, repositoryRoot)}
                  type="button"
                >
                  Open diff
                </button>
              </li>
            ))}
          </ul>
          {files.length > MAX_PROJECT_DIFF_FILES && (
            <p className="agent-note agent-note--warning">
              Showing the first {MAX_PROJECT_DIFF_FILES} changed files.
            </p>
          )}
        </div>
        <div className="agent-surface-diff__preview">
          {diff === null && !props.diffLoading && (
            <p className="agent-note">Select a file to review its diff.</p>
          )}
          {(diff !== null || props.diffLoading) && (
            <Suspense fallback={<p className="agent-note">Loading the diff viewer…</p>}>
              <LazyGitDiffPreview
                canRevertChange={false}
                diff={diff}
                editorFontFamily={props.editorFontFamily}
                editorFontLigatures={props.editorFontLigatures}
                editorFontSize={props.editorFontSize}
                isLoading={props.diffLoading}
                monacoTheme={props.monacoTheme}
                onClose={props.onClosePreview}
                previewIdentity={`${props.rootPath}:${diff?.change.path ?? "pending"}`}
              />
            </Suspense>
          )}
        </div>
      </div>
    </section>
  );
}
