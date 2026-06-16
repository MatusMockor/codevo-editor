import {
  FolderOpen,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import { BottomPanel } from "./components/BottomPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorSurface } from "./components/EditorSurface";
import { EditorTabs } from "./components/EditorTabs";
import { FileTree } from "./components/FileTree";
import { LanguageServerSetup } from "./components/LanguageServerSetup";
import { PhpTreePanel } from "./components/PhpTreePanel";
import { QuickOpen } from "./components/QuickOpen";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { TextSearch } from "./components/TextSearch";
import {
  languageServerCapabilityLabels,
  languageServerStatusLabel,
} from "./domain/languageServerRuntime";
import { indexProgressLabel } from "./domain/indexProgress";
import {
  monacoThemeForAppTheme,
  terminalThemeForAppTheme,
} from "./domain/settings";
import { isDirty } from "./domain/workspace";
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

  return (
    <main className="app-shell" data-theme={workbench.appSettings.theme}>
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
      </section>

      <section className="editor-workbench">
        <EditorTabs
          activePath={workbench.activePath}
          documents={workbench.openDocuments}
          onActivate={workbench.setActivePath}
          onClose={workbench.closeDocument}
        />
        <EditorSurface
          activeDocument={workbench.activeDocument}
          editorRevealTarget={workbench.editorRevealTarget}
          flushPendingLanguageServerDocument={
            workbench.flushPendingLanguageServerDocument
          }
          languageServerFeaturesGateway={languageServerFeaturesGateway}
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
          onSelectView={workbench.setBottomPanelView}
          onSoftReindex={workbench.startIndexScan}
          terminalGateway={terminalGateway}
          terminalTheme={terminalTheme}
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
