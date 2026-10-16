import { useMemo } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { useAgentThreadBranchRecorder } from "../../../application/useAgentThreadBranchRecorder";
import type { GitChangedFile } from "../../../domain/git";
import { AgentPanelWindowControls } from "../AgentPanelLayoutControls";
import { AgentSidebarReveal } from "../AgentSidebarReveal";
import { AgentAgentsPanelSurface } from "../agents/AgentAgentsPanelSurface";
import { AgentAgentsToggleButton } from "../agents/AgentAgentsToggleButton";
import { agentNewThreadTooltip } from "../agentNewThreadRequest";
import { agentProjectTerminalSessionsTarget } from "../agentSidebarPresentation";
import { defaultAgentPanelLayoutShortcuts } from "../agentThreadHeaderPresentation";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentComposerDrawerExtras } from "../useAgentComposerDrawerExtras";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeProjects } from "./useAgentModeProjects";
import type { AgentModeRailProjects } from "./useAgentModeRailProjects";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeTerminalSessions } from "./useAgentModeTerminalSessions";

const AGENTS_TOGGLE_BUTTON = <AgentAgentsToggleButton />;
const AGENTS_PANEL_SURFACE = <AgentAgentsPanelSurface />;

export interface AgentModeHeaderChromeOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly surfaceState: AgentModeSurface;
  readonly railProjects: AgentModeRailProjects;
  readonly terminalSessions: AgentModeTerminalSessions;
  readonly headerProject: AgentModeCreation["headerProject"];
  readonly sidebarRevealDetail: string | null;
  readonly selectedThread: AgentThreadView | null;
  refreshRemoteProjects(): Promise<void>;
}

export function useAgentModeHeaderChrome({
  agents,
  chrome,
  navigation,
  projectsState,
  surfaceState,
  railProjects,
  terminalSessions,
  headerProject,
  sidebarRevealDetail,
  selectedThread,
  refreshRemoteProjects,
}: AgentModeHeaderChromeOptions) {
  const { railScopeEntries, threadBranchMemory } = projectsState;
  const { surface, responsivePanelRestore, toggleResponsivePanel, diffScopes } = surfaceState;
  const { layout, toggleRail, toggleRightPanel } = surface;
  const { requestNewThread } = railProjects;
  const { railTerminalSessionsTarget, openTerminalSessions } = terminalSessions;
  const revealWorkingTreeFile = diffScopes.revealWorkingTreeFile;
  const panelShortcuts = chrome.shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const newThreadInShortcut =
    panelShortcuts.newThreadIn ?? defaultAgentPanelLayoutShortcuts().newThreadIn ?? "";
  const newThreadTitle = agentNewThreadTooltip({
    shortcut: panelShortcuts.newThread,
    pickerShortcut: newThreadInShortcut,
    projectLabel: headerProject?.label ?? null,
    projectCount: railScopeEntries.length,
  });
  const sidebarReveal = useMemo(
    () => (
      <AgentSidebarReveal
        currentProjectLabel={headerProject?.label ?? null}
        detail={sidebarRevealDetail}
        onExpand={toggleRail}
        onNewThread={requestNewThread}
        projectCount={railScopeEntries.length}
        shortcuts={chrome.shortcuts}
      />
    ),
    [
      chrome.shortcuts,
      headerProject?.label,
      railScopeEntries.length,
      requestNewThread,
      sidebarRevealDetail,
      toggleRail,
    ],
  );
  const scopeEntries = navigation.scopeEntries;
  const headerTerminalSessionsTarget = useMemo(() => {
    if (headerProject === null) return railTerminalSessionsTarget;
    return agentProjectTerminalSessionsTarget(headerProject, scopeEntries);
  }, [headerProject, railTerminalSessionsTarget, scopeEntries]);
  const terminalProjectRootKey = headerTerminalSessionsTarget?.projectRootKey ?? null;
  const terminalRepositoryRoot = headerTerminalSessionsTarget?.repositoryRoot ?? null;
  const openTerminalSessionsCommand = useAgentLatestCallback(openTerminalSessions);
  const openHeaderTerminalSessions = useMemo(() => {
    if (
      terminalProjectRootKey === null ||
      terminalRepositoryRoot === null ||
      terminalProjectRootKey.startsWith("remote:")
    )
      return null;
    return () => openTerminalSessionsCommand(terminalProjectRootKey, terminalRepositoryRoot);
  }, [openTerminalSessionsCommand, terminalProjectRootKey, terminalRepositoryRoot]);
  const layoutControls = useMemo(
    () => (
      <AgentPanelWindowControls
        maximize={{
          maximized: layout.rightPanelMaximized || responsivePanelRestore !== "none",
          onToggle: toggleResponsivePanel,
        }}
        onClose={toggleRightPanel}
      />
    ),
    [layout.rightPanelMaximized, responsivePanelRestore, toggleResponsivePanel, toggleRightPanel],
  );
  const surfaceAgents = useMemo(
    () => ({
      showChanges: agents.showChanges,
      showFileDiff: agents.showFileDiff,
      hideFileDiff: agents.hideFileDiff,
      openChangedFile: agents.openChangedFile,
      openChangedFileDiff: (threadId: string, change: GitChangedFile): Promise<void> => {
        revealWorkingTreeFile(threadId, change.relativePath);
        return Promise.resolve();
      },
      getTurnChanges: agents.getTurnChanges,
      getTurnFileDiff: agents.getTurnFileDiff,
      turnChangesRevision: agents.turnChangesRevision,
      getTurnChangesRevision: agents.getTurnChangesRevision,
    }),
    [
      agents.getTurnChanges,
      agents.getTurnChangesRevision,
      agents.getTurnFileDiff,
      agents.hideFileDiff,
      agents.openChangedFile,
      agents.showChanges,
      agents.showFileDiff,
      agents.turnChangesRevision,
      revealWorkingTreeFile,
    ],
  );
  useAgentThreadBranchRecorder(agents.threads, chrome.liveCheckoutBranches, threadBranchMemory);
  const composerExtras = useAgentComposerDrawerExtras(chrome.branchCheckout, agents.accountUsage, {
    thread: selectedThread,
    branchMemory: threadBranchMemory,
    liveCheckoutBranches: chrome.liveCheckoutBranches,
    retryServer: refreshRemoteProjects,
  });
  return {
    agentsToggleButton: AGENTS_TOGGLE_BUTTON,
    agentsPanelSurface: AGENTS_PANEL_SURFACE,
    newThreadTitle,
    sidebarReveal,
    openHeaderTerminalSessions,
    layoutControls,
    surfaceAgents,
    composerExtras,
  };
}

export type AgentModeHeaderChrome = ReturnType<typeof useAgentModeHeaderChrome>;
