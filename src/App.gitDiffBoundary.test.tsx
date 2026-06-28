// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff } from "./domain/git";

vi.mock("./application/useWorkbenchController", () => ({
  useWorkbenchController: () => createWorkbench(),
}));

vi.mock("./application/useNoticeToastRenderers", () => ({
  useNoticeToastRenderers: () => (notice: unknown) => String(notice),
}));

vi.mock("./components/GitDiffPreview", () => ({
  GitDiffPreview: () => {
    throw new Error("Git diff preview crashed");
  },
}));

import App from "./App";

describe("App Git diff render boundary", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("shows a recoverable notice when the Git diff branch crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not render this diff",
    );
    expect(host.textContent).toContain("Git diff preview crashed");
    expect(host.textContent).toContain("Try again");
  });
});

function createWorkbench() {
  const noop = vi.fn();
  const diff = readmeDiff();

  return new Proxy(
    {
      activeDocument: null,
      activeDocumentGitBaseline: null,
      activePath: "mockor-git-diff:worktree:/workspace/README.md",
      appSettings: {
        editorFontFamily: "Menlo, monospace",
        editorFontLigatures: false,
        editorFontSize: 13,
        keymap: "default",
        theme: "calm-dark",
        userSnippets: [],
      },
      bookmarks: [],
      bottomPanelVisible: false,
      callHierarchyView: null,
      classOpenOpen: false,
      commandContext: {},
      commands: [],
      diagnosticsSummary: { errors: 0, warnings: 0 },
      dirtyCount: 0,
      fileHistoryPanelOpen: false,
      fileStructureOpen: false,
      gitBranchPanelOpen: false,
      gitCommitMessage: "",
      gitDiffLoading: false,
      gitDiffPreview: diff,
      gitLoading: false,
      gitOperationLoading: false,
      gitStashPanelOpen: false,
      gitStatus: {
        branch: "main",
        changes: [diff.change],
        isRepository: true,
        rootPath: "/workspace",
      },
      includedGitChangePaths: new Set<string>(),
      indexProgress: { phase: "idle", scanned: 0, total: 0 },
      installingManagedPhpactor: false,
      intelligenceMode: "fullSmart",
      implementationChooser: null,
      javaScriptTypeScriptLanguageServerRuntimeStatus: null,
      languageServerPlan: null,
      languageServerRuntimeStatus: null,
      localHistoryPanelOpen: false,
      message: "",
      navigationHistory: { backStack: [], forwardStack: [] },
      notices: [],
      openDocuments: [],
      paletteOpen: false,
      phpTreeLoading: false,
      previewPath: null,
      quickOpenOpen: false,
      recentFilesSwitcherOpen: false,
      recentLocationsPanelOpen: false,
      searchEverywhereModel: { sections: [] },
      searchEverywhereOpen: false,
      selectedGitChange: diff.change,
      settingsOpen: false,
      sidebarView: "git",
      textSearchOpen: false,
      todoPanelOpen: false,
      typeHierarchyView: null,
      referencesView: null,
      workspaceDescriptor: null,
      workspaceRoot: "/workspace",
      workspaceSettings: {
        formatOnPaste: false,
        javaScriptTypeScriptValidation: true,
        javaScriptTypeScriptVersion: null,
        phpInlayHints: false,
        phpVersionOverride: null,
        revealActiveFileInTree: false,
        statusBar: {},
      },
      workspaceSymbolsOpen: false,
      workspaceTabs: ["/workspace"],
      workspaceTodos: [],
      workspaceTrust: { trusted: true },
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

function readmeDiff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/README.md",
      relativePath: "README.md",
      status: "modified",
    },
    language: "markdown",
    modifiedContent: "# Project\n\nUpdated docs\n",
    originalContent: "# Project\n",
  };
}
