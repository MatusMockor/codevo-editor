import {
  FolderOpen,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import { useNoticeToastRenderers } from "./application/useNoticeToastRenderers";
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
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar, type IdeActivityState } from "./components/StatusBar";
import { TextSearch } from "./components/TextSearch";
import { TypeHierarchy } from "./components/TypeHierarchy";
import {
  languageServerCapabilityLabels,
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import { shouldStartLanguageServer } from "./domain/intelligence";
import type { LanguageServerPlan } from "./domain/languageServer";
import {
  indexProgressLabel,
  type IndexProgressState,
} from "./domain/indexProgress";
import { editorChangeHunks } from "./domain/editorChangeMarkers";
import type { GitChangeStatus } from "./domain/git";
import {
  monacoThemeForAppTheme,
  terminalThemeForAppTheme,
} from "./domain/settings";
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
import "./App.css";

const workspaceGateway = new TauriWorkspaceGateway();
const projectSymbolSearchGateway = new TauriProjectSymbolSearchGateway();
const workspaceGateways = {
  detection: workspaceGateway,
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
const javaScriptTypeScriptLanguageServerRefreshGateway =
  new TauriLanguageServerRefreshGateway(
    undefined,
    undefined,
    JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
  );
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
const workbenchPrompter = new BrowserWorkbenchPrompter();
const EMPTY_FILE_STATUSES_BY_PATH: Record<string, GitChangeStatus> = {};

function App() {
  const prefersLightTheme = usePrefersLightTheme();
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(152);
  const [activeFileRevealSignal, setActiveFileRevealSignal] = useState(0);
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
  const activeEditorChangeHunks = useMemo(
    () =>
      workbench.activeDocument
        ? editorChangeHunks(
            workbench.activeDocumentGitBaseline ??
              workbench.activeDocument.savedContent,
            workbench.activeDocument.content,
          )
        : [],
    [workbench.activeDocument, workbench.activeDocumentGitBaseline],
  );
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

  return (
    <main
      className="app-shell"
      data-theme={workbench.appSettings.theme}
      style={shellStyle}
    >
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
            onClose={workbench.closeGitDiffPreview}
          />
        ) : (
          <EditorSurface
            activeDocument={workbench.activeDocument}
            applyJavaScriptTypeScriptLanguageServerWorkspaceEdit={
              workbench.applyJavaScriptTypeScriptLanguageServerWorkspaceEdit
            }
            changeHunks={activeEditorChangeHunks}
            editorRevealTarget={workbench.editorRevealTarget}
            flushPendingLanguageServerDocument={
              workbench.flushPendingLanguageServerDocument
            }
            flushPendingJavaScriptTypeScriptLanguageServerDocument={
              workbench.flushPendingJavaScriptTypeScriptLanguageServerDocument
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
            languageServerDiagnosticsByPath={
              workbench.languageServerDiagnosticsByPath
            }
            languageServerRuntimeStatus={workbench.languageServerRuntimeStatus}
            keymap={workbench.appSettings.keymap}
            monacoTheme={monacoTheme}
            phpIdeReadinessVersion={workbench.phpIdeReadinessVersion}
            onCloseActiveTab={() => {
              if (workbench.activeDocument) {
                workbench.closeDocument(workbench.activeDocument.path);
              }
            }}
            onCursorPositionChange={workbench.updateActiveEditorPosition}
            onGoBack={() => void workbench.navigateBackward()}
            onGoForward={() => void workbench.navigateForwardInHistory()}
            onGoToDefinition={() => void workbench.goToDefinition()}
            onGoToImplementationAt={(position) =>
              void workbench.goToImplementationAt(position)
            }
            onEditorFocused={() =>
              setActiveFileRevealSignal((current) => current + 1)
            }
            onOpenClass={() => {
              if (workbench.workspaceRoot) {
                workbench.setQuickOpenOpen(false);
                workbench.setClassOpenOpen(true);
              }
            }}
            onOpenFile={() => {
              if (workbench.workspaceRoot) {
                workbench.setClassOpenOpen(false);
                workbench.setQuickOpenOpen(true);
              }
            }}
            onOpenFileStructure={workbench.openFileStructure}
            onChange={workbench.updateActiveDocument}
            onLanguageServerError={workbench.reportLanguageServerError}
            onRevealTargetHandled={workbench.clearEditorRevealTarget}
            onRevertChangeHunk={workbench.revertActiveEditorChangeHunk}
            phpSyntaxDiagnosticsGateway={phpSyntaxDiagnosticsGateway}
            providePhpMethodCompletions={workbench.providePhpMethodCompletions}
            providePhpMethodSignature={workbench.providePhpMethodSignature}
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
        intelligenceMode={workbench.intelligenceMode}
        message={workbench.message}
        onChangeVisibility={workbench.setStatusBarItemVisibility}
        statusBar={workbench.workspaceSettings.statusBar}
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

      <ClassOpen
        isLoading={workbench.classOpenLoading}
        isOpen={workbench.classOpenOpen}
        onChangeQuery={workbench.setClassOpenQuery}
        onClose={() => workbench.setClassOpenOpen(false)}
        onOpen={workbench.openClassSearchResult}
        query={workbench.classOpenQuery}
        results={workbench.classOpenResults}
      />

      <TextSearch
        isLoading={workbench.textSearchLoading}
        isOpen={workbench.textSearchOpen}
        onChangeQuery={workbench.setTextSearchQuery}
        onClose={() => workbench.setTextSearchOpen(false)}
        onOpen={workbench.openTextSearchResult}
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

      <LanguageServerSetup
        isOpen={workbench.languageServerSetupOpen}
        onClose={() => workbench.setLanguageServerSetupOpen(false)}
        isInstallingManagedPhpactor={workbench.installingManagedPhpactor}
        onInstallManagedPhpactor={workbench.installManagedPhpactor}
        plan={workbench.languageServerPlan}
      />

      <SettingsDialog
        appSettings={workbench.appSettings}
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
