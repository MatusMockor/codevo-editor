import { FolderOpen, Save, Search, Zap } from "lucide-react";
import { useMemo } from "react";
import { useWorkbenchController } from "./application/useWorkbenchController";
import { CommandPalette } from "./components/CommandPalette";
import { EditorSurface } from "./components/EditorSurface";
import { EditorTabs } from "./components/EditorTabs";
import { FileTree } from "./components/FileTree";
import { StatusBar } from "./components/StatusBar";
import { isDirty } from "./domain/workspace";
import { BrowserWorkbenchPrompter } from "./infrastructure/browserWorkbenchPrompter";
import { TauriWorkspaceGateway } from "./infrastructure/tauriWorkspaceGateway";
import "./App.css";

const workspaceGateway = new TauriWorkspaceGateway();
const workbenchPrompter = new BrowserWorkbenchPrompter();

function App() {
  const workbench = useWorkbenchController(workspaceGateway, workbenchPrompter);
  const activeDocumentDirty = Boolean(
    workbench.activeDocument && isDirty(workbench.activeDocument),
  );

  const activeLanguage = useMemo(
    () => workbench.activeDocument?.language ?? null,
    [workbench.activeDocument],
  );

  return (
    <main className="app-shell">
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
      </aside>

      <section className="sidebar">
        <header className="sidebar-header">
          <span>Files</span>
          <button onClick={workbench.openWorkspace} type="button">
            Open
          </button>
        </header>
        <FileTree
          activePath={workbench.activePath}
          entriesByDirectory={workbench.entriesByDirectory}
          expandedDirectories={workbench.expandedDirectories}
          loadingDirectories={workbench.loadingDirectories}
          onOpenFile={workbench.openFile}
          onToggleDirectory={workbench.toggleDirectory}
          rootPath={workbench.workspaceRoot}
        />
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
          onChange={workbench.updateActiveDocument}
        />
      </section>

      <StatusBar
        activeLanguage={activeLanguage}
        dirtyCount={workbench.dirtyCount}
        intelligenceMode={workbench.intelligenceMode}
        message={workbench.message}
        workspaceRoot={workbench.workspaceRoot}
      />

      <CommandPalette
        commands={workbench.commands}
        context={workbench.commandContext}
        isOpen={workbench.paletteOpen}
        onCommandError={workbench.reportCommandError}
        onClose={() => workbench.setPaletteOpen(false)}
      />
    </main>
  );
}

export default App;
