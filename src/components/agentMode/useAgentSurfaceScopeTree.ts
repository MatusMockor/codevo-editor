import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  isInsideAgentSurfaceRoot,
  agentSurfaceTreeTargetKey,
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
  readonly chrome: Pick<
    AgentWorkbenchChrome,
    "workspaceId" | "fileTree" | "layout" | "workspaceActivation"
  >;
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
  if (scope.kind !== "repository") return null;
  if (thread !== null) {
    if (thread.thread.owner.rootKey !== scope.projectRootKey) return null;
    return threadTreeTarget(workspaceId, thread, threadRootPath, scope);
  }
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
  scope: Extract<AgentSurfaceScope, { kind: "repository" }>,
): AgentSurfaceFileTreeTarget | null {
  if (workspaceId === null) return null;
  if (threadRootPath === null) return null;
  if (agentSurfaceTargetGone(thread)) return null;
  return {
    kind: "thread",
    workspaceId,
    threadId: thread.thread.threadId,
    rootPath: threadRootPath,
    projectOwner: { ownerId: scope.ownerId, generation: scope.generation },
  };
}

export function agentSurfaceTreeUnavailable(
  thread: AgentThreadView | null,
  scope: AgentSurfaceScope,
  action: (() => void) | null,
): AgentSurfaceTreeUnavailable | null {
  switch (scope.kind) {
    case "none":
      return NO_PROJECT;
    case "foreignRoot":
      return { kind: "foreignRoot", label: scope.label, onSwitch: action };
    case "untrusted":
      return { kind: "untrusted", onTrust: action };
    case "repository":
      if (thread !== null && thread.thread.owner.rootKey !== scope.projectRootKey)
        return NO_PROJECT;
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
  const activation = chrome.workspaceActivation?.state;
  const workspaceReady =
    activation === undefined ||
    (activation.kind === "ready" &&
      scope.kind === "repository" &&
      activation.rootPath === scope.rootPath);
  const target = useMemo(
    () =>
      agentSurfaceTreeTarget(
        chrome.workspaceId,
        thread,
        threadRootPath,
        scope,
        filesOpen && workspaceReady,
      ),
    [chrome.workspaceId, filesOpen, scope, thread, threadRootPath, workspaceReady],
  );
  const targetKey = agentSurfaceTreeTargetKey(target);
  const authorityRef = useRef({ key: targetKey });
  if (authorityRef.current.key !== targetKey) authorityRef.current = { key: targetKey };
  const authority = authorityRef.current;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
        if (!mountedRef.current || authorityRef.current !== authority) return;
        if (rootPath === null || !isInsideAgentSurfaceRoot(rootPath, entry.path)) return;
        open(entry);
        maximizeForDocument();
      };
    const unavailable = agentSurfaceTreeUnavailable(thread, scope, scopeAction);
    const searchFiles =
      unavailable === null && workspaceReady ? searchFilesFromChrome(fileTreeChrome) : null;
    return {
      source,
      tree,
      unavailable,
      activePath:
        unavailable === null &&
        rootPath !== null &&
        fileTreeChrome.activePath !== null &&
        isInsideAgentSurfaceRoot(rootPath, fileTreeChrome.activePath)
          ? fileTreeChrome.activePath
          : null,
      revealActivePathSignal: fileTreeChrome.revealActivePathSignal,
      fileStatusesByPath: fileTreeChrome.fileStatusesByPath,
      searchFiles:
        searchFiles === null
          ? null
          : {
              shortcut: searchFiles.shortcut,
              open: () => {
                if (!mountedRef.current || authorityRef.current !== authority) return;
                searchFiles.open();
              },
            },
      onOpenFile: guarded(fileTreeChrome.onOpenFile),
      onPreviewFile: guarded(fileTreeChrome.onPreviewFile),
    };
  }, [
    authority,
    fileTreeChrome,
    maximizeForDocument,
    rootPath,
    scope,
    scopeAction,
    source,
    thread,
    tree,
    workspaceReady,
  ]);
}
