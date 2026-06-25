import {
  FolderOpen,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import { useNoticeToastRenderers } from "./application/useNoticeToastRenderers";
import { BookmarksPanel } from "./components/BookmarksPanel";
import { BottomPanel } from "./components/BottomPanel";
import { CallHierarchy } from "./components/CallHierarchy";
import { ClassOpen } from "./components/ClassOpen";
import { CommandPalette } from "./components/CommandPalette";
import { EditorSurface } from "./components/EditorSurface";
import { EditorTabs } from "./components/EditorTabs";
import { FileTree } from "./components/FileTree";
import { FileStructure } from "./components/FileStructure";
import { GitChangesPanel } from "./components/GitChangesPanel";
import { GitDiffPreview } from "./components/GitDiffPreview";
import { ImplementationChooser } from "./components/ImplementationChooser";
import { LanguageServerSetup } from "./components/LanguageServerSetup";
import { NoticeToastHost } from "./components/NoticeToastHost";
import { PhpTreePanel } from "./components/PhpTreePanel";
import { ProjectTabs } from "./components/ProjectTabs";
import { QuickOpen } from "./components/QuickOpen";
import { RecentFilesSwitcher } from "./components/RecentFilesSwitcher";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar, type IdeActivityState } from "./components/StatusBar";
import { TextSearch } from "./components/TextSearch";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { TodoPanel } from "./components/TodoPanel";
import { TypeHierarchy } from "./components/TypeHierarchy";
import { WindowChrome } from "./components/WindowChrome";
import { WorkspaceSymbols } from "./components/WorkspaceSymbols";
import {
  languageServerCapabilityLabels,
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import { shouldStartLanguageServer } from "./domain/intelligence";
import type { EditorPosition } from "./domain/languageServerFeatures";
import type { LanguageServerPlan } from "./domain/languageServer";
import {
  indexProgressLabel,
  type IndexProgressState,
} from "./domain/indexProgress";
import { ideProgressIndicator } from "./domain/ideProgress";
import { editorChangeHunks } from "./domain/editorChangeMarkers";
import type { GitChangeStatus } from "./domain/git";
import {
  monacoThemeForAppTheme,
  terminalThemeForAppTheme,
} from "./domain/settings";
import type {
  EditorMenuCommand,
  EditorMenuCommandRunner,
} from "./domain/editorMenuCommand";
import { javaScriptTypeScriptWorkspaceLabel } from "./domain/workspace";
import type { IntelligenceMode } from "./domain/workspace";
import { workspaceRootKeysEqual } from "./domain/workspaceRootKey";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { BrowserSettingsGateway } from "./infrastructure/browserSettingsGateway";
import {
  JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
  TauriLanguageServerDiagnosticsGateway,
} from "./infrastructure/tauriLanguageServerDiagnosticsGateway";
import {
  JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS,
  TauriLanguageServerDocumentSyncGateway,
} from "./infrastructure/tauriLanguageServerDocumentSyncGateway";
import {
  JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
  TauriLanguageServerFeaturesGateway,
} from "./infrastructure/tauriLanguageServerFeaturesGateway";
import { TauriLanguageServerGateway } from "./infrastructure/tauriLanguageServerGateway";
import { TauriSystemFontGateway } from "./infrastructure/tauriSystemFontGateway";
import {
  JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
  TauriLanguageServerRuntimeGateway,
} from "./infrastructure/tauriLanguageServerRuntimeGateway";
import {
  JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
  TauriLanguageServerRefreshGateway,
} from "./infrastructure/tauriLanguageServerRefreshGateway";
import {
  JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
  TauriLanguageServerWorkspaceEditGateway,
} from "./infrastructure/tauriLanguageServerWorkspaceEditGateway";
import { TauriIndexProgressGateway } from "./infrastructure/tauriIndexProgressGateway";
import { TauriWorkspaceFileChangeGateway } from "./infrastructure/tauriWorkspaceFileChangeGateway";
import { TauriPhpFileOutlineGateway } from "./infrastructure/tauriPhpFileOutlineGateway";
import { TauriProjectSymbolSearchGateway } from "./infrastructure/tauriProjectSymbolSearchGateway";
import { TauriGitGateway } from "./infrastructure/tauriGitGateway";
import { TauriPhpSyntaxDiagnosticsGateway } from "./infrastructure/tauriPhpSyntaxDiagnosticsGateway";
import { TauriPhpTreeGateway } from "./infrastructure/tauriPhpTreeGateway";
import { TauriSmartModeGateway } from "./infrastructure/tauriSmartModeGateway";
import { TauriTerminalGateway } from "./infrastructure/tauriTerminalGateway";
import { TauriWorkspaceGateway } from "./infrastructure/tauriWorkspaceGateway";
import { TauriWorkspaceRuntimeLifecycleGateway } from "./infrastructure/tauriWorkspaceRuntimeLifecycleGateway";
import { TauriWorkspaceTrustGateway } from "./infrastructure/tauriWorkspaceTrustGateway";
import { createAppHighlighter } from "./infrastructure/shikiHighlighter";
import "./App.css";

const workspaceGateway = new TauriWorkspaceGateway();
const projectSymbolSearchGateway = new TauriProjectSymbolSearchGateway();
const workspaceFileChangeGateway = new TauriWorkspaceFileChangeGateway();
const workspaceGateways = {
  detection: workspaceGateway,
  fileChanges: workspaceFileChangeGateway,
  fileSearch: workspaceGateway,
  files: workspaceGateway,
  phpTools: workspaceGateway,
  projectSymbols: projectSymbolSearchGateway,
  textSearch: workspaceGateway,
};
const smartModeGateway = new TauriSmartModeGateway();
const workspaceTrustGateway = new TauriWorkspaceTrustGateway();
const indexProgressGateway = new TauriIndexProgressGateway();
const phpFileOutlineGateway = new TauriPhpFileOutlineGateway();
const phpSyntaxDiagnosticsGateway = new TauriPhpSyntaxDiagnosticsGateway();
const phpTreeGateway = new TauriPhpTreeGateway();
const gitGateway = new TauriGitGateway();
const languageServerGateway = new TauriLanguageServerGateway();
const languageServerRuntimeGateway = new TauriLanguageServerRuntimeGateway();
const javaScriptTypeScriptLanguageServerRuntimeGateway =
  new TauriLanguageServerRuntimeGateway(
    undefined,
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
  );
const languageServerDocumentSyncGateway =
  new TauriLanguageServerDocumentSyncGateway();
const javaScriptTypeScriptLanguageServerDocumentSyncGateway =
  new TauriLanguageServerDocumentSyncGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS,
  );
const languageServerDiagnosticsGateway =
  new TauriLanguageServerDiagnosticsGateway();
const javaScriptTypeScriptLanguageServerDiagnosticsGateway =
  new TauriLanguageServerDiagnosticsGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT,
  );
const languageServerFeaturesGateway = new TauriLanguageServerFeaturesGateway();
const javaScriptTypeScriptLanguageServerFeaturesGateway =
  new TauriLanguageServerFeaturesGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
  );
const languageServerRefreshGateway = new TauriLanguageServerRefreshGateway();
const javaScriptTypeScriptLanguageServerRefreshGateway =
  new TauriLanguageServerRefreshGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
  );
const phpLanguageServerWorkspaceEditGateway =
  new TauriLanguageServerWorkspaceEditGateway();
const javaScriptTypeScriptLanguageServerWorkspaceEditGateway =
  new TauriLanguageServerWorkspaceEditGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
  );
const terminalGateway = new TauriTerminalGateway();
const workspaceRuntimeLifecycleGateway =
  new TauriWorkspaceRuntimeLifecycleGateway();
const settingsGateway = new BrowserSettingsGateway();
const systemFontGateway = new TauriSystemFontGateway();
const workbenchPrompter = new BrowserWorkbenchPrompter();
const EMPTY_FILE_STATUSES_BY_PATH: Record<string, GitChangeStatus> = {};

// Warm the Shiki highlighter in the background as soon as the app boots so the
// first opened file gets correct syntax colors immediately instead of showing
// the fallback theme for ~300ms while the highlighter bundle loads and inits.
//
// `createAppHighlighter` is an idempotent singleton (it caches and returns the
// same promise), so this preload only ever triggers one load. The result is
// intentionally ignored here — `setupShikiTokenization` later awaits the same
// cached promise on first file open (cache hit). Rejections are swallowed so a
// preload failure can never crash boot; the real consumer still surfaces errors.
export function preloadSyntaxHighlighter(): void {
  void createAppHighlighter().catch(() => {
    // Ignore — the highlighter is lazily re-attempted by setupShikiTokenization,
    // which handles and logs its own errors when the first file is opened.
  });
}

function App() {
  const prefersLightTheme = usePrefersLightTheme();
  useEffect(() => {
    preloadSyntaxHighlighter();
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(152);
  const [activeFileRevealSignal, setActiveFileRevealSignal] = useState(0);
  const [editorMenuCommandRunner, setEditorMenuCommandRunner] =
    useState<EditorMenuCommandRunner | null>(null);
  const fileStatusesByPathRef = useRef<Record<string, GitChangeStatus>>({});
  const workbench = useWorkbenchController(
    workspaceGateways,
    smartModeGateway,
    workspaceTrustGateway,
    indexProgressGateway,
    phpFileOutlineGateway,
    phpTreeGateway,
    gitGateway,
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
  );
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
  const activeLanguage = useMemo(
    () => workbench.activeDocument?.language ?? null,
    [workbench.activeDocument],
  );
  // Stable list of open document paths for EditorSurface's model-dispose effect.
  // openDocuments is replaced on every keystroke (fresh document objects), so we
  // re-derive the path array only when the actual set of open paths changes,
  // keeping the dispose effect from re-running on each character typed.
  // Keyed on openDocuments identity so the O(N) map/join only runs when that
  // array changes, not on every App render (e.g. LSP diagnostics streaming).
  const openDocumentPathsKey = useMemo(
    () => workbench.openDocuments.map((document) => document.path).join("\n"),
    [workbench.openDocuments],
  );
  // Depends on the joined key (a stable string), not openDocuments, so the
  // memoized array identity changes only when the set of open paths changes.
  const openDocumentPaths = useMemo(
    () => workbench.openDocuments.map((document) => document.path),
    [openDocumentPathsKey],
  );
  // Distinct file paths reachable via back/forward navigation history. Their
  // Monaco models must be kept alive so Back/Forward is a cheap model-swap
  // instead of a dispose+recreate+re-tokenization (lag). Go-to-definition
  // demotes the source file to a clean-preview replacement, dropping it from
  // openDocumentPaths even though Back still navigates to it. Workspace-scoped:
  // navigationHistory is reset/restored per workspace tab. Keyed on the joined
  // string so the dispose effect re-runs only when the reachable path set
  // actually changes, not on every cursor move that pushes a same-file location.
  // Keyed on the back/forward stack identities so the O(N) spread/map/join
  // only runs when navigation history changes, not on every App render.
  const navigationHistoryPathsKey = useMemo(
    () =>
      [
        ...workbench.navigationHistory.backStack,
        ...workbench.navigationHistory.forwardStack,
      ]
        .map((location) => location.path)
        .join("\n"),
    [
      workbench.navigationHistory.backStack,
      workbench.navigationHistory.forwardStack,
    ],
  );
  const navigationHistoryPaths = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...workbench.navigationHistory.backStack,
            ...workbench.navigationHistory.forwardStack,
          ].map((location) => location.path),
        ),
      ),
    [navigationHistoryPathsKey],
  );
  // Depend on the inputs editorChangeHunks actually reads (baseline + current
  // content strings) rather than the whole activeDocument object. A cursor move
  // hands down a new activeDocument identity with identical content, so keying
  // on the strings keeps this array reference stable and stops the downstream
  // change-hunk decoration effect from re-running when nothing changed. When the
  // content genuinely changes (a keystroke) the hunks recompute as expected.
  const activeEditorChangeHunks = useMemo(
    () =>
      workbench.activeDocument
        ? editorChangeHunks(
            workbench.activeDocumentGitBaseline ??
              workbench.activeDocument.savedContent,
            workbench.activeDocument.content,
          )
        : [],
    [
      workbench.activeDocument?.content,
      workbench.activeDocument?.savedContent,
      workbench.activeDocumentGitBaseline,
    ],
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
    const packageLabel = phpLevel
      ? `${packageName} · PHP ${phpLevel}`
      : packageName;

    if (workbench.phpTools?.phpactor) {
      return `${packageLabel} · ${toolSourceLabel(
        workbench.phpTools.phpactor.source,
      )}`;
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
  const languageServerLabel = useMemo(() => {
    if (!shouldStartLanguageServer(workbench.intelligenceMode)) {
      return null;
    }

    const runtimeLabel = languageServerStatusLabel(
      workbench.languageServerRuntimeStatus,
      "PHPactor",
      { workspaceRoot: workbench.workspaceRoot },
    );

    if (runtimeLabel) {
      const enabledCapabilities = languageServerCapabilityLabels(
        workbench.languageServerRuntimeStatus,
      );

      if (enabledCapabilities.length > 0) {
        return `${runtimeLabel} · ${enabledCapabilities.join(", ")}`;
      }

      return runtimeLabel;
    }

    const plan = workbench.languageServerPlan;

    if (!plan) {
      return null;
    }

    return languageServerPlanLabel(plan);
  }, [
    workbench.intelligenceMode,
    workbench.languageServerPlan,
    workbench.languageServerRuntimeStatus,
    workbench.workspaceRoot,
  ]);
  const javaScriptTypeScriptLanguageServerLabel = useMemo(() => {
    const runtimeLabel = languageServerStatusLabel(
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      "TS Server",
      { workspaceRoot: workbench.workspaceRoot },
    );

    if (!runtimeLabel) {
      return null;
    }

    const enabledCapabilities = languageServerCapabilityLabels(
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
    );

    if (enabledCapabilities.length > 0) {
      return `${runtimeLabel} · ${enabledCapabilities.join(", ")}`;
    }

    return runtimeLabel;
  }, [
    workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
    workbench.workspaceRoot,
  ]);
  const combinedLanguageServerLabel = useMemo(
    () =>
      [languageServerLabel, javaScriptTypeScriptLanguageServerLabel]
        .filter(Boolean)
        .join(" · ") || null,
    [javaScriptTypeScriptLanguageServerLabel, languageServerLabel],
  );
  const renderNoticeToast = useNoticeToastRenderers({
    intelligenceMode: workbench.intelligenceMode,
    onInstallManagedPhpactor: workbench.installManagedPhpactor,
    isInstallingManagedPhpactor: workbench.installingManagedPhpactor,
    onOpenLanguageServerSetup: () => workbench.setLanguageServerSetupOpen(true),
    workspaceRoot: workbench.workspaceRoot,
    workspaceTrusted: workbench.workspaceTrust?.trusted ?? false,
  });

  const ideActivity = useMemo(
    () =>
      ideActivityStatus(
        workbench.workspaceRoot,
        workbench.languageServerRuntimeStatus,
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        workbench.indexProgress,
        combinedLanguageServerLabel,
      ),
    [
      combinedLanguageServerLabel,
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
    () =>
      monacoThemeForAppTheme(
        workbench.appSettings.theme,
        prefersLightTheme,
      ),
    [prefersLightTheme, workbench.appSettings.theme],
  );
  const terminalTheme = useMemo(
    () =>
      terminalThemeForAppTheme(
        workbench.appSettings.theme,
        prefersLightTheme,
      ),
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
        setSidebarWidth(
          clamp(startWidth + moveEvent.clientX - startX, 180, 520),
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
    [sidebarWidth],
  );
  const startBottomPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomPanelHeight;
      const maxHeight = maxBottomPanelHeight(window.innerHeight);
      const handlePointerMove = (moveEvent: PointerEvent) => {
        setBottomPanelHeight(
          clamp(startHeight + startY - moveEvent.clientY, 96, maxHeight),
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
  const updateEditorMenuCommandRunner = useCallback(
    (runner: EditorMenuCommandRunner | null) => {
      setEditorMenuCommandRunner(() => runner);
    },
    [],
  );
  const runEditMenuCommand = useCallback(
    (command: EditorMenuCommand) => {
      editorMenuCommandRunner?.(command);
    },
    [editorMenuCommandRunner],
  );
  const showProblemsPanel = useCallback(() => {
    workbench.showBottomPanelView("problems");
  }, [workbench.showBottomPanelView]);
  const closeActiveTab = useCallback(() => {
    if (workbench.activeDocument) {
      workbench.closeDocument(workbench.activeDocument.path);
    }
  }, [workbench.activeDocument, workbench.closeDocument]);
  const goBack = useCallback(() => {
    void workbench.navigateBackward();
  }, [workbench.navigateBackward]);
  const goForward = useCallback(() => {
    void workbench.navigateForwardInHistory();
  }, [workbench.navigateForwardInHistory]);
  const goToDefinition = useCallback(() => {
    void workbench.goToDefinition();
  }, [workbench.goToDefinition]);
  const goToImplementationAt = useCallback(
    (position: EditorPosition) => {
      void workbench.goToImplementationAt(position);
    },
    [workbench.goToImplementationAt],
  );
  const goToSuperMethod = useCallback(() => {
    void workbench.goToSuperMethod();
  }, [workbench.goToSuperMethod]);
  const markActiveFileRevealSignal = useCallback(() => {
    setActiveFileRevealSignal((current) => current + 1);
  }, []);
  const openClass = useCallback(() => {
    if (workbench.workspaceRoot) {
      workbench.setQuickOpenOpen(false);
      workbench.setClassOpenOpen(true);
    }
  }, [
    workbench.workspaceRoot,
    workbench.setQuickOpenOpen,
    workbench.setClassOpenOpen,
  ]);
  const openFile = useCallback(() => {
    if (workbench.workspaceRoot) {
      workbench.setClassOpenOpen(false);
      workbench.setQuickOpenOpen(true);
    }
  }, [
    workbench.workspaceRoot,
    workbench.setClassOpenOpen,
    workbench.setQuickOpenOpen,
  ]);
  const editorMenuCommandContext = useMemo(() => {
    if (editorMenuCommandRunner) {
      return workbench.commandContext;
    }

    return {
      ...workbench.commandContext,
      hasActiveDocument: false,
    };
  }, [editorMenuCommandRunner, workbench.commandContext]);

  return (
    <main
      className="app-shell"
      data-theme={workbench.appSettings.theme}
      style={shellStyle}
    >
      <WindowChrome
        appTitle="Mockor Editor"
        commandContext={editorMenuCommandContext}
        commands={workbench.commands}
        onCommandError={workbench.reportCommandError}
        onEditCommand={runEditMenuCommand}
        onQuitApplication={workbench.quitApplication}
      />

      <aside className="activity-bar" aria-label="Primary navigation">
        <button
          onClick={workbench.openWorkspace}
          title="Open workspace"
          type="button"
        >
          <FolderOpen aria-hidden="true" size={20} />
        </button>
        <button
          onClick={() => workbench.setPaletteOpen(true)}
          title="Commands"
          type="button"
        >
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
          className="activity-bar-secondary"
          onClick={workbench.openSettingsPanel}
          title="Settings"
          type="button"
        >
          <SettingsIcon aria-hidden="true" size={20} />
        </button>
      </aside>

      <section className="sidebar">
        <header className="sidebar-header">
          <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">
            <button
              aria-selected={workbench.sidebarView === "files"}
              className={
                workbench.sidebarView === "files"
                  ? "sidebar-tab active"
                  : "sidebar-tab"
              }
              onClick={() => workbench.setSidebarView("files")}
              role="tab"
              type="button"
            >
              Files
            </button>
            <button
              aria-selected={workbench.sidebarView === "git"}
              className={
                workbench.sidebarView === "git"
                  ? "sidebar-tab active"
                  : "sidebar-tab"
              }
              disabled={!workbench.workspaceRoot}
              onClick={() => workbench.setSidebarView("git")}
              role="tab"
              type="button"
            >
              Git
            </button>
            <button
              aria-selected={workbench.sidebarView === "php"}
              className={
                workbench.sidebarView === "php"
                  ? "sidebar-tab active"
                  : "sidebar-tab"
              }
              disabled={!workbench.workspaceRoot}
              onClick={() => workbench.setSidebarView("php")}
              role="tab"
              type="button"
            >
              PHP
            </button>
          </div>
          {workbench.sidebarView === "php" ? (
            <button
              disabled={!workbench.workspaceRoot || workbench.phpTreeLoading}
              onClick={workbench.refreshPhpTree}
              title="Refresh PHP tree"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          ) : workbench.sidebarView === "files" ? (
            <button onClick={workbench.openWorkspace} type="button">
              Open
            </button>
          ) : null}
        </header>
        {workbench.sidebarView === "git" ? (
          <GitChangesPanel
            activeChange={workbench.selectedGitChange}
            commitMessage={workbench.gitCommitMessage}
            gitOperationLoading={workbench.gitOperationLoading}
            includedChangePaths={workbench.includedGitChangePaths}
            isLoading={workbench.gitLoading}
            onCommit={workbench.commitGitChanges}
            onCommitAndPush={workbench.commitAndPushGitChanges}
            onCommitMessageChange={workbench.setGitCommitMessage}
            onOpenChange={workbench.openGitChange}
            onPreviewChange={workbench.previewGitChange}
            onRefresh={workbench.refreshGitStatus}
            onRevertChanges={workbench.revertGitChanges}
            onStageChanges={workbench.stageGitChanges}
            onToggleChangeIncluded={workbench.toggleGitChangeIncluded}
            onUnstageChanges={workbench.unstageGitChanges}
            rootPath={workbench.workspaceRoot}
            status={workbench.gitStatus}
          />
        ) : workbench.sidebarView === "php" ? (
          <PhpTreePanel
            activePath={workbench.activePath}
            expandedNodeIds={workbench.phpTreeExpandedNodeIds}
            isLoading={workbench.phpTreeLoading}
            onOpenNode={workbench.openPhpTreeNode}
            onToggleNode={workbench.togglePhpTreeNode}
            rootPath={workbench.workspaceRoot}
            tree={workbench.phpTree}
          />
        ) : (
          <FileTree
            activePath={workbench.activePath}
            fileStatusesByPath={fileStatusesByPath}
            entriesByDirectory={workbench.entriesByDirectory}
            expandedDirectories={workbench.expandedDirectories}
            loadingDirectories={workbench.loadingDirectories}
            onOpenFile={workbench.openPinnedFile}
            onPreviewFile={workbench.previewFile}
            onToggleDirectory={workbench.toggleDirectory}
            onPrefetchFile={workbench.prefetchFile}
            onCancelPrefetchFile={workbench.cancelFilePrefetch}
            revealActivePath={
              workbench.workspaceSettings.revealActiveFileInTree
            }
            revealActivePathSignal={activeFileRevealSignal}
            rootPath={workbench.workspaceRoot}
          />
        )}
        <div
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          className="sidebar-resize-handle"
          onPointerDown={startSidebarResize}
          role="separator"
        />
      </section>

      <section className="editor-workbench">
        <ProjectTabs
          activeRoot={workbench.workspaceRoot}
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
            onClick={workbench.toggleSmartMode}
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
              workbench.workspaceTrust?.trusted ?? false,
            )}
          </span>
          {ideProgress.text ? (
            <button
              aria-live="polite"
              className={`toolbar-progress ${ideProgress.state}`}
              onClick={() =>
                workbench.showBottomPanelView(
                  ideProgress.state === "problem" ? "problems" : "index",
                )
              }
              title={ideProgress.text}
              type="button"
            >
              {ideProgress.state === "problem" ? (
                <TriangleAlert aria-hidden="true" size={14} />
              ) : (
                <LoaderCircle
                  aria-hidden="true"
                  className="toolbar-progress-spinner"
                  size={14}
                />
              )}
              <span className="toolbar-progress-text">{ideProgress.text}</span>
            </button>
          ) : null}
          {workbench.workspaceRoot ? (
            <span className="toolbar-status">
              {indexToolbarLabel(workbench.indexProgress)}
            </span>
          ) : null}
          {workbench.workspaceRoot && !workbench.workspaceTrust?.trusted ? (
            <button
              className="toolbar-action"
              onClick={workbench.toggleWorkspaceTrust}
              type="button"
            >
              Trust
            </button>
          ) : null}
        </header>
        <EditorTabs
          activePath={workbench.activePath}
          documents={workbench.openDocuments}
          fileStatusesByPath={fileStatusesByPath}
          onActivate={workbench.setActivePath}
          onClose={workbench.closeDocument}
          onPin={workbench.pinDocument}
          previewPath={workbench.previewPath}
        />
        {workbench.selectedGitChange || workbench.gitDiffLoading ? (
          <GitDiffPreview
            diff={workbench.gitDiffPreview}
            isLoading={workbench.gitDiffLoading}
            monacoTheme={monacoTheme}
            editorFontFamily={workbench.appSettings.editorFontFamily}
            editorFontLigatures={workbench.appSettings.editorFontLigatures}
            editorFontSize={workbench.appSettings.editorFontSize}
            onClose={workbench.closeGitDiffPreview}
          />
        ) : (
          <EditorSurface
            activeDocument={workbench.activeDocument}
            editorFontFamily={workbench.appSettings.editorFontFamily}
            editorFontLigatures={workbench.appSettings.editorFontLigatures}
            editorFontSize={workbench.appSettings.editorFontSize}
            isOpeningFile={workbench.isOpeningFile}
            applyJavaScriptTypeScriptLanguageServerWorkspaceEdit={
              workbench.applyJavaScriptTypeScriptLanguageServerWorkspaceEdit
            }
            applyPhpLanguageServerWorkspaceEdit={
              workbench.applyPhpLanguageServerWorkspaceEdit
            }
            bookmarkedLineNumbers={activeBookmarkedLineNumbers}
            changeHunks={activeEditorChangeHunks}
            editorRevealTarget={workbench.editorRevealTarget}
            flushPendingLanguageServerDocument={
              workbench.flushPendingLanguageServerDocument
            }
            flushPendingJavaScriptTypeScriptLanguageServerDocument={
              workbench.flushPendingJavaScriptTypeScriptLanguageServerDocument
            }
            formatOnPaste={workbench.workspaceSettings.formatOnPaste}
            gitBlameEnabled={workbench.isActiveDocumentGitBlameEnabled}
            isActiveDocumentPhpTest={workbench.isActiveDocumentPhpTest}
            isLanguageServerDocumentSynced={
              workbench.isLanguageServerDocumentSynced
            }
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
            javaScriptTypeScriptValidationEnabled={
              workbench.workspaceSettings.javaScriptTypeScriptValidation
            }
            languageServerFeaturesGateway={languageServerFeaturesGateway}
            languageServerRefreshGateway={languageServerRefreshGateway}
            languageServerDiagnosticsByPath={
              workbench.languageServerDiagnosticsByPath
            }
            languageServerRuntimeStatus={workbench.languageServerRuntimeStatus}
            keymap={workbench.appSettings.keymap}
            monacoTheme={monacoTheme}
            navigationHistoryPaths={navigationHistoryPaths}
            openDocumentPaths={openDocumentPaths}
            phpIdeReadinessVersion={workbench.phpIdeReadinessVersion}
            phpLanguageServerWorkspaceEditGateway={
              phpLanguageServerWorkspaceEditGateway
            }
            onCloseActiveTab={closeActiveTab}
            onCursorPositionChange={workbench.updateActiveEditorPosition}
            onEditorMenuCommandRunnerChange={updateEditorMenuCommandRunner}
            onGoBack={goBack}
            onGoForward={goForward}
            onGoToDefinition={goToDefinition}
            onGoToImplementationAt={goToImplementationAt}
            onGoToSuperMethod={goToSuperMethod}
            onRunTestAt={workbench.runTestAt}
            onToggleBookmarkAtLine={workbench.toggleBookmarkAtLine}
            onToggleGitBlame={workbench.toggleGitBlame}
            provideGitBlame={workbench.provideGitBlame}
            onEditorFocused={markActiveFileRevealSignal}
            onOpenClass={openClass}
            onOpenFile={openFile}
            onOpenFileStructure={workbench.openFileStructure}
            onChange={workbench.updateActiveDocument}
            onLanguageServerError={workbench.reportLanguageServerError}
            onRevealTargetHandled={workbench.clearEditorRevealTarget}
            onRevertChangeHunk={workbench.revertActiveEditorChangeHunk}
            phpSyntaxDiagnosticsGateway={phpSyntaxDiagnosticsGateway}
            provideBladeCompletions={workbench.provideBladeCompletions}
            provideBladeDefinition={workbench.provideBladeDefinition}
            providePhpCodeActions={workbench.providePhpCodeActions}
            providePhpLaravelDefinition={workbench.providePhpLaravelDefinition}
            phpInlayHintsEnabled={workbench.workspaceSettings.phpInlayHints}
            providePhpMethodCompletions={workbench.providePhpMethodCompletions}
            providePhpMethodSignature={workbench.providePhpMethodSignature}
            providePhpParameterInlayHints={
              workbench.providePhpParameterInlayHints
            }
            workspaceRoot={workbench.workspaceRoot}
          />
        )}
        {workbench.bottomPanelVisible ? (
          <BottomPanel
            activeView={workbench.bottomPanelView}
            indexHealthLogs={workbench.indexHealthLogs}
            indexProgress={workbench.indexProgress}
            notices={workbench.notices}
            onClearProblems={workbench.clearNotices}
            onClose={workbench.hideBottomPanel}
            onHardReindex={workbench.startHardReindex}
            onOpenProblem={workbench.openProblemNotice}
            onPhpReindex={workbench.startPhpReindex}
            onResizeStart={startBottomPanelResize}
            onSelectView={workbench.showBottomPanelView}
            onSoftReindex={workbench.startIndexScan}
            onTerminalSessionReady={workbench.registerActiveTerminalSession}
            onTrustWorkspace={workbench.toggleWorkspaceTrust}
            terminalGateway={terminalGateway}
            terminalTheme={terminalTheme}
            workspaceTrusted={workbench.workspaceTrust?.trusted ?? false}
            workspaceRoot={workbench.workspaceRoot}
          />
        ) : null}
      </section>

      <StatusBar
        activeLanguage={activeLanguage}
        activePath={workbench.activePath}
        dirtyCount={workbench.dirtyCount}
        errorCount={workbench.diagnosticsSummary.errors}
        intelligenceMode={workbench.intelligenceMode}
        message={workbench.message}
        onChangeVisibility={workbench.setStatusBarItemVisibility}
        onShowProblems={showProblemsPanel}
        statusBar={workbench.workspaceSettings.statusBar}
        warningCount={workbench.diagnosticsSummary.warnings}
        workspaceRoot={workbench.workspaceRoot}
        workspaceInfoLabel={workspaceLabel}
        ideActivityLabel={ideActivity.label}
        ideActivityState={ideActivity.state}
        workspaceTrustLabel={
          workbench.workspaceRoot
            ? workbench.workspaceTrust?.trusted
              ? "Trusted"
              : "Untrusted"
            : null
        }
      />

      <NoticeToastHost
        notices={workbench.notices}
        renderNotice={renderNoticeToast}
      />

      <CommandPalette
        commands={workbench.commands}
        context={workbench.commandContext}
        isOpen={workbench.paletteOpen}
        onCommandError={workbench.reportCommandError}
        onClose={() => workbench.setPaletteOpen(false)}
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

      <TextSearch
        isLoading={workbench.textSearchLoading}
        isOpen={workbench.textSearchOpen}
        onChangeOptions={workbench.setTextSearchOptions}
        onChangeQuery={workbench.setTextSearchQuery}
        onClose={() => workbench.setTextSearchOpen(false)}
        onOpen={workbench.openTextSearchResult}
        options={workbench.textSearchOptions}
        query={workbench.textSearchQuery}
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
        isOpen={Boolean(workbench.implementationChooser)}
        onClose={workbench.closeImplementationChooser}
        onOpen={workbench.openImplementationTarget}
        targets={workbench.implementationChooser?.targets ?? []}
        title={
          workbench.implementationChooser?.title ?? "Choose implementation"
        }
      />

      <CallHierarchy
        isOpen={Boolean(workbench.callHierarchyView)}
        onClose={workbench.closeCallHierarchy}
        onOpen={workbench.openCallHierarchyRow}
        view={workbench.callHierarchyView}
      />

      <TypeHierarchy
        isOpen={Boolean(workbench.typeHierarchyView)}
        onClose={workbench.closeTypeHierarchy}
        onOpen={workbench.openTypeHierarchyRow}
        view={workbench.typeHierarchyView}
      />

      <ReferencesPanel
        isOpen={Boolean(workbench.referencesView)}
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

      <LanguageServerSetup
        isOpen={workbench.languageServerSetupOpen}
        onClose={() => workbench.setLanguageServerSetupOpen(false)}
        isInstallingManagedPhpactor={workbench.installingManagedPhpactor}
        onInstallManagedPhpactor={workbench.installManagedPhpactor}
        plan={workbench.languageServerPlan}
      />

      <SettingsDialog
        appSettings={workbench.appSettings}
        initialSection={workbench.settingsInitialSection}
        isOpen={workbench.settingsOpen}
        onClose={() => workbench.setSettingsOpen(false)}
        onOpenJavaScriptTypeScriptServiceLog={
          workbench.openJavaScriptTypeScriptServiceLog
        }
        onRestartJavaScriptTypeScriptService={
          workbench.restartJavaScriptTypeScriptService
        }
        onSave={({ appSettings, trusted, workspaceSettings }) =>
          workbench.saveWorkbenchSettings(
            appSettings,
            workspaceSettings,
            trusted,
          )
        }
        phpTools={workbench.phpTools}
        systemFontGateway={systemFontGateway}
        workspaceDescriptor={workbench.workspaceDescriptor}
        workspaceRoot={workbench.workspaceRoot}
        workspaceSettings={workbench.workspaceSettings}
        workspaceTrust={workbench.workspaceTrust}
      />
    </main>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function maxBottomPanelHeight(viewportHeight: number): number {
  return Math.max(96, Math.min(viewportHeight * 0.7, 520));
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

export function ideActivityStatus(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
  languageServerLabel: string | null,
): { label: string | null; state: IdeActivityState | null } {
  const labels = [
    compactLanguageServerActivityLabel(languageServerLabel),
    compactIndexActivityLabel(indexProgress),
  ].filter((label): label is string => Boolean(label));

  if (labels.length === 0) {
    return { label: null, state: null };
  }

  return {
    label: `IDE: ${labels.join(" · ")}`,
    state: ideActivityState(
      workspaceRoot,
      phpRuntimeStatus,
      javaScriptTypeScriptRuntimeStatus,
      indexProgress,
    ),
  };
}

function compactLanguageServerActivityLabel(label: string | null): string | null {
  if (!label) {
    return null;
  }

  return label
    .replace(/PHPactor:/g, "PHPactor")
    .replace(/TS Server:/g, "TS Server");
}

function compactIndexActivityLabel(progress: IndexProgressState): string | null {
  if (progress.status === "idle") {
    return null;
  }

  if (progress.status === "scanning") {
    return "Index scanning";
  }

  if (progress.status === "failed") {
    return "Index failed";
  }

  const suffix =
    progress.erroredEntries > 0 ? ` · ${progress.erroredEntries} errors` : "";

  return `Index ${progress.indexedFiles} files${suffix}`;
}

export function ideActivityState(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
): IdeActivityState {
  const phpRuntimeKind = runtimeStatusKindForWorkspace(
    phpRuntimeStatus,
    workspaceRoot,
  );
  const javaScriptTypeScriptRuntimeKind = runtimeStatusKindForWorkspace(
    javaScriptTypeScriptRuntimeStatus,
    workspaceRoot,
  );

  if (
    phpRuntimeKind === "crashed" ||
    javaScriptTypeScriptRuntimeKind === "crashed" ||
    indexProgress.status === "failed" ||
    indexProgress.erroredEntries > 0
  ) {
    return "problem";
  }

  if (
    phpRuntimeKind === "starting" ||
    javaScriptTypeScriptRuntimeKind === "starting" ||
    indexProgress.status === "scanning"
  ) {
    return "scanning";
  }

  if (
    phpRuntimeKind === "running" ||
    javaScriptTypeScriptRuntimeKind === "running" ||
    indexProgress.status === "completed"
  ) {
    return "active";
  }

  return "idle";
}

function runtimeStatusKindForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
): LanguageServerRuntimeStatus["kind"] | null {
  if (!status) {
    return null;
  }

  if (!workspaceRoot) {
    return status.kind;
  }

  if (!status.rootPath || !workspaceRootKeysEqual(status.rootPath, workspaceRoot)) {
    return null;
  }

  return status.kind;
}

function indexToolbarLabel(progress: IndexProgressState): string {
  const label = indexProgressLabel(progress);

  if (label) {
    return label;
  }

  return "Index: idle";
}

function languageServerPlanLabel(plan: LanguageServerPlan): string {
  if (plan.status === "ready") {
      return "PHP IDE engine ready";
  }

  if (plan.status === "blocked") {
    return `LSP blocked · ${languageServerPlanReason(plan.message)}`;
  }

  return `LSP unavailable · ${languageServerPlanReason(plan.message)}`;
}

function languageServerPlanReason(message: string): string {
  if (
    message.includes("PHPactor was not found") ||
    message.includes("Managed PHP IDE engine was not found")
  ) {
    return "IDE engine missing";
  }

  if (message.includes("not a PHP Composer project")) {
    return "Not PHP Composer";
  }

  if (message.includes("Trust this workspace")) {
    return "Trust required";
  }

  return message;
}

function isJavaScriptTypeScriptLanguage(language: string | null): boolean {
  return language === "javascript" || language === "typescript";
}

function toolSourceLabel(source: string): string {
  if (source === "managed") {
    return "Managed IDE engine";
  }

  if (source === "workspaceVendorBin") {
    return "Project PHPactor";
  }

  return "PATH PHPactor";
}

function areFileStatusesByPathEqual(
  left: Record<string, GitChangeStatus>,
  right: Record<string, GitChangeStatus>,
): boolean {
  if (left === right) {
    return true;
  }

  const leftKeys = Object.keys(left);

  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }

  return leftKeys.every((path) => left[path] === right[path]);
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
