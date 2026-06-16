import { open } from "@tauri-apps/plugin-dialog";
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
  indexProgressCompletionMessage,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  startIndexProgress,
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
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import {
  emptyPhpTree,
  type PhpTree,
  type PhpTreeGateway,
  type PhpTreeNode,
} from "../domain/phpTree";
import { defaultWorkspaceSettings, type SettingsGateway } from "../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
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
  textSearch: TextSearchGateway;
}

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
  const [indexProgress, setIndexProgress] = useState<IndexProgressState>(
    initialIndexProgress,
  );
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [bottomPanelView, setBottomPanelView] =
    useState<BottomPanelView>("problems");
  const [phpTree, setPhpTree] = useState<PhpTree>(emptyPhpTree);
  const [phpTreeLoading, setPhpTreeLoading] = useState(false);
  const [phpTreeExpandedNodeIds, setPhpTreeExpandedNodeIds] = useState<
    Set<string>
  >(new Set());
  const [phpFileOutlinesByPath, setPhpFileOutlinesByPath] = useState<
    Record<string, PhpFileOutline>
  >({});
  const [expandedPhpFilePaths, setExpandedPhpFilePaths] = useState<Set<string>>(
    new Set(),
  );
  const [loadingPhpFileOutlinePaths, setLoadingPhpFileOutlinePaths] = useState<
    Set<string>
  >(new Set());
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenResults, setQuickOpenResults] = useState<FileSearchResult[]>(
    [],
  );
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<TextSearchResult[]>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
  const [intelligenceMode, setIntelligenceMode] =
    useState<IntelligenceMode>("basic");
  const hasRestoredRef = useRef(false);
  const lastLanguageServerCrashRef = useRef<string | null>(null);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const documentVersionsRef = useRef<Record<string, number>>({});
  const documentVersionsByUriRef = useRef<Record<string, number>>({});
  const syncedDocumentPathsRef = useRef<Set<string>>(new Set());
  const syncedDocumentContentRef = useRef<Record<string, string>>({});
  const pendingDocumentChangesRef = useRef<
    Record<string, LanguageServerTextDocument>
  >({});
  const documentChangeTimersRef = useRef<Record<string, number>>({});
  const documentSyncQueuesRef = useRef<Record<string, Promise<void>>>({});
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const lastPhpFileOutlineRefreshKeyRef = useRef<string | null>(null);

  const activeDocument = activePath ? documents[activePath] || null : null;
  const openDocuments = openPaths
    .map((path) => documents[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const dirtyCount = openDocuments.filter(isDirty).length;

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

  const openWorkspacePath = useCallback(
    async (path: string) => {
      await stopLanguageServerRuntime();
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
      setNavigationHistory(createNavigationHistory());
      setIntelligenceMode(workspaceSettings.intelligenceMode);
      setWorkspaceDescriptor(null);
      setPhpTools(null);
      setWorkspaceTrust(null);
      setLanguageServerPlan(null);
      setIndexProgress(initialIndexProgress());
      setPhpTree(emptyPhpTree());
      setPhpTreeExpandedNodeIds(new Set());
      setPhpTreeLoading(false);
      setPhpFileOutlinesByPath({});
      setExpandedPhpFilePaths(new Set());
      setLoadingPhpFileOutlinePaths(new Set());
      setPhpFileOutlineExpandedNodeIds(new Set());
      lastPhpFileOutlineRefreshKeyRef.current = null;
      activeIndexRootRef.current = null;
      pendingIndexScanRef.current = false;

      try {
        await settingsGateway.saveAppSettings({ recentWorkspacePath: path });
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
      loadDirectory,
      phpToolGateway,
      refreshLanguageServerPlan,
      reportError,
      settingsGateway,
      smartModeGateway,
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
    async (
      entry: FileEntry,
      options: { recordNavigation?: boolean } = {},
    ) => {
      const shouldRecordNavigation = options.recordNavigation !== false;

      if (documents[entry.path]) {
        if (shouldRecordNavigation && activePath !== entry.path) {
          recordCurrentNavigationLocation();
        }

        setActivePath(entry.path);
        return true;
      }

      try {
        const content = await workspaceFiles.readTextFile(entry.path);
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

        setDocuments((current) => ({ ...current, [entry.path]: document }));
        setOpenPaths((current) => [...current, entry.path]);
        setActivePath(entry.path);
        setMessage(null);
        return true;
      } catch (error) {
        reportError("Open File", error);
        return false;
      }
    },
    [activePath, documents, recordCurrentNavigationLocation, reportError, workspaceFiles],
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
        const outline = await phpFileOutlineGateway.getPhpFileOutline(
          requestedRoot,
          path,
        );

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
    [phpFileOutlineGateway, reportError, workspaceRoot],
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

  const closeDocument = useCallback(
    (path: string) => {
      const document = documents[path];

      if (document && isDirty(document) && !prompter.confirm("Discard changes?")) {
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

      setOpenPaths((current) => {
        const next = current.filter((item) => item !== path);

        if (activePath === path) {
          setActivePath(next[next.length - 1] || null);
        }

        return next;
      });
    },
    [activePath, documents, prompter, syncClosedDocument],
  );

  const updateActiveDocument = useCallback(
    (content: string) => {
      if (!activeDocument) {
        return;
      }

      setDocuments((current) => ({
        ...current,
        [activeDocument.path]: {
          ...activeDocument,
          content,
        },
      }));
    },
    [activeDocument],
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

  const goToDefinition = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    if (!isLanguageServerDocument(activeDocument)) {
      return;
    }

    if (languageServerRuntimeStatus?.kind !== "running") {
      return;
    }

    if (
      !canUseLanguageServerFeature(
        languageServerRuntimeStatus.capabilities,
        "definition",
      )
    ) {
      return;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return;
    }

    try {
      await flushPendingDocumentChange(activeDocument.path);
      const locations = await languageServerFeaturesGateway.definition(
        toLanguageServerTextDocumentPosition(activeDocument.path, editorPosition),
      );
      const [target] = locations;

      if (!target) {
        return;
      }

      const targetPath = pathFromLanguageServerUri(target.uri);

      if (!targetPath) {
        setMessage("Could not open definition target.");
        return;
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
        `Opened definition ${getFileName(targetPath)}:${targetPosition.lineNumber}:${targetPosition.column}`,
      );
    } catch (error) {
      reportLanguageServerError(error);
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
    if (!workspaceRoot) {
      return;
    }

    const nextMode = intelligenceMode === "basic" ? "lightSmart" : "basic";

    try {
      const state = await smartModeGateway.setMode(nextMode);
      setIntelligenceMode(state.mode);
      setMessage(state.message);
      await settingsGateway.saveWorkspaceSettings(workspaceRoot, {
        intelligenceMode: state.mode,
      });
    } catch (error) {
      reportError("Smart Mode", error);
    }
  }, [
    intelligenceMode,
    reportError,
    settingsGateway,
    smartModeGateway,
    workspaceRoot,
  ]);

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
      setMessage(reindexStartMessage(mode));
    } catch (error) {
      pendingIndexScanRef.current = false;
      reportError("Index", error);
    }
  }, [indexProgressGateway, reportError, workspaceRoot]);

  const startIndexScan = useCallback(async () => {
    await startReindex("soft");
  }, [startReindex]);

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry();

    registry.register({
      id: "workspace.open",
      title: "Open Workspace",
      category: "Workspace",
      shortcut: "Cmd+O",
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
      run: () => setQuickOpenOpen(true),
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
      shortcut: "Cmd+Alt+Left",
      isEnabled: () => navigationHistory.backStack.length > 0,
      run: navigateBackward,
    });

    registry.register({
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: "Cmd+Alt+Right",
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
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: "F12",
      isEnabled: () =>
        Boolean(activeDocument) &&
        languageServerRuntimeStatus?.kind === "running" &&
        canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "definition",
        ),
      run: goToDefinition,
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
      id: "panel.showProblems",
      title: "Show Problems",
      category: "Workbench",
      isEnabled: () => true,
      run: () => setBottomPanelView("problems"),
    });

    registry.register({
      id: "terminal.show",
      title: "Show Terminal",
      category: "Terminal",
      shortcut: "Ctrl+`",
      isEnabled: () => true,
      run: () => setBottomPanelView("terminal"),
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
      run: () => startReindex("language", "php"),
    });

    registry.register({
      id: "index.reindexHard",
      title: "Hard Rebuild Index",
      category: "Index",
      isEnabled: (context) =>
        context.hasWorkspace && indexProgress.status !== "scanning",
      run: () => startReindex("hard"),
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
    createDirectory,
    createFile,
    deleteActiveDocument,
    goToDefinition,
    navigateBackward,
    navigateForwardInHistory,
    navigationHistory,
    openWorkspace,
    refreshWorkspace,
    refreshPhpTree,
    renameActiveDocument,
    saveActiveDocument,
    startLanguageServer,
    startIndexScan,
    startReindex,
    stopLanguageServer,
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

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveDocument();
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

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openWorkspace();
        return;
      }

      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (workspaceRoot) {
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
    goToDefinition,
    navigateBackward,
    navigateForwardInHistory,
    openWorkspace,
    saveActiveDocument,
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
  }, [openWorkspacePath, reportError, settingsGateway]);

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

    openPaths.forEach((path) => {
      const document = documents[path];

      if (!document) {
        return;
      }

      void syncOpenDocument(document);
    });
  }, [
    documents,
    languageServerRuntimeStatus,
    openPaths,
    resetLanguageServerDocuments,
    syncOpenDocument,
  ]);

  useEffect(() => {
    if (languageServerRuntimeStatus?.kind !== "running") {
      return;
    }

    openPaths.forEach((path) => {
      const document = documents[path];

      if (!document) {
        return;
      }

      scheduleDocumentChange(document);
    });
  }, [
    documents,
    languageServerRuntimeStatus,
    openPaths,
    scheduleDocumentChange,
  ]);

  useEffect(
    () => () => {
      resetLanguageServerDocuments();
    },
    [resetLanguageServerDocuments],
  );

  return {
    activeDocument,
    activePath,
    closeDocument,
    commandContext,
    commands: commandRegistry.list(),
    dirtyCount,
    entriesByDirectory,
    expandedDirectories,
    expandedPhpFilePaths,
    flushPendingLanguageServerDocument: flushPendingDocumentChange,
    clearEditorRevealTarget: () => setEditorRevealTarget(null),
    bottomPanelView,
    editorRevealTarget,
    indexProgress,
    intelligenceMode,
    loadingDirectories,
    loadingPhpFileOutlinePaths,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerSetupOpen,
    message,
    openDocuments,
    openFile,
    openPhpFileOutlineNode,
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
    reportCommandError: (error: unknown) => reportError("Command", error),
    reportLanguageServerError,
    refreshPhpTree,
    saveActiveDocument,
    setActivePath: activateDocument,
    setBottomPanelView,
    setPaletteOpen,
    setQuickOpenOpen,
    setSidebarView,
    setQuickOpenQuery,
    setTextSearchOpen,
    setTextSearchQuery,
    setLanguageServerSetupOpen,
    startIndexScan,
    startLanguageServer,
    stopLanguageServer,
    textSearchLoading,
    textSearchOpen,
    textSearchQuery,
    textSearchResults,
    toggleDirectory,
    togglePhpFileOutline,
    togglePhpFileOutlineNode,
    togglePhpTreeNode,
    toggleSmartMode,
    updateActiveDocument,
    updateActiveEditorPosition,
    openPhpTreeNode,
    openSearchResult,
    openTextSearchResult,
    sidebarView,
    workspaceDescriptor,
    workspaceRoot,
    workspaceTrust,
  };
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
