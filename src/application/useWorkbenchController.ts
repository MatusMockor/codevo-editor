import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn as TauriUnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import { useGitStashPanel } from "./useGitStashPanel";
import { useGitBranchPanel } from "./useGitBranchPanel";
import { useFloatingSurfaces } from "./useFloatingSurfaces";
import { useGitWorkspace } from "./useGitWorkspace";
import { useWorkspaceTodos } from "./useWorkspaceTodos";
import { useLaravelTargets } from "./useLaravelTargets";
import { useBookmarks } from "./useBookmarks";
import { useFileHistory } from "./useFileHistory";
import { useLocalHistory } from "./useLocalHistory";
import { useDocumentSync } from "./useDocumentSync";
import { useDiagnostics } from "./useDiagnostics";
import {
  useNavigationHistory,
  useRecentNavigation,
} from "./useNavigationHistory";
import { useTerminalTestRunner } from "./useTerminalTestRunner";
import { useBladeIntelligence } from "./useBladeIntelligence";
import { useLatteIntelligence } from "./useLatteIntelligence";
import { useNeonIntelligence } from "./useNeonIntelligence";
import { usePhpOutline } from "./usePhpOutline";
import {
  isPhpLaravelMigrationPath,
  loadPhpLaravelMigrationSources,
  phpLaravelMigrationSourcesSignature,
} from "./phpLaravelMigrationSources";
import {
  isPhpLaravelProviderPath,
  loadPhpLaravelProviderSources,
  phpLaravelProviderSourcesSignature,
} from "./phpLaravelProviderSources";
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
  type WorkbenchNoticeNavigationTarget,
} from "./workbenchNotice";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { CallHierarchyRow, CallHierarchyView } from "../domain/callHierarchy";
import type { TypeHierarchyRow, TypeHierarchyView } from "../domain/typeHierarchy";
import type { ReferenceRow, ReferencesView } from "../domain/referencesView";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import {
  emptyGitStatus,
  type GitBlameLine,
  type GitChangedFile,
  type GitFileDiff,
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
import { phpInspectionDiagnostics } from "../domain/phpInspections";
import {
  structuralPhpSyntaxDiagnostics,
  suspiciousPhpBareIdentifierDiagnostics,
} from "../domain/phpSyntaxDiagnostics";
import {
  bladeLaravelReferenceDiagnostics,
  missingLaravelViewReferenceAt,
} from "../domain/laravelDiagnostics";
import {
  DiagnosticsCoalescer,
  animationFrameDiagnosticsFlushScheduler,
  type DiagnosticsFlushScheduler,
} from "../domain/diagnosticsCoalescer";
import {
  filterPhpLanguageServerDiagnostics,
  phpMemberMethodDiagnosticKey,
  phpMethodDiagnosticKey,
  phpTraitHostConstantDiagnosticContext,
  phpTraitHostConstantDiagnosticKey,
  phpTraitHostMethodDiagnosticContext,
  phpTraitHostMethodDiagnosticKey,
  phpTraitHostPropertyDiagnosticContext,
  phpTraitHostPropertyDiagnosticKey,
  phpUnresolvedMemberMethodDiagnosticContext,
  phpMemberPropertyDiagnosticKey,
  phpUnresolvedMemberPropertyDiagnosticContext,
  phpUnresolvedStaticMethodDiagnosticContext,
} from "../domain/phpLanguageServerDiagnosticFilters";
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
  toEditorPosition,
  toLanguageServerTextDocumentPosition,
  type EditorPosition,
  type EditorRevealTarget,
  type LanguageServerConfigurationSettings,
  type LanguageServerFeature,
  type LanguageServerDocumentSymbol,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
  type LanguageServerPosition,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceFileChange,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileOperation,
  type LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import {
  filterFileReferenceLocationsToWorkspace,
  findAllFileReferencesCommand,
} from "../domain/javascriptTypeScriptFileReferences";
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
  applyEditorConfigOnSave,
  editorConfigDirectoriesForFile,
  editorConfigFormattingOptions,
  editorConfigPathForDirectory,
  parseEditorConfig,
  resolveEditorConfigSettings,
  type EditorConfigFile,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import {
  FilePrefetchCache,
  isPrefetchableContentSize,
  shouldPrefetchFileContent,
} from "../domain/filePrefetchCache";
import { isBenignError } from "../infrastructure/globalErrorSafetyNet";
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
  nextProblemLocation,
  previousProblemLocation,
  type ProblemLocation,
} from "../domain/problemNavigation";
import {
  implementationChooserTitle,
  implementationTargetFromProjectSymbol,
  implementationTargetFromLocation,
  type ImplementationTarget,
} from "../domain/implementationTargets";
import {
  applyEditorChangeRevert,
  type EditorChangeHunk,
} from "../domain/editorChangeMarkers";
import {
  isLanguageServerActive,
  languageServerCrashMessage,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type UnsubscribeFn,
} from "../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForRoot,
  cacheLanguageServerRuntimeStatus,
  removeCachedLanguageServerRuntimeStatus,
} from "../domain/languageServerRuntimeStatusCache";
import { isJavaScriptTypeScriptWatchedPath } from "../domain/javascriptTypeScriptWatchedFiles";
import {
  canRefreshDocumentFromExternalFileChange,
  type WorkspaceFileChangeEvent,
  type WorkspaceFileChangeGateway,
  type WorkspaceFileChangeUnsubscribeFn,
} from "../domain/workspaceFileChange";
import {
  normalizedWorkspaceRootKey,
  workspaceDisplayName,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";
import {
  createNavigationHistory,
  type NavigationHistory,
} from "../domain/navigation";
import {
  emptyPhpFileOutline,
  type PhpFileOutline,
  type PhpFileOutlineGateway,
  type PhpFileStructureScope,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import {
  emptyPhpTree,
  type PhpTree,
  type PhpTreeGateway,
} from "../domain/phpTree";
import {
  phpMemberAccessCompletionContextAt,
  phpMixinClassNames,
  phpMethodCompletionsFromSource,
  phpMethodParameters,
  phpMethodSignatureContextAt,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
  type PhpMethodCompletion,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import {
  phpCallArgumentInlayContexts,
  phpParameterNameInlayHints,
  type PhpParameterNameInlayHint,
} from "../domain/phpInlayHints";
import {
  isLaravelCollectionFluentMethod,
  isLaravelCollectionTerminalModelMethod,
  isLaravelDatabaseConnectionType,
  isLaravelDatabaseQueryBuilderFactoryMethod,
  isLaravelDatabaseQueryBuilderFluentMethod,
  isLaravelDatabaseQueryBuilderType,
  isLaravelEloquentBuilderCollectionMethod,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentBuilderTerminalModelMethod,
  isLaravelEloquentModelBuilderFactoryMethod,
  isLaravelEloquentModelFluentMethod,
  isLaravelEloquentStaticBuilderMethod,
  isPhpLaravelLocalScopeSourceMethod,
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelModelAccessorTargetFromSource,
  phpLaravelModelAttributeTargetFromSource,
  phpLaravelMorphMapEntriesFromSource,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
  phpLaravelRelationPropertyCompletionsFromSource,
  phpLaravelRelationTargetClassNameFromExpression,
  phpLaravelResolvedModelTypeCandidate,
  phpLaravelScopeMethodName,
  phpLaravelStaticModelMemberCompletionsFromMethods,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import {
  detectLaravelRouteModelBindingAt,
  explicitLaravelRouteModelBindingClassName,
  phpModelNamespacePrefixes,
} from "../domain/laravelRouteModelBinding";
import {
  phpEventServiceProviderClassNames,
  phpLaravelDispatchTargetAt,
  phpLaravelEventListenerMap,
  type PhpLaravelDispatchTarget,
} from "../domain/phpLaravelDispatch";
import {
  resolveLaravelConfigTarget,
  resolveLaravelEnvTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "../domain/laravelPathResolution";
import {
  phpLaravelAuthGuardCompletionInsertText,
  phpLaravelAuthGuardReferenceContextAt,
} from "../domain/phpLaravelAuth";
import {
  phpLaravelGateAbilityCompletionInsertText,
  phpLaravelGateAbilityReferenceContextAt,
} from "../domain/phpLaravelAuthorization";
import {
  phpLaravelMiddlewareAliasCompletionInsertText,
  phpLaravelMiddlewareAliasReferenceContextAt,
} from "../domain/phpLaravelMiddleware";
import {
  phpLaravelBroadcastConnectionCompletionInsertText,
  phpLaravelBroadcastConnectionReferenceContextAt,
} from "../domain/phpLaravelBroadcasting";
import {
  phpLaravelCacheStoreCompletionInsertText,
  phpLaravelCacheStoreReferenceContextAt,
} from "../domain/phpLaravelCache";
import {
  phpLaravelDatabaseConnectionCompletionInsertText,
  phpLaravelDatabaseConnectionReferenceContextAt,
} from "../domain/phpLaravelDatabase";
import {
  phpLaravelConfigCompletionInsertText,
} from "../domain/phpLaravelConfig";
import {
  phpLaravelEnvCompletionInsertText,
  phpLaravelEnvReferenceContextAt,
  phpLaravelEnvTargetFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import {
  phpLaravelLogChannelCompletionInsertText,
  phpLaravelLogChannelReferenceContextAt,
} from "../domain/phpLaravelLog";
import {
  phpLaravelMailMailerCompletionInsertText,
  phpLaravelMailMailerReferenceContextAt,
} from "../domain/phpLaravelMail";
import {
  phpLaravelPasswordBrokerCompletionInsertText,
  phpLaravelPasswordBrokerReferenceContextAt,
} from "../domain/phpLaravelPassword";
import {
  phpLaravelQueueConnectionCompletionInsertText,
  phpLaravelQueueConnectionReferenceContextAt,
} from "../domain/phpLaravelQueue";
import {
  phpLaravelRedisConnectionCompletionInsertText,
  phpLaravelRedisConnectionReferenceContextAt,
} from "../domain/phpLaravelRedis";
import {
  phpLaravelStorageDiskCompletionInsertText,
  phpLaravelStorageDiskReferenceContextAt,
} from "../domain/phpLaravelStorage";
import {
  phpLaravelJsonTranslationCompletionInsertText,
  phpLaravelTranslationCompletionInsertText,
} from "../domain/phpLaravelTranslations";
import {
  phpLaravelViewCompletionInsertText,
} from "../domain/phpLaravelViews";
import { firstPhpDocTypeToken } from "../domain/phpDocTemplates";
import {
  phpAssignmentExpressionForVariableBefore,
  phpClassStringCallExpression,
  phpCurrentClassName,
  phpDocGenericInheritances,
  phpDocGenericMixins,
  phpDocRawTypeForVariableBefore,
  phpDocTemplateNames,
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
  phpFunctionReturnsClassStringArgument,
  phpLaravelQueryCallbackContextForVariable,
} from "../domain/phpSemanticEngine";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "../domain/phpTypeAnalysis";
import {
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerExpressionClassName,
  phpFrameworkConfigReferenceAt,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkRouteReferenceAt,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsStringLiterals,
  phpFrameworkTranslationReferenceAt,
  phpFrameworkSupportsViews,
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
  phpFrameworkViewReferenceAt,
  isPhpFrameworkProviderActive,
  phpFrameworkProviderSignature,
  resolvePhpFrameworkProfile,
} from "../domain/phpFrameworkProviders";
import {
  phpClassConstantPositionOrNull,
  phpClassIdentifierNameAt,
  phpClassPathCandidates,
  phpCurrentTypeKind,
  phpDocMethodPositionOrNull,
  phpPropertyPositionOrNull,
  phpEnclosingMethodNameAt,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpImplementationDeclarationContextAt,
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
  phpLaravelRequestMethodDefinition,
  phpMethodPosition,
  phpMethodPositionOrNull,
  phpNamedTypePosition,
  phpParameterTypeForVariable,
  phpSuperTypeReferences,
  resolvePhpClassName,
  type PhpIdentifierContext,
  type PhpMethodDefinitionHint,
} from "../domain/phpNavigation";
import {
  parsePhpClassStructure,
  type PhpClassStructure,
  type PhpMethodMember,
  type PhpPropertyMember,
} from "../domain/phpClassStructure";
import {
  phpTestClassPlan,
  renderPhpTestSkeleton,
} from "../domain/phpTestGen";
import {
  isPhpTestRelativePath,
  phpTestNavigationTargets,
  type PhpTestNavigationDirection,
} from "../domain/phpTestNavigation";
import { renderAccessors } from "../domain/phpAccessorCodeGen";
import { renderConstructor } from "../domain/phpConstructorCodeGen";
import {
  generatedPhpDocHasContent,
  renderGeneratedPhpDoc,
} from "../domain/phpDocGen";
import {
  detectMissingThisMember,
  type MissingThisMember,
  phpClassDeclaresMember,
  renderCreateConstantStub,
  renderCreateMethodStub,
  renderCreatePropertyStub,
} from "../domain/phpCreateFromUsage";
import {
  detectUnknownClassReference,
  phpCreateClassDestination,
  renderPhpTypeSkeleton,
} from "../domain/phpCreateClass";
import { planAddParameter } from "../domain/phpAddParameter";
import {
  planAddParameterType,
  planAddReturnType,
} from "../domain/phpAddTypeHint";
import { planExtractInterface } from "../domain/phpExtractInterface";
import { planExtractMethod } from "../domain/phpExtractMethod";
import { planExtractVariable } from "../domain/phpExtractVariable";
import { planInlineVariable } from "../domain/phpInlineVariable";
import {
  planIntroduceConstant,
  planIntroduceField,
} from "../domain/phpIntroduceMember";
import {
  optimizePhpImportsSource,
  organizePhpImports,
} from "../domain/phpImportsOrganizer";
import {
  phpUnusedImportRemovalAt,
  phpUnusedPrivateMethodRemovalAt,
  phpUnusedVariableRemovalAt,
} from "../domain/phpInspections";
import {
  phpCurrentNamespace,
  phpShortNameIsImported,
  planPhpAddImport,
} from "../domain/phpAddImport";
import {
  renderImplementMethodsStubs,
  renderOverrideMethodsStubs,
  renderUseImports,
} from "../domain/phpCodeGen";
import {
  detectClassMemberIndent,
  findClassBodyInsertionOffset,
  findUseImportInsertionOffset,
  indentLines,
  offsetToPosition,
} from "../domain/phpInsertionPoint";
import type {
  ProjectSymbolKind,
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import { isTypeProjectSymbol } from "../domain/projectSymbols";
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import {
  buildSearchEverywhereModel,
  type SearchEverywhereItem,
} from "../domain/searchEverywhere";
import {
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSettings,
  normalizeEditorFontSize,
  type AppSettings,
  type BackgroundRuntimePolicy,
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
  removeBookmarksForPath,
  renameBookmarksForPath,
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
  nextActiveEditorPathAfterClose,
  visibleEditorPaths,
  type EditorDocument,
  type FileEntry,
  type FileSearchResult,
  type FileSearchGateway,
  type IntelligenceMode,
  type ManagedPhpactorInstallCompletionEvent,
  type ManagedPhpactorInstallUnsubscribeFn,
  type PhpToolGateway,
  type PhpToolAvailability,
  type TextSearchResult,
  type TextSearchOptions,
  type TextSearchGateway,
  type ReplaceInPathResult,
  defaultTextSearchOptions,
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

interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
}

interface OpenNavigationOptions {
  readOnly?: boolean;
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

interface OpenGitChangeOptions {
  pin?: boolean;
}

interface OpenReadOnlyDocumentOptions {
  pin?: boolean;
}

interface PhpClassMemberCacheEntry {
  members: PhpMethodCompletion[];
  sourceSignature: string;
}

// Cached Laravel source-registry file contents (migrations or providers) for a
// single workspace root. The `signature` feeds the PHP class-member cache key so
// editing a tracked source invalidates derived members instead of serving stale
// DB columns / Builder macros.
interface PhpLaravelSourcesCacheEntry {
  signature: string;
  sources: readonly string[];
}

interface PhpTraitThisCompletionContext {
  contextualThisClassName: string | null;
  declaringClassName: string;
  memberSource: string;
}

// Upper bound on the number of PHP call expressions whose target signature is
// resolved per inlay-hints viewport request. Keeps a dense file from fanning out
// an unbounded number of signature resolutions on every scroll; calls beyond the
// cap simply receive no parameter-name hint until they scroll into a fresh
// viewport window.
const PHP_INLAY_HINT_CALL_LIMIT = 40;

// Coalescing window for directory reloads triggered by external filesystem
// changes so a burst (e.g. `git checkout`) reloads each affected directory
// once instead of thrashing the tree on every event.
const WORKSPACE_DIRECTORY_REFRESH_DEBOUNCE_MS = 120;
const WORKSPACE_GIT_STATUS_REFRESH_DEBOUNCE_MS = 120;

interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

interface AbstractMemberToImplement {
  declaringSource: string;
  member: PhpMethodMember;
}

interface PhpCodeActionTextEditRange {
  endColumn: number;
  endLineNumber: number;
  startColumn: number;
  startLineNumber: number;
}

interface PhpCodeActionTextEdit {
  range: PhpCodeActionTextEditRange;
  text: string;
}

/**
 * A brand-new file a code action creates as part of its workspace edit (e.g.
 * "Extract interface" writes a sibling `<Class>Interface.php`). Carried
 * alongside the in-document `edits` so the monaco mapper can emit a file-create
 * resource edit plus the content insertion. The path is an absolute filesystem
 * path; the action is only ever offered with a path inside the active root, so
 * applying it stays within per-workspace isolation.
 */
export interface PhpCodeActionNewFile {
  content: string;
  path: string;
  title?: string;
}

export interface PhpCodeActionDescriptor {
  edits: PhpCodeActionTextEdit[];
  /**
   * When true, marks this action as the single most-likely choice for the
   * current cursor / selection (PhpStorm Alt+Enter "most likely first"). Monaco
   * floats a preferred action to the top of the code-action list and surfaces it
   * as the auto-fix. Set on a contextual quickfix (Create method/property from
   * usage, Import class) - never on a class-level generate action.
   */
  isPreferred?: boolean;
  kind?: string;
  newFile?: PhpCodeActionNewFile;
  title: string;
}

/**
 * Cursor / selection that a PHP code-action request covers, expressed as 0-based
 * character offsets into the source. `start === end` is a bare cursor; a
 * non-empty selection has `start < end`. Position-aware actions consume it
 * ("Create method / property from usage" reads the cursor; "Extract variable"
 * reads the selection span); class-level actions ignore it.
 */
export interface PhpCodeActionRange {
  end: number;
  start: number;
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
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  openPaths: string[];
  previewPath: string | null;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  sidebarView: SidebarView;
}

const CLOSE_ACTIVE_TAB_EVENT = "mockor-close-active-tab";
const FONT_ZOOM_IN_EVENT = "mockor-editor-font-zoom-in";
const FONT_ZOOM_OUT_EVENT = "mockor-editor-font-zoom-out";
const FONT_ZOOM_RESET_EVENT = "mockor-editor-font-zoom-reset";
const OPEN_APPEARANCE_SETTINGS_EVENT = "mockor-open-appearance-settings";
const TOGGLE_FONT_LIGATURES_EVENT = "mockor-toggle-font-ligatures";
const PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS = 2;
const FILE_PREFETCH_HOVER_DELAY_MS = 80;

// A single Laravel file can publish hundreds of diagnostics. Mapping every one
// to a notice and re-rendering the notices panel freezes the main thread, so we
// cap how many diagnostic notices a document contributes. Editor markers
// (Monaco `setModelMarkers`) come from a separate, uncapped source, so this cap
// never hides a squiggle — it only bounds the textual notices list. When the
// cap trims notices, an `info` indicator carrying the truthful hidden count is
// appended so diagnostics are never dropped silently.
// KEEP IN SYNC: duplicated verbatim in useDiagnostics.ts (see the FOLLOW-UP
// note there) until the shared diagnostic-notice helpers move into their own
// module. Any edit to the caps or notice helpers below must land in BOTH files.
const DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT = 100;
// Cap for the Find-in-Path results list shown in the UI. Replace-in-Path uses
// this to tell the user when the previewed count is a lower bound (the backend
// replace itself is NOT capped to this; it rewrites every matching file).
const TEXT_SEARCH_RESULT_LIMIT = 100;

// Global ceiling on the total diagnostic notices retained in state. The
// per-document cap above bounds a single file's contribution, but a large
// project with diagnostics across thousands of files would still grow the list
// without bound — and each publishDiagnostics runs an O(total) group replace.
// This caps the head (newest groups are prepended) and appends one truthful
// overflow indicator. Editor markers come from a separate, uncapped source.
const GLOBAL_NOTICE_LIMIT = 2000;

// Only diagnostic notices are subject to the global cap; errors, setup prompts
// and other non-diagnostic notices are always retained so important messages are
// never silently dropped when a large project floods the list with diagnostics.
function isCappableDiagnosticNotice(notice: WorkbenchNotice): boolean {
  const groupKey = notice.groupKey;

  if (!groupKey) {
    return false;
  }

  return (
    groupKey.startsWith("language-server-diagnostics:") ||
    groupKey.startsWith("javascript-typescript-diagnostics:") ||
    groupKey.startsWith(PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX)
  );
}

function buildDiagnosticOverflowNotice(
  source: string,
  groupKey: string,
  hiddenCount: number,
): WorkbenchNotice {
  const shownCount = DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT;
  const totalCount = shownCount + hiddenCount;
  return createWorkbenchNotice(
    "info",
    source,
    `Showing ${shownCount} of ${totalCount} diagnostics — ${hiddenCount} more hidden. Open the file to see all markers.`,
    groupKey,
    undefined,
    "overflow",
  );
}

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

const PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX = "php-local-diagnostics:";
const phpLocalSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();

export type SidebarView = "files" | "git" | "php";

function isLaravelMorphToReturnTypeName(returnType: string | null): boolean {
  const typeName = phpDeclaredTypeCandidate(returnType ?? "") ?? returnType ?? "";
  const normalizedTypeName = typeName
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  return (
    normalizedTypeName === "morphto" ||
    normalizedTypeName?.endsWith("\\morphto") === true
  );
}

function isLaravelMorphToFactoryExpression(expression: string): boolean {
  return /\$(?:this|[A-Za-z_][A-Za-z0-9_]*)\??->morphTo\s*\(/i.test(
    expression,
  );
}

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
  // One detection pass per workspace: the active provider set and the exclusive
  // profile ("laravel" | "nette" | "generic") are derived from the same result,
  // so they can never disagree (no second source of truth).
  const phpFrameworkResolution = useMemo(
    () => resolvePhpFrameworkProfile(workspaceDescriptor?.php ?? null),
    [workspaceDescriptor?.php],
  );
  const activePhpFrameworkProviders = phpFrameworkResolution.providers;
  const activePhpFrameworkProviderSignature = useMemo(
    () => phpFrameworkProviderSignature(activePhpFrameworkProviders),
    [activePhpFrameworkProviders],
  );
  const isLaravelFrameworkActive = useMemo(
    () => isPhpFrameworkProviderActive(activePhpFrameworkProviders, "laravel"),
    [activePhpFrameworkProviders],
  );
  const isNetteFrameworkActive = useMemo(
    () => isPhpFrameworkProviderActive(activePhpFrameworkProviders, "nette"),
    [activePhpFrameworkProviders],
  );
  // Exclusive, per-workspace framework profile - the single discriminator the
  // status-bar chip and future gating key off.
  const activeFrameworkProfile = phpFrameworkResolution.profile;
  // Edge (spec 4.1): a project that declares several framework signals at once
  // (e.g. a Laravel app carrying latte/latte transitively in composer.lock)
  // resolves to a single exclusive profile by registry priority. Surface the
  // ambiguity once per workspace so the deterministic pick stays observable and
  // we never silently blend two frameworks' magic.
  useEffect(() => {
    if (phpFrameworkResolution.matchedProviderIds.length < 2) {
      return;
    }

    console.warn(
      `Multiple PHP framework signals detected (${phpFrameworkResolution.matchedProviderIds.join(
        ", ",
      )}); resolved exclusively to "${phpFrameworkResolution.profile}" by registry priority.`,
    );
  }, [phpFrameworkResolution]);
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
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [selectedGitChange, setSelectedGitChange] =
    useState<GitChangedFile | null>(null);
  const [gitDiffPreview, setGitDiffPreview] = useState<GitFileDiff | null>(
    null,
  );
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
  const [
    javaScriptTypeScriptFileOutlinesByPath,
    setJavaScriptTypeScriptFileOutlinesByPath,
  ] = useState<Record<string, PhpFileOutline>>({});
  const [
    loadingJavaScriptTypeScriptFileOutlinePaths,
    setLoadingJavaScriptTypeScriptFileOutlinePaths,
  ] = useState<Set<string>>(new Set());
  const [phpFileOutlineExpandedNodeIds, setPhpFileOutlineExpandedNodeIds] =
    useState<Set<string>>(new Set());
  const [editorRevealTarget, setEditorRevealTarget] =
    useState<EditorRevealTarget | null>(null);
  const [navigationHistory, setNavigationHistory] =
    useState<NavigationHistory>(createNavigationHistory);
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
  const [quickOpenOpen, setQuickOpenOpenState] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenResults, setQuickOpenResults] = useState<FileSearchResult[]>(
    [],
  );
  const setQuickOpenOpen = useCallback((isOpen: boolean) => {
    setQuickOpenQuery("");
    setQuickOpenResults([]);
    setQuickOpenLoading(false);
    setQuickOpenOpenState(isOpen);
  }, []);
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
  const [classOpenOpen, setClassOpenOpen] = useState(false);
  const [classOpenQuery, setClassOpenQuery] = useState("");
  const [classOpenLoading, setClassOpenLoading] = useState(false);
  const [classOpenResults, setClassOpenResults] = useState<
    ProjectSymbolSearchResult[]
  >([]);
  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = useState(false);
  const [workspaceSymbolsQuery, setWorkspaceSymbolsQuery] = useState("");
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = useState(false);
  const [workspaceSymbolsResults, setWorkspaceSymbolsResults] = useState<
    ProjectSymbolSearchResult[]
  >([]);
  // PhpStorm "Search Everywhere" (double-Shift). One dialog aggregating the
  // file / symbol / action searches above. The raw per-source results are kept
  // separately (each filled by its own per-root, debounced, drop-stale search)
  // and combined into the categorized model only at render time.
  const [searchEverywhereOpen, setSearchEverywhereOpen] = useState(false);
  const [searchEverywhereQuery, setSearchEverywhereQuery] = useState("");
  const [searchEverywhereLoading, setSearchEverywhereLoading] = useState(false);
  const [searchEverywhereFiles, setSearchEverywhereFiles] = useState<
    FileSearchResult[]
  >([]);
  const [searchEverywhereSymbols, setSearchEverywhereSymbols] = useState<
    ProjectSymbolSearchResult[]
  >([]);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchOptions, setTextSearchOptions] = useState<TextSearchOptions>(
    defaultTextSearchOptions,
  );
  const [textSearchResults, setTextSearchResults] = useState<TextSearchResult[]>(
    [],
  );
  const [textReplacement, setTextReplacement] = useState("");
  const [textReplaceBusy, setTextReplaceBusy] = useState(false);
  // Bumped after every successful replace so the Find-in-Path search effect
  // re-runs and the results list reflects what is now on disk.
  const [textSearchRefreshToken, setTextSearchRefreshToken] = useState(0);
  const [implementationChooser, setImplementationChooser] = useState<{
    targets: ImplementationTarget[];
    title: string;
  } | null>(null);
  const [callHierarchyView, setCallHierarchyView] =
    useState<CallHierarchyView | null>(null);
  const [typeHierarchyView, setTypeHierarchyView] =
    useState<TypeHierarchyView | null>(null);
  const [referencesView, setReferencesView] =
    useState<ReferencesView | null>(null);
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
  const gitDiffRequestTokenRef = useRef(0);
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
  const phpClassMemberCacheRef = useRef<Record<string, PhpClassMemberCacheEntry>>(
    {},
  );
  const phpFrameworkBindingCacheRef = useRef<Record<string, string | null>>({});
  const phpLaravelMorphMapModelTypeCacheRef = useRef<
    Record<string, string | null>
  >({});
  // Per-root cache of Laravel migration sources fed into model-attribute
  // completions. Keyed by workspace root and reset on workspace switch / reindex
  // so it can never leak DB columns across project tabs. Loaded lazily on a
  // background turn (see ensurePhpLaravelMigrationSourcesLoaded) to keep the
  // completion hot path off the file system.
  const phpLaravelMigrationSourcesByRootRef = useRef<
    Record<string, PhpLaravelSourcesCacheEntry>
  >({});
  const phpLaravelMigrationSourcesLoadInFlightRef = useRef<Set<string>>(
    new Set(),
  );
  // Per-root cache of Laravel service-provider sources fed into Eloquent Builder
  // macro completions. `Builder::macro('name', ...)` is registered in
  // app/Providers, so these sources are merged with the migration sources into
  // the single workspace source context. Same isolation guarantees as the
  // migration cache: keyed by root, reset on switch / reindex, loaded lazily off
  // the hot path (see ensurePhpLaravelProviderSourcesLoaded).
  const phpLaravelProviderSourcesByRootRef = useRef<
    Record<string, PhpLaravelSourcesCacheEntry>
  >({});
  const phpLaravelProviderSourcesLoadInFlightRef = useRef<Set<string>>(
    new Set(),
  );
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
  const pendingWorkspaceDirectoryRefreshesRef = useRef<Set<string>>(new Set());
  const workspaceDirectoryRefreshTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const workspaceGitStatusRefreshTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const phpLocalDiagnosticValidationGenerationRef = useRef(0);
  const laravelDiagnosticValidationGenerationRef = useRef(0);
  const phpLocalDiagnosticRetryTimersRef = useRef<
    ReturnType<typeof setTimeout>[]
  >([]);
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);
  const selectedGitChangeRef = useRef<GitChangedFile | null>(null);
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
  const currentWorkspaceRootRef = useRef<string | null>(null);
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
  const resolvePhpClassPropertyOrRelationTypeRef = useRef(
    async (
      _className: string,
      _propertyName: string,
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

  useEffect(() => {
    selectedGitChangeRef.current = selectedGitChange;
  }, [selectedGitChange]);

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
      setNavigationHistory(cached.navigationHistory);
      setSidebarView(cached.sidebarView);
      setBottomPanelView(cached.bottomPanelView);
      setBottomPanelVisible(cached.bottomPanelVisible);
    },
    [],
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

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string) => {
      try {
        const plan = await languageServerGateway.planPhpLanguageServer(
          rootPath,
          phpLanguageServerOptions(workspaceSettingsRef.current),
        );
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setLanguageServerPlan(plan);
        }
        return plan;
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setLanguageServerPlan(null);
          reportError("Language Server", error);
        }
        return null;
      }
    },
    [languageServerGateway, reportError],
  );

  // Detects the PHP tooling for a root, surfaces the managed PHP IDE engine
  // notice when phpactor is missing, and refreshes the PHP language server
  // plan. This is the expensive open-time work (150-700ms) that only matters
  // once the PHP language server can actually run, i.e. in IDE (full smart)
  // mode. It is shared between the open flow and the basic -> IDE mode switch
  // so the probe can be deferred at open and replayed lazily when the user
  // enables IDE mode. Every step re-checks the live root so a project switch
  // mid-flight never mutates the now-active workspace state.
  const runPhpWorkspaceProbe = useCallback(
    async (rootPath: string) => {
      try {
        const tools = await phpToolGateway.detectPhpTools(rootPath);
        const phpSetupNoticeGroup = `phpactor-setup:${rootPath}`;

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        setPhpTools(tools);

        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, []),
          );
          await refreshLanguageServerPlan(rootPath);
          return;
        }

        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, [
            createWorkbenchNotice(
              "warning",
              "PHP IDE Engine",
              "Install the managed PHP IDE engine (one-click user profile bootstrap) to enable hover, completion, definition, and implementation support.",
              phpSetupNoticeGroup,
            ),
          ]),
        );
        await refreshLanguageServerPlan(rootPath);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(rootPath, "PHP Tools", error);
      }
    },
    [
      phpToolGateway,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const refreshJavaScriptTypeScriptLanguageServerPlan = useCallback(
    async (
      rootPath: string,
      typeScriptVersionPreference =
        workspaceSettingsRef.current.javaScriptTypeScriptVersion,
    ) => {
      try {
        const plan =
          await languageServerGateway.planJavaScriptTypeScriptLanguageServer(
            rootPath,
            {
              autoImportsEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptAutoImports,
              automaticTypeAcquisitionEnabled:
                workspaceSettingsRef.current
                  .javaScriptTypeScriptAutomaticTypeAcquisition,
              codeLensEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptCodeLens,
              completeFunctionCalls:
                workspaceSettingsRef.current
                  .javaScriptTypeScriptCompleteFunctionCalls,
              inlayHintsEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptInlayHints,
              typeScriptVersionPreference,
              validationEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptValidation,
              ...javaScriptTypeScriptImportPreferenceOptions(
                workspaceSettingsRef.current,
              ),
            },
          );

        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setJavaScriptTypeScriptLanguageServerPlan(plan);
        }

        return plan;
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          setJavaScriptTypeScriptLanguageServerPlan(null);
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
        return null;
      }
    },
    [languageServerGateway, reportErrorForActiveWorkspaceRoot],
  );

  const cacheJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (rootPath: string, status: LanguageServerRuntimeStatus) => {
      return cacheLanguageServerRuntimeStatus(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        rootPath,
        status,
      );
    },
    [],
  );

  const cachePhpLanguageServerRuntimeStatus = useCallback(
    (rootPath: string, status: LanguageServerRuntimeStatus) => {
      return cacheLanguageServerRuntimeStatus(
        languageServerRuntimeStatusByRootRef.current,
        rootPath,
        status,
      );
    },
    [],
  );

  const clearManualPhpLanguageServerStop = useCallback((rootPath: string) => {
    manuallyStoppedPhpLanguageServerRootsRef.current.delete(
      normalizedWorkspaceRootKey(rootPath),
    );
  }, []);

  const markManualPhpLanguageServerStop = useCallback((rootPath: string) => {
    manuallyStoppedPhpLanguageServerRootsRef.current.add(
      normalizedWorkspaceRootKey(rootPath),
    );
  }, []);

  const isPhpLanguageServerManuallyStopped = useCallback(
    (rootPath: string) =>
      manuallyStoppedPhpLanguageServerRootsRef.current.has(
        normalizedWorkspaceRootKey(rootPath),
      ),
    [],
  );

  const forgetLanguageServerRuntimeStatuses = useCallback((rootPath: string) => {
    clearManualPhpLanguageServerStop(rootPath);
    removeCachedLanguageServerRuntimeStatus(
      languageServerRuntimeStatusByRootRef.current,
      rootPath,
    );
    removeCachedLanguageServerRuntimeStatus(
      javaScriptTypeScriptRuntimeStatusByRootRef.current,
      rootPath,
    );
  }, [clearManualPhpLanguageServerStop]);

  const isOpenWorkspaceRuntimeRoot = useCallback(
    (rootPath: string) => {
      if (workspaceRootKeysEqual(rootPath, currentWorkspaceRootRef.current)) {
        return true;
      }

      return appSettingsRef.current.workspaceTabs.some((tabPath) =>
        workspaceRootKeysEqual(tabPath, rootPath),
      );
    },
    [],
  );

  const isLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      return (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isLanguageServerSessionCurrentForRoot(rootPath, sessionId)
      );
    },
    [isLanguageServerSessionCurrentForRoot],
  );

  const isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      const currentRuntimeStatus =
        cachedLanguageServerRuntimeStatusForRoot(
          javaScriptTypeScriptRuntimeStatusByRootRef.current,
          rootPath,
        ) ??
        (workspaceRootKeysEqual(
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
          rootPath,
        )
          ? javaScriptTypeScriptLanguageServerRuntimeStatusRef.current
          : null);

      return isRunningLanguageServerSessionForWorkspace(
        currentRuntimeStatus,
        currentRuntimeStatus?.rootPath ??
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      );
    },
    [],
  );

  const isJavaScriptTypeScriptLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number) => {
      return (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          sessionId,
        )
      );
    },
    [isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot],
  );

  const handleLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus, fallbackRootPath?: string) => {
      const statusRootPath = runtimeStatusRootPath(status, fallbackRootPath);

      if (!statusRootPath) {
        return;
      }

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath)) {
        return;
      }

      const rootedStatus = cachePhpLanguageServerRuntimeStatus(
        statusRootPath,
        status,
      );
      const crash = languageServerCrashMessage(status);

      if (status.kind === "starting" || status.kind === "running") {
        clearManualPhpLanguageServerStop(statusRootPath);
      }

      if (!workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)) {
        if (status.kind !== "running") {
          clearLanguageServerDiagnosticsForRoot(statusRootPath);
        }

        return;
      }

      setLanguageServerRuntimeStatus(rootedStatus);
      setLanguageServerRuntimeStatusRoot(statusRootPath);

      if (status.kind !== "running") {
        clearLanguageServerDiagnosticsForRoot(statusRootPath);
      }

      if (!crash) {
        const previousCrash = lastLanguageServerCrashRef.current;
        if (previousCrash) {
          setMessage((current) => (current === previousCrash ? null : current));
          setNotices((current) =>
            current.filter(
              (notice) =>
                notice.source !== "Language Server" ||
                notice.message !== previousCrash,
            ),
          );
        }
        lastLanguageServerCrashRef.current = null;
        return;
      }

      reportLanguageServerError(crash);
    },
    [
      cachePhpLanguageServerRuntimeStatus,
      clearManualPhpLanguageServerStop,
      clearLanguageServerDiagnosticsForRoot,
      isOpenWorkspaceRuntimeRoot,
      reportLanguageServerError,
    ],
  );

  const handleJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus, fallbackRootPath?: string) => {
      const statusRootPath = runtimeStatusRootPath(status, fallbackRootPath);

      if (!statusRootPath) {
        return;
      }

      if (!isOpenWorkspaceRuntimeRoot(statusRootPath)) {
        return;
      }

      const rootedStatus = cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        statusRootPath,
        status,
      );
      const crash = languageServerCrashMessage(status);

      if (!workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)) {
        if (status.kind !== "running") {
          clearJavaScriptTypeScriptDiagnosticsForRoot(statusRootPath);
        }

        return;
      }

      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current = rootedStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        statusRootPath;
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(statusRootPath);

      if (status.kind !== "running") {
        clearJavaScriptTypeScriptDiagnosticsForRoot(statusRootPath);
      }

      if (!crash) {
        return;
      }

      reportError("JavaScript/TypeScript", crash);
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      isOpenWorkspaceRuntimeRoot,
      reportError,
    ],
  );

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
      phpClassSourcePathCacheRef.current = {};
      phpClassMemberCacheRef.current = {};
      phpFrameworkBindingCacheRef.current = {};
      phpLaravelMorphMapModelTypeCacheRef.current = {};
      invalidatePhpLaravelTargetCache();
      phpLaravelMigrationSourcesByRootRef.current = {};
      phpLaravelMigrationSourcesLoadInFlightRef.current = new Set();
      phpLaravelProviderSourcesByRootRef.current = {};
      phpLaravelProviderSourcesLoadInFlightRef.current = new Set();
      resetBladeIntelligenceCaches();
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
    phpClassSourcePathCacheRef.current = {};
    phpClassMemberCacheRef.current = {};
    phpFrameworkBindingCacheRef.current = {};
    phpLaravelMorphMapModelTypeCacheRef.current = {};
    invalidatePhpLaravelTargetCache();
    phpLaravelMigrationSourcesByRootRef.current = {};
    phpLaravelMigrationSourcesLoadInFlightRef.current = new Set();
    phpLaravelProviderSourcesByRootRef.current = {};
    phpLaravelProviderSourcesLoadInFlightRef.current = new Set();
    resetBladeIntelligenceCaches();
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

  const stopLanguageServerRuntime = useCallback(async (rootPath?: string) => {
    const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

    if (!targetRootPath) {
      return null;
    }

    try {
      const status = await languageServerRuntimeGateway.stop(targetRootPath);
      const requestedStatus = runtimeStatusForRequestedRoot(
        status,
        targetRootPath,
      );
      const rootedStatus = cachePhpLanguageServerRuntimeStatus(
        targetRootPath,
        requestedStatus,
      );
      clearLanguageServerDiagnosticsForRoot(targetRootPath);

      if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        setLanguageServerRuntimeStatus(rootedStatus);
        setLanguageServerRuntimeStatusRoot(targetRootPath);
        lastLanguageServerCrashRef.current = null;
        resetLanguageServerDocuments();
      }

      return rootedStatus;
    } catch (error) {
      if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        reportLanguageServerError(error);
      }
      return null;
    }
  }, [
    cachePhpLanguageServerRuntimeStatus,
    clearLanguageServerDiagnosticsForRoot,
    languageServerRuntimeGateway,
    reportLanguageServerError,
    resetLanguageServerDocuments,
  ]);

  const stopJavaScriptTypeScriptLanguageServerRuntime = useCallback(async (rootPath?: string) => {
    const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

    if (!targetRootPath) {
      return null;
    }

    try {
      const status =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.stop(targetRootPath);
      const requestedStatus = runtimeStatusForRequestedRoot(
        status,
        targetRootPath,
      );
      const rootedStatus =
        cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
          targetRootPath,
          requestedStatus,
        );
      clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath);

      if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
        resetJavaScriptTypeScriptLanguageServerDocuments();
      }

      return rootedStatus;
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        targetRootPath,
        "JavaScript/TypeScript",
        error,
      );
      return null;
    }
  }, [
    cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportErrorForActiveWorkspaceRoot,
    resetJavaScriptTypeScriptLanguageServerDocuments,
  ]);

  const stopProjectRuntimes = useCallback(
    async (rootPath?: string) => {
      const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!targetRootPath) {
        return;
      }

      try {
        await workspaceRuntimeLifecycleGateway.disposeWorkspace(targetRootPath);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(
          targetRootPath,
          "Workspace Runtime",
          error,
        );
        await Promise.allSettled([
          stopLanguageServerRuntime(targetRootPath),
          stopJavaScriptTypeScriptLanguageServerRuntime(targetRootPath),
          terminalGateway.stopRoot(targetRootPath),
        ]);
        return;
      }

      const stoppedStatus: LanguageServerRuntimeStatus = {
        kind: "stopped",
        rootPath: targetRootPath,
      };
      cachePhpLanguageServerRuntimeStatus(targetRootPath, stoppedStatus);
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
        targetRootPath,
        stoppedStatus,
      );
      clearLanguageServerDiagnosticsForRoot(targetRootPath);
      clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath);

      if (!workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        return;
      }

      setLanguageServerRuntimeStatus(stoppedStatus);
      setLanguageServerRuntimeStatusRoot(targetRootPath);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(stoppedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
      lastLanguageServerCrashRef.current = null;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      cachePhpLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      clearLanguageServerDiagnosticsForRoot,
      reportErrorForActiveWorkspaceRoot,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      stopJavaScriptTypeScriptLanguageServerRuntime,
      stopLanguageServerRuntime,
      terminalGateway,
      workspaceRuntimeLifecycleGateway,
    ],
  );

  const stopBackgroundProjectRuntimes = useCallback(
    async (
      policy: BackgroundRuntimePolicy,
      activeRootPath: string | null,
      previousRootPath: string | null,
    ) => {
      if (policy === "keepAlive") {
        return;
      }

      const rootPaths =
        policy === "singleActive" || previousRootPath === null
          ? appSettingsRef.current.workspaceTabs.filter(
              (rootPath) => !workspaceRootKeysEqual(rootPath, activeRootPath),
            )
          : previousRootPath &&
              !workspaceRootKeysEqual(previousRootPath, activeRootPath)
            ? [previousRootPath]
            : [];

      await Promise.all(rootPaths.map((rootPath) => stopProjectRuntimes(rootPath)));
    },
    [stopProjectRuntimes],
  );

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
    setNavigationHistory(createNavigationHistory());
    setSidebarView("files");
    setBottomPanelView("problems");
    setBottomPanelVisible(false);
    resetWorkspaceTodos();
    setGitStatus(emptyGitStatus());
    setGitRepositoryStatuses([]);
    setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
    setGitLoading(false);
    setGitDiffLoading(false);
    selectedGitChangeRef.current = null;
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    setEditorGitBaselinesByPath({});
    setPhpTree(emptyPhpTree());
    setPhpTreeExpandedNodeIds(new Set());
    setPhpTreeLoading(false);
    setPhpFileOutlinesByPath({});
    setPhpInheritedFileOutlinesByPath({});
    setExpandedPhpFilePaths(new Set());
    setLoadingPhpFileOutlinePaths(new Set());
    setLoadingInheritedPhpFileOutlinePaths(new Set());
    setJavaScriptTypeScriptFileOutlinesByPath({});
    setLoadingJavaScriptTypeScriptFileOutlinePaths(new Set());
    setPhpFileOutlineExpandedNodeIds(new Set());
    setClassOpenOpen(false);
    setClassOpenQuery("");
    setClassOpenLoading(false);
    setClassOpenResults([]);
    setWorkspaceSymbolsOpen(false);
    setWorkspaceSymbolsQuery("");
    setWorkspaceSymbolsLoading(false);
    setWorkspaceSymbolsResults([]);
    setSearchEverywhereOpen(false);
    setSearchEverywhereQuery("");
    setSearchEverywhereLoading(false);
    setSearchEverywhereFiles([]);
    setSearchEverywhereSymbols([]);
    setQuickOpenOpen(false);
    setQuickOpenQuery("");
    setQuickOpenLoading(false);
    setQuickOpenResults([]);
    setRecentFilesSwitcherOpen(false);
    setRecentLocationsPanelOpen(false);
    setTextSearchOpen(false);
    setTextSearchQuery("");
    setTextSearchLoading(false);
    setTextSearchResults([]);
    setTextSearchOptions(defaultTextSearchOptions);
    setTextReplacement("");
    setTextReplaceBusy(false);
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
        setNavigationHistory(createNavigationHistory());
        setSidebarView("files");
        setBottomPanelView("problems");
        setBottomPanelVisible(false);
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
      setIndexProgress(initialIndexProgress());
      setIndexHealthLogs([]);
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      setGitStatus(emptyGitStatus(path));
      setGitRepositoryStatuses([]);
      setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
      setGitLoading(false);
      setGitDiffLoading(false);
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setEditorGitBaselinesByPath({});
      setPhpFileOutlinesByPath({});
      setPhpInheritedFileOutlinesByPath({});
      setJavaScriptTypeScriptFileOutlinesByPath({});
      setExpandedPhpFilePaths(new Set());
      setLoadingPhpFileOutlinePaths(new Set());
      setLoadingInheritedPhpFileOutlinePaths(new Set());
      setLoadingJavaScriptTypeScriptFileOutlinePaths(new Set());
      setPhpFileOutlineExpandedNodeIds(new Set());
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenLoading(false);
      setClassOpenResults([]);
      setWorkspaceSymbolsOpen(false);
      setWorkspaceSymbolsQuery("");
      setWorkspaceSymbolsLoading(false);
      setWorkspaceSymbolsResults([]);
      setSearchEverywhereOpen(false);
      setSearchEverywhereQuery("");
      setSearchEverywhereLoading(false);
      setSearchEverywhereFiles([]);
      setSearchEverywhereSymbols([]);
      setQuickOpenOpen(false);
      setQuickOpenQuery("");
      setQuickOpenLoading(false);
      setQuickOpenResults([]);
      setTextSearchOpen(false);
      setTextSearchQuery("");
      setTextSearchLoading(false);
      setTextSearchResults([]);
      setTextSearchOptions(defaultTextSearchOptions);
      setTextReplacement("");
      setTextReplaceBusy(false);
      setFileStructureScope("current");
      setImplementationChooser(null);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setMessage(null);
      setNotices([]);
      lastPhpFileOutlineRefreshKeyRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      phpClassSourcePathCacheRef.current = {};
      phpClassMemberCacheRef.current = {};
      phpFrameworkBindingCacheRef.current = {};
      phpLaravelMorphMapModelTypeCacheRef.current = {};
      invalidatePhpLaravelTargetCache();
      phpLaravelMigrationSourcesByRootRef.current = {};
      phpLaravelMigrationSourcesLoadInFlightRef.current = new Set();
      phpLaravelProviderSourcesByRootRef.current = {};
      phpLaravelProviderSourcesLoadInFlightRef.current = new Set();
      resetBladeIntelligenceCaches();
      setPhpIdeReadinessVersion(0);
      activeIndexRootRef.current = null;
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

      if (shouldIndexWorkspace(resolvedIntelligenceMode)) {
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

  const closeWorkspaceTab = useCallback(
    async (path: string) => {
      const currentSettings = appSettingsRef.current;
      const currentTabs = currentSettings.workspaceTabs;
      const tabPath = workspaceTabPathForPath(currentTabs, path) ?? path;
      const closingActiveWorkspace = workspaceRootKeysEqual(tabPath, workspaceRoot);
      const targetRootPath =
        closingActiveWorkspace && workspaceRoot ? workspaceRoot : tabPath;
      const nextTabs = workspaceTabsWithoutPath(currentTabs, path);
      const cachedWorkspaceState =
        workspaceStateCacheRef.current[tabPath] ??
        workspaceStateCacheRef.current[targetRootPath] ??
        null;

      if (nextTabs.length === currentTabs.length) {
        return;
      }

      if (
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, tabPath) ||
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, targetRootPath)
      ) {
        openWorkspaceRequestTokenRef.current += 1;
        openWorkspaceRequestPathRef.current = null;
      }

      if (!closingActiveWorkspace) {
        if (
          cachedWorkspaceState &&
          cachedWorkspaceHasDirtyDocuments(cachedWorkspaceState) &&
          !prompter.confirm("Close workspace and discard unsaved changes?")
        ) {
          return;
        }

        const nextRecentPath =
          workspaceRootKeysEqual(currentSettings.recentWorkspacePath, tabPath)
            ? workspaceRoot ?? nextTabs[nextTabs.length - 1] ?? null
            : currentSettings.recentWorkspacePath;

        delete workspaceStateCacheRef.current[tabPath];
        delete workspaceStateCacheRef.current[targetRootPath];
        delete editorConfigCacheRef.current[tabPath];
        delete editorConfigCacheRef.current[targetRootPath];
        forgetLatencyTrackerForRoot(targetRootPath);
        forgetLanguageServerRuntimeStatuses(targetRootPath);
        await Promise.allSettled([
          closeSyncedLanguageServerDocumentsForRoot(targetRootPath),
          closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath),
        ]);
        await stopProjectRuntimes(targetRootPath);
        forgetLanguageServerRuntimeStatuses(targetRootPath);

        try {
          await persistAppSettings({
            ...currentSettings,
            recentWorkspacePath: nextRecentPath,
            workspaceTabs: nextTabs,
          });
        } catch (error) {
          reportError("Settings", error);
        }
        return;
      }

      if (
        dirtyCount > 0 &&
        !prompter.confirm("Close workspace and discard unsaved changes?")
      ) {
        return;
      }

      openFileRequestTokenRef.current += 1;
      gitDiffRequestTokenRef.current += 1;
      editorGitBaselineRequestTokenRef.current += 1;
      const currentIndex = workspaceTabIndexForPath(currentTabs, tabPath);
      const nextPath =
        nextTabs[Math.min(currentIndex, nextTabs.length - 1)] ??
        nextTabs[nextTabs.length - 1] ??
        null;

      delete workspaceStateCacheRef.current[tabPath];
      delete workspaceStateCacheRef.current[targetRootPath];
      delete editorConfigCacheRef.current[tabPath];
      delete editorConfigCacheRef.current[targetRootPath];
      forgetLatencyTrackerForRoot(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);
      await Promise.allSettled([
        closeSyncedLanguageServerDocumentsForRoot(targetRootPath),
        closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath),
      ]);
      await stopProjectRuntimes(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);

      try {
        await persistAppSettings({
          ...currentSettings,
          recentWorkspacePath: nextPath,
          workspaceTabs: nextTabs,
        });
      } catch (error) {
        reportError("Settings", error);
        return;
      }

      if (nextPath) {
        await openWorkspacePath(nextPath, { cachePreviousWorkspace: false });
        return;
      }

      await clearActiveWorkspace();
    },
    [
      clearActiveWorkspace,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      dirtyCount,
      forgetLanguageServerRuntimeStatuses,
      forgetLatencyTrackerForRoot,
      openWorkspacePath,
      persistAppSettings,
      prompter,
      reportError,
      stopProjectRuntimes,
      workspaceRoot,
    ],
  );

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

  const loadGitDiffDocument = useCallback(
    (path: string, gitChange: GitChangedFile) => {
      if (!workspaceRoot) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      gitDiffRequestTokenRef.current = requestToken;
      recordCurrentNavigationLocation();
      selectedGitChangeRef.current = gitChange;
      setSelectedGitChange(gitChange);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      setActivePath(path);

      void gitGateway
        .getDiff(requestedRoot, gitChange)
        .then((diff) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffPreview(diff);
          setMessage(`Diff ${gitChange.relativePath}`);
        })
        .catch((error) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffPreview(null);
          reportError("Git Diff", error);
        })
        .finally(() => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffLoading(false);
        });
    },
    [gitGateway, recordCurrentNavigationLocation, reportError, workspaceRoot],
  );

  const activateDocument = useCallback(
    (path: string) => {
      if (activePath === path) {
        return;
      }

      const gitChange = gitChangeForDiffDocumentPath(path, gitStatus.changes);

      if (gitChange) {
        loadGitDiffDocument(path, gitChange);
        return;
      }

      recordCurrentNavigationLocation();
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setActivePath(path);
      recordRecentFile({
        name: documentsRef.current[path]?.name ?? getFileName(path),
        path,
      });
    },
    [
      activePath,
      gitStatus.changes,
      loadGitDiffDocument,
      recordCurrentNavigationLocation,
      recordRecentFile,
    ],
  );

  const pinDocument = useCallback((path: string) => {
    setOpenPaths((current) => {
      if (current.includes(path)) {
        return current;
      }

      return [...current, path];
    });
    setPreviewPath((current) => (current === path ? null : current));
  }, []);

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

  const openFile = useCallback(
    async (entry: FileEntry, options: OpenFileOptions = {}) => {
      const requestToken = openFileRequestTokenRef.current + 1;
      openFileRequestTokenRef.current = requestToken;
      forgetExternallyRemovedDocumentPath(entry.path);
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const shouldRecordNavigation = options.recordNavigation !== false;
      const shouldPin = options.pin === true;
      const readTextFileForEmptyDocumentRefresh = async (
        targetPath: string,
      ): Promise<string | null> => {
        try {
          return await workspaceFiles.readTextFile(targetPath);
        } catch {
          return null;
        }
      };
      const belongsToInactiveWorkspaceTab = appSettingsRef.current.workspaceTabs.some(
        (tabPath) =>
          !workspaceRootKeysEqual(tabPath, requestedRoot) &&
          workspacePathBelongsToRoot(entry.path, tabPath),
      );

      if (belongsToInactiveWorkspaceTab) {
        return false;
      }

      const scheduleEmptyDocumentRefresh = (targetPath: string) => {
        const timeoutId = window.setTimeout(() => {
          emptyDocumentRefreshTimeoutsRef.current.delete(timeoutId);

          const refreshEmptyDocument = async () => {
            if (
              requestedRoot !== null &&
              !workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )
            ) {
              return;
            }

            const currentDocument = documentsRef.current[targetPath];

            if (
              !currentDocument ||
              currentDocument.content !== "" ||
              currentDocument.savedContent !== ""
            ) {
              return;
            }

            let refreshedContent = "";

            try {
              refreshedContent = await workspaceFiles.readTextFile(targetPath);
            } catch {
              return;
            }

            if (
              refreshedContent === "" ||
              (requestedRoot !== null &&
                !workspaceRootKeysEqual(
                  currentWorkspaceRootRef.current,
                  requestedRoot,
                ))
            ) {
              return;
            }

            const latestDocument = documentsRef.current[targetPath];

            if (
              !latestDocument ||
              latestDocument.content !== "" ||
              latestDocument.savedContent !== ""
            ) {
              return;
            }

            const refreshedDocument: EditorDocument = {
              ...latestDocument,
              content: refreshedContent,
              savedContent: refreshedContent,
            };

            documentsRef.current = {
              ...documentsRef.current,
              [targetPath]: refreshedDocument,
            };
            activeDocumentRef.current =
              activeDocumentRef.current?.path === targetPath
                ? refreshedDocument
                : activeDocumentRef.current;
            setDocuments((current) => {
              const currentDocument = current[targetPath];

              if (
                !currentDocument ||
                currentDocument.content !== "" ||
                currentDocument.savedContent !== ""
              ) {
                return current;
              }

              return {
                ...current,
                [targetPath]: {
                  ...currentDocument,
                  content: refreshedContent,
                  savedContent: refreshedContent,
                },
              };
            });
            refreshLocalPhpDiagnosticsForContent(
              refreshedDocument.path,
              refreshedDocument.content,
              refreshedDocument.language,
            );
          };

          void refreshEmptyDocument();
        }, 150);

        emptyDocumentRefreshTimeoutsRef.current.add(timeoutId);
      };

      const existingDocument =
        documentsRef.current[entry.path] ?? documents[entry.path];

      if (existingDocument) {
        const openedDocument = existingDocument;
        const hasEmptySavedContentWithoutUnsavedEdits =
          openedDocument.savedContent === "" && openedDocument.content === "";

        const refreshedContent = hasEmptySavedContentWithoutUnsavedEdits
          ? await readTextFileForEmptyDocumentRefresh(entry.path)
          : null;

        if (refreshedContent !== null) {
          const requestStillActive =
            openFileRequestTokenRef.current === requestToken &&
            (requestedRoot === null ||
              workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              ));

          if (!requestStillActive) {
            return false;
          }

          const stillEmptyAndUnedited =
            documentsRef.current[entry.path]?.savedContent === "" &&
            documentsRef.current[entry.path]?.content === "";

          if (refreshedContent !== "" && stillEmptyAndUnedited) {
            const refreshedDocument: EditorDocument = {
              ...documentsRef.current[entry.path],
              content: refreshedContent,
              savedContent: refreshedContent,
            };
            activeDocumentRef.current =
              activeDocumentRef.current?.path === entry.path
                ? refreshedDocument
                : activeDocumentRef.current;
            documentsRef.current = {
              ...documentsRef.current,
              [entry.path]: refreshedDocument,
            };
            setDocuments((current) => ({
              ...current,
              [entry.path]: {
                ...(current[entry.path] ?? refreshedDocument),
                content: refreshedContent,
                savedContent: refreshedContent,
              },
            }));
            refreshLocalPhpDiagnosticsForContent(
              refreshedDocument.path,
              refreshedDocument.content,
              refreshedDocument.language,
            );
          } else if (refreshedContent === "" && stillEmptyAndUnedited) {
            scheduleEmptyDocumentRefresh(entry.path);
          }
        }

        const documentToMakeReadOnly =
          documentsRef.current[entry.path] ?? documents[entry.path];

        if (options.readOnly === true && !documentToMakeReadOnly.readOnly) {
          const readOnlyDocument = {
            ...documentToMakeReadOnly,
            readOnly: true,
          };
          activeDocumentRef.current =
            activeDocumentRef.current?.path === entry.path
              ? readOnlyDocument
              : activeDocumentRef.current;
          documentsRef.current = {
            ...documentsRef.current,
            [entry.path]: readOnlyDocument,
          };
          setDocuments((current) => ({
            ...current,
            [entry.path]: {
              ...(current[entry.path] ?? readOnlyDocument),
              readOnly: true,
            },
          }));
        }

        if (shouldRecordNavigation && activePath !== entry.path) {
          recordCurrentNavigationLocation();
        }

        if (!shouldPin && !openPaths.includes(entry.path)) {
          setPreviewPath(entry.path);
        }

        if (shouldPin) {
          pinDocument(entry.path);
        }

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        const activatedDocument =
          documentsRef.current[entry.path] ?? documents[entry.path] ?? openedDocument;
        refreshLocalPhpDiagnosticsForContent(
          activatedDocument.path,
          activatedDocument.content,
          activatedDocument.language,
        );
        setActivePath(entry.path);
        recordRecentFile({ name: entry.name, path: entry.path });
        return true;
      }

      const clearOpeningFileForRequest = () => {
        if (openingFileFlagOwnerTokenRef.current !== requestToken) {
          return;
        }

        openingFileFlagOwnerTokenRef.current = null;
        setIsOpeningFile(false);
      };

      try {
        const prefetchedContent = filePrefetchCacheRef.current.get(
          requestedRoot,
          entry.path,
        );
        const hasUsablePrefetchedContent =
          prefetchedContent !== null && prefetchedContent !== "";

        if (!hasUsablePrefetchedContent) {
          openingFileFlagOwnerTokenRef.current = requestToken;
          setIsOpeningFile(true);
        }

        const content = hasUsablePrefetchedContent
          ? prefetchedContent
          : await workspaceFiles.readTextFile(entry.path);

        if (
          openFileRequestTokenRef.current !== requestToken ||
          (requestedRoot !== null &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot))
        ) {
          clearOpeningFileForRequest();
          return false;
        }

        // Compute the replacement from live refs (current state) AFTER the read
        // resolves so rapid back-to-back opens never act on a stale closure
        // capture. This keeps PhpStorm preview parity: the current unedited
        // preview is replaced rather than spawning or wrongly closing tabs.
        const replacement = cleanReplacementDocument(
          activeDocumentRef.current,
          documentsRef.current,
          openPathsRef.current,
          previewPathRef.current,
        );
        const replacedPath = replacement?.path ?? null;

        const document: EditorDocument = {
          path: entry.path,
          name: entry.name,
          content,
          savedContent: content,
          language: detectLanguage(entry.path),
          readOnly: options.readOnly === true ? true : undefined,
        };

        if (shouldRecordNavigation) {
          recordCurrentNavigationLocation();
        }

        if (replacement) {
          void syncClosedDocument(replacement);
          void syncClosedJavaScriptTypeScriptDocument(replacement);
        }

        const nextDocuments = {
          ...documentsRef.current,
          [entry.path]: document,
        };

        if (replacedPath) {
          delete nextDocuments[replacedPath];
        }

        const nextOpenPaths = (() => {
          if (shouldPin && !replacedPath) {
            return openPathsRef.current.includes(entry.path)
              ? openPathsRef.current
              : [...openPathsRef.current, entry.path];
          }

          if (shouldPin && replacedPath) {
            const mapped = openPathsRef.current.map((openPath) =>
              openPath === replacedPath ? entry.path : openPath,
            );
            return mapped.includes(entry.path) ? mapped : [...mapped, entry.path];
          }

          return openPathsRef.current.filter(
            (openPath) => openPath !== replacedPath,
          );
        })();
        const nextPreviewPath = shouldPin ? null : entry.path;

        documentsRef.current = nextDocuments;
        activeDocumentRef.current = document;
        openPathsRef.current = nextOpenPaths;
        previewPathRef.current = nextPreviewPath;
        refreshLocalPhpDiagnosticsForContent(
          document.path,
          document.content,
          document.language,
        );

        setDocuments((current) => {
          const next = { ...current, [entry.path]: document };

          if (replacedPath) {
            delete next[replacedPath];
          }

          return next;
        });
        setOpenPaths((current) => {
          if (shouldPin && !replacedPath) {
            return current.includes(entry.path)
              ? current
              : [...current, entry.path];
          }

          if (shouldPin && replacedPath) {
            const mapped = current.map((openPath) =>
              openPath === replacedPath ? entry.path : openPath,
            );
            return mapped.includes(entry.path) ? mapped : [...mapped, entry.path];
          }

          return current.filter((openPath) => openPath !== replacedPath);
        });
        setPreviewPath(nextPreviewPath);

        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setActivePath(entry.path);
        recordRecentFile({ name: entry.name, path: entry.path });
        setMessage(null);
        filePrefetchCacheRef.current.invalidate(entry.path);
        if (content === "") {
          scheduleEmptyDocumentRefresh(entry.path);
        }
        clearOpeningFileForRequest();
        return true;
      } catch (error) {
        if (
          openFileRequestTokenRef.current !== requestToken ||
          (requestedRoot !== null &&
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot))
        ) {
          clearOpeningFileForRequest();
          return false;
        }

        clearOpeningFileForRequest();

        if (requestedRoot) {
          reportErrorForActiveWorkspaceRoot(requestedRoot, "Open File", error);
        } else {
          reportError("Open File", error);
        }
        return false;
      }
    },
    [
      activePath,
      documents,
      forgetExternallyRemovedDocumentPath,
      openPaths,
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const prefetchFileContentNow = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind === "directory") {
        return;
      }

      if (!shouldPrefetchFileContent(entry.path)) {
        return;
      }

      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (documentsRef.current[entry.path]) {
        return;
      }

      if (filePrefetchCacheRef.current.has(requestedRoot, entry.path)) {
        return;
      }

      try {
        const content = await workspaceFiles.readTextFile(entry.path);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        if (documentsRef.current[entry.path]) {
          return;
        }

        if (!isPrefetchableContentSize(content)) {
          return;
        }

        filePrefetchCacheRef.current.set(requestedRoot, entry.path, content);
      } catch {
        // Prefetch is a best-effort optimization; ignore read failures so the
        // real open (with its own error handling) stays the source of truth.
      }
    },
    [workspaceFiles, workspaceRoot],
  );

  const prefetchFile = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "directory") {
        return;
      }

      if (!shouldPrefetchFileContent(entry.path)) {
        return;
      }

      const timers = filePrefetchTimersRef.current;

      if (timers.has(entry.path)) {
        return;
      }

      const timer = setTimeout(() => {
        timers.delete(entry.path);
        void prefetchFileContentNow(entry);
      }, FILE_PREFETCH_HOVER_DELAY_MS);

      timers.set(entry.path, timer);
    },
    [prefetchFileContentNow],
  );

  const cancelFilePrefetch = useCallback((entry: FileEntry) => {
    const timers = filePrefetchTimersRef.current;
    const timer = timers.get(entry.path);

    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    timers.delete(entry.path);
  }, []);

  const previewFile = useCallback(
    async (entry: FileEntry) => {
      await openFile(entry);
    },
    [openFile],
  );

  const openPinnedFile = useCallback(
    async (entry: FileEntry) => {
      return openFile(entry, { pin: true });
    },
    [openFile],
  );

  const clearGitDiffPreviewState = useCallback(() => {
    gitDiffRequestTokenRef.current += 1;
    setGitDiffLoading(false);
    selectedGitChangeRef.current = null;
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    setMessage(null);
  }, []);

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
        clearGitDiffPreviewState();
        const documentPath = gitDiffDocumentPath(selectedGitChange);
        const nextActivePath = nextActiveEditorPathAfterClose(
          documentPath,
          openPathsRef.current,
          previewPathRef.current,
        );
        const nextDocumentsRef = { ...documentsRef.current };
        delete nextDocumentsRef[documentPath];
        documentsRef.current = nextDocumentsRef;
        openPathsRef.current = openPathsRef.current.filter(
          (path) => path !== documentPath,
        );
        if (previewPathRef.current === documentPath) {
          previewPathRef.current = null;
        }
        setDocuments((current) => {
          const next = { ...current };
          delete next[documentPath];
          return next;
        });
        setOpenPaths((current) =>
          current.filter((path) => path !== documentPath),
        );
        setPreviewPath((current) =>
          current === documentPath ? null : current,
        );

        const nextGitChange = nextActivePath
          ? gitChangeForDiffDocumentPath(nextActivePath, status.changes)
          : null;

        if (nextActivePath && nextGitChange) {
          loadGitDiffDocument(nextActivePath, nextGitChange);
        } else {
          setActivePath((current) =>
            current === documentPath ? nextActivePath : current,
          );
        }
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
    clearGitDiffPreviewState,
    gitGateway,
    gitRepositoryMappings,
    loadGitDiffDocument,
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

  const previewGitChange = useCallback(
    async (change: GitChangedFile, options: OpenGitChangeOptions = {}) => {
      if (!workspaceRoot) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      const documentPath = gitDiffDocumentPath(change);
      const document = gitDiffDocument(change);
      gitDiffRequestTokenRef.current = requestToken;
      recordCurrentNavigationLocation();
      documentsRef.current = {
        ...documentsRef.current,
        [documentPath]: documentsRef.current[documentPath] ?? document,
      };
      activeDocumentRef.current = documentsRef.current[documentPath] ?? document;
      setDocuments((current) => ({
        ...current,
        [documentPath]: current[documentPath] ?? document,
      }));
      if (options.pin === true) {
        openPathsRef.current = openPathsRef.current.includes(documentPath)
          ? openPathsRef.current
          : [...openPathsRef.current, documentPath];
        previewPathRef.current =
          previewPathRef.current === documentPath ? null : previewPathRef.current;
        setOpenPaths((current) =>
          current.includes(documentPath) ? current : [...current, documentPath],
        );
        setPreviewPath((current) =>
          current === documentPath ? null : current,
        );
      } else {
        previewPathRef.current = documentPath;
        setPreviewPath(documentPath);
      }
      selectedGitChangeRef.current = change;
      setSelectedGitChange(change);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      setActivePath(documentPath);

      try {
        const diff = await gitGateway.getDiff(requestedRoot, change);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(diff);
        setMessage(`Diff ${change.relativePath}`);
      } catch (error) {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(null);
        reportError("Git Diff", error);
      } finally {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffLoading(false);
      }
    },
    [
      gitGateway,
      recordCurrentNavigationLocation,
      reportError,
      workspaceRoot,
    ],
  );

  const openGitChange = useCallback(
    async (change: GitChangedFile) => {
      await previewGitChange(change, { pin: true });
    },
    [previewGitChange],
  );

  const openReadOnlyDocument = useCallback(
    (document: EditorDocument, options: OpenReadOnlyDocumentOptions = {}) => {
      const nextDocument = {
        ...document,
        readOnly: true,
        savedContent: document.savedContent ?? document.content,
      };

      recordCurrentNavigationLocation();
      documentsRef.current = {
        ...documentsRef.current,
        [nextDocument.path]: nextDocument,
      };
      activeDocumentRef.current = nextDocument;

      if (options.pin === true) {
        openPathsRef.current = openPathsRef.current.includes(nextDocument.path)
          ? openPathsRef.current
          : [...openPathsRef.current, nextDocument.path];
        previewPathRef.current =
          previewPathRef.current === nextDocument.path
            ? null
            : previewPathRef.current;
        setOpenPaths((current) =>
          current.includes(nextDocument.path)
            ? current
            : [...current, nextDocument.path],
        );
        setPreviewPath((current) =>
          current === nextDocument.path ? null : current,
        );
      } else {
        previewPathRef.current = nextDocument.path;
        setPreviewPath(nextDocument.path);
      }

      setDocuments((current) => ({
        ...current,
        [nextDocument.path]: nextDocument,
      }));
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setGitDiffLoading(false);
      gitDiffRequestTokenRef.current += 1;
      setActivePath(nextDocument.path);
      setMessage(null);
    },
    [recordCurrentNavigationLocation],
  );

  const closeGitDiffPreview = useCallback(() => {
    clearGitDiffPreviewState();
    const documentPath = selectedGitChange
      ? gitDiffDocumentPath(selectedGitChange)
      : null;
    if (documentPath) {
      const nextActivePath = nextActiveEditorPathAfterClose(
        documentPath,
        openPaths,
        previewPath,
      );
      const nextDocumentsRef = { ...documentsRef.current };
      delete nextDocumentsRef[documentPath];
      documentsRef.current = nextDocumentsRef;
      openPathsRef.current = openPathsRef.current.filter(
        (path) => path !== documentPath,
      );
      if (previewPathRef.current === documentPath) {
        previewPathRef.current = null;
      }
      setDocuments((current) => {
        const next = { ...current };
        delete next[documentPath];
        return next;
      });
      setOpenPaths((current) => current.filter((path) => path !== documentPath));
      setPreviewPath((current) => (current === documentPath ? null : current));
      const nextGitChange = nextActivePath
        ? gitChangeForDiffDocumentPath(nextActivePath, gitStatus.changes)
        : null;

      if (nextActivePath && nextGitChange) {
        loadGitDiffDocument(nextActivePath, nextGitChange);
      } else {
        setActivePath((current) =>
          current === documentPath ? nextActivePath : current,
        );
      }
    }
  }, [
    clearGitDiffPreviewState,
    gitStatus.changes,
    loadGitDiffDocument,
    openPaths,
    previewPath,
    selectedGitChange,
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

  const loadJavaScriptTypeScriptFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot) {
        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      if (
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );
      setLoadingJavaScriptTypeScriptFileOutlinePaths((current) =>
        new Set(current).add(path),
      );

      try {
        const symbols =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols(
            requestedRoot,
            path,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: fileOutlineFromLanguageServerDocumentSymbols(
            requestedRoot,
            path,
            symbols,
          ),
        }));
        setMessage(null);
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("JavaScript/TypeScript File Structure", error);
      } finally {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setLoadingJavaScriptTypeScriptFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

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

    if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage("JavaScript/TypeScript service is starting. Try structure again in a moment.");
        return;
      }

      if (
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "documentSymbol",
        )
      ) {
        setMessage("JavaScript/TypeScript service does not provide file structure.");
        return;
      }

      setFileStructureScopeMode("current");
      setFileStructureOpen(true);

      if (
        !javaScriptTypeScriptFileOutlinesByPath[document.path] &&
        !loadingJavaScriptTypeScriptFileOutlinePaths.has(document.path)
      ) {
        void loadJavaScriptTypeScriptFileOutline(document.path);
      }

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
    javaScriptTypeScriptFileOutlinesByPath,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    loadJavaScriptTypeScriptFileOutline,
    loadPhpFileOutline,
    loadingJavaScriptTypeScriptFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    phpFileOutlinesByPath,
    setFileStructureScopeMode,
  ]);

  const applyWorkspaceEditToOpenDocuments = useCallback(
    (
      edit: LanguageServerWorkspaceEdit,
      rootPath: string,
      documentVersionsByUri: Record<string, number> = {},
    ): string[] => {
      const editedPaths = changedOpenDocumentPathsForWorkspaceEdit(
        edit,
        documentsRef.current,
        rootPath,
        documentVersionsByUri,
      );

      setDocuments((current) => {
        let changed = false;
        const next = { ...current };

        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          const path = pathFromLanguageServerUri(uri);

          if (!path) {
            continue;
          }

          if (!isSessionPathInWorkspace(rootPath, path)) {
            continue;
          }

          if (
            !isWorkspaceEditDocumentVersionCurrent(
              edit,
              rootPath,
              uri,
              documentVersionsByUri,
            )
          ) {
            continue;
          }

          const document = current[path];

          if (!document) {
            continue;
          }

          const nextContent = applyLanguageServerTextEdits(
            document.content,
            textEdits,
          );

          if (nextContent === document.content) {
            continue;
          }

          next[path] = {
            ...document,
            content: nextContent,
          };
          changed = true;
        }

        return changed ? next : current;
      });

      return editedPaths;
    },
    [],
  );

  const reconcileJavaScriptTypeScriptWorkspaceEditFileOperations = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const fileOperations = edit.fileOperations ?? [];

      if (fileOperations.length === 0) {
        return;
      }

      const documentsToClose = Object.values(documentsRef.current).filter(
        (document) =>
          reconciledPathForWorkspaceFileOperations(
            document.path,
            fileOperations,
          ) !== document.path,
      );

      await Promise.all(
        documentsToClose.map((document) =>
          isJavaScriptTypeScriptLanguageServerDocument(document)
            ? syncClosedJavaScriptTypeScriptDocument(document)
            : Promise.resolve(),
        ),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setDocuments((current) =>
        reconciledDocumentsForWorkspaceEditFileOperations(current, edit),
      );
      setOpenPaths((current) =>
        reconciledEditorPathsForWorkspaceFileOperations(current, fileOperations),
      );
      setPreviewPath((current) =>
        current
          ? reconciledPathForWorkspaceFileOperations(current, fileOperations)
          : current,
      );
      setActivePath((current) =>
        current
          ? reconciledActivePathForWorkspaceFileOperations(
              current,
              openPathsRef.current,
              previewPathRef.current,
              fileOperations,
            )
          : current,
      );
    },
    [syncClosedJavaScriptTypeScriptDocument],
  );

  const refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories =
    useCallback(
      async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
        const directories =
          directoryPathsForWorkspaceEditFileOperations(edit).filter((directory) =>
            isSessionPathInWorkspace(rootPath, directory),
          );

        for (const directory of directories) {
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
            return;
          }

          await refreshDirectory(directory);
        }
      },
      [refreshDirectory],
    );

  const reconcilePhpWorkspaceEditFileOperations = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const fileOperations = edit.fileOperations ?? [];

      if (fileOperations.length === 0) {
        return;
      }

      const documentsToClose = Object.values(documentsRef.current).filter(
        (document) =>
          isLanguageServerDocument(document) &&
          reconciledPathForWorkspaceFileOperations(
            document.path,
            fileOperations,
          ) !== document.path,
      );

      await Promise.all(
        documentsToClose.map((document) => syncClosedDocument(document)),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setDocuments((current) =>
        reconciledDocumentsForWorkspaceEditFileOperations(current, edit),
      );
      setOpenPaths((current) =>
        reconciledEditorPathsForWorkspaceFileOperations(current, fileOperations),
      );
      setPreviewPath((current) =>
        current
          ? reconciledPathForWorkspaceFileOperations(current, fileOperations)
          : current,
      );
      setActivePath((current) =>
        current
          ? reconciledActivePathForWorkspaceFileOperations(
              current,
              openPathsRef.current,
              previewPathRef.current,
              fileOperations,
            )
          : current,
      );
    },
    [syncClosedDocument],
  );

  const refreshPhpWorkspaceEditFileOperationDirectories = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const directories =
        directoryPathsForWorkspaceEditFileOperations(edit).filter((directory) =>
          isSessionPathInWorkspace(rootPath, directory),
        );

      for (const directory of directories) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        await refreshDirectory(directory);
      }
    },
    [refreshDirectory],
  );

  const applyJavaScriptTypeScriptLanguageServerWorkspaceEdit = useCallback(
    async (
      edit: LanguageServerWorkspaceEdit,
      context: { editedOpenPaths?: string[]; rootPath: string },
    ): Promise<void> => {
      const requestedRoot = context.rootPath;

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      const rootEdit = workspaceEditForRoot(edit, requestedRoot);
      const controllerEdit = workspaceEditWithoutPaths(
        rootEdit,
        context.editedOpenPaths ?? [],
      );
      const openDocumentPaths = Object.keys(documentsRef.current);
      applyWorkspaceEditToOpenDocuments(
        controllerEdit,
        requestedRoot,
        javaScriptTypeScriptDocumentVersionsByUriRef.current,
      );
      await workspaceFiles.applyWorkspaceEdit(
        requestedRoot,
        rootEdit,
        openDocumentPaths,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await reconcileJavaScriptTypeScriptWorkspaceEditFileOperations(
        rootEdit,
        requestedRoot,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories(
        rootEdit,
        requestedRoot,
      );
    },
    [
      applyWorkspaceEditToOpenDocuments,
      reconcileJavaScriptTypeScriptWorkspaceEditFileOperations,
      refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories,
      workspaceFiles,
    ],
  );

  const applyPhpLanguageServerWorkspaceEdit = useCallback(
    async (
      edit: LanguageServerWorkspaceEdit,
      context: { editedOpenPaths?: string[]; rootPath: string },
    ): Promise<void> => {
      const requestedRoot = context.rootPath;

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      const rootEdit = workspaceEditForRoot(edit, requestedRoot);
      const controllerEdit = workspaceEditWithoutPaths(
        rootEdit,
        context.editedOpenPaths ?? [],
      );
      const openDocumentPaths = Object.keys(documentsRef.current);
      applyWorkspaceEditToOpenDocuments(
        controllerEdit,
        requestedRoot,
        documentVersionsByUriRef.current,
      );
      await workspaceFiles.applyWorkspaceEdit(
        requestedRoot,
        rootEdit,
        openDocumentPaths,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await reconcilePhpWorkspaceEditFileOperations(rootEdit, requestedRoot);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await refreshPhpWorkspaceEditFileOperationDirectories(
        rootEdit,
        requestedRoot,
      );
    },
    [
      applyWorkspaceEditToOpenDocuments,
      reconcilePhpWorkspaceEditFileOperations,
      refreshPhpWorkspaceEditFileOperationDirectories,
      workspaceFiles,
    ],
  );

  const applyJavaScriptTypeScriptRenameEdits = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles(
            requestedRoot,
            oldPath,
            newPath,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (!edit) {
          return true;
        }

        const rootEdit = workspaceEditForRoot(edit, requestedRoot);
        const openDocumentPaths = Object.keys(documentsRef.current);
        const changedClosedFiles = await workspaceFiles.applyWorkspaceEdit(
          requestedRoot,
          rootEdit,
          openDocumentPaths,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        const editedOpenPaths = applyWorkspaceEditToOpenDocuments(
          rootEdit,
          requestedRoot,
          javaScriptTypeScriptDocumentVersionsByUriRef.current,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        const changedFiles = changedClosedFiles + editedOpenPaths.length;

        if (changedFiles > 0) {
          setMessage(`Updated ${changedFiles} import path${changedFiles === 1 ? "" : "s"}.`);
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Rename", error);
        return false;
      }
    },
    [
      applyWorkspaceEditToOpenDocuments,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const applyJavaScriptTypeScriptCreateEdits = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willCreateFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles(
            requestedRoot,
            path,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (edit) {
          await applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
            rootPath: requestedRoot,
          });
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Create", error);
        return false;
      }
    },
    [
      applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileCreated = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      try {
        if (
          canUseLanguageServerFeature(
            javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
            "didCreateFiles",
          )
        ) {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles(
            requestedRoot,
            path,
          );
        } else {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
            requestedRoot,
            [
              {
                changeType: "created",
                path,
              },
            ],
          );
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Create", error);
      }
    },
    [
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const applyJavaScriptTypeScriptDeleteEdits = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willDeleteFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles(
            requestedRoot,
            path,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (edit) {
          await applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
            rootPath: requestedRoot,
          });
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Delete", error);
        return false;
      }
    },
    [
      applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileDeleted = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      try {
        if (
          canUseLanguageServerFeature(
            javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
            "didDeleteFiles",
          )
        ) {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles(
            requestedRoot,
            path,
          );
        } else {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
            requestedRoot,
            [
              {
                changeType: "deleted",
                path,
              },
            ],
          );
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Delete", error);
      }
    },
    [
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const applyPhpRenameEdits = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !workspaceDescriptor?.php ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const isRequestedPhpSessionActive = () =>
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

      try {
        const edit = await languageServerFeaturesGateway.willRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (!isRequestedPhpSessionActive()) {
          return;
        }

        if (!edit) {
          return;
        }

        const rootEdit = workspaceEditForRoot(edit, requestedRoot);
        const openDocumentPaths = Object.keys(documentsRef.current);
        const editedOpenPaths = applyWorkspaceEditToOpenDocuments(
          rootEdit,
          requestedRoot,
          documentVersionsByUriRef.current,
        );
        const changedClosedFiles = await workspaceFiles.applyWorkspaceEdit(
          requestedRoot,
          rootEdit,
          openDocumentPaths,
        );

        if (!isRequestedPhpSessionActive()) {
          return;
        }

        const changedFiles = changedClosedFiles + editedOpenPaths.length;

        if (changedFiles > 0) {
          setMessage(
            `Updated ${changedFiles} PHP rename reference${changedFiles === 1 ? "" : "s"}.`,
          );
        }
      } catch (error) {
        if (!isRequestedPhpSessionActive()) {
          return;
        }

        reportError("PHP Rename", error);
      }
    },
    [
      applyWorkspaceEditToOpenDocuments,
      isLanguageServerSessionActiveForRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      workspaceDescriptor?.php,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "didRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Rename", error);
      }
    },
    [
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyPhpFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !workspaceDescriptor?.php ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "didRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const isRequestedPhpSessionActive = () =>
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      try {
        await languageServerFeaturesGateway.didRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }
      } catch (error) {
        if (!isRequestedPhpSessionActive()) {
          return;
        }

        reportError("PHP Rename", error);
      }
    },
    [
      isLanguageServerSessionActiveForRoot,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      workspaceDescriptor?.php,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptWatchedFilesChanged = useCallback(
    async (changes: LanguageServerWorkspaceFileChange[]) => {
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

      const relevantChanges = changes.filter((change) =>
        isJavaScriptTypeScriptWatchedPath(change.path),
      );

      if (relevantChanges.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
          requestedRoot,
          relevantChanges,
        );
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

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

  // Records a Local History snapshot for a saved document, scoped to the
  // workspace root captured by the caller. Best-effort: a snapshot failure must
  // never surface as a save error, so it is swallowed (logged) rather than
  // thrown. The absolute path is converted to a workspace-relative path so the
  // snapshot lands in the requested workspace's bucket only.
  const captureLocalHistorySnapshot = useCallback(
    async (
      requestedRoot: string,
      absolutePath: string,
      content: string,
    ): Promise<void> => {
      const relativePath = workspaceRelativePath(requestedRoot, absolutePath);

      if (!relativePath) {
        return;
      }

      try {
        await localHistoryGateway.recordSnapshot(
          requestedRoot,
          relativePath,
          content,
        );
      } catch (error) {
        console.error("Local History snapshot failed", error);
      }
    },
    [localHistoryGateway],
  );

  const saveActiveDocument = useCallback(async () => {
    const documentToFormat = activeDocumentRef.current;
    if (!documentToFormat || documentToFormat.readOnly) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    try {
      const formattedContent = await formattedContentForSave(
        documentToFormat,
        requestedRoot,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      // Optimize imports AFTER formatting and AFTER the root re-check, on the
      // formatted content, so the two save-time fixers compose (format then
      // organize imports) and never act on a stale or cross-tab document. PHP
      // uses a synchronous reorganizer; this is a no-op for any other language.
      const phpOptimizedContent = optimizedImportsContentForSave(
        documentToFormat,
        formattedContent,
      );

      // JavaScript/TypeScript organize-imports goes through the language server
      // (`source.organizeImports`). It is async, so it is given the upfront
      // requested root (which it uses for every LSP call and re-checks after its
      // await), and the workspace root is re-checked again here before writing.
      // It is a no-op for non-JS/TS documents.
      const contentToSave = await organizedImportsContentForSave(
        documentToFormat,
        phpOptimizedContent,
        requestedRoot,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      // EditorConfig on-save transforms (trim trailing whitespace, insert final
      // newline, normalize EOL) run LAST so they compose over the formatted +
      // import-organized content, mirroring VS Code / PhpStorm. Resolved per the
      // saved document's own path through the per-workspace cascade. A no-op when
      // no `.editorconfig` enables any on-save behaviour.
      const editorConfigForSave = await resolveEditorConfigForFile(
        requestedRoot,
        documentToFormat.path,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const editorConfiguredContent = applyEditorConfigOnSave(
        contentToSave,
        editorConfigForSave,
      );

      const documentToSave: EditorDocument = {
        ...documentToFormat,
        content: editorConfiguredContent,
      };

      await workspaceFiles.writeTextFile(
        documentToSave.path,
        documentToSave.content,
      );
      filePrefetchCacheRef.current.invalidate(documentToSave.path);
      // Capture a Local History snapshot of the just-saved content, scoped to
      // the workspace root that was active when the save began. The gateway
      // dedupes identical content and the storage is per-workspace, so this is
      // a no-op when nothing changed and never leaks across tabs.
      void captureLocalHistorySnapshot(
        requestedRoot,
        documentToSave.path,
        documentToSave.content,
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setDocuments((current) => {
        const existing = current[documentToSave.path];

        if (!existing) {
          return current;
        }

        return {
          ...current,
          [documentToSave.path]: {
            ...existing,
            content: documentToSave.content,
            savedContent: documentToSave.content,
          },
        };
      });
      await syncSavedDocument(documentToSave);
      await syncSavedJavaScriptTypeScriptDocument(documentToSave);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Saved ${documentToSave.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", error);
    }
  }, [
    captureLocalHistorySnapshot,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    reportErrorForActiveWorkspaceRoot,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceSettings.autoSave) {
      return;
    }

    if (!activeDocument || activeDocument.readOnly || !isDirty(activeDocument)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveDocument();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeDocument, saveActiveDocument, workspaceSettings.autoSave]);

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

  const closeDocument = useCallback(
    (path: string) => {
      const document = documents[path];
      const externallyRemovedRoot =
        externallyRemovedDocumentRootByPathRef.current[path];

      if (
        document &&
        isDirty(document) &&
        !prompter.confirm("Discard changes?")
      ) {
        return;
      }

      if (document) {
        void syncClosedDocument(document);
        void syncClosedJavaScriptTypeScriptDocument(document);
        clearPhpLocalDiagnosticsForPath(path);
      }

      if (externallyRemovedRoot) {
        clearLanguageServerDiagnosticsForPath(externallyRemovedRoot, path);
      }

      if (isGitDiffDocumentPath(path)) {
        gitDiffRequestTokenRef.current += 1;
        setGitDiffLoading(false);
        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setMessage(null);
      }

      const nextActivePath =
        activePath === path
          ? nextActiveEditorPathAfterClose(path, openPaths, previewPath)
          : null;
      const nextGitChange = nextActivePath
        ? gitChangeForDiffDocumentPath(nextActivePath, gitStatus.changes)
        : null;

      setDocuments((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setPreviewPath((current) => (current === path ? null : current));
      setOpenPaths((current) => current.filter((item) => item !== path));

      if (activePath === path) {
        if (nextActivePath && nextGitChange) {
          loadGitDiffDocument(nextActivePath, nextGitChange);
        } else {
          setActivePath(nextActivePath);
        }
      }
    },
    [
      activePath,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      documents,
      gitStatus.changes,
      loadGitDiffDocument,
      openPaths,
      previewPath,
      prompter,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const closeApplicationWindow = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentWindow()
      .close()
      .catch((error) => reportError("Window", error));
  }, [reportError]);

  const quitApplication = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void invoke("quit_application").catch((error) =>
      reportError("Application", error),
    );
  }, [reportError]);

  const closeActiveSurface = useCallback(() => {
    if (selectedGitChange || gitDiffLoading) {
      closeGitDiffPreview();
      return;
    }

    if (activeDocument) {
      closeDocument(activeDocument.path);
      return;
    }

    closeApplicationWindow();
  }, [
    activeDocument,
    closeApplicationWindow,
    closeDocument,
    closeGitDiffPreview,
    gitDiffLoading,
    selectedGitChange,
  ]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    let unlisten: TauriUnlistenFn | null = null;

    listen(CLOSE_ACTIVE_TAB_EVENT, () => {
      closeActiveSurface();
    })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch((error) => reportError("Shortcuts", error));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [closeActiveSurface, reportError]);

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

  const createFile = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New file path", "src/NewFile.php");

    if (!relativePath) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const path = joinWorkspacePath(requestedRoot, relativePath);

    try {
      const mayCreate = await applyJavaScriptTypeScriptCreateEdits(path);
      if (!mayCreate) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await workspaceFiles.createTextFile(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await notifyJavaScriptTypeScriptFileCreated(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Create File", error);
    }
  }, [
    applyJavaScriptTypeScriptCreateEdits,
    openFile,
    notifyJavaScriptTypeScriptFileCreated,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    workspaceFiles,
    workspaceRoot,
  ]);

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

  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: result.name,
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setQuickOpenOpen(false);
    },
    [openFile],
  );

  const openRecentFile = useCallback(
    async (entry: RecentFileEntry) => {
      // Capture the requested root up front so a workspace switch during the
      // open cannot make us prune another tab's MRU after the await resolves.
      const requestedRoot = currentWorkspaceRootRef.current;
      const opened = await openFile({
        kind: "file",
        name: entry.name,
        path: entry.path,
      });

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (!opened) {
        // The file vanished out from under the MRU (deleted/moved outside the
        // editor). Prune the dead entry so it stops being offered.
        forgetRecentFile(entry.path);
        return;
      }

      setRecentFilesSwitcherOpen(false);
    },
    [forgetRecentFile, openFile],
  );

  const openClassSearchResult = useCallback(
    async (result: ProjectSymbolSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setClassOpenOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: editorPositionFromProjectSymbol(result),
      });
      setMessage(
        `Opened ${result.name} ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  const openWorkspaceSymbolResult = useCallback(
    async (result: ProjectSymbolSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setWorkspaceSymbolsOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: editorPositionFromProjectSymbol(result),
      });
      setMessage(
        `Opened ${result.name} ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  const openTextSearchResult = useCallback(
    async (result: TextSearchResult) => {
      const opened = await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setTextSearchOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: {
          column: Math.max(1, Number(result.column)),
          lineNumber: Math.max(1, Number(result.lineNumber)),
        },
      });
      setMessage(
        `Opened ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  // Re-reads the given files from disk and refreshes any matching open tabs so
  // the editor shows the post-replace content. Tabs with UNSAVED edits are left
  // untouched (we never clobber the user's in-flight work); the next save will
  // win. `isRequestedRootActive` is re-checked after every await so a stale
  // replace cannot mutate documents that belong to a different workspace tab.
  const refreshOpenDocumentsAfterReplace = useCallback(
    async (
      changedPaths: string[],
      isRequestedRootActive: () => boolean,
    ): Promise<void> => {
      for (const path of changedPaths) {
        if (!isRequestedRootActive()) {
          return;
        }

        const openDocument = documentsRef.current[path];

        if (!openDocument) {
          continue;
        }

        const hasUnsavedEdits = openDocument.content !== openDocument.savedContent;

        if (hasUnsavedEdits) {
          continue;
        }

        let refreshedContent: string;

        try {
          refreshedContent = await workspaceFiles.readTextFile(path);
        } catch {
          continue;
        }

        if (!isRequestedRootActive()) {
          return;
        }

        const latestDocument = documentsRef.current[path];

        // Re-check after the await: the tab may have been edited, closed, or
        // replaced by an unsaved version while we were reading from disk.
        if (
          !latestDocument ||
          latestDocument.content !== latestDocument.savedContent
        ) {
          continue;
        }

        const refreshedDocument: EditorDocument = {
          ...latestDocument,
          content: refreshedContent,
          savedContent: refreshedContent,
        };

        documentsRef.current = {
          ...documentsRef.current,
          [path]: refreshedDocument,
        };
        activeDocumentRef.current =
          activeDocumentRef.current?.path === path
            ? refreshedDocument
            : activeDocumentRef.current;
        setDocuments((current) => {
          const currentDocument = current[path];

          if (
            !currentDocument ||
            currentDocument.content !== currentDocument.savedContent
          ) {
            return current;
          }

          return {
            ...current,
            [path]: {
              ...currentDocument,
              content: refreshedContent,
              savedContent: refreshedContent,
            },
          };
        });
      }
    },
    [workspaceFiles],
  );

  // Shared Replace-in-Path runner. `scopePath === null` means Replace All (every
  // matching file); a non-null path narrows the run to a single file (the
  // backend still confines edits to its exact matches). Destructive (it rewrites
  // files on disk), so it always confirms first and reports the outcome.
  const runReplaceInPath = useCallback(
    async (scopePath: string | null): Promise<void> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      const query = textSearchQuery.trim();

      if (!requestedRoot || !query || textReplaceBusy) {
        return;
      }

      // Preview the blast radius BEFORE the destructive write: count the
      // matching files/occurrences (within scope) so the confirmation is honest.
      const previewResults = textSearchResults.filter(
        (result) => scopePath === null || result.path === scopePath,
      );
      const fileCount = new Set(previewResults.map((result) => result.path))
        .size;
      const matchCount = previewResults.length;

      if (matchCount === 0) {
        setMessage("No matches to replace");
        return;
      }

      // The results list is capped at TEXT_SEARCH_RESULT_LIMIT; when it is full
      // the real blast radius may be larger than what we can preview, so the
      // confirmation says "at least N" rather than implying an exact count.
      const isCapped =
        scopePath === null &&
        textSearchResults.length >= TEXT_SEARCH_RESULT_LIMIT;
      const atLeast = isCapped ? "at least " : "";
      const scopeLabel =
        scopePath === null
          ? `${atLeast}${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${atLeast}${fileCount} file${fileCount === 1 ? "" : "s"}`
          : `${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${getFileName(scopePath)}`;

      if (
        !prompter.confirm(
          `Replace ${scopeLabel}? This rewrites files on disk and cannot be undone.`,
        )
      ) {
        return;
      }

      if (!isRequestedRootActive()) {
        return;
      }

      setTextReplaceBusy(true);

      try {
        // Single-file scope is passed out-of-band as an exact path (not as an
        // extra include glob), so an active user file mask can never widen a
        // "Replace in file" run into other files. `scopePath === null` means
        // Replace All.
        const result: ReplaceInPathResult = await textSearch.replaceInPath(
          requestedRoot,
          query,
          textReplacement,
          textSearchOptions,
          scopePath ?? undefined,
        );

        if (!isRequestedRootActive()) {
          return;
        }

        await refreshOpenDocumentsAfterReplace(
          result.files.map((file) => file.path),
          isRequestedRootActive,
        );

        if (!isRequestedRootActive()) {
          return;
        }

        setMessage(
          result.totalReplacements === 0
            ? "No replacements made"
            : `Replaced ${result.totalReplacements} occurrence${result.totalReplacements === 1 ? "" : "s"} in ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
        );
        // Re-run the search so the results list matches what is now on disk.
        setTextSearchRefreshToken((token) => token + 1);
      } catch (error) {
        if (!isRequestedRootActive()) {
          return;
        }

        reportError("Replace in Path", error);
      } finally {
        if (isRequestedRootActive()) {
          setTextReplaceBusy(false);
        }
      }
    },
    [
      prompter,
      refreshOpenDocumentsAfterReplace,
      reportError,
      textReplaceBusy,
      textReplacement,
      textSearch,
      textSearchOptions,
      textSearchQuery,
      textSearchResults,
      workspaceRoot,
    ],
  );

  const replaceAllInPath = useCallback(
    () => runReplaceInPath(null),
    [runReplaceInPath],
  );

  const replaceInFile = useCallback(
    (path: string) => runReplaceInPath(path),
    [runReplaceInPath],
  );

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

  const openPathForNavigation = useCallback(
    async (
      path: string,
      options: OpenNavigationOptions = {},
    ): Promise<boolean> => {
      const opened = await openFile(
        {
          kind: "file",
          name: getFileName(path),
          path,
        },
        { readOnly: options.readOnly, recordNavigation: false },
      );

      if (!opened) {
        return false;
      }

      return true;
    },
    [openFile],
  );

  const openNavigationTarget = useCallback(
    async (
      path: string,
      position: EditorPosition,
      label: string,
      options: OpenNavigationOptions = {},
    ): Promise<boolean> => {
      const previousLocation = currentNavigationLocation();

      const opened = await openPathForNavigation(path, options);

      if (!opened) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      setEditorRevealTarget({
        path,
        position,
      });
      setMessage(
        `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
      );
      return true;
    },
    [
      currentNavigationLocation,
      openPathForNavigation,
      recordNavigationLocationSnapshot,
    ],
  );

  const openProblemNotice = useCallback(
    async (notice: WorkbenchNotice) => {
      const target = notice.navigationTarget;

      if (!target) {
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.range.start,
        "problem",
      );
    },
    [openNavigationTarget],
  );

  const currentProblemLocation = useCallback((): ProblemLocation | null => {
    const path = activeDocumentRef.current?.path;

    if (!path) {
      return null;
    }

    const position = activeEditorPositionRef.current ?? {
      column: 1,
      lineNumber: 1,
    };

    return {
      path,
      position: { column: position.column, lineNumber: position.lineNumber },
    };
  }, []);

  const goToProblemLocation = useCallback(
    async (location: ProblemLocation | null): Promise<boolean> => {
      if (!location) {
        return false;
      }

      const opened = await openNavigationTarget(
        location.path,
        location.position,
        "problem",
      );

      if (opened) {
        activeEditorPositionRef.current = location.position;
      }

      return opened;
    },
    [openNavigationTarget],
  );

  const goToNextProblem = useCallback(async (): Promise<boolean> => {
    return goToProblemLocation(
      nextProblemLocation(noticesRef.current, currentProblemLocation()),
    );
  }, [currentProblemLocation, goToProblemLocation]);

  const goToPreviousProblem = useCallback(async (): Promise<boolean> => {
    return goToProblemLocation(
      previousProblemLocation(noticesRef.current, currentProblemLocation()),
    );
  }, [currentProblemLocation, goToProblemLocation]);

  const readNavigationFileContent = useCallback(
    async (path: string): Promise<string> => {
      const activeOpenDocument = activeDocumentRef.current;

      if (activeOpenDocument?.path === path) {
        return activeOpenDocument.content;
      }

      const openDocument = documentsRef.current[path];

      if (openDocument) {
        return openDocument.content;
      }

      return workspaceFiles.readTextFile(path);
    },
    [workspaceFiles],
  );

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

  const resolvePhpClassReference = useCallback(
    (source: string, className: string): string | null => {
      const classReference = className.trim();
      const normalizedClassName = classReference.replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      if (
        normalizedClassName.toLowerCase() === "self" ||
        normalizedClassName.toLowerCase() === "static"
      ) {
        return phpCurrentClassName(source);
      }

      if (normalizedClassName.toLowerCase() === "parent") {
        const parentClassName = phpExtendsClassName(source);
        return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
      }

      return resolvePhpClassName(source, classReference);
    },
    [],
  );

  const isKnownPhpNamespaceRootClassName = useCallback(
    (className: string): boolean => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!workspaceDescriptor?.php || !normalizedClassName.includes("\\")) {
        return false;
      }

      const namespaceRoots = [
        ...workspaceDescriptor.php.psr4Roots,
        ...workspaceDescriptor.php.packages.flatMap((composerPackage) =>
          composerPackage.psr4Roots,
        ),
      ];

      return namespaceRoots.some((root) => {
        const namespace = root.namespace.trim().replace(/^\\+/, "");

        return Boolean(namespace && normalizedClassName.startsWith(namespace));
      });
    },
    [workspaceDescriptor],
  );

  const resolvePhpSemanticTypeReference = useCallback(
    (source: string, typeName: string | null): string | null => {
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;

      if (!candidate) {
        return null;
      }

      return isKnownPhpNamespaceRootClassName(candidate)
        ? candidate
        : resolvePhpClassReference(source, candidate);
    },
    [isKnownPhpNamespaceRootClassName, resolvePhpClassReference],
  );

  const resolvePhpFrameworkReturnTypeReference = useCallback(
    (source: string, typeName: string | null): string | null => {
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;

      if (!candidate) {
        return null;
      }

      if (candidate.includes("\\")) {
        return typeName;
      }

      return resolvePhpSemanticTypeReference(source, candidate);
    },
    [resolvePhpSemanticTypeReference],
  );

  const resolvePhpDeclaredType = useCallback(
    (source: string, typeName: string | null): string | null => {
      const rawTypeName = typeName?.trim() ?? "";
      const isFullyQualified = rawTypeName.replace(/^\?/, "").startsWith("\\");
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;
      return candidate
        ? resolvePhpClassReference(source, isFullyQualified ? `\\${candidate}` : candidate)
        : null;
    },
    [resolvePhpClassReference],
  );

  const resolvePhpMethodDeclaredReturnType = useCallback(
    (
      source: string,
      typeName: string | null,
      lateStaticClassName: string,
      templateTypes: ReadonlyMap<string, string> = new Map(),
    ): string | null => {
      if (phpReturnTypeIncludesLateStatic(typeName)) {
        return lateStaticClassName || null;
      }

      const templateCandidate = typeName
        ? phpDeclaredTypeCandidate(typeName)
        : null;
      const templateType = templateCandidate
        ? templateTypes.get(templateCandidate.toLowerCase()) ?? null
        : null;

      if (templateType) {
        return templateType;
      }

      return resolvePhpDeclaredType(source, typeName);
    },
    [resolvePhpDeclaredType],
  );

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

  const resolvePhpFrameworkBoundConcrete = useCallback(
    async (className: string): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !activePhpFrameworkProviders.length ||
        !requestedRoot ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      const cacheKey = normalizedClassName.toLowerCase();

      if (
        Object.prototype.hasOwnProperty.call(
          phpFrameworkBindingCacheRef.current,
          cacheKey,
        )
      ) {
        return phpFrameworkBindingCacheRef.current[cacheKey] ?? null;
      }

      let concreteClassName: string | null = null;
      const shortName = shortPhpName(normalizedClassName);
      const results = await textSearch.searchText(
        requestedRoot,
        `${shortName}::class`,
        200,
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set<string>();

      for (const result of results) {
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

          for (const binding of phpFrameworkContainerBindingsFromSource(
            content,
            activePhpFrameworkProviders,
          )) {
            const abstractClassName = resolvePhpClassReference(
              content,
              binding.abstractClassName,
            );

            if (abstractClassName?.toLowerCase() !== cacheKey) {
              continue;
            }

            const resolvedConcreteClassName = resolvePhpClassReference(
              content,
              binding.concreteClassName,
            );

            if (resolvedConcreteClassName) {
              concreteClassName = resolvedConcreteClassName;
              break;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }

        if (concreteClassName) {
          break;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      if (concreteClassName) {
        phpFrameworkBindingCacheRef.current[cacheKey] = concreteClassName;
      }

      return concreteClassName;
    },
    [
      activePhpFrameworkProviders,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  // Probes a list of deterministic PSR-4 candidate paths and returns only those
  // that actually exist AND declare the requested class. This is the cheap,
  // instant alternative to the project-wide findPhpClassSourcePathsByFileName
  // fuzzy search: each probe is a single read against a known path. The caller
  // owns the requested-root capture; we re-check it after every await and bail
  // with [] the moment the active workspace changes, so a stale resolution can
  // never leak a path into another project tab.
  const verifyPhpClassCandidatePaths = useCallback(
    async (
      candidatePaths: string[],
      normalizedClassName: string,
      isRequestedRootActive: () => boolean,
    ): Promise<string[]> => {
      const normalizedLookup = normalizedClassName.toLowerCase();
      const verified: string[] = [];
      const visited = new Set<string>();

      for (const path of candidatePaths) {
        if (!isRequestedRootActive()) {
          return [];
        }

        if (visited.has(path)) {
          continue;
        }

        visited.add(path);

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return [];
          }

          if (
            phpCurrentClassName(content)?.toLowerCase() === normalizedLookup
          ) {
            verified.push(path);
          }
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }

          // Missing/unreadable candidate (the guessed path does not exist) -
          // skip it and keep probing the remaining candidates.
          continue;
        }
      }

      return verified;
    },
    [readNavigationFileContent],
  );

  const findPhpClassSourcePathsByFileName = useCallback(
    async (className: string): Promise<string[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const shortName = shortPhpName(normalizedClassName);
      const fileName = `${shortName}.php`;
      const results = await fileSearch.searchFiles(requestedRoot, fileName, 40);

      if (!isRequestedRootActive()) {
        return [];
      }

      const paths: string[] = [];

      for (const result of results) {
        if (!isRequestedRootActive()) {
          return [];
        }

        if (result.name.toLowerCase() !== fileName.toLowerCase()) {
          continue;
        }

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return [];
          }

          const sourceClassName = phpCurrentClassName(content);

          if (sourceClassName?.toLowerCase() !== normalizedClassName.toLowerCase()) {
            continue;
          }

          paths.push(result.path);
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      return paths;
    },
    [fileSearch, readNavigationFileContent, workspaceRoot],
  );

  const resolvePhpClassSourcePaths = useCallback(
    async (className: string): Promise<string[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const candidatePaths = phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        normalizedClassName,
      );
      const paths = new Set(candidatePaths);
      let hasIndexedPath = false;

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          shortPhpName(normalizedClassName),
          50,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedLookup = normalizedClassName.toLowerCase();

        for (const symbol of indexedSymbols) {
          if (!isRequestedRootActive()) {
            return [];
          }

          if (!isTypeProjectSymbol(symbol)) {
            continue;
          }

          if (symbol.fullyQualifiedName.toLowerCase() !== normalizedLookup) {
            continue;
          }

          hasIndexedPath = true;
          paths.add(symbol.path);
        }
      }

      // INSTANT PATH (Fleet parity, every mode incl. basic/light): the PSR-4
      // candidates above are deterministic guesses. Before paying for the
      // project-wide fuzzy file search, probe those candidates directly - a
      // candidate read is a single I/O against a known path (sub-ms), whereas
      // findPhpClassSourcePathsByFileName walks the whole workspace tree and
      // reads dozens of files (cold 5-10s on large repos). If a candidate
      // exists and declares the requested class, it is the authoritative
      // target and we skip the expensive fallback entirely. Skip when the index
      // already produced a verified path (hasIndexedPath) - that is just as
      // authoritative and avoids redundant reads.
      if (!hasIndexedPath && candidatePaths.length > 0) {
        if (!isRequestedRootActive()) {
          return [];
        }

        const verifiedCandidates = await verifyPhpClassCandidatePaths(
          candidatePaths,
          normalizedClassName,
          isRequestedRootActive,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        if (verifiedCandidates.length > 0) {
          // Authoritative resolution from a deterministic candidate - no
          // project-wide search needed. Return only the verified paths so
          // downstream readers do not have to skip non-existent guesses.
          return verifiedCandidates;
        }
      }

      if (paths.size === 0 || !hasIndexedPath) {
        if (!isRequestedRootActive()) {
          return [];
        }

        const cacheKey = normalizedClassName.toLowerCase();
        const cachedPaths = phpClassSourcePathCacheRef.current[cacheKey];
        const fallbackPaths =
          cachedPaths ??
          (await findPhpClassSourcePathsByFileName(
            normalizedClassName,
          ));

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!cachedPaths && fallbackPaths.length > 0) {
          phpClassSourcePathCacheRef.current[cacheKey] = fallbackPaths;
        }

        for (const path of fallbackPaths) {
          paths.add(path);
        }
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      return [...paths];
    },
    [
      findPhpClassSourcePathsByFileName,
      intelligenceMode,
      projectSymbolSearch,
      verifyPhpClassCandidatePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpTemplateTypesForGenericReferences = useCallback(
    async (
      source: string,
      targetClassName: string,
      genericReferences: ReturnType<typeof phpDocGenericInheritances>,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> => {
      const normalizedTargetClassName = targetClassName
        .trim()
        .replace(/^\\+/, "")
        .toLowerCase();

      if (!normalizedTargetClassName) {
        return new Map();
      }

      for (const genericReference of genericReferences) {
        const resolvedTargetClassName = resolvePhpClassReference(
          source,
          genericReference.className,
        );

        if (
          resolvedTargetClassName?.toLowerCase() !==
          normalizedTargetClassName
        ) {
          continue;
        }

        for (const path of await resolvePhpClassSourcePaths(
          resolvedTargetClassName,
        )) {
          try {
            const targetSource = await readNavigationFileContent(path);
            const templateNames = phpDocTemplateNames(targetSource);
            const templateTypes = new Map<string, string>();

            templateNames.forEach((templateName, index) => {
              const genericType = genericReference.genericTypes[index];
              const inheritedGenericType = genericType
                ? inheritedTemplateTypes.get(genericType.toLowerCase()) ?? null
                : null;
              const resolvedGenericType =
                inheritedGenericType ??
                (genericType ? resolvePhpClassReference(source, genericType) : null);

              if (resolvedGenericType) {
                templateTypes.set(
                  templateName.toLowerCase(),
                  resolvedGenericType,
                );
              }
            });

            if (templateTypes.size > 0) {
              return templateTypes;
            }
          } catch {
            continue;
          }
        }
      }

      return new Map();
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
    ],
  );

  const resolvePhpGenericTemplateTypesForInheritedClass = useCallback(
    async (
      source: string,
      inheritedClassName: string,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        inheritedClassName,
        phpDocGenericInheritances(source),
        inheritedTemplateTypes,
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  const resolvePhpGenericTemplateTypesForMixinClass = useCallback(
    async (
      source: string,
      mixinClassName: string,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        mixinClassName,
        phpDocGenericMixins(source),
        inheritedTemplateTypes,
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  // Synchronous, file-system-free read of the cached Laravel source registry
  // (migrations + service providers) for the *active* root only. The merged
  // `workspaceSources` feed both migration-derived model attributes and
  // provider-registered Builder macros through one context. Returning empty
  // sources when nothing is cached keeps the completion hot path fast and lets
  // model attributes / macros fall back until the background loads populate the
  // caches. The signature combines both sub-signatures so editing either source
  // kind busts the derived member cache.
  const currentPhpLaravelSourceContext = useCallback((): {
    signature: string;
    workspaceSources: readonly string[];
  } => {
    const root = currentWorkspaceRootRef.current;

    if (!root) {
      return { signature: "", workspaceSources: [] };
    }

    const migrationEntry = phpLaravelMigrationSourcesByRootRef.current[root];
    const providerEntry = phpLaravelProviderSourcesByRootRef.current[root];
    const migrationSources = migrationEntry?.sources ?? [];
    const providerSources = providerEntry?.sources ?? [];
    const signature = `m:${migrationEntry?.signature ?? ""}|p:${providerEntry?.signature ?? ""}`;

    if (providerSources.length === 0) {
      return { signature, workspaceSources: migrationSources };
    }

    if (migrationSources.length === 0) {
      return { signature, workspaceSources: providerSources };
    }

    return {
      signature,
      workspaceSources: [...migrationSources, ...providerSources],
    };
  }, []);

  const reclassifyPhpLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string): void => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const diagnosticsByPath = languageServerDiagnosticsByRootRef.current[rootKey];

      if (!diagnosticsByPath) {
        return;
      }

      const { workspaceSources } = currentPhpLaravelSourceContext();

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
    [activePhpFrameworkProviders, currentPhpLaravelSourceContext],
  );

  // Loads the active project's migration sources on a background turn so the
  // first completion is served immediately (without migrations) and subsequent
  // ones pick up the DB columns once the cache is warm. Per-workspace isolation:
  // the requested root is captured up front and re-checked after the await
  // before the cache is mutated, so a tab switch mid-load drops the result.
  const ensurePhpLaravelMigrationSourcesLoaded = useCallback(
    async (requestedRoot: string): Promise<void> => {
      if (!isLaravelFrameworkActive || !requestedRoot) {
        return;
      }

      if (
        phpLaravelMigrationSourcesByRootRef.current[requestedRoot] ||
        phpLaravelMigrationSourcesLoadInFlightRef.current.has(requestedRoot)
      ) {
        return;
      }

      phpLaravelMigrationSourcesLoadInFlightRef.current.add(requestedRoot);

      try {
        const sources = await loadPhpLaravelMigrationSources(
          requestedRoot,
          workspaceFiles,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        phpLaravelMigrationSourcesByRootRef.current[requestedRoot] = {
          signature: phpLaravelMigrationSourcesSignature(sources),
          sources,
        };
        reclassifyPhpLanguageServerDiagnosticsForRoot(requestedRoot);
      } catch {
        // Graceful: migrations unavailable -> keep the $fillable/$casts fallback.
      } finally {
        phpLaravelMigrationSourcesLoadInFlightRef.current.delete(requestedRoot);
      }
    },
    [
      isLaravelFrameworkActive,
      reclassifyPhpLanguageServerDiagnosticsForRoot,
      workspaceFiles,
    ],
  );

  // Drops the cached migration sources for `root` when a file under
  // database/migrations changes so the next completion reloads them. The cached
  // member entries keyed with the old signature simply stop matching once the
  // new sources load, so no manual member-cache reset is needed.
  const invalidatePhpLaravelMigrationSourcesForPath = useCallback(
    (root: string, path: string): void => {
      if (!isPhpLaravelMigrationPath(root, path)) {
        return;
      }

      delete phpLaravelMigrationSourcesByRootRef.current[root];
      phpLaravelMigrationSourcesLoadInFlightRef.current.delete(root);
    },
    [],
  );

  // Loads the active project's service-provider sources on a background turn,
  // mirroring the migration loader: the first completion is served without
  // provider macros and later ones pick up `Builder::macro` registrations once
  // the cache is warm. Per-workspace isolation: the requested root is captured
  // up front and re-checked after the await before the cache is mutated, so a
  // tab switch mid-load drops the result.
  const ensurePhpLaravelProviderSourcesLoaded = useCallback(
    async (requestedRoot: string): Promise<void> => {
      if (!isLaravelFrameworkActive || !requestedRoot) {
        return;
      }

      if (
        phpLaravelProviderSourcesByRootRef.current[requestedRoot] ||
        phpLaravelProviderSourcesLoadInFlightRef.current.has(requestedRoot)
      ) {
        return;
      }

      phpLaravelProviderSourcesLoadInFlightRef.current.add(requestedRoot);

      try {
        const sources = await loadPhpLaravelProviderSources(
          requestedRoot,
          workspaceFiles,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        phpLaravelProviderSourcesByRootRef.current[requestedRoot] = {
          signature: phpLaravelProviderSourcesSignature(sources),
          sources,
        };
        reclassifyPhpLanguageServerDiagnosticsForRoot(requestedRoot);
      } catch {
        // Graceful: providers unavailable -> no provider-defined macros surface.
      } finally {
        phpLaravelProviderSourcesLoadInFlightRef.current.delete(requestedRoot);
      }
    },
    [
      isLaravelFrameworkActive,
      reclassifyPhpLanguageServerDiagnosticsForRoot,
      workspaceFiles,
    ],
  );

  // Drops the cached provider sources for `root` when a file under app/Providers
  // changes so the next completion reloads them. Same cache-key invalidation as
  // migrations: the combined source signature changes once the new sources load,
  // so stale macro members stop matching without a manual member-cache reset.
  const invalidatePhpLaravelProviderSourcesForPath = useCallback(
    (root: string, path: string): void => {
      if (!isPhpLaravelProviderPath(root, path)) {
        return;
      }

      delete phpLaravelProviderSourcesByRootRef.current[root];
      phpLaravelProviderSourcesLoadInFlightRef.current.delete(root);
    },
    [],
  );

  const readPhpClassMembersFromPath = useCallback(
    async (
      path: string,
      className: string,
    ): Promise<PhpClassMemberReadResult> => {
      const content = await readNavigationFileContent(path);
      const sourceSignature = phpSourceSignature(content);
      const { signature: frameworkSourceSignature, workspaceSources } =
        currentPhpLaravelSourceContext();
      const cacheKey = phpClassMemberCacheKey(
        path,
        className,
        activePhpFrameworkProviderSignature,
        frameworkSourceSignature,
      );
      const cached = phpClassMemberCacheRef.current[cacheKey];

      if (cached?.sourceSignature === sourceSignature) {
        return {
          content,
          members: cached.members,
        };
      }

      const members = phpMethodCompletionsFromSource(content, className, {
        frameworkProviders: activePhpFrameworkProviders,
        frameworkSourceContext:
          workspaceSources.length > 0 ? { workspaceSources } : undefined,
      });
      phpClassMemberCacheRef.current[cacheKey] = {
        members,
        sourceSignature,
      };

      return {
        content,
        members,
      };
    },
    [
      activePhpFrameworkProviderSignature,
      activePhpFrameworkProviders,
      currentPhpLaravelSourceContext,
      readNavigationFileContent,
    ],
  );

  const collectPhpMethodsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberMethods = (
        methods: PhpMethodCompletion[],
        templateTypes: ReadonlyMap<string, string> = new Map(),
      ) => {
        for (const method of methods) {
          const key = `${method.kind ?? "method"}:${method.name.toLowerCase()}`;

          if (completions.has(key)) {
            continue;
          }

          completions.set(
            key,
            phpMethodCompletionWithTemplateReturnType(method, templateTypes),
          );
        }
      };
      const collectMethods = async (
        className: string,
        templateTypes: ReadonlyMap<string, string> = new Map(),
      ): Promise<void> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return;
        }

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          if (!isRequestedRootActive()) {
            return;
          }

          try {
            const { content, members } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );

            if (!isRequestedRootActive()) {
              return;
            }

            rememberMethods(members, templateTypes);

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                const traitTemplateTypes =
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedTraitName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(
                  resolvedTraitName,
                  traitTemplateTypes,
                );

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                const mixinTemplateTypes =
                  await resolvePhpGenericTemplateTypesForMixinClass(
                    content,
                    resolvedMixinName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(
                  resolvedMixinName,
                  mixinTemplateTypes,
                );

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassName(
                content,
                superTypeName,
              );

              if (resolvedSuperTypeName) {
                const superTypeTemplateTypes =
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedSuperTypeName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(
                  resolvedSuperTypeName,
                  superTypeTemplateTypes,
                );

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            return;
          } catch {
            if (!isRequestedRootActive()) {
              return;
            }

            continue;
          }
        }
      };

      await collectMethods(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      const boundConcreteClassName =
        await resolvePhpFrameworkBoundConcrete(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      if (boundConcreteClassName) {
        await collectMethods(boundConcreteClassName);

        if (!isRequestedRootActive()) {
          return [];
        }
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const collectPhpLaravelDynamicWhereMethodsForClass = useCallback(
    async (
      className: string,
      options: { isStatic?: boolean } = {},
    ): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return [];
        }

        try {
          const { content } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return [];
          }

          for (const method of phpLaravelDynamicWhereCompletionsFromSource(
            content,
            normalizedClassName,
            options,
          )) {
            if (!isRequestedRootActive()) {
              return [];
            }

            const key = method.name.toLowerCase();

            if (!completions.has(key)) {
              completions.set(key, method);
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassSourcePaths,
      isLaravelFrameworkActive,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const collectPhpLaravelRelationCompletionsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberRelations = (relations: PhpMethodCompletion[]) => {
        for (const relation of relations) {
          const key = relation.name.toLowerCase();

          if (completions.has(key)) {
            continue;
          }

          completions.set(key, {
            ...relation,
            kind: "relation",
          });
        }
      };
      const collectRelations = async (candidateClassName: string): Promise<void> => {
        const normalizedClassName = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return;
        }

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          if (!isRequestedRootActive()) {
            return;
          }

          try {
            const { content } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );

            if (!isRequestedRootActive()) {
              return;
            }

            rememberRelations(
              phpLaravelRelationPropertyCompletionsFromSource(
                content,
                normalizedClassName,
              ).map((relation) => ({
                ...relation,
                returnType:
                  phpLooksLikeQualifiedClassName(relation.returnType) ||
                  phpIsBuiltinDeclaredType(relation.returnType)
                    ? phpNormalizedDeclaredTypeName(relation.returnType)
                    : resolvePhpDeclaredType(content, relation.returnType) ??
                  relation.returnType,
              })),
            );

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                await collectRelations(resolvedTraitName);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                await collectRelations(resolvedMixinName);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassName(content, parentClassName)
              : null;

            if (resolvedParentClassName) {
              await collectRelations(resolvedParentClassName);

              if (!isRequestedRootActive()) {
                return;
              }
            }

            return;
          } catch {
            if (!isRequestedRootActive()) {
              return;
            }

            continue;
          }
        }
      };

      await collectRelations(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpDeclaredType,
      resolvePhpClassSourcePaths,
      isLaravelFrameworkActive,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const readWorkspaceDirectory = useCallback(
    (path: string) => workspaceFiles.readDirectory(path),
    [workspaceFiles],
  );

  const {
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelGateAbilityTargets,
    collectPhpLaravelMiddlewareAliasTargets,
    collectPhpLaravelEnvTargets,
    collectPhpLaravelViewTargets,
    collectPhpLaravelConfigTargets,
    collectPhpLaravelTranslationTargets,
    collectPhpLaravelAuthGuardTargets,
    collectPhpLaravelCacheStoreTargets,
    collectPhpLaravelDatabaseConnectionTargets,
    collectPhpLaravelBroadcastConnectionTargets,
    collectPhpLaravelQueueConnectionTargets,
    collectPhpLaravelRedisConnectionTargets,
    collectPhpLaravelMailMailerTargets,
    collectPhpLaravelPasswordBrokerTargets,
    collectPhpLaravelLogChannelTargets,
    collectPhpLaravelStorageDiskTargets,
    findPhpLaravelViewTarget,
    findPhpLaravelConfigTarget,
    findPhpLaravelTranslationTarget,
    findPhpLaravelAuthGuardTarget,
    findPhpLaravelCacheStoreTarget,
    findPhpLaravelDatabaseConnectionTarget,
    findPhpLaravelBroadcastConnectionTarget,
    findPhpLaravelQueueConnectionTarget,
    findPhpLaravelRedisConnectionTarget,
    findPhpLaravelMailMailerTarget,
    findPhpLaravelPasswordBrokerTarget,
    findPhpLaravelLogChannelTarget,
    findPhpLaravelStorageDiskTarget,
    invalidatePhpLaravelTargetCache,
  } = useLaravelTargets({
    currentWorkspaceRootRef,
    workspaceRoot,
    textSearch,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    activePhpFrameworkProviders,
    isLaravelFrameworkActive,
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

  const phpClassHasLaravelDynamicWhere = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const methodLookup = methodName.toLowerCase();
      const dynamicWhereCompletions =
        await collectPhpLaravelDynamicWhereMethodsForClass(className);

      return dynamicWhereCompletions.some(
        (method) => method.name.toLowerCase() === methodLookup,
      );
    },
    [collectPhpLaravelDynamicWhereMethodsForClass],
  );

  const phpClassHierarchyHasMethod = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedMethodName = methodName.trim();
      const methodLookup = normalizedMethodName.toLowerCase();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedMethodName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (
            phpMethodPositionOrNull(content, normalizedMethodName) ||
            members.some(
              (member) =>
                member.kind !== "property" &&
                !member.isStatic &&
                member.name.toLowerCase() === methodLookup,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasMethod(
                resolvedTraitName,
                normalizedMethodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasMethod(
                resolvedMixinName,
                normalizedMethodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasMethod(
                resolvedSuperTypeName,
                normalizedMethodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasStaticMethod = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedMethodName = methodName.trim().toLowerCase();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedMethodName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (
            members.some(
              (member) =>
                member.isStatic &&
                member.name.toLowerCase() === normalizedMethodName,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedTraitName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedMixinName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedSuperTypeName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasProperty = useCallback(
    async (
      className: string,
      propertyName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedPropertyName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          const propertyLookup = normalizedPropertyName.toLowerCase();

          if (
            phpClassSourceHasDeclaredProperty(content, normalizedPropertyName) ||
            members.some(
              (member) =>
                member.kind === "property" &&
                member.name.toLowerCase() === propertyLookup,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasProperty(
                resolvedTraitName,
                normalizedPropertyName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasProperty(
                resolvedMixinName,
                normalizedPropertyName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasProperty(
                resolvedSuperTypeName,
                normalizedPropertyName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasConstant = useCallback(
    async (
      className: string,
      constantName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedConstantName = constantName.trim();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedConstantName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (phpClassSourceHasDeclaredConstant(content, normalizedConstantName)) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasConstant(
                resolvedTraitName,
                normalizedConstantName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasConstant(
                resolvedMixinName,
                normalizedConstantName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasConstant(
                resolvedSuperTypeName,
                normalizedConstantName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHasLaravelLocalScope = useCallback(
    async (className: string, scopeName: string): Promise<boolean> => {
      if (!isLaravelFrameworkActive) {
        return false;
      }

      const scopeLookup = scopeName.toLowerCase();
      const scopeCompletions = phpLaravelLocalScopeCompletionsFromMethods(
        await collectPhpMethodsForClass(className),
      );

      return scopeCompletions.some(
        (scope) => scope.name.toLowerCase() === scopeLookup,
      );
    },
    [collectPhpMethodsForClass, isLaravelFrameworkActive],
  );

  const phpTraitHostMethodExists = useCallback(
    async (traitClassName: string, methodName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");
      const normalizedMethodName = methodName.trim();

      if (!normalizedTraitClassName || !normalizedMethodName) {
        return false;
      }

      const sourceUsesTrait = (
        source: string,
        targetTraitClassName: string,
      ): boolean => {
        const targetLookup = targetTraitClassName.toLowerCase();

        return phpTraitClassNames(source).some((traitName) => {
          const resolvedTraitName = resolvePhpClassReference(source, traitName);

          return resolvedTraitName?.toLowerCase() === targetLookup;
        });
      };
      const descendantClassHierarchyHasMethod = async (
        className: string,
        visitedClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const classLookup = normalizedClassName.toLowerCase();

        if (
          !normalizedClassName ||
          visitedClassNames.has(classLookup) ||
          visitedClassNames.size >= 200
        ) {
          return false;
        }

        visitedClassNames.add(classLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (phpCurrentTypeKind(content) !== "class") {
              continue;
            }

            const candidateClassName = phpCurrentClassName(content);
            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;

            if (
              !candidateClassName ||
              resolvedParentClassName?.toLowerCase() !== classLookup
            ) {
              continue;
            }

            if (
              (await phpClassHierarchyHasMethod(
                candidateClassName,
                normalizedMethodName,
              )) ||
              (await descendantClassHierarchyHasMethod(
                candidateClassName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };
      const traitConcreteUserHierarchyHasMethod = async (
        targetTraitClassName: string,
        visitedTraitClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedTargetTraitClassName = targetTraitClassName
          .trim()
          .replace(/^\\+/, "");
        const traitLookup = normalizedTargetTraitClassName.toLowerCase();

        if (
          !normalizedTargetTraitClassName ||
          visitedTraitClassNames.has(traitLookup) ||
          visitedTraitClassNames.size >= 200
        ) {
          return false;
        }

        visitedTraitClassNames.add(traitLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (!sourceUsesTrait(content, normalizedTargetTraitClassName)) {
              continue;
            }

            const userTypeKind = phpCurrentTypeKind(content);
            const userClassName = phpCurrentClassName(content);

            if (!userTypeKind || !userClassName) {
              continue;
            }

            if (userTypeKind === "trait") {
              if (
                await traitConcreteUserHierarchyHasMethod(
                  userClassName,
                  visitedTraitClassNames,
                )
              ) {
                return true;
              }

              if (!isRequestedRootActive()) {
                return false;
              }

              continue;
            }

            if (userTypeKind !== "class" && userTypeKind !== "enum") {
              continue;
            }

            if (
              (await phpClassHierarchyHasMethod(
                userClassName,
                normalizedMethodName,
              )) ||
              (userTypeKind === "class" &&
                (await descendantClassHierarchyHasMethod(
                  userClassName,
                  new Set<string>(),
                )))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };

      const exists =
        await traitConcreteUserHierarchyHasMethod(normalizedTraitClassName);

      if (!isRequestedRootActive()) {
        return false;
      }

      return exists;
    },
    [
      phpClassHierarchyHasMethod,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  const phpTraitHostPropertyExists = useCallback(
    async (traitClassName: string, propertyName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

      if (!normalizedTraitClassName || !normalizedPropertyName) {
        return false;
      }

      const sourceUsesTrait = (
        source: string,
        targetTraitClassName: string,
      ): boolean => {
        const targetLookup = targetTraitClassName.toLowerCase();

        return phpTraitClassNames(source).some((traitName) => {
          const resolvedTraitName = resolvePhpClassReference(source, traitName);

          return resolvedTraitName?.toLowerCase() === targetLookup;
        });
      };
      const descendantClassHierarchyHasProperty = async (
        className: string,
        visitedClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const classLookup = normalizedClassName.toLowerCase();

        if (
          !normalizedClassName ||
          visitedClassNames.has(classLookup) ||
          visitedClassNames.size >= 200
        ) {
          return false;
        }

        visitedClassNames.add(classLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (phpCurrentTypeKind(content) !== "class") {
              continue;
            }

            const candidateClassName = phpCurrentClassName(content);
            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;

            if (
              !candidateClassName ||
              resolvedParentClassName?.toLowerCase() !== classLookup
            ) {
              continue;
            }

            if (
              (await phpClassHierarchyHasProperty(
                candidateClassName,
                normalizedPropertyName,
              )) ||
              (await descendantClassHierarchyHasProperty(
                candidateClassName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };
      const traitConcreteUserHierarchyHasProperty = async (
        targetTraitClassName: string,
        visitedTraitClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedTargetTraitClassName = targetTraitClassName
          .trim()
          .replace(/^\\+/, "");
        const traitLookup = normalizedTargetTraitClassName.toLowerCase();

        if (
          !normalizedTargetTraitClassName ||
          visitedTraitClassNames.has(traitLookup) ||
          visitedTraitClassNames.size >= 200
        ) {
          return false;
        }

        visitedTraitClassNames.add(traitLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (!sourceUsesTrait(content, normalizedTargetTraitClassName)) {
              continue;
            }

            const userTypeKind = phpCurrentTypeKind(content);
            const userClassName = phpCurrentClassName(content);

            if (!userTypeKind || !userClassName) {
              continue;
            }

            if (userTypeKind === "trait") {
              if (
                await traitConcreteUserHierarchyHasProperty(
                  userClassName,
                  visitedTraitClassNames,
                )
              ) {
                return true;
              }

              if (!isRequestedRootActive()) {
                return false;
              }

              continue;
            }

            if (userTypeKind !== "class" && userTypeKind !== "enum") {
              continue;
            }

            if (
              (await phpClassHierarchyHasProperty(
                userClassName,
                normalizedPropertyName,
              )) ||
              (userTypeKind === "class" &&
                (await descendantClassHierarchyHasProperty(
                  userClassName,
                  new Set<string>(),
                )))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };

      const exists =
        await traitConcreteUserHierarchyHasProperty(normalizedTraitClassName);

      if (!isRequestedRootActive()) {
        return false;
      }

      return exists;
    },
    [
      phpClassHierarchyHasProperty,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  const phpTraitHostPropertyMethodExists = useCallback(
    async (
      traitClassName: string,
      propertyName: string,
      methodName: string,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");
      const normalizedMethodName = methodName.trim();

      if (
        !normalizedTraitClassName ||
        !normalizedPropertyName ||
        !normalizedMethodName
      ) {
        return false;
      }

      const sourceUsesTrait = (
        source: string,
        targetTraitClassName: string,
      ): boolean => {
        const targetLookup = targetTraitClassName.toLowerCase();

        return phpTraitClassNames(source).some((traitName) => {
          const resolvedTraitName = resolvePhpClassReference(source, traitName);

          return resolvedTraitName?.toLowerCase() === targetLookup;
        });
      };
      const classHierarchyPropertyHasMethod = async (
        className: string,
      ): Promise<boolean> => {
        const propertyType = await resolvePhpClassPropertyOrRelationTypeRef.current(
          className,
          normalizedPropertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        return propertyType
          ? phpClassHierarchyHasMethod(propertyType, normalizedMethodName)
          : false;
      };
      const descendantClassHierarchyHasPropertyMethod = async (
        className: string,
        visitedClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const classLookup = normalizedClassName.toLowerCase();

        if (
          !normalizedClassName ||
          visitedClassNames.has(classLookup) ||
          visitedClassNames.size >= 200
        ) {
          return false;
        }

        visitedClassNames.add(classLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (phpCurrentTypeKind(content) !== "class") {
              continue;
            }

            const candidateClassName = phpCurrentClassName(content);
            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;

            if (
              !candidateClassName ||
              resolvedParentClassName?.toLowerCase() !== classLookup
            ) {
              continue;
            }

            if (
              (await classHierarchyPropertyHasMethod(candidateClassName)) ||
              (await descendantClassHierarchyHasPropertyMethod(
                candidateClassName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };
      const traitConcreteUserHierarchyHasPropertyMethod = async (
        targetTraitClassName: string,
        visitedTraitClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedTargetTraitClassName = targetTraitClassName
          .trim()
          .replace(/^\\+/, "");
        const traitLookup = normalizedTargetTraitClassName.toLowerCase();

        if (
          !normalizedTargetTraitClassName ||
          visitedTraitClassNames.has(traitLookup) ||
          visitedTraitClassNames.size >= 200
        ) {
          return false;
        }

        visitedTraitClassNames.add(traitLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (!sourceUsesTrait(content, normalizedTargetTraitClassName)) {
              continue;
            }

            const userTypeKind = phpCurrentTypeKind(content);
            const userClassName = phpCurrentClassName(content);

            if (!userTypeKind || !userClassName) {
              continue;
            }

            if (userTypeKind === "trait") {
              if (
                await traitConcreteUserHierarchyHasPropertyMethod(
                  userClassName,
                  visitedTraitClassNames,
                )
              ) {
                return true;
              }

              if (!isRequestedRootActive()) {
                return false;
              }

              continue;
            }

            if (userTypeKind !== "class" && userTypeKind !== "enum") {
              continue;
            }

            if (
              (await classHierarchyPropertyHasMethod(userClassName)) ||
              (userTypeKind === "class" &&
                (await descendantClassHierarchyHasPropertyMethod(
                  userClassName,
                  new Set<string>(),
                )))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };

      const exists = await traitConcreteUserHierarchyHasPropertyMethod(
        normalizedTraitClassName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      return exists;
    },
    [
      phpClassHierarchyHasMethod,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  const phpTraitHostConstantExists = useCallback(
    async (traitClassName: string, constantName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");
      const normalizedConstantName = constantName.trim();

      if (!normalizedTraitClassName || !normalizedConstantName) {
        return false;
      }

      const sourceUsesTrait = (
        source: string,
        targetTraitClassName: string,
      ): boolean => {
        const targetLookup = targetTraitClassName.toLowerCase();

        return phpTraitClassNames(source).some((traitName) => {
          const resolvedTraitName = resolvePhpClassReference(source, traitName);

          return resolvedTraitName?.toLowerCase() === targetLookup;
        });
      };
      const descendantClassHierarchyHasConstant = async (
        className: string,
        visitedClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const classLookup = normalizedClassName.toLowerCase();

        if (
          !normalizedClassName ||
          visitedClassNames.has(classLookup) ||
          visitedClassNames.size >= 200
        ) {
          return false;
        }

        visitedClassNames.add(classLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (phpCurrentTypeKind(content) !== "class") {
              continue;
            }

            const candidateClassName = phpCurrentClassName(content);
            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;

            if (
              !candidateClassName ||
              resolvedParentClassName?.toLowerCase() !== classLookup
            ) {
              continue;
            }

            if (
              (await phpClassHierarchyHasConstant(
                candidateClassName,
                normalizedConstantName,
              )) ||
              (await descendantClassHierarchyHasConstant(
                candidateClassName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };
      const traitConcreteUserHierarchyHasConstant = async (
        targetTraitClassName: string,
        visitedTraitClassNames = new Set<string>(),
      ): Promise<boolean> => {
        const normalizedTargetTraitClassName = targetTraitClassName
          .trim()
          .replace(/^\\+/, "");
        const traitLookup = normalizedTargetTraitClassName.toLowerCase();

        if (
          !normalizedTargetTraitClassName ||
          visitedTraitClassNames.has(traitLookup) ||
          visitedTraitClassNames.size >= 200
        ) {
          return false;
        }

        visitedTraitClassNames.add(traitLookup);

        const results = await textSearch.searchText(
          requestedRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (!sourceUsesTrait(content, normalizedTargetTraitClassName)) {
              continue;
            }

            const userTypeKind = phpCurrentTypeKind(content);
            const userClassName = phpCurrentClassName(content);

            if (!userTypeKind || !userClassName) {
              continue;
            }

            if (userTypeKind === "trait") {
              if (
                await traitConcreteUserHierarchyHasConstant(
                  userClassName,
                  visitedTraitClassNames,
                )
              ) {
                return true;
              }

              if (!isRequestedRootActive()) {
                return false;
              }

              continue;
            }

            if (userTypeKind !== "class" && userTypeKind !== "enum") {
              continue;
            }

            if (
              (await phpClassHierarchyHasConstant(
                userClassName,
                normalizedConstantName,
              )) ||
              (userTypeKind === "class" &&
                (await descendantClassHierarchyHasConstant(
                  userClassName,
                  new Set<string>(),
                )))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return false;
      };

      const exists =
        await traitConcreteUserHierarchyHasConstant(normalizedTraitClassName);

      if (!isRequestedRootActive()) {
        return false;
      }

      return exists;
    },
    [
      phpClassHierarchyHasConstant,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  const filterPhpDiagnosticsWithContext = useCallback(
    async (
      path: string,
      diagnostics: LanguageServerDiagnostic[],
    ): Promise<LanguageServerDiagnostic[]> => {
      if (!isPhpPath(path)) {
        return diagnostics;
      }

      let source = "";

      try {
        source = await readNavigationFileContent(path);
      } catch {
        return diagnostics;
      }

      const contextualTraitHostMethods = new Set<string>();
      const contextualTraitHostProperties = new Set<string>();
      const contextualTraitHostConstants = new Set<string>();
      const contextualExistingMethods = new Set<string>();
      const contextualMemberMethods = new Set<string>();
      const contextualMemberProperties = new Set<string>();

      for (const diagnostic of diagnostics) {
        const staticMethodContext = phpUnresolvedStaticMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (staticMethodContext) {
          const resolvedClassName = resolvePhpClassReference(
            source,
            staticMethodContext.className,
          );
          const hasContextualScopeMethod =
            resolvedClassName && isLaravelFrameworkActive
              ? await phpClassHasLaravelLocalScope(
                  resolvedClassName,
                  staticMethodContext.methodName,
                )
              : false;
          const hasContextualDynamicWhereMethod =
            isLaravelFrameworkActive && resolvedClassName
              ? await phpClassHasLaravelDynamicWhere(
                  resolvedClassName,
                  staticMethodContext.methodName,
                )
              : false;
          const hasContextualExistingStaticMethod = resolvedClassName
            ? await phpClassHierarchyHasStaticMethod(
                resolvedClassName,
                staticMethodContext.methodName,
              )
            : false;

          if (
            hasContextualScopeMethod ||
            hasContextualDynamicWhereMethod ||
            hasContextualExistingStaticMethod
          ) {
            contextualExistingMethods.add(
              phpMethodDiagnosticKey(
                staticMethodContext.className,
                staticMethodContext.methodName,
              ),
            );
          }
        }

        const memberMethodContext = phpUnresolvedMemberMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (memberMethodContext) {
          const diagnosticPosition = {
            column: diagnostic.character + 1,
            lineNumber: diagnostic.line + 1,
          };
          const builderModelType = isLaravelFrameworkActive
            ? await resolvePhpEloquentBuilderModelTypeRef.current(
                source,
                diagnosticPosition,
                memberMethodContext.receiverExpression,
              )
            : null;
          const hasContextualScopeMethod =
            builderModelType && isLaravelFrameworkActive
              ? await phpClassHasLaravelLocalScope(
                  builderModelType,
                  memberMethodContext.methodName,
                )
              : false;
          const hasContextualDynamicWhereMethod =
            isLaravelFrameworkActive && builderModelType
              ? await phpClassHasLaravelDynamicWhere(
                  builderModelType,
                  memberMethodContext.methodName,
                )
              : false;
          const receiverType = await resolvePhpExpressionTypeRef.current(
            source,
            diagnosticPosition,
            memberMethodContext.receiverExpression,
          );
          const hasContextualExistingMemberMethod = receiverType
            ? await phpClassHierarchyHasMethod(
                receiverType,
                memberMethodContext.methodName,
              )
            : false;
          const receiverPropertyAccess =
            phpCurrentTypeKind(source) === "trait"
              ? phpPropertyAccessExpression(
                  memberMethodContext.receiverExpression,
                )
              : null;
          const traitClassName =
            receiverPropertyAccess &&
            phpNormalizedReceiverExpressionIsThis(
              receiverPropertyAccess.receiverExpression,
            )
              ? phpCurrentClassName(source)
              : null;
          const hasContextualTraitHostPropertyMethod =
            traitClassName && receiverPropertyAccess
              ? await phpTraitHostPropertyMethodExists(
                  traitClassName,
                  receiverPropertyAccess.propertyName,
                  memberMethodContext.methodName,
                )
              : false;

          if (
            hasContextualScopeMethod ||
            hasContextualDynamicWhereMethod ||
            hasContextualExistingMemberMethod ||
            hasContextualTraitHostPropertyMethod
          ) {
            contextualMemberMethods.add(
              phpMemberMethodDiagnosticKey(
                memberMethodContext.receiverExpression,
                memberMethodContext.methodName,
              ),
            );
          }
        }

        const memberPropertyContext =
          phpUnresolvedMemberPropertyDiagnosticContext(source, diagnostic);

        if (memberPropertyContext) {
          const diagnosticPosition = {
            column: diagnostic.character + 1,
            lineNumber: diagnostic.line + 1,
          };
          const receiverType = await resolvePhpExpressionTypeRef.current(
            source,
            diagnosticPosition,
            memberPropertyContext.receiverExpression,
          );
          const hasContextualProperty = receiverType
            ? await phpClassHierarchyHasProperty(
                receiverType,
                memberPropertyContext.propertyName,
              )
            : false;

          if (hasContextualProperty) {
            contextualMemberProperties.add(
              phpMemberPropertyDiagnosticKey(
                memberPropertyContext.receiverExpression,
                memberPropertyContext.propertyName,
              ),
            );
          }
        }

        const traitMethodContext = phpTraitHostMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitMethodContext) {
          const normalizedTraitName = traitMethodContext.traitName.replace(
            /^\\+/,
            "",
          );
          const traitClassName = normalizedTraitName.includes("\\")
            ? normalizedTraitName
            : (resolvePhpClassReference(source, traitMethodContext.traitName) ??
              normalizedTraitName);

          if (
            await phpTraitHostMethodExists(
              traitClassName,
              traitMethodContext.methodName,
            )
          ) {
            contextualTraitHostMethods.add(
              phpTraitHostMethodDiagnosticKey(
                traitMethodContext.traitName,
                traitMethodContext.methodName,
              ),
            );
            contextualTraitHostMethods.add(
              phpTraitHostMethodDiagnosticKey(
                traitClassName,
                traitMethodContext.methodName,
              ),
            );
          }
        }

        const traitConstantContext = phpTraitHostConstantDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitConstantContext) {
          const normalizedTraitName = traitConstantContext.traitName.replace(
            /^\\+/,
            "",
          );
          const traitClassName = normalizedTraitName.includes("\\")
            ? normalizedTraitName
            : (resolvePhpClassReference(
                source,
                traitConstantContext.traitName,
              ) ?? normalizedTraitName);

          if (
            await phpTraitHostConstantExists(
              traitClassName,
              traitConstantContext.constantName,
            )
          ) {
            contextualTraitHostConstants.add(
              phpTraitHostConstantDiagnosticKey(
                traitConstantContext.traitName,
                traitConstantContext.constantName,
              ),
            );
            contextualTraitHostConstants.add(
              phpTraitHostConstantDiagnosticKey(
                traitClassName,
                traitConstantContext.constantName,
              ),
            );
          }
        }

        const traitPropertyContext = phpTraitHostPropertyDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitPropertyContext) {
          const normalizedTraitName = traitPropertyContext.traitName.replace(
            /^\\+/,
            "",
          );
          const traitClassName = normalizedTraitName.includes("\\")
            ? normalizedTraitName
            : (resolvePhpClassReference(
                source,
                traitPropertyContext.traitName,
              ) ?? normalizedTraitName);

          if (
            await phpTraitHostPropertyExists(
              traitClassName,
              traitPropertyContext.propertyName,
            )
          ) {
            contextualTraitHostProperties.add(
              phpTraitHostPropertyDiagnosticKey(
                traitPropertyContext.traitName,
                traitPropertyContext.propertyName,
              ),
            );
            contextualTraitHostProperties.add(
              phpTraitHostPropertyDiagnosticKey(
                traitClassName,
                traitPropertyContext.propertyName,
              ),
            );
          }
        }
      }

      if (isLaravelFrameworkActive && currentWorkspaceRootRef.current) {
        void ensurePhpLaravelMigrationSourcesLoaded(
          currentWorkspaceRootRef.current,
        );
        void ensurePhpLaravelProviderSourcesLoaded(
          currentWorkspaceRootRef.current,
        );
      }

      const { workspaceSources } = currentPhpLaravelSourceContext();

      return filterPhpLanguageServerDiagnostics(source, diagnostics, {
        contextualExistingMethods,
        contextualMemberMethods,
        contextualMemberProperties,
        contextualTraitHostConstants,
        contextualTraitHostMethods,
        contextualTraitHostProperties,
        frameworkProviders: activePhpFrameworkProviders,
        frameworkSourceContext:
          workspaceSources.length > 0 ? { workspaceSources } : undefined,
        path,
      });
    },
    [
      phpClassHasLaravelLocalScope,
      phpClassHasLaravelDynamicWhere,
      activePhpFrameworkProviders,
      currentPhpLaravelSourceContext,
      ensurePhpLaravelMigrationSourcesLoaded,
      ensurePhpLaravelProviderSourcesLoaded,
      isLaravelFrameworkActive,
      phpClassHierarchyHasMethod,
      phpClassHierarchyHasStaticMethod,
      phpClassHierarchyHasProperty,
      phpTraitHostConstantExists,
      phpTraitHostMethodExists,
      phpTraitHostPropertyMethodExists,
      phpTraitHostPropertyExists,
      readNavigationFileContent,
      resolvePhpClassReference,
    ],
  );

  useEffect(() => {
    contextualDiagnosticsFilterRef.current = filterPhpDiagnosticsWithContext;
  }, [filterPhpDiagnosticsWithContext]);

  const resolvePhpMethodReturnType = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
      lateStaticClassName = className,
      templateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const visitedKey = normalizedClassName.toLowerCase();
      const normalizedLateStaticClassName = lateStaticClassName
        .trim()
        .replace(/^\\+/, "");

      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return null;
      }

      visitedClassNames.add(visitedKey);

      const facadeTargetClassName = isLaravelFrameworkActive
        ? laravelFacadeTargetClassName(normalizedClassName)
        : null;

      if (facadeTargetClassName) {
        return resolvePhpMethodReturnType(
          facadeTargetClassName,
          methodName,
          visitedClassNames,
          facadeTargetClassName,
        );
      }

      const resolveBoundConcreteReturnType = async (): Promise<string | null> => {
        const boundConcreteClassName =
          await resolvePhpFrameworkBoundConcrete(normalizedClassName);

        if (!isRequestedRootActive()) {
          return null;
        }

        if (
          !boundConcreteClassName ||
          boundConcreteClassName.toLowerCase() === visitedKey
        ) {
          return null;
        }

        const boundReturnType = await resolvePhpMethodReturnType(
          boundConcreteClassName,
          methodName,
          visitedClassNames,
          boundConcreteClassName,
        );

        if (!isRequestedRootActive()) {
          return null;
        }

        return boundReturnType;
      };

      const resolveReturnExpressionType = async (
        ownerSource: string,
        expression: string,
      ): Promise<string | null> => {
        const constructedClassName =
          phpNewExpressionClassName(expression) ??
          phpFrameworkContainerExpressionClassName(
            expression,
            activePhpFrameworkProviders,
          );

        if (constructedClassName) {
          return resolvePhpClassReference(ownerSource, constructedClassName);
        }

        const methodCall = phpMethodCallExpression(expression);

        if (methodCall) {
          const directReceiverType = phpReceiverExpressionTypeInSource(
            ownerSource,
            { column: 1, lineNumber: 1 },
            methodCall.receiverExpression,
            { frameworkProviders: activePhpFrameworkProviders },
          );
          const constructedReceiverType =
            directReceiverType ??
            phpNewExpressionClassName(methodCall.receiverExpression) ??
            phpFrameworkContainerExpressionClassName(
              methodCall.receiverExpression,
              activePhpFrameworkProviders,
            );
          const resolvedReceiverType = constructedReceiverType
            ? resolvePhpClassReference(ownerSource, constructedReceiverType)
            : null;
          const frameworkReturnType =
            phpFrameworkMethodCallReturnTypeFromSource(
              ownerSource,
              methodCall.methodName,
              resolvedReceiverType,
              methodCall.receiverExpression,
              activePhpFrameworkProviders,
              expression,
            );
          const resolvedFrameworkReturnType = frameworkReturnType
            ? resolvePhpFrameworkReturnTypeReference(
                ownerSource,
                frameworkReturnType,
              )
            : null;

          if (resolvedFrameworkReturnType) {
            return resolvedFrameworkReturnType;
          }

          if (
            isLaravelFrameworkActive &&
            methodCall.methodName.toLowerCase() === "morphto" &&
            resolvedReceiverType
          ) {
            const morphMapModelType =
              await resolvePhpLaravelProjectMorphMapModelType();

            if (morphMapModelType) {
              return `Illuminate\\Database\\Eloquent\\Relations\\MorphTo<${morphMapModelType}>`;
            }
          }

          if (isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName)) {
            const builderModelType =
              await resolvePhpEloquentBuilderModelTypeRef.current(
                ownerSource,
                { column: 1, lineNumber: 1 },
                methodCall.receiverExpression,
              );

            if (builderModelType) {
              return builderModelType;
            }
          }

          return resolvedReceiverType
            ? resolvePhpMethodReturnType(
                resolvedReceiverType,
                methodCall.methodName,
                visitedClassNames,
              )
            : null;
        }

        const staticCall = phpStaticCallExpression(expression);

        if (staticCall) {
          const className = resolvePhpClassReference(
            ownerSource,
            staticCall.className,
          );

          if (
            className &&
            isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName)
          ) {
            return className;
          }

          return className
            ? resolvePhpMethodReturnType(
                className,
                staticCall.methodName,
                visitedClassNames,
              )
            : null;
        }

        return null;
      };

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return null;
          }

          const method = members.find(
            (candidate) =>
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const methodReturnExpressions = method
            ? phpMethodReturnExpressions(content, method.name)
            : [];
          const returnType = method
            ? resolvePhpMethodDeclaredReturnType(
                content,
                method.returnType,
                normalizedLateStaticClassName || normalizedClassName,
                templateTypes,
              )
            : null;

          if (returnType) {
            if (
              isLaravelFrameworkActive &&
              isLaravelMorphToReturnTypeName(returnType) &&
              methodReturnExpressions.some(isLaravelMorphToFactoryExpression)
            ) {
              const morphMapModelType =
                await resolvePhpLaravelProjectMorphMapModelType();

              if (!isRequestedRootActive()) {
                return null;
              }

              if (morphMapModelType) {
                return `Illuminate\\Database\\Eloquent\\Relations\\MorphTo<${morphMapModelType}>`;
              }
            }

            return returnType;
          }

          if (method) {
            for (const expression of methodReturnExpressions) {
              const expressionReturnType = await resolveReturnExpressionType(
                content,
                expression,
              );

              if (!isRequestedRootActive()) {
                return null;
              }

              if (expressionReturnType) {
                return expressionReturnType;
              }
            }
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(content, traitName);
            const traitTemplateTypes = resolvedTraitName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedTraitName,
                  templateTypes,
                )
              : new Map<string, string>();

            if (!isRequestedRootActive()) {
              return null;
            }

            const traitReturnType = resolvedTraitName
              ? await resolvePhpMethodReturnType(
                  resolvedTraitName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  traitTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (traitReturnType) {
              return traitReturnType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
            const mixinTemplateTypes = resolvedMixinName
              ? await resolvePhpGenericTemplateTypesForMixinClass(
                  content,
                  resolvedMixinName,
                  templateTypes,
                )
              : new Map<string, string>();

            if (!isRequestedRootActive()) {
              return null;
            }

            const mixinReturnType = resolvedMixinName
              ? await resolvePhpMethodReturnType(
                  resolvedMixinName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  mixinTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (mixinReturnType) {
              return mixinReturnType;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (!resolvedSuperTypeName) {
              continue;
            }

            const superTypeTemplateTypes =
              await resolvePhpGenericTemplateTypesForInheritedClass(
                content,
                resolvedSuperTypeName,
                templateTypes,
              );

            if (!isRequestedRootActive()) {
              return null;
            }

            const superTypeReturnType = await resolvePhpMethodReturnType(
              resolvedSuperTypeName,
              methodName,
              visitedClassNames,
              normalizedLateStaticClassName || normalizedClassName,
              superTypeTemplateTypes,
            );

            if (!isRequestedRootActive()) {
              return null;
            }

            if (superTypeReturnType) {
              return superTypeReturnType;
            }
          }

          if (!isRequestedRootActive()) {
            return null;
          }

          return resolveBoundConcreteReturnType();
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      return resolveBoundConcreteReturnType();
    },
    [
      activePhpFrameworkProviders,
      isLaravelFrameworkActive,
      readPhpClassMembersFromPath,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpClassReference,
      resolvePhpFrameworkReturnTypeReference,
      resolvePhpLaravelProjectMorphMapModelType,
      resolvePhpMethodDeclaredReturnType,
      resolvePhpClassSourcePaths,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpLaravelMethodGenericModelType = useCallback(
    async (
      carrierKind: "builder" | "collection",
      className: string,
      methodName: string,
    ): Promise<string | null> => {
      if (!isLaravelFrameworkActive || !workspaceRoot || !workspaceDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );
          const method = members.find(
            (candidate) =>
              candidate.kind !== "property" &&
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const modelTypeCandidate =
            carrierKind === "builder"
              ? phpLaravelEloquentBuilderModelTypeCandidate(
                  content,
                  method?.returnType ?? null,
                )
              : phpLaravelCollectionModelTypeCandidate(
                  content,
                  method?.returnType ?? null,
                );
          const modelType = modelTypeCandidate
            ? resolvePhpClassReference(content, modelTypeCandidate)
            : null;

          if (modelType) {
            return modelType;
          }

          if (method) {
            const expressionModelType = phpMethodReturnExpressions(
              content,
              method.name,
            )
              .map((expression) =>
                carrierKind === "builder"
                  ? phpLaravelEloquentBuilderModelTypeFromExpression(
                      content,
                      expression,
                    )
                  : phpLaravelEloquentBuilderCollectionModelTypeFromExpression(
                      content,
                      expression,
                    ),
              )
              .find((candidate): candidate is string => Boolean(candidate));

            if (expressionModelType) {
              return expressionModelType;
            }
          }

          const conventionModelType =
            method?.returnType
              ? phpLaravelRepositoryConventionModelTypeFromCarrierReturnType(
                  content,
                  normalizedClassName,
                  method.returnType,
                  carrierKind,
                )
              : null;

          if (conventionModelType) {
            return conventionModelType;
          }
        } catch {
          continue;
        }
      }

      return null;
    },
    [
      isLaravelFrameworkActive,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpClassPropertyOrRelationType = useCallback(
    async (
      className: string,
      propertyName: string,
      includeCollectionRelations = false,
      visitedClassNames = new Set<string>(),
      templateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const visitedKey = normalizedClassName.toLowerCase();

      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return null;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return null;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return null;
          }

          const matchingMembers = members.filter(
            (candidate) =>
              candidate.name.toLowerCase() === propertyName.toLowerCase(),
          );
          const relationMethod =
            matchingMembers.find((candidate) => candidate.kind !== "property") ??
            null;
          const propertyMember =
            matchingMembers.find(
              (candidate) => candidate.kind === "property" && candidate.returnType,
            ) ?? null;
          const resolvedPropertyMember = propertyMember
            ? phpMethodCompletionWithTemplateReturnType(
                propertyMember,
                templateTypes,
              )
            : null;
          const collectionPropertyModelType =
            resolvedPropertyMember && includeCollectionRelations
              ? phpCollectionGenericModelTypeCandidate(
                  resolvedPropertyMember.returnType,
                )
              : null;
          const resolvedCollectionPropertyModelType = collectionPropertyModelType
            ? resolvePhpClassReference(content, collectionPropertyModelType)
            : null;

          const relationType = relationMethod?.returnType
            ? resolvePhpLaravelRelationModelType(
                content,
                relationMethod.returnType,
                includeCollectionRelations,
              )
            : null;

          if (relationType) {
            return relationType;
          }

          if (resolvedCollectionPropertyModelType) {
            return resolvedCollectionPropertyModelType;
          }

          const propertyReturnType = resolvedPropertyMember?.returnType ?? null;
          const propertyTypeCandidate = propertyReturnType
            ? phpDeclaredTypeCandidate(propertyReturnType)
            : null;
          const propertyType = propertyTypeCandidate?.includes("\\")
            ? propertyTypeCandidate
            : propertyReturnType
              ? resolvePhpDeclaredType(content, propertyReturnType)
              : null;

          if (propertyType) {
            return propertyType;
          }

          if (relationMethod) {
            let hasMorphToReturnExpression = false;

            for (const expression of phpMethodReturnExpressions(
              content,
              relationMethod.name,
            )) {
              if (isLaravelMorphToFactoryExpression(expression)) {
                hasMorphToReturnExpression = true;
              }

              const relationTargetClassName =
                phpLaravelRelationTargetClassNameFromExpression(
                  expression,
                  includeCollectionRelations,
                );
              const resolvedRelationTargetClassName = relationTargetClassName
                ? resolvePhpRelationTargetClassReference(
                    content,
                    relationTargetClassName,
                  )
                : null;

              if (resolvedRelationTargetClassName) {
                return resolvedRelationTargetClassName;
              }
            }

            if (hasMorphToReturnExpression && isLaravelFrameworkActive) {
              const morphMapModelType =
                await resolvePhpLaravelProjectMorphMapModelType();

              if (!isRequestedRootActive()) {
                return null;
              }

              if (morphMapModelType) {
                return morphMapModelType;
              }
            }
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(content, traitName);
            const traitTemplateTypes = resolvedTraitName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedTraitName,
                  templateTypes,
                )
              : new Map<string, string>();
            const traitType = resolvedTraitName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedTraitName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  traitTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (traitType) {
              return traitType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
            const mixinTemplateTypes = resolvedMixinName
              ? await resolvePhpGenericTemplateTypesForMixinClass(
                  content,
                  resolvedMixinName,
                  templateTypes,
                )
              : new Map<string, string>();
            const mixinType = resolvedMixinName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedMixinName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  mixinTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (mixinType) {
              return mixinType;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );
            const superTypeTemplateTypes = resolvedSuperTypeName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedSuperTypeName,
                  templateTypes,
                )
              : new Map<string, string>();
            const superTypePropertyType = resolvedSuperTypeName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedSuperTypeName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  superTypeTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (superTypePropertyType) {
              return superTypePropertyType;
            }
          }

          return null;
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      return null;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      resolvePhpLaravelProjectMorphMapModelType,
      isLaravelFrameworkActive,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    resolvePhpClassPropertyOrRelationTypeRef.current =
      resolvePhpClassPropertyOrRelationType;
  }, [resolvePhpClassPropertyOrRelationType]);

  const resolvePhpLaravelRelationPathOwnerType = useCallback(
    async (
      className: string,
      previousRelationNames: readonly string[] = [],
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!isLaravelFrameworkActive || !requestedRoot) {
        return null;
      }

      let ownerType: string | null = className;

      for (const relationName of previousRelationNames) {
        if (!isRequestedRootActive()) {
          return null;
        }

        ownerType = ownerType
          ? await resolvePhpClassPropertyOrRelationType(
              ownerType,
              relationName,
              true,
            )
          : null;

        if (!isRequestedRootActive()) {
          return null;
        }

        if (!ownerType) {
          return null;
        }
      }

      return ownerType;
    },
    [
      resolvePhpClassPropertyOrRelationType,
      isLaravelFrameworkActive,
      workspaceRoot,
    ],
  );

  const resolvePhpCollectionModelTypeFromClass = useCallback(
    async (className: string): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const visitedClassNames = new Set<string>();

      const resolveCollection = async (
        candidateClassName: string,
      ): Promise<string | null> => {
        const normalizedClassName = candidateClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return null;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return null;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return null;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return null;
            }

            const genericModelType =
              phpClassDocGenericCollectionModelTypeCandidate(content);
            const resolvedGenericModelType = genericModelType
              ? resolvePhpClassReference(content, genericModelType)
              : null;

            if (resolvedGenericModelType) {
              return resolvedGenericModelType;
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;
            const parentModelType = resolvedParentClassName
              ? await resolveCollection(resolvedParentClassName)
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (parentModelType) {
              return parentModelType;
            }
          } catch {
            if (!isRequestedRootActive()) {
              return null;
            }

            continue;
          }
        }

        if (!isRequestedRootActive()) {
          return null;
        }

        return null;
      };

      const modelType = await resolveCollection(className);

      if (!isRequestedRootActive()) {
        return null;
      }

      return modelType;
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpEloquentBuilderModelType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (!isLaravelFrameworkActive || depth > 5) {
        return null;
      }

      const normalizedExpression = expression.trim();
      const resolvePhpModelExpressionType = async (
        expression: string,
        modelDepth: number,
      ): Promise<string | null> => {
        if (modelDepth > 5) {
          return null;
        }

        const normalizedModelExpression = expression.trim();
        const directType = phpReceiverExpressionTypeInSource(
          source,
          position,
          normalizedModelExpression,
          { frameworkProviders: activePhpFrameworkProviders },
        );

        if (directType) {
          return resolvePhpClassReference(source, directType);
        }

        const modelVariableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
          normalizedModelExpression,
        );
        const modelAssignmentExpression = modelVariableMatch?.[1]
          ? phpAssignmentExpressionForVariableBefore(
              source,
              position,
              modelVariableMatch[1],
            )
          : null;

        if (modelAssignmentExpression) {
          return resolvePhpModelExpressionType(
            modelAssignmentExpression,
            modelDepth + 1,
          );
        }

        const constructedClassName =
          phpNewExpressionClassName(normalizedModelExpression) ??
          phpFrameworkContainerExpressionClassName(
            normalizedModelExpression,
            activePhpFrameworkProviders,
          );

        if (constructedClassName) {
          return resolvePhpClassReference(source, constructedClassName);
        }

        const modelMethodCall = phpMethodCallExpression(normalizedModelExpression);

        if (modelMethodCall) {
          const receiverType = await resolvePhpModelExpressionType(
            modelMethodCall.receiverExpression,
            modelDepth + 1,
          );

          return receiverType
            ? resolvePhpMethodReturnType(receiverType, modelMethodCall.methodName)
            : null;
        }

        const modelStaticCall = phpStaticCallExpression(normalizedModelExpression);

        if (modelStaticCall) {
          const className = resolvePhpClassReference(
            source,
            modelStaticCall.className,
          );

          return className
            ? resolvePhpMethodReturnType(className, modelStaticCall.methodName)
            : null;
        }

        return null;
      };
      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        normalizedExpression,
      );

      if (variableMatch?.[1]) {
        const callbackContext = phpLaravelQueryCallbackContextForVariable(
          source,
          position,
          variableMatch[1],
        );

        if (callbackContext) {
          const callbackMorphModelType =
            callbackContext.morphTypeClassNames?.length === 1
              ? resolvePhpClassReference(
                  source,
                  callbackContext.morphTypeClassNames[0] ?? "",
                )
              : null;

          if (callbackMorphModelType) {
            return callbackMorphModelType;
          }

          const callbackHostModelType = callbackContext.modelClassName
            ? resolvePhpClassReference(source, callbackContext.modelClassName)
            : callbackContext.receiverExpression
              ? await resolvePhpEloquentBuilderModelType(
                  source,
                  position,
                  callbackContext.receiverExpression,
                  depth + 1,
                )
              : null;
          const callbackRelationOwnerType =
            callbackHostModelType && callbackContext.previousRelationNames?.length
              ? await resolvePhpLaravelRelationPathOwnerType(
                  callbackHostModelType,
                  callbackContext.previousRelationNames,
                )
              : callbackHostModelType;
          const callbackRelationModelType =
            callbackRelationOwnerType && callbackContext.relationName
              ? await resolvePhpClassPropertyOrRelationType(
                  callbackRelationOwnerType,
                  callbackContext.relationName,
                  true,
                )
              : null;

          if (callbackRelationModelType || callbackHostModelType) {
            return callbackRelationModelType ?? callbackHostModelType;
          }
        }

        const phpDocType = phpDocRawTypeForVariableBefore(
          source,
          position,
          variableMatch[1],
        );
        const phpDocGenericModelTypeCandidate = phpDocType
          ? phpLaravelEloquentBuilderModelTypeCandidate(source, phpDocType)
          : null;
        const phpDocGenericModelType = phpDocGenericModelTypeCandidate
          ? resolvePhpClassReference(source, phpDocGenericModelTypeCandidate)
          : null;

        if (phpDocGenericModelType) {
          return phpDocGenericModelType;
        }

        const assignmentExpression = phpAssignmentExpressionForVariableBefore(
          source,
          position,
          variableMatch[1],
        );

        if (assignmentExpression) {
          return resolvePhpEloquentBuilderModelType(
            source,
            position,
            assignmentExpression,
            depth + 1,
          );
        }
      }

      const methodCall = phpMethodCallExpression(normalizedExpression);

      if (methodCall) {
        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { frameworkProviders: activePhpFrameworkProviders },
        );
        const constructedReceiverType =
          directReceiverType ??
          phpNewExpressionClassName(methodCall.receiverExpression) ??
          phpFrameworkContainerExpressionClassName(
            methodCall.receiverExpression,
            activePhpFrameworkProviders,
          );
        const receiverType = constructedReceiverType
          ? resolvePhpClassReference(source, constructedReceiverType)
          : null;
        const methodGenericModelType = receiverType
          ? await resolvePhpLaravelMethodGenericModelType(
              "builder",
              receiverType,
              methodCall.methodName,
            )
          : null;

        if (methodGenericModelType) {
          return methodGenericModelType;
        }
      }

      if (
        methodCall &&
        isLaravelEloquentModelBuilderFactoryMethod(methodCall.methodName)
      ) {
        return resolvePhpModelExpressionType(
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (
        methodCall &&
        (isLaravelEloquentBuilderFluentMethod(methodCall.methodName) ||
          isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName))
      ) {
        return resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (methodCall) {
        const receiverModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );

        if (
          receiverModelType &&
          (await phpClassHasLaravelLocalScope(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return receiverModelType;
        }

        if (
          receiverModelType &&
          (await phpClassHasLaravelDynamicWhere(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return receiverModelType;
        }
      }

      const staticCall = phpStaticCallExpression(normalizedExpression);
      const staticCallClassName = staticCall
        ? resolvePhpClassReference(source, staticCall.className)
        : null;

      if (
        staticCall &&
        staticCallClassName &&
        (await phpClassHasLaravelLocalScope(
          staticCallClassName,
          staticCall.methodName,
        ))
      ) {
        return staticCallClassName;
      }

      if (
        staticCall &&
        staticCallClassName &&
        (await phpClassHasLaravelDynamicWhere(
          staticCallClassName,
          staticCall.methodName,
        ))
      ) {
        return staticCallClassName;
      }

      if (
        staticCall &&
        (isLaravelEloquentStaticBuilderMethod(staticCall.methodName) ||
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName))
      ) {
        return staticCallClassName;
      }

      if (staticCall && staticCallClassName) {
        const staticGenericModelType =
          await resolvePhpLaravelMethodGenericModelType(
            "builder",
            staticCallClassName,
            staticCall.methodName,
          );

        if (staticGenericModelType) {
          return staticGenericModelType;
        }
      }

      return null;
    },
    [
      activePhpFrameworkProviders,
      phpClassHasLaravelLocalScope,
      phpClassHasLaravelDynamicWhere,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpLaravelRelationPathOwnerType,
      resolvePhpLaravelMethodGenericModelType,
      resolvePhpMethodReturnType,
    ],
  );

  useEffect(() => {
    resolvePhpEloquentBuilderModelTypeRef.current =
      resolvePhpEloquentBuilderModelType;
  }, [resolvePhpEloquentBuilderModelType]);

  const resolvePhpLaravelCollectionModelType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (!isLaravelFrameworkActive || depth > 5) {
        return null;
      }

      const normalizedExpression = expression.trim();
      const directCollectionType = phpReceiverExpressionTypeInSource(
        source,
        position,
        normalizedExpression,
        { frameworkProviders: activePhpFrameworkProviders },
      );
      const resolvedDirectCollectionType = directCollectionType
        ? resolvePhpClassReference(source, directCollectionType)
        : null;
      const directCollectionModelType = resolvedDirectCollectionType
        ? await resolvePhpCollectionModelTypeFromClass(resolvedDirectCollectionType)
        : null;

      if (directCollectionModelType) {
        return directCollectionModelType;
      }

      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        normalizedExpression,
      );

      if (variableMatch?.[1]) {
        const phpDocType = phpDocRawTypeForVariableBefore(
          source,
          position,
          variableMatch[1],
        );
        const phpDocGenericModelTypeCandidate = phpDocType
          ? phpLaravelCollectionModelTypeCandidate(source, phpDocType)
          : null;
        const phpDocGenericModelType = phpDocGenericModelTypeCandidate
          ? resolvePhpClassReference(source, phpDocGenericModelTypeCandidate)
          : null;

        if (phpDocGenericModelType) {
          return phpDocGenericModelType;
        }

        const assignmentExpression = phpAssignmentExpressionForVariableBefore(
          source,
          position,
          variableMatch[1],
        );

        if (assignmentExpression) {
          return resolvePhpLaravelCollectionModelType(
            source,
            position,
            assignmentExpression,
            depth + 1,
          );
        }
      }

      const methodCall = phpMethodCallExpression(normalizedExpression);

      if (
        methodCall &&
        isLaravelCollectionTerminalModelMethod(methodCall.methodName)
      ) {
        return resolvePhpLaravelCollectionModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (methodCall && isLaravelCollectionFluentMethod(methodCall.methodName)) {
        return resolvePhpLaravelCollectionModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (
        methodCall &&
        isLaravelEloquentBuilderCollectionMethod(methodCall.methodName)
      ) {
        return resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
      }

      if (methodCall) {
        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { frameworkProviders: activePhpFrameworkProviders },
        );
        const constructedReceiverType =
          directReceiverType ??
          phpNewExpressionClassName(methodCall.receiverExpression) ??
          phpFrameworkContainerExpressionClassName(
            methodCall.receiverExpression,
            activePhpFrameworkProviders,
          );
        const receiverType = constructedReceiverType
          ? resolvePhpClassReference(source, constructedReceiverType)
          : null;
        const methodGenericModelType = receiverType
          ? await resolvePhpLaravelMethodGenericModelType(
              "collection",
              receiverType,
              methodCall.methodName,
            )
          : null;

        if (methodGenericModelType) {
          return methodGenericModelType;
        }
      }

      const staticCall = phpStaticCallExpression(normalizedExpression);
      const staticCallClassName = staticCall
        ? resolvePhpClassReference(source, staticCall.className)
        : null;
      const staticGenericModelType = staticCall && staticCallClassName
        ? await resolvePhpLaravelMethodGenericModelType(
            "collection",
            staticCallClassName,
            staticCall.methodName,
          )
        : null;

      if (staticGenericModelType) {
        return staticGenericModelType;
      }

      return null;
    },
    [
      activePhpFrameworkProviders,
      resolvePhpClassReference,
      resolvePhpCollectionModelTypeFromClass,
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelMethodGenericModelType,
      isLaravelFrameworkActive,
    ],
  );

  const phpClassMethodReturnsClassStringArgument = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const methods = await collectPhpMethodsForClass(className);

      return methods.some(
        (method) =>
          method.kind !== "property" &&
          method.name.toLowerCase() === methodName.toLowerCase() &&
          Boolean(method.classStringTemplate),
      );
    },
    [collectPhpMethodsForClass],
  );

  const resolvePhpExpressionType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (depth > 8) {
        return null;
      }

      const resolveBoundFrameworkMethodCallReturnType = async (
        candidateExpression: string,
      ): Promise<string | null> => {
        const methodCall = phpMethodCallExpression(candidateExpression.trim());

        if (!methodCall) {
          return null;
        }

        const directReceiverType = phpReceiverExpressionTypeInSource(
          source,
          position,
          methodCall.receiverExpression,
          { frameworkProviders: activePhpFrameworkProviders },
        );
        const receiverType = directReceiverType
          ? resolvePhpClassReference(source, directReceiverType)
          : null;
        const boundReceiverType = receiverType
          ? await resolvePhpFrameworkBoundConcrete(receiverType)
          : null;
        const boundReceiverReturnType =
          boundReceiverType &&
          boundReceiverType.toLowerCase() !== receiverType?.toLowerCase()
            ? await resolvePhpMethodReturnType(
                boundReceiverType,
                methodCall.methodName,
              )
            : null;

        return boundReceiverReturnType;
      };

      const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        expression.trim(),
      );
      const assignmentExpression = variableMatch?.[1]
        ? phpAssignmentExpressionForVariableBefore(
            source,
            position,
            variableMatch[1],
          )
        : null;

      if (
        assignmentExpression &&
        variableMatch?.[1] &&
        !phpDocRawTypeForVariableBefore(source, position, variableMatch[1])
      ) {
        const boundAssignmentType =
          await resolveBoundFrameworkMethodCallReturnType(assignmentExpression);

        if (boundAssignmentType) {
          return boundAssignmentType;
        }

        const frameworkAssignmentType = resolvePhpFrameworkReturnTypeReference(
          source,
          phpReceiverExpressionTypeInSource(
            source,
            position,
            assignmentExpression,
            { frameworkProviders: activePhpFrameworkProviders },
          ),
        );

        if (frameworkAssignmentType) {
          return frameworkAssignmentType;
        }

        const assignmentType = await resolvePhpExpressionType(
          source,
          position,
          assignmentExpression,
          depth + 1,
        );

        if (assignmentType) {
          return assignmentType;
        }
      }

      const directType = phpReceiverExpressionTypeInSource(
        source,
        position,
        expression,
        { frameworkProviders: activePhpFrameworkProviders },
      );

      if (directType) {
        return resolvePhpSemanticTypeReference(source, directType);
      }

      if (assignmentExpression) {
        const assignmentType = await resolvePhpExpressionType(
          source,
          position,
          assignmentExpression,
          depth + 1,
        );

        if (assignmentType) {
          return assignmentType;
        }
      }

      if (
        isLaravelFrameworkActive &&
        variableMatch?.[1] &&
        phpLaravelQueryCallbackContextForVariable(
          source,
          position,
          variableMatch[1],
        )
      ) {
        const callbackBuilderModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          expression,
          depth + 1,
        );

        if (callbackBuilderModelType) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }
      }

      const constructedClassName =
        phpNewExpressionClassName(expression) ??
        phpFrameworkContainerExpressionClassName(
          expression,
          activePhpFrameworkProviders,
        );

      if (constructedClassName) {
        return resolvePhpClassReference(source, constructedClassName);
      }

      const classStringCall = phpClassStringCallExpression(expression);

      if (classStringCall) {
        const argumentType = resolvePhpClassReference(
          source,
          classStringCall.argumentClassName,
        );
        let returnsArgumentType = false;

        if (classStringCall.kind === "functionCall") {
          returnsArgumentType = phpFunctionReturnsClassStringArgument(
            source,
            classStringCall.functionName,
          );
        }

        if (classStringCall.kind === "staticCall") {
          const ownerType = resolvePhpClassReference(
            source,
            classStringCall.className,
          );
          returnsArgumentType = ownerType
            ? await phpClassMethodReturnsClassStringArgument(
                ownerType,
                classStringCall.methodName,
              )
            : false;
        }

        if (classStringCall.kind === "methodCall") {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            classStringCall.receiverExpression,
            depth + 1,
          );
          returnsArgumentType = receiverType
            ? await phpClassMethodReturnsClassStringArgument(
                receiverType,
                classStringCall.methodName,
              )
            : false;
        }

        if (returnsArgumentType && argumentType) {
          return argumentType;
        }
      }

      const propertyAccess = phpPropertyAccessExpression(expression);

      if (propertyAccess) {
        const receiverType = await resolvePhpExpressionType(
          source,
          position,
          propertyAccess.receiverExpression,
          depth + 1,
        );
        const propertyType = receiverType
          ? await resolvePhpClassPropertyOrRelationType(
              receiverType,
              propertyAccess.propertyName,
            )
          : null;

        if (propertyType) {
          return propertyType;
        }
      }

      const methodCall = phpMethodCallExpression(expression);

      if (methodCall) {
        if (
          isLaravelFrameworkActive &&
          isLaravelCollectionTerminalModelMethod(methodCall.methodName)
        ) {
          const collectionPropertyAccess = phpPropertyAccessExpression(
            methodCall.receiverExpression,
          );
          const collectionPropertyReceiverType = collectionPropertyAccess
            ? await resolvePhpExpressionType(
                source,
                position,
                collectionPropertyAccess.receiverExpression,
                depth + 1,
              )
            : null;
          const collectionRelationModelType =
            collectionPropertyReceiverType && collectionPropertyAccess
              ? await resolvePhpClassPropertyOrRelationType(
                  collectionPropertyReceiverType,
                  collectionPropertyAccess.propertyName,
                  true,
                )
              : null;

          if (collectionRelationModelType) {
            return collectionRelationModelType;
          }

          const modelType = await resolvePhpLaravelCollectionModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return modelType;
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentModelBuilderFactoryMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            expression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName)
        ) {
          let relationExpression = methodCall.receiverExpression;
          let relationCall = phpMethodCallExpression(relationExpression);

          while (
            relationCall &&
            (isLaravelEloquentBuilderCollectionMethod(relationCall.methodName) ||
              isLaravelCollectionFluentMethod(relationCall.methodName))
          ) {
            relationExpression = relationCall.receiverExpression;
            relationCall = phpMethodCallExpression(relationExpression);
          }

          const relationPropertyAccess =
            phpPropertyAccessExpression(relationExpression);
          const relationReceiverType = relationCall
            ? await resolvePhpExpressionType(
                source,
                position,
                relationCall.receiverExpression,
                depth + 1,
              )
            : relationPropertyAccess
              ? await resolvePhpExpressionType(
                  source,
                  position,
                  relationPropertyAccess.receiverExpression,
                  depth + 1,
                )
            : null;
          const relationMemberName =
            relationCall?.methodName ?? relationPropertyAccess?.propertyName ?? null;
          const relationModelType =
            relationReceiverType && relationMemberName
              ? await resolvePhpClassPropertyOrRelationType(
                  relationReceiverType,
                  relationMemberName,
                  true,
                )
              : null;

          if (relationModelType) {
            return relationModelType;
          }

          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return modelType;
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderCollectionMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Collection";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelCollectionFluentMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpLaravelCollectionModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Collection";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelEloquentBuilderFluentMethod(methodCall.methodName)
        ) {
          const modelType = await resolvePhpEloquentBuilderModelType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (modelType) {
            return "Illuminate\\Database\\Eloquent\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelDatabaseQueryBuilderFactoryMethod(methodCall.methodName)
        ) {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (receiverType && isLaravelDatabaseConnectionType(receiverType)) {
            return "Illuminate\\Database\\Query\\Builder";
          }
        }

        if (
          isLaravelFrameworkActive &&
          isLaravelDatabaseQueryBuilderFluentMethod(methodCall.methodName)
        ) {
          const receiverType = await resolvePhpExpressionType(
            source,
            position,
            methodCall.receiverExpression,
            depth + 1,
          );

          if (receiverType && isLaravelDatabaseQueryBuilderType(receiverType)) {
            return "Illuminate\\Database\\Query\\Builder";
          }
        }

        const localScopeModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );

        if (
          isLaravelFrameworkActive &&
          localScopeModelType &&
          (await phpClassHasLaravelLocalScope(
            localScopeModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          localScopeModelType &&
          (await phpClassHasLaravelDynamicWhere(
            localScopeModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        const receiverType = await resolvePhpExpressionType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );
        const receiverModelType =
          isLaravelFrameworkActive && receiverType
            ? phpLaravelResolvedModelTypeCandidate(source, receiverType)
            : null;

        if (
          receiverModelType &&
          (await phpClassHasLaravelLocalScope(
            receiverModelType,
            methodCall.methodName,
          ))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        const boundReceiverType = receiverType
          ? await resolvePhpFrameworkBoundConcrete(receiverType)
          : null;
        const boundReceiverReturnType =
          boundReceiverType &&
          boundReceiverType.toLowerCase() !== receiverType?.toLowerCase()
            ? await resolvePhpMethodReturnType(
                boundReceiverType,
                methodCall.methodName,
              )
            : null;

        if (boundReceiverReturnType) {
          return boundReceiverReturnType;
        }

        const frameworkReturnType = phpFrameworkMethodCallReturnTypeFromSource(
          source,
          methodCall.methodName,
          receiverType,
          methodCall.receiverExpression,
          activePhpFrameworkProviders,
          expression,
        );
        const resolvedFrameworkReturnType = frameworkReturnType
          ? resolvePhpFrameworkReturnTypeReference(source, frameworkReturnType)
          : null;

        if (resolvedFrameworkReturnType) {
          return resolvedFrameworkReturnType;
        }

        if (
          isLaravelFrameworkActive &&
          receiverType &&
          isLaravelEloquentModelFluentMethod(methodCall.methodName)
        ) {
          return receiverType;
        }

        return receiverType
          ? resolvePhpMethodReturnType(receiverType, methodCall.methodName)
          : null;
      }

      const staticCall = phpStaticCallExpression(expression);

      if (staticCall) {
        const className = resolvePhpClassReference(source, staticCall.className);
        const facadeTargetClassName = isLaravelFrameworkActive && className
          ? (laravelFacadeTargetClassName(className) ?? className)
          : null;
        const facadeOrClassName = facadeTargetClassName ?? className;

        if (
          isLaravelFrameworkActive &&
          className &&
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName)
        ) {
          return className;
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          isLaravelEloquentStaticBuilderMethod(staticCall.methodName)
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          facadeOrClassName &&
          isLaravelDatabaseQueryBuilderFactoryMethod(staticCall.methodName) &&
          isLaravelDatabaseConnectionType(facadeOrClassName)
        ) {
          return "Illuminate\\Database\\Query\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          (await phpClassHasLaravelLocalScope(className, staticCall.methodName))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          isLaravelFrameworkActive &&
          className &&
          (await phpClassHasLaravelDynamicWhere(className, staticCall.methodName))
        ) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        return className
          ? resolvePhpMethodReturnType(className, staticCall.methodName)
          : null;
      }

      return null;
    },
    [
      activePhpFrameworkProviders,
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelCollectionModelType,
      resolvePhpClassReference,
      resolvePhpClassPropertyOrRelationType,
      phpClassMethodReturnsClassStringArgument,
      phpClassHasLaravelLocalScope,
      phpClassHasLaravelDynamicWhere,
      isLaravelFrameworkActive,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpFrameworkReturnTypeReference,
      resolvePhpMethodReturnType,
    ],
  );

  useEffect(() => {
    resolvePhpExpressionTypeRef.current = resolvePhpExpressionType;
  }, [resolvePhpExpressionType]);

  const resolvePhpReceiverMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
      receiverExpression: string,
      traitThisContext: PhpTraitThisCompletionContext | null = null,
    ): Promise<PhpMethodCompletion[]> => {
      if (
        traitThisContext &&
        phpNormalizedReceiverExpressionIsThis(receiverExpression)
      ) {
        const semanticOptions = traitThisContext.contextualThisClassName
          ? {
              contextualThisClassName: traitThisContext.contextualThisClassName,
              frameworkProviders: activePhpFrameworkProviders,
            }
          : { frameworkProviders: activePhpFrameworkProviders };
        const declaringClassName =
          phpReceiverExpressionTypeInSource(
            source,
            position,
            receiverExpression,
            semanticOptions,
          ) ?? traitThisContext.declaringClassName;
        const { workspaceSources } = currentPhpLaravelSourceContext();

        return phpMethodCompletionsFromSource(
          traitThisContext.memberSource,
          declaringClassName,
          {
            frameworkProviders: activePhpFrameworkProviders,
            frameworkSourceContext:
              workspaceSources.length > 0 ? { workspaceSources } : undefined,
          },
        );
      }

      const resolvedReceiverType = await resolvePhpExpressionType(
        source,
        position,
        receiverExpression,
      );
      const receiverMethods = resolvedReceiverType
        ? await collectPhpMethodsForClass(resolvedReceiverType)
        : [];
      const builderModelType = await resolvePhpEloquentBuilderModelType(
        source,
        position,
        receiverExpression,
      );
      const receiverModelType =
        !builderModelType && isLaravelFrameworkActive && resolvedReceiverType
          ? phpLaravelResolvedModelTypeCandidate(source, resolvedReceiverType)
          : null;
      const localScopeModelType = builderModelType ?? receiverModelType;
      const localScopeSourceMethods =
        localScopeModelType && localScopeModelType === resolvedReceiverType
          ? receiverMethods
          : localScopeModelType
            ? await collectPhpMethodsForClass(localScopeModelType)
            : [];
      const localScopeMethods = localScopeModelType
        ? phpLaravelLocalScopeCompletionsFromMethods(
            localScopeSourceMethods,
          )
        : [];
      const dynamicWhereMethods = builderModelType
        ? await collectPhpLaravelDynamicWhereMethodsForClass(builderModelType)
        : [];

      // When the receiver is the model itself, its own members include the raw
      // scope source methods (`scopeX` / `#[Scope]`) that `localScopeMethods`
      // already represents as canonical `kind: "scope"` completions. Drop the
      // raw sources so each scope surfaces once, in its own category. Elsewhere
      // we still strip bare `#[Scope]` source methods (which carry no derived
      // replacement here) so they never leak as raw members.
      const receiverMethodsForMerge =
        localScopeModelType && localScopeModelType === resolvedReceiverType
          ? receiverMethods.filter(
              (method) => !isPhpLaravelLocalScopeSourceMethod(method),
            )
          : receiverMethods.filter((method) => method.kind !== "scope");

      return mergePhpMethodCompletions(
        receiverMethodsForMerge,
        localScopeMethods,
        dynamicWhereMethods,
      );
    },
    [
      activePhpFrameworkProviders,
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
      currentPhpLaravelSourceContext,
      isLaravelFrameworkActive,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
    ],
  );

  const resolvePhpStaticMethodCompletions = useCallback(
    async (
      source: string,
      className: string,
    ): Promise<PhpMethodCompletion[]> => {
      const resolvedClassName = resolvePhpClassReference(source, className);

      if (!resolvedClassName) {
        return [];
      }

      const facadeTargetClassName = isLaravelFrameworkActive
        ? laravelFacadeTargetClassName(resolvedClassName)
        : null;
      const methods = await collectPhpMethodsForClass(
        facadeTargetClassName ?? resolvedClassName,
      );

      if (isLaravelFrameworkActive && facadeTargetClassName) {
        return methods;
      }

      const dynamicWhereMethods =
        await collectPhpLaravelDynamicWhereMethodsForClass(resolvedClassName, {
          isStatic: true,
        });
      const isLaravelModelStaticAccess =
        isLaravelFrameworkActive &&
        phpLaravelResolvedModelTypeCandidate(source, resolvedClassName);
      const baseMethods = isLaravelModelStaticAccess
        ? phpLaravelStaticModelMemberCompletionsFromMethods(methods)
        : methods.filter((method) => method.isStatic);

      return mergePhpMethodCompletions(
        baseMethods,
        isLaravelFrameworkActive
          ? phpLaravelStaticLocalScopeCompletionsFromMethods(methods)
          : [],
        dynamicWhereMethods,
      );
    },
    [
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
    ],
  );

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

      const namedRouteContext = phpFrameworkRouteReferenceAt(
        source,
        position,
        activePhpFrameworkProviders,
      );

      if (namedRouteContext && activeDocument) {
        const normalizedPrefix = namedRouteContext.prefix.toLowerCase();
        const routes = await collectPhpLaravelNamedRouteTargets(
          source,
          activeDocument.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        return routes
          .filter((route) =>
            route.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((route) => ({
            declaringClassName: route.relativePath ?? getFileName(route.path),
            insertText: phpNamedRouteCompletionInsertText(
              route.name,
              namedRouteContext.prefix,
            ),
            kind: "route",
            name: route.name,
            parameters: "",
            returnType: null,
          }));
      }

      const translationContext = phpFrameworkTranslationReferenceAt(
        source,
        position,
        activePhpFrameworkProviders,
      );

      if (translationContext && activeDocument) {
        const normalizedPrefix = translationContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelTranslationTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.key.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: target.relativePath.endsWith(".json")
              ? phpLaravelJsonTranslationCompletionInsertText(
                  target.key,
                  translationContext.prefix,
                )
              : phpLaravelTranslationCompletionInsertText(
                  target.key,
                  translationContext.prefix,
                ),
            kind: "translation",
            name: target.key,
            parameters: "",
            returnType: null,
          }));
      }

      const envContext = phpLaravelEnvReferenceContextAt(source, position);

      if (isLaravelFrameworkActive && envContext && activeDocument) {
        const normalizedPrefix = envContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelEnvTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelEnvCompletionInsertText(target.name),
            kind: "env",
            name: target.name,
            parameters: "",
            returnType: null,
          }));
      }

      const configContext = phpFrameworkConfigReferenceAt(
        source,
        position,
        activePhpFrameworkProviders,
      );

      if (configContext && activeDocument) {
        const normalizedPrefix = configContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelConfigTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.key.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelConfigCompletionInsertText(
              target.key,
              configContext.prefix,
            ),
            kind: "config",
            name: target.key,
            parameters: "",
            returnType: null,
          }));
      }

      const gateAbilityContext = phpLaravelGateAbilityReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && gateAbilityContext && activeDocument) {
        const normalizedPrefix = gateAbilityContext.prefix.toLowerCase();
        const abilities = await collectPhpLaravelGateAbilityTargets(
          source,
          activeDocument.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        return abilities
          .filter((ability) =>
            ability.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((ability) => ({
            declaringClassName: ability.relativePath ?? getFileName(ability.path),
            insertText: phpLaravelGateAbilityCompletionInsertText(ability.name),
            kind: "config",
            name: ability.name,
            parameters: "",
            returnType: null,
          }));
      }

      const middlewareAliasContext = phpLaravelMiddlewareAliasReferenceContextAt(
        source,
        position,
      );

      if (
        isLaravelFrameworkActive &&
        middlewareAliasContext &&
        !middlewareAliasContext.aliasParameterStarted &&
        activeDocument
      ) {
        const normalizedPrefix = middlewareAliasContext.alias.toLowerCase();
        const aliases = await collectPhpLaravelMiddlewareAliasTargets(
          source,
          activeDocument.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        return aliases
          .filter((alias) =>
            alias.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((alias) => ({
            declaringClassName: alias.relativePath ?? getFileName(alias.path),
            insertText: phpLaravelMiddlewareAliasCompletionInsertText(
              alias.name,
            ),
            kind: "config",
            name: alias.name,
            parameters: "",
            returnType: null,
          }));
      }

      const authGuardContext = phpLaravelAuthGuardReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && authGuardContext && activeDocument) {
        const normalizedPrefix = authGuardContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelAuthGuardTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.guardName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelAuthGuardCompletionInsertText(
              target.guardName,
            ),
            kind: "config",
            name: target.guardName,
            parameters: "",
            returnType: null,
          }));
      }

      const cacheStoreContext = phpLaravelCacheStoreReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && cacheStoreContext && activeDocument) {
        const normalizedPrefix = cacheStoreContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelCacheStoreTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.storeName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelCacheStoreCompletionInsertText(
              target.storeName,
            ),
            kind: "config",
            name: target.storeName,
            parameters: "",
            returnType: null,
          }));
      }

      const databaseConnectionContext =
        phpLaravelDatabaseConnectionReferenceContextAt(source, position);

      if (
        isLaravelFrameworkActive &&
        databaseConnectionContext &&
        activeDocument
      ) {
        const normalizedPrefix =
          databaseConnectionContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelDatabaseConnectionTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.connectionName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelDatabaseConnectionCompletionInsertText(
              target.connectionName,
            ),
            kind: "config",
            name: target.connectionName,
            parameters: "",
            returnType: null,
          }));
      }

      const broadcastConnectionContext =
        phpLaravelBroadcastConnectionReferenceContextAt(source, position);

      if (
        isLaravelFrameworkActive &&
        broadcastConnectionContext &&
        activeDocument
      ) {
        const normalizedPrefix =
          broadcastConnectionContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelBroadcastConnectionTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.connectionName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelBroadcastConnectionCompletionInsertText(
              target.connectionName,
            ),
            kind: "config",
            name: target.connectionName,
            parameters: "",
            returnType: null,
          }));
      }

      const queueConnectionContext =
        phpLaravelQueueConnectionReferenceContextAt(source, position);

      if (isLaravelFrameworkActive && queueConnectionContext && activeDocument) {
        const normalizedPrefix = queueConnectionContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelQueueConnectionTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.connectionName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelQueueConnectionCompletionInsertText(
              target.connectionName,
            ),
            kind: "config",
            name: target.connectionName,
            parameters: "",
            returnType: null,
          }));
      }

      const redisConnectionContext =
        phpLaravelRedisConnectionReferenceContextAt(source, position);

      if (isLaravelFrameworkActive && redisConnectionContext && activeDocument) {
        const normalizedPrefix =
          redisConnectionContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelRedisConnectionTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.connectionName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelRedisConnectionCompletionInsertText(
              target.connectionName,
            ),
            kind: "config",
            name: target.connectionName,
            parameters: "",
            returnType: null,
          }));
      }

      const mailMailerContext = phpLaravelMailMailerReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && mailMailerContext && activeDocument) {
        const normalizedPrefix = mailMailerContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelMailMailerTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.mailerName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelMailMailerCompletionInsertText(
              target.mailerName,
            ),
            kind: "config",
            name: target.mailerName,
            parameters: "",
            returnType: null,
          }));
      }

      const passwordBrokerContext = phpLaravelPasswordBrokerReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && passwordBrokerContext && activeDocument) {
        const normalizedPrefix = passwordBrokerContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelPasswordBrokerTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.brokerName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelPasswordBrokerCompletionInsertText(
              target.brokerName,
            ),
            kind: "config",
            name: target.brokerName,
            parameters: "",
            returnType: null,
          }));
      }

      const logChannelContext = phpLaravelLogChannelReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && logChannelContext && activeDocument) {
        const normalizedPrefix = logChannelContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelLogChannelTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.channelName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelLogChannelCompletionInsertText(
              target.channelName,
            ),
            kind: "config",
            name: target.channelName,
            parameters: "",
            returnType: null,
          }));
      }

      const storageDiskContext = phpLaravelStorageDiskReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && storageDiskContext && activeDocument) {
        const normalizedPrefix = storageDiskContext.prefix.toLowerCase();
        const targets = await collectPhpLaravelStorageDiskTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return targets
          .filter((target) =>
            target.diskName.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((target) => ({
            declaringClassName: target.relativePath,
            insertText: phpLaravelStorageDiskCompletionInsertText(
              target.diskName,
            ),
            kind: "config",
            name: target.diskName,
            parameters: "",
            returnType: null,
          }));
      }

      const viewContext = phpFrameworkViewReferenceAt(
        source,
        position,
        activePhpFrameworkProviders,
      );

      if (viewContext && activeDocument) {
        const normalizedPrefix = viewContext.prefix.toLowerCase();
        const views = await collectPhpLaravelViewTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        return views
          .filter((view) => view.name.toLowerCase().startsWith(normalizedPrefix))
          .slice(0, 80)
          .map((view) => ({
            declaringClassName: view.relativePath,
            insertText: phpLaravelViewCompletionInsertText(
              view.name,
              viewContext.prefix,
            ),
            kind: "view",
            name: view.name,
            parameters: "",
            returnType: null,
          }));
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
        void ensurePhpLaravelMigrationSourcesLoaded(requestedRoot);
        void ensurePhpLaravelProviderSourcesLoaded(requestedRoot);
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
      collectPhpLaravelAuthGuardTargets,
      collectPhpLaravelCacheStoreTargets,
      collectPhpLaravelBroadcastConnectionTargets,
      collectPhpLaravelConfigTargets,
      collectPhpLaravelDatabaseConnectionTargets,
      collectPhpLaravelEnvTargets,
      collectPhpLaravelLogChannelTargets,
      collectPhpLaravelMailMailerTargets,
      collectPhpLaravelPasswordBrokerTargets,
      collectPhpLaravelQueueConnectionTargets,
      collectPhpLaravelRedisConnectionTargets,
      collectPhpLaravelStorageDiskTargets,
      collectPhpLaravelTranslationTargets,
      collectPhpLaravelRelationCompletionsForClass,
      collectPhpLaravelNamedRouteTargets,
      collectPhpLaravelGateAbilityTargets,
      collectPhpLaravelMiddlewareAliasTargets,
      collectPhpLaravelViewTargets,
      collectPhpMethodsForClass,
      activeDocument,
      activePhpFrameworkProviders,
      ensurePhpLaravelMigrationSourcesLoaded,
      ensurePhpLaravelProviderSourcesLoaded,
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

  const providePhpMethodSignature = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodSignature | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return null;
      }

      const signatureContext = phpMethodSignatureContextAt(source, position);

      if (!signatureContext) {
        return null;
      }

      const methods = signatureContext.className
        ? await resolvePhpStaticMethodCompletions(source, signatureContext.className)
        : signatureContext.receiverExpression
          ? await resolvePhpReceiverMethodCompletions(
              source,
              position,
              signatureContext.receiverExpression,
            )
          : [];

      if (!isRequestedRootActive()) {
        return null;
      }

      const method = methods.find(
        (candidate) =>
          candidate.name.toLowerCase() ===
          signatureContext.methodName.toLowerCase(),
      );

      if (!method) {
        return null;
      }

      const parameters = phpMethodParameters(method.parameters);
      const namedArgumentIndex = signatureContext.argumentName
        ? parameters.findIndex(
            (parameter) => parameter.name === `$${signatureContext.argumentName}`,
          )
        : -1;

      return {
        argumentIndex:
          namedArgumentIndex >= 0
            ? namedArgumentIndex
            : signatureContext.argumentIndex,
        method: phpMethodCompletionWithStableMetadata(method),
        parameters,
      };
    },
    [
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    ],
  );

  const providePhpParameterInlayHints = useCallback(
    async (
      source: string,
      range: { endLine: number; startLine: number },
    ): Promise<PhpParameterNameInlayHint[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const calls = phpCallArgumentInlayContexts(source, range);

      if (calls.length === 0) {
        return [];
      }

      // Cap the calls resolved per viewport so a dense file does not fan out an
      // unbounded number of signature resolutions on every scroll.
      const hints: PhpParameterNameInlayHint[] = [];

      for (const call of calls.slice(0, PHP_INLAY_HINT_CALL_LIMIT)) {
        const firstArgument = call.arguments[0];

        if (!firstArgument) {
          continue;
        }

        // Reuse the signature-resolution flow by probing a position inside the
        // call's argument list; it resolves method / static / receiver targets
        // (free functions resolve to null, so they yield no hint).
        const signature = await providePhpMethodSignature(source, {
          column: firstArgument.character + 1,
          lineNumber: firstArgument.line + 1,
        });

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!signature) {
          continue;
        }

        hints.push(...phpParameterNameInlayHints(call, signature.parameters));
      }

      return hints;
    },
    [providePhpMethodSignature, workspaceRoot],
  );

  const collectPhpAbstractMembersToImplement = useCallback(
    async (
      source: string,
      isRequestedRootActive: () => boolean,
    ): Promise<{
      abstractMembers: Map<string, AbstractMemberToImplement>;
      satisfiedNames: Set<string>;
    } | null> => {
      const abstractMembers = new Map<string, AbstractMemberToImplement>();
      const satisfiedNames = new Set<string>();
      const visitedClassNames = new Set<string>();

      const collectSuperType = async (
        ownerSource: string,
        reference: string,
      ): Promise<boolean> => {
        const resolvedClassName = resolvePhpClassName(ownerSource, reference);

        if (!resolvedClassName) {
          return true;
        }

        const normalizedClassName = resolvedClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return true;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const structure = parsePhpClassStructure(
              content,
              shortPhpName(normalizedClassName),
            );

            for (const method of structure.methods) {
              const memberKey = method.name.toLowerCase();

              if (method.isAbstract) {
                if (!abstractMembers.has(memberKey)) {
                  abstractMembers.set(memberKey, {
                    declaringSource: content,
                    member: method,
                  });
                }

                continue;
              }

              satisfiedNames.add(memberKey);
            }

            for (const superTypeReference of phpSuperTypeReferences(content)) {
              if (!(await collectSuperType(content, superTypeReference))) {
                return false;
              }
            }

            return true;
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return true;
      };

      for (const reference of phpSuperTypeReferences(source)) {
        if (!(await collectSuperType(source, reference))) {
          return null;
        }
      }

      return { abstractMembers, satisfiedNames };
    },
    [readNavigationFileContent, resolvePhpClassSourcePaths],
  );

  // Walks the PARENT CLASS CHAIN of `source` (the `extends` target, then its
  // own parent, …) collecting the concrete methods that the current class may
  // override (PhpStorm "Override Methods"). A method is overridable when it is
  // non-abstract, non-final, non-private and not the constructor. The nearest
  // declaration of a given name wins, so once a name is seen it is not re-added
  // from a more-distant ancestor (matching real override resolution); a name
  // declared `final` / `private` / `abstract` anywhere in the chain is recorded
  // so deeper ancestors cannot resurface it. Per-workspace isolation: the
  // caller's `isRequestedRootActive` guard is re-checked after EVERY await and
  // the walk is abandoned (returns `null`) the moment the requested root is no
  // longer active, so stale cross-file results never leak into another tab.
  const collectPhpOverridableParentMethods = useCallback(
    async (
      source: string,
      isRequestedRootActive: () => boolean,
    ): Promise<Map<string, AbstractMemberToImplement> | null> => {
      const overridableMembers = new Map<string, AbstractMemberToImplement>();
      const seenMemberNames = new Set<string>();
      const visitedClassNames = new Set<string>();

      const collectParent = async (
        ownerSource: string,
        reference: string,
      ): Promise<boolean> => {
        const resolvedClassName = resolvePhpClassName(ownerSource, reference);

        if (!resolvedClassName) {
          return true;
        }

        const normalizedClassName = resolvedClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return true;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const structure = parsePhpClassStructure(
              content,
              shortPhpName(normalizedClassName),
            );

            for (const method of structure.methods) {
              const memberKey = method.name.toLowerCase();

              if (seenMemberNames.has(memberKey)) {
                continue;
              }

              seenMemberNames.add(memberKey);

              if (!isPhpOverridableParentMethod(method)) {
                continue;
              }

              overridableMembers.set(memberKey, {
                declaringSource: content,
                member: method,
              });
            }

            const parentReference = phpExtendsClassName(content);

            if (parentReference) {
              return collectParent(content, parentReference);
            }

            return true;
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return true;
      };

      const parentReference = phpExtendsClassName(source);

      if (!parentReference) {
        return overridableMembers;
      }

      if (!(await collectParent(source, parentReference))) {
        return null;
      }

      return overridableMembers;
    },
    [readNavigationFileContent, resolvePhpClassSourcePaths],
  );

  const createMissingBladeViewCodeAction = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange,
      language: "blade" | "php",
      isRequestedRootActive: () => boolean,
    ): Promise<PhpCodeActionDescriptor | null> => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot || !isLaravelFrameworkActive) {
        return null;
      }

      const viewTargets = await collectPhpLaravelViewTargets();

      if (!isRequestedRootActive()) {
        return null;
      }

      const missing = missingLaravelViewReferenceAt(
        source,
        range.start,
        language,
        viewTargets.map((target) => target.name),
      );

      if (!missing) {
        return null;
      }

      const path = joinWorkspacePath(requestedRoot, missing.relativePath);
      const existing = await readTestFileIfExists(path);

      if (!isRequestedRootActive() || existing !== null) {
        return null;
      }

      return {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "",
          path,
          title: "Create Blade View",
        },
        title: `Create Blade view ${missing.name}`,
      };
    },
    [
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  // Builds the PhpStorm "Create class X" quick fix from a referenced-but-missing
  // type under the cursor. Conservative: offered only when the reference is NOT
  // already imported-and-resolvable, NOT a PHP built-in, the resolved FQN maps
  // to a project PSR-4 destination (uncertain destination -> no offer), the
  // resolved class does NOT already exist on disk, and the target file is not
  // already present. Cross-file probes make it async; the requested root is
  // re-checked after every await so a tab switch mid-flight drops the offer
  // (per-workspace isolation). Returns an action that WRITES the skeleton file
  // (via `newFile` -> applyPhpCodeActionNewFile) with NO in-document edit.
  const phpCreateClassCodeAction = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange,
      isRequestedRootActive: () => boolean,
    ): Promise<PhpCodeActionDescriptor | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const reference = detectUnknownClassReference(source, range.start);

      if (!reference) {
        return null;
      }

      const fqn = resolvePhpClassName(source, reference.reference);

      if (!fqn || isPhpBuiltinTypeName(fqn)) {
        return null;
      }

      const destination = phpCreateClassDestination(
        requestedRoot,
        requestedDescriptor.php.psr4Roots,
        VENDOR_PSR4_PREFIXES,
        fqn,
      );

      if (!destination) {
        return null;
      }

      // The class must not already exist. `resolvePhpClassSourcePaths` returns
      // best-guess PSR-4 candidate paths that may NOT exist on disk, so each
      // candidate is verified with a real read before it counts as "exists" -
      // otherwise the deterministic guess (the destination itself) would always
      // suppress the offer. A single existing path means the class is already
      // defined somewhere, so nothing is created.
      const candidatePaths = await resolvePhpClassSourcePaths(fqn);

      if (!isRequestedRootActive()) {
        return null;
      }

      for (const candidatePath of candidatePaths) {
        const existingSource = await readTestFileIfExists(candidatePath);

        if (!isRequestedRootActive()) {
          return null;
        }

        if (existingSource !== null) {
          return null;
        }
      }

      // The destination file itself must not already exist (a different class in
      // the expected file, or a race) - never overwrite. (Covered by the loop
      // above when the destination is among the candidates, but re-checked here
      // so a non-candidate destination is still guarded.)
      const existingTarget = await readTestFileIfExists(destination.path);

      if (!isRequestedRootActive()) {
        return null;
      }

      if (existingTarget !== null) {
        return null;
      }

      const shortName = fqn.slice(fqn.lastIndexOf("\\") + 1);
      const skeleton = renderPhpTypeSkeleton(
        reference.kind,
        shortName,
        destination.namespace,
      );

      return {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: { content: skeleton, path: destination.path },
        title: `Create ${reference.kind} ${shortName}`,
      };
    },
    [
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const providePhpCodeActions = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange = { end: 0, start: 0 },
    ): Promise<PhpCodeActionDescriptor[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const actions: PhpCodeActionDescriptor[] = [];

      // "Remove unused import" pairs with the unused-import inspection. It is a
      // single-line deletion valid anywhere a top-level `use` sits (not only in
      // a class), so it runs before the class-only guard below. Offered only
      // when the cursor is on a conservatively-detected unused class import.
      const removeUnusedImportAction = phpRemoveUnusedImportCodeAction(
        source,
        range,
      );

      if (removeUnusedImportAction) {
        actions.push(removeUnusedImportAction);
      }

      // "Remove unused variable" pairs with the unused-variable inspection. A
      // local assignment can sit in a class method OR a free function, and the
      // action is offered only for a side-effect-free assignment, so it runs
      // before the class-only guard below.
      const removeUnusedVariableAction = phpRemoveUnusedVariableCodeAction(
        source,
        range,
      );

      if (removeUnusedVariableAction) {
        actions.push(removeUnusedVariableAction);
      }

      // "Extract variable" is a pure single-file synthesis from the current
      // selection and is valid anywhere a PHP expression sits (class body or a
      // free function), so it runs before the class-only guard below.
      const extractVariableAction = phpExtractVariableCodeAction(source, range);

      if (extractVariableAction) {
        actions.push(extractVariableAction);
      }

      // "Inline variable" is the inverse of "Extract variable": from the cursor
      // on a single-assignment local it deletes the declaration and substitutes
      // the value at every usage. Like extract it is a pure single-file
      // synthesis valid in a class body or a free function, so it runs before
      // the class-only guard below.
      const inlineVariableAction = phpInlineVariableCodeAction(source, range);

      if (inlineVariableAction) {
        actions.push(inlineVariableAction);
      }

      // "Add parameter" (Change Signature - slice 1) appends an optional
      // placeholder parameter to the enclosing function's signature. It is a
      // pure single-file synthesis valid on a class method OR a free function,
      // so it runs before the class-only guard below.
      const addParameterAction = phpAddParameterCodeAction(source, range);

      if (addParameterAction) {
        actions.push(addParameterAction);
      }

      // "Add return type" / "Add type hint" (PhpStorm Alt+Enter) conservatively
      // infer a missing return type / parameter type and insert it. Both are
      // pure single-file additive insertions valid on a class method OR a free
      // function (and, for the return type, an abstract / interface
      // declaration), so they run before the class-only guard below.
      const addReturnTypeAction = phpAddReturnTypeCodeAction(source, range);

      if (addReturnTypeAction) {
        actions.push(addReturnTypeAction);
      }

      const addParameterTypeAction = phpAddParameterTypeCodeAction(
        source,
        range,
      );

      if (addParameterTypeAction) {
        actions.push(addParameterTypeAction);
      }

      // "Create class X" (PhpStorm Alt+Enter) when the cursor sits on a
      // referenced-but-unresolved class/interface/trait/enum (`new X()`,
      // `X::method()`/`X::CONST`, a type hint / return type, `extends`/
      // `implements`, `catch (X $e)`). It WRITES a new PSR-4 file with a minimal
      // skeleton, so it runs before the class-only guard (a reference may sit in
      // a class header type position OR a free function). The build is async
      // (existence probes) and re-checks the requested root after every await so
      // a tab switch mid-flight drops a stale offer (per-workspace isolation).
      const createClassAction = await phpCreateClassCodeAction(
        source,
        range,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createClassAction) {
        actions.push(createClassAction);
      }

      const createMissingViewAction = await createMissingBladeViewCodeAction(
        source,
        range,
        "php",
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createMissingViewAction) {
        actions.push(createMissingViewAction);
      }

      if (phpCurrentTypeKind(source) !== "class") {
        // Free-function context: only the pre-class-guard refactors are offered.
        // Order them like the class path so the list stays "most likely first".
        return orderPhpCodeActions(actions);
      }

      const structure = parsePhpClassStructure(source);

      // "Create method / property from usage" is a pure single-file synthesis
      // from the cursor offset; offered only when the cursor sits on an
      // unresolved `$this->member` usage inside the class.
      const createFromUsageAction = phpCreateFromUsageCodeAction(source, range);

      if (createFromUsageAction) {
        actions.push(createFromUsageAction);
      }

      // "Remove unused method" pairs with the unused-private-method inspection.
      // Offered only when the cursor sits on a conservatively-detected unused
      // private method; deletes the whole method (and its decorating lines).
      const removeUnusedMethodAction = phpRemoveUnusedMethodCodeAction(
        source,
        range,
      );

      if (removeUnusedMethodAction) {
        actions.push(removeUnusedMethodAction);
      }

      // "Extract method" lifts a contiguous, whole-statement selection inside a
      // class method into a new private method and replaces it with a call. It
      // is a pure single-file synthesis from the selection; the conservative
      // planner returns null whenever the extraction could change behaviour.
      const extractMethodAction = phpExtractMethodCodeAction(source, range);

      if (extractMethodAction) {
        actions.push(extractMethodAction);
      }

      // "Extract interface" (PhpStorm) synthesises a sibling
      // `<Class>Interface.php` from the class's public instance methods and adds
      // an `implements` clause to the class. It needs the active document's
      // path to place the new file (PSR-4 sibling), so it is keyed off
      // `activeDocument`. The conservative planner returns null for anything but
      // a plain class with public instance methods.
      const extractInterfaceAction = phpExtractInterfaceCodeAction(
        source,
        range,
        activeDocument?.path ?? null,
      );

      if (extractInterfaceAction?.newFile) {
        const existingInterface = await readTestFileIfExists(
          extractInterfaceAction.newFile.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        if (existingInterface === null) {
          actions.push(extractInterfaceAction);
        }
      }

      // "Introduce constant / field" are pure single-file syntheses keyed off the
      // cursor offset on a scalar literal (or a local variable for the field).
      // Both insert at the top of the class body and replace the original token.
      const introduceConstantAction = phpIntroduceConstantCodeAction(
        source,
        range,
      );

      if (introduceConstantAction) {
        actions.push(introduceConstantAction);
      }

      const introduceFieldAction = phpIntroduceFieldCodeAction(source, range);

      if (introduceFieldAction) {
        actions.push(introduceFieldAction);
      }

      const implementMethodsAction = await phpImplementMethodsCodeAction(
        source,
        structure,
        collectPhpAbstractMembersToImplement,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (implementMethodsAction) {
        actions.push(implementMethodsAction);
      }

      const overrideMethodsAction = await phpOverrideMethodsCodeAction(
        source,
        structure,
        collectPhpOverridableParentMethods,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (overrideMethodsAction) {
        actions.push(overrideMethodsAction);
      }

      const accessorsAction = phpGenerateAccessorsCodeAction(source, structure);

      if (accessorsAction) {
        actions.push(accessorsAction);
      }

      const constructorAction = phpGenerateConstructorCodeAction(
        source,
        structure,
      );

      if (constructorAction) {
        actions.push(constructorAction);
      }

      const constructorWithPromotionAction =
        phpGenerateConstructorWithPromotionCodeAction(source, structure);

      if (constructorWithPromotionAction) {
        actions.push(constructorWithPromotionAction);
      }

      const generatePhpDocAction = phpGeneratePhpDocCodeAction(
        source,
        structure,
        range,
      );

      if (generatePhpDocAction) {
        actions.push(generatePhpDocAction);
      }

      const optimizeImportsAction = phpOptimizeImportsCodeAction(source);

      if (optimizeImportsAction) {
        actions.push(optimizeImportsAction);
      }

      // "Import class" (PhpStorm Alt+Enter -> Import): when the cursor sits on an
      // unimported, unqualified class reference, look the short name up in the
      // workspace symbol index and offer a `use FQN;` insertion per candidate
      // namespace. Indexed-only (the index is per-root); the requested root is
      // re-checked after the async search and before mutating `actions` so a tab
      // switch mid-search drops stale results (per-workspace isolation).
      const importShortName = phpImportClassShortNameAt(source, range);

      if (importShortName && shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          importShortName,
          25,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const candidateFqns = indexedSymbols
          .filter(isTypeProjectSymbol)
          .filter(
            (symbol) =>
              symbol.name.toLowerCase() === importShortName.toLowerCase(),
          )
          .map((symbol) => symbol.fullyQualifiedName);

        for (const importAction of phpImportClassCodeActions(
          source,
          candidateFqns,
        )) {
          actions.push(importAction);
        }
      }

      return orderPhpCodeActions(actions);
    },
    [
      activeDocument?.path,
      collectPhpAbstractMembersToImplement,
      collectPhpOverridableParentMethods,
      createMissingBladeViewCodeAction,
      intelligenceMode,
      phpCreateClassCodeAction,
      projectSymbolSearch,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  // Resolves a PHP class name (e.g. `App\Models\User`) to a navigation target:
  // the indexed-symbol position when the workspace is indexed, otherwise the
  // class declaration line in the first existing PSR-4 candidate file. Returns
  // false (no navigation) when the class cannot be resolved. Carries the
  // per-workspace isolation guards (requested-root capture + re-check after each
  // await) so stale results are dropped on tab switch. Declared before its
  // callers (providePhpLaravelDefinition) so the useCallback reference is
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

  // Navigates a Laravel job / listener class reference to its entry method:
  // `handle()` (jobs and most listeners), then `__invoke()` (single-action
  // listeners), then the class declaration as a last resort (via
  // openPhpClassTarget). Resolves the class file with resolvePhpClassSourcePaths
  // and looks up the method line directly; both this callback and the helpers it
  // reuses capture the requested root and re-check it after each await so a tab
  // switch mid-resolution drops stale results (per-workspace isolation).
  const openPhpLaravelHandlerTarget = useCallback(
    async (className: string, shortName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(className)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        let content: string;

        try {
          content = await readNavigationFileContent(path);
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        const methodPosition =
          phpMethodPositionOrNull(content, "handle") ??
          phpMethodPositionOrNull(content, "__invoke");

        if (!methodPosition) {
          continue;
        }

        return openNavigationTarget(path, methodPosition, `${shortName}`);
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openPhpClassTarget(className, shortName);
    },
    [
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceRoot,
    ],
  );

  // Resolves the listeners registered for an event in the project's
  // EventServiceProvider `$listen` map and navigates to the FIRST resolvable
  // listener's handler. The editor opens files through its own single-model tab
  // system, so it navigates to one target rather than surfacing a Monaco
  // multi-location picker. Per-workspace isolation: the requested root is
  // captured up front and re-checked after every file read (provider + each
  // listener resolution) so a tab switch mid-resolution drops stale results.
  const goToPhpLaravelEventListenerDefinition = useCallback(
    async (eventClassName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedEventClassName = eventClassName.toLowerCase();
      const listenerClassNames: string[] = [];

      for (const providerClassName of phpEventServiceProviderClassNames(
        requestedDescriptor.php,
      )) {
        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(providerClassName)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          let providerSource: string;

          try {
            providerSource = await readNavigationFileContent(path);
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }

          if (!isRequestedRootActive()) {
            return false;
          }

          const listenerMap = phpLaravelEventListenerMap(providerSource);

          for (const [mappedEvent, listeners] of listenerMap) {
            const resolvedMappedEvent = resolvePhpClassName(
              providerSource,
              mappedEvent,
            );

            if (
              resolvedMappedEvent?.toLowerCase() !== normalizedEventClassName
            ) {
              continue;
            }

            for (const listener of listeners) {
              const resolvedListener = resolvePhpClassName(
                providerSource,
                listener,
              );

              if (resolvedListener) {
                listenerClassNames.push(resolvedListener);
              }
            }
          }
        }

        if (listenerClassNames.length > 0) {
          break;
        }
      }

      for (const listenerClassName of listenerClassNames) {
        if (!isRequestedRootActive()) {
          return false;
        }

        if (
          await openPhpLaravelHandlerTarget(
            listenerClassName,
            shortPhpName(listenerClassName),
          )
        ) {
          return true;
        }
      }

      return false;
    },
    [
      openPhpLaravelHandlerTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  // Orchestrates Cmd+Click navigation on a Laravel dispatch site:
  //   - `event(new X)` / `Event::dispatch(new X)` → X's registered listeners.
  //   - `dispatch(new X)` / `X::dispatchSync(...)` → X's `handle()` (the job).
  //   - bare `X::dispatch(...)` is ambiguous (jobs and events share the
  //     Dispatchable trait); resolve listeners first, fall back to job handle.
  const goToPhpLaravelDispatchDefinition = useCallback(
    async (
      source: string,
      target: PhpLaravelDispatchTarget,
    ): Promise<boolean> => {
      const resolvedClassName = resolvePhpClassName(source, target.className);

      if (!resolvedClassName) {
        return false;
      }

      const shortName = shortPhpName(resolvedClassName);

      if (target.kind === "event") {
        return goToPhpLaravelEventListenerDefinition(resolvedClassName);
      }

      if (target.kind === "job") {
        return openPhpLaravelHandlerTarget(resolvedClassName, shortName);
      }

      if (await goToPhpLaravelEventListenerDefinition(resolvedClassName)) {
        return true;
      }

      return openPhpLaravelHandlerTarget(resolvedClassName, shortName);
    },
    [goToPhpLaravelEventListenerDefinition, openPhpLaravelHandlerTarget],
  );

  const resolvePhpLaravelExplicitRouteModelBindingClassName = useCallback(
    async (
      currentSource: string,
      currentPath: string | null,
      parameterName: string,
    ): Promise<string | null> => {
      const localClassName = explicitLaravelRouteModelBindingClassName(
        currentSource,
        parameterName,
      );

      if (localClassName) {
        return resolvePhpClassName(currentSource, localClassName);
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !isRequestedRootActive()) {
        return null;
      }

      const searchResults = await Promise.all(
        ["Route::model", "Route::bind"].map((query) =>
          textSearch.searchText(requestedRoot, query, 100),
        ),
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set(currentPath ? [currentPath] : []);

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

          const className = explicitLaravelRouteModelBindingClassName(
            content,
            parameterName,
          );
          const resolvedClassName = className
            ? resolvePhpClassName(content, className)
            : null;

          if (resolvedClassName) {
            return resolvedClassName;
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      return null;
    },
    [readNavigationFileContent, textSearch, workspaceRoot],
  );

  // Powers Cmd+Click / native "Go to Definition" on Laravel global string-helper
  // literals (config / view / __ / trans / env / route). Monaco's definition provider
  // delegates here; because the editor opens files through its own tab system
  // (and limits native navigation to already-open models), this callback DOES
  // the navigation and resolves `true` when it handled the request — the
  // provider then returns null and Monaco does not also navigate. Detection
  // dispatches through the active framework provider's stringLiterals classifier
  // (phpFrameworkStringLiteralHelperAt); laravelPathResolution gates resolvability;
  // the proven per-helper finders perform the file read + key-line lookup and
  // carry the per-workspace isolation guards (requested-root capture +
  // re-check after each await), so stale results are dropped on tab switch.
  // Defense in depth: this callback ALSO captures the requested root up front
  // and re-checks it after each finder await (before openNavigationTarget) so a
  // tab switch mid-resolution can never navigate into a stale-workspace file.
  const providePhpLaravelDefinition = useCallback(
    async (source: string, offset: number): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      // Route model binding: a `{user}` segment in a `Route::<verb>` URI string
      // first checks static explicit bindings (`Route::model` / simple
      // `Route::bind` resolvers), then falls back to the implicit `User` Eloquent
      // model convention (Laravel Studly-cases the parameter name; it does NOT
      // singularise it). openPhpClassTarget carries the indexed-symbol lookup,
      // candidate-path resolution, and per-workspace isolation guards, and
      // navigates only when a class file exists — so an unresolvable parameter
      // conservatively does nothing. Detection runs before the string-helper
      // branch because a route URI literal is never a global helper argument.
      const routeBinding = isLaravelFrameworkActive
        ? detectLaravelRouteModelBindingAt(source, offset)
        : null;

      if (routeBinding) {
        const resolvedExplicitClassName =
          await resolvePhpLaravelExplicitRouteModelBindingClassName(
            source,
            activeDocument?.path ?? null,
            routeBinding.parameterName,
          );

        if (resolvedExplicitClassName) {
          if (!isRequestedRootActive()) {
            return false;
          }

          const handled = await openPhpClassTarget(
            resolvedExplicitClassName,
            shortPhpName(resolvedExplicitClassName),
          );

          if (handled) {
            return true;
          }
        }

        const modelNamespaces =
          phpModelNamespacePrefixes(workspaceDescriptor?.php);

        for (const namespace of modelNamespaces) {
          if (!isRequestedRootActive()) {
            return false;
          }

          const handled = await openPhpClassTarget(
            `${namespace}${routeBinding.modelShortName}`,
            routeBinding.modelShortName,
          );

          if (handled) {
            return true;
          }
        }

        return false;
      }

      // Job / Event dispatch navigation: `dispatch(new Job)` / `Job::dispatch()`
      // → the job's `handle()`; `event(new Event)` / `Event::dispatch(new X)`
      // → the event's registered listeners. Detection is pure; the resolution
      // helper carries the per-workspace isolation guards. Runs before the
      // string-helper branch because a dispatch site is never a string literal.
      // It also runs BEFORE the plain class-identifier branch so a dispatch site
      // navigates to handle()/listeners rather than the class declaration.
      const dispatchTarget = isLaravelFrameworkActive
        ? phpLaravelDispatchTargetAt(source, offset)
        : null;

      if (dispatchTarget) {
        if (!isRequestedRootActive()) {
          return false;
        }

        return goToPhpLaravelDispatchDefinition(source, dispatchTarget);
      }

      // Class / interface / trait / enum type reference (e.g. a
      // constructor-promoted property or parameter type-hint). The editor opens
      // files through its own tab system and limits native navigation to
      // already-open models, so phpactor locations for an unopened type file are
      // discarded — meaning Cmd+Click on a type would otherwise be dead. We
      // resolve the type with our deterministic use/namespace resolver and open
      // the declaration ourselves, returning `true` so Monaco does not also
      // navigate. This is framework-agnostic PHP, so it does NOT require
      // isLaravelFrameworkActive; it runs AFTER the Laravel route/dispatch
      // branches so those keep precedence over a plain class reference.
      // openPhpClassTarget carries the per-workspace isolation guards
      // (requested-root capture + re-check after each await); an unresolvable
      // type resolves to nothing and we fall through to the Laravel string-helper
      // branches / phpactor (conservative).
      const classIdentifierName = phpClassIdentifierNameAt(source, offset);

      if (classIdentifierName) {
        const resolvedClassName = resolvePhpClassName(
          source,
          classIdentifierName,
        );

        if (resolvedClassName) {
          const handledClassTarget = await openPhpClassTarget(
            resolvedClassName,
            classIdentifierName,
          );

          if (handledClassTarget) {
            return true;
          }
        }
      }

      // TODO(nette): this gate also covers the templating viewReference lookup below and
      // the per-helper branches resolve through Laravel-shaped targets. When the Nette
      // provider ships `templating` or `stringLiterals`, split the gate per capability
      // and route helper matches through provider-owned resolvers.
      if (!phpFrameworkSupportsStringLiterals(activePhpFrameworkProviders)) {
        return false;
      }

      const viewReference = phpFrameworkViewReferenceAt(
        source,
        editorPositionAtOffset(source, offset),
        activePhpFrameworkProviders,
      );

      if (viewReference) {
        const target = await findPhpLaravelViewTarget(viewReference.name);

        if (!isRequestedRootActive()) {
          return false;
        }

        return target
          ? openNavigationTarget(target.path, target.position, target.name)
          : false;
      }

      const match = phpFrameworkStringLiteralHelperAt(
        source,
        offset,
        activePhpFrameworkProviders,
      );

      if (!match) {
        return false;
      }

      if (match.helper === "config") {
        if (!resolveLaravelConfigTarget(match.literal)) {
          return false;
        }

        const target = await findPhpLaravelConfigTarget(match.literal);

        // Per-workspace isolation guard: drop the resolved target if the user
        // switched project tabs during the file read so we never navigate into
        // a stale-workspace file inside the now-active workspace.
        if (!isRequestedRootActive()) {
          return false;
        }

        return target
          ? openNavigationTarget(target.path, target.position, target.key)
          : false;
      }

      if (match.helper === "view") {
        if (!resolveLaravelViewTarget(match.literal)) {
          return false;
        }

        const target = await findPhpLaravelViewTarget(match.literal);

        if (!isRequestedRootActive()) {
          return false;
        }

        return target
          ? openNavigationTarget(target.path, target.position, target.name)
          : false;
      }

      if (match.helper === "trans") {
        if (!resolveLaravelTransTarget(match.literal)) {
          return false;
        }

        const target = await findPhpLaravelTranslationTarget(match.literal);

        if (!isRequestedRootActive()) {
          return false;
        }

        return target
          ? openNavigationTarget(target.path, target.position, target.key)
          : false;
      }

      if (match.helper === "env") {
        if (!resolveLaravelEnvTarget(match.literal)) {
          return false;
        }

        const target = await findPhpLaravelEnvTarget(match.literal);

        if (!isRequestedRootActive()) {
          return false;
        }

        return target
          ? openNavigationTarget(target.path, target.position, target.name)
          : false;
      }

      if (match.helper === "route") {
        if (!activeDocument) {
          return false;
        }

        const routes = await collectPhpLaravelNamedRouteTargets(
          activeDocument.content,
          activeDocument.path,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const target = routes.find(
          (route) => route.name.toLowerCase() === match.literal.toLowerCase(),
        );

        return target
          ? openNavigationTarget(target.path, target.position, target.name)
          : false;
      }

      return false;
    },
    [
      activeDocument,
      activePhpFrameworkProviders,
      collectPhpLaravelNamedRouteTargets,
      findPhpLaravelConfigTarget,
      findPhpLaravelEnvTarget,
      findPhpLaravelTranslationTarget,
      findPhpLaravelViewTarget,
      goToPhpLaravelDispatchDefinition,
      isLaravelFrameworkActive,
      openNavigationTarget,
      openPhpClassTarget,
      resolvePhpLaravelExplicitRouteModelBindingClassName,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

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

    const viewTargets = await collectPhpLaravelViewTargets();

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
    collectPhpLaravelViewTargets,
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

  // Walks the resolved class and its trait / mixin / supertype hierarchy for a
  // declared `const NAME` (or enum `case NAME`) and opens its declaration line.
  // Mirrors openDirectPhpPropertyTarget so an inherited constant resolves to the
  // ancestor that actually declares it. Captures the requested workspace root up
  // front and re-checks it after every await so a tab switch drops stale results.
  const openDirectPhpClassConstantTarget = useCallback(
    async (className: string, constantName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openConstantInClassHierarchy = async (
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

            const position = phpClassConstantPositionOrNull(content, constantName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              return openNavigationTarget(path, position, constantName);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openConstantInClassHierarchy(resolvedTraitName))
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
                (await openConstantInClassHierarchy(resolvedMixinName))
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
                (await openConstantInClassHierarchy(resolvedSuperTypeName))
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

      return openConstantInClassHierarchy(className);
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

  const openPhpLaravelDynamicWhereTarget = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          const target = phpLaravelDynamicWhereAttributeTargetFromSource(
            content,
            methodName,
          );

          if (!target) {
            continue;
          }

          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            path,
            target.position,
            target.attributeName,
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
      resolvePhpClassSourcePaths,
      isLaravelFrameworkActive,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openPhpLaravelModelAttributeTarget = useCallback(
    async (className: string, attributeName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          const target = phpLaravelModelAttributeTargetFromSource(
            content,
            attributeName,
          ) ?? phpLaravelModelAccessorTargetFromSource(content, attributeName);

          if (!target) {
            continue;
          }

          if (!isRequestedRootActive()) {
            return false;
          }

          return openNavigationTarget(
            path,
            target.position,
            target.attributeName,
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
      resolvePhpClassSourcePaths,
      isLaravelFrameworkActive,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  // Blade navigation + completion lives entirely in `useBladeIntelligence` (a
  // sibling strangler module): this mount only injects the collaborators; the
  // per-root view-data / component-name caches and their invalidation live in
  // the hook.
  const {
    provideBladeCodeActions,
    provideBladeCompletions,
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resetBladeIntelligenceCaches,
  } = useBladeIntelligence({
    activeDocument,
    activePhpFrameworkProviders,
    collectPhpLaravelConfigTargets,
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelTranslationTargets,
    collectPhpLaravelViewTargets,
    createMissingBladeViewCodeAction,
    currentWorkspaceRootRef,
    ensurePhpLaravelMigrationSourcesLoaded,
    ensurePhpLaravelProviderSourcesLoaded,
    findPhpLaravelConfigTarget,
    findPhpLaravelTranslationTarget,
    findPhpLaravelViewTarget,
    isLaravelFrameworkActive,
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
  });

  // Latte navigation + completion lives entirely in `useLatteIntelligence` (the
  // first strangler-pattern module): this mount only injects the collaborators.
  const {
    provideLatteDefinition,
    provideLatteCompletions,
    provideNettePhpLinkDefinition,
    provideNettePhpLinkCompletions,
  } = useLatteIntelligence({
    currentWorkspaceRootRef,
    getActiveDocument: () => activeDocumentRef.current,
    isNetteFrameworkActive,
    isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
    joinPath: joinWorkspacePath,
    listDirectory: (path) => workspaceFiles.readDirectory(path),
    openTarget: openNavigationTarget,
    readFileContent: readNavigationFileContent,
    resolveDeclaredType: resolvePhpDeclaredType,
    resolveExpressionType: resolvePhpExpressionType,
    resolvePhpReceiverCompletions: resolvePhpReceiverMethodCompletions,
    searchText: (root, query, maxResults) =>
      textSearch.searchText(root, query, maxResults),
    synthesizeTypedReceiverSource: bladeSyntheticPhpMemberAccessSource,
    toRelativePath: relativeWorkspacePath,
    workspaceRoot,
  });

  // NEON config navigation + completion lives in `useNeonIntelligence` (a sibling
  // strangler module): this mount only injects the collaborators. Class
  // resolution reuses `openPhpClassTarget` (the same index + PSR-4 resolver a PHP
  // class jump uses); completion class names come from the project symbol index.
  const { provideNeonDefinition, provideNeonCompletions } = useNeonIntelligence({
    currentWorkspaceRootRef,
    getActiveDocument: () => activeDocumentRef.current,
    isNetteFrameworkActive,
    isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
    joinPath: joinWorkspacePath,
    listDirectory: (path) => workspaceFiles.readDirectory(path),
    openClassTarget: (className) =>
      openPhpClassTarget(className, className.split("\\").pop() ?? className),
    openTarget: openNavigationTarget,
    readFileContent: readNavigationFileContent,
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
    toRelativePath: relativeWorkspacePath,
    workspaceRoot,
  });

  const goToPhpMethodCallDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "methodCall" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const variableType = context.variableName
        ? phpParameterTypeForVariable(
            activeDocument.content,
            position,
            context.variableName,
          )
        : null;
      const resolvedVariableType =
        receiverType ??
        (variableType
          ? resolvePhpClassName(activeDocument.content, variableType)
          : null);
      const frameworkHint = isLaravelFrameworkActive
        ? phpLaravelRequestMethodDefinition(
            resolvedVariableType,
            context.methodName,
          )
        : null;

      if (frameworkHint) {
        const hintTargetOpened = await openPhpMethodHintTarget(frameworkHint);

        return isRequestedRootActive() && hintTargetOpened;
      }

      if (resolvedVariableType) {
        const directTargetOpened = await openDirectPhpMethodTarget(
          resolvedVariableType,
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (directTargetOpened) {
          return true;
        }
      }

      const builderReceiverExpression =
        context.receiverExpression ||
        (context.variableName ? `$${context.variableName}` : null);
      const builderModelType = builderReceiverExpression
        ? await resolvePhpEloquentBuilderModelType(
            activeDocument.content,
            position,
            builderReceiverExpression,
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const builderScopeMethodName =
        isLaravelFrameworkActive && builderModelType
          ? phpLaravelScopeMethodName(context.methodName)
          : null;

      if (builderModelType && builderScopeMethodName) {
        const scopeTargetOpened = await openDirectPhpMethodTarget(
          builderModelType,
          builderScopeMethodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      if (builderModelType) {
        const dynamicWhereTargetOpened = await openPhpLaravelDynamicWhereTarget(
          builderModelType,
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (dynamicWhereTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No typed target found for ${context.receiverExpression}->${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      openPhpMethodHintTarget,
      isLaravelFrameworkActive,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      workspaceRoot,
    ],
  );

  const goToPhpMemberPropertyDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "memberPropertyAccess" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!receiverType) {
        setMessage(
          `No typed target found for ${context.receiverExpression}->${context.propertyName}.`,
        );
        return false;
      }

      const propertyExists = await phpClassHierarchyHasProperty(
        receiverType,
        context.propertyName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (propertyExists) {
        const methodTargetOpened = await openDirectPhpMethodTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (methodTargetOpened) {
          return true;
        }
      }

      if (propertyExists) {
        const attributeTargetOpened = await openPhpLaravelModelAttributeTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (attributeTargetOpened) {
          return true;
        }
      }

      // A plainly typed property (e.g. `private PostRepository $postRepository`)
      // navigates to its declared TYPE class, matching PhpStorm's "go to the
      // class the property holds" behaviour, before falling back to the property
      // declaration line. Eloquent relations and model attributes are handled by
      // the steps above (they return early), so this only fires for ordinary
      // class-typed properties. The property type is resolved through
      // resolvePhpExpressionType so private/protected/promoted/docblock-typed
      // properties all work; scalar/union-typed properties resolve to no class
      // FQCN and fall through to the declaration target below.
      if (propertyExists) {
        const propertyTypeClassName = await resolvePhpExpressionType(
          activeDocument.content,
          position,
          `${context.receiverExpression || `$${context.variableName}`}->${context.propertyName}`,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (propertyTypeClassName) {
          const typeClassOpened = await openPhpClassTarget(
            propertyTypeClassName,
            shortPhpName(propertyTypeClassName),
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (typeClassOpened) {
            return true;
          }
        }
      }

      if (propertyExists) {
        const propertyTargetOpened = await openDirectPhpPropertyTarget(
          receiverType,
          context.propertyName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (propertyTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No relation method found for ${receiverType}::${context.propertyName}().`,
      );
      return false;
    },
    [
      activeDocument,
      openDirectPhpPropertyTarget,
      openDirectPhpMethodTarget,
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
      phpClassHierarchyHasProperty,
      resolvePhpExpressionType,
      workspaceRoot,
    ],
  );

  const goToPhpStaticMethodCallDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "staticMethodCall" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      // resolvePhpClassReference (not resolvePhpClassName) so a `self::`,
      // `static::`, or `parent::method()` static call maps to the enclosing /
      // extended class. resolvePhpClassName treats `parent` as a literal type
      // name (`<namespace>\parent`) and never reaches the parent declaration,
      // so `parent::report()` / `parent::toImportFields()` go-to-definition
      // failed before falling through to phpactor.
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      const directTargetOpened = await openDirectPhpMethodTarget(
        className,
        context.methodName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (directTargetOpened) {
        return true;
      }

      const scopeMethodName = isLaravelFrameworkActive
        ? phpLaravelScopeMethodName(context.methodName)
        : null;

      if (scopeMethodName) {
        const scopeTargetOpened = await openDirectPhpMethodTarget(
          className,
          scopeMethodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (scopeTargetOpened) {
          return true;
        }
      }

      const dynamicWhereTargetOpened = await openPhpLaravelDynamicWhereTarget(
        className,
        context.methodName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (dynamicWhereTargetOpened) {
        return true;
      }

      if (
        isLaravelFrameworkActive &&
        isLaravelEloquentBuilderMethodName(context.methodName)
      ) {
        const builderTargetOpened = await openDirectPhpMethodTarget(
          "Illuminate\\Database\\Eloquent\\Builder",
          context.methodName,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (builderTargetOpened) {
          return true;
        }
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No typed target found for ${context.className}::${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      resolvePhpClassReference,
      workspaceRoot,
    ],
  );

  // Navigates a class constant / enum case access (`Class::CONST`,
  // `self::CONST`, `parent::CONST`) to its declaration. Resolves the receiver
  // with resolvePhpClassReference so self/static map to the enclosing class and
  // parent to the extended one, walks the hierarchy for the declaring const, and
  // falls back to the class declaration. Returns false (without a misleading
  // `()` message) so the phpactor fallback still runs when nothing is found.
  const goToPhpClassConstantDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "classConstant" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        !requestedRoot ||
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const className = resolvePhpClassReference(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      const constantTargetOpened = await openDirectPhpClassConstantTarget(
        className,
        context.constantName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (constantTargetOpened) {
        return true;
      }

      return openPhpClassTarget(className, context.className);
    },
    [
      activeDocument,
      openDirectPhpClassConstantTarget,
      openPhpClassTarget,
      resolvePhpClassReference,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelRelationStringDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelRelationString" }>,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !isLaravelFrameworkActive || !activeDocument) {
        return false;
      }

      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const staticClassName = context.className
        ? resolvePhpClassName(activeDocument.content, context.className)
        : null;
      const receiverModelType = context.receiverExpression
        ? await resolvePhpEloquentBuilderModelType(
            activeDocument.content,
            position,
            context.receiverExpression,
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const receiverType =
        !receiverModelType && context.receiverExpression
          ? await resolvePhpExpressionType(
              activeDocument.content,
              position,
              context.receiverExpression,
            )
          : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      const relationBaseOwnerType =
        staticClassName ?? receiverModelType ?? receiverType;
      const relationOwnerType = relationBaseOwnerType
        ? await resolvePhpLaravelRelationPathOwnerType(
            relationBaseOwnerType,
            context.previousRelationNames ?? [],
          )
        : null;

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!relationOwnerType) {
        setMessage(`No typed target found for relation ${context.relationName}.`);
        return false;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      const openedRelation = await openDirectPhpMethodTarget(
        relationOwnerType,
        context.relationName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (openedRelation) {
        return true;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      setMessage(
        `No relation method found for ${relationOwnerType}::${context.relationName}().`,
      );
      return false;
    },
    [
      activeDocument,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpLaravelRelationPathOwnerType,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelNamedRouteDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelNamedRouteString" }>,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !activeDocument ||
        !phpFrameworkSupportsRoutes(activePhpFrameworkProviders)
      ) {
        return false;
      }

      const routes = await collectPhpLaravelNamedRouteTargets(
        activeDocument.content,
        activeDocument.path,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = routes.find(
        (route) => route.name.toLowerCase() === context.routeName.toLowerCase(),
      );

      if (!target) {
        setMessage(`No Laravel route named ${context.routeName} found.`);
        return false;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      activePhpFrameworkProviders,
      collectPhpLaravelNamedRouteTargets,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelGateAbilityDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelGateAbilityString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const abilities = await collectPhpLaravelGateAbilityTargets(
        activeDocument.content,
        activeDocument.path,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = abilities.find(
        (ability) => ability.name === context.ability,
      );

      if (!target) {
        setMessage(
          `No Laravel authorization ability ${context.ability} found.`,
        );
        return false;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      collectPhpLaravelGateAbilityTargets,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelMiddlewareAliasDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelMiddlewareAliasString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const aliases = await collectPhpLaravelMiddlewareAliasTargets(
        activeDocument.content,
        activeDocument.path,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = aliases.find((alias) => alias.name === context.alias);

      if (!target) {
        setMessage(`No Laravel middleware alias ${context.alias} found.`);
        return false;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      collectPhpLaravelMiddlewareAliasTargets,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelViewDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelViewString" }>,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !activeDocument ||
        !phpFrameworkSupportsViews(activePhpFrameworkProviders)
      ) {
        return false;
      }

      const target = await findPhpLaravelViewTarget(context.viewName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel view named ${context.viewName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      activePhpFrameworkProviders,
      findPhpLaravelViewTarget,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelConfigDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelConfigString" }>,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelConfigTarget(context.configKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel config key ${context.configKey} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.key);
    },
    [
      activeDocument,
      findPhpLaravelConfigTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelAuthGuardDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelAuthGuardString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelAuthGuardTarget(context.guardName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel auth guard ${context.guardName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.guardName);
    },
    [
      activeDocument,
      findPhpLaravelAuthGuardTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelCacheStoreDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelCacheStoreString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelCacheStoreTarget(context.storeName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel cache store ${context.storeName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.storeName);
    },
    [
      activeDocument,
      findPhpLaravelCacheStoreTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelDatabaseConnectionDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelDatabaseConnectionString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelDatabaseConnectionTarget(
        context.connectionName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(
          `No Laravel database connection ${context.connectionName} found.`,
        );
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.position,
        target.connectionName,
      );
    },
    [
      activeDocument,
      findPhpLaravelDatabaseConnectionTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelBroadcastConnectionDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelBroadcastConnectionString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelBroadcastConnectionTarget(
        context.connectionName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(
          `No Laravel broadcast connection ${context.connectionName} found.`,
        );
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.position,
        target.connectionName,
      );
    },
    [
      activeDocument,
      findPhpLaravelBroadcastConnectionTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelQueueConnectionDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelQueueConnectionString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelQueueConnectionTarget(
        context.connectionName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(
          `No Laravel queue connection ${context.connectionName} found.`,
        );
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.position,
        target.connectionName,
      );
    },
    [
      activeDocument,
      findPhpLaravelQueueConnectionTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelRedisConnectionDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelRedisConnectionString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelRedisConnectionTarget(
        context.connectionName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(
          `No Laravel Redis connection ${context.connectionName} found.`,
        );
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.position,
        target.connectionName,
      );
    },
    [
      activeDocument,
      findPhpLaravelRedisConnectionTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelMailMailerDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelMailMailerString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelMailMailerTarget(context.mailerName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel mailer ${context.mailerName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.mailerName);
    },
    [
      activeDocument,
      findPhpLaravelMailMailerTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelPasswordBrokerDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelPasswordBrokerString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelPasswordBrokerTarget(
        context.brokerName,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel password broker ${context.brokerName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.brokerName);
    },
    [
      activeDocument,
      findPhpLaravelPasswordBrokerTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelLogChannelDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelLogChannelString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelLogChannelTarget(context.channelName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel log channel ${context.channelName} found.`);
        return false;
      }

      return openNavigationTarget(
        target.path,
        target.position,
        target.channelName,
      );
    },
    [
      activeDocument,
      findPhpLaravelLogChannelTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelStorageDiskDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelStorageDiskString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelStorageDiskTarget(context.diskName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel storage disk ${context.diskName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.diskName);
    },
    [
      activeDocument,
      findPhpLaravelStorageDiskTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelEnvDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelEnvString" }>,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelEnvTarget(context.envName);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel env key ${context.envName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      findPhpLaravelEnvTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelTranslationDefinition = useCallback(
    async (
      context: Extract<
        PhpIdentifierContext,
        { kind: "laravelTranslationString" }
      >,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const target = await findPhpLaravelTranslationTarget(
        context.translationKey,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(`No Laravel translation key ${context.translationKey} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.key);
    },
    [
      activeDocument,
      findPhpLaravelTranslationTarget,
      isLaravelFrameworkActive,
      openNavigationTarget,
      workspaceRoot,
    ],
  );

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

  const goToSuperMethod = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || activeDocument.language !== "php") {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const source = activeDocument.content;
    const methodName = phpEnclosingMethodNameAt(source, editorPosition);

    if (!methodName) {
      return false;
    }

    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot || !requestedDescriptor?.php) {
      return false;
    }

    // Walk a super type's hierarchy (extends / implements / used traits /
    // mixins) looking for the overridden method declaration. The current class
    // is intentionally excluded: navigation must land on the PARENT / interface
    // declaration, never on the method we are standing in.
    const visitedClassNames = new Set<string>();
    const openSuperMethodInHierarchy = async (
      candidateClassName: string,
    ): Promise<boolean> => {
      const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
      const visitedKey = normalizedCandidate.toLowerCase();

      if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

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

          for (const superReference of phpSuperMethodHierarchyReferences(
            content,
          )) {
            const resolvedReference = resolvePhpClassReference(
              content,
              superReference,
            );

            if (
              resolvedReference &&
              (await openSuperMethodInHierarchy(resolvedReference))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
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

    for (const superReference of phpSuperMethodHierarchyReferences(source)) {
      const resolvedReference = resolvePhpClassReference(source, superReference);

      if (
        resolvedReference &&
        (await openSuperMethodInHierarchy(resolvedReference))
      ) {
        return true;
      }

      if (!isRequestedRootActive()) {
        return false;
      }
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    setMessage(`No super method found for ${methodName}().`);
    return false;
  }, [
    activeDocument,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  const implementationTargetsFromLocations = useCallback(
    async (
      locations: LanguageServerLocation[],
      shouldContinue: () => boolean = () => true,
    ): Promise<ImplementationTarget[]> => {
      const uniqueTargets = new Map<string, ImplementationTarget>();

      for (const location of locations) {
        if (!shouldContinue()) {
          return [];
        }

        const path = pathFromLanguageServerUri(location.uri);
        let source: string | null = null;

        if (path) {
          try {
            source =
              documents[path]?.content ?? (await workspaceFiles.readTextFile(path));
          } catch {
            source = null;
          }
        }

        if (!shouldContinue()) {
          return [];
        }

        const target = implementationTargetFromLocation(location, source);

        if (!target) {
          continue;
        }

        uniqueTargets.set(target.id, target);
      }

      return [...uniqueTargets.values()];
    },
    [documents, workspaceFiles],
  );

  const openImplementationTarget = useCallback(
    async (target: ImplementationTarget) => {
      const opened = await openNavigationTarget(
        target.path,
        target.position,
        target.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                target.path,
              )
            : false,
        },
      );

      if (opened) {
        setImplementationChooser(null);
      }
    },
    [openNavigationTarget, workspaceRoot],
  );

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      "declaration" | "definition" | "implementation" | "typeDefinition"
    >,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    const document = activeDocument;
    const requestedRoot = workspaceRoot;
    const runtimeStatus = languageServerRuntimeStatus;
    const runtimeStatusRoot = languageServerRuntimeStatusRoot;

    if (!document || !requestedRoot || !isLanguageServerDocument(document)) {
      return false;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        runtimeStatus,
        runtimeStatusRoot,
        requestedRoot,
      )
    ) {
      return false;
    }

    if (
      !canUseLanguageServerFeature(
        runtimeStatus.capabilities,
        feature,
      )
    ) {
      return false;
    }

    const requestedSessionId = runtimeStatus.sessionId;
    const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const requestedPath = document.path;
    const isRequestedSessionActive = () =>
      isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

    if (feature === "implementation") {
      setImplementationChooser(null);
    }

    try {
      await flushPendingDocumentChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return false;
      }

      if (activeDocumentRef.current?.path !== requestedPath) {
        return false;
      }

      // Cmd+B / Cmd+click resolution latency: time the language-server
      // round-trip for the definition feature so the actual navigation cost is
      // observable in the runtime panel. Other nav features (declaration /
      // implementation / typeDefinition) share this path but are not the
      // headline Cmd+B operation, so they stay untimed to keep the metric clean.
      const locations =
        feature === "definition"
          ? await measureLatency(
              latencyTrackerForRoot(requestedRoot),
              "definition",
              () =>
                languageServerFeaturesGateway[feature](
                  requestedRoot,
                  toLanguageServerTextDocumentPosition(
                    requestedPath,
                    editorPosition,
                  ),
                ),
            )
          : await languageServerFeaturesGateway[feature](
              requestedRoot,
              toLanguageServerTextDocumentPosition(
                requestedPath,
                editorPosition,
              ),
            );

      if (!isRequestedSessionActive()) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(
          locations,
          isRequestedSessionActive,
        );

        if (!isRequestedSessionActive()) {
          return false;
        }

        if (targets.length > 1) {
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          if (!isRequestedSessionActive()) {
            return false;
          }

          await openImplementationTarget(onlyTarget);
          return true;
        }
      }

      const [target] = locations;

      if (!target) {
        return false;
      }

      if (!isRequestedSessionActive()) {
        return false;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      const previousLocation = currentNavigationLocation();
      const opened = await openPathForNavigation(targetPath);

      if (!opened) {
        return false;
      }

      if (!isRequestedSessionActive()) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      const targetPosition = toEditorPosition(target.range.start);
      setEditorRevealTarget({
        path: targetPath,
        position: targetPosition,
      });
      setMessage(
        `Opened ${label} ${getFileName(targetPath)}:${targetPosition.lineNumber}:${targetPosition.column}`,
      );
      return true;
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return false;
      }

      reportLanguageServerErrorForActiveWorkspaceRoot(requestedRoot, error);
      return false;
    }
  }, [
    activeDocument,
    flushPendingDocumentChange,
    implementationTargetsFromLocations,
    isLanguageServerSessionActiveForRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    latencyTrackerForRoot,
    openImplementationTarget,
    openPathForNavigation,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

  const goToJavaScriptTypeScriptLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      | "declaration"
      | "definition"
      | "implementation"
      | "sourceDefinition"
      | "typeDefinition"
    >,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    const document = activeDocument;
    const requestedRoot = workspaceRoot;
    const runtimeStatus = javaScriptTypeScriptLanguageServerRuntimeStatus;
    const runtimeStatusRoot = javaScriptTypeScriptLanguageServerRuntimeStatusRoot;

    if (
      !document ||
      !requestedRoot ||
      !isJavaScriptTypeScriptLanguageServerDocument(document)
    ) {
      return false;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        runtimeStatus,
        runtimeStatusRoot,
        requestedRoot,
      )
    ) {
      return false;
    }

    if (!canUseLanguageServerFeature(runtimeStatus.capabilities, feature)) {
      return false;
    }

    const requestedSessionId = runtimeStatus.sessionId;
    const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const requestedPath = document.path;
    const isRequestedJavaScriptTypeScriptSessionActive = () => {
      return isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
      );
    };

    if (feature === "implementation") {
      setImplementationChooser(null);
    }

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      if (activeDocumentRef.current?.path !== requestedPath) {
        return false;
      }

      const locations =
        await javaScriptTypeScriptLanguageServerFeaturesGateway[feature](
          requestedRoot,
          toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
        );

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(
          locations,
          isRequestedJavaScriptTypeScriptSessionActive,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return false;
        }

        if (targets.length > 1) {
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          if (!isRequestedJavaScriptTypeScriptSessionActive()) {
            return false;
          }

          const previousLocation = currentNavigationLocation();
          const opened = await openPathForNavigation(onlyTarget.path, {
            readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
              requestedRoot,
              onlyTarget.path,
            ),
          });

          if (!opened) {
            return false;
          }

          if (!isRequestedJavaScriptTypeScriptSessionActive()) {
            return false;
          }

          recordNavigationLocationSnapshot(previousLocation);
          setImplementationChooser(null);
          setEditorRevealTarget({
            path: onlyTarget.path,
            position: onlyTarget.position,
          });
          const targetPosition = onlyTarget.position;
          setMessage(
            `Opened ${onlyTarget.label} ${getFileName(onlyTarget.path)}:${targetPosition.lineNumber}:${targetPosition.column}`,
          );
          return true;
        }
      }

      const [target] = locations;

      if (!target) {
        return false;
      }

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      const previousLocation = currentNavigationLocation();
      const opened = await openPathForNavigation(targetPath, {
        readOnly: shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
          requestedRoot,
          targetPath,
        ),
      });

      if (!opened) {
        return false;
      }

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      recordNavigationLocationSnapshot(previousLocation);
      const targetPosition = toEditorPosition(target.range.start);
      setEditorRevealTarget({
        path: targetPath,
        position: targetPosition,
      });
      setMessage(
        `Opened ${label} ${getFileName(targetPath)}:${targetPosition.lineNumber}:${targetPosition.column}`,
      );
      return true;
    } catch (error) {
      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
      return false;
    }
  }, [
    activeDocument,
    flushPendingJavaScriptTypeScriptDocumentChange,
    implementationTargetsFromLocations,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openPathForNavigation,
    currentNavigationLocation,
    recordNavigationLocationSnapshot,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

  const goToIndexedSymbolDefinition = useCallback(async (): Promise<boolean> => {
    if (!activeDocument) {
      return false;
    }

    if (!workspaceRoot) {
      return false;
    }

    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const symbolName = identifierAtEditorPosition(
      activeDocument.content,
      editorPosition,
    );

    if (!symbolName) {
      return false;
    }

    try {
      if (activeDocument.language === "php") {
        const context = phpIdentifierContextAt(
          activeDocument.content,
          editorPosition,
        );

        if (!context) {
          return false;
        }

        if (context.kind === "methodCall") {
          return goToPhpMethodCallDefinition(context);
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

          return openDirectPhpMethodTarget(className, context.methodName);
        }

        if (context.kind !== "classIdentifier") {
          return false;
        }

        const openedClassTarget = await goToPhpClassIdentifierDefinition(
          context.name,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (openedClassTarget) {
          return true;
        }

        if (!shouldIndexWorkspace(intelligenceMode)) {
          setMessage("Enable Smart Index or IDE Mode to search indexed symbols.");
          return false;
        }

        const symbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          context.name,
          25,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        const target = bestIndexedSymbolMatch(
          symbols,
          context.name,
          activeDocument.path,
        );

        if (!target) {
          setMessage(`No indexed symbol found for ${context.name}.`);
          return false;
        }

        return openNavigationTarget(
          target.path,
          editorPositionFromProjectSymbol(target),
          target.name,
        );
      }

      if (!shouldIndexWorkspace(intelligenceMode)) {
        setMessage("Enable Smart Index or IDE Mode to search indexed symbols.");
        return false;
      }

      const symbols = await projectSymbolSearch.searchProjectSymbols(
        requestedRoot,
        symbolName,
        25,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = bestIndexedSymbolMatch(
        symbols,
        symbolName,
        activeDocument.path,
      );

      if (!target) {
        setMessage(`No indexed symbol found for ${symbolName}.`);
        return false;
      }

      return openNavigationTarget(
        target.path,
        editorPositionFromProjectSymbol(target),
        target.name,
      );
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "Go to Definition",
        error,
      );
      return false;
    }
  }, [
    activeDocument,
    goToPhpLaravelAuthGuardDefinition,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpLaravelCacheStoreDefinition,
    goToPhpLaravelBroadcastConnectionDefinition,
    goToPhpLaravelConfigDefinition,
    goToPhpLaravelDatabaseConnectionDefinition,
    goToPhpLaravelEnvDefinition,
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
    intelligenceMode,
    openDirectPhpMethodTarget,
    openNavigationTarget,
    projectSymbolSearch,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

  const goToDefinition = useCallback(async () => {
    const document = activeDocumentRef.current;
    const editorPosition = activeEditorPositionRef.current;

    if (document?.path.endsWith(".blade.php") && editorPosition) {
      const openedBladeTarget = await provideBladeDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
      );

      if (openedBladeTarget) {
        return;
      }
    }

    if (document?.path.endsWith(".latte") && editorPosition) {
      const openedLatteTarget = await provideLatteDefinition(
        document.content,
        documentOffsetAtEditorPosition(document.content, editorPosition),
      );

      if (openedLatteTarget) {
        return;
      }
    }

    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "definition",
        "definition",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedContextualPhpTarget = await goToContextualPhpDefinition();

    if (openedContextualPhpTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "definition",
      "definition",
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedSymbolDefinition();
  }, [
    goToContextualPhpDefinition,
    goToIndexedSymbolDefinition,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
    provideBladeDefinition,
    provideLatteDefinition,
  ]);

  const goToSourceDefinition = useCallback(async () => {
    await goToJavaScriptTypeScriptLanguageServerLocation(
      "sourceDefinition",
      "source definition",
    );
  }, [goToJavaScriptTypeScriptLanguageServerLocation]);

  const goToDeclaration = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "declaration",
        "declaration",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation("declaration", "declaration");
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToTypeDefinition = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "typeDefinition",
        "type definition",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    await goToLanguageServerLocation("typeDefinition", "type definition");
  }, [
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToImplementation = useCallback(async () => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation();
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const goToImplementationAt = useCallback(async (position: EditorPosition) => {
    const openedJavaScriptTypeScriptTarget =
      await goToJavaScriptTypeScriptLanguageServerLocation(
        "implementation",
        "implementation",
        position,
      );

    if (openedJavaScriptTypeScriptTarget) {
      return;
    }

    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "implementation",
      "implementation",
      position,
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedPhpImplementation(position);
  }, [
    goToIndexedPhpImplementation,
    goToJavaScriptTypeScriptLanguageServerLocation,
    goToLanguageServerLocation,
  ]);

  const openCallHierarchyRow = useCallback(
    async (row: CallHierarchyRow) => {
      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open call hierarchy target.");
        return;
      }

      const opened = await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                path,
              )
            : false,
        },
      );

      if (opened) {
        setCallHierarchyView(null);
      }
    },
    [openNavigationTarget, workspaceRoot],
  );

  const openTypeHierarchyRow = useCallback(
    async (row: TypeHierarchyRow) => {
      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open type hierarchy target.");
        return;
      }

      const opened = await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                path,
              )
            : false,
        },
      );

      if (opened) {
        setTypeHierarchyView(null);
      }
    },
    [openNavigationTarget, workspaceRoot],
  );

  const openCallHierarchy = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to show call hierarchy.",
      );
      return;
    }

    if (
      !workspaceRoot ||
      (!isLanguageServerDocument(document) &&
        !isJavaScriptTypeScriptLanguageServerDocument(document))
    ) {
      setMessage(
        "Call hierarchy is available for PHP, JavaScript, and TypeScript files.",
      );
      return;
    }

    const isPhpDocument = isLanguageServerDocument(document);
    let callHierarchyContext: {
      featuresGateway: LanguageServerFeaturesGateway;
      flushPendingChange(path: string): Promise<void>;
      isSessionActive(rootPath: string, sessionId: number): boolean;
      sessionId: number;
    };

    if (isPhpDocument) {
      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "PHP language server is starting. Try call hierarchy again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "callHierarchy",
        )
      ) {
        setMessage("PHP language server does not provide call hierarchy.");
        return;
      }

      callHierarchyContext = {
        featuresGateway: languageServerFeaturesGateway,
        flushPendingChange: flushPendingDocumentChange,
        isSessionActive: isLanguageServerSessionActiveForRoot,
        sessionId: languageServerRuntimeStatus.sessionId,
      };
    } else {
      if (
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service is starting. Try call hierarchy again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "callHierarchy",
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service does not provide call hierarchy.",
        );
        return;
      }

      callHierarchyContext = {
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingChange: flushPendingJavaScriptTypeScriptDocumentChange,
        isSessionActive:
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
        sessionId: javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
      };
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a symbol to show call hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const requestedSessionId = callHierarchyContext.sessionId;
    const isRequestedSessionActive = () =>
      callHierarchyContext.isSessionActive(requestedRoot, requestedSessionId);

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);

    try {
      await callHierarchyContext.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const [item] = await callHierarchyContext.featuresGateway.prepareCallHierarchy(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No call hierarchy available for this symbol.");
        return;
      }

      const [incoming, outgoing] = await Promise.all([
        callHierarchyContext.featuresGateway.incomingCalls(
          requestedRoot,
          item,
        ),
        callHierarchyContext.featuresGateway.outgoingCalls(
          requestedRoot,
          item,
        ),
      ]);

      if (!isRequestedSessionActive()) {
        return;
      }

      setCallHierarchyView({
        incoming,
        item,
        outgoing,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Call Hierarchy", error);
    }
  }, [
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

  const openTypeHierarchy = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to show type hierarchy.",
      );
      return;
    }

    if (
      !workspaceRoot ||
      (!isLanguageServerDocument(document) &&
        !isJavaScriptTypeScriptLanguageServerDocument(document))
    ) {
      setMessage(
        "Type hierarchy is available for PHP, JavaScript, and TypeScript files.",
      );
      return;
    }

    const isPhpDocument = isLanguageServerDocument(document);
    let typeHierarchyContext: {
      featuresGateway: LanguageServerFeaturesGateway;
      flushPendingChange(path: string): Promise<void>;
      isSessionActive(rootPath: string, sessionId: number): boolean;
      sessionId: number;
    };

    if (isPhpDocument) {
      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "PHP language server is starting. Try type hierarchy again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "typeHierarchy",
        )
      ) {
        setMessage("PHP language server does not provide type hierarchy.");
        return;
      }

      typeHierarchyContext = {
        featuresGateway: languageServerFeaturesGateway,
        flushPendingChange: flushPendingDocumentChange,
        isSessionActive: isLanguageServerSessionActiveForRoot,
        sessionId: languageServerRuntimeStatus.sessionId,
      };
    } else {
      if (
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service is starting. Try type hierarchy again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "typeHierarchy",
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service does not provide type hierarchy.",
        );
        return;
      }

      typeHierarchyContext = {
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingChange: flushPendingJavaScriptTypeScriptDocumentChange,
        isSessionActive:
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
        sessionId: javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
      };
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a type to show type hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const requestedSessionId = typeHierarchyContext.sessionId;
    const isRequestedSessionActive = () =>
      typeHierarchyContext.isSessionActive(requestedRoot, requestedSessionId);

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);

    try {
      await typeHierarchyContext.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const [item] = await typeHierarchyContext.featuresGateway.prepareTypeHierarchy(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No type hierarchy available for this symbol.");
        return;
      }

      const [supertypes, subtypes] = await Promise.all([
        typeHierarchyContext.featuresGateway.typeHierarchySupertypes(
          requestedRoot,
          item,
        ),
        typeHierarchyContext.featuresGateway.typeHierarchySubtypes(
          requestedRoot,
          item,
        ),
      ]);

      if (!isRequestedSessionActive()) {
        return;
      }

      setTypeHierarchyView({
        item,
        subtypes,
        supertypes,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Type Hierarchy", error);
    }
  }, [
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

  const openReferenceRow = useCallback(
    async (row: ReferenceRow) => {
      const opened = await openNavigationTarget(
        row.path,
        toEditorPosition(row.location.range.start),
        "reference",
        {
          readOnly: workspaceRoot
            ? shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
                workspaceRoot,
                row.path,
              )
            : false,
        },
      );

      if (opened) {
        setReferencesView(null);
      }
    },
    [openNavigationTarget, workspaceRoot],
  );

  const openReferencesPanel = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      setMessage(
        "Open a PHP, JavaScript, or TypeScript file to find references.",
      );
      return;
    }

    if (
      !workspaceRoot ||
      (!isLanguageServerDocument(document) &&
        !isJavaScriptTypeScriptLanguageServerDocument(document))
    ) {
      setMessage(
        "Find references is available for PHP, JavaScript, and TypeScript files.",
      );
      return;
    }

    const isPhpDocument = isLanguageServerDocument(document);
    let referencesContext: {
      featuresGateway: LanguageServerFeaturesGateway;
      flushPendingChange(path: string): Promise<void>;
      isSessionActive(rootPath: string, sessionId: number): boolean;
      sessionId: number;
    };

    if (isPhpDocument) {
      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "PHP language server is starting. Try find references again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "references",
        )
      ) {
        setMessage("PHP language server does not provide references.");
        return;
      }

      referencesContext = {
        featuresGateway: languageServerFeaturesGateway,
        flushPendingChange: flushPendingDocumentChange,
        isSessionActive: isLanguageServerSessionActiveForRoot,
        sessionId: languageServerRuntimeStatus.sessionId,
      };
    } else {
      if (
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service is starting. Try find references again in a moment.",
        );
        return;
      }

      if (
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "references",
        )
      ) {
        setMessage(
          "JavaScript/TypeScript service does not provide references.",
        );
        return;
      }

      referencesContext = {
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingChange: flushPendingJavaScriptTypeScriptDocumentChange,
        isSessionActive:
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
        sessionId: javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId,
      };
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a symbol to find references.");
      return;
    }

    const symbolName =
      identifierAtEditorPosition(document.content, editorPosition) ??
      "symbol";
    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const requestedSessionId = referencesContext.sessionId;
    const isRequestedSessionActive = () =>
      referencesContext.isSessionActive(requestedRoot, requestedSessionId);

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);

    try {
      await referencesContext.flushPendingChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const locations = await referencesContext.featuresGateway.references(
        requestedRoot,
        toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
      );

      if (!isRequestedSessionActive()) {
        return;
      }

      if (locations.length === 0) {
        setReferencesView({ locations: [], symbol: symbolName });
        setMessage(`No references found for ${symbolName}.`);
        return;
      }

      setReferencesView({ locations, symbol: symbolName });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Find References", error);
    }
  }, [
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

  const openFileReferencesPanel = useCallback(async () => {
    const document = activeDocumentRef.current;

    if (!document || !workspaceRoot) {
      setMessage("Open a JavaScript or TypeScript file to find file references.");
      return;
    }

    if (!isJavaScriptTypeScriptLanguageServerDocument(document)) {
      setMessage(
        "Find File References is available for JavaScript and TypeScript files.",
      );
      return;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      setMessage(
        "JavaScript/TypeScript service is starting. Try find file references again in a moment.",
      );
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = document.path;
    const requestedSessionId =
      javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
    const isRequestedSessionActive = () =>
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
      );

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setWorkspaceSymbolsOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setReferencesView(null);

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedSessionActive()) {
        return;
      }

      const locations =
        await javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations(
          requestedRoot,
          findAllFileReferencesCommand(requestedPath),
        );

      if (!isRequestedSessionActive()) {
        return;
      }

      const workspaceLocations = filterFileReferenceLocationsToWorkspace(
        locations,
        requestedRoot,
      );
      const symbol = document.name;

      if (workspaceLocations.length === 0) {
        setReferencesView({ locations: [], symbol });
        setMessage(`No file references found for ${symbol}.`);
        return;
      }

      setReferencesView({ locations: workspaceLocations, symbol });
      setMessage(null);
    } catch (error) {
      if (!isRequestedSessionActive()) {
        return;
      }

      reportError("Find File References", error);
    }
  }, [
    flushPendingJavaScriptTypeScriptDocumentChange,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

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

  const createDirectory = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const relativePath = prompter.prompt("New folder path", "src/Domain");

    if (!relativePath) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const path = joinWorkspacePath(requestedRoot, relativePath);

    try {
      await workspaceFiles.createDirectory(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Created ${path}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Create Folder", error);
    }
  }, [
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    workspaceFiles,
    workspaceRoot,
  ]);

  const renameActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    const nextName = prompter.prompt("Rename file", document.name);

    if (!nextName || nextName === document.name) {
      return;
    }

    const parentPath = getParentPath(document.path);
    const oldPath = document.path;
    const nextPath = joinWorkspacePath(parentPath, nextName);

    try {
      if (isLanguageServerDocument(document)) {
        await applyPhpRenameEdits(document.path, nextPath);
      }

      if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
        const mayRename = await applyJavaScriptTypeScriptRenameEdits(
          document.path,
          nextPath,
        );
        if (!mayRename) {
          return;
        }
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await workspaceFiles.renamePath(document.path, nextPath);
      filePrefetchCacheRef.current.invalidate(document.path);
      filePrefetchCacheRef.current.invalidate(nextPath);
      if (isLanguageServerDocument(document)) {
        await notifyPhpFileRenamed(document.path, nextPath);
      }

      if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
        await notifyJavaScriptTypeScriptFileRenamed(document.path, nextPath);
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await syncClosedDocument(document);
      await syncClosedJavaScriptTypeScriptDocument(document);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      clearLanguageServerDiagnosticsForPath(requestedRoot, oldPath);

      setDocuments((current) => {
        const currentDocument = current[document.path] ?? document;
        const renamedDocument = {
          ...currentDocument,
          language: detectLanguage(nextPath),
          name: nextName,
          path: nextPath,
        };
        const next = { ...current };
        delete next[document.path];
        next[nextPath] = renamedDocument;
        return next;
      });
      setOpenPaths((current) =>
        current.map((path) => (path === document.path ? nextPath : path)),
      );
      setActivePath(nextPath);
      remapRecentFile(oldPath, { name: nextName, path: nextPath });
      remapRecentLocations(oldPath, {
        name: nextName,
        path: nextPath,
        relativePath:
          workspaceRelativePath(requestedRoot, nextPath) ?? nextPath,
      });
      setBookmarks((current) =>
        renameBookmarksForPath(current, oldPath, nextPath),
      );
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Renamed ${document.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Rename File", error);
    }
  }, [
    applyJavaScriptTypeScriptRenameEdits,
    applyPhpRenameEdits,
    clearLanguageServerDiagnosticsForPath,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    prompter,
    refreshDirectory,
    remapRecentFile,
    remapRecentLocations,
    reportErrorForActiveWorkspaceRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  const renameEntry = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind !== "directory") {
        return;
      }

      const requestedRoot = workspaceRoot;
      if (!requestedRoot) {
        return;
      }

      const nextName = prompter.prompt("Rename folder", entry.name);

      if (!nextName || nextName === entry.name) {
        return;
      }

      const oldPath = entry.path;
      const parentPath = getParentPath(oldPath);
      const nextPath = joinWorkspacePath(parentPath, nextName);

      if (nextPath === oldPath) {
        return;
      }

      try {
        const mayRename = await applyJavaScriptTypeScriptRenameEdits(
          oldPath,
          nextPath,
        );
        if (!mayRename) {
          return;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        await workspaceFiles.renamePath(oldPath, nextPath);
        filePrefetchCacheRef.current.invalidate(oldPath);
        filePrefetchCacheRef.current.invalidate(nextPath);

        await notifyJavaScriptTypeScriptFileRenamed(oldPath, nextPath);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        const diagnosticPaths = new Set([
          ...Object.keys(languageServerDiagnosticsByPath),
          ...Object.keys(javaScriptTypeScriptDiagnosticsByPath),
          ...Object.keys(phpLocalDiagnosticsByPath),
          ...Object.keys(documentsRef.current),
        ]);

        for (const diagnosticPath of diagnosticPaths) {
          if (isPathInDirectory(diagnosticPath, oldPath)) {
            clearLanguageServerDiagnosticsForPath(requestedRoot, diagnosticPath);
          }
        }

        const remappedDocuments = Object.values(documentsRef.current).filter(
          (document) =>
            remapPathForDirectoryRename(document.path, oldPath, nextPath) !==
            document.path,
        );
        await Promise.all(
          remappedDocuments.flatMap((document) => [
            syncClosedDocument(document),
            syncClosedJavaScriptTypeScriptDocument(document),
          ]),
        );

        const nextDocuments: Record<string, EditorDocument> = {};
        for (const document of Object.values(documentsRef.current)) {
          const remappedPath = remapPathForDirectoryRename(
            document.path,
            oldPath,
            nextPath,
          );
          const remappedDocument =
            remappedPath === document.path
              ? document
              : {
                  ...document,
                  language: detectLanguage(remappedPath),
                  name: getFileName(remappedPath),
                  path: remappedPath,
                };
          nextDocuments[remappedDocument.path] = remappedDocument;
        }

        const nextOpenPaths = openPathsRef.current.map((path) =>
          remapPathForDirectoryRename(path, oldPath, nextPath),
        );
        const nextPreviewPath = previewPathRef.current
          ? remapPathForDirectoryRename(previewPathRef.current, oldPath, nextPath)
          : null;
        const nextActivePath = activePath
          ? remapPathForDirectoryRename(activePath, oldPath, nextPath)
          : null;

        documentsRef.current = nextDocuments;
        openPathsRef.current = nextOpenPaths;
        previewPathRef.current = nextPreviewPath;
        activeDocumentRef.current = nextActivePath
          ? nextDocuments[nextActivePath] ?? null
          : null;

        setDocuments(nextDocuments);
        setOpenPaths(nextOpenPaths);
        setPreviewPath(nextPreviewPath);
        setActivePath(nextActivePath);
        setEntriesByDirectory((current) =>
          remapEntriesByDirectoryForDirectoryRename(current, oldPath, nextPath),
        );
        setExpandedDirectories((current) =>
          remapPathSetForDirectoryRename(current, oldPath, nextPath),
        );
        setManuallyCollapsedDirectories((current) =>
          remapPathSetForDirectoryRename(current, oldPath, nextPath),
        );

        const directoriesToRefresh = new Set([parentPath, getParentPath(nextPath)]);
        for (const directory of directoriesToRefresh) {
          await refreshDirectory(directory);
          if (
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
          ) {
            return;
          }
        }

        setMessage(`Renamed ${entry.name}`);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Rename Folder", error);
      }
    },
    [
      activePath,
      applyJavaScriptTypeScriptRenameEdits,
      clearLanguageServerDiagnosticsForPath,
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
      notifyJavaScriptTypeScriptFileRenamed,
      phpLocalDiagnosticsByPath,
      prompter,
      refreshDirectory,
      reportErrorForActiveWorkspaceRoot,
      workspaceFiles,
      workspaceRoot,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const deleteActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    if (!prompter.confirm(`Delete ${document.name}?`)) {
      return;
    }

    const parentPath = getParentPath(document.path);
    const deletedPath = document.path;

    try {
      const mayDelete = await applyJavaScriptTypeScriptDeleteEdits(deletedPath);
      if (!mayDelete) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await workspaceFiles.deletePath(deletedPath);
      filePrefetchCacheRef.current.invalidate(deletedPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
        await syncClosedJavaScriptTypeScriptDocument(document);
      }
      await notifyJavaScriptTypeScriptFileDeleted(deletedPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      closeDocument(deletedPath);
      forgetRecentFile(deletedPath);
      forgetRecentLocationsForPath(deletedPath);
      setBookmarks((current) => removeBookmarksForPath(current, deletedPath));
      clearLanguageServerDiagnosticsForPath(requestedRoot, deletedPath);
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Deleted ${document.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Delete File", error);
    }
  }, [
    applyJavaScriptTypeScriptDeleteEdits,
    clearLanguageServerDiagnosticsForPath,
    closeActiveSurface,
    closeDocument,
    forgetRecentFile,
    forgetRecentLocationsForPath,
    notifyJavaScriptTypeScriptFileDeleted,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  // External filesystem changes (delete / rename / create performed outside the
  // editor) arrive in bursts — e.g. a `git checkout` rewrites many files at
  // once. Coalesce the resulting directory reloads behind a short timer and
  // re-check the active root before every reload so a workspace switch
  // mid-burst can never refresh another project's tree.
  const flushPendingWorkspaceDirectoryRefreshes = useCallback(() => {
    workspaceDirectoryRefreshTimerRef.current = null;
    const directories = Array.from(
      pendingWorkspaceDirectoryRefreshesRef.current,
    );
    pendingWorkspaceDirectoryRefreshesRef.current = new Set();

    directories.forEach((directory) => {
      if (
        !workspacePathBelongsToRoot(directory, currentWorkspaceRootRef.current)
      ) {
        return;
      }

      void refreshDirectory(directory);
    });
  }, [refreshDirectory]);

  const queueWorkspaceDirectoryRefresh = useCallback(
    (directory: string) => {
      pendingWorkspaceDirectoryRefreshesRef.current.add(directory);

      if (workspaceDirectoryRefreshTimerRef.current) {
        return;
      }

      workspaceDirectoryRefreshTimerRef.current = setTimeout(() => {
        flushPendingWorkspaceDirectoryRefreshes();
      }, WORKSPACE_DIRECTORY_REFRESH_DEBOUNCE_MS);
    },
    [flushPendingWorkspaceDirectoryRefreshes],
  );

  const queueWorkspaceGitStatusRefresh = useCallback(
    (requestedRoot: string) => {
      if (sidebarView !== "git") {
        return;
      }

      if (workspaceGitStatusRefreshTimerRef.current) {
        clearTimeout(workspaceGitStatusRefreshTimerRef.current);
      }

      workspaceGitStatusRefreshTimerRef.current = setTimeout(() => {
        workspaceGitStatusRefreshTimerRef.current = null;

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }

        void refreshGitStatus();
      }, WORKSPACE_GIT_STATUS_REFRESH_DEBOUNCE_MS);
    },
    [refreshGitStatus, sidebarView],
  );

  const handleExternalRemovedPath = useCallback(
    (requestedRoot: string, removedPath: string) => {
      markExternallyRemovedDocumentPath(requestedRoot, removedPath);
      closeDocument(removedPath);
      clearLanguageServerDiagnosticsForPath(requestedRoot, removedPath);
      filePrefetchCacheRef.current.invalidate(removedPath);
      queueWorkspaceDirectoryRefresh(getParentPath(removedPath));
    },
    [
      clearLanguageServerDiagnosticsForPath,
      closeDocument,
      markExternallyRemovedDocumentPath,
      queueWorkspaceDirectoryRefresh,
    ],
  );

  const refreshOpenDocumentFromExternalFileChange = useCallback(
    async (requestedRoot: string, path: string): Promise<void> => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const openDocument = documentsRef.current[path];

      if (!canRefreshDocumentFromExternalFileChange(openDocument)) {
        return;
      }

      let refreshedContent: string;

      try {
        refreshedContent = await workspaceFiles.readTextFile(path);
      } catch {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const latestDocument = documentsRef.current[path];

      if (!canRefreshDocumentFromExternalFileChange(latestDocument)) {
        return;
      }

      const refreshedDocument: EditorDocument = {
        ...latestDocument,
        content: refreshedContent,
        savedContent: refreshedContent,
      };

      documentsRef.current = {
        ...documentsRef.current,
        [path]: refreshedDocument,
      };
      activeDocumentRef.current =
        activeDocumentRef.current?.path === path
          ? refreshedDocument
          : activeDocumentRef.current;
      setDocuments((current) => {
        const currentDocument = current[path];

        if (!canRefreshDocumentFromExternalFileChange(currentDocument)) {
          return current;
        }

        return {
          ...current,
          [path]: {
            ...currentDocument,
            content: refreshedContent,
            savedContent: refreshedContent,
          },
        };
      });
    },
    [workspaceFiles],
  );

  const handleWorkspaceFileChange = useCallback(
    (event: WorkspaceFileChangeEvent) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      // Per-workspace isolation: never apply a change reported for a workspace
      // other than the one currently active in this tab.
      if (
        !requestedRoot ||
        !workspaceRootKeysEqual(requestedRoot, event.rootPath)
      ) {
        return;
      }

      queueWorkspaceGitStatusRefresh(requestedRoot);

      // Drop the cached migration / provider sources / Blade component names /
      // Blade view-data entries when anything under database/migrations,
      // app/Providers, the Blade component directories, or any PHP file
      // changes so the next completion reloads the DB columns / Builder macros
      // / component tags / view variables. Covers create/modify/delete and
      // both ends of a rename.
      invalidatePhpLaravelMigrationSourcesForPath(requestedRoot, event.path);
      invalidatePhpLaravelProviderSourcesForPath(requestedRoot, event.path);
      invalidateBladeComponentNamesForPath(requestedRoot, event.path);
      invalidateBladeViewDataEntriesForPath(requestedRoot, event.path);

      if (event.previousPath) {
        invalidatePhpLaravelMigrationSourcesForPath(
          requestedRoot,
          event.previousPath,
        );
        invalidatePhpLaravelProviderSourcesForPath(
          requestedRoot,
          event.previousPath,
        );
        invalidateBladeComponentNamesForPath(
          requestedRoot,
          event.previousPath,
        );
        invalidateBladeViewDataEntriesForPath(
          requestedRoot,
          event.previousPath,
        );
      }

      if (event.kind === "deleted") {
        handleExternalRemovedPath(requestedRoot, event.path);
        return;
      }

      if (event.kind === "renamed") {
        if (event.previousPath) {
          handleExternalRemovedPath(requestedRoot, event.previousPath);
        }

        forgetExternallyRemovedDocumentPath(event.path);
        queueWorkspaceDirectoryRefresh(getParentPath(event.path));
        return;
      }

      if (event.kind === "created" || event.kind === "modified") {
        queueWorkspaceDirectoryRefresh(getParentPath(event.path));
      }

      if (event.kind === "modified" && event.fileKind !== "directory") {
        void refreshOpenDocumentFromExternalFileChange(requestedRoot, event.path);
      }
    },
    [
      handleExternalRemovedPath,
      forgetExternallyRemovedDocumentPath,
      invalidateBladeComponentNamesForPath,
      invalidateBladeViewDataEntriesForPath,
      invalidatePhpLaravelMigrationSourcesForPath,
      invalidatePhpLaravelProviderSourcesForPath,
      queueWorkspaceGitStatusRefresh,
      queueWorkspaceDirectoryRefresh,
      refreshOpenDocumentFromExternalFileChange,
    ],
  );

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

  const startLanguageServer = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      setMessage("Enable IDE Mode to start the PHP language server.");
      return;
    }

    const requestedRoot = workspaceRoot;
    clearManualPhpLanguageServerStop(requestedRoot);

    try {
      const status = await languageServerRuntimeGateway.start(
        requestedRoot,
        phpLanguageServerOptions(workspaceSettingsRef.current),
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      handleLanguageServerRuntimeStatus(status, requestedRoot);
    } catch (error) {
      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        reportLanguageServerError(error);
      }
    }
  }, [
    clearManualPhpLanguageServerStop,
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    languageServerRuntimeGateway,
    reportLanguageServerError,
    workspaceRoot,
  ]);

  const stopLanguageServer = useCallback(async () => {
    const targetRootPath = currentWorkspaceRootRef.current;

    if (!targetRootPath) {
      return;
    }

    const status = await stopLanguageServerRuntime(targetRootPath);

    if (status?.kind !== "stopped") {
      return;
    }

    markManualPhpLanguageServerStop(targetRootPath);
  }, [markManualPhpLanguageServerStop, stopLanguageServerRuntime]);

  const restartJavaScriptTypeScriptService = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;

    if (currentSettings.javaScriptTypeScriptService === "off") {
      setMessage("Enable JavaScript/TypeScript service to restart it.");
      return;
    }

    const requestedRoot = workspaceRoot;
    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
    await stopJavaScriptTypeScriptLanguageServerRuntime(requestedRoot);

    const plan = await refreshJavaScriptTypeScriptLanguageServerPlan(
      requestedRoot,
      currentSettings.javaScriptTypeScriptVersion,
    );

    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
      return;
    }

    if (plan?.status !== "ready") {
      setMessage(plan?.message ?? "JavaScript/TypeScript service is unavailable.");
      return;
    }

    try {
      const status =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.start(requestedRoot, {
          autoImportsEnabled: currentSettings.javaScriptTypeScriptAutoImports,
          automaticTypeAcquisitionEnabled:
            currentSettings.javaScriptTypeScriptAutomaticTypeAcquisition,
          codeLensEnabled: currentSettings.javaScriptTypeScriptCodeLens,
          completeFunctionCalls:
            currentSettings.javaScriptTypeScriptCompleteFunctionCalls,
          inlayHintsEnabled: currentSettings.javaScriptTypeScriptInlayHints,
          typeScriptVersionPreference:
            currentSettings.javaScriptTypeScriptVersion,
          validationEnabled: currentSettings.javaScriptTypeScriptValidation,
          ...javaScriptTypeScriptImportPreferenceOptions(currentSettings),
        });

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        status,
        requestedRoot,
      );
      setMessage("JavaScript/TypeScript service restarted.");
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      );
    }
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceRoot,
  ]);

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
    setSearchEverywhereQuery,
    setSearchEverywhereFiles,
    setSearchEverywhereSymbols,
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

          unlisteners.push(dispose);
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

  const canSearchClassOpenSymbols = Boolean(
    shouldIndexWorkspace(intelligenceMode) ||
      (isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      ) &&
        canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )) ||
      (isRunningLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      ) &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )),
  );

  const activateSearchEverywhereItem = useCallback(
    async (item: SearchEverywhereItem) => {
      if (item.kind === "action") {
        setSearchEverywhereOpen(false);

        try {
          await item.command.run();
        } catch (error) {
          reportError("Command", error);
        }

        return;
      }

      // Capture the requested root up front so a workspace switch during the
      // open cannot reveal a symbol position in another tab's editor.
      const requestedRoot = currentWorkspaceRootRef.current;
      const path = item.kind === "file" ? item.file.path : item.symbol.path;
      const name =
        item.kind === "file" ? item.file.name : getFileName(item.symbol.path);

      const opened = await openFile({ kind: "file", name, path });

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (!opened) {
        return;
      }

      setSearchEverywhereOpen(false);

      if (item.kind === "symbol") {
        setEditorRevealTarget({
          path: item.symbol.path,
          position: editorPositionFromProjectSymbol(item.symbol),
        });
        setMessage(
          `Opened ${item.symbol.name} ${item.symbol.relativePath}:${item.symbol.lineNumber}:${item.symbol.column}`,
        );
      }
    },
    [openFile, reportError],
  );

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

  // Combine the three raw sources into the categorized Search Everywhere model.
  // Files/symbols are already query-filtered by their gateways; actions are
  // filtered here against the live query + command context so disabled commands
  // never show. Pure aggregation lives in the domain layer (searchEverywhere).
  const searchEverywhereCommands = commandRegistry.list();
  const searchEverywhereModel = useMemo(
    () =>
      buildSearchEverywhereModel({
        query: searchEverywhereQuery,
        files: searchEverywhereFiles,
        symbols: searchEverywhereSymbols,
        commands: searchEverywhereCommands,
        context: commandContext,
      }),
    [
      searchEverywhereQuery,
      searchEverywhereFiles,
      searchEverywhereSymbols,
      searchEverywhereCommands,
      commandContext.hasWorkspace,
      commandContext.hasActiveDocument,
      commandContext.activeDocumentDirty,
    ],
  );

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      clearManualPhpLanguageServerStop(workspaceRoot);
    }
  }, [clearManualPhpLanguageServerStop, intelligenceMode, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldStartLanguageServer(intelligenceMode)) {
      return;
    }

    if (!workspaceTrust?.trusted) {
      return;
    }

    if (languageServerPlan?.status !== "ready") {
      return;
    }

    if (
      languageServerRuntimeStatusRoot &&
      !workspaceRootKeysEqual(languageServerRuntimeStatusRoot, workspaceRoot)
    ) {
      return;
    }

    if (
      isLanguageServerActiveForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    const autostartRootKey = normalizedWorkspaceRootKey(workspaceRoot);
    const autostartAttempts =
      phpLanguageServerAutostartAttemptsByRootRef.current[autostartRootKey] ??
      0;

    if (
      isCrashedLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      ) &&
      autostartAttempts === 0
    ) {
      return;
    }

    if (autostartAttempts >= PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS) {
      return;
    }

    if (isPhpLanguageServerManuallyStopped(workspaceRoot)) {
      return;
    }

    if (workspaceRootKeysEqual(autoStartedLanguageServerRootRef.current, workspaceRoot)) {
      return;
    }

    autoStartedLanguageServerRootRef.current = workspaceRoot;
    phpLanguageServerAutostartAttemptsByRootRef.current[autostartRootKey] =
      autostartAttempts + 1;
    languageServerRuntimeGateway
      .start(workspaceRoot, phpLanguageServerOptions(workspaceSettingsRef.current))
      .then((status) => {
        handleLanguageServerRuntimeStatus(status, workspaceRoot);

        if (
          isRunningLanguageServerForWorkspace(
            status,
            status.rootPath ?? null,
            workspaceRoot,
          )
        ) {
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            autostartRootKey
          ];
          return;
        }

        if (
          isLanguageServerActive(status) &&
          !isLanguageServerActiveForWorkspace(
            status,
            status.rootPath ?? null,
            workspaceRoot,
          )
        ) {
          if (
            workspaceRootKeysEqual(
              autoStartedLanguageServerRootRef.current,
              workspaceRoot,
            )
          ) {
            autoStartedLanguageServerRootRef.current = null;
          }

          setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
          return;
        }

        if (!languageServerCrashMessage(status)) {
          return;
        }

        if (
          workspaceRootKeysEqual(
            autoStartedLanguageServerRootRef.current,
            workspaceRoot,
          )
        ) {
          autoStartedLanguageServerRootRef.current = null;
        }

        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      })
      .catch((error) => {
        if (
          workspaceRootKeysEqual(
            autoStartedLanguageServerRootRef.current,
            workspaceRoot,
          )
        ) {
          autoStartedLanguageServerRootRef.current = null;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)) {
          return;
        }

        reportLanguageServerError(error);
        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      });
  }, [
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    isPhpLanguageServerManuallyStopped,
    languageServerPlan,
    languageServerRuntimeGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    phpLanguageServerAutostartRetryVersion,
    reportLanguageServerError,
    workspaceSettings.intelephensePath,
    workspaceSettings.phpBackend,
    workspaceSettings.phpactorPath,
    workspaceRoot,
    workspaceTrust,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (workspaceSettings.javaScriptTypeScriptService !== "auto") {
      return;
    }

    if (!shouldAutoStartJavaScriptTypeScriptLanguageServer) {
      return;
    }

    if (javaScriptTypeScriptLanguageServerPlan?.status !== "ready") {
      return;
    }

    if (
      isLanguageServerActiveForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    if (
      isCrashedLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return;
    }

    if (
      workspaceRootKeysEqual(
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
        workspaceRoot,
      )
    ) {
      return;
    }

    const requestedRoot = workspaceRoot;
    let cancelled = false;

    void (async () => {
      if (cancelled) {
        return;
      }

      let latestStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      let latestStatusRoot =
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current;

      if (!latestStatus && !latestStatusRoot) {
        const probedStatus = await Promise.race([
          javaScriptTypeScriptLanguageServerRuntimeGateway
            .getStatus(requestedRoot)
            .catch(() => null),
          (async () => {
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await Promise.resolve();
            }

            return null;
          })(),
        ]);

        if (cancelled) {
          return;
        }

        if (probedStatus) {
          latestStatus = probedStatus;
          latestStatusRoot = probedStatus.rootPath ?? null;
        }
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (
        workspaceSettingsRef.current.javaScriptTypeScriptService !== "auto" ||
        !shouldAutoStartJavaScriptTypeScriptLanguageServer
      ) {
        return;
      }

      if (
        latestStatusRoot &&
        !workspaceRootKeysEqual(latestStatusRoot, requestedRoot)
      ) {
        return;
      }

      if (
        isLanguageServerActiveForWorkspace(
          latestStatus,
          latestStatusRoot,
          requestedRoot,
        )
      ) {
        return;
      }

      if (
        isCrashedLanguageServerForWorkspace(
          latestStatus,
          latestStatusRoot,
          requestedRoot,
        )
      ) {
        return;
      }

      if (
        workspaceRootKeysEqual(
          autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
          requestedRoot,
        )
      ) {
        return;
      }

      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current =
        requestedRoot;
      javaScriptTypeScriptLanguageServerRuntimeGateway
        .start(requestedRoot, {
          autoImportsEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptAutoImports,
          automaticTypeAcquisitionEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptAutomaticTypeAcquisition,
          codeLensEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptCodeLens,
          completeFunctionCalls: workspaceSettingsRef.current
            .javaScriptTypeScriptCompleteFunctionCalls,
          inlayHintsEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptInlayHints,
          typeScriptVersionPreference:
            workspaceSettingsRef.current.javaScriptTypeScriptVersion,
          validationEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptValidation,
          ...javaScriptTypeScriptImportPreferenceOptions(
            workspaceSettingsRef.current,
          ),
        })
        .then((status) => {
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            if (
              workspaceRootKeysEqual(
                autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
                requestedRoot,
              )
            ) {
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
            }

            return;
          }

          if (
            isLanguageServerActive(status) &&
            !isLanguageServerActiveForWorkspace(
              status,
              status.rootPath ?? null,
              requestedRoot,
            )
          ) {
            if (
              workspaceRootKeysEqual(
                autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
                requestedRoot,
              )
            ) {
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
            }

            handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
              runtimeStatusForRequestedRoot(status, requestedRoot),
              requestedRoot,
            );
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            requestedRoot,
          );
        })
        .catch((error) => {
          if (
            workspaceRootKeysEqual(
              autoStartedJavaScriptTypeScriptLanguageServerRootRef.current,
              requestedRoot,
            )
          ) {
            autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
          }

          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "JavaScript/TypeScript",
            error,
          );
        });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportErrorForActiveWorkspaceRoot,
    shouldAutoStartJavaScriptTypeScriptLanguageServer,
    workspaceSettings.javaScriptTypeScriptAutoImports,
    workspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition,
    workspaceSettings.javaScriptTypeScriptCodeLens,
    workspaceSettings.javaScriptTypeScriptCompleteFunctionCalls,
    workspaceSettings.javaScriptTypeScriptInlayHints,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceSettings.javaScriptTypeScriptVersion,
    workspaceSettings.javaScriptTypeScriptValidation,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (workspaceSettings.javaScriptTypeScriptService !== "off") {
      return;
    }

    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;

    if (
      isLanguageServerActiveForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      ) ||
      isCrashedLanguageServerForWorkspace(
        javaScriptTypeScriptLanguageServerRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      void stopJavaScriptTypeScriptLanguageServerRuntime(workspaceRoot);
      return;
    }

    clearJavaScriptTypeScriptDiagnosticsForRoot(workspaceRoot);
    resetJavaScriptTypeScriptLanguageServerDocuments();
  }, [
    clearJavaScriptTypeScriptDiagnosticsForRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceRoot,
  ]);

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
        return;
      }

      if (matches("class.quickOpen")) {
        event.preventDefault();
        if (workspaceRoot) {
          setQuickOpenOpen(false);
          setWorkspaceSymbolsOpen(false);
          setRecentFilesSwitcherOpen(false);
          setClassOpenOpen(true);
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
    if (!quickOpenOpen || !workspaceRoot) {
      setQuickOpenResults([]);
      setQuickOpenLoading(false);
      return;
    }

    let active = true;
    setQuickOpenLoading(true);

    const timeout = window.setTimeout(() => {
      measureLatency(latencyTrackerForRoot(workspaceRoot), "quickOpen", () =>
        fileSearch.searchFiles(workspaceRoot, quickOpenQuery, 80),
      )
        .then((results) => {
          if (!active) {
            return;
          }

          setQuickOpenResults(results);
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setQuickOpenResults([]);
          reportError("Quick Open", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setQuickOpenLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    fileSearch,
    latencyTrackerForRoot,
    quickOpenOpen,
    quickOpenQuery,
    reportError,
    workspaceRoot,
  ]);

  const searchClassOpenSymbols = useCallback(
    async (query: string, limit: number): Promise<ProjectSymbolSearchResult[]> => {
      if (!workspaceRoot) {
        return [];
      }

      const requestedRoot = workspaceRoot;
      const searches: Array<Promise<ProjectSymbolSearchResult[]>> = [];

      if (shouldIndexWorkspace(intelligenceMode)) {
        searches.push(
          projectSymbolSearch.searchProjectSymbols(requestedRoot, query, limit),
        );
      }

      if (
        isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        const requestedSessionId = languageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () =>
          isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

        searches.push(
          languageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    requestedRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
                );
            })
            .catch((error) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              reportError("PHP Workspace Symbols", error);
              return [];
            }),
        );
      }

      if (
        isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        const requestedSessionId =
          javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
        const isRequestedWorkspaceSymbolSessionActive = () =>
          isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
            requestedRoot,
            requestedSessionId,
          );

        searches.push(
          javaScriptTypeScriptLanguageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              return symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    requestedRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
                );
            })
            .catch((error) => {
              if (!isRequestedWorkspaceSymbolSessionActive()) {
                return [];
              }

              reportError("JavaScript/TypeScript Workspace Symbols", error);
              return [];
            }),
        );
      }

      const results = (await Promise.all(searches)).flat();
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return [];
      }

      return uniqueProjectSymbols(results).slice(0, limit);
    },
    [
      intelligenceMode,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      isLanguageServerSessionActiveForRoot,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      projectSymbolSearch,
      reportError,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (
      !classOpenOpen ||
      !workspaceRoot ||
      !classOpenQuery.trim() ||
      !canSearchClassOpenSymbols
    ) {
      setClassOpenResults([]);
      setClassOpenLoading(false);
      return;
    }

    let active = true;
    setClassOpenLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(classOpenQuery, 120)
        .then((results) => {
          if (!active) {
            return;
          }

          setClassOpenResults(
            results.filter(isTypeProjectSymbol).slice(0, 80),
          );
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setClassOpenResults([]);
          reportError("Open Class", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setClassOpenLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    classOpenOpen,
    classOpenQuery,
    canSearchClassOpenSymbols,
    reportError,
    searchClassOpenSymbols,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !workspaceSymbolsOpen ||
      !workspaceRoot ||
      !workspaceSymbolsQuery.trim() ||
      !canSearchClassOpenSymbols
    ) {
      setWorkspaceSymbolsResults([]);
      setWorkspaceSymbolsLoading(false);
      return;
    }

    let active = true;
    setWorkspaceSymbolsLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(workspaceSymbolsQuery, 120)
        .then((results) => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsResults(results.slice(0, 80));
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsResults([]);
          reportError("Go to Symbol in Workspace", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    reportError,
    searchClassOpenSymbols,
    workspaceRoot,
    workspaceSymbolsOpen,
    workspaceSymbolsQuery,
  ]);

  // Search Everywhere unified file + symbol search. Reuses the exact same
  // gateways as Quick Open (files) and Go to Symbol (symbols) - this effect only
  // fans the one query out to both and stores the raw per-source results. The
  // command/action source needs no async search (the registry is already in
  // memory) so it is filtered synchronously in the render-time model.
  //
  // Isolation: the requested root is captured up front and the `active` flag
  // (reset by cleanup on any dependency change, including a workspace tab
  // switch) drops stale results so a slow search from a previous root can never
  // overwrite the current tab's results. `searchClassOpenSymbols` additionally
  // re-checks `currentWorkspaceRootRef` after its awaits.
  useEffect(() => {
    if (!searchEverywhereOpen || !workspaceRoot) {
      setSearchEverywhereFiles([]);
      setSearchEverywhereSymbols([]);
      setSearchEverywhereLoading(false);
      return;
    }

    const trimmedQuery = searchEverywhereQuery.trim();

    if (!trimmedQuery) {
      setSearchEverywhereFiles([]);
      setSearchEverywhereSymbols([]);
      setSearchEverywhereLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    let active = true;
    setSearchEverywhereLoading(true);

    const timeout = window.setTimeout(() => {
      const fileSearchPromise = measureLatency(
        latencyTrackerForRoot(requestedRoot),
        "searchEverywhere",
        () => fileSearch.searchFiles(requestedRoot, searchEverywhereQuery, 40),
      )
        .then((results) => {
          if (!active) {
            return;
          }

          setSearchEverywhereFiles(results);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setSearchEverywhereFiles([]);
          reportError("Search Everywhere", error);
        });

      if (!canSearchClassOpenSymbols) {
        setSearchEverywhereSymbols([]);
      }

      const symbolSearchPromise = canSearchClassOpenSymbols
        ? searchClassOpenSymbols(searchEverywhereQuery, 40)
            .then((results) => {
              if (!active) {
                return;
              }

              setSearchEverywhereSymbols(results);
            })
            .catch((error) => {
              if (!active) {
                return;
              }

              setSearchEverywhereSymbols([]);
              reportError("Search Everywhere", error);
            })
        : Promise.resolve();

      void Promise.all([fileSearchPromise, symbolSearchPromise]).finally(() => {
        if (!active) {
          return;
        }

        setSearchEverywhereLoading(false);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    searchClassOpenSymbols,
    searchEverywhereOpen,
    searchEverywhereQuery,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!textSearchOpen || !workspaceRoot || !textSearchQuery.trim()) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    // Capture the requested root + filters up front; the `active` flag (reset by
    // cleanup whenever any of these change, including a workspace tab switch)
    // drops stale results so a slow search from a previous root/filter set can
    // never overwrite the current one.
    const requestedRoot = workspaceRoot;
    let active = true;
    setTextSearchLoading(true);

    const timeout = window.setTimeout(() => {
      textSearch
        .searchText(
          requestedRoot,
          textSearchQuery,
          TEXT_SEARCH_RESULT_LIMIT,
          textSearchOptions,
        )
        .then((results) => {
          if (!active) {
            return;
          }

          setTextSearchResults(results);
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setTextSearchResults([]);
          reportError("Text Search", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    reportError,
    textSearchOpen,
    textSearchQuery,
    textSearchOptions,
    textSearchRefreshToken,
    textSearch,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    if (workspaceRoot) {
      const cachedStatus = cachedLanguageServerRuntimeStatusForRoot(
        languageServerRuntimeStatusByRootRef.current,
        workspaceRoot,
      );

      if (cachedStatus) {
        setLanguageServerRuntimeStatus(cachedStatus);
        setLanguageServerRuntimeStatusRoot(workspaceRoot);
      } else {
        setLanguageServerRuntimeStatus(null);
        setLanguageServerRuntimeStatusRoot(null);
      }

      languageServerRuntimeGateway
        .getStatus(workspaceRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          handleLanguageServerRuntimeStatus(status, workspaceRoot);
        })
        .catch((error) => {
          if (
            !active ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
          ) {
            return;
          }

          setLanguageServerRuntimeStatusRoot(workspaceRoot);
          reportError("Language Server", error);
        });
    } else {
      setLanguageServerRuntimeStatus(null);
      setLanguageServerRuntimeStatusRoot(null);
    }

    languageServerRuntimeGateway
      .subscribeStatus((status) => {
        if (!active) {
          return;
        }

        handleLanguageServerRuntimeStatus(status);
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
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(workspaceRoot, error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    handleLanguageServerRuntimeStatus,
    languageServerRuntimeGateway,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportError,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    if (workspaceRoot) {
      const cachedStatus = cachedLanguageServerRuntimeStatusForRoot(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        workspaceRoot,
      );

      if (cachedStatus) {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(cachedStatus);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
      } else {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      }

      javaScriptTypeScriptLanguageServerRuntimeGateway
        .getStatus(workspaceRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
            status,
            workspaceRoot,
          );
        })
        .catch((error) => {
          if (
            !active ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
          ) {
            return;
          }

          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
          reportErrorForActiveWorkspaceRoot(
            workspaceRoot,
            "JavaScript/TypeScript",
            error,
          );
        });
    } else {
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
    }

    javaScriptTypeScriptLanguageServerRuntimeGateway
      .subscribeStatus((status) => {
        if (!active) {
          return;
        }

        handleJavaScriptTypeScriptLanguageServerRuntimeStatus(status);
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
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
        ) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          workspaceRoot,
          "JavaScript/TypeScript",
          error,
        );
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

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

  useEffect(
    () => () => {
      if (workspaceDirectoryRefreshTimerRef.current) {
        clearTimeout(workspaceDirectoryRefreshTimerRef.current);
        workspaceDirectoryRefreshTimerRef.current = null;
      }

      if (workspaceGitStatusRefreshTimerRef.current) {
        clearTimeout(workspaceGitStatusRefreshTimerRef.current);
        workspaceGitStatusRefreshTimerRef.current = null;
      }
    },
    [],
  );

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
      return javaScriptTypeScriptFileOutlinesByPath[activeDocument.path] ?? null;
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
    javaScriptTypeScriptFileOutlinesByPath,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
  ]);
  const fileStructureLoading = Boolean(
    activeDocument &&
      (loadingJavaScriptTypeScriptFileOutlinePaths.has(activeDocument.path) ||
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
    provideBladeCodeActions,
    provideBladeCompletions,
    provideBladeDefinition,
    provideLatteCompletions,
    provideLatteDefinition,
    provideNeonCompletions,
    provideNeonDefinition,
    provideNettePhpLinkDefinition,
    provideNettePhpLinkCompletions,
    providePhpCodeActions,
    providePhpLaravelDefinition,
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

function fileOutlineFromLanguageServerDocumentSymbols(
  workspaceRoot: string,
  path: string,
  symbols: LanguageServerDocumentSymbol[],
): PhpFileOutline {
  return {
    nodes: symbols.map((symbol) =>
      fileOutlineNodeFromLanguageServerDocumentSymbol(
        workspaceRoot,
        path,
        symbol,
        null,
      ),
    ),
  };
}

function fileOutlineNodeFromLanguageServerDocumentSymbol(
  workspaceRoot: string,
  path: string,
  symbol: LanguageServerDocumentSymbol,
  parentName: string | null,
): PhpFileOutlineNode {
  const fullyQualifiedName = parentName
    ? `${parentName}.${symbol.name}`
    : symbol.name;

  return {
    children: symbol.children.map((child) =>
      fileOutlineNodeFromLanguageServerDocumentSymbol(
        workspaceRoot,
        path,
        child,
        fullyQualifiedName,
      ),
    ),
    column: symbol.selectionRange.start.character + 1,
    fullyQualifiedName,
    id: `${path}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}:${fullyQualifiedName}`,
    kind: fileOutlineKindFromLanguageServerSymbolKind(symbol.kind),
    label: symbol.name,
    lineNumber: symbol.selectionRange.start.line + 1,
    path,
    relativePath: relativeWorkspacePath(workspaceRoot, path),
  };
}

function fileOutlineKindFromLanguageServerSymbolKind(
  kind: number,
): PhpFileOutlineNode["kind"] {
  if (kind === 5) {
    return "class";
  }

  if (kind === 6 || kind === 9) {
    return "method";
  }

  if (kind === 7 || kind === 8) {
    return "property";
  }

  if (kind === 10) {
    return "enum";
  }

  if (kind === 11) {
    return "interface";
  }

  if (kind === 12) {
    return "function";
  }

  if (kind === 13) {
    return "variable";
  }

  if (kind === 14 || kind === 22) {
    return "constant";
  }

  return "container";
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

function bladeSyntheticPhpMemberAccessSource(
  variableName: string,
  typeName: string,
): { position: EditorPosition; source: string } {
  const source = `<?php\n/** @var \\${typeName.replace(/^\\+/, "")} $${variableName} */\n$${variableName}->`;

  return {
    position: editorPositionAtOffset(source, source.length),
    source,
  };
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

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clampedOffset = Math.max(0, Math.min(offset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return {
    column: clampedOffset - lineStart + 1,
    lineNumber,
  };
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

function projectSymbolFromLanguageServerWorkspaceSymbol(
  workspaceRoot: string,
  symbol: LanguageServerWorkspaceSymbol,
): ProjectSymbolSearchResult | null {
  const path = symbol.location ? pathFromLanguageServerUri(symbol.location.uri) : null;
  const kind = projectSymbolKindFromLanguageServerSymbolKind(symbol.kind);

  if (!path || !kind || !symbol.location) {
    return null;
  }

  return {
    column: symbol.location.range.start.character + 1,
    containerName: symbol.containerName,
    fullyQualifiedName: symbol.containerName
      ? `${symbol.containerName}.${symbol.name}`
      : symbol.name,
    kind,
    lineNumber: symbol.location.range.start.line + 1,
    name: symbol.name,
    path,
    relativePath: relativeWorkspacePath(workspaceRoot, path),
  };
}

function projectSymbolKindFromLanguageServerSymbolKind(
  kind: number,
): ProjectSymbolKind | null {
  if (kind === 5) {
    return "class";
  }

  if (kind === 6) {
    return "method";
  }

  if (kind === 10) {
    return "enum";
  }

  if (kind === 11) {
    return "interface";
  }

  if (kind === 12) {
    return "function";
  }

  return null;
}

function uniqueProjectSymbols(
  symbols: ProjectSymbolSearchResult[],
): ProjectSymbolSearchResult[] {
  const seen = new Set<string>();
  const unique: ProjectSymbolSearchResult[] = [];

  for (const symbol of symbols) {
    const key = [
      symbol.kind,
      symbol.fullyQualifiedName,
      symbol.path,
      symbol.lineNumber,
      symbol.column,
    ].join("\0");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(symbol);
  }

  return unique;
}

// KEEP IN SYNC: this helper cluster is duplicated verbatim in useDiagnostics.ts
// (see the FOLLOW-UP note there). Any change here must land in BOTH files until
// the helpers move into a shared module.
function phpLocalDiagnosticNoticeGroup(path: string): string {
  return `${PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX}${fileUriFromPath(path)}`;
}

function localPhpDiagnosticsFromSource(
  source: string,
  syntaxDiagnostics: Array<{
    character: number;
    endCharacter: number;
    endLine: number;
    line: number;
    message: string;
  }>,
): LanguageServerDiagnostic[] {
  const localSyntaxDiagnostics = [
    ...(syntaxDiagnostics.length === 0
      ? structuralPhpSyntaxDiagnostics(source)
      : []),
    ...suspiciousPhpBareIdentifierDiagnostics(source),
  ];
  const inspectionDiagnostics = phpInspectionDiagnostics(source);
  const diagnostics: LanguageServerDiagnostic[] = [
    ...syntaxDiagnostics,
    ...localSyntaxDiagnostics,
  ].map((diagnostic) => ({
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter,
    endLine: diagnostic.endLine,
    line: diagnostic.line,
    message: diagnostic.message,
    severity: "error" as const,
    source: "PHP Syntax",
  }));

  diagnostics.push(
    ...inspectionDiagnostics.map((diagnostic) => ({
      character: diagnostic.character,
      endCharacter: diagnostic.endCharacter,
      endLine: diagnostic.endLine,
      line: diagnostic.line,
      message: diagnostic.message,
      severity: "warning" as const,
      source: "PHP Inspection",
      tags: diagnostic.unnecessary ? [1] : undefined,
    })),
  );

  return diagnostics;
}

function diagnosticNoticeNavigationTarget(
  uri: string,
  diagnostic: LanguageServerDiagnostic,
): WorkbenchNoticeNavigationTarget | undefined {
  const path = pathFromLanguageServerUri(uri);

  if (!path) {
    return undefined;
  }

  return {
    path,
    range: {
      end: {
        column: (diagnostic.endCharacter ?? diagnostic.character) + 1,
        lineNumber: (diagnostic.endLine ?? diagnostic.line) + 1,
      },
      start: {
        column: diagnostic.character + 1,
        lineNumber: diagnostic.line + 1,
      },
    },
  };
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

function bestIndexedSymbolMatch(
  symbols: ProjectSymbolSearchResult[],
  query: string,
  activePath: string,
): ProjectSymbolSearchResult | null {
  const normalizedQuery = query.toLowerCase();
  const exactMatchOutsideActiveFile = symbols.find(
    (symbol) =>
      symbol.path !== activePath &&
      isExactProjectSymbolMatch(symbol, normalizedQuery),
  );

  if (exactMatchOutsideActiveFile) {
    return exactMatchOutsideActiveFile;
  }

  const exactMatch = symbols.find((symbol) =>
    isExactProjectSymbolMatch(symbol, normalizedQuery),
  );

  if (exactMatch) {
    return exactMatch;
  }

  return null;
}

function isExactProjectSymbolMatch(
  symbol: ProjectSymbolSearchResult,
  normalizedQuery: string,
): boolean {
  return (
    symbol.name.toLowerCase() === normalizedQuery ||
    symbol.fullyQualifiedName.toLowerCase() === normalizedQuery
  );
}

function editorPositionFromProjectSymbol(
  symbol: ProjectSymbolSearchResult,
): EditorPosition {
  return {
    column: Math.max(1, Number(symbol.column)),
    lineNumber: Math.max(1, Number(symbol.lineNumber)),
  };
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

interface PhpSameSourceTypeDeclaration {
  bodyEnd: number;
  bodyStart: number;
  fullyQualifiedName: string;
  kind: "class" | "enum" | "interface" | "trait";
  name: string;
}

function phpTraitThisCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpTraitThisCompletionContext | null {
  const offset = phpOffsetAtPosition(source, position);
  const types = phpSameSourceTypeDeclarations(source);
  const trait = types.find(
    (type) =>
      type.kind === "trait" &&
      offset > type.bodyStart &&
      offset < type.bodyEnd,
  );

  if (!trait) {
    return null;
  }

  const hosts = types.filter(
    (type) =>
      (type.kind === "class" || type.kind === "enum") &&
      phpSameSourceTypeUsesTrait(source, type, trait.fullyQualifiedName),
  );
  const host = hosts.length === 1 ? hosts[0] : null;
  const declaringClassName = host?.fullyQualifiedName ?? trait.fullyQualifiedName;
  const memberSource = host
    ? `${phpSameSourceTypeBody(source, trait)}\n${phpSameSourceTypeBody(
        source,
        host,
      )}`
    : phpSameSourceTypeBody(source, trait);

  return {
    contextualThisClassName: host?.fullyQualifiedName ?? null,
    declaringClassName,
    memberSource,
  };
}

function phpSameSourceTypeDeclarations(
  source: string,
): PhpSameSourceTypeDeclaration[] {
  const namespaceMatch = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim().replace(/^\\+/, "") ?? "";
  const types: PhpSameSourceTypeDeclaration[] = [];
  const pattern = /\b(class|enum|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(source))) {
    const kind = match[1] as PhpSameSourceTypeDeclaration["kind"] | undefined;
    const name = match[2];

    if (!kind || !name) {
      continue;
    }

    const bodyStart = source.indexOf("{", match.index + match[0].length);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd =
      phpMatchingPairOffset(source, bodyStart, "{", "}") ?? source.length;

    types.push({
      bodyEnd,
      bodyStart,
      fullyQualifiedName: namespace ? `${namespace}\\${name}` : name,
      kind,
      name,
    });
    pattern.lastIndex = bodyEnd + 1;
  }

  return types;
}

function phpSameSourceTypeUsesTrait(
  source: string,
  type: PhpSameSourceTypeDeclaration,
  traitClassName: string,
): boolean {
  const body = phpSameSourceTypeBody(source, type);

  for (const match of body.matchAll(/^\s*use\s+([^;{]+)\s*(?:;|\{)/gm)) {
    for (const trait of (match[1] ?? "").split(",")) {
      const resolvedTraitName = resolvePhpClassName(source, trait.trim());

      if (
        resolvedTraitName?.replace(/^\\+/, "").toLowerCase() ===
        traitClassName.toLowerCase()
      ) {
        return true;
      }
    }
  }

  return false;
}

function phpSameSourceTypeBody(
  source: string,
  type: PhpSameSourceTypeDeclaration,
): string {
  return source.slice(type.bodyStart + 1, type.bodyEnd);
}

function phpNormalizedReceiverExpressionIsThis(
  receiverExpression: string,
): boolean {
  return receiverExpression.trim().replace(/\?->/g, "->") === "$this";
}

function phpMatchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function phpOffsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function phpClassMemberCacheKey(
  path: string,
  className: string,
  frameworkProviderSignature: string,
  migrationSourcesSignature: string,
): string {
  return `${path}#${className.trim().replace(/^\\+/, "").toLowerCase()}#${frameworkProviderSignature}#${migrationSourcesSignature}`;
}

function phpClassSourceHasDeclaredProperty(
  source: string,
  propertyName: string,
): boolean {
  const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

  if (!normalizedPropertyName) {
    return false;
  }

  const escapedPropertyName = escapeRegExp(normalizedPropertyName);
  const docPropertyPattern = new RegExp(
    String.raw`@(?:(?:phpstan|psalm)-)?property(?:-read|-write)?\s+[^\r\n*]+?\s+\$${escapedPropertyName}\b`,
    "i",
  );
  const declaredPropertyPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:public|protected|private|readonly|static|var)\s+)*(?:\??[\\A-Za-z_][\\A-Za-z0-9_]*(?:\|[\\A-Za-z_][\\A-Za-z0-9_]*)?\s+)?\$${escapedPropertyName}\b`,
    "i",
  );

  return (
    docPropertyPattern.test(source) || declaredPropertyPattern.test(source)
  );
}

function phpClassSourceHasDeclaredConstant(
  source: string,
  constantName: string,
): boolean {
  const normalizedConstantName = constantName.trim();

  if (!normalizedConstantName) {
    return false;
  }

  const escapedConstantName = escapeRegExp(normalizedConstantName);
  const declaredConstantPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:final|public|protected|private)\s+)*const\b[^\r\n;]*\b${escapedConstantName}\b`,
    "i",
  );

  return declaredConstantPattern.test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phpSourceSignature(source: string): string {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${source.length}:${hash >>> 0}`;
}

function phpReturnTypeIncludesLateStatic(typeName: string | null): boolean {
  return Boolean(
    typeName
      ?.trim()
      .replace(/^\?/, "")
      .split(/[|&]/)
      .some((part) => {
        const normalized = part.trim().replace(/^\\+/, "").toLowerCase();

        return normalized === "static" || normalized === "$this";
      }),
  );
}

function phpMethodCompletionWithTemplateReturnType(
  method: PhpMethodCompletion,
  templateTypes: ReadonlyMap<string, string>,
): PhpMethodCompletion {
  if (!method.returnType || templateTypes.size === 0) {
    return method;
  }

  let returnType = method.returnType;

  for (const [templateName, resolvedType] of templateTypes) {
    returnType = returnType.replace(
      new RegExp(
        `(^|[^A-Za-z0-9_\\\\])${escapeRegExp(templateName)}(?![A-Za-z0-9_])`,
        "gi",
      ),
      `$1${resolvedType}`,
    );
  }

  return returnType === method.returnType ? method : { ...method, returnType };
}

function laravelFacadeTargetClassName(className: string): string | null {
  const normalizedClassName = className.replace(/^\\+/, "").toLowerCase();
  const targets: Record<string, string> = {
    "illuminate\\support\\facades\\app": "Illuminate\\Contracts\\Foundation\\Application",
    "illuminate\\support\\facades\\cache": "Illuminate\\Cache\\CacheManager",
    "illuminate\\support\\facades\\config": "Illuminate\\Config\\Repository",
    "illuminate\\support\\facades\\db": "Illuminate\\Database\\DatabaseManager",
    "illuminate\\support\\facades\\event": "Illuminate\\Events\\Dispatcher",
    "illuminate\\support\\facades\\file": "Illuminate\\Filesystem\\Filesystem",
    "illuminate\\support\\facades\\gate": "Illuminate\\Contracts\\Auth\\Access\\Gate",
    "illuminate\\support\\facades\\log": "Psr\\Log\\LoggerInterface",
    "illuminate\\support\\facades\\queue": "Illuminate\\Queue\\QueueManager",
    "illuminate\\support\\facades\\route": "Illuminate\\Routing\\Router",
    "illuminate\\support\\facades\\schema": "Illuminate\\Database\\Schema\\Builder",
    "illuminate\\support\\facades\\storage": "Illuminate\\Filesystem\\FilesystemManager",
    "illuminate\\support\\facades\\validator": "Illuminate\\Validation\\Factory",
    "illuminate\\support\\facades\\view": "Illuminate\\View\\Factory",
  };

  return targets[normalizedClassName] ?? null;
}

function resolvePhpLaravelRelationModelType(
  source: string,
  returnType: string,
  includeCollectionRelations: boolean,
): string | null {
  if (!isLaravelEloquentRelationType(returnType, includeCollectionRelations)) {
    return null;
  }

  const relatedModelType = phpDeclaredGenericTypeCandidates(returnType).find(
    (candidate) => !isGenericPhpPlaceholder(candidate),
  );

  return relatedModelType ? resolvePhpClassName(source, relatedModelType) : null;
}

function resolvePhpRelationTargetClassReference(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = className.trim().replace(/^\\+/, "").toLowerCase();

  if (
    normalizedClassName === "__class__" ||
    normalizedClassName === "self" ||
    normalizedClassName === "static" ||
    normalizedClassName === "$this"
  ) {
    return phpCurrentClassName(source);
  }

  if (normalizedClassName === "parent") {
    const parentClassName = phpExtendsClassName(source);

    return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
  }

  return resolvePhpClassName(source, className);
}

function phpLooksLikeQualifiedClassName(typeName: string | null): boolean {
  return Boolean(phpNormalizedDeclaredTypeName(typeName)?.includes("\\"));
}

function phpNormalizedDeclaredTypeName(typeName: string | null): string | null {
  return typeName?.trim().replace(/^\?/, "").replace(/^\\+/, "") || null;
}

function phpIsBuiltinDeclaredType(typeName: string | null): boolean {
  const normalizedTypeName = phpNormalizedDeclaredTypeName(typeName)?.toLowerCase();

  return Boolean(
    normalizedTypeName &&
      new Set([
        "array",
        "bool",
        "boolean",
        "callable",
        "false",
        "float",
        "int",
        "integer",
        "iterable",
        "mixed",
        "never",
        "null",
        "object",
        "resource",
        "self",
        "static",
        "string",
        "true",
        "void",
      ]).has(normalizedTypeName),
  );
}

function phpCollectionGenericModelTypeCandidate(
  typeName: string | null,
): string | null {
  if (!typeName) {
    return null;
  }

  const arrayItemType = phpCollectionArrayModelTypeCandidate(typeName);

  if (arrayItemType) {
    return arrayItemType;
  }

  if (!/\bCollection\s*</i.test(typeName)) {
    return null;
  }

  return phpDeclaredGenericTypeCandidates(typeName).find(
    (candidate) => !isGenericPhpPlaceholder(candidate),
  ) ?? null;
}

function phpCollectionArrayModelTypeCandidate(typeName: string): string | null {
  if (!/\bCollection\b/i.test(typeName)) {
    return null;
  }

  for (const segment of typeName.split(/[|&]/)) {
    const match = /^(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\[\]$/.exec(
      segment.trim(),
    );
    const candidate = match?.[1] ?? null;

    if (candidate && !isGenericPhpPlaceholder(candidate)) {
      return candidate;
    }
  }

  return null;
}

function phpClassDocGenericCollectionModelTypeCandidate(
  source: string,
): string | null {
  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm|template)-)?(?:extends|implements)\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? null);
    const candidate = phpCollectionGenericModelTypeCandidate(typeName);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function mergePhpMethodCompletions(
  ...groups: PhpMethodCompletion[][]
): PhpMethodCompletion[] {
  const completions = new Map<string, PhpMethodCompletion>();

  for (const group of groups) {
    for (const completion of group) {
      const key = `${completion.kind ?? "method"}:${completion.name.toLowerCase()}`;

      if (!completions.has(key)) {
        completions.set(key, completion);
      }
    }
  }

  return Array.from(completions.values());
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

function isLaravelEloquentRelationType(
  typeName: string,
  includeCollectionRelations: boolean,
): boolean {
  const normalizedTypeName = typeName
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  if (!normalizedTypeName) {
    return false;
  }

  if (
    normalizedTypeName.startsWith(
      "illuminate\\database\\eloquent\\relations\\",
    )
  ) {
    const shortTypeName = shortPhpName(normalizedTypeName);
    return includeCollectionRelations
      ? laravelEloquentRelationTypes.has(shortTypeName)
      : laravelEloquentSingularRelationTypes.has(shortTypeName);
  }

  return includeCollectionRelations
    ? laravelEloquentRelationTypes.has(normalizedTypeName)
    : laravelEloquentSingularRelationTypes.has(normalizedTypeName);
}

function isGenericPhpPlaceholder(typeName: string): boolean {
  const normalized = typeName.trim().replace(/^\\+/, "").toLowerCase();

  return (
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this" ||
    normalized === "illuminate\\database\\eloquent\\model" ||
    normalized === "model" ||
    /^t[A-Z_]/.test(typeName)
  );
}

const laravelEloquentRelationTypes = new Set([
  "belongsto",
  "belongstomany",
  "hasmany",
  "hasmanythrough",
  "hasone",
  "hasonethrough",
  "morphmany",
  "morphone",
  "morphedbymany",
  "morphto",
  "morphtomany",
]);

const laravelEloquentSingularRelationTypes = new Set([
  "belongsto",
  "hasone",
  "hasonethrough",
  "morphone",
  "morphto",
]);

function indexProgressNoticeGroup(rootPath: string): string {
  return `index-progress:${rootPath}`;
}

function applyLanguageServerTextEdits(
  content: string,
  edits: LanguageServerTextEdit[],
): string {
  const indexedEdits = edits
    .map((edit) => ({
      end: byteOffsetForLanguageServerPosition(content, edit.range.end),
      newText: edit.newText,
      start: byteOffsetForLanguageServerPosition(content, edit.range.start),
    }))
    .sort((left, right) => right.start - left.start || right.end - left.end);
  let nextContent = content;
  let previousStart = content.length;

  for (const edit of indexedEdits) {
    if (edit.start > edit.end || edit.end > previousStart) {
      throw new Error("Workspace edit ranges overlap or are invalid.");
    }

    nextContent =
      nextContent.slice(0, edit.start) +
      edit.newText +
      nextContent.slice(edit.end);
    previousStart = edit.start;
  }

  return nextContent;
}

function changedOpenDocumentPathsForWorkspaceEdit(
  edit: LanguageServerWorkspaceEdit,
  documents: Record<string, EditorDocument>,
  rootPath: string,
  documentVersionsByUri: Record<string, number> = {},
): string[] {
  return Object.entries(edit.changes).flatMap(([uri, textEdits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
      return [];
    }

    if (!isSessionPathInWorkspace(rootPath, path)) {
      return [];
    }

    if (
      !isWorkspaceEditDocumentVersionCurrent(
        edit,
        rootPath,
        uri,
        documentVersionsByUri,
      )
    ) {
      return [];
    }

    const document = documents[path];

    if (!document) {
      return [];
    }

    return applyLanguageServerTextEdits(document.content, textEdits) ===
      document.content
      ? []
      : [path];
  });
}

function isWorkspaceEditDocumentVersionCurrent(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  uri: string,
  documentVersionsByUri: Record<string, number>,
): boolean {
  const editVersion = edit.documentVersions?.[uri];

  if (typeof editVersion !== "number") {
    return true;
  }

  return (
    documentVersionsByUri[languageServerUriSyncKey(rootPath, uri)] === editVersion
  );
}

function workspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    }),
  );
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    }),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) => {
    const uris =
      operation.kind === "rename"
        ? [operation.oldUri, operation.newUri]
        : [operation.uri];

    return uris.every((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    });
  });

  return {
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    ...(Object.keys(documentVersions).length > 0
      ? { documentVersions }
      : {}),
    changes,
  };
}

function workspaceEditWithoutPaths(
  edit: LanguageServerWorkspaceEdit,
  paths: string[],
): LanguageServerWorkspaceEdit {
  if (paths.length === 0) {
    return edit;
  }

  const skippedPaths = new Set(paths.map(normalizedSessionPath));
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return !path || !skippedPaths.has(normalizedSessionPath(path));
    }),
  );

  return {
    ...(edit.fileOperations && edit.fileOperations.length > 0
      ? { fileOperations: edit.fileOperations }
      : {}),
    ...(Object.keys(documentVersions).length > 0
      ? { documentVersions }
      : {}),
    changes: Object.fromEntries(
      Object.entries(edit.changes).filter(([uri]) => {
        const path = pathFromLanguageServerUri(uri);

        return !path || !skippedPaths.has(normalizedSessionPath(path));
      }),
    ),
  };
}

function directoryPathsForWorkspaceEditFileOperations(
  edit: LanguageServerWorkspaceEdit,
): string[] {
  const directories = new Set<string>();

  for (const operation of edit.fileOperations ?? []) {
    for (const path of pathsForWorkspaceFileOperation(operation)) {
      directories.add(getParentPath(path));
    }
  }

  return Array.from(directories);
}

function reconciledDocumentsForWorkspaceEditFileOperations(
  documents: Record<string, EditorDocument>,
  edit: LanguageServerWorkspaceEdit,
): Record<string, EditorDocument> {
  const operations = edit.fileOperations ?? [];
  let changed = false;
  const next: Record<string, EditorDocument> = {};

  for (const [path, document] of Object.entries(documents)) {
    const nextPath = reconciledPathForWorkspaceFileOperations(path, operations);

    if (!nextPath) {
      changed = true;
      continue;
    }

    if (nextPath === path) {
      next[path] = document;
      continue;
    }

    const renamedPathTextEdits =
      nextPath !== path ? textEditsForWorkspacePath(edit, nextPath) : null;
    const nextContent = renamedPathTextEdits
      ? applyLanguageServerTextEdits(document.content, renamedPathTextEdits)
      : document.content;

    changed = true;
    next[nextPath] = {
      ...document,
      content: nextContent,
      language: detectLanguage(nextPath),
      name: getFileName(nextPath),
      path: nextPath,
    };
  }

  return changed ? next : documents;
}

function textEditsForWorkspacePath(
  edit: LanguageServerWorkspaceEdit,
  path: string,
): LanguageServerTextEdit[] | null {
  const normalizedPath = normalizedSessionPath(path);

  for (const [uri, textEdits] of Object.entries(edit.changes)) {
    const editPath = pathFromLanguageServerUri(uri);

    if (editPath && normalizedSessionPath(editPath) === normalizedPath) {
      return textEdits;
    }
  }

  return null;
}

function reconciledEditorPathsForWorkspaceFileOperations(
  paths: string[],
  operations: LanguageServerWorkspaceFileOperation[],
): string[] {
  let changed = false;
  const next: string[] = [];

  for (const path of paths) {
    const nextPath = reconciledPathForWorkspaceFileOperations(path, operations);

    if (!nextPath) {
      changed = true;
      continue;
    }

    if (nextPath !== path) {
      changed = true;
    }

    if (next.includes(nextPath)) {
      changed = true;
      continue;
    }

    next.push(nextPath);
  }

  return changed ? next : paths;
}

function reconciledActivePathForWorkspaceFileOperations(
  activePath: string,
  openPaths: string[],
  previewPath: string | null,
  operations: LanguageServerWorkspaceFileOperation[],
): string | null {
  const nextActivePath = reconciledPathForWorkspaceFileOperations(
    activePath,
    operations,
  );

  if (nextActivePath) {
    return nextActivePath;
  }

  const nextVisiblePaths = reconciledEditorPathsForWorkspaceFileOperations(
    visibleEditorPaths(openPaths, previewPath),
    operations,
  );

  return nextVisiblePaths[nextVisiblePaths.length - 1] ?? null;
}

function reconciledPathForWorkspaceFileOperations(
  path: string,
  operations: LanguageServerWorkspaceFileOperation[],
): string | null {
  let nextPath: string | null = path;

  for (const operation of operations) {
    if (!nextPath) {
      return null;
    }

    if (operation.kind === "create") {
      continue;
    }

    if (operation.kind === "delete") {
      const deletedPath = pathFromLanguageServerUri(operation.uri);

      if (deletedPath && isSameOrChildWorkspacePath(nextPath, deletedPath)) {
        return null;
      }

      continue;
    }

    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);

    if (oldPath && newPath) {
      nextPath = replacedWorkspacePathPrefix(nextPath, oldPath, newPath);
    }
  }

  return nextPath;
}

function pathsForWorkspaceFileOperation(
  operation: LanguageServerWorkspaceFileOperation,
): string[] {
  if (operation.kind === "rename") {
    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);

    return oldPath && newPath ? [oldPath, newPath] : [];
  }

  const path = pathFromLanguageServerUri(operation.uri);

  return path ? [path] : [];
}

function replacedWorkspacePathPrefix(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  if (!isSameOrChildWorkspacePath(path, oldPath)) {
    return path;
  }

  const normalizedPath = normalizedSessionPath(path);
  const normalizedOldPath = normalizedSessionPath(oldPath);
  const normalizedNewPath = normalizedSessionPath(newPath);

  if (normalizedPath === normalizedOldPath) {
    return normalizedNewPath;
  }

  return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`;
}

function isSameOrChildWorkspacePath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizedSessionPath(path);
  const normalizedParentPath = normalizedSessionPath(parentPath);

  return (
    normalizedPath === normalizedParentPath ||
    normalizedPath.startsWith(`${normalizedParentPath}/`)
  );
}

function byteOffsetForLanguageServerPosition(
  content: string,
  position: LanguageServerPosition,
): number {
  let line = 0;
  let character = 0;

  for (let index = 0; index < content.length; ) {
    if (line === position.line && character === position.character) {
      return index;
    }

    const codePoint = content.codePointAt(index);

    if (codePoint === undefined) {
      break;
    }

    const value = String.fromCodePoint(codePoint);

    if (value === "\n") {
      line += 1;
      character = 0;
      index += value.length;
      continue;
    }

    character += value.length;
    index += value.length;
  }

  if (line === position.line && character === position.character) {
    return content.length;
  }

  throw new Error("Workspace edit position is outside of the document.");
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

function restoredActivePath(
  activePath: string | null,
  restoredPaths: string[],
): string | null {
  if (activePath && restoredPaths.includes(activePath)) {
    return activePath;
  }

  return restoredPaths[0] || null;
}

function cleanReplacementDocument(
  activeDocument: EditorDocument | null,
  documents: Record<string, EditorDocument>,
  openPaths: string[],
  previewPath: string | null,
): EditorDocument | null {
  if (
    activeDocument &&
    !isDirty(activeDocument) &&
    !openPaths.includes(activeDocument.path)
  ) {
    return activeDocument;
  }

  if (!previewPath) {
    return null;
  }

  if (openPaths.includes(previewPath)) {
    return null;
  }

  const previewDocument = documents[previewPath] ?? null;

  if (!previewDocument || isDirty(previewDocument)) {
    return null;
  }

  return previewDocument;
}

function gitDiffDocumentPath(change: GitChangedFile): string {
  const side = change.isStaged ? "staged" : "worktree";
  return `mockor-git-diff:${side}:${change.path}`;
}

function isGitDiffDocumentPath(path: string): boolean {
  return path.startsWith("mockor-git-diff:");
}

function gitChangesReferToSameDiff(
  change: GitChangedFile,
  selectedChange: GitChangedFile,
): boolean {
  return (
    gitDiffDocumentPath(change) === gitDiffDocumentPath(selectedChange) &&
    (change.path === selectedChange.path ||
      change.oldPath === selectedChange.path)
  );
}

function isPersistableEditorDocumentPath(path: string): boolean {
  return !path.startsWith("mockor-git-diff:") &&
    !path.startsWith("mockor-git-history-diff:");
}

function gitDiffDocument(change: GitChangedFile): EditorDocument {
  return {
    content: "",
    language: "plaintext",
    name: `Diff: ${getFileName(change.relativePath)}`,
    path: gitDiffDocumentPath(change),
    readOnly: true,
    savedContent: "",
  };
}

function gitChangeForDiffDocumentPath(
  path: string,
  changes: GitChangedFile[],
): GitChangedFile | null {
  return changes.find((change) => gitDiffDocumentPath(change) === path) ?? null;
}

function currentWorkspaceSession(
  rootPath: string,
  openPaths: string[],
  activePath: string | null,
  sidebarView: SidebarView,
  bottomPanelView: BottomPanelView,
): WorkspaceSessionState {
  const sessionPaths = openPaths.filter(
    (path) =>
      isPersistableEditorDocumentPath(path) &&
      isSessionPathInWorkspace(rootPath, path),
  );

  return {
    activePath:
      activePath && sessionPaths.includes(activePath) ? activePath : null,
    bottomPanelView: persistedBottomPanelView(bottomPanelView),
    openPaths: sessionPaths,
    sidebarView,
  };
}

function restoredBottomPanelView(
  view: WorkspaceSessionState["bottomPanelView"],
): WorkspaceSessionState["bottomPanelView"] {
  if (view === "terminal") {
    return "problems";
  }

  return view;
}

function persistedBottomPanelView(
  view: WorkspaceSessionState["bottomPanelView"],
): WorkspaceSessionState["bottomPanelView"] {
  if (view === "terminal") {
    return "problems";
  }

  return view;
}

function workspaceSessionsEqual(
  left: WorkspaceSessionState,
  right: WorkspaceSessionState,
): boolean {
  return (
    left.activePath === right.activePath &&
    left.bottomPanelView === right.bottomPanelView &&
    left.sidebarView === right.sidebarView &&
    left.openPaths.length === right.openPaths.length &&
    left.openPaths.every((path, index) => path === right.openPaths[index])
  );
}

function isSessionPathInWorkspace(rootPath: string, path: string): boolean {
  const root = normalizedSessionPath(rootPath);
  const candidate = normalizedSessionPath(path);

  if (candidate === root) {
    return true;
  }

  return candidate.startsWith(`${root}/`);
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

function phpNamedRouteCompletionInsertText(
  routeName: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return routeName;
  }

  return routeName.slice(lastDotIndex + 1);
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

function javaScriptTypeScriptImportPreferenceOptions(
  settings: WorkspaceSettings,
) {
  return {
    ...(settings.javaScriptTypeScriptImportModuleSpecifierPreference !==
    "shortest"
      ? {
          importModuleSpecifierPreference:
            settings.javaScriptTypeScriptImportModuleSpecifierPreference,
        }
      : {}),
    ...(settings.javaScriptTypeScriptImportModuleSpecifierEnding !== "auto"
      ? {
          importModuleSpecifierEnding:
            settings.javaScriptTypeScriptImportModuleSpecifierEnding,
        }
      : {}),
    ...(settings.javaScriptTypeScriptPreferTypeOnlyAutoImports
      ? {
          preferTypeOnlyAutoImports:
            settings.javaScriptTypeScriptPreferTypeOnlyAutoImports,
        }
      : {}),
    ...(settings.javaScriptTypeScriptQuotePreference !== "auto"
      ? { quotePreference: settings.javaScriptTypeScriptQuotePreference }
      : {}),
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

function phpLanguageServerOptions(settings: WorkspaceSettings) {
  return {
    intelephensePath: settings.intelephensePath,
    phpBackend: settings.phpBackend,
    phpactorPath: settings.phpactorPath,
  };
}

function cachedWorkspaceHasDirtyDocuments(
  cached: CachedWorkspaceWorkbenchState,
): boolean {
  return Object.values(cached.documents).some(isDirty);
}

function workspaceTabsWithPath(tabs: string[], path: string): string[] {
  if (workspaceTabPathForPath(tabs, path)) {
    return tabs;
  }

  return [...tabs, path];
}

function workspaceTabsWithoutPath(tabs: string[], path: string): string[] {
  return tabs.filter((tabPath) => !workspaceRootKeysEqual(tabPath, path));
}

function workspaceTabPathForPath(
  tabs: string[],
  path: string | null | undefined,
): string | null {
  return tabs.find((tabPath) => workspaceRootKeysEqual(tabPath, path)) ?? null;
}

function workspaceTabIndexForPath(
  tabs: string[],
  path: string | null | undefined,
): number {
  return tabs.findIndex((tabPath) => workspaceRootKeysEqual(tabPath, path));
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

function runtimeStatusRootPath(
  status: LanguageServerRuntimeStatus,
  fallbackRootPath?: string,
): string | null {
  if (status.rootPath) {
    return status.rootPath;
  }

  return status.kind === "stopped" ? (fallbackRootPath ?? null) : null;
}

function runtimeStatusForRequestedRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (status.rootPath && workspaceRootKeysEqual(status.rootPath, rootPath)) {
    return status;
  }

  return { kind: "stopped", rootPath };
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

const PHP_BUILTIN_TYPE_NAMES = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "parent",
  "self",
  "static",
  "string",
  "true",
  "void",
]);

type PhpAbstractMembersCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<{
  abstractMembers: Map<string, AbstractMemberToImplement>;
  satisfiedNames: Set<string>;
} | null>;

/**
 * Builds the "Implement methods" code action by resolving the abstract members
 * inherited from supertypes (cross-file, hence async) that the current class
 * has not yet implemented. Returns `null` when the class has no supertypes,
 * when resolution is dropped for a stale workspace, or when nothing is missing.
 */
async function phpImplementMethodsCodeAction(
  source: string,
  structure: PhpClassStructure,
  collect: PhpAbstractMembersCollector,
  isRequestedRootActive: () => boolean,
): Promise<PhpCodeActionDescriptor | null> {
  if (phpSuperTypeReferences(source).length === 0) {
    return null;
  }

  const collected = await collect(source, isRequestedRootActive);

  if (!isRequestedRootActive() || !collected) {
    return null;
  }

  const implementedNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingMembers = [...collected.abstractMembers.entries()]
    .filter(
      ([memberKey]) =>
        !implementedNames.has(memberKey) &&
        !collected.satisfiedNames.has(memberKey),
    )
    .map(([, entry]) => entry);

  if (missingMembers.length === 0) {
    return null;
  }

  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const stubs = renderImplementMethodsStubs(
    missingMembers.map((entry) => entry.member),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);
  const edits: PhpCodeActionTextEdit[] = [
    {
      range: zeroLengthPhpEditRange(insertionPosition),
      text: `${leadingBlankLine}${stubs}\n${trailingBlankLine}`,
    },
  ];

  const importEdit = phpImplementMethodsImportEdit(source, missingMembers);

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return { edits, kind: "refactor.rewrite", title: "Implement methods" };
}

type PhpOverridableParentMethodsCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<Map<string, AbstractMemberToImplement> | null>;

/**
 * Decides whether a parent method may be surfaced by "Override methods". A
 * method is overridable when it is concrete (a body to delegate to via
 * `parent::`), not sealed (`final`), not `private` (private members are not
 * inherited / overridable) and not the constructor (PhpStorm excludes
 * `__construct` from override generation — it is a creation concern, not a
 * behavioural override).
 */
function isPhpOverridableParentMethod(member: PhpMethodMember): boolean {
  if (member.isAbstract || member.isFinal) {
    return false;
  }

  if (member.visibility === "private") {
    return false;
  }

  return member.name.toLowerCase() !== "__construct";
}

/**
 * Collects every super-type reference that can carry an overridden method
 * declaration for "Go to Super Method": parent class / interfaces (extends and
 * implements), used traits and PHPDoc `@mixin` types. Walking all four mirrors
 * the resolution already used by direct method navigation and the override
 * code action.
 */
function phpSuperMethodHierarchyReferences(source: string): string[] {
  return [
    ...phpSuperTypeReferences(source),
    ...phpTraitClassNames(source),
    ...phpMixinClassNames(source),
  ];
}

/**
 * Builds the "Override methods" code action by resolving the concrete methods
 * inherited from the parent class chain (cross-file, hence async) that the
 * current class has not yet overridden. Each stub delegates to `parent::` so
 * the inherited behaviour is preserved by default. Returns `null` when the
 * class has no parent, when resolution is dropped for a stale workspace, or
 * when nothing overridable remains.
 */
async function phpOverrideMethodsCodeAction(
  source: string,
  structure: PhpClassStructure,
  collect: PhpOverridableParentMethodsCollector,
  isRequestedRootActive: () => boolean,
): Promise<PhpCodeActionDescriptor | null> {
  if (!phpExtendsClassName(source)) {
    return null;
  }

  const overridableMembers = await collect(source, isRequestedRootActive);

  if (!isRequestedRootActive() || !overridableMembers) {
    return null;
  }

  const declaredNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingMembers = [...overridableMembers.entries()]
    .filter(([memberKey]) => !declaredNames.has(memberKey))
    .map(([, entry]) => entry);

  if (missingMembers.length === 0) {
    return null;
  }

  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const stubs = renderOverrideMethodsStubs(
    missingMembers.map((entry) => entry.member),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);
  const edits: PhpCodeActionTextEdit[] = [
    {
      range: zeroLengthPhpEditRange(insertionPosition),
      text: `${leadingBlankLine}${stubs}\n${trailingBlankLine}`,
    },
  ];

  const importEdit = phpImplementMethodsImportEdit(source, missingMembers);

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return { edits, kind: "refactor.rewrite", title: "Override methods" };
}

/**
 * Offers "Generate getters and setters" for instance properties that are still
 * missing an accessor. Conservative: a property is skipped when the class
 * already declares any matching `getX` / `isX` (getter) AND `setX` (setter),
 * and the whole action is suppressed when nothing is missing.
 */
function phpGenerateAccessorsCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (instanceProperties.length === 0) {
    return null;
  }

  const methodNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingProperties = instanceProperties.filter(
    (property) => !phpPropertyHasAllAccessors(property, methodNames),
  );

  if (missingProperties.length === 0) {
    return null;
  }

  return phpClassBodyInsertionAction(
    source,
    renderAccessors(missingProperties, { mode: "both" }),
    "Generate getters and setters",
  );
}

function phpPropertyHasAllAccessors(
  property: PhpPropertyMember,
  methodNames: ReadonlySet<string>,
): boolean {
  const pascalName = phpPascalCasePropertyName(property.name);
  const hasGetter =
    methodNames.has(`get${pascalName}`.toLowerCase()) ||
    methodNames.has(`is${pascalName}`.toLowerCase());

  if (!hasGetter) {
    return false;
  }

  if (property.isReadonly) {
    return true;
  }

  return methodNames.has(`set${pascalName}`.toLowerCase());
}

function phpPascalCasePropertyName(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

/**
 * Offers "Generate constructor" when the class has instance properties and no
 * existing `__construct`.
 */
function phpGenerateConstructorCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (instanceProperties.length === 0) {
    return null;
  }

  const hasConstructor = structure.methods.some(
    (method) => method.name.toLowerCase() === "__construct",
  );

  if (hasConstructor) {
    return null;
  }

  return phpClassBodyInsertionAction(
    source,
    renderConstructor(instanceProperties),
    "Generate constructor",
  );
}

/**
 * Sibling of `phpGenerateConstructorCodeAction` that renders a PHP 8 constructor
 * with property promotion (each parameter carries the property's visibility /
 * `readonly` so the body stays empty). Offered under the SAME guard as the
 * classic action — a class with instance properties and no `__construct` — so
 * both variants appear together and the user picks the style. Conservative: a
 * class with no instance properties, or one that already declares a constructor,
 * yields no action.
 */
function phpGenerateConstructorWithPromotionCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (instanceProperties.length === 0) {
    return null;
  }

  const hasConstructor = structure.methods.some(
    (method) => method.name.toLowerCase() === "__construct",
  );

  if (hasConstructor) {
    return null;
  }

  return phpClassBodyInsertionAction(
    source,
    renderConstructor(instanceProperties, { promotion: true }),
    "Generate constructor with promotion",
  );
}

/**
 * Offers "Generate PHPDoc" (PhpStorm Generate -> PHPDoc) when the cursor sits on
 * a method that has no docblock. The docblock is synthesized from the native
 * signature (`@param` per parameter, `@return` from the return type) and spliced
 * as a zero-length insertion at the start of the method's declaration line, so it
 * lands directly above the method with the method's own indentation. Conservative:
 * a cursor not on any method, or a method that already carries a docblock, yields
 * no action (we never overwrite an existing docblock).
 */
function phpGeneratePhpDocCodeAction(
  source: string,
  structure: PhpClassStructure,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const method = phpMethodAtOffset(structure, range.start);

  if (!method || method.phpDoc) {
    return null;
  }

  // A no-parameter `void` / `never` method would render an empty `/** *\/`;
  // PhpStorm offers nothing for that, so neither do we.
  if (!generatedPhpDocHasContent(method)) {
    return null;
  }

  const lineStart = phpLineStartOffset(source, method.declarationOffset);
  const indent = phpLeadingIndent(source, lineStart);
  const docBlock = renderGeneratedPhpDoc(method, indent);
  const insertionPosition = offsetToPosition(source, lineStart);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: `${docBlock}\n`,
      },
    ],
    kind: "refactor.rewrite",
    title: "Generate PHPDoc",
  };
}

/**
 * Selects the method whose span (the member start - which covers any leading
 * attributes and modifier keywords above the `function` keyword - through to
 * just before the next method's member start, or the end of source) contains
 * the cursor offset. This lets "Generate PHPDoc" fire whether the cursor is on a
 * leading `#[Attribute]` line, a modifier (`public`) line, the signature, or
 * anywhere inside the body. Returns `null` when the cursor sits before the first
 * method (e.g. on the class declaration).
 */
function phpMethodAtOffset(
  structure: PhpClassStructure,
  offset: number,
): PhpMethodMember | null {
  const ordered = [...structure.methods].sort(
    (a, b) => a.memberStartOffset - b.memberStartOffset,
  );

  let match: PhpMethodMember | null = null;

  for (const method of ordered) {
    if (method.memberStartOffset > offset) {
      break;
    }

    match = method;
  }

  return match;
}

function phpLineStartOffset(source: string, offset: number): number {
  const previousNewline = source.lastIndexOf("\n", offset - 1);

  return previousNewline + 1;
}

function phpLeadingIndent(source: string, lineStart: number): string {
  const indentMatch = /^[ \t]*/.exec(source.slice(lineStart));

  return indentMatch?.[0] ?? "";
}

/**
 * Wraps a rendered class-body block in a zero-length insertion edit at the end
 * of the class body, matching the spacing convention of "Implement methods".
 */
function phpClassBodyInsertionAction(
  source: string,
  block: string,
  title: string,
  className?: string,
): PhpCodeActionDescriptor | null {
  const insertionPoint = findClassBodyInsertionOffset(source, className);

  if (!insertionPoint) {
    return null;
  }

  // The renderers emit column-0 member text; indent it to the class's own
  // member level (detected from the existing members, falling back to four
  // spaces) so generated methods line up like PhpStorm's, instead of landing at
  // column 1 in front of the closing brace.
  const indentedBlock = indentLines(
    block,
    detectClassMemberIndent(source, className),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: `${leadingBlankLine}${indentedBlock}\n${trailingBlankLine}`,
      },
    ],
    // Class-body generators ("Generate constructor / accessors") read as the
    // PhpStorm Generate family - a "refactor" in the action widget (distinct
    // icon / group from the quickfix lightbulb). "Create method/property from
    // usage" reuses this builder but re-stamps itself a preferred quickfix.
    kind: "refactor.rewrite",
    title,
  };
}

/**
 * Orders the aggregated PHP code actions so the most-likely action for the
 * cursor / selection leads the list (PhpStorm Alt+Enter "most likely first").
 * The order is a STABLE sort by kind family - contextual quickfixes, then
 * `extract` refactors, then `inline`, then `rewrite` (generate family + add
 * type), then the organize-imports source action, then anything unkinded -
 * which preserves each family's existing relative order (e.g. the alphabetical
 * import candidates) while floating the lightbulb fixes to the top. A single
 * `isPreferred` quickfix (Create method/property/Import) therefore wins the
 * first slot, matching the action Monaco offers as the lightbulb's auto-fix.
 */
function orderPhpCodeActions(
  actions: PhpCodeActionDescriptor[],
): PhpCodeActionDescriptor[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const byFamily =
        phpCodeActionFamilyRank(left.action) -
        phpCodeActionFamilyRank(right.action);

      if (byFamily !== 0) {
        return byFamily;
      }

      // Within a family a preferred action (the contextual fix) leads; ties keep
      // their original insertion order so nothing else is reshuffled.
      const byPreferred =
        Number(right.action.isPreferred ?? false) -
        Number(left.action.isPreferred ?? false);

      if (byPreferred !== 0) {
        return byPreferred;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

/**
 * Ranks a code action's kind family for "most likely first" ordering: contextual
 * quickfixes (0) lead, then extract (1) / inline (2) / rewrite (3) refactors, the
 * organize-imports source action (4), and any unkinded action (5) trails. The
 * kind defaults to `quickfix` to mirror the Monaco mapper's fallback.
 */
function phpCodeActionFamilyRank(action: PhpCodeActionDescriptor): number {
  const kind = action.kind ?? "quickfix";

  if (kind.startsWith("quickfix")) {
    return 0;
  }

  if (kind.startsWith("refactor.extract")) {
    return 1;
  }

  if (kind.startsWith("refactor.inline")) {
    return 2;
  }

  if (kind.startsWith("refactor")) {
    return 3;
  }

  if (kind.startsWith("source")) {
    return 4;
  }

  return 5;
}

/**
 * Offers "Create method '<name>'" / "Create property '<name>'" when the cursor
 * (the start of the request range) sits on a `$this->member(...)` call or a
 * `$this->member` access whose member does not yet exist on the enclosing class.
 * The member stub is synthesized from the usage (method parameter types inferred
 * conservatively from the call arguments) and spliced into the class body via
 * the same insertion point as the other class-body actions. Returns `null` when
 * the cursor is not on an unresolved member (the conservative detector decides).
 */
function phpCreateFromUsageCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const member = detectMissingThisMember(source, range.start);

  if (!member) {
    return null;
  }

  // A `parent::` usage targets the parent class's body. Only a SAME-FILE parent
  // is handled here: it is a pure single-file edit reusing the class-body
  // insertion (targeted at the parent class). A parent declared in another file
  // would need a cross-file write the in-document edit channel cannot express,
  // so it is conservatively dropped (no offer) - never a wrong / partial edit.
  if (member.target === "parent") {
    return phpCreateParentMemberCodeAction(source, member);
  }

  return phpCreateSelfMemberCodeAction(source, member);
}

/**
 * Build the "Create ..." action for a `$this->` / `self::` / `static::` usage -
 * a member synthesized into the enclosing class itself (single-file). Static
 * receivers stamp the `static` modifier on a method; a non-call `self::IDENT`
 * is a class constant; a `$this->prop = <typed expr>` carries an inferred type.
 */
function phpCreateSelfMemberCodeAction(
  source: string,
  member: MissingThisMember,
): PhpCodeActionDescriptor | null {
  if (member.kind === "constant") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateConstantStub(member.name, { indent: "" }),
        `Create constant '${member.name}'`,
      ),
    );
  }

  if (member.kind === "method") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateMethodStub(member.name, member.argTypes ?? [], {
          indent: "",
          isStatic: member.isStatic,
        }),
        `Create method '${member.name}'`,
      ),
    );
  }

  return phpPreferredQuickfix(
    phpClassBodyInsertionAction(
      source,
      renderCreatePropertyStub(member.name, {
        indent: "",
        type: member.propertyType ?? null,
      }),
      `Create property '${member.name}'`,
    ),
  );
}

/**
 * Build the "Create ..." action for a `parent::` usage when the parent class is
 * declared in the SAME file. Resolves the parent's short name (the in-file
 * insertion is keyed by class name) and inserts the member into the parent's
 * body. Returns `null` (no offer) when the parent is not present in this file -
 * a cross-file parent edit is conservatively out of scope.
 */
function phpCreateParentMemberCodeAction(
  source: string,
  member: MissingThisMember,
): PhpCodeActionDescriptor | null {
  const parentName = member.parentClass;

  if (!parentName) {
    return null;
  }

  const parentShortName = phpShortClassName(parentName);
  const insertion = findClassBodyInsertionOffset(source, parentShortName);

  if (!insertion) {
    return null;
  }

  // A same-file parent may already declare the member (its body is in this
  // source); suppress the offer in that case so we never create a duplicate.
  // The check is scoped to the parent class so a sibling class's member of the
  // same name does not falsely suppress it.
  if (phpClassDeclaresMember(source, member.name, member.kind, parentShortName)) {
    return null;
  }

  if (member.kind === "constant") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateConstantStub(member.name, { indent: "" }),
        `Create constant '${member.name}' in '${parentShortName}'`,
        parentShortName,
      ),
    );
  }

  if (member.kind === "method") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateMethodStub(member.name, member.argTypes ?? [], {
          indent: "",
        }),
        `Create method '${member.name}' in '${parentShortName}'`,
        parentShortName,
      ),
    );
  }

  // PHP has no `parent::$property` access, so a parent target is only ever a
  // method or a constant. Anything else is dropped defensively (no offer)
  // rather than emitting a property that could never have been referenced.
  return null;
}

/**
 * Short (un-namespaced) class name for an `extends` reference like
 * `App\Base\Service` or `\Service`. The in-file class-body insertion locates a
 * class by its declared (short) name, so a namespaced parent reference is
 * reduced to its last segment.
 */
function phpShortClassName(reference: string): string {
  const segments = reference.split("\\").filter((segment) => segment.length > 0);

  return segments[segments.length - 1] ?? reference;
}

/**
 * Stamps a class-body insertion action as a preferred quickfix (the contextual
 * fix for an unresolved symbol). Passes a `null` plan through unchanged so the
 * conservative "offer nothing" path is preserved.
 */
function phpPreferredQuickfix(
  action: PhpCodeActionDescriptor | null,
): PhpCodeActionDescriptor | null {
  if (!action) {
    return null;
  }

  return { ...action, isPreferred: true, kind: "quickfix" };
}

/**
 * Namespace prefixes "Create class" must never write into even when a project
 * PSR-4 root happens to cover them: a `Composer\` autoload entry pointing at a
 * vendored package, or the framework's own `Illuminate\` / `Symfony\` roots.
 * Defensive - a normal app maps these via the `packages` list (which the
 * destination mapper does not consult), so this only matters when a root maps
 * one of these directly.
 */
const VENDOR_PSR4_PREFIXES = ["Composer\\", "Illuminate\\", "Symfony\\"];

/**
 * Conservative set of PHP built-in / SPL / common-extension type names that
 * "Create class" must never offer to create (they already exist at runtime and
 * have no workspace source file). Lower-cased, short-name keyed: a reference is
 * a built-in when its FQN is global (no namespace) and its short name is in this
 * set. Namespaced user types of the same short name (e.g. `App\Exception`) are
 * unaffected. Not exhaustive - it covers the high-frequency names a developer
 * is most likely to reference; anything else still falls through to the
 * existence + PSR-4 guards.
 */
const PHP_BUILTIN_CLASS_NAMES = new Set(
  [
    "stdClass",
    "Closure",
    "Generator",
    "Stringable",
    "Iterator",
    "IteratorAggregate",
    "Traversable",
    "Countable",
    "ArrayAccess",
    "ArrayObject",
    "ArrayIterator",
    "JsonSerializable",
    "Serializable",
    "SplStack",
    "SplQueue",
    "SplObjectStorage",
    "SplFixedArray",
    "SplDoublyLinkedList",
    "SplPriorityQueue",
    "SplHeap",
    "SplMinHeap",
    "SplMaxHeap",
    "WeakMap",
    "WeakReference",
    "DateTime",
    "DateTimeImmutable",
    "DateTimeInterface",
    "DateInterval",
    "DateTimeZone",
    "DatePeriod",
    "Throwable",
    "Exception",
    "Error",
    "TypeError",
    "ValueError",
    "ArgumentCountError",
    "ArithmeticError",
    "DivisionByZeroError",
    "ErrorException",
    "RuntimeException",
    "LogicException",
    "InvalidArgumentException",
    "OutOfRangeException",
    "OutOfBoundsException",
    "LengthException",
    "DomainException",
    "RangeException",
    "UnexpectedValueException",
    "UnderflowException",
    "OverflowException",
    "BadFunctionCallException",
    "BadMethodCallException",
    "UnhandledMatchError",
    "JsonException",
    "ReflectionClass",
    "ReflectionMethod",
    "ReflectionProperty",
    "ReflectionFunction",
    "ReflectionParameter",
    "ReflectionNamedType",
    "ReflectionEnum",
    "PDO",
    "PDOStatement",
    "PDOException",
    "SimpleXMLElement",
    "DOMDocument",
    "DOMElement",
    "DOMNode",
    "UnitEnum",
    "BackedEnum",
  ].map((name) => name.toLowerCase()),
);

/**
 * Whether `fqn` names a PHP built-in type. Only a GLOBAL (un-namespaced) name is
 * treated as built-in - a namespaced `App\Exception` is a user type and remains
 * creatable. A leading `\` (already stripped by the resolver, but tolerated
 * here) does not make a name namespaced.
 */
function isPhpBuiltinTypeName(fqn: string): boolean {
  const normalized = fqn.trim().replace(/^\\+/, "");

  if (normalized.includes("\\")) {
    return false;
  }

  return PHP_BUILTIN_CLASS_NAMES.has(normalized.toLowerCase());
}

/**
 * Offers "Extract variable" when the request carries a non-empty selection that
 * `planExtractVariable` confirms is a usable expression. The plan yields two
 * non-overlapping edits applied against the original document: a declaration
 * inserted on its own line before the enclosing statement, and a replacement of
 * the selected expression with the new variable reference. Returns `null` for
 * an empty selection or any selection the conservative planner rejects.
 */
function phpExtractVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  if (range.start >= range.end) {
    return null;
  }

  const plan = planExtractVariable(source, range.start, range.end);

  if (!plan) {
    return null;
  }

  const declarationPosition = offsetToPosition(source, plan.declarationOffset);
  const replaceStartPosition = offsetToPosition(source, plan.replaceStart);
  const replaceEndPosition = offsetToPosition(source, plan.replaceEnd);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(declarationPosition),
        text: plan.declarationText,
      },
      {
        range: {
          endColumn: replaceEndPosition.column + 1,
          endLineNumber: replaceEndPosition.line + 1,
          startColumn: replaceStartPosition.column + 1,
          startLineNumber: replaceStartPosition.line + 1,
        },
        text: plan.replacementText,
      },
    ],
    kind: "refactor.extract",
    title: "Extract variable",
  };
}

/**
 * Offers "Extract method" when the request carries a non-empty selection of one
 * or more whole statements inside a class method that `planExtractMethod`
 * confirms is safe to lift. The plan yields two non-overlapping edits against
 * the original document: the selected statements are replaced by a call to a new
 * private method (`$this->extracted(...)`, optionally assigned to the single
 * returned variable), and the method definition is inserted immediately after
 * the enclosing method. Returns `null` for an empty selection or any selection
 * the conservative planner rejects (cross-boundary, partial block, multiple
 * outputs, control-flow escape, heredoc, ...).
 */
function phpExtractMethodCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  if (range.start >= range.end) {
    return null;
  }

  const plan = planExtractMethod(source, range.start, range.end);

  if (!plan) {
    return null;
  }

  const replaceStartPosition = offsetToPosition(source, plan.replaceStart);
  const replaceEndPosition = offsetToPosition(source, plan.replaceEnd);
  const insertionPosition = offsetToPosition(source, plan.methodInsertionOffset);

  return {
    edits: [
      {
        range: {
          endColumn: replaceEndPosition.column + 1,
          endLineNumber: replaceEndPosition.line + 1,
          startColumn: replaceStartPosition.column + 1,
          startLineNumber: replaceStartPosition.line + 1,
        },
        text: plan.replacementText,
      },
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.methodText,
      },
    ],
    kind: "refactor.extract",
    title: "Extract method",
  };
}

/**
 * Offers "Extract interface" (PhpStorm) when the cursor sits on a concrete
 * `class` declaration that exposes at least one public instance method. The
 * `planExtractInterface` planner synthesises a sibling `<Class>Interface.php`
 * (carrying the public-instance-method signatures) and the in-place edit that
 * adds `implements <Class>Interface` to the class header. The resulting action
 * therefore CREATES a file (the new interface) and EDITS the current document
 * (the implements clause). Returns `null` for any shape the conservative
 * planner rejects (abstract class / interface / trait / enum, no public
 * instance methods, parse failure, cursor outside a class) so the action is
 * never offered where it could create an empty or malformed interface.
 *
 * `sourcePath` is the active document's absolute path; without it the sibling
 * interface path cannot be derived, so the action is not offered.
 */
function phpExtractInterfaceCodeAction(
  source: string,
  range: PhpCodeActionRange,
  sourcePath: string | null,
): PhpCodeActionDescriptor | null {
  if (!sourcePath) {
    return null;
  }

  const plan = planExtractInterface(source, range.start, sourcePath);

  if (!plan) {
    return null;
  }

  const implementsPosition = offsetToPosition(
    source,
    plan.implementsEdit.offset,
  );

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(implementsPosition),
        text: plan.implementsEdit.text,
      },
    ],
    kind: "refactor.extract",
    newFile: {
      content: plan.interfaceText,
      path: plan.interfaceFilePath,
    },
    title: "Extract interface",
  };
}

/**
 * Offers "Add parameter" (Change Signature - slice 1) when the request's cursor
 * sits on the signature or inside the body of a class method or free function
 * that `planAddParameter` confirms can safely receive an appended OPTIONAL
 * parameter. The plan is a single zero-length insertion that appends a
 * placeholder `$parameter = null` to the END of the parameter list. Because the
 * appended parameter is optional (carries a default), every existing call-site
 * stays valid - so this is a pure single-file refactor with no cross-file edits.
 * Returns `null` for any shape the conservative planner rejects (abstract /
 * interface declaration, trailing variadic, unbalanced signature, cursor not on
 * a function) so the action is never offered where it could corrupt the file or
 * require call-site changes.
 */
function phpAddParameterCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddParameter(source, range.start);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.insertOffset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.insertText,
      },
    ],
    kind: "refactor.rewrite",
    title: "Add parameter",
  };
}

/**
 * Offers "Add return type" when the cursor sits on a method / function (or an
 * abstract / interface declaration) that declares NO return type and whose type
 * `planAddReturnType` can infer UNAMBIGUOUSLY - from a PHPDoc `@return`, or from
 * literal-only `return` statements that all agree (`void`, a `new Foo()` class,
 * `static`, or a scalar/array literal). The plan is a single zero-length
 * insertion of `: Type` after the close `)`. Returns `null` for any shape the
 * conservative planner rejects (a mixed / variable / call return, a lone
 * `return null`, an already-typed signature, the cursor off any function) so a
 * wrong type is never inserted.
 */
function phpAddReturnTypeCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddReturnType(source, range.start);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.insertOffset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.insertText,
      },
    ],
    kind: "refactor.rewrite",
    title: "Add return type",
  };
}

/**
 * Offers "Add type hint" when the cursor sits inside the parameter list, on a
 * parameter that declares NO type and whose type `planAddParameterType` can
 * infer UNAMBIGUOUSLY - from a PHPDoc `@param`, or from a literal default value
 * (`[]` -> `array`, `'x'` -> `string`, `123` -> `int`, `1.5` -> `float`,
 * `true`/`false` -> `bool`). The plan is a single zero-length insertion of
 * `Type ` before the parameter token (after any promotion modifiers). Returns
 * `null` for an already-typed parameter, an ambiguous `= null` default, a
 * parameter with no usable signal, or the cursor outside the parameter list.
 */
function phpAddParameterTypeCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planAddParameterType(source, range.start);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.insertOffset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.insertText,
      },
    ],
    kind: "refactor.rewrite",
    title: "Add type hint",
  };
}

/**
 * Offers "Inline variable" when the request's cursor (the start offset) sits on
 * a local variable that `planInlineVariable` confirms has a single, plain
 * `$var = <expr>;` declaration. The plan yields non-overlapping edits against the
 * original document: the declaration line is deleted and every usage of `$var`
 * is replaced with `<expr>` (parenthesised where precedence requires). Returns
 * `null` for any position the conservative planner rejects (multiple
 * assignments, compound/foreach declaration, side-effecting value used more than
 * once, …) so the action is never offered when inlining could change behaviour.
 */
function phpInlineVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planInlineVariable(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: plan.edits.map((edit) => {
      const startPosition = offsetToPosition(source, edit.start);
      const endPosition = offsetToPosition(source, edit.end);

      return {
        range: {
          endColumn: endPosition.column + 1,
          endLineNumber: endPosition.line + 1,
          startColumn: startPosition.column + 1,
          startLineNumber: startPosition.line + 1,
        },
        text: edit.text,
      };
    }),
    kind: "refactor.inline",
    title: "Inline variable",
  };
}

/**
 * Offers "Introduce constant" when the request's cursor (the start offset) sits
 * on a scalar literal inside a class body. The plan yields two non-overlapping
 * edits against the original document: a `private const NAME = <literal>;`
 * declaration inserted at the top of the class body, and a replacement of the
 * literal with `self::NAME`. Returns `null` when the conservative planner
 * rejects the position (no literal, outside a class).
 */
function phpIntroduceConstantCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planIntroduceConstant(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: phpIntroduceMemberEdits(source, plan),
    kind: "refactor.extract",
    title: "Introduce constant",
  };
}

/**
 * Offers "Introduce field" when the request's cursor sits on a scalar literal
 * (lifted to a `private <type?> $name = <literal>;` property) or on a local
 * variable assignment (promoted to a `private <type?> $name;` property with the
 * assignment target rewritten). The plan yields a declaration inserted at the
 * top of the class body and a replacement of the literal / variable with
 * `$this->name`. Returns `null` when the conservative planner rejects the
 * position.
 */
function phpIntroduceFieldCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const plan = planIntroduceField(source, range.start);

  if (!plan) {
    return null;
  }

  return {
    edits: phpIntroduceMemberEdits(source, plan),
    kind: "refactor.extract",
    title: "Introduce field",
  };
}

/**
 * Translates an introduce-member plan (shared shape between constant and field)
 * into the two Monaco text edits: a zero-length declaration insert at the top of
 * the class body and a span replacement of the original literal / variable.
 */
function phpIntroduceMemberEdits(
  source: string,
  plan: {
    declarationOffset: number;
    declarationText: string;
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
  },
): PhpCodeActionTextEdit[] {
  const declarationPosition = offsetToPosition(source, plan.declarationOffset);
  const replaceStartPosition = offsetToPosition(source, plan.replaceStart);
  const replaceEndPosition = offsetToPosition(source, plan.replaceEnd);

  return [
    {
      range: zeroLengthPhpEditRange(declarationPosition),
      text: plan.declarationText,
    },
    {
      range: {
        endColumn: replaceEndPosition.column + 1,
        endLineNumber: replaceEndPosition.line + 1,
        startColumn: replaceStartPosition.column + 1,
        startLineNumber: replaceStartPosition.line + 1,
      },
      text: plan.replacementText,
    },
  ];
}

/**
 * Returns the bare (single-segment) short class name under the cursor that is a
 * candidate for an "Import class" quickfix, or `null` when it should not be
 * offered. Conservative gates, in order:
 *  - the cursor must sit on a `classIdentifier` reference (method calls,
 *    property/static accesses, Laravel string helpers etc. are excluded by
 *    {@link phpClassIdentifierNameAt});
 *  - the name must be unqualified (no `\`) - a qualified reference already names
 *    its namespace, so no `use` is needed;
 *  - the name must NOT already be imported by a top-level `use` (alias-aware).
 */
function phpImportClassShortNameAt(
  source: string,
  range: PhpCodeActionRange,
): string | null {
  const shortName = phpClassIdentifierNameAt(source, range.start);

  if (!shortName || shortName.includes("\\")) {
    return null;
  }

  if (phpShortNameIsImported(source, shortName)) {
    return null;
  }

  return shortName;
}

/**
 * Builds the "Import \\Fully\\Qualified\\Name" code actions for an unimported
 * class reference. Pure: the indexed candidate FQNs are resolved by the caller
 * (workspace symbol index) and passed in. A candidate is offered only when it is
 * namespaced AND its namespace differs from the file's current namespace (a
 * same-namespace class needs no `use`); duplicates are de-duplicated and the
 * actions are ordered alphabetically by FQN so an ambiguous short name yields a
 * stable list of choices. Each action inserts `use FQN;` into the existing use
 * block in sorted order (or starts a fresh block) via {@link planPhpAddImport}.
 */
function phpImportClassCodeActions(
  source: string,
  candidateFqns: readonly string[],
): PhpCodeActionDescriptor[] {
  const currentNamespace = (phpCurrentNamespace(source) ?? "").toLowerCase();
  const seen = new Set<string>();
  const actions: PhpCodeActionDescriptor[] = [];

  for (const candidate of candidateFqns) {
    const fqn = candidate.trim().replace(/^\\+/, "");

    if (!fqn.includes("\\")) {
      continue;
    }

    const key = fqn.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const namespacePart = fqn.slice(0, fqn.lastIndexOf("\\")).toLowerCase();

    if (namespacePart === currentNamespace) {
      continue;
    }

    const action = phpImportClassCodeAction(source, fqn);

    if (action) {
      actions.push(action);
    }
  }

  const sorted = actions.sort((a, b) => a.title.localeCompare(b.title));

  // Monaco honours a SINGLE preferred action; with several import candidates for
  // an ambiguous short name only the first (alphabetically) stays preferred so
  // the others remain plain quickfix choices the user can still pick.
  return sorted.map((action, index) =>
    index === 0 ? action : { ...action, isPreferred: false },
  );
}

function phpImportClassCodeAction(
  source: string,
  fqn: string,
): PhpCodeActionDescriptor | null {
  const plan = planPhpAddImport(source, fqn);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.offset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.text,
      },
    ],
    // Importing the class is the contextual fix for an unresolved short name, so
    // it reads as a preferred quickfix (PhpStorm Alt+Enter -> Import at the top).
    isPreferred: true,
    kind: "quickfix",
    title: `Import ${fqn}`,
  };
}

/**
 * Offers "Remove unused import" when the cursor sits on a conservatively
 * detected unused class import (pairs with the unused-import inspection). The
 * edit deletes the whole `use ...;` statement and its trailing newline.
 * Conservative: only single, non-grouped class imports are ever offered (see
 * `phpUnusedImportRemovalAt` / `phpUnusedClassImports`).
 */
function phpRemoveUnusedImportCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedImportRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused import ${removal.label}`,
  };
}

/**
 * Offers "Remove unused method" when the cursor sits on a conservatively
 * detected unused private method (pairs with the unused-private-method
 * inspection). The edit deletes the whole method declaration (decorating lines
 * through the body's closing brace). Conservative: suppressed for any class
 * with dynamic dispatch and skipped when the body brace cannot be matched.
 */
function phpRemoveUnusedMethodCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedPrivateMethodRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused method '${removal.label}'`,
  };
}

/**
 * Offers "Remove unused variable" when the cursor sits on a conservatively
 * detected unused local whose assignment is side-effect-free (pairs with the
 * unused-variable inspection). The edit deletes the whole assignment statement
 * line. Conservative: returns null for an assignment with any potential side
 * effect (call / member access / non-trivial RHS) - those are warned but never
 * auto-removed, because deleting them would drop the side-effecting call.
 */
function phpRemoveUnusedVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedVariableRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused variable ${removal.label}`,
  };
}

/** Maps a character-offset removal span to a single empty-text Monaco edit. */
function removalEdit(
  source: string,
  removal: { end: number; start: number },
): PhpCodeActionTextEdit {
  const startPosition = offsetToPosition(source, removal.start);
  const endPosition = offsetToPosition(source, removal.end);

  return {
    range: {
      endColumn: endPosition.column + 1,
      endLineNumber: endPosition.line + 1,
      startColumn: startPosition.column + 1,
      startLineNumber: startPosition.line + 1,
    },
    text: "",
  };
}

/**
 * Offers "Optimize imports" when `organizePhpImports` reports a change (unused
 * imports removed and/or reordering). The edit replaces the exact span of the
 * existing top-level `use` block with the organized block. The action is
 * skipped when that span cannot be located confidently.
 */
function phpOptimizeImportsCodeAction(
  source: string,
): PhpCodeActionDescriptor | null {
  const organized = organizePhpImports(source);

  if (!organized || !organized.changed) {
    return null;
  }

  const useBlockRange = phpTopLevelUseBlockRange(source);

  if (!useBlockRange) {
    return null;
  }

  const startPosition = offsetToPosition(source, useBlockRange.start);
  const endPosition = offsetToPosition(source, useBlockRange.end);

  return {
    edits: [
      {
        range: {
          endColumn: endPosition.column + 1,
          endLineNumber: endPosition.line + 1,
          startColumn: startPosition.column + 1,
          startLineNumber: startPosition.line + 1,
        },
        text: organized.organizedUseBlock,
      },
    ],
    kind: "source.organizeImports",
    title: "Optimize imports",
  };
}

/**
 * Conservatively locates the contiguous span covering the existing top-level
 * `use` statements: from the start of the first `use` line to the end of the
 * last `use` statement (before the first type body opens). Returns `null` when
 * no top-level `use` statement is found.
 */
function phpTopLevelUseBlockRange(
  source: string,
): { end: number; start: number } | null {
  const masked = phpMaskStringsAndComments(source);
  const bodyLimit = phpFirstTypeBodyOffset(masked);
  const spans: Array<{ end: number; start: number }> = [];

  for (const match of masked.matchAll(/(^|\n)([ \t]*)use\b[^;]*;/g)) {
    const lineStart = (match.index ?? 0) + match[1].length;

    if (lineStart >= bodyLimit) {
      break;
    }

    if (!phpUseStatementIsTopLevel(masked, lineStart)) {
      continue;
    }

    spans.push({
      end: lineStart + (match[0].length - match[1].length),
      start: lineStart,
    });
  }

  if (spans.length === 0) {
    return null;
  }

  if (!phpUseSpansAreContiguous(source, spans)) {
    return null;
  }

  return { end: spans[spans.length - 1].end, start: spans[0].start };
}

/**
 * Guards the optimize-imports replacement: only treat the span from the first
 * to the last `use` as safe to overwrite when the gaps BETWEEN the statements
 * (in the ORIGINAL source) hold nothing but whitespace. This protects trailing
 * comments and any stray top-level content from being silently deleted; when a
 * gap is non-empty the action is suppressed (conservative no-op).
 */
function phpUseSpansAreContiguous(
  source: string,
  spans: ReadonlyArray<{ end: number; start: number }>,
): boolean {
  for (let index = 1; index < spans.length; index += 1) {
    const gap = source.slice(spans[index - 1].end, spans[index].start);

    if (gap.trim().length > 0) {
      return false;
    }
  }

  return true;
}

function phpUseStatementIsTopLevel(masked: string, offset: number): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < offset && index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return braceDepth === 0 && parenDepth === 0;
}

function phpFirstTypeBodyOffset(masked: string): number {
  const match =
    /(?<![:\\$>A-Za-z0-9_])(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
      masked,
    );

  if (!match) {
    return masked.length;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  if (bodyStart < 0) {
    return masked.length;
  }

  return bodyStart + 1;
}

function phpMaskStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && next !== "[" && source[index - 1] !== "$") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function zeroLengthPhpEditRange(position: {
  column: number;
  line: number;
}): PhpCodeActionTextEditRange {
  return {
    endColumn: position.column + 1,
    endLineNumber: position.line + 1,
    startColumn: position.column + 1,
    startLineNumber: position.line + 1,
  };
}

function isPathInDirectory(path: string, directoryPath: string): boolean {
  return (
    path === directoryPath || path.startsWith(`${directoryPath.replace(/\/+$/, "")}/`)
  );
}

function remapPathForDirectoryRename(
  path: string,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): string {
  const normalizedOldDirectoryPath = oldDirectoryPath.replace(/\/+$/, "");

  if (path === normalizedOldDirectoryPath) {
    return newDirectoryPath;
  }

  const oldPrefix = `${normalizedOldDirectoryPath}/`;

  if (!path.startsWith(oldPrefix)) {
    return path;
  }

  return `${newDirectoryPath}${path.slice(normalizedOldDirectoryPath.length)}`;
}

function remapPathSetForDirectoryRename(
  paths: Set<string>,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): Set<string> {
  const next = new Set<string>();

  for (const path of paths) {
    next.add(remapPathForDirectoryRename(path, oldDirectoryPath, newDirectoryPath));
  }

  return next;
}

function remapEntriesByDirectoryForDirectoryRename(
  entriesByDirectory: Record<string, FileEntry[]>,
  oldDirectoryPath: string,
  newDirectoryPath: string,
): Record<string, FileEntry[]> {
  const next: Record<string, FileEntry[]> = {};

  for (const [directoryPath, entries] of Object.entries(entriesByDirectory)) {
    const nextDirectoryPath = remapPathForDirectoryRename(
      directoryPath,
      oldDirectoryPath,
      newDirectoryPath,
    );

    next[nextDirectoryPath] = entries.map((entry) => {
      const nextEntryPath = remapPathForDirectoryRename(
        entry.path,
        oldDirectoryPath,
        newDirectoryPath,
      );

      if (nextEntryPath === entry.path) {
        return entry;
      }

      return {
        ...entry,
        name: getFileName(nextEntryPath),
        path: nextEntryPath,
      };
    });
  }

  return next;
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
function phpImplementMethodsImportEdit(
  classSource: string,
  missingMembers: AbstractMemberToImplement[],
): PhpCodeActionTextEdit | null {
  const requiredFqns = new Set<string>();

  for (const entry of missingMembers) {
    for (const token of phpSignatureClassTypeTokens(entry.member)) {
      const fqn = phpResolvedImportableFqn(entry.declaringSource, token);

      if (!fqn) {
        continue;
      }

      if (shortPhpName(fqn).toLowerCase() !== token.toLowerCase()) {
        continue;
      }

      if (phpTypeTokenAlreadyResolvable(classSource, token, fqn)) {
        continue;
      }

      requiredFqns.add(fqn);
    }
  }

  if (requiredFqns.size === 0) {
    return null;
  }

  const insertionPoint = findUseImportInsertionOffset(classSource);

  if (!insertionPoint) {
    return null;
  }

  const importLines = renderUseImports([...requiredFqns]);

  if (!importLines) {
    return null;
  }

  const insertionPosition = offsetToPosition(classSource, insertionPoint.offset);
  const leadingNewline = insertionPoint.needsLeadingNewline ? "\n" : "";

  return {
    range: zeroLengthPhpEditRange(insertionPosition),
    text: `${leadingNewline}${importLines}\n`,
  };
}

function phpSignatureClassTypeTokens(member: PhpMethodMember): string[] {
  const types = [
    ...member.parameters.map((parameter) => parameter.type),
    member.returnType,
  ];

  return types.flatMap(phpClassTypeTokensFromType);
}

function phpClassTypeTokensFromType(type: string | null): string[] {
  if (!type) {
    return [];
  }

  return type
    .replace(/^\?/, "")
    .split(/[|&]/)
    .map((part) => part.trim().replace(/^\?/, "").replace(/^\\+/, ""))
    .filter(
      (part) =>
        /^[A-Za-z_][A-Za-z0-9_\\]*$/.test(part) &&
        !PHP_BUILTIN_TYPE_NAMES.has(part.toLowerCase()),
    );
}

function phpResolvedImportableFqn(
  declaringSource: string,
  token: string,
): string | null {
  const resolved = resolvePhpClassName(declaringSource, token);

  if (!resolved) {
    return null;
  }

  const normalized = resolved.trim().replace(/^\\+/, "");

  return normalized.includes("\\") ? normalized : null;
}

function phpTypeTokenAlreadyResolvable(
  classSource: string,
  token: string,
  fqn: string,
): boolean {
  const resolved = resolvePhpClassName(classSource, token);

  if (!resolved) {
    return false;
  }

  return (
    resolved.trim().replace(/^\\+/, "").toLowerCase() === fqn.toLowerCase()
  );
}

function missingTestPartnerMessage(
  direction: PhpTestNavigationDirection,
): string {
  if (direction === "toSubject") {
    return "No test subject found for this test. Create the class first.";
  }

  return "No test found for this class. Run Generate Test to create one.";
}
