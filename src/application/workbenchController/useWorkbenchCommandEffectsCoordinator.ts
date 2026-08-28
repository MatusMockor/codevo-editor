import { useCallback, useEffect } from "react";
import { createDiagnosticsCoalescer } from "../../domain/diagnosticsCoalescer";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { executeCommandAndReport, type CommandExecutionRunner } from "../commandRegistry";
import { createJsTestRerunLastRunCommands } from "../workbenchDebugControllerOptions";
import { useFloatingSurfaces } from "../useFloatingSurfaces";
import { useWorkbenchCommandRegistry } from "../useWorkbenchCommandRegistry";
import { useWorkbenchSearchEverywhere } from "../useWorkbenchSearchEverywhere";
import { useQuickOpenPrefixDestinations } from "../useQuickOpenPrefixDispatch";
import {
  useWorkbenchKeyboardShortcutActions,
  useWorkbenchKeyboardShortcuts,
} from "../useWorkbenchKeyboardShortcuts";
import { useWorkbenchNativeMenuCommands } from "../useWorkbenchNativeMenuCommands";
import { useWorkbenchPintCommand } from "../useWorkbenchPintCommand";
import { useWorkbenchSidebarDataRefresh } from "../useWorkbenchSidebarDataRefresh";
import {
  useFlushWorkspaceNavigationSessionOnBlur,
  usePersistWorkspaceNavigationSession,
} from "../useWorkbenchNavigationSessionPersistence";
import { useInitialAppSettingsHydration } from "./useInitialAppSettingsHydration";
import {
  useManagedLanguageServerInstallCommands,
  useManagedLanguageServerInstallSubscriptions,
} from "./useManagedLanguageServerInstallLifecycle";
import { useWorkbenchDiagnosticPresentation } from "./useWorkbenchDiagnosticPresentation";
import { useWorkbenchDocumentSaveCloseCoordinator } from "./useWorkbenchDocumentSaveCloseCoordinator";
import { useWorkbenchEditorNavigationCoordinator } from "./useWorkbenchEditorNavigationCoordinator";
import { useWorkbenchLanguageRuntimeEffects } from "./useWorkbenchLanguageRuntimeCoordinator";
import { useWorkbenchLanguageRuntimeSubscriptionsCoordinator } from "./useWorkbenchLanguageRuntimeSubscriptionsCoordinator";
import { useWorkbenchSettingsCommands } from "./useWorkbenchSettingsCommands";
import { useWorkbenchWorkspaceFileChangeSubscription } from "./useWorkspaceFileChangeSubscription";

type FlatCommandEffectsDependencies = Pick<
  Omit<Parameters<typeof useWorkbenchSettingsCommands>[0], "setSmartMode">,
  | "appSettingsRef"
  | "applyJavaScriptTypeScriptSettingsChange"
  | "autoStartedLanguageServerRootRef"
  | "clearWorkspaceIndex"
  | "currentWorkspaceRootRef"
  | "intelligenceMode"
  | "intelligenceModeRef"
  | "javaScriptTypeScriptTrustAutostartRef"
  | "openWorkspaceRequestTokenRef"
  | "persistAppSettings"
  | "persistWorkspaceSettings"
  | "phpLanguageServerAutostartAttemptsByRootRef"
  | "refreshJavaScriptTypeScriptPlanAfterTrustGrant"
  | "refreshLanguageServerPlan"
  | "reportErrorForActiveWorkspaceRoot"
  | "resolveCurrentWorkspaceRuntimeOwner"
  | "runGitRepositoryDiscovery"
  | "runPhpWorkspaceProbe"
  | "setIntelligenceMode"
  | "setMessage"
  | "setWorkspaceTrust"
  | "smartModeGateway"
  | "smartModeRequestGenerationRef"
  | "smartModeRequestIntentRef"
  | "startInitialIndexScan"
  | "stopBackgroundProjectRuntimes"
  | "stopLanguageServerRuntime"
  | "stopProjectLanguageServersAfterTrustRevocation"
  | "workspaceCloseGenerationByRootRef"
  | "workspaceDescriptor"
  | "workspaceIdentityDescriptor"
  | "workspaceRoot"
  | "workspaceRuntimeOwnerClaimsRef"
  | "workspaceRuntimeOwnerRef"
  | "workspaceSettingsRef"
  | "workspaceTrust"
  | "workspaceTrustGateway"
  | "workspaceTrustIntentCoordinatorRef"
  | "workspaceTrustRevisionByOwnerRef"
> &
  Pick<
    Omit<
      Parameters<typeof useManagedLanguageServerInstallCommands>[0],
      "currentWorkspaceIdentityDescriptorRef"
    >,
    | "currentWorkspaceRootRef"
    | "installingManagedPhpactor"
    | "installingManagedTypeScriptLanguageServer"
    | "phpToolGateway"
    | "refreshJavaScriptTypeScriptLanguageServerPlan"
    | "refreshLanguageServerPlan"
    | "reportJavaScriptTypeScriptLanguageServerError"
    | "reportLanguageServerError"
    | "setInstallingManagedPhpactor"
    | "setInstallingManagedTypeScriptLanguageServer"
    | "setLanguageServerSetupOpen"
    | "setMessage"
    | "setNotices"
    | "setPhpTools"
    | "workspaceDescriptor"
    | "workspaceIdentityDescriptor"
    | "workspaceRoot"
  > &
  Pick<
    Omit<Parameters<typeof useWorkbenchPintCommand>[0], "gateway">,
    "activeDocument" | "currentWorkspaceRootRef" | "setMessage" | "workspaceRoot"
  > &
  Pick<
    Parameters<typeof useFloatingSurfaces>[0],
    | "callHierarchyView"
    | "classOpenOpen"
    | "closeGitDiffPreview"
    | "fileStructureOpen"
    | "gitDiffLoading"
    | "implementationChooser"
    | "languageServerSetupOpen"
    | "paletteOpen"
    | "quickOpenOpen"
    | "recentFilesSwitcherOpen"
    | "recentLocationsPanelOpen"
    | "referencesView"
    | "resetSearchEverywhere"
    | "searchEverywhereOpen"
    | "selectedGitChange"
    | "setCallHierarchyView"
    | "setClassOpenOpen"
    | "setFileStructureOpen"
    | "setImplementationChooser"
    | "setLanguageServerSetupOpen"
    | "setPaletteOpen"
    | "setQuickOpenOpen"
    | "setRecentFilesSwitcherOpen"
    | "setRecentLocationsPanelOpen"
    | "setReferencesView"
    | "setSearchEverywhereOpen"
    | "setSettingsInitialSection"
    | "setSettingsOpen"
    | "setTextSearchOpen"
    | "setTypeHierarchyView"
    | "setWorkspaceSymbolsOpen"
    | "settingsOpen"
    | "typeHierarchyView"
    | "workspaceSymbolsOpen"
  > &
  Pick<
    Omit<
      Parameters<typeof useWorkbenchCommandRegistry>[0],
      | "attachNodeDebug"
      | "canRewordSelectedGitCommit"
      | "canShowNette"
      | "canShowSymfony"
      | "captureNavigationCommandScope"
      | "cherryPickSelectedGitCommit"
      | "closeActiveEditorGroup"
      | "closeActiveEditorGroupSurface"
      | "closeDocument"
      | "configureNodeLaunchConfigurations"
      | "createDirectory"
      | "createFile"
      | "createGitBranch"
      | "debugBreakpointNavigation"
      | "debugCallStackNavigation"
      | "debugCopyStackTrace"
      | "debugEvaluateInConsole"
      | "debugInlineBreakpoint"
      | "debugRestartFrame"
      | "debugState"
      | "debugWatchAtCursor"
      | "deleteActiveDocument"
      | "formatActiveFileWithPint"
      | "formatChangedFilesWithPint"
      | "generateTestForActiveDocument"
      | "goToDeclaration"
      | "goToDefinition"
      | "goToImplementation"
      | "goToNextBookmark"
      | "goToNextProblem"
      | "goToPreviousBookmark"
      | "goToPreviousProblem"
      | "goToSourceDefinition"
      | "goToSuperMethod"
      | "goToTestForActiveDocument"
      | "goToTypeDefinition"
      | "installManagedPhpactor"
      | "isNavigationCommandScopeCurrent"
      | "jsTestDebugAtCursor"
      | "jsTestRerunLastRun"
      | "jsTestRunSelection"
      | "navigateBackward"
      | "navigateForwardInHistory"
      | "nodePackageScriptsWorkbench"
      | "nodeRunWithoutDebugging"
      | "openAppearanceSettingsPanel"
      | "openArtisanRoutesPanel"
      | "openDebugPanel"
      | "openExpressRoutesPanel"
      | "openFileHistory"
      | "openGitBranchPanel"
      | "openGitStashPanel"
      | "openJsTestResultsPanel"
      | "openLocalHistory"
      | "openMarkdownPreview"
      | "openPhpTestResultsPanel"
      | "openSearchEverywhere"
      | "openSettingsPanel"
      | "openWorkspaceSymbols"
      | "pauseDebug"
      | "pintRunning"
      | "refreshWorkspaceTodos"
      | "renameActiveDocument"
      | "reopenClosedDocument"
      | "revertSelectedGitCommit"
      | "rewordSelectedGitCommit"
      | "runAllJsTestsForActiveDocument"
      | "runAllTestsForActiveDocument"
      | "runInActiveTerminal"
      | "runJsTestForActiveDocument"
      | "runTestForActiveDocument"
      | "showBottomPanelView"
      | "startOrContinueDebug"
      | "startPhpListenDebug"
      | "stepDebug"
      | "stopDebug"
      | "toggleBookmarkAtCursor"
      | "toggleBookmarksPanel"
      | "toggleBottomPanel"
      | "toggleDebugBreakpointAtCursor"
      | "toggleGitBlame"
      | "toggleSmartMode"
      | "toggleTodoPanel"
      | "toggleWorkspaceTrust"
      | "vscodeProcessTasksWorkbench"
    >,
    | "activateWorkspaceTab"
    | "activeDocument"
    | "activeEslintBufferClean"
    | "activeEslintFixes"
    | "activeImage"
    | "activeMarkdownPreview"
    | "activePackageScripts"
    | "activePhpstanBufferClean"
    | "agents"
    | "appSettings"
    | "canReopenClosedDocument"
    | "canSearchClassOpenSymbols"
    | "commitGitChanges"
    | "disableEslintRuleAtCursor"
    | "editorGroups"
    | "editorMenuCommandRunner"
    | "editorSurfaceCommandRunner"
    | "eslintAnalysisRunning"
    | "fixAllEslintInActiveFile"
    | "focusAdjacentEditorGroup"
    | "gitDiffLoading"
    | "hasEslintDiagnosticAtCursor"
    | "hasPhpstanDiagnosticAtCursor"
    | "ignorePhpstanIssueAtCursor"
    | "indexProgress"
    | "installingManagedPhpactor"
    | "intelligenceMode"
    | "isActiveDocumentJsTest"
    | "isActiveDocumentPhpTest"
    | "isLanguageServerActiveForWorkspace"
    | "javaScriptTypeScriptLanguageServerRuntimeStatus"
    | "javaScriptTypeScriptLanguageServerRuntimeStatusRoot"
    | "languageServerPlan"
    | "languageServerRuntimeStatus"
    | "languageServerRuntimeStatusRoot"
    | "markFloatingSurfaceActivated"
    | "moveActiveTabToAdjacentGroup"
    | "navigationHistory"
    | "openArtisanMakePalette"
    | "openCallHierarchy"
    | "openDocuments"
    | "openFileReferencesPanel"
    | "openFileStructure"
    | "openRecentFilesSwitcher"
    | "openRecentLocationsPanel"
    | "openReferencesPanel"
    | "openTypeHierarchy"
    | "openWorkspace"
    | "openWorkspacePath"
    | "phpTools"
    | "phpstanAnalysisRunning"
    | "quitApplication"
    | "refreshGitStatus"
    | "refreshPhpTree"
    | "refreshWorkspace"
    | "resetEditorFontSize"
    | "runEslintAnalysis"
    | "runPhpstanAnalysis"
    | "saveActiveDocument"
    | "selectedGitChange"
    | "setClassOpenOpen"
    | "setLanguageServerSetupOpen"
    | "setPaletteOpen"
    | "setQuickOpenOpen"
    | "setRecentFilesSwitcherOpen"
    | "setSidebarView"
    | "setTextSearchOpen"
    | "setWorkspaceSymbolsOpen"
    | "splitActiveEditorGroup"
    | "startHardReindex"
    | "startIndexScan"
    | "startLanguageServer"
    | "startPhpReindex"
    | "stopLanguageServer"
    | "toggleEditorFontLigatures"
    | "workspaceDescriptor"
    | "workspaceRoot"
    | "workspaceTrust"
    | "zoomEditorFontIn"
    | "zoomEditorFontOut"
  > &
  Pick<
    Omit<Parameters<typeof useWorkbenchNativeMenuCommands>[0], "commandContext" | "runCommand">,
    "reportError"
  > &
  Pick<
    Parameters<typeof useWorkbenchSidebarDataRefresh>[0],
    "indexProgress" | "refreshGitStatus" | "refreshPhpTree" | "sidebarView" | "workspaceRoot"
  > &
  Pick<
    Omit<
      Parameters<typeof useWorkbenchKeyboardShortcuts>[0],
      | "actions"
      | "commandContext"
      | "commandRegistry"
      | "editorSurfaceIdentity"
      | "keymap"
      | "runCommand"
    >,
    "appSettingsRef" | "bareKeyShortcutsRef" | "doubleShiftDetectorRef"
  > &
  Pick<
    Parameters<typeof usePersistWorkspaceNavigationSession>[0],
    | "bottomPanelView"
    | "documents"
    | "editorGroups"
    | "editorSessionOwnerKeyForRoot"
    | "persistWorkspaceSettings"
    | "reportErrorForActiveWorkspaceRoot"
    | "sidebarView"
    | "snapshotPersistedWorkspaceSession"
    | "workspaceEditorViewStatesRef"
    | "workspaceRoot"
    | "workspaceSessionRestoredRef"
    | "workspaceSettingsRef"
    | "workspaceSettingsSaveCoordinator"
  > &
  Pick<
    Omit<Parameters<typeof useInitialAppSettingsHydration>[0], "onAppSettingsHydrated">,
    | "applyAppSettings"
    | "beginStartupRestore"
    | "hasRestoredRef"
    | "reportError"
    | "settingsGateway"
  > &
  Pick<
    Omit<
      Parameters<typeof useWorkbenchWorkspaceFileChangeSubscription>[0],
      "gateway" | "handleWorkspaceFileChange"
    >,
    | "currentWorkspaceRootRef"
    | "externallyRemovedDocumentRootByPathRef"
    | "handleExternalFileChange"
    | "handleWorkspaceDiscoveryFileChange"
    | "markExternallyRemovedDocumentPath"
    | "refreshEditorConfigRoot"
    | "reportError"
    | "setMessage"
    | "workspaceRoot"
  > &
  Pick<
    Omit<
      Parameters<typeof useManagedLanguageServerInstallSubscriptions>[0],
      "handleManagedPhpactorInstallCompletion" | "handleManagedTypeScriptInstallCompletion"
    >,
    "phpToolGateway" | "reportError"
  > &
  Pick<
    Omit<
      Parameters<typeof useWorkbenchLanguageRuntimeSubscriptionsCoordinator>[0],
      "createDiagnosticsCoalescer"
    >,
    | "applyJavaScriptTypeScriptLanguageServerDiagnostics"
    | "applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch"
    | "applyLanguageServerDiagnostics"
    | "applyLanguageServerDiagnosticsBatch"
    | "currentWorkspaceRootRef"
    | "diagnosticsFlushSchedulerRef"
    | "javaScriptTypeScriptDiagnosticsCoalescerRef"
    | "javaScriptTypeScriptLanguageServerDiagnosticsGateway"
    | "languageServerDiagnosticsCoalescerRef"
    | "languageServerDiagnosticsGateway"
    | "reportJavaScriptTypeScriptLanguageServerError"
    | "reportLanguageServerError"
    | "resolveCurrentWorkspaceRuntimeOwner"
    | "resolveWorkspaceRuntimeOwnerForDiagnosticsEvent"
    | "workspaceRoot"
    | "workspaceRuntimeOwner"
  > &
  Pick<
    Omit<
      Parameters<typeof useWorkbenchLanguageRuntimeEffects>[0],
      "changedDocumentSync" | "javaScriptTypeScript" | "php" | "runtimeOwner"
    >,
    | "activePath"
    | "documentsRef"
    | "openDocumentPaths"
    | "workspaceRoot"
    | "workspaceRuntimeOwnerClaimsRef"
  > &
  Pick<
    Parameters<typeof useWorkbenchDiagnosticPresentation>[0],
    | "activeDocument"
    | "fileStructureScope"
    | "frameworkDiagnosticsByPath"
    | "isExternallyRemovedDocumentPath"
    | "javaScriptTypeScriptDiagnosticsByPath"
    | "javaScriptTypeScriptFileStructureLoadingForDocument"
    | "javaScriptTypeScriptFileStructureOutlineForDocument"
    | "languageServerDiagnosticsByPath"
    | "loadingInheritedPhpFileOutlinePaths"
    | "loadingPhpFileOutlinePaths"
    | "notices"
    | "phpFileOutlinesByPath"
    | "phpInheritedFileOutlinesByPath"
    | "phpLocalDiagnosticsByPath"
  > &
  CommandEffectsCompositionDependencies;

type CommandRegistryDependencies = Parameters<typeof useWorkbenchCommandRegistry>[0];
type EditorNavigation = ReturnType<typeof useWorkbenchEditorNavigationCoordinator>;
type RuntimeEffectsDependencies = Parameters<typeof useWorkbenchLanguageRuntimeEffects>[0];
type SearchEverywhere = ReturnType<typeof useWorkbenchSearchEverywhere>;

interface CommandEffectsCompositionDependencies {
  readonly agents: CommandRegistryDependencies["agents"] & {
    readonly markAppSettingsHydrated: Parameters<
      typeof useInitialAppSettingsHydration
    >[0]["onAppSettingsHydrated"];
  };
  readonly bookmarkActions: EditorNavigation["bookmarks"];
  readonly documentSaveClose: ReturnType<typeof useWorkbenchDocumentSaveCloseCoordinator>;
  readonly documentSyncRuntimeSignatureRef: RuntimeEffectsDependencies["php"]["documentSyncRuntimeSignatureRef"];
  readonly editorDocument: EditorNavigation["editorDocument"];
  readonly expandedPhpFilePaths: ReadonlySet<string>;
  readonly fileOperations: EditorNavigation["fileOperations"];
  readonly frameworkIntelligence: EditorNavigation["frameworkIntelligence"];
  readonly gitHistory: EditorNavigation["gitHistory"];
  readonly gitPanels: EditorNavigation["gitPanels"];
  readonly hasNetteApplicationFramework: boolean;
  readonly hasSymfonyFramework: boolean;
  readonly isDocumentSessionLifecycleAuthorityCurrent: RuntimeEffectsDependencies["changedDocumentSync"]["isDocumentSessionLifecycleAuthorityCurrent"];
  readonly javaScriptTypeScriptDocumentSyncRuntimeSignatureRef: RuntimeEffectsDependencies["javaScriptTypeScript"]["documentSyncRuntimeSignatureRef"];
  readonly javaScriptTypeScriptIncrementalSyncRef: RuntimeEffectsDependencies["changedDocumentSync"]["incrementalSyncRef"];
  readonly jsTestExplorerScopeRunner: Parameters<typeof createJsTestRerunLastRunCommands>[0];
  readonly languageNavigation: EditorNavigation["languageNavigation"];
  readonly lastPhpFileOutlineRefreshKeyRef: { current: string | null };
  readonly loadPhpFileOutline: (path: string) => Promise<void>;
  readonly localHistory: EditorNavigation["localHistory"];
  readonly navigationHistoryActions: EditorNavigation["navigationHistory"];
  readonly openCommandPaletteWithInitialQuery: Parameters<typeof useQuickOpenPrefixDestinations>[4];
  readonly openFileStructureWithInitialQuery: Parameters<typeof useQuickOpenPrefixDestinations>[1];
  readonly persistCurrentWorkspaceSession: Parameters<
    typeof useFlushWorkspaceNavigationSessionOnBlur
  >[0];
  readonly pintGateway: Parameters<typeof useWorkbenchPintCommand>[0]["gateway"];
  readonly quickOpenPrefixDispatch: Parameters<typeof useQuickOpenPrefixDestinations>[0];
  readonly resetJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null,
    owner?: NonNullable<RuntimeEffectsDependencies["runtimeOwner"]>,
  ) => void;
  readonly resetJavaScriptTypeScriptLanguageServerDocuments: RuntimeEffectsDependencies["javaScriptTypeScript"]["resetLanguageServerDocuments"];
  readonly resetLanguageServerDocuments: RuntimeEffectsDependencies["php"]["resetLanguageServerDocuments"];
  readonly resolveDocumentSessionLifecycleAuthority: RuntimeEffectsDependencies["changedDocumentSync"]["resolveDocumentSessionLifecycleAuthority"];
  readonly runCloseActiveEditorGroup: CommandRegistryDependencies["closeActiveEditorGroup"];
  readonly runCloseActiveEditorGroupSurface: CommandRegistryDependencies["closeActiveEditorGroupSurface"];
  readonly runCloseDocument: CommandRegistryDependencies["closeDocument"];
  readonly scheduleDocumentChange: RuntimeEffectsDependencies["changedDocumentSync"]["scheduleDocumentChange"];
  readonly scheduleJavaScriptTypeScriptDocumentChange: RuntimeEffectsDependencies["changedDocumentSync"]["scheduleJavaScriptTypeScriptDocumentChange"];
  readonly searchEverywhereModelFor: SearchEverywhere["searchEverywhereModelFor"];
  readonly setWorkspaceSymbolsQuery: Parameters<typeof useQuickOpenPrefixDestinations>[2];
  readonly smartModeActions: EditorNavigation["smartMode"];
  readonly subscribeChangedDocuments: RuntimeEffectsDependencies["changedDocumentSync"]["subscribeChangedDocuments"];
  readonly syncOpenDocument: RuntimeEffectsDependencies["php"]["syncOpenDocument"];
  readonly syncOpenJavaScriptTypeScriptDocument: RuntimeEffectsDependencies["javaScriptTypeScript"]["syncOpenDocument"];
  readonly taskDebug: EditorNavigation["taskDebug"];
  readonly taskDebugNavigation: EditorNavigation["taskDebugNavigation"];
  readonly todos: EditorNavigation["todos"];
  readonly workspaceFileChangeGateway: Parameters<
    typeof useWorkbenchWorkspaceFileChangeSubscription
  >[0]["gateway"];
  readonly workspaceIdentityDescriptorRef: RuntimeEffectsDependencies["changedDocumentSync"]["workspaceIdentityDescriptorRef"];
  readonly workspaceRuntimeOwner: RuntimeEffectsDependencies["runtimeOwner"];
  readonly workspaceSettings: Parameters<
    typeof useWorkbenchSettingsCommands
  >[0]["workspaceSettingsRef"]["current"];
}

type GroupedCommandEffectsDependency =
  | "activeDocument"
  | "activeImage"
  | "activeMarkdownPreview"
  | "activePath"
  | "documents"
  | "documentsRef"
  | "editorGroups"
  | "openDocumentPaths"
  | "openDocuments"
  | "workspaceRoot"
  | "workspaceDescriptor"
  | "workspaceIdentityDescriptor"
  | "workspaceIdentityDescriptorRef"
  | "currentWorkspaceRootRef"
  | "workspaceRuntimeOwner"
  | "workspaceRuntimeOwnerRef"
  | "workspaceRuntimeOwnerClaimsRef"
  | "workspaceTrust"
  | "workspaceTrustGateway"
  | "workspaceTrustIntentCoordinatorRef"
  | "workspaceTrustRevisionByOwnerRef"
  | "workspaceSettings"
  | "workspaceSettingsRef"
  | "workspaceSettingsSaveCoordinator"
  | "workspaceEditorViewStatesRef"
  | "appSettings"
  | "appSettingsRef"
  | "applyAppSettings"
  | "persistAppSettings"
  | "persistWorkspaceSettings"
  | "settingsGateway"
  | "hasRestoredRef"
  | "beginStartupRestore"
  | "javaScriptTypeScriptDiagnosticsByPath"
  | "languageServerDiagnosticsByPath"
  | "frameworkDiagnosticsByPath"
  | "phpLocalDiagnosticsByPath"
  | "diagnosticsFlushSchedulerRef"
  | "languageServerDiagnosticsCoalescerRef"
  | "javaScriptTypeScriptDiagnosticsCoalescerRef"
  | "languageServerDiagnosticsGateway"
  | "javaScriptTypeScriptLanguageServerDiagnosticsGateway"
  | "reportLanguageServerError"
  | "reportJavaScriptTypeScriptLanguageServerError"
  | "paletteOpen"
  | "quickOpenOpen"
  | "classOpenOpen"
  | "workspaceSymbolsOpen"
  | "searchEverywhereOpen"
  | "fileStructureOpen"
  | "recentFilesSwitcherOpen"
  | "recentLocationsPanelOpen"
  | "callHierarchyView"
  | "typeHierarchyView"
  | "referencesView"
  | "implementationChooser"
  | "setPaletteOpen"
  | "setQuickOpenOpen"
  | "setClassOpenOpen"
  | "setWorkspaceSymbolsOpen"
  | "setSearchEverywhereOpen"
  | "setFileStructureOpen"
  | "setRecentFilesSwitcherOpen"
  | "setRecentLocationsPanelOpen"
  | "setCallHierarchyView"
  | "setTypeHierarchyView"
  | "setReferencesView"
  | "setImplementationChooser"
  | "expandedPhpFilePaths"
  | "loadingInheritedPhpFileOutlinePaths"
  | "loadingPhpFileOutlinePaths"
  | "phpFileOutlinesByPath"
  | "phpInheritedFileOutlinesByPath"
  | "languageServerPlan"
  | "languageServerRuntimeStatus"
  | "languageServerRuntimeStatusRoot"
  | "javaScriptTypeScriptLanguageServerRuntimeStatus"
  | "javaScriptTypeScriptLanguageServerRuntimeStatusRoot"
  | "installingManagedPhpactor"
  | "installingManagedTypeScriptLanguageServer"
  | "phpToolGateway"
  | "phpTools"
  | "bottomPanelView"
  | "sidebarView"
  | "snapshotPersistedWorkspaceSession"
  | "persistCurrentWorkspaceSession"
  | "documentSyncRuntimeSignatureRef"
  | "javaScriptTypeScriptDocumentSyncRuntimeSignatureRef"
  | "javaScriptTypeScriptIncrementalSyncRef"
  | "syncOpenDocument"
  | "syncOpenJavaScriptTypeScriptDocument"
  | "activateWorkspaceTab"
  | "activeEslintBufferClean"
  | "activeEslintFixes"
  | "activePackageScripts"
  | "activePhpstanBufferClean"
  | "agents"
  | "applyJavaScriptTypeScriptLanguageServerDiagnostics"
  | "applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch"
  | "applyJavaScriptTypeScriptSettingsChange"
  | "applyLanguageServerDiagnostics"
  | "applyLanguageServerDiagnosticsBatch"
  | "autoStartedLanguageServerRootRef"
  | "bareKeyShortcutsRef"
  | "bookmarkActions"
  | "canReopenClosedDocument"
  | "canSearchClassOpenSymbols"
  | "clearWorkspaceIndex"
  | "closeGitDiffPreview"
  | "commitGitChanges"
  | "disableEslintRuleAtCursor"
  | "documentSaveClose"
  | "doubleShiftDetectorRef"
  | "editorDocument"
  | "editorSessionOwnerKeyForRoot"
  | "editorSurfaceCommandRunner"
  | "eslintAnalysisRunning"
  | "externallyRemovedDocumentRootByPathRef"
  | "fileOperations"
  | "fileStructureScope"
  | "fixAllEslintInActiveFile"
  | "focusAdjacentEditorGroup"
  | "frameworkIntelligence"
  | "gitDiffLoading"
  | "gitHistory"
  | "gitPanels"
  | "handleExternalFileChange"
  | "handleWorkspaceDiscoveryFileChange"
  | "hasEslintDiagnosticAtCursor"
  | "hasNetteApplicationFramework"
  | "hasPhpstanDiagnosticAtCursor"
  | "hasSymfonyFramework"
  | "ignorePhpstanIssueAtCursor"
  | "indexProgress"
  | "intelligenceMode"
  | "intelligenceModeRef"
  | "isActiveDocumentJsTest"
  | "isActiveDocumentPhpTest"
  | "isDocumentSessionLifecycleAuthorityCurrent"
  | "isExternallyRemovedDocumentPath"
  | "isLanguageServerActiveForWorkspace"
  | "javaScriptTypeScriptFileStructureLoadingForDocument"
  | "javaScriptTypeScriptFileStructureOutlineForDocument"
  | "javaScriptTypeScriptTrustAutostartRef"
  | "jsTestExplorerScopeRunner"
  | "languageNavigation"
  | "languageServerSetupOpen"
  | "lastPhpFileOutlineRefreshKeyRef"
  | "loadPhpFileOutline"
  | "localHistory"
  | "markExternallyRemovedDocumentPath"
  | "markFloatingSurfaceActivated"
  | "moveActiveTabToAdjacentGroup"
  | "navigationHistory"
  | "navigationHistoryActions"
  | "notices"
  | "openArtisanMakePalette"
  | "openCallHierarchy"
  | "openCommandPaletteWithInitialQuery"
  | "openFileReferencesPanel"
  | "openFileStructure"
  | "openFileStructureWithInitialQuery"
  | "openRecentFilesSwitcher"
  | "openRecentLocationsPanel"
  | "openReferencesPanel"
  | "openTypeHierarchy"
  | "openWorkspace"
  | "openWorkspacePath"
  | "openWorkspaceRequestTokenRef"
  | "phpLanguageServerAutostartAttemptsByRootRef"
  | "phpstanAnalysisRunning"
  | "pintGateway"
  | "quickOpenPrefixDispatch"
  | "quitApplication"
  | "refreshEditorConfigRoot"
  | "refreshGitStatus"
  | "refreshJavaScriptTypeScriptLanguageServerPlan"
  | "refreshJavaScriptTypeScriptPlanAfterTrustGrant"
  | "refreshLanguageServerPlan"
  | "refreshPhpTree"
  | "refreshWorkspace"
  | "reportError"
  | "reportErrorForActiveWorkspaceRoot"
  | "resetEditorFontSize"
  | "resetJavaScriptTypeScriptDiagnosticsForRoot"
  | "resetJavaScriptTypeScriptLanguageServerDocuments"
  | "resetLanguageServerDocuments"
  | "resetSearchEverywhere"
  | "resolveCurrentWorkspaceRuntimeOwner"
  | "resolveDocumentSessionLifecycleAuthority"
  | "resolveWorkspaceRuntimeOwnerForDiagnosticsEvent"
  | "runCloseActiveEditorGroup"
  | "runCloseActiveEditorGroupSurface"
  | "runCloseDocument"
  | "runEslintAnalysis"
  | "runGitRepositoryDiscovery"
  | "runPhpWorkspaceProbe"
  | "runPhpstanAnalysis"
  | "saveActiveDocument"
  | "scheduleDocumentChange"
  | "scheduleJavaScriptTypeScriptDocumentChange"
  | "searchEverywhereModelFor"
  | "selectedGitChange"
  | "setInstallingManagedPhpactor"
  | "setInstallingManagedTypeScriptLanguageServer"
  | "setIntelligenceMode"
  | "setLanguageServerSetupOpen"
  | "setMessage"
  | "setNotices"
  | "setPhpTools"
  | "setSettingsInitialSection"
  | "setSettingsOpen"
  | "setSidebarView"
  | "setTextSearchOpen"
  | "setWorkspaceSymbolsQuery"
  | "setWorkspaceTrust"
  | "settingsOpen"
  | "smartModeActions"
  | "smartModeGateway"
  | "smartModeRequestGenerationRef"
  | "smartModeRequestIntentRef"
  | "splitActiveEditorGroup"
  | "startHardReindex"
  | "startIndexScan"
  | "startInitialIndexScan"
  | "startLanguageServer"
  | "startPhpReindex"
  | "stopBackgroundProjectRuntimes"
  | "stopLanguageServer"
  | "stopLanguageServerRuntime"
  | "stopProjectLanguageServersAfterTrustRevocation"
  | "subscribeChangedDocuments"
  | "taskDebug"
  | "taskDebugNavigation"
  | "todos"
  | "toggleEditorFontLigatures"
  | "workspaceCloseGenerationByRootRef"
  | "workspaceFileChangeGateway"
  | "workspaceSessionRestoredRef"
  | "zoomEditorFontIn"
  | "zoomEditorFontOut"
  | "editorMenuCommandRunner";

type CommandEffectsFacet<K extends GroupedCommandEffectsDependency> = Pick<
  FlatCommandEffectsDependencies,
  K
>;
interface CommandEffectsDependencies extends Omit<
  FlatCommandEffectsDependencies,
  GroupedCommandEffectsDependency
> {
  readonly editorDocumentState: CommandEffectsFacet<
    "activeDocument" | "activeImage" | "activeMarkdownPreview" | "activePath"
  >;
  readonly editorSessionState: CommandEffectsFacet<
    "documents" | "documentsRef" | "editorGroups" | "openDocumentPaths" | "openDocuments"
  >;
  readonly workspaceIdentity: CommandEffectsFacet<
    | "workspaceRoot"
    | "workspaceDescriptor"
    | "workspaceIdentityDescriptor"
    | "workspaceIdentityDescriptorRef"
  >;
  readonly workspaceAuthority: CommandEffectsFacet<
    | "currentWorkspaceRootRef"
    | "workspaceRuntimeOwner"
    | "workspaceRuntimeOwnerRef"
    | "workspaceRuntimeOwnerClaimsRef"
  >;
  readonly workspaceTrustState: CommandEffectsFacet<
    | "workspaceTrust"
    | "workspaceTrustGateway"
    | "workspaceTrustIntentCoordinatorRef"
    | "workspaceTrustRevisionByOwnerRef"
  >;
  readonly workspaceSettingsState: CommandEffectsFacet<
    | "workspaceSettings"
    | "workspaceSettingsRef"
    | "workspaceSettingsSaveCoordinator"
    | "workspaceEditorViewStatesRef"
  >;
  readonly applicationSettings: CommandEffectsFacet<
    "appSettings" | "appSettingsRef" | "applyAppSettings" | "persistAppSettings"
  >;
  readonly settingsPersistence: CommandEffectsFacet<
    "persistWorkspaceSettings" | "settingsGateway" | "hasRestoredRef" | "beginStartupRestore"
  >;
  readonly diagnosticState: CommandEffectsFacet<
    | "javaScriptTypeScriptDiagnosticsByPath"
    | "languageServerDiagnosticsByPath"
    | "frameworkDiagnosticsByPath"
    | "phpLocalDiagnosticsByPath"
  >;
  readonly diagnosticCoalescers: CommandEffectsFacet<
    | "diagnosticsFlushSchedulerRef"
    | "languageServerDiagnosticsCoalescerRef"
    | "javaScriptTypeScriptDiagnosticsCoalescerRef"
  >;
  readonly diagnosticGateways: CommandEffectsFacet<
    | "languageServerDiagnosticsGateway"
    | "javaScriptTypeScriptLanguageServerDiagnosticsGateway"
    | "reportLanguageServerError"
    | "reportJavaScriptTypeScriptLanguageServerError"
  >;
  readonly surfaceVisibility: CommandEffectsFacet<
    "paletteOpen" | "quickOpenOpen" | "classOpenOpen" | "workspaceSymbolsOpen"
  >;
  readonly surfaceSecondaryVisibility: CommandEffectsFacet<
    | "searchEverywhereOpen"
    | "fileStructureOpen"
    | "recentFilesSwitcherOpen"
    | "recentLocationsPanelOpen"
  >;
  readonly hierarchyVisibility: CommandEffectsFacet<
    "callHierarchyView" | "typeHierarchyView" | "referencesView" | "implementationChooser"
  >;
  readonly surfacePrimarySetters: CommandEffectsFacet<
    "setPaletteOpen" | "setQuickOpenOpen" | "setClassOpenOpen" | "setWorkspaceSymbolsOpen"
  >;
  readonly surfaceSecondarySetters: CommandEffectsFacet<
    | "setSearchEverywhereOpen"
    | "setFileStructureOpen"
    | "setRecentFilesSwitcherOpen"
    | "setRecentLocationsPanelOpen"
  >;
  readonly hierarchySetters: CommandEffectsFacet<
    | "setCallHierarchyView"
    | "setTypeHierarchyView"
    | "setReferencesView"
    | "setImplementationChooser"
  >;
  readonly phpOutlineState: CommandEffectsFacet<
    | "expandedPhpFilePaths"
    | "loadingInheritedPhpFileOutlinePaths"
    | "loadingPhpFileOutlinePaths"
    | "phpFileOutlinesByPath"
    | "phpInheritedFileOutlinesByPath"
  >;
  readonly languageRuntimeStatus: CommandEffectsFacet<
    | "languageServerPlan"
    | "languageServerRuntimeStatus"
    | "languageServerRuntimeStatusRoot"
    | "javaScriptTypeScriptLanguageServerRuntimeStatus"
    | "javaScriptTypeScriptLanguageServerRuntimeStatusRoot"
  >;
  readonly installState: CommandEffectsFacet<
    | "installingManagedPhpactor"
    | "installingManagedTypeScriptLanguageServer"
    | "phpToolGateway"
    | "phpTools"
  >;
  readonly navigationPersistence: CommandEffectsFacet<
    | "bottomPanelView"
    | "sidebarView"
    | "snapshotPersistedWorkspaceSession"
    | "persistCurrentWorkspaceSession"
  >;
  readonly runtimeSync: CommandEffectsFacet<
    | "documentSyncRuntimeSignatureRef"
    | "javaScriptTypeScriptDocumentSyncRuntimeSignatureRef"
    | "javaScriptTypeScriptIncrementalSyncRef"
    | "syncOpenDocument"
    | "syncOpenJavaScriptTypeScriptDocument"
  >;
  readonly diagnosticObserverServices: CommandEffectsFacet<
    | "activeEslintBufferClean"
    | "activeEslintFixes"
    | "activePhpstanBufferClean"
    | "applyJavaScriptTypeScriptLanguageServerDiagnostics"
    | "applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch"
    | "applyLanguageServerDiagnostics"
    | "applyLanguageServerDiagnosticsBatch"
    | "disableEslintRuleAtCursor"
    | "eslintAnalysisRunning"
    | "externallyRemovedDocumentRootByPathRef"
    | "fileStructureScope"
    | "fixAllEslintInActiveFile"
    | "handleExternalFileChange"
    | "hasEslintDiagnosticAtCursor"
    | "hasPhpstanDiagnosticAtCursor"
    | "ignorePhpstanIssueAtCursor"
    | "isExternallyRemovedDocumentPath"
    | "javaScriptTypeScriptFileStructureLoadingForDocument"
    | "javaScriptTypeScriptFileStructureOutlineForDocument"
    | "lastPhpFileOutlineRefreshKeyRef"
    | "loadPhpFileOutline"
    | "markExternallyRemovedDocumentPath"
    | "openFileStructure"
    | "openFileStructureWithInitialQuery"
    | "phpstanAnalysisRunning"
    | "resetJavaScriptTypeScriptDiagnosticsForRoot"
    | "resolveWorkspaceRuntimeOwnerForDiagnosticsEvent"
    | "runEslintAnalysis"
    | "runPhpstanAnalysis"
    | "scheduleDocumentChange"
    | "subscribeChangedDocuments"
  >;
  readonly workspaceRuntimeServices: CommandEffectsFacet<
    | "activateWorkspaceTab"
    | "autoStartedLanguageServerRootRef"
    | "clearWorkspaceIndex"
    | "frameworkIntelligence"
    | "handleWorkspaceDiscoveryFileChange"
    | "indexProgress"
    | "intelligenceMode"
    | "intelligenceModeRef"
    | "isLanguageServerActiveForWorkspace"
    | "languageServerSetupOpen"
    | "openWorkspace"
    | "openWorkspacePath"
    | "openWorkspaceRequestTokenRef"
    | "phpLanguageServerAutostartAttemptsByRootRef"
    | "refreshJavaScriptTypeScriptLanguageServerPlan"
    | "refreshLanguageServerPlan"
    | "refreshWorkspace"
    | "reportErrorForActiveWorkspaceRoot"
    | "resetJavaScriptTypeScriptLanguageServerDocuments"
    | "resetLanguageServerDocuments"
    | "resolveCurrentWorkspaceRuntimeOwner"
    | "runGitRepositoryDiscovery"
    | "runPhpWorkspaceProbe"
    | "setInstallingManagedTypeScriptLanguageServer"
    | "setIntelligenceMode"
    | "setLanguageServerSetupOpen"
    | "setWorkspaceSymbolsQuery"
    | "setWorkspaceTrust"
    | "smartModeActions"
    | "smartModeGateway"
    | "smartModeRequestGenerationRef"
    | "smartModeRequestIntentRef"
    | "startHardReindex"
    | "startIndexScan"
    | "startInitialIndexScan"
    | "startLanguageServer"
    | "startPhpReindex"
    | "stopBackgroundProjectRuntimes"
    | "stopLanguageServer"
    | "stopLanguageServerRuntime"
    | "stopProjectLanguageServersAfterTrustRevocation"
    | "workspaceCloseGenerationByRootRef"
    | "workspaceFileChangeGateway"
    | "workspaceSessionRestoredRef"
  >;
  readonly editorActionServices: CommandEffectsFacet<
    | "bookmarkActions"
    | "canReopenClosedDocument"
    | "documentSaveClose"
    | "editorDocument"
    | "editorMenuCommandRunner"
    | "editorSessionOwnerKeyForRoot"
    | "editorSurfaceCommandRunner"
    | "fileOperations"
    | "focusAdjacentEditorGroup"
    | "isDocumentSessionLifecycleAuthorityCurrent"
    | "languageNavigation"
    | "moveActiveTabToAdjacentGroup"
    | "navigationHistory"
    | "navigationHistoryActions"
    | "refreshEditorConfigRoot"
    | "resetEditorFontSize"
    | "resolveDocumentSessionLifecycleAuthority"
    | "runCloseActiveEditorGroup"
    | "runCloseActiveEditorGroupSurface"
    | "runCloseDocument"
    | "saveActiveDocument"
    | "scheduleJavaScriptTypeScriptDocumentChange"
    | "splitActiveEditorGroup"
    | "toggleEditorFontLigatures"
    | "zoomEditorFontIn"
    | "zoomEditorFontOut"
  >;
  readonly surfaceCommandServices: CommandEffectsFacet<
    | "closeGitDiffPreview"
    | "markFloatingSurfaceActivated"
    | "openArtisanMakePalette"
    | "openCallHierarchy"
    | "openCommandPaletteWithInitialQuery"
    | "openFileReferencesPanel"
    | "openRecentFilesSwitcher"
    | "openRecentLocationsPanel"
    | "openReferencesPanel"
    | "openTypeHierarchy"
    | "quitApplication"
    | "resetSearchEverywhere"
    | "searchEverywhereModelFor"
    | "setInstallingManagedPhpactor"
    | "setMessage"
    | "setNotices"
    | "setPhpTools"
    | "setSettingsInitialSection"
    | "setSettingsOpen"
    | "setSidebarView"
    | "setTextSearchOpen"
    | "settingsOpen"
  >;
  readonly taskGitServices: CommandEffectsFacet<
    | "activePackageScripts"
    | "commitGitChanges"
    | "gitDiffLoading"
    | "gitHistory"
    | "gitPanels"
    | "isActiveDocumentJsTest"
    | "isActiveDocumentPhpTest"
    | "jsTestExplorerScopeRunner"
    | "refreshGitStatus"
    | "selectedGitChange"
    | "taskDebug"
    | "taskDebugNavigation"
    | "todos"
  >;
  readonly commandIntegrationServices: CommandEffectsFacet<
    | "agents"
    | "applyJavaScriptTypeScriptSettingsChange"
    | "bareKeyShortcutsRef"
    | "canSearchClassOpenSymbols"
    | "doubleShiftDetectorRef"
    | "hasNetteApplicationFramework"
    | "hasSymfonyFramework"
    | "javaScriptTypeScriptTrustAutostartRef"
    | "localHistory"
    | "notices"
    | "pintGateway"
    | "quickOpenPrefixDispatch"
    | "refreshJavaScriptTypeScriptPlanAfterTrustGrant"
    | "refreshPhpTree"
    | "reportError"
  >;
}

export function useWorkbenchCommandEffectsCoordinator(dependencies: CommandEffectsDependencies) {
  const {
    applicationSettings,
    commandIntegrationServices,
    diagnosticCoalescers,
    diagnosticGateways,
    diagnosticObserverServices,
    diagnosticState,
    editorActionServices,
    editorDocumentState,
    editorSessionState,
    hierarchySetters,
    hierarchyVisibility,
    installState,
    languageRuntimeStatus,
    navigationPersistence,
    phpOutlineState,
    runtimeSync,
    settingsPersistence,
    surfaceCommandServices,
    surfacePrimarySetters,
    surfaceSecondarySetters,
    surfaceSecondaryVisibility,
    surfaceVisibility,
    taskGitServices,
    workspaceAuthority,
    workspaceIdentity,
    workspaceRuntimeServices,
    workspaceSettingsState,
    workspaceTrustState,
  } = dependencies;
  const {
    activeEslintBufferClean,
    activeEslintFixes,
    activePhpstanBufferClean,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch,
    applyLanguageServerDiagnostics,
    applyLanguageServerDiagnosticsBatch,
    disableEslintRuleAtCursor,
    eslintAnalysisRunning,
    externallyRemovedDocumentRootByPathRef,
    fileStructureScope,
    fixAllEslintInActiveFile,
    handleExternalFileChange,
    hasEslintDiagnosticAtCursor,
    hasPhpstanDiagnosticAtCursor,
    ignorePhpstanIssueAtCursor,
    isExternallyRemovedDocumentPath,
    javaScriptTypeScriptFileStructureLoadingForDocument,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    lastPhpFileOutlineRefreshKeyRef,
    loadPhpFileOutline,
    markExternallyRemovedDocumentPath,
    openFileStructure,
    openFileStructureWithInitialQuery,
    phpstanAnalysisRunning,
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    runEslintAnalysis,
    runPhpstanAnalysis,
    scheduleDocumentChange,
    subscribeChangedDocuments,
  } = diagnosticObserverServices;
  const {
    activateWorkspaceTab,
    autoStartedLanguageServerRootRef,
    clearWorkspaceIndex,
    frameworkIntelligence,
    handleWorkspaceDiscoveryFileChange,
    indexProgress,
    intelligenceMode,
    intelligenceModeRef,
    isLanguageServerActiveForWorkspace,
    languageServerSetupOpen,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRequestTokenRef,
    phpLanguageServerAutostartAttemptsByRootRef,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    refreshLanguageServerPlan,
    refreshWorkspace,
    reportErrorForActiveWorkspaceRoot,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    resetLanguageServerDocuments,
    resolveCurrentWorkspaceRuntimeOwner,
    runGitRepositoryDiscovery,
    runPhpWorkspaceProbe,
    setInstallingManagedTypeScriptLanguageServer,
    setIntelligenceMode,
    setLanguageServerSetupOpen,
    setWorkspaceSymbolsQuery,
    setWorkspaceTrust,
    smartModeActions,
    smartModeGateway,
    smartModeRequestGenerationRef,
    smartModeRequestIntentRef,
    startHardReindex,
    startIndexScan,
    startInitialIndexScan,
    startLanguageServer,
    startPhpReindex,
    stopBackgroundProjectRuntimes,
    stopLanguageServer,
    stopLanguageServerRuntime,
    stopProjectLanguageServersAfterTrustRevocation,
    workspaceCloseGenerationByRootRef,
    workspaceFileChangeGateway,
    workspaceSessionRestoredRef,
  } = workspaceRuntimeServices;
  const {
    bookmarkActions,
    canReopenClosedDocument,
    documentSaveClose,
    editorDocument,
    editorMenuCommandRunner,
    editorSessionOwnerKeyForRoot,
    editorSurfaceCommandRunner,
    fileOperations,
    focusAdjacentEditorGroup,
    isDocumentSessionLifecycleAuthorityCurrent,
    languageNavigation,
    moveActiveTabToAdjacentGroup,
    navigationHistory,
    navigationHistoryActions,
    refreshEditorConfigRoot,
    resetEditorFontSize,
    resolveDocumentSessionLifecycleAuthority,
    runCloseActiveEditorGroup,
    runCloseActiveEditorGroupSurface,
    runCloseDocument,
    saveActiveDocument,
    scheduleJavaScriptTypeScriptDocumentChange,
    splitActiveEditorGroup,
    toggleEditorFontLigatures,
    zoomEditorFontIn,
    zoomEditorFontOut,
  } = editorActionServices;
  const {
    closeGitDiffPreview,
    markFloatingSurfaceActivated,
    openArtisanMakePalette,
    openCallHierarchy,
    openCommandPaletteWithInitialQuery,
    openFileReferencesPanel,
    openRecentFilesSwitcher,
    openRecentLocationsPanel,
    openReferencesPanel,
    openTypeHierarchy,
    quitApplication,
    resetSearchEverywhere,
    searchEverywhereModelFor,
    setInstallingManagedPhpactor,
    setMessage,
    setNotices,
    setPhpTools,
    setSettingsInitialSection,
    setSettingsOpen,
    setSidebarView,
    setTextSearchOpen,
    settingsOpen,
  } = surfaceCommandServices;
  const {
    activePackageScripts,
    commitGitChanges,
    gitDiffLoading,
    gitHistory,
    gitPanels,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    jsTestExplorerScopeRunner,
    refreshGitStatus,
    selectedGitChange,
    taskDebug,
    taskDebugNavigation,
    todos,
  } = taskGitServices;
  const {
    agents,
    applyJavaScriptTypeScriptSettingsChange,
    bareKeyShortcutsRef,
    canSearchClassOpenSymbols,
    doubleShiftDetectorRef,
    hasNetteApplicationFramework,
    hasSymfonyFramework,
    javaScriptTypeScriptTrustAutostartRef,
    localHistory,
    notices,
    pintGateway,
    quickOpenPrefixDispatch,
    refreshJavaScriptTypeScriptPlanAfterTrustGrant,
    refreshPhpTree,
    reportError,
  } = commandIntegrationServices;
  const { activeDocument, activeImage, activeMarkdownPreview, activePath } = editorDocumentState;
  const { documents, documentsRef, editorGroups, openDocumentPaths, openDocuments } =
    editorSessionState;
  const {
    workspaceRoot,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceIdentityDescriptorRef,
  } = workspaceIdentity;
  const {
    currentWorkspaceRootRef,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerRef,
    workspaceRuntimeOwnerClaimsRef,
  } = workspaceAuthority;
  const {
    workspaceTrust,
    workspaceTrustGateway,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  } = workspaceTrustState;
  const {
    workspaceSettings,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
    workspaceEditorViewStatesRef,
  } = workspaceSettingsState;
  const { appSettings, appSettingsRef, applyAppSettings, persistAppSettings } = applicationSettings;
  const { persistWorkspaceSettings, settingsGateway, hasRestoredRef, beginStartupRestore } =
    settingsPersistence;
  const {
    javaScriptTypeScriptDiagnosticsByPath,
    languageServerDiagnosticsByPath,
    frameworkDiagnosticsByPath,
    phpLocalDiagnosticsByPath,
  } = diagnosticState;
  const {
    diagnosticsFlushSchedulerRef,
    languageServerDiagnosticsCoalescerRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
  } = diagnosticCoalescers;
  const {
    languageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    reportLanguageServerError,
    reportJavaScriptTypeScriptLanguageServerError,
  } = diagnosticGateways;
  const { paletteOpen, quickOpenOpen, classOpenOpen, workspaceSymbolsOpen } = surfaceVisibility;
  const {
    searchEverywhereOpen,
    fileStructureOpen,
    recentFilesSwitcherOpen,
    recentLocationsPanelOpen,
  } = surfaceSecondaryVisibility;
  const { callHierarchyView, typeHierarchyView, referencesView, implementationChooser } =
    hierarchyVisibility;
  const { setPaletteOpen, setQuickOpenOpen, setClassOpenOpen, setWorkspaceSymbolsOpen } =
    surfacePrimarySetters;
  const {
    setSearchEverywhereOpen,
    setFileStructureOpen,
    setRecentFilesSwitcherOpen,
    setRecentLocationsPanelOpen,
  } = surfaceSecondarySetters;
  const {
    setCallHierarchyView,
    setTypeHierarchyView,
    setReferencesView,
    setImplementationChooser,
  } = hierarchySetters;
  const {
    expandedPhpFilePaths,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
  } = phpOutlineState;
  const {
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  } = languageRuntimeStatus;
  const {
    installingManagedPhpactor,
    installingManagedTypeScriptLanguageServer,
    phpToolGateway,
    phpTools,
  } = installState;
  const {
    bottomPanelView,
    sidebarView,
    snapshotPersistedWorkspaceSession,
    persistCurrentWorkspaceSession,
  } = navigationPersistence;
  const {
    documentSyncRuntimeSignatureRef,
    javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
    javaScriptTypeScriptIncrementalSyncRef,
    syncOpenDocument,
    syncOpenJavaScriptTypeScriptDocument,
  } = runtimeSync;
  const { saveWorkbenchSettings, toggleSmartMode, toggleWorkspaceTrust } =
    useWorkbenchSettingsCommands({
      applyJavaScriptTypeScriptSettingsChange,
      appSettingsRef,
      autoStartedLanguageServerRootRef,
      clearWorkspaceIndex,
      currentWorkspaceRootRef,
      intelligenceMode,
      intelligenceModeRef,
      javaScriptTypeScriptTrustAutostartRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      persistWorkspaceSettings,
      phpLanguageServerAutostartAttemptsByRootRef,
      refreshJavaScriptTypeScriptPlanAfterTrustGrant,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      resolveCurrentWorkspaceRuntimeOwner,
      runGitRepositoryDiscovery,
      runPhpWorkspaceProbe,
      setIntelligenceMode,
      setMessage,
      setSmartMode: smartModeActions.setSmartMode,
      setWorkspaceTrust,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      stopLanguageServerRuntime,
      stopProjectLanguageServersAfterTrustRevocation,
      workspaceCloseGenerationByRootRef,
      workspaceDescriptor,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceSettingsRef,
      workspaceTrust,
      workspaceTrustGateway,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    });

  const {
    handleManagedPhpactorInstallCompletion,
    handleManagedTypeScriptInstallCompletion,
    installManagedPhpactor,
    installManagedTypeScriptLanguageServer,
  } = useManagedLanguageServerInstallCommands({
    currentWorkspaceIdentityDescriptorRef: workspaceIdentityDescriptorRef,
    currentWorkspaceRootRef,
    installingManagedPhpactor,
    installingManagedTypeScriptLanguageServer,
    phpToolGateway,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    refreshLanguageServerPlan,
    reportJavaScriptTypeScriptLanguageServerError,
    reportLanguageServerError,
    setInstallingManagedPhpactor,
    setInstallingManagedTypeScriptLanguageServer,
    setLanguageServerSetupOpen,
    setMessage,
    setNotices,
    setPhpTools,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceRoot,
  });

  const {
    formatActiveFile: formatActiveFileWithPint,
    formatChangedFiles: formatChangedFilesWithPint,
    isRunning: pintRunning,
  } = useWorkbenchPintCommand({
    activeDocument,
    currentWorkspaceRootRef,
    gateway: pintGateway,
    setMessage,
    workspaceRoot,
  });

  const {
    openSettingsPanel,
    openAppearanceSettingsPanel,
    closeFloatingSurface,
    openWorkspaceSymbols: openWorkspaceSymbolsSurface,
    openSearchEverywhere,
  } = useFloatingSurfaces({
    paletteOpen,
    setPaletteOpen,
    quickOpenOpen,
    setQuickOpenOpen,
    classOpenOpen,
    setClassOpenOpen,
    workspaceSymbolsOpen,
    setWorkspaceSymbolsOpen,
    searchEverywhereOpen,
    setSearchEverywhereOpen,
    resetSearchEverywhere,
    setTextSearchOpen,
    languageServerSetupOpen,
    setLanguageServerSetupOpen,
    fileStructureOpen,
    setFileStructureOpen,
    recentFilesSwitcherOpen,
    setRecentFilesSwitcherOpen,
    recentLocationsPanelOpen,
    setRecentLocationsPanelOpen,
    callHierarchyView,
    setCallHierarchyView,
    typeHierarchyView,
    setTypeHierarchyView,
    referencesView,
    setReferencesView,
    implementationChooser,
    setImplementationChooser,
    selectedGitChange,
    gitDiffLoading,
    closeGitDiffPreview: closeGitDiffPreview,
    settingsOpen,
    setSettingsOpen,
    setSettingsInitialSection,
  });
  const openWorkspaceSymbols = useQuickOpenPrefixDestinations(
    quickOpenPrefixDispatch,
    openFileStructureWithInitialQuery,
    setWorkspaceSymbolsQuery,
    openWorkspaceSymbolsSurface,
    openCommandPaletteWithInitialQuery,
  );

  const commandRegistry = useWorkbenchCommandRegistry({
    canShowNette: hasNetteApplicationFramework,
    canShowSymfony: hasSymfonyFramework,
    activeDocument,
    openDocuments,
    captureNavigationCommandScope: editorDocument.captureNavigationCommandScope,
    activeEslintBufferClean,
    activeEslintFixes,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    nodePackageScriptsWorkbench: taskDebug.nodePackageScripts,
    vscodeProcessTasksWorkbench: taskDebug.vscodeProcessTaskComposition.commands,
    nodeRunWithoutDebugging: taskDebug.nodeRunWithoutDebugging,
    activePhpstanBufferClean,
    activateWorkspaceTab,
    appSettings,
    canReopenClosedDocument,
    canRewordSelectedGitCommit: gitHistory.canRewordSelectedGitCommit,
    canSearchClassOpenSymbols,
    cherryPickSelectedGitCommit: gitHistory.cherryPickSelectedGitCommit,
    closeActiveEditorGroup: runCloseActiveEditorGroup,
    closeActiveEditorGroupSurface: runCloseActiveEditorGroupSurface,
    closeDocument: runCloseDocument,
    commitGitChanges: commitGitChanges,
    createDirectory: fileOperations.createDirectory,
    createFile: fileOperations.createFile,
    createGitBranch: gitPanels.createGitBranch,
    configureNodeLaunchConfigurations:
      taskDebug.nodeLaunchConfigurationsSurface.openNodeLaunchConfigurations,
    debugState: taskDebug.debugSession,
    debugCallStackNavigation: taskDebug.debugCallStackNavigation,
    debugRestartFrame: taskDebug.debugRestartFrame,
    debugBreakpointNavigation: taskDebug.debugBreakpointNavigation,
    debugInlineBreakpoint: taskDebug.debugInlineBreakpoint,
    debugCopyStackTrace: taskDebug.debugCopyStackTrace,
    debugEvaluateInConsole: taskDebug.debugEvaluateInConsole,
    debugWatchAtCursor: taskDebug.debugWatchAtCursor,
    jsTestDebugAtCursor: taskDebug.jsTestDebugAtCursor,
    jsTestRerunLastRun: createJsTestRerunLastRunCommands(jsTestExplorerScopeRunner),
    jsTestRunSelection: taskDebug.jsTestRunSelection,
    deleteActiveDocument: fileOperations.deleteActiveDocument,
    disableEslintRuleAtCursor,
    openDebugPanel: taskDebug.openDebugPanel,
    attachNodeDebug: taskDebug.attachNodeDebug,
    pauseDebug: taskDebug.debugSession.pauseDebug,
    startOrContinueDebug: taskDebug.startOrContinueDebug,
    startPhpListenDebug: taskDebug.startPhpListenDebug,
    stepDebug: taskDebug.debugSession.stepDebug,
    stopDebug: taskDebug.debugSession.stopDebug,
    toggleDebugBreakpointAtCursor: taskDebug.toggleDebugBreakpointAtCursor,
    editorGroups,
    editorSurfaceCommandRunner,
    editorMenuCommandRunner,
    eslintAnalysisRunning,
    fixAllEslintInActiveFile,
    focusAdjacentEditorGroup,
    formatActiveFileWithPint,
    formatChangedFilesWithPint,
    generateTestForActiveDocument: editorDocument.generateTestForActiveDocument,
    gitDiffLoading,
    goToDeclaration: languageNavigation.goToDeclaration,
    goToDefinition: languageNavigation.goToDefinition,
    goToImplementation: languageNavigation.goToImplementation,
    goToNextBookmark: bookmarkActions.goToNextBookmark,
    goToNextProblem: editorDocument.goToNextProblem,
    goToPreviousBookmark: bookmarkActions.goToPreviousBookmark,
    goToPreviousProblem: editorDocument.goToPreviousProblem,
    goToSourceDefinition: languageNavigation.goToSourceDefinition,
    goToSuperMethod: frameworkIntelligence.goToSuperMethod,
    goToTestForActiveDocument: editorDocument.goToTestForActiveDocument,
    goToTypeDefinition: languageNavigation.goToTypeDefinition,
    hasEslintDiagnosticAtCursor,
    hasPhpstanDiagnosticAtCursor,
    ignorePhpstanIssueAtCursor,
    indexProgress,
    installingManagedPhpactor,
    installManagedPhpactor,
    intelligenceMode,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    isLanguageServerActiveForWorkspace,
    isNavigationCommandScopeCurrent: editorDocument.isNavigationCommandScopeCurrent,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    markFloatingSurfaceActivated,
    moveActiveTabToAdjacentGroup,
    navigateBackward: navigationHistoryActions.navigateBackward,
    navigateForwardInHistory: navigationHistoryActions.navigateForwardInHistory,
    navigationHistory,
    openAppearanceSettingsPanel,
    openArtisanMakePalette,
    openArtisanRoutesPanel: taskDebugNavigation.openArtisanRoutesPanel,
    openExpressRoutesPanel: taskDebugNavigation.openExpressRoutesPanel,
    openCallHierarchy,
    openFileHistory: gitHistory.openFileHistory,
    openFileReferencesPanel,
    openFileStructure: openFileStructure,
    openGitBranchPanel: gitPanels.openGitBranchPanel,
    openGitStashPanel: gitPanels.openGitStashPanel,
    openLocalHistory: localHistory.openLocalHistory,
    openJsTestResultsPanel: taskDebugNavigation.openJsTestResultsPanel,
    openMarkdownPreview: editorDocument.openMarkdownPreview,
    openPhpTestResultsPanel: taskDebugNavigation.openPhpTestResultsPanel,
    openRecentFilesSwitcher,
    openRecentLocationsPanel,
    openReferencesPanel,
    openSearchEverywhere,
    openSettingsPanel,
    openTypeHierarchy,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceSymbols,
    phpstanAnalysisRunning,
    phpTools,
    pintRunning,
    quitApplication,
    refreshGitStatus,
    refreshPhpTree: refreshPhpTree,
    refreshWorkspace: refreshWorkspace,
    refreshWorkspaceTodos: todos.refreshWorkspaceTodos,
    renameActiveDocument: fileOperations.renameActiveDocument,
    reopenClosedDocument: documentSaveClose.documentLifecycle.reopenClosedDocument,
    resetEditorFontSize,
    revertSelectedGitCommit: gitHistory.revertSelectedGitCommit,
    rewordSelectedGitCommit: gitHistory.rewordSelectedGitCommit,
    runAllJsTestsForActiveDocument: taskDebug.runAllJsTestsForActiveDocument,
    runAllTestsForActiveDocument: taskDebug.runAllTestsForActiveDocument,
    runEslintAnalysis,
    runInActiveTerminal: taskDebug.runInActiveTerminal,
    runJsTestForActiveDocument: taskDebug.runJsTestForActiveDocument,
    runPhpstanAnalysis,
    runTestForActiveDocument: taskDebug.runTestForActiveDocument,
    saveActiveDocument,
    selectedGitChange,
    setClassOpenOpen,
    setLanguageServerSetupOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setSidebarView,
    setTextSearchOpen,
    setWorkspaceSymbolsOpen,
    showBottomPanelView: taskDebug.showBottomPanelView,
    splitActiveEditorGroup,
    startHardReindex,
    startIndexScan,
    startLanguageServer,
    startPhpReindex,
    stopLanguageServer,
    agents,
    toggleBookmarkAtCursor: bookmarkActions.toggleBookmarkAtCursor,
    toggleBookmarksPanel: bookmarkActions.toggleBookmarksPanel,
    toggleBottomPanel: taskDebug.toggleBottomPanel,
    toggleEditorFontLigatures,
    toggleGitBlame: gitHistory.toggleGitBlame,
    toggleSmartMode,
    toggleTodoPanel: todos.toggleTodoPanel,
    toggleWorkspaceTrust,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
    zoomEditorFontIn,
    zoomEditorFontOut,
  });

  const runCommand = useCallback<CommandExecutionRunner>(
    (commandId, context = editorDocument.commandContext) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      return executeCommandAndReport(commandRegistry, commandId, context, (error) =>
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Command", error),
      );
    },
    [
      currentWorkspaceRootRef,
      editorDocument.commandContext,
      commandRegistry,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  useWorkbenchNativeMenuCommands({
    commandContext: editorDocument.commandContext,
    reportError,
    runCommand,
  });

  const searchEverywhereModel = searchEverywhereModelFor(
    commandRegistry.list(),
    editorDocument.commandContext,
  );

  useEffect(() => {
    if (workspaceSettings.javaScriptTypeScriptValidation) {
      return;
    }

    resetJavaScriptTypeScriptDiagnosticsForRoot(workspaceRoot, workspaceRuntimeOwner ?? undefined);
  }, [
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    workspaceSettings.javaScriptTypeScriptValidation,
    workspaceRuntimeOwner,
    workspaceRoot,
  ]);

  useWorkbenchSidebarDataRefresh({
    indexProgress,
    refreshGitStatus,
    refreshPhpTree: refreshPhpTree,
    sidebarView,
    workspaceRoot,
  });

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (indexProgress.status !== "completed") {
      return;
    }

    if (indexProgress.rootPath && !workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot)) {
      return;
    }

    if (expandedPhpFilePaths.size === 0) {
      return;
    }

    const refreshKey = `${indexProgress.rootPath || workspaceRoot}:${indexProgress.indexedFiles}`;

    if (lastPhpFileOutlineRefreshKeyRef.current === refreshKey) {
      return;
    }

    lastPhpFileOutlineRefreshKeyRef.current = refreshKey;
    expandedPhpFilePaths.forEach((path) => {
      void loadPhpFileOutline(path);
    });
  }, [
    expandedPhpFilePaths,
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    lastPhpFileOutlineRefreshKeyRef,
    loadPhpFileOutline,
    workspaceRoot,
  ]);

  const keyboardShortcutActions = useWorkbenchKeyboardShortcutActions(
    closeFloatingSurface,
    openSearchEverywhere,
  );

  useWorkbenchKeyboardShortcuts({
    actions: keyboardShortcutActions,
    appSettingsRef,
    bareKeyShortcutsRef,
    commandContext: editorDocument.commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
    editorSurfaceIdentity: editorDocument.navigationSurfaceIdentity,
    keymap: appSettings.keymap,
    runCommand,
  });

  usePersistWorkspaceNavigationSession({
    bottomPanelView,
    documents,
    editorGroups,
    editorSessionOwnerKeyForRoot,
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    sidebarView,
    snapshotPersistedWorkspaceSession,
    workspaceEditorViewStatesRef,
    workspaceRoot,
    workspaceSessionRestoredRef,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
  });

  useFlushWorkspaceNavigationSessionOnBlur(
    persistCurrentWorkspaceSession,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  );

  useInitialAppSettingsHydration({
    applyAppSettings,
    beginStartupRestore,
    hasRestoredRef,
    onAppSettingsHydrated: agents.markAppSettingsHydrated,
    reportError,
    settingsGateway,
  });

  useWorkbenchWorkspaceFileChangeSubscription({
    currentWorkspaceRootRef,
    externallyRemovedDocumentRootByPathRef,
    gateway: workspaceFileChangeGateway,
    handleExternalFileChange,
    handleWorkspaceDiscoveryFileChange,
    handleWorkspaceFileChange: fileOperations.handleWorkspaceFileChange,
    markExternallyRemovedDocumentPath,
    refreshEditorConfigRoot,
    reportError,
    setMessage,
    workspaceRoot,
  });

  useManagedLanguageServerInstallSubscriptions({
    handleManagedPhpactorInstallCompletion,
    handleManagedTypeScriptInstallCompletion,
    phpToolGateway,
    reportError,
  });

  useWorkbenchLanguageRuntimeSubscriptionsCoordinator({
    workspaceRoot,
    workspaceRuntimeOwner,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    currentWorkspaceRootRef,
    diagnosticsFlushSchedulerRef,
    languageServerDiagnosticsCoalescerRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    languageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    createDiagnosticsCoalescer,
    applyLanguageServerDiagnostics,
    applyLanguageServerDiagnosticsBatch,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch,
    reportLanguageServerError,
    reportJavaScriptTypeScriptLanguageServerError,
  });
  useWorkbenchLanguageRuntimeEffects({
    activePath,
    changedDocumentSync: {
      currentWorkspaceRootRef,
      incrementalSyncRef: javaScriptTypeScriptIncrementalSyncRef,
      isDocumentSessionLifecycleAuthorityCurrent,
      resolveDocumentSessionLifecycleAuthority,
      scheduleDocumentChange,
      scheduleJavaScriptTypeScriptDocumentChange,
      subscribeChangedDocuments,
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerRef,
    },
    documentsRef,
    javaScriptTypeScript: {
      documentSyncRuntimeSignatureRef: javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
      languageServerRuntimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      resetLanguageServerDocuments: resetJavaScriptTypeScriptLanguageServerDocuments,
      syncOpenDocument: syncOpenJavaScriptTypeScriptDocument,
    },
    openDocumentPaths,
    php: {
      documentSyncRuntimeSignatureRef,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      resetLanguageServerDocuments,
      syncOpenDocument,
    },
    runtimeOwner: workspaceRuntimeOwner,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRoot,
  });

  const {
    diagnosticsSummary,
    effectiveNotices,
    fileStructureCanIncludeInheritedMembers,
    fileStructureLoading,
    fileStructureOutline,
    mergedLanguageServerDiagnosticsByPath,
  } = useWorkbenchDiagnosticPresentation({
    activeDocument,
    fileStructureScope,
    frameworkDiagnosticsByPath,
    isExternallyRemovedDocumentPath,
    javaScriptTypeScriptDiagnosticsByPath,
    javaScriptTypeScriptFileStructureLoadingForDocument,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    languageServerDiagnosticsByPath,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    notices,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
    phpLocalDiagnosticsByPath,
  });

  return {
    closeFloatingSurface,
    commandRegistry,
    diagnosticsSummary,
    effectiveNotices,
    fileStructureCanIncludeInheritedMembers,
    fileStructureLoading,
    fileStructureOutline,
    installManagedPhpactor,
    installManagedTypeScriptLanguageServer,
    mergedLanguageServerDiagnosticsByPath,
    openSearchEverywhere,
    openSettingsPanel,
    openWorkspaceSymbols,
    runCommand,
    saveWorkbenchSettings,
    searchEverywhereModel,
    toggleSmartMode,
    toggleWorkspaceTrust,
  };
}
