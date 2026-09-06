import { RefreshCw, Search } from "lucide-react";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import { MAX_AGENT_SURFACE_TREE_ENTRIES } from "../../application/useAgentSurfaceFileTree";
import type { GitChangeStatus } from "../../domain/git";
import type { FileEntry } from "../../domain/workspace";
import { FileTree } from "../FileTree";
import { agentControlTooltip } from "./agentThreadHeaderPresentation";
import { ariaKeyShortcuts } from "./agentWorkbenchChrome";

export const SURFACE_TREE_GONE_MESSAGE = "This thread's checkout is gone.";
export const SURFACE_TREE_SEARCH_LABEL = "Search files";

export interface AgentSurfaceSearchFiles {
  readonly shortcut: string;
  open(): void;
}

export interface AgentSurfaceFileTreeProps {
  readonly tree: AgentSurfaceFileTreeSurface;
  readonly activePath: string | null;
  readonly revealActivePathSignal: number;
  readonly fileStatusesByPath?: Record<string, GitChangeStatus>;
  readonly searchFiles: AgentSurfaceSearchFiles | null;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
}

export function AgentSurfaceFileTree({
  activePath,
  fileStatusesByPath,
  onOpenFile,
  onPreviewFile,
  revealActivePathSignal,
  searchFiles,
  tree,
}: AgentSurfaceFileTreeProps) {
  const gone = tree.rootPath === null;
  const truncated = tree.truncatedDirectories.size > 0;
  const searchShortcut = searchFiles === null ? "" : ariaKeyShortcuts(searchFiles.shortcut);
  const searchTitle =
    searchFiles === null
      ? SURFACE_TREE_SEARCH_LABEL
      : agentControlTooltip(SURFACE_TREE_SEARCH_LABEL, searchFiles.shortcut);

  return (
    <section aria-label="Thread files" className="agent-surface-tree" data-agent-surface-tree>
      <div className="agent-surface-tree__tools">
        <button
          aria-label="Refresh workspace files"
          className="agent-iconbutton"
          disabled={gone}
          onClick={tree.refresh}
          title="Refresh workspace files"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <button
          aria-keyshortcuts={searchShortcut === "" ? undefined : searchShortcut}
          className="agent-surface-tree__search"
          disabled={searchFiles === null}
          onClick={() => searchFiles?.open()}
          title={searchTitle}
          type="button"
        >
          <Search aria-hidden="true" size={14} />
          <span>{SURFACE_TREE_SEARCH_LABEL}</span>
        </button>
      </div>

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
