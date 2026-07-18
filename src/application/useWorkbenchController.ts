import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useEditorSessionState } from "./useEditorSessionState";
import { canRevertGitChangeForDocuments } from "./gitRevertCapability";
import { useChangedDocumentSyncScheduling } from "./useChangedDocumentSyncScheduling";
import type { EditorGroupFocusRunner } from "./editorGroupFocusPort";
import { useGitStashPanel } from "./useGitStashPanel";
import { useGitBranchPanel } from "./useGitBranchPanel";
import { useFloatingSurfaces } from "./useFloatingSurfaces";
import { useGitWorkspace } from "./useGitWorkspace";
import {
  gitChangeForDiffDocumentPath,
  isGitDiffDocumentPath,
  useGitDiffWorkspace,
} from "./useGitDiffWorkspace";
import { useGitDiffPreviewCloseLifecycle } from "./useGitDiffPreviewCloseLifecycle";
import { useGitStatusSurface } from "./useGitStatusSurface";
import { useGitOperationCurrency } from "./useGitOperationCurrency";
import {
  runEslintDisableAtCursor,
  type EditorSurfaceEslintDisableRunner,
} from "./workbenchEslintDisableCommand";
import { useWorkbenchCommandRegistry } from "./useWorkbenchCommandRegistry";
import { useDebugSession } from "./useDebugSession";
import { detectJsTestRunner } from "./jsTestRunnerDetection";
import {
  isDebuggableNodeScriptPath,
  isDebuggablePhpScriptPath,
} from "./workbenchDebugCommands";
import {
  executeCommandAndReport,
  type CommandExecutionRunner,
} from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";
import { useWorkbenchNativeMenuCommands } from "./useWorkbenchNativeMenuCommands";
import { useWorkbenchIndexLifecycle } from "./useWorkbenchIndexLifecycle";
import { useWorkbenchPintCommand } from "./useWorkbenchPintCommand";
import { useWorkspaceTodos } from "./useWorkspaceTodos";
import { usePhpFrameworkTargets } from "./usePhpFrameworkTargets";
import { usePhpFrameworkSourceRegistries } from "./usePhpFrameworkSourceRegistries";
import {
  createPhpFrameworkBindingFileChangeInvalidator,
  phpFrameworkBindingEditorChangeRequiresInvalidation,
} from "./phpFrameworkBindingInvalidation";
import { usePhpFrameworkDefinitionNavigation } from "./usePhpFrameworkDefinitionNavigation";
import { usePhpFrameworkModelNavigationTargets } from "./usePhpFrameworkModelNavigationTargets";
import { usePhpLaravelModelNavigationTargets } from "./usePhpLaravelModelNavigationTargets";
import { usePhpContextualMemberDefinitionNavigation } from "./usePhpContextualMemberDefinitionNavigation";
import { usePhpMemberPropertyDefinitionNavigation } from "./usePhpMemberPropertyDefinitionNavigation";
import { usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation } from "./usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation";
import { usePhpContextualFrameworkLiteralDefinitionNavigation } from "./usePhpContextualFrameworkLiteralDefinitionNavigation";
import { usePhpFrameworkLiteralNavigationDependencies } from "./usePhpFrameworkLiteralNavigationDependencies";
import { usePhpSuperMethodNavigation } from "./usePhpSuperMethodNavigation";
import { usePhpIndexedDefinitionNavigation } from "./usePhpIndexedDefinitionNavigation";
import { usePhpContextualDefinitionNavigation } from "./usePhpContextualDefinitionNavigation";
import { usePhpFrameworkIdentifierDefinitionNavigation } from "./usePhpFrameworkIdentifierDefinitionNavigation";
import type { NavigationRequest } from "./navigationRequest";
import {
  createDefaultPhpFrameworkIdentifierNavigationActivationAdapters,
  createPhpFrameworkIdentifierNavigationAdapters,
} from "./phpFrameworkIdentifierNavigationAdapterComposition";
import { usePhpClassTargetNavigation } from "./usePhpClassTargetNavigation";
import { usePhpMethodTargetNavigation } from "./usePhpMethodTargetNavigation";
import { usePhpPropertyTargetNavigation } from "./usePhpPropertyTargetNavigation";
import { usePhpImplementationNavigation } from "./usePhpImplementationNavigation";
import { useBookmarks } from "./useBookmarks";
import { useFileHistory } from "./useFileHistory";
import { useLocalHistory } from "./useLocalHistory";
import { useDocumentLifecycle } from "./useDocumentLifecycle";
import type { DirtyCloseDecisionPort } from "./dirtyCloseDecisionPort";
import type { RunWithDocumentSaveExclusion } from "./documentSaveCoordinator";
import {
  createEslintFixOnSaveParticipant,
  orderedDocumentSaveParticipants,
} from "./documentSaveParticipants";
import { createPrettierSaveParticipant } from "./prettierSaveParticipant";
import {
  createDocumentSaveIdentity,
  legacyDocumentSaveIdentity,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";
import { useWorkbenchEditorGroupCloseLifecycle } from "./useWorkbenchEditorGroupCloseLifecycle";
import { OwnerResolvingDocumentSaveService } from "./ownerResolvingDocumentSaveService";
import { WorkbenchOwnerDocumentSaveAdapters } from "./workbenchOwnerDocumentSaveAdapters";
import {
  useDocumentSavePipeline,
  type DocumentSavePipelineOwnerContext,
} from "./useDocumentSavePipeline";
import {
  currentWorkspaceSessionForEditorGroups,
  isSessionPathInWorkspace,
  restoreWorkspaceSession as restorePersistedWorkspaceSession,
  restoredBottomPanelView,
  workspaceSessionsEqual,
} from "./documentSessionState";
import {
  useWorkspaceStateCache,
  workspaceIdentityStateCacheKey,
  type CachedWorkspaceWorkbenchState,
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
  type WorkspaceIdentityReleaseOutcome,
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
import { useWorkbenchTextSearch } from "./useWorkbenchTextSearch";
import { useLanguageServerFeatureErrorReporting } from "./useLanguageServerFeatureErrorReporting";
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
import { usePhpFrameworkMorphMapResolver } from "./usePhpFrameworkMorphMapResolver";
import { usePhpFrameworkModelSemantics } from "./usePhpFrameworkModelSemantics";
import { usePhpSemanticResolver } from "./usePhpSemanticResolver";
import {
  useWorkbenchImplementationChooserState,
  useWorkbenchLanguageNavigation,
} from "./useWorkbenchLanguageNavigation";
import { useDocumentSync } from "./useDocumentSync";
import { useDiagnostics } from "./useDiagnostics";
import {
  createWorkspaceSettingsByRootSnapshot,
  type WorkspaceSettingsByRootSnapshot,
} from "./workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";
import {
  type LanguageServerDiagnosticsRuntimeKind,
  useLanguageServerDiagnosticsSubscriptions,
} from "./useLanguageServerDiagnosticsSubscriptions";
import { useLanguageServerRuntimeLifecycle } from "./useLanguageServerRuntimeLifecycle";
import { useJavaScriptTypeScriptLanguageServerSettings } from "./useJavaScriptTypeScriptLanguageServerSettings";
import { useWorkspaceEditFileOperations } from "./useWorkspaceEditFileOperations";
import {
  useNavigationHistory,
  useRecentNavigation,
} from "./useNavigationHistory";
import { useLanguageServerDocumentSyncState } from "./useLanguageServerDocumentSyncState";
import { useTerminalTestRunner } from "./useTerminalTestRunner";
import { useWorkbenchFrameworkIntelligenceDependencies } from "./useWorkbenchFrameworkIntelligenceDependencies";
import { useWorkbenchFrameworkIntelligence } from "./useWorkbenchFrameworkIntelligence";
import { useWorkbenchFrameworkProviderAdapter } from "./useWorkbenchFrameworkProviderAdapter";
import {
  runEslintFixAllInActiveFile,
  runEslintWorkspaceAnalysis,
  runPhpstanIgnoreAtCursor,
  runPhpstanWorkspaceAnalysis,
  type EditorSurfaceBufferFixRunner,
  type EditorSurfacePhpstanIgnoreRunner,
} from "./useWorkbenchCodeQualityDiagnostics";
import {
  createPhpFrameworkFileChangeInvalidator,
} from "./phpFrameworkFileChangeInvalidationRegistry";
import { usePhpFrameworkResolution } from "./usePhpFrameworkResolution";
import { usePhpFrameworkActiveDocumentDiagnostics } from "./usePhpFrameworkActiveDocumentDiagnostics";
import { usePhpOutline } from "./usePhpOutline";
import { useJavaScriptTypeScriptFileStructure } from "./useJavaScriptTypeScriptFileStructure";
import {
  synthesizePhpTypedReceiverSource,
} from "./phpTypedReceiverSource";
import type {
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
  WorkspaceIdentityGateway,
} from "../infrastructure/tauriWorkspaceIdentityGateway";
import { workspaceRelativePathForDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import {
  registerActiveComposerManifestWorkspace,
} from "../components/composerManifestMonacoProviders";
import { registerActiveNpmManifestWorkspace } from "../components/npmManifestMonacoProviders";
import { navigateToArtisanController } from "./artisanRouteNavigation";
import {
  quoteShellArgument,
  terminalDirectoryForEntry,
  workspaceRelativePath as contextMenuRelativePath,
} from "../domain/pathDerivation";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
} from "./usePhpCodeActions";
import { usePhpCodeActionProvider } from "./usePhpCodeActionProvider";
import { usePhpCodeActionNewFileApplication } from "./usePhpCodeActionNewFileApplication";
import { usePhpChangeSignatureWorkflow } from "./usePhpChangeSignatureWorkflow";
import {
  capDiagnosticNotices,
  capWorkbenchNotices,
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  activeDotenvLocalDiagnosticNotices as buildActiveDotenvLocalDiagnosticNotices,
  activePhpLocalDiagnosticNotices as buildActivePhpLocalDiagnosticNotices,
  buildDiagnosticOverflowNotice,
  composeEffectiveDiagnosticNotices,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  diagnosticNoticeNavigationTarget,
  GLOBAL_NOTICE_LIMIT,
  isCappableDiagnosticNotice,
  localPhpDiagnosticsFromSource,
} from "./diagnosticNotices";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import {
  type GitChangedFile,
  type GitBlameLine,
  type GitGateway,
} from "../domain/git";
import type { LocalHistoryGateway } from "../domain/localHistory";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { ArtisanControllerAction } from "../domain/artisanRoutes";
import type { PhpTestCase } from "../domain/phpTestResults";
import { phpTestCaseNavigationTarget } from "../domain/phpTestResults";
import { isJsTestRelativePath } from "../domain/jsTestFilePatterns";
import type { TestCase } from "../domain/testResults";
import { testCaseNavigationTarget } from "../domain/testResults";
import type { IndexProgressGateway } from "../domain/indexProgress";
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
import { documentNeedsAttention } from "../domain/externalFileConflict";
import { filterPhpLanguageServerDiagnostics } from "../domain/phpLanguageServerDiagnosticFilters";
import { dotenvDiagnosticsFromSource } from "../domain/dotenvDiagnostics";
import {
  fileUriFromPath,
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
  type LanguageServerDocumentSyncGateway,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import {
  canUseLanguageServerFeature,
  type EditorPosition,
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  editorConfigDirectoriesForFile,
  editorConfigPathForDirectory,
  parseEditorConfig,
  resolveEditorConfigSettings,
  type EditorConfigFile,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import {
  editorConfigCacheKey,
  invalidateEditorConfigCacheForRoot,
  type EditorConfigCache,
} from "./editorConfigCache";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import { isBenignError } from "../infrastructure/globalErrorSafetyNet";
import { TauriPhpSyntaxDiagnosticsGateway } from "../infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriEslintDiagnosticsGateway } from "../infrastructure/tauriEslintDiagnosticsGateway";
import { TauriPhpstanDiagnosticsGateway } from "../infrastructure/tauriPhpstanDiagnosticsGateway";
import { TauriDebugGateway } from "../infrastructure/tauriDebugGateway";
import { TauriPintGateway } from "../infrastructure/tauriPintGateway";
import { TauriPrettierGateway } from "../infrastructure/tauriPrettierGateway";
import type { DebugGateway } from "../domain/debug";
import {
  loadPersistedBreakpoints,
  savePersistedBreakpoints,
  type BreakpointStorage,
} from "../domain/debugBreakpointPersistence";
import type { PrettierFormattingGateway } from "../domain/prettierFormatting";
import {
  replaceEslintDiagnosticsForRoot,
  supportsEslintLineComment,
  type EslintDiagnosticsByRoot,
  type EslintFix,
} from "../domain/eslintDiagnostics";
import {
  replacePhpstanDiagnosticsForRoot,
  type PhpstanDiagnosticsByRoot,
} from "../domain/phpstanDiagnostics";
import {
  isMarkdownDocument,
  markdownPreviewPath,
  renderMarkdownPreview,
  type MarkdownPreviewTab,
} from "../domain/markdownPreview";
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
  cachedLanguageServerRuntimeStatusForOwner,
  cachedLanguageServerRuntimeStatusForRoot,
  type LanguageServerRuntimeStatusByOwner,
} from "../domain/languageServerRuntimeStatusCache";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
  type EditorSessionOwnerKey,
} from "../domain/editorSessionOwnerKey";
import {
  type WorkspaceFileChangeGateway,
  type WorkspaceFileChangeUnsubscribeFn,
} from "../domain/workspaceFileChange";
import {
  normalizedWorkspaceRootKey,
  workspaceDisplayName,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
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
  resolvePhpClassName,
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
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import { pushGitCommitMessageHistory } from "../domain/gitCommitMessageHistory";
import {
  clearRecentlyClosedTabs,
  emptyRecentlyClosedTabs,
} from "../domain/recentlyClosedTabs";
import {
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSettings,
  normalizeEditorFontSize,
  pushRecentWorkspacePath,
  type AppSettings,
  type BackgroundRuntimePolicy,
  type SettingsGateway,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSessionState,
  type WorkspaceSessionViewState,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import {
  detectNodePackageManager,
  type NodePackageManager,
} from "../domain/packageManagerDetection";
import {
  parseComposerScripts,
  parsePackageJsonScripts,
  type PackageScript,
} from "../domain/packageScripts";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import { recentFilesForSwitcher } from "../domain/recentFiles";
import { type TabDropPosition } from "../domain/tabOrdering";
import { editorGroupIdsInLayout } from "../domain/editorLayout";
import {
  editorGroupsReducer,
  editorGroupsUniquePaths,
  openEditorGroupPath,
  reorderEditorGroupTabs,
  transferEditorGroupTab,
  type EditorGroupId,
  type EditorSplitDirection,
} from "../domain/editorGroups";
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
  createWorkspaceTextFileWithContent,
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
  visibleEditorPaths,
  type EditorDocument,
  type FileEntry,
  type FileSearchGateway,
  type IntelligenceMode,
  type ManagedPhpactorInstallCompletionEvent,
  type ManagedTypeScriptInstallCompletionEvent,
  type ManagedPhpactorInstallUnsubscribeFn,
  type PhpToolGateway,
  type PhpToolAvailability,
  type TextSearchGateway,
  type WorkspaceDescriptor,
  type WorkspaceDetectionGateway,
  type WorkspaceFileGateway,
  type WorkspaceOwnerFileGateway,
} from "../domain/workspace";

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  fileChanges: WorkspaceFileChangeGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  identity: WorkspaceIdentityGateway;
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
  editorSurfaceBufferFixRunner?: EditorSurfaceBufferFixRunner | null;
  editorSurfaceEslintDisableRunner?: EditorSurfaceEslintDisableRunner | null;
  editorSurfacePhpstanIgnoreRunner?: EditorSurfacePhpstanIgnoreRunner | null;
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
  editorMenuCommandRunner?: EditorMenuCommandRunner | null;
  editorGroupFocusRunner?: EditorGroupFocusRunner | null;
  markdownPreviewRenderer?: (markdown: string) => Promise<string>;
  dirtyCloseDecisionPort?: DirtyCloseDecisionPort;
  onDidCloseEditorPaths?: (paths: readonly string[]) => void;
  prettierFormattingGateway?: PrettierFormattingGateway;
  debugGateway?: DebugGateway;
  debugBreakpointStorage?: BreakpointStorage;
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

interface OpenWorkspaceFileRequest {
  canOpen(): boolean;
}

interface WorkspaceIdentityAdmissionLease {
  generation: number;
  workspaceId: string;
}

interface PendingWorkspaceSettingsLoad {
  legacyRawKeys: readonly string[];
  promise: Promise<WorkspaceSettings>;
}

interface InFlightDirectoryLoad {
  generation: number;
  path: string;
  promise: Promise<FileEntry[]>;
  requestId: symbol;
  rootPath: string | null;
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

function restoreRuntimeStatusCacheEntry(
  cache: Record<string, LanguageServerRuntimeStatus>,
  rootKey: string,
  status: LanguageServerRuntimeStatus | undefined,
): void {
  if (!status) {
    delete cache[rootKey];
    return;
  }

  cache[rootKey] = status;
}

const phpLocalSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();
const defaultDebugGateway = new TauriDebugGateway();
const eslintDiagnosticsGateway = new TauriEslintDiagnosticsGateway();
const phpstanDiagnosticsGateway = new TauriPhpstanDiagnosticsGateway();
const pintGateway = new TauriPintGateway();
const defaultPrettierFormattingGateway = new TauriPrettierGateway();

export type SidebarView = "files" | "git" | "php";

interface WorkbenchEditorConfigLoadDependencies {
  readonly cache: () => EditorConfigCache;
  readonly currentWorkspaceRoot: () => string | null;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly resolveWorkspaceRuntimeOwner: (
    rootPath: string,
  ) => WorkspaceRuntimeOwner | null;
}

interface WorkbenchEditorConfigLoadRequest {
  readonly directory: string;
  readonly owner?: WorkspaceRuntimeOwner;
  readonly rootPath: string;
}

export async function loadWorkbenchEditorConfigFile(
  dependencies: WorkbenchEditorConfigLoadDependencies,
  request: WorkbenchEditorConfigLoadRequest,
): Promise<EditorConfigFile | null> {
  const isCurrent = () => {
    if (!request.owner) {
      return workspaceRootKeysEqual(
        dependencies.currentWorkspaceRoot(),
        request.rootPath,
      );
    }

    const currentOwner = dependencies.resolveWorkspaceRuntimeOwner(
      request.rootPath,
    );
    return currentOwner?.ownerKey === request.owner.ownerKey &&
      workspaceRootKeysEqual(
        currentOwner.executionRoot,
        request.owner.executionRoot,
      );
  };
  if (!isCurrent()) {
    return null;
  }

  const cacheKey = editorConfigCacheKey(request.rootPath, request.owner);
  const cacheForRequest = (dependencies.cache()[cacheKey] ??= {});
  if (request.directory in cacheForRequest) {
    return cacheForRequest[request.directory];
  }

  const path = editorConfigPathForDirectory(request.directory);
  let content: string | null = null;
  try {
    content = await dependencies.readTextFile(path);
  } catch {
    content = null;
  }

  if (!isCurrent()) {
    return null;
  }

  const file: EditorConfigFile | null = content === null
    ? null
    : { directory: request.directory, parsed: parseEditorConfig(content) };
  (dependencies.cache()[cacheKey] ??= {})[request.directory] = file;
  return file;
}

export function ownerDocumentSavePipelineContextFor(
  owner: WorkspaceRuntimeOwner,
  settings: WorkspaceSettings,
  hasPhpWorkspaceByOwner: Readonly<Record<string, boolean>>,
  phpRuntimeStatusByOwner: LanguageServerRuntimeStatusByOwner,
  javaScriptTypeScriptRuntimeStatusByOwner: LanguageServerRuntimeStatusByOwner,
  synchronizedOwner: WorkspaceRuntimeOwner | null = null,
): DocumentSavePipelineOwnerContext {
  const phpRuntimeStatus = phpRuntimeStatusByOwner[owner.ownerKey] ?? null;
  const javaScriptTypeScriptRuntimeStatus =
    javaScriptTypeScriptRuntimeStatusByOwner[owner.ownerKey] ?? null;
  return {
    canUseLanguageServerDocument: synchronizedOwner?.ownerKey === owner.ownerKey &&
      workspaceRootKeysEqual(
        synchronizedOwner.executionRoot,
        owner.executionRoot,
      ),
    hasPhpWorkspace: hasPhpWorkspaceByOwner[owner.ownerKey] === true,
    javaScriptTypeScriptRuntimeStatus,
    javaScriptTypeScriptRuntimeStatusRoot:
      javaScriptTypeScriptRuntimeStatus?.rootPath ?? owner.executionRoot,
    owner,
    phpRuntimeStatus,
    phpRuntimeStatusRoot: phpRuntimeStatus?.rootPath ?? owner.executionRoot,
    settings,
  };
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
  languageServerDocumentSyncGateway: SessionBoundLanguageServerDocumentSyncGateway,
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
  const markdownPreviewRenderer =
    options.markdownPreviewRenderer ?? renderMarkdownPreview;
  const fallbackDirtyCloseDecisionPort = useMemo<DirtyCloseDecisionPort>(
    () => ({
      decideDirtyClose: async ({ documentNames, scope }) =>
        prompter.confirm(
          scope === "workspace"
            ? "Close workspace and discard unsaved changes?"
            : scope === "quit"
              ? "Quit and discard unsaved changes?"
              : documentNames.length === 1
                ? "Discard changes?"
                : `Discard changes in ${documentNames.length} files?`,
        ) ? "discard" : "cancel",
    }),
    [prompter],
  );
  const {
    detection: workspaceDetection,
    fileChanges: workspaceFileChangeGateway,
    fileSearch,
    files: workspaceFiles,
    phpTools: phpToolGateway,
    projectSymbols: projectSymbolSearch,
    textSearch,
  } = workspaceGateways;
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
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceIdentityDescriptor, setWorkspaceIdentityDescriptor] =
    useState<WorkspaceIdentityDescriptor | null>(null);
  const editorSessionOwnerKey = useMemo(
    () =>
      workspaceRoot
        ? workspaceIdentityDescriptor
          ? createEditorSessionOwnerKey(
              workspaceIdentityDescriptor.workspaceId,
              workspaceIdentityDescriptor.canonicalRoot,
            )
          : createLegacyEditorSessionOwnerKey(workspaceRoot)
        : null,
    [workspaceIdentityDescriptor, workspaceRoot],
  );
  const currentEditorSessionOwnerKeyRef = useRef<EditorSessionOwnerKey | null>(
    editorSessionOwnerKey,
  );
  currentEditorSessionOwnerKeyRef.current = editorSessionOwnerKey;
  const workspaceRuntimeOwner = useMemo(
    () =>
      workspaceRoot && workspaceIdentityDescriptor
        ? workspaceRuntimeOwnerFor(
            workspaceRoot,
            workspaceIdentityDescriptor,
          )
        : null,
    [workspaceIdentityDescriptor, workspaceRoot],
  );
  const workspaceRuntimeOwnerRef = useRef(workspaceRuntimeOwner);
  workspaceRuntimeOwnerRef.current =
    workspaceRuntimeOwner ??
    (workspaceRoot ? createLegacyWorkspaceRuntimeOwner(workspaceRoot) : null);
  const resolveCurrentWorkspaceRuntimeOwner = useCallback(
    () => workspaceRuntimeOwnerRef.current,
    [],
  );
  const [workspaceDescriptor, setWorkspaceDescriptor] =
    useState<WorkspaceDescriptor | null>(null);
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
      packages: workspaceDescriptor.javaScriptTypeScript?.packages ?? [], rootPath: workspaceRoot,
    });
  }, [workspaceDescriptor, workspaceRoot]);
  const [packageScriptsByRoot, setPackageScriptsByRoot] = useState<
    Record<
      string,
      {
        composerScripts: PackageScript[];
        hasArtisan: boolean;
        npmPackageManager: NodePackageManager;
        npmScripts: PackageScript[];
      }
    >
  >({});
  const activePackageScripts = workspaceRoot
    ? packageScriptsByRoot[workspaceRoot]
    : null;
  const resetPhpClassMemberCacheRef = useRef<() => void>(() => {});
  const resetPhpFrameworkCachesRef = useRef<() => void>(() => {});
  const invalidatePhpFrameworkBindingCacheRef = useRef<() => void>(() => {});
  const isPhpFrameworkBindingDependencyPathRef = useRef<
    (path: string) => boolean
  >(() => false);
  const resetPhpFrameworkMorphMapModelTypeCacheRef = useRef<() => void>(
    () => {},
  );
  const {
    activeFrameworkActivityLabel,
    activePhpFrameworkProviders,
    phpFrameworkIntelligence,
    phpFrameworkRuntimeContext,
  } = usePhpFrameworkResolution({ workspaceDescriptor });
  const [workspaceTrust, setWorkspaceTrust] =
    useState<WorkspaceTrustState | null>(null);
  const [phpTools, setPhpTools] = useState<PhpToolAvailability | null>(null);
  const [languageServerPlan, setLanguageServerPlan] =
    useState<LanguageServerPlan | null>(null);
  const [installingManagedPhpactor, setInstallingManagedPhpactor] =
    useState(false);
  const [installingManagedTypeScriptLanguageServer, setInstallingManagedTypeScriptLanguageServer] =
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
  const [frameworkDiagnosticsByPath, setFrameworkDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [phpLocalDiagnosticsByPath, setPhpLocalDiagnosticsByPath] =
    useState<Record<string, LanguageServerDiagnostic[]>>({});
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [bottomPanelView, setBottomPanelView] =
    useState<BottomPanelView>("problems");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
  const [phpTestRunRequestVersion, setPhpTestRunRequestVersion] = useState(0);
  const [jsTestRunRequestVersion, setJsTestRunRequestVersion] = useState(0);
  const [phpTree, setPhpTree] = useState<PhpTree>(emptyPhpTree);
  const [phpTreeLoading, setPhpTreeLoading] = useState(false);
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
  const {
    activeDocument,
    activeDocumentRef,
    activeGroupId,
    activeImage,
    activeMarkdownPreview,
    activePath,
    documents,
    documentsRef,
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
  } = useEditorSessionState();
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [artisanMakePaletteRoot, setArtisanMakePaletteRoot] = useState<
    string | null
  >(null);
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
  const eslintAnalysisInFlightRef = useRef(false);
  const [eslintAnalysisRunning, setEslintAnalysisRunning] = useState(false);
  const [eslintFixesByRoot, setEslintFixesByRoot] = useState<
    Record<string, Record<string, EslintFix[]>>
  >({});
  const [eslintDiagnosticsByRoot, setEslintDiagnosticsByRoot] =
    useState<EslintDiagnosticsByRoot>({});
  const phpstanAnalysisInFlightRef = useRef(false);
  const [phpstanAnalysisRunning, setPhpstanAnalysisRunning] = useState(false);
  const [phpstanDiagnosticsByRoot, setPhpstanDiagnosticsByRoot] =
    useState<PhpstanDiagnosticsByRoot>({});
  const noticesRef = useRef<WorkbenchNotice[]>(notices);
  noticesRef.current = notices;
  const [appSettings, setAppSettings] =
    useState<AppSettings>(defaultAppSettings);
  const phpstanWorkspaceTabsRef = useRef<string[]>([]);
  const eslintWorkspaceTabsRef = useRef<string[]>([]);
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
  const workspaceSettingsByRootRef = useRef<WorkspaceSettingsByRootSnapshot | null>(
    null,
  );
  const workspaceSettingsByRoot =
    workspaceSettingsByRootRef.current ?? createWorkspaceSettingsByRootSnapshot();
  workspaceSettingsByRootRef.current = workspaceSettingsByRoot;
  const workspaceSettingsSaveCoordinatorRef = useRef(
    createWorkspaceSettingsSaveCoordinator(),
  );
  const workspaceSettingsSaveCoordinator =
    workspaceSettingsSaveCoordinatorRef.current;
  const workspaceSettingsLoadByRootRef = useRef<
    Record<string, PendingWorkspaceSettingsLoad>
  >({});
  const workspaceSessionRestoredRef = useRef(false);
  const workspaceEditorViewStatesRef = useRef<
    Record<string, Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>>
  >({});
  const [restoredEditorViewStateRevision, setRestoredEditorViewStateRevision] =
    useState(0);
  const recentlyClosedTabsRef = useRef(emptyRecentlyClosedTabs());
  const [, setRecentlyClosedTabsVersion] = useState(0);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const lastPhpIdeReadinessSignatureRef = useRef<string | null>(null);
  const workspaceDocumentCloseCoordinatorRef = useRef(
    new WorkspaceDocumentCloseCoordinator(),
  );
  const openWorkspaceRequestTokenRef = useRef(0);
  const openWorkspaceRequestPathRef = useRef<string | null>(null);
  const openWorkspaceRequestInFlightTokenRef = useRef<number | null>(null);
  const workbenchMountedRef = useRef(true);
  const pendingWorkspaceIdentityRequestTokensRef = useRef<Set<number>>(
    new Set(),
  );
  const deferredWorkspaceIdentityCleanupIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityAdmissionGenerationRef = useRef(0);
  const pendingWorkspaceIdentityAdmissionsRef = useRef<
    Record<string, Set<number>>
  >({});
  const ownedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const ownedWorkspaceIdentityGenerationByIdRef = useRef<
    Record<string, number>
  >({});
  const workspaceIdentityReleaseGenerationByIdRef = useRef<
    Record<string, number>
  >({});
  const releasedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityUnregisterByIdRef = useRef<
    Record<string, Promise<void>>
  >({});
  const inFlightDirectoryLoadsRef = useRef(
    new Map<string, InFlightDirectoryLoad>(),
  );
  const openFileRequestTokenRef = useRef(0);
  const openingFileFlagOwnerTokenRef = useRef<number | null>(null);
  const emptyDocumentRefreshTimeoutsRef = useRef<Set<number>>(new Set());
  const editorGitBaselineRequestTokenRef = useRef(0);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
  const phpLanguageServerAutostartAttemptsByRootRef = useRef<
    Record<string, number>
  >({});
  const manuallyStoppedPhpLanguageServerRootsRef = useRef<Set<string>>(
    new Set(),
  );
  const installingManagedPhpactorRootRef = useRef<string | null>(null);
  const installingManagedTypeScriptLanguageServerRootRef = useRef<string | null>(null);
  const autoStartedJavaScriptTypeScriptLanguageServerRootRef = useRef<
    string | null
  >(null);
  const intelligenceModeRef = useRef<IntelligenceMode>("basic");
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
  const phpClassSourcePathCacheRef = useRef<Record<string, string[]>>({});
  const phpFrameworkBindingCacheRef = useRef<Record<string, string | null>>({});
  const phpLocalDiagnosticValidationGenerationRef = useRef(0);
  const phpLocalDiagnosticRetryTimersRef = useRef<
    ReturnType<typeof setTimeout>[]
  >([]);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const editorSessionOwnerKeyForRoot = useCallback(
    (rootPath: string): EditorSessionOwnerKey =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
      currentEditorSessionOwnerKeyRef.current
        ? currentEditorSessionOwnerKeyRef.current
        : createLegacyEditorSessionOwnerKey(rootPath),
    [],
  );
  const resetIndexedWorkspaceViewsRef = useRef<() => void>(() => {});
  const resetIndexedWorkspaceViews = useCallback(() => {
    resetIndexedWorkspaceViewsRef.current();
  }, []);
  const resetPhpFrameworkCaches = useCallback(() => {
    resetPhpFrameworkCachesRef.current();
  }, []);
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
  const workspaceIdentityByRootRef = useRef<
    Record<string, WorkspaceIdentityDescriptor>
  >({});
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
  const documentSelfWrites = useMemo(
    () => new DocumentSelfWriteCoordinator(),
    [],
  );
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
      return workspaceSettingsByRoot.resolve(
        descriptor?.canonicalRoot ?? rootPath,
      );
    },
    [workspaceGateways.identity, workspaceSettingsByRoot],
  );
  const workspaceRuntimeRootByTabRef = useRef<Record<string, string>>({});
  const workspaceRuntimeOwnerByTabRef = useRef<
    Record<string, WorkspaceRuntimeOwner>
  >({});
  const hasPhpWorkspaceByOwnerRef = useRef<Record<string, boolean>>({});
  const resolveWorkspaceRuntimeOwner = useCallback(
    (rootPath: string) => workspaceRuntimeOwnerByTabRef.current[rootPath] ?? null,
    [],
  );
  const workspaceRuntimeOwnerClaimsRef = useRef<
    WorkspaceRuntimeOwnerClaimRegistry
  >({});
  const retireWorkspaceRuntimeOwnerClaim = useCallback(
    (ownerKey: string, expectedGeneration?: number | null) => {
      retireClaimedWorkspaceRuntimeOwner(
        workspaceRuntimeOwnerClaimsRef.current,
        ownerKey,
        expectedGeneration,
      );
    },
    [],
  );
  const resolveWorkspaceRuntimeOwnerForDiagnosticsEvent = useCallback(
    (
      event: LanguageServerDiagnosticEvent,
      runtimeKind: LanguageServerDiagnosticsRuntimeKind,
    ): WorkspaceRuntimeOwner | null => {
      if (!event.rootPath) {
        return null;
      }

      return resolveClaimedWorkspaceRuntimeOwnerForDiagnosticsEvent(
        workspaceRuntimeOwnerClaimsRef.current,
        event,
        runtimeKind,
        languageServerRuntimeStatusByRootRef.current,
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
      );
    },
    [],
  );
  const unregisterWorkspaceIdentityIfUnused = useCallback(
    async (
      workspaceId: string,
      requestedReleaseGeneration?: number,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      const releaseGeneration =
        requestedReleaseGeneration ??
        workspaceIdentityReleaseGenerationByIdRef.current[workspaceId];
      const ownedGeneration =
        ownedWorkspaceIdentityGenerationByIdRef.current[workspaceId];
      if (
        ownedWorkspaceIdentityIdsRef.current.has(workspaceId) &&
        releaseGeneration === undefined
      ) {
        return "deferred";
      }

      if (
        releaseGeneration !== undefined &&
        ownedGeneration !== releaseGeneration
      ) {
        if (
          workspaceIdentityReleaseGenerationByIdRef.current[workspaceId] ===
          releaseGeneration
        ) {
          delete workspaceIdentityReleaseGenerationByIdRef.current[workspaceId];
        }
        return "deferred";
      }

      if (pendingWorkspaceIdentityAdmissionsRef.current[workspaceId]?.size) {
        return "deferred";
      }

      if (pendingWorkspaceIdentityRequestTokensRef.current.size > 0) {
        deferredWorkspaceIdentityCleanupIdsRef.current.add(workspaceId);
        return "deferred";
      }

      const pendingUnregister =
        workspaceIdentityUnregisterByIdRef.current[workspaceId];
      if (pendingUnregister) {
        await pendingUnregister;
        return releasedWorkspaceIdentityIdsRef.current.has(workspaceId)
          ? "released"
          : "deferred";
      }

      const request = workspaceGateways.identity.unregister(workspaceId);
      deferredWorkspaceIdentityCleanupIdsRef.current.delete(workspaceId);
      workspaceIdentityUnregisterByIdRef.current[workspaceId] = request;
      let requestStillCurrent = true;
      try {
        await request;
      } finally {
        if (
          workspaceIdentityUnregisterByIdRef.current[workspaceId] !== request
        ) {
          requestStillCurrent = false;
        }

        if (requestStillCurrent) {
          delete workspaceIdentityUnregisterByIdRef.current[workspaceId];
        }
      }
      if (!requestStillCurrent) {
        return "deferred";
      }

      if (releaseGeneration === undefined) {
        return "released";
      }

      if (
        workspaceIdentityReleaseGenerationByIdRef.current[workspaceId] ===
        releaseGeneration
      ) {
        delete workspaceIdentityReleaseGenerationByIdRef.current[workspaceId];
      }
      if (
        ownedWorkspaceIdentityGenerationByIdRef.current[workspaceId] !==
        releaseGeneration
      ) {
        return "deferred";
      }

      ownedWorkspaceIdentityIdsRef.current.delete(workspaceId);
      delete ownedWorkspaceIdentityGenerationByIdRef.current[workspaceId];
      releasedWorkspaceIdentityIdsRef.current.add(workspaceId);
      return "released";
    },
    [workspaceGateways.identity],
  );
  const flushDeferredWorkspaceIdentityCleanup = useCallback(() => {
    if (pendingWorkspaceIdentityRequestTokensRef.current.size > 0) {
      return;
    }

    const workspaceIds = [...deferredWorkspaceIdentityCleanupIdsRef.current];
    for (const workspaceId of workspaceIds) {
      void unregisterWorkspaceIdentityIfUnused(workspaceId).catch((error) => {
        if (!workbenchMountedRef.current) {
          return;
        }
        reportError("Workspace", error);
      });
    }
  }, [reportError, unregisterWorkspaceIdentityIfUnused]);
  const beginWorkspaceIdentityAdmission = useCallback(
    (workspaceId: string): WorkspaceIdentityAdmissionLease => {
      const generation = workspaceIdentityAdmissionGenerationRef.current + 1;
      workspaceIdentityAdmissionGenerationRef.current = generation;
      const pending =
        pendingWorkspaceIdentityAdmissionsRef.current[workspaceId] ?? new Set();
      pending.add(generation);
      pendingWorkspaceIdentityAdmissionsRef.current[workspaceId] = pending;
      return { generation, workspaceId };
    },
    [],
  );
  const adoptWorkspaceIdentityAdmission = useCallback(
    (lease: WorkspaceIdentityAdmissionLease) => {
      const pending =
        pendingWorkspaceIdentityAdmissionsRef.current[lease.workspaceId];
      pending?.delete(lease.generation);
      if (pending?.size === 0) {
        delete pendingWorkspaceIdentityAdmissionsRef.current[lease.workspaceId];
      }
      ownedWorkspaceIdentityIdsRef.current.add(lease.workspaceId);
      releasedWorkspaceIdentityIdsRef.current.delete(lease.workspaceId);
      ownedWorkspaceIdentityGenerationByIdRef.current[lease.workspaceId] =
        lease.generation;
    },
    [],
  );
  const releaseWorkspaceIdentityAdmission = useCallback(
    async (lease: WorkspaceIdentityAdmissionLease): Promise<void> => {
      const pending =
        pendingWorkspaceIdentityAdmissionsRef.current[lease.workspaceId];
      pending?.delete(lease.generation);
      if (pending?.size === 0) {
        delete pendingWorkspaceIdentityAdmissionsRef.current[lease.workspaceId];
      }
      await unregisterWorkspaceIdentityIfUnused(lease.workspaceId);
    },
    [unregisterWorkspaceIdentityIfUnused],
  );
  const releaseOwnedWorkspaceIdentity = useCallback(
    async (
      workspaceId: string,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      const claimedGeneration =
        workspaceRuntimeOwnerClaimsRef.current[workspaceId]?.generation;
      if (releasedWorkspaceIdentityIdsRef.current.has(workspaceId)) {
        if (claimedGeneration !== undefined) {
          retireWorkspaceRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        return "released";
      }

      const ownershipGeneration =
        ownedWorkspaceIdentityGenerationByIdRef.current[workspaceId];
      if (ownershipGeneration === undefined) {
        const outcome = await unregisterWorkspaceIdentityIfUnused(workspaceId);
        if (outcome === "released" && claimedGeneration !== undefined) {
          retireWorkspaceRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        return outcome;
      }

      workspaceIdentityReleaseGenerationByIdRef.current[workspaceId] =
        ownershipGeneration;
      const outcome = await unregisterWorkspaceIdentityIfUnused(
        workspaceId,
        ownershipGeneration,
      );
      if (outcome === "released") {
        retireWorkspaceRuntimeOwnerClaim(workspaceId, ownershipGeneration);
      }
      return outcome;
    },
    [retireWorkspaceRuntimeOwnerClaim, unregisterWorkspaceIdentityIfUnused],
  );
  const withManagedWorkspaceIdentityLease = useCallback(
    async (
      descriptor: WorkspaceIdentityDescriptor,
      useLease: (adopt: () => void) => Promise<void>,
    ): Promise<void> => {
      const lease = beginWorkspaceIdentityAdmission(descriptor.workspaceId);
      await withWorkspaceIdentityLease(
        descriptor,
        () => releaseWorkspaceIdentityAdmission(lease),
        (adoptLease) =>
          useLease(() => {
            adoptWorkspaceIdentityAdmission(lease);
            adoptLease();
          }),
      );
    },
    [
      adoptWorkspaceIdentityAdmission,
      beginWorkspaceIdentityAdmission,
      releaseWorkspaceIdentityAdmission,
    ],
  );
  const workspaceCloseGenerationByRootRef = useRef<Record<string, number>>({});
  const workspaceCloseOwnershipGenerationRef = useRef(0);
  const workspaceCloseOwnershipByKeyRef = useRef<Record<string, number>>({});
  const clearExternalFileConflictsForRootRef = useRef<(root: string) => void>(
    () => {},
  );
  const workspaceHasExternalFileConflictsRef = useRef<
    (root: string) => boolean
  >(() => false);
  const workspaceFileChangeSubscriptionGenerationRef = useRef(0);
  // Per-workspace `.editorconfig` cache. Owner reads use a composite key so
  // overlapping workspace generations cannot share data. `null` records a
  // confirmed absence so a missing file is read at most once per session.
  const editorConfigCacheRef = useRef<EditorConfigCache>({});
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
  const isActiveDocumentJsTest = useMemo(() => {
    if (!activeDocument || !workspaceRoot) {
      return false;
    }

    if (!isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
      return false;
    }

    if (!workspaceDescriptor?.javaScriptTypeScript) {
      return false;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, activeDocument.path);

    if (!relativePath) {
      return false;
    }

    return isJsTestRelativePath(relativePath);
  }, [activeDocument, workspaceDescriptor, workspaceRoot]);
  const openDocumentPaths = useMemo(
    () => editorGroupsUniquePaths(editorGroups),
    [editorGroups],
  );
  const openDocuments = useMemo(
    () =>
      openDocumentPaths
        .map((path) => documents[path])
        .filter((document): document is EditorDocument => Boolean(document)),
    [documents, openDocumentPaths],
  );
  const openTabs = useMemo(
    () =>
      openDocumentPaths.flatMap((path) => {
        const tab =
          documents[path] ?? imageTabs[path] ?? markdownPreviewTabs[path];
        return tab ? [tab] : [];
      }),
    [documents, imageTabs, markdownPreviewTabs, openDocumentPaths],
  );
  const openMarkdownPreviews = useMemo(
    () =>
      openDocumentPaths
        .map((path) => markdownPreviewTabs[path])
        .filter((preview): preview is MarkdownPreviewTab => Boolean(preview)),
    [markdownPreviewTabs, openDocumentPaths],
  );
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
    dismissedTextSearchPaths,
    setTextSearchOpen,
    setTextSearchQuery,
    setTextSearchOptions,
    setTextReplacement,
    resetTextSearchState,
    dismissTextSearchFile,
    restoreDismissedTextSearchFiles,
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
    reportChangedDocuments,
    setDocuments,
    setEditorRevealTarget,
    setMessage,
  });

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
    activePath,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    recentFiles,
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
      const identityDescriptor = workspaceIdentityByRootRef.current[rootPath];
      const canonicalKey = identityDescriptor?.canonicalRoot ?? rootPath;
      const settingsIdentity = identityDescriptor
        ? workspaceSettingsIdentity(
            canonicalKey,
            identityDescriptor.selectedPath,
          )
        : rootPath;
      const isRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);
      const previousSettings =
        workspaceSettingsByRoot.resolve(canonicalKey) ??
        (isRootActive() ? workspaceSettingsRef.current : null);

      const saveRevision = workspaceSettingsByRoot.capture(
        canonicalKey,
        nextSettings,
      );

      if (isRootActive()) {
        applyWorkspaceSettings(nextSettings);
      }

      try {
        await workspaceSettingsSaveCoordinator.save(
          canonicalKey,
          previousSettings,
          nextSettings,
          () =>
            settingsGateway.saveWorkspaceSettings(settingsIdentity, nextSettings),
        );
      } catch (error) {
        if (workspaceSettingsByRoot.revision(canonicalKey) !== saveRevision) {
          throw error;
        }

        const committedSettings =
          workspaceSettingsSaveCoordinator.committed(canonicalKey);
        if (committedSettings) {
          workspaceSettingsByRoot.capture(canonicalKey, committedSettings);
        }
        if (!committedSettings) {
          workspaceSettingsByRoot.forget(canonicalKey);
        }
        if (isRootActive() && committedSettings) {
          applyWorkspaceSettings(committedSettings);
        }

        throw error;
      }
    },
    [
      applyWorkspaceSettings,
      settingsGateway,
      workspaceSettingsByRoot,
      workspaceSettingsSaveCoordinator,
    ],
  );

  const {
    workspaceStateCacheRef,
    cacheCurrentWorkspaceState,
    resolveCachedWorkspaceState,
    coalesceWorkspaceStateCache,
    forgetCachedWorkspaceState,
    restoreCachedWorkspaceState,
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

  const persistCurrentWorkspaceSession = useCallback(
    async (rootPath: string) => {
      if (!workspaceSessionRestoredRef.current) {
        return;
      }

      const editorSurface = snapshotEditorSurface(rootPath);
      if (!editorSurface.editorGroups) {
        return;
      }

      const session = currentWorkspaceSessionForEditorGroups(
        rootPath,
        editorSurface.editorGroups,
        sidebarView,
        bottomPanelView,
        workspaceEditorViewStatesRef.current[
          editorSessionOwnerKeyForRoot(rootPath)
        ] ?? {},
        new Set(Object.keys(editorSurface.documents)),
      );

      if (workspaceSessionsEqual(workspaceSettingsRef.current.session, session)) {
        return;
      }

      await persistWorkspaceSettings(rootPath, {
        ...workspaceSettingsRef.current,
        session,
      });
    },
    [
      bottomPanelView,
      editorSessionOwnerKeyForRoot,
      persistWorkspaceSettings,
      sidebarView,
      snapshotEditorSurface,
    ],
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

  const closeReplacedGitDiffDocumentRef = useRef<
    (document: EditorDocument) => void
  >(() => {});
  const closeReplacedGitDiffDocument = useCallback(
    (document: EditorDocument) => {
      closeReplacedGitDiffDocumentRef.current(document);
    },
    [],
  );

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
  } = useGitDiffWorkspace({
    workspaceRoot,
    gitGateway,
    currentWorkspaceRootRef,
    documentTabSession,
    setMessage,
    recordCurrentNavigationLocation,
    reportError,
    onDocumentReplaced: closeReplacedGitDiffDocument,
  });

  const reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef = useRef<
    (repositoryRoot: string, changes: GitChangedFile[]) => void
  >(() => {});
  const reconcileSelectedGitDiffPreviewForGitStatusSurface = useCallback(
    (repositoryRoot: string, changes: GitChangedFile[]) => {
      reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef.current(
        repositoryRoot,
        changes,
      );
    },
    [],
  );
  const gitRepositoryDiscoveryRequestTokenRef = useRef(0);
  const gitOperationCurrency = useGitOperationCurrency(workspaceRoot);
  const {
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
  } = useGitStatusSurface({
    activeDocument,
    activePath,
    reconcileSelectedGitDiffPreviewForRepository:
      reconcileSelectedGitDiffPreviewForGitStatusSurface,
    getSelectedGitDiffDocument,
    currentWorkspaceRootRef,
    editorGitBaselineRequestTokenRef,
    gitGateway,
    gitOperationCurrency,
    gitRepositoryDiscoveryRequestTokenRef,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  });

  const isLanguageServerSessionCurrentForRoot = useCallback(
    (rootPath: string, sessionId: number) =>
      isLanguageServerSessionCurrentForOwnerOrLegacy(
        languageServerRuntimeStatusByRootRef.current,
        workspaceRuntimeOwnerByTabRef.current[rootPath],
        languageServerRuntimeStatusRef.current,
        languageServerRuntimeStatusRootRef.current,
        rootPath,
        sessionId,
      ),
    [],
  );

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
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
  } = useDiagnostics({
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
    isLanguageServerSessionCurrentForRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
  });

  const runEslintAnalysisForRoot = useCallback(async (
    rootPath: string,
    showStartMessage: boolean,
  ) => {
    await runEslintWorkspaceAnalysis({
      rootPath,
      binaryPath: workspaceSettingsRef.current.eslintPath,
      currentWorkspaceRootRef,
      inFlightRef: eslintAnalysisInFlightRef,
      gateway: eslintDiagnosticsGateway,
      replaceEslintDiagnostics,
      replaceEslintFixes: (analysedRoot, result) => {
        const fixesByPath: Record<string, EslintFix[]> = {};

        if (result.status === "ok") {
          result.diagnostics.forEach((diagnostic) => {
            if (!diagnostic.fix) {
              return;
            }

            const path = joinWorkspacePath(analysedRoot, diagnostic.filePath);
            fixesByPath[path] = [...(fixesByPath[path] ?? []), diagnostic.fix];
          });
        }

        setEslintFixesByRoot((current) => ({
          ...current,
          [analysedRoot]: fixesByPath,
        }));
      },
      replaceEslintRetainedDiagnostics: (analysedRoot, result) => {
        setEslintDiagnosticsByRoot((current) =>
          replaceEslintDiagnosticsForRoot(current, analysedRoot, result),
        );
      },
      showStartMessage,
      setMessage,
      setRunning: setEslintAnalysisRunning,
      workspaceTrusted: workspaceTrust?.trusted === true,
    });
  }, [replaceEslintDiagnostics, workspaceTrust?.trusted]);

  const runEslintAnalysis = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) {
      return;
    }

    await runEslintAnalysisForRoot(rootPath, true);
  }, [runEslintAnalysisForRoot]);

  const activeEslintFixes = workspaceRoot && activeDocument
    ? eslintFixesByRoot[workspaceRoot]?.[activeDocument.path] ?? []
    : [];
  const activeEslintDiagnostics = workspaceRoot && activeDocument
    ? eslintDiagnosticsByRoot[workspaceRoot]?.[activeDocument.path] ?? []
    : [];
  const activeEslintBufferClean = Boolean(
    activeDocument &&
      !activeDocument.readOnly &&
      activeDocument.content === activeDocument.savedContent,
  );
  const hasEslintDiagnosticAtCursor = Boolean(
    activeDocument &&
      supportsEslintLineComment(activeDocument.language) &&
      activeEslintDiagnostics.some(
        (diagnostic) => diagnostic.line === activeEditorPosition?.lineNumber,
      ),
  );
  const disableEslintRuleAtCursor = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;
    const diagnostics = requestedRoot && requestedDocument
      ? eslintDiagnosticsByRoot[requestedRoot]?.[requestedDocument.path] ?? []
      : [];

    if (!lineNumber) {
      return;
    }

    runEslintDisableAtCursor({
      currentRoot: currentWorkspaceRootRef.current,
      requestedRoot,
      document: requestedDocument,
      lineNumber,
      diagnostics,
      runner: options.editorSurfaceEslintDisableRunner ?? null,
      setMessage,
      workspaceTrusted: workspaceTrust?.trusted === true,
    });
  }, [
    eslintDiagnosticsByRoot,
    options.editorSurfaceEslintDisableRunner,
    workspaceRoot,
    workspaceTrust?.trusted,
  ]);
  const fixAllEslintInActiveFile = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const fixes = requestedRoot && requestedDocument
      ? eslintFixesByRoot[requestedRoot]?.[requestedDocument.path] ?? []
      : [];

    runEslintFixAllInActiveFile({
      currentRoot: currentWorkspaceRootRef.current,
      document: requestedDocument,
      fixes,
      requestedRoot,
      runner: options.editorSurfaceBufferFixRunner ?? null,
      setMessage,
      workspaceTrusted: workspaceTrust?.trusted === true,
    });
  }, [
    eslintFixesByRoot,
    options.editorSurfaceBufferFixRunner,
    workspaceRoot,
    workspaceTrust?.trusted,
  ]);

  const runEslintAnalysisOnSave = useCallback((rootPath: string) => {
    if (!workspaceTrust?.trusted) {
      return;
    }

    if (
      !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
      workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson !== true ||
      eslintAnalysisRunning
    ) {
      return;
    }

    void runEslintAnalysisForRoot(rootPath, false);
  }, [
    eslintAnalysisRunning,
    runEslintAnalysisForRoot,
    workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson,
    workspaceTrust?.trusted,
  ]);

  useEffect(() => {
    const currentTabs = appSettings.workspaceTabs;

    eslintWorkspaceTabsRef.current.forEach((previousRoot) => {
      if (
        !currentTabs.some((currentRoot) =>
          workspaceRootKeysEqual(currentRoot, previousRoot),
        )
      ) {
        clearEslintDiagnosticsForRoot(previousRoot);
        setEslintFixesByRoot((current) => {
          const next = { ...current };
          delete next[previousRoot];
          return next;
        });
        setEslintDiagnosticsByRoot((current) => {
          const next = { ...current };
          delete next[previousRoot];
          return next;
        });
      }
    });
    eslintWorkspaceTabsRef.current = currentTabs;
  }, [appSettings.workspaceTabs, clearEslintDiagnosticsForRoot]);

  const runPhpstanAnalysisForRoot = useCallback(async (
    rootPath: string,
    showStartMessage: boolean,
  ) => {
    await runPhpstanWorkspaceAnalysis({
      rootPath,
      binaryPath: workspaceSettingsRef.current.phpstanPath,
      currentWorkspaceRootRef,
      inFlightRef: phpstanAnalysisInFlightRef,
      gateway: phpstanDiagnosticsGateway,
      replacePhpstanDiagnostics,
      replacePhpstanRetainedDiagnostics: (analysedRoot, result) => {
        setPhpstanDiagnosticsByRoot((current) =>
          replacePhpstanDiagnosticsForRoot(current, analysedRoot, result),
        );
      },
      showStartMessage,
      setMessage,
      setRunning: setPhpstanAnalysisRunning,
      workspaceTrusted: workspaceTrust?.trusted === true,
    });
  }, [replacePhpstanDiagnostics, workspaceTrust?.trusted]);

  const runPhpstanAnalysis = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) {
      return;
    }

    await runPhpstanAnalysisForRoot(rootPath, true);
  }, [runPhpstanAnalysisForRoot]);

  const activePhpstanDiagnostics = workspaceRoot && activeDocument
    ? phpstanDiagnosticsByRoot[workspaceRoot]?.[activeDocument.path] ?? []
    : [];
  const activePhpstanBufferClean = Boolean(
    activeDocument &&
      !activeDocument.readOnly &&
      activeDocument.content === activeDocument.savedContent,
  );
  const hasPhpstanDiagnosticAtCursor = activePhpstanDiagnostics.some(
    (diagnostic) => diagnostic.line === activeEditorPosition?.lineNumber,
  );
  const ignorePhpstanIssueAtCursor = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;
    const diagnostics = requestedRoot && requestedDocument
      ? phpstanDiagnosticsByRoot[requestedRoot]?.[requestedDocument.path] ?? []
      : [];

    if (!lineNumber) {
      return;
    }

    runPhpstanIgnoreAtCursor({
      currentRoot: currentWorkspaceRootRef.current,
      requestedRoot,
      document: requestedDocument,
      lineNumber,
      diagnostics,
      runner: options.editorSurfacePhpstanIgnoreRunner ?? null,
      setMessage,
      workspaceTrusted: workspaceTrust?.trusted === true,
    });
  }, [
    options.editorSurfacePhpstanIgnoreRunner,
    phpstanDiagnosticsByRoot,
    workspaceRoot,
    workspaceTrust?.trusted,
  ]);

  const runPhpstanAnalysisOnSave = useCallback((rootPath: string) => {
    if (!workspaceTrust?.trusted) {
      return;
    }

    if (
      !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
      !workspaceDescriptor?.php ||
      phpstanAnalysisRunning
    ) {
      return;
    }

    void runPhpstanAnalysisForRoot(rootPath, false);
  }, [
    phpstanAnalysisRunning,
    runPhpstanAnalysisForRoot,
    workspaceDescriptor?.php,
    workspaceTrust?.trusted,
  ]);

  useEffect(() => {
    const currentTabs = appSettings.workspaceTabs;

    phpstanWorkspaceTabsRef.current.forEach((previousRoot) => {
      if (
        !currentTabs.some((currentRoot) =>
          workspaceRootKeysEqual(currentRoot, previousRoot),
        )
      ) {
        clearPhpstanDiagnosticsForRoot(previousRoot);
        setPhpstanDiagnosticsByRoot((current) => {
          const next = { ...current };
          delete next[previousRoot];
          return next;
        });
      }
    });
    phpstanWorkspaceTabsRef.current = currentTabs;
  }, [appSettings.workspaceTabs, clearPhpstanDiagnosticsForRoot]);

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
    isLanguageServerSessionActiveForRoot:
      isLegacyLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot:
      isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    stopLanguageServerRuntime,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    stopProjectRuntimes,
    stopBackgroundProjectRuntimes,
    startLanguageServer,
    stopLanguageServer,
    restartJavaScriptTypeScriptService,
  } = useLanguageServerRuntimeLifecycle({
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
  });

  const isLanguageServerSessionActiveForRoot = useCallback(
    (
      rootPath: string,
      sessionId: number,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      if (!owner) {
        return isLegacyLanguageServerSessionActiveForRoot(rootPath, sessionId);
      }

      return isLanguageServerSessionActiveForOwner(
        languageServerRuntimeStatusByRootRef.current,
        owner,
        rootPath,
        sessionId,
      );
    },
    [isLegacyLanguageServerSessionActiveForRoot],
  );

  const isJavaScriptTypeScriptLanguageServerSessionActiveForRoot = useCallback(
    (
      rootPath: string,
      sessionId: number,
      owner?: WorkspaceRuntimeOwner,
    ) => {
      if (!owner) {
        return isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          rootPath,
          sessionId,
        );
      }

      return isLanguageServerSessionActiveForOwner(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        owner,
        rootPath,
        sessionId,
      );
    },
    [isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot],
  );

  const {
    applyJavaScriptTypeScriptSettingsChange,
    openJavaScriptTypeScriptServiceLog,
  } = useJavaScriptTypeScriptLanguageServerSettings({
    workspaceRoot,
    activeDocumentRef,
    activeEditorConfigRef,
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    currentWorkspaceRootRef,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    stopJavaScriptTypeScriptLanguageServerRuntime,
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
    flushPendingDocumentChangeForRoot,
    flushPendingJavaScriptTypeScriptDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    isLanguageServerDocumentSynced,
    getLanguageServerDocumentLifecycleIdentity,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    syncSavedDocument: syncSavedDocumentForRoot,
    syncSavedJavaScriptTypeScriptDocument:
      syncSavedJavaScriptTypeScriptDocumentForRoot,
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
  closeReplacedGitDiffDocumentRef.current = (document) => {
    const requestedRoot = currentWorkspaceRootRef.current;
    void syncClosedDocument(document).catch((error) =>
      reportLanguageServerErrorForActiveWorkspaceRoot(requestedRoot, error),
    );
    void syncClosedJavaScriptTypeScriptDocument(document).catch((error) =>
      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "JavaScript/TypeScript",
        error,
      ),
    );
  };

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

  const clearActiveWorkspace = useCallback(async (options?: {
    ownership?: WorkspaceCloseOwnership;
    runtimeAlreadyStopped?: boolean;
  }) => {
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
      javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(
        currentRootPath,
      );
    }

    workspaceSessionRestoredRef.current = false;
    workspaceEditorViewStatesRef.current = {};
    currentEditorSessionOwnerKeyRef.current = null;
    currentWorkspaceRootRef.current = null;
    clearWorkspaceStateCache();
    workspaceIdentityByRootRef.current = {};
    workspaceRuntimeRootByTabRef.current = {};
    workspaceRuntimeOwnerByTabRef.current = {};
    hasPhpWorkspaceByOwnerRef.current = {};
    workspaceRuntimeOwnerClaimsRef.current = {};
    editorConfigCacheRef.current = {};
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
    setExpandedDirectories(new Set());
    setManuallyCollapsedDirectories(new Set());
    resetEditorSurfaceState();
    setArtisanMakePaletteRoot(null);
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
  }, [
    applyWorkspaceSettings,
    clearIndexWorkspaceState,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    clearPhpstanDiagnosticsForRoot,
    clearWorkspaceStateCache,
    resetActiveEditorPosition,
    resetFilePrefetchState,
    resetEditorSurfaceState,
    resetHistory,
    resetGitDiffWorkspaceState,
    resetGitStatusSurface,
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
        isMutationOwnerCurrent?: () => boolean;
        requireActiveRoot?: boolean;
      } = {},
    ): Promise<FileEntry[] | undefined> => {
      const rootPath = currentWorkspaceRootRef.current;
      const generation = openWorkspaceRequestTokenRef.current;
      const normalizedPath = normalizedWorkspaceRootKey(path);
      const clearMessage = options.clearMessage !== false;
      const isMutationOwnerCurrent = options.isMutationOwnerCurrent;
      const requireActiveRoot = options.requireActiveRoot === true;
      const requestKey = JSON.stringify([
        normalizedWorkspaceRootKey(rootPath),
        generation,
        normalizedPath,
      ]);
      const activeRequest = inFlightDirectoryLoadsRef.current.get(requestKey);

      // Subdirectory loads stay valid as long as the path still belongs to the
      // live workspace root. The workspace-root load sub-task instead opts into
      // exact-root matching so that switching to a parent workspace (whose root
      // a now-stale nested root would still "belong to") cannot let stale
      // entries leak into the active tree.
      const isActiveRoot = () =>
        openWorkspaceRequestTokenRef.current === generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        (!isMutationOwnerCurrent || isMutationOwnerCurrent()) &&
        (requireActiveRoot
          ? workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              normalizedPath,
            )
          : workspacePathBelongsToRoot(
              normalizedPath,
              currentWorkspaceRootRef.current,
            ));

      let sharedRead = activeRequest?.promise;

      if (!sharedRead) {
        setLoadingDirectories((current) =>
          new Set(current).add(normalizedPath),
        );

        const requestId = Symbol(requestKey);
        const request = (async () => {
          // Let the request enter the registry before a synchronous gateway
          // failure can reach cleanup.
          await Promise.resolve();

          try {
            return await workspaceFiles.readDirectory(normalizedPath);
          } finally {
            const registeredRequest =
              inFlightDirectoryLoadsRef.current.get(requestKey);

            if (registeredRequest?.requestId === requestId) {
              inFlightDirectoryLoadsRef.current.delete(requestKey);
            }

            setLoadingDirectories((current) => {
              const hasActiveRequestForPath = [
                ...inFlightDirectoryLoadsRef.current.values(),
              ].some(
                (candidate) =>
                  candidate.generation ===
                    openWorkspaceRequestTokenRef.current &&
                  workspaceRootKeysEqual(
                    candidate.rootPath,
                    currentWorkspaceRootRef.current,
                  ) &&
                  candidate.path === normalizedPath,
              );

              if (
                hasActiveRequestForPath ||
                !current.has(normalizedPath)
              ) {
                return current;
              }

              const next = new Set(current);
              next.delete(normalizedPath);
              return next;
            });
          }
        })();

        inFlightDirectoryLoadsRef.current.set(requestKey, {
          generation,
          path: normalizedPath,
          promise: request,
          requestId,
          rootPath,
        });
        sharedRead = request;
      }

      try {
        const entries = await sharedRead;
        if (!isActiveRoot()) {
          return;
        }

        setEntriesByDirectory((current) => ({
          ...current,
          [normalizedPath]: entries,
        }));
        if (clearMessage) {
          setMessage(null);
        }
        return entries;
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
            if (!(normalizedPath in current)) {
              return current;
            }

            const next = { ...current };
            delete next[normalizedPath];
            return next;
          });
          return;
        }

        reportError("Workspace", error);
      }
    },
    [reportError, workspaceFiles],
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
      const hasPackageManifest = entries.some(
        (entry) => entry.kind === "file" && entry.name === "package.json",
      );
      const hasArtisan = entries.some(
        (entry) => entry.kind === "file" && entry.name === "artisan",
      );
      const [composerJson, packageJson] = await Promise.all([
        hasComposerManifest
          ? readTestFileIfExists(joinWorkspacePath(rootPath, "composer.json"))
          : null,
        hasPackageManifest
          ? readTestFileIfExists(joinWorkspacePath(rootPath, "package.json"))
          : null,
      ]);

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        (isMutationOwnerCurrent && !isMutationOwnerCurrent())
      ) {
        return;
      }

      setPackageScriptsByRoot((current) => ({
        ...current,
        [rootPath]: {
          composerScripts: composerJson
            ? parseComposerScripts(composerJson)
            : [],
          hasArtisan,
          npmPackageManager: detectNodePackageManager({
            rootFileNames: entries
              .filter((entry) => entry.kind === "file")
              .map((entry) => entry.name),
            packageJsonText: packageJson,
          }),
          npmScripts: packageJson ? parsePackageJsonScripts(packageJson) : [],
        },
      }));
    },
    [readTestFileIfExists],
  );

  const restoreWorkspaceSession = useCallback(
    async (
      rootPath: string,
      session: WorkspaceSessionState,
      isMutationOwnerCurrent?: () => boolean,
    ) => {
      if (editorGroupsUniquePaths(session.editor).length === 0) {
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
          (isMutationOwnerCurrent && !isMutationOwnerCurrent())
        ) {
          return;
        }
        workspaceEditorViewStatesRef.current[
          editorSessionOwnerKeyForRoot(rootPath)
        ] = session.viewStates ?? {};
        setSidebarView(session.sidebarView);
        setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));
        return;
      }
      const openFileRequestToken = openFileRequestTokenRef.current;
      const restored = await restorePersistedWorkspaceSession(
        rootPath,
        session,
        async (path): Promise<EditorDocument> => {
          const snapshot = await readWorkspaceTextFileSnapshot(
            workspaceFiles,
            path,
          );
          return {
            content: snapshot.content,
            language: detectLanguage(path),
            name: getFileName(path),
            path,
            revision: snapshot.revision,
            savedContent: snapshot.content,
          };
        },
      );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        (isMutationOwnerCurrent && !isMutationOwnerCurrent())
      ) {
        return;
      }
      if (openFileRequestTokenRef.current !== openFileRequestToken) {
        return;
      }
      workspaceEditorViewStatesRef.current[
        editorSessionOwnerKeyForRoot(rootPath)
      ] = restored.viewStates;
      setDocuments(restored.documents);
      updateEditorGroups(() => restored.editor);
      setSidebarView(session.sidebarView);
      setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));

      const restoredActivePath = restored.editor.groups[
        restored.editor.activeGroupId
      ]?.activePath;
      const restoredActiveDocument = restoredActivePath
        ? restored.documents[restoredActivePath]
        : null;

      if (restoredActiveDocument?.language === "php") {
        updateLocalPhpDiagnostics(
          restoredActiveDocument.path,
          localPhpDiagnosticsFromSource(restoredActiveDocument.content, []),
        );
      }

      if (restored.failedPaths.length === 0) {
        return;
      }

      setNotices((current) => [
        createWorkbenchNotice(
          "warning",
          "Session",
          `Could not restore ${restored.failedPaths.length} tab${restored.failedPaths.length === 1 ? "" : "s"}.`,
        ),
        ...current,
      ]);
    },
    [
      editorSessionOwnerKeyForRoot,
      updateEditorGroups,
      updateLocalPhpDiagnostics,
      workspaceFiles,
    ],
  );

  const runWithIssuedWriteDrainRef =
    useRef<RunWithDocumentSaveExclusion>(async (_scope, operation) =>
      operation(),
    );
  const runWithIssuedWriteDrainDelegate =
    useCallback<RunWithDocumentSaveExclusion>(
      (scope, operation) =>
        runWithIssuedWriteDrainRef.current(scope, operation),
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
      const shouldCachePreviousWorkspace =
        options.cachePreviousWorkspace !== false;
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
      const previousWorkspaceIdentity = previousRootPath
        ? workspaceIdentityByRootRef.current[previousRootPath] ?? null
        : null;
      const previousEditorSessionOwnerKey = previousRootPath
        ? previousWorkspaceIdentity
          ? createEditorSessionOwnerKey(
              previousWorkspaceIdentity.workspaceId,
              previousWorkspaceIdentity.canonicalRoot,
            )
          : createLegacyEditorSessionOwnerKey(previousRootPath)
        : null;
      const nextEditorSessionOwnerKey = identityDescriptor
        ? createEditorSessionOwnerKey(
            identityDescriptor.workspaceId,
            identityDescriptor.canonicalRoot,
          )
        : createLegacyEditorSessionOwnerKey(path);
      const replacingOwnerAtSameRoot = Boolean(
        previousRootPath &&
          workspaceRootKeysEqual(previousRootPath, path) &&
          previousEditorSessionOwnerKey !== nextEditorSessionOwnerKey,
      );
      const switchingWorkspace =
        previousRootPath &&
        (!workspaceRootKeysEqual(previousRootPath, path) ||
          previousEditorSessionOwnerKey !== nextEditorSessionOwnerKey);

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

        const legacyCachedWorkspaceState = adoptLegacyCachedWorkspaceState(
          identityDescriptor,
          [
            resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
            resolveCachedWorkspaceState(path),
          ],
        );
        if (!legacyCachedWorkspaceState) {
          return;
        }

        cachedWorkspaceState = coalesceWorkspaceStateCache(
          identityDescriptor,
          path,
        );
      };

      if (switchingWorkspace) {
        resetFilePrefetchState();
      }

      if (switchingWorkspace) {
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
              closeLanguageServerDocuments:
                closeSyncedLanguageServerDocumentsForRoot,
              closeJavaScriptTypeScriptDocuments:
                closeSyncedJavaScriptTypeScriptDocumentsForRoot,
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
            !previousWorkspaceIdentity &&
            workspaceRootKeysEqual(previousRootPath, path);
          if (isNewIdentityForActiveLegacyWorkspace) {
            const capturedLegacyState = adoptLegacyCachedWorkspaceState(
              identityDescriptor,
              [
                resolveCachedWorkspaceState(previousRootPath),
                resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
              ],
            );
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

          cachedWorkspaceState = coalesceWorkspaceStateCache(
            identityDescriptor,
            path,
          );
        }
      }

      adoptLegacyWorkspaceCache();
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
      const pendingWorkspaceSettingsSave =
        workspaceSettingsSaveCoordinator.waitForIdle(canonicalKey);

      if (pendingWorkspaceSettingsSave) {
        await pendingWorkspaceSettingsSave;
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      const workspaceSettingsRevisionAtLoad =
        workspaceSettingsByRoot.revision(canonicalKey);
      const workspaceSettingsLoadKey = normalizedWorkspaceRootKey(canonicalKey);
      const requestedSettingsIdentity = identityDescriptor
        ? workspaceSettingsIdentity(canonicalKey, path)
        : path;
      const requestedLegacyRawKeys =
        typeof requestedSettingsIdentity === "string"
          ? [requestedSettingsIdentity]
          : requestedSettingsIdentity.legacyRawKeys ?? [];

      try {
        const trackWorkspaceSettingsLoad = (
          promise: Promise<WorkspaceSettings>,
          legacyRawKeys: readonly string[],
        ): PendingWorkspaceSettingsLoad => {
          const tracked = { legacyRawKeys, promise };
          workspaceSettingsLoadByRootRef.current[workspaceSettingsLoadKey] =
            tracked;
          const clearWorkspaceSettingsLoad = () => {
            if (
              workspaceSettingsLoadByRootRef.current[
                workspaceSettingsLoadKey
              ] !== tracked
            ) {
              return;
            }

            delete workspaceSettingsLoadByRootRef.current[
              workspaceSettingsLoadKey
            ];
          };
          void promise.then(
            clearWorkspaceSettingsLoad,
            clearWorkspaceSettingsLoad,
          );
          return tracked;
        };
        let workspaceSettingsLoad =
          workspaceSettingsLoadByRootRef.current[workspaceSettingsLoadKey];
        if (!workspaceSettingsLoad) {
          workspaceSettingsLoad = trackWorkspaceSettingsLoad(
            settingsGateway.loadWorkspaceSettings(requestedSettingsIdentity),
            requestedLegacyRawKeys,
          );
        }

        const hasAllRequestedLegacyRawKeys = requestedLegacyRawKeys.every(
          (legacyRawKey) =>
            workspaceSettingsLoad.legacyRawKeys.includes(legacyRawKey),
        );
        if (!hasAllRequestedLegacyRawKeys) {
          const continueWithWinningAlias = () => {
            if (!isCurrentOpenWorkspaceRequest()) {
              return defaultWorkspaceSettings();
            }

            return settingsGateway.loadWorkspaceSettings(
              requestedSettingsIdentity,
            );
          };
          workspaceSettingsLoad = trackWorkspaceSettingsLoad(
            workspaceSettingsLoad.promise.then(
              continueWithWinningAlias,
              continueWithWinningAlias,
            ),
            [
              ...new Set([
                ...workspaceSettingsLoad.legacyRawKeys,
                ...requestedLegacyRawKeys,
              ]),
            ],
          );
        }
        workspaceSettings = await workspaceSettingsLoad.promise;
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
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
        workspaceSettingsSaveCoordinator.captureCommitted(
          canonicalKey,
          workspaceSettings,
        );
      }
      if (!capturedWorkspaceSettings) {
        workspaceSettings =
          workspaceSettingsByRoot.resolve(canonicalKey) ?? workspaceSettings;
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
          generation:
            workspaceRuntimeOwnerClaimsRef.current[owner.ownerKey]?.generation,
          owner,
        }));
        try {
          await stopBackgroundProjectRuntimes(
            runtimePolicy,
            path,
            previousRootPath,
          );
          for (const disposedRuntimeOwnerClaim of disposedRuntimeOwnerClaims) {
            const disposedRuntimeOwner = disposedRuntimeOwnerClaim.owner;
            if (disposedRuntimeOwnerClaim.generation === undefined) {
              continue;
            }
            if (
              identityDescriptor?.workspaceId ===
              disposedRuntimeOwner.ownerKey
            ) {
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

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      if (identityDescriptor) {
        const previousIdentity =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        adoptIdentity?.();
        if (cachedWorkspaceState) {
          cachedWorkspaceState.workspaceIdentityDescriptor =
            identityDescriptor;
        }
        if (
          previousIdentity &&
          previousIdentity.workspaceId !== identityDescriptor.workspaceId
        ) {
          retireWorkspaceRuntimeOwnerClaim(
            previousIdentity.workspaceId,
            workspaceRuntimeOwnerClaimsRef.current[
              previousIdentity.workspaceId
            ]?.generation,
          );
          delete workspaceRuntimeRootByTabRef.current[
            previousIdentity.selectedPath
          ];
          delete workspaceRuntimeRootByTabRef.current[
            previousIdentity.canonicalRoot
          ];
          delete workspaceRuntimeOwnerByTabRef.current[
            previousIdentity.selectedPath
          ];
          delete workspaceRuntimeOwnerByTabRef.current[
            previousIdentity.canonicalRoot
          ];
          removeWorkspaceIdentityMappings(
            workspaceIdentityByRootRef.current,
            previousIdentity,
          );
          void releaseOwnedWorkspaceIdentity(previousIdentity.workspaceId)
            .catch((error) => reportError("Workspace", error));
        }
        removeWorkspaceIdentityMappings(
          workspaceIdentityByRootRef.current,
          identityDescriptor,
        );
        for (const aliasPath of identityAliasPaths) {
          delete workspaceRuntimeRootByTabRef.current[aliasPath];
          delete workspaceRuntimeOwnerByTabRef.current[aliasPath];
        }
      }

      setWorkspaceRoot(path);
      setPackageScriptsByRoot((current) => ({
        ...current,
        [path]: {
          composerScripts: [],
          hasArtisan: false,
          npmPackageManager: "npm",
          npmScripts: [],
        },
      }));
      setWorkspaceIdentityDescriptor(identityDescriptor);
      const admittedRuntimeOwner = workspaceRuntimeOwnerFor(
        path,
        identityDescriptor,
      );
      const explicitRuntimeOwner = identityDescriptor
        ? admittedRuntimeOwner
        : undefined;
      workspaceRuntimeOwnerRef.current = admittedRuntimeOwner;
      const isCurrentOpenWorkspaceOwnerRequest = () => {
        if (!isCurrentOpenWorkspaceRequest()) {
          return false;
        }

        const currentOwner = resolveCurrentWorkspaceRuntimeOwner();
        if (!currentOwner || currentOwner.ownerKey !== admittedRuntimeOwner.ownerKey) {
          return false;
        }

        return workspaceRootKeysEqual(
          currentOwner.executionRoot,
          admittedRuntimeOwner.executionRoot,
        );
      };
      if (identityDescriptor) {
        registerWorkspaceRuntimeOwnerClaim(
          workspaceRuntimeOwnerClaimsRef.current,
          admittedRuntimeOwner,
          identityAliasPaths,
          ownedWorkspaceIdentityGenerationByIdRef.current[
            identityDescriptor.workspaceId
          ] ?? null,
        );
        workspaceIdentityByRootRef.current[path] = identityDescriptor;
        workspaceIdentityByRootRef.current[identityDescriptor.canonicalRoot] =
          identityDescriptor;
        workspaceRuntimeRootByTabRef.current[path] = path;
        workspaceRuntimeRootByTabRef.current[identityDescriptor.canonicalRoot] =
          path;
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
        workspaceRuntimeOwnerByTabRef.current[
          identityDescriptor.canonicalRoot
        ] = admittedRuntimeOwner;
      }
      if (!identityDescriptor) {
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
      }
      currentWorkspaceRootRef.current = path;
      currentEditorSessionOwnerKeyRef.current = identityDescriptor
        ? createEditorSessionOwnerKey(
            identityDescriptor.workspaceId,
            identityDescriptor.canonicalRoot,
          )
        : createLegacyEditorSessionOwnerKey(path);
      lastLanguageServerCrashRef.current = null;
      restoreLanguageServerDiagnosticsForRoot(path, explicitRuntimeOwner);
      restoreJavaScriptTypeScriptDiagnosticsForRoot(path, explicitRuntimeOwner);

      if (cachedWorkspaceState) {
        restoreCachedWorkspaceState(path, cachedWorkspaceState);
      } else {
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
        const recentWorkspaceCandidates =
          (appSettingsRef.current.recentWorkspacePaths ?? []).filter(
            (recentPath) =>
              !identityAliasPaths.some((aliasPath) =>
                workspaceRootKeysEqual(aliasPath, recentPath),
              ),
          );
        const recentWorkspacePaths = pushRecentWorkspacePath(
          recentWorkspaceCandidates,
          path,
        );
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
        const smartMode = await smartModeGateway.setMode(
          path,
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
      // against the admitted owner and open request so that replacing a
      // workspace mid-flight, including at the same selected path, never lets
      // stale results mutate the active workspace state.
      const loadDirectoryTask = async (): Promise<void> => {
        const cachedEntries = cachedWorkspaceState?.entriesByDirectory[path];
        const entries = cachedEntries ?? (await loadDirectory(path, {
          isMutationOwnerCurrent: isCurrentOpenWorkspaceOwnerRequest,
          requireActiveRoot: true,
        }));

        if (!isCurrentOpenWorkspaceOwnerRequest()) {
          return;
        }

        await loadPackageScripts(
          path,
          entries ?? [],
          isCurrentOpenWorkspaceOwnerRequest,
        );
      };

      const loadTrustTask = async (): Promise<void> => {
        try {
          const trust = await workspaceTrustGateway.getTrust(path);

          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return;
          }

          setWorkspaceTrust(trust);
        } catch (error) {
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return;
          }

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
      // (preserving the basic/light-mode defer) and is owner-isolated: the probe
      // captures the admitted runtime owner and re-checks it after its own
      // awaits, and detection drops stale requests before triggering it.
      let warmedUpPhpProbe = false;
      const detectWorkspaceTask =
        async (): Promise<WorkspaceDescriptor | null> => {
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
            hasPhpWorkspaceByOwnerRef.current[admittedRuntimeOwner.ownerKey] =
              Boolean(detected?.php);

            if (
              detected?.php &&
              shouldStartLanguageServer(resolvedIntelligenceMode)
            ) {
              warmedUpPhpProbe = true;
              void runPhpWorkspaceProbe(path, admittedRuntimeOwner);
            }

            return detected;
          } catch (error) {
            if (!isCurrentOpenWorkspaceOwnerRequest()) {
              return null;
            }

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
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return;
          }

          workspaceSessionRestoredRef.current = true;
          return;
        }

        await restoreWorkspaceSession(
          path,
          replacingOwnerAtSameRoot
            ? { ...workspaceSettings.session, viewStates: {} }
            : workspaceSettings.session,
          isCurrentOpenWorkspaceOwnerRequest,
        );

        if (!isCurrentOpenWorkspaceOwnerRequest()) {
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
      void refreshJavaScriptTypeScriptLanguageServerPlan(
        path,
        undefined,
        explicitRuntimeOwner,
      );

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

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
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

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
        return;
      }

      await runPhpWorkspaceProbe(path, admittedRuntimeOwner);
    },
    [
      applyWorkspaceSettings,
      cacheCurrentWorkspaceState,
      canonicalDocumentSaveRoot,
      loadDirectory,
      loadPackageScripts,
      persistAppSettings,
      persistCurrentWorkspaceSession,
      runPhpWorkspaceProbe,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      releaseOwnedWorkspaceIdentity,
      resolveCurrentWorkspaceRuntimeOwner,
      retireWorkspaceRuntimeOwnerClaim,
      restoreLanguageServerDiagnosticsForRoot,
      coalesceWorkspaceStateCache,
      resolveCachedWorkspaceState,
      restoreCachedWorkspaceState,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreWorkspaceSession,
      runGitRepositoryDiscovery,
      clearIndexWorkspaceState,
      resetActiveEditorPosition,
      resetEditorSurfaceState,
      resetFilePrefetchState,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere,
      resetTextSearchState,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      runWithIssuedWriteDrainDelegate,
      restoreIndexRoot,
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
      workspaceSettingsByRoot,
      workspaceSettingsSaveCoordinator,
      workspaceTrustGateway,
      refreshJavaScriptTypeScriptLanguageServerPlan,
    ],
  );

  const advanceWorkspaceCloseOwnership = useCallback(
    (
      path: string | null,
      identity: WorkspaceIdentityDescriptor | null,
    ): { generation: number; keys: string[] } => {
      const generation = workspaceCloseOwnershipGenerationRef.current + 1;
      workspaceCloseOwnershipGenerationRef.current = generation;
      const rootPaths = [
        path,
        identity?.selectedPath ?? null,
        identity?.canonicalRoot ?? null,
      ];
      const keys = rootPaths.flatMap((rootPath) => {
        const rootKey = normalizedWorkspaceRootKey(rootPath);
        if (!rootKey) {
          return [];
        }

        workspaceCloseGenerationByRootRef.current[rootKey] =
          (workspaceCloseGenerationByRootRef.current[rootKey] ?? 0) + 1;
        return [`root:${rootKey}`];
      });
      if (identity) {
        keys.push(`workspace:${identity.workspaceId}`);
      }

      const uniqueKeys = [...new Set(keys)];
      for (const key of uniqueKeys) {
        workspaceCloseOwnershipByKeyRef.current[key] = generation;
      }

      return { generation, keys: uniqueKeys };
    },
    [],
  );

  const invalidateWorkspaceCloseOwnership = useCallback(
    (path: string | null, identity: WorkspaceIdentityDescriptor | null) => {
      advanceWorkspaceCloseOwnership(path, identity);
    },
    [advanceWorkspaceCloseOwnership],
  );

  const beginWorkspaceClose = useCallback(
    (
      rootPath: string,
      identity: WorkspaceIdentityDescriptor | null,
    ): WorkspaceCloseOwnership => {
      const { generation, keys } = advanceWorkspaceCloseOwnership(
        rootPath,
        identity,
      );
      return {
        isCurrent: () =>
          keys.every(
            (key) =>
              workspaceCloseOwnershipByKeyRef.current[key] === generation,
          ),
      };
    },
    [advanceWorkspaceCloseOwnership],
  );

  const issueOpenWorkspaceRequest = useCallback(
    (path: string | null) => {
      const identity = path
        ? workspaceIdentityByRootRef.current[path] ?? null
        : null;
      invalidateWorkspaceCloseOwnership(path, identity);
      const requestToken = openWorkspaceRequestTokenRef.current + 1;
      openWorkspaceRequestTokenRef.current = requestToken;
      openWorkspaceRequestPathRef.current = path;
      openWorkspaceRequestInFlightTokenRef.current = requestToken;
      pendingWorkspaceIdentityRequestTokensRef.current.add(requestToken);
      return requestToken;
    },
    [invalidateWorkspaceCloseOwnership],
  );

  const completeOpenWorkspaceRequest = useCallback((requestToken: number) => {
    pendingWorkspaceIdentityRequestTokensRef.current.delete(requestToken);
    flushDeferredWorkspaceIdentityCleanup();
    if (openWorkspaceRequestInFlightTokenRef.current !== requestToken) {
      return;
    }

    openWorkspaceRequestInFlightTokenRef.current = null;
  }, [flushDeferredWorkspaceIdentityCleanup]);

  const openWorkspacePath = useCallback(
    (
      path: string,
      options: OpenWorkspacePathOptions = {},
    ): Promise<void> => {
      const requestToken = issueOpenWorkspaceRequest(path);
      const request = (async () => {
        const openPath = workspaceGateways.identity.openPath;
        if (openPath) {
          let descriptor: WorkspaceIdentityDescriptor;
          try {
            descriptor = await openPath.call(workspaceGateways.identity, path);
          } catch (error) {
            if (openWorkspaceRequestTokenRef.current === requestToken) {
              reportError("Workspace", error);
            }
            return;
          }

          invalidateWorkspaceCloseOwnership(path, descriptor);

          await withManagedWorkspaceIdentityLease(
            descriptor,
            async (adoptIdentity) => {
              if (
                !workbenchMountedRef.current ||
                openWorkspaceRequestTokenRef.current !== requestToken
              ) {
                return;
              }

              await performOpenWorkspacePath(
                descriptor.selectedPath,
                descriptor,
                adoptIdentity,
                requestToken,
                options,
              );
            },
          );
          return;
        }

        const cachedWorkspaceState = resolveCachedWorkspaceState(path);
        const identityDescriptor =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        invalidateWorkspaceCloseOwnership(path, identityDescriptor);
        await performOpenWorkspacePath(
          identityDescriptor?.selectedPath ?? path,
          identityDescriptor,
          null,
          requestToken,
          options,
        );
      })();

      return request.finally(() => {
        completeOpenWorkspaceRequest(requestToken);
      });
    },
    [
      completeOpenWorkspaceRequest,
      issueOpenWorkspaceRequest,
      invalidateWorkspaceCloseOwnership,
      performOpenWorkspacePath,
      reportError,
      resolveCachedWorkspaceState,
      withManagedWorkspaceIdentityLease,
      workspaceGateways.identity,
    ],
  );

  const openWorkspace = useCallback(async () => {
    const requestToken = issueOpenWorkspaceRequest(null);
    try {
      const result = await workspaceGateways.identity.openFromPicker();
      if (result.status === "cancelled") {
        return;
      }

      invalidateWorkspaceCloseOwnership(
        result.descriptor.selectedPath,
        result.descriptor,
      );

      await withManagedWorkspaceIdentityLease(
        result.descriptor,
        async (adoptIdentity) => {
          if (
            !workbenchMountedRef.current ||
            openWorkspaceRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          await performOpenWorkspacePath(
            result.descriptor.selectedPath,
            result.descriptor,
            adoptIdentity,
            requestToken,
          );
        },
      );
    } catch (error) {
      if (openWorkspaceRequestTokenRef.current === requestToken) {
        reportError("Workspace", error);
      }
    } finally {
      completeOpenWorkspaceRequest(requestToken);
    }
  }, [
    completeOpenWorkspaceRequest,
    issueOpenWorkspaceRequest,
    invalidateWorkspaceCloseOwnership,
    performOpenWorkspacePath,
    reportError,
    withManagedWorkspaceIdentityLease,
    workspaceGateways.identity,
  ]);

  const openWorkspaceRoot = useCallback(
    async (path: string): Promise<boolean> => {
      await openWorkspacePath(path);

      return workspaceRootKeysEqual(currentWorkspaceRootRef.current, path);
    },
    [openWorkspacePath],
  );

  const activateWorkspaceTab = useCallback(
    async (path: string) => {
      invalidateWorkspaceCloseOwnership(
        path,
        workspaceIdentityByRootRef.current[path] ?? null,
      );
      if (workspaceRootKeysEqual(path, workspaceRoot)) {
        const inFlightToken = openWorkspaceRequestInFlightTokenRef.current;
        if (
          inFlightToken === openWorkspaceRequestTokenRef.current &&
          !workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path)
        ) {
          openWorkspaceRequestTokenRef.current += 1;
          openWorkspaceRequestPathRef.current = path;
          openWorkspaceRequestInFlightTokenRef.current = null;
        }
        return;
      }

      await openWorkspacePath(path);
    },
    [invalidateWorkspaceCloseOwnership, openWorkspacePath, workspaceRoot],
  );

  useEffect(
    () => () => {
      workbenchMountedRef.current = false;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openWorkspaceRequestInFlightTokenRef.current = null;
      openFileRequestTokenRef.current += 1;
      workspaceSettingsLoadByRootRef.current = {};
      const workspaceIds = [...ownedWorkspaceIdentityIdsRef.current];
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      workspaceRuntimeOwnerClaimsRef.current = {};
      for (const workspaceId of workspaceIds) {
        void releaseOwnedWorkspaceIdentity(workspaceId).catch(() => undefined);
      }
    },
    [releaseOwnedWorkspaceIdentity],
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

  const revealPathInTree = useCallback(
    (path: string, respectManualCollapses: boolean) => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        ) ||
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
          (respectManualCollapses &&
            isBlockedByManuallyCollapsedDirectory(
              directory,
              manuallyCollapsedDirectories,
            )) ||
          entriesByDirectory[directory] ||
          loadingDirectories.has(directory)
        ) {
          continue;
        }

        void loadDirectory(directory, { clearMessage: false });
      }
    },
    [
      entriesByDirectory,
      loadDirectory,
      loadingDirectories,
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
  }, [
    activePath,
    revealPathInTree,
    workspaceSettings.revealActiveFileInTree,
  ]);

  const {
    closeGitDiffPreview,
    reconcileSelectedGitDiffPreviewForRepository,
  } = useGitDiffPreviewCloseLifecycle({
    documentTabSession,
    cancelGitDiffDocument,
    getGitDiffDocument,
    getSelectedGitDiffDocument,
    gitChangeForDiffDocumentPath,
    loadGitDiffDocument,
    reloadGitDiffDocument,
    reconcileGitDiffDocument,
  });
  reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef.current =
    reconcileSelectedGitDiffPreviewForRepository;

  const recordGitCommitMessage = useCallback(
    async (requestedRoot: string, commitMessage: string) => {
      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        )
      ) {
        return;
      }

      const currentSettings = workspaceSettingsRef.current;
      const gitCommitMessageHistory = pushGitCommitMessageHistory(
        currentSettings.gitCommitMessageHistory,
        commitMessage,
      );

      if (gitCommitMessageHistory === currentSettings.gitCommitMessageHistory) {
        return;
      }

      try {
        await persistWorkspaceSettings(requestedRoot, {
          ...currentSettings,
          gitCommitMessageHistory,
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
      }
    },
    [persistWorkspaceSettings, reportErrorForActiveWorkspaceRoot],
  );

  const canRevertGitChange = useCallback(
    (change: GitChangedFile) =>
      canRevertGitChangeForDocuments(change, documentsRef.current),
    [documentsRef],
  );

  const {
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
  } = useGitWorkspace({
    gitGateway,
    gitOperationCurrency,
    currentWorkspaceRootRef,
    workspaceRoot,
    gitStatus,
    applyGitOperationStatuses,
    reportError,
    setMessage,
    prompter,
    canRevertGitChange,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    gitCommitMessageHistory: workspaceSettings.gitCommitMessageHistory,
    recordGitCommitMessage,
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
    [
      activeDocument,
      loadInheritedPhpFileOutline,
      loadingInheritedPhpFileOutlinePaths,
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

    if (!loadingPhpFileOutlinePaths.has(document.path)) {
      void loadPhpFileOutline(document.path);
    }

  }, [
    fileStructureOpen,
    fileStructureScope,
    loadPhpFileOutline,
    loadingPhpFileOutlinePaths,
    openJavaScriptTypeScriptFileStructure,
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
    reportChangedDocuments,
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
      isWorkspaceTrusted: () => workspaceTrust?.trusted === true,
      isReferenceIndexComplete: (rootPath: string) =>
        indexProgress.status === "completed" &&
        indexProgress.erroredEntries === 0 &&
        workspaceRootKeysEqual(indexProgress.rootPath, rootPath),
      languageServer: languageServerFeaturesGateway,
      notifyClosedDocumentsChanged: async (
        rootPath: string,
        paths: string[],
      ) => {
        if (paths.length === 0) return;
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
          workspaceTrust?.trusted !== true
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
        const results = await textSearch.searchText(
          rootPath,
          callableName,
          limit,
          {
            caseSensitive: false,
            fileMask: "*.php",
            isRegex: false,
            preserveCase: false,
            wholeWord: true,
          },
        );
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
      workspaceTrust?.trusted,
    ],
  );
  const phpChangeSignature = usePhpChangeSignatureWorkflow(
    phpChangeSignaturePorts,
  );

  // Reads and caches one `.editorconfig`. UI requests remain scoped to the
  // active root; owner-save requests use their captured owner and root.
  const loadEditorConfigFile = useCallback(
    async (
      requestedRoot: string,
      directory: string,
      requestedOwner?: WorkspaceRuntimeOwner,
    ): Promise<EditorConfigFile | null> => {
      return loadWorkbenchEditorConfigFile({
        cache: () => editorConfigCacheRef.current,
        currentWorkspaceRoot: () => currentWorkspaceRootRef.current,
        readTextFile: workspaceFiles.readTextFile.bind(workspaceFiles),
        resolveWorkspaceRuntimeOwner,
      }, {
        directory,
        rootPath: requestedRoot,
        ...(requestedOwner ? { owner: requestedOwner } : {}),
      });
    },
    [resolveWorkspaceRuntimeOwner, workspaceFiles],
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
      requestedOwner?: WorkspaceRuntimeOwner,
    ): Promise<ResolvedEditorConfig> => {
      const directories = editorConfigDirectoriesForFile(filePath, requestedRoot);
      const files: EditorConfigFile[] = [];

      for (const directory of directories) {
        const file = await loadEditorConfigFile(
          requestedRoot,
          directory,
          requestedOwner,
        );

        const resolvedOwner = requestedOwner
          ? resolveWorkspaceRuntimeOwner(requestedRoot)
          : null;
        const ownerIsCurrent = requestedOwner
          ? resolvedOwner?.ownerKey === requestedOwner.ownerKey &&
            workspaceRootKeysEqual(
              resolvedOwner.executionRoot,
              requestedOwner.executionRoot,
            )
          : workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            );
        if (!ownerIsCurrent) {
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
    [loadEditorConfigFile, resolveWorkspaceRuntimeOwner],
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
    formattedContentForOwnerSave,
    optimizedImportsContentForSave,
    optimizedImportsContentForOwnerSave,
    organizedImportsContentForSave,
    organizedImportsContentForOwnerSave,
  } = useDocumentSavePipeline({
    workspaceSettingsRef,
    hasPhpWorkspace: Boolean(workspaceDescriptor?.php),
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
  const ownerDocumentSavePipelineContext = useCallback((
    owner: WorkspaceRuntimeOwner,
    settings: WorkspaceSettings,
  ) => {
    const activeRoot = currentWorkspaceRootRef.current;
    const synchronizedOwner = activeRoot
      ? resolveWorkspaceRuntimeOwner(activeRoot)
      : null;
    return ownerDocumentSavePipelineContextFor(
      owner,
      settings,
      hasPhpWorkspaceByOwnerRef.current,
      languageServerRuntimeStatusByRootRef.current,
      javaScriptTypeScriptRuntimeStatusByRootRef.current,
      synchronizedOwner,
    );
  }, [currentWorkspaceRootRef, resolveWorkspaceRuntimeOwner]);

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
  clearExternalFileConflictsForRootRef.current = externalFileConflicts.clearRoot;
  workspaceHasExternalFileConflictsRef.current =
    externalFileConflicts.hasConflictsForRoot;
  const dirtyCount = openDocuments.filter(
    (document) =>
      !document.readOnly &&
      documentNeedsAttention(
        isDirty(document),
        externalFileConflicts.hasConflict(workspaceRoot, document.path),
      ),
  ).length;

  const ownerDocumentSaveAdapters = useMemo(
    () => new WorkbenchOwnerDocumentSaveAdapters({
      currentWorkspaceRootRef,
      documentsRef,
      editorGroupsRef,
      setDocuments,
      workspaceStateCacheRef,
      workspaceIdentityByRootRef,
      resolveDocumentSaveOwnership,
      resolveWorkspaceRuntimeOwner,
      hasExternalFileConflict: externalFileConflicts.hasConflict,
    }),
    [
      documentsRef,
      editorGroupsRef,
      externalFileConflicts.hasConflict,
      resolveDocumentSaveOwnership,
      resolveWorkspaceRuntimeOwner,
      setDocuments,
      workspaceStateCacheRef,
    ],
  );
  const ownerResolvingDocumentSaveService = useMemo(
    () => new OwnerResolvingDocumentSaveService({
      repository: ownerDocumentSaveAdapters.repository,
      resolvePipeline: (owner, rootPath) => {
        const canonicalRoot = canonicalDocumentSaveRoot(rootPath);
        const settings = workspaceSettingsByRoot.resolve(canonicalRoot) ??
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
          captureLocalHistorySnapshot: async (
            requestedOwner,
            requestedRoot,
            path,
            content,
          ) => {
            if (!ownerDocumentSaveAdapters.isOwnerCurrent(requestedOwner)) {
              return;
            }
            const relativePath = workspaceRelativePath(requestedRoot, path);
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
          formattedContentForSave: (
            requestedOwner,
            requestedRoot,
            requestedSettings,
            document,
          ) => formattedContentForOwnerSave(
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
          ) => optimizedImportsContentForOwnerSave(
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
          ) => organizedImportsContentForOwnerSave(
            ownerDocumentSavePipelineContext(requestedOwner, requestedSettings),
            document,
            content,
            requestedRoot,
          ),
          resolveEditorConfigForFile: (
            requestedOwner,
            requestedRoot,
            path,
          ) => resolveEditorConfigForFile(
            requestedRoot,
            path,
            requestedOwner,
          ),
          syncSavedDocument: async (
            requestedOwner,
            requestedRoot,
            document,
            shouldEmit,
          ) => {
            if (
              resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
            ) {
              return;
            }
            if (!workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )) {
              return;
            }
            await syncSavedDocumentForRoot(
              requestedRoot,
              document,
              shouldEmit,
            );
          },
          syncSavedJavaScriptTypeScriptDocument: async (
            requestedOwner,
            requestedRoot,
            document,
            shouldEmit,
          ) => {
            if (
              resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
            ) {
              return;
            }
            if (!workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )) {
              return;
            }
            await syncSavedJavaScriptTypeScriptDocumentForRoot(
              requestedRoot,
              document,
              shouldEmit,
            );
          },
          hasExternalFileConflict: (requestedOwner, requestedRoot, path) =>
            resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey ===
                requestedOwner.ownerKey &&
              externalFileConflicts.hasConflict(requestedRoot, path),
          beginDocumentSelfWrite: (
            requestedOwner,
            requestedRoot,
            path,
            content,
          ) => {
            if (
              resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
            ) {
              return null;
            }
            const ownership = resolveDocumentSaveOwnership(
              requestedRoot,
              path,
            );
            return ownership
              ? documentSelfWrites.begin(ownership, content)
              : null;
          },
        };
      },
    }),
    [
      canonicalDocumentSaveRoot,
      documentSelfWrites,
      externalFileConflicts.hasConflict,
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
  >((ownership, operation) =>
    requestOwnerDocumentSaveRef.current(ownership, operation), []);

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
      const previousPhpStatus =
        languageServerRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousJavaScriptTypeScriptStatus =
        javaScriptTypeScriptRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousActivePhpStatus = languageServerRuntimeStatusRef.current;
      const previousActivePhpStatusRoot =
        languageServerRuntimeStatusRootRef.current;
      const previousActiveJavaScriptTypeScriptStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      const previousActiveJavaScriptTypeScriptStatusRoot =
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current;

      const stopResult = await stopProjectRuntimes(
        runtimeRootPath,
        runtimeOwner,
      );
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
      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          rootPath,
        )
      ) {
        return "stale" as const;
      }

      languageServerRuntimeStatusRef.current = previousActivePhpStatus;
      languageServerRuntimeStatusRootRef.current =
        previousActivePhpStatusRoot;
      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
        previousActiveJavaScriptTypeScriptStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        previousActiveJavaScriptTypeScriptStatusRoot;
      setLanguageServerRuntimeStatus(previousActivePhpStatus);
      setLanguageServerRuntimeStatusRoot(previousActivePhpStatusRoot);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(
        previousActiveJavaScriptTypeScriptStatus,
      );
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
      stopProjectRuntimes,
    ],
  );

  const forgetLanguageServerRuntimeStatusesForWorkspaceClose = useCallback(
    (rootPath: string) => {
      const runtimeOwner = workspaceRuntimeOwnerByTabRef.current[rootPath];
      const claimGeneration = runtimeOwner
        ? workspaceRuntimeOwnerClaimsRef.current[runtimeOwner.ownerKey]
            ?.generation
        : undefined;
      forgetLanguageServerRuntimeStatuses(rootPath, runtimeOwner);
      if (runtimeOwner) {
        retireWorkspaceRuntimeOwnerClaim(
          runtimeOwner.ownerKey,
          claimGeneration,
        );
      }
      delete workspaceRuntimeOwnerByTabRef.current[rootPath];
    },
    [forgetLanguageServerRuntimeStatuses, retireWorkspaceRuntimeOwnerClaim],
  );
  const clearWorkspaceResourceCachesForRoot = useCallback(
    (rootPath: string) => {
      invalidateEditorConfigCacheForRoot(editorConfigCacheRef.current, rootPath);
      documentSelfWrites.clearRoot(rootPath);
    },
    [documentSelfWrites],
  );
  const clearExternalFileConflictsForWorkspaceClose = useCallback(
    (rootPath: string) => {
      clearExternalFileConflictsForRootRef.current(rootPath);
    },
    [],
  );

  const runWithDocumentSaveExclusionRef =
    useRef<RunWithDocumentSaveExclusion>(async (_scope, operation) =>
      operation(),
    );
  const runWithDocumentSaveExclusionDelegate =
    useCallback<RunWithDocumentSaveExclusion>(
      (scope, operation) =>
        runWithDocumentSaveExclusionRef.current(scope, operation),
      [],
    );
  const commitWorkspaceClose = beginWorkspaceClose;
  const workspaceCloseSession = useMemo<WorkspaceCloseSessionPort>(
    () => ({
      current: () => {
        const activeRoot = currentWorkspaceRootRef.current;
        if (!activeRoot) {
          return { activeRoot: null, needsAttention: false };
        }

        const hasDirtyDocument = editorGroupsUniquePaths(
          editorGroupsRef.current,
        ).some((path) => {
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
    dirtyCloseDecisionPort:
      options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
    captureDirtyCloseTargets: (rootPath) =>
      ownerDocumentSaveAdapters.capture(rootPath),
    isWorkspaceRuntimeOwnerCurrent: (owner) =>
      ownerDocumentSaveAdapters.isOwnerCurrent(owner),
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
    forgetLanguageServerRuntimeStatuses:
      forgetLanguageServerRuntimeStatusesForWorkspaceClose,
    forgetLatencyTrackerForRoot,
    unregisterWorkspace: releaseOwnedWorkspaceIdentity,
    clearExternalFileConflictsForRoot:
      clearExternalFileConflictsForWorkspaceClose,
    invalidateWorkspaceResourceCachesForRoot:
      clearWorkspaceResourceCachesForRoot,
    workspaceHasExternalFileConflicts: (root) =>
      workspaceHasExternalFileConflictsRef.current(root),
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
        ? appSettingsRef.current.workspaceTabs.find(
            (tabPath) =>
              workspaceIdentityByRootRef.current[tabPath]?.workspaceId ===
              identityDescriptor.workspaceId,
          ) ?? identityDescriptor.selectedPath
        : path;
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[resolvedTabPath] ?? resolvedTabPath;
      const runtimeOwner =
        workspaceRuntimeOwnerByTabRef.current[resolvedTabPath] ??
        workspaceRuntimeOwnerByTabRef.current[path];
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

      workspaceSettingsByRoot.forget(canonicalKey);
      delete workspaceRuntimeRootByTabRef.current[path];
      delete workspaceRuntimeRootByTabRef.current[resolvedTabPath];
      delete workspaceRuntimeRootByTabRef.current[runtimeRootPath];
      delete workspaceRuntimeOwnerByTabRef.current[path];
      delete workspaceRuntimeOwnerByTabRef.current[resolvedTabPath];
      if (runtimeOwner) {
        delete hasPhpWorkspaceByOwnerRef.current[runtimeOwner.ownerKey];
      }

      recentlyClosedTabsRef.current = clearRecentlyClosedTabs(
        recentlyClosedTabsRef.current,
        identityDescriptor
          ? createEditorSessionOwnerKey(
              identityDescriptor.workspaceId,
              identityDescriptor.canonicalRoot,
            )
          : createLegacyEditorSessionOwnerKey(resolvedTabPath),
      );
    },
    [closeWorkspaceTabWithLifecycle, workspaceSettingsByRoot],
  );

  const recentlyClosedDocumentViewState = useCallback(
    (rootPath: string, path: string) =>
      workspaceEditorViewStatesRef.current[
        editorSessionOwnerKeyForRoot(rootPath)
      ]?.[editorGroupsRef.current.activeGroupId]?.[path],
    [editorSessionOwnerKeyForRoot],
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
    (
      rootPath: string,
      path: string,
      viewState: WorkspaceSessionViewState,
    ) => {
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
    [editorSessionOwnerKeyForRoot, setEditorRevealTarget],
  );

  const workspaceTrustedRef = useRef(workspaceTrust?.trusted === true);
  workspaceTrustedRef.current = workspaceTrust?.trusted === true;
  const prettierFormattingGateway =
    options.prettierFormattingGateway ?? defaultPrettierFormattingGateway;
  const saveParticipants = useMemo(
    () =>
      orderedDocumentSaveParticipants({
        eslintFixOnSave: createEslintFixOnSaveParticipant({
          analyseDocument: (rootPath, path, content, binaryPath) =>
            eslintDiagnosticsGateway.analyseDocument(
              rootPath,
              path,
              content,
              binaryPath,
            ),
          isWorkspaceTrusted: () => workspaceTrustedRef.current,
        }),
        prettierFormatOnSave: createPrettierSaveParticipant({
          prettierFormatting: prettierFormattingGateway,
          isWorkspaceTrusted: () => workspaceTrustedRef.current,
        }),
      }),
    [prettierFormattingGateway],
  );

  const {
    captureLocalHistorySnapshot,
    requestOwnerDocumentSave: requestCoordinatedOwnerDocumentSave,
    saveDocument,
    saveActiveDocument,
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
    resolveDocumentSaveOwnership,
    prompter,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument: syncSavedDocumentForRoot,
    syncSavedJavaScriptTypeScriptDocument:
      syncSavedJavaScriptTypeScriptDocumentForRoot,
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
    hasExternalFileConflict: externalFileConflicts.hasConflict,
    beginDocumentSelfWrite: (rootPath, path, content) => {
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      return ownership
        ? documentSelfWrites.begin(ownership, content)
        : null;
    },
    clearExternalFileConflict: externalFileConflicts.clearConflict,
    detectSaveConflict: externalFileConflicts.detectSaveConflict,
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    saveParticipants,
    recentlyClosedDocumentViewState,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange,
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
    dirtyCloseDecisionPort:
      options.dirtyCloseDecisionPort ?? fallbackDirtyCloseDecisionPort,
    hasExternalFileConflict: externalFileConflicts.hasConflict,
    onDidCloseEditorPaths: options.onDidCloseEditorPaths,
    prompter,
  });
  const closeDocumentForCommandsRef = useRef(closeDocument);
  const closeActiveEditorGroupForCommandsRef = useRef(closeActiveEditorGroup);
  const closeActiveEditorGroupSurfaceForCommandsRef = useRef(
    closeActiveEditorGroupSurface,
  );
  closeDocumentForCommandsRef.current = closeDocument;
  closeActiveEditorGroupForCommandsRef.current = closeActiveEditorGroup;
  closeActiveEditorGroupSurfaceForCommandsRef.current =
    closeActiveEditorGroupSurface;
  const runCloseDocument = useCallback((path: string) =>
    closeDocumentForCommandsRef.current(path), []);
  const runCloseActiveEditorGroup = useCallback(async () => {
    await closeActiveEditorGroupForCommandsRef.current();
  }, []);
  const runCloseActiveEditorGroupSurface = useCallback(async () => {
    await closeActiveEditorGroupSurfaceForCommandsRef.current();
  }, []);

  const activateEditorGroup = useCallback((groupId: EditorGroupId) => {
    updateEditorGroups((current) =>
      editorGroupsReducer(current, { type: "activate-group", groupId }),
    );
  }, [updateEditorGroups]);

  const activateEditorGroupTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      const group = editorGroupsRef.current.groups[groupId];

      if (
        !group ||
        (!group.openPaths.includes(path) && group.previewPath !== path)
      ) {
        return;
      }

      updateEditorGroups((current) => {
        const activated = editorGroupsReducer(current, {
          type: "activate-group",
          groupId,
        });
        return editorGroupsReducer(activated, {
          type: "activate-tab",
          groupId,
          path,
        });
      });

      if (isGitDiffDocumentPath(path)) {
        loadGitDiffDocument(path);
        return;
      }

      clearGitDiffPreviewState();
    },
    [clearGitDiffPreviewState, loadGitDiffDocument, updateEditorGroups],
  );

  const splitActiveEditorGroup = useCallback(
    (direction: EditorSplitDirection) => {
      updateEditorGroups((current) => {
        let newGroupId = `editor-${nextEditorGroupIdRef.current++}`;
        while (Object.prototype.hasOwnProperty.call(current.groups, newGroupId)) {
          newGroupId = `editor-${nextEditorGroupIdRef.current++}`;
        }
        return editorGroupsReducer(current, {
          type: "split-group",
          direction,
          newGroupId,
        });
      });
    },
    [updateEditorGroups],
  );

  const focusAdjacentEditorGroup = useCallback((offset: -1 | 1) => {
    const current = editorGroupsRef.current;
    const groupIds = editorGroupIdsInLayout(current.layout);
    if (groupIds.length < 2) {
      return;
    }

    const activeIndex = groupIds.indexOf(current.activeGroupId);
    const nextIndex = (activeIndex + offset + groupIds.length) % groupIds.length;
    const targetGroupId = groupIds[nextIndex];
    updateEditorGroups((state) => editorGroupsReducer(state, {
      type: "activate-group",
      groupId: targetGroupId,
    }));
    options.editorGroupFocusRunner?.(targetGroupId);
  }, [options.editorGroupFocusRunner, updateEditorGroups]);

  const moveActiveTabToAdjacentGroup = useCallback((offset: -1 | 1) => {
    updateEditorGroups((current) => {
      const groupIds = editorGroupIdsInLayout(current.layout);
      if (groupIds.length < 2) {
        return current;
      }
      const sourceIndex = groupIds.indexOf(current.activeGroupId);
      const targetIndex = (sourceIndex + offset + groupIds.length) % groupIds.length;
      const path = current.groups[current.activeGroupId]?.activePath;
      if (!path) {
        return current;
      }
      return transferEditorGroupTab(
        current,
        current.activeGroupId,
        groupIds[targetIndex],
        path,
        "move",
      );
    });
  }, [updateEditorGroups]);

  const moveEditorGroupTab = useCallback(
    (fromGroupId: EditorGroupId, toGroupId: EditorGroupId, path: string) => {
      updateEditorGroups((current) => transferEditorGroupTab(
        current,
        fromGroupId,
        toGroupId,
        path,
        "move",
      ));
    },
    [updateEditorGroups],
  );

  const reorderEditorGroupTab = useCallback(
    (
      groupId: EditorGroupId,
      fromPath: string,
      toPath: string,
      position: TabDropPosition,
    ) => {
      updateEditorGroups((current) => editorGroupsReducer(current, {
        type: "reorder-tab",
        fromPath,
        groupId,
        position,
        toPath,
      }));
    },
    [updateEditorGroups],
  );

  const pinEditorGroupTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      updateEditorGroups((current) => editorGroupsReducer(current, {
        type: "pin-tab",
        groupId,
        path,
      }));
    },
    [updateEditorGroups],
  );

  const resizeEditorSplit = useCallback(
    (splitPath: readonly number[], sizes: readonly [number, number]) => {
      updateEditorGroups((current) => editorGroupsReducer(current, {
        type: "resize-split",
        sizes,
        splitPath,
      }));
    },
    [updateEditorGroups],
  );

  const reorderOpenTabs = useCallback(
    (fromPath: string, toPath: string, position: TabDropPosition) => {
      updateEditorGroups((current) => ({
        ...current,
        groups: {
          ...current.groups,
          [current.activeGroupId]: reorderEditorGroupTabs(
            current.groups[current.activeGroupId],
            { fromPath, toPath, position },
          ),
        },
      }));
    },
    [updateEditorGroups],
  );

  const updateEditorViewState = useCallback(
    (path: string, viewState: WorkspaceSessionViewState) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath || !isSessionPathInWorkspace(rootPath, path)) {
        return;
      }

      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      const groupId = editorGroupsRef.current.activeGroupId;
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
    },
    [editorSessionOwnerKeyForRoot],
  );

  const updateEditorGroupViewState = useCallback(
    (
      groupId: EditorGroupId,
      path: string,
      viewState: WorkspaceSessionViewState,
    ) => {
      const rootPath = currentWorkspaceRootRef.current;
      if (!rootPath || !isSessionPathInWorkspace(rootPath, path)) {
        return;
      }
      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
    },
    [editorSessionOwnerKeyForRoot],
  );

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
        const state = await smartModeGateway.setMode(
          workspaceIdentityDescriptor?.canonicalRoot ?? requestedRoot,
          mode,
        );
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
      workspaceIdentityDescriptor,
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
        if (
          phpFrameworkRuntimeContext.supports("containerBindingsFromSource") &&
          phpFrameworkBindingEditorChangeRequiresInvalidation(
            activeDocument.path,
            activeDocument.content,
            content,
            activePhpFrameworkProviders,
            (path) => isPhpFrameworkBindingDependencyPathRef.current(path),
          )
        ) {
          invalidatePhpFrameworkBindingCacheRef.current();
        }
        resetPhpFrameworkMorphMapModelTypeCacheRef.current();
        updateLocalPhpDiagnostics(
          activeDocument.path,
          localPhpDiagnosticsFromSource(content, []),
        );
      }
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
      reportChangedDocuments([activeDocument.path]);
    },
    [
      activeDocument,
      activePhpFrameworkProviders,
      pinDocument,
      reportChangedDocuments,
      updateLocalPhpDiagnostics,
    ],
  );

  const openMarkdownPreview = useCallback(async (): Promise<void> => {
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
        ...visibleEditorPaths(
          openPathsRef.current,
          previewPathRef.current,
        ),
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
        [current.activeGroupId]: openEditorGroupPath(
          current.groups[current.activeGroupId],
          {
            nextActivePath: path,
            nextOpenPaths,
            nextPreviewPath: null,
          },
        ),
      },
    }));

    try {
      const html = await markdownPreviewRenderer(source.content);

      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        )
      ) {
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
      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        )
      ) {
        return;
      }

      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "Markdown Preview",
        error,
      );
    }
  }, [markdownPreviewRenderer, reportErrorForActiveWorkspaceRoot]);

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
            if (
              !workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )
            ) {
              return;
            }

            const current = markdownPreviewTabsRef.current[preview.path];

            if (!current || current.sourcePath !== preview.sourcePath) {
              return;
            }

            if (!openPathsRef.current.includes(preview.path)) {
              return;
            }

            if (
              documentsRef.current[preview.sourcePath]?.content !== content
            ) {
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
            if (
              !workspaceRootKeysEqual(
                currentWorkspaceRootRef.current,
                requestedRoot,
              )
            ) {
              return;
            }

            reportErrorForActiveWorkspaceRoot(
              requestedRoot,
              "Markdown Preview",
              error,
            );
          });
      }, 300);
      timeoutIds.push(timeoutId);
    });

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [
    documents,
    markdownPreviewRenderer,
    openMarkdownPreviews,
    reportErrorForActiveWorkspaceRoot,
    workspaceRoot,
  ]);

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
    notifyJavaScriptTypeScriptWatchedFilesChanged,
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

  const navigationSurfaceIdentity = useMemo(
    () => ({}),
    [activeGroupId, activePath, editorSessionOwnerKey],
  );
  const captureNavigationCommandScope = useCallback(
    (): EditorSurfaceCommandInvocationScope =>
      options.editorSurfaceCommandRunner?.captureScope?.() ?? {
        documentPath: activeDocumentRef.current?.path ?? null,
        modelIdentity: null,
        ownerKey: currentEditorSessionOwnerKeyRef.current,
        surfaceIdentity: navigationSurfaceIdentity,
      },
    [navigationSurfaceIdentity, options.editorSurfaceCommandRunner],
  );
  const isNavigationCommandScopeCurrent = useCallback(
    (scope: EditorSurfaceCommandInvocationScope): boolean => {
      if (scope.ownerKey !== currentEditorSessionOwnerKeyRef.current) {
        return false;
      }

      if (scope.documentPath !== (activeDocumentRef.current?.path ?? null)) {
        return false;
      }

      if (!scope.modelIdentity) {
        return scope.surfaceIdentity === navigationSurfaceIdentity;
      }

      return options.editorSurfaceCommandRunner?.isScopeCurrent?.(scope) === true;
    },
    [navigationSurfaceIdentity, options.editorSurfaceCommandRunner],
  );
  const commandContext = useMemo(
    () => {
      return {
        hasWorkspace: Boolean(workspaceRoot),
        hasActiveDocument: Boolean(activeDocument),
        activeDocumentDirty: Boolean(
          activeDocument && !activeDocument.readOnly && isDirty(activeDocument),
        ),
        editorSurfaceScope: captureNavigationCommandScope(),
      };
    },
    [
      activeDocument,
      captureNavigationCommandScope,
      workspaceRoot,
    ],
  );
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;

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

  const debugSession = useDebugSession({
    gateway: options.debugGateway ?? defaultDebugGateway,
    isWorkspaceTrusted: () => workspaceTrustedRef.current,
    workspaceRoot,
  });

  const debugSessionState = debugSession.snapshot.state;
  const debugStoppedFilePath =
    debugSessionState.kind === "stopped"
      ? debugSessionState.topFrame?.filePath ?? null
      : null;
  const debugStoppedLineNumber =
    debugSessionState.kind === "stopped" && debugSessionState.topFrame
      ? debugSessionState.topFrame.lineNumber
      : null;
  const debugStoppedLocation = useMemo(() => {
    if (debugStoppedFilePath === null || debugStoppedLineNumber === null) {
      return null;
    }

    return {
      filePath: debugStoppedFilePath,
      lineNumber: debugStoppedLineNumber,
    };
  }, [debugStoppedFilePath, debugStoppedLineNumber]);

  const openDebugPanel = useCallback(() => {
    setBottomPanelView("debug");
    setBottomPanelVisible(true);
  }, []);

  const openDebugLocation = useCallback(
    (filePath: string, lineNumber: number) =>
      openNavigationTarget(filePath, { column: 1, lineNumber }, filePath),
    [openNavigationTarget],
  );

  const toggleDebugBreakpointAtCursor = useCallback(() => {
    const document = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;

    if (!document || document.readOnly || !lineNumber) {
      return;
    }

    return debugSession.toggleBreakpoint(document.path, lineNumber);
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    debugSession.toggleBreakpoint,
  ]);

  const startOrContinueDebug = useCallback(async () => {
    const state = debugSession.snapshot.state;

    if (state.kind === "stopped") {
      await debugSession.stepDebug("continue");
      return;
    }

    if (state.kind === "starting" || state.kind === "running") {
      return;
    }

    const requestedRoot = currentWorkspaceRootRef.current;
    const document = activeDocumentRef.current;

    if (!requestedRoot || !document) {
      return;
    }

    if (isActiveDocumentJsTest) {
      const runner = await detectJsTestRunner(
        requestedRoot,
        readTestFileIfExists,
      );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (activeDocumentRef.current?.path !== document.path) {
        return;
      }

      if (!runner) {
        setMessage(
          "Debug: no vitest or jest setup detected in this workspace.",
        );
        return;
      }

      openDebugPanel();
      await debugSession.startDebug({
        kind: "js-test-file",
        runner,
        filePath: document.path,
      });
      return;
    }

    if (isActiveDocumentPhpTest) {
      openDebugPanel();
      await debugSession.startDebug({
        kind: "php-test-file",
        filePath: document.path,
      });
      return;
    }

    if (isDebuggablePhpScriptPath(document.path)) {
      openDebugPanel();
      await debugSession.startDebug({
        kind: "php-script",
        scriptPath: document.path,
      });
      return;
    }

    if (!isDebuggableNodeScriptPath(document.path)) {
      return;
    }

    openDebugPanel();
    await debugSession.startDebug({
      kind: "node-script",
      scriptPath: document.path,
    });
  }, [
    activeDocumentRef,
    currentWorkspaceRootRef,
    debugSession.snapshot,
    debugSession.startDebug,
    debugSession.stepDebug,
    isActiveDocumentPhpTest,
    isActiveDocumentJsTest,
    openDebugPanel,
    readTestFileIfExists,
    setMessage,
  ]);

  const startPhpListenDebug = useCallback(async () => {
    openDebugPanel();
    await debugSession.startDebug({ kind: "php-listen" });
  }, [debugSession.startDebug, openDebugPanel]);

  const restoredDebugBreakpointRootsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    const storage = options.debugBreakpointStorage ?? window.localStorage;
    const rootKey = normalizedWorkspaceRootKey(workspaceRoot);

    if (!restoredDebugBreakpointRootsRef.current.has(rootKey)) {
      restoredDebugBreakpointRootsRef.current.add(rootKey);
      const persisted = loadPersistedBreakpoints(storage, workspaceRoot);

      if (persisted.length > 0) {
        void debugSession.restoreBreakpoints(persisted);
      }

      return;
    }

    savePersistedBreakpoints(storage, workspaceRoot, debugSession.breakpoints);
  }, [
    debugSession.breakpoints,
    debugSession.restoreBreakpoints,
    options.debugBreakpointStorage,
    workspaceRoot,
  ]);

  const revealEntry = useCallback(
    (entry: FileEntry) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (
        !requestedRoot ||
        contextMenuRelativePath(requestedRoot, entry.path) === null
      ) {
        return;
      }

      if (!isTauri()) {
        return;
      }

      void invoke("reveal_item_in_dir", {
        path: entry.path,
        rootPath: requestedRoot,
      }).catch((error) =>
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Reveal", error),
      );
    },
    [reportErrorForActiveWorkspaceRoot],
  );

  const openEntryInTerminal = useCallback(
    (entry: FileEntry) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return;
      }

      const directory = terminalDirectoryForEntry(requestedRoot, entry);

      if (!directory) {
        return;
      }

      runInActiveTerminal(`cd -- ${quoteShellArgument(directory)}`);
    },
    [runInActiveTerminal],
  );

  const openArtisanRoutesPanel = useCallback(() => {
    setBottomPanelView("routes" as BottomPanelView);
    setBottomPanelVisible(true);
  }, []);

  const openPhpTestResultsPanel = useCallback(() => {
    setBottomPanelView("testResults" as BottomPanelView);
    setBottomPanelVisible(true);
    setPhpTestRunRequestVersion((current) => current + 1);
  }, []);

  const openJsTestResultsPanel = useCallback(() => {
    setBottomPanelView("testResults" as BottomPanelView);
    setBottomPanelVisible(true);
    setJsTestRunRequestVersion((current) => current + 1);
  }, []);

  const openJsTestCase = useCallback(
    (testCase: TestCase) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return Promise.resolve(false);
      }

      const target = testCaseNavigationTarget(requestedRoot, testCase);

      if (!target) {
        return Promise.resolve(false);
      }

      return openNavigationTarget(
        target.path,
        target.position,
        testCase.name ?? target.path,
      );
    },
    [openNavigationTarget],
  );

  const openPhpTestCase = useCallback(
    (testCase: PhpTestCase) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return Promise.resolve(false);
      }

      const target = phpTestCaseNavigationTarget(requestedRoot, testCase);

      if (!target) {
        return Promise.resolve(false);
      }

      return openNavigationTarget(
        target.path,
        target.position,
        testCase.name ?? target.path,
      );
    },
    [openNavigationTarget],
  );

  const openArtisanController = useCallback(
    (action: ArtisanControllerAction) =>
      navigateToArtisanController(
        {
          activePath: activeDocumentRef.current?.path ?? "",
          currentRootPath: () => currentWorkspaceRootRef.current,
          openNavigationTarget,
          projectSymbolSearch,
          rootPath: workspaceRoot,
          setMessage,
        },
        action,
      ),
    [openNavigationTarget, projectSymbolSearch, workspaceRoot],
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

  const revealCommitInFileHistory = useCallback(
    async (path: string, sha: string) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot || activeDocumentRef.current?.path !== path || !sha) {
        return;
      }

      showBottomPanelView("history");
      await openFileHistory(sha);

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        activeDocumentRef.current?.path !== path
      ) {
        return;
      }
    },
    [openFileHistory, showBottomPanelView],
  );

  const revertSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-revert-selected-git-commit"));
  }, []);

  const cherryPickSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-cherry-pick-selected-git-commit"));
  }, []);

  const rewordSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-reword-selected-git-commit"));
  }, []);

  const canRewordSelectedGitCommit = useCallback(() => {
    const detail = { enabled: false };
    window.dispatchEvent(
      new CustomEvent("mockor-query-reword-selected-git-commit", { detail }),
    );
    return detail.enabled;
  }, []);

  useEffect(() => {
    const refreshAfterRevert = async (event: Event) => {
      const detail = (
        event as CustomEvent<{ rootPath?: unknown; subject?: unknown }>
      ).detail;

      if (
        typeof detail?.rootPath !== "string" ||
        typeof detail.subject !== "string" ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, detail.rootPath)
      ) {
        return;
      }

      const requestedRoot = detail.rootPath;
      await refreshGitStatus();

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Reverted commit: ${detail.subject}`);
    };
    const listener = (event: Event) => {
      void refreshAfterRevert(event);
    };

    window.addEventListener("mockor-git-commit-reverted", listener);

    return () => {
      window.removeEventListener("mockor-git-commit-reverted", listener);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const refreshAfterCherryPick = async (event: Event) => {
      const detail = (
        event as CustomEvent<{ rootPath?: unknown; subject?: unknown }>
      ).detail;

      if (
        typeof detail?.rootPath !== "string" ||
        typeof detail.subject !== "string" ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, detail.rootPath)
      ) {
        return;
      }

      const requestedRoot = detail.rootPath;
      await refreshGitStatus();

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Cherry-picked commit: ${detail.subject}`);
    };
    const listener = (event: Event) => {
      void refreshAfterCherryPick(event);
    };

    window.addEventListener("mockor-git-commit-cherry-picked", listener);

    return () => {
      window.removeEventListener("mockor-git-commit-cherry-picked", listener);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const refreshAfterReword = async (event: Event) => {
      const detail = (
        event as CustomEvent<{ rootPath?: unknown; subject?: unknown }>
      ).detail;

      if (
        typeof detail?.rootPath !== "string" ||
        typeof detail.subject !== "string" ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, detail.rootPath)
      ) {
        return;
      }

      const requestedRoot = detail.rootPath;
      await refreshGitStatus();

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Reworded commit: ${detail.subject}`);
    };
    const listener = (event: Event) => {
      void refreshAfterReword(event);
    };

    window.addEventListener("mockor-git-commit-reworded", listener);

    return () => {
      window.removeEventListener("mockor-git-commit-reworded", listener);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: unknown; sha?: unknown }>).detail;

      if (typeof detail?.path !== "string" || typeof detail.sha !== "string") {
        return;
      }

      void revealCommitInFileHistory(detail.path, detail.sha);
    };

    window.addEventListener("mockor-reveal-git-blame-commit", reveal);

    return () => {
      window.removeEventListener("mockor-reveal-git-blame-commit", reveal);
    };
  }, [revealCommitInFileHistory]);

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
    syncSavedJavaScriptTypeScriptDocument: async (
      owner,
      rootPath,
      document,
      shouldEmit,
    ) => {
      if (resolveWorkspaceRuntimeOwner(rootPath)?.ownerKey !== owner.ownerKey) {
        return;
      }
      await syncSavedJavaScriptTypeScriptDocumentForRoot(
        rootPath,
        document,
        shouldEmit,
      );
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
    currentPhpFrameworkBindingCacheGeneration,
    invalidatePhpFrameworkBindingCache,
    isPhpFrameworkBindingSearchCandidatePath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
  } = usePhpSemanticResolver({
    activePhpFrameworkProviders,
    currentPhpFrameworkSourceContext,
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
  invalidatePhpFrameworkBindingCacheRef.current =
    invalidatePhpFrameworkBindingCache;
  isPhpFrameworkBindingDependencyPathRef.current =
    isPhpFrameworkBindingSearchCandidatePath;

  const invalidatePhpFrameworkBindingsForFileChange = useMemo(
    () =>
      createPhpFrameworkBindingFileChangeInvalidator({
        frameworkRuntime: phpFrameworkRuntimeContext,
        frameworkProviders: activePhpFrameworkProviders,
        currentRootPath: () => currentWorkspaceRootRef.current,
        currentBindingCacheGeneration:
          currentPhpFrameworkBindingCacheGeneration,
        invalidateBindingCache: () =>
          invalidatePhpFrameworkBindingCacheRef.current(),
        isBindingSearchCandidatePath: isPhpFrameworkBindingSearchCandidatePath,
        readTextFile: (path) => workspaceFiles.readTextFile(path),
      }),
    [
      activePhpFrameworkProviders,
      currentPhpFrameworkBindingCacheGeneration,
      currentWorkspaceRootRef,
      isPhpFrameworkBindingSearchCandidatePath,
      phpFrameworkRuntimeContext,
      workspaceFiles,
    ],
  );

  const {
    resetPhpFrameworkMorphMapModelTypeCache,
    resolvePhpFrameworkProjectMorphMapModelType,
  } = usePhpFrameworkMorphMapResolver({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readNavigationFileContent,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });
  resetPhpFrameworkMorphMapModelTypeCacheRef.current =
    resetPhpFrameworkMorphMapModelTypeCache;

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
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpFrameworkRelationCompletionsForClass,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resetPhpClassMemberCache,
  } = usePhpClassMemberCollectors({
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
    findEnvironmentTarget,
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
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpMethodsForClass,
    frameworkRuntime: phpFrameworkRuntimeContext,
  });

  const {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpFrameworkRelationPathOwnerType,
    resolvePhpExpressionType,
  } = usePhpFrameworkModelSemantics({
    collectPhpMethodsForClass,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpClassHasDynamicBuilderFinder: phpClassHasLaravelDynamicWhere,
    phpClassHasNamedBuilderScope: phpClassHasLaravelLocalScope,
    readNavigationFileContent,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkProjectMorphMapModelType,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    invalidatePhpTraitHostClassNames,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    resolvePhpTraitHostClassNames,
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
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
  });

  const {
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
  } = usePhpMethodCompletionResolvers({
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpMethodsForClass,
    currentPhpFrameworkSourceContext,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpNormalizedReceiverExpressionIsThis,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
  });

  const { providePhpMethodCompletions } = usePhpMethodCompletionProvider({
    activeDocument,
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
    collectPhpFrameworkRelationCompletionsForClass,
    collectPhpMethodsForClass,
    collectQueueConnectionTargets,
    collectRedisConnectionTargets,
    collectStorageDiskTargets,
    collectTranslationTargets,
    collectViewTargets,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime: phpFrameworkRuntimeContext,
    joinWorkspacePath,
    projectSymbolSearch,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpFrameworkRelationPathOwnerType,
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    resolvePhpTraitHostClassNames,
    workspaceRoot,
  });

  const { providePhpMethodSignature, providePhpParameterInlayHints } =
    usePhpSignatureHelpProvider({
      currentWorkspaceRootRef,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
      workspaceRoot,
    });

  const readOpenDocumentContent = useCallback(
    (path: string): string | null =>
      documentsRef.current[path]?.content ?? null,
    [],
  );
  const { createMissingBladeViewCodeAction, providePhpCodeActions } =
    usePhpCodeActionProvider({
      activeDocumentPath: activeDocument?.path ?? null,
      collectViewTargets,
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      getPhpDocumentSyncVersion,
      intelligenceMode,
      projectSymbolSearch,
      readNavigationFileContent,
      readOpenDocumentContent,
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

  const phpFrameworkLiteralNavigationDependencies =
    usePhpFrameworkLiteralNavigationDependencies({
      collectNamedRouteTargets,
      currentWorkspaceRootRef,
      findAuthGuardTarget,
      findBroadcastConnectionTarget,
      findCacheStoreTarget,
      findConfigTarget,
      findDatabaseConnectionTarget,
      findEnvTarget: findEnvironmentTarget,
      findLogChannelTarget,
      findMailMailerTarget,
      findPasswordBrokerTarget,
      findQueueConnectionTarget,
      findRedisConnectionTarget,
      findStorageDiskTarget,
      findTranslationTarget,
      findViewTarget,
      joinWorkspacePath,
      providers: activePhpFrameworkProviders,
      readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      workspaceRoot,
    });

  const { providePhpFrameworkDefinition } = usePhpFrameworkDefinitionNavigation({
    activeDocument,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    frameworkLiteralNavigationDependencies:
      phpFrameworkLiteralNavigationDependencies,
    openNavigationTarget,
    openPhpClassTarget,
    readNavigationFileContent,
    resolvePhpExpressionType,
    resolvePhpClassSourcePaths,
    textSearch,
    workspaceDescriptor,
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

  const { findValidationRuleModelTargets } =
    usePhpFrameworkModelNavigationTargets({
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      projectSymbolSearch,
      providers: activePhpFrameworkProviders,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
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
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpFrameworkRelationPathOwnerType,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  });

  const workbenchFrameworkIntelligenceDependencies =
    useWorkbenchFrameworkIntelligenceDependencies({
      activeDocument,
      activeDocumentRef,
      activePhpFrameworkProviders,
      collectConfigTargets,
      collectNamedRouteTargets,
      collectTranslationTargets,
      collectViewTargets,
      createMissingBladeViewCodeAction,
      currentWorkspaceRootRef,
      ensurePhpFrameworkSourceCollectionsLoaded,
      findConfigTarget,
      findTranslationTarget,
      findViewTarget,
      intelligenceMode,
      joinWorkspacePath,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
      phpFrameworkIntelligence,
      phpFrameworkRuntimeContext,
      projectSymbolSearch,
      readNavigationFileContent,
      relativeWorkspacePath,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      resolvePhpReceiverMethodCompletions,
      setImplementationChooser,
      synthesizePhpTypedReceiverSource,
      textSearch,
      workspaceFiles,
      workspaceRoot,
    });

  const workbenchFrameworkIntelligence = useWorkbenchFrameworkIntelligence(
    workbenchFrameworkIntelligenceDependencies,
  );
  const {
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    invalidateLatteExpressionDataForPath,
    invalidateNeonConfigForPath,
    providePhpNetteInjectionDefinition,
    resetBladeIntelligenceCaches,
    collectCompleteLatteTemplateRelativePaths,
    provideLattePresenterLinkDiagnostics,
    provideLatteDefinitionOutcome,
    provideNeonDefinition,
  } = workbenchFrameworkIntelligence;

  usePhpFrameworkActiveDocumentDiagnostics({
    activeDocument,
    activeDocumentRef,
    collectCompleteLatteTemplateRelativePaths,
    collectViewTargets,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    provideLattePresenterLinkDiagnostics,
    setFrameworkDiagnosticsByPath,
    workspaceRoot,
  });

  const invalidateFrameworkCachesForPath = useMemo(
    () =>
      createPhpFrameworkFileChangeInvalidator({
        frameworkRuntime: phpFrameworkRuntimeContext,
        invalidateBladeComponentNamesForPath,
        invalidateBladeViewDataEntriesForPath,
        invalidateLatteExpressionDataForPath,
        invalidateNeonConfigForPath,
      }),
    [
      invalidateBladeComponentNamesForPath,
      invalidateBladeViewDataEntriesForPath,
      invalidateLatteExpressionDataForPath,
      invalidateNeonConfigForPath,
      phpFrameworkRuntimeContext,
    ],
  );
  resetPhpFrameworkCachesRef.current = () => {
    phpClassSourcePathCacheRef.current = {};
    invalidatePhpTraitHostClassNames();
    resetPhpClassMemberCacheRef.current();
    invalidatePhpFrameworkBindingCache();
    resetPhpFrameworkMorphMapModelTypeCache();
    invalidateFrameworkTargetCache();
    resetPhpFrameworkSourceRegistries();
    resetBladeIntelligenceCaches();
  };
  const frameworkIntelligenceProviders = useWorkbenchFrameworkProviderAdapter(
    workbenchFrameworkIntelligence,
  );

  const {
    goToPhpFrameworkAuthorizationAbilityDefinition,
    goToPhpFrameworkMiddlewareAliasDefinition,
  } = usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation({
    activeDocument,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openNavigationTarget,
    setMessage,
    workspaceRoot,
  });

  const { goToPhpFrameworkLiteralDefinition } =
    usePhpContextualFrameworkLiteralDefinitionNavigation({
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies: {
        ...phpFrameworkLiteralNavigationDependencies,
        findValidationRuleModelTargets,
      },
      openNavigationTarget,
      providers: activePhpFrameworkProviders,
      setMessage,
      supportsStringLiterals:
        phpFrameworkRuntimeContext.supports("stringLiterals"),
      workspaceRoot,
    });

  const goToPhpClassIdentifierDefinition = useCallback(
    async (
      name: string,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const className = resolvePhpClassName(activeDocument.content, name);

      if (!className) {
        return false;
      }

      return request
        ? openPhpClassTarget(className, name, request)
        : openPhpClassTarget(className, name);
    },
    [activeDocument, openPhpClassTarget],
  );

  const {
    adapters: phpFrameworkIdentifierDefinitionAdapters,
    contextualAdapters: contextualPhpFrameworkIdentifierDefinitionAdapters,
  } = useMemo(
    () =>
      createPhpFrameworkIdentifierNavigationAdapters({
        activationAdapters:
          createDefaultPhpFrameworkIdentifierNavigationActivationAdapters({
            laravel: {
              activeDocument,
              goToPhpFrameworkLiteralDefinition,
              goToPhpFrameworkAuthorizationAbilityDefinition,
              goToPhpFrameworkMiddlewareAliasDefinition,
              goToPhpLaravelRelationStringDefinition,
              openDirectPhpMethodTarget,
              openPhpClassTarget,
            },
            nette: {
              activeDocument,
              activeEditorPositionRef,
              providePhpNetteInjectionDefinition,
            },
          }),
        frameworkRuntime: phpFrameworkRuntimeContext,
      }),
    [
      activeDocument,
      goToPhpFrameworkLiteralDefinition,
      goToPhpFrameworkAuthorizationAbilityDefinition,
      goToPhpFrameworkMiddlewareAliasDefinition,
      goToPhpLaravelRelationStringDefinition,
      providePhpNetteInjectionDefinition,
      openDirectPhpMethodTarget,
      openPhpClassTarget,
      phpFrameworkRuntimeContext,
    ],
  );

  const {
    goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
  } = usePhpFrameworkIdentifierDefinitionNavigation({
    adapters: phpFrameworkIdentifierDefinitionAdapters,
    contextualAdapters: contextualPhpFrameworkIdentifierDefinitionAdapters,
  });

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
    providers: activePhpFrameworkProviders,
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
    providers: activePhpFrameworkProviders,
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

  const { navigateBackward, navigateForwardInHistory, openRecentLocation } =
    useNavigationHistory({
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
      const requestedRootGeneration = requestedRoot
        ? workspaceCloseGenerationByRootRef.current[
            normalizedWorkspaceRootKey(requestedRoot)
          ] ?? 0
        : null;
      const requestIsCurrent = () => {
        if (!requestedRoot) {
          return false;
        }

        const currentRootGeneration =
          workspaceCloseGenerationByRootRef.current[
            normalizedWorkspaceRootKey(requestedRoot)
          ] ?? 0;
        return (
          currentRootGeneration === requestedRootGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        );
      };

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

        if (!requestIsCurrent()) {
          return;
        }

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundProjectRuntimes(
            nextAppSettings.runtimePolicy,
            requestedRoot,
            null,
          );

        if (!requestIsCurrent()) {
          return;
        }
        }

        const previousMode = intelligenceModeRef.current;
        let nextMode = nextWorkspaceSettings.intelligenceMode;

        if (nextWorkspaceSettings.intelligenceMode !== previousMode) {
          const smartMode = await smartModeGateway.setMode(
            workspaceIdentityDescriptor?.canonicalRoot ?? requestedRoot,
            nextWorkspaceSettings.intelligenceMode,
          );

          if (!requestIsCurrent()) {
            return;
          }

          nextMode = smartMode.mode;
        }

        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: nextMode,
        };
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

          if (!requestIsCurrent()) {
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
        if (!requestIsCurrent()) {
          return;
        }

        setIntelligenceMode(nextMode);

        await applyJavaScriptTypeScriptSettingsChange({
          previousSettings: previousWorkspaceSettings,
          nextSettings: resolvedWorkspaceSettings,
          rootPath: requestedRoot,
          requestIsCurrent,
        });

        if (!requestIsCurrent()) {
          return;
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

          if (!requestIsCurrent()) {
            return;
          }
        }

        if (nextTrusted !== null && nextTrusted !== workspaceTrust?.trusted) {
          const trust = await workspaceTrustGateway.setTrust(
            requestedRoot,
            nextTrusted,
          );
          if (!requestIsCurrent()) {
            return;
          }

          setWorkspaceTrust(trust);

          if (!trust.trusted) {
            await stopLanguageServerRuntime(requestedRoot);

            if (!requestIsCurrent()) {
              return;
            }
          }

          if (workspaceDescriptor?.php) {
            await refreshLanguageServerPlan(requestedRoot);
            refreshedPhpLanguageServerPlan = true;

            if (!requestIsCurrent()) {
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

          if (!requestIsCurrent()) {
            return;
          }
        }

        if (!shouldIndexWorkspace(previousMode) && shouldIndexWorkspace(nextMode)) {
          await startInitialIndexScan(requestedRoot);

          if (!requestIsCurrent()) {
            return;
          }
        }

        if (shouldIndexWorkspace(previousMode) && !shouldIndexWorkspace(nextMode)) {
          await clearWorkspaceIndex(requestedRoot);

          if (!requestIsCurrent()) {
            return;
          }
        }

        if (shouldRediscoverGitRepositories) {
          await runGitRepositoryDiscovery(requestedRoot, resolvedWorkspaceSettings);

          if (!requestIsCurrent()) {
            return;
          }
        }

        if (!requestIsCurrent()) {
          return;
        }

        setMessage("Settings saved.");
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
      }
    },
    [
      applyJavaScriptTypeScriptSettingsChange,
      clearWorkspaceIndex,
      persistAppSettings,
      persistWorkspaceSettings,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      runGitRepositoryDiscovery,
      runPhpWorkspaceProbe,
      smartModeGateway,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      stopLanguageServerRuntime,
      workspaceDescriptor,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceTrust,
      workspaceTrustGateway,
    ],
  );

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

  const installManagedTypeScriptLanguageServer = useCallback(async () => {
    if (!workspaceRoot || !phpToolGateway.installManagedTypeScriptLanguageServer) return;
    if (
      installingManagedTypeScriptLanguageServer &&
      workspaceRootKeysEqual(
        installingManagedTypeScriptLanguageServerRootRef.current,
        workspaceRoot,
      )
    ) {
      return;
    }

    const targetWorkspaceRoot = workspaceRoot;
    installingManagedTypeScriptLanguageServerRootRef.current = targetWorkspaceRoot;
    setInstallingManagedTypeScriptLanguageServer(true);
    try {
      await phpToolGateway.installManagedTypeScriptLanguageServer(targetWorkspaceRoot);
    } catch (error) {
      if (
        workspaceRootKeysEqual(
          installingManagedTypeScriptLanguageServerRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        installingManagedTypeScriptLanguageServerRootRef.current = null;
        setInstallingManagedTypeScriptLanguageServer(false);

        if (
          workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            targetWorkspaceRoot,
          )
        ) {
          reportJavaScriptTypeScriptLanguageServerError(error);
        }
      }
    }
  }, [
    installingManagedTypeScriptLanguageServer,
    phpToolGateway,
    reportJavaScriptTypeScriptLanguageServerError,
    workspaceRoot,
  ]);

  const handleManagedTypeScriptInstallCompletion = useCallback(async (event: ManagedTypeScriptInstallCompletionEvent) => {
    if (!workspaceRootKeysEqual(installingManagedTypeScriptLanguageServerRootRef.current, event.root)) return;
    installingManagedTypeScriptLanguageServerRootRef.current = null;
    setInstallingManagedTypeScriptLanguageServer(false);
    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) return;
    if (event.error) { reportJavaScriptTypeScriptLanguageServerError(event.error); return; }
    try {
      await refreshJavaScriptTypeScriptLanguageServerPlan(event.root);
    } catch (error) {
      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) {
        reportJavaScriptTypeScriptLanguageServerError(error);
      }
      return;
    }
    if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.root)) {
      setMessage("Installed managed TypeScript IDE engine.");
    }
  }, [refreshJavaScriptTypeScriptLanguageServerPlan, reportJavaScriptTypeScriptLanguageServerError]);

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

  const commandRegistry = useWorkbenchCommandRegistry({
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
    closeActiveEditorGroup: runCloseActiveEditorGroup,
    closeActiveEditorGroupSurface: runCloseActiveEditorGroupSurface,
    closeDocument: runCloseDocument,
    commitGitChanges,
    createDirectory,
    createFile,
    createGitBranch,
    debugSnapshot: debugSession.snapshot,
    deleteActiveDocument,
    disableEslintRuleAtCursor,
    openDebugPanel,
    pauseDebug: debugSession.pauseDebug,
    startOrContinueDebug,
    startPhpListenDebug,
    stepDebug: debugSession.stepDebug,
    stopDebug: debugSession.stopDebug,
    toggleDebugBreakpointAtCursor,
    editorGroups,
    editorSurfaceCommandRunner: options.editorSurfaceCommandRunner,
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
  });

  const runCommand = useCallback<CommandExecutionRunner>(
    (commandId, context = commandContext) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      return executeCommandAndReport(
        commandRegistry,
        commandId,
        context,
        (error) =>
          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "Command",
            error,
          ),
      );
    },
    [
      commandContext,
      commandRegistry,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  useWorkbenchNativeMenuCommands({
    commandContext,
    reportError,
    runCommand,
  });

  const searchEverywhereModel = searchEverywhereModelFor(
    commandRegistry.list(),
    commandContext,
  );

  useEffect(() => {
    if (workspaceSettings.javaScriptTypeScriptValidation) {
      return;
    }

    resetJavaScriptTypeScriptDiagnosticsForRoot(
      workspaceRoot,
      workspaceRuntimeOwner ?? undefined,
    );
  }, [
    resetJavaScriptTypeScriptDiagnosticsForRoot,
    workspaceSettings.javaScriptTypeScriptValidation,
    workspaceRuntimeOwner,
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
    openSearchEverywhere,
  }), [
    closeFloatingSurface,
    openSearchEverywhere,
  ]);

  useWorkbenchKeyboardShortcuts({
    actions: keyboardShortcutActions,
    appSettingsRef,
    bareKeyShortcutsRef,
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
    runCommand,
  });

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!workspaceSessionRestoredRef.current) {
      return;
    }

    const session = currentWorkspaceSessionForEditorGroups(
      workspaceRoot,
      editorGroups,
      sidebarView,
      bottomPanelView,
      workspaceEditorViewStatesRef.current[
        editorSessionOwnerKeyForRoot(workspaceRoot)
      ] ?? {},
      new Set(Object.keys(documents)),
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
    bottomPanelView,
    editorSessionOwnerKeyForRoot,
    documents,
    editorGroups,
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
  }, [
    applyAppSettings,
    openWorkspacePath,
    reportError,
    settingsGateway,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: WorkspaceFileChangeUnsubscribeFn | null = null;
    const subscriptionRoot = workspaceRoot;
    const generation =
      workspaceFileChangeSubscriptionGenerationRef.current + 1;
    workspaceFileChangeSubscriptionGenerationRef.current = generation;
    const isCurrentSubscription = () =>
      active &&
      workspaceFileChangeSubscriptionGenerationRef.current === generation &&
      workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        subscriptionRoot,
      );

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
        if (!isCurrentSubscription()) {
          return;
        }

        void externalFileConflicts.handleFileChange(event).then((consumed) => {
          if (!isCurrentSubscription()) {
            return;
          }
          if (
            consumed &&
            (event.kind === "deleted" || event.kind === "renamed")
          ) {
            const removedPath =
              event.kind === "renamed" ? event.previousPath : event.path;
            if (removedPath) {
              markExternallyRemovedDocumentPath(event.rootPath, removedPath);
            }
          }
          if (!consumed) {
            handleWorkspaceFileChange(event);
          }
        });
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
      workspaceFileChangeSubscriptionGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [
    handleWorkspaceFileChange,
    externalFileConflicts.handleFileChange,
    markExternallyRemovedDocumentPath,
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
    if (!phpToolGateway.subscribeManagedTypeScriptLanguageServerInstall) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void phpToolGateway.subscribeManagedTypeScriptLanguageServerInstall((event) => {
      if (active) {
        void handleManagedTypeScriptInstallCompletion(event);
      }
    }).then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      unsubscribe = dispose;
    }).catch((error) => {
      if (active) reportError("JavaScript/TypeScript", error);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [handleManagedTypeScriptInstallCompletion, phpToolGateway, reportError]);

  useLanguageServerDiagnosticsSubscriptions({
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
      .map((path) => documentsRef.current[path])
      .filter((document): document is EditorDocument => Boolean(document));

    if (
      activePath &&
      documentsRef.current[activePath] &&
      !documentsToSync.some((document) => document.path === activePath)
    ) {
      documentsToSync.push(documentsRef.current[activePath]);
    }

    documentsToSync.forEach((document) => {
      void syncOpenDocument(document);
    });
  }, [
    activePath,
    documentsRef,
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
      .map((path) => documentsRef.current[path])
      .filter(
        (document): document is EditorDocument =>
          Boolean(document) &&
          isJavaScriptTypeScriptDocumentSyncableForRoot(
            workspaceRoot,
            document,
          ),
      );

    if (
      activePath &&
      documentsRef.current[activePath] &&
      isJavaScriptTypeScriptDocumentSyncableForRoot(
        workspaceRoot,
        documentsRef.current[activePath],
      ) &&
      !documentsToSync.some((document) => document.path === activePath)
    ) {
      documentsToSync.push(documentsRef.current[activePath]);
    }

    documentsToSync.forEach((document) => {
      void syncOpenJavaScriptTypeScriptDocument(document);
    });
  }, [
    activePath,
    documentsRef,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openDocumentPaths,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    syncOpenJavaScriptTypeScriptDocument,
    workspaceRoot,
  ]);

  useChangedDocumentSyncScheduling({
    documentsRef,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    subscribeChangedDocuments,
  });

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
  const activeDotenvDiagnosticsByPath = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "dotenv") {
      return {};
    }

    if (isExternallyRemovedDocumentPath(activeDocument.path)) {
      return {};
    }

    const diagnostics = dotenvDiagnosticsFromSource(activeDocument.content);

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
  const mergedLanguageServerDiagnosticsByPath = useMemo(
    () =>
      mergeDiagnosticsByPath(
        languageServerDiagnosticsByPath,
        javaScriptTypeScriptDiagnosticsByPath,
        frameworkDiagnosticsByPath,
        activeDotenvDiagnosticsByPath,
      ),
    [
      activeDotenvDiagnosticsByPath,
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
      frameworkDiagnosticsByPath,
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
    return buildActivePhpLocalDiagnosticNotices(
      activeDocument,
      activePhpLocalDiagnosticsByPath,
    );
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activePhpLocalDiagnosticsByPath,
  ]);
  const activeDotenvDiagnosticNotices = useMemo(() => {
    return buildActiveDotenvLocalDiagnosticNotices(
      activeDocument,
      activeDotenvDiagnosticsByPath,
    );
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activeDotenvDiagnosticsByPath,
  ]);
  const effectiveNotices = useMemo(() => {
    return composeEffectiveDiagnosticNotices({
      activeDocument,
      activeDotenvDiagnosticNotices,
      activePhpLocalDiagnosticNotices,
      notices,
    });
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activeDotenvDiagnosticNotices,
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
  const reportCommandError = useCallback(
    (error: unknown) =>
      reportErrorForActiveWorkspaceRoot(workspaceRoot, "Command", error),
    [reportErrorForActiveWorkspaceRoot, workspaceRoot],
  );

  return {
    activeDocument,
    activeImage,
    activeMarkdownPreview,
    activeDocumentGitBaseline,
    activeEditorConfig,
    activePath,
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
    closeImplementationChooser: () => setImplementationChooser(null),
    closeCallHierarchy: () => setCallHierarchyView(null),
    closeTypeHierarchy: () => setTypeHierarchyView(null),
    closeReferencesPanel: () => setReferencesView(null),
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    focusNextEditorGroup: () => focusAdjacentEditorGroup(1),
    focusPreviousEditorGroup: () => focusAdjacentEditorGroup(-1),
    moveActiveTabToNextGroup: () => moveActiveTabToAdjacentGroup(1),
    moveActiveTabToPreviousGroup: () => moveActiveTabToAdjacentGroup(-1),
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
    runCommand,
    diagnosticsSummary,
    dirtyCount,
    externalFileConflictCount: externalFileConflicts.conflictCount,
    externalFileConflictState: externalFileConflicts.activeState,
    handleExternalFileConflictAction: externalFileConflicts.action,
    closeExternalFileCompare: externalFileConflicts.closeCompare,
    entriesByDirectory,
    expandedDirectories,
    expandedPhpFilePaths,
    fileStructureCanIncludeInheritedMembers,
    fileStructureLoading,
    fileStructureOutline,
    fileStructureOpen,
    fileStructureScope,
    flushPendingLanguageServerDocument: flushPendingDocumentChange,
    getLanguageServerDocumentLifecycleIdentity,
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
    debugSession,
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
    openFileStructure,
    openImplementationTarget,
    openProblemNotice,
    openTodoPanel,
    closeTodoPanel,
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
    openJsTestCase,
    openPhpTestCase,
    jsTestRunRequestVersion,
    phpTestRunRequestVersion,
    openWorkspaceSymbols,
    openPinnedFile,
    prefetchFile,
    cancelFilePrefetch,
    openEntryInTerminal,
    revealEntry,
    renameEntry,
    clearLanguageServerDiagnosticsForPath: (path: string) =>
      clearLanguageServerDiagnosticsForPath(
        workspaceRoot,
        path,
        workspaceRuntimeOwner ?? undefined,
      ),
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
    reorderOpenTabs,
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
    clearNotices: () => setNotices([]),
    notices: effectiveNotices,
    navigateBackward,
    navigateForwardInHistory,
    navigationHistory,
    getLatencySnapshot,
    recordCompletionLatency,
    reportCommandError,
    reportLanguageServerError,
    previewGitChange,
    quitApplication,
    refreshPhpTree,
    refreshGitStatus,
    revealDirectoryInTree,
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
    installManagedTypeScriptLanguageServer,
    installingManagedTypeScriptLanguageServer,
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
    dismissedTextSearchPaths,
    dismissTextSearchFile,
    restoreDismissedTextSearchFiles,
    replaceAllInPath,
    replaceInFile,
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
    toggleSmartMode,
    toggleWorkspaceTrust,
    updateActiveDocument,
    activeEditorPosition,
    updateActiveEditorPosition,
    updateEditorViewState,
    updateEditorGroupViewState,
    openPhpTreeNode,
    openSearchResult,
    openTextSearchResult,
    sidebarView,
    workspaceDescriptor,
    workspaceIdentityDescriptor,
    workspaceIdentityStatus: workspaceIdentityDescriptor
      ? "trusted"
      : "legacyCompatibility",
    workspaceRoot,
    restoredEditorViewStates: workspaceRoot
      ? workspaceEditorViewStatesRef.current[
          editorSessionOwnerKeyForRoot(workspaceRoot)
        ]?.[activeGroupId] ?? {}
      : {},
    restoredEditorViewStatesByGroup: workspaceRoot
      ? workspaceEditorViewStatesRef.current[
          editorSessionOwnerKeyForRoot(workspaceRoot)
        ] ?? {}
      : {},
    restoredEditorViewStateRevision,
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

function workspaceTabsWithPath(
  tabs: string[],
  path: string,
  identityAliasPaths: readonly string[] = [],
): string[] {
  const replacedTabIndex = tabs.findIndex((tabPath) =>
    identityAliasPaths.some((aliasPath) =>
      workspaceRootKeysEqual(aliasPath, tabPath),
    ),
  );
  if (replacedTabIndex >= 0) {
    const nextTabs = tabs.filter(
      (tabPath) =>
        !identityAliasPaths.some((aliasPath) =>
          workspaceRootKeysEqual(aliasPath, tabPath),
        ),
    );
    nextTabs.splice(Math.min(replacedTabIndex, nextTabs.length), 0, path);
    return nextTabs;
  }

  if (workspaceTabPathForPath(tabs, path)) {
    return tabs;
  }

  return [...tabs, path];
}

function workspaceIdentityAliasPaths(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  descriptor: WorkspaceIdentityDescriptor,
  cachedDescriptor: WorkspaceIdentityDescriptor | null,
): string[] {
  const aliases = [descriptor.selectedPath, descriptor.canonicalRoot];
  if (cachedDescriptor?.workspaceId === descriptor.workspaceId) {
    aliases.push(cachedDescriptor.selectedPath, cachedDescriptor.canonicalRoot);
  }

  for (const [rootPath, registered] of Object.entries(identities)) {
    if (registered.workspaceId !== descriptor.workspaceId) {
      continue;
    }
    aliases.push(rootPath, registered.selectedPath, registered.canonicalRoot);
  }

  return [...new Set(aliases)];
}

function admittedWorkspaceIdentityForRoot(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  identityGateway: WorkspaceIdentityGateway,
  rootPath: string,
): WorkspaceIdentityDescriptor | null {
  const admitted = Object.values(identities);
  const identityResolver = identityGateway as WorkspaceIdentityGateway &
    Partial<WorkspaceIdentityDescriptorResolver>;
  const gatewayMatch = identityResolver.matchForPath?.(rootPath);
  const gatewayAdmittedDescriptor = gatewayMatch
    ? admitted.find(
        (descriptor) =>
          descriptor.workspaceId === gatewayMatch.descriptor.workspaceId,
      )
    : null;
  if (gatewayAdmittedDescriptor) {
    return gatewayAdmittedDescriptor;
  }

  const mapped = identities[rootPath];
  if (mapped) {
    return mapped;
  }

  return (
    admitted.find(
      (descriptor) =>
        workspaceRelativePathForDescriptor(descriptor, rootPath) === "",
    ) ?? null
  );
}

export function resolveAdmittedDocumentSaveOwnership(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  identityGateway: WorkspaceIdentityGateway,
  rootPath: string,
  path: string,
): ReturnType<ResolveDocumentSaveOwnership> {
  const descriptor = admittedWorkspaceIdentityForRoot(
    identities,
    identityGateway,
    rootPath,
  );
  if (!descriptor) {
    return legacyDocumentSaveIdentity(rootPath, path);
  }

  const identityResolver = identityGateway as WorkspaceIdentityGateway &
    Partial<WorkspaceIdentityDescriptorResolver>;
  const match = identityResolver.matchForPath?.(path, descriptor.workspaceId);
  const relativePath =
    match?.descriptor.workspaceId === descriptor.workspaceId
      ? match.relativePath
      : workspaceRelativePathForDescriptor(descriptor, path);
  if (!relativePath) {
    return null;
  }

  return createDocumentSaveIdentity(
    descriptor.canonicalRoot,
    relativePath,
    descriptor.policy,
  );
}

function workspaceSettingsIdentity(
  canonicalKey: string,
  selectedRoot: string,
): WorkspaceSettingsIdentity {
  return {
    canonicalKey,
    legacyRawKeys: [...new Set([canonicalKey, selectedRoot])],
  };
}

interface WorkspaceRuntimeOwnerClaim {
  aliases: string[];
  generation: number | null;
  owner: WorkspaceRuntimeOwner;
}

type WorkspaceRuntimeOwnerClaimRegistry = Record<
  string,
  WorkspaceRuntimeOwnerClaim
>;

function registerWorkspaceRuntimeOwnerClaim(
  registry: WorkspaceRuntimeOwnerClaimRegistry,
  owner: WorkspaceRuntimeOwner,
  aliases: readonly string[],
  generation: number | null,
): void {
  const previous = registry[owner.ownerKey];
  const nextAliases = [
    ...(previous?.aliases ?? []),
    ...aliases,
    owner.executionRoot,
  ];
  registry[owner.ownerKey] = {
    aliases: nextAliases.filter(
      (alias, index) =>
        nextAliases.findIndex((candidate) =>
          workspaceRootKeysEqual(candidate, alias),
        ) === index,
    ),
    generation,
    owner,
  };
}

function retireClaimedWorkspaceRuntimeOwner(
  registry: WorkspaceRuntimeOwnerClaimRegistry,
  ownerKey: string,
  expectedGeneration?: number | null,
): void {
  const claim = registry[ownerKey];
  if (!claim) {
    return;
  }

  if (
    expectedGeneration !== undefined &&
    claim.generation !== expectedGeneration
  ) {
    return;
  }

  delete registry[ownerKey];
}

function resolveClaimedWorkspaceRuntimeOwnerForDiagnosticsEvent(
  registry: WorkspaceRuntimeOwnerClaimRegistry,
  event: LanguageServerDiagnosticEvent,
  runtimeKind: LanguageServerDiagnosticsRuntimeKind,
  phpRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
  javaScriptTypeScriptRuntimeStatuses: Record<
    string,
    LanguageServerRuntimeStatus
  >,
): WorkspaceRuntimeOwner | null {
  const claims = Object.values(registry).filter((claim) =>
    claim.aliases.some((alias) =>
      workspaceRootKeysEqual(alias, event.rootPath),
    ),
  );
  if (claims.length === 0) {
    return null;
  }

  const sessionMatches = claims.filter((claim) =>
    workspaceRuntimeOwnerSessionIds(
      claim.owner,
      runtimeKind,
      phpRuntimeStatuses,
      javaScriptTypeScriptRuntimeStatuses,
    ).includes(event.sessionId),
  );
  if (sessionMatches.length === 1) {
    return sessionMatches[0].owner;
  }

  if (claims.length !== 1 || sessionMatches.length > 1) {
    return null;
  }

  const knownSessionIds = workspaceRuntimeOwnerSessionIds(
    claims[0].owner,
    runtimeKind,
    phpRuntimeStatuses,
    javaScriptTypeScriptRuntimeStatuses,
  );
  if (knownSessionIds.length > 0) {
    return null;
  }

  return claims[0].owner;
}

function workspaceRuntimeOwnerSessionIds(
  owner: WorkspaceRuntimeOwner,
  runtimeKind: LanguageServerDiagnosticsRuntimeKind,
  phpRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
  javaScriptTypeScriptRuntimeStatuses: Record<
    string,
    LanguageServerRuntimeStatus
  >,
): number[] {
  const status = runtimeKind === "php"
    ? phpRuntimeStatuses[owner.ownerKey]
    : javaScriptTypeScriptRuntimeStatuses[owner.ownerKey];
  if (!status || (status.kind !== "starting" && status.kind !== "running")) {
    return [];
  }

  return [status.sessionId];
}

function backgroundRuntimeOwnersForPolicy(
  policy: BackgroundRuntimePolicy,
  activeRootPath: string | null,
  previousRootPath: string | null,
  workspaceTabs: readonly string[],
  runtimeOwnersByTab: Record<string, WorkspaceRuntimeOwner>,
): WorkspaceRuntimeOwner[] {
  if (policy === "keepAlive") {
    return [];
  }

  const rootPaths =
    policy === "singleActive" || previousRootPath === null
      ? workspaceTabs.filter(
          (rootPath) => !workspaceRootKeysEqual(rootPath, activeRootPath),
        )
      : previousRootPath &&
          !workspaceRootKeysEqual(previousRootPath, activeRootPath)
        ? [previousRootPath]
        : [];
  const owners = rootPaths.flatMap((rootPath) => {
    const owner = runtimeOwnersByTab[rootPath];
    return owner ? [owner] : [];
  });

  return owners.filter(
    (owner, index) =>
      owners.findIndex((candidate) => candidate.ownerKey === owner.ownerKey) ===
      index,
  );
}

function workspaceRuntimeOwnerFor(
  executionRoot: string,
  descriptor: WorkspaceIdentityDescriptor | null,
): WorkspaceRuntimeOwner {
  if (descriptor) {
    return createWorkspaceRuntimeOwner(descriptor.workspaceId, executionRoot);
  }

  return createLegacyWorkspaceRuntimeOwner(executionRoot);
}

function removeWorkspaceIdentityMappings(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  descriptor: WorkspaceIdentityDescriptor,
): void {
  for (const [root, registered] of Object.entries(identities)) {
    if (registered.workspaceId !== descriptor.workspaceId) {
      continue;
    }
    delete identities[root];
  }
}

export async function withWorkspaceIdentityLease(
  descriptor: WorkspaceIdentityDescriptor,
  unregister: (workspaceId: string) => Promise<void>,
  useLease: (adopt: () => void) => Promise<void>,
): Promise<void> {
  let adopted = false;
  try {
    await useLease(() => {
      adopted = true;
    });
  } finally {
    if (!adopted) {
      await unregister(descriptor.workspaceId);
    }
  }
}

export function adoptLegacyCachedWorkspaceState<
  T extends {
    workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  },
>(
  identityDescriptor: WorkspaceIdentityDescriptor,
  candidates: ReadonlyArray<T | null>,
): T | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const cachedWorkspaceId =
      candidate.workspaceIdentityDescriptor?.workspaceId;
    if (
      cachedWorkspaceId &&
      cachedWorkspaceId !== identityDescriptor.workspaceId
    ) {
      continue;
    }

    candidate.workspaceIdentityDescriptor = identityDescriptor;
    return candidate;
  }

  return null;
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

export function isLanguageServerSessionActiveForOwner(
  runtimeStatuses: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner,
  rootPath: string,
  sessionId: number,
): boolean {
  const ownerStatus = cachedLanguageServerRuntimeStatusForOwner(
    runtimeStatuses,
    owner,
  );
  if (!ownerStatus) {
    return false;
  }

  return isRunningLanguageServerSessionForWorkspace(
    ownerStatus,
    owner.executionRoot,
    rootPath,
    sessionId,
  );
}

export function isLanguageServerSessionCurrentForOwnerOrLegacy(
  runtimeStatuses: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner | undefined,
  legacyStatus: LanguageServerRuntimeStatus | null,
  legacyStatusRoot: string | null,
  rootPath: string,
  sessionId: number,
): boolean {
  if (owner) {
    return isLanguageServerSessionActiveForOwner(
      runtimeStatuses,
      owner,
      rootPath,
      sessionId,
    );
  }

  const cachedRuntimeStatus = cachedLanguageServerRuntimeStatusForRoot(
    runtimeStatuses,
    rootPath,
  );
  const currentLegacyStatus =
    cachedRuntimeStatus ??
    (workspaceRootKeysEqual(legacyStatusRoot, rootPath) ? legacyStatus : null);

  return isRunningLanguageServerSessionForWorkspace(
    currentLegacyStatus,
    currentLegacyStatus?.rootPath ?? legacyStatusRoot,
    rootPath,
    sessionId,
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
