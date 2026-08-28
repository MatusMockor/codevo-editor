import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
export type {
  WorkbenchControllerOptions,
  WorkbenchWorkspaceGateways,
} from "./workbenchControllerContracts";
export { ownerDocumentSavePipelineContextFor } from "./workbenchController/documentSaveOwnerContext";
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
import { useWorkbenchControllerAuthorityCoordinator } from "./workbenchController/useWorkbenchControllerAuthorityCoordinator";
import {
  useWorkbenchControllerPresentation,
  useWorkbenchControllerRuntimePresentation,
} from "./workbenchController/useWorkbenchControllerPresentation";
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
import { useWorkbenchLanguageDiagnosticsSessionCoordinator } from "./workbenchController/useWorkbenchLanguageRuntimeSubscriptionsCoordinator";
import { useWorkbenchLanguageRuntimeProjectionState } from "./workbenchController/useWorkbenchLanguageRuntimeProjection";
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
  createWorkspaceSettingsByRootSnapshot,
  type WorkspaceSettingsByRootSnapshot,
} from "./workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";
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
import { type SmartModeGateway } from "../domain/intelligence";
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
import { type EditorGroupId } from "../domain/editorGroups";
import { type Bookmark } from "../domain/bookmarks";
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
  const phpFrameworkResolution = usePhpFrameworkResolution({ workspaceDescriptor });
  const { phpFrameworkIntelligence, phpFrameworkRuntimeContext } = phpFrameworkResolution;
  const hasSymfonyFramework = phpFrameworkRuntimeContext.hasProvider("symfony");
  const [workspaceTrust, setWorkspaceTrust] = useState(null as WorkspaceTrustState | null);
  const workspaceTrusted = workspaceTrust ? workspaceTrust.trusted : false;
  const languageRuntimeProjection = useWorkbenchLanguageRuntimeProjectionState();
  const {
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
  } = languageRuntimeProjection;
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
  const workspacePackageGraph = useWorkbenchWorkspacePackageGraph(
    workspaceDescriptor,
    hasSymfonyFramework,
    options.workspaceSourceDiscoveryGateway,
    workspaceRuntimeOwner,
  );
  const {
    handleWorkspaceDiscoveryFileChange,
    hasNetteApplicationFramework,
    invalidateJsTestCoverageAndResults,
    ...workspaceDiscoveryVersions
  } = workspacePackageGraph;
  const phpOutlineState = useWorkbenchPhpOutlineState();
  const { expandedPhpFilePaths, loadingPhpFileOutlinePaths, phpFileOutlinesByPath } =
    phpOutlineState;
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
  const quickOpenSeededSurface = useQuickOpenSeededSurfaceState();
  const { setPaletteOpen } = quickOpenSeededSurface;
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
  const indexLifecycle = useWorkbenchIndexLifecycle({
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
  const { indexProgress, startInitialIndexScan } = indexLifecycle;
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
  const doubleShiftDetectorRef = useRef(createDoubleShiftDetector({ windowMs: 300 }));
  const controllerAuthority = useWorkbenchControllerAuthorityCoordinator({
    activateDocumentSessionAuthority,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    deactivateDocumentSessionAuthority,
    identityGateway: workspaceGateways.identity,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    javaScriptTypeScriptTrustAutostartRef,
    languageServerRuntimeStatusByRootRef,
    openWorkspaceRequestTokenRef,
    reportError,
    resolveWorkspaceRuntimeOwner,
    workbenchMountedRef,
    workspaceIdentityAuthority,
    workspaceRuntimeOwnerGenerationForIndexRef,
    workspaceRuntimeOwnerRef,
    workspaceSettingsByRoot,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  });
  const {
    canonicalDocumentSaveRoot,
    captureDocumentLifecycleWorkspaceAuthority,
    documentSelfWrites,
    documentSessionAuthorityLifecycle,
    isDocumentLifecycleWorkspaceAuthorityCurrent,
    releaseWorkspaceTrustOwner,
    resolveDocumentSaveOwnership,
    resolveWorkspaceRuntimeOwnerForDiagnosticsEvent,
    resolveWorkspaceSettingsForDiagnosticsRoot,
    retireWorkspaceRuntimeOwnerClaim,
    workspaceIdentityByRootRef,
    workspaceRuntimeOwnerClaimsRef,
  } = controllerAuthority;
  const {
    flushDeferredCleanup: flushDeferredWorkspaceIdentityCleanup,
    prepareBackendClosedSettlement: prepareBackendClosedWorkspaceIdentitySettlement,
    releaseOwned: releaseOwnedWorkspaceIdentity,
    withManagedLease: withManagedWorkspaceIdentityLease,
  } = controllerAuthority.managedIdentity;
  const workspaceCloseGenerationByRootRef = useRef<Record<string, number>>({});
  const workspaceCloseOwnershipGenerationRef = useRef(0);
  const workspaceCloseOwnershipByKeyRef = useRef<Record<string, number>>({});
  const clearExternalFileConflictsForRootRef = useRef<(root: string) => void>(() => {});
  const workspaceHasExternalFileConflictsRef = useRef<(root: string) => boolean>(() => false);
  const readEditorConfigTextFile = useCallback(
    (path: string) => workspaceFiles.readTextFile(path),
    [workspaceFiles],
  );
  const editorConfig = useWorkbenchEditorConfigCoordinator({
    activeDocumentPath: activeDocument?.path ?? null,
    activeDocumentRef,
    currentWorkspaceRootRef,
    readTextFile: readEditorConfigTextFile,
    resolveWorkspaceRuntimeOwner,
    workspaceRoot,
  });
  const { refreshRoot: refreshEditorConfigRoot } = editorConfig;
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

  const navigationState = useWorkbenchNavigationState({ cursorStore: editorCursorStore });
  const {
    activeEditorPositionRef,
    navigationHistory,
    recentFiles,
    setEditorRevealTarget,
    setRecentFiles,
    setRecentFilesSwitcherOpen,
    setRecentLocations,
    setRecentLocationsPanelOpen,
  } = navigationState;
  const editorPresentation = useWorkbenchEditorPresentation({
    activeDocument,
    documents,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    workspaceDescriptor,
    workspaceRoot,
  });
  const { isActiveDocumentJsTest, isActiveDocumentPhpTest, openDocuments } = editorPresentation;
  useWorkbenchControllerRuntimePresentation({
    bumpPhpIdeReadinessVersion: languageRuntimeProjection.commands.bumpPhpIdeReadinessVersion,
    emptyDocumentRefreshTimeoutsRef,
    hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
    indexProgress: indexProgress,
    intelligenceMode,
    intelligenceModeRef,
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerRuntimeStatus: languageServerRuntimeStatus,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef,
    lastPhpIdeReadinessSignatureRef,
    phpFrameworkProviderSignature: phpFrameworkIntelligence.providerSignature,
    workspaceRoot,
    workspaceTrusted,
  });

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
    setEditorRevealTarget: setEditorRevealTarget,
    setMessage,
  });
  const { resetTextSearchState, setTextSearchOpen } = textSearchWorkbench;
  const languageErrorReporting = useLanguageServerFeatureErrorReporting({
    currentWorkspaceRootRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    lastLanguageServerCrashRef,
    setMessage,
    setNotices,
    syncedDocumentPathsRef,
  });
  const { reportLanguageServerError, reportLanguageServerErrorForActiveWorkspaceRoot } =
    languageErrorReporting;
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
  const directoryExplorer = useWorkspaceDirectoryExplorer({
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
  const quickOpen = useWorkbenchQuickOpen({
    activePath,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    recentFiles: recentFiles,
    setMessage,
    workspaceRoot,
    ...quickOpenPrefixDispatch,
  });
  const { setQuickOpenOpen } = quickOpen;
  const [floatingSurfaceActivationVersion, setFloatingSurfaceActivationVersion] = useState(0);
  const markFloatingSurfaceActivated = useCallback(() => {
    setFloatingSurfaceActivationVersion((current) => current + 1);
  }, []);

  const classOpen = useWorkbenchClassOpen({
    cancelJavaScriptTypeScriptLanguageServerRequest,
    workspaceRoot,
    currentWorkspaceRootRef,
    intelligenceMode,
    projectSymbolSearch,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus: languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    reportError,
    resolveWorkspaceRuntimeOwner,
    setMessage,
  });
  const { canSearchClassOpenSymbols, setClassOpenOpen } = classOpen;

  const workspaceSymbols = useWorkbenchWorkspaceSymbols({
    workspaceRoot,
    workspaceOwner: workspaceRuntimeOwner,
    canSearchClassOpenSymbols: canSearchClassOpenSymbols,
    searchClassOpenSymbols: classOpen.searchClassOpenSymbols,
    reportError,
    setMessage,
  });
  const { setWorkspaceSymbolsOpen, setWorkspaceSymbolsQuery } = workspaceSymbols;

  const searchEverywhere = useWorkbenchSearchEverywhere({
    canSearchClassOpenSymbols: canSearchClassOpenSymbols,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    searchClassOpenSymbols: classOpen.searchClassOpenSymbols,
    workspaceRoot,
  });
  const { setSearchEverywhereOpen } = searchEverywhere;

  const latencyReporting = useWorkbenchLatencyReporting({
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
    indexHealthLogs: indexLifecycle.indexHealthLogs,
    indexProgress: indexProgress,
    manuallyCollapsedDirectories,
    navigationHistory: navigationHistory,
    recentFiles: recentFiles,
    recentLocations: navigationState.recentLocations,
    restoreCachedIndexState: indexLifecycle.restoreCachedIndexState,
    restoreEditorSurface,
    restoreHistory: navigationState.restoreHistory,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setEntriesByDirectory,
    setExpandedDirectories,
    setManuallyCollapsedDirectories,
    setRecentFiles: setRecentFiles,
    setRecentLocations: setRecentLocations,
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

  const recentNavigation = useRecentNavigation({
    activeDocument,
    activeEditorPositionRef: activeEditorPositionRef,
    currentWorkspaceRootRef,
    documentsRef,
    resolveCurrentWorkspaceRuntimeOwner,
    setClassOpenOpen: setClassOpenOpen,
    setNavigationHistory: navigationState.setNavigationHistory,
    setQuickOpenOpen: setQuickOpenOpen,
    setRecentFiles: setRecentFiles,
    setRecentFilesSwitcherOpen: setRecentFilesSwitcherOpen,
    setRecentLocations: setRecentLocations,
    setRecentLocationsPanelOpen: setRecentLocationsPanelOpen,
    setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
  });
  const { recordCurrentNavigationLocation } = recentNavigation;

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
    setBottomPanelView,
    setBottomPanelVisible,
    options,
    openFileRef,
    openGitChange,
    editorSessionOwnerKey,
    gitGateway,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    openDocuments: openDocuments,
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
    terminalGateway,
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
      reportLanguageServerErrorForActiveWorkspaceRoot:
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
    activeEditorPositionRef: activeEditorPositionRef,
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
    phpOutlineState.resetPhpOutlineState();
    classOpen.setClassOpenResults([]);
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
      shouldAutoStartJavaScriptTypeScriptLanguageServer:
        editorPresentation.shouldAutoStartJavaScriptTypeScriptLanguageServer,
      phpLanguageServerAutostartRetryVersion,
      languageServerPlan: languageServerPlan,
      javaScriptTypeScriptLanguageServerPlan:
        languageRuntimeProjection.javaScriptTypeScriptLanguageServerPlan,
      languageServerRuntimeStatus: languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
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
      setPhpTools: languageRuntimeProjection.setPhpTools,
      setLanguageServerPlan: languageRuntimeProjection.setLanguageServerPlan,
      setJavaScriptTypeScriptLanguageServerPlan:
        languageRuntimeProjection.setJavaScriptTypeScriptLanguageServerPlan,
      setLanguageServerRuntimeStatus: languageRuntimeProjection.setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot:
        languageRuntimeProjection.setLanguageServerRuntimeStatusRoot,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus:
        languageRuntimeProjection.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        languageRuntimeProjection.setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
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
      reportLanguageServerCrash: languageErrorReporting.reportLanguageServerCrash,
      reportLanguageServerError: reportLanguageServerError,
      reportLanguageServerErrorForActiveWorkspaceRoot:
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
      activeEditorConfigRef: editorConfig.activeEditorConfigRef,
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      currentWorkspaceRootRef,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
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
      languageServerRuntimeStatus: languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
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
      reportLanguageServerError: reportLanguageServerError,
      reportLanguageServerErrorForActiveWorkspaceRoot:
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
    activeEditorPositionRef: activeEditorPositionRef,
    cancelJavaScriptTypeScriptLanguageServerRequest,
    workspaceRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus: languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
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

  const workspaceTransition = useWorkbenchWorkspaceTransitionCoordinator({
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
      resetEditorConfigCache: editorConfig.reset,
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
      adoptCachedDirectoryProjection: directoryExplorer.adoptCachedDirectoryProjection,
      loadDirectory: directoryExplorer.loadDirectory,
      primeCachedDirectoryEntries: directoryExplorer.primeCachedDirectoryEntries,
      readTestFileIfExists,
      refreshCachedExpandedDirectories: directoryExplorer.refreshCachedExpandedDirectories,
      resetDirectoryExplorerLifecycle: directoryExplorer.resetDirectoryExplorerLifecycle,
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
      languageRuntimeProjectionCommands: languageRuntimeProjection.commands,
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
      resetPhpOutlineState: phpOutlineState.resetPhpOutlineState,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreLanguageServerDiagnosticsForRoot,
      runPhpWorkspaceProbe,
      setLanguageServerPlan: languageRuntimeProjection.setLanguageServerPlan,
    },
    runtime: {
      clearIndexWorkspaceState: indexLifecycle.clearIndexWorkspaceState,
      hasPhpWorkspaceByOwnerRef,
      intelligenceModeRef,
      restoreIndexRoot: indexLifecycle.restoreIndexRoot,
      runGitRepositoryDiscovery,
      setIntelligenceMode,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan: startInitialIndexScan,
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
      resetActiveEditorPosition: navigationState.resetActiveEditorPosition,
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
      resetHistory: navigationState.resetHistory,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere: searchEverywhere.resetSearchEverywhere,
      resetTextSearchState,
      setArtisanMakePaletteRoot,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEditorRevealTarget: setEditorRevealTarget,
      setFileStructureOpen,
      setFileStructureScope,
      setGitBlameEnabledPaths,
      setImplementationChooser,
      setMessage,
      setNotices,
    },
    surfaceNavigation: {
      setCallHierarchyView,
      setClassOpenLoading: classOpen.setClassOpenLoading,
      setClassOpenOpen: setClassOpenOpen,
      setClassOpenQuery: classOpen.setClassOpenQuery,
      setClassOpenResults: classOpen.setClassOpenResults,
      setInstallingManagedPhpactor: languageRuntimeProjection.setInstallingManagedPhpactor,
      setInstallingManagedTypeScriptLanguageServer:
        languageRuntimeProjection.setInstallingManagedTypeScriptLanguageServer,
      setPaletteOpen: setPaletteOpen,
      setQuickOpenOpen: setQuickOpenOpen,
      setRecentFiles: setRecentFiles,
      setRecentFilesSwitcherOpen: setRecentFilesSwitcherOpen,
      setRecentLocations: setRecentLocations,
      setRecentLocationsPanelOpen: setRecentLocationsPanelOpen,
      setReferencesView,
      setSettingsOpen,
      setSidebarView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading: workspaceSymbols.setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery: setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults: workspaceSymbols.setWorkspaceSymbolsResults,
    },
  });
  const editorFile = useWorkbenchEditorFileCoordinator({
    changeSignature: {
      currentWorkspaceRootRef,
      flushPendingDocumentChange,
      getPhpDocumentSyncVersion,
      indexProgress: indexProgress,
      languageServerFeaturesGateway,
      textSearch,
      workspaceFiles,
      workspaceTrusted,
    },
    directory: {
      cachedDirectoryNeedsRefresh: directoryExplorer.cachedDirectoryNeedsRefresh,
      entriesByDirectory,
      isSessionPathInWorkspace,
      loadDirectory: directoryExplorer.loadDirectory,
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
      recordCurrentNavigationLocation: recordCurrentNavigationLocation,
      recordRecentFile: recentNavigation.recordRecentFile,
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
      loadingInheritedPhpFileOutlinePaths: phpOutlineState.loadingInheritedPhpFileOutlinePaths,
      loadingPhpFileOutlinePaths: loadingPhpFileOutlinePaths,
      openJavaScriptTypeScriptFileStructure,
      setCallHierarchyView,
      setClassOpenOpen: setClassOpenOpen,
      setFileStructureInitialQuery: quickOpenSeededSurface.setFileStructureInitialQuery,
      setFileStructureOpen,
      setFileStructureScope,
      setPaletteOpen: setPaletteOpen,
      setQuickOpenOpen: setQuickOpenOpen,
      setReferencesView,
      setSettingsOpen,
      setTextSearchOpen,
      setTypeHierarchyView,
      setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
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
      expandedPhpFilePaths: expandedPhpFilePaths,
      largeSmartDocumentPolicy: workspaceSettings.largeFileMode,
      loadingPhpFileOutlinePaths: loadingPhpFileOutlinePaths,
      phpFileOutlineGateway,
      phpFileOutlinesByPath: phpFileOutlinesByPath,
      phpTreeGateway,
      reportError,
      setEditorRevealTarget: setEditorRevealTarget,
      setExpandedPhpFilePaths: phpOutlineState.setExpandedPhpFilePaths,
      setLoadingInheritedPhpFileOutlinePaths:
        phpOutlineState.setLoadingInheritedPhpFileOutlinePaths,
      setLoadingPhpFileOutlinePaths: phpOutlineState.setLoadingPhpFileOutlinePaths,
      setMessage,
      setPhpFileOutlineExpandedNodeIds: phpOutlineState.setPhpFileOutlineExpandedNodeIds,
      setPhpFileOutlinesByPath: phpOutlineState.setPhpFileOutlinesByPath,
      setPhpInheritedFileOutlinesByPath: phpOutlineState.setPhpInheritedFileOutlinesByPath,
      setPhpTree: phpOutlineState.setPhpTree,
      setPhpTreeExpandedNodeIds: phpOutlineState.setPhpTreeExpandedNodeIds,
      setPhpTreeLoading: phpOutlineState.setPhpTreeLoading,
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
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus: languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
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
      openDocuments: openDocuments,
      openPathsRef,
      reportChangedDocuments,
      resolveDocumentSaveOwnership,
      resolveEditorConfigForFile: editorConfig.resolveForFile,
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
      beginWorkspaceClose: workspaceTransition.beginWorkspaceClose,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      externallyRemovedDocumentRootByPathRef,
      forgetLanguageServerRuntimeStatuses,
      forgetWorkspaceSettings: workspaceSettingsByRoot.forget,
      invalidateEditorConfigRoot: editorConfig.invalidateRoot,
      releaseWorkspaceTrustOwner,
      resolveCurrentWorkspaceRuntimeOwner,
      retireWorkspaceRuntimeOwnerClaim,
      setJavaScriptTypeScriptLanguageServerRuntimeStatus:
        languageRuntimeProjection.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        languageRuntimeProjection.setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus: languageRuntimeProjection.setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot:
        languageRuntimeProjection.setLanguageServerRuntimeStatusRoot,
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
      clearActiveWorkspace: workspaceTransition.clearActiveWorkspace,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      dirtyCloseDecisionPort: options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
      editorConfigCacheRef: editorConfig.editorConfigCacheRef,
      editorGitBaselineRequestTokenRef,
      forgetCachedWorkspaceState,
      forgetLatencyTrackerForRoot: latencyReporting.forgetLatencyTrackerForRoot,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath: workspaceTransition.openWorkspacePath,
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
      runWithIssuedWriteDrainRef: workspaceTransition.runWithIssuedWriteDrainRef,
      setEditorRevealTarget: setEditorRevealTarget,
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
      clearWorkspaceIndex: indexLifecycle.clearWorkspaceIndex,
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
      startInitialIndexScan: startInitialIndexScan,
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
      activeEditorPositionRef: activeEditorPositionRef,
      bookmarks,
      closeBookmarksPanelRef: workspaceTransition.closeBookmarksPanelRef,
      markdownPreviewRenderer,
      noticesRef,
      openMarkdownPreviews: editorPresentation.openMarkdownPreviews,
      openSymbolPanelNavigationTargetRef,
      resetWorkspaceTodosRef: workspaceTransition.resetWorkspaceTodosRef,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setClassOpenOpen: setClassOpenOpen,
      setEditorRevealTarget: setEditorRevealTarget,
      setEntriesByDirectory,
      setExpandedDirectories,
      setGitBlameEnabledPaths,
      setImplementationChooser,
      setJsTestRunRequestVersion,
      setManuallyCollapsedDirectories,
      setMessage,
      setNotices,
      setPhpTestRunRequestVersion,
      setQuickOpenOpen: setQuickOpenOpen,
      setRecentFilesSwitcherOpen: setRecentFilesSwitcherOpen,
      setSearchEverywhereOpen: setSearchEverywhereOpen,
      setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
      sidebarView,
    },
    navigation: {
      currentNavigationLocation: recentNavigation.currentNavigationLocation,
      documentOffsetAtEditorPosition,
      editorSurfaceCommandRunner,
      forgetRecentFile: recentNavigation.forgetRecentFile,
      forgetRecentLocationsForPath: recentNavigation.forgetRecentLocationsForPath,
      identifierAtEditorPosition,
      navigationHistory: navigationHistory,
      projectSymbolSearch,
      recordCurrentNavigationLocation: recordCurrentNavigationLocation,
      recordNavigationLocationSnapshot: recentNavigation.recordNavigationLocationSnapshot,
      remapRecentFile: recentNavigation.remapRecentFile,
      remapRecentLocations: recentNavigation.remapRecentLocations,
      setNavigationHistory: navigationState.setNavigationHistory,
      setRecentLocationsPanelOpen: setRecentLocationsPanelOpen,
    },
    language: {
      activePhpFrameworkProviders: phpFrameworkResolution.activePhpFrameworkProviders,
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
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerDiagnosticsByPath,
      languageServerDiagnosticsByRootRef,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus: languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
      latencyTrackerForRoot,
      phpClassSourcePathCacheRef,
      phpFrameworkBindingCacheRef,
      phpFrameworkIntelligence: phpFrameworkIntelligence,
      phpFrameworkNavigationGenerationRef,
      phpFrameworkRuntimeContext: phpFrameworkRuntimeContext,
      phpLocalDiagnosticsByPath,
      readTestFileIfExists,
      reclassifyPhpLanguageServerDiagnosticsForRootRef,
      reportLanguageServerErrorForActiveWorkspaceRoot:
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
      isActiveDocumentJsTest: isActiveDocumentJsTest,
      isActiveDocumentPhpTest: isActiveDocumentPhpTest,
      openDocuments: openDocuments,
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

  const commandEffects = useWorkbenchCommandEffectsCoordinator({
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
      activateWorkspaceTab: workspaceTransition.activateWorkspaceTab,
      autoStartedLanguageServerRootRef,
      clearWorkspaceIndex: indexLifecycle.clearWorkspaceIndex,
      frameworkIntelligence,
      handleWorkspaceDiscoveryFileChange,
      indexProgress: indexProgress,
      intelligenceMode,
      intelligenceModeRef,
      isLanguageServerActiveForWorkspace,
      languageServerSetupOpen: languageRuntimeProjection.languageServerSetupOpen,
      openWorkspace: workspaceTransition.openWorkspace,
      openWorkspacePath: workspaceTransition.openWorkspacePath,
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
      setInstallingManagedTypeScriptLanguageServer:
        languageRuntimeProjection.setInstallingManagedTypeScriptLanguageServer,
      setIntelligenceMode,
      setLanguageServerSetupOpen: languageRuntimeProjection.setLanguageServerSetupOpen,
      setWorkspaceSymbolsQuery: setWorkspaceSymbolsQuery,
      setWorkspaceTrust,
      smartModeActions,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startHardReindex: indexLifecycle.startHardReindex,
      startIndexScan: indexLifecycle.startIndexScan,
      startInitialIndexScan: startInitialIndexScan,
      startLanguageServer,
      startPhpReindex: indexLifecycle.startPhpReindex,
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
      navigationHistory: navigationHistory,
      navigationHistoryActions,
      refreshEditorConfigRoot: refreshEditorConfigRoot,
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
      openCommandPaletteWithInitialQuery: quickOpenSeededSurface.openCommandPaletteWithInitialQuery,
      openFileReferencesPanel,
      openRecentFilesSwitcher: recentNavigation.openRecentFilesSwitcher,
      openRecentLocationsPanel: recentNavigation.openRecentLocationsPanel,
      openReferencesPanel,
      openTypeHierarchy,
      quitApplication,
      resetSearchEverywhere: searchEverywhere.resetSearchEverywhere,
      searchEverywhereModelFor: searchEverywhere.searchEverywhereModelFor,
      setInstallingManagedPhpactor: languageRuntimeProjection.setInstallingManagedPhpactor,
      setMessage,
      setNotices,
      setPhpTools: languageRuntimeProjection.setPhpTools,
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
      isActiveDocumentJsTest: isActiveDocumentJsTest,
      isActiveDocumentPhpTest: isActiveDocumentPhpTest,
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
      canSearchClassOpenSymbols: canSearchClassOpenSymbols,
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
    editorSessionState: {
      documents,
      documentsRef,
      editorGroups,
      openDocumentPaths: editorPresentation.openDocumentPaths,
      openDocuments: openDocuments,
    },
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
      beginStartupRestore: workspaceTransition.beginStartupRestore,
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
      reportLanguageServerError: reportLanguageServerError,
      reportJavaScriptTypeScriptLanguageServerError,
    },
    surfaceVisibility: {
      paletteOpen: quickOpenSeededSurface.paletteOpen,
      quickOpenOpen: quickOpen.quickOpenOpen,
      classOpenOpen: classOpen.classOpenOpen,
      workspaceSymbolsOpen: workspaceSymbols.workspaceSymbolsOpen,
    },
    surfaceSecondaryVisibility: {
      searchEverywhereOpen: searchEverywhere.searchEverywhereOpen,
      fileStructureOpen,
      recentFilesSwitcherOpen: navigationState.recentFilesSwitcherOpen,
      recentLocationsPanelOpen: navigationState.recentLocationsPanelOpen,
    },
    hierarchyVisibility: {
      callHierarchyView,
      typeHierarchyView,
      referencesView,
      implementationChooser,
    },
    surfacePrimarySetters: {
      setPaletteOpen: setPaletteOpen,
      setQuickOpenOpen: setQuickOpenOpen,
      setClassOpenOpen: setClassOpenOpen,
      setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
    },
    surfaceSecondarySetters: {
      setSearchEverywhereOpen: setSearchEverywhereOpen,
      setFileStructureOpen,
      setRecentFilesSwitcherOpen: setRecentFilesSwitcherOpen,
      setRecentLocationsPanelOpen: setRecentLocationsPanelOpen,
    },
    hierarchySetters: {
      setCallHierarchyView,
      setTypeHierarchyView,
      setReferencesView,
      setImplementationChooser,
    },
    phpOutlineState: {
      expandedPhpFilePaths: expandedPhpFilePaths,
      loadingInheritedPhpFileOutlinePaths: phpOutlineState.loadingInheritedPhpFileOutlinePaths,
      loadingPhpFileOutlinePaths: loadingPhpFileOutlinePaths,
      phpFileOutlinesByPath: phpFileOutlinesByPath,
      phpInheritedFileOutlinesByPath: phpOutlineState.phpInheritedFileOutlinesByPath,
    },
    languageRuntimeStatus: {
      languageServerPlan: languageServerPlan,
      languageServerRuntimeStatus: languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    },
    installState: {
      installingManagedPhpactor: languageRuntimeProjection.installingManagedPhpactor,
      installingManagedTypeScriptLanguageServer:
        languageRuntimeProjection.installingManagedTypeScriptLanguageServer,
      phpToolGateway,
      phpTools: languageRuntimeProjection.phpTools,
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

  const presentation = useWorkbenchControllerPresentation({
    activeGroupId,
    activePath,
    bookmarks,
    clearLanguageServerDiagnosticsForPath,
    editorSessionOwnerKeyForRoot,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    recentFiles: recentFiles,
    reportErrorForActiveWorkspaceRoot,
    setCallHierarchyView,
    setImplementationChooser,
    setNotices,
    setReferencesView,
    setTypeHierarchyView,
    workspaceEditorViewStatesRef,
    workspaceRoot,
    workspaceRuntimeOwner,
  });

  return {
    ...editorNavigationSurface,
    activeDocument,
    activeImage,
    activeMarkdownPreview,
    activeDocumentGitBaseline,
    activeEditorConfig: editorConfig.activeEditorConfig,
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
    activateWorkspaceTab: workspaceTransition.activateWorkspaceTab,
    callHierarchyView,
    typeHierarchyView,
    referencesView,
    classOpenLoading: classOpen.classOpenLoading,
    classOpenOpen: classOpen.classOpenOpen,
    classOpenQuery: classOpen.classOpenQuery,
    classOpenResults: classOpen.classOpenResults,
    workspaceSymbolsLoading: workspaceSymbols.workspaceSymbolsLoading,
    workspaceSymbolsOpen: workspaceSymbols.workspaceSymbolsOpen,
    workspaceSymbolsQuery: workspaceSymbols.workspaceSymbolsQuery,
    workspaceSymbolsResults: workspaceSymbols.workspaceSymbolsResults,
    searchEverywhereOpen: searchEverywhere.searchEverywhereOpen,
    searchEverywhereQuery: searchEverywhere.searchEverywhereQuery,
    searchEverywhereLoading: searchEverywhere.searchEverywhereLoading,
    searchEverywhereModel: commandEffects.searchEverywhereModel,
    openSearchEverywhere: commandEffects.openSearchEverywhere,
    setSearchEverywhereOpen: setSearchEverywhereOpen,
    setSearchEverywhereQuery: searchEverywhere.setSearchEverywhereQuery,
    closeImplementationChooser: presentation.closeImplementationChooser,
    closeCallHierarchy: presentation.closeCallHierarchy,
    closeTypeHierarchy: presentation.closeTypeHierarchy,
    closeReferencesPanel: presentation.closeReferencesPanel,
    closeDocument,
    closeDocumentInEditorGroup: documentSaveClose.documentLifecycle.closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    focusNextEditorGroup: presentation.focusNextEditorGroup,
    focusPreviousEditorGroup: presentation.focusPreviousEditorGroup,
    moveActiveTabToNextGroup: presentation.moveActiveTabToNextGroup,
    moveActiveTabToPreviousGroup: presentation.moveActiveTabToPreviousGroup,
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
    commands: commandEffects.commandRegistry.list(),
    commandPaletteInitialQuery: quickOpenSeededSurface.commandPaletteInitialQuery,
    runCommand: commandEffects.runCommand,
    diagnosticsSummary: commandEffects.diagnosticsSummary,
    dirtyCount,
    externalFileConflictCount: externalFileConflicts.conflictCount,
    externalFileConflictState: externalFileConflicts.activeState,
    handleExternalFileConflictAction: externalFileConflicts.action,
    closeExternalFileCompare: externalFileConflicts.closeCompare,
    entriesByDirectory,
    expandedDirectories,
    failedDirectories: directoryExplorer.failedDirectories,
    expandedPhpFilePaths: expandedPhpFilePaths,
    fileStructureCanIncludeInheritedMembers: commandEffects.fileStructureCanIncludeInheritedMembers,
    fileStructureInitialQuery: quickOpenSeededSurface.fileStructureInitialQuery,
    fileStructureLoading: commandEffects.fileStructureLoading,
    fileStructureOutline: commandEffects.fileStructureOutline,
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
    isActiveDocumentJsTest: isActiveDocumentJsTest,
    isActiveDocumentPhpTest: isActiveDocumentPhpTest,
    debugSession: {
      ...taskDebug.debugSession,
      latencyTracker: workspaceRoot ? latencyTrackerForRoot(workspaceRoot) : undefined,
    },
    clearEditorRevealTarget: navigationState.clearEditorRevealTarget,
    closeFloatingSurface: commandEffects.closeFloatingSurface,
    bottomPanelVisible,
    bottomPanelView,
    editorRevealTarget: navigationState.editorRevealTarget,
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
    indexHealthLogs: indexLifecycle.indexHealthLogs,
    indexProgress,
    intelligenceMode,
    activeFrameworkActivityLabel: phpFrameworkResolution.activeFrameworkActivityLabel,
    hasNetteApplicationFramework,
    hasSymfonyFramework,
    implementationChooser,
    languageServerDiagnosticsByPath: commandEffects.mergedLanguageServerDiagnosticsByPath,
    loadingDirectories,
    loadingPhpFileOutlinePaths: loadingPhpFileOutlinePaths,
    javaScriptTypeScriptLanguageServerPlan:
      languageRuntimeProjection.javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    languageServerPlan: languageServerPlan,
    languageServerRuntimeStatus: languageServerRuntimeStatus,
    languageServerSetupOpen: languageRuntimeProjection.languageServerSetupOpen,
    floatingSurfaceActivationVersion,
    installingManagedPhpactor: languageRuntimeProjection.installingManagedPhpactor,
    message,
    openDocuments,
    openMarkdownPreviews: editorPresentation.openMarkdownPreviews,
    openTabs: editorPresentation.openTabs,
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
    openWorkspaceSymbols: commandEffects.openWorkspaceSymbols,
    openPinnedFile: openPinnedFile,
    prefetchFile: editorFile.documentTabs.prefetchFile,
    cancelFilePrefetch: editorFile.documentTabs.cancelFilePrefetch,
    clearLanguageServerDiagnosticsForPath: presentation.clearLanguageServerDiagnosticsForActivePath,
    updateLocalPhpDiagnostics,
    previewFile: editorFile.documentTabs.previewFile,
    previewPath,
    openSettingsPanel: commandEffects.openSettingsPanel,
    openWorkspace: workspaceTransition.openWorkspace,
    openWorkspaceRoot: workspaceTransition.openWorkspaceRoot,
    paletteOpen: quickOpenSeededSurface.paletteOpen,
    phpFileOutlineExpandedNodeIds: phpOutlineState.phpFileOutlineExpandedNodeIds,
    phpFileOutlinesByPath: phpFileOutlinesByPath,
    phpTree: phpOutlineState.phpTree,
    phpTreeExpandedNodeIds: phpOutlineState.phpTreeExpandedNodeIds,
    phpTreeLoading: phpOutlineState.phpTreeLoading,
    phpIdeReadinessVersion: languageRuntimeProjection.phpIdeReadinessVersion,
    phpTools: languageRuntimeProjection.phpTools,
    quickOpenLoading: quickOpen.quickOpenLoading,
    quickOpenOpen: quickOpen.quickOpenOpen,
    quickOpenQuery: quickOpen.quickOpenQuery,
    quickOpenRequest: quickOpen.quickOpenRequest,
    quickOpenResults: quickOpen.quickOpenResults,
    quickOpenTruncated: quickOpen.quickOpenTruncated,
    recentFiles: recentFiles,
    recentFilesSwitcherEntries: presentation.recentFilesSwitcherEntries,
    recentFilesSwitcherOpen: navigationState.recentFilesSwitcherOpen,
    openRecentFilesSwitcher: recentNavigation.openRecentFilesSwitcher,
    setRecentFilesSwitcherOpen: setRecentFilesSwitcherOpen,
    recentLocations: navigationState.recentLocations,
    reorderOpenTabs,
    recentLocationsPanelOpen: navigationState.recentLocationsPanelOpen,
    openRecentLocationsPanel: recentNavigation.openRecentLocationsPanel,
    setRecentLocationsPanelOpen: setRecentLocationsPanelOpen,
    bookmarks,
    sortedBookmarks: presentation.sortedBookmarks,
    isActiveDocumentGitBlameEnabled: activeDocument
      ? gitBlameEnabledPaths.has(activeDocument.path)
      : false,
    clearNotices: presentation.clearNotices,
    notices: commandEffects.effectiveNotices,
    replaceJavaScriptTestProblemNotices,
    ...taskDebug.nodeLaunchConfigurationsSurface,
    navigationHistory: navigationHistory,
    clearLatencyMetrics: latencyReporting.clearLatencyMetrics,
    getLatencySnapshot: latencyReporting.getLatencySnapshot,
    recordCompletionLatency: latencyReporting.recordCompletionLatency,
    reportCommandError: presentation.reportCommandError,
    reportLanguageServerError: reportLanguageServerError,
    previewGitChange,
    quitApplication,
    refreshPhpTree: refreshPhpTree,
    refreshGitStatus,
    revealDirectoryInTree: editorFile.directory.revealDirectoryInTree,
    retryDirectory: directoryExplorer.retryDirectory,
    revertGitChanges: revertGitChanges,
    saveActiveDocument,
    saveWorkbenchSettings: commandEffects.saveWorkbenchSettings,
    setActivePath: editorFile.documentTabs.activateDocument,
    setPaletteOpen: setPaletteOpen,
    setClassOpenOpen: setClassOpenOpen,
    setWorkspaceSymbolsOpen: setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery: setWorkspaceSymbolsQuery,
    setGitAmendEnabled: setGitAmendEnabled,
    setGitCommitMessage: setGitCommitMessage,
    setClassOpenQuery: classOpen.setClassOpenQuery,
    setQuickOpenOpen: setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery: quickOpen.setQuickOpenQuery,
    setSettingsOpen,
    ...textSearchWorkbench,
    setLanguageServerSetupOpen: languageRuntimeProjection.setLanguageServerSetupOpen,
    settingsInitialSection,
    setFileStructureOpen,
    setFileStructureScopeMode: setFileStructureScopeMode,
    pinDocument: pinDocument,
    openJavaScriptTypeScriptServiceLog,
    restartJavaScriptTypeScriptService,
    startIndexScan: indexLifecycle.startIndexScan,
    startHardReindex: indexLifecycle.startHardReindex,
    startLanguageServer,
    startPhpReindex: indexLifecycle.startPhpReindex,
    installManagedPhpactor: commandEffects.installManagedPhpactor,
    installManagedTypeScriptLanguageServer: commandEffects.installManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServer:
      languageRuntimeProjection.installingManagedTypeScriptLanguageServer,
    stopLanguageServer,
    settingsOpen,
    selectedGitChange,
    toggleDirectory: directoryExplorer.toggleDirectory,
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
    toggleSmartMode: commandEffects.toggleSmartMode,
    toggleWorkspaceTrust: commandEffects.toggleWorkspaceTrust,
    activeEditorPosition: navigationState.activeEditorPosition,
    updateActiveEditorPosition: navigationState.updateActiveEditorPosition,
    updateEditorViewState,
    updateEditorGroupViewState,
    openPhpTreeNode: openPhpTreeNode,
    agents,
    sidebarView,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceIdentityStatus: workspaceIdentityDescriptor ? "trusted" : "legacyCompatibility",
    workspaceRoot,
    restoredEditorViewStates: presentation.restoredEditorViewStates,
    restoredEditorViewStatesByGroup: presentation.restoredEditorViewStatesByGroup,
    restoredEditorViewStateRevision,
    workspaceTabs: appSettings.workspaceTabs,
    workspaceSettings,
    workspaceTrust,
  };
}
