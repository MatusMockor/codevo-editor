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
} from "./workbenchNotice";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../domain/intelligence";
import {
  emptyGitStatus,
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
  phpMethodDiagnosticKey,
  phpTraitHostMethodDiagnosticContext,
  phpTraitHostMethodDiagnosticKey,
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
  type LanguageServerFeature,
  type LanguageServerDocumentSymbol,
  type LanguageServerFeaturesGateway,
  type LanguageServerLocation,
  type LanguageServerPosition,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceFileChange,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import {
  matchesShortcut,
  shortcutForCommand,
  type KeymapCommandId,
} from "../domain/keymap";
import {
  implementationChooserTitle,
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
  isLaravelEloquentBuilderCollectionMethod,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentBuilderTerminalModelMethod,
  isLaravelEloquentModelBuilderFactoryMethod,
  isLaravelEloquentStaticBuilderMethod,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelRelationTargetClassNameFromExpression,
  phpLaravelScopeMethodName,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import { firstPhpDocTypeToken } from "../domain/phpDocTemplates";
import {
  phpAssignmentExpressionForVariableBefore,
  phpClassStringCallExpression,
  phpCurrentClassName,
  phpDeclaredTypeCandidate,
  phpLaravelContainerExpressionClassName,
  phpMethodCallExpression,
  phpMethodReturnExpressions,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
  phpDeclaredGenericTypeCandidates,
  phpDocRawTypeForVariableBefore,
  phpFunctionReturnsClassStringArgument,
  phpLaravelContainerBindingsFromSource,
} from "../domain/phpSemanticEngine";
import {
  phpClassPathCandidates,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpLaravelRequestMethodDefinition,
  phpMethodPosition,
  phpMethodPositionOrNull,
  phpNamedTypePosition,
  phpParameterTypeForVariable,
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

interface PhpClassMemberCacheEntry {
  members: PhpMethodCompletion[];
  sourceSignature: string;
}

interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
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
  const hasRestoredRef = useRef(false);
  const appSettingsRef = useRef<AppSettings>(defaultAppSettings());
  const workspaceSettingsRef = useRef<WorkspaceSettings>(
    defaultWorkspaceSettings(),
  );
  const workspaceSessionRestoredRef = useRef(false);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const openFileRequestTokenRef = useRef(0);
  const gitDiffRequestTokenRef = useRef(0);
  const editorGitBaselineRequestTokenRef = useRef(0);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
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
  const phpClassSourcePathCacheRef = useRef<Record<string, string[]>>({});
  const phpClassMemberCacheRef = useRef<Record<string, PhpClassMemberCacheEntry>>(
    {},
  );
  const phpLaravelBindingCacheRef = useRef<Record<string, string | null>>({});
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const documentsRef = useRef<Record<string, EditorDocument>>({});
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

  const activeDocument = activePath ? documents[activePath] || null : null;
  const openDocumentPaths = useMemo(
    () => visibleEditorPaths(openPaths, previewPath),
    [openPaths, previewPath],
  );
  const openDocuments = openDocumentPaths
    .map((path) => documents[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const dirtyCount = openDocuments.filter(isDirty).length;

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

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

  const applyLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
      if (
        event.rootPath &&
        currentWorkspaceRootRef.current &&
        event.rootPath !== currentWorkspaceRootRef.current
      ) {
        return;
      }

      const currentSessionId =
        languageServerRuntimeStatus?.kind === "running"
          ? languageServerRuntimeStatus.sessionId
          : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const currentVersion = documentVersionsByUriRef.current[event.uri];

      if (
        !shouldApplyLanguageServerDiagnostics(
          event,
          currentSessionId,
          currentVersion,
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
        const latestVersion = documentVersionsByUriRef.current[event.uri];

        if (
          !shouldApplyLanguageServerDiagnostics(
            event,
            currentSessionId,
            latestVersion,
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
    [languageServerRuntimeStatus, reportLanguageServerError],
  );

  const applyJavaScriptTypeScriptLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
      if (
        event.rootPath &&
        currentWorkspaceRootRef.current &&
        event.rootPath !== currentWorkspaceRootRef.current
      ) {
        return;
      }

      const currentSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "running"
          ? javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId
          : null;

      if (event.sessionId !== currentSessionId) {
        return;
      }

      const diagnosticsRootPath =
        event.rootPath ?? currentWorkspaceRootRef.current;
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
        )
      ) {
        return;
      }

      const groupKey = javaScriptTypeScriptDiagnosticNoticeGroup(event.uri);
      const diagnosticPath = pathFromLanguageServerUri(event.uri);

      if (!workspaceSettingsRef.current.javaScriptTypeScriptValidation) {
        setNotices((current) =>
          replaceWorkbenchNoticeGroup(current, groupKey, []),
        );

        if (diagnosticPath) {
          setJavaScriptTypeScriptDiagnosticsByPath((current) => {
            const next = { ...current };
            delete next[diagnosticPath];
            return next;
          });
        }

        return;
      }

      const diagnosticNotices = event.diagnostics.map((diagnostic) =>
        createWorkbenchNotice(
          languageServerDiagnosticNoticeSeverity(diagnostic.severity),
          diagnostic.source || "TypeScript",
          languageServerDiagnosticNoticeMessage(diagnostic, event.uri),
          groupKey,
        ),
      );

      setNotices((current) =>
        replaceWorkbenchNoticeGroup(current, groupKey, diagnosticNotices),
      );

      if (diagnosticPath) {
        setJavaScriptTypeScriptDiagnosticsByPath((current) => ({
          ...current,
          [diagnosticPath]: event.diagnostics,
        }));
      }
    },
    [javaScriptTypeScriptLanguageServerRuntimeStatus],
  );

  const refreshLanguageServerPlan = useCallback(
    async (rootPath: string) => {
      try {
        const plan = await languageServerGateway.planPhpLanguageServer(rootPath);
        setLanguageServerPlan(plan);
        return plan;
      } catch (error) {
        setLanguageServerPlan(null);
        reportError("Language Server", error);
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
            },
          );
        setJavaScriptTypeScriptLanguageServerPlan(plan);
        return plan;
      } catch (error) {
        setJavaScriptTypeScriptLanguageServerPlan(null);
        reportError("JavaScript/TypeScript", error);
        return null;
      }
    },
    [languageServerGateway, reportError],
  );

  const cacheJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (rootPath: string, status: LanguageServerRuntimeStatus) => {
      const rootedStatus = languageServerRuntimeStatusWithRoot(status, rootPath);
      javaScriptTypeScriptRuntimeStatusByRootRef.current[rootPath] =
        rootedStatus;

      return rootedStatus;
    },
    [],
  );

  const handleLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus) => {
      if (
        status.rootPath &&
        currentWorkspaceRootRef.current &&
        status.rootPath !== currentWorkspaceRootRef.current
      ) {
        return;
      }

      setLanguageServerRuntimeStatus(status);
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
    [clearLanguageServerDiagnostics, reportLanguageServerError],
  );

  const handleJavaScriptTypeScriptLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus) => {
      const statusRootPath = status.rootPath ?? currentWorkspaceRootRef.current;

      const rootedStatus = statusRootPath
        ? cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
            statusRootPath,
            status,
          )
        : status;

      if (
        statusRootPath &&
        currentWorkspaceRootRef.current &&
        statusRootPath !== currentWorkspaceRootRef.current
      ) {
        return;
      }

      setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
        statusRootPath ?? null,
      );
      const crash = languageServerCrashMessage(status);

      if (status.kind !== "running") {
        clearJavaScriptTypeScriptLanguageServerDiagnostics();
      }

      if (!crash) {
        return;
      }

      reportError("JavaScript/TypeScript", crash);
    },
    [
      cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      reportError,
    ],
  );

  const handleMetadataScanCompletion = useCallback(
    (event: MetadataScanCompletionEvent) => {
      if (currentWorkspaceRootRef.current !== event.rootPath) {
        return;
      }

      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        pendingIndexScanRef.current = false;
        activeIndexRootRef.current = null;
        indexProgressGateway
          .clearWorkspaceIndex(event.rootPath)
          .catch((error) => reportError("Index", error));
        return;
      }

      if (!pendingIndexScanRef.current && activeIndexRootRef.current !== event.rootPath) {
        return;
      }

      const message = indexProgressCompletionMessage(event);
      const severity = indexProgressNoticeSeverity(event);
      const groupKey = indexProgressNoticeGroup(event.rootPath);

      pendingIndexScanRef.current = false;
      activeIndexRootRef.current = event.rootPath;
      phpClassSourcePathCacheRef.current = {};
      phpClassMemberCacheRef.current = {};
      phpLaravelBindingCacheRef.current = {};
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

      try {
        const started = await indexProgressGateway.startInitialMetadataScan(
          rootPath,
        );
        activeIndexRootRef.current = started.rootPath;

        if (!pendingIndexScanRef.current) {
          return;
        }

        setIndexProgress(startIndexProgress(started));
        setIndexHealthLogs((current) =>
          prependIndexHealthLog(
            current,
            createIndexHealthLogEntry("info", rootPath, "Indexing workspace."),
          ),
        );
        setMessage("Indexing workspace.");
      } catch (error) {
        pendingIndexScanRef.current = false;
        reportError("Index", error);
      }
    },
    [indexProgressGateway, reportError],
  );

  const clearIndexWorkspaceState = useCallback(() => {
    pendingIndexScanRef.current = false;
    activeIndexRootRef.current = null;
    lastPhpFileOutlineRefreshKeyRef.current = null;
    phpClassSourcePathCacheRef.current = {};
    phpClassMemberCacheRef.current = {};
    phpLaravelBindingCacheRef.current = {};
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
        if (message) {
          setMessage(message);
        }
      } catch (error) {
        reportError("Index", error);
      }
    },
    [clearIndexWorkspaceState, indexProgressGateway, reportError],
  );

  const nextDocumentVersion = useCallback((path: string): number => {
    const next = (documentVersionsRef.current[path] || 0) + 1;
    documentVersionsRef.current[path] = next;
    documentVersionsByUriRef.current[fileUriFromPath(path)] = next;
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

  const clearDocumentChangeTimer = useCallback((path: string) => {
    const timer = documentChangeTimersRef.current[path];

    if (!timer) {
      return;
    }

    window.clearTimeout(timer);
    delete documentChangeTimersRef.current[path];
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

      if (targetRootPath === currentWorkspaceRootRef.current) {
        setLanguageServerRuntimeStatus(status);
        lastLanguageServerCrashRef.current = null;
        clearLanguageServerDiagnostics();
        resetLanguageServerDocuments();
      }

      return status;
    } catch (error) {
      reportLanguageServerError(error);
      return null;
    }
  }, [
    clearLanguageServerDiagnostics,
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
      const rootedStatus =
        cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
          targetRootPath,
          status,
        );

      if (targetRootPath === currentWorkspaceRootRef.current) {
        setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
        setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(targetRootPath);
        clearJavaScriptTypeScriptLanguageServerDiagnostics();
        resetJavaScriptTypeScriptLanguageServerDocuments();
      }

      return status;
    } catch (error) {
      reportError("JavaScript/TypeScript", error);
      return null;
    }
  }, [
    cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportError,
    resetJavaScriptTypeScriptLanguageServerDocuments,
  ]);

  const stopProjectRuntimes = useCallback(
    async (rootPath?: string) => {
      const targetRootPath = rootPath ?? currentWorkspaceRootRef.current;

      if (!targetRootPath) {
        return;
      }

      await Promise.allSettled([
        stopLanguageServerRuntime(targetRootPath),
        stopJavaScriptTypeScriptLanguageServerRuntime(targetRootPath),
        terminalGateway.stopRoot(targetRootPath),
      ]);
    },
    [
      stopJavaScriptTypeScriptLanguageServerRuntime,
      stopLanguageServerRuntime,
      terminalGateway,
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
              (rootPath) => rootPath !== activeRootPath,
            )
          : previousRootPath && previousRootPath !== activeRootPath
            ? [previousRootPath]
            : [];

      await Promise.all(rootPaths.map((rootPath) => stopProjectRuntimes(rootPath)));
    },
    [stopProjectRuntimes],
  );

  const syncOpenDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (languageServerRuntimeStatus?.kind !== "running") {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      if (syncedDocumentPathsRef.current.has(document.path)) {
        return;
      }

      const version = nextDocumentVersion(document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      syncedDocumentPathsRef.current.add(document.path);
      syncedDocumentContentRef.current[document.path] = document.content;

      try {
        await enqueueDocumentSync(document.path, () =>
          languageServerDocumentSyncGateway.didOpen(rootPath, syncedDocument),
        );
      } catch (error) {
        syncedDocumentPathsRef.current.delete(document.path);
        delete syncedDocumentContentRef.current[document.path];
        reportLanguageServerError(error);
      }
    },
    [
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      nextDocumentVersion,
      reportLanguageServerError,
    ],
  );

  const syncOpenJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running") {
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

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
          ),
        );
      } catch (error) {
        javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
        delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      nextJavaScriptTypeScriptDocumentVersion,
      reportError,
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
    javaScriptTypeScriptRuntimeStatusByRootRef.current = {};
    setWorkspaceRoot(null);
    setWorkspaceDescriptor(null);
    setWorkspaceTrust(null);
    setPhpTools(null);
    setLanguageServerPlan(null);
    setJavaScriptTypeScriptLanguageServerPlan(null);
    setLanguageServerRuntimeStatus(null);
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

      if (languageServerRuntimeStatus?.kind !== "running") {
        return;
      }

      if (!rootPath || !syncedDocumentPathsRef.current.has(document.path)) {
        return;
      }

      if (syncedDocumentContentRef.current[document.path] === document.content) {
        return;
      }

      clearDocumentChangeTimer(document.path);
      syncedDocumentContentRef.current[document.path] = document.content;

      const version = nextDocumentVersion(document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      pendingDocumentChangesRef.current[document.path] = syncedDocument;
      documentChangeTimersRef.current[document.path] = window.setTimeout(() => {
        const pendingDocument = pendingDocumentChangesRef.current[document.path];
        delete documentChangeTimersRef.current[document.path];
        delete pendingDocumentChangesRef.current[document.path];

        if (!pendingDocument) {
          return;
        }

        void enqueueDocumentSync(document.path, () =>
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
      nextDocumentVersion,
      reportLanguageServerError,
    ],
  );

  const scheduleJavaScriptTypeScriptDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running") {
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

          void enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
            javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocument,
            ),
          ).catch((error) => reportError("JavaScript/TypeScript", error));
        }, 150);
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      nextJavaScriptTypeScriptDocumentVersion,
      reportError,
    ],
  );

  const flushPendingDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const pendingDocument = pendingDocumentChangesRef.current[path];

      if (!rootPath || !pendingDocument) {
        return;
      }

      clearDocumentChangeTimer(path);
      delete pendingDocumentChangesRef.current[path];

      await enqueueDocumentSync(path, () =>
        languageServerDocumentSyncGateway.didChange(rootPath, pendingDocument),
      );
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
    ],
  );

  const flushPendingJavaScriptTypeScriptDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, path)
        : null;
      const pendingDocument = syncKey
        ? javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey]
        : null;

      if (!rootPath || !syncKey || !pendingDocument) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
        javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
          rootPath,
          pendingDocument,
        ),
      );
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    ],
  );

  const syncSavedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath || !syncedDocumentPathsRef.current.has(document.path)) {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      try {
        await flushPendingDocumentChange(document.path);
        await enqueueDocumentSync(document.path, () =>
          languageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(
              document,
              documentVersionsRef.current[document.path] || 0,
            ),
          ),
        );
      } catch (error) {
        reportLanguageServerError(error);
      }
    },
    [
      enqueueDocumentSync,
      flushPendingDocumentChange,
      languageServerDocumentSyncGateway,
      reportLanguageServerError,
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

      try {
        await flushPendingJavaScriptTypeScriptDocumentChange(document.path);
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
        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      flushPendingJavaScriptTypeScriptDocumentChange,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportError,
    ],
  );

  const syncClosedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath || !syncedDocumentPathsRef.current.has(document.path)) {
        return;
      }

      clearDocumentChangeTimer(document.path);
      syncedDocumentPathsRef.current.delete(document.path);
      delete syncedDocumentContentRef.current[document.path];
      delete pendingDocumentChangesRef.current[document.path];
      delete documentVersionsRef.current[document.path];
      delete documentVersionsByUriRef.current[fileUriFromPath(document.path)];

      try {
        await enqueueDocumentSync(document.path, () =>
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
        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportError,
    ],
  );

  const closeSyncedLanguageServerDocumentsForRoot = useCallback(
    async (rootPath: string) => {
      const syncedPaths = Array.from(syncedDocumentPathsRef.current);

      await Promise.all(
        syncedPaths.map(async (path) => {
          clearDocumentChangeTimer(path);
          syncedDocumentPathsRef.current.delete(path);
          delete syncedDocumentContentRef.current[path];
          delete pendingDocumentChangesRef.current[path];
          delete documentVersionsRef.current[path];
          delete documentVersionsByUriRef.current[fileUriFromPath(path)];

          try {
            await enqueueDocumentSync(path, () =>
              languageServerDocumentSyncGateway.didClose(rootPath, path),
            );
          } catch (error) {
            reportLanguageServerError(error);
          }
        }),
      );

      resetLanguageServerDocuments();
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
            reportError("JavaScript/TypeScript", error);
          }
        }),
      );
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportError,
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
        setEntriesByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
        if (options.clearMessage !== false) {
          setMessage(null);
        }
      } catch (error) {
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

      if (currentWorkspaceRootRef.current !== rootPath) {
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

      if (previousRootPath && previousRootPath !== path) {
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
      setLanguageServerRuntimeStatus(null);
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
      phpClassSourcePathCacheRef.current = {};
      phpClassMemberCacheRef.current = {};
      phpLaravelBindingCacheRef.current = {};
      activeIndexRootRef.current = null;
      pendingIndexScanRef.current = false;
      autoStartedLanguageServerRootRef.current = null;
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

        if (currentWorkspaceRootRef.current !== path) {
          return;
        }

        setWorkspaceTrust(trust);
      } catch (error) {
        reportError("Workspace Trust", error);
      }

      try {
        descriptor = await workspaceDetection.detectWorkspace(path);

        if (currentWorkspaceRootRef.current !== path) {
          return;
        }

        setWorkspaceDescriptor(descriptor);
      } catch (error) {
        reportError("Workspace Detection", error);
      }

      if (cachedWorkspaceState) {
        workspaceSessionRestoredRef.current = true;
      } else {
        await restoreWorkspaceSession(path, workspaceSettings.session);

        if (currentWorkspaceRootRef.current !== path) {
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

        if (currentWorkspaceRootRef.current !== path) {
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
        reportError("PHP Tools", error);
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
      if (path === workspaceRoot) {
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
      const nextTabs = workspaceTabsWithoutPath(currentTabs, path);
      const cachedWorkspaceState = workspaceStateCacheRef.current[path] ?? null;

      if (nextTabs.length === currentTabs.length) {
        return;
      }

      if (path !== workspaceRoot) {
        if (
          cachedWorkspaceState &&
          cachedWorkspaceHasDirtyDocuments(cachedWorkspaceState) &&
          !prompter.confirm("Close workspace and discard unsaved changes?")
        ) {
          return;
        }

        const nextRecentPath =
          currentSettings.recentWorkspacePath === path
            ? workspaceRoot ?? nextTabs[nextTabs.length - 1] ?? null
            : currentSettings.recentWorkspacePath;

        delete workspaceStateCacheRef.current[path];
        delete javaScriptTypeScriptRuntimeStatusByRootRef.current[path];
        await closeSyncedJavaScriptTypeScriptDocumentsForRoot(path);
        await stopProjectRuntimes(path);

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

      const currentIndex = currentTabs.indexOf(path);
      const nextPath =
        nextTabs[Math.min(currentIndex, nextTabs.length - 1)] ??
        nextTabs[nextTabs.length - 1] ??
        null;

      delete workspaceStateCacheRef.current[path];
      delete javaScriptTypeScriptRuntimeStatusByRootRef.current[path];
      await Promise.allSettled([
        closeSyncedLanguageServerDocumentsForRoot(path),
        closeSyncedJavaScriptTypeScriptDocumentsForRoot(path),
      ]);
      await stopProjectRuntimes(path);

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

  const activateDocument = useCallback(
    (path: string) => {
      if (activePath === path) {
        return;
      }

      recordCurrentNavigationLocation();
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setActivePath(path);
    },
    [activePath, recordCurrentNavigationLocation],
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

      if (currentWorkspaceRootRef.current !== requestedRoot) {
        return;
      }

      setGitStatus(status);
      setMessage(null);
    } catch (error) {
      if (currentWorkspaceRootRef.current !== requestedRoot) {
        return;
      }

      setGitStatus(emptyGitStatus(requestedRoot));
      reportError("Git", error);
    } finally {
      if (currentWorkspaceRootRef.current !== requestedRoot) {
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
          currentWorkspaceRootRef.current !== requestedRoot
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
          currentWorkspaceRootRef.current !== requestedRoot
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
          currentWorkspaceRootRef.current !== requestedRoot
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
    async (change: GitChangedFile) => {
      if (!workspaceRoot) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      gitDiffRequestTokenRef.current = requestToken;
      setSelectedGitChange(change);
      setGitDiffLoading(true);

      try {
        const diff = await gitGateway.getDiff(requestedRoot, change);

        if (
          currentWorkspaceRootRef.current !== requestedRoot ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(diff);
        setMessage(`Diff ${change.relativePath}`);
      } catch (error) {
        if (
          currentWorkspaceRootRef.current !== requestedRoot ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(null);
        reportError("Git Diff", error);
      } finally {
        if (
          currentWorkspaceRootRef.current !== requestedRoot ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffLoading(false);
      }
    },
    [gitGateway, reportError, workspaceRoot],
  );

  const closeGitDiffPreview = useCallback(() => {
    gitDiffRequestTokenRef.current += 1;
    setGitDiffLoading(false);
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    setMessage(null);
  }, []);

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

      if (currentWorkspaceRootRef.current !== requestedRoot) {
        return;
      }

      setPhpTree(tree);
      setMessage(null);
    } catch (error) {
      if (currentWorkspaceRootRef.current !== requestedRoot) {
        return;
      }

      setPhpTree(emptyPhpTree());
      reportError("PHP Tree", error);
    } finally {
      if (currentWorkspaceRootRef.current !== requestedRoot) {
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

        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        let outline = indexedOutline;

        if (indexedOutline.nodes.length === 0 && isPhpPath(path)) {
          const source = await readPhpFileOutlineSource(path);
          outline = await phpFileOutlineGateway.parsePhpFileOutline(path, source);
        }

        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: outline,
        }));
        setMessage(null);
      } catch (error) {
        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setPhpFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP File Outline", error);
      } finally {
        if (currentWorkspaceRootRef.current !== requestedRoot) {
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

      const requestedRoot = workspaceRoot;
      setLoadingJavaScriptTypeScriptFileOutlinePaths((current) =>
        new Set(current).add(path),
      );

      try {
        const symbols =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols(
            requestedRoot,
            path,
          );

        if (currentWorkspaceRootRef.current !== requestedRoot) {
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
        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setJavaScriptTypeScriptFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("JavaScript/TypeScript File Structure", error);
      } finally {
        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setLoadingJavaScriptTypeScriptFileOutlinePaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [javaScriptTypeScriptLanguageServerFeaturesGateway, reportError, workspaceRoot],
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

            if (currentWorkspaceRootRef.current !== requestedRoot) {
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

        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
      } catch (error) {
        if (currentWorkspaceRootRef.current !== requestedRoot) {
          return;
        }

        setPhpInheritedFileOutlinesByPath((current) => ({
          ...current,
          [path]: emptyPhpFileOutline(),
        }));
        reportError("PHP Inherited Structure", error);
      } finally {
        if (currentWorkspaceRootRef.current !== requestedRoot) {
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

    if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
      if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running") {
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
    (edit: LanguageServerWorkspaceEdit): string[] => {
      const editedPaths = changedOpenDocumentPathsForWorkspaceEdit(
        edit,
        documentsRef.current,
      );

      setDocuments((current) => {
        let changed = false;
        const next = { ...current };

        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          const path = pathFromLanguageServerUri(uri);

          if (!path) {
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

  const applyJavaScriptTypeScriptRenameEdits = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running" ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return;
      }

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles(
            workspaceRoot,
            oldPath,
            newPath,
          );

        if (!edit) {
          return;
        }

        const openDocumentPaths = Object.keys(documentsRef.current);
        const editedOpenPaths = applyWorkspaceEditToOpenDocuments(edit);
        const changedClosedFiles = await workspaceFiles.applyWorkspaceEdit(
          edit,
          openDocumentPaths,
        );
        const changedFiles = changedClosedFiles + editedOpenPaths.length;

        if (changedFiles > 0) {
          setMessage(`Updated ${changedFiles} import path${changedFiles === 1 ? "" : "s"}.`);
        }
      } catch (error) {
        reportError("JavaScript/TypeScript Rename", error);
      }
    },
    [
      applyWorkspaceEditToOpenDocuments,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      reportError,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running" ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles(
          workspaceRoot,
          oldPath,
          newPath,
        );
      } catch (error) {
        reportError("JavaScript/TypeScript Rename", error);
      }
    },
    [
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptWatchedFilesChanged = useCallback(
    async (changes: LanguageServerWorkspaceFileChange[]) => {
      if (
        !workspaceRoot ||
        javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running"
      ) {
        return;
      }

      const relevantChanges = changes.filter((change) =>
        isJavaScriptTypeScriptPath(change.path),
      );

      if (relevantChanges.length === 0) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
          workspaceRoot,
          relevantChanges,
        );
      } catch (error) {
        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      reportError,
      workspaceRoot,
    ],
  );

  const saveActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    try {
      await workspaceFiles.writeTextFile(
        activeDocument.path,
        activeDocument.content,
      );
      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          savedContent: activeDocument.content,
        },
      }));
      await syncSavedDocument(activeDocument);
      await syncSavedJavaScriptTypeScriptDocument(activeDocument);
      setMessage(`Saved ${activeDocument.name}`);
    } catch (error) {
      reportError("Save File", error);
    }
  }, [
    activeDocument,
    reportError,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
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

        if (shouldStartLanguageServer(nextMode)) {
          autoStartedLanguageServerRootRef.current = null;
        }

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          await stopLanguageServerRuntime();
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

      setDocuments((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setPreviewPath((current) => (current === path ? null : current));

      setOpenPaths((current) => {
        const next = current.filter((item) => item !== path);

        if (activePath === path) {
          setActivePath(
            nextActiveEditorPathAfterClose(path, current, previewPath),
          );
        }

        return next;
      });
    },
    [
      activePath,
      documents,
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

    const path = joinWorkspacePath(workspaceRoot, relativePath);

    try {
      await workspaceFiles.createTextFile(path);
      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "created",
          path,
        },
      ]);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      reportError("Create File", error);
    }
  }, [
    openFile,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    prompter,
    refreshDirectory,
    reportError,
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
    ): string | null => {
      if (phpReturnTypeIncludesLateStatic(typeName)) {
        return lateStaticClassName || null;
      }

      return resolvePhpDeclaredType(source, typeName);
    },
    [resolvePhpDeclaredType],
  );

  const resolvePhpLaravelBoundConcrete = useCallback(
    async (className: string): Promise<string | null> => {
      if (!workspaceRoot) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      const cacheKey = normalizedClassName.toLowerCase();

      if (
        Object.prototype.hasOwnProperty.call(
          phpLaravelBindingCacheRef.current,
          cacheKey,
        )
      ) {
        return phpLaravelBindingCacheRef.current[cacheKey] ?? null;
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

          for (const binding of phpLaravelContainerBindingsFromSource(content)) {
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

      phpLaravelBindingCacheRef.current[cacheKey] = concreteClassName;
      return concreteClassName;
    },
    [
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

  const readPhpClassMembersFromPath = useCallback(
    async (
      path: string,
      className: string,
    ): Promise<PhpClassMemberReadResult> => {
      const content = await readNavigationFileContent(path);
      const sourceSignature = phpSourceSignature(content);
      const cacheKey = phpClassMemberCacheKey(path, className);
      const cached = phpClassMemberCacheRef.current[cacheKey];

      if (cached?.sourceSignature === sourceSignature) {
        return {
          content,
          members: cached.members,
        };
      }

      const members = phpMethodCompletionsFromSource(content, className);
      phpClassMemberCacheRef.current[cacheKey] = {
        members,
        sourceSignature,
      };

      return {
        content,
        members,
      };
    },
    [readNavigationFileContent],
  );

  const collectPhpMethodsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberMethods = (methods: PhpMethodCompletion[]) => {
        for (const method of methods) {
          const key = `${method.kind ?? "method"}:${method.name.toLowerCase()}`;

          if (completions.has(key)) {
            continue;
          }

          completions.set(key, method);
        }
      };
      const collectMethods = async (className: string): Promise<void> => {
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
            rememberMethods(members);

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                await collectMethods(resolvedTraitName);
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                await collectMethods(resolvedMixinName);
              }
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassName(content, parentClassName)
              : null;

            if (resolvedParentClassName) {
              await collectMethods(resolvedParentClassName);
            }

            return;
          } catch {
            continue;
          }
        }
      };

      await collectMethods(className);

      const boundConcreteClassName =
        await resolvePhpLaravelBoundConcrete(className);

      if (boundConcreteClassName) {
        await collectMethods(boundConcreteClassName);
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpLaravelBoundConcrete,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
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
      const visitedKey = normalizedClassName.toLowerCase();

      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        try {
          const content = await readNavigationFileContent(path);

          if (phpMethodPositionOrNull(content, methodName)) {
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
              (await phpClassHierarchyHasMethod(
                resolvedMixinName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }
          }

          const parentClassName = phpExtendsClassName(content);
          const resolvedParentClassName = parentClassName
            ? resolvePhpClassReference(content, parentClassName)
            : null;

          if (
            resolvedParentClassName &&
            (await phpClassHierarchyHasMethod(
              resolvedParentClassName,
              methodName,
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
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpTraitHostMethodExists = useCallback(
    async (traitClassName: string, methodName: string): Promise<boolean> => {
      if (!workspaceRoot) {
        return false;
      }

      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");

      if (!normalizedTraitClassName || !methodName.trim()) {
        return false;
      }

      const results = await textSearch.searchText(
        workspaceRoot,
        shortPhpName(normalizedTraitClassName),
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
          const hostClassName = phpCurrentClassName(content);

          if (!hostClassName) {
            continue;
          }

          const usesTrait = phpTraitClassNames(content).some((traitName) => {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            return (
              resolvedTraitName?.toLowerCase() ===
              normalizedTraitClassName.toLowerCase()
            );
          });

          if (!usesTrait) {
            continue;
          }

          if (await phpClassHierarchyHasMethod(hostClassName, methodName)) {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    },
    [
      phpClassHierarchyHasMethod,
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
      const contextualExistingMethods = new Set<string>();

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
          const scopeMethodName = phpLaravelScopeMethodName(
            staticMethodContext.methodName,
          );
          const hasContextualScopeMethod =
            resolvedClassName && scopeMethodName
              ? await phpClassHierarchyHasMethod(
                  resolvedClassName,
                  scopeMethodName,
                )
              : false;

          if (hasContextualScopeMethod) {
            contextualExistingMethods.add(
              phpMethodDiagnosticKey(
                staticMethodContext.className,
                staticMethodContext.methodName,
              ),
            );
          }
        }

        const traitContext = phpTraitHostMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (!traitContext) {
          continue;
        }

        const normalizedTraitName = traitContext.traitName.replace(/^\\+/, "");
        const traitClassName = normalizedTraitName.includes("\\")
          ? normalizedTraitName
          : (resolvePhpClassReference(source, traitContext.traitName) ??
            normalizedTraitName);

        if (
          await phpTraitHostMethodExists(
            traitClassName,
            traitContext.methodName,
          )
        ) {
          contextualTraitHostMethods.add(
            phpTraitHostMethodDiagnosticKey(
              traitClassName,
              traitContext.methodName,
            ),
          );
        }
      }

      return filterPhpLanguageServerDiagnostics(source, diagnostics, {
        contextualExistingMethods,
        contextualTraitHostMethods,
        path,
      });
    },
    [
      phpClassHierarchyHasMethod,
      phpTraitHostMethodExists,
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

      const facadeTargetClassName = laravelFacadeTargetClassName(normalizedClassName);

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
          await resolvePhpLaravelBoundConcrete(normalizedClassName);

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
          phpLaravelContainerExpressionClassName(expression);

        if (constructedClassName) {
          return resolvePhpClassReference(ownerSource, constructedClassName);
        }

        const methodCall = phpMethodCallExpression(expression);

        if (methodCall) {
          const directReceiverType = phpReceiverExpressionTypeInSource(
            ownerSource,
            { column: 1, lineNumber: 1 },
            methodCall.receiverExpression,
          );
          const constructedReceiverType =
            directReceiverType ??
            phpNewExpressionClassName(methodCall.receiverExpression) ??
            phpLaravelContainerExpressionClassName(methodCall.receiverExpression);
          const resolvedReceiverType = constructedReceiverType
            ? resolvePhpClassReference(ownerSource, constructedReceiverType)
            : null;

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
            const traitReturnType = resolvedTraitName
              ? await resolvePhpMethodReturnType(
                  resolvedTraitName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                )
              : null;

            if (traitReturnType) {
              return traitReturnType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
            const mixinReturnType = resolvedMixinName
              ? await resolvePhpMethodReturnType(
                  resolvedMixinName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                )
              : null;

            if (mixinReturnType) {
              return mixinReturnType;
            }
          }

          const parentClassName = phpExtendsClassName(content);
          const resolvedParentClassName = parentClassName
            ? resolvePhpClassReference(content, parentClassName)
            : null;

          if (resolvedParentClassName) {
            const parentReturnType = await resolvePhpMethodReturnType(
              resolvedParentClassName,
              methodName,
              visitedClassNames,
              normalizedLateStaticClassName || normalizedClassName,
            );

            if (parentReturnType) {
              return parentReturnType;
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
      readPhpClassMembersFromPath,
      resolvePhpLaravelBoundConcrete,
      resolvePhpClassReference,
      resolvePhpMethodDeclaredReturnType,
      resolvePhpClassSourcePaths,
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
          const member = members.find(
            (candidate) =>
              candidate.name.toLowerCase() === propertyName.toLowerCase(),
          );
          const collectionPropertyModelType =
            member?.kind === "property" && includeCollectionRelations
              ? phpCollectionGenericModelTypeCandidate(member.returnType)
              : null;
          const resolvedCollectionPropertyModelType = collectionPropertyModelType
            ? resolvePhpClassReference(content, collectionPropertyModelType)
            : null;

          if (resolvedCollectionPropertyModelType) {
            return resolvedCollectionPropertyModelType;
          }

          const propertyType =
            member?.kind === "property"
              ? resolvePhpDeclaredType(content, member.returnType)
              : null;

          if (propertyType) {
            return propertyType;
          }

          const relationMethod =
            member && member.kind !== "property" ? member : null;
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
                ? resolvePhpClassReference(content, relationTargetClassName)
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

          const parentClassName = phpExtendsClassName(content);
          const resolvedParentClassName = parentClassName
            ? resolvePhpClassReference(content, parentClassName)
            : null;

          if (resolvedParentClassName) {
            return resolvePhpClassPropertyOrRelationType(
              resolvedParentClassName,
              propertyName,
              includeCollectionRelations,
              visitedClassNames,
            );
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

  const phpClassHasLaravelLocalScope = useCallback(
    async (className: string, scopeName: string): Promise<boolean> => {
      const scopeLookup = scopeName.toLowerCase();
      const scopeCompletions = phpLaravelLocalScopeCompletionsFromMethods(
        await collectPhpMethodsForClass(className),
      );

      return scopeCompletions.some(
        (scope) => scope.name.toLowerCase() === scopeLookup,
      );
    },
    [collectPhpMethodsForClass],
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
      if (depth > 5) {
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
          phpLaravelContainerExpressionClassName(normalizedModelExpression);

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
        const phpDocType = phpDocRawTypeForVariableBefore(
          source,
          position,
          variableMatch[1],
        );
        const phpDocGenericModelType = phpDocType
          ? phpDeclaredGenericTypeCandidates(phpDocType)
              .map((candidate) => resolvePhpClassReference(source, candidate))
              .find((candidate): candidate is string => Boolean(candidate))
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
        (isLaravelEloquentStaticBuilderMethod(staticCall.methodName) ||
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName))
      ) {
        return staticCallClassName;
      }

      return null;
    },
    [
      phpClassHasLaravelLocalScope,
      resolvePhpClassReference,
      resolvePhpMethodReturnType,
    ],
  );

  const resolvePhpLaravelCollectionModelType = useCallback(
    async (
      source: string,
      position: EditorPosition,
      expression: string,
      depth = 0,
    ): Promise<string | null> => {
      if (depth > 5) {
        return null;
      }

      const normalizedExpression = expression.trim();
      const directCollectionType = phpReceiverExpressionTypeInSource(
        source,
        position,
        normalizedExpression,
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
        const phpDocGenericModelType = phpDocType
          ? phpDeclaredGenericTypeCandidates(phpDocType)
              .map((candidate) => resolvePhpClassReference(source, candidate))
              .find((candidate): candidate is string => Boolean(candidate))
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

      return null;
    },
    [
      resolvePhpClassReference,
      resolvePhpCollectionModelTypeFromClass,
      resolvePhpEloquentBuilderModelType,
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
      if (depth > 4) {
        return null;
      }

      const directType = phpReceiverExpressionTypeInSource(
        source,
        position,
        expression,
      );

      if (directType) {
        return resolvePhpClassReference(source, directType);
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

      const constructedClassName =
        phpNewExpressionClassName(expression) ??
        phpLaravelContainerExpressionClassName(expression);

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
        if (isLaravelCollectionTerminalModelMethod(methodCall.methodName)) {
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

        if (isLaravelEloquentModelBuilderFactoryMethod(methodCall.methodName)) {
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

        if (isLaravelEloquentBuilderTerminalModelMethod(methodCall.methodName)) {
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

        if (isLaravelEloquentBuilderCollectionMethod(methodCall.methodName)) {
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

        if (isLaravelCollectionFluentMethod(methodCall.methodName)) {
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

        if (isLaravelEloquentBuilderFluentMethod(methodCall.methodName)) {
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

        const localScopeModelType = await resolvePhpEloquentBuilderModelType(
          source,
          position,
          methodCall.receiverExpression,
          depth + 1,
        );

        if (
          localScopeModelType &&
          (await phpClassHasLaravelLocalScope(
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

        return receiverType
          ? resolvePhpMethodReturnType(receiverType, methodCall.methodName)
          : null;
      }

      const staticCall = phpStaticCallExpression(expression);

      if (staticCall) {
        const className = resolvePhpClassReference(source, staticCall.className);

        if (
          className &&
          isLaravelEloquentBuilderTerminalModelMethod(staticCall.methodName)
        ) {
          return className;
        }

        if (className && isLaravelEloquentStaticBuilderMethod(staticCall.methodName)) {
          return "Illuminate\\Database\\Eloquent\\Builder";
        }

        if (
          className &&
          (await phpClassHasLaravelLocalScope(className, staticCall.methodName))
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
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelCollectionModelType,
      resolvePhpClassReference,
      resolvePhpClassPropertyOrRelationType,
      phpClassMethodReturnsClassStringArgument,
      phpClassHasLaravelLocalScope,
      resolvePhpMethodReturnType,
    ],
  );

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

      return mergePhpMethodCompletions(receiverMethods, localScopeMethods);
    },
    [
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

      const facadeTargetClassName = laravelFacadeTargetClassName(resolvedClassName);
      const methods = await collectPhpMethodsForClass(
        facadeTargetClassName ?? resolvedClassName,
      );

      if (facadeTargetClassName) {
        return methods;
      }

      return mergePhpMethodCompletions(
        methods.filter((method) => method.isStatic),
        phpLaravelStaticLocalScopeCompletionsFromMethods(methods),
      );
    },
    [collectPhpMethodsForClass, resolvePhpClassReference],
  );

  const providePhpMethodCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<PhpMethodCompletion[]> => {
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
            const position = phpMethodPositionOrNull(content, methodName);

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

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassReference(content, parentClassName)
              : null;

            if (
              resolvedParentClassName &&
              (await openMethodInClassHierarchy(resolvedParentClassName))
            ) {
              return true;
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
        await resolvePhpLaravelBoundConcrete(className);

      return boundConcreteClassName
        ? openMethodInClassHierarchy(boundConcreteClassName)
        : false;
    },
    [
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpLaravelBoundConcrete,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
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
      const frameworkHint = phpLaravelRequestMethodDefinition(
        resolvedVariableType,
        context.methodName,
      );

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

      setMessage(
        `No typed target found for ${context.receiverExpression}->${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      openDirectPhpMethodTarget,
      openPhpMethodHintTarget,
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

      const scopeMethodName = phpLaravelScopeMethodName(context.methodName);

      if (
        scopeMethodName &&
        (await openDirectPhpMethodTarget(className, scopeMethodName))
      ) {
        return true;
      }

      if (
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
    [activeDocument, openDirectPhpMethodTarget],
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

    if (context.kind === "staticMethodCall") {
      return goToPhpStaticMethodCallDefinition(context);
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

    if (languageServerRuntimeStatus?.kind !== "running") {
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
    openImplementationTarget,
    openPathForNavigation,
    recordCurrentNavigationLocation,
    reportLanguageServerError,
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
    goToLanguageServerLocation,
  ]);

  const goToImplementation = useCallback(async () => {
    await goToLanguageServerLocation("implementation", "implementation");
  }, [goToLanguageServerLocation]);

  const goToImplementationAt = useCallback(async (position: EditorPosition) => {
    await goToLanguageServerLocation(
      "implementation",
      "implementation",
      position,
    );
  }, [goToLanguageServerLocation]);

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

    const path = joinWorkspacePath(workspaceRoot, relativePath);

    try {
      await workspaceFiles.createDirectory(path);
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      setMessage(`Created ${path}`);
    } catch (error) {
      reportError("Create Folder", error);
    }
  }, [prompter, refreshDirectory, reportError, workspaceFiles, workspaceRoot]);

  const renameActiveDocument = useCallback(async () => {
    if (!activeDocument) {
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

      await workspaceFiles.renamePath(activeDocument.path, nextPath);
      if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
        await notifyJavaScriptTypeScriptFileRenamed(activeDocument.path, nextPath);
      }
      await syncClosedDocument(activeDocument);
      await syncClosedJavaScriptTypeScriptDocument(activeDocument);

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
      reportError("Rename File", error);
    }
  }, [
    activeDocument,
    applyJavaScriptTypeScriptRenameEdits,
    notifyJavaScriptTypeScriptFileRenamed,
    prompter,
    refreshDirectory,
    reportError,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
  ]);

  const deleteActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    if (!prompter.confirm(`Delete ${activeDocument.name}?`)) {
      return;
    }

    const parentPath = getParentPath(activeDocument.path);

    try {
      await workspaceFiles.deletePath(activeDocument.path);
      if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
        await syncClosedJavaScriptTypeScriptDocument(activeDocument);
      }
      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "deleted",
          path: activeDocument.path,
        },
      ]);
      closeDocument(activeDocument.path);
      await refreshDirectory(parentPath);
      setMessage(`Deleted ${activeDocument.name}`);
    } catch (error) {
      reportError("Delete File", error);
    }
  }, [
    activeDocument,
    closeActiveSurface,
    closeDocument,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
    prompter,
    refreshDirectory,
    reportError,
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
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

    try {
      const trust = await workspaceTrustGateway.setTrust(workspaceRoot, trusted);
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

      await refreshLanguageServerPlan(workspaceRoot);
    } catch (error) {
      reportError("Workspace Trust", error);
    }
  }, [
    refreshLanguageServerPlan,
    reportError,
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
      try {
        const previousAppSettings = appSettingsRef.current;
        const previousWorkspaceSettings = workspaceSettingsRef.current;
        await persistAppSettings(nextAppSettings);

        if (!workspaceRoot) {
          setMessage("Settings saved.");
          return;
        }

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundProjectRuntimes(
            nextAppSettings.runtimePolicy,
            workspaceRoot,
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
            resolvedWorkspaceSettings.javaScriptTypeScriptVersion ||
          previousWorkspaceSettings.javaScriptTypeScriptAutoImports !==
            resolvedWorkspaceSettings.javaScriptTypeScriptAutoImports ||
          previousWorkspaceSettings.javaScriptTypeScriptCodeLens !==
            resolvedWorkspaceSettings.javaScriptTypeScriptCodeLens ||
          previousWorkspaceSettings.javaScriptTypeScriptInlayHints !==
            resolvedWorkspaceSettings.javaScriptTypeScriptInlayHints;

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          await stopLanguageServerRuntime();
        }

        intelligenceModeRef.current = nextMode;
        await persistWorkspaceSettings(workspaceRoot, resolvedWorkspaceSettings);
        setIntelligenceMode(nextMode);

        if (shouldRestartJavaScriptTypeScriptRuntime) {
          autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
          await refreshJavaScriptTypeScriptLanguageServerPlan(
            workspaceRoot,
            resolvedWorkspaceSettings.javaScriptTypeScriptVersion,
          );

          if (
            isLanguageServerActive(
              javaScriptTypeScriptLanguageServerRuntimeStatus,
            ) ||
            javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "crashed"
          ) {
            await stopJavaScriptTypeScriptLanguageServerRuntime(workspaceRoot);
          }
        }

        if (nextTrusted !== null && nextTrusted !== workspaceTrust?.trusted) {
          const trust = await workspaceTrustGateway.setTrust(
            workspaceRoot,
            nextTrusted,
          );
          setWorkspaceTrust(trust);

          if (!trust.trusted) {
            await stopLanguageServerRuntime();
          }

          if (workspaceDescriptor?.php) {
            await refreshLanguageServerPlan(workspaceRoot);
          }
        }

        if (!shouldIndexWorkspace(previousMode) && shouldIndexWorkspace(nextMode)) {
          await startInitialIndexScan(workspaceRoot);
        }

        if (shouldIndexWorkspace(previousMode) && !shouldIndexWorkspace(nextMode)) {
          await clearWorkspaceIndex(workspaceRoot);
        }

        setMessage("Settings saved.");
      } catch (error) {
        reportError("Settings", error);
      }
    },
    [
      clearWorkspaceIndex,
      persistAppSettings,
      persistWorkspaceSettings,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      refreshLanguageServerPlan,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      reportError,
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

    try {
      const status = await languageServerRuntimeGateway.start(workspaceRoot);
      handleLanguageServerRuntimeStatus(status);
    } catch (error) {
      reportLanguageServerError(error);
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

    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
    await stopJavaScriptTypeScriptLanguageServerRuntime(workspaceRoot);

    const plan = await refreshJavaScriptTypeScriptLanguageServerPlan(
      workspaceRoot,
      currentSettings.javaScriptTypeScriptVersion,
    );

    if (plan?.status !== "ready") {
      setMessage(plan?.message ?? "JavaScript/TypeScript service is unavailable.");
      return;
    }

    try {
      const status =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.start(workspaceRoot, {
          autoImportsEnabled: currentSettings.javaScriptTypeScriptAutoImports,
          codeLensEnabled: currentSettings.javaScriptTypeScriptCodeLens,
          inlayHintsEnabled: currentSettings.javaScriptTypeScriptInlayHints,
          typeScriptVersionPreference:
            currentSettings.javaScriptTypeScriptVersion,
        });
      handleJavaScriptTypeScriptLanguageServerRuntimeStatus(status);
      setMessage("JavaScript/TypeScript service restarted.");
    } catch (error) {
      reportError("JavaScript/TypeScript", error);
    }
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    reportError,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceRoot,
  ]);

  const openJavaScriptTypeScriptServiceLog = useCallback(async () => {
    if (!workspaceRoot) {
      setMessage("Open a workspace before opening the JavaScript/TypeScript service log.");
      return;
    }

    try {
      const logPath =
        await javaScriptTypeScriptLanguageServerRuntimeGateway.openLog(
          workspaceRoot,
        );

      setMessage(
        logPath
          ? `Opened JavaScript/TypeScript service log: ${logPath}`
          : "JavaScript/TypeScript service log is unavailable in this runtime.",
      );
    } catch (error) {
      reportError("JavaScript/TypeScript", error);
    }
  }, [
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    reportError,
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

      if (currentWorkspaceRootRef.current !== targetWorkspaceRoot) {
        return;
      }

      const tools = await phpToolGateway.detectPhpTools(targetWorkspaceRoot);

      if (currentWorkspaceRootRef.current !== targetWorkspaceRoot) {
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
      setLanguageServerSetupOpen(false);
      setMessage("Installed managed PHP IDE engine.");
    } catch (error) {
      reportLanguageServerError(error);
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

    pendingIndexScanRef.current = true;

    try {
      const started = await indexProgressGateway.startReindex(
        workspaceRoot,
        mode,
        language,
      );
      activeIndexRootRef.current = started.rootPath;

      if (!pendingIndexScanRef.current) {
        return;
      }

      setIndexProgress(startIndexProgress(started));
      const message = reindexStartMessage(mode);
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(
          current,
          createIndexHealthLogEntry("info", workspaceRoot, message),
        ),
      );
      setMessage(message);
    } catch (error) {
      pendingIndexScanRef.current = false;
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
    setSettingsOpen(true);
  }, []);

  const closeFloatingSurface = useCallback((): boolean => {
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
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: shortcut("editor.goToImplementation"),
      isEnabled: () =>
        Boolean(activeDocument) &&
        languageServerRuntimeStatus?.kind === "running" &&
        canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "implementation",
        ),
      run: goToImplementation,
    });

    registry.register({
      id: "editor.fileStructure",
      title: "File Structure",
      category: "Editor",
      shortcut: shortcut("editor.fileStructure"),
      isEnabled: () =>
        Boolean(activeDocument) &&
        Boolean(activeDocument && isLanguageServerDocument(activeDocument)),
      run: openFileStructure,
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
        !isLanguageServerActive(languageServerRuntimeStatus),
      run: startLanguageServer,
    });

    registry.register({
      id: "smart.stopLanguageServer",
      title: "Stop PHP Language Server",
      category: "Intelligence",
      isEnabled: () => isLanguageServerActive(languageServerRuntimeStatus),
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
    gitDiffLoading,
    navigateBackward,
    navigateForwardInHistory,
    openFileStructure,
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
    languageServerPlan,
    languageServerRuntimeStatus,
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

    if (isLanguageServerActive(languageServerRuntimeStatus)) {
      return;
    }

    if (languageServerRuntimeStatus?.kind === "crashed") {
      return;
    }

    if (autoStartedLanguageServerRootRef.current === workspaceRoot) {
      return;
    }

    autoStartedLanguageServerRootRef.current = workspaceRoot;
    languageServerRuntimeGateway
      .start(workspaceRoot)
      .then(handleLanguageServerRuntimeStatus)
      .catch(reportLanguageServerError);
  }, [
    handleLanguageServerRuntimeStatus,
    intelligenceMode,
    languageServerPlan,
    languageServerRuntimeGateway,
    languageServerRuntimeStatus,
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

    if (javaScriptTypeScriptLanguageServerPlan?.status !== "ready") {
      return;
    }

    if (javaScriptTypeScriptLanguageServerRuntimeStatusRoot !== workspaceRoot) {
      return;
    }

    if (isLanguageServerActive(javaScriptTypeScriptLanguageServerRuntimeStatus)) {
      return;
    }

    if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "crashed") {
      return;
    }

    if (
      autoStartedJavaScriptTypeScriptLanguageServerRootRef.current ===
      workspaceRoot
    ) {
      return;
    }

    autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = workspaceRoot;
    javaScriptTypeScriptLanguageServerRuntimeGateway
      .start(workspaceRoot, {
        autoImportsEnabled: workspaceSettings.javaScriptTypeScriptAutoImports,
        codeLensEnabled: workspaceSettings.javaScriptTypeScriptCodeLens,
        inlayHintsEnabled: workspaceSettings.javaScriptTypeScriptInlayHints,
        typeScriptVersionPreference:
          workspaceSettings.javaScriptTypeScriptVersion,
      })
      .then(handleJavaScriptTypeScriptLanguageServerRuntimeStatus)
      .catch((error) => reportError("JavaScript/TypeScript", error));
  }, [
    handleJavaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    reportError,
    workspaceSettings.javaScriptTypeScriptAutoImports,
    workspaceSettings.javaScriptTypeScriptCodeLens,
    workspaceSettings.javaScriptTypeScriptInlayHints,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceSettings.javaScriptTypeScriptVersion,
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
      isLanguageServerActive(javaScriptTypeScriptLanguageServerRuntimeStatus) ||
      javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "crashed"
    ) {
      void stopJavaScriptTypeScriptLanguageServerRuntime(workspaceRoot);
      return;
    }

    clearJavaScriptTypeScriptLanguageServerDiagnostics();
    resetJavaScriptTypeScriptLanguageServerDocuments();
  }, [
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    stopJavaScriptTypeScriptLanguageServerRuntime,
    workspaceSettings.javaScriptTypeScriptService,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (workspaceSettings.javaScriptTypeScriptValidation) {
      return;
    }

    clearJavaScriptTypeScriptLanguageServerDiagnostics();
  }, [
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    workspaceSettings.javaScriptTypeScriptValidation,
  ]);

  useEffect(() => {
    if (sidebarView !== "php") {
      return;
    }

    if (indexProgress.rootPath && indexProgress.rootPath !== workspaceRoot) {
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

    if (indexProgress.rootPath && indexProgress.rootPath !== workspaceRoot) {
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

    void persistWorkspaceSettings(workspaceRoot, {
      ...workspaceSettingsRef.current,
      session,
    }).catch((error) => reportError("Session", error));
  }, [
    activePath,
    bottomPanelView,
    openPaths,
    persistWorkspaceSettings,
    reportError,
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
      (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "running" &&
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

      const searches: Array<Promise<ProjectSymbolSearchResult[]>> = [];

      if (shouldIndexWorkspace(intelligenceMode)) {
        searches.push(
          projectSymbolSearch.searchProjectSymbols(workspaceRoot, query, limit),
        );
      }

      if (
        javaScriptTypeScriptLanguageServerRuntimeStatus?.kind === "running" &&
        canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "workspaceSymbol",
        )
      ) {
        searches.push(
          javaScriptTypeScriptLanguageServerFeaturesGateway
            .workspaceSymbols(workspaceRoot, query)
            .then((symbols) =>
              symbols
                .map((symbol) =>
                  projectSymbolFromLanguageServerWorkspaceSymbol(
                    workspaceRoot,
                    symbol,
                  ),
                )
                .filter(
                  (symbol): symbol is ProjectSymbolSearchResult =>
                    symbol !== null,
                ),
            )
            .catch((error) => {
              reportError("JavaScript/TypeScript Workspace Symbols", error);
              return [];
            }),
        );
      }

      const results = (await Promise.all(searches)).flat();
      return uniqueProjectSymbols(results).slice(0, limit);
    },
    [
      intelligenceMode,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
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
      languageServerRuntimeGateway
        .getStatus(workspaceRoot)
        .then((status) => {
          if (!active) {
            return;
          }

          setLanguageServerRuntimeStatus(status);
        })
        .catch((error) => reportError("Language Server", error));
    } else {
      setLanguageServerRuntimeStatus(null);
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
      const cachedStatus =
        javaScriptTypeScriptRuntimeStatusByRootRef.current[workspaceRoot] ?? null;

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

          const rootedStatus =
            cacheJavaScriptTypeScriptLanguageServerRuntimeStatus(
              workspaceRoot,
              status,
            );

          setJavaScriptTypeScriptLanguageServerRuntimeStatus(rootedStatus);
          setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(workspaceRoot);
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
    cacheJavaScriptTypeScriptLanguageServerRuntimeStatus,
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
    if (languageServerRuntimeStatus?.kind !== "running") {
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
    openDocumentPaths,
    resetLanguageServerDocuments,
    syncOpenDocument,
  ]);

  useEffect(() => {
    if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running") {
      resetJavaScriptTypeScriptLanguageServerDocuments();
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
      void syncOpenJavaScriptTypeScriptDocument(document);
    });
  }, [
    activeDocument,
    documents,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    openDocumentPaths,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    syncOpenJavaScriptTypeScriptDocument,
  ]);

  useEffect(() => {
    if (languageServerRuntimeStatus?.kind !== "running") {
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
    openDocumentPaths,
    scheduleDocumentChange,
  ]);

  useEffect(() => {
    if (javaScriptTypeScriptLanguageServerRuntimeStatus?.kind !== "running") {
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
    openDocumentPaths,
    scheduleJavaScriptTypeScriptDocumentChange,
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
    activateWorkspaceTab,
    classOpenLoading,
    classOpenOpen,
    classOpenQuery,
    classOpenResults,
    closeImplementationChooser: () => setImplementationChooser(null),
    closeDocument,
    closeGitDiffPreview,
    closeWorkspaceTab,
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
    gitLoading,
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
    openFileStructure,
    openImplementationTarget,
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
    revertActiveEditorChangeHunk,
    saveActiveDocument,
    saveWorkbenchSettings,
    setActivePath: activateDocument,
    hideBottomPanel,
    showBottomPanelView,
    setPaletteOpen,
    setClassOpenOpen,
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

function phpClassMemberCacheKey(path: string, className: string): string {
  return `${path}#${className.trim().replace(/^\\+/, "").toLowerCase()}`;
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

  const [relatedModelType] = phpDeclaredGenericTypeCandidates(returnType);

  return relatedModelType ? resolvePhpClassName(source, relatedModelType) : null;
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
  for (const match of source.matchAll(/@(?:extends|implements)\s+([^\r\n*]+)/g)) {
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
): string[] {
  return Object.entries(edit.changes).flatMap(([uri, textEdits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
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

function isJavaScriptTypeScriptPath(path: string): boolean {
  const language = detectLanguage(path);

  return language === "javascript" || language === "typescript";
}

function languageServerRuntimeStatusWithRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (status.rootPath === rootPath) {
    return status;
  }

  return {
    ...status,
    rootPath,
  };
}

function cachedWorkspaceHasDirtyDocuments(
  cached: CachedWorkspaceWorkbenchState,
): boolean {
  return Object.values(cached.documents).some(isDirty);
}

function workspaceTabsWithPath(tabs: string[], path: string): string[] {
  if (tabs.includes(path)) {
    return tabs;
  }

  return [...tabs, path];
}

function workspaceTabsWithoutPath(tabs: string[], path: string): string[] {
  return tabs.filter((tabPath) => tabPath !== path);
}
