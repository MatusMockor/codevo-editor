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
  createLegacyWorkspaceRuntimeOwner,
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

function starting(rootPath: string, sessionId = 1): LanguageServerRuntimeStatus {
  return { kind: "starting", rootPath, sessionId };
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

function crashed(
  rootPath: string,
  message: string,
): LanguageServerRuntimeStatus {
  return { kind: "crashed", message, rootPath };
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
    resetLanguageServerDiagnosticsForRoot: vi.fn(),
    resetJavaScriptTypeScriptDiagnosticsForRoot: vi.fn(),
    prepareLanguageServerDiagnosticsForRuntimeStart: vi.fn(),
    prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart: vi.fn(),
    resetLanguageServerDocuments: vi.fn(),
    resetJavaScriptTypeScriptLanguageServerDocuments: vi.fn(),
    isLanguageServerSessionCurrentForRoot: vi.fn(() => false),
    reportError: vi.fn(),
    reportLanguageServerCrash: vi.fn(),
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
    Object.assign(
      dependencies,
      {
        workspaceRoot: nextOwner.executionRoot,
        workspaceRuntimeOwner: nextOwner,
        workspaceTrust: { rootPath: nextOwner.executionRoot, trusted: true },
      },
      nextOverrides,
    );
    act(() => root.render(<TestComponent />));
  };

  rerender(owner, overrides);

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
  it("reports a PHP crashed runtime status through the crash reporter", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const harness = renderLifecycle(owner);
    await flushEffects();

    act(() => {
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        crashed(FIRST_ROOT, "phpactor exited with code 1"),
      );
    });

    expect(harness.dependencies.reportLanguageServerCrash).toHaveBeenCalledWith(
      "phpactor exited with code 1",
    );
    expect(
      harness.dependencies.reportLanguageServerError,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("uses transient resets for PHP and TS starting-to-running transitions", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const harness = renderLifecycle(owner);
    await flushEffects();
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.resetLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.resetJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();

    act(() => {
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        starting(FIRST_ROOT, 61),
      );
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(FIRST_ROOT, 61),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(starting(FIRST_ROOT, 62));
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(FIRST_ROOT, 62));
    });

    expect(
      harness.dependencies.resetLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    expect(
      harness.dependencies.resetJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 61 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 62 });
    harness.unmount();
  });

  it("resets background PHP and TS diagnostics without making the owner visible", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const harness = renderLifecycle(firstOwner);
    harness.dependencies.appSettingsRef.current.workspaceTabs = [SECOND_ROOT];
    await flushEffects();
    vi.mocked(harness.dependencies.setLanguageServerRuntimeStatus).mockClear();
    vi.mocked(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();

    act(() => {
      harness.lifecycle().handleLanguageServerRuntimeStatus(
        starting(SECOND_ROOT, 71),
        SECOND_ROOT,
        secondOwner,
      );
      harness.lifecycle().handleLanguageServerRuntimeStatus(
        running(SECOND_ROOT, 71),
        SECOND_ROOT,
        secondOwner,
      );
      harness.lifecycle().handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        starting(SECOND_ROOT, 72),
        SECOND_ROOT,
        secondOwner,
      );
      harness.lifecycle().handleJavaScriptTypeScriptLanguageServerRuntimeStatus(
        running(SECOND_ROOT, 72),
        SECOND_ROOT,
        secondOwner,
      );
    });

    expect(
      harness.dependencies.resetLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, secondOwner);
    expect(
      harness.dependencies.resetJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, secondOwner);
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.setLanguageServerRuntimeStatus,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("prepares PHP diagnostics after an explicit stop before starting", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const harness = renderLifecycle(owner);
    await flushEffects();

    await act(async () => {
      await harness.lifecycle().stopLanguageServerRuntime(FIRST_ROOT, owner);
    });
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.resetLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.prepareLanguageServerDiagnosticsForRuntimeStart,
    ).mockClear();

    await act(async () => {
      await harness.lifecycle().startLanguageServer();
    });

    expect(
      harness.dependencies.prepareLanguageServerDiagnosticsForRuntimeStart,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    expect(
      harness.dependencies.resetLanguageServerDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running" });
    harness.unmount();
  });

  it("prepares TS diagnostics after restart reset before starting", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "fullSmart" as const,
      javaScriptTypeScriptService: "auto" as const,
    };
    const harness = renderLifecycle(owner, {
      workspaceSettings,
      workspaceSettingsRef: { current: workspaceSettings },
      languageServerGateway: {
        planPhpLanguageServer: vi.fn(),
        planJavaScriptTypeScriptLanguageServer: vi.fn(async () => TS_READY_PLAN),
      },
    });
    await flushEffects();

    await act(async () => {
      await harness
        .lifecycle()
        .stopJavaScriptTypeScriptLanguageServerRuntime(FIRST_ROOT, owner);
    });
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.resetJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies
        .prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    ).mockClear();

    await act(async () => {
      await harness.lifecycle().restartJavaScriptTypeScriptService();
    });

    expect(
      harness.dependencies.resetJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    expect(
      harness.dependencies
        .prepareJavaScriptTypeScriptDiagnosticsForRuntimeStart,
    ).toHaveBeenCalledWith(FIRST_ROOT, owner);
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running" });
    harness.unmount();
  });

  it("keeps legacy PHP and TS subscription events routed by background root", async () => {
    const foregroundOwner = createLegacyWorkspaceRuntimeOwner(FIRST_ROOT);
    const backgroundOwner = createLegacyWorkspaceRuntimeOwner(SECOND_ROOT);
    const harness = renderLifecycle(foregroundOwner, {
      workspaceRuntimeOwner: null,
    });
    harness.dependencies.appSettingsRef.current.workspaceTabs = [
      FIRST_ROOT,
      SECOND_ROOT,
    ];
    await flushEffects();

    vi.mocked(harness.dependencies.setLanguageServerRuntimeStatus).mockClear();
    vi.mocked(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).mockClear();

    act(() => {
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(SECOND_ROOT, 21),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(SECOND_ROOT, 22));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        backgroundOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 21 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        backgroundOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 22 });
    expect(
      harness.dependencies.setLanguageServerRuntimeStatus,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

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

  it("stops an inactive admitted owner without creating a legacy duplicate", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(
      firstOwner,
      SECOND_ROOT,
    );
    const secondOwner = createWorkspaceRuntimeOwner(
      "workspace-b",
      "/workspace-b",
    );
    const harness = renderLifecycle(firstOwner);
    harness.dependencies.appSettingsRef.current.workspaceTabs = [
      FIRST_ROOT,
      secondOwner.executionRoot,
    ];
    await flushEffects();
    harness.rerender(transferredOwner);
    await flushEffects();
    harness.rerender(secondOwner);
    await flushEffects();

    harness.dependencies.languageServerRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = running(SECOND_ROOT, 31);
    harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = running(SECOND_ROOT, 32);
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();

    await act(async () => {
      await harness.lifecycle().stopBackgroundProjectRuntimes(
        "singleActive",
        secondOwner.executionRoot,
        FIRST_ROOT,
      );
    });

    expect(
      harness.dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledWith(SECOND_ROOT);
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual({ kind: "stopped", rootPath: SECOND_ROOT });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual({ kind: "stopped", rootPath: SECOND_ROOT });
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, transferredOwner);
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(SECOND_ROOT, transferredOwner);
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        createLegacyWorkspaceRuntimeOwner(FIRST_ROOT).ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        createLegacyWorkspaceRuntimeOwner(SECOND_ROOT).ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        createLegacyWorkspaceRuntimeOwner(FIRST_ROOT).ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        createLegacyWorkspaceRuntimeOwner(SECOND_ROOT).ownerKey
      ],
    ).toBeUndefined();
    harness.unmount();
  });

  it("does not drain a captured fallback after same-root owner replacement", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", FIRST_ROOT);
    const pendingDisposal = deferred<void>();
    const phpGateway = runtimeGateway();
    const tsGateway = runtimeGateway();
    const stopTerminalRoot = vi.fn(async () => undefined);
    const terminalGateway = {
      stopRoot: stopTerminalRoot,
    } as never;
    const harness = renderLifecycle(firstOwner, {
      languageServerRuntimeGateway: phpGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway: tsGateway,
      terminalGateway,
      workspaceRuntimeLifecycleGateway: {
        disposeWorkspace: vi.fn(() => pendingDisposal.promise),
      },
    });
    await flushEffects();
    vi.mocked(phpGateway.stop).mockClear();
    vi.mocked(tsGateway.stop).mockClear();

    const disposal = harness.lifecycle().stopProjectRuntimes(
      FIRST_ROOT,
      firstOwner,
    );
    harness.rerender(secondOwner);
    await flushEffects();
    delete harness.dependencies.languageServerRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ];
    delete harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ];
    pendingDisposal.reject(new Error("dispose failed"));
    let result!: Awaited<typeof disposal>;
    await act(async () => {
      result = await disposal;
    });

    expect(result).toBe("stale");
    expect(phpGateway.stop).not.toHaveBeenCalled();
    expect(tsGateway.stop).not.toHaveBeenCalled();
    expect(stopTerminalRoot).not.toHaveBeenCalled();
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toBeUndefined();
    expect(
      harness.dependencies.reportErrorForActiveWorkspaceRoot,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("finalizes a successful fallback for an inactive admitted owner", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const phpGateway = runtimeGateway();
    const tsGateway = runtimeGateway();
    const stopTerminalRoot = vi.fn(async () => undefined);
    const harness = renderLifecycle(firstOwner, {
      languageServerRuntimeGateway: phpGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway: tsGateway,
      terminalGateway: { stopRoot: stopTerminalRoot } as never,
      workspaceRuntimeLifecycleGateway: {
        disposeWorkspace: vi.fn(async () => {
          throw new Error("dispose failed");
        }),
      },
    });
    await flushEffects();
    harness.rerender(secondOwner);
    await flushEffects();
    harness.dependencies.languageServerRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = running(FIRST_ROOT, 41);
    harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = running(FIRST_ROOT, 42);
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();

    let result: "stopped" | "incomplete" | "stale" | undefined;
    await act(async () => {
      result = await harness
        .lifecycle()
        .stopProjectRuntimes(FIRST_ROOT, firstOwner);
    });

    expect(result).toBe("stopped");
    expect(phpGateway.stop).toHaveBeenCalledWith(FIRST_ROOT);
    expect(tsGateway.stop).toHaveBeenCalledWith(FIRST_ROOT);
    expect(stopTerminalRoot).toHaveBeenCalledWith(FIRST_ROOT);
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual(stopped(FIRST_ROOT));
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual(stopped(FIRST_ROOT));
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, firstOwner);
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, firstOwner);
    expect(
      harness.dependencies.reportErrorForActiveWorkspaceRoot,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("finalizes only successful runtime stops when an inactive fallback partially fails", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", SECOND_ROOT);
    const phpGateway = runtimeGateway();
    const tsGateway = runtimeGateway();
    vi.mocked(phpGateway.stop).mockRejectedValue(new Error("php stop failed"));
    const stopTerminalRoot = vi.fn(async () => {
      throw new Error("terminal stop failed");
    });
    const harness = renderLifecycle(firstOwner, {
      languageServerRuntimeGateway: phpGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway: tsGateway,
      terminalGateway: { stopRoot: stopTerminalRoot } as never,
      workspaceRuntimeLifecycleGateway: {
        disposeWorkspace: vi.fn(async () => {
          throw new Error("dispose failed");
        }),
      },
    });
    await flushEffects();
    harness.rerender(secondOwner);
    await flushEffects();
    const phpRunning = running(FIRST_ROOT, 51);
    harness.dependencies.languageServerRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = phpRunning;
    harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = running(FIRST_ROOT, 52);
    vi.mocked(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).mockClear();
    vi.mocked(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).mockClear();

    let result: "stopped" | "incomplete" | "stale" | undefined;
    await act(async () => {
      result = await harness
        .lifecycle()
        .stopProjectRuntimes(FIRST_ROOT, firstOwner);
    });

    expect(result).toBe("incomplete");
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toBe(phpRunning);
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual(stopped(FIRST_ROOT));
    expect(
      harness.dependencies.clearLanguageServerDiagnosticsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.clearJavaScriptTypeScriptDiagnosticsForRoot,
    ).toHaveBeenCalledWith(FIRST_ROOT, firstOwner);
    expect(stopTerminalRoot).toHaveBeenCalledWith(FIRST_ROOT);
    expect(
      harness.dependencies.reportErrorForActiveWorkspaceRoot,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("remaps retained PHP and TS creation aliases only for the transferred owner", async () => {
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
      transferredPhpListener(running(FIRST_ROOT, 3));
      transferredPhpListener(crashed(FIRST_ROOT, "php failed"));
      transferredPhpListener(stopped(FIRST_ROOT));
      transferredTsListener(running(FIRST_ROOT, 4));
      transferredTsListener(crashed(FIRST_ROOT, "ts failed"));
      transferredTsListener(stopped(FIRST_ROOT));
    });

    expect(
      harness.dependencies.setLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "running",
        rootPath: SECOND_ROOT,
        sessionId: 3,
      }),
    );
    expect(
      harness.dependencies.setLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "crashed", rootPath: SECOND_ROOT }),
    );
    expect(
      harness.dependencies.setLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith({ kind: "stopped", rootPath: SECOND_ROOT });
    expect(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "running",
        rootPath: SECOND_ROOT,
        sessionId: 4,
      }),
    );
    expect(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "crashed", rootPath: SECOND_ROOT }),
    );
    expect(
      harness.dependencies.setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    ).toHaveBeenCalledWith({ kind: "stopped", rootPath: SECOND_ROOT });

    harness.rerender(secondOwner);
    await flushEffects();
    act(() => {
      const secondPhpListener = latestStatusListener(
        harness.dependencies.languageServerRuntimeGateway,
      );
      const secondTsListener = latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      );
      secondPhpListener(running(FIRST_ROOT, 5));
      secondTsListener(running(FIRST_ROOT, 6));
      secondPhpListener(running(SECOND_ROOT, 7));
      secondTsListener(running(SECOND_ROOT, 8));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual({ kind: "stopped", rootPath: SECOND_ROOT });
    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 7 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        firstOwner.ownerKey
      ],
    ).toEqual({ kind: "stopped", rootPath: SECOND_ROOT });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        secondOwner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 8 });
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

  it("rejects a retained PHP and TS alias after the owner generation changes", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const transferredOwner = transferWorkspaceRuntimeOwner(owner, SECOND_ROOT);
    const harness = renderLifecycle(owner);
    await flushEffects();
    harness.rerender(transferredOwner);
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
        transferredOwner,
      );
    });
    await flushEffects();

    const phpStatusBeforeStaleAlias =
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ];
    const tsStatusBeforeStaleAlias =
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ];

    act(() => {
      stalePhpListener(running(SECOND_ROOT, 10));
      staleTsListener(running(SECOND_ROOT, 11));
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(FIRST_ROOT, 12),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(FIRST_ROOT, 13));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toBe(phpStatusBeforeStaleAlias);
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toBe(tsStatusBeforeStaleAlias);

    act(() => {
      latestStatusListener(harness.dependencies.languageServerRuntimeGateway)(
        running(SECOND_ROOT, 14),
      );
      latestStatusListener(
        harness.dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
      )(running(SECOND_ROOT, 15));
    });

    expect(
      harness.dependencies.languageServerRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 14 });
    expect(
      harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
        owner.ownerKey
      ],
    ).toMatchObject({ kind: "running", sessionId: 15 });
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

  it("rejects a colliding TS session after a same-root owner cache miss", () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const secondOwner = createWorkspaceRuntimeOwner("workspace-b", FIRST_ROOT);
    const globalStatus = running(FIRST_ROOT, 73);
    const globalStatusRef = {
      current: globalStatus as LanguageServerRuntimeStatus | null,
    };
    const globalStatusRootRef = { current: FIRST_ROOT as string | null };
    const harness = renderLifecycle(firstOwner, {
      javaScriptTypeScriptLanguageServerRuntimeStatus: globalStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: FIRST_ROOT,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: globalStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef:
        globalStatusRootRef,
    });

    harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef.current[
      firstOwner.ownerKey
    ] = globalStatus;
    harness.rerender(secondOwner, {
      javaScriptTypeScriptLanguageServerRuntimeStatus: globalStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: FIRST_ROOT,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: globalStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef:
        globalStatusRootRef,
    });
    delete harness.dependencies.javaScriptTypeScriptRuntimeStatusByRootRef
      .current[secondOwner.ownerKey];

    expect(
      harness.lifecycle().isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
        FIRST_ROOT,
        73,
      ),
    ).toBe(false);
    expect(
      harness.lifecycle().isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
        FIRST_ROOT,
        73,
      ),
    ).toBe(false);
    harness.unmount();
  });

  it("retains the root-global TS session fallback for legacy ownership", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", FIRST_ROOT);
    const globalStatus = running(FIRST_ROOT, 74);
    const harness = renderLifecycle(owner, {
      workspaceRuntimeOwner: undefined,
      javaScriptTypeScriptLanguageServerRuntimeStatus: globalStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: FIRST_ROOT,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
        current: globalStatus,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: {
        current: FIRST_ROOT,
      },
    });

    expect(
      harness.lifecycle().isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
        FIRST_ROOT,
        74,
      ),
    ).toBe(true);
    harness.unmount();
  });
});
