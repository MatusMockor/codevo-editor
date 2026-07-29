// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  defaultWorkspaceSettings,
  Deferred,
  describe,
  EditorActiveLiveDocumentSaveCoordinator,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  type IndexProgressGateway,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerCodeAction,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type LanguageServerTextEdit,
  type MetadataScanCompletionEvent,
  normalizeWorkspaceSession,
  type PhpTreeGateway,
  phpWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
} from "./testSupport";

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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
