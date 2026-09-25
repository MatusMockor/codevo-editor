import { ChevronsDownUp, RefreshCw, Search } from "lucide-react";
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
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentFilesSearchResults } from "./AgentFilesSearchResults";
import "./agentFiles.css";

export const CHECKOUT_STATUS_FAILED_NOTE =
  "Git status could not be read, so change markers are hidden.";
export const CHECKOUT_STATUS_TRUNCATED_NOTE = `Change markers cover only the first ${MAX_CHECKOUT_FILE_STATUSES.toLocaleString("en-US")} changed files.`;

export interface AgentFilesSurfaceProps {
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly treeShown: boolean;
}

export function AgentFilesSurface({ fileTree: sharedFileTree, treeShown }: AgentFilesSurfaceProps) {
  const context = useAgentRightPanelContext();
  const worktree = (context.thread?.thread.target.worktreePath ?? null) !== null;
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
  const fileTree = useMemo(() => {
    if (sharedFileTree === null) return null;
    const statuses = treeStatuses(checkoutStatuses, worktree);
    if (statuses === null) return sharedFileTree;
    return { ...sharedFileTree, fileStatusesByPath: statuses };
  }, [checkoutStatuses, sharedFileTree, worktree]);
  const refreshFiles = (): void => {
    fileTree?.tree.refresh();
    context.gitStatus.refresh();
    setStatusRefreshes((count) => count + 1);
  };
  const statusNote = checkoutStatusNote(checkoutStatuses);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootPath = fileTree?.tree.rootPath ?? null;
  const searchable = treeShown && fileTree !== null && fileTree.searchFiles !== null;
  const search = useAgentFilesSearch({
    gateway: context.chrome?.gateways.fileSearch ?? null,
    root: searchable ? rootPath : null,
    query,
  });
  const querying = searchable && query.trim() !== "";

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
    <section aria-label="Files" className="cv-files">
      {treeShown && fileTree !== null && (
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
              icon={<ChevronsDownUp size={14} />}
              label="Collapse all folders"
              onClick={() => collapseAll(fileTree)}
              size="xs"
            />
          </div>
        </div>
      )}
      {treeShown && fileTree !== null && statusNote !== null && (
        <p className="cv-files__note" role="status">
          {statusNote}
        </p>
      )}
      <div className="cv-files__split agent-surface__files">
        {treeShown && fileTree !== null && querying && (
          <AgentFilesSearchResults
            key={query.trim()}
            listRef={listRef}
            onOpen={(result) => fileTree.onOpenFile(resultEntry(result))}
            onPreview={(result) => fileTree.onPreviewFile(resultEntry(result))}
            search={search}
          />
        )}
        {treeShown && fileTree !== null && !querying && <AgentSurfaceFileTree {...fileTree} />}
      </div>
    </section>
  );
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
