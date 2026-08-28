import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
export type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
export { ownerDocumentSavePipelineContextFor } from "./workbenchController/documentSaveOwnerContext";
import {
  admittedWorkspaceIdentityForRoot,
  resolveAdmittedDocumentSaveOwnership,
} from "./workbenchController/workspaceIdentityPolicy";
export {
  adoptLegacyCachedWorkspaceState,
  resolveAdmittedDocumentSaveOwnership,
  withWorkspaceIdentityLease,
} from "./workbenchController/workspaceIdentityPolicy";
import { workspaceRuntimeOwnerFor } from "./workbenchController/workspaceRuntimePolicy";
import {
  isLanguageServerActiveForWorkspace,
  isRunningLanguageServerForWorkspace,
} from "./workbenchController/languageServerStatusPolicy";
export {
  isLanguageServerSessionActiveForOwner,
  isLanguageServerSessionCurrentForOwnerOrLegacy,
} from "./workbenchController/languageServerStatusPolicy";
import {
  isJavaScriptTypeScriptDocumentSyncableForRoot,
  shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
  workspacePathBelongsToRoot,
} from "./workbenchController/workspacePathPolicy";
import { useWorkbenchCommandEffectsCoordinator } from "./workbenchController/useWorkbenchCommandEffectsCoordinator";
import { useWorkbenchWorkspaceTransitionCoordinator } from "./workbenchController/useWorkbenchWorkspaceTransitionCoordinator";
import { useWorkbenchEditorPresentation } from "./workbenchController/useWorkbenchEditorPresentation";
import {
  useWorkbenchEditorFileCoordinator,
  useWorkbenchPhpOutlineState,
} from "./workbenchController/useWorkbenchEditorFileCoordinator";
import { useWorkbenchDocumentSaveCloseCoordinator } from "./workbenchController/useWorkbenchDocumentSaveCloseCoordinator";
import {
  editorNavigationTaskOptionsFor,
  useWorkbenchEditorNavigationCoordinator,
} from "./workbenchController/useWorkbenchEditorNavigationCoordinator";
import { useWorkbenchGitDiscoveryCoordinator } from "./workbenchController/useWorkbenchGitCoordinator";
import { createWorkbenchRevealPathPort } from "./workbenchController/useWorkbenchTaskDebugCoordinator";
import { useWorkbenchLanguageDocumentSyncCoordinator } from "./workbenchController/useWorkbenchLanguageDocumentSyncCoordinator";
import {
  useWorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinator,
  useWorkbenchLanguageRuntimeOwnershipCoordinator,
} from "./workbenchController/useWorkbenchLanguageServerRuntimeCoordinator";
import {
  useWorkbenchLanguageRuntimeChannelRefs,
  useWorkbenchLanguageRuntimeOwnerRefs,
  useWorkbenchStaticAnalysisCoordinator,
  type WorkbenchSmartModeIntentState,
} from "./workbenchController/useWorkbenchLanguageRuntimeCoordinator";
import {
  useWorkbenchLanguageDiagnosticsSessionCoordinator,
  useWorkbenchLanguageRuntimeEventOwnerResolver,
} from "./workbenchController/useWorkbenchLanguageRuntimeSubscriptionsCoordinator";
import {
  useWorkbenchLanguageRuntimeProjectionRefBridge,
  useWorkbenchLanguageRuntimeProjectionState,
} from "./workbenchController/useWorkbenchLanguageRuntimeProjection";
import { useManagedWorkspaceIdentityOwnership } from "./workbenchController/useManagedWorkspaceIdentityOwnership";
import { useWorkspaceIdentityAuthority } from "./workbenchController/useWorkspaceIdentityAuthority";
import { useWorkspaceDirectoryExplorer } from "./workbenchController/useWorkspaceDirectoryExplorer";
import { boundedInFlightDirectoryLoadsFor } from "./workbenchController/boundedInFlightDirectoryLoads";
import { boundedPendingWorkspaceSettingsLoadsFor } from "./workbenchController/boundedPendingWorkspaceSettingsLoads";
import { useExternallyRemovedDocumentTombstones } from "./workbenchController/useExternallyRemovedDocumentTombstones";
import { useWorkbenchSettingsPersistence } from "./workbenchController/useWorkbenchSettingsPersistence";
import {
  useWorkbenchLatencyReporting,
  useWorkbenchLatencyTrackerForRoot,
} from "./workbenchController/useWorkbenchLatencyTracking";
import { useEditorSessionState } from "./useEditorSessionState";
import { DocumentSessionAuthorityLifecycleCoordinator } from "./documentSessionAuthorityLifecycleCoordinator";
import { isGitDiffDocumentPath } from "./useGitDiffWorkspace";
import { useWorkbenchDirtyCloseDecisionPort } from "./useWorkbenchDirtyCloseDecisionPort";
import { useOptionalWorkspaceTextReader } from "./useOptionalWorkspaceTextReader";
import { useActiveWorkspaceOwners } from "./useActiveWorkspaceOwners";
import { WorkspaceTrustIntentCoordinator } from "./workspaceTrustIntentCoordinator";
import { useWorkbenchWorkspacePackageGraph } from "./useWorkbenchWorkspacePackageGraph";
import { useWorkbenchIndexLifecycle } from "./useWorkbenchIndexLifecycle";
import { useWorkbenchEditorConfigCoordinator } from "./useWorkbenchEditorConfigCoordinator";
import { refreshEditorConfigAfterDocumentSave } from "./editorConfigInvalidation";
import { usePhpFrameworkSourceRegistries } from "./usePhpFrameworkSourceRegistries";
import { type ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";
import type { DocumentLifecycleWorkspaceAuthority } from "./useDocumentCloseLifecycle";
import { isSessionPathInWorkspace } from "./documentSessionState";
import { useWorkspaceStateCache } from "./useWorkspaceStateCache";
import { WorkspaceDocumentCloseCoordinator } from "./workspaceSessionSwitchLifecycle";
import { useWorkbenchNavigationState } from "./useWorkbenchNavigationState";
import { useWorkbenchClassOpen } from "./useWorkbenchClassOpen";
import { useWorkbenchQuickOpen } from "./useWorkbenchQuickOpen";
import { useWorkbenchSearchEverywhere } from "./useWorkbenchSearchEverywhere";
import { useWorkbenchSymbolPanels } from "./useWorkbenchSymbolPanels";
import { useWorkbenchDockedTextSearch } from "./useWorkbenchDockedTextSearch";
import {
  useQuickOpenPrefixDispatch,
  useQuickOpenSeededSurfaceState,
} from "./useQuickOpenPrefixDispatch";
import { usePersistCurrentWorkspaceSession } from "./useWorkbenchNavigationSessionPersistence";
import { useLanguageServerFeatureErrorReporting } from "./useLanguageServerFeatureErrorReporting";
import { useWorkbenchWorkspaceSymbols } from "./useWorkbenchWorkspaceSymbols";
import { useWorkbenchImplementationChooserState } from "./useWorkbenchLanguageNavigation";
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
import { WorkspaceRuntimeOwnerClaimRegistry } from "./workspaceRuntimeOwnerClaimRegistry";
import { useRecentNavigation } from "./useNavigationHistory";
import { useLanguageServerDocumentSyncState } from "./useLanguageServerDocumentSyncState";
import { usePhpFrameworkResolution } from "./usePhpFrameworkResolution";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import { registerActiveComposerManifestWorkspace } from "../components/composerManifestMonacoProviders";
import { registerActiveNpmManifestWorkspace } from "../components/npmManifestMonacoProviders";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
} from "./usePhpCodeActions";

import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { PhpDiagnosticsReclassificationCoordinator } from "./phpDiagnosticsReclassificationCoordinator";

import { useReplaceJavaScriptTestProblemNotices } from "./useWorkbenchNoticeStore";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import { shouldStartLanguageServer, type SmartModeGateway } from "../domain/intelligence";
import type { GitGateway } from "../domain/git";
import type { LocalHistoryGateway } from "../domain/localHistory";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { IndexProgressGateway } from "../domain/indexProgress";
import {
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import {
  type LanguageServerDocumentSyncGateway,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerGateway } from "../domain/languageServer";
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
import { renderMarkdownPreview } from "../domain/markdownPreview";
import { type LanguageServerRuntimeGateway } from "../domain/languageServerRuntime";
import { useWorkbenchControllerAgents } from "./useWorkbenchControllerAgents";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  createLegacyEditorSessionOwnerKey,
  type EditorSessionOwnerKey,
} from "../domain/editorSessionOwnerKey";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { type PhpFileOutlineGateway, type PhpFileStructureScope } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import { emptyRecentlyClosedTabs } from "../domain/recentlyClosedTabs";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type SettingsSection,
  type WorkspaceSessionViewState,
  type WorkspaceSettings,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { PackageScript } from "../domain/packageScripts";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import { recentFilesForSwitcher } from "../domain/recentFiles";
import { type EditorGroupId } from "../domain/editorGroups";
import { sortBookmarks, type Bookmark } from "../domain/bookmarks";
import type { LatencyTracker } from "../domain/latencyTracker";
import {
  type EditorDocument,
  type FileEntry,
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { documentOffsetAtEditorPosition, identifierAtEditorPosition } from "./editorPositionText";
import { useResolvedEditorCursorStore } from "./useCursorCommandAvailability";

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
  const {
    commands: languageRuntimeProjectionCommands,
    installingManagedPhpactor,
    installingManagedTypeScriptLanguageServer,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    languageServerSetupOpen,
    phpIdeReadinessVersion,
    phpTools,
    setInstallingManagedPhpactor,
    setInstallingManagedTypeScriptLanguageServer,
    setJavaScriptTypeScriptLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setLanguageServerPlan,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    setLanguageServerSetupOpen,
    setPhpTools,
  } = useWorkbenchLanguageRuntimeProjectionState();
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
  const {
    expandedPhpFilePaths,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    phpFileOutlineExpandedNodeIds,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
    phpTree,
    phpTreeExpandedNodeIds,
    phpTreeLoading,
    resetPhpOutlineState,
    setExpandedPhpFilePaths,
    setLoadingInheritedPhpFileOutlinePaths,
    setLoadingPhpFileOutlinePaths,
    setPhpFileOutlineExpandedNodeIds,
    setPhpFileOutlinesByPath,
    setPhpInheritedFileOutlinesByPath,
    setPhpTree,
    setPhpTreeExpandedNodeIds,
    setPhpTreeLoading,
  } = useWorkbenchPhpOutlineState();
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useCommitBailoutState(new Set<string>());
  const [manuallyCollapsedDirectories, setManuallyCollapsedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [loadingDirectories, setLoadingDirectories] = useState(new Set<string>());
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const editorSession = useEditorSessionState(workspaceSettings.largeFileMode);
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
    updateEditorGroups,
  } = editorSession;
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
      if (isBenignError(error)) return;

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
  const workspaceIdentityAuthority = useWorkspaceIdentityAuthority();
  const {
    ownedWorkspaceIdentityGenerationByIdRef,
    pendingWorkspaceIdentityRequestTokensRef,
    retire: retireWorkspaceIdentityAuthority,
  } = workspaceIdentityAuthority;
  const inFlightDirectoryLoadsRef = useRef(boundedInFlightDirectoryLoadsFor(workspaceFiles));
  const openFileRequestTokenRef = useRef(0);
  const openingFileFlagOwnerTokenRef = useRef<number | null>(null);
  const emptyDocumentRefreshTimeoutsRef = useRef<Set<number>>(new Set());
  const editorGitBaselineRequestTokenRef = useRef(0);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
  const phpLanguageServerAutostartAttemptsByRootRef = useRef<Record<string, number>>({});
  const manuallyStoppedPhpLanguageServerRootsRef = useRef<Set<string>>(new Set());
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
  const artisanMakePaletteOpen = !!(
    workspaceRoot &&
    artisanMakePaletteRoot &&
    workspaceRootKeysEqual(workspaceRoot, artisanMakePaletteRoot)
  );
  const openArtisanMakePalette = useCallback(() => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) return;

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
  const resolveDocumentLifecycleWorkspaceOwner = useCallback(
    (rootPath: string) =>
      resolveWorkspaceRuntimeOwner(rootPath) ??
      (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
        ? workspaceRuntimeOwnerRef.current
        : null),
    [currentWorkspaceRootRef, resolveWorkspaceRuntimeOwner, workspaceRuntimeOwnerRef],
  );
  const captureDocumentLifecycleWorkspaceAuthority = useCallback(
    (rootPath: string): DocumentLifecycleWorkspaceAuthority | null => {
      const owner = resolveDocumentLifecycleWorkspaceOwner(rootPath);
      const identity = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        workspaceGateways.identity,
        rootPath,
      );
      const claimGeneration = owner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
        : undefined;
      if (identity) {
        if (
          !owner ||
          identity.workspaceId !== owner.ownerKey ||
          typeof identity.admissionToken !== "number" ||
          typeof claimGeneration !== "number"
        ) {
          return null;
        }
        return {
          kind: "registered",
          claimGeneration,
          identity,
          owner,
          rootPath,
        };
      }
      if (typeof claimGeneration === "number") {
        return null;
      }
      if (owner && owner.ownerKey !== normalizedWorkspaceRootKey(rootPath)) {
        return null;
      }
      const editorSessionOwnerKey = currentEditorSessionOwnerKeyRef.current;
      return {
        editorSessionOwnerKey,
        kind: "legacy",
        owner,
        requestGeneration: openWorkspaceRequestTokenRef.current,
        rootPath,
      };
    },
    [
      currentEditorSessionOwnerKeyRef,
      resolveDocumentLifecycleWorkspaceOwner,
      workspaceGateways.identity,
    ],
  );
  const isDocumentLifecycleWorkspaceAuthorityCurrent = useCallback(
    (authority: DocumentLifecycleWorkspaceAuthority): boolean => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, authority.rootPath)) {
        return false;
      }
      const identity = admittedWorkspaceIdentityForRoot(
        workspaceIdentityByRootRef.current,
        workspaceGateways.identity,
        authority.rootPath,
      );
      if (authority.kind === "registered") {
        return (
          resolveDocumentLifecycleWorkspaceOwner(authority.rootPath) === authority.owner &&
          identity?.workspaceId === authority.identity.workspaceId &&
          identity.admissionToken === authority.identity.admissionToken &&
          workspaceRootKeysEqual(identity.canonicalRoot, authority.identity.canonicalRoot) &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(authority.owner.ownerKey) ===
            authority.claimGeneration
        );
      }
      return (
        !identity &&
        currentEditorSessionOwnerKeyRef.current === authority.editorSessionOwnerKey &&
        openWorkspaceRequestTokenRef.current === authority.requestGeneration &&
        (!authority.owner ||
          workspaceRuntimeOwnerClaimsRef.current.generationFor(authority.owner.ownerKey) == null)
      );
    },
    [
      currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef,
      resolveDocumentLifecycleWorkspaceOwner,
      workspaceGateways.identity,
    ],
  );
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
  const resolveWorkspaceRuntimeOwnerForDiagnosticsEvent =
    useWorkbenchLanguageRuntimeEventOwnerResolver({
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      workspaceRuntimeOwnerClaimsRef,
    });
  const {
    flushDeferredCleanup: flushDeferredWorkspaceIdentityCleanup,
    prepareBackendClosedSettlement: prepareBackendClosedWorkspaceIdentitySettlement,
    releaseOwned: releaseOwnedWorkspaceIdentity,
    withManagedLease: withManagedWorkspaceIdentityLease,
  } = useManagedWorkspaceIdentityOwnership({
    deferredCleanupIdsRef: workspaceIdentityAuthority.deferredWorkspaceIdentityCleanupIdsRef,
    identityGateway: workspaceGateways.identity,
    identityRequestTokensRef: pendingWorkspaceIdentityRequestTokensRef,
    latestAdmissionGenerationByIdRef:
      workspaceIdentityAuthority.latestWorkspaceIdentityAdmissionGenerationByIdRef,
    mountedRef: workbenchMountedRef,
    nextAdmissionGenerationRef: workspaceIdentityAuthority.workspaceIdentityAdmissionGenerationRef,
    ownedGenerationByIdRef: ownedWorkspaceIdentityGenerationByIdRef,
    ownedIdsRef: workspaceIdentityAuthority.ownedWorkspaceIdentityIdsRef,
    pendingAdmissionsRef: workspaceIdentityAuthority.pendingWorkspaceIdentityAdmissionsRef,
    releasedIdsRef: workspaceIdentityAuthority.releasedWorkspaceIdentityIdsRef,
    releaseGenerationByIdRef: workspaceIdentityAuthority.workspaceIdentityReleaseGenerationByIdRef,
    reportError,
    retireRuntimeOwnerClaim: retireWorkspaceRuntimeOwnerClaim,
    runtimeOwnerClaimsRef: workspaceRuntimeOwnerClaimsRef,
    unregisterByIdRef: workspaceIdentityAuthority.workspaceIdentityUnregisterByIdRef,
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
    if (!phpIdeReadinessSignature) return;

    if (lastPhpIdeReadinessSignatureRef.current === phpIdeReadinessSignature) return;

    lastPhpIdeReadinessSignatureRef.current = phpIdeReadinessSignature;
    languageRuntimeProjectionCommands.bumpPhpIdeReadinessVersion();
  }, [languageRuntimeProjectionCommands, phpIdeReadinessSignature]);

  useEffect(
    () => () => {
      for (const timeoutId of emptyDocumentRefreshTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }

      emptyDocumentRefreshTimeoutsRef.current.clear();
    },
    [],
  );

  useWorkbenchLanguageRuntimeProjectionRefBridge({
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef,
  });

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

  const gitDiscovery = useWorkbenchGitDiscoveryCoordinator({
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
  const {
    gitDiffDocuments,
    gitDiffLoading,
    selectedGitChange,
    gitDiffPreview,
    gitDiffRequestTokenRef,
    resetGitDiffWorkspaceState,
    clearGitDiffPreviewState,
    cancelGitDiffDocument,
    loadGitDiffDocument,
    previewGitChange,
    openGitChange,
    closeReplacedGitDiffDocumentRef,
    activeDocumentGitBaseline,
    gitActiveFileBranch,
    gitLoading,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    gitStatus,
    refreshGitStatus,
    resetGitStatusSurface,
    resolveGitRepositoryTarget,
    runGitRepositoryDiscovery,
  } = gitDiscovery;

  const agents = useWorkbenchControllerAgents({
    applyAppSettings,
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
  } = useWorkbenchLanguageDiagnosticsSessionCoordinator({
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
    resetPhpOutlineState();
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

  const {
    activateWorkspaceTab,
    beginStartupRestore,
    beginWorkspaceClose,
    clearActiveWorkspace,
    closeBookmarksPanelRef,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
    resetWorkspaceTodosRef,
    runWithIssuedWriteDrainRef,
  } = useWorkbenchWorkspaceTransitionCoordinator({
    authority: {
      currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef,
      documentSessionAuthorityLifecycle,
      workbenchMountedRef,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      ownedWorkspaceIdentityGenerationByIdRef,
      pendingWorkspaceIdentityRequestTokensRef,
      withManagedWorkspaceIdentityLease,
      workspaceCloseGenerationByRootRef,
      workspaceCloseOwnershipByKeyRef,
      workspaceCloseOwnershipGenerationRef,
      workspaceIdentityByRootRef,
      workspaceIdentityDescriptorRef,
      releaseOwnedWorkspaceIdentity,
      retireWorkspaceIdentityAuthority,
      retireWorkspaceRuntimeOwnerClaim,
      flushDeferredWorkspaceIdentityCleanup,
    },
    cache: {
      cacheCurrentWorkspaceState,
      clearWorkspaceStateCache,
      coalesceWorkspaceStateCache,
      forgetCachedWorkspaceState,
      resolveCachedWorkspaceState,
      restoreCachedWorkspaceState,
      workspaceStateCacheRef,
      filePrefetchCacheRef,
      filePrefetchTimersRef,
      resetEditorConfigCache,
      workspaceSessionRestoredRef,
      workspaceEditorViewStatesRef,
    },
    documents: {
      canonicalDocumentSaveRoot,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      documentsRef,
      editorSessionOwnerKeyForRoot,
      openFileRequestTokenRef,
      persistCurrentWorkspaceSession,
      resolveDocumentSaveOwnership,
      restorePersistedNavigationSession,
      workspaceDocumentCloseCoordinatorRef,
      setDocuments,
      updateEditorGroups,
      updateLocalPhpDiagnostics,
    },
    directory: {
      adoptCachedDirectoryProjection,
      loadDirectory,
      primeCachedDirectoryEntries,
      readTestFileIfExists,
      refreshCachedExpandedDirectories,
      resetDirectoryExplorerLifecycle,
      setEntriesByDirectory,
      setExpandedDirectories,
      setLoadingDirectories,
      setManuallyCollapsedDirectories,
      setPackageScriptsByRoot,
      workspaceFiles,
    },
    language: {
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      autoStartedLanguageServerRootRef,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      clearPhpLocalDiagnostics,
      clearPhpstanDiagnosticsForRoot,
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageRuntimeProjectionCommands,
      languageServerDiagnosticsByRootRef,
      languageServerDiagnosticsCoalescerRef,
      languageServerRuntimeStatusByRootRef,
      lastLanguageServerCrashRef,
      lastPhpFileOutlineRefreshKeyRef,
      lastPhpIdeReadinessSignatureRef,
      phpFrameworkNavigationGenerationRef,
      phpLanguageServerAutostartAttemptsByRootRef,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      resetPhpFrameworkCachesRef,
      resetPhpOutlineState,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreLanguageServerDiagnosticsForRoot,
      runPhpWorkspaceProbe,
      setLanguageServerPlan,
    },
    runtime: {
      clearIndexWorkspaceState,
      hasPhpWorkspaceByOwnerRef,
      intelligenceModeRef,
      restoreIndexRoot,
      runGitRepositoryDiscovery,
      setIntelligenceMode,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      stopProjectRuntimes,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceRuntimeRootByTabRef,
    },
    settings: {
      appSettingsRef,
      applyWorkspaceSettings,
      persistAppSettings,
      settingsGateway,
      workspaceSettingsByRoot,
      workspaceSettingsLoadByRootRef,
      workspaceSettingsSaveCoordinator,
    },
    workspace: {
      externallyRemovedDocumentRootByPathRef,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      resetActiveEditorPosition,
      workspaceDetection,
      workspaceFileChangeGateway,
      workspaceIdentityGateway: workspaceGateways.identity,
      workspaceRoot,
      setWorkspaceDescriptor,
      setWorkspaceIdentityDescriptor,
      setWorkspaceRoot,
      setWorkspaceTrust,
      workspaceTrustGateway,
      workspaceTrustRevisionByOwnerRef,
    },
    surfacePrimary: {
      resetEditorSurfaceState,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetHistory,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere,
      resetTextSearchState,
      setArtisanMakePaletteRoot,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEditorRevealTarget,
      setFileStructureOpen,
      setFileStructureScope,
      setGitBlameEnabledPaths,
      setImplementationChooser,
      setMessage,
      setNotices,
    },
    surfaceNavigation: {
      setCallHierarchyView,
      setClassOpenLoading,
      setClassOpenOpen,
      setClassOpenQuery,
      setClassOpenResults,
      setInstallingManagedPhpactor,
      setInstallingManagedTypeScriptLanguageServer,
      setPaletteOpen,
      setQuickOpenOpen,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setReferencesView,
      setSettingsOpen,
      setSidebarView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults,
    },
  });
  const editorFile = useWorkbenchEditorFileCoordinator({
    changeSignature: {
      currentWorkspaceRootRef,
      flushPendingDocumentChange,
      getPhpDocumentSyncVersion,
      indexProgress,
      languageServerFeaturesGateway,
      textSearch,
      workspaceFiles,
      workspaceTrusted,
    },
    directory: {
      cachedDirectoryNeedsRefresh,
      entriesByDirectory,
      isSessionPathInWorkspace,
      loadDirectory,
      loadingDirectories,
      manuallyCollapsedDirectories,
      revealActiveFileInTree: workspaceSettings.revealActiveFileInTree,
      setExpandedDirectories,
    },
    documentTabs: {
      appSettingsRef,
      clearGitDiffPreviewState,
      currentWorkspaceRootRef,
      emptyDocumentRefreshTimeoutsRef,
      filePrefetchCacheRef,
      filePrefetchTimersRef,
      forgetExternallyRemovedDocumentPath,
      isGitDiffDocumentPath,
      loadGitDiffDocument,
      openFileRequestTokenRef,
      openingFileFlagOwnerTokenRef,
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      resolveCurrentWorkspaceRuntimeOwner,
      setIsOpeningFile,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspacePathBelongsToRoot,
      workspaceRoot,
    },
    fileStructure: {
      fileStructureOpen,
      fileStructureScope,
      loadingInheritedPhpFileOutlinePaths,
      loadingPhpFileOutlinePaths,
      openJavaScriptTypeScriptFileStructure,
      setCallHierarchyView,
      setClassOpenOpen,
      setFileStructureInitialQuery,
      setFileStructureOpen,
      setFileStructureScope,
      setPaletteOpen,
      setQuickOpenOpen,
      setReferencesView,
      setSettingsOpen,
      setTextSearchOpen,
      setTypeHierarchyView,
      setWorkspaceSymbolsOpen,
    },
    gitChanges: {
      currentWorkspaceRootRef,
      gitWorkspace: {
        currentWorkspaceRootRef,
        gitGateway,
        prompter,
        reportError,
        setMessage,
        workspaceRoot,
      },
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      workspaceSettings,
      workspaceSettingsRef,
    },
    editorSession,
    gitDiscovery,
    openFileRef,
    phpOutline: {
      currentWorkspaceRootRef,
      expandedPhpFilePaths,
      largeSmartDocumentPolicy: workspaceSettings.largeFileMode,
      loadingPhpFileOutlinePaths,
      phpFileOutlineGateway,
      phpFileOutlinesByPath,
      phpTreeGateway,
      reportError,
      setEditorRevealTarget,
      setExpandedPhpFilePaths,
      setLoadingInheritedPhpFileOutlinePaths,
      setLoadingPhpFileOutlinePaths,
      setMessage,
      setPhpFileOutlineExpandedNodeIds,
      setPhpFileOutlinesByPath,
      setPhpInheritedFileOutlinesByPath,
      setPhpTree,
      setPhpTreeExpandedNodeIds,
      setPhpTreeLoading,
      workspaceDescriptor,
      workspaceFiles,
      workspaceRoot,
    },
    workspaceEdits: {
      currentWorkspaceRootRef,
      documentVersionsByUriRef,
      hasPhpWorkspace: !!workspaceDescriptor?.php,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      setMessage,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceRoot,
    },
  });
  const { refreshWorkspace } = editorFile.directory;
  const { openFile, openPinnedFile, pinDocument } = editorFile.documentTabs;
  const { closeGitDiffPreview, commitGitChanges, revertGitChanges } = editorFile.gitChanges;
  const { setGitAmendEnabled, setGitCommitMessage } = editorFile.gitChanges;
  const { loadPhpFileOutline, openPhpFileOutlineNode } = editorFile.phpOutline;
  const { openPhpTreeNode, refreshPhpTree } = editorFile.phpOutline;
  const { openFileStructure, openFileStructureWithInitialQuery } = editorFile.fileStructure;
  const { setFileStructureScopeMode } = editorFile.fileStructure;
  const { applyPhpLanguageServerWorkspaceEdit } = editorFile.workspaceEdits;
  const { phpChangeSignature } = editorFile;
  const documentSaveClose = useWorkbenchDocumentSaveCloseCoordinator({
    saveAuthority: {
      activeDocumentRef,
      activePath,
      canonicalDocumentSaveRoot,
      clearExternalFileConflictsForRootRef,
      currentWorkspaceRootRef,
      documentsRef,
      documentSelfWrites,
      editorGroupsRef,
      filePrefetchCacheRef,
      flushPendingDocumentChangeForRoot,
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
      hasPhpWorkspace: !!workspaceDescriptor?.php,
      hasPhpWorkspaceByOwnerRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerFeaturesGateway,
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      localHistoryGateway,
      openDocuments,
      openPathsRef,
      reportChangedDocuments,
      resolveDocumentSaveOwnership,
      resolveEditorConfigForFile,
      resolveWorkspaceRuntimeOwner,
      setActivePath,
      setDocuments,
      setOpenPaths,
      syncSavedDocumentForRoot,
      syncSavedJavaScriptTypeScriptDocumentForRoot,
      workspaceFiles,
      workspaceHasExternalFileConflictsRef,
      workspaceIdentityByRootRef,
      workspaceRoot,
      workspaceSettingsByRoot,
      workspaceSettingsRef,
      workspaceStateCacheRef,
    },
    runtimeClose: {
      agentProjects: agents.agentProjects,
      beginWorkspaceClose,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      externallyRemovedDocumentRootByPathRef,
      forgetLanguageServerRuntimeStatuses,
      forgetWorkspaceSettings: workspaceSettingsByRoot.forget,
      invalidateEditorConfigRoot,
      releaseWorkspaceTrustOwner,
      resolveCurrentWorkspaceRuntimeOwner,
      retireWorkspaceRuntimeOwnerClaim,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      setPackageScriptsByRoot,
      stopProjectRuntimes,
      workspaceFileChangeGateway,
      workspaceRuntimeLifecycleGateway,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerFor,
      workspaceRuntimeRootByTabRef,
    },
    workspaceClose: {
      appSettingsRef,
      clearActiveWorkspace,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      dirtyCloseDecisionPort: options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
      editorConfigCacheRef,
      editorGitBaselineRequestTokenRef,
      forgetCachedWorkspaceState,
      forgetLatencyTrackerForRoot,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      persistWorkspaceSession: persistCurrentWorkspaceSession,
      prepareRegisteredWorkspaceIdentitySettlement: prepareBackendClosedWorkspaceIdentitySettlement,
      prompter,
      reportError,
      resolveCachedWorkspaceState,
      unregisterWorkspace: releaseOwnedWorkspaceIdentity,
    },
    documentLifecycle: {
      activeDocument,
      activeLiveDocumentSaveCoordinator: options.activeLiveDocumentSaveCoordinator,
      cancelGitDiffDocument,
      captureWorkspaceAuthority: captureDocumentLifecycleWorkspaceAuthority,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      closeGitDiffPreview,
      documentTabSession,
      documents,
      editorSessionOwnerKey,
      editorSessionOwnerKeyForRoot,
      eslintDiagnostics: eslintDiagnosticsGateway,
      imageTabsRef,
      isGitDiffDocumentPath,
      isWorkspaceAuthorityCurrent: isDocumentLifecycleWorkspaceAuthorityCurrent,
      loadGitDiffDocument,
      markdownPreviewTabsRef,
      onDidCloseEditorPaths: options.onDidCloseEditorPaths,
      openPaths,
      openPinnedFile,
      prettierFormatting: options.prettierFormattingGateway ?? defaultPrettierFormattingGateway,
      previewPath,
      previewPathRef,
      recentlyClosedTabsRef,
      refreshEditorConfigAfterSave,
      reportErrorForActiveWorkspaceRoot,
      runEslintAnalysisOnSave,
      runPhpstanAnalysisOnSave,
      runWithIssuedWriteDrainRef,
      setEditorRevealTarget,
      setEslintDiagnosticsByRoot,
      setImageTabs,
      setMarkdownPreviewTabs,
      setMessage,
      setPhpstanDiagnosticsByRoot,
      setPreviewPath,
      setRecentlyClosedTabsVersion,
      setRestoredEditorViewStateRevision,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      updateEditorGroups,
      workspaceEditorViewStatesRef,
      workspaceOwnerRelativeFiles: workspaceOwnerFiles,
      workspaceSettings,
      workspaceTrusted,
    },
    editorGroups: {
      clearGitDiffPreviewState,
      editorGroupFocusRunner: options.editorGroupFocusRunner,
      nextEditorGroupIdRef,
    },
  });
  const { dirtyCount, externalFileConflicts, handleExternalFileChange } =
    documentSaveClose.saveAuthority;
  const { closeWorkspaceTab, quitApplication } = documentSaveClose.closeLifecycle;
  const {
    saveActiveDocument,
    canReopenClosedDocument,
    closeActiveEditorGroup,
    closeDocument,
    runCloseActiveEditorGroup,
    runCloseActiveEditorGroupSurface,
    runCloseDocument,
  } = documentSaveClose.documentLifecycle;
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
  } = documentSaveClose.editorGroups;
  const editorNavigation = useWorkbenchEditorNavigationCoordinator({
    smartMode: {
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
    },
    editorSession,
    editorFile,
    documentSaveClose,
    workspace: {
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
    },
    presentation: {
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
    },
    navigation: {
      currentNavigationLocation,
      documentOffsetAtEditorPosition,
      editorSurfaceCommandRunner,
      forgetRecentFile,
      forgetRecentLocationsForPath,
      identifierAtEditorPosition,
      navigationHistory,
      projectSymbolSearch,
      recordCurrentNavigationLocation,
      recordNavigationLocationSnapshot,
      remapRecentFile,
      remapRecentLocations,
      setNavigationHistory,
      setRecentLocationsPanelOpen,
    },
    language: {
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
    },
    persistence: {
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
    },
    git: { gitGateway, prompter, refreshGitStatus, resolveGitRepositoryTarget },
    tasks: {
      debugGateway: options.debugGateway ?? defaultDebugGateway,
      invalidateJsTestCoverageAndResults,
      isActiveDocumentJsTest,
      isActiveDocumentPhpTest,
      openDocuments,
      terminalGateway,
      options: editorNavigationTaskOptionsFor(options),
      revealPathGateway: isTauri() ? DEFAULT_REVEAL_PATH_GATEWAY : null,
    },
    fileSystem: { forgetExternallyRemovedDocumentPath, markExternallyRemovedDocumentPath },
  });
  const {
    bookmarks: bookmarkActions,
    editorDocument,
    fileOperations,
    frameworkIntelligence,
    gitHistory,
    gitPanels,
    languageNavigation,
    localHistory,
    navigationHistory: navigationHistoryActions,
    publicSurface: editorNavigationSurface,
    smartMode: smartModeActions,
    taskDebug,
    taskDebugNavigation,
    todos,
  } = editorNavigation;

  const {
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
  } = useWorkbenchCommandEffectsCoordinator({
    diagnosticObserverServices: {
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
    },
    workspaceRuntimeServices: {
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
    },
    editorActionServices: {
      bookmarkActions,
      canReopenClosedDocument,
      documentSaveClose,
      editorDocument,
      editorMenuCommandRunner: options.editorMenuCommandRunner,
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
    },
    surfaceCommandServices: {
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
    },
    taskGitServices: {
      activePackageScripts,
      commitGitChanges,
      gitDiffLoading,
      gitHistory,
      gitPanels,
      isActiveDocumentJsTest,
      isActiveDocumentPhpTest,
      jsTestExplorerScopeRunner: options.jsTestExplorerScopeRunner,
      refreshGitStatus,
      selectedGitChange,
      taskDebug,
      taskDebugNavigation,
      todos,
    },
    commandIntegrationServices: {
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
    },
    editorDocumentState: { activeDocument, activeImage, activeMarkdownPreview, activePath },
    editorSessionState: { documents, documentsRef, editorGroups, openDocumentPaths, openDocuments },
    workspaceIdentity: {
      workspaceRoot,
      workspaceDescriptor,
      workspaceIdentityDescriptor,
      workspaceIdentityDescriptorRef,
    },
    workspaceAuthority: {
      currentWorkspaceRootRef,
      workspaceRuntimeOwner,
      workspaceRuntimeOwnerRef,
      workspaceRuntimeOwnerClaimsRef,
    },
    workspaceTrustState: {
      workspaceTrust,
      workspaceTrustGateway,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    },
    workspaceSettingsState: {
      workspaceSettings,
      workspaceSettingsRef,
      workspaceSettingsSaveCoordinator,
      workspaceEditorViewStatesRef,
    },
    applicationSettings: { appSettings, appSettingsRef, applyAppSettings, persistAppSettings },
    settingsPersistence: {
      persistWorkspaceSettings,
      settingsGateway,
      hasRestoredRef,
      beginStartupRestore,
    },
    diagnosticState: {
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
      frameworkDiagnosticsByPath,
      phpLocalDiagnosticsByPath,
    },
    diagnosticCoalescers: {
      diagnosticsFlushSchedulerRef,
      languageServerDiagnosticsCoalescerRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
    },
    diagnosticGateways: {
      languageServerDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      reportLanguageServerError,
      reportJavaScriptTypeScriptLanguageServerError,
    },
    surfaceVisibility: { paletteOpen, quickOpenOpen, classOpenOpen, workspaceSymbolsOpen },
    surfaceSecondaryVisibility: {
      searchEverywhereOpen,
      fileStructureOpen,
      recentFilesSwitcherOpen,
      recentLocationsPanelOpen,
    },
    hierarchyVisibility: {
      callHierarchyView,
      typeHierarchyView,
      referencesView,
      implementationChooser,
    },
    surfacePrimarySetters: {
      setPaletteOpen,
      setQuickOpenOpen,
      setClassOpenOpen,
      setWorkspaceSymbolsOpen,
    },
    surfaceSecondarySetters: {
      setSearchEverywhereOpen,
      setFileStructureOpen,
      setRecentFilesSwitcherOpen,
      setRecentLocationsPanelOpen,
    },
    hierarchySetters: {
      setCallHierarchyView,
      setTypeHierarchyView,
      setReferencesView,
      setImplementationChooser,
    },
    phpOutlineState: {
      expandedPhpFilePaths,
      loadingInheritedPhpFileOutlinePaths,
      loadingPhpFileOutlinePaths,
      phpFileOutlinesByPath,
      phpInheritedFileOutlinesByPath,
    },
    languageRuntimeStatus: {
      languageServerPlan,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    },
    installState: {
      installingManagedPhpactor,
      installingManagedTypeScriptLanguageServer,
      phpToolGateway,
      phpTools,
    },
    navigationPersistence: {
      bottomPanelView,
      sidebarView,
      snapshotPersistedWorkspaceSession,
      persistCurrentWorkspaceSession,
    },
    runtimeSync: {
      documentSyncRuntimeSignatureRef,
      javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
      javaScriptTypeScriptIncrementalSyncRef,
      syncOpenDocument,
      syncOpenJavaScriptTypeScriptDocument,
    },
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
    ...editorNavigationSurface,
    activeDocument,
    activeImage,
    activeMarkdownPreview,
    activeDocumentGitBaseline,
    activeEditorConfig,
    activePath,
    documentSessionAuthorityRevision,
    attachEditorGroupLiveDocument,
    onActiveLiveDocumentSaveBindingChange:
      documentSaveClose.documentLifecycle.onActiveLiveDocumentSaveBindingChange,
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
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit:
      editorFile.workspaceEdits.applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    applyPhpLanguageServerWorkspaceEdit: applyPhpLanguageServerWorkspaceEdit,
    phpChangeSignature: phpChangeSignature,
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
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    closeImplementationChooser,
    closeCallHierarchy,
    closeTypeHierarchy,
    closeReferencesPanel,
    closeDocument,
    closeDocumentInEditorGroup: documentSaveClose.documentLifecycle.closeDocumentInEditorGroup,
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
    closeGitDiffPreview: closeGitDiffPreview,
    closeWorkspaceTab,
    amendGitChanges: editorFile.gitChanges.amendGitChanges,
    commitAndPushGitChanges: editorFile.gitChanges.commitAndPushGitChanges,
    commitGitChanges: commitGitChanges,
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
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    debugSession: {
      ...taskDebug.debugSession,
      latencyTracker: workspaceRoot ? latencyTrackerForRoot(workspaceRoot) : undefined,
    },
    clearEditorRevealTarget,
    closeFloatingSurface,
    bottomPanelVisible,
    bottomPanelView,
    editorRevealTarget,
    gitDiffLoading,
    gitDiffDocuments,
    gitDiffPreview,
    gitCommitMessage: editorFile.gitChanges.gitCommitMessage,
    gitCommitMessageHistory: editorFile.gitChanges.gitCommitMessageHistory,
    gitAmendEnabled: editorFile.gitChanges.gitAmendEnabled,
    includedGitChangePaths: editorFile.gitChanges.includedGitChangePaths,
    gitLoading,
    gitOperationLoading: editorFile.gitChanges.gitOperationLoading,
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
    openFile: openFile,
    openCallHierarchy,
    openCallHierarchyRow,
    openFileReferencesPanel,
    openTypeHierarchy,
    openTypeHierarchyRow,
    openReferencesPanel,
    openReferenceRow,
    openGitChange,
    openReadOnlyDocument: editorFile.documentTabs.openReadOnlyDocument,
    openFileStructure: openFileStructure,
    refreshWorkspace: refreshWorkspace,
    hasArtisan: activePackageScripts?.hasArtisan ?? false,
    artisanMakePaletteOpen,
    closeArtisanMakePalette,
    openPhpFileOutlineNode: openPhpFileOutlineNode,
    jsTestRunRequestVersion,
    ...workspaceDiscoveryVersions,
    phpTestRunRequestVersion,
    openWorkspaceSymbols,
    openPinnedFile: openPinnedFile,
    prefetchFile: editorFile.documentTabs.prefetchFile,
    cancelFilePrefetch: editorFile.documentTabs.cancelFilePrefetch,
    clearLanguageServerDiagnosticsForPath: clearLanguageServerDiagnosticsForActivePath,
    updateLocalPhpDiagnostics,
    previewFile: editorFile.documentTabs.previewFile,
    previewPath,
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
    openRecentFilesSwitcher,
    setRecentFilesSwitcherOpen,
    recentLocations,
    reorderOpenTabs,
    recentLocationsPanelOpen,
    openRecentLocationsPanel,
    setRecentLocationsPanelOpen,
    bookmarks,
    sortedBookmarks,
    isActiveDocumentGitBlameEnabled: activeDocument
      ? gitBlameEnabledPaths.has(activeDocument.path)
      : false,
    clearNotices,
    notices: effectiveNotices,
    replaceJavaScriptTestProblemNotices,
    ...taskDebug.nodeLaunchConfigurationsSurface,
    navigationHistory,
    clearLatencyMetrics,
    getLatencySnapshot,
    recordCompletionLatency,
    reportCommandError,
    reportLanguageServerError,
    previewGitChange,
    quitApplication,
    refreshPhpTree: refreshPhpTree,
    refreshGitStatus,
    revealDirectoryInTree: editorFile.directory.revealDirectoryInTree,
    retryDirectory,
    revertGitChanges: revertGitChanges,
    saveActiveDocument,
    saveWorkbenchSettings,
    setActivePath: editorFile.documentTabs.activateDocument,
    setPaletteOpen,
    setClassOpenOpen,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setGitAmendEnabled: setGitAmendEnabled,
    setGitCommitMessage: setGitCommitMessage,
    setClassOpenQuery,
    setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery,
    setSettingsOpen,
    ...textSearchWorkbench,
    setLanguageServerSetupOpen,
    settingsInitialSection,
    setFileStructureOpen,
    setFileStructureScopeMode: setFileStructureScopeMode,
    pinDocument: pinDocument,
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
    toggleGitChangeIncluded: editorFile.gitChanges.toggleGitChangeIncluded,
    loadGitFileHunks: editorFile.gitChanges.loadGitFileHunks,
    stageGitChanges: editorFile.gitChanges.stageGitChanges,
    stageGitHunk: editorFile.gitChanges.stageGitHunk,
    unstageGitChanges: editorFile.gitChanges.unstageGitChanges,
    unstageGitHunk: editorFile.gitChanges.unstageGitHunk,
    canRevertGitChange: editorFile.gitChanges.canRevertGitChange,
    revertGitHunk: editorFile.gitChanges.revertGitHunk,
    togglePhpFileOutline: editorFile.phpOutline.togglePhpFileOutline,
    togglePhpFileOutlineNode: editorFile.phpOutline.togglePhpFileOutlineNode,
    togglePhpTreeNode: editorFile.phpOutline.togglePhpTreeNode,
    agentModeActive: agents.agentModeActive,
    agentWorkbench: agents.agentWorkbench,
    toggleSmartMode,
    toggleWorkspaceTrust,
    activeEditorPosition,
    updateActiveEditorPosition,
    updateEditorViewState,
    updateEditorGroupViewState,
    openPhpTreeNode: openPhpTreeNode,
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
