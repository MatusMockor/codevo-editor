import {
  FolderOpen,
  ListChecks,
  LoaderCircle,
  History,
  Search,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import {
  CLOSED_PHP_CHANGE_SIGNATURE,
  EMPTY_FILE_STATUSES_BY_PATH,
} from "./application/appClosedState";
import { presentNodeRunWithoutDebugging } from "./application/nodeRunWithoutDebuggingPresentation";
import { useAppFrameworkBottomPanels } from "./application/useAppFrameworkBottomPanels";
import { useDirtyExpressRoutesDocumentSnapshots } from "./application/useDirtyExpressRoutesDocumentSnapshots";
import { useNoticeToastRenderers } from "./components/useNoticeToastRenderers";
import { useAppSyntaxHighlighterPreload, useAppWindowTitle } from "./application/useAppBootEffects";
import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";
import { createAppHighlighter } from "./infrastructure/shikiHighlighter";
import { useDebugCommandBridges } from "./application/useDebugCommandBridges";
import { useArtisanRoutes } from "./application/useArtisanRoutes";
import { useScopedEditorSurfaceRunners } from "./application/useScopedEditorSurfaceRunners";
import { useGitHistoryDiffDocuments } from "./application/useGitHistoryDiffDocuments";
import {
  useStableDocumentPaths,
  useStableNavigationHistoryPaths,
} from "./application/useStablePathLists";
import type { EditorGroupFocusRunner } from "./application/editorGroupFocusPort";
import { isGitDiffDocumentPath } from "./application/useGitDiffWorkspace";
import { ArtisanMakePalette } from "./components/ArtisanMakePalette";
import { BookmarksPanel } from "./components/BookmarksPanel";
import { BottomPanel } from "./components/BottomPanel";
import { phpTestBottomPanelProps } from "./components/phpTestBottomPanelProps";
import { useAppTestDebugPanels } from "./components/useAppTestDebugPanels";
import { usePhpCoverageEditorSurfaceProps } from "./components/usePhpCoverageEditorSurfaceProps";
import { jsTestEditorSurfaceProps } from "./components/jsTestEditorSurfaceProps";
import {
  areFileStatusesByPathEqual,
  clamp,
  indexToolbarLabel,
  isJavaScriptTypeScriptLanguage,
  maxBottomPanelHeight,
  toolSourceLabel,
} from "./components/appPresentation";
import { useWorkspaceExpressRoutesWorkbenchPanel } from "./components/useWorkspaceExpressRoutesWorkbenchPanel";
import { CallHierarchy } from "./components/CallHierarchy";
import { ClassOpen } from "./components/ClassOpen";
import { CommandPalette } from "./components/CommandPalette";
import { DirtyCloseDecisionDialogHost } from "./components/DirtyCloseDecisionDialogHost";
import { ScopedEditorSurface } from "./components/ScopedEditorSurface";
import { EditorArea } from "./components/EditorArea";
import type { EditorGroupSurface } from "./components/EditorGroupView";
import { EditorRuntimeHost } from "./components/EditorRuntimeHost";
import { ExternalFileConflictBar } from "./components/ExternalFileConflictBar";
import { ExternalFileCompareDialog } from "./components/ExternalFileCompareDialog";
import { FileHistoryPanel } from "./components/FileHistoryPanel";
import { GitBranchPanel } from "./components/GitBranchPanel";
import { GitStashPanel } from "./components/GitStashPanel";
import { ImageViewer } from "./components/ImageViewer";
import { LocalHistoryPanel } from "./components/LocalHistoryPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { FileStructure } from "./components/FileStructure";
import { GitDiffPreview } from "./components/GitDiffPreview";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ImplementationChooser } from "./components/ImplementationChooser";
import { LanguageServerSetup } from "./components/LanguageServerSetup";
import { NoticeToastHost } from "./components/NoticeToastHost";
import { NodeRunConfigurationPickerHost } from "./components/NodeRunConfigurationPickerHost";
import { NodeDebugAttachProcessPickerHost } from "./components/NodeDebugAttachProcessPickerHost";
import { PhpChangeSignatureDialog } from "./components/PhpChangeSignatureDialog";
import { ProjectTabs } from "./components/ProjectTabs";
import { QuickOpen } from "./components/QuickOpen";
import { RecentFilesSwitcher } from "./components/RecentFilesSwitcher";
import { RecentLocationsPanel } from "./components/RecentLocationsPanel";
import { SearchEverywhere } from "./components/SearchEverywhere";
import { WorkbenchSettingsDialogHost } from "./components/WorkbenchSettingsDialogHost";
import { StatusBar } from "./components/StatusBar";
import { TextSearch } from "./components/TextSearch";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { TodoPanel } from "./components/TodoPanel";
import { TypeHierarchy } from "./components/TypeHierarchy";
import { WindowChrome } from "./components/WindowChrome";
import { WorkbenchSidebar } from "./components/WorkbenchSidebar";
import { WorkspaceSymbols } from "./components/WorkspaceSymbols";
import {
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import { largeSmartDocumentStatus } from "./domain/largeDocumentPolicy";
import type { EditorPosition } from "./domain/languageServerFeatures";
import type { LanguageServerPlan } from "./domain/languageServer";
import { ideProgressIndicator } from "./domain/ideProgress";
import {
  ideActivityDetail,
  ideActivityStatus,
  phpLanguageServerActivityLabel,
} from "./domain/ideActivity";
import { editorChangeHunks } from "./domain/editorChangeMarkers";
import type { GitChangeStatus } from "./domain/git";
import { createWorkspaceEditorSessionOwnerKey } from "./domain/editorSessionOwnerKey";
import { monacoThemeForAppTheme, terminalThemeForAppTheme } from "./domain/settings";
import { isDirty, javaScriptTypeScriptWorkspaceLabel } from "./domain/workspace";
import type { EditorDocument, ImageTab, IntelligenceMode } from "./domain/workspace";
import { createInitialEditorGroupsState, type EditorGroupId } from "./domain/editorGroups";
import { isGitHistoryDiffDocumentPath } from "./domain/editorDocumentSchemes";
import { formatWindowTitle } from "./domain/windowTitle";
import type { BottomPanelView } from "./domain/bottomPanel";
import { workbenchComposition } from "./workbenchComposition";
import "./App.css";

const {
  artisanRoutesGateway,
  debugGateway,
  dirtyCloseDecisionCoordinator,
  gitGateway,
  gitHistoryGateway,
  indexProgressGateway,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerDocumentSyncGateway,
  javaScriptTypeScriptLanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRefreshGateway,
  javaScriptTypeScriptLanguageServerRuntimeGateway,
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
  jsTestGateway,
  jsTestCoverageGateway,
  languageServerDiagnosticsGateway,
  languageServerDocumentSyncGateway,
  languageServerFeaturesGateway,
  languageServerGateway,
  languageServerRefreshGateway,
  languageServerRuntimeGateway,
  localHistoryGateway,
  netteWorkspacePresentersGateway,
  netteWorkspaceRoutesGateway,
  netteWorkspaceServicesGateway,
  nodeDebugAttachCandidateGateway,
  nodeDebugAttachCandidateStart,
  nodePackageScriptsGateway,
  nodeRunTaskGateway,
  packageOperationsGateway,
  phpFileOutlineGateway,
  phpLanguageServerWorkspaceEditGateway,
  phpCloverCoveragePort,
  phpSyntaxDiagnosticsGateway,
  phpTestGateway,
  phpTreeGateway,
  runtimeObservabilityGateway,
  serverReadyExternalUrlOpener,
  settingsGateway,
  smartModeGateway,
  systemFontGateway,
  symfonyWorkspaceIntelligenceGateway,
  terminalGateway,
  vscodeProcessTasksGateway,
  workbenchPrompter,
  workspaceGateways,
  workspaceRuntimeLifecycleGateway,
  workspaceSourceDiscoveryGateway,
  workspaceTestDiscoveryGateway,
  workspaceTrustGateway,
} = workbenchComposition;
const debugTextClipboard = new BrowserTextClipboardGateway();

// Warm the Shiki highlighter in the background as soon as the app boots so the
// first opened file gets correct syntax colors immediately instead of showing
// the fallback theme for ~300ms while the highlighter bundle loads and inits.
//
// `createAppHighlighter` is an idempotent singleton (it caches and returns the
// same promise), so this preload only ever triggers one load. The result is
// intentionally ignored here — `setupShikiTokenization` later awaits the same
// cached promise on first file open (cache hit). Rejections are swallowed so a
// preload failure can never crash boot; the real consumer still surfaces errors.
function App() {
  const debugCommandBridges = useDebugCommandBridges();
  const prefersLightTheme = usePrefersLightTheme();
  useAppSyntaxHighlighterPreload(createAppHighlighter);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(152);
  const [activeFileRevealSignal, setActiveFileRevealSignal] = useState(0);
  const editorGroupFocusRunnerRef = useRef<EditorGroupFocusRunner | null>(null);
  const editorGroupFocusRunner = useCallback<EditorGroupFocusRunner>(
    (groupId) => editorGroupFocusRunnerRef.current?.(groupId) ?? false,
    [],
  );
  const updateEditorGroupFocusRunner = useCallback((runner: EditorGroupFocusRunner | null) => {
    editorGroupFocusRunnerRef.current = runner;
  }, []);
  const editorRunners = useScopedEditorSurfaceRunners("editor-main");
  const {
    activateGroup: activateRunnerGroup,
    focusGroup: focusRunnerGroup,
    updateBufferFix: updateEditorSurfaceBufferFixRunner,
    updateCommand: updateEditorSurfaceCommandRunner,
    updateDebugWatchAtCursorCapture: updateDebugWatchAtCursorCaptureReader,
    updateDebugEvaluateInConsoleCapture: updateDebugEvaluateInConsoleCaptureReader,
    updateDebugBreakpointNavigationCapture: updateDebugBreakpointNavigationCaptureReader,
    updateDebugInlineBreakpointCapture: updateDebugInlineBreakpointCaptureReader,
    updateEslintDisable: updateEditorSurfaceEslintDisableRunner,
    updateMenu: updateEditorMenuCommandRunner,
    updatePhpstanIgnore: updateEditorSurfacePhpstanIgnoreRunner,
  } = editorRunners;
  const {
    bufferFix: editorSurfaceBufferFixRunner,
    command: editorSurfaceCommandRunner,
    debugWatchAtCursorCapture: debugWatchAtCursorCaptureReader,
    debugEvaluateInConsoleCapture: debugEvaluateInConsoleCaptureReader,
    debugBreakpointNavigationCapture: debugBreakpointNavigationCaptureReader,
    debugInlineBreakpointCapture: debugInlineBreakpointCaptureReader,
    eslintDisable: editorSurfaceEslintDisableRunner,
    menu: editorMenuCommandRunner,
    phpstanIgnore: editorSurfacePhpstanIgnoreRunner,
  } = editorRunners.activeRunners;
  const closeGitHistoryDiffDocumentsRef = useRef<(paths: readonly string[]) => void>(
    () => undefined,
  );
  const handleClosedEditorPaths = useCallback((paths: readonly string[]) => {
    closeGitHistoryDiffDocumentsRef.current(paths);
  }, []);
  const fileStatusesByPathRef = useRef<Record<string, GitChangeStatus>>({});
  const workbench = useWorkbenchController(
    workspaceGateways,
    smartModeGateway,
    workspaceTrustGateway,
    indexProgressGateway,
    phpFileOutlineGateway,
    phpTreeGateway,
    gitGateway,
    localHistoryGateway,
    languageServerGateway,
    languageServerRuntimeGateway,
    languageServerDocumentSyncGateway,
    languageServerDiagnosticsGateway,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    workspaceRuntimeLifecycleGateway,
    terminalGateway,
    settingsGateway,
    workbenchPrompter,
    {
      editorMenuCommandRunner,
      editorSurfaceBufferFixRunner,
      editorSurfaceCommandRunner,
      debugWatchAtCursorCaptureReader,
      debugEvaluateInConsoleCaptureReader,
      debugBreakpointNavigationCaptureReader,
      debugInlineBreakpointCaptureReader,
      editorSurfaceEslintDisableRunner,
      editorSurfacePhpstanIgnoreRunner,
      editorGroupFocusRunner,
      dirtyCloseDecisionPort: dirtyCloseDecisionCoordinator,
      onDidCloseEditorPaths: handleClosedEditorPaths,
      debugGateway,
      serverReadyExternalUrlOpener,
      debugTextClipboard,
      ...debugCommandBridges.controllerOptions,
      nodeDebugAttachCandidateGateway,
      nodeDebugAttachCandidateStart,
      nodePackageScriptsGateway,
      nodeRunTaskGateway,
      vscodeProcessTasksGateway,
      workspaceSourceDiscoveryGateway,
    },
  );
  const editorSessionOwnerKey = workbench.workspaceRoot
    ? createWorkspaceEditorSessionOwnerKey(
        workbench.workspaceRoot,
        workbench.workspaceIdentityDescriptor,
      )
    : null;
  const workspaceTrusted = !!workbench.workspaceTrust?.trusted;
  const workspaceId = workbench.workspaceIdentityDescriptor?.workspaceId ?? null;
  const {
    navigateBackward,
    navigateForwardInHistory,
    goToDefinition: requestGoToDefinition,
    goToImplementationAt: requestGoToImplementationAt,
    goToSuperMethod: requestGoToSuperMethod,
    runCommand,
    setClassOpenOpen,
    setQuickOpenOpen,
    showBottomPanelView,
    workspaceRoot,
  } = workbench;
  const phpChangeSignature = {
    ...CLOSED_PHP_CHANGE_SIGNATURE,
    ...(workbench.phpChangeSignature ?? {}),
    state: workbench.phpChangeSignature?.state ?? CLOSED_PHP_CHANGE_SIGNATURE.state,
  };
  const artisanRoutes = useArtisanRoutes({
    gateway: artisanRoutesGateway,
    isOpen: workbench.bottomPanelVisible && (workbench.bottomPanelView as string) === "routes",
    rootPath: workbench.workspaceRoot,
  });
  const dirtyExpressRoutesSnapshots = useDirtyExpressRoutesDocumentSnapshots(
    workbench.openDocuments,
    workbench.activeDocument,
    workbench.workspaceRoot,
  );
  const expressRoutesPanel = useWorkspaceExpressRoutesWorkbenchPanel({
    dirtySnapshots: dirtyExpressRoutesSnapshots,
    discoveryGateway: workspaceSourceDiscoveryGateway,
    discoveryVersion: workbench.expressRouteDiscoveryVersion,
    isOpen: workbench.bottomPanelVisible && workbench.bottomPanelView === "expressRoutes",
    onOpenLocation: workbench.openDebugLocation,
    rootPath: workbench.workspaceRoot,
    workspaceId,
  });
  const frameworkBottomPanels = useAppFrameworkBottomPanels({
    netteWorkspacePresentersGateway,
    netteWorkspaceRoutesGateway,
    netteWorkspaceServicesGateway,
    packageOperationsGateway,
    symfonyWorkspaceIntelligenceGateway,
    workbench,
    workspaceSourceDiscoveryGateway,
    workspaceTrusted,
  });

  const { debugPanel, jsTestExplorerPanel, phpCloverCoverage, phpTestResults } =
    useAppTestDebugPanels({
      ...debugCommandBridges.panelOptions,
      debugTextClipboard,
      jsTestCoverageGateway,
      jsTestGateway,
      phpCloverCoveragePort,
      phpTestGateway,
      workbench,
      workspaceTestDiscoveryGateway,
      workspaceTrusted,
    });
  const phpCoverageEditorSurfaceProps = usePhpCoverageEditorSurfaceProps({
    report: phpCloverCoverage.report,
    rootPath: workbench.workspaceRoot,
    workspaceId,
  });
  const phpTestPanel = phpTestBottomPanelProps(
    phpCloverCoverage,
    phpTestResults,
    workbench.openPhpTestCase,
  );
  const gitHistoryDiffDocuments = useGitHistoryDiffDocuments({
    gateway: gitHistoryGateway,
    onOpenDocument: workbench.openReadOnlyDocument,
    ownerId: workspaceId,
    workspaceRoot: workbench.workspaceRoot,
  });
  closeGitHistoryDiffDocumentsRef.current = gitHistoryDiffDocuments.closeDocumentPaths;
  const fileStatusesByPath = useMemo<Record<string, GitChangeStatus>>(() => {
    const gitChanges = workbench.gitStatus?.changes;
    const previous = fileStatusesByPathRef.current;

    if (!Array.isArray(gitChanges) || gitChanges.length === 0) {
      if (Object.keys(previous).length === 0) {
        return previous;
      }

      fileStatusesByPathRef.current = EMPTY_FILE_STATUSES_BY_PATH;
      return fileStatusesByPathRef.current;
    }

    const next: Record<string, GitChangeStatus> = gitChanges.reduce(
      (accumulator, change) => {
        accumulator[change.path] = change.status;

        if (change.oldPath) {
          accumulator[change.oldPath] = change.status;
        }

        return accumulator;
      },
      {} as Record<string, GitChangeStatus>,
    );

    if (areFileStatusesByPathEqual(previous, next)) {
      return previous;
    }

    fileStatusesByPathRef.current = next;
    return next;
  }, [workbench.gitStatus?.changes]);
  const activeDocumentContent = workbench.activeDocument?.content ?? null;
  const activeDocumentSavedContent = workbench.activeDocument?.savedContent ?? null;
  const activeLanguage = workbench.activeDocument?.language ?? null;
  const activeDocumentIsDirty = workbench.activeDocument
    ? isDirty(workbench.activeDocument)
    : false;
  const windowTitle = useMemo(
    () =>
      formatWindowTitle({
        activeFilePath: workbench.activeDocument?.path ?? null,
        isDirty: activeDocumentIsDirty,
        workspaceName: workbench.workspaceRoot,
      }),
    [workbench.activeDocument?.path, activeDocumentIsDirty, workbench.workspaceRoot],
  );
  useAppWindowTitle(windowTitle);
  const activeLargeDocumentStatus = useMemo(
    () =>
      largeSmartDocumentStatus(
        activeDocumentContent === null ? null : { content: activeDocumentContent },
        workbench.workspaceSettings.largeFileMode,
      ),
    [activeDocumentContent, workbench.workspaceSettings.largeFileMode],
  );
  // Stable list of open document paths for EditorSurface's model-dispose effect.
  // openDocuments is replaced on every keystroke (fresh document objects), so the
  // helper reuses the previous array while the ordered paths remain unchanged.
  const openDocumentPaths = useStableDocumentPaths(workbench.openDocuments);
  const editorAreaDocuments = useMemo(() => {
    const tabs = Array.isArray(workbench.openTabs) ? workbench.openTabs : workbench.openDocuments;
    if (!workbench.activePath || tabs.some((tab) => tab.path === workbench.activePath)) {
      return tabs;
    }
    const active = workbench.activeDocument;
    if (active) {
      return [...tabs, active];
    }
    return [
      ...tabs,
      {
        content: "",
        language: "plaintext" as const,
        name: workbench.activePath.split("/").pop() ?? workbench.activePath,
        path: workbench.activePath,
        readOnly: true,
        savedContent: "",
      },
    ];
  }, [workbench.activeDocument, workbench.activePath, workbench.openDocuments, workbench.openTabs]);
  const editorContentReadyPaths = useMemo(() => {
    const tabs = Array.isArray(workbench.openTabs) ? workbench.openTabs : workbench.openDocuments;
    const paths = new Set(tabs.map((document) => document.path));

    if (workbench.activeDocument) {
      paths.add(workbench.activeDocument.path);
    }

    return paths;
  }, [workbench.activeDocument, workbench.openDocuments, workbench.openTabs]);
  const editorGroups = workbench.editorGroups;
  const editorActivePath = workbench.activePath;
  const editorPreviewPath = workbench.previewPath;
  const editorGroupsState = useMemo(() => {
    const candidate: unknown = editorGroups;
    if (
      candidate &&
      typeof candidate === "object" &&
      "groups" in candidate &&
      "layout" in candidate &&
      "activeGroupId" in candidate
    ) {
      return candidate as typeof editorGroups;
    }
    return createInitialEditorGroupsState("editor-main", {
      activePath: editorActivePath,
      openPaths: editorAreaDocuments.map((document) => document.path),
      previewPath: editorPreviewPath,
    });
  }, [editorActivePath, editorAreaDocuments, editorGroups, editorPreviewPath]);
  useEffect(() => {
    activateRunnerGroup(editorGroupsState.activeGroupId);
  }, [activateRunnerGroup, editorGroupsState.activeGroupId]);
  // Distinct file paths reachable via back/forward navigation history. Their
  // Monaco models must be kept alive so Back/Forward is a cheap model-swap
  // instead of a dispose+recreate+re-tokenization (lag). Go-to-definition
  // demotes the source file to a clean-preview replacement, dropping it from
  // openDocumentPaths even though Back still navigates to it. Workspace-scoped:
  // navigationHistory is reset/restored per workspace tab. The helper reuses the
  // previous unique path array unless its ordered contents actually change.
  const navigationHistoryPaths = useStableNavigationHistoryPaths(
    workbench.navigationHistory.backStack,
    workbench.navigationHistory.forwardStack,
  );
  const transientEditorWidgetDismissKey = useMemo(
    () =>
      [
        workbench.paletteOpen,
        workbench.quickOpenOpen,
        workbench.classOpenOpen,
        workbench.workspaceSymbolsOpen,
        workbench.searchEverywhereOpen,
        workbench.textSearchOpen,
        workbench.fileStructureOpen,
        workbench.recentFilesSwitcherOpen,
        workbench.recentLocationsPanelOpen,
        workbench.languageServerSetupOpen,
        workbench.settingsOpen,
        workbench.floatingSurfaceActivationVersion,
      ]
        .map((part) => String(part))
        .join("|"),
    [
      workbench.classOpenOpen,
      workbench.fileStructureOpen,
      workbench.floatingSurfaceActivationVersion,
      workbench.languageServerSetupOpen,
      workbench.paletteOpen,
      workbench.quickOpenOpen,
      workbench.recentFilesSwitcherOpen,
      workbench.recentLocationsPanelOpen,
      workbench.searchEverywhereOpen,
      workbench.settingsOpen,
      workbench.textSearchOpen,
      workbench.workspaceSymbolsOpen,
    ],
  );
  // Depend on the inputs editorChangeHunks actually reads (baseline + current
  // content strings) rather than the whole activeDocument object. A cursor move
  // hands down a new activeDocument identity with identical content, so keying
  // on the strings keeps this array reference stable and stops the downstream
  // change-hunk decoration effect from re-running when nothing changed. When the
  // content genuinely changes (a keystroke) the hunks recompute as expected.
  const activeEditorChangeHunks = useMemo(
    () =>
      activeDocumentContent !== null && activeDocumentSavedContent !== null
        ? editorChangeHunks(
            workbench.activeDocumentGitBaseline ?? activeDocumentSavedContent,
            activeDocumentContent,
          )
        : [],
    [activeDocumentContent, activeDocumentSavedContent, workbench.activeDocumentGitBaseline],
  );
  const activeBookmarkedLineNumbers = useMemo(() => {
    const activePath = workbench.activeDocument?.path;

    if (!activePath) {
      return [];
    }

    return workbench.bookmarks
      .filter((bookmark) => bookmark.path === activePath)
      .map((bookmark) => bookmark.lineNumber);
  }, [workbench.activeDocument?.path, workbench.bookmarks]);
  const workspaceLabel = useMemo(() => {
    const jsTs = workbench.workspaceDescriptor?.javaScriptTypeScript;
    const php = workbench.workspaceDescriptor?.php;

    if (jsTs && isJavaScriptTypeScriptLanguage(activeLanguage)) {
      return javaScriptTypeScriptWorkspaceLabel(
        jsTs,
        workbench.workspaceSettings.javaScriptTypeScriptVersion,
      );
    }

    if (!php) {
      return jsTs
        ? javaScriptTypeScriptWorkspaceLabel(
            jsTs,
            workbench.workspaceSettings.javaScriptTypeScriptVersion,
          )
        : null;
    }

    const packageName = php.packageName || "PHP Composer";
    const phpLevel =
      workbench.workspaceSettings.phpVersionOverride ||
      php.phpPlatformVersion ||
      php.phpVersionConstraint;
    const packageLabel = phpLevel ? `${packageName} · PHP ${phpLevel}` : packageName;

    if (workbench.phpTools?.phpactor) {
      return `${packageLabel} · ${toolSourceLabel(workbench.phpTools.phpactor.source)}`;
    }

    if (workbench.phpTools?.intelephense) {
      return `${packageLabel} · Intelephense`;
    }

    return `${packageLabel} · PHP tools missing`;
  }, [
    activeLanguage,
    workbench.phpTools,
    workbench.workspaceDescriptor,
    workbench.workspaceSettings.javaScriptTypeScriptVersion,
    workbench.workspaceSettings.phpVersionOverride,
  ]);
  const languageServerLabel = useMemo(
    () =>
      phpLanguageServerActivityLabel(
        workbench.intelligenceMode,
        workbench.languageServerRuntimeStatus,
        workbench.workspaceRoot,
        workbench.languageServerPlan,
      ),
    [
      workbench.intelligenceMode,
      workbench.languageServerPlan,
      workbench.languageServerRuntimeStatus,
      workbench.workspaceRoot,
    ],
  );
  const javaScriptTypeScriptLanguageServerLabel = useMemo(
    () =>
      languageServerStatusLabel(
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        "TS Server",
        { workspaceRoot: workbench.workspaceRoot },
      ),
    [workbench.javaScriptTypeScriptLanguageServerRuntimeStatus, workbench.workspaceRoot],
  );
  const combinedLanguageServerLabel = useMemo(
    () =>
      [languageServerLabel, javaScriptTypeScriptLanguageServerLabel].filter(Boolean).join(" · ") ||
      null,
    [javaScriptTypeScriptLanguageServerLabel, languageServerLabel],
  );
  const openWorkspace = useCallback(() => {
    void runCommand("workspace.open");
  }, [runCommand]);
  const showCommands = useCallback(() => {
    void runCommand("commands.show");
  }, [runCommand]);
  const openSettings = useCallback(() => {
    void runCommand("workbench.openSettings");
  }, [runCommand]);
  const showGit = useCallback(() => {
    void runCommand("git.show");
  }, [runCommand]);
  const toggleSmartMode = useCallback(() => {
    void runCommand("smart.toggle");
  }, [runCommand]);
  const trustWorkspace = useCallback(() => {
    void runCommand("workspace.trust");
  }, [runCommand]);
  const openRuntimePanel = useCallback(() => {
    void runCommand("runtime.show");
  }, [runCommand]);
  const renderNoticeToast = useNoticeToastRenderers({
    intelligenceMode: workbench.intelligenceMode,
    onInstallManagedPhpactor: workbench.installManagedPhpactor,
    isInstallingManagedPhpactor: workbench.installingManagedPhpactor,
    onOpenLanguageServerSetup: () => workbench.setLanguageServerSetupOpen(true),
    onOpenRuntimePanel: openRuntimePanel,
    workspaceRoot: workbench.workspaceRoot,
    workspaceTrusted,
  });

  const ideActivity = useMemo(
    () =>
      ideActivityStatus(
        workbench.workspaceRoot,
        workbench.languageServerRuntimeStatus,
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        workbench.indexProgress,
        combinedLanguageServerLabel,
        workbench.activeFrameworkActivityLabel,
      ),
    [
      combinedLanguageServerLabel,
      workbench.activeFrameworkActivityLabel,
      workbench.indexProgress,
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      workbench.languageServerRuntimeStatus,
      workbench.workspaceRoot,
    ],
  );
  const ideActivityChipDetail = useMemo(
    () =>
      ideActivityDetail(
        workbench.workspaceRoot,
        workbench.languageServerRuntimeStatus,
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        workbench.indexProgress,
      ),
    [
      workbench.indexProgress,
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      workbench.languageServerRuntimeStatus,
      workbench.workspaceRoot,
    ],
  );
  const ideProgress = useMemo(
    () =>
      ideProgressIndicator({
        workspaceRoot: workbench.workspaceRoot,
        phpRuntimeStatus: workbench.languageServerRuntimeStatus,
        javaScriptTypeScriptRuntimeStatus:
          workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        indexProgress: workbench.indexProgress,
        installingManagedPhpactor: workbench.installingManagedPhpactor,
      }),
    [
      workbench.indexProgress,
      workbench.installingManagedPhpactor,
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      workbench.languageServerRuntimeStatus,
      workbench.workspaceRoot,
    ],
  );
  const monacoTheme = useMemo(
    () => monacoThemeForAppTheme(workbench.appSettings.theme, prefersLightTheme),
    [prefersLightTheme, workbench.appSettings.theme],
  );
  const terminalTheme = useMemo(
    () => terminalThemeForAppTheme(workbench.appSettings.theme, prefersLightTheme),
    [prefersLightTheme, workbench.appSettings.theme],
  );
  const shellStyle = useMemo(
    () =>
      ({
        "--bottom-panel-height": `${bottomPanelHeight}px`,
        "--sidebar-width": `${sidebarWidth}px`,
      }) as CSSProperties,
    [bottomPanelHeight, sidebarWidth],
  );
  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const handlePointerMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(clamp(startWidth + moveEvent.clientX - startX, 180, 520));
      };
      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        window.removeEventListener("blur", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      window.addEventListener("blur", stopResize);
    },
    [sidebarWidth],
  );
  const startBottomPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomPanelHeight;
      const handlePointerMove = (moveEvent: PointerEvent) => {
        setBottomPanelHeight(
          clamp(
            startHeight + startY - moveEvent.clientY,
            96,
            maxBottomPanelHeight(window.innerHeight),
          ),
        );
      };
      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        window.removeEventListener("blur", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      window.addEventListener("blur", stopResize);
    },
    [bottomPanelHeight],
  );
  const showProblemsPanel = useCallback(() => {
    void runCommand("panel.showProblems");
  }, [runCommand]);
  const showProgressPanel = useCallback(() => {
    if (ideProgress.state === "problem") {
      void runCommand("panel.showProblems");
      return;
    }

    void runCommand("panel.showIndex");
  }, [ideProgress.state, runCommand]);
  const selectBottomPanelView = useCallback(
    (view: BottomPanelView | "routes" | "testResults" | "expressRoutes") => {
      if (view === "problems") {
        void runCommand("panel.showProblems");
        return;
      }

      if (view === "index") {
        void runCommand("panel.showIndex");
        return;
      }

      if (view === "runtime") {
        void runCommand("runtime.show");
        return;
      }

      showBottomPanelView(view as BottomPanelView);
    },
    [runCommand, showBottomPanelView],
  );
  const showGoToLine = useCallback(() => {
    editorMenuCommandRunner?.("gotoLine");
  }, [editorMenuCommandRunner]);
  const goBack = useCallback(() => {
    void navigateBackward();
  }, [navigateBackward]);
  const goForward = useCallback(() => {
    void navigateForwardInHistory();
  }, [navigateForwardInHistory]);
  const goToDefinition = useCallback(() => {
    void requestGoToDefinition();
  }, [requestGoToDefinition]);
  const goToImplementationAt = useCallback(
    (position: EditorPosition) => {
      void requestGoToImplementationAt(position);
    },
    [requestGoToImplementationAt],
  );
  const goToSuperMethod = useCallback(() => {
    void requestGoToSuperMethod();
  }, [requestGoToSuperMethod]);
  const markActiveFileRevealSignal = useCallback(() => {
    setActiveFileRevealSignal((current) => current + 1);
  }, []);
  const openClass = useCallback(() => {
    if (workspaceRoot) {
      setQuickOpenOpen(false);
      setClassOpenOpen(true);
    }
  }, [setClassOpenOpen, setQuickOpenOpen, workspaceRoot]);
  const openFile = useCallback(() => {
    if (workspaceRoot) {
      setClassOpenOpen(false);
      setQuickOpenOpen(true);
    }
  }, [setClassOpenOpen, setQuickOpenOpen, workspaceRoot]);
  const editorMenuCommandContext = useMemo(() => {
    if (editorMenuCommandRunner) {
      return workbench.commandContext;
    }

    return {
      ...workbench.commandContext,
      hasActiveDocument: false,
    };
  }, [editorMenuCommandRunner, workbench.commandContext]);

  const activateEditorGroupTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      if (workbench.activateEditorGroupTab) {
        workbench.activateEditorGroupTab(groupId, path);
        return;
      }
      workbench.setActivePath(path);
    },
    [workbench],
  );

  const closeEditorGroupTab = useCallback(
    async (groupId: EditorGroupId, path: string) => {
      if (workbench.closeDocumentInEditorGroup) {
        await workbench.closeDocumentInEditorGroup(groupId, path);
        return;
      }
      await workbench.closeDocument(path);
    },
    [workbench],
  );
  const renderEditorDocumentForGroup = useCallback(
    (document: EditorDocument | null, groupId: EditorGroupId) => {
      const groupIsActive = editorGroupsState.activeGroupId === groupId;
      const phpCoverageSurface = phpCoverageEditorSurfaceProps(document, groupIsActive);
      return (
        <ScopedEditorSurface
          activeDocument={document}
          activeDocumentContentReady={!document || editorContentReadyPaths.has(document.path)}
          embeddedInGroupPanel
          editorConfig={groupIsActive ? workbench.activeEditorConfig : {}}
          editorFontFamily={workbench.appSettings.editorFontFamily}
          editorFontLigatures={workbench.appSettings.editorFontLigatures}
          editorFontSize={workbench.appSettings.editorFontSize}
          wordWrapEnabled={workbench.appSettings.wordWrapEnabled}
          isOpeningFile={workbench.isOpeningFile}
          applyJavaScriptTypeScriptLanguageServerWorkspaceEdit={
            workbench.applyJavaScriptTypeScriptLanguageServerWorkspaceEdit
          }
          applyPhpCodeActionNewFile={workbench.applyPhpCodeActionNewFile}
          applyPhpLanguageServerWorkspaceEdit={workbench.applyPhpLanguageServerWorkspaceEdit}
          clearLanguageServerDiagnosticsForPath={workbench.clearLanguageServerDiagnosticsForPath}
          bookmarkedLineNumbers={groupIsActive ? activeBookmarkedLineNumbers : []}
          breakpoints={workbench.debugSession.breakpoints}
          breakpointActions={workbench.debugSession}
          debugStoppedLocation={workbench.debugStoppedLocation}
          debugInlineValueContext={workbench.debugSession.inlineValueContext}
          changeHunks={groupIsActive ? activeEditorChangeHunks : []}
          editorRevealTarget={groupIsActive ? workbench.editorRevealTarget : null}
          flushPendingLanguageServerDocument={workbench.flushPendingLanguageServerDocument}
          getLanguageServerDocumentLifecycleIdentity={
            workbench.getLanguageServerDocumentLifecycleIdentity
          }
          getJavaScriptTypeScriptDocumentSyncVersion={
            workbench.getJavaScriptTypeScriptDocumentSyncVersion
          }
          requestLanguageServerDocumentLease={workbench.requestLanguageServerDocumentLease}
          isLanguageServerDocumentRequestLeaseCurrent={
            workbench.isLanguageServerDocumentRequestLeaseCurrent
          }
          flushPendingJavaScriptTypeScriptLanguageServerDocument={
            workbench.flushPendingJavaScriptTypeScriptLanguageServerDocument
          }
          formatOnPaste={workbench.workspaceSettings.formatOnPaste}
          gitBlameEnabled={groupIsActive && workbench.isActiveDocumentGitBlameEnabled}
          isActiveDocumentJsTest={groupIsActive && workbench.isActiveDocumentJsTest}
          {...jsTestEditorSurfaceProps(groupIsActive, jsTestExplorerPanel)}
          {...phpCoverageSurface}
          isActiveDocumentPhpTest={groupIsActive && workbench.isActiveDocumentPhpTest}
          isLanguageServerDocumentSynced={workbench.isLanguageServerDocumentSynced}
          javaScriptTypeScriptLanguageServerFeaturesGateway={
            javaScriptTypeScriptLanguageServerFeaturesGateway
          }
          javaScriptTypeScriptLanguageServerRuntimeStatus={
            workbench.javaScriptTypeScriptLanguageServerRuntimeStatus
          }
          javaScriptTypeScriptLanguageServerRefreshGateway={
            javaScriptTypeScriptLanguageServerRefreshGateway
          }
          javaScriptTypeScriptLanguageServerWorkspaceEditGateway={
            javaScriptTypeScriptLanguageServerWorkspaceEditGateway
          }
          javaScriptTypeScriptCompleteFunctionCalls={
            workbench.workspaceSettings.javaScriptTypeScriptCompleteFunctionCalls
          }
          javaScriptTypeScriptValidationEnabled={
            workbench.workspaceSettings.javaScriptTypeScriptValidation
          }
          languageServerFeaturesGateway={languageServerFeaturesGateway}
          languageServerRefreshGateway={languageServerRefreshGateway}
          languageServerDiagnosticsByPath={workbench.languageServerDiagnosticsByPath}
          languageServerRuntimeStatus={workbench.languageServerRuntimeStatus}
          largeSmartDocumentPolicy={workbench.workspaceSettings.largeFileMode}
          keymap={workbench.appSettings.keymap}
          monacoTheme={monacoTheme}
          runCommand={workbench.runCommand}
          navigationHistoryPaths={navigationHistoryPaths}
          openDocumentPaths={openDocumentPaths}
          restoredViewStates={
            workbench.restoredEditorViewStatesByGroup?.[groupId] ??
            workbench.restoredEditorViewStates ??
            {}
          }
          restoredViewStateRevision={workbench.restoredEditorViewStateRevision}
          transientWidgetDismissKey={transientEditorWidgetDismissKey}
          phpIdeReadinessVersion={workbench.phpIdeReadinessVersion}
          phpLanguageServerWorkspaceEditGateway={phpLanguageServerWorkspaceEditGateway}
          group={editorGroupsState.groups[groupId]}
          groupId={groupId}
          onBufferFixRunnerChange={updateEditorSurfaceBufferFixRunner}
          onCommandRunnerChange={updateEditorSurfaceCommandRunner}
          onDebugWatchAtCursorCaptureReaderChange={updateDebugWatchAtCursorCaptureReader}
          onDebugEvaluateInConsoleCaptureReaderChange={updateDebugEvaluateInConsoleCaptureReader}
          onDebugBreakpointNavigationCaptureReaderChange={
            updateDebugBreakpointNavigationCaptureReader
          }
          onDebugInlineBreakpointCaptureReaderChange={updateDebugInlineBreakpointCaptureReader}
          onEslintDisableRunnerChange={updateEditorSurfaceEslintDisableRunner}
          onMenuCommandRunnerChange={updateEditorMenuCommandRunner}
          onPhpstanIgnoreRunnerChange={updateEditorSurfacePhpstanIgnoreRunner}
          onCloseActiveTab={async () => {
            const path = editorGroupsState.groups[groupId]?.activePath;
            if (!path) {
              return;
            }
            if (workbench.closeDocumentInEditorGroup) {
              await workbench.closeDocumentInEditorGroup(groupId, path);
              return;
            }
            await workbench.closeDocument(path);
          }}
          onCursorPositionChange={workbench.updateActiveEditorPosition}
          onEditorViewStateChange={(path, viewState) => {
            if (workbench.updateEditorGroupViewState) {
              workbench.updateEditorGroupViewState(groupId, path, viewState);
              return;
            }
            workbench.updateEditorViewState(path, viewState);
          }}
          onCloseFloatingSurface={workbench.closeFloatingSurface}
          onGoBack={goBack}
          onGoForward={goForward}
          onGoToDefinition={goToDefinition}
          onGoToImplementationAt={goToImplementationAt}
          onGoToSuperMethod={goToSuperMethod}
          onRunTestAt={workbench.runTestAt}
          onToggleBookmarkAtLine={workbench.toggleBookmarkAtLine}
          onToggleGitBlame={workbench.toggleGitBlame}
          provideGitBlame={workbench.provideGitBlame}
          readWorkspaceFile={workbench.readWorkspaceFile}
          onEditorFocused={() => {
            focusRunnerGroup(groupId);
            workbench.activateEditorGroup?.(groupId);
            markActiveFileRevealSignal();
          }}
          onOpenClass={openClass}
          onOpenFile={openFile}
          onOpenWorkspaceFile={workbench.openWorkspaceFile}
          onOpenWorkspaceRoot={workbench.openWorkspaceRoot}
          onOpenFileStructure={workbench.openFileStructure}
          onChange={workbench.updateActiveDocument}
          onLanguageServerError={workbench.reportLanguageServerError}
          onOpenPhpChangeSignature={phpChangeSignature.open}
          onRecordCompletionLatency={workbench.recordCompletionLatency}
          onLocalPhpDiagnosticsChange={workbench.updateLocalPhpDiagnostics}
          onRevealTargetHandled={workbench.clearEditorRevealTarget}
          onRevertChangeHunk={workbench.revertActiveEditorChangeHunk}
          phpSyntaxDiagnosticsGateway={phpSyntaxDiagnosticsGateway}
          frameworkIntelligenceProviders={workbench.frameworkIntelligenceProviders}
          providePhpCodeActions={workbench.providePhpCodeActions}
          providePhpFrameworkDefinition={workbench.providePhpFrameworkDefinition}
          phpInlayHintsEnabled={workbench.workspaceSettings.phpInlayHints}
          providePhpMethodCompletions={workbench.providePhpMethodCompletions}
          providePhpMethodSignature={workbench.providePhpMethodSignature}
          providePhpParameterInlayHints={workbench.providePhpParameterInlayHints}
          userSnippets={workbench.appSettings.userSnippets}
          workspaceRoot={workbench.workspaceRoot}
          workspaceTrusted={workspaceTrusted}
          workspaceIdentityDescriptor={workbench.workspaceIdentityDescriptor}
        />
      );
    },
    [
      activeBookmarkedLineNumbers,
      activeEditorChangeHunks,
      editorContentReadyPaths,
      editorGroupsState,
      goBack,
      goForward,
      goToDefinition,
      goToImplementationAt,
      goToSuperMethod,
      focusRunnerGroup,
      jsTestExplorerPanel,
      markActiveFileRevealSignal,
      monacoTheme,
      navigationHistoryPaths,
      openClass,
      openDocumentPaths,
      openFile,
      phpChangeSignature.open,
      phpCoverageEditorSurfaceProps,
      transientEditorWidgetDismissKey,
      updateEditorMenuCommandRunner,
      updateEditorSurfaceBufferFixRunner,
      updateEditorSurfaceCommandRunner,
      updateDebugWatchAtCursorCaptureReader,
      updateDebugEvaluateInConsoleCaptureReader,
      updateDebugBreakpointNavigationCaptureReader,
      updateDebugInlineBreakpointCaptureReader,
      updateEditorSurfaceEslintDisableRunner,
      updateEditorSurfacePhpstanIgnoreRunner,
      workbench,
      workspaceTrusted,
    ],
  );

  const renderEditorGroupContent = useCallback(
    (surface: EditorGroupSurface, groupId: EditorGroupId) => {
      if (surface.kind === "empty") {
        return renderEditorDocumentForGroup(null, groupId);
      }
      const path = surface.path;
      const historyDiffDocument = gitHistoryDiffDocuments.documentsByPath[path] ?? null;
      const worktreeDiff = workbench.gitDiffDocuments[path] ?? null;
      if (isGitHistoryDiffDocumentPath(path) && historyDiffDocument) {
        return (
          <ErrorBoundary title="Could not render this diff" resetKeys={[path]}>
            <GitDiffPreview
              diff={historyDiffDocument.diff}
              isLoading={historyDiffDocument.isLoading}
              monacoTheme={monacoTheme}
              previewIdentity={path}
              editorFontFamily={workbench.appSettings.editorFontFamily}
              editorFontLigatures={workbench.appSettings.editorFontLigatures}
              editorFontSize={workbench.appSettings.editorFontSize}
              onClose={() => closeEditorGroupTab(groupId, path)}
            />
          </ErrorBoundary>
        );
      }
      if (isGitDiffDocumentPath(path) && worktreeDiff) {
        return (
          <ErrorBoundary title="Could not render this diff" resetKeys={[path]}>
            <GitDiffPreview
              diff={worktreeDiff.diff}
              isLoading={worktreeDiff.isLoading}
              monacoTheme={monacoTheme}
              previewIdentity={path}
              editorFontFamily={workbench.appSettings.editorFontFamily}
              editorFontLigatures={workbench.appSettings.editorFontLigatures}
              editorFontSize={workbench.appSettings.editorFontSize}
              gitOperationLoading={workbench.gitOperationLoading}
              canRevertChange={
                worktreeDiff.diff ? workbench.canRevertGitChange(worktreeDiff.diff.change) : false
              }
              loadFileHunks={workbench.loadGitFileHunks}
              onClose={() => closeEditorGroupTab(groupId, path)}
              onRevertFile={(change) => workbench.revertGitChanges([change])}
              onRevertHunk={workbench.revertGitHunk}
              onStageHunk={workbench.stageGitHunk}
              onUnstageHunk={workbench.unstageGitHunk}
            />
          </ErrorBoundary>
        );
      }
      const markdownPreview = workbench.markdownPreviewTabs[path];
      if (markdownPreview) {
        return <MarkdownPreview preview={markdownPreview} />;
      }
      if (!("content" in surface.document)) {
        return <ImageViewer image={surface.document as ImageTab} />;
      }
      return renderEditorDocumentForGroup(surface.document as EditorDocument, groupId);
    },
    [
      closeEditorGroupTab,
      gitHistoryDiffDocuments.documentsByPath,
      monacoTheme,
      renderEditorDocumentForGroup,
      workbench,
    ],
  );

  return (
    <main className="app-shell" data-theme={workbench.appSettings.theme} style={shellStyle}>
      <WindowChrome
        appTitle={windowTitle}
        commandContext={editorMenuCommandContext}
        commands={workbench.commands}
        onCommandError={workbench.reportCommandError}
        onQuitApplication={workbench.quitApplication}
      />

      <aside className="activity-bar" aria-label="Primary navigation">
        <button onClick={openWorkspace} title="Open workspace" type="button">
          <FolderOpen aria-hidden="true" size={20} />
        </button>
        <button onClick={showCommands} title="Commands" type="button">
          <Search aria-hidden="true" size={20} />
        </button>
        <button
          disabled={!workbench.workspaceRoot}
          onClick={workbench.openTodoPanel}
          title="TODO comments"
          type="button"
        >
          <ListChecks aria-hidden="true" size={20} />
        </button>
        <button
          disabled={!workbench.workspaceRoot}
          onClick={() => workbench.showBottomPanelView("history")}
          title="Git history"
          type="button"
        >
          <History aria-hidden="true" size={20} />
        </button>
        <button
          className="activity-bar-secondary"
          onClick={openSettings}
          title="Settings"
          type="button"
        >
          <SettingsIcon aria-hidden="true" size={20} />
        </button>
      </aside>

      <WorkbenchSidebar
        activeFileRevealSignal={activeFileRevealSignal}
        fileStatusesByPath={fileStatusesByPath}
        onOpenWorkspace={openWorkspace}
        onResizeStart={startSidebarResize}
        onShowGit={showGit}
        workbench={workbench}
      />

      <section className="editor-workbench">
        <ProjectTabs
          activeRoot={workbench.workspaceRoot}
          dirtyCount={workbench.dirtyCount}
          onActivate={workbench.activateWorkspaceTab}
          onClose={workbench.closeWorkspaceTab}
          workspaceTabs={workbench.workspaceTabs}
        />
        <header className="workbench-toolbar">
          <button
            aria-pressed={workbench.intelligenceMode === "fullSmart"}
            className={
              workbench.intelligenceMode === "fullSmart"
                ? "smart-mode-switch active"
                : "smart-mode-switch"
            }
            disabled={!workbench.workspaceRoot}
            onClick={toggleSmartMode}
            type="button"
          >
            <span>IDE Mode</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </button>
          <span className="toolbar-status">
            {smartModeSummary(
              workbench.workspaceRoot,
              workbench.intelligenceMode,
              workbench.languageServerRuntimeStatus,
              workbench.languageServerPlan,
              workspaceTrusted,
            )}
          </span>
          {ideProgress.text ? (
            <button
              aria-live="polite"
              className={`toolbar-progress ${ideProgress.state}`}
              onClick={showProgressPanel}
              title={ideProgress.text}
              type="button"
            >
              {ideProgress.state === "problem" ? (
                <TriangleAlert aria-hidden="true" size={14} />
              ) : (
                <LoaderCircle aria-hidden="true" className="toolbar-progress-spinner" size={14} />
              )}
              <span className="toolbar-progress-text">{ideProgress.text}</span>
            </button>
          ) : null}
          {workbench.workspaceRoot ? (
            <span className="toolbar-status">{indexToolbarLabel(workbench.indexProgress)}</span>
          ) : null}
          {workbench.workspaceRoot && !workspaceTrusted ? (
            <button className="toolbar-action" onClick={trustWorkspace} type="button">
              Trust
            </button>
          ) : null}
        </header>
        {workbench.externalFileConflictState.conflict ? (
          <ExternalFileConflictBar
            busyAction={
              workbench.externalFileConflictState.status === "resolving"
                ? workbench.externalFileConflictState.action
                : null
            }
            conflict={workbench.externalFileConflictState.conflict}
            disabledActions={
              workbench.externalFileConflictState.conflict.kind === "renamed" ? ["overwrite"] : []
            }
            error={workbench.externalFileConflictState.error}
            onAction={workbench.handleExternalFileConflictAction}
          />
        ) : null}
        <EditorRuntimeHost
          debugHover={workbench.debugSession.debugHover}
          onGroupFocusRunnerChange={updateEditorGroupFocusRunner}
        >
          <EditorArea
            documents={editorAreaDocuments}
            editorSessionOwnerKey={editorSessionOwnerKey}
            fileStatusesByPath={fileStatusesByPath}
            onActivateGroup={workbench.activateEditorGroup}
            onActivateTab={activateEditorGroupTab}
            onCloseTab={closeEditorGroupTab}
            onMoveTab={workbench.moveEditorGroupTab}
            onPinTab={workbench.pinEditorGroupTab}
            onReorderTab={(groupId, fromPath, toPath, position) =>
              workbench.reorderEditorGroupTab?.(groupId, fromPath, toPath, position)
            }
            onResizeSplit={(splitPath, sizes) => workbench.resizeEditorSplit?.(splitPath, sizes)}
            projectId={workbench.workspaceRoot ?? "no-workspace"}
            renderContent={renderEditorGroupContent}
            state={editorGroupsState}
          />
        </EditorRuntimeHost>
        {workbench.bottomPanelVisible ? (
          <BottomPanel
            {...frameworkBottomPanels}
            {...phpTestPanel}
            activeView={workbench.bottomPanelView}
            artisanRoutes={artisanRoutes.filteredRoutes}
            artisanRoutesError={artisanRoutes.error}
            artisanRoutesLoading={artisanRoutes.loading}
            artisanRoutesQuery={artisanRoutes.query}
            artisanRoutesTotal={artisanRoutes.total}
            artisanRoutesUnavailable={artisanRoutes.unavailable}
            debug={debugPanel}
            expressRoutesPanel={expressRoutesPanel}
            hasArtisan={workbench.hasArtisan}
            hasExpressRoutes={!!workbench.workspaceDescriptor?.javaScriptTypeScript}
            hasJsWorkspace={!!workbench.workspaceDescriptor?.javaScriptTypeScript}
            hasPhpWorkspace={!!workbench.workspaceDescriptor?.php}
            indexHealthLogs={workbench.indexHealthLogs}
            indexProgress={workbench.indexProgress}
            notices={workbench.notices}
            onClearProblems={workbench.clearNotices}
            onClose={() => {
              artisanRoutes.clear();
              phpTestResults.clear();
              workbench.hideBottomPanel();
            }}
            onHardReindex={workbench.startHardReindex}
            onArtisanRoutesQueryChange={artisanRoutes.setQuery}
            onOpenArtisanController={(action) => {
              void workbench.openArtisanController(action);
            }}
            onRefreshArtisanRoutes={artisanRoutes.refresh}
            jsTestExplorer={jsTestExplorerPanel}
            onOpenProblem={workbench.openProblemNotice}
            onPhpReindex={workbench.startPhpReindex}
            onRevealDirectoryInTree={workbench.revealDirectoryInTree}
            onResizeStart={startBottomPanelResize}
            onSelectView={selectBottomPanelView}
            onSoftReindex={workbench.startIndexScan}
            gitHistoryGateway={gitHistoryGateway}
            runtimeObservabilityGateway={runtimeObservabilityGateway}
            runtimeMode={workbench.intelligenceMode}
            getLatencySnapshot={workbench.getLatencySnapshot}
            onOpenCommitFileDiff={gitHistoryDiffDocuments.openCommitDiff}
            onTerminalSessionReady={workbench.registerActiveTerminalSession}
            onTrustWorkspace={trustWorkspace}
            terminalGateway={terminalGateway}
            terminalOwnerKey={workspaceId}
            terminalShellIntegrationEnabled={workbench.appSettings.terminalShellIntegrationEnabled}
            terminalTheme={terminalTheme}
            workspaceTrusted={workspaceTrusted}
            workspaceRoot={workbench.workspaceRoot}
          />
        ) : null}
      </section>

      <StatusBar
        activeLanguage={activeLanguage}
        activePath={workbench.activePath}
        cursorPosition={workbench.activeEditorPosition}
        dirtyCount={workbench.dirtyCount}
        errorCount={workbench.diagnosticsSummary.errors}
        gitBranch={workbench.gitBranch ?? workbench.gitStatus?.branch ?? null}
        gitBranchRepositoryLabel={workbench.gitBranchRepositoryLabel}
        intelligenceMode={workbench.intelligenceMode}
        largeDocumentStatus={activeLargeDocumentStatus}
        message={workbench.message}
        nodeRunStatus={
          workbench.nodeRunWithoutDebugging.state
            ? presentNodeRunWithoutDebugging(workbench.nodeRunWithoutDebugging.state)
            : null
        }
        onChangeVisibility={workbench.setStatusBarItemVisibility}
        onOpenRuntimePanel={openRuntimePanel}
        onStopNodeRun={workbench.nodeRunWithoutDebugging.stop}
        onShowGitBranches={workbench.openGitBranchPanel}
        onShowGoToLine={showGoToLine}
        onShowProblems={showProblemsPanel}
        statusBar={workbench.workspaceSettings.statusBar}
        warningCount={workbench.diagnosticsSummary.warnings}
        workspaceRoot={workbench.workspaceRoot}
        workspaceInfoLabel={workspaceLabel}
        ideActivityDetail={ideActivityChipDetail}
        ideActivityLabel={ideActivity.label}
        ideActivityState={ideActivity.state}
        workspaceTrustLabel={
          workbench.workspaceRoot ? (workspaceTrusted ? "Trusted" : "Untrusted") : null
        }
      />

      <NoticeToastHost notices={workbench.notices} renderNotice={renderNoticeToast} />

      <DirtyCloseDecisionDialogHost coordinator={dirtyCloseDecisionCoordinator} />
      <NodeRunConfigurationPickerHost
        launcher={workbench.nodeRunWithoutDebugging.configurationLauncher}
      />
      <NodeDebugAttachProcessPickerHost controller={workbench.nodeDebugAttachProcessPicker} />
      <PhpChangeSignatureDialog
        onAdd={phpChangeSignature.addRow}
        onApply={phpChangeSignature.apply}
        onClose={phpChangeSignature.close}
        onRowsChange={phpChangeSignature.updateRows}
        state={phpChangeSignature.state}
      />

      <CommandPalette
        commands={workbench.commands}
        context={workbench.commandContext}
        isOpen={workbench.paletteOpen}
        onCommandError={workbench.reportCommandError}
        onClose={() => workbench.setPaletteOpen(false)}
      />

      <ArtisanMakePalette
        isOpen={workbench.artisanMakePaletteOpen}
        onClose={workbench.closeArtisanMakePalette}
        runInActiveTerminal={workbench.runInActiveTerminal}
      />

      <QuickOpen
        isLoading={workbench.quickOpenLoading}
        isOpen={workbench.quickOpenOpen}
        onChangeQuery={workbench.setQuickOpenQuery}
        onClose={() => workbench.setQuickOpenOpen(false)}
        onOpen={workbench.openSearchResult}
        query={workbench.quickOpenQuery}
        results={workbench.quickOpenResults}
      />

      <RecentFilesSwitcher
        entries={workbench.recentFilesSwitcherEntries}
        isOpen={workbench.recentFilesSwitcherOpen}
        onClose={() => workbench.setRecentFilesSwitcherOpen(false)}
        onOpen={workbench.openRecentFile}
      />

      <RecentLocationsPanel
        isOpen={workbench.recentLocationsPanelOpen}
        locations={workbench.recentLocations}
        onClose={() => workbench.setRecentLocationsPanelOpen(false)}
        onOpen={workbench.openRecentLocation}
      />

      <ClassOpen
        isLoading={workbench.classOpenLoading}
        isOpen={workbench.classOpenOpen}
        onChangeQuery={workbench.setClassOpenQuery}
        onClose={() => workbench.setClassOpenOpen(false)}
        onOpen={workbench.openClassSearchResult}
        query={workbench.classOpenQuery}
        results={workbench.classOpenResults}
      />

      <WorkspaceSymbols
        isLoading={workbench.workspaceSymbolsLoading}
        isOpen={workbench.workspaceSymbolsOpen}
        onChangeQuery={workbench.setWorkspaceSymbolsQuery}
        onClose={() => workbench.setWorkspaceSymbolsOpen(false)}
        onOpen={workbench.openWorkspaceSymbolResult}
        query={workbench.workspaceSymbolsQuery}
        results={workbench.workspaceSymbolsResults}
      />

      <SearchEverywhere
        isLoading={workbench.searchEverywhereLoading}
        isOpen={workbench.searchEverywhereOpen}
        model={workbench.searchEverywhereModel}
        onActivate={workbench.activateSearchEverywhereItem}
        onChangeQuery={workbench.setSearchEverywhereQuery}
        onClose={() => workbench.setSearchEverywhereOpen(false)}
        query={workbench.searchEverywhereQuery}
      />

      <TextSearch
        dismissedPaths={workbench.dismissedTextSearchPaths}
        isLoading={workbench.textSearchLoading}
        isOpen={workbench.textSearchOpen}
        onChangeOptions={workbench.setTextSearchOptions}
        onChangeQuery={workbench.setTextSearchQuery}
        onChangeReplacement={workbench.setTextReplacement}
        onClose={() => workbench.setTextSearchOpen(false)}
        onDismissFile={workbench.dismissTextSearchFile}
        onOpen={workbench.openTextSearchResult}
        onReplaceAll={workbench.replaceAllInPath}
        onReplaceInFile={workbench.replaceInFile}
        onRestoreDismissedFiles={workbench.restoreDismissedTextSearchFiles}
        options={workbench.textSearchOptions}
        query={workbench.textSearchQuery}
        replaceBusy={workbench.textReplaceBusy}
        replacement={workbench.textReplacement}
        results={workbench.textSearchResults}
      />

      <FileStructure
        canIncludeInheritedMembers={workbench.fileStructureCanIncludeInheritedMembers}
        fileName={workbench.activeDocument?.name ?? null}
        isLoading={workbench.fileStructureLoading}
        isOpen={workbench.fileStructureOpen}
        onChangeScope={workbench.setFileStructureScopeMode}
        onClose={() => workbench.setFileStructureOpen(false)}
        onOpenNode={workbench.openPhpFileOutlineNode}
        outline={workbench.fileStructureOutline}
        scope={workbench.fileStructureScope}
      />

      <ImplementationChooser
        isOpen={!!workbench.implementationChooser}
        onClose={workbench.closeImplementationChooser}
        onOpen={workbench.openImplementationTarget}
        targets={workbench.implementationChooser?.targets ?? []}
        title={workbench.implementationChooser?.title ?? "Choose implementation"}
      />

      <CallHierarchy
        isOpen={!!workbench.callHierarchyView}
        onClose={workbench.closeCallHierarchy}
        onOpen={workbench.openCallHierarchyRow}
        view={workbench.callHierarchyView}
      />

      <TypeHierarchy
        isOpen={!!workbench.typeHierarchyView}
        onClose={workbench.closeTypeHierarchy}
        onOpen={workbench.openTypeHierarchyRow}
        view={workbench.typeHierarchyView}
      />

      <ReferencesPanel
        isOpen={!!workbench.referencesView}
        onClose={workbench.closeReferencesPanel}
        onOpen={workbench.openReferenceRow}
        view={workbench.referencesView}
        workspaceRoot={workbench.workspaceRoot}
      />

      <TodoPanel
        isLoading={workbench.workspaceTodosLoading}
        isOpen={workbench.todoPanelOpen}
        onClose={workbench.closeTodoPanel}
        onOpenTodo={(todo) => {
          workbench.closeTodoPanel();
          void workbench.openWorkspaceTodo(todo);
        }}
        onRefresh={() => void workbench.refreshWorkspaceTodos()}
        todos={workbench.workspaceTodos}
      />

      <BookmarksPanel
        bookmarks={workbench.bookmarks}
        isOpen={workbench.bookmarksPanelOpen}
        onClose={workbench.closeBookmarksPanel}
        onOpenBookmark={(bookmark) => {
          workbench.closeBookmarksPanel();
          void workbench.openBookmark(bookmark);
        }}
        workspaceRoot={workbench.workspaceRoot}
      />

      <FileHistoryPanel
        commits={workbench.fileHistoryCommits}
        commitsLoading={workbench.fileHistoryLoading}
        diff={workbench.fileHistoryDiff}
        diffLoading={workbench.fileHistoryDiffLoading}
        editorFontFamily={workbench.appSettings.editorFontFamily}
        editorFontLigatures={workbench.appSettings.editorFontLigatures}
        editorFontSize={workbench.appSettings.editorFontSize}
        isOpen={workbench.fileHistoryPanelOpen}
        monacoTheme={monacoTheme}
        onClose={workbench.closeFileHistory}
        onSelectCommit={(sha) => void workbench.selectFileHistoryCommit(sha)}
        relativePath={workbench.fileHistoryRelativePath}
        selectedSha={workbench.fileHistorySelectedSha}
      />

      <LocalHistoryPanel
        diff={workbench.localHistoryDiff}
        diffLoading={workbench.localHistoryDiffLoading}
        editorFontFamily={workbench.appSettings.editorFontFamily}
        editorFontLigatures={workbench.appSettings.editorFontLigatures}
        editorFontSize={workbench.appSettings.editorFontSize}
        isOpen={workbench.localHistoryPanelOpen}
        monacoTheme={monacoTheme}
        onClose={workbench.closeLocalHistory}
        onRevertVersion={(versionId) => void workbench.revertLocalHistoryVersion(versionId)}
        onSelectVersion={(versionId) => void workbench.selectLocalHistoryVersion(versionId)}
        relativePath={workbench.localHistoryRelativePath}
        selectedVersionId={workbench.localHistorySelectedId}
        versions={workbench.localHistoryVersions}
        versionsLoading={workbench.localHistoryLoading}
      />

      {workbench.externalFileConflictState.conflict && workbench.activeDocument ? (
        <ExternalFileCompareDialog
          conflict={workbench.externalFileConflictState.conflict}
          editorFontFamily={workbench.appSettings.editorFontFamily}
          editorFontLigatures={workbench.appSettings.editorFontLigatures}
          editorFontSize={workbench.appSettings.editorFontSize}
          isOpen={workbench.externalFileConflictState.compareOpen}
          language={workbench.activeDocument.language}
          liveLocalContent={workbench.activeDocument.content}
          monacoTheme={monacoTheme}
          onClose={workbench.closeExternalFileCompare}
        />
      ) : null}

      <GitStashPanel
        diff={workbench.gitStashDiff}
        diffLoading={workbench.gitStashDiffLoading}
        isLoading={workbench.gitStashLoading}
        isOpen={workbench.gitStashPanelOpen}
        message={workbench.gitStashMessage}
        onApply={(index) => void workbench.applyGitStash(index)}
        onClose={workbench.closeGitStashPanel}
        onDrop={(index) => void workbench.dropGitStash(index)}
        onMessageChange={workbench.setGitStashMessage}
        onPop={(index) => void workbench.popGitStash(index)}
        onSave={(message) => void workbench.saveGitStash(message)}
        onSelect={(index) => void workbench.selectGitStash(index)}
        selectedIndex={workbench.gitStashSelectedIndex}
        stashes={workbench.gitStashEntries}
      />

      <GitBranchPanel
        branches={workbench.gitBranchEntries}
        deleteError={workbench.notices.find((notice) => notice.source === "Git Branch") ?? null}
        isLoading={workbench.gitBranchLoading}
        isOpen={workbench.gitBranchPanelOpen}
        onClose={workbench.closeGitBranchPanel}
        onCreate={() => void workbench.createGitBranch()}
        onDelete={(name, options) => workbench.deleteGitBranch(name, options)}
        onRename={(oldName, newName) => workbench.renameGitBranch(oldName, newName)}
        onCheckoutRemote={(name) => void workbench.checkoutRemoteBranch(name)}
        onSwitch={(name) => void workbench.switchGitBranch(name)}
        remoteBranches={workbench.gitRemoteBranchEntries}
      />

      <LanguageServerSetup
        isOpen={workbench.languageServerSetupOpen}
        onClose={() => workbench.setLanguageServerSetupOpen(false)}
        isInstallingManagedPhpactor={workbench.installingManagedPhpactor}
        onInstallManagedPhpactor={workbench.installManagedPhpactor}
        plan={workbench.languageServerPlan}
      />

      <WorkbenchSettingsDialogHost
        systemFontGateway={systemFontGateway}
        workbench={workbench}
        workspaceFiles={workspaceGateways.files}
      />
    </main>
  );
}

function smartModeSummary(
  workspaceRoot: string | null,
  mode: IntelligenceMode,
  runtimeStatus: LanguageServerRuntimeStatus | null,
  plan: LanguageServerPlan | null,
  trusted: boolean,
): string {
  if (!workspaceRoot) {
    return "No workspace";
  }

  if (mode === "basic") {
    return "Lightweight";
  }

  if (mode === "lightSmart") {
    return "Smart Index";
  }

  if (!trusted) {
    return "Untrusted";
  }

  const runtimeLabel = languageServerStatusLabel(runtimeStatus, "PHPactor", {
    workspaceRoot,
  });

  if (runtimeLabel) {
    return runtimeLabel;
  }

  if (plan?.status === "ready") {
    return "IDE ready";
  }

  return "IDE setup needed";
}

function usePrefersLightTheme(): boolean {
  const [prefersLight, setPrefersLight] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    if (!window.matchMedia) {
      return false;
    }

    return window.matchMedia("(prefers-color-scheme: light)").matches;
  });

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updatePreference = () => setPrefersLight(media.matches);

    updatePreference();
    media.addEventListener("change", updatePreference);

    return () => media.removeEventListener("change", updatePreference);
  }, []);

  return prefersLight;
}

export default App;
