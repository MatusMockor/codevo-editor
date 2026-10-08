import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import type { AgentDiffTurn } from "../../domain/diffView/agentDiffScope";
import { useAgentDiffScopeSelection } from "./useAgentDiffScopeSelection";
import type { MonacoAppTheme } from "../../domain/settings";
import { useProjectRepositoryIdentities } from "../../application/useProjectRepositoryIdentities";
import { repositoryIdentityCandidates } from "../../application/repositoryIdentityCandidates";
import { TauriRepositoryIdentityGateway } from "../../infrastructure/tauriRepositoryIdentityGateway";
import { SHARED_REMOTE_REPOSITORY_IDENTITY } from "../remoteRunner/sharedRemoteRepositoryIdentity";
import { TauriRemoteGitSyncGateway } from "../../infrastructure/tauriRemoteGitSyncGateway";
import { TauriCompareUrlOpener } from "../../infrastructure/tauriGitIntegrationGateway";
import { BrowserAgentAttachmentEncoder } from "../../infrastructure/browserAgentAttachmentEncoder";
import { useAgentProjectCreation } from "./useAgentProjectCreation";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
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
import type { SpeechLanguage } from "../../domain/speechDictation";
import { useRemoteSurfaceContext } from "./useRemoteSurfaceContext";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import { useAgentPendingInteractionObservations } from "../../application/useAgentPendingInteractions";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSurfaceEnterClass } from "../workbenchFrameBootContext";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { useRemoteProjectLinks } from "../../application/useRemoteProjectLinks";
import { useAgentProjectGrouping } from "../../application/useAgentProjectGrouping";
import {
  groupedEnvironmentProjects,
  environmentComposerScope,
  newThreadEnvironmentProjectRootKey,
} from "./agentEnvironmentProjects";
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
import type { AgentRailProjectCollapsePreferencePort } from "../../application/agentRailProjectCollapsePreferencePort";
import type { AgentRailProjectFocusPreferencePort } from "../../application/agentRailProjectFocusPreferencePort";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import { useAgentThreadBranchMemory } from "../../application/useAgentThreadBranchMemory";
import { useAgentThreadBranchRecorder } from "../../application/useAgentThreadBranchRecorder";
import { AgentThreadBranchMemoryContext } from "./agentThreadBranchMemoryContext";
import { useAgentRailProjectDisclosure } from "./useAgentRailProjectDisclosure";
import { useAgentRailProjectFocus } from "./useAgentRailProjectFocus";
import {
  useAgentRailWorkingPendingInteractions,
  useAgentRailWorkingRail,
} from "./useAgentRailWorkingRail";
import { agentProjectWorkspaceTabRoot } from "./agentProjectWorkspaceTab";
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
import { AgentEndSessionStandaloneBanner } from "./AgentEndSessionConfirmationBanner";
import { AgentThreadFindBar } from "./AgentThreadFindBar";
import { AgentSidebarReveal } from "./AgentSidebarReveal";
import { AgentThreadActivity } from "./AgentThreadActivity";
import {
  agentThreadActivityDetail,
  agentThreadActivitySummary,
} from "./agentThreadActivityPresentation";
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";
import { AgentAttachmentDropColumn } from "./AgentAttachmentDropColumn";
import { AgentThreadHeader } from "./AgentThreadHeader";
import { RemotePortPreviewMenu } from "./RemotePortPreviewMenu";
import { useAgentServerPorts, type AgentRemotePortPreviewWiring } from "./useAgentServerPorts";
import { AgentThreadErrorBanner } from "./AgentThreadErrorBanner";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentAgentsPanelSurface } from "./agents/AgentAgentsPanelSurface";
import { AgentAgentsToggleButton } from "./agents/AgentAgentsToggleButton";
import { AgentTerminalSessionsPalette } from "./AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "./AgentThreadSearchPalette";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadNotifications } from "./AgentThreadNotifications";
import type { AgentThreadNotificationCenter } from "../../application/agentThreadNotificationCenter";
import { useAgentSessionBackgroundControls } from "./useAgentSessionBackgroundControls";
import { usePreloadAgentMarkdownRenderer } from "./useAgentMarkdown";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { AgentClockProvider } from "./agentClock";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentProjectTerminalSessionsTarget,
  agentRailScopeEntries,
  agentRailScopeEntryFor,
} from "./agentSidebarPresentation";
import { defaultAgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";
import {
  agentSurfaceScopeFor,
  agentThreadCheckoutRoot,
  isRemoteAgentSurfaceThread,
} from "./agentSurfacePolicy";
import { useScopedAgentNotice } from "./useScopedAgentNotice";
import { useAgentLocalFileLinks } from "./useAgentLocalFileLinks";
import { useAgentRemoteFileLinks } from "./useAgentRemoteFileLinks";
import { useAgentSessionImport } from "./useAgentSessionImport";
import { useAgentComposerControllerState } from "./useAgentComposerState";
import { useAgentComposerDrawerExtras } from "./useAgentComposerDrawerExtras";
import { AgentDictationProvider } from "./dictation/AgentDictationProvider";
import { agentComposerThreadLocation } from "./agentComposerThreadLocation";
import { agentNewThreadTooltip } from "./agentNewThreadRequest";
import { useAgentQueuedFollowUpEdit } from "./useAgentQueuedFollowUpEdit";
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
} from "./useAgentQueuedEditImagePreviews";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { AgentProjectRenameDialog } from "./AgentProjectRenameDialog";
import { useAgentProjectRename } from "./useAgentProjectRename";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadUndo } from "../../application/useAgentThreadUndo";
import { AgentThreadUndoNotice } from "./AgentThreadUndoNotice";
import { useAgentThreadUndoShortcut } from "./useAgentThreadUndoShortcut";
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
  readonly dictationLanguage?: SpeechLanguage;
  readonly composerVisible?: boolean;
  readonly questionGateway?: AgentQuestionGateway | null;
  readonly artifactLoader?: AgentArtifactLoader | null;
  readonly artifactPreview?: AgentArtifactPreviewPort | null;
  readonly imageSurface?: AgentImageSurfacePort | null;
  readonly navigationSession?: AgentNavigationSession;
  readonly navigationKey?: string;
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
  readonly projectCollapsePreference?: AgentRailProjectCollapsePreferencePort | null;
  readonly projectFocusPreference?: AgentRailProjectFocusPreferencePort | null;
  readonly workingSectionPreference?: AgentRailWorkingSectionPreferencePort | null;
  readonly newThreadPicker?: AgentNewThreadPicker | null;
  readonly threadNotifications?: AgentThreadNotificationCenter | null;
  readonly threadNotificationsVisible?: boolean;
  readonly remotePortPreview?: AgentRemotePortPreviewWiring | null;
  onOpenSourceControl?(): void;
  onOpenEnvironmentSettings?(): void;
  onOpenUsageSettings?(): void;
  onOpenMcpSettings?(): void;
  onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
  onCloseProject?(rootPath: string): void;
  onActivateWorkspaceTab?(rootPath: string): Promise<boolean>;
  onReleaseProject(projectRootKey: string): void;
}

const DEFAULT_NOW_TICK_MS = 30_000;
const NO_DIFF_TURNS: ReadonlyArray<AgentDiffTurn> = [];
const NOOP_OPEN_SOURCE_CONTROL = () => undefined;
const PROJECT_IDENTITY_GATEWAY = new TauriRepositoryIdentityGateway();
const REMOTE_PROJECT_IDENTITY_GATEWAY = SHARED_REMOTE_REPOSITORY_IDENTITY;
const REMOTE_GIT_SYNC_GATEWAY = new TauriRemoteGitSyncGateway();
const REMOTE_ATTACHMENT_ENCODER = new BrowserAgentAttachmentEncoder();
const REMOTE_COMPARE_URL_OPENER = new TauriCompareUrlOpener();
const NOOP_CLOSE_PROJECT = () => undefined;
const NOOP_SELECTED_PROJECT = () => undefined;
const NO_REMOTE_SERVERS: readonly import("../../domain/remoteRunner").RemoteRunnerServer[] = [];
const REMOTE_PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;

function workspaceTabSwitchFailedNotice(label: string): AgentTasksNotice {
  return { kind: "warning", message: `Could not switch to ${label}.`, action: null };
}

const TERMINAL_SESSIONS_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Terminal sessions are not available in this workbench.",
  action: null,
};

interface AgentModeSelection {
  readonly navigationKey: string;
  readonly threadId: string | null;
  readonly projectRootKey: string | null;
}

function freshAgentModeSelection(
  navigationKey: string,
  session: AgentNavigationSession | undefined,
): AgentModeSelection {
  return {
    navigationKey,
    threadId: session?.current.selectedThreadId ?? null,
    projectRootKey: null,
  };
}

function currentAgentModeSelection(
  stored: AgentModeSelection,
  navigationKey: string,
  session: AgentNavigationSession | undefined,
): AgentModeSelection {
  if (stored.navigationKey === navigationKey) return stored;
  return freshAgentModeSelection(navigationKey, session);
}

export function AgentModeView(props: AgentModeViewProps) {
  const remote = useRemoteRunnerContext();
  const navigationKey = props.navigationKey ?? "";
  const session = props.navigationSession;
  const [stored, setStored] = useState(() => freshAgentModeSelection(navigationKey, session));
  const { threadId: selectedThreadId, projectRootKey: selectedProjectRootKey } =
    currentAgentModeSelection(stored, navigationKey, session);
  const setSelectedThreadId = useCallback(
    (threadId: string | null) =>
      setStored((previous) => ({
        ...currentAgentModeSelection(previous, navigationKey, session),
        threadId,
      })),
    [navigationKey, session],
  );
  const setSelectedProjectRootKey = useCallback(
    (projectRootKey: string | null) =>
      setStored((previous) => ({
        ...currentAgentModeSelection(previous, navigationKey, session),
        projectRootKey,
      })),
    [navigationKey, session],
  );
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
  const claudeCatalog = useAgentClaudeModelCatalog();
  const unified = useUnifiedAgentThreads({
    local: props.agents,
    gateway: remote?.gateway ?? null,
    servers: remote?.servers ?? NO_REMOTE_SERVERS,
    selectedServerId: remote?.selectedServerId ?? null,
    workspaceOwner: props.workspaceRoot,
    selectedThreadId,
    selectedProjectRootKey,
    localProjects: props.projects,
    claudeCatalog,
    metadataRepository: remote?.metadataRepository,
    imageSurface: props.imageSurface ?? null,
    attachmentEncoder: REMOTE_ATTACHMENT_ENCODER,
    gitSync: REMOTE_GIT_SYNC_GATEWAY,
    repositoryIdentity: REMOTE_PROJECT_IDENTITY_GATEWAY,
    externalUrlOpener: REMOTE_COMPARE_URL_OPENER,
  });
  const view = (
    <LocalAgentModeView
      {...props}
      key={navigationKey}
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
  const projectGrouping = useAgentProjectGrouping();
  const executionGroups = useMemo(
    () => agentProjectGroups(projects, presentationThreads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, presentationThreads],
  );

  const repositoryIdentities = useProjectRepositoryIdentities(
    repositoryIdentityCandidates(projects, projectLinks),
    PROJECT_IDENTITY_GATEWAY,
    REMOTE_PROJECT_IDENTITY_GATEWAY,
  );
  const environmentGroups = useMemo(
    () =>
      groupedEnvironmentProjects(
        executionGroups,
        projects,
        projectLinks,
        repositoryIdentities,
        projectGrouping,
      ),
    [executionGroups, projects, projectLinks, repositoryIdentities, projectGrouping],
  );
  const projectRename = useAgentProjectRename({
    groups: environmentGroups,
    executionGroups,
    projects,
    catalog: agents.catalog,
  });
  const groups = projectRename.groups;
  const displayProjects = projectRename.projects;
  const externalSessions = agents.externalSessions ?? null;
  const turnEvidenceOf = useCallback<AgentTurnLogEvidenceLookup>(
    (turnId) => agentTurnLogEvidence(agents.turnLog?.factsOf(turnId) ?? null),
    [agents.turnLog],
  );
  const railScopeEntries = useMemo(() => agentRailScopeEntries(groups), [groups]);
  const projectDisclosure = useAgentRailProjectDisclosure(projectCollapsePreference);
  const projectFocus = useAgentRailProjectFocus(projectFocusPreference);
  const workingRail = useAgentRailWorkingRail(workingSectionPreference);
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
    projectDisclosure: projectDisclosure.state,
    projectFocus: projectFocus.focus,
    workingSplit: workingRail.latestSplit,
    revealProject: projectDisclosure.expand,
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
  const pendingObservations = useAgentPendingInteractionObservations(
    questionGateway,
    agents.threads,
    selectedThread?.thread.threadId ?? null,
  );
  const pendingInteractions = pendingObservations.pending;
  useAgentRailWorkingPendingInteractions(workingRail, pendingInteractions);
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
    () => agentSurfaceScopeFor(composerScope, displayProjects, workspaceRoot),
    [composerScope, displayProjects, workspaceRoot],
  );

  const composerProjects = useMemo(() => {
    if (selectedThread !== null) return displayProjects;
    const prefix =
      selectedServerId === null ? null : `remote:${encodeURIComponent(selectedServerId)}:`;
    return displayProjects.filter((project) =>
      prefix === null ? !project.rootKey.startsWith("remote:") : project.rootKey.startsWith(prefix),
    );
  }, [displayProjects, selectedServerId, selectedThread]);
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
    groups: projectRename.executionGroups,
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
  const resetDraftLaunch = useAgentLatestCallback((projectRootKey: string | null) => {
    composer.resetDraftLaunch(
      newThreadEnvironmentProjectRootKey(
        projectRootKey,
        groups,
        projects,
        selectedServerId,
        navigation.composerScope,
      ),
    );
  });
  const resetProjectDraftLaunch = useAgentLatestCallback((projectRootKey: string) => {
    composer.resetDraftLaunch(
      newThreadEnvironmentProjectRootKey(projectRootKey, groups, projects, selectedServerId),
    );
  });
  const clearComposer = useAgentLatestCallback(() => {
    resetDraftLaunch(navigation.newThreadTarget()?.projectRootKey ?? null);
    composer.clearSelection();
  });
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
  }, [threadMenuCommand]);
  const threadBulkCommand = useAgentLatestCallback(menu.handleThreadBulkCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  const activeProjectRootKeyRef = useRef<string | null>(null);
  const projectThreads = useAgentProjectThreadCommands({
    navigation,
    groups,
    composer: {
      clearSelection: composer.clearSelection,
      clearDraftTarget: composer.clearDraftTarget,
      resetDraftLaunch,
      resetProjectDraftLaunch,
    },
    picker: newThreadPicker,
    activeProjectRootKey: () => activeProjectRootKeyRef.current,
    onBeforeProjectChange: () => {
      chrome.addProject?.cancelSelection?.();
      setProjectSelectionIntent((current) => current + 1);
    },
    onSelectProjectEnvironment,
  });
  const requestNewThread = projectThreads.requestNewThread;
  const newThreadInProject = useAgentLatestCallback((projectRootKey: string) => {
    projectThreads.newThreadInProject(projectRootKey);
  });
  const activateRailProject = (projectRootKey: string): boolean | Promise<boolean> => {
    const entry = agentRailScopeEntryFor(navigation.scopeEntries, projectRootKey);
    const tabRoot =
      onActivateWorkspaceTab === undefined
        ? null
        : agentProjectWorkspaceTabRoot(projects, projectRootKey, entry?.memberProjectRootKeys);
    if (tabRoot !== null && onActivateWorkspaceTab !== undefined) {
      projectDisclosure.expand(projectRootKey);
      return onActivateWorkspaceTab(tabRoot).then((switched) => {
        if (!switched) setLocalNotice(workspaceTabSwitchFailedNotice(entry?.label ?? tabRoot));
        return switched;
      });
    }
    const scope = navigation.railScope;
    const current =
      scope !== null &&
      agentRailScopeEntryFor(navigation.scopeEntries, scope.projectRootKey)?.projectRootKey ===
        projectRootKey;
    if (!current && !projectThreads.switchProject(projectRootKey)) return false;
    projectDisclosure.expand(projectRootKey);
    return true;
  };
  const switchRailProject = useAgentLatestCallback((projectRootKey: string) => {
    void activateRailProject(projectRootKey);
  });
  const focusRailProject = useAgentLatestCallback((projectRootKey: string) => {
    const previous = projectFocus.focus;
    const activated = activateRailProject(projectRootKey);
    if (activated === false) return;
    projectFocus.setFocus("active");
    if (activated === true) return;
    void activated.then((switched) => {
      if (!switched) projectFocus.setFocus(previous);
    });
  });
  const showAllRailProjects = useAgentLatestCallback(() => projectFocus.setFocus("all"));
  const sectionRef = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(layout.rail, sectionRef);
  useAgentThreadUndoShortcut(sectionRef, threadUndo.notification === null ? null : threadUndo.undo);
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
    projects: displayProjects,
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
                  catalog={projectRename.catalog}
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
                  onNewThreadInProject={newThreadInProject}
                  onFocusProject={focusRailProject}
                  onShowAllProjects={showAllRailProjects}
                  onSwitchProject={switchRailProject}
                  projectDisclosure={projectDisclosure}
                  projectFocus={projectFocus.focus}
                  workingRail={workingRail.rail}
                  onOpenProviderSettings={agents.configureAgentCli}
                  onOpenSourceControl={onOpenSourceControl}
                  onOpenUsage={onOpenUsageSettings}
                  onProjectCommand={projectMenuCommand}
                  onSelectThread={navigation.selectThread}
                  onThreadBulkCommand={threadBulkCommand}
                  onThreadMenuCommand={threadMenuCommand}
                  onTogglePin={togglePin}
                  overflowRootPaths={overflowRootPaths}
                  pendingInteractions={pendingInteractions}
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

            <AgentAttachmentDropColumn
              columnRef={navigation.centerRef}
              inert={layout.rightPanelMaximized}
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
                serverPorts={serverPortsMenu}
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
                  endSessionConfirmation={menu.endSessionConfirmation}
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
                  remoteFileLinks={remoteFileLinks.port}
                  serverLoopback={serverPorts.serverLoopback}
                  attachmentImages={agents.attachmentImages}
                  inlineImages={agents.inlineImages}
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
              {creation.visible && !cloneComposerVisible && (
                <AgentEndSessionStandaloneBanner confirmation={menu.endSessionConfirmation} />
              )}
              <AgentThreadUndoNotice
                notification={threadUndo.notification}
                onDismiss={threadUndo.dismiss}
                onPausedChange={threadUndo.setPaused}
                onUndo={threadUndo.undo}
              />
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
                    endSessionConfirmation={menu.endSessionConfirmation}
                    onShowUsageLimits={composerExtras.onShowUsageLimits}
                    onOpenMcpServers={onOpenMcpSettings}
                    renderDrawerEnd={composerExtras.renderDrawerEnd}
                  />
                </AgentQuestionAttachmentsContext.Provider>
              )}
            </AgentAttachmentDropColumn>
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
          remoteFileReveal={remoteFileLinks.reveal}
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
          projects={displayProjects}
          scope={surfaceScope}
          thread={surfaceThread}
          threadRootPath={surfaceThreadRootPath}
          workspaceRoot={workspaceRoot}
        />
      )}
      <AgentProjectRenameDialog
        onCancel={projectRename.cancel}
        onSubmit={projectRename.submit}
        target={projectRename.target}
      />
      {threadNotifications !== null && (
        <AgentThreadNotifications
          center={threadNotifications}
          onSelectThread={navigation.selectThread}
          interactions={pendingObservations.observed}
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
