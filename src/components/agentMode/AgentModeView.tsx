import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import type { AgentDiffTurn } from "../../domain/diffView/agentDiffScope";
import { useAgentDiffScopeSelection } from "./useAgentDiffScopeSelection";
import type { MonacoAppTheme } from "../../domain/settings";
import { useProjectRepositoryIdentities } from "../../application/useProjectRepositoryIdentities";
import { TauriRepositoryIdentityGateway } from "../../infrastructure/tauriRepositoryIdentityGateway";
import { TauriRemoteRepositoryIdentityGateway } from "../../infrastructure/tauriRemoteRepositoryIdentityGateway";
import { useAgentProjectCreation } from "./useAgentProjectCreation";
import {
  agentConversationEscapeAction,
  useAgentConversationEscape,
} from "./useAgentConversationEscape";
import { AgentCloneComposer } from "./AgentCloneComposer";
import { NoProjectsHero } from "../projects/NoProjectsHero";
import { ProjectOnboardingLayer } from "../projects/ProjectOnboardingLayer";
import type { WorkspaceTrustOrigin } from "../../domain/trust";
import { AgentRemoteDraftProjectChooser } from "./AgentRemoteDraftProjectChooser";
import { AgentUnconfirmedMessageNotice } from "./AgentUnconfirmedMessageNotice";
import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { useRemoteSurfaceContext } from "./useRemoteSurfaceContext";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import { useAgentPendingInteractions } from "../../application/useAgentPendingInteractions";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSurfaceEnterClass } from "../workbenchFrameBootContext";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { useRemoteProjectLinks } from "../../application/useRemoteProjectLinks";
import { groupedEnvironmentProjects, environmentComposerScope } from "./agentEnvironmentProjects";
import { useUnifiedAgentThreads } from "../../application/useUnifiedAgentThreads";
import { agentThreadIsSteerable } from "../../application/agentTurnAdmission";
import { deferredFollowUpsForThread } from "../../application/agentDeferredFollowUps";
import {
  useAgentThreadScripts,
  type AgentThreadScriptTarget,
} from "../../application/useAgentThreadScripts";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import {
  agentProjectOwnsLaunchRoot,
  agentProjectOwnsOwner,
  type AgentProjectDescriptor,
} from "../../domain/agentProject";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { AgentNewThreadPicker } from "../../application/agentNewThreadPicker";
import type { AgentRailFilterPreferencePort } from "../../application/agentRailFilterPreferencePort";
import { useAgentThreadBranchMemory } from "../../application/useAgentThreadBranchMemory";
import { useAgentThreadBranchRecorder } from "../../application/useAgentThreadBranchRecorder";
import { AgentThreadBranchMemoryContext } from "./agentThreadBranchMemoryContext";
import { useAgentRailFilter } from "./useAgentRailFilter";
import { useAgentProjectThreadCommands } from "./useAgentProjectThreadCommands";
import { useAgentResumeCompactionOffer } from "../../application/useAgentResumeCompactionOffer";
import { parseRemoteAgentThreadIdentity } from "../../domain/remoteAgentIdentity";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import {
  agentTurnLogEvidence,
  useAgentTurnLogFacts,
} from "../../application/agentTurnLogStatusStore";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
  ExternalSessionsSurface,
} from "../../application/agentThreadPorts";
import type {
  AgentViewCommandBridge,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { AgentComposerController } from "./AgentComposerController";
import { AgentQuestionAttachmentsContext } from "./composer/agentQuestionAttachmentsContext";
import { AgentPanelWindowControls } from "./AgentPanelLayoutControls";
import { AgentRailResizeHandle } from "./AgentRailResizeHandle";
import { AgentSurfaceHost } from "./AgentSurfaceHost";
import { remoteAddProjectCloneActive } from "./remoteAddProject/remoteAddProjectPresentation";
import { AgentNoticeBar } from "./AgentNoticeBar";
import { AgentEndSessionConfirmationBanner } from "./AgentEndSessionConfirmationBanner";
import { AgentThreadFindBar } from "./AgentThreadFindBar";
import { AgentSidebarReveal } from "./AgentSidebarReveal";
import { AgentThreadActivity } from "./AgentThreadActivity";
import {
  agentThreadActivityDetail,
  agentThreadActivitySummary,
} from "./agentThreadActivityPresentation";
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";
import { AgentThreadHeader } from "./AgentThreadHeader";
import { AgentThreadErrorBanner } from "./AgentThreadErrorBanner";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentAgentsPanelSurface } from "./agents/AgentAgentsPanelSurface";
import { AgentAgentsToggleButton } from "./agents/AgentAgentsToggleButton";
import { AgentTerminalSessionsPalette } from "./AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "./AgentThreadSearchPalette";
import { AgentThreadSession } from "./AgentThreadSession";
import { useAgentSessionBackgroundControls } from "./useAgentSessionBackgroundControls";
import { usePreloadAgentMarkdownRenderer } from "./useAgentMarkdown";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { AgentClockProvider } from "./agentClock";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentProjectTerminalSessionsTarget,
  agentRailScopeEntries,
} from "./agentSidebarPresentation";
import { defaultAgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";
import {
  agentSurfaceScopeFor,
  agentThreadCheckoutRoot,
  isRemoteAgentSurfaceThread,
} from "./agentSurfacePolicy";
import { useScopedAgentNotice } from "./useScopedAgentNotice";
import { useAgentLocalFileLinks } from "./useAgentLocalFileLinks";
import { useAgentSessionImport } from "./useAgentSessionImport";
import { useAgentComposerControllerState } from "./useAgentComposerState";
import { useAgentComposerDrawerExtras } from "./useAgentComposerDrawerExtras";
import { agentComposerThreadLocation } from "./agentComposerThreadLocation";
import { agentNewThreadTooltip } from "./agentNewThreadRequest";
import { useAgentWorkspaceCardSlot } from "./useAgentWorkspaceCardSlot";
import { useAgentQueuedFollowUpEdit } from "./useAgentQueuedFollowUpEdit";
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
} from "./useAgentQueuedEditImagePreviews";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadNavigation, type AgentNavigationSession } from "./useAgentThreadNavigation";
import { useAgentViewCommands } from "./useAgentViewCommands";
import { useAgentCommandPaletteProvider } from "./useAgentCommandPaletteProvider";
import { useResponsivePanelToggle } from "./useResponsivePanelToggle";
import {
  useAgentLatestCallback,
  useAgentSurfacePresentationView,
  useAgentThreadScriptPresentation,
  useAgentThreadPresentationViews,
} from "./useAgentThreadPresentationViews";

const AGENTS_TOGGLE_BUTTON = <AgentAgentsToggleButton />;
const AGENTS_PANEL_SURFACE = <AgentAgentsPanelSurface />;

export interface AgentModeViewProps {
  readonly monacoTheme?: MonacoAppTheme;
  readonly followUpBehavior?: AgentFollowUpBehavior;
  readonly questionGateway?: AgentQuestionGateway | null;
  readonly artifactLoader?: AgentArtifactLoader | null;
  readonly artifactPreview?: AgentArtifactPreviewPort | null;
  readonly imageSurface?: AgentImageSurfacePort | null;
  readonly navigationSession?: AgentNavigationSession;
  readonly agents: AgentThreadsSurface & {
    readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
    readonly providerManagement: AgentProviderManagementSurface;
    readonly externalSessions?: ExternalSessionsSurface;
  };
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly workspaceRoot: string | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly projectsLoaded?: boolean;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly nowTickMs?: number;
  readonly viewCommands?: AgentViewCommandBridge | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly railFilterPreference?: AgentRailFilterPreferencePort | null;
  readonly newThreadPicker?: AgentNewThreadPicker | null;
  onOpenSourceControl?(): void;
  onOpenEnvironmentSettings?(): void;
  onOpenUsageSettings?(): void;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
  onCloseProject?(rootPath: string): void;
  onReleaseProject(projectRootKey: string): void;
}

const DEFAULT_NOW_TICK_MS = 30_000;
const NO_DIFF_TURNS: ReadonlyArray<AgentDiffTurn> = [];
const NOOP_OPEN_SOURCE_CONTROL = () => undefined;
const PROJECT_IDENTITY_GATEWAY = new TauriRepositoryIdentityGateway();
const REMOTE_PROJECT_IDENTITY_GATEWAY = new TauriRemoteRepositoryIdentityGateway();
const NOOP_CLOSE_PROJECT = () => undefined;
const NOOP_SELECTED_PROJECT = () => undefined;
const NO_REMOTE_SERVERS: readonly import("../../domain/remoteRunner").RemoteRunnerServer[] = [];
const REMOTE_PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;

const TERMINAL_SESSIONS_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Terminal sessions are not available in this workbench.",
  action: null,
};

export function AgentModeView(props: AgentModeViewProps) {
  const remote = useRemoteRunnerContext();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    props.navigationSession?.current.selectedThreadId ?? null,
  );
  const [selectedProjectRootKey, setSelectedProjectRootKey] = useState<string | null>(null);
  const selectProjectEnvironment = useCallback(
    (rootKey: string) => {
      if (!rootKey.startsWith("remote:")) {
        remote?.selectServer(null);
        return;
      }
      const server = remote?.servers.find((entry) =>
        rootKey.startsWith(`remote:${encodeURIComponent(entry.id)}:`),
      );
      if (server !== undefined) remote?.selectServer(server.id);
    },
    [remote],
  );
  const unified = useUnifiedAgentThreads({
    local: props.agents,
    gateway: remote?.gateway ?? null,
    servers: remote?.servers ?? NO_REMOTE_SERVERS,
    selectedServerId: remote?.selectedServerId ?? null,
    workspaceOwner: props.workspaceRoot,
    selectedThreadId,
    selectedProjectRootKey,
    localProjects: props.projects,
    metadataRepository: remote?.metadataRepository,
    imageSurface: props.imageSurface ?? null,
  });
  return (
    <LocalAgentModeView
      {...props}
      agents={remote === null ? props.agents : { ...props.agents, ...unified.agents }}
      projects={remote === null ? props.projects : unified.projects}
      onSelectedThreadChange={setSelectedThreadId}
      onSelectedProjectChange={remote === null ? NOOP_SELECTED_PROJECT : setSelectedProjectRootKey}
      onSelectProjectEnvironment={selectProjectEnvironment}
      refreshRemoteProjects={unified.refreshRemote}
      selectedServerId={remote?.selectedServerId ?? null}
      authoritativeRemoteProjectKeys={unified.authoritativeRemoteProjectKeys}
      cloneAttachments={unified.cloneAttachments}
    />
  );
}

function LocalAgentModeView({
  monacoTheme = "calm-dark",
  followUpBehavior = "queue",
  agents,
  chrome,
  modelFavoritesPersistence = null,
  navigationSession,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  onOpenSourceControl = NOOP_OPEN_SOURCE_CONTROL,
  onOpenEnvironmentSettings,
  onOpenUsageSettings,
  onCloseProject = NOOP_CLOSE_PROJECT,
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
  railFilterPreference = null,
  newThreadPicker = null,
  viewCommands = null,
  workspaceRoot,
  onSelectedThreadChange,
  onSelectedProjectChange,
  onSelectProjectEnvironment,
  refreshRemoteProjects,
  selectedServerId,
  authoritativeRemoteProjectKeys,
  cloneAttachments,
}: AgentModeViewProps & {
  onSelectedThreadChange(threadId: string | null): void;
  onSelectedProjectChange(rootKey: string | null): void;
  onSelectProjectEnvironment(rootKey: string): void;
  refreshRemoteProjects(): Promise<void>;
  selectedServerId: string | null;
  authoritativeRemoteProjectKeys: ReadonlySet<string>;
  cloneAttachments: {
    readonly local: AgentThreadsSurface["attachments"];
    readonly remote: AgentThreadsSurface["attachments"];
  };
}) {
  const surfaceEnterClass = useSurfaceEnterClass();
  const remoteContext = useRemoteRunnerContext();
  usePreloadAgentMarkdownRenderer();
  const [goToTurnSignal, setGoToTurnSignal] = useState(0);
  const [projectSelectionIntent, setProjectSelectionIntent] = useState(0);

  const presentationThreads = useAgentThreadPresentationViews(agents.threads);
  const projectLinks = useRemoteProjectLinks();
  const executionGroups = useMemo(
    () => agentProjectGroups(projects, presentationThreads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, presentationThreads],
  );

  const repositoryIdentities = useProjectRepositoryIdentities(
    projects,
    PROJECT_IDENTITY_GATEWAY,
    REMOTE_PROJECT_IDENTITY_GATEWAY,
  );
  const groups = useMemo(
    () => groupedEnvironmentProjects(executionGroups, projects, projectLinks, repositoryIdentities),
    [executionGroups, projects, projectLinks, repositoryIdentities],
  );
  const externalSessions = agents.externalSessions ?? null;
  const turnEvidenceOf = useCallback<AgentTurnLogEvidenceLookup>(
    (turnId) => agentTurnLogEvidence(agents.turnLog?.factsOf(turnId) ?? null),
    [agents.turnLog],
  );
  const railScopeEntries = useMemo(() => agentRailScopeEntries(groups), [groups]);
  const railFilter = useAgentRailFilter({
    preference: railFilterPreference,
    entries: railScopeEntries,
    projectsLoaded,
    authoritativeRemoteProjectKeys,
  });
  const threadBranchMemory = useAgentThreadBranchMemory(chrome.threadBranchMemory ?? null);
  const navigation = useAgentThreadNavigation({
    agents,
    evidenceOf: turnEvidenceOf,
    externalSessions,
    groups,
    presentationThreads,
    projects,
    session: navigationSession,
    authoritativeRemoteProjectKeys,
    railFilter: railFilter.filter,
  });
  const { selectedThread: sessionThread, selectedThreadId, railScope, find } = navigation;
  const contextThread = sessionThread?.thread ?? null;
  const contextTurnId = contextThread?.turns[contextThread.turns.length - 1]?.turnId ?? null;
  const contextFacts = useAgentTurnLogFacts(agents.turnLog ?? null, contextTurnId);
  const loggedContextWindow = contextFacts?.contextWindow ?? null;
  const compactionOffer = useAgentResumeCompactionOffer(contextThread, loggedContextWindow);
  useLayoutEffect(
    () => onSelectedThreadChange(selectedThreadId),
    [onSelectedThreadChange, selectedThreadId],
  );
  const selectedThread =
    selectedThreadId === null
      ? null
      : (presentationThreads.find((view) => view.thread.threadId === selectedThreadId) ?? null);
  const pendingInteractions = useAgentPendingInteractions(
    questionGateway,
    agents.threads,
    selectedThread?.thread.threadId ?? null,
  );
  const pendingRemoteIdentity =
    selectedThread === null ? parseRemoteAgentThreadIdentity(selectedThreadId) : null;
  const resolvingRemoteThread =
    selectedThread === null && selectedThreadId?.startsWith("remote-thread:") === true;
  const effectiveProviderEnabled =
    selectedThread?.execution?.kind === "remote" ||
    (selectedThread === null && selectedServerId !== null)
      ? REMOTE_PROVIDERS_ENABLED
      : providerEnabled;
  const surfaceThread = useAgentSurfacePresentationView(selectedThread);
  const surfaceThreadRootPath = useMemo(
    () => (surfaceThread === null ? null : agentThreadCheckoutRoot(surfaceThread, projects)),
    [projects, surfaceThread],
  );
  const composerScope = useMemo(
    () =>
      selectedThread === null
        ? environmentComposerScope(navigation.composerScope, groups, projects, selectedServerId)
        : navigation.composerScope,
    [selectedThread, navigation.composerScope, groups, projects, selectedServerId],
  );
  const remoteSurface = useRemoteSurfaceContext({
    remote: remoteContext,
    thread: selectedThread,
    selectedThreadId,
    draftProjectRootKey:
      composerScope?.kind === "missing" ? null : (composerScope?.projectRootKey ?? null),
  });
  const selectedProject =
    projects.find(
      (project) =>
        project.rootKey === (selectedThread?.thread.owner.rootKey ?? composerScope?.projectRootKey),
    ) ?? null;
  const selectedRootKey = selectedProject?.rootKey ?? null;
  useLayoutEffect(
    () => onSelectedProjectChange(selectedRootKey),
    [onSelectedProjectChange, selectedRootKey],
  );
  const [localNotice, setLocalNotice] = useScopedAgentNotice(
    JSON.stringify([
      selectedServerId,
      selectedThreadId,
      selectedRootKey,
      selectedProject?.ownerId,
      selectedProject?.generation,
    ]),
  );
  const selectWorkspace = chrome.workspaceActivation?.select;
  useEffect(() => {
    if (selectWorkspace === undefined) return;
    if (
      selectedProject === null ||
      selectedProject.rootKey.startsWith("remote:") ||
      selectedProject.origin === "closed-tab-live-tasks"
    ) {
      selectWorkspace(null);
      return;
    }
    const owner = selectedThread?.thread.owner;
    const valid =
      owner === undefined
        ? composerScope !== null &&
          composerScope.kind !== "missing" &&
          composerScope.ownerId === selectedProject.ownerId &&
          composerScope.generation === selectedProject.generation
        : agentProjectOwnsOwner(selectedProject, owner) &&
          agentProjectOwnsLaunchRoot(selectedProject, owner.repositoryRoot);
    selectWorkspace(valid ? selectedProject : null);
  }, [composerScope, selectedProject, selectedThread, selectWorkspace, workspaceRoot]);
  const surfaceScope = useMemo(
    () => agentSurfaceScopeFor(composerScope, projects, workspaceRoot),
    [composerScope, projects, workspaceRoot],
  );

  const composerProjects = useMemo(() => {
    if (selectedThread !== null) return projects;
    const prefix =
      selectedServerId === null ? null : `remote:${encodeURIComponent(selectedServerId)}:`;
    return projects.filter((project) =>
      prefix === null ? !project.rootKey.startsWith("remote:") : project.rootKey.startsWith(prefix),
    );
  }, [projects, selectedServerId, selectedThread]);
  const queuedEdit = useAgentQueuedFollowUpEdit(agents, selectedThreadId);
  const previewedQueuedEdit = useAgentQueuedEditImagePreviews(
    queuedEdit.edit,
    agents.attachmentImages,
    queuedEditImageOwner(selectedThread),
  );
  const requestEndSessionRef = useRef<(threadId: string) => void>(() => undefined);
  const sessionBackground = useAgentSessionBackgroundControls(
    agents,
    sessionThread,
    setLocalNotice,
    requestEndSessionRef,
  );
  const composer = useAgentComposerControllerState({
    agents,
    sessionStop: sessionBackground.sessionStop,
    groups: executionGroups,
    queuedEdit: previewedQueuedEdit,
    projects: composerProjects,
    providerEnabled: effectiveProviderEnabled,
    railScope: composerScope,
    selectedThread,
    onClearSelectedThread: navigation.clearSelectedThread,
    onThreadStarted: navigation.selectStartedThread,
    onSelectProjectEnvironment,
  });
  const submitComposer = useAgentLatestCallback(composer.submit);
  const changeIsolation = useAgentLatestCallback(composer.composerProps.onIsolationChange);
  const changeLaunch = useAgentLatestCallback(composer.composerProps.onLaunchChange);
  const clearComposer = useAgentLatestCallback(composer.composerProps.onNewThread);
  const selectComposerRepository = useAgentLatestCallback((repositoryRoot: string) => {
    chrome.addProject?.cancelSelection?.();
    setProjectSelectionIntent((current) => current + 1);
    composer.composerProps.onSelectRepository(repositoryRoot);
  });
  const composerThreadLocation = useMemo(
    () =>
      agentComposerThreadLocation(
        selectedThread,
        remoteContext?.servers ?? NO_REMOTE_SERVERS,
        chrome.liveCheckoutBranches,
      ),
    [chrome.liveCheckoutBranches, remoteContext?.servers, selectedThread],
  );
  const composerProps = {
    ...composer.composerProps,
    immediateBlockedReason:
      selectedThread?.execution?.kind === "remote"
        ? selectedThread.execution.taskSteering === true
          ? null
          : "Update the server to send messages during a run. Queued messages remain available."
        : composer.composerProps.immediateBlockedReason,
    ...(resolvingRemoteThread
      ? {
          mode: {
            kind: "followUp" as const,
            blockedReason: "Waiting for the server conversation to load.",
          },
          draftKey: selectedThreadId,
          promptOwnerKey: selectedThreadId!,
          target: null,
          attachments: null,
          isolation: "worktree" as const,
        }
      : {}),
    threadLocation: composerThreadLocation,
    onIsolationChange: changeIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearComposer,
    onSelectRepository: selectComposerRepository,
  };
  const startNewThread = composer.startNewThread;

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
  const openRecordedDiff = diffScopes.openTurnDiff;
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

  const terminalSessionsPalette = navigation.terminalSessions;
  const terminalSessionsTarget = terminalSessionsPalette.target;
  const selectThread = navigation.selectThread;
  const selectImportedThread = useCallback(
    (threadId: string) => {
      selectThread(threadId);
      terminalSessionsPalette.close();
      externalSessions?.close();
    },
    [externalSessions, selectThread, terminalSessionsPalette],
  );
  const sessionImport = useAgentSessionImport({
    open: terminalSessionsPalette.open,
    target: terminalSessionsTarget,
    projects,
    surface: externalSessions,
    importSession: agents.importExternalSession,
    onComplete: selectImportedThread,
  });
  const cancelSessionImport = sessionImport.cancel;
  const openTerminalSessions = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      if (projectRootKey.startsWith("remote:") || repositoryRoot.startsWith("remote:")) {
        setLocalNotice(TERMINAL_SESSIONS_UNAVAILABLE_NOTICE);
        return;
      }
      if (externalSessions === null) {
        setLocalNotice(TERMINAL_SESSIONS_UNAVAILABLE_NOTICE);
        return;
      }
      if (!terminalSessionsPalette.openFor(projectRootKey, repositoryRoot)) return;
      cancelSessionImport();
      void externalSessions.open({ rootKey: projectRootKey, repositoryRoot });
    },
    [cancelSessionImport, externalSessions, setLocalNotice, terminalSessionsPalette],
  );
  const closeTerminalSessions = useCallback(() => {
    cancelSessionImport();
    terminalSessionsPalette.close();
    externalSessions?.close();
  }, [cancelSessionImport, externalSessions, terminalSessionsPalette]);
  const newThreadTargetForRail = navigation.newThreadTarget;
  const railTerminalSessionsTarget = useMemo(
    () => newThreadTargetForRail(),
    [newThreadTargetForRail],
  );
  const terminalSessionsProjectLabel = useMemo(() => {
    if (terminalSessionsTarget === null) return null;
    return (
      groups.find((group) => group.projectRootKey === terminalSessionsTarget.projectRootKey)
        ?.label ?? null
    );
  }, [groups, terminalSessionsTarget]);

  const localFileLinks = useAgentLocalFileLinks(chrome.openFileLocation, setLocalNotice);
  const menu = useAgentThreadMenuCommands({
    agents,
    groups,
    revealPath: chrome.revealPath,
    reportNotice: setLocalNotice,
    onTrustProject: trustProject,
    onReleaseProject: releaseProject,
    onCloseProject,
    onThreadRemoved: navigation.forgetThread,
    onOpenTerminalSessions: openTerminalSessions,
    startNewThread,
  });
  const renameThread = useAgentLatestCallback(agents.renameThread);
  const togglePin = useAgentLatestCallback(agents.togglePin);
  const threadMenuCommand = useAgentLatestCallback(menu.handleThreadMenuCommand);
  useLayoutEffect(() => {
    requestEndSessionRef.current = (threadId) =>
      threadMenuCommand(threadId, { kind: "endSession" });
  }, [threadMenuCommand]);
  const threadBulkCommand = useAgentLatestCallback(menu.handleThreadBulkCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  const activeProjectRootKeyRef = useRef<string | null>(null);
  const projectThreads = useAgentProjectThreadCommands({
    navigation,
    groups,
    composer,
    picker: newThreadPicker,
    activeProjectRootKey: () => activeProjectRootKeyRef.current,
    onBeforeProjectChange: () => {
      chrome.addProject?.cancelSelection?.();
      setProjectSelectionIntent((current) => current + 1);
    },
    onSelectProjectEnvironment,
  });
  const requestNewThread = projectThreads.requestNewThread;
  const sectionRef = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(layout.rail, sectionRef);
  const { attention, attentionExplanation, capacity, live } = useMemo(
    () =>
      agentThreadActivitySummary(
        agents.threads,
        agents.liveTaskCount,
        agents.maxConcurrentAgentTasks,
      ),
    [agents.liveTaskCount, agents.maxConcurrentAgentTasks, agents.threads],
  );
  const threadActivitySummary = useMemo(
    () => ({ attention, attentionExplanation, capacity, live }),
    [attention, attentionExplanation, capacity, live],
  );
  const attentionVisible = chrome.threadActivity?.attentionVisible ?? true;
  const changeAttentionVisible = chrome.threadActivity?.onChangeAttentionVisible ?? null;
  const footerActivity = useMemo(
    () => (
      <AgentThreadActivity
        attentionVisible={attentionVisible}
        onChangeAttentionVisible={changeAttentionVisible}
        ownerKey={workspaceRoot}
        summary={threadActivitySummary}
      />
    ),
    [attentionVisible, changeAttentionVisible, threadActivitySummary, workspaceRoot],
  );
  const sidebarRevealDetail = agentThreadActivityDetail(threadActivitySummary, attentionVisible);
  const activateSurface = useAgentLatestCallback(surface.activateSurface);
  const closeSurfaceTab = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") diffScopes.resetScope();
    surface.closeSurfaceTab(kind);
  });
  const openSurfaceCommand = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") diffScopes.resetScope();
    openSurface(kind);
  });
  const toggleRightPanelCommand = useAgentLatestCallback(toggleRightPanel);
  const openAgentsSurface = useAgentLatestCallback(() => surface.openSurface("agents"));
  const toggleAgentsSurface = useAgentLatestCallback(() => surface.toggleSurface("agents"));
  const revealFailed = useCallback(() => setLocalNotice(REVEAL_FAILED_NOTICE), [setLocalNotice]);
  const revealAgentAttachment = agents.revealAttachment;
  const revealAttachment = useCallback(
    (threadId: string, attachmentId: string): void => {
      void revealAgentAttachment(threadId, attachmentId);
    },
    [revealAgentAttachment],
  );

  const navigationCommands = navigation.commands;
  const surfaceBlocked = surface.surfaceBlocked;
  const openAddProjectRef = useRef<() => void>(() => undefined);
  const commandHandlers = useMemo<AgentViewCommandHandlers>(
    () => ({
      ...navigationCommands,
      newThread: () => requestNewThread(false),
      newThreadIn: projectThreads.openNewThreadPicker,
      runPreferredScript: () => {
        if (scripts.preferred === null) return;
        scripts.runScript(scripts.preferred.key);
      },
      openCommitMenu: () => {
        if (selectedThreadId === null) return;
        openSurfaceCommand("git");
      },
      goToTurn: () => {
        if (selectedThreadId === null) return;
        setGoToTurnSignal((current) => current + 1);
      },
      toggleMaximizedPanel: toggleResponsivePanel,
      addProject: () => openAddProjectRef.current(),
      surfaceBlocked,
    }),
    [
      navigationCommands,
      scripts,
      selectedThreadId,
      requestNewThread,
      projectThreads.openNewThreadPicker,
      openSurfaceCommand,
      surfaceBlocked,
      toggleResponsivePanel,
    ],
  );
  useAgentViewCommands(viewCommands, commandHandlers);
  useAgentCommandPaletteProvider({
    threads: presentationThreads,
    projects,
    selectedThreadId,
    activeProjectKey: navigation.railScope?.projectRootKey ?? null,
    scripts,
    selectThread: navigation.selectThread,
    switchProject: projectThreads.switchProject,
    newThreadIn: projectThreads.newThreadInProject,
  });

  const notice = localNotice ?? agents.notice;
  const dismissNotice = useCallback(() => {
    if (localNotice !== null) {
      setLocalNotice(null);
      return;
    }
    if (agents.notice !== null) {
      agents.dismissNotice();
      return;
    }
  }, [agents, localNotice, setLocalNotice]);

  const composerTargetProjectRootKey = composer.target?.projectRootKey ?? null;
  const composerTargetRepositoryRoot = composer.target?.repositoryRoot ?? null;
  const addProjectSelectionIdentity = useMemo(
    () => ({ selectedThreadId, projectSelectionIntent, composerTargetProjectRootKey }),
    [composerTargetProjectRootKey, selectedThreadId, projectSelectionIntent],
  );
  const selectAddedProject = useAgentLatestCallback((project: AgentProjectDescriptor) => {
    if (!navigation.setProjectScope(project.rootKey)) return;
    navigation.setRailScope({ projectRootKey: project.rootKey, repositoryRoot: project.rootPath });
    onSelectProjectEnvironment(project.rootKey);
    navigation.clearSelectedThread();
    composer.clearSelection();
  });
  const creation = useAgentProjectCreation({
    selectionIdentity: addProjectSelectionIdentity,
    onProjectAdded: selectAddedProject,
    chrome: chrome.addProject,
    projects,
    reportNotice: setLocalNotice,
    workspaceRoot,
    selectedServerId,
    refreshProjects: refreshRemoteProjects,
  });
  const { addProject, remoteAdd } = creation;
  useAgentConversationEscape(
    navigation.centerRef,
    creation.visible ? null : agentConversationEscapeAction(composerProps),
  );
  const openRemoteAddProject = useAgentLatestCallback(creation.open);
  const cancelPendingClone = useAgentLatestCallback(creation.cancel);
  const dismissPendingClone = useAgentLatestCallback(creation.dismiss);
  const openAddProject = useAgentLatestCallback(creation.open);
  useLayoutEffect(() => {
    openAddProjectRef.current = openAddProject;
  }, [openAddProject]);
  const openPendingClone = useAgentLatestCallback(creation.showPending);
  const remoteAddCloneRunning =
    remoteAdd.pendingClone !== null && remoteAddProjectCloneActive(remoteAdd.pendingClone.status);

  const cloneComposerVisible =
    creation.visible && creation.pending !== null && creation.pendingClone !== null;
  const cloneProjectRootKey = creation.completedProject?.rootKey ?? null;
  const cloneProjectRootPath = creation.completedProject?.rootPath ?? null;
  const headerFallback = useMemo(() => {
    if (cloneComposerVisible)
      return cloneProjectRootKey === null || cloneProjectRootPath === null
        ? null
        : { projectRootKey: cloneProjectRootKey, repositoryRoot: cloneProjectRootPath };
    return composerTargetProjectRootKey === null || composerTargetRepositoryRoot === null
      ? null
      : {
          projectRootKey: composerTargetProjectRootKey,
          repositoryRoot: composerTargetRepositoryRoot,
        };
  }, [
    cloneComposerVisible,
    cloneProjectRootKey,
    cloneProjectRootPath,
    composerTargetProjectRootKey,
    composerTargetRepositoryRoot,
  ]);
  const headerProject = useMemo(() => {
    const header = agentThreadHeaderProject(
      selectedThread,
      executionGroups,
      projects,
      headerFallback,
    );
    if (header === null) return null;
    const group = groups.find(
      (entry) =>
        entry.projectRootKey === header.projectRootKey ||
        entry.memberProjectRootKeys?.includes(header.projectRootKey),
    );
    return group ? { ...header, label: group.label } : header;
  }, [groups, executionGroups, headerFallback, projects, selectedThread]);
  const activeProjectRootKey = headerProject?.projectRootKey ?? null;
  useLayoutEffect(() => {
    activeProjectRootKeyRef.current = activeProjectRootKey;
  }, [activeProjectRootKey]);
  const panelShortcuts = chrome.shortcuts ?? defaultAgentPanelLayoutShortcuts();
  const newThreadInShortcut =
    panelShortcuts.newThreadIn ?? defaultAgentPanelLayoutShortcuts().newThreadIn ?? "";
  const newThreadTitle = agentNewThreadTooltip({
    shortcut: panelShortcuts.newThread,
    pickerShortcut: newThreadInShortcut,
    projectLabel: headerProject?.label ?? null,
    projectCount: railScopeEntries.length,
  });
  const revealWorkspacePath = useAgentLatestCallback((path: string) => {
    void chrome.revealPath(path).catch(revealFailed);
  });
  const workspaceCard = useAgentWorkspaceCardSlot(
    {
      project: headerProject,
      thread: selectedThread,
      draftIsolation: composer.composerProps.isolation,
      draftPreviousWorktree:
        composer.composerProps.previousWorktree?.selected === true
          ? composer.composerProps.previousWorktree.available
          : null,
      draftServerId: selectedThread === null ? selectedServerId : null,
      servers: remoteContext?.servers ?? NO_REMOTE_SERVERS,
      liveBranches: chrome.liveCheckoutBranches,
      branchMemory: threadBranchMemory.memory,
    },
    {
      newThreadInShortcut,
      onNewThreadIn: projectThreads.openNewThreadPicker,
      onReveal: revealWorkspacePath,
    },
  );
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
  const openHeaderTerminalSessions = useMemo(() => {
    const target = headerTerminalSessionsTarget;
    if (target === null || target.projectRootKey.startsWith("remote:")) return null;
    return () => openTerminalSessions(target.projectRootKey, target.repositoryRoot);
  }, [headerTerminalSessionsTarget, openTerminalSessions]);
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
      openChangedFileDiff: agents.openChangedFileDiff,
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
      agents.openChangedFileDiff,
      agents.showChanges,
      agents.showFileDiff,
      agents.turnChangesRevision,
    ],
  );
  useAgentThreadBranchRecorder(agents.threads, chrome.liveCheckoutBranches, threadBranchMemory);
  const composerExtras = useAgentComposerDrawerExtras(chrome.branchCheckout, agents.accountUsage, {
    thread: selectedThread,
    branchMemory: threadBranchMemory,
    liveCheckoutBranches: chrome.liveCheckoutBranches,
  });
  return (
    <AgentAgentsPanelProvider
      isOpen={surface.isSurfaceOpen("agents")}
      onOpen={openAgentsSurface}
      onToggle={toggleAgentsSurface}
    >
      <section
        aria-label="Agent mode"
        className={["agent-mode", surfaceEnterClass].filter(Boolean).join(" ")}
        data-slot="agent"
        ref={sectionRef}
      >
        <AgentClockProvider nowTickMs={nowTickMs}>
          <div className="agent-mode__grid">
            {layout.rail === "collapsed" ? null : (
              <AgentThreadBranchMemoryContext.Provider value={threadBranchMemory.memory}>
                <AgentThreadsSidebar
                  catalog={agents.catalog}
                  collapseShortcut={chrome.shortcuts?.sidebar ?? null}
                  footerActivity={footerActivity}
                  addProjectAvailable={chrome.addProject !== null}
                  evidenceOf={turnEvidenceOf}
                  groups={groups}
                  onAddProject={openAddProject}
                  onCancelPendingClone={cancelPendingClone}
                  onDismissPendingClone={dismissPendingClone}
                  pendingClones={creation.pendingClones}
                  onOpenPendingClone={openPendingClone}
                  onCollapseSidebar={toggleRail}
                  onNewThread={requestNewThread}
                  newThreadTitle={newThreadTitle}
                  workspaceCard={workspaceCard}
                  onOpenProviderSettings={agents.configureAgentCli}
                  onOpenSourceControl={onOpenSourceControl}
                  onOpenUsage={onOpenUsageSettings}
                  onProjectCommand={projectMenuCommand}
                  onChangeFilter={railFilter.setFilter}
                  onSelectThread={navigation.selectThread}
                  onThreadBulkCommand={threadBulkCommand}
                  onThreadMenuCommand={threadMenuCommand}
                  onTogglePin={togglePin}
                  overflowRootPaths={overflowRootPaths}
                  pendingInteractions={pendingInteractions}
                  railFilter={railFilter.filter}
                  providerEnabled={effectiveProviderEnabled}
                  providerManagement={agents.providerManagement}
                  scope={railScope}
                  scopeEntries={navigation.scopeEntries}
                  search={navigation.search}
                  selectedThreadId={selectedThread?.thread.threadId ?? null}
                  turnLog={agents.turnLog ?? null}
                />
              </AgentThreadBranchMemoryContext.Provider>
            )}
            {layout.rail === "expanded" && (
              <AgentRailResizeHandle
                onReset={surface.resetRailWidth}
                onResize={surface.resizeRail}
                width={layout.railWidth}
              />
            )}

            <div
              className="agent-mode__center"
              inert={layout.rightPanelMaximized || undefined}
              ref={navigation.centerRef}
            >
              <AgentThreadHeader
                bottomPanelOpen={chrome.bottomPanelVisible}
                gitSurfaceActive={layout.rightPanel === "open" && layout.activeSurface === "git"}
                layout={layout}
                leading={
                  layout.rail === "collapsed" && !layout.rightPanelMaximized ? sidebarReveal : null
                }
                onNewThread={newThread}
                onOpenScriptsView={chrome.onOpenScriptsView}
                onOpenSurface={openSurfaceCommand}
                onOpenTerminalSessions={openHeaderTerminalSessions}
                onRenameThread={renameThread}
                onRevealFailed={revealFailed}
                onRevealPath={chrome.revealPath}
                onThreadMenuCommand={threadMenuCommand}
                onToggleBottomPanel={chrome.onToggleBottomPanel}
                onToggleRightPanel={toggleRightPanelCommand}
                project={headerProject}
                scripts={headerScripts}
                shortcuts={chrome.shortcuts}
                thread={selectedThread}
                trailingExtras={AGENTS_TOGGLE_BUTTON}
              />
              <AgentThreadErrorBanner
                agents={agents}
                recovery={composer.composerProps.recovery ?? null}
                view={sessionThread}
              />
              {projects.length === 0 &&
              creation.pendingClones.length === 0 &&
              selectedServerId === null &&
              selectedThreadId === null ? (
                projectsLoaded ? (
                  <NoProjectsHero onAddProject={openAddProject} />
                ) : null
              ) : creation.visible &&
                creation.pending !== null &&
                creation.pendingClone !== null ? (
                <AgentCloneComposer
                  creation={creation}
                  agents={{
                    ...agents,
                    attachments:
                      creation.pending.environment === null
                        ? cloneAttachments.local
                        : cloneAttachments.remote,
                  }}
                  projects={projects}
                  providerEnabled={
                    creation.pending.environment === null
                      ? providerEnabled
                      : REMOTE_PROVIDERS_ENABLED
                  }
                  providerManagement={agents.providerManagement}
                  modelFavoritesPersistence={modelFavoritesPersistence}
                  onThreadStarted={navigation.selectStartedThread}
                  onOpenProviderSettings={agents.configureAgentCli}
                  onOpenEnvironmentSettings={onOpenEnvironmentSettings}
                  onTrustProject={trustProject}
                />
              ) : selectedThreadId === null &&
                selectedServerId !== null &&
                composer.target === null ? (
                <AgentRemoteDraftProjectChooser
                  projects={composerProjects}
                  cloneRunning={remoteAddCloneRunning}
                  onAddProject={openRemoteAddProject}
                  onOpenSettings={onOpenEnvironmentSettings}
                  onSelect={(project) => {
                    const live = projects.find(
                      (candidate) =>
                        candidate.rootKey === project.rootKey &&
                        candidate.ownerId === project.ownerId &&
                        candidate.generation === project.generation,
                    );
                    if (
                      live === undefined ||
                      live.trust !== "trusted" ||
                      selectedServerId === null ||
                      !live.rootKey.startsWith(`remote:${encodeURIComponent(selectedServerId)}:`)
                    )
                      return;
                    const group = groups.find(
                      (candidate) =>
                        candidate.projectRootKey === live.rootKey ||
                        candidate.memberProjectRootKeys?.includes(live.rootKey),
                    );
                    setProjectSelectionIntent((current) => current + 1);
                    navigation.setRailScope({
                      projectRootKey: live.rootKey,
                      repositoryRoot: live.rootPath,
                      memberProjectRootKeys: group?.memberProjectRootKeys,
                    });
                    composer.startNewThread(project.rootKey, project.rootPath);
                  }}
                />
              ) : (
                <AgentThreadSession
                  activeDiffTurnId={diffScopes.activeDiffTurnId}
                  awaiting={
                    sessionThread === null
                      ? null
                      : (pendingInteractions.get(sessionThread.thread.threadId) ?? null)
                  }
                  history={sessionThread?.execution?.kind === "remote" ? undefined : agents.history}
                  importedHistory={
                    sessionThread === null
                      ? undefined
                      : agents.externalHistory?.pages?.get(sessionThread.thread.threadId)
                  }
                  hasEarlierImportedHistory={
                    sessionThread === null
                      ? false
                      : agents.externalHistory?.hasEarlier?.get(sessionThread.thread.threadId)
                  }
                  onEarlierImportedHistory={
                    sessionThread === null || agents.externalHistory?.loadEarlier === undefined
                      ? undefined
                      : () => {
                          void agents.externalHistory?.loadEarlier?.(sessionThread.thread.threadId);
                        }
                  }
                  artifactLoader={artifactLoader}
                  artifactPreview={artifactPreview}
                  localFileLinks={localFileLinks}
                  attachmentImages={agents.attachmentImages}
                  onRevealAttachment={revealAttachment}
                  findBar={
                    find.open ? (
                      <AgentThreadFindBar
                        currentIndex={find.hitIndex}
                        hitCount={find.hits.length}
                        onChangeQuery={find.setQuery}
                        onClose={navigation.closeFindBar}
                        onNavigate={find.navigate}
                        query={find.query}
                        truncated={find.truncated}
                      />
                    ) : null
                  }
                  findOpen={find.open}
                  goToTurnSignal={goToTurnSignal}
                  externalHistoryState={
                    sessionThread === null
                      ? undefined
                      : agents.externalHistory?.states.get(sessionThread.thread.threadId)
                  }
                  onRetryExternalHistory={
                    sessionThread === null || agents.externalHistory === undefined
                      ? undefined
                      : () => {
                          void agents.externalHistory?.load(sessionThread.thread.threadId);
                        }
                  }
                  composerRepositoryLabel={headerProject?.label ?? composer.composerLabel}
                  findHitIndex={navigation.findHitIndex}
                  findHits={find.open ? find.hits : undefined}
                  findQuery={find.open ? find.query : undefined}
                  deferredFollowUps={
                    sessionThread === null
                      ? undefined
                      : deferredFollowUpsForThread(
                          agents.deferredFollowUps,
                          sessionThread.thread.threadId,
                        )
                  }
                  onRemoveDeferredFollowUp={agents.removeDeferredFollowUp}
                  onEditDeferredFollowUp={
                    sessionThread === null ||
                    sessionThread.execution?.kind === "remote" ||
                    !queuedEdit.supported
                      ? undefined
                      : queuedEdit.begin
                  }
                  onResumeDeferredFollowUps={agents.resumeDeferredFollowUps}
                  onSendDeferredFollowUpNow={
                    sessionThread !== null &&
                    (sessionThread.execution?.kind === "remote"
                      ? sessionThread.execution.taskSteering === true
                      : agentThreadIsSteerable(sessionThread.thread))
                      ? agents.sendDeferredFollowUpNow
                      : undefined
                  }
                  onReviewInDiff={reviewInDiff}
                  onStopBackground={composer.composerProps.onStopNow}
                  sessionTaskControls={sessionBackground.controls}
                  onStopSessionTask={sessionBackground.onStopTask}
                  onEndSession={sessionBackground.onEndSession}
                  pendingSend={composer.pendingSend}
                  onDismissPendingSend={composer.dismissPendingSend}
                  onOpenTurnDiff={openRecordedDiff}
                  turnChangesRevision={
                    sessionThread
                      ? (agents.getTurnChangesRevision?.(sessionThread.thread.threadId) ??
                        agents.turnChangesRevision)
                      : agents.turnChangesRevision
                  }
                  getTurnChanges={agents.getTurnChanges}
                  monacoTheme={monacoTheme}
                  reveal={find.reveal}
                  textClipboard={textClipboard}
                  thread={sessionThread}
                  turnLog={agents.turnLog ?? null}
                />
              )}
              {sessionThread !== null &&
                agents.hasUnconfirmedMessage?.(sessionThread.thread.threadId) && (
                  <AgentUnconfirmedMessageNotice
                    onDismiss={() =>
                      agents.discardUnconfirmedMessage?.(sessionThread.thread.threadId)
                    }
                  />
                )}
              <AgentEndSessionConfirmationBanner confirmation={menu.endSessionConfirmation} />
              {notice && (
                <div className="agent-thread-notice">
                  <AgentNoticeBar
                    notice={notice}
                    onConfigure={() => agents.configureAgentCli()}
                    onDismiss={dismissNotice}
                    onRestartFollowUp={(action) => {
                      dismissNotice();
                      void agents.restartDeferredFollowUp?.(action.threadId, action.entryId);
                    }}
                  />
                </div>
              )}
              {!creation.visible && (
                <AgentQuestionAttachmentsContext.Provider
                  value={agents.questionAttachments ?? null}
                >
                  <AgentComposerController
                    followUpBehavior={followUpBehavior}
                    executionServerId={
                      selectedThread?.execution?.serverId ??
                      pendingRemoteIdentity?.serverId ??
                      (resolvingRemoteThread
                        ? "unavailable"
                        : selectedThread === null
                          ? selectedServerId
                          : null)
                    }
                    compactionOffer={
                      selectedThread?.execution?.kind === "remote" ? null : compactionOffer
                    }
                    composerProps={composerProps}
                    modelFavoritesPersistence={modelFavoritesPersistence}
                    onOpenEnvironmentSettings={onOpenEnvironmentSettings}
                    onOpenProviderSettings={agents.configureAgentCli}
                    providerManagement={agents.providerManagement}
                    providerEnabled={effectiveProviderEnabled}
                    submissionBlocked={resolvingRemoteThread || composer.submissionBlocked}
                    submit={submitComposer}
                    interactions={{ gateway: questionGateway, thread: sessionThread }}
                    banners={composerExtras.banners}
                    onShowUsageLimits={composerExtras.onShowUsageLimits}
                    renderDrawerEnd={composerExtras.renderDrawerEnd}
                  />
                </AgentQuestionAttachmentsContext.Provider>
              )}
            </div>
          </div>
        </AgentClockProvider>
        <ProjectOnboardingLayer
          chrome={chrome.addProject}
          creation={creation}
          lookupGateway={remoteContext?.repositoryLookup ?? null}
          selectedServerId={selectedServerId}
          servers={remoteContext?.servers ?? NO_REMOTE_SERVERS}
        />
        <AgentThreadSearchPalette
          archivedThreadIds={navigation.palette.archivedThreadIds}
          isOpen={navigation.palette.open}
          onActivate={navigation.palette.activate}
          onChangeQuery={navigation.search.setQuery}
          onClose={navigation.palette.close}
          pending={navigation.search.pending}
          query={navigation.search.query}
          result={navigation.search.result}
          titles={navigation.palette.titles}
        />
        {sessionImport.surface !== null && (
          <AgentTerminalSessionsPalette
            isOpen={terminalSessionsPalette.open}
            onClose={closeTerminalSessions}
            onImport={sessionImport.importOne}
            onImportMany={sessionImport.importMany}
            importProgress={sessionImport.importProgress}
            importNotice={sessionImport.importNotice}
            onSelectImported={selectImportedThread}
            projectLabel={terminalSessionsProjectLabel}
            surface={sessionImport.surface}
          />
        )}
      </section>
      {surface.surfaceHost.mounted && (
        <AgentSurfaceHost
          draftIsolation={composer.composerProps.isolation}
          draftPreviousWorktree={
            composer.composerProps.previousWorktree?.selected === true
              ? composer.composerProps.previousWorktree.available
              : null
          }
          agents={surfaceAgents}
          agentsPanel={AGENTS_PANEL_SURFACE}
          diffScope={diffScopes.scope}
          onDiffScopeChange={diffScopes.setScope}
          remoteDraft={surfaceThread === null && selectedServerId !== null}
          remoteSurface={remoteSurface}
          shipActions={shipActions}
          scripts={scripts}
          chooserAutoFocus={surface.chooserRequested}
          chrome={chrome}
          hidden={surface.surfaceHost.hidden}
          layout={layout}
          layoutControls={layoutControls}
          leadingControls={
            layout.rail === "collapsed" && layout.rightPanelMaximized ? sidebarReveal : null
          }
          onResizeWidth={surface.resizeRightPanel}
          onActivateSurface={activateSurface}
          onCloseSurfaceTab={closeSurfaceTab}
          onOpenSurface={openSurfaceCommand}
          onSwitchScope={chrome.addProject === null ? null : addProject.addProject}
          onTrustScope={trustProject}
          projects={projects}
          scope={surfaceScope}
          thread={surfaceThread}
          threadRootPath={surfaceThreadRootPath}
          workspaceRoot={workspaceRoot}
        />
      )}
    </AgentAgentsPanelProvider>
  );
}

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
