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
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentSurfaceFileTreeDependencies } from "../../application/useAgentSurfaceFileTree";
import type { AgentThreadScriptRunner } from "../../application/useAgentThreadScripts";
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
  type AgentWorkbenchChrome,
} from "./agentWorkbenchChrome";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type AgentWorkbenchScreenWorkbench = Pick<
  Workbench,
  | "activePath"
  | "agentWorkbench"
  | "appSettings"
  | "bottomPanelView"
  | "bottomPanelVisible"
  | "closeWorkspaceTab"
  | "hideBottomPanel"
  | "nodePackageScripts"
  | "openPinnedFile"
  | "openProblemNotice"
  | "openWorkspaceRoot"
  | "previewFile"
  | "saveWorkbenchSettings"
  | "setSidebarView"
  | "showBottomPanelView"
  | "workspaceIdentityDescriptor"
  | "workspaceRoot"
  | "workspaceSettings"
  | "workspaceTrust"
> & { readonly agents: WorkbenchAgentsSurface };

export interface AgentWorkbenchScreenProps {
  readonly workbench: AgentWorkbenchScreenWorkbench;
  readonly activeFileRevealSignal: number;
  readonly fileStatusesByPath: Record<string, GitChangeStatus>;
  readonly files: AgentSurfaceFileTreeDependencies["files"];
  readonly fileChanges: AgentSurfaceFileTreeDependencies["fileChanges"];
  readonly terminalGateway: TerminalGateway;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
  readonly workspaceTrusted: boolean;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly revealPathGateway?: RevealPathGateway;
  readonly directoryListingGateway?: DirectoryListingGateway;
  onTrustWorkspace(): void;
  onResizeRightPanelStart(event: PointerEvent<HTMLDivElement>): void;
}

export const ADD_PROJECT_REFUSED_REASON = "Unable to add that project.";
const DEFAULT_REVEAL_PATH_GATEWAY: RevealPathGateway = new TauriRevealPathGateway();
const DEFAULT_DIRECTORY_LISTING_GATEWAY: DirectoryListingGateway =
  new TauriDirectoryListingGateway();
const DEFAULT_TEXT_CLIPBOARD = new BrowserTextClipboardGateway();
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
  fileChanges,
  fileStatusesByPath,
  files,
  monacoTheme,
  onResizeRightPanelStart,
  onTrustWorkspace,
  revealPathGateway = DEFAULT_REVEAL_PATH_GATEWAY,
  terminalGateway,
  terminalTheme,
  textClipboard = DEFAULT_TEXT_CLIPBOARD,
  workbench,
  workspaceTrusted,
}: AgentWorkbenchScreenProps) {
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
  const { openPinnedFile, openProblemNotice, previewFile, setSidebarView } = workbench;
  const { openWorkspaceRoot } = workbench;
  const { saveWorkbenchSettings } = workbench;
  const { bottomPanelView, bottomPanelVisible, hideBottomPanel, showBottomPanelView } = workbench;
  const workspaceId = workbench.workspaceIdentityDescriptor?.workspaceId ?? null;
  const appSettingsRef = useRef(appSettings);
  const workspaceSettingsRef = useRef(workbench.workspaceSettings);
  const workspaceTrustRef = useRef(workbench.workspaceTrust);
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
      run: (script, target, repositoryRoot) =>
        nodePackageScripts.run(script, target, repositoryRoot),
      stop: () => nodePackageScripts.stop(),
    }),
    [nodePackageScripts],
  );

  const openScriptsView = useCallback(() => {
    agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
    setSidebarView("scripts");
  }, [agentWorkbench, setSidebarView]);

  const openSourceControl = useCallback(() => {
    agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
    setSidebarView("git");
  }, [agentWorkbench, setSidebarView]);

  const showTerminalPanel = useCallback(() => {
    showBottomPanelView("terminal");
  }, [showBottomPanelView]);

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

  const openTerminalLink = useCallback(
    (path: string, line?: number, column?: number) => {
      const position = { column: column ?? 1, lineNumber: line ?? 1 };
      void openProblemNotice({
        id: `agent-terminal:${path}:${position.lineNumber}:${position.column}`,
        message: path,
        navigationTarget: { path, range: { end: position, start: position } },
        severity: "info",
        source: "Terminal",
      });
    },
    [openProblemNotice],
  );

  const addProject = useMemo(
    () => ({
      gateway: directoryListingGateway,
      addProject: async (path: string) => {
        const opened = await openWorkspaceRoot(path);
        if (!opened) throw new Error(ADD_PROJECT_REFUSED_REASON);
      },
    }),
    [directoryListingGateway, openWorkspaceRoot],
  );

  const shortcuts = useMemo(() => layoutShortcuts(appSettings.keymap), [appSettings.keymap]);
  const chrome = useMemo<AgentWorkbenchChrome>(
    () => ({
      layout: agentWorkbench,
      bottomPanelVisible,
      shortcuts,
      scripts,
      workspaceId,
      workspaceTrusted,
      fileTree: {
        files,
        fileChanges,
        activePath: workbench.activePath,
        revealActivePathSignal: activeFileRevealSignal,
        fileStatusesByPath,
        onOpenFile: openPinnedFile,
        onPreviewFile: previewFile,
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
      onTrustWorkspace,
      onResizeRightPanelStart,
    }),
    [
      activeFileRevealSignal,
      addProject,
      agentWorkbench,
      appSettings.editorFontFamily,
      appSettings.editorFontLigatures,
      appSettings.editorFontSize,
      appSettings.terminalShellIntegrationEnabled,
      fileChanges,
      fileStatusesByPath,
      files,
      monacoTheme,
      onResizeRightPanelStart,
      onToggleBottomPanel,
      onTrustWorkspace,
      openPinnedFile,
      openScriptsView,
      openTerminalLink,
      previewFile,
      revealPath,
      scripts,
      shortcuts,
      showTerminalPanel,
      terminalGateway,
      terminalTheme,
      workbench.activePath,
      bottomPanelVisible,
      workspaceId,
      workspaceTrusted,
    ],
  );

  return (
    <AgentModeView
      agents={agents}
      chrome={chrome}
      key={workspaceRoot ?? ""}
      modelFavoritesPersistence={modelFavoritesPersistence}
      onOpenSourceControl={openSourceControl}
      onCloseProject={(rootPath) => void workbench.closeWorkspaceTab(rootPath)}
      onReleaseProject={(projectRootKey) => void projects.releaseProject(projectRootKey)}
      onTrustProject={(projectRootKey) => void projects.trustProject(projectRootKey)}
      overflowRootPaths={projects.overflowRootPaths}
      providerEnabled={providerEnabled}
      projects={projects.projects}
      textClipboard={textClipboard}
      viewCommands={workbenchAgentViewCommandBridge}
      workspaceRoot={workspaceRoot}
    />
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
  };
}
