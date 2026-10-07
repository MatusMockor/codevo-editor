import { TauriHtmlFilePreviewGateway } from "./infrastructure/tauriHtmlFilePreviewGateway";
import { DirtyCloseDecisionCoordinator } from "./application/dirtyCloseDecisionCoordinator";
import { EditorCursorStore } from "./application/editorCursorStore";
import { LiveDocumentRuntime } from "./application/liveDocumentRuntime";
import { QuickInputCoordinator } from "./application/quickInputCoordinator";
import { WorkspaceTrustPromptCoordinator } from "./application/workspaceTrustPrompt";
import { ConfirmingWorkspaceTrustGateway } from "./application/confirmingWorkspaceTrustGateway";
import { WorkspaceNetteServicesGateway } from "./application/workspaceNetteServicesGateway";
import { WorkspaceNettePresentersGateway } from "./application/workspaceNettePresentersGateway";
import { WorkspaceNetteRoutesGateway } from "./application/workspaceNetteRoutesGateway";
import { BrowserSettingsGateway } from "./infrastructure/browserSettingsGateway";
import { BrowserAgentAccountUsageStoreGateway } from "./infrastructure/browserAgentAccountUsageStoreGateway";
import { createAgentAccountUsageSources } from "./application/agentAccountUsageSources";
import { BrowserDirtyTextSearchGateway } from "./infrastructure/browserDirtyTextSearchGateway";
import { BrowserEditorChangeHunksGateway } from "./infrastructure/browserEditorChangeHunksGateway";
import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { TauriAgentRootLeaseGateway } from "./infrastructure/tauriAgentRootLeaseGateway";
import { TauriAgentCliDiscoveryGateway } from "./infrastructure/tauriAgentCliDiscoveryGateway";
import { TauriAgentTaskGateway } from "./infrastructure/tauriAgentTaskGateway";
import { TauriAgentThreadSessionGateway } from "./infrastructure/tauriAgentThreadSessionGateway";
import { resolveTauriWorkspaceHome } from "./infrastructure/tauriHomeDirectory";
import { TauriAgentTurnChangesGateway } from "./infrastructure/tauriAgentTurnChangesGateway";
import { BrowserAgentSidebarRailPreference } from "./infrastructure/browserAgentSidebarRailPreference";
import { TauriAgentQuestionGateway } from "./infrastructure/tauriAgentQuestionGateway";
import { TauriAgentInlineImageGateway } from "./infrastructure/tauriAgentInlineImageGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { TauriAgentProviderSignInGateway } from "./infrastructure/tauriAgentProviderSignInGateway";
import { TauriArtisanRoutesGateway } from "./infrastructure/tauriArtisanRoutesGateway";
import { TauriGitWorktreeGateway } from "./infrastructure/tauriGitWorktreeGateway";
import { TauriGitGateway, TauriGitHistoryGateway } from "./infrastructure/tauriGitGateway";
import { TauriIndexProgressGateway } from "./infrastructure/tauriIndexProgressGateway";
import { TauriIncrementalLanguageServerDocumentSyncGateway } from "./infrastructure/tauriIncrementalLanguageServerDocumentSyncGateway";
import { TauriJsTestGateway } from "./infrastructure/tauriJsTestGateway";
import { TauriJsTestCoverageGateway } from "./infrastructure/tauriJsTestCoverageGateway";
import { TauriJsTestWatchGateway } from "./infrastructure/tauriJsTestWatchGateway";
import {
  JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
  TauriLanguageServerDiagnosticsGateway,
} from "./infrastructure/tauriLanguageServerDiagnosticsGateway";
import {
  TauriLanguageServerDocumentSyncGateway,
  TauriSessionBoundLanguageServerDocumentSyncGateway,
} from "./infrastructure/tauriLanguageServerDocumentSyncGateway";
import {
  JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
  TauriLanguageServerFeaturesGateway,
} from "./infrastructure/tauriLanguageServerFeaturesGateway";
import { TauriLanguageServerGateway } from "./infrastructure/tauriLanguageServerGateway";
import {
  JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
  TauriLanguageServerRefreshGateway,
} from "./infrastructure/tauriLanguageServerRefreshGateway";
import {
  cancelJavaScriptTypeScriptLanguageServerRequest,
  JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
  TauriLanguageServerRuntimeGateway,
} from "./infrastructure/tauriLanguageServerRuntimeGateway";
import {
  JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
  TauriLanguageServerWorkspaceEditGateway,
} from "./infrastructure/tauriLanguageServerWorkspaceEditGateway";
import { TauriLocalHistoryGateway } from "./infrastructure/tauriLocalHistoryGateway";
import { TauriNodePackageScriptsGateway } from "./infrastructure/tauriNodePackageScriptsGateway";
import { TauriPackageOperationsGateway } from "./infrastructure/tauriPackageOperationsGateway";
import { TauriPhpFileOutlineGateway } from "./infrastructure/tauriPhpFileOutlineGateway";
import { TauriPhpSyntaxDiagnosticsGateway } from "./infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriPhpTestGateway } from "./infrastructure/tauriPhpTestGateway";
import { TauriPhpCloverCoveragePort } from "./infrastructure/tauriPhpCloverCoveragePort";
import { TauriPhpTreeGateway } from "./infrastructure/tauriPhpTreeGateway";
import { TauriProjectSymbolSearchGateway } from "./infrastructure/tauriProjectSymbolSearchGateway";
import { TauriRuntimeObservabilityGateway } from "./infrastructure/tauriRuntimeObservabilityGateway";
import { TauriSmartModeGateway } from "./infrastructure/tauriSmartModeGateway";
import { TauriSystemFontGateway } from "./infrastructure/tauriSystemFontGateway";
import { createTauriNativeWindow } from "./infrastructure/tauriNativeWindow";
import { TauriSymfonyWorkspaceIntelligenceGateway } from "./infrastructure/tauriSymfonyWorkspaceIntelligenceGateway";
import { TauriTerminalGateway } from "./infrastructure/tauriTerminalGateway";
import { TauriVscodeProcessTasksGateway } from "./infrastructure/tauriVscodeProcessTasksGateway";
import { TauriWorkspaceFileChangeGateway } from "./infrastructure/tauriWorkspaceFileChangeGateway";
import { TauriWorkspaceGateway } from "./infrastructure/tauriWorkspaceGateway";
import { TauriWorkspaceIdentityGateway } from "./infrastructure/tauriWorkspaceIdentityGateway";
import { TauriWorkspaceRuntimeLifecycleGateway } from "./infrastructure/tauriWorkspaceRuntimeLifecycleGateway";
import { TauriWorkspaceSourceDiscoveryGateway } from "./infrastructure/tauriWorkspaceSourceDiscoveryGateway";
import { TauriWorkspaceTestDiscoveryGateway } from "./infrastructure/tauriWorkspaceTestDiscoveryGateway";
import { TauriWorkspaceTrustGateway } from "./infrastructure/tauriWorkspaceTrustGateway";
import { TauriAppUpdaterGateway } from "./infrastructure/tauriAppUpdaterGateway";
import { SettingsAppUpdaterPreferencesGateway } from "./infrastructure/settingsAppUpdaterPreferencesGateway";
import { createAppUpdateCheck } from "./infrastructure/tauriAppUpdateCheck";
import { relaunch } from "@tauri-apps/plugin-process";
import { flushSessionRestore } from "./application/sessionRestorePersistence";
import { invoke } from "@tauri-apps/api/core";
import { purgeRemovedDebuggerStorage } from "./domain/removedDebuggerStorage";
import packageMetadata from "../package.json";

export const CODEVO_APP_VERSION = packageMetadata.version;

/**
 * Eager, process-wide adapters used by the desktop workbench composition root.
 * Keeping their construction here prevents the visual App shell from knowing
 * how PHP and JavaScript/TypeScript runtime variants are configured.
 */
export function createWorkbenchComposition() {
  const gitGateway = new TauriGitGateway();
  const gitHistoryGateway = new TauriGitHistoryGateway();
  const workspaceIdentityGateway = new TauriWorkspaceIdentityGateway();
  const workspaceGateway = new TauriWorkspaceGateway(workspaceIdentityGateway);
  const projectSymbolSearchGateway = new TauriProjectSymbolSearchGateway();
  const workspaceFileChangeGateway = new TauriWorkspaceFileChangeGateway();
  const quickInputCoordinator = new QuickInputCoordinator();
  const workspaceTrustPrompt = new WorkspaceTrustPromptCoordinator();
  const appUpdaterGateway = new TauriAppUpdaterGateway(
    {
      check: createAppUpdateCheck((command) => invoke(command)),
      relaunch: () => {
        flushSessionRestore();
        return relaunch();
      },
      getInstallMode: () => invoke("app_update_install_mode"),
    },
    CODEVO_APP_VERSION,
  );
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

  const agentControllerGateways = {
    agentCliDiscoveryGateway: new TauriAgentCliDiscoveryGateway(),
    agentQuestionGateway: new TauriAgentQuestionGateway(),
    agentInlineImageGateway: new TauriAgentInlineImageGateway(),
    agentProviderGateway,
    agentProviderSignInGateway: new TauriAgentProviderSignInGateway(),
    agentRootLeaseGateway: new TauriAgentRootLeaseGateway(),
    resolveWorkspaceHome: resolveTauriWorkspaceHome,
    agentSidebarRailPreference: new BrowserAgentSidebarRailPreference(),
    turnChangesGateway: new TauriAgentTurnChangesGateway(),
    agentTaskGateway: new TauriAgentTaskGateway(),
    agentThreadSessionGateway: new TauriAgentThreadSessionGateway(),
    gitWorktreeGateway: new TauriGitWorktreeGateway(),
  };

  return {
    ...agentControllerGateways,
    agentControllerGateways,
    htmlFilePreviewGateway: new TauriHtmlFilePreviewGateway(),
    appUpdater: {
      appUpdaterGateway,
      appUpdaterPreferencesGateway: new SettingsAppUpdaterPreferencesGateway(settingsGateway),
      appVersion: CODEVO_APP_VERSION,
    },
    cursorStore: new EditorCursorStore(),
    artisanRoutesGateway: new TauriArtisanRoutesGateway(),
    cancelJavaScriptTypeScriptLanguageServerRequest,
    dirtyCloseDecisionCoordinator: new DirtyCloseDecisionCoordinator(),
    editorChangeHunksGateway: new BrowserEditorChangeHunksGateway(),
    gitGateway,
    gitHistoryGateway,
    agentSurfaceGateways: {
      gitBranchGateway: gitGateway,
      gitHistoryGateway,
      fileChanges: workspaceFileChangeGateway,
      worktreeFileChanges: workspaceFileChangeGateway,
      fileSearch: workspaceGateway,
    },
    indexProgressGateway: new TauriIndexProgressGateway(),
    javaScriptTypeScriptLanguageServerDiagnosticsGateway: new TauriLanguageServerDiagnosticsGateway(
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
    ),
    javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway:
      new TauriIncrementalLanguageServerDocumentSyncGateway(),
    javaScriptTypeScriptLanguageServerDocumentSyncGateway:
      new TauriLanguageServerDocumentSyncGateway(),
    javaScriptTypeScriptLanguageServerFeaturesGateway: new TauriLanguageServerFeaturesGateway(
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    ),
    javaScriptTypeScriptLanguageServerRefreshGateway: new TauriLanguageServerRefreshGateway(
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
    ),
    javaScriptTypeScriptLanguageServerRuntimeGateway: new TauriLanguageServerRuntimeGateway(
      undefined,
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
    ),
    javaScriptTypeScriptLanguageServerWorkspaceEditGateway:
      new TauriLanguageServerWorkspaceEditGateway(
        undefined,
        undefined,
        JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
      ),
    jsTestGateway: new TauriJsTestGateway(),
    jsTestCoverageGateway: new TauriJsTestCoverageGateway(),
    jsTestWatchGateway: new TauriJsTestWatchGateway(),
    languageServerDiagnosticsGateway: new TauriLanguageServerDiagnosticsGateway(),
    languageServerDocumentSyncGateway: new TauriSessionBoundLanguageServerDocumentSyncGateway(),
    languageServerFeaturesGateway: new TauriLanguageServerFeaturesGateway(),
    languageServerGateway: new TauriLanguageServerGateway(),
    languageServerRefreshGateway: new TauriLanguageServerRefreshGateway(),
    languageServerRuntimeGateway: new TauriLanguageServerRuntimeGateway(),
    liveDocumentRuntime: new LiveDocumentRuntime(),
    localHistoryGateway: new TauriLocalHistoryGateway(),
    nodePackageScriptsGateway: new TauriNodePackageScriptsGateway(workspaceIdentityGateway),
    netteWorkspaceServicesGateway: new WorkspaceNetteServicesGateway(workspaceGateway),
    netteWorkspacePresentersGateway: new WorkspaceNettePresentersGateway(workspaceGateway),
    netteWorkspaceRoutesGateway: new WorkspaceNetteRoutesGateway(workspaceGateway),
    packageOperationsGateway: new TauriPackageOperationsGateway(),
    phpFileOutlineGateway: new TauriPhpFileOutlineGateway(),
    phpLanguageServerWorkspaceEditGateway: new TauriLanguageServerWorkspaceEditGateway(),
    phpSyntaxDiagnosticsGateway: new TauriPhpSyntaxDiagnosticsGateway(),
    phpCloverCoveragePort: new TauriPhpCloverCoveragePort(),
    phpTestGateway: new TauriPhpTestGateway(),
    phpTreeGateway: new TauriPhpTreeGateway(),
    runtimeObservabilityGateway: new TauriRuntimeObservabilityGateway(),
    quickInputCoordinator,
    workspaceTrustPrompt,
    settingsGateway,
    smartModeGateway: new TauriSmartModeGateway(),
    systemFontGateway: new TauriSystemFontGateway(),
    nativeWindow: createTauriNativeWindow(),
    symfonyWorkspaceIntelligenceGateway: new TauriSymfonyWorkspaceIntelligenceGateway(),
    terminalGateway: new TauriTerminalGateway(),
    textClipboard: new BrowserTextClipboardGateway(),
    vscodeProcessTasksGateway: new TauriVscodeProcessTasksGateway(),
    workbenchPrompter: new BrowserWorkbenchPrompter(quickInputCoordinator),
    workspaceGateways: {
      detection: workspaceGateway,
      dirtyTextSearch: new BrowserDirtyTextSearchGateway(),
      fileChanges: workspaceFileChangeGateway,
      fileSearch: workspaceGateway,
      files: workspaceGateway,
      identity: workspaceIdentityGateway,
      ownerFiles: workspaceGateway,
      phpTools: workspaceGateway,
      projectSymbols: projectSymbolSearchGateway,
      textSearch: workspaceGateway,
    },
    workspaceRuntimeLifecycleGateway: new TauriWorkspaceRuntimeLifecycleGateway(),
    workspaceSourceDiscoveryGateway: new TauriWorkspaceSourceDiscoveryGateway(
      workspaceIdentityGateway,
    ),
    workspaceTestDiscoveryGateway: new TauriWorkspaceTestDiscoveryGateway(workspaceIdentityGateway),
    workspaceTrustGateway: new ConfirmingWorkspaceTrustGateway(
      new TauriWorkspaceTrustGateway(),
      workspaceTrustPrompt,
    ),
  };
}

export type WorkbenchComposition = ReturnType<typeof createWorkbenchComposition>;

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

purgeRemovedDebuggerStorage(browserLocalStorage());

export const workbenchComposition = createWorkbenchComposition();
