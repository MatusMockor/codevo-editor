// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
} from "../domain/settings";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  useLanguageServerRuntimeLifecycle,
  type LanguageServerRuntimeLifecycle,
  type LanguageServerRuntimeLifecycleDependencies,
} from "./useLanguageServerRuntimeLifecycle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FIRST_ROOT = "/links/workspace";
const SECOND_ROOT = "/workspaces/workspace";
const READY_PLAN = {
  command: null,
  initializeRequest: null,
  message: "ready",
  provider: "phpactor" as const,
  status: "ready" as const,
};
const TS_READY_PLAN = {
  ...READY_PLAN,
  provider: "typeScriptLanguageServer" as const,
};

function stopped(rootPath: string): LanguageServerRuntimeStatus {
  return { kind: "stopped", rootPath };
}

function running(rootPath: string, sessionId = 1): LanguageServerRuntimeStatus {
  return {
    capabilities: {} as Extract<
      LanguageServerRuntimeStatus,
      { kind: "running" }
    >["capabilities"],
    kind: "running",
    rootPath,
    sessionId,
  };
}

function runtimeGateway(): LanguageServerRuntimeGateway {
  return {
    getStatus: vi.fn(async (rootPath) => stopped(rootPath)),
    openLog: vi.fn(async () => null),
    start: vi.fn(async (rootPath) => running(rootPath)),
    stop: vi.fn(async (rootPath) => stopped(rootPath)),
    subscribeStatus: vi.fn(async () => () => undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });

  return { promise, reject, resolve };
}

function latestStatusListener(gateway: LanguageServerRuntimeGateway) {
  const calls = vi.mocked(gateway.subscribeStatus).mock.calls;
  const listener = calls[calls.length - 1]?.[0];

  if (!listener) {
    throw new Error("status listener not subscribed");
  }

  return listener;
}

interface Harness {
  dependencies: LanguageServerRuntimeLifecycleDependencies;
  lifecycle: () => LanguageServerRuntimeLifecycle;
  rerender: (owner: WorkspaceRuntimeOwner, overrides?: Partial<LanguageServerRuntimeLifecycleDependencies>) => void;
  unmount: () => void;
}

function renderLifecycle(
  owner: WorkspaceRuntimeOwner,
  overrides: Partial<LanguageServerRuntimeLifecycleDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured = { current: null as LanguageServerRuntimeLifecycle | null };
  const workspaceSettings = {
    ...defaultWorkspaceSettings(),
    intelligenceMode: "fullSmart" as const,
    javaScriptTypeScriptService: "off" as const,
  };
  const phpGateway = runtimeGateway();
  const tsGateway = runtimeGateway();
  const currentWorkspaceRootRef = { current: owner.executionRoot as string | null };

  const dependencies: LanguageServerRuntimeLifecycleDependencies = {
    workspaceRoot: owner.executionRoot,
    workspaceRuntimeOwner: owner,
    workspaceTrust: { rootPath: owner.executionRoot, trusted: true },
    intelligenceMode: "fullSmart",
    workspaceSettings,
    shouldAutoStartJavaScriptTypeScriptLanguageServer: false,
    phpLanguageServerAutostartRetryVersion: 0,
    languageServerPlan: null,
    javaScriptTypeScriptLanguageServerPlan: null,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    appSettingsRef: { current: defaultAppSettings() },
    workspaceSettingsRef: { current: workspaceSettings },
    currentWorkspaceRootRef,
    autoStartedLanguageServerRootRef: { current: null },
    phpLanguageServerAutostartAttemptsByRootRef: { current: {} },
    manuallyStoppedPhpLanguageServerRootsRef: { current: new Set() },
    autoStartedJavaScriptTypeScriptLanguageServerRootRef: { current: null },
    lastLanguageServerCrashRef: { current: null },
    languageServerRuntimeStatusByRootRef: { current: {} },
    javaScriptTypeScriptLanguageServerRuntimeStatusRef: { current: null },
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: { current: null },
    javaScriptTypeScriptRuntimeStatusByRootRef: { current: {} },
    setPhpTools: vi.fn(),
    setLanguageServerPlan: vi.fn(),
    setJavaScriptTypeScriptLanguageServerPlan: vi.fn(),
    setLanguageServerRuntimeStatus: vi.fn(),
    setLanguageServerRuntimeStatusRoot: vi.fn(),
    setJavaScriptTypeScriptLanguageServerRuntimeStatus: vi.fn(),
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: vi.fn(),
    setMessage: vi.fn(),
    setNotices: vi.fn(),
    setPhpLanguageServerAutostartRetryVersion: vi.fn(),
    phpToolGateway: {
      detectPhpTools: vi.fn(),
      installManagedPhpactor: vi.fn(),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    },
    languageServerGateway: {
      planPhpLanguageServer: vi.fn(),
      planJavaScriptTypeScriptLanguageServer: vi.fn(),
    },
    languageServerRuntimeGateway: phpGateway,
    javaScriptTypeScriptLanguageServerRuntimeGateway: tsGateway,
    workspaceRuntimeLifecycleGateway: { disposeWorkspace: vi.fn() },
    terminalGateway: { stopRoot: vi.fn() } as never,
    clearLanguageServerDiagnosticsForRoot: vi.fn(),
    clearJavaScriptTypeScriptDiagnosticsForRoot: vi.fn(),
    resetLanguageServerDocuments: vi.fn(),
    resetJavaScriptTypeScriptLanguageServerDocuments: vi.fn(),
    isLanguageServerSessionCurrentForRoot: vi.fn(() => false),
    reportError: vi.fn(),
    reportLanguageServerError: vi.fn(),
    reportLanguageServerErrorForActiveWorkspaceRoot: vi.fn(),
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    ...overrides,
  };

  function TestComponent() {
    captured.current = useLanguageServerRuntimeLifecycle(dependencies);
    return null;
  }

  const rerender = (
    nextOwner: WorkspaceRuntimeOwner,
    nextOverrides: Partial<LanguageServerRuntimeLifecycleDependencies> = {},
  ) => {
    currentWorkspaceRootRef.current = nextOwner.executionRoot;
    Object.assign(dependencies, nextOverrides, {
      workspaceRoot: nextOwner.executionRoot,
      workspaceRuntimeOwner: nextOwner,
      workspaceTrust: { rootPath: nextOwner.executionRoot, trusted: true },
    });
    act(() => root.render(<TestComponent />));
  };

  rerender(owner);

  return {
    dependencies,
    lifecycle: () => {
      if (!captured.current) {
        throw new Error("lifecycle not mounted");
      }

      return captured.current;
    },
    rerender,
    unmount: () => act(() => root.unmount()),
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("useLanguageServerRuntimeLifecycle ownership", () => {
  it("does not autostart PHP or TS twice when one owner transfers aliases", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(firstOwner, SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", "/workspace-b");
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "fullSmart" as const,
      javaScriptTypeScriptService: "auto" as const,
    };
    const harness = renderLifecycle(firstOwner, {
      workspaceSettings,
      workspaceSettingsRef: { current: workspaceSettings },
      languageServerPlan: READY_PLAN,
      javaScriptTypeScriptLanguageServerPlan: TS_READY_PLAN,
      shouldAutoStartJavaScriptTypeScriptLanguageServer: true,
    });

    await flushEffects();
    harness.rerender(transferredOwner);
    await flushEffects();

    expect(harness.dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(1);
    expect(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.autoStartedLanguageServerRootRef.current).toBe(
      firstOwner.ownerKey,
    );
    expect(
      harness.dependencies.autoStartedJavaScriptTypeScriptLanguageServerRootRef
        .current,
    ).toBe(firstOwner.ownerKey);

    harness.rerender(secondOwner);
    await flushEffects();

    expect(harness.dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
    expect(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("isolates a manual PHP stop from another owner", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(firstOwner, SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const harness = renderLifecycle(firstOwner);
    harness.dependencies.appSettingsRef.current.workspaceTabs = [SECOND_ROOT];

    await act(async () => harness.lifecycle().stopLanguageServer());
    harness.rerender(transferredOwner, { languageServerPlan: READY_PLAN });
    await flushEffects();
    expect(harness.dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();

    harness.rerender(secondOwner);
    await flushEffects();
    expect(harness.dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      SECOND_ROOT,
      expect.any(Object),
    );
    harness.unmount();
  });

  it("keys status and cleanup by owner while gateways use execution roots", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(firstOwner, SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const harness = renderLifecycle(firstOwner);
    harness.dependencies.appSettingsRef.current.workspaceTabs = [SECOND_ROOT];

    act(() => {
      harness.lifecycle().handleLanguageServerRuntimeStatus(
        running(FIRST_ROOT),
        FIRST_ROOT,
        firstOwner,
      );
      harness.lifecycle().handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        running(SECOND_ROOT, 2),
        SECOND_ROOT,
        secondOwner,
      );
    });
    harness.dependencies.phpLanguageServerAutostartAttemptsByRootRef.current[
      firstOwner.ownerKey
    ] = 2;
    harness.dependencies.autoStartedLanguageServerRootRef.current =
      firstOwner.ownerKey;
    harness.dependencies.autoStartedJavaScriptTypeScriptLanguageServerRootRef.current =
      firstOwner.ownerKey;

    await act(async () => {
      await harness.lifecycle().stopLanguageServerRuntime(
        SECOND_ROOT,
        transferredOwner,
      );
      await harness.lifecycle().stopJavaScriptTypeScriptLanguageServerRuntime(
        SECOND_ROOT,
        transferredOwner,
      );
    });

    expect(harness.dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      SECOND_ROOT,
    );
    expect(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).toHaveBeenCalledWith(SECOND_ROOT);
    expect(
      Object.keys(harness.dependencies.languageServerRuntimeStatusByRootRef.current),
    ).toEqual([firstOwner.ownerKey]);
    expect(
      Object.keys(
        harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current,
      ),
    ).toEqual(expect.arrayContaining([firstOwner.ownerKey, secondOwner.ownerKey]));

    act(() => {
      harness.lifecycle().forgetLanguageServerRuntimeStatuses(
        SECOND_ROOT,
        transferredOwner,
      );
    });

    expect(harness.dependencies.languageServerRuntimeStatusByRootRef.current).toEqual({});
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toBeDefined();
    expect(harness.dependencies.phpLanguageServerAutostartAttemptsByRootRef.current).toEqual({});
    expect(harness.dependencies.autoStartedLanguageServerRootRef.current).toBeNull();
    expect(
      harness.dependencies.autoStartedJavaScriptTypeScriptLanguageServerRootRef
        .current,
    ).toBeNull();
    harness.unmount();
  });

  it("passes owners through every diagnostics cleanup path", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const harness = renderLifecycle(firstOwner);
    harness.dependencies.appSettingsRef.current.workspaceTabs = [SECOND_ROOT];

    await flushEffects();
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, firstOwner);

    await act(async () => {
      await harness.lifecycle().stopProjectRuntimes(SECOND_ROOT, secondOwner);
    });

    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, secondOwner);
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, secondOwner);
    expect(
      harness.dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(SECOND_ROOT);
    harness.unmount();
  });

  it("binds subscription events to the owner captured for each alias", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(firstOwner, SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const harness = renderLifecycle(firstOwner);
    await flushEffects();

    const firstPhpListener = latestStatusListener(
      harness.dependencies.languageServerRuntimeGateway,
    );
    const firstTsListener = latestStatusListener(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
    );
    act(() => {
      firstPhpListener(running(FIRST_ROOT));
      firstTsListener(running(FIRST_ROOT, 2));
    });

    harness.rerender(transferredOwner);
    await flushEffects();
    const transferredPhpListener = latestStatusListener(
      harness.dependencies.languageServerRuntimeGateway,
    );
    const transferredTsListener = latestStatusListener(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
    );
    act(() => {
      transferredPhpListener(running(SECOND_ROOT, 3));
      transferredTsListener(running(SECOND_ROOT, 4));
    });

    harness.rerender(secondOwner);
    await flushEffects();
    act(() => {
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(SECOND_ROOT, 5),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(SECOND_ROOT, 6));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 3 });
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 5 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 4 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 6 });
    harness.unmount();
  });

  it("rejects pending callbacks after forget without admitting a same-root owner", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const pendingStart = deferred<LanguageServerRuntimeStatus>();
    const pendingStop = deferred<LanguageServerRuntimeStatus>();
    const phpGateway = runtimeGateway();
    vi.mocked(phpGateway.start).mockReturnValueOnce(pendingStart.promise);
    vi.mocked(phpGateway.stop).mockReturnValueOnce(pendingStop.promise);
    const harness = renderLifecycle(firstOwner, {
      languageServerRuntimeGateway: phpGateway,
    });
    await flushEffects();
    const forgottenListener = latestStatusListener(phpGateway);

    const startPromise = harness.lifecycle().startLanguageServer();
    const stopPromise = harness.lifecycle().stopLanguageServerRuntime(
      SECOND_ROOT,
      firstOwner,
    );
    act(() => {
      harness.lifecycle().forgetLanguageServerRuntimeStatuses(
        SECOND_ROOT,
        firstOwner,
      );
      forgottenListener(running(SECOND_ROOT, 7));
    });
    harness.rerender(secondOwner);

    pendingStart.resolve(running(SECOND_ROOT, 8));
    pendingStop.resolve(stopped(SECOND_ROOT));
    await act(async () => {
      await Promise.all([startPromise, stopPromise]);
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toEqual(stopped(SECOND_ROOT));
    harness.unmount();
  });

  it("resubscribes the same owner at its new generation after forget", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", SECOND_ROOT);
    const harness = renderLifecycle(owner);
    await flushEffects();
    const stalePhpListener = latestStatusListener(
      harness.dependencies.languageServerRuntimeGateway,
    );
    const staleTsListener = latestStatusListener(
      harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
    );

    act(() => {
      harness.lifecycle().forgetLanguageServerRuntimeStatuses(
        SECOND_ROOT,
        owner,
      );
    });
    await flushEffects();

    act(() => {
      stalePhpListener(running(SECOND_ROOT, 10));
      staleTsListener(running(SECOND_ROOT, 11));
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(SECOND_ROOT, 12),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(SECOND_ROOT, 13));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 12 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 13 });
    harness.unmount();
  });

  it("isolates stale same-root rejections from the replacement owner", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", SECOND_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const phpGetStatus = deferred<LanguageServerRuntimeStatus>();
    const phpSubscribe = deferred<() => void>();
    const phpStart = deferred<LanguageServerRuntimeStatus>();
    const phpStop = deferred<LanguageServerRuntimeStatus>();
    const phpProbe = deferred<Awaited<ReturnType<LanguageServerRuntimeLifecycleDependencies["phpToolGateway"]["detectPhpTools"]>>>();
    const tsGetStatus = deferred<LanguageServerRuntimeStatus>();
    const tsSubscribe = deferred<() => void>();
    const tsStart = deferred<LanguageServerRuntimeStatus>();
    const tsStop = deferred<LanguageServerRuntimeStatus>();
    const phpGateway = runtimeGateway();
    const tsGateway = runtimeGateway();
    vi.mocked(phpGateway.getStatus)
      .mockReturnValueOnce(phpGetStatus.promise)
      .mockImplementation(async (rootPath) => stopped(rootPath));
    vi.mocked(phpGateway.subscribeStatus)
      .mockReturnValueOnce(phpSubscribe.promise)
      .mockImplementation(async () => () => undefined);
    vi.mocked(phpGateway.start).mockReturnValueOnce(phpStart.promise);
    vi.mocked(phpGateway.stop).mockReturnValueOnce(phpStop.promise);
    vi.mocked(tsGateway.getStatus)
      .mockReturnValueOnce(tsGetStatus.promise)
      .mockImplementation(async (rootPath) => stopped(rootPath));
    vi.mocked(tsGateway.subscribeStatus)
      .mockReturnValueOnce(tsSubscribe.promise)
      .mockImplementation(async () => () => undefined);
    vi.mocked(tsGateway.stop)
      .mockResolvedValueOnce(stopped(SECOND_ROOT))
      .mockReturnValueOnce(tsStop.promise);
    vi.mocked(tsGateway.start).mockReturnValueOnce(tsStart.promise);
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "fullSmart" as const,
      javaScriptTypeScriptService: "auto" as const,
    };
    const phpToolGateway = {
      detectPhpTools: vi.fn(() => phpProbe.promise),
      installManagedPhpactor: vi.fn(),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const harness = renderLifecycle(firstOwner, {
      workspaceSettings,
      workspaceSettingsRef: { current: workspaceSettings },
      languageServerRuntimeGateway: phpGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway: tsGateway,
      phpToolGateway,
      languageServerGateway: {
        planPhpLanguageServer: vi.fn(),
        planJavaScriptTypeScriptLanguageServer: vi.fn(async () => TS_READY_PLAN),
      },
    });

    const phpStartPromise = harness.lifecycle().startLanguageServer();
    const phpStopPromise = harness.lifecycle().stopLanguageServerRuntime(
      SECOND_ROOT,
      firstOwner,
    );
    const phpProbePromise = harness.lifecycle().runPhpWorkspaceProbe(
      SECOND_ROOT,
      firstOwner,
    );
    const tsStartPromise = harness.lifecycle().restartJavaScriptTypeScriptService();
    await flushEffects();
    const tsStopPromise = harness.lifecycle().stopJavaScriptTypeScriptLanguageServerRuntime(
      SECOND_ROOT,
      firstOwner,
    );
    harness.rerender(secondOwner);

    const staleError = new Error("stale owner failure");
    phpGetStatus.reject(staleError);
    phpSubscribe.reject(staleError);
    phpStart.reject(staleError);
    phpStop.reject(staleError);
    phpProbe.reject(staleError);
    tsGetStatus.reject(staleError);
    tsSubscribe.reject(staleError);
    tsStart.reject(staleError);
    tsStop.reject(staleError);
    await act(async () => {
      await Promise.all([
        phpStartPromise,
        phpStopPromise,
        phpProbePromise,
        tsStartPromise,
        tsStopPromise,
      ]);
    });

    expect(harness.dependencies.reportLanguageServerError).not.toHaveBeenCalled();
    expect(harness.dependencies.reportError).not.toHaveBeenCalled();
    expect(
      harness.dependencies.reportLanguageServerErrorForActiveWorkspaceRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.reportErrorForActiveWorkspaceRoot,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });
});
