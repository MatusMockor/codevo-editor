import { describe, expect, it, vi } from "vitest";
import type { NodeDebugPreLaunchTask } from "../domain/nodeDebugPreLaunchTask";
import type { VscodeProcessTaskCompletion } from "./vscodeProcessTaskCoordinator";
import {
  createNodeDebugPreLaunchTaskCoordinator,
  type NodeDebugPreLaunchTaskExecution,
} from "./nodeDebugPreLaunchTaskCoordinator";

const TASK: NodeDebugPreLaunchTask = Object.freeze({ label: "Build app" });
const REQUEST = Object.freeze({
  task: TASK,
  workspaceEpoch: 1,
  workspaceId: "workspace-a",
});

describe("createNodeDebugPreLaunchTaskCoordinator", () => {
  it("delegates the exact label to shared Tasks state and starts debug only after exit 0", async () => {
    const task = deferred<VscodeProcessTaskCompletion | null>();
    const execution = executionHarness(() => task.promise);
    const debugStart = vi.fn(async () => true);
    const coordinator = createCoordinator(execution);
    const running = coordinator.run(REQUEST, debugStart);

    expect(execution.startAndWait).toHaveBeenCalledOnce();
    expect(execution.startAndWait.mock.calls[0]?.[0]).toBe("Build app");
    expect(debugStart).not.toHaveBeenCalled();
    expect(coordinator.occupied()).toBe(true);
    task.resolve({ status: "exited", exitCode: 0 });

    await expect(running).resolves.toEqual({ status: "started" });
    expect(debugStart).toHaveBeenCalledOnce();
    expect(coordinator.occupied()).toBe(false);
  });

  it.each([
    ["non-zero exit", { status: "exited", exitCode: 2 }],
    ["unknown exit", { status: "exited", exitCode: null }],
    ["failure", { status: "failed" }],
    ["stop", { status: "stopped" }],
  ] as const)("fails closed on task %s", async (_name, completion) => {
    const execution = executionHarness(async () => completion);
    const debugStart = vi.fn(async () => true);

    await expect(createCoordinator(execution).run(REQUEST, debugStart)).resolves.toEqual({
      status: "task-failed",
    });
    expect(debugStart).not.toHaveBeenCalled();
  });

  it("maps an unavailable shared-task admission and thrown transport to a generic outcome", async () => {
    const debugStart = vi.fn(async () => true);
    await expect(
      createCoordinator(executionHarness(async () => null)).run(REQUEST, debugStart),
    ).resolves.toEqual({ status: "task-unavailable" });
    await expect(
      createCoordinator(
        executionHarness(async () => {
          throw new Error("private transport detail");
        }),
      ).run(REQUEST, debugStart),
    ).resolves.toEqual({ status: "task-unavailable" });
    expect(debugStart).not.toHaveBeenCalled();
  });

  it("runs directly for prepared metadata without preLaunchTask", async () => {
    const execution = executionHarness();
    const debugStart = vi.fn(async () => true);

    await expect(
      createCoordinator(execution).run({ ...REQUEST, task: null }, debugStart),
    ).resolves.toEqual({ status: "started" });
    expect(execution.startAndWait).not.toHaveBeenCalled();
  });

  it("serializes the full barrier including direct debug start", async () => {
    const debug = deferred<boolean>();
    const coordinator = createCoordinator(executionHarness());
    const first = coordinator.run({ ...REQUEST, task: null }, () => debug.promise);

    expect(coordinator.occupied()).toBe(true);
    await expect(coordinator.run({ ...REQUEST, task: null }, async () => true)).resolves.toEqual({
      status: "busy",
    });
    debug.resolve(true);
    await expect(first).resolves.toEqual({ status: "started" });
  });

  it("cancels the shared exact task once and settles even if its wait never returns", async () => {
    const execution = executionHarness(() => new Promise(() => undefined));
    execution.cancel.mockRejectedValueOnce(new Error("stop failed"));
    const debugStart = vi.fn(async () => true);
    const coordinator = createCoordinator(execution);
    const running = coordinator.run(REQUEST, debugStart);

    await expect(coordinator.cancel()).resolves.toBe(false);
    await expect(running).resolves.toEqual({ status: "cancelled" });
    expect(execution.cancel).toHaveBeenCalledOnce();
    expect(debugStart).not.toHaveBeenCalled();
  });

  it("invalidates A-B-A ownership before debug admission", async () => {
    const task = deferred<VscodeProcessTaskCompletion | null>();
    const execution = executionHarness(() => task.promise);
    let epoch = 1;
    const debugStart = vi.fn(async () => true);
    const coordinator = createCoordinator(execution, (candidate) => candidate === epoch);
    const running = coordinator.run(REQUEST, debugStart);
    epoch = 2;
    task.resolve({ status: "exited", exitCode: 0 });

    await expect(running).resolves.toEqual({ status: "stale" });
    expect(debugStart).not.toHaveBeenCalled();
  });

  it("makes invalidate the explicit workspace/trust lifecycle cancellation seam", async () => {
    const execution = executionHarness(() => new Promise(() => undefined));
    const coordinator = createCoordinator(execution);
    const running = coordinator.run(REQUEST, async () => true);

    await expect(coordinator.invalidate()).resolves.toBe(true);
    await expect(running).resolves.toEqual({ status: "cancelled" });
    expect(execution.cancel).toHaveBeenCalledOnce();
  });

  it("fences cancellation won just before an exit-zero continuation", async () => {
    const task = deferred<VscodeProcessTaskCompletion | null>();
    const execution = executionHarness(() => task.promise);
    const debugStart = vi.fn(async () => true);
    const coordinator = createCoordinator(execution);
    const running = coordinator.run(REQUEST, debugStart);
    const cancellation = coordinator.cancel();
    task.resolve({ status: "exited", exitCode: 0 });

    await cancellation;
    await expect(running).resolves.toEqual({ status: "cancelled" });
    expect(debugStart).not.toHaveBeenCalled();
  });

  it("does not leak command payloads into the pre-launch execution seam", async () => {
    const execution = executionHarness(async () => ({ status: "exited", exitCode: 0 }));
    await createCoordinator(execution).run(REQUEST, async () => true);

    expect(execution.startAndWait.mock.calls[0]?.[0]).toBe("Build app");
    expect(JSON.stringify(execution.startAndWait.mock.calls[0])).not.toMatch(
      /command|args|cwd|env/,
    );
  });
});

function createCoordinator(
  execution: NodeDebugPreLaunchTaskExecution,
  isWorkspaceCurrent: (epoch: number, workspaceId: string) => boolean = (epoch, workspaceId) =>
    epoch === 1 && workspaceId === "workspace-a",
) {
  return createNodeDebugPreLaunchTaskCoordinator({ execution, isWorkspaceCurrent });
}

function executionHarness(
  startAndWait: (label: string) => Promise<VscodeProcessTaskCompletion | null> = async () => ({
    status: "exited",
    exitCode: 0,
  }),
) {
  const cancel = vi.fn(async () => true);
  return {
    cancel,
    startAndWait: vi.fn(
      async (label: string, onOwned?: (ownership: { cancel(): Promise<boolean> }) => void) => {
        onOwned?.(Object.freeze({ cancel }));
        return startAndWait(label);
      },
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
