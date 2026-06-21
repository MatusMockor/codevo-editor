import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn as TauriUnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
  type WorkbenchNoticeNavigationTarget,
} from "./workbenchNotice";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { CallHierarchyRow, CallHierarchyView } from "../domain/callHierarchy";
import type { TypeHierarchyRow, TypeHierarchyView } from "../domain/typeHierarchy";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import {
  emptyGitStatus,
  gitChangeKey,
  type GitChangedFile,
  type GitFileDiff,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import type { BottomPanelView } from "../domain/bottomPanel";
import {
  applyMetadataScanCompletion,
  createIndexHealthCompletionLog,
  createIndexHealthLogEntry,
  indexProgressCompletionMessage,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexHealthLogEntry,
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
  shouldApplyLanguageServerDiagnostics,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import {
  filterPhpLanguageServerDiagnostics,
  phpMemberMethodDiagnosticKey,
  phpMethodDiagnosticKey,
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
  createLanguageServerTextDocument,
  fileUriFromPath,
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerPathFromDocumentSyncKey,
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
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
} from "../domain/keymap";
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
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";
import {
  createNavigationHistory,
  navigateBack,
  navigateForward,
  recordNavigationLocation,
  type NavigationHistory,
  type NavigationLocation,
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
  type PhpTreeNode,
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
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelModelAccessorTargetFromSource,
  phpLaravelModelAttributeTargetFromSource,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
  phpLaravelRelationPropertyCompletionsFromSource,
  phpLaravelRelationTargetClassNameFromExpression,
  phpLaravelScopeMethodName,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
  type PhpLaravelNamedRouteDefinition,
} from "../domain/phpLaravelRoutes";
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
  phpFrameworkMethodCallReturnTypeFromSource,
  isPhpFrameworkProviderActive,
  phpFrameworkProviderSignature,
  phpFrameworkProvidersForProject,
} from "../domain/phpFrameworkProviders";
import {
  phpClassPathCandidates,
  phpCurrentTypeKind,
  phpDocMethodPositionOrNull,
  phpPropertyPositionOrNull,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpImplementationDeclarationContextAt,
  phpLaravelRelationStringCompletionContextAt,
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
import type {
  ProjectSymbolKind,
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import { isTypeProjectSymbol } from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type BackgroundRuntimePolicy,
  type SettingsGateway,
  type StatusBarItemVisibility,
  type WorkspaceSessionState,
  type WorkspaceSettings,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  nextActiveEditorPathAfterClose,
  visibleEditorPaths,
  type EditorDocument,
  type FileEntry,
  type FileSearchResult,
  type FileSearchGateway,
  type IntelligenceMode,
  type PhpToolGateway,
  type PhpToolAvailability,
  type TextSearchResult,
  type TextSearchGateway,
  type WorkspaceDescriptor,
  type WorkspaceDetectionGateway,
  type WorkspaceFileGateway,
} from "../domain/workspace";

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  phpTools: PhpToolGateway;
  projectSymbols: ProjectSymbolSearchGateway;
  textSearch: TextSearchGateway;
}

interface OpenFileOptions {
  pin?: boolean;
  recordNavigation?: boolean;
}

interface OpenGitChangeOptions {
  pin?: boolean;
}

interface PhpClassMemberCacheEntry {
  members: PhpMethodCompletion[];
  sourceSignature: string;
}

interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

interface PhpLaravelNamedRouteTarget extends PhpLaravelNamedRouteDefinition {
  path: string;
  relativePath: string | null;
}

interface CachedWorkspaceWorkbenchState {
  activePath: string | null;
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  documents: Record<string, EditorDocument>;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
  manuallyCollapsedDirectories: Set<string>;
  navigationHistory: NavigationHistory;
  openPaths: string[];
  previewPath: string | null;
  sidebarView: SidebarView;
}

const CLOSE_ACTIVE_TAB_EVENT = "mockor-close-active-tab";
const PHP_LANGUAGE_SERVER_AUTOSTART_MAX_ATTEMPTS = 2;

export type SidebarView = "files" | "git" | "php";

export function useWorkbenchController(
  workspaceGateways: WorkbenchWorkspaceGateways,
  smartModeGateway: SmartModeGateway,
  workspaceTrustGateway: WorkspaceTrustGateway,
  indexProgressGateway: IndexProgressGateway,
  phpFileOutlineGateway: PhpFileOutlineGateway,
  phpTreeGateway: PhpTreeGateway,
  gitGateway: GitGateway,
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
) {
  const {
    detection: workspaceDetection,
    fileSearch,
    files: workspaceFiles,
    phpTools: phpToolGateway,
    projectSymbols: projectSymbolSearch,
    textSearch,
  } = workspaceGateways;
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceDescriptor, setWorkspaceDescriptor] =
    useState<WorkspaceDescriptor | null>(null);
  const activePhpFrameworkProviders = useMemo(
    () => phpFrameworkProvidersForProject(workspaceDescriptor?.php ?? null),
    [workspaceDescriptor?.php],
  );
  const activePhpFrameworkProviderSignature = useMemo(
    () => phpFrameworkProviderSignature(activePhpFrameworkProviders),
    [activePhpFrameworkProviders],
  );
  const isLaravelFrameworkActive = useMemo(
    () => isPhpFrameworkProviderActive(activePhpFrameworkProviders, "laravel"),
    [activePhpFrameworkProviders],
  );
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
  const [gitLoading, setGitLoading] = useState(false);
  const [gitOperationLoading, setGitOperationLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [includedGitChangePaths, setIncludedGitChangePaths] = useState<Set<string>>(
    new Set(),
  );
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
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenResults, setQuickOpenResults] = useState<FileSearchResult[]>(
    [],
  );
  const [classOpenOpen, setClassOpenOpen] = useState(false);
  const [classOpenQuery, setClassOpenQuery] = useState("");
  const [classOpenLoading, setClassOpenLoading] = useState(false);
  const [classOpenResults, setClassOpenResults] = useState<
    ProjectSymbolSearchResult[]
  >([]);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<TextSearchResult[]>(
    [],
  );
  const [implementationChooser, setImplementationChooser] = useState<{
    targets: ImplementationTarget[];
    title: string;
  } | null>(null);
  const [callHierarchyView, setCallHierarchyView] =
    useState<CallHierarchyView | null>(null);
  const [typeHierarchyView, setTypeHierarchyView] =
    useState<TypeHierarchyView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
  const [appSettings, setAppSettings] =
    useState<AppSettings>(defaultAppSettings);
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettings>(defaultWorkspaceSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const workspaceSettingsRef = useRef<WorkspaceSettings>(
    defaultWorkspaceSettings(),
  );
  const workspaceSessionRestoredRef = useRef(false);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const lastPhpIdeReadinessSignatureRef = useRef<string | null>(null);
  const openFileRequestTokenRef = useRef(0);
  const gitDiffRequestTokenRef = useRef(0);
  const editorGitBaselineRequestTokenRef = useRef(0);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
  const phpLanguageServerAutostartAttemptsByRootRef = useRef<
    Record<string, number>
  >({});
  const autoStartedJavaScriptTypeScriptLanguageServerRootRef = useRef<
    string | null
  >(null);
  const intelligenceModeRef = useRef<IntelligenceMode>("basic");
  const documentVersionsRef = useRef<Record<string, number>>({});
  const documentVersionsByUriRef = useRef<Record<string, number>>({});
  const syncedDocumentPathsRef = useRef<Set<string>>(new Set());
  const syncedDocumentContentRef = useRef<Record<string, string>>({});
  const pendingDocumentChangesRef = useRef<
    Record<string, LanguageServerTextDocument>
  >({});
  const documentChangeTimersRef = useRef<Record<string, number>>({});
  const documentSyncQueuesRef = useRef<Record<string, Promise<void>>>({});
  const languageServerRuntimeStatusByRootRef = useRef<
    Record<string, LanguageServerRuntimeStatus>
  >({});
  const javaScriptTypeScriptDocumentVersionsRef = useRef<Record<string, number>>(
    {},
  );
  const javaScriptTypeScriptDocumentVersionsByUriRef = useRef<
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
  const javaScriptTypeScriptDocumentChangeTimersRef = useRef<
    Record<string, number>
  >({});
  const javaScriptTypeScriptDocumentSyncQueuesRef = useRef<
    Record<string, Promise<void>>
  >({});
  const javaScriptTypeScriptRuntimeStatusByRootRef = useRef<
    Record<string, LanguageServerRuntimeStatus>
  >({});
  const javaScriptTypeScriptDiagnosticsByRootRef = useRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
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
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const workspaceStateCacheRef = useRef<
    Record<string, CachedWorkspaceWorkbenchState>
  >({});
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
  const openDocumentPaths = useMemo(
    () => visibleEditorPaths(openPaths, previewPath),
    [openPaths, previewPath],
  );
  const openDocuments = openDocumentPaths
    .map((path) => documents[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const dirtyCount = openDocuments.filter(isDirty).length;
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

  const reportLanguageServerError = useCallback((error: unknown) => {
    const nextMessage = String(error);
    setMessage(nextMessage);

    if (lastLanguageServerCrashRef.current === nextMessage) {
      return;
    }

    lastLanguageServerCrashRef.current = nextMessage;
    setNotices((current) => [
      createWorkbenchNotice("error", "Language Server", nextMessage),
      ...current,
    ]);
  }, []);

  const reportLanguageServerErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      reportLanguageServerError(error);
    },
    [reportLanguageServerError],
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

  const persistWorkspaceSettings = useCallback(
    async (rootPath: string, nextSettings: WorkspaceSettings) => {
      const previousSettings = workspaceSettingsRef.current;
      applyWorkspaceSettings(nextSettings);

      try {
        await settingsGateway.saveWorkspaceSettings(rootPath, nextSettings);
      } catch (error) {
        applyWorkspaceSettings(previousSettings);
        throw error;
      }
    },
    [applyWorkspaceSettings, settingsGateway],
  );

  const cacheCurrentWorkspaceState = useCallback(
    (rootPath: string) => {
      workspaceStateCacheRef.current[rootPath] = {
        activePath,
        bottomPanelView,
        bottomPanelVisible,
        documents,
        entriesByDirectory,
        expandedDirectories: new Set(expandedDirectories),
        manuallyCollapsedDirectories: new Set(manuallyCollapsedDirectories),
        navigationHistory,
        openPaths,
        previewPath,
        sidebarView,
      };
    },
    [
      activePath,
      bottomPanelView,
      bottomPanelVisible,
      documents,
      entriesByDirectory,
      manuallyCollapsedDirectories,
      expandedDirectories,
      navigationHistory,
      openPaths,
      previewPath,
      sidebarView,
    ],
  );

  const restoreCachedWorkspaceState = useCallback(
    (cached: CachedWorkspaceWorkbenchState) => {
      setEntriesByDirectory(cached.entriesByDirectory);
      setExpandedDirectories(new Set(cached.expandedDirectories));
      setManuallyCollapsedDirectories(
        new Set(cached.manuallyCollapsedDirectories),
      );
      setDocuments(cached.documents);
      setOpenPaths(cached.openPaths);
      setActivePath(cached.activePath);
      setPreviewPath(cached.previewPath);
      setNavigationHistory(cached.navigationHistory);
      setSidebarView(cached.sidebarView);
      setBottomPanelView(cached.bottomPanelView);
      setBottomPanelVisible(cached.bottomPanelVisible);
    },
    [],
  );

  const currentNavigationLocation =
    useCallback((): NavigationLocation | null => {
      if (!activeDocument) {
        return null;
      }

      return {
        path: activeDocument.path,
        position: activeEditorPositionRef.current || {
          column: 1,
          lineNumber: 1,
        },
      };
    }, [activeDocument]);

  const recordCurrentNavigationLocation = useCallback(() => {
    const location = currentNavigationLocation();
    setNavigationHistory((current) =>
      recordNavigationLocation(current, location),
    );
  }, [currentNavigationLocation]);

  const clearLanguageServerDiagnostics = useCallback(() => {
    setLanguageServerDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) => !notice.groupKey?.startsWith("language-server-diagnostics:"),
      ),
    );
  }, []);

  const clearJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(() => {
    setJavaScriptTypeScriptDiagnosticsByPath({});
    setNotices((current) =>
      current.filter(
        (notice) =>
          !notice.groupKey?.startsWith("javascript-typescript-diagnostics:"),
      ),
    );
  }, []);

  const restoreJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const cachedDiagnostics = rootKey
        ? javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {}
        : {};
      setJavaScriptTypeScriptDiagnosticsByPath({ ...cachedDiagnostics });
    },
    [],
  );

  const updateJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (
      rootPath: string,
      diagnosticPath: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const currentByPath =
        javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] ?? {};
      const nextByPath = { ...currentByPath };

      if (diagnostics.length > 0) {
        nextByPath[diagnosticPath] = diagnostics;
      } else {
        delete nextByPath[diagnosticPath];
      }

      if (Object.keys(nextByPath).length > 0) {
        javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey] = nextByPath;
      } else {
        delete javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey];
      }

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        setJavaScriptTypeScriptDiagnosticsByPath(nextByPath);
      }
    },
    [],
  );

  const clearJavaScriptTypeScriptDiagnosticsForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);

      if (rootKey) {
        delete javaScriptTypeScriptDiagnosticsByRootRef.current[rootKey];
      }

      if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        clearJavaScriptTypeScriptLanguageServerDiagnostics();
      }
    },
    [clearJavaScriptTypeScriptLanguageServerDiagnostics],
  );

  const applyLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
      if (!event.rootPath) {
        return;
      }

      if (
        currentWorkspaceRootRef.current &&
        !workspaceRootKeysEqual(event.rootPath, currentWorkspaceRootRef.current)
      ) {
        return;
      }

      const currentSessionId = isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        event.rootPath,
      )
        ? languageServerRuntimeStatus.sessionId
        : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;
      const currentVersion = diagnosticsRootPath
        ? documentVersionsByUriRef.current[
            languageServerUriSyncKey(diagnosticsRootPath, event.uri)
          ]
        : undefined;

      if (
        !shouldApplyLanguageServerDiagnostics(
          event,
          currentSessionId,
          currentVersion,
          currentWorkspaceRootRef.current,
        )
      ) {
        return;
      }

      const groupKey = languageServerDiagnosticNoticeGroup(event.uri);
      const diagnosticPath = pathFromLanguageServerUri(event.uri);

      void (async () => {
        const diagnostics = diagnosticPath
          ? await contextualDiagnosticsFilterRef.current(
              diagnosticPath,
              event.diagnostics,
            )
          : event.diagnostics;
        const latestVersion = diagnosticsRootPath
          ? documentVersionsByUriRef.current[
              languageServerUriSyncKey(diagnosticsRootPath, event.uri)
            ]
          : undefined;

        if (
          !shouldApplyLanguageServerDiagnostics(
            event,
            currentSessionId,
            latestVersion,
            currentWorkspaceRootRef.current,
          )
        ) {
          return;
        }

        const diagnosticNotices = diagnostics.map((diagnostic) =>
          createWorkbenchNotice(
            languageServerDiagnosticNoticeSeverity(diagnostic.severity),
            diagnostic.source || "Language Server",
            languageServerDiagnosticNoticeMessage(diagnostic, event.uri),
            groupKey,
            diagnosticNoticeNavigationTarget(event.uri, diagnostic),
          ),
        );

        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
        );

        if (diagnosticPath) {
          setLanguageServerDiagnosticsByPath((current) => ({
            ...current,
            [diagnosticPath]: diagnostics,
          }));
        }
      })().catch(reportLanguageServerError);
    },
    [
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportLanguageServerError,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
      if (!event.rootPath) {
        return;
      }

      const diagnosticsRootPath = event.rootPath;

      if (
        !workspaceRootKeysEqual(diagnosticsRootPath, currentWorkspaceRootRef.current) &&
        !appSettingsRef.current.workspaceTabs.some((tabPath) =>
          workspaceRootKeysEqual(tabPath, diagnosticsRootPath),
        )
      ) {
        return;
      }

      const runtimeStatus = cachedLanguageServerRuntimeStatusForRoot(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        diagnosticsRootPath,
      );
      const currentSessionId =
        runtimeStatus?.kind === "running" ? runtimeStatus.sessionId : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const currentVersion = diagnosticsRootPath
        ? javaScriptTypeScriptDocumentVersionsByUriRef.current[
            languageServerUriSyncKey(diagnosticsRootPath, event.uri)
          ]
        : undefined;

      if (
        !shouldApplyLanguageServerDiagnostics(
          event,
          currentSessionId,
          currentVersion,
          diagnosticsRootPath,
        )
      ) {
        return;
      }

      const groupKey = javaScriptTypeScriptDiagnosticNoticeGroup(event.uri);
      const diagnosticPath = pathFromLanguageServerUri(event.uri);
      const isActiveRoot = workspaceRootKeysEqual(
        currentWorkspaceRootRef.current,
        diagnosticsRootPath,
      );

      if (!workspaceSettingsRef.current.javaScriptTypeScriptValidation) {
        if (isActiveRoot) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, groupKey, []),
          );
        }

        if (diagnosticPath) {
          updateJavaScriptTypeScriptDiagnosticsForRoot(
            diagnosticsRootPath,
            diagnosticPath,
            [],
          );
        }

        return;
      }

      const diagnosticNotices = event.diagnostics.map((diagnostic) =>
        createWorkbenchNotice(
          languageServerDiagnosticNoticeSeverity(diagnostic.severity),
          diagnostic.source || "TypeScript",
          languageServerDiagnosticNoticeMessage(diagnostic, event.uri),
          groupKey,
          diagnosticNoticeNavigationTarget(event.uri, diagnostic),
        ),
      );

      if (isActiveRoot) {
        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
        );
      }

      if (diagnosticPath) {
        updateJavaScriptTypeScriptDiagnosticsForRoot(
          diagnosticsRootPath,
          diagnosticPath,
          event.diagnostics,
        );
      }
    },
    [updateJavaScriptTypeScriptDiagnosticsForRoot],
  );

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string) => {
      try {
        const plan = await languageServerGateway.planPhpLanguageServer(rootPath);
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
              codeLensEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptCodeLens,
              inlayHintsEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptInlayHints,
              typeScriptVersionPreference,
              validationEnabled:
                workspaceSettingsRef.current.javaScriptTypeScriptValidation,
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

  const forgetLanguageServerRuntimeStatuses = useCallback((rootPath: string) => {
    removeCachedLanguageServerRuntimeStatus(
      languageServerRuntimeStatusByRootRef.current,
      rootPath,
    );
    removeCachedLanguageServerRuntimeStatus(
      javaScriptTypeScriptRuntimeStatusByRootRef.current,
      rootPath,
    );
  }, []);

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

  const cleanupCrashedJavaScriptTypeScriptLanguageServerRuntime = useCallback(
    (rootPath: string | null, status: LanguageServerRuntimeStatus) => {
      if (!rootPath || !languageServerCrashMessage(status)) {
        return;
      }

      void javaScriptTypeScriptLanguageServerRuntimeGateway
        .stop(rootPath)
        .catch((error) =>
          reportErrorForActiveWorkspaceRoot(
            rootPath,
            "JavaScript/TypeScript",
            error,
          ),
        );
    },
    [
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const handleLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus, fallbackRootPath?: string) => {
      const statusRootPath = runtimeStatusRootPath(status, fallbackRootPath);

      if (!statusRootPath) {
        return;
      }

      const rootedStatus = cachePhpLanguageServerRuntimeStatus(
        statusRootPath,
        status,
      );

      if (
        currentWorkspaceRootRef.current &&
        !workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)
      ) {
        return;
      }

      setLanguageServerRuntimeStatus(rootedStatus);
      setLanguageServerRuntimeStatusRoot(statusRootPath);
      const crash = languageServerCrashMessage(status);

      if (status.kind !== "running") {
        clearLanguageServerDiagnostics();
      }

      if (!crash) {
        lastLanguageServerCrashRef.current = null;
        return;
      }

      reportLanguageServerError(crash);
    },
    [
      cachePhpLanguageServerRuntimeStatus,
      clearLanguageServerDiagnostics,
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

      cleanupCrashedJavaScriptTypeScriptLanguageServerRuntime(
        statusRootPath,
        status,
      );

      if (
        statusRootPath &&
        currentWorkspaceRootRef.current &&
        !workspaceRootKeysEqual(statusRootPath, currentWorkspaceRootRef.current)
      ) {
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
      cleanupCrashedJavaScriptTypeScriptLanguageServerRuntime,
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
    Object.keys(documentChangeTimersRef.current).forEach(clearDocumentChangeTimer);
    syncedDocumentPathsRef.current.clear();
    syncedDocumentContentRef.current = {};
    pendingDocumentChangesRef.current = {};
    documentVersionsRef.current = {};
    documentVersionsByUriRef.current = {};
    documentSyncQueuesRef.current = {};
  }, [clearDocumentChangeTimer]);

  const resetJavaScriptTypeScriptLanguageServerDocuments = useCallback(() => {
    Object.keys(javaScriptTypeScriptDocumentChangeTimersRef.current).forEach(
      clearJavaScriptTypeScriptDocumentChangeTimer,
    );
    javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current = null;
    javaScriptTypeScriptSyncedDocumentPathsRef.current.clear();
    javaScriptTypeScriptSyncedDocumentContentRef.current = {};
    javaScriptTypeScriptPendingDocumentChangesRef.current = {};
    javaScriptTypeScriptDocumentVersionsRef.current = {};
    javaScriptTypeScriptDocumentVersionsByUriRef.current = {};
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

      if (workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        setLanguageServerRuntimeStatus(rootedStatus);
        setLanguageServerRuntimeStatusRoot(targetRootPath);
        lastLanguageServerCrashRef.current = null;
        clearLanguageServerDiagnostics();
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
    clearLanguageServerDiagnostics,
    cachePhpLanguageServerRuntimeStatus,
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
      clearJavaScriptTypeScriptDiagnosticsForRoot(targetRootPath);

      if (!workspaceRootKeysEqual(targetRootPath, currentWorkspaceRootRef.current)) {
        return;
      }

      setLanguageServerRuntimeStatus(stoppedStatus);
      setLanguageServerRuntimeStatusRoot(targetRootPath);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(stoppedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
      lastLanguageServerCrashRef.current = null;
      clearLanguageServerDiagnostics();
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      cachePhpLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptDiagnosticsForRoot,
      clearLanguageServerDiagnostics,
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

  const syncOpenDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      syncedDocumentPathsRef.current.add(syncKey);
      syncedDocumentContentRef.current[syncKey] = document.content;

      try {
        await enqueueDocumentSync(syncKey, () =>
          languageServerDocumentSyncGateway.didOpen(rootPath, syncedDocument),
        );
      } catch (error) {
        syncedDocumentPathsRef.current.delete(syncKey);
        delete syncedDocumentContentRef.current[syncKey];
        reportLanguageServerError(error);
      }
    },
    [
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      reportLanguageServerError,
    ],
  );

  const syncOpenJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      if (!rootPath || !isJavaScriptTypeScriptLanguageServerDocument(document)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const version = nextJavaScriptTypeScriptDocumentVersion(
        rootPath,
        document.path,
      );
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptSyncedDocumentPathsRef.current.add(syncKey);
      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] =
        document.content;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
          ),
        );
      } catch (error) {
        if (
          !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
            rootPath,
            requestedSessionId,
          )
        ) {
          return;
        }

        javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
        delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      nextJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const clearActiveWorkspace = useCallback(async () => {
    const currentRootPath = currentWorkspaceRootRef.current;

    if (currentRootPath) {
      await stopProjectRuntimes(currentRootPath);
    }

    workspaceSessionRestoredRef.current = false;
    currentWorkspaceRootRef.current = null;
    workspaceStateCacheRef.current = {};
    languageServerRuntimeStatusByRootRef.current = {};
    javaScriptTypeScriptRuntimeStatusByRootRef.current = {};
    javaScriptTypeScriptDiagnosticsByRootRef.current = {};
    openFileRequestTokenRef.current += 1;
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
    setExpandedDirectories(new Set());
    setManuallyCollapsedDirectories(new Set());
    setDocuments({});
    setOpenPaths([]);
    setActivePath(null);
    setPreviewPath(null);
    setNavigationHistory(createNavigationHistory());
    setSidebarView("files");
    setBottomPanelView("problems");
    setGitStatus(emptyGitStatus());
    setGitLoading(false);
    setGitDiffLoading(false);
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    setEditorGitBaselinesByPath({});
    setClassOpenOpen(false);
    setQuickOpenOpen(false);
    setTextSearchOpen(false);
    setPaletteOpen(false);
    setFileStructureOpen(false);
    setLanguageServerSetupOpen(false);
    setSettingsOpen(false);
    setIntelligenceMode("basic");
    intelligenceModeRef.current = "basic";
    clearIndexWorkspaceState();
  }, [
    clearIndexWorkspaceState,
    stopProjectRuntimes,
  ]);

  const scheduleDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (syncedDocumentContentRef.current[syncKey] === document.content) {
        return;
      }

      clearDocumentChangeTimer(syncKey);
      syncedDocumentContentRef.current[syncKey] = document.content;

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      pendingDocumentChangesRef.current[syncKey] = syncedDocument;
      documentChangeTimersRef.current[syncKey] = window.setTimeout(() => {
        const pendingDocument = pendingDocumentChangesRef.current[syncKey];
        delete documentChangeTimersRef.current[syncKey];
        delete pendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }

        void enqueueDocumentSync(syncKey, () =>
          languageServerDocumentSyncGateway.didChange(rootPath, pendingDocument),
        )
          .catch(reportLanguageServerError);
      }, 150);
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      reportLanguageServerError,
    ],
  );

  const scheduleJavaScriptTypeScriptDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !rootPath ||
        !syncKey ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      if (
        javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] ===
        document.content
      ) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] =
        document.content;

      const version = nextJavaScriptTypeScriptDocumentVersion(
        rootPath,
        document.path,
      );
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] =
        syncedDocument;
      javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey] =
        window.setTimeout(() => {
          const pendingDocument =
            javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
          delete javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey];
          delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

          if (!pendingDocument) {
            return;
          }

          const currentRuntimeStatus =
            javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;

          if (
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isRunningLanguageServerForWorkspace(
              currentRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
              rootPath,
            )
          ) {
            return;
          }

          const requestedSessionId = currentRuntimeStatus.sessionId;

          void enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
            javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocument,
            ),
          ).catch((error) => {
            if (
              !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              )
            ) {
              return;
            }

            reportErrorForActiveWorkspaceRoot(
              rootPath,
              "JavaScript/TypeScript",
              error,
            );
          });
        }, 150);
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      nextJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const flushPendingDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, path)
        : null;

      if (!rootPath || !syncKey) {
        return;
      }

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        const document =
          activeDocumentRef.current?.path === path
            ? activeDocumentRef.current
            : documentsRef.current[path];

        if (document && isLanguageServerDocument(document)) {
          await syncOpenDocument(document);
        }
      }

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        await documentSyncQueuesRef.current[syncKey];
        return;
      }

      let pendingDocument = pendingDocumentChangesRef.current[syncKey];

      if (!pendingDocument) {
        await documentSyncQueuesRef.current[syncKey];
        pendingDocument = pendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }
      }

      clearDocumentChangeTimer(syncKey);
      delete pendingDocumentChangesRef.current[syncKey];

      await enqueueDocumentSync(syncKey, () =>
        languageServerDocumentSyncGateway.didChange(rootPath, pendingDocument),
      );
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      syncOpenDocument,
    ],
  );

  const flushPendingJavaScriptTypeScriptDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, path)
        : null;

      if (!rootPath || !syncKey) {
        return;
      }

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedSessionCurrent = () =>
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          requestedSessionId,
        );

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        const document =
          activeDocumentRef.current?.path === path
            ? activeDocumentRef.current
            : documentsRef.current[path];

        if (
          document &&
          isJavaScriptTypeScriptLanguageServerDocument(document)
        ) {
          await syncOpenJavaScriptTypeScriptDocument(document);
        }

        if (!isRequestedSessionCurrent()) {
          return;
        }
      }

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        await javaScriptTypeScriptDocumentSyncQueuesRef.current[syncKey];
        if (!isRequestedSessionCurrent()) {
          return;
        }
        return;
      }

      let pendingDocument =
        javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      if (!pendingDocument) {
        await javaScriptTypeScriptDocumentSyncQueuesRef.current[syncKey];
        if (!isRequestedSessionCurrent()) {
          return;
        }
        pendingDocument =
          javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }
      }

      if (!isRequestedSessionCurrent()) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
            rootPath,
            pendingDocument,
          ),
        );
      } catch (error) {
        if (isRequestedSessionCurrent()) {
          throw error;
        }
      }
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      syncOpenJavaScriptTypeScriptDocument,
    ],
  );

  const syncSavedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      try {
        await flushPendingDocumentChange(document.path);
        await enqueueDocumentSync(syncKey, () =>
          languageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(
              document,
              documentVersionsRef.current[syncKey] || 0,
            ),
          ),
        );
      } catch (error) {
        reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error);
      }
    },
    [
      enqueueDocumentSync,
      flushPendingDocumentChange,
      languageServerDocumentSyncGateway,
      reportLanguageServerErrorForActiveWorkspaceRoot,
    ],
  );

  const syncSavedJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !syncKey ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      if (!rootPath || !isJavaScriptTypeScriptLanguageServerDocument(document)) {
        return;
      }

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedSessionCurrent = () =>
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          requestedSessionId,
        );

      try {
        await flushPendingJavaScriptTypeScriptDocumentChange(document.path);

        if (!isRequestedSessionCurrent()) {
          return;
        }

        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(
              document,
              javaScriptTypeScriptDocumentVersionsRef.current[syncKey] || 0,
            ),
          ),
        );
      } catch (error) {
        if (!isRequestedSessionCurrent()) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      flushPendingJavaScriptTypeScriptDocumentChange,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const syncClosedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      clearDocumentChangeTimer(syncKey);
      syncedDocumentPathsRef.current.delete(syncKey);
      delete syncedDocumentContentRef.current[syncKey];
      delete pendingDocumentChangesRef.current[syncKey];
      delete documentVersionsRef.current[syncKey];
      delete documentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];

      try {
        await enqueueDocumentSync(syncKey, () =>
          languageServerDocumentSyncGateway.didClose(rootPath, document.path),
        );
      } catch (error) {
        reportLanguageServerError(error);
      }
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      reportLanguageServerError,
    ],
  );

  const syncClosedJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !rootPath ||
        !syncKey ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      const currentRuntimeStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      const requestedSessionId = isRunningLanguageServerForWorkspace(
        currentRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? currentRuntimeStatus.sessionId
        : null;

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
      delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
      delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
      delete javaScriptTypeScriptDocumentVersionsRef.current[syncKey];
      delete javaScriptTypeScriptDocumentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose(
            rootPath,
            document.path,
          ),
        );
      } catch (error) {
        if (
          requestedSessionId !== null &&
          !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
            rootPath,
            requestedSessionId,
          )
        ) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const closeSyncedLanguageServerDocumentsForRoot = useCallback(
    async (rootPath: string) => {
      const syncedDocuments = Array.from(syncedDocumentPathsRef.current).flatMap(
        (key) => {
          const path = languageServerPathFromDocumentSyncKey(rootPath, key);

          return path ? [{ key, path }] : [];
        },
      );

      await Promise.all(
        syncedDocuments.map(async ({ key, path }) => {
          clearDocumentChangeTimer(key);
          syncedDocumentPathsRef.current.delete(key);
          delete syncedDocumentContentRef.current[key];
          delete pendingDocumentChangesRef.current[key];
          delete documentVersionsRef.current[key];
          delete documentVersionsByUriRef.current[
            languageServerUriSyncKey(rootPath, fileUriFromPath(path))
          ];

          try {
            await enqueueDocumentSync(key, () =>
              languageServerDocumentSyncGateway.didClose(rootPath, path),
            );
          } catch (error) {
            reportLanguageServerError(error);
          }
        }),
      );

      if (syncedDocumentPathsRef.current.size === 0) {
        resetLanguageServerDocuments();
      }
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      reportLanguageServerError,
      resetLanguageServerDocuments,
    ],
  );

  const closeSyncedJavaScriptTypeScriptDocumentsForRoot = useCallback(
    async (rootPath: string) => {
      const syncedDocuments = Array.from(
        javaScriptTypeScriptSyncedDocumentPathsRef.current,
      ).flatMap((key) => {
        const path = languageServerPathFromDocumentSyncKey(rootPath, key);

        return path ? [{ key, path }] : [];
      });

      await Promise.all(
        syncedDocuments.map(async ({ key, path }) => {
          clearJavaScriptTypeScriptDocumentChangeTimer(key);
          javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(key);
          delete javaScriptTypeScriptSyncedDocumentContentRef.current[key];
          delete javaScriptTypeScriptPendingDocumentChangesRef.current[key];
          delete javaScriptTypeScriptDocumentVersionsRef.current[key];
          delete javaScriptTypeScriptDocumentVersionsByUriRef.current[
            languageServerUriSyncKey(rootPath, fileUriFromPath(path))
          ];

          try {
            await enqueueJavaScriptTypeScriptDocumentSync(key, () =>
              javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose(
                rootPath,
                path,
              ),
            );
          } catch (error) {
            reportErrorForActiveWorkspaceRoot(
              rootPath,
              "JavaScript/TypeScript",
              error,
            );
          }
        }),
      );
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const loadDirectory = useCallback(
    async (
      path: string,
      options: {
        clearMessage?: boolean;
      } = {},
    ) => {
      setLoadingDirectories((current) => new Set(current).add(path));

      try {
        const entries = await workspaceFiles.readDirectory(path);
        if (!workspacePathBelongsToRoot(path, currentWorkspaceRootRef.current)) {
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
        if (!workspacePathBelongsToRoot(path, currentWorkspaceRootRef.current)) {
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
      const paths = session.openPaths.filter((path) =>
        isSessionPathInWorkspace(rootPath, path),
      );

      if (paths.length === 0) {
        setSidebarView(session.sidebarView);
        setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));
        return;
      }

      const restoredDocuments: Record<string, EditorDocument> = {};
      const restoredPaths: string[] = [];
      let failedCount = 0;

      for (const path of paths) {
        try {
          const content = await workspaceFiles.readTextFile(path);
          restoredDocuments[path] = {
            content,
            language: detectLanguage(path),
            name: getFileName(path),
            path,
            savedContent: content,
          };
          restoredPaths.push(path);
        } catch {
          failedCount += 1;
        }
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setDocuments(restoredDocuments);
      setOpenPaths(restoredPaths);
      setActivePath(restoredActivePath(session.activePath, restoredPaths));
      setSidebarView(session.sidebarView);
      setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));

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
    [workspaceFiles],
  );

  const openWorkspacePath = useCallback(
    async (path: string) => {
      const previousRootPath = currentWorkspaceRootRef.current;
      const cachedWorkspaceState = workspaceStateCacheRef.current[path] ?? null;
      const switchingWorkspace =
        previousRootPath &&
        !workspaceRootKeysEqual(previousRootPath, path);

      if (switchingWorkspace) {
        openFileRequestTokenRef.current += 1;
        cacheCurrentWorkspaceState(previousRootPath);
        await Promise.allSettled([
          closeSyncedLanguageServerDocumentsForRoot(previousRootPath),
          closeSyncedJavaScriptTypeScriptDocumentsForRoot(previousRootPath),
        ]);
      }

      workspaceSessionRestoredRef.current = false;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      let workspaceSettings = defaultWorkspaceSettings();

      try {
        workspaceSettings = await settingsGateway.loadWorkspaceSettings(path);
      } catch (error) {
        reportError("Settings", error);
      }

      setWorkspaceRoot(path);
      currentWorkspaceRootRef.current = path;
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
        setNavigationHistory(createNavigationHistory());
        setSidebarView("files");
        setBottomPanelView("problems");
        setBottomPanelVisible(false);
      }

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
      setGitLoading(false);
      setGitDiffLoading(false);
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setEditorGitBaselinesByPath({});
      setPhpFileOutlinesByPath({});
      setPhpInheritedFileOutlinesByPath({});
      setExpandedPhpFilePaths(new Set());
      setLoadingPhpFileOutlinePaths(new Set());
      setLoadingInheritedPhpFileOutlinePaths(new Set());
      setPhpFileOutlineExpandedNodeIds(new Set());
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenResults([]);
      setFileStructureScope("current");
      lastPhpFileOutlineRefreshKeyRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      phpClassSourcePathCacheRef.current = {};
      phpClassMemberCacheRef.current = {};
      phpFrameworkBindingCacheRef.current = {};
      setPhpIdeReadinessVersion(0);
      activeIndexRootRef.current = null;
      pendingIndexScanRef.current = false;
      autoStartedLanguageServerRootRef.current = null;
      phpLanguageServerAutostartAttemptsByRootRef.current = {};
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
        reportError("Settings", error);
      }

      let resolvedIntelligenceMode = workspaceSettings.intelligenceMode;

      try {
        const smartMode = await smartModeGateway.setMode(
          workspaceSettings.intelligenceMode,
        );
        resolvedIntelligenceMode = smartMode.mode;
        intelligenceModeRef.current = smartMode.mode;
        setIntelligenceMode(smartMode.mode);
      } catch (error) {
        reportError("IDE Mode", error);
      }

      if (!cachedWorkspaceState?.entriesByDirectory[path]) {
        await loadDirectory(path);
      }

      let descriptor: WorkspaceDescriptor | null = null;
      try {
        const trust = await workspaceTrustGateway.getTrust(path);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }

        setWorkspaceTrust(trust);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(path, "Workspace Trust", error);
      }

      try {
        descriptor = await workspaceDetection.detectWorkspace(path);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }

        setWorkspaceDescriptor(descriptor);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(path, "Workspace Detection", error);
      }

      if (cachedWorkspaceState) {
        workspaceSessionRestoredRef.current = true;
      } else {
        await restoreWorkspaceSession(path, workspaceSettings.session);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }

        workspaceSessionRestoredRef.current = true;
      }

      void refreshJavaScriptTypeScriptLanguageServerPlan(path);

      if (shouldIndexWorkspace(resolvedIntelligenceMode)) {
        void startInitialIndexScan(path);
      }

      if (!descriptor?.php) {
        setLanguageServerPlan(null);
        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []),
        );
        return;
      }

      try {
        const tools = await phpToolGateway.detectPhpTools(path);
        const phpSetupNoticeGroup = `phpactor-setup:${path}`;

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)) {
          return;
        }

        setPhpTools(tools);
        if (tools.phpactor) {
          setNotices((current) =>
            replaceWorkbenchNoticeGroup(current, phpSetupNoticeGroup, []),
          );
        } else {
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
        }
        await refreshLanguageServerPlan(path);
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(path, "PHP Tools", error);
      }
    },
    [
      applyWorkspaceSettings,
      cacheCurrentWorkspaceState,
      loadDirectory,
      persistAppSettings,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportError,
      restoreCachedWorkspaceState,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreWorkspaceSession,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
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

      const currentIndex = workspaceTabIndexForPath(currentTabs, tabPath);
      const nextPath =
        nextTabs[Math.min(currentIndex, nextTabs.length - 1)] ??
        nextTabs[nextTabs.length - 1] ??
        null;

      delete workspaceStateCacheRef.current[tabPath];
      delete workspaceStateCacheRef.current[targetRootPath];
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
        await openWorkspacePath(nextPath);
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
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setActivePath(path);
    },
    [
      activePath,
      gitStatus.changes,
      loadGitDiffDocument,
      recordCurrentNavigationLocation,
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

      await loadDirectory(path);
    },
    [entriesByDirectory, expandedDirectories, loadDirectory],
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
      const shouldRecordNavigation = options.recordNavigation !== false;
      const shouldPin = options.pin === true;

      if (documents[entry.path]) {
        if (shouldRecordNavigation && activePath !== entry.path) {
          recordCurrentNavigationLocation();
        }

        if (!shouldPin && !openPaths.includes(entry.path)) {
          setPreviewPath(entry.path);
        }

        if (shouldPin) {
          pinDocument(entry.path);
        }

        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setActivePath(entry.path);
        return true;
      }

      try {
        const replacement = cleanReplacementDocument(
          activeDocument,
          documents,
          openPaths,
          previewPath,
        );
        const replacedPath = replacement?.path ?? null;
        const content = await workspaceFiles.readTextFile(entry.path);

        if (openFileRequestTokenRef.current !== requestToken) {
          return false;
        }

        const document: EditorDocument = {
          path: entry.path,
          name: entry.name,
          content,
          savedContent: content,
          language: detectLanguage(entry.path),
        };

        if (shouldRecordNavigation) {
          recordCurrentNavigationLocation();
        }

        if (replacement) {
          void syncClosedDocument(replacement);
          void syncClosedJavaScriptTypeScriptDocument(replacement);
        }

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
        setPreviewPath(shouldPin ? null : entry.path);

        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setActivePath(entry.path);
        setMessage(null);
        return true;
      } catch (error) {
        if (openFileRequestTokenRef.current !== requestToken) {
          return false;
        }

        reportError("Open File", error);
        return false;
      }
    },
    [
      activePath,
      activeDocument,
      documents,
      openPaths,
      previewPath,
      recordCurrentNavigationLocation,
      reportError,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
    ],
  );

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

  const refreshGitStatus = useCallback(async () => {
    if (!workspaceRoot) {
      setGitStatus(emptyGitStatus());
      setGitLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    setGitLoading(true);

    try {
      const status = await gitGateway.getStatus(requestedRoot);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitStatus(status);
      setMessage(null);
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitStatus(emptyGitStatus(requestedRoot));
      reportError("Git", error);
    } finally {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setGitLoading(false);
    }
  }, [gitGateway, reportError, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot || !activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    const token = (editorGitBaselineRequestTokenRef.current += 1);
    let active = true;

    const loadGitBaseline = async () => {
      try {
        const status = await gitGateway.getStatus(requestedRoot);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setGitStatus(status);

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

        const diff = await gitGateway.getDiff(requestedRoot, change);

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
  }, [activeDocument?.path, activeDocument?.savedContent, gitGateway, workspaceRoot]);

  const previewGitChange = useCallback(
    async (change: GitChangedFile, options: OpenGitChangeOptions = {}) => {
      if (!workspaceRoot) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      const shouldPin = options.pin === true;
      gitDiffRequestTokenRef.current = requestToken;
      setSelectedGitChange(change);
      setGitDiffLoading(true);

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

        const documentPath = gitDiffDocumentPath(change);
        const replacement = cleanReplacementDocument(
          activeDocument,
          documents,
          openPaths,
          previewPath,
        );
        const replacedPath =
          replacement && replacement.path !== documentPath ? replacement.path : null;
        const document: EditorDocument = {
          path: documentPath,
          name: gitDiffDocumentName(change),
          content: "",
          savedContent: "",
          language: diff.language,
        };

        if (replacement && replacement.path !== documentPath) {
          void syncClosedDocument(replacement);
          void syncClosedJavaScriptTypeScriptDocument(replacement);
        }

        recordCurrentNavigationLocation();
        setDocuments((current) => {
          const next = { ...current, [documentPath]: document };

          if (replacedPath) {
            delete next[replacedPath];
          }

          return next;
        });
        setOpenPaths((current) => {
          if (shouldPin && !replacedPath) {
            return current.includes(documentPath)
              ? current
              : [...current, documentPath];
          }

          if (shouldPin && replacedPath) {
            const mapped = current.map((openPath) =>
              openPath === replacedPath ? documentPath : openPath,
            );
            return mapped.includes(documentPath)
              ? mapped
              : [...mapped, documentPath];
          }

          return current.filter((openPath) => openPath !== replacedPath);
        });
        setPreviewPath(shouldPin ? null : documentPath);
        setActivePath(documentPath);
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
      activeDocument,
      documents,
      gitGateway,
      openPaths,
      previewPath,
      recordCurrentNavigationLocation,
      reportError,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceRoot,
    ],
  );

  const openGitChange = useCallback(
    async (change: GitChangedFile) => {
      await previewGitChange(change, { pin: true });
    },
    [previewGitChange],
  );

  const closeGitDiffPreview = useCallback(() => {
    gitDiffRequestTokenRef.current += 1;
    const documentPath = selectedGitChange
      ? gitDiffDocumentPath(selectedGitChange)
      : null;
    setGitDiffLoading(false);
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    if (documentPath) {
      const nextActivePath = nextActiveEditorPathAfterClose(
        documentPath,
        openPaths,
        previewPath,
      );
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
    setMessage(null);
  }, [
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
        !status.changes.some(
          (change) =>
            gitDiffDocumentPath(change) === gitDiffDocumentPath(selectedGitChange) &&
            (change.path === selectedGitChange.path ||
              change.oldPath === selectedGitChange.path),
        )
      ) {
        closeGitDiffPreview();
      }
    },
    [closeGitDiffPreview, selectedGitChange],
  );

  const toggleGitChangeIncluded = useCallback((change: GitChangedFile) => {
    setIncludedGitChangePaths((current) => {
      const next = new Set(current);

      const changeKey = gitChangeKey(change);

      if (next.has(changeKey)) {
        next.delete(changeKey);
      } else {
        next.add(changeKey);
      }

      return next;
    });
  }, []);

  const stageGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.stageFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const unstageGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.unstageFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const revertGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      if (!prompter.confirm("Revert selected Git changes? This discards local changes.")) {
        return;
      }

      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.revertFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, prompter, reportError, workspaceRoot],
  );

  const runGitCommit = useCallback(
    async ({ pushAfterCommit }: { pushAfterCommit: boolean }) => {
      if (!workspaceRoot) {
        return;
      }

      const message = gitCommitMessage.trim();
      const changesToCommit = gitStatus.changes.filter((change) =>
        includedGitChangePaths.has(gitChangeKey(change)),
      );

      if (!message || changesToCommit.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        if (changesToCommit.some((change) => !change.isStaged)) {
          await gitGateway.stageFiles(requestedRoot, changesToCommit);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        const commitStatus = await gitGateway.commit(
          requestedRoot,
          message,
          changesToCommit,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(commitStatus);
        setIncludedGitChangePaths(new Set());
        setGitCommitMessage("");
        setMessage(pushAfterCommit ? "Commit created. Pushing..." : null);

        if (!pushAfterCommit) {
          return;
        }

        try {
          const pushStatus = await gitGateway.push(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }

          applyGitOperationStatus(pushStatus);
          setMessage("Pushed current branch");
        } catch (error) {
          if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            reportError("Git Push", error);
          }
        }
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [
      applyGitOperationStatus,
      gitCommitMessage,
      gitGateway,
      gitStatus.changes,
      includedGitChangePaths,
      reportError,
      workspaceRoot,
    ],
  );

  const commitGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: false }),
    [runGitCommit],
  );

  const commitAndPushGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: true }),
    [runGitCommit],
  );

  const refreshPhpTree = useCallback(async () => {
    if (!workspaceRoot) {
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    setPhpTreeLoading(true);

    try {
      const tree = await phpTreeGateway.getPhpTree(requestedRoot);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTree(tree);
      setMessage(null);
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTree(emptyPhpTree());
      reportError("PHP Tree", error);
    } finally {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setPhpTreeLoading(false);
    }
  }, [phpTreeGateway, reportError, workspaceRoot]);

  const togglePhpTreeNode = useCallback((id: string) => {
    setPhpTreeExpandedNodeIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
        return next;
      }

      next.add(id);
      return next;
    });
  }, []);

  const openPhpTreeNode = useCallback(
    async (node: PhpTreeNode) => {
      if (!node.path) {
        return;
      }

      const opened = await openFile({
        kind: "file",
        name: getFileName(node.path),
        path: node.path,
      });

      if (!opened || !node.lineNumber || !node.column) {
        return;
      }

      setEditorRevealTarget({
        path: node.path,
        position: {
          column: node.column,
          lineNumber: node.lineNumber,
        },
      });
    },
    [openFile],
  );

  const readPhpFileOutlineSource = useCallback(
    async (path: string): Promise<string> => {
      const openDocument = documents[path];

      if (openDocument) {
        return openDocument.content;
      }

      return workspaceFiles.readTextFile(path);
    },
    [documents, workspaceFiles],
  );

  const loadPhpFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot) {
        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      const requestedRoot = workspaceRoot;
      setLoadingPhpFileOutlinePaths((current) => new Set(current).add(path));

      try {
        const indexedOutline = await phpFileOutlineGateway.getPhpFileOutline(
          requestedRoot,
          path,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        let outline = indexedOutline;

        if (indexedOutline.nodes.length === 0 && isPhpPath(path)) {
          const source = await readPhpFileOutlineSource(path);
          outline = await phpFileOutlineGateway.parsePhpFileOutline(path, source);
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: outline,
        }));
        setMessage(null);
      } catch (error) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP File Outline", error);
      } finally {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setLoadingPhpFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      phpFileOutlineGateway,
      readPhpFileOutlineSource,
      reportError,
      workspaceRoot,
    ],
  );

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

  const loadInheritedPhpFileOutline = useCallback(
    async (path: string) => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        return;
      }

      const requestedRoot = workspaceRoot;
      setLoadingInheritedPhpFileOutlinePaths((current) =>
        new Set(current).add(path),
      );

      try {
        const source = await readPhpFileOutlineSource(path);
        const parentClassName = phpExtendsClassName(source);
        const resolvedParentClassName = parentClassName
          ? resolvePhpClassName(source, parentClassName)
          : null;

        if (!resolvedParentClassName) {
          setPhpInheritedFileOutlinesByPath((current) => ({
            ...current,
            [path]: emptyPhpFileOutline(),
          }));
          return;
        }

        for (const parentPath of phpClassPathCandidates(
          requestedRoot,
          workspaceDescriptor.php,
          resolvedParentClassName,
        )) {
          try {
            const parentSource = await readPhpFileOutlineSource(parentPath);
            const outline = await phpFileOutlineGateway.parsePhpFileOutline(
              parentPath,
              parentSource,
            );

            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
              return;
            }

            setPhpInheritedFileOutlinesByPath((current) => ({
              ...current,
              [path]: outline,
            }));
            setMessage(null);
            return;
          } catch {
            continue;
          }
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
      } catch (error) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP Inherited Structure", error);
      } finally {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        setLoadingInheritedPhpFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [
      phpFileOutlineGateway,
      readPhpFileOutlineSource,
      reportError,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const togglePhpFileOutline = useCallback(
    (path: string) => {
      if (expandedPhpFilePaths.has(path)) {
        setExpandedPhpFilePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        return;
      }

      setExpandedPhpFilePaths((current) => new Set(current).add(path));

      if (phpFileOutlinesByPath[path] || loadingPhpFileOutlinePaths.has(path)) {
        return;
      }

      void loadPhpFileOutline(path);
    },
    [
      expandedPhpFilePaths,
      loadPhpFileOutline,
      loadingPhpFileOutlinePaths,
      phpFileOutlinesByPath,
    ],
  );

  const togglePhpFileOutlineNode = useCallback((id: string) => {
    setPhpFileOutlineExpandedNodeIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
        return next;
      }

      next.add(id);
      return next;
    });
  }, []);

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
    if (!activeDocument) {
      setMessage("Open a PHP, JavaScript, or TypeScript file to show structure.");
      return;
    }

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);

    if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
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
        !javaScriptTypeScriptFileOutlinesByPath[activeDocument.path] &&
        !loadingJavaScriptTypeScriptFileOutlinePaths.has(activeDocument.path)
      ) {
        void loadJavaScriptTypeScriptFileOutline(activeDocument.path);
      }

      return;
    }

    if (!isLanguageServerDocument(activeDocument)) {
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
      !phpFileOutlinesByPath[activeDocument.path] &&
      !loadingPhpFileOutlinePaths.has(activeDocument.path)
    ) {
      void loadPhpFileOutline(activeDocument.path);
    }

  }, [
    activeDocument,
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

  const openPhpFileOutlineNode = useCallback(
    async (node: PhpFileOutlineNode) => {
      if (!node.path) {
        return;
      }

      const opened = await openFile({
        kind: "file",
        name: getFileName(node.path),
        path: node.path,
      });

      if (!opened || !node.lineNumber || !node.column) {
        return;
      }

      setEditorRevealTarget({
        path: node.path,
        position: {
          column: node.column,
          lineNumber: node.lineNumber,
        },
      });
    },
    [openFile],
  );

  const applyWorkspaceEditToOpenDocuments = useCallback(
    (edit: LanguageServerWorkspaceEdit, rootPath: string): string[] => {
      const editedPaths = changedOpenDocumentPathsForWorkspaceEdit(
        edit,
        documentsRef.current,
        rootPath,
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
      applyWorkspaceEditToOpenDocuments(controllerEdit, requestedRoot);
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

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles(
            requestedRoot,
            oldPath,
            newPath,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
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
        );
        const changedClosedFiles = await workspaceFiles.applyWorkspaceEdit(
          requestedRoot,
          rootEdit,
          openDocumentPaths,
        );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        const changedFiles = changedClosedFiles + editedOpenPaths.length;

        if (changedFiles > 0) {
          setMessage(`Updated ${changedFiles} import path${changedFiles === 1 ? "" : "s"}.`);
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Rename", error);
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

  const saveActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    try {
      await workspaceFiles.writeTextFile(
        activeDocument.path,
        activeDocument.content,
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          savedContent: activeDocument.content,
        },
      }));
      await syncSavedDocument(activeDocument);
      await syncSavedJavaScriptTypeScriptDocument(activeDocument);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Saved ${activeDocument.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", error);
    }
  }, [
    activeDocument,
    reportErrorForActiveWorkspaceRoot,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceSettings.autoSave) {
      return;
    }

    if (!activeDocument || !isDirty(activeDocument)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveDocument();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeDocument, saveActiveDocument, workspaceSettings.autoSave]);

  const setStatusBarItemVisibility = useCallback(
    async (key: keyof StatusBarItemVisibility, visible: boolean) => {
      if (!workspaceRoot) {
        return;
      }

      try {
        await persistWorkspaceSettings(workspaceRoot, {
          ...workspaceSettingsRef.current,
          statusBar: {
            ...workspaceSettingsRef.current.statusBar,
            [key]: visible,
          },
        });
      } catch (error) {
        reportError("Status Bar", error);
      }
    },
    [persistWorkspaceSettings, reportError, workspaceRoot],
  );

  const setSmartMode = useCallback(
    async (mode: IntelligenceMode) => {
      if (!workspaceRoot) {
        return;
      }

      if (mode === intelligenceMode) {
        return;
      }

      try {
        const previousMode = intelligenceMode;
        const state = await smartModeGateway.setMode(mode);
        const nextMode = state.mode;

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          await stopLanguageServerRuntime();
        }

        if (!shouldStartLanguageServer(previousMode) && shouldStartLanguageServer(nextMode)) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[
            normalizedWorkspaceRootKey(workspaceRoot)
          ];
        }

        intelligenceModeRef.current = nextMode;
        setIntelligenceMode(nextMode);
        await persistWorkspaceSettings(workspaceRoot, {
          ...workspaceSettingsRef.current,
          intelligenceMode: nextMode,
        });

        if (shouldIndexWorkspace(nextMode)) {
          setMessage(state.message);
          await startInitialIndexScan(workspaceRoot);
          return;
        }

        await clearWorkspaceIndex(workspaceRoot, state.message);
      } catch (error) {
        reportError("IDE Mode", error);
      }
    },
    [
      clearWorkspaceIndex,
      intelligenceMode,
      persistWorkspaceSettings,
      reportError,
      smartModeGateway,
      startInitialIndexScan,
      stopLanguageServerRuntime,
      workspaceRoot,
    ],
  );

  const closeDocument = useCallback(
    (path: string) => {
      const document = documents[path];

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
      }

      if (gitChangeForDiffDocumentPath(path, gitStatus.changes)) {
        gitDiffRequestTokenRef.current += 1;
        setGitDiffLoading(false);
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
      if (!activeDocument) {
        return;
      }

      if (content === activeDocument.content) {
        return;
      }

      pinDocument(activeDocument.path);
      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          content,
        },
      }));
    },
    [activeDocument, pinDocument],
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
      await workspaceFiles.createTextFile(path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "created",
          path,
        },
      ]);
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
    openFile,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    workspaceFiles,
    workspaceRoot,
  ]);

  const openSearchResult = useCallback(
    async (result: FileSearchResult) => {
      await openFile({ kind: "file", name: result.name, path: result.path });
      setQuickOpenOpen(false);
    },
    [openFile],
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

  const openTextSearchResult = useCallback(
    async (result: TextSearchResult) => {
      await openFile({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });
      setTextSearchOpen(false);
      setMessage(
        `Opened ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFile],
  );

  const updateActiveEditorPosition = useCallback((position: EditorPosition) => {
    activeEditorPositionRef.current = position;
  }, []);

  const showBottomPanelView = useCallback((view: BottomPanelView) => {
    setBottomPanelView(view);
    setBottomPanelVisible(true);
  }, []);

  const hideBottomPanel = useCallback(() => {
    setBottomPanelVisible(false);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelVisible((visible) => !visible);
  }, []);

  const openPathForNavigation = useCallback(
    async (path: string): Promise<boolean> => {
      const opened = await openFile(
        {
          kind: "file",
          name: getFileName(path),
          path,
        },
        { recordNavigation: false },
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
    ): Promise<boolean> => {
      recordCurrentNavigationLocation();

      const opened = await openPathForNavigation(path);

      if (!opened) {
        return false;
      }

      setEditorRevealTarget({
        path,
        position,
      });
      setMessage(
        `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
      );
      return true;
    },
    [openPathForNavigation, recordCurrentNavigationLocation],
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

  const readNavigationFileContent = useCallback(
    async (path: string): Promise<string> => {
      const openDocument = documents[path];

      if (openDocument) {
        return openDocument.content;
      }

      return workspaceFiles.readTextFile(path);
    },
    [documents, workspaceFiles],
  );

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

  const resolvePhpFrameworkBoundConcrete = useCallback(
    async (className: string): Promise<string | null> => {
      if (!activePhpFrameworkProviders.length || !workspaceRoot) {
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
        workspaceRoot,
        `${shortName}::class`,
        200,
      );
      const visitedPaths = new Set<string>();

      for (const result of results) {
        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

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
          continue;
        }

        if (concreteClassName) {
          break;
        }
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

  const findPhpClassSourcePathsByFileName = useCallback(
    async (className: string): Promise<string[]> => {
      if (!workspaceRoot) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const shortName = shortPhpName(normalizedClassName);
      const fileName = `${shortName}.php`;
      const results = await fileSearch.searchFiles(workspaceRoot, fileName, 40);
      const paths: string[] = [];

      for (const result of results) {
        if (result.name.toLowerCase() !== fileName.toLowerCase()) {
          continue;
        }

        try {
          const content = await readNavigationFileContent(result.path);
          const sourceClassName = phpCurrentClassName(content);

          if (sourceClassName?.toLowerCase() !== normalizedClassName.toLowerCase()) {
            continue;
          }

          paths.push(result.path);
        } catch {
          continue;
        }
      }

      return paths;
    },
    [fileSearch, readNavigationFileContent, workspaceRoot],
  );

  const resolvePhpClassSourcePaths = useCallback(
    async (className: string): Promise<string[]> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const paths = new Set(
        phpClassPathCandidates(
          workspaceRoot,
          workspaceDescriptor.php,
          normalizedClassName,
        ),
      );
      let hasIndexedPath = false;

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          workspaceRoot,
          shortPhpName(normalizedClassName),
          50,
        );
        const normalizedLookup = normalizedClassName.toLowerCase();

        for (const symbol of indexedSymbols) {
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

      if (paths.size === 0 || !hasIndexedPath) {
        const cacheKey = normalizedClassName.toLowerCase();
        const cachedPaths = phpClassSourcePathCacheRef.current[cacheKey];
        const fallbackPaths =
          cachedPaths ??
          (await findPhpClassSourcePathsByFileName(
            normalizedClassName,
          ));

        if (!cachedPaths && fallbackPaths.length > 0) {
          phpClassSourcePathCacheRef.current[cacheKey] = fallbackPaths;
        }

        for (const path of fallbackPaths) {
          paths.add(path);
        }
      }

      return [...paths];
    },
    [
      findPhpClassSourcePathsByFileName,
      intelligenceMode,
      projectSymbolSearch,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpTemplateTypesForGenericReferences = useCallback(
    async (
      source: string,
      targetClassName: string,
      genericReferences: ReturnType<typeof phpDocGenericInheritances>,
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
              const resolvedGenericType = genericType
                ? resolvePhpClassReference(source, genericType)
                : null;

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
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        inheritedClassName,
        phpDocGenericInheritances(source),
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  const resolvePhpGenericTemplateTypesForMixinClass = useCallback(
    async (
      source: string,
      mixinClassName: string,
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        mixinClassName,
        phpDocGenericMixins(source),
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  const readPhpClassMembersFromPath = useCallback(
    async (
      path: string,
      className: string,
    ): Promise<PhpClassMemberReadResult> => {
      const content = await readNavigationFileContent(path);
      const sourceSignature = phpSourceSignature(content);
      const cacheKey = phpClassMemberCacheKey(
        path,
        className,
        activePhpFrameworkProviderSignature,
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
      readNavigationFileContent,
    ],
  );

  const collectPhpMethodsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          try {
            const { content, members } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );
            rememberMethods(members, templateTypes);

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                await collectMethods(
                  resolvedTraitName,
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedTraitName,
                  ),
                );
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                await collectMethods(
                  resolvedMixinName,
                  await resolvePhpGenericTemplateTypesForMixinClass(
                    content,
                    resolvedMixinName,
                  ),
                );
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassName(
                content,
                superTypeName,
              );

              if (resolvedSuperTypeName) {
                await collectMethods(
                  resolvedSuperTypeName,
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedSuperTypeName,
                  ),
                );
              }
            }

            return;
          } catch {
            continue;
          }
        }
      };

      await collectMethods(className);

      const boundConcreteClassName =
        await resolvePhpFrameworkBoundConcrete(className);

      if (boundConcreteClassName) {
        await collectMethods(boundConcreteClassName);
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
      if (!isLaravelFrameworkActive || !workspaceRoot || !workspaceDescriptor?.php) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          for (const method of phpLaravelDynamicWhereCompletionsFromSource(
            content,
            normalizedClassName,
            options,
          )) {
            const key = method.name.toLowerCase();

            if (!completions.has(key)) {
              completions.set(key, method);
            }
          }
        } catch {
          continue;
        }
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
      if (!isLaravelFrameworkActive || !workspaceRoot || !workspaceDescriptor?.php) {
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

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          try {
            const { content } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );

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
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                await collectRelations(resolvedMixinName);
              }
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassName(content, parentClassName)
              : null;

            if (resolvedParentClassName) {
              await collectRelations(resolvedParentClassName);
            }

            return;
          } catch {
            continue;
          }
        }
      };

      await collectRelations(className);

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

  const collectPhpLaravelNamedRouteTargets = useCallback(
    async (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelNamedRouteTarget[]> => {
      if (!isLaravelFrameworkActive || !workspaceRoot) {
        return [];
      }

      const targets = new Map<string, PhpLaravelNamedRouteTarget>();
      const addDefinitions = (
        path: string,
        relativePath: string | null,
        source: string,
      ) => {
        for (const definition of phpLaravelNamedRouteDefinitions(source)) {
          const key = `${path}:${definition.position.lineNumber}:${definition.position.column}:${definition.name.toLowerCase()}`;

          if (targets.has(key)) {
            continue;
          }

          targets.set(key, {
            ...definition,
            path,
            relativePath,
          });
        }
      };

      addDefinitions(
        currentPath,
        workspaceRoot ? relativeWorkspacePath(workspaceRoot, currentPath) : null,
        currentSource,
      );

      const searchResults = await Promise.all(
        ["->name(", "Route::resource", "Route::apiResource"].map((query) =>
          textSearch.searchText(workspaceRoot, query, 200),
        ),
      );
      const visitedPaths = new Set([currentPath]);

      for (const result of searchResults.flat()) {
        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          addDefinitions(
            result.path,
            result.relativePath,
            await readNavigationFileContent(result.path),
          );
        } catch {
          continue;
        }
      }

      return Array.from(targets.values()).sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);

        if (nameOrder !== 0) {
          return nameOrder;
        }

        return left.path.localeCompare(right.path);
      });
    },
    [
      isLaravelFrameworkActive,
      readNavigationFileContent,
      textSearch,
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
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

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
          }
        } catch {
          continue;
        }
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
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

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
          }
        } catch {
          continue;
        }
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
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );
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
          }
        } catch {
          continue;
        }
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
      if (!workspaceRoot) {
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
          workspaceRoot,
          shortPhpName(normalizedClassName),
          200,
        );
        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

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
          } catch {
            continue;
          }
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
          workspaceRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );
        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

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
          } catch {
            continue;
          }
        }

        return false;
      };

      return traitConcreteUserHierarchyHasMethod(normalizedTraitClassName);
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
      if (!workspaceRoot) {
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
          workspaceRoot,
          shortPhpName(normalizedClassName),
          200,
        );
        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

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
          } catch {
            continue;
          }
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
          workspaceRoot,
          shortPhpName(normalizedTargetTraitClassName),
          200,
        );
        const visitedPaths = new Set<string>();

        for (const result of results) {
          if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
            continue;
          }

          visitedPaths.add(result.path);

          try {
            const content = await readNavigationFileContent(result.path);

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
          } catch {
            continue;
          }
        }

        return false;
      };

      return traitConcreteUserHierarchyHasProperty(normalizedTraitClassName);
    },
    [
      phpClassHierarchyHasProperty,
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

          if (
            hasContextualScopeMethod ||
            hasContextualDynamicWhereMethod ||
            hasContextualExistingMemberMethod
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

      return filterPhpLanguageServerDiagnostics(source, diagnostics, {
        contextualExistingMethods,
        contextualMemberMethods,
        contextualMemberProperties,
        contextualTraitHostMethods,
        contextualTraitHostProperties,
        frameworkProviders: activePhpFrameworkProviders,
        path,
      });
    },
    [
      phpClassHasLaravelLocalScope,
      phpClassHasLaravelDynamicWhere,
      activePhpFrameworkProviders,
      isLaravelFrameworkActive,
      phpClassHierarchyHasMethod,
      phpClassHierarchyHasStaticMethod,
      phpClassHierarchyHasProperty,
      phpTraitHostMethodExists,
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
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

        if (
          !boundConcreteClassName ||
          boundConcreteClassName.toLowerCase() === visitedKey
        ) {
          return null;
        }

        return resolvePhpMethodReturnType(
          boundConcreteClassName,
          methodName,
          visitedClassNames,
          boundConcreteClassName,
        );
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
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );
          const method = members.find(
            (candidate) =>
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const returnType = method
            ? resolvePhpMethodDeclaredReturnType(
                content,
                method.returnType,
                normalizedLateStaticClassName || normalizedClassName,
                templateTypes,
              )
            : null;

          if (returnType) {
            return returnType;
          }

          if (method) {
            for (const expression of phpMethodReturnExpressions(
              content,
              method.name,
            )) {
              const expressionReturnType = await resolveReturnExpressionType(
                content,
                expression,
              );

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
                )
              : new Map<string, string>();
            const traitReturnType = resolvedTraitName
              ? await resolvePhpMethodReturnType(
                  resolvedTraitName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  traitTemplateTypes,
                )
              : null;

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
                )
              : new Map<string, string>();
            const mixinReturnType = resolvedMixinName
              ? await resolvePhpMethodReturnType(
                  resolvedMixinName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  mixinTemplateTypes,
                )
              : null;

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
              );
            const superTypeReturnType = await resolvePhpMethodReturnType(
              resolvedSuperTypeName,
              methodName,
              visitedClassNames,
              normalizedLateStaticClassName || normalizedClassName,
              superTypeTemplateTypes,
            );

            if (superTypeReturnType) {
              return superTypeReturnType;
            }
          }

          return resolveBoundConcreteReturnType();
        } catch {
          continue;
        }
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
    ): Promise<string | null> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const visitedKey = normalizedClassName.toLowerCase();

      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return null;
      }

      visitedClassNames.add(visitedKey);

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );
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
          const collectionPropertyModelType =
            propertyMember && includeCollectionRelations
              ? phpCollectionGenericModelTypeCandidate(propertyMember.returnType)
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

          const propertyReturnType = propertyMember?.returnType ?? null;
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
            for (const expression of phpMethodReturnExpressions(
              content,
              relationMethod.name,
            )) {
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
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(content, traitName);
            const traitType = resolvedTraitName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedTraitName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                )
              : null;

            if (traitType) {
              return traitType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
            const mixinType = resolvedMixinName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedMixinName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                )
              : null;

            if (mixinType) {
              return mixinType;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );
            const superTypePropertyType = resolvedSuperTypeName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedSuperTypeName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                )
              : null;

            if (superTypePropertyType) {
              return superTypePropertyType;
            }
          }

          return null;
        } catch {
          continue;
        }
      }

      return null;
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpLaravelRelationPathOwnerType = useCallback(
    async (
      className: string,
      previousRelationNames: readonly string[] = [],
    ): Promise<string | null> => {
      if (!isLaravelFrameworkActive) {
        return null;
      }

      let ownerType: string | null = className;

      for (const relationName of previousRelationNames) {
        ownerType = ownerType
          ? await resolvePhpClassPropertyOrRelationType(
              ownerType,
              relationName,
              true,
            )
          : null;

        if (!ownerType) {
          return null;
        }
      }

      return ownerType;
    },
    [resolvePhpClassPropertyOrRelationType, isLaravelFrameworkActive],
  );

  const resolvePhpCollectionModelTypeFromClass = useCallback(
    async (className: string): Promise<string | null> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          try {
            const content = await readNavigationFileContent(path);
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

            if (parentModelType) {
              return parentModelType;
            }
          } catch {
            continue;
          }
        }

        return null;
      };

      return resolveCollection(className);
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
    ): Promise<PhpMethodCompletion[]> => {
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
      const localScopeMethods = builderModelType
        ? phpLaravelLocalScopeCompletionsFromMethods(
            await collectPhpMethodsForClass(builderModelType),
          )
        : [];
      const dynamicWhereMethods = builderModelType
        ? await collectPhpLaravelDynamicWhereMethodsForClass(builderModelType)
        : [];

      return mergePhpMethodCompletions(
        receiverMethods,
        localScopeMethods,
        dynamicWhereMethods,
      );
    },
    [
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
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

      return mergePhpMethodCompletions(
        methods.filter((method) => method.isStatic),
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
      const namedRouteContext = phpLaravelNamedRouteReferenceContextAt(
        source,
        position,
      );

      if (isLaravelFrameworkActive && namedRouteContext && activeDocument) {
        const normalizedPrefix = namedRouteContext.prefix.toLowerCase();
        const routes = await collectPhpLaravelNamedRouteTargets(
          source,
          activeDocument.path,
        );

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
        const receiverType =
          !receiverModelType && relationContext.receiverExpression
            ? await resolvePhpExpressionType(
                source,
                position,
                relationContext.receiverExpression,
              )
            : null;
        const relationBaseOwnerType =
          staticClassName ?? receiverModelType ?? receiverType;
        const relationOwnerType = relationBaseOwnerType
          ? await resolvePhpLaravelRelationPathOwnerType(
              relationBaseOwnerType,
              relationContext.previousRelationNames ?? [],
            )
          : null;

        if (!relationOwnerType) {
          return [];
        }

        const normalizedPrefix = relationContext.prefix.toLowerCase();
        const relations =
          await collectPhpLaravelRelationCompletionsForClass(relationOwnerType);

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
            )
          : [];
      const normalizedPrefix = (
        staticAccessContext?.prefix ??
        accessContext?.prefix ??
        ""
      ).toLowerCase();

      return methods
        .filter((method) => method.name.toLowerCase().startsWith(normalizedPrefix))
        .sort((left, right) => {
          const leftExact = left.name.toLowerCase() === normalizedPrefix ? 0 : 1;
          const rightExact = right.name.toLowerCase() === normalizedPrefix ? 0 : 1;

          if (leftExact !== rightExact) {
            return leftExact - rightExact;
          }

          return left.name.localeCompare(right.name);
        })
        .slice(0, 80);
    },
    [
      collectPhpLaravelRelationCompletionsForClass,
      collectPhpLaravelNamedRouteTargets,
      activeDocument,
      isLaravelFrameworkActive,
      resolvePhpClassReference,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
      resolvePhpLaravelRelationPathOwnerType,
      resolvePhpReceiverMethodCompletions,
      resolvePhpStaticMethodCompletions,
    ],
  );

  const providePhpMethodSignature = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodSignature | null> => {
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
      const method = methods.find(
        (candidate) =>
          candidate.name.toLowerCase() ===
          signatureContext.methodName.toLowerCase(),
      );

      if (!method) {
        return null;
      }

      return {
        argumentIndex: signatureContext.argumentIndex,
        method,
        parameters: phpMethodParameters(method.parameters),
      };
    },
    [resolvePhpReceiverMethodCompletions, resolvePhpStaticMethodCompletions],
  );

  const openPhpClassTarget = useCallback(
    async (className: string, label: string): Promise<boolean> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return false;
      }

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          workspaceRoot,
          className,
          25,
        );
        const indexedTarget = bestIndexedSymbolMatch(
          indexedSymbols,
          className,
          activeDocument?.path ?? "",
        );

        if (indexedTarget) {
          return openNavigationTarget(
            indexedTarget.path,
            editorPositionFromProjectSymbol(indexedTarget),
            label,
          );
        }
      }

      for (const path of phpClassPathCandidates(
        workspaceRoot,
        workspaceDescriptor.php,
        className,
      )) {
        try {
          const content = await readNavigationFileContent(path);
          return openNavigationTarget(
            path,
            phpNamedTypePosition(content, shortPhpName(className)),
            label,
          );
        } catch {
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

  const openPhpMethodHintTarget = useCallback(
    async (hint: PhpMethodDefinitionHint): Promise<boolean> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return false;
      }

      for (const path of phpClassPathCandidates(
        workspaceRoot,
        workspaceDescriptor.php,
        hint.className,
      )) {
        try {
          const content = await readNavigationFileContent(path);
          return openNavigationTarget(
            path,
            phpMethodPosition(content, hint.methodName),
            `${hint.methodName}()`,
          );
        } catch {
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
      if (!workspaceRoot) {
        return false;
      }

      const normalizedClassName = className.toLowerCase();
      const normalizedMethodName = methodName.toLowerCase();

      if (shouldIndexWorkspace(intelligenceMode)) {
        const symbols = await projectSymbolSearch.searchProjectSymbols(
          workspaceRoot,
          methodName,
          50,
        );
        const target = symbols.find(
          (symbol) =>
            symbol.kind === "method" &&
            symbol.name.toLowerCase() === normalizedMethodName &&
            symbol.containerName?.toLowerCase() === normalizedClassName,
        );

        if (target) {
          return openNavigationTarget(
            target.path,
            editorPositionFromProjectSymbol(target),
            `${methodName}()`,
          );
        }
      }

      if (!workspaceDescriptor?.php) {
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

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          try {
            const content = await readNavigationFileContent(path);
            const position =
              phpMethodPositionOrNull(content, methodName) ??
              phpDocMethodPositionOrNull(content, methodName);

            if (position) {
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
      if (!workspaceRoot || !workspaceDescriptor?.php) {
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

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          try {
            const content = await readNavigationFileContent(path);
            const position = phpPropertyPositionOrNull(content, propertyName);

            if (position) {
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
      if (
        !activeDocument ||
        activeDocument.language !== "php" ||
        !workspaceRoot ||
        !shouldIndexWorkspace(intelligenceMode)
      ) {
        return [];
      }

      const declarationContext = phpImplementationDeclarationContextAt(
        activeDocument.content,
        editorPosition,
      );
      const targetClassName = phpCurrentClassName(activeDocument.content);

      if (!declarationContext || !targetClassName) {
        return [];
      }

      const { methodName } = declarationContext;
      const normalizedMethodName = methodName.toLowerCase();
      const normalizedTargetClassName = targetClassName.toLowerCase();
      const symbols = await projectSymbolSearch.searchProjectSymbols(
        workspaceRoot,
        methodName,
        200,
      );
      const targets = new Map<string, ImplementationTarget>();

      for (const symbol of symbols) {
        if (
          symbol.kind !== "method" ||
          symbol.path === activeDocument.path ||
          symbol.name.toLowerCase() !== normalizedMethodName
        ) {
          continue;
        }

        try {
          const source = await readNavigationFileContent(symbol.path);
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
      const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

      if (!editorPosition) {
        return false;
      }

      const targets = await indexedPhpImplementationTargets(editorPosition);

      if (targets.length === 0) {
        return false;
      }

      const symbolName = activeDocument
        ? identifierAtEditorPosition(activeDocument.content, editorPosition)
        : null;

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
      await openNavigationTarget(target.path, target.position, target.label);
      return true;
    },
    [activeDocument, indexedPhpImplementationTargets, openNavigationTarget],
  );

  const openPhpLaravelDynamicWhereTarget = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      if (!isLaravelFrameworkActive || !workspaceRoot || !workspaceDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const content = await readNavigationFileContent(path);
          const target = phpLaravelDynamicWhereAttributeTargetFromSource(
            content,
            methodName,
          );

          if (!target) {
            continue;
          }

          return openNavigationTarget(
            path,
            target.position,
            target.attributeName,
          );
        } catch {
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
      if (!isLaravelFrameworkActive || !workspaceRoot || !workspaceDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const content = await readNavigationFileContent(path);
          const target = phpLaravelModelAttributeTargetFromSource(
            content,
            attributeName,
          ) ?? phpLaravelModelAccessorTargetFromSource(content, attributeName);

          if (!target) {
            continue;
          }

          return openNavigationTarget(
            path,
            target.position,
            target.attributeName,
          );
        } catch {
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

  const goToPhpMethodCallDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "methodCall" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );
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
        return openPhpMethodHintTarget(frameworkHint);
      }

      if (resolvedVariableType) {
        const directTargetOpened = await openDirectPhpMethodTarget(
          resolvedVariableType,
          context.methodName,
        );

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
      const builderScopeMethodName =
        isLaravelFrameworkActive && builderModelType
          ? phpLaravelScopeMethodName(context.methodName)
          : null;

      if (
        builderModelType &&
        builderScopeMethodName &&
        (await openDirectPhpMethodTarget(builderModelType, builderScopeMethodName))
      ) {
        return true;
      }

      if (
        builderModelType &&
        (await openPhpLaravelDynamicWhereTarget(
          builderModelType,
          context.methodName,
        ))
      ) {
        return true;
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
    ],
  );

  const goToPhpMemberPropertyDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "memberPropertyAccess" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const position =
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 };
      const receiverType = await resolvePhpExpressionType(
        activeDocument.content,
        position,
        context.receiverExpression || `$${context.variableName}`,
      );

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

      if (
        propertyExists &&
        (await openDirectPhpMethodTarget(receiverType, context.propertyName))
      ) {
        return true;
      }

      if (
        propertyExists &&
        (await openPhpLaravelModelAttributeTarget(
          receiverType,
          context.propertyName,
        ))
      ) {
        return true;
      }

      if (
        propertyExists &&
        (await openDirectPhpPropertyTarget(receiverType, context.propertyName))
      ) {
        return true;
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
      openPhpLaravelModelAttributeTarget,
      phpClassHierarchyHasProperty,
      resolvePhpExpressionType,
    ],
  );

  const goToPhpStaticMethodCallDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "staticMethodCall" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const className = resolvePhpClassName(
        activeDocument.content,
        context.className,
      );

      if (!className) {
        return false;
      }

      if (await openDirectPhpMethodTarget(className, context.methodName)) {
        return true;
      }

      const scopeMethodName = isLaravelFrameworkActive
        ? phpLaravelScopeMethodName(context.methodName)
        : null;

      if (
        scopeMethodName &&
        (await openDirectPhpMethodTarget(className, scopeMethodName))
      ) {
        return true;
      }

      if (await openPhpLaravelDynamicWhereTarget(className, context.methodName)) {
        return true;
      }

      if (
        isLaravelFrameworkActive &&
        isLaravelEloquentBuilderMethodName(context.methodName) &&
        (await openDirectPhpMethodTarget(
          "Illuminate\\Database\\Eloquent\\Builder",
          context.methodName,
        ))
      ) {
        return true;
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
    ],
  );

  const goToPhpLaravelRelationStringDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelRelationString" }>,
    ): Promise<boolean> => {
      if (!isLaravelFrameworkActive || !activeDocument) {
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
      const receiverType =
        !receiverModelType && context.receiverExpression
          ? await resolvePhpExpressionType(
              activeDocument.content,
              position,
              context.receiverExpression,
            )
          : null;
      const relationBaseOwnerType =
        staticClassName ?? receiverModelType ?? receiverType;
      const relationOwnerType = relationBaseOwnerType
        ? await resolvePhpLaravelRelationPathOwnerType(
            relationBaseOwnerType,
            context.previousRelationNames ?? [],
          )
        : null;

      if (!relationOwnerType) {
        setMessage(`No typed target found for relation ${context.relationName}.`);
        return false;
      }

      const openedRelation = await openDirectPhpMethodTarget(
        relationOwnerType,
        context.relationName,
      );

      if (openedRelation) {
        return true;
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
    ],
  );

  const goToPhpLaravelNamedRouteDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "laravelNamedRouteString" }>,
    ): Promise<boolean> => {
      if (!activeDocument || !isLaravelFrameworkActive) {
        return false;
      }

      const routes = await collectPhpLaravelNamedRouteTargets(
        activeDocument.content,
        activeDocument.path,
      );
      const target = routes.find(
        (route) => route.name.toLowerCase() === context.routeName.toLowerCase(),
      );

      if (!target) {
        setMessage(`No Laravel route named ${context.routeName} found.`);
        return false;
      }

      return openNavigationTarget(target.path, target.position, target.name);
    },
    [
      activeDocument,
      collectPhpLaravelNamedRouteTargets,
      isLaravelFrameworkActive,
      openNavigationTarget,
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

    if (context.kind === "laravelRelationString") {
      return goToPhpLaravelRelationStringDefinition(context);
    }

    if (context.kind === "laravelNamedRouteString") {
      return goToPhpLaravelNamedRouteDefinition(context);
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

    return false;
  }, [
    activeDocument,
    goToPhpLaravelNamedRouteDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  ]);

  const implementationTargetsFromLocations = useCallback(
    async (
      locations: LanguageServerLocation[],
    ): Promise<ImplementationTarget[]> => {
      const targets = await Promise.all(
        locations.map(async (location) => {
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

          return implementationTargetFromLocation(location, source);
        }),
      );
      const uniqueTargets = new Map<string, ImplementationTarget>();

      for (const target of targets) {
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
      setImplementationChooser(null);
      await openNavigationTarget(target.path, target.position, target.label);
    },
    [openNavigationTarget],
  );

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<LanguageServerFeature, "definition" | "implementation">,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    if (!activeDocument) {
      return false;
    }

    if (!workspaceRoot || !isLanguageServerDocument(activeDocument)) {
      return false;
    }

    if (
      !isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return false;
    }

    if (
      !canUseLanguageServerFeature(
        languageServerRuntimeStatus.capabilities,
        feature,
      )
    ) {
      return false;
    }

    const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    if (feature === "implementation") {
      setImplementationChooser(null);
    }

    try {
      await flushPendingDocumentChange(activeDocument.path);
      const locations = await languageServerFeaturesGateway[feature](
        workspaceRoot,
        toLanguageServerTextDocumentPosition(activeDocument.path, editorPosition),
      );
      const symbolName = identifierAtEditorPosition(
        activeDocument.content,
        editorPosition,
      );

      if (feature === "implementation" && locations.length > 1) {
        const targets = await implementationTargetsFromLocations(locations);

        if (targets.length > 1) {
          setImplementationChooser({
            targets,
            title: implementationChooserTitle(symbolName),
          });
          return true;
        }

        const [onlyTarget] = targets;

        if (onlyTarget) {
          await openImplementationTarget(onlyTarget);
          return true;
        }
      }

      const [target] = locations;

      if (!target) {
        return false;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      recordCurrentNavigationLocation();
      const opened = await openPathForNavigation(targetPath);

      if (!opened) {
        return false;
      }

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
      reportLanguageServerError(error);
      return false;
    }
  }, [
    activeDocument,
    flushPendingDocumentChange,
    implementationTargetsFromLocations,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    openImplementationTarget,
    openPathForNavigation,
    recordCurrentNavigationLocation,
    reportLanguageServerError,
    workspaceRoot,
  ]);

  const goToJavaScriptTypeScriptLanguageServerLocation = useCallback(async (
    feature: Extract<
      LanguageServerFeature,
      "definition" | "implementation" | "sourceDefinition"
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
        const targets = await implementationTargetsFromLocations(locations);

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

          setImplementationChooser(null);
          recordCurrentNavigationLocation();
          const opened = await openPathForNavigation(onlyTarget.path);

          if (!opened) {
            return false;
          }

          if (!isRequestedJavaScriptTypeScriptSessionActive()) {
            return false;
          }

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

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage(`Could not open ${label} target.`);
        return false;
      }

      recordCurrentNavigationLocation();

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

      const opened = await openPathForNavigation(targetPath);

      if (!opened) {
        return false;
      }

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return false;
      }

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
    recordCurrentNavigationLocation,
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

        if (context.kind === "laravelRelationString") {
          return goToPhpLaravelRelationStringDefinition(context);
        }

        if (context.kind === "laravelNamedRouteString") {
          return goToPhpLaravelNamedRouteDefinition(context);
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

        if (openedClassTarget) {
          return true;
        }

        if (!shouldIndexWorkspace(intelligenceMode)) {
          setMessage("Enable Smart Index or IDE Mode to search indexed symbols.");
          return false;
        }

        const symbols = await projectSymbolSearch.searchProjectSymbols(
          workspaceRoot,
          context.name,
          25,
        );
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
        workspaceRoot,
        symbolName,
        25,
      );
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
      reportError("Go to Definition", error);
      return false;
    }
  }, [
    activeDocument,
    goToPhpClassIdentifierDefinition,
    goToPhpLaravelNamedRouteDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    intelligenceMode,
    openDirectPhpMethodTarget,
    openNavigationTarget,
    projectSymbolSearch,
    reportError,
    workspaceRoot,
  ]);

  const goToDefinition = useCallback(async () => {
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
  ]);

  const goToSourceDefinition = useCallback(async () => {
    await goToJavaScriptTypeScriptLanguageServerLocation(
      "sourceDefinition",
      "source definition",
    );
  }, [goToJavaScriptTypeScriptLanguageServerLocation]);

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
      setCallHierarchyView(null);
      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open call hierarchy target.");
        return;
      }

      await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
      );
    },
    [openNavigationTarget],
  );

  const openTypeHierarchyRow = useCallback(
    async (row: TypeHierarchyRow) => {
      setTypeHierarchyView(null);
      const path = pathFromLanguageServerUri(row.item.uri);

      if (!path) {
        setMessage("Could not open type hierarchy target.");
        return;
      }

      await openNavigationTarget(
        path,
        toEditorPosition(row.range.start),
        row.label,
      );
    },
    [openNavigationTarget],
  );

  const openCallHierarchy = useCallback(async () => {
    if (!activeDocument) {
      setMessage("Open a JavaScript or TypeScript file to show call hierarchy.");
      return;
    }

    if (
      !workspaceRoot ||
      !isJavaScriptTypeScriptLanguageServerDocument(activeDocument)
    ) {
      setMessage("Call hierarchy is available for JavaScript and TypeScript files.");
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
      setMessage("JavaScript/TypeScript service does not provide call hierarchy.");
      return;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a symbol to show call hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    const requestedSessionId =
      javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
    const isRequestedJavaScriptTypeScriptSessionActive = () =>
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
      );

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      const [item] =
        await javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy(
          requestedRoot,
          toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
        );

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No call hierarchy available for this symbol.");
        return;
      }

      const [incoming, outgoing] = await Promise.all([
        javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls(
          requestedRoot,
          item,
        ),
        javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls(
          requestedRoot,
          item,
        ),
      ]);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      setCallHierarchyView({
        incoming,
        item,
        outgoing,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      reportError("Call Hierarchy", error);
    }
  }, [
    activeDocument,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

  const openTypeHierarchy = useCallback(async () => {
    if (!activeDocument) {
      setMessage("Open a JavaScript or TypeScript file to show type hierarchy.");
      return;
    }

    if (
      !workspaceRoot ||
      !isJavaScriptTypeScriptLanguageServerDocument(activeDocument)
    ) {
      setMessage("Type hierarchy is available for JavaScript and TypeScript files.");
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

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      setMessage("Place the cursor on a type to show type hierarchy.");
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    const requestedSessionId =
      javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
    const isRequestedJavaScriptTypeScriptSessionActive = () =>
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        requestedRoot,
        requestedSessionId,
      );

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
    setFileStructureOpen(false);
    setImplementationChooser(null);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);

    try {
      await flushPendingJavaScriptTypeScriptDocumentChange(requestedPath);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      const [item] =
        await javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy(
          requestedRoot,
          toLanguageServerTextDocumentPosition(requestedPath, editorPosition),
        );

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      if (!item) {
        setMessage("No type hierarchy available for this symbol.");
        return;
      }

      const [supertypes, subtypes] = await Promise.all([
        javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes(
          requestedRoot,
          item,
        ),
        javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes(
          requestedRoot,
          item,
        ),
      ]);

      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      setTypeHierarchyView({
        item,
        subtypes,
        supertypes,
      });
      setMessage(null);
    } catch (error) {
      if (!isRequestedJavaScriptTypeScriptSessionActive()) {
        return;
      }

      reportError("Type Hierarchy", error);
    }
  }, [
    activeDocument,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    workspaceRoot,
  ]);

  const applyNavigationLocation = useCallback(
    async (location: NavigationLocation) => {
      const opened = await openPathForNavigation(location.path);

      if (!opened) {
        return;
      }

      setEditorRevealTarget(location);
    },
    [openPathForNavigation],
  );

  const navigateBackward = useCallback(async () => {
    const next = navigateBack(navigationHistory, currentNavigationLocation());

    if (!next.target) {
      return;
    }

    setNavigationHistory(next.history);
    await applyNavigationLocation(next.target);
  }, [applyNavigationLocation, currentNavigationLocation, navigationHistory]);

  const navigateForwardInHistory = useCallback(async () => {
    const next = navigateForward(navigationHistory, currentNavigationLocation());

    if (!next.target) {
      return;
    }

    setNavigationHistory(next.history);
    await applyNavigationLocation(next.target);
  }, [applyNavigationLocation, currentNavigationLocation, navigationHistory]);

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
    if (!activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    const nextName = prompter.prompt("Rename file", activeDocument.name);

    if (!nextName || nextName === activeDocument.name) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);
    const nextPath = joinWorkspacePath(parentPath, nextName);

    try {
      if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
        await applyJavaScriptTypeScriptRenameEdits(activeDocument.path, nextPath);
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await workspaceFiles.renamePath(activeDocument.path, nextPath);
      if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
        await notifyJavaScriptTypeScriptFileRenamed(activeDocument.path, nextPath);
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      await syncClosedDocument(activeDocument);
      await syncClosedJavaScriptTypeScriptDocument(activeDocument);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setDocuments((current) => {
        const currentDocument = current[activeDocument.path] ?? activeDocument;
        const renamedDocument = {
          ...currentDocument,
          language: detectLanguage(nextPath),
          name: nextName,
          path: nextPath,
        };
        const next = { ...current };
        delete next[activeDocument.path];
        next[nextPath] = renamedDocument;
        return next;
      });
      setOpenPaths((current) =>
        current.map((path) => (path === activeDocument.path ? nextPath : path)),
      );
      setActivePath(nextPath);
      await refreshDirectory(parentPath);
      setMessage(`Renamed ${activeDocument.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Rename File", error);
    }
  }, [
    activeDocument,
    applyJavaScriptTypeScriptRenameEdits,
    notifyJavaScriptTypeScriptFileRenamed,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

  const deleteActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    if (!prompter.confirm(`Delete ${activeDocument.name}?`)) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);

    try {
      await workspaceFiles.deletePath(activeDocument.path);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
        await syncClosedJavaScriptTypeScriptDocument(activeDocument);
      }
      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "deleted",
          path: activeDocument.path,
        },
      ]);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      closeDocument(activeDocument.path);
      await refreshDirectory(parentPath);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Deleted ${activeDocument.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Delete File", error);
    }
  }, [
    activeDocument,
    closeActiveSurface,
    closeDocument,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    prompter,
    refreshDirectory,
    reportErrorForActiveWorkspaceRoot,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

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
        await stopLanguageServerRuntime();
      }

      if (!workspaceDescriptor?.php) {
        return;
      }

      await refreshLanguageServerPlan(requestedRoot);
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

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundProjectRuntimes(
            nextAppSettings.runtimePolicy,
            requestedRoot,
            null,
          );
        }

        const previousMode = intelligenceModeRef.current;
        let nextMode = nextWorkspaceSettings.intelligenceMode;

        if (nextWorkspaceSettings.intelligenceMode !== previousMode) {
          const smartMode = await smartModeGateway.setMode(
            nextWorkspaceSettings.intelligenceMode,
          );
          nextMode = smartMode.mode;
        }

        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: nextMode,
        };
        const shouldRestartJavaScriptTypeScriptRuntime =
          previousWorkspaceSettings.javaScriptTypeScriptVersion !==
          resolvedWorkspaceSettings.javaScriptTypeScriptVersion;
        const shouldNotifyJavaScriptTypeScriptConfiguration =
          previousWorkspaceSettings.javaScriptTypeScriptAutoImports !==
            resolvedWorkspaceSettings.javaScriptTypeScriptAutoImports ||
          previousWorkspaceSettings.javaScriptTypeScriptCodeLens !==
            resolvedWorkspaceSettings.javaScriptTypeScriptCodeLens ||
          previousWorkspaceSettings.javaScriptTypeScriptInlayHints !==
            resolvedWorkspaceSettings.javaScriptTypeScriptInlayHints ||
          previousWorkspaceSettings.javaScriptTypeScriptValidation !==
            resolvedWorkspaceSettings.javaScriptTypeScriptValidation;

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          await stopLanguageServerRuntime();
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
          }

          if (workspaceDescriptor?.php) {
            await refreshLanguageServerPlan(requestedRoot);
          }
        }

        if (!shouldIndexWorkspace(previousMode) && shouldIndexWorkspace(nextMode)) {
          await startInitialIndexScan(requestedRoot);
        }

        if (shouldIndexWorkspace(previousMode) && !shouldIndexWorkspace(nextMode)) {
          await clearWorkspaceIndex(requestedRoot);
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

    try {
      const status = await languageServerRuntimeGateway.start(requestedRoot);
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
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    languageServerRuntimeGateway,
    reportLanguageServerError,
    workspaceRoot,
  ]);

  const stopLanguageServer = useCallback(async () => {
    await stopLanguageServerRuntime();
  }, [stopLanguageServerRuntime]);

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
          codeLensEnabled: currentSettings.javaScriptTypeScriptCodeLens,
          inlayHintsEnabled: currentSettings.javaScriptTypeScriptInlayHints,
          typeScriptVersionPreference:
            currentSettings.javaScriptTypeScriptVersion,
          validationEnabled: currentSettings.javaScriptTypeScriptValidation,
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

    if (installingManagedPhpactor) {
      return;
    }

    setInstallingManagedPhpactor(true);
    const targetWorkspaceRoot = workspaceRoot;

    try {
      await phpToolGateway.installManagedPhpactor();

      if (
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          targetWorkspaceRoot,
        )
      ) {
        return;
      }

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
    } finally {
      setInstallingManagedPhpactor(false);
    }
  }, [
    installingManagedPhpactor,
    phpToolGateway,
    refreshLanguageServerPlan,
    reportLanguageServerError,
    workspaceDescriptor,
    workspaceRoot,
  ]);

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

  const openSettingsPanel = useCallback(() => {
    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setTextSearchOpen(false);
    setLanguageServerSetupOpen(false);
    setFileStructureOpen(false);
    setCallHierarchyView(null);
    setTypeHierarchyView(null);
    setSettingsOpen(true);
  }, []);

  const closeFloatingSurface = useCallback((): boolean => {
    if (typeHierarchyView) {
      setTypeHierarchyView(null);
      return true;
    }

    if (callHierarchyView) {
      setCallHierarchyView(null);
      return true;
    }

    if (implementationChooser) {
      setImplementationChooser(null);
      return true;
    }

    if (languageServerSetupOpen) {
      setLanguageServerSetupOpen(false);
      return true;
    }

    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }

    if (fileStructureOpen) {
      setFileStructureOpen(false);
      return true;
    }

    if (textSearchOpen) {
      setTextSearchOpen(false);
      return true;
    }

    if (classOpenOpen) {
      setClassOpenOpen(false);
      return true;
    }

    if (quickOpenOpen) {
      setQuickOpenOpen(false);
      return true;
    }

    if (paletteOpen) {
      setPaletteOpen(false);
      return true;
    }

    if (selectedGitChange || gitDiffLoading) {
      closeGitDiffPreview();
      return true;
    }

    return false;
  }, [
    callHierarchyView,
    classOpenOpen,
    closeGitDiffPreview,
    fileStructureOpen,
    gitDiffLoading,
    implementationChooser,
    languageServerSetupOpen,
    paletteOpen,
    quickOpenOpen,
    selectedGitChange,
    settingsOpen,
    textSearchOpen,
    typeHierarchyView,
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
      id: "file.quickOpen",
      title: "Quick Open File",
      category: "File",
      shortcut: shortcut("file.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        setClassOpenOpen(false);
        setQuickOpenOpen(true);
      },
    });

    registry.register({
      id: "class.quickOpen",
      title: "Open Class",
      category: "PHP",
      shortcut: shortcut("class.quickOpen"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        setQuickOpenOpen(false);
        setClassOpenOpen(true);
      },
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
      id: "editor.goToSourceDefinition",
      title: "Go to Source Definition",
      category: "Editor",
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
      id: "editor.showCallHierarchy",
      title: "Show Call Hierarchy",
      category: "Editor",
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
          "callHierarchy",
        ),
      run: openCallHierarchy,
    });

    registry.register({
      id: "editor.showTypeHierarchy",
      title: "Show Type Hierarchy",
      category: "Editor",
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
          "typeHierarchy",
        ),
      run: openTypeHierarchy,
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
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: shortcut("terminal.show"),
      isEnabled: () => true,
      run: () => showBottomPanelView("terminal"),
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
    goToDefinition,
    goToImplementation,
    goToSourceDefinition,
    gitDiffLoading,
    navigateBackward,
    navigateForwardInHistory,
    openCallHierarchy,
    openFileStructure,
    openTypeHierarchy,
    openSettingsPanel,
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
    toggleSmartMode,
    toggleWorkspaceTrust,
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
    activeDocumentDirty: Boolean(activeDocument && isDirty(activeDocument)),
  };

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

    if (workspaceRootKeysEqual(autoStartedLanguageServerRootRef.current, workspaceRoot)) {
      return;
    }

    autoStartedLanguageServerRootRef.current = workspaceRoot;
    phpLanguageServerAutostartAttemptsByRootRef.current[autostartRootKey] =
      autostartAttempts + 1;
    languageServerRuntimeGateway
      .start(workspaceRoot)
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

        reportLanguageServerError(error);
        setPhpLanguageServerAutostartRetryVersion((current) => current + 1);
      });
  }, [
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    languageServerPlan,
    languageServerRuntimeGateway,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    phpLanguageServerAutostartRetryVersion,
    reportLanguageServerError,
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
          codeLensEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptCodeLens,
          inlayHintsEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptInlayHints,
          typeScriptVersionPreference:
            workspaceSettingsRef.current.javaScriptTypeScriptVersion,
          validationEnabled: workspaceSettingsRef.current
            .javaScriptTypeScriptValidation,
        })
        .then((status) => {
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
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
        .catch((error) =>
          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "JavaScript/TypeScript",
            error,
          ),
        );
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
    workspaceSettings.javaScriptTypeScriptCodeLens,
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
    setIncludedGitChangePaths((current) => {
      const validKeys = new Set(gitStatus.changes.map(gitChangeKey));
      const next = new Set<string>();

      gitStatus.changes.forEach((change) => {
        const changeKey = gitChangeKey(change);

        if (change.isStaged || current.has(changeKey)) {
          next.add(changeKey);
        }
      });

      current.forEach((changeKey) => {
        if (validKeys.has(changeKey)) {
          next.add(changeKey);
        }
      });

      if (
        next.size === current.size &&
        [...next].every((path) => current.has(path))
      ) {
        return current;
      }

      return next;
    });
  }, [gitStatus.changes]);

  useEffect(() => {
    setGitOperationLoading(false);
    setGitCommitMessage("");
    setIncludedGitChangePaths(new Set());
  }, [workspaceRoot]);

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
        if (closeFloatingSurface()) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      if (event.key === "F12") {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      if (event.metaKey && !event.altKey && !event.ctrlKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        quitApplication();
        return;
      }

      const keymap = appSettingsRef.current.keymap;
      const matches = (commandId: KeymapCommandId) =>
        matchesShortcut(event, shortcutForCommand(keymap, commandId));

      if (matches("workbench.openSettings")) {
        event.preventDefault();
        openSettingsPanel();
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

      if (matches("editor.goToDefinition")) {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      if (matches("editor.goToImplementation")) {
        event.preventDefault();
        void goToImplementation();
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

      if (matches("commands.show")) {
        event.preventDefault();
        setClassOpenOpen(false);
        setPaletteOpen(true);
        return;
      }

      if (matches("class.quickOpen")) {
        event.preventDefault();
        if (workspaceRoot) {
          setQuickOpenOpen(false);
          setClassOpenOpen(true);
        }
        return;
      }

      if (matches("file.quickOpen")) {
        event.preventDefault();
        if (workspaceRoot) {
          setClassOpenOpen(false);
          setQuickOpenOpen(true);
        }
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
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeActiveSurface,
    closeFloatingSurface,
    goToDefinition,
    goToImplementation,
    navigateBackward,
    navigateForwardInHistory,
    openFileStructure,
    openSettingsPanel,
    quitApplication,
    saveActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
    workspaceRoot,
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
      fileSearch
        .searchFiles(workspaceRoot, quickOpenQuery, 80)
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
  }, [fileSearch, quickOpenOpen, quickOpenQuery, reportError, workspaceRoot]);

  const canSearchClassOpenSymbols = Boolean(
    shouldIndexWorkspace(intelligenceMode) ||
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
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          requestedRoot,
        ) &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        searches.push(
          javaScriptTypeScriptLanguageServerFeaturesGateway
            .workspaceSymbols(requestedRoot, query)
            .then((symbols) =>
              symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    requestedRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
                ),
            )
            .catch((error) => {
              if (
                !workspaceRootKeysEqual(
                  currentWorkspaceRootRef.current,
                  requestedRoot,
                )
              ) {
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
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
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
    if (!textSearchOpen || !workspaceRoot || !textSearchQuery.trim()) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    let active = true;
    setTextSearchLoading(true);

    const timeout = window.setTimeout(() => {
      textSearch
        .searchText(workspaceRoot, textSearchQuery, 100)
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
      .catch((error) => reportLanguageServerError(error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    handleLanguageServerRuntimeStatus,
    languageServerRuntimeGateway,
    reportLanguageServerError,
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
          if (!active) {
            return;
          }

          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
          reportError("JavaScript/TypeScript", error);
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
      .catch((error) => reportError("JavaScript/TypeScript", error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportError,
    workspaceRoot,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: IndexProgressUnsubscribeFn | null = null;

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
      .catch((error) => reportError("Index", error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [handleMetadataScanCompletion, indexProgressGateway, reportError]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    languageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        applyLanguageServerDiagnostics(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => reportLanguageServerError(error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    applyLanguageServerDiagnostics,
    languageServerDiagnosticsGateway,
    reportLanguageServerError,
  ]);

  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    javaScriptTypeScriptLanguageServerDiagnosticsGateway
      .subscribeDiagnostics((event) => {
        if (!active) {
          return;
        }

        applyJavaScriptTypeScriptLanguageServerDiagnostics(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => reportError("JavaScript/TypeScript", error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [
    applyJavaScriptTypeScriptLanguageServerDiagnostics,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    reportError,
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
      .filter((document): document is EditorDocument => Boolean(document));

    if (
      activeDocument &&
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
      .filter((document): document is EditorDocument => Boolean(document));

    if (
      activeDocument &&
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
        languageServerDiagnosticsByPath,
        javaScriptTypeScriptDiagnosticsByPath,
      ),
    [javaScriptTypeScriptDiagnosticsByPath, languageServerDiagnosticsByPath],
  );

  return {
    activeDocument,
    activeDocumentGitBaseline: activeDocument
      ? editorGitBaselinesByPath[activeDocument.path] ?? null
      : null,
    activePath,
    appSettings,
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    activateWorkspaceTab,
    callHierarchyView,
    typeHierarchyView,
    classOpenLoading,
    classOpenOpen,
    classOpenQuery,
    classOpenResults,
    closeImplementationChooser: () => setImplementationChooser(null),
    closeCallHierarchy: () => setCallHierarchyView(null),
    closeTypeHierarchy: () => setTypeHierarchyView(null),
    closeDocument,
    closeGitDiffPreview,
    closeWorkspaceTab,
    commitAndPushGitChanges,
    commitGitChanges,
    commandContext,
    commands: commandRegistry.list(),
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
    goToDefinition,
    goToImplementationAt,
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
    indexHealthLogs,
    indexProgress,
    intelligenceMode,
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
    openTypeHierarchy,
    openTypeHierarchyRow,
    openGitChange,
    openFileStructure,
    openImplementationTarget,
    openProblemNotice,
    openPhpFileOutlineNode,
    openClassSearchResult,
    openPinnedFile,
    previewFile,
    previewPath,
    providePhpMethodCompletions,
    providePhpMethodSignature,
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
    clearNotices: () => setNotices([]),
    notices,
    navigateBackward,
    navigateForwardInHistory,
    reportCommandError: (error: unknown) => reportError("Command", error),
    reportLanguageServerError,
    previewGitChange,
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
    setGitCommitMessage,
    setClassOpenQuery,
    setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery,
    setSettingsOpen,
    setTextSearchOpen,
    setTextSearchQuery,
    setLanguageServerSetupOpen,
    setStatusBarItemVisibility,
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
    textSearchResults,
    toggleDirectory,
    toggleGitChangeIncluded,
    stageGitChanges,
    unstageGitChanges,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    togglePhpTreeNode,
    toggleSmartMode,
    toggleWorkspaceTrust,
    updateActiveDocument,
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

function javaScriptTypeScriptDiagnosticNoticeGroup(uri: string): string {
  return `javascript-typescript-diagnostics:${uri}`;
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

function phpClassMemberCacheKey(
  path: string,
  className: string,
  frameworkProviderSignature: string,
): string {
  return `${path}#${className.trim().replace(/^\\+/, "").toLowerCase()}#${frameworkProviderSignature}`;
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
    String.raw`@property(?:-read|-write)?\s+[^\r\n*]+?\s+\$${escapedPropertyName}\b`,
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

  if (!/\bCollection\s*</i.test(typeName)) {
    return null;
  }

  return phpDeclaredGenericTypeCandidates(typeName).find(
    (candidate) => !isGenericPhpPlaceholder(candidate),
  ) ?? null;
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
      if (completion.kind === "scope") {
        continue;
      }

      const key = `${completion.kind ?? "method"}:${completion.name.toLowerCase()}`;

      if (!completions.has(key)) {
        completions.set(key, completion);
      }
    }
  }

  return Array.from(completions.values());
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
): string[] {
  return Object.entries(edit.changes).flatMap(([uri, textEdits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
      return [];
    }

    if (!isSessionPathInWorkspace(rootPath, path)) {
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

  return {
    ...(edit.fileOperations && edit.fileOperations.length > 0
      ? { fileOperations: edit.fileOperations }
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

function gitDiffDocumentName(change: GitChangedFile): string {
  return `Diff: ${getFileName(change.relativePath)}`;
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
  const sessionPaths = openPaths.filter((path) =>
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
): LanguageServerConfigurationSettings {
  const autoImportsEnabled = settings.javaScriptTypeScriptAutoImports;
  const codeLensEnabled = settings.javaScriptTypeScriptCodeLens;
  const inlayHintsEnabled = settings.javaScriptTypeScriptInlayHints;
  const validationEnabled = settings.javaScriptTypeScriptValidation;
  const parameterNameHints = inlayHintsEnabled ? "literals" : "none";
  const preferences = {
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsForImportStatements: autoImportsEnabled,
    includeCompletionsForModuleExports: autoImportsEnabled,
    includeInlayEnumMemberValueHints: inlayHintsEnabled,
    includeInlayFunctionLikeReturnTypeHints: inlayHintsEnabled,
    includeInlayFunctionParameterTypeHints: inlayHintsEnabled,
    includeInlayParameterNameHints: parameterNameHints,
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHints: inlayHintsEnabled,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    mockorCodeLensEnabled: codeLensEnabled,
  };

  return {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
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
    validate: {
      enable: validationEnabled,
    },
    referencesCodeLens: {
      enabled: codeLensEnabled,
      showOnAllFunctions: false,
    },
    suggest: {
      autoImports: autoImportsEnabled,
      completeFunctionCalls: true,
      includeAutomaticOptionalChainCompletions: true,
      includeCompletionsForImportStatements: autoImportsEnabled,
      includeCompletionsForModuleExports: autoImportsEnabled,
    },
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
