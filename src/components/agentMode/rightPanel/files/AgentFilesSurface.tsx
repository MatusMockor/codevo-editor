import { ListChevronsDownUp, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  MAX_CHECKOUT_FILE_STATUSES,
  useCheckoutFileStatuses,
  type CheckoutFileStatusesState,
} from "../../../../application/rightPanel/useCheckoutFileStatuses";
import { useAgentFilesSearch } from "../../../../application/rightPanel/useAgentFilesSearch";
import {
  STATUS_REVISION_COALESCE_MS,
  useCoalescedValue,
} from "../../../../application/rightPanel/useCoalescedValue";
import type { GitChangeStatus } from "../../../../domain/git";
import type { FileEntry, FileSearchResult } from "../../../../domain/workspace";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Kbd } from "../../../../ui/foundation/Kbd";
import { AgentSurfaceFileTree, type AgentSurfaceFileTreeProps } from "../../AgentSurfaceFileTree";
import { agentShortcutGlyphs } from "../../agentThreadHeaderPresentation";
import {
  useAgentRightPanelContext,
  type AgentRightPanelContextValue,
} from "../agentRightPanelContext";
import { useAgentFileViewerSessions } from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { AgentFileViewer } from "../fileViewer/AgentFileViewer";
import {
  FILE_VIEWER_WIDE_MIN_WIDTH_PX,
  FILES_TIGHT_BELOW_WIDTH_PX,
} from "../fileViewer/fileViewerModel";
import { useFileViewerTreeShown } from "../fileViewer/useFileViewerWrap";
import { AgentFilesSearchResults } from "./AgentFilesSearchResults";
import { useAgentFilesViewer, type AgentFilesReveal } from "./useAgentFilesViewer";
import { useSurfaceWidth } from "./useSurfaceWidth";
import "./agentFiles.css";

export const CHECKOUT_STATUS_FAILED_NOTE =
  "Git status could not be read, so change markers are hidden.";
export const CHECKOUT_STATUS_TRUNCATED_NOTE = `Change markers cover only the first ${MAX_CHECKOUT_FILE_STATUSES.toLocaleString("en-US")} changed files.`;

export type { AgentFilesReveal } from "./useAgentFilesViewer";

export interface AgentFilesSurfaceProps {
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly treeShown: boolean;
  readonly reveal?: AgentFilesReveal | null;
}

export function AgentFilesSurface({
  fileTree: sharedFileTree,
  reveal = null,
  treeShown,
}: AgentFilesSurfaceProps) {
  const context = useAgentRightPanelContext();
  const statusRevision = useCoalescedValue(
    context.chrome?.statusRevision ?? 0,
    STATUS_REVISION_COALESCE_MS,
  );
  const [statusRefreshes, setStatusRefreshes] = useState(0);
  const gitStatusLoad = context.gitStatus.load;
  const revision = useMemo(
    () => [gitStatusLoad, statusRevision, statusRefreshes] as const,
    [gitStatusLoad, statusRevision, statusRefreshes],
  );
  const checkoutStatuses = useCheckoutFileStatuses({
    git: context.workspaceTrusted ? (context.chrome?.gateways.git ?? null) : null,
    root: treeShown && sharedFileTree !== null ? context.checkoutRoot : null,
    revision,
  });
  const worktreePath = context.thread?.thread.target.worktreePath ?? null;
  const repositoryRoot = context.thread?.thread.owner.repositoryRoot ?? null;
  const checkout = useMemo(
    () =>
      worktreePath === null || repositoryRoot === null
        ? null
        : { projectRoot: repositoryRoot, checkoutRoot: worktreePath },
    [repositoryRoot, worktreePath],
  );
  const sessions = useAgentFileViewerSessions();
  const viewer = useAgentFilesViewer({
    owner: viewerOwner(context),
    threadId: context.thread?.thread.threadId ?? null,
    tree: sharedFileTree?.tree ?? null,
    reveal,
    checkout,
    sessions,
  });
  const viewerOpen = viewer.open;
  const fileTree = useMemo(() => {
    if (sharedFileTree === null) return null;
    const statuses = treeStatuses(checkoutStatuses, worktreePath !== null);
    return {
      ...sharedFileTree,
      ...(statuses === null ? {} : { fileStatusesByPath: statuses }),
      activePath: viewer.treeFocus ?? sharedFileTree.activePath,
      revealActivePathSignal: sharedFileTree.revealActivePathSignal + viewer.treeFocusSignal,
      onOpenFile: viewerOpen,
      onPreviewFile: viewerOpen,
    };
  }, [
    checkoutStatuses,
    sharedFileTree,
    viewer.treeFocus,
    viewer.treeFocusSignal,
    viewerOpen,
    worktreePath,
  ]);
  const refreshFiles = (): void => {
    fileTree?.tree.refresh();
    context.gitStatus.refresh();
    setStatusRefreshes((count) => count + 1);
  };
  const statusNote = checkoutStatusNote(checkoutStatuses);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const width = useSurfaceWidth(sectionRef);
  const [treeBeside, toggleTreeBeside] = useFileViewerTreeShown();
  const rootPath = fileTree?.tree.rootPath ?? null;
  const searchable = treeShown && fileTree !== null && fileTree.searchFiles !== null;
  const search = useAgentFilesSearch({
    gateway: context.chrome?.gateways.fileSearch ?? null,
    root: searchable ? rootPath : null,
    query,
  });
  const querying = searchable && query.trim() !== "";
  const target = treeShown && fileTree !== null ? viewer.target : null;
  const narrow = width > 0 && width < FILE_VIEWER_WIDE_MIN_WIDTH_PX;
  const tight = width > 0 && width < FILES_TIGHT_BELOW_WIDTH_PX;
  const treeColumn = treeShown && fileTree !== null && (target === null || treeBeside);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (event.key !== "ArrowDown") return;
    const first = listRef.current?.querySelector<HTMLElement>(
      '[role="option"]:not([aria-disabled="true"])',
    );
    if (first === null || first === undefined) return;
    event.preventDefault();
    first.focus();
  };

  return (
    <section aria-label="Files" className={surfaceClassName(narrow, tight)} ref={sectionRef}>
      <div
        className={
          target === null
            ? "cv-files__split agent-surface__files"
            : "cv-files__split cv-files__split--viewer agent-surface__files"
        }
      >
        {target !== null && (
          <div className="cv-files__column cv-files__column--main">
            <AgentFileViewer
              copyText={context.copyText}
              onBack={viewer.close}
              onMarkdownModeChange={viewer.setMarkdownMode}
              onRefresh={refreshFiles}
              onRevealDirectory={viewer.revealDirectory}
              onScrollTopChange={viewer.rememberScroll}
              owner={viewer.owner}
              refreshKey={statusRevision + statusRefreshes}
              target={target}
              treeToggle={{ shown: treeBeside, onToggle: toggleTreeBeside }}
            />
          </div>
        )}
        {treeColumn && fileTree !== null && (
          <div
            className={
              target === null
                ? "cv-files__column cv-files__column--main"
                : "cv-files__column cv-files__column--tree"
            }
          >
            <div className="cv-rp-sub cv-files__sub">
              <label
                className="cv-files__search"
                onClick={(event) => {
                  if (event.target !== inputRef.current) inputRef.current?.focus();
                }}
              >
                <Search aria-hidden="true" size={14} />
                <input
                  aria-label="Search workspace files"
                  disabled={!searchable}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search files"
                  ref={inputRef}
                  spellCheck={false}
                  type="text"
                  value={query}
                />
                {shortcutGlyphs(fileTree) !== "" && <Kbd>{shortcutGlyphs(fileTree)}</Kbd>}
              </label>
              <div className="cv-rp-sub__tools">
                <IconButton
                  disabled={fileTree.unavailable !== null || rootPath === null}
                  icon={<RefreshCw size={14} />}
                  label="Refresh workspace files"
                  onClick={refreshFiles}
                  size="xs"
                />
                <IconButton
                  disabled={querying || fileTree.tree.expandedDirectories.size === 0}
                  icon={<ListChevronsDownUp size={14} />}
                  label="Collapse all folders"
                  onClick={() => collapseAll(fileTree)}
                  size="xs"
                />
              </div>
            </div>
            {statusNote !== null && (
              <p className="cv-files__note" role="status">
                {statusNote}
              </p>
            )}
            {querying && (
              <AgentFilesSearchResults
                key={query.trim()}
                listRef={listRef}
                onOpen={(result) => viewerOpen(resultEntry(result))}
                search={search}
              />
            )}
            {!querying && <AgentSurfaceFileTree {...fileTree} />}
          </div>
        )}
      </div>
    </section>
  );
}

function surfaceClassName(narrow: boolean, tight: boolean): string {
  if (tight) return "cv-files cv-files--narrow cv-files--tight";
  return narrow ? "cv-files cv-files--narrow" : "cv-files";
}

function viewerOwner(context: AgentRightPanelContextValue): string {
  if (context.thread !== null) return `thread:${context.thread.thread.threadId}`;
  if (context.scope.kind === "repository") return `project:${context.scope.ownerId}`;
  return `scope:${context.scope.kind}`;
}

function treeStatuses(
  state: CheckoutFileStatusesState,
  worktree: boolean,
): Record<string, GitChangeStatus> | null {
  switch (state.kind) {
    case "unavailable":
      return null;
    case "loading":
      return worktree ? {} : null;
    case "failed":
      return {};
    case "loaded":
      return { ...state.statuses };
    default:
      return unsupportedState(state);
  }
}

function checkoutStatusNote(state: CheckoutFileStatusesState): string | null {
  if (state.kind === "failed") return CHECKOUT_STATUS_FAILED_NOTE;
  if (state.kind === "loaded" && state.truncated) return CHECKOUT_STATUS_TRUNCATED_NOTE;
  return null;
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported checkout status state: ${String(state)}.`);
}

function collapseAll(fileTree: AgentSurfaceFileTreeProps): void {
  for (const path of [...fileTree.tree.expandedDirectories]) fileTree.tree.toggleDirectory(path);
}

function shortcutGlyphs(fileTree: AgentSurfaceFileTreeProps): string {
  if (fileTree.searchFiles === null) return "";
  return agentShortcutGlyphs(fileTree.searchFiles.shortcut);
}

function resultEntry(result: FileSearchResult): FileEntry {
  return { name: result.name, path: result.path, kind: "file" };
}
