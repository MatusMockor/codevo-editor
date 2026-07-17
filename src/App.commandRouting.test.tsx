// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialIndexProgress } from "./domain/indexProgress";

const mocks = vi.hoisted(() => ({
  ideProgress: { busy: true, state: "active", text: "Working" },
  openGitBranchPanel: vi.fn(),
  runCommand: vi.fn(),
  setPaletteOpen: vi.fn(),
  showBottomPanelView: vi.fn(),
}));

vi.mock("./application/useWorkbenchController", () => ({
  useWorkbenchController: () => createWorkbench(),
}));

vi.mock("./application/useArtisanRoutes", () => ({
  useArtisanRoutes: () => ({
    clear: vi.fn(),
    error: null,
    filteredRoutes: [],
    loading: false,
    query: "",
    refresh: vi.fn(),
    setQuery: vi.fn(),
    total: 0,
    unavailable: null,
  }),
}));

vi.mock("./application/usePhpTestResults", () => ({
  usePhpTestResults: () => ({
    clear: vi.fn(),
    error: null,
    filter: null,
    isRunning: false,
    result: null,
    run: vi.fn(),
    runCase: vi.fn(),
    unavailable: null,
  }),
}));

vi.mock("./application/useScopedEditorSurfaceRunners", () => ({
  useScopedEditorSurfaceRunners: () => ({
    activateGroup: vi.fn(),
    activeRunners: {
      bufferFix: null,
      command: null,
      eslintDisable: null,
      menu: null,
      phpstanIgnore: null,
    },
    updateBufferFix: vi.fn(),
    updateCommand: vi.fn(),
    updateEslintDisable: vi.fn(),
    updateMenu: vi.fn(),
    updatePhpstanIgnore: vi.fn(),
  }),
}));

vi.mock("./application/useNoticeToastRenderers", () => ({
  useNoticeToastRenderers: () => () => null,
}));

vi.mock("./domain/ideProgress", () => ({
  ideProgressIndicator: () => mocks.ideProgress,
}));

vi.mock("./components/BottomPanel", () => ({
  BottomPanel: ({ onSelectView, onTrustWorkspace }: {
    onSelectView(view: string): void;
    onTrustWorkspace(): void;
  }) => (
    <div data-testid="bottom-panel">
      {["problems", "index", "runtime", "history", "routes", "testResults", "terminal"].map(
        (view) => (
          <button key={view} onClick={() => onSelectView(view)} type="button">
            panel-{view}
          </button>
        ),
      )}
      <button onClick={onTrustWorkspace} type="button">panel-trust</button>
    </div>
  ),
}));

vi.mock("./components/EditorArea", () => ({
  EditorArea: () => <div data-testid="editor-area" />,
}));

vi.mock("./components/EditorRuntimeHost", () => ({
  EditorRuntimeHost: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./components/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("./components/ProjectTabs", () => ({
  ProjectTabs: () => <div data-testid="project-tabs" />,
}));

vi.mock("./components/StatusBar", () => ({
  StatusBar: ({ onOpenRuntimePanel, onShowGitBranches, onShowProblems }: {
    onOpenRuntimePanel(): void;
    onShowGitBranches(): void;
    onShowProblems(): void;
  }) => (
    <div data-testid="status-bar">
      <button onClick={onOpenRuntimePanel} type="button">status-runtime</button>
      <button onClick={onShowProblems} type="button">status-problems</button>
      <button onClick={onShowGitBranches} type="button">status-branches</button>
    </div>
  ),
}));

vi.mock("./components/WindowChrome", () => ({
  WindowChrome: () => <div data-testid="window-chrome" />,
}));

import App from "./App";

describe("App command routing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    mocks.ideProgress = { busy: true, state: "active", text: "Working" };
    mocks.openGitBranchPanel.mockReset();
    mocks.runCommand.mockReset();
    mocks.setPaletteOpen.mockReset();
    mocks.showBottomPanelView.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("routes visible exact actions through runCommand", () => {
    click(buttonByTitle("Open workspace"));
    click(buttonByText("Open"));
    click(buttonByTitle("Settings"));
    click(buttonByText("Git"));
    click(buttonByText("IDE Mode"));
    click(host.querySelector<HTMLButtonElement>(".toolbar-action"));
    click(buttonByTitle("Working"));
    click(buttonByText("status-problems"));
    click(buttonByText("status-runtime"));
    click(buttonByText("panel-problems"));
    click(buttonByText("panel-index"));
    click(buttonByText("panel-runtime"));
    click(buttonByText("panel-trust"));

    expect(mocks.runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "workspace.open",
      "workspace.open",
      "workbench.openSettings",
      "git.show",
      "smart.toggle",
      "workspace.trust",
      "panel.showIndex",
      "panel.showProblems",
      "runtime.show",
      "panel.showProblems",
      "panel.showIndex",
      "runtime.show",
      "workspace.trust",
    ]);
  });

  it("routes the Commands activity through the registry without a direct state fallback", () => {
    mocks.runCommand.mockReturnValue("disabled");

    click(buttonByTitle("Commands"));

    expect(mocks.runCommand).toHaveBeenCalledOnce();
    expect(mocks.runCommand).toHaveBeenCalledWith("commands.show");
    expect(mocks.setPaletteOpen).not.toHaveBeenCalled();
  });

  it("routes problem progress while preserving unrelated direct callbacks", async () => {
    mocks.ideProgress = { busy: false, state: "problem", text: "Indexing failed" };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    click(buttonByTitle("Indexing failed"));
    click(buttonByText("panel-history"));
    click(buttonByText("panel-routes"));
    click(buttonByText("panel-testResults"));
    click(buttonByText("panel-terminal"));
    click(buttonByText("status-branches"));

    expect(mocks.runCommand).toHaveBeenCalledOnce();
    expect(mocks.runCommand).toHaveBeenCalledWith("panel.showProblems");
    expect(mocks.showBottomPanelView.mock.calls.map(([view]) => view)).toEqual([
      "history",
      "routes",
      "testResults",
      "terminal",
    ]);
    expect(mocks.openGitBranchPanel).toHaveBeenCalledOnce();
  });

  function buttonByText(text: string): HTMLButtonElement | null {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === text,
    ) ?? null;
  }

  function buttonByTitle(title: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  }
});

function click(button: HTMLButtonElement | null): void {
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function createWorkbench() {
  const noop = vi.fn();

  return new Proxy(
    {
      activeDocument: null,
      activeFrameworkActivityLabel: null,
      activePath: null,
      appSettings: {
        editorFontFamily: "Menlo, monospace",
        editorFontLigatures: false,
        editorFontSize: 13,
        keymap: "default",
        theme: "calm-dark",
        userSnippets: [],
        wordWrapEnabled: false,
      },
      bottomPanelView: "problems",
      bottomPanelVisible: true,
      bookmarks: [],
      callHierarchyView: null,
      classOpenOpen: false,
      commandContext: {},
      commands: [],
      diagnosticsSummary: { errors: 1, warnings: 0 },
      dirtyCount: 0,
      entriesByDirectory: {},
      expandedDirectories: new Set<string>(),
      externalFileConflictState: { conflict: null, status: "idle" },
      fileHistoryPanelOpen: false,
      fileStructureOpen: false,
      gitBranch: "main",
      gitBranchPanelOpen: false,
      gitBranchRepositoryLabel: null,
      gitCommitMessage: "",
      gitDiffPreview: null,
      gitLoading: false,
      gitOperationLoading: false,
      gitRepositoryMappings: [],
      gitRepositoryStatuses: [],
      gitStashPanelOpen: false,
      gitStatus: null,
      implementationChooser: null,
      includedGitChangePaths: new Set<string>(),
      indexHealthLogs: [],
      indexProgress: initialIndexProgress(),
      installingManagedPhpactor: false,
      intelligenceMode: "fullSmart",
      javaScriptTypeScriptLanguageServerRuntimeStatus: null,
      languageServerPlan: null,
      languageServerRuntimeStatus: null,
      loadingDirectories: new Set<string>(),
      localHistoryPanelOpen: false,
      markdownPreviewTabs: {},
      message: "",
      navigationHistory: { backStack: [], forwardStack: [] },
      notices: [],
      openDocuments: [],
      openGitBranchPanel: mocks.openGitBranchPanel,
      openTabs: [],
      paletteOpen: false,
      jsTestRunRequestVersion: 0,
      phpTestRunRequestVersion: 0,
      phpTreeLoading: false,
      previewPath: null,
      quickOpenOpen: false,
      recentFilesSwitcherOpen: false,
      recentLocations: [],
      recentLocationsPanelOpen: false,
      runCommand: mocks.runCommand,
      searchEverywhereModel: { sections: [] },
      searchEverywhereOpen: false,
      selectedGitChange: null,
      setPaletteOpen: mocks.setPaletteOpen,
      settingsOpen: false,
      showBottomPanelView: mocks.showBottomPanelView,
      sidebarView: "files",
      textSearchOpen: false,
      todoPanelOpen: false,
      typeHierarchyView: null,
      referencesView: null,
      workspaceDescriptor: null,
      workspaceRoot: "/workspace",
      workspaceSettings: {
        formatOnPaste: false,
        javaScriptTypeScriptCompleteFunctionCalls: false,
        javaScriptTypeScriptValidation: true,
        javaScriptTypeScriptVersion: null,
        largeFileMode: "prompt",
        phpInlayHints: false,
        phpVersionOverride: null,
        revealActiveFileInTree: false,
        statusBar: {},
      },
      workspaceSymbolsOpen: false,
      workspaceTabs: ["/workspace"],
      workspaceTodos: [],
      workspaceTrust: { trusted: false },
    },
    {
      get(target, property: string) {
        if (property in target) {
          return target[property as keyof typeof target];
        }

        return noop;
      },
    },
  );
}
