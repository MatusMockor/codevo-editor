import { useCallback } from "react";
import type { StatusBarItemVisibility } from "../../domain/settings";
import type { WorkspaceFileGateway, WorkspaceOwnerFileGateway } from "../../domain/workspace";
import type { DocumentSelfWriteCoordinator } from "../documentSelfWriteCoordinator";
import {
  relativeWorkspacePath,
  shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
  workspacePathBelongsToRoot,
} from "./workspacePathPolicy";
import { useBookmarks } from "../useBookmarks";
import { useLocalHistory } from "../useLocalHistory";
import { useNavigationHistory } from "../useNavigationHistory";
import { useWorkbenchFileOperations } from "../useWorkbenchFileOperations";
import { useWorkspaceTodos } from "../useWorkspaceTodos";
import { useWorkbenchEditorDocumentCoordinator } from "./useWorkbenchEditorDocumentCoordinator";
import { useWorkbenchEditorFileCoordinator } from "./useWorkbenchEditorFileCoordinator";
import { useWorkbenchDocumentSaveCloseCoordinator } from "./useWorkbenchDocumentSaveCloseCoordinator";
import { useWorkbenchFrameworkIntelligenceCoordinator } from "./useWorkbenchFrameworkIntelligenceCoordinator";
import {
  useWorkbenchGitHistoryCoordinator,
  useWorkbenchGitPanelsCoordinator,
} from "./useWorkbenchGitCoordinator";
import { useWorkbenchSmartModeCoordinator } from "./useWorkbenchLanguageRuntimeCoordinator";
import {
  useWorkbenchTaskDebugCoordinator,
  useWorkbenchTaskDebugNavigationCoordinator,
} from "./useWorkbenchTaskDebugCoordinator";
import { useWorkbenchLanguageNavigation } from "../useWorkbenchLanguageNavigation";
import type { useEditorSessionState } from "../useEditorSessionState";
import type { WorkbenchControllerOptions } from "../workbenchControllerContracts";

type Smart = Parameters<typeof useWorkbenchSmartModeCoordinator>[0];
type EditorDocumentInput = Parameters<typeof useWorkbenchEditorDocumentCoordinator>[0];
type EditorDocumentFlat = EditorDocumentInput["activeEditing"] &
  EditorDocumentInput["authority"] &
  EditorDocumentInput["commandContext"] &
  EditorDocumentInput["markdown"] &
  EditorDocumentInput["navigation"] &
  EditorDocumentInput["navigationScope"] &
  EditorDocumentInput["phpCodeAction"] &
  EditorDocumentInput["testNavigation"] &
  Pick<EditorDocumentInput, "openSymbolPanelNavigationTargetRef">;
type TaskDebug = Parameters<typeof useWorkbenchTaskDebugCoordinator>[0];
type TaskNavigation = Parameters<typeof useWorkbenchTaskDebugNavigationCoordinator>[0];
type Bookmarks = Parameters<typeof useBookmarks>[0];
type GitHistoryInput = Parameters<typeof useWorkbenchGitHistoryCoordinator>[0];
type GitHistoryFlat = GitHistoryInput["fileHistory"] &
  GitHistoryInput["fileActions"] &
  Pick<
    GitHistoryInput,
    "currentWorkspaceRootRef" | "refreshGitStatus" | "setMessage" | "workspaceRequestTokenRef"
  >;
type LocalHistory = Parameters<typeof useLocalHistory>[0];
type GitPanelsInput = Parameters<typeof useWorkbenchGitPanelsCoordinator>[0];
type GitPanelsFlat = GitPanelsInput["stashPanel"] & GitPanelsInput["branchPanel"];
type Framework = Parameters<typeof useWorkbenchFrameworkIntelligenceCoordinator>[0];
type LanguageNavigation = Parameters<typeof useWorkbenchLanguageNavigation>[0];
type NavigationHistory = Parameters<typeof useNavigationHistory>[0];
type FileOperations = Parameters<typeof useWorkbenchFileOperations>[0];
type EditorSession = Pick<
  ReturnType<typeof useEditorSessionState>,
  | "activeDocument"
  | "activeDocumentRef"
  | "activeGroupId"
  | "activePath"
  | "documents"
  | "documentsRef"
  | "isDocumentSessionLifecycleAuthorityCurrent"
  | "isEditorGroupDocumentSessionAuthorityCurrent"
  | "markdownPreviewTabsRef"
  | "openPathsRef"
  | "previewPathRef"
  | "resolveActiveDocumentSessionAuthority"
  | "resolveDocumentSessionLifecycleAuthority"
  | "setActivePath"
  | "setDocuments"
  | "setMarkdownPreviewTabs"
  | "setOpenPaths"
  | "setPreviewPath"
  | "updateDocumentContent"
  | "updateEditorGroups"
>;
type EditorFileResult = ReturnType<typeof useWorkbenchEditorFileCoordinator>;
interface EditorFile {
  readonly directory: Pick<EditorFileResult["directory"], "refreshDirectory">;
  readonly documentTabs: Pick<EditorFileResult["documentTabs"], "openFile" | "pinDocument">;
  readonly workspaceEdits: Pick<
    EditorFileResult["workspaceEdits"],
    | "applyJavaScriptTypeScriptCreateEdits"
    | "applyJavaScriptTypeScriptDeleteEdits"
    | "applyJavaScriptTypeScriptRenameEdits"
    | "applyPhpRenameEdits"
    | "notifyJavaScriptTypeScriptFileCreated"
    | "notifyJavaScriptTypeScriptFileDeleted"
    | "notifyJavaScriptTypeScriptFileRenamed"
    | "notifyJavaScriptTypeScriptWatchedFilesChanged"
    | "notifyPhpFileRenamed"
  >;
}
type DocumentSaveCloseResult = ReturnType<typeof useWorkbenchDocumentSaveCloseCoordinator>;
interface DocumentSaveClose {
  readonly saveAuthority: Pick<
    DocumentSaveCloseResult["saveAuthority"],
    "ownerDocumentSaveAdapters"
  >;
  readonly documentLifecycle: Pick<
    DocumentSaveCloseResult["documentLifecycle"],
    | "captureLocalHistorySnapshot"
    | "closeDocument"
    | "isWorkspaceTrusted"
    | "requestOwnerDocumentSave"
    | "runWithDocumentSaveExclusion"
    | "workspaceTrustedRef"
  >;
}
type DocumentSaveCloseInput = Parameters<typeof useWorkbenchDocumentSaveCloseCoordinator>[0];

type WorkspaceFacet = Pick<
  TaskDebug,
  | "currentEditorSessionOwnerKeyRef"
  | "currentWorkspaceRootRef"
  | "editorSessionOwnerKey"
  | "workspaceDescriptor"
  | "workspaceDiscoveryVersions"
  | "workspaceFiles"
  | "workspaceIdentityDescriptor"
  | "workspaceOwnerFiles"
  | "workspaceRoot"
  | "workspaceRuntimeOwner"
  | "workspaceRuntimeOwnerClaimsRef"
  | "workspaceRuntimeOwnerRef"
  | "workspaceTrusted"
> &
  Pick<Framework, "resolveCurrentWorkspaceRuntimeOwner" | "resolveWorkspaceRuntimeOwner"> &
  Pick<EditorDocumentFlat, "workspaceIdentityDescriptorRef"> & {
    readonly openWorkspaceRequestTokenRef: GitHistoryInput["workspaceRequestTokenRef"];
  };

type PresentationFacet = Pick<
  EditorDocumentFlat,
  | "activeEditorPositionRef"
  | "markdownPreviewRenderer"
  | "noticesRef"
  | "openMarkdownPreviews"
  | "openSymbolPanelNavigationTargetRef"
  | "setClassOpenOpen"
  | "setEditorRevealTarget"
  | "setExpandedDirectories"
  | "setMessage"
  | "setQuickOpenOpen"
  | "setRecentFilesSwitcherOpen"
  | "setSearchEverywhereOpen"
  | "setWorkspaceSymbolsOpen"
> &
  Pick<Bookmarks, "bookmarks" | "setBookmarks"> &
  Pick<TaskNavigation, "setBottomPanelView" | "setBottomPanelVisible"> &
  Pick<LanguageNavigation, "setImplementationChooser"> &
  Pick<Framework, "setNotices"> &
  Pick<TaskNavigation, "setJsTestRunRequestVersion" | "setPhpTestRunRequestVersion"> &
  Pick<
    FileOperations,
    "setEntriesByDirectory" | "setManuallyCollapsedDirectories" | "sidebarView"
  > &
  Pick<GitHistoryFlat, "setGitBlameEnabledPaths"> & {
    readonly closeBookmarksPanelRef: { current: () => void };
    readonly resetWorkspaceTodosRef: { current: () => void };
  };

type NavigationFacet = Pick<
  EditorDocumentFlat,
  | "currentNavigationLocation"
  | "editorSurfaceCommandRunner"
  | "forgetRecentFile"
  | "recordNavigationLocationSnapshot"
> &
  Pick<LanguageNavigation, "documentOffsetAtEditorPosition" | "identifierAtEditorPosition"> &
  Pick<Framework, "projectSymbolSearch"> &
  Pick<
    NavigationHistory,
    | "forgetRecentLocationsForPath"
    | "navigationHistory"
    | "recordCurrentNavigationLocation"
    | "setNavigationHistory"
    | "setRecentLocationsPanelOpen"
  > &
  Pick<FileOperations, "remapRecentFile" | "remapRecentLocations">;

type LanguageFacet = Pick<
  Framework,
  | "activePhpFrameworkProviders"
  | "contextualDiagnosticsFilterRef"
  | "currentPhpFrameworkSourceContext"
  | "ensurePhpFrameworkSourceCollectionsLoaded"
  | "fileSearch"
  | "getPhpDocumentSyncVersion"
  | "intelligenceMode"
  | "invalidatePhpFrameworkBindingCacheRef"
  | "isPhpFrameworkBindingDependencyPathRef"
  | "languageServerDiagnosticsByRootRef"
  | "phpClassSourcePathCacheRef"
  | "phpFrameworkBindingCacheRef"
  | "phpFrameworkIntelligence"
  | "phpFrameworkNavigationGenerationRef"
  | "phpFrameworkRuntimeContext"
  | "readTestFileIfExists"
  | "reclassifyPhpLanguageServerDiagnosticsForRootRef"
  | "resetPhpClassMemberCacheRef"
  | "resetPhpFrameworkCachesRef"
  | "resetPhpFrameworkMorphMapModelTypeCacheRef"
  | "resetPhpFrameworkSourceRegistries"
  | "setFrameworkDiagnosticsByPath"
  | "setLanguageServerDiagnosticsByPath"
  | "textSearch"
> &
  Pick<
    LanguageNavigation,
    | "flushPendingJavaScriptTypeScriptDocumentChange"
    | "isJavaScriptTypeScriptLanguageServerSessionActiveForRoot"
    | "isLanguageServerDocumentRequestLeaseCurrent"
    | "isLanguageServerSessionActiveForRoot"
    | "javaScriptTypeScriptLanguageServerFeaturesGateway"
    | "javaScriptTypeScriptLanguageServerRuntimeStatus"
    | "javaScriptTypeScriptLanguageServerRuntimeStatusRoot"
    | "languageServerFeaturesGateway"
    | "languageServerRuntimeStatus"
    | "languageServerRuntimeStatusRoot"
    | "latencyTrackerForRoot"
    | "reportLanguageServerErrorForActiveWorkspaceRoot"
    | "requestLanguageServerDocumentLease"
  > &
  Pick<
    FileOperations,
    | "clearLanguageServerDiagnosticsForPath"
    | "invalidatePhpFrameworkSourcePath"
    | "javaScriptTypeScriptDiagnosticsByPath"
    | "languageServerDiagnosticsByPath"
    | "phpLocalDiagnosticsByPath"
  > &
  Pick<EditorDocumentFlat, "updateLocalPhpDiagnostics">;

type PersistenceFacet = Pick<
  FileOperations,
  | "filePrefetchCacheRef"
  | "reportChangedDocuments"
  | "reportErrorForActiveWorkspaceRoot"
  | "syncClosedDocument"
  | "syncClosedJavaScriptTypeScriptDocument"
> &
  Pick<LocalHistory, "localHistoryGateway" | "reportError"> & {
    readonly documentSelfWrites: DocumentSelfWriteCoordinator;
    readonly resolveDocumentSaveOwnership: NonNullable<
      FileOperations["resolveDocumentSaveOwnership"]
    >;
    readonly syncSavedDocumentForRoot: DocumentSaveCloseInput["saveAuthority"]["syncSavedDocumentForRoot"];
    readonly syncSavedJavaScriptTypeScriptDocumentForRoot: DocumentSaveCloseInput["saveAuthority"]["syncSavedJavaScriptTypeScriptDocumentForRoot"];
  };

type GitFacet = Pick<
  GitHistoryFlat,
  "gitGateway" | "refreshGitStatus" | "resolveGitRepositoryTarget"
> &
  Pick<GitPanelsFlat, "prompter">;

type TasksFacet = Pick<
  TaskDebug,
  | "debugGateway"
  | "invalidateJsTestCoverageAndResults"
  | "isActiveDocumentJsTest"
  | "isActiveDocumentPhpTest"
  | "openDocuments"
  | "terminalGateway"
> & {
  readonly options: TaskDebug["options"];
  readonly revealPathGateway: TaskNavigation["revealPathGateway"];
};

type FileSystemFacet = Pick<
  FileOperations,
  "forgetExternallyRemovedDocumentPath" | "markExternallyRemovedDocumentPath"
>;

interface WorkbenchEditorNavigationCoordinatorDependencies {
  readonly smartMode: Smart;
  readonly editorSession: EditorSession;
  readonly editorFile: EditorFile;
  readonly documentSaveClose: DocumentSaveClose;
  readonly workspace: WorkspaceFacet;
  readonly presentation: PresentationFacet;
  readonly navigation: NavigationFacet;
  readonly language: LanguageFacet;
  readonly persistence: PersistenceFacet;
  readonly git: GitFacet;
  readonly tasks: TasksFacet;
  readonly fileSystem: FileSystemFacet;
}

export function editorNavigationTaskOptionsFor(
  options: WorkbenchControllerOptions,
): TaskDebug["options"] {
  return {
    debugAddToWatchCommands: options.debugAddToWatchCommands,
    debugBreakpointNavigationCaptureReader: options.debugBreakpointNavigationCaptureReader,
    debugBreakpointStorage: options.debugBreakpointStorage,
    debugCopyEvaluatePathOnce: options.debugCopyEvaluatePathOnce,
    debugCopyValueCommands: options.debugCopyValueCommands,
    debugEvaluateInConsoleCaptureReader: options.debugEvaluateInConsoleCaptureReader,
    debugInlineBreakpointCaptureReader: options.debugInlineBreakpointCaptureReader,
    debugSetVariableCommands: options.debugSetVariableCommands,
    debugTextClipboard: options.debugTextClipboard,
    debugWatchAtCursorCaptureReader: options.debugWatchAtCursorCaptureReader,
    jsTestExplorerScopeRunner: options.jsTestExplorerScopeRunner,
    nodeDebugAttachCandidateGateway: options.nodeDebugAttachCandidateGateway,
    nodeDebugAttachCandidateStart: options.nodeDebugAttachCandidateStart,
    nodePackageScriptsGateway: options.nodePackageScriptsGateway,
    nodeRunTaskGateway: options.nodeRunTaskGateway,
    serverReadyExternalUrlOpener: options.serverReadyExternalUrlOpener,
    vscodeProcessTasksGateway: options.vscodeProcessTasksGateway,
    workspaceSourceDiscoveryGateway: options.workspaceSourceDiscoveryGateway,
  };
}

export function useWorkbenchEditorNavigationCoordinator({
  smartMode,
  editorSession,
  editorFile,
  documentSaveClose,
  workspace,
  presentation,
  navigation,
  language,
  persistence,
  git,
  tasks,
  fileSystem,
}: WorkbenchEditorNavigationCoordinatorDependencies) {
  const {
    activeDocument,
    activeDocumentRef,
    activeGroupId,
    activePath,
    documents,
    documentsRef,
    markdownPreviewTabsRef,
    openPathsRef,
    previewPathRef,
    setActivePath,
    setDocuments,
    setMarkdownPreviewTabs: editorSetMarkdownPreviewTabs,
    setOpenPaths,
    setPreviewPath,
    updateDocumentContent,
    updateEditorGroups,
    isDocumentSessionLifecycleAuthorityCurrent,
    isEditorGroupDocumentSessionAuthorityCurrent,
    resolveActiveDocumentSessionAuthority,
    resolveDocumentSessionLifecycleAuthority,
  } = editorSession;
  const {
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    editorSessionOwnerKey,
    openWorkspaceRequestTokenRef,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveWorkspaceRuntimeOwner,
    workspaceDescriptor,
    workspaceDiscoveryVersions,
    workspaceFiles,
    workspaceIdentityDescriptor,
    workspaceIdentityDescriptorRef,
    workspaceOwnerFiles,
    workspaceRoot,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceTrusted,
  } = workspace;
  const {
    activeEditorPositionRef,
    bookmarks,
    closeBookmarksPanelRef,
    markdownPreviewRenderer,
    noticesRef,
    openMarkdownPreviews,
    openSymbolPanelNavigationTargetRef,
    resetWorkspaceTodosRef,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setClassOpenOpen,
    setEditorRevealTarget,
    setEntriesByDirectory,
    setExpandedDirectories,
    setGitBlameEnabledPaths,
    setImplementationChooser,
    setJsTestRunRequestVersion,
    setManuallyCollapsedDirectories,
    setMessage,
    setNotices,
    setPhpTestRunRequestVersion,
    setQuickOpenOpen,
    setRecentFilesSwitcherOpen,
    setSearchEverywhereOpen,
    setWorkspaceSymbolsOpen,
    sidebarView,
  } = presentation;
  const {
    currentNavigationLocation,
    documentOffsetAtEditorPosition,
    editorSurfaceCommandRunner,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    identifierAtEditorPosition,
    navigationHistory: navigationHistoryState,
    projectSymbolSearch,
    recordCurrentNavigationLocation,
    recordNavigationLocationSnapshot,
    remapRecentFile,
    remapRecentLocations,
    setNavigationHistory,
    setRecentLocationsPanelOpen,
  } = navigation;
  const {
    activePhpFrameworkProviders,
    clearLanguageServerDiagnosticsForPath,
    contextualDiagnosticsFilterRef,
    currentPhpFrameworkSourceContext,
    ensurePhpFrameworkSourceCollectionsLoaded,
    fileSearch,
    flushPendingJavaScriptTypeScriptDocumentChange,
    getPhpDocumentSyncVersion,
    intelligenceMode,
    invalidatePhpFrameworkBindingCacheRef,
    invalidatePhpFrameworkSourcePath,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    isLanguageServerDocumentRequestLeaseCurrent,
    isLanguageServerSessionActiveForRoot,
    isPhpFrameworkBindingDependencyPathRef,
    javaScriptTypeScriptDiagnosticsByPath,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerDiagnosticsByPath,
    languageServerDiagnosticsByRootRef,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    phpClassSourcePathCacheRef,
    phpFrameworkBindingCacheRef,
    phpFrameworkIntelligence,
    phpFrameworkNavigationGenerationRef,
    phpFrameworkRuntimeContext,
    phpLocalDiagnosticsByPath,
    readTestFileIfExists,
    reclassifyPhpLanguageServerDiagnosticsForRootRef,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    requestLanguageServerDocumentLease,
    resetPhpClassMemberCacheRef,
    resetPhpFrameworkCachesRef,
    resetPhpFrameworkMorphMapModelTypeCacheRef,
    resetPhpFrameworkSourceRegistries,
    setFrameworkDiagnosticsByPath,
    setLanguageServerDiagnosticsByPath,
    textSearch,
    updateLocalPhpDiagnostics,
  } = language;
  const {
    documentSelfWrites,
    filePrefetchCacheRef,
    localHistoryGateway,
    reportChangedDocuments,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    resolveDocumentSaveOwnership,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    syncSavedDocumentForRoot,
    syncSavedJavaScriptTypeScriptDocumentForRoot,
  } = persistence;
  const { gitGateway, prompter, refreshGitStatus, resolveGitRepositoryTarget } = git;
  const {
    debugGateway,
    invalidateJsTestCoverageAndResults,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    openDocuments,
    options: taskOptions,
    revealPathGateway,
    terminalGateway,
  } = tasks;
  const { forgetExternallyRemovedDocumentPath, markExternallyRemovedDocumentPath } = fileSystem;
  const {
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot: smartModeReportError,
    workspaceSettingsRef,
  } = smartMode;
  const reportErrorForActiveWorkspaceRootResolved =
    reportErrorForActiveWorkspaceRoot ?? smartModeReportError;
  const setStatusBarItemVisibility = useCallback(
    async (key: keyof StatusBarItemVisibility, visible: boolean) => {
      const requestedRoot = workspaceRoot;
      if (!requestedRoot) {
        return;
      }

      try {
        await persistWorkspaceSettings(requestedRoot, {
          ...workspaceSettingsRef.current,
          statusBar: {
            ...workspaceSettingsRef.current.statusBar,
            [key]: visible,
          },
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRootResolved(requestedRoot, "Status Bar", error);
      }
    },
    [
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRootResolved,
      workspaceRoot,
      workspaceSettingsRef,
    ],
  );
  const setSmartMode = useWorkbenchSmartModeCoordinator(smartMode);

  const {
    activateSearchEverywhereItem,
    applyPhpCodeActionNewFile,
    captureNavigationCommandScope,
    commandContext,
    generateTestForActiveDocument,
    goToNextProblem,
    goToPreviousProblem,
    goToTestForActiveDocument,
    isNavigationCommandScopeCurrent,
    navigationSurfaceIdentity,
    openClassSearchResult,
    openCurrentFileLocation,
    openMarkdownPreview,
    openNavigationTarget,
    openPathForNavigation,
    openProblemNotice,
    openRecentFile,
    openSearchResult,
    openWorkspaceSymbolResult,
    readNavigationFileContent,
    revertActiveEditorChangeHunk,
    updateActiveDocument,
  } = useWorkbenchEditorDocumentCoordinator({
    activeEditing: {
      activeDocument,
      activeDocumentRef,
      activePhpFrameworkProviders,
      invalidatePhpFrameworkBindingCacheRef,
      isPhpFrameworkBindingDependencyPathRef,
      phpFrameworkRuntimeContext,
      pinDocument: editorFile.documentTabs.pinDocument,
      reportChangedDocuments,
      resetPhpFrameworkMorphMapModelTypeCacheRef,
      setDocuments,
      updateDocumentContent,
      updateLocalPhpDiagnostics,
    },
    authority: {
      activeDocumentRef,
      currentWorkspaceRootRef,
      isDocumentSessionLifecycleAuthorityCurrent,
      isEditorGroupDocumentSessionAuthorityCurrent,
      resolveActiveDocumentSessionAuthority,
      resolveDocumentSessionLifecycleAuthority,
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
    },
    commandContext: {
      activeDocument,
      workspaceRoot,
    },
    markdown: {
      documents,
      documentsRef,
      markdownPreviewRenderer,
      markdownPreviewTabsRef,
      openMarkdownPreviews,
      openPathsRef,
      previewPathRef,
      reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
      setActivePath,
      setMarkdownPreviewTabs: editorSetMarkdownPreviewTabs,
      updateEditorGroups,
      workspaceRoot,
    },
    navigation: {
      activeDocumentRef,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      documentsRef,
      noticesRef,
      workspaceFiles,
      openFile: editorFile.documentTabs.openFile,
      currentNavigationLocation,
      forgetRecentFile,
      recordNavigationLocationSnapshot,
      reportError,
      setClassOpenOpen,
      setEditorRevealTarget,
      setMessage,
      setQuickOpenOpen,
      setRecentFilesSwitcherOpen,
      setSearchEverywhereOpen,
      setWorkspaceSymbolsOpen,
    },
    navigationScope: {
      activeDocumentRef,
      activeGroupId,
      activePath,
      currentEditorSessionOwnerKeyRef,
      editorSessionOwnerKey,
      editorSurfaceCommandRunner,
    },
    openSymbolPanelNavigationTargetRef,
    phpCodeAction: {
      workspaceRoot,
      currentWorkspaceRootRef,
      workspaceFiles,
      workspaceIdentityDescriptorRef,
      workspaceOwnerFiles,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      setExpandedDirectories,
      notifyJavaScriptTypeScriptWatchedFilesChanged:
        editorFile.workspaceEdits.notifyJavaScriptTypeScriptWatchedFilesChanged,
      openFile: editorFile.documentTabs.openFile,
      readTestFileIfExists,
      refreshDirectory: editorFile.directory.refreshDirectory,
      reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    },
    testNavigation: {
      activeDocumentRef,
      currentWorkspaceRootRef,
      notifyJavaScriptTypeScriptWatchedFilesChanged:
        editorFile.workspaceEdits.notifyJavaScriptTypeScriptWatchedFilesChanged,
      openFile: editorFile.documentTabs.openFile,
      readTestFileIfExists,
      refreshDirectory: editorFile.directory.refreshDirectory,
      reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
      setExpandedDirectories,
      setMessage,
      workspaceDescriptor,
      workspaceFiles,
      workspaceOwnerFiles,
      workspaceRoot,
    },
  });
  const {
    hideBottomPanel,
    registerActiveTerminalSession,
    runAllJsTestsForActiveDocument,
    runAllTestsForActiveDocument,
    runInActiveTerminal,
    runJsTestForActiveDocument,
    runTestAt,
    runTestForActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
    openNodePackageScript,
    nodePackageScripts,
    vscodeProcessTaskComposition,
    attachNodeDebug,
    debugCopyStackTrace,
    debugSession,
    debugStoppedLocation,
    nodeDebugAttachProcessPicker,
    openDebugLocation,
    openDebugPanel,
    startOrContinueDebug,
    startPhpListenDebug,
    toggleDebugBreakpointAtCursor,
    debugWatchAtCursor,
    jsTestDebugAtCursor,
    jsTestRunSelection,
    debugEvaluateInConsole,
    debugBreakpointNavigation,
    debugCallStackNavigation,
    debugRestartFrame,
    debugInlineBreakpoint,
    nodeRunWithoutDebugging,
    nodeLaunchConfigurationsSurface,
  } = useWorkbenchTaskDebugCoordinator({
    activeDocument,
    activeDocumentRef,
    activeEditorPositionRef,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    debugGateway,
    editorSessionOwnerKey,
    invalidateJsTestCoverageAndResults,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    isEditorGroupDocumentSessionAuthorityCurrent,
    isWorkspaceTrusted: documentSaveClose.documentLifecycle.isWorkspaceTrusted,
    openDocuments,
    openFile: editorFile.documentTabs.openFile,
    openNavigationTarget,
    options: taskOptions,
    prompter,
    readTestFileIfExists,
    resolveActiveDocumentSessionAuthority,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    setBottomPanelView,
    setBottomPanelVisible,
    setMessage,
    setNotices,
    terminalGateway,
    workspaceDescriptor,
    workspaceDiscoveryVersions,
    workspaceFiles,
    workspaceIdentityDescriptor,
    workspaceOwnerFiles,
    workspaceRoot,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceTrusted,
    workspaceTrustedRef: documentSaveClose.documentLifecycle.workspaceTrustedRef,
  });
  const {
    openEntryInTerminal,
    openArtisanRoutesPanel,
    openExpressRoutesPanel,
    openJsTestResultsPanel,
    openPhpTestResultsPanel,
    openPhpTestCase,
    openArtisanController,
    revealEntry,
  } = useWorkbenchTaskDebugNavigationCoordinator({
    activeDocumentRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
    projectSymbolSearch,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    revealPathGateway,
    runInActiveTerminal,
    setBottomPanelView,
    setBottomPanelVisible,
    setJsTestRunRequestVersion,
    setMessage,
    setPhpTestRunRequestVersion,
    workspaceDescriptor,
    workspaceRoot,
    workspaceRuntimeOwnerRef,
  });

  const {
    todoPanelOpen,
    workspaceTodos,
    workspaceTodosLoading,
    refreshWorkspaceTodos,
    openWorkspaceTodo,
    openTodoPanel,
    closeTodoPanel,
    toggleTodoPanel,
    resetWorkspaceTodos,
  } = useWorkspaceTodos({
    workspaceFiles,
    currentWorkspaceRootRef,
    workspaceRoot,
    openNavigationTarget,
    relativeWorkspacePath,
  });

  const {
    bookmarksPanelOpen,
    toggleBookmarkAtLine,
    toggleBookmarkAtCursor,
    openBookmark,
    goToNextBookmark,
    goToPreviousBookmark,
    openBookmarksPanel,
    closeBookmarksPanel,
    toggleBookmarksPanel,
  } = useBookmarks({
    bookmarks,
    setBookmarks,
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
  });
  closeBookmarksPanelRef.current = closeBookmarksPanel;
  resetWorkspaceTodosRef.current = resetWorkspaceTodos;

  const {
    fileHistoryPanelOpen,
    fileHistoryRelativePath,
    fileHistoryCommits,
    fileHistoryLoading,
    fileHistorySelectedSha,
    fileHistoryDiff,
    fileHistoryDiffLoading,
    openFileHistory,
    selectFileHistoryCommit,
    closeFileHistory,
    openWorkspaceFile,
    provideGitBlame,
    readWorkspaceFile,
    revealCommitInFileHistory,
    toggleGitBlame,
    revertSelectedGitCommit,
    cherryPickSelectedGitCommit,
    rewordSelectedGitCommit,
    canRewordSelectedGitCommit,
  } = useWorkbenchGitHistoryCoordinator({
    currentWorkspaceRootRef,
    fileHistory: {
      activeDocumentRef,
      currentWorkspaceRootRef,
      gitGateway,
      reportError,
      resolveGitRepositoryTarget,
      workspaceRoot,
    },
    fileActions: {
      activeDocumentRef,
      currentWorkspaceRootRef,
      gitGateway,
      openFile: editorFile.documentTabs.openFile,
      resolveGitRepositoryTarget,
      setGitBlameEnabledPaths,
      showBottomPanelView,
      workspaceFiles,
    },
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef: openWorkspaceRequestTokenRef,
  });

  const {
    localHistoryPanelOpen,
    localHistoryRelativePath,
    localHistoryVersions,
    localHistoryLoading,
    localHistorySelectedId,
    localHistoryDiff,
    localHistoryDiffLoading,
    openLocalHistory,
    selectLocalHistoryVersion,
    revertLocalHistoryVersion,
    closeLocalHistory,
  } = useLocalHistory({
    activeDocumentRef,
    beginOwnerDocumentSelfWrite: (owner, rootPath, path, content) => {
      if (!documentSaveClose.saveAuthority.ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return null;
      }
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return null;
      }
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      return ownership ? documentSelfWrites.begin(ownership, content) : null;
    },
    captureLocalHistorySnapshot: async (owner, rootPath, path, content) => {
      if (!documentSaveClose.saveAuthority.ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return;
      }
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return;
      }
      await documentSaveClose.documentLifecycle.captureLocalHistorySnapshot(
        rootPath,
        path,
        content,
      );
    },
    currentWorkspaceRootRef,
    invalidateOwnerDocumentPrefetch: (owner, path) => {
      if (!documentSaveClose.saveAuthority.ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return;
      }
      filePrefetchCacheRef.current.invalidate(path);
    },
    localHistoryGateway,
    ownerDocumentSaveRepository:
      documentSaveClose.saveAuthority.ownerDocumentSaveAdapters.repository,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveDocumentSaveOwnership,
    reportError,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    requestOwnerDocumentSave: documentSaveClose.documentLifecycle.requestOwnerDocumentSave,
    setMessage,
    syncSavedDocument: async (owner, rootPath, document, shouldEmit) => {
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return;
      }
      await syncSavedDocumentForRoot(rootPath, document, shouldEmit);
    },
    syncSavedJavaScriptTypeScriptDocument: async (owner, rootPath, document, shouldEmit) => {
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return;
      }
      await syncSavedJavaScriptTypeScriptDocumentForRoot(rootPath, document, shouldEmit);
    },
    writeOwnerDocument: async (owner, rootPath, document, content) => {
      if (!documentSaveClose.saveAuthority.ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return { status: "error", message: "Workspace owner is stale." };
      }
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return { status: "error", message: "Workspace owner is stale." };
      }
      if (!document.revision) {
        return {
          status: "error",
          message: "Reload the file before restoring Local History.",
        };
      }

      const ownerWriter = workspaceFiles as WorkspaceFileGateway &
        Partial<WorkspaceOwnerFileGateway>;
      if (!ownerWriter.writeTextFileForWorkspace) {
        return {
          status: "error",
          message: "The workspace does not support owner-scoped writes.",
        };
      }

      return ownerWriter.writeTextFileForWorkspace(
        owner.ownerKey,
        document.path,
        content,
        document.revision,
      );
    },
    workspaceRoot,
  });

  const {
    gitStashPanelOpen,
    gitStashEntries,
    gitStashLoading,
    gitStashMessage,
    gitStashSelectedIndex,
    gitStashDiff,
    gitStashDiffLoading,
    openGitStashPanel,
    closeGitStashPanel,
    selectGitStash,
    saveGitStash,
    applyGitStash,
    popGitStash,
    dropGitStash,
    setGitStashMessage,
    gitBranchPanelOpen,
    gitBranchEntries,
    gitRemoteBranchEntries,
    gitBranchLoading,
    openGitBranchPanel,
    closeGitBranchPanel,
    switchGitBranch,
    checkoutRemoteBranch,
    createGitBranch,
    deleteGitBranch,
    renameGitBranch,
    refreshGitBranches,
  } = useWorkbenchGitPanelsCoordinator({
    stashPanel: {
      gitGateway,
      currentWorkspaceRootRef,
      workspaceRoot,
      reportError,
      refreshGitStatus,
      setMessage,
      prompter,
    },
    branchPanel: {
      gitGateway,
      currentWorkspaceRootRef,
      workspaceRoot,
      reportError,
      refreshGitStatus,
      setMessage,
      prompter,
    },
  });

  const {
    frameworkIntelligenceProviders,
    goToContextualPhpDefinition,
    goToIndexedPhpImplementation,
    goToIndexedSymbolDefinition,
    goToSuperMethod,
    invalidateFrameworkCachesForPath,
    invalidatePhpFrameworkBindingsForFileChange,
    invalidatePhpTraitHostClassNames,
    openPhpClassTarget,
    openSymfonyRouteController,
    openSymfonyService,
    provideBladeDefinition,
    provideLatteDefinitionOutcome,
    provideNeonDefinition,
    providePhpCodeActions,
    providePhpFrameworkDefinition,
    providePhpMethodCompletions,
    providePhpMethodSignature,
    providePhpParameterInlayHints,
  } = useWorkbenchFrameworkIntelligenceCoordinator({
    activeDocument,
    activeDocumentRef,
    activeEditorPositionRef,
    activePhpFrameworkProviders,
    contextualDiagnosticsFilterRef,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRootRef,
    documentsRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    fileSearch,
    getPhpDocumentSyncVersion,
    intelligenceMode,
    invalidatePhpFrameworkBindingCacheRef,
    isPhpFrameworkBindingDependencyPathRef,
    languageServerDiagnosticsByRootRef,
    openNavigationTarget,
    phpClassSourcePathCacheRef,
    phpFrameworkBindingCacheRef,
    phpFrameworkIntelligence,
    phpFrameworkNavigationGenerationRef,
    phpFrameworkRuntimeContext,
    projectSymbolSearch,
    readNavigationFileContent,
    readTestFileIfExists,
    reclassifyPhpLanguageServerDiagnosticsForRootRef,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    resetPhpClassMemberCacheRef,
    resetPhpFrameworkCachesRef,
    resetPhpFrameworkMorphMapModelTypeCacheRef,
    resetPhpFrameworkSourceRegistries,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveWorkspaceRuntimeOwner,
    setFrameworkDiagnosticsByPath,
    setImplementationChooser,
    setLanguageServerDiagnosticsByPath,
    setMessage,
    setNotices,
    textSearch,
    workspaceDescriptor,
    workspaceFiles,
    workspaceRoot,
    workspaceRuntimeOwnerRef,
  });
  const {
    goToDeclaration,
    goToDefinition,
    goToImplementation,
    goToImplementationAt,
    goToSourceDefinition,
    goToTypeDefinition,
    openImplementationTarget,
  } = useWorkbenchLanguageNavigation({
    activeDocumentRef,
    activeEditorPositionRef,
    currentNavigationLocation,
    documentOffsetAtEditorPosition,
    documents,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    flushPendingJavaScriptTypeScriptDocumentChange,
    goToContextualPhpDefinition,
    goToIndexedPhpImplementation,
    goToIndexedSymbolDefinition,
    identifierAtEditorPosition,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    isLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    openPathForNavigation,
    provideBladeDefinition,
    provideLatteDefinitionOutcome,
    provideNeonDefinition,
    providePhpFrameworkDefinition,
    recordNavigationLocationSnapshot,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    resolveCurrentWorkspaceRuntimeOwner,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  });

  const { navigateBackward, navigateForwardInHistory, openRecentLocation } = useNavigationHistory({
    currentNavigationLocation,
    currentWorkspaceRootRef,
    forgetRecentLocationsForPath,
    navigationHistory: navigationHistoryState,
    openPathForNavigation,
    recordCurrentNavigationLocation,
    resolveCurrentWorkspaceRuntimeOwner,
    setEditorRevealTarget,
    setNavigationHistory,
    setRecentLocationsPanelOpen,
    shouldOpenNavigationTargetReadOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
    workspaceRoot,
  });

  const {
    createFile,
    createDirectory,
    renameActiveDocument,
    renameEntry,
    deleteActiveDocument,
    handleWorkspaceFileChange,
  } = useWorkbenchFileOperations({
    workspaceRoot,
    workspaceDescriptor,
    activePhpFrameworkProviders,
    activePath,
    sidebarView,
    languageServerDiagnosticsByPath,
    javaScriptTypeScriptDiagnosticsByPath,
    phpLocalDiagnosticsByPath,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    workspaceFiles,
    prompter,
    setActivePath,
    setBookmarks,
    setDocuments,
    setEntriesByDirectory,
    setExpandedDirectories,
    setManuallyCollapsedDirectories,
    setMessage,
    setOpenPaths,
    setPreviewPath,
    applyJavaScriptTypeScriptCreateEdits:
      editorFile.workspaceEdits.applyJavaScriptTypeScriptCreateEdits,
    applyJavaScriptTypeScriptDeleteEdits:
      editorFile.workspaceEdits.applyJavaScriptTypeScriptDeleteEdits,
    applyJavaScriptTypeScriptRenameEdits:
      editorFile.workspaceEdits.applyJavaScriptTypeScriptRenameEdits,
    applyPhpRenameEdits: editorFile.workspaceEdits.applyPhpRenameEdits,
    clearLanguageServerDiagnosticsForPath,
    closeDocument: documentSaveClose.documentLifecycle.closeDocument,
    forgetExternallyRemovedDocumentPath,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    invalidateFrameworkCachesForPath,
    resolveDocumentSaveOwnership,
    runWithDocumentSaveExclusion: documentSaveClose.documentLifecycle.runWithDocumentSaveExclusion,
    invalidatePhpFrameworkBindingsForFileChange,
    invalidatePhpFrameworkSourcePath,
    invalidatePhpTraitHostClassNames,
    markExternallyRemovedDocumentPath,
    notifyJavaScriptTypeScriptFileCreated:
      editorFile.workspaceEdits.notifyJavaScriptTypeScriptFileCreated,
    notifyJavaScriptTypeScriptFileDeleted:
      editorFile.workspaceEdits.notifyJavaScriptTypeScriptFileDeleted,
    notifyJavaScriptTypeScriptFileRenamed:
      editorFile.workspaceEdits.notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed: editorFile.workspaceEdits.notifyPhpFileRenamed,
    openFile: editorFile.documentTabs.openFile,
    refreshDirectory: editorFile.directory.refreshDirectory,
    refreshGitStatus,
    remapRecentFile,
    remapRecentLocations,
    reportChangedDocuments,
    reportErrorForActiveWorkspaceRoot: reportErrorForActiveWorkspaceRootResolved,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
  });

  return {
    publicSurface: {
      activateSearchEverywhereItem,
      commandContext,
      goToDefinition,
      goToImplementationAt,
      goToSuperMethod,
      goToNextProblem,
      goToPreviousProblem,
      debugInlineBreakpoint,
      debugCopyStackTrace,
      debugRestartFrame,
      nodeDebugAttachProcessPicker,
      nodeRunWithoutDebugging,
      debugStoppedLocation,
      openDebugLocation,
      openDebugPanel,
      startOrContinueDebug,
      startPhpListenDebug,
      registerActiveTerminalSession,
      runTestAt,
      openMarkdownPreview,
      openWorkspaceFile,
      openCurrentFileLocation,
      openImplementationTarget,
      openProblemNotice,
      openTodoPanel,
      closeTodoPanel,
      refreshWorkspaceTodos,
      openWorkspaceTodo,
      todoPanelOpen,
      workspaceTodos,
      workspaceTodosLoading,
      openClassSearchResult,
      openWorkspaceSymbolResult,
      openArtisanController,
      openSymfonyRouteController,
      openSymfonyService,
      openPhpClassTarget,
      openExpressRoutesPanel,
      openPhpTestCase,
      openEntryInTerminal,
      revealEntry,
      renameEntry,
      applyPhpCodeActionNewFile,
      frameworkIntelligenceProviders,
      providePhpCodeActions,
      providePhpFrameworkDefinition,
      providePhpMethodCompletions,
      providePhpMethodSignature,
      providePhpParameterInlayHints,
      openRecentFile,
      openRecentLocation,
      bookmarksPanelOpen,
      toggleGitBlame,
      provideGitBlame,
      readWorkspaceFile,
      toggleBookmarkAtCursor,
      toggleBookmarkAtLine,
      goToNextBookmark,
      goToPreviousBookmark,
      openBookmark,
      openBookmarksPanel,
      closeBookmarksPanel,
      toggleBookmarksPanel,
      fileHistoryPanelOpen,
      fileHistoryRelativePath,
      fileHistoryCommits,
      fileHistoryLoading,
      fileHistorySelectedSha,
      fileHistoryDiff,
      fileHistoryDiffLoading,
      openFileHistory,
      revealCommitInFileHistory,
      selectFileHistoryCommit,
      closeFileHistory,
      gitStashPanelOpen,
      gitStashEntries,
      gitStashLoading,
      gitStashMessage,
      gitStashSelectedIndex,
      gitStashDiff,
      gitStashDiffLoading,
      openGitStashPanel,
      closeGitStashPanel,
      selectGitStash,
      saveGitStash,
      applyGitStash,
      popGitStash,
      dropGitStash,
      setGitStashMessage,
      gitBranchPanelOpen,
      gitBranchEntries,
      gitRemoteBranchEntries,
      gitBranchLoading,
      openGitBranchPanel,
      closeGitBranchPanel,
      switchGitBranch,
      checkoutRemoteBranch,
      createGitBranch,
      deleteGitBranch,
      renameGitBranch,
      refreshGitBranches,
      localHistoryPanelOpen,
      localHistoryRelativePath,
      localHistoryVersions,
      localHistoryLoading,
      localHistorySelectedId,
      localHistoryDiff,
      localHistoryDiffLoading,
      openLocalHistory,
      selectLocalHistoryVersion,
      revertLocalHistoryVersion,
      closeLocalHistory,
      navigateBackward,
      navigateForwardInHistory,
      nodePackageScripts,
      vscodeProcessTasks: vscodeProcessTaskComposition.state,
      openNodePackageScript,
      revertActiveEditorChangeHunk,
      hideBottomPanel,
      showBottomPanelView,
      runInActiveTerminal,
      setStatusBarItemVisibility,
      setSmartMode,
      updateActiveDocument,
      openSearchResult,
    },
    statusBar: { setStatusBarItemVisibility },
    smartMode: { setSmartMode },
    editorDocument: {
      activateSearchEverywhereItem,
      applyPhpCodeActionNewFile,
      captureNavigationCommandScope,
      commandContext,
      generateTestForActiveDocument,
      goToNextProblem,
      goToPreviousProblem,
      goToTestForActiveDocument,
      isNavigationCommandScopeCurrent,
      navigationSurfaceIdentity,
      openClassSearchResult,
      openCurrentFileLocation,
      openMarkdownPreview,
      openNavigationTarget,
      openPathForNavigation,
      openProblemNotice,
      openRecentFile,
      openSearchResult,
      openWorkspaceSymbolResult,
      readNavigationFileContent,
      revertActiveEditorChangeHunk,
      updateActiveDocument,
    },
    taskDebug: {
      hideBottomPanel,
      registerActiveTerminalSession,
      runAllJsTestsForActiveDocument,
      runAllTestsForActiveDocument,
      runInActiveTerminal,
      runJsTestForActiveDocument,
      runTestAt,
      runTestForActiveDocument,
      showBottomPanelView,
      toggleBottomPanel,
      openNodePackageScript,
      nodePackageScripts,
      vscodeProcessTaskComposition,
      attachNodeDebug,
      debugCopyStackTrace,
      debugSession,
      debugStoppedLocation,
      nodeDebugAttachProcessPicker,
      openDebugLocation,
      openDebugPanel,
      startOrContinueDebug,
      startPhpListenDebug,
      toggleDebugBreakpointAtCursor,
      debugWatchAtCursor,
      jsTestDebugAtCursor,
      jsTestRunSelection,
      debugEvaluateInConsole,
      debugBreakpointNavigation,
      debugCallStackNavigation,
      debugRestartFrame,
      debugInlineBreakpoint,
      nodeRunWithoutDebugging,
      nodeLaunchConfigurationsSurface,
    },
    taskDebugNavigation: {
      openEntryInTerminal,
      openArtisanRoutesPanel,
      openExpressRoutesPanel,
      openJsTestResultsPanel,
      openPhpTestResultsPanel,
      openPhpTestCase,
      openArtisanController,
      revealEntry,
    },
    todos: {
      todoPanelOpen,
      workspaceTodos,
      workspaceTodosLoading,
      refreshWorkspaceTodos,
      openWorkspaceTodo,
      openTodoPanel,
      closeTodoPanel,
      toggleTodoPanel,
      resetWorkspaceTodos,
    },
    bookmarks: {
      bookmarksPanelOpen,
      toggleBookmarkAtLine,
      toggleBookmarkAtCursor,
      openBookmark,
      goToNextBookmark,
      goToPreviousBookmark,
      openBookmarksPanel,
      closeBookmarksPanel,
      toggleBookmarksPanel,
    },
    gitHistory: {
      fileHistoryPanelOpen,
      fileHistoryRelativePath,
      fileHistoryCommits,
      fileHistoryLoading,
      fileHistorySelectedSha,
      fileHistoryDiff,
      fileHistoryDiffLoading,
      openFileHistory,
      selectFileHistoryCommit,
      closeFileHistory,
      openWorkspaceFile,
      provideGitBlame,
      readWorkspaceFile,
      revealCommitInFileHistory,
      toggleGitBlame,
      revertSelectedGitCommit,
      cherryPickSelectedGitCommit,
      rewordSelectedGitCommit,
      canRewordSelectedGitCommit,
    },
    localHistory: {
      localHistoryPanelOpen,
      localHistoryRelativePath,
      localHistoryVersions,
      localHistoryLoading,
      localHistorySelectedId,
      localHistoryDiff,
      localHistoryDiffLoading,
      openLocalHistory,
      selectLocalHistoryVersion,
      revertLocalHistoryVersion,
      closeLocalHistory,
    },
    gitPanels: {
      gitStashPanelOpen,
      gitStashEntries,
      gitStashLoading,
      gitStashMessage,
      gitStashSelectedIndex,
      gitStashDiff,
      gitStashDiffLoading,
      openGitStashPanel,
      closeGitStashPanel,
      selectGitStash,
      saveGitStash,
      applyGitStash,
      popGitStash,
      dropGitStash,
      setGitStashMessage,
      gitBranchPanelOpen,
      gitBranchEntries,
      gitRemoteBranchEntries,
      gitBranchLoading,
      openGitBranchPanel,
      closeGitBranchPanel,
      switchGitBranch,
      checkoutRemoteBranch,
      createGitBranch,
      deleteGitBranch,
      renameGitBranch,
      refreshGitBranches,
    },
    frameworkIntelligence: {
      frameworkIntelligenceProviders,
      goToContextualPhpDefinition,
      goToIndexedPhpImplementation,
      goToIndexedSymbolDefinition,
      goToSuperMethod,
      invalidateFrameworkCachesForPath,
      invalidatePhpFrameworkBindingsForFileChange,
      invalidatePhpTraitHostClassNames,
      openPhpClassTarget,
      openSymfonyRouteController,
      openSymfonyService,
      provideBladeDefinition,
      provideLatteDefinitionOutcome,
      provideNeonDefinition,
      providePhpCodeActions,
      providePhpFrameworkDefinition,
      providePhpMethodCompletions,
      providePhpMethodSignature,
      providePhpParameterInlayHints,
    },
    languageNavigation: {
      goToDeclaration,
      goToDefinition,
      goToImplementation,
      goToImplementationAt,
      goToSourceDefinition,
      goToTypeDefinition,
      openImplementationTarget,
    },
    navigationHistory: { navigateBackward, navigateForwardInHistory, openRecentLocation },
    fileOperations: {
      createFile,
      createDirectory,
      renameActiveDocument,
      renameEntry,
      deleteActiveDocument,
      handleWorkspaceFileChange,
    },
  };
}
