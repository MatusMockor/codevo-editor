import { useCallback, useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  isInsideAgentSurfaceRoot,
  useAgentSurfaceFileTree,
  type AgentSurfaceFileTreeDependencies,
  type AgentSurfaceFileTreeTarget,
} from "../../application/useAgentSurfaceFileTree";
import type { FileEntry } from "../../domain/workspace";
import { agentSurfaceTargetGone } from "./agentModePresentation";
import type {
  AgentSurfaceFileTreeProps,
  AgentSurfaceTreeSource,
  AgentSurfaceTreeUnavailable,
} from "./AgentSurfaceFileTree";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";
import type { AgentWorkbenchChrome, AgentWorkbenchFileTreeChrome } from "./agentWorkbenchChrome";

export interface AgentSurfaceScopeTreeOptions {
  readonly chrome: Pick<AgentWorkbenchChrome, "workspaceId" | "fileTree" | "layout">;
  readonly thread: AgentThreadView | null;
  readonly threadRootPath: string | null;
  readonly scope: AgentSurfaceScope;
  readonly filesOpen: boolean;
  readonly onSwitchScope: ((rootPath: string) => void) | null;
  onTrustScope(projectRootKey: string): void;
}

const UNAVAILABLE_FILES: AgentSurfaceFileTreeDependencies["files"] = {
  readDirectory: () => Promise.reject(new Error("The file tree is not available here.")),
};

const NO_PROJECT: AgentSurfaceTreeUnavailable = { kind: "noProject" };

export function agentSurfaceTreeTarget(
  workspaceId: string | null,
  thread: AgentThreadView | null,
  threadRootPath: string | null,
  scope: AgentSurfaceScope,
  filesOpen: boolean,
): AgentSurfaceFileTreeTarget | null {
  if (!filesOpen) return null;
  if (thread !== null) return threadTreeTarget(workspaceId, thread, threadRootPath);
  if (scope.kind !== "repository") return null;
  return {
    kind: "project",
    ownerId: scope.ownerId,
    generation: scope.generation,
    rootPath: scope.rootPath,
  };
}

function threadTreeTarget(
  workspaceId: string | null,
  thread: AgentThreadView,
  threadRootPath: string | null,
): AgentSurfaceFileTreeTarget | null {
  if (workspaceId === null) return null;
  if (threadRootPath === null) return null;
  if (agentSurfaceTargetGone(thread)) return null;
  return {
    kind: "thread",
    workspaceId,
    threadId: thread.thread.threadId,
    rootPath: threadRootPath,
  };
}

export function agentSurfaceTreeUnavailable(
  thread: AgentThreadView | null,
  scope: AgentSurfaceScope,
  action: (() => void) | null,
): AgentSurfaceTreeUnavailable | null {
  if (thread !== null) return null;
  switch (scope.kind) {
    case "none":
      return NO_PROJECT;
    case "foreignRoot":
      return { kind: "foreignRoot", label: scope.label, onSwitch: action };
    case "untrusted":
      return { kind: "untrusted", onTrust: action };
    case "repository":
      return null;
  }
}

function searchFilesFromChrome(
  chrome: AgentWorkbenchFileTreeChrome,
): AgentSurfaceFileTreeProps["searchFiles"] {
  const open = chrome.onSearchFiles;
  if (open === undefined) return null;
  return { shortcut: chrome.searchFilesShortcut ?? "", open };
}

export function useAgentSurfaceScopeTree({
  chrome,
  filesOpen,
  onSwitchScope,
  onTrustScope,
  scope,
  thread,
  threadRootPath,
}: AgentSurfaceScopeTreeOptions): AgentSurfaceFileTreeProps | null {
  const fileTreeChrome = chrome.fileTree;
  const target = useMemo(
    () => agentSurfaceTreeTarget(chrome.workspaceId, thread, threadRootPath, scope, filesOpen),
    [chrome.workspaceId, filesOpen, scope, thread, threadRootPath],
  );
  const tree = useAgentSurfaceFileTree({
    target,
    files: fileTreeChrome?.files ?? UNAVAILABLE_FILES,
    fileChanges: fileTreeChrome?.fileChanges ?? null,
  });

  const dispatchLayout = chrome.layout.dispatch;
  const maximizeForDocument = useCallback(
    () => dispatchLayout({ kind: "maximizeRightPanel" }),
    [dispatchLayout],
  );
  const scopeAction = useMemo((): (() => void) | null => {
    switch (scope.kind) {
      case "none":
      case "repository":
        return null;
      case "untrusted": {
        const projectRootKey = scope.projectRootKey;
        return () => onTrustScope(projectRootKey);
      }
      case "foreignRoot": {
        if (onSwitchScope === null) return null;
        const rootPath = scope.rootPath;
        return () => onSwitchScope(rootPath);
      }
    }
  }, [onSwitchScope, onTrustScope, scope]);

  const source: AgentSurfaceTreeSource = thread === null ? "project" : "thread";
  const rootPath = tree.rootPath;
  return useMemo<AgentSurfaceFileTreeProps | null>(() => {
    if (fileTreeChrome === null) return null;
    const guarded =
      (open: (entry: FileEntry) => void) =>
      (entry: FileEntry): void => {
        if (rootPath === null || !isInsideAgentSurfaceRoot(rootPath, entry.path)) return;
        open(entry);
        maximizeForDocument();
      };
    const unavailable = agentSurfaceTreeUnavailable(thread, scope, scopeAction);
    return {
      source,
      tree,
      unavailable,
      activePath: unavailable === null ? fileTreeChrome.activePath : null,
      revealActivePathSignal: fileTreeChrome.revealActivePathSignal,
      fileStatusesByPath: fileTreeChrome.fileStatusesByPath,
      searchFiles: searchFilesFromChrome(fileTreeChrome),
      onOpenFile: guarded(fileTreeChrome.onOpenFile),
      onPreviewFile: guarded(fileTreeChrome.onPreviewFile),
    };
  }, [fileTreeChrome, maximizeForDocument, rootPath, scope, scopeAction, source, thread, tree]);
}
