import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
export type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
import { ownerDocumentSavePipelineContextFor } from "./workbenchController/documentSaveOwnerContext";
export { ownerDocumentSavePipelineContextFor } from "./workbenchController/documentSaveOwnerContext";
import {
  admittedWorkspaceIdentityForRoot,
  adoptLegacyCachedWorkspaceState,
  removeWorkspaceIdentityMappings,
  resolveAdmittedDocumentSaveOwnership,
  workspaceSettingsIdentity,
} from "./workbenchController/workspaceIdentityPolicy";
export {
  adoptLegacyCachedWorkspaceState,
  resolveAdmittedDocumentSaveOwnership,
  withWorkspaceIdentityLease,
} from "./workbenchController/workspaceIdentityPolicy";
import {
  backgroundRuntimeOwnersForPolicy,
  workspaceRuntimeOwnerFor,
} from "./workbenchController/workspaceRuntimePolicy";
import {
  isLanguageServerActiveForWorkspace,
  isRunningLanguageServerForWorkspace,
} from "./workbenchController/languageServerStatusPolicy";
export {
  isLanguageServerSessionActiveForOwner,
  isLanguageServerSessionCurrentForOwnerOrLegacy,
} from "./workbenchController/languageServerStatusPolicy";
import {
  isBlockedByManuallyCollapsedDirectory,
  isJavaScriptTypeScriptDocumentSyncableForRoot,
  parentDirectoriesInWorkspace,
  relativeWorkspacePath,
  shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
  workspacePathBelongsToRoot,
} from "./workbenchController/workspacePathPolicy";
import { useWorkbenchDiagnosticPresentation } from "./workbenchController/useWorkbenchDiagnosticPresentation";
import { useWorkbenchEditorPresentation } from "./workbenchController/useWorkbenchEditorPresentation";
import { useWorkbenchEditorGroupCoordinator } from "./workbenchController/useWorkbenchEditorGroupCoordinator";
import { useWorkbenchSettingsCommands } from "./workbenchController/useWorkbenchSettingsCommands";
import {
  useWorkbenchGitChangesCoordinator,
  useWorkbenchGitDiscoveryCoordinator,
  useWorkbenchGitHistoryCoordinator,
  useWorkbenchGitPanelsCoordinator,
} from "./workbenchController/useWorkbenchGitCoordinator";
import {
  createWorkbenchRevealPathPort,
  useWorkbenchTaskDebugCoordinator,
  useWorkbenchTaskDebugNavigationCoordinator,
} from "./workbenchController/useWorkbenchTaskDebugCoordinator";
import { useWorkbenchLanguageDocumentSyncCoordinator } from "./workbenchController/useWorkbenchLanguageDocumentSyncCoordinator";
import { useWorkbenchFrameworkIntelligenceCoordinator } from "./workbenchController/useWorkbenchFrameworkIntelligenceCoordinator";
import {
  useWorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinator,
  useWorkbenchLanguageRuntimeOwnershipCoordinator,
} from "./workbenchController/useWorkbenchLanguageServerRuntimeCoordinator";
import {
  beginWorkbenchSmartModeIntent,
  useWorkbenchLanguageDiagnosticsCoordinator,
  useWorkbenchLanguageRuntimeChannelRefs,
  useWorkbenchLanguageRuntimeEffects,
  useWorkbenchLanguageRuntimeOwnerRefs,
  useWorkbenchSmartModeCoordinator,
  useWorkbenchStaticAnalysisCoordinator,
  type WorkbenchSmartModeIntentState,
} from "./workbenchController/useWorkbenchLanguageRuntimeCoordinator";
import {
  useManagedLanguageServerInstallCommands,
  useManagedLanguageServerInstallSubscriptions,
} from "./workbenchController/useManagedLanguageServerInstallLifecycle";
import { useWorkspaceOpenRequestLifecycle } from "./workbenchController/useWorkspaceOpenRequestLifecycle";
import { useWorkbenchWorkspaceFileChangeSubscription } from "./workbenchController/useWorkspaceFileChangeSubscription";
import { useManagedWorkspaceIdentityOwnership } from "./workbenchController/useManagedWorkspaceIdentityOwnership";
import { loadCompleteWorkspaceDirectoryEntries } from "./workbenchController/useWorkspaceDirectoryLoader";
import { useWorkspaceDirectoryExplorer } from "./workbenchController/useWorkspaceDirectoryExplorer";
import { useWorkspaceSessionRestorer } from "./workbenchController/useWorkspaceSessionRestorer";
import { LatestWorkspaceRequestTokenRegistry } from "./workbenchController/workspaceRequestTokenRegistry";
import { boundedInFlightDirectoryLoadsFor } from "./workbenchController/boundedInFlightDirectoryLoads";
import {
  boundedPendingWorkspaceSettingsLoadsFor,
  PendingWorkspaceSettingsLoadCapacityError,
} from "./workbenchController/boundedPendingWorkspaceSettingsLoads";
import { useExternallyRemovedDocumentTombstones } from "./workbenchController/useExternallyRemovedDocumentTombstones";
import {
  clearClosedWorkspaceEditorRetainedState,
  disposeWorkspaceFileChanges,
  ownedAndPendingWorkspaceIdentityIds,
  releaseWorkspaceRetainedResources,
  withoutClosedWorkspacePackageScripts,
} from "./workbenchController/workspaceRetainedStateCleanup";
import { useWorkbenchSettingsPersistence } from "./workbenchController/useWorkbenchSettingsPersistence";
import {
  useWorkbenchLatencyReporting,
  useWorkbenchLatencyTrackerForRoot,
} from "./workbenchController/useWorkbenchLatencyTracking";
import { useEditorSessionState } from "./useEditorSessionState";
import {
  DocumentSessionAuthorityLifecycleCoordinator,
  resolveDocumentSessionWorkspaceTransition,
  workspaceIdentityAliasPaths,
  workspaceTabsWithPath,
} from "./documentSessionAuthorityLifecycleCoordinator";
import { useFloatingSurfaces } from "./useFloatingSurfaces";
import { gitChangeForDiffDocumentPath, isGitDiffDocumentPath } from "./useGitDiffWorkspace";
import { useWorkbenchCommandRegistry } from "./useWorkbenchCommandRegistry";
import { useWorkbenchSidebarDataRefresh } from "./useWorkbenchSidebarDataRefresh";
import { useWorkbenchCommandContext } from "./useWorkbenchCommandContext";
import { useWorkbenchDirtyCloseDecisionPort } from "./useWorkbenchDirtyCloseDecisionPort";
import { useOptionalWorkspaceTextReader } from "./useOptionalWorkspaceTextReader";
import { useActiveWorkspaceOwners } from "./useActiveWorkspaceOwners";
import { WorkspaceTrustIntentCoordinator } from "./workspaceTrustIntentCoordinator";
import { executeCommandAndReport, type CommandExecutionRunner } from "./commandRegistry";
import {
  useWorkbenchKeyboardShortcutActions,
  useWorkbenchKeyboardShortcuts,
} from "./useWorkbenchKeyboardShortcuts";
import { useWorkbenchNativeMenuCommands } from "./useWorkbenchNativeMenuCommands";
import { useWorkbenchWorkspacePackageGraph } from "./useWorkbenchWorkspacePackageGraph";
import { useWorkbenchIndexLifecycle } from "./useWorkbenchIndexLifecycle";
import { useWorkbenchPintCommand } from "./useWorkbenchPintCommand";
import { useWorkspaceTodos } from "./useWorkspaceTodos";
import { useWorkbenchActiveDocumentEditing } from "./useWorkbenchActiveDocumentEditing";
import { useWorkbenchEditorConfigCoordinator } from "./useWorkbenchEditorConfigCoordinator";
import { refreshEditorConfigAfterDocumentSave } from "./editorConfigInvalidation";
import { usePhpFrameworkSourceRegistries } from "./usePhpFrameworkSourceRegistries";
import { useBookmarks } from "./useBookmarks";
import { useLocalHistory } from "./useLocalHistory";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import type { RunWithDocumentSaveExclusion } from "./documentSaveCoordinator";
import {
  createEslintFixOnSaveParticipant,
  orderedDocumentSaveParticipants,
} from "./documentSaveParticipants";
import { createPrettierSaveParticipant } from "./prettierSaveParticipant";
import { type ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";
import { useWorkbenchEditorGroupCloseLifecycle } from "./useWorkbenchEditorGroupCloseLifecycle";
import { OwnerResolvingDocumentSaveService } from "./ownerResolvingDocumentSaveService";
import { WorkbenchOwnerDocumentSaveAdapters } from "./workbenchOwnerDocumentSaveAdapters";
import { useDocumentSavePipeline } from "./useDocumentSavePipeline";
import { isSessionPathInWorkspace } from "./documentSessionState";
import {
  useWorkspaceStateCache,
  workspaceIdentityStateCacheKey,
  shouldRunInitialIndexScan,
} from "./useWorkspaceStateCache";
import {
  captureWorkspaceBeforeSwitch,
  closeWorkspaceDocumentsBeforeSwitch,
  WorkspaceDocumentCloseCoordinator,
} from "./workspaceSessionSwitchLifecycle";
import {
  useWorkbenchCloseLifecycle,
  type WorkbenchCloseLifecycleDependencies,
  type WorkspaceCloseOwnership,
  type WorkspaceCloseSessionPort,
} from "./useWorkbenchCloseLifecycle";
import { useExternalFileConflictLifecycle } from "./useExternalFileConflictLifecycle";
import { useWorkbenchDocumentTabs } from "./useWorkbenchDocumentTabs";
import { useWorkbenchFileOperations } from "./useWorkbenchFileOperations";
import { useWorkbenchNavigationState } from "./useWorkbenchNavigationState";
import { useWorkbenchNavigation } from "./useWorkbenchNavigation";
import { useWorkbenchClassOpen } from "./useWorkbenchClassOpen";
import { useWorkbenchQuickOpen } from "./useWorkbenchQuickOpen";
import { useWorkbenchSearchEverywhere } from "./useWorkbenchSearchEverywhere";
import { useWorkbenchSymbolPanels } from "./useWorkbenchSymbolPanels";
import { useWorkbenchDockedTextSearch } from "./useWorkbenchDockedTextSearch";
import {
  useQuickOpenPrefixDispatch,
  useQuickOpenPrefixDestinations,
  useQuickOpenSeededSurfaceState,
} from "./useQuickOpenPrefixDispatch";
import {
  useFlushWorkspaceNavigationSessionOnBlur,
  usePersistCurrentWorkspaceSession,
  usePersistWorkspaceNavigationSession,
} from "./useWorkbenchNavigationSessionPersistence";
import { useLanguageServerFeatureErrorReporting } from "./useLanguageServerFeatureErrorReporting";
import { useWorkbenchWorkspaceSymbols } from "./useWorkbenchWorkspaceSymbols";
import {
  useWorkbenchImplementationChooserState,
  useWorkbenchLanguageNavigation,
} from "./useWorkbenchLanguageNavigation";
import { optionalEditorJavaScriptTypeScriptIncrementalSyncFacade } from "./editorJavaScriptTypeScriptIncrementalSyncFacade";
import { useJavaScriptTypeScriptIncrementalSyncOwnerRef } from "./useJavaScriptTypeScriptIncrementalSyncComposition";
import { useCommitBailoutState } from "./useCommitBailoutState";
import {
  EMPTY_EDITOR_VIEW_STATES,
  EMPTY_EDITOR_VIEW_STATES_BY_GROUP,
} from "./workbenchEmptyProjections";
import {
  createWorkspaceSettingsByRootSnapshot,
  type WorkspaceSettingsByRootSnapshot,
} from "./workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";
import { type LanguageServerDiagnosticsRuntimeKind } from "./useLanguageServerDiagnosticsSubscriptions";
import { WorkspaceRuntimeOwnerClaimRegistry } from "./workspaceRuntimeOwnerClaimRegistry";
import { useWorkspaceEditFileOperations } from "./useWorkspaceEditFileOperations";
import { useNavigationHistory, useRecentNavigation } from "./useNavigationHistory";
import { useLanguageServerDocumentSyncState } from "./useLanguageServerDocumentSyncState";
import { usePhpFrameworkResolution } from "./usePhpFrameworkResolution";
import { usePhpOutline } from "./usePhpOutline";
import type { EditorSurfaceCommandInvocationScope } from "../domain/editorSurfaceCommand";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import { registerActiveComposerManifestWorkspace } from "../components/composerManifestMonacoProviders";
import { registerActiveNpmManifestWorkspace } from "../components/npmManifestMonacoProviders";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
} from "./usePhpCodeActions";

import { usePhpCodeActionNewFileApplication } from "./usePhpCodeActionNewFileApplication";
import { usePhpChangeSignatureWorkflow } from "./usePhpChangeSignatureWorkflow";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import { PhpDiagnosticsReclassificationCoordinator } from "./phpDiagnosticsReclassificationCoordinator";

import { useReplaceJavaScriptTestProblemNotices } from "./useWorkbenchNoticeStore";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import type { GitGateway } from "../domain/git";
import type { LocalHistoryGateway } from "../domain/localHistory";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { IndexProgressGateway } from "../domain/indexProgress";
import {
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import { createDiagnosticsCoalescer } from "../domain/diagnosticsCoalescer";
import { documentNeedsAttention } from "../domain/externalFileConflict";
import {
  isLanguageServerDocument,
  type LanguageServerDocumentSyncGateway,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerGateway, LanguageServerPlan } from "../domain/languageServer";
import {
  canUseLanguageServerFeature,
  type EditorPosition,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import { isBenignError } from "../infrastructure/globalErrorSafetyNet";
import {
  defaultDebugGateway,
  defaultPrettierFormattingGateway,
  eslintDiagnosticsGateway,
  phpLocalSyntaxDiagnosticsGateway,
  phpstanDiagnosticsGateway,
  pintGateway,
} from "./workbenchDefaultGateways";
import { type EslintDiagnosticsByRoot, type EslintFix } from "../domain/eslintDiagnostics";
import { type PhpstanDiagnosticsByRoot } from "../domain/phpstanDiagnostics";
import {
  isMarkdownDocument,
  markdownPreviewPath,
  renderMarkdownPreview,
  type MarkdownPreviewTab,
} from "../domain/markdownPreview";
import { applyEditorChangeRevert, type EditorChangeHunk } from "../domain/editorChangeMarkers";
import {
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  restoreRuntimeStatusCacheEntry,
} from "../domain/languageServerRuntimeStatusCache";
import {
  loadWorkspaceTrustForOwner,
  useWorkbenchControllerAgents,
} from "./useWorkbenchControllerAgents";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  createLegacyEditorSessionOwnerKey,
  type EditorSessionOwnerKey,
} from "../domain/editorSessionOwnerKey";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  type PhpFileOutline,
  type PhpFileOutlineGateway,
  type PhpFileStructureScope,
} from "../domain/phpFileOutline";
import { emptyPhpTree, type PhpTreeGateway } from "../domain/phpTree";
import { phpTestClassPlan, renderPhpTestSkeleton } from "../domain/phpTestGen";
import {
  phpTestPartnerMissingMessage,
  phpTestNavigationTargets,
} from "../domain/phpTestNavigation";
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import { emptyRecentlyClosedTabs } from "../domain/recentlyClosedTabs";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  pushRecentWorkspacePath,
  type AppSettings,
  type SettingsGateway,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSessionViewState,
  type WorkspaceSettings,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { parseComposerScripts, type PackageScript } from "../domain/packageScripts";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import { recentFilesForSwitcher } from "../domain/recentFiles";
import {
  editorGroupsUniquePaths,
  openEditorGroupPath,
  type EditorGroupId,
} from "../domain/editorGroups";
import { sortBookmarks, type Bookmark } from "../domain/bookmarks";
import type { LatencyTracker } from "../domain/latencyTracker";
import {
  createWorkspaceTextFileWithContent,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  workspaceRelativePath,
  visibleEditorPaths,
  type EditorDocument,
  type FileEntry,
  type IntelligenceMode,
  type PhpToolAvailability,
  type WorkspaceDescriptor,
  type WorkspaceFileGateway,
  type WorkspaceOwnerFileGateway,
} from "../domain/workspace";
import { createJsTestRerunLastRunCommands } from "./workbenchDebugControllerOptions";
import { documentOffsetAtEditorPosition, identifierAtEditorPosition } from "./editorPositionText";
import { useResolvedEditorCursorStore } from "./useCursorCommandAvailability";

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

export type SidebarView = "files" | "git" | "php" | "scripts";

const DEFAULT_REVEAL_PATH_GATEWAY = createWorkbenchRevealPathPort(invoke);
const ignoreLanguageServerRequestCancellation = () => Promise.resolve();

export function useWorkbenchController(
  workspaceGateways: WorkbenchWorkspaceGateways,
  smartModeGateway: SmartModeGateway,
  workspaceTrustGateway: WorkspaceTrustGateway,
  indexProgressGateway: IndexProgressGateway,
  phpFileOutlineGateway: PhpFileOutlineGateway,
  phpTreeGateway: PhpTreeGateway,
  gitGateway: GitGateway,
  localHistoryGateway: LocalHistoryGateway,
  languageServerGateway: LanguageServerGateway,
  languageServerRuntimeGateway: LanguageServerRuntimeGateway,
  languageServerDocumentSyncGateway: SessionBoundLanguageServerDocumentSyncGateway,
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway,
  languageServerFeaturesGateway: LanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway,
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerFeaturesGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway,
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway,
  terminalGateway: TerminalGateway,
  settingsGateway: SettingsGateway,
  prompter: WorkbenchPrompter,
  options: WorkbenchControllerOptions = {},
) {
  const editorCursorStore = useResolvedEditorCursorStore(options.editorCursorStore);
  const {
    cancelJavaScriptTypeScriptLanguageServerRequest = ignoreLanguageServerRequestCancellation,
    javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway,
    editorSurfaceBufferFixRunner,
    editorSurfaceCommandRunner,
    editorSurfaceEslintDisableRunner,
    editorSurfacePhpstanIgnoreRunner,
  } = options;
  const markdownPreviewRenderer = options.markdownPreviewRenderer ?? renderMarkdownPreview;
  const fallbackDirtyCloseDecisionPort = useWorkbenchDirtyCloseDecisionPort(prompter);
  const {
    detection: workspaceDetection,
    fileChanges: workspaceFileChangeGateway,
    fileSearch,
    files: workspaceFiles,
    ownerFiles: workspaceOwnerFiles,
    phpTools: phpToolGateway,
    projectSymbols: projectSymbolSearch,
    textSearch,
  } = workspaceGateways;
  const readTestFileIfExists = useOptionalWorkspaceTextReader(workspaceFiles);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceIdentityDescriptor, setWorkspaceIdentityDescriptor] =
    useState<WorkspaceIdentityDescriptor | null>(null);
  const workspaceIdentityDescriptorRef = useRef(workspaceIdentityDescriptor);
  workspaceIdentityDescriptorRef.current = workspaceIdentityDescriptor;
  const {
    currentEditorSessionOwnerKeyRef,
    editorSessionOwnerKey,
    resolveCurrentWorkspaceRuntimeOwner,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerRef,
  } = useActiveWorkspaceOwners(workspaceRoot, workspaceIdentityDescriptor);
  const [workspaceDescriptor, setWorkspaceDescriptor] = useState<WorkspaceDescriptor | null>(null);
  useEffect(() => {
    if (
      !workspaceRoot ||
      !workspaceDescriptor ||
      !workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath)
    ) {
      return;
    }

    return registerActiveComposerManifestWorkspace({
      packages: workspaceDescriptor.php?.packages ?? [],
      rootPath: workspaceRoot,
    });
  }, [workspaceDescriptor, workspaceRoot]);
  useEffect(() => {
    if (!workspaceRoot || !workspaceDescriptor) return;
    if (!workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath)) return;
    return registerActiveNpmManifestWorkspace({
      packages: workspaceDescriptor.javaScriptTypeScript?.packages ?? [],
      rootPath: workspaceRoot,
    });
  }, [workspaceDescriptor, workspaceRoot]);
  const [packageScriptsByRoot, setPackageScriptsByRoot] = useState<
    Record<
      string,
      {
        composerScripts: PackageScript[];
        hasArtisan: boolean;
      }
    >
  >({});
  const activePackageScripts = workspaceRoot ? packageScriptsByRoot[workspaceRoot] : null;
  const resetPhpClassMemberCacheRef = useRef<() => void>(() => {});
  const resetPhpFrameworkCachesRef = useRef<() => void>(() => {});
  const invalidatePhpFrameworkBindingCacheRef = useRef<() => void>(() => {});
  const isPhpFrameworkBindingDependencyPathRef = useRef<(path: string) => boolean>(() => false);
  const resetPhpFrameworkMorphMapModelTypeCacheRef = useRef<() => void>(() => {});
  const {
    activeFrameworkActivityLabel,
    activePhpFrameworkProviders,
    phpFrameworkIntelligence,
    phpFrameworkRuntimeContext,
  } = usePhpFrameworkResolution({ workspaceDescriptor });
  const hasSymfonyFramework = phpFrameworkRuntimeContext.hasProvider("symfony");
  const [workspaceTrust, setWorkspaceTrust] = useState(null as WorkspaceTrustState | null);
  const workspaceTrusted = workspaceTrust ? workspaceTrust.trusted : false;
  const [phpTools, setPhpTools] = useState(null as PhpToolAvailability | null);
  const [languageServerPlan, setLanguageServerPlan] = useState(null as LanguageServerPlan | null);
  const [installingManagedPhpactor, setInstallingManagedPhpactor] = useState(false);
  const [installingManagedTypeScriptLanguageServer, setInstallingManagedTypeScriptLanguageServer] =
    useState(false);
  const [javaScriptTypeScriptLanguageServerPlan, setJavaScriptTypeScriptLanguageServerPlan] =
    useState(null as LanguageServerPlan | null);
  const [languageServerSetupOpen, setLanguageServerSetupOpen] = useState(false);
  const [languageServerRuntimeStatus, setLanguageServerRuntimeStatus] = useState(
    null as LanguageServerRuntimeStatus | null,
  );
  const [languageServerRuntimeStatusRoot, setLanguageServerRuntimeStatusRoot] = useState<
    string | null
  >(null);
  const [phpIdeReadinessVersion, setPhpIdeReadinessVersion] = useState(0);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
  ] = useState(null as LanguageServerRuntimeStatus | null);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  ] = useState<string | null>(null);
  const [languageServerDiagnosticsByPath, setLanguageServerDiagnosticsByPath] = useState<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const [javaScriptTypeScriptDiagnosticsByPath, setJavaScriptTypeScriptDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [frameworkDiagnosticsByPath, setFrameworkDiagnosticsByPath] = useCommitBailoutState<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const [phpLocalDiagnosticsByPath, setPhpLocalDiagnosticsByPath] = useCommitBailoutState<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>("problems");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
  const bottomPanelViewRef = useRef(bottomPanelView);
  useLayoutEffect(() => {
    bottomPanelViewRef.current = bottomPanelView;
  }, [bottomPanelView]);
  const [phpTestRunRequestVersion, setPhpTestRunRequestVersion] = useState(0);
  const [jsTestRunRequestVersion, setJsTestRunRequestVersion] = useState(0);
  const {
    handleWorkspaceDiscoveryFileChange,
    hasNetteApplicationFramework,
    invalidateJsTestCoverageAndResults,
    ...workspaceDiscoveryVersions
  } = useWorkbenchWorkspacePackageGraph(
    workspaceDescriptor,
    hasSymfonyFramework,
    options.workspaceSourceDiscoveryGateway,
    workspaceRuntimeOwner,
  );
  const [phpTree, setPhpTree] = useState(emptyPhpTree);
  const [phpTreeLoading, setPhpTreeLoading] = useState(false);
  const [phpTreeExpandedNodeIds, setPhpTreeExpandedNodeIds] = useState(new Set<string>());
  const [phpFileOutlinesByPath, setPhpFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [phpInheritedFileOutlinesByPath, setPhpInheritedFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [expandedPhpFilePaths, setExpandedPhpFilePaths] = useState(new Set<string>());
  const [loadingPhpFileOutlinePaths, setLoadingPhpFileOutlinePaths] = useState<Set<string>>(
    new Set(),
  );
  const [loadingInheritedPhpFileOutlinePaths, setLoadingInheritedPhpFileOutlinePaths] = useState<
    Set<string>
  >(new Set());
  const [phpFileOutlineExpandedNodeIds, setPhpFileOutlineExpandedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useCommitBailoutState(new Set<string>());
  const [manuallyCollapsedDirectories, setManuallyCollapsedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [loadingDirectories, setLoadingDirectories] = useState(new Set<string>());
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const {
    activateDocumentSessionAuthority,
    attachEditorGroupLiveDocument,
    deactivateDocumentSessionAuthority,
    activeDocument,
    activeDocumentRef,
    activeGroupId,
    activeImage,
    activeMarkdownPreview,
    activePath,
    documents,
    documentsRef,
    documentSessionAuthorityRevision,
    documentTabSession,
    editorGroups,
    editorGroupsRef,
    imageTabs,
    imageTabsRef,
    markdownPreviewTabs,
    markdownPreviewTabsRef,
    nextEditorGroupIdRef,
    openPaths,
    openPathsRef,
    previewPath,
    previewPathRef,
    reconcileDocumentSessionTopology,
    reportChangedDocuments,
    isDocumentSessionLifecycleAuthorityCurrent,
    isEditorGroupDocumentSessionAuthorityCurrent,
    resolveActiveDocumentSessionAuthority,
    resolveDocumentSessionLifecycleAuthority,
    resolveEditorGroupDocumentSessionAuthority,
    resetEditorSurfaceState,
    restoreEditorSurface,
    setActivePath,
    setDocuments,
    setImageTabs,
    setMarkdownPreviewTabs,
    setOpenPaths,
    setPreviewPath,
    snapshotEditorSurface,
    subscribeChangedDocuments,
    updateDocumentContent,
    updateEditorGroups,
  } = useEditorSessionState(workspaceSettings.largeFileMode);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const {
    commandPaletteInitialQuery,
    fileStructureInitialQuery,
    openCommandPaletteWithInitialQuery,
    paletteOpen,
    setFileStructureInitialQuery,
    setPaletteOpen,
  } = useQuickOpenSeededSurfaceState();
  const [artisanMakePaletteRoot, setArtisanMakePaletteRoot] = useState<string | null>(null);
  // Per-workspace bookmarks (PhpStorm parity). Cached/restored alongside the
  // rest of the per-tab workbench state so one project's bookmarks can never
  // leak into another project's editor gutter or panel.
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  // Git blame annotation toggle, tracked per absolute document path so the
  // annotation state never leaks across open tabs (each path is workspace-
  // scoped). Reset on workspace switch alongside the other per-tab state.
  const [gitBlameEnabledPaths, setGitBlameEnabledPaths] = useState<Set<string>>(() => new Set());
  const { implementationChooser, setImplementationChooser } =
    useWorkbenchImplementationChooserState();
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useCommitBailoutState<WorkbenchNotice[]>([]);
  const replaceJavaScriptTestProblemNotices = useReplaceJavaScriptTestProblemNotices(setNotices);
  const reportError = useCallback(
    (source: string, error: unknown) => {
      if (isBenignError(error)) {
        return;
      }

      const nextMessage = String(error);
      setMessage(nextMessage);
      setNotices((current) => [createWorkbenchNotice("error", source, nextMessage), ...current]);
    },
    [setNotices],
  );
  const eslintAnalysisInFlightRef = useRef(false);
  const [eslintAnalysisRunning, setEslintAnalysisRunning] = useState(false);
  const [eslintFixesByRoot, setEslintFixesByRoot] = useState<
    Record<string, Record<string, EslintFix[]>>
  >({});
  const [eslintDiagnosticsByRoot, setEslintDiagnosticsByRoot] = useState<EslintDiagnosticsByRoot>(
    {},
  );
  const phpstanAnalysisInFlightRef = useRef(false);
  const [phpstanAnalysisRunning, setPhpstanAnalysisRunning] = useState(false);
  const [phpstanDiagnosticsByRoot, setPhpstanDiagnosticsByRoot] =
    useState<PhpstanDiagnosticsByRoot>({});
  const noticesRef = useRef<WorkbenchNotice[]>(notices);
  noticesRef.current = notices;
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const phpstanWorkspaceTabsRef = useRef<string[]>([]);
  const eslintWorkspaceTabsRef = useRef<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("general");
  const [fileStructureOpen, setFileStructureOpen] = useState(false);
  const [fileStructureScope, setFileStructureScope] = useState<PhpFileStructureScope>("current");
  const setJavaScriptTypeScriptFileStructureScopeCurrent = useCallback(
    () => setFileStructureScope("current"),
    [],
  );
  const [intelligenceMode, setIntelligenceMode] = useState<IntelligenceMode>("basic");
  const [phpLanguageServerAutostartRetryVersion, setPhpLanguageServerAutostartRetryVersion] =
    useState(0);
  const hasRestoredRef = useRef(false);
  const appSettingsRef = useRef<AppSettings>(defaultAppSettings());
  // Runtime latency instrumentation for the key interactive operations
  // (quick open, search everywhere, go-to-definition, completion, folder
  // expand). Trackers are keyed by workspace root so the runtime cockpit for
  // one project tab never shows timings recorded in another project.
  const latencyTrackersByRootRef = useRef<Record<string, LatencyTracker>>({});
  // Memoized bare-key shortcut set for the keydown hot path. Rebuilding it on
  // every keydown would re-parse every shortcut (~35 parseShortcut calls) on
  // each auto-repeat event; we instead recompute only when the keymap object
  // identity changes.
  const bareKeyShortcutsRef = useRef<{
    keymap: AppSettings["keymap"] | null;
    keys: ReadonlySet<string>;
  }>({ keymap: null, keys: new Set() });
  const workspaceSettingsRef = useRef<WorkspaceSettings>(defaultWorkspaceSettings());
  const workspaceSettingsByRootRef = useRef<WorkspaceSettingsByRootSnapshot | null>(null);
  const workspaceSettingsByRoot =
    workspaceSettingsByRootRef.current ?? createWorkspaceSettingsByRootSnapshot();
  workspaceSettingsByRootRef.current = workspaceSettingsByRoot;
  const workspaceSettingsSaveCoordinatorRef = useRef(createWorkspaceSettingsSaveCoordinator());
  const workspaceSettingsSaveCoordinator = workspaceSettingsSaveCoordinatorRef.current;
  const workspaceSettingsLoadByRootRef = useRef(
    boundedPendingWorkspaceSettingsLoadsFor(settingsGateway),
  );
  const workspaceSessionRestoredRef = useRef(false);
  const workspaceEditorViewStatesRef = useRef<
    Record<string, Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>>
  >({});
  const [restoredEditorViewStateRevision, setRestoredEditorViewStateRevision] = useState(0);
  const recentlyClosedTabsRef = useRef(emptyRecentlyClosedTabs());
  const [, setRecentlyClosedTabsVersion] = useState(0);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const lastPhpIdeReadinessSignatureRef = useRef<string | null>(null);
  const workspaceDocumentCloseCoordinatorRef = useRef(new WorkspaceDocumentCloseCoordinator());
  const openWorkspaceRequestTokenRef = useRef(0);
  const phpFrameworkNavigationGenerationRef = useRef(0);
  const openWorkspaceRequestPathRef = useRef<string | null>(null);
  const openWorkspaceRequestInFlightTokenRef = useRef<number | null>(null);
  const workbenchMountedRef = useRef(true);
  const pendingWorkspaceIdentityRequestTokensRef = useRef(
    new LatestWorkspaceRequestTokenRegistry(),
  );
  const deferredWorkspaceIdentityCleanupIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityAdmissionGenerationRef = useRef(0);
  const pendingWorkspaceIdentityAdmissionsRef = useRef<Record<string, Set<number>>>({});
  const ownedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const ownedWorkspaceIdentityGenerationByIdRef = useRef<Record<string, number>>({});
  const workspaceIdentityReleaseGenerationByIdRef = useRef<Record<string, number>>({});
  const releasedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityUnregisterByIdRef = useRef<Record<string, Promise<void>>>({});
  const inFlightDirectoryLoadsRef = useRef(boundedInFlightDirectoryLoadsFor(workspaceFiles));
  const openFileRequestTokenRef = useRef(0);
  const openingFileFlagOwnerTokenRef = useRef<number | null>(null);
  const emptyDocumentRefreshTimeoutsRef = useRef<Set<number>>(new Set());
  const editorGitBaselineRequestTokenRef = useRef(0);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
  const phpLanguageServerAutostartAttemptsByRootRef = useRef<Record<string, number>>({});
  const manuallyStoppedPhpLanguageServerRootsRef = useRef<Set<string>>(new Set());
  const installingManagedPhpactorRootRef = useRef<string | null>(null);
  const installingManagedTypeScriptLanguageServerRootRef = useRef<string | null>(null);
  const autoStartedJavaScriptTypeScriptLanguageServerRootRef = useRef<string | null>(null);
  const javaScriptTypeScriptTrustAutostartRef = useRef<{
    owner: WorkspaceRuntimeOwner;
    promise: Promise<void>;
    revision: number;
    trustRevision: number;
    typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"];
  } | null>(null);
  const workspaceTrustRevisionByOwnerRef = useRef<Record<string, number>>({});
  const workspaceTrustIntentCoordinatorRef = useRef(new WorkspaceTrustIntentCoordinator());
  const workspaceTrustRevocationByOwnerRef = useRef<
    Record<
      string,
      {
        generation: number | null | undefined;
        owner: WorkspaceRuntimeOwner;
        promise: Promise<void>;
      }
    >
  >({});
  const intelligenceModeRef = useRef<IntelligenceMode>("basic");
  const smartModeRequestGenerationRef = useRef(0);
  const smartModeRequestIntentRef = useRef<WorkbenchSmartModeIntentState | null>(null);
  const {
    documentVersionsRef,
    documentVersionsByUriRef,
    lastAppliedDiagnosticVersionByUriRef,
    syncedDocumentPathsRef,
    syncedDocumentContentRef,
    pendingDocumentChangesRef,
    pendingDocumentOpenSyncAttemptsRef,
    documentOpenSyncAttemptIdRef,
    documentChangeTimersRef,
    documentSyncQueuesRef,
    documentSyncGenerationRef,
    documentSyncRuntimeSignatureRef,
    nextDocumentLifecycleIdentityRef,
    documentLifecycleIdentitiesRef,
    pendingDocumentLifecycleIdentitiesRef,
    phpLanguageServerIndexWarmedRootsRef,
    javaScriptTypeScriptDocumentVersionsRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    javaScriptTypeScriptSyncedDocumentContentRef,
    javaScriptTypeScriptPendingDocumentChangesRef,
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
    javaScriptTypeScriptDocumentOpenSyncAttemptIdRef,
    javaScriptTypeScriptDocumentChangeTimersRef,
    javaScriptTypeScriptDocumentChangeMailbox,
    javaScriptTypeScriptDocumentSyncQueuesRef,
    javaScriptTypeScriptDocumentSyncGenerationRef,
    javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
    nextDocumentVersion,
    nextJavaScriptTypeScriptDocumentVersion,
    clearDocumentChangeTimer,
    clearJavaScriptTypeScriptDocumentChangeTimer,
    enqueueDocumentSync,
    enqueueJavaScriptTypeScriptDocumentSync,
    resetLanguageServerDocuments,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    getPhpDocumentSyncVersion,
  } = useLanguageServerDocumentSyncState();
  const { languageServerDiagnosticsByRootRef, languageServerRuntimeStatusByRootRef } =
    useWorkbenchLanguageRuntimeOwnerRefs();
  const {
    forgetExternallyRemovedDocumentPath,
    isExternallyRemovedDocumentPath,
    markExternallyRemovedDocumentPath,
    tombstonesByPathRef: externallyRemovedDocumentRootByPathRef,
  } = useExternallyRemovedDocumentTombstones();
  const {
    diagnosticsFlushSchedulerRef,
    javaScriptTypeScriptDiagnosticsByRootRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    languageServerDiagnosticsCoalescerRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
  } = useWorkbenchLanguageRuntimeChannelRefs(options.diagnosticsFlushScheduler);
  const phpClassSourcePathCacheRef = useRef<Record<string, string[]>>({});
  const phpFrameworkBindingCacheRef = useRef<Record<string, string | null>>({});
  const phpLocalDiagnosticValidationGenerationRef = useRef(0);
  const phpLocalDiagnosticRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const editorSessionOwnerKeyForRoot = useCallback(
    (rootPath: string): EditorSessionOwnerKey =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
      currentEditorSessionOwnerKeyRef.current
        ? currentEditorSessionOwnerKeyRef.current
        : createLegacyEditorSessionOwnerKey(rootPath),
    [currentEditorSessionOwnerKeyRef],
  );
  const resetIndexedWorkspaceViewsRef = useRef<() => void>(() => {});
  const resetIndexedWorkspaceViews = useCallback(() => {
    resetIndexedWorkspaceViewsRef.current();
  }, []);
  const resetPhpFrameworkCaches = useCallback(() => {
    resetPhpFrameworkCachesRef.current();
  }, []);
  const workspaceRuntimeOwnerGenerationForIndexRef = useRef<
    (ownerKey: string) => number | null | undefined
  >(() => null);
  const resolveWorkspaceRuntimeOwnerGenerationForIndex = useCallback(
    (ownerKey: string) => workspaceRuntimeOwnerGenerationForIndexRef.current(ownerKey),
    [],
  );
  const {
    clearIndexWorkspaceState,
    clearWorkspaceIndex,
    indexHealthLogs,
    indexProgress,
    restoreCachedIndexState,
    restoreIndexRoot,
    startHardReindex,
    startIndexScan,
    startInitialIndexScan,
    startPhpReindex,
  } = useWorkbenchIndexLifecycle({
    currentWorkspaceRootRef,
    indexProgressGateway,
    intelligenceMode,
    intelligenceModeRef,
    reportError,
    resetIndexedWorkspaceViews,
    resetPhpFrameworkCaches,
    setMessage,
    setNotices,
    workspaceRoot,
    workspaceIdentityDescriptorRef,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerGeneration: resolveWorkspaceRuntimeOwnerGenerationForIndex,
    workspaceRuntimeOwnerRef,
  });
  const artisanMakePaletteOpen = Boolean(
    workspaceRoot &&
    artisanMakePaletteRoot &&
    workspaceRootKeysEqual(workspaceRoot, artisanMakePaletteRoot),
  );
  const openArtisanMakePalette = useCallback(() => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) {
      return;
    }

    setArtisanMakePaletteRoot(rootPath);
  }, []);
  const closeArtisanMakePalette = useCallback(() => {
    setArtisanMakePaletteRoot(null);
  }, []);
  const workspaceRuntimeRootByTabRef = useRef<Record<string, string>>({});
  const workspaceRuntimeOwnerByTabRef = useRef<Record<string, WorkspaceRuntimeOwner>>({});
  const hasPhpWorkspaceByOwnerRef = useRef<Record<string, boolean>>({});
  const resolveWorkspaceRuntimeOwner = useCallback(
    (rootPath: string) => workspaceRuntimeOwnerByTabRef.current[rootPath] ?? null,
    [],
  );
  const phpDiagnosticsReclassificationCoordinatorRef = useRef(
    new PhpDiagnosticsReclassificationCoordinator(),
  );
  const reclassifyPhpLanguageServerDiagnosticsForRootRef = useRef<
    (rootPath: string, expectedOwnerKey: string) => boolean
  >(() => false);
  const onPhpLaravelSourcesLoaded = useCallback(
    (rootPath: string) => {
      const ownerKey =
        resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey ?? normalizedWorkspaceRootKey(rootPath);
      phpDiagnosticsReclassificationCoordinatorRef.current.sourcesLoaded(
        rootPath,
        ownerKey,
        (sourceRoot, expectedOwnerKey) =>
          reclassifyPhpLanguageServerDiagnosticsForRootRef.current(sourceRoot, expectedOwnerKey),
      );
    },
    [resolveWorkspaceRuntimeOwner],
  );
  const onPhpLanguageServerDiagnosticsCommitted = useCallback(
    (_rootPath: string, ownerKey: string) => {
      phpDiagnosticsReclassificationCoordinatorRef.current.diagnosticsCommitted(
        ownerKey,
        (sourceRoot, expectedOwnerKey) =>
          reclassifyPhpLanguageServerDiagnosticsForRootRef.current(sourceRoot, expectedOwnerKey),
      );
    },
    [],
  );
  const {
    currentPhpFrameworkSourceContext,
    ensurePhpFrameworkSourceCollectionsLoaded,
    invalidatePhpFrameworkSourcePath,
    resetPhpFrameworkSourceRegistries,
  } = usePhpFrameworkSourceRegistries({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    onSourcesLoaded: onPhpLaravelSourcesLoaded,
    workspaceFiles,
  });
  const openFileRef = useRef<
    (
      entry: FileEntry,
      options?: {
        pin?: boolean;
        readOnly?: boolean;
        recordNavigation?: boolean;
      },
    ) => Promise<boolean>
  >(async (_entry: FileEntry): Promise<boolean> => false);
  // PhpStorm double-Shift detector for Search Everywhere. Kept in a stable ref
  // so the keydown listener keeps the same instance across re-renders (the tap
  // timing must persist between events). 300ms is PhpStorm's default window.
  const doubleShiftDetectorRef = useRef(createDoubleShiftDetector({ windowMs: 300 }));
  // The active terminal session tracking and staged-command refs used by
  // "run in terminal" / "run PHP test" now live inside `useTerminalTestRunner`
  // (they are exclusively consumed there).
  const workspaceIdentityByRootRef = useRef<Record<string, WorkspaceIdentityDescriptor>>({});
  const resolveDocumentSaveOwnership = useCallback<ResolveDocumentSaveOwnership>(
    (rootPath, path) =>
      resolveAdmittedDocumentSaveOwnership(
        workspaceIdentityByRootRef.current,
        workspaceGateways.identity,
        rootPath,
        path,
      ),
    [workspaceGateways.identity],
  );
  const documentSessionAuthorityLifecycle = useMemo(
    () =>
      new DocumentSessionAuthorityLifecycleCoordinator({
        activate: activateDocumentSessionAuthority,
        deactivate: deactivateDocumentSessionAuthority,
      }),
    [activateDocumentSessionAuthority, deactivateDocumentSessionAuthority],
  );
  const documentSelfWrites = useMemo(() => new DocumentSelfWriteCoordinator(), []);
  const canonicalDocumentSaveRoot = useCallback(
    (rootPath: string) =>
      admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        workspaceGateways.identity,
        rootPath,
      )?.canonicalRoot ?? rootPath,
    [workspaceGateways.identity],
  );
  const resolveWorkspaceSettingsForDiagnosticsRoot = useCallback(
    (rootPath: string) => {
      const descriptor = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        workspaceGateways.identity,
        rootPath,
      );
      return workspaceSettingsByRoot.resolve(descriptor?.canonicalRoot ?? rootPath);
    },
    [workspaceGateways.identity, workspaceSettingsByRoot],
  );
  const workspaceRuntimeOwnerClaimsRef = useRef(new WorkspaceRuntimeOwnerClaimRegistry());
  workspaceRuntimeOwnerGenerationForIndexRef.current = (ownerKey) =>
    workspaceRuntimeOwnerClaimsRef.current.generationFor(ownerKey);
  const releaseWorkspaceTrustOwner = useCallback((ownerKey: string) => {
    workspaceTrustIntentCoordinatorRef.current.release(ownerKey);
    delete workspaceTrustRevisionByOwnerRef.current[ownerKey];
    if (javaScriptTypeScriptTrustAutostartRef.current?.owner.ownerKey === ownerKey) {
      javaScriptTypeScriptTrustAutostartRef.current = null;
    }
  }, []);
  const retireWorkspaceRuntimeOwnerClaim = useCallback(
    (ownerKey: string, expectedGeneration?: number | null) => {
      const retiredOwner = workspaceRuntimeOwnerClaimsRef.current.retire(
        ownerKey,
        expectedGeneration,
      );
      if (retiredOwner) {
        releaseWorkspaceTrustOwner(ownerKey);
      }
    },
    [releaseWorkspaceTrustOwner],
  );
  const resolveWorkspaceRuntimeOwnerForDiagnosticsEvent = useCallback(
    (
      event: LanguageServerDiagnosticEvent,
      runtimeKind: LanguageServerDiagnosticsRuntimeKind,
    ): WorkspaceRuntimeOwner | null => {
      if (!event.rootPath) {
        return null;
      }

      return workspaceRuntimeOwnerClaimsRef.current.resolveDiagnosticsEvent(
        event,
        runtimeKind,
        languageServerRuntimeStatusByRootRef.current,
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
      );
    },
    [javaScriptTypeScriptRuntimeStatusByRootRef, languageServerRuntimeStatusByRootRef],
  );
  const {
    flushDeferredCleanup: flushDeferredWorkspaceIdentityCleanup,
    releaseOwned: releaseOwnedWorkspaceIdentity,
    withManagedLease: withManagedWorkspaceIdentityLease,
  } = useManagedWorkspaceIdentityOwnership({
    deferredCleanupIdsRef: deferredWorkspaceIdentityCleanupIdsRef,
    identityGateway: workspaceGateways.identity,
    identityRequestTokensRef: pendingWorkspaceIdentityRequestTokensRef,
    mountedRef: workbenchMountedRef,
    nextAdmissionGenerationRef: workspaceIdentityAdmissionGenerationRef,
    ownedGenerationByIdRef: ownedWorkspaceIdentityGenerationByIdRef,
    ownedIdsRef: ownedWorkspaceIdentityIdsRef,
    pendingAdmissionsRef: pendingWorkspaceIdentityAdmissionsRef,
    releasedIdsRef: releasedWorkspaceIdentityIdsRef,
    releaseGenerationByIdRef: workspaceIdentityReleaseGenerationByIdRef,
    reportError,
    retireRuntimeOwnerClaim: retireWorkspaceRuntimeOwnerClaim,
    runtimeOwnerClaimsRef: workspaceRuntimeOwnerClaimsRef,
    unregisterByIdRef: workspaceIdentityUnregisterByIdRef,
  });
  const workspaceCloseGenerationByRootRef = useRef<Record<string, number>>({});
  const workspaceCloseOwnershipGenerationRef = useRef(0);
  const workspaceCloseOwnershipByKeyRef = useRef<Record<string, number>>({});
  const clearExternalFileConflictsForRootRef = useRef<(root: string) => void>(() => {});
  const workspaceHasExternalFileConflictsRef = useRef<(root: string) => boolean>(() => false);
  const readEditorConfigTextFile = useCallback(
    (path: string) => workspaceFiles.readTextFile(path),
    [workspaceFiles],
  );
  const {
    activeEditorConfig,
    activeEditorConfigRef,
    editorConfigCacheRef,
    invalidateRoot: invalidateEditorConfigRoot,
    refreshRoot: refreshEditorConfigRoot,
    reset: resetEditorConfigCache,
    resolveForFile: resolveEditorConfigForFile,
  } = useWorkbenchEditorConfigCoordinator({
    activeDocumentPath: activeDocument?.path ?? null,
    activeDocumentRef,
    currentWorkspaceRootRef,
    readTextFile: readEditorConfigTextFile,
    resolveWorkspaceRuntimeOwner,
    workspaceRoot,
  });
  const refreshEditorConfigAfterSave = useCallback(
    (rootPath: string, document: EditorDocument) => {
      refreshEditorConfigAfterDocumentSave(rootPath, document.path, refreshEditorConfigRoot);
    },
    [refreshEditorConfigRoot],
  );
  const filePrefetchCacheRef = useRef<FilePrefetchCache>(new FilePrefetchCache());
  const filePrefetchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastPhpFileOutlineRefreshKeyRef = useRef<string | null>(null);
  const contextualDiagnosticsFilterRef = useRef(
    async (
      _path: string,
      diagnostics: LanguageServerDiagnostic[],
    ): Promise<LanguageServerDiagnostic[]> => diagnostics,
  );

  const {
    activeEditorPosition,
    activeEditorPositionRef,
    clearEditorRevealTarget,
    editorRevealTarget,
    navigationHistory,
    recentFiles,
    recentFilesSwitcherOpen,
    recentLocations,
    recentLocationsPanelOpen,
    resetActiveEditorPosition,
    resetHistory,
    restoreHistory,
    setEditorRevealTarget,
    setNavigationHistory,
    setRecentFiles,
    setRecentFilesSwitcherOpen,
    setRecentLocations,
    setRecentLocationsPanelOpen,
    updateActiveEditorPosition,
  } = useWorkbenchNavigationState({ cursorStore: editorCursorStore });
  const {
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    openDocumentPaths,
    openDocuments,
    openMarkdownPreviews,
    openTabs,
    shouldAutoStartJavaScriptTypeScriptLanguageServer,
  } = useWorkbenchEditorPresentation({
    activeDocument,
    documents,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    workspaceDescriptor,
    workspaceRoot,
  });
  const phpIdeReadinessSignature = useMemo(() => {
    if (!workspaceRoot || !workspaceDescriptor?.php) {
      return null;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      return null;
    }

    if (!workspaceTrusted) {
      return null;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return null;
    }

    if (!canUseLanguageServerFeature(languageServerRuntimeStatus.capabilities, "completion")) {
      return null;
    }

    if (
      indexProgress.status === "scanning" &&
      (!indexProgress.rootPath || workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot))
    ) {
      return null;
    }

    return [
      workspaceRoot,
      languageServerRuntimeStatus.sessionId ?? "managed",
      phpFrameworkIntelligence.providerSignature,
      indexProgress.rootPath ?? "no-index-root",
      indexProgress.status,
      indexProgress.indexedFiles,
    ].join(":");
  }, [
    phpFrameworkIntelligence.providerSignature,
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    intelligenceMode,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrusted,
  ]);

  useEffect(() => {
    if (!phpIdeReadinessSignature) {
      return;
    }

    if (lastPhpIdeReadinessSignatureRef.current === phpIdeReadinessSignature) {
      return;
    }

    lastPhpIdeReadinessSignatureRef.current = phpIdeReadinessSignature;
    setPhpIdeReadinessVersion((current) => current + 1);
  }, [phpIdeReadinessSignature]);

  useEffect(
    () => () => {
      for (const timeoutId of emptyDocumentRefreshTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }

      emptyDocumentRefreshTimeoutsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    languageServerRuntimeStatusRef.current = languageServerRuntimeStatus;
    languageServerRuntimeStatusRootRef.current = languageServerRuntimeStatusRoot;
  }, [
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef,
  ]);

  useEffect(() => {
    javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatus;
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot;
  }, [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
  ]);

  useEffect(() => {
    intelligenceModeRef.current = intelligenceMode;
  }, [intelligenceMode]);

  const reportErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, source: string, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      reportError(source, error);
    },
    [reportError],
  );
  const textSearchWorkbench = useWorkbenchDockedTextSearch({
    bottomPanelViewRef,
    bottomPanelVisible,
    setBottomPanelView,
    setBottomPanelVisible,
    workspaceKey: editorSessionOwnerKey ?? "",
    workspaceRoot,
    workspaceOwnerKey: editorSessionOwnerKey,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openFileRef,
    prompter,
    dirtyTextSearch: workspaceGateways.dirtyTextSearch,
    textSearch,
    workspaceFiles,
    reportError,
    reportChangedDocuments,
    setDocuments,
    setEditorRevealTarget,
    setMessage,
  });
  const { resetTextSearchState, setTextSearchOpen } = textSearchWorkbench;
  const {
    reportLanguageServerCrash,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
  } = useLanguageServerFeatureErrorReporting({
    currentWorkspaceRootRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    lastLanguageServerCrashRef,
    setMessage,
    setNotices,
    syncedDocumentPathsRef,
  });
  const reportJavaScriptTypeScriptLanguageServerError = useCallback(
    (error: unknown) => {
      reportError("JavaScript/TypeScript", error);
    },
    [reportError],
  );

  const latencyTrackerForRoot = useWorkbenchLatencyTrackerForRoot({
    currentWorkspaceRootRef,
    latencyTrackersByRootRef,
  });
  const {
    adoptCachedDirectoryProjection,
    cachedDirectoryNeedsRefresh,
    failedDirectories,
    loadDirectory,
    primeCachedDirectoryEntries,
    refreshCachedExpandedDirectories,
    resetDirectoryExplorerLifecycle,
    retryDirectory,
    toggleDirectory,
  } = useWorkspaceDirectoryExplorer({
    currentWorkspaceRootRef,
    entriesByDirectory,
    expandedDirectories,
    inFlightLoadsRef: inFlightDirectoryLoadsRef,
    latencyTrackerForRoot,
    openWorkspaceRequestTokenRef,
    reportError,
    setEntriesByDirectory,
    setExpandedDirectories,
    setLoadingDirectories,
    setManuallyCollapsedDirectories,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  });
  const quickOpenPrefixDispatch = useQuickOpenPrefixDispatch();
  const {
    quickOpenOpen,
    quickOpenQuery,
    quickOpenLoading,
    quickOpenRequest,
    quickOpenResults,
    quickOpenTruncated,
    setQuickOpenOpen,
    setQuickOpenQuery,
  } = useWorkbenchQuickOpen({
    activePath,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    recentFiles,
    setMessage,
    workspaceRoot,
    ...quickOpenPrefixDispatch,
  });
  const [floatingSurfaceActivationVersion, setFloatingSurfaceActivationVersion] = useState(0);
  const markFloatingSurfaceActivated = useCallback(() => {
    setFloatingSurfaceActivationVersion((current) => current + 1);
  }, []);

  const {
    classOpenOpen,
    classOpenQuery,
    classOpenLoading,
    classOpenResults,
    canSearchClassOpenSymbols,
    setClassOpenOpen,
    setClassOpenQuery,
    setClassOpenLoading,
    setClassOpenResults,
    searchClassOpenSymbols,
  } = useWorkbenchClassOpen({
    cancelJavaScriptTypeScriptLanguageServerRequest,
    workspaceRoot,
    currentWorkspaceRootRef,
    intelligenceMode,
    projectSymbolSearch,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    reportError,
    resolveWorkspaceRuntimeOwner,
    setMessage,
  });

  const {
    workspaceSymbolsOpen,
    workspaceSymbolsQuery,
    workspaceSymbolsLoading,
    workspaceSymbolsResults,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setWorkspaceSymbolsLoading,
    setWorkspaceSymbolsResults,
  } = useWorkbenchWorkspaceSymbols({
    workspaceRoot,
    workspaceOwner: workspaceRuntimeOwner,
    canSearchClassOpenSymbols,
    searchClassOpenSymbols,
    reportError,
    setMessage,
  });

  const {
    searchEverywhereOpen,
    searchEverywhereQuery,
    searchEverywhereLoading,
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    resetSearchEverywhere,
    searchEverywhereModelFor,
  } = useWorkbenchSearchEverywhere({
    canSearchClassOpenSymbols,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    searchClassOpenSymbols,
    workspaceRoot,
  });

  const {
    clearLatencyMetrics,
    forgetLatencyTrackerForRoot,
    getLatencySnapshot,
    recordCompletionLatency,
  } = useWorkbenchLatencyReporting({
    currentWorkspaceRootRef,
    latencyTrackersByRootRef,
    latencyTrackerForRoot,
  });

  const {
    applyAppSettings,
    applyWorkspaceSettings,
    persistAppSettings,
    persistWorkspaceSettings,
    resetEditorFontSize,
    toggleEditorFontLigatures,
    zoomEditorFontIn,
    zoomEditorFontOut,
  } = useWorkbenchSettingsPersistence({
    appSettingsRef,
    currentWorkspaceRootRef,
    reportError,
    setAppSettings,
    setWorkspaceSettings,
    settingsGateway,
    workspaceIdentityByRootRef,
    workspaceSettingsByRoot,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
  });

  const {
    workspaceStateCacheRef,
    cacheCurrentWorkspaceState,
    resolveCachedWorkspaceState,
    coalesceWorkspaceStateCache,
    forgetCachedWorkspaceState,
    restoreCachedWorkspaceState,
    restorePersistedNavigationSession,
    snapshotPersistedWorkspaceSession,
    clearWorkspaceStateCache,
  } = useWorkspaceStateCache({
    bookmarks,
    bottomPanelView,
    bottomPanelVisible,
    entriesByDirectory,
    expandedDirectories,
    indexHealthLogs,
    indexProgress,
    manuallyCollapsedDirectories,
    navigationHistory,
    recentFiles,
    recentLocations,
    restoreCachedIndexState,
    restoreEditorSurface,
    restoreHistory,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setEntriesByDirectory,
    setExpandedDirectories,
    setManuallyCollapsedDirectories,
    setRecentFiles,
    setRecentLocations,
    setSidebarView,
    setWorkspaceIdentityDescriptor,
    sidebarView,
    snapshotEditorSurface,
    workspaceIdentityDescriptor,
  });

  const persistCurrentWorkspaceSession = usePersistCurrentWorkspaceSession({
    bottomPanelView,
    editorSessionOwnerKeyForRoot,
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    sidebarView,
    snapshotEditorSurface,
    snapshotPersistedWorkspaceSession,
    workspaceEditorViewStatesRef,
    workspaceSessionRestoredRef,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
  });

  const {
    recordRecentFile,
    forgetRecentFile,
    remapRecentFile,
    openRecentFilesSwitcher,
    forgetRecentLocationsForPath,
    remapRecentLocations,
    openRecentLocationsPanel,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    recordCurrentNavigationLocation,
  } = useRecentNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    documentsRef,
    resolveCurrentWorkspaceRuntimeOwner,
    setClassOpenOpen,
    setNavigationHistory,
    setQuickOpenOpen,
    setRecentFiles,
    setRecentFilesSwitcherOpen,
    setRecentLocations,
    setRecentLocationsPanelOpen,
    setWorkspaceSymbolsOpen,
  });

  const {
    gitDiffDocuments,
    gitDiffLoading,
    selectedGitChange,
    gitDiffPreview,
    gitDiffRequestTokenRef,
    resetGitDiffWorkspaceState,
    clearGitDiffPreviewState,
    cancelGitDiffDocument,
    getGitDiffDocument,
    getSelectedGitDiffDocument,
    loadGitDiffDocument,
    reloadGitDiffDocument,
    reconcileGitDiffDocument,
    previewGitChange,
    openGitChange,
    closeReplacedGitDiffDocumentRef,
    connectDiffPreviewReconciliation,
    gitOperationCurrency,
    activeDocumentGitBaseline,
    applyGitOperationStatuses,
    gitActiveFileBranch,
    gitLoading,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    gitStatus,
    refreshGitStatus,
    resetGitStatusSurface,
    resolveGitRepositoryTarget,
    runGitRepositoryDiscovery,
  } = useWorkbenchGitDiscoveryCoordinator({
    diffWorkspace: {
      workspaceRoot,
      gitGateway,
      currentWorkspaceRootRef,
      documentTabSession,
      setMessage,
      recordCurrentNavigationLocation,
      reportError,
    },
    statusSurface: {
      activeDocument,
      activePath,
      currentWorkspaceRootRef,
      editorGitBaselineRequestTokenRef,
      gitGateway,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      setMessage,
      workspaceRoot,
    },
  });

  const agents = useWorkbenchControllerAgents({
    appSettingsRef,
    bottomPanelVisible,
    options,
    openFileRef,
    openGitChange,
    editorSessionOwnerKey,
    gitGateway,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    openDocuments,
    prompter,
    reportError,
    setSettingsInitialSection,
    setSettingsOpen,
    setWorkspaceTrust,
    settingsGateway,
    workspaceIdentityByRootRef,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
    workspaceTrustGateway,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
    persistWorkspaceSettings,
  });

  const {
    replaceEslintDiagnostics,
    clearEslintDiagnosticsForRoot,
    replacePhpstanDiagnostics,
    clearPhpstanDiagnosticsForRoot,
    clearLanguageServerDiagnostics,
    restoreLanguageServerDiagnosticsForRoot,
    resetLanguageServerDiagnosticsForRoot,
    prepareLanguageServerDiagnosticsForRuntimeStart,
    clearLanguageServerDiagnosticsForRoot,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    restoreJavaScriptTypeScriptDiagnosticsForRoot,
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    updateLocalPhpDiagnostics,
    refreshLocalPhpDiagnosticsForContent,
    applyLanguageServerDiagnostics,
    applyLanguageServerDiagnosticsBatch,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnosticsBatch,
    isLanguageServerSessionCurrentForRoot,
  } = useWorkbenchLanguageDiagnosticsCoordinator({
    diagnostics: {
      currentWorkspaceRootRef,
      activeDocumentRef,
      documentsRef,
      activeDocument,
      appSettingsRef,
      workspaceSettingsForRoot: resolveWorkspaceSettingsForDiagnosticsRoot,
      setLanguageServerDiagnosticsByPath,
      setJavaScriptTypeScriptDiagnosticsByPath,
      setPhpLocalDiagnosticsByPath,
      setFrameworkDiagnosticsByPath,
      setNotices,
      languageServerDiagnosticsByRootRef,
      javaScriptTypeScriptDiagnosticsByRootRef,
      languageServerDiagnosticsCoalescerRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
      lastAppliedDiagnosticVersionByUriRef,
      javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      languageServerRuntimeStatusByRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      contextualDiagnosticsFilterRef,
      phpLocalDiagnosticValidationGenerationRef,
      phpLocalDiagnosticRetryTimersRef,
      phpLocalSyntaxDiagnosticsGateway,
      isExternallyRemovedDocumentPath,
      onPhpLanguageServerDiagnosticsCommitted,
      reportLanguageServerErrorForActiveWorkspaceRoot,
    },
    languageServerRuntimeStatusByRootRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    workspaceRuntimeOwnerByTabRef,
  });

  const {
    activeEslintBufferClean,
    activeEslintFixes,
    activePhpstanBufferClean,
    disableEslintRuleAtCursor,
    fixAllEslintInActiveFile,
    hasEslintDiagnosticAtCursor,
    hasPhpstanDiagnosticAtCursor,
    ignorePhpstanIssueAtCursor,
    runEslintAnalysis,
    runEslintAnalysisOnSave,
    runPhpstanAnalysis,
    runPhpstanAnalysisOnSave,
  } = useWorkbenchStaticAnalysisCoordinator({
    activeDocument,
    activeDocumentRef,
    activeEditorPositionRef,
    appWorkspaceTabs: appSettings.workspaceTabs,
    clearEslintDiagnosticsForRoot,
    clearPhpstanDiagnosticsForRoot,
    currentWorkspaceRootRef,
    editorSurfaceBufferFixRunner: editorSurfaceBufferFixRunner ?? null,
    editorSurfaceEslintDisableRunner: editorSurfaceEslintDisableRunner ?? null,
    editorSurfacePhpstanIgnoreRunner: editorSurfacePhpstanIgnoreRunner ?? null,
    eslintAnalysisInFlightRef,
    eslintAnalysisRunning,
    eslintDiagnosticsByRoot,
    eslintDiagnosticsGateway,
    eslintFixesByRoot,
    eslintWorkspaceTabsRef,
    phpstanAnalysisInFlightRef,
    phpstanAnalysisRunning,
    phpstanDiagnosticsByRoot,
    phpstanDiagnosticsGateway,
    phpstanWorkspaceTabsRef,
    replaceEslintDiagnostics,
    replacePhpstanDiagnostics,
    setEslintAnalysisRunning,
    setEslintDiagnosticsByRoot,
    setEslintFixesByRoot,
    setMessage,
    setPhpstanAnalysisRunning,
    setPhpstanDiagnosticsByRoot,
    workspaceDescriptor,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrusted,
  });

  resetIndexedWorkspaceViewsRef.current = () => {
    lastPhpFileOutlineRefreshKeyRef.current = null;
    setPhpTree(emptyPhpTree());
    setPhpTreeExpandedNodeIds(new Set());
    setPhpTreeLoading(false);
    setPhpFileOutlinesByPath({});
    setPhpInheritedFileOutlinesByPath({});
    setExpandedPhpFilePaths(new Set());
    setLoadingPhpFileOutlinePaths(new Set());
    setLoadingInheritedPhpFileOutlinePaths(new Set());
    setPhpFileOutlineExpandedNodeIds(new Set());
    setClassOpenResults([]);
  };

  const {
    refreshLanguageServerPlan,
    runPhpWorkspaceProbe,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    forgetLanguageServerRuntimeStatuses,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    stopLanguageServerRuntime,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    stopProjectRuntimes,
    stopBackgroundProjectRuntimes,
    startLanguageServer,
    stopLanguageServer,
    restartJavaScriptTypeScriptService,
    refreshJavaScriptTypeScriptPlanAfterTrustGrant,
    stopProjectLanguageServersAfterTrustRevocation,
  } = useWorkbenchLanguageRuntimeOwnershipCoordinator({
    lifecycle: {
      workspaceRoot,
      workspaceRuntimeOwner,
      workspaceTrust,
      intelligenceMode,
      workspaceSettings,
      shouldAutoStartJavaScriptTypeScriptLanguageServer,
      phpLanguageServerAutostartRetryVersion,
      languageServerPlan,
      javaScriptTypeScriptLanguageServerPlan,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      appSettingsRef,
      workspaceSettingsRef,
      currentWorkspaceRootRef,
      autoStartedLanguageServerRootRef,
      phpLanguageServerAutostartAttemptsByRootRef,
      manuallyStoppedPhpLanguageServerRootsRef,
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      lastLanguageServerCrashRef,
      languageServerRuntimeStatusByRootRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      setPhpTools,
      setLanguageServerPlan,
      setJavaScriptTypeScriptLanguageServerPlan,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setMessage,
      setNotices,
      setPhpLanguageServerAutostartRetryVersion,
      phpToolGateway,
      languageServerGateway,
      languageServerRuntimeGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceRuntimeLifecycleGateway,
      terminalGateway,
      clearLanguageServerDiagnosticsForRoot,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      resetLanguageServerDiagnosticsForRoot,
      resetJavaScriptTypeScriptDiagnosticsForRoot,
      prepareLanguageServerDiagnosticsForRuntimeStart,
      prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
      resetLanguageServerDocuments,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      isLanguageServerSessionCurrentForRoot,
      reportError,
      reportLanguageServerCrash,
      reportLanguageServerError,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      reportErrorForActiveWorkspaceRoot,
    },
    ownership: {
      javaScriptTypeScriptRuntimeStatusByRootRef,
      javaScriptTypeScriptTrustAutostartRef,
      languageServerRuntimeStatusByRootRef,
      openWorkspaceRequestTokenRef,
      resolveCurrentWorkspaceRuntimeOwner,
      workspaceTrustRevisionByOwnerRef,
      workspaceTrustRevocationByOwnerRef,
      workspaceRuntimeOwnerClaimsRef,
    },
  });

  const {
    applyJavaScriptTypeScriptSettingsChange,
    openJavaScriptTypeScriptServiceLog,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    javaScriptTypeScriptFileStructureLoadingForDocument,
    openJavaScriptTypeScriptFileStructure,
    resetJavaScriptTypeScriptFileStructure,
  } = useWorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinator({
    settings: {
      workspaceRoot,
      activeDocumentRef,
      activeEditorConfigRef,
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      currentWorkspaceRootRef,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      setMessage,
      stopJavaScriptTypeScriptLanguageServerRuntime,
    },
    fileStructure: {
      workspaceRoot,
      currentWorkspaceRootRef,
      languageServerFeaturesGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
      languageServerRuntimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      setMessage,
      setFileStructureOpen,
      setFileStructureScopeCurrent: setJavaScriptTypeScriptFileStructureScopeCurrent,
    },
    isSessionActive: isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
  });

  const javaScriptTypeScriptIncrementalSyncRef = useJavaScriptTypeScriptIncrementalSyncOwnerRef();

  const {
    syncOpenDocument,
    syncOpenJavaScriptTypeScriptDocument,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    flushPendingDocumentChange,
    flushPendingDocumentChangeForRoot,
    flushPendingJavaScriptTypeScriptDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    isLanguageServerDocumentSynced,
    getLanguageServerDocumentLifecycleIdentity,
    getJavaScriptTypeScriptDocumentSyncVersion,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    syncSavedDocument: syncSavedDocumentForRoot,
    syncSavedJavaScriptTypeScriptDocument: syncSavedJavaScriptTypeScriptDocumentForRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
  } = useWorkbenchLanguageDocumentSyncCoordinator({
    documentSync: {
      largeSmartDocumentPolicy: workspaceSettings.largeFileMode,
      currentWorkspaceRootRef,
      activeDocumentRef,
      documentsRef,
      syncedDocumentPathsRef,
      syncedDocumentContentRef,
      pendingDocumentChangesRef,
      pendingDocumentOpenSyncAttemptsRef,
      documentOpenSyncAttemptIdRef,
      documentChangeTimersRef,
      documentSyncQueuesRef,
      documentSyncGenerationRef,
      nextDocumentLifecycleIdentityRef,
      documentLifecycleIdentitiesRef,
      pendingDocumentLifecycleIdentitiesRef,
      documentVersionsRef,
      documentVersionsByUriRef,
      lastAppliedDiagnosticVersionByUriRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      languageServerRuntimeStatusByRootRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      javaScriptTypeScriptDocumentOpenSyncAttemptIdRef,
      javaScriptTypeScriptDocumentChangeTimersRef,
      javaScriptTypeScriptDocumentChangeMailbox,
      javaScriptTypeScriptDocumentSyncQueuesRef,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptDocumentVersionsRef,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      javaScriptTypeScriptIncrementalSyncRef,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      nextDocumentVersion,
      nextJavaScriptTypeScriptDocumentVersion,
      clearDocumentChangeTimer,
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueDocumentSync,
      enqueueJavaScriptTypeScriptDocumentSync,
      resetLanguageServerDocuments,
      isLanguageServerSessionCurrentForRoot,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      isJavaScriptTypeScriptDocumentSyncableForRoot,
      reportLanguageServerError,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      reportErrorForActiveWorkspaceRoot,
    },
    incrementalSync: {
      currentWorkspaceRootRef,
      documentsRef,
      gateway: javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway,
      isSessionCurrent: isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      productionRef: javaScriptTypeScriptIncrementalSyncRef,
      runtimeStatusRef: javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      runtimeStatusRootRef: javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      syncGenerationRef: javaScriptTypeScriptDocumentSyncGenerationRef,
    },
    replacedGitDiffClose: {
      closeRef: closeReplacedGitDiffDocumentRef,
      currentRootRef: currentWorkspaceRootRef,
      reportJavaScriptTypeScript: (rootPath, error) =>
        reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error),
      reportPhp: reportLanguageServerErrorForActiveWorkspaceRoot,
    },
    warmup: {
      gateway: languageServerFeaturesGateway,
      isSessionCurrent: isLanguageServerSessionCurrentForRoot,
      warmedRootsRef: phpLanguageServerIndexWarmedRootsRef,
    },
  });

  const openSymbolPanelNavigationTargetRef = useRef<
    (
      path: string,
      position: EditorPosition,
      label: string,
      options?: { readOnly?: boolean },
    ) => Promise<boolean>
  >(async () => false);
  const openSymbolPanelNavigationTarget = useCallback(
    (path: string, position: EditorPosition, label: string, options?: { readOnly?: boolean }) =>
      openSymbolPanelNavigationTargetRef.current(path, position, label, options),
    [],
  );
  const closeSymbolPanelCompetingSurfaces = useCallback(() => {
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
  }, [
    setClassOpenOpen,
    setPaletteOpen,
    setTextSearchOpen,
    setImplementationChooser,
    setQuickOpenOpen,
    setWorkspaceSymbolsOpen,
  ]);
  const {
    callHierarchyView,
    typeHierarchyView,
    referencesView,
    setCallHierarchyView,
    setTypeHierarchyView,
    setReferencesView,
    openCallHierarchyRow,
    openTypeHierarchyRow,
    openReferenceRow,
    openCallHierarchy,
    openTypeHierarchy,
    openReferencesPanel,
    openFileReferencesPanel,
  } = useWorkbenchSymbolPanels({
    activeDocumentRef,
    activeEditorPositionRef,
    cancelJavaScriptTypeScriptLanguageServerRequest,
    workspaceRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    openNavigationTarget: openSymbolPanelNavigationTarget,
    shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
    closeCompetingSurfaces: closeSymbolPanelCompetingSurfaces,
    reportError,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
  });

  const resetFilePrefetchState = useCallback(() => {
    for (const timer of filePrefetchTimersRef.current.values()) {
      clearTimeout(timer);
    }

    filePrefetchTimersRef.current.clear();
    filePrefetchCacheRef.current.clear();
  }, []);

  const closeBookmarksPanelRef = useRef<() => void>(() => {});
  const resetWorkspaceTodosRef = useRef<() => void>(() => {});

  const clearActiveWorkspace = useCallback(
    async (options?: { ownership?: WorkspaceCloseOwnership; runtimeAlreadyStopped?: boolean }) => {
      const ownership = options?.ownership;
      if (ownership && !ownership.isCurrent()) {
        return;
      }

      const currentRootPath = currentWorkspaceRootRef.current;
      if (currentRootPath) {
        clearPhpstanDiagnosticsForRoot(currentRootPath);
      }

      if (currentRootPath && !options?.runtimeAlreadyStopped) {
        await stopProjectRuntimes(
          workspaceRuntimeRootByTabRef.current[currentRootPath] ?? currentRootPath,
          workspaceRuntimeOwnerByTabRef.current[currentRootPath],
        );
        if (ownership && !ownership.isCurrent()) {
          return;
        }
      }

      if (currentRootPath) {
        languageServerDiagnosticsCoalescerRef.current?.dropRoot(currentRootPath);
        javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(currentRootPath);
      }

      documentSessionAuthorityLifecycle.deactivate();
      workspaceSessionRestoredRef.current = false;
      workspaceEditorViewStatesRef.current = {};
      currentEditorSessionOwnerKeyRef.current = null;
      currentWorkspaceRootRef.current = null;
      clearWorkspaceStateCache();
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      hasPhpWorkspaceByOwnerRef.current = {};
      workspaceRuntimeOwnerClaimsRef.current.clear();
      resetEditorConfigCache();
      resetFilePrefetchState();
      languageServerRuntimeStatusByRootRef.current = {};
      languageServerDiagnosticsByRootRef.current = {};
      javaScriptTypeScriptRuntimeStatusByRootRef.current = {};
      javaScriptTypeScriptDiagnosticsByRootRef.current = {};
      lastLanguageServerCrashRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      installingManagedPhpactorRootRef.current = null;
      installingManagedTypeScriptLanguageServerRootRef.current = null;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openFileRequestTokenRef.current += 1;
      resetActiveEditorPosition();
      setWorkspaceRoot(null);
      setWorkspaceIdentityDescriptor(null);
      setWorkspaceDescriptor(null);
      setPackageScriptsByRoot({});
      setWorkspaceTrust(null);
      setPhpTools(null);
      setLanguageServerPlan(null);
      setJavaScriptTypeScriptLanguageServerPlan(null);
      setLanguageServerRuntimeStatus(null);
      setLanguageServerRuntimeStatusRoot(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      setInstallingManagedTypeScriptLanguageServer(false);
      setEntriesByDirectory({});
      setLoadingDirectories(new Set());
      resetDirectoryExplorerLifecycle();
      setExpandedDirectories(new Set());
      setManuallyCollapsedDirectories(new Set());
      resetEditorSurfaceState();
      setArtisanMakePaletteRoot(null);
      setRecentFiles([]);
      setRecentLocations([]);
      setBookmarks([]);
      closeBookmarksPanelRef.current();
      setGitBlameEnabledPaths(new Set());
      setEditorRevealTarget(null);
      resetHistory();
      setSidebarView("files");
      setBottomPanelView("problems");
      setBottomPanelVisible(false);
      resetWorkspaceTodosRef.current();
      resetGitStatusSurface();
      resetGitDiffWorkspaceState();
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      setPhpFileOutlinesByPath({});
      setPhpInheritedFileOutlinesByPath({});
      setExpandedPhpFilePaths(new Set());
      setLoadingPhpFileOutlinePaths(new Set());
      setLoadingInheritedPhpFileOutlinePaths(new Set());
      resetJavaScriptTypeScriptFileStructure();
      setPhpFileOutlineExpandedNodeIds(new Set());
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenLoading(false);
      setClassOpenResults([]);
      setWorkspaceSymbolsOpen(false);
      setWorkspaceSymbolsQuery("");
      setWorkspaceSymbolsLoading(false);
      setWorkspaceSymbolsResults([]);
      resetSearchEverywhere();
      setQuickOpenOpen(false);
      setRecentFilesSwitcherOpen(false);
      setRecentLocationsPanelOpen(false);
      resetTextSearchState();
      setPaletteOpen(false);
      setFileStructureOpen(false);
      setFileStructureScope("current");
      setImplementationChooser(null);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setLanguageServerSetupOpen(false);
      setInstallingManagedPhpactor(false);
      setSettingsOpen(false);
      setMessage(null);
      setNotices([]);
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      clearPhpLocalDiagnostics();
      setPhpIdeReadinessVersion(0);
      applyWorkspaceSettings(defaultWorkspaceSettings());
      setIntelligenceMode("basic");
      intelligenceModeRef.current = "basic";
      clearIndexWorkspaceState();
    },
    [
      applyWorkspaceSettings,
      closeBookmarksPanelRef,
      clearIndexWorkspaceState,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerDiagnosticsByRootRef,
      languageServerDiagnosticsCoalescerRef,
      languageServerRuntimeStatusByRootRef,
      clearPhpLocalDiagnostics,
      clearPhpstanDiagnosticsForRoot,
      clearWorkspaceStateCache,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      resetActiveEditorPosition,
      resetFilePrefetchState,
      resetEditorSurfaceState,
      resetHistory,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetSearchEverywhere,
      resetJavaScriptTypeScriptFileStructure,
      resetDirectoryExplorerLifecycle,
      resetWorkspaceTodosRef,
      resetEditorConfigCache,
      resetTextSearchState,
      setExpandedDirectories,
      setNotices,
      setPaletteOpen,
      stopProjectRuntimes,
      setCallHierarchyView,
      setClassOpenLoading,
      setClassOpenOpen,
      setClassOpenQuery,
      setClassOpenResults,
      setEditorRevealTarget,
      setImplementationChooser,
      setQuickOpenOpen,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setReferencesView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults,
    ],
  );

  const loadPackageScripts = useCallback(
    async (
      rootPath: string,
      entries: readonly FileEntry[],
      isMutationOwnerCurrent?: () => boolean,
    ) => {
      const hasComposerManifest = entries.some(
        (entry) => entry.kind === "file" && entry.name === "composer.json",
      );
      const hasArtisan = entries.some((entry) => entry.kind === "file" && entry.name === "artisan");
      const composerJson = await (hasComposerManifest
        ? readTestFileIfExists(joinWorkspacePath(rootPath, "composer.json"))
        : Promise.resolve(null));

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        (isMutationOwnerCurrent && !isMutationOwnerCurrent())
      ) {
        return;
      }

      setPackageScriptsByRoot((current) => ({
        ...current,
        [rootPath]: {
          composerScripts: composerJson ? parseComposerScripts(composerJson) : [],
          hasArtisan,
        },
      }));
    },
    [readTestFileIfExists],
  );

  const restoreWorkspaceSession = useWorkspaceSessionRestorer({
    currentWorkspaceRootRef,
    editorSessionOwnerKeyForRoot,
    openFileRequestTokenRef,
    setBottomPanelView,
    setDocuments,
    setNotices,
    setSidebarView,
    updateEditorGroups,
    updateLocalPhpDiagnostics,
    viewStatesRef: workspaceEditorViewStatesRef,
    workspaceFiles,
  });

  const runWithIssuedWriteDrainRef = useRef<RunWithDocumentSaveExclusion>(
    async (_scope, operation) => operation(),
  );
  const runWithIssuedWriteDrainDelegate = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => runWithIssuedWriteDrainRef.current(scope, operation),
    [],
  );

  const performOpenWorkspacePath = useCallback(
    async (
      path: string,
      identityDescriptor: WorkspaceIdentityDescriptor | null,
      adoptIdentity: (() => void) | null,
      requestToken: number,
      options: OpenWorkspacePathOptions = {},
    ) => {
      const shouldCachePreviousWorkspace = options.cachePreviousWorkspace !== false;
      if (openWorkspaceRequestTokenRef.current !== requestToken) {
        return;
      }

      openWorkspaceRequestPathRef.current = path;
      setArtisanMakePaletteRoot(null);
      const isCurrentOpenWorkspaceRequest = () =>
        workbenchMountedRef.current &&
        openWorkspaceRequestTokenRef.current === requestToken &&
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path);
      const previousRootPath = currentWorkspaceRootRef.current;
      const canonicalKey = identityDescriptor?.canonicalRoot ?? path;
      const workspaceSettingsLoadKey = normalizedWorkspaceRootKey(canonicalKey);
      const requestedSettingsIdentity = identityDescriptor
        ? workspaceSettingsIdentity(canonicalKey, path)
        : path;
      const requestedLegacyRawKeys =
        typeof requestedSettingsIdentity === "string"
          ? [requestedSettingsIdentity]
          : (requestedSettingsIdentity.legacyRawKeys ?? []);
      const previousWorkspaceIdentity = previousRootPath
        ? (workspaceIdentityByRootRef.current[previousRootPath] ?? null)
        : null;
      const previousWorkspaceSettingsSaveCoordinator = workspaceSettingsSaveCoordinator;
      const { nextOwnerKey, replacingOwnerAtSameRoot, switchingWorkspace } =
        resolveDocumentSessionWorkspaceTransition(
          previousRootPath,
          previousWorkspaceIdentity,
          path,
          identityDescriptor,
        );

      let cachedWorkspaceState =
        identityDescriptor && switchingWorkspace
          ? null
          : identityDescriptor
            ? coalesceWorkspaceStateCache(identityDescriptor, path)
            : resolveCachedWorkspaceState(canonicalKey);

      const adoptLegacyWorkspaceCache = () => {
        if (!identityDescriptor || cachedWorkspaceState) {
          return;
        }

        const legacyCachedWorkspaceState = adoptLegacyCachedWorkspaceState(identityDescriptor, [
          resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
          resolveCachedWorkspaceState(path),
        ]);
        if (!legacyCachedWorkspaceState) {
          return;
        }

        cachedWorkspaceState = coalesceWorkspaceStateCache(identityDescriptor, path);
      };

      if (switchingWorkspace && previousRootPath) {
        resetFilePrefetchState();
      }

      if (switchingWorkspace && previousRootPath) {
        const captureAndDeactivatePreviousWorkspace = async () => {
          if (!isCurrentOpenWorkspaceRequest()) {
            return "stale" as const;
          }

          const captureResult = await captureWorkspaceBeforeSwitch(
            {
              rootPath: previousRootPath,
              cacheWorkspace: shouldCachePreviousWorkspace,
              isRequestCurrent: isCurrentOpenWorkspaceRequest,
            },
            {
              invalidatePendingFileOpen: () => {
                openFileRequestTokenRef.current += 1;
              },
              persistWorkspaceSession: persistCurrentWorkspaceSession,
              cacheWorkspaceState: cacheCurrentWorkspaceState,
              reportPersistenceError: (rootPath, error) => {
                reportErrorForActiveWorkspaceRoot(rootPath, "Session", error);
              },
            },
          );

          if (captureResult === "stale" || !isCurrentOpenWorkspaceRequest()) {
            return "stale" as const;
          }

          return closeWorkspaceDocumentsBeforeSwitch(
            {
              rootPath: previousRootPath,
              isRequestCurrent: isCurrentOpenWorkspaceRequest,
            },
            {
              closeLanguageServerDocuments: closeSyncedLanguageServerDocumentsForRoot,
              closeJavaScriptTypeScriptDocuments: closeSyncedJavaScriptTypeScriptDocumentsForRoot,
            },
            workspaceDocumentCloseCoordinatorRef.current,
          );
        };

        const switchResult = shouldCachePreviousWorkspace
          ? await runWithIssuedWriteDrainDelegate(
              {
                kind: "workspace",
                canonicalRoot: canonicalDocumentSaveRoot(previousRootPath),
              },
              captureAndDeactivatePreviousWorkspace,
            )
          : await captureAndDeactivatePreviousWorkspace();

        if (switchResult === "stale" || !isCurrentOpenWorkspaceRequest()) {
          return;
        }

        if (identityDescriptor) {
          const isNewIdentityForActiveLegacyWorkspace =
            !previousWorkspaceIdentity && workspaceRootKeysEqual(previousRootPath, path);
          if (isNewIdentityForActiveLegacyWorkspace) {
            const capturedLegacyState = adoptLegacyCachedWorkspaceState(identityDescriptor, [
              resolveCachedWorkspaceState(previousRootPath),
              resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
            ]);
            if (capturedLegacyState) {
              forgetCachedWorkspaceState(path, identityDescriptor);
              workspaceStateCacheRef.current[
                workspaceIdentityStateCacheKey(
                  identityDescriptor.workspaceId,
                  identityDescriptor.canonicalRoot,
                )
              ] = capturedLegacyState;
            }
          }

          cachedWorkspaceState = coalesceWorkspaceStateCache(identityDescriptor, path);
        }
      }

      adoptLegacyWorkspaceCache();
      const pendingWorkspaceSettingsSave =
        previousWorkspaceSettingsSaveCoordinator.waitForIdle(canonicalKey);
      if (pendingWorkspaceSettingsSave) {
        await pendingWorkspaceSettingsSave;
      }
      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      const workspaceSettingsRevisionAtLoad = workspaceSettingsByRoot.revision(canonicalKey);
      let workspaceSettingsLoad =
        workspaceSettingsLoadByRootRef.current.get(workspaceSettingsLoadKey);
      try {
        const trackWorkspaceSettingsLoad = (
          start: () => Promise<WorkspaceSettings>,
          legacyRawKeys: readonly string[],
        ) =>
          workspaceSettingsLoadByRootRef.current.track(
            workspaceSettingsLoadKey,
            legacyRawKeys,
            start,
          );
        workspaceSettingsLoad ??= trackWorkspaceSettingsLoad(
          () => settingsGateway.loadWorkspaceSettings(requestedSettingsIdentity),
          requestedLegacyRawKeys,
        );
        if (
          !requestedLegacyRawKeys.every((legacyRawKey) =>
            workspaceSettingsLoad?.legacyRawKeys.includes(legacyRawKey),
          )
        ) {
          const previousLoad = workspaceSettingsLoad;
          const continueWithWinningAlias = () =>
            isCurrentOpenWorkspaceRequest()
              ? settingsGateway.loadWorkspaceSettings(requestedSettingsIdentity)
              : defaultWorkspaceSettings();
          workspaceSettingsLoad = trackWorkspaceSettingsLoad(
            () => previousLoad.promise.then(continueWithWinningAlias, continueWithWinningAlias),
            [...new Set([...previousLoad.legacyRawKeys, ...requestedLegacyRawKeys])],
          );
        }
      } catch (error) {
        reportError("Settings", error);
        if (error instanceof PendingWorkspaceSettingsLoadCapacityError) {
          return;
        }
      }
      const identityAliasPaths = identityDescriptor
        ? workspaceIdentityAliasPaths(
            workspaceIdentityByRootRef.current,
            identityDescriptor,
            cachedWorkspaceState?.workspaceIdentityDescriptor ?? null,
          )
        : [];

      workspaceSessionRestoredRef.current = false;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
      resetActiveEditorPosition();
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      clearPhpLocalDiagnostics();
      let workspaceSettings = defaultWorkspaceSettings();

      try {
        if (workspaceSettingsLoad) {
          workspaceSettings = await workspaceSettingsLoad.promise;
        }
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
        if (error instanceof PendingWorkspaceSettingsLoadCapacityError) {
          return;
        }
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      const capturedWorkspaceSettings = workspaceSettingsByRoot.captureIfRevision(
        canonicalKey,
        workspaceSettingsRevisionAtLoad,
        workspaceSettings,
      );
      if (capturedWorkspaceSettings) {
        workspaceSettingsSaveCoordinator.captureCommitted(canonicalKey, workspaceSettings);
      }
      if (!capturedWorkspaceSettings) {
        workspaceSettings = workspaceSettingsByRoot.resolve(canonicalKey) ?? workspaceSettings;
      }

      const runtimePolicy = appSettingsRef.current.runtimePolicy;
      if (runtimePolicy !== "keepAlive") {
        const disposedRuntimeOwnerClaims = backgroundRuntimeOwnersForPolicy(
          runtimePolicy,
          path,
          previousRootPath,
          appSettingsRef.current.workspaceTabs,
          workspaceRuntimeOwnerByTabRef.current,
        ).map((owner) => ({
          generation: workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey),
          owner,
        }));
        try {
          await stopBackgroundProjectRuntimes(runtimePolicy, path, previousRootPath);
          if (!isCurrentOpenWorkspaceRequest()) {
            return;
          }
          for (const disposedRuntimeOwnerClaim of disposedRuntimeOwnerClaims) {
            const disposedRuntimeOwner = disposedRuntimeOwnerClaim.owner;
            if (disposedRuntimeOwnerClaim.generation === undefined) {
              continue;
            }
            if (identityDescriptor?.workspaceId === disposedRuntimeOwner.ownerKey) {
              continue;
            }
            retireWorkspaceRuntimeOwnerClaim(
              disposedRuntimeOwner.ownerKey,
              disposedRuntimeOwnerClaim.generation,
            );
          }
        } catch (error) {
          if (!isCurrentOpenWorkspaceRequest()) {
            return;
          }

          reportError("Settings", error);
        }
      }

      documentSessionAuthorityLifecycle.deactivate();
      if (identityDescriptor) {
        const previousIdentity =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        adoptIdentity?.();
        if (cachedWorkspaceState) {
          cachedWorkspaceState.workspaceIdentityDescriptor = identityDescriptor;
        }
        if (previousIdentity && previousIdentity.workspaceId !== identityDescriptor.workspaceId) {
          retireWorkspaceRuntimeOwnerClaim(
            previousIdentity.workspaceId,
            workspaceRuntimeOwnerClaimsRef.current.generationFor(previousIdentity.workspaceId),
          );
          delete workspaceRuntimeRootByTabRef.current[previousIdentity.selectedPath];
          delete workspaceRuntimeRootByTabRef.current[previousIdentity.canonicalRoot];
          delete workspaceRuntimeOwnerByTabRef.current[previousIdentity.selectedPath];
          delete workspaceRuntimeOwnerByTabRef.current[previousIdentity.canonicalRoot];
          removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, previousIdentity);
          void releaseOwnedWorkspaceIdentity(previousIdentity.workspaceId).catch((error) =>
            reportError("Workspace", error),
          );
        }
        removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, identityDescriptor);
        for (const aliasPath of identityAliasPaths) {
          delete workspaceRuntimeRootByTabRef.current[aliasPath];
          delete workspaceRuntimeOwnerByTabRef.current[aliasPath];
        }
      }

      primeCachedDirectoryEntries(cachedWorkspaceState, replacingOwnerAtSameRoot);
      phpFrameworkNavigationGenerationRef.current += 1;
      setWorkspaceRoot(path);
      setPackageScriptsByRoot((current) => ({
        ...current,
        [path]: {
          composerScripts: [],
          hasArtisan: false,
        },
      }));
      setWorkspaceIdentityDescriptor(identityDescriptor);
      workspaceIdentityDescriptorRef.current = identityDescriptor;
      const admittedRuntimeOwner = workspaceRuntimeOwnerFor(path, identityDescriptor);
      const explicitRuntimeOwner = identityDescriptor ? admittedRuntimeOwner : undefined;
      const admittedRuntimeGeneration = identityDescriptor
        ? (ownedWorkspaceIdentityGenerationByIdRef.current[identityDescriptor.workspaceId] ?? null)
        : null;
      workspaceRuntimeOwnerRef.current = admittedRuntimeOwner;
      const isCurrentOpenWorkspaceOwnerRequest = () => {
        if (!isCurrentOpenWorkspaceRequest() || admittedRuntimeGeneration === null) return false;

        return (
          workspaceRuntimeOwnerByTabRef.current[path] === admittedRuntimeOwner &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(admittedRuntimeOwner.ownerKey) ===
            admittedRuntimeGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)
        );
      };
      if (identityDescriptor) {
        workspaceRuntimeOwnerClaimsRef.current.register(
          admittedRuntimeOwner,
          identityAliasPaths,
          admittedRuntimeGeneration,
        );
        workspaceIdentityByRootRef.current[path] = identityDescriptor;
        workspaceIdentityByRootRef.current[identityDescriptor.canonicalRoot] = identityDescriptor;
        workspaceRuntimeRootByTabRef.current[path] = path;
        workspaceRuntimeRootByTabRef.current[identityDescriptor.canonicalRoot] = path;
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
        workspaceRuntimeOwnerByTabRef.current[identityDescriptor.canonicalRoot] =
          admittedRuntimeOwner;
      }
      if (!identityDescriptor) {
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
      }
      currentWorkspaceRootRef.current = path;
      currentEditorSessionOwnerKeyRef.current = nextOwnerKey;
      const openSmartModeIntent = beginWorkbenchSmartModeIntent({
        currentWorkspaceRootRef,
        identity: identityDescriptor,
        intentGenerationRef: smartModeRequestGenerationRef,
        intentStateRef: smartModeRequestIntentRef,
        mode: workspaceSettings.intelligenceMode,
        owner: admittedRuntimeOwner,
        rootPath: path,
        workspaceRuntimeOwnerClaimsRef,
        workspaceRuntimeOwnerRef,
      });
      const isCurrentOpenWorkspaceSmartModeRequest = () =>
        isCurrentOpenWorkspaceOwnerRequest() && Boolean(openSmartModeIntent?.isCurrent());
      const activateCurrentDocumentSessionAuthority = () =>
        documentSessionAuthorityLifecycle.activate({
          descriptor: identityDescriptor,
          documents: documentsRef.current,
          isCurrent: () =>
            workbenchMountedRef.current &&
            workspaceRootKeysEqual(currentWorkspaceRootRef.current, path) &&
            currentEditorSessionOwnerKeyRef.current === nextOwnerKey &&
            Boolean(
              identityDescriptor && workspaceIdentityByRootRef.current[path] === identityDescriptor,
            ),
          ownerKey: identityDescriptor ? nextOwnerKey : null,
          resolveOwnership: resolveDocumentSaveOwnership,
          rootPath: path,
        });
      lastLanguageServerCrashRef.current = null;
      restoreLanguageServerDiagnosticsForRoot(path, explicitRuntimeOwner);
      restoreJavaScriptTypeScriptDiagnosticsForRoot(path, explicitRuntimeOwner);

      if (cachedWorkspaceState) {
        const cachedWorkspaceSnapshot = cachedWorkspaceState;
        adoptCachedDirectoryProjection(path, cachedWorkspaceSnapshot);
        restoreCachedWorkspaceState(path, cachedWorkspaceSnapshot);
        activateCurrentDocumentSessionAuthority();
      } else {
        resetDirectoryExplorerLifecycle();
        setEntriesByDirectory({});
        setExpandedDirectories(new Set([path]));
        setManuallyCollapsedDirectories(new Set());
        resetEditorSurfaceState();
        setRecentFiles([]);
        setRecentLocations([]);
        setBookmarks([]);
        setGitBlameEnabledPaths(new Set());
        resetHistory();
        setSidebarView("files");
        setBottomPanelView("problems");
        setBottomPanelVisible(false);
        clearIndexWorkspaceState();
      }

      // The TODO panel is a transient, workspace-scoped overlay (not part of the
      // cached per-tab state). Always reset it on a switch so one project's TODOs
      // can never appear inside another project's tab.
      resetWorkspaceTodosRef.current();
      // The recent files switcher is a transient overlay too; close it on a
      // switch so it never shows another tab's MRU list mid-transition.
      setRecentFilesSwitcherOpen(false);
      // The recent locations panel is a transient overlay too; close it on a
      // switch so it never shows another tab's positions mid-transition. The
      // location list itself is cached/restored per tab above.
      setRecentLocationsPanelOpen(false);
      // The bookmarks panel is a transient overlay; close it on a switch so it
      // never shows another tab's bookmarks mid-transition. The bookmark list
      // itself is cached/restored per tab above.
      closeBookmarksPanelRef.current();

      setEditorRevealTarget(null);
      setLoadingDirectories(new Set());
      applyWorkspaceSettings(workspaceSettings);
      setIntelligenceMode(workspaceSettings.intelligenceMode);
      setWorkspaceDescriptor(null);
      setPhpTools(null);
      setWorkspaceTrust(null);
      setLanguageServerPlan(null);
      setJavaScriptTypeScriptLanguageServerPlan(null);
      const cachedPhpStatus = cachedLanguageServerRuntimeStatusForOwner(
        languageServerRuntimeStatusByRootRef.current,
        admittedRuntimeOwner,
      );
      if (cachedPhpStatus) {
        setLanguageServerRuntimeStatus(cachedPhpStatus);
        setLanguageServerRuntimeStatusRoot(path);
      } else {
        setLanguageServerRuntimeStatus(null);
        setLanguageServerRuntimeStatusRoot(null);
      }
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      resetGitStatusSurface(path);
      resetGitDiffWorkspaceState();
      setPhpFileOutlinesByPath({});
      setPhpInheritedFileOutlinesByPath({});
      resetJavaScriptTypeScriptFileStructure();
      setExpandedPhpFilePaths(new Set());
      setLoadingPhpFileOutlinePaths(new Set());
      setLoadingInheritedPhpFileOutlinePaths(new Set());
      setPhpFileOutlineExpandedNodeIds(new Set());
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenLoading(false);
      setClassOpenResults([]);
      setWorkspaceSymbolsOpen(false);
      setWorkspaceSymbolsQuery("");
      setWorkspaceSymbolsLoading(false);
      setWorkspaceSymbolsResults([]);
      resetSearchEverywhere();
      setQuickOpenOpen(false);
      resetTextSearchState();
      setFileStructureScope("current");
      setImplementationChooser(null);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setMessage(null);
      setNotices([]);
      lastPhpFileOutlineRefreshKeyRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      resetPhpFrameworkCachesRef.current();
      setPhpIdeReadinessVersion(0);
      restoreIndexRoot(cachedWorkspaceState?.indexProgress.rootPath ?? null);
      autoStartedLanguageServerRootRef.current = null;
      phpLanguageServerAutostartAttemptsByRootRef.current = {};
      installingManagedPhpactorRootRef.current = null;
      setInstallingManagedPhpactor(false);
      installingManagedTypeScriptLanguageServerRootRef.current = null;
      flushSync(() => {
        setInstallingManagedTypeScriptLanguageServer(false);
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
      });

      try {
        const nextWorkspaceTabs = workspaceTabsWithPath(
          appSettingsRef.current.workspaceTabs,
          path,
          identityAliasPaths,
        );
        const recentWorkspaceCandidates = (
          appSettingsRef.current.recentWorkspacePaths ?? []
        ).filter(
          (recentPath) =>
            !identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, recentPath)),
        );
        const recentWorkspacePaths = pushRecentWorkspacePath(recentWorkspaceCandidates, path);
        await persistAppSettings({
          ...appSettingsRef.current,
          recentWorkspacePath: recentWorkspacePaths[0] ?? null,
          recentWorkspacePaths,
          workspaceTabs: nextWorkspaceTabs,
        });
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      let resolvedIntelligenceMode = workspaceSettings.intelligenceMode;

      try {
        if (openSmartModeIntent) {
          const smartMode = await openSmartModeIntent.setMode(smartModeGateway);

          if (isCurrentOpenWorkspaceSmartModeRequest() && openSmartModeIntent.claimEffects()) {
            resolvedIntelligenceMode = smartMode.mode;
            intelligenceModeRef.current = smartMode.mode;
            setIntelligenceMode(smartMode.mode);
          }
          if (isCurrentOpenWorkspaceOwnerRequest() && !isCurrentOpenWorkspaceSmartModeRequest()) {
            resolvedIntelligenceMode = intelligenceModeRef.current;
          }
        }
      } catch (error) {
        if (!isCurrentOpenWorkspaceOwnerRequest()) {
          return;
        }

        if (isCurrentOpenWorkspaceSmartModeRequest()) {
          reportError("IDE Mode", error);
        }
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      // Directory load, workspace trust, workspace detection and session
      // restore are all independent of one another, so they run concurrently.
      // Each sub-task keeps its own try/catch plus a post-await isolation guard
      // against the admitted owner and open request so that replacing a
      // workspace mid-flight, including at the same selected path, never lets
      // stale results mutate the active workspace state.
      const loadDirectoryTask = async () => {
        const entries = await loadCompleteWorkspaceDirectoryEntries(() =>
          loadDirectory(path, {
            isMutationOwnerCurrent: isCurrentOpenWorkspaceOwnerRequest,
            requireActiveRoot: true,
          }),
        );
        if (!entries) return;

        if (!isCurrentOpenWorkspaceOwnerRequest()) {
          return;
        }

        if (cachedWorkspaceState) {
          refreshCachedExpandedDirectories({
            isMutationOwnerCurrent: isCurrentOpenWorkspaceOwnerRequest,
            projection: cachedWorkspaceState,
            rootPath: path,
          });
        }

        await loadPackageScripts(path, entries ?? [], isCurrentOpenWorkspaceOwnerRequest);
      };

      const loadTrustTask = async () => {
        await loadWorkspaceTrustForOwner({
          gateway: workspaceTrustGateway,
          isCurrent: isCurrentOpenWorkspaceOwnerRequest,
          ownerId: admittedRuntimeOwner.ownerKey,
          publish: setWorkspaceTrust,
          reportError: (error) => reportErrorForActiveWorkspaceRoot(path, "Workspace Trust", error),
          revisionByOwnerRef: workspaceTrustRevisionByOwnerRef,
          rootPath: path,
        });
      };

      // Warmup: the phpactor handshake (composer/autoload scan) is the
      // dominant time-to-ready cost and is phpactor-internal, so the only safe
      // win is to start it sooner. The PHP probe (detectPhpTools -> plan ->
      // autostart) only needs the workspace descriptor to know the project is
      // PHP, so as soon as detection confirms a PHP project in IDE (full smart)
      // mode we fire the probe in parallel with the directory load and session
      // restore instead of serializing it behind them. The handshake then warms
      // up in the background while the user navigates. This is gated to IDE mode
      // (preserving the basic/light-mode defer) and is owner-isolated: the probe
      // captures the admitted runtime owner and re-checks it after its own
      // awaits, and detection drops stale requests before triggering it.
      let warmedUpPhpProbe = false;
      const detectWorkspaceTask = async (): Promise<WorkspaceDescriptor | null> => {
        try {
          const detected = await workspaceDetection.detectWorkspace(path);

          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            // Stale: the active workspace changed while detection was in
            // flight. Return null (never the stale descriptor) so the PHP
            // setup branch only ever sees the descriptor of the still-active
            // open request.
            return null;
          }

          setWorkspaceDescriptor(detected);
          hasPhpWorkspaceByOwnerRef.current[admittedRuntimeOwner.ownerKey] = !!detected?.php;

          if (detected?.php && shouldStartLanguageServer(resolvedIntelligenceMode)) {
            warmedUpPhpProbe = true;
            void runPhpWorkspaceProbe(path, admittedRuntimeOwner);
          }

          return detected;
        } catch (error) {
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return null;
          }

          reportErrorForActiveWorkspaceRoot(path, "Workspace Detection", error);
          return null;
        }
      };

      const restoreSessionTask = async () => {
        if (cachedWorkspaceState) {
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return;
          }

          workspaceSessionRestoredRef.current = true;
          return;
        }

        if (
          !(await restorePersistedNavigationSession(
            path,
            () => currentWorkspaceRootRef.current,
            workspaceSettings.session,
            replacingOwnerAtSameRoot,
            restoreWorkspaceSession,
            isCurrentOpenWorkspaceOwnerRequest,
          ))
        ) {
          return;
        }

        activateCurrentDocumentSessionAuthority();
        workspaceSessionRestoredRef.current = true;
      };

      // Discover nested git repositories from the freshly loaded workspace
      // settings, sharing the isolated, re-entrancy-guarded discovery used by
      // the settings-save flow so both resolve mappings identically.
      const discoverGitRepositoriesTask = () => runGitRepositoryDiscovery(path, workspaceSettings);

      // Fire-and-forget plans/scans that already isolate themselves per root.
      void refreshJavaScriptTypeScriptLanguageServerPlan(path, undefined, explicitRuntimeOwner);

      if (
        shouldIndexWorkspace(resolvedIntelligenceMode) &&
        shouldRunInitialIndexScan(cachedWorkspaceState)
      ) {
        void startInitialIndexScan(path, isCurrentOpenWorkspaceOwnerRequest);
      }

      const [, , descriptor] = await Promise.all([
        loadDirectoryTask(),
        loadTrustTask(),
        detectWorkspaceTask(),
        restoreSessionTask(),
        discoverGitRepositoriesTask(),
      ]);

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
        return;
      }

      if (!descriptor?.php) {
        setLanguageServerPlan(null);
        setNotices((current) => replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []));
        return;
      }

      // The PHP language server only runs in IDE (full smart) mode, so in
      // basic/light mode the open-time PHP probe (detectPhpTools +
      // planPhpLanguageServer) is pure overhead. Defer it: keep the plan and
      // setup notice cleared and replay the probe when the user enables IDE
      // mode (setSmartMode) or, eventually, lazily on demand.
      if (!shouldStartLanguageServer(resolvedIntelligenceMode)) {
        setLanguageServerPlan(null);
        setNotices((current) => replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []));
        return;
      }

      // The probe is fired eagerly during detection (warmup) for IDE-mode PHP
      // projects, so once it has warmed up there is nothing left to do here.
      if (warmedUpPhpProbe) {
        return;
      }

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
        return;
      }

      await runPhpWorkspaceProbe(path, admittedRuntimeOwner);
    },
    [
      applyWorkspaceSettings,
      adoptCachedDirectoryProjection,
      cacheCurrentWorkspaceState,
      canonicalDocumentSaveRoot,
      closeBookmarksPanelRef,
      forgetCachedWorkspaceState,
      loadDirectory,
      loadPackageScripts,
      languageServerRuntimeStatusByRootRef,
      persistAppSettings,
      persistCurrentWorkspaceSession,
      primeCachedDirectoryEntries,
      refreshCachedExpandedDirectories,
      runPhpWorkspaceProbe,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      releaseOwnedWorkspaceIdentity,
      retireWorkspaceRuntimeOwnerClaim,
      restoreLanguageServerDiagnosticsForRoot,
      coalesceWorkspaceStateCache,
      resolveCachedWorkspaceState,
      restoreCachedWorkspaceState,
      restorePersistedNavigationSession,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreWorkspaceSession,
      runGitRepositoryDiscovery,
      clearIndexWorkspaceState,
      resetActiveEditorPosition,
      resetDirectoryExplorerLifecycle,
      resetEditorSurfaceState,
      resetFilePrefetchState,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetHistory,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere,
      resetTextSearchState,
      resetWorkspaceTodosRef,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      runWithIssuedWriteDrainDelegate,
      restoreIndexRoot,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      clearPhpLocalDiagnostics,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      documentsRef,
      resolveDocumentSaveOwnership,
      settingsGateway,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      workspaceDetection,
      workspaceSettingsByRoot,
      workspaceSettingsSaveCoordinator,
      workspaceTrustGateway,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      setCallHierarchyView,
      setClassOpenLoading,
      setClassOpenOpen,
      setClassOpenQuery,
      setClassOpenResults,
      setEditorRevealTarget,
      setExpandedDirectories,
      setImplementationChooser,
      setNotices,
      setQuickOpenOpen,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setReferencesView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults,
      workspaceStateCacheRef,
    ],
  );

  const {
    activateWorkspaceTab,
    beginWorkspaceClose,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
  } = useWorkspaceOpenRequestLifecycle({
    completeDeferredIdentityCleanup: flushDeferredWorkspaceIdentityCleanup,
    currentWorkspaceRootRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    pendingWorkspaceIdentityRequestTokensRef,
    performOpenWorkspacePath,
    reportError,
    resolveCachedWorkspaceState,
    withManagedWorkspaceIdentityLease,
    workbenchMountedRef,
    workspaceCloseGenerationByRootRef,
    workspaceCloseOwnershipByKeyRef,
    workspaceCloseOwnershipGenerationRef,
    workspaceIdentityByRootRef,
    workspaceIdentityGateway: workspaceGateways.identity,
    workspaceRoot,
  });

  useEffect(() => {
    workbenchMountedRef.current = true;
    const pendingWorkspaceIdentityRequestTokens = pendingWorkspaceIdentityRequestTokensRef.current;
    const ownedWorkspaceIdentityIds = ownedWorkspaceIdentityIdsRef.current;
    const workspaceRuntimeOwnerClaims = workspaceRuntimeOwnerClaimsRef.current;
    const externallyRemovedDocumentRootByPath = externallyRemovedDocumentRootByPathRef.current;

    return () => {
      documentSessionAuthorityLifecycle.deactivate();
      workbenchMountedRef.current = false;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openWorkspaceRequestInFlightTokenRef.current = null;
      openFileRequestTokenRef.current += 1;
      pendingWorkspaceIdentityRequestTokens.retire();
      const workspaceIds = ownedAndPendingWorkspaceIdentityIds(
        ownedWorkspaceIdentityIds,
        pendingWorkspaceIdentityAdmissionsRef.current,
      );
      pendingWorkspaceIdentityAdmissionsRef.current = {};
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      workspaceRuntimeOwnerClaims.clear();
      disposeWorkspaceFileChanges(workspaceFileChangeGateway, externallyRemovedDocumentRootByPath);
      for (const workspaceId of workspaceIds) {
        void releaseOwnedWorkspaceIdentity(workspaceId).catch(() => undefined);
      }
    };
  }, [
    documentSessionAuthorityLifecycle,
    externallyRemovedDocumentRootByPathRef,
    releaseOwnedWorkspaceIdentity,
    workspaceFileChangeGateway,
  ]);

  const refreshDirectory = useCallback(
    async (path: string) => {
      await loadDirectory(path);
    },
    [loadDirectory],
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    await refreshDirectory(workspaceRoot);
  }, [refreshDirectory, workspaceRoot]);

  const {
    activateDocument,
    pinDocument,
    openFile,
    previewFile,
    openPinnedFile,
    openReadOnlyDocument,
    prefetchFile,
    cancelFilePrefetch,
  } = useWorkbenchDocumentTabs({
    workspaceRoot,
    documentTabSession,
    appSettingsRef,
    currentWorkspaceRootRef,
    resolveCurrentWorkspaceRuntimeOwner,
    openFileRequestTokenRef,
    openingFileFlagOwnerTokenRef,
    emptyDocumentRefreshTimeoutsRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    setIsOpeningFile,
    workspaceFiles,
    forgetExternallyRemovedDocumentPath,
    clearGitDiffPreviewState,
    isGitDiffDocumentPath,
    loadGitDiffDocument,
    recordCurrentNavigationLocation,
    recordRecentFile,
    refreshLocalPhpDiagnosticsForContent,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  });
  openFileRef.current = openFile;

  const revealPathInTree = useCallback(
    (path: string, respectManualCollapses: boolean) => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        !isSessionPathInWorkspace(requestedRoot, path)
      ) {
        return;
      }

      const directories = parentDirectoriesInWorkspace(requestedRoot, path);

      if (directories.length === 0) {
        return;
      }

      setExpandedDirectories((current) => {
        const next = new Set(current);
        let changed = false;

        for (const directory of directories) {
          if (
            respectManualCollapses &&
            isBlockedByManuallyCollapsedDirectory(directory, manuallyCollapsedDirectories)
          ) {
            continue;
          }

          if (next.has(directory)) {
            continue;
          }

          next.add(directory);
          changed = true;
        }

        return changed ? next : current;
      });

      for (const directory of directories) {
        if (
          (respectManualCollapses &&
            isBlockedByManuallyCollapsedDirectory(directory, manuallyCollapsedDirectories)) ||
          (entriesByDirectory[directory] && !cachedDirectoryNeedsRefresh(directory)) ||
          loadingDirectories.has(directory)
        ) {
          continue;
        }

        void loadDirectory(directory, { clearMessage: false });
      }
    },
    [
      entriesByDirectory,
      cachedDirectoryNeedsRefresh,
      loadDirectory,
      loadingDirectories,
      setExpandedDirectories,
      manuallyCollapsedDirectories,
      workspaceRoot,
    ],
  );

  const revealDirectoryInTree = useCallback(
    (path: string) => revealPathInTree(path, false),
    [revealPathInTree],
  );

  useEffect(() => {
    if (!activePath || !workspaceSettings.revealActiveFileInTree) {
      return;
    }

    revealPathInTree(activePath, true);
  }, [activePath, revealPathInTree, workspaceSettings.revealActiveFileInTree]);

  const {
    canRevertGitChange,
    closeGitDiffPreview,
    gitAmendEnabled,
    gitCommitMessage,
    gitCommitMessageHistory,
    includedGitChangePaths,
    gitOperationLoading,
    setGitAmendEnabled,
    setGitCommitMessage,
    toggleGitChangeIncluded,
    stageGitChanges,
    unstageGitChanges,
    loadGitFileHunks,
    stageGitHunk,
    unstageGitHunk,
    revertGitHunk,
    revertGitChanges,
    amendGitChanges,
    commitGitChanges,
    commitAndPushGitChanges,
  } = useWorkbenchGitChangesCoordinator({
    connectDiffPreviewReconciliation,
    currentWorkspaceRootRef,
    diffPreview: {
      documentTabSession,
      cancelGitDiffDocument,
      getGitDiffDocument,
      getSelectedGitDiffDocument,
      gitChangeForDiffDocumentPath,
      loadGitDiffDocument,
      reloadGitDiffDocument,
      reconcileGitDiffDocument,
    },
    documentsRef,
    gitWorkspace: {
      gitGateway,
      gitOperationCurrency,
      currentWorkspaceRootRef,
      workspaceRoot,
      gitStatus,
      applyGitOperationStatuses,
      reportError,
      setMessage,
      prompter,
      gitRepositoryMappings,
      gitRepositoryStatuses,
    },
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    workspaceSettings,
    workspaceSettingsRef,
  });

  // PHP project tree + PHP file structure (outline) intelligence lives in a
  // sibling strangler hook (see usePhpOutline). The React state slices stay here
  // (reset by the workspace-lifecycle clear-blocks above, which run before
  // `openFile` is defined) and are wired in as dependencies; the callbacks are
  // extracted VERBATIM and consumed 1:1 below. The two refresh EFFECTS stay in
  // the controller so their registration order and controller-owned triggers
  // (`sidebarView` / `indexProgress`) are preserved.
  const {
    refreshPhpTree,
    togglePhpTreeNode,
    openPhpTreeNode,
    loadPhpFileOutline,
    loadInheritedPhpFileOutline,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    openPhpFileOutlineNode,
  } = usePhpOutline({
    largeSmartDocumentPolicy: workspaceSettings.largeFileMode,
    workspaceRoot,
    workspaceDescriptor,
    currentWorkspaceRootRef,
    documents,
    workspaceFiles,
    phpTreeGateway,
    phpFileOutlineGateway,
    reportError,
    setMessage,
    openFile,
    setEditorRevealTarget,
    setPhpTree,
    setPhpTreeExpandedNodeIds,
    setPhpTreeLoading,
    phpFileOutlinesByPath,
    setPhpFileOutlinesByPath,
    setPhpInheritedFileOutlinesByPath,
    expandedPhpFilePaths,
    setExpandedPhpFilePaths,
    loadingPhpFileOutlinePaths,
    setLoadingPhpFileOutlinePaths,
    setLoadingInheritedPhpFileOutlinePaths,
    setPhpFileOutlineExpandedNodeIds,
  });

  const setFileStructureScopeMode = useCallback(
    (scope: PhpFileStructureScope) => {
      setFileStructureScope(scope);

      if (
        scope === "inherited" &&
        activeDocument &&
        !loadingInheritedPhpFileOutlinePaths.has(activeDocument.path)
      ) {
        void loadInheritedPhpFileOutline(activeDocument.path);
      }
    },
    [activeDocument, loadInheritedPhpFileOutline, loadingInheritedPhpFileOutlinePaths],
  );

  const openFileStructureWithInitialQuery = useCallback(
    (initialQuery: string) => {
      const document = activeDocumentRef.current;
      if (!document) {
        setMessage("Open a PHP, JavaScript, or TypeScript file to show structure.");
        return;
      }

      setFileStructureInitialQuery(initialQuery);
      setPaletteOpen(false);
      setQuickOpenOpen(false);
      setClassOpenOpen(false);
      setWorkspaceSymbolsOpen(false);
      setTextSearchOpen(false);
      setSettingsOpen(false);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);

      if (openJavaScriptTypeScriptFileStructure(document)) {
        return;
      }

      if (!isLanguageServerDocument(document)) {
        setMessage("File structure is available for PHP, JavaScript, and TypeScript files.");
        return;
      }

      const nextScope =
        fileStructureOpen && fileStructureScope === "current" ? "inherited" : "current";
      setFileStructureScopeMode(nextScope);
      setFileStructureOpen(true);

      if (!loadingPhpFileOutlinePaths.has(document.path)) {
        void loadPhpFileOutline(document.path);
      }
    },
    [
      fileStructureOpen,
      fileStructureScope,
      loadPhpFileOutline,
      loadingPhpFileOutlinePaths,
      openJavaScriptTypeScriptFileStructure,
      setCallHierarchyView,
      setClassOpenOpen,
      activeDocumentRef,
      setFileStructureInitialQuery,
      setPaletteOpen,
      setTextSearchOpen,
      setFileStructureScopeMode,
      setQuickOpenOpen,
      setReferencesView,
      setTypeHierarchyView,
      setWorkspaceSymbolsOpen,
    ],
  );
  const openFileStructure = useCallback(
    () => openFileStructureWithInitialQuery(""),
    [openFileStructureWithInitialQuery],
  );

  const {
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    applyPhpLanguageServerWorkspaceEdit,
    applyJavaScriptTypeScriptRenameEdits,
    applyJavaScriptTypeScriptCreateEdits,
    notifyJavaScriptTypeScriptFileCreated,
    applyJavaScriptTypeScriptDeleteEdits,
    notifyJavaScriptTypeScriptFileDeleted,
    applyPhpRenameEdits,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
  } = useWorkspaceEditFileOperations({
    workspaceRoot,
    hasPhpWorkspace: !!workspaceDescriptor?.php,
    currentWorkspaceRootRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    documentVersionsByUriRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    workspaceFiles,
    reportChangedDocuments,
    reconcileDocumentSessionTopology,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    setMessage,
    refreshDirectory,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    isSessionPathInWorkspace,
    isRunningLanguageServerForWorkspace,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    reportError,
  });

  const phpChangeSignaturePorts = useMemo(
    () => ({
      applyWorkspaceEdit: (
        edit: Parameters<typeof applyPhpLanguageServerWorkspaceEdit>[0],
        rootPath: string,
        openPaths: string[],
        expectedClosedFileHashes: Readonly<Record<string, string>>,
      ) =>
        applyPhpLanguageServerWorkspaceEdit(edit, {
          expectedClosedFileHashes,
          openPaths,
          rootPath,
        }),
      currentRootPath: () => currentWorkspaceRootRef.current,
      flushDocument: flushPendingDocumentChange,
      getOpenDocument: (path: string) => {
        const document = documentsRef.current[path];
        const rootPath = currentWorkspaceRootRef.current;
        if (!document || !rootPath) return null;
        return {
          content: document.content,
          path: document.path,
          version: getPhpDocumentSyncVersion(rootPath, path),
        };
      },
      isWorkspaceTrusted: () => workspaceTrusted,
      isReferenceIndexComplete: (rootPath: string) =>
        indexProgress.status === "completed" &&
        indexProgress.erroredEntries === 0 &&
        workspaceRootKeysEqual(indexProgress.rootPath, rootPath),
      languageServer: languageServerFeaturesGateway,
      notifyClosedDocumentsChanged: async (rootPath: string, paths: string[]) => {
        if (paths.length === 0) return;
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
          !workspaceTrusted
        ) {
          return;
        }
        await languageServerFeaturesGateway.didChangeWatchedFiles(
          rootPath,
          paths.map((path) => ({ changeType: "changed" as const, path })),
        );
      },
      readClosedDocument: async (path: string) => {
        if (!workspaceFiles.readTextFileSnapshot) return null;
        const snapshot = await workspaceFiles.readTextFileSnapshot(path);
        if (!snapshot.revision) return null;
        return {
          content: snapshot.content,
          contentHash: snapshot.revision.contentHash,
          path,
          version: null,
        };
      },
      searchReferencePaths: async (rootPath: string, callableName: string) => {
        const limit = 20_001;
        const results = await textSearch.searchText(rootPath, callableName, limit, {
          caseSensitive: false,
          fileMask: "*.php",
          isRegex: false,
          preserveCase: false,
          wholeWord: true,
        });
        return {
          complete: results.length < limit,
          paths: [...new Set(results.map((result) => result.path))],
        };
      },
      subscribeChangedDocuments,
    }),
    [
      applyPhpLanguageServerWorkspaceEdit,
      currentWorkspaceRootRef,
      documentsRef,
      flushPendingDocumentChange,
      getPhpDocumentSyncVersion,
      languageServerFeaturesGateway,
      indexProgress.erroredEntries,
      indexProgress.rootPath,
      indexProgress.status,
      subscribeChangedDocuments,
      textSearch,
      workspaceFiles,
      workspaceTrusted,
    ],
  );
  const phpChangeSignature = usePhpChangeSignatureWorkflow(phpChangeSignaturePorts);

  const {
    formattedContentForSave,
    formattedContentForOwnerSave,
    optimizedImportsContentForSave,
    optimizedImportsContentForOwnerSave,
    organizedImportsContentForSave,
    organizedImportsContentForOwnerSave,
  } = useDocumentSavePipeline({
    workspaceSettingsRef,
    hasPhpWorkspace: !!workspaceDescriptor?.php,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    flushPendingDocumentChangeForRoot,
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
  });
  const ownerDocumentSavePipelineContext = useCallback(
    (owner: WorkspaceRuntimeOwner, settings: WorkspaceSettings) => {
      const activeRoot = currentWorkspaceRootRef.current;
      const synchronizedOwner = activeRoot ? resolveWorkspaceRuntimeOwner(activeRoot) : null;
      return ownerDocumentSavePipelineContextFor(
        owner,
        settings,
        hasPhpWorkspaceByOwnerRef.current,
        languageServerRuntimeStatusByRootRef.current,
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        synchronizedOwner,
      );
    },
    [
      currentWorkspaceRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      resolveWorkspaceRuntimeOwner,
    ],
  );

  const externalFileConflicts = useExternalFileConflictLifecycle({
    activeDocumentRef,
    activePath,
    currentWorkspaceRootRef,
    documentsRef,
    openPathsRef,
    resolveDocumentSaveOwnership,
    documentSelfWrites,
    reportChangedDocuments,
    setActivePath,
    setDocuments,
    setOpenPaths,
    workspaceFiles,
    workspaceRoot,
  });
  const handleExternalFileChange = externalFileConflicts.handleFileChange;
  const hasExternalFileConflict = externalFileConflicts.hasConflict;
  clearExternalFileConflictsForRootRef.current = externalFileConflicts.clearRoot;
  workspaceHasExternalFileConflictsRef.current = externalFileConflicts.hasConflictsForRoot;
  const dirtyCount = openDocuments.filter(
    (document) =>
      !document.readOnly &&
      documentNeedsAttention(
        isDirty(document),
        hasExternalFileConflict(workspaceRoot, document.path),
      ),
  ).length;

  const ownerDocumentSaveAdapters = useMemo(
    () =>
      new WorkbenchOwnerDocumentSaveAdapters({
        currentWorkspaceRootRef,
        documentsRef,
        editorGroupsRef,
        setDocuments,
        workspaceStateCacheRef,
        workspaceIdentityByRootRef,
        resolveDocumentSaveOwnership,
        resolveWorkspaceRuntimeOwner,
        hasExternalFileConflict,
      }),
    [
      documentsRef,
      editorGroupsRef,
      hasExternalFileConflict,
      resolveDocumentSaveOwnership,
      resolveWorkspaceRuntimeOwner,
      setDocuments,
      workspaceStateCacheRef,
    ],
  );
  const captureDirtyCloseTargets = useCallback(
    (rootPath: string | null) => ownerDocumentSaveAdapters.capture(rootPath),
    [ownerDocumentSaveAdapters],
  );
  const isWorkspaceRuntimeOwnerCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner) => ownerDocumentSaveAdapters.isOwnerCurrent(owner),
    [ownerDocumentSaveAdapters],
  );
  const ownerResolvingDocumentSaveService = useMemo(
    () =>
      new OwnerResolvingDocumentSaveService({
        repository: ownerDocumentSaveAdapters.repository,
        resolvePipeline: (owner, rootPath) => {
          const canonicalRoot = canonicalDocumentSaveRoot(rootPath);
          const settings =
            workspaceSettingsByRoot.resolve(canonicalRoot) ??
            (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
              ? workspaceSettingsRef.current
              : null);
          if (!settings || !ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
            return null;
          }

          return {
            workspaceFiles,
            settings,
            invalidatePrefetch: (requestedOwner, path) => {
              if (!ownerDocumentSaveAdapters.isOwnerCurrent(requestedOwner)) {
                return;
              }
              filePrefetchCacheRef.current.invalidate(path);
            },
            captureLocalHistorySnapshot: async (requestedOwner, requestedRoot, path, content) => {
              if (!ownerDocumentSaveAdapters.isOwnerCurrent(requestedOwner)) {
                return;
              }
              const relativePath = workspaceRelativePath(requestedRoot, path);
              if (!relativePath) {
                return;
              }
              try {
                await localHistoryGateway.recordSnapshot(requestedRoot, relativePath, content);
              } catch (error) {
                console.error("Local History snapshot failed", error);
              }
            },
            formattedContentForSave: (requestedOwner, requestedRoot, requestedSettings, document) =>
              formattedContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, requestedSettings),
                document,
                requestedRoot,
              ),
            optimizedImportsContentForSave: (
              requestedOwner,
              _requestedRoot,
              requestedSettings,
              document,
              content,
            ) =>
              optimizedImportsContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, requestedSettings),
                document,
                content,
              ),
            organizedImportsContentForSave: (
              requestedOwner,
              requestedRoot,
              requestedSettings,
              document,
              content,
            ) =>
              organizedImportsContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, requestedSettings),
                document,
                content,
                requestedRoot,
              ),
            resolveEditorConfigForFile: (requestedOwner, requestedRoot, path) =>
              resolveEditorConfigForFile(requestedRoot, path, requestedOwner),
            syncSavedDocument: async (requestedOwner, requestedRoot, document, shouldEmit) => {
              if (
                resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !== requestedOwner.ownerKey
              ) {
                return;
              }
              if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
                return;
              }
              await syncSavedDocumentForRoot(requestedRoot, document, shouldEmit);
            },
            syncSavedJavaScriptTypeScriptDocument: async (
              requestedOwner,
              requestedRoot,
              document,
              shouldEmit,
            ) => {
              if (
                resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !== requestedOwner.ownerKey
              ) {
                return;
              }
              if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
                return;
              }
              await syncSavedJavaScriptTypeScriptDocumentForRoot(
                requestedRoot,
                document,
                shouldEmit,
              );
            },
            hasExternalFileConflict: (requestedOwner, requestedRoot, path) =>
              resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey === requestedOwner.ownerKey &&
              hasExternalFileConflict(requestedRoot, path),
            beginDocumentSelfWrite: (requestedOwner, requestedRoot, path, content) => {
              if (
                resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !== requestedOwner.ownerKey
              ) {
                return null;
              }
              const ownership = resolveDocumentSaveOwnership(requestedRoot, path);
              return ownership ? documentSelfWrites.begin(ownership, content) : null;
            },
          };
        },
      }),
    [
      canonicalDocumentSaveRoot,
      documentSelfWrites,
      hasExternalFileConflict,
      formattedContentForOwnerSave,
      localHistoryGateway,
      optimizedImportsContentForOwnerSave,
      organizedImportsContentForOwnerSave,
      ownerDocumentSaveAdapters,
      ownerDocumentSavePipelineContext,
      resolveEditorConfigForFile,
      resolveDocumentSaveOwnership,
      resolveWorkspaceRuntimeOwner,
      syncSavedDocumentForRoot,
      syncSavedJavaScriptTypeScriptDocumentForRoot,
      workspaceFiles,
      workspaceSettingsByRoot,
    ],
  );
  const requestOwnerDocumentSaveRef = useRef<
    WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"]
  >(async () => ({ status: "stale" }));
  const requestOwnerDocumentSave = useCallback<
    WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"]
  >((ownership, operation) => requestOwnerDocumentSaveRef.current(ownership, operation), []);

  const stopProjectRuntimesForWorkspaceClose = useCallback(
    async (rootPath?: string, ownership?: WorkspaceCloseOwnership) => {
      if (ownership && !ownership.isCurrent()) {
        return "stale" as const;
      }

      if (!rootPath) {
        return stopProjectRuntimes(rootPath);
      }

      const identityDescriptor = workspaceIdentityByRootRef.current[rootPath];
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[rootPath] ??
        identityDescriptor?.selectedPath ??
        rootPath;
      const runtimeOwner =
        workspaceRuntimeOwnerByTabRef.current[rootPath] ??
        workspaceRuntimeOwnerFor(runtimeRootPath, identityDescriptor ?? null);
      const runtimeRootKey = runtimeOwner.ownerKey;
      const previousPhpStatus = languageServerRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousJavaScriptTypeScriptStatus =
        javaScriptTypeScriptRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousActivePhpStatus = languageServerRuntimeStatusRef.current;
      const previousActivePhpStatusRoot = languageServerRuntimeStatusRootRef.current;
      const previousActiveJavaScriptTypeScriptStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      const previousActiveJavaScriptTypeScriptStatusRoot =
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current;

      const stopResult = await stopProjectRuntimes(runtimeRootPath, runtimeOwner);
      if (!ownership || ownership.isCurrent()) {
        return stopResult;
      }

      restoreRuntimeStatusCacheEntry(
        languageServerRuntimeStatusByRootRef.current,
        runtimeRootKey,
        previousPhpStatus,
      );
      restoreRuntimeStatusCacheEntry(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        runtimeRootKey,
        previousJavaScriptTypeScriptStatus,
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return "stale" as const;
      }

      languageServerRuntimeStatusRef.current = previousActivePhpStatus;
      languageServerRuntimeStatusRootRef.current = previousActivePhpStatusRoot;
      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
        previousActiveJavaScriptTypeScriptStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        previousActiveJavaScriptTypeScriptStatusRoot;
      setLanguageServerRuntimeStatus(previousActivePhpStatus);
      setLanguageServerRuntimeStatusRoot(previousActivePhpStatusRoot);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(previousActiveJavaScriptTypeScriptStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
        previousActiveJavaScriptTypeScriptStatusRoot,
      );
      return "stale" as const;
    },
    [
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      stopProjectRuntimes,
    ],
  );

  const forgetLanguageServerRuntimeStatusesForWorkspaceClose = useCallback(
    (rootPath: string) => {
      const runtimeOwner = workspaceRuntimeOwnerByTabRef.current[rootPath];
      const claimGeneration = runtimeOwner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(runtimeOwner.ownerKey)
        : undefined;
      forgetLanguageServerRuntimeStatuses(rootPath, runtimeOwner);
      if (runtimeOwner) {
        retireWorkspaceRuntimeOwnerClaim(runtimeOwner.ownerKey, claimGeneration);
      }
      delete workspaceRuntimeOwnerByTabRef.current[rootPath];
    },
    [forgetLanguageServerRuntimeStatuses, retireWorkspaceRuntimeOwnerClaim],
  );
  const clearWorkspaceResourceCachesForRoot = useCallback(
    (rootPath: string) => {
      invalidateEditorConfigRoot(rootPath);
      documentSelfWrites.clearRoot(rootPath);
      releaseWorkspaceRetainedResources(
        workspaceFileChangeGateway,
        externallyRemovedDocumentRootByPathRef.current,
        rootPath,
      );
    },
    [
      documentSelfWrites,
      externallyRemovedDocumentRootByPathRef,
      invalidateEditorConfigRoot,
      workspaceFileChangeGateway,
    ],
  );
  const clearExternalFileConflictsForWorkspaceClose = useCallback(
    (rootPath: string) => clearExternalFileConflictsForRootRef.current(rootPath),
    [],
  );

  const runWithDocumentSaveExclusionRef = useRef<RunWithDocumentSaveExclusion>(
    async (_scope, operation) => operation(),
  );
  const runWithDocumentSaveExclusionDelegate = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => runWithDocumentSaveExclusionRef.current(scope, operation),
    [],
  );
  const commitWorkspaceClose = useCallback(
    (rootPath: string, identity: WorkspaceIdentityDescriptor | null) => {
      const ownership = beginWorkspaceClose(rootPath, identity);
      documentSessionAuthorityLifecycle.deactivateActiveClose(
        rootPath,
        identity,
        currentWorkspaceRootRef.current,
        currentEditorSessionOwnerKeyRef.current,
      );
      return ownership;
    },
    [beginWorkspaceClose, currentEditorSessionOwnerKeyRef, documentSessionAuthorityLifecycle],
  );
  const workspaceCloseSession = useMemo<WorkspaceCloseSessionPort>(
    () => ({
      current: () => {
        const activeRoot = currentWorkspaceRootRef.current;
        if (!activeRoot) {
          return { activeRoot: null, needsAttention: false };
        }

        const hasDirtyDocument = editorGroupsUniquePaths(editorGroupsRef.current).some((path) => {
          const document = documentsRef.current[path];
          return Boolean(document && !document.readOnly && isDirty(document));
        });
        return {
          activeRoot,
          needsAttention: documentNeedsAttention(
            hasDirtyDocument,
            workspaceHasExternalFileConflictsRef.current(activeRoot),
          ),
        };
      },
    }),
    [documentsRef, editorGroupsRef],
  );

  const {
    closeApplicationWindow,
    closeWorkspaceTab: closeWorkspaceTabWithLifecycle,
    quitApplication,
  } = useWorkbenchCloseLifecycle({
    workspaceRoot,
    dirtyCount,
    appSettingsRef,
    workspaceStateCacheRef,
    resolveCachedWorkspaceState,
    forgetCachedWorkspaceState,
    workspaceIdentityByRootRef,
    editorConfigCacheRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    prompter,
    dirtyCloseDecisionPort: options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
    captureDirtyCloseTargets,
    isWorkspaceRuntimeOwnerCurrent,
    ownerDocumentSaveRepository: ownerDocumentSaveAdapters.repository,
    ownerResolvingDocumentSaveService,
    requestOwnerDocumentSave,
    workspaceCloseSession,
    commitWorkspaceClose,
    runWithDocumentSaveExclusion: runWithDocumentSaveExclusionDelegate,
    persistAppSettings,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    stopProjectRuntimes: stopProjectRuntimesForWorkspaceClose,
    forgetLanguageServerRuntimeStatuses: forgetLanguageServerRuntimeStatusesForWorkspaceClose,
    forgetLatencyTrackerForRoot,
    unregisterWorkspace: releaseOwnedWorkspaceIdentity,
    clearExternalFileConflictsForRoot: clearExternalFileConflictsForWorkspaceClose,
    invalidateWorkspaceResourceCachesForRoot: clearWorkspaceResourceCachesForRoot,
    workspaceHasExternalFileConflicts: (root) => workspaceHasExternalFileConflictsRef.current(root),
    openWorkspacePath,
    clearActiveWorkspace,
    persistWorkspaceSession: persistCurrentWorkspaceSession,
    reportError,
  });

  const closeWorkspaceTab = useCallback(
    async (path: string) => {
      const identityDescriptor = workspaceIdentityByRootRef.current[path] ?? null;
      const canonicalKey = identityDescriptor?.canonicalRoot ?? path;
      const resolvedTabPath = identityDescriptor
        ? (appSettingsRef.current.workspaceTabs.find(
            (tabPath) =>
              workspaceIdentityByRootRef.current[tabPath]?.workspaceId ===
              identityDescriptor.workspaceId,
          ) ?? identityDescriptor.selectedPath)
        : path;
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[resolvedTabPath] ?? resolvedTabPath;
      const runtimeOwner =
        workspaceRuntimeOwnerByTabRef.current[resolvedTabPath] ??
        workspaceRuntimeOwnerByTabRef.current[path] ??
        (workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)
          ? resolveCurrentWorkspaceRuntimeOwner()
          : null);
      await closeWorkspaceTabWithLifecycle(path);

      const resolvedTabStillOpen = appSettingsRef.current.workspaceTabs.some(
        (tabPath) =>
          workspaceRootKeysEqual(tabPath, resolvedTabPath) ||
          Boolean(
            identityDescriptor &&
            workspaceIdentityByRootRef.current[tabPath]?.workspaceId ===
              identityDescriptor.workspaceId,
          ),
      );
      if (resolvedTabStillOpen) {
        return;
      }

      setPackageScriptsByRoot((current) =>
        withoutClosedWorkspacePackageScripts(current, [path, resolvedTabPath, runtimeRootPath]),
      );
      workspaceSettingsByRoot.forget(canonicalKey);
      delete workspaceRuntimeRootByTabRef.current[path];
      delete workspaceRuntimeRootByTabRef.current[resolvedTabPath];
      delete workspaceRuntimeRootByTabRef.current[runtimeRootPath];
      delete workspaceRuntimeOwnerByTabRef.current[path];
      delete workspaceRuntimeOwnerByTabRef.current[resolvedTabPath];
      if (runtimeOwner) {
        delete hasPhpWorkspaceByOwnerRef.current[runtimeOwner.ownerKey];
        releaseWorkspaceTrustOwner(runtimeOwner.ownerKey);
      }

      recentlyClosedTabsRef.current = clearClosedWorkspaceEditorRetainedState(
        recentlyClosedTabsRef.current,
        workspaceEditorViewStatesRef.current,
        identityDescriptor,
        resolvedTabPath,
      );
    },
    [
      closeWorkspaceTabWithLifecycle,
      releaseWorkspaceTrustOwner,
      resolveCurrentWorkspaceRuntimeOwner,
      workspaceSettingsByRoot,
    ],
  );

  const recentlyClosedDocumentViewState = useCallback(
    (rootPath: string, path: string) =>
      workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(rootPath)]?.[
        editorGroupsRef.current.activeGroupId
      ]?.[path],
    [editorGroupsRef, editorSessionOwnerKeyForRoot],
  );

  const onRecentlyClosedTabsChange = useCallback(() => {
    setRecentlyClosedTabsVersion((current) => current + 1);
  }, []);

  const openRecentlyClosedDocument = useCallback(
    async (rootPath: string, path: string) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return false;
      }

      return openPinnedFile({
        kind: "file",
        name: getFileName(path),
        path,
      });
    },
    [openPinnedFile],
  );

  const restoreRecentlyClosedDocumentViewState = useCallback(
    (rootPath: string, path: string, viewState: WorkspaceSessionViewState) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      const groupId = editorGroupsRef.current.activeGroupId;
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
      setRestoredEditorViewStateRevision((revision) => revision + 1);
      setEditorRevealTarget({
        path,
        position: { column: viewState.column, lineNumber: viewState.line },
      });
    },
    [editorGroupsRef, editorSessionOwnerKeyForRoot, setEditorRevealTarget],
  );

  const workspaceTrustedRef = useRef(workspaceTrusted);
  workspaceTrustedRef.current = workspaceTrusted;
  const isWorkspaceTrusted = useCallback(() => workspaceTrustedRef.current, []);
  const prettierFormattingGateway =
    options.prettierFormattingGateway ?? defaultPrettierFormattingGateway;
  const saveParticipants = useMemo(
    () =>
      orderedDocumentSaveParticipants({
        eslintFixOnSave: createEslintFixOnSaveParticipant({
          analyseDocument: (rootPath, path, content, binaryPath) =>
            eslintDiagnosticsGateway.analyseDocument(rootPath, path, content, binaryPath),
          isWorkspaceTrusted,
        }),
        prettierFormatOnSave: createPrettierSaveParticipant({
          prettierFormatting: prettierFormattingGateway,
          isWorkspaceTrusted,
        }),
      }),
    [isWorkspaceTrusted, prettierFormattingGateway],
  );

  const {
    captureLocalHistorySnapshot,
    requestOwnerDocumentSave: requestCoordinatedOwnerDocumentSave,
    saveDocument,
    saveActiveDocument,
    onActiveLiveDocumentSaveBindingChange,
    runWithDocumentSaveExclusion,
    runWithIssuedWriteDrain,
    closeDocument: closeTextDocument,
    closeActiveSurface: closeTextSurface,
    reopenClosedDocument,
    canReopenClosedDocument,
  } = useDocumentLifecycle({
    workspaceRoot,
    editorSessionOwnerKey,
    documentTabSession,
    activeDocument,
    documents,
    openPaths,
    activePath,
    previewPath,
    workspaceSettings,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    workspaceRequestTokenRef: openWorkspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    externallyRemovedDocumentRootByPathRef,
    recentlyClosedTabsRef,
    setDocuments,
    setPreviewPath,
    setOpenPaths,
    setActivePath,
    setMessage,
    localHistoryGateway,
    workspaceFiles,
    workspaceOwnerRelativeFiles: workspaceOwnerFiles,
    resolveDocumentSaveOwnership,
    prompter,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument: syncSavedDocumentForRoot,
    syncSavedJavaScriptTypeScriptDocument: syncSavedJavaScriptTypeScriptDocumentForRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    cancelGitDiffDocument,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface: closeApplicationWindow,
    isGitDiffDocumentPath,
    reportErrorForActiveWorkspaceRoot,
    hasExternalFileConflict,
    beginDocumentSelfWrite: (rootPath, path, content) => {
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      return ownership ? documentSelfWrites.begin(ownership, content) : null;
    },
    beginRegisteredDocumentSelfWrite: documentSelfWrites.begin.bind(documentSelfWrites),
    clearExternalFileConflict: externalFileConflicts.clearConflict,
    detectSaveConflict: externalFileConflicts.detectSaveConflict,
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    onDidSaveDocument: refreshEditorConfigAfterSave,
    saveParticipants,
    recentlyClosedDocumentViewState,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange,
    activeLiveDocumentSaveCoordinator: options.activeLiveDocumentSaveCoordinator,
  });
  requestOwnerDocumentSaveRef.current = requestCoordinatedOwnerDocumentSave;
  runWithDocumentSaveExclusionRef.current = runWithDocumentSaveExclusion;
  runWithIssuedWriteDrainRef.current = runWithIssuedWriteDrain;

  const {
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
  } = useWorkbenchEditorGroupCloseLifecycle({
    workspaceRoot,
    currentWorkspaceRootRef,
    editorGroupsRef,
    openPathsRef,
    previewPathRef,
    activeDocumentRef,
    documentsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    setImageTabs,
    setMarkdownPreviewTabs,
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
    updateEditorGroups,
    closeTextDocument,
    closeTextSurface,
    saveDocument,
    runWithIssuedWriteDrain,
    resolveDocumentSaveOwnership,
    resolveWorkspaceRuntimeOwner,
    dirtyCloseDecisionPort: options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
    hasExternalFileConflict,
    onDidCloseEditorPaths: options.onDidCloseEditorPaths,
    prompter,
  });
  const closeDocumentForCommandsRef = useRef(closeDocument);
  const closeActiveEditorGroupForCommandsRef = useRef(closeActiveEditorGroup);
  const closeActiveEditorGroupSurfaceForCommandsRef = useRef(closeActiveEditorGroupSurface);
  closeDocumentForCommandsRef.current = closeDocument;
  closeActiveEditorGroupForCommandsRef.current = closeActiveEditorGroup;
  closeActiveEditorGroupSurfaceForCommandsRef.current = closeActiveEditorGroupSurface;
  const runCloseDocument = useCallback(
    (path: string) => closeDocumentForCommandsRef.current(path),
    [],
  );
  const runCloseActiveEditorGroup = useCallback(async () => {
    await closeActiveEditorGroupForCommandsRef.current();
  }, []);
  const runCloseActiveEditorGroupSurface = useCallback(async () => {
    await closeActiveEditorGroupSurfaceForCommandsRef.current();
  }, []);

  const {
    activateEditorGroup,
    activateEditorGroupTab,
    splitActiveEditorGroup,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    moveEditorGroupTab,
    reorderEditorGroupTab,
    pinEditorGroupTab,
    resizeEditorSplit,
    reorderOpenTabs,
    updateEditorViewState,
    updateEditorGroupViewState,
  } = useWorkbenchEditorGroupCoordinator({
    clearGitDiffPreviewState,
    currentWorkspaceRootRef,
    editorGroupFocusRunner: options.editorGroupFocusRunner,
    editorGroupsRef,
    editorSessionOwnerKeyForRoot,
    isGitDiffDocumentPath,
    loadGitDiffDocument,
    nextEditorGroupIdRef,
    updateEditorGroups,
    workspaceEditorViewStatesRef,
  });

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
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Status Bar", error);
      }
    },
    [persistWorkspaceSettings, reportErrorForActiveWorkspaceRoot, workspaceRoot],
  );

  const setSmartMode = useWorkbenchSmartModeCoordinator({
    autoStartedLanguageServerRootRef,
    clearWorkspaceIndex,
    currentWorkspaceRootRef,
    intelligenceMode,
    intelligenceModeRef,
    persistWorkspaceSettings,
    phpLanguageServerAutostartAttemptsByRootRef,
    reportErrorForActiveWorkspaceRoot,
    runPhpWorkspaceProbe,
    setIntelligenceMode,
    setMessage,
    smartModeGateway,
    smartModeRequestGenerationRef,
    smartModeRequestIntentRef,
    startInitialIndexScan,
    stopLanguageServerRuntime,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceSettingsRef,
  });

  const updateActiveDocument = useWorkbenchActiveDocumentEditing({
    activeDocument,
    activeDocumentRef,
    activePhpFrameworkProviders,
    invalidatePhpFrameworkBindingCacheRef,
    isPhpFrameworkBindingDependencyPathRef,
    phpFrameworkRuntimeContext,
    pinDocument,
    reportChangedDocuments,
    resetPhpFrameworkMorphMapModelTypeCacheRef,
    setDocuments,
    updateDocumentContent,
    updateLocalPhpDiagnostics,
  });

  const openMarkdownPreview = useCallback(async () => {
    const source = activeDocumentRef.current;
    const requestedRoot = currentWorkspaceRootRef.current;

    if (!requestedRoot || !isMarkdownDocument(source)) {
      return;
    }

    if (!isSessionPathInWorkspace(requestedRoot, source.path)) {
      return;
    }

    const path = markdownPreviewPath(source.path);
    const existing = markdownPreviewTabsRef.current[path];

    if (existing) {
      setActivePath(path);
      return;
    }

    const preview: MarkdownPreviewTab = {
      content: source.content,
      html: "",
      name: `${source.name} Preview`,
      path,
      sourcePath: source.path,
    };
    const nextMarkdownPreviews = {
      ...markdownPreviewTabsRef.current,
      [path]: preview,
    };
    const nextOpenPaths = [
      ...new Set([
        ...visibleEditorPaths(openPathsRef.current, previewPathRef.current),
        source.path,
        path,
      ]),
    ];
    markdownPreviewTabsRef.current = nextMarkdownPreviews;
    openPathsRef.current = nextOpenPaths;
    previewPathRef.current = null;
    activeDocumentRef.current = null;
    setMarkdownPreviewTabs(nextMarkdownPreviews);
    updateEditorGroups((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [current.activeGroupId]: openEditorGroupPath(current.groups[current.activeGroupId], {
          nextActivePath: path,
          nextOpenPaths,
          nextPreviewPath: null,
        }),
      },
    }));

    try {
      const html = await markdownPreviewRenderer(source.content);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const current = markdownPreviewTabsRef.current[path];

      if (!current || current.sourcePath !== source.path) {
        return;
      }

      const renderedPreview = { ...current, html };
      const renderedPreviews = {
        ...markdownPreviewTabsRef.current,
        [path]: renderedPreview,
      };
      markdownPreviewTabsRef.current = renderedPreviews;
      setMarkdownPreviewTabs(renderedPreviews);
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      reportErrorForActiveWorkspaceRoot(requestedRoot, "Markdown Preview", error);
    }
  }, [
    activeDocumentRef,
    markdownPreviewRenderer,
    markdownPreviewTabsRef,
    openPathsRef,
    previewPathRef,
    reportErrorForActiveWorkspaceRoot,
    setActivePath,
    setMarkdownPreviewTabs,
    updateEditorGroups,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    const timeoutIds: number[] = [];

    openMarkdownPreviews.forEach((preview) => {
      const source = documents[preview.sourcePath];

      if (!source || source.content === preview.content) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const content = source.content;
      const timeoutId = window.setTimeout(() => {
        void markdownPreviewRenderer(content)
          .then((html) => {
            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }

            const current = markdownPreviewTabsRef.current[preview.path];

            if (!current || current.sourcePath !== preview.sourcePath) {
              return;
            }

            if (!openPathsRef.current.includes(preview.path)) {
              return;
            }

            if (documentsRef.current[preview.sourcePath]?.content !== content) {
              return;
            }

            const renderedPreview = { ...current, content, html };
            const renderedPreviews = {
              ...markdownPreviewTabsRef.current,
              [preview.path]: renderedPreview,
            };
            markdownPreviewTabsRef.current = renderedPreviews;
            setMarkdownPreviewTabs(renderedPreviews);
          })
          .catch((error) => {
            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }

            reportErrorForActiveWorkspaceRoot(requestedRoot, "Markdown Preview", error);
          });
      }, 300);
      timeoutIds.push(timeoutId);
    });

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [
    documents,
    documentsRef,
    markdownPreviewRenderer,
    markdownPreviewTabsRef,
    openMarkdownPreviews,
    openPathsRef,
    reportErrorForActiveWorkspaceRoot,
    setMarkdownPreviewTabs,
    workspaceRoot,
  ]);

  const revertActiveEditorChangeHunk = useCallback(
    (hunk: EditorChangeHunk) => {
      if (!activeDocument) {
        return;
      }
      const content = applyEditorChangeRevert(activeDocument.content, hunk);
      if (content !== activeDocument.content) {
        updateActiveDocument(content);
      }
    },
    [activeDocument, updateActiveDocument],
  );

  // PhpStorm-style "Create Test" (Ctrl+Shift+T): from the active PHP class,
  // derive the matching PHPUnit test path/namespace via PSR-4, render a skeleton
  // (one `test<Method>()` per public instance method) and open it. Conservative:
  // an existing test is opened, never overwritten; non-class sources / classes
  // without public instance methods produce no file. Per-workspace isolation:
  // the requested root is captured up front and re-checked after every await so
  // a tab switch mid-flight drops the (now stale) generation.
  const generateTestForActiveDocument = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const requestedDocument = activeDocumentRef.current;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot || !requestedDescriptor?.php || !requestedDocument) {
      return;
    }

    if (requestedDocument.language !== "php") {
      return;
    }

    const plan = phpTestClassPlan({
      psr4Roots: requestedDescriptor.php.psr4Roots,
      source: requestedDocument.content,
    });

    if (!plan) {
      setMessage("Generate test: no testable class in the active file.");
      return;
    }

    const testPath = joinWorkspacePath(requestedRoot, plan.relativePath);

    try {
      const existingTest = await readTestFileIfExists(testPath);

      if (!isRequestedRootActive()) {
        return;
      }

      if (existingTest !== null) {
        await openFile({
          kind: "file",
          name: getFileName(testPath),
          path: testPath,
        });
        return;
      }

      const parentPath = getParentPath(testPath);
      await workspaceFiles.createDirectory(parentPath);

      if (!isRequestedRootActive()) {
        return;
      }

      await createWorkspaceTextFileWithContent(
        workspaceFiles,
        testPath,
        renderPhpTestSkeleton(plan),
      );

      if (!isRequestedRootActive()) {
        return;
      }

      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "created",
          path: testPath,
        },
      ]);

      if (!isRequestedRootActive()) {
        return;
      }

      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);

      if (!isRequestedRootActive()) {
        return;
      }

      await openFile({
        kind: "file",
        name: getFileName(testPath),
        path: testPath,
      });
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Generate Test", error);
    }
  }, [
    activeDocumentRef,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    setExpandedDirectories,
    openFile,
    readTestFileIfExists,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    workspaceDescriptor,
    workspaceFiles,
    workspaceRoot,
  ]);

  const applyPhpCodeActionNewFile = usePhpCodeActionNewFileApplication({
    workspaceRoot,
    currentWorkspaceRootRef,
    workspaceFiles,
    workspaceIdentityDescriptorRef,
    workspaceOwnerFiles,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    setExpandedDirectories,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    openFile,
    readTestFileIfExists,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
  });

  // PhpStorm-style "Go to Test / Test Subject": from the active PHP file, decide
  // (via PSR-4) whether it is a TEST or a production SUBJECT and jump to its
  // partner. From a source class, both Unit and Feature suites are probed and the
  // first existing test wins; from a test, the single derived subject is opened.
  // The partner is opened (never created); a missing partner only notifies. Per
  // the per-workspace isolation rule the requested root is captured up front and
  // re-checked after every await so a tab switch mid-flight drops the navigation.
  const goToTestForActiveDocument = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const requestedDocument = activeDocumentRef.current;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot || !requestedDescriptor?.php || !requestedDocument) {
      return;
    }

    if (requestedDocument.language !== "php") {
      return;
    }

    const relativePath = workspaceRelativePath(requestedRoot, requestedDocument.path);

    if (!relativePath) {
      return;
    }

    const navigation = phpTestNavigationTargets({
      psr4Roots: requestedDescriptor.php.psr4Roots,
      relativePath,
    });

    if (!navigation) {
      setMessage("Go to test: no test mapping for the active file.");
      return;
    }

    try {
      for (const candidate of navigation.candidates) {
        const candidatePath = joinWorkspacePath(requestedRoot, candidate);
        const existing = await readTestFileIfExists(candidatePath);

        if (!isRequestedRootActive()) {
          return;
        }

        if (existing === null) {
          continue;
        }

        await openFile({
          kind: "file",
          name: getFileName(candidatePath),
          path: candidatePath,
        });
        return;
      }

      setMessage(phpTestPartnerMissingMessage(navigation.direction));
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Go to Test", error);
    }
  }, [
    activeDocumentRef,
    openFile,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const navigationSurfaceIdentity = useMemo(
    () => ({ activeGroupId, activePath, editorSessionOwnerKey }),
    [activeGroupId, activePath, editorSessionOwnerKey],
  );
  const captureNavigationCommandScope = useCallback(
    (): EditorSurfaceCommandInvocationScope =>
      editorSurfaceCommandRunner?.captureScope?.() ?? {
        documentPath: activeDocumentRef.current?.path ?? null,
        modelIdentity: null,
        ownerKey: currentEditorSessionOwnerKeyRef.current,
        surfaceIdentity: navigationSurfaceIdentity,
      },
    [
      activeDocumentRef,
      currentEditorSessionOwnerKeyRef,
      navigationSurfaceIdentity,
      editorSurfaceCommandRunner,
    ],
  );
  const isNavigationCommandScopeCurrent = useCallback(
    (scope: EditorSurfaceCommandInvocationScope) => {
      if (scope.ownerKey !== currentEditorSessionOwnerKeyRef.current) {
        return false;
      }

      if (scope.documentPath !== (activeDocumentRef.current?.path ?? null)) {
        return false;
      }

      if (!scope.modelIdentity) {
        return scope.surfaceIdentity === navigationSurfaceIdentity;
      }

      return editorSurfaceCommandRunner?.isScopeCurrent?.(scope) ?? false;
    },
    [
      activeDocumentRef,
      currentEditorSessionOwnerKeyRef,
      navigationSurfaceIdentity,
      editorSurfaceCommandRunner,
    ],
  );
  const { commandContext, commandContextRef } = useWorkbenchCommandContext({
    activeDocument,
    captureEditorSurfaceScope: captureNavigationCommandScope,
    workspaceRoot,
  });

  const {
    activateSearchEverywhereItem,
    openClassSearchResult,
    openCurrentFileLocation,
    openNavigationTarget,
    openPathForNavigation,
    openProblemNotice,
    openRecentFile,
    openSearchResult,
    openWorkspaceSymbolResult,
    goToNextProblem,
    goToPreviousProblem,
    readNavigationFileContent,
  } = useWorkbenchNavigation({
    activeDocumentRef,
    activeEditorPositionRef,
    commandContextRef,
    currentWorkspaceRootRef,
    documentsRef,
    noticesRef,
    workspaceFiles,
    openFile,
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
  });
  openSymbolPanelNavigationTargetRef.current = openNavigationTarget;

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
    debugGateway: options.debugGateway ?? defaultDebugGateway,
    editorSessionOwnerKey,
    invalidateJsTestCoverageAndResults,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    isEditorGroupDocumentSessionAuthorityCurrent,
    isWorkspaceTrusted,
    openDocuments,
    openFile,
    openNavigationTarget,
    options,
    prompter,
    readTestFileIfExists,
    resolveActiveDocumentSessionAuthority,
    reportErrorForActiveWorkspaceRoot,
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
    workspaceTrustedRef,
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
    reportErrorForActiveWorkspaceRoot,
    revealPathGateway: isTauri() ? DEFAULT_REVEAL_PATH_GATEWAY : null,
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
      openFile,
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
      if (!ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return null;
      }
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return null;
      }
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      return ownership ? documentSelfWrites.begin(ownership, content) : null;
    },
    captureLocalHistorySnapshot: async (owner, rootPath, path, content) => {
      if (!ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return;
      }
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return;
      }
      await captureLocalHistorySnapshot(rootPath, path, content);
    },
    currentWorkspaceRootRef,
    invalidateOwnerDocumentPrefetch: (owner, path) => {
      if (!ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
        return;
      }
      filePrefetchCacheRef.current.invalidate(path);
    },
    localHistoryGateway,
    ownerDocumentSaveRepository: ownerDocumentSaveAdapters.repository,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveDocumentSaveOwnership,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    requestOwnerDocumentSave: requestCoordinatedOwnerDocumentSave,
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
      if (!ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
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
    reportErrorForActiveWorkspaceRoot,
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
    reportErrorForActiveWorkspaceRoot,
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
    navigationHistory,
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
    applyJavaScriptTypeScriptCreateEdits,
    applyJavaScriptTypeScriptDeleteEdits,
    applyJavaScriptTypeScriptRenameEdits,
    applyPhpRenameEdits,
    clearLanguageServerDiagnosticsForPath,
    closeDocument,
    forgetExternallyRemovedDocumentPath,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    invalidateFrameworkCachesForPath,
    resolveDocumentSaveOwnership,
    runWithDocumentSaveExclusion,
    invalidatePhpFrameworkBindingsForFileChange,
    invalidatePhpFrameworkSourcePath,
    invalidatePhpTraitHostClassNames,
    markExternallyRemovedDocumentPath,
    notifyJavaScriptTypeScriptFileCreated,
    notifyJavaScriptTypeScriptFileDeleted,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    openFile,
    refreshDirectory,
    refreshGitStatus,
    remapRecentFile,
    remapRecentLocations,
    reportChangedDocuments,
    reportErrorForActiveWorkspaceRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
  });

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
      setSmartMode,
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
    currentWorkspaceRootRef,
    installingManagedPhpactor,
    installingManagedPhpactorRootRef,
    installingManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServerRootRef,
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
    closeGitDiffPreview,
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
    captureNavigationCommandScope,
    activeEslintBufferClean,
    activeEslintFixes,
    activeImage,
    activeMarkdownPreview,
    activePackageScripts,
    nodePackageScriptsWorkbench: nodePackageScripts,
    vscodeProcessTasksWorkbench: vscodeProcessTaskComposition.commands,
    nodeRunWithoutDebugging,
    activePhpstanBufferClean,
    activateWorkspaceTab,
    appSettings,
    canReopenClosedDocument,
    canRewordSelectedGitCommit,
    canSearchClassOpenSymbols,
    cherryPickSelectedGitCommit,
    closeActiveEditorGroup: runCloseActiveEditorGroup,
    closeActiveEditorGroupSurface: runCloseActiveEditorGroupSurface,
    closeDocument: runCloseDocument,
    commitGitChanges,
    createDirectory,
    createFile,
    createGitBranch,
    configureNodeLaunchConfigurations: nodeLaunchConfigurationsSurface.openNodeLaunchConfigurations,
    debugState: debugSession,
    debugCallStackNavigation,
    debugRestartFrame,
    debugBreakpointNavigation,
    debugInlineBreakpoint,
    debugCopyStackTrace,
    debugEvaluateInConsole,
    debugWatchAtCursor,
    jsTestDebugAtCursor,
    jsTestRerunLastRun: createJsTestRerunLastRunCommands(options.jsTestExplorerScopeRunner),
    jsTestRunSelection,
    deleteActiveDocument,
    disableEslintRuleAtCursor,
    openDebugPanel,
    attachNodeDebug,
    pauseDebug: debugSession.pauseDebug,
    startOrContinueDebug,
    startPhpListenDebug,
    stepDebug: debugSession.stepDebug,
    stopDebug: debugSession.stopDebug,
    toggleDebugBreakpointAtCursor,
    editorGroups,
    editorSurfaceCommandRunner,
    editorMenuCommandRunner: options.editorMenuCommandRunner,
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
    agents,
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
  });

  const runCommand = useCallback<CommandExecutionRunner>(
    (commandId, context = commandContext) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      return executeCommandAndReport(commandRegistry, commandId, context, (error) =>
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Command", error),
      );
    },
    [commandContext, commandRegistry, reportErrorForActiveWorkspaceRoot],
  );

  useWorkbenchNativeMenuCommands({
    commandContext,
    reportError,
    runCommand,
  });

  const searchEverywhereModel = searchEverywhereModelFor(commandRegistry.list(), commandContext);

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
    refreshPhpTree,
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
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
    editorSurfaceIdentity: navigationSurfaceIdentity,
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

  useEffect(() => {
    if (hasRestoredRef.current) {
      return;
    }

    hasRestoredRef.current = true;
    let active = true;

    settingsGateway
      .loadAppSettings()
      .then((settings) => {
        if (!active) {
          return;
        }

        applyAppSettings(settings);
        const workspacePath = settings.recentWorkspacePath ?? settings.workspaceTabs[0] ?? null;

        if (!workspacePath) {
          return;
        }

        if (!active) {
          return;
        }

        void openWorkspacePath(workspacePath);
      })
      .catch((error) => reportError("Settings", error));

    return () => {
      active = false;
    };
  }, [applyAppSettings, openWorkspacePath, reportError, settingsGateway]);

  useWorkbenchWorkspaceFileChangeSubscription({
    currentWorkspaceRootRef,
    externallyRemovedDocumentRootByPathRef,
    gateway: workspaceFileChangeGateway,
    handleExternalFileChange,
    handleWorkspaceDiscoveryFileChange,
    handleWorkspaceFileChange,
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

  const activeLanguageRuntimeGeneration = workspaceRuntimeOwner
    ? (workspaceRuntimeOwnerClaimsRef.current.generationFor(workspaceRuntimeOwner.ownerKey) ?? null)
    : null;
  useWorkbenchLanguageRuntimeEffects({
    changedDocumentSync: {
      documentsRef,
      incrementalSyncRef: javaScriptTypeScriptIncrementalSyncRef,
      scheduleDocumentChange,
      scheduleJavaScriptTypeScriptDocumentChange,
      subscribeChangedDocuments,
    },
    diagnosticsSubscriptions: {
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
    },
    javaScriptTypeScript: {
      activePath,
      documentSyncRuntimeSignatureRef: javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
      documentsRef,
      languageServerRuntimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      openDocumentPaths,
      resetLanguageServerDocuments: resetJavaScriptTypeScriptLanguageServerDocuments,
      runtimeGeneration: activeLanguageRuntimeGeneration,
      runtimeOwner: workspaceRuntimeOwner,
      syncOpenDocument: syncOpenJavaScriptTypeScriptDocument,
      workspaceRoot,
    },
    php: {
      activePath,
      documentSyncRuntimeSignatureRef,
      documentsRef,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      openDocumentPaths,
      resetLanguageServerDocuments,
      runtimeGeneration: activeLanguageRuntimeGeneration,
      runtimeOwner: workspaceRuntimeOwner,
      syncOpenDocument,
      workspaceRoot,
    },
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
  const reportCommandError = useCallback(
    (error: unknown) => reportErrorForActiveWorkspaceRoot(workspaceRoot, "Command", error),
    [reportErrorForActiveWorkspaceRoot, workspaceRoot],
  );
  const restoredEditorViewStatesByGroup = workspaceRoot
    ? (workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(workspaceRoot)] ??
      EMPTY_EDITOR_VIEW_STATES_BY_GROUP)
    : EMPTY_EDITOR_VIEW_STATES_BY_GROUP;
  const restoredEditorViewStates =
    restoredEditorViewStatesByGroup[activeGroupId] ?? EMPTY_EDITOR_VIEW_STATES;
  const recentFilesSwitcherEntries = useMemo(
    () => recentFilesForSwitcher(recentFiles, activePath),
    [activePath, recentFiles],
  );
  const sortedBookmarks = useMemo(() => sortBookmarks(bookmarks), [bookmarks]);
  const closeImplementationChooser = useCallback(
    () => setImplementationChooser(null),
    [setImplementationChooser],
  );
  const closeCallHierarchy = useCallback(() => setCallHierarchyView(null), [setCallHierarchyView]);
  const closeTypeHierarchy = useCallback(() => setTypeHierarchyView(null), [setTypeHierarchyView]);
  const closeReferencesPanel = useCallback(() => setReferencesView(null), [setReferencesView]);
  const focusNextEditorGroup = useCallback(
    () => focusAdjacentEditorGroup(1),
    [focusAdjacentEditorGroup],
  );
  const focusPreviousEditorGroup = useCallback(
    () => focusAdjacentEditorGroup(-1),
    [focusAdjacentEditorGroup],
  );
  const moveActiveTabToNextGroup = useCallback(
    () => moveActiveTabToAdjacentGroup(1),
    [moveActiveTabToAdjacentGroup],
  );
  const moveActiveTabToPreviousGroup = useCallback(
    () => moveActiveTabToAdjacentGroup(-1),
    [moveActiveTabToAdjacentGroup],
  );
  const clearNotices = useCallback(() => setNotices([]), [setNotices]);
  const clearLanguageServerDiagnosticsForActivePath = useCallback(
    (path: string) =>
      clearLanguageServerDiagnosticsForPath(
        workspaceRoot,
        path,
        workspaceRuntimeOwner ?? undefined,
      ),
    [clearLanguageServerDiagnosticsForPath, workspaceRoot, workspaceRuntimeOwner],
  );

  return {
    activeDocument,
    activeImage,
    activeMarkdownPreview,
    activeDocumentGitBaseline,
    activeEditorConfig,
    activePath,
    documentSessionAuthorityRevision,
    attachEditorGroupLiveDocument,
    onActiveLiveDocumentSaveBindingChange,
    javaScriptTypeScriptIncrementalSync: optionalEditorJavaScriptTypeScriptIncrementalSyncFacade(
      javaScriptTypeScriptIncrementalSyncRef.current,
    ),
    isDocumentSessionLifecycleAuthorityCurrent,
    isEditorGroupDocumentSessionAuthorityCurrent,
    resolveActiveDocumentSessionAuthority,
    resolveDocumentSessionLifecycleAuthority,
    resolveEditorGroupDocumentSessionAuthority,
    isOpeningFile,
    appSettings,
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    applyPhpLanguageServerWorkspaceEdit,
    phpChangeSignature,
    activateWorkspaceTab,
    callHierarchyView,
    typeHierarchyView,
    referencesView,
    classOpenLoading,
    classOpenOpen,
    classOpenQuery,
    classOpenResults,
    workspaceSymbolsLoading,
    workspaceSymbolsOpen,
    workspaceSymbolsQuery,
    workspaceSymbolsResults,
    searchEverywhereOpen,
    searchEverywhereQuery,
    searchEverywhereLoading,
    searchEverywhereModel,
    openSearchEverywhere,
    activateSearchEverywhereItem,
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    closeImplementationChooser,
    closeCallHierarchy,
    closeTypeHierarchy,
    closeReferencesPanel,
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    focusNextEditorGroup,
    focusPreviousEditorGroup,
    moveActiveTabToNextGroup,
    moveActiveTabToPreviousGroup,
    activateEditorGroup,
    activateEditorGroupTab,
    splitActiveEditorGroup,
    moveEditorGroupTab,
    reorderEditorGroupTab,
    pinEditorGroupTab,
    resizeEditorSplit,
    editorGroups,
    closeGitDiffPreview,
    closeWorkspaceTab,
    amendGitChanges,
    commitAndPushGitChanges,
    commitGitChanges,
    commandContext,
    commands: commandRegistry.list(),
    commandPaletteInitialQuery,
    runCommand,
    diagnosticsSummary,
    dirtyCount,
    externalFileConflictCount: externalFileConflicts.conflictCount,
    externalFileConflictState: externalFileConflicts.activeState,
    handleExternalFileConflictAction: externalFileConflicts.action,
    closeExternalFileCompare: externalFileConflicts.closeCompare,
    entriesByDirectory,
    expandedDirectories,
    failedDirectories,
    expandedPhpFilePaths,
    fileStructureCanIncludeInheritedMembers,
    fileStructureInitialQuery,
    fileStructureLoading,
    fileStructureOutline,
    fileStructureOpen,
    fileStructureScope,
    flushPendingLanguageServerDocument: flushPendingDocumentChange,
    getLanguageServerDocumentLifecycleIdentity,
    getJavaScriptTypeScriptDocumentSyncVersion,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    flushPendingJavaScriptTypeScriptLanguageServerDocument:
      flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerDocumentSynced,
    goToDefinition,
    goToImplementationAt,
    goToSuperMethod,
    goToNextProblem,
    goToPreviousProblem,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    debugSession: {
      ...debugSession,
      latencyTracker: workspaceRoot ? latencyTrackerForRoot(workspaceRoot) : undefined,
    },
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
    clearEditorRevealTarget,
    closeFloatingSurface,
    bottomPanelVisible,
    bottomPanelView,
    editorRevealTarget,
    gitDiffLoading,
    gitDiffDocuments,
    gitDiffPreview,
    gitCommitMessage,
    gitCommitMessageHistory,
    gitAmendEnabled,
    includedGitChangePaths,
    gitLoading,
    gitOperationLoading,
    gitStatus,
    gitRepositoryStatuses,
    gitRepositoryMappings,
    gitBranch: gitActiveFileBranch.branch,
    gitBranchRepositoryLabel: gitActiveFileBranch.repositoryLabel,
    indexHealthLogs,
    indexProgress,
    intelligenceMode,
    activeFrameworkActivityLabel,
    hasNetteApplicationFramework,
    hasSymfonyFramework,
    implementationChooser,
    languageServerDiagnosticsByPath: mergedLanguageServerDiagnosticsByPath,
    loadingDirectories,
    loadingPhpFileOutlinePaths,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerSetupOpen,
    floatingSurfaceActivationVersion,
    installingManagedPhpactor,
    message,
    openDocuments,
    openMarkdownPreviews,
    openTabs,
    markdownPreviewTabs,
    openMarkdownPreview,
    openFile,
    openCallHierarchy,
    openCallHierarchyRow,
    openFileReferencesPanel,
    openTypeHierarchy,
    openTypeHierarchyRow,
    openReferencesPanel,
    openReferenceRow,
    openGitChange,
    openReadOnlyDocument,
    openWorkspaceFile,
    openCurrentFileLocation,
    openFileStructure,
    openImplementationTarget,
    openProblemNotice,
    openTodoPanel,
    closeTodoPanel,
    refreshWorkspace,
    refreshWorkspaceTodos,
    openWorkspaceTodo,
    todoPanelOpen,
    hasArtisan: activePackageScripts?.hasArtisan ?? false,
    artisanMakePaletteOpen,
    closeArtisanMakePalette,
    workspaceTodos,
    workspaceTodosLoading,
    openPhpFileOutlineNode,
    openClassSearchResult,
    openWorkspaceSymbolResult,
    openArtisanController,
    openSymfonyRouteController,
    openSymfonyService,
    openPhpClassTarget,
    openExpressRoutesPanel,
    openPhpTestCase,
    jsTestRunRequestVersion,
    ...workspaceDiscoveryVersions,
    phpTestRunRequestVersion,
    openWorkspaceSymbols,
    openPinnedFile,
    prefetchFile,
    cancelFilePrefetch,
    openEntryInTerminal,
    revealEntry,
    renameEntry,
    clearLanguageServerDiagnosticsForPath: clearLanguageServerDiagnosticsForActivePath,
    updateLocalPhpDiagnostics,
    previewFile,
    previewPath,
    applyPhpCodeActionNewFile,
    frameworkIntelligenceProviders,
    providePhpCodeActions,
    providePhpFrameworkDefinition,
    providePhpMethodCompletions,
    providePhpMethodSignature,
    providePhpParameterInlayHints,
    openSettingsPanel,
    openWorkspace,
    openWorkspaceRoot,
    paletteOpen,
    phpFileOutlineExpandedNodeIds,
    phpFileOutlinesByPath,
    phpTree,
    phpTreeExpandedNodeIds,
    phpTreeLoading,
    phpIdeReadinessVersion,
    phpTools,
    quickOpenLoading,
    quickOpenOpen,
    quickOpenQuery,
    quickOpenRequest,
    quickOpenResults,
    quickOpenTruncated,
    recentFiles,
    recentFilesSwitcherEntries,
    recentFilesSwitcherOpen,
    openRecentFile,
    openRecentFilesSwitcher,
    setRecentFilesSwitcherOpen,
    recentLocations,
    reorderOpenTabs,
    recentLocationsPanelOpen,
    openRecentLocation,
    openRecentLocationsPanel,
    setRecentLocationsPanelOpen,
    bookmarks,
    sortedBookmarks,
    bookmarksPanelOpen,
    isActiveDocumentGitBlameEnabled: activeDocument
      ? gitBlameEnabledPaths.has(activeDocument.path)
      : false,
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
    clearNotices,
    notices: effectiveNotices,
    replaceJavaScriptTestProblemNotices,
    ...nodeLaunchConfigurationsSurface,
    navigateBackward,
    navigateForwardInHistory,
    navigationHistory,
    nodePackageScripts,
    vscodeProcessTasks: vscodeProcessTaskComposition.state,
    openNodePackageScript,
    clearLatencyMetrics,
    getLatencySnapshot,
    recordCompletionLatency,
    reportCommandError,
    reportLanguageServerError,
    previewGitChange,
    quitApplication,
    refreshPhpTree,
    refreshGitStatus,
    revealDirectoryInTree,
    retryDirectory,
    revertGitChanges,
    revertActiveEditorChangeHunk,
    saveActiveDocument,
    saveWorkbenchSettings,
    setActivePath: activateDocument,
    hideBottomPanel,
    showBottomPanelView,
    setPaletteOpen,
    runInActiveTerminal,
    setClassOpenOpen,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setGitAmendEnabled,
    setGitCommitMessage,
    setClassOpenQuery,
    setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery,
    setSettingsOpen,
    ...textSearchWorkbench,
    setLanguageServerSetupOpen,
    setStatusBarItemVisibility,
    settingsInitialSection,
    setFileStructureOpen,
    setFileStructureScopeMode,
    setSmartMode,
    pinDocument,
    openJavaScriptTypeScriptServiceLog,
    restartJavaScriptTypeScriptService,
    startIndexScan,
    startHardReindex,
    startLanguageServer,
    startPhpReindex,
    installManagedPhpactor,
    installManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServer,
    stopLanguageServer,
    settingsOpen,
    selectedGitChange,
    toggleDirectory,
    toggleGitChangeIncluded,
    loadGitFileHunks,
    stageGitChanges,
    stageGitHunk,
    unstageGitChanges,
    unstageGitHunk,
    canRevertGitChange,
    revertGitHunk,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    togglePhpTreeNode,
    agentModeActive: agents.agentModeActive,
    agentWorkbench: agents.agentWorkbench,
    toggleSmartMode,
    toggleWorkspaceTrust,
    updateActiveDocument,
    activeEditorPosition,
    updateActiveEditorPosition,
    updateEditorViewState,
    updateEditorGroupViewState,
    openPhpTreeNode,
    openSearchResult,
    agents,
    sidebarView,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceIdentityStatus: workspaceIdentityDescriptor ? "trusted" : "legacyCompatibility",
    workspaceRoot,
    restoredEditorViewStates,
    restoredEditorViewStatesByGroup,
    restoredEditorViewStateRevision,
    workspaceTabs: appSettings.workspaceTabs,
    workspaceSettings,
    workspaceTrust,
  };
}
