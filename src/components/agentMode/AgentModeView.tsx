import { useMemo, useRef, useState } from "react";
import { AgentLiveThreadContext } from "../../application/agentThreads/useLiveAgentThread";
import { useUnifiedAgentThreads } from "../../application/useUnifiedAgentThreads";
import {
  createRemoteDeviceMcpSources,
  usePublishRemoteDeviceMcpProjects,
} from "../../application/remoteDeviceMcpSource";
import { useAgentWorkbenchPorts } from "../agentWorkbenchPortsContext";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { useSurfaceEnterClass } from "../workbenchFrameBootContext";
import { AgentThreadNotifications } from "./AgentThreadNotifications";
import { AgentThreadRequestsScope } from "./AgentThreadRequestsScope";
import { AgentAttachmentDropColumn } from "./AgentAttachmentDropColumn";
import { AgentProjectRenameDialog } from "./AgentProjectRenameDialog";
import { AgentClockProvider } from "./agentClock";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentDictationProvider } from "./dictation/AgentDictationProvider";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import { usePreloadAgentMarkdownRenderer } from "./useAgentMarkdown";
import { useAgentThreadNavigation } from "./useAgentThreadNavigation";
import { useAgentThreadUndoShortcut } from "./useAgentThreadUndoShortcut";
import { useAgentLatestCallback } from "./useAgentThreadPresentationViews";
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";
import { ProjectOnboardingLayer } from "../projects/ProjectOnboardingLayer";
import {
  AgentModeConversation,
  type AgentModeConversationKind,
} from "./modeView/AgentModeConversation";
import {
  agentModeConversationProps,
  agentModeHeaderProps,
  agentModeRailProps,
  agentModeSurfaceProps,
  type AgentModeRegionInputs,
} from "./modeView/agentModeRegionProps";
import { useAgentModeFooterProps } from "./modeView/useAgentModeFooterProps";
import { useAgentModeOverlayProps } from "./modeView/useAgentModeOverlayProps";
import { useAgentModeSessionProps } from "./modeView/useAgentModeSessionProps";
import { AgentRegionBoundary } from "./AgentRegionBoundary";
import { AgentThreadErrorBanner } from "./AgentThreadErrorBanner";
import { AgentModeHeader } from "./modeView/AgentModeHeader";
import { AgentModeOverlays } from "./modeView/AgentModeOverlays";
import { AgentModeRail } from "./modeView/AgentModeRail";
import { AgentModeSurfaceRegion } from "./modeView/AgentModeSurfaceRegion";
import { AgentModeThreadFooter } from "./modeView/AgentModeThreadFooter";
import { AgentModeThreadSession } from "./modeView/AgentModeThreadSession";
import {
  NO_REMOTE_SERVERS,
  type AgentModeViewProps,
  type LocalAgentModeViewProps,
} from "./modeView/agentModeViewProps";
import { useAgentModeActivity } from "./modeView/useAgentModeActivity";
import { useAgentModeCommands } from "./modeView/useAgentModeCommands";
import { useAgentModeComposer } from "./modeView/useAgentModeComposer";
import { useAgentModeCreation } from "./modeView/useAgentModeCreation";
import { useAgentModeHeaderChrome } from "./modeView/useAgentModeHeaderChrome";
import { useAgentModeProjects } from "./modeView/useAgentModeProjects";
import { useAgentModeRailProjects } from "./modeView/useAgentModeRailProjects";
import { useAgentModeScope } from "./modeView/useAgentModeScope";
import { useAgentModeSelectedThread } from "./modeView/useAgentModeSelectedThread";
import { useAgentModeSelection } from "./modeView/useAgentModeSelection";
import { useAgentModeSurface } from "./modeView/useAgentModeSurface";
import { useAgentModeTerminalSessions } from "./modeView/useAgentModeTerminalSessions";
import { useAgentModeThreadMenu } from "./modeView/useAgentModeThreadMenu";

export type { AgentModeViewProps } from "./modeView/agentModeViewProps";

const DEFAULT_NOW_TICK_MS = 30_000;
const NOOP_OPEN_SOURCE_CONTROL = () => undefined;
const NOOP_CLOSE_PROJECT = () => undefined;
const NOOP_SELECTED_PROJECT = () => undefined;

export function AgentModeView(props: AgentModeViewProps) {
  const remote = useRemoteRunnerContext();
  const navigationKey = props.navigationKey ?? "";
  const selection = useAgentModeSelection(navigationKey, props.navigationSession, remote);
  const ports = useAgentWorkbenchPorts();
  const claudeCatalog = useAgentClaudeModelCatalog();
  const [deviceMcpSources] = useState(createRemoteDeviceMcpSources);
  const unified = useUnifiedAgentThreads({
    local: props.agents,
    gateway: remote?.gateway ?? null,
    servers: remote?.servers ?? NO_REMOTE_SERVERS,
    selectedServerId: remote?.selectedServerId ?? null,
    workspaceOwner: props.workspaceRoot,
    selectedThreadId: selection.selectedThreadId,
    selectedProjectRootKey: selection.selectedProjectRootKey,
    localProjects: props.projects,
    claudeCatalog,
    metadataRepository: remote?.metadataRepository,
    imageSurface: props.imageSurface ?? null,
    attachmentEncoder: ports.remoteAttachmentEncoder,
    gitSync: ports.remoteGitSync,
    repositoryIdentity: ports.remoteRepositoryIdentity,
    externalUrlOpener: ports.remoteCompareUrlOpener,
    deviceMcpSource: deviceMcpSources.resolve,
  });
  const remoteInventory = useMemo(
    () => ({
      selectedThreadId: selection.selectedThreadId,
      loading: unified.remoteLoading,
      authoritativeProjectKeys: unified.authoritativeRemoteProjectKeys,
    }),
    [selection.selectedThreadId, unified.remoteLoading, unified.authoritativeRemoteProjectKeys],
  );
  const view = (
    <LocalAgentModeView
      {...props}
      key={navigationKey}
      agents={remote === null ? props.agents : { ...props.agents, ...unified.agents }}
      projects={remote === null ? props.projects : unified.projects}
      onSelectedThreadChange={selection.setSelectedThreadId}
      onSelectedProjectChange={
        remote === null ? NOOP_SELECTED_PROJECT : selection.setSelectedProjectRootKey
      }
      onSelectProjectEnvironment={selection.selectProjectEnvironment}
      refreshRemoteProjects={unified.refreshRemote}
      selectedServerId={remote?.selectedServerId ?? null}
      authoritativeRemoteProjectKeys={unified.authoritativeRemoteProjectKeys}
      remoteInventory={remoteInventory}
      cloneAttachments={unified.cloneAttachments}
      deviceMcpSources={deviceMcpSources}
    />
  );
  return (
    <AgentDictationProvider
      commands={props.viewCommands ?? null}
      language={props.dictationLanguage}
      ports={remote?.speechDictation ?? null}
      serverIds={unified.speechServerIds}
      visible={props.composerVisible !== false}
    >
      {view}
    </AgentDictationProvider>
  );
}

function LocalAgentModeView({
  followUpBehavior = "queue",
  agents,
  chrome,
  modelFavoritesPersistence = null,
  navigationSession,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  onOpenSourceControl = NOOP_OPEN_SOURCE_CONTROL,
  onOpenEnvironmentSettings,
  onOpenUsageSettings,
  onOpenMcpSettings,
  onCloseProject = NOOP_CLOSE_PROJECT,
  onActivateWorkspaceTab,
  onReleaseProject,
  onTrustProject,
  overflowRootPaths,
  providerEnabled,
  projects,
  projectsLoaded = true,
  questionGateway = null,
  artifactLoader = null,
  artifactPreview = null,
  textClipboard = null,
  projectCollapsePreference = null,
  projectFocusPreference = null,
  workingSectionPreference = null,
  newThreadPicker = null,
  threadNotifications = null,
  threadNotificationsVisible = true,
  remotePortPreview = null,
  viewCommands = null,
  workspaceRoot,
  onSelectedThreadChange,
  onSelectedProjectChange,
  onSelectProjectEnvironment,
  refreshRemoteProjects,
  selectedServerId,
  authoritativeRemoteProjectKeys,
  remoteInventory,
  cloneAttachments,
  deviceMcpSources,
}: LocalAgentModeViewProps) {
  const surfaceEnterClass = useSurfaceEnterClass();
  const remoteContext = useRemoteRunnerContext();
  usePreloadAgentMarkdownRenderer();
  const [projectSelectionIntent, setProjectSelectionIntent] = useState(0);
  const projectsState = useAgentModeProjects({
    agents,
    chrome,
    projects,
    projectCollapsePreference,
    projectFocusPreference,
    workingSectionPreference,
  });
  const { groups, displayProjects, presentationThreads, projectDisclosure } = projectsState;
  usePublishRemoteDeviceMcpProjects(deviceMcpSources, projects, projectsState.repositoryIdentities);
  const navigation = useAgentThreadNavigation({
    agents,
    evidenceOf: projectsState.turnEvidenceOf,
    externalSessions: agents.externalSessions ?? null,
    groups,
    presentationThreads,
    projects,
    session: navigationSession,
    authoritativeRemoteProjectKeys,
    projectDisclosure: projectDisclosure.state,
    projectFocus: projectsState.projectFocus.focus,
    workingSplit: projectsState.workingRail.latestSplit,
    revealProject: projectDisclosure.expand,
  });
  const { selectedThread: sessionThread, selectedThreadId } = navigation;
  const selected = useAgentModeSelectedThread({
    agents,
    chrome,
    sessionThread,
    selectedThreadId,
    presentationThreads,
    workingRail: projectsState.workingRail,
    selectedServerId,
    providerEnabled,
    projects,
    remoteInventory,
    onSelectedThreadChange,
  });
  const { selectedThread, effectiveProviderEnabled } = selected;
  const scope = useAgentModeScope({
    navigation,
    selectedThread,
    selectedThreadId,
    projectsState,
    projects,
    selectedServerId,
    remoteContext,
    chrome,
    workspaceRoot,
    onSelectedProjectChange,
  });
  const { setLocalNotice } = scope;
  const composerState = useAgentModeComposer({
    agents,
    chrome,
    navigation,
    projectsState,
    scope,
    projects,
    selectedThreadId,
    selectedThread,
    sessionThread,
    selectedServerId,
    effectiveProviderEnabled,
    remoteThreadSelection: selected.remoteThreadSelection,
    remoteContext,
    setLocalNotice,
    setProjectSelectionIntent,
    onSelectProjectEnvironment,
  });
  const { composer } = composerState;
  const surfaceState = useAgentModeSurface({
    agents,
    chrome,
    selectedThread,
    selectedThreadId,
    sessionThread,
    workspaceRoot,
    remoteSurface: scope.remoteSurface,
    resolvingRemoteThread: selected.resolvingRemoteThread,
    remotePortPreview,
    remoteContext,
    textClipboard,
    setLocalNotice,
    onTrustProject,
    onReleaseProject,
  });
  const { surface, trustProject } = surfaceState;
  const { layout } = surface;
  const terminalSessions = useAgentModeTerminalSessions({
    agents,
    navigation,
    groups,
    projects,
    setLocalNotice,
  });
  const threadMenu = useAgentModeThreadMenu({
    agents,
    chrome,
    navigation,
    projectsState,
    workspaceRoot,
    selectedThreadId,
    remoteSurface: scope.remoteSurface,
    requestEndSessionRef: composerState.requestEndSessionRef,
    setLocalNotice,
    openSurface: surface.openSurface,
    trustProject,
    releaseProject: surfaceState.releaseProject,
    onCloseProject,
    openTerminalSessions: terminalSessions.openTerminalSessions,
    startNewThread: composer.startNewThread,
  });
  const activeProjectRootKeyRef = useRef<string | null>(null);
  const railProjects = useAgentModeRailProjects({
    chrome,
    navigation,
    projectsState,
    projects,
    composer,
    newThreadPicker,
    activeProjectRootKeyRef,
    setLocalNotice,
    setProjectSelectionIntent,
    resetDraftLaunch: composerState.resetDraftLaunch,
    resetProjectDraftLaunch: composerState.resetProjectDraftLaunch,
    onSelectProjectEnvironment,
    onActivateWorkspaceTab,
  });
  const sectionRef = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(layout.rail, sectionRef);
  const { threadUndo } = threadMenu;
  useAgentThreadUndoShortcut(sectionRef, threadUndo.notification === null ? null : threadUndo.undo);
  const activity = useAgentModeActivity({
    agents,
    chrome,
    workspaceRoot,
    surfaceState,
    setLocalNotice,
  });
  const openAddProjectRef = useRef<() => void>(() => undefined);
  const commands = useAgentModeCommands({
    agents,
    navigation,
    projectsState,
    surfaceState,
    railProjects,
    viewCommands,
    selectedThreadId,
    selectedRootKey: scope.selectedRootKey,
    openAddProjectRef,
    localNotice: scope.localNotice,
    setLocalNotice,
    openSurfaceCommand: activity.openSurfaceCommand,
  });
  const creationState = useAgentModeCreation({
    chrome,
    navigation,
    projectsState,
    composerState,
    projects,
    selectedThread,
    selectedThreadId,
    selectedServerId,
    workspaceRoot,
    projectSelectionIntent,
    openAddProjectRef,
    activeProjectRootKeyRef,
    setLocalNotice,
    setProjectSelectionIntent,
    refreshRemoteProjects,
    onSelectProjectEnvironment,
  });
  const { headerProject, creation } = creationState;
  const headerChrome = useAgentModeHeaderChrome({
    agents,
    chrome,
    navigation,
    projectsState,
    surfaceState,
    railProjects,
    terminalSessions,
    headerProject,
    sidebarRevealDetail: activity.sidebarRevealDetail,
    selectedThread,
    refreshRemoteProjects,
  });
  const selectThread = useAgentLatestCallback(navigation.selectThread);
  const regions: AgentModeRegionInputs = {
    agents,
    chrome,
    navigation,
    projectsState,
    selected,
    scope,
    composerState,
    surfaceState,
    threadMenu,
    railProjects,
    activity,
    creationState,
    headerChrome,
    projects,
    projectsLoaded,
    providerEnabled,
    overflowRootPaths,
    cloneAttachments,
    modelFavoritesPersistence,
    selectedServerId,
    textClipboard,
    workspaceRoot,
    selectThread,
    onOpenSourceControl,
    onOpenUsageSettings,
    onOpenEnvironmentSettings,
  };
  const sessionProps = useAgentModeSessionProps({
    agents,
    navigation,
    selected,
    composerState,
    surfaceState,
    threadMenu,
    activity,
    sessionThread,
    artifactLoader,
    artifactPreview,
    goToTurnSignal: commands.goToTurnSignal,
    composerRepositoryLabel: headerProject?.label ?? composer.composerLabel,
    textClipboard,
  });
  const footerProps = useAgentModeFooterProps({
    regions,
    sessionThread,
    notice: commands.notice,
    followUpBehavior,
    questionGateway,
    dismissNotice: commands.dismissNotice,
    onOpenMcpSettings,
  });
  const overlayProps = useAgentModeOverlayProps({ navigation, terminalSessions });
  const conversationKind: AgentModeConversationKind =
    projects.length === 0 &&
    creation.pendingClones.length === 0 &&
    selectedServerId === null &&
    selectedThreadId === null
      ? "noProjects"
      : creation.visible && creation.pending !== null && creation.pendingClone !== null
        ? "clone"
        : selectedThreadId === null && selectedServerId !== null && composer.target === null
          ? "remoteChooser"
          : "session";
  return (
    <AgentLiveThreadContext.Provider value={agents.liveThreads ?? null}>
      <AgentAgentsPanelProvider
        isOpen={surface.isSurfaceOpen("agents")}
        onOpen={activity.openAgentsSurface}
        onToggle={activity.toggleAgentsSurface}
      >
        <section
          aria-label="Agent mode"
          className={["agent-mode", surfaceEnterClass].filter(Boolean).join(" ")}
          data-slot="agent"
          ref={sectionRef}
        >
          <AgentClockProvider nowTickMs={nowTickMs}>
            <div className="agent-mode__grid">
              <AgentModeRail {...agentModeRailProps(regions)} />
              <AgentThreadRequestsScope thread={sessionThread}>
                <AgentAttachmentDropColumn
                  columnRef={navigation.centerRef}
                  inert={layout.rightPanelMaximized}
                >
                  <AgentModeHeader {...agentModeHeaderProps(regions)} />
                  <AgentThreadErrorBanner
                    agents={agents}
                    recovery={composer.composerProps.recovery ?? null}
                    view={sessionThread}
                  />
                  <AgentRegionBoundary
                    clipboard={textClipboard}
                    region="conversation"
                    resetKeys={[selectedThreadId, selectedServerId, creation.visible]}
                  >
                    {conversationKind === "session" ? (
                      <AgentModeThreadSession {...sessionProps} />
                    ) : (
                      <AgentModeConversation
                        kind={conversationKind}
                        {...agentModeConversationProps(regions)}
                      />
                    )}
                  </AgentRegionBoundary>
                  <AgentModeThreadFooter {...footerProps} />
                </AgentAttachmentDropColumn>
              </AgentThreadRequestsScope>
            </div>
          </AgentClockProvider>
          <ProjectOnboardingLayer
            chrome={chrome.addProject}
            creation={creation}
            lookupGateway={remoteContext?.repositoryLookup ?? null}
            selectedServerId={selectedServerId}
            servers={remoteContext?.servers ?? NO_REMOTE_SERVERS}
          />
          <AgentModeOverlays {...overlayProps} />
        </section>
        {surface.surfaceHost.mounted && (
          <AgentModeSurfaceRegion {...agentModeSurfaceProps(regions)} />
        )}
        <AgentProjectRenameDialog
          onCancel={projectsState.projectRename.cancel}
          onSubmit={projectsState.projectRename.submit}
          target={projectsState.projectRename.target}
        />
        {threadNotifications !== null && (
          <AgentThreadNotifications
            baselineReady={agents.sessionBackgroundsRecovered !== false}
            center={threadNotifications}
            onSelectThread={selectThread}
            interactions={selected.pendingObservations.observed}
            projects={displayProjects}
            toastsVisible={threadNotificationsVisible}
            views={presentationThreads}
            visibleThreadId={
              layout.rightPanel === "open" && layout.rightPanelMaximized
                ? null
                : (selectedThread?.thread.threadId ?? null)
            }
          />
        )}
      </AgentAgentsPanelProvider>
    </AgentLiveThreadContext.Provider>
  );
}
