import { useLayoutEffect, type RefObject } from "react";
import { useAgentThreadUndo } from "../../../application/useAgentThreadUndo";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentComposerControllerState } from "../useAgentComposerState";
import { useAgentLocalFileLinks } from "../useAgentLocalFileLinks";
import { useAgentRemoteFileLinks } from "../useAgentRemoteFileLinks";
import { useAgentThreadMenuCommands } from "../useAgentThreadMenuCommands";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { useRemoteSurfaceContext } from "../useRemoteSurfaceContext";
import type { AgentModeAgents, AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeProjects } from "./useAgentModeProjects";

export interface AgentModeThreadMenuOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly workspaceRoot: string | null;
  readonly selectedThreadId: string | null;
  readonly remoteSurface: ReturnType<typeof useRemoteSurfaceContext>;
  readonly requestEndSessionRef: RefObject<(threadId: string) => void>;
  readonly setLocalNotice: AgentModeNoticeReporter;
  openSurface(kind: AgentSurfaceKind): void;
  trustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
  releaseProject(projectRootKey: string): void;
  onCloseProject(rootPath: string): void;
  openTerminalSessions(projectRootKey: string, repositoryRoot: string): void;
  readonly startNewThread: AgentComposerControllerState["startNewThread"];
}

export function useAgentModeThreadMenu({
  agents,
  chrome,
  navigation,
  projectsState,
  workspaceRoot,
  selectedThreadId,
  remoteSurface,
  requestEndSessionRef,
  setLocalNotice,
  openSurface,
  trustProject,
  releaseProject,
  onCloseProject,
  openTerminalSessions,
  startNewThread,
}: AgentModeThreadMenuOptions) {
  const { groups, projectRename } = projectsState;
  const selectThread = navigation.selectThread;
  const localFileLinks = useAgentLocalFileLinks(chrome.openFileLocation, setLocalNotice);
  const remoteFileLinks = useAgentRemoteFileLinks({
    surface: remoteSurface,
    openFiles: () => openSurface("files"),
    reportNotice: setLocalNotice,
  });
  const threadUndo = useAgentThreadUndo({
    ownerKey: workspaceRoot,
    threads: agents.threads,
    ports: agents,
    selectedThreadId,
    selectThread,
    reportNotice: setLocalNotice,
  });
  const menu = useAgentThreadMenuCommands({
    agents,
    groups,
    revealPath: chrome.revealPath,
    reportNotice: setLocalNotice,
    onTrustProject: trustProject,
    onReleaseProject: releaseProject,
    onRenameProject: projectRename.request,
    onCloseProject,
    onThreadRemoved: navigation.forgetThread,
    onOpenTerminalSessions: openTerminalSessions,
    startNewThread,
    undo: threadUndo.recorder,
  });
  const renameThread = useAgentLatestCallback(agents.renameThread);
  const togglePin = useAgentLatestCallback((threadId: string) =>
    menu.handleThreadMenuCommand(threadId, { kind: "togglePin" }),
  );
  const threadMenuCommand = useAgentLatestCallback(menu.handleThreadMenuCommand);
  useLayoutEffect(() => {
    requestEndSessionRef.current = (threadId) =>
      threadMenuCommand(threadId, { kind: "endSession" });
  }, [requestEndSessionRef, threadMenuCommand]);
  const threadBulkCommand = useAgentLatestCallback(menu.handleThreadBulkCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  return {
    localFileLinks,
    remoteFileLinks,
    threadUndo,
    menu,
    renameThread,
    togglePin,
    threadMenuCommand,
    threadBulkCommand,
    projectMenuCommand,
    newThread,
  };
}

export type AgentModeThreadMenu = ReturnType<typeof useAgentModeThreadMenu>;
