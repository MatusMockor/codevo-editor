import type { RemoteAddProjectSession } from "../../application/useRemoteAddProject";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { BrowserAgentThreadBranchMemory } from "../../infrastructure/browserAgentThreadBranchMemory";
import { BrowserAgentRailProjectCollapsePreference } from "../../infrastructure/browserAgentRailProjectCollapsePreference";
import type { AgentRailProjectCollapsePreferencePort } from "../../application/agentRailProjectCollapsePreferencePort";
import { BrowserAgentRailProjectFocusPreference } from "../../infrastructure/browserAgentRailProjectFocusPreference";
import type { AgentRailProjectFocusPreferencePort } from "../../application/agentRailProjectFocusPreferencePort";
import {
  commandPaletteNewThreadPicker,
  type AgentNewThreadPicker,
} from "../../application/agentNewThreadPicker";
import { workbenchCommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import { agentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import type { AgentProjectCreationSession } from "./agentProjectCreationSession";
import type { LocalProjectCloneSession } from "../../application/useLocalProjectClone";
import type { LocalProjectCloneGateway } from "../../application/ports/localProjectCloneGateway";
import { TauriLocalProjectCloneGateway } from "../../infrastructure/tauriLocalProjectCloneGateway";
import { TauriAgentQuestionGateway } from "../../infrastructure/tauriAgentQuestionGateway";
import { TauriAgentArtifactGateway } from "../../infrastructure/tauriAgentArtifactGateway";
import { TauriAgentArtifactPreviewGateway } from "../../infrastructure/tauriAgentArtifactPreviewGateway";
import { TauriAgentArtifactFileGateway } from "../../infrastructure/tauriAgentArtifactFileGateway";
import { TauriRemotePortPreviewGateway } from "../../infrastructure/tauriRemotePortPreviewGateway";
import { agentRemotePortOwner } from "./useAgentServerPorts";
import { reportAgentArtifactFailure } from "../../infrastructure/agentArtifactFailureReporter";
import {
  createAgentArtifactFilePort,
  AGENT_ARTIFACT_OPEN_FAILED,
} from "../../application/createAgentArtifactFilePort";
import { AgentArtifactSupportProvider, type AgentArtifactSupport } from "./agentArtifactSupport";
import { useAgentWorkspaceNavigationBoundary } from "./useAgentWorkspaceNavigationBoundary";
import {
  useAgentWorkbenchProjectOpening,
  type AgentPendingProjectOpen,
} from "./useAgentWorkbenchProjectOpening";
import { useAgentCloneDestinationPreference } from "./useAgentCloneDestinationPreference";
import { resolveTauriWorkspaceHome } from "../../infrastructure/tauriHomeDirectory";
import { recentFolderEntries } from "../../domain/recentFolders";
import {
  UNAVAILABLE_AGENT_FILE_SEARCH,
  createDefaultAgentRightPanelGateways,
  type AgentRightPanelGateways,
} from "./rightPanel/agentRightPanelGateways";
import { useAgentRightPanelChrome } from "./rightPanel/useAgentRightPanelChrome";
import { AgentTranscriptPositionProvider } from "./AgentTranscriptPositionContext";
import {
  browserAgentSessionRestorePorts,
  useAgentSessionRestore,
  type AgentSessionRestorePorts,
} from "./useAgentSessionRestore";
import {
  useAgentProjectWorkspaceSync,
  type AgentProjectWorkspaceTarget,
} from "./useAgentProjectWorkspaceSync";
import { useAgentCheckoutDirtyRevision } from "../../application/useAgentCheckoutDirtyRevision";
import { getEditorDocumentDirtySnapshot } from "../../application/editorSessionDirtyProjection";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import { runningTurn } from "../../domain/agentThread";
import type { ComposerBranchGateway } from "../../application/useComposerBranchPicker";
import { agentBranchCheckoutGuardReason } from "../../application/agentBranchCheckoutGuard";
import type { AgentGitHistoryGateway } from "../../application/useAgentGitHistory";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { workbenchAgentViewCommandBridge } from "../../application/agentViewCommandBridge";
import type { AgentThreadNotificationCenterPorts } from "../../application/agentThreadNotificationCenter";
import { useAgentThreadNotificationCenter } from "../../application/useAgentThreadNotificationCenter";
import { createDocumentAppFocusPort } from "../../infrastructure/documentAppFocusPort";
import { TauriAgentAttentionGateway } from "../../infrastructure/tauriAgentAttentionGateway";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentSurfaceFileTreeDependencies } from "../../application/useAgentSurfaceFileTree";
import {
  agentScriptRunnerOutcome,
  type AgentThreadScriptRunner,
} from "../../application/useAgentThreadScripts";
import type {
  AgentProviderManagementSurface,
  SelectedAgentProviderAuthority,
} from "../../application/useAgentProviderManagement";
import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import type { useWorkbenchController } from "../../application/useWorkbenchController";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { normalizeAgentModelFavoriteKeys } from "../../domain/agentSettings";
import {
  defaultAgentProviderPreferences,
  type PersistedAgentProviderSettingsAuthority,
} from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import type { GitChangeStatus } from "../../domain/git";
import { shortcutForCommand, type KeymapSettings } from "../../domain/keymap";
import type { MonacoAppTheme, TerminalTheme } from "../../domain/settings";
import type { TerminalGateway } from "../../domain/terminal";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { FileSearchGateway } from "../../domain/workspace";
import { WebviewAgentImageSurface } from "../../infrastructure/webviewAgentImageSurface";
import { BrowserTextClipboardGateway } from "../../infrastructure/browserTextClipboardGateway";
import { TauriDirectoryListingGateway } from "../../infrastructure/tauriDirectoryListingGateway";
import {
  TauriRevealPathGateway,
  type RevealPathGateway,
} from "../../infrastructure/tauriRevealPathGateway";
import { AgentModeView } from "./AgentModeView";
import {
  AGENT_REVEAL_BLOCKED_REASON,
  agentRevealRootForPath,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";
import {
  agentTerminalPanelIntent,
  initialAgentTerminalPanelIntentState,
  type AgentScriptsChrome,
  type AgentWorkbenchChrome,
  type AgentWorkbenchThreadActivityChrome,
} from "./agentWorkbenchChrome";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";
import { openThenRevealFiles } from "./openThenRevealFiles";
import { openOrClassifyLinkedFile } from "../../application/agentLinkedFileProbe";
import { revealingFileOpeners } from "../editorPanel/revealingFileOpeners";
import { useEditorSurfaceReveal } from "../editorPanel/useEditorSurfaceReveal";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type AgentWorkbenchScreenWorkbench = Pick<
  Workbench,
  | "activePath"
  | "agentModeActive"
  | "agentWorkbench"
  | "appSettings"
  | "bottomPanelView"
  | "bottomPanelVisible"
  | "closeWorkspaceTab"
  | "hideBottomPanel"
  | "nodePackageScripts"
  | "openPinnedFile"
  | "openProblemNotice"
  | "openWorkspaceRootWithReceipt"
  | "settingsOpen"
  | "previewFile"
  | "runCommand"
  | "saveWorkbenchSettings"
  | "showBottomPanelView"
  | "workspaceIdentityDescriptor"
  | "workspaceRoot"
  | "workspaceSettings"
  | "workspaceTrust"
> &
  Partial<
    Pick<
      Workbench,
      | "openDocuments"
      | "activateWorkspaceTab"
      | "openSettingsSection"
      | "gitStatus"
      | "gitRepositoryStatuses"
      | "gitLoading"
      | "gitStatusLoaded"
      | "gitDiffPreview"
      | "gitDiffLoading"
      | "refreshGitStatus"
      | "previewGitChange"
      | "openGitChange"
      | "closeGitDiffPreview"
      | "agentWorktreeFileSync"
      | "resolveDocumentSessionDirtyProjection"
      | "documentSessionAuthorityRevision"
      | "setStatusBarItemVisibility"
      | "vscodeProcessTasks"
    >
  > & {
    readonly agents: WorkbenchAgentsSurface;
  };

export interface AgentWorkbenchScreenProps {
  readonly workbench: AgentWorkbenchScreenWorkbench;
  readonly activeFileRevealSignal: number;
  readonly fileStatusesByPath: Record<string, GitChangeStatus>;
  readonly files: AgentSurfaceFileTreeDependencies["files"];
  readonly fileChanges: AgentSurfaceFileTreeDependencies["fileChanges"];
  readonly terminalGateway: TerminalGateway;
  readonly gitHistoryGateway?: AgentGitHistoryGateway | null;
  readonly gitBranchGateway?: ComposerBranchGateway | null;
  readonly worktreeFileChanges?: WorkspaceFileChangeGateway | null;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly projectCollapsePreference?: AgentRailProjectCollapsePreferencePort | null;
  readonly projectFocusPreference?: AgentRailProjectFocusPreferencePort | null;
  readonly sessionRestore?: AgentSessionRestorePorts;
  readonly newThreadPicker?: AgentNewThreadPicker | null;
  readonly revealPathGateway?: RevealPathGateway;
  readonly directoryListingGateway?: DirectoryListingGateway;
  readonly localCloneGateway?: LocalProjectCloneGateway | null;
  readonly rightPanelGateways?: AgentRightPanelGateways;
  readonly fileSearch?: FileSearchGateway;
  onTrustWorkspace(): void;
  onResizeRightPanelStart(event: PointerEvent<HTMLDivElement>): void;
}

export { ADD_PROJECT_REFUSED_REASON } from "./useAgentWorkbenchProjectOpening";
export const SEARCH_FILES_COMMAND = "file.quickOpen";
const DEFAULT_REVEAL_PATH_GATEWAY: RevealPathGateway = new TauriRevealPathGateway();
const DEFAULT_DIRECTORY_LISTING_GATEWAY: DirectoryListingGateway =
  new TauriDirectoryListingGateway();
const DEFAULT_LOCAL_CLONE_GATEWAY = new TauriLocalProjectCloneGateway();
const DEFAULT_TEXT_CLIPBOARD = new BrowserTextClipboardGateway();
const DEFAULT_QUESTION_GATEWAY = new TauriAgentQuestionGateway();
const DEFAULT_ARTIFACT_LOADER = new TauriAgentArtifactGateway();
const DEFAULT_ARTIFACT_PREVIEW = new TauriAgentArtifactPreviewGateway();
const DEFAULT_ARTIFACT_FILE_LOCATOR = new TauriAgentArtifactFileGateway();
const DEFAULT_IMAGE_SURFACE = new WebviewAgentImageSurface();
const DEFAULT_REMOTE_PORT_PREVIEW = new TauriRemotePortPreviewGateway();
const DEFAULT_THREAD_BRANCH_MEMORY = new BrowserAgentThreadBranchMemory();
const DEFAULT_PROJECT_COLLAPSE_PREFERENCE = new BrowserAgentRailProjectCollapsePreference();
const DEFAULT_PROJECT_FOCUS_PREFERENCE = new BrowserAgentRailProjectFocusPreference();
const DEFAULT_SESSION_RESTORE = browserAgentSessionRestorePorts();
const defaultThreadNotificationPorts = (): AgentThreadNotificationCenterPorts => ({
  focus: createDocumentAppFocusPort(),
  system: new TauriAgentAttentionGateway(),
});
const SHOW_COMMAND_PALETTE = "commands.show";
interface PersistedProviderProjection {
  readonly authorities: Readonly<
    Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>
  >;
  readonly enabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly selectedAuthority: SelectedAgentProviderAuthority | null;
  readonly selectedProvider: AgentCliKind;
}

export function AgentWorkbenchScreen({
  activeFileRevealSignal,
  directoryListingGateway = DEFAULT_DIRECTORY_LISTING_GATEWAY,
  localCloneGateway = DEFAULT_LOCAL_CLONE_GATEWAY,
  fileChanges,
  fileStatusesByPath,
  files,
  gitHistoryGateway = null,
  gitBranchGateway = null,
  worktreeFileChanges = null,
  monacoTheme,
  onResizeRightPanelStart,
  onTrustWorkspace,
  revealPathGateway = DEFAULT_REVEAL_PATH_GATEWAY,
  rightPanelGateways: injectedRightPanelGateways,
  fileSearch = UNAVAILABLE_AGENT_FILE_SEARCH,
  terminalGateway,
  terminalTheme,
  textClipboard = DEFAULT_TEXT_CLIPBOARD,
  projectCollapsePreference = DEFAULT_PROJECT_COLLAPSE_PREFERENCE,
  projectFocusPreference = DEFAULT_PROJECT_FOCUS_PREFERENCE,
  sessionRestore = DEFAULT_SESSION_RESTORE,
  newThreadPicker: injectedNewThreadPicker,
  workbench,
}: AgentWorkbenchScreenProps) {
  const restoredSession = useAgentSessionRestore(sessionRestore);
  const threadNotifications = useAgentThreadNotificationCenter(
    {
      enabled: workbench.appSettings.agentThreadNotifications !== false,
      toastsVisible: workbench.settingsOpen !== true,
      threadViewVisible: workbench.settingsOpen !== true && workbench.agentModeActive !== false,
    },
    defaultThreadNotificationPorts,
  );
  const { navigationSession } = restoredSession;
  const addProjectPending = useRef<AgentPendingProjectOpen | null>(null);
  const workspaceTrusted = !!workbench.workspaceTrust?.trusted;
  const projects = workbench.agents.agentProjects;
  const { agentWorkbench, appSettings, nodePackageScripts, workspaceRoot } = workbench;
  const providerPreferences =
    appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const optimisticProviderEnabled = useMemo(
    () => ({
      claudeCode: providerPreferences.claudeCode.enabled,
      codex: providerPreferences.codex.enabled,
    }),
    [providerPreferences.claudeCode.enabled, providerPreferences.codex.enabled],
  );
  const persistedProviderProjection = usePersistedProviderProjection(
    workbench.agents.providerManagement,
    optimisticProviderEnabled,
    appSettings.agentCliKind,
  );
  const providerEnabled = persistedProviderProjection.enabled;
  const agents = useMemo<WorkbenchAgentsSurface>(
    () => ({
      ...workbench.agents,
      agentCliKind: persistedProviderProjection.selectedProvider,
    }),
    [persistedProviderProjection.selectedProvider, workbench.agents],
  );
  const { openPinnedFile, openProblemNotice, previewFile } = workbench;
  const { openWorkspaceRootWithReceipt } = workbench;
  const { openSettingsSection } = workbench;
  const openEnvironmentSettings = useCallback(() => {
    openSettingsSection?.("environments");
  }, [openSettingsSection]);
  const activateWorkbenchTab = workbench.activateWorkspaceTab;
  const latestWorkspaceRoot = useRef(workspaceRoot);
  latestWorkspaceRoot.current = workspaceRoot;
  const activateWorkspaceTab = useMemo(
    () =>
      activateWorkbenchTab === undefined
        ? undefined
        : async (rootPath: string) => {
            try {
              await activateWorkbenchTab(rootPath);
            } catch {
              return false;
            }
            return workspaceRootKeysEqual(latestWorkspaceRoot.current, rootPath);
          },
    [activateWorkbenchTab],
  );
  const openUsageSettings = useCallback(() => {
    openSettingsSection?.("usage");
  }, [openSettingsSection]);
  const activateProjectWorkspace = useCallback(
    async (rootPath: string) => {
      const { outcome, isCurrent } = await openWorkspaceRootWithReceipt(rootPath);
      return outcome.kind === "opened" && isCurrent();
    },
    [openWorkspaceRootWithReceipt],
  );
  const projectWorkspaceSync = useAgentProjectWorkspaceSync({
    workspaceRoot,
    activate: activateProjectWorkspace,
  });
  const navigationBoundary = useAgentWorkspaceNavigationBoundary(
    workspaceRoot,
    projects.projects,
    projectWorkspaceSync.state,
    addProjectPending.current?.rootPath ?? null,
    navigationSession,
  );
  if (navigationBoundary.cancelPendingAdd) addProjectPending.current = null;
  const pendingExternalRoot = useRef(navigationBoundary.pendingExternalRoot);
  pendingExternalRoot.current = navigationBoundary.pendingExternalRoot;
  const selectWorkspace = projectWorkspaceSync.select;
  const selectProjectWorkspace = useCallback(
    (target: AgentProjectWorkspaceTarget | null) => {
      if (addProjectPending.current !== null || pendingExternalRoot.current !== null) return;
      selectWorkspace(target);
    },
    [selectWorkspace],
  );
  const workspaceActivation = useMemo(
    () => ({ ...projectWorkspaceSync, select: selectProjectWorkspace }),
    [projectWorkspaceSync, selectProjectWorkspace],
  );
  const searchFilesShortcut = useMemo(
    () => shortcutForCommand(appSettings.keymap, SEARCH_FILES_COMMAND),
    [appSettings.keymap],
  );
  const { saveWorkbenchSettings } = workbench;
  const { bottomPanelView, bottomPanelVisible, hideBottomPanel, showBottomPanelView } = workbench;
  const workspaceId = workbench.workspaceIdentityDescriptor?.workspaceId ?? null;
  const admissionToken = workbench.workspaceIdentityDescriptor?.admissionToken ?? null;
  const remotePortPreview = useMemo(
    () => ({
      port: DEFAULT_REMOTE_PORT_PREVIEW,
      owner: agentRemotePortOwner(workspaceId, admissionToken),
    }),
    [admissionToken, workspaceId],
  );
  const appSettingsRef = useRef(appSettings);
  const workspaceSettingsRef = useRef(workbench.workspaceSettings);
  const workspaceTrustRef = useRef(workbench.workspaceTrust);
  const activeWorkspaceRootRef = useRef(workspaceRoot);
  activeWorkspaceRootRef.current = workspaceRoot;
  appSettingsRef.current = appSettings;
  workspaceSettingsRef.current = workbench.workspaceSettings;
  workspaceTrustRef.current = workbench.workspaceTrust;
  const saveAgentModelFavorites = useCallback(
    async (keys: ReadonlyArray<string>, revision: number): Promise<void> => {
      const agentModelFavoriteKeys = normalizeAgentModelFavoriteKeys(keys);
      await saveWorkbenchSettings(
        {
          ...appSettingsRef.current,
          agentModelFavoriteKeys,
          agentModelFavoritesRevision: revision,
        },
        workspaceSettingsRef.current,
        workspaceTrustRef.current?.trusted ?? null,
        "reportAndReject",
      );
    },
    [saveWorkbenchSettings],
  );
  const modelFavoritesPersistence = useMemo<AgentModelFavoritesPersistence>(
    () => ({
      keys: appSettings.agentModelFavoriteKeys,
      revision: appSettings.agentModelFavoritesRevision,
      save: saveAgentModelFavorites,
    }),
    [
      appSettings.agentModelFavoriteKeys,
      appSettings.agentModelFavoritesRevision,
      saveAgentModelFavorites,
    ],
  );

  const scripts = useMemo<AgentThreadScriptRunner>(
    () => ({
      scripts: nodePackageScripts.scripts,
      truncated: nodePackageScripts.truncated,
      available: nodePackageScripts.available,
      unavailableReason: nodePackageScripts.error,
      active: nodePackageScripts.pending ? nodePackageScripts.task : null,
      lastOutcome: agentScriptRunnerOutcome(nodePackageScripts.task),
      run: (script, target, repositoryRoot) =>
        nodePackageScripts.run(script, target, repositoryRoot),
      stop: () => nodePackageScripts.stop(),
    }),
    [nodePackageScripts],
  );

  const { dispatch: dispatchAgentWorkbench } = agentWorkbench;
  const revealEditorSurface = useEditorSurfaceReveal(dispatchAgentWorkbench);
  const treeFileOpeners = useMemo(
    () => revealingFileOpeners({ openPinnedFile, previewFile }, revealEditorSurface),
    [openPinnedFile, previewFile, revealEditorSurface],
  );

  const openScriptsView = useCallback(() => {
    agentWorkbench.dispatch({ kind: "openSurface", surface: "scripts" });
  }, [agentWorkbench]);

  const openSourceControl = useCallback(() => {
    agentWorkbench.dispatch({ kind: "openSurface", surface: "git" });
  }, [agentWorkbench]);

  const showTerminalPanel = useCallback(() => {
    showBottomPanelView("terminal");
  }, [showBottomPanelView]);

  const vscodeProcessTasks = workbench.vscodeProcessTasks ?? null;
  const scriptsSurface = useMemo<AgentScriptsChrome>(
    () => ({
      vscodeProcessTasks,
      openScriptTerminal: showTerminalPanel,
      refreshScripts: () => void nodePackageScripts.refresh(),
    }),
    [nodePackageScripts, showTerminalPanel, vscodeProcessTasks],
  );

  const onToggleBottomPanel = useCallback(() => {
    if (bottomPanelVisible) {
      hideBottomPanel();
      return;
    }
    showTerminalPanel();
  }, [bottomPanelVisible, hideBottomPanel, showTerminalPanel]);

  const intentRef = useRef(initialAgentTerminalPanelIntentState);
  const { persistedBottomPanel } = agentWorkbench;
  const agentLayoutActive = agentWorkbench.effectiveLayout === "agent";
  useEffect(() => {
    const result = agentTerminalPanelIntent(intentRef.current, {
      owner: workspaceRoot,
      active: agentLayoutActive,
      visible: bottomPanelVisible,
      view: bottomPanelView,
      persisted: persistedBottomPanel,
    });
    intentRef.current = result.state;
    if (!result.showTerminal) return;
    showBottomPanelView("terminal");
  }, [
    agentLayoutActive,
    bottomPanelView,
    bottomPanelVisible,
    persistedBottomPanel,
    showBottomPanelView,
    workspaceRoot,
  ]);

  const revealRoots = useMemo(
    () => [...projects.projects.map((project) => project.rootPath), workspaceRoot ?? ""],
    [projects.projects, workspaceRoot],
  );
  const revealPath = useCallback(
    async (path: string): Promise<void> => {
      const rootPath = agentRevealRootForPath(path, revealRoots);
      if (rootPath === null) throw new Error(AGENT_REVEAL_BLOCKED_REASON);
      await revealPathGateway.revealPath({ rootPath, path });
    },
    [revealPathGateway, revealRoots],
  );

  const artifactSupport = useMemo<AgentArtifactSupport>(
    () => ({
      files: createAgentArtifactFilePort(
        DEFAULT_ARTIFACT_FILE_LOCATOR,
        {
          openFile: async (location, shouldCommit) => {
            const opened = await openThenRevealFiles(
              () =>
                openPinnedFile(
                  {
                    kind: "file",
                    name: location.filePath.slice(location.filePath.lastIndexOf("/") + 1),
                    path: location.filePath,
                  },
                  shouldCommit,
                ),
              revealEditorSurface,
            );
            if (!opened) throw new Error(AGENT_ARTIFACT_OPEN_FAILED);
          },
        },
        { activeWorkspaceRoot: () => activeWorkspaceRootRef.current },
      ),
      reportError: reportAgentArtifactFailure,
    }),
    [openPinnedFile, revealEditorSurface],
  );

  const openTerminalLink = useCallback(
    (path: string, line?: number, column?: number) => {
      const position = { column: column ?? 1, lineNumber: line ?? 1 };
      void openThenRevealFiles(
        () =>
          openProblemNotice({
            id: `agent-terminal:${path}:${position.lineNumber}:${position.column}`,
            message: path,
            navigationTarget: { path, range: { end: position, start: position } },
            severity: "info",
            source: "Terminal",
          }),
        revealEditorSurface,
      );
    },
    [openProblemNotice, revealEditorSurface],
  );

  const openFileLocation = useCallback<AgentFileLocationOpener>(
    ({ location, root }) => {
      const position = { column: location.column ?? 1, lineNumber: location.line ?? 1 };
      const open = () =>
        openThenRevealFiles(
          () =>
            openProblemNotice({
              id: `agent-link:${location.path}:${position.lineNumber}:${position.column}`,
              message: location.path,
              navigationTarget: { path: location.path, range: { end: position, start: position } },
              severity: "info",
              source: "Agent",
            }),
          revealEditorSurface,
        );
      return openOrClassifyLinkedFile(open, location.path, root, files);
    },
    [files, openProblemNotice, revealEditorSurface],
  );

  const localCloneSession = useRef<LocalProjectCloneSession["current"]>(null);
  const remoteCloneSession = useRef<RemoteAddProjectSession["current"]>(null);
  const creationSession = useRef<AgentProjectCreationSession["current"]>(null);
  const saveCloneParent = useCallback(
    async (lastCloneParentPath: string): Promise<void> => {
      await saveWorkbenchSettings(
        { ...appSettingsRef.current, lastCloneParentPath },
        workspaceSettingsRef.current,
        workspaceTrustRef.current?.trusted ?? null,
        "reportAndReject",
      );
    },
    [saveWorkbenchSettings],
  );
  const cloneDestination = useAgentCloneDestinationPreference({
    lastParentPath: appSettings.lastCloneParentPath ?? null,
    save: saveCloneParent,
    resolveHome: resolveTauriWorkspaceHome,
  });
  const recentFolders = useMemo(
    () =>
      recentFolderEntries({
        recentPaths: appSettings.recentWorkspacePaths ?? [],
        openedAt: appSettings.recentWorkspaceOpenedAt ?? {},
        excludeRoots: projects.projects.map((project) => project.rootPath),
      }),
    [appSettings.recentWorkspaceOpenedAt, appSettings.recentWorkspacePaths, projects.projects],
  );
  const addProject = useAgentWorkbenchProjectOpening({
    localCloneSession,
    remoteCloneSession,
    creationSession,
    cloneGateway: localCloneGateway,
    directoryListingGateway,
    openWorkspaceRootWithReceipt,
    navigationSession,
    addProjectPending,
    deferOpenedProjectTrust: projects.deferOpenedProjectTrust,
    cloneDestination,
    recentFolders,
  });

  const shortcuts = useMemo(() => layoutShortcuts(appSettings.keymap), [appSettings.keymap]);
  const checkoutDirtyRevision = useAgentCheckoutDirtyRevision(
    workbench.openDocuments,
    workbench.resolveDocumentSessionDirtyProjection,
    workbench.documentSessionAuthorityRevision?.ownerDirtyCountProjection ?? null,
  );
  const branchCheckout = useMemo(() => {
    if (gitBranchGateway === null) return null;
    return {
      gateway: gitBranchGateway,
      dirtyRevision: checkoutDirtyRevision,
      guard: (target: { readonly rootPath: string; readonly ownerKey: string }) => {
        const current = workbench;
        return agentBranchCheckoutGuardReason(target.rootPath, {
          workspaceRoot: current.workspaceRoot,
          workspaceTrusted: !!current.workspaceTrust?.trusted,
          projects: current.agents.agentProjects.projects,
          threads: current.agents.threads.map(({ thread }) => ({
            projectRootKey: thread.owner.rootKey,
            rootPath: thread.target.worktreePath ?? thread.owner.repositoryRoot,
            running: runningTurn(thread) !== null,
          })),
          documents: current.openDocuments,
          dispatching: current.agents.dispatching,
          isLiveDocumentDirty: (path) => {
            const projection = current.resolveDocumentSessionDirtyProjection?.(path) ?? null;
            if (projection === null) return false;
            const snapshot = getEditorDocumentDirtySnapshot(projection);
            return snapshot.status === "unavailable" || snapshot.dirty;
          },
        });
      },
    };
  }, [checkoutDirtyRevision, gitBranchGateway, workbench]);
  const runCommand = workbench.runCommand;
  const defaultNewThreadPicker = useMemo(
    () =>
      commandPaletteNewThreadPicker(
        workbenchCommandPaletteLaunch,
        () => runCommand(SHOW_COMMAND_PALETTE) === "executed",
      ),
    [runCommand],
  );
  const newThreadPicker =
    injectedNewThreadPicker === undefined ? defaultNewThreadPicker : injectedNewThreadPicker;
  const liveCheckoutBranches = useMemo(
    () => agentLiveCheckoutBranches(workbench.gitRepositoryStatuses ?? []),
    [workbench.gitRepositoryStatuses],
  );
  const rightPanelGateways = useMemo(
    () => injectedRightPanelGateways ?? createDefaultAgentRightPanelGateways(fileSearch),
    [fileSearch, injectedRightPanelGateways],
  );
  const rightPanel = useAgentRightPanelChrome({
    gateways: rightPanelGateways,
    workspaceRoot: workbench.workspaceRoot,
    repositoryStatuses: workbench.gitRepositoryStatuses,
    clipboard: textClipboard ?? DEFAULT_TEXT_CLIPBOARD,
  });
  const setStatusBarItemVisibility = workbench.setStatusBarItemVisibility;
  const attentionVisible = workbench.workspaceSettings.statusBar.agentAttention;
  const threadActivity = useMemo<AgentWorkbenchThreadActivityChrome>(
    () => ({
      attentionVisible,
      onChangeAttentionVisible:
        setStatusBarItemVisibility === undefined
          ? null
          : (visible) => setStatusBarItemVisibility("agentAttention", visible),
    }),
    [attentionVisible, setStatusBarItemVisibility],
  );
  const chrome = useMemo<AgentWorkbenchChrome>(
    () => ({
      workspaceActivation,
      rightPanel,
      layout: agentWorkbench,
      bottomPanelVisible,
      shortcuts,
      scripts,
      scriptsSurface,
      workspaceId,
      workspaceTrusted,
      gitHistoryGateway,
      branchCheckout,
      liveCheckoutBranches,
      threadBranchMemory: DEFAULT_THREAD_BRANCH_MEMORY,
      worktreeSync:
        workbench.agentWorktreeFileSync === undefined || worktreeFileChanges === null
          ? null
          : {
              gateway: worktreeFileChanges,
              control: workbench.agentWorktreeFileSync,
              workspaceOwnerKey: workbench.agentWorktreeFileSync.workspaceOwnerKey,
              openWorkspaceRoots: [
                ...new Set([
                  ...appSettings.workspaceTabs,
                  ...(workbench.workspaceRoot === null ? [] : [workbench.workspaceRoot]),
                ]),
              ],
            },
      fileTree: {
        files,
        fileChanges,
        activePath: workbench.activePath,
        revealActivePathSignal: activeFileRevealSignal,
        fileStatusesByPath,
        searchFilesShortcut,
        onOpenFile: treeFileOpeners.onOpenFile,
        onPreviewFile: treeFileOpeners.onPreviewFile,
        revealEditor: treeFileOpeners.revealEditor,
      },
      diff: {
        monacoTheme,
        editorFontFamily: appSettings.editorFontFamily,
        editorFontLigatures: appSettings.editorFontLigatures,
        editorFontSize: appSettings.editorFontSize,
      },
      terminal: {
        terminalGateway,
        terminalTheme,
        shellIntegrationEnabled: appSettings.terminalShellIntegrationEnabled,
        onOpenLink: openTerminalLink,
      },
      addProject,
      onToggleBottomPanel,
      onShowTerminalPanel: showTerminalPanel,
      onOpenScriptsView: openScriptsView,
      revealPath,
      openFileLocation,
      onTrustWorkspace,
      onResizeRightPanelStart,
      threadActivity,
    }),
    [
      activeFileRevealSignal,
      workspaceActivation,
      rightPanel,
      addProject,
      agentWorkbench,
      appSettings.editorFontFamily,
      appSettings.editorFontLigatures,
      appSettings.editorFontSize,
      appSettings.terminalShellIntegrationEnabled,
      fileChanges,
      fileStatusesByPath,
      files,
      gitHistoryGateway,
      branchCheckout,
      liveCheckoutBranches,
      workbench.agentWorktreeFileSync,
      workbench.workspaceRoot,
      worktreeFileChanges,
      appSettings.workspaceTabs,
      monacoTheme,
      onResizeRightPanelStart,
      onToggleBottomPanel,
      onTrustWorkspace,
      openFileLocation,
      openScriptsView,
      openTerminalLink,
      revealPath,
      scripts,
      scriptsSurface,
      searchFilesShortcut,
      shortcuts,
      showTerminalPanel,
      terminalGateway,
      terminalTheme,
      threadActivity,
      treeFileOpeners,
      workbench.activePath,
      bottomPanelVisible,
      workspaceId,
      workspaceTrusted,
    ],
  );

  return (
    <AgentArtifactSupportProvider value={artifactSupport}>
      <AgentTranscriptPositionProvider value={restoredSession.transcriptPositions}>
        <AgentModeView
          monacoTheme={monacoTheme}
          followUpBehavior={appSettings.agentFollowUpBehavior}
          questionGateway={DEFAULT_QUESTION_GATEWAY}
          artifactLoader={DEFAULT_ARTIFACT_LOADER}
          artifactPreview={DEFAULT_ARTIFACT_PREVIEW}
          imageSurface={DEFAULT_IMAGE_SURFACE}
          agents={agents}
          chrome={chrome}
          key={navigationBoundary.key}
          navigationSession={navigationSession}
          modelFavoritesPersistence={modelFavoritesPersistence}
          onOpenSourceControl={openSourceControl}
          onOpenEnvironmentSettings={
            openSettingsSection === undefined ? undefined : openEnvironmentSettings
          }
          onOpenUsageSettings={openSettingsSection === undefined ? undefined : openUsageSettings}
          onCloseProject={(rootPath) => void workbench.closeWorkspaceTab(rootPath)}
          onActivateWorkspaceTab={activateWorkspaceTab}
          onReleaseProject={(projectRootKey) => void projects.releaseProject(projectRootKey)}
          onTrustProject={(projectRootKey, origin) =>
            void (projects.grantProjectTrust ?? projects.trustProject)(
              projectRootKey,
              origin ?? null,
            )
          }
          overflowRootPaths={projects.overflowRootPaths}
          providerEnabled={providerEnabled}
          projects={projects.projects}
          projectsLoaded={projects.projectsLoaded}
          textClipboard={textClipboard}
          projectCollapsePreference={projectCollapsePreference}
          projectFocusPreference={projectFocusPreference}
          newThreadPicker={newThreadPicker}
          viewCommands={workbenchAgentViewCommandBridge}
          threadNotifications={threadNotifications}
          threadNotificationsVisible={workbench.settingsOpen !== true}
          remotePortPreview={remotePortPreview}
          workspaceRoot={workspaceRoot}
        />
      </AgentTranscriptPositionProvider>
    </AgentArtifactSupportProvider>
  );
}

function usePersistedProviderProjection(
  management: AgentProviderManagementSurface,
  optimisticEnabled: Readonly<Record<AgentCliKind, boolean>>,
  selectedProvider: AgentCliKind,
): PersistedProviderProjection {
  const claudeCodeAuthority = management.authority("claudeCode");
  const codexAuthority = management.authority("codex");
  const selectedAuthority = management.selectedProviderAuthority;
  const [projection, setProjection] = useState(() =>
    initialPersistedProviderProjection(
      { claudeCode: claudeCodeAuthority, codex: codexAuthority },
      optimisticEnabled,
      selectedProvider,
      selectedAuthority,
    ),
  );
  useLayoutEffect(() => {
    setProjection((current) =>
      projectPersistedProviders(
        current,
        { claudeCode: claudeCodeAuthority, codex: codexAuthority },
        optimisticEnabled,
        selectedProvider,
        selectedAuthority,
      ),
    );
  }, [claudeCodeAuthority, codexAuthority, optimisticEnabled, selectedAuthority, selectedProvider]);
  return projection;
}

function projectPersistedProviders(
  previous: PersistedProviderProjection | null,
  currentAuthorities: Readonly<
    Record<AgentCliKind, PersistedAgentProviderSettingsAuthority | null>
  >,
  optimisticEnabled: Readonly<Record<AgentCliKind, boolean>>,
  selectedProvider: AgentCliKind,
  selectedAuthority: SelectedAgentProviderAuthority | null,
): PersistedProviderProjection {
  if (selectedAuthority === null) {
    return initialPersistedProviderProjection(
      currentAuthorities,
      optimisticEnabled,
      selectedProvider,
      null,
    );
  }
  const retained =
    previous?.selectedAuthority === null || previous === null
      ? initialPersistedProviderProjection(
          currentAuthorities,
          optimisticEnabled,
          selectedProvider,
          selectedAuthority,
        )
      : previous;
  let authorities = { ...retained.authorities };
  let enabled = retained.enabled;
  ({ authorities, enabled } = retainProviderAuthority(
    "claudeCode",
    authorities,
    enabled,
    currentAuthorities.claudeCode,
  ));
  ({ authorities, enabled } = retainProviderAuthority(
    "codex",
    authorities,
    enabled,
    currentAuthorities.codex,
  ));
  return {
    authorities,
    enabled,
    selectedAuthority,
    selectedProvider: selectedAuthority.provider,
  };
}

function initialPersistedProviderProjection(
  currentAuthorities: Readonly<
    Record<AgentCliKind, PersistedAgentProviderSettingsAuthority | null>
  >,
  optimisticEnabled: Readonly<Record<AgentCliKind, boolean>>,
  selectedProvider: AgentCliKind,
  selectedAuthority: SelectedAgentProviderAuthority | null,
): PersistedProviderProjection {
  const authorities = {
    ...(currentAuthorities.claudeCode === null
      ? {}
      : { claudeCode: currentAuthorities.claudeCode }),
    ...(currentAuthorities.codex === null ? {} : { codex: currentAuthorities.codex }),
  };
  return {
    authorities,
    enabled: {
      claudeCode: currentAuthorities.claudeCode?.preference.enabled ?? optimisticEnabled.claudeCode,
      codex: currentAuthorities.codex?.preference.enabled ?? optimisticEnabled.codex,
    },
    selectedAuthority,
    selectedProvider: selectedAuthority?.provider ?? selectedProvider,
  };
}

function retainProviderAuthority(
  provider: AgentCliKind,
  authorities: Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>,
  enabled: Readonly<Record<AgentCliKind, boolean>>,
  current: PersistedAgentProviderSettingsAuthority | null,
): {
  authorities: Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>;
  enabled: Readonly<Record<AgentCliKind, boolean>>;
} {
  if (current === null) return { authorities, enabled };
  const retained = authorities[provider];
  if (retained !== undefined && current.settingsRevision < retained.settingsRevision) {
    return { authorities, enabled };
  }
  return {
    authorities: { ...authorities, [provider]: current },
    enabled: { ...enabled, [provider]: current.preference.enabled },
  };
}

function layoutShortcuts(keymap: KeymapSettings): AgentPanelLayoutShortcuts {
  return {
    bottomPanel: shortcutForCommand(keymap, "panel.toggle") ?? "",
    rightPanel: shortcutForCommand(keymap, "agent.toggleRightPanel") ?? "",
    sidebar: shortcutForCommand(keymap, "agent.toggleSidebar") ?? "",
    newThread: shortcutForCommand(keymap, "agent.newThread") ?? "",
    newThreadIn: shortcutForCommand(keymap, "agent.newThreadIn") ?? "",
  };
}
