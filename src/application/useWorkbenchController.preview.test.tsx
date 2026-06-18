// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import { emptyGitStatus, gitChangeKey, type GitGateway } from "../domain/git";
import {
  useWorkbenchController,
  type WorkbenchWorkspaceGateways,
} from "./useWorkbenchController";
import type { IndexProgressGateway } from "../domain/indexProgress";
import type { SmartModeGateway } from "../domain/intelligence";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import type {
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";
import {
  fileUriFromPath,
  type LanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type {
  EditorPosition,
  LanguageServerFeaturesGateway,
  LanguageServerRange,
} from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { PhpFileOutlineGateway } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type SettingsGateway,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type {
  FileEntry,
  FileSearchResult,
  PhpProjectDescriptor,
  TextSearchResult,
  WorkspaceDescriptor,
} from "../domain/workspace";

type WorkbenchController = ReturnType<typeof useWorkbenchController>;

interface ControllerDependencies {
  documentSyncGateway: LanguageServerDocumentSyncGateway;
  gitGateway: GitGateway;
  indexProgressGateway: IndexProgressGateway;
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  languageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerGateway: LanguageServerGateway;
  languageServerRuntimeGateway: LanguageServerRuntimeGateway;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway;
  phpFileOutlineGateway: PhpFileOutlineGateway;
  phpTreeGateway: PhpTreeGateway;
  prompter: WorkbenchPrompter;
  settingsGateway: SettingsGateway;
  smartModeGateway: SmartModeGateway;
  terminalGateway: TerminalGateway;
  workspaceGateways: WorkbenchWorkspaceGateways;
  workspaceTrustGateway: WorkspaceTrustGateway;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

describe("useWorkbenchController preview tabs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await flushAsyncTurns();
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
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
    expect(getWorkbench().activePath).toContain(file.path);

    await act(async () => {
      getWorkbench().closeGitDiffPreview();
      await Promise.resolve();
    });

    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().activePath).toBe(file.path);
  });

  it("opens a Git diff as an active preview tab named for the changed file", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
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
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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

    expect(getWorkbench().activePath).toContain("assets/spinner.gif");
    expect(getWorkbench().previewPath).toBe(getWorkbench().activePath);
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        name: "Diff: spinner.gif",
        path: getWorkbench().activePath,
      }),
    ]);
  });

  it("keeps an existing Git diff preview open when the same change is previewed again", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
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
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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
    const diffPath = getWorkbench().activePath!;

    await act(async () => {
      await getWorkbench().previewGitChange(change);
    });

    expect(getWorkbench().activePath).toBe(diffPath);
    expect(getWorkbench().previewPath).toBe(diffPath);
    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({ change }),
    );
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({ path: diffPath }),
    ]);
  });

  it("clears the Git diff view when its editor tab is closed", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const gitGateway: GitGateway = {
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
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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
    const diffPath = getWorkbench().activePath!;

    act(() => {
      getWorkbench().closeDocument(diffPath);
    });

    expect(getWorkbench().selectedGitChange).toBeNull();
    expect(getWorkbench().gitDiffPreview).toBeNull();
    expect(getWorkbench().gitDiffLoading).toBe(false);
    expect(getWorkbench().openDocuments).toEqual([]);
  });

  it("loads the next Git diff when closing the active diff tab", async () => {
    const firstChange = gitChangedFile("src/First.php", false);
    const secondChange = gitChangedFile("src/Second.php", false);
    const gitGateway: GitGateway = {
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
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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
    const firstDiffPath = getWorkbench().activePath!;
    await act(async () => {
      await getWorkbench().openGitChange(secondChange);
    });
    const secondDiffPath = getWorkbench().activePath!;

    act(() => {
      getWorkbench().closeDocument(secondDiffPath);
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe(firstDiffPath);
    expect(getWorkbench().selectedGitChange).toEqual(firstChange);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({
        change: firstChange,
        modifiedContent: "new src/First.php",
        originalContent: "old src/First.php",
      }),
    );
  });

  it("reloads a pinned Git diff when its tab is activated again", async () => {
    const change = gitChangedFile("assets/spinner.gif", false);
    const file = fileEntry("/workspace/src/User.php", "User.php");
    const gitGateway: GitGateway = {
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
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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
    const diffPath = getWorkbench().activePath!;

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    expect(getWorkbench().selectedGitChange).toBeNull();

    act(() => {
      getWorkbench().setActivePath(diffPath);
    });
    await flushAsyncTurns();

    expect(getWorkbench().selectedGitChange).toEqual(change);
    expect(getWorkbench().gitDiffPreview).toEqual(
      expect.objectContaining({ change }),
    );
    expect(getWorkbench().activePath).toBe(diffPath);
  });

  it("switches between persisted project tabs without stopping another project runtime", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceTabs).toEqual([
      "/workspace-a",
      "/workspace-b",
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(dependencies.terminalGateway.stopRoot).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual([
      "/workspace-a",
      "/workspace-b",
    ]);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      }),
    );
  });

  it("restores cached JavaScript and TypeScript runtime status when activating a kept-alive project tab", async () => {
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const workspaceBStatus = createDeferred<LanguageServerRuntimeStatus>();
    const runningWorkspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 88,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => {
          if (rootPath === "/workspace-b") {
            return workspaceBStatus.promise;
          }

          return { kind: "stopped" as const, rootPath };
        }),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningWorkspaceBStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningWorkspaceBStatus);
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace-b",
        sessionId: 88,
      }),
    );

    workspaceBStatus.resolve(runningWorkspaceBStatus);
    await flushAsyncTurns(24);
  });

  it("closes synced JavaScript and TypeScript documents before switching project tabs with keep-alive runtimes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 44,
    };
    const path = "/workspace-a/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
    );
  });

  it("closes synced JavaScript and TypeScript documents before stopping an active project runtime", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 45,
    };
    const path = "/workspace-a/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
      ).mock.invocationCallOrder[0],
    );
  });

  it("clears JavaScript and TypeScript diagnostics when switching project tabs", async () => {
    let publishDiagnostics:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
      {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishDiagnostics = listener;
          return () => undefined;
        }),
      };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 51,
    };
    const path = "/workspace-a/src/App.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 51,
        uri: fileUriFromPath(path),
        version: null,
      });
    });

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
  });

  it("does not reveal an active file inside a manually collapsed directory subtree", async () => {
    const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === "/workspace") {
        return [{ kind: "directory", name: "src", path: "/workspace/src" }];
      }

      if (path === "/workspace/src") {
        return [
          {
            kind: "directory",
            name: "components",
            path: "/workspace/src/components",
          },
        ];
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: null,
          bottomPanelView: "problems",
          openPaths: [],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setActivePath("/workspace/src/Initial.php");
    });
    await flushAsyncTurns();
    expect(getWorkbench().expandedDirectories.has("/workspace/src")).toBe(true);

    await act(async () => {
      await getWorkbench().toggleDirectory("/workspace/src");
    });
    readDirectory.mockClear();

    act(() => {
      getWorkbench().setActivePath("/workspace/src/components/Button.php");
    });
    await flushAsyncTurns();

    expect(getWorkbench().expandedDirectories.has("/workspace/src")).toBe(false);
    expect(
      getWorkbench().expandedDirectories.has("/workspace/src/components"),
    ).toBe(false);
    expect(readDirectory).not.toHaveBeenCalledWith(
      "/workspace/src/components",
    );
  });

  it("does not flush pending JavaScript and TypeScript edits after switching project tabs", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 52,
    };
    const path = "/workspace-a/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".ts") ? "export const value = 1;\n" : "",
      ),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.documentSyncGateway.didChange).mockClear();

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
    );
    expect(dependencies.documentSyncGateway.didChange).not.toHaveBeenCalled();
  });

  it("suspends the previous project runtimes when background engines are disabled", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-a",
    );
  });

  it("stops every inactive project runtime when only the active project may run IDE services", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "singleActive",
        workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-c");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-c",
    );
  });

  it("restores cached editor state when switching back to an open project tab", async () => {
    const readTextFile = vi.fn(async (path: string) => `content:${path}`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    const firstFile = fileEntry("/workspace-a/src/First.php", "First.php");
    const secondFile = fileEntry("/workspace-b/src/Second.php", "Second.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(firstFile);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(secondFile);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().activePath).toBe(firstFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      firstFile.path,
    ]);
    expect(
      readTextFile.mock.calls.filter(([path]) => path === firstFile.path),
    ).toHaveLength(1);
  });

  it("asks before closing an inactive project tab with cached dirty documents", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    const firstFile = fileEntry("/workspace-a/src/Dirty.php", "Dirty.php");
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(firstFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(false);
    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(getWorkbench().workspaceTabs).toEqual([
      "/workspace-a",
      "/workspace-b",
    ]);
    expect(dependencies.terminalGateway.stopRoot).not.toHaveBeenCalledWith(
      "/workspace-a",
    );
  });

  it("removes an inactive project tab without changing the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-b");
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a"]);
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-b");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      }),
    );
  });

  it("stops active project runtimes before switching to the next project tab", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-b"],
      }),
    );
  });

  it("clears the workbench and stops runtime when the last project tab closes", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: null,
        workspaceTabs: [],
      }),
    );
  });

  it("loads the Git original content for active editor change markers", async () => {
    const file = fileEntry("/workspace/src/User.php", "User.php");
    const change = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: file.path,
      relativePath: "src/User.php",
      status: "modified" as const,
    };
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "<?php\nfinal class User {}\n",
        originalContent: "<?php\nfinal class OriginalUser {}\n",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
      readTextFile: vi.fn(async () => "<?php\nfinal class User {}\n"),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(file);
    });
    await flushAsyncTurns();

    expect(gitGateway.getDiff).toHaveBeenCalledWith("/workspace", change);
    expect(getWorkbench().activeDocumentGitBaseline).toBe(
      "<?php\nfinal class OriginalUser {}\n",
    );
  });

  it("stages Git changes through the gateway and applies the refreshed status", async () => {
    const change = gitChangedFile("src/User.php", false);
    const stagedChange = { ...change, isStaged: true };
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [stagedChange],
        isRepository: true,
        rootPath,
      })),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
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
      await getWorkbench().stageGitChanges([change]);
    });

    expect(gitGateway.stageFiles).toHaveBeenCalledWith("/workspace", [change]);
    expect(getWorkbench().gitStatus.changes).toEqual([stagedChange]);
  });

  it("commits staged Git changes and clears the commit message", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: update git panel");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith(
      "/workspace",
      "feat: update git panel",
      [change],
    );
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().gitStatus.changes).toEqual([]);
  });

  it("does not commit a staged file that was excluded from the commit selection", async () => {
    const included = gitChangedFile("src/User.php", true);
    const excluded = gitChangedFile("test.txt", true);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [excluded],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [included, excluded],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().toggleGitChangeIncluded(excluded);
      getWorkbench().setGitCommitMessage("feat: selected only");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith(
      "/workspace",
      "feat: selected only",
      [included],
    );
  });

  it("keeps staged and unstaged commit selection separate for the same file", async () => {
    const staged = gitChangedFile("src/User.php", true);
    const unstaged = gitChangedFile("src/User.php", false);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [staged, unstaged],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();

    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(staged))).toBe(true);
    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(unstaged))).toBe(false);

    act(() => {
      getWorkbench().toggleGitChangeIncluded(unstaged);
      getWorkbench().setGitCommitMessage("feat: selected side");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith(
      "/workspace",
      "feat: selected side",
      [staged, unstaged],
    );
  });

  it("stages included unversioned files before committing them", async () => {
    const unversioned = {
      ...gitChangedFile("docs/new-note.md", false),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "markdown",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [unversioned],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().toggleGitChangeIncluded(unversioned);
      getWorkbench().setGitCommitMessage("docs: add note");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.stageFiles).toHaveBeenCalledWith("/workspace", [unversioned]);
    expect(gitGateway.commit).toHaveBeenCalledWith(
      "/workspace",
      "docs: add note",
      [unversioned],
    );
    expect(getWorkbench().gitCommitMessage).toBe("");
  });

  it("commits included files and pushes the branch", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: push flow");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitAndPushGitChanges();
    });

    expect(gitGateway.stageFiles).not.toHaveBeenCalled();
    expect(gitGateway.commit).toHaveBeenCalledWith(
      "/workspace",
      "feat: push flow",
      [change],
    );
    expect(gitGateway.push).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().gitCommitMessage).toBe("");
  });

  it("resets Git operation UI state when switching workspaces", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: rootPath === "/workspace-a" ? [change] : [],
        isRepository: true,
        rootPath,
      })),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: workspace a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(change))).toBe(true);
    expect(getWorkbench().gitCommitMessage).toBe("feat: workspace a");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().gitOperationLoading).toBe(false);
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().includedGitChangePaths.size).toBe(0);
  });

  it("keeps post-commit status visible and reports when push fails", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async () => {
        throw new Error("no upstream configured");
      }),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: push feedback");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitAndPushGitChanges();
    });

    expect(getWorkbench().gitStatus.changes).toEqual([]);
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().notices[0]).toEqual(
      expect.objectContaining({
        message: "Error: no upstream configured",
        source: "Git Push",
      }),
    );
  });

  it("reuses a clean preview tab for search result opens", async () => {
    const { getWorkbench } = renderController();
    const firstFile = fileEntry("/workspace/src/First.php", "First.php");
    const secondFile = fileEntry("/workspace/src/Second.php", "Second.php");

    await act(async () => {
      await getWorkbench().previewFile(firstFile);
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: secondFile.name,
        path: secondFile.path,
        relativePath: "src/Second.php",
      });
    });

    expect(getWorkbench().activePath).toBe(secondFile.path);
    expect(getWorkbench().previewPath).toBe(secondFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      secondFile.path,
    ]);
  });

  it("keeps a dirty editor tab when opening another file", async () => {
    const { getWorkbench } = renderController();
    const dirtyFile = fileEntry("/workspace/src/Dirty.php", "Dirty.php");
    const nextFile = fileEntry("/workspace/src/Next.php", "Next.php");

    await act(async () => {
      await getWorkbench().previewFile(dirtyFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class DirtyChanged {}\n");
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: nextFile.name,
        path: nextFile.path,
        relativePath: "src/Next.php",
      });
    });

    expect(getWorkbench().activePath).toBe(nextFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      dirtyFile.path,
      nextFile.path,
    ]);
    expect(getWorkbench().dirtyCount).toBe(1);
  });

  it("keeps a double-click pinned tab when another file opens", async () => {
    const { getWorkbench } = renderController();
    const pinnedFile = fileEntry("/workspace/src/Pinned.php", "Pinned.php");
    const nextFile = fileEntry("/workspace/src/Next.php", "Next.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(pinnedFile);
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: nextFile.name,
        path: nextFile.path,
        relativePath: "src/Next.php",
      });
    });

    expect(getWorkbench().activePath).toBe(nextFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      pinnedFile.path,
      nextFile.path,
    ]);
  });

  it("syncs preview documents with the language server", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 1,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      runtimeStatus: runningStatus,
    });
    const previewFile = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().previewFile(previewFile);
    });
    await flushAsyncTurns();

    expect(
      dependencies.documentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: previewFile.path }),
    );
  });

  it("keeps restored workspaces lightweight in editor mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).not.toHaveBeenCalled();
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("does not restore the terminal bottom panel on startup", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: null,
          bottomPanelView: "terminal",
          openPaths: [],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().bottomPanelVisible).toBe(false);
    expect(getWorkbench().bottomPanelView).toBe("problems");
  });

  it("starts indexing when a restored workspace is already in IDE mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
  });

  it("starts IDE services when a restored PHP workspace is already in IDE mode", async () => {
    const languageServerPlan: LanguageServerPlan = {
      command: {
        args: ["language-server"],
        executable: "phpactor",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "PHPactor is ready.",
      provider: "phpactor",
      status: "ready",
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
    expect(
      dependencies.languageServerGateway.planPhpLanguageServer,
    ).toHaveBeenCalledWith("/workspace");
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
    );
  });

  it("starts JavaScript and TypeScript language service in Basic mode", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
        hover: true,
        inlayHint: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("starts JavaScript and TypeScript language service with workspace TypeScript preference", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 16,
    };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
    });
  });

  it("asks the JavaScript TypeScript service for import edits before renaming a file", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockResolvedValue(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.rename",
    );
    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).toHaveBeenCalledWith(edit, [oldPath]);
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
  });

  it("notifies the JavaScript TypeScript service when a JS TS file is created", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.new",
    );
    await act(async () => {
      await command?.run();
    });

    expect(
      dependencies.workspaceGateways.files.createTextFile,
    ).toHaveBeenCalledWith(newPath);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "created",
        path: newPath,
      },
    ]);
  });

  it("closes a JS TS document before notifying the service that its file was deleted", async () => {
    const path = "/workspace/src/User.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.delete",
    );
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(
      path,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "deleted",
        path,
      },
    ]);
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
      ).mock.invocationCallOrder[0],
    );
  });

  it("does not start JavaScript and TypeScript language service when disabled", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "off",
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });

  it("does not restart a crashed JavaScript and TypeScript language service automatically", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: {
        kind: "crashed",
        message: "tsserver crashed",
      },
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptService: "auto",
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });

  it("stops a crashed JavaScript and TypeScript language service to release project resources", async () => {
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => ({ kind: "stopped" as const })),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.({
        kind: "crashed",
        message: "tsserver crashed",
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });

  it("cleans up a crashed background JavaScript and TypeScript service without changing the active project status", async () => {
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => ({ kind: "stopped" as const })),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.({
        kind: "crashed",
        message: "workspace b tsserver crashed",
        rootPath: "/workspace-b",
      });
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-b");
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );
  });

  it("stops JavaScript and TypeScript language service when settings disable it", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 14,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptService: "off",
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace");
  });

  it("restarts JavaScript and TypeScript language service with current settings", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 18,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    vi.mocked(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).mockClear();
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).mockClear();
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).mockClear();

    await act(async () => {
      await getWorkbench().restartJavaScriptTypeScriptService();
      await flushAsyncTurns(24);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace");
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      codeLensEnabled: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      codeLensEnabled: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
    });
    expect(getWorkbench().message).toBe("JavaScript/TypeScript service restarted.");
  });

  it("opens JavaScript and TypeScript language service log for the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openJavaScriptTypeScriptServiceLog();
      await flushAsyncTurns(4);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.openLog,
    ).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().message).toBe(
      "Opened JavaScript/TypeScript service log: /tmp/typescript-language-server.log",
    );
  });

  it("detects PHP workspace metadata before restoring startup tabs", async () => {
    const restoredPath = "/workspace/app/Http/Controllers/CommentController.php";
    const readTextFile = vi.fn(async () => "<?php\nclass CommentController {}\n");
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns();

    const detectOrder = vi.mocked(
      dependencies.workspaceGateways.detection.detectWorkspace,
    ).mock.invocationCallOrder[0];
    const restoreReadOrder = readTextFile.mock.invocationCallOrder[0];

    expect(detectOrder).toBeDefined();
    expect(restoreReadOrder).toBeDefined();
    expect(detectOrder ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      restoreReadOrder ?? 0,
    );
    expect(getWorkbench().workspaceDescriptor?.php).not.toBeNull();
    expect(getWorkbench().activePath).toBe(restoredPath);
  });

  it("clears indexed intelligence and stops the language server when IDE mode is turned off", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });
    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });

    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.indexProgressGateway.clearWorkspaceIndex,
    ).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("basic");
  });

  it("toggles file structure to inherited members on the second Cmd+R", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === childPath) {
          return "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
        }

        return "<?php\nnamespace App;\nclass ParentClass { public function inherited() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(childPath, "Child.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(
      dependencies.phpFileOutlineGateway.parsePhpFileOutline,
    ).toHaveBeenCalledWith(parentPath, expect.stringContaining("inherited"));
  });

  it("loads JavaScript and TypeScript file structure from the language server", async () => {
    const path = "/workspace/src/userService.ts";
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).mockResolvedValue([
      {
        children: [
          {
            children: [],
            containerName: null,
            detail: "(id: string)",
            kind: 6,
            name: "loadUser",
            range: range(2, 2, 4, 3),
            selectionRange: range(2, 8, 2, 16),
          },
        ],
        containerName: null,
        detail: null,
        kind: 5,
        name: "UserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 24),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}"),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    await flushAsyncTurns(12);
    await act(async () => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).toHaveBeenCalledWith("/workspace", path);
    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureCanIncludeInheritedMembers).toBe(false);
    expect(getWorkbench().fileStructureOutline?.nodes[0]).toMatchObject({
      kind: "class",
      label: "UserService",
    });
    expect(
      getWorkbench().fileStructureOutline?.nodes[0]?.children[0],
    ).toMatchObject({
      kind: "method",
      label: "loadUser",
      lineNumber: 3,
    });
  });

  it("shows interfaces in Cmd+O class search results", async () => {
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Contracts\\CommentRepository",
        kind: "interface",
        lineNumber: 3,
        name: "CommentRepository",
        path: "/workspace/app/Contracts/CommentRepository.php",
        relativePath: "app/Contracts/CommentRepository.php",
      },
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Services\\CommentService",
        kind: "class",
        lineNumber: 5,
        name: "CommentService",
        path: "/workspace/app/Services/CommentService.php",
        relativePath: "app/Services/CommentService.php",
      },
      {
        column: 21,
        containerName: "App\\Services\\CommentService",
        fullyQualifiedName: "App\\Services\\CommentService::store",
        kind: "method",
        lineNumber: 12,
        name: "store",
        path: "/workspace/app/Services/CommentService.php",
        relativePath: "app/Services/CommentService.php",
      },
    ];
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "lightSmart",
      },
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "class.quickOpen",
    );

    act(() => {
      command?.run();
      getWorkbench().setClassOpenQuery("Comment");
    });
    await waitForClassSearch();

    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).toHaveBeenCalledWith("/workspace", "Comment", 120);
    expect(getWorkbench().classOpenResults.map((result) => result.kind)).toEqual([
      "interface",
      "class",
    ]);
  });

  it("uses JavaScript and TypeScript workspace symbols for Cmd+O in Basic mode", async () => {
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        workspaceSymbol: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).mockResolvedValue([
      {
        containerName: "src/userService",
        kind: 5,
        location: {
          range: range(4, 13, 8, 1),
          uri: fileUriFromPath("/workspace/src/userService.ts"),
        },
        name: "UserService",
      },
      {
        containerName: null,
        kind: 11,
        location: {
          range: range(1, 17, 3, 1),
          uri: fileUriFromPath("/workspace/src/UserRepository.ts"),
        },
        name: "UserRepository",
      },
      {
        containerName: "UserService",
        kind: 6,
        location: {
          range: range(5, 2, 7, 3),
          uri: fileUriFromPath("/workspace/src/userService.ts"),
        },
        name: "loadUser",
      },
    ]);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench()
        .commands.find((candidate) => candidate.id === "class.quickOpen")
        ?.run();
      getWorkbench().setClassOpenQuery("User");
    });
    await waitForClassSearch();

    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).toHaveBeenCalledWith("/workspace", "User");
    expect(getWorkbench().classOpenResults.map((result) => result.name)).toEqual([
      "UserService",
      "UserRepository",
    ]);
    expect(getWorkbench().classOpenResults[0]).toMatchObject({
      kind: "class",
      lineNumber: 5,
      relativePath: "src/userService.ts",
    });
  });

  it("uses the project index for go to definition when the language server is unavailable", async () => {
    const controllerPath = "/workspace/src/CommentController.php";
    const agentPath = "/workspace/src/CommentsAgent.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 13,
        containerName: null,
        fullyQualifiedName: "App\\CommentsAgent",
        kind: "class",
        lineNumber: 4,
        name: "CommentsAgent",
        path: agentPath,
        relativePath: "src/CommentsAgent.php",
      },
    ];
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return "<?php\nfinal class CommentsAgent {}\n";
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 23,
        lineNumber: 2,
      });
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    await act(async () => {
      await command?.run();
    });

    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).toHaveBeenCalledWith("/workspace", "CommentsAgent", 25);
    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: agentPath,
      position: {
        column: 13,
        lineNumber: 4,
      },
    });
  });

  it("navigates back into the same editor tab after definition replaces it", async () => {
    const controllerPath = "/workspace/src/CommentController.php";
    const agentPath = "/workspace/src/CommentsAgent.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 13,
        containerName: null,
        fullyQualifiedName: "App\\CommentsAgent",
        kind: "class",
        lineNumber: 4,
        name: "CommentsAgent",
        path: agentPath,
        relativePath: "src/CommentsAgent.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return "<?php\nfinal class CommentsAgent {}\n";
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 23,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      agentPath,
    ]);

    await act(async () => {
      await getWorkbench().navigateBackward();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      controllerPath,
    ]);
  });

  it("resolves Laravel request input through typed parameters instead of a random input method", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const postRequestPath =
      "/workspace/app/Kontentino/src/Http/Requests/POSTRequest.php";
    const inputTraitPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 5,
        containerName: "Kontentino\\Http\\Requests\\POSTRequest",
        fullyQualifiedName: "Kontentino\\Http\\Requests\\POSTRequest::input",
        kind: "method",
        lineNumber: 16,
        name: "input",
        path: postRequestPath,
        relativePath: "app/Kontentino/src/Http/Requests/POSTRequest.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return `<?php
namespace App\\Http\\Controllers\\publicapi\\AiHub;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->input('originalComment', '');
    }
}
`;
        }

        if (path === inputTraitPath) {
          return "<?php\ntrait InteractsWithInput\n{\n    public function input($key = null, $default = null) {}\n}\n";
        }

        return "<?php\nclass POSTRequest { public function input() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 21,
        lineNumber: 10,
      });
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(inputTraitPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: inputTraitPath,
      position: {
        column: 21,
        lineNumber: 4,
      },
    });
  });

  it("provides inherited Laravel request method completions in IDE mode", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const requestPath = "/workspace/app/Http/Request/AiHub/StoreCommentRequest.php";
    const baseRequestPath = "/workspace/app/Http/Request/BaseFormRequest.php";
    const formRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php";
    const laravelRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Request.php";
    const inputTraitPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const symfonyRequestPath =
      "/workspace/vendor/symfony/http-foundation/Request.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\publicapi\\AiHub;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get
    }
}
`;
    const completionPosition = positionAfter(controllerSource, "$request->get");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === requestPath) {
          return `<?php
namespace App\\Http\\Request\\AiHub;

use App\\Http\\Request\\BaseFormRequest;

class StoreCommentRequest extends BaseFormRequest
{
    public function getCommentData(): array {}
}
`;
        }

        if (path === baseRequestPath) {
          return `<?php
namespace App\\Http\\Request;

use Illuminate\\Foundation\\Http\\FormRequest;

class BaseFormRequest extends FormRequest
{
    public function getUserData(): array {}
}
`;
        }

        if (path === formRequestPath) {
          return `<?php
namespace Illuminate\\Foundation\\Http;

use Illuminate\\Http\\Request;

class FormRequest extends Request
{
}
`;
        }

        if (path === laravelRequestPath) {
          return `<?php
namespace Illuminate\\Http;

use Symfony\\Component\\HttpFoundation\\Request as SymfonyRequest;

class Request extends SymfonyRequest
{
    use Concerns\\InteractsWithInput;
}
`;
        }

        if (path === inputTraitPath) {
          return `<?php
namespace Illuminate\\Http\\Concerns;

trait InteractsWithInput
{
    /**
     * Retrieve an input item from the request.
     *
     * @param  string|null  $key
     * @param  mixed  $default
     * @return mixed
     */
    public function input($key = null, $default = null) {}
}
`;
        }

        if (path === symfonyRequestPath) {
          return `<?php
namespace Symfony\\Component\\HttpFoundation;

class Request
{
    public function get(string $key, mixed $default = null): mixed {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        completionPosition,
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      {
        declaringClassName: "App\\Http\\Request\\AiHub\\StoreCommentRequest",
        name: "getCommentData",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "App\\Http\\Request\\BaseFormRequest",
        name: "getUserData",
        parameters: "",
        returnType: "array",
      },
    ]);

    const inputCompletionSource = controllerSource.replace(
      "$request->get",
      "$request->inp",
    );

    await expect(
      getWorkbench().providePhpMethodCompletions(
        inputCompletionSource,
        positionAfter(inputCompletionSource, "$request->inp"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Http\\Concerns\\InteractsWithInput",
        name: "input",
        parameters: "string|null $key = null, mixed $default = null",
        returnType: "mixed",
      },
    ]);

    const signatureSource = controllerSource.replace(
      "$request->get",
      "$request->get(",
    );

    await expect(
      getWorkbench().providePhpMethodSignature(
        signatureSource,
        positionAfter(signatureSource, "$request->get("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    });
  });

  it("uses semantic types from properties, assignments and static calls", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentsService.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;
use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $comment = $this->commentsService->create();
        $this->commentsService->cre
        $comment->get
        CommentFactory::ma
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

use App\\Models\\Comment;

class CommentsService
{
    public function create(): Comment {}
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getBody(): string {}
}
`;
        }

        if (path === factoryPath) {
          return `<?php
namespace App\\Factories;

use App\\Models\\Comment;

class CommentFactory
{
    public static function make(): Comment {}
    public function makeInstance(): Comment {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentsService",
        name: "create",
        parameters: "",
        returnType: "Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getBody",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "CommentFactory::ma"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Factories\\CommentFactory",
        isStatic: true,
        name: "make",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("keeps late-static fluent return types bound to the receiver class", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const baseCommentPath = "/workspace/app/Models/BaseComment.php";
    const specialCommentPath = "/workspace/app/Models/SpecialComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\SpecialComment;

class CommentController
{
    public function show(SpecialComment $comment): void
    {
        $comment->fluent()->spec
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === baseCommentPath) {
          return `<?php
namespace App\\Models;

class BaseComment
{
    /** @return static */
    public function fluent() {}
}
`;
        }

        if (path === specialCommentPath) {
          return `<?php
namespace App\\Models;

class SpecialComment extends BaseComment
{
    public function specialOnly(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->fluent()->spec"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\SpecialComment",
        name: "specialOnly",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("uses Laravel container receivers for method completions and signatures", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;

class CommentController
{
    public function store(): void
    {
        app(CommentService::class)->cre
        App::make(CommentService::class)->cre
        Container::getInstance()->make(CommentService::class)->cre
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(array $attachments = []): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    const expectedCompletion = [
      {
        declaringClassName: "App\\Services\\CommentService",
        name: "createWithAttachments",
        parameters: "array $attachments = []",
        returnType: "string",
      },
    ];

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app(CommentService::class)->cre"),
      ),
    ).resolves.toEqual(expectedCompletion);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "App::make(CommentService::class)->cre"),
      ),
    ).resolves.toEqual(expectedCompletion);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(
          controllerSource,
          "Container::getInstance()->make(CommentService::class)->cre",
        ),
      ),
    ).resolves.toEqual(expectedCompletion);

    const signatureSource = controllerSource.replace(
      "app(CommentService::class)->cre",
      "app(CommentService::class)->createWithAttachments(",
    );

    await expect(
      getWorkbench().providePhpMethodSignature(
        signatureSource,
        positionAfter(
          signatureSource,
          "app(CommentService::class)->createWithAttachments(",
        ),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: expectedCompletion[0],
      parameters: [
        {
          defaultValue: "[]",
          name: "$attachments",
          optional: true,
          raw: "array $attachments = []",
          type: "array",
        },
      ],
    });
  });

  it("uses generic class-string helpers for method completions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const locatorPath = "/workspace/app/Support/ServiceLocator.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;
use App\\Support\\ServiceLocator;

/**
 * @template T of object
 * @param class-string<T> $className
 * @return T
 */
function service(string $className): object {}

class CommentController
{
    public function __construct(
        private readonly ServiceLocator $locator,
    ) {}

    public function store(): void
    {
        $service = $this->locator->get(CommentService::class);
        $service->cre
        $this->locator->get(CommentService::class)->cre
        ServiceLocator::get(CommentService::class)->cre
        service(CommentService::class)->cre
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === locatorPath) {
          return `<?php
namespace App\\Support;

class ServiceLocator
{
    /**
     * @template T of object
     * @param class-string<T> $className
     * @return T
     */
    public static function get(string $className): object {}
}
`;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    const expectedCompletion = [
      {
        declaringClassName: "App\\Services\\CommentService",
        name: "createWithAttachments",
        parameters: "",
        returnType: "string",
      },
    ];

    for (const needle of [
      "$service->cre",
      "$this->locator->get(CommentService::class)->cre",
      "ServiceLocator::get(CommentService::class)->cre",
      "service(CommentService::class)->cre",
    ]) {
      await expect(
        getWorkbench().providePhpMethodCompletions(
          controllerSource,
          positionAfter(controllerSource, needle),
        ),
      ).resolves.toEqual(expectedCompletion);
    }
  });

  it("opens Laravel container receiver method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;

class CommentController
{
    public function store(): void
    {
        app(CommentService::class)->createWithAttachments();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(array $attachments = []): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(
          controllerSource,
          "app(CommentService::class)->createWithAttachments",
        ),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(servicePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: servicePath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });

  it("infers assigned variable completions from indexed interface method return types", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("resolves generic repository interface method returns through PHPDoc extends", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const baseRepositoryInterfacePath =
      "/workspace/app/Contracts/RepositoryInterface.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 10,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\RepositoryInterface",
          kind: "interface",
          lineNumber: 8,
          name: "RepositoryInterface",
          path: baseRepositoryInterfacePath,
          relativePath: "app/Contracts/RepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 5,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Models\\Comment;

/**
 * @phpstan-extends RepositoryInterface<Comment>
 */
interface CommentRepositoryInterface extends RepositoryInterface
{
}
`;
        }

        if (path === baseRepositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @template TModel of object
 */
interface RepositoryInterface
{
    /** @return TModel */
    public function findOrFail(int $id);
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("uses Laravel container bindings to infer interface implementation return types", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath =
      "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const repositoryPath =
      "/workspace/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->force
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          return `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
    }
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment
    {
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "CommentRepositoryInterface::class"
          ? [
              {
                column: 26,
                lineNumber: 11,
                lineText:
                  "        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);",
                path: providerPath,
                relativePath: "app/Providers/AppServiceProvider.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "findOrFail"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(repositoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: repositoryPath,
      position: {
        column: 21,
        lineNumber: 9,
      },
    });
  });

  it("offers model methods and properties after typed repository findOrFail assignments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->

        $builderComment = $comment->newQuery()->first();
        $builderComment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

if (path === commentPath) {
  return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\Casts\\Attribute;

/**
 * @property string $body
 */
class Comment
{
    protected $appends = ['summary'];

    protected $fillable = [
        'account_id',
        'user_id',
        'model_name',
        'model_id',
        'parent_id',
        'content',
        'type',
        'thread',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
    ];

    public string $status;

    public function getContent(): string {}

    /** @return Attribute<string, never> */
    protected function displayName(): Attribute
    {
        return Attribute::make(get: fn () => '');
    }
}
`;
}

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "account_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "body",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "display_name",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "is_pinned",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "meta",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "model_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "model_name",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "parent_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "status",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "summary",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "thread",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "type",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "user_id",
        parameters: "",
        returnType: "mixed",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$builderComment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("offers PHPDoc mixin members on inferred model receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const helperPath =
      "/workspace/app/Kontentino/src/Communication/Models/CommentIdeHelper.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->hel
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Models\\CommentIdeHelper",
          kind: "class",
          lineNumber: 3,
          name: "CommentIdeHelper",
          path: helperPath,
          relativePath:
            "app/Kontentino/src/Communication/Models/CommentIdeHelper.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

/**
 * @mixin CommentIdeHelper
 */
class Comment
{
}
`;
        }

        if (path === helperPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class CommentIdeHelper
{
    public function helpful(string $mode = 'fast'): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->hel"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName:
          "Kontentino\\Communication\\Models\\CommentIdeHelper",
        name: "helpful",
        parameters: "string $mode = 'fast'",
        returnType: "string",
      },
    ]);
  });

  it("infers Laravel relation model completions from property and relation chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const userPath = "/workspace/app/Models/User.php";
    const commentModelSource = `<?php
namespace Kontentino\\Communication\\Models;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;
use Illuminate\\Database\\Eloquent\\Relations\\MorphedByMany;
use Illuminate\\Database\\Eloquent\\Model;

/** @property-read \\Illuminate\\Database\\Eloquent\\Collection<int, User> $reviewers */
class Comment
{
    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Comment::class, 'parent_id');
    }

    public function namedChildren(): HasMany
    {
        return $this->hasMany(
            foreignKey: 'parent_id',
            related: Comment::class,
        );
    }

    /** @return BelongsTo<Comment, self> */
    public function documentedParent(): BelongsTo
    {
        return $this->belongsTo();
    }

    /** @return MorphTo<Model, User> */
    public function documentedOwner(): MorphTo
    {
        return $this->morphTo();
    }

    public function likers(): MorphedByMany
    {
        return $this->morphedByMany(User::class, 'likeable');
    }

    public function getContent(): string {}
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->par
        $comment->parent->get

        $parent = $comment->parent()->first();
        $parent->getContent();

        $child = $comment->children()->get()->first();
        $child->get

        $childFromProperty = $comment->children->first();
        $childFromProperty->get

        $filteredChildFromProperty = $comment->children->filter()->first();
        $filteredChildFromProperty->get

        $reviewer = $comment->reviewers->first();
        $reviewer->get

        $owner = $comment->documentedOwner;
        $owner->get

        $documentedParent = $comment->documentedParent()->first();
        $documentedParent->get

        $liker = $comment->likers()->first();
        $liker->get

        $namedChild = $comment->namedChildren()->first();
        $namedChild->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\User",
          kind: "class",
          lineNumber: 5,
          name: "User",
          path: userPath,
          relativePath: "app/Models/User.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === userPath) {
          return `<?php
namespace App\\Models;

class User
{
    public function getName(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->par"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "parent",
        parameters: "",
        returnType: "BelongsTo",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->parent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$parent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$documentedParent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$childFromProperty->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$filteredChildFromProperty->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$reviewer->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$child->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$liker->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$namedChild->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$parent->getContent"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "getContent"),
      },
    });
  });

  it("opens inherited Laravel model methods from repository model assignments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->forceDelete();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName:
            "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;
}
`;
        }

        if (path === softDeletesPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\SoftDeletes",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->forceDelete"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(softDeletesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: softDeletesPath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });

  it("suppresses trait host-method diagnostics when an indexed host provides the method", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 9,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: {
        command: {
          args: ["language-server"],
          executable: "phpactor",
          workingDirectory: "/workspace",
        },
        initializeRequest: null,
        message: "PHPactor ready",
        provider: "phpactor",
        status: "ready",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment extends Model
{
    use SoftDeletes;
}
`;
        }

        if (path === modelPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchFiles: vi.fn(async (_root, query) =>
        query === "Comment.php"
          ? [
              {
                name: "Comment.php",
                path: commentPath,
                relativePath:
                  "app/Kontentino/src/Communication/Models/Comment.php",
              },
            ]
          : [],
      ),
      searchText: vi.fn(async () => [
        {
          column: 5,
          lineNumber: 9,
          lineText: "    use SoftDeletes;",
          path: commentPath,
          relativePath:
            "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(runningStatus);
    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: 7,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toEqual(
      [],
    );
  });

  it("suppresses static local-scope diagnostics only when the model defines the scope", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::published()->first();
        Album::missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 12,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public function scopePublished(Builder $query): Builder
    {
        return $query;
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 16,
            line: 9,
            message: "Method App\\Models\\Album::published() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: 10,
            message: "Method App\\Models\\Album::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: 10,
        message: "Method App\\Models\\Album::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("keeps Laravel Eloquent builder generics through fluent chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumCollectionPath = "/workspace/app/Collections/AlbumCollection.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;
use App\\Models\\Album;

class AlbumController
{
    public function index(Album $existingAlbum): void
    {
        $album = Album::query()->whereNull('parent_id')->first();
        $album->get

        $factoryAlbum = $existingAlbum->newQuery()->whereNull('parent_id')->first();
        $factoryAlbum->get

        $factoryQuery = $existingAlbum->newModelQuery();
        $factoryQuery->pub
        $factoryQuery->published()->ord

        $trashedAlbum = Album::withTrashed()->whereNull('parent_id')->first();
        $trashedAlbum->get

        Album::withR
        Album::withRelations(
        Album::pub
        Album::published(

        $albumWithRelations = Album::withRelations()->findOrFail(1);
        $albumWithRelations->get

        $albumFromCollection = Album::query()->whereNull('parent_id')->get()->first();
        $albumFromCollection->get

        $filteredAlbumFromCollection = Album::query()->whereNull('parent_id')->get()->filter()->first();
        $filteredAlbumFromCollection->get

        $albums = Album::query()->get();
        $albumFromAssignedCollection = $albums->first();
        $albumFromAssignedCollection->get

        $filteredAlbums = Album::query()->get()->filter();
        $albumFromAssignedFilteredCollection = $filteredAlbums->first();
        $albumFromAssignedFilteredCollection->get

        $query = Album::query();
        $query->whereNull('parent_id')->ord
        $query->withTrashed()->ord
        $query->pub
        $query->published()->ord

        $scopedAlbum = Album::query()->published()->first();
        $scopedAlbum->get

        /** @var \\Illuminate\\Database\\Eloquent\\Builder<Album> $typedQuery */
        $typedQuery = Album::query();
        $typed = $typedQuery->first();
        $typed->get

        /** @var \\Illuminate\\Database\\Eloquent\\Collection<int, Album> $typedAlbums */
        $typedAlbums = Album::query()->get();
        $typedAlbum = $typedAlbums->first();
        $typedAlbum->get

        /** @var \\Illuminate\\Database\\Eloquent\\Collection<int, Album> $documentedAlbums */
        $documentedAlbum = $documentedAlbums->first();
        $documentedAlbum->get

        /** @var AlbumCollection $customAlbums */
        $customAlbum = $customAlbums->first();
        $customAlbum->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

class Album
{
    public string $title;

    public function getTitle(): string {}

    public function scopePublished($query, bool $strict = true): void {}
    public function scopeWithRelations(Builder $query): Builder {}
}
`;
        }

        if (path === albumCollectionPath) {
          return `<?php
namespace App\\Collections;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Collection;

/** @phpstan-extends Collection<int, Album> */
class AlbumCollection extends Collection
{
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    /** @return static */
    public function whereNull($columns, $boolean = 'and', $not = false) {}

    /** @return static */
    public function orderBy($column, $direction = 'asc') {}

    /** @return \\Illuminate\\Database\\Eloquent\\Collection<int, TModel> */
    public function get($columns = ['*']) {}

    /** @return TModel|null */
    public function first($columns = ['*']) {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$album->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumFromCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$filteredAlbumFromCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$trashedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Album::withR"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "withRelations",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Album::withRelations("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "withRelations",
        parameters: "",
        returnType: "Builder",
      },
      parameters: [],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Album::pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Album::published("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      parameters: [
        {
          defaultValue: "true",
          name: "$strict",
          optional: true,
          raw: "bool $strict = true",
          type: "bool",
        },
      ],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumWithRelations->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumFromAssignedCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(
          controllerSource,
          "$albumFromAssignedFilteredCollection->get",
        ),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereNull('parent_id')->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->withTrashed()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$scopedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$typedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$typed->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$documentedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$customAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("infers Laravel relation query callback builders", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const trackPath = "/workspace/app/Models/Track.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::query()->whereHas('tracks', function ($query): void {
            $query->pub
            $query->published()->ord
            $track = $query->first();
            $track->get
        });

        Album::query()->whereHas('tracks', fn ($arrowQuery) => $arrowQuery->pub);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Album",
          kind: "class",
          lineNumber: 7,
          name: "Album",
          path: albumPath,
          relativePath: "app/Models/Album.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Track",
          kind: "class",
          lineNumber: 7,
          name: "Track",
          path: trackPath,
          relativePath: "app/Models/Track.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Album
{
    public function tracks(): HasMany
    {
        return $this->hasMany(Track::class);
    }
}
`;
        }

        if (path === trackPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Track
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    /** @return static */
    public function orderBy($column, $direction = 'asc') {}

    /** @return TModel|null */
    public function first($columns = ['*']) {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$track->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$arrowQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
  });

  it("opens Laravel fluent builder methods from chained calls", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        $album = Album::query()->whereNull('parent_id')->first();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    public function whereNull($columns, $boolean = 'and')
    {
        return $this;
    }

    public function first($columns = ['*'])
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "->first"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(builderPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: builderPath,
      position: {
        column: 21,
        lineNumber: 11,
      },
    });
  });

  it("opens Laravel static model scope and builder magic methods", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::withRelations()->findOrFail(1);
        Album::whereNull('parent_id')->first();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public function scopeWithRelations(Builder $query): Builder
    {
        return $query;
    }
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    public function whereNull($columns, $boolean = 'and', $not = false)
    {
        return $this;
    }

    public function findOrFail($id)
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Album::withRelations"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(albumPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: albumPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Album::whereNull"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(builderPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: builderPath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });

  it("falls back to verified PHP filename lookup before the index is warm", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath =
      "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->get
    }
}
`;
    const searchFiles = vi.fn(
      async (_root: string, query: string): Promise<FileSearchResult[]> => {
        if (query === "CommentRepositoryInterface.php") {
          return [
            {
              name: "CommentRepositoryInterface.php",
              path: repositoryInterfacePath,
              relativePath:
                "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
            },
          ];
        }

        if (query === "Comment.php") {
          return [
            {
              name: "Comment.php",
              path: commentPath,
              relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
            },
          ];
        }

        return [];
      },
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    expect(searchFiles).toHaveBeenCalledWith(
      "/workspace",
      "CommentRepositoryInterface.php",
      40,
    );
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });

  it("uses filename lookup when Composer PSR-4 points at a missing model path", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const expectedPsrModelPath = "/workspace/app/Models/Comment.php";
    const actualModelPath = "/workspace/packages/domain/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const searchFiles = vi.fn(
      async (_root: string, query: string): Promise<FileSearchResult[]> => {
        if (query === "Comment.php") {
          return [
            {
              name: "Comment.php",
              path: actualModelPath,
              relativePath: "packages/domain/Models/Comment.php",
            },
          ];
        }

        return [];
      },
    );
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === repositoryPath) {
        return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class CommentRepository
{
    public function findOrFail(int $id): Comment {}
}
`;
      }

      if (path === expectedPsrModelPath) {
        throw new Error("missing PSR-4 model path");
      }

      if (path === actualModelPath) {
        return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile,
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    expect(readTextFile).toHaveBeenCalledWith(expectedPsrModelPath);
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });

  it("opens Laravel database connection methods inferred from return expressions", async () => {
    const localUserPath = "/workspace/app/Models/LocalUser.php";
    const userAccountPath = "/workspace/app/Models/UserAccount.php";
    const userAccountModelPath =
      "/workspace/app/Kontentino/src/Eloquent/UserAccountModel.php";
    const eloquentModelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const connectionPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Connection.php";
    const queryBuilderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php";
    const localUserSource = `<?php
namespace App\\Models;

class LocalUser
{
    /** @var UserAccount */
    private $userAccount = null;

    public function loadByLogin($login)
    {
        $connection = $this->userAccount->getDatabaseConnection();
        $userData = $connection->table('users')->get();
        $connection->table('users')->wh
        $userQuery = $connection->table('users')->where('login', $login);
        $userQuery->ord
    }
}
`;
    const workspaceDescriptor = phpWorkspaceDescriptor();
    workspaceDescriptor.php?.psr4Roots.push({
      dev: false,
      namespace: "Kontentino\\",
      paths: ["app/Kontentino/src/"],
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === localUserPath) {
        return localUserSource;
      }

      if (path === userAccountPath) {
        return `<?php
namespace App\\Models;

use Kontentino\\Eloquent\\UserAccountModel;

class UserAccount
{
    public function getDatabaseConnection()
    {
        return new UserAccountModel()->getConnection();
    }
}
`;
      }

      if (path === userAccountModelPath) {
        return `<?php
namespace Kontentino\\Eloquent;

use Illuminate\\Database\\Eloquent\\Model;

class UserAccountModel extends Model
{
}
`;
      }

      if (path === eloquentModelPath) {
        return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    /**
     * @return \\Illuminate\\Database\\Connection
     */
    public function getConnection()
    {
    }
}
`;
      }

      if (path === connectionPath) {
        return `<?php
namespace Illuminate\\Database;

class Connection
{
    public function table($table, $as = null)
    {
    }
}
`;
      }

      if (path === queryBuilderPath) {
        return `<?php
namespace Illuminate\\Database\\Query;

class Builder
{
    public function where($column, $operator = null, $value = null, $boolean = 'and')
    {
    }

    public function orderBy($column, $direction = 'asc')
    {
    }

    public function first($columns = ['*'])
    {
    }
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor,
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(localUserPath, "LocalUser.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(localUserSource, "$connection->table"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect({
      activePath: getWorkbench().activePath,
      editorRevealTarget: getWorkbench().editorRevealTarget,
      message: getWorkbench().message,
    }).toEqual({
      activePath: connectionPath,
      editorRevealTarget: {
        path: connectionPath,
        position: {
          column: 21,
          lineNumber: 6,
        },
      },
      message: "Opened table() Connection.php:6:21",
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        localUserSource,
        positionAfter(localUserSource, "$connection->table('users')->wh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Query\\Builder",
        name: "where",
        parameters:
          "$column, $operator = null, $value = null, $boolean = 'and'",
        returnType: null,
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        localUserSource,
        positionAfter(localUserSource, "$userQuery->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Query\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: null,
      },
    ]);
  });

  it("resolves Laravel route action strings to the paired controller method before LSP fallback", async () => {
    const routesPath = "/workspace/routes/comments.php";
    const commentControllerPath =
      "/workspace/app/Http/Controllers/communication/CommentController.php";
    const reactionControllerPath =
      "/workspace/app/Http/Controllers/communication/ReactionController.php";
    const languageServerFeaturesGateway = featuresGateway();
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\ReactionController",
        fullyQualifiedName:
          "App\\Http\\Controllers\\communication\\ReactionController::store",
        kind: "method",
        lineNumber: 8,
        name: "store",
        path: reactionControllerPath,
        relativePath: "app/Http/Controllers/communication/ReactionController.php",
      },
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\CommentController",
        fullyQualifiedName:
          "App\\Http\\Controllers\\communication\\CommentController::store",
        kind: "method",
        lineNumber: 12,
        name: "store",
        path: commentControllerPath,
        relativePath: "app/Http/Controllers/communication/CommentController.php",
      },
    ];
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === routesPath) {
          return `<?php
use App\\Http\\Controllers\\communication\\CommentController;
use App\\Http\\Controllers\\communication\\ReactionController;

Route::post('/comments', [CommentController::class, 'store']);
Route::post('/reactions', [ReactionController::class, 'store']);
`;
        }

        return "<?php\nclass Controller { public function store() {} }\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 1,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(routesPath, "comments.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 54,
        lineNumber: 5,
      });
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).toHaveBeenCalledWith("/workspace", "store", 50);
    expect(getWorkbench().activePath).toBe(commentControllerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentControllerPath,
      position: {
        column: 21,
        lineNumber: 12,
      },
    });
  });

  it("resolves imported FormRequest to vendor instead of a local substring class", async () => {
    const requestPath = "/workspace/app/Http/Request/AiHub/StoreCommentRequest.php";
    const baseRequestPath = "/workspace/app/Http/Request/BaseFormRequest.php";
    const formRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Http\\Request\\BaseFormRequest",
        kind: "class",
        lineNumber: 14,
        name: "BaseFormRequest",
        path: baseRequestPath,
        relativePath: "app/Http/Request/BaseFormRequest.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === requestPath) {
          return `<?php
namespace App\\Http\\Request\\AiHub;

use Illuminate\\Foundation\\Http\\FormRequest;

class StoreCommentRequest extends FormRequest
{
}
`;
        }

        if (path === formRequestPath) {
          return "<?php\nnamespace Illuminate\\Foundation\\Http;\nclass FormRequest extends Request {}\n";
        }

        return "<?php\nclass BaseFormRequest {}\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(requestPath, "StoreCommentRequest.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 37,
        lineNumber: 6,
      });
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(formRequestPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: formRequestPath,
      position: {
        column: 7,
        lineNumber: 3,
      },
    });
  });

  it("opens implementation targets from an explicit editor position", async () => {
    const interfacePath = "/workspace/app/Contracts/SearchRepository.php";
    const implementationPath = "/workspace/app/Repositories/AlbumRepository.php";
    const implementation = vi.fn(async () => [
      {
        range: {
          end: {
            character: 27,
            line: 14,
          },
          start: {
            character: 20,
            line: 14,
          },
        },
        uri: "file:///workspace/app/Repositories/AlbumRepository.php",
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return `<?php

interface SearchRepository
{
    public function search(array $searchParams): LengthAwarePaginator;
}
`;
        }

        return "<?php\nfinal class AlbumRepository {}\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().startLanguageServer();
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(interfacePath, "SearchRepository.php"),
      );
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerRuntimeStatus?.kind).toBe("running");

    await act(async () => {
      await getWorkbench().goToImplementationAt({
        column: 21,
        lineNumber: 5,
      });
    });

    expect(implementation).toHaveBeenCalledWith("/workspace", {
      character: 20,
      line: 4,
      path: interfacePath,
    });
    expect(getWorkbench().activePath).toBe(implementationPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: implementationPath,
      position: {
        column: 21,
        lineNumber: 15,
      },
    });
  });

  it("asks which implementation to open when a symbol has multiple targets", async () => {
    const interfacePath = "/workspace/app/Contracts/PlatformAdapter.php";
    const baseAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/BaseAdapter.php";
    const facebookAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementation = vi.fn(async () => [
      {
        range: {
          end: {
            character: 31,
            line: 6,
          },
          start: {
            character: 20,
            line: 6,
          },
        },
        uri: "file:///workspace/app/Services/Analytics/Adapters/BaseAdapter.php",
      },
      {
        range: {
          end: {
            character: 31,
            line: 6,
          },
          start: {
            character: 20,
            line: 6,
          },
        },
        uri: "file:///workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === baseAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters;

abstract class BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        if (path === facebookAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

final class FacebookAdapterService extends BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        return "<?php\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().startLanguageServer();
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(interfacePath, "PlatformAdapter.php"),
      );
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().goToImplementationAt({
        column: 23,
        lineNumber: 7,
      });
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().implementationChooser?.title).toBe(
      "Choose implementation of getPlatform",
    );
    expect(
      getWorkbench().implementationChooser?.targets.map((target) => ({
        detail: target.detail,
        label: target.label,
        path: target.path,
      })),
    ).toEqual([
      {
        detail: "\\App\\Services\\Analytics\\Adapters",
        label: "BaseAdapter",
        path: baseAdapterPath,
      },
      {
        detail: "\\App\\Services\\Analytics\\Adapters\\Facebook",
        label: "FacebookAdapterService",
        path: facebookAdapterPath,
      },
    ]);

    await act(async () => {
      const target = getWorkbench().implementationChooser?.targets[1];

      if (!target) {
        throw new Error("Expected a second implementation target.");
      }

      await getWorkbench().openImplementationTarget(target);
    });

    expect(getWorkbench().implementationChooser).toBe(null);
    expect(getWorkbench().activePath).toBe(facebookAdapterPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: facebookAdapterPath,
      position: {
        column: 21,
        lineNumber: 7,
      },
    });
  });

  function renderController({
    appSettings = defaultAppSettings(),
    gitGateway,
    javaScriptTypeScriptInitialRuntimeStatus = { kind: "stopped" as const },
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatus = { kind: "stopped" as const },
    languageServerPlan,
    languageServerDiagnosticsGateway,
    languageServerFeaturesGateway,
    projectSymbols = [],
    readDirectory,
    readTextFile = vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    runtimeStatus = { kind: "stopped" as const },
    searchFiles = vi.fn(async () => []),
    searchText,
    workspaceDescriptor,
    workspaceSettings = defaultWorkspaceSettings(),
  }: {
    appSettings?: ReturnType<typeof defaultAppSettings>;
    gitGateway?: GitGateway;
    javaScriptTypeScriptInitialRuntimeStatus?: LanguageServerRuntimeStatus;
    javaScriptTypeScriptLanguageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
    javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
    javaScriptTypeScriptLanguageServerPlan?: LanguageServerPlan;
    javaScriptTypeScriptLanguageServerRuntimeGateway?: LanguageServerRuntimeGateway;
    javaScriptTypeScriptRuntimeStatus?: LanguageServerRuntimeStatus;
    languageServerPlan?: LanguageServerPlan;
    languageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
    languageServerFeaturesGateway?: LanguageServerFeaturesGateway;
    projectSymbols?: ProjectSymbolSearchResult[];
    readDirectory?: (path: string) => Promise<FileEntry[]>;
    readTextFile?: (path: string) => Promise<string>;
    runtimeStatus?: LanguageServerRuntimeStatus;
    searchFiles?: (
      root: string,
      query: string,
      limit: number,
    ) => Promise<FileSearchResult[]>;
    searchText?: (
      root: string,
      query: string,
      limit: number,
    ) => Promise<TextSearchResult[]>;
    workspaceDescriptor?: WorkspaceDescriptor;
    workspaceSettings?: ReturnType<typeof defaultWorkspaceSettings>;
  } = {}) {
    let workbench: WorkbenchController | null = null;
    const dependencies = createControllerDependencies({
      appSettings,
      gitGateway,
      javaScriptTypeScriptInitialRuntimeStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus,
      languageServerPlan,
      languageServerDiagnosticsGateway,
      languageServerFeaturesGateway,
      projectSymbols,
      readDirectory,
      readTextFile,
      runtimeStatus,
      searchFiles,
      searchText,
      workspaceDescriptor,
      workspaceSettings,
    });
    const getWorkbench = () => {
      if (!workbench) {
        throw new Error("Workbench controller was not rendered.");
      }

      return workbench;
    };

    act(() => {
      root.render(
        <WorkbenchHarness
          dependencies={dependencies}
          onWorkbench={(nextWorkbench) => {
            workbench = nextWorkbench;
          }}
        />,
      );
    });

    return { dependencies, getWorkbench };
  }
});

function WorkbenchHarness({
  dependencies,
  onWorkbench,
}: {
  dependencies: ControllerDependencies;
  onWorkbench(workbench: WorkbenchController): void;
}) {
  const workbench = useWorkbenchController(
    dependencies.workspaceGateways,
    dependencies.smartModeGateway,
    dependencies.workspaceTrustGateway,
    dependencies.indexProgressGateway,
    dependencies.phpFileOutlineGateway,
    dependencies.phpTreeGateway,
    dependencies.gitGateway,
    dependencies.languageServerGateway,
    dependencies.languageServerRuntimeGateway,
    dependencies.languageServerDocumentSyncGateway,
    dependencies.languageServerDiagnosticsGateway,
    dependencies.languageServerFeaturesGateway,
    dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
    dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    dependencies.javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    dependencies.javaScriptTypeScriptLanguageServerFeaturesGateway,
    dependencies.terminalGateway,
    dependencies.settingsGateway,
    dependencies.prompter,
  );

  useEffect(() => {
    onWorkbench(workbench);
  }, [onWorkbench, workbench]);

  return null;
}

function createControllerDependencies({
  appSettings,
  gitGateway,
  javaScriptTypeScriptInitialRuntimeStatus,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerPlan,
  javaScriptTypeScriptLanguageServerRuntimeGateway,
  javaScriptTypeScriptRuntimeStatus,
  languageServerPlan,
  languageServerFeaturesGateway,
  languageServerDiagnosticsGateway,
  projectSymbols,
  readDirectory,
  readTextFile,
  runtimeStatus,
  searchFiles,
  searchText,
  workspaceDescriptor,
  workspaceSettings,
}: {
  appSettings: ReturnType<typeof defaultAppSettings>;
  gitGateway?: GitGateway;
  javaScriptTypeScriptInitialRuntimeStatus: LanguageServerRuntimeStatus;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerPlan?: LanguageServerPlan;
  javaScriptTypeScriptLanguageServerRuntimeGateway?: LanguageServerRuntimeGateway;
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus;
  languageServerPlan?: LanguageServerPlan;
  languageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  languageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  projectSymbols: ProjectSymbolSearchResult[];
  readDirectory?: (path: string) => Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
  runtimeStatus: LanguageServerRuntimeStatus;
  searchFiles(
    root: string,
    query: string,
    limit: number,
  ): Promise<FileSearchResult[]>;
  searchText?(
    root: string,
    query: string,
    limit: number,
  ): Promise<TextSearchResult[]>;
  workspaceDescriptor?: WorkspaceDescriptor;
  workspaceSettings: ReturnType<typeof defaultWorkspaceSettings>;
}): ControllerDependencies {
  const documentSyncGateway: LanguageServerDocumentSyncGateway = {
    didChange: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
    didOpen: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
  };
  const workspaceGateways: WorkbenchWorkspaceGateways = {
    detection: {
      detectWorkspace: vi.fn(async (path) => ({
        javaScriptTypeScript:
          workspaceDescriptor?.javaScriptTypeScript ?? null,
        php: workspaceDescriptor?.php ?? null,
        rootPath: path,
      })),
    },
    fileSearch: {
      searchFiles,
    },
    files: {
      applyWorkspaceEdit: vi.fn(async () => 0),
      createDirectory: vi.fn(async () => undefined),
      createTextFile: vi.fn(async () => undefined),
      deletePath: vi.fn(async () => undefined),
      readDirectory: vi.fn(readDirectory ?? (async () => [])),
      readTextFile,
      renamePath: vi.fn(async () => undefined),
      writeTextFile: vi.fn(async () => undefined),
    },
    phpTools: {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
    },
    projectSymbols: {
      searchProjectSymbols: vi.fn(async () => projectSymbols),
    },
    textSearch: {
      searchText: vi.fn(searchText ?? (async () => [])),
    },
  };

  return {
    documentSyncGateway,
    gitGateway: gitGateway ?? {
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, change) => ({
        change,
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
    },
    indexProgressGateway: {
      clearWorkspaceIndex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
    },
    languageServerDiagnosticsGateway:
      languageServerDiagnosticsGateway ?? {
        subscribeDiagnostics: vi.fn(async () => () => undefined),
      },
    languageServerDocumentSyncGateway: documentSyncGateway,
    languageServerFeaturesGateway:
      languageServerFeaturesGateway ?? featuresGateway(),
    languageServerGateway: {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          javaScriptTypeScriptLanguageServerPlan ??
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          } satisfies LanguageServerPlan),
      ),
      planPhpLanguageServer: vi.fn(
        async () =>
          languageServerPlan ?? {
            command: null,
            initializeRequest: null,
            message: "Language server unavailable in test.",
            provider: "phpactor" as const,
            status: "unavailable" as const,
          },
      ),
    },
    languageServerRuntimeGateway: {
      getStatus: vi.fn(async () => runtimeStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runtimeStatus),
      stop: vi.fn(async () => ({ kind: "stopped" as const })),
      subscribeStatus: vi.fn(async () => () => undefined),
    },
    javaScriptTypeScriptLanguageServerDiagnosticsGateway:
      javaScriptTypeScriptLanguageServerDiagnosticsGateway ?? {
        subscribeDiagnostics: vi.fn(async () => () => undefined),
      },
    javaScriptTypeScriptLanguageServerDocumentSyncGateway: documentSyncGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway:
      javaScriptTypeScriptLanguageServerFeaturesGateway ?? featuresGateway(),
    javaScriptTypeScriptLanguageServerRuntimeGateway:
      javaScriptTypeScriptLanguageServerRuntimeGateway ?? {
        getStatus: vi.fn(async () => javaScriptTypeScriptInitialRuntimeStatus),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => javaScriptTypeScriptRuntimeStatus),
        stop: vi.fn(async () => ({ kind: "stopped" as const })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
    phpFileOutlineGateway: {
      getPhpFileOutline: vi.fn(async () => ({ nodes: [] })),
      parsePhpFileOutline: vi.fn(async () => ({ nodes: [] })),
    },
    phpTreeGateway: {
      getPhpTree: vi.fn(async () => ({ nodes: [] })),
    },
    prompter: {
      confirm: vi.fn(() => true),
      prompt: vi.fn(() => null),
    },
    settingsGateway: {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async () => workspaceSettings),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    },
    smartModeGateway: {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (mode) => ({
        message: "Updated",
        mode,
        status: "ready" as const,
      })),
    },
    terminalGateway: {
      listProfiles: vi.fn(async () => []),
      resize: vi.fn(async () => undefined),
      start: vi.fn(async () => ({ kind: "stopped" as const, sessionId: 1 })),
      stop: vi.fn(async (sessionId) => ({
        kind: "stopped" as const,
        sessionId,
      })),
      stopAll: vi.fn(async () => undefined),
      stopRoot: vi.fn(async () => undefined),
      subscribeOutput: vi.fn(async () => () => undefined),
      writeInput: vi.fn(async () => undefined),
    },
    workspaceGateways,
    workspaceTrustGateway: {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    },
  };
}

function featuresGateway(): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(async () => ({
      isIncomplete: false,
      items: [],
    })),
    definition: vi.fn(async () => []),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeCommand: vi.fn(async () => null),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    hover: vi.fn(async () => null),
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => []),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    rangeFormatting: vi.fn(async () => []),
    references: vi.fn(async () => []),
    rename: vi.fn(async () => null),
    selectionRanges: vi.fn(async () => []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => null),
    typeDefinition: vi.fn(async () => []),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(async (_rootPath, action) => action),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject(error: unknown) {
      rejectValue?.(error);
    },
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}

async function flushAsyncTurns(count = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

async function waitForClassSearch(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    await Promise.resolve();
  });
}

function phpWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: phpProjectDescriptor(),
    rootPath: "/workspace",
  };
}

function javaScriptTypeScriptWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: {
      frameworks: [],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: true,
      packageManager: "npm",
      packageName: "app",
      typeScriptDependencyVersion: "^5.0.0",
      usesTypeScript: true,
      workspaceTypeScriptVersion: "5.0.0",
    },
    php: null,
    rootPath: "/workspace",
  };
}

function phpProjectDescriptor(): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "laravel/laravel",
    packages: [
      {
        classmapRoots: [],
        dev: false,
        installPath: "../laravel/framework",
        name: "laravel/framework",
        packageType: "library",
        psr4Roots: [
          {
            dev: false,
            namespace: "Illuminate\\",
            paths: ["src/Illuminate/"],
          },
        ],
        version: "13.0.0",
      },
      {
        classmapRoots: [],
        dev: false,
        installPath: "../symfony/http-foundation",
        name: "symfony/http-foundation",
        packageType: "library",
        psr4Roots: [
          {
            dev: false,
            namespace: "Symfony\\Component\\HttpFoundation\\",
            paths: [""],
          },
        ],
        version: "8.0.0",
      },
    ],
    phpPlatformVersion: null,
    phpVersionConstraint: "^8.3",
    psr4Roots: [
      {
        dev: false,
        namespace: "App\\",
        paths: ["app/"],
      },
    ],
  };
}

function fileEntry(path: string, name: string): FileEntry {
  return {
    kind: "file",
    name,
    path,
  };
}

function gitChangedFile(relativePath: string, isStaged: boolean) {
  return {
    isStaged,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/workspace/${relativePath}`,
    relativePath,
    status: "modified" as const,
  };
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): LanguageServerRange {
  return {
    end: {
      character: endCharacter,
      line: endLine,
    },
    start: {
      character: startCharacter,
      line: startLine,
    },
  };
}

function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split(/\r?\n/);

  return {
    column: (lines[lines.length - 1] ?? "").length + 1,
    lineNumber: lines.length,
  };
}

function lineNumberOf(source: string, needle: string): number {
  return positionAfter(source, needle).lineNumber;
}
