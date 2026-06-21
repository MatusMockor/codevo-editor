// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import { emptyGitStatus, gitChangeKey, type GitGateway } from "../domain/git";
import { callHierarchyRows } from "../domain/callHierarchy";
import { typeHierarchyRows } from "../domain/typeHierarchy";
import {
  useWorkbenchController,
  type WorkbenchWorkspaceGateways,
} from "./useWorkbenchController";
import type {
  IndexProgressGateway,
  MetadataScanCompletionEvent,
} from "../domain/indexProgress";
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
  LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { PhpFileOutlineGateway } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import type {
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type SettingsGateway,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
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
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway;
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

  it("ignores inactive workspace runtime dispose errors after switching project tabs", async () => {
    const workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway = {
      disposeWorkspace: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          throw new Error("stale runtime dispose");
        }
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceRuntimeLifecycleGateway,
    });
    await flushAsyncTurns();
    vi.mocked(workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Runtime" &&
          notice.message.includes("stale runtime dispose"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP tools detection errors after switching project tabs", async () => {
    const workspaceATools = createDeferred<{
      intelephense: null;
      phpactor: null;
    }>();
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceATools.promise;
        }

        return {
          intelephense: null,
          phpactor: null,
        };
      }),
      installManagedPhpactor: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await vi.waitFor(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceATools.reject(new Error("stale PHP tools"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "PHP Tools" &&
          notice.message.includes("stale PHP tools"),
      ),
    ).toBe(false);
  });

  it("ignores stale workspace trust errors after switching project tabs", async () => {
    const workspaceATrust =
      createDeferred<Awaited<ReturnType<WorkspaceTrustGateway["getTrust"]>>>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceATrust.promise;
        }

        return {
          rootPath,
          trusted: true,
        };
      }),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceTrustGateway,
    });
    await vi.waitFor(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceATrust.reject(new Error("stale workspace trust"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Trust" &&
          notice.message.includes("stale workspace trust"),
      ),
    ).toBe(false);
  });

  it("ignores stale workspace trust toggle errors after switching project tabs", async () => {
    const workspaceATrustToggle =
      createDeferred<Awaited<ReturnType<WorkspaceTrustGateway["setTrust"]>>>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (rootPath === "/workspace-a") {
          return workspaceATrustToggle.promise;
        }

        return {
          rootPath,
          trusted,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceTrustGateway,
    });
    await flushAsyncTurns();

    let trustPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(workspaceTrustGateway.setTrust).toHaveBeenCalledWith(
        "/workspace-a",
        false,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      workspaceATrustToggle.reject(new Error("stale trust toggle"));
      await trustPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Trust" &&
          notice.message.includes("stale trust toggle"),
      ),
    ).toBe(false);
  });

  it("does not continue stale workspace trust toggles after stopping PHP runtime", async () => {
    const stopRuntime = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      stop: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return stopRuntime.promise;
        }

        return { kind: "stopped" as const, rootPath };
      }),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(
      dependencies.languageServerGateway.planPhpLanguageServer,
    ).mockClear();

    let trustPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      stopRuntime.resolve({ kind: "stopped", rootPath: "/workspace-a" });
      await trustPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      vi
        .mocked(dependencies.languageServerGateway.planPhpLanguageServer)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-a"),
    ).toBe(false);
  });

  it("ignores stale workspace detection errors after switching project tabs", async () => {
    const workspaceADetection =
      createDeferred<
        Awaited<
          ReturnType<WorkbenchWorkspaceGateways["detection"]["detectWorkspace"]>
        >
      >();
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceADetection.promise;
        }

        return {
          javaScriptTypeScript: null,
          php: null,
          rootPath,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDetectionGateway,
    });
    await vi.waitFor(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });

    await act(async () => {
      workspaceADetection.reject(new Error("stale workspace detection"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Detection" &&
          notice.message.includes("stale workspace detection"),
      ),
    ).toBe(false);
  });

  it("does not let stale workspace settings load overwrite the active project tab", async () => {
    const workspaceASettingsLoad = createDeferred<
      ReturnType<typeof defaultWorkspaceSettings>
    >();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) => {
        if (path === "/workspace-a") {
          return workspaceASettingsLoad.promise;
        }

        return defaultWorkspaceSettings();
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
    });
    await vi.waitFor(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASettingsLoad.reject(new Error("stale workspace settings load"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" &&
          notice.message.includes("stale workspace settings load"),
      ),
    ).toBe(false);
  });

  it("does not continue a pending workspace open after closing its project tab", async () => {
    const workspaceSettingsLoad = createDeferred<
      ReturnType<typeof defaultWorkspaceSettings>
    >();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
      workspaceTabs: ["/workspace"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) => {
        if (path === "/workspace") {
          return workspaceSettingsLoad.promise;
        }

        return defaultWorkspaceSettings();
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (path) => ({
        javaScriptTypeScript: null,
        php: null,
        rootPath: path,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
      workspaceDetectionGateway,
    });
    await vi.waitFor(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace",
      );
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);

    await act(async () => {
      workspaceSettingsLoad.resolve(defaultWorkspaceSettings());
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(workspaceDetectionGateway.detectWorkspace).not.toHaveBeenCalled();
  });

  it("ignores stale workspace-open settings persistence errors after switching project tabs", async () => {
    const workspaceASettingsSave = createDeferred<void>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async (nextSettings) => {
        if (nextSettings.recentWorkspacePath === "/workspace-a") {
          return workspaceASettingsSave.promise;
        }
      }),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
    });
    await vi.waitFor(() => {
      expect(settingsGateway.saveAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ recentWorkspacePath: "/workspace-a" }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASettingsSave.reject(
        new Error("stale workspace-open settings"),
      );
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" &&
          notice.message.includes("stale workspace-open settings"),
      ),
    ).toBe(false);
  });

  it("ignores stale directory load errors after switching project tabs", async () => {
    const workspaceADirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace-a") {
        return workspaceADirectory.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
    });
    await vi.waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-b");
    });
    expect(getWorkbench().loadingDirectories.has("/workspace-a")).toBe(false);

    await act(async () => {
      workspaceADirectory.reject(new Error("stale directory load"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace" &&
          notice.message.includes("stale directory load"),
      ),
    ).toBe(false);
  });

  it("does not continue stale workspace opens after directory load resolves", async () => {
    const workspaceADirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace-a") {
        return workspaceADirectory.promise;
      }

      return [];
    });
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
      workspaceTrustGateway,
    });
    await vi.waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });

    await act(async () => {
      workspaceADirectory.resolve([]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      vi
        .mocked(workspaceTrustGateway.getTrust)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-a"),
    ).toBe(false);
  });

  it("treats trailing-separator project tabs as the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "singleActive",
        workspaceTabs: ["/workspace-a/", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a/");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).not.toHaveBeenCalled();
    expect(dependencies.settingsGateway.saveAppSettings).not.toHaveBeenCalled();
  });

  it("closes the active normalized project tab through the current workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a/", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a/");
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).not.toHaveBeenCalledWith("/workspace-a/");
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
  });

  it("does not activate cached files from inactive project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    expect(getWorkbench().activePath).toBe(path);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    let opened = true;
    await act(async () => {
      opened = await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(path);
  });

  it("does not close text search for results from inactive project tabs", async () => {
    const stalePath = "/workspace-a/src/User.php";
    const readTextFile = vi.fn(
      async (requestedPath: string) => `<?php\n// ${requestedPath}\n`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    act(() => {
      getWorkbench().setTextSearchOpen(true);
    });

    await act(async () => {
      await getWorkbench().openTextSearchResult({
        column: 7,
        lineNumber: 3,
        lineText: "final class User {}",
        path: stalePath,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(stalePath);
    expect(getWorkbench().textSearchOpen).toBe(true);
    expect(getWorkbench().message).not.toBe("Opened src/User.php:3:7");
    expect(readTextFile).not.toHaveBeenCalledWith(stalePath);
  });

  it("does not close Quick Open for results from inactive project tabs", async () => {
    const stalePath = "/workspace-a/src/User.php";
    const readTextFile = vi.fn(
      async (requestedPath: string) => `<?php\n// ${requestedPath}\n`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    act(() => {
      getWorkbench().setQuickOpenOpen(true);
    });

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path: stalePath,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(stalePath);
    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(readTextFile).not.toHaveBeenCalledWith(stalePath);
  });

  it("ignores stale open file errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.readTextFile,
      ).toHaveBeenCalledWith(path);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      openFile.reject(new Error("stale open"));
      await openPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Open File" &&
          notice.message.includes("stale open"),
      ),
    ).toBe(false);
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

  it("does not let a stale JavaScript and TypeScript plan overwrite the active project tab", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan = readyJavaScriptTypeScriptPlan("/workspace-b");
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    vi.mocked(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).mockImplementation(async (rootPath) =>
      rootPath === "/workspace-a"
        ? workspaceAPlan.promise
        : readyJavaScriptTypeScriptPlan(rootPath),
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(
      workspaceBPlan,
    );

    workspaceAPlan.resolve(readyJavaScriptTypeScriptPlan("/workspace-a"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(
      workspaceBPlan,
    );
  });

  it("caches stopped JavaScript and TypeScript status when suspending an inactive project runtime", async () => {
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const runningWorkspaceAStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-a/",
      sessionId: 44,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningWorkspaceAStatus),
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
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningWorkspaceAStatus);
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(expect.objectContaining({ kind: "running", rootPath: "/workspace-a/" }));

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }));
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
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).mockClear();

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
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
      ).mock.invocationCallOrder[0],
    );
  });

  it("restores cached JavaScript and TypeScript diagnostics when switching project tabs", async () => {
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

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });

  it("caches JavaScript and TypeScript diagnostics for background project tabs", async () => {
    let publishDiagnostics:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
      {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishDiagnostics = listener;
          return () => undefined;
        }),
      };
    const runningStatus = (
      rootPath: string,
      sessionId: number,
    ): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 301)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) => runningStatus(rootPath, 303)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const workspaceAPath = "/workspace-a/src/App.ts";
    const workspaceBPath = "/workspace-b/src/App.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 302));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Workspace B type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 302,
        uri: fileUriFromPath(workspaceBPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceAPath],
    ).toBeUndefined();
    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceBPath],
    ).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceBPath],
    ).toHaveLength(1);
  });

  it("ignores PHP diagnostics without an explicit workspace root", async () => {
    let publishDiagnostics:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 61,
    };
    const path = "/workspace/app/Models/User.php";
    const uri = fileUriFromPath(path);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Rootless PHP diagnostic should be ignored.",
            severity: "error",
            source: "phpactor",
          },
        ],
        sessionId: 61,
        uri,
        version: null,
      } as any);
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "phpactor" &&
          notice.message.includes("Rootless PHP diagnostic"),
      ),
    ).toBe(false);
  });

  it("does not sync JavaScript and TypeScript documents with a runtime from another project tab", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const runningWorkspaceAStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 201,
    };
    const runningWorkspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 202,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => ({ kind: "stopped" as const })),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningWorkspaceBStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const workspaceBPath = "/workspace-b/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".ts") ? "export const value = 1;\n" : "",
      ),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishStatus?.(runningWorkspaceAStatus);
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceBPath, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).not.toHaveBeenCalledWith(
      "/workspace-b",
      expect.objectContaining({ path: workspaceBPath }),
    );

    act(() => {
      publishStatus?.(runningWorkspaceBStatus);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace-b",
      expect.objectContaining({ path: workspaceBPath }),
    );
  });

  it("ignores JavaScript and TypeScript runtime status events without an explicit workspace root", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const path = "/workspace/src/App.ts";
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 211,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => rootedRunningStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).not.toHaveBeenCalled();

    act(() => {
      publishStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 210,
      } as any);
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).not.toHaveBeenCalled();

    act(() => {
      publishStatus?.(rootedRunningStatus);
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 211,
      }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
    );
  });

  it("ignores PHP runtime status events without an explicit workspace root", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const path = "/workspace/src/App.php";
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 212,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async () => "<?php\n$value = 1;\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.php"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).not.toHaveBeenCalled();

    act(() => {
      publishStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 211,
      } as any);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
    expect(dependencies.documentSyncGateway.didOpen).not.toHaveBeenCalled();

    act(() => {
      publishStatus?.(rootedRunningStatus);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 212,
      }),
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
    );
  });

  it("ignores JavaScript and TypeScript runtime status events after the last project tab closes", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => null),
        start: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toBeNull();

    act(() => {
      publishStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/workspace",
        sessionId: 221,
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toBeNull();
  });

  it("ignores PHP runtime status events after the last project tab closes", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().languageServerRuntimeStatus).toBeNull();

    act(() => {
      publishStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/workspace",
        sessionId: 222,
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().languageServerRuntimeStatus).toBeNull();
  });

  it("ignores stale PHP runtime subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 231,
      })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi
        .fn()
        .mockImplementationOnce(async () => subscription.promise)
        .mockImplementation(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale php runtime subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "Error: stale php runtime subscription",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale php runtime subscription"),
      ),
    ).toBe(false);
  });

  it("reports the same PHP runtime crash once per project tab", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 231,
      })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishStatus?.({
        kind: "crashed",
        message: "phpactor crashed",
        rootPath: "/workspace-a",
      });
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("phpactor crashed"),
      ),
    ).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("phpactor crashed"),
      ),
    ).toBe(false);

    act(() => {
      publishStatus?.({
        kind: "crashed",
        message: "phpactor crashed",
        rootPath: "/workspace-b",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("phpactor crashed"),
      ),
    ).toBe(true);
  });

  it("ignores stale JavaScript and TypeScript runtime subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => null),
        start: vi.fn(async (rootPath) => ({
          capabilities: emptyLanguageServerCapabilities(),
          kind: "running" as const,
          rootPath,
          sessionId: 232,
        })),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi
          .fn()
          .mockImplementationOnce(async () => subscription.promise)
          .mockImplementation(async () => () => undefined),
      };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale js runtime subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "Error: stale js runtime subscription",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale js runtime subscription"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP diagnostic subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi
        .fn()
        .mockImplementationOnce(async () => subscription.promise)
        .mockImplementation(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale php diagnostics subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "Error: stale php diagnostics subscription",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale php diagnostics subscription"),
      ),
    ).toBe(false);
  });

  it("ignores stale JavaScript and TypeScript diagnostic subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
      {
        subscribeDiagnostics: vi
          .fn()
          .mockImplementationOnce(async () => subscription.promise)
          .mockImplementation(async () => () => undefined),
      };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale js diagnostics subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "Error: stale js diagnostics subscription",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale js diagnostics subscription"),
      ),
    ).toBe(false);
  });

  it("keeps JavaScript TypeScript document sync state after stale same-root did-open failure", async () => {
    const path = "/workspace/src/App.ts";
    const didOpenAttempts: Deferred<void>[] = [];
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(301)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(301)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(301),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(301),
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).mockImplementation(() => {
      const didOpen = createDeferred<void>();
      didOpenAttempts.push(didOpen);
      return didOpen.promise;
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await vi.waitFor(() => {
      expect(didOpenAttempts).toHaveLength(1);
    });

    act(() => {
      publishStatus?.(runningStatus(302));
    });
    await vi.waitFor(() => {
      expect(didOpenAttempts).toHaveLength(2);
    });

    didOpenAttempts[1]?.resolve(undefined);
    await flushAsyncTurns();
    didOpenAttempts[0]?.reject(new Error("stale did open"));
    await flushAsyncTurns(24);
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
        .didChange,
    ).mockClear();

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
        .didChange,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "export const value = 2;\n",
      }),
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale did open"),
      ),
    ).toBe(false);
  });

  it("ignores stale JavaScript TypeScript did-change errors after same-root session restart", async () => {
    const path = "/workspace/src/App.ts";
    const didChange = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(311)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(311)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(311),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(311),
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
        .didChange,
    ).mockImplementationOnce(() => didChange.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    await vi.waitFor(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
          .didChange,
      ).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "export const value = 2;\n",
        }),
      );
    });

    act(() => {
      publishStatus?.(runningStatus(312));
    });
    await flushAsyncTurns();

    didChange.reject(new Error("stale did change"));
    await flushAsyncTurns(24);

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale did change"),
      ),
    ).toBe(false);
  });

  it("ignores stale JavaScript TypeScript did-save errors after same-root session restart", async () => {
    const path = "/workspace/src/App.ts";
    const didSave = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(321)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(321)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(321),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(321),
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didSave,
    ).mockImplementationOnce(() => didSave.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
          .didSave,
      ).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "export const value = 1;\n",
        }),
      );
    });

    act(() => {
      publishStatus?.(runningStatus(322));
    });
    await flushAsyncTurns();

    await act(async () => {
      didSave.reject(new Error("stale did save"));
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBe("Saved App.ts");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale did save"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP did-save errors after same-root session restart", async () => {
    const path = "/workspace/src/User.php";
    const didSave = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(341)),
      openLog: vi.fn(async () => "/tmp/phpactor.log"),
      start: vi.fn(async () => runningStatus(341)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async () => "<?php\nfinal class User {}\n"),
      runtimeStatus: runningStatus(341),
    });
    vi.mocked(dependencies.documentSyncGateway.didSave).mockImplementationOnce(
      () => didSave.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.documentSyncGateway.didSave).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "<?php\nfinal class User {}\n",
        }),
      );
    });

    act(() => {
      publishStatus?.(runningStatus(342));
    });
    await flushAsyncTurns();

    await act(async () => {
      didSave.reject(new Error("stale php did save"));
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBe("Saved User.php");
    expect(
      getWorkbench().notices.some((notice) =>
        notice.message.includes("stale php did save"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP did-close errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const didClose = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 351,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async () => "<?php\nfinal class User {}\n"),
      runtimeStatus: runningStatus,
    });
    vi.mocked(dependencies.documentSyncGateway.didClose).mockImplementationOnce(
      () => didClose.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await vi.waitFor(() => {
      expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
        "/workspace-a",
        path,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      didClose.reject(new Error("stale php did close"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale php did close");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale php did close"),
      ),
    ).toBe(false);
  });

  it("ignores stale save errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const save = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    vi.mocked(
      dependencies.workspaceGateways.files.writeTextFile,
    ).mockImplementationOnce(async () => save.promise);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.writeTextFile,
      ).toHaveBeenCalledWith(path, "<?php\nfinal class User {}\n");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      save.reject(new Error("stale save"));
      await savePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Save File" &&
          notice.message.includes("stale save"),
      ),
    ).toBe(false);
  });

  it("ignores stale save completions after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const save = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    vi.mocked(
      dependencies.workspaceGateways.files.writeTextFile,
    ).mockImplementationOnce(async () => save.promise);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.writeTextFile,
      ).toHaveBeenCalledWith(path, "<?php\nfinal class User {}\n");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      save.resolve(undefined);
      await savePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Saved User.php");
  });

  it("does not send PHP didSave after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 59,
    };
    const path = "/workspace-a/src/User.php";
    const didOpen = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".php") ? "<?php\nfinal class User {}\n" : "",
      ),
      runtimeStatus: runningStatus,
    });
    const syncGateway = dependencies.documentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class UserProfile {}\n");
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await Promise.all([savePromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
    expect(syncGateway.didSave).not.toHaveBeenCalled();
  });

  it("does not send JavaScript TypeScript didSave after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 60,
    };
    const path = "/workspace-a/src/App.ts";
    const didOpen = createDeferred<void>();
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway =
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.save",
    );
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await Promise.all([savePromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
    expect(syncGateway.didSave).not.toHaveBeenCalled();
  });

  it("ignores stale JavaScript TypeScript did-close errors after same-root session restart", async () => {
    const path = "/workspace/src/App.ts";
    const didClose = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(331)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(331)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(331),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(331),
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).mockImplementationOnce(() => didClose.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await vi.waitFor(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
          .didClose,
      ).toHaveBeenCalledWith("/workspace", path);
    });

    act(() => {
      publishStatus?.(runningStatus(332));
    });
    await flushAsyncTurns();

    didClose.reject(new Error("stale did close"));
    await flushAsyncTurns(24);

    expect(getWorkbench().activePath).toBe(null);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale did close"),
      ),
    ).toBe(false);
  });

  it("shows JavaScript and TypeScript diagnostics in Problems and opens the diagnostic range", async () => {
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
      sessionId: 52,
    };
    const path = "/workspace/src/App.ts";
    const uri = fileUriFromPath(path);
    const readTextFile = vi.fn(async (requestedPath: string) =>
      requestedPath === path ? "const count: string = 1;\n" : "",
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 6,
            endCharacter: 11,
            endLine: 0,
            line: 0,
            message: "Type 'number' is not assignable to type 'string'.",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace",
        sessionId: 52,
        uri,
        version: null,
      });
    });
    await flushAsyncTurns();

    const notice = getWorkbench().notices.find(
      (candidate) => candidate.source === "tsserver",
    );
    expect(notice).toEqual(
      expect.objectContaining({
        message: `${uri} 1:7 Type 'number' is not assignable to type 'string'.`,
        navigationTarget: {
          path,
          range: {
            end: { column: 12, lineNumber: 1 },
            start: { column: 7, lineNumber: 1 },
          },
        },
        severity: "error",
        source: "tsserver",
      }),
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().openProblemNotice(notice!);
    });

    expect(readTextFile).toHaveBeenCalledWith(path);
    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path,
      position: { column: 7, lineNumber: 1 },
    });
  });

  it("ignores JavaScript and TypeScript diagnostics without an explicit workspace root", async () => {
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
      rootPath: "/workspace",
      sessionId: 52,
    };
    const path = "/workspace/src/App.ts";
    const uri = fileUriFromPath(path);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "const count: string = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 6,
            endCharacter: 11,
            endLine: 0,
            line: 0,
            message: "Rootless diagnostic should be ignored.",
            severity: "error",
            source: "tsserver",
          },
        ],
        sessionId: 52,
        uri,
        version: null,
      } as any);
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "tsserver" &&
          notice.message.includes("Rootless diagnostic"),
      ),
    ).toBe(false);
  });

  it("clears only the closed project's JavaScript and TypeScript runtime state", async () => {
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
    const runningStatus = (
      rootPath: string,
      sessionId: number,
    ): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) =>
          rootPath === "/workspace-b"
            ? runningStatus(rootPath, 202)
            : runningStatus(rootPath, 101),
        ),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) => runningStatus(rootPath, 303)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };
    const workspaceAPath = "/workspace-a/src/App.ts";
    const workspaceBPath = "/workspace-b/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".ts") ? "export const value = 1;\n" : "",
      ),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceAPath, "App.ts"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Workspace A type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 101,
        uri: fileUriFromPath(workspaceAPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceAPath],
    ).toHaveLength(1);

    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway
        .didChange,
    ).mockClear();

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).not.toHaveBeenCalledWith("/workspace-b");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace-a", workspaceAPath);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).not.toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path: workspaceAPath }),
    );
    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceAPath],
    ).toBeUndefined();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceBPath, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace-b",
      expect.objectContaining({ path: workspaceBPath }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).not.toHaveBeenCalledWith("/workspace-b", workspaceBPath);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Stale workspace A diagnostic",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 101,
        uri: fileUriFromPath(workspaceAPath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Workspace B type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 202,
        uri: fileUriFromPath(workspaceBPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceAPath],
    ).toBeUndefined();
    expect(
      getWorkbench().languageServerDiagnosticsByPath[workspaceBPath],
    ).toHaveLength(1);
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

  it("waits for JavaScript and TypeScript didOpen before first-use document flushes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 53,
    };
    const path = "/workspace/src/App.ts";
    const didOpen = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? "export const value = 1;\n" : "",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway =
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    let initialFlushResolved = false;
    const initialFlushPromise =
      getWorkbench()
        .flushPendingJavaScriptTypeScriptLanguageServerDocument(path)
        .then(() => {
          initialFlushResolved = true;
        });
    await flushAsyncTurns(4);

    expect(syncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "export const value = 1;\n",
      }),
    );
    expect(initialFlushResolved).toBe(false);

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns(4);

    let changeFlushResolved = false;
    const changeFlushPromise =
      getWorkbench()
        .flushPendingJavaScriptTypeScriptLanguageServerDocument(path)
        .then(() => {
          changeFlushResolved = true;
        });
    await flushAsyncTurns(4);

    expect(changeFlushResolved).toBe(false);
    expect(syncGateway.didChange).not.toHaveBeenCalled();

    await act(async () => {
      didOpen.resolve(undefined);
      await Promise.all([initialFlushPromise, changeFlushPromise]);
    });

    expect(initialFlushResolved).toBe(true);
    expect(changeFlushResolved).toBe(true);
    expect(syncGateway.didChange).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "export const value = 2;\n",
      }),
    );
    expect(
      vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(syncGateway.didChange).mock.invocationCallOrder[0],
    );
  });

  it("waits for PHP didOpen before first-use document flushes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 54,
    };
    const path = "/workspace/src/CommentController.php";
    const didOpen = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus,
    });
    const syncGateway = dependencies.documentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await flushAsyncTurns(24);

    let initialFlushResolved = false;
    const initialFlushPromise = getWorkbench()
      .flushPendingLanguageServerDocument(path)
      .then(() => {
        initialFlushResolved = true;
      });
    await flushAsyncTurns(4);

    expect(syncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "<?php\n$comment->load();\n",
      }),
    );
    expect(initialFlushResolved).toBe(false);

    act(() => {
      getWorkbench().updateActiveDocument("<?php\n$comment->forceDelete();\n");
    });
    await flushAsyncTurns(4);

    let changeFlushResolved = false;
    const changeFlushPromise = getWorkbench()
      .flushPendingLanguageServerDocument(path)
      .then(() => {
        changeFlushResolved = true;
      });
    await flushAsyncTurns(4);

    expect(changeFlushResolved).toBe(false);
    expect(syncGateway.didChange).not.toHaveBeenCalled();

    await act(async () => {
      didOpen.resolve(undefined);
      await Promise.all([initialFlushPromise, changeFlushPromise]);
    });

    expect(initialFlushResolved).toBe(true);
    expect(changeFlushResolved).toBe(true);
    expect(syncGateway.didChange).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "<?php\n$comment->forceDelete();\n",
      }),
    );
    expect(
      vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(syncGateway.didChange).mock.invocationCallOrder[0],
    );
  });

  it("does not flush queued PHP edits after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 56,
    };
    const path = "/workspace-a/app/Http/Controllers/CommentController.php";
    const didOpen = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".php") ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(
        fileEntry(path, "CommentController.php"),
      );
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\n$comment->forceDelete();\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(syncGateway.didChange).not.toHaveBeenCalled();

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await switchPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
  });

  it("does not flush first-use PHP edits after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 57,
    };
    const path = "/workspace-a/app/Http/Controllers/CommentController.php";
    const didOpen = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".php") ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(
        fileEntry(path, "CommentController.php"),
      );
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\n$comment->forceDelete();\n");
    });
    await flushAsyncTurns(4);

    let flushPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      flushPromise = getWorkbench().flushPendingLanguageServerDocument(path);
    });

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await Promise.all([flushPromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
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

  it("does not flush queued JavaScript and TypeScript edits after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 55,
    };
    const path = "/workspace-a/src/App.ts";
    const didOpen = createDeferred<void>();
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway =
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(syncGateway.didChange).not.toHaveBeenCalled();

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await switchPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
  });

  it("does not flush first-use JavaScript and TypeScript edits after switching project tabs while didOpen is pending", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 58,
    };
    const path = "/workspace-a/src/App.ts";
    const didOpen = createDeferred<void>();
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway =
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(
      async () => didOpen.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await vi.waitFor(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns(4);

    let flushPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      flushPromise =
        getWorkbench().flushPendingJavaScriptTypeScriptLanguageServerDocument(
          path,
        );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      didOpen.resolve(undefined);
    });
    await act(async () => {
      await Promise.all([flushPromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didChange).not.toHaveBeenCalled();
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

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-a");
  });

  it("falls back to explicit per-runtime stops when workspace runtime disposal fails", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockRejectedValueOnce(new Error("dispose failed"));

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
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

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-c",
    );
  });

  it("stops every inactive project runtime when single-active policy is saved", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "keepAlive",
        workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          runtimePolicy: "singleActive",
          workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
        },
        defaultWorkspaceSettings(),
        null,
      );
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-a");
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
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      }),
    );
  });

  it("falls back to explicit runtime stops when inactive project disposal fails", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockRejectedValueOnce(new Error("dispose failed"));

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-b");
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-b");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a"]);
  });

  it("does not dispose an inactive PHP project runtime before closing synced documents", async () => {
    const path = "/workspace-a/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".php") ? "<?php\nfinal class User {}\n" : "",
      ),
      runtimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 55,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
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
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
    );
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
      ).mock.invocationCallOrder[0],
    );
  });

  it("does not restore stale JavaScript and TypeScript runtime status from a closed project tab", async () => {
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const workspaceBStatus = createDeferred<LanguageServerRuntimeStatus>();
    const stoppedStatus = (rootPath: string): LanguageServerRuntimeStatus => ({
      kind: "stopped",
      rootPath,
    });
    const runningWorkspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 67,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn((rootPath) =>
          rootPath === "/workspace-b"
            ? workspaceBStatus.promise
            : Promise.resolve(stoppedStatus(rootPath)),
        ),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) => stoppedStatus(rootPath)),
        stop: vi.fn(async (rootPath) => stoppedStatus(rootPath)),
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

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      publishRuntimeStatus?.(runningWorkspaceBStatus);
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toBeNull();

    workspaceBStatus.resolve(stoppedStatus("/workspace-b"));
    await flushAsyncTurns(24);

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-b" }),
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
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-b"],
      }),
    );
  });

  it("falls back to explicit runtime stops when active project disposal fails", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockRejectedValueOnce(new Error("dispose failed"));

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
  });

  it("clears the workbench and stops runtime when the last project tab closes", async () => {
    let publishMetadataScanCompletion:
      | ((event: MetadataScanCompletionEvent) => void)
      | null = null;
    const indexProgressGateway: IndexProgressGateway = {
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
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        publishMetadataScanCompletion = listener;
        return () => undefined;
      }),
    };
    const runningPhpStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const phpTree: Awaited<ReturnType<PhpTreeGateway["getPhpTree"]>> = {
      nodes: [
        {
            children: [],
            column: 7,
            fullyQualifiedName: "App\\Services\\UserService",
            id: "class:App\\Services\\UserService",
            kind: "class",
            label: "UserService",
            lineNumber: 5,
            path: "/workspace/app/Services/UserService.php",
            relativePath: "app/Services/UserService.php",
          },
        ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
        javaScriptTypeScriptValidation: false,
        statusBar: {
          ...defaultWorkspaceSettings().statusBar,
          message: false,
        },
      },
      indexProgressGateway,
      runtimeStatus: runningPhpStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.phpTreeGateway.getPhpTree).mockResolvedValueOnce(
      phpTree,
    );
    await vi.waitFor(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace");
    });
    await act(async () => {
      await getWorkbench().refreshPhpTree();
    });

    expect(dependencies.phpTreeGateway.getPhpTree).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().phpTree.nodes).toHaveLength(1);
    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("User");
      getWorkbench().setClassOpenOpen(true);
      getWorkbench().setClassOpenQuery("Service");
      getWorkbench().setTextSearchOpen(true);
      getWorkbench().setTextSearchQuery("needle");
      getWorkbench().showBottomPanelView("terminal");
      getWorkbench().setFileStructureOpen(true);
      getWorkbench().setFileStructureScopeMode("inherited");
    });
    await act(async () => {
      await getWorkbench().openPhpFileOutlineNode({
        children: [],
        column: 7,
        fullyQualifiedName: "App\\Services\\UserService",
        id: "class:App\\Services\\UserService",
        kind: "class",
        label: "UserService",
        lineNumber: 5,
        path: "/workspace/app/Services/UserService.php",
        relativePath: "app/Services/UserService.php",
      });
    });

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: "/workspace/app/Services/UserService.php",
      position: {
        column: 7,
        lineNumber: 5,
      },
    });
    act(() => {
      getWorkbench().reportCommandError(new Error("workspace a transient"));
    });

    expect(getWorkbench().message).toBe("Error: workspace a transient");
    expect(
      getWorkbench().notices.some((notice) =>
        notice.message.includes("workspace a transient"),
      ),
    ).toBe(true);
    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureScope).toBe("inherited");
    act(() => {
      publishMetadataScanCompletion?.({
        databasePath: "/tmp/index.sqlite",
        message: null,
        report: {
          changedFiles: 0,
          errorDetails: [],
          erroredEntries: 0,
          indexedFiles: 1,
          parsedFiles: 1,
          removedFiles: 0,
          skippedDetails: [],
          skippedEntries: 0,
          symbolsIndexed: 1,
        },
        rootPath: "/workspace",
        status: "completed",
      });
    });
    await flushAsyncTurns();
    await vi.waitFor(() => {
      expect(getWorkbench().phpIdeReadinessVersion).toBeGreaterThan(0);
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(getWorkbench().workspaceSettings.intelligenceMode).toBe("basic");
    expect(getWorkbench().workspaceSettings.javaScriptTypeScriptValidation).toBe(
      true,
    );
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(true);
    expect(getWorkbench().phpIdeReadinessVersion).toBe(0);
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().notices).toEqual([]);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().bottomPanelVisible).toBe(false);
    expect(getWorkbench().bottomPanelView).toBe("problems");
    expect(getWorkbench().phpTree.nodes).toEqual([]);
    expect(getWorkbench().phpTreeLoading).toBe(false);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().quickOpenQuery).toBe("");
    expect(getWorkbench().quickOpenLoading).toBe(false);
    expect(getWorkbench().classOpenOpen).toBe(false);
    expect(getWorkbench().classOpenQuery).toBe("");
    expect(getWorkbench().classOpenLoading).toBe(false);
    expect(getWorkbench().textSearchOpen).toBe(false);
    expect(getWorkbench().textSearchQuery).toBe("");
    expect(getWorkbench().textSearchLoading).toBe(false);
    expect(getWorkbench().fileStructureOpen).toBe(false);
    expect(getWorkbench().fileStructureScope).toBe("current");
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: null,
        workspaceTabs: [],
      }),
    );
  });

  it("clears language server diagnostics when the last project tab closes", async () => {
    let publishPhpDiagnostics:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    let publishJavaScriptTypeScriptDiagnostics:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishPhpDiagnostics = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
      {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishJavaScriptTypeScriptDiagnostics = listener;
          return () => undefined;
        }),
      };
    const phpStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const javaScriptTypeScriptStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 72,
    };
    const phpPath = "/workspace/app/Models/User.php";
    const typeScriptPath = "/workspace/resources/js/app.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: javaScriptTypeScriptStatus,
      languageServerDiagnosticsGateway,
      runtimeStatus: phpStatus,
      workspaceDescriptor: {
        ...phpWorkspaceDescriptor(),
        javaScriptTypeScript:
          javaScriptTypeScriptWorkspaceDescriptor().javaScriptTypeScript,
      },
    });
    await flushAsyncTurns(24);

    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "PHP diagnostic",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(phpPath),
        version: null,
      });
      publishJavaScriptTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 1,
            line: 1,
            message: "TypeScript diagnostic",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace",
        sessionId: 72,
        uri: fileUriFromPath(typeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[phpPath]).toHaveLength(
      1,
    );
    expect(
      getWorkbench().languageServerDiagnosticsByPath[typeScriptPath],
    ).toHaveLength(1);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().languageServerDiagnosticsByPath).toEqual({});
  });

  it("falls back to explicit runtime stops when last project disposal fails", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockRejectedValueOnce(new Error("dispose failed"));

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith("/workspace");
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

  it("refreshes the PHP tree for index progress roots that only differ by a trailing slash", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      getWorkbench().setSidebarView("php");
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.phpTreeGateway.getPhpTree).mockClear();
    vi.mocked(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/workspace/",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns();

    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
    expect(dependencies.phpTreeGateway.getPhpTree).toHaveBeenCalledWith(
      "/workspace",
    );
  });

  it("ignores index start responses that belong to another workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/other",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns();

    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: null,
        status: "idle",
      }),
    );
    expect(getWorkbench().message).not.toBe("Indexing workspace.");
  });

  it("ignores reindex start responses that belong to another workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: "/workspace",
        status: "scanning",
      }),
    );
    vi.mocked(dependencies.indexProgressGateway.startReindex).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/other",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().startIndexScan();
    });
    await flushAsyncTurns();

    expect(dependencies.indexProgressGateway.startReindex).toHaveBeenCalledWith(
      "/workspace",
      "soft",
      undefined,
    );
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: "/workspace",
        status: "scanning",
      }),
    );
    expect(getWorkbench().message).not.toBe("Soft reindex started.");
  });

  it("ignores stale smart mode completions after switching project tabs", async () => {
    const smartModeUpdate =
      createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.smartModeGateway.setMode).mockImplementationOnce(
      async () => smartModeUpdate.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("fullSmart");
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "fullSmart",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      smartModeUpdate.resolve({
        message: "Workspace A mode ready",
        mode: "fullSmart",
        status: "ready",
      });
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().workspaceSettings.intelligenceMode).toBe("basic");
    expect(getWorkbench().message).not.toBe("Workspace A mode ready");
  });

  it("ignores stale smart mode errors after switching project tabs", async () => {
    const smartModeUpdate =
      createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.smartModeGateway.setMode).mockImplementationOnce(
      async () => smartModeUpdate.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("fullSmart");
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "fullSmart",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      smartModeUpdate.reject(new Error("stale smart mode"));
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "IDE Mode" &&
          notice.message.includes("stale smart mode"),
      ),
    ).toBe(false);
  });

  it("ignores stale workspace-open smart mode errors after switching project tabs", async () => {
    const workspaceASmartMode =
      createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    let setModeCalls = 0;
    const smartModeGateway: SmartModeGateway = {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (mode) => {
        setModeCalls += 1;

        if (setModeCalls === 1) {
          return workspaceASmartMode.promise;
        }

        return {
          message: "Updated",
          mode,
          status: "ready" as const,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      smartModeGateway,
    });
    await vi.waitFor(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledWith("basic");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledTimes(2);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASmartMode.reject(new Error("stale workspace-open smart mode"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "IDE Mode" &&
          notice.message.includes("stale workspace-open smart mode"),
      ),
    ).toBe(false);
  });

  it("ignores index clear errors after switching project tabs", async () => {
    const indexClear =
      createDeferred<
        Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>
      >();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.indexProgressGateway.clearWorkspaceIndex,
    ).mockImplementationOnce(async () => indexClear.promise);

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.indexProgressGateway.clearWorkspaceIndex,
      ).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.reject(new Error("stale clear"));
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Index" && notice.message.includes("stale clear"),
      ),
    ).toBe(false);
  });

  it("ignores index clear success messages after switching project tabs", async () => {
    const indexClear =
      createDeferred<
        Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>
      >();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    vi.mocked(
      dependencies.indexProgressGateway.clearWorkspaceIndex,
    ).mockImplementationOnce(async () => indexClear.promise);

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.indexProgressGateway.clearWorkspaceIndex,
      ).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.resolve({
        databasePath: "/tmp/index.sqlite",
        rootPath: "/workspace-a",
        status: "cleared",
      });
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Updated");
  });

  it("ignores metadata scan clear errors after switching project tabs", async () => {
    let publishMetadataScanCompletion:
      | ((event: MetadataScanCompletionEvent) => void)
      | null = null;
    const indexClear =
      createDeferred<
        Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>
      >();
    const indexProgressGateway: IndexProgressGateway = {
      clearWorkspaceIndex: vi.fn(async () => indexClear.promise),
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
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        publishMetadataScanCompletion = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    act(() => {
      publishMetadataScanCompletion?.({
        databasePath: "/tmp/index.sqlite",
        message: null,
        report: null,
        rootPath: "/workspace-a",
        status: "completed",
      });
    });
    await vi.waitFor(() => {
      expect(indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.reject(new Error("stale metadata clear"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Index" &&
          notice.message.includes("stale metadata clear"),
      ),
    ).toBe(false);
  });

  it("ignores stale metadata scan subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const indexProgressGateway: IndexProgressGateway = {
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
      subscribeMetadataScanCompletion: vi
        .fn()
        .mockImplementationOnce(async () => subscription.promise)
        .mockImplementation(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale metadata subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "Error: stale metadata subscription",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Index" &&
          notice.message.includes("stale metadata subscription"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP language server plan results after switching project tabs", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan: LanguageServerPlan = {
      ...phpactorLanguageServerPlan(),
      message: "PHPactor B ready",
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAPlan.promise;
        }

        return workspaceBPlan;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });

    await act(async () => {
      workspaceAPlan.resolve({
        ...phpactorLanguageServerPlan(),
        message: "PHPactor A ready",
      });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().languageServerPlan?.message).toBe(
      "PHPactor B ready",
    );
  });

  it("ignores stale PHP language server plan errors after switching project tabs", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan: LanguageServerPlan = {
      ...phpactorLanguageServerPlan(),
      message: "PHPactor B ready",
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAPlan.promise;
        }

        return workspaceBPlan;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });

    await act(async () => {
      workspaceAPlan.reject(new Error("stale PHP plan"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().languageServerPlan?.message).toBe(
      "PHPactor B ready",
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale PHP plan"),
      ),
    ).toBe(false);
  });

  it("ignores managed PHPactor install completion after switching project tabs", async () => {
    const installPlanRefresh = createDeferred<LanguageServerPlan>();
    const workspaceBPlan: LanguageServerPlan = {
      ...phpactorLanguageServerPlan(),
      message: "PHPactor B ready",
    };
    let workspaceAPlanRequests = 0;
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          workspaceAPlanRequests += 1;

          if (workspaceAPlanRequests === 1) {
            return {
              ...phpactorLanguageServerPlan(),
              message: "PHPactor A initial",
            };
          }

          return installPlanRefresh.promise;
        }

        return workspaceBPlan;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });
    await flushAsyncTurns();

    let installPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      installPromise = getWorkbench().installManagedPhpactor();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        vi
          .mocked(languageServerGateway.planPhpLanguageServer)
          .mock.calls.filter(([rootPath]) => rootPath === "/workspace-a"),
      ).toHaveLength(2);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      installPlanRefresh.resolve({
        ...phpactorLanguageServerPlan(),
        message: "PHPactor A installed",
      });
      await installPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Installed managed PHP IDE engine.");
    expect(getWorkbench().languageServerPlan?.message).toBe(
      "PHPactor B ready",
    );
  });

  it("ignores managed PHPactor install errors after switching project tabs", async () => {
    const installManagedPhpactor = createDeferred<void>();
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => installManagedPhpactor.promise),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    let installPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      installPromise = getWorkbench().installManagedPhpactor();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(phpToolGateway.installManagedPhpactor).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      installManagedPhpactor.reject(new Error("stale managed install"));
      await installPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale managed install"),
      ),
    ).toBe(false);
  });

  it("clears managed PHPactor install loading when the last project tab closes", async () => {
    const installManagedPhpactor = createDeferred<void>();
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => installManagedPhpactor.promise),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    let installPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      installPromise = getWorkbench().installManagedPhpactor();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(phpToolGateway.installManagedPhpactor).toHaveBeenCalledOnce();
      expect(getWorkbench().installingManagedPhpactor).toBe(true);
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      installManagedPhpactor.resolve();
      await installPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);
  });

  it("ignores manual PHP language server start errors after switching project tabs", async () => {
    const languageServerStart = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => languageServerStart.promise),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    let startPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      startPromise = getWorkbench().startLanguageServer();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      languageServerStart.reject(new Error("stale PHP start"));
      await startPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale PHP start"),
      ),
    ).toBe(false);
  });

  it("ignores manual PHP language server stop errors after switching project tabs", async () => {
    const languageServerStop = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 42,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 42,
      })),
      stop: vi.fn(async () => languageServerStop.promise),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
    });
    await flushAsyncTurns();

    let stopPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      stopPromise = getWorkbench().stopLanguageServer();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      languageServerStop.reject(new Error("stale PHP stop"));
      await stopPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale PHP stop"),
      ),
    ).toBe(false);
  });

  it("ignores stale PHP language server status errors after switching project tabs", async () => {
    const workspaceAStatus = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAStatus.promise;
        }

        return {
          kind: "stopped" as const,
          rootPath,
        };
      }),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 43,
      })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
    });
    await vi.waitFor(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await vi.waitFor(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith(
        "/workspace-b",
      );
    });

    await act(async () => {
      workspaceAStatus.reject(new Error("stale PHP status"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale PHP status"),
      ),
    ).toBe(false);
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

  it("retries restored PHP IDE service autostart when startup rejects once", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 89,
    };
    const start = vi.fn<LanguageServerRuntimeGateway["start"]>(
      async () => runningStatus,
    );
    start.mockRejectedValueOnce(new Error("PHPactor boot race"));
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(
      2,
    );
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 89,
      }),
    );
  });

  it("ignores stale PHP IDE service autostart errors after switching project tabs", async () => {
    const workspaceAStart = createDeferred<LanguageServerRuntimeStatus>();
    const workspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 91,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) =>
        rootPath === "/workspace-a" ? workspaceAStart.promise : workspaceBStatus,
      ),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await vi.waitFor(() => {
      expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    act(() => {
      workspaceAStart.reject(new Error("stale PHP autostart"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale PHP autostart");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale PHP autostart"),
      ),
    ).toBe(false);
  });

  it("retries restored PHP IDE service autostart when startup crashes once", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 90,
    };
    const start = vi
      .fn<LanguageServerRuntimeGateway["start"]>(async () => runningStatus)
      .mockResolvedValueOnce({
        kind: "crashed" as const,
        message: "PHPactor startup race",
        rootPath: "/workspace",
      });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(
      2,
    );
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 90,
      }),
    );
  });

  it("retries restored PHP IDE service autostart after a rootless running response", async () => {
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 91,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 92,
    };
    const start = vi
      .fn<LanguageServerRuntimeGateway["start"]>(async () => rootedRunningStatus)
      .mockResolvedValueOnce(rootlessRunningStatus);
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(
      2,
    );
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 92,
      }),
    );
  });

  it("auto-starts PHP IDE services while initial runtime status is still unknown", async () => {
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
    const pendingStatus = createDeferred<LanguageServerRuntimeStatus>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 88,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => pendingStatus.promise),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => ({ kind: "stopped" as const })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(
      dependencies.languageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace");

    await act(async () => {
      pendingStatus.resolve(runningStatus);
      await Promise.resolve();
    });
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
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
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("auto-starts JavaScript and TypeScript service while initial runtime status is still unknown", async () => {
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
    const pendingStatus = createDeferred<LanguageServerRuntimeStatus>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
        hover: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 64,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => pendingStatus.promise),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async () => ({ kind: "stopped" as const })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });

    await act(async () => {
      pendingStatus.resolve(runningStatus);
      await Promise.resolve();
    });
  });

  it("clears stale JavaScript and TypeScript autostart failures after switching project tabs", async () => {
    const workspaceAStart = createDeferred<LanguageServerRuntimeStatus>();
    const runningStatus = (
      rootPath: string,
      sessionId: number,
    ): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath,
      sessionId,
    });
    let workspaceAStartAttempts = 0;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) => {
          if (rootPath === "/workspace-a") {
            workspaceAStartAttempts += 1;

            if (workspaceAStartAttempts === 1) {
              return workspaceAStart.promise;
            }
          }

          return runningStatus(rootPath, 70 + workspaceAStartAttempts);
        }),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerPlan:
        readyJavaScriptTypeScriptPlan("/workspace-a"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await vi.waitFor(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
      ).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({
          typeScriptVersionPreference: "bundled",
        }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    act(() => {
      workspaceAStart.reject(new Error("stale JS autostart"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale JS autostart");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale JS autostart"),
      ),
    ).toBe(false);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await vi.waitFor(() => {
      expect(
        vi
          .mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start)
          .mock.calls.filter(([rootPath]) => rootPath === "/workspace-a"),
      ).toHaveLength(2);
    });
  });

  it("does not let a rootless JavaScript and TypeScript status probe suppress autostart", async () => {
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
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 65,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 66,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => rootlessRunningStatus),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => rootedRunningStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };

    renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      javaScriptTypeScriptLanguageServerRuntimeGateway.getStatus,
    ).toHaveBeenCalledWith("/workspace");
    expect(
      javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
  });

  it("retries JavaScript and TypeScript autostart after a rootless running response", async () => {
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
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 67,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 68,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi
          .fn<LanguageServerRuntimeGateway["start"]>(
            async () => rootedRunningStatus,
          )
          .mockResolvedValueOnce(rootlessRunningStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };

    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(36);

    expect(
      javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(2);
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 68,
      }),
    );
  });

  it("starts JavaScript and TypeScript language service lazily for inferred workspaces", async () => {
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
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      readTextFile: vi.fn(async (path: string) => {
        if (path === "/workspace/src/App.ts") {
          return "export const app = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
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
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().openPinnedFile(
        fileEntry("/workspace/src/App.ts", "App.ts"),
      );
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("starts inferred JavaScript and TypeScript service for restored JS TS tabs", async () => {
    const restoredPath = "/workspace/src/App.ts";
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
      readTextFile: vi.fn(async (path: string) => {
        if (path === restoredPath) {
          return "export const app = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("starts inferred JavaScript and TypeScript service for restored JS TS tabs in PHP workspaces", async () => {
    const restoredPath = "/workspace/scripts/tool.ts";
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
      readTextFile: vi.fn(async (path: string) => {
        if (path === restoredPath) {
          return "export const tool = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
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
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
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
        didRenameFiles: true,
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
    ).toHaveBeenCalledWith("/workspace", edit, [oldPath]);
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
  });

  it("notifies the JavaScript TypeScript service after rename when only did-rename is supported", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
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
    ).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
  });

  it("ignores stale rename errors after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const rename = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    vi.mocked(dependencies.workspaceGateways.files.renamePath).mockImplementationOnce(
      async () => rename.promise,
    );

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.rename",
    );
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      rename.reject(new Error("stale rename"));
      await renamePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Rename File" &&
          notice.message.includes("stale rename"),
      ),
    ).toBe(false);
  });

  it("does not publish stale rename success after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const parentPath = "/workspace-a/src";
    const staleDirectoryRefresh = createDeferred<FileEntry[]>();
    let holdNextParentRead = false;
    const readDirectory = vi.fn(async (path: string) => {
      if (path === parentPath && holdNextParentRead) {
        return staleDirectoryRefresh.promise;
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    holdNextParentRead = true;

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.rename",
    );
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith(parentPath);
    });
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleDirectoryRefresh.resolve([]);
    await act(async () => {
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Renamed User.php");
  });

  it("does not notify JavaScript TypeScript did-rename after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.ts";
    const newPath = "/workspace-a/src/Account.ts";
    const rename = createDeferred<void>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      sessionId: 61,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
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
    vi.mocked(dependencies.workspaceGateways.files.renamePath).mockImplementationOnce(
      async () => rename.promise,
    );

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.rename",
    );
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      rename.resolve(undefined);
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).not.toHaveBeenCalled();
  });

  it("ignores stale JavaScript TypeScript did-rename errors after same-root session restart", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const didRenameFiles = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(24)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(24)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).mockImplementationOnce(() => didRenameFiles.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(24),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(24),
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
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
      ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(25));
    });
    await flushAsyncTurns();

    await act(async () => {
      didRenameFiles.reject(new Error("stale did rename"));
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );
    expect(getWorkbench().message).toBe("Renamed User.ts");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("stale did rename"),
      ),
    ).toBe(false);
  });

  it("does not reapply JavaScript TypeScript workspace edits to already edited open Monaco models", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "export const helper = true;\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "const value = 1;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        edit,
        {
          editedOpenPaths: [openPath],
          rootPath: "/workspace",
        },
      );
    });

    expect(getWorkbench().activeDocument?.content).toBe("const value = 1;\n");
    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).toHaveBeenCalledWith("/workspace", edit, [openPath]);
  });

  it("filters JavaScript TypeScript workspace edits before applying closed files", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const outsidePath = "/other/src/Outside.ts";
    const malformedUri = "not a uri";
    const filteredEdit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "export const helper = true;\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "create" as const,
          options: { ignoreIfExists: true },
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/src/NewName.ts"),
          oldUri: fileUriFromPath("/workspace/src/OldName.ts"),
        },
      ],
    };
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
          {
            newText: "leak",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [malformedUri]: [
          {
            newText: "leak",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/src/OutsideDelete.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "const value = 1;\n";
        }

        if (path === outsidePath) {
          return "const outside = true;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Outside.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        edit,
        {
          editedOpenPaths: [openPath],
          rootPath: "/workspace",
        },
      );
    });

    expect(
      getWorkbench().openDocuments.find((document) => document.path === openPath)
        ?.content,
    ).toBe("const value = 1;\n");
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)
        ?.content,
    ).toBe("const outside = true;\n");
    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([openPath, outsidePath]),
    );
  });

  it("refreshes directories affected by JavaScript TypeScript workspace edit file operations", async () => {
    const filteredEdit = {
      changes: {},
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/components/Account.ts"),
          oldUri: fileUriFromPath("/workspace/src/User.ts"),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/workspace/tests/User.test.ts"),
        },
      ],
    };
    const edit = {
      changes: {},
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/tests/Outside.test.ts"),
        },
      ],
    };
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace/src") {
        return [fileEntry("/workspace/src/Created.ts", "Created.ts")];
      }

      if (path === "/workspace/components") {
        return [fileEntry("/workspace/components/Account.ts", "Account.ts")];
      }

      if (path === "/workspace/tests") {
        return [];
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceGateways.files.readDirectory).mockClear();

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        edit,
        {
          rootPath: "/workspace",
        },
      );
    });

    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).toHaveBeenCalledWith("/workspace", filteredEdit, []);
    expect(
      vi
        .mocked(dependencies.workspaceGateways.files.readDirectory)
        .mock.calls.map(([path]) => path),
    ).toEqual(["/workspace/src", "/workspace/components", "/workspace/tests"]);
    expect(getWorkbench().entriesByDirectory["/workspace/components"]).toEqual([
      fileEntry("/workspace/components/Account.ts", "Account.ts"),
    ]);
  });

  it("reconciles open JavaScript TypeScript tabs after workspace edit file operations", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const deletedPath = "/workspace/src/DeleteMe.ts";
    const edit = {
      changes: {
        [fileUriFromPath(newPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 17, line: 0 },
              start: { character: 13, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "rename" as const,
          newUri: fileUriFromPath(newPath),
          oldUri: fileUriFromPath(oldPath),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath(deletedPath),
        },
      ],
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 27,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        if (path === deletedPath) {
          return "export const deleted = true;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(deletedPath, "DeleteMe.ts"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    vi.mocked(dependencies.documentSyncGateway.didOpen).mockClear();

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        edit,
        {
          rootPath: "/workspace",
        },
      );
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      newPath,
    ]);
    expect(getWorkbench().activeDocument?.path).toBe(newPath);
    expect(getWorkbench().activeDocument?.name).toBe("Account.ts");
    expect(getWorkbench().activeDocument?.content).toBe(
      "export class Account {}\n",
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      deletedPath,
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newPath,
        text: "export class Account {}\n",
      }),
    );
  });

  it("filters JavaScript TypeScript rename edits to the active workspace root", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const outsidePath = "/other/src/Consumer.ts";
    const filteredEdit = {
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
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
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
        didRenameFiles: true,
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

        if (path === outsidePath) {
          return "import { User } from '../workspace/src/User';\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Consumer.ts"));
    });
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
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([oldPath, outsidePath]),
    );
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)
        ?.content,
    ).toBe("import { User } from '../workspace/src/User';\n");
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldPath,
      newPath,
    );
  });

  it("drops stale JavaScript TypeScript rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.ts";
    const newPath = "/workspace-a/src/Account.ts";
    const consumerPath = "/workspace-a/src/Consumer.ts";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockImplementationOnce(async () => renameEdit.promise);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
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
    let renameResolved = false;
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = (command?.run() ?? Promise.resolve()).then(() => {
        renameResolved = true;
      });
    });
    await flushAsyncTurns(4);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    renameEdit.resolve({
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
    });
    await act(async () => {
      await renamePromise;
    });

    expect(renameResolved).toBe(true);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).toHaveBeenCalledWith("/workspace-a", oldPath, newPath);
    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });

  it("drops stale JavaScript TypeScript rename edits after same-root session restart", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(26)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(26)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockImplementationOnce(async () => renameEdit.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(26),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(26),
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
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
      ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(27));
    });
    await flushAsyncTurns();

    renameEdit.resolve({
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
    });
    await act(async () => {
      await renamePromise;
    });

    expect(
      dependencies.workspaceGateways.files.applyWorkspaceEdit,
    ).not.toHaveBeenCalled();
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

  it("ignores stale create file errors after switching project tabs", async () => {
    const newPath = "/workspace-a/src/NewWidget.php";
    const creation = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.php");
    vi.mocked(
      dependencies.workspaceGateways.files.createTextFile,
    ).mockImplementationOnce(async () => creation.promise);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.new",
    );
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.createTextFile,
      ).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.reject(new Error("stale create file"));
      await createPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Create File" &&
          notice.message.includes("stale create file"),
      ),
    ).toBe(false);
  });

  it("does not notify JavaScript TypeScript watched files after switching project tabs", async () => {
    const newPath = "/workspace-a/src/NewWidget.ts";
    const creation = createDeferred<void>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 62,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");
    vi.mocked(
      dependencies.workspaceGateways.files.createTextFile,
    ).mockImplementationOnce(async () => creation.promise);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.new",
    );
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.createTextFile,
      ).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.resolve(undefined);
      await createPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });

  it("ignores stale create folder errors after switching project tabs", async () => {
    const newPath = "/workspace-a/src/Domain";
    const creation = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/Domain");
    vi.mocked(
      dependencies.workspaceGateways.files.createDirectory,
    ).mockImplementationOnce(async () => creation.promise);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "folder.new",
    );
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.files.createDirectory,
      ).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.reject(new Error("stale create folder"));
      await createPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Create Folder" &&
          notice.message.includes("stale create folder"),
      ),
    ).toBe(false);
  });

  it("ignores stale JavaScript TypeScript watched-file errors after same-root session restart", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const watchedFilesChanged = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(25)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(25)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).mockImplementationOnce(() => watchedFilesChanged.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(25),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(25),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.new",
    );
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
      ).toHaveBeenCalledWith("/workspace", [
        {
          changeType: "created",
          path: newPath,
        },
      ]);
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(26));
    });
    await flushAsyncTurns();

    await act(async () => {
      watchedFilesChanged.reject(new Error("stale watched files"));
      await createPromise;
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.workspaceGateways.files.createTextFile,
    ).toHaveBeenCalledWith(newPath);
    expect(getWorkbench().activePath).toBe(newPath);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale watched files"),
      ),
    ).toBe(false);
  });

  it("notifies the JavaScript TypeScript service when package metadata is created", async () => {
    const newPath = "/workspace/package.json";
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("package.json");

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

  it("ignores stale delete errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const deletion = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    vi.mocked(dependencies.workspaceGateways.files.deletePath).mockImplementationOnce(
      async () => deletion.promise,
    );

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "file.delete",
    );
    let deletePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      deletePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(
        path,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      deletion.reject(new Error("stale delete"));
      await deletePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Delete File" &&
          notice.message.includes("stale delete"),
      ),
    ).toBe(false);
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
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
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
        rootPath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptService: "auto",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      codeLensEnabled: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
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

  it("does not attach the workspace root to a rootless JavaScript and TypeScript stop response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 14,
    };
    const rootlessStopStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => rootedRunningStatus),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => rootedRunningStatus),
        stop: vi.fn(async () => rootlessStopStatus),
        subscribeStatus: vi.fn(async () => () => undefined),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan:
        readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 14,
      }),
    );

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
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });

  it("notifies the running JavaScript and TypeScript language service when workspace settings change", async () => {
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
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
        javaScriptTypeScriptCodeLens: false,
        javaScriptTypeScriptInlayHints: true,
        javaScriptTypeScriptValidation: true,
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
          javaScriptTypeScriptAutoImports: false,
          javaScriptTypeScriptCodeLens: true,
          javaScriptTypeScriptInlayHints: false,
          javaScriptTypeScriptValidation: false,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        implementationsCodeLens: { enabled: true },
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: false,
        },
        suggest: expect.objectContaining({
          autoImports: false,
          includeCompletionsForImportStatements: false,
          includeCompletionsForModuleExports: false,
        }),
        validate: {
          enable: false,
        },
      }),
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        inlayHints: expect.objectContaining({
          parameterNames: {
            enabled: "none",
            suppressWhenArgumentMatchesName: false,
          },
        }),
      }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
  });

  it("ignores stale JavaScript and TypeScript configuration errors after same-root session restart", async () => {
    const configurationChange = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(15)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(15)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).mockImplementationOnce(() => configurationChange.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(15),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(15),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
      },
    });
    await flushAsyncTurns(24);

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAutoImports: false,
        },
        true,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
      ).toHaveBeenCalledWith("/workspace", expect.any(Object));
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(16));
    });
    await flushAsyncTurns();

    await act(async () => {
      configurationChange.reject(new Error("stale configuration"));
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBe("Settings saved.");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" &&
          notice.message.includes("stale configuration"),
      ),
    ).toBe(false);
  });

  it("ignores stale workspace settings save errors after switching project tabs", async () => {
    const workspaceSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => workspaceSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.settingsGateway.saveWorkspaceSettings,
      ).toHaveBeenCalledWith("/workspace-a", expect.any(Object));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      workspaceSettingsSave.reject(new Error("stale workspace settings"));
      await savePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" &&
          notice.message.includes("stale workspace settings"),
      ),
    ).toBe(false);
  });

  it("does not continue stale settings saves after app settings persistence resolves", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.smartModeGateway.setMode).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockImplementationOnce(
      async () => appSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          intelligenceMode: "fullSmart",
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      vi
        .mocked(dependencies.smartModeGateway.setMode)
        .mock.calls.some(([mode]) => mode === "fullSmart"),
    ).toBe(false);
    expect(getWorkbench().message).not.toBe("Settings saved.");
  });

  it("ignores stale status bar setting rollbacks after switching project tabs", async () => {
    const statusBarSave = createDeferred<void>();
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      statusBar: {
        ...defaultWorkspaceSettings().statusBar,
        message: false,
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceSettings,
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => statusBarSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().setStatusBarItemVisibility("message", true);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.settingsGateway.saveWorkspaceSettings,
      ).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({
          statusBar: expect.objectContaining({ message: true }),
        }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setStatusBarItemVisibility("message", true);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(true);

    await act(async () => {
      statusBarSave.reject(new Error("stale status bar"));
      await savePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(true);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Status Bar" &&
          notice.message.includes("stale status bar"),
      ),
    ).toBe(false);
  });

  it("ignores stale session persistence errors after switching project tabs", async () => {
    const sessionSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => sessionSave.promise,
    );

    await act(async () => {
      await getWorkbench().openPinnedFile(
        fileEntry("/workspace-a/src/User.php", "User.php"),
      );
    });
    await vi.waitFor(() => {
      expect(
        dependencies.settingsGateway.saveWorkspaceSettings,
      ).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({
          session: expect.objectContaining({
            activePath: "/workspace-a/src/User.php",
          }),
        }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      sessionSave.reject(new Error("stale session save"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Session" &&
          notice.message.includes("stale session save"),
      ),
    ).toBe(false);
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
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      codeLensEnabled: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(getWorkbench().message).toBe("JavaScript/TypeScript service restarted.");
  });

  it("does not attach the workspace root to a rootless JavaScript and TypeScript restart response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 18,
    };
    const rootlessRestartStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 19,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => rootedRunningStatus),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => rootlessRestartStatus),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan:
        readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 18,
      }),
    );

    await act(async () => {
      await getWorkbench().restartJavaScriptTypeScriptService();
      await flushAsyncTurns(24);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith("/workspace");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      codeLensEnabled: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(
      getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
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

  it("does not attach the workspace root to a rootless PHP stop response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const rootlessStopStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 45,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async () => rootlessStopStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 44,
      }),
    );

    await act(async () => {
      await getWorkbench().toggleSmartMode();
      await flushAsyncTurns(24);
    });

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
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

  it("stops reading stale inherited PHP file structure candidates after switching project tabs", async () => {
    const childPath = "/workspace-a/app/Child.php";
    const primaryParentPath = "/workspace-a/app/ParentClass.php";
    const packageParentPath =
      "/workspace-a/vendor/shared/package/src/ParentClass.php";
    const childSource = "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
    const primaryParentRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === childPath) {
        return childSource;
      }

      if (path === primaryParentPath) {
        return primaryParentRead.promise;
      }

      if (path === packageParentPath) {
        return "<?php\nnamespace App;\nclass ParentClass {}\n";
      }

      return "<?php\n";
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packages: [
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
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
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(primaryParentPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    primaryParentRead.reject(new Error("missing parent"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(readTextFile).not.toHaveBeenCalledWith(packageParentPath);
    expect(
      dependencies.phpFileOutlineGateway.parsePhpFileOutline,
    ).not.toHaveBeenCalledWith(
      packageParentPath,
      expect.stringContaining("ParentClass"),
    );
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

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);
    await act(async () => {
      await command?.run();
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

  it("reloads JavaScript and TypeScript file structure after closing and reopening a workspace", async () => {
    const path = "/workspace/src/userService.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 13,
    };
    const firstSymbols = [
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "FirstUserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 29),
      },
    ];
    const secondSymbols = [
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "SecondUserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 30),
      },
    ];
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    )
      .mockResolvedValueOnce(firstSymbols)
      .mockResolvedValueOnce(secondSymbols);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.fileStructure")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).toHaveBeenCalledTimes(1);
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.label).toBe(
      "FirstUserService",
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().workspaceRoot).toBeNull();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.fileStructure")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).toHaveBeenCalledTimes(2);
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.label).toBe(
      "SecondUserService",
    );
  });

  it("drops stale JavaScript and TypeScript file structure after same-root session restart", async () => {
    const path = "/workspace/src/userService.ts";
    const documentSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(12)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(12)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).mockImplementationOnce(async () => documentSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(12),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(12),
      readTextFile: vi.fn(async () => "export class UserService {}"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );

    await act(async () => {
      await command?.run();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
      ).toHaveBeenCalledWith("/workspace", path);
    });
    expect(getWorkbench().fileStructureLoading).toBe(true);

    act(() => {
      publishRuntimeStatus?.(runningStatus(13));
    });
    await flushAsyncTurns();

    documentSymbols.resolve([
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "UserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 24),
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureLoading).toBe(false);
    expect(getWorkbench().fileStructureOutline).toBeNull();
  });

  it("drops stale JavaScript and TypeScript file structure errors after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const documentSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 32,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).mockImplementationOnce(async () => documentSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );

    await act(async () => {
      await command?.run();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
      ).toHaveBeenCalledWith("/workspace-a", path);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    documentSymbols.reject(new Error("stale file structure"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale file structure");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript File Structure" &&
          notice.message.includes("stale file structure"),
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript file structure results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const documentSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 33,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
    ).mockImplementationOnce(async () => documentSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );

    await act(async () => {
      await command?.run();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols,
      ).toHaveBeenCalledWith("/workspace-a", path);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    documentSymbols.resolve([
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "StaleUserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 29),
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().fileStructureOutline).toBeNull();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript File Structure" &&
          notice.message.includes("StaleUserService"),
      ),
    ).toBe(false);
  });

  it("opens JavaScript and TypeScript call hierarchy from command palette actions", async () => {
    const path = "/workspace/src/userService.ts";
    const callerPath = "/workspace/src/app.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "loadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 17),
      tags: [],
      uri: "file:///workspace/src/userService.ts",
    };
    const caller = {
      data: { symbolId: "render" },
      detail: "src/app.ts",
      kind: 12,
      name: "render",
      range: range(4, 0, 6, 1),
      selectionRange: range(4, 9, 4, 15),
      tags: [],
      uri: "file:///workspace/src/app.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockResolvedValue([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(5, 2, 5, 10)],
      },
    ]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls,
    ).mockResolvedValue([]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === callerPath) {
          return "import { loadUser } from './userService';\nrender(loadUser());\n";
        }

        return "export function loadUser() {\n  return 'Ada';\n}\n";
      }),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).toHaveBeenCalledWith("/workspace", {
      character: 16,
      line: 1,
      path,
    });
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).toHaveBeenCalledWith("/workspace", item);
    expect(getWorkbench().callHierarchyView?.item.name).toBe("loadUser");
    expect(getWorkbench().callHierarchyView?.incoming).toHaveLength(1);

    const [row] = callHierarchyRows(getWorkbench().callHierarchyView!);

    await act(async () => {
      await getWorkbench().openCallHierarchyRow(row);
    });

    expect(getWorkbench().callHierarchyView).toBe(null);
    expect(getWorkbench().activePath).toBe(callerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: callerPath,
      position: {
        column: 3,
        lineNumber: 6,
      },
    });
  });

  it("clears JavaScript and TypeScript call hierarchy when the last project tab closes", async () => {
    const path = "/workspace/src/userService.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      sessionId: 13,
    };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "loadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 17),
      tags: [],
      uri: "file:///workspace/src/userService.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockResolvedValue([item]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(
        async () => "export function loadUser() {\n  return 'Ada';\n}\n",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().callHierarchyView?.item.name).toBe("loadUser");

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().callHierarchyView).toBeNull();
    expect(getWorkbench().typeHierarchyView).toBeNull();
    expect(getWorkbench().implementationChooser).toBeNull();
  });

  it("keeps JavaScript and TypeScript call hierarchy open for rows from inactive project tabs", async () => {
    const path = "/workspace-b/src/userService.ts";
    const callerPath = "/workspace-b/src/app.ts";
    const staleCallerPath = "/workspace-a/src/app.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 39,
    };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "loadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 17),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const caller = {
      data: { symbolId: "render" },
      detail: "src/app.ts",
      kind: 12,
      name: "render",
      range: range(4, 0, 6, 1),
      selectionRange: range(4, 9, 4, 15),
      tags: [],
      uri: fileUriFromPath(callerPath),
    };
    const staleCaller = {
      ...caller,
      name: "staleRender",
      uri: fileUriFromPath(staleCallerPath),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockResolvedValue([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(5, 2, 5, 10)],
      },
    ]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls,
    ).mockResolvedValue([]);
    const readTextFile = vi.fn(
      async (requestedPath: string) => `// ${requestedPath}\n`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().callHierarchyView?.item.name).toBe("loadUser");

    const [staleRow] = callHierarchyRows({
      incoming: [
        {
          from: staleCaller,
          fromRanges: [range(5, 2, 5, 10)],
        },
      ],
      item,
      outgoing: [],
    });

    await act(async () => {
      await getWorkbench().openCallHierarchyRow(staleRow);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().callHierarchyView?.item.name).toBe("loadUser");
    expect(getWorkbench().activePath).toBe(path);
    expect(readTextFile).not.toHaveBeenCalledWith(staleCallerPath);
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.back")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript call hierarchy errors after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const prepareCallHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>
        >
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 28,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockImplementationOnce(async () => prepareCallHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export function loadUser() {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).toHaveBeenCalledWith("/workspace-a", {
      character: 16,
      line: 0,
      path,
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareCallHierarchy.reject(new Error("stale call hierarchy"));
    await act(async () => {
      await commandPromise;
    });

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale call hierarchy");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Call Hierarchy" &&
          notice.message.includes("stale call hierarchy"),
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript call hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const prepareCallHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>
        >
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 33,
    };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "staleLoadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 22),
      tags: [],
      uri: "file:///workspace-a/src/userService.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockImplementationOnce(async () => prepareCallHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export function loadUser() {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).toHaveBeenCalledWith("/workspace-a", {
      character: 16,
      line: 0,
      path,
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareCallHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().callHierarchyView).toBeNull();
  });

  it("drops stale JavaScript and TypeScript call hierarchy follow-up results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const incomingCalls =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["incomingCalls"]>>
      >();
    const outgoingCalls =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["outgoingCalls"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 34,
    };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "loadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 17),
      tags: [],
      uri: "file:///workspace-a/src/userService.ts",
    };
    const caller = {
      data: { symbolId: "render" },
      detail: "src/app.ts",
      kind: 12,
      name: "render",
      range: range(4, 0, 6, 1),
      selectionRange: range(4, 9, 4, 15),
      tags: [],
      uri: "file:///workspace-a/src/app.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockResolvedValueOnce([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).mockImplementationOnce(async () => incomingCalls.promise);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls,
    ).mockImplementationOnce(async () => outgoingCalls.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export function loadUser() {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
      ).toHaveBeenCalledWith("/workspace-a", item);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    incomingCalls.resolve([
      {
        from: caller,
        fromRanges: [range(5, 2, 5, 10)],
      },
    ]);
    outgoingCalls.resolve([]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().callHierarchyView).toBeNull();
  });

  it("drops stale JavaScript and TypeScript call hierarchy after same-root session restart", async () => {
    const path = "/workspace/src/userService.ts";
    const prepareCallHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>
        >
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(29)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(29)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const item = {
      data: { symbolId: "loadUser" },
      detail: "src/userService.ts",
      kind: 6,
      name: "loadUser",
      range: range(1, 9, 3, 3),
      selectionRange: range(1, 9, 1, 17),
      tags: [],
      uri: "file:///workspace/src/userService.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
    ).mockImplementationOnce(async () => prepareCallHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(29),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(29),
      readTextFile: vi.fn(async () => "export function loadUser() {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 17,
        lineNumber: 1,
      });
    });

    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.prepareCallHierarchy,
      ).toHaveBeenCalled();
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(30));
    });
    await flushAsyncTurns();

    prepareCallHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls,
    ).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().callHierarchyView).toBeNull();
  });

  it("opens JavaScript and TypeScript type hierarchy from command palette actions", async () => {
    const path = "/workspace/src/user.ts";
    const subtypePath = "/workspace/src/adminUser.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      sessionId: 13,
    };
    const item = {
      data: { symbolId: "User" },
      detail: "src/user.ts",
      kind: 5,
      name: "User",
      range: range(0, 0, 4, 1),
      selectionRange: range(0, 13, 0, 17),
      tags: [],
      uri: "file:///workspace/src/user.ts",
    };
    const subtype = {
      data: { symbolId: "AdminUser" },
      detail: "src/adminUser.ts",
      kind: 5,
      name: "AdminUser",
      range: range(2, 0, 5, 1),
      selectionRange: range(2, 13, 2, 22),
      tags: [],
      uri: "file:///workspace/src/adminUser.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockResolvedValue([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes,
    ).mockResolvedValue([]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).mockResolvedValue([subtype]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === subtypePath) {
          return "import { User } from './user';\nexport class AdminUser extends User {}\n";
        }

        return "export class User {}\n";
      }),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).toHaveBeenCalledWith("/workspace", {
      character: 14,
      line: 0,
      path,
    });
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).toHaveBeenCalledWith("/workspace", item);
    expect(getWorkbench().typeHierarchyView?.item.name).toBe("User");
    expect(getWorkbench().typeHierarchyView?.subtypes).toHaveLength(1);

    const [row] = typeHierarchyRows(getWorkbench().typeHierarchyView!);

    await act(async () => {
      await getWorkbench().openTypeHierarchyRow(row);
    });

    expect(getWorkbench().typeHierarchyView).toBe(null);
    expect(getWorkbench().activePath).toBe(subtypePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: subtypePath,
      position: {
        column: 14,
        lineNumber: 3,
      },
    });
  });

  it("keeps JavaScript and TypeScript type hierarchy open for rows from inactive project tabs", async () => {
    const path = "/workspace-b/src/user.ts";
    const subtypePath = "/workspace-b/src/adminUser.ts";
    const staleSubtypePath = "/workspace-a/src/adminUser.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 40,
    };
    const item = {
      data: { symbolId: "User" },
      detail: "src/user.ts",
      kind: 5,
      name: "User",
      range: range(0, 0, 4, 1),
      selectionRange: range(0, 13, 0, 17),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const subtype = {
      data: { symbolId: "AdminUser" },
      detail: "src/adminUser.ts",
      kind: 5,
      name: "AdminUser",
      range: range(2, 0, 5, 1),
      selectionRange: range(2, 13, 2, 22),
      tags: [],
      uri: fileUriFromPath(subtypePath),
    };
    const staleSubtype = {
      ...subtype,
      name: "StaleAdminUser",
      uri: fileUriFromPath(staleSubtypePath),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockResolvedValue([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes,
    ).mockResolvedValue([]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).mockResolvedValue([subtype]);
    const readTextFile = vi.fn(
      async (requestedPath: string) => `// ${requestedPath}\n`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().typeHierarchyView?.item.name).toBe("User");

    const [staleRow] = typeHierarchyRows({
      item,
      subtypes: [staleSubtype],
      supertypes: [],
    });

    await act(async () => {
      await getWorkbench().openTypeHierarchyRow(staleRow);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().typeHierarchyView?.item.name).toBe("User");
    expect(getWorkbench().activePath).toBe(path);
    expect(readTextFile).not.toHaveBeenCalledWith(staleSubtypePath);
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.back")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript type hierarchy errors after switching project tabs", async () => {
    const path = "/workspace-a/src/user.ts";
    const prepareTypeHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>
        >
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 31,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockImplementationOnce(async () => prepareTypeHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).toHaveBeenCalledWith("/workspace-a", {
      character: 14,
      line: 0,
      path,
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareTypeHierarchy.reject(new Error("stale type hierarchy"));
    await act(async () => {
      await commandPromise;
    });

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale type hierarchy");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Type Hierarchy" &&
          notice.message.includes("stale type hierarchy"),
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript type hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/src/user.ts";
    const prepareTypeHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>
        >
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 32,
    };
    const item = {
      data: { symbolId: "User" },
      detail: "src/user.ts",
      kind: 5,
      name: "StaleUser",
      range: range(0, 0, 4, 1),
      selectionRange: range(0, 13, 0, 22),
      tags: [],
      uri: "file:///workspace-a/src/user.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockImplementationOnce(async () => prepareTypeHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).toHaveBeenCalledWith("/workspace-a", {
      character: 14,
      line: 0,
      path,
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareTypeHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes,
    ).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().typeHierarchyView).toBeNull();
  });

  it("drops stale JavaScript and TypeScript type hierarchy follow-up results after switching project tabs", async () => {
    const path = "/workspace-a/src/user.ts";
    const supertypes =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["typeHierarchySupertypes"]>
        >
      >();
    const subtypes =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["typeHierarchySubtypes"]>
        >
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 35,
    };
    const item = {
      data: { symbolId: "User" },
      detail: "src/user.ts",
      kind: 5,
      name: "User",
      range: range(0, 0, 4, 1),
      selectionRange: range(0, 13, 0, 17),
      tags: [],
      uri: "file:///workspace-a/src/user.ts",
    };
    const subtype = {
      data: { symbolId: "AdminUser" },
      detail: "src/adminUser.ts",
      kind: 5,
      name: "StaleAdminUser",
      range: range(2, 0, 5, 1),
      selectionRange: range(2, 13, 2, 27),
      tags: [],
      uri: "file:///workspace-a/src/adminUser.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockResolvedValueOnce([item]);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes,
    ).mockImplementationOnce(async () => supertypes.promise);
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).mockImplementationOnce(async () => subtypes.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
      ).toHaveBeenCalledWith("/workspace-a", item);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    supertypes.resolve([]);
    subtypes.resolve([subtype]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().typeHierarchyView).toBeNull();
  });

  it("drops stale JavaScript and TypeScript type hierarchy after same-root session restart", async () => {
    const path = "/workspace/src/user.ts";
    const prepareTypeHierarchy =
      createDeferred<
        Awaited<
          ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>
        >
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(14)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(14)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const item = {
      data: { symbolId: "User" },
      detail: "src/user.ts",
      kind: 5,
      name: "User",
      range: range(0, 0, 4, 1),
      selectionRange: range(0, 13, 0, 17),
      tags: [],
      uri: "file:///workspace/src/user.ts",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
    ).mockImplementationOnce(async () => prepareTypeHierarchy.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(14),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(14),
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "user.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 15,
        lineNumber: 1,
      });
    });

    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench().commands
        .find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.prepareTypeHierarchy,
      ).toHaveBeenCalled();
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(15));
    });
    await flushAsyncTurns();

    prepareTypeHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySupertypes,
    ).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeHierarchySubtypes,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().typeHierarchyView).toBeNull();
  });

  it("opens JavaScript and TypeScript definitions through workbench commands", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/src/user.ts";
    const source = "import { User } from './user';\nconst user = new User();\n";
    const target = "export class User {\n  name = '';\n}\n";
    const cursorPosition = positionAfter(source, "new Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 31,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).mockResolvedValue([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
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
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 14,
        lineNumber: 1,
      },
    });
  });

  it("clears the active editor position before JavaScript and TypeScript navigation in another project tab", async () => {
    const workspaceAPath = "/workspace-a/src/main.ts";
    const workspaceBPath = "/workspace-b/src/main.ts";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      sessionId: 77,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runtimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runtimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === workspaceAPath) {
          return "export const fromA = 1;\n";
        }

        if (requestedPath === workspaceBPath) {
          return "export const fromB = 1;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(workspaceAPath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 14,
        lineNumber: 1,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(workspaceBPath, "main.ts"));
    });
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).mockClear();

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });
    await flushAsyncTurns();

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).not.toHaveBeenCalled();
  });

  it("drops stale JavaScript and TypeScript navigation after switching project tabs during target open", async () => {
    const sourcePath = "/workspace-a/src/main.ts";
    const targetPath = "/workspace-a/src/user.ts";
    const source = "import { User } from './user';\nconst user = new User();\n";
    const target = "export class User {\n  name = '';\n}\n";
    const targetRead = createDeferred<string>();
    const cursorPosition = positionAfter(source, "new Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 33,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return targetRead.promise;
      }

      return "";
    });
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).mockResolvedValue([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    expect(command).toBeDefined();

    let navigationPromise: Promise<void> = Promise.resolve();

    await act(async () => {
      navigationPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(targetPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    targetRead.resolve(target);
    await act(async () => {
      await navigationPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message).not.toBe(
      "Opened definition user.ts:1:14",
    );
  });

  it("drops stale JavaScript and TypeScript navigation after same-root session restart", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/src/user.ts";
    const source = "import { User } from './user';\nconst user = new User();\n";
    const target = "export class User {\n  name = '';\n}\n";
    const cursorPosition = positionAfter(source, "new Us");
    const definitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(41)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(41)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
    ).mockImplementationOnce(async () => definitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return target;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(41),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(41),
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    expect(command).toBeDefined();

    let navigationPromise: Promise<void> = Promise.resolve();

    await act(async () => {
      navigationPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
      ).toHaveBeenCalled();
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(42));
    });
    await flushAsyncTurns();

    definitionResult.resolve([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await navigationPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().activePath).toBe(sourcePath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe(
      "Opened definition user.ts:1:14",
    );
  });

  it("drops stale PHP language server definition results after switching project tabs", async () => {
    const sourcePath = "/workspace-a/app/Http/Controllers/UserController.php";
    const targetPath = "/external/vendor/package/Helper.php";
    const source = `<?php

$result = helper_call();
`;
    const target = `<?php

function helper_call(): string
{
    return 'ok';
}
`;
    const cursorPosition = positionAfter(source, "helper_ca");
    const definitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
      >();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 51,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      languageServerFeaturesGateway.definition,
    ).mockImplementationOnce(async () => definitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return target;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile,
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "UserController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith(
        "/workspace-a",
        {
          character: cursorPosition.column - 1,
          line: cursorPosition.lineNumber - 1,
          path: sourcePath,
        },
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    definitionResult.resolve([
      {
        range: range(2, 9, 2, 20),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe(
      "Opened definition Helper.php:3:10",
    );
  });

  it("drops stale PHP language server invalid definition targets after switching project tabs", async () => {
    const sourcePath = "/workspace-a/app/Http/Controllers/UserController.php";
    const source = `<?php

$result = helper_call();
`;
    const cursorPosition = positionAfter(source, "helper_ca");
    const definitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
      >();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 52,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      languageServerFeaturesGateway.definition,
    ).mockImplementationOnce(async () => definitionResult.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => source),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "UserController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith(
        "/workspace-a",
        {
          character: cursorPosition.column - 1,
          line: cursorPosition.lineNumber - 1,
          path: sourcePath,
        },
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    definitionResult.resolve([
      {
        range: range(2, 9, 2, 20),
        uri: "untitled:stale-definition",
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Could not open definition target.");
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.back")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
  });

  it("drops stale PHP language server definition results after same-root session restart", async () => {
    const sourcePath = "/workspace/app/Http/Controllers/UserController.php";
    const targetPath = "/external/vendor/package/Helper.php";
    const source = `<?php

$result = helper_call();
`;
    const target = `<?php

function helper_call(): string
{
    return 'ok';
}
`;
    const cursorPosition = positionAfter(source, "helper_ca");
    const definitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(61)),
      openLog: vi.fn(async () => "/tmp/phpactor-language-server.log"),
      start: vi.fn(async () => runningStatus(61)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      languageServerFeaturesGateway.definition,
    ).mockImplementationOnce(async () => definitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return target;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      languageServerRuntimeGateway,
      readTextFile,
      runtimeStatus: runningStatus(61),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "UserController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith(
        "/workspace",
        {
          character: cursorPosition.column - 1,
          line: cursorPosition.lineNumber - 1,
          path: sourcePath,
        },
      );
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(62));
    });
    await flushAsyncTurns();

    definitionResult.resolve([
      {
        range: range(2, 9, 2, 20),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().activePath).toBe(sourcePath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe(
      "Opened definition Helper.php:3:10",
    );
  });

  it("opens JavaScript and TypeScript source definitions through workbench commands", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/packages/user/src/user.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const target = "export class User {\n  name = '';\n}\n";
    const cursorPosition = positionAfter(source, "new Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        sourceDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 32,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
    ).mockResolvedValue([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
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
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToSourceDefinition")
        ?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
    ).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 14,
        lineNumber: 1,
      },
    });
  });

  it("drops stale JavaScript and TypeScript source definition results after switching project tabs", async () => {
    const sourcePath = "/workspace-a/src/main.ts";
    const targetPath = "/workspace-a/packages/user/src/user.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const cursorPosition = positionAfter(source, "new Us");
    const sourceDefinitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["sourceDefinition"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        sourceDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 37,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
    ).mockImplementationOnce(async () => sourceDefinitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return "export class User {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToSourceDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
      ).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    sourceDefinitionResult.resolve([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe("Opened source definition user.ts:1:14");
  });

  it("drops stale JavaScript and TypeScript source definition results after same-root session restart", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/packages/user/src/user.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const cursorPosition = positionAfter(source, "new Us");
    const sourceDefinitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["sourceDefinition"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        sourceDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(44)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(44)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
    ).mockImplementationOnce(async () => sourceDefinitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return "export class User {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(44),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(44),
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToSourceDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.sourceDefinition,
      ).toHaveBeenCalledWith("/workspace", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(45));
    });
    await flushAsyncTurns();

    sourceDefinitionResult.resolve([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().activePath).toBe(sourcePath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe("Opened source definition user.ts:1:14");
  });

  it("opens JavaScript and TypeScript declarations through workbench commands", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/types/user.d.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const target = "export declare class User {\n  name: string;\n}\n";
    const cursorPosition = positionAfter(source, "new Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        declaration: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 38,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
    ).mockResolvedValue([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
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
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDeclaration",
    );

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
    ).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 14,
        lineNumber: 1,
      },
    });
  });

  it("drops stale JavaScript and TypeScript declaration results after switching project tabs", async () => {
    const sourcePath = "/workspace-a/src/main.ts";
    const targetPath = "/workspace-a/types/user.d.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const cursorPosition = positionAfter(source, "new Us");
    const declarationResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["declaration"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        declaration: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 39,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
    ).mockImplementationOnce(async () => declarationResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return "export declare class User {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDeclaration",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
      ).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    declarationResult.resolve([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe("Opened declaration user.d.ts:1:14");
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.back")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript invalid declaration targets after switching project tabs", async () => {
    const sourcePath = "/workspace-a/src/main.ts";
    const source = "import { User } from '@workspace/user';\nnew User();\n";
    const cursorPosition = positionAfter(source, "new Us");
    const declarationResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["declaration"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        declaration: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 41,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
    ).mockImplementationOnce(async () => declarationResult.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => source),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDeclaration",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
      ).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    declarationResult.resolve([
      {
        range: range(0, 13, 0, 17),
        uri: "untitled:stale-declaration",
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Could not open declaration target.");
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.back")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
  });

  it("opens JavaScript and TypeScript type definitions through workbench commands", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/src/user.ts";
    const source = "const user: User = makeUser();\nuser.name;\n";
    const target = "export interface User {\n  name: string;\n}\n";
    const cursorPosition = positionAfter(source, "Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 40,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
    ).mockResolvedValue([
      {
        range: range(0, 17, 0, 21),
        uri: fileUriFromPath(targetPath),
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
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToTypeDefinition",
    );

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
    ).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 18,
        lineNumber: 1,
      },
    });
  });

  it("drops stale JavaScript and TypeScript type definition results after switching project tabs", async () => {
    const sourcePath = "/workspace-a/src/main.ts";
    const targetPath = "/workspace-a/src/user.ts";
    const source = "const user: User = makeUser();\nuser.name;\n";
    const cursorPosition = positionAfter(source, "Us");
    const typeDefinitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["typeDefinition"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 43,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
    ).mockImplementationOnce(async () => typeDefinitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return "export interface User {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToTypeDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
      ).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    typeDefinitionResult.resolve([
      {
        range: range(0, 17, 0, 21),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe(
      "Opened type definition user.ts:1:18",
    );
  });

  it("drops stale JavaScript and TypeScript type definition results after same-root session restart", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/src/user.ts";
    const source = "const user: User = makeUser();\nuser.name;\n";
    const cursorPosition = positionAfter(source, "Us");
    const typeDefinitionResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["typeDefinition"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus:
      | ((status: LanguageServerRuntimeStatus) => void)
      | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(46)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(46)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
    ).mockImplementationOnce(async () => typeDefinitionResult.promise);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === sourcePath) {
        return source;
      }

      if (requestedPath === targetPath) {
        return "export interface User {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(46),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(46),
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToTypeDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
      ).toHaveBeenCalledWith("/workspace", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(47));
    });
    await flushAsyncTurns();

    typeDefinitionResult.resolve([
      {
        range: range(0, 17, 0, 21),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().activePath).toBe(sourcePath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).not.toBe(
      "Opened type definition user.ts:1:18",
    );
  });

  it("shows a JavaScript and TypeScript implementation chooser through workbench commands", async () => {
    const interfacePath = "/workspace/src/PlatformAdapter.ts";
    const baseAdapterPath = "/workspace/src/BaseAdapter.ts";
    const facebookAdapterPath = "/workspace/src/FacebookAdapterService.ts";
    const interfaceSource = `export interface PlatformAdapter {
  getPlatform(): string;
}
`;
    const baseAdapterSource = `import type { PlatformAdapter } from './PlatformAdapter';

export abstract class BaseAdapter implements PlatformAdapter {
  getPlatform(): string {
    return 'base';
  }
}
`;
    const facebookAdapterSource = `import { BaseAdapter } from './BaseAdapter';

export class FacebookAdapterService extends BaseAdapter {
  getPlatform(): string {
    return 'facebook';
  }
}
`;
    const cursorPosition = positionAfter(interfaceSource, "getPlatform");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        implementation: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 32,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.implementation,
    ).mockResolvedValue([
      {
        range: range(3, 2, 5, 3),
        uri: fileUriFromPath(baseAdapterPath),
      },
      {
        range: range(3, 2, 5, 3),
        uri: fileUriFromPath(facebookAdapterPath),
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
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === interfacePath) {
          return interfaceSource;
        }

        if (requestedPath === baseAdapterPath) {
          return baseAdapterSource;
        }

        if (requestedPath === facebookAdapterPath) {
          return facebookAdapterSource;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToImplementation",
    );

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.implementation,
    ).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: interfacePath,
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
        detail: "BaseAdapter.ts",
        label: "BaseAdapter",
        path: baseAdapterPath,
      },
      {
        detail: "FacebookAdapterService.ts",
        label: "FacebookAdapterService",
        path: facebookAdapterPath,
      },
    ]);
  });

  it("drops stale JavaScript and TypeScript implementation results after switching project tabs", async () => {
    const interfacePath = "/workspace-a/src/PlatformAdapter.ts";
    const implementationPath = "/workspace-a/src/FacebookAdapterService.ts";
    const interfaceSource = `export interface PlatformAdapter {
  getPlatform(): string;
}
`;
    const cursorPosition = positionAfter(interfaceSource, "getPlatform");
    const implementationResult =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["implementation"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        implementation: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 36,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.implementation,
    ).mockImplementationOnce(async () => implementationResult.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === interfacePath) {
          return interfaceSource;
        }

        if (requestedPath === implementationPath) {
          return "export class FacebookAdapterService {}\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToImplementation",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.implementation,
      ).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: interfacePath,
      });
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    implementationResult.resolve([
      {
        range: range(3, 2, 5, 3),
        uri: fileUriFromPath(implementationPath),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(implementationPath);
    expect(getWorkbench().implementationChooser).toBeNull();
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });

  it("stops reading stale JavaScript and TypeScript implementation chooser targets after switching project tabs", async () => {
    const interfacePath = "/workspace-a/src/PlatformAdapter.ts";
    const baseAdapterPath = "/workspace-a/src/BaseAdapter.ts";
    const facebookAdapterPath = "/workspace-a/src/FacebookAdapterService.ts";
    const interfaceSource = `export interface PlatformAdapter {
  getPlatform(): string;
}
`;
    const baseAdapterSource = `import type { PlatformAdapter } from './PlatformAdapter';

export abstract class BaseAdapter implements PlatformAdapter {
  getPlatform(): string {
    return 'base';
  }
}
`;
    const cursorPosition = positionAfter(interfaceSource, "getPlatform");
    const baseAdapterRead = createDeferred<string>();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        implementation: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 38,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.implementation,
    ).mockResolvedValue([
      {
        range: range(3, 2, 5, 3),
        uri: fileUriFromPath(baseAdapterPath),
      },
      {
        range: range(3, 2, 5, 3),
        uri: fileUriFromPath(facebookAdapterPath),
      },
    ]);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === interfacePath) {
        return interfaceSource;
      }

      if (requestedPath === baseAdapterPath) {
        return baseAdapterRead.promise;
      }

      if (requestedPath === facebookAdapterPath) {
        return "export class FacebookAdapterService {}\n";
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToImplementation",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(baseAdapterPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    baseAdapterRead.resolve(baseAdapterSource);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(readTextFile).not.toHaveBeenCalledWith(facebookAdapterPath);
    expect(getWorkbench().implementationChooser).toBeNull();
    expect(getWorkbench().editorRevealTarget).toBeNull();
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

  it("drops stale JavaScript and TypeScript workspace symbol errors after switching project tabs", async () => {
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        workspaceSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 27,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).mockImplementationOnce(async () => workspaceSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      await Promise.resolve();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).toHaveBeenCalledWith("/workspace-a", "User");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    workspaceSymbols.reject(new Error("stale workspace symbols"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale workspace symbols");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Workspace Symbols" &&
          notice.message.includes("stale workspace symbols"),
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript workspace symbol results after switching project tabs", async () => {
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        workspaceSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 28,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).mockImplementationOnce(async () => workspaceSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus:
        javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      await Promise.resolve();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).toHaveBeenCalledWith("/workspace-a", "User");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    workspaceSymbols.resolve([
      {
        containerName: "src/staleUser",
        kind: 5,
        location: {
          range: range(1, 13, 2, 1),
          uri: fileUriFromPath("/workspace-a/src/staleUser.ts"),
        },
        name: "StaleUser",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().classOpenResults.some(
        (result) => result.name === "StaleUser",
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript workspace symbol errors after same-root session restart", async () => {
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        workspaceSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(411)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(411)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).mockImplementationOnce(async () => workspaceSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(411),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(411),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      await Promise.resolve();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).toHaveBeenCalledWith("/workspace", "User");

    act(() => {
      publishStatus?.(runningStatus(412));
    });
    await flushAsyncTurns();

    workspaceSymbols.reject(new Error("stale workspace symbols"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().message).not.toBe("Error: stale workspace symbols");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Workspace Symbols" &&
          notice.message.includes("stale workspace symbols"),
      ),
    ).toBe(false);
  });

  it("drops stale JavaScript and TypeScript workspace symbol results after same-root session restart", async () => {
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        workspaceSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null =
      null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway =
      {
        getStatus: vi.fn(async () => runningStatus(421)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async () => runningStatus(421)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishStatus = listener;
          return () => undefined;
        }),
      };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).mockImplementationOnce(async () => workspaceSymbols.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(421),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(421),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      await Promise.resolve();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.workspaceSymbols,
    ).toHaveBeenCalledWith("/workspace", "User");

    act(() => {
      publishStatus?.(runningStatus(422));
    });
    await flushAsyncTurns();

    workspaceSymbols.resolve([
      {
        containerName: "src/staleUser",
        kind: 5,
        location: {
          range: range(1, 13, 2, 1),
          uri: fileUriFromPath("/workspace/src/staleUser.ts"),
        },
        name: "StaleUser",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(
      getWorkbench().classOpenResults.some(
        (result) => result.name === "StaleUser",
      ),
    ).toBe(false);
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

  it("drops stale contextual PHP class targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const targetPath = "/external/shared/CommentsAgent.php";
    const controllerSource = "<?php\n$agent = new CommentsAgent();\n";
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === targetPath) {
        return "<?php\nfinal class CommentsAgent {}\n";
      }

      return `<?php\n// ${path}\n`;
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 13,
        containerName: null,
        fullyQualifiedName: "App\\CommentsAgent",
        kind: "class",
        lineNumber: 4,
        name: "CommentsAgent",
        path: targetPath,
        relativePath: "../shared/CommentsAgent.php",
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });

  it("drops stale contextual PHP method targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const targetPath = "/external/shared/CommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->create();
    }
}
`;
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === targetPath) {
        return "<?php\nfinal class CommentsService { public function create() {} }\n";
      }

      return `<?php\n// ${path}\n`;
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "create"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "create", 50);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 53,
        containerName: "App\\Services\\CommentsService",
        fullyQualifiedName: "App\\Services\\CommentsService::create",
        kind: "method",
        lineNumber: 1,
        name: "create",
        path: targetPath,
        relativePath: "../shared/CommentsService.php",
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No typed target found");
  });

  it("drops stale contextual PHP property targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    public string $externalId;
}
`;
    const secondCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 2
          ? secondCommentRead.promise
          : commentSource;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
        packages: [],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "externalId"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(commentReadCount).toBe(2);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    secondCommentRead.resolve(commentSource);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      readTextFile.mock.calls.filter(([path]) => path === commentPath),
    ).toHaveLength(2);
    expect(getWorkbench().activePath).not.toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No relation method found");
  });

  it("stops stale Laravel model attribute target candidates after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const packageCommentPath =
      "/workspace-a/vendor/shared/package/src/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->content;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    public string $content;

    protected $appends = [
        'content',
    ];
}
`;
    const staleAttributeRead = createDeferred<string>();
    let commentReadCount = 0;
    let packageCommentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 3
          ? staleAttributeRead.promise
          : commentSource;
      }

      if (path === packageCommentPath) {
        packageCommentReadCount += 1;
        return commentSource;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
        packages: [
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "content"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(commentReadCount).toBe(3);
    });
    const packageReadsBeforeSwitch = packageCommentReadCount;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleAttributeRead.reject(new Error("stale attribute source"));
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(packageCommentReadCount).toBe(packageReadsBeforeSwitch);
    expect(getWorkbench().activePath).not.toBe(packageCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });

  it("stops stale Laravel dynamic where target candidates after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const packageCommentPath =
      "/workspace-a/vendor/shared/package/src/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereContent('hello')->first();
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];
}
`;
    const staleDynamicWhereRead = createDeferred<string>();
    let commentReadCount = 0;
    let packageCommentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 2
          ? staleDynamicWhereRead.promise
          : commentSource;
      }

      if (path === packageCommentPath) {
        packageCommentReadCount += 1;
        return commentSource;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
        packages: [
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "whereContent"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(commentReadCount).toBe(2);
    });
    const packageReadsBeforeSwitch = packageCommentReadCount;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleDynamicWhereRead.reject(new Error("stale dynamic where source"));
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(packageCommentReadCount).toBe(packageReadsBeforeSwitch);
    expect(getWorkbench().activePath).not.toBe(packageCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No typed target found");
  });

  it("drops stale Laravel request method hint targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const inputTraitPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const controllerSource = `<?php
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
    const staleInputRead = createDeferred<string>();
    let inputTraitReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === inputTraitPath) {
        inputTraitReadCount += 1;
        return staleInputRead.promise;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
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
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "input"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(inputTraitReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleInputRead.resolve(
      "<?php\ntrait InteractsWithInput\n{\n    public function input($key = null, $default = null) {}\n}\n",
    );
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(inputTraitPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });

  it("drops stale indexed go to definition errors after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.reject(new Error("stale indexed definition"));
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale indexed definition");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Go to Definition" &&
          notice.message.includes("stale indexed definition"),
      ),
    ).toBe(false);
  });

  it("drops stale indexed go to definition results after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const agentPath = "/workspace-a/src/CommentsAgent.php";
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        if (path === agentPath) {
          return "<?php\nfinal class CommentsAgent {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.resolve([
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
      ]);
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(agentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message).not.toBe(
      "Opened definition CommentsAgent.php:4:13",
    );
  });

  it("drops stale indexed go to definition misses after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.resolve([]);
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe(
      "No indexed symbol found for CommentsAgent.",
    );
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

  it("drops stale PHP method completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace-a/app/Services/CommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const serviceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === servicePath) {
        return serviceRead.promise;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    let completionsPromise:
      | ReturnType<WorkbenchController["providePhpMethodCompletions"]>
      | null = null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(servicePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    serviceRead.resolve(`<?php
namespace App\\Services;

class CommentsService
{
    public function create(): string {}
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
  });

  it("stops stale PHP class source resolver fallback after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const symbolSearch =
      createDeferred<
        Awaited<
          ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>
        >
      >();
    const searchFiles = vi.fn(async () => []);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
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
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    let completionsPromise:
      | ReturnType<WorkbenchController["providePhpMethodCompletions"]>
      | null = null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsService", 50);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([]);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(searchFiles).not.toHaveBeenCalledWith(
      "/workspace-b",
      "CommentsService.php",
      40,
    );
  });

  it("stops stale PHP method completion traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace-a/app/Services/CommentsService.php";
    const workspaceBBaseServicePath =
      "/workspace-b/app/Services/BaseCommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const staleServiceRead = createDeferred<string>();
    let workspaceBBaseServiceReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === servicePath) {
        return staleServiceRead.promise;
      }

      if (path === workspaceBBaseServicePath) {
        workspaceBBaseServiceReadCount += 1;
        return "<?php\nnamespace App\\Services;\nclass BaseCommentsService {}\n";
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    let completionsPromise:
      | ReturnType<WorkbenchController["providePhpMethodCompletions"]>
      | null = null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(servicePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleServiceRead.resolve(`<?php
namespace App\\Services;

class CommentsService extends BaseCommentsService
{
    public function create(): string {}
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseServiceReadCount).toBe(0);
  });

  it("stops stale PHP method return type traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace-a/app/Repositories/CommentRepository.php";
    const workspaceBBaseRepositoryPath =
      "/workspace-b/app/Repositories/BaseCommentRepository.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        private readonly CommentRepository $comments,
    ) {}

    public function show(): void
    {
        $comment = $this->comments->findOrFail(1);
        $comment->get
    }
}
`;
    const staleRepositoryRead = createDeferred<string>();
    let workspaceBBaseRepositoryReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === repositoryPath) {
        return staleRepositoryRead.promise;
      }

      if (path === workspaceBBaseRepositoryPath) {
        workspaceBBaseRepositoryReadCount += 1;
        return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class BaseCommentRepository
{
    public function findOrFail(int $id): Comment {}
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    let completionsPromise:
      | ReturnType<WorkbenchController["providePhpMethodCompletions"]>
      | null = null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(readTextFile).toHaveBeenCalledWith(repositoryPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleRepositoryRead.resolve(`<?php
namespace App\\Repositories;

class CommentRepository extends BaseCommentRepository
{
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseRepositoryReadCount).toBe(0);
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
 * @phpstan-template T of object
 * @psalm-param class-string<T> $className
 * @phpstan-return T
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
     * @psalm-template T of object
     * @phpstan-param class-string<T> $className
     * @psalm-return T
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

  it("resolves implemented interface PHPDoc method returns on chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const publisherPath = "/workspace/app/Services/CommentPublisher.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publisher()->pub
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 10,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Services\\CommentPublisher",
          kind: "class",
          lineNumber: 5,
          name: "CommentPublisher",
          path: publisherPath,
          relativePath: "app/Services/CommentPublisher.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Services\\CommentPublisher;

/**
 * @method CommentPublisher publisher()
 */
interface PublishesComments
{
}
`;
        }

        if (path === publisherPath) {
          return `<?php
namespace App\\Services;

class CommentPublisher
{
    public function publishNow(): void {}
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
        positionAfter(controllerSource, "$comment->publisher()->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentPublisher",
        name: "publishNow",
        parameters: "",
        returnType: "void",
      },
    ]);
  });

  it("resolves implemented interface PHPDoc property types on chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const publisherPath = "/workspace/app/Services/CommentPublisher.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publisher->pub
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 10,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Services\\CommentPublisher",
          kind: "class",
          lineNumber: 5,
          name: "CommentPublisher",
          path: publisherPath,
          relativePath: "app/Services/CommentPublisher.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Services\\CommentPublisher;

/**
 * @property-read CommentPublisher $publisher
 */
interface PublishesComments
{
}
`;
        }

        if (path === publisherPath) {
          return `<?php
namespace App\\Services;

class CommentPublisher
{
    public function publishNow(): void {}
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
        positionAfter(controllerSource, "$comment->publisher->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentPublisher",
        name: "publishNow",
        parameters: "",
        returnType: "void",
      },
    ]);
  });

  it("resolves generic trait method returns through PHPDoc use", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const traitPath = "/workspace/app/Support/FindsModels.php";
    const commentPath = "/workspace/app/Models/Comment.php";
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
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 9,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Support\\FindsModels",
          kind: "trait",
          lineNumber: 7,
          name: "FindsModels",
          path: traitPath,
          relativePath: "app/Support/FindsModels.php",
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

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;
use App\\Support\\FindsModels;

/**
 * @use FindsModels<Comment>
 */
class CommentRepository
{
    use FindsModels;
}
`;
        }

        if (path === traitPath) {
          return `<?php
namespace App\\Support;

/**
 * @template TModel of object
 */
trait FindsModels
{
    /** @return TModel */
    public function findOrFail(int $id) {}
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
        positionAfter(controllerSource, "$this->commentRepository->find"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Support\\FindsModels",
        name: "findOrFail",
        parameters: "int $id",
        returnType: "App\\Models\\Comment",
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
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("resolves generic mixin method returns through PHPDoc mixin", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const mixinPath = "/workspace/app/Support/RepositoryMixin.php";
    const commentPath = "/workspace/app/Models/Comment.php";
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
        $comment = $this->commentRepository->findForDisplay(1);
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
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 10,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Support\\RepositoryMixin",
          kind: "class",
          lineNumber: 7,
          name: "RepositoryMixin",
          path: mixinPath,
          relativePath: "app/Support/RepositoryMixin.php",
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

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;
use App\\Support\\RepositoryMixin;

/**
 * @phpstan-mixin RepositoryMixin<Comment>
 */
class CommentRepository
{
}
`;
        }

        if (path === mixinPath) {
          return `<?php
namespace App\\Support;

/**
 * @template TModel of object
 */
class RepositoryMixin
{
    /** @return TModel */
    public function findForDisplay(int $id) {}
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
        positionAfter(controllerSource, "$this->commentRepository->find"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Support\\RepositoryMixin",
        name: "findForDisplay",
        parameters: "int $id",
        returnType: "App\\Models\\Comment",
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

  it("stops stale Laravel container binding search after switching project tabs", async () => {
    const controllerPath =
      "/workspace-a/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace-a/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath =
      "/workspace-a/app/Contracts/CommentRepositoryInterface.php";
    const repositoryPath =
      "/workspace-a/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
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
    const providerSource = `<?php
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
    const staleBindingSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "CommentRepositoryInterface::class"
        ? staleBindingSearch.promise
        : [],
    );
    let providerReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          providerReadCount += 1;
          return providerSource;
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
      searchText,
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

    const completions = getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$comment->force"),
    );
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith(
        "/workspace-a",
        "CommentRepositoryInterface::class",
        200,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleBindingSearch.resolve([
      {
        column: 26,
        lineNumber: 11,
        lineText:
          "        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);",
        path: providerPath,
        relativePath: "app/Providers/AppServiceProvider.php",
      },
    ]);

    await expect(completions).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(providerReadCount).toBe(0);
  });

  it("refreshes Laravel container binding completions after editing service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath =
      "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const eloquentRepositoryPath =
      "/workspace/app/Repositories/EloquentCommentRepository.php";
    const cachedRepositoryPath =
      "/workspace/app/Repositories/CachedCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const archivedCommentPath = "/workspace/app/Models/ArchivedComment.php";
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
        $comment->for
    }
}
`;
    const updatedControllerSource = controllerSource.replace(
      "$comment->for",
      "$comment->arc",
    );
    const eloquentProviderSource = `<?php
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
    const cachedProviderSource = `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\CachedCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, CachedCommentRepository::class);
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === providerPath) {
        return eloquentProviderSource;
      }

      if (path === repositoryInterfacePath) {
        return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
}
`;
      }

      if (path === eloquentRepositoryPath) {
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

      if (path === cachedRepositoryPath) {
        return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\ArchivedComment;

class CachedCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): ArchivedComment
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

      if (path === archivedCommentPath) {
        return `<?php
namespace App\\Models;

class ArchivedComment
{
    public function archive(): void
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
        positionAfter(controllerSource, "$comment->for"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(providerPath, "AppServiceProvider.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveDocument(cachedProviderSource);
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveDocument(updatedControllerSource);
    });
    expect(
      getWorkbench().openDocuments.find((document) => document.path === providerPath)
        ?.content,
    ).toBe(cachedProviderSource);

    await expect(
      getWorkbench().providePhpMethodCompletions(
        updatedControllerSource,
        positionAfter(updatedControllerSource, "$comment->arc"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\ArchivedComment",
        name: "archive",
        parameters: "",
        returnType: "void",
      },
    ]);
  });

  it("keeps Laravel repository completions stable during container binding warm-up", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath =
      "/workspace/app/Contracts/CommentLookupInterface.php";
    const repositoryPath =
      "/workspace/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentLookupInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentLookupInterface $commentRepository,
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

use App\\Contracts\\CommentLookupInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentLookupInterface::class, EloquentCommentRepository::class);
    }
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentLookupInterface
{
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentLookupInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentLookupInterface
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
      searchText: vi.fn(async (_root, query) => {
        if (query !== "CommentLookupInterface::class") {
          return [];
        }

        return [
          {
            column: 26,
            lineNumber: 11,
            lineText:
              "        $this->app->bind(CommentLookupInterface::class, EloquentCommentRepository::class);",
            path: providerPath,
            relativePath: "app/Providers/AppServiceProvider.php",
          },
        ];
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
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

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
use Kontentino\\Communication\\Enums\\CommentType;

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

    protected $attributes = [
        'is_visible' => true,
        'label' => 'draft',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
        'type' => CommentType::class,
    ];

    protected function casts(): array
    {
        return [
            'priority' => 'integer',
        ];
    }

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
        name: "is_visible",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "label",
        parameters: "",
        returnType: "string",
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
        name: "priority",
        parameters: "",
        returnType: "int",
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
        returnType: "Kontentino\\Communication\\Enums\\CommentType",
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

  it("infers model completions from untyped repository body terminal Eloquent finder returns", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
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
        $comment->

        $staticComment = $this->commentRepository->findStaticOrFail(1);
        $staticComment->get
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
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 7,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
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

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class CommentRepository
{
    public function findOrFail(int $id)
    {
        return Comment::query()->whereKey($id)->firstOrFail();
    }

    public function findStaticOrFail(int $id)
    {
        return Comment::findOrFail($id);
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

/**
 * @property string $body
 */
class Comment
{
    protected $fillable = ['content'];

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
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "body",
          parameters: "",
          returnType: "string",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "content",
          parameters: "",
          returnType: "mixed",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          name: "getContent",
          parameters: "",
          returnType: "string",
        },
      ]),
    );
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$staticComment->get"),
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

  it("offers implemented interface PHPDoc method completions on inferred receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->pub
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 7,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method void publish(bool $quietly = false)
 */
interface PublishesComments
{
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
        positionAfter(controllerSource, "$comment->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Contracts\\PublishesComments",
        name: "publish",
        parameters: "bool $quietly = false",
        returnType: "void",
      },
    ]);
  });

  it("offers returnless PHPDoc method completions on inferred receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/ArchivesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->arc
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\ArchivesComments",
          kind: "interface",
          lineNumber: 7,
          name: "ArchivesComments",
          path: interfacePath,
          relativePath: "app/Contracts/ArchivesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\ArchivesComments;

class Comment implements ArchivesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method archive(bool $quietly = false)
 */
interface ArchivesComments
{
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
        positionAfter(controllerSource, "$comment->arc"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Contracts\\ArchivesComments",
        name: "archive",
        parameters: "bool $quietly = false",
        returnType: null,
      },
    ]);
  });

  it("suppresses PHPDoc mixin member-method diagnostics on inferred receivers", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
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
        $comment->helpful();
        $comment->missingHelpful();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 23,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `$comment->${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
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
          relativePath:
            "app/Kontentino/src/Communication/Models/Comment.php",
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
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const helpfulPosition = methodDiagnosticPosition("helpful");
    const missingPosition = methodDiagnosticPosition("missingHelpful");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...helpfulPosition,
            message:
              "Method Kontentino\\Communication\\Models\\Comment::helpful() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Method Kontentino\\Communication\\Models\\Comment::missingHelpful() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message:
          "Method Kontentino\\Communication\\Models\\Comment::missingHelpful() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("suppresses implemented interface member-method diagnostics on inferred receivers", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const repositoryInterfacePath =
      "/workspace/app/Contracts/CommentRepositoryInterface.php";
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
        $this->commentRepository->findOrFail(1);
        $this->commentRepository->missingMethod();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 24,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(
        controllerSource,
        `$this->commentRepository->${methodName}`,
      );

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 6,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 5,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;

class CommentRepository implements CommentRepositoryInterface
{
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): object;
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

    const findPosition = methodDiagnosticPosition("findOrFail");
    const missingPosition = methodDiagnosticPosition("missingMethod");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...findPosition,
            message:
              "Method App\\Repositories\\CommentRepository::findOrFail() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Method App\\Repositories\\CommentRepository::missingMethod() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message:
          "Method App\\Repositories\\CommentRepository::missingMethod() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("stops stale PHP method hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->knownHook();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 36,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "knownHook");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public function knownHook(): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "knownHook".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message: "Method App\\Models\\Comment::knownHook() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(commentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
  });

  it("suppresses implemented interface PHPDoc method diagnostics on inferred receivers", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publish();
        $comment->archive();
        $comment->restore();
        $comment->missingPublish();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 27,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `$comment->${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 7,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method void publish()
 * @phpstan-method archive()
 * @psalm-method restore()
 */
interface PublishesComments
{
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

    const publishPosition = methodDiagnosticPosition("publish");
    const archivePosition = methodDiagnosticPosition("archive");
    const restorePosition = methodDiagnosticPosition("restore");
    const missingPosition = methodDiagnosticPosition("missingPublish");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...publishPosition,
            message:
              "Method App\\Models\\Comment::publish() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...archivePosition,
            message:
              "Method App\\Models\\Comment::archive() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...restorePosition,
            message: "Method App\\Models\\Comment::restore() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Method App\\Models\\Comment::missingPublish() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message:
          "Method App\\Models\\Comment::missingPublish() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("suppresses existing static-method diagnostics without hiding instance-only methods", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::make();
        CommentFactory::fromNamed('draft');
        CommentFactory::restoreBySlug('draft');
        CommentFactory::makeInstance();
        CommentFactory::missingStatic();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `CommentFactory::${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Factories\\CommentFactory",
          kind: "class",
          lineNumber: 8,
          name: "CommentFactory",
          path: factoryPath,
          relativePath: "app/Factories/CommentFactory.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === factoryPath) {
          return `<?php
namespace App\\Factories;

/**
 * @method static object fromNamed(string $name)
 * @psalm-method static restoreBySlug(string $slug)
 */
class CommentFactory
{
    public static function make(): object {}
    public function makeInstance(): object {}
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

    const makePosition = methodDiagnosticPosition("make");
    const fromNamedPosition = methodDiagnosticPosition("fromNamed");
    const restoreBySlugPosition = methodDiagnosticPosition("restoreBySlug");
    const makeInstancePosition = methodDiagnosticPosition("makeInstance");
    const missingPosition = methodDiagnosticPosition("missingStatic");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...makePosition,
            message:
              "Method App\\Factories\\CommentFactory::make() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...fromNamedPosition,
            message:
              "Method App\\Factories\\CommentFactory::fromNamed() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...restoreBySlugPosition,
            message:
              "Method App\\Factories\\CommentFactory::restoreBySlug() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...makeInstancePosition,
            message:
              "Method App\\Factories\\CommentFactory::makeInstance() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Method App\\Factories\\CommentFactory::missingStatic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...makeInstancePosition,
        message:
          "Method App\\Factories\\CommentFactory::makeInstance() does not exist",
        severity: "error",
        source: "phpactor",
      },
      {
        ...missingPosition,
        message:
          "Method App\\Factories\\CommentFactory::missingStatic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("stops stale PHP static method hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace-a/app/Factories/CommentFactory.php";
    const workspaceBBaseFactoryPath =
      "/workspace-b/app/Factories/BaseCommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::make();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 37,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleFactoryRead = createDeferred<string>();
    let factoryReadCount = 0;
    let workspaceBBaseFactoryReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "make");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === factoryPath) {
          factoryReadCount += 1;
          return staleFactoryRead.promise;
        }

        if (path === workspaceBBaseFactoryPath) {
          workspaceBBaseFactoryReadCount += 1;
          return `<?php
namespace App\\Factories;

class BaseCommentFactory
{
    public static function make(): object {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "make".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message:
              "Method App\\Factories\\CommentFactory::make() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(factoryReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleFactoryRead.resolve(`<?php
namespace App\\Factories;

class CommentFactory extends BaseCommentFactory
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseFactoryReadCount).toBe(0);
  });

  it("suppresses implemented interface PHPDoc property diagnostics on inferred receivers", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/HasExternalId.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
        $comment->slug;
        $comment->hidden;
        $comment->missingProperty;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const propertyDiagnosticPosition = (propertyName: string) => {
      const position = positionAfter(controllerSource, `$comment->${propertyName}`);

      return {
        character: position.column - propertyName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\HasExternalId",
          kind: "interface",
          lineNumber: 6,
          name: "HasExternalId",
          path: interfacePath,
          relativePath: "app/Contracts/HasExternalId.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\HasExternalId;

class Comment implements HasExternalId
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @property-read string $externalId
 * @phpstan-property-read string $slug
 * @psalm-property-write bool $hidden
 */
interface HasExternalId
{
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

    const externalIdPosition = propertyDiagnosticPosition("externalId");
    const slugPosition = propertyDiagnosticPosition("slug");
    const hiddenPosition = propertyDiagnosticPosition("hidden");
    const missingPosition = propertyDiagnosticPosition("missingProperty");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...externalIdPosition,
            message:
              "Property App\\Models\\Comment::$externalId does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...slugPosition,
            message: "Property App\\Models\\Comment::$slug does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...hiddenPosition,
            message: "Property App\\Models\\Comment::$hidden does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Property App\\Models\\Comment::$missingProperty does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message:
          "Property App\\Models\\Comment::$missingProperty does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("stops stale PHP property hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 38,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "externalId");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public string $externalId;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "externalId".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message: "Property App\\Models\\Comment::$externalId does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(commentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
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
use Illuminate\\Database\\Eloquent\\Relations\\Relation;
use Illuminate\\Database\\Eloquent\\Model;

/** @property-read \\Illuminate\\Database\\Eloquent\\Collection<int, User> $reviewers */
class Comment
{
    private const OWNER_MODEL = User::class;
    private const MORPH_MAP = [
        'user' => self::OWNER_MODEL,
    ];

    protected static function booted(): void
    {
        Relation::morphMap(self::MORPH_MAP);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Comment::class, 'parent_id');
    }

    public function localChildren(): HasMany
    {
        $related = Comment::class;
        return $this->hasMany($related, 'parent_id');
    }

    public function siblings(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(__CLASS__, 'parent_id');
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

    public function mappedOwner(): MorphTo
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

        $comment->localChildren()->first()->get

        $childFromProperty = $comment->children->first();
        $childFromProperty->get

        $requiredChildFromProperty = $comment->children->firstOrFail();
        $requiredChildFromProperty->get

        $sibling = $comment->siblings()->first();
        $sibling->get

        $loadedComment = $comment->load('children');
        $loadedComment->get

        $reply = $comment->replies()->first();
        $reply->get

        $filteredChildFromProperty = $comment->children->filter()->first();
        $filteredChildFromProperty->get

        $reviewer = $comment->reviewers->first();
        $reviewer->get

        $owner = $comment->documentedOwner;
        $owner->get

        $mappedOwner = $comment->mappedOwner()->first();
        $mappedOwner->get

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
        positionAfter(controllerSource, "$reply->get"),
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
        positionAfter(controllerSource, "$requiredChildFromProperty->get"),
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
        positionAfter(controllerSource, "$sibling->get"),
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
        positionAfter(controllerSource, "$loadedComment->get"),
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
        positionAfter(controllerSource, "$mappedOwner->get"),
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
        positionAfter(controllerSource, "$comment->localChildren()->first()->get"),
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

  it("infers Laravel enforced morph map completions from service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const userPath = "/workspace/app/Models/User.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const providerSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::enforceMorphMap([
            'user' => User::class,
        ]);
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
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

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          return providerSource;
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
      searchText: vi.fn(async (_root: string, query: string, _limit: number) =>
        query === "enforceMorphMap" ? [
          {
            column: 19,
            lineText: "        Relation::enforceMorphMap([",
            lineNumber: 10,
            path: providerPath,
            relativePath: "app/Providers/AppServiceProvider.php",
          },
        ] : [],
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
  });

  it("stops stale Laravel morph map search after switching project tabs", async () => {
    const controllerPath =
      "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const providerPath = "/workspace-a/app/Providers/AppServiceProvider.php";
    const userPath = "/workspace-a/app/Models/User.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const providerSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'user' => User::class,
        ]);
    }
}
`;
    const staleMorphMapSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root: string, query: string, _limit: number) =>
      query === "morphMap" ? staleMorphMapSearch.promise : [],
    );
    let providerReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
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

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          providerReadCount += 1;
          return providerSource;
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
      searchText,
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

    const completions = getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$owner->get"),
    );
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "morphMap", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleMorphMapSearch.resolve([
      {
        column: 19,
        lineNumber: 10,
        lineText: "        Relation::morphMap([",
        path: providerPath,
        relativePath: "app/Providers/AppServiceProvider.php",
      },
    ]);

    await expect(completions).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(providerReadCount).toBe(0);
  });

  it("refreshes Laravel morph map completions after editing service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const postPath = "/workspace/app/Models/Post.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const userPath = "/workspace/app/Models/User.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const userProviderSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'owner' => User::class,
        ]);
    }
}
`;
    const postProviderSource = `<?php
namespace App\\Providers;

use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'owner' => Post::class,
        ]);
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
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Post",
          kind: "class",
          lineNumber: 5,
          name: "Post",
          path: postPath,
          relativePath: "app/Models/Post.php",
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

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          return userProviderSource;
        }

        if (path === postPath) {
          return `<?php
namespace App\\Models;

class Post
{
    public function getTitle(): string {}
}
`;
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
      searchText: vi.fn(async (_root: string, query: string, _limit: number) =>
        query.includes("morphMap") ? [
          {
            column: 19,
            lineText: "        Relation::morphMap([",
            lineNumber: 10,
            path: providerPath,
            relativePath: "app/Providers/AppServiceProvider.php",
          },
        ] : [],
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

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(providerPath, "AppServiceProvider.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveDocument(postProviderSource);
    });
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("opens Laravel relation methods from relation-name strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

class Comment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        $comment->load('children.parent');
        Comment::with('parent')->first();
        Comment::query()->whereHas('children', fn ($query) => $query);
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

        if (path === commentPath) {
          return commentModelSource;
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
        positionAfter(controllerSource, "'children"),
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
        lineNumber: lineNumberOf(commentModelSource, "children"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "'parent"),
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
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
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
          "whereHas('children",
        ),
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
        lineNumber: lineNumberOf(commentModelSource, "children"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "children.parent"),
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
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
    });
  });

  it("stops stale Laravel relation string owner resolution after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBCommentPath = "/workspace-b/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

class Comment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('children.parent')->first();
    }
}
`;
    const staleOwnerRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleOwnerRead.promise;
        }

        if (path === workspaceBCommentPath) {
          workspaceBCommentReadCount += 1;
          return commentModelSource;
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
        positionAfter(controllerSource, "children.parent"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleOwnerRead.resolve(commentModelSource);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBCommentReadCount).toBe(0);
    expect(getWorkbench().activePath).not.toBe(workspaceACommentPath);
    expect(getWorkbench().activePath).not.toBe(workspaceBCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message).not.toBe(
      "No relation method found for App\\Models\\Comment::parent().",
    );
  });

  it("stops stale Laravel relation property owner traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('children.parent')->first();
    }
}
`;
    const staleOwnerRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleOwnerRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public function children()
    {
        return $this->hasMany(Comment::class);
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
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "children.parent"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleOwnerRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });

  it("opens Laravel relation methods from model property access", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        echo $comment->parent;
        echo $comment->content;
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

        if (path === commentPath) {
          return commentModelSource;
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
        positionAfter(controllerSource, "$comment->parent"),
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
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->content"),
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
        column: 10,
        lineNumber: lineNumberOf(commentModelSource, "'content'"),
      },
    });
  });

  it("completes Laravel relation strings from the owning model", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const attachmentPath = "/workspace/app/Models/Attachment.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('chi');
        $comment->load('children.pa');
        $comment->load('attachments.own');
        $comment->load(relations: 'child');
        Comment::with('par')->first();
        Comment::query()->whereHas('att', fn ($query) => $query);
        Comment::query()->whereHas(relation: 'attach', callback: fn ($query) => $query);
        Comment::query()->whereHas(callback: fn ($query) => $query, relation: 'attach');
        Comment::query()->whereRelation('children', 'is_vis', true);
    }
}
`;
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function attachments()
    {
        return $this->hasMany(Attachment::class);
    }

    public function content(): string
    {
        return '';
    }
}
`;
    const attachmentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Attachment extends Model
{
    public function owner()
    {
        return $this->belongsTo(User::class);
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

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === attachmentPath) {
          return attachmentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('chi"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "children",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('attachments.own"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Attachment",
        kind: "relation",
        name: "owner",
        parameters: "",
        returnType: "App\\Models\\User",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "load(relations: 'child"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "children",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::with('par"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "parent",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('children.pa"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "parent",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereHas('att"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereHas(relation: 'attach"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereHas(callback: fn ($query) => $query, relation: 'attach"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereRelation('children', 'is_vis"),
      ),
    ).resolves.toEqual([]);
  });

  it("stops stale Laravel relation string completion traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('par')->first();
    }
}
`;
    const commentModelSource = `<?php
namespace App\\Models;

class Comment extends BaseComment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }
}
`;
    const staleCommentRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return "<?php\nnamespace App\\Models;\nclass BaseComment {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });

    let completionsPromise: ReturnType<
      WorkbenchController["providePhpMethodCompletions"]
    > = Promise.resolve([]);
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::with('par"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(commentModelSource);

    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
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

    expect(getWorkbench().languageServerRuntimeStatus).toEqual({
      ...runningStatus,
      rootPath: "/workspace",
    });
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
        rootPath: "/workspace",
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

  it("stops stale PHP trait host-method search after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 40,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "SoftDeletes" ? staleTraitHostSearch.promise : [],
    );
    let commentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;

    protected function fireModelEvent(string $event): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
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
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "SoftDeletes", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 8,
        lineText: "    use SoftDeletes;",
        path: commentPath,
        relativePath: "app/Models/Comment.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(commentReadCount).toBe(0);
  });

  it("ignores stale PHP diagnostic filter errors after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const softDeletesPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 41,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "SoftDeletes" ? staleTraitHostSearch.promise : [],
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
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
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "SoftDeletes", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.reject(new Error("stale diagnostic filter"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale diagnostic filter"),
      ),
    ).toBe(false);
  });

  it("keeps trait host-method diagnostics when no host hierarchy provides the method", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const diagnostic = {
      character: 20,
      line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
      message:
        'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 19,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "SoftDeletes"
          ? [
              {
                column: 5,
                lineNumber: 8,
                lineText: "    use SoftDeletes;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
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
        diagnostics: [diagnostic],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toEqual(
      [diagnostic],
    );
  });

  it("suppresses app trait host-method diagnostics per confirmed method", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const baseModelPath = "/workspace/app/Models/BaseModel.php";
    const dispatchesEventsPath =
      "/workspace/app/Models/Concerns/DispatchesEvents.php";
    const dispatchesEventsSource = `<?php
namespace App\\Models\\Concerns;

trait DispatchesEvents
{
    public function dispatchSaved(): void
    {
        $this->knownHostHook();
        $this->missingHostHook();
    }
}
`;
    const missingDiagnostic = {
      character: 15,
      line: lineNumberOf(dispatchesEventsSource, "missingHostHook") - 1,
      message:
        'Method "missingHostHook" does not exist on trait "App\\Models\\Concerns\\DispatchesEvents"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 23,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\DispatchesEvents;

class Comment extends BaseModel
{
    use DispatchesEvents;
}
`;
        }

        if (path === baseModelPath) {
          return `<?php
namespace App\\Models;

class BaseModel
{
    protected function knownHostHook(): void
    {
    }
}
`;
        }

        if (path === dispatchesEventsPath) {
          return dispatchesEventsSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "DispatchesEvents"
          ? [
              {
                column: 5,
                lineNumber: 8,
                lineText: "    use DispatchesEvents;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
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
            character: 15,
            line: lineNumberOf(dispatchesEventsSource, "knownHostHook") - 1,
            message:
              'Method "knownHostHook" does not exist on trait "App\\Models\\Concerns\\DispatchesEvents"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(dispatchesEventsPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[dispatchesEventsPath],
    ).toEqual([missingDiagnostic]);
  });

  it("suppresses trait host-property diagnostics when a Laravel model host exposes the property", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const usesConnectionNamePath =
      "/workspace/app/Models/Concerns/UsesConnectionName.php";
    const usesConnectionNameSource = `<?php
namespace App\\Models\\Concerns;

trait UsesConnectionName
{
    public function connectionName(): mixed
    {
        return $this->connectionName;
    }

    public function missingConnectionName(): mixed
    {
        return $this->missingConnectionName;
    }
}
`;
    const missingDiagnostic = {
      character: 22,
      line:
        lineNumberOf(usesConnectionNameSource, "$this->missingConnectionName") -
        1,
      message:
        'Property "$missingConnectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 24,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\UsesConnectionName;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    use UsesConnectionName;

    protected $fillable = [
        'connectionName',
    ];
}
`;
        }

        if (path === usesConnectionNamePath) {
          return usesConnectionNameSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "UsesConnectionName"
          ? [
              {
                column: 5,
                lineNumber: 9,
                lineText: "    use UsesConnectionName;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
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
            character: 22,
            line:
              lineNumberOf(usesConnectionNameSource, "$this->connectionName") -
              1,
            message:
              'Property "$connectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(usesConnectionNamePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[usesConnectionNamePath],
    ).toEqual([missingDiagnostic]);
  });

  it("stops stale PHP trait host-property search after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const usesConnectionNamePath =
      "/workspace-a/app/Models/Concerns/UsesConnectionName.php";
    const usesConnectionNameSource = `<?php
namespace App\\Models\\Concerns;

trait UsesConnectionName
{
    public function connectionName(): mixed
    {
        return $this->connectionName;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 41,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "UsesConnectionName" ? staleTraitHostSearch.promise : [],
    );
    let commentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === usesConnectionNamePath) {
          return usesConnectionNameSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\UsesConnectionName;

class Comment
{
    use UsesConnectionName;

    protected $fillable = [
        'connectionName',
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
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
            character: 22,
            line:
              lineNumberOf(usesConnectionNameSource, "$this->connectionName") -
              1,
            message:
              'Property "$connectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(usesConnectionNamePath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith(
        "/workspace-a",
        "UsesConnectionName",
        200,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 8,
        lineText: "    use UsesConnectionName;",
        path: commentPath,
        relativePath: "app/Models/Comment.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(commentReadCount).toBe(0);
  });

  it("suppresses Laravel model attribute property diagnostics only when the property exists", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        $comment = Comment::query()->first();
        echo $comment->content;
        echo $comment->missing;
    }
}
`;
    const missingDiagnostic = {
      character: 23,
      line: lineNumberOf(controllerSource, "$comment->missing") - 1,
      message: 'Property "$missing" does not exist on class "App\\Models\\Comment"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 28,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];
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
            character: 23,
            line: lineNumberOf(controllerSource, "$comment->content") - 1,
            message:
              'Property "$content" does not exist on class "App\\Models\\Comment"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[controllerPath],
    ).toEqual([missingDiagnostic]);
  });

  it("suppresses static trait host-property diagnostics when the host declares the property", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const hostStatePath = "/workspace/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return static::$hostState;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    protected static string $hostState = 'ready';
}
`;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
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
            character: 24,
            line:
              lineNumberOf(resolvesHostStateSource, "static::$hostState") - 1,
            message:
              'Property "$hostState" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[resolvesHostStatePath],
    ).toEqual([]);
  });

  it("suppresses trait host-constant diagnostics when the host declares the constant", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const hostStatePath = "/workspace/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    private const HOST_STATE = 'ready';
}
`;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
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
            character: 24,
            line:
              lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(
      getWorkbench().languageServerDiagnosticsByPath[resolvesHostStatePath],
    ).toEqual([]);
  });

  it("stops stale PHP trait host-constant search after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const hostStatePath = "/workspace-a/app/Support/HostState.php";
    const resolvesHostStatePath =
      "/workspace-a/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 42,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "ResolvesHostState" ? staleTraitHostSearch.promise : [],
    );
    let hostStateReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        if (path === hostStatePath) {
          hostStateReadCount += 1;
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    private const HOST_STATE = 'ready';
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
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
            character: 24,
            line:
              lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(searchText).toHaveBeenCalledWith(
        "/workspace-a",
        "ResolvesHostState",
        200,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 6,
        lineText: "    use ResolvesHostState;",
        path: hostStatePath,
        relativePath: "app/Support/HostState.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(hostStateReadCount).toBe(0);
  });

  it("stops stale PHP constant hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const hostStatePath = "/workspace-a/app/Support/HostState.php";
    const resolvesHostStatePath =
      "/workspace-a/app/Support/ResolvesHostState.php";
    const workspaceBBaseHostStatePath =
      "/workspace-b/app/Support/BaseHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const hostStateSource = `<?php
namespace App\\Support;

class HostState extends BaseHostState
{
    use ResolvesHostState;
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 39,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleHostHierarchyRead = createDeferred<string>();
    let hostStateReadCount = 0;
    let workspaceBBaseHostStateReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          hostStateReadCount += 1;
          return hostStateReadCount === 2
            ? staleHostHierarchyRead.promise
            : hostStateSource;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        if (path === workspaceBBaseHostStatePath) {
          workspaceBBaseHostStateReadCount += 1;
          return `<?php
namespace App\\Support;

class BaseHostState
{
    private const HOST_STATE = 'ready';
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
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
            character: 24,
            line:
              lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await vi.waitFor(() => {
      expect(hostStateReadCount).toBe(2);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleHostHierarchyRead.resolve(hostStateSource);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseHostStateReadCount).toBe(0);
  });

  it("suppresses trait host-method diagnostics through an intermediate trait and parent method", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const concernPath = "/workspace/app/Models/Concerns/HasSoftDeletes.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 20,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\HasSoftDeletes;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    use HasSoftDeletes;
}
`;
        }

        if (path === concernPath) {
          return `<?php
namespace App\\Models\\Concerns;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

trait HasSoftDeletes
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
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) => {
        if (query === "SoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 8,
              lineText: "    use SoftDeletes;",
              path: concernPath,
              relativePath: "app/Models/Concerns/HasSoftDeletes.php",
            },
          ];
        }

        if (query === "HasSoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 9,
              lineText: "    use HasSoftDeletes;",
              path: commentPath,
              relativePath: "app/Models/Comment.php",
            },
          ];
        }

        return [];
      }),
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
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
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

  it("suppresses trait host-method diagnostics when a descendant provides the method", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const baseModelPath = "/workspace/app/Models/BaseModel.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 21,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === baseModelPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class BaseModel
{
    use SoftDeletes;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment extends BaseModel
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) => {
        if (query === "SoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 8,
              lineText: "    use SoftDeletes;",
              path: baseModelPath,
              relativePath: "app/Models/BaseModel.php",
            },
          ];
        }

        if (query === "BaseModel") {
          return [
            {
              column: 23,
              lineNumber: 4,
              lineText: "class Comment extends BaseModel",
              path: commentPath,
              relativePath: "app/Models/Comment.php",
            },
          ];
        }

        return [];
      }),
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
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
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

  it("suppresses trait host-method diagnostics reported with a short trait name", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
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
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 22,
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
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

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
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "SoftDeletes"
          ? [
              {
                column: 5,
                lineNumber: 9,
                lineText: "    use SoftDeletes;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
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
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
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
        Album::popular()->first();
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
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;

class Album
{
    public function scopePublished(Builder $query): Builder
    {
        return $query;
    }

    #[Scope]
    protected function popular(Builder $query): void
    {
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
            message: "Method App\\Models\\Album::popular() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: 11,
            message: "Method App\\Models\\Album::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: 11,
        message: "Method App\\Models\\Album::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("keeps local-scope diagnostics in plain Composer projects", async () => {
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
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 15,
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

class Album
{
    public function scopePublished($query)
    {
        return $query;
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "custom/api",
        packages: [],
      }),
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
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: 9,
        message: "Method App\\Models\\Album::published() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("suppresses builder local-scope diagnostics only when the inferred model defines the scope", async () => {
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
        Album::query()->withRelations()->first();
        Album::query()->missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 14,
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
    public function scopeWithRelations(Builder $query): Builder
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
            character: 25,
            line: 9,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 25,
            line: 10,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 25,
        line: 10,
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("suppresses builder local-scope diagnostics through generic repository returns", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const repositoryPath = "/workspace/app/Repositories/AlbumRepository.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\AlbumRepository;

class AlbumController
{
    public function index(AlbumRepository $albums): void
    {
        $query = $albums->query();
        $query->withRelations()->first();
        $query->missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 17,
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
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\AlbumRepository",
          kind: "class",
          lineNumber: 8,
          name: "AlbumRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/AlbumRepository.php",
        },
      ],
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

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Builder;

class AlbumRepository
{
    /** @psalm-return Builder<Album> */
    public function query(): Builder {}
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

    const scopeLine =
      positionAfter(controllerSource, "$query->withRelations").lineNumber - 1;
    const missingLine =
      positionAfter(controllerSource, "$query->missingMagic").lineNumber - 1;

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 16,
            line: scopeLine,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: missingLine,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: missingLine,
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("exposes Laravel dynamic where helpers from model attributes", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereCon
        Comment::whereContent(

        $foundComment = Comment::whereContent('hello')->first();
        $foundComment->getC
        $foundComment->full_name;

        $query = Comment::query();
        $query->whereIsP
        $query->whereIsPinned(true)->ord

        Comment::missingDynamic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 13,
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

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    public function getContent(): string {}

    public function getFullNameAttribute(): string
    {
        return '';
    }
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
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
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
        positionAfter(controllerSource, "Comment::whereCon"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        name: "whereContent",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Comment::whereContent("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        name: "whereContent",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$value",
          optional: false,
          raw: "$value",
          type: null,
        },
      ],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereIsP"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "whereIsPinned",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$foundComment->getC"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereIsPinned(true)->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);

    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Comment::whereContent"),
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
        column: 10,
        lineNumber: 7,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$query->whereIsPinned"),
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
        column: 10,
        lineNumber: 11,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$foundComment->full_name"),
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
        lineNumber: 16,
      },
    });

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: 10,
            message: "Method App\\Models\\Comment::whereContent() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 24,
            line: lineNumberOf(controllerSource, "Comment::missingDynamic") - 1,
            message:
              "Method App\\Models\\Comment::missingDynamic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 24,
        line: lineNumberOf(controllerSource, "Comment::missingDynamic") - 1,
        message: "Method App\\Models\\Comment::missingDynamic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("does not expose Laravel dynamic where helpers in plain Composer projects", async () => {
    let diagnosticsListener:
      | ((event: LanguageServerDiagnosticEvent) => void)
      | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereCon
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 14,
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

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "custom/api",
        packages: [],
      }),
    });
    await flushAsyncTurns(24);
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
        positionAfter(controllerSource, "Comment::whereCon"),
      ),
    ).resolves.toEqual([]);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: 10,
            message: "Method App\\Models\\Comment::whereContent() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 24,
        line: 10,
        message: "Method App\\Models\\Comment::whereContent() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });

  it("keeps Laravel Eloquent builder generics through fluent chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumCollectionPath = "/workspace/app/Collections/AlbumCollection.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const albumRepositoryPath = "/workspace/app/Repositories/AlbumRepository.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;
use App\\Models\\Album;
use App\\Repositories\\AlbumRepository;

class AlbumController
{
    public function index(Album $existingAlbum, AlbumRepository $albums): void
    {
        $album = Album::query()->whereNull('parent_id')->first();
        $album->get

        $multilineAlbum = Album::query()
            ->whereNull('parent_id')
            ->first();
        $multilineAlbum->get

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

        $repositoryQuery = $albums->query();
        $repositoryQuery->pub
        $repositoryQuery->published()->ord
        $repositoryAlbum = $albums->query()->published()->first();
        $repositoryAlbum->get

        $repositoryCollectionAlbum = $albums->matching()->first();
        $repositoryCollectionAlbum->get

        $repositoryBodyQuery = $albums->queryFromBody();
        $repositoryBodyQuery->published()->ord

        $repositoryBodyCollectionAlbum = $albums->matchingFromBody()->first();
        $repositoryBodyCollectionAlbum->get

        /** @var Result<Album> $result */
        $resultAlbum = $result->first();
        $resultAlbum->get

        /** @var Paginator<Album> $paginator */
        $paginatorAlbum = $paginator->first();
        $paginatorAlbum->get
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
          fullyQualifiedName: "App\\Repositories\\AlbumRepository",
          kind: "class",
          lineNumber: 8,
          name: "AlbumRepository",
          path: albumRepositoryPath,
          relativePath: "app/Repositories/AlbumRepository.php",
        },
      ],
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

        if (path === albumRepositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Collection;

class AlbumRepository
{
    /** @return Builder<Album> */
    public function query(): Builder {}

    public function matching(): Collection {}

    public function queryFromBody()
    {
        return Album::query()->published();
    }

    public function matchingFromBody()
    {
        return Album::query()->published()->get()->filter();
    }
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
        positionAfter(controllerSource, "$multilineAlbum->get"),
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
        positionAfter(controllerSource, "$repositoryQuery->pub"),
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
        positionAfter(controllerSource, "$repositoryQuery->published()->ord"),
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
        positionAfter(controllerSource, "$repositoryAlbum->get"),
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
        positionAfter(controllerSource, "$repositoryCollectionAlbum->get"),
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
        positionAfter(controllerSource, "$repositoryBodyQuery->published()->ord"),
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
        positionAfter(controllerSource, "$repositoryBodyCollectionAlbum->get"),
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
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$resultAlbum->get"),
      ),
    ).resolves.toEqual([]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$paginatorAlbum->get"),
      ),
    ).resolves.toEqual([]);
  });

  it("stops stale PHP collection model type traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AlbumController.php";
    const collectionPath = "/workspace-a/app/Collections/AlbumCollection.php";
    const workspaceBBaseCollectionPath =
      "/workspace-b/app/Collections/BaseAlbumCollection.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $customAlbums */
        $customAlbum = $customAlbums->first();
        $customAlbum->get
    }
}
`;
    const staleCollectionRead = createDeferred<string>();
    let collectionReadCount = 0;
    let workspaceBBaseCollectionReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === collectionPath) {
          collectionReadCount += 1;
          return staleCollectionRead.promise;
        }

        if (path === workspaceBBaseCollectionPath) {
          workspaceBBaseCollectionReadCount += 1;
          return `<?php
namespace App\\Collections;

/** @phpstan-extends \\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album> */
class BaseAlbumCollection
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "AlbumController.php"),
      );
    });

    let completionsPromise:
      | ReturnType<WorkbenchController["providePhpMethodCompletions"]>
      | null = null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$customAlbum->get"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(collectionReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCollectionRead.resolve(`<?php
namespace App\\Collections;

class AlbumCollection extends BaseAlbumCollection
{
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCollectionReadCount).toBe(0);
  });

  it("infers Laravel relation query callback builders", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const artistPath = "/workspace/app/Models/Artist.php";
    const postPath = "/workspace/app/Models/Post.php";
    const trackPath = "/workspace/app/Models/Track.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;
use App\\Models\\Post;

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

        Album::query()->with(['tracks.artist' => function ($artistQuery): void {
            $artistQuery->pub
            $artistQuery->published()->ord
            $artist = $artistQuery->first();
            $artist->get
        }]);

        Album::query()->whereHasMorph('commentable', [Post::class], function ($morphQuery): void {
            $morphQuery->pub
            $morphQuery->published()->ord
            $post = $morphQuery->first();
            $post->get
        });

        Album::query()->when($flag, function ($whenQuery): void {
            $whenQuery->pub
            $whenQuery->published()->ord
            $whenAlbum = $whenQuery->first();
            $whenAlbum->get
        });

        Album::query()->unless($flag, function ($unlessQuery): void {
            $unlessQuery->pub
            $unlessQuery->published()->ord
            $unlessAlbum = $unlessQuery->first();
            $unlessAlbum->get
        });

        Album::query()->tap(function ($tapQuery): void {
            $tapQuery->pub
            $tapQuery->published()->ord
            $tapAlbum = $tapQuery->first();
            $tapAlbum->get
        });
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
          fullyQualifiedName: "App\\Models\\Artist",
          kind: "class",
          lineNumber: 7,
          name: "Artist",
          path: artistPath,
          relativePath: "app/Models/Artist.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Post",
          kind: "class",
          lineNumber: 7,
          name: "Post",
          path: postPath,
          relativePath: "app/Models/Post.php",
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

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Album
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}

    public function tracks(): HasMany
    {
        $related = Track::class;
        return $this->hasMany($related);
    }

    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
        }

        if (path === artistPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Artist
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}
}
`;
        }

        if (path === postPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}
}
`;
        }

        if (path === trackPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Track
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}

    public function artist(): BelongsTo
    {
        return $this->belongsTo(Artist::class);
    }
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
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$morphQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$artistQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Artist",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$artistQuery->published()->ord"),
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
        positionAfter(controllerSource, "$artist->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Artist",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$morphQuery->published()->ord"),
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
        positionAfter(controllerSource, "$post->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$whenQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$whenQuery->published()->ord"),
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
        positionAfter(controllerSource, "$whenAlbum->get"),
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
        positionAfter(controllerSource, "$unlessQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$unlessQuery->published()->ord"),
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
        positionAfter(controllerSource, "$unlessAlbum->get"),
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
        positionAfter(controllerSource, "$tapQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$tapQuery->published()->ord"),
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
        positionAfter(controllerSource, "$tapAlbum->get"),
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

  it("opens Laravel model scopes and builder magic methods", async () => {
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
        Album::published()->findOrFail(1);
        $query = Album::query();
        $query->published()->first();
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
    public function scopePublished(Builder $query): Builder
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
        positionAfter(controllerSource, "Album::published"),
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
        positionAfter(controllerSource, "$query->published"),
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

  it("opens PHPDoc magic method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::fromNamed('draft');
        CommentFactory::findForSlug('draft');
        CommentFactory::activeComments();
        CommentFactory::archiveQuietly('draft');
        CommentFactory::restoreBySlug('draft');
    }
}
`;
    const factorySource = `<?php
namespace App\\Factories;

/**
 * @method static object fromNamed(string $name)
 * @method static findForSlug(string $slug)
 * @method static \\Illuminate\\Support\\Collection<int, Comment> activeComments()
 * @phpstan-method static bool archiveQuietly(string $slug)
 * @psalm-method static restoreBySlug(string $slug)
 */
class CommentFactory
{
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

        if (path === factoryPath) {
          return factorySource;
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
        positionAfter(controllerSource, "CommentFactory::fromNamed"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: 26,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::findForSlug"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: 19,
        lineNumber: lineNumberOf(factorySource, "findForSlug"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::activeComments"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const activeCommentsPosition = positionAfter(factorySource, "activeComments");
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: activeCommentsPosition.column - "activeComments".length,
        lineNumber: activeCommentsPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::archiveQuietly"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const archiveQuietlyPosition = positionAfter(
      factorySource,
      "archiveQuietly",
    );
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: archiveQuietlyPosition.column - "archiveQuietly".length,
        lineNumber: archiveQuietlyPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::restoreBySlug"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const restoreBySlugPosition = positionAfter(factorySource, "restoreBySlug");
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: restoreBySlugPosition.column - "restoreBySlug".length,
        lineNumber: restoreBySlugPosition.lineNumber,
      },
    });
  });

  it("opens implemented interface PHPDoc magic method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publish();
        $comment->missingPublish();
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
    const interfaceSource = `<?php
namespace App\\Contracts;

/**
 * @method void publish()
 */
interface PublishesComments
{
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

        if (path === commentPath) {
          return commentSource;
        }

        if (path === interfacePath) {
          return interfaceSource;
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
        positionAfter(controllerSource, "$comment->publish"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: 17,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->missingPublish"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
  });

  it("opens PHPDoc magic property definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/HasExternalId.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
        $comment->slug;
        $comment->hidden;
        $comment->missingProperty;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

use App\\Contracts\\HasExternalId;

class Comment implements HasExternalId
{
}
`;
    const interfaceSource = `<?php
namespace App\\Contracts;

/**
 * @property-read string $externalId
 * @phpstan-property-read string $slug
 * @psalm-property-write bool $hidden
 */
interface HasExternalId
{
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

        if (path === commentPath) {
          return commentSource;
        }

        if (path === interfacePath) {
          return interfaceSource;
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
        positionAfter(controllerSource, "$comment->externalId"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: 27,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->slug"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const slugPosition = positionAfter(interfaceSource, "$slug");
    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: slugPosition.column - "slug".length,
        lineNumber: slugPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->hidden"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const hiddenPosition = positionAfter(interfaceSource, "$hidden");
    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: hiddenPosition.column - "hidden".length,
        lineNumber: hiddenPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->missingProperty"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
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

  it("suggests model methods from repository interface naming when return types are unavailable", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
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
      async (_root: string, query: string): Promise<FileSearchResult[]> =>
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
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });

  it("suggests Laravel model attributes from repository interface naming when return types are unavailable", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
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
    }
}
`;
    const searchFiles = vi.fn(
      async (_root: string, query: string): Promise<FileSearchResult[]> =>
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

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    protected $fillable = [
        'account_id',
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
    ];

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
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
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
          name: "getContent",
          parameters: "",
          returnType: "string",
        },
      ]),
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

  it("resolves Laravel controller group route action strings before LSP fallback", async () => {
    const routesPath = "/workspace/routes/comments.php";
    const commentControllerPath =
      "/workspace/app/Http/Controllers/communication/CommentController.php";
    const routesSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::prefix('admin/comments')->controller(controller: CommentController::class)->group(function () {
    Route::get(action: 'show', uri: '/comments/{comment}');
    Route::post('/comments', 'store');
});
`;
    const languageServerFeaturesGateway = featuresGateway();
    const projectSymbols: ProjectSymbolSearchResult[] = [
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
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\CommentController",
        fullyQualifiedName:
          "App\\Http\\Controllers\\communication\\CommentController::show",
        kind: "method",
        lineNumber: 8,
        name: "show",
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
          return routesSource;
        }

        return `<?php
namespace App\\Http\\Controllers\\communication;

final class CommentController
{
    public function store(): void
    {
    }

    public function show(): void
    {
    }
}
`;
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
      getWorkbench().updateActiveEditorPosition(
        positionAfter(routesSource, "'show"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).toHaveBeenCalledWith("/workspace", "show", 50);
    expect(getWorkbench().activePath).toBe(commentControllerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentControllerPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });
  });

  it("suggests Laravel named routes inside route helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const apiRoutesPath = "/workspace/routes/api.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
Route::get('/comments', [CommentController::class, 'index'])
    ->name('comments.index');
`;
        }

        if (path === apiRoutesPath) {
          return `<?php
Route::post('/comments', [CommentController::class, 'store'])
    ->name('comments.store');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.store');",
                path: apiRoutesPath,
                relativePath: "routes/api.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes inside named route helper arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route(name: 'comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes from named route group attributes", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function dashboard(): string
    {
        return route('admin.dash');
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

        if (path === routesPath) {
          return `<?php
Route::group(attributes: ['as' => 'admin.'], routes: function () {
    Route::get('/dashboard', [CommentController::class, 'dashboard'])
        ->name('dashboard');
});
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 9,
                lineNumber: 4,
                lineText: "        ->name('dashboard');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "admin.dash"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "dashboard",
        kind: "route",
        name: "admin.dashboard",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes from named route definition arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name(name: 'comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name(name: 'comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes from legacy route action arrays", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function index(): string
    {
        return route('comments.in');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments', ['as' => 'comments.index', 'uses' => CommentController::class]);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "'as' =>"
          ? [
              {
                column: 24,
                lineNumber: 2,
                lineText:
                  "Route::get('/comments', ['as' => 'comments.index', 'uses' => CommentController::class]);",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.in"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "index",
        kind: "route",
        name: "comments.index",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes inside Redirect facade route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function preview(): mixed
    {
        return Redirect::route('comments.pre');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/preview', [CommentController::class, 'preview'])
    ->name('comments.preview');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.preview');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.pre"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "preview",
        kind: "route",
        name: "comments.preview",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes inside signed URL route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function unsubscribe(): mixed
    {
        return URL::temporarySignedRoute('comments.uns', now()->addHour());
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/unsubscribe', [CommentController::class, 'unsubscribe'])
    ->name('comments.unsubscribe');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.unsubscribe');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.uns"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "unsubscribe",
        kind: "route",
        name: "comments.unsubscribe",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes inside Uri route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function uri(): mixed
    {
        return Uri::route('comments.ur');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/uri', [CommentController::class, 'uri'])
    ->name('comments.uri');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.uri');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.ur"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "uri",
        kind: "route",
        name: "comments.uri",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel named routes inside signed redirect route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function expiringPreview(): mixed
    {
        return redirect()->temporarySignedRoute('comments.pre', now()->addHour());
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/preview', [CommentController::class, 'expiringPreview'])
    ->name('comments.preview');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.preview');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.pre"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "preview",
        kind: "route",
        name: "comments.preview",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel resource route names from resource-only route files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function edit(): string
    {
        return route('comments.ed');
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

        if (path === routesPath) {
          return `<?php
Route::resource(name: 'comments', controller: CommentController::class)
    ->only(only: ['edit']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::resource"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText:
                  "Route::resource(name: 'comments', controller: CommentController::class)",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.ed"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "edit",
        kind: "route",
        name: "comments.edit",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel singleton route names from singleton-only route files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/ProfileController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class ProfileController
{
    public function show(): string
    {
        return route('profile.sh');
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

        if (path === routesPath) {
          return `<?php
Route::singleton(name: 'profile', controller: ProfileController::class);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::singleton"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText:
                  "Route::singleton(name: 'profile', controller: ProfileController::class);",
                path: routesPath,
                relativePath: "routes/web.php",
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
        fileEntry(controllerPath, "ProfileController.php"),
      );
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "profile.sh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "profile.show",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("suggests Laravel resource route name overrides from named arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function edit(): string
    {
        return route('comments.mo');
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

        if (path === routesPath) {
          return `<?php
Route::resource(name: 'comments', controller: CommentController::class)
    ->only(only: ['edit'])
    ->names(names: ['edit' => 'comments.modify']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::resource"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText:
                  "Route::resource(name: 'comments', controller: CommentController::class)",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.mo"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "routes/web.php",
        insertText: "modify",
        kind: "route",
        name: "comments.modify",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("opens Laravel named route definitions before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.show');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 1,
      },
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
            ]
          : [],
      ),
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
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "comments.show"),
      );
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(routesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: routesPath,
      position: {
        column: 13,
        lineNumber: 3,
      },
    });
  });

  it("drops stale Laravel named route definition targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace-a/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.show');
    }
}
`;
    const staleRoutesRead = createDeferred<string>();
    let routesReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === routesPath) {
          routesReadCount += 1;
          return staleRoutesRead.promise;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
            ]
          : [],
      ),
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
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "comments.show"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(routesReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleRoutesRead.resolve(`<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(routesPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
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

  it("opens the only indexed PHP implementation when the language server is unavailable", async () => {
    const interfacePath = "/workspace/app/Contracts/PlatformAdapter.php";
    const facebookAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const billingAdapterPath = "/workspace/app/Billing/InvoiceAdapter.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementation = vi.fn(async () => []);
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: facebookAdapterPath,
        relativePath:
          "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
      {
        column: 21,
        containerName: "App\\Billing\\InvoiceAdapter",
        fullyQualifiedName: "App\\Billing\\InvoiceAdapter::getPlatform",
        kind: "method",
        lineNumber: 5,
        name: "getPlatform",
        path: billingAdapterPath,
        relativePath: "app/Billing/InvoiceAdapter.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === facebookAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

use App\\Contracts\\PlatformAdapter;

final class FacebookAdapterService implements PlatformAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        if (path === billingAdapterPath) {
          return `<?php
namespace App\\Billing;

final class InvoiceAdapter
{
    public function getPlatform()
    {
    }
}
`;
        }

        return "<?php\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(interfacePath, "PlatformAdapter.php"),
      );
    });

    await act(async () => {
      await getWorkbench().goToImplementationAt(
        positionAfter(interfaceSource, "getPlatform"),
      );
    });

    expect(implementation).not.toHaveBeenCalled();
    expect(getWorkbench().implementationChooser).toBe(null);
    expect(getWorkbench().activePath).toBe(facebookAdapterPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: facebookAdapterPath,
      position: {
        column: 21,
        lineNumber: 10,
      },
    });
  });

  it("drops stale indexed PHP implementation results after switching project tabs", async () => {
    const interfacePath = "/workspace-a/app/Contracts/PlatformAdapter.php";
    const implementationPath =
      "/workspace-a/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementationSource = `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

use App\\Contracts\\PlatformAdapter;

final class FacebookAdapterService implements PlatformAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
    const symbolSearch = createDeferred<ProjectSymbolSearchResult[]>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === interfacePath) {
        return interfaceSource;
      }

      if (path === implementationPath) {
        return implementationSource;
      }

      return `<?php\n// ${path}\n`;
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(interfacePath, "PlatformAdapter.php"),
      );
    });

    let implementationPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      implementationPromise = getWorkbench().goToImplementationAt(
        positionAfter(interfaceSource, "getPlatform"),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "getPlatform", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    symbolSearch.resolve([
      {
        column: 21,
        containerName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: implementationPath,
        relativePath:
          "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
    ]);
    await act(async () => {
      await implementationPromise;
    });

    expect(readTextFile).not.toHaveBeenCalledWith(implementationPath);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(implementationPath);
    expect(getWorkbench().implementationChooser).toBe(null);
  });

  it("shows a chooser for multiple indexed PHP implementations when the language server returns no targets", async () => {
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
    const implementation = vi.fn(async () => []);
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Services\\Analytics\\Adapters\\BaseAdapter",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\BaseAdapter::getPlatform",
        kind: "method",
        lineNumber: 9,
        name: "getPlatform",
        path: baseAdapterPath,
        relativePath: "app/Services/Analytics/Adapters/BaseAdapter.php",
      },
      {
        column: 21,
        containerName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: facebookAdapterPath,
        relativePath:
          "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
      {
        column: 21,
        containerName: "App\\Billing\\InvoiceAdapter",
        fullyQualifiedName: "App\\Billing\\InvoiceAdapter::getPlatform",
        kind: "method",
        lineNumber: 5,
        name: "getPlatform",
        path: "/workspace/app/Billing/InvoiceAdapter.php",
        relativePath: "app/Billing/InvoiceAdapter.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === baseAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters;

use App\\Contracts\\PlatformAdapter;

abstract class BaseAdapter implements PlatformAdapter
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

use App\\Services\\Analytics\\Adapters\\BaseAdapter;

final class FacebookAdapterService extends BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        return `<?php
final class InvoiceAdapter
{
    public function getPlatform()
    {
    }
}
`;
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(interfacePath, "PlatformAdapter.php"),
      );
    });

    await act(async () => {
      await getWorkbench().goToImplementationAt(
        positionAfter(interfaceSource, "getPlatform"),
      );
    });

    expect(implementation).toHaveBeenCalledWith("/workspace", {
      character: 31,
      line: 6,
      path: interfacePath,
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
  });

  function renderController({
    appSettings = defaultAppSettings(),
    gitGateway,
    javaScriptTypeScriptInitialRuntimeStatus = { kind: "stopped" as const },
    indexProgressGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatus = { kind: "stopped" as const },
    languageServerGateway,
    languageServerPlan,
    languageServerDiagnosticsGateway,
    languageServerFeaturesGateway,
    languageServerRuntimeGateway,
    phpToolGateway,
    projectSymbols = [],
    readDirectory,
    readTextFile = vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    runtimeStatus = { kind: "stopped" as const },
    searchFiles = vi.fn(async () => []),
    searchText,
    settingsGateway,
    smartModeGateway,
    workspaceDetectionGateway,
    workspaceDescriptor,
    workspaceRuntimeLifecycleGateway,
    workspaceSettings = defaultWorkspaceSettings(),
    workspaceTrustGateway,
  }: {
    appSettings?: ReturnType<typeof defaultAppSettings>;
    gitGateway?: GitGateway;
    indexProgressGateway?: IndexProgressGateway;
    javaScriptTypeScriptInitialRuntimeStatus?: LanguageServerRuntimeStatus;
    javaScriptTypeScriptLanguageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
    javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
    javaScriptTypeScriptLanguageServerPlan?: LanguageServerPlan;
    javaScriptTypeScriptLanguageServerRuntimeGateway?: LanguageServerRuntimeGateway;
    javaScriptTypeScriptRuntimeStatus?: LanguageServerRuntimeStatus;
    languageServerGateway?: LanguageServerGateway;
    languageServerPlan?: LanguageServerPlan;
    languageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
    languageServerFeaturesGateway?: LanguageServerFeaturesGateway;
    languageServerRuntimeGateway?: LanguageServerRuntimeGateway;
    phpToolGateway?: WorkbenchWorkspaceGateways["phpTools"];
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
    settingsGateway?: SettingsGateway;
    smartModeGateway?: SmartModeGateway;
    workspaceDetectionGateway?: WorkbenchWorkspaceGateways["detection"];
    workspaceDescriptor?: WorkspaceDescriptor;
    workspaceRuntimeLifecycleGateway?: WorkspaceRuntimeLifecycleGateway;
    workspaceSettings?: ReturnType<typeof defaultWorkspaceSettings>;
    workspaceTrustGateway?: WorkspaceTrustGateway;
  } = {}) {
    let workbench: WorkbenchController | null = null;
    const dependencies = createControllerDependencies({
      appSettings,
      gitGateway,
      indexProgressGateway,
      javaScriptTypeScriptInitialRuntimeStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus,
      languageServerGateway,
      languageServerPlan,
      languageServerDiagnosticsGateway,
      languageServerFeaturesGateway,
      languageServerRuntimeGateway,
      phpToolGateway,
      projectSymbols,
      readDirectory,
      readTextFile,
      runtimeStatus,
      searchFiles,
      searchText,
      settingsGateway,
      smartModeGateway,
      workspaceDetectionGateway,
      workspaceDescriptor,
      workspaceRuntimeLifecycleGateway,
      workspaceSettings,
      workspaceTrustGateway,
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
    dependencies.workspaceRuntimeLifecycleGateway,
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
  indexProgressGateway,
  javaScriptTypeScriptInitialRuntimeStatus,
  javaScriptTypeScriptLanguageServerDiagnosticsGateway,
  javaScriptTypeScriptLanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerPlan,
  javaScriptTypeScriptLanguageServerRuntimeGateway,
  javaScriptTypeScriptRuntimeStatus,
  languageServerGateway,
  languageServerPlan,
  languageServerFeaturesGateway,
  languageServerDiagnosticsGateway,
  languageServerRuntimeGateway,
  phpToolGateway,
  projectSymbols,
  readDirectory,
  readTextFile,
  runtimeStatus,
  searchFiles,
  searchText,
  settingsGateway,
  smartModeGateway,
  workspaceDetectionGateway,
  workspaceDescriptor,
  workspaceRuntimeLifecycleGateway,
  workspaceSettings,
  workspaceTrustGateway,
}: {
  appSettings: ReturnType<typeof defaultAppSettings>;
  gitGateway?: GitGateway;
  indexProgressGateway?: IndexProgressGateway;
  javaScriptTypeScriptInitialRuntimeStatus: LanguageServerRuntimeStatus;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerPlan?: LanguageServerPlan;
  javaScriptTypeScriptLanguageServerRuntimeGateway?: LanguageServerRuntimeGateway;
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus;
  languageServerGateway?: LanguageServerGateway;
  languageServerPlan?: LanguageServerPlan;
  languageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  languageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  languageServerRuntimeGateway?: LanguageServerRuntimeGateway;
  phpToolGateway?: WorkbenchWorkspaceGateways["phpTools"];
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
  settingsGateway?: SettingsGateway;
  smartModeGateway?: SmartModeGateway;
  workspaceDetectionGateway?: WorkbenchWorkspaceGateways["detection"];
  workspaceDescriptor?: WorkspaceDescriptor;
  workspaceRuntimeLifecycleGateway?: WorkspaceRuntimeLifecycleGateway;
  workspaceSettings: ReturnType<typeof defaultWorkspaceSettings>;
  workspaceTrustGateway?: WorkspaceTrustGateway;
}): ControllerDependencies {
  const documentSyncGateway: LanguageServerDocumentSyncGateway = {
    didChange: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
    didOpen: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
  };
  const workspaceGateways: WorkbenchWorkspaceGateways = {
    detection:
      workspaceDetectionGateway ?? {
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
    phpTools:
      phpToolGateway ?? {
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
    indexProgressGateway:
      indexProgressGateway ?? {
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
    languageServerGateway:
      languageServerGateway ?? {
        planJavaScriptTypeScriptLanguageServer: vi.fn(
          async () =>
            javaScriptTypeScriptLanguageServerPlan ??
            ({
              command: null,
              initializeRequest: null,
              message:
                "JavaScript/TypeScript language server unavailable in test.",
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
    languageServerRuntimeGateway:
      languageServerRuntimeGateway ?? {
        getStatus: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(runtimeStatus, rootPath),
        ),
        openLog: vi.fn(async () => null),
        start: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(runtimeStatus, rootPath),
        ),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
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
        getStatus: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(
            javaScriptTypeScriptInitialRuntimeStatus,
            rootPath,
          ),
        ),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(
            javaScriptTypeScriptRuntimeStatus,
            rootPath,
          ),
        ),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
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
    settingsGateway:
      settingsGateway ?? {
        loadAppSettings: vi.fn(async () => appSettings),
        loadWorkspaceSettings: vi.fn(async () => workspaceSettings),
        saveAppSettings: vi.fn(async () => undefined),
        saveWorkspaceSettings: vi.fn(async () => undefined),
      },
    smartModeGateway:
      smartModeGateway ?? {
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
    workspaceRuntimeLifecycleGateway:
      workspaceRuntimeLifecycleGateway ?? {
        disposeWorkspace: vi.fn(async () => undefined),
      },
    workspaceGateways,
    workspaceTrustGateway:
      workspaceTrustGateway ?? {
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
    declaration: vi.fn(async () => []),
    definition: vi.fn(async () => []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeCommand: vi.fn(async () => null),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    hover: vi.fn(async () => null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => []),
    rangeSemanticTokens: vi.fn(async () => null),
    references: vi.fn(async () => []),
    rename: vi.fn(async () => null),
    selectionRanges: vi.fn(async () => []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(async (_rootPath, action) => action),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
  };
}

function readyJavaScriptTypeScriptPlan(rootPath: string): LanguageServerPlan {
  return {
    command: {
      args: ["--stdio"],
      executable: "typescript-language-server",
      workingDirectory: rootPath,
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
}

function runtimeStatusWithRootForTest(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  return status.rootPath ? status : { ...status, rootPath };
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

function phpactorLanguageServerPlan(): LanguageServerPlan {
  return {
    command: {
      args: ["language-server"],
      executable: "phpactor",
      workingDirectory: "/workspace",
    },
    initializeRequest: null,
    message: "PHPactor ready",
    provider: "phpactor",
    status: "ready",
  };
}

function phpWorkspaceDescriptor(
  phpOverrides: Partial<PhpProjectDescriptor> = {},
): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: phpProjectDescriptor(phpOverrides),
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

function phpProjectDescriptor(
  overrides: Partial<PhpProjectDescriptor> = {},
): PhpProjectDescriptor {
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
    ...overrides,
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
