// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  callHierarchyRows,
  createDeferred,
  defaultAppSettings,
  defaultWorkspaceSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerFeaturesGateway,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  phpWorkspaceDescriptor,
  positionAfter,
  range,
  referenceRows,
  setupWorkbenchControllerTestHarness,
  typeHierarchyRows,
  vi,
  waitForReact,
} from "./testSupport";

describe("useWorkbenchController navigation, references, hierarchies, and symbols", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols)
      .mockResolvedValueOnce(firstSymbols)
      .mockResolvedValueOnce(secondSymbols);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.fileStructure")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).toHaveBeenCalledTimes(
      1,
    );
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.label).toBe("FirstUserService");

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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.fileStructure")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).toHaveBeenCalledTimes(
      2,
    );
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.label).toBe("SecondUserService");
  });
  it("drops stale JavaScript and TypeScript file structure after same-root session restart", async () => {
    const path = "/workspace/src/userService.ts";
    const documentSymbols =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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
    await waitForReact(() => {
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
    await waitForReact(() => {
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
    await waitForReact(() => {
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(5, 2, 5, 10)],
      },
    ]);
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls).mockResolvedValue(
      [],
    );
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
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
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).toHaveBeenCalledWith(
      "/workspace",
      item,
    );
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
  it("opens PHP call hierarchy from command palette actions", async () => {
    const path = "/workspace/app/Services/UserService.php";
    const callerPath = "/workspace/app/Http/Controllers/UserController.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 112,
    };
    const item = {
      data: { symbolId: "App\\Services\\UserService::loadUser" },
      detail: "app/Services/UserService.php",
      kind: 6,
      name: "loadUser",
      range: range(6, 4, 9, 5),
      selectionRange: range(6, 20, 6, 28),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const caller = {
      data: { symbolId: "App\\Http\\Controllers\\UserController::show" },
      detail: "app/Http/Controllers/UserController.php",
      kind: 6,
      name: "show",
      range: range(8, 4, 11, 5),
      selectionRange: range(8, 20, 8, 24),
      tags: [],
      uri: fileUriFromPath(callerPath),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockResolvedValue([item]);
    vi.mocked(languageServerFeaturesGateway.incomingCalls).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(9, 15, 9, 25)],
      },
    ]);
    vi.mocked(languageServerFeaturesGateway.outgoingCalls).mockResolvedValue([]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === callerPath) {
          return "<?php\n\n$user = $service->loadUser();\n";
        }

        return "<?php\n\nclass UserService\n{\n    public function loadUser(): string\n    {\n        return 'Ada';\n    }\n}\n";
      }),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 7,
      });
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.showCallHierarchy",
    );
    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(12);

    expect(languageServerFeaturesGateway.prepareCallHierarchy).toHaveBeenCalledWith("/workspace", {
      character: 24,
      line: 6,
      path,
    });
    expect(languageServerFeaturesGateway.incomingCalls).toHaveBeenCalledWith("/workspace", item);
    expect(languageServerFeaturesGateway.outgoingCalls).toHaveBeenCalledWith("/workspace", item);
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
        column: 16,
        lineNumber: 10,
      },
    });
  });
  it("aggregates PHP references into the panel and navigates a clicked row", async () => {
    const path = "/workspace/app/Services/UserService.php";
    const callerPath = "/workspace/app/Http/Controllers/UserController.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        references: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 220,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.references).mockResolvedValue([
      {
        uri: fileUriFromPath(path),
        range: range(6, 20, 6, 28),
      },
      {
        uri: fileUriFromPath(callerPath),
        range: range(9, 15, 9, 23),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === callerPath) {
          return "<?php\n\n$user = $service->loadUser();\n";
        }

        return "<?php\n\nclass UserService\n{\n    public function loadUser(): string\n    {\n        return 'Ada';\n    }\n}\n";
      }),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 5,
      });
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.findReferences",
    );
    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(12);

    expect(languageServerFeaturesGateway.references).toHaveBeenCalledWith("/workspace", {
      character: 24,
      line: 4,
      path,
    });
    expect(getWorkbench().referencesView?.symbol).toBe("loadUser");
    expect(getWorkbench().referencesView?.locations).toHaveLength(2);

    const rows = referenceRows(getWorkbench().referencesView!, "/workspace");
    const callerRow = rows.find((row) => row.path === callerPath);
    expect(callerRow).toBeDefined();

    await act(async () => {
      await getWorkbench().openReferenceRow(callerRow!);
    });

    expect(getWorkbench().referencesView).toBeNull();
    expect(getWorkbench().activePath).toBe(callerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: callerPath,
      position: {
        column: 16,
        lineNumber: 10,
      },
    });
  });
  it("shows an empty PHP references panel when the symbol has no references", async () => {
    const path = "/workspace/app/Services/UserService.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        references: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 221,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.references).mockResolvedValue([]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(
        async () =>
          "<?php\n\nclass UserService\n{\n    public function loadUser(): string\n    {\n        return 'Ada';\n    }\n}\n",
      ),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 5,
      });
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.findReferences")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().referencesView?.symbol).toBe("loadUser");
    expect(getWorkbench().referencesView?.locations).toHaveLength(0);
  });
  it("drops stale PHP references results after switching project tabs", async () => {
    const path = "/workspace-a/app/Services/UserService.php";
    const references =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        references: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 222,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.references).mockImplementationOnce(
      async () => references.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass UserService {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.findReferences")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(languageServerFeaturesGateway.references).toHaveBeenCalledWith("/workspace-a", {
      character: 24,
      line: 0,
      path,
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    references.resolve([
      {
        uri: fileUriFromPath(path),
        range: range(0, 6, 0, 17),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().referencesView).toBeNull();
  });
  it("finds JavaScript and TypeScript file references through tsserver and filters to the active project", async () => {
    const path = "/workspace/src/userService.ts";
    const callerPath = "/workspace/src/app.ts";
    const outsidePath = "/workspace-other/src/app.ts";
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 229,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).mockResolvedValue([
      {
        uri: fileUriFromPath(path),
        range: range(0, 0, 0, 17),
      },
      {
        uri: fileUriFromPath(callerPath),
        range: range(2, 25, 2, 38),
      },
      {
        uri: fileUriFromPath(outsidePath),
        range: range(4, 2, 4, 15),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === callerPath) {
          return "import { UserService } from './userService';\n";
        }

        return "export class UserService {}\n";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.findFileReferences",
    );
    expect(command?.title).toBe("Find File References");
    expect(command?.category).toBe("Editor");
    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(12);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).toHaveBeenCalledWith("/workspace", {
      arguments: [fileUriFromPath(path)],
      command: "_typescript.findAllFileReferences",
      title: "Find File References",
    });
    expect(getWorkbench().referencesView?.symbol).toBe("userService.ts");
    expect(getWorkbench().referencesView?.locations.map((location) => location.uri)).toEqual([
      fileUriFromPath(path),
      fileUriFromPath(callerPath),
    ]);
  });
  it("enables Find File References for JSX and TSX documents", async () => {
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 231,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).mockResolvedValue([]);
    const files = [
      {
        content: "export function App() { return <main />; }\n",
        name: "App.tsx",
        path: "/workspace/src/App.tsx",
      },
      {
        content: "export function Widget() { return <main />; }\n",
        name: "Widget.jsx",
        path: "/workspace/src/Widget.jsx",
      },
    ];
    const contentByPath = new Map(files.map((entry) => [entry.path, entry.content]));
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => contentByPath.get(requestedPath) ?? ""),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    for (const entry of files) {
      vi.mocked(
        javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
      ).mockClear();

      await act(async () => {
        await getWorkbench().openFile(fileEntry(entry.path, entry.name));
      });
      await flushAsyncTurns(24);

      const command = getWorkbench().commands.find(
        (candidate) => candidate.id === "editor.findFileReferences",
      );
      expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

      await act(async () => {
        await command?.run();
      });
      await flushAsyncTurns(12);

      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
      ).toHaveBeenCalledWith("/workspace", {
        arguments: [fileUriFromPath(entry.path)],
        command: "_typescript.findAllFileReferences",
        title: "Find File References",
      });
      expect(getWorkbench().referencesView?.symbol).toBe(entry.name);
    }
  });
  it("no-ops Find File References with a friendly message outside JavaScript and TypeScript files", async () => {
    const path = "/workspace/app/Services/UserService.php";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nfinal class UserService {}\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.findFileReferences",
    );
    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().message).toBe(
      "Find File References is available for JavaScript and TypeScript files.",
    );
  });
  it("drops stale JavaScript and TypeScript file reference results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const fileReferences =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["executeCommandLocations"]>>
      >();
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 230,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).mockImplementationOnce(async () => fileReferences.promise);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.findFileReferences")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.executeCommandLocations,
    ).toHaveBeenCalledWith("/workspace-a", {
      arguments: [fileUriFromPath(path)],
      command: "_typescript.findAllFileReferences",
      title: "Find File References",
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    fileReferences.resolve([
      {
        uri: fileUriFromPath(path),
        range: range(0, 0, 0, 17),
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().referencesView).toBeNull();
  });
  it("keeps PHP call hierarchy open for rows from inactive project tabs", async () => {
    const path = "/workspace-b/app/Services/UserService.php";
    const callerPath = "/workspace-b/app/Http/Controllers/UserController.php";
    const staleCallerPath = "/workspace-a/app/Http/Controllers/UserController.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 113,
    };
    const item = {
      data: { symbolId: "App\\Services\\UserService::loadUser" },
      detail: "app/Services/UserService.php",
      kind: 6,
      name: "loadUser",
      range: range(6, 4, 9, 5),
      selectionRange: range(6, 20, 6, 28),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const caller = {
      data: { symbolId: "App\\Http\\Controllers\\UserController::show" },
      detail: "app/Http/Controllers/UserController.php",
      kind: 6,
      name: "show",
      range: range(8, 4, 11, 5),
      selectionRange: range(8, 20, 8, 24),
      tags: [],
      uri: fileUriFromPath(callerPath),
    };
    const staleCaller = {
      ...caller,
      name: "staleShow",
      uri: fileUriFromPath(staleCallerPath),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockResolvedValue([item]);
    vi.mocked(languageServerFeaturesGateway.incomingCalls).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(9, 15, 9, 25)],
      },
    ]);
    vi.mocked(languageServerFeaturesGateway.outgoingCalls).mockResolvedValue([]);
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile,
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 7,
      });
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
    });
    await flushAsyncTurns(12);

    expect(getWorkbench().callHierarchyView?.item.name).toBe("loadUser");

    const [staleRow] = callHierarchyRows({
      incoming: [
        {
          from: staleCaller,
          fromRanges: [range(9, 15, 9, 25)],
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
  it("drops stale PHP call hierarchy errors after switching project tabs", async () => {
    const path = "/workspace-a/app/Services/UserService.php";
    const prepareCallHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 114,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockImplementationOnce(
      async () => prepareCallHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass UserService {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(languageServerFeaturesGateway.prepareCallHierarchy).toHaveBeenCalledWith(
      "/workspace-a",
      {
        character: 24,
        line: 0,
        path,
      },
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareCallHierarchy.reject(new Error("stale PHP call hierarchy"));
    await act(async () => {
      await commandPromise;
    });

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale PHP call hierarchy");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Call Hierarchy" && notice.message.includes("stale PHP call hierarchy"),
      ),
    ).toBe(false);
  });
  it("drops stale PHP call hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/app/Services/UserService.php";
    const prepareCallHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 115,
    };
    const item = {
      data: { symbolId: "App\\Services\\UserService::staleLoadUser" },
      detail: "app/Services/UserService.php",
      kind: 6,
      name: "staleLoadUser",
      range: range(6, 4, 9, 5),
      selectionRange: range(6, 20, 6, 33),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockImplementationOnce(
      async () => prepareCallHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass UserService {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(languageServerFeaturesGateway.prepareCallHierarchy).toHaveBeenCalledWith(
      "/workspace-a",
      {
        character: 24,
        line: 0,
        path,
      },
    );

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
    expect(languageServerFeaturesGateway.incomingCalls).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.outgoingCalls).not.toHaveBeenCalled();
    expect(getWorkbench().callHierarchyView).toBeNull();
  });
  it("drops stale PHP call hierarchy follow-up results after switching project tabs", async () => {
    const path = "/workspace-a/app/Services/UserService.php";
    const incomingCalls =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["incomingCalls"]>>>();
    const outgoingCalls =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["outgoingCalls"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 116,
    };
    const item = {
      data: { symbolId: "App\\Services\\UserService::loadUser" },
      detail: "app/Services/UserService.php",
      kind: 6,
      name: "loadUser",
      range: range(6, 4, 9, 5),
      selectionRange: range(6, 20, 6, 28),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const caller = {
      data: { symbolId: "App\\Http\\Controllers\\UserController::show" },
      detail: "app/Http/Controllers/UserController.php",
      kind: 6,
      name: "show",
      range: range(8, 4, 11, 5),
      selectionRange: range(8, 20, 8, 24),
      tags: [],
      uri: fileUriFromPath("/workspace-a/app/Http/Controllers/UserController.php"),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockResolvedValueOnce([item]);
    vi.mocked(languageServerFeaturesGateway.incomingCalls).mockImplementationOnce(
      async () => incomingCalls.promise,
    );
    vi.mocked(languageServerFeaturesGateway.outgoingCalls).mockImplementationOnce(
      async () => outgoingCalls.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass UserService {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.incomingCalls).toHaveBeenCalledWith(
        "/workspace-a",
        item,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    incomingCalls.resolve([
      {
        from: caller,
        fromRanges: [range(9, 15, 9, 25)],
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
  it("drops stale PHP call hierarchy after same-root session restart", async () => {
    const path = "/workspace/app/Services/UserService.php";
    const prepareCallHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(117)),
      openLog: vi.fn(async () => "/tmp/phpactor-language-server.log"),
      start: vi.fn(async () => runningStatus(117)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const item = {
      data: { symbolId: "App\\Services\\UserService::loadUser" },
      detail: "app/Services/UserService.php",
      kind: 6,
      name: "loadUser",
      range: range(6, 4, 9, 5),
      selectionRange: range(6, 20, 6, 28),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareCallHierarchy).mockImplementationOnce(
      async () => prepareCallHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async () => "<?php\nclass UserService {}\n"),
      runtimeStatus: runningStatus(117),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 25,
        lineNumber: 1,
      });
    });

    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.prepareCallHierarchy).toHaveBeenCalled();
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(118));
    });
    await flushAsyncTurns();

    prepareCallHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(languageServerFeaturesGateway.incomingCalls).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.outgoingCalls).not.toHaveBeenCalled();
    expect(getWorkbench().callHierarchyView).toBeNull();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export function loadUser() {\n  return 'Ada';\n}\n"),
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).mockResolvedValue([
      {
        from: caller,
        fromRanges: [range(5, 2, 5, 10)],
      },
    ]);
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls).mockResolvedValue(
      [],
    );
    const readTextFile = vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
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
          notice.source === "Call Hierarchy" && notice.message.includes("stale call hierarchy"),
      ),
    ).toBe(false);
  });
  it("drops stale JavaScript and TypeScript call hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const prepareCallHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
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
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls).not.toHaveBeenCalled();
    expect(getWorkbench().callHierarchyView).toBeNull();
  });
  it("drops stale JavaScript and TypeScript call hierarchy follow-up results after switching project tabs", async () => {
    const path = "/workspace-a/src/userService.ts";
    const incomingCalls =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["incomingCalls"]>>>();
    const outgoingCalls =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["outgoingCalls"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await waitForReact(() => {
      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).toHaveBeenCalledWith(
        "/workspace-a",
        item,
      );
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareCallHierarchy"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        callHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showCallHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await waitForReact(() => {
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

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.incomingCalls).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.outgoingCalls).not.toHaveBeenCalled();
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
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
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
  it("opens PHP type hierarchy from command palette actions", async () => {
    const path = "/workspace/app/Models/User.php";
    const subtypePath = "/workspace/app/Models/AdminUser.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 212,
    };
    const item = {
      data: { symbolId: "App\\Models\\User" },
      detail: "app/Models/User.php",
      kind: 5,
      name: "User",
      range: range(4, 0, 12, 1),
      selectionRange: range(4, 6, 4, 10),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const subtype = {
      data: { symbolId: "App\\Models\\AdminUser" },
      detail: "app/Models/AdminUser.php",
      kind: 5,
      name: "AdminUser",
      range: range(6, 0, 14, 1),
      selectionRange: range(6, 6, 6, 15),
      tags: [],
      uri: fileUriFromPath(subtypePath),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockResolvedValue([item]);
    vi.mocked(languageServerFeaturesGateway.typeHierarchySupertypes).mockResolvedValue([]);
    vi.mocked(languageServerFeaturesGateway.typeHierarchySubtypes).mockResolvedValue([subtype]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === subtypePath) {
          return "<?php\n\nnamespace App\\Models;\n\nclass AdminUser extends User {}\n";
        }

        return "<?php\n\nnamespace App\\Models;\n\nclass User {}\n";
      }),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 5,
      });
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.showTypeHierarchy",
    );
    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(12);

    expect(languageServerFeaturesGateway.prepareTypeHierarchy).toHaveBeenCalledWith("/workspace", {
      character: 7,
      line: 4,
      path,
    });
    expect(languageServerFeaturesGateway.typeHierarchySupertypes).toHaveBeenCalledWith(
      "/workspace",
      item,
    );
    expect(languageServerFeaturesGateway.typeHierarchySubtypes).toHaveBeenCalledWith(
      "/workspace",
      item,
    );
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
        column: 7,
        lineNumber: 7,
      },
    });
  });
  it("keeps PHP type hierarchy open for rows from inactive project tabs", async () => {
    const path = "/workspace-b/app/Models/User.php";
    const subtypePath = "/workspace-b/app/Models/AdminUser.php";
    const staleSubtypePath = "/workspace-a/app/Models/AdminUser.php";
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 213,
    };
    const item = {
      data: { symbolId: "App\\Models\\User" },
      detail: "app/Models/User.php",
      kind: 5,
      name: "User",
      range: range(4, 0, 12, 1),
      selectionRange: range(4, 6, 4, 10),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const subtype = {
      data: { symbolId: "App\\Models\\AdminUser" },
      detail: "app/Models/AdminUser.php",
      kind: 5,
      name: "AdminUser",
      range: range(6, 0, 14, 1),
      selectionRange: range(6, 6, 6, 15),
      tags: [],
      uri: fileUriFromPath(subtypePath),
    };
    const staleSubtype = {
      ...subtype,
      name: "StaleAdminUser",
      uri: fileUriFromPath(staleSubtypePath),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockResolvedValue([item]);
    vi.mocked(languageServerFeaturesGateway.typeHierarchySupertypes).mockResolvedValue([]);
    vi.mocked(languageServerFeaturesGateway.typeHierarchySubtypes).mockResolvedValue([subtype]);
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile,
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 5,
      });
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
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
  it("drops stale PHP type hierarchy errors after switching project tabs", async () => {
    const path = "/workspace-a/app/Models/User.php";
    const prepareTypeHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 214,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockImplementationOnce(
      async () => prepareTypeHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(languageServerFeaturesGateway.prepareTypeHierarchy).toHaveBeenCalledWith(
      "/workspace-a",
      {
        character: 7,
        line: 0,
        path,
      },
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    prepareTypeHierarchy.reject(new Error("stale PHP type hierarchy"));
    await act(async () => {
      await commandPromise;
    });

    expect(commandResolved).toBe(true);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale PHP type hierarchy");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Type Hierarchy" && notice.message.includes("stale PHP type hierarchy"),
      ),
    ).toBe(false);
  });
  it("drops stale PHP type hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/app/Models/User.php";
    const prepareTypeHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 215,
    };
    const item = {
      data: { symbolId: "App\\Models\\StaleUser" },
      detail: "app/Models/User.php",
      kind: 5,
      name: "StaleUser",
      range: range(4, 0, 12, 1),
      selectionRange: range(4, 6, 4, 15),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockImplementationOnce(
      async () => prepareTypeHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await flushAsyncTurns(4);

    expect(languageServerFeaturesGateway.prepareTypeHierarchy).toHaveBeenCalledWith(
      "/workspace-a",
      {
        character: 7,
        line: 0,
        path,
      },
    );

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
    expect(languageServerFeaturesGateway.typeHierarchySupertypes).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.typeHierarchySubtypes).not.toHaveBeenCalled();
    expect(getWorkbench().typeHierarchyView).toBeNull();
  });
  it("drops stale PHP type hierarchy follow-up results after switching project tabs", async () => {
    const path = "/workspace-a/app/Models/User.php";
    const supertypes =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["typeHierarchySupertypes"]>>
      >();
    const subtypes =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["typeHierarchySubtypes"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 216,
    };
    const item = {
      data: { symbolId: "App\\Models\\User" },
      detail: "app/Models/User.php",
      kind: 5,
      name: "User",
      range: range(4, 0, 12, 1),
      selectionRange: range(4, 6, 4, 10),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const subtype = {
      data: { symbolId: "App\\Models\\AdminUser" },
      detail: "app/Models/AdminUser.php",
      kind: 5,
      name: "StaleAdminUser",
      range: range(6, 0, 14, 1),
      selectionRange: range(6, 6, 6, 20),
      tags: [],
      uri: fileUriFromPath("/workspace-a/app/Models/AdminUser.php"),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockResolvedValueOnce([item]);
    vi.mocked(languageServerFeaturesGateway.typeHierarchySupertypes).mockImplementationOnce(
      async () => supertypes.promise,
    );
    vi.mocked(languageServerFeaturesGateway.typeHierarchySubtypes).mockImplementationOnce(
      async () => subtypes.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 1,
      });
    });

    let commandResolved = false;
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.typeHierarchySubtypes).toHaveBeenCalledWith(
        "/workspace-a",
        item,
      );
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
  it("drops stale PHP type hierarchy after same-root session restart", async () => {
    const path = "/workspace/app/Models/User.php";
    const prepareTypeHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(217)),
      openLog: vi.fn(async () => "/tmp/phpactor-language-server.log"),
      start: vi.fn(async () => runningStatus(217)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const item = {
      data: { symbolId: "App\\Models\\User" },
      detail: "app/Models/User.php",
      kind: 5,
      name: "User",
      range: range(4, 0, 12, 1),
      selectionRange: range(4, 6, 4, 10),
      tags: [],
      uri: fileUriFromPath(path),
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.prepareTypeHierarchy).mockImplementationOnce(
      async () => prepareTypeHierarchy.promise,
    );
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus(217),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 8,
        lineNumber: 1,
      });
    });

    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.prepareTypeHierarchy).toHaveBeenCalled();
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(218));
    });
    await flushAsyncTurns();

    prepareTypeHierarchy.resolve([item]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(12);

    expect(languageServerFeaturesGateway.typeHierarchySupertypes).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.typeHierarchySubtypes).not.toHaveBeenCalled();
    expect(getWorkbench().typeHierarchyView).toBeNull();
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
    const readTextFile = vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
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
          notice.source === "Type Hierarchy" && notice.message.includes("stale type hierarchy"),
      ),
    ).toBe(false);
  });
  it("drops stale JavaScript and TypeScript type hierarchy results after switching project tabs", async () => {
    const path = "/workspace-a/src/user.ts";
    const prepareTypeHierarchy =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
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
        Awaited<ReturnType<LanguageServerFeaturesGateway["typeHierarchySupertypes"]>>
      >();
    const subtypes =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["typeHierarchySubtypes"]>>>();
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult).then(() => {
        commandResolved = true;
      });
    });
    await waitForReact(() => {
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareTypeHierarchy"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeHierarchy: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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
      const runResult = getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.showTypeHierarchy")
        ?.run();
      commandPromise = Promise.resolve(runResult);
      await Promise.resolve();
    });
    await waitForReact(() => {
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
      {
        range: range(0, 13, 0, 17),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).toHaveBeenCalledWith(
      "/workspace",
      {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      },
    );
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().activeDocument?.readOnly).toBeUndefined();
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 14,
        lineNumber: 1,
      },
    });
  });
  it("enables JavaScript and TypeScript navigation commands for TSX documents", async () => {
    const sourcePath = "/workspace/src/App.tsx";
    const source = "import { User } from './User';\nexport function App() { return <User />; }\n";
    const cursorPosition = positionAfter(source, "Us");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        sourceDefinition: true,
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 803,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === sourcePath ? source : "",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "App.tsx"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToSourceDefinition")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(true);
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToTypeDefinition")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(true);
  });
  it("external JavaScript TypeScript definitions open read-only without syncing the external document", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const externalPath = "/external/types/pkg.d.ts";
    const source = "import { ExternalUser } from 'pkg';\nnew ExternalUser();\n";
    const external = "export declare class ExternalUser {}\n";
    const cursorPosition = positionAfter(source, "ExternalUs");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        declaration: true,
        definition: true,
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 801,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
      {
        range: range(0, 21, 0, 33),
        uri: fileUriFromPath(externalPath),
      },
    ]);
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.declaration).mockResolvedValue([
      {
        range: range(0, 21, 0, 33),
        uri: fileUriFromPath(externalPath),
      },
    ]);
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition).mockResolvedValue([
      {
        range: range(0, 21, 0, 33),
        uri: fileUriFromPath(externalPath),
      },
    ]);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === externalPath) {
          return external;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "main.ts"));
    });
    await flushAsyncTurns(24);

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    const cases = [
      {
        commandId: "editor.goToDefinition",
        feature: javaScriptTypeScriptLanguageServerFeaturesGateway.definition,
      },
      {
        commandId: "editor.goToDeclaration",
        feature: javaScriptTypeScriptLanguageServerFeaturesGateway.declaration,
      },
      {
        commandId: "editor.goToTypeDefinition",
        feature: javaScriptTypeScriptLanguageServerFeaturesGateway.typeDefinition,
      },
    ];

    for (const { commandId, feature } of cases) {
      act(() => {
        getWorkbench().setActivePath(sourcePath);
        getWorkbench().updateActiveEditorPosition(cursorPosition);
      });
      await flushAsyncTurns();
      vi.mocked(syncGateway.didOpen).mockClear();

      await act(async () => {
        await getWorkbench()
          .commands.find((candidate) => candidate.id === commandId)
          ?.run();
      });
      await flushAsyncTurns(24);

      expect(feature).toHaveBeenCalledWith("/workspace", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
      expect(getWorkbench().activePath).toBe(externalPath);
      expect(getWorkbench().activeDocument).toEqual(
        expect.objectContaining({
          path: externalPath,
          readOnly: true,
        }),
      );
      expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path: externalPath }),
        801,
      );
    }
  });
  it("external JSX and TSX definitions open read-only without syncing the external document", async () => {
    const sourcePath = "/workspace/src/App.tsx";
    const jsxExternalPath = "/external/pkg/Widget.jsx";
    const tsxExternalPath = "/external/pkg/UserCard.tsx";
    const source = "import { Widget, UserCard } from 'pkg';\n<Widget />;\n<UserCard />;\n";
    const external = "export function Component() { return <main />; }\n";
    const cursorPosition = positionAfter(source, "Wid");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 804,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition)
      .mockResolvedValueOnce([
        {
          range: range(0, 16, 0, 25),
          uri: fileUriFromPath(jsxExternalPath),
        },
      ])
      .mockResolvedValueOnce([
        {
          range: range(0, 16, 0, 25),
          uri: fileUriFromPath(tsxExternalPath),
        },
      ]);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === jsxExternalPath || requestedPath === tsxExternalPath) {
          return external;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "App.tsx"));
    });
    await flushAsyncTurns(24);

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;

    for (const externalPath of [jsxExternalPath, tsxExternalPath]) {
      act(() => {
        getWorkbench().setActivePath(sourcePath);
        getWorkbench().updateActiveEditorPosition(cursorPosition);
      });
      await flushAsyncTurns();
      vi.mocked(syncGateway.didOpen).mockClear();

      await act(async () => {
        await getWorkbench()
          .commands.find((candidate) => candidate.id === "editor.goToDefinition")
          ?.run();
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().activePath).toBe(externalPath);
      expect(getWorkbench().activeDocument).toEqual(
        expect.objectContaining({
          path: externalPath,
          readOnly: true,
        }),
      );
      expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path: externalPath }),
        804,
      );
    }
  });
  it("external JavaScript TypeScript document sync skips edit save flush and close for read-only targets", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const externalPath = "/external/types/pkg.d.ts";
    const source = "import { ExternalUser } from 'pkg';\nnew ExternalUser();\n";
    const external = "export declare class ExternalUser {}\n";
    const cursorPosition = positionAfter(source, "ExternalUs");
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 802,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
      {
        range: range(0, 21, 0, 33),
        uri: fileUriFromPath(externalPath),
      },
    ]);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === externalPath) {
          return external;
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });
    await flushAsyncTurns(24);

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockClear();
    vi.mocked(syncGateway.didChange).mockClear();
    vi.mocked(syncGateway.didSave).mockClear();
    vi.mocked(syncGateway.didClose).mockClear();
    vi.mocked(dependencies.workspaceGateways.files.writeTextFile).mockClear();

    act(() => {
      getWorkbench().updateActiveDocument("export declare const changed: true;\n");
    });
    expect(
      getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.save")
        ?.isEnabled(getWorkbench().commandContext),
    ).toBe(false);
    await act(async () => {
      await getWorkbench().saveActiveDocument();
      await getWorkbench().flushPendingJavaScriptTypeScriptLanguageServerDocument(externalPath);
    });
    act(() => {
      getWorkbench().closeDocument(externalPath);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activeDocument?.path).not.toBe(externalPath);
    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: externalPath }),
      802,
    );
    expect(syncGateway.didChange).not.toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: externalPath }),
      802,
    );
    expect(syncGateway.didSave).not.toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: externalPath }),
      802,
    );
    expect(syncGateway.didClose).not.toHaveBeenCalledWith("/workspace", externalPath, 802);
  });
  it("external JavaScript TypeScript document sync skips active external target during runtime resync", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const externalPath = "/external/types/pkg.d.ts";
    const source = "import { ExternalUser } from 'pkg';\nnew ExternalUser();\n";
    const cursorPosition = positionAfter(source, "ExternalUs");
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(803)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(803)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishStatus = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
      {
        range: range(0, 21, 0, 33),
        uri: fileUriFromPath(externalPath),
      },
    ]);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(803),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(803),
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === externalPath) {
          return "export declare class ExternalUser {}\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activeDocument).toEqual(
      expect.objectContaining({
        path: externalPath,
        readOnly: true,
      }),
    );

    const syncGateway = dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway;
    vi.mocked(syncGateway.didOpen).mockClear();

    act(() => {
      publishStatus?.(runningStatus(804));
    });
    await flushAsyncTurns(24);

    expect(syncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: sourcePath }),
      804,
    );
    expect(syncGateway.didOpen).not.toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: externalPath }),
      804,
    );
    expect(getWorkbench().activePath).toBe(externalPath);
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockClear();

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });
    await flushAsyncTurns();

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).not.toHaveBeenCalled();
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
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
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
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
    await waitForReact(() => {
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
    expect(getWorkbench().message).not.toBe("Opened definition user.ts:1:14");
  });
  it("drops stale JavaScript and TypeScript navigation after same-root session restart", async () => {
    const sourcePath = "/workspace/src/main.ts";
    const targetPath = "/workspace/src/user.ts";
    const source = "import { User } from './user';\nconst user = new User();\n";
    const target = "export class User {\n  name = '';\n}\n";
    const cursorPosition = positionAfter(source, "new Us");
    const definitionResult =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockImplementationOnce(
      async () => definitionResult.promise,
    );
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
      appSettings: workspaceAppSettings(),
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
    await waitForReact(() => {
      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).toHaveBeenCalled();
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
    expect(getWorkbench().message).not.toBe("Opened definition user.ts:1:14");
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
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
    vi.mocked(languageServerFeaturesGateway.definition).mockImplementationOnce(
      async () => definitionResult.promise,
    );
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
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
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
    expect(getWorkbench().message).not.toBe("Opened definition Helper.php:3:10");
  });
  it("drops stale PHP language server invalid definition targets after switching project tabs", async () => {
    const sourcePath = "/workspace-a/app/Http/Controllers/UserController.php";
    const source = `<?php

$result = helper_call();
`;
    const cursorPosition = positionAfter(source, "helper_ca");
    const definitionResult =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
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
    vi.mocked(languageServerFeaturesGateway.definition).mockImplementationOnce(
      async () => definitionResult.promise,
    );
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
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith("/workspace-a", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
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
    vi.mocked(languageServerFeaturesGateway.definition).mockImplementationOnce(
      async () => definitionResult.promise,
    );
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
      appSettings: workspaceAppSettings(),
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
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.definition).toHaveBeenCalledWith("/workspace", {
        character: cursorPosition.column - 1,
        line: cursorPosition.lineNumber - 1,
        path: sourcePath,
      });
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
    expect(getWorkbench().message).not.toBe("Opened definition Helper.php:3:10");
  });
  it("opens PHP declarations through workbench commands", async () => {
    const sourcePath = "/workspace/app/Services/UserService.php";
    const targetPath = "/workspace/app/Contracts/UserRepository.php";
    const source = `<?php

$repository->findUser();
`;
    const target = `<?php

interface UserRepository
{
    public function findUser(): User;
}
`;
    const cursorPosition = positionAfter(source, "findUs");
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        declaration: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 701,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.declaration).mockResolvedValue([
      {
        range: range(4, 20, 4, 28),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDeclaration",
    );

    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.declaration).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 21,
        lineNumber: 5,
      },
    });
    expect(getWorkbench().message).toBe("Opened declaration UserRepository.php:5:21");
  });
  it("opens PHP type definitions through workbench commands", async () => {
    const sourcePath = "/workspace/app/Services/UserService.php";
    const targetPath = "/workspace/app/Models/User.php";
    const source = `<?php

$user = $repository->findUser();
$user->name;
`;
    const target = `<?php

final class User
{
    public string $name;
}
`;
    const cursorPosition = positionAfter(source, "$user->na");
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        typeDefinition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 702,
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.typeDefinition).mockResolvedValue([
      {
        range: range(2, 12, 2, 16),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === sourcePath) {
          return source;
        }

        if (requestedPath === targetPath) {
          return target;
        }

        return "";
      }),
      runtimeStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(sourcePath, "UserService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(cursorPosition);
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToTypeDefinition",
    );

    expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.typeDefinition).toHaveBeenCalledWith("/workspace", {
      character: cursorPosition.column - 1,
      line: cursorPosition.lineNumber - 1,
      path: sourcePath,
    });
    expect(getWorkbench().activePath).toBe(targetPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: targetPath,
      position: {
        column: 13,
        lineNumber: 3,
      },
    });
    expect(getWorkbench().message).toBe("Opened type definition User.php:3:13");
  });
});
