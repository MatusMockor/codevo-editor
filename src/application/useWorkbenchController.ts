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
  createLanguageServerTextDocument,
  fileUriFromPath,
  isLanguageServerDocument,
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
  type LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
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
  phpMethodCompletionsFromSource,
  phpMethodParameters,
  phpMethodSignatureContextAt,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
  type PhpMethodCompletion,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import {
  phpAssignmentExpressionForVariableBefore,
  phpCurrentClassName,
  phpDeclaredTypeCandidate,
  phpLaravelContainerExpressionClassName,
  phpMethodCallExpression,
  phpMethodReturnExpressions,
  phpNewExpressionClassName,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
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
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSessionState,
  type WorkspaceSettings,
} from "../domain/settings";
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
  const [languageServerSetupOpen, setLanguageServerSetupOpen] = useState(false);
  const [languageServerRuntimeStatus, setLanguageServerRuntimeStatus] =
    useState<LanguageServerRuntimeStatus | null>(null);
  const [languageServerDiagnosticsByPath, setLanguageServerDiagnosticsByPath] =
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
  const [gitLoading, setGitLoading] = useState(false);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [selectedGitChange, setSelectedGitChange] =
    useState<GitChangedFile | null>(null);
  const [gitDiffPreview, setGitDiffPreview] = useState<GitFileDiff | null>(
    null,
  );
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
  const [navigationHistory, setNavigationHistory] =
    useState<NavigationHistory>(createNavigationHistory);
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, FileEntry[]>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set(),
  );
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
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
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
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const lastPhpFileOutlineRefreshKeyRef = useRef<string | null>(null);

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

  const applyLanguageServerDiagnostics = useCallback(
    (event: LanguageServerDiagnosticEvent) => {
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
      const diagnosticNotices = event.diagnostics.map((diagnostic) =>
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
          [diagnosticPath]: event.diagnostics,
        }));
      }
    },
    [languageServerRuntimeStatus],
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

  const handleLanguageServerRuntimeStatus = useCallback(
    (status: LanguageServerRuntimeStatus) => {
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

  const clearDocumentChangeTimer = useCallback((path: string) => {
    const timer = documentChangeTimersRef.current[path];

    if (!timer) {
      return;
    }

    window.clearTimeout(timer);
    delete documentChangeTimersRef.current[path];
  }, []);

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

  const resetLanguageServerDocuments = useCallback(() => {
    Object.keys(documentChangeTimersRef.current).forEach(clearDocumentChangeTimer);
    syncedDocumentPathsRef.current.clear();
    syncedDocumentContentRef.current = {};
    pendingDocumentChangesRef.current = {};
    documentVersionsRef.current = {};
    documentVersionsByUriRef.current = {};
    documentSyncQueuesRef.current = {};
  }, [clearDocumentChangeTimer]);

  const stopLanguageServerRuntime = useCallback(async () => {
    try {
      const status = await languageServerRuntimeGateway.stop();
      setLanguageServerRuntimeStatus(status);
      lastLanguageServerCrashRef.current = null;
      clearLanguageServerDiagnostics();
      resetLanguageServerDocuments();
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

  const syncOpenDocument = useCallback(
    async (document: EditorDocument) => {
      if (languageServerRuntimeStatus?.kind !== "running") {
        return;
      }

      if (!isLanguageServerDocument(document)) {
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
          languageServerDocumentSyncGateway.didOpen(syncedDocument),
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

  const scheduleDocumentChange = useCallback(
    (document: EditorDocument) => {
      if (languageServerRuntimeStatus?.kind !== "running") {
        return;
      }

      if (!syncedDocumentPathsRef.current.has(document.path)) {
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
          languageServerDocumentSyncGateway.didChange(pendingDocument),
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

  const flushPendingDocumentChange = useCallback(
    async (path: string) => {
      const pendingDocument = pendingDocumentChangesRef.current[path];

      if (!pendingDocument) {
        return;
      }

      clearDocumentChangeTimer(path);
      delete pendingDocumentChangesRef.current[path];

      await enqueueDocumentSync(path, () =>
        languageServerDocumentSyncGateway.didChange(pendingDocument),
      );
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      languageServerDocumentSyncGateway,
    ],
  );

  const syncSavedDocument = useCallback(
    async (document: EditorDocument) => {
      if (!syncedDocumentPathsRef.current.has(document.path)) {
        return;
      }

      if (!isLanguageServerDocument(document)) {
        return;
      }

      try {
        await flushPendingDocumentChange(document.path);
        await enqueueDocumentSync(document.path, () =>
          languageServerDocumentSyncGateway.didSave(
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

  const syncClosedDocument = useCallback(
    async (document: EditorDocument) => {
      if (!syncedDocumentPathsRef.current.has(document.path)) {
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
          languageServerDocumentSyncGateway.didClose(document.path),
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

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoadingDirectories((current) => new Set(current).add(path));

      try {
        const entries = await workspaceFiles.readDirectory(path);
        setEntriesByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
        setMessage(null);
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
      await stopLanguageServerRuntime();
      workspaceSessionRestoredRef.current = false;
      let workspaceSettings = defaultWorkspaceSettings();

      try {
        workspaceSettings = await settingsGateway.loadWorkspaceSettings(path);
      } catch (error) {
        reportError("Settings", error);
      }

      setWorkspaceRoot(path);
      currentWorkspaceRootRef.current = path;
      setEntriesByDirectory({});
      setExpandedDirectories(new Set([path]));
      setDocuments({});
      setOpenPaths([]);
      setActivePath(null);
      setPreviewPath(null);
      setNavigationHistory(createNavigationHistory());
      setSidebarView("files");
      setBottomPanelView("problems");
      applyWorkspaceSettings(workspaceSettings);
      setIntelligenceMode(workspaceSettings.intelligenceMode);
      setWorkspaceDescriptor(null);
      setPhpTools(null);
      setWorkspaceTrust(null);
      setLanguageServerPlan(null);
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
      activeIndexRootRef.current = null;
      pendingIndexScanRef.current = false;
      autoStartedLanguageServerRootRef.current = null;

      try {
        await persistAppSettings({
          ...appSettingsRef.current,
          recentWorkspacePath: path,
        });
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

      await loadDirectory(path);
      await restoreWorkspaceSession(path, workspaceSettings.session);
      workspaceSessionRestoredRef.current = true;

      if (shouldIndexWorkspace(resolvedIntelligenceMode)) {
        void startInitialIndexScan(path);
      }

      try {
        const trust = await workspaceTrustGateway.getTrust(path);
        setWorkspaceTrust(trust);
        const descriptor = await workspaceDetection.detectWorkspace(path);
        setWorkspaceDescriptor(descriptor);

        if (!descriptor.php) {
          setLanguageServerPlan(null);
          return;
        }

        const tools = await phpToolGateway.detectPhpTools(path);
        setPhpTools(tools);
        await refreshLanguageServerPlan(path);
      } catch (error) {
        reportError("Workspace Detection", error);
      }
    },
    [
      applyWorkspaceSettings,
      loadDirectory,
      persistAppSettings,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportError,
      restoreWorkspaceSession,
      settingsGateway,
      smartModeGateway,
      startInitialIndexScan,
      stopLanguageServerRuntime,
      workspaceDetection,
      workspaceTrustGateway,
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

      if (isExpanded || entriesByDirectory[path]) {
        return;
      }

      await loadDirectory(path);
    },
    [entriesByDirectory, expandedDirectories, loadDirectory],
  );

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
      setMessage("Open a PHP file to show file structure.");
      return;
    }

    if (!isLanguageServerDocument(activeDocument)) {
      setMessage("File structure is available for PHP files.");
      return;
    }

    setPaletteOpen(false);
    setQuickOpenOpen(false);
    setClassOpenOpen(false);
    setTextSearchOpen(false);
    setSettingsOpen(false);
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
    loadPhpFileOutline,
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
      setMessage(`Saved ${activeDocument.name}`);
    } catch (error) {
      reportError("Save File", error);
    }
  }, [activeDocument, reportError, syncSavedDocument, workspaceFiles]);

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

  const setAutoSave = useCallback(
    async (autoSave: boolean) => {
      if (!workspaceRoot) {
        return;
      }

      try {
        await persistWorkspaceSettings(workspaceRoot, {
          ...workspaceSettingsRef.current,
          autoSave,
          autoSaveConfigured: true,
        });
        setMessage(autoSave ? "Auto Save enabled." : "Auto Save disabled.");
      } catch (error) {
        reportError("Auto Save", error);
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
    [activePath, documents, previewPath, prompter, syncClosedDocument],
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
      const parentPath = getParentPath(path);
      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      await openFile({ kind: "file", name: getFileName(path), path });
    } catch (error) {
      reportError("Create File", error);
    }
  }, [
    openFile,
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
      const normalizedClassName = className.trim().replace(/^\\+/, "");

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

      return resolvePhpClassName(source, normalizedClassName);
    },
    [],
  );

  const resolvePhpDeclaredType = useCallback(
    (source: string, typeName: string | null): string | null => {
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;
      return candidate ? resolvePhpClassReference(source, candidate) : null;
    },
    [resolvePhpClassReference],
  );

  const collectPhpMethodsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return [];
      }

      const phpDescriptor = workspaceDescriptor.php;
      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberMethods = (methods: PhpMethodCompletion[]) => {
        for (const method of methods) {
          const key = method.name.toLowerCase();

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

        for (const path of phpClassPathCandidates(
          workspaceRoot,
          phpDescriptor,
          normalizedClassName,
        )) {
          try {
            const content = await readNavigationFileContent(path);
            rememberMethods(
              phpMethodCompletionsFromSource(content, normalizedClassName),
            );

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                await collectMethods(resolvedTraitName);
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

      return Array.from(completions.values());
    },
    [
      readNavigationFileContent,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpMethodReturnType = useCallback(
    async (
      className: string,
      methodName: string,
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

      const facadeTargetClassName = laravelFacadeTargetClassName(normalizedClassName);

      if (facadeTargetClassName) {
        return resolvePhpMethodReturnType(
          facadeTargetClassName,
          methodName,
          visitedClassNames,
        );
      }

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

      for (const path of phpClassPathCandidates(
        workspaceRoot,
        workspaceDescriptor.php,
        normalizedClassName,
      )) {
        try {
          const content = await readNavigationFileContent(path);
          const method = phpMethodCompletionsFromSource(
            content,
            normalizedClassName,
          ).find(
            (candidate) =>
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const returnType = resolvePhpDeclaredType(content, method?.returnType ?? null);

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
                )
              : null;

            if (traitReturnType) {
              return traitReturnType;
            }
          }

          const parentClassName = phpExtendsClassName(content);
          const resolvedParentClassName = parentClassName
            ? resolvePhpClassReference(content, parentClassName)
            : null;

          if (resolvedParentClassName) {
            return resolvePhpMethodReturnType(
              resolvedParentClassName,
              methodName,
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
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpDeclaredType,
      workspaceDescriptor,
      workspaceRoot,
    ],
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

      const methodCall = phpMethodCallExpression(expression);

      if (methodCall) {
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

        return className
          ? resolvePhpMethodReturnType(className, staticCall.methodName)
          : null;
      }

      return null;
    },
    [
      resolvePhpClassReference,
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

      return resolvedReceiverType
        ? collectPhpMethodsForClass(resolvedReceiverType)
        : [];
    },
    [collectPhpMethodsForClass, resolvePhpExpressionType],
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

      return facadeTargetClassName
        ? methods
        : methods.filter((method) => method.isStatic);
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
    [resolvePhpReceiverMethodCompletions],
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

      for (const path of phpClassPathCandidates(
        workspaceRoot,
        workspaceDescriptor.php,
        className,
      )) {
        try {
          const content = await readNavigationFileContent(path);
          const position = phpMethodPositionOrNull(content, methodName);

          if (!position) {
            continue;
          }

          return openNavigationTarget(path, position, `${methodName}()`);
        } catch {
          continue;
        }
      }

      return false;
    },
    [
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
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
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  ]);

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<LanguageServerFeature, "definition" | "implementation">,
    label: string,
    requestedPosition?: EditorPosition,
  ): Promise<boolean> => {
    if (!activeDocument) {
      return false;
    }

    if (!isLanguageServerDocument(activeDocument)) {
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

    try {
      await flushPendingDocumentChange(activeDocument.path);
      const locations = await languageServerFeaturesGateway[feature](
        toLanguageServerTextDocumentPosition(activeDocument.path, editorPosition),
      );
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
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    openPathForNavigation,
    recordCurrentNavigationLocation,
    reportLanguageServerError,
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
      await workspaceFiles.renamePath(activeDocument.path, nextPath);
      await syncClosedDocument(activeDocument);
      const renamedDocument = {
        ...activeDocument,
        language: detectLanguage(nextPath),
        name: nextName,
        path: nextPath,
      };

      setDocuments((current) => {
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
    prompter,
    refreshDirectory,
    reportError,
    syncClosedDocument,
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
    prompter,
    refreshDirectory,
    reportError,
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
        await persistAppSettings(nextAppSettings);

        if (!workspaceRoot) {
          setSettingsOpen(false);
          setMessage("Settings saved.");
          return;
        }

        const previousMode = intelligenceMode;
        const smartMode = await smartModeGateway.setMode(
          nextWorkspaceSettings.intelligenceMode,
        );
        const nextMode = smartMode.mode;
        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: nextMode,
        };

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          await stopLanguageServerRuntime();
        }

        intelligenceModeRef.current = nextMode;
        await persistWorkspaceSettings(workspaceRoot, resolvedWorkspaceSettings);
        setIntelligenceMode(nextMode);

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

        setSettingsOpen(false);
        setMessage("Settings saved.");
      } catch (error) {
        reportError("Settings", error);
      }
    },
    [
      clearWorkspaceIndex,
      intelligenceMode,
      persistAppSettings,
      persistWorkspaceSettings,
      refreshLanguageServerPlan,
      reportError,
      smartModeGateway,
      startInitialIndexScan,
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

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();

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
      shortcut: "Cmd+P",
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
      shortcut: "Cmd+O",
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
      shortcut: "Cmd+Shift+F",
      isEnabled: (context) => context.hasWorkspace,
      run: () => setTextSearchOpen(true),
    });

    registry.register({
      id: "navigation.back",
      title: "Go Back",
      category: "Navigation",
      shortcut: "Cmd+[",
      isEnabled: () => navigationHistory.backStack.length > 0,
      run: navigateBackward,
    });

    registry.register({
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: "Cmd+]",
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
      shortcut: "Cmd+S",
      isEnabled: (context) =>
        context.hasActiveDocument && context.activeDocumentDirty,
      run: saveActiveDocument,
    });

    registry.register({
      id: "editor.closeTab",
      title: "Close",
      category: "Editor",
      shortcut: "Cmd+W",
      isEnabled: () =>
        Boolean(activeDocument || selectedGitChange || gitDiffLoading || isTauri()),
      run: closeActiveSurface,
    });

    registry.register({
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: "Cmd+B",
      isEnabled: () => Boolean(activeDocument),
      run: goToDefinition,
    });

    registry.register({
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: "Cmd+Alt+B",
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
      shortcut: "Cmd+R",
      isEnabled: () =>
        Boolean(activeDocument) &&
        Boolean(activeDocument && isLanguageServerDocument(activeDocument)),
      run: openFileStructure,
    });

    registry.register({
      id: "commands.show",
      title: "Show Commands",
      category: "Workbench",
      shortcut: "Cmd+K",
      isEnabled: () => true,
      run: () => setPaletteOpen(true),
    });

    registry.register({
      id: "workbench.openSettings",
      title: "Open Settings",
      category: "Workbench",
      shortcut: "Cmd+,",
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
      shortcut: "Cmd+J",
      isEnabled: () => true,
      run: toggleBottomPanel,
    });

    registry.register({
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: "Ctrl+`",
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
    stopLanguageServer,
    toggleBottomPanel,
    toggleSmartMode,
    toggleWorkspaceTrust,
    indexProgress,
    intelligenceMode,
    languageServerPlan,
    languageServerRuntimeStatus,
    selectedGitChange,
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
      if (event.key === "F12") {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      const primaryModifier = event.metaKey || event.ctrlKey;

      if (!primaryModifier) {
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        openSettingsPanel();
        return;
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDocument();
        return;
      }

      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeActiveSurface();
        return;
      }

      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        quitApplication();
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        openFileStructure();
        return;
      }

      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleBottomPanel();
        return;
      }

      if (!event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        void goToDefinition();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        void goToImplementation();
        return;
      }

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        void navigateBackward();
        return;
      }

      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        void navigateForwardInHistory();
        return;
      }

      if (!event.altKey && event.key === "[") {
        event.preventDefault();
        void navigateBackward();
        return;
      }

      if (!event.altKey && event.key === "]") {
        event.preventDefault();
        void navigateForwardInHistory();
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setClassOpenOpen(false);
        setPaletteOpen(true);
        return;
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (workspaceRoot) {
          setQuickOpenOpen(false);
          setClassOpenOpen(true);
        }
        return;
      }

      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (workspaceRoot) {
          setClassOpenOpen(false);
          setQuickOpenOpen(true);
        }
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (workspaceRoot) {
          setTextSearchOpen(true);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeActiveSurface,
    goToDefinition,
    goToImplementation,
    navigateBackward,
    navigateForwardInHistory,
    openFileStructure,
    openSettingsPanel,
    quitApplication,
    saveActiveDocument,
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

        if (!settings.recentWorkspacePath) {
          return;
        }

        if (!active) {
          return;
        }

        void openWorkspacePath(settings.recentWorkspacePath);
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

  useEffect(() => {
    if (
      !classOpenOpen ||
      !workspaceRoot ||
      !classOpenQuery.trim() ||
      !shouldIndexWorkspace(intelligenceMode)
    ) {
      setClassOpenResults([]);
      setClassOpenLoading(false);
      return;
    }

    let active = true;
    setClassOpenLoading(true);

    const timeout = window.setTimeout(() => {
      projectSymbolSearch
        .searchProjectSymbols(workspaceRoot, classOpenQuery, 120)
        .then((results) => {
          if (!active) {
            return;
          }

          setClassOpenResults(
            results.filter((result) => result.kind === "class").slice(0, 80),
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
    intelligenceMode,
    projectSymbolSearch,
    reportError,
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

    languageServerRuntimeGateway
      .getStatus()
      .then((status) => {
        if (!active) {
          return;
        }

        setLanguageServerRuntimeStatus(status);
      })
      .catch((error) => reportError("Language Server", error));

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
    if (languageServerRuntimeStatus?.kind !== "running") {
      resetLanguageServerDocuments();
      return;
    }

    openDocumentPaths.forEach((path) => {
      const document = documents[path];

      if (!document) {
        return;
      }

      void syncOpenDocument(document);
    });
  }, [
    documents,
    languageServerRuntimeStatus,
    openDocumentPaths,
    resetLanguageServerDocuments,
    syncOpenDocument,
  ]);

  useEffect(() => {
    if (languageServerRuntimeStatus?.kind !== "running") {
      return;
    }

    openDocumentPaths.forEach((path) => {
      const document = documents[path];

      if (!document) {
        return;
      }

      scheduleDocumentChange(document);
    });
  }, [
    documents,
    languageServerRuntimeStatus,
    openDocumentPaths,
    scheduleDocumentChange,
  ]);

  useEffect(
    () => () => {
      resetLanguageServerDocuments();
    },
    [resetLanguageServerDocuments],
  );

  const fileStructureOutline = useMemo(() => {
    if (!activeDocument) {
      return null;
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
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
  ]);
  const fileStructureLoading = Boolean(
    activeDocument &&
      (loadingPhpFileOutlinePaths.has(activeDocument.path) ||
        (fileStructureScope === "inherited" &&
          loadingInheritedPhpFileOutlinePaths.has(activeDocument.path))),
  );

  return {
    activeDocument,
    activePath,
    appSettings,
    classOpenLoading,
    classOpenOpen,
    classOpenQuery,
    classOpenResults,
    closeDocument,
    closeGitDiffPreview,
    commandContext,
    commands: commandRegistry.list(),
    dirtyCount,
    entriesByDirectory,
    expandedDirectories,
    expandedPhpFilePaths,
    fileStructureLoading,
    fileStructureOutline,
    fileStructureOpen,
    fileStructureScope,
    flushPendingLanguageServerDocument: flushPendingDocumentChange,
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
    languageServerDiagnosticsByPath,
    loadingDirectories,
    loadingPhpFileOutlinePaths,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerSetupOpen,
    message,
    openDocuments,
    openFile,
    openFileStructure,
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
    setAutoSave,
    setFileStructureOpen,
    setFileStructureScopeMode,
    setSmartMode,
    pinDocument,
    startIndexScan,
    startHardReindex,
    startLanguageServer,
    startPhpReindex,
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
    workspaceSettings,
    workspaceTrust,
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
