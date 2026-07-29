// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  defaultWorkspaceSettings,
  describe,
  emptyLanguageServerCapabilities,
  emptyPhpFileOutline,
  expect,
  featuresGateway,
  fileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  phpactorLanguageServerPlan,
  type PhpFileOutlineGateway,
  phpWorkspaceDescriptor,
  range,
  readyJavaScriptTypeScriptPlan,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
} from "./testSupport";

describe("useWorkbenchController document editing and language-service mutations", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
  it("notifies the JavaScript TypeScript service when a JS TS file is created", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "created",
        path: newPath,
      },
    ]);
  });
  it("asks the JavaScript TypeScript service for file create edits before creating a JS TS file", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const consumerPath = "/workspace/src/index.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "import { NewWidget } from './NewWidget';\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles,
    ).mockResolvedValueOnce(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didCreateFiles: true,
        willCreateFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [],
    );
    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });
  it("blocks JS TS file creation when create edits fail", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles,
    ).mockRejectedValueOnce(new Error("will create crashed"));
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didCreateFiles: true,
        willCreateFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(dependencies.workspaceGateways.files.createTextFile).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Create" &&
          notice.message.includes("will create crashed"),
      ),
    ).toBe(true);
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
    vi.mocked(dependencies.workspaceGateways.files.createTextFile).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
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
        (notice) => notice.source === "Create File" && notice.message.includes("stale create file"),
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
    vi.mocked(dependencies.workspaceGateways.files.createTextFile).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
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
    vi.mocked(dependencies.workspaceGateways.files.createDirectory).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "folder.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createDirectory).toHaveBeenCalledWith(newPath);
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
          notice.source === "Create Folder" && notice.message.includes("stale create folder"),
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
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(25),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(25),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
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

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
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
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("package.json");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 26);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "deleted",
        path,
      },
    ]);
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles).mock
        .invocationCallOrder[0],
    );
  });
  it("asks the JavaScript TypeScript service for file delete edits before deleting a JS TS file", async () => {
    const path = "/workspace/src/User.ts";
    const consumerPath = "/workspace/src/index.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "",
            range: {
              end: { character: 31, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles,
    ).mockResolvedValueOnce(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didDeleteFiles: true,
        willDeleteFiles: true,
      },
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [path],
    );
    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 26);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });
  it("blocks JS TS file deletion when delete edits fail", async () => {
    const path = "/workspace/src/User.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles,
    ).mockRejectedValueOnce(new Error("will delete crashed"));
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didDeleteFiles: true,
        willDeleteFiles: true,
      },
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(dependencies.workspaceGateways.files.deletePath).not.toHaveBeenCalled();
    expect(dependencies.documentSyncGateway.didClose).not.toHaveBeenCalledWith(
      "/workspace",
      path,
      26,
    );
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Delete" &&
          notice.message.includes("will delete crashed"),
      ),
    ).toBe(true);
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    let deletePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      deletePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
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
        (notice) => notice.source === "Delete File" && notice.message.includes("stale delete"),
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
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });
  it("does not start-loop a crashed JavaScript and TypeScript language service from the frontend", async () => {
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
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });
  it("leaves a crashed JavaScript and TypeScript language service for backend auto-restart", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "crashed",
        message: "tsserver crashed",
        rootPath: "/workspace",
      }),
    );

    act(() => {
      publishRuntimeStatus?.({
        kind: "starting",
        rootPath: "/workspace",
        sessionId: 2,
      });
      publishRuntimeStatus?.({
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          completion: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 2,
      });
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 2,
      }),
    );
  });
  it("caches a crashed background JavaScript and TypeScript service without stopping it or changing the active project status", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runtimeStatuses = new Map<string, LanguageServerRuntimeStatus>();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(
        async (rootPath) =>
          runtimeStatuses.get(rootPath) ?? {
            kind: "stopped" as const,
            rootPath,
          },
      ),
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
      const crashedStatus: LanguageServerRuntimeStatus = {
        kind: "crashed",
        message: "workspace b tsserver crashed",
        rootPath: "/workspace-b",
      };
      runtimeStatuses.set("/workspace-b", crashedStatus);
      publishRuntimeStatus?.(crashedStatus);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "crashed",
        message: "workspace b tsserver crashed",
        rootPath: "/workspace-b",
      }),
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
      appSettings: workspaceAppSettings(),
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

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async () => rootlessStopStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
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

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
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
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
        javaScriptTypeScriptCodeLens: false,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
        javaScriptTypeScriptImportModuleSpecifierEnding: "auto",
        javaScriptTypeScriptImportModuleSpecifierPreference: "shortest",
        javaScriptTypeScriptInlayHints: true,
        javaScriptTypeScriptPreferTypeOnlyAutoImports: false,
        javaScriptTypeScriptQuotePreference: "auto",
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
          javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
          javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
          javaScriptTypeScriptImportModuleSpecifierPreference: "relative",
          javaScriptTypeScriptInlayHints: false,
          javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
          javaScriptTypeScriptQuotePreference: "single",
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
        preferences: expect.objectContaining({
          includeCompletionsWithSnippetText: true,
          includePackageJsonAutoImports: "off",
          importModuleSpecifierEnding: "minimal",
          importModuleSpecifierPreference: "relative",
          preferTypeOnlyAutoImports: true,
          quotePreference: "single",
        }),
        implementationsCodeLens: { enabled: true },
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: true,
        },
        updateImportsOnFileMove: {
          enabled: "never",
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
  it("notifies the running JavaScript and TypeScript language service when reference CodeLens scope changes", async () => {
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
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
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
          javaScriptTypeScriptCodeLens: true,
          javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
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
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: true,
        },
      }),
    );
  });
  it("restarts JavaScript and TypeScript instead of notifying configuration when automatic type acquisition changes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 16,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutomaticTypeAcquisition: false,
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
          javaScriptTypeScriptAutomaticTypeAcquisition: true,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        automaticTypeAcquisitionEnabled: true,
        typeScriptVersionPreference: "bundled",
      }),
    );
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
  });
  it("includes active EditorConfig formatting options in JavaScript and TypeScript configuration changes", async () => {
    const path = "/workspace/src/App.ts";
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
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === "/workspace/.editorconfig") {
          return ["root = true", "[*.ts]", "indent_style = space", "indent_size = 4"].join("\n");
        }

        if (requestedPath.endsWith("/.editorconfig")) {
          throw new Error(`No .editorconfig at ${requestedPath}`);
        }

        return ["export function run() {", "    return 1;", "}", ""].join("\n");
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(getWorkbench().activeEditorConfig).toEqual(
        expect.objectContaining({
          indentStyle: "space",
          indentSize: 4,
        }),
      );
    });

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
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
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        formattingOptions: {
          insertSpaces: true,
          tabSize: 4,
        },
      }),
    );
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
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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
    await waitForReact(() => {
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
        (notice) => notice.source === "Settings" && notice.message.includes("stale configuration"),
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
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
        expect.any(Object),
      );
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
          notice.source === "Settings" && notice.message.includes("stale workspace settings"),
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
    await waitForReact(() => {
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
        .mock.calls.some(([, mode]) => mode === "fullSmart"),
    ).toBe(false);
    expect(getWorkbench().message).not.toBe("Settings saved.");
  });
  it("keeps an in-flight settings save current when active workspace close is declined", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Dirty.php", "Dirty.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
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
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    });

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(false);
    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });

    await act(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith("/workspace", "fullSmart");
    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace"]);
  });
  it("invalidates a delayed settings save before accepted workspace teardown", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Dirty.php", "Dirty.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
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
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    });
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockImplementationOnce(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
      expect(dependencies.smartModeGateway.setMode).not.toHaveBeenCalled();
    });
    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(true);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });

    await act(async () => {
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(
      vi
        .mocked(dependencies.smartModeGateway.setMode)
        .mock.calls.some(([, mode]) => mode === "fullSmart"),
    ).toBe(false);
    expect(getWorkbench().workspaceRoot).toBeNull();
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
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
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
        (notice) => notice.source === "Status Bar" && notice.message.includes("stale status bar"),
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
      await getWorkbench().openPinnedFile(fileEntry("/workspace-a/src/User.php", "User.php"));
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({
          session: expect.objectContaining({
            editor: expect.objectContaining({
              groups: expect.objectContaining({
                "editor-main": expect.objectContaining({
                  activePath: "/workspace-a/src/User.php",
                }),
              }),
            }),
          }),
        }),
      );
    });

    let switchPromise = Promise.resolve();
    void act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    await act(async () => {
      sessionSave.reject(new Error("stale session save"));
      await switchPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Session" && notice.message.includes("stale session save"),
      ),
    ).toBe(false);
  });
  it("reports active session persistence failures during overlapping project switches", async () => {
    const sessionSave = createDeferred<void>();
    const workspaceCSettings = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mockClear();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => sessionSave.promise,
    );
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockImplementation(
      async (path) =>
        path === "/workspace-c" ? workspaceCSettings.promise : defaultWorkspaceSettings(),
    );

    let switchToB: Promise<void> = Promise.resolve();
    act(() => {
      getWorkbench().splitActiveEditorGroup("right");
      switchToB = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
        expect.any(Object),
      );
    });
    const persistedSession = vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mock
      .calls[0]?.[1].session;
    expect(Object.keys(persistedSession.editor.groups)).toHaveLength(2);

    let switchToC: Promise<void> = Promise.resolve();
    act(() => {
      switchToC = getWorkbench().activateWorkspaceTab("/workspace-c");
    });
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      sessionSave.reject(new Error("A session persistence failed"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-c",
      );
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Session" && notice.message.includes("A session persistence failed"),
      ),
    ).toBe(true);

    await act(async () => {
      workspaceCSettings.resolve(defaultWorkspaceSettings());
      await Promise.all([switchToB, switchToC]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-c");
    expect(dependencies.settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-c");
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.workspaceGateways.detection.detectWorkspace).toHaveBeenCalledWith(
      "/workspace-c",
    );
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
      appSettings: workspaceAppSettings(),
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
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().restartJavaScriptTypeScriptService();
      await flushAsyncTurns(24);
    });

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => rootlessRestartStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
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

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });
  it("opens JavaScript and TypeScript language service log for the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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

    const detectOrder = vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mock
      .invocationCallOrder[0];
    const restoreReadOrder = readTextFile.mock.invocationCallOrder[0];

    expect(detectOrder).toBeDefined();
    expect(restoreReadOrder).toBeDefined();
    expect(detectOrder ?? Number.MAX_SAFE_INTEGER).toBeLessThan(restoreReadOrder ?? 0);
    expect(getWorkbench().workspaceDescriptor?.php).not.toBeNull();
    expect(getWorkbench().activePath).toBe(restoredPath);
  });
  it("clears indexed intelligence and stops the language server when IDE mode is turned off", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });
    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });

    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(dependencies.indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
      "/workspace",
    );
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
      appSettings: workspaceAppSettings(),
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

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });
  it("does not autostart phpactor again while IDE mode is being disabled", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(languageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
      await flushAsyncTurns(24);
    });

    expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(languageServerRuntimeGateway.start).not.toHaveBeenCalled();
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(stoppedStatus);
  });
  it("does not autostart phpactor again after a manual stop in IDE mode", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(languageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().stopLanguageServer();
      await flushAsyncTurns(24);
    });

    expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(languageServerRuntimeGateway.start).not.toHaveBeenCalled();
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(stoppedStatus);
  });
  it("toggles file structure to inherited members on the second Cmd+R", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      parentPath,
      expect.stringContaining("inherited"),
    );
  });
  it("uses live-parse signature metadata for PHP file structure even when the index is non-empty", async () => {
    const path = "/workspace/app/UserService.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass UserService { public function handle() {} }\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });

    dependencies.phpFileOutlineGateway.getPhpFileOutline = vi.fn(async () => ({
      nodes: [
        {
          children: [
            {
              children: [],
              column: 5,
              fullyQualifiedName: "UserService::handle",
              id: "indexed-handle",
              kind: "method" as const,
              label: "handle",
              lineNumber: 2,
              path,
              relativePath: "app/UserService.php",
            },
          ],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "indexed-class",
          kind: "class" as const,
          label: "UserService",
          lineNumber: 1,
          path,
          relativePath: "app/UserService.php",
        },
      ],
    }));
    dependencies.phpFileOutlineGateway.parsePhpFileOutline = vi.fn(async () => ({
      nodes: [
        {
          children: [
            {
              children: [],
              column: 5,
              fullyQualifiedName: "UserService::handle",
              id: "live-handle",
              kind: "method" as const,
              label: "handle",
              lineNumber: 2,
              parameters: [{ name: "$request", type: "Request" }],
              path,
              relativePath: "app/UserService.php",
              returnType: "void",
              visibility: "public" as const,
            },
          ],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "live-class",
          kind: "class" as const,
          label: "UserService",
          lineNumber: 1,
          path,
          relativePath: "app/UserService.php",
        },
      ],
    }));

    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("UserService"),
    );

    const method = getWorkbench().fileStructureOutline?.nodes[0]?.children[0];
    expect(method?.visibility).toBe("public");
    expect(method?.returnType).toBe("void");
    expect(method?.parameters).toEqual([{ name: "$request", type: "Request" }]);
  });
  it("re-parses the live dirty buffer when file structure reopens after an edit", async () => {
    const path = "/workspace/app/UserService.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(
        async () => "<?php\nclass UserService { public function originalMethod() {} }\n",
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("originalMethod"),
    );

    act(() => {
      getWorkbench().setFileStructureOpen(false);
    });
    act(() => {
      getWorkbench().updateActiveDocument(
        "<?php\nclass UserService { public function renamedMethod() {} }\n",
      );
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("renamedMethod"),
    );
  });
  it("re-resolves the inherited outline from the live dirty buffer after an extends edit", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const otherParentPath = "/workspace/app/OtherParent.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === childPath) {
          return "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
        }

        if (path === otherParentPath) {
          return "<?php\nnamespace App;\nclass OtherParent { public function inheritedRenamed() {} }\n";
        }

        return "<?php\nnamespace App;\nclass ParentClass { public function inheritedOriginal() {} }\n";
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

    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      parentPath,
      expect.stringContaining("inheritedOriginal"),
    );

    act(() => {
      getWorkbench().setFileStructureOpen(false);
    });
    act(() => {
      getWorkbench().updateActiveDocument(
        "<?php\nnamespace App;\nclass Child extends OtherParent {}\n",
      );
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      otherParentPath,
      expect.stringContaining("inheritedRenamed"),
    );
  });
  it("drops delayed current PHP file structure outlines after switching project tabs", async () => {
    const workspaceAPath = "/workspace-a/app/UserService.php";
    const workspaceBPath = "/workspace-b/app/OrderService.php";
    const workspaceAOutline =
      createDeferred<Awaited<ReturnType<PhpFileOutlineGateway["parsePhpFileOutline"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) =>
        path === workspaceAPath
          ? "<?php\nclass UserService { public function staleWorkspaceA() {} }\n"
          : "<?php\nclass OrderService {}\n",
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    dependencies.phpFileOutlineGateway.parsePhpFileOutline = vi.fn(async (path) => {
      if (path === workspaceAPath) {
        return workspaceAOutline.promise;
      }

      return emptyPhpFileOutline();
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceAPath, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await waitForReact(() => {
      expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
        workspaceAPath,
        expect.stringContaining("staleWorkspaceA"),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(workspaceBPath, "OrderService.php"));
    });
    await flushAsyncTurns();

    workspaceAOutline.resolve({
      nodes: [
        {
          children: [],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "stale-workspace-a-service",
          kind: "class",
          label: "StaleWorkspaceAService",
          lineNumber: 1,
          path: workspaceAPath,
          relativePath: "app/UserService.php",
        },
      ],
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).toBe(workspaceBPath);
    expect(getWorkbench().fileStructureOutline).toBeNull();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().activePath).toBe(workspaceAPath);
    expect(getWorkbench().fileStructureOutline).toBeNull();
  });
  it("stops reading stale inherited PHP file structure candidates after switching project tabs", async () => {
    const childPath = "/workspace-a/app/Child.php";
    const primaryParentPath = "/workspace-a/app/ParentClass.php";
    const packageParentPath = "/workspace-a/vendor/shared/package/src/ParentClass.php";
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
    await waitForReact(() => {
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
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).not.toHaveBeenCalledWith(
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).mockResolvedValue([
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
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureCanIncludeInheritedMembers).toBe(false);
    expect(getWorkbench().fileStructureOutline?.nodes[0]).toMatchObject({
      kind: "class",
      label: "UserService",
    });
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.children[0]).toMatchObject({
      kind: "method",
      label: "loadUser",
      lineNumber: 3,
    });
  });
});
