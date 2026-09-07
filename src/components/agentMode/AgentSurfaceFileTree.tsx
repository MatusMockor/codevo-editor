import { RefreshCw, Search } from "lucide-react";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import { MAX_AGENT_SURFACE_TREE_ENTRIES } from "../../application/useAgentSurfaceFileTree";
import type { GitChangeStatus } from "../../domain/git";
import type { FileEntry } from "../../domain/workspace";
import { FileTree } from "../FileTree";
import {
  SURFACE_FILES_NO_PROJECT_DESCRIPTION,
  SURFACE_FILES_UNTRUSTED_DESCRIPTION,
  agentSurfaceForeignRootMessage,
} from "./agentSurfacePolicy";
import { agentControlTooltip } from "./agentThreadHeaderPresentation";
import { ariaKeyShortcuts } from "./agentWorkbenchChrome";

export const SURFACE_TREE_GONE_MESSAGE = "This thread's checkout is gone.";
export const SURFACE_TREE_PROJECT_GONE_MESSAGE = "The project's files are unavailable.";
export const SURFACE_TREE_NO_PROJECT_MESSAGE = SURFACE_FILES_NO_PROJECT_DESCRIPTION;
export const SURFACE_TREE_UNTRUSTED_MESSAGE = SURFACE_FILES_UNTRUSTED_DESCRIPTION;
export const SURFACE_TREE_SEARCH_LABEL = "Search files";

export interface AgentSurfaceSearchFiles {
  readonly shortcut: string;
  open(): void;
}

export type AgentSurfaceTreeSource = "thread" | "project";

export type AgentSurfaceTreeUnavailable =
  | { readonly kind: "checkoutGone" }
  | { readonly kind: "projectGone" }
  | { readonly kind: "noProject" }
  | { readonly kind: "untrusted"; readonly onTrust: (() => void) | null }
  | {
      readonly kind: "foreignRoot";
      readonly label: string;
      readonly onSwitch: (() => void) | null;
    };

export interface AgentSurfaceFileTreeProps {
  readonly source: AgentSurfaceTreeSource;
  readonly tree: AgentSurfaceFileTreeSurface;
  readonly unavailable: AgentSurfaceTreeUnavailable | null;
  readonly activePath: string | null;
  readonly revealActivePathSignal: number;
  readonly fileStatusesByPath?: Record<string, GitChangeStatus>;
  readonly searchFiles: AgentSurfaceSearchFiles | null;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
}

const CHECKOUT_GONE: AgentSurfaceTreeUnavailable = { kind: "checkoutGone" };
const PROJECT_GONE: AgentSurfaceTreeUnavailable = { kind: "projectGone" };

function rootGone(source: AgentSurfaceTreeSource): AgentSurfaceTreeUnavailable {
  switch (source) {
    case "thread":
      return CHECKOUT_GONE;
    case "project":
      return PROJECT_GONE;
  }
}

function treeLabel(source: AgentSurfaceTreeSource): string {
  switch (source) {
    case "thread":
      return "Thread files";
    case "project":
      return "Project files";
  }
}

function unavailableMessage(unavailable: AgentSurfaceTreeUnavailable): string {
  switch (unavailable.kind) {
    case "checkoutGone":
      return SURFACE_TREE_GONE_MESSAGE;
    case "projectGone":
      return SURFACE_TREE_PROJECT_GONE_MESSAGE;
    case "noProject":
      return SURFACE_TREE_NO_PROJECT_MESSAGE;
    case "untrusted":
      return SURFACE_TREE_UNTRUSTED_MESSAGE;
    case "foreignRoot":
      return agentSurfaceForeignRootMessage(unavailable.label);
  }
}

interface UnavailableAction {
  readonly label: string;
  readonly ariaLabel: string;
  run(): void;
}

function unavailableAction(unavailable: AgentSurfaceTreeUnavailable): UnavailableAction | null {
  switch (unavailable.kind) {
    case "checkoutGone":
    case "projectGone":
    case "noProject":
      return null;
    case "untrusted":
      return null;
    case "foreignRoot":
      if (unavailable.onSwitch === null) return null;
      return {
        label: "Switch",
        ariaLabel: `Switch to ${unavailable.label}`,
        run: unavailable.onSwitch,
      };
  }
}

function UnavailableNote({ unavailable }: { readonly unavailable: AgentSurfaceTreeUnavailable }) {
  const action = unavailableAction(unavailable);
  return (
    <p className="agent-note agent-note--warning" data-agent-surface-tree-unavailable>
      {unavailableMessage(unavailable)}
      {action !== null && (
        <button
          aria-label={action.ariaLabel}
          className="agent-linkbutton"
          onClick={action.run}
          type="button"
        >
          {action.label}
        </button>
      )}
    </p>
  );
}

export function AgentSurfaceFileTree({
  activePath,
  fileStatusesByPath,
  onOpenFile,
  onPreviewFile,
  revealActivePathSignal,
  searchFiles,
  source,
  tree,
  unavailable,
}: AgentSurfaceFileTreeProps) {
  const blocked = unavailable ?? (tree.rootPath === null ? rootGone(source) : null);
  const truncated = tree.truncatedDirectories.size > 0;
  const searchShortcut = searchFiles === null ? "" : ariaKeyShortcuts(searchFiles.shortcut);
  const searchTitle =
    searchFiles === null
      ? SURFACE_TREE_SEARCH_LABEL
      : agentControlTooltip(SURFACE_TREE_SEARCH_LABEL, searchFiles.shortcut);

  return (
    <section
      aria-label={treeLabel(source)}
      className="agent-surface-tree"
      data-agent-surface-tree
      data-agent-surface-tree-source={source}
    >
      <div className="agent-surface-tree__tools">
        <button
          aria-label="Refresh workspace files"
          className="agent-iconbutton"
          disabled={blocked !== null}
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

      {blocked !== null && <UnavailableNote unavailable={blocked} />}
      {tree.rootError !== null && <p className="agent-note agent-note--bad">{tree.rootError}</p>}
      {truncated && (
        <p className="agent-note agent-note--warning">
          Folders show at most {MAX_AGENT_SURFACE_TREE_ENTRIES} entries.
        </p>
      )}

      {blocked === null && tree.rootPath !== null && (
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
