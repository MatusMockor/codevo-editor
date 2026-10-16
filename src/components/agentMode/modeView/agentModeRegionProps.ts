import type { AgentModelFavoritesPersistence } from "../../../application/useAgentModelFavorites";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import type { AgentModeConversationProps } from "./AgentModeConversation";
import type { AgentModeHeaderProps } from "./AgentModeHeader";
import type { AgentModeRailProps } from "./AgentModeRail";
import type { AgentModeSurfaceRegionProps } from "./AgentModeSurfaceRegion";
import type { AgentModeAgents, AgentModeCloneAttachments } from "./agentModeViewProps";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeHeaderChrome } from "./useAgentModeHeaderChrome";
import type { AgentModeProjects } from "./useAgentModeProjects";
import type { AgentModeRailProjects } from "./useAgentModeRailProjects";
import type { AgentModeScope } from "./useAgentModeScope";
import type { AgentModeSelectedThread } from "./useAgentModeSelectedThread";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

export interface AgentModeRegionInputs {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly selected: AgentModeSelectedThread;
  readonly scope: AgentModeScope;
  readonly composerState: AgentModeComposer;
  readonly surfaceState: AgentModeSurface;
  readonly threadMenu: AgentModeThreadMenu;
  readonly railProjects: AgentModeRailProjects;
  readonly activity: AgentModeActivity;
  readonly creationState: AgentModeCreation;
  readonly headerChrome: AgentModeHeaderChrome;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectsLoaded: boolean;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly cloneAttachments: AgentModeCloneAttachments;
  readonly modelFavoritesPersistence: AgentModelFavoritesPersistence | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly workspaceRoot: string | null;
  selectThread: AgentThreadNavigation["selectThread"];
  onOpenSourceControl(): void;
  onOpenUsageSettings?(): void;
  onOpenEnvironmentSettings?(): void;
}

export function agentModeRailProps({
  agents,
  chrome,
  navigation,
  projectsState,
  selected,
  composerState,
  surfaceState,
  threadMenu,
  railProjects,
  activity,
  creationState,
  headerChrome,
  overflowRootPaths,
  selectedServerId,
  textClipboard,
  selectThread,
  onOpenSourceControl,
  onOpenUsageSettings,
}: AgentModeRegionInputs): AgentModeRailProps {
  const { layout } = surfaceState.surface;
  return {
    rail: layout.rail,
    railWidth: layout.railWidth,
    resetThreadId: navigation.selectedThreadId,
    selectedServerId,
    textClipboard,
    branchMemory: projectsState.threadBranchMemory.memory,
    onResetRailWidth: surfaceState.resetRailWidth,
    onResizeRail: surfaceState.resizeRail,
    catalog: projectsState.projectRename.catalog,
    collapseShortcut: chrome.shortcuts?.sidebar ?? null,
    footerActivity: activity.footerActivity,
    addProjectAvailable: chrome.addProject !== null,
    evidenceOf: projectsState.turnEvidenceOf,
    groups: projectsState.groups,
    onAddProject: creationState.openAddProject,
    onCancelPendingClone: creationState.cancelPendingClone,
    onDismissPendingClone: creationState.dismissPendingClone,
    pendingClones: creationState.creation.pendingClones,
    onOpenPendingClone: creationState.openPendingClone,
    onCollapseSidebar: surfaceState.toggleRail,
    onNewThread: railProjects.requestNewThread,
    newThreadTitle: headerChrome.newThreadTitle,
    onNewThreadInProject: railProjects.newThreadInProject,
    onFocusProject: railProjects.focusRailProject,
    onShowAllProjects: railProjects.showAllRailProjects,
    onSwitchProject: railProjects.switchRailProject,
    projectDisclosure: projectsState.projectDisclosure,
    projectFocus: projectsState.projectFocus.focus,
    workingRail: projectsState.workingRail.rail,
    onOpenProviderSettings: agents.configureAgentCli,
    onOpenSourceControl,
    onOpenUsage: onOpenUsageSettings,
    onProjectCommand: threadMenu.projectMenuCommand,
    onSelectThread: selectThread,
    onThreadBulkCommand: threadMenu.threadBulkCommand,
    onThreadMenuCommand: threadMenu.threadMenuCommand,
    onTogglePin: threadMenu.togglePin,
    overflowRootPaths,
    pendingInteractions: selected.pendingInteractions,
    providerEnabled: selected.effectiveProviderEnabled,
    providerManagement: agents.providerManagement,
    scope: navigation.railScope,
    scopeEntries: navigation.scopeEntries,
    search: navigation.search,
    selectedThreadId: selected.selectedThread?.thread.threadId ?? null,
    startingThreads: composerState.startingThreads,
    turnLog: agents.turnLog ?? null,
  };
}

export function agentModeHeaderProps({
  chrome,
  selected,
  surfaceState,
  threadMenu,
  activity,
  creationState,
  headerChrome,
}: AgentModeRegionInputs): AgentModeHeaderProps {
  const { layout } = surfaceState.surface;
  return {
    bottomPanelOpen: chrome.bottomPanelVisible,
    gitSurfaceActive: layout.rightPanel === "open" && layout.activeSurface === "git",
    layout,
    leading:
      layout.rail === "collapsed" && !layout.rightPanelMaximized
        ? headerChrome.sidebarReveal
        : null,
    onNewThread: threadMenu.newThread,
    onOpenScriptsView: chrome.onOpenScriptsView,
    onOpenSurface: activity.openSurfaceCommand,
    onOpenTerminalSessions: headerChrome.openHeaderTerminalSessions,
    onRenameThread: threadMenu.renameThread,
    onRevealFailed: activity.revealFailed,
    onRevealPath: chrome.revealPath,
    onThreadMenuCommand: threadMenu.threadMenuCommand,
    onToggleBottomPanel: chrome.onToggleBottomPanel,
    onToggleRightPanel: activity.toggleRightPanelCommand,
    project: creationState.headerProject,
    scripts: surfaceState.headerScripts,
    serverPorts: surfaceState.serverPortsMenu,
    shortcuts: chrome.shortcuts,
    thread: selected.selectedThread,
    trailingExtras: headerChrome.agentsToggleButton,
  };
}

export function agentModeConversationProps({
  agents,
  navigation,
  scope,
  threadMenu,
  creationState,
  projects,
  projectsLoaded,
  cloneAttachments,
  providerEnabled,
  modelFavoritesPersistence,
  selectedServerId,
  surfaceState,
  onOpenEnvironmentSettings,
}: AgentModeRegionInputs): Omit<AgentModeConversationProps, "kind"> {
  return {
    projectsLoaded,
    agents,
    creation: creationState.creation,
    cloneAttachments,
    projects,
    providerEnabled,
    modelFavoritesPersistence,
    endSessionConfirmation: threadMenu.menu.endSessionConfirmation,
    selectedServerId,
    chooserProjects: scope.composerProjects,
    chooserCloneRunning: creationState.remoteAddCloneRunning,
    counterpart: scope.draft.counterpart,
    onAddProject: creationState.openAddProject,
    onAddRemoteProject: creationState.openRemoteAddProject,
    onSelectRemoteProject: creationState.selectRemoteDraftProject,
    onThreadStarted: navigation.selectStartedThread,
    onOpenProviderSettings: agents.configureAgentCli,
    onOpenEnvironmentSettings,
    onTrustProject: surfaceState.trustProject,
  };
}

export function agentModeSurfaceProps({
  chrome,
  selected,
  scope,
  composerState,
  surfaceState,
  threadMenu,
  activity,
  creationState,
  headerChrome,
  projectsState,
  navigation,
  selectedServerId,
  textClipboard,
  workspaceRoot,
}: AgentModeRegionInputs): AgentModeSurfaceRegionProps {
  const { surface, diffScopes, shipActions, scripts } = surfaceState;
  const { layout } = surface;
  const { composerProps } = composerState.composer;
  return {
    mounted: surface.surfaceHost.mounted,
    rightPanel: layout.rightPanel,
    selectedThreadId: navigation.selectedThreadId,
    selectedServerId,
    textClipboard,
    draftIsolation: composerProps.isolation,
    draftPreviousWorktree:
      composerProps.previousWorktree?.selected === true
        ? composerProps.previousWorktree.available
        : null,
    agents: headerChrome.surfaceAgents,
    agentsPanel: headerChrome.agentsPanelSurface,
    diffScope: diffScopes.scope,
    onDiffScopeChange: diffScopes.setScope,
    remoteDraft: selected.surfaceThread === null && selectedServerId !== null,
    remoteSurface: scope.remoteSurface,
    remoteFileReveal: threadMenu.remoteFileLinks.reveal,
    shipActions,
    scripts,
    chooserAutoFocus: surface.chooserRequested,
    chrome,
    hidden: surface.surfaceHost.hidden,
    layout,
    layoutControls: headerChrome.layoutControls,
    leadingControls:
      layout.rail === "collapsed" && layout.rightPanelMaximized ? headerChrome.sidebarReveal : null,
    onResizeWidth: surfaceState.resizeRightPanel,
    onActivateSurface: activity.activateSurface,
    onCloseSurfaceTab: activity.closeSurfaceTab,
    onOpenSurface: activity.openSurfaceCommand,
    onSwitchScope: chrome.addProject === null ? null : creationState.switchScope,
    onTrustScope: surfaceState.trustProject,
    projects: projectsState.displayProjects,
    scope: scope.surfaceScope,
    thread: selected.surfaceThread,
    threadRootPath: selected.surfaceThreadRootPath,
    workspaceRoot,
  };
}
