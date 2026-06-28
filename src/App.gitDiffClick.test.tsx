// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitFileDiff } from "./domain/git";

const appGitDiffClickMocks = vi.hoisted(() => ({
  loadGitFileHunks: vi.fn(),
}));

vi.mock("./application/useWorkbenchController", async () => {
  const React = await import("react");

  return {
    useWorkbenchController: () => {
      const change = readmeChange();
      const [state, setState] = React.useState({
        gitDiffLoading: false,
        gitDiffPreview: null as GitFileDiff | null,
        selectedGitChange: null as GitChangedFile | null,
      });

      const previewGitChange = async (selected: GitChangedFile) => {
        setState({
          gitDiffLoading: true,
          gitDiffPreview: null,
          selectedGitChange: selected,
        });
        await Promise.resolve();
        setState({
          gitDiffLoading: false,
          gitDiffPreview: readmeDiff(selected),
          selectedGitChange: selected,
        });
      };

      return createWorkbench({
        ...state,
        gitStatus: {
          branch: "main",
          changes: [change],
          isRepository: true,
          rootPath: "/workspace",
        },
        loadGitFileHunks: appGitDiffClickMocks.loadGitFileHunks,
        previewGitChange,
      });
    },
  };
});

vi.mock("./application/useNoticeToastRenderers", () => ({
  useNoticeToastRenderers: () => (notice: unknown) => String(notice),
}));

import App from "./App";

describe("App Git diff click path", () => {
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
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    appGitDiffClickMocks.loadGitFileHunks.mockReset();
    vi.restoreAllMocks();
  });

  it("clicks a modified README row and renders visible diff text", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    const readmeButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("README.md"));
    expect(readmeButton).toBeDefined();

    await act(async () => {
      readmeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("README.md");
    expect(host.textContent).toContain("@@ -1 +1,3 @@");
    expect(host.textContent).toContain("Updated docs");
    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(host.innerHTML).not.toBe("");
    expect(appGitDiffClickMocks.loadGitFileHunks).not.toHaveBeenCalled();
  });
});

function createWorkbench(overrides: Record<string, unknown>) {
  const noop = vi.fn();

  return new Proxy(
    {
      activeDocument: null,
      activeDocumentGitBaseline: null,
      activePath: null,
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
      gitLoading: false,
      gitOperationLoading: false,
      gitStashPanelOpen: false,
      includedGitChangePaths: new Set<string>(),
      indexProgress: { phase: "idle", scanned: 0, total: 0 },
      installingManagedPhpactor: false,
      intelligenceMode: "fullSmart",
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
      referencesView: null,
      searchEverywhereModel: { sections: [] },
      searchEverywhereOpen: false,
      settingsOpen: false,
      sidebarView: "git",
      textSearchOpen: false,
      todoPanelOpen: false,
      typeHierarchyView: null,
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
      ...overrides,
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

function readmeChange(): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: "/workspace/README.md",
    relativePath: "README.md",
    status: "modified",
  };
}

function readmeDiff(change: GitChangedFile): GitFileDiff {
  return {
    change,
    language: "markdown",
    modifiedContent: "# Project\n\nUpdated docs\n",
    originalContent: "# Project\n",
  };
}
