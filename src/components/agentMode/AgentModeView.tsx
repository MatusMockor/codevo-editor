import { useRef, useState } from "react";
import { AgentLiveThreadContext } from "../../application/agentThreads/useLiveAgentThread";
import { useUnifiedAgentThreads } from "../../application/useUnifiedAgentThreads";
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
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";
import { AgentModeConversation } from "./modeView/AgentModeConversation";
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
  });
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
      cloneAttachments={unified.cloneAttachments}
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
  cloneAttachments,
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
    resolvingRemoteThread: selected.resolvingRemoteThread,
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
    refreshRemoteProjects,
    onSelectProjectEnvironment,
  });
  const { headerProject } = creationState;
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
              <AgentModeRail
                agents={agents}
                chrome={chrome}
                navigation={navigation}
                projectsState={projectsState}
                surfaceState={surfaceState}
                railProjects={railProjects}
                threadMenu={threadMenu}
                creationState={creationState}
                activity={activity}
                headerChrome={headerChrome}
                startingThreads={composerState.startingThreads}
                pendingInteractions={selected.pendingInteractions}
                selectedThread={selectedThread}
                selectedThreadId={selectedThreadId}
                selectedServerId={selectedServerId}
                providerEnabled={effectiveProviderEnabled}
                overflowRootPaths={overflowRootPaths}
                textClipboard={textClipboard}
                onOpenSourceControl={onOpenSourceControl}
                onOpenUsageSettings={onOpenUsageSettings}
              />
              <AgentThreadRequestsScope thread={sessionThread}>
                <AgentAttachmentDropColumn
                  columnRef={navigation.centerRef}
                  inert={layout.rightPanelMaximized}
                >
                  <AgentModeHeader
                    agents={agents}
                    chrome={chrome}
                    surfaceState={surfaceState}
                    threadMenu={threadMenu}
                    activity={activity}
                    headerChrome={headerChrome}
                    headerProject={headerProject}
                    composerState={composerState}
                    selectedThread={selectedThread}
                    sessionThread={sessionThread}
                  />
                  <AgentModeConversation
                    agents={agents}
                    navigation={navigation}
                    projectsState={projectsState}
                    scope={scope}
                    composerState={composerState}
                    creationState={creationState}
                    threadMenu={threadMenu}
                    projects={projects}
                    projectsLoaded={projectsLoaded}
                    cloneAttachments={cloneAttachments}
                    providerEnabled={providerEnabled}
                    modelFavoritesPersistence={modelFavoritesPersistence}
                    selectedThreadId={selectedThreadId}
                    selectedServerId={selectedServerId}
                    textClipboard={textClipboard}
                    setProjectSelectionIntent={setProjectSelectionIntent}
                    onOpenEnvironmentSettings={onOpenEnvironmentSettings}
                    trustProject={trustProject}
                    session={
                      <AgentModeThreadSession
                        agents={agents}
                        navigation={navigation}
                        composerState={composerState}
                        surfaceState={surfaceState}
                        threadMenu={threadMenu}
                        activity={activity}
                        sessionThread={sessionThread}
                        awaiting={
                          sessionThread === null
                            ? null
                            : (selected.pendingInteractions.get(sessionThread.thread.threadId) ??
                              null)
                        }
                        artifactLoader={artifactLoader}
                        artifactPreview={artifactPreview}
                        goToTurnSignal={commands.goToTurnSignal}
                        composerRepositoryLabel={headerProject?.label ?? composer.composerLabel}
                        textClipboard={textClipboard}
                      />
                    }
                  />
                  <AgentModeThreadFooter
                    agents={agents}
                    selected={selected}
                    composerState={composerState}
                    creationState={creationState}
                    threadMenu={threadMenu}
                    headerChrome={headerChrome}
                    sessionThread={sessionThread}
                    notice={commands.notice}
                    followUpBehavior={followUpBehavior}
                    modelFavoritesPersistence={modelFavoritesPersistence}
                    questionGateway={questionGateway}
                    selectedThreadId={selectedThreadId}
                    selectedServerId={selectedServerId}
                    textClipboard={textClipboard}
                    providerEnabled={effectiveProviderEnabled}
                    dismissNotice={commands.dismissNotice}
                    onOpenEnvironmentSettings={onOpenEnvironmentSettings}
                    onOpenMcpSettings={onOpenMcpSettings}
                  />
                </AgentAttachmentDropColumn>
              </AgentThreadRequestsScope>
            </div>
          </AgentClockProvider>
          <AgentModeOverlays
            addProjectChrome={chrome.addProject}
            creation={creationState.creation}
            lookupGateway={remoteContext?.repositoryLookup ?? null}
            selectedServerId={selectedServerId}
            servers={remoteContext?.servers ?? NO_REMOTE_SERVERS}
            palette={navigation.palette}
            search={navigation.search}
            terminalSessions={terminalSessions}
          />
        </section>
        <AgentModeSurfaceRegion
          chrome={chrome}
          selected={selected}
          scope={scope}
          composerState={composerState}
          surfaceState={surfaceState}
          threadMenu={threadMenu}
          activity={activity}
          creationState={creationState}
          headerChrome={headerChrome}
          displayProjects={displayProjects}
          selectedThreadId={selectedThreadId}
          selectedServerId={selectedServerId}
          textClipboard={textClipboard}
          workspaceRoot={workspaceRoot}
          trustProject={trustProject}
        />
        <AgentProjectRenameDialog
          onCancel={projectsState.projectRename.cancel}
          onSubmit={projectsState.projectRename.submit}
          target={projectsState.projectRename.target}
        />
        {threadNotifications !== null && (
          <AgentThreadNotifications
            baselineReady={agents.sessionBackgroundsRecovered !== false}
            center={threadNotifications}
            onSelectThread={navigation.selectThread}
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
