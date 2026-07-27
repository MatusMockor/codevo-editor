// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  VscodeProcessTaskEvent,
  VscodeProcessTaskOwner,
  VscodeProcessTasksSnapshot,
} from "../domain/vscodeProcessTasks";
import { vscodeProcessTaskOutputStreamTail } from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  nextVscodeProcessTaskRunId,
  useVscodeProcessTasks,
  type UseVscodeProcessTasksOptions,
  type VscodeProcessTasksState,
} from "./useVscodeProcessTasks";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";

describe("useVscodeProcessTasks", () => {
  it("starts duplicate labels by exact package identity and uses the selected file revision", async () => {
    const gateway = gatewayHarness({
      discover: async () =>
        snapshot("aggregate-revision", [
          task(".", "Build", "root-revision"),
          task("packages/api", "Build", "api-revision"),
        ]),
    });
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));

    await act(async () =>
      expect(await harness.hook().start({ package: "packages/api", label: "Build" })).toBe(true),
    );

    expect(gateway.start).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-a",
      sessionId: 1,
      label: '["v1","packages/api","Build"]',
      configRevision: "api-revision",
    });
    harness.unmount();
  });

  it("discovers display-only tasks and runs one executable label through the exact lifecycle", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    expect(Object.isFrozen(harness.hook())).toBe(true);
    expect(Object.isFrozen(harness.hook().tasks)).toBe(true);
    expect(Object.isFrozen(harness.hook().diagnostics)).toBe(true);

    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const owner = gateway.start.mock.calls[0]?.[0];
    expect(owner).toEqual({
      runId: "run-1",
      workspaceId: "workspace-a",
      sessionId: 1,
      label: '["v1",".","Build"]',
      configRevision: "revision-1",
    });
    expect(owner).not.toHaveProperty("command");
    expect(owner).not.toHaveProperty("args");
    expect(owner).not.toHaveProperty("env");
    expect(gateway.calls).toEqual(["subscribe", "start", "ack"]);
    expect(harness.hook().running).toBe(true);

    act(() => gateway.emit({ kind: "status", owner: owner!, sequence: 1, status: "running" }));
    act(() =>
      gateway.emit({
        kind: "step",
        owner: owner!,
        sequence: 2,
        label: "Build",
        index: 1,
        total: 1,
      }),
    );
    act(() => gateway.emit(output(owner!, 3, "compiled")));
    await waitForReact(() =>
      expect(harness.hook().currentStep).toEqual({ label: "Build", index: 1, total: 1 }),
    );
    expect(harness.hook().output.truncated).toBe(false);
    expect(vscodeProcessTaskOutputStreamTail(harness.hook().output.stdout).text).toBe(
      "\n--- Step 1 of 1: Build ---\ncompiled",
    );
    expect(vscodeProcessTaskOutputStreamTail(harness.hook().output.stderr).text).toBe(
      "\n--- Step 1 of 1: Build ---\n",
    );
    act(() =>
      gateway.emit({
        kind: "status",
        owner: owner!,
        sequence: 4,
        status: "exited",
        exitCode: 0,
      }),
    );
    expect(harness.hook()).toMatchObject({ running: false, status: "exited", stopping: false });
    harness.unmount();
  });

  it("offers an owner-bound start-and-wait seam over the same visible task lifecycle", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    let waiting!: Promise<unknown>;
    act(() => {
      waiting = harness.hook().startAndWait(rootTask("Build"));
    });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledOnce());
    const owner = gateway.start.mock.calls[0]![0];
    await waitForReact(() => expect(harness.hook().running).toBe(true));
    act(() => gateway.emit({ kind: "status", owner, sequence: 1, status: "exited", exitCode: 0 }));

    await expect(waiting).resolves.toEqual({ status: "exited", exitCode: 0 });
    expect(harness.hook()).toMatchObject({ running: false, status: "exited" });
    harness.unmount();
  });

  it("owns Problems by the exact configured-task run and clears them across A-B-A", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const owner = gateway.start.mock.calls[0]![0];
    const problem = {
      filePath: `${ROOT_A}/src/main.ts`,
      lineNumber: 2,
      column: 4,
      severity: "error" as const,
      message: "Type mismatch",
      code: "TS2322",
      source: "TypeScript" as const,
    };

    act(() => gateway.emit({ kind: "problems", owner, sequence: 1, state: "reset" }));
    act(() =>
      gateway.emit({
        kind: "problems",
        owner,
        sequence: 2,
        state: "append",
        problems: [problem],
        total: 1,
        truncated: false,
      }),
    );
    await waitForReact(() => expect(harness.hook().problemNotices).toHaveLength(1));
    expect(harness.hook().problemNotices[0]?.groupKey).toContain(
      "node-package-task-problems:workspace-a:run-1:",
    );

    act(() =>
      gateway.emit({
        kind: "problems",
        owner: { ...owner, configRevision: `sha256:${"f".repeat(64)}` },
        sequence: 3,
        state: "clear",
      }),
    );
    act(() => gateway.emit({ kind: "problems", owner, sequence: 2, state: "clear" }));
    expect(harness.hook().problemNotices).toHaveLength(1);

    act(() =>
      gateway.emit({
        kind: "problems",
        owner,
        sequence: 3,
        state: "complete",
        problems: [problem],
        total: 1,
        truncated: false,
      }),
    );
    act(() => gateway.emit({ kind: "status", owner, sequence: 4, status: "exited", exitCode: 0 }));
    expect(harness.hook().problems).toMatchObject({ complete: true, total: 1 });
    expect(harness.hook().problemNotices).toHaveLength(1);

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    expect(harness.hook().problems).toBeNull();
    expect(harness.hook().problemNotices).toEqual([]);
    harness.unmount();
  });

  it("exposes an opaque cancellation capability that cannot retarget a later same-label run", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    let oldOwnership: { readonly cancel: () => Promise<boolean> } | undefined;
    let firstWaiting!: Promise<unknown>;
    act(() => {
      firstWaiting = harness.hook().startAndWait(rootTask("Build"), (ownership) => {
        oldOwnership = ownership;
      });
    });
    await waitForReact(() => expect(oldOwnership).toBeDefined());
    const firstOwner = gateway.start.mock.calls[0]![0];
    act(() =>
      gateway.emit({
        kind: "status",
        owner: firstOwner,
        sequence: 1,
        status: "exited",
        exitCode: 0,
      }),
    );
    await firstWaiting;

    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    expect(gateway.start.mock.calls[1]![0]).toMatchObject({
      label: '["v1",".","Build"]',
      runId: "run-2",
    });
    await expect(oldOwnership!.cancel()).resolves.toBe(false);
    expect(gateway.stop).not.toHaveBeenCalled();
    expect(harness.hook().running).toBe(true);
    harness.unmount();
  });

  it("refreshes discovery before an owner-bound start-and-wait admission", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    expect(gateway.discover).toHaveBeenCalledTimes(1);

    let waiting!: Promise<unknown>;
    act(() => {
      waiting = harness.hook().startAndWait(rootTask("Build"));
    });
    await waitForReact(() => expect(gateway.discover).toHaveBeenCalledTimes(2));
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledOnce());
    const owner = gateway.start.mock.calls[0]![0];
    act(() => gateway.emit({ kind: "status", owner, sequence: 1, status: "exited", exitCode: 0 }));

    await expect(waiting).resolves.toEqual({ status: "exited", exitCode: 0 });
    harness.unmount();
  });

  it("rejects non-executable and unknown labels before creating an owner", async () => {
    const gateway = gatewayHarness();
    const createRunId = vi.fn(() => "run-1");
    const harness = renderHook({ createRunId, gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));

    await expect(harness.hook().start(rootTask("Shell"))).resolves.toBe(false);
    await expect(harness.hook().start(rootTask("Missing"))).resolves.toBe(false);
    expect(createRunId).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("surfaces start rejection as a generic refresh-and-retry error", async () => {
    const gateway = gatewayHarness({
      start: async () => {
        throw new Error("secret backend revision mismatch details");
      },
    });
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));

    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(false));
    expect(harness.hook().error).toBe("Unable to start configured task. Refresh and try again.");
    expect(harness.hook().error).not.toContain("secret");
    harness.unmount();
  });

  it("invalidates exact A-B-A ownership and never publishes old events", async () => {
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const oldOwner = gateway.start.mock.calls[0]![0];
    const oldEmit = gateway.emit;

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(gateway.stop).toHaveBeenCalledExactlyOnceWith(oldOwner));
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    act(() => oldEmit(output(oldOwner, 1, "late")));
    expect(harness.hook().output).toMatchObject({
      stdout: { codeUnits: 0 },
      stderr: { codeUnits: 0 },
      truncated: false,
    });

    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    expect(gateway.start.mock.calls[1]?.[0]).toMatchObject({
      runId: "run-2",
      workspaceId: "workspace-a",
    });
    harness.unmount();
  });

  it("rejects an old discovery result after workspace A-B-A", async () => {
    const oldDiscovery = deferred<VscodeProcessTasksSnapshot>();
    const gateway = gatewayHarness({
      discover: vi
        .fn<VscodeProcessTasksGateway["discoverVscodeProcessTasks"]>()
        .mockReturnValueOnce(oldDiscovery.promise)
        .mockResolvedValue(snapshot("fresh-revision")),
    });
    const harness = renderHook({ gateway: gateway.gateway });

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().configRevision).toBe("fresh-revision"));
    await act(async () => oldDiscovery.resolve(snapshot("stale-revision")));

    expect(harness.hook().configRevision).toBe("fresh-revision");
    harness.unmount();
  });

  it("invalidates on configuration version, gateway, trust, and unmount", async () => {
    const first = gatewayHarness();
    const second = gatewayHarness({ revision: "revision-2" });
    const harness = renderHook({ gateway: first.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const firstOwner = first.start.mock.calls[0]![0];

    harness.set({ configurationVersion: 1, gateway: second.gateway });
    await waitForReact(() => expect(first.stop).toHaveBeenCalledExactlyOnceWith(firstOwner));
    await waitForReact(() => expect(harness.hook().configRevision).toBe("revision-2"));
    expect(second.discover).toHaveBeenCalledWith("workspace-a");

    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const secondOwner = second.start.mock.calls[0]![0];
    harness.set({ workspaceTrusted: false });
    await waitForReact(() => expect(second.stop).toHaveBeenCalledExactlyOnceWith(secondOwner));
    expect(harness.hook()).toMatchObject({
      running: false,
      tasks: [],
      unavailable: "Trust this workspace to run configured tasks.",
    });

    harness.set({ workspaceTrusted: true });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));
    const unmountOwner = second.start.mock.calls[1]![0];
    harness.unmount();
    await vi.waitFor(() => expect(second.stop).toHaveBeenCalledWith(unmountOwner));
  });

  it("keeps exact stop idempotent while the backend stop is pending", async () => {
    const stopping = deferred<void>();
    const gateway = gatewayHarness({ stop: () => stopping.promise });
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = harness.hook().stop();
      second = harness.hook().stop();
    });
    expect(harness.hook().stopping).toBe(true);
    expect(gateway.stop).toHaveBeenCalledTimes(1);
    await act(async () => stopping.resolve());
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(harness.hook().running).toBe(false);
    harness.unmount();
  });

  it("exposes an old activation stop failure as a global privacy-filtered blocker", async () => {
    const gateway = gatewayHarness({
      stop: async () => {
        throw new Error("stop failed");
      },
    });
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await harness.hook().start(rootTask("Build"))).toBe(true));

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().stopping).toBe(true));
    expect(harness.hook()).toMatchObject({
      activeLabel: null,
      occupied: true,
      output: {
        stdout: { codeUnits: 0 },
        stderr: { codeUnits: 0 },
        truncated: false,
      },
      running: false,
      status: null,
    });
    await expect(harness.hook().start(rootTask("Build"))).resolves.toBe(false);
    expect(gateway.start).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("unlistens a subscription that resolves after unmount", async () => {
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    const gateway = gatewayHarness({ subscribe: () => subscription.promise });
    const harness = renderHook({ gateway: gateway.gateway });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    let starting!: Promise<boolean>;
    act(() => {
      starting = harness.hook().start(rootTask("Build"));
    });
    await vi.waitFor(() =>
      expect(gateway.gateway.subscribeVscodeProcessTaskEvents).toHaveBeenCalledOnce(),
    );

    harness.unmount();
    subscription.resolve(unlisten);

    await expect(starting).resolves.toBe(false);
    expect(unlisten).toHaveBeenCalledOnce();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it("fences pending terminal session requests across A-B-A, unmount, and null", async () => {
    const terminal = deferred<number | null>();
    const requestTerminalSession = vi.fn(() => terminal.promise);
    const gateway = gatewayHarness();
    const harness = renderHook({ gateway: gateway.gateway, requestTerminalSession });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    let starting!: Promise<boolean>;
    act(() => {
      starting = harness.hook().start(rootTask("Build"));
    });
    expect(harness.hook()).toMatchObject({
      activeLabel: "Build",
      occupied: true,
      running: true,
      status: "pending",
    });

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    terminal.resolve(7);
    await expect(starting).resolves.toBe(false);
    expect(gateway.start).not.toHaveBeenCalled();
    harness.unmount();

    const nullHarness = renderHook({
      gateway: gateway.gateway,
      requestTerminalSession: async () => null,
    });
    await waitForReact(() => expect(nullHarness.hook().tasks).toHaveLength(2));
    await act(async () => expect(await nullHarness.hook().start(rootTask("Build"))).toBe(false));
    expect(nullHarness.hook().error).toBe(
      "Unable to start configured task. Refresh and try again.",
    );
    nullHarness.unmount();

    const unmountTerminal = deferred<number | null>();
    const unmountHarness = renderHook({
      gateway: gateway.gateway,
      requestTerminalSession: () => unmountTerminal.promise,
    });
    await waitForReact(() => expect(unmountHarness.hook().tasks).toHaveLength(2));
    const unmountedStart = unmountHarness.hook().start(rootTask("Build"));
    unmountHarness.unmount();
    unmountTerminal.resolve(8);
    await expect(unmountedStart).resolves.toBe(false);
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it("cancels a pending terminal admission locally and fences its late result", async () => {
    const terminal = deferred<number | null>();
    const gateway = gatewayHarness();
    const harness = renderHook({
      gateway: gateway.gateway,
      requestTerminalSession: () => terminal.promise,
    });
    await waitForReact(() => expect(harness.hook().tasks).toHaveLength(2));
    let starting!: Promise<boolean>;
    act(() => {
      starting = harness.hook().start(rootTask("Build"));
    });
    expect(harness.hook()).toMatchObject({
      activeLabel: "Build",
      occupied: true,
      running: true,
      status: "pending",
    });

    await act(async () => expect(await harness.hook().stop()).toBe(true));
    expect(harness.hook()).toMatchObject({
      activeLabel: null,
      occupied: false,
      running: false,
      status: null,
    });
    expect(gateway.stop).not.toHaveBeenCalled();

    terminal.resolve(null);
    await expect(starting).resolves.toBe(false);
    expect(harness.hook().error).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();
    expect(gateway.gateway.subscribeVscodeProcessTaskEvents).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("fails closed when run id creation is exhausted or throws", async () => {
    const gateway = gatewayHarness();
    const exhausted = renderHook({
      createRunId: () => null,
      gateway: gateway.gateway,
    });
    await waitForReact(() => expect(exhausted.hook().tasks).toHaveLength(2));

    await act(async () => expect(await exhausted.hook().start(rootTask("Build"))).toBe(false));
    expect(exhausted.hook().error).toBe("Unable to start configured task. Refresh and try again.");
    expect(gateway.gateway.subscribeVscodeProcessTaskEvents).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    exhausted.unmount();

    const throwing = renderHook({
      createRunId: () => {
        throw new Error("sequence unavailable");
      },
      gateway: gateway.gateway,
    });
    await waitForReact(() => expect(throwing.hook().tasks).toHaveLength(2));
    await act(async () => expect(await throwing.hook().start(rootTask("Build"))).toBe(false));
    expect(throwing.hook().error).toBe("Unable to start configured task. Refresh and try again.");
    expect(gateway.start).not.toHaveBeenCalled();
    throwing.unmount();
  });
});

interface HookProps extends UseVscodeProcessTasksOptions {
  readonly createRunId: () => string | null;
}

describe("nextVscodeProcessTaskRunId", () => {
  it("uses the final safe integer once and then fails closed without wrapping", () => {
    expect(nextVscodeProcessTaskRunId(Number.MAX_SAFE_INTEGER - 1)).toEqual({
      runId: `vscode-task-${Number.MAX_SAFE_INTEGER}`,
      sequence: Number.MAX_SAFE_INTEGER,
    });
    expect(nextVscodeProcessTaskRunId(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(nextVscodeProcessTaskRunId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(nextVscodeProcessTaskRunId(-1)).toBeNull();
    expect(nextVscodeProcessTaskRunId(0.5)).toBeNull();
  });
});

function renderHook(overrides: Partial<HookProps> & Pick<HookProps, "gateway">) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let runSequence = 0;
  let sessionSequence = 0;
  let props: HookProps = {
    configurationVersion: 0,
    createRunId: () => `run-${++runSequence}`,
    requestTerminalSession: async () => ++sessionSequence,
    rootPath: ROOT_A,
    workspaceId: "workspace-a",
    workspaceTrusted: true,
    ...overrides,
  };
  let current: VscodeProcessTasksState | null = null;
  function Harness() {
    current = useVscodeProcessTasks(props);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    hook() {
      if (!current) throw new Error("Hook is not mounted.");
      return current;
    },
    set(next: Partial<HookProps>) {
      props = { ...props, ...next };
      act(() => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
  };
}

function gatewayHarness(
  options: {
    readonly discover?: VscodeProcessTasksGateway["discoverVscodeProcessTasks"];
    readonly revision?: string;
    readonly start?: VscodeProcessTasksGateway["startVscodeProcessTask"];
    readonly stop?: VscodeProcessTasksGateway["stopVscodeProcessTask"];
    readonly subscribe?: VscodeProcessTasksGateway["subscribeVscodeProcessTaskEvents"];
  } = {},
) {
  const calls: string[] = [];
  let emit: (event: VscodeProcessTaskEvent) => void = () => undefined;
  const discover = vi.fn(
    options.discover ?? (async () => snapshot(options.revision ?? "revision-1")),
  );
  const start = vi.fn(
    options.start ??
      (async (owner: VscodeProcessTaskOwner) => {
        calls.push("start");
        return owner;
      }),
  );
  if (options.start) {
    start.mockImplementation(async (owner) => {
      calls.push("start");
      return options.start!(owner);
    });
  }
  const stop = vi.fn(options.stop ?? (async () => undefined));
  const gateway: VscodeProcessTasksGateway = {
    discoverVscodeProcessTasks: discover,
    startVscodeProcessTask: start,
    acknowledgeVscodeProcessTaskStart: vi.fn(async () => {
      calls.push("ack");
    }),
    stopVscodeProcessTask: stop,
    subscribeVscodeProcessTaskEvents: vi.fn(
      options.subscribe ??
        (async (handler) => {
          calls.push("subscribe");
          emit = handler;
          return () => undefined;
        }),
    ),
  };
  return {
    calls,
    discover,
    gateway,
    get emit() {
      return emit;
    },
    start,
    stop,
  };
}

function snapshot(
  configRevision: string,
  tasks: VscodeProcessTasksSnapshot["tasks"] = [
    task(".", "Build", configRevision),
    Object.freeze({
      ...task(".", "Shell", configRevision),
      detail: null,
      group: "none" as const,
      executable: false,
      problemMatcher: null,
    }),
  ],
): VscodeProcessTasksSnapshot {
  return Object.freeze({
    configRevision,
    tasks: Object.freeze(tasks),
    diagnostics: Object.freeze([]),
    truncated: false,
  });
}

function task(packagePath: string, label: string, configRevision: string) {
  return Object.freeze({
    package: packagePath,
    label,
    configRevision,
    detail: "Compile",
    group: "build" as const,
    source: packagePath === "." ? ".vscode/tasks.json" : `${packagePath}/.vscode/tasks.json`,
    executable: true,
    dependsOn: Object.freeze([]),
    problemMatcher: "typescript" as const,
  });
}

function rootTask(label: string) {
  return Object.freeze({ package: ".", label });
}

function output(
  owner: VscodeProcessTaskOwner,
  sequence: number,
  data: string,
): VscodeProcessTaskEvent {
  return { kind: "output", owner, sequence, stream: "stdout", data, truncated: false };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
