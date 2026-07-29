// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  defaultWorkspaceSettings,
  describe,
  documentReadCount,
  emptyLanguageServerCapabilities,
  expect,
  fileEntry,
  type FileSearchResult,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  phpWorkspaceDescriptor,
  readyJavaScriptTypeScriptPlan,
  runningStatus,
  type SettingsGateway,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  workspaceRootKeysEqual,
  type WorkspaceRuntimeLifecycleGateway,
  Deferred,
  EditorActiveLiveDocumentSaveCoordinator,
} from "./testSupport";

describe("useWorkbenchController workspace lifecycle, language runtimes, and save coordination", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
});

describe("useWorkbenchController workspace lifecycle, language runtimes, and save coordination", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});
