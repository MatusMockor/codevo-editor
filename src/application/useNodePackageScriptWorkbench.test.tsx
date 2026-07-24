// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NodePackageScript,
  NodePackageScriptsResult,
  NodePackageTaskEvent,
  StartNodePackageTaskResult,
} from "../domain/nodePackageScripts";
import { useNodePackageScriptWorkbench } from "./useNodePackageScriptWorkbench";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useNodePackageScriptWorkbench", () => {
  it("keeps discovery and refresh active while execution is disabled", async () => {
    const harness = await renderHarness({ executionEnabled: false });

    expect(harness.current().scripts).toEqual([SCRIPT]);
    expect(harness.subscribeNodePackageTaskEvents).not.toHaveBeenCalled();
    expect(harness.current().run(SCRIPT)).toBe(false);
    expect(harness.requestTerminalSession).not.toHaveBeenCalled();
    expect(harness.startNodePackageTask).not.toHaveBeenCalled();

    await act(async () => void (await harness.current().refresh()));
    expect(harness.listNodePackageScripts).toHaveBeenCalledTimes(2);
    expect(harness.current().scripts).toEqual([SCRIPT]);
    harness.unmount();
  });

  it("accepts an in-flight discovery after trust loss while cleaning execution", async () => {
    const discovery = deferred<NodePackageScriptsResult>();
    const harness = await renderHarness({ discoveryResult: discovery.promise });
    expect(harness.subscribeNodePackageTaskEvents).toHaveBeenCalledOnce();

    await harness.rerender({
      discoveryEnabled: true,
      executionEnabled: false,
      rootPath: "/workspace-1",
      workspaceId: "ws-1",
    });
    expect(harness.unsubscribeNodePackageTaskEvents).toHaveBeenCalledOnce();
    await act(async () => discovery.resolve(DISCOVERY_RESULT));

    expect(harness.current().scripts).toEqual([SCRIPT]);
    expect(harness.listNodePackageScripts).toHaveBeenCalledOnce();
    act(() => harness.current().run(SCRIPT));
    expect(harness.requestTerminalSession).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("subscribes before start, creates the owner eagerly, and blocks synchronous double-clicks", async () => {
    const order: string[] = [];
    const harness = await renderHarness({ order });

    act(() => {
      expect(harness.current().run(SCRIPT)).toBe(true);
      expect(harness.current().run(SCRIPT)).toBe(false);
    });
    expect(harness.requestTerminalSession).toHaveBeenCalledTimes(1);
    expect(harness.current().task).toMatchObject({ runId: "run-1", status: "acquiring-terminal" });

    await act(async () => harness.deliverSession(17));
    expect(order).toEqual(["subscribe", "start"]);
    expect(harness.startNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 17,
      manifestRelativePath: "apps/web/package.json",
      scriptName: "build prod ✓",
    });
    expect(harness.current().task).toMatchObject({ status: "running", sessionId: 17 });
    harness.unmount();
  });

  it("returns false for a stale script without latching the next valid admission", async () => {
    const harness = await renderHarness();
    const stale = { ...SCRIPT, key: `${SCRIPT.key}:stale` };

    expect(harness.current().run(stale)).toBe(false);
    expect(harness.requestTerminalSession).not.toHaveBeenCalled();
    expect(harness.current().run(SCRIPT)).toBe(true);
    expect(harness.requestTerminalSession).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("releases synchronous terminal rejection so the command can retry", async () => {
    const harness = await renderHarness({ terminalSessionResult: null });

    let first = false;
    act(() => {
      first = harness.current().run(SCRIPT);
    });
    expect(first).toBe(true);
    expect(harness.current().isActive()).toBe(false);
    expect(harness.current().task?.status).toBe("stopped");
    let retry = false;
    act(() => {
      retry = harness.current().run(SCRIPT);
    });
    expect(retry).toBe(true);
    expect(harness.requestTerminalSession).toHaveBeenCalledTimes(2);
    expect(harness.current().isActive()).toBe(false);
    harness.unmount();
  });

  it("stores ownership before ACK flushes an immediate running event", async () => {
    const harness = await renderHarness({
      onAcknowledge: (listener) => listener?.(event({ status: "running", sessionId: 23 })),
    });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(23));
    expect(harness.acknowledgeNodePackageTaskStart).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    expect(harness.current().task).toMatchObject({ status: "running", sessionId: 23 });
    harness.unmount();
  });

  it("waits for auxiliary output/problem subscriptions before dispatching start", async () => {
    const subscriptions = deferred<void>();
    const harness = await renderHarness({ additionalSubscriptionReady: subscriptions.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(25));
    expect(harness.startNodePackageTask).not.toHaveBeenCalled();
    await act(async () => subscriptions.resolve());
    expect(harness.startNodePackageTask).toHaveBeenCalledOnce();
    expect(harness.acknowledgeNodePackageTaskStart).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("reports auxiliary subscription failure without dispatching start", async () => {
    const subscriptions = deferred<void>();
    const harness = await renderHarness({ additionalSubscriptionReady: subscriptions.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => {
      harness.deliverSession(26);
      await Promise.resolve();
      subscriptions.reject(new Error("problem listen failed"));
    });
    expect(harness.startNodePackageTask).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "problem listen failed" }),
    );
    harness.unmount();
  });

  it("compensates with stop when start ACK fails", async () => {
    const acknowledgement = deferred<void>();
    const harness = await renderHarness({
      acknowledgeResult: acknowledgement.promise,
    });
    act(() => harness.current().run(SCRIPT));
    await act(async () => {
      harness.deliverSession(24);
      await Promise.resolve();
      acknowledgement.reject(new Error("ack rejected"));
    });
    expect(harness.stopNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    expect(harness.current().task?.status).not.toBe("running");
    harness.unmount();
  });

  it("keeps an early terminal event terminal after the start response arrives", async () => {
    const start = deferred<StartNodePackageTaskResult>();
    const harness = await renderHarness({ startResult: start.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(21));
    expect(harness.startNodePackageTask).toHaveBeenCalledTimes(1);

    act(() => harness.emit(event({ status: "exited", exitCode: 0, sessionId: 21 })));
    expect(harness.current().task).toMatchObject({
      status: "exited",
      sessionId: null,
      exitCode: 0,
    });
    await act(async () => start.resolve({ runId: "run-1" }));
    expect(harness.current().task).toMatchObject({ status: "exited", sessionId: null });
    harness.unmount();
  });

  it("reports a current start rejection and clears the terminal session reference", async () => {
    const start = deferred<StartNodePackageTaskResult>();
    const harness = await renderHarness({ startResult: start.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(22));
    await act(async () => start.reject(new Error("spawn rejected")));

    expect(harness.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "spawn rejected" }),
    );
    expect(harness.current().task).toEqual({
      runId: "run-1",
      workspaceId: "ws-1",
      manifestRelativePath: "apps/web/package.json",
      scriptName: "build prod ✓",
      status: "stopped",
      sessionId: null,
    });
    harness.unmount();
  });

  it("makes stop idempotent and lets an exit win a stop race", async () => {
    const stop = deferred<void>();
    const harness = await renderHarness({ stopResult: stop.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(23));
    act(() => {
      harness.current().stop();
      harness.current().stop();
    });
    expect(harness.stopNodePackageTask).toHaveBeenCalledTimes(1);
    expect(harness.current().task?.status).toBe("stopping");
    act(() => harness.emit(event({ status: "running", sessionId: 23 })));
    expect(harness.current().task?.status).toBe("stopping");

    act(() => harness.emit(event({ status: "exited", exitCode: 2, sessionId: 23 })));
    await act(async () => stop.resolve());
    expect(harness.current().task).toMatchObject({
      status: "exited",
      sessionId: null,
      exitCode: 2,
    });
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("ignores stale events with a wrong run, workspace, session, or script owner", async () => {
    const harness = await renderHarness();
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(24));
    const before = harness.current().task;

    act(() => {
      harness.emit(event({ status: "stopped", runId: "other", sessionId: 24 }));
      harness.emit(event({ status: "stopped", workspaceId: "ws-2", sessionId: 24 }));
      harness.emit(event({ status: "stopped", sessionId: 99 }));
      harness.emit(event({ status: "stopped", scriptName: "other", sessionId: 24 }));
    });
    expect(harness.current().task).toBe(before);
    act(() => harness.emit(event({ status: "stopped", sessionId: 24 })));
    expect(harness.current().task).toMatchObject({ status: "stopped", sessionId: null });
    harness.unmount();
  });

  it("cancels and clears the old owner on root switch and ignores its late event", async () => {
    const harness = await renderHarness();
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(25));
    await harness.rerender({
      discoveryEnabled: true,
      executionEnabled: true,
      rootPath: "/workspace-2",
      workspaceId: "ws-2",
    });

    expect(harness.stopNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    expect(harness.current().task).toBeNull();
    act(() => harness.emit(event({ status: "failed", message: "late", sessionId: 25 })));
    expect(harness.current().task).toBeNull();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each([
    {
      discoveryEnabled: true,
      executionEnabled: true,
      rootPath: "/workspace-2",
      workspaceId: "ws-2",
    },
    {
      discoveryEnabled: true,
      executionEnabled: false,
      rootPath: "/workspace-1",
      workspaceId: "ws-1",
    },
  ])("drops terminal acquisition after the owner or trust changes: %o", async (next) => {
    const harness = await renderHarness();
    act(() => harness.current().run(SCRIPT));
    await harness.rerender(next);
    await act(async () => harness.deliverSession(31));

    expect(harness.startNodePackageTask).not.toHaveBeenCalled();
    expect(harness.current().task).toBeNull();
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops terminal acquisition after unmount", async () => {
    const harness = await renderHarness();
    act(() => harness.current().run(SCRIPT));
    harness.unmount();
    await harness.deliverSession(32);
    expect(harness.startNodePackageTask).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("stops on unmount and drops late terminal acquisition and events", async () => {
    const harness = await renderHarness();
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(26));
    harness.unmount();

    expect(harness.stopNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    act(() => harness.emit(event({ status: "failed", message: "late", sessionId: 26 })));
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "root",
      next: {
        discoveryEnabled: true,
        executionEnabled: true,
        rootPath: "/workspace-2",
        workspaceId: "ws-2",
      },
    },
    {
      kind: "trust",
      next: {
        discoveryEnabled: true,
        executionEnabled: false,
        rootPath: "/workspace-1",
        workspaceId: "ws-1",
      },
    },
  ])("compensates a dispatched start immediately on $kind invalidation", async ({ next }) => {
    const start = deferred<StartNodePackageTaskResult>();
    const stop = deferred<void>();
    const harness = await renderHarness({ startResult: start.promise, stopResult: stop.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(40));
    await harness.rerender(next);
    expect(harness.stopNodePackageTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    await act(async () => start.resolve({ runId: "run-1" }));
    expect(harness.stopNodePackageTask).toHaveBeenCalledTimes(1);
    await act(async () => stop.resolve());
    if (next.workspaceId === "ws-1") expect(harness.current().task?.status).toBe("stopped");
    else expect(harness.current().task).toBeNull();
    harness.unmount();
  });

  it("compensates an accepted-but-response-lost start during unmount", async () => {
    const start = deferred<StartNodePackageTaskResult>();
    const harness = await renderHarness({ startResult: start.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(41));
    harness.unmount();
    expect(harness.stopNodePackageTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    await start.resolve({ runId: "run-1" });
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("compensates a mismatched start response without accepting its owner", async () => {
    const harness = await renderHarness({ startResult: Promise.resolve({ runId: "other" }) });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(44));
    expect(harness.stopNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    expect(harness.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("lost ownership") }),
    );
    expect(harness.current().task?.status).toBe("stopped");
    harness.unmount();
  });

  it("sends a stop-before-reserve tombstone while start is still unresolved", async () => {
    const start = deferred<StartNodePackageTaskResult>();
    const stop = deferred<void>();
    const harness = await renderHarness({ startResult: start.promise, stopResult: stop.promise });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(42));
    act(() => harness.current().stop());
    expect(harness.stopNodePackageTask).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "ws-1",
    });
    expect(harness.current().task?.status).toBe("stopping");
    await act(async () => start.resolve({ runId: "run-1" }));
    await act(async () => stop.resolve());
    expect(harness.current().task?.status).toBe("stopped");
    harness.unmount();
  });

  it("keeps a rejected stop retryable without regressing stopping to running", async () => {
    const firstStop = deferred<void>();
    const harness = await renderHarness({
      stopResults: [firstStop.promise, Promise.resolve()],
    });
    act(() => harness.current().run(SCRIPT));
    await act(async () => harness.deliverSession(43));
    act(() => harness.current().stop());
    await act(async () => firstStop.reject(new Error("stop failed")));
    expect(harness.current().task?.status).toBe("stopping");
    expect(harness.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "stop failed" }),
    );
    await act(async () => harness.current().stop());
    expect(harness.stopNodePackageTask).toHaveBeenCalledTimes(2);
    expect(harness.current().task?.status).toBe("stopped");
    harness.unmount();
  });
});

const SCRIPT: NodePackageScript = {
  key: "node-package-script:apps%2Fweb%2Fpackage.json:build%20prod%20%E2%9C%93",
  manifestRelativePath: "apps/web/package.json",
  packageName: "web",
  packageManager: "pnpm",
  packageRootRelativePath: "apps/web",
  scriptName: "build prod ✓",
};

interface HarnessOptions {
  readonly additionalSubscriptionReady?: Promise<void>;
  readonly acknowledgeResult?: Promise<void>;
  readonly discoveryEnabled?: boolean;
  readonly discoveryResult?: Promise<NodePackageScriptsResult>;
  readonly executionEnabled?: boolean;
  readonly onAcknowledge?: (listener: ((event: NodePackageTaskEvent) => void) | null) => void;
  readonly order?: string[];
  readonly startResult?: Promise<StartNodePackageTaskResult>;
  readonly stopResult?: Promise<void>;
  readonly stopResults?: Promise<void>[];
  readonly terminalSessionResult?: number | null;
}

async function renderHarness(options: HarnessOptions = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const startNodePackageTask = vi.fn(() => {
    options.order?.push("start");
    return options.startResult ?? Promise.resolve({ runId: "run-1" });
  });
  let stopIndex = 0;
  const stopNodePackageTask = vi.fn(
    () => options.stopResults?.[stopIndex++] ?? options.stopResult ?? Promise.resolve(),
  );
  let taskListener: ((event: NodePackageTaskEvent) => void) | null = null;
  const unsubscribeNodePackageTaskEvents = vi.fn(() => {
    taskListener = null;
  });
  const subscribeNodePackageTaskEvents = vi.fn(async (listener: typeof taskListener) => {
    options.order?.push("subscribe");
    taskListener = listener;
    return unsubscribeNodePackageTaskEvents;
  });
  const acknowledgeNodePackageTaskStart = vi.fn(() => {
    options.onAcknowledge?.(taskListener);
    return options.acknowledgeResult ?? Promise.resolve();
  });
  const listNodePackageScripts = vi.fn(
    () => options.discoveryResult ?? Promise.resolve(DISCOVERY_RESULT),
  );
  const discoveryGateway = { listNodePackageScripts };
  const runGateway = {
    startNodePackageTask,
    acknowledgeNodePackageTaskStart,
    stopNodePackageTask,
    subscribeNodePackageTaskEvents,
  };
  const reportError = vi.fn();
  let terminalConsumer: ((sessionId: number | null) => void) | null = null;
  const requestTerminalSession = vi.fn((consumer: (sessionId: number | null) => void) => {
    terminalConsumer = consumer;
    if (options.terminalSessionResult !== undefined) consumer(options.terminalSessionResult);
  });
  let current: ReturnType<typeof useNodePackageScriptWorkbench> | null = null;
  let props = {
    discoveryEnabled: options.discoveryEnabled ?? true,
    executionEnabled: options.executionEnabled ?? true,
    rootPath: "/workspace-1",
    workspaceId: "ws-1",
  };

  function Harness() {
    current = useNodePackageScriptWorkbench({
      additionalSubscriptionReadyRef: options.additionalSubscriptionReady
        ? { current: options.additionalSubscriptionReady }
        : undefined,
      createRunId: () => "run-1",
      discoveryGateway,
      discoveryEnabled: props.discoveryEnabled,
      discoveryVersion: 0,
      executionEnabled: props.executionEnabled,
      reportError,
      requestTerminalSession,
      rootPath: props.rootPath,
      runGateway,
      workspaceId: props.workspaceId,
    });
    return null;
  }

  await act(async () => root.render(<Harness />));
  return {
    current: () => {
      if (!current) throw new Error("Hook did not render.");
      return current;
    },
    deliverSession: (sessionId: number) => terminalConsumer?.(sessionId),
    emit: (value: NodePackageTaskEvent) => taskListener?.(value),
    listNodePackageScripts,
    reportError,
    requestTerminalSession,
    rerender: async (next: typeof props) => {
      props = next;
      await act(async () => root.render(<Harness />));
    },
    startNodePackageTask,
    subscribeNodePackageTaskEvents,
    acknowledgeNodePackageTaskStart,
    stopNodePackageTask,
    unsubscribeNodePackageTaskEvents,
    unmount: () => act(() => root.unmount()),
  };
}

const DISCOVERY_RESULT: NodePackageScriptsResult = {
  scripts: [SCRIPT],
  total: 1,
  truncated: false,
  visited: 1,
};

function event(
  overrides:
    | ({ readonly status: "running" | "stopped" } & Partial<NodePackageTaskEvent>)
    | ({
        readonly status: "exited";
        readonly exitCode: number | null;
      } & Partial<NodePackageTaskEvent>)
    | ({ readonly status: "failed"; readonly message: string } & Partial<NodePackageTaskEvent>),
): NodePackageTaskEvent {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    sessionId: 1,
    manifestRelativePath: SCRIPT.manifestRelativePath,
    scriptName: SCRIPT.scriptName,
    ...overrides,
  } as NodePackageTaskEvent;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
