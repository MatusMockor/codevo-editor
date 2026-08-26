import { useMemo, type ReactNode } from "react";
import type { AgentThreadView, AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  useAgentSurfaceFileTree,
  type AgentSurfaceFileTreeDependencies,
  type AgentSurfaceFileTreeTarget,
} from "../../application/useAgentSurfaceFileTree";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import { agentSurfaceTargetGone } from "./agentModePresentation";
import {
  AgentSurfacePanel,
  type AgentSurfaceDiffPanelProps,
  type AgentSurfaceTerminalPanelProps,
} from "./AgentSurfacePanel";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";

export type AgentSurfaceHostAgents = Pick<
  AgentThreadsSurface,
  "showChanges" | "showFileDiff" | "hideFileDiff" | "openChangedFile" | "openChangedFileDiff"
>;

export interface AgentSurfaceHostProps {
  readonly chrome: AgentWorkbenchChrome;
  readonly layout: Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface">;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly agents: AgentSurfaceHostAgents;
  readonly layoutControls: ReactNode;
  readonly hidden: boolean;
  readonly chooserAutoFocus: boolean;
  onOpenSurface(surface: AgentSurfaceKind): void;
  onActivateSurface(surface: AgentSurfaceKind): void;
  onCloseSurfaceTab(surface: AgentSurfaceKind): void;
  onClosePanel(): void;
}

const UNAVAILABLE_FILES: AgentSurfaceFileTreeDependencies["files"] = {
  readDirectory: () => Promise.reject(new Error("The file tree is not available here.")),
};

export function AgentSurfaceHost({
  agents,
  chooserAutoFocus,
  chrome,
  hidden,
  layout,
  layoutControls,
  onActivateSurface,
  onClosePanel,
  onCloseSurfaceTab,
  onOpenSurface,
  thread,
  workspaceRoot,
}: AgentSurfaceHostProps) {
  const fileTreeChrome = chrome.fileTree;
  const filesOpen = layout.openSurfaces.includes("files");
  const target = useMemo(
    () => fileTreeTarget(chrome.workspaceId, thread, filesOpen),
    [chrome.workspaceId, filesOpen, thread],
  );
  const tree = useAgentSurfaceFileTree({
    target,
    files: fileTreeChrome?.files ?? UNAVAILABLE_FILES,
    fileChanges: fileTreeChrome?.fileChanges ?? null,
  });

  const fileTree =
    fileTreeChrome === null || thread === null
      ? null
      : {
          tree,
          activePath: fileTreeChrome.activePath,
          revealActivePathSignal: fileTreeChrome.revealActivePathSignal,
          fileStatusesByPath: fileTreeChrome.fileStatusesByPath,
          onOpenFile: fileTreeChrome.onOpenFile,
          onPreviewFile: fileTreeChrome.onPreviewFile,
        };

  const diff = useMemo<AgentSurfaceDiffPanelProps | null>(
    () =>
      thread === null
        ? null
        : {
            ...chrome.diff,
            summary: thread.changeSummary,
            onShowChanges: (threadId) => void agents.showChanges(threadId),
            onRefreshChanges: (threadId) => void agents.showChanges(threadId),
            onShowFileDiff: (threadId, change) => void agents.showFileDiff(threadId, change),
            onHideFileDiff: (threadId) => agents.hideFileDiff(threadId),
            onOpenChangedFile: (threadId, change) => void agents.openChangedFile(threadId, change),
            onOpenChangedFileDiff: (threadId, change) =>
              void agents.openChangedFileDiff(threadId, change),
          },
    [agents, chrome.diff, thread],
  );

  const terminalChrome = chrome.terminal;
  const terminal = useMemo<AgentSurfaceTerminalPanelProps | null>(() => {
    if (terminalChrome === null || chrome.workspaceId === null || thread === null) return null;
    if (workspaceRoot === null) return null;
    return {
      workspaceId: chrome.workspaceId,
      workspaceRoot,
      workspaceTrusted: chrome.workspaceTrusted,
      terminalGateway: terminalChrome.terminalGateway,
      terminalTheme: terminalChrome.terminalTheme,
      profileId: null,
      profileLabel: null,
      shellIntegrationEnabled: terminalChrome.shellIntegrationEnabled,
      onTrustWorkspace: chrome.onTrustWorkspace,
      onOpenLink: terminalChrome.onOpenLink,
    };
  }, [
    chrome.onTrustWorkspace,
    chrome.workspaceId,
    chrome.workspaceTrusted,
    terminalChrome,
    thread,
    workspaceRoot,
  ]);

  return (
    <div
      aria-hidden={hidden || undefined}
      className="agent-surface-host"
      data-slot="surface"
      hidden={hidden}
    >
      <AgentSurfacePanel
        chooserAutoFocus={chooserAutoFocus}
        diff={diff}
        hidden={hidden}
        fileTree={fileTree}
        layout={layout}
        layoutControls={layoutControls}
        onActivateSurface={onActivateSurface}
        onClosePanel={onClosePanel}
        onCloseSurfaceTab={onCloseSurfaceTab}
        onOpenSurface={onOpenSurface}
        onResizeStart={chrome.onResizeRightPanelStart}
        onTrustWorkspace={chrome.onTrustWorkspace}
        terminal={terminal}
        thread={thread}
        workspaceRoot={workspaceRoot}
        workspaceTrusted={chrome.workspaceTrusted}
      />
    </div>
  );
}

function fileTreeTarget(
  workspaceId: string | null,
  thread: AgentThreadView | null,
  filesOpen: boolean,
): AgentSurfaceFileTreeTarget | null {
  if (!filesOpen || workspaceId === null || thread === null) return null;
  if (agentSurfaceTargetGone(thread)) return null;
  const record = thread.thread;
  return {
    workspaceId,
    threadId: record.threadId,
    rootPath: record.target.worktreePath ?? record.owner.repositoryRoot,
  };
}
