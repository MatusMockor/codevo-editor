// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { type GitChangedFile } from "../../domain/git";
import type { IndexProgressGateway, MetadataScanCompletionEvent } from "../../domain/indexProgress";
import type { LanguageServerGateway, LanguageServerPlan } from "../../domain/languageServer";
import type {
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../../domain/languageServerDiagnostics";
import { fileUriFromPath } from "../../domain/languageServerDocumentSync";
import type {
  LanguageServerCodeAction,
  LanguageServerTextEdit,
} from "../../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import type { PhpTreeGateway } from "../../domain/phpTree";
import type { ProjectSymbolSearchResult } from "../../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeWorkspaceSession,
  type SettingsGateway,
} from "../../domain/settings";
import type { WorkspaceTrustGateway } from "../../domain/trust";
import { type FileEntry, type FileSearchResult } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceRuntimeLifecycleGateway } from "../../domain/workspaceRuntimeLifecycle";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  featuresGateway,
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../../test/workbenchControllerTestHarness";
import { EditorActiveLiveDocumentSaveCoordinator } from "../editorActiveLiveDocumentSaveCoordinator";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  Deferred,
  createDeferred,
  defaultPhpLanguageServerOptions,
  directoryEntry,
  documentReadCount,
  fileEntry,
  fileHistoryGitGateway,
  flushSearchEverywhereDebounce,
  phpProjectDescriptor,
  phpWorkspaceDescriptor,
  phpactorLanguageServerPlan,
  readyJavaScriptTypeScriptPlan,
  runningStatus,
} from "./testSupport";

describe("useWorkbenchController workspace lifecycle, language runtimes, and save coordination", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

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
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);

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
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      }),
    );
  });
  it("keeps runtime operation latencies scoped to the active project tab", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    act(() => {
      getWorkbench().recordCompletionLatency(12, "/workspace-a");
      getWorkbench().recordCompletionLatency(18, "/workspace-a", "definition");
    });

    expect(getWorkbench().getLatencySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "completion",
          stats: expect.objectContaining({ count: 1, last: 12 }),
        }),
        expect.objectContaining({
          kind: "definition",
          stats: expect.objectContaining({ count: 1, last: 18 }),
        }),
      ]),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().getLatencySnapshot()).toEqual([]);

    act(() => {
      getWorkbench().recordCompletionLatency(30, "/workspace-b");
    });

    expect(getWorkbench().getLatencySnapshot()).toEqual([
      expect.objectContaining({
        kind: "completion",
        stats: expect.objectContaining({ count: 1, last: 30 }),
      }),
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().getLatencySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "completion",
          stats: expect.objectContaining({ count: 1, last: 12 }),
        }),
        expect.objectContaining({
          kind: "definition",
          stats: expect.objectContaining({ count: 1, last: 18 }),
        }),
      ]),
    );
  });
  it("does not restore synthetic Git diff tabs from the workspace cache", async () => {
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace-a/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway: fileHistoryGitGateway({}),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });

    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        path: "mockor-git-diff:worktree:/workspace-a/src/User.php",
      }),
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(getWorkbench().activePath).toBeNull();
    expect(getWorkbench().previewPath).toBeNull();
  });
  it("restores a dirty text tab without Git diffs or documents from another project", async () => {
    const firstRoot = "/workspace-a";
    const secondRoot = "/workspace-b";
    const firstFile = fileEntry(`${firstRoot}/src/Dirty.php`, "Dirty.php");
    const secondFile = fileEntry(`${secondRoot}/src/Other.php`, "Other.php");
    const savedContent = `// ${firstFile.path}\n`;
    const dirtyContent = "<?php\n// dirty\n";
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${firstRoot}/src/Changed.php`,
      relativePath: "src/Changed.php",
      status: "modified",
    };
    const diffPath = `mockor-git-diff:worktree:${change.path}`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: firstRoot,
        workspaceTabs: [firstRoot, secondRoot],
      },
      gitGateway: fileHistoryGitGateway({}),
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(firstFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument(dirtyContent);
    });
    await act(async () => {
      await getWorkbench().openGitChange(change);
    });
    expect(getWorkbench().activePath).toBe(diffPath);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(secondRoot);
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(secondFile);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(firstRoot);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(firstRoot);
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        content: dirtyContent,
        path: firstFile.path,
        savedContent,
      }),
    ]);
    expect(getWorkbench().openDocuments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: secondFile.path })]),
    );
    expect(getWorkbench().openDocuments.map((document) => document.path)).not.toContain(diffPath);
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

    expect(workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith("/workspace-a");
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Runtime" && notice.message.includes("stale runtime dispose"),
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
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      // IDE mode keeps the open-time PHP probe active so the stale-switch
      // isolation guard is exercised (the probe is deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
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
        (notice) => notice.source === "PHP Tools" && notice.message.includes("stale PHP tools"),
      ),
    ).toBe(false);
  });
  it("does not run PHP-specific workspace setup for a JavaScript-only project", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "Language server unavailable in test.",
            provider: "phpactor" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().workspaceDescriptor?.php).toBeNull();
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();
    expect(getWorkbench().languageServerPlan).toBeNull();
  });
  it("defers PHP probe at open for a PHP project in basic mode", async () => {
    // In basic (light) mode the PHP language server never runs, so the
    // open-time PHP probe (detectPhpTools + planPhpLanguageServer) is pure
    // overhead. It must be deferred until the user enables IDE mode.
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();
    expect(getWorkbench().languageServerPlan).toBeNull();
    expect(getWorkbench().phpTools).toBeNull();
  });
  it("warms up the PHP probe at open before the directory load resolves in IDE mode", async () => {
    // Warmup: in IDE mode for a PHP project, the phpactor handshake latency
    // (composer/autoload scan) dominates time-to-ready. The open-time probe
    // (detectPhpTools -> plan -> autostart) only needs the workspace descriptor
    // to know the project is PHP; it must NOT be serialized behind the
    // directory load / session restore. Firing it as soon as detection
    // confirms a PHP project lets the handshake run in the background while the
    // user navigates.
    const workspaceDirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return workspaceDirectory.promise;
      }

      return [];
    });
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });

    // The directory load is still pending, but the PHP probe must already have
    // fired so the phpactor handshake starts warming up immediately.
    await waitForReact(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace",
        defaultPhpLanguageServerOptions(),
      );
    });
    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");

    // Let the deferred directory load settle so teardown is clean.
    await act(async () => {
      workspaceDirectory.resolve([]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);
  });
  it("force-warms the phpactor index with a documentSymbol request after the first PHP didOpen", async () => {
    // Cold first-nav lag root cause: the open-time PHP probe only runs
    // detectPhpTools + planPhpLanguageServer (starts phpactor) but issues NO
    // real LSP request, so phpactor's index stays cold until the user's first
    // Cmd+B / hover / completion eats the full cold-index latency. Firing one
    // low-priority documentSymbol request after the first didOpen forces
    // phpactor to index, so the first real navigation is already warm.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path }),
        71,
      );
    });
    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace",
        path,
      );
    });
  });
  it("force-warms the phpactor index only once per workspace session", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const firstPath = "/workspace/app/Models/User.php";
    const secondPath = "/workspace/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\nclass Generated {}\n`,
      ),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(firstPath, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace",
        firstPath,
      );
    });
    expect(
      vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock.calls,
    ).toHaveLength(1);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(secondPath, "Account.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path: secondPath }),
        71,
      );
    });

    // The second PHP didOpen must not trigger another warm-up request: the
    // index is already warm for this workspace session.
    expect(
      vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock.calls,
    ).toHaveLength(1);
    expect(
      vi
        .mocked(dependencies.languageServerFeaturesGateway.documentSymbols)
        .mock.calls.every(([rootPath]) => rootPath === "/workspace"),
    ).toBe(true);
  });
  it("warms the phpactor index per workspace tab without leaking the warm-up across tabs", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: undefined,
      sessionId: 71,
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => ({
        javaScriptTypeScript: null,
        php: phpProjectDescriptor(),
        rootPath,
      })),
    };
    const pathA = "/workspace-a/app/Models/User.php";
    const pathB = "/workspace-b/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\nclass Generated {}\n`,
      ),
      runtimeStatus: runningStatus,
      workspaceDetectionGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(pathA, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace-a",
        pathA,
      );
    });

    // Switch to workspace B and open one of its PHP files: a fresh per-tab
    // warm-up must fire for B, and the warm-up requests must never target the
    // wrong root (no cross-tab leak).
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(pathB, "Account.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace-b",
        pathB,
      );
    });

    const warmUpCalls = vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock
      .calls;
    // Warm-up A targeted /workspace-a/...; warm-up B targeted /workspace-b/...
    // Never the reverse.
    expect(
      warmUpCalls.some(
        ([rootPath, requestedPath]) => rootPath === "/workspace-a" && requestedPath === pathA,
      ),
    ).toBe(true);
    expect(
      warmUpCalls.some(
        ([rootPath, requestedPath]) => rootPath === "/workspace-b" && requestedPath === pathB,
      ),
    ).toBe(true);
    expect(
      warmUpCalls.every(
        ([rootPath, requestedPath]) =>
          (rootPath === "/workspace-a" && requestedPath.startsWith("/workspace-a/")) ||
          (rootPath === "/workspace-b" && requestedPath.startsWith("/workspace-b/")),
      ),
    ).toBe(true);
  });
  it("does not warm up the PHP probe at open for a PHP project in basic mode", async () => {
    // The basic-mode defer (P2b) must be preserved: warmup only applies when
    // IDE mode is on. In basic mode the probe stays deferred even though
    // detection confirms a PHP project.
    const workspaceDirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return workspaceDirectory.promise;
      }

      return [];
    });
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });

    await waitForReact(() => {
      expect(getWorkbench().intelligenceMode).toBe("basic");
    });
    await flushAsyncTurns(24);

    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();

    await act(async () => {
      workspaceDirectory.resolve([]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
  });
  it("runs the deferred PHP probe and surfaces the IDE engine notice when switching a PHP project to IDE mode", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // Deferred at open in basic mode.
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    // Enabling IDE mode runs the previously deferred PHP probe.
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor /workspace ready");
    // phpactor is missing, so the install notice must be surfaced.
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "PHP IDE Engine" && notice.message.includes("managed PHP IDE engine"),
      ),
    ).toBe(true);
  });
  it("runs PHP-specific workspace setup for a PHP project in full smart mode", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
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
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
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
    await waitForReact(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
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
          notice.source === "Workspace Trust" && notice.message.includes("stale workspace trust"),
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
    await waitForReact(() => {
      expect(workspaceTrustGateway.setTrust).toHaveBeenCalledWith("/workspace-a", false);
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
          notice.source === "Workspace Trust" && notice.message.includes("stale trust toggle"),
      ),
    ).toBe(false);
  });
  it("does not continue stale workspace trust revocation after stopping project language runtimes", async () => {
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
    vi.mocked(dependencies.languageServerGateway.planPhpLanguageServer).mockClear();

    let trustPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
      expect(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
      ).toHaveBeenCalledWith("/workspace-a");
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
        Awaited<ReturnType<WorkbenchWorkspaceGateways["detection"]["detectWorkspace"]>>
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
    await waitForReact(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith("/workspace-b");
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
    const workspaceASettingsLoad = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
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
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-b");
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
          notice.source === "Settings" && notice.message.includes("stale workspace settings load"),
      ),
    ).toBe(false);
  });
  it("waits for an in-flight settings save before reloading the same project tab", async () => {
    const workspaceSettingsSave = createDeferred<void>();
    const initialWorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      javaScriptTypeScriptValidation: false,
    };
    let persistedWorkspaceSettings = initialWorkspaceSettings;
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) =>
        path === "/workspace-a" ? persistedWorkspaceSettings : defaultWorkspaceSettings(),
      ),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async (path, settings) => {
        if (path !== "/workspace-a") {
          return;
        }

        await workspaceSettingsSave.promise;
        persistedWorkspaceSettings = settings;
      }),
    };
    const { getWorkbench } = renderController({ appSettings, settingsGateway });
    await flushAsyncTurns(24);

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          javaScriptTypeScriptValidation: true,
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ javaScriptTypeScriptValidation: true }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    const workspaceALoadsBeforeReturn = vi
      .mocked(settingsGateway.loadWorkspaceSettings)
      .mock.calls.filter(([path]) => path === "/workspace-a").length;

    let returnToWorkspaceA: Promise<void> = Promise.resolve();
    act(() => {
      returnToWorkspaceA = getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(
      vi
        .mocked(settingsGateway.loadWorkspaceSettings)
        .mock.calls.filter(([path]) => path === "/workspace-a"),
    ).toHaveLength(workspaceALoadsBeforeReturn);

    await act(async () => {
      workspaceSettingsSave.resolve(undefined);
      await Promise.all([savePromise, returnToWorkspaceA]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceSettings.javaScriptTypeScriptValidation).toBe(true);
  });
  it("does not continue a pending workspace open after closing its project tab", async () => {
    const workspaceSettingsLoad = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
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
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace");
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
    await waitForReact(() => {
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
      workspaceASettingsSave.reject(new Error("stale workspace-open settings"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" && notice.message.includes("stale workspace-open settings"),
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
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
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
          notice.source === "Workspace" && notice.message.includes("stale directory load"),
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
        trusted: rootPath !== "/workspace-a",
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
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceADirectory.resolve([directoryEntry("/workspace-a/src", "src")]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    // The second project must stay active; nothing resolved late for the first
    // project (its directory entries or its distinct trust verdict) may leak
    // into the now-active workspace.
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTrust?.rootPath).toBe("/workspace-b");
    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    expect(
      Object.keys(getWorkbench().entriesByDirectory).some((directory) =>
        directory.startsWith("/workspace-a"),
      ),
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
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a/");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();
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

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalledWith(
      "/workspace-a/",
    );
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
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
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
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
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
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
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
  it("resets Quick Open input and stale results every time it opens", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      searchFiles: vi.fn(async (_root: string, query: string) =>
        query === "package.json"
          ? [
              {
                name: "package.json",
                path: "/workspace/package.json",
                relativePath: "package.json",
              },
            ]
          : [],
      ),
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("package.json");
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 140);
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenQuery).toBe("package.json");
    expect(getWorkbench().quickOpenResults).toEqual([
      expect.objectContaining({ name: "package.json" }),
    ]);

    act(() => {
      getWorkbench().setQuickOpenOpen(false);
      getWorkbench().setQuickOpenOpen(true);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 140);
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(getWorkbench().quickOpenQuery).toBe("");
    expect(getWorkbench().quickOpenLoading).toBe(false);
    expect(getWorkbench().quickOpenResults).toEqual([]);
  });
  it("aggregates files, symbols and actions into one Search Everywhere model", async () => {
    const userSymbol: ProjectSymbolSearchResult = {
      column: 7,
      containerName: null,
      fullyQualifiedName: "App\\Models\\User",
      kind: "class",
      lineNumber: 12,
      name: "User",
      path: "/workspace/app/Models/User.php",
      relativePath: "app/Models/User.php",
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [userSymbol],
      // The file/symbol gateways are already query-filtered upstream; return the
      // fixtures regardless so this test focuses on aggregation, while the
      // action section is filtered here by the live query (matches "search").
      searchFiles: vi.fn(async () => [
        {
          name: "User.php",
          path: "/workspace/app/Models/User.php",
          relativePath: "app/Models/User.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().openSearchEverywhere();
      getWorkbench().setSearchEverywhereQuery("search");
    });
    await flushSearchEverywhereDebounce();

    const sections = getWorkbench().searchEverywhereModel.sections;
    expect(sections.map((section) => section.kind)).toEqual(["file", "symbol", "action"]);
    expect(sections[0].items[0]).toMatchObject({ kind: "file" });
    expect(sections[1].items[0]).toMatchObject({ kind: "symbol" });
    expect(sections[2].items.every((item) => item.kind === "action")).toBe(true);
  });
  it("dispatches Search Everywhere file, symbol and action results correctly", async () => {
    const symbol: ProjectSymbolSearchResult = {
      column: 7,
      containerName: null,
      fullyQualifiedName: "App\\Models\\User",
      kind: "class",
      lineNumber: 12,
      name: "User",
      path: "/workspace/app/Models/User.php",
      relativePath: "app/Models/User.php",
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [symbol],
      searchFiles: vi.fn(async () => [
        {
          name: "User.php",
          path: "/workspace/app/Models/User.php",
          relativePath: "app/Models/User.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    // Symbol -> open file + reveal at the symbol position.
    await act(async () => {
      await getWorkbench().activateSearchEverywhereItem({
        id: "symbol:0:/workspace/app/Models/User.php:12:7",
        kind: "symbol",
        label: "User",
        detail: "class · app/Models/User.php:12",
        symbol,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().searchEverywhereOpen).toBe(false);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: "/workspace/app/Models/User.php",
      position: { column: 7, lineNumber: 12 },
    });

    // Action -> runs the command (re-open then activate the action).
    act(() => {
      getWorkbench().openSearchEverywhere();
    });
    const showCommands = getWorkbench().commands.find(
      (candidate) => candidate.id === "commands.show",
    );
    expect(showCommands).toBeDefined();

    await act(async () => {
      await getWorkbench().activateSearchEverywhereItem({
        id: "action:0:commands.show",
        kind: "action",
        label: showCommands?.title ?? "",
        detail: "Workbench",
        shortcut: null,
        command: showCommands!,
      });
    });

    expect(getWorkbench().searchEverywhereOpen).toBe(false);
    expect(getWorkbench().paletteOpen).toBe(true);
  });
  it("drops stale Search Everywhere results after switching project tabs", async () => {
    const slowSearch = createDeferred<FileSearchResult[]>();
    let firstQuery = true;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      searchFiles: vi.fn(async () => {
        if (firstQuery) {
          firstQuery = false;
          return slowSearch.promise;
        }

        return [];
      }),
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().openSearchEverywhere();
      getWorkbench().setSearchEverywhereQuery("user");
    });
    // Let the debounce fire so the slow search is in flight against workspace-a.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    // The stale search now resolves; its results must be dropped.
    await act(async () => {
      slowSearch.resolve([
        {
          name: "Stale.php",
          path: "/workspace-a/app/Stale.php",
          relativePath: "app/Stale.php",
        },
      ]);
      await slowSearch.promise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    const fileItems = getWorkbench()
      .searchEverywhereModel.sections.flatMap((section) => section.items)
      .filter((item) => item.kind === "file");
    expect(fileItems).toHaveLength(0);
  });
  it("opening Search Everywhere closes the dialogs it aggregates", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setClassOpenOpen(true);
      getWorkbench().setPaletteOpen(true);
      getWorkbench().setWorkspaceSymbolsOpen(true);
    });

    act(() => {
      getWorkbench().openSearchEverywhere();
    });

    expect(getWorkbench().searchEverywhereOpen).toBe(true);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().classOpenOpen).toBe(false);
    expect(getWorkbench().paletteOpen).toBe(false);
    expect(getWorkbench().workspaceSymbolsOpen).toBe(false);
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
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
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
        (notice) => notice.source === "Open File" && notice.message.includes("stale open"),
      ),
    ).toBe(false);
  });
  it("clears the in-flight open flag when a stale open errors after switching tabs", async () => {
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
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    expect(getWorkbench().isOpeningFile).toBe(true);

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
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("clears the in-flight open flag when a stale open resolves after switching tabs", async () => {
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
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    expect(getWorkbench().isOpeningFile).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    let opened = true;
    await act(async () => {
      openFile.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(path);
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("shows the opened document as soon as its content is read", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const path = "/workspace/app/Models/User.php";
    const read = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => read.promise),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });

    expect(getWorkbench().activeDocument).toBeNull();
    expect(dependencies.documentSyncGateway.didOpen).not.toHaveBeenCalled();

    let opened = false;
    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });

    expect(opened).toBe(true);
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");

    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
      71,
    );
  });
  it("populates a Quick Open document immediately when a delayed read resolves", async () => {
    const path = "/workspace/app/Http/Controllers/CommentController.php";
    const read = createDeferred<string>();
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      return read.promise;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activeDocument).toBeNull();

    let openPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      openPromise = getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/CommentController.php",
      });
      await Promise.resolve();
    });

    expect(getWorkbench().activeDocument).toBeNull();
    expect(readTextFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      read.resolve("<?php\nfinal class CommentController {}\n");
      await openPromise;
    });

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(
      "<?php\nfinal class CommentController {}\n",
    );
  });
  it("refreshes a Quick Open PHP document when the initial read is unexpectedly empty", async () => {
    const path = "/workspace/app/Http/Controllers/publicapi/AiHub/CommentController.php";
    const source =
      "<?php\nnamespace App\\Http\\Controllers\\publicapi\\AiHub;\n\nfinal class CommentController {}\n";
    let readCount = 0;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      readCount += 1;
      return readCount === 1 ? "" : source;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/publicapi/AiHub/CommentController.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 180);
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(2);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(source);
    expect(getWorkbench().openDocuments.find((document) => document.path === path)?.content).toBe(
      source,
    );
  });
  it("refreshes an already-open empty Quick Open PHP document without reopening", async () => {
    const path = "/workspace/app/Http/Controllers/publicapi/AiHub/CommentController.php";
    const source =
      "<?php\nnamespace App\\Http\\Controllers\\publicapi\\AiHub;\n\nfinal class CommentController {}\n";
    let readCount = 0;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      readCount += 1;
      return readCount < 3 ? "" : source;
    });
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      session: {
        activePath: path,
        bottomPanelView: "terminal" as const,
        openPaths: [path],
        sidebarView: "files" as const,
      },
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings,
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/publicapi/AiHub/CommentController.php",
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(2);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 180);
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(3);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(source);
  });
  it("reports an in-flight open while reading the file and clears it once visible", async () => {
    const path = "/workspace/app/Models/User.php";
    const read = createDeferred<string>();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => read.promise),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });

    expect(getWorkbench().isOpeningFile).toBe(true);
    expect(getWorkbench().activeDocument).toBeNull();

    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      await openPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().isOpeningFile).toBe(false);
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
  });
  it("keeps the latest opened file when a slower read resolves after a faster one", async () => {
    const slowPath = "/workspace/app/Models/User.php";
    const fastPath = "/workspace/app/Models/Account.php";
    const slowRead = createDeferred<string>();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === slowPath ? slowRead.promise : `<?php\n// ${requestedPath}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let slowOpen: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      slowOpen = getWorkbench().openPinnedFile(fileEntry(slowPath, "User.php"));
      await Promise.resolve();
    });

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(fastPath, "Account.php"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(fastPath);
    expect(getWorkbench().isOpeningFile).toBe(false);

    await act(async () => {
      slowRead.resolve("<?php\nclass User {}\n");
      await slowOpen;
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(fastPath);
    expect(getWorkbench().activeDocument?.content).toBe(`<?php\n// ${fastPath}\n`);
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("re-reads disk when re-opening a document whose saved content is empty", async () => {
    const path = "/workspace/src/User.php";
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(
      async (requestedPath: string) => contentsByPath[requestedPath] ?? "",
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("");
    expect(getWorkbench().activeDocument?.savedContent).toBe("");

    contentsByPath[path] = "<?php\nclass User {}\n";

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("<?php\nclass User {}\n");
  });
  it("keeps unsaved edits when re-opening a document with an empty saved content", async () => {
    const path = "/workspace/src/Draft.php";
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(
      async (requestedPath: string) => contentsByPath[requestedPath] ?? "",
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "Draft.php",
        path,
        relativePath: "src/Draft.php",
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      getWorkbench().updateActiveDocument("<?php\n// work in progress\n");
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("<?php\n// work in progress\n");

    readTextFile.mockClear();
    contentsByPath[path] = "<?php\n// disk would overwrite\n";

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "Draft.php",
        path,
        relativePath: "src/Draft.php",
      });
    });
    await flushAsyncTurns();

    expect(readTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.content).toBe("<?php\n// work in progress\n");
  });
  it("drops an empty-document re-read after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const read = createDeferred<string>();
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath !== path) {
        return `<?php\n// ${requestedPath}\n`;
      }

      if (contentsByPath[path] === "") {
        return "";
      }

      return read.promise;
    });
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
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    contentsByPath[path] = "<?php\nclass User {}\n";

    let reopen: Promise<void> = Promise.resolve();
    await act(async () => {
      reopen = getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
      await Promise.resolve();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      await reopen;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activeDocument?.path).not.toBe(path);
  });
  it("keeps an empty document open when the re-read fails", async () => {
    const path = "/workspace/src/User.php";
    let failNextRead = false;
    const readTextFile = vi.fn(async () => {
      if (failNextRead) {
        throw new Error("EBUSY: file is locked");
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("");

    failNextRead = true;

    let opened: boolean | undefined;
    await act(async () => {
      opened = await getWorkbench().openFile({
        kind: "file",
        name: "User.php",
        path,
      });
    });
    await flushAsyncTurns();

    expect(opened).toBe(true);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");
  });
  it("cancels pending file opens while closing the active project tab", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const disposeWorkspace = createDeferred<void>();
    const workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway = {
      disposeWorkspace: vi.fn((rootPath) =>
        rootPath === "/workspace-a" ? disposeWorkspace.promise : Promise.resolve(),
      ),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
      workspaceRuntimeLifecycleGateway,
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    let closePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      closePromise = getWorkbench().closeWorkspaceTab("/workspace-a");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    let opened = true;
    await act(async () => {
      openFile.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().activePath).not.toBe(path);
    expect(getWorkbench().openDocuments.some((document) => document.path === path)).toBe(false);

    await act(async () => {
      disposeWorkspace.resolve(undefined);
      await closePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
    expect(getWorkbench().activePath).not.toBe(path);
  });
  it("restores cached JavaScript and TypeScript runtime status when activating a kept-alive project tab", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
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
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(workspaceBPlan);

    workspaceAPlan.resolve(readyJavaScriptTypeScriptPlan("/workspace-a"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(workspaceBPlan);
  });
  it("caches stopped JavaScript and TypeScript status when suspending an inactive project runtime", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "running", rootPath: "/workspace-a/" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );
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
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      44,
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
      44,
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
      45,
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
      45,
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mock
        .invocationCallOrder[0],
    );
  });
  it("restores cached JavaScript and TypeScript diagnostics when switching project tabs", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
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
    await flushAsyncTurns();

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
  it.each([
    {
      activeValidation: false,
      backgroundRoot: "/workspace-b/",
      backgroundValidation: true,
      expectedCount: 0,
      title: "does not preload settings for an unadmitted background alias",
    },
    {
      activeValidation: true,
      backgroundRoot: "/workspace-b",
      backgroundValidation: false,
      expectedCount: 0,
      title: "suppresses background diagnostics using the background root settings",
    },
  ])(
    "$title",
    async ({ activeValidation, backgroundRoot, backgroundValidation, expectedCount }) => {
      let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
      let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
      const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
        {
          subscribeDiagnostics: vi.fn(async (listener) => {
            publishDiagnostics = listener;
            return () => undefined;
          }),
        };
      const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      const appSettings = {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      };
      const settingsGateway: SettingsGateway = {
        loadAppSettings: vi.fn(async () => appSettings),
        loadWorkspaceSettings: vi.fn(async (rootPath) => ({
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptValidation: workspaceRootKeysEqual(rootPath, "/workspace-b")
            ? backgroundValidation
            : activeValidation,
        })),
        saveAppSettings: vi.fn(async () => undefined),
        saveWorkspaceSettings: vi.fn(async () => undefined),
      };
      const { getWorkbench } = renderController({
        appSettings,
        javaScriptTypeScriptLanguageServerDiagnosticsGateway,
        javaScriptTypeScriptLanguageServerRuntimeGateway,
        settingsGateway,
      });
      await flushAsyncTurns(24);

      act(() => {
        publishRuntimeStatus?.(runningStatus(backgroundRoot, 302));
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
          rootPath: backgroundRoot,
          sessionId: 302,
          uri: fileUriFromPath(workspaceBPath),
          version: null,
        });
      });
      await flushAsyncTurns();

      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceAPath]).toBeUndefined();
      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toBeUndefined();

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]?.length ?? 0).toBe(
        expectedCount,
      );
    },
  );
  it("caches PHP runtime status and diagnostics for background project tabs", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const workspaceBStatus = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn((rootPath) =>
        rootPath === "/workspace-b"
          ? workspaceBStatus.promise
          : Promise.resolve(runningStatus(rootPath, 301)),
      ),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 303)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const workspaceBPath = "/workspace-b/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 302));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Workspace B PHP issue",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 302,
        uri: fileUriFromPath(workspaceBPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerRuntimeStatus).not.toEqual(
      expect.objectContaining({ rootPath: "/workspace-b" }),
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace-b",
        sessionId: 302,
      }),
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toHaveLength(1);

    act(() => {
      workspaceBStatus.resolve(runningStatus("/workspace-b", 302));
    });
    await flushAsyncTurns(4);
  });
  it("ignores PHP diagnostics without an explicit workspace root", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
          notice.source === "phpactor" && notice.message.includes("Rootless PHP diagnostic"),
      ),
    ).toBe(false);
  });
  it("aggregates diagnostic severity counts for the active workspace only", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 401)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 401)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 402));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active error",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 4,
            line: 2,
            message: "Active warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 401,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive error should not count",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 402,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 1,
    });
  });
  it("reports zero diagnostics when the active workspace has none", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("includes local PHP diagnostics in Problems and status without folding them into LSP marker state", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 71,
    };
    const path = "/workspace/app/Broken.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
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
            message: "PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(path, [
        {
          character: 9,
          endCharacter: 10,
          endLine: 2,
          line: 2,
          message: "syntax error, unexpected end of file",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 1,
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toEqual([
      {
        character: 0,
        line: 0,
        message: "PHPactor warning",
        severity: "warning",
        source: "phpactor",
      },
    ]);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey?.startsWith("php-local-diagnostics:") &&
          notice.message.includes("syntax error, unexpected end of file"),
      ),
    ).toBe(true);

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(path, []);
    });

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 1,
    });
    expect(
      getWorkbench().notices.some((notice) =>
        notice.groupKey?.startsWith("php-local-diagnostics:"),
      ),
    ).toBe(false);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });
  it("derives active PHP diagnostics from the open document so Problems and status do not wait for parser callbacks", async () => {
    const path = "/workspace/routes/codevo_qa_broken.php";
    const source = "<?php  \n\nfunction codevoQaBroken(\n";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => source),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "codevo_qa_broken.php"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey?.startsWith("php-local-diagnostics:") &&
          notice.message.includes("Unclosed delimiter"),
      ),
    ).toBe(true);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
  });
  it("publishes live dotenv duplicate warnings to markers and Problems, then clears them after a fix and close", async () => {
    const path = "/workspace/.env";
    const source = "APP_NAME=Codevo\nAPP_NAME=Editor\n";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => source),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, ".env"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.language).toBe("dotenv");
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toEqual([
      expect.objectContaining({
        character: 0,
        endCharacter: 8,
        line: 0,
        message: "Duplicate key APP_NAME — overridden by a later assignment",
        severity: "warning",
      }),
    ]);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey === `php-local-diagnostics:${fileUriFromPath(path)}` &&
          notice.message.includes("Duplicate key APP_NAME"),
      ),
    ).toBe(true);

    act(() => {
      getWorkbench().updateActiveDocument("APP_NAME=Editor\n");
    });

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);

    act(() => {
      getWorkbench().updateActiveDocument(source);
    });
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);
  });
  it("does not publish dotenv warnings for another language or workspace", async () => {
    const dotenvPath = "/workspace-a/.env";
    const textPath = "/workspace-a/config.txt";
    const source = "APP_NAME=Codevo\nAPP_NAME=Editor\n";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async () => source),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(textPath, "config.txt"));
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[textPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(dotenvPath, ".env"));
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[dotenvPath]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[dotenvPath]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);
  });
  it("coalesces a burst of PHP diagnostics events into a single batched flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 71,
    };
    const fileCount = 40;
    const paths = Array.from(
      { length: fileCount },
      (_unused, index) => `/workspace/app/Models/Model${index}.php`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      paths.forEach((path, index) => {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Issue in model ${index}`,
              severity: "error",
              source: "phpactor",
            },
          ],
          rootPath: "/workspace",
          sessionId: 71,
          uri: fileUriFromPath(path),
          version: null,
        });
      });
    });

    // The burst is buffered: nothing is applied until the scheduled flush.
    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(0);

    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(Object.keys(applied)).toHaveLength(fileCount);
    paths.forEach((path) => {
      expect(applied[path]).toHaveLength(1);
    });
    expect(getWorkbench().diagnosticsSummary.errors).toBe(fileCount);
  });
  it("coalesces a burst of JavaScript/TypeScript diagnostics into one flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 81,
    };
    const fileCount = 25;
    const paths = Array.from(
      { length: fileCount },
      (_unused, index) => `/workspace/src/module${index}.ts`,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
    });
    await flushAsyncTurns(24);

    act(() => {
      paths.forEach((path, index) => {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Type error ${index}`,
              severity: "error",
              source: "tsserver",
            },
          ],
          rootPath: "/workspace",
          sessionId: 81,
          uri: fileUriFromPath(path),
          version: null,
        });
      });
    });

    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(0);

    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(Object.keys(applied)).toHaveLength(fileCount);
    expect(getWorkbench().diagnosticsSummary.errors).toBe(fileCount);
  });
  it("applies only the latest buffered version per document within a burst", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 91,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          { character: 0, line: 0, message: "v1", severity: "error", source: "phpactor" },
          { character: 0, line: 1, message: "v1b", severity: "error", source: "phpactor" },
        ],
        rootPath: "/workspace",
        sessionId: 91,
        uri: fileUriFromPath(path),
        version: 1,
      });
      publishDiagnostics?.({
        diagnostics: [
          { character: 0, line: 0, message: "v2", severity: "warning", source: "phpactor" },
        ],
        rootPath: "/workspace",
        sessionId: 91,
        uri: fileUriFromPath(path),
        version: 2,
      });
    });
    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath[path];
    expect(applied).toHaveLength(1);
    expect(applied?.[0]?.message).toBe("v2");
    expect(getWorkbench().diagnosticsSummary).toEqual({ errors: 0, warnings: 1 });
  });
  it("drops buffered diagnostics for an inactive workspace root on flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 502));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active root issue",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive root issue must not leak",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 502,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(applied[activePath]).toHaveLength(1);
    expect(applied[inactivePath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });
  });
  it("bounds diagnostics across many files with an exact retention receipt", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 601,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // 2100 files each contributing one diagnostic notice exceeds the 2000
    // global cap, so the list must be bounded and carry a single overflow notice.
    const fileCount = 2100;
    act(() => {
      for (let index = 0; index < fileCount; index += 1) {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Issue ${index}`,
              severity: "error",
              source: "phpactor",
            },
          ],
          rootPath: "/workspace",
          sessionId: 601,
          uri: fileUriFromPath(`/workspace/app/File${index}.php`),
          version: null,
        });
      }
    });
    await flushAsyncTurns();

    const retentionReceipt = getWorkbench().notices.find((notice) =>
      notice.groupKey?.startsWith("diagnostics-retention-receipt:"),
    );

    expect(retentionReceipt).toMatchObject({
      kind: "overflow",
      message: "Retained 2000 of 2100 published diagnostics.",
    });
    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(2000);
    expect(getWorkbench().diagnosticsSummary.errors).toBe(2000);
  });
  it("preserves the per-document notice cap with an overflow indicator", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 611,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: Array.from({ length: 250 }, (_unused, index) => ({
          character: 0,
          line: index,
          message: `Diagnostic ${index}`,
          severity: "error" as const,
          source: "phpactor",
        })),
        rootPath: "/workspace",
        sessionId: 611,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    const groupKey = `language-server-diagnostics:${fileUriFromPath(path)}`;
    const groupNotices = getWorkbench().notices.filter((notice) => notice.groupKey === groupKey);

    // 100 kept diagnostics + 1 per-document overflow indicator.
    expect(groupNotices).toHaveLength(101);
    expect(groupNotices[100].kind).toBe("overflow");
    // Editor markers stay uncapped: all 250 diagnostics are tracked.
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(250);
  });
  it("clears diagnostics for a deleted PHP document and sends didClose", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 701,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Undefined variable",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 701,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
      701,
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("caps the per-document diagnostic notices without dropping markers", async () => {
    // STABILITY: a single Laravel file can publish hundreds of diagnostics.
    // Mapping every one to a notice and re-rendering the notices panel freezes
    // the main thread, so notices are capped with a truthful "N more" indicator.
    // Editor markers come from a separate, uncapped source and must keep ALL of
    // them.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 731,
    };
    const path = "/workspace/app/Models/User.php";
    const uri = fileUriFromPath(path);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const diagnostics = Array.from({ length: 300 }, (_, index) => ({
      character: 0,
      line: index,
      message: `Diagnostic ${index}`,
      severity: "error" as const,
      source: "phpactor",
    }));

    act(() => {
      publishDiagnostics?.({
        diagnostics,
        rootPath: "/workspace",
        sessionId: 731,
        uri,
        version: null,
      });
    });
    await flushAsyncTurns();

    const groupNotices = getWorkbench().notices.filter(
      (notice) => notice.groupKey === `language-server-diagnostics:${uri}`,
    );

    // Notices are bounded: 100 diagnostics + 1 overflow indicator, never 300.
    expect(groupNotices).toHaveLength(101);
    const overflow = groupNotices[groupNotices.length - 1];
    expect(overflow.severity).toBe("info");
    // The hidden count is truthful (300 - 100 = 200), not a lie about "100".
    expect(overflow.message).toContain("200 not shown");

    // Markers (the separate, uncapped source) keep ALL 300 diagnostics so no
    // squiggle is lost.
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(300);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 300,
      warnings: 0,
    });
  });
  it("does not send a debounced didChange after the document was closed", async () => {
    // STABILITY: the 150ms didChange debounce timer can fire and enqueue its
    // sync operation while an earlier sync (here a held didOpen) is still in
    // flight. If closeDocument runs in the meantime, the document is removed
    // from the synced set and a didClose is sent; the queued didChange must then
    // be dropped so it never targets a closed document (UnknownDocument/desync).
    const didOpen = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 741,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    // Hold the didOpen sync so the per-document sync queue stays busy; any
    // didChange enqueued afterwards is blocked behind it until we resolve it.
    vi.mocked(dependencies.languageServerDocumentSyncGateway.didOpen).mockReturnValue(
      didOpen.promise,
    );
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    // Edit the document, then let the 150ms debounce elapse so the didChange
    // timer fires and enqueues its (queued, blocked) sync operation.
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nclass User\n{\n}\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    // Close the document: this removes it from the synced set and enqueues a
    // didClose behind the still-blocked didChange.
    act(() => {
      getWorkbench().closeDocument(path);
    });

    // Release the held didOpen so the queue drains: didChange must be skipped.
    act(() => {
      didOpen.resolve(undefined);
    });
    await flushAsyncTurns(24);

    expect(dependencies.languageServerDocumentSyncGateway.didChange).not.toHaveBeenCalled();
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
      741,
    );
  });
  it("does not send a debounced JavaScript and TypeScript didChange after the document was closed", async () => {
    // STABILITY: the 150ms didChange debounce timer can fire and enqueue its
    // sync operation while an earlier sync (here a held didOpen) is still in
    // flight. If closeDocument runs in the meantime, the document is removed
    // from the synced set and a didClose is sent; the queued didChange must then
    // be dropped so it never targets a closed document (UnknownDocument/desync).
    // Single-tab close does not bump the JS/TS sync generation, so the synced
    // set membership is the guard that has to catch this.
    const didOpen = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 742,
    };
    const path = "/workspace/src/App.ts";
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    // Hold the didOpen sync so the per-document sync queue stays busy; any
    // didChange enqueued afterwards is blocked behind it until we resolve it.
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).mockReturnValue(didOpen.promise);
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    // Edit the document, then let the 150ms debounce elapse so the didChange
    // timer fires and enqueues its (queued, blocked) sync operation.
    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    // Close the document: this removes it from the synced set and enqueues a
    // didClose behind the still-blocked didChange.
    act(() => {
      getWorkbench().closeDocument(path);
    });

    // Release the held didOpen so the queue drains: didChange must be skipped.
    act(() => {
      didOpen.resolve(undefined);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace", path, 742);
  });
  it("applies a phpactor clear carrying the analysis version after the document version advanced", async () => {
    // BUG 1: phpactor publishes diagnostics asynchronously keyed by the analysis
    // version. After a didChange bumps the live document version to 2, phpactor
    // can still publish the clear (count=0) for its in-flight analysis at the
    // older analysis version (1). Comparing against the document version dropped
    // that clear, leaving the stale "1 error" marker visible. Comparing against
    // the last APPLIED diagnostic version instead lets the clear through.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 711,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    // phpactor analysed the opened document (version 1) and reported one error.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Invalid class",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(path),
        version: 1,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    // The user edits the document; the live document version advances to 2 via a
    // debounced didChange.
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nclass User\n{\n}\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    await flushAsyncTurns(24);

    // phpactor finishes the in-flight analysis it started for version 1 and
    // publishes the clear at that analysis version, even though the live
    // document is now at version 2.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(path),
        version: 1,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "phpactor" && notice.message.includes("Invalid class"),
      ),
    ).toBe(false);
  });
  it("suppresses an UnknownDocument feature error for a document that is not open", async () => {
    // RACE: a Monaco feature provider (hover/completion/codeAction) reports its
    // error through onLanguageServerError -> reportLanguageServerError. If the
    // tab was closed (didClose) between flushing the document change and the
    // server's reply, phpactor answers with UnknownDocument for a path that is
    // no longer synced. That is a benign desync, not a real failure, so it must
    // not surface a false error toast or status message.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 821,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // The document was never opened on the server (the tab is already closed),
    // so its path is absent from the synced set.
    const closedPath = "/workspace/app/Models/User.php";
    const error = `UnknownDocument: Unknown text document "${fileUriFromPath(closedPath)}"`;

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("UnknownDocument")),
    ).toBe(false);
    expect(getWorkbench().message).toBeNull();
  });
  it("suppresses benign application errors before they become notices", async () => {
    const { getWorkbench } = renderController();
    await flushAsyncTurns();

    act(() => {
      getWorkbench().reportCommandError(
        new Error("ResizeObserver loop completed with undelivered notifications."),
      );
    });

    expect(getWorkbench().notices).toEqual([]);
    expect(getWorkbench().message).toBeNull();
  });
  it("reports one Command notice when an active-root async command rejects", async () => {
    const commandRun = createDeferred<void>();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace");
    });
    const refreshCommand = getWorkbench().commands.find(
      (command) => command.id === "workspace.refresh",
    );
    expect(refreshCommand).toBeDefined();
    const runRefresh = vi.spyOn(refreshCommand!, "run").mockReturnValue(commandRun.promise);

    act(() => {
      expect(getWorkbench().runCommand("workspace.refresh")).toBe("executed");
    });
    expect(runRefresh).toHaveBeenCalledOnce();

    await act(async () => {
      commandRun.reject(new Error("active command failed"));
      await commandRun.promise.catch(() => undefined);
    });
    await flushAsyncTurns();

    const commandNotices = getWorkbench().notices.filter((notice) => notice.source === "Command");
    expect(commandNotices).toEqual([
      expect.objectContaining({ message: "Error: active command failed" }),
    ]);
    expect(getWorkbench().message).toBe("Error: active command failed");
  });
  it("drops an async command rejection after switching workspace roots", async () => {
    const commandRun = createDeferred<void>();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    const refreshCommand = getWorkbench().commands.find(
      (command) => command.id === "workspace.refresh",
    );
    expect(refreshCommand).toBeDefined();
    const runRefresh = vi.spyOn(refreshCommand!, "run").mockReturnValue(commandRun.promise);

    act(() => {
      expect(getWorkbench().runCommand("workspace.refresh")).toBe("executed");
    });
    expect(runRefresh).toHaveBeenCalledOnce();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      commandRun.reject(new Error("stale workspace-a command"));
      await commandRun.promise.catch(() => undefined);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().notices).toEqual([]);
  });
  it("suppresses a reportCommandError callback captured for an inactive root", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    const reportWorkspaceACommandError = getWorkbench().reportCommandError;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);
    act(() => {
      reportWorkspaceACommandError(new Error("stale callback command"));
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().notices).toEqual([]);
  });
  it("suppresses benign language server cancellations before they become notices", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 824,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const cancellation = new Error("request superseded");
    cancellation.name = "CanceledError";

    act(() => {
      getWorkbench().reportLanguageServerError(cancellation);
    });

    expect(getWorkbench().notices).toEqual([]);
    expect(getWorkbench().message).toBeNull();
  });
  it("still reports a legitimate language server feature error", async () => {
    // A genuine LSP failure (not UnknownDocument) reported through the Monaco
    // feature path must continue to surface a notice and status message.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 822,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const error = "Internal error: completion provider crashed";

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("completion provider crashed"),
      ),
    ).toBe(true);
    expect(getWorkbench().message).toBe(error);
  });
  it("still reports an UnknownDocument error for an open, synced document", async () => {
    // An UnknownDocument error for a document that IS still open is a real
    // desync problem, not the benign close race, so it must remain visible.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 823,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    const error = `UnknownDocument: Unknown text document "${fileUriFromPath(path)}"`;

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("UnknownDocument")),
    ).toBe(true);
    expect(getWorkbench().message).toBe(error);
  });
  it("drops a phpactor publication older than the last applied diagnostic", async () => {
    // BUG 1 protection: once a newer analysis version has been applied, a late
    // publication carrying an older analysis version must be dropped so it
    // cannot resurrect stale diagnostics.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 712,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Newer analysis error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(path),
        version: 5,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    // A late publication from an older analysis version must be ignored.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [],
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(path),
        version: 3,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });
  it("clears stale diagnostics for the old path when renaming a PHP document", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
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
      sessionId: 711,
    };
    const oldPath = "/workspace/app/Models/User.php";
    const newPath = "/workspace/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Undefined variable",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(oldPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("clears stale diagnostics for the old path when renaming a TypeScript document", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 712,
    };
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === oldPath) {
          return "export class User {}\n";
        }

        return `// ${requestedPath}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
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
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(oldPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");
    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("clears diagnostics for a deleted TypeScript document and sends didClose", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 702,
    };
    const path = "/workspace/src/User.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
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
        rootPath: "/workspace",
        sessionId: 702,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 702);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("does not clear another project tab's cached diagnostics when deleting a file in the active tab", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 801)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 801)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(activePath, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 802));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 801,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Background error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 802,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[activePath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[inactivePath]).toHaveLength(1);
  });
  it("navigates next and previous through active workspace problems with wrap-around", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const firstPath = "/workspace-a/app/Models/Account.php";
    const secondPath = "/workspace-a/app/Models/Zone.php";
    const inactivePath = "/workspace-b/app/Models/Comment.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 502));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 2,
            line: 4,
            message: "First problem",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(firstPath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 9,
            message: "Second problem",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(secondPath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive problem",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 502,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: firstPath,
      position: { column: 3, lineNumber: 5 },
    });

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: secondPath,
      position: { column: 1, lineNumber: 10 },
    });

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: firstPath,
      position: { column: 3, lineNumber: 5 },
    });

    await act(async () => {
      await getWorkbench().goToPreviousProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: secondPath,
      position: { column: 1, lineNumber: 10 },
    });

    expect(getWorkbench().editorRevealTarget?.path).not.toBe(inactivePath);
  });
  it("does nothing when navigating problems with no diagnostics", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("does not sync JavaScript and TypeScript documents with a runtime from another project tab", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    ).not.toHaveBeenCalledWith("/workspace-b", expect.objectContaining({ path: workspaceBPath }));

    act(() => {
      publishStatus?.(runningWorkspaceBStatus);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith("/workspace-b", expect.objectContaining({ path: workspaceBPath }), 202);
  });
  it("syncs JSX and TSX documents through the JavaScript and TypeScript language server", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 205,
    };
    const cases = [
      {
        changedContent: "export function App() { return <span />; }\n",
        languageId: "typescriptreact",
        name: "App.tsx",
        originalContent: "export function App() { return <main />; }\n",
        path: "/workspace/src/App.tsx",
      },
      {
        changedContent: "export function Widget() { return <span />; }\n",
        languageId: "javascriptreact",
        name: "Widget.jsx",
        originalContent: "export function Widget() { return <main />; }\n",
        path: "/workspace/src/Widget.jsx",
      },
    ];
    const contentByPath = new Map(cases.map((entry) => [entry.path, entry.originalContent]));
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => contentByPath.get(requestedPath) ?? ""),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    await flushAsyncTurns(24);

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;

    for (const entry of cases) {
      vi.mocked(syncGateway.didOpen).mockClear();
      vi.mocked(syncGateway.didChange).mockClear();
      vi.mocked(syncGateway.didSave).mockClear();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(entry.path, entry.name));
      });
      await flushAsyncTurns(24);

      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          languageId: entry.languageId,
          path: entry.path,
          text: entry.originalContent,
        }),
        205,
      );

      act(() => {
        getWorkbench().updateActiveDocument(entry.changedContent);
      });
      await act(async () => {
        await getWorkbench().flushPendingJavaScriptTypeScriptLanguageServerDocument(entry.path);
      });

      expect(syncGateway.didChange).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          languageId: entry.languageId,
          path: entry.path,
          text: entry.changedContent,
        }),
        205,
      );

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(syncGateway.didSave).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          languageId: entry.languageId,
          path: entry.path,
          text: entry.changedContent,
        }),
        205,
      );
    }
  });
  it("keeps an active TypeScript save fail-closed when the real live-save coordinator has no binding", async () => {
    const path = "/workspace/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      activeLiveDocumentSaveCoordinator: new EditorActiveLiveDocumentSaveCoordinator(),
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });

    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.content).toBe("export const value = 2;\n");
  });
  it("ignores JavaScript and TypeScript runtime status events without an explicit workspace root", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const path = "/workspace/src/App.ts";
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 211,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).not.toHaveBeenCalled();

    act(() => {
      publishStatus?.(rootedRunningStatus);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 211,
      }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith("/workspace", expect.objectContaining({ path }), 211);
  });
  it("ignores PHP runtime status events without an explicit workspace root", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
      212,
    );
  });
  it("ignores JavaScript and TypeScript runtime status events after the last project tab closes", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toBeNull();

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
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toBeNull();
  });
  it("ignores PHP runtime status events after the last project tab closes", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    expect(getWorkbench().message).not.toBe("Error: stale php runtime subscription");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("stale php runtime subscription"),
      ),
    ).toBe(false);
  });
  it("reports the same PHP runtime crash once per project tab", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
          notice.source === "Language Server" && notice.message.includes("phpactor crashed"),
      ),
    ).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("phpactor crashed"),
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
          notice.source === "Language Server" && notice.message.includes("phpactor crashed"),
      ),
    ).toBe(true);
  });
  it("clears a stale PHP runtime crash message after the active project recovers", async () => {
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishStatus?.({
        kind: "crashed",
        message: "PHPactor exited unexpectedly.",
        rootPath: "/workspace-a",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBe("PHPactor exited unexpectedly.");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message === "PHPactor exited unexpectedly.",
      ),
    ).toBe(true);

    act(() => {
      publishStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/workspace-a",
        sessionId: 232,
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBeNull();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message === "PHPactor exited unexpectedly.",
      ),
    ).toBe(false);
  });
  it("ignores stale JavaScript and TypeScript runtime subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    expect(getWorkbench().message).not.toBe("Error: stale js runtime subscription");
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
    expect(getWorkbench().message).not.toBe("Error: stale php diagnostics subscription");
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
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
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
    expect(getWorkbench().message).not.toBe("Error: stale js diagnostics subscription");
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
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    await waitForReact(() => {
      expect(didOpenAttempts).toHaveLength(1);
    });

    act(() => {
      publishStatus?.(runningStatus(302));
    });
    await waitForReact(() => {
      expect(didOpenAttempts).toHaveLength(2);
    });

    didOpenAttempts[1]?.resolve(undefined);
    await flushAsyncTurns();
    didOpenAttempts[0]?.reject(new Error("stale did open"));
    await flushAsyncTurns(24);
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).mockClear();

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "export const value = 2;\n",
      }),
      302,
    );
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" && notice.message.includes("stale did open"),
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
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
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
    await waitForReact(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
      ).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "export const value = 2;\n",
        }),
        311,
      );
    });

    act(() => {
      publishStatus?.(runningStatus(312));
    });
    await flushAsyncTurns();

    await act(async () => {
      didChange.reject(new Error("stale did change"));
      await flushAsyncTurns(24);
    });

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" && notice.message.includes("stale did change"),
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
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      readTextFile: vi.fn(async () => "export const value = 0;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didSave,
    ).mockImplementationOnce(() => didSave.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("export const value = 1;\n");
    });
    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didSave,
      ).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "export const value = 1;\n",
        }),
        321,
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
          notice.source === "JavaScript/TypeScript" && notice.message.includes("stale did save"),
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
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus(341),
    });
    vi.mocked(dependencies.documentSyncGateway.didSave).mockImplementationOnce(
      () => didSave.promise,
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didSave).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: "<?php\nfinal class User {}\n",
        }),
        341,
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
      getWorkbench().notices.some((notice) => notice.message.includes("stale php did save")),
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
    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
        "/workspace-a",
        path,
        351,
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
          notice.source === "Language Server" && notice.message.includes("stale php did close"),
      ),
    ).toBe(false);
  });
  it("does not send queued PHP didOpen after switching project tabs while didClose is pending", async () => {
    const path = "/workspace-a/src/User.php";
    const didClose = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 352,
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
    const syncGateway = dependencies.documentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        352,
      );
    });

    vi.mocked(syncGateway.didClose).mockImplementationOnce(() => didClose.promise);
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await waitForReact(() => {
      expect(syncGateway.didClose).toHaveBeenCalledWith("/workspace-a", path, 352);
    });
    vi.mocked(syncGateway.didOpen).mockClear();

    let reopenPromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reopenPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(4);

    expect(syncGateway.didOpen).not.toHaveBeenCalled();

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
      await Promise.resolve();
    });
    await flushAsyncTurns();

    await act(async () => {
      didClose.resolve(undefined);
      await Promise.all([reopenPromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      352,
    );
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
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockImplementationOnce(
      async () => save.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        "<?php\nfinal class User {}\n",
      );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      save.reject(new Error("stale save"));
      await Promise.all([savePromise, switchPromise]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Save File" && notice.message.includes("stale save"),
      ),
    ).toBe(false);
  });
  it("waits for an issued save before caching and restores the clean revision", async () => {
    const path = "/workspace-a/src/User.php";
    const savedRevision = {
      device: "1",
      inode: "2",
      size: 27,
      modifiedSeconds: 3,
      modifiedNanoseconds: 4,
      contentHash: "5",
    };
    const save = createDeferred<{
      status: "success";
      revision: typeof savedRevision;
    }>();
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
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockImplementationOnce(
      () => save.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        "<?php\nfinal class User {}\n",
      );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      save.resolve({ status: "success", revision: savedRevision });
      await Promise.all([savePromise, switchPromise]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Saved User.php");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument).toMatchObject({
      content: "<?php\nfinal class User {}\n",
      path,
      revision: savedRevision,
      savedContent: "<?php\nfinal class User {}\n",
    });
  });
  it("cancels a drain-blocked workspace switch when the visible tab is reactivated", async () => {
    const path = "/workspace-a/src/User.php";
    const write = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class User {}\n");
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockImplementationOnce(
      () => write.promise,
    );
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mockClear();

    let savePromise: Promise<void> = Promise.resolve();
    act(() => {
      savePromise = getWorkbench().saveActiveDocument();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        "<?php\nfinal class User {}\n",
      );
    });

    let switchToB: Promise<void> = Promise.resolve();
    act(() => {
      switchToB = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });

    await act(async () => {
      write.resolve();
      await Promise.all([savePromise, switchToB]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    expect(dependencies.settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalled();
  });
  it("preserves an edit made during an issued save as dirty in the workspace cache", async () => {
    const path = "/workspace-a/src/User.php";
    const savedRevision = {
      device: "1",
      inode: "2",
      size: 2,
      modifiedSeconds: 3,
      modifiedNanoseconds: 4,
      contentHash: "5",
    };
    const save = createDeferred<{
      status: "success";
      revision: typeof savedRevision;
    }>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) => `C0 // ${requestedPath}\n`),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("C1");
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockImplementationOnce(
      () => save.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    act(() => {
      savePromise = getWorkbench().saveActiveDocument();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(path, "C1");
    });

    let switchPromise: Promise<void> = Promise.resolve();
    act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
      getWorkbench().updateActiveDocument("C2");
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      save.resolve({ status: "success", revision: savedRevision });
      await Promise.all([savePromise, switchPromise]);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument).toMatchObject({
      content: "C2",
      path,
      revision: savedRevision,
      savedContent: "C1",
    });
  });
  describe("format on save", () => {
    const runningJavaScriptTypeScriptStatus = (): LanguageServerRuntimeStatus => ({
      capabilities: { ...emptyLanguageServerCapabilities(), formatting: true },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 920,
    });

    const wholeDocumentReplacement = (
      original: string,
      newText: string,
    ): LanguageServerTextEdit => {
      const lines = original.split("\n");

      return {
        newText,
        range: {
          end: {
            character: lines[lines.length - 1]?.length ?? 0,
            line: lines.length - 1,
          },
          start: { character: 0, line: 0 },
        },
      };
    };

    it("does not format the document before saving when formatOnSave is disabled", async () => {
      const path = "/workspace/src/App.ts";
      const featuresGatewayInstance = featuresGateway();
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument("export const value=2;\n");
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        "export const value=2;\n",
      );
    });

    it("writes prettier-formatted content on save in a trusted workspace when prettierFormatOnSave is enabled", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const formatted = "export const value = 2;\n";
      const prettierFormattingGateway = {
        format: vi.fn(async () => ({
          status: "ok" as const,
          formatted,
        })),
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        prettierFormattingGateway,
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          prettierFormatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(prettierFormattingGateway.format).toHaveBeenCalledWith(
        "/workspace",
        "src/App.ts",
        unformatted,
      );
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        formatted,
      );
      expect(getWorkbench().activeDocument?.content).toBe(formatted);
    });

    it("saves the buffer untouched by prettier when prettierFormatOnSave is disabled", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const prettierFormattingGateway = {
        format: vi.fn(async () => ({
          status: "ok" as const,
          formatted: "export const value = 2;\n",
        })),
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        prettierFormattingGateway,
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          prettierFormatOnSave: false,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(prettierFormattingGateway.format).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        unformatted,
      );
    });

    it("formats the active document through the formatting provider before writing it when formatOnSave is enabled", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const formatted = "export const value = 2;\n";
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockResolvedValue([
        wholeDocumentReplacement(unformatted, formatted),
      ]);
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).toHaveBeenCalledWith(
        "/workspace",
        path,
        expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
      );
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        formatted,
      );
      expect(getWorkbench().activeDocument?.content).toBe(formatted);
    });

    it("formats with the active document's detected four-space indentation", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = [
        "function run() {",
        "    const value=1;",
        "    return value;",
        "}",
        "",
      ].join("\n");
      const formatted = [
        "function run() {",
        "    const value = 1;",
        "    return value;",
        "}",
        "",
      ].join("\n");
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockResolvedValue([
        wholeDocumentReplacement(unformatted, formatted),
      ]);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).toHaveBeenCalledWith(
        "/workspace",
        path,
        expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
      );
    });

    it("falls back to workspace default indentation when the document has none", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const formatted = "export const value = 2;\n";
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockResolvedValue([
        wholeDocumentReplacement(unformatted, formatted),
      ]);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          defaultInsertSpaces: false,
          defaultTabSize: 8,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).toHaveBeenCalledWith(
        "/workspace",
        path,
        expect.objectContaining({ insertSpaces: false, tabSize: 8 }),
      );
    });

    it("still saves the document when the formatting provider throws", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockRejectedValue(
        new Error("formatter crashed"),
      );
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        unformatted,
      );
    });

    it("saves without formatting when no formatting provider is available for the language", async () => {
      const path = "/workspace/notes.md";
      const featuresGatewayInstance = featuresGateway();
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "# Notes\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "notes.md"));
      });
      act(() => {
        getWorkbench().updateActiveDocument("# Notes changed\n");
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(featuresGatewayInstance.formatting).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        "# Notes changed\n",
      );
    });

    it("formats PHP documents through the PHP formatting provider before saving", async () => {
      const path = "/workspace/src/User.php";
      const unformatted = "<?php\nclass User{}\n";
      const formatted = "<?php\n\nclass User\n{\n}\n";
      const runningPhpStatus: LanguageServerRuntimeStatus = {
        capabilities: { ...emptyLanguageServerCapabilities(), formatting: true },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 73,
      };
      const phpFeaturesGateway = featuresGateway();
      vi.mocked(phpFeaturesGateway.formatting).mockResolvedValue([
        wholeDocumentReplacement(unformatted, formatted),
      ]);
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        languageServerFeaturesGateway: phpFeaturesGateway,
        runtimeStatus: runningPhpStatus,
        readTextFile: vi.fn(async () => unformatted),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(phpFeaturesGateway.formatting).toHaveBeenCalledWith(
        "/workspace",
        path,
        expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
      );
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        formatted,
      );
    });

    it("does not apply or write format-on-save edits after switching project tabs while formatting is pending", async () => {
      const path = "/workspace-a/src/App.ts";
      const unformatted = "export const value=2;\n";
      const formatted = "export const value = 2;\n";
      const runningStatus: LanguageServerRuntimeStatus = {
        capabilities: { ...emptyLanguageServerCapabilities(), formatting: true },
        kind: "running",
        sessionId: 921,
      };
      const formattingResult = createDeferred<LanguageServerTextEdit[]>();
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockImplementation(
        async () => formattingResult.promise,
      );
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningStatus,
        readTextFile: vi.fn(async (requestedPath: string) =>
          requestedPath.endsWith(".ts") ? "export const value=1;\n" : "",
        ),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      // Kick off the save; formatting stays pending on the deferred promise.
      let savePromise: Promise<void> = Promise.resolve();
      await act(async () => {
        savePromise = getWorkbench().saveActiveDocument();
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(featuresGatewayInstance.formatting).toHaveBeenCalledWith(
          "/workspace-a",
          path,
          expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
        );
      });

      // Switch to another project while the formatter is still running.
      let switchPromise: Promise<void> = Promise.resolve();
      await act(async () => {
        switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      });

      // The formatter only now resolves, targeting the no-longer-active root.
      act(() => {
        formattingResult.resolve([wholeDocumentReplacement(unformatted, formatted)]);
      });
      await act(async () => {
        await Promise.all([savePromise, switchPromise]);
      });
      await flushAsyncTurns(24);

      // The stale format result must not be persisted to the inactive document.
      expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
        path,
        formatted,
      );
      const writeCalls = vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mock.calls;
      expect(writeCalls.some(([writtenPath]) => writtenPath === path)).toBe(false);

      // The active workspace stayed on /workspace-b and no /workspace-b model
      // was mutated by the stale /workspace-a formatting result.
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activeDocument?.content).not.toBe(formatted);
    });

    it("flushes the pending JavaScript and TypeScript document change to the language server before requesting format-on-save edits", async () => {
      const path = "/workspace/src/App.ts";
      const unformatted = "export const value=2;\n";
      const formatted = "export const value = 2;\n";
      const featuresGatewayInstance = featuresGateway();
      vi.mocked(featuresGatewayInstance.formatting).mockResolvedValue([
        wholeDocumentReplacement(unformatted, formatted),
      ]);
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
        javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptStatus(),
        readTextFile: vi.fn(async () => "export const value=1;\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
        },
      });
      const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      // Type into the model but never let the 150ms debounce timer fire, so a
      // pending didChange is still queued when the save is requested.
      act(() => {
        getWorkbench().updateActiveDocument(unformatted);
      });
      await flushAsyncTurns(24);

      vi.mocked(syncGateway.didChange).mockClear();

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      // The pending edit must reach the server before formatting runs, otherwise
      // the formatter operates on stale content.
      expect(syncGateway.didChange).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({
          path,
          text: unformatted,
        }),
        920,
      );
      expect(featuresGatewayInstance.formatting).toHaveBeenCalledWith(
        "/workspace",
        path,
        expect.objectContaining({ insertSpaces: true, tabSize: 4 }),
      );
      expect(vi.mocked(syncGateway.didChange).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(featuresGatewayInstance.formatting).mock.invocationCallOrder[0],
      );
    });
  });
  describe("optimize imports on save", () => {
    const phpWithUnusedImport = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use App\\Services\\UsedService;",
      "use App\\Services\\UnusedService;",
      "",
      "class Foo",
      "{",
      "    public function bar(UsedService $service): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    const phpWithOptimizedImport = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use App\\Services\\UsedService;",
      "",
      "class Foo",
      "{",
      "    public function bar(UsedService $service): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    it("optimizes PHP imports before writing when optimizeImportsOnSave is enabled", async () => {
      const path = "/workspace/src/Foo.php";
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        readTextFile: vi.fn(async () => phpWithUnusedImport),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "Foo.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(phpWithUnusedImport);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        phpWithOptimizedImport,
      );
      expect(getWorkbench().activeDocument?.content).toBe(phpWithOptimizedImport);
    });

    it("does not change PHP imports on save when optimizeImportsOnSave is disabled", async () => {
      const path = "/workspace/src/Foo.php";
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        readTextFile: vi.fn(async () => "<?php\n"),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: false,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "Foo.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(phpWithUnusedImport);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        phpWithUnusedImport,
      );
    });

    it("leaves non-PHP documents untouched even when optimizeImportsOnSave is enabled", async () => {
      const path = "/workspace/src/App.ts";
      const content = "import { used } from './used';\nused();\n";
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        readTextFile: vi.fn(async () => "export {};\n"),
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(content);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        content,
      );
    });

    it("formats first then optimizes imports on the formatted content", async () => {
      const path = "/workspace/src/Foo.php";
      const runningPhpStatus: LanguageServerRuntimeStatus = {
        capabilities: { ...emptyLanguageServerCapabilities(), formatting: true },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 91,
      };
      const phpFeaturesGateway = featuresGateway();
      const lines = phpWithUnusedImport.split("\n");
      // The formatter rewrites the whole document but still leaves the unused
      // import in place; optimize-imports must then run on that formatted output
      // and drop it before the file is written.
      vi.mocked(phpFeaturesGateway.formatting).mockResolvedValue([
        {
          newText: phpWithUnusedImport,
          range: {
            end: {
              character: lines[lines.length - 1]?.length ?? 0,
              line: lines.length - 1,
            },
            start: { character: 0, line: 0 },
          },
        },
      ]);
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        languageServerFeaturesGateway: phpFeaturesGateway,
        runtimeStatus: runningPhpStatus,
        readTextFile: vi.fn(async () => phpWithUnusedImport),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: true,
          optimizeImportsOnSave: true,
        },
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(path, "Foo.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument(phpWithUnusedImport);
      });
      await flushAsyncTurns(24);

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns(24);

      expect(phpFeaturesGateway.formatting).toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
        path,
        phpWithOptimizedImport,
      );
    });

    describe("JavaScript/TypeScript via LSP organizeImports", () => {
      const runningJavaScriptTypeScriptOrganizeStatus = (): LanguageServerRuntimeStatus => ({
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          codeAction: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 940,
      });

      const tsWithUnsortedImports = [
        "import { b } from './b';",
        "import { a } from './a';",
        "",
        "a();",
        "b();",
        "",
      ].join("\n");

      const tsWithOrganizedImports = [
        "import { a } from './a';",
        "import { b } from './b';",
        "",
        "a();",
        "b();",
        "",
      ].join("\n");

      const organizeImportsAction = (
        path: string,
        original: string,
        organized: string,
        kind = "source.organizeImports",
      ): LanguageServerCodeAction => {
        const lines = original.split("\n");

        return {
          command: null,
          data: null,
          edit: {
            changes: {
              [fileUriFromPath(path)]: [
                {
                  newText: organized,
                  range: {
                    end: {
                      character: lines[lines.length - 1]?.length ?? 0,
                      line: lines.length - 1,
                    },
                    start: { character: 0, line: 0 },
                  },
                },
              ],
            },
          },
          isPreferred: false,
          kind,
          title: "Organize Imports",
        };
      };

      const lazyOrganizeImportsAction = (): LanguageServerCodeAction => ({
        command: null,
        data: { requestId: "organize-imports" },
        edit: null,
        isPreferred: false,
        kind: "source.organizeImports",
        title: "Organize Imports",
      });

      it("organizes JS/TS imports through the LSP before writing when JS/TS organize imports on save is enabled", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([
          organizeImportsAction(path, tsWithUnsortedImports, tsWithOrganizedImports),
        ]);
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenCalledWith(
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.organizeImports"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithOrganizedImports,
        );
        expect(getWorkbench().activeDocument?.content).toBe(tsWithOrganizedImports);
      });

      it("stops JS/TS on-save source actions after the first content-changing edit", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockImplementation(
          async (_root, _path, _range, context) => {
            if (context.only?.[0] === "source.organizeImports") {
              return [organizeImportsAction(path, tsWithUnsortedImports, tsWithOrganizedImports)];
            }

            if (context.only?.[0] === "source.removeUnused.ts") {
              throw new Error("remove unused should not run after content changed");
            }

            return [];
          },
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
            javaScriptTypeScriptRemoveUnusedOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          1,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.organizeImports"] }),
        );
        expect(featuresGatewayInstance.codeActions).toHaveBeenCalledTimes(1);
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithOrganizedImports,
        );
      });

      it("continues to JS/TS sort imports on save when organize imports has no edits", async () => {
        const path = "/workspace/src/App.ts";
        const tsWithSortedImports = [
          "import { a } from './a';",
          "import { b } from './b';",
          "",
          "b();",
          "a();",
          "",
        ].join("\n");
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockImplementation(
          async (_root, _path, _range, context) => {
            if (context.only?.[0] === "source.organizeImports") {
              return [];
            }

            if (context.only?.[0] === "source.sortImports.ts") {
              return [
                organizeImportsAction(
                  path,
                  tsWithUnsortedImports,
                  tsWithSortedImports,
                  "source.sortImports.ts",
                ),
              ];
            }

            return [];
          },
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          1,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.organizeImports"] }),
        );
        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          2,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.sortImports.ts"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithSortedImports,
        );
      });

      it("continues to JS/TS remove unused on save when organize imports has no edits", async () => {
        const path = "/workspace/src/App.ts";
        const tsWithoutUnusedImport = ["import { a } from './a';", "", "a();", ""].join("\n");
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockImplementation(
          async (_root, _path, _range, context) => {
            if (context.only?.[0] === "source.organizeImports") {
              return [];
            }

            if (context.only?.[0] === "source.sortImports.ts") {
              return [];
            }

            if (context.only?.[0] === "source.removeUnused.ts") {
              return [
                organizeImportsAction(
                  path,
                  tsWithUnsortedImports,
                  tsWithoutUnusedImport,
                  "source.removeUnused.ts",
                ),
              ];
            }

            return [];
          },
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
            javaScriptTypeScriptRemoveUnusedOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          1,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.organizeImports"] }),
        );
        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          2,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.sortImports.ts"] }),
        );
        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          3,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.removeUnused.ts"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithoutUnusedImport,
        );
      });

      it("continues to JS/TS remove unused imports on save when remove unused has no edits", async () => {
        const path = "/workspace/src/App.ts";
        const tsWithoutUnusedImport = ["import { a } from './a';", "", "a();", ""].join("\n");
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockImplementation(
          async (_root, _path, _range, context) => {
            if (context.only?.[0] === "source.removeUnused.ts") {
              return [];
            }

            if (context.only?.[0] === "source.removeUnusedImports.ts") {
              return [
                organizeImportsAction(
                  path,
                  tsWithUnsortedImports,
                  tsWithoutUnusedImport,
                  "source.removeUnusedImports.ts",
                ),
              ];
            }

            return [];
          },
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptRemoveUnusedOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          1,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.removeUnused.ts"] }),
        );
        expect(featuresGatewayInstance.codeActions).toHaveBeenNthCalledWith(
          2,
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.removeUnusedImports.ts"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithoutUnusedImport,
        );
      });

      it("requests and applies JS/TS add missing imports on save", async () => {
        const path = "/workspace/src/App.ts";
        const tsWithMissingImport = ["dayjs();", ""].join("\n");
        const tsWithAddedImport = ["import dayjs from 'dayjs';", "", "dayjs();", ""].join("\n");
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([
          organizeImportsAction(
            path,
            tsWithMissingImport,
            tsWithAddedImport,
            "source.addMissingImports.ts",
          ),
        ]);
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptAddMissingImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithMissingImport);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenCalledWith(
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.addMissingImports.ts"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithAddedImport,
        );
      });

      it("requests and applies JS/TS fix all on save", async () => {
        const path = "/workspace/src/App.ts";
        const tsWithFixableIssue = ["const value: string = 1;", "console.log(value);", ""].join(
          "\n",
        );
        const tsWithFixAllApplied = ["const value: number = 1;", "console.log(value);", ""].join(
          "\n",
        );
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([
          organizeImportsAction(path, tsWithFixableIssue, tsWithFixAllApplied, "source.fixAll.ts"),
        ]);
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptFixAllOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithFixableIssue);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenCalledWith(
          "/workspace",
          path,
          expect.anything(),
          expect.objectContaining({ only: ["source.fixAll.ts"] }),
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithFixAllApplied,
        );
      });

      it("does not execute command-only JS/TS fix all actions on save", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([
          {
            command: {
              arguments: [],
              command: "_typescript.applyFixAllCodeAction",
              title: "Fix all",
            },
            data: null,
            edit: null,
            isPreferred: false,
            kind: "source.fixAll.ts",
            title: "Fix all",
          },
        ]);
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptFixAllOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.resolveCodeAction).not.toHaveBeenCalled();
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithUnsortedImports,
        );
      });

      it("resolves data-only organize-imports actions before writing", async () => {
        const path = "/workspace/src/App.ts";
        const actionToResolve = lazyOrganizeImportsAction();
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([actionToResolve]);
        vi.mocked(featuresGatewayInstance.resolveCodeAction).mockResolvedValue(
          organizeImportsAction(path, tsWithUnsortedImports, tsWithOrganizedImports),
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.resolveCodeAction).toHaveBeenCalledWith(
          "/workspace",
          actionToResolve,
        );
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithOrganizedImports,
        );
      });

      it("does not resolve command-only organize-imports actions on save", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([
          {
            command: {
              arguments: [],
              command: "_typescript.organizeImports",
              title: "Organize Imports",
            },
            data: null,
            edit: null,
            isPreferred: false,
            kind: "source.organizeImports",
            title: "Organize Imports",
          },
        ]);
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.resolveCodeAction).not.toHaveBeenCalled();
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithUnsortedImports,
        );
      });

      it("does not organize JS/TS imports on save when JS/TS on-save source actions are disabled", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: false,
            optimizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).not.toHaveBeenCalled();
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithUnsortedImports,
        );
      });

      it("still saves the JS/TS document when the organizeImports request throws", async () => {
        const path = "/workspace/src/App.ts";
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockRejectedValue(
          new Error("code action crashed"),
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningJavaScriptTypeScriptOrganizeStatus(),
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).toHaveBeenCalled();
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithUnsortedImports,
        );
      });

      it("saves without organizing when the JS/TS server lacks code action support", async () => {
        const path = "/workspace/src/App.ts";
        const noCodeActionStatus: LanguageServerRuntimeStatus = {
          capabilities: emptyLanguageServerCapabilities(),
          kind: "running",
          rootPath: "/workspace",
          sessionId: 941,
        };
        const featuresGatewayInstance = featuresGateway();
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace",
            workspaceTabs: ["/workspace"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: noCodeActionStatus,
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: noCodeActionStatus,
          readTextFile: vi.fn(async () => "export const value = 1;\n"),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().saveActiveDocument();
        });
        await flushAsyncTurns(24);

        expect(featuresGatewayInstance.codeActions).not.toHaveBeenCalled();
        expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
          path,
          tsWithUnsortedImports,
        );
      });

      it("does not apply or write organize-imports edits after switching project tabs while the request is pending", async () => {
        const path = "/workspace-a/src/App.ts";
        const runningStatus: LanguageServerRuntimeStatus = {
          capabilities: {
            ...emptyLanguageServerCapabilities(),
            codeAction: true,
          },
          kind: "running",
          sessionId: 942,
        };
        const codeActionResult = createDeferred<LanguageServerCodeAction[]>();
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockImplementation(
          async () => codeActionResult.promise,
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace-a",
            workspaceTabs: ["/workspace-a", "/workspace-b"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningStatus,
          readTextFile: vi.fn(async (requestedPath: string) =>
            requestedPath.endsWith(".ts") ? "export const value = 1;\n" : "",
          ),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        let savePromise: Promise<void> = Promise.resolve();
        await act(async () => {
          savePromise = getWorkbench().saveActiveDocument();
          await Promise.resolve();
        });
        await waitForReact(() => {
          // The organize request must target the root the save started in, not
          // whatever becomes active later.
          expect(featuresGatewayInstance.codeActions).toHaveBeenCalledWith(
            "/workspace-a",
            path,
            expect.anything(),
            expect.objectContaining({ only: ["source.organizeImports"] }),
          );
        });

        let switchPromise: Promise<void> = Promise.resolve();
        await act(async () => {
          switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
        });
        await waitForReact(() => {
          expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
        });

        act(() => {
          codeActionResult.resolve([
            organizeImportsAction(path, tsWithUnsortedImports, tsWithOrganizedImports),
          ]);
        });
        await act(async () => {
          await Promise.all([savePromise, switchPromise]);
        });
        await flushAsyncTurns(24);

        expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
        expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
          path,
          expect.anything(),
        );
      });

      it("does not write resolved organize-imports edits after switching project tabs while resolve is pending", async () => {
        const path = "/workspace-a/src/App.ts";
        const runningStatus: LanguageServerRuntimeStatus = {
          capabilities: {
            ...emptyLanguageServerCapabilities(),
            codeAction: true,
          },
          kind: "running",
          sessionId: 943,
        };
        const actionToResolve = lazyOrganizeImportsAction();
        const resolveResult = createDeferred<LanguageServerCodeAction>();
        const featuresGatewayInstance = featuresGateway();
        vi.mocked(featuresGatewayInstance.codeActions).mockResolvedValue([actionToResolve]);
        vi.mocked(featuresGatewayInstance.resolveCodeAction).mockImplementation(
          async () => resolveResult.promise,
        );
        const { dependencies, getWorkbench } = renderController({
          appSettings: {
            ...defaultAppSettings(),
            recentWorkspacePath: "/workspace-a",
            workspaceTabs: ["/workspace-a", "/workspace-b"],
          },
          javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
          javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGatewayInstance,
          javaScriptTypeScriptRuntimeStatus: runningStatus,
          readTextFile: vi.fn(async (requestedPath: string) =>
            requestedPath.endsWith(".ts") ? "export const value = 1;\n" : "",
          ),
          workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
          workspaceSettings: {
            ...defaultWorkspaceSettings(),
            autoSave: false,
            formatOnSave: false,
            javaScriptTypeScriptOrganizeImportsOnSave: true,
          },
        });
        await flushAsyncTurns(24);

        await act(async () => {
          await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
        });
        act(() => {
          getWorkbench().updateActiveDocument(tsWithUnsortedImports);
        });
        await flushAsyncTurns(24);

        let savePromise: Promise<void> = Promise.resolve();
        await act(async () => {
          savePromise = getWorkbench().saveActiveDocument();
          await Promise.resolve();
        });
        await waitForReact(() => {
          expect(featuresGatewayInstance.resolveCodeAction).toHaveBeenCalledWith(
            "/workspace-a",
            actionToResolve,
          );
        });

        let switchPromise: Promise<void> = Promise.resolve();
        await act(async () => {
          switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
        });
        await waitForReact(() => {
          expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
        });

        act(() => {
          resolveResult.resolve(
            organizeImportsAction(path, tsWithUnsortedImports, tsWithOrganizedImports),
          );
        });
        await act(async () => {
          await Promise.all([savePromise, switchPromise]);
        });
        await flushAsyncTurns(24);

        expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
        expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
          path,
          expect.anything(),
        );
      });
    });
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
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        59,
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class UserProfile {}\n");
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
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
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        60,
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "editor.save");
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
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    await waitForReact(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
      ).toHaveBeenCalledWith("/workspace", path, 331);
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
          notice.source === "JavaScript/TypeScript" && notice.message.includes("stale did close"),
      ),
    ).toBe(false);
  });
  it("ignores stale JavaScript TypeScript bulk did-close errors after workspace tab switch and session restart", async () => {
    const path = "/workspace-a/src/App.ts";
    const didClose = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(361)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(361)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(361),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(361),
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didClose).mockImplementationOnce(() => didClose.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        361,
      );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(syncGateway.didClose).toHaveBeenCalledWith("/workspace-a", path, 361);
    });

    act(() => {
      publishStatus?.(runningStatus(362));
    });
    await flushAsyncTurns();

    didClose.reject(new Error("stale bulk did close"));
    await act(async () => {
      await switchPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale bulk did close"),
      ),
    ).toBe(false);
  });
  it("coalesces overlapping workspace switches while the first didClose is pending", async () => {
    const workspaceAFirstPath = "/workspace-a/src/First.ts";
    const workspaceASecondPath = "/workspace-a/src/Second.ts";
    const workspaceBPath = "/workspace-b/src/App.ts";
    const workspaceCPath = "/workspace-c/src/App.ts";
    const firstDidClose = createDeferred<void>();
    const readTextFile = vi.fn(
      async (path: string) => `export const path = ${JSON.stringify(path)};\n`,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 363,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceAFirstPath, "First.ts"));
      await getWorkbench().openPinnedFile(fileEntry(workspaceASecondPath, "Second.ts"));
    });
    await flushAsyncTurns(24);

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didClose).mockClear();
    vi.mocked(syncGateway.didClose).mockImplementationOnce(() => firstDidClose.promise);
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mockClear();
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockImplementation(
      async (rootPath) => ({
        ...defaultWorkspaceSettings(),
        session: normalizeWorkspaceSession({
          activePath: rootPath === "/workspace-c" ? workspaceCPath : workspaceBPath,
          bottomPanelView: "problems",
          openPaths: [rootPath === "/workspace-c" ? workspaceCPath : workspaceBPath],
          sidebarView: "files",
        }),
      }),
    );

    let switchToB: Promise<void> = Promise.resolve();
    act(() => {
      switchToB = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(syncGateway.didClose).toHaveBeenCalled();
    });

    let switchToC: Promise<void> = Promise.resolve();
    act(() => {
      switchToC = getWorkbench().activateWorkspaceTab("/workspace-c");
    });
    await act(async () => {
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().activePath).toBe(workspaceASecondPath);
    expect(dependencies.settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(readTextFile).not.toHaveBeenCalledWith(workspaceCPath);
    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace-c",
      expect.objectContaining({ path: workspaceCPath }),
      363,
    );

    await act(async () => {
      firstDidClose.resolve(undefined);
      await Promise.all([switchToB, switchToC]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-c");
    expect(getWorkbench().activePath).toBe(workspaceCPath);
    expect(readTextFile).toHaveBeenCalledWith(workspaceCPath);
    expect(dependencies.settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-c");
    expect(dependencies.workspaceGateways.detection.detectWorkspace).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(vi.mocked(syncGateway.didClose).mock.calls).toEqual(
      expect.arrayContaining([
        ["/workspace-a", workspaceAFirstPath, 363],
        ["/workspace-a", workspaceASecondPath, 363],
      ]),
    );
    expect(syncGateway.didClose).toHaveBeenCalledTimes(2);
    expect(syncGateway.didClose).not.toHaveBeenCalledWith("/workspace-b", workspaceBPath, 363);
    expect(syncGateway.didClose).not.toHaveBeenCalledWith("/workspace-c", workspaceCPath, 363);
  });
  it("does not send queued JavaScript and TypeScript didOpen after switching project tabs while didClose is pending", async () => {
    const path = "/workspace-a/src/App.ts";
    const didClose = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 353,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        353,
      );
    });

    vi.mocked(syncGateway.didClose).mockImplementationOnce(() => didClose.promise);
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await waitForReact(() => {
      expect(syncGateway.didClose).toHaveBeenCalledWith("/workspace-a", path, 353);
    });
    vi.mocked(syncGateway.didOpen).mockClear();

    let reopenPromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reopenPromise = getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(4);

    expect(syncGateway.didOpen).not.toHaveBeenCalled();

    let switchPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
      await Promise.resolve();
    });
    await flushAsyncTurns();

    await act(async () => {
      didClose.resolve(undefined);
      await Promise.all([reopenPromise, switchPromise]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      353,
    );
  });
  it("shows JavaScript and TypeScript diagnostics in Problems and opens the diagnostic range", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
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

    const notice = getWorkbench().notices.find((candidate) => candidate.source === "tsserver");
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
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
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
        (notice) => notice.source === "tsserver" && notice.message.includes("Rootless diagnostic"),
      ),
    ).toBe(false);
  });
  it("clears only the closed project's JavaScript and TypeScript runtime state", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) =>
        rootPath === "/workspace-b" ? runningStatus(rootPath, 202) : runningStatus(rootPath, 101),
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

    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceAPath]).toHaveLength(1);

    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
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
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace-a", workspaceAPath, 101);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).not.toHaveBeenCalledWith("/workspace-a", expect.objectContaining({ path: workspaceAPath }));
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceAPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceBPath, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith("/workspace-b", expect.objectContaining({ path: workspaceBPath }), 202);
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

    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceAPath]).toBeUndefined();
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toHaveLength(1);
  });
  it("reveals a directory by expanding its workspace parents", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
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
      getWorkbench().revealDirectoryInTree("/workspace/src/components");
    });
    await flushAsyncTurns();

    expect([...getWorkbench().expandedDirectories]).toEqual(["/workspace", "/workspace/src"]);
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
    expect(getWorkbench().expandedDirectories.has("/workspace/src/components")).toBe(false);
    expect(readDirectory).not.toHaveBeenCalledWith("/workspace/src/components");
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
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    let initialFlushResolved = false;
    const initialFlushPromise = getWorkbench()
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
      53,
    );
    expect(initialFlushResolved).toBe(false);

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns(4);

    let changeFlushResolved = false;
    const changeFlushPromise = getWorkbench()
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
      53,
    );
    expect(vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0]).toBeLessThan(
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
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
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
      54,
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
      54,
    );
    expect(vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(syncGateway.didChange).mock.invocationCallOrder[0],
    );
  });
  it("re-opens open PHP documents after the phpactor runtime restarts with a new session", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(61)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus(61)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const path = "/workspace/app/Http/Controllers/CommentController.php";
    const secondPath = "/workspace/app/Http/Controllers/PostController.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === path) {
          return "<?php\n$comment->load();\n";
        }
        if (requestedPath === secondPath) {
          return "<?php\n$post->load();\n";
        }
        return "";
      }),
      runtimeStatus: runningStatus(61),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
      await getWorkbench().openPinnedFile(fileEntry(secondPath, "PostController.php"));
    });
    await waitForReact(() => {
      expect(vi.mocked(syncGateway.didOpen).mock.calls.map(([, value]) => value.path)).toEqual(
        expect.arrayContaining([path, secondPath]),
      );
    });

    vi.mocked(syncGateway.didOpen).mockClear();

    act(() => {
      publishRuntimeStatus?.(runningStatus(62));
    });
    await flushAsyncTurns(24);

    expect(vi.mocked(syncGateway.didOpen).mock.calls.map(([, value]) => value.path)).toEqual(
      expect.arrayContaining([path, secondPath]),
    );
  });
  it("re-opens then changes a PHP document edited after the phpactor runtime restarts", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(63)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus(63)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const path = "/workspace/app/Http/Controllers/CommentController.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus(63),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path }),
        63,
      );
    });

    vi.mocked(syncGateway.didOpen).mockClear();
    vi.mocked(syncGateway.didChange).mockClear();

    act(() => {
      publishRuntimeStatus?.(runningStatus(64));
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().updateActiveDocument("<?php\n$comment->forceDelete();\n");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().flushPendingLanguageServerDocument(path);
    });
    await flushAsyncTurns(4);

    expect(syncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
      64,
    );
    expect(syncGateway.didChange).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path,
        text: "<?php\n$comment->forceDelete();\n",
      }),
      64,
    );
    expect(vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(syncGateway.didChange).mock.invocationCallOrder[0],
    );
  });
  it("re-opens then saves a PHP document saved after the phpactor runtime restarts", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(65)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus(65)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const path = "/workspace/app/Http/Controllers/CommentController.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus(65),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path }),
        65,
      );
    });

    vi.mocked(syncGateway.didOpen).mockClear();
    vi.mocked(syncGateway.didSave).mockClear();

    act(() => {
      publishRuntimeStatus?.(runningStatus(66));
    });
    await flushAsyncTurns(24);
    act(() => {
      getWorkbench().updateActiveDocument("<?php\n$comment->refresh();\n");
    });

    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns(24);

    expect(syncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
      66,
    );
    expect(syncGateway.didSave).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
      66,
    );
    expect(vi.mocked(syncGateway.didOpen).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(syncGateway.didSave).mock.invocationCallOrder[0],
    );
  });
  it("does not re-open a PHP document for a project tab left before the phpactor restart", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 67)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 67)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const path = "/workspace-a/app/Http/Controllers/CommentController.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath.endsWith(".php") ? "<?php\n$comment->load();\n" : "",
      ),
      runtimeStatus: runningStatus("/workspace-a", 67),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const syncGateway = dependencies.documentSyncGateway;
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        67,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    vi.mocked(syncGateway.didOpen).mockClear();

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-a", 68));
    });
    await flushAsyncTurns(24);

    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      68,
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
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        56,
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
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "CommentController.php"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        57,
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
      52,
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
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        55,
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
    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockImplementation(async () => didOpen.promise);
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(syncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ path }),
        58,
      );
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await flushAsyncTurns(4);

    let flushPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      flushPromise = getWorkbench().flushPendingJavaScriptTypeScriptLanguageServerDocument(path);
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

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-a");
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
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockRejectedValueOnce(
      new Error("dispose failed"),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith("/workspace-a");
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

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-c");
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

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-c",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-b");
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-c");
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-a");
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
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([firstFile.path]);
    expect(readTextFile.mock.calls.filter(([path]) => path === firstFile.path)).toHaveLength(1);
  });
  it("preserves same-turn editor changes across a workspace switch and switch-back", async () => {
    const firstRoot = "/workspace-a";
    const secondRoot = "/workspace-b";
    const pinnedFile = fileEntry(`${firstRoot}/src/Pinned.ts`, "Pinned.ts");
    const previewFile = fileEntry(`${firstRoot}/src/Preview.ts`, "Preview.ts");
    const otherFile = fileEntry(`${secondRoot}/src/Other.ts`, "Other.ts");
    const dirtyContent = "export const pinned = 'dirty';\n";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: firstRoot,
        workspaceTabs: [firstRoot, secondRoot],
      },
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(pinnedFile);
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));

    await act(async () => {
      getWorkbench().updateActiveDocument(dirtyContent);
      await getWorkbench().previewFile(previewFile);
      await getWorkbench().activateWorkspaceTab(secondRoot);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(secondRoot);
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(getWorkbench().activePath).toBeNull();
    expect(getWorkbench().previewPath).toBeNull();
    expect(getWorkbench().editorGroups.groups).toEqual({
      "editor-main": {
        activePath: null,
        openPaths: [],
        previewPath: null,
      },
    });

    await act(async () => {
      await getWorkbench().openPinnedFile(otherFile);
    });
    expect(getWorkbench().activePath).toBe(otherFile.path);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(firstRoot);
    });
    await flushAsyncTurns(24);

    const restoredGroups = Object.values(getWorkbench().editorGroups.groups);
    expect(getWorkbench().workspaceRoot).toBe(firstRoot);
    expect(getWorkbench().activePath).toBe(previewFile.path);
    expect(getWorkbench().activeDocument?.path).toBe(previewFile.path);
    expect(getWorkbench().previewPath).toBe(previewFile.path);
    expect(getWorkbench().dirtyCount).toBe(1);
    expect(getWorkbench().openDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: dirtyContent,
          path: pinnedFile.path,
          savedContent: `// ${pinnedFile.path}\n`,
        }),
        expect.objectContaining({ path: previewFile.path }),
      ]),
    );
    expect(getWorkbench().openDocuments).toHaveLength(2);
    expect(getWorkbench().openDocuments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: otherFile.path })]),
    );
    expect(restoredGroups).toHaveLength(2);
    expect(
      restoredGroups.filter((group) => group.openPaths.includes(pinnedFile.path)),
    ).toHaveLength(2);
    expect(restoredGroups).toContainEqual(
      expect.objectContaining({
        activePath: previewFile.path,
        openPaths: [pinnedFile.path],
        previewPath: previewFile.path,
      }),
    );
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
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);
    expect(dependencies.terminalGateway.stopRoot).not.toHaveBeenCalledWith("/workspace-a");
  });
  it("uses live dirty state when closing a newly active workspace in the same tick", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    const dirtyFile = fileEntry("/workspace-b/src/Dirty.php", "Dirty.php");
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(dirtyFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(false);
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
      vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
      vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();
      await getWorkbench().closeWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(dependencies.settingsGateway.saveAppSettings).not.toHaveBeenCalled();
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);
  });
  it("uses the inactive close path for the previous workspace after a same-tick switch", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    const liveWorkspaceFile = fileEntry("/workspace-b/src/Live.php", "Live.php");
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      await getWorkbench().openPinnedFile(liveWorkspaceFile);
      vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
      vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(
      vi
        .mocked(dependencies.settingsGateway.saveWorkspaceSettings)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-a"),
    ).toBe(false);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-b"],
      }),
    );
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
    expect(getWorkbench().activePath).toBe(liveWorkspaceFile.path);
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
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-b");
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
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockRejectedValueOnce(
      new Error("dispose failed"),
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-b");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith("/workspace-b");
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
      55,
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
      55,
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mock
        .invocationCallOrder[0],
    );
  });
  it("does not restore stale JavaScript and TypeScript runtime status from a closed project tab", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toBeNull();

    workspaceBStatus.resolve(stoppedStatus("/workspace-b"));
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
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
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-a");
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
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockRejectedValueOnce(
      new Error("dispose failed"),
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith("/workspace-a");
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
  });
  it("clears the workbench and stops runtime when the last project tab closes", async () => {
    let publishMetadataScanCompletion: ((event: MetadataScanCompletionEvent) => void) | null = null;
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
      subscribeIndexProgress: vi.fn(async () => () => undefined),
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
    vi.mocked(dependencies.phpTreeGateway.getPhpTree).mockResolvedValueOnce(phpTree);
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace");
    });
    await act(async () => {
      await getWorkbench().refreshPhpTree();
    });

    expect(dependencies.phpTreeGateway.getPhpTree).toHaveBeenCalledWith("/workspace");
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
      getWorkbench().notices.some((notice) => notice.message.includes("workspace a transient")),
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
    await waitForReact(() => {
      expect(getWorkbench().phpIdeReadinessVersion).toBeGreaterThan(0);
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(getWorkbench().workspaceSettings.intelligenceMode).toBe("basic");
    expect(getWorkbench().workspaceSettings.javaScriptTypeScriptValidation).toBe(true);
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
    let publishPhpDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishJavaScriptTypeScriptDiagnostics:
      ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishPhpDiagnostics = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
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
        javaScriptTypeScript: javaScriptTypeScriptWorkspaceDescriptor().javaScriptTypeScript,
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

    expect(getWorkbench().languageServerDiagnosticsByPath[phpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[typeScriptPath]).toHaveLength(1);

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
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockRejectedValueOnce(
      new Error("dispose failed"),
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.terminalGateway.stopRoot).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
  });
});
