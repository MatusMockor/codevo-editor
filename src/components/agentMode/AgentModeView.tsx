import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import type { AgentRecordedTurnSelection } from "./AgentRecordedTurnDiff";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import type { MonacoAppTheme } from "../../domain/settings";
import { useProjectRepositoryIdentities } from "../../application/useProjectRepositoryIdentities";
import { TauriRepositoryIdentityGateway } from "../../infrastructure/tauriRepositoryIdentityGateway";
import { TauriRemoteRepositoryIdentityGateway } from "../../infrastructure/tauriRemoteRepositoryIdentityGateway";
import { useAgentProjectCreation } from "./useAgentProjectCreation";
import {
  AgentProjectSourceDialog,
  AgentExistingServerProjectDialog,
} from "./AgentProjectSourceDialog";
import { AgentLocalCloneDialog } from "./AgentLocalCloneDialog";
import { AgentCloneComposer } from "./AgentCloneComposer";
import { AgentRemoteDraftProjectChooser } from "./AgentRemoteDraftProjectChooser";
import { AgentUnconfirmedMessageNotice } from "./AgentUnconfirmedMessageNotice";
import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { useRemoteSurfaceContext } from "./useRemoteSurfaceContext";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import { AgentThreadQuestions } from "./AgentThreadQuestions";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSurfaceEnterClass } from "../workbenchFrameBootContext";
import { PanelLeftOpen } from "lucide-react";
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
import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import type { TextClipboardGateway } from "../../domain/textClipboard";
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
import { AgentPanelLayoutControls } from "./AgentPanelLayoutControls";
import { AgentRailResizeHandle } from "./AgentRailResizeHandle";
import { AgentSurfaceHost } from "./AgentSurfaceHost";
import { AgentAddProjectDialog } from "./AgentAddProjectDialog";
import { AgentRemoteAddProjectDialog } from "./remoteAddProject/AgentRemoteAddProjectDialog";
import { remoteAddProjectCloneActive } from "./remoteAddProject/remoteAddProjectPresentation";
import { AgentNoticeBar } from "./AgentNoticeBar";
import { AgentThreadFindBar } from "./AgentThreadFindBar";
import { AgentThreadHeader } from "./AgentThreadHeader";
import { AgentTerminalSessionsPalette } from "./AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "./AgentThreadSearchPalette";
import { AgentThreadSession } from "./AgentThreadSession";
import { usePreloadAgentMarkdownRenderer } from "./useAgentMarkdown";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { AgentClockProvider } from "./agentClock";
import { agentProjectGroups } from "./agentModePresentation";
import {
  agentProjectTerminalSessionsTarget,
  type AgentRailScope,
} from "./agentSidebarPresentation";
import { agentSurfaceScopeFor, agentThreadCheckoutRoot } from "./agentSurfacePolicy";
import { useScopedAgentNotice } from "./useScopedAgentNotice";
import { useAgentSessionImport } from "./useAgentSessionImport";
import {
  useAgentComposerControllerState,
  type AgentComposerPromptRestore,
} from "./useAgentComposerState";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadNavigation, type AgentNavigationSession } from "./useAgentThreadNavigation";
import { useAgentViewCommands } from "./useAgentViewCommands";
import { useWorkbenchFrameResponsiveRestore } from "../useWorkbenchFrameResponsiveRestore";
import {
  useAgentLatestCallback,
  useAgentSurfacePresentationView,
  useAgentThreadScriptPresentation,
  useAgentThreadPresentationViews,
} from "./useAgentThreadPresentationViews";

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
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly nowTickMs?: number;
  readonly viewCommands?: AgentViewCommandBridge | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly textClipboard?: TextClipboardGateway | null;
  onOpenSourceControl?(): void;
  onOpenEnvironmentSettings?(): void;
  onTrustProject(projectRootKey: string): void;
  onCloseProject?(rootPath: string): void;
  onReleaseProject(projectRootKey: string): void;
}

const DEFAULT_NOW_TICK_MS = 30_000;
const IDLE_ACCOUNT_USAGE = {
  claudeCode: { kind: "idle" },
  codex: { kind: "idle" },
} as const;
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
  onCloseProject = NOOP_CLOSE_PROJECT,
  onReleaseProject,
  onTrustProject,
  overflowRootPaths,
  providerEnabled,
  projects,
  questionGateway = null,
  artifactLoader = null,
  artifactPreview = null,
  textClipboard = null,
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
  const [commitMenuOpenSignal, setCommitMenuOpenSignal] = useState(0);
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
  const navigation = useAgentThreadNavigation({
    agents,
    evidenceOf: turnEvidenceOf,
    externalSessions,
    groups,
    presentationThreads,
    projects,
    session: navigationSession,
    authoritativeRemoteProjectKeys,
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
        : (owner.ownerId === selectedProject.ownerId ||
            selectedProject.runtimeOwnerIds?.includes(owner.ownerId) === true) &&
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
  const [promptRestore, setPromptRestore] = useState<AgentComposerPromptRestore | null>(null);
  const takeQueued = useAgentLatestCallback(agents.takeDeferredFollowUp);
  const editQueued = useCallback(
    (threadId: string, id: string): void => {
      const taken = takeQueued(threadId, id);
      if (taken === null) return;
      setPromptRestore((current) => ({
        token: (current?.token ?? 0) + 1,
        draftKey: threadId,
        text: taken.prompt,
      }));
    },
    [takeQueued],
  );
  const composer = useAgentComposerControllerState({
    agents,
    groups: executionGroups,
    promptRestore,
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
  const [recordedDiff, setRecordedDiff] = useState<AgentRecordedTurnSelection | null>(null);
  const selectedRecordedThreadId = sessionThread?.thread.threadId ?? null;
  const recordedRevision =
    selectedRecordedThreadId === null
      ? undefined
      : (agents.getTurnChangesRevision?.(selectedRecordedThreadId) ?? agents.turnChangesRevision);
  const visibleRecordedDiff = useMemo(() => {
    if (!recordedDiff || recordedDiff.threadId !== selectedRecordedThreadId) return null;
    if (recordedDiff.revision === recordedRevision) return recordedDiff;
    return {
      ...recordedDiff,
      summary: {
        turnId: recordedDiff.summary.turnId,
        state: "unavailable" as const,
        files: [],
        truncated: false,
        reason:
          "Recorded changes are unavailable after the project connection changed. Reopen the turn to retry.",
      },
    };
  }, [recordedDiff, recordedRevision, selectedRecordedThreadId]);
  useEffect(() => {
    setRecordedDiff(null);
  }, [selectedRecordedThreadId]);
  const openRecordedDiff = useAgentLatestCallback(
    (threadId: string, summary: AgentTurnChangeSummary, relativePath?: string) => {
      if (threadId !== selectedRecordedThreadId || !agents.getTurnFileDiff) return;
      setRecordedDiff({
        threadId,
        summary,
        relativePath,
        revision: recordedRevision,
        getTurnFileDiff: agents.getTurnFileDiff,
      });
      openSurface("diff");
    },
  );
  const showChanges = agents.showChanges;
  const trustProject = useAgentLatestCallback(onTrustProject);
  const releaseProject = useAgentLatestCallback(onReleaseProject);
  const reviewInDiff = useCallback(
    (threadId: string) => {
      setRecordedDiff(null);
      void showChanges(threadId);
      openSurface("diff");
    },
    [openSurface, showChanges],
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
  const threadBulkCommand = useAgentLatestCallback(menu.handleThreadBulkCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  const changeProjectScope = useAgentLatestCallback((scope: AgentRailScope) => {
    chrome.addProject?.cancelSelection?.();
    setProjectSelectionIntent((current) => current + 1);
    if (!navigation.setProjectScope(scope.projectRootKey)) return;
    if (
      !groups.some(
        (group) =>
          group.projectRootKey === scope.projectRootKey &&
          group.memberProjectRootKeys !== undefined,
      )
    )
      onSelectProjectEnvironment(scope.projectRootKey);
    composer.clearDraftTarget();
  });
  const newProjectThread = useAgentLatestCallback(() => {
    chrome.addProject?.cancelSelection?.();
    setProjectSelectionIntent((current) => current + 1);
    const target = navigation.newThreadTarget();
    if (target === null) return;
    if (
      !groups.some(
        (group) =>
          group.projectRootKey === target.projectRootKey &&
          group.memberProjectRootKeys !== undefined,
      )
    )
      onSelectProjectEnvironment(target.projectRootKey);
    composer.clearSelection();
  });
  const activateSurface = useAgentLatestCallback(surface.activateSurface);
  const closeSurfaceTab = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") setRecordedDiff(null);
    surface.closeSurfaceTab(kind);
  });
  const closeRecordedDiff = useCallback(() => {
    setRecordedDiff(null);
    closeSurfaceTab("diff");
  }, [closeSurfaceTab]);
  const openSurfaceCommand = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") setRecordedDiff(null);
    openSurface(kind);
  });
  const toggleRightPanelCommand = useAgentLatestCallback(toggleRightPanel);
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
  const commandHandlers = useMemo<AgentViewCommandHandlers>(
    () => ({
      ...navigationCommands,
      newThread: newProjectThread,
      runPreferredScript: () => {
        if (scripts.preferred === null) return;
        scripts.runScript(scripts.preferred.key);
      },
      openCommitMenu: () => {
        if (selectedThreadId === null) return;
        setCommitMenuOpenSignal((current) => current + 1);
      },
      goToTurn: () => {
        if (selectedThreadId === null) return;
        setGoToTurnSignal((current) => current + 1);
      },
      surfaceBlocked,
    }),
    [navigationCommands, scripts, selectedThreadId, newProjectThread, surfaceBlocked],
  );
  useAgentViewCommands(viewCommands, commandHandlers);

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
  const openRemoteAddProject = useAgentLatestCallback(creation.open);
  const cancelPendingClone = useAgentLatestCallback(creation.cancel);
  const dismissPendingClone = useAgentLatestCallback(creation.dismiss);
  const openAddProject = useAgentLatestCallback(creation.open);
  const openPendingClone = useAgentLatestCallback(creation.showPending);
  const remoteAddCloneRunning =
    remoteAdd.pendingClone !== null && remoteAddProjectCloneActive(remoteAdd.pendingClone.status);

  const headerFallback = useMemo(
    () =>
      composerTargetProjectRootKey === null || composerTargetRepositoryRoot === null
        ? null
        : {
            projectRootKey: composerTargetProjectRootKey,
            repositoryRoot: composerTargetRepositoryRoot,
          },
    [composerTargetProjectRootKey, composerTargetRepositoryRoot],
  );
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
  const responsivePanelRestore = useWorkbenchFrameResponsiveRestore();
  const toggleResponsivePanel = useCallback(() => {
    switch (responsivePanelRestore) {
      case "none":
        toggleMaximized();
        return;
      case "collapseRail":
        if (layout.rightPanelMaximized) toggleMaximized();
        toggleRail();
        return;
      case "closePanel":
        if (layout.rightPanelMaximized) toggleMaximized();
        toggleRightPanel();
        return;
      default:
        responsivePanelRestore satisfies never;
    }
  }, [
    layout.rightPanelMaximized,
    responsivePanelRestore,
    toggleMaximized,
    toggleRail,
    toggleRightPanel,
  ]);
  const layoutControls = useMemo(
    () => (
      <AgentPanelLayoutControls
        bottomPanelOpen={chrome.bottomPanelVisible}
        maximize={{
          maximized: layout.rightPanelMaximized || responsivePanelRestore !== "none",
          onToggle: toggleResponsivePanel,
        }}
        onToggleBottomPanel={chrome.onToggleBottomPanel}
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen
        shortcuts={chrome.shortcuts}
      />
    ),
    [
      chrome.bottomPanelVisible,
      chrome.onToggleBottomPanel,
      chrome.shortcuts,
      layout.rightPanelMaximized,
      responsivePanelRestore,
      toggleResponsivePanel,
      toggleRightPanel,
    ],
  );
  const surfaceAgents = useMemo(
    () => ({
      showChanges: agents.showChanges,
      showFileDiff: agents.showFileDiff,
      hideFileDiff: agents.hideFileDiff,
      openChangedFile: agents.openChangedFile,
      openChangedFileDiff: agents.openChangedFileDiff,
    }),
    [
      agents.hideFileDiff,
      agents.openChangedFile,
      agents.openChangedFileDiff,
      agents.showChanges,
      agents.showFileDiff,
    ],
  );
  return (
    <>
      <section
        aria-label="Agent mode"
        className={["agent-mode", surfaceEnterClass].filter(Boolean).join(" ")}
        data-slot="agent"
      >
        <AgentClockProvider nowTickMs={nowTickMs}>
          <div className="agent-mode__grid">
            {layout.rail === "collapsed" ? (
              <div className="agent-rail__chrome" data-tauri-drag-region="">
                <button
                  aria-expanded="false"
                  aria-label="Expand sidebar"
                  className="agent-iconbutton"
                  onClick={toggleRail}
                  title="Expand sidebar"
                  type="button"
                >
                  <PanelLeftOpen aria-hidden="true" size={16} />
                </button>
              </div>
            ) : (
              <AgentThreadsSidebar
                catalog={agents.catalog}
                addProjectAvailable={chrome.addProject !== null}
                accountUsage={agents.accountUsage ?? IDLE_ACCOUNT_USAGE}
                evidenceOf={turnEvidenceOf}
                groups={groups}
                onAddProject={openAddProject}
                onCancelPendingClone={cancelPendingClone}
                onDismissPendingClone={dismissPendingClone}
                pendingClones={creation.pendingClones}
                onOpenPendingClone={openPendingClone}
                onChangeScope={changeProjectScope}
                onCollapseSidebar={toggleRail}
                onNewThread={newProjectThread}
                onOpenProviderSettings={agents.configureAgentCli}
                onOpenSourceControl={onOpenSourceControl}
                onProjectCommand={projectMenuCommand}
                onReleaseProject={releaseProject}
                onSelectThread={navigation.selectThread}
                onThreadBulkCommand={threadBulkCommand}
                onThreadMenuCommand={threadMenuCommand}
                onTogglePin={togglePin}
                onTrustProject={trustProject}
                overflowRootPaths={overflowRootPaths}
                providerEnabled={effectiveProviderEnabled}
                providerManagement={agents.providerManagement}
                scope={railScope}
                scopeEntries={navigation.scopeEntries}
                search={navigation.search}
                selectedThreadId={selectedThread?.thread.threadId ?? null}
                turnLog={agents.turnLog ?? null}
              />
            )}
            {layout.rail === "expanded" && (
              <AgentRailResizeHandle
                onReset={surface.resetRailWidth}
                onResize={surface.resizeRail}
                width={layout.railWidth}
              />
            )}

            <div className="agent-mode__center" ref={navigation.centerRef}>
              <AgentThreadHeader
                bottomPanelOpen={chrome.bottomPanelVisible}
                commitMenuOpenSignal={commitMenuOpenSignal}
                layout={layout}
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
                shipActions={shipActions}
                shortcuts={chrome.shortcuts}
                thread={selectedThread}
              />
              {creation.visible && creation.pending !== null && creation.pendingClone !== null ? (
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
                    sessionThread === null || sessionThread.execution?.kind === "remote"
                      ? undefined
                      : editQueued
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
                  onOpenTurnDiff={openRecordedDiff}
                  turnChangesRevision={
                    sessionThread
                      ? (agents.getTurnChangesRevision?.(sessionThread.thread.threadId) ??
                        agents.turnChangesRevision)
                      : agents.turnChangesRevision
                  }
                  getTurnChanges={agents.getTurnChanges}
                  getTurnFileDiff={agents.getTurnFileDiff}
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
              {notice && (
                <div className="agent-thread-notice">
                  <AgentNoticeBar
                    notice={notice}
                    onConfigure={() => agents.configureAgentCli()}
                    onDismiss={dismissNotice}
                  />
                </div>
              )}
              {!creation.visible && (
                <>
                  <AgentThreadQuestions gateway={questionGateway} thread={sessionThread} />
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
                  />
                </>
              )}
            </div>
          </div>
        </AgentClockProvider>
        {creation.entryOpen && (
          <AgentProjectSourceDialog
            selectedServerId={selectedServerId}
            servers={remoteContext?.servers ?? NO_REMOTE_SERVERS}
            localCloneAvailable={chrome.addProject?.cloneGateway != null}
            cloneBlocked={creation.pendingClones.length >= 4}
            onClose={creation.closeEntry}
            onChoose={creation.choose}
          />
        )}
        {creation.existingServerProjects !== null && (
          <AgentExistingServerProjectDialog
            projects={creation.existingServerProjects}
            onClose={creation.closeExisting}
            onSelect={creation.selectExisting}
          />
        )}
        {creation.localDialogOpen && chrome.addProject !== null && (
          <AgentLocalCloneDialog
            gateway={chrome.addProject.gateway}
            lookupGateway={remoteContext?.repositoryLookup ?? null}
            onClose={creation.closeLocal}
            onClone={creation.local.start}
            busy={creation.local.busy}
            error={creation.local.error}
          />
        )}
        <AgentRemoteAddProjectDialog controller={remoteAdd} onClose={remoteAdd.close} />
        {addProject.open && chrome.addProject !== null && (
          <AgentAddProjectDialog
            gateway={chrome.addProject.gateway}
            onAdd={addProject.addProject}
            onClose={addProject.closeDialog}
            onNotice={addProject.reportNotice}
            onOpenExisting={addProject.addProject}
            projectRootPaths={addProject.projectRootPaths}
          />
        )}
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
          agents={surfaceAgents}
          recordedDiff={visibleRecordedDiff}
          onCloseRecordedDiff={closeRecordedDiff}
          remoteDraft={surfaceThread === null && selectedServerId !== null}
          remoteSurface={remoteSurface}
          chooserAutoFocus={surface.chooserRequested}
          chrome={chrome}
          hidden={surface.surfaceHost.hidden}
          layout={layout}
          layoutControls={layoutControls}
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
    </>
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
