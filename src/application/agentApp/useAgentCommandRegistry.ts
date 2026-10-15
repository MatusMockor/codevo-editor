import { useMemo } from "react";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { shortcutForCommand, type KeymapCommandId } from "../../domain/keymap";
import type { AppSettings, SettingsSection } from "../../domain/settings";
import type { WorkspaceTrustState } from "../../domain/trust";
import { workbenchAgentViewCommandBridge } from "../agentViewCommandBridge";
import { workbenchCommandPaletteLaunch } from "../commandPalette/commandPaletteLaunch";
import { CommandRegistry, type Command } from "../commandRegistry";
import type { WindowZoomActions } from "../useWorkbenchWindowZoom";
import {
  workbenchAgentCommands,
  type AgentWorkbenchLayoutCommandPort,
} from "../workbenchAgentCommands";
import { workbenchAppearanceCommands } from "../workbenchAppearanceCommands";
import { workbenchAppLifecycleCommands } from "../workbenchAppLifecycleCommands";
import { workbenchGitWorkflowCommands } from "../workbenchGitWorkflowCommands";
import { workbenchNodePackageScriptCommands } from "../workbenchNodePackageScriptCommands";
import { workbenchPaletteCommands } from "../workbenchPaletteCommands";
import {
  workbenchVscodeProcessTaskCommands,
  type WorkbenchVscodeProcessTaskCommandsOptions,
} from "../workbenchVscodeProcessTaskCommands";
import { workbenchWindowZoomCommands } from "../workbenchWindowZoomCommands";
import { workbenchWorkspaceTabCommands } from "../workbenchWorkspaceTabCommands";

export const AGENT_CLOSE_ACTIVE_COMMAND = "workbench.closeActive" satisfies KeymapCommandId;

export interface AgentCommandScripts {
  readonly available: boolean;
  readonly pending: boolean;
  readonly scripts: Parameters<typeof workbenchNodePackageScriptCommands>[0]["scripts"];
  run: Parameters<typeof workbenchNodePackageScriptCommands>[0]["run"];
  stop(): void;
}

export interface AgentCommandRegistryOptions {
  readonly activateWorkspaceTab: (root: string) => unknown;
  readonly agentLayout: AgentWorkbenchLayoutCommandPort;
  readonly appSettings: AppSettings;
  readonly closeSettings: () => void;
  readonly focusFileSearch: () => void;
  readonly nodePackageScripts: AgentCommandScripts;
  readonly openPalette: () => void;
  readonly openSettingsSection: (section: SettingsSection) => void;
  readonly quitApplication: () => void | Promise<void>;
  readonly showTerminal: () => void;
  readonly toggleBottomPanel: () => void;
  readonly toggleWorkspaceTrust: () => Promise<void>;
  readonly vscodeProcessTasks: WorkbenchVscodeProcessTaskCommandsOptions;
  readonly windowZoomActions: WindowZoomActions;
  readonly workspaceRoot: string | null;
  readonly workspaceTrust: WorkspaceTrustState | null;
}

export function useAgentCommandRegistry({
  activateWorkspaceTab,
  agentLayout,
  appSettings,
  closeSettings,
  focusFileSearch,
  nodePackageScripts,
  openPalette,
  openSettingsSection,
  quitApplication,
  showTerminal,
  toggleBottomPanel,
  toggleWorkspaceTrust,
  vscodeProcessTasks,
  windowZoomActions,
  workspaceRoot,
  workspaceTrust,
}: AgentCommandRegistryOptions): CommandRegistry {
  const { keymap, workspaceTabs } = appSettings;
  return useMemo(() => {
    const registry = new CommandRegistry();
    const register = (commands: readonly Command[]) =>
      commands.forEach((command) => registry.register(command));
    const shortcut = (commandId: KeymapCommandId) => shortcutForCommand(keymap, commandId);
    const openSurface = (surface: AgentSurfaceKind) =>
      agentLayout.dispatch({ kind: "openSurface", surface });

    register(workbenchAppLifecycleCommands({ shortcut, quitApplication }));
    register(
      workbenchWorkspaceTabCommands({
        activateWorkspaceTab,
        activeWorkspaceRoot: workspaceRoot,
        shortcut,
        workspaceTabs,
      }),
    );
    register(
      workbenchNodePackageScriptCommands({
        enabled: nodePackageScripts.available,
        pending: nodePackageScripts.pending,
        scripts: nodePackageScripts.scripts,
        run: nodePackageScripts.run,
        stop: () => nodePackageScripts.stop(),
      }),
    );
    register(workbenchVscodeProcessTaskCommands(vscodeProcessTasks));
    register(
      workbenchGitWorkflowCommands({
        shortcut,
        openGitBranchPanel: () => openSurface("git"),
        createGitBranch: () => openSurface("git"),
        commitGitChanges: () => openSurface("git"),
      }),
    );
    register(
      workbenchAppearanceCommands({
        shortcut,
        openSettingsPanel: () => openSettingsSection("general"),
        openAppearanceSettingsPanel: () => openSettingsSection("appearance"),
      }),
    );
    register(workbenchWindowZoomCommands(shortcut, windowZoomActions));
    register(
      workbenchPaletteCommands({
        shortcut,
        openPalette: (request) => {
          workbenchCommandPaletteLaunch.request(request);
          openPalette();
        },
      }),
    );
    register(
      agentShellCommands({
        agentLayout,
        closeSettings,
        focusFileSearch,
        openPalette,
        shortcut,
        showTerminal,
        toggleBottomPanel,
        toggleWorkspaceTrust,
        workspaceTrusted: workspaceTrust?.trusted === true,
      }),
    );
    register(
      workbenchAgentCommands({
        agentLayout,
        shortcut,
        viewCommands: workbenchAgentViewCommandBridge,
      }),
    );
    return registry;
  }, [
    activateWorkspaceTab,
    agentLayout,
    closeSettings,
    focusFileSearch,
    keymap,
    nodePackageScripts,
    openPalette,
    openSettingsSection,
    quitApplication,
    showTerminal,
    toggleBottomPanel,
    toggleWorkspaceTrust,
    vscodeProcessTasks,
    windowZoomActions,
    workspaceRoot,
    workspaceTabs,
    workspaceTrust?.trusted,
  ]);
}

interface AgentShellCommandsOptions {
  readonly agentLayout: AgentWorkbenchLayoutCommandPort;
  readonly closeSettings: () => void;
  readonly focusFileSearch: () => void;
  readonly openPalette: () => void;
  readonly shortcut: (commandId: KeymapCommandId) => string;
  readonly showTerminal: () => void;
  readonly toggleBottomPanel: () => void;
  readonly toggleWorkspaceTrust: () => Promise<void>;
  readonly workspaceTrusted: boolean;
}

function agentShellCommands({
  agentLayout,
  closeSettings,
  focusFileSearch,
  openPalette,
  shortcut,
  showTerminal,
  toggleBottomPanel,
  toggleWorkspaceTrust,
  workspaceTrusted,
}: AgentShellCommandsOptions): Command[] {
  return [
    {
      id: "commands.show",
      title: "Show Commands",
      category: "Workbench",
      shortcut: shortcut("commands.show"),
      isEnabled: () => true,
      run: openPalette,
    },
    {
      id: "panel.toggle",
      title: "Toggle Panel",
      category: "Workbench",
      shortcut: shortcut("panel.toggle"),
      isEnabled: () => true,
      run: toggleBottomPanel,
    },
    {
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: shortcut("terminal.show"),
      isEnabled: () => true,
      run: showTerminal,
    },
    {
      id: "workspace.trust",
      title: workspaceTrusted ? "Revoke Workspace Trust" : "Trust Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleWorkspaceTrust,
    },
    {
      id: "file.quickOpen",
      title: "Go to File",
      category: "File",
      shortcut: shortcut("file.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        closeSettings();
        agentLayout.dispatch({ kind: "openSurface", surface: "files" });
        focusFileSearch();
      },
    },
    {
      id: AGENT_CLOSE_ACTIVE_COMMAND,
      title: "Close Active Panel",
      category: "Workbench",
      shortcut: shortcut(AGENT_CLOSE_ACTIVE_COMMAND),
      isEnabled: () => true,
      run: () => closeActiveRightPanelSurface(agentLayout),
    },
  ];
}

export function closeActiveRightPanelSurface(agentLayout: AgentWorkbenchLayoutCommandPort): void {
  const { activeSurface, rightPanel } = agentLayout.layout;
  if (rightPanel !== "open" || activeSurface === null) return;
  agentLayout.dispatch({ kind: "closeSurfaceTab", surface: activeSurface });
}
