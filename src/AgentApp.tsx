import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { useAgentAppController } from "./application/agentApp/useAgentAppController";
import { AgentLiveThreadContext } from "./application/agentThreads/useLiveAgentThread";
import { useAgentPanelResizeCommit } from "./application/useAgentPanelResizeCommit";
import { usePrefersLightTheme } from "./application/usePrefersLightTheme";
import { useWorkbenchResizeHandles } from "./application/useWorkbenchResizeHandles";
import { agentAppComposition, type AgentAppComposition } from "./agentAppComposition";
import { AgentCommandPaletteHost } from "./components/agentApp/AgentCommandPaletteHost";
import { AgentOverlayDialogsHost } from "./components/agentApp/AgentOverlayDialogsHost";
import type { AgentSettingsModel } from "./components/agentApp/AgentSettingsHost";
import { AgentTerminalPanelHost } from "./components/agentApp/AgentTerminalPanelHost";
import { focusAgentFileSearch } from "./components/agentApp/agentFileSearchFocus";
import { AgentFrameFallback } from "./components/AgentFrameFallback";
import { AgentThreadRequestFeedContext } from "./components/agentMode/agentThreadRequestFeedContext";
import { AgentWorkbenchPortsContext } from "./components/agentWorkbenchPortsContext";
import { AppShellRoot } from "./components/AppShellRoot";
import { AppUpdaterContext } from "./components/appUpdaterContext";
import { WorkspaceTrustDialogHost } from "./components/projects/WorkspaceTrustDialogHost";
import { QuickInputDialogHost } from "./components/QuickInputDialogHost";
import { retryableLazy } from "./components/retryableLazy";
import { useAppColorThemes } from "./components/useAppColorThemes";
import { useTerminalSurfacesIdlePreload } from "./components/useTerminalSurfacesIdlePreload";
import { WindowChrome } from "./components/WindowChrome";
import { WorkbenchShellFrame } from "./components/WorkbenchShellFrame";
import { workbenchShellPlacement } from "./components/workbenchShellPlacement";
import type { AppearanceSettings } from "./domain/appearance";
import "./agentApp.css";

const AGENT_WORKSPACE_LABEL = "agent workspace";
const LazyAgentWorkbenchScreen = retryableLazy<
  ComponentProps<typeof import("./components/agentMode/AgentWorkbenchScreen").AgentWorkbenchScreen>
>(
  () =>
    import("./components/agentMode/AgentWorkbenchScreen").then((module) => ({
      default: module.AgentWorkbenchScreen,
    })),
  AGENT_WORKSPACE_LABEL,
  `Could not load ${AGENT_WORKSPACE_LABEL}`,
  <AgentFrameFallback label={AGENT_WORKSPACE_LABEL} />,
);

export interface AgentAppShellProps {
  readonly composition: AgentAppComposition;
}

export function AgentAppShell({ composition }: AgentAppShellProps) {
  const workbench = useAgentAppController(composition, { focusFileSearch: focusAgentFileSearch });
  const prefersLightTheme = usePrefersLightTheme();
  useTerminalSurfacesIdlePreload();
  const { colorScheme, codeTheme, terminalTheme } = useAppColorThemes(
    workbench.appSettings.appearance,
    prefersLightTheme,
    composition.nativeWindow,
  );
  const { agentWorkbench, runCommand } = workbench;
  const { shellStyle, startAgentBottomPanelResize, startAgentRightPanelResize } =
    useWorkbenchResizeHandles(useAgentPanelResizeCommit(agentWorkbench));
  const shellPlacement = workbenchShellPlacement({
    bottomPanelVisible: workbench.bottomPanelVisible,
    layout: agentWorkbench.layout,
  });
  const [settingsContainer, setSettingsContainer] = useState<HTMLDivElement | null>(null);
  const trustWorkspace = useCallback(() => {
    void runCommand("workspace.trust");
  }, [runCommand]);
  const { appSettings, saveWorkbenchSettings, workspaceSettings, workspaceTrust } = workbench;
  const saveAppearance = useCallback(
    (appearance: AppearanceSettings) =>
      saveWorkbenchSettings(
        { ...appSettings, appearance },
        workspaceSettings,
        workspaceTrust?.trusted ?? null,
      ),
    [appSettings, saveWorkbenchSettings, workspaceSettings, workspaceTrust],
  );
  const settingsModel = useAgentSettingsModel(workbench);
  const workspaceScope =
    workbench.workspaceIdentityDescriptor?.workspaceId ?? workbench.workspaceRoot;
  const surfaceGateways = composition.agentSurfaceGateways;

  return (
    <AppShellRoot colorScheme={colorScheme} shellStyle={shellStyle} workbench={workbench}>
      <AgentWorkbenchPortsContext.Provider value={composition.agentWorkbenchPorts}>
        <AgentLiveThreadContext.Provider value={workbench.agents.liveThreads ?? null}>
          <WindowChrome
            appTitle={workbench.windowTitle}
            commandContext={workbench.commandContext}
            commands={workbench.commands}
            onCommandError={workbench.reportCommandError}
            onQuitApplication={workbench.quitApplication}
          />
          <WorkbenchShellFrame
            agent={
              <AppUpdaterContext.Provider value={workbench.appUpdater}>
                <AgentThreadRequestFeedContext.Provider
                  value={composition.agentGateways.agentThreadRequestFeed ?? null}
                >
                  <LazyAgentWorkbenchScreen
                    activeFileRevealSignal={0}
                    fileChanges={surfaceGateways.fileChanges}
                    fileSearch={surfaceGateways.fileSearch}
                    fileStatusesByPath={workbench.fileStatusesByPath}
                    files={composition.workspace.files}
                    gitBranchGateway={surfaceGateways.gitBranchGateway}
                    gitHistoryGateway={surfaceGateways.gitHistoryGateway}
                    codeTheme={codeTheme}
                    onResizeRightPanelStart={startAgentRightPanelResize}
                    onTrustWorkspace={trustWorkspace}
                    questionGateway={surfaceGateways.questionGateway}
                    terminalGateway={composition.terminalGateway}
                    terminalTheme={terminalTheme}
                    workbench={workbench}
                  />
                </AgentThreadRequestFeedContext.Provider>
              </AppUpdaterContext.Provider>
            }
            bottom={
              workbench.bottomPanelVisible ? (
                <AgentTerminalPanelHost
                  onHide={workbench.hideBottomPanel}
                  onResizeStart={startAgentBottomPanelResize}
                  onRevealFile={workbench.revealFile}
                  onTerminalSessionReady={workbench.registerActiveTerminalSession}
                  onTrustWorkspace={trustWorkspace}
                  providerSignIn={workbench.agents.providerSignIn}
                  terminalGateway={composition.terminalGateway}
                  terminalOwnerKey={workbench.workspaceIdentityDescriptor?.workspaceId ?? null}
                  terminalShellIntegrationEnabled={appSettings.terminalShellIntegrationEnabled}
                  terminalTheme={terminalTheme}
                  workspaceRoot={workbench.workspaceRoot}
                  workspaceTrusted={workspaceTrust?.trusted === true}
                />
              ) : null
            }
            placement={shellPlacement}
            settingsRef={setSettingsContainer}
            surface={workbench.settingsOpen ? "settings" : "workbench"}
          />
          <QuickInputDialogHost
            coordinator={composition.quickInputCoordinator}
            workspaceScope={workspaceScope}
          />
          <WorkspaceTrustDialogHost
            prompt={composition.workspaceTrustPrompt}
            workspaceScope={workspaceScope}
          />
          <AgentCommandPaletteHost
            activateWorkspaceTab={workbench.activateWorkspaceTab}
            appearance={appSettings.appearance}
            branchSource={workbench.paletteBranchSource}
            commandContext={workbench.commandContext}
            commands={workbench.commands}
            files={workbench.paletteFiles}
            fileSearch={composition.workspace.fileSearch}
            keymap={appSettings.keymap}
            nodePackageScripts={workbench.nodePackageScripts.scripts}
            nodePackageScriptsTruncated={workbench.nodePackageScripts.truncated === true}
            onRevealFile={workbench.revealFile}
            open={workbench.paletteOpen}
            quickOpenOpen={workbench.quickOpenOpen}
            reportCommandError={workbench.reportCommandError}
            saveAppearance={saveAppearance}
            setOpen={workbench.setPaletteOpen}
            setQuickOpenOpen={workbench.setQuickOpenOpen}
            workspaceRoot={workbench.workspaceRoot}
            workspaceTabs={appSettings.workspaceTabs}
          />
          <AgentOverlayDialogsHost
            appUpdater={workbench.appUpdater}
            notices={workbench.notices}
            onOpenAgentSettings={workbench.agents.configureAgentCli}
            providerManagement={workbench.agents.providerManagement}
            settings={settingsModel}
            settingsContainer={settingsContainer}
            systemFontGateway={composition.systemFontGateway}
          />
        </AgentLiveThreadContext.Provider>
      </AgentWorkbenchPortsContext.Provider>
    </AppShellRoot>
  );
}

function useAgentSettingsModel(
  workbench: ReturnType<typeof useAgentAppController>,
): AgentSettingsModel {
  const {
    agents,
    appSettings,
    gitRepositoryMappings,
    saveWorkbenchSettings,
    setSettingsOpen,
    settingsInitialSection,
    settingsOpen,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceSettings,
    workspaceTrust,
  } = workbench;
  return useMemo(
    () => ({
      agents,
      appSettings,
      gitRepositoryMappings,
      saveWorkbenchSettings,
      setSettingsOpen,
      settingsInitialSection,
      settingsOpen,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceSettings,
      workspaceTrust,
    }),
    [
      agents,
      appSettings,
      gitRepositoryMappings,
      saveWorkbenchSettings,
      setSettingsOpen,
      settingsInitialSection,
      settingsOpen,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceSettings,
      workspaceTrust,
    ],
  );
}

function AgentApp() {
  return <AgentAppShell composition={agentAppComposition} />;
}

export default AgentApp;
