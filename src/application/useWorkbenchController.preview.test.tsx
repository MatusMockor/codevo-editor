// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyGitStatus, type GitChangedFile, type GitGateway } from "../domain/git";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { createLocalHistorySaveWritersFixture } from "../test/localHistorySaveWritersFixture";
import { waitForReact } from "../test/reactTestLifecycle";
import { workspaceSettingsIdentity } from "../test/workbenchRegisteredAuthorityTestFixtures";
import {
  createInMemoryLocalHistoryGateway,
  documentSyncGatewayMock,
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../test/workbenchControllerTestHarness";
import {
  Deferred,
  createDeferred,
  fileEntry,
  fileHistoryGitGateway,
  gitChangedFile,
  phpWorkspaceDescriptor,
  trustedDescriptor,
} from "./useWorkbenchController.preview/testSupport";

const tabPaths = (tabs: readonly { path: string }[]) => tabs.map(({ path }) => path);

describe("useWorkbenchController preview tabs, Git history, and Local History", () => {
  const { renderController, renderRegisteredController } = setupWorkbenchControllerTestHarness();

  it("routes image extensions to isolated read-only image tabs", async () => {
    const readTextFile = vi.fn(async () => "text");
    const readImageFile = vi.fn(async () => ({ base64: "iVBORw==", byteLength: 4 }));
    const { dependencies, getWorkbench } = renderController({
      readTextFile,
      workspaceFiles: { readImageFile },
    });
    const image = fileEntry("/workspace/assets/logo.png", "logo.png");

    await act(async () => {
      await getWorkbench().previewFile(image);
    });

    expect(readImageFile).toHaveBeenCalledWith(image.path);
    expect(readTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument).toBeNull();
    expect(getWorkbench().activeImage).toEqual({
      path: image.path,
      name: image.name,
      byteLength: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    });
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(getWorkbench().openTabs).toHaveLength(1);
    expect(dependencies.languageServerDocumentSyncGateway.didOpen).not.toHaveBeenCalled();
    expect(dependencies.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
  });
  it("restores isolated image tabs in order across workspace switches without persisting them", async () => {
    const readImageFile = vi.fn(async (path: string) => ({
      base64: path.includes("workspace-a") ? "QUFB" : "QkJC",
      byteLength: 3,
    }));
    const { dependencies, getWorkbench } = renderRegisteredController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDetectionGateway: {
        detectWorkspace: vi.fn(async (rootPath) => ({
          javaScriptTypeScript: null,
          php: null,
          rootPath,
        })),
      },
      workspaceFiles: { readImageFile },
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    const firstText = fileEntry("/workspace-a/first.php", "first.php");
    const imageA = fileEntry("/workspace-a/image.gif", "image.gif");
    const secondText = fileEntry("/workspace-a/second.php", "second.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(firstText);
      await getWorkbench().openPinnedFile(imageA);
      await getWorkbench().openPinnedFile(secondText);
      getWorkbench().setActivePath(imageA.path);
      await Promise.resolve();
    });
    expect(tabPaths(getWorkbench().openTabs)).toEqual([
      firstText.path,
      imageA.path,
      secondText.path,
    ]);
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activeImage).toBeNull();
    expect(getWorkbench().openTabs).toEqual([]);
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
      workspaceSettingsIdentity("/workspace-a"),
      expect.objectContaining({
        session: expect.objectContaining({
          editor: expect.objectContaining({
            groups: expect.objectContaining({
              "editor-main": expect.objectContaining({
                activePath: firstText.path,
                openPaths: [firstText.path, secondText.path],
              }),
            }),
          }),
        }),
      }),
    );

    const imageB = fileEntry("/workspace-b/image.gif", "image.gif");
    await act(async () => {
      await getWorkbench().openPinnedFile(imageB);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(tabPaths(getWorkbench().openTabs)).toEqual([
      firstText.path,
      imageA.path,
      secondText.path,
    ]);
    expect(getWorkbench().activePath).toBe(imageA.path);
    expect(getWorkbench().activeImage).toEqual({
      path: imageA.path,
      name: imageA.name,
      byteLength: 3,
      dataUrl: "data:image/gif;base64,QUFB",
    });
    expect(readImageFile).toHaveBeenCalledTimes(2);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(tabPaths(getWorkbench().openTabs)).toEqual([imageB.path]);
    expect(getWorkbench().activeImage?.path).toBe(imageB.path);
  });
  it("frees cached image tabs when their workspace is closed", async () => {
    const readImageFile = vi.fn(async () => ({ base64: "R0lG", byteLength: 3 }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      workspaceFiles: { readImageFile },
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace"));
    const image = fileEntry("/workspace/image.gif", "image.gif");

    await act(async () => {
      await getWorkbench().openPinnedFile(image);
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openTabs).toEqual([]);
    expect(getWorkbench().activeImage).toBeNull();

    await act(async () => {
      await getWorkbench().openPinnedFile(image);
    });

    expect(readImageFile).toHaveBeenCalledTimes(2);
  });
  it("focuses one Markdown preview per source instead of opening a duplicate", async () => {
    const renderMarkdown = vi.fn(async (content: string) => `<h1>${content}</h1>`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      markdownPreviewRenderer: renderMarkdown,
      readTextFile: vi.fn(async () => "README"),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace"));
    const file = fileEntry("/workspace/README.md", "README.md");

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "markdown.openPreview",
    );

    await act(async () => {
      await command?.run();
    });
    const previewPath = getWorkbench().activePath;

    await act(async () => {
      getWorkbench().setActivePath(file.path);
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "markdown.openPreview")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(previewPath);
    expect(tabPaths(getWorkbench().openTabs)).toEqual([file.path, previewPath]);
    expect(getWorkbench().openMarkdownPreviews).toHaveLength(1);
    expect(renderMarkdown).toHaveBeenCalledOnce();
  });
  it("debounces live Markdown rendering and cancels it when the preview closes", async () => {
    vi.useFakeTimers();
    const renderMarkdown = vi.fn(async (content: string) => `<p>${content}</p>`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      markdownPreviewRenderer: renderMarkdown,
      readTextFile: vi.fn(async () => "first"),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace"));
    const file = fileEntry("/workspace/README.md", "README.md");

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      await getWorkbench().openMarkdownPreview();
    });
    const previewPath = getWorkbench().activePath!;

    await act(async () => {
      getWorkbench().setActivePath(file.path);
      await Promise.resolve();
    });
    await act(async () => {
      getWorkbench().updateActiveDocument("second");
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(renderMarkdown).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(renderMarkdown).toHaveBeenLastCalledWith("second");
    expect(getWorkbench().markdownPreviewTabs[previewPath]?.html).toBe("<p>second</p>");

    await act(async () => {
      getWorkbench().updateActiveDocument("third");
      await getWorkbench().closeDocument(previewPath);
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("keeps Markdown preview tabs out of text and persisted session pipelines", async () => {
    const { dependencies, getWorkbench } = renderRegisteredController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      markdownPreviewRenderer: vi.fn(async () => "<h1>README</h1>"),
      readTextFile: vi.fn(async () => "# README"),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace"));
    const file = fileEntry("/workspace/README.md", "README.md");

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      await getWorkbench().openMarkdownPreview();
    });
    await flushAsyncTurns(12);
    const previewPath = getWorkbench().activePath!;
    const saveCommand = getWorkbench().commands.find((command) => command.id === "editor.save");

    expect(getWorkbench().activeDocument).toBeNull();
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([file.path]);
    expect(getWorkbench().openTabs).toHaveLength(2);
    expect(dependencies.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
    expect(saveCommand?.isEnabled(getWorkbench().commandContext)).toBe(false);
    expect(getWorkbench().languageServerDiagnosticsByPath[previewPath]).toBeUndefined();
    expect(getWorkbench().navigationHistory.backStack).not.toContainEqual(
      expect.objectContaining({ path: previewPath }),
    );
    expect(getWorkbench().navigationHistory.forwardStack).not.toContainEqual(
      expect.objectContaining({ path: previewPath }),
    );
    expect(
      vi
        .mocked(dependencies.languageServerDocumentSyncGateway.didOpen)
        .mock.calls.some(([, document]) => document.path.includes("markdown-preview")),
    ).toBe(false);
    expect(
      [
        ...vi.mocked(dependencies.languageServerDocumentSyncGateway.didChange).mock.calls,
        ...vi.mocked(dependencies.languageServerDocumentSyncGateway.didSave).mock.calls,
      ]
        .flat()
        .some((value) => JSON.stringify(value).includes(previewPath)),
    ).toBe(false);
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenLastCalledWith(
      workspaceSettingsIdentity("/workspace"),
      expect.objectContaining({
        session: expect.objectContaining({
          editor: expect.objectContaining({
            groups: expect.objectContaining({
              "editor-main": expect.objectContaining({
                activePath: file.path,
                openPaths: [file.path],
              }),
            }),
          }),
        }),
      }),
    );
  });
  it("reorders regular tabs without persisting the open preview", async () => {
    const { dependencies, getWorkbench } = renderRegisteredController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace"));
    const first = fileEntry("/workspace/src/First.php", "First.php");
    const second = fileEntry("/workspace/src/Second.php", "Second.php");
    const preview = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(first);
      await getWorkbench().openPinnedFile(second);
      await getWorkbench().previewFile(preview);
    });
    await flushAsyncTurns(12);
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();

    act(() => {
      getWorkbench().reorderOpenTabs(second.path, first.path, "before");
    });
    await flushAsyncTurns(12);

    expect(tabPaths(getWorkbench().openTabs)).toEqual([second.path, first.path, preview.path]);
    expect(getWorkbench().previewPath).toBe(preview.path);
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenLastCalledWith(
      workspaceSettingsIdentity("/workspace"),
      expect.objectContaining({
        session: expect.objectContaining({
          editor: expect.objectContaining({
            groups: expect.objectContaining({
              "editor-main": expect.objectContaining({
                activePath: preview.path,
                openPaths: [second.path, first.path],
                previewPath: preview.path,
              }),
            }),
          }),
        }),
      }),
    );
  });
  it("promotes a dragged preview into open paths and clears preview state", async () => {
    const { getWorkbench } = renderController();
    const first = fileEntry("/workspace/src/First.php", "First.php");
    const second = fileEntry("/workspace/src/Second.php", "Second.php");
    const preview = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(first);
      await getWorkbench().openPinnedFile(second);
      await getWorkbench().previewFile(preview);
    });

    act(() => {
      getWorkbench().reorderOpenTabs(preview.path, first.path, "before");
    });

    expect(tabPaths(getWorkbench().openTabs)).toEqual([preview.path, first.path, second.path]);
    expect(getWorkbench().previewPath).toBeNull();
    expect(getWorkbench().activePath).toBe(preview.path);
  });
  it("isolates cached Markdown previews by workspace and drops stale render completion", async () => {
    const staleRender = createDeferred<string>();
    const renderMarkdown = vi
      .fn<(content: string) => Promise<string>>()
      .mockImplementationOnce(() => staleRender.promise)
      .mockResolvedValue("<h1>other</h1>");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      markdownPreviewRenderer: renderMarkdown,
      readTextFile: vi.fn(async (path) => `# ${path}`),
      workspaceDetectionGateway: {
        detectWorkspace: vi.fn(async (rootPath) => ({
          javaScriptTypeScript: null,
          php: null,
          rootPath,
        })),
      },
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));
    const file = fileEntry("/workspace-a/README.md", "README.md");
    let opening = Promise.resolve();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      opening = getWorkbench().openMarkdownPreview();
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    expect(getWorkbench().openMarkdownPreviews).toEqual([]);

    await act(async () => {
      staleRender.resolve("<h1>stale</h1>");
      await opening;
    });
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().openMarkdownPreviews).toEqual([]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });

    expect(getWorkbench().openMarkdownPreviews).toHaveLength(1);
    expect(getWorkbench().openMarkdownPreviews[0]?.html).toBe("");
  });
  it("keeps a double-click pin from being overwritten by a stale preview read", async () => {
    const reads: Array<{ deferred: Deferred<string>; path: string }> = [];
    const readTextFile = vi.fn((path: string) => {
      const deferred = createDeferred<string>();
      reads.push({ deferred, path });
      return deferred.promise;
    });
    const { getWorkbench } = renderController({ readTextFile });
    const file = fileEntry("/workspace/src/User.php", "User.php");

    let previewPromise: Promise<void> | null = null;
    let pinPromise: Promise<boolean> | null = null;

    act(() => {
      previewPromise = getWorkbench().previewFile(file);
      pinPromise = getWorkbench().openPinnedFile(file);
    });

    expect(reads.map((read) => read.path)).toEqual([file.path, file.path]);

    await act(async () => {
      reads[1].deferred.resolve("<?php\nfinal class User {}\n");
      await pinPromise;
    });

    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().previewPath).toBe(null);

    await act(async () => {
      reads[0].deferred.resolve("<?php\nfinal class StaleUser {}\n");
      await previewPromise;
    });

    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().previewPath).toBe(null);
    expect(getWorkbench().openDocuments).toHaveLength(1);
    expect(getWorkbench().openDocuments[0]?.content).toContain("User");
  });
  it("keeps a pinned tab open when a later preview opens with a stale closure", async () => {
    const { getWorkbench } = renderController();
    const pinned = fileEntry("/workspace/src/Pinned.php", "Pinned.php");
    const firstPreview = fileEntry("/workspace/src/First.php", "First.php");
    const secondPreview = fileEntry("/workspace/src/Second.php", "Second.php");
    const thirdPreview = fileEntry("/workspace/src/Third.php", "Third.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(pinned);
    });
    await act(async () => {
      await getWorkbench().previewFile(firstPreview);
      getWorkbench().setActivePath(firstPreview.path);
      await Promise.resolve();
    });

    expect(getWorkbench().openDocuments.map((d) => d.path)).toEqual([
      pinned.path,
      firstPreview.path,
    ]);

    // Capture a preview open closure now, while it observes:
    //   openPaths === [pinned], previewPath === firstPreview, active firstPreview.
    // Reusing it after the live state advances reproduces a rapid nav where the
    // replacement is computed from a stale closure instead of current state.
    const stalePreviewFile = getWorkbench().previewFile;

    // Live state advances: First gets pinned (double-click), Second previewed.
    await act(async () => {
      getWorkbench().pinDocument(firstPreview.path);
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().previewFile(secondPreview);
      getWorkbench().setActivePath(secondPreview.path);
      await Promise.resolve();
    });

    expect(getWorkbench().openDocuments.map((d) => d.path)).toEqual([
      pinned.path,
      firstPreview.path,
      secondPreview.path,
    ]);

    // The stale closure still treats the (now pinned) First document as the
    // unedited preview to replace, wrongly closing its pinned tab. With the fix
    // the replacement is recomputed from live state, so Third replaces only the
    // live Second preview and the pinned First tab survives.
    await act(async () => {
      await stalePreviewFile(thirdPreview);
    });

    expect(getWorkbench().openDocuments.map((d) => d.path)).toEqual([
      pinned.path,
      firstPreview.path,
      thirdPreview.path,
    ]);
    expect(getWorkbench().previewPath).toBe(thirdPreview.path);
    expect(getWorkbench().activePath).toBe(thirdPreview.path);
  });
  it("activates the remaining preview tab after closing the active pinned tab", async () => {
    const { getWorkbench } = renderController();
    const pinnedFile = fileEntry("/workspace/src/Pinned.php", "Pinned.php");
    const previewFile = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(pinnedFile);
    });
    await act(async () => {
      await getWorkbench().previewFile(previewFile);
    });
    await act(async () => {
      getWorkbench().setActivePath(pinnedFile.path);
      await Promise.resolve();
    });
    act(() => {
      getWorkbench().closeDocument(pinnedFile.path);
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe(previewFile.path);
    expect(getWorkbench().activeDocument?.path).toBe(previewFile.path);
  });
  it("closes a Git diff preview without closing the active editor document", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      await getWorkbench().previewGitChange({
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/src/User.php",
        relativePath: "src/User.php",
        status: "modified",
      });
    });

    expect(getWorkbench().selectedGitChange?.path).toBe(file.path);
    expect(getWorkbench().activePath).toBe("mockor-git-diff:worktree:/workspace/src/User.php");

    await act(async () => {
      getWorkbench().closeGitDiffPreview();
      await Promise.resolve();
    });

    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().activePath).toBe(file.path);
    expect(Object.values(getWorkbench().editorGroups.groups)).toEqual([
      expect.objectContaining({
        activePath: file.path,
        openPaths: [file.path],
        previewPath: null,
      }),
    ]);
  });
  it("does not publish local PHP diagnostics for a synthetic Git diff document", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    const change = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/User.php",
      relativePath: "src/User.php",
      status: "modified" as const,
    };
    await flushAsyncTurns();
    await act(async () => getWorkbench().previewGitChange(change));
    const syntheticPath = "mockor-git-diff:worktree:/workspace/src/User.php";

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(syntheticPath, [
        {
          character: 0,
          endCharacter: 1,
          endLine: 0,
          line: 0,
          message: "synthetic syntax error",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });

    expect(getWorkbench().diagnosticsSummary.errors).toBe(0);
    expect(
      getWorkbench().notices.some((notice) =>
        notice.groupKey?.startsWith("php-local-diagnostics:"),
      ),
    ).toBe(false);
  });
  it("opens file history for the active document and loads a commit diff", async () => {
    const commits = [
      {
        author: "Alice",
        sha: "1a2b3c4",
        subject: "Add user model",
        timestamp: 1700000000,
      },
      {
        author: "Bob",
        sha: "f0e1d2c",
        subject: "Refactor user model",
        timestamp: 1700100000,
      },
    ];
    const fileHistory = vi.fn(async () => commits);
    const fileCommitDiff = vi.fn(async (_rootPath, relativePath, sha) => ({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: `/workspace/${relativePath}`,
        relativePath,
        status: "modified" as const,
      },
      language: "php",
      modifiedContent: `<?php // ${sha}\n`,
      originalContent: "<?php\n",
    }));
    const gitGateway = fileHistoryGitGateway({ fileCommitDiff, fileHistory });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });

    await act(async () => {
      await getWorkbench().openFileHistory();
    });

    expect(getWorkbench().fileHistoryPanelOpen).toBe(true);
    expect(getWorkbench().fileHistoryRelativePath).toBe("src/User.php");
    expect(getWorkbench().fileHistoryCommits).toHaveLength(2);
    expect(fileHistory).toHaveBeenCalledWith("/workspace", "src/User.php");

    await act(async () => {
      await getWorkbench().selectFileHistoryCommit("f0e1d2c");
    });

    expect(fileCommitDiff).toHaveBeenCalledWith("/workspace", "src/User.php", "f0e1d2c");
    expect(getWorkbench().fileHistorySelectedSha).toBe("f0e1d2c");
    expect(getWorkbench().fileHistoryDiff?.modifiedContent).toContain("f0e1d2c");

    await act(async () => {
      getWorkbench().closeFileHistory();
      await Promise.resolve();
    });

    expect(getWorkbench().fileHistoryPanelOpen).toBe(false);
    expect(getWorkbench().fileHistoryCommits).toEqual([]);
    expect(getWorkbench().fileHistorySelectedSha).toBeNull();
    expect(getWorkbench().fileHistoryDiff).toBeNull();
  });
  it("reveals a blamed commit in the active file history", async () => {
    const commits = [
      {
        author: "Alice",
        sha: "abc1234",
        subject: "Add user",
        timestamp: 1700000000,
      },
    ];
    const fileHistory = vi.fn(async () => commits);
    const fileCommitDiff = vi.fn(async (_rootPath, relativePath, sha) => ({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: `/workspace/${relativePath}`,
        relativePath,
        status: "modified" as const,
      },
      language: "php",
      modifiedContent: `<?php // ${sha}\n`,
      originalContent: "<?php\n",
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway: fileHistoryGitGateway({ fileCommitDiff, fileHistory }),
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      await getWorkbench().revealCommitInFileHistory(file.path, "abc1234");
    });

    expect(getWorkbench().bottomPanelVisible).toBe(true);
    expect(getWorkbench().bottomPanelView).toBe("history");
    expect(getWorkbench().fileHistorySelectedSha).toBe("abc1234");
    expect(getWorkbench().fileHistoryDiff?.modifiedContent).toContain("abc1234");
  });
  it("opens file history without selecting a missing blamed commit", async () => {
    const fileCommitDiff = vi.fn();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway: fileHistoryGitGateway({
        fileCommitDiff,
        fileHistory: vi.fn(async () => []),
      }),
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      await getWorkbench().revealCommitInFileHistory(file.path, "missing");
    });

    expect(getWorkbench().bottomPanelVisible).toBe(true);
    expect(getWorkbench().bottomPanelView).toBe("history");
    expect(getWorkbench().fileHistorySelectedSha).toBeNull();
    expect(getWorkbench().fileHistoryDiff).toBeNull();
    expect(fileCommitDiff).not.toHaveBeenCalled();
  });
  it("drops a blamed commit reveal after switching workspace roots", async () => {
    const historyDeferred = createDeferred<
      Array<{
        author: string;
        sha: string;
        subject: string;
        timestamp: number;
      }>
    >();
    const fileCommitDiff = vi.fn();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway: fileHistoryGitGateway({
        fileCommitDiff,
        fileHistory: vi.fn(() => historyDeferred.promise),
      }),
    });
    const file = fileEntry("/workspace-a/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    let revealPromise: Promise<void> | null = null;
    act(() => {
      revealPromise = getWorkbench().revealCommitInFileHistory(file.path, "abc1234");
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      historyDeferred.resolve([
        {
          author: "Alice",
          sha: "abc1234",
          subject: "stale",
          timestamp: 1700000000,
        },
      ]);
      await revealPromise;
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().fileHistorySelectedSha).toBeNull();
    expect(fileCommitDiff).not.toHaveBeenCalled();
  });
  it("drops a stale file history result after the panel is closed", async () => {
    const historyDeferred = createDeferred<
      Array<{
        author: string;
        sha: string;
        subject: string;
        timestamp: number;
      }>
    >();
    const fileHistory = vi.fn(() => historyDeferred.promise);
    const gitGateway = fileHistoryGitGateway({ fileHistory });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });

    let historyPromise: Promise<void> | null = null;
    act(() => {
      historyPromise = getWorkbench().openFileHistory();
    });

    // Close the panel while the history request is still in flight.
    await act(async () => {
      getWorkbench().closeFileHistory();
      await Promise.resolve();
    });

    await act(async () => {
      historyDeferred.resolve([
        {
          author: "Alice",
          sha: "1a2b3c4",
          subject: "stale",
          timestamp: 1700000000,
        },
      ]);
      await historyPromise;
    });

    // The stale result must not repopulate a closed panel.
    expect(getWorkbench().fileHistoryPanelOpen).toBe(false);
    expect(getWorkbench().fileHistoryCommits).toEqual([]);
  });
  it("opens the stash panel, lists stashes, and shows a selected stash diff", async () => {
    const stashList = vi.fn(async () => [
      { branch: "main", index: 0, message: "WIP on main: a", timestamp: 1700000000 },
      { branch: null, index: 1, message: "On feature: b", timestamp: 1700100000 },
    ]);
    const stashShow = vi.fn(async () => "diff --git a/file b/file\n+two");
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stashList = stashList;
    gitGateway.stashShow = stashShow;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitStashPanel();
    });

    expect(getWorkbench().gitStashPanelOpen).toBe(true);
    expect(getWorkbench().gitStashEntries).toHaveLength(2);
    expect(stashList).toHaveBeenCalledWith("/workspace");

    await act(async () => {
      await getWorkbench().selectGitStash(1);
    });

    expect(stashShow).toHaveBeenCalledWith("/workspace", 1);
    expect(getWorkbench().gitStashSelectedIndex).toBe(1);
    expect(getWorkbench().gitStashDiff).toContain("+two");

    await act(async () => {
      getWorkbench().closeGitStashPanel();
      await Promise.resolve();
    });

    expect(getWorkbench().gitStashPanelOpen).toBe(false);
    expect(getWorkbench().gitStashEntries).toEqual([]);
    expect(getWorkbench().gitStashDiff).toBeNull();
  });
  it("saves a stash and refreshes the list", async () => {
    const stashSave = vi.fn(async () => undefined);
    let listCalls = 0;
    const stashList = vi.fn(async () => {
      listCalls += 1;
      return listCalls < 2
        ? []
        : [{ branch: "main", index: 0, message: "WIP", timestamp: 1700000000 }];
    });
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stashSave = stashSave;
    gitGateway.stashList = stashList;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitStashPanel();
    });

    await act(async () => {
      await getWorkbench().saveGitStash("  work in progress  ");
    });

    // The message is trimmed before reaching the gateway.
    expect(stashSave).toHaveBeenCalledWith("/workspace", "work in progress");
    expect(getWorkbench().gitStashEntries).toHaveLength(1);
  });
  it("does not drop a stash when the destructive confirmation is declined", async () => {
    const stashDrop = vi.fn(async () => undefined);
    const stashList = vi.fn(async () => [
      { branch: "main", index: 0, message: "WIP", timestamp: 1700000000 },
    ]);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stashDrop = stashDrop;
    gitGateway.stashList = stashList;
    const confirm = vi.fn(() => false);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
      prompter: { confirm, prompt: vi.fn(() => null) },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitStashPanel();
    });

    await act(async () => {
      await getWorkbench().dropGitStash(0);
    });

    // Declining the confirmation must leave the (destructive) drop un-run.
    expect(confirm).toHaveBeenCalled();
    expect(stashDrop).not.toHaveBeenCalled();
  });
  it("drops the stash only after the destructive confirmation is accepted", async () => {
    const stashDrop = vi.fn(async () => undefined);
    const stashList = vi.fn(async () => [
      { branch: "main", index: 0, message: "WIP", timestamp: 1700000000 },
    ]);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stashDrop = stashDrop;
    gitGateway.stashList = stashList;
    const confirm = vi.fn(() => true);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
      prompter: { confirm, prompt: vi.fn(() => null) },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitStashPanel();
    });

    await act(async () => {
      await getWorkbench().dropGitStash(0);
    });

    expect(confirm).toHaveBeenCalled();
    expect(stashDrop).toHaveBeenCalledWith("/workspace", 0);
  });
  it("drops a stale stash list result after the panel is closed", async () => {
    const stashListDeferred = createDeferred<
      Array<{
        branch: string | null;
        index: number;
        message: string;
        timestamp: number;
      }>
    >();
    const stashList = vi.fn(() => stashListDeferred.promise);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stashList = stashList;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = getWorkbench().openGitStashPanel();
    });

    // Close the panel while the list request is still in flight.
    await act(async () => {
      getWorkbench().closeGitStashPanel();
      await Promise.resolve();
    });

    await act(async () => {
      stashListDeferred.resolve([
        { branch: "main", index: 0, message: "stale", timestamp: 1700000000 },
      ]);
      await openPromise;
    });

    // The stale result must not repopulate a closed panel.
    expect(getWorkbench().gitStashPanelOpen).toBe(false);
    expect(getWorkbench().gitStashEntries).toEqual([]);
  });
  it("applies and pops stashes through the active workspace without blanking on errors", async () => {
    const appliedChange = gitChangedFile("src/Applied.php", false);
    const stashApply = vi.fn(async () => undefined);
    const stashPop = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("stash has conflicts"));
    let listCalls = 0;
    const stashList = vi.fn(async () => {
      listCalls += 1;
      return listCalls < 2
        ? [{ branch: "main", index: 0, message: "WIP", timestamp: 1700000000 }]
        : [];
    });
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getStatus = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: [appliedChange],
      isRepository: true,
      rootPath,
    }));
    gitGateway.stashApply = stashApply;
    gitGateway.stashList = stashList;
    gitGateway.stashPop = stashPop;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitStashPanel();
    });
    expect(getWorkbench().gitStashEntries).toHaveLength(1);

    await act(async () => {
      await getWorkbench().applyGitStash(0);
    });

    expect(stashApply).toHaveBeenCalledWith("/workspace", 0);
    expect(getWorkbench().gitStatus.changes).toEqual([appliedChange]);
    expect(getWorkbench().gitStashLoading).toBe(false);

    await act(async () => {
      await getWorkbench().selectGitStash(0);
    });
    await act(async () => {
      await getWorkbench().popGitStash(0);
    });

    expect(stashPop).toHaveBeenCalledWith("/workspace", 0);
    expect(getWorkbench().gitStashEntries).toEqual([]);
    expect(getWorkbench().gitStashSelectedIndex).toBeNull();
    expect(getWorkbench().gitStashDiff).toBeNull();
    expect(getWorkbench().gitStashLoading).toBe(false);

    await act(async () => {
      await getWorkbench().popGitStash(0);
    });

    expect(getWorkbench().gitStashLoading).toBe(false);
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Git Stash" && notice.message.includes("stash has conflicts"),
      ),
    ).toBe(true);
  });
  it("drops a stale file history result after switching tabs", async () => {
    const historyDeferred = createDeferred<
      Array<{
        author: string;
        sha: string;
        subject: string;
        timestamp: number;
      }>
    >();
    const fileHistory = vi.fn(() => historyDeferred.promise);
    const gitGateway = fileHistoryGitGateway({ fileHistory });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    const fileA = fileEntry("/workspace/src/A.php", "A.php");
    const fileB = fileEntry("/workspace/src/B.php", "B.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileA);
    });

    let historyPromise: Promise<void> | null = null;
    act(() => {
      historyPromise = getWorkbench().openFileHistory();
    });

    // Switch to a different document while A's history is still in flight.
    await act(async () => {
      await getWorkbench().openPinnedFile(fileB);
    });

    await act(async () => {
      historyDeferred.resolve([
        {
          author: "Alice",
          sha: "1a2b3c4",
          subject: "stale A history",
          timestamp: 1700000000,
        },
      ]);
      await historyPromise;
    });

    // The history for A must not populate the panel now that B is active.
    expect(getWorkbench().fileHistoryCommits).toEqual([]);
    expect(fileHistory).toHaveBeenCalledWith("/workspace", "src/A.php");
  });
  it("captures a Local History snapshot of the active document on save", async () => {
    const localHistoryGateway = createInMemoryLocalHistoryGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      localHistoryGateway,
      readTextFile: vi.fn(async () => "<?php // original\n"),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php // edited\n");
    });

    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns();

    expect(localHistoryGateway.recordSnapshot).toHaveBeenCalledWith(
      "/workspace",
      "src/User.php",
      "<?php // edited\n",
    );

    const versions = await localHistoryGateway.listVersions("/workspace", "src/User.php");
    expect(versions).toHaveLength(1);
  });
  it("dedupes a Local History snapshot when saved content is unchanged", async () => {
    const localHistoryGateway = createInMemoryLocalHistoryGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      localHistoryGateway,
      readTextFile: vi.fn(async () => "<?php // original\n"),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php // edited\n");
    });

    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns();

    // Two saves, but the second is identical content: still a single retained
    // version (dedupe).
    const versions = await localHistoryGateway.listVersions("/workspace", "src/User.php");
    expect(versions).toHaveLength(1);
  });
  it("opens the Local History panel, lists versions, and diffs a version against current content", async () => {
    const localHistoryGateway = createInMemoryLocalHistoryGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      localHistoryGateway,
      readTextFile: vi.fn(async () => "<?php // initial\n"),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });

    // Save two distinct versions.
    act(() => {
      getWorkbench().updateActiveDocument("<?php // v1\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php // v2\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openLocalHistory();
    });

    expect(getWorkbench().localHistoryPanelOpen).toBe(true);
    expect(getWorkbench().localHistoryRelativePath).toBe("src/User.php");
    expect(getWorkbench().localHistoryVersions).toHaveLength(2);

    const oldest =
      getWorkbench().localHistoryVersions[getWorkbench().localHistoryVersions.length - 1];

    await act(async () => {
      await getWorkbench().selectLocalHistoryVersion(oldest.id);
    });

    expect(getWorkbench().localHistorySelectedId).toBe(oldest.id);
    expect(getWorkbench().localHistoryDiff?.originalContent).toBe("<?php // v1\n");
    expect(getWorkbench().localHistoryDiff?.modifiedContent).toBe("<?php // v2\n");

    await act(async () => {
      getWorkbench().closeLocalHistory();
      await Promise.resolve();
    });

    expect(getWorkbench().localHistoryPanelOpen).toBe(false);
    expect(getWorkbench().localHistoryVersions).toEqual([]);
    expect(getWorkbench().localHistoryDiff).toBeNull();
  });
  it("reverts the active document to a selected Local History version", async () => {
    const localHistoryGateway = createInMemoryLocalHistoryGateway();
    const initialRevision = {
      contentHash: "initial",
      device: "1",
      inode: "2",
      modifiedNanoseconds: 3,
      modifiedSeconds: 4,
      size: 14,
    };
    const saveWriters = createLocalHistorySaveWritersFixture({
      absolutePath: "/workspace/src/User.php",
      initialRevision,
      relativePath: "src/User.php",
      workspaceId: "workspace-local-history",
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      localHistoryGateway,
      readTextFile: vi.fn(async () => "<?php // initial\n"),
      workspaceFiles: {
        readTextFileSnapshot: vi.fn(async () => ({
          content: "<?php // initial\n",
          revision: initialRevision,
        })),
        ...saveWriters.workspaceFiles,
      },
      workspaceOwnerFiles: saveWriters.workspaceOwnerFiles,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => trustedDescriptor("workspace-local-history", "/workspace")),
        unregister: vi.fn(async () => undefined),
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php // v1\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php // v2\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns();

    saveWriters.assertPreparedWrites("<?php // v1\n", "<?php // v2\n");

    await act(async () => {
      await getWorkbench().openLocalHistory();
    });

    const oldest =
      getWorkbench().localHistoryVersions[getWorkbench().localHistoryVersions.length - 1];

    await act(async () => {
      await getWorkbench().revertLocalHistoryVersion(oldest.id);
    });
    await flushAsyncTurns();

    // The reverted content (v1) is written back to disk and reflected in the
    // open document.
    saveWriters.assertRevertWrite("<?php // v1\n");
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    const active = getWorkbench().openDocuments.find(
      (document) => document.path === "/workspace/src/User.php",
    );
    expect(active?.content).toBe("<?php // v1\n");
    expect(active?.savedContent).toBe("<?php // v1\n");
  });
  it("drops a stale Local History result after the panel is closed", async () => {
    const versionsDeferred =
      createDeferred<Awaited<ReturnType<LocalHistoryGateway["listVersions"]>>>();
    const localHistoryGateway = createInMemoryLocalHistoryGateway();
    vi.mocked(localHistoryGateway.listVersions).mockReturnValueOnce(versionsDeferred.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      localHistoryGateway,
      readTextFile: vi.fn(async () => "<?php // original\n"),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    const file = fileEntry("/workspace/src/User.php", "User.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = getWorkbench().openLocalHistory();
    });

    await act(async () => {
      getWorkbench().closeLocalHistory();
      await Promise.resolve();
    });

    await act(async () => {
      versionsDeferred.resolve([{ id: "000000000001", sizeBytes: 4, timestampMs: 1700000000000 }]);
      await openPromise;
    });

    // The version list arrived after close, so it must not populate the panel.
    expect(getWorkbench().localHistoryVersions).toEqual([]);
    expect(getWorkbench().localHistoryPanelOpen).toBe(false);
  });
  it("opens a Git diff as an active preview tab named for the changed file", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });

    const diffPath = "mockor-git-diff:worktree:/workspace/assets/spinner.gif";
    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().previewPath).toBe(diffPath);
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: spinner.gif",
        path: diffPath,
        readOnly: true,
      }),
    ]);
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change,
      }),
    );
  });
  it("closes PHP sync once when a Git diff replaces a clean preview and drops a stale old-root rejection", async () => {
    const path = "/workspace-a/src/User.php";
    const change: GitChangedFile = {
      ...gitChangedFile("src/User.php", false),
      path,
    };
    const didClose = createDeferred<void>();
    const phpDocumentSyncGateway = documentSyncGatewayMock();
    const javaScriptTypeScriptDocumentSyncGateway = documentSyncGatewayMock();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 901,
    };
    const { getWorkbench } = renderRegisteredController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway: fileHistoryGitGateway({}),
      javaScriptTypeScriptLanguageServerDocumentSyncGateway:
        javaScriptTypeScriptDocumentSyncGateway,
      languageServerDocumentSyncGateway: phpDocumentSyncGateway,
      readTextFile: vi.fn(async () => "<?php\nfinal class User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().previewFile(fileEntry(path, "User.php"));
    });
    await waitForReact(() => {
      expect(phpDocumentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        901,
      );
    });
    vi.mocked(phpDocumentSyncGateway.didClose).mockImplementationOnce(() => didClose.promise);

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });
    await waitForReact(() => {
      expect(phpDocumentSyncGateway.didClose).toHaveBeenCalledOnce();
    });
    expect(phpDocumentSyncGateway.didClose).toHaveBeenCalledWith("/workspace-a", path, 901);
    expect(javaScriptTypeScriptDocumentSyncGateway.didClose).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    act(() => {
      didClose.reject(new Error("stale replaced PHP preview close"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale replaced PHP preview close"),
      ),
    ).toBe(false);
  });
  it("closes JavaScript TypeScript sync once when a Git diff replaces a clean preview and absorbs rejection", async () => {
    const path = "/workspace/src/App.ts";
    const change = gitChangedFile("src/App.ts", false);
    const phpDocumentSyncGateway = documentSyncGatewayMock();
    const javaScriptTypeScriptDocumentSyncGateway = documentSyncGatewayMock();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 902,
    };
    const { getWorkbench } = renderRegisteredController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway: fileHistoryGitGateway({}),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway:
        javaScriptTypeScriptDocumentSyncGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      languageServerDocumentSyncGateway: phpDocumentSyncGateway,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().previewFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(javaScriptTypeScriptDocumentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path }),
        902,
      );
    });
    vi.mocked(javaScriptTypeScriptDocumentSyncGateway.didClose).mockRejectedValueOnce(
      new Error("replaced TypeScript preview close failed"),
    );

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });
    await flushAsyncTurns(24);

    expect(javaScriptTypeScriptDocumentSyncGateway.didClose).toHaveBeenCalledOnce();
    expect(javaScriptTypeScriptDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
      902,
    );
    expect(phpDocumentSyncGateway.didClose).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("replaced TypeScript preview close failed"),
      ),
    ).toBe(true);
  });
  it("opens a read-only synthetic document as a pinned editor tab", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().openReadOnlyDocument(
        {
          content: "",
          language: "plaintext",
          name: "Diff: Older.php",
          path: "mockor-git-history-diff:abc123:src/Older.php",
          readOnly: true,
          savedContent: "",
        },
        { pin: true },
      );
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe("mockor-git-history-diff:abc123:src/Older.php");
    expect(getWorkbench().previewPath).toBeNull();
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: Older.php",
        path: "mockor-git-history-diff:abc123:src/Older.php",
        readOnly: true,
      }),
    ]);
  });
  it("opens a read-only synthetic document as a preview editor tab by default", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().openReadOnlyDocument({
        content: "",
        language: "plaintext",
        name: "Diff: Preview.php",
        path: "mockor-git-history-diff:def456:src/Preview.php",
        readOnly: true,
        savedContent: "",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe("mockor-git-history-diff:def456:src/Preview.php");
    expect(getWorkbench().previewPath).toBe("mockor-git-history-diff:def456:src/Preview.php");
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: Preview.php",
        path: "mockor-git-history-diff:def456:src/Preview.php",
        readOnly: true,
      }),
    ]);
  });
  it("surfaces a recoverable notice (never an unhandled crash) when get_git_diff rejects for a README change", async () => {
    const change = gitChangedFile("README.md", false);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getStatus = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: [change],
      isRepository: true,
      rootPath,
    }));
    // Reproduce the real failure: clicking the changed README triggers the
    // async `get_git_diff` command, and that command rejects. The controller
    // must catch it, clear the in-flight diff, and report a notice instead of
    // letting the rejection escape as an unhandled crash that blanks the app.
    gitGateway.getDiff = vi.fn(async () => {
      throw new Error("get_git_diff failed for README.md");
    });

    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });
    await flushAsyncTurns();

    // No diff is left dangling, loading is reset, and the user sees a notice.
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Git Diff" &&
          notice.message.includes("get_git_diff failed for README.md"),
      ),
    ).toBe(true);
  });
  it("recovers from a failed Git diff preview when the user retries", async () => {
    const change = gitChangedFile("README.md", false);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getStatus = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: [change],
      isRepository: true,
      rootPath,
    }));
    gitGateway.getDiff = vi
      .fn()
      .mockRejectedValueOnce(new Error("get_git_diff failed for README.md"))
      .mockResolvedValueOnce({
        change,
        language: "markdown",
        modifiedContent: "# Project\n\nRetried diff\n",
        originalContent: "# Project\n",
      });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Git Diff" &&
          notice.message.includes("get_git_diff failed for README.md"),
      ),
    ).toBe(true);

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });

    expect(gitGateway.getDiff).toHaveBeenCalledTimes(2);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change,
        modifiedContent: "# Project\n\nRetried diff\n",
        originalContent: "# Project\n",
      }),
    );
    expect(getWorkbench().activePath).toBe("mockor-git-diff:worktree:/workspace/README.md");
  });
  it("keeps an existing Git diff preview open when the same change is previewed again", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "plaintext",
        modifiedContent: "new",
        originalContent: "old",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });
    const activePath = getWorkbench().activePath;

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });

    expect(getWorkbench().activePath).toBe(activePath);
    expect(getWorkbench().previewPath).toBe(activePath);
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview).toEqual(expect.objectContaining({ change }));
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: spinner.gif",
        path: activePath,
        readOnly: true,
      }),
    ]);
  });
  it("clears the Git diff view when its editor tab is closed", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "plaintext",
        modifiedContent: "new",
        originalContent: "old",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });

    act(() => {
      getWorkbench().closeGitDiffPreview();
    });

    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(getWorkbench().openDocuments).toEqual([]);
  });
  it("opens Git diffs as pinned tabs when opening changed files", async () => {
    const firstChange = gitChangedFile("src/First.php", false);
    const secondChange = gitChangedFile("src/Second.php", false);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: `new ${requestedChange.relativePath}`,
        originalContent: `old ${requestedChange.relativePath}`,
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [firstChange, secondChange],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(firstChange);
    });
    const firstDiffPath = "mockor-git-diff:worktree:/workspace/src/First.php";
    expect(getWorkbench().activePath).toBe(firstDiffPath);
    expect(getWorkbench().previewPath).toBeNull();
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: First.php",
        path: firstDiffPath,
        readOnly: true,
      }),
    ]);
    expect(getWorkbench().selectedGitChange).toEqual(firstChange);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change: firstChange,
        modifiedContent: "new src/First.php",
        originalContent: "old src/First.php",
      }),
    );

    await act(async () => {
      await getWorkbench().openGitChange(secondChange);
    });

    const secondDiffPath = "mockor-git-diff:worktree:/workspace/src/Second.php";
    expect(getWorkbench().activePath).toBe(secondDiffPath);
    expect(getWorkbench().previewPath).toBeNull();
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: First.php",
        path: firstDiffPath,
        readOnly: true,
      }),
      expect.objectContaining({
        name: "Diff: Second.php",
        path: secondDiffPath,
        readOnly: true,
      }),
    ]);
    expect(getWorkbench().selectedGitChange).toEqual(secondChange);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change: secondChange,
        modifiedContent: "new src/Second.php",
        originalContent: "old src/Second.php",
      }),
    );

    await act(async () => {
      getWorkbench().closeGitDiffPreview();
      await Promise.resolve();
    });

    expect(getWorkbench().activePath).toBe(firstDiffPath);
    expect(getWorkbench().selectedGitChange).toEqual(firstChange);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change: firstChange,
        modifiedContent: "new src/First.php",
        originalContent: "old src/First.php",
      }),
    );
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([firstDiffPath]);
    expect(gitGateway.getDiff).toHaveBeenCalledTimes(3);
  });
  it("makes the activated pinned Git diff authoritative", async () => {
    const firstChange = gitChangedFile("src/First.php", false);
    const secondChange = gitChangedFile("src/Second.php", false);
    const firstRepositoryRoot = "/workspace/packages/first";
    const secondRepositoryRoot = "/workspace/packages/second";
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getDiff = vi.fn(async (repositoryRoot, change) => ({
      change,
      language: "php",
      modifiedContent: `new ${repositoryRoot}`,
      originalContent: `old ${change.relativePath}`,
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(firstChange, firstRepositoryRoot);
      await getWorkbench().openGitChange(secondChange, secondRepositoryRoot);
    });

    const groupId = getWorkbench().editorGroups.activeGroupId;
    const firstDiffPath = "mockor-git-diff:worktree:/workspace/src/First.php";
    await act(async () => {
      getWorkbench().activateEditorGroupTab(groupId, firstDiffPath);
      await flushAsyncTurns();
    });

    expect(getWorkbench().activePath).toBe(firstDiffPath);
    expect(getWorkbench().selectedGitChange).toEqual(firstChange);
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change: firstChange,
        modifiedContent: `new ${firstRepositoryRoot}`,
      }),
    );
    expect(getWorkbench().gitDiffDocuments[firstDiffPath]).toEqual(
      expect.objectContaining({
        change: firstChange,
        repositoryRoot: firstRepositoryRoot,
      }),
    );
    expect(gitGateway.getDiff).toHaveBeenLastCalledWith(firstRepositoryRoot, firstChange);
  });
  it("clears hidden Git diff state when activating non-worktree diff tabs", async () => {
    const change = gitChangedFile("src/User.php", false);
    const file = fileEntry("/workspace/src/Normal.php", "Normal.php");
    const historyPath = "mockor-git-history-diff:abc123:src/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway: fileHistoryGitGateway({}),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
      getWorkbench().openReadOnlyDocument(
        {
          content: "",
          language: "plaintext",
          name: "History: User.php",
          path: historyPath,
          readOnly: true,
          savedContent: "",
        },
        { pin: true },
      );
      await getWorkbench().openGitChange(change);
    });

    const groupId = getWorkbench().editorGroups.activeGroupId;
    act(() => getWorkbench().activateEditorGroupTab(groupId, file.path));
    await flushAsyncTurns();
    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);

    const diffPath = "mockor-git-diff:worktree:/workspace/src/User.php";
    await act(async () => {
      getWorkbench().activateEditorGroupTab(groupId, diffPath);
      await flushAsyncTurns();
    });
    act(() => getWorkbench().activateEditorGroupTab(groupId, historyPath));
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe(historyPath);
    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
  });
  it("reactivates a same-path Git diff through its split editor group", async () => {
    const change = gitChangedFile("src/Shared.php", false);
    let loadCount = 0;
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getDiff = vi.fn(async (_repositoryRoot, requestedChange) => ({
      change: requestedChange,
      language: "php",
      modifiedContent: `version ${++loadCount}`,
      originalContent: "old",
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const [leftGroupId, rightGroupId] = Object.keys(getWorkbench().editorGroups.groups);
    const diffPath = "mockor-git-diff:worktree:/workspace/src/Shared.php";
    expect(getWorkbench().editorGroups.activeGroupId).toBe(rightGroupId);
    expect(getWorkbench().editorGroups.groups[leftGroupId].activePath).toBe(diffPath);

    await act(async () => {
      getWorkbench().activateEditorGroupTab(leftGroupId, diffPath);
      await flushAsyncTurns();
    });

    expect(getWorkbench().editorGroups.activeGroupId).toBe(leftGroupId);
    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview?.modifiedContent).toBe("version 2");
    expect(gitGateway.getDiff).toHaveBeenCalledTimes(2);
  });
  it("does not let a stale group-activated Git diff load win", async () => {
    const firstChange = gitChangedFile("src/First.php", false);
    const secondChange = gitChangedFile("src/Second.php", false);
    const staleFirstLoad = createDeferred<Awaited<ReturnType<GitGateway["getDiff"]>>>();
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getDiff = vi
      .fn()
      .mockResolvedValueOnce({
        change: firstChange,
        language: "php",
        modifiedContent: "first initial",
        originalContent: "old first",
      })
      .mockResolvedValueOnce({
        change: secondChange,
        language: "php",
        modifiedContent: "second initial",
        originalContent: "old second",
      })
      .mockReturnValueOnce(staleFirstLoad.promise)
      .mockResolvedValueOnce({
        change: secondChange,
        language: "php",
        modifiedContent: "second authoritative",
        originalContent: "old second",
      });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(firstChange);
      await getWorkbench().openGitChange(secondChange);
    });
    const groupId = getWorkbench().editorGroups.activeGroupId;
    const firstDiffPath = "mockor-git-diff:worktree:/workspace/src/First.php";
    const secondDiffPath = "mockor-git-diff:worktree:/workspace/src/Second.php";
    await act(async () => {
      getWorkbench().activateEditorGroupTab(groupId, firstDiffPath);
      getWorkbench().activateEditorGroupTab(groupId, secondDiffPath);
      await flushAsyncTurns();
    });

    await act(async () => {
      staleFirstLoad.resolve({
        change: firstChange,
        language: "php",
        modifiedContent: "first stale",
        originalContent: "old first",
      });
      await flushAsyncTurns();
    });

    expect(getWorkbench().activePath).toBe(secondDiffPath);
    expect(getWorkbench().selectedGitChange).toEqual(secondChange);
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(getWorkbench().gitDiffPreview?.modifiedContent).toBe("second authoritative");
  });
  it("ignores activation callbacks for tabs no longer owned by the group", async () => {
    const change = gitChangedFile("src/Closed.php", false);
    const gitGateway = fileHistoryGitGateway({});
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });

    const groupId = getWorkbench().editorGroups.activeGroupId;
    const diffPath = "mockor-git-diff:worktree:/workspace/src/Closed.php";
    await act(async () => {
      getWorkbench().closeGitDiffPreview();
      await flushAsyncTurns();
    });
    vi.mocked(gitGateway.getDiff).mockClear();

    act(() => getWorkbench().activateEditorGroupTab(groupId, diffPath));

    expect(getWorkbench().activePath).not.toBe(diffPath);
    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(gitGateway.getDiff).not.toHaveBeenCalled();
  });
  it("closes an open Git diff tab when a status refresh no longer contains that diff", async () => {
    const change = gitChangedFile("src/User.php", false);
    let statusChanges: GitChangedFile[] = [change];
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getDiff = vi.fn(async (_rootPath, requestedChange) => ({
      change: requestedChange,
      language: "php",
      modifiedContent: "<?php\nfinal class UserChanged {}\n",
      originalContent: "<?php\nfinal class User {}\n",
    }));
    gitGateway.getStatus = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: statusChanges,
      isRepository: true,
      rootPath,
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });

    const diffPath = "mockor-git-diff:worktree:/workspace/src/User.php";
    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        modifiedContent: "<?php\nfinal class UserChanged {}\n",
        originalContent: "<?php\nfinal class User {}\n",
      }),
    );
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    expect(
      Object.values(getWorkbench().editorGroups.groups).filter((group) =>
        group.openPaths.includes(diffPath),
      ),
    ).toHaveLength(2);

    statusChanges = [];
    await act(async () => {
      await getWorkbench().refreshGitStatus();
    });

    expect(getWorkbench().gitStatus.changes).toEqual([]);
    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(getWorkbench().activePath).toBeNull();
    expect(
      Object.values(getWorkbench().editorGroups.groups).some(
        (group) =>
          group.activePath === diffPath ||
          group.previewPath === diffPath ||
          group.openPaths.includes(diffPath),
      ),
    ).toBe(false);
  });
  it("clears the active Git diff tab state when opening a real file", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const file = fileEntry("/workspace/src/User.php", "User.php");
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "plaintext",
        modifiedContent: "new",
        originalContent: "old",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });
    const diffPath = "mockor-git-diff:worktree:/workspace/assets/spinner.gif";
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview).toEqual(expect.objectContaining({ change }));
    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: spinner.gif",
        path: diffPath,
        readOnly: true,
      }),
    ]);

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    expect(getWorkbench().selectedGitChange).toBeNull();

    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().activePath).toBe(file.path);
  });
});
