import { DirtyCloseDecisionCoordinator } from "./application/dirtyCloseDecisionCoordinator";
import { WorkspaceNetteServicesGateway } from "./application/workspaceNetteServicesGateway";
import { WorkspaceNettePresentersGateway } from "./application/workspaceNettePresentersGateway";
import { WorkspaceNetteRoutesGateway } from "./application/workspaceNetteRoutesGateway";
import { BrowserSettingsGateway } from "./infrastructure/browserSettingsGateway";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { TauriArtisanRoutesGateway } from "./infrastructure/tauriArtisanRoutesGateway";
import { TauriDebugGateway } from "./infrastructure/tauriDebugGateway";
import { TauriGitGateway, TauriGitHistoryGateway } from "./infrastructure/tauriGitGateway";
import { TauriIndexProgressGateway } from "./infrastructure/tauriIndexProgressGateway";
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
  JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
  TauriLanguageServerRuntimeGateway,
} from "./infrastructure/tauriLanguageServerRuntimeGateway";
import {
  JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
  TauriLanguageServerWorkspaceEditGateway,
} from "./infrastructure/tauriLanguageServerWorkspaceEditGateway";
import { TauriLocalHistoryGateway } from "./infrastructure/tauriLocalHistoryGateway";
import { TauriNodeDebugAttachCandidateGateway } from "./infrastructure/tauriNodeDebugAttachCandidateGateway";
import { TauriNodeDebugAttachStartGateway } from "./infrastructure/tauriNodeDebugAttachStartGateway";
import { TauriNodePackageScriptsGateway } from "./infrastructure/tauriNodePackageScriptsGateway";
import { TauriNodeRunTaskGateway } from "./infrastructure/tauriNodeRunTaskGateway";
import { TauriPackageOperationsGateway } from "./infrastructure/tauriPackageOperationsGateway";
import { TauriPhpFileOutlineGateway } from "./infrastructure/tauriPhpFileOutlineGateway";
import { TauriPhpSyntaxDiagnosticsGateway } from "./infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriPhpTestGateway } from "./infrastructure/tauriPhpTestGateway";
import { TauriPhpCloverCoveragePort } from "./infrastructure/tauriPhpCloverCoveragePort";
import { TauriPhpTreeGateway } from "./infrastructure/tauriPhpTreeGateway";
import { TauriProjectSymbolSearchGateway } from "./infrastructure/tauriProjectSymbolSearchGateway";
import { TauriRuntimeObservabilityGateway } from "./infrastructure/tauriRuntimeObservabilityGateway";
import { TauriServerReadyExternalUrlOpener } from "./infrastructure/tauriServerReadyExternalUrlOpener";
import { TauriSmartModeGateway } from "./infrastructure/tauriSmartModeGateway";
import { TauriSystemFontGateway } from "./infrastructure/tauriSystemFontGateway";
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

/**
 * Eager, process-wide adapters used by the desktop workbench composition root.
 * Keeping their construction here prevents the visual App shell from knowing
 * how PHP and JavaScript/TypeScript runtime variants are configured.
 */
export function createWorkbenchComposition() {
  const workspaceIdentityGateway = new TauriWorkspaceIdentityGateway();
  const workspaceGateway = new TauriWorkspaceGateway(workspaceIdentityGateway);
  const projectSymbolSearchGateway = new TauriProjectSymbolSearchGateway();
  const workspaceFileChangeGateway = new TauriWorkspaceFileChangeGateway();

  return {
    artisanRoutesGateway: new TauriArtisanRoutesGateway(),
    debugGateway: new TauriDebugGateway(),
    dirtyCloseDecisionCoordinator: new DirtyCloseDecisionCoordinator(),
    gitGateway: new TauriGitGateway(),
    gitHistoryGateway: new TauriGitHistoryGateway(),
    indexProgressGateway: new TauriIndexProgressGateway(),
    javaScriptTypeScriptLanguageServerDiagnosticsGateway: new TauriLanguageServerDiagnosticsGateway(
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
    ),
    javaScriptTypeScriptLanguageServerDocumentSyncGateway:
      new TauriLanguageServerDocumentSyncGateway(),
    javaScriptTypeScriptLanguageServerFeaturesGateway: new TauriLanguageServerFeaturesGateway(
      undefined,
      undefined,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
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
    localHistoryGateway: new TauriLocalHistoryGateway(),
    nodeDebugAttachCandidateGateway: new TauriNodeDebugAttachCandidateGateway(),
    nodeDebugAttachCandidateStart: new TauriNodeDebugAttachStartGateway(),
    nodePackageScriptsGateway: new TauriNodePackageScriptsGateway(workspaceIdentityGateway),
    nodeRunTaskGateway: new TauriNodeRunTaskGateway(),
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
    serverReadyExternalUrlOpener: new TauriServerReadyExternalUrlOpener(),
    settingsGateway: new BrowserSettingsGateway(),
    smartModeGateway: new TauriSmartModeGateway(),
    systemFontGateway: new TauriSystemFontGateway(),
    symfonyWorkspaceIntelligenceGateway: new TauriSymfonyWorkspaceIntelligenceGateway(),
    terminalGateway: new TauriTerminalGateway(),
    vscodeProcessTasksGateway: new TauriVscodeProcessTasksGateway(),
    workbenchPrompter: new BrowserWorkbenchPrompter(),
    workspaceGateways: {
      detection: workspaceGateway,
      fileChanges: workspaceFileChangeGateway,
      fileSearch: workspaceGateway,
      files: workspaceGateway,
      identity: workspaceIdentityGateway,
      phpTools: workspaceGateway,
      projectSymbols: projectSymbolSearchGateway,
      textSearch: workspaceGateway,
    },
    workspaceRuntimeLifecycleGateway: new TauriWorkspaceRuntimeLifecycleGateway(),
    workspaceSourceDiscoveryGateway: new TauriWorkspaceSourceDiscoveryGateway(
      workspaceIdentityGateway,
    ),
    workspaceTestDiscoveryGateway: new TauriWorkspaceTestDiscoveryGateway(workspaceIdentityGateway),
    workspaceTrustGateway: new TauriWorkspaceTrustGateway(),
  };
}

export type WorkbenchComposition = ReturnType<typeof createWorkbenchComposition>;

export const workbenchComposition = createWorkbenchComposition();
