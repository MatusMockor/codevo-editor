// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchGateway } from "../../domain/projectSymbols";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import type { WorkspaceTrustGateway } from "../../domain/trust";
import { type FileEntry } from "../../domain/workspace";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
} from "../../test/workbenchControllerTestHarness";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  Deferred,
  applyPhpDescriptorEdits,
  createDeferred,
  directoryEntry,
  documentReadCount,
  expectBalancedPhp,
  fileEntry,
  flushFilePrefetch,
  phpWorkspaceDescriptor,
  positionAfter,
  runCommand,
} from "./testSupport";

describe("useWorkbenchController workspace sessions and PHP code actions", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("runs independent workspace-open operations concurrently", async () => {
    const trust = createDeferred<{ rootPath: string; trusted: boolean }>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn((rootPath: string) => {
        if (rootPath === "/workspace") {
          return trust.promise;
        }

        return Promise.resolve({ rootPath, trusted: true });
      }),
      setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => ({
        javaScriptTypeScript: null,
        php: null,
        rootPath,
      })),
    };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDetectionGateway,
      workspaceTrustGateway,
    });

    // Workspace detection and the JavaScript/TypeScript language server plan are
    // independent of the still-pending trust lookup, so they must run while
    // getTrust is unresolved rather than waiting for it sequentially.
    await waitForReact(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith("/workspace");
      expect(
        dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
      ).toHaveBeenCalledWith("/workspace", expect.anything());
    });

    expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace");

    await act(async () => {
      trust.resolve({ rootPath: "/workspace", trusted: true });
      await trust.promise;
    });
    await flushAsyncTurns(24);
  });
  it("does not let a stale concurrent PHP setup overwrite the active project tab", async () => {
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
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
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
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    // Resolve the first project's detection late: its PHP branch must not run
    // against the now-active second project.
    await act(async () => {
      workspaceADetection.resolve(phpWorkspaceDescriptor());
      await workspaceADetection.promise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.rootPath).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.php).toBe(null);
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalledWith("/workspace-a");
  });
  it("does not feed a stale concurrent detection result into PHP setup for the active tab", async () => {
    // Defense-in-depth: when a project's detection resolves after the active
    // workspace has moved on, its descriptor must never be returned from the
    // concurrent detection sub-task, otherwise the descriptor of the no longer
    // active project could drive the PHP setup branch for whatever project is
    // now live.
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
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
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
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.rootPath).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.php).toBe(null);

    // Resolve the stale first project's PHP detection after the second project
    // has become the live workspace. The stale PHP descriptor must not slip
    // through the concurrent detection sub-task to drive PHP setup, overwrite
    // the active descriptor, or surface PHP tooling.
    await act(async () => {
      workspaceADetection.resolve(phpWorkspaceDescriptor());
      await workspaceADetection.promise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.rootPath).toBe("/workspace-b");
    expect(getWorkbench().workspaceDescriptor?.php).toBe(null);
    expect(getWorkbench().phpTools).toBe(null);
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalledWith("/workspace-a");
  });
  it("coalesces concurrent loads for the same directory until the shared read settles", async () => {
    const directoryPath = "/workspace/src";
    const directoryRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === directoryPath) {
        return directoryRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
    });
    await flushAsyncTurns();
    readDirectory.mockClear();

    let firstLoad!: Promise<void>;
    let secondLoad!: Promise<void>;
    act(() => {
      firstLoad = getWorkbench().toggleDirectory(directoryPath);
      secondLoad = getWorkbench().toggleDirectory(directoryPath);
    });

    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(1);
      expect(getWorkbench().loadingDirectories.has(directoryPath)).toBe(true);
    });

    await act(async () => {
      directoryRead.resolve([fileEntry(`${directoryPath}/index.ts`, "index.ts")]);
      await Promise.all([firstLoad, secondLoad]);
    });

    expect(getWorkbench().loadingDirectories.has(directoryPath)).toBe(false);
    expect(getWorkbench().entriesByDirectory[directoryPath]).toEqual([
      fileEntry(`${directoryPath}/index.ts`, "index.ts"),
    ]);
  });
  it("loads different directories concurrently without coalescing them", async () => {
    const firstPath = "/workspace/src";
    const secondPath = "/workspace/tests";
    const firstRead = createDeferred<FileEntry[]>();
    const secondRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === firstPath) {
        return firstRead.promise;
      }

      if (path === secondPath) {
        return secondRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
    });
    await flushAsyncTurns();
    readDirectory.mockClear();

    let firstLoad!: Promise<void>;
    let secondLoad!: Promise<void>;
    act(() => {
      firstLoad = getWorkbench().toggleDirectory(firstPath);
      secondLoad = getWorkbench().toggleDirectory(secondPath);
    });

    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(2);
      expect(readDirectory).toHaveBeenCalledWith(firstPath);
      expect(readDirectory).toHaveBeenCalledWith(secondPath);
    });

    await act(async () => {
      firstRead.resolve([]);
      secondRead.resolve([]);
      await Promise.all([firstLoad, secondLoad]);
    });
  });
  it("evicts a failed directory read so a later load can retry", async () => {
    const directoryPath = "/workspace/src";
    const failedRead = createDeferred<FileEntry[]>();
    let directoryReadCount = 0;
    const readDirectory = vi.fn(async (path: string) => {
      if (path !== directoryPath) {
        return [];
      }

      directoryReadCount += 1;
      if (directoryReadCount === 1) {
        return failedRead.promise;
      }

      return [fileEntry(`${directoryPath}/retry.ts`, "retry.ts")];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
    });
    await flushAsyncTurns();
    readDirectory.mockClear();

    let failedLoad!: Promise<void>;
    act(() => {
      failedLoad = getWorkbench().toggleDirectory(directoryPath);
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      failedRead.reject(new Error("ENOENT: transient missing directory"));
      await failedLoad;
    });

    await act(async () => {
      await getWorkbench().toggleDirectory(directoryPath);
    });
    await act(async () => {
      await getWorkbench().toggleDirectory(directoryPath);
    });

    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(getWorkbench().entriesByDirectory[directoryPath]).toEqual([
      fileEntry(`${directoryPath}/retry.ts`, "retry.ts"),
    ]);
  });
  it("shares a read between callers with different message policies", async () => {
    const directoryPath = "/workspace/src";
    const directoryRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return [directoryEntry(directoryPath, "src")];
      }

      if (path === directoryPath) {
        return directoryRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
    });
    await flushAsyncTurns();
    readDirectory.mockClear();

    let interactiveLoad!: Promise<void>;
    act(() => {
      getWorkbench().revealDirectoryInTree(`${directoryPath}/index.ts`);
      interactiveLoad = getWorkbench().toggleDirectory(directoryPath);
    });

    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      directoryRead.resolve([]);
      await interactiveLoad;
    });
  });
  it("shares the active-root workspace read with a default-policy refresh", async () => {
    const rootPath = "/workspace";
    const rootRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === rootPath) {
        return rootRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: rootPath,
      },
      readDirectory,
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    const refreshCommand = getWorkbench().commands.find(
      (command) => command.id === "workspace.refresh",
    );
    expect(refreshCommand).toBeDefined();
    let refresh!: void | Promise<void>;
    act(() => {
      refresh = refreshCommand?.run();
    });

    await Promise.resolve();
    expect(readDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      rootRead.resolve([]);
      await refresh;
    });
  });
  it("coalesces normalized-equivalent paths and clears canonical loading state", async () => {
    const directoryPath = "/workspace/src";
    const equivalentPath = `${directoryPath}/`;
    const directoryRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === directoryPath) {
        return directoryRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
    });
    await flushAsyncTurns();
    readDirectory.mockClear();

    let firstLoad!: Promise<void>;
    let secondLoad!: Promise<void>;
    act(() => {
      firstLoad = getWorkbench().toggleDirectory(directoryPath);
      secondLoad = getWorkbench().toggleDirectory(equivalentPath);
    });

    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledTimes(1);
      expect(readDirectory).toHaveBeenCalledWith(directoryPath);
      expect(getWorkbench().loadingDirectories.has(directoryPath)).toBe(true);
      expect(getWorkbench().loadingDirectories.has(equivalentPath)).toBe(false);
    });

    await act(async () => {
      directoryRead.resolve([]);
      await Promise.all([firstLoad, secondLoad]);
    });

    expect(getWorkbench().loadingDirectories.has(directoryPath)).toBe(false);
    expect(getWorkbench().loadingDirectories.has(equivalentPath)).toBe(false);
  });
  it("keeps a canonical loading flag while a newer generation still owns it", async () => {
    const rootPath = "/workspace";
    const otherRoot = "/other";
    const firstRead = createDeferred<FileEntry[]>();
    const secondRead = createDeferred<FileEntry[]>();
    let rootReadCount = 0;
    const readDirectory = vi.fn(async (path: string) => {
      if (path !== rootPath) {
        return [];
      }

      rootReadCount += 1;
      return rootReadCount === 1 ? firstRead.promise : secondRead.promise;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: rootPath,
        workspaceTabs: [rootPath, otherRoot],
      },
      readDirectory,
    });
    await waitForReact(() => {
      expect(rootReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(otherRoot);
    });

    let switchBack!: Promise<void>;
    act(() => {
      switchBack = getWorkbench().activateWorkspaceTab(rootPath);
    });
    await waitForReact(() => {
      expect(rootReadCount).toBe(2);
      expect(getWorkbench().loadingDirectories.has(rootPath)).toBe(true);
    });

    await act(async () => {
      firstRead.resolve([]);
      await firstRead.promise;
    });
    expect(getWorkbench().loadingDirectories.has(rootPath)).toBe(true);

    await act(async () => {
      secondRead.resolve([]);
      await switchBack;
    });
    await waitForReact(() => {
      expect(getWorkbench().loadingDirectories.has(rootPath)).toBe(false);
    });
  });
  it("drops a stale subdirectory result after switching to its parent workspace", async () => {
    const nestedRoot = "/workspace/packages/app";
    const parentRoot = "/workspace";
    const staleDirectoryPath = `${nestedRoot}/src`;
    const staleRead = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === staleDirectoryPath) {
        return staleRead.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: nestedRoot,
        workspaceTabs: [nestedRoot, parentRoot],
      },
      readDirectory,
    });
    await flushAsyncTurns();

    let staleLoad!: Promise<void>;
    act(() => {
      staleLoad = getWorkbench().toggleDirectory(staleDirectoryPath);
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith(staleDirectoryPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(parentRoot);
    });
    expect(getWorkbench().workspaceRoot).toBe(parentRoot);

    await act(async () => {
      staleRead.resolve([fileEntry(`${staleDirectoryPath}/stale.ts`, "stale.ts")]);
      await staleLoad;
    });

    expect(getWorkbench().entriesByDirectory[staleDirectoryPath]).toBeUndefined();
  });
  it("does not let a stale parent-workspace directory load overwrite the active nested tab", async () => {
    // loadDirectory's internal guard only checks subtree membership
    // (workspacePathBelongsToRoot). When switching from a nested project to its
    // parent, the nested root still "belongs to" the parent root, so the
    // concurrent directory-load sub-task needs its own exact-root re-check guard
    // to stop the stale nested entries from leaking into the parent workspace.
    const nestedRoot = "/workspace/packages/app";
    const parentRoot = "/workspace";
    const nestedDirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === nestedRoot) {
        return nestedDirectory.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: nestedRoot,
        workspaceTabs: [nestedRoot, parentRoot],
      },
      readDirectory,
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith(nestedRoot);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(parentRoot);
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith(parentRoot);
    });

    expect(getWorkbench().workspaceRoot).toBe(parentRoot);

    // Resolve the stale nested project's directory load after the parent
    // project has become active. The nested entries must not surface in the
    // now-active parent workspace tree.
    await act(async () => {
      nestedDirectory.resolve([directoryEntry(`${nestedRoot}/src`, "src")]);
      await nestedDirectory.promise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(parentRoot);
    expect(getWorkbench().entriesByDirectory[nestedRoot]).toBeUndefined();
    expect(
      Object.keys(getWorkbench().entriesByDirectory).some((directory) =>
        directory.startsWith(`${nestedRoot}/`),
      ),
    ).toBe(false);
  });
  it("restores session documents in parallel", async () => {
    const reads: Array<{ deferred: Deferred<string>; path: string }> = [];
    const readTextFile = vi.fn((path: string) => {
      const deferred = createDeferred<string>();
      reads.push({ deferred, path });
      return deferred.promise;
    });
    const firstPath = "/workspace/src/First.ts";
    const secondPath = "/workspace/src/Second.ts";
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      session: {
        activePath: secondPath,
        bottomPanelView: "problems" as const,
        openPaths: [firstPath, secondPath],
        sidebarView: "files" as const,
      },
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceSettings,
    });

    // Both reads must be in flight before either resolves, proving the loop is
    // parallel rather than awaiting each file one at a time.
    await waitForReact(() => {
      expect(reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([firstPath, secondPath]),
      );
    });
    expect(reads).toHaveLength(2);

    await act(async () => {
      reads[1].deferred.resolve("export const second = 2;\n");
      reads[0].deferred.resolve("export const first = 1;\n");
      await Promise.all(reads.map((read) => read.deferred.promise));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      firstPath,
      secondPath,
    ]);
    expect(getWorkbench().activePath).toBe(secondPath);
    expect(getWorkbench().notices.some((notice) => notice.source === "Session")).toBe(false);
  });
  it("restores a session document revision for the next trusted save", async () => {
    const path = "/workspace/src/Restored.ts";
    const restoredRevision = {
      device: "1",
      inode: "2",
      size: 24,
      modifiedSeconds: 3,
      modifiedNanoseconds: 4,
      contentHash: "5",
    };
    const savedRevision = { ...restoredRevision, size: 23, contentHash: "6" };
    const readTextFileSnapshot = vi.fn(async () => ({
      content: "export const value = 1;\n",
      revision: restoredRevision,
    }));
    const writeTextFile = vi.fn(async () => ({
      status: "success" as const,
      revision: savedRevision,
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceFiles: { readTextFileSnapshot, writeTextFile },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
        formatOnSave: false,
        optimizeImportsOnSave: false,
        session: {
          activePath: path,
          bottomPanelView: "problems",
          openPaths: [path],
          sidebarView: "files",
        },
      },
    });

    await flushAsyncTurns(24);

    expect(readTextFileSnapshot).toHaveBeenCalledWith(path);
    expect(getWorkbench().activeDocument).toMatchObject({
      path,
      revision: restoredRevision,
    });

    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });

    expect(writeTextFile).toHaveBeenCalledWith(path, "export const value = 2;\n", restoredRevision);
    expect(getWorkbench().activeDocument?.revision).toEqual(savedRevision);
  });
  it("restores a persisted preview only when it belongs to the restored paths", async () => {
    const pinnedPath = "/workspace/src/Pinned.ts";
    const previewPath = "/workspace/src/Preview.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: previewPath,
          bottomPanelView: "problems",
          openPaths: [pinnedPath, previewPath],
          previewPath,
          sidebarView: "files",
        },
      },
    });

    await flushAsyncTurns(24);

    expect(getWorkbench().activePath).toBe(previewPath);
    expect(getWorkbench().previewPath).toBe(previewPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      pinnedPath,
      previewPath,
    ]);
  });
  it("ignores a persisted preview outside the restored paths", async () => {
    const pinnedPath = "/workspace/src/Pinned.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: pinnedPath,
          bottomPanelView: "problems",
          openPaths: [pinnedPath],
          previewPath: "/workspace/src/Missing.ts",
          sidebarView: "files",
        },
      },
    });

    await flushAsyncTurns(24);

    expect(getWorkbench().previewPath).toBeNull();
  });
  it("snapshots preview and view positions on workspace switch without leaking them", async () => {
    const firstRoot = "/workspace-a";
    const secondRoot = "/workspace-b";
    const preview = fileEntry(`${firstRoot}/src/Preview.ts`, "Preview.ts");
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: firstRoot,
        workspaceTabs: [firstRoot, secondRoot],
      },
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().previewFile(preview);
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().updateEditorViewState(preview.path, {
        column: 6,
        line: 4,
        scrollTop: 180,
      });
    });
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(secondRoot);
    });
    await flushAsyncTurns(24);

    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
      firstRoot,
      expect.objectContaining({
        session: expect.objectContaining({
          editor: expect.objectContaining({
            groups: expect.objectContaining({
              "editor-main": expect.objectContaining({
                activePath: preview.path,
                openPaths: [],
                previewPath: preview.path,
              }),
            }),
          }),
          viewStates: {
            "editor-main": {
              [preview.path]: { column: 6, line: 4, scrollTop: 180 },
            },
          },
        }),
      }),
    );
    expect(getWorkbench().workspaceRoot).toBe(secondRoot);
    expect(getWorkbench().restoredEditorViewStates[preview.path]).toBeUndefined();
  });
  it("opens a hover-prefetched file from cache without a second read", async () => {
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    const file = fileEntry("/workspace/src/User.php", "User.php");

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextFile).toHaveBeenCalledWith(file.path);

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(1);
    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().activeDocument?.content).toContain(file.path);
  });
  it("re-reads when Quick Open finds empty prefetched content for a non-empty file", async () => {
    const path = "/workspace/app/Http/Controllers/publicapi/AiHub/CommentController.php";
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    const file = fileEntry(path, "CommentController.php");

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextFile).toHaveBeenCalledWith(path);

    contentsByPath[path] =
      "<?php\nnamespace App\\Http\\Controllers\\publicapi\\AiHub;\n\nfinal class CommentController {}\n";

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/publicapi/AiHub/CommentController.php",
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(2);
    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().activeDocument?.content).toContain("final class CommentController");
  });
  it("invalidates the prefetch cache for a file after it is saved", async () => {
    const contentsByPath: Record<string, string> = {
      "/workspace/src/User.php": "<?php\n// original\n",
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

    const file = fileEntry("/workspace/src/User.php", "User.php");

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(1);

    await act(async () => {
      getWorkbench().updateActiveDocument("<?php\n// edited\n");
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });
    await flushAsyncTurns();

    await act(async () => {
      getWorkbench().closeDocument(file.path);
    });
    await flushAsyncTurns();

    contentsByPath["/workspace/src/User.php"] = "<?php\n// fresh from disk\n";

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toContain("fresh from disk");
  });
  it("does not serve prefetched content from an inactive workspace after switching", async () => {
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

    const sharedPath = "/shared/User.php";
    const file = fileEntry(sharedPath, "User.php");

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    expect(readTextFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    readTextFile.mockClear();

    await act(async () => {
      getWorkbench().prefetchFile(file);
    });
    await flushFilePrefetch();

    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextFile).toHaveBeenCalledWith(sharedPath);
  });
  it("does not prefetch large binary files", async () => {
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    const binary = fileEntry("/workspace/assets/logo.png", "logo.png");

    await act(async () => {
      getWorkbench().prefetchFile(binary);
    });
    await flushFilePrefetch();

    expect(readTextFile).not.toHaveBeenCalled();
  });
  it("increases, decreases, and resets the editor font size and persists it", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        editorFontSize: 14,
      },
    });
    await flushAsyncTurns();

    const runCommand = async (id: string) => {
      const command = getWorkbench().commands.find((candidate) => candidate.id === id);
      await act(async () => {
        await command?.run();
        await Promise.resolve();
      });
    };

    await runCommand("editor.fontZoomIn");
    expect(getWorkbench().appSettings.editorFontSize).toBe(15);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ editorFontSize: 15 }),
    );

    await runCommand("editor.fontZoomOut");
    await runCommand("editor.fontZoomOut");
    expect(getWorkbench().appSettings.editorFontSize).toBe(13);

    await runCommand("editor.fontZoomReset");
    expect(getWorkbench().appSettings.editorFontSize).toBe(14);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ editorFontSize: 14 }),
    );
  });
  it("clamps the editor font size to the supported range", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        editorFontSize: 39,
      },
    });
    await flushAsyncTurns();

    const runCommand = async (id: string) => {
      const command = getWorkbench().commands.find((candidate) => candidate.id === id);
      await act(async () => {
        await command?.run();
        await Promise.resolve();
      });
    };

    await runCommand("editor.fontZoomIn");
    await runCommand("editor.fontZoomIn");
    await runCommand("editor.fontZoomIn");
    expect(getWorkbench().appSettings.editorFontSize).toBe(40);
  });
  it("toggles editor font ligatures from a registered command and persists it", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        editorFontLigatures: false,
      },
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.toggleFontLigatures",
    );

    expect(command?.title).toBe("Toggle Editor Font Ligatures");
    expect(command?.category).toBe("Editor");

    await act(async () => {
      await command?.run();
      await Promise.resolve();
    });

    expect(getWorkbench().appSettings.editorFontLigatures).toBe(true);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ editorFontLigatures: true }),
    );
  });
  it("opens Appearance settings from a registered command", async () => {
    const { getWorkbench } = renderController();
    await flushAsyncTurns();

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "workbench.openAppearanceSettings",
    );

    expect(command?.title).toBe("Open Appearance Settings");
    expect(command?.category).toBe("Workbench");

    await act(async () => {
      await command?.run();
      await Promise.resolve();
    });

    expect(getWorkbench().settingsOpen).toBe(true);
    expect(getWorkbench().settingsInitialSection).toBe("appearance");
  });
  it("offers an extract-interface code action that creates a sibling interface file and adds implements", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi {$name}";
    }

    public function farewell(string $name): string
    {
        return "Bye {$name}";
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === "/workspace/app/Services/GreeterInterface.php") {
          throw new Error("ENOENT");
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const extractInterface = actions.find((action) => action.title === "Extract interface");
    expect(extractInterface).toBeDefined();
    expect(extractInterface?.newFile?.path).toBe("/workspace/app/Services/GreeterInterface.php");
    expect(extractInterface?.newFile?.content).toContain("namespace App\\Services;");
    expect(extractInterface?.newFile?.content).toContain("interface GreeterInterface");
    expect(extractInterface?.newFile?.content).toContain(
      "public function greet(string $name): string;",
    );
    expect(extractInterface?.newFile?.content).toContain(
      "public function farewell(string $name): string;",
    );
    expect(extractInterface?.edits[0]?.text).toContain("implements GreeterInterface");
  });
  it("offers and applies a Create class quick fix on a `new UnknownClass()` reference", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const targetPath = "/workspace/app/Services/MailDispatcher.php";
    const targetContent = "<?php\n\nnamespace App\\Services;\n\nclass MailDispatcher\n{\n}\n";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $service = new MailDispatcher();
    }
}
`;
    const diskContents = new Map<string, string>();
    const writeTextFile = vi.fn(async (path: string, content: string) => {
      diskContents.set(path, content);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        const written = diskContents.get(path);

        if (written !== undefined) {
          return written;
        }

        // The target class does not exist yet on disk.
        if (path === targetPath) {
          throw new Error("ENOENT");
        }

        throw new Error("ENOENT");
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceFiles: { writeTextFile },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("MailDispatcher");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const createClass = actions.find((action) => action.title === "Create class MailDispatcher");
    expect(createClass).toBeDefined();
    expect(createClass?.isPreferred).toBe(true);
    expect(createClass?.kind).toBe("quickfix");
    expect(createClass?.edits).toEqual([]);
    expect(createClass?.newFile?.path).toBe(targetPath);
    expect(createClass?.newFile?.content).toBe(targetContent);

    await act(async () => {
      await getWorkbench().applyPhpCodeActionNewFile(createClass!.newFile!);
    });
    await flushAsyncTurns();

    expect(writeTextFile).toHaveBeenCalledWith(targetPath, targetContent);
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().activeDocument?.path).toBe(targetPath);
    expect(getWorkbench().activeDocument?.content).toBe(targetContent);
  });
  it("resolves the destination through a use-import alias for Create class", async () => {
    const classPath = "/workspace/app/Http/Controller.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Services\\Mailer as Sender;

class Controller
{
    public function run(): void
    {
        $service = new Sender();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        throw new Error("ENOENT");
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Controller.php"));
    });

    const cursor = classSource.indexOf("new Sender") + "new ".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const createClass = actions.find((action) => action.title.startsWith("Create class"));
    expect(createClass?.title).toBe("Create class Mailer");
    expect(createClass?.newFile?.path).toBe("/workspace/app/Services/Mailer.php");
    expect(createClass?.newFile?.content).toContain("namespace App\\Services;");
    expect(createClass?.newFile?.content).toContain("class Mailer");
  });
  it("offers Create interface on an `implements UnknownInterface` reference", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter implements Greetable
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        throw new Error("ENOENT");
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("Greetable");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const createInterface = actions.find((action) => action.title.startsWith("Create interface"));
    expect(createInterface?.title).toBe("Create interface Greetable");
    expect(createInterface?.newFile?.path).toBe("/workspace/app/Services/Greetable.php");
    expect(createInterface?.newFile?.content).toContain("interface Greetable");
  });
  it("offers no Create class quick fix when the referenced class already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const targetPath = "/workspace/app/Services/Mailer.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $service = new Mailer();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // The referenced class already exists at its PSR-4 path.
        if (path === targetPath) {
          return "<?php\n\nnamespace App\\Services;\n\nclass Mailer\n{\n}\n";
        }

        throw new Error("ENOENT");
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("new Mailer") + "new ".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title.startsWith("Create class"))).toBe(false);
  });
  it("offers no Create class quick fix for a PHP built-in (\\Exception)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        throw new \\Exception('boom');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : Promise.reject(new Error("ENOENT")),
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("Exception");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title.startsWith("Create"))).toBe(false);
  });
  it("offers no Create class quick fix when the PSR-4 destination is unknown (vendor namespace)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $client = new \\Vendor\\Sdk\\Client();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : Promise.reject(new Error("ENOENT")),
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("Vendor");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title.startsWith("Create class"))).toBe(false);
  });
  it("writes the Create class skeleton file with no in-document edit", async () => {
    const skeletonPath = "/workspace/app/Services/MailDispatcher.php";
    const skeletonContent = "<?php\n\nnamespace App\\Services;\n\nclass MailDispatcher\n{\n}\n";
    const { getWorkbench, dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        // The skeleton target does not exist yet (existence probe rejects).
        if (path === skeletonPath) {
          throw new Error("ENOENT");
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockClear();

    let written: boolean | undefined;
    await act(async () => {
      written = await getWorkbench().applyPhpCodeActionNewFile({
        content: skeletonContent,
        path: skeletonPath,
      });
    });

    expect(written).toBe(true);
    expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
      skeletonPath,
      skeletonContent,
    );
  });
  it("drops a stale Create class offer after switching workspace tabs mid-probe", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const targetPath = "/workspace/app/Services/MailDispatcher.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $service = new MailDispatcher();
    }
}
`;
    const existenceProbe = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // Block the existence/destination probe so we can switch tabs mid-flight.
        if (path === targetPath) {
          return existenceProbe.promise;
        }

        throw new Error("ENOENT");
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("MailDispatcher");
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: cursor,
        start: cursor,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(targetPath);
    });

    // Switch to another workspace before the probe resolves.
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    await act(async () => {
      existenceProbe.reject(new Error("ENOENT"));
    });
    await flushAsyncTurns();

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
    // The stale offer must not write into the now-inactive workspace.
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
      targetPath,
      expect.anything(),
    );
  });
  it("offers a remove-unused-import quick-fix on an unused use line", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Models\\Used;
use App\\Models\\Unused;

class Greeter
{
    public function greet(Used $used): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("App\\Models\\Unused");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const removeImport = actions.find((action) => action.title.startsWith("Remove unused import"));
    expect(removeImport?.title).toBe("Remove unused import App\\Models\\Unused");

    const edit = removeImport?.edits[0];
    expect(edit?.text).toBe("");
    expect(edit?.range).toEqual({
      startColumn: 1,
      startLineNumber: 6,
      endColumn: 1,
      endLineNumber: 7,
    });
  });
  it("offers no remove-unused-import quick-fix when the cursor sits on a used import", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Models\\Used;

class Greeter
{
    public function greet(Used $used): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("App\\Models\\Used");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title.startsWith("Remove unused import"))).toBe(false);
  });
  it("offers a remove-unused-method quick-fix on an unused private method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): void
    {
    }

    private function helper(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("function helper") + "function ".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const removeMethod = actions.find((action) => action.title.startsWith("Remove unused method"));
    expect(removeMethod?.title).toBe("Remove unused method 'helper'");
    expect(removeMethod?.edits[0]?.text).toBe("");
  });
  it("offers a remove-unused-variable quick-fix on a side-effect-free unused local", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): int
    {
        $unused = 5;
        return 1;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("$unused");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    const removeVariable = actions.find((action) =>
      action.title.startsWith("Remove unused variable"),
    );
    expect(removeVariable?.title).toBe("Remove unused variable $unused");
    expect(removeVariable?.edits[0]?.text).toBe("");
  });
  it("does not offer a remove-unused-variable quick-fix for a side-effecting assignment", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): int
    {
        $unused = $this->compute();
        return 1;
    }

    private function compute(): int
    {
        return 5;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("$unused");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title.startsWith("Remove unused variable"))).toBe(false);
  });
  it("persists an extract-interface new file to disk and opens it in a tab", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi {$name}";
    }
}
`;
    const diskContents = new Map<string, string>();
    const writeTextFile = vi.fn(async (path: string, content: string) => {
      diskContents.set(path, content);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        const written = diskContents.get(path);

        if (written !== undefined) {
          return written;
        }

        // The interface does not exist yet, so the existence probe must reject
        // (mirrors the gateway rejecting a missing path) and the write path runs.
        if (path === interfacePath) {
          throw new Error("ENOENT");
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceFiles: { writeTextFile },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });
    const extractInterface = actions.find((action) => action.title === "Extract interface");
    expect(extractInterface?.newFile).toBeDefined();

    await act(async () => {
      await getWorkbench().applyPhpCodeActionNewFile(extractInterface!.newFile!);
    });
    await flushAsyncTurns();

    // The interface is a REAL file on disk (written via the gateway), not an
    // in-memory monaco model that would vanish on reopen.
    expect(writeTextFile).toHaveBeenCalledWith(
      interfacePath,
      expect.stringContaining("interface GreeterInterface"),
    );
    // And it is opened in a tab (PhpStorm parity).
    expect(getWorkbench().activePath).toBe(interfacePath);
  });
  it("does not offer extract interface when the sibling interface already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi {$name}";
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // The sibling interface already exists: the preflight probe resolves,
        // so the action must not be offered.
        if (path === interfacePath) {
          return "<?php\n\ninterface GreeterInterface\n{\n    // hand-edited\n}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });
    const extractInterface = actions.find((action) => action.title === "Extract interface");

    expect(extractInterface).toBeUndefined();
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
      interfacePath,
      expect.anything(),
    );
    expect(getWorkbench().activePath).toBe(classPath);
  });
  it("drops a stale extract-interface disk write after switching workspace tabs", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi {$name}";
    }
}
`;
    const existenceProbe = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // Block the existence probe so we can switch workspaces mid-flight.
        if (path === interfacePath) {
          return existenceProbe.promise;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("class Greeter");
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: cursor,
        start: cursor,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    // Switch to another workspace before the preflight probe resolves.
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    await act(async () => {
      existenceProbe.reject(new Error("ENOENT"));
    });
    await flushAsyncTurns();

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
    // The stale creation must not write into the now-inactive workspace.
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
      interfacePath,
      expect.anything(),
    );
  });
  it("offers no extract-interface code action for an abstract class", async () => {
    const classPath = "/workspace/app/Services/Base.php";
    const classSource = `<?php

namespace App\\Services;

abstract class Base
{
    public function run(): void {}
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Base.php"));
    });

    const cursor = classSource.indexOf("class Base");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title === "Extract interface")).toBe(false);
  });
  it("offers no extract-interface code action when the class has no public instance methods", async () => {
    const classPath = "/workspace/app/Services/OnlyPrivate.php";
    const classSource = `<?php

namespace App\\Services;

class OnlyPrivate
{
    private function secret(): void {}

    public function __construct() {}
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "OnlyPrivate.php"));
    });

    const cursor = classSource.indexOf("class OnlyPrivate");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });

    expect(actions.some((action) => action.title === "Extract interface")).toBe(false);
  });
  it("offers an implement-methods code action for an unimplemented interface", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === interfacePath) {
          return `<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Implement methods");
    const insertEdit = actions[0]?.edits[0];
    expect(insertEdit?.text).toContain("public function greet(string $name): string");
    expect(insertEdit?.range).toEqual({
      endColumn: 1,
      endLineNumber: 9,
      startColumn: 1,
      startLineNumber: 9,
    });
  });
  it("offers signature synchronization without including method decorators or body in replacement edits", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    /** preserved */
    #[Audit]
    private function greet(int $name = 1): bool
    {
        return false;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === interfacePath) {
          return `<?php

namespace App\\Contracts;

interface GreeterContract
{
    public static function greet(string $name = ''): void;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const cursor = classSource.indexOf("function greet");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: cursor,
      start: cursor,
    });
    const action = actions.find((candidate) =>
      candidate.title.startsWith("Synchronize signature with"),
    );

    expect(action?.title).toBe("Synchronize signature with GreeterContract::greet");
    expect(action?.edits.some((edit) => edit.text.includes("#[Audit]"))).toBe(false);
    expect(action?.edits.some((edit) => edit.text.includes("return false"))).toBe(false);
    expect(
      action?.edits.some((edit) =>
        edit.text.includes("public static function greet(string $name = 1): void"),
      ),
    ).toBe(true);
  });
  it("adds a use import for stub types that are not imported in the class", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === interfacePath) {
          return `<?php

namespace App\\Contracts;

use App\\Models\\Greeting;

interface GreeterContract
{
    public function greet(): Greeting;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions).toHaveLength(1);
    const importEdit = actions[0]?.edits.find((edit) =>
      edit.text.includes("use App\\Models\\Greeting;"),
    );
    expect(importEdit).toBeDefined();
    const stubEdit = actions[0]?.edits.find((edit) =>
      edit.text.includes("public function greet(): Greeting"),
    );
    expect(stubEdit).toBeDefined();
  });
  it("offers no implement-methods code action when every interface method is implemented", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    public function greet(string $name): string
    {
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === interfacePath) {
          return `<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    await expect(getWorkbench().providePhpCodeActions(classSource)).resolves.toEqual([]);
  });
  it("offers no implement-methods code action for a class without supertypes", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    await expect(getWorkbench().providePhpCodeActions(classSource)).resolves.toEqual([]);
  });
  it("drops stale implement-methods code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("offers an override-methods code action for concrete parent methods", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const parentPath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === parentPath) {
          return `<?php

namespace App\\Services;

class BaseService
{
    public function handle(string $name): string
    {
        return $name;
    }

    protected function boot(): void
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const overrideAction = actions.find((action) => action.title === "Override methods");
    expect(overrideAction).toBeDefined();
    const overrideText = overrideAction?.edits[0]?.text ?? "";
    expect(overrideText).toContain("public function handle(string $name): string");
    expect(overrideText).toContain("return parent::handle($name);");
    expect(overrideText).toContain("protected function boot(): void");
    expect(overrideText).toContain("parent::boot();");
    expect(overrideText).toContain("@inheritDoc");
  });
  it("omits final, private and already-overridden parent methods from the override action", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const parentPath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
    public function alreadyOverridden(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === parentPath) {
          return `<?php

namespace App\\Services;

class BaseService
{
    final public function sealed(): void
    {
    }

    private function hidden(): void
    {
    }

    public function alreadyOverridden(): void
    {
    }

    public function overridable(): int
    {
        return 1;
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const overrideAction = actions.find((action) => action.title === "Override methods");
    expect(overrideAction).toBeDefined();
    const overrideText = overrideAction?.edits[0]?.text ?? "";
    expect(overrideText).toContain("public function overridable(): int");
    expect(overrideText).toContain("return parent::overridable();");
    expect(overrideText).not.toContain("sealed");
    expect(overrideText).not.toContain("hidden");
    expect(overrideText).not.toContain("alreadyOverridden");
  });
  it("offers no override-methods code action for a class without a parent", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Override methods")).toBe(false);
  });
  it("offers no override-methods code action when the parent exposes nothing overridable", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const parentPath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === parentPath) {
          return `<?php

namespace App\\Services;

abstract class BaseService
{
    abstract public function handle(): void;

    final public function sealed(): void
    {
    }

    private function hidden(): void
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Override methods")).toBe(false);
  });
  it("drops stale override-methods code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Child.php";
    const parentPath = "/workspace-a/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
}
`;
    const parentRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === parentPath) {
        return parentRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(parentPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    parentRead.resolve(`<?php

namespace App\\Services;

class BaseService
{
    public function handle(): void
    {
    }
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("navigates from an overriding method to the parent class super method", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const parentPath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
    public function handle(string $name): string
    {
        return parent::handle($name);
    }
}
`;
    const parentSource = `<?php

namespace App\\Services;

class BaseService
{
    public function handle(string $name): string
    {
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === parentPath) {
          return parentSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(classSource, "function handle"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "editor.goToSuperMethod");
    });

    expect(getWorkbench().activePath).toBe(parentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: parentPath,
      position: positionAfter(parentSource, "function "),
    });
  });
  it("navigates from an implementing method to the interface declaration", async () => {
    const classPath = "/workspace/app/Services/FileMailer.php";
    const interfacePath = "/workspace/app/Contracts/Mailer.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\Mailer;

class FileMailer implements Mailer
{
    public function send(string $body): void
    {
    }
}
`;
    const interfaceSource = `<?php

namespace App\\Contracts;

interface Mailer
{
    public function send(string $body): void;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
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
      await getWorkbench().openFile(fileEntry(classPath, "FileMailer.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(classSource, "function send"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "editor.goToSuperMethod");
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: positionAfter(interfaceSource, "function "),
    });
  });
  it("navigates from a method to the trait that declares it", async () => {
    const classPath = "/workspace/app/Services/Reporter.php";
    const traitPath = "/workspace/app/Concerns/FormatsReports.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Concerns\\FormatsReports;

class Reporter
{
    use FormatsReports;

    public function format(string $body): string
    {
        return $body;
    }
}
`;
    const traitSource = `<?php

namespace App\\Concerns;

trait FormatsReports
{
    public function format(string $body): string
    {
        return strtoupper($body);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === traitPath) {
          return traitSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Reporter.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(classSource, "function format"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "editor.goToSuperMethod");
    });

    expect(getWorkbench().activePath).toBe(traitPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: traitPath,
      position: positionAfter(traitSource, "function "),
    });
  });
  it("walks the hierarchy to the nearest ancestor that declares the super method", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const middlePath = "/workspace/app/Services/MiddleService.php";
    const basePath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends MiddleService
{
    public function handle(): void
    {
    }
}
`;
    const middleSource = `<?php

namespace App\\Services;

class MiddleService extends BaseService
{
    public function other(): void
    {
    }
}
`;
    const baseSource = `<?php

namespace App\\Services;

class BaseService
{
    public function handle(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === middlePath) {
          return middleSource;
        }

        if (path === basePath) {
          return baseSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(classSource, "function handle"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "editor.goToSuperMethod");
    });

    expect(getWorkbench().activePath).toBe(basePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: basePath,
      position: positionAfter(baseSource, "function "),
    });
  });
  it("shows a notice when the current method does not override a super method", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const parentPath = "/workspace/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
    public function uniqueToChild(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        if (path === parentPath) {
          return `<?php

namespace App\\Services;

class BaseService
{
    public function handle(): void
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(classSource, "function uniqueToChild"),
      );
    });

    await act(async () => {
      await runCommand(getWorkbench(), "editor.goToSuperMethod");
    });

    expect(getWorkbench().activePath).toBe(classPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").toContain("No super method");
  });
  it("drops stale go to super method targets after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Child.php";
    const parentPath = "/workspace-a/app/Services/BaseService.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends BaseService
{
    public function handle(): void
    {
    }
}
`;
    const parentRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === parentPath) {
        return parentRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(classSource, "function handle"));
    });

    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = runCommand(getWorkbench(), "editor.goToSuperMethod");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(parentPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    parentRead.resolve(`<?php

namespace App\\Services;

class BaseService
{
    public function handle(): void
    {
    }
}
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(parentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No super method");
  });
  it("offers a generate getters and setters action for properties without accessors", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const accessorAction = actions.find(
      (action) => action.title === "Generate getters and setters",
    );
    expect(accessorAction).toBeDefined();
    const accessorText = accessorAction?.edits[0]?.text ?? "";
    expect(accessorText).toContain("public function getName(): string");
    expect(accessorText).toContain("public function setName(string $name): void");
    expect(accessorText).toContain("public function getBalance(): int");
  });
  it("formats generated getters and setters with the class member indentation", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
\tprivate string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const accessorAction = actions.find(
      (action) => action.title === "Generate getters and setters",
    );
    expect(accessorAction).toBeDefined();
    expect(accessorAction?.edits[0]?.text).toBe(
      "\n\tpublic function getName(): string\n\t{\n\t    return $this->name;\n\t}\n\n\tpublic function setName(string $name): void\n\t{\n\t    $this->name = $name;\n\t}\n",
    );
  });
  it("writes the Extract Interface sibling and authorizes the class edit (no directory create)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const interfaceContent =
      "<?php\n\nnamespace App\\Services;\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return "hi";
    }
}
`;
    const { getWorkbench, dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // The target interface does not exist yet, so the existence probe must
        // reject (mirrors a missing file on disk).
        if (path === interfacePath) {
          throw new Error("ENOENT");
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockClear();
    vi.mocked(dependencies.workspaceGateways.files.createDirectory).mockClear();

    let written: boolean | undefined;
    await act(async () => {
      written = await getWorkbench().applyPhpCodeActionNewFile({
        content: interfaceContent,
        path: interfacePath,
      });
    });

    // The interface file was freshly written, so the command is cleared to
    // apply the paired `implements` edit.
    expect(written).toBe(true);
    expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
      interfacePath,
      interfaceContent,
    );
    // The sibling directory already exists; the non-idempotent `createDirectory`
    // (the `File exists (os error 17)` that previously failed the write yet still
    // edited the class) must never be attempted.
    expect(dependencies.workspaceGateways.files.createDirectory).not.toHaveBeenCalled();
  });
  it("withholds the Extract Interface class edit when the target already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const interfaceContent =
      "<?php\n\nnamespace App\\Services;\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return "hi";
    }
}
`;
    const { getWorkbench, dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // The target interface ALREADY exists, so the existence probe resolves.
        if (path === interfacePath) {
          return "<?php\n\ninterface GreeterInterface\n{\n}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockClear();

    let written: boolean | undefined;
    await act(async () => {
      written = await getWorkbench().applyPhpCodeActionNewFile({
        content: interfaceContent,
        path: interfacePath,
      });
    });

    // Pre-existing target: never overwritten, and the class edit is withheld so
    // the class is left unchanged (no partial edit).
    expect(written).toBe(false);
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalledWith(
      interfacePath,
      expect.anything(),
    );
  });
  it("withholds the Extract Interface class edit and surfaces a notice when the write fails", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const interfacePath = "/workspace/app/Services/GreeterInterface.php";
    const interfaceContent =
      "<?php\n\nnamespace App\\Services;\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return "hi";
    }
}
`;
    const { getWorkbench, dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        // The target interface does not exist (probe rejects), so the write is
        // attempted - and then fails.
        if (path === interfacePath) {
          throw new Error("ENOENT");
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockRejectedValueOnce(
      new Error("disk full"),
    );

    let written: boolean | undefined;
    await act(async () => {
      written = await getWorkbench().applyPhpCodeActionNewFile({
        content: interfaceContent,
        path: interfacePath,
      });
    });

    // The write was attempted and failed, so the class edit is withheld (no
    // partial edit) and a recoverable Extract Interface notice is surfaced.
    expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenCalledWith(
      interfacePath,
      interfaceContent,
    );
    expect(written).toBe(false);
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Extract Interface" && notice.message.includes("disk full"),
      ),
    ).toBe(true);
  });
  it("offers no generate getters and setters action when every property has accessors", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): void
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate getters and setters")).toBe(false);
  });
  it("offers a generate constructor action for a class with properties and no constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const constructorAction = actions.find((action) => action.title === "Generate constructor");
    expect(constructorAction).toBeDefined();
    const constructorText = constructorAction?.edits[0]?.text ?? "";
    expect(constructorText).toContain("public function __construct(string $name, int $balance)");
    expect(constructorText).toContain("$this->name = $name;");
    expect(constructorText).toContain("$this->balance = $balance;");
  });
  it("moves declared properties into a genuinely promoted constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const classicAction = actions.find((action) => action.title === "Generate constructor");
    expect(classicAction).toBeDefined();

    const promotedAction = actions.find(
      (action) => action.title === "Generate constructor with promotion",
    );
    expect(promotedAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, promotedAction!)).toBe(`<?php

namespace App\\Models;

class Account
{

    public function __construct(
        private string $name,
        private int $balance,
    ) {}
}
`);
  });
  it("offers no promoted constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor with promotion")).toBe(
      false,
    );
  });
  it("offers no generate constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on an undocumented method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, int $count): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();

    const edit = phpDocAction?.edits[0];
    const text = edit?.text ?? "";
    expect(text).toContain("    /**");
    expect(text).toContain("     * @param string $name");
    expect(text).toContain("     * @param int $count");
    expect(text).toContain("     * @return bool");

    // Inserted at the start of the declaration line (zero-length edit) so the
    // docblock sits directly above the method.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function greet"))
      .split("\n").length;
    expect(edit?.range.startColumn).toBe(1);
    expect(edit?.range.endColumn).toBe(1);
    expect(edit?.range.startLineNumber).toBe(declarationLineNumber);
    expect(edit?.range.endLineNumber).toBe(declarationLineNumber);
  });
  it("does not offer Generate PHPDoc on a method that already has a docblock", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    /**
     * @param string $name
     * @return bool
     */
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("does not offer Generate PHPDoc when the cursor is not on any method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's leading attribute", async () => {
    const classPath = "/workspace/app/Http/Controllers/UserController.php";
    const classSource = `<?php

namespace App\\Http\\Controllers;

class UserController
{
    #[Route('/users/{id}')]
    public function show(int $id): string
    {
        return (string) $id;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    // Cursor parked on the `#[Route(...)]` attribute line above the method.
    const offset = classSource.indexOf("Route('/users");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param int $id");

    // The docblock is still inserted above the `function` line (below the
    // attribute), not above the attribute line.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function show"))
      .split("\n").length;
    expect(phpDocAction?.edits[0]?.range.startLineNumber).toBe(declarationLineNumber);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's modifier line", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function first(): int
    {
        return 1;
    }

    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // Cursor on the `public` modifier of `greet`, before its `function` keyword.
    const offset = classSource.indexOf("public function greet");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    // Resolves to `greet`, not the preceding `first` method.
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param string $name");
    expect(phpDocAction?.edits[0]?.text).toContain(" * @return bool");
  });
  it("does not offer Generate PHPDoc when the docblock would be empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function boot(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // A no-parameter `void` method would produce a docblock with neither
    // `@param` nor `@return`; PhpStorm offers nothing here, so neither do we.
    const offset = classSource.indexOf("boot(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers an Add parameter code action that appends an optional parameter to a method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addParameterAction!)).toBe(`<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, $parameter = null): string
    {
        return $name;
    }
}
`);
  });
  it("offers an Add parameter code action on a free function with the cursor in its body", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function add(int $a, int $b): int
{
    return $a + $b;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("return $a");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addParameterAction!)).toBe(`<?php

function add(int $a, int $b, $parameter = null): int
{
    return $a + $b;
}
`);
  });
  it("does not offer Add parameter on an abstract method declaration", async () => {
    const classPath = "/workspace/app/Contracts/Base.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Base
{
    abstract public function handle(string $name): void;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Base.php"));
    });

    const offset = classSource.indexOf("handle(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("does not offer Add parameter when the cursor is not on any function", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("offers Add return type using the method's PHPDoc @return", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    /**
     * @return Foo
     */
    public function make()
    {
        return $this->foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "public function make(): Foo",
    );
  });
  it("offers Add return type as void on a free function with no return value", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function log_message($message)
{
    error_log($message);
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("error_log");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addReturnTypeAction!)).toContain(
      "function log_message($message): void",
    );
  });
  it("offers Add return type before the semicolon on an abstract method", async () => {
    const classPath = "/workspace/app/Contracts/Maker.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Maker
{
    /**
     * @return Foo
     */
    abstract public function make();
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "abstract public function make(): Foo;",
    );
  });
  it("does not offer Add return type when the method already declares one", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function make(): Foo
    {
        return new Foo();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("does not offer Add return type when returns mix types", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function maybe($flag)
    {
        if ($flag) {
            return 'x';
        }

        return 123;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("maybe(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("offers Add type hint using the parameter's PHPDoc @param", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    /**
     * @param Foo $foo
     */
    public function set($foo)
    {
        $this->foo = $foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo)");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(Foo $foo)",
    );
  });
  it("offers Add type hint as array from an empty-array default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($items = [])
    {
        $this->items = $items;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$items");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(array $items = [])",
    );
  });
  it("does not offer Add type hint for a `= null` default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($foo = null)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("does not offer Add type hint when the parameter already has a type", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set(Foo $foo)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("offers an optimize imports action when an import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeText = optimizeAction?.edits[0]?.text ?? "";
    expect(optimizeText).toContain("use App\\Support\\Money;");
    expect(optimizeText).not.toContain("Unused");
  });
  it("offers no optimize imports action when imports are already clean", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("does not offer optimize imports when a comment sits between use statements", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
// keep this note about Money
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("replaces the use block with an empty string when every import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;

class Account
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeEdit = optimizeAction?.edits[0];
    expect(optimizeEdit?.text).toBe("");
    expect(optimizeEdit?.range.startLineNumber).toBe(5);
    expect(optimizeEdit?.range.endLineNumber).toBe(5);
  });
  it("offers an Import class action for an unimported class found in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Comment;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "Post",
      25,
    );
    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction).toBeDefined();
    const importEdit = importAction?.edits[0];
    expect(importEdit?.text).toBe("use App\\Models\\Post;\n");
    // Inserted before the alphabetically-later `use App\\Models\\Comment;`? No:
    // Post sorts after Comment, so it lands on the line AFTER Comment (line 6).
    expect(importEdit?.range.startColumn).toBe(1);
    expect(importEdit?.range.endColumn).toBe(1);
    expect(importEdit?.range.startLineNumber).toBe(6);
    expect(importEdit?.range.endLineNumber).toBe(6);
  });
  it("offers one Import action per candidate namespace for an ambiguous class", async () => {
    const classPath = "/workspace/app/Http/UserController.php";
    const classSource = `<?php

namespace App\\Http;

class UserController
{
    public function show(): User
    {
        return new User();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\User",
        kind: "class",
        lineNumber: 5,
        name: "User",
        path: "/workspace/app/Models/User.php",
        relativePath: "app/Models/User.php",
      },
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Support\\User",
        kind: "class",
        lineNumber: 9,
        name: "User",
        path: "/workspace/app/Support/User.php",
        relativePath: "app/Support/User.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    const offset = classSource.indexOf("User", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importTitles = actions
      .map((action) => action.title)
      .filter((title) => title.startsWith("Import "));
    expect(importTitles).toEqual(["Import App\\Models\\User", "Import App\\Support\\User"]);
  });
  it("does not offer an Import action when the class is already imported", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Post;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when the only candidate is in the current namespace", async () => {
    const classPath = "/workspace/app/Models/PostController.php";
    const classSource = `<?php

namespace App\\Models;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when no candidate exists in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("drops stale Import class actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => symbolSearch.promise);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      // The Create-class existence probe (limit 50) and/or the Import-class
      // lookup (limit 25) both query the symbol index for the short name; either
      // confirms the in-flight search started before we switch tabs.
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "Post", expect.any(Number));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace-a/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("drops stale generate-constructor code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    private string $name;
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("offers a create-method code action when the cursor is on a missing $this method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    expect(createMethod).toBeDefined();
    const stubText = createMethod?.edits[0]?.text ?? "";
    expect(stubText).toContain("private function doWork(int $arg0, string $arg1)");
  });
  it("offers a create-property code action when the cursor is on a missing $this property", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'status'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private $status;");
  });
  it("offers no create-method action when the $this method already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork();
    }

    private function doWork(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("marks Create method as the preferred quickfix on an unresolved member", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    // PhpStorm Alt+Enter: the contextual fix for the unresolved member is the
    // single most-likely action - a "quickfix" lightbulb, flagged preferred so
    // Monaco floats it to the top of the list.
    expect(createMethod?.kind).toBe("quickfix");
    expect(createMethod?.isPreferred).toBe(true);
    // And it leads the returned list (ordering = "most likely first").
    expect(actions[0]?.title).toBe("Create method 'doWork'");
  });
  it("offers a static create-method action when the cursor is on a missing self:: call", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        self::make('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("make");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'make'");
    expect(createMethod).toBeDefined();
    expect(createMethod?.edits[0]?.text ?? "").toContain(
      "private static function make(string $arg0)",
    );
  });
  it("offers a create-constant action when the cursor is on a missing self::CONST", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): string
    {
        return self::DEFAULT_NAME;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("DEFAULT_NAME");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_NAME'",
    );
    expect(createConstant).toBeDefined();
    expect(createConstant?.edits[0]?.text ?? "").toContain("private const DEFAULT_NAME = null;");
  });
  it("infers the property type from a typed $this assignment", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        $this->client = new HttpClient();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("client");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'client'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private HttpClient $client;");
  });
  it("offers a same-file parent:: create-method action targeting the parent class", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find(
      (action) => action.title === "Create method 'handle' in 'Base'",
    );
    expect(createMethod).toBeDefined();
    const insertOffset = classSource.split("\n").slice(0, 6).join("\n").length + 1;
    // The edit lands inside Base's body (before Child), not at the end of file.
    const editLine = createMethod?.edits[0]?.range.startLineNumber ?? 0;
    expect(editLine).toBeLessThan(
      classSource.slice(0, classSource.indexOf("class Child")).split("\n").length,
    );
    expect(insertOffset).toBeGreaterThan(0);
  });
  it("does not offer a parent:: action when the same-file parent already has the method", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
    public function handle(string $value): void
    {
    }
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("offers a parent::CONST create-constant action targeting the same-file parent", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): string
    {
        return parent::DEFAULT_LABEL;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::DEFAULT_LABEL") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_LABEL' in 'Base'",
    );
    expect(createConstant).toBeDefined();
    const editText = createConstant?.edits[0]?.text ?? "";
    expect(editText).toContain("protected const DEFAULT_LABEL = null;");
    expect(editText).not.toContain("private const DEFAULT_LABEL = null;");
  });
  it("does not offer a parent:: action when the parent lives in another file", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("tags an Import class action as a preferred quickfix", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction?.kind).toBe("quickfix");
    expect(importAction?.isPreferred).toBe(true);
  });
  it("classifies Generate constructor as a generate-family refactor (not a quickfix)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const constructor = actions.find((action) => action.title === "Generate constructor");
    // Generate-family actions read as "refactor" in the action widget (distinct
    // icon/group from the quickfix lightbulb), matching PhpStorm's Generate menu.
    expect(constructor?.kind).toBe("refactor.rewrite");
    expect(constructor?.isPreferred).not.toBe(true);

    const accessors = actions.find((action) => action.title === "Generate getters and setters");
    expect(accessors?.kind).toBe("refactor.rewrite");
  });
  it("tags Optimize imports with the organize-imports source kind", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Models\\Unused;
use App\\Models\\Apple;

class Greeter
{
    public function run(Apple $apple): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const optimize = actions.find((action) => action.title === "Optimize imports");
    expect(optimize?.kind).toBe("source.organizeImports");
  });
  it("orders the contextual quickfix ahead of generate-family refactors", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    // The cursor sits on an unresolved `$this->status`, so the contextual fix
    // (Create property) must lead - ahead of the class-level generate actions
    // (constructor / accessors) that are also offered for the same class.
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;

    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createIndex = actions.findIndex((action) => action.title === "Create property 'status'");
    const constructorIndex = actions.findIndex((action) => action.title === "Generate constructor");
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(constructorIndex).toBeGreaterThanOrEqual(0);
    // Quickfix before generate-family refactor (PhpStorm "most likely first").
    expect(createIndex).toBeLessThan(constructorIndex);
    expect(actions[createIndex]?.isPreferred).toBe(true);
  });
  it("orders free-function refactors by kind family (extract before rewrite)", async () => {
    const classPath = "/workspace/app/helpers.php";
    // A free function (no enclosing class) with a selected expression (so
    // Extract variable - refactor.extract is offered) and no declared return
    // type but a literal return (so Add return type - refactor.rewrite fires).
    const classSource = `<?php

function total()
{
    return 42;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const exprStart = classSource.indexOf("42");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: exprStart + "42".length,
      start: exprStart,
    });

    const extractIndex = actions.findIndex((action) => action.title === "Extract variable");
    const returnTypeIndex = actions.findIndex((action) => action.title === "Add return type");
    expect(extractIndex).toBeGreaterThanOrEqual(0);
    expect(returnTypeIndex).toBeGreaterThanOrEqual(0);
    // refactor.extract sorts ahead of refactor.rewrite even in a free function.
    expect(extractIndex).toBeLessThan(returnTypeIndex);
  });
  it("offers an extract-variable code action for a selected expression", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.indexOf("price()");
    const end = classSource.indexOf("tax()") + "tax()".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract variable");
    expect(extract).toBeDefined();
    expect(extract?.edits).toHaveLength(2);
    const declaration = extract?.edits.find((edit) =>
      edit.text.includes("$extracted = price() + tax();"),
    );
    expect(declaration).toBeDefined();
    const replacement = extract?.edits.find((edit) => edit.text === "$extracted");
    expect(replacement).toBeDefined();
  });
  it("offers no extract-variable action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("price()");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract variable")).toBe(false);
  });
  it("offers an inline-variable code action when the cursor is on a single-assignment local", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $user->name;
        echo $name;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const inline = actions.find((action) => action.title === "Inline variable");
    expect(inline).toBeDefined();
    // Declaration deletion plus one replacement per usage.
    expect(inline?.edits).toHaveLength(3);
    const deletion = inline?.edits.find((edit) => edit.text === "");
    expect(deletion).toBeDefined();
    expect(inline?.edits.every((edit) => edit.text === "" || edit.text === "$user->name")).toBe(
      true,
    );
  });
  it("offers no inline-variable action when the local is reassigned", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $a;
        $name = $b;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Inline variable")).toBe(false);
  });
  it("offers an introduce-constant code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce constant");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private const HELLO_WORLD = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "self::HELLO_WORLD");
    expect(replacement).toBeDefined();
  });
  it("offers an introduce-field code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce field");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private string $helloWorld = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "$this->helloWorld");
    expect(replacement).toBeDefined();
  });
  it("offers no introduce-constant or introduce-field action outside a class", async () => {
    const filePath = "/workspace/script.php";
    const fileSource = `<?php

$greeting = 'Hello world';
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "script.php"));
    });

    const offset = fileSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    expect(
      actions.some(
        (action) => action.title === "Introduce constant" || action.title === "Introduce field",
      ),
    ).toBe(false);
  });
  it("offers an extract-method code action for a whole-statement selection", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(int $seed): void
    {
        $base = $seed * 2;
        $total = $base + 10;
        echo $total;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$total = $base")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("echo $total;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");
    expect(extract).toBeDefined();
    expect(extract?.kind).toBe("refactor.extract");
    expect(extract?.edits).toHaveLength(2);

    const applied = applyPhpDescriptorEdits(classSource, extract!);
    expect(applied).toContain("$this->extracted($base);");
    expect(applied).toContain("private function extracted($base): void");
    expect(applied).toContain("$total = $base + 10;");
    expectBalancedPhp(applied);
  });
  it("offers no extract-method action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $a = 1;
        echo $a;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$a = 1;");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action outside a class (free function)", async () => {
    const classPath = "/workspace/app/helpers.php";
    const classSource = `<?php

function run(): void
{
    $a = 1;
    echo $a;
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const start = classSource.indexOf("    $a = 1;");
    const end = classSource.indexOf("\n", classSource.indexOf("echo $a;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action when more than one variable must be returned", async () => {
    const classPath = "/workspace/app/Services/Calculator.php";
    const classSource = `<?php

namespace App\\Services;

class Calculator
{
    public function run(): int
    {
        $a = 1;
        $b = 2;
        return $a + $b;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Calculator.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$a = 1;")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("$b = 2;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it.each([
    {
      name: "selection cutting an if/else boundary",
      from: "echo 'positive';",
      to: "} else {",
      source: `<?php

class Greeter
{
    public function run(int $x): void
    {
        if ($x > 0) {
            echo 'positive';
        } else {
            echo 'other';
        }
    }
}
`,
    },
    {
      name: "selection containing a break inside a loop",
      from: "$double = $item * 2;",
      to: "break;",
      source: `<?php

class Greeter
{
    public function run(array $items): void
    {
        foreach ($items as $item) {
            $double = $item * 2;
            break;
        }
    }
}
`,
    },
    {
      name: "selection containing a closure with use()",
      from: "$fn = function",
      to: "};",
      source: `<?php

class Greeter
{
    public function run(): void
    {
        $factor = 2;
        $fn = function ($x) use ($factor) {
            return $x * $factor;
        };
        echo $fn(3);
    }
}
`,
    },
  ])("extract-method adversarial sweep never corrupts: $name", async ({ source, from, to }) => {
    const classPath = "/workspace/app/Services/Edge.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? source : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Edge.php"));
    });

    const start = source.lastIndexOf("\n", source.indexOf(from)) + 1;
    const toEnd = source.indexOf(to) + to.length;
    const end = source.indexOf("\n", toEnd);
    const actions = await getWorkbench().providePhpCodeActions(source, {
      end: end < 0 ? source.length : end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");

    // Either the action is withheld (conservative no-op) or, if offered, the
    // applied edits keep the file syntactically balanced - never corruption.
    if (!extract) {
      return;
    }

    const applied = applyPhpDescriptorEdits(source, extract);
    expectBalancedPhp(applied);
  });
  it("drops stale introduce-constant code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
});
