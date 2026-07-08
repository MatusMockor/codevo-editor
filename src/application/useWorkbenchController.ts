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
import { useWorkspaceTodos } from "./useWorkspaceTodos";
import { usePhpFrameworkTargets } from "./usePhpFrameworkTargets";
import { usePhpFrameworkSourceRegistries } from "./usePhpFrameworkSourceRegistries";
import { usePhpFrameworkDefinitionNavigation } from "./usePhpFrameworkDefinitionNavigation";
import { usePhpLaravelModelNavigationTargets } from "./usePhpLaravelModelNavigationTargets";
import { usePhpContextualMemberDefinitionNavigation } from "./usePhpContextualMemberDefinitionNavigation";
import { usePhpMemberPropertyDefinitionNavigation } from "./usePhpMemberPropertyDefinitionNavigation";
import { usePhpLaravelLiteralDefinitionNavigation } from "./usePhpLaravelLiteralDefinitionNavigation";
import { usePhpSuperMethodNavigation } from "./usePhpSuperMethodNavigation";
import { usePhpIndexedDefinitionNavigation } from "./usePhpIndexedDefinitionNavigation";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";
import { useBookmarks } from "./useBookmarks";
import { useFileHistory } from "./useFileHistory";
import { useLocalHistory } from "./useLocalHistory";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
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
import { useWorkbenchNavigation } from "./useWorkbenchNavigation";
import { useWorkbenchClassOpen } from "./useWorkbenchClassOpen";
import { useWorkbenchQuickOpen } from "./useWorkbenchQuickOpen";
import { useWorkbenchSearchEverywhere } from "./useWorkbenchSearchEverywhere";
import { useWorkbenchSymbolPanels } from "./useWorkbenchSymbolPanels";
import { useWorkbenchTextSearch } from "./useWorkbenchTextSearch";
import { useWorkbenchWorkspaceSymbols } from "./useWorkbenchWorkspaceSymbols";
import { usePhpDiagnosticContextFilter } from "./usePhpDiagnosticContextFilter";
import { usePhpTraitHostPredicates } from "./usePhpTraitHostPredicates";
import {
  usePhpMethodCompletionResolvers,
} from "./usePhpMethodCompletionResolvers";
import { phpTraitThisCompletionContextAt } from "./phpTraitThisCompletionContext";
import { usePhpClassHierarchyPredicates } from "./usePhpClassHierarchyPredicates";
import { usePhpClassMemberCollectors } from "./usePhpClassMemberCollectors";
import { usePhpLaravelScopePredicates } from "./usePhpLaravelScopePredicates";
import { usePhpSignatureHelpProvider } from "./usePhpSignatureHelpProvider";
import { usePhpLaravelMethodGenericModelType } from "./usePhpLaravelMethodGenericModelType";
import { usePhpLaravelModelTypeResolvers } from "./usePhpLaravelModelTypeResolvers";
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
import { useLanguageServerRuntimeLifecycle } from "./useLanguageServerRuntimeLifecycle";
import {
  applyLanguageServerTextEdits,
  useWorkspaceEditFileOperations,
} from "./useWorkspaceEditFileOperations";
import {
  useNavigationHistory,
  useRecentNavigation,
} from "./useNavigationHistory";
import { useNavigationHistoryLifecycle } from "./useNavigationHistoryLifecycle";
import { useTerminalTestRunner } from "./useTerminalTestRunner";
import { useWorkbenchFrameworkIntelligence } from "./useWorkbenchFrameworkIntelligence";
import { useWorkbenchFrameworkProviderAdapter } from "./useWorkbenchFrameworkProviderAdapter";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { resolvePhpFrameworkLiteralCompletions } from "./phpFrameworkLiteralCompletions";
import { resolvePhpFrameworkScopedCompletions } from "./phpFrameworkScopedCompletions";
import { usePhpOutline } from "./usePhpOutline";
import { useJavaScriptTypeScriptFileStructure } from "./useJavaScriptTypeScriptFileStructure";
import type { PhpCodeActionNewFile } from "./usePhpCodeActions";
import {
  synthesizePhpTypedReceiverSource,
} from "./phpTypedReceiverSource";
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
  type WorkspaceReindexMode,
} from "../domain/indexProgress";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import {
  bladeLaravelReferenceDiagnostics,
} from "../domain/laravelDiagnostics";
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
  type EditorRevealTarget,
  type LanguageServerConfigurationSettings,
  type LanguageServerFeaturesGateway,
  type LanguageServerTextEdit,
} from "../domain/languageServerFeatures";
import {
  planFormatOnSave,
  type FormatOnSavePlan,
} from "../domain/formatOnSave";
import {
  fullDocumentRange,
  javaScriptTypeScriptOnSaveSourceActionKinds,
  organizeImportsCodeActionToResolve,
  organizeImportsCodeActionContext,
  organizeImportsTextEditsForPath,
  planOrganizeImportsOnSave,
} from "../domain/organizeImportsOnSave";
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
  collectBareKeyShortcutKeys,
  eventCanMatchKeymapShortcut,
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
} from "../domain/keymap";
import {
  summarizeDiagnosticsByPath,
  type DiagnosticsSummary,
} from "../domain/diagnosticsSummary";
import {
  implementationChooserTitle,
  implementationTargetFromProjectSymbol,
  type ImplementationTarget,
} from "../domain/implementationTargets";
import {
  applyEditorChangeRevert,
  type EditorChangeHunk,
} from "../domain/editorChangeMarkers";
import {
  isLanguageServerActive,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type UnsubscribeFn,
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
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";
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
  phpMemberAccessCompletionContextAt,
  phpMixinClassNames,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelMorphMapEntriesFromSource,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
} from "../domain/phpFrameworkLaravel";
import {
  phpLaravelEnvTargetFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import {
  phpCurrentClassName,
} from "../domain/phpSemanticEngine";
import {
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsViews,
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
  resolvePhpFrameworkProfile,
} from "../domain/phpFrameworkProviders";
import {
  phpClassPathCandidates,
  phpDocMethodPositionOrNull,
  phpPropertyPositionOrNull,
  phpIdentifierContextAt,
  phpImplementationDeclarationContextAt,
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
  phpMethodPosition,
  phpMethodPositionOrNull,
  phpNamedTypePosition,
  phpSuperTypeReferences,
  resolvePhpClassName,
  type PhpMethodDefinitionHint,
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
import {
  optimizePhpImportsSource,
} from "../domain/phpImportsOrganizer";
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
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

type PhpLaravelEnvNavigationTarget = PhpLaravelEnvTarget;

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
  const activePhpFrameworkProviders = phpFrameworkIntelligence.providers;
  const activePhpFrameworkProviderSignature =
    phpFrameworkIntelligence.providerSignature;
  const isLaravelFrameworkActive = phpFrameworkIntelligence.isLaravel;
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
  const [editorRevealTarget, setEditorRevealTarget] =
    useState<EditorRevealTarget | null>(null);
  const { navigationHistory, resetHistory, restoreHistory, setNavigationHistory } =
    useNavigationHistoryLifecycle();
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
  // Reactive mirror of the active editor's caret for the status bar's "Ln X,
  // Col Y" item. The ref above is read synchronously by navigation/definition
  // flows; this state drives the rendered indicator. The EditorSurface refires
  // `onCursorPositionChange` on every model swap (tab switch), so this always
  // reflects the ACTIVE tab's caret, and it is cleared when the active document
  // or workspace goes away so a stale tab's position can never linger.
  const [activeEditorPosition, setActiveEditorPosition] =
    useState<EditorPosition | null>(null);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Per-workspace MRU buffer (newest first). Cached/restored alongside the rest
  // of the per-tab workbench state so one project's recent files can never leak
  // into another project's switcher.
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [recentFilesSwitcherOpen, setRecentFilesSwitcherOpen] = useState(false);
  // Recent EDIT / navigation LOCATIONS (file + line + line snippet), newest
  // first. Like recentFiles this is part of the per-tab workbench state so one
  // project's visited positions can never leak into another project's panel.
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [recentLocationsPanelOpen, setRecentLocationsPanelOpen] =
    useState(false);
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
  const phpLaravelMorphMapModelTypeCacheRef = useRef<
    Record<string, string | null>
  >({});
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
  const phpLocalDiagnosticValidationGenerationRef = useRef(0);
  const laravelDiagnosticValidationGenerationRef = useRef(0);
  const phpLocalDiagnosticRetryTimersRef = useRef<
    ReturnType<typeof setTimeout>[]
  >([]);
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
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
    isLaravelFrameworkActive,
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
    activeEditorPositionRef.current = null;
    setActiveEditorPosition(null);
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
      activeEditorPositionRef.current = null;
      setActiveEditorPosition(null);
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

  const activateWorkspaceTab = useCallback(
    async (path: string) => {
      if (workspaceRootKeysEqual(path, workspaceRoot)) {
        return;
      }

      await openWorkspacePath(path);
    },
    [openWorkspacePath, workspaceRoot],
  );

  const { closeWorkspaceTab, quitApplication } = useWorkbenchCloseLifecycle({
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

  const requestFormatOnSaveEdits = useCallback(
    async (
      plan: FormatOnSavePlan,
      requestedRoot: string,
      path: string,
      content: string,
    ): Promise<LanguageServerTextEdit[]> => {
      const settings = workspaceSettingsRef.current;
      const options = formattingOptionsFromContent(content, {
        insertSpaces: settings.defaultInsertSpaces,
        tabSize: settings.defaultTabSize,
      });

      if (plan.provider === "javaScriptTypeScript") {
        return javaScriptTypeScriptLanguageServerFeaturesGateway.formatting(
          requestedRoot,
          path,
          options,
        );
      }

      return languageServerFeaturesGateway.formatting(
        requestedRoot,
        path,
        options,
      );
    },
    [
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      languageServerFeaturesGateway,
    ],
  );

  const flushPendingDocumentChangeForFormatOnSave = useCallback(
    async (plan: FormatOnSavePlan, path: string): Promise<void> => {
      if (plan.provider === "javaScriptTypeScript") {
        await flushPendingJavaScriptTypeScriptDocumentChange(path);
        return;
      }

      await flushPendingDocumentChange(path);
    },
    [flushPendingDocumentChange, flushPendingJavaScriptTypeScriptDocumentChange],
  );

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

  const formattedContentForSave = useCallback(
    async (
      document: EditorDocument,
      requestedRoot: string,
    ): Promise<string> => {
      if (!workspaceSettingsRef.current.formatOnSave) {
        return document.content;
      }

      const plan = planFormatOnSave({
        document,
        hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
        javaScriptTypeScript: {
          status: javaScriptTypeScriptLanguageServerRuntimeStatusRef.current,
          statusRoot:
            javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        },
        php: {
          status: languageServerRuntimeStatusRef.current,
          statusRoot: languageServerRuntimeStatusRootRef.current,
        },
        workspaceRoot: requestedRoot,
      });

      if (!plan) {
        return document.content;
      }

      const isRequestedSessionActive = () =>
        plan.provider === "javaScriptTypeScript"
          ? isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
              requestedRoot,
              plan.sessionId,
            )
          : isLanguageServerSessionActiveForRoot(requestedRoot, plan.sessionId);

      try {
        // Flush any debounced document change so the language server formats the
        // current content rather than the stale snapshot it last received.
        await flushPendingDocumentChangeForFormatOnSave(plan, document.path);

        if (!isRequestedSessionActive()) {
          return document.content;
        }

        const edits = await requestFormatOnSaveEdits(
          plan,
          requestedRoot,
          document.path,
          document.content,
        );

        if (!isRequestedSessionActive()) {
          return document.content;
        }

        if (edits.length === 0) {
          return document.content;
        }

        return applyLanguageServerTextEdits(document.content, edits);
      } catch {
        return document.content;
      }
    },
    [
      flushPendingDocumentChangeForFormatOnSave,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isLanguageServerSessionActiveForRoot,
      requestFormatOnSaveEdits,
      workspaceDescriptor?.php,
    ],
  );

  // Optimize-imports-on-save: a pure, synchronous PHP `use` reorganizer applied
  // to the (already formatted) content just before it is written. It only runs
  // for PHP documents in a PHP workspace when the setting is on, and is a no-op
  // (returns the input) for any other language or when the imports are already
  // clean. Being synchronous, it adds no extra await to the save path, so the
  // existing post-format workspace-root re-check still fully guards the write.
  const optimizedImportsContentForSave = useCallback(
    (document: EditorDocument, content: string): string => {
      if (!workspaceSettingsRef.current.optimizeImportsOnSave) {
        return content;
      }

      if (!isLanguageServerDocument(document) || !workspaceDescriptor?.php) {
        return content;
      }

      return optimizePhpImportsSource(content) ?? content;
    },
    [workspaceDescriptor?.php],
  );

  // JS/TS source actions on save: unlike the synchronous PHP path, this asks
  // the JS/TS language server for each enabled source action and applies inline
  // same-file edits to the (already formatted) content before it is written.
  // It is async, so the session is re-checked after awaits and the caller
  // re-checks the workspace root before writing. Failures are no-ops.
  const organizedImportsContentForSave = useCallback(
    async (
      document: EditorDocument,
      content: string,
      requestedRoot: string,
    ): Promise<string> => {
      const plan = planOrganizeImportsOnSave({
        document,
        javaScriptTypeScript: {
          status: javaScriptTypeScriptLanguageServerRuntimeStatusRef.current,
          statusRoot:
            javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        },
        sourceActionKinds: javaScriptTypeScriptOnSaveSourceActionKinds(
          workspaceSettingsRef.current,
        ),
        workspaceRoot: requestedRoot,
      });

      if (!plan) {
        return content;
      }

      const isRequestedSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          plan.sessionId,
        );

      try {
        // Flush any debounced change so the server organizes the current content
        // rather than the stale snapshot it last received.
        await flushPendingJavaScriptTypeScriptDocumentChange(document.path);

        if (!isRequestedSessionActive()) {
          return content;
        }

        let currentContent = content;

        for (const sourceActionKind of plan.sourceActionKinds) {
          try {
            const actions =
              await javaScriptTypeScriptLanguageServerFeaturesGateway.codeActions(
                requestedRoot,
                document.path,
                fullDocumentRange(currentContent),
                organizeImportsCodeActionContext(sourceActionKind),
              );

            if (!isRequestedSessionActive()) {
              return content;
            }

            let edits = organizeImportsTextEditsForPath(
              actions,
              document.path,
              sourceActionKind,
            );

            if (!edits || edits.length === 0) {
              const actionToResolve = organizeImportsCodeActionToResolve(
                actions,
                sourceActionKind,
              );

              if (actionToResolve) {
                const resolvedAction =
                  await javaScriptTypeScriptLanguageServerFeaturesGateway.resolveCodeAction(
                    requestedRoot,
                    actionToResolve,
                  );

                if (!isRequestedSessionActive()) {
                  return content;
                }

                edits = organizeImportsTextEditsForPath(
                  [resolvedAction],
                  document.path,
                  sourceActionKind,
                );
              }
            }

            if (edits && edits.length > 0) {
              currentContent = applyLanguageServerTextEdits(
                currentContent,
                edits,
              );
              break;
            }
          } catch {
            continue;
          }
        }

        return currentContent;
      } catch {
        return content;
      }
    },
    [
      flushPendingJavaScriptTypeScriptDocumentChange,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
    ],
  );

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
        phpLaravelMorphMapModelTypeCacheRef.current = {};
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

  const updateActiveEditorPosition = useCallback((position: EditorPosition) => {
    activeEditorPositionRef.current = position;
    setActiveEditorPosition((current) =>
      current &&
      current.lineNumber === position.lineNumber &&
      current.column === position.column
        ? current
        : position,
    );
  }, []);

  // Drop the rendered caret indicator when no document is active (last tab
  // closed). A new/switched tab repopulates it: the EditorSurface refires
  // `onCursorPositionChange` on mount and on each model swap, so this only ever
  // clears the empty-editor case and never races the active tab's own caret.
  useEffect(() => {
    if (activeDocument) {
      return;
    }

    activeEditorPositionRef.current = null;
    setActiveEditorPosition(null);
  }, [activeDocument]);

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

  const resolvePhpLaravelProjectMorphMapModelType =
    useCallback(async (): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !workspaceDescriptor?.php ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const cacheKey = `${requestedRoot}:${activePhpFrameworkProviderSignature}`;

      if (
        Object.prototype.hasOwnProperty.call(
          phpLaravelMorphMapModelTypeCacheRef.current,
          cacheKey,
        )
      ) {
        return phpLaravelMorphMapModelTypeCacheRef.current[cacheKey] ?? null;
      }

      const modelTypes = new Set<string>();
      const searchResults = await Promise.all(
        ["morphMap", "enforceMorphMap"].map((query) =>
          textSearch.searchText(requestedRoot, query, 200),
        ),
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set<string>();

      for (const result of searchResults.flat()) {
        if (!isRequestedRootActive()) {
          return null;
        }

        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return null;
          }

          for (const entry of phpLaravelMorphMapEntriesFromSource(content)) {
            modelTypes.add(entry.modelClassName.replace(/^\\+/, ""));
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      const modelType =
        modelTypes.size === 1 ? (Array.from(modelTypes)[0] ?? null) : null;

      if (!isRequestedRootActive()) {
        return null;
      }

      phpLaravelMorphMapModelTypeCacheRef.current[cacheKey] = modelType;

      return modelType;
    }, [
      activePhpFrameworkProviderSignature,
      isLaravelFrameworkActive,
      readNavigationFileContent,
      textSearch,
      workspaceDescriptor,
      workspaceRoot,
    ]);

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
    isLaravelFrameworkActive,
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

  const findPhpLaravelEnvTarget = useCallback(
    async (envName: string): Promise<PhpLaravelEnvNavigationTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!isLaravelFrameworkActive || !requestedRoot) {
        return null;
      }

      for (const relativePath of [".env", ".env.example"]) {
        if (!isRequestedRootActive()) {
          return null;
        }

        const path = joinWorkspacePath(requestedRoot, relativePath);

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return null;
          }

          const target = phpLaravelEnvTargetFromSource(content, envName);

          if (!target) {
            continue;
          }

          return {
            ...target,
            path,
            relativePath,
          };
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }
        }
      }

      return null;
    },
    [
      isLaravelFrameworkActive,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

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
    isLaravelFrameworkActive,
  });

  const { resolvePhpMethodReturnType } = usePhpMethodReturnTypeResolver({
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    isLaravelFrameworkActive,
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
      helpers: phpLaravelGenericModelTypeHelpers,
      isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  });

  const providePhpMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const literalCompletions = await resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: activeDocument
            ? {
                content: source,
                path: activeDocument.path,
              }
            : null,
          position,
          providers: activePhpFrameworkProviders,
          source,
        },
        {
          collectConfigTargets,
          collectEnvTargets: collectEnvironmentTargets,
          collectNamedRouteTargets,
          collectTranslationTargets,
          collectViewTargets,
          isRequestStillCurrent: isRequestedRootActive,
        },
      );

      if (literalCompletions !== null) {
        return literalCompletions;
      }

      const scopedCompletions = await resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: activeDocument
            ? {
                path: activeDocument.path,
              }
            : null,
          isLaravelFrameworkActive,
          position,
          source,
        },
        {
          collectAuthGuardTargets,
          collectBroadcastConnectionTargets:
            collectBroadcastConnectionTargets,
          collectCacheStoreTargets,
          collectDatabaseConnectionTargets:
            collectDatabaseConnectionTargets,
          collectGateAbilityTargets: collectAuthorizationAbilityTargets,
          collectLogChannelTargets,
          collectMailMailerTargets,
          collectMiddlewareAliasTargets,
          collectPasswordBrokerTargets,
          collectQueueConnectionTargets,
          collectRedisConnectionTargets,
          collectStorageDiskTargets,
          isRequestStillCurrent: isRequestedRootActive,
        },
      );

      if (scopedCompletions !== null) {
        return scopedCompletions;
      }

      const routeActionContext =
        phpLaravelRouteActionMethodCompletionContextAt(source, position);

      if (isLaravelFrameworkActive && routeActionContext) {
        const resolvedClassName = resolvePhpClassReference(
          source,
          routeActionContext.className,
        );

        if (!resolvedClassName) {
          return [];
        }

        const methods = await collectPhpMethodsForClass(resolvedClassName);

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedPrefix = routeActionContext.prefix.toLowerCase();

        return phpMethodCompletionsWithStableMetadata(
          methods
            .filter((method) =>
              phpLaravelRouteActionMethodCompletionMatches(
                method,
                normalizedPrefix,
              ),
            )
            .sort((left, right) =>
              phpMethodCompletionSortOrder(left, right, normalizedPrefix),
            )
            .slice(0, 80),
        );
      }

      const validationRuleContext = phpFrameworkValidationRuleReferenceAt(
        source,
        position,
        activePhpFrameworkProviders,
      );

      if (validationRuleContext) {
        return phpFrameworkValidationRuleCompletions(
          validationRuleContext.prefix,
          activePhpFrameworkProviders,
        )
          .slice(0, 80)
          .map((rule) => ({
            declaringClassName: "Laravel validation rule",
            insertText: rule.insertText,
            kind: "config",
            name: rule.name,
            parameters: "",
            returnType: null,
          }));
      }

      const relationContext = phpLaravelRelationStringCompletionContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && relationContext) {
        const staticClassName = relationContext.className
          ? resolvePhpClassReference(source, relationContext.className)
          : null;
        const receiverModelType = relationContext.receiverExpression
          ? await resolvePhpEloquentBuilderModelType(
              source,
              position,
              relationContext.receiverExpression,
            )
          : null;

        if (!isRequestedRootActive()) {
          return [];
        }

        const receiverType =
          !receiverModelType && relationContext.receiverExpression
            ? await resolvePhpExpressionType(
                source,
                position,
                relationContext.receiverExpression,
              )
            : null;

        if (!isRequestedRootActive()) {
          return [];
        }

        const relationBaseOwnerType =
          staticClassName ?? receiverModelType ?? receiverType;
        const relationOwnerType = relationBaseOwnerType
          ? await resolvePhpLaravelRelationPathOwnerType(
              relationBaseOwnerType,
              relationContext.previousRelationNames ?? [],
            )
          : null;

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!relationOwnerType) {
          return [];
        }

        const normalizedPrefix = relationContext.prefix.toLowerCase();
        const relations =
          await collectPhpLaravelRelationCompletionsForClass(relationOwnerType);

        if (!isRequestedRootActive()) {
          return [];
        }

        return relations
          .filter((relation) =>
            relation.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .sort((left, right) => {
            const leftExact =
              left.name.toLowerCase() === normalizedPrefix ? 0 : 1;
            const rightExact =
              right.name.toLowerCase() === normalizedPrefix ? 0 : 1;

            if (leftExact !== rightExact) {
              return leftExact - rightExact;
            }

            return left.name.localeCompare(right.name);
          })
          .slice(0, 80);
      }

      const accessContext = phpMemberAccessCompletionContextAt(source, position);
      const staticAccessContext = phpStaticAccessCompletionContextAt(
        source,
        position,
      );

      // Warm the per-root migration + provider caches off the hot path so
      // model-attribute columns and provider-registered Builder macros surface
      // once ready. Fire-and-forget: this request is served from whatever is
      // already cached.
      if (isLaravelFrameworkActive && (accessContext || staticAccessContext)) {
        void ensurePhpFrameworkSourceCollectionsLoaded(requestedRoot);
      }

      const traitThisContext = accessContext
        ? phpTraitThisCompletionContextAt(source, position)
        : null;

      const methods = staticAccessContext
        ? await resolvePhpStaticMethodCompletions(
            source,
            staticAccessContext.className,
          )
        : accessContext
          ? await resolvePhpReceiverMethodCompletions(
              source,
              position,
              accessContext.receiverExpression,
              traitThisContext,
            )
          : [];

      if (!isRequestedRootActive()) {
        return [];
      }

      const normalizedPrefix = (
        staticAccessContext?.prefix ??
        accessContext?.prefix ??
        ""
      ).toLowerCase();

      return phpMethodCompletionsWithStableMetadata(
        methods
          .filter((method) =>
            method.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .sort((left, right) => {
            const leftExact =
              left.name.toLowerCase() === normalizedPrefix ? 0 : 1;
            const rightExact =
              right.name.toLowerCase() === normalizedPrefix ? 0 : 1;

            if (leftExact !== rightExact) {
              return leftExact - rightExact;
            }

            return left.name.localeCompare(right.name);
          })
          .slice(0, 80),
      );
    },
    [
      collectAuthGuardTargets,
      collectCacheStoreTargets,
      collectBroadcastConnectionTargets,
      collectConfigTargets,
      collectDatabaseConnectionTargets,
      collectEnvironmentTargets,
      collectLogChannelTargets,
      collectMailMailerTargets,
      collectPasswordBrokerTargets,
      collectQueueConnectionTargets,
      collectRedisConnectionTargets,
      collectStorageDiskTargets,
      collectTranslationTargets,
      collectPhpLaravelRelationCompletionsForClass,
      collectNamedRouteTargets,
      collectAuthorizationAbilityTargets,
      collectMiddlewareAliasTargets,
      collectViewTargets,
      collectPhpMethodsForClass,
      activeDocument,
      activePhpFrameworkProviders,
      ensurePhpFrameworkSourceCollectionsLoaded,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpLaravelRelationPathOwnerType,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    ],
  );

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
      intelligenceMode,
      isLaravelFrameworkActive,
      projectSymbolSearch,
      readNavigationFileContent,
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    });

  // Resolves a PHP class name (e.g. `App\Models\User`) to a navigation target:
  // the indexed-symbol position when the workspace is indexed, otherwise the
  // class declaration line in the first existing PSR-4 candidate file. Returns
  // false (no navigation) when the class cannot be resolved. Carries the
  // per-workspace isolation guards (requested-root capture + re-check after each
  // await) so stale results are dropped on tab switch. Declared before its
  // callers (providePhpFrameworkDefinition) so the useCallback reference is
  // initialised first.
  const openPhpClassTarget = useCallback(
    async (className: string, label: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const requestedSourcePath = activeDocument?.path ?? "";
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          className,
          25,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const indexedTarget = bestIndexedSymbolMatch(
          indexedSymbols,
          className,
          requestedSourcePath,
        );

        if (indexedTarget) {
          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            indexedTarget.path,
            editorPositionFromProjectSymbol(indexedTarget),
            label,
          );
        }
      }

      for (const path of phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        className,
      )) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            path,
            phpNamedTypePosition(content, shortPhpName(className)),
            label,
          );
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      return false;
    },
    [
      activeDocument,
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

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
    frameworkLiteralNavigationDependencies:
      phpFrameworkLiteralNavigationDependencies,
    isLaravelFrameworkActive,
    openNavigationTarget,
    openPhpClassTarget,
    providers: activePhpFrameworkProviders,
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });

  const provideLaravelDiagnosticsForActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    const requestedRoot = workspaceRoot;
    const generation = laravelDiagnosticValidationGenerationRef.current + 1;
    laravelDiagnosticValidationGenerationRef.current = generation;
    const isRequestedStateActive = () =>
      laravelDiagnosticValidationGenerationRef.current === generation &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      activeDocumentRef.current?.path === document?.path &&
      activeDocumentRef.current?.content === document?.content;

    if (
      !requestedRoot ||
      !document ||
      !isLaravelFrameworkActive ||
      document.language !== "blade"
    ) {
      if (document?.path) {
        setLaravelDiagnosticsByPath((current) => {
          if (!(document.path in current)) {
            return current;
          }

          const next = { ...current };
          delete next[document.path];
          return next;
        });
      }

      return;
    }

    const viewTargets = await collectViewTargets();

    if (!isRequestedStateActive()) {
      return;
    }

    const diagnostics = bladeLaravelReferenceDiagnostics(document.content, {
      viewNames: viewTargets.map((target) => target.name),
    });

    setLaravelDiagnosticsByPath((current) => {
      if (diagnostics.length === 0) {
        if (!(document.path in current)) {
          return current;
        }

        const next = { ...current };
        delete next[document.path];
        return next;
      }

      return {
        ...current,
        [document.path]: diagnostics,
      };
    });
  }, [
    collectViewTargets,
    isLaravelFrameworkActive,
    workspaceRoot,
  ]);

  useEffect(() => {
    void provideLaravelDiagnosticsForActiveDocument();
  }, [
    activeDocument?.content,
    activeDocument?.language,
    activeDocument?.path,
    provideLaravelDiagnosticsForActiveDocument,
  ]);

  const openPhpMethodHintTarget = useCallback(
    async (hint: PhpMethodDefinitionHint): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      for (const path of phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        hint.className,
      )) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            path,
            phpMethodPosition(content, hint.methodName),
            `${hint.methodName}()`,
          );
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      return false;
    },
    [
      openNavigationTarget,
      readNavigationFileContent,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openDirectPhpMethodTarget = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedClassName = className.toLowerCase();
      const normalizedMethodName = methodName.toLowerCase();

      if (shouldIndexWorkspace(intelligenceMode)) {
        const symbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          methodName,
          50,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const target = symbols.find(
          (symbol) =>
            symbol.kind === "method" &&
            symbol.name.toLowerCase() === normalizedMethodName &&
            symbol.containerName?.toLowerCase() === normalizedClassName,
        );

        if (target) {
          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            target.path,
            editorPositionFromProjectSymbol(target),
            `${methodName}()`,
          );
        }
      }

      if (!requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openMethodInClassHierarchy = async (
        candidateClassName: string,
      ): Promise<boolean> => {
        const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedCandidate.toLowerCase();

        if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
          return false;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const position =
              phpMethodPositionOrNull(content, methodName) ??
              phpDocMethodPositionOrNull(content, methodName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              return openNavigationTarget(path, position, `${methodName}()`);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openMethodInClassHierarchy(resolvedTraitName))
              ) {
                return true;
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassReference(
                content,
                mixinName,
              );

              if (
                resolvedMixinName &&
                (await openMethodInClassHierarchy(resolvedMixinName))
              ) {
                return true;
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassReference(
                content,
                superTypeName,
              );

              if (
                resolvedSuperTypeName &&
                (await openMethodInClassHierarchy(resolvedSuperTypeName))
              ) {
                return true;
              }
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      if (await openMethodInClassHierarchy(className)) {
        return true;
      }

      const boundConcreteClassName =
        await resolvePhpFrameworkBoundConcrete(className);

      if (!isRequestedRootActive()) {
        return false;
      }

      return boundConcreteClassName
        ? openMethodInClassHierarchy(boundConcreteClassName)
        : false;
    },
    [
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openDirectPhpPropertyTarget = useCallback(
    async (className: string, propertyName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openPropertyInClassHierarchy = async (
        candidateClassName: string,
      ): Promise<boolean> => {
        const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedCandidate.toLowerCase();

        if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
          return false;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const position = phpPropertyPositionOrNull(content, propertyName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              return openNavigationTarget(path, position, `$${propertyName}`);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openPropertyInClassHierarchy(resolvedTraitName))
              ) {
                return true;
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassReference(
                content,
                mixinName,
              );

              if (
                resolvedMixinName &&
                (await openPropertyInClassHierarchy(resolvedMixinName))
              ) {
                return true;
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassReference(
                content,
                superTypeName,
              );

              if (
                resolvedSuperTypeName &&
                (await openPropertyInClassHierarchy(resolvedSuperTypeName))
              ) {
                return true;
              }
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      return openPropertyInClassHierarchy(className);
    },
    [
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpSourceInheritsOrImplementsType = useCallback(
    async (
      source: string,
      targetClassName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const normalizedTargetClassName = targetClassName
        .trim()
        .replace(/^\\+/, "")
        .toLowerCase();

      if (!normalizedTargetClassName) {
        return false;
      }

      const currentClassName = phpCurrentClassName(source);
      const currentKey = currentClassName?.toLowerCase() ?? "";

      if (currentKey && visitedClassNames.has(currentKey)) {
        return false;
      }

      if (currentKey) {
        visitedClassNames.add(currentKey);
      }

      for (const reference of phpSuperTypeReferences(source)) {
        const resolvedClassName = resolvePhpClassReference(source, reference);
        const resolvedKey = resolvedClassName?.toLowerCase();

        if (!resolvedClassName || !resolvedKey) {
          continue;
        }

        if (resolvedKey === normalizedTargetClassName) {
          return true;
        }

        for (const path of await resolvePhpClassSourcePaths(resolvedClassName)) {
          try {
            if (
              await phpSourceInheritsOrImplementsType(
                await readNavigationFileContent(path),
                targetClassName,
                visitedClassNames,
              )
            ) {
              return true;
            }
          } catch {
            continue;
          }
        }
      }

      return false;
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
    ],
  );

  const indexedPhpImplementationTargets = useCallback(
    async (
      editorPosition: EditorPosition,
    ): Promise<ImplementationTarget[]> => {
      const document = activeDocument;
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !document ||
        document.language !== "php" ||
        !requestedRoot ||
        !shouldIndexWorkspace(intelligenceMode)
      ) {
        return [];
      }

      const declarationContext = phpImplementationDeclarationContextAt(
        document.content,
        editorPosition,
      );
      const targetClassName = phpCurrentClassName(document.content);

      if (!declarationContext || !targetClassName) {
        return [];
      }

      const { methodName } = declarationContext;
      const normalizedMethodName = methodName.toLowerCase();
      const normalizedTargetClassName = targetClassName.toLowerCase();
      const symbols = await projectSymbolSearch.searchProjectSymbols(
        requestedRoot,
        methodName,
        200,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      const targets = new Map<string, ImplementationTarget>();

      for (const symbol of symbols) {
        if (
          symbol.kind !== "method" ||
          symbol.path === document.path ||
          symbol.name.toLowerCase() !== normalizedMethodName
        ) {
          continue;
        }

        try {
          if (!isRequestedRootActive()) {
            return [];
          }

          const source = await readNavigationFileContent(symbol.path);

          if (!isRequestedRootActive()) {
            return [];
          }

          const candidateClassName =
            symbol.containerName ?? phpCurrentClassName(source);

          if (
            !candidateClassName ||
            candidateClassName.toLowerCase() === normalizedTargetClassName
          ) {
            continue;
          }

          if (
            !(await phpSourceInheritsOrImplementsType(
              source,
              targetClassName,
            ))
          ) {
            continue;
          }

          if (!isRequestedRootActive()) {
            return [];
          }

          const target = implementationTargetFromProjectSymbol(symbol);
          targets.set(target.id, target);
        } catch {
          continue;
        }
      }

      return [...targets.values()];
    },
    [
      activeDocument,
      intelligenceMode,
      phpSourceInheritsOrImplementsType,
      projectSymbolSearch,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

  const goToIndexedPhpImplementation = useCallback(
    async (requestedPosition?: EditorPosition): Promise<boolean> => {
      const document = activeDocument;
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

      if (!document || !requestedRoot || !editorPosition) {
        return false;
      }

      const targets = await indexedPhpImplementationTargets(editorPosition);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (targets.length === 0) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (targets.length > 1) {
        setImplementationChooser({
          targets,
          title: implementationChooserTitle(symbolName),
        });
        return true;
      }

      const [target] = targets;

      if (!target) {
        return false;
      }

      setImplementationChooser(null);
      if (!isRequestedRootActive()) {
        return false;
      }

      await openNavigationTarget(target.path, target.position, target.label);
      return true;
    },
    [
      activeDocument,
      indexedPhpImplementationTargets,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const {
    openPhpLaravelDynamicWhereTarget,
    openPhpLaravelModelAttributeTarget,
  } = usePhpLaravelModelNavigationTargets({
    currentWorkspaceRootRef,
    isLaravelFrameworkActive,
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
    isLaravelFrameworkActive,
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
      frameworkIntelligence: phpFrameworkIntelligence,
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
    phpLaravelMorphMapModelTypeCacheRef.current = {};
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
    isLaravelFrameworkActive,
    openNavigationTarget,
    setMessage,
    supportsRoutes: phpFrameworkSupportsRoutes(activePhpFrameworkProviders),
    supportsViews: phpFrameworkSupportsViews(activePhpFrameworkProviders),
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

  const goToContextualPhpDefinition = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || activeDocument.language !== "php") {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const context = phpIdentifierContextAt(activeDocument.content, editorPosition);

    if (!context) {
      return false;
    }

    if (context.kind === "methodCall") {
      return goToPhpMethodCallDefinition(context);
    }

    if (context.kind === "memberPropertyAccess") {
      return goToPhpMemberPropertyDefinition(context);
    }

    if (context.kind === "staticMethodCall") {
      return goToPhpStaticMethodCallDefinition(context);
    }

    if (context.kind === "classConstant") {
      return goToPhpClassConstantDefinition(context);
    }

    if (context.kind === "laravelRelationString") {
      return goToPhpLaravelRelationStringDefinition(context);
    }

    if (context.kind === "laravelNamedRouteString") {
      return goToPhpLaravelNamedRouteDefinition(context);
    }

    if (context.kind === "laravelTranslationString") {
      return goToPhpLaravelTranslationDefinition(context);
    }

    if (context.kind === "laravelEnvString") {
      return goToPhpLaravelEnvDefinition(context);
    }

    if (context.kind === "laravelConfigString") {
      return goToPhpLaravelConfigDefinition(context);
    }

    if (context.kind === "laravelAuthGuardString") {
      return goToPhpLaravelAuthGuardDefinition(context);
    }

    if (context.kind === "laravelGateAbilityString") {
      return goToPhpLaravelGateAbilityDefinition(context);
    }

    if (context.kind === "laravelMiddlewareAliasString") {
      return goToPhpLaravelMiddlewareAliasDefinition(context);
    }

    if (context.kind === "laravelCacheStoreString") {
      return goToPhpLaravelCacheStoreDefinition(context);
    }

    if (context.kind === "laravelDatabaseConnectionString") {
      return goToPhpLaravelDatabaseConnectionDefinition(context);
    }

    if (context.kind === "laravelBroadcastConnectionString") {
      return goToPhpLaravelBroadcastConnectionDefinition(context);
    }

    if (context.kind === "laravelQueueConnectionString") {
      return goToPhpLaravelQueueConnectionDefinition(context);
    }

    if (context.kind === "laravelRedisConnectionString") {
      return goToPhpLaravelRedisConnectionDefinition(context);
    }

    if (context.kind === "laravelMailMailerString") {
      return goToPhpLaravelMailMailerDefinition(context);
    }

    if (context.kind === "laravelPasswordBrokerString") {
      return goToPhpLaravelPasswordBrokerDefinition(context);
    }

    if (context.kind === "laravelLogChannelString") {
      return goToPhpLaravelLogChannelDefinition(context);
    }

    if (context.kind === "laravelStorageDiskString") {
      return goToPhpLaravelStorageDiskDefinition(context);
    }

    if (context.kind === "laravelViewString") {
      return goToPhpLaravelViewDefinition(context);
    }

    if (context.kind === "laravelRouteActionMethod") {
      const className = resolvePhpClassName(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      const openedMethodTarget = await openDirectPhpMethodTarget(
        className,
        context.methodName,
      );

      if (openedMethodTarget) {
        return true;
      }

      return openPhpClassTarget(className, context.className);
    }

    if (context.kind === "classIdentifier") {
      // A bare class / interface / trait / enum type reference (e.g. a
      // constructor-promoted property or parameter type-hint). Resolve it with
      // our deterministic use/namespace resolver and open the declaration line
      // BEFORE phpactor, so type navigation works regardless of the indexed
      // workspace gate. goToPhpClassIdentifierDefinition carries the
      // per-workspace isolation guards (requested-root capture + re-check after
      // each await) via openPhpClassTarget, and returns false for an
      // unresolvable type so the phpactor fallback still runs.
      return goToPhpClassIdentifierDefinition(context.name);
    }

    return false;
  }, [
    activeDocument,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpLaravelCacheStoreDefinition,
    goToPhpLaravelBroadcastConnectionDefinition,
    goToPhpLaravelConfigDefinition,
    goToPhpLaravelEnvDefinition,
    goToPhpLaravelLogChannelDefinition,
    goToPhpLaravelMailMailerDefinition,
    goToPhpLaravelMiddlewareAliasDefinition,
    goToPhpLaravelNamedRouteDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpLaravelStorageDiskDefinition,
    goToPhpLaravelTranslationDefinition,
    goToPhpLaravelViewDefinition,
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  ]);

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
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    identifierAtEditorPosition,
    intelligenceMode,
    openDirectPhpMethodTarget,
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

  const startReindex = useCallback(async (
    mode: WorkspaceReindexMode,
    language?: string,
  ) => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldIndexWorkspace(intelligenceMode)) {
      setMessage("Enable Smart Index or IDE Mode to index this workspace.");
      return;
    }

    const requestedRoot = workspaceRoot;
    pendingIndexScanRef.current = true;
    pendingIndexRootRef.current = requestedRoot;

    try {
      const started = await indexProgressGateway.startReindex(
        requestedRoot,
        mode,
        language,
      );

      if (
        !pendingIndexScanRef.current ||
        !workspaceRootKeysEqual(pendingIndexRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        return;
      }

      if (!workspaceRootKeysEqual(started.rootPath, requestedRoot)) {
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        return;
      }

      activeIndexRootRef.current = started.rootPath;
      setIndexProgress(startIndexProgress(started));
      const message = reindexStartMessage(mode);
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(
          current,
          createIndexHealthLogEntry("info", requestedRoot, message),
        ),
      );
      setMessage(message);
    } catch (error) {
      if (!workspaceRootKeysEqual(pendingIndexRootRef.current, requestedRoot)) {
        return;
      }

      pendingIndexScanRef.current = false;
      pendingIndexRootRef.current = null;

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      reportError("Index", error);
    }
  }, [indexProgressGateway, intelligenceMode, reportError, workspaceRoot]);

  const startIndexScan = useCallback(async () => {
    await startReindex("soft");
  }, [startReindex]);

  const startPhpReindex = useCallback(async () => {
    await startReindex("language", "php");
  }, [startReindex]);

  const startHardReindex = useCallback(async () => {
    await startReindex("hard");
  }, [startReindex]);

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

    registry.register({
      id: "workspace.open",
      title: "Open Workspace",
      category: "Workspace",
      isEnabled: () => true,
      run: openWorkspace,
    });

    registry.register({
      id: "workspace.refresh",
      title: "Refresh Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshWorkspace,
    });

    registry.register({
      id: "workspace.trust",
      title: workspaceTrust?.trusted
        ? "Revoke Workspace Trust"
        : "Trust Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleWorkspaceTrust,
    });

    registry.register({
      id: "file.new",
      title: "New File",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createFile,
    });

    registry.register({
      id: "php.generateTest",
      title: "Generate Test",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        activeDocument?.language === "php",
      run: generateTestForActiveDocument,
    });

    registry.register({
      id: "php.goToTest",
      title: "Go to Test / Test Subject",
      category: "PHP",
      shortcut: shortcut("php.goToTest"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        activeDocument?.language === "php",
      run: goToTestForActiveDocument,
    });

    registry.register({
      id: "php.runTest",
      title: "Run Test Under Cursor",
      category: "PHP",
      shortcut: shortcut("php.runTest"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        activeDocument?.language === "php",
      run: runTestForActiveDocument,
    });

    registry.register({
      id: "php.runTestFile",
      title: "Run All Tests in File",
      category: "PHP",
      shortcut: shortcut("php.runTestFile"),
      isEnabled: (context) =>
        context.hasWorkspace && isActiveDocumentPhpTest,
      run: runAllTestsForActiveDocument,
    });

    registry.register({
      id: "file.quickOpen",
      title: "Quick Open File",
      category: "File",
      shortcut: shortcut("file.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        setClassOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setQuickOpenOpen(true);
      },
    });

    registry.register({
      id: "editor.recentFiles",
      title: "Recent Files",
      category: "File",
      shortcut: shortcut("editor.recentFiles"),
      isEnabled: (context) => context.hasWorkspace,
      run: openRecentFilesSwitcher,
    });

    registry.register({
      id: "editor.recentLocations",
      title: "Recent Locations",
      category: "File",
      shortcut: shortcut("editor.recentLocations"),
      isEnabled: (context) => context.hasWorkspace,
      run: openRecentLocationsPanel,
    });

    registry.register({
      id: "class.quickOpen",
      title: "Open Class",
      category: "PHP",
      shortcut: shortcut("class.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        setQuickOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setClassOpenOpen(true);
      },
    });

    registry.register({
      id: "editor.goToSymbol",
      title: "Go to Symbol in Workspace",
      category: "Editor",
      shortcut: shortcut("editor.goToSymbol"),
      isEnabled: (context) =>
        context.hasWorkspace && canSearchClassOpenSymbols,
      run: openWorkspaceSymbols,
    });

    registry.register({
      id: "workbench.searchEverywhere",
      title: "Search Everywhere",
      category: "Workbench",
      shortcut: shortcut("workbench.searchEverywhere"),
      isEnabled: () => true,
      run: openSearchEverywhere,
    });

    registry.register({
      id: "search.text",
      title: "Search Text",
      category: "Search",
      shortcut: shortcut("search.text"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => setTextSearchOpen(true),
    });

    registry.register({
      id: "navigation.back",
      title: "Go Back",
      category: "Navigation",
      shortcut: shortcut("navigation.back"),
      isEnabled: () => navigationHistory.backStack.length > 0,
      run: navigateBackward,
    });

    registry.register({
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: shortcut("navigation.forward"),
      isEnabled: () => navigationHistory.forwardStack.length > 0,
      run: navigateForwardInHistory,
    });

    registry.register({
      id: "folder.new",
      title: "New Folder",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createDirectory,
    });

    registry.register({
      id: "file.rename",
      title: "Rename Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: renameActiveDocument,
    });

    registry.register({
      id: "file.delete",
      title: "Delete Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: deleteActiveDocument,
    });

    registry.register({
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      shortcut: shortcut("editor.save"),
      isEnabled: (context) =>
        context.hasActiveDocument && context.activeDocumentDirty,
      run: saveActiveDocument,
    });

    registry.register({
      id: "editor.closeTab",
      title: "Close",
      category: "Editor",
      shortcut: shortcut("editor.closeTab"),
      isEnabled: () =>
        Boolean(activeDocument || selectedGitChange || gitDiffLoading || isTauri()),
      run: closeActiveSurface,
    });

    registry.register({
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToDefinition"),
      isEnabled: () => Boolean(activeDocument),
      run: goToDefinition,
    });

    registry.register({
      id: "editor.fontZoomIn",
      title: "Increase Editor Font Size",
      category: "Editor",
      shortcut: shortcut("editor.fontZoomIn"),
      isEnabled: () => true,
      run: zoomEditorFontIn,
    });

    registry.register({
      id: "editor.fontZoomOut",
      title: "Decrease Editor Font Size",
      category: "Editor",
      shortcut: shortcut("editor.fontZoomOut"),
      isEnabled: () => true,
      run: zoomEditorFontOut,
    });

    registry.register({
      id: "editor.fontZoomReset",
      title: "Reset Editor Font Size",
      category: "Editor",
      shortcut: shortcut("editor.fontZoomReset"),
      isEnabled: () => true,
      run: resetEditorFontSize,
    });

    registry.register({
      id: "editor.toggleFontLigatures",
      title: "Toggle Editor Font Ligatures",
      category: "Editor",
      shortcut: shortcut("editor.toggleFontLigatures"),
      isEnabled: () => true,
      run: toggleEditorFontLigatures,
    });

    registry.register({
      id: "editor.goToSourceDefinition",
      title: "Go to Source Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToSourceDefinition"),
      isEnabled: () =>
        Boolean(activeDocument) &&
        Boolean(
          activeDocument &&
            isJavaScriptTypeScriptLanguageServerDocument(activeDocument),
        ) &&
        isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "sourceDefinition",
        ),
      run: goToSourceDefinition,
    });

    registry.register({
      id: "editor.goToDeclaration",
      title: "Go to Declaration",
      category: "Editor",
      shortcut: shortcut("editor.goToDeclaration"),
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "declaration",
            )
          );
        }

        return (
          isLanguageServerDocument(activeDocument) &&
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "declaration",
          )
        );
      },
      run: goToDeclaration,
    });

    registry.register({
      id: "editor.goToTypeDefinition",
      title: "Go to Type Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToTypeDefinition"),
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "typeDefinition",
            )
          );
        }

        return (
          isLanguageServerDocument(activeDocument) &&
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "typeDefinition",
          )
        );
      },
      run: goToTypeDefinition,
    });

    registry.register({
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: shortcut("editor.goToImplementation"),
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "implementation",
            )
          );
        }

        return (
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "implementation",
          )
        );
      },
      run: goToImplementation,
    });

    registry.register({
      id: "editor.goToSuperMethod",
      title: "Go to Super Method",
      category: "Editor",
      shortcut: shortcut("editor.goToSuperMethod"),
      isEnabled: () => activeDocument?.language === "php",
      run: async () => {
        await goToSuperMethod();
      },
    });

    registry.register({
      id: "editor.fileStructure",
      title: "File Structure",
      category: "Editor",
      shortcut: shortcut("editor.fileStructure"),
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "documentSymbol",
            )
          );
        }

        return isLanguageServerDocument(activeDocument);
      },
      run: openFileStructure,
    });

    registry.register({
      id: "editor.toggleGitBlame",
      title: "Annotate with Git Blame",
      category: "Editor",
      shortcut: shortcut("editor.toggleGitBlame"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: toggleGitBlame,
    });

    registry.register({
      id: "editor.showFileHistory",
      title: "Show File History",
      category: "Editor",
      shortcut: shortcut("editor.showFileHistory"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: () => {
        void openFileHistory();
      },
    });

    registry.register({
      id: "editor.showLocalHistory",
      title: "Local History: Show History",
      category: "Editor",
      shortcut: shortcut("editor.showLocalHistory"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: () => {
        void openLocalHistory();
      },
    });

    registry.register({
      id: "git.stashChanges",
      title: "Git: Stash Changes",
      category: "Git",
      shortcut: shortcut("git.stashChanges"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitStashPanel();
      },
    });

    registry.register({
      id: "git.showStashes",
      title: "Git: Show Stashes",
      category: "Git",
      shortcut: shortcut("git.showStashes"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitStashPanel();
      },
    });

    registry.register({
      id: "git.switchBranch",
      title: "Git: Switch Branch",
      category: "Git",
      shortcut: shortcut("git.switchBranch"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitBranchPanel();
      },
    });

    registry.register({
      id: "git.newBranch",
      title: "Git: New Branch",
      category: "Git",
      shortcut: shortcut("git.newBranch"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void createGitBranch();
      },
    });

    registry.register({
      id: "git.commit",
      title: "Git: Commit",
      category: "Git",
      shortcut: shortcut("git.commit"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void commitGitChanges();
      },
    });

    registry.register({
      id: "editor.showCallHierarchy",
      title: "Show Call Hierarchy",
      category: "Editor",
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "callHierarchy",
            )
          );
        }

        return (
          isLanguageServerDocument(activeDocument) &&
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "callHierarchy",
          )
        );
      },
      run: openCallHierarchy,
    });

    registry.register({
      id: "editor.showTypeHierarchy",
      title: "Show Type Hierarchy",
      category: "Editor",
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "typeHierarchy",
            )
          );
        }

        return (
          isLanguageServerDocument(activeDocument) &&
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "typeHierarchy",
          )
        );
      },
      run: openTypeHierarchy,
    });

    registry.register({
      id: "editor.findReferences",
      title: "Find All References",
      category: "Editor",
      shortcut: shortcut("editor.findReferences"),
      isEnabled: () => {
        if (!activeDocument) {
          return false;
        }

        if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
          return (
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ) &&
            canUseLanguageServerFeature(
              javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
              "references",
            )
          );
        }

        return (
          isLanguageServerDocument(activeDocument) &&
          isRunningLanguageServerForWorkspace(
            languageServerRuntimeStatus,
            languageServerRuntimeStatusRoot,
            workspaceRoot,
          ) &&
          canUseLanguageServerFeature(
            languageServerRuntimeStatus.capabilities,
            "references",
          )
        );
      },
      run: openReferencesPanel,
    });

    registry.register({
      id: "editor.findFileReferences",
      title: "Find File References",
      category: "Editor",
      shortcut: shortcut("editor.findFileReferences"),
      isEnabled: () =>
        Boolean(
          activeDocument &&
            isJavaScriptTypeScriptLanguageServerDocument(activeDocument) &&
            isRunningLanguageServerForWorkspace(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
              workspaceRoot,
            ),
        ),
      run: openFileReferencesPanel,
    });

    registry.register({
      id: "commands.show",
      title: "Show Commands",
      category: "Workbench",
      shortcut: shortcut("commands.show"),
      isEnabled: () => true,
      run: () => setPaletteOpen(true),
    });

    registry.register({
      id: "workbench.openSettings",
      title: "Open Settings",
      category: "Workbench",
      shortcut: shortcut("workbench.openSettings"),
      isEnabled: () => true,
      run: openSettingsPanel,
    });

    registry.register({
      id: "workbench.openAppearanceSettings",
      title: "Open Appearance Settings",
      category: "Workbench",
      shortcut: shortcut("workbench.openAppearanceSettings"),
      isEnabled: () => true,
      run: openAppearanceSettingsPanel,
    });

    registry.register({
      id: "panel.showProblems",
      title: "Show Problems",
      category: "Workbench",
      isEnabled: () => true,
      run: () => showBottomPanelView("problems"),
    });

    registry.register({
      id: "panel.showIndex",
      title: "Show Index",
      category: "Index",
      isEnabled: () => true,
      run: () => showBottomPanelView("index"),
    });

    registry.register({
      id: "panel.toggle",
      title: "Toggle Panel",
      category: "Workbench",
      shortcut: shortcut("panel.toggle"),
      isEnabled: () => true,
      run: toggleBottomPanel,
    });

    registry.register({
      id: "panel.toggleTodo",
      title: "Toggle TODO Panel",
      category: "Workbench",
      shortcut: shortcut("panel.toggleTodo"),
      isEnabled: (context) => context.hasWorkspace,
      run: toggleTodoPanel,
    });

    registry.register({
      id: "panel.refreshTodo",
      title: "Refresh TODO Comments",
      category: "Workbench",
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void refreshWorkspaceTodos();
      },
    });

    registry.register({
      id: "bookmark.toggle",
      title: "Toggle Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.toggle"),
      isEnabled: (context) => context.hasActiveDocument,
      run: toggleBookmarkAtCursor,
    });

    registry.register({
      id: "bookmark.next",
      title: "Next Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.next"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void goToNextBookmark();
      },
    });

    registry.register({
      id: "bookmark.previous",
      title: "Previous Bookmark",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.previous"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void goToPreviousBookmark();
      },
    });

    registry.register({
      id: "bookmark.showPanel",
      title: "Show Bookmarks",
      category: "Bookmarks",
      shortcut: shortcut("bookmark.showPanel"),
      isEnabled: (context) => context.hasWorkspace,
      run: toggleBookmarksPanel,
    });

    registry.register({
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: shortcut("terminal.show"),
      isEnabled: () => true,
      run: () => showBottomPanelView("terminal"),
    });

    registry.register({
      id: "runtime.show",
      title: "Show Runtime Panel",
      category: "Workbench",
      shortcut: shortcut("runtime.show"),
      isEnabled: () => true,
      run: () => showBottomPanelView("runtime"),
    });

    registry.register({
      id: "smart.toggle",
      title: "Toggle IDE Mode",
      category: "Intelligence",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleSmartMode,
    });

    registry.register({
      id: "index.reindexSoft",
      title: "Soft Reindex Workspace",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startIndexScan,
    });

    registry.register({
      id: "index.reindexPhp",
      title: "Reindex PHP Symbols",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startPhpReindex,
    });

    registry.register({
      id: "index.reindexHard",
      title: "Hard Rebuild Index",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace &&
        shouldIndexWorkspace(intelligenceMode) &&
        indexProgress.status !== "scanning",
      run: startHardReindex,
    });

    registry.register({
      id: "phpTree.show",
      title: "Show PHP Tree",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace && shouldIndexWorkspace(intelligenceMode),
      run: () => setSidebarView("php"),
    });

    registry.register({
      id: "phpTree.refresh",
      title: "Refresh PHP Tree",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace && shouldIndexWorkspace(intelligenceMode),
      run: refreshPhpTree,
    });

    registry.register({
      id: "git.show",
      title: "Show Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: () => setSidebarView("git"),
    });

    registry.register({
      id: "git.refresh",
      title: "Refresh Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshGitStatus,
    });

    registry.register({
      id: "smart.phpactorSetup",
      title: "Show PHPactor Setup",
      category: "Intelligence",
      isEnabled: () => Boolean(createPhpactorSetupGuide(languageServerPlan)),
      run: () => setLanguageServerSetupOpen(true),
    });

    registry.register({
      id: "smart.installManagedPhpactor",
      title: "Install Managed PHP IDE Engine",
      category: "Intelligence",
      isEnabled: () =>
        Boolean(
          workspaceRoot &&
            workspaceDescriptor?.php &&
            !phpTools?.phpactor &&
            !installingManagedPhpactor,
        ),
      run: installManagedPhpactor,
    });

    registry.register({
      id: "smart.startLanguageServer",
      title: "Start PHP Language Server",
      category: "Intelligence",
      isEnabled: () =>
        shouldStartLanguageServer(intelligenceMode) &&
        languageServerPlan?.status === "ready" &&
        !isLanguageServerActiveForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ),
      run: startLanguageServer,
    });

    registry.register({
      id: "smart.stopLanguageServer",
      title: "Stop PHP Language Server",
      category: "Intelligence",
      isEnabled: () =>
        isLanguageServerActiveForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ),
      run: stopLanguageServer,
    });

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

  const commandContext = {
    hasWorkspace: Boolean(workspaceRoot),
    hasActiveDocument: Boolean(activeDocument),
    activeDocumentDirty: Boolean(
      activeDocument && !activeDocument.readOnly && isDirty(activeDocument),
    ),
  };

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        doubleShiftDetectorRef.current.reset();

        if (closeFloatingSurface()) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      // PhpStorm double-Shift -> Search Everywhere. The detector consumes every
      // keydown so an intervening key cancels a pending first tap; it returns
      // true only on the qualifying second bare Shift tap inside the window.
      if (doubleShiftDetectorRef.current.handleKeyDown(event, Date.now())) {
        event.preventDefault();
        openSearchEverywhere();
        return;
      }

      if (event.key === "F12") {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      if (matchesShortcut(event, "Cmd+Q")) {
        event.preventDefault();
        quitApplication();
        return;
      }

      const keymap = appSettingsRef.current.keymap;

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip the ~35-iteration matching loop below for such events. The
      // double-Shift detector and the explicit Escape/F12/Cmd+Q handlers above
      // already ran, so this only short-circuits the per-command matching.
      const bareKeyCache = bareKeyShortcutsRef.current;
      if (bareKeyCache.keymap !== keymap) {
        bareKeyCache.keymap = keymap;
        bareKeyCache.keys = collectBareKeyShortcutKeys(keymap);
      }

      if (!eventCanMatchKeymapShortcut(event, bareKeyCache.keys)) {
        return;
      }

      const matches = (commandId: KeymapCommandId) =>
        matchesShortcut(event, shortcutForCommand(keymap, commandId));

      if (matches("workbench.openSettings")) {
        event.preventDefault();
        openSettingsPanel();
        return;
      }

      if (matches("workbench.openAppearanceSettings")) {
        event.preventDefault();
        openAppearanceSettingsPanel();
        return;
      }

      if (matches("editor.save")) {
        event.preventDefault();
        void saveActiveDocument();
        return;
      }

      if (matches("editor.closeTab")) {
        event.preventDefault();
        closeActiveSurface();
        return;
      }

      if (matches("editor.fileStructure")) {
        event.preventDefault();
        openFileStructure();
        return;
      }

      if (matches("panel.toggle")) {
        event.preventDefault();
        toggleBottomPanel();
        return;
      }

      if (matches("panel.toggleTodo")) {
        event.preventDefault();
        if (workspaceRoot) {
          toggleTodoPanel();
        }
        return;
      }

      if (matches("bookmark.toggle")) {
        event.preventDefault();
        toggleBookmarkAtCursor();
        return;
      }

      if (matches("editor.toggleGitBlame")) {
        event.preventDefault();
        if (workspaceRoot) {
          toggleGitBlame();
        }
        return;
      }

      if (matches("editor.showFileHistory")) {
        event.preventDefault();
        if (workspaceRoot) {
          void openFileHistory();
        }
        return;
      }

      if (matches("editor.showLocalHistory")) {
        event.preventDefault();
        if (workspaceRoot) {
          void openLocalHistory();
        }
        return;
      }

      if (matches("git.stashChanges")) {
        event.preventDefault();
        if (workspaceRoot) {
          void openGitStashPanel();
        }
        return;
      }

      if (matches("git.showStashes")) {
        event.preventDefault();
        if (workspaceRoot) {
          void openGitStashPanel();
        }
        return;
      }

      if (matches("git.switchBranch")) {
        event.preventDefault();
        if (workspaceRoot) {
          void openGitBranchPanel();
        }
        return;
      }

      if (matches("git.newBranch")) {
        event.preventDefault();
        if (workspaceRoot) {
          void createGitBranch();
        }
        return;
      }

      if (matches("git.commit")) {
        event.preventDefault();
        if (workspaceRoot) {
          void commitGitChanges();
        }
        return;
      }

      if (matches("bookmark.showPanel")) {
        event.preventDefault();
        if (workspaceRoot) {
          toggleBookmarksPanel();
        }
        return;
      }

      if (matches("bookmark.next")) {
        event.preventDefault();
        if (workspaceRoot) {
          void goToNextBookmark();
        }
        return;
      }

      if (matches("bookmark.previous")) {
        event.preventDefault();
        if (workspaceRoot) {
          void goToPreviousBookmark();
        }
        return;
      }

      if (matches("editor.goToDefinition")) {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      if (matches("editor.fontZoomIn")) {
        event.preventDefault();
        zoomEditorFontIn();
        return;
      }

      if (matches("editor.fontZoomOut")) {
        event.preventDefault();
        zoomEditorFontOut();
        return;
      }

      if (matches("editor.fontZoomReset")) {
        event.preventDefault();
        resetEditorFontSize();
        return;
      }

      if (matches("editor.toggleFontLigatures")) {
        event.preventDefault();
        toggleEditorFontLigatures();
        return;
      }

      if (matches("editor.goToSourceDefinition")) {
        event.preventDefault();
        void goToSourceDefinition();
        return;
      }

      if (matches("editor.goToDeclaration")) {
        event.preventDefault();
        void goToDeclaration();
        return;
      }

      if (matches("editor.goToTypeDefinition")) {
        event.preventDefault();
        void goToTypeDefinition();
        return;
      }

      if (matches("editor.goToImplementation")) {
        event.preventDefault();
        void goToImplementation();
        return;
      }

      if (matches("editor.goToSuperMethod")) {
        event.preventDefault();
        void goToSuperMethod();
        return;
      }

      if (matches("php.goToTest")) {
        event.preventDefault();
        void goToTestForActiveDocument();
        return;
      }

      if (matches("php.runTest")) {
        event.preventDefault();
        void runTestForActiveDocument();
        return;
      }

      if (matches("editor.findReferences")) {
        event.preventDefault();
        void openReferencesPanel();
        return;
      }

      if (matches("editor.findFileReferences")) {
        event.preventDefault();
        void openFileReferencesPanel();
        return;
      }

      if (matches("editor.nextProblem")) {
        event.preventDefault();
        void goToNextProblem();
        return;
      }

      if (matches("editor.previousProblem")) {
        event.preventDefault();
        void goToPreviousProblem();
        return;
      }

      if (matches("navigation.back")) {
        event.preventDefault();
        void navigateBackward();
        return;
      }

      if (matches("navigation.forward")) {
        event.preventDefault();
        void navigateForwardInHistory();
        return;
      }

      if (matches("workbench.searchEverywhere")) {
        event.preventDefault();
        openSearchEverywhere();
        return;
      }

      if (matches("commands.show")) {
        event.preventDefault();
        setClassOpenOpen(false);
        setWorkspaceSymbolsOpen(false);
        setRecentFilesSwitcherOpen(false);
        setPaletteOpen(true);
        markFloatingSurfaceActivated();
        return;
      }

      if (matches("class.quickOpen")) {
        event.preventDefault();
        if (workspaceRoot) {
          setQuickOpenOpen(false);
          setWorkspaceSymbolsOpen(false);
          setRecentFilesSwitcherOpen(false);
          setClassOpenOpen(true);
          markFloatingSurfaceActivated();
        }
        return;
      }

      if (matches("editor.goToSymbol")) {
        event.preventDefault();
        if (workspaceRoot && canSearchClassOpenSymbols) {
          openWorkspaceSymbols();
        }
        return;
      }

      if (matches("file.quickOpen")) {
        event.preventDefault();
        if (workspaceRoot) {
          setClassOpenOpen(false);
          setWorkspaceSymbolsOpen(false);
          setRecentFilesSwitcherOpen(false);
          setQuickOpenOpen(true);
          markFloatingSurfaceActivated();
        }
        return;
      }

      if (matches("editor.recentFiles")) {
        event.preventDefault();
        openRecentFilesSwitcher();
        return;
      }

      if (matches("editor.recentLocations")) {
        event.preventDefault();
        openRecentLocationsPanel();
        return;
      }

      if (matches("search.text")) {
        event.preventDefault();
        if (workspaceRoot) {
          setTextSearchOpen(true);
        }
        return;
      }

      if (matches("terminal.show")) {
        event.preventDefault();
        showBottomPanelView("terminal");
        return;
      }

      if (matches("runtime.show")) {
        event.preventDefault();
        showBottomPanelView("runtime");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canSearchClassOpenSymbols,
    closeActiveSurface,
    closeFloatingSurface,
    goToDeclaration,
    goToDefinition,
    goToImplementation,
    goToSuperMethod,
    goToTestForActiveDocument,
    runTestForActiveDocument,
    goToNextProblem,
    goToPreviousProblem,
    markFloatingSurfaceActivated,
    goToSourceDefinition,
    goToTypeDefinition,
    navigateBackward,
    navigateForwardInHistory,
    openAppearanceSettingsPanel,
    openFileStructure,
    openRecentFilesSwitcher,
    openRecentLocationsPanel,
    openFileReferencesPanel,
    openReferencesPanel,
    openSettingsPanel,
    openWorkspaceSymbols,
    openSearchEverywhere,
    quitApplication,
    resetEditorFontSize,
    saveActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
    toggleEditorFontLigatures,
    toggleTodoPanel,
    toggleBookmarkAtCursor,
    toggleBookmarksPanel,
    toggleGitBlame,
    openFileHistory,
    openLocalHistory,
    openGitStashPanel,
    openGitBranchPanel,
    createGitBranch,
    commitGitChanges,
    goToNextBookmark,
    goToPreviousBookmark,
    workspaceRoot,
    zoomEditorFontIn,
    zoomEditorFontOut,
  ]);

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

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;
    const coalescer = new DiagnosticsCoalescer(
      applyLanguageServerDiagnostics,
      diagnosticsFlushSchedulerRef.current,
    );
    languageServerDiagnosticsCoalescerRef.current = coalescer;

    languageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        coalescer.enqueue(event);
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
          (workspaceRoot &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot))
        ) {
          return;
        }

        reportLanguageServerError(error);
      });

    // The subscription (and its coalescer) is re-established per workspace root.
    // Disposing the coalescer here only discards events buffered in the current
    // frame for the root being switched AWAY from; those belong to the now
    // background tab (filtered by the sink guards anyway) and the active tab's
    // server re-publishes its own diagnostics, so no active-view diagnostic is
    // lost. The buffer is flushed once per frame while a root stays active.
    return () => {
      active = false;
      unsubscribe?.();
      coalescer.dispose();
      if (languageServerDiagnosticsCoalescerRef.current === coalescer) {
        languageServerDiagnosticsCoalescerRef.current = null;
      }
    };
  }, [
    applyLanguageServerDiagnostics,
    languageServerDiagnosticsGateway,
    reportLanguageServerError,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;
    const coalescer = new DiagnosticsCoalescer(
      applyJavaScriptTypeScriptLanguageServerDiagnostics,
      diagnosticsFlushSchedulerRef.current,
    );
    javaScriptTypeScriptDiagnosticsCoalescerRef.current = coalescer;

    javaScriptTypeScriptLanguageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        coalescer.enqueue(event);
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
          (workspaceRoot &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot))
        ) {
          return;
        }

        reportError("JavaScript/TypeScript", error);
      });

    // See the PHP diagnostics effect: the coalescer is re-established per root
    // and only discards the current frame's buffer for the switched-away root.
    return () => {
      active = false;
      unsubscribe?.();
      coalescer.dispose();
      if (javaScriptTypeScriptDiagnosticsCoalescerRef.current === coalescer) {
        javaScriptTypeScriptDiagnosticsCoalescerRef.current = null;
      }
    };
  }, [
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    reportError,
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

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function phpNormalizedReceiverExpressionIsThis(
  receiverExpression: string,
): boolean {
  return receiverExpression.trim().replace(/\?->/g, "->") === "$this";
}

function phpMethodCompletionsWithStableMetadata(
  completions: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return completions.map(phpMethodCompletionWithStableMetadata);
}

function phpLaravelRouteActionMethodCompletionMatches(
  method: PhpMethodCompletion,
  normalizedPrefix: string,
): boolean {
  if ((method.kind ?? "method") !== "method") {
    return false;
  }

  if (method.isStatic) {
    return false;
  }

  if (method.visibility && method.visibility !== "public") {
    return false;
  }

  return method.name.toLowerCase().startsWith(normalizedPrefix);
}

function phpMethodCompletionSortOrder(
  left: PhpMethodCompletion,
  right: PhpMethodCompletion,
  normalizedPrefix: string,
): number {
  const leftExact = left.name.toLowerCase() === normalizedPrefix ? 0 : 1;
  const rightExact = right.name.toLowerCase() === normalizedPrefix ? 0 : 1;

  if (leftExact !== rightExact) {
    return leftExact - rightExact;
  }

  return left.name.localeCompare(right.name);
}

function phpMethodCompletionWithStableMetadata(
  completion: PhpMethodCompletion,
): PhpMethodCompletion {
  if (!completion.visibility) {
    return completion;
  }

  const { visibility, ...stableCompletion } = completion;

  Object.defineProperty(stableCompletion, "visibility", {
    configurable: true,
    enumerable: false,
    value: visibility,
  });

  return stableCompletion;
}

function indexProgressNoticeGroup(rootPath: string): string {
  return `index-progress:${rootPath}`;
}

function reindexStartMessage(mode: WorkspaceReindexMode): string {
  if (mode === "hard") {
    return "Hard index rebuild started.";
  }

  if (mode === "language") {
    return "PHP symbol reindex started.";
  }

  return "Index scan started.";
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
