import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings } from "../../domain/settings";
import { formatAgentModeWindowTitle } from "../../domain/windowTitle";
import { agentGitStatusDemand } from "../agentGitStatusDemand";
import { executeCommandAndReport, type CommandContext } from "../commandRegistry";
import type { AgentProjectsSurface } from "../useAgentProjects";
import { useAppWindowTitle } from "../useAppBootEffects";
import { useAppUpdater } from "../useAppUpdater";
import { useWorkbenchControllerAgents } from "../useWorkbenchControllerAgents";
import { useWorkbenchKeyboardShortcuts } from "../useWorkbenchKeyboardShortcuts";
import { useWorkbenchNativeMenuCommands } from "../useWorkbenchNativeMenuCommands";
import { useWorkbenchWindowZoom } from "../useWorkbenchWindowZoom";
import type { AgentAppControllerPorts } from "./agentAppPorts";
import { scriptsWorkspaceHasJavaScriptTypeScript } from "./agentWorkspaceRuntimes";
import { useAgentCloseLifecycle } from "./useAgentCloseLifecycle";
import { useAgentCommandRegistry } from "./useAgentCommandRegistry";
import { useAgentGitStatus } from "./useAgentGitStatus";
import { useAgentSettingsCommands } from "./useAgentSettingsCommands";
import { useAgentTerminalPanel } from "./useAgentTerminalPanel";
import { useAgentPaletteSources } from "./useAgentPaletteSources";
import { useAgentWorkspaceFileChanges } from "./useAgentWorkspaceFileChanges";
import { useAgentWorkspaceSession } from "./useAgentWorkspaceSession";
import { useAgentWorkspaceTasks } from "./useAgentWorkspaceTasks";

export interface AgentAppControllerOptions {
  readonly focusFileSearch?: () => void;
}

const NO_FILE_SEARCH_FOCUS = () => undefined;
const SETTLED_PROJECT_CLOSE = {
  complete: async () => undefined,
  finalizeBackendClosed: () => undefined,
};

export function useAgentAppController(
  ports: AgentAppControllerPorts,
  { focusFileSearch = NO_FILE_SEARCH_FOCUS }: AgentAppControllerOptions = {},
) {
  const session = useAgentWorkspaceSession(ports);
  const { appSettings, appSettingsRef, authority, gitBridge, notices, persistence, transition } =
    session;
  const { workspaceSettings, workspaceSettingsRef } = session;
  const { workspaceIdentityDescriptor, workspaceOwnerKey, workspaceRoot } = transition;
  const { setWorkspaceTrust, workspaceTrust } = session.trust;
  const workspaceTrusted = workspaceTrust?.trusted === true;
  const { reportError, reportErrorForActiveWorkspaceRoot } = notices;

  const terminal = useAgentTerminalPanel({
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    owner: transition.activeWorkspace,
  });
  const settings = useAgentSettingsCommands({
    appSettingsRef,
    authority,
    persistAppSettings: persistence.persistAppSettings,
    persistWorkspaceSettings: persistence.persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    runGitRepositoryDiscovery: gitBridge.port.runDiscovery,
    runtimeGateways: session.runtimeGateways,
    setWorkspaceTrust,
    trustGateway: ports.workspaceTrustGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
  });
  const [gitDemanded, setGitDemanded] = useState(false);
  const git = useAgentGitStatus({
    bridge: gitBridge,
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    demanded: gitDemanded,
    discoverGitRepositories: transition.discoverGitRepositories,
    gitGateway: ports.gitGateway,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  });
  const agents = useWorkbenchControllerAgents({
    activateWorkspaceRoot: transition.activateWorkspaceTab,
    appSettingsRef,
    applyAppSettings: persistence.applyAppSettings,
    bottomPanelVisible: terminal.bottomPanelVisible,
    editorSessionOwnerKey: workspaceOwnerKey,
    gitGateway: ports.gitGateway,
    gitRepositoryMappings: git.gitRepositoryMappings,
    gitRepositoryStatuses: git.gitRepositoryStatuses,
    options: ports.agentGateways,
    persistWorkspaceSettings: persistence.persistWorkspaceSettings,
    prompter: ports.workbenchPrompter,
    reportError,
    setBottomPanelVisible: terminal.setBottomPanelVisible,
    setSettingsInitialSection: settings.setSettingsInitialSection,
    setSettingsOpen: settings.setSettingsOpen,
    setWorkspaceTrust,
    settingsGateway: ports.settingsGateway,
    terminalGateway: ports.terminalGateway,
    workspaceIdentityByRootRef: authority.workspaceIdentityByRootRef,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
    workspaceTrustGateway: ports.workspaceTrustGateway,
    workspaceTrustIntentCoordinatorRef: authority.workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef: authority.workspaceTrustRevisionByOwnerRef,
  });
  const { agentWorkbench } = agents;
  session.hydratedListenerRef.current = agents.markAppSettingsHydrated;
  const demand = agentGitStatusDemand(agentWorkbench);
  gitBridge.demandRef.current = demand;
  useEffect(() => setGitDemanded(demand), [demand]);

  const latestAgentsRef = useRef(agents);
  latestAgentsRef.current = agents;
  const projects = useMemo<Pick<AgentProjectsSurface, "closeWorkspaceProject">>(
    () => ({
      closeWorkspaceProject: (descriptor, isCurrent) => {
        const closeProject = latestAgentsRef.current.agentProjects.closeWorkspaceProject;
        if (closeProject) return closeProject(descriptor, isCurrent);
        return Promise.resolve({ settlement: SETTLED_PROJECT_CLOSE, status: "closed" });
      },
    }),
    [],
  );
  const prepareAgentQuit = useCallback(
    async (budgetMs: number) => latestAgentsRef.current.prepareQuit?.(budgetMs),
    [],
  );
  const close = useAgentCloseLifecycle({
    appSettingsRef,
    authority,
    fileChangeGateway: ports.workspace.fileChanges,
    forgetWorkspaceSettings: session.workspaceSettingsByRoot.forget,
    nativeShutdown: ports.nativeShutdown,
    persistAppSettings: persistence.persistAppSettings,
    prepareAgentQuit,
    projects,
    reportError,
    runtimeGateways: session.runtimeGateways,
    runtimeLifecycleGateway: ports.workspaceRuntimeLifecycleGateway,
    transition,
  });

  const dispatchLayout = agentWorkbench.dispatch;
  const { setSettingsOpen } = settings;
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);
  const revealFile = useCallback(
    (path: string, line: number | null = null) => {
      closeSettings();
      dispatchLayout({ kind: "revealFile", line, path });
    },
    [closeSettings, dispatchLayout],
  );
  const discovery = useAgentWorkspaceFileChanges({
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    gateway: ports.workspace.fileChanges,
    onChange: git.refreshOnFileChange,
    owner: transition.activeWorkspace,
    reportError,
  });
  const tasks = useAgentWorkspaceTasks({
    authority,
    hasJavaScriptTypeScriptWorkspace:
      transition.scriptsWorkspace !== null &&
      scriptsWorkspaceHasJavaScriptTypeScript(transition.scriptsWorkspace),
    nodePackageScriptDiscoveryVersion: discovery.nodePackageScriptDiscoveryVersion,
    nodePackageScriptsGateway: ports.nodePackageScriptsGateway,
    ownerFiles: ports.workspace.ownerFiles,
    reportErrorForActiveWorkspaceRoot,
    requestTerminalSession: terminal.requestActiveTerminalSession,
    revealFile,
    setNotices: notices.setNotices,
    vscodeProcessTasksGateway: ports.vscodeProcessTasksGateway,
    vscodeProcessTasksVersion: discovery.vscodeProcessTasksVersion,
    workspaceFiles: ports.workspace.files,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceTrusted,
  });

  const windowZoomActions = useWorkbenchWindowZoom({
    appSettingsRef,
    gateway: ports.agentGateways.windowZoomGateway,
    level: appSettings.windowZoomLevel,
    persistAppSettings: persistence.persistAppSettings,
    reportError,
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const palette = useAgentPaletteSources({
    agents,
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    fileSearch: ports.workspace.fileSearch,
    gitGateway: ports.gitGateway,
    owner: transition.activeWorkspace,
    paletteOpen: paletteOpen || quickOpenOpen,
    refreshGitStatus: git.refreshGitStatus,
    workspaceRoot,
    workspaceTrusted,
  });
  const commandRegistry = useAgentCommandRegistry({
    activateWorkspaceTab: transition.activateWorkspaceTab,
    agentLayout: agentWorkbench,
    appSettings,
    closeSettings,
    focusFileSearch,
    nodePackageScripts: tasks.nodePackageScripts,
    openPalette,
    openSettingsSection: settings.openSettingsSection,
    quitApplication: close.quitApplication,
    showTerminal: terminal.showTerminalPanel,
    toggleBottomPanel: terminal.toggleBottomPanel,
    toggleWorkspaceTrust: settings.toggleWorkspaceTrust,
    vscodeProcessTasks: tasks.vscodeProcessTasks.commands,
    windowZoomActions,
    workspaceRoot,
    workspaceTrust,
  });
  const commands = useMemo(() => commandRegistry.list(), [commandRegistry]);
  const commandContext = useMemo<CommandContext>(
    () => ({
      hasWorkspace: workspaceRoot !== null,
    }),
    [workspaceRoot],
  );
  const runCommand = useCallback(
    (commandId: string, context: CommandContext = commandContext) => {
      const requestedRoot = authority.currentWorkspaceRootRef.current;
      return executeCommandAndReport(commandRegistry, commandId, context, (error) =>
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Command", error),
      );
    },
    [
      authority.currentWorkspaceRootRef,
      commandContext,
      commandRegistry,
      reportErrorForActiveWorkspaceRoot,
    ],
  );
  useWorkbenchNativeMenuCommands({ commandContext, reportError, runCommand });
  const closePalette = useCallback(() => {
    if (!paletteOpen && !quickOpenOpen) return false;
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    return true;
  }, [paletteOpen, quickOpenOpen]);
  const bareKeyShortcutsRef = useRef<{
    keymap: AppSettings["keymap"] | null;
    keys: ReadonlySet<string>;
  }>({ keymap: null, keys: new Set() });
  useWorkbenchKeyboardShortcuts({
    appSettingsRef,
    bareKeyShortcutsRef,
    closeFloatingSurface: closePalette,
    commandContext,
    commandRegistry,
    keymap: appSettings.keymap,
    runCommand,
  });

  const appUpdater = useAppUpdater({
    currentVersion: ports.appUpdater.appVersion,
    gateway: ports.appUpdater.appUpdaterGateway,
    persistSkippedVersion: persistence.persistAppUpdaterSkippedVersion,
    preferencesGateway: ports.appUpdater.appUpdaterPreferencesGateway,
  });
  const windowTitle = formatAgentModeWindowTitle(workspaceRoot);
  useAppWindowTitle(windowTitle);

  return {
    activateWorkspaceTab: transition.activateWorkspaceTab,
    agents,
    agentWorkbench,
    appSettings,
    appUpdater,
    bottomPanelVisible: terminal.bottomPanelVisible,
    closeApplicationWindow: close.closeApplicationWindow,
    closeWorkspaceTab: close.closeWorkspaceTab,
    commandContext,
    commands,
    fileStatusesByPath: git.fileStatusesByPath,
    gitRepositoryMappings: git.gitRepositoryMappings,
    gitRepositoryStatuses: git.gitRepositoryStatuses,
    hideBottomPanel: terminal.hideBottomPanel,
    nodePackageScripts: tasks.nodePackageScripts,
    notices: notices.notices,
    openSettingsSection: settings.openSettingsSection,
    openWorkspaceRootWithReceipt: transition.openWorkspaceRootWithReceipt,
    paletteBranchSource: palette.branchSource,
    paletteFiles: palette.files,
    paletteOpen,
    quickOpenOpen,
    quitApplication: close.quitApplication,
    registerActiveTerminalSession: terminal.registerActiveTerminalSession,
    reportCommandError: notices.reportCommandError,
    reportError,
    revealFile,
    runCommand,
    saveWorkbenchSettings: settings.saveWorkbenchSettings,
    setPaletteOpen,
    setQuickOpenOpen,
    setSettingsOpen: settings.setSettingsOpen,
    setStatusBarItemVisibility: settings.setStatusBarItemVisibility,
    settingsInitialSection: settings.settingsInitialSection,
    settingsOpen: settings.settingsOpen,
    showTerminalPanel: terminal.showTerminalPanel,
    toggleWorkspaceTrust: settings.toggleWorkspaceTrust,
    vscodeProcessTasks: tasks.vscodeProcessTasks.state,
    windowTitle,
    workspaceIdentityDescriptor,
    workspaceOwnerKey,
    workspaceRoot,
    workspaceSettings,
    workspaceTrust,
  };
}

export type AgentAppController = ReturnType<typeof useAgentAppController>;
