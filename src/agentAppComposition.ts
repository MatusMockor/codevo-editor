import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import packageMetadata from "../package.json";
import { createAgentAccountUsageSources } from "./application/agentAccountUsageSources";
import type { AgentAppControllerPorts } from "./application/agentApp/agentAppPorts";
import { ConfirmingWorkspaceTrustGateway } from "./application/confirmingWorkspaceTrustGateway";
import type { NativeWindowPort } from "./application/nativeWindowPort";
import { QuickInputCoordinator } from "./application/quickInputCoordinator";
import { createRemoteAgentThreadRequestFeed } from "./application/remoteAgentThreadRequestFeed";
import { flushSessionRestore } from "./application/sessionRestorePersistence";
import { createUnifiedAgentThreadRequestFeed } from "./application/unifiedAgentThreadRequestFeed";
import { WorkspaceTrustPromptCoordinator } from "./application/workspaceTrustPrompt";
import { createAgentWorkbenchPorts } from "./agentWorkbenchPortsComposition";
import type { AgentWorkbenchScreenProps } from "./components/agentMode/AgentWorkbenchScreen";
import type { AgentWorkbenchPorts } from "./components/agentWorkbenchPortsContext";
import { purgeRemovedDebuggerStorage } from "./domain/removedDebuggerStorage";
import { purgeRemovedEditorStorage } from "./domain/removedEditorStorage";
import type { SystemFontGateway } from "./domain/systemFonts";
import { BrowserAgentAccountUsageStoreGateway } from "./infrastructure/browserAgentAccountUsageStoreGateway";
import { BrowserAgentSidebarRailPreference } from "./infrastructure/browserAgentSidebarRailPreference";
import { BrowserSettingsGateway } from "./infrastructure/browserSettingsGateway";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { isBenignError } from "./infrastructure/globalErrorSafetyNet";
import { SettingsAppUpdaterPreferencesGateway } from "./infrastructure/settingsAppUpdaterPreferencesGateway";
import { TauriAgentCliDiscoveryGateway } from "./infrastructure/tauriAgentCliDiscoveryGateway";
import { TauriAgentInlineImageGateway } from "./infrastructure/tauriAgentInlineImageGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { TauriAgentProviderSignInGateway } from "./infrastructure/tauriAgentProviderSignInGateway";
import { TauriAgentQuestionGateway } from "./infrastructure/tauriAgentQuestionGateway";
import { TauriAgentRootLeaseGateway } from "./infrastructure/tauriAgentRootLeaseGateway";
import { TauriAgentTaskGateway } from "./infrastructure/tauriAgentTaskGateway";
import { TauriAgentThreadRequestFeed } from "./infrastructure/tauriAgentThreadRequestFeed";
import { TauriAgentThreadSessionGateway } from "./infrastructure/tauriAgentThreadSessionGateway";
import { TauriAgentTurnChangesGateway } from "./infrastructure/tauriAgentTurnChangesGateway";
import { createAppUpdateCheck } from "./infrastructure/tauriAppUpdateCheck";
import { TauriAppUpdaterGateway } from "./infrastructure/tauriAppUpdaterGateway";
import { TauriGitGateway, TauriGitHistoryGateway } from "./infrastructure/tauriGitGateway";
import { TauriGitWorktreeGateway } from "./infrastructure/tauriGitWorktreeGateway";
import { resolveTauriWorkspaceHome } from "./infrastructure/tauriHomeDirectory";
import { createTauriNativeWindow } from "./infrastructure/tauriNativeWindow";
import { TauriNodePackageScriptsGateway } from "./infrastructure/tauriNodePackageScriptsGateway";
import { TauriRemoteAgentThreadRequestGateway } from "./infrastructure/tauriRemoteAgentThreadRequestGateway";
import { TauriSystemFontGateway } from "./infrastructure/tauriSystemFontGateway";
import { TauriTerminalGateway } from "./infrastructure/tauriTerminalGateway";
import { TauriVscodeProcessTasksGateway } from "./infrastructure/tauriVscodeProcessTasksGateway";
import { tauriWindowZoomGateway } from "./infrastructure/tauriWindowZoomGateway";
import { TauriWorkspaceFileChangeGateway } from "./infrastructure/tauriWorkspaceFileChangeGateway";
import { TauriWorkspaceGateway } from "./infrastructure/tauriWorkspaceGateway";
import { TauriWorkspaceIdentityGateway } from "./infrastructure/tauriWorkspaceIdentityGateway";
import { TauriWorkspaceRuntimeLifecycleGateway } from "./infrastructure/tauriWorkspaceRuntimeLifecycleGateway";
import { TauriWorkspaceTrustGateway } from "./infrastructure/tauriWorkspaceTrustGateway";

export const AGENT_APP_VERSION = packageMetadata.version;

export type AgentAppSurfaceGateways = Pick<
  AgentWorkbenchScreenProps,
  "fileChanges" | "fileSearch" | "gitBranchGateway" | "gitHistoryGateway" | "questionGateway"
>;

export interface AgentAppComposition extends AgentAppControllerPorts {
  readonly agentSurfaceGateways: AgentAppSurfaceGateways;
  readonly agentWorkbenchPorts: AgentWorkbenchPorts;
  readonly nativeWindow: NativeWindowPort | null;
  readonly quickInputCoordinator: QuickInputCoordinator;
  readonly systemFontGateway: SystemFontGateway;
  readonly workspaceTrustPrompt: WorkspaceTrustPromptCoordinator;
}

export function createAgentAppComposition(): AgentAppComposition {
  const gitGateway = new TauriGitGateway();
  const gitHistoryGateway = new TauriGitHistoryGateway();
  const workspaceIdentityGateway = new TauriWorkspaceIdentityGateway();
  const workspaceGateway = new TauriWorkspaceGateway(workspaceIdentityGateway);
  const workspaceFileChangeGateway = new TauriWorkspaceFileChangeGateway();
  const quickInputCoordinator = new QuickInputCoordinator();
  const workspaceTrustPrompt = new WorkspaceTrustPromptCoordinator();
  const settingsGateway = new BrowserSettingsGateway();
  const agentAccountUsageStoreGateway = new BrowserAgentAccountUsageStoreGateway();
  const agentProviderGateway = Object.assign(new TauriAgentProviderGateway(), {
    accountUsageSources: createAgentAccountUsageSources(),
    loadAgentAccountUsage: () => agentAccountUsageStoreGateway.loadAgentAccountUsage(),
    saveAgentAccountUsage: (
      snapshot: Parameters<typeof agentAccountUsageStoreGateway.saveAgentAccountUsage>[0],
    ) => agentAccountUsageStoreGateway.saveAgentAccountUsage(snapshot),
    invalidateAgentAccountUsage: (
      provider: Parameters<typeof agentAccountUsageStoreGateway.invalidateAgentAccountUsage>[0],
    ) => agentAccountUsageStoreGateway.invalidateAgentAccountUsage(provider),
    subscribeAgentAccountUsage: (
      listener: Parameters<typeof agentAccountUsageStoreGateway.subscribeAgentAccountUsage>[0],
    ) => agentAccountUsageStoreGateway.subscribeAgentAccountUsage(listener),
  });
  const agentThreadRequestFeed = createUnifiedAgentThreadRequestFeed({
    local: new TauriAgentThreadRequestFeed(),
    remote: createRemoteAgentThreadRequestFeed(new TauriRemoteAgentThreadRequestGateway()),
  });
  const appUpdaterGateway = new TauriAppUpdaterGateway(
    {
      check: createAppUpdateCheck((command) => invoke(command)),
      relaunch: () => {
        flushSessionRestore();
        return relaunch();
      },
      getInstallMode: () => invoke("app_update_install_mode"),
    },
    AGENT_APP_VERSION,
  );

  return {
    agentGateways: {
      agentCliDiscoveryGateway: new TauriAgentCliDiscoveryGateway(),
      agentInlineImageGateway: new TauriAgentInlineImageGateway(),
      agentProviderGateway,
      agentProviderSignInGateway: new TauriAgentProviderSignInGateway(),
      agentRootLeaseGateway: new TauriAgentRootLeaseGateway(),
      agentSidebarRailPreference: new BrowserAgentSidebarRailPreference(),
      agentTaskGateway: new TauriAgentTaskGateway(),
      agentThreadRequestFeed,
      agentThreadSessionGateway: new TauriAgentThreadSessionGateway(),
      gitWorktreeGateway: new TauriGitWorktreeGateway(),
      resolveWorkspaceHome: resolveTauriWorkspaceHome,
      turnChangesGateway: new TauriAgentTurnChangesGateway(),
      windowZoomGateway: tauriWindowZoomGateway,
    },
    agentSurfaceGateways: {
      fileChanges: workspaceFileChangeGateway,
      fileSearch: workspaceGateway,
      gitBranchGateway: gitGateway,
      gitHistoryGateway,
      questionGateway: new TauriAgentQuestionGateway(),
    },
    agentWorkbenchPorts: createAgentWorkbenchPorts(),
    appUpdater: {
      appUpdaterGateway,
      appUpdaterPreferencesGateway: new SettingsAppUpdaterPreferencesGateway(settingsGateway),
      appVersion: AGENT_APP_VERSION,
    },
    gitGateway,
    isBenignError,
    nativeWindow: createTauriNativeWindow(),
    nodePackageScriptsGateway: new TauriNodePackageScriptsGateway(workspaceIdentityGateway),
    quickInputCoordinator,
    settingsGateway,
    systemFontGateway: new TauriSystemFontGateway(),
    terminalGateway: new TauriTerminalGateway(),
    vscodeProcessTasksGateway: new TauriVscodeProcessTasksGateway(),
    workbenchPrompter: new BrowserWorkbenchPrompter(quickInputCoordinator),
    workspace: {
      fileChanges: workspaceFileChangeGateway,
      fileSearch: workspaceGateway,
      files: workspaceGateway,
      identity: workspaceIdentityGateway,
      ownerFiles: workspaceGateway,
    },
    workspaceRuntimeLifecycleGateway: new TauriWorkspaceRuntimeLifecycleGateway(),
    workspaceTrustGateway: new ConfirmingWorkspaceTrustGateway(
      new TauriWorkspaceTrustGateway(),
      workspaceTrustPrompt,
    ),
    workspaceTrustPrompt,
  };
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

purgeRemovedDebuggerStorage(browserLocalStorage());
purgeRemovedEditorStorage(browserLocalStorage());

export const agentAppComposition = createAgentAppComposition();
