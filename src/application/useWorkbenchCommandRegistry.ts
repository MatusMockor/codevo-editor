import { isTauri } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { LanguageServerPlan } from "../domain/languageServer";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { isMarkdownDocument, type MarkdownPreviewTab } from "../domain/markdownPreview";
import type { NavigationHistory } from "../domain/navigation";
import type { PackageScript } from "../domain/packageScripts";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import { shortcutForCommand, type KeymapCommandId } from "../domain/keymap";
import type { WorkspaceTrustState } from "../domain/trust";
import type { AppSettings } from "../domain/settings";
import type {
  EditorDocument,
  ImageTab,
  IntelligenceMode,
  PhpToolAvailability,
  WorkspaceDescriptor,
} from "../domain/workspace";
import type { EditorSurfaceCommandInvocationScope } from "../domain/editorSurfaceCommand";
import type { EditorGroupsState, EditorSplitDirection } from "../domain/editorGroups";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { StepKind } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { CommandRegistry, type Command, type CommandContext } from "./commandRegistry";
import { workbenchArtisanCommands } from "./workbenchArtisanCommands";
import {
  hasDebuggableNodeWorkspace,
  isDebuggableNodeScriptPath,
  isDebuggablePhpScriptPath,
  workbenchDebugCommands,
} from "./workbenchDebugCommands";
import { workbenchAgentViewCommandBridge } from "./agentViewCommandBridge";
import { workbenchAgentCommands } from "./workbenchAgentCommands";
import { workbenchAppearanceCommands } from "./workbenchAppearanceCommands";
import { workbenchAppLifecycleCommands } from "./workbenchAppLifecycleCommands";
import { workbenchBookmarkCommands } from "./workbenchBookmarkCommands";
import { workbenchEditMenuCommands } from "./workbenchEditMenuCommands";
import { workbenchEditorHistoryCommands } from "./workbenchEditorHistoryCommands";
import { workbenchEditorSurfaceCommands } from "./workbenchEditorSurfaceCommands";
import { workbenchEditorGroupCommands } from "./workbenchEditorGroupCommands";
import {
  workbenchFloatingSurfaceCommands,
  workbenchRecentWorkspaceCommands,
} from "./workbenchFloatingSurfaceCommands";
import { workbenchGitSidebarCommands } from "./workbenchGitSidebarCommands";
import { workbenchGitWorkflowCommands } from "./workbenchGitWorkflowCommands";
import { workbenchIndexCommands } from "./workbenchIndexCommands";
import { workbenchLanguageNavigationCommands } from "./workbenchLanguageNavigationCommands";
import { workbenchLanguagePanelCommands } from "./workbenchLanguagePanelCommands";
import {
  canUseActiveDocumentLanguageServerFeature,
  javaScriptTypeScriptFeatureAvailability,
} from "./workbenchLanguageServerCommandEnablement";
import { workbenchMarkdownCommands } from "./workbenchMarkdownCommands";
import { workbenchNavigationHistoryCommands } from "./workbenchNavigationHistoryCommands";
import { workbenchPanelCommands } from "./workbenchPanelCommands";
import { workbenchJsTestCommands } from "./workbenchJsTestCommands";
import { workbenchPhpTestCommands } from "./workbenchPhpTestCommands";
import { workbenchPhpstanCommands } from "./workbenchPhpstanCommands";
import { workbenchPintCommands } from "./workbenchPintCommands";
import { workbenchProblemNavigationCommands } from "./workbenchProblemNavigationCommands";
import { workbenchScriptCommands } from "./workbenchScriptCommands";
import { workbenchNodePackageScriptCommands } from "./workbenchNodePackageScriptCommands";
import { workbenchNodeRunCommands } from "./workbenchNodeRunCommands";
import {
  workbenchVscodeProcessTaskCommands,
  type WorkbenchVscodeProcessTaskCommandsOptions,
} from "./workbenchVscodeProcessTaskCommands";
import { workbenchSmartCommands } from "./workbenchSmartCommands";
import { workbenchPhpTreeCommands } from "./workbenchPhpTreeCommands";
import { workbenchWorkspaceFileCommands } from "./workbenchWorkspaceFileCommands";
import { workbenchWorkspaceTabCommands } from "./workbenchWorkspaceTabCommands";
import { workbenchEslintCommands } from "./workbenchEslintCommands";

interface ActivePackageScripts {
  composerScripts: PackageScript[];
  hasArtisan: boolean;
}

type CommandRun = Command["run"];
type NavigationRun = () => unknown;

interface UseWorkbenchCommandRegistryOptions {
  activeDocument: EditorDocument | null;
  openDocuments?: readonly EditorDocument[];
  captureNavigationCommandScope(): EditorSurfaceCommandInvocationScope;
  activeEslintBufferClean: boolean;
  activeEslintFixes: readonly unknown[];
  activeImage: ImageTab | null;
  activeMarkdownPreview: MarkdownPreviewTab | null;
  activePackageScripts: ActivePackageScripts | null | undefined;
  nodePackageScriptsWorkbench: {
    readonly available: boolean;
    readonly pending: boolean;
    readonly scripts: readonly NodePackageScript[];
    runSelectedScript?(
      capture: NonNullable<CommandContext["npmRunSelectedScriptCapture"]>,
    ): boolean;
    run(script: NodePackageScript): void;
    stop(): void;
  };
  nodeRunWithoutDebugging: {
    readonly canRun: boolean;
    readonly canStop: boolean;
    readonly configurationLauncher: {
      readonly busy: boolean;
      readonly pickerOpen: boolean;
      canOpenPicker(): boolean;
      openPicker(): void;
    };
    readonly pending: boolean;
    run(): void;
    stop(): void;
  };
  vscodeProcessTasksWorkbench: WorkbenchVscodeProcessTaskCommandsOptions;
  activePhpstanBufferClean: boolean;
  activateWorkspaceTab(root: string): unknown;
  appSettings: AppSettings;
  canReopenClosedDocument: boolean;
  canShowNette: boolean;
  canShowSymfony: boolean;
  canRewordSelectedGitCommit(): boolean;
  canSearchClassOpenSymbols: boolean;
  cherryPickSelectedGitCommit: CommandRun;
  closeActiveEditorGroup: CommandRun;
  closeActiveEditorGroupSurface: CommandRun;
  closeDocument: unknown;
  commitGitChanges: CommandRun;
  createDirectory: CommandRun;
  createFile: CommandRun;
  createGitBranch: CommandRun;
  configureNodeLaunchConfigurations: CommandRun;
  debugState: {
    breakpointBulkMutationPending: boolean;
    breakpointCounts: {
      readonly disabled: number;
      readonly enabled: number;
    };
    canRestartDebug(): boolean;
    canRunToCursor: boolean;
    canToggleBreakpointsActivated(): boolean;
    consoleSurface: {
      readonly canClear: boolean;
      clear(): void;
      focus(): void;
    };
    configurationLauncher: {
      readonly busy: boolean;
      readonly pickerOpen: boolean;
      canOpenPicker(): boolean;
      openPicker(): void;
    };
    copyValue: {
      canCopyEvaluatePath(): boolean;
      canCopyValue(): boolean;
      copyEvaluatePath(): Promise<boolean>;
      copyValue(): Promise<boolean>;
    };
    addToWatch: {
      canAddToWatch(): boolean;
      addToWatch(): boolean;
    };
    setValue: {
      canBeginEdit(): boolean;
      beginEdit(): boolean;
    };
    debugRestartPending: boolean;
    debugCompoundStartPending: boolean;
    debugControlPending: boolean;
    debugStopPending: boolean;
    debugSessionAttached: boolean;
    disconnectDebug: CommandRun;
    debugStartPending: boolean;
    disableAllBreakpoints: CommandRun;
    enableAllBreakpoints: CommandRun;
    toggleBreakpointsActivated(): Promise<boolean>;
    removeAllBreakpoints: CommandRun;
    restartDebug: CommandRun;
    runToCursor: CommandRun;
    snapshot: DebuggerSessionSnapshot;
  };
  debugWatchAtCursor: {
    addToWatchAtCursor(): boolean;
    canAddAtCursor(): boolean;
  };
  jsTestDebugAtCursor: {
    canDebugAtCursor(): boolean;
    debugAtCursor(): Promise<boolean>;
  };
  jsTestRerunLastRun: {
    canCancelTestRun(): boolean;
    canRerunFailedTests(): boolean;
    canRerunLastRun(): boolean;
    cancelTestRun(): Promise<boolean>;
    rerunFailedTests(): Promise<boolean>;
    rerunLastRun(): Promise<boolean>;
  };
  jsTestRunSelection: {
    canRunAtCursor(): boolean;
    runAtCursor(): Promise<boolean>;
    canRunCurrentFile(): boolean;
    runCurrentFile(): Promise<boolean>;
  };
  debugEvaluateInConsole: {
    canEvaluateInConsole(): boolean;
    evaluateInConsole(): boolean;
  };
  debugBreakpointNavigation: {
    canGoToNextBreakpoint(): boolean;
    canGoToPreviousBreakpoint(): boolean;
    goToNextBreakpoint(): boolean;
    goToPreviousBreakpoint(): boolean;
  };
  debugInlineBreakpoint: {
    addInlineBreakpoint(): boolean;
    canAddInlineBreakpoint(): boolean;
  };
  debugCopyStackTrace: {
    canCopyStackTrace(): boolean;
    copyStackTrace(): boolean;
  };
  debugCallStackNavigation: {
    canSelectCallStackFrame(): boolean;
    selectCallStackTop(): boolean;
    selectCallStackBottom(): boolean;
    selectCallStackUp(): boolean;
    selectCallStackDown(): boolean;
  };
  debugRestartFrame: {
    canRestartFrame(): boolean;
    restartFrame(): boolean;
  };
  deleteActiveDocument: CommandRun;
  disableEslintRuleAtCursor: CommandRun;
  openDebugPanel: CommandRun;
  attachNodeDebug: CommandRun;
  pauseDebug: CommandRun;
  startOrContinueDebug: CommandRun;
  startPhpListenDebug: CommandRun;
  stepDebug(kind: StepKind): void | Promise<void>;
  stopDebug: CommandRun;
  toggleDebugBreakpointAtCursor: CommandRun;
  editorGroups: EditorGroupsState;
  editorMenuCommandRunner?: EditorMenuCommandRunner | null;
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
  eslintAnalysisRunning: boolean;
  fixAllEslintInActiveFile: CommandRun;
  focusAdjacentEditorGroup(direction: 1 | -1): void;
  formatActiveFileWithPint: CommandRun;
  formatChangedFilesWithPint: CommandRun;
  generateTestForActiveDocument: CommandRun;
  gitDiffLoading: boolean;
  goToDeclaration: NavigationRun;
  goToDefinition: NavigationRun;
  goToImplementation: NavigationRun;
  goToNextBookmark(): Promise<boolean>;
  goToNextProblem: NavigationRun;
  goToPreviousBookmark(): Promise<boolean>;
  goToPreviousProblem: NavigationRun;
  goToSourceDefinition: NavigationRun;
  goToSuperMethod: NavigationRun;
  goToTestForActiveDocument: CommandRun;
  goToTypeDefinition: NavigationRun;
  hasEslintDiagnosticAtCursor: () => boolean;
  hasPhpstanDiagnosticAtCursor: () => boolean;
  ignorePhpstanIssueAtCursor: CommandRun;
  indexProgress: Parameters<typeof workbenchIndexCommands>[0]["indexProgress"];
  installingManagedPhpactor: boolean;
  installManagedPhpactor: CommandRun;
  intelligenceMode: IntelligenceMode;
  isActiveDocumentJsTest: boolean;
  isActiveDocumentPhpTest: boolean;
  isLanguageServerActiveForWorkspace(
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ): boolean;
  isNavigationCommandScopeCurrent(scope: EditorSurfaceCommandInvocationScope): boolean;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerPlan: LanguageServerPlan | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  markFloatingSurfaceActivated: CommandRun;
  moveActiveTabToAdjacentGroup(direction: 1 | -1): void;
  navigateBackward: CommandRun;
  navigateForwardInHistory: CommandRun;
  navigationHistory: NavigationHistory;
  openAppearanceSettingsPanel: CommandRun;
  openArtisanMakePalette: CommandRun;
  openArtisanRoutesPanel: CommandRun;
  openExpressRoutesPanel: CommandRun;
  openCallHierarchy: CommandRun;
  openFileHistory(): Promise<void>;
  openFileReferencesPanel: CommandRun;
  openFileStructure: CommandRun;
  openGitBranchPanel: CommandRun;
  openGitStashPanel: CommandRun;
  openLocalHistory(): Promise<void>;
  openJsTestResultsPanel: CommandRun;
  openMarkdownPreview: CommandRun;
  openPhpTestResultsPanel: CommandRun;
  openRecentFilesSwitcher: CommandRun;
  openRecentLocationsPanel: CommandRun;
  openReferencesPanel: CommandRun;
  openSearchEverywhere: CommandRun;
  openSettingsPanel: CommandRun;
  openTypeHierarchy: CommandRun;
  openWorkspace: CommandRun;
  openWorkspacePath(path: string): void | Promise<void>;
  openWorkspaceSymbols: CommandRun;
  phpstanAnalysisRunning: boolean;
  phpTools: PhpToolAvailability | null;
  pintRunning: boolean;
  quitApplication: CommandRun;
  refreshGitStatus: CommandRun;
  refreshPhpTree: CommandRun;
  refreshWorkspace: CommandRun;
  refreshWorkspaceTodos: CommandRun;
  renameActiveDocument: CommandRun;
  reopenClosedDocument: CommandRun;
  resetEditorFontSize: CommandRun;
  revertSelectedGitCommit: CommandRun;
  rewordSelectedGitCommit: CommandRun;
  runAllJsTestsForActiveDocument: CommandRun;
  runAllTestsForActiveDocument: CommandRun;
  runEslintAnalysis: CommandRun;
  runInActiveTerminal(command: string): void;
  runJsTestForActiveDocument: CommandRun;
  runPhpstanAnalysis: CommandRun;
  runTestForActiveDocument: CommandRun;
  saveActiveDocument: CommandRun;
  selectedGitChange: unknown;
  setClassOpenOpen(open: boolean): void;
  setLanguageServerSetupOpen(open: boolean): void;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  setRecentFilesSwitcherOpen(open: boolean): void;
  setSidebarView(view: "git" | "php" | "scripts"): void;
  toggleAgentMode(): void;
  setTextSearchOpen(open: boolean): void;
  setWorkspaceSymbolsOpen(open: boolean): void;
  showBottomPanelView: Parameters<typeof workbenchPanelCommands>[0]["showBottomPanelView"];
  splitActiveEditorGroup(direction: EditorSplitDirection): void;
  startHardReindex: CommandRun;
  startIndexScan: CommandRun;
  startLanguageServer: CommandRun;
  startPhpReindex: CommandRun;
  stopLanguageServer: CommandRun;
  toggleBookmarkAtCursor: CommandRun;
  toggleBookmarksPanel: CommandRun;
  toggleBottomPanel: CommandRun;
  toggleEditorFontLigatures: CommandRun;
  toggleGitBlame: CommandRun;
  toggleSmartMode: CommandRun;
  toggleTodoPanel: CommandRun;
  toggleWorkspaceTrust: CommandRun;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
  workspaceTrust: WorkspaceTrustState | null;
  zoomEditorFontIn: CommandRun;
  zoomEditorFontOut: CommandRun;
}

export function useWorkbenchCommandRegistry(
  options: UseWorkbenchCommandRegistryOptions,
): CommandRegistry {
  const {
    activeDocument,
    openDocuments = [],
    captureNavigationCommandScope,
    activeEslintBufferClean,
    activeEslintFixes,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    nodePackageScriptsWorkbench,
    nodeRunWithoutDebugging,
    vscodeProcessTasksWorkbench,
    activePhpstanBufferClean,
    activateWorkspaceTab,
    appSettings,
    canReopenClosedDocument,
    canShowNette,
    canShowSymfony,
    canRewordSelectedGitCommit,
    canSearchClassOpenSymbols,
    cherryPickSelectedGitCommit,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
    commitGitChanges,
    createDirectory,
    createFile,
    createGitBranch,
    configureNodeLaunchConfigurations,
    debugState,
    debugWatchAtCursor,
    jsTestDebugAtCursor,
    jsTestRerunLastRun,
    jsTestRunSelection,
    debugEvaluateInConsole,
    debugBreakpointNavigation,
    debugInlineBreakpoint,
    debugCopyStackTrace,
    debugCallStackNavigation,
    debugRestartFrame,
    deleteActiveDocument,
    disableEslintRuleAtCursor,
    openDebugPanel,
    attachNodeDebug,
    pauseDebug,
    startOrContinueDebug,
    startPhpListenDebug,
    stepDebug,
    stopDebug,
    toggleDebugBreakpointAtCursor,
    editorGroups,
    editorMenuCommandRunner,
    editorSurfaceCommandRunner,
    eslintAnalysisRunning,
    fixAllEslintInActiveFile,
    focusAdjacentEditorGroup,
    formatActiveFileWithPint,
    formatChangedFilesWithPint,
    generateTestForActiveDocument,
    gitDiffLoading,
    goToDeclaration,
    goToDefinition,
    goToImplementation,
    goToNextBookmark,
    goToNextProblem,
    goToPreviousBookmark,
    goToPreviousProblem,
    goToSourceDefinition,
    goToSuperMethod,
    goToTestForActiveDocument,
    goToTypeDefinition,
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
    isNavigationCommandScopeCurrent,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    markFloatingSurfaceActivated,
    moveActiveTabToAdjacentGroup,
    navigateBackward,
    navigateForwardInHistory,
    navigationHistory,
    openAppearanceSettingsPanel,
    openArtisanMakePalette,
    openArtisanRoutesPanel,
    openExpressRoutesPanel,
    openCallHierarchy,
    openFileHistory,
    openFileReferencesPanel,
    openFileStructure,
    openGitBranchPanel,
    openGitStashPanel,
    openLocalHistory,
    openJsTestResultsPanel,
    openMarkdownPreview,
    openPhpTestResultsPanel,
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
    refreshPhpTree,
    refreshWorkspace,
    refreshWorkspaceTodos,
    renameActiveDocument,
    reopenClosedDocument,
    resetEditorFontSize,
    revertSelectedGitCommit,
    rewordSelectedGitCommit,
    runAllJsTestsForActiveDocument,
    runAllTestsForActiveDocument,
    runEslintAnalysis,
    runInActiveTerminal,
    runJsTestForActiveDocument,
    runPhpstanAnalysis,
    runTestForActiveDocument,
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
    showBottomPanelView,
    splitActiveEditorGroup,
    startHardReindex,
    startIndexScan,
    startLanguageServer,
    startPhpReindex,
    stopLanguageServer,
    toggleBookmarkAtCursor,
    toggleBookmarksPanel,
    toggleBottomPanel,
    toggleAgentMode,
    toggleEditorFontLigatures,
    toggleGitBlame,
    toggleSmartMode,
    toggleTodoPanel,
    toggleWorkspaceTrust,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
    zoomEditorFontIn,
    zoomEditorFontOut,
  } = options;

  return useMemo(() => {
    const registry = new CommandRegistry();
    const shortcut = (commandId: KeymapCommandId) =>
      shortcutForCommand(appSettings.keymap, commandId);
    const activeDocumentLanguage = activeDocument
      ? {
          isJavaScriptTypeScriptLanguageServerDocument:
            isJavaScriptTypeScriptLanguageServerDocument(activeDocument),
          isLanguageServerDocument: isLanguageServerDocument(activeDocument),
          language: activeDocument.language,
        }
      : null;
    const javaScriptTypeScriptCommandAvailability = javaScriptTypeScriptFeatureAvailability({
      activeDocument: activeDocumentLanguage,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      workspaceRoot,
    });
    const appearanceCommands = workbenchAppearanceCommands({
      shortcut,
      zoomEditorFontIn,
      zoomEditorFontOut,
      resetEditorFontSize,
      toggleEditorFontLigatures,
      openSettingsPanel,
      openAppearanceSettingsPanel,
    });
    const navigationCommandScope = captureNavigationCommandScope();

    workbenchAppLifecycleCommands({
      shortcut,
      quitApplication,
    }).forEach((command) => registry.register(command));

    workbenchWorkspaceFileCommands({
      isWorkspaceTrusted: workspaceTrust?.trusted,
      openWorkspace,
      refreshWorkspace,
      toggleWorkspaceTrust,
      createFile,
      createDirectory,
      renameActiveDocument,
      deleteActiveDocument,
    }).forEach((command) => registry.register(command));

    workbenchWorkspaceTabCommands({
      activateWorkspaceTab,
      activeWorkspaceRoot: workspaceRoot,
      shortcut,
      workspaceTabs: appSettings.workspaceTabs,
    }).forEach((command) => registry.register(command));

    workbenchRecentWorkspaceCommands({
      recentWorkspacePaths: appSettings.recentWorkspacePaths ?? [],
      workspaceTabs: appSettings.workspaceTabs,
      openWorkspacePath,
    }).forEach((command) => registry.register(command));

    workbenchPhpTestCommands({
      shortcut,
      hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
      isActiveDocumentPhp: activeDocument?.language === "php",
      isActiveDocumentPhpTest,
      generateTestForActiveDocument,
      goToTestForActiveDocument,
      runTestForActiveDocument,
      runAllTestsForActiveDocument,
      openTestResultsPanel: openPhpTestResultsPanel,
    }).forEach((command) => registry.register(command));

    workbenchJsTestCommands({
      canCancelTestRun: jsTestRerunLastRun.canCancelTestRun,
      canDebugAtCursor: jsTestDebugAtCursor.canDebugAtCursor,
      canRerunFailedTests: jsTestRerunLastRun.canRerunFailedTests,
      canRerunLastRun: jsTestRerunLastRun.canRerunLastRun,
      canRunAtCursor: jsTestRunSelection.canRunAtCursor,
      canRunCurrentFile: jsTestRunSelection.canRunCurrentFile,
      debugAtCursor: async () => {
        await jsTestDebugAtCursor.debugAtCursor();
      },
      cancelTestRun: jsTestRerunLastRun.cancelTestRun,
      hasJsWorkspace: Boolean(workspaceDescriptor?.javaScriptTypeScript),
      isActiveDocumentJsTest,
      runAtCursor: async () => {
        await jsTestRunSelection.runAtCursor();
      },
      runCurrentFile: async () => {
        await jsTestRunSelection.runCurrentFile();
      },
      runTestForActiveDocument: runJsTestForActiveDocument,
      runAllTestsForActiveDocument: runAllJsTestsForActiveDocument,
      openTestResultsPanel: openJsTestResultsPanel,
      rerunFailedTests: jsTestRerunLastRun.rerunFailedTests,
      rerunLastRun: jsTestRerunLastRun.rerunLastRun,
      shortcut,
    }).forEach((command) => registry.register(command));

    const hasJsDebugWorkspace = hasDebuggableNodeWorkspace({
      activeDocument,
      detectedJavaScriptTypeScript: Boolean(workspaceDescriptor?.javaScriptTypeScript),
      openedDocuments: openDocuments,
      workspaceRoot,
    });

    workbenchDebugCommands({
      attachNodeDebug,
      breakpointBulkMutationPending: debugState.breakpointBulkMutationPending,
      breakpointCounts: debugState.breakpointCounts,
      configurationLauncher: debugState.configurationLauncher,
      configureNodeLaunchConfigurations,
      canRestartDebug: debugState.canRestartDebug(),
      canRunToCursor: debugState.canRunToCursor,
      canToggleBreakpointsActivated: debugState.canToggleBreakpointsActivated(),
      canClearDebugConsole: debugState.consoleSurface.canClear,
      debugRestartPending: debugState.debugRestartPending,
      debugCompoundStartPending: debugState.debugCompoundStartPending,
      debugControlPending: debugState.debugControlPending,
      debugStopPending: debugState.debugStopPending,
      debugSessionAttached: debugState.debugSessionAttached,
      debugStartPending: debugState.debugStartPending,
      debugWatchAtCursor,
      debugEvaluateInConsole,
      debugBreakpointNavigation,
      debugInlineBreakpoint,
      debugCopyValue: debugState.copyValue,
      debugAddToWatch: debugState.addToWatch,
      debugCopyStackTrace,
      debugCallStackNavigation,
      debugRestartFrame,
      debugSetVariable: debugState.setValue,
      disableAllBreakpoints: debugState.disableAllBreakpoints,
      enableAllBreakpoints: debugState.enableAllBreakpoints,
      toggleBreakpointsActivated: async () => {
        await debugState.toggleBreakpointsActivated();
      },
      shortcut,
      hasJsWorkspace: hasJsDebugWorkspace,
      hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
      isActiveDocumentDebuggable:
        (hasJsDebugWorkspace &&
          (isActiveDocumentJsTest || isDebuggableNodeScriptPath(activeDocument?.path ?? ""))) ||
        (Boolean(workspaceDescriptor?.php) &&
          isDebuggablePhpScriptPath(activeDocument?.path ?? "")),
      isWorkspaceTrusted: workspaceTrust?.trusted === true,
      snapshot: debugState.snapshot,
      openDebugPanel,
      clearDebugConsole: debugState.consoleSurface.clear,
      focusDebugConsole: debugState.consoleSurface.focus,
      pauseDebug,
      restartDebug: debugState.restartDebug,
      runToCursor: debugState.runToCursor,
      removeAllBreakpoints: debugState.removeAllBreakpoints,
      startOrContinueDebug,
      startPhpListenDebug,
      stepDebug,
      stopDebug,
      disconnectDebug: debugState.disconnectDebug,
      toggleBreakpointAtCursor: toggleDebugBreakpointAtCursor,
    }).forEach((command) => registry.register(command));

    workbenchNodeRunCommands({
      canRun: nodeRunWithoutDebugging.canRun,
      canStop: nodeRunWithoutDebugging.canStop,
      configurationLauncher: nodeRunWithoutDebugging.configurationLauncher,
      pending: nodeRunWithoutDebugging.pending,
      run: nodeRunWithoutDebugging.run,
      shortcut,
      stop: nodeRunWithoutDebugging.stop,
    }).forEach((command) => registry.register(command));

    workbenchPhpstanCommands({
      hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
      isRunning: phpstanAnalysisRunning,
      runPhpstanAnalysis,
      hasDiagnosticAtCursor: hasPhpstanDiagnosticAtCursor,
      isActiveBufferClean: activePhpstanBufferClean,
      isWorkspaceTrusted: workspaceTrust?.trusted === true,
      ignoreIssueAtCursor: ignorePhpstanIssueAtCursor,
    }).forEach((command) => registry.register(command));

    workbenchPintCommands({
      hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
      isRunning: pintRunning,
      isWorkspaceTrusted: workspaceTrust?.trusted === true,
      hasActivePhpDocument:
        activeDocument?.language === "php" && activeDocument.path.endsWith(".php"),
      formatChangedFiles: formatChangedFilesWithPint,
      formatActiveFile: formatActiveFileWithPint,
    }).forEach((command) => registry.register(command));

    workbenchEslintCommands({
      hasPackageJson: workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson === true,
      isRunning: eslintAnalysisRunning,
      runEslintAnalysis,
      hasFixesForActiveFile: activeEslintFixes.length > 0,
      isActiveBufferClean: activeEslintBufferClean,
      isWorkspaceTrusted: workspaceTrust?.trusted === true,
      fixAllInActiveFile: fixAllEslintInActiveFile,
      hasDiagnosticAtCursor: hasEslintDiagnosticAtCursor,
      disableRuleAtCursor: disableEslintRuleAtCursor,
    }).forEach((command) => registry.register(command));

    workbenchScriptCommands({
      composerScripts: activePackageScripts?.composerScripts ?? [],
      runInActiveTerminal,
    }).forEach((command) => registry.register(command));

    workbenchNodePackageScriptCommands({
      enabled: nodePackageScriptsWorkbench.available,
      pending: nodePackageScriptsWorkbench.pending,
      scripts: nodePackageScriptsWorkbench.scripts,
      runSelectedScript: nodePackageScriptsWorkbench.runSelectedScript,
      run: nodePackageScriptsWorkbench.run,
      stop: nodePackageScriptsWorkbench.stop,
    }).forEach((command) => registry.register(command));

    workbenchVscodeProcessTaskCommands(vscodeProcessTasksWorkbench).forEach((command) =>
      registry.register(command),
    );

    workbenchArtisanCommands({
      hasArtisan: activePackageScripts?.hasArtisan ?? false,
      openArtisanMakePalette,
      openRoutesPanel: openArtisanRoutesPanel,
      runInActiveTerminal,
    }).forEach((command) => registry.register(command));

    workbenchFloatingSurfaceCommands({
      shortcut,
      canSearchWorkspaceSymbols: canSearchClassOpenSymbols,
      openQuickOpenFile: () => {
        setClassOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setQuickOpenOpen(true);
        markFloatingSurfaceActivated();
      },
      openRecentFilesSwitcher,
      openRecentLocationsPanel,
      openClassOpen: () => {
        setQuickOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setClassOpenOpen(true);
        markFloatingSurfaceActivated();
      },
      openWorkspaceSymbols,
      openSearchEverywhere,
      openTextSearch: () => setTextSearchOpen(true),
    }).forEach((command) => registry.register(command));

    scopedNavigationCommands(
      workbenchNavigationHistoryCommands({
        shortcut,
        canNavigateBackward: navigationHistory.backStack.length > 0,
        canNavigateForward: navigationHistory.forwardStack.length > 0,
        navigateBackward,
        navigateForward: navigateForwardInHistory,
      }),
      isNavigationCommandScopeCurrent,
      navigationCommandScope,
    ).forEach((command) => registry.register(command));

    workbenchEditorSurfaceCommands({
      shortcut,
      canCloseActiveSurface: Boolean(
        activeDocument ||
        activeImage ||
        activeMarkdownPreview ||
        selectedGitChange ||
        gitDiffLoading ||
        isTauri(),
      ),
      saveActiveDocument,
      closeActiveSurface: closeActiveEditorGroupSurface,
      canReopenClosedDocument,
      reopenClosedDocument,
      editorSurfaceCommandRunner,
      javaScriptTypeScriptFeatureAvailability: javaScriptTypeScriptCommandAvailability,
      canRunJavaScriptTypeScriptImportActions:
        activeDocumentLanguage?.isJavaScriptTypeScriptLanguageServerDocument === true &&
        canUseActiveDocumentLanguageServerFeature({
          activeDocument: activeDocumentLanguage,
          feature: "codeAction",
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        }),
      canRunJavaScriptTypeScriptRefactors:
        activeDocumentLanguage?.isJavaScriptTypeScriptLanguageServerDocument === true &&
        canUseActiveDocumentLanguageServerFeature({
          activeDocument: activeDocumentLanguage,
          feature: "codeAction",
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        }),
      javaScriptTypeScriptImportLanguage:
        activeDocument?.language === "javascript" || activeDocument?.language === "javascriptreact"
          ? "javascript"
          : activeDocument?.language === "typescript" ||
              activeDocument?.language === "typescriptreact"
            ? "typescript"
            : null,
    }).forEach((command) => registry.register(command));

    workbenchEditMenuCommands({
      editorMenuCommandRunner,
    }).forEach((command) => registry.register(command));

    workbenchEditorGroupCommands({
      canCloseGroup: Object.keys(editorGroups.groups).length > 1,
      canMoveBetweenGroups: Object.keys(editorGroups.groups).length > 1,
      closeActiveGroup: closeActiveEditorGroup,
      focusNextGroup: () => focusAdjacentEditorGroup(1),
      focusPreviousGroup: () => focusAdjacentEditorGroup(-1),
      moveActiveTabToNextGroup: () => moveActiveTabToAdjacentGroup(1),
      moveActiveTabToPreviousGroup: () => moveActiveTabToAdjacentGroup(-1),
      shortcut,
      splitDown: () => splitActiveEditorGroup("down"),
      splitRight: () => splitActiveEditorGroup("right"),
    }).forEach((command) => registry.register(command));

    workbenchMarkdownCommands({
      isActiveDocumentMarkdown: isMarkdownDocument(activeDocument),
      openMarkdownPreview,
      shortcut,
    }).forEach((command) => registry.register(command));

    scopedNavigationCommands(
      workbenchLanguageNavigationCommands({
        shortcut,
        javaScriptTypeScriptFeatureAvailability: javaScriptTypeScriptCommandAvailability,
        goToDefinition,
        goToSourceDefinition,
        goToDeclaration,
        goToTypeDefinition,
        goToImplementation,
        goToSuperMethod,
      }),
      isNavigationCommandScopeCurrent,
      navigationCommandScope,
    ).forEach((command) => registry.register(command));

    appearanceCommands.editorCommands.forEach((command) => registry.register(command));

    scopedNavigationCommands(
      workbenchLanguagePanelCommands({
        shortcut,
        activeDocument: activeDocumentLanguage,
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
        openFileStructure,
        openCallHierarchy,
        openTypeHierarchy,
        openReferencesPanel,
        openFileReferencesPanel,
      }),
      isNavigationCommandScopeCurrent,
      navigationCommandScope,
    ).forEach((command) => registry.register(command));

    workbenchProblemNavigationCommands({
      shortcut,
      goToNextProblem,
      goToPreviousProblem,
    }).forEach((command) => registry.register(command));

    workbenchEditorHistoryCommands({
      shortcut,
      toggleGitBlame,
      openFileHistory,
      openLocalHistory,
    }).forEach((command) => registry.register(command));

    workbenchGitWorkflowCommands({
      shortcut,
      openGitStashPanel,
      openGitBranchPanel,
      createGitBranch,
      commitGitChanges,
      revertSelectedGitCommit,
      cherryPickSelectedGitCommit,
      rewordSelectedGitCommit,
      canRewordSelectedGitCommit,
    }).forEach((command) => registry.register(command));

    appearanceCommands.workbenchCommands.forEach((command) => registry.register(command));

    workbenchPanelCommands({
      canShowExpressRoutes: canShowWorkspaceExpressRoutes(workspaceRoot, workspaceDescriptor),
      canShowNette,
      canShowSymfony,
      openExpressRoutesPanel,
      shortcut,
      openCommandsPalette: () => {
        setClassOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setPaletteOpen(true);
        markFloatingSurfaceActivated();
      },
      showBottomPanelView,
      toggleBottomPanel,
      toggleTodoPanel,
      refreshWorkspaceTodos,
    }).forEach((command) => registry.register(command));

    workbenchBookmarkCommands({
      shortcut,
      toggleBookmarkAtCursor,
      goToNextBookmark,
      goToPreviousBookmark,
      toggleBookmarksPanel,
    }).forEach((command) => registry.register(command));

    workbenchSmartCommands({
      intelligenceMode,
      languageServerPlan,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      workspaceDescriptor,
      workspaceRoot,
      phpTools,
      installingManagedPhpactor,
      isLanguageServerActiveForWorkspace,
      toggleSmartMode,
      showPhpactorSetup: () => setLanguageServerSetupOpen(true),
      installManagedPhpactor,
      startLanguageServer,
      stopLanguageServer,
    }).forEach((command) => registry.register(command));

    workbenchIndexCommands({
      indexProgress,
      intelligenceMode,
      startHardReindex,
      startIndexScan,
      startPhpReindex,
    }).forEach((command) => registry.register(command));

    workbenchPhpTreeCommands({
      intelligenceMode,
      showPhpTree: () => setSidebarView("php"),
      refreshPhpTree,
    }).forEach((command) => registry.register(command));

    workbenchGitSidebarCommands({
      showGitSidebar: () => setSidebarView("git"),
      refreshGitStatus,
    }).forEach((command) => registry.register(command));

    workbenchAgentCommands({
      shortcut,
      toggleAgentMode,
      viewCommands: workbenchAgentViewCommandBridge,
    }).forEach((command) => registry.register(command));

    return registry;
  }, [
    activeDocument,
    openDocuments,
    captureNavigationCommandScope,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    nodePackageScriptsWorkbench,
    nodeRunWithoutDebugging,
    vscodeProcessTasksWorkbench,
    openArtisanMakePalette,
    openArtisanRoutesPanel,
    openExpressRoutesPanel,
    openPhpTestResultsPanel,
    activateWorkspaceTab,
    appSettings.keymap,
    appSettings.recentWorkspacePaths,
    appSettings.workspaceTabs,
    canReopenClosedDocument,
    canShowNette,
    canShowSymfony,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
    debugState,
    debugWatchAtCursor,
    jsTestDebugAtCursor,
    jsTestRerunLastRun,
    jsTestRunSelection,
    debugEvaluateInConsole,
    debugBreakpointNavigation,
    debugInlineBreakpoint,
    debugCopyStackTrace,
    debugCallStackNavigation,
    debugRestartFrame,
    openDebugPanel,
    attachNodeDebug,
    pauseDebug,
    startOrContinueDebug,
    startPhpListenDebug,
    stepDebug,
    stopDebug,
    toggleDebugBreakpointAtCursor,
    editorGroups,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    splitActiveEditorGroup,
    createDirectory,
    createFile,
    configureNodeLaunchConfigurations,
    deleteActiveDocument,
    generateTestForActiveDocument,
    goToTestForActiveDocument,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    openJsTestResultsPanel,
    runTestForActiveDocument,
    runAllTestsForActiveDocument,
    runJsTestForActiveDocument,
    runAllJsTestsForActiveDocument,
    runPhpstanAnalysis,
    phpstanAnalysisRunning,
    activePhpstanBufferClean,
    hasPhpstanDiagnosticAtCursor,
    ignorePhpstanIssueAtCursor,
    formatActiveFileWithPint,
    formatChangedFilesWithPint,
    pintRunning,
    runEslintAnalysis,
    eslintAnalysisRunning,
    activeEslintBufferClean,
    activeEslintFixes,
    disableEslintRuleAtCursor,
    fixAllEslintInActiveFile,
    hasEslintDiagnosticAtCursor,
    runInActiveTerminal,
    goToDeclaration,
    canSearchClassOpenSymbols,
    markFloatingSurfaceActivated,
    goToDefinition,
    goToImplementation,
    goToSourceDefinition,
    goToSuperMethod,
    goToTypeDefinition,
    gitDiffLoading,
    goToNextProblem,
    goToPreviousProblem,
    navigateBackward,
    navigateForwardInHistory,
    openCallHierarchy,
    openAppearanceSettingsPanel,
    openFileReferencesPanel,
    openFileStructure,
    openReferencesPanel,
    openRecentFilesSwitcher,
    openRecentLocationsPanel,
    openTypeHierarchy,
    openSettingsPanel,
    openWorkspaceSymbols,
    isNavigationCommandScopeCurrent,
    openSearchEverywhere,
    editorMenuCommandRunner,
    editorSurfaceCommandRunner,
    navigationHistory,
    openWorkspace,
    openWorkspacePath,
    quitApplication,
    refreshWorkspace,
    refreshGitStatus,
    refreshPhpTree,
    reopenClosedDocument,
    renameActiveDocument,
    saveActiveDocument,
    showBottomPanelView,
    startHardReindex,
    startLanguageServer,
    startIndexScan,
    startPhpReindex,
    installManagedPhpactor,
    installingManagedPhpactor,
    stopLanguageServer,
    toggleBottomPanel,
    toggleEditorFontLigatures,
    toggleTodoPanel,
    refreshWorkspaceTodos,
    toggleGitBlame,
    openFileHistory,
    openLocalHistory,
    openMarkdownPreview,
    openGitStashPanel,
    openGitBranchPanel,
    createGitBranch,
    commitGitChanges,
    revertSelectedGitCommit,
    cherryPickSelectedGitCommit,
    rewordSelectedGitCommit,
    canRewordSelectedGitCommit,
    toggleBookmarkAtCursor,
    goToNextBookmark,
    goToPreviousBookmark,
    toggleAgentMode,
    toggleBookmarksPanel,
    toggleSmartMode,
    toggleWorkspaceTrust,
    zoomEditorFontIn,
    zoomEditorFontOut,
    resetEditorFontSize,
    indexProgress,
    intelligenceMode,
    isLanguageServerActiveForWorkspace,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    selectedGitChange,
    workspaceDescriptor,
    workspaceRoot,
    phpTools,
    setClassOpenOpen,
    setLanguageServerSetupOpen,
    setPaletteOpen,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setSidebarView,
    setTextSearchOpen,
    setWorkspaceSymbolsOpen,
    workspaceTrust,
  ]);
}

export function canShowWorkspaceExpressRoutes(
  workspaceRoot: string | null | undefined,
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): boolean {
  return Boolean(
    workspaceRoot &&
    workspaceDescriptor?.javaScriptTypeScript &&
    workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath),
  );
}

const scopedNavigationCommandIds = new Set([
  "editor.goToDefinition",
  "editor.goToSourceDefinition",
  "editor.goToDeclaration",
  "editor.goToTypeDefinition",
  "editor.goToImplementation",
  "editor.goToSuperMethod",
  "editor.findReferences",
  "editor.findFileReferences",
  "editor.showCallHierarchy",
  "editor.showTypeHierarchy",
  "navigation.back",
  "navigation.forward",
]);

export function scopedNavigationCommands(
  commands: readonly Command[],
  isScopeCurrent: (scope: EditorSurfaceCommandInvocationScope) => boolean,
  defaultScope?: EditorSurfaceCommandInvocationScope,
): Command[] {
  return commands.map((command) => {
    if (!scopedNavigationCommandIds.has(command.id)) {
      return command;
    }

    return {
      ...command,
      isEnabled: (context) => {
        const scope = context.editorSurfaceScope ?? defaultScope;

        if (!scope || !isScopeCurrent(scope)) {
          return false;
        }

        return command.isEnabled(context);
      },
      run: (context) => {
        const scope = context?.editorSurfaceScope ?? defaultScope;

        if (!scope || !isScopeCurrent(scope)) {
          return;
        }

        return command.run(context);
      },
    };
  });
}
