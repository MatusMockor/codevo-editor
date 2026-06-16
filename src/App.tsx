import {
  FolderOpen,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import { BottomPanel } from "./components/BottomPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorSurface } from "./components/EditorSurface";
import { EditorTabs } from "./components/EditorTabs";
import { FileTree } from "./components/FileTree";
import { FileStructure } from "./components/FileStructure";
import { LanguageServerSetup } from "./components/LanguageServerSetup";
import { PhpTreePanel } from "./components/PhpTreePanel";
import { QuickOpen } from "./components/QuickOpen";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { TextSearch } from "./components/TextSearch";
import {
  languageServerCapabilityLabels,
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import type { LanguageServerPlan } from "./domain/languageServer";
import { indexProgressLabel } from "./domain/indexProgress";
import {
  monacoThemeForAppTheme,
  terminalThemeForAppTheme,
} from "./domain/settings";
import { isDirty, type IntelligenceMode } from "./domain/workspace";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { BrowserSettingsGateway } from "./infrastructure/browserSettingsGateway";
import { TauriLanguageServerDiagnosticsGateway } from "./infrastructure/tauriLanguageServerDiagnosticsGateway";
import { TauriLanguageServerDocumentSyncGateway } from "./infrastructure/tauriLanguageServerDocumentSyncGateway";
import { TauriLanguageServerFeaturesGateway } from "./infrastructure/tauriLanguageServerFeaturesGateway";
import { TauriLanguageServerGateway } from "./infrastructure/tauriLanguageServerGateway";
import { TauriLanguageServerRuntimeGateway } from "./infrastructure/tauriLanguageServerRuntimeGateway";
import { TauriIndexProgressGateway } from "./infrastructure/tauriIndexProgressGateway";
import { TauriPhpFileOutlineGateway } from "./infrastructure/tauriPhpFileOutlineGateway";
import { TauriPhpTreeGateway } from "./infrastructure/tauriPhpTreeGateway";
import { TauriSmartModeGateway } from "./infrastructure/tauriSmartModeGateway";
import { TauriTerminalGateway } from "./infrastructure/tauriTerminalGateway";
import { TauriWorkspaceGateway } from "./infrastructure/tauriWorkspaceGateway";
import { TauriWorkspaceTrustGateway } from "./infrastructure/tauriWorkspaceTrustGateway";
import "./App.css";

const workspaceGateway = new TauriWorkspaceGateway();
const workspaceGateways = {
  detection: workspaceGateway,
  fileSearch: workspaceGateway,
  files: workspaceGateway,
  phpTools: workspaceGateway,
  textSearch: workspaceGateway,
};
const smartModeGateway = new TauriSmartModeGateway();
const workspaceTrustGateway = new TauriWorkspaceTrustGateway();
const indexProgressGateway = new TauriIndexProgressGateway();
const phpFileOutlineGateway = new TauriPhpFileOutlineGateway();
const phpTreeGateway = new TauriPhpTreeGateway();
const languageServerGateway = new TauriLanguageServerGateway();
const languageServerRuntimeGateway = new TauriLanguageServerRuntimeGateway();
const languageServerDocumentSyncGateway =
  new TauriLanguageServerDocumentSyncGateway();
const languageServerDiagnosticsGateway =
  new TauriLanguageServerDiagnosticsGateway();
const languageServerFeaturesGateway = new TauriLanguageServerFeaturesGateway();
const terminalGateway = new TauriTerminalGateway();
const settingsGateway = new BrowserSettingsGateway();
const workbenchPrompter = new BrowserWorkbenchPrompter();

function App() {
  const prefersLightTheme = usePrefersLightTheme();
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(152);
  const workbench = useWorkbenchController(
    workspaceGateways,
    smartModeGateway,
    workspaceTrustGateway,
    indexProgressGateway,
    phpFileOutlineGateway,
    phpTreeGateway,
    languageServerGateway,
    languageServerRuntimeGateway,
    languageServerDocumentSyncGateway,
    languageServerDiagnosticsGateway,
    languageServerFeaturesGateway,
    settingsGateway,
    workbenchPrompter,
  );
  const activeDocumentDirty = Boolean(
    workbench.activeDocument && isDirty(workbench.activeDocument),
  );

  const activeLanguage = useMemo(
    () => workbench.activeDocument?.language ?? null,
    [workbench.activeDocument],
  );
  const workspaceLabel = useMemo(() => {
    const php = workbench.workspaceDescriptor?.php;

    if (!php) {
      return null;
    }

    const packageName = php.packageName || "PHP Composer";

    if (workbench.phpTools?.phpactor) {
      return `${packageName} · PHPactor`;
    }

    if (workbench.phpTools?.intelephense) {
      return `${packageName} · Intelephense`;
    }

    return `${packageName} · PHP tools missing`;
  }, [workbench.phpTools, workbench.workspaceDescriptor]);
  const languageServerLabel = useMemo(() => {
    const runtimeLabel = languageServerStatusLabel(
      workbench.languageServerRuntimeStatus,
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

    if (plan.status === "ready") {
      return "PHPactor LSP ready";
    }

    if (plan.status === "blocked") {
      return "LSP blocked";
    }

    return "LSP unavailable";
  }, [workbench.languageServerPlan, workbench.languageServerRuntimeStatus]);
  const indexLabel = useMemo(
    () => indexProgressLabel(workbench.indexProgress),
    [workbench.indexProgress],
  );
  const activeOutline = workbench.activeDocument
    ? workbench.phpFileOutlinesByPath[workbench.activeDocument.path] ?? null
    : null;
  const activeOutlineLoading = Boolean(
    workbench.activeDocument &&
      workbench.loadingPhpFileOutlinePaths.has(workbench.activeDocument.path),
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
          disabled={!activeDocumentDirty}
          onClick={workbench.saveActiveDocument}
          title="Save"
          type="button"
        >
          <Save aria-hidden="true" size={20} />
        </button>
        <button
          disabled={!workbench.workspaceRoot}
          onClick={workbench.toggleSmartMode}
          title="Toggle Smart mode"
          type="button"
        >
          <Zap aria-hidden="true" size={20} />
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
          ) : (
            <button onClick={workbench.openWorkspace} type="button">
              Open
            </button>
          )}
        </header>
        {workbench.sidebarView === "php" ? (
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
            entriesByDirectory={workbench.entriesByDirectory}
            expandedPhpFilePaths={workbench.expandedPhpFilePaths}
            expandedDirectories={workbench.expandedDirectories}
            loadingPhpFileOutlinePaths={workbench.loadingPhpFileOutlinePaths}
            loadingDirectories={workbench.loadingDirectories}
            onOpenFile={workbench.openFile}
            onPreviewFile={workbench.previewFile}
            onOpenPhpFileOutlineNode={workbench.openPhpFileOutlineNode}
            onToggleDirectory={workbench.toggleDirectory}
            onTogglePhpFileOutline={workbench.togglePhpFileOutline}
            onTogglePhpFileOutlineNode={workbench.togglePhpFileOutlineNode}
            phpFileOutlineExpandedNodeIds={
              workbench.phpFileOutlineExpandedNodeIds
            }
            phpFileOutlinesByPath={workbench.phpFileOutlinesByPath}
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
        <header className="workbench-toolbar">
          <div aria-label="Editor intelligence mode" className="mode-switch">
            <button
              aria-pressed={workbench.intelligenceMode === "basic"}
              className={
                workbench.intelligenceMode === "basic" ? "active" : ""
              }
              disabled={!workbench.workspaceRoot}
              onClick={() => workbench.setSmartMode("basic")}
              type="button"
            >
              Light
            </button>
            <button
              aria-pressed={workbench.intelligenceMode !== "basic"}
              className={
                workbench.intelligenceMode !== "basic" ? "active" : ""
              }
              disabled={!workbench.workspaceRoot}
              onClick={() => workbench.setSmartMode("fullSmart")}
              type="button"
            >
              Smart
            </button>
          </div>
          <span className="toolbar-status">
            {smartModeSummary(
              Boolean(workbench.workspaceRoot),
              workbench.intelligenceMode,
              workbench.languageServerRuntimeStatus,
              workbench.languageServerPlan,
              workbench.workspaceTrust?.trusted ?? false,
            )}
          </span>
          {workbench.workspaceRoot && !workbench.workspaceTrust?.trusted ? (
            <button
              className="toolbar-action"
              onClick={workbench.toggleWorkspaceTrust}
              type="button"
            >
              Trust
            </button>
          ) : null}
          {workbench.workspaceSettings.autoSave ? (
            <span className="toolbar-status">Auto Save</span>
          ) : null}
        </header>
        <EditorTabs
          activePath={workbench.activePath}
          documents={workbench.openDocuments}
          onActivate={workbench.setActivePath}
          onClose={workbench.closeDocument}
          onPin={workbench.pinDocument}
          previewPath={workbench.previewPath}
        />
        <EditorSurface
          activeDocument={workbench.activeDocument}
          editorRevealTarget={workbench.editorRevealTarget}
          flushPendingLanguageServerDocument={
            workbench.flushPendingLanguageServerDocument
          }
          languageServerFeaturesGateway={languageServerFeaturesGateway}
          languageServerDiagnosticsByPath={
            workbench.languageServerDiagnosticsByPath
          }
          languageServerRuntimeStatus={workbench.languageServerRuntimeStatus}
          monacoTheme={monacoTheme}
          onCursorPositionChange={workbench.updateActiveEditorPosition}
          onChange={workbench.updateActiveDocument}
          onLanguageServerError={workbench.reportLanguageServerError}
          onRevealTargetHandled={workbench.clearEditorRevealTarget}
        />
        <BottomPanel
          activeView={workbench.bottomPanelView}
          indexHealthLogs={workbench.indexHealthLogs}
          indexProgress={workbench.indexProgress}
          notices={workbench.notices}
          onClearProblems={workbench.clearNotices}
          onHardReindex={workbench.startHardReindex}
          onPhpReindex={workbench.startPhpReindex}
          onResizeStart={startBottomPanelResize}
          onSelectView={workbench.setBottomPanelView}
          onSoftReindex={workbench.startIndexScan}
          onTrustWorkspace={workbench.toggleWorkspaceTrust}
          terminalGateway={terminalGateway}
          terminalTheme={terminalTheme}
          workspaceTrusted={workbench.workspaceTrust?.trusted ?? false}
          workspaceRoot={workbench.workspaceRoot}
        />
      </section>

      <StatusBar
        activeLanguage={activeLanguage}
        dirtyCount={workbench.dirtyCount}
        intelligenceMode={workbench.intelligenceMode}
        message={workbench.message}
        workspaceRoot={workbench.workspaceRoot}
        workspaceLabel={workspaceLabel}
        languageServerLabel={languageServerLabel}
        indexLabel={indexLabel}
        workspaceTrustLabel={
          workbench.workspaceRoot
            ? workbench.workspaceTrust?.trusted
              ? "Trusted"
              : "Untrusted"
            : null
        }
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
        fileName={workbench.activeDocument?.name ?? null}
        isLoading={activeOutlineLoading}
        isOpen={workbench.fileStructureOpen}
        onClose={() => workbench.setFileStructureOpen(false)}
        onOpenNode={workbench.openPhpFileOutlineNode}
        outline={activeOutline}
      />

      <LanguageServerSetup
        isOpen={workbench.languageServerSetupOpen}
        onClose={() => workbench.setLanguageServerSetupOpen(false)}
        plan={workbench.languageServerPlan}
      />

      <SettingsDialog
        appSettings={workbench.appSettings}
        isOpen={workbench.settingsOpen}
        onClose={() => workbench.setSettingsOpen(false)}
        onSave={({ appSettings, trusted, workspaceSettings }) =>
          workbench.saveWorkbenchSettings(
            appSettings,
            workspaceSettings,
            trusted,
          )
        }
        phpTools={workbench.phpTools}
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
  hasWorkspace: boolean,
  mode: IntelligenceMode,
  runtimeStatus: LanguageServerRuntimeStatus | null,
  plan: LanguageServerPlan | null,
  trusted: boolean,
): string {
  if (!hasWorkspace) {
    return "No workspace";
  }

  if (!trusted) {
    return "Untrusted";
  }

  const runtimeLabel = languageServerStatusLabel(runtimeStatus);

  if (runtimeLabel) {
    return runtimeLabel;
  }

  if (mode !== "basic" && plan?.status === "ready") {
    return "Smart ready";
  }

  if (mode !== "basic") {
    return "Smart setup needed";
  }

  return "Lightweight";
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
