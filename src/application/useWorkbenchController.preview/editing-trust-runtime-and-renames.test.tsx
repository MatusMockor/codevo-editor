// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  createInitialEditorGroupsState,
  defaultAppSettings,
  defaultWorkspaceSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerGateway,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type LanguageServerWorkspaceEdit,
  phpWorkspaceDescriptor,
  readyJavaScriptTypeScriptPlan,
  setupWorkbenchControllerTestHarness,
  trustedDescriptor,
  vi,
  waitForReact,
  type WorkspaceTrustGateway,
  type WorkspaceTrustState,
} from "./testSupport";

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
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi
        .fn<LanguageServerRuntimeGateway["start"]>(async () => rootedRunningStatus)
        .mockResolvedValueOnce(rootlessRunningStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };

    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(36);

    expect(javaScriptTypeScriptLanguageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
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
      appSettings: workspaceAppSettings(),
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

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/App.ts", "App.ts"));
    });
    await flushAsyncTurns(24);

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
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("blocks JavaScript TypeScript file rename when import edits cannot be requested", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockRejectedValueOnce(new Error("will rename crashed"));
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("will rename crashed"),
      ),
    ).toBe(true);
  });
  it("blocks JavaScript TypeScript file rename when import edits cannot be applied", async () => {
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
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
      appSettings: workspaceAppSettings(),
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
    vi.mocked(dependencies.workspaceGateways.files.applyWorkspaceEdit).mockRejectedValueOnce(
      new Error("apply workspace edit crashed"),
    );
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("apply workspace edit crashed"),
      ),
    ).toBe(true);
  });
  it("keeps an open import document unchanged when transactional rename edits fail", async () => {
    const oldPath = "/workspace/src/User.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const consumerContent = 'import { User } from "./User";\n';
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const applyWorkspaceEditTransaction = vi.fn(async () => {
      throw new Error("injected second-file failure");
    });
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }
        if (path === consumerPath) {
          return consumerContent;
        }
        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceFiles: { applyWorkspaceEditTransaction },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
      await getWorkbench().openPinnedFile(fileEntry(consumerPath, "Consumer.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(applyWorkspaceEditTransaction).toHaveBeenCalledWith(
      "/workspace",
      edit,
      expect.arrayContaining([oldPath, consumerPath]),
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.path).toBe(consumerPath);
    expect(getWorkbench().activeDocument?.content).toBe(consumerContent);
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("asks the JavaScript TypeScript service for import edits before renaming a folder", async () => {
    const oldPath = "/workspace/src/models";
    const newPath = "/workspace/src/domain";
    const consumerPath = "/workspace/src/Consumer.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "domain/User",
            range: {
              end: { character: 28, line: 0 },
              start: { character: 17, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 624,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
      });
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("remaps open documents under a renamed folder without losing dirty content", async () => {
    const oldFolderPath = "/workspace/src/models";
    const newFolderPath = "/workspace/src/domain";
    const oldDocumentPath = "/workspace/src/models/User.ts";
    const newDocumentPath = "/workspace/src/domain/User.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 626,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldDocumentPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldDocumentPath, "User.ts"));
    });
    await flushAsyncTurns(24);
    act(() => {
      getWorkbench().updateActiveDocument("export class User { dirty = true }\n");
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldFolderPath,
      });
    });

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldFolderPath,
      newFolderPath,
    );
    expect(
      getWorkbench().openDocuments.find((document) => document.path === oldDocumentPath),
    ).toBeUndefined();
    expect(
      getWorkbench().openDocuments.find((document) => document.path === newDocumentPath),
    ).toMatchObject({
      content: "export class User { dirty = true }\n",
      language: "typescript",
      name: "User.ts",
      path: newDocumentPath,
    });
    expect(getWorkbench().activePath).toBe(newDocumentPath);
    expect(getWorkbench().activeDocument?.path).toBe(newDocumentPath);
    expect(getWorkbench().activeDocument?.content).toBe("export class User { dirty = true }\n");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace", oldDocumentPath, 626);
    await flushAsyncTurns(24);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newDocumentPath,
        text: "export class User { dirty = true }\n",
      }),
      626,
    );
  });
  it("drops stale JavaScript TypeScript folder rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/models";
    const newPath = "/workspace-a/src/domain";
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
      sessionId: 625,
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
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
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
            newText: "domain/User",
            range: {
              end: { character: 28, line: 0 },
              start: { character: 17, line: 0 },
            },
          },
        ],
      },
    });
    await act(async () => {
      await renamePromise;
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace-a",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("asks the PHP language server for edits and re-syncs documents when renaming a folder", async () => {
    const oldPath = "/workspace/app/Services";
    const newPath = "/workspace/app/Domain";
    const oldDocumentPath = "/workspace/app/Services/UserService.php";
    const newDocumentPath = "/workspace/app/Domain/UserService.php";
    const consumerPath = "/workspace/app/Services/Consumer.php";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "namespace App\\Domain;",
            range: {
              end: { character: 23, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
      },
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 627,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldDocumentPath) {
          return "<?php\nnamespace App\\Services;\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldDocumentPath, "UserService.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "Services",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldDocumentPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(
      vi.mocked(languageServerFeaturesGateway.willRenameFiles).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.workspaceGateways.files.renamePath).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      vi.mocked(dependencies.workspaceGateways.files.renamePath).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(languageServerFeaturesGateway.didRenameFiles).mock.invocationCallOrder[0] ?? 0,
    );
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldDocumentPath,
      627,
    );
    await flushAsyncTurns(24);
    expect(dependencies.languageServerDocumentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: newDocumentPath }),
      627,
    );
  });
  it("notifies the PHP language server after a folder rename with no edits", async () => {
    const oldPath = "/workspace/app/Services";
    const newPath = "/workspace/app/Domain";
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(null);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 628,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "Services",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("does not call the PHP language server for a folder rename in light mode", async () => {
    const oldPath = "/workspace/src/models";
    const newPath = "/workspace/src/domain";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 629,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
  });
  it.each([
    ["/workspace/vendor", "vendor", "vendor-old", "/workspace/vendor-old"],
    ["/workspace/node_modules", "node_modules", "node_modules-old", "/workspace/node_modules-old"],
    ["/workspace/node_modules/pkg", "pkg", "pkg-two", "/workspace/node_modules/pkg-two"],
  ])(
    "skips JavaScript TypeScript rename machinery for excluded folder %s",
    async (oldPath, oldName, nextName, newPath) => {
      const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
      const runningStatus: LanguageServerRuntimeStatus = {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          didRenameFiles: true,
          willRenameFiles: true,
        },
        kind: "running",
        sessionId: 624,
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
        javaScriptTypeScriptLanguageServerFeaturesGateway,
        javaScriptTypeScriptRuntimeStatus: runningStatus,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns(24);
      vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce(nextName);

      await act(async () => {
        await getWorkbench().renameEntry({
          kind: "directory",
          name: oldName,
          path: oldPath,
        });
      });

      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
      ).not.toHaveBeenCalled();
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
      ).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    },
  );
  it("skips PHP rename machinery for an excluded vendor folder", async () => {
    const oldPath = "/workspace/vendor";
    const newPath = "/workspace/vendor-old";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 628,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("vendor-old");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "vendor",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
  });
  it("asks the PHP language server for file rename edits before renaming a PHP file", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const consumerPath = "/workspace/src/Consumer.php";
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
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 31,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("notifies the PHP language server after rename when only did-rename is supported", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      sessionId: 32,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("drops stale PHP rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const consumerPath = "/workspace-a/src/Consumer.php";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockImplementationOnce(
      () => renameEdit.promise,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 33,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
        "/workspace-a",
        oldPath,
        newPath,
      );
    });

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

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
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
        (notice) => notice.source === "Rename File" && notice.message.includes("stale rename"),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith(parentPath);
    });
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);

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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
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
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
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
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
        "/workspace",
        oldPath,
        newPath,
      );
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

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().message).toBe("Renamed User.ts");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("stale did rename"),
      ),
    ).toBe(false);
  });
  it("synchronizes JavaScript TypeScript edits already applied to open Monaco models", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const openUri = "file://localhost/workspace/src/%55ser.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 31,
    };
    const edit = {
      changes: {
        [openUri]: [
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
      documentVersions: {
        [openUri]: 1,
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
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
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          documents: [{ content: "let value = 1;\n", path: openPath, versionId: 8 }],
          kind: "applied",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(getWorkbench().activeDocument?.content).toBe("let value = 1;\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("const value = 1;\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
    );
  });
  it("keeps an inactive edited Monaco model authoritative and dirty when activated", async () => {
    const inactivePath = "/workspace/src/Inactive.ts";
    const activePath = "/workspace/src/Active.ts";
    const originalContent = "export const value = 1;\n";
    const editedContent = "export const value = 2;\n";
    const applyOpenModels = vi.fn(() => ({
      documents: [{ content: editedContent, path: inactivePath, versionId: 8 }],
      kind: "applied" as const,
    }));
    const edit = {
      changes: {
        [fileUriFromPath(inactivePath)]: [
          {
            newText: "2",
            range: {
              end: { character: 22, line: 0 },
              start: { character: 21, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === inactivePath ? originalContent : "export const active = true;\n",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(inactivePath, "Inactive.ts"));
      await getWorkbench().openPinnedFile(fileEntry(activePath, "Active.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [inactivePath],
        rootPath: "/workspace",
      });
      getWorkbench().setActivePath(inactivePath);
    });

    expect(getWorkbench().activeDocument).toEqual(
      expect.objectContaining({
        content: editedContent,
        path: inactivePath,
        savedContent: originalContent,
      }),
    );
    expect(applyOpenModels).toHaveBeenCalledOnce();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [inactivePath, activePath],
    );
  });
  it("rejects invalid staged open models before React, disk, or file operations", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const originalContent = "export const value = 1;\n";
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "2",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "helper",
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
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => originalContent),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          kind: "rejected",
          path: openPath,
          reason: "invalidOpenModelEdits",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "invalidOpenModelEdits",
    });
    expect(getWorkbench().activeDocument?.content).toBe(originalContent);
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("rolls back transactional closed-file edits when the open Monaco commit is rejected", async () => {
    const openPath = "/workspace/src/Open.php";
    const closedPath = "/workspace/src/Closed.php";
    const rollback = vi.fn(async () => undefined);
    const applyWorkspaceEditTransaction = vi.fn(async () => ({
      appliedCount: 1,
      rollback,
    }));
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "closed",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass Open {}\n"),
      workspaceFiles: { applyWorkspaceEditTransaction },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "Open.php"));
    });

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          kind: "rejected",
          path: openPath,
          reason: "invalidOpenModelEdits",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "invalidOpenModelEdits",
    });
    expect(applyWorkspaceEditTransaction).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
      undefined,
    );
    expect(rollback).toHaveBeenCalledOnce();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass Open {}\n");
  });
  it.each([
    { family: "JavaScript TypeScript", extension: "ts", overlap: false },
    { family: "JavaScript TypeScript", extension: "ts", overlap: true },
    { family: "PHP", extension: "php", overlap: false },
    { family: "PHP", extension: "php", overlap: true },
  ])(
    "rejects controller-only $family document B before staged A commit (overlap: $overlap)",
    async ({ extension, overlap }) => {
      const stagedPath = `/workspace/src/A.${extension}`;
      const controllerOnlyPath = `/workspace/src/B.${extension}`;
      const source = "abc";
      const invalidEdits = overlap
        ? [
            {
              newText: "first",
              range: {
                end: { character: 2, line: 0 },
                start: { character: 0, line: 0 },
              },
            },
            {
              newText: "second",
              range: {
                end: { character: 3, line: 0 },
                start: { character: 1, line: 0 },
              },
            },
          ]
        : [
            {
              newText: "invalid",
              range: {
                end: { character: 9, line: 0 },
                start: { character: 9, line: 0 },
              },
            },
          ];
      const edit = {
        changes: {
          [fileUriFromPath(stagedPath)]: [
            {
              newText: "A",
              range: {
                end: { character: 1, line: 0 },
                start: { character: 0, line: 0 },
              },
            },
          ],
          [fileUriFromPath(controllerOnlyPath)]: invalidEdits,
        },
        fileOperations: [
          {
            kind: "create" as const,
            uri: fileUriFromPath(`/workspace/src/Created.${extension}`),
          },
        ],
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        readTextFile: vi.fn(async () => source),
        ...(extension === "ts"
          ? { workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor() }
          : {}),
      });
      await flushAsyncTurns(24);
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(stagedPath, `A.${extension}`));
        await getWorkbench().openPinnedFile(fileEntry(controllerOnlyPath, `B.${extension}`));
      });
      const applyOpenModels = vi.fn(() => ({
        documents: [{ content: "Abc", path: stagedPath, versionId: 8 }],
        kind: "applied" as const,
      }));

      let decision;
      await act(async () => {
        decision =
          extension === "ts"
            ? await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
                applyOpenModels,
                openPaths: [stagedPath],
                rootPath: "/workspace",
              })
            : await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
                applyOpenModels,
                openPaths: [stagedPath],
                rootPath: "/workspace",
              });
      });

      expect(decision).toEqual({
        kind: "rejected",
        path: controllerOnlyPath,
        reason: "invalidOpenModelEdits",
      });
      expect(applyOpenModels).not.toHaveBeenCalled();
      expect(getWorkbench().openDocuments.map(({ content, path }) => ({ content, path }))).toEqual(
        expect.arrayContaining([
          { content: source, path: stagedPath },
          { content: source, path: controllerOnlyPath },
        ]),
      );
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    },
  );
  it("does not synchronize an open-model result for another workspace root", async () => {
    const openPath = "/workspace/src/User.ts";
    const originalContent = "export const value = 1;\n";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => originalContent),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        { changes: {} },
        {
          applyOpenModels: () => ({
            documents: [
              {
                content: "export const value = 2;\n",
                path: openPath,
                versionId: 8,
              },
            ],
            kind: "applied",
          }),
          openPaths: [openPath],
          rootPath: "/other",
        },
      );
    });

    expect(getWorkbench().activeDocument?.content).toBe(originalContent);
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("synchronizes PHP edits already applied to open Monaco models", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "<?php\nclass User {}\n";
        }

        return "";
      }),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          documents: [
            {
              content: "<?php\nfinal class User {}\n",
              path: openPath,
              versionId: 43,
            },
          ],
          kind: "applied",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(getWorkbench().activeDocument?.content).toBe("<?php\nfinal class User {}\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("<?php\nclass User {}\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
    );
  });
  it("rejects a stale mixed PHP workspace edit before any mutation", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const uri = fileUriFromPath(openPath);
    const applyOpenModels = vi.fn(() => ({
      documents: [
        {
          content: "<?php\nfinal class User {}\n",
          path: openPath,
          versionId: 43,
        },
      ],
      kind: "applied" as const,
    }));
    const edit = {
      changes: {
        [uri]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      documentVersions: {
        [uri]: 0,
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });
    await flushAsyncTurns(24);

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "staleDocumentVersion",
    });
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
    expect(applyOpenModels).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("filters PHP workspace edit file operations before applying closed files", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const outsidePath = "/other/src/Outside.php";
    const filteredEdit = {
      changes: {
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
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
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/src/Account.php"),
          oldUri: fileUriFromPath("/workspace/src/OldName.php"),
        },
      ],
    };
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
          {
            newText: "<?php\nfinal class Outside {}\n",
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
          uri: fileUriFromPath("/other/src/OutsideDelete.php"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "<?php\nclass User {}\n";
        }

        if (path === outsidePath) {
          return "<?php\nclass Outside {}\n";
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Outside.php"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(
      getWorkbench().openDocuments.find((document) => document.path === openPath)?.content,
    ).toBe("<?php\nclass User {}\n");
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("<?php\nclass Outside {}\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([openPath, outsidePath]),
    );
  });
  it("refreshes directories affected by PHP workspace edit file operations", async () => {
    const filteredEdit = {
      changes: {},
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/app/Models/Account.php"),
          oldUri: fileUriFromPath("/workspace/src/User.php"),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/workspace/tests/UserTest.php"),
        },
      ],
    };
    const edit = {
      changes: {},
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/tests/OutsideTest.php"),
        },
      ],
    };
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace/src") {
        return [fileEntry("/workspace/src/Created.php", "Created.php")];
      }

      if (path === "/workspace/app/Models") {
        return [fileEntry("/workspace/app/Models/Account.php", "Account.php")];
      }

      if (path === "/workspace/tests") {
        return [];
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceGateways.files.readDirectory).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      [],
    );
    expect(
      vi
        .mocked(dependencies.workspaceGateways.files.readDirectory)
        .mock.calls.map(([path]) => path),
    ).toEqual(["/workspace/src", "/workspace/app/Models", "/workspace/tests"]);
    expect(getWorkbench().entriesByDirectory["/workspace/app/Models"]).toEqual([
      fileEntry("/workspace/app/Models/Account.php", "Account.php"),
    ]);
  });
  it("syncs every open PHP document changed by one workspace edit", async () => {
    const firstPath = "/workspace/src/First.php";
    const secondPath = "/workspace/src/Second.php";
    const edit = {
      changes: {
        [fileUriFromPath(firstPath)]: [
          {
            newText: "ChangedFirst",
            range: {
              end: { character: 11, line: 1 },
              start: { character: 6, line: 1 },
            },
          },
        ],
        [fileUriFromPath(secondPath)]: [
          {
            newText: "ChangedSecond",
            range: {
              end: { character: 12, line: 1 },
              start: { character: 6, line: 1 },
            },
          },
        ],
      },
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 29,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === firstPath) {
          return "<?php\nclass First {}\n";
        }
        if (path === secondPath) {
          return "<?php\nclass Second {}\n";
        }
        return "";
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(firstPath, "First.php"));
      await getWorkbench().openPinnedFile(fileEntry(secondPath, "Second.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.documentSyncGateway.didChange).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await act(async () => {
      await Promise.all([
        getWorkbench().flushPendingLanguageServerDocument(firstPath),
        getWorkbench().flushPendingLanguageServerDocument(secondPath),
      ]);
    });

    expect(
      vi
        .mocked(dependencies.documentSyncGateway.didChange)
        .mock.calls.map(([, value]) => value.path),
    ).toEqual(expect.arrayContaining([firstPath, secondPath]));
  });
  it("reconciles open PHP tabs after workspace edit file operations", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const deletedPath = "/workspace/src/DeleteMe.php";
    const edit = {
      changes: {
        [fileUriFromPath(newPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 10, line: 1 },
              start: { character: 6, line: 1 },
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
      sessionId: 28,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        if (path === deletedPath) {
          return "<?php\nclass DeleteMe {}\n";
        }

        return "";
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(deletedPath, "DeleteMe.php"));
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await Promise.all([
        getWorkbench().flushPendingLanguageServerDocument(oldPath),
        getWorkbench().flushPendingLanguageServerDocument(deletedPath),
      ]);
    });
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    vi.mocked(dependencies.documentSyncGateway.didOpen).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([newPath]);
    expect(getWorkbench().activeDocument?.path).toBe(newPath);
    expect(getWorkbench().activeDocument?.name).toBe("Account.php");
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass Account {}\n");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      28,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      deletedPath,
      28,
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newPath,
        text: "<?php\nclass Account {}\n",
      }),
      28,
    );
  });
  it("rejects a stale mixed JavaScript TypeScript workspace edit before any mutation", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const uri = fileUriFromPath(openPath);
    const aliasUri = "file://localhost/workspace/src/%55ser.ts";
    const applyOpenModels = vi.fn();
    const edit = {
      changes: {
        [uri]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [aliasUri]: [
          {
            newText: "/* alias */\n",
            range: {
              end: { character: 0, line: 0 },
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
      documentVersions: {
        [aliasUri]: 2,
        [uri]: 1,
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });
    await flushAsyncTurns(24);

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "staleDocumentVersion",
    });
    expect(getWorkbench().activeDocument?.content).toBe("const value = 1;\n");
    expect(applyOpenModels).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
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
      appSettings: workspaceAppSettings(),
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
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(
      getWorkbench().openDocuments.find((document) => document.path === openPath)?.content,
    ).toBe("const value = 1;\n");
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("const outside = true;\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
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
      appSettings: workspaceAppSettings(),
      readDirectory,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceGateways.files.readDirectory).mockClear();

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      [],
    );
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
      appSettings: workspaceAppSettings(),
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
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([newPath]);
    expect(getWorkbench().activeDocument?.path).toBe(newPath);
    expect(getWorkbench().activeDocument?.name).toBe("Account.ts");
    expect(getWorkbench().activeDocument?.content).toBe("export class Account {}\n");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      27,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      deletedPath,
      27,
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newPath,
        text: "export class Account {}\n",
      }),
      27,
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
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([oldPath, outsidePath]),
    );
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("import { User } from '../workspace/src/User';\n");
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
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
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace-a",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("does not apply stale JavaScript TypeScript rename edits to an active nested project tab", async () => {
    const parentRoot = "/workspace";
    const childRoot = "/workspace/packages/app";
    const oldPath = "/workspace/src/User.ts";
    const childConsumerPath = "/workspace/packages/app/src/Consumer.ts";
    const initialConsumerSource = "import { User } from '../../src/User';\n";
    const staleRenameEdit: LanguageServerWorkspaceEdit = {
      changes: {
        [fileUriFromPath(childConsumerPath)]: [
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
    const applyClosedFiles = createDeferred<number>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      staleRenameEdit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: parentRoot,
      sessionId: 46,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: parentRoot,
        workspaceTabs: [parentRoot, childRoot],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        if (path === childConsumerPath) {
          return initialConsumerSource;
        }

        return `// ${path}\n`;
      }),
      settingsGateway: {
        loadAppSettings: vi.fn(async () => ({
          ...defaultAppSettings(),
          recentWorkspacePath: parentRoot,
          workspaceTabs: [parentRoot, childRoot],
        })),
        loadWorkspaceSettings: vi.fn(async (rootPath: string) => {
          if (rootPath === childRoot) {
            return {
              ...defaultWorkspaceSettings(),
              session: {
                ...defaultWorkspaceSettings().session,
                editor: createInitialEditorGroupsState("editor-main", {
                  activePath: childConsumerPath,
                  openPaths: [childConsumerPath],
                  previewPath: null,
                }),
              },
            };
          }

          return defaultWorkspaceSettings();
        }),
        saveAppSettings: vi.fn(async () => undefined),
        saveWorkspaceSettings: vi.fn(async () => undefined),
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");
    vi.mocked(dependencies.workspaceGateways.files.applyWorkspaceEdit).mockImplementationOnce(
      async () => applyClosedFiles.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
        parentRoot,
        staleRenameEdit,
        expect.arrayContaining([oldPath]),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(childRoot);
    });
    await flushAsyncTurns(24);

    await act(async () => {
      applyClosedFiles.resolve(0);
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(childRoot);
    expect(getWorkbench().activeDocument?.path).toBe(childConsumerPath);
    expect(getWorkbench().activeDocument?.content).toBe(initialConsumerSource);
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
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
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
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
      appSettings: workspaceAppSettings(),
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

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
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

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
});
