import { GitBranch } from "lucide-react";
import {
  gitStatusLabel,
  gitStatusTitle,
  type GitChangedFile,
  type GitStatus,
} from "../domain/git";

interface GitChangesPanelProps {
  activeChange: GitChangedFile | null;
  isLoading: boolean;
  rootPath: string | null;
  status: GitStatus;
  onOpenChange(change: GitChangedFile): void;
}

export function GitChangesPanel({
  activeChange,
  isLoading,
  onOpenChange,
  rootPath,
  status,
}: GitChangesPanelProps) {
  if (!rootPath) {
    return (
      <div className="empty-tree">
        <p>No workspace</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="empty-tree">
        <p>Loading Git status</p>
      </div>
    );
  }

  if (!status.isRepository) {
    return (
      <div className="empty-tree">
        <p>No Git repository</p>
      </div>
    );
  }

  if (status.changes.length === 0) {
    return (
      <div className="empty-tree">
        <p>No changes</p>
      </div>
    );
  }

  return (
    <nav aria-label="Git changes" className="git-changes">
      <div className="git-changes-summary">
        <GitBranch aria-hidden="true" size={14} />
        <span>{status.branch || "detached"}</span>
        <small>{status.changes.length} changes</small>
      </div>
      {status.changes.map((change) => (
        <button
          className={
            activeChange?.path === change.path
              ? "tree-row git-change-row active"
              : "tree-row git-change-row"
          }
          key={`${change.status}:${change.path}:${change.oldPath || ""}`}
          onClick={() => onOpenChange(change)}
          title={gitStatusTitle(change.status)}
          type="button"
        >
          <span className={`git-status git-status-${change.status}`}>
            {gitStatusLabel(change.status)}
          </span>
          <span>{fileName(change.relativePath)}</span>
          <small>{directoryName(change.relativePath)}</small>
        </button>
      ))}
    </nav>
  );
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function directoryName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
