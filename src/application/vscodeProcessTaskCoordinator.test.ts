import { describe, expect, it, vi } from "vitest";
import type {
  VscodeProcessTaskEvent,
  VscodeProcessTaskOwner,
  VscodeProcessTasksSnapshot,
} from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import { createVscodeProcessTaskCoordinator } from "./vscodeProcessTaskCoordinator";

const owner: VscodeProcessTaskOwner = Object.freeze({
  runId: "run-1",
  workspaceId: "workspace-1",
  sessionId: 5,
  label: "Build",
  configRevision: "revision-1",
});

describe("createVscodeProcessTaskCoordinator", () => {
  it("subscribes before start, acknowledges the exact owner, and reduces events", async () => {
    const calls: string[] = [];
    const harness = gatewayHarness({
      acknowledge: async () => void calls.push("ack"),
      start: async () => {
        calls.push("start");
        return owner;
      },
      subscribe: async (handler) => {
        calls.push("subscribe");
        harness.emit = handler;
        return () => calls.push("unsubscribe");
      },
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });

    await expect(coordinator.start({ activation: 1, owner })).resolves.toEqual({
      status: "started",
    });
    expect(calls).toEqual(["subscribe", "start", "ack"]);
    expect(harness.gateway.acknowledgeVscodeProcessTaskStart).toHaveBeenCalledExactlyOnceWith(
      owner,
    );
    harness.emit({ kind: "status", owner, sequence: 1, status: "running" });
    harness.emit(step(2, "Build", 1, 1));
    harness.emit(output(3, "built"));
    harness.emit({ kind: "status", owner, sequence: 4, status: "exited", exitCode: 0 });

    expect(coordinator.snapshot()).toMatchObject({
      running: false,
      stopping: false,
      task: {
        status: "exited",
        output: [
          { kind: "step", label: "Build", index: 1, total: 1 },
          { kind: "data", stream: "stdout", data: "built" },
        ],
      },
    });
    expect(calls).toEqual(["subscribe", "start", "ack", "unsubscribe"]);
  });

  it("waits for the exact owner terminal result without missing an early terminal event", async () => {
    const harness = gatewayHarness();
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });
    await coordinator.start({ activation: 1, owner });
    const waiting = coordinator.waitForTerminal(owner);
    harness.emit({ kind: "status", owner, sequence: 1, status: "exited", exitCode: 0 });

    await expect(waiting).resolves.toEqual({ status: "exited", exitCode: 0 });
    await expect(coordinator.waitForTerminal(owner)).resolves.toEqual({
      status: "exited",
      exitCode: 0,
    });
    await expect(coordinator.waitForTerminal({ ...owner, runId: "foreign" })).resolves.toEqual({
      status: "stale",
    });
  });

  it("accepts exact terminal completion flushed before acknowledgement returns", async () => {
    let emit: (event: VscodeProcessTaskEvent) => void = () => undefined;
    const harness = gatewayHarness({
      acknowledge: async () => {
        emit({ kind: "status", owner, sequence: 1, status: "running" });
        emit(step(2, "Build", 1, 1));
        emit(output(3, "fast output"));
        emit({ kind: "status", owner, sequence: 4, status: "exited", exitCode: 0 });
      },
      subscribe: async (handler) => {
        emit = handler;
        return () => undefined;
      },
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });

    await expect(coordinator.start({ activation: 1, owner })).resolves.toEqual({
      status: "started",
    });
    await expect(coordinator.waitForTerminal(owner)).resolves.toEqual({
      status: "exited",
      exitCode: 0,
    });
    expect(coordinator.snapshot().task).toMatchObject({
      currentStep: { label: "Build", index: 1, total: 1 },
      output: [
        { kind: "step", label: "Build", index: 1, total: 1 },
        { kind: "data", stream: "stdout", data: "fast output" },
      ],
    });
  });

  it("drops foreign, stale, and post-terminal events", async () => {
    const harness = gatewayHarness();
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });
    await coordinator.start({ activation: 1, owner });
    harness.emit({ kind: "status", owner, sequence: 1, status: "running" });
    harness.emit(step(2, "Build", 1, 1));
    harness.emit(output(3, "accepted"));
    harness.emit({ ...output(4, "foreign"), owner: { ...owner, sessionId: 6 } });
    harness.emit(output(3, "stale"));
    harness.emit({ kind: "status", owner, sequence: 5, status: "stopped" });
    harness.emit(output(6, "late"));

    expect(coordinator.snapshot().task?.output).toEqual([
      { kind: "step", label: "Build", index: 1, total: 1 },
      { kind: "data", stream: "stdout", data: "accepted" },
    ]);
  });

  it("cancels one exact owner once and keeps failed stop fail-closed", async () => {
    const harness = gatewayHarness({
      stop: vi.fn(async () => {
        throw new Error("stop failed");
      }),
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });
    await coordinator.start({ activation: 1, owner });

    await expect(coordinator.cancel()).resolves.toBe(false);
    await expect(coordinator.cancel()).resolves.toBe(false);
    expect(harness.gateway.stopVscodeProcessTask).toHaveBeenCalledExactlyOnceWith(owner);
    expect(coordinator.snapshot()).toMatchObject({ running: false, stopping: true });
    await expect(
      coordinator.start({ activation: 2, owner: { ...owner, runId: "run-2" } }),
    ).resolves.toEqual({ status: "rejected" });

    harness.emit({ kind: "status", owner, sequence: 1, status: "stopped" });
    expect(coordinator.snapshot()).toMatchObject({ running: false, stopping: false });
  });

  it("rejects cancellation from a foreign or stale owner without touching the active run", async () => {
    const harness = gatewayHarness();
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });
    await coordinator.start({ activation: 1, owner });

    await expect(coordinator.cancelExact({ ...owner, runId: "stale-run" })).resolves.toBe(false);

    expect(harness.gateway.stopVscodeProcessTask).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ owner, running: true, stopping: false });
  });

  it("invalidates A-B-A during subscribe/start/ack without publishing stale state", async () => {
    const start = deferred<VscodeProcessTaskOwner>();
    const harness = gatewayHarness({ start: () => start.promise });
    let activation = 1;
    const snapshots: unknown[] = [];
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: (candidate) => candidate === activation,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    const running = coordinator.start({ activation: 1, owner });
    await flush();
    activation = 2;
    const invalidated = coordinator.invalidate();
    start.resolve(owner);

    await expect(running).resolves.toEqual({ status: "stale" });
    await expect(invalidated).resolves.toBe(true);
    harness.emit(output(1, "late"));
    expect(coordinator.snapshot()).toEqual({
      activation: null,
      owner: null,
      task: null,
      running: false,
      stopping: false,
    });
    expect(snapshots.some((value) => JSON.stringify(value).includes("late"))).toBe(false);
  });

  it("tombstones an ambiguous start rejection with one exact stop", async () => {
    const harness = gatewayHarness({
      start: async () => {
        throw new Error("revision mismatch details");
      },
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });

    await expect(coordinator.start({ activation: 1, owner })).resolves.toEqual({
      status: "error",
    });
    expect(harness.gateway.acknowledgeVscodeProcessTaskStart).not.toHaveBeenCalled();
    expect(harness.gateway.stopVscodeProcessTask).toHaveBeenCalledExactlyOnceWith(owner);
    expect(coordinator.snapshot().owner).toBeNull();
  });

  it("immediately unlistens when a subscription resolves after A-B-A disposal", async () => {
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    const harness = gatewayHarness({ subscribe: () => subscription.promise });
    let activation = 1;
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: (candidate) => candidate === activation,
    });
    const starting = coordinator.start({ activation: 1, owner });
    await flush();

    activation = 2;
    await expect(coordinator.invalidate()).resolves.toBe(true);
    subscription.resolve(unlisten);

    await expect(starting).resolves.toEqual({ status: "stale" });
    expect(unlisten).toHaveBeenCalledOnce();
    expect(harness.gateway.startVscodeProcessTask).not.toHaveBeenCalled();
  });

  it("fails closed before start when subscription fails", async () => {
    const harness = gatewayHarness({
      subscribe: async () => {
        throw new Error("listen failed");
      },
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });

    await expect(coordinator.start({ activation: 1, owner })).resolves.toEqual({
      status: "error",
    });
    expect(harness.gateway.startVscodeProcessTask).not.toHaveBeenCalled();
    expect(harness.gateway.acknowledgeVscodeProcessTaskStart).not.toHaveBeenCalled();
  });

  it("stops the exact owner once when acknowledgement fails", async () => {
    const harness = gatewayHarness({
      acknowledge: async () => {
        throw new Error("ack failed");
      },
    });
    const coordinator = createVscodeProcessTaskCoordinator({
      getGateway: () => harness.gateway,
      isCurrent: () => true,
    });

    await expect(coordinator.start({ activation: 1, owner })).resolves.toEqual({
      status: "error",
    });
    await flush();
    expect(harness.gateway.stopVscodeProcessTask).toHaveBeenCalledExactlyOnceWith(owner);
  });
});

function gatewayHarness(
  overrides: {
    acknowledge?: VscodeProcessTasksGateway["acknowledgeVscodeProcessTaskStart"];
    start?: VscodeProcessTasksGateway["startVscodeProcessTask"];
    stop?: VscodeProcessTasksGateway["stopVscodeProcessTask"];
    subscribe?: VscodeProcessTasksGateway["subscribeVscodeProcessTaskEvents"];
  } = {},
) {
  let emit: (event: VscodeProcessTaskEvent) => void = () => undefined;
  const gateway: VscodeProcessTasksGateway = {
    discoverVscodeProcessTasks: async () => emptySnapshot(),
    startVscodeProcessTask: vi.fn(overrides.start ?? (async (candidate) => candidate)),
    acknowledgeVscodeProcessTaskStart: vi.fn(overrides.acknowledge ?? (async () => undefined)),
    stopVscodeProcessTask: vi.fn(overrides.stop ?? (async () => undefined)),
    subscribeVscodeProcessTaskEvents: vi.fn(
      overrides.subscribe ??
        (async (handler) => {
          emit = handler;
          return () => undefined;
        }),
    ),
  };
  return {
    gateway,
    get emit() {
      return emit;
    },
    set emit(handler: (event: VscodeProcessTaskEvent) => void) {
      emit = handler;
    },
  };
}

function output(sequence: number, data: string): VscodeProcessTaskEvent {
  return { kind: "output", owner, sequence, stream: "stdout", data, truncated: false };
}

function step(
  sequence: number,
  label: string,
  index: number,
  total: number,
): VscodeProcessTaskEvent {
  return { kind: "step", owner, sequence, label, index, total };
}

function emptySnapshot(): VscodeProcessTasksSnapshot {
  return Object.freeze({
    configRevision: "revision-1",
    tasks: Object.freeze([]),
    diagnostics: Object.freeze([]),
    truncated: false,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
