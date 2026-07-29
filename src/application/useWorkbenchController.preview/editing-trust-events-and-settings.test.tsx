// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  defaultPhpLanguageServerOptions,
  defaultWorkspaceSettings,
  describe,
  directoryEntry,
  documentReadCount,
  emptyLanguageServerCapabilities,
  expect,
  fileEntry,
  type FileEntry,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerGateway,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  phpactorLanguageServerPlan,
  phpWorkspaceDescriptor,
  positionAfter,
  readyJavaScriptTypeScriptPlan,
  runCommand,
  setupWorkbenchControllerTestHarness,
  trustedDescriptor,
  vi,
  waitForReact,
  type WorkbenchWorkspaceGateways,
  type WorkspaceTrustGateway,
  type WorkspaceTrustState,
  Deferred,
  type IndexProgressGateway,
  type MetadataScanCompletionEvent,
  createManagedPhpactorInstallHarness,
  flushFilePrefetch,
  type PhpLanguageServerPlanOptions,
  type SmartModeGateway,
  type WorkbenchController,
} from "./testSupport";

describe("useWorkbenchController Git operations and workspace editor behavior", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("ignores reindex start responses that belong to another workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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
  it("applies incremental index progress for the active workspace and drops cross-root events", async () => {
    let publishIndexProgress:
      ((event: import("../../domain/indexProgress").IndexProgressEvent) => void) | null = null;
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
      subscribeIndexProgress: vi.fn(async (listener) => {
        publishIndexProgress = listener;
        return () => undefined;
      }),
      subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({ rootPath: "/workspace", status: "scanning" }),
    );

    act(() => {
      publishIndexProgress?.({
        phase: "parsing",
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1200,
      });
    });

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        processedFiles: 500,
        rootPath: "/workspace",
        status: "scanning",
        totalFiles: 1200,
      }),
    );

    // A progress event for a different workspace root must never touch the active workspace's state.
    act(() => {
      publishIndexProgress?.({
        phase: "parsing",
        processedFiles: 9999,
        rootPath: "/other-workspace",
        totalFiles: 9999,
      });
    });

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1200,
      }),
    );
  });
  it("ignores stale smart mode completions after switching project tabs", async () => {
    const smartModeUpdate = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
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
    await waitForReact(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "/workspace-a",
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
    const smartModeUpdate = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
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
    await waitForReact(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "/workspace-a",
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
        (notice) => notice.source === "IDE Mode" && notice.message.includes("stale smart mode"),
      ),
    ).toBe(false);
  });
  it("ignores stale workspace-open smart mode errors after switching project tabs", async () => {
    const workspaceASmartMode = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    let setModeCalls = 0;
    const smartModeGateway: SmartModeGateway = {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (_rootPath, mode) => {
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
    await waitForReact(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledWith("/workspace-a", "basic");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledTimes(2);
      expect(smartModeGateway.setMode).toHaveBeenLastCalledWith("/workspace-b", "basic");
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
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
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
    vi.mocked(dependencies.indexProgressGateway.clearWorkspaceIndex).mockImplementationOnce(
      async () => indexClear.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
        "/workspace-a",
      );
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
        (notice) => notice.source === "Index" && notice.message.includes("stale clear"),
      ),
    ).toBe(false);
  });
  it("ignores index clear success messages after switching project tabs", async () => {
    const indexClear =
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
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
    vi.mocked(dependencies.indexProgressGateway.clearWorkspaceIndex).mockImplementationOnce(
      async () => indexClear.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
        "/workspace-a",
      );
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
    let publishMetadataScanCompletion: ((event: MetadataScanCompletionEvent) => void) | null = null;
    const indexClear =
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
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
      subscribeIndexProgress: vi.fn(async () => () => undefined),
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
    await waitForReact(() => {
      expect(indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith("/workspace-a");
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
        (notice) => notice.source === "Index" && notice.message.includes("stale metadata clear"),
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
      subscribeIndexProgress: vi.fn(async () => () => undefined),
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
    expect(getWorkbench().message).not.toBe("Error: stale metadata subscription");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Index" && notice.message.includes("stale metadata subscription"),
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
      // IDE mode keeps the open-time PHP plan refresh active so the
      // stale-switch isolation guard is exercised (deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
        defaultPhpLanguageServerOptions(),
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
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor B ready");
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
      // IDE mode keeps the open-time PHP plan refresh active so the
      // stale-switch isolation guard is exercised (deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      workspaceAPlan.reject(new Error("stale PHP plan"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor B ready");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP plan"),
      ),
    ).toBe(false);
  });
  it("starts the managed PHPactor install without blocking on completion", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness({
      installManagedPhpactor: vi.fn(async () => undefined),
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: {
          executable: "phpactor",
          path: "/managed/vendor/bin/phpactor",
          source: "managed" as const,
        },
      })),
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    let installPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      installPromise = getWorkbench().installManagedPhpactor();
    });

    // The install invoke resolves immediately (work is scheduled on a
    // background thread) and the indicator stays busy while we wait for the
    // completion event.
    await act(async () => {
      await installPromise;
    });
    expect(phpTools.installManagedPhpactor).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().installingManagedPhpactor).toBe(true);

    // Re-detection only happens once the background install reports completion.
    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({ root: "/workspace", error: null });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(phpTools.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().installingManagedPhpactor).toBe(false);
    expect(getWorkbench().message).toBe("Installed managed PHP IDE engine.");
  });
  it("ignores managed PHPactor install completion after switching project tabs", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({ root: "/workspace-a", error: null });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Installed managed PHP IDE engine.");
    // The stale completion never triggers re-detection for the abandoned root.
    expect(phpTools.detectPhpTools).not.toHaveBeenCalledWith("/workspace-a");
  });
  it("ignores managed PHPactor install errors after switching project tabs", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      emitCompletion({ root: "/workspace-a", error: "stale managed install" });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale managed install"),
      ),
    ).toBe(false);
  });
  it("reports managed PHPactor install failures for the active workspace", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(getWorkbench().installingManagedPhpactor).toBe(true);
    });

    // A failed install must not run re-detection for the workspace.
    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({
        root: "/workspace",
        error: "composer require failed",
      });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().installingManagedPhpactor).toBe(false);
    expect(phpTools.detectPhpTools).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("composer require failed"),
      ),
    ).toBe(true);
  });
  it("clears managed PHPactor install loading when the last project tab closes", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledOnce();
      expect(getWorkbench().installingManagedPhpactor).toBe(true);
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      emitCompletion({ root: "/workspace", error: null });
      await Promise.resolve();
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
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
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
          notice.source === "Language Server" && notice.message.includes("stale PHP start"),
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
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
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
          notice.source === "Language Server" && notice.message.includes("stale PHP stop"),
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
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith("/workspace-b");
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
          notice.source === "Language Server" && notice.message.includes("stale PHP status"),
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
      appSettings: workspaceAppSettings(),
      languageServerPlan,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
  });
  it("passes workspace PHP language server settings to plan and autostart", async () => {
    const phpOptions: PhpLanguageServerPlanOptions = {
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
        ...phpOptions,
      },
    });
    await flushAsyncTurns(24);

    expect(dependencies.languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      phpOptions,
    );
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      phpOptions,
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
    const start = vi.fn<LanguageServerRuntimeGateway["start"]>(async () => runningStatus);
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
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
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
    await waitForReact(() => {
      expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
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
          notice.source === "Language Server" && notice.message.includes("stale PHP autostart"),
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
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
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
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
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
      appSettings: workspaceAppSettings(),
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
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );

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
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("starts only the trusted project's JavaScript and TypeScript service after trust is granted", async () => {
    const trustedRoots = new Set<string>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: trustedRoots.has(rootPath),
      })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        if (!trusted) {
          trustedRoots.delete(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) =>
        trustedRoots.has(rootPath)
          ? readyJavaScriptTypeScriptPlan(rootPath)
          : {
              command: null,
              initializeRequest: null,
              message: "Trust this workspace to start TypeScript.",
              provider: "typeScriptLanguageServer" as const,
              status: "unavailable" as const,
            },
      ),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => ({
        ...javaScriptTypeScriptWorkspaceDescriptor(),
        rootPath,
      })),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptRuntimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 41,
      },
      languageServerGateway,
      workspaceDetectionGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "auto",
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust).toEqual({
        rootPath: "/workspace-a",
        trusted: false,
      });
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
    });
    await waitForReact(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
      ).toHaveBeenCalledWith("/workspace-a", expect.any(Object));
    });

    expect(
      vi
        .mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start)
        .mock.calls.map(([rootPath]) => rootPath),
    ).toEqual(["/workspace-a"]);
    expect(
      vi
        .mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-b"),
    ).toBe(false);
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("stops both current project language runtimes when settings revoke trust", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
    });

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-b");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-b");
  });
  it("deduplicates overlapping trust and settings grants before TypeScript autostart", async () => {
    const trustedRoots = new Set<string>();
    const trustedPlan = createDeferred<LanguageServerPlan>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
    };
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "basic" as const,
      javaScriptTypeScriptService: "auto" as const,
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) => {
        if (!trustedRoots.has(rootPath)) {
          return {
            command: null,
            initializeRequest: null,
            message: "Trust this workspace to start TypeScript.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          };
        }

        return trustedPlan.promise;
      }),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings,
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings,
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mockClear();

    let togglePromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      togglePromise = getWorkbench().toggleWorkspaceTrust();
      settingsPromise = getWorkbench().saveWorkbenchSettings(appSettings, workspaceSettings, true);
      await flushAsyncTurns(24);
    });

    expect(languageServerGateway.planJavaScriptTypeScriptLanguageServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      trustedPlan.resolve(readyJavaScriptTypeScriptPlan("/workspace"));
      await Promise.all([togglePromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", expect.any(Object));
  });
  it("keeps the latest TypeScript preference when trust plans overlap", async () => {
    const bundledPlan = createDeferred<LanguageServerPlan>();
    const workspacePlan = createDeferred<LanguageServerPlan>();
    const trustedRoots = new Set<string>();
    let workspacePlanRequests = 0;
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
    };
    const bundledSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "basic" as const,
      javaScriptTypeScriptService: "auto" as const,
      javaScriptTypeScriptVersion: "bundled" as const,
    };
    const workspaceSettings = {
      ...bundledSettings,
      javaScriptTypeScriptVersion: "workspace" as const,
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath, options) => {
        if (!trustedRoots.has(rootPath)) {
          return {
            command: null,
            initializeRequest: null,
            message: "Trust this workspace to start TypeScript.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          };
        }

        if (options.typeScriptVersionPreference === "bundled") {
          return bundledPlan.promise;
        }

        workspacePlanRequests += 1;
        if (workspacePlanRequests === 1) {
          return workspacePlan.promise;
        }

        return {
          ...readyJavaScriptTypeScriptPlan(rootPath),
          message: "Workspace TypeScript plan.",
        };
      }),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings,
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: bundledSettings,
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mockClear();

    let togglePromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      togglePromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      settingsPromise = getWorkbench().saveWorkbenchSettings(appSettings, workspaceSettings, true);
      await flushAsyncTurns(24);
    });

    expect(
      vi
        .mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer)
        .mock.calls.map(([, options]) => options?.typeScriptVersionPreference),
    ).toEqual(["bundled", "workspace"]);

    await act(async () => {
      workspacePlan.resolve({
        ...readyJavaScriptTypeScriptPlan("/workspace"),
        message: "Workspace TypeScript plan.",
      });
      await flushAsyncTurns(24);
      bundledPlan.resolve({
        ...readyJavaScriptTypeScriptPlan("/workspace"),
        message: "Bundled TypeScript plan.",
      });
      await Promise.all([togglePromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan?.message).toBe(
      "Workspace TypeScript plan.",
    );
    expect(
      vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mock.calls[
        vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mock.calls.length -
          1
      ]?.[1]?.typeScriptVersionPreference,
    ).toBe("workspace");
  });
});

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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});

describe("useWorkbenchController document editing and language-service mutations", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("persists a settings revocation requested while a toolbar grant is pending", async () => {
    const grant = createDeferred<WorkspaceTrustState>();
    const revoke = createDeferred<WorkspaceTrustState>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn((_rootPath, trusted) => (trusted ? grant.promise : revoke.promise)),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) =>
        readyJavaScriptTypeScriptPlan(rootPath),
      ),
      planPhpLanguageServer: vi.fn(),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "auto",
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start).mockClear();

    let grantPromise: Promise<void> | null = null;
    let revokePromise: Promise<void> | null = null;
    await act(async () => {
      grantPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      revokePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
      await flushAsyncTurns(12);
    });

    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(1);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", true);

    await act(async () => {
      grant.resolve({ rootPath: "/workspace", trusted: true });
      await flushAsyncTurns(12);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(2);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", false);

    await act(async () => {
      revoke.resolve({ rootPath: "/workspace", trusted: false });
      await Promise.all([grantPromise, revokePromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledTimes(1);
  });
  it("persists a toolbar grant requested while a settings revocation is pending", async () => {
    const revoke = createDeferred<WorkspaceTrustState>();
    const grant = createDeferred<WorkspaceTrustState>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
      setTrust: vi.fn((_rootPath, trusted) => (trusted ? grant.promise : revoke.promise)),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) =>
        readyJavaScriptTypeScriptPlan(rootPath),
      ),
      planPhpLanguageServer: vi.fn(),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "auto",
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    let revokePromise: Promise<void> | null = null;
    let grantPromise: Promise<void> | null = null;
    await act(async () => {
      revokePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
      await flushAsyncTurns(12);
      grantPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });

    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(1);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", false);

    await act(async () => {
      revoke.resolve({ rootPath: "/workspace", trusted: false });
      await flushAsyncTurns(12);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(2);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", true);

    await act(async () => {
      grant.resolve({ rootPath: "/workspace", trusted: true });
      await Promise.all([revokePromise, grantPromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(1);
  });
  it("retries the persisted trust state after the latest intent fails", async () => {
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi
        .fn()
        .mockRejectedValueOnce(new Error("trust store unavailable"))
        .mockImplementationOnce(async (rootPath, trusted) => ({
          rootPath,
          trusted,
        })),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });
    expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", true);

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });

    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(2);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", true);
    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
  });
  it("releases desired trust when a workspace owner session closes", async () => {
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });
    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
      await flushAsyncTurns(12);
    });
    expect(getWorkbench().workspaceRoot).toBeNull();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace");
      await flushAsyncTurns(24);
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(workspaceTrustGateway.setTrust).mockClear();

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });

    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledExactlyOnceWith("/workspace", true);
  });
  it("drops a trust-grant autostart after replacing its owner at the same root", async () => {
    const selectedRoot = "/selected/trust-owner-replacement";
    const firstOwner = trustedDescriptor("ws-trust-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-trust-owner-b", selectedRoot);
    const descriptors = [firstOwner, secondOwner];
    const firstTrustGrant = createDeferred<WorkspaceTrustState>();
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) => ({
        command: null,
        initializeRequest: null,
        message: `Trust ${rootPath} to start TypeScript.`,
        provider: "typeScriptLanguageServer" as const,
        status: "unavailable" as const,
      })),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(() => firstTrustGrant.promise),
    };
    const { dependencies, getWorkbench } = renderController({
      languageServerGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "auto",
      },
      workspaceTrustGateway,
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(firstOwner);

    let trustPromise: Promise<void> | null = null;
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      firstTrustGrant.resolve({ rootPath: selectedRoot, trusted: true });
      await trustPromise;
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    expect(languageServerGateway.planJavaScriptTypeScriptLanguageServer).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });
  it("does not stop a same-root replacement when trust revocation completes late", async () => {
    const selectedRoot = "/selected/trust-revoke-owner-replacement";
    const firstOwner = trustedDescriptor("ws-trust-revoke-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-trust-revoke-b", selectedRoot);
    const descriptors = [firstOwner, secondOwner];
    const firstTrustRevocation = createDeferred<WorkspaceTrustState>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(() => firstTrustRevocation.promise),
    };
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
      workspaceTrustGateway,
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });

    let trustPromise: Promise<void> | null = null;
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    await act(async () => {
      firstTrustRevocation.resolve({ rootPath: selectedRoot, trusted: false });
      await trustPromise;
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
  });
  it("deduplicates matching toolbar and settings revocations", async () => {
    const toolbarRevocation = createDeferred<WorkspaceTrustState>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(() => toolbarRevocation.promise),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    const saveSettings = getWorkbench().saveWorkbenchSettings;
    let toolbarPromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      toolbarPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      settingsPromise = saveSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
      await flushAsyncTurns(24);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(1);

    await act(async () => {
      toolbarRevocation.resolve({ rootPath: "/workspace", trusted: false });
      await Promise.all([toolbarPromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledTimes(1);
  });
  it("lets a toolbar grant supersede a pending settings revocation", async () => {
    const settingsRevocation = createDeferred<WorkspaceTrustState>();
    const toolbarGrant = createDeferred<WorkspaceTrustState>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
      setTrust: vi.fn((_rootPath, trusted) =>
        trusted ? toolbarGrant.promise : settingsRevocation.promise,
      ),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    const toggleTrust = getWorkbench().toggleWorkspaceTrust;
    let settingsPromise: Promise<void> | null = null;
    let toolbarPromise: Promise<void> | null = null;
    await act(async () => {
      settingsPromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
      await flushAsyncTurns(24);
      toolbarPromise = toggleTrust();
      await flushAsyncTurns(12);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(1);

    await act(async () => {
      settingsRevocation.resolve({ rootPath: "/workspace", trusted: false });
      await flushAsyncTurns(12);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(2);
    expect(workspaceTrustGateway.setTrust).toHaveBeenLastCalledWith("/workspace", true);

    await act(async () => {
      toolbarGrant.resolve({ rootPath: "/workspace", trusted: true });
      await Promise.all([settingsPromise, toolbarPromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
  });
  it("shares runtime shutdown across revocations that overlap after trust changes", async () => {
    const phpStop = createDeferred<LanguageServerRuntimeStatus>();
    const typeScriptStop = createDeferred<LanguageServerRuntimeStatus>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop)
      .mockClear()
      .mockImplementation(async () => phpStop.promise);
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop)
      .mockClear()
      .mockImplementation(async () => typeScriptStop.promise);

    const saveSettings = getWorkbench().saveWorkbenchSettings;
    let toolbarPromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      toolbarPromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
    });
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      settingsPromise = saveSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
      await flushAsyncTurns(24);
    });
    expect(workspaceTrustGateway.setTrust).toHaveBeenCalledTimes(1);
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      phpStop.resolve({ kind: "stopped", rootPath: "/workspace" });
      typeScriptStop.resolve({ kind: "stopped", rootPath: "/workspace" });
      await Promise.all([toolbarPromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledTimes(1);
  });
  it("does not refresh or start JavaScript and TypeScript service after trust when it is off", async () => {
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "off",
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).mockClear();

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
    });
    await flushAsyncTurns(12);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => pendingStatus.promise),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => ({ kind: "stopped" as const })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
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
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath,
      sessionId,
    });
    let workspaceAStartAttempts = 0;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace-a"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await waitForReact(() => {
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
    await waitForReact(() => {
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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootlessRunningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };

    renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(javaScriptTypeScriptLanguageServerRuntimeGateway.getStatus).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(javaScriptTypeScriptLanguageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      {
        autoImportsEnabled: true,
        automaticTypeAcquisitionEnabled: false,
        codeLensEnabled: false,
        completeFunctionCalls: false,
        inlayHintsEnabled: true,
        typeScriptVersionPreference: "bundled",
        validationEnabled: true,
      },
    );
  });
});
