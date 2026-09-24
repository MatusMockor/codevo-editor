import { ChevronsDownUp, Copy, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useCheckoutFileStatuses } from "../../../../application/rightPanel/useCheckoutFileStatuses";
import { useAgentFilesSearch } from "../../../../application/rightPanel/useAgentFilesSearch";
import type { FileEntry, FileSearchResult } from "../../../../domain/workspace";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Kbd } from "../../../../ui/foundation/Kbd";
import { AgentSurfaceFileTree, type AgentSurfaceFileTreeProps } from "../../AgentSurfaceFileTree";
import { agentShortcutGlyphs } from "../../agentThreadHeaderPresentation";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentFilesSearchResults } from "./AgentFilesSearchResults";
import "./agentFiles.css";

export interface AgentFilesSurfaceProps {
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly treeShown: boolean;
  readonly editorSlot: ReactNode;
}

export function AgentFilesSurface({
  editorSlot,
  fileTree: sharedFileTree,
  treeShown,
}: AgentFilesSurfaceProps) {
  const context = useAgentRightPanelContext();
  const worktreePath = context.thread?.thread.target.worktreePath ?? null;
  const worktreeCheckout = worktreePath === null ? null : context.checkoutRoot;
  const checkoutStatuses = useCheckoutFileStatuses({
    git: context.workspaceTrusted ? (context.chrome?.gateways.git ?? null) : null,
    root: treeShown && sharedFileTree !== null ? worktreeCheckout : null,
    revision: context.gitStatus.load,
  });
  const fileTree = useMemo(
    () =>
      sharedFileTree === null || checkoutStatuses === null
        ? sharedFileTree
        : { ...sharedFileTree, fileStatusesByPath: checkoutStatuses },
    [checkoutStatuses, sharedFileTree],
  );
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
  const activePath = fileTree?.activePath ?? null;
  const relativeActive = relativeTo(rootPath, activePath);

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
              onClick={fileTree.tree.refresh}
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
        <div className="cv-files__preview">
          {fileTree !== null && activePath !== null && relativeActive !== null && (
            <div className="cv-files__crumbs" title={activePath}>
              <span className="cv-files__crumb-path">
                {relativeActive.split("/").map((segment, index, segments) => (
                  <span
                    className={
                      index === segments.length - 1
                        ? "cv-files__crumb cv-files__crumb--here"
                        : "cv-files__crumb"
                    }
                    key={`${index}-${segment}`}
                  >
                    {segment}
                  </span>
                ))}
              </span>
              <span className="cv-files__crumb-tools">
                <IconButton
                  icon={<Copy size={14} />}
                  label="Copy path"
                  onClick={() => void context.copyText(activePath).catch(() => undefined)}
                  size="xs"
                />
                <IconButton
                  icon={<ExternalLink size={14} />}
                  label="Open in editor"
                  onClick={() => fileTree.onOpenFile(fileEntry(activePath))}
                  size="xs"
                />
              </span>
            </div>
          )}
          {editorSlot}
        </div>
      </div>
    </section>
  );
}

function collapseAll(fileTree: AgentSurfaceFileTreeProps): void {
  for (const path of [...fileTree.tree.expandedDirectories]) fileTree.tree.toggleDirectory(path);
}

function shortcutGlyphs(fileTree: AgentSurfaceFileTreeProps): string {
  if (fileTree.searchFiles === null) return "";
  return agentShortcutGlyphs(fileTree.searchFiles.shortcut);
}

function relativeTo(root: string | null, path: string | null): string | null {
  if (root === null || path === null) return null;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return null;
  return path.slice(prefix.length);
}

function resultEntry(result: FileSearchResult): FileEntry {
  return { name: result.name, path: result.path, kind: "file" };
}

function fileEntry(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}
