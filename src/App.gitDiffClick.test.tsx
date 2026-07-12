// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitFileDiff } from "./domain/git";

const appGitDiffClickMocks = vi.hoisted(() => ({
  changes: [] as GitChangedFile[],
  diffErrorMessage: null as string | null,
  loadGitFileHunks: vi.fn(),
}));

vi.mock("./application/useWorkbenchController", async () => {
  const React = await import("react");

  return {
    useWorkbenchController: () => {
      const changes =
        appGitDiffClickMocks.changes.length > 0
          ? appGitDiffClickMocks.changes
          : [gitChange("modified", "README.md")];
      const [state, setState] = React.useState({
        activePath: null as string | null,
        gitDiffLoading: false,
        gitDiffPreview: null as GitFileDiff | null,
        notices: [] as Array<{
          id: string;
          message: string;
          severity: string;
          source: string;
        }>,
        openDocuments: [] as Array<{
          content: string;
          language: string;
          name: string;
          path: string;
          readOnly: boolean;
          savedContent: string;
        }>,
        previewPath: null as string | null,
        selectedGitChange: null as GitChangedFile | null,
      });

      const previewGitChange = async (selected: GitChangedFile) => {
        const diffPath = `mockor-git-diff:worktree:${selected.path}`;
        setState({
          activePath: diffPath,
          gitDiffLoading: true,
          gitDiffPreview: null,
          notices: [],
          openDocuments: [
            {
              content: "",
              language: "plaintext",
              name: "Diff: README.md",
              path: diffPath,
              readOnly: true,
              savedContent: "",
            },
          ],
          previewPath: diffPath,
          selectedGitChange: selected,
        });
        await Promise.resolve();
        if (appGitDiffClickMocks.diffErrorMessage) {
          setState({
            activePath: diffPath,
            gitDiffLoading: false,
            gitDiffPreview: null,
            notices: [
              {
                id: "recoverable-git-diff-error",
                message: appGitDiffClickMocks.diffErrorMessage,
                severity: "error",
                source: "Git Diff",
              },
            ],
            openDocuments: [
              {
                content: "",
                language: "plaintext",
                name: `Diff: ${fileName(selected.relativePath)}`,
                path: diffPath,
                readOnly: true,
                savedContent: "",
              },
            ],
            previewPath: diffPath,
            selectedGitChange: selected,
          });
          return;
        }
        setState({
          activePath: diffPath,
          gitDiffLoading: false,
          gitDiffPreview: gitDiff(selected),
          notices: [],
          openDocuments: [
            {
              content: "",
              language: "plaintext",
              name: `Diff: ${fileName(selected.relativePath)}`,
              path: diffPath,
              readOnly: true,
              savedContent: "",
            },
          ],
          previewPath: diffPath,
          selectedGitChange: selected,
        });
      };

      return createWorkbench({
        ...state,
        gitStatus: {
          branch: "main",
          changes,
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
  useNoticeToastRenderers: () => (notice: unknown) => {
    if (notice && typeof notice === "object" && "message" in notice) {
      const typedNotice = notice as { message: string; source?: string };
      return `${typedNotice.source ?? "Notice"}: ${typedNotice.message}`;
    }

    return String(notice);
  },
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
    appGitDiffClickMocks.changes = [];
    appGitDiffClickMocks.diffErrorMessage = null;
    appGitDiffClickMocks.loadGitFileHunks.mockReset();
    vi.restoreAllMocks();
  });

  it.each([
    {
      change: gitChange("modified", "README.md"),
      expectedText: "Updated docs",
      stagedArgument: false,
    },
    {
      change: gitChange("modified", "src/staged.ts", { isStaged: true }),
      expectedText: "const value = 2;",
      stagedArgument: true,
    },
    {
      change: gitChange("untracked", "notes/todo.txt", {
        isUnversioned: true,
      }),
      expectedText: "Write the QA notes",
      stagedArgument: null,
    },
  ])(
    "clicks a $change.status Git row and renders a nonblank diff",
    async ({ change, expectedText, stagedArgument }) => {
      appGitDiffClickMocks.changes = [change];

      await act(async () => {
        root.render(<App />);
        await Promise.resolve();
      });

      const changeButton = changeRowButton(host, change.relativePath);
      expect(changeButton).toBeDefined();

      await act(async () => {
        changeButton?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(host.textContent).toContain(fileName(change.relativePath));
      expect(host.textContent).toContain(
        `Diff: ${fileName(change.relativePath)}`,
      );
      expect(host.textContent).toContain("@@");
      expect(host.textContent).toContain(expectedText);
      expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
      expect(host.innerHTML).not.toBe("");

      if (stagedArgument === null) {
        expect(appGitDiffClickMocks.loadGitFileHunks).not.toHaveBeenCalled();
      } else {
        expect(appGitDiffClickMocks.loadGitFileHunks).toHaveBeenCalledWith(
          expect.objectContaining({ relativePath: change.relativePath }),
          stagedArgument,
        );
      }
    },
  );

  it("shows a recoverable notice instead of a blank diff when loading fails", async () => {
    const change = gitChange("modified", "README.md");
    appGitDiffClickMocks.changes = [change];
    appGitDiffClickMocks.diffErrorMessage = "get_git_diff failed for README.md";

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    const readmeButton = changeRowButton(host, "README.md");
    expect(readmeButton).toBeDefined();

    await act(async () => {
      readmeButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("README.md");
    expect(host.textContent).toContain("Diff: README.md");
    expect(host.textContent).toContain(
      "Git Diff: get_git_diff failed for README.md",
    );
    expect(host.textContent).toContain("Select a changed file to preview diff.");
    expect(host.innerHTML).not.toBe("");
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
      gitRepositoryMappings: [{ rootRelativePath: "" }],
      gitRepositoryStatuses: [],
      gitBranch: null,
      gitBranchRepositoryLabel: null,
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
      phpTestRunRequestVersion: 0,
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

function gitChange(
  status: GitChangedFile["status"],
  relativePath: string,
  overrides: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    isStaged: overrides.isStaged ?? false,
    isUnversioned: overrides.isUnversioned ?? false,
    oldPath: null,
    oldRelativePath: null,
    path: `/workspace/${relativePath}`,
    relativePath,
    status,
    ...overrides,
  };
}

function gitDiff(change: GitChangedFile): GitFileDiff {
  if (change.status === "untracked") {
    return {
      change,
      language: "plaintext",
      modifiedContent: "Write the QA notes\nCheck the gutter flow\n",
      originalContent: "",
    };
  }

  if (change.relativePath.endsWith(".ts")) {
    return {
      change,
      language: "typescript",
      modifiedContent: "const value = 2;\n",
      originalContent: "const value = 1;\n",
    };
  }

  return {
    change,
    language: "markdown",
    modifiedContent: "# Project\n\nUpdated docs\n",
    originalContent: "# Project\n",
  };
}

function changeRowButton(
  container: ParentNode,
  relativePath: string,
): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(".git-change-row"),
  ).find((button) => button.textContent?.includes(fileName(relativePath)));
}

function fileName(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] ?? relativePath;
}
