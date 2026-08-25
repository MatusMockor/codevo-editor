import { RefreshCw } from "lucide-react";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import { MAX_AGENT_SURFACE_TREE_ENTRIES } from "../../application/useAgentSurfaceFileTree";
import type { GitChangeStatus } from "../../domain/git";
import type { FileEntry } from "../../domain/workspace";
import { FileTree } from "../FileTree";

export const SURFACE_TREE_GONE_MESSAGE = "This thread's checkout is gone.";

export interface AgentSurfaceFileTreeProps {
  readonly tree: AgentSurfaceFileTreeSurface;
  readonly activePath: string | null;
  readonly revealActivePathSignal: number;
  readonly fileStatusesByPath?: Record<string, GitChangeStatus>;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
}

export function AgentSurfaceFileTree({
  activePath,
  fileStatusesByPath,
  onOpenFile,
  onPreviewFile,
  revealActivePathSignal,
  tree,
}: AgentSurfaceFileTreeProps) {
  const gone = tree.rootPath === null;
  const truncated = tree.truncatedDirectories.size > 0;

  return (
    <section aria-label="Thread files" className="agent-surface-tree" data-agent-surface-tree>
      <header className="agent-surface__subhead">
        <span className="agent-microlabel">files</span>
        <span className="agent-session__spacer" />
        <button
          aria-label="Refresh workspace files"
          className="agent-iconbutton"
          disabled={gone}
          onClick={tree.refresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={12} />
        </button>
      </header>

      {gone && <p className="agent-note agent-note--warning">{SURFACE_TREE_GONE_MESSAGE}</p>}
      {tree.rootError !== null && <p className="agent-note agent-note--bad">{tree.rootError}</p>}
      {truncated && (
        <p className="agent-note agent-note--warning">
          Folders show at most {MAX_AGENT_SURFACE_TREE_ENTRIES} entries.
        </p>
      )}

      {!gone && (
        <div className="agent-surface-tree__viewport">
          <FileTree
            activePath={activePath}
            entriesByDirectory={tree.entriesByDirectory}
            expandedDirectories={tree.expandedDirectories}
            failedDirectories={tree.failedDirectories}
            fileStatusesByPath={fileStatusesByPath}
            loadingDirectories={tree.loadingDirectories}
            onOpenFile={onOpenFile}
            onPreviewFile={onPreviewFile}
            onRetryDirectory={tree.retryDirectory}
            onToggleDirectory={tree.toggleDirectory}
            revealActivePath={activePath !== null}
            revealActivePathSignal={revealActivePathSignal}
            rootPath={tree.rootPath}
          />
        </div>
      )}
    </section>
  );
}
