import { useCallback, useMemo } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import {
  useAgentThreadScripts,
  type AgentThreadScriptTarget,
} from "../../../application/useAgentThreadScripts";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import type { AgentDiffTurn } from "../../../domain/diffView/agentDiffScope";
import type { RemoteRunnerContextValue } from "../../remoteRunner/remoteRunnerContext";
import { RemotePortPreviewMenu } from "../RemotePortPreviewMenu";
import { isRemoteAgentSurfaceThread } from "../agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentDiffScopeSelection } from "../useAgentDiffScopeSelection";
import { useAgentServerPorts, type AgentRemotePortPreviewWiring } from "../useAgentServerPorts";
import { useAgentShipActions } from "../useAgentShipActions";
import { useAgentSurfaceLayout } from "../useAgentSurfaceLayout";
import {
  useAgentLatestCallback,
  useAgentThreadScriptPresentation,
} from "../useAgentThreadPresentationViews";
import type { useRemoteSurfaceContext } from "../useRemoteSurfaceContext";
import { useResponsivePanelToggle } from "../useResponsivePanelToggle";
import {
  NO_REMOTE_SERVERS,
  type AgentModeAgents,
  type AgentModeNoticeReporter,
} from "./agentModeViewProps";

const NO_DIFF_TURNS: ReadonlyArray<AgentDiffTurn> = [];

export interface AgentModeSurfaceOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly selectedThread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly sessionThread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly remoteSurface: ReturnType<typeof useRemoteSurfaceContext>;
  readonly resolvingRemoteThread: boolean;
  readonly remotePortPreview: AgentRemotePortPreviewWiring | null;
  readonly remoteContext: RemoteRunnerContextValue | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly setLocalNotice: AgentModeNoticeReporter;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
  onReleaseProject(projectRootKey: string): void;
}

export function useAgentModeSurface({
  agents,
  chrome,
  selectedThread,
  selectedThreadId,
  sessionThread,
  workspaceRoot,
  remoteSurface,
  resolvingRemoteThread,
  remotePortPreview,
  remoteContext,
  textClipboard,
  setLocalNotice,
  onTrustProject,
  onReleaseProject,
}: AgentModeSurfaceOptions) {
  const shipActions = useAgentShipActions({ agents, selectedThread });
  const surface = useAgentSurfaceLayout({
    chrome,
    selectedThread,
    workspaceRoot,
    remoteSurface,
    remotePaneKey: remoteSurface?.paneKey ?? (resolvingRemoteThread ? selectedThreadId : null),
  });
  const { layout, openSurface, toggleMaximized, toggleRail, toggleRightPanel } = surface;
  const { restore: responsivePanelRestore, toggle: toggleResponsivePanel } =
    useResponsivePanelToggle({
      rightPanelMaximized: layout.rightPanelMaximized,
      toggleMaximized,
      toggleRail,
      toggleRightPanel,
    });
  const serverPorts = useAgentServerPorts({
    wiring: remotePortPreview,
    servers: remoteContext?.servers ?? NO_REMOTE_SERVERS,
    thread: selectedThread,
    terminalOpen: layout.rightPanel === "open" && layout.activeSurface === "terminal",
    clipboard: textClipboard,
    reportNotice: setLocalNotice,
  });
  const serverPortsMenu = useMemo(
    () => (serverPorts.menu === null ? null : <RemotePortPreviewMenu menu={serverPorts.menu} />),
    [serverPorts.menu],
  );
  const onShowTerminalPanel = chrome.onShowTerminalPanel;
  const scriptsTarget = useMemo(
    () =>
      selectedThread === null || selectedThread.execution?.kind === "remote"
        ? null
        : scriptTarget(selectedThread),
    [selectedThread],
  );
  const scripts = useAgentThreadScripts({
    target: scriptsTarget,
    workspaceRoot,
    runner: chrome.scripts,
    onBeforeRun: onShowTerminalPanel,
  });
  const headerScripts = useAgentThreadScriptPresentation(scripts);
  const selectedRecordedThreadId = sessionThread?.thread.threadId ?? null;
  const openDiffSurface = useCallback(() => openSurface("diff"), [openSurface]);
  const diffScopes = useAgentDiffScopeSelection({
    threadId: selectedRecordedThreadId,
    turns: sessionThread?.thread.turns ?? NO_DIFF_TURNS,
    diffActive: layout.rightPanel === "open" && layout.activeSurface === "diff",
    remote: isRemoteAgentSurfaceThread(sessionThread ?? null),
    turnDiffAvailable: agents.getTurnChanges !== undefined && agents.getTurnFileDiff !== undefined,
    openDiff: openDiffSurface,
  });
  const showChanges = agents.showChanges;
  const trustProject = useAgentLatestCallback(onTrustProject);
  const releaseProject = useAgentLatestCallback(onReleaseProject);
  const reviewWorkingTree = diffScopes.reviewWorkingTree;
  const reviewInDiff = useCallback(
    (threadId: string) => {
      void showChanges(threadId);
      reviewWorkingTree(threadId);
    },
    [reviewWorkingTree, showChanges],
  );
  return {
    shipActions,
    surface,
    responsivePanelRestore,
    toggleResponsivePanel,
    serverPorts,
    serverPortsMenu,
    scripts,
    headerScripts,
    diffScopes,
    trustProject,
    releaseProject,
    reviewInDiff,
  };
}

export type AgentModeSurface = ReturnType<typeof useAgentModeSurface>;

function scriptTarget(view: AgentThreadView): AgentThreadScriptTarget {
  const record = view.thread;
  return {
    threadId: record.threadId,
    repositoryRoot: record.owner.repositoryRoot,
    isolation: record.target.isolation,
    worktreePath: record.target.worktreePath,
    worktreeMissing: view.worktreeMissing,
  };
}
