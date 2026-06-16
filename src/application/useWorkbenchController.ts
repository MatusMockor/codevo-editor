import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn as TauriUnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandRegistry } from "./commandRegistry";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { SmartModeGateway } from "../domain/intelligence";
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
  phpClassPathCandidates,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpLaravelRequestMethodDefinition,
  phpMethodPosition,
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
  preview?: boolean;
  recordNavigation?: boolean;
}

const CLOSE_ACTIVE_TAB_EVENT = "mockor-close-active-tab";

export type SidebarView = "files" | "php";

export function useWorkbenchController(
  workspaceGateways: WorkbenchWorkspaceGateways,
  smartModeGateway: SmartModeGateway,
  workspaceTrustGateway: WorkspaceTrustGateway,
  indexProgressGateway: IndexProgressGateway,
  phpFileOutlineGateway: PhpFileOutlineGateway,
  phpTreeGateway: PhpTreeGateway,
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
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
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
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const autoStartedLanguageServerRootRef = useRef<string | null>(null);
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
    [],
  );

  const startInitialIndexScan = useCallback(
    async (rootPath: string) => {
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
        setBottomPanelView(session.bottomPanelView);
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
      setBottomPanelView(session.bottomPanelView);

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

      try {
        const smartMode = await smartModeGateway.setMode(
          workspaceSettings.intelligenceMode,
        );
        setIntelligenceMode(smartMode.mode);
      } catch (error) {
        reportError("Smart Mode", error);
      }

      await loadDirectory(path);
      await restoreWorkspaceSession(path, workspaceSettings.session);
      workspaceSessionRestoredRef.current = true;
      void startInitialIndexScan(path);

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
      const shouldPreview = options.preview === true;

      if (documents[entry.path]) {
        if (shouldRecordNavigation && activePath !== entry.path) {
          recordCurrentNavigationLocation();
        }

        if (shouldPreview && !openPaths.includes(entry.path)) {
          setPreviewPath(entry.path);
        }

        if (!shouldPreview) {
          pinDocument(entry.path);
        }

        setActivePath(entry.path);
        return true;
      }

      try {
        const previousPreviewPath = previewPath;
        const shouldReplacePreview = Boolean(
          shouldPreview &&
            previousPreviewPath &&
            previousPreviewPath !== entry.path &&
            !openPaths.includes(previousPreviewPath),
        );
        const previousPreviewDocument = previousPreviewPath
          ? documents[previousPreviewPath]
          : null;
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

        if (shouldReplacePreview && previousPreviewDocument) {
          void syncClosedDocument(previousPreviewDocument);
        }

        setDocuments((current) => {
          const next = { ...current, [entry.path]: document };

          if (shouldReplacePreview && previousPreviewPath) {
            delete next[previousPreviewPath];
          }

          return next;
        });

        if (shouldPreview) {
          setPreviewPath(entry.path);
        }

        if (!shouldPreview) {
          pinDocument(entry.path);
        }

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
      documents,
      openPaths,
      pinDocument,
      previewPath,
      recordCurrentNavigationLocation,
      reportError,
      syncClosedDocument,
      workspaceFiles,
    ],
  );

  const previewFile = useCallback(
    async (entry: FileEntry) => {
      await openFile(entry, { preview: true });
    },
    [openFile],
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
    setFileStructureScope(nextScope);
    setFileStructureOpen(true);

    if (
      !phpFileOutlinesByPath[activeDocument.path] &&
      !loadingPhpFileOutlinePaths.has(activeDocument.path)
    ) {
      void loadPhpFileOutline(activeDocument.path);
    }

    if (
      nextScope === "inherited" &&
      !phpInheritedFileOutlinesByPath[activeDocument.path] &&
      !loadingInheritedPhpFileOutlinePaths.has(activeDocument.path)
    ) {
      void loadInheritedPhpFileOutline(activeDocument.path);
    }
  }, [
    activeDocument,
    fileStructureOpen,
    fileStructureScope,
    loadInheritedPhpFileOutline,
    loadPhpFileOutline,
    loadingInheritedPhpFileOutlinePaths,
    loadingPhpFileOutlinePaths,
    phpInheritedFileOutlinesByPath,
    phpFileOutlinesByPath,
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
        const state = await smartModeGateway.setMode(mode);
        if (state.mode !== "basic") {
          autoStartedLanguageServerRootRef.current = null;
        }

        setIntelligenceMode(state.mode);
        setMessage(state.message);
        await persistWorkspaceSettings(workspaceRoot, {
          ...workspaceSettingsRef.current,
          intelligenceMode: state.mode,
        });
      } catch (error) {
        reportError("Smart Mode", error);
      }
    },
    [
      intelligenceMode,
      persistWorkspaceSettings,
      reportError,
      smartModeGateway,
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

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    let unlisten: TauriUnlistenFn | null = null;

    listen(CLOSE_ACTIVE_TAB_EVENT, () => {
      const document = activeDocumentRef.current;

      if (!document) {
        return;
      }

      closeDocument(document.path);
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
  }, [closeDocument, reportError]);

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

  const openNavigationTarget = useCallback(
    async (
      path: string,
      position: EditorPosition,
      label: string,
    ): Promise<boolean> => {
      recordCurrentNavigationLocation();

      if (documents[path]) {
        setActivePath(path);
        setEditorRevealTarget({
          path,
          position,
        });
        setMessage(
          `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
        );
        return true;
      }

      if (activeDocument && !isDirty(activeDocument)) {
        try {
          const content = await workspaceFiles.readTextFile(path);
          const document: EditorDocument = {
            content,
            language: detectLanguage(path),
            name: getFileName(path),
            path,
            savedContent: content,
          };
          const replacedPath = activeDocument.path;
          void syncClosedDocument(activeDocument);

          setDocuments((current) => {
            const next = { ...current };
            delete next[replacedPath];
            next[path] = document;
            return next;
          });
          setOpenPaths((current) =>
            current.map((openPath) => (openPath === replacedPath ? path : openPath)),
          );
          setPreviewPath((current) => (current === replacedPath ? path : current));
          setActivePath(path);
          setEditorRevealTarget({
            path,
            position,
          });
          setMessage(
            `Opened ${label} ${getFileName(path)}:${position.lineNumber}:${position.column}`,
          );
          return true;
        } catch (error) {
          reportError("Open Navigation Target", error);
          return false;
        }
      }

      const opened = await openFile(
        {
          kind: "file",
          name: getFileName(path),
          path,
        },
        { preview: true, recordNavigation: false },
      );

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
    [
      activeDocument,
      documents,
      openFile,
      recordCurrentNavigationLocation,
      reportError,
      syncClosedDocument,
      workspaceFiles,
    ],
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

  const openPhpClassTarget = useCallback(
    async (className: string, label: string): Promise<boolean> => {
      if (!workspaceRoot || !workspaceDescriptor?.php) {
        return false;
      }

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

      const symbols = await projectSymbolSearch.searchProjectSymbols(
        workspaceRoot,
        methodName,
        50,
      );
      const normalizedClassName = className.toLowerCase();
      const normalizedMethodName = methodName.toLowerCase();
      const target = symbols.find(
        (symbol) =>
          symbol.kind === "method" &&
          symbol.name.toLowerCase() === normalizedMethodName &&
          symbol.containerName?.toLowerCase() === normalizedClassName,
      );

      if (!target) {
        return false;
      }

      return openNavigationTarget(
        target.path,
        editorPositionFromProjectSymbol(target),
        `${methodName}()`,
      );
    },
    [openNavigationTarget, projectSymbolSearch, workspaceRoot],
  );

  const goToPhpMethodCallDefinition = useCallback(
    async (
      context: Extract<PhpIdentifierContext, { kind: "methodCall" }>,
    ): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const variableType = phpParameterTypeForVariable(
        activeDocument.content,
        activeEditorPositionRef.current ?? { column: 1, lineNumber: 1 },
        context.variableName,
      );
      const resolvedVariableType = variableType
        ? resolvePhpClassName(activeDocument.content, variableType)
        : null;

      if (resolvedVariableType) {
        const directTargetOpened = await openDirectPhpMethodTarget(
          resolvedVariableType,
          context.methodName,
        );

        if (directTargetOpened) {
          return true;
        }
      }

      const frameworkHint = phpLaravelRequestMethodDefinition(
        resolvedVariableType,
        context.methodName,
      );

      if (frameworkHint) {
        return openPhpMethodHintTarget(frameworkHint);
      }

      setMessage(
        `No typed target found for $${context.variableName}->${context.methodName}().`,
      );
      return false;
    },
    [
      activeDocument,
      openDirectPhpMethodTarget,
      openPhpMethodHintTarget,
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

  const goToLanguageServerLocation = useCallback(async (
    feature: Extract<LanguageServerFeature, "definition" | "implementation">,
    label: string,
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

    const editorPosition = activeEditorPositionRef.current;

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

      if (documents[targetPath]) {
        setActivePath(targetPath);
      }

      if (!documents[targetPath]) {
        await openFile(
          {
            kind: "file",
            name: getFileName(targetPath),
            path: targetPath,
          },
          { recordNavigation: false },
        );
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
    documents,
    flushPendingDocumentChange,
    languageServerFeaturesGateway,
    languageServerRuntimeStatus,
    openFile,
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

        const openedClassTarget = await goToPhpClassIdentifierDefinition(
          context.name,
        );

        if (openedClassTarget) {
          return true;
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
    openNavigationTarget,
    projectSymbolSearch,
    reportError,
    workspaceRoot,
  ]);

  const goToDefinition = useCallback(async () => {
    const openedLanguageServerTarget = await goToLanguageServerLocation(
      "definition",
      "definition",
    );

    if (openedLanguageServerTarget) {
      return;
    }

    await goToIndexedSymbolDefinition();
  }, [goToIndexedSymbolDefinition, goToLanguageServerLocation]);

  const goToImplementation = useCallback(async () => {
    await goToLanguageServerLocation("implementation", "implementation");
  }, [goToLanguageServerLocation]);

  const applyNavigationLocation = useCallback(
    async (location: NavigationLocation) => {
      if (!documents[location.path]) {
        const opened = await openFile(
          {
            kind: "file",
            name: getFileName(location.path),
            path: location.path,
          },
          { recordNavigation: false },
        );

        if (!opened) {
          return;
        }
      }

      setActivePath(location.path);
      setEditorRevealTarget(location);
    },
    [documents, openFile],
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
    closeDocument,
    prompter,
    refreshDirectory,
    reportError,
    workspaceFiles,
  ]);

  const toggleSmartMode = useCallback(async () => {
    const nextMode = intelligenceMode === "basic" ? "fullSmart" : "basic";
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

        const smartMode = await smartModeGateway.setMode(
          nextWorkspaceSettings.intelligenceMode,
        );
        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: smartMode.mode,
        };

        await persistWorkspaceSettings(workspaceRoot, resolvedWorkspaceSettings);
        setIntelligenceMode(smartMode.mode);

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

        setSettingsOpen(false);
        setMessage("Settings saved.");
      } catch (error) {
        reportError("Settings", error);
      }
    },
    [
      persistAppSettings,
      persistWorkspaceSettings,
      refreshLanguageServerPlan,
      reportError,
      smartModeGateway,
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

    try {
      const status = await languageServerRuntimeGateway.start(workspaceRoot);
      handleLanguageServerRuntimeStatus(status);
    } catch (error) {
      reportLanguageServerError(error);
    }
  }, [
    handleLanguageServerRuntimeStatus,
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
  }, [indexProgressGateway, reportError, workspaceRoot]);

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
      title: "Close Tab",
      category: "Editor",
      shortcut: "Cmd+W",
      isEnabled: (context) => context.hasActiveDocument,
      run: () => {
        if (activeDocument) {
          closeDocument(activeDocument.path);
        }
      },
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
      title: "Toggle Smart Mode",
      category: "Smart Mode",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleSmartMode,
    });

    registry.register({
      id: "index.reindexSoft",
      title: "Soft Reindex Workspace",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace && indexProgress.status !== "scanning",
      run: startIndexScan,
    });

    registry.register({
      id: "index.reindexPhp",
      title: "Reindex PHP Symbols",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace && indexProgress.status !== "scanning",
      run: startPhpReindex,
    });

    registry.register({
      id: "index.reindexHard",
      title: "Hard Rebuild Index",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace && indexProgress.status !== "scanning",
      run: startHardReindex,
    });

    registry.register({
      id: "phpTree.show",
      title: "Show PHP Tree",
      category: "PHP",
      isEnabled: (context) => context.hasWorkspace,
      run: () => setSidebarView("php"),
    });

    registry.register({
      id: "phpTree.refresh",
      title: "Refresh PHP Tree",
      category: "PHP",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshPhpTree,
    });

    registry.register({
      id: "smart.phpactorSetup",
      title: "Show PHPactor Setup",
      category: "Smart Mode",
      isEnabled: () => Boolean(createPhpactorSetupGuide(languageServerPlan)),
      run: () => setLanguageServerSetupOpen(true),
    });

    registry.register({
      id: "smart.startLanguageServer",
      title: "Start PHP Language Server",
      category: "Smart Mode",
      isEnabled: () =>
        languageServerPlan?.status === "ready" &&
        !isLanguageServerActive(languageServerRuntimeStatus),
      run: startLanguageServer,
    });

    registry.register({
      id: "smart.stopLanguageServer",
      title: "Stop PHP Language Server",
      category: "Smart Mode",
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
    navigateBackward,
    navigateForwardInHistory,
    openFileStructure,
    openSettingsPanel,
    navigationHistory,
    openWorkspace,
    refreshWorkspace,
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
    languageServerPlan,
    languageServerRuntimeStatus,
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

    if (intelligenceMode === "basic") {
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
        if (activeDocument) {
          closeDocument(activeDocument.path);
        }
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
    activeDocument,
    closeDocument,
    goToDefinition,
    goToImplementation,
    navigateBackward,
    navigateForwardInHistory,
    openFileStructure,
    openSettingsPanel,
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
    if (!classOpenOpen || !workspaceRoot || !classOpenQuery.trim()) {
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
    clearEditorRevealTarget: () => setEditorRevealTarget(null),
    bottomPanelVisible,
    bottomPanelView,
    editorRevealTarget,
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
    previewFile,
    previewPath,
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
    refreshPhpTree,
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
    setSmartMode,
    pinDocument,
    startIndexScan,
    startHardReindex,
    startLanguageServer,
    startPhpReindex,
    stopLanguageServer,
    settingsOpen,
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
    bottomPanelView,
    openPaths: sessionPaths,
    sidebarView,
  };
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
