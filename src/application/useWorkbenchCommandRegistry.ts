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
import type { NodePackageManager } from "../domain/packageManagerDetection";
import type { PackageScript } from "../domain/packageScripts";
import {
  shortcutForCommand,
  type KeymapCommandId,
} from "../domain/keymap";
import type { WorkspaceTrustState } from "../domain/trust";
import type {
  AppSettings,
} from "../domain/settings";
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
import type { StepKind } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { CommandRegistry, type Command } from "./commandRegistry";
import { workbenchArtisanCommands } from "./workbenchArtisanCommands";
import {
  isDebuggableNodeScriptPath,
  workbenchDebugCommands,
} from "./workbenchDebugCommands";
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
import { workbenchMarkdownCommands } from "./workbenchMarkdownCommands";
import { workbenchNavigationHistoryCommands } from "./workbenchNavigationHistoryCommands";
import { workbenchPanelCommands } from "./workbenchPanelCommands";
import { workbenchJsTestCommands } from "./workbenchJsTestCommands";
import { workbenchPhpTestCommands } from "./workbenchPhpTestCommands";
import { workbenchPhpstanCommands } from "./workbenchPhpstanCommands";
import { workbenchPintCommands } from "./workbenchPintCommands";
import { workbenchProblemNavigationCommands } from "./workbenchProblemNavigationCommands";
import { workbenchScriptCommands } from "./workbenchScriptCommands";
import { workbenchSmartCommands } from "./workbenchSmartCommands";
import { workbenchPhpTreeCommands } from "./workbenchPhpTreeCommands";
import { workbenchWorkspaceFileCommands } from "./workbenchWorkspaceFileCommands";
import { workbenchWorkspaceTabCommands } from "./workbenchWorkspaceTabCommands";
import { workbenchEslintCommands } from "./workbenchEslintCommands";

interface ActivePackageScripts {
  composerScripts: PackageScript[];
  hasArtisan: boolean;
  npmPackageManager: NodePackageManager;
  npmScripts: PackageScript[];
}

type CommandRun = Command["run"];
type NavigationRun = () => unknown;

interface UseWorkbenchCommandRegistryOptions {
  activeDocument: EditorDocument | null;
  captureNavigationCommandScope(): EditorSurfaceCommandInvocationScope;
  activeEslintBufferClean: boolean;
  activeEslintFixes: readonly unknown[];
  activeImage: ImageTab | null;
  activeMarkdownPreview: MarkdownPreviewTab | null;
  activePackageScripts: ActivePackageScripts | null | undefined;
  activePhpstanBufferClean: boolean;
  activateWorkspaceTab(root: string): unknown;
  appSettings: AppSettings;
  canReopenClosedDocument: boolean;
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
  debugSnapshot: DebuggerSessionSnapshot;
  deleteActiveDocument: CommandRun;
  disableEslintRuleAtCursor: CommandRun;
  openDebugPanel: CommandRun;
  pauseDebug: CommandRun;
  startOrContinueDebug: CommandRun;
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
  hasEslintDiagnosticAtCursor: boolean;
  hasPhpstanDiagnosticAtCursor: boolean;
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
  isNavigationCommandScopeCurrent(
    scope: EditorSurfaceCommandInvocationScope,
  ): boolean;
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
  setSidebarView(view: "git" | "php"): void;
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
    captureNavigationCommandScope,
    activeEslintBufferClean,
    activeEslintFixes,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    activePhpstanBufferClean,
    activateWorkspaceTab,
    appSettings,
    canReopenClosedDocument,
    canRewordSelectedGitCommit,
    canSearchClassOpenSymbols,
    cherryPickSelectedGitCommit,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
    closeDocument,
    commitGitChanges,
    createDirectory,
    createFile,
    createGitBranch,
    debugSnapshot,
    deleteActiveDocument,
    disableEslintRuleAtCursor,
    openDebugPanel,
    pauseDebug,
    startOrContinueDebug,
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
      hasJsWorkspace: Boolean(workspaceDescriptor?.javaScriptTypeScript),
      isActiveDocumentJsTest,
      runTestForActiveDocument: runJsTestForActiveDocument,
      runAllTestsForActiveDocument: runAllJsTestsForActiveDocument,
      openTestResultsPanel: openJsTestResultsPanel,
    }).forEach((command) => registry.register(command));

    workbenchDebugCommands({
      shortcut,
      hasJsWorkspace: Boolean(workspaceDescriptor?.javaScriptTypeScript),
      isActiveDocumentDebuggable:
        isActiveDocumentJsTest ||
        isDebuggableNodeScriptPath(activeDocument?.path ?? ""),
      isWorkspaceTrusted: workspaceTrust?.trusted === true,
      snapshot: debugSnapshot,
      openDebugPanel,
      pauseDebug,
      startOrContinueDebug,
      stepDebug,
      stopDebug,
      toggleBreakpointAtCursor: toggleDebugBreakpointAtCursor,
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
        activeDocument?.language === "php" &&
        activeDocument.path.endsWith(".php"),
      formatChangedFiles: formatChangedFilesWithPint,
      formatActiveFile: formatActiveFileWithPint,
    }).forEach((command) => registry.register(command));

    workbenchEslintCommands({
      hasPackageJson:
        workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson === true,
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
      npmPackageManager: activePackageScripts?.npmPackageManager ?? "npm",
      npmScripts: activePackageScripts?.npmScripts ?? [],
      runInActiveTerminal,
    }).forEach((command) => registry.register(command));

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
      activeDocument: activeDocumentLanguage,
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

    appearanceCommands.editorCommands.forEach((command) =>
      registry.register(command),
    );

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

    appearanceCommands.workbenchCommands.forEach((command) =>
      registry.register(command),
    );

    workbenchPanelCommands({
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

    return registry;
  }, [
    activeDocument,
    captureNavigationCommandScope,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    openArtisanMakePalette,
    openArtisanRoutesPanel,
    openPhpTestResultsPanel,
    activateWorkspaceTab,
    appSettings.keymap,
    appSettings.recentWorkspacePaths,
    appSettings.workspaceTabs,
    canReopenClosedDocument,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
    closeDocument,
    debugSnapshot,
    openDebugPanel,
    pauseDebug,
    startOrContinueDebug,
    stepDebug,
    stopDebug,
    toggleDebugBreakpointAtCursor,
    editorGroups,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    splitActiveEditorGroup,
    createDirectory,
    createFile,
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
    toggleBookmarksPanel,
    toggleSmartMode,
    toggleWorkspaceTrust,
    zoomEditorFontIn,
    zoomEditorFontOut,
    resetEditorFontSize,
    indexProgress,
    intelligenceMode,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    selectedGitChange,
    workspaceDescriptor,
    workspaceRoot,
    phpTools,
    workspaceTrust,
  ]);
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
