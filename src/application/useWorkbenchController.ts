import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn as TauriUnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import { useGitStashPanel } from "./useGitStashPanel";
import { useGitBranchPanel } from "./useGitBranchPanel";
import { useFloatingSurfaces } from "./useFloatingSurfaces";
import { useGitWorkspace } from "./useGitWorkspace";
import {
  gitChangeForDiffDocumentPath,
  gitChangesReferToSameDiff,
  gitDiffDocumentPath,
  isGitDiffDocumentPath,
  useGitDiffWorkspace,
} from "./useGitDiffWorkspace";
import { useGitDiffPreviewCloseLifecycle } from "./useGitDiffPreviewCloseLifecycle";
import { workbenchAppearanceCommands } from "./workbenchAppearanceCommands";
import { workbenchBookmarkCommands } from "./workbenchBookmarkCommands";
import { workbenchEditorHistoryCommands } from "./workbenchEditorHistoryCommands";
import { workbenchEditorSurfaceCommands } from "./workbenchEditorSurfaceCommands";
import { workbenchFloatingSurfaceCommands } from "./workbenchFloatingSurfaceCommands";
import { workbenchGitSidebarCommands } from "./workbenchGitSidebarCommands";
import { workbenchGitWorkflowCommands } from "./workbenchGitWorkflowCommands";
import { workbenchIndexCommands } from "./workbenchIndexCommands";
import { workbenchLanguageNavigationCommands } from "./workbenchLanguageNavigationCommands";
import { workbenchLanguagePanelCommands } from "./workbenchLanguagePanelCommands";
import { workbenchNavigationHistoryCommands } from "./workbenchNavigationHistoryCommands";
import { workbenchPanelCommands } from "./workbenchPanelCommands";
import { workbenchPhpTestCommands } from "./workbenchPhpTestCommands";
import { workbenchPhpTreeCommands } from "./workbenchPhpTreeCommands";
import { workbenchProblemNavigationCommands } from "./workbenchProblemNavigationCommands";
import { workbenchSmartCommands } from "./workbenchSmartCommands";
import { workbenchWorkspaceFileCommands } from "./workbenchWorkspaceFileCommands";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";
import { useWorkbenchIndexCommands } from "./useWorkbenchIndexCommands";
import { useWorkspaceTodos } from "./useWorkspaceTodos";
import { usePhpFrameworkTargets } from "./usePhpFrameworkTargets";
import { usePhpLaravelEnvTargetResolver } from "./usePhpLaravelEnvTargetResolver";
import { usePhpFrameworkSourceRegistries } from "./usePhpFrameworkSourceRegistries";
import { usePhpFrameworkDefinitionNavigation } from "./usePhpFrameworkDefinitionNavigation";
import { usePhpLaravelModelNavigationTargets } from "./usePhpLaravelModelNavigationTargets";
import { usePhpContextualMemberDefinitionNavigation } from "./usePhpContextualMemberDefinitionNavigation";
import { usePhpMemberPropertyDefinitionNavigation } from "./usePhpMemberPropertyDefinitionNavigation";
import { usePhpLaravelLiteralDefinitionNavigation } from "./usePhpLaravelLiteralDefinitionNavigation";
import { usePhpContextualFrameworkLiteralDefinitionNavigation } from "./usePhpContextualFrameworkLiteralDefinitionNavigation";
import { usePhpSuperMethodNavigation } from "./usePhpSuperMethodNavigation";
import { usePhpIndexedDefinitionNavigation } from "./usePhpIndexedDefinitionNavigation";
import { usePhpContextualDefinitionNavigation } from "./usePhpContextualDefinitionNavigation";
import { usePhpClassTargetNavigation } from "./usePhpClassTargetNavigation";
import { usePhpMethodTargetNavigation } from "./usePhpMethodTargetNavigation";
import { usePhpPropertyTargetNavigation } from "./usePhpPropertyTargetNavigation";
import { usePhpImplementationNavigation } from "./usePhpImplementationNavigation";
import { useBookmarks } from "./useBookmarks";
import { useFileHistory } from "./useFileHistory";
import { useLocalHistory } from "./useLocalHistory";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { useDocumentSavePipeline } from "./useDocumentSavePipeline";
import {
  currentWorkspaceSession,
  isPersistableEditorDocumentPath,
  isSessionPathInWorkspace,
  restoredActivePath,
  restoredBottomPanelView,
  workspaceSessionsEqual,
} from "./documentSessionState";
import { useWorkbenchCloseLifecycle } from "./useWorkbenchCloseLifecycle";
import { useWorkbenchDocumentTabs } from "./useWorkbenchDocumentTabs";
import { useWorkbenchFileOperations } from "./useWorkbenchFileOperations";
import { useWorkbenchNavigationState } from "./useWorkbenchNavigationState";
import { useWorkbenchNavigation } from "./useWorkbenchNavigation";
import { useWorkbenchClassOpen } from "./useWorkbenchClassOpen";
import { useWorkbenchQuickOpen } from "./useWorkbenchQuickOpen";
import { useWorkbenchSearchEverywhere } from "./useWorkbenchSearchEverywhere";
import { useWorkbenchSymbolPanels } from "./useWorkbenchSymbolPanels";
import { useWorkbenchTextSearch } from "./useWorkbenchTextSearch";
import { useWorkbenchWorkspaceSymbols } from "./useWorkbenchWorkspaceSymbols";
import { usePhpDiagnosticContextFilter } from "./usePhpDiagnosticContextFilter";
import { usePhpTraitHostPredicates } from "./usePhpTraitHostPredicates";
import { usePhpMethodCompletionResolvers } from "./usePhpMethodCompletionResolvers";
import {
  phpNormalizedReceiverExpressionIsThis,
  usePhpMethodCompletionProvider,
} from "./usePhpMethodCompletionProvider";
import { usePhpClassHierarchyPredicates } from "./usePhpClassHierarchyPredicates";
import { usePhpClassMemberCollectors } from "./usePhpClassMemberCollectors";
import { usePhpLaravelScopePredicates } from "./usePhpLaravelScopePredicates";
import { usePhpSignatureHelpProvider } from "./usePhpSignatureHelpProvider";
import { usePhpLaravelMethodGenericModelType } from "./usePhpLaravelMethodGenericModelType";
import { usePhpLaravelModelTypeResolvers } from "./usePhpLaravelModelTypeResolvers";
import { usePhpLaravelMorphMapResolver } from "./usePhpLaravelMorphMapResolver";
import { usePhpExpressionTypeResolver } from "./usePhpExpressionTypeResolver";
import { usePhpLaravelRelationResolver } from "./usePhpLaravelRelationResolver";
import { usePhpSemanticResolver } from "./usePhpSemanticResolver";
import {
  usePhpMethodReturnTypeResolver,
} from "./usePhpMethodReturnTypeResolver";
import {
  useWorkbenchImplementationChooserState,
  useWorkbenchLanguageNavigation,
} from "./useWorkbenchLanguageNavigation";
import { useDocumentSync } from "./useDocumentSync";
import { useDiagnostics } from "./useDiagnostics";
import { useLanguageServerDiagnosticsSubscriptions } from "./useLanguageServerDiagnosticsSubscriptions";
import { useLanguageServerRuntimeLifecycle } from "./useLanguageServerRuntimeLifecycle";
import { useWorkspaceEditFileOperations } from "./useWorkspaceEditFileOperations";
import {
  useNavigationHistory,
  useRecentNavigation,
} from "./useNavigationHistory";
import { useTerminalTestRunner } from "./useTerminalTestRunner";
import { useWorkbenchFrameworkIntelligence } from "./useWorkbenchFrameworkIntelligence";
import { useWorkbenchFrameworkProviderAdapter } from "./useWorkbenchFrameworkProviderAdapter";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  goToPhpFrameworkIdentifierDefinition as goToPhpFrameworkIdentifierDefinitionForContext,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import { useBladeLaravelDiagnosticsProvider } from "./useBladeLaravelDiagnosticsProvider";
import { usePhpOutline } from "./usePhpOutline";
import { useJavaScriptTypeScriptFileStructure } from "./useJavaScriptTypeScriptFileStructure";
import type { PhpCodeActionNewFile } from "./usePhpCodeActions";
import {
  synthesizePhpTypedReceiverSource,
} from "./phpTypedReceiverSource";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
} from "./usePhpCodeActions";
import { usePhpCodeActionProvider } from "./usePhpCodeActionProvider";
import {
  shouldApplyClassEditAfterWrite,
  writeExtractedInterfaceFile,
} from "./phpExtractInterfaceWrite";
import {
  capDiagnosticNotices,
  capWorkbenchNotices,
  createWorkbenchNotice,
  languageServerCrashNoticeGroupKey,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  buildDiagnosticOverflowNotice,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  diagnosticNoticeNavigationTarget,
  GLOBAL_NOTICE_LIMIT,
  isCappableDiagnosticNotice,
  localPhpDiagnosticsFromSource,
  phpLocalDiagnosticNoticeGroup,
} from "./diagnosticNotices";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import {
  emptyGitStatus,
  type GitBlameLine,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import {
  activeFileGitBranchInfo,
  fanOutGitRepositoryStatuses,
  mergeGitRepositoryStatuses,
  primaryGitStatus,
  resolveEffectiveGitRepositoryMappings,
  resolveGitRepositoryForPath,
  WORKSPACE_ROOT_MAPPING,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
} from "../domain/gitRepositoryMapping";
import type { LocalHistoryGateway } from "../domain/localHistory";
import type { BottomPanelView } from "../domain/bottomPanel";
import {
  applyIndexProgress,
  applyMetadataScanCompletion,
  createIndexHealthCompletionLog,
  createIndexHealthLogEntry,
  indexProgressCompletionMessage,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressEvent,
  type IndexProgressGateway,
  type IndexProgressState,
  type MetadataScanCompletionEvent,
  type UnsubscribeFn as IndexProgressUnsubscribeFn,
} from "../domain/indexProgress";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import {
  DiagnosticsCoalescer,
  animationFrameDiagnosticsFlushScheduler,
  type DiagnosticsFlushScheduler,
} from "../domain/diagnosticsCoalescer";
import { filterPhpLanguageServerDiagnostics } from "../domain/phpLanguageServerDiagnosticFilters";
import {
  fileUriFromPath,
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
  type LanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  type EditorPosition,
  type LanguageServerConfigurationSettings,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import { formattingOptionsFromContent } from "../domain/formattingOptionsFromContent";
import {
  editorConfigDirectoriesForFile,
  editorConfigFormattingOptions,
  editorConfigPathForDirectory,
  parseEditorConfig,
  resolveEditorConfigSettings,
  type EditorConfigFile,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import { isBenignError } from "../infrastructure/globalErrorSafetyNet";
import { createSafeUnsubscribe } from "../infrastructure/safeUnsubscribe";
import { TauriPhpSyntaxDiagnosticsGateway } from "../infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import {
  shortcutForCommand,
  type KeymapCommandId,
} from "../domain/keymap";
import {
  summarizeDiagnosticsByPath,
  type DiagnosticsSummary,
} from "../domain/diagnosticsSummary";
import {
  applyEditorChangeRevert,
  type EditorChangeHunk,
} from "../domain/editorChangeMarkers";
import {
  isLanguageServerActive,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForRoot,
} from "../domain/languageServerRuntimeStatusCache";
import {
  type WorkspaceFileChangeGateway,
  type WorkspaceFileChangeUnsubscribeFn,
} from "../domain/workspaceFileChange";
import {
  normalizedWorkspaceRootKey,
  workspaceDisplayName,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import type { NavigationHistory } from "../domain/navigation";
import {
  type PhpFileOutline,
  type PhpFileOutlineGateway,
  type PhpFileStructureScope,
} from "../domain/phpFileOutline";
import {
  emptyPhpTree,
  type PhpTree,
  type PhpTreeGateway,
} from "../domain/phpTree";
import {
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
} from "../domain/phpFrameworkLaravel";
import {
  resolvePhpFrameworkProfile,
} from "../domain/phpFrameworkProviders";
import {
  resolvePhpClassName,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import {
  phpTestClassPlan,
  renderPhpTestSkeleton,
} from "../domain/phpTestGen";
import {
  isPhpTestRelativePath,
  phpTestNavigationTargets,
  type PhpTestNavigationDirection,
} from "../domain/phpTestNavigation";
import type {
  ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import { isTypeProjectSymbol } from "../domain/projectSymbols";
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import {
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSettings,
  normalizeEditorFontSize,
  type AppSettings,
  type SettingsGateway,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSessionState,
  type WorkspaceSettings,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import {
  recentFilesForSwitcher,
  type RecentFileEntry,
} from "../domain/recentFiles";
import { type RecentLocation } from "../domain/recentLocations";
import {
  sortBookmarks,
  type Bookmark,
} from "../domain/bookmarks";
import {
  createLatencyTracker,
  measureLatency,
  type LatencySnapshotEntry,
  type LatencyTracker,
} from "../domain/latencyTracker";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  workspaceRelativePath,
  visibleEditorPaths,
  type EditorDocument,
  type FileEntry,
  type FileSearchGateway,
  type IntelligenceMode,
  type ManagedPhpactorInstallCompletionEvent,
  type ManagedPhpactorInstallUnsubscribeFn,
  type PhpToolGateway,
  type PhpToolAvailability,
  type TextSearchGateway,
  type WorkspaceDescriptor,
  type WorkspaceDetectionGateway,
  type WorkspaceFileGateway,
} from "../domain/workspace";

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  fileChanges: WorkspaceFileChangeGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  phpTools: PhpToolGateway;
  projectSymbols: ProjectSymbolSearchGateway;
  textSearch: TextSearchGateway;
}

export interface WorkbenchControllerOptions {
  /**
   * Strategy that defers the coalesced diagnostics flush. Production omits this
   * to use one flush per animation frame (with a `setTimeout(0)` fallback);
   * tests inject a deterministic scheduler so flushes can be driven explicitly.
   */
  diagnosticsFlushScheduler?: DiagnosticsFlushScheduler;
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

interface OpenWorkspaceFileRequest {
  canOpen(): boolean;
}

interface CachedWorkspaceWorkbenchState {
  activePath: string | null;
  bookmarks: Bookmark[];
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  documents: Record<string, EditorDocument>;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  openPaths: string[];
  previewPath: string | null;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  sidebarView: SidebarView;
}

const FONT_ZOOM_IN_EVENT = "mockor-editor-font-zoom-in";
const FONT_ZOOM_OUT_EVENT = "mockor-editor-font-zoom-out";
const FONT_ZOOM_RESET_EVENT = "mockor-editor-font-zoom-reset";
const OPEN_APPEARANCE_SETTINGS_EVENT = "mockor-open-appearance-settings";
const TOGGLE_FONT_LIGATURES_EVENT = "mockor-toggle-font-ligatures";

function languageServerDiagnosticsEqual(
  left: readonly LanguageServerDiagnostic[],
  right: readonly LanguageServerDiagnostic[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((diagnostic, index) => {
    const comparison = right[index];

    return (
      diagnostic.message === comparison.message &&
      diagnostic.source === comparison.source &&
      diagnostic.severity === comparison.severity &&
      diagnostic.line === comparison.line &&
      diagnostic.character === comparison.character &&
      diagnostic.endLine === comparison.endLine &&
      diagnostic.endCharacter === comparison.endCharacter &&
      diagnostic.code === comparison.code
    );
  });
}

const phpLocalSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();

export type SidebarView = "files" | "git" | "php";

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
  languageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway,
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway,
  languageServerFeaturesGateway: LanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway,
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway,
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway,
  terminalGateway: TerminalGateway,
  settingsGateway: SettingsGateway,
  prompter: WorkbenchPrompter,
  options: WorkbenchControllerOptions = {},
) {
  const {
    detection: workspaceDetection,
    fileChanges: workspaceFileChangeGateway,
    fileSearch,
    files: workspaceFiles,
    phpTools: phpToolGateway,
    projectSymbols: projectSymbolSearch,
    textSearch,
  } = workspaceGateways;
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceDescriptor, setWorkspaceDescriptor] =
    useState<WorkspaceDescriptor | null>(null);
  const resetPhpClassMemberCacheRef = useRef<() => void>(() => {});
  const resetPhpFrameworkCachesRef = useRef<() => void>(() => {});
  const resetPhpLaravelMorphMapModelTypeCacheRef = useRef<() => void>(() => {});
  // One detection pass per workspace: the active provider set and the exclusive
  // profile ("laravel" | "nette" | "generic") are derived from the same result,
  // so they can never disagree (no second source of truth).
  const phpFrameworkResolution = useMemo(
    () => resolvePhpFrameworkProfile(workspaceDescriptor?.php ?? null),
    [workspaceDescriptor?.php],
  );
  const phpFrameworkIntelligence = useMemo(
    () => createPhpFrameworkIntelligence(phpFrameworkResolution),
    [phpFrameworkResolution],
  );
  const phpFrameworkRuntimeContext = useMemo(
    () => createPhpFrameworkRuntimeContext(phpFrameworkIntelligence),
    [phpFrameworkIntelligence],
  );
  const activePhpFrameworkProviders = phpFrameworkIntelligence.providers;
  const activePhpFrameworkProviderSignature =
    phpFrameworkIntelligence.providerSignature;
  const isNetteFrameworkActive = phpFrameworkIntelligence.isNette;
  // Exclusive, per-workspace framework profile - the single discriminator the
  // status-bar chip and future gating key off.
  const activeFrameworkProfile = phpFrameworkIntelligence.profile;
  // Edge (spec 4.1): a project that declares several framework signals at once
  // (e.g. a Laravel app carrying latte/latte transitively in composer.lock)
  // resolves to a single exclusive profile by registry priority. Surface the
  // ambiguity once per workspace so the deterministic pick stays observable and
  // we never silently blend two frameworks' magic.
  useEffect(() => {
    if (phpFrameworkIntelligence.matchedProviderIds.length < 2) {
      return;
    }

    console.warn(
      `Multiple PHP framework signals detected (${phpFrameworkIntelligence.matchedProviderIds.join(
        ", ",
      )}); resolved exclusively to "${phpFrameworkIntelligence.profile}" by registry priority.`,
    );
  }, [phpFrameworkIntelligence]);
  const [workspaceTrust, setWorkspaceTrust] =
    useState<WorkspaceTrustState | null>(null);
  const [phpTools, setPhpTools] = useState<PhpToolAvailability | null>(null);
  const [languageServerPlan, setLanguageServerPlan] =
    useState<LanguageServerPlan | null>(null);
  const [installingManagedPhpactor, setInstallingManagedPhpactor] =
    useState(false);
  const [
    javaScriptTypeScriptLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerPlan,
  ] = useState<LanguageServerPlan | null>(null);
  const [languageServerSetupOpen, setLanguageServerSetupOpen] = useState(false);
  const [languageServerRuntimeStatus, setLanguageServerRuntimeStatus] =
    useState<LanguageServerRuntimeStatus | null>(null);
  const [
    languageServerRuntimeStatusRoot,
    setLanguageServerRuntimeStatusRoot,
  ] = useState<string | null>(null);
  const [phpIdeReadinessVersion, setPhpIdeReadinessVersion] = useState(0);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
  ] = useState<LanguageServerRuntimeStatus | null>(null);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  ] = useState<string | null>(null);
  const [languageServerDiagnosticsByPath, setLanguageServerDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [
    javaScriptTypeScriptDiagnosticsByPath,
    setJavaScriptTypeScriptDiagnosticsByPath,
  ] = useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [laravelDiagnosticsByPath, setLaravelDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [phpLocalDiagnosticsByPath, setPhpLocalDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [indexProgress, setIndexProgress] = useState<IndexProgressState>(
    initialIndexProgress,
  );
  const [indexHealthLogs, setIndexHealthLogs] = useState<
    IndexHealthLogEntry[]
  >([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [bottomPanelView, setBottomPanelView] =
    useState<BottomPanelView>("problems");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
  const [phpTree, setPhpTree] = useState<PhpTree>(emptyPhpTree);
  const [phpTreeLoading, setPhpTreeLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus());
  // Effective git repository mappings (manual + auto-detected, always incl. the
  // workspace root). Defaults to the single workspace-root repo so behaviour is
  // identical to the pre-multi-repo world until discovery runs.
  const [gitRepositoryMappings, setGitRepositoryMappings] = useState<
    GitRepositoryMapping[]
  >([WORKSPACE_ROOT_MAPPING]);
  // Whole-map status view (one entry per mapping), for the multi-repo Changes
  // panel. `gitStatus` above stays the primary (workspace-root) repo.
  const [gitRepositoryStatuses, setGitRepositoryStatuses] = useState<
    GitRepositoryStatus[]
  >([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [editorGitBaselinesByPath, setEditorGitBaselinesByPath] = useState<
    Record<string, string | null>
  >({});
  const [phpTreeExpandedNodeIds, setPhpTreeExpandedNodeIds] = useState<
    Set<string>
  >(new Set());
  const [phpFileOutlinesByPath, setPhpFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [phpInheritedFileOutlinesByPath, setPhpInheritedFileOutlinesByPath] =
    useState<Record<string, PhpFileOutline>>({});
  const [expandedPhpFilePaths, setExpandedPhpFilePaths] = useState<Set<string>>(
    new Set(),
  );
  const [loadingPhpFileOutlinePaths, setLoadingPhpFileOutlinePaths] = useState<
    Set<string>
  >(new Set());
  const [
    loadingInheritedPhpFileOutlinePaths,
    setLoadingInheritedPhpFileOutlinePaths,
  ] = useState<Set<string>>(new Set());
  const [phpFileOutlineExpandedNodeIds, setPhpFileOutlineExpandedNodeIds] =
    useState<Set<string>>(new Set());
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, FileEntry[]>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [manuallyCollapsedDirectories, setManuallyCollapsedDirectories] =
    useState<Set<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>(
    {},
  );
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Per-workspace bookmarks (PhpStorm parity). Cached/restored alongside the
  // rest of the per-tab workbench state so one project's bookmarks can never
  // leak into another project's editor gutter or panel.
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  // Git blame annotation toggle, tracked per absolute document path so the
  // annotation state never leaks across open tabs (each path is workspace-
  // scoped). Reset on workspace switch alongside the other per-tab state.
  const [gitBlameEnabledPaths, setGitBlameEnabledPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const { implementationChooser, setImplementationChooser } =
    useWorkbenchImplementationChooserState();
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
  const noticesRef = useRef<WorkbenchNotice[]>(notices);
  noticesRef.current = notices;
  const [appSettings, setAppSettings] =
    useState<AppSettings>(defaultAppSettings);
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettings>(defaultWorkspaceSettings);
  // Resolved `.editorconfig` settings for the active document. Empty when no
  // `.editorconfig` matches the active file (the editor then keeps its own
  // defaults). Recomputed per active-file change, scoped to the active root.
  const [activeEditorConfig, setActiveEditorConfig] =
    useState<ResolvedEditorConfig>({});
  const activeEditorConfigRef = useRef<ResolvedEditorConfig>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSection>("general");
  const [fileStructureOpen, setFileStructureOpen] = useState(false);
  const [fileStructureScope, setFileStructureScope] =
    useState<PhpFileStructureScope>("current");
  const setJavaScriptTypeScriptFileStructureScopeCurrent = useCallback(
    () => setFileStructureScope("current"),
    [],
  );
  const [intelligenceMode, setIntelligenceMode] =
    useState<IntelligenceMode>("basic");
  const [
    phpLanguageServerAutostartRetryVersion,
    setPhpLanguageServerAutostartRetryVersion,
  ] = useState(0);
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
  const workspaceSettingsRef = useRef<WorkspaceSettings>(
    defaultWorkspaceSettings(),
  );
  const workspaceSessionRestoredRef = useRef(false);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const lastPhpIdeReadinessSignatureRef = useRef<string | null>(null);
  const openWorkspaceRequestTokenRef = useRef(0);
  const openWorkspaceRequestPathRef = useRef<string | null>(null);
  const openFileRequestTokenRef = useRef(0);
  const openingFileFlagOwnerTokenRef = useRef<number | null>(null);
  const emptyDocumentRefreshTimeoutsRef = useRef<Set<number>>(new Set());
  const editorGitBaselineRequestTokenRef = useRef(0);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
  const phpLanguageServerAutostartAttemptsByRootRef = useRef<
    Record<string, number>
  >({});
  const manuallyStoppedPhpLanguageServerRootsRef = useRef<Set<string>>(
    new Set(),
  );
  const installingManagedPhpactorRootRef = useRef<string | null>(null);
  const autoStartedJavaScriptTypeScriptLanguageServerRootRef = useRef<
    string | null
  >(null);
  const intelligenceModeRef = useRef<IntelligenceMode>("basic");
  const documentVersionsRef = useRef<Record<string, number>>({});
  const documentVersionsByUriRef = useRef<Record<string, number>>({});
  // Tracks the analysis version of the LAST diagnostic we actually APPLIED, per
  // root/uri sync key. phpactor publishes diagnostics keyed by the version it
  // analysed (not the live document version), so a clear (count=0) can carry an
  // older version than the live document after a didChange. Comparing fresh
  // publications against this monotonic per-uri value (instead of the live
  // document version) lets in-order clears through while still dropping genuinely
  // out-of-order publications. Isolated per workspace root via the sync key.
  const lastAppliedDiagnosticVersionByUriRef = useRef<Record<string, number>>(
    {},
  );
  const syncedDocumentPathsRef = useRef<Set<string>>(new Set());
  const syncedDocumentContentRef = useRef<Record<string, string>>({});
  const pendingDocumentChangesRef = useRef<
    Record<string, LanguageServerTextDocument>
  >({});
  const pendingDocumentOpenSyncAttemptsRef = useRef<Record<string, number>>({});
  const documentOpenSyncAttemptIdRef = useRef(0);
  const documentChangeTimersRef = useRef<Record<string, number>>({});
  const documentSyncQueuesRef = useRef<Record<string, Promise<void>>>({});
  const documentSyncGenerationRef = useRef(0);
  const documentSyncRuntimeSignatureRef = useRef<string | null>(null);
  // Cold first-nav fix: tracks which workspace roots have already had their
  // phpactor index force-warmed (one low-priority documentSymbol request fired
  // after the first PHP didOpen). Keyed by the workspace root so each open
  // project tab warms exactly once and the warm-up never leaks across tabs.
  const phpLanguageServerIndexWarmedRootsRef = useRef<Set<string>>(new Set());
  const languageServerRuntimeStatusByRootRef = useRef<
    Record<string, LanguageServerRuntimeStatus>
  >({});
  const languageServerDiagnosticsByRootRef = useRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  const externallyRemovedDocumentRootByPathRef = useRef<Record<string, string>>(
    {},
  );
  const isExternallyRemovedDocumentPath = useCallback(
    (path: string) =>
      Object.prototype.hasOwnProperty.call(
        externallyRemovedDocumentRootByPathRef.current,
        path,
      ),
    [],
  );
  const markExternallyRemovedDocumentPath = useCallback(
    (rootPath: string, path: string) => {
      externallyRemovedDocumentRootByPathRef.current[path] = rootPath;
    },
    [],
  );
  const forgetExternallyRemovedDocumentPath = useCallback((path: string) => {
    delete externallyRemovedDocumentRootByPathRef.current[path];
  }, []);
  // Coalescers buffer incoming publishDiagnostics events (per root/uri) and
  // replay them through the apply* sinks once per scheduled frame, collapsing an
  // indexing burst of N un-batched events into a single batched application.
  // Held in refs so workspace-switch / close paths can drop a root's buffer
  // before it flushes, keeping diagnostics isolated per workspace tab.
  const languageServerDiagnosticsCoalescerRef =
    useRef<DiagnosticsCoalescer | null>(null);
  const javaScriptTypeScriptDiagnosticsCoalescerRef =
    useRef<DiagnosticsCoalescer | null>(null);
  const diagnosticsFlushSchedulerRef = useRef<DiagnosticsFlushScheduler>(
    options.diagnosticsFlushScheduler ??
      animationFrameDiagnosticsFlushScheduler(),
  );
  const createDiagnosticsCoalescer = useCallback(
    (
      sink: (event: LanguageServerDiagnosticEvent) => void,
      scheduler: DiagnosticsFlushScheduler,
    ) => new DiagnosticsCoalescer(sink, scheduler),
    [],
  );
  const javaScriptTypeScriptDocumentVersionsRef = useRef<Record<string, number>>(
    {},
  );
  const javaScriptTypeScriptDocumentVersionsByUriRef = useRef<
    Record<string, number>
  >({});
  // JS/TS counterpart of {@link lastAppliedDiagnosticVersionByUriRef}: the
  // analysis version of the last diagnostic applied per root/uri sync key.
  const javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef = useRef<
    Record<string, number>
  >({});
  const javaScriptTypeScriptSyncedDocumentPathsRef = useRef<Set<string>>(
    new Set(),
  );
  const javaScriptTypeScriptSyncedDocumentContentRef = useRef<
    Record<string, string>
  >({});
  const javaScriptTypeScriptPendingDocumentChangesRef = useRef<
    Record<string, LanguageServerTextDocument>
  >({});
  const javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef = useRef<
    Record<string, number>
  >({});
  const javaScriptTypeScriptDocumentOpenSyncAttemptIdRef = useRef(0);
  const javaScriptTypeScriptDocumentChangeTimersRef = useRef<
    Record<string, number>
  >({});
  const javaScriptTypeScriptDocumentSyncQueuesRef = useRef<
    Record<string, Promise<void>>
  >({});
  const javaScriptTypeScriptDocumentSyncGenerationRef = useRef(0);
  const javaScriptTypeScriptRuntimeStatusByRootRef = useRef<
    Record<string, LanguageServerRuntimeStatus>
  >({});
  const javaScriptTypeScriptDiagnosticsByRootRef = useRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  const languageServerRuntimeStatusRef =
    useRef<LanguageServerRuntimeStatus | null>(null);
  const languageServerRuntimeStatusRootRef = useRef<string | null>(null);
  const javaScriptTypeScriptLanguageServerRuntimeStatusRef =
    useRef<LanguageServerRuntimeStatus | null>(null);
  const javaScriptTypeScriptLanguageServerRuntimeStatusRootRef =
    useRef<string | null>(null);
  const javaScriptTypeScriptDocumentSyncRuntimeSignatureRef = useRef<
    string | null
  >(null);
  const phpClassSourcePathCacheRef = useRef<Record<string, string[]>>({});
  const phpFrameworkBindingCacheRef = useRef<Record<string, string | null>>({});
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
  const phpLocalDiagnosticValidationGenerationRef = useRef(0);
  const phpLocalDiagnosticRetryTimersRef = useRef<
    ReturnType<typeof setTimeout>[]
  >([]);
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const reclassifyPhpLanguageServerDiagnosticsForRootRef = useRef<
    (rootPath: string) => void
  >(() => {});
  const onPhpLaravelSourcesLoaded = useCallback((rootPath: string): void => {
    reclassifyPhpLanguageServerDiagnosticsForRootRef.current(rootPath);
  }, []);
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
  >(
    async (_entry: FileEntry): Promise<boolean> => false,
  );
  // PhpStorm double-Shift detector for Search Everywhere. Kept in a stable ref
  // so the keydown listener keeps the same instance across re-renders (the tap
  // timing must persist between events). 300ms is PhpStorm's default window.
  const doubleShiftDetectorRef = useRef(
    createDoubleShiftDetector({ windowMs: 300 }),
  );
  // The active terminal session tracking and staged-command refs used by
  // "run in terminal" / "run PHP test" now live inside `useTerminalTestRunner`
  // (they are exclusively consumed there).
  const workspaceStateCacheRef = useRef<
    Record<string, CachedWorkspaceWorkbenchState>
  >({});
  // Per-workspace `.editorconfig` cache. Keyed by workspace root, then by the
  // absolute directory whose `.editorconfig` was read. `null` records a
  // confirmed absence so a missing file is read at most once per session. This
  // is scoped per root, so it is cleared exactly where the rest of the
  // per-workspace caches are (workspace switch / tab close), preserving the
  // per-project isolation invariant.
  const editorConfigCacheRef = useRef<
    Record<string, Record<string, EditorConfigFile | null>>
  >({});
  const filePrefetchCacheRef = useRef<FilePrefetchCache>(new FilePrefetchCache());
  const filePrefetchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const lastPhpFileOutlineRefreshKeyRef = useRef<string | null>(null);
  const contextualDiagnosticsFilterRef = useRef(
    async (
      _path: string,
      diagnostics: LanguageServerDiagnostic[],
    ): Promise<LanguageServerDiagnostic[]> => diagnostics,
  );
  const resolvePhpEloquentBuilderModelTypeRef = useRef(
    async (
      _source: string,
      _position: EditorPosition,
      _expression: string,
    ): Promise<string | null> => null,
  );
  const resolvePhpExpressionTypeRef = useRef(
    async (
      _source: string,
      _position: EditorPosition,
      _expression: string,
    ): Promise<string | null> => null,
  );

  const activeDocument = activePath ? documents[activePath] || null : null;
  const {
    activeEditorPosition,
    activeEditorPositionRef,
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
  } = useWorkbenchNavigationState({ activeDocument });
  // Whether the active document is a PHP test file (under the tests root or a
  // `*Test` class). Drives the "run test from gutter" glyph in EditorSurface.
  // Computed here so the PSR-4 mapping stays in the domain/controller layer and
  // EditorSurface only consumes a boolean gate.
  const isActiveDocumentPhpTest = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php" || !workspaceRoot) {
      return false;
    }

    const psr4Roots = workspaceDescriptor?.php?.psr4Roots;

    if (!psr4Roots) {
      return false;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, activeDocument.path);

    if (!relativePath) {
      return false;
    }

    return isPhpTestRelativePath(relativePath, psr4Roots);
  }, [activeDocument, workspaceDescriptor, workspaceRoot]);
  const openDocumentPaths = useMemo(
    () => visibleEditorPaths(openPaths, previewPath),
    [openPaths, previewPath],
  );
  const openDocuments = useMemo(
    () =>
      openDocumentPaths
        .map((path) => documents[path])
        .filter((document): document is EditorDocument => Boolean(document)),
    [documents, openDocumentPaths],
  );
  const dirtyCount = openDocuments.filter(
    (document) => !document.readOnly && isDirty(document),
  ).length;
  const hasOpenJavaScriptTypeScriptDocument = openDocuments.some(
    (document) =>
      isJavaScriptTypeScriptLanguageServerDocument(document) &&
      Boolean(
        workspaceRoot && isSessionPathInWorkspace(workspaceRoot, document.path),
      ),
  );
  const shouldAutoStartJavaScriptTypeScriptLanguageServer =
    Boolean(workspaceDescriptor?.javaScriptTypeScript) ||
    hasOpenJavaScriptTypeScriptDocument;
  const phpIdeReadinessSignature = useMemo(() => {
    if (!workspaceRoot || !workspaceDescriptor?.php) {
      return null;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      return null;
    }

    if (!workspaceTrust?.trusted) {
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

    if (
      !canUseLanguageServerFeature(
        languageServerRuntimeStatus.capabilities,
        "completion",
      )
    ) {
      return null;
    }

    if (
      indexProgress.status === "scanning" &&
      (!indexProgress.rootPath ||
        workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot))
    ) {
      return null;
    }

    return [
      workspaceRoot,
      languageServerRuntimeStatus.sessionId ?? "managed",
      activePhpFrameworkProviderSignature,
      indexProgress.rootPath ?? "no-index-root",
      indexProgress.status,
      indexProgress.indexedFiles,
    ].join(":");
  }, [
    activePhpFrameworkProviderSignature,
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    intelligenceMode,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
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

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    openPathsRef.current = openPaths;
  }, [openPaths]);

  useEffect(() => {
    previewPathRef.current = previewPath;
  }, [previewPath]);

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
  }, [languageServerRuntimeStatus, languageServerRuntimeStatusRoot]);

  useEffect(() => {
    javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatus;
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot;
  }, [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  ]);

  useEffect(() => {
    intelligenceModeRef.current = intelligenceMode;
  }, [intelligenceMode]);

  const reportError = useCallback((source: string, error: unknown) => {
    if (isBenignError(error)) {
      return;
    }

    const nextMessage = String(error);
    setMessage(nextMessage);
    setNotices((current) => [
      createWorkbenchNotice("error", source, nextMessage),
      ...current,
    ]);
  }, []);

  const reportErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, source: string, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      reportError(source, error);
    },
    [reportError],
  );

  const {
    textSearchLoading,
    textSearchOpen,
    textSearchQuery,
    textSearchOptions,
    textSearchResults,
    textReplacement,
    textReplaceBusy,
    setTextSearchOpen,
    setTextSearchQuery,
    setTextSearchOptions,
    setTextReplacement,
    resetTextSearchState,
    openTextSearchResult,
    replaceAllInPath,
    replaceInFile,
  } = useWorkbenchTextSearch({
    workspaceRoot,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openFileRef,
    prompter,
    textSearch,
    workspaceFiles,
    reportError,
    setDocuments,
    setEditorRevealTarget,
    setMessage,
  });

  const isUnknownDocumentForUnsyncedPath = useCallback(
    (rootPath: string | null | undefined, error: unknown): boolean => {
      const message = String(error);

      if (!message.includes("UnknownDocument")) {
        return false;
      }

      const uri = /Unknown text document "([^"]+)"/.exec(message)?.[1];
      const path = uri ? pathFromLanguageServerUri(uri) : null;

      if (!path || !rootPath) {
        return false;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);

      // The document is genuinely unsynced only when neither language server
      // (PHP nor JavaScript/TypeScript) still holds it open. An UnknownDocument
      // error for a document that is still open on either server is a real
      // desync, not the benign close race, so it must not be suppressed.
      return (
        !syncedDocumentPathsRef.current.has(syncKey) &&
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      );
    },
    [],
  );

  const reportLanguageServerError = useCallback(
    (error: unknown) => {
      // Monaco feature providers (hover/completion/definition/codeAction/
      // rename/references) report their failures through this path. When a tab
      // is closed (didClose) between flushing a document change and the server's
      // reply, phpactor answers with UnknownDocument for a path that is no
      // longer open. That is a benign desync, not a real failure, so suppress it
      // before it surfaces a false error toast or status message. Legitimate
      // errors, and UnknownDocument for a document that is still open, fall
      // through unchanged.
      if (
        isBenignError(error) ||
        isUnknownDocumentForUnsyncedPath(currentWorkspaceRootRef.current, error)
      ) {
        return;
      }

      const nextMessage = String(error);
      setMessage(nextMessage);

      if (lastLanguageServerCrashRef.current === nextMessage) {
        return;
      }

      lastLanguageServerCrashRef.current = nextMessage;
      setNotices((current) => [
        createWorkbenchNotice(
          "error",
          "Language Server",
          nextMessage,
          languageServerCrashNoticeGroupKey(currentWorkspaceRootRef.current) ??
            undefined,
        ),
        ...current,
      ]);
    },
    [isUnknownDocumentForUnsyncedPath],
  );

  const reportLanguageServerErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      if (isUnknownDocumentForUnsyncedPath(rootPath, error)) {
        return;
      }

      reportLanguageServerError(error);
    },
    [isUnknownDocumentForUnsyncedPath, reportLanguageServerError],
  );
  const reportJavaScriptTypeScriptLanguageServerError = useCallback(
    (error: unknown) => {
      reportError("JavaScript/TypeScript", error);
    },
    [reportError],
  );

  // Records a PHP completion round-trip latency reported by the Monaco
  // completion provider (wired through EditorSurface). Stable identity so the
  // provider registration never re-runs because of it.
  const latencyTrackerForRoot = useCallback((rootPath: string) => {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    let tracker = latencyTrackersByRootRef.current[rootKey];

    if (!tracker) {
      tracker = createLatencyTracker();
      latencyTrackersByRootRef.current[rootKey] = tracker;
    }

    return tracker;
  }, []);

  const {
    quickOpenOpen,
    quickOpenQuery,
    quickOpenLoading,
    quickOpenResults,
    setQuickOpenOpen,
    setQuickOpenQuery,
  } = useWorkbenchQuickOpen({
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    setMessage,
    workspaceRoot,
  });
  const [floatingSurfaceActivationVersion, setFloatingSurfaceActivationVersion] =
    useState(0);
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

  const forgetLatencyTrackerForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);

      if (rootKey) {
        delete latencyTrackersByRootRef.current[rootKey];
      }
    },
    [],
  );

  const recordCompletionLatency = useCallback(
    (durationMs: number, rootPath?: string) => {
      const requestedRoot = rootPath ?? currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return;
      }

      latencyTrackerForRoot(requestedRoot).record("completion", durationMs);
    },
    [latencyTrackerForRoot],
  );

  // Pull a fresh snapshot of all recorded operation latencies. The runtime
  // latency panel polls this on an interval (the tracker is mutated imperatively
  // on the hot path, so there is no React state to subscribe to).
  const getLatencySnapshot = useCallback(
    (): LatencySnapshotEntry[] => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return [];
      }

      const rootKey = normalizedWorkspaceRootKey(requestedRoot);
      return latencyTrackersByRootRef.current[rootKey]?.snapshot() ?? [];
    },
    [],
  );

  const applyAppSettings = useCallback((settings: AppSettings) => {
    appSettingsRef.current = settings;
    setAppSettings(settings);
  }, []);

  const applyWorkspaceSettings = useCallback((settings: WorkspaceSettings) => {
    workspaceSettingsRef.current = settings;
    setWorkspaceSettings(settings);
  }, []);

  const persistAppSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const previousSettings = appSettingsRef.current;
      applyAppSettings(nextSettings);

      try {
        await settingsGateway.saveAppSettings(nextSettings);
      } catch (error) {
        applyAppSettings(previousSettings);
        throw error;
      }
    },
    [applyAppSettings, settingsGateway],
  );

  const setEditorFontSize = useCallback(
    (nextFontSize: number) => {
      const currentSettings = appSettingsRef.current;
      const editorFontSize = normalizeEditorFontSize(nextFontSize);

      if (editorFontSize === currentSettings.editorFontSize) {
        return;
      }

      void persistAppSettings({
        ...currentSettings,
        editorFontSize,
      }).catch((error) => reportError("Settings", error));
    },
    [persistAppSettings, reportError],
  );

  const zoomEditorFontIn = useCallback(() => {
    setEditorFontSize(appSettingsRef.current.editorFontSize + 1);
  }, [setEditorFontSize]);

  const zoomEditorFontOut = useCallback(() => {
    setEditorFontSize(appSettingsRef.current.editorFontSize - 1);
  }, [setEditorFontSize]);

  const resetEditorFontSize = useCallback(() => {
    setEditorFontSize(defaultEditorFontSize);
  }, [setEditorFontSize]);

  const toggleEditorFontLigatures = useCallback(() => {
    const currentSettings = appSettingsRef.current;

    void persistAppSettings({
      ...currentSettings,
      editorFontLigatures: !currentSettings.editorFontLigatures,
    }).catch((error) => reportError("Settings", error));
  }, [persistAppSettings, reportError]);

  const persistWorkspaceSettings = useCallback(
    async (rootPath: string, nextSettings: WorkspaceSettings) => {
      const previousSettings = workspaceSettingsRef.current;
      const isRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);

      if (isRootActive()) {
        applyWorkspaceSettings(nextSettings);
      }

      try {
        await settingsGateway.saveWorkspaceSettings(rootPath, nextSettings);
      } catch (error) {
        if (isRootActive()) {
          applyWorkspaceSettings(previousSettings);
        }

        throw error;
      }
    },
    [applyWorkspaceSettings, settingsGateway],
  );

  const cacheCurrentWorkspaceState = useCallback(
    (rootPath: string) => {
      const cacheableDocuments = Object.fromEntries(
        Object.entries(documents).filter(([path]) =>
          isPersistableEditorDocumentPath(path),
        ),
      );
      const cacheableOpenPaths = openPaths.filter(isPersistableEditorDocumentPath);
      const cacheablePreviewPath =
        previewPath && isPersistableEditorDocumentPath(previewPath)
          ? previewPath
          : null;
      const cacheableActivePath =
        activePath && isPersistableEditorDocumentPath(activePath)
          ? activePath
          : null;

      workspaceStateCacheRef.current[rootPath] = {
        activePath: cacheableActivePath,
        bookmarks,
        bottomPanelView,
        bottomPanelVisible,
        documents: cacheableDocuments,
        entriesByDirectory,
        expandedDirectories: new Set(expandedDirectories),
        indexHealthLogs,
        indexProgress,
        manuallyCollapsedDirectories: new Set(manuallyCollapsedDirectories),
        navigationHistory,
        openPaths: cacheableOpenPaths,
        previewPath: cacheablePreviewPath,
        recentFiles,
        recentLocations,
        sidebarView,
      };
    },
    [
      activePath,
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      documents,
      entriesByDirectory,
      manuallyCollapsedDirectories,
      expandedDirectories,
      indexHealthLogs,
      indexProgress,
      navigationHistory,
      openPaths,
      previewPath,
      recentFiles,
      recentLocations,
      sidebarView,
    ],
  );

  const restoreCachedWorkspaceState = useCallback(
    (cached: CachedWorkspaceWorkbenchState) => {
      const restoredDocuments = Object.fromEntries(
        Object.entries(cached.documents).filter(([path]) =>
          isPersistableEditorDocumentPath(path),
        ),
      );
      const restoredOpenPaths = cached.openPaths.filter(
        isPersistableEditorDocumentPath,
      );
      const restoredPreviewPath =
        cached.previewPath &&
        isPersistableEditorDocumentPath(cached.previewPath)
          ? cached.previewPath
          : null;
      const cacheableActivePath =
        cached.activePath && isPersistableEditorDocumentPath(cached.activePath)
          ? cached.activePath
          : null;
      const nextActivePath = restoredActivePath(
        cacheableActivePath,
        visibleEditorPaths(restoredOpenPaths, restoredPreviewPath),
      );

      setEntriesByDirectory(cached.entriesByDirectory);
      setExpandedDirectories(new Set(cached.expandedDirectories));
      setIndexHealthLogs(cached.indexHealthLogs);
      setIndexProgress(cached.indexProgress);
      setManuallyCollapsedDirectories(
        new Set(cached.manuallyCollapsedDirectories),
      );
      setDocuments(restoredDocuments);
      setOpenPaths(restoredOpenPaths);
      setActivePath(nextActivePath);
      setPreviewPath(restoredPreviewPath);
      setRecentFiles(cached.recentFiles);
      setRecentLocations(cached.recentLocations);
      setBookmarks(cached.bookmarks);
      restoreHistory(cached.navigationHistory);
      setSidebarView(cached.sidebarView);
      setBottomPanelView(cached.bottomPanelView);
      setBottomPanelVisible(cached.bottomPanelVisible);
    },
    [restoreHistory],
  );

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
    gitDiffLoading,
    selectedGitChange,
    gitDiffPreview,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setGitDiffLoading,
    setSelectedGitChange,
    setGitDiffPreview,
    resetGitDiffWorkspaceState,
    clearGitDiffPreviewState,
    loadGitDiffDocument,
    previewGitChange,
    openGitChange,
  } = useGitDiffWorkspace({
    workspaceRoot,
    gitGateway,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    setMessage,
    recordCurrentNavigationLocation,
    reportError,
  });

  const isLanguageServerSessionCurrentForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      const currentRuntimeStatus =
        cachedLanguageServerRuntimeStatusForRoot(
          languageServerRuntimeStatusByRootRef.current,
          rootPath,
        ) ??
        (workspaceRootKeysEqual(
          languageServerRuntimeStatusRootRef.current,
          rootPath,
        )
          ? languageServerRuntimeStatusRef.current
          : null);

      return isRunningLanguageServerSessionForWorkspace(
        currentRuntimeStatus,
        currentRuntimeStatus?.rootPath ??
          languageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      );
    },
    [],
  );

  const {
    clearLanguageServerDiagnostics,
    restoreLanguageServerDiagnosticsForRoot,
    clearLanguageServerDiagnosticsForRoot,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    restoreJavaScriptTypeScriptDiagnosticsForRoot,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    updateLocalPhpDiagnostics,
    refreshLocalPhpDiagnosticsForContent,
    applyLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
  } = useDiagnostics({
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    activeDocument,
    appSettingsRef,
    workspaceSettingsRef,
    setLanguageServerDiagnosticsByPath,
    setJavaScriptTypeScriptDiagnosticsByPath,
    setPhpLocalDiagnosticsByPath,
    setLaravelDiagnosticsByPath,
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
    isLanguageServerSessionCurrentForRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
  });

  const handleMetadataScanCompletion = useCallback(
    (event: MetadataScanCompletionEvent) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.rootPath)) {
        return;
      }

      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        const clearRoot = event.rootPath;
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        activeIndexRootRef.current = null;
        indexProgressGateway
          .clearWorkspaceIndex(clearRoot)
          .catch((error) => {
            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, clearRoot)) {
              return;
            }

            reportError("Index", error);
          });
        return;
      }

      if (pendingIndexScanRef.current) {
        if (!workspaceRootKeysEqual(pendingIndexRootRef.current, event.rootPath)) {
          return;
        }
      } else {
        if (!workspaceRootKeysEqual(activeIndexRootRef.current, event.rootPath)) {
          return;
        }
      }

      const message = indexProgressCompletionMessage(event);
      const severity = indexProgressNoticeSeverity(event);
      const groupKey = indexProgressNoticeGroup(event.rootPath);

      pendingIndexScanRef.current = false;
      pendingIndexRootRef.current = null;
      activeIndexRootRef.current = event.rootPath;
      resetPhpFrameworkCachesRef.current();
      setIndexProgress((current) =>
        applyMetadataScanCompletion(current, event),
      );
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(current, createIndexHealthCompletionLog(event)),
      );
      setMessage(message);
      setNotices((current) =>
        replaceWorkbenchNoticeGroup(
          current,
          groupKey,
          severity
            ? [createWorkbenchNotice(severity, "Index", message, groupKey)]
            : [],
        ),
      );
    },
    [indexProgressGateway, reportError],
  );

  const handleIndexProgress = useCallback((event: IndexProgressEvent) => {
    // Per-workspace isolation: drop progress for any root that is not the active workspace and the
    // root the in-flight index was actually started for, so a stale background run can never paint
    // the newly-active workspace's status bar. Progress is purely advisory - completion/failure are
    // still owned by handleMetadataScanCompletion.
    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.rootPath)) {
      return;
    }

    const indexRoot = pendingIndexScanRef.current
      ? pendingIndexRootRef.current
      : activeIndexRootRef.current;

    if (!workspaceRootKeysEqual(indexRoot, event.rootPath)) {
      return;
    }

    setIndexProgress((current) => {
      if (
        current.rootPath &&
        !workspaceRootKeysEqual(current.rootPath, event.rootPath)
      ) {
        return current;
      }

      return applyIndexProgress(current, event);
    });
  }, []);

  const startInitialIndexScan = useCallback(
    async (rootPath: string) => {
      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        return;
      }

      pendingIndexScanRef.current = true;
      pendingIndexRootRef.current = rootPath;

      try {
        const started = await indexProgressGateway.startInitialMetadataScan(
          rootPath,
        );

        if (
          !pendingIndexScanRef.current ||
          !workspaceRootKeysEqual(pendingIndexRootRef.current, rootPath)
        ) {
          return;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          pendingIndexScanRef.current = false;
          pendingIndexRootRef.current = null;
          return;
        }

        if (!workspaceRootKeysEqual(started.rootPath, rootPath)) {
          pendingIndexScanRef.current = false;
          pendingIndexRootRef.current = null;
          return;
        }

        activeIndexRootRef.current = started.rootPath;
        setIndexProgress(startIndexProgress(started));
        setIndexHealthLogs((current) =>
          prependIndexHealthLog(
            current,
            createIndexHealthLogEntry("info", rootPath, "Indexing workspace."),
          ),
        );
        setMessage("Indexing workspace.");
      } catch (error) {
        if (!workspaceRootKeysEqual(pendingIndexRootRef.current, rootPath)) {
          return;
        }

        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        reportError("Index", error);
      }
    },
    [indexProgressGateway, reportError],
  );

  const clearIndexWorkspaceState = useCallback(() => {
    pendingIndexScanRef.current = false;
    pendingIndexRootRef.current = null;
    activeIndexRootRef.current = null;
    lastPhpFileOutlineRefreshKeyRef.current = null;
    resetPhpFrameworkCachesRef.current();
    setIndexProgress(initialIndexProgress());
    setIndexHealthLogs([]);
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
    setNotices((current) =>
      current.filter((notice) => !notice.groupKey?.startsWith("index-progress:")),
    );
  }, []);

  const clearWorkspaceIndex = useCallback(
    async (rootPath: string, message?: string) => {
      clearIndexWorkspaceState();

      try {
        await indexProgressGateway.clearWorkspaceIndex(rootPath);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        if (message) {
          setMessage(message);
        }
      } catch (error) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        reportError("Index", error);
      }
    },
    [clearIndexWorkspaceState, indexProgressGateway, reportError],
  );

  const nextDocumentVersion = useCallback((rootPath: string, path: string): number => {
    const key = languageServerDocumentSyncKey(rootPath, path);
    const next = (documentVersionsRef.current[key] || 0) + 1;
    documentVersionsRef.current[key] = next;
    documentVersionsByUriRef.current[
      languageServerUriSyncKey(rootPath, fileUriFromPath(path))
    ] = next;
    return next;
  }, []);

  const nextJavaScriptTypeScriptDocumentVersion = useCallback(
    (rootPath: string, path: string): number => {
      const key = languageServerDocumentSyncKey(rootPath, path);
      const next =
        (javaScriptTypeScriptDocumentVersionsRef.current[key] || 0) + 1;
      javaScriptTypeScriptDocumentVersionsRef.current[key] = next;
      javaScriptTypeScriptDocumentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(path))
      ] =
        next;
      return next;
    },
    [],
  );

  const clearDocumentChangeTimer = useCallback((key: string) => {
    const timer = documentChangeTimersRef.current[key];

    if (!timer) {
      return;
    }

    window.clearTimeout(timer);
    delete documentChangeTimersRef.current[key];
  }, []);

  const clearJavaScriptTypeScriptDocumentChangeTimer = useCallback(
    (key: string) => {
      const timer = javaScriptTypeScriptDocumentChangeTimersRef.current[key];

      if (!timer) {
        return;
      }

      window.clearTimeout(timer);
      delete javaScriptTypeScriptDocumentChangeTimersRef.current[key];
    },
    [],
  );

  const enqueueDocumentSync = useCallback(
    (path: string, operation: () => Promise<void>) => {
      const previous = documentSyncQueuesRef.current[path] || Promise.resolve();
      const next = previous.then(operation, operation);
      const queued = next.catch(() => undefined);
      documentSyncQueuesRef.current[path] = queued;

      queued.finally(() => {
        if (documentSyncQueuesRef.current[path] !== queued) {
          return;
        }

        delete documentSyncQueuesRef.current[path];
      });

      return next;
    },
    [],
  );

  const enqueueJavaScriptTypeScriptDocumentSync = useCallback(
    (key: string, operation: () => Promise<void>) => {
      const previous =
        javaScriptTypeScriptDocumentSyncQueuesRef.current[key] ||
        Promise.resolve();
      const next = previous.then(operation, operation);
      const queued = next.catch(() => undefined);
      javaScriptTypeScriptDocumentSyncQueuesRef.current[key] = queued;

      queued.finally(() => {
        if (javaScriptTypeScriptDocumentSyncQueuesRef.current[key] !== queued) {
          return;
        }

        delete javaScriptTypeScriptDocumentSyncQueuesRef.current[key];
      });

      return next;
    },
    [],
  );

  const resetLanguageServerDocuments = useCallback(() => {
    documentSyncGenerationRef.current += 1;
    Object.keys(documentChangeTimersRef.current).forEach(clearDocumentChangeTimer);
    documentSyncRuntimeSignatureRef.current = null;
    syncedDocumentPathsRef.current.clear();
    syncedDocumentContentRef.current = {};
    pendingDocumentChangesRef.current = {};
    pendingDocumentOpenSyncAttemptsRef.current = {};
    documentVersionsRef.current = {};
    documentVersionsByUriRef.current = {};
    lastAppliedDiagnosticVersionByUriRef.current = {};
    documentSyncQueuesRef.current = {};
    // A document-sync reset means the phpactor session/generation changed, so
    // its index is cold again: allow the next PHP didOpen to re-fire the
    // force-index warm-up.
    phpLanguageServerIndexWarmedRootsRef.current.clear();
  }, [clearDocumentChangeTimer]);

  const resetJavaScriptTypeScriptLanguageServerDocuments = useCallback(() => {
    javaScriptTypeScriptDocumentSyncGenerationRef.current += 1;
    Object.keys(javaScriptTypeScriptDocumentChangeTimersRef.current).forEach(
      clearJavaScriptTypeScriptDocumentChangeTimer,
    );
    javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current = null;
    javaScriptTypeScriptSyncedDocumentPathsRef.current.clear();
    javaScriptTypeScriptSyncedDocumentContentRef.current = {};
    javaScriptTypeScriptPendingDocumentChangesRef.current = {};
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current = {};
    javaScriptTypeScriptDocumentVersionsRef.current = {};
    javaScriptTypeScriptDocumentVersionsByUriRef.current = {};
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current = {};
    javaScriptTypeScriptDocumentSyncQueuesRef.current = {};
  }, [clearJavaScriptTypeScriptDocumentChangeTimer]);

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
  } = useLanguageServerRuntimeLifecycle({
    workspaceRoot,
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
    resetLanguageServerDocuments,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    isLanguageServerSessionCurrentForRoot,
    reportError,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
  });

  const {
    javaScriptTypeScriptFileStructureOutlineForDocument,
    javaScriptTypeScriptFileStructureLoadingForDocument,
    openJavaScriptTypeScriptFileStructure,
    resetJavaScriptTypeScriptFileStructure,
  } = useJavaScriptTypeScriptFileStructure({
    workspaceRoot,
    currentWorkspaceRootRef,
    languageServerFeaturesGateway:
      javaScriptTypeScriptLanguageServerFeaturesGateway,
    languageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    languageServerRuntimeStatusRoot:
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    isLanguageServerSessionActiveForRoot:
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    reportError,
    setMessage,
    setFileStructureOpen,
    setFileStructureScopeCurrent:
      setJavaScriptTypeScriptFileStructureScopeCurrent,
  });

  // Cold first-nav fix: the open-time PHP probe only starts phpactor; it never
  // issues a real LSP request, so phpactor's index stays cold until the user's
  // first Cmd+B / hover / completion eats the full cold-index latency. After
  // the first PHP document is synced (didOpen) we fire one low-priority,
  // fire-and-forget documentSymbol request to force phpactor to index, so the
  // first real navigation is already warm (PhpStorm-style pre-warm).
  //
  // Isolation: the requested root and session are captured up front; the
  // post-await re-check drops the warm-up if the workspace switched or the
  // phpactor session changed before it ran, and the result is discarded. The
  // per-root warmed-set guard keeps it to exactly once per workspace
  // session/root (no flood, no cross-tab leak).
  const warmUpPhpLanguageServerIndex = useCallback(
    (rootPath: string, path: string, requestedSessionId: number) => {
      if (phpLanguageServerIndexWarmedRootsRef.current.has(rootPath)) {
        return;
      }

      if (!isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)) {
        return;
      }

      phpLanguageServerIndexWarmedRootsRef.current.add(rootPath);

      void (async () => {
        try {
          await languageServerFeaturesGateway.documentSymbols(rootPath, path);
        } catch {
          // The warm-up is best-effort: its only purpose is to force phpactor
          // to index. Failures (a transient phpactor error or a session/root
          // teardown mid-flight) are swallowed and never surfaced to the user.
          // Roll back the warmed flag so the next PHP didOpen on this root can
          // retry; the once-per-root guard still prevents a flood. The set is
          // cleared anyway when the session/generation changes
          // (resetLanguageServerDocuments), so a stale root just no-ops there.
          phpLanguageServerIndexWarmedRootsRef.current.delete(rootPath);
        }
      })();
    },
    [isLanguageServerSessionCurrentForRoot, languageServerFeaturesGateway],
  );

  const {
    syncOpenDocument,
    syncOpenJavaScriptTypeScriptDocument,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerDocumentSynced,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
  } = useDocumentSync({
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
    javaScriptTypeScriptDocumentSyncQueuesRef,
    javaScriptTypeScriptDocumentSyncGenerationRef,
    javaScriptTypeScriptDocumentVersionsRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
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
    warmUpPhpLanguageServerIndex,
    isLanguageServerSessionCurrentForRoot,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isRunningLanguageServerForWorkspace,
    isSessionPathInWorkspace,
    isJavaScriptTypeScriptDocumentSyncableForRoot,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
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
    (
      path: string,
      position: EditorPosition,
      label: string,
      options?: { readOnly?: boolean },
    ) =>
      openSymbolPanelNavigationTargetRef.current(
        path,
        position,
        label,
        options,
      ),
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
    setQuickOpenOpen,
    setTextSearchOpen,
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
    workspaceRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    openNavigationTarget: openSymbolPanelNavigationTarget,
    shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
    closeCompetingSurfaces: closeSymbolPanelCompetingSurfaces,
    reportError,
    setMessage,
  });

  const resetFilePrefetchState = useCallback(() => {
    for (const timer of filePrefetchTimersRef.current.values()) {
      clearTimeout(timer);
    }

    filePrefetchTimersRef.current.clear();
    filePrefetchCacheRef.current.clear();
  }, []);

  const clearActiveWorkspace = useCallback(async () => {
    const currentRootPath = currentWorkspaceRootRef.current;

    if (currentRootPath) {
      await stopProjectRuntimes(currentRootPath);
      languageServerDiagnosticsCoalescerRef.current?.dropRoot(currentRootPath);
      javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(
        currentRootPath,
      );
    }

    workspaceSessionRestoredRef.current = false;
    currentWorkspaceRootRef.current = null;
    workspaceStateCacheRef.current = {};
    editorConfigCacheRef.current = {};
    resetFilePrefetchState();
    languageServerRuntimeStatusByRootRef.current = {};
    languageServerDiagnosticsByRootRef.current = {};
    javaScriptTypeScriptRuntimeStatusByRootRef.current = {};
    javaScriptTypeScriptDiagnosticsByRootRef.current = {};
    lastLanguageServerCrashRef.current = null;
    lastPhpIdeReadinessSignatureRef.current = null;
    installingManagedPhpactorRootRef.current = null;
    openWorkspaceRequestTokenRef.current += 1;
    openWorkspaceRequestPathRef.current = null;
    openFileRequestTokenRef.current += 1;
    resetActiveEditorPosition();
    setWorkspaceRoot(null);
    setWorkspaceDescriptor(null);
    setWorkspaceTrust(null);
    setPhpTools(null);
    setLanguageServerPlan(null);
    setJavaScriptTypeScriptLanguageServerPlan(null);
    setLanguageServerRuntimeStatus(null);
    setLanguageServerRuntimeStatusRoot(null);
    setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
    setEntriesByDirectory({});
    setLoadingDirectories(new Set());
    setExpandedDirectories(new Set());
    setManuallyCollapsedDirectories(new Set());
    setDocuments({});
    setOpenPaths([]);
    setActivePath(null);
    setPreviewPath(null);
    setRecentFiles([]);
    setRecentLocations([]);
    setBookmarks([]);
    closeBookmarksPanel();
    setGitBlameEnabledPaths(new Set());
    setEditorRevealTarget(null);
    resetHistory();
    setSidebarView("files");
    setBottomPanelView("problems");
    setBottomPanelVisible(false);
    resetWorkspaceTodos();
    setGitStatus(emptyGitStatus());
    setGitRepositoryStatuses([]);
    setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
    setGitLoading(false);
    resetGitDiffWorkspaceState();
    setEditorGitBaselinesByPath({});
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
  }, [
    applyWorkspaceSettings,
    clearIndexWorkspaceState,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    resetActiveEditorPosition,
    resetFilePrefetchState,
    resetHistory,
    resetGitDiffWorkspaceState,
    resetSearchEverywhere,
    resetJavaScriptTypeScriptFileStructure,
    resetTextSearchState,
    stopProjectRuntimes,
  ]);


  const loadDirectory = useCallback(
    async (
      path: string,
      options: {
        clearMessage?: boolean;
        requireActiveRoot?: boolean;
      } = {},
    ) => {
      // Subdirectory loads stay valid as long as the path still belongs to the
      // live workspace root. The workspace-root load sub-task instead opts into
      // exact-root matching so that switching to a parent workspace (whose root
      // a now-stale nested root would still "belong to") cannot let stale
      // entries leak into the active tree.
      const isActiveRoot = () =>
        options.requireActiveRoot
          ? workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)
          : workspacePathBelongsToRoot(path, currentWorkspaceRootRef.current);

      setLoadingDirectories((current) => new Set(current).add(path));

      try {
        const entries = await workspaceFiles.readDirectory(path);
        if (!isActiveRoot()) {
          return;
        }

        setEntriesByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
        if (options.clearMessage !== false) {
          setMessage(null);
        }
      } catch (error) {
        if (!isActiveRoot()) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message.toLowerCase()
            : String(error).toLowerCase();
        const isMissingDirectory =
          message.includes("enoent") ||
          message.includes("no such file") ||
          message.includes("not a directory");

        if (isMissingDirectory) {
          setEntriesByDirectory((current) => {
            if (!(path in current)) {
              return current;
            }

            const next = { ...current };
            delete next[path];
            return next;
          });
          return;
        }

        reportError("Workspace", error);
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [reportError, workspaceFiles],
  );

  const restoreWorkspaceSession = useCallback(
    async (rootPath: string, session: WorkspaceSessionState) => {
      const paths = session.openPaths.filter(
        (path) =>
          isPersistableEditorDocumentPath(path) &&
          isSessionPathInWorkspace(rootPath, path),
      );

      if (paths.length === 0) {
        setSidebarView(session.sidebarView);
        setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));
        return;
      }

      const reads = await Promise.allSettled(
        paths.map((path) => workspaceFiles.readTextFile(path)),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      const restoredDocuments: Record<string, EditorDocument> = {};
      const restoredPaths: string[] = [];
      let failedCount = 0;

      paths.forEach((path, index) => {
        const read = reads[index];

        if (read.status !== "fulfilled") {
          failedCount += 1;
          return;
        }

        const content = read.value;
        restoredDocuments[path] = {
          content,
          language: detectLanguage(path),
          name: getFileName(path),
          path,
          savedContent: content,
        };
        restoredPaths.push(path);
      });

      const nextActivePath = restoredActivePath(session.activePath, restoredPaths);

      setDocuments(restoredDocuments);
      setOpenPaths(restoredPaths);
      setActivePath(nextActivePath);
      setSidebarView(session.sidebarView);
      setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));

      const restoredActiveDocument = nextActivePath
        ? restoredDocuments[nextActivePath]
        : null;

      if (restoredActiveDocument?.language === "php") {
        updateLocalPhpDiagnostics(
          restoredActiveDocument.path,
          localPhpDiagnosticsFromSource(restoredActiveDocument.content, []),
        );
      }

      if (failedCount === 0) {
        return;
      }

      setNotices((current) => [
        createWorkbenchNotice(
          "warning",
          "Session",
          `Could not restore ${failedCount} tab${failedCount === 1 ? "" : "s"}.`,
        ),
        ...current,
      ]);
    },
    [updateLocalPhpDiagnostics, workspaceFiles],
  );

  // Monotonic token guarding git-repository discovery against re-entrancy: the
  // newest discovery request always wins, so two rapid git-mapping settings
  // changes (or an open racing a save) can never let a slower earlier detection
  // publish stale mappings.
  const gitRepositoryDiscoveryRequestTokenRef = useRef(0);

  // Discover nested git repositories (PhpStorm-style directory mappings) for
  // `rootPath` from its settings and publish the effective mappings so every git
  // operation routes into the repository that owns each file. Auto-detection is
  // optional (the gateway may not implement it) and gated on the workspace
  // setting; manual mappings are always honoured. Per-root isolated: captures
  // `rootPath` and, after the (optional) detection await, re-checks BOTH the
  // discovery token (last request wins) and the live workspace root before
  // publishing, dropping any stale or superseded result. On failure or when auto
  // is off it falls back to the manual mappings plus the workspace root
  // (single-repo behaviour). Shared by the open flow and the settings-save flow
  // so both resolve mappings identically.
  const runGitRepositoryDiscovery = useCallback(
    async (rootPath: string, settings: WorkspaceSettings): Promise<void> => {
      const requestToken = gitRepositoryDiscoveryRequestTokenRef.current + 1;
      gitRepositoryDiscoveryRequestTokenRef.current = requestToken;

      const auto = settings.gitDirectoryMappingsAuto;
      let detected: string[] | null = null;

      try {
        if (auto && gitGateway.detectRepositories) {
          detected = await gitGateway.detectRepositories(rootPath);
        }
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(rootPath, "Git", error);
      }

      if (gitRepositoryDiscoveryRequestTokenRef.current !== requestToken) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setGitRepositoryMappings(
        resolveEffectiveGitRepositoryMappings({
          manualMappings: settings.gitDirectoryMappings,
          detectedDirectories: detected,
          auto,
        }),
      );
    },
    [gitGateway, reportErrorForActiveWorkspaceRoot],
  );

  const openWorkspacePath = useCallback(
    async (path: string, options: OpenWorkspacePathOptions = {}) => {
      const shouldCachePreviousWorkspace =
        options.cachePreviousWorkspace !== false;
      const requestToken = openWorkspaceRequestTokenRef.current + 1;
      openWorkspaceRequestTokenRef.current = requestToken;
      openWorkspaceRequestPathRef.current = path;
      const isCurrentOpenWorkspaceRequest = () =>
        openWorkspaceRequestTokenRef.current === requestToken &&
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path);
      const previousRootPath = currentWorkspaceRootRef.current;
      const cachedWorkspaceState = workspaceStateCacheRef.current[path] ?? null;
      const switchingWorkspace =
        previousRootPath &&
        !workspaceRootKeysEqual(previousRootPath, path);

      if (switchingWorkspace) {
        resetFilePrefetchState();
      }

      if (switchingWorkspace && shouldCachePreviousWorkspace) {
        openFileRequestTokenRef.current += 1;
        cacheCurrentWorkspaceState(previousRootPath);
      } else if (switchingWorkspace) {
        openFileRequestTokenRef.current += 1;
      }

      if (switchingWorkspace) {
        await Promise.allSettled([
          closeSyncedLanguageServerDocumentsForRoot(previousRootPath),
          closeSyncedJavaScriptTypeScriptDocumentsForRoot(previousRootPath),
        ]);

        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }
      }

      workspaceSessionRestoredRef.current = false;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
      resetActiveEditorPosition();
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      clearPhpLocalDiagnostics();
      let workspaceSettings = defaultWorkspaceSettings();

      try {
        workspaceSettings = await settingsGateway.loadWorkspaceSettings(path);
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      setWorkspaceRoot(path);
      currentWorkspaceRootRef.current = path;
      lastLanguageServerCrashRef.current = null;
      restoreLanguageServerDiagnosticsForRoot(path);
      restoreJavaScriptTypeScriptDiagnosticsForRoot(path);

      if (cachedWorkspaceState) {
        restoreCachedWorkspaceState(cachedWorkspaceState);
      } else {
        setEntriesByDirectory({});
        setExpandedDirectories(new Set([path]));
        setManuallyCollapsedDirectories(new Set());
        setDocuments({});
        setOpenPaths([]);
        setActivePath(null);
        setPreviewPath(null);
        setRecentFiles([]);
        setRecentLocations([]);
        setBookmarks([]);
        setGitBlameEnabledPaths(new Set());
        resetHistory();
        setSidebarView("files");
        setBottomPanelView("problems");
        setBottomPanelVisible(false);
        setIndexProgress(initialIndexProgress());
        setIndexHealthLogs([]);
      }

      // The TODO panel is a transient, workspace-scoped overlay (not part of the
      // cached per-tab state). Always reset it on a switch so one project's TODOs
      // can never appear inside another project's tab.
      resetWorkspaceTodos();
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
      closeBookmarksPanel();

      setEditorRevealTarget(null);
      setLoadingDirectories(new Set());
      applyWorkspaceSettings(workspaceSettings);
      setIntelligenceMode(workspaceSettings.intelligenceMode);
      setWorkspaceDescriptor(null);
      setPhpTools(null);
      setWorkspaceTrust(null);
      setLanguageServerPlan(null);
      setJavaScriptTypeScriptLanguageServerPlan(null);
      const cachedPhpStatus = cachedLanguageServerRuntimeStatusForRoot(
        languageServerRuntimeStatusByRootRef.current,
        path,
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
      setGitStatus(emptyGitStatus(path));
      setGitRepositoryStatuses([]);
      setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
      setGitLoading(false);
      resetGitDiffWorkspaceState();
      setEditorGitBaselinesByPath({});
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
      activeIndexRootRef.current = cachedWorkspaceState?.indexProgress.rootPath ?? null;
      pendingIndexScanRef.current = false;
      autoStartedLanguageServerRootRef.current = null;
      phpLanguageServerAutostartAttemptsByRootRef.current = {};
      installingManagedPhpactorRootRef.current = null;
      setInstallingManagedPhpactor(false);
      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;

      try {
        const nextWorkspaceTabs = workspaceTabsWithPath(
          appSettingsRef.current.workspaceTabs,
          path,
        );
        await persistAppSettings({
          ...appSettingsRef.current,
          recentWorkspacePath: path,
          workspaceTabs: nextWorkspaceTabs,
        });
        await stopBackgroundProjectRuntimes(
          appSettingsRef.current.runtimePolicy,
          path,
          previousRootPath,
        );
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
        const smartMode = await smartModeGateway.setMode(
          workspaceSettings.intelligenceMode,
        );

        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        resolvedIntelligenceMode = smartMode.mode;
        intelligenceModeRef.current = smartMode.mode;
        setIntelligenceMode(smartMode.mode);
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("IDE Mode", error);
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      // Directory load, workspace trust, workspace detection and session
      // restore are all independent of one another, so they run concurrently.
      // Each sub-task keeps its own try/catch plus a post-await isolation guard
      // (workspaceRootKeysEqual against the live root) so that switching to
      // another project mid-flight never lets stale results mutate the active
      // workspace state.
      const loadDirectoryTask = async (): Promise<void> => {
        if (cachedWorkspaceState?.entriesByDirectory[path]) {
          return;
        }

        // Match the other concurrent sub-tasks: opt into the exact-root guard so
        // a parent-workspace switch mid-load cannot let stale entries leak, and
        // re-check the live root once more after the await before trusting that
        // this open is still the active one.
        await loadDirectory(path, { requireActiveRoot: true });

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }
      };

      const loadTrustTask = async (): Promise<void> => {
        try {
          const trust = await workspaceTrustGateway.getTrust(path);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
            return;
          }

          setWorkspaceTrust(trust);
        } catch (error) {
          reportErrorForActiveWorkspaceRoot(path, "Workspace Trust", error);
        }
      };

      // Warmup: the phpactor handshake (composer/autoload scan) is the
      // dominant time-to-ready cost and is phpactor-internal, so the only safe
      // win is to start it sooner. The PHP probe (detectPhpTools -> plan ->
      // autostart) only needs the workspace descriptor to know the project is
      // PHP, so as soon as detection confirms a PHP project in IDE (full smart)
      // mode we fire the probe in parallel with the directory load and session
      // restore instead of serializing it behind them. The handshake then warms
      // up in the background while the user navigates. This is gated to IDE mode
      // (preserving the basic/light-mode defer) and is per-root isolated: the
      // probe captures `path` and re-checks the active root after its own
      // awaits, and detection itself drops stale results before triggering it.
      let warmedUpPhpProbe = false;
      const detectWorkspaceTask =
        async (): Promise<WorkspaceDescriptor | null> => {
          try {
            const detected = await workspaceDetection.detectWorkspace(path);

            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
              // Stale: the active workspace changed while detection was in
              // flight. Return null (never the stale descriptor) so the PHP
              // setup branch only ever sees the descriptor of the still-active
              // open request.
              return null;
            }

            setWorkspaceDescriptor(detected);

            if (
              detected?.php &&
              shouldStartLanguageServer(resolvedIntelligenceMode)
            ) {
              warmedUpPhpProbe = true;
              void runPhpWorkspaceProbe(path);
            }

            return detected;
          } catch (error) {
            reportErrorForActiveWorkspaceRoot(
              path,
              "Workspace Detection",
              error,
            );
            return null;
          }
        };

      const restoreSessionTask = async (): Promise<void> => {
        if (cachedWorkspaceState) {
          workspaceSessionRestoredRef.current = true;
          return;
        }

        await restoreWorkspaceSession(path, workspaceSettings.session);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }

        workspaceSessionRestoredRef.current = true;
      };

      // Discover nested git repositories from the freshly loaded workspace
      // settings, sharing the isolated, re-entrancy-guarded discovery used by
      // the settings-save flow so both resolve mappings identically.
      const discoverGitRepositoriesTask = (): Promise<void> =>
        runGitRepositoryDiscovery(path, workspaceSettings);

      // Fire-and-forget plans/scans that already isolate themselves per root.
      void refreshJavaScriptTypeScriptLanguageServerPlan(path);

      if (
        shouldIndexWorkspace(resolvedIntelligenceMode) &&
        shouldRunInitialIndexScan(cachedWorkspaceState)
      ) {
        void startInitialIndexScan(path);
      }

      const [, , descriptor] = await Promise.all([
        loadDirectoryTask(),
        loadTrustTask(),
        detectWorkspaceTask(),
        restoreSessionTask(),
        discoverGitRepositoriesTask(),
      ]);

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      if (!descriptor?.php) {
        setLanguageServerPlan(null);
        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []),
        );
        return;
      }

      // The PHP language server only runs in IDE (full smart) mode, so in
      // basic/light mode the open-time PHP probe (detectPhpTools +
      // planPhpLanguageServer) is pure overhead. Defer it: keep the plan and
      // setup notice cleared and replay the probe when the user enables IDE
      // mode (setSmartMode) or, eventually, lazily on demand.
      if (!shouldStartLanguageServer(resolvedIntelligenceMode)) {
        setLanguageServerPlan(null);
        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []),
        );
        return;
      }

      // The probe is fired eagerly during detection (warmup) for IDE-mode PHP
      // projects, so once it has warmed up there is nothing left to do here.
      if (warmedUpPhpProbe) {
        return;
      }

      await runPhpWorkspaceProbe(path);
    },
    [
      applyWorkspaceSettings,
      cacheCurrentWorkspaceState,
      loadDirectory,
      persistAppSettings,
      runPhpWorkspaceProbe,
      reportError,
      restoreLanguageServerDiagnosticsForRoot,
      restoreCachedWorkspaceState,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreWorkspaceSession,
      runGitRepositoryDiscovery,
      resetActiveEditorPosition,
      resetFilePrefetchState,
      resetGitDiffWorkspaceState,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere,
      resetTextSearchState,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      clearPhpLocalDiagnostics,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      settingsGateway,
      smartModeGateway,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      workspaceDetection,
      workspaceTrustGateway,
      refreshJavaScriptTypeScriptLanguageServerPlan,
    ],
  );

  const openWorkspace = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open workspace",
    });

    if (typeof selected !== "string") {
      return;
    }

    await openWorkspacePath(selected);
  }, [openWorkspacePath]);

  const openWorkspaceRoot = useCallback(
    async (path: string): Promise<boolean> => {
      await openWorkspacePath(path);

      return workspaceRootKeysEqual(currentWorkspaceRootRef.current, path);
    },
    [openWorkspacePath],
  );

  const activateWorkspaceTab = useCallback(
    async (path: string) => {
      if (workspaceRootKeysEqual(path, workspaceRoot)) {
        return;
      }

      await openWorkspacePath(path);
    },
    [openWorkspacePath, workspaceRoot],
  );

  const {
    closeApplicationWindow,
    closeWorkspaceTab,
    quitApplication,
  } = useWorkbenchCloseLifecycle({
    workspaceRoot,
    dirtyCount,
    appSettingsRef,
    workspaceStateCacheRef,
    editorConfigCacheRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    prompter,
    persistAppSettings,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    stopProjectRuntimes,
    forgetLanguageServerRuntimeStatuses,
    forgetLatencyTrackerForRoot,
    openWorkspacePath,
    clearActiveWorkspace,
    reportError,
  });

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
    activePath,
    documents,
    openPaths,
    gitStatus,
    appSettingsRef,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    openFileRequestTokenRef,
    openingFileFlagOwnerTokenRef,
    emptyDocumentRefreshTimeoutsRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    setIsOpeningFile,
    setSelectedGitChange,
    setGitDiffPreview,
    setGitDiffLoading,
    setMessage,
    workspaceFiles,
    forgetExternallyRemovedDocumentPath,
    gitChangeForDiffDocumentPath,
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

  const toggleDirectory = useCallback(
    async (path: string) => {
      const isExpanded = expandedDirectories.has(path);

      setExpandedDirectories((current) => {
        const next = new Set(current);

        if (next.has(path)) {
          next.delete(path);
          return next;
        }

        next.add(path);
        return next;
      });

      setManuallyCollapsedDirectories((current) => {
        const next = new Set(current);

      if (isExpanded) {
        next.add(path);
        return next;
      }

        next.delete(path);
        return next;
      });

      if (isExpanded || entriesByDirectory[path]) {
        return;
      }

      // Folder-expand latency: only timed here (the interactive expand of an
      // uncached directory), not for the many programmatic `loadDirectory`
      // callers (workspace-root load, session restore, reveal), so the metric
      // reflects what the user feels when clicking a folder chevron.
      if (!workspaceRoot) {
        await loadDirectory(path);
        return;
      }

      await measureLatency(
        latencyTrackerForRoot(workspaceRoot),
        "folderExpand",
        () => loadDirectory(path),
      );
    },
    [
      entriesByDirectory,
      expandedDirectories,
      latencyTrackerForRoot,
      loadDirectory,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (
      !workspaceRoot ||
      !activePath ||
      !workspaceSettings.revealActiveFileInTree
    ) {
      return;
    }

    const directories = parentDirectoriesInWorkspace(workspaceRoot, activePath);

    if (directories.length === 0) {
      return;
    }

    setExpandedDirectories((current) => {
      const next = new Set(current);
      let changed = false;

      for (const directory of directories) {
        if (
          isBlockedByManuallyCollapsedDirectory(
            directory,
            manuallyCollapsedDirectories,
          )
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
        isBlockedByManuallyCollapsedDirectory(
          directory,
          manuallyCollapsedDirectories,
        ) ||
        entriesByDirectory[directory] ||
        loadingDirectories.has(directory)
      ) {
        continue;
      }

      void loadDirectory(directory, { clearMessage: false });
    }
  }, [
    activePath,
    manuallyCollapsedDirectories,
    loadingDirectories,
    loadDirectory,
    workspaceRoot,
    workspaceSettings.revealActiveFileInTree,
  ]);

  const {
    closeGitDiffPreview,
    closeSelectedGitDiffPreviewForChanges,
  } = useGitDiffPreviewCloseLifecycle({
    gitStatusChanges: gitStatus.changes,
    selectedGitChange,
    documentsRef,
    openPathsRef,
    previewPathRef,
    selectedGitChangeRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    clearGitDiffPreviewState,
    gitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    loadGitDiffDocument,
  });

  // Resolves the git repository (and in-repo path) that owns an absolute file
  // path: a file in a nested repository (directory mapping) routes to that repo
  // root + its repo-relative path, so its gutter diff, blame and file history
  // run against the correct repository. Falls back to the workspace root (the
  // pre-multi-repo behaviour) for primary-repo files and any path the resolver
  // declines. `null` only when there is no workspace or the path is outside it.
  const resolveGitRepositoryTarget = useCallback(
    (
      absolutePath: string,
    ): { repositoryRoot: string; relativePath: string } | null => {
      const root = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!root) {
        return null;
      }

      const resolved = resolveGitRepositoryForPath(
        gitRepositoryMappings,
        root,
        absolutePath,
      );

      if (resolved && resolved.repositoryRelativePath !== "") {
        return {
          repositoryRoot: resolved.repositoryRoot,
          relativePath: resolved.repositoryRelativePath,
        };
      }

      const relativePath = workspaceRelativePath(root, absolutePath);

      if (!relativePath) {
        return null;
      }

      return { repositoryRoot: root, relativePath };
    },
    [gitRepositoryMappings, workspaceRoot],
  );

  const refreshGitStatus = useCallback(async () => {
    if (!workspaceRoot) {
      setGitStatus(emptyGitStatus());
      setGitRepositoryStatuses([]);
      setGitLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    setGitLoading(true);

    try {
      // Fan out one status request per mapped repository; a single repo's
      // failure is isolated and never breaks the others. With the default
      // single (workspace-root) mapping this is exactly one getStatus call.
      const statuses = await fanOutGitRepositoryStatuses(
        gitRepositoryMappings,
        requestedRoot,
        (root) => gitGateway.getStatus(root),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitRepositoryStatuses(statuses);
      // The primary (workspace-root) repo drives the existing single-status UI
      // and the diff-preview reconciliation below.
      const status = primaryGitStatus(statuses, requestedRoot);
      setGitStatus(status);
      const selectedGitChange = selectedGitChangeRef.current;
      if (
        selectedGitChange &&
        !status.changes.some((change) =>
          gitChangesReferToSameDiff(change, selectedGitChange),
        )
      ) {
        closeSelectedGitDiffPreviewForChanges(status.changes);
      }
      setMessage(null);
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitStatus(emptyGitStatus(requestedRoot));
      setGitRepositoryStatuses([]);
      reportError("Git", error);
    } finally {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitLoading(false);
    }
  }, [
    closeSelectedGitDiffPreviewForChanges,
    gitGateway,
    gitRepositoryMappings,
    reportError,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceRoot || !activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    // Route the gutter baseline into the repository that owns the active file: a
    // nested-repo file diffs against its own repository. The primary status is
    // published only for a primary-repo file so a nested file's status never
    // overwrites the primary Changes panel view.
    const baselineTarget = resolveGitRepositoryTarget(requestedPath);
    const baselineRepoRoot = baselineTarget
      ? baselineTarget.repositoryRoot
      : requestedRoot;
    const isPrimaryRepo = workspaceRootKeysEqual(
      baselineRepoRoot,
      requestedRoot,
    );
    const token = (editorGitBaselineRequestTokenRef.current += 1);
    let active = true;

    const loadGitBaseline = async () => {
      try {
        const status = await gitGateway.getStatus(baselineRepoRoot);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        if (isPrimaryRepo) {
          setGitStatus(status);
        }

        const change = status.changes.find(
          (candidate) =>
            candidate.path === requestedPath ||
            candidate.oldPath === requestedPath,
        );

        if (!status.isRepository || !change) {
          setEditorGitBaselinesByPath((current) => ({
            ...current,
            [requestedPath]: null,
          }));
          return;
        }

        const diff = await gitGateway.getDiff(baselineRepoRoot, change);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setEditorGitBaselinesByPath((current) => ({
          ...current,
          [requestedPath]: diff.originalContent,
        }));
      } catch {
        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setEditorGitBaselinesByPath((current) => ({
          ...current,
          [requestedPath]: null,
        }));
      }
    };

    void loadGitBaseline();

    return () => {
      active = false;
    };
  }, [
    activeDocument?.path,
    activeDocument?.savedContent,
    gitGateway,
    resolveGitRepositoryTarget,
    workspaceRoot,
  ]);

  const applyGitOperationStatus = useCallback(
    (status: GitStatus) => {
      setGitStatus(status);

      if (
        selectedGitChange &&
        !status.changes.some((change) =>
          gitChangesReferToSameDiff(change, selectedGitChange),
        )
      ) {
        closeGitDiffPreview();
      }
    },
    [closeGitDiffPreview, selectedGitChange],
  );

  // Publishes fresh per-repository statuses after a multi-repo git operation:
  // merges them into the whole-map view so the multi-repo panel stays current.
  // The primary repo's status is applied separately via applyGitOperationStatus.
  const applyRepositoryOperationStatuses = useCallback(
    (statuses: GitRepositoryStatus[]) => {
      setGitRepositoryStatuses((current) =>
        mergeGitRepositoryStatuses(current, statuses),
      );
    },
    [],
  );

  // The status-bar git branch follows the active file: a file in a nested
  // repository (directory mapping) shows that repository's branch plus a compact
  // repo label; a file in the primary/single repository keeps the pre-multi-repo
  // behaviour (primary branch, no label). Non-file active paths (e.g. a git diff
  // pseudo-path) resolve to no repository and fall back to the primary branch.
  const gitActiveFileBranch = useMemo(
    () =>
      activeFileGitBranchInfo({
        mappings: gitRepositoryMappings,
        workspaceRoot,
        activeFilePath: activePath,
        repositoryStatuses: gitRepositoryStatuses,
        primaryBranch: gitStatus.branch,
      }),
    [
      activePath,
      gitRepositoryMappings,
      gitRepositoryStatuses,
      gitStatus.branch,
      workspaceRoot,
    ],
  );

  const {
    gitCommitMessage,
    includedGitChangePaths,
    gitOperationLoading,
    setGitCommitMessage,
    toggleGitChangeIncluded,
    stageGitChanges,
    unstageGitChanges,
    loadGitFileHunks,
    stageGitHunk,
    unstageGitHunk,
    revertGitChanges,
    commitGitChanges,
    commitAndPushGitChanges,
  } = useGitWorkspace({
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    gitStatus,
    applyGitOperationStatus,
    reportError,
    setMessage,
    prompter,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    applyRepositoryOperationStatuses,
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
        !phpInheritedFileOutlinesByPath[activeDocument.path] &&
        !loadingInheritedPhpFileOutlinePaths.has(activeDocument.path)
      ) {
        void loadInheritedPhpFileOutline(activeDocument.path);
      }
    },
    [
      activeDocument,
      loadInheritedPhpFileOutline,
      loadingInheritedPhpFileOutlinePaths,
      phpInheritedFileOutlinesByPath,
    ],
  );

  const openFileStructure = useCallback(() => {
    const document = activeDocumentRef.current;
    if (!document) {
      setMessage("Open a PHP, JavaScript, or TypeScript file to show structure.");
      return;
    }

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
      fileStructureOpen && fileStructureScope === "current"
        ? "inherited"
        : "current";
    setFileStructureScopeMode(nextScope);
    setFileStructureOpen(true);

    if (
      !phpFileOutlinesByPath[document.path] &&
      !loadingPhpFileOutlinePaths.has(document.path)
    ) {
      void loadPhpFileOutline(document.path);
    }

  }, [
    fileStructureOpen,
    fileStructureScope,
    loadPhpFileOutline,
    loadingPhpFileOutlinePaths,
    openJavaScriptTypeScriptFileStructure,
    phpFileOutlinesByPath,
    setFileStructureScopeMode,
  ]);

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
    hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
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

  // Reads (and caches) the `.editorconfig` file for one directory, scoped to
  // `requestedRoot`. Returns the parsed file, or `null` when absent. The result
  // is dropped (returns null) if the active workspace switched mid-read, so a
  // stale read can never feed another project's resolution.
  const loadEditorConfigFile = useCallback(
    async (
      requestedRoot: string,
      directory: string,
    ): Promise<EditorConfigFile | null> => {
      const cacheForRoot = (editorConfigCacheRef.current[requestedRoot] ??= {});

      if (directory in cacheForRoot) {
        return cacheForRoot[directory];
      }

      const path = editorConfigPathForDirectory(directory);
      let content: string | null = null;

      try {
        content = await workspaceFiles.readTextFile(path);
      } catch {
        content = null;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return null;
      }

      const file: EditorConfigFile | null =
        content === null
          ? null
          : { directory, parsed: parseEditorConfig(content) };
      // Re-read the per-root bucket: a workspace switch + reopen could have
      // recreated it while we awaited.
      (editorConfigCacheRef.current[requestedRoot] ??= {})[directory] = file;

      return file;
    },
    [workspaceFiles],
  );

  // Resolves the effective EditorConfig settings for `filePath` within
  // `requestedRoot` by reading the applicable `.editorconfig` cascade (deepest
  // first, stopping at the first `root = true`) and resolving glob sections.
  // Returns empty settings when nothing matches. The active root is re-checked
  // after every read; a cross-tab switch yields empty settings (the caller then
  // applies no override, i.e. editor defaults).
  const resolveEditorConfigForFile = useCallback(
    async (
      requestedRoot: string,
      filePath: string,
    ): Promise<ResolvedEditorConfig> => {
      const directories = editorConfigDirectoriesForFile(filePath, requestedRoot);
      const files: EditorConfigFile[] = [];

      for (const directory of directories) {
        const file = await loadEditorConfigFile(requestedRoot, directory);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return {};
        }

        if (!file) {
          continue;
        }

        files.push(file);

        if (file.parsed.root) {
          break;
        }
      }

      return resolveEditorConfigSettings(files, filePath, requestedRoot);
    },
    [loadEditorConfigFile],
  );

  // Recompute the resolved EditorConfig for the active document whenever it
  // changes. Captures the requested root up front and re-checks the active root
  // and active path after the async resolution before committing, so a tab or
  // file switch mid-resolution drops the stale result (per-project isolation).
  const activeDocumentPath = activeDocument?.path ?? null;
  useEffect(() => {
    if (!activeDocumentPath || !workspaceRoot) {
      activeEditorConfigRef.current = {};
      setActiveEditorConfig({});
      return;
    }

    const requestedRoot = workspaceRoot;
    let cancelled = false;

    void (async () => {
      const resolved = await resolveEditorConfigForFile(
        requestedRoot,
        activeDocumentPath,
      );

      if (
        cancelled ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        activeDocumentRef.current?.path !== activeDocumentPath
      ) {
        return;
      }

      activeEditorConfigRef.current = resolved;
      setActiveEditorConfig(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocumentPath, resolveEditorConfigForFile, workspaceRoot]);

  const {
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
  } = useDocumentSavePipeline({
    workspaceSettingsRef,
    hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
  });

  const {
    captureLocalHistorySnapshot,
    saveActiveDocument,
    closeDocument,
    closeActiveSurface,
  } = useDocumentLifecycle({
    workspaceRoot,
    activeDocument,
    documents,
    openPaths,
    activePath,
    previewPath,
    gitStatus,
    selectedGitChange,
    gitDiffLoading,
    workspaceSettings,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    externallyRemovedDocumentRootByPathRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setDocuments,
    setPreviewPath,
    setOpenPaths,
    setActivePath,
    setGitDiffLoading,
    setSelectedGitChange,
    setGitDiffPreview,
    setMessage,
    localHistoryGateway,
    workspaceFiles,
    prompter,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface: closeApplicationWindow,
    isGitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    reportError,
    reportErrorForActiveWorkspaceRoot,
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

  const setSmartMode = useCallback(
    async (mode: IntelligenceMode) => {
      const requestedRoot = workspaceRoot;
      if (!requestedRoot) {
        return;
      }

      if (mode === intelligenceMode) {
        return;
      }

      try {
        const previousMode = intelligenceMode;
        const state = await smartModeGateway.setMode(mode);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        const nextMode = state.mode;

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          intelligenceModeRef.current = nextMode;
          setIntelligenceMode(nextMode);
          autoStartedLanguageServerRootRef.current = requestedRoot;
          // "What's being killed" visibility: turning IDE mode off stops the
          // PHP language server runtime and clears the workspace index, so say
          // so up front rather than leaving the status bar silent until the
          // stop completes. The final `state.message` from the gateway (set
          // below via clearWorkspaceIndex) supersedes this once the stop
          // finishes.
          setMessage(
            `Stopping PHPactor + index for ${workspaceDisplayName(requestedRoot)}`,
          );
          await stopLanguageServerRuntime(requestedRoot);
        }

        if (!shouldStartLanguageServer(previousMode) && shouldStartLanguageServer(nextMode)) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            normalizedWorkspaceRootKey(requestedRoot)
          ];

          // Enabling IDE mode replays the PHP probe that was deferred at open
          // time (detectPhpTools + plan refresh + managed engine notice), so
          // the PHP language server can autostart and hover/completion light
          // up. Only PHP workspaces need it; the autostart effect picks up the
          // resulting ready plan.
          if (workspaceDescriptor?.php) {
            void runPhpWorkspaceProbe(requestedRoot);
          }
        }

        intelligenceModeRef.current = nextMode;
        setIntelligenceMode(nextMode);
        await persistWorkspaceSettings(requestedRoot, {
          ...workspaceSettingsRef.current,
          intelligenceMode: nextMode,
        });
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        if (shouldIndexWorkspace(nextMode)) {
          setMessage(state.message);
          await startInitialIndexScan(requestedRoot);
          return;
        }

        await clearWorkspaceIndex(requestedRoot, state.message);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "IDE Mode", error);
      }
    },
    [
      clearWorkspaceIndex,
      intelligenceMode,
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      runPhpWorkspaceProbe,
      smartModeGateway,
      startInitialIndexScan,
      stopLanguageServerRuntime,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const updateActiveDocument = useCallback(
    (content: string) => {
      if (!activeDocument || activeDocument.readOnly) {
        return;
      }

      if (content === activeDocument.content) {
        return;
      }

      pinDocument(activeDocument.path);
      if (activeDocument.language === "php") {
        phpFrameworkBindingCacheRef.current = {};
        resetPhpLaravelMorphMapModelTypeCacheRef.current();
        updateLocalPhpDiagnostics(
          activeDocument.path,
          localPhpDiagnosticsFromSource(content, []),
        );
      }
      const updatedDocument = {
        ...activeDocument,
        content,
      };
      activeDocumentRef.current = updatedDocument;
      documentsRef.current = {
        ...documentsRef.current,
        [activeDocument.path]: updatedDocument,
      };
      setDocuments((current) => {
        const currentDocument = current[activeDocument.path] ?? activeDocument;

        return {
          ...current,
          [activeDocument.path]: {
            ...currentDocument,
            content,
          },
        };
      });
    },
    [activeDocument, pinDocument, updateLocalPhpDiagnostics],
  );

  const revertActiveEditorChangeHunk = useCallback(
    (hunk: EditorChangeHunk) => {
      if (!activeDocument) {
        return;
      }

      const content = applyEditorChangeRevert(activeDocument.content, hunk);

      if (content === activeDocument.content) {
        return;
      }

      updateActiveDocument(content);
    },
    [activeDocument, updateActiveDocument],
  );

  // Returns the test file's content when it already exists, otherwise `null`.
  // Existence is probed by reading the file (the gateway rejects for a missing
  // path), so a successful read means "do not overwrite — open the existing one".
  const readTestFileIfExists = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        return await workspaceFiles.readTextFile(path);
      } catch {
        return null;
      }
    },
    [workspaceFiles],
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

      await workspaceFiles.writeTextFile(testPath, renderPhpTestSkeleton(plan));

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
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    openFile,
    readTestFileIfExists,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    workspaceDescriptor,
    workspaceFiles,
    workspaceRoot,
  ]);

  // Persists a synthesized PHP code action's NEW file (currently "Extract
  // interface", which writes a sibling `<Class>Interface.php`) to DISK and opens
  // it in a tab. Extract Interface is atomic from the user's perspective: this
  // resolves `true` ONLY when the interface file was freshly written, and the
  // Monaco command applies the paired in-document `implements` edit only then -
  // so a pre-existing target or a failed write leaves the class untouched (no
  // class implementing an interface that was never created). The interface is
  // always a sibling of the already-open class, so its directory exists and no
  // `createDirectory` is attempted (a non-idempotent create on the existing
  // sibling directory was the `File exists (os error 17)` that previously failed
  // the write yet still applied the class edit). Conservative: an already-present
  // sibling is NEVER overwritten - the class is left unchanged and a recoverable
  // message is shown. Per the per-workspace isolation rule the requested root is
  // captured up front and re-checked before each post-write UI mutation so a tab
  // switch mid-write drops the (now stale) refresh while still completing the
  // file + class edit.
  const applyPhpCodeActionNewFile = useCallback(
    async (newFile: PhpCodeActionNewFile): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const targetPath = newFile.path;
      const operationTitle = newFile.title ?? "Extract Interface";
      const result = await writeExtractedInterfaceFile(
        targetPath,
        newFile.content,
        {
          fileExists: async (path) =>
            (await readTestFileIfExists(path)) !== null,
          writeFile: (path, content) =>
            workspaceFiles.writeTextFile(path, content),
        },
      );

      if (result.status === "target-exists") {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          operationTitle,
          new Error(
            newFile.title
              ? `${getFileName(targetPath)} already exists - no changes were applied.`
              : `${getFileName(targetPath)} already exists - the class was left unchanged.`,
          ),
        );

        if (isRequestedRootActive()) {
          await openFile({
            kind: "file",
            name: getFileName(targetPath),
            path: targetPath,
          });
        }

        return false;
      }

      if (result.status === "write-failed") {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          operationTitle,
          result.error,
        );

        return false;
      }

      const parentPath = getParentPath(targetPath);

      if (isRequestedRootActive()) {
        await notifyJavaScriptTypeScriptWatchedFilesChanged([
          {
            changeType: "created",
            path: targetPath,
          },
        ]);
      }

      if (isRequestedRootActive()) {
        setExpandedDirectories((current) => new Set(current).add(parentPath));
        await refreshDirectory(parentPath);
      }

      if (isRequestedRootActive()) {
        await openFile({
          kind: "file",
          name: getFileName(targetPath),
          path: targetPath,
        });
      }

      return shouldApplyClassEditAfterWrite(result);
    },
    [
      notifyJavaScriptTypeScriptWatchedFilesChanged,
      openFile,
      readTestFileIfExists,
      refreshDirectory,
      reportErrorForActiveWorkspaceRoot,
      workspaceFiles,
      workspaceRoot,
    ],
  );

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

    const relativePath = workspaceRelativePath(
      requestedRoot,
      requestedDocument.path,
    );

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

      setMessage(missingTestPartnerMessage(navigation.direction));
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Go to Test", error);
    }
  }, [
    openFile,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const {
    activateSearchEverywhereItem,
    openClassSearchResult,
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
    runAllTestsForActiveDocument,
    runTestAt,
    runTestForActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
  } = useTerminalTestRunner({
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    setBottomPanelView,
    setBottomPanelVisible,
    setMessage,
    terminalGateway,
    workspaceDescriptor,
    workspaceRoot,
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

  // Toggles git blame annotations for the active document. State is keyed by the
  // absolute document path so it stays isolated per tab.
  const toggleGitBlame = useCallback(() => {
    const document = activeDocumentRef.current;

    if (!document) {
      return;
    }

    setGitBlameEnabledPaths((current) => {
      const next = new Set(current);

      if (next.has(document.path)) {
        next.delete(document.path);
        return next;
      }

      next.add(document.path);
      return next;
    });
  }, []);

  // Fetches per-line git blame for a document. The requested workspace root is
  // captured up front; EditorSurface re-checks the active path after the await
  // before rendering, so a stale result from a switched-away tab is dropped.
  const provideGitBlame = useCallback(
    async (path: string): Promise<GitBlameLine[]> => {
      // Route blame into the repository that owns the file so a nested-repo file
      // is blamed against its own repository, not the workspace root.
      const target = resolveGitRepositoryTarget(path);

      if (!target) {
        return [];
      }

      return gitGateway.blame(target.repositoryRoot, target.relativePath);
    },
    [gitGateway, resolveGitRepositoryTarget],
  );

  // Reads an arbitrary file's text from disk by absolute path. Used to load
  // local JSON Schemas referenced by a document's `$schema` (e.g.
  // `.phpactor.json`) so Monaco can validate inline instead of trying to fetch
  // the schema (which has no request service and would error). The path may sit
  // outside the workspace root (the phpactor schema lives in the app tools dir),
  // so this intentionally does not constrain the path to the root.
  const readWorkspaceFile = useCallback(
    (path: string): Promise<string> => workspaceFiles.readTextFile(path),
    [workspaceFiles],
  );

  const openWorkspaceFile = useCallback(
    async (
      path: string,
      request: OpenWorkspaceFileRequest,
    ): Promise<boolean> => {
      const requestedRoot = currentWorkspaceRootRef.current;
      const normalizedPath = normalizeAbsoluteWorkspacePath(path);

      if (!requestedRoot || !normalizedPath) {
        return false;
      }

      if (!absolutePathBelongsInsideRoot(normalizedPath, requestedRoot)) {
        return false;
      }

      const isCurrentRequest = () =>
        request.canOpen() &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!isCurrentRequest()) {
        return false;
      }

      const opened = await openFile(
        {
          kind: "file",
          name: getFileName(normalizedPath),
          path: normalizedPath,
        },
        { shouldCommit: isCurrentRequest },
      );

      if (!opened) {
        return false;
      }

      if (!isCurrentRequest()) {
        return false;
      }

      return activeDocumentRef.current?.path === normalizedPath;
    },
    [openFile],
  );

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
  } = useFileHistory({
    activeDocumentRef,
    currentWorkspaceRootRef,
    gitGateway,
    reportError,
    resolveGitRepositoryTarget,
    workspaceRoot,
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
    captureLocalHistorySnapshot,
    currentWorkspaceRootRef,
    documentsRef,
    filePrefetchCacheRef,
    localHistoryGateway,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    setDocuments,
    setMessage,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
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
  } = useGitStashPanel({
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    reportError,
    refreshGitStatus,
    setMessage,
    prompter,
  });

  const {
    gitBranchPanelOpen,
    gitBranchEntries,
    gitBranchLoading,
    openGitBranchPanel,
    closeGitBranchPanel,
    switchGitBranch,
    createGitBranch,
    refreshGitBranches,
  } = useGitBranchPanel({
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    reportError,
    refreshGitStatus,
    setMessage,
    prompter,
  });

  const {
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
  } = usePhpSemanticResolver({
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    fileSearch,
    intelligenceMode,
    phpClassSourcePathCacheRef,
    phpFrameworkBindingCacheRef,
    projectSymbolSearch,
    readNavigationFileContent,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    resetPhpLaravelMorphMapModelTypeCache,
    resolvePhpLaravelProjectMorphMapModelType,
  } = usePhpLaravelMorphMapResolver({
    activePhpFrameworkProviderSignature,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readNavigationFileContent,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });
  resetPhpLaravelMorphMapModelTypeCacheRef.current =
    resetPhpLaravelMorphMapModelTypeCache;

  const reclassifyPhpLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string): void => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const diagnosticsByPath = languageServerDiagnosticsByRootRef.current[rootKey];

      if (!diagnosticsByPath) {
        return;
      }

      const { workspaceSources } = currentPhpFrameworkSourceContext();

      if (workspaceSources.length === 0) {
        return;
      }

      const isActiveRoot = workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        rootPath,
      );
      let nextDiagnosticsByPath = diagnosticsByPath;
      const noticeUpdates: {
        groupKey: string;
        notices: WorkbenchNotice[];
      }[] = [];

      for (const [diagnosticPath, diagnostics] of Object.entries(
        diagnosticsByPath,
      )) {
        const document = documentsRef.current[diagnosticPath];

        if (document?.language !== "php" || diagnostics.length === 0) {
          continue;
        }

        const nextDiagnostics = filterPhpLanguageServerDiagnostics(
          document.content,
          diagnostics,
          {
            frameworkProviders: activePhpFrameworkProviders,
            frameworkSourceContext: { workspaceSources },
            path: diagnosticPath,
          },
        );

        if (languageServerDiagnosticsEqual(diagnostics, nextDiagnostics)) {
          continue;
        }

        if (nextDiagnosticsByPath === diagnosticsByPath) {
          nextDiagnosticsByPath = { ...diagnosticsByPath };
        }

        nextDiagnosticsByPath[diagnosticPath] = nextDiagnostics;

        if (!isActiveRoot) {
          continue;
        }

        const uri = fileUriFromPath(diagnosticPath);
        const groupKey = languageServerDiagnosticNoticeGroup(uri);
        const diagnosticNotices = capDiagnosticNotices(
          nextDiagnostics.map((diagnostic) =>
            createWorkbenchNotice(
              languageServerDiagnosticNoticeSeverity(diagnostic.severity),
              diagnostic.source || "Language Server",
              languageServerDiagnosticNoticeMessage(diagnostic, uri),
              groupKey,
              diagnosticNoticeNavigationTarget(uri, diagnostic),
            ),
          ),
          DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
          (hiddenCount) =>
            buildDiagnosticOverflowNotice(
              "Language Server",
              groupKey,
              hiddenCount,
            ),
        );

        noticeUpdates.push({ groupKey, notices: diagnosticNotices });
      }

      if (nextDiagnosticsByPath === diagnosticsByPath) {
        return;
      }

      languageServerDiagnosticsByRootRef.current[rootKey] = nextDiagnosticsByPath;

      if (isActiveRoot) {
        setLanguageServerDiagnosticsByPath(nextDiagnosticsByPath);
      }

      if (noticeUpdates.length === 0) {
        return;
      }

      setNotices((current) =>
        capWorkbenchNotices(
          noticeUpdates.reduce(
            (nextNotices, update) =>
              replaceWorkbenchNoticeGroup(
                nextNotices,
                update.groupKey,
                update.notices,
              ),
            current,
          ),
          GLOBAL_NOTICE_LIMIT,
          isCappableDiagnosticNotice,
        ),
      );
    },
    [activePhpFrameworkProviders, currentPhpFrameworkSourceContext],
  );

  useEffect(() => {
    reclassifyPhpLanguageServerDiagnosticsForRootRef.current =
      reclassifyPhpLanguageServerDiagnosticsForRoot;
  }, [reclassifyPhpLanguageServerDiagnosticsForRoot]);

  const {
    readPhpClassMembersFromPath,
    collectPhpMethodsForClass,
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpLaravelRelationCompletionsForClass,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resetPhpClassMemberCache,
  } = usePhpClassMemberCollectors({
    activePhpFrameworkProviderSignature,
    activePhpFrameworkProviders,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    workspaceDescriptor,
    workspaceRoot,
  });

  useEffect(() => {
    resetPhpClassMemberCacheRef.current = resetPhpClassMemberCache;
  }, [resetPhpClassMemberCache]);

  const readWorkspaceDirectory = useCallback(
    (path: string) => workspaceFiles.readDirectory(path),
    [workspaceFiles],
  );

  const {
    collectNamedRouteTargets,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    collectEnvironmentTargets,
    collectViewTargets,
    collectConfigTargets,
    collectTranslationTargets,
    collectAuthGuardTargets,
    collectCacheStoreTargets,
    collectDatabaseConnectionTargets,
    collectBroadcastConnectionTargets,
    collectQueueConnectionTargets,
    collectRedisConnectionTargets,
    collectMailMailerTargets,
    collectPasswordBrokerTargets,
    collectLogChannelTargets,
    collectStorageDiskTargets,
    findViewTarget,
    findConfigTarget,
    findTranslationTarget,
    findAuthGuardTarget,
    findCacheStoreTarget,
    findDatabaseConnectionTarget,
    findBroadcastConnectionTarget,
    findQueueConnectionTarget,
    findRedisConnectionTarget,
    findMailMailerTarget,
    findPasswordBrokerTarget,
    findLogChannelTarget,
    findStorageDiskTarget,
    invalidateTargetCache: invalidateFrameworkTargetCache,
  } = usePhpFrameworkTargets({
    currentWorkspaceRootRef,
    workspaceRoot,
    textSearch,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    frameworkIntelligence: phpFrameworkIntelligence,
  });

  const findPhpLaravelEnvTarget = usePhpLaravelEnvTargetResolver({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    joinWorkspacePath,
    readNavigationFileContent,
    workspaceRoot,
  });

  const {
    phpClassHierarchyHasConstant,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
  } = usePhpClassHierarchyPredicates({
    currentWorkspaceRootRef,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
  } = usePhpLaravelScopePredicates({
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpMethodsForClass,
    frameworkRuntime: phpFrameworkRuntimeContext,
  });

  const { resolvePhpMethodReturnType } = usePhpMethodReturnTypeResolver({
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpEloquentBuilderModelTypeRef,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpLaravelProjectMorphMapModelType,
    resolvePhpMethodDeclaredReturnType,
    workspaceDescriptor,
    workspaceRoot,
  });

  const phpLaravelGenericModelTypeHelpers = useMemo(
    () => ({
      builderCollectionModelTypeFromExpression:
        phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
      builderModelTypeCandidate: phpLaravelEloquentBuilderModelTypeCandidate,
      builderModelTypeFromExpression:
        phpLaravelEloquentBuilderModelTypeFromExpression,
      collectionModelTypeCandidate: phpLaravelCollectionModelTypeCandidate,
      repositoryConventionModelTypeFromCarrierReturnType:
        phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
    }),
    [],
  );

  const { resolvePhpLaravelMethodGenericModelType } =
    usePhpLaravelMethodGenericModelType({
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      helpers: phpLaravelGenericModelTypeHelpers,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    });

  const {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpLaravelRelationPathOwnerType,
  } = usePhpLaravelRelationResolver({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpLaravelProjectMorphMapModelType,
    workspaceDescriptor,
    workspaceRoot,
  });


  const {
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
  } = usePhpTraitHostPredicates({
    currentWorkspaceRootRef,
    isPhpPath,
    phpClassHierarchyHasConstant,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassPropertyOrRelationType,
    searchText: (root, query, limit, options) =>
      options === undefined
        ? textSearch.searchText(root, query, limit)
        : textSearch.searchText(root, query, limit, options),
    workspaceRoot,
  });

  usePhpDiagnosticContextFilter({
    activePhpFrameworkProviders,
    contextualDiagnosticsFilterRef,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRoot: () => currentWorkspaceRootRef.current,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime: phpFrameworkRuntimeContext,
    isPhpPath,
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType: (source, position, receiverExpression) =>
      resolvePhpEloquentBuilderModelTypeRef.current(
        source,
        position,
        receiverExpression,
      ),
    resolvePhpExpressionType: (source, position, receiverExpression) =>
      resolvePhpExpressionTypeRef.current(source, position, receiverExpression),
  });

  const {
    resolvePhpEloquentBuilderModelType,
    resolvePhpLaravelCollectionModelType,
  } = usePhpLaravelModelTypeResolvers({
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
    readNavigationFileContent,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpLaravelMethodGenericModelType,
    resolvePhpLaravelRelationPathOwnerType,
    resolvePhpMethodReturnType,
    workspaceDescriptor,
    workspaceRoot,
  });

  useEffect(() => {
    resolvePhpEloquentBuilderModelTypeRef.current =
      resolvePhpEloquentBuilderModelType;
  }, [resolvePhpEloquentBuilderModelType]);

  const { resolvePhpExpressionType } = usePhpExpressionTypeResolver({
    activePhpFrameworkProviders,
    collectPhpMethodsForClass,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpLaravelCollectionModelType,
    resolvePhpMethodReturnType,
    resolvePhpSemanticTypeReference,
  });

  useEffect(() => {
    resolvePhpExpressionTypeRef.current = resolvePhpExpressionType;
  }, [resolvePhpExpressionType]);

  const {
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
  } = usePhpMethodCompletionResolvers({
    activePhpFrameworkProviders,
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpFrameworkSourceContext,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  });

  const { providePhpMethodCompletions } = usePhpMethodCompletionProvider({
    activeDocument,
    activePhpFrameworkProviders,
    collectAuthGuardTargets,
    collectBroadcastConnectionTargets,
    collectCacheStoreTargets,
    collectConfigTargets,
    collectDatabaseConnectionTargets,
    collectEnvTargets: collectEnvironmentTargets,
    collectGateAbilityTargets: collectAuthorizationAbilityTargets,
    collectLogChannelTargets,
    collectMailMailerTargets,
    collectMiddlewareAliasTargets,
    collectNamedRouteTargets,
    collectPasswordBrokerTargets,
    collectPhpLaravelRelationCompletionsForClass,
    collectPhpMethodsForClass,
    collectQueueConnectionTargets,
    collectRedisConnectionTargets,
    collectStorageDiskTargets,
    collectTranslationTargets,
    collectViewTargets,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime: phpFrameworkRuntimeContext,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpLaravelRelationPathOwnerType,
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    workspaceRoot,
  });

  const { providePhpMethodSignature, providePhpParameterInlayHints } =
    usePhpSignatureHelpProvider({
      currentWorkspaceRootRef,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    });

  const { createMissingBladeViewCodeAction, providePhpCodeActions } =
    usePhpCodeActionProvider({
      activeDocumentPath: activeDocument?.path ?? null,
      collectPhpLaravelViewTargets: collectViewTargets,
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      intelligenceMode,
      projectSymbolSearch,
      readNavigationFileContent,
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    });

  const { openPhpClassTarget } = usePhpClassTargetNavigation({
    activeDocument,
    currentWorkspaceRootRef,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    readNavigationFileContent,
    workspaceDescriptor,
    workspaceRoot,
  });

  const phpFrameworkLiteralNavigationDependencies = useMemo(
    () => ({
      collectNamedRouteTargets,
      findConfigTarget,
      findEnvTarget: findPhpLaravelEnvTarget,
      findTranslationTarget,
      findViewTarget,
    }),
    [
      collectNamedRouteTargets,
      findConfigTarget,
      findPhpLaravelEnvTarget,
      findTranslationTarget,
      findViewTarget,
    ],
  );

  const { providePhpFrameworkDefinition } = usePhpFrameworkDefinitionNavigation({
    activeDocument,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    frameworkLiteralNavigationDependencies:
      phpFrameworkLiteralNavigationDependencies,
    openNavigationTarget,
    openPhpClassTarget,
    providers: activePhpFrameworkProviders,
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });

  useBladeLaravelDiagnosticsProvider({
    activeDocument,
    activeDocumentRef,
    collectViewTargets,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    setLaravelDiagnosticsByPath,
    workspaceRoot,
  });

  const { openDirectPhpMethodTarget, openPhpMethodHintTarget } =
    usePhpMethodTargetNavigation({
      currentWorkspaceRootRef,
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpFrameworkBoundConcrete,
      workspaceDescriptor,
      workspaceRoot,
    });

  const { openDirectPhpPropertyTarget } = usePhpPropertyTargetNavigation({
    currentWorkspaceRootRef,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { goToIndexedPhpImplementation } = usePhpImplementationNavigation({
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      identifierAtEditorPosition,
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      setImplementationChooser,
      workspaceRoot,
    });

  const {
    openPhpLaravelDynamicWhereTarget,
    openPhpLaravelModelAttributeTarget,
  } = usePhpLaravelModelNavigationTargets({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { goToPhpMemberPropertyDefinition } =
    usePhpMemberPropertyDefinitionNavigation({
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
      phpClassHierarchyHasProperty,
      resolvePhpExpressionType,
      setMessage,
      workspaceRoot,
    });

  const {
    goToPhpClassConstantDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
  } = usePhpContextualMemberDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openDirectPhpMethodTarget,
    openNavigationTarget,
    openPhpClassTarget,
    openPhpLaravelDynamicWhereTarget,
    openPhpMethodHintTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpEloquentBuilderModelType: resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpLaravelRelationPathOwnerType,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  });

  const workbenchFrameworkIntelligence = useWorkbenchFrameworkIntelligence({
    activePhpFrameworkProviders,
    blade: {
      activeDocument,
      collectPhpLaravelConfigTargets: collectConfigTargets,
      collectPhpLaravelNamedRouteTargets: collectNamedRouteTargets,
      collectPhpLaravelTranslationTargets: collectTranslationTargets,
      collectPhpLaravelViewTargets: collectViewTargets,
      createMissingBladeViewCodeAction,
      currentWorkspaceRootRef,
      ensurePhpFrameworkSourceCollectionsLoaded,
      findPhpLaravelConfigTarget: findConfigTarget,
      findPhpLaravelTranslationTarget: findTranslationTarget,
      findPhpLaravelViewTarget: findViewTarget,
      frameworkRuntime: phpFrameworkRuntimeContext,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpLaravelModelAttributeTarget,
      readNavigationFileContent,
      relativeWorkspacePath,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      resolvePhpReceiverMethodCompletions,
      textSearch,
      workspaceFiles,
      workspaceRoot,
    },

    latte: {
      currentWorkspaceRootRef,
      frameworkIntelligence: phpFrameworkIntelligence,
      getActiveDocument: () => activeDocumentRef.current,
      isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
      joinPath: joinWorkspacePath,
      listDirectory: (path) => workspaceFiles.readDirectory(path),
      openPhpMethodTarget: openDirectPhpMethodTarget,
      openPhpPropertyTarget: openDirectPhpPropertyTarget,
      openTarget: openNavigationTarget,
      readFileContent: readNavigationFileContent,
      resolveDeclaredType: resolvePhpDeclaredType,
      resolveExpressionType: resolvePhpExpressionType,
      resolvePhpReceiverCompletions: resolvePhpReceiverMethodCompletions,
      searchText: (root, query, maxResults) =>
        textSearch.searchText(root, query, maxResults),
      synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
      toRelativePath: relativeWorkspacePath,
      workspaceRoot,
    },

    neon: {
      currentWorkspaceRootRef,
      frameworkIntelligence: phpFrameworkIntelligence,
      getActiveDocument: () => activeDocumentRef.current,
      isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
      joinPath: joinWorkspacePath,
      listDirectory: (path) => workspaceFiles.readDirectory(path),
      openClassTarget: (className) =>
        openPhpClassTarget(className, className.split("\\").pop() ?? className),
      openDirectPhpMethodTarget,
      openTarget: openNavigationTarget,
      readFileContent: readNavigationFileContent,
      resolvePhpReceiverCompletions: resolvePhpReceiverMethodCompletions,
      searchClassNames: async (root, prefix, maxResults) => {
        const symbols = await projectSymbolSearch.searchProjectSymbols(
          root,
          prefix,
          maxResults,
        );

        return symbols
          .filter(isTypeProjectSymbol)
          .map((symbol) => symbol.fullyQualifiedName);
      },
      synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
      toRelativePath: relativeWorkspacePath,
      workspaceRoot,
    },
  });
  const {
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resetBladeIntelligenceCaches,
    provideLatteDefinition,
    shouldBlockLatteDefinitionFallback,
  } = workbenchFrameworkIntelligence;
  resetPhpFrameworkCachesRef.current = () => {
    phpClassSourcePathCacheRef.current = {};
    resetPhpClassMemberCacheRef.current();
    phpFrameworkBindingCacheRef.current = {};
    resetPhpLaravelMorphMapModelTypeCache();
    invalidateFrameworkTargetCache();
    resetPhpFrameworkSourceRegistries();
    resetBladeIntelligenceCaches();
  };
  const frameworkIntelligenceProviders = useWorkbenchFrameworkProviderAdapter(
    workbenchFrameworkIntelligence,
  );

  const {
    goToPhpLaravelAuthGuardDefinition,
    goToPhpLaravelBroadcastConnectionDefinition,
    goToPhpLaravelCacheStoreDefinition,
    goToPhpLaravelConfigDefinition,
    goToPhpLaravelDatabaseConnectionDefinition,
    goToPhpLaravelEnvDefinition,
    goToPhpLaravelGateAbilityDefinition,
    goToPhpLaravelLogChannelDefinition,
    goToPhpLaravelMailMailerDefinition,
    goToPhpLaravelMiddlewareAliasDefinition,
    goToPhpLaravelNamedRouteDefinition,
    goToPhpLaravelPasswordBrokerDefinition,
    goToPhpLaravelQueueConnectionDefinition,
    goToPhpLaravelRedisConnectionDefinition,
    goToPhpLaravelStorageDiskDefinition,
    goToPhpLaravelTranslationDefinition,
    goToPhpLaravelViewDefinition,
  } = usePhpLaravelLiteralDefinitionNavigation({
    activeDocument,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    collectNamedRouteTargets,
    currentWorkspaceRootRef,
    findAuthGuardTarget,
    findBroadcastConnectionTarget,
    findCacheStoreTarget,
    findConfigTarget,
    findDatabaseConnectionTarget,
    findLogChannelTarget,
    findMailMailerTarget,
    findPasswordBrokerTarget,
    findPhpLaravelEnvTarget,
    findQueueConnectionTarget,
    findRedisConnectionTarget,
    findStorageDiskTarget,
    findTranslationTarget,
    findViewTarget,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openNavigationTarget,
    setMessage,
    workspaceRoot,
  });

  const { goToPhpFrameworkLiteralDefinition } =
    usePhpContextualFrameworkLiteralDefinitionNavigation({
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies:
        phpFrameworkLiteralNavigationDependencies,
      openNavigationTarget,
      providers: activePhpFrameworkProviders,
      setMessage,
      workspaceRoot,
    });

  const goToPhpClassIdentifierDefinition = useCallback(
    async (name: string): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const className = resolvePhpClassName(activeDocument.content, name);

      if (!className) {
        return false;
      }

      return openPhpClassTarget(className, name);
    },
    [activeDocument, openPhpClassTarget],
  );

  const goToPhpFrameworkIdentifierDefinition = useCallback(
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(context, {
        activeDocument,
        goToPhpLaravelAuthGuardDefinition,
        goToPhpLaravelBroadcastConnectionDefinition,
        goToPhpLaravelCacheStoreDefinition,
        goToPhpLaravelConfigDefinition,
        goToPhpLaravelDatabaseConnectionDefinition,
        goToPhpLaravelEnvDefinition,
        goToPhpLaravelGateAbilityDefinition,
        goToPhpLaravelLogChannelDefinition,
        goToPhpLaravelMailMailerDefinition,
        goToPhpLaravelMiddlewareAliasDefinition,
        goToPhpLaravelNamedRouteDefinition,
        goToPhpLaravelPasswordBrokerDefinition,
        goToPhpLaravelQueueConnectionDefinition,
        goToPhpLaravelRedisConnectionDefinition,
        goToPhpLaravelRelationStringDefinition,
        goToPhpLaravelStorageDiskDefinition,
        goToPhpLaravelTranslationDefinition,
        goToPhpLaravelViewDefinition,
        openDirectPhpMethodTarget,
      }),
    [
      activeDocument,
      goToPhpLaravelAuthGuardDefinition,
      goToPhpLaravelBroadcastConnectionDefinition,
      goToPhpLaravelCacheStoreDefinition,
      goToPhpLaravelConfigDefinition,
      goToPhpLaravelDatabaseConnectionDefinition,
      goToPhpLaravelEnvDefinition,
      goToPhpLaravelGateAbilityDefinition,
      goToPhpLaravelLogChannelDefinition,
      goToPhpLaravelMailMailerDefinition,
      goToPhpLaravelMiddlewareAliasDefinition,
      goToPhpLaravelNamedRouteDefinition,
      goToPhpLaravelPasswordBrokerDefinition,
      goToPhpLaravelQueueConnectionDefinition,
      goToPhpLaravelRedisConnectionDefinition,
      goToPhpLaravelRelationStringDefinition,
      goToPhpLaravelStorageDiskDefinition,
      goToPhpLaravelTranslationDefinition,
      goToPhpLaravelViewDefinition,
      openDirectPhpMethodTarget,
    ],
  );

  const goToContextualPhpFrameworkIdentifierDefinition = useCallback(
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(context, {
        activeDocument,
        goToPhpLaravelAuthGuardDefinition,
        goToPhpLaravelBroadcastConnectionDefinition,
        goToPhpLaravelCacheStoreDefinition,
        goToPhpLaravelConfigDefinition: goToPhpFrameworkLiteralDefinition,
        goToPhpLaravelDatabaseConnectionDefinition,
        goToPhpLaravelEnvDefinition: goToPhpFrameworkLiteralDefinition,
        goToPhpLaravelGateAbilityDefinition,
        goToPhpLaravelLogChannelDefinition,
        goToPhpLaravelMailMailerDefinition,
        goToPhpLaravelMiddlewareAliasDefinition,
        goToPhpLaravelNamedRouteDefinition: goToPhpFrameworkLiteralDefinition,
        goToPhpLaravelPasswordBrokerDefinition,
        goToPhpLaravelQueueConnectionDefinition,
        goToPhpLaravelRedisConnectionDefinition,
        goToPhpLaravelRelationStringDefinition,
        goToPhpLaravelStorageDiskDefinition,
        goToPhpLaravelTranslationDefinition: goToPhpFrameworkLiteralDefinition,
        goToPhpLaravelViewDefinition: goToPhpFrameworkLiteralDefinition,
        openDirectPhpMethodTarget,
        openPhpClassTarget,
      }),
    [
      activeDocument,
      goToPhpFrameworkLiteralDefinition,
      goToPhpLaravelAuthGuardDefinition,
      goToPhpLaravelBroadcastConnectionDefinition,
      goToPhpLaravelCacheStoreDefinition,
      goToPhpLaravelDatabaseConnectionDefinition,
      goToPhpLaravelGateAbilityDefinition,
      goToPhpLaravelLogChannelDefinition,
      goToPhpLaravelMailMailerDefinition,
      goToPhpLaravelMiddlewareAliasDefinition,
      goToPhpLaravelPasswordBrokerDefinition,
      goToPhpLaravelQueueConnectionDefinition,
      goToPhpLaravelRedisConnectionDefinition,
      goToPhpLaravelRelationStringDefinition,
      goToPhpLaravelStorageDiskDefinition,
      openDirectPhpMethodTarget,
      openPhpClassTarget,
    ],
  );

  const { goToContextualPhpDefinition } = usePhpContextualDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition:
      goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
  });

  const { goToSuperMethod } = usePhpSuperMethodNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { goToIndexedSymbolDefinition } = usePhpIndexedDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    identifierAtEditorPosition,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
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
    flushPendingDocumentChange,
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
    provideLatteDefinition,
    shouldBlockLatteDefinitionFallback,
    recordNavigationLocationSnapshot,
    reportErrorForActiveWorkspaceRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    setEditorRevealTarget,
    setImplementationChooser,
    setMessage,
    workspaceFiles,
    workspaceRoot,
  });

  const { navigateBackward, navigateForwardInHistory, openRecentLocation } =
    useNavigationHistory({
      currentNavigationLocation,
      currentWorkspaceRootRef,
      forgetRecentLocationsForPath,
      navigationHistory,
      openPathForNavigation,
      recordCurrentNavigationLocation,
      setEditorRevealTarget,
      setNavigationHistory,
      setRecentLocationsPanelOpen,
      shouldOpenNavigationTargetReadOnly:
        shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly,
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
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    invalidatePhpFrameworkSourcePath,
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
    reportErrorForActiveWorkspaceRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspacePathBelongsToRoot,
  });

  const toggleSmartMode = useCallback(async () => {
    const nextMode = shouldStartLanguageServer(intelligenceMode)
      ? "basic"
      : "fullSmart";
    await setSmartMode(nextMode);
  }, [intelligenceMode, setSmartMode]);

  const toggleWorkspaceTrust = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const trusted = !workspaceTrust?.trusted;
    const requestedRoot = workspaceRoot;

    try {
      const trust = await workspaceTrustGateway.setTrust(requestedRoot, trusted);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setWorkspaceTrust(trust);
      setMessage(
        trust.trusted ? "Workspace trusted." : "Workspace trust revoked.",
      );

      if (!trust.trusted) {
        await stopLanguageServerRuntime(requestedRoot);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }
      }

      if (!workspaceDescriptor?.php) {
        return;
      }

      await refreshLanguageServerPlan(requestedRoot);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "Workspace Trust",
        error,
      );
    }
  }, [
    refreshLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    stopLanguageServerRuntime,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
    workspaceTrustGateway,
  ]);

  const saveWorkbenchSettings = useCallback(
    async (
      nextAppSettings: AppSettings,
      nextWorkspaceSettings: WorkspaceSettings,
      nextTrusted: boolean | null,
    ) => {
      const requestedRoot = workspaceRoot;

      try {
        const previousAppSettings = appSettingsRef.current;
        const previousWorkspaceSettings = workspaceSettingsRef.current;
        await persistAppSettings(nextAppSettings);

        if (!requestedRoot) {
          if (!currentWorkspaceRootRef.current) {
            setMessage("Settings saved.");
          }
          return;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundProjectRuntimes(
            nextAppSettings.runtimePolicy,
            requestedRoot,
            null,
          );

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        const previousMode = intelligenceModeRef.current;
        let nextMode = nextWorkspaceSettings.intelligenceMode;

        if (nextWorkspaceSettings.intelligenceMode !== previousMode) {
          const smartMode = await smartModeGateway.setMode(
            nextWorkspaceSettings.intelligenceMode,
          );

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }

          nextMode = smartMode.mode;
        }

        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: nextMode,
        };
        const shouldRestartJavaScriptTypeScriptRuntime =
          previousWorkspaceSettings.javaScriptTypeScriptVersion !==
            resolvedWorkspaceSettings.javaScriptTypeScriptVersion ||
          previousWorkspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition !==
            resolvedWorkspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition;
        const shouldNotifyJavaScriptTypeScriptConfiguration =
          previousWorkspaceSettings.javaScriptTypeScriptAutoImports !==
            resolvedWorkspaceSettings.javaScriptTypeScriptAutoImports ||
          previousWorkspaceSettings.javaScriptTypeScriptCodeLens !==
            resolvedWorkspaceSettings.javaScriptTypeScriptCodeLens ||
          previousWorkspaceSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions !==
            resolvedWorkspaceSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions ||
          previousWorkspaceSettings.javaScriptTypeScriptCompleteFunctionCalls !==
            resolvedWorkspaceSettings.javaScriptTypeScriptCompleteFunctionCalls ||
          previousWorkspaceSettings.javaScriptTypeScriptImportModuleSpecifierEnding !==
            resolvedWorkspaceSettings.javaScriptTypeScriptImportModuleSpecifierEnding ||
          previousWorkspaceSettings.javaScriptTypeScriptImportModuleSpecifierPreference !==
            resolvedWorkspaceSettings.javaScriptTypeScriptImportModuleSpecifierPreference ||
          previousWorkspaceSettings.javaScriptTypeScriptInlayHints !==
            resolvedWorkspaceSettings.javaScriptTypeScriptInlayHints ||
          previousWorkspaceSettings.javaScriptTypeScriptPreferTypeOnlyAutoImports !==
            resolvedWorkspaceSettings.javaScriptTypeScriptPreferTypeOnlyAutoImports ||
          previousWorkspaceSettings.javaScriptTypeScriptQuotePreference !==
            resolvedWorkspaceSettings.javaScriptTypeScriptQuotePreference ||
          previousWorkspaceSettings.javaScriptTypeScriptValidation !==
            resolvedWorkspaceSettings.javaScriptTypeScriptValidation;
        const shouldRefreshPhpLanguageServerPlan =
          previousWorkspaceSettings.phpBackend !==
            resolvedWorkspaceSettings.phpBackend ||
          previousWorkspaceSettings.phpactorPath !==
            resolvedWorkspaceSettings.phpactorPath ||
          previousWorkspaceSettings.intelephensePath !==
            resolvedWorkspaceSettings.intelephensePath;
        // Changing the git directory mappings (manual add/remove or the
        // auto-detect toggle) must re-run discovery live, without waiting for a
        // workspace reopen, so the mappings and the fanned-out status reflect the
        // new configuration immediately.
        const previousGitDirectoryMappings =
          previousWorkspaceSettings.gitDirectoryMappings;
        const nextGitDirectoryMappings =
          resolvedWorkspaceSettings.gitDirectoryMappings;
        const shouldRediscoverGitRepositories =
          previousWorkspaceSettings.gitDirectoryMappingsAuto !==
            resolvedWorkspaceSettings.gitDirectoryMappingsAuto ||
          previousGitDirectoryMappings.length !==
            nextGitDirectoryMappings.length ||
          previousGitDirectoryMappings.some(
            (mapping, index) => mapping !== nextGitDirectoryMappings[index],
          );

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          intelligenceModeRef.current = nextMode;
          setIntelligenceMode(nextMode);
          autoStartedLanguageServerRootRef.current = requestedRoot;
          await stopLanguageServerRuntime(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (!shouldStartLanguageServer(previousMode) && shouldStartLanguageServer(nextMode)) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            normalizedWorkspaceRootKey(requestedRoot)
          ];
        }

        intelligenceModeRef.current = nextMode;
        await persistWorkspaceSettings(requestedRoot, resolvedWorkspaceSettings);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setIntelligenceMode(nextMode);

        if (
          shouldNotifyJavaScriptTypeScriptConfiguration &&
          !shouldRestartJavaScriptTypeScriptRuntime &&
          resolvedWorkspaceSettings.javaScriptTypeScriptService === "auto" &&
          isRunningLanguageServerForWorkspace(
            javaScriptTypeScriptLanguageServerRuntimeStatus,
            javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
            requestedRoot,
          )
        ) {
          const requestedSessionId =
            javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;

          try {
            await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration(
              requestedRoot,
              javaScriptTypeScriptLanguageServerConfiguration(
                resolvedWorkspaceSettings,
                activeEditorConfigRef.current,
                activeDocumentRef.current,
              ),
            );
          } catch (error) {
            if (
              isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
                requestedRoot,
                requestedSessionId,
              )
            ) {
              throw error;
            }
          }
        }

        if (shouldRestartJavaScriptTypeScriptRuntime) {
          autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
          await refreshJavaScriptTypeScriptLanguageServerPlan(
            requestedRoot,
            resolvedWorkspaceSettings.javaScriptTypeScriptVersion,
          );

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }

          if (
            isLanguageServerActiveForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              requestedRoot,
            ) ||
            isCrashedLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              requestedRoot,
            )
          ) {
            await stopJavaScriptTypeScriptLanguageServerRuntime(requestedRoot);

            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }
          }
        }

        let refreshedPhpLanguageServerPlan = false;

        // Saving settings can also be what flips the project into IDE mode. The
        // open-time PHP probe is deferred in basic mode, so the first time IDE
        // mode turns on we must run the full probe (detectPhpTools + plan
        // refresh + managed engine notice) here too, otherwise phpTools and the
        // install notice would stay stale. The probe already refreshes the
        // plan, so the later PHP plan refresh branches are skipped.
        if (
          !shouldStartLanguageServer(previousMode) &&
          shouldStartLanguageServer(nextMode) &&
          workspaceDescriptor?.php
        ) {
          await runPhpWorkspaceProbe(requestedRoot);
          refreshedPhpLanguageServerPlan = true;

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (nextTrusted !== null && nextTrusted !== workspaceTrust?.trusted) {
          const trust = await workspaceTrustGateway.setTrust(
            requestedRoot,
            nextTrusted,
          );
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }

          setWorkspaceTrust(trust);

          if (!trust.trusted) {
            await stopLanguageServerRuntime(requestedRoot);

            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }
          }

          if (workspaceDescriptor?.php) {
            await refreshLanguageServerPlan(requestedRoot);
            refreshedPhpLanguageServerPlan = true;

            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }
          }
        }

        if (
          shouldRefreshPhpLanguageServerPlan &&
          workspaceDescriptor?.php &&
          !refreshedPhpLanguageServerPlan
        ) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            normalizedWorkspaceRootKey(requestedRoot)
          ];
          await refreshLanguageServerPlan(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (!shouldIndexWorkspace(previousMode) && shouldIndexWorkspace(nextMode)) {
          await startInitialIndexScan(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (shouldIndexWorkspace(previousMode) && !shouldIndexWorkspace(nextMode)) {
          await clearWorkspaceIndex(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (shouldRediscoverGitRepositories) {
          await runGitRepositoryDiscovery(requestedRoot, resolvedWorkspaceSettings);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setMessage("Settings saved.");
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
      }
    },
    [
      clearWorkspaceIndex,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      persistAppSettings,
      persistWorkspaceSettings,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      refreshLanguageServerPlan,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      runGitRepositoryDiscovery,
      runPhpWorkspaceProbe,
      smartModeGateway,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      stopJavaScriptTypeScriptLanguageServerRuntime,
      stopLanguageServerRuntime,
      workspaceDescriptor,
      workspaceRoot,
      workspaceTrust,
      workspaceTrustGateway,
    ],
  );

  const openJavaScriptTypeScriptServiceLog = useCallback(async () => {
    if (!workspaceRoot) {
      setMessage("Open a workspace before opening the JavaScript/TypeScript service log.");
      return;
    }

    const requestedRoot = workspaceRoot;

    try {
      const logPath =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.openLog(
          requestedRoot,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(
        logPath
          ? `Opened JavaScript/TypeScript service log: ${logPath}`
          : "JavaScript/TypeScript service log is unavailable in this runtime.",
      );
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
    }
  }, [
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

  const installManagedPhpactor = useCallback(async () => {
    if (!workspaceRoot || !workspaceDescriptor?.php) {
      return;
    }

    if (
      installingManagedPhpactor &&
      workspaceRootKeysEqual(installingManagedPhpactorRootRef.current, workspaceRoot)
    ) {
      return;
    }

    setInstallingManagedPhpactor(true);
    const targetWorkspaceRoot = workspaceRoot;
    installingManagedPhpactorRootRef.current = targetWorkspaceRoot;

    try {
      // Non-blocking: this only schedules the managed install on a background
      // thread and resolves once the work has been queued. The long-running
      // composer steps run off the UI thread and completion (success/failure)
      // is delivered through the install-completion subscription below.
      await phpToolGateway.installManagedPhpactor(targetWorkspaceRoot);
    } catch (error) {
      if (
        workspaceRootKeysEqual(
          installingManagedPhpactorRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        installingManagedPhpactorRootRef.current = null;
        setInstallingManagedPhpactor(false);
      }

      if (
        workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        reportLanguageServerError(error);
      }
    }
  }, [
    installingManagedPhpactor,
    phpToolGateway,
    reportLanguageServerError,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const handleManagedPhpactorInstallCompletion = useCallback(
    async (event: ManagedPhpactorInstallCompletionEvent) => {
      const targetWorkspaceRoot = event.root;

      // Per-root guard: ignore stale completions for a root that is no longer
      // the one we are installing for (e.g. the user switched workspaces).
      if (
        !workspaceRootKeysEqual(
          installingManagedPhpactorRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        return;
      }

      installingManagedPhpactorRootRef.current = null;
      setInstallingManagedPhpactor(false);

      const installFailedForActiveWorkspace =
        Boolean(event.error) &&
        workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          targetWorkspaceRoot,
        );

      if (installFailedForActiveWorkspace) {
        reportLanguageServerError(event.error);
        return;
      }

      if (event.error) {
        return;
      }

      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        return;
      }

      try {
        const tools = await phpToolGateway.detectPhpTools(targetWorkspaceRoot);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            targetWorkspaceRoot,
          )
        ) {
          return;
        }

        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(
              current,
              `phpactor-setup:${targetWorkspaceRoot}`,
              [],
            ),
          );
        }

        setPhpTools(tools);
        await refreshLanguageServerPlan(targetWorkspaceRoot);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            targetWorkspaceRoot,
          )
        ) {
          return;
        }

        setLanguageServerSetupOpen(false);
        setMessage("Installed managed PHP IDE engine.");
      } catch (error) {
        if (
          workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            targetWorkspaceRoot,
          )
        ) {
          reportLanguageServerError(error);
        }
      }
    },
    [
      phpToolGateway,
      refreshLanguageServerPlan,
      reportLanguageServerError,
    ],
  );

  const {
    startHardReindex,
    startIndexScan,
    startPhpReindex,
  } = useWorkbenchIndexCommands({
    activeIndexRootRef,
    currentWorkspaceRootRef,
    indexProgressGateway,
    intelligenceMode,
    pendingIndexRootRef,
    pendingIndexScanRef,
    reportError,
    setIndexHealthLogs,
    setIndexProgress,
    setMessage,
    workspaceRoot,
  });

  const {
    openSettingsPanel,
    openAppearanceSettingsPanel,
    closeFloatingSurface,
    openWorkspaceSymbols,
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
    textSearchOpen,
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

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    const unlisteners: TauriUnlistenFn[] = [];
    const subscriptions: Array<[string, () => void]> = [
      [FONT_ZOOM_IN_EVENT, zoomEditorFontIn],
      [FONT_ZOOM_OUT_EVENT, zoomEditorFontOut],
      [FONT_ZOOM_RESET_EVENT, resetEditorFontSize],
      [OPEN_APPEARANCE_SETTINGS_EVENT, openAppearanceSettingsPanel],
      [TOGGLE_FONT_LIGATURES_EVENT, toggleEditorFontLigatures],
    ];

    subscriptions.forEach(([eventName, handler]) => {
      listen(eventName, handler)
        .then((dispose) => {
          if (!active) {
            dispose();
            return;
          }

          unlisteners.push(createSafeUnsubscribe(dispose));
        })
        .catch((error) => reportError("Shortcuts", error));
    });

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    openAppearanceSettingsPanel,
    reportError,
    resetEditorFontSize,
    toggleEditorFontLigatures,
    zoomEditorFontIn,
    zoomEditorFontOut,
  ]);

  const commandRegistry = useMemo(() => {
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

    workbenchPhpTestCommands({
      shortcut,
      isActiveDocumentPhp: activeDocument?.language === "php",
      isActiveDocumentPhpTest,
      generateTestForActiveDocument,
      goToTestForActiveDocument,
      runTestForActiveDocument,
      runAllTestsForActiveDocument,
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

    workbenchNavigationHistoryCommands({
      shortcut,
      canNavigateBackward: navigationHistory.backStack.length > 0,
      canNavigateForward: navigationHistory.forwardStack.length > 0,
      navigateBackward,
      navigateForward: navigateForwardInHistory,
    }).forEach((command) => registry.register(command));

    workbenchEditorSurfaceCommands({
      shortcut,
      canCloseActiveSurface: Boolean(
        activeDocument || selectedGitChange || gitDiffLoading || isTauri(),
      ),
      saveActiveDocument,
      closeActiveSurface,
      editorSurfaceCommandRunner: options.editorSurfaceCommandRunner,
    }).forEach((command) => registry.register(command));

    workbenchLanguageNavigationCommands({
      shortcut,
      activeDocument: activeDocumentLanguage,
      goToDefinition,
      goToSourceDefinition,
      goToDeclaration,
      goToTypeDefinition,
      goToImplementation,
      goToSuperMethod,
    }).forEach((command) => registry.register(command));

    appearanceCommands.editorCommands.forEach((command) =>
      registry.register(command),
    );

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
    }).forEach((command) => registry.register(command));

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
    appSettings.keymap,
    closeDocument,
    createDirectory,
    createFile,
    deleteActiveDocument,
    generateTestForActiveDocument,
    goToTestForActiveDocument,
    isActiveDocumentPhpTest,
    runTestForActiveDocument,
    runAllTestsForActiveDocument,
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
    openSearchEverywhere,
    options.editorSurfaceCommandRunner,
    navigationHistory,
    openWorkspace,
    refreshWorkspace,
    refreshGitStatus,
    refreshPhpTree,
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
    openGitStashPanel,
    openGitBranchPanel,
    createGitBranch,
    commitGitChanges,
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

  const commandContext = useMemo(
    () => ({
      hasWorkspace: Boolean(workspaceRoot),
      hasActiveDocument: Boolean(activeDocument),
      activeDocumentDirty: Boolean(
        activeDocument && !activeDocument.readOnly && isDirty(activeDocument),
      ),
    }),
    [activeDocument, workspaceRoot],
  );

  const searchEverywhereModel = searchEverywhereModelFor(
    commandRegistry.list(),
    commandContext,
  );

  useEffect(() => {
    if (workspaceSettings.javaScriptTypeScriptValidation) {
      return;
    }

    clearJavaScriptTypeScriptDiagnosticsForRoot(workspaceRoot);
  }, [
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    workspaceSettings.javaScriptTypeScriptValidation,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (sidebarView !== "php") {
      return;
    }

    if (
      indexProgress.rootPath &&
      !workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot)
    ) {
      return;
    }

    void refreshPhpTree();
  }, [
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    refreshPhpTree,
    sidebarView,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (sidebarView !== "git") {
      return;
    }

    void refreshGitStatus();
  }, [refreshGitStatus, sidebarView, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (indexProgress.status !== "completed") {
      return;
    }

    if (
      indexProgress.rootPath &&
      !workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot)
    ) {
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

  const keyboardShortcutActions = useMemo(() => ({
    closeFloatingSurface,
    goToDefinition,
    openSearchEverywhere,
    quitApplication,
  }), [
    closeFloatingSurface,
    goToDefinition,
    openSearchEverywhere,
    quitApplication,
  ]);

  useWorkbenchKeyboardShortcuts({
    actions: keyboardShortcutActions,
    appSettingsRef,
    bareKeyShortcutsRef,
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
  });

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!workspaceSessionRestoredRef.current) {
      return;
    }

    const session = currentWorkspaceSession(
      workspaceRoot,
      openPaths,
      activePath,
      sidebarView,
      bottomPanelView,
    );

    if (workspaceSessionsEqual(workspaceSettingsRef.current.session, session)) {
      return;
    }

    const requestedRoot = workspaceRoot;

    void persistWorkspaceSettings(requestedRoot, {
      ...workspaceSettingsRef.current,
      session,
    }).catch((error) =>
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Session", error),
    );
  }, [
    activePath,
    bottomPanelView,
    openPaths,
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    sidebarView,
    workspaceRoot,
  ]);

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

        const workspacePath =
          settings.recentWorkspacePath ?? settings.workspaceTabs[0] ?? null;

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

  useEffect(() => {
    let active = true;
    const subscriptionRoot = workspaceRoot;
    let unsubscribe: IndexProgressUnsubscribeFn | null = null;
    let unsubscribeProgress: IndexProgressUnsubscribeFn | null = null;

    const reportSubscriptionError = (error: unknown) => {
      if (
        !active ||
        !subscriptionRoot ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, subscriptionRoot)
      ) {
        return;
      }

      reportError("Index", error);
    };

    indexProgressGateway
      .subscribeMetadataScanCompletion((event) => {
        if (!active) {
          return;
        }

        handleMetadataScanCompletion(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch(reportSubscriptionError);

    indexProgressGateway
      .subscribeIndexProgress((event) => {
        if (!active) {
          return;
        }

        handleIndexProgress(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribeProgress = dispose;
      })
      .catch(reportSubscriptionError);

    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeProgress?.();
    };
  }, [
    handleIndexProgress,
    handleMetadataScanCompletion,
    indexProgressGateway,
    reportError,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: WorkspaceFileChangeUnsubscribeFn | null = null;
    const subscriptionRoot = workspaceRoot;

    if (!subscriptionRoot) {
      return () => {
        active = false;
      };
    }

    void workspaceFileChangeGateway
      .startWatching(subscriptionRoot)
      .catch((error) => {
        if (
          !active ||
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            subscriptionRoot,
          )
        ) {
          return;
        }

        reportError("Workspace", error);
      });

    workspaceFileChangeGateway
      .subscribeFileChanges((event) => {
        if (!active) {
          return;
        }

        handleWorkspaceFileChange(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (
          !active ||
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            subscriptionRoot,
          )
        ) {
          return;
        }

        reportError("Workspace", error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    handleWorkspaceFileChange,
    reportError,
    workspaceFileChangeGateway,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: ManagedPhpactorInstallUnsubscribeFn | null = null;

    phpToolGateway
      .subscribeManagedPhpactorInstall((event) => {
        if (!active) {
          return;
        }

        void handleManagedPhpactorInstallCompletion(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        reportError("Language Server", error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [handleManagedPhpactorInstallCompletion, phpToolGateway, reportError]);

  useLanguageServerDiagnosticsSubscriptions({
    workspaceRoot,
    currentWorkspaceRootRef,
    diagnosticsFlushSchedulerRef,
    languageServerDiagnosticsCoalescerRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    languageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    createDiagnosticsCoalescer,
    applyLanguageServerDiagnostics,
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    reportLanguageServerError,
    reportJavaScriptTypeScriptLanguageServerError,
  });

  useEffect(() => {
    if (
      !isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      resetLanguageServerDocuments();
      return;
    }

    const runtimeRoot =
      languageServerRuntimeStatus.rootPath ??
      languageServerRuntimeStatusRoot ??
      workspaceRoot;
    const runtimeSignature = [
      normalizedWorkspaceRootKey(runtimeRoot),
      languageServerRuntimeStatus.sessionId,
    ].join(":");

    if (documentSyncRuntimeSignatureRef.current !== runtimeSignature) {
      resetLanguageServerDocuments();
      documentSyncRuntimeSignatureRef.current = runtimeSignature;
    }

    const documentsToSync = openDocumentPaths
      .map((path) => documents[path])
      .filter((document): document is EditorDocument => Boolean(document));

    if (
      activeDocument &&
      !documentsToSync.some((document) => document.path === activeDocument.path)
    ) {
      documentsToSync.push(activeDocument);
    }

    documentsToSync.forEach((document) => {
      void syncOpenDocument(document);
    });
  }, [
    activeDocument,
    documents,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    openDocumentPaths,
    resetLanguageServerDocuments,
    syncOpenDocument,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !workspaceRoot ||
      !isRunningLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      resetJavaScriptTypeScriptLanguageServerDocuments();
      return;
    }

    const runtimeRoot =
      javaScriptTypeScriptLanguageServerRuntimeStatus.rootPath ??
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot ??
      workspaceRoot;
    const runtimeSignature = [
      normalizedWorkspaceRootKey(runtimeRoot),
      javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
    ].join(":");

    if (
      javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current !==
      runtimeSignature
    ) {
      resetJavaScriptTypeScriptLanguageServerDocuments();
      javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current =
        runtimeSignature;
    }

    const documentsToSync = openDocumentPaths
      .map((path) => documents[path])
      .filter(
        (document): document is EditorDocument =>
          Boolean(document) &&
          isJavaScriptTypeScriptDocumentSyncableForRoot(
            workspaceRoot,
            document,
          ),
      );

    if (
      activeDocument &&
      isJavaScriptTypeScriptDocumentSyncableForRoot(workspaceRoot, activeDocument) &&
      !documentsToSync.some((document) => document.path === activeDocument.path)
    ) {
      documentsToSync.push(activeDocument);
    }

    documentsToSync.forEach((document) => {
      void syncOpenJavaScriptTypeScriptDocument(document);
    });
  }, [
    activeDocument,
    documents,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openDocumentPaths,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    syncOpenJavaScriptTypeScriptDocument,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    const documentsToSync = openDocumentPaths
      .map((path) => documents[path])
      .filter((document): document is EditorDocument => Boolean(document));

    if (
      activeDocument &&
      !documentsToSync.some((document) => document.path === activeDocument.path)
    ) {
      documentsToSync.push(activeDocument);
    }

    documentsToSync.forEach((document) => {
      scheduleDocumentChange(document);
    });
  }, [
    activeDocument,
    documents,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    openDocumentPaths,
    scheduleDocumentChange,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !workspaceRoot ||
      !isRunningLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    const documentsToSync = openDocumentPaths
      .map((path) => documents[path])
      .filter(
        (document): document is EditorDocument =>
          Boolean(document) &&
          isJavaScriptTypeScriptDocumentSyncableForRoot(
            workspaceRoot,
            document,
          ),
      );

    if (
      activeDocument &&
      isJavaScriptTypeScriptDocumentSyncableForRoot(workspaceRoot, activeDocument) &&
      !documentsToSync.some((document) => document.path === activeDocument.path)
    ) {
      documentsToSync.push(activeDocument);
    }

    documentsToSync.forEach((document) => {
      scheduleJavaScriptTypeScriptDocumentChange(document);
    });
  }, [
    activeDocument,
    documents,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openDocumentPaths,
    scheduleJavaScriptTypeScriptDocumentChange,
    workspaceRoot,
  ]);

  useEffect(
    () => () => {
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
    },
    [
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
    ],
  );

  const fileStructureOutline = useMemo(() => {
    if (!activeDocument) {
      return null;
    }

    if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
      return javaScriptTypeScriptFileStructureOutlineForDocument(activeDocument);
    }

    const currentOutline = phpFileOutlinesByPath[activeDocument.path] ?? null;

    if (fileStructureScope === "current") {
      return currentOutline;
    }

    return mergePhpFileOutlines(
      currentOutline,
      phpInheritedFileOutlinesByPath[activeDocument.path] ?? null,
    );
  }, [
    activeDocument,
    fileStructureScope,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
  ]);
  const fileStructureLoading = Boolean(
    activeDocument &&
      (javaScriptTypeScriptFileStructureLoadingForDocument(activeDocument) ||
        loadingPhpFileOutlinePaths.has(activeDocument.path) ||
        (fileStructureScope === "inherited" &&
          loadingInheritedPhpFileOutlinePaths.has(activeDocument.path))),
  );
  const fileStructureCanIncludeInheritedMembers = Boolean(
    activeDocument && isLanguageServerDocument(activeDocument),
  );
  const mergedLanguageServerDiagnosticsByPath = useMemo(
    () =>
      mergeDiagnosticsByPath(
        mergeDiagnosticsByPath(
          languageServerDiagnosticsByPath,
          javaScriptTypeScriptDiagnosticsByPath,
        ),
        laravelDiagnosticsByPath,
      ),
    [
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
      laravelDiagnosticsByPath,
    ],
  );
  const activePhpLocalDiagnosticsByPath = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return {};
    }

    if (isExternallyRemovedDocumentPath(activeDocument.path)) {
      return {};
    }

    const diagnostics = localPhpDiagnosticsFromSource(activeDocument.content, []);

    if (diagnostics.length === 0) {
      return {};
    }

    return {
      [activeDocument.path]: diagnostics,
    };
  }, [
    activeDocument?.content,
    activeDocument?.language,
    activeDocument?.path,
    isExternallyRemovedDocumentPath,
  ]);
  const effectivePhpLocalDiagnosticsByPath = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return phpLocalDiagnosticsByPath;
    }

    if (activeDocument.path in activePhpLocalDiagnosticsByPath) {
      return {
        ...phpLocalDiagnosticsByPath,
        ...activePhpLocalDiagnosticsByPath,
      };
    }

    if (!(activeDocument.path in phpLocalDiagnosticsByPath)) {
      return phpLocalDiagnosticsByPath;
    }

    const next = { ...phpLocalDiagnosticsByPath };
    delete next[activeDocument.path];
    return next;
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activePhpLocalDiagnosticsByPath,
    phpLocalDiagnosticsByPath,
  ]);
  const activePhpLocalDiagnosticNotices = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return [];
    }

    const diagnostics =
      activePhpLocalDiagnosticsByPath[activeDocument.path] ?? [];

    if (diagnostics.length === 0) {
      return [];
    }

    const uri = fileUriFromPath(activeDocument.path);
    const groupKey = phpLocalDiagnosticNoticeGroup(activeDocument.path);

    return capDiagnosticNotices(
      diagnostics.map((diagnostic) =>
        createWorkbenchNotice(
          languageServerDiagnosticNoticeSeverity(diagnostic.severity),
          diagnostic.source || "PHP",
          languageServerDiagnosticNoticeMessage(diagnostic, uri),
          groupKey,
          diagnosticNoticeNavigationTarget(uri, diagnostic),
        ),
      ),
      DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
      (hiddenCount) =>
        buildDiagnosticOverflowNotice("PHP", groupKey, hiddenCount),
    );
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activePhpLocalDiagnosticsByPath,
  ]);
  const effectiveNotices = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return notices;
    }

    const groupKey = phpLocalDiagnosticNoticeGroup(activeDocument.path);
    const withoutActiveLocalDiagnostics = notices.filter(
      (notice) => notice.groupKey !== groupKey,
    );

    if (activePhpLocalDiagnosticNotices.length === 0) {
      return withoutActiveLocalDiagnostics;
    }

    return capWorkbenchNotices(
      [...withoutActiveLocalDiagnostics, ...activePhpLocalDiagnosticNotices],
      GLOBAL_NOTICE_LIMIT,
      isCappableDiagnosticNotice,
    );
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activePhpLocalDiagnosticNotices,
    notices,
  ]);
  const diagnosticsSummary = useMemo<DiagnosticsSummary>(
    () => {
      return summarizeDiagnosticsByPath(
        mergeDiagnosticsByPath(
          mergedLanguageServerDiagnosticsByPath,
          effectivePhpLocalDiagnosticsByPath,
        ),
      );
    },
    [
      activeDocument?.path,
      effectivePhpLocalDiagnosticsByPath,
      mergedLanguageServerDiagnosticsByPath,
    ],
  );

  return {
    activeDocument,
    activeDocumentGitBaseline: activeDocument
      ? editorGitBaselinesByPath[activeDocument.path] ?? null
      : null,
    activeEditorConfig,
    activePath,
    isOpeningFile,
    appSettings,
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    applyPhpLanguageServerWorkspaceEdit,
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
    closeImplementationChooser: () => setImplementationChooser(null),
    closeCallHierarchy: () => setCallHierarchyView(null),
    closeTypeHierarchy: () => setTypeHierarchyView(null),
    closeReferencesPanel: () => setReferencesView(null),
    closeDocument,
    closeGitDiffPreview,
    closeWorkspaceTab,
    commitAndPushGitChanges,
    commitGitChanges,
    commandContext,
    commands: commandRegistry.list(),
    diagnosticsSummary,
    dirtyCount,
    entriesByDirectory,
    expandedDirectories,
    expandedPhpFilePaths,
    fileStructureCanIncludeInheritedMembers,
    fileStructureLoading,
    fileStructureOutline,
    fileStructureOpen,
    fileStructureScope,
    flushPendingLanguageServerDocument: flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptLanguageServerDocument:
      flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerDocumentSynced,
    goToDefinition,
    goToImplementationAt,
    goToSuperMethod,
    goToNextProblem,
    goToPreviousProblem,
    isActiveDocumentPhpTest,
    registerActiveTerminalSession,
    runTestAt,
    clearEditorRevealTarget: () => setEditorRevealTarget(null),
    closeFloatingSurface,
    bottomPanelVisible,
    bottomPanelView,
    editorRevealTarget,
    gitDiffLoading,
    gitDiffPreview,
    gitCommitMessage,
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
    activeFrameworkProfile,
    isNetteFrameworkActive,
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
    openFileStructure,
    openImplementationTarget,
    openProblemNotice,
    openTodoPanel,
    closeTodoPanel,
    refreshWorkspaceTodos,
    openWorkspaceTodo,
    todoPanelOpen,
    workspaceTodos,
    workspaceTodosLoading,
    openPhpFileOutlineNode,
    openClassSearchResult,
    openWorkspaceSymbolResult,
    openWorkspaceSymbols,
    openPinnedFile,
    prefetchFile,
    cancelFilePrefetch,
    renameEntry,
    clearLanguageServerDiagnosticsForPath: (path: string) =>
      clearLanguageServerDiagnosticsForPath(workspaceRoot, path),
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
    quickOpenResults,
    recentFiles,
    recentFilesSwitcherEntries: recentFilesForSwitcher(recentFiles, activePath),
    recentFilesSwitcherOpen,
    openRecentFile,
    openRecentFilesSwitcher,
    setRecentFilesSwitcherOpen,
    recentLocations,
    recentLocationsPanelOpen,
    openRecentLocation,
    openRecentLocationsPanel,
    setRecentLocationsPanelOpen,
    bookmarks,
    sortedBookmarks: sortBookmarks(bookmarks),
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
    gitBranchLoading,
    openGitBranchPanel,
    closeGitBranchPanel,
    switchGitBranch,
    createGitBranch,
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
    clearNotices: () => setNotices([]),
    notices: effectiveNotices,
    navigateBackward,
    navigateForwardInHistory,
    navigationHistory,
    getLatencySnapshot,
    recordCompletionLatency,
    reportCommandError: (error: unknown) => reportError("Command", error),
    reportLanguageServerError,
    previewGitChange,
    quitApplication,
    refreshPhpTree,
    refreshGitStatus,
    revertGitChanges,
    revertActiveEditorChangeHunk,
    saveActiveDocument,
    saveWorkbenchSettings,
    setActivePath: activateDocument,
    hideBottomPanel,
    showBottomPanelView,
    setPaletteOpen,
    setClassOpenOpen,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setGitCommitMessage,
    setClassOpenQuery,
    setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery,
    setSettingsOpen,
    setTextSearchOpen,
    setTextSearchQuery,
    setTextSearchOptions,
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
    stopLanguageServer,
    settingsOpen,
    selectedGitChange,
    textSearchLoading,
    textSearchOpen,
    textSearchQuery,
    textSearchOptions,
    textSearchResults,
    textReplacement,
    setTextReplacement,
    textReplaceBusy,
    replaceAllInPath,
    replaceInFile,
    toggleDirectory,
    toggleGitChangeIncluded,
    loadGitFileHunks,
    stageGitChanges,
    stageGitHunk,
    unstageGitChanges,
    unstageGitHunk,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    togglePhpTreeNode,
    toggleSmartMode,
    toggleWorkspaceTrust,
    updateActiveDocument,
    activeEditorPosition,
    updateActiveEditorPosition,
    openPhpTreeNode,
    openSearchResult,
    openTextSearchResult,
    sidebarView,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTabs: appSettings.workspaceTabs,
    workspaceSettings,
    workspaceTrust,
  };
}

function mergeDiagnosticsByPath(
  ...maps: Array<Record<string, LanguageServerDiagnostic[]>>
): Record<string, LanguageServerDiagnostic[]> {
  const merged: Record<string, LanguageServerDiagnostic[]> = {};

  maps.forEach((map) => {
    Object.entries(map).forEach(([path, diagnostics]) => {
      merged[path] = [...(merged[path] ?? []), ...diagnostics];
    });
  });

  return merged;
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const normalizedPath = path.split("\\").join("/");

  if (normalizedPath === normalizedRoot) {
    return getFileName(path);
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return path;
}

function shouldRunInitialIndexScan(
  cachedWorkspaceState: CachedWorkspaceWorkbenchState | null,
): boolean {
  if (!cachedWorkspaceState) {
    return true;
  }

  return cachedWorkspaceState.indexProgress.status !== "completed";
}

/**
 * Converts a 1-based editor position into a 0-based character offset into
 * `source` (used to feed the offset-based template detection helpers). Lines
 * beyond the source resolve to its end; columns beyond a line clamp to that
 * line's end.
 */
function documentOffsetAtEditorPosition(
  source: string,
  position: EditorPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

function workspacePathBelongsToRoot(
  path: string,
  workspaceRoot: string | null | undefined,
): boolean {
  const normalizedRoot = normalizedWorkspaceRootKey(workspaceRoot);
  const normalizedPath = normalizedWorkspaceRootKey(path);

  if (!normalizedRoot) {
    return false;
  }

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`) ||
    normalizedPath.startsWith(`${normalizedRoot}\\`)
  );
}

function absolutePathBelongsInsideRoot(path: string, root: string): boolean {
  const normalizedRoot = normalizeAbsoluteWorkspacePath(root);
  const normalizedPath = normalizeAbsoluteWorkspacePath(path);

  if (!normalizedRoot || !normalizedPath || normalizedPath === normalizedRoot) {
    return false;
  }

  const rootPrefix = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : `${normalizedRoot}/`;

  return normalizedPath.startsWith(rootPrefix);
}

function normalizeAbsoluteWorkspacePath(path: string): string | null {
  const normalizedSeparators = path.trim().split("\\").join("/");
  const driveMatch = /^[A-Za-z]:\//.exec(normalizedSeparators);
  const prefix = driveMatch
    ? normalizedSeparators.slice(0, 2).toLowerCase()
    : normalizedSeparators.startsWith("/")
      ? ""
      : null;

  if (prefix === null) {
    return null;
  }

  const rest = driveMatch
    ? normalizedSeparators.slice(3)
    : normalizedSeparators.slice(1);
  const segments: string[] = [];

  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  if (prefix) {
    return segments.length > 0 ? `${prefix}/${segments.join("/")}` : `${prefix}/`;
  }

  return `/${segments.join("/")}`;
}

function identifierAtEditorPosition(
  source: string,
  position: EditorPosition,
): string | null {
  const line = source.split(/\r?\n/)[position.lineNumber - 1] ?? "";
  const cursorIndex = Math.max(0, Math.min(line.length, position.column - 1));
  const matches = line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g);

  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (cursorIndex >= start && cursorIndex <= end) {
      return match[0];
    }
  }

  return null;
}

function mergePhpFileOutlines(
  currentOutline: PhpFileOutline | null,
  inheritedOutline: PhpFileOutline | null,
): PhpFileOutline | null {
  if (!currentOutline && !inheritedOutline) {
    return null;
  }

  return {
    nodes: [
      ...(currentOutline?.nodes ?? []),
      ...(inheritedOutline?.nodes ?? []),
    ],
  };
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

function parentDirectoriesInWorkspace(rootPath: string, path: string): string[] {
  if (!isSessionPathInWorkspace(rootPath, path)) {
    return [];
  }

  const root = normalizedSessionPath(rootPath);
  const directories: string[] = [];
  let current = normalizedSessionPath(getParentPath(path));

  while (isSessionPathInWorkspace(root, current)) {
    directories.unshift(current);

    if (current === root) {
      break;
    }

    const parent = normalizedSessionPath(getParentPath(current));

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return directories;
}

function isBlockedByManuallyCollapsedDirectory(
  directory: string,
  manuallyCollapsedDirectories: Set<string>,
): boolean {
  const normalizedDirectory = normalizedSessionPath(directory);

  for (const collapsedDirectory of manuallyCollapsedDirectories) {
    const normalizedCollapsedDirectory =
      normalizedSessionPath(collapsedDirectory);

    if (
      normalizedDirectory === normalizedCollapsedDirectory ||
      normalizedDirectory.startsWith(`${normalizedCollapsedDirectory}/`)
    ) {
      return true;
    }
  }

  return false;
}

function indexProgressNoticeGroup(rootPath: string): string {
  return `index-progress:${rootPath}`;
}

function isJavaScriptTypeScriptDocumentSyncableForRoot(
  rootPath: string,
  document: EditorDocument,
): boolean {
  return (
    document.readOnly !== true &&
    isJavaScriptTypeScriptLanguageServerDocument(document) &&
    isSessionPathInWorkspace(rootPath, document.path)
  );
}

function shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
  rootPath: string,
  path: string,
): boolean {
  return (
    isJavaScriptTypeScriptNavigationPath(path) &&
    !isSessionPathInWorkspace(rootPath, path)
  );
}

function isJavaScriptTypeScriptNavigationPath(path: string): boolean {
  const language = detectLanguage(path);

  return (
    language === "javascript" ||
    language === "javascriptreact" ||
    language === "typescript" ||
    language === "typescriptreact"
  );
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function javaScriptTypeScriptLanguageServerConfiguration(
  settings: WorkspaceSettings,
  activeEditorConfig: ResolvedEditorConfig = {},
  activeDocument: EditorDocument | null = null,
): LanguageServerConfigurationSettings {
  const autoImportsEnabled = settings.javaScriptTypeScriptAutoImports;
  const codeLensEnabled = settings.javaScriptTypeScriptCodeLens;
  const showReferencesCodeLensOnAllFunctions =
    settings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions;
  const completeFunctionCalls = settings.javaScriptTypeScriptCompleteFunctionCalls;
  const inlayHintsEnabled = settings.javaScriptTypeScriptInlayHints;
  const validationEnabled = settings.javaScriptTypeScriptValidation;
  const formattingOptions = formattingOptionsForActiveJavaScriptTypeScriptDocument(
    settings,
    activeEditorConfig,
    activeDocument,
  );
  const parameterNameHints = inlayHintsEnabled ? "literals" : "none";
  const preferences = {
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsWithSnippetText: true,
    includeCompletionsForImportStatements: autoImportsEnabled,
    includeCompletionsForModuleExports: autoImportsEnabled,
    includePackageJsonAutoImports: autoImportsEnabled ? "auto" : "off",
    importModuleSpecifierEnding:
      settings.javaScriptTypeScriptImportModuleSpecifierEnding,
    importModuleSpecifierPreference:
      settings.javaScriptTypeScriptImportModuleSpecifierPreference,
    includeInlayEnumMemberValueHints: inlayHintsEnabled,
    includeInlayFunctionLikeReturnTypeHints: inlayHintsEnabled,
    includeInlayFunctionParameterTypeHints: inlayHintsEnabled,
    includeInlayParameterNameHints: parameterNameHints,
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    mockorCodeLensEnabled: codeLensEnabled,
    mockorValidationEnabled: validationEnabled,
    preferTypeOnlyAutoImports:
      settings.javaScriptTypeScriptPreferTypeOnlyAutoImports,
    quotePreference: settings.javaScriptTypeScriptQuotePreference,
  };

  return {
    formattingOptions,
    implicitProjectConfiguration: {
      checkJs: false,
      experimentalDecorators: false,
      module: 99,
      strict: true,
      strictFunctionTypes: true,
      strictNullChecks: true,
      target: 11,
    },
    implementationsCodeLens: { enabled: codeLensEnabled },
    inlayHints: {
      enumMemberValues: { enabled: inlayHintsEnabled },
      functionLikeReturnTypes: { enabled: inlayHintsEnabled },
      parameterNames: {
        enabled: parameterNameHints,
        suppressWhenArgumentMatchesName: false,
      },
      parameterTypes: { enabled: inlayHintsEnabled },
      propertyDeclarationTypes: { enabled: inlayHintsEnabled },
      variableTypes: {
        enabled: inlayHintsEnabled,
        suppressWhenTypeMatchesName: false,
      },
    },
    preferences,
    updateImportsOnFileMove: {
      enabled: autoImportsEnabled ? "always" : "never",
    },
    validate: {
      enable: validationEnabled,
    },
    referencesCodeLens: {
      enabled: codeLensEnabled,
      showOnAllFunctions: showReferencesCodeLensOnAllFunctions,
    },
    suggest: {
      autoImports: autoImportsEnabled,
      completeFunctionCalls,
      includeAutomaticOptionalChainCompletions: true,
      includeCompletionsForImportStatements: autoImportsEnabled,
      includeCompletionsForModuleExports: autoImportsEnabled,
    },
  };
}

function formattingOptionsForActiveJavaScriptTypeScriptDocument(
  settings: WorkspaceSettings,
  activeEditorConfig: ResolvedEditorConfig,
  activeDocument: EditorDocument | null,
) {
  return (
    editorConfigFormattingOptions(activeEditorConfig) ??
    formattingOptionsFromContent(activeDocument?.content ?? "", {
      insertSpaces: settings.defaultInsertSpaces,
      tabSize: settings.defaultTabSize,
    })
  );
}

function workspaceTabsWithPath(tabs: string[], path: string): string[] {
  if (workspaceTabPathForPath(tabs, path)) {
    return tabs;
  }

  return [...tabs, path];
}

function workspaceTabPathForPath(
  tabs: string[],
  path: string | null | undefined,
): string | null {
  return tabs.find((tabPath) => workspaceRootKeysEqual(tabPath, path)) ?? null;
}

function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  if (!isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot)) {
    return false;
  }

  return status.kind === "running";
}

function isRunningLanguageServerSessionForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
  sessionId: number,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  return (
    isRunningLanguageServerForWorkspace(status, statusRoot, workspaceRoot) &&
    status.sessionId === sessionId
  );
}

function isLanguageServerActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    isLanguageServerActive(status)
  );
}

function isCrashedLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    status.kind === "crashed"
  );
}

function isLanguageServerStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is LanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}

/**
 * Conservatively computes the `use` import edit needed so the generated method
 * stubs reference valid type names in the implementing class. For each class
 * type used in a missing member's signature we resolve its fully-qualified name
 * in the SOURCE THAT DECLARED IT (interface / abstract class) and only add a
 * `use` when:
 *  - the FQN resolves confidently, and
 *  - its short name matches the token written in the stub (no alias mismatch),
 *    and
 *  - the implementing class does not already resolve that token to the same FQN.
 * If any condition is unmet the type is skipped — never inserting a wrong `use`.
 */
function missingTestPartnerMessage(
  direction: PhpTestNavigationDirection,
): string {
  if (direction === "toSubject") {
    return "No test subject found for this test. Create the class first.";
  }

  return "No test found for this class. Run Generate Test to create one.";
}
