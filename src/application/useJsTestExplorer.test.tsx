// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { JsTestGateway, JsTestRunScope } from "../domain/jsTestRunScope";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type { TestRunResponse } from "../domain/testResults";
import type { JsTestTaskGateway } from "../domain/jsTestTask";
import type { JsTestWatchCommand, JsTestWatchGateway } from "../domain/jsTestCommand";
import { waitForReact } from "../test/reactTestLifecycle";
import { useJsTestExplorer, type JsTestExplorerState } from "./useJsTestExplorer";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const TEST_SOURCE = `describe("suite", () => {
  test("works", () => {});
});`;

describe("useJsTestExplorer", () => {
  it("exposes a truthful runnable-scope gate and reuses the Explorer run lifecycle", async () => {
    const run = vi.fn<JsTestGateway["run"]>().mockResolvedValue(ok([]));
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    const scope = { kind: "file", relativeFilePath: "a.test.ts" } as const;

    expect(harness.hook().canRunScope(scope)).toBe(true);
    await act(async () => expect(await harness.hook().runScope(scope)).toBe(true));
    expect(run).toHaveBeenCalledExactlyOnceWith(ROOT_A, scope);

    harness.set({ workspaceTrusted: false });
    expect(harness.hook().canRunScope(scope)).toBe(false);
    await act(async () => expect(await harness.hook().runScope(scope)).toBe(false));
    expect(run).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("uses the owner-bound task path for ordinary runs and publishes its frozen output", async () => {
    const legacyRun = vi.fn<JsTestGateway["run"]>(async () => ok([]));
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(async (request) =>
      taskEnvelope(request.runId, ok([]), {
        stderr: { text: "warning", truncated: false },
        stdout: { text: "test log", truncated: true },
      }),
    );
    const harness = renderExplorer({
      runGateway: { run: legacyRun },
      taskGateway: { runTask, stopTask: async () => true },
    });

    await act(async () => harness.hook().run({ kind: "all" }));

    expect(legacyRun).not.toHaveBeenCalled();
    expect(runTask).toHaveBeenCalledExactlyOnceWith({
      runId: "task-1",
      scope: { kind: "all" },
      workspaceId: "workspace-a",
    });
    expect(harness.hook().outputSnapshot).toMatchObject({
      generation: 1,
      output: {
        stderr: { text: "warning", truncated: false },
        stdout: { text: "test log", truncated: true },
      },
      owner: { rootPath: ROOT_A, workspaceId: "workspace-a" },
    });
    expect(Object.isFrozen(harness.hook().outputSnapshot)).toBe(true);
    harness.unmount();
  });

  it("runs Continuous Run through the existing task/output lifecycle and remains armed", async () => {
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(async (request) =>
      taskEnvelope(request.runId, ok([]), taskOutput("continuous output", "")),
    );
    const harness = renderExplorer({
      taskGateway: { runTask, stopTask: async () => true },
    });

    expect(harness.hook().canStartContinuousRun()).toBe(true);
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    expect(harness.hook()).toMatchObject({
      continuousRunEnabled: true,
      continuousRunPending: true,
    });
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(1));
    await waitForReact(() =>
      expect(harness.hook()).toMatchObject({
        continuousRunEnabled: true,
        continuousRunPending: false,
        continuousRunRunning: false,
      }),
    );

    expect(runTask).toHaveBeenCalledExactlyOnceWith({
      runId: "task-1",
      scope: { kind: "all" },
      workspaceId: "workspace-a",
    });
    expect(harness.hook().outputSnapshot?.output.stdout.text).toBe("continuous output");
    expect(harness.hook().canRunScope({ kind: "file", relativeFilePath: "a.test.ts" })).toBe(false);
    expect(harness.hook().canRerunLastRun()).toBe(false);
    await act(async () => harness.hook().run({ kind: "all" }));
    await act(async () => expect(await harness.hook().rerunLastRun()).toBe(false));
    harness.set({ runRequestVersion: 1 });
    await act(async () => Promise.resolve());
    expect(runTask).toHaveBeenCalledTimes(1);
    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    expect(harness.hook().continuousRunEnabled).toBe(false);
    harness.unmount();
  });

  it("debounces and coalesces Continuous Run version bursts", async () => {
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(async (request) =>
      taskEnvelope(request.runId, ok([])),
    );
    const harness = renderExplorer({
      taskGateway: { runTask, stopTask: async () => true },
    });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(false));

    harness.set({ continuousRunVersion: 1 });
    harness.set({ continuousRunVersion: 2 });
    harness.set({ continuousRunVersion: 3 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 240)));
    expect(runTask).toHaveBeenCalledTimes(1);
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(2));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(false));
    expect(runTask.mock.calls[1]?.[0]).toMatchObject({
      runId: "task-2",
      scope: { kind: "all" },
      workspaceId: "workspace-a",
    });

    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    harness.unmount();
  });

  it("uses one native watch lease and stops its exact owner", async () => {
    const startWatch = vi.fn<JsTestWatchGateway["startWatch"]>(async (request) => ({
      owner: {
        epoch: request.epoch,
        watchId: request.watchId,
        workspaceId: request.workspaceId,
      },
      structuredResults: "unavailable-in-watch-mode",
    }));
    const acknowledgeWatchStart = vi.fn<JsTestWatchGateway["acknowledgeWatchStart"]>(
      async () => undefined,
    );
    const stopWatch = vi.fn<JsTestWatchGateway["stopWatch"]>(async () => undefined);
    const watchGateway: JsTestWatchGateway = {
      acknowledgeWatchStart,
      startWatch,
      stopWatch,
      subscribeWatchOutput: async () => () => undefined,
      subscribeWatchStatus: async () => () => undefined,
    };
    const command: JsTestWatchCommand = {
      kind: "vitest-watch",
      packageRootRelativePath: "",
      scope: { kind: "all" },
    };
    const harness = renderExplorer({
      continuousRunWatchCommand: command,
      taskGateway: null,
      watchGateway,
    });

    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(startWatch).toHaveBeenCalledOnce());
    await waitForReact(() => expect(acknowledgeWatchStart).toHaveBeenCalledOnce());
    harness.set({ continuousRunVersion: 1 });
    harness.set({ continuousRunVersion: 2 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));

    expect(startWatch).toHaveBeenCalledExactlyOnceWith({
      command,
      epoch: 1,
      watchId: "watch-1-1",
      workspaceId: "workspace-a",
    });
    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    expect(stopWatch).toHaveBeenCalledExactlyOnceWith({
      epoch: 1,
      watchId: "watch-1-1",
      workspaceId: "workspace-a",
    });
    harness.unmount();
  });

  it("keeps a native watch owner fail-closed until stop succeeds", async () => {
    const stopWatch = vi
      .fn<JsTestWatchGateway["stopWatch"]>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(undefined);
    const watchGateway: JsTestWatchGateway = {
      acknowledgeWatchStart: async () => undefined,
      startWatch: async ({ epoch, watchId, workspaceId }) => ({
        owner: { epoch, watchId, workspaceId },
        structuredResults: "unavailable-in-watch-mode",
      }),
      stopWatch,
      subscribeWatchOutput: async () => () => undefined,
      subscribeWatchStatus: async () => () => undefined,
    };
    const harness = renderExplorer({
      continuousRunWatchCommand: {
        kind: "vitest-watch",
        packageRootRelativePath: "",
        scope: { kind: "all" },
      },
      watchGateway,
    });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(harness.hook().continuousRunPending).toBe(false));

    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(false));
    expect(harness.hook()).toMatchObject({
      continuousRunEnabled: false,
      continuousRunStopping: true,
    });
    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    expect(stopWatch).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("retains an uncertain native watch start until compensation succeeds", async () => {
    const stopWatch = vi
      .fn<JsTestWatchGateway["stopWatch"]>()
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce(undefined);
    const watchGateway: JsTestWatchGateway = {
      acknowledgeWatchStart: async () => undefined,
      startWatch: async () => {
        throw new Error("uncertain settlement");
      },
      stopWatch,
      subscribeWatchOutput: async () => () => undefined,
      subscribeWatchStatus: async () => () => undefined,
    };
    const harness = renderExplorer({
      continuousRunWatchCommand: {
        kind: "vitest-watch",
        packageRootRelativePath: "",
        scope: { kind: "all" },
      },
      watchGateway,
    });

    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(stopWatch).toHaveBeenCalledTimes(1));
    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    expect(stopWatch).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("waits for a pending native start before confirming cancellation", async () => {
    const start = deferred<Awaited<ReturnType<JsTestWatchGateway["startWatch"]>>>();
    const stopWatch = vi.fn<JsTestWatchGateway["stopWatch"]>(async () => undefined);
    const watchGateway: JsTestWatchGateway = {
      acknowledgeWatchStart: async () => undefined,
      startWatch: () => start.promise,
      stopWatch,
      subscribeWatchOutput: async () => () => undefined,
      subscribeWatchStatus: async () => () => undefined,
    };
    const harness = renderExplorer({
      continuousRunWatchCommand: {
        kind: "vitest-watch",
        packageRootRelativePath: "",
        scope: { kind: "all" },
      },
      watchGateway,
    });

    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(true));
    let stopping!: Promise<boolean>;
    act(() => {
      stopping = harness.hook().stopContinuousRun();
    });
    await act(async () =>
      start.resolve({
        owner: { epoch: 1, watchId: "watch-1-1", workspaceId: "workspace-a" },
        structuredResults: "unavailable-in-watch-mode",
      }),
    );

    await expect(stopping).resolves.toBe(true);
    expect(stopWatch).toHaveBeenCalledExactlyOnceWith({
      epoch: 1,
      watchId: "watch-1-1",
      workspaceId: "workspace-a",
    });
    harness.unmount();
  });

  it("stays armed after a post-admission failure and waits for a newer change", async () => {
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockRejectedValueOnce(new Error("runner failed"))
      .mockImplementationOnce(async (request) => taskEnvelope(request.runId, ok([])));
    const harness = renderExplorer({
      taskGateway: { runTask, stopTask: async () => true },
    });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(false));
    expect(harness.hook().continuousRunEnabled).toBe(true);

    harness.set({ continuousRunVersion: 1 });
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(2));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(false));
    expect(harness.hook().continuousRunEnabled).toBe(true);
    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    harness.unmount();
  });

  it("cancels only the exact stored Continuous Run task coordinator", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(() => pending.promise);
    const harness = renderExplorer({ taskGateway: { runTask, stopTask } });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(1));
    expect(harness.hook().continuousRunRunning).toBe(true);

    await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(true));
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "task-1",
      workspaceId: "workspace-a",
    });
    expect(harness.hook()).toMatchObject({
      continuousRunEnabled: false,
      continuousRunStopping: true,
    });

    await act(async () => pending.resolve(taskEnvelope("task-1", { status: "cancelled" })));
    await waitForReact(() => expect(harness.hook().continuousRunStopping).toBe(false));
    harness.unmount();
  });

  it.each(["returns false", "throws"] as const)(
    "keeps a failed exact stop fail-closed when stopTask %s",
    async (failureMode) => {
      const pending = deferred<ReturnType<typeof taskEnvelope>>();
      const stopTask = vi.fn(async () => {
        if (failureMode === "throws") throw new Error("stop failed");
        return false;
      });
      const harness = renderExplorer({
        taskGateway: { runTask: () => pending.promise, stopTask },
      });
      act(() => expect(harness.hook().startContinuousRun()).toBe(true));
      await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(true));

      await act(async () => expect(await harness.hook().stopContinuousRun()).toBe(false));
      expect(harness.hook()).toMatchObject({
        continuousRunEnabled: false,
        continuousRunStopping: true,
      });
      expect(harness.hook().canStartContinuousRun()).toBe(false);
      expect(harness.hook().startContinuousRun()).toBe(false);
      expect(stopTask).toHaveBeenCalledExactlyOnceWith({
        runId: "task-1",
        workspaceId: "workspace-a",
      });

      await act(async () =>
        pending.resolve(taskEnvelope("task-1", ok([]), taskOutput("late", ""))),
      );
      await waitForReact(() => expect(harness.hook().continuousRunStopping).toBe(false));
      expect(harness.hook().outputSnapshot).toBeNull();
      expect(harness.hook().canStartContinuousRun()).toBe(true);
      harness.unmount();
    },
  );

  it("never admits a Continuous Run beside a manual task across workspace A to B", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => false);
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(() => pending.promise);
    const harness = renderExplorer({ taskGateway: { runTask, stopTask } });
    let manual!: Promise<void>;
    act(() => {
      manual = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(runTask).toHaveBeenCalledTimes(1));

    expect(harness.hook().startContinuousRun()).toBe(false);
    await expect(harness.hook().stopContinuousRun()).resolves.toBe(false);
    expect(stopTask).not.toHaveBeenCalled();
    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(stopTask).toHaveBeenCalledTimes(1));
    expect(harness.hook().canStartContinuousRun()).toBe(false);
    expect(harness.hook().startContinuousRun()).toBe(false);
    expect(runTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(taskEnvelope("task-1", ok([])));
      await manual;
    });
    harness.unmount();
  });

  it("disarms Continuous Run when an external coverage or debug lifecycle blocks admission", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const harness = renderExplorer({
      taskGateway: { runTask: () => pending.promise, stopTask },
    });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(true));

    harness.set({ continuousRunBlocked: true });
    await waitForReact(() =>
      expect(stopTask).toHaveBeenCalledExactlyOnceWith({
        runId: "task-1",
        workspaceId: "workspace-a",
      }),
    );
    expect(harness.hook().continuousRunEnabled).toBe(false);
    expect(harness.hook().canStartContinuousRun()).toBe(false);

    await act(async () => pending.resolve(taskEnvelope("task-1", { status: "cancelled" })));
    harness.set({ continuousRunBlocked: false });
    await waitForReact(() => expect(harness.hook().canStartContinuousRun()).toBe(true));
    harness.unmount();
  });

  it("fences late Continuous Run settlement across workspace A-B-A", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const harness = renderExplorer({
      taskGateway: { runTask: () => pending.promise, stopTask },
    });
    act(() => expect(harness.hook().startContinuousRun()).toBe(true));
    await waitForReact(() => expect(harness.hook().continuousRunRunning).toBe(true));

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() =>
      expect(stopTask).toHaveBeenCalledExactlyOnceWith({
        runId: "task-1",
        workspaceId: "workspace-a",
      }),
    );
    expect(harness.hook().continuousRunEnabled).toBe(false);

    await act(async () => pending.resolve(taskEnvelope("task-1", ok([]), taskOutput("late", ""))));
    expect(harness.hook().outputSnapshot).toBeNull();
    await waitForReact(() => expect(harness.hook().canStartContinuousRun()).toBe(true));
    harness.unmount();
  });

  it("keeps the legacy gateway as an output-free compatibility fallback", async () => {
    const run = vi.fn<JsTestGateway["run"]>(async () => ok([]));
    const harness = renderExplorer({ runGateway: { run }, taskGateway: null });

    await act(async () => harness.hook().run({ kind: "file", relativeFilePath: "a.test.ts" }));

    expect(run).toHaveBeenCalledExactlyOnceWith(ROOT_A, {
      kind: "file",
      relativeFilePath: "a.test.ts",
    });
    expect(harness.hook().outputSnapshot).toBeNull();
    harness.unmount();
  });

  it("clears accepted output on result invalidation", async () => {
    const harness = renderExplorer({
      taskGateway: {
        runTask: async (request) => taskEnvelope(request.runId, ok([]), taskOutput("accepted", "")),
        stopTask: async () => true,
      },
    });
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().outputSnapshot?.output.stdout.text).toBe("accepted");

    harness.set({ resultInvalidationVersion: 1 });

    expect(harness.hook().outputSnapshot).toBeNull();
    harness.unmount();
  });

  it("never republishes an accepted output snapshot across an A-B-A activation", async () => {
    const taskGateway: JsTestTaskGateway = {
      runTask: async (request) =>
        taskEnvelope(request.runId, ok([]), taskOutput("accepted-a", ""), request.workspaceId),
      stopTask: async () => true,
    };
    const harness = renderExplorer({ taskGateway });
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().outputSnapshot?.output.stdout.text).toBe("accepted-a");

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });

    expect(harness.hook().outputSnapshot).toBeNull();
    harness.unmount();
  });

  it("rejects late task output across an owner A-B-A activation fence", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const harness = renderExplorer({
      taskGateway: { runTask: () => pending.promise, stopTask },
    });
    let running!: Promise<void>;
    act(() => {
      running = harness.hook().run({ kind: "all" });
    });
    await vi.waitFor(() => expect(harness.hook().isRunning).toBe(true));

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await vi.waitFor(() =>
      expect(stopTask).toHaveBeenCalledExactlyOnceWith({
        runId: "task-1",
        workspaceId: "workspace-a",
      }),
    );
    await act(async () => {
      pending.resolve(taskEnvelope("task-1", ok([]), taskOutput("late", "")));
      await running;
    });

    expect(harness.hook().outputSnapshot).toBeNull();
    expect(harness.hook().isRunning).toBe(false);
    harness.unmount();
  });

  it("rejects invalid or concurrent runnable scopes before a second lifecycle starts", async () => {
    const pending = deferred<TestRunResponse>();
    const run = vi.fn<JsTestGateway["run"]>(() => pending.promise);
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    const scope = { kind: "file", relativeFilePath: "a.test.ts" } as const;
    let active!: Promise<boolean>;

    act(() => {
      active = harness.hook().runScope(scope);
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(harness.hook().canRunScope(scope)).toBe(false);
    await expect(harness.hook().runScope(scope)).resolves.toBe(false);
    await expect(
      harness.hook().runScope({ kind: "file", relativeFilePath: "../outside.test.ts" }),
    ).resolves.toBe(false);
    expect(run).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(ok([])));
    await expect(active).resolves.toBe(true);
    harness.unmount();
  });

  it.each<JsTestRunScope>([
    { kind: "all" },
    { kind: "file", relativeFilePath: "a.test.ts" },
    { fullName: "suite", kind: "suite", relativeFilePath: "a.test.ts" },
    {
      fullName: "suite works",
      kind: "test",
      nameMatch: "prefix",
      relativeFilePath: "a.test.ts",
    },
  ])("reruns the exact deeply frozen successful $kind scope", async (scope) => {
    const received: JsTestRunScope[] = [];
    const run = vi.fn<JsTestGateway["run"]>(async (_rootPath, nextScope) => {
      received.push(nextScope);
      return ok([]);
    });
    const harness = renderExplorer({ runGateway: { run } });

    expect(harness.hook().canRerunLastRun()).toBe(false);
    await act(async () => harness.hook().run(scope));
    expect(harness.hook().canRerunLastRun()).toBe(true);
    await act(async () => expect(await harness.hook().rerunLastRun()).toBe(true));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(scope);
    expect(received[1]).toEqual(scope);
    expect(received[1]).not.toBe(scope);
    expect(Object.isFrozen(received[0])).toBe(true);
    expect(Object.isFrozen(received[1])).toBe(true);
    harness.unmount();
  });

  it("keeps the last successful scope after rejected results and rejects a concurrent rerun", async () => {
    const pending = deferred<TestRunResponse>();
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(ok([]))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(ok([]));
    const harness = renderExplorer({ runGateway: { run } });
    const first = { kind: "file", relativeFilePath: "a.test.ts" } as const;
    const rejected = {
      fullName: "suite works",
      kind: "test",
      relativeFilePath: "a.test.ts",
    } as const;
    await act(async () => harness.hook().run(first));

    let running!: Promise<void>;
    act(() => {
      running = harness.hook().run(rejected);
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(harness.hook().canRerunLastRun()).toBe(false);
    await expect(harness.hook().rerunLastRun()).resolves.toBe(false);
    await act(async () => pending.resolve({ message: "failed", status: "error" }));
    await running;

    expect(harness.hook().canRerunLastRun()).toBe(true);
    await act(async () => expect(await harness.hook().rerunLastRun()).toBe(true));
    expect(run).toHaveBeenLastCalledWith(ROOT_A, first);
    harness.unmount();
  });

  it.each([
    ["discovery invalidation", { discoveryVersion: 1 }],
    ["result invalidation", { resultInvalidationVersion: 1 }],
    ["trust transition", { workspaceTrusted: false }],
    ["run gateway replacement", { runGateway: { run: vi.fn(async () => ok([])) } }],
    ["discovery gateway replacement", { discoveryGateway: discovery() }],
  ] as const)("clears the last run on %s", async (_label, replacement) => {
    const harness = renderExplorer();
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().canRerunLastRun()).toBe(true);

    harness.set(replacement);

    expect(harness.hook().canRerunLastRun()).toBe(false);
    await expect(harness.hook().rerunLastRun()).resolves.toBe(false);
    harness.unmount();
  });

  it("clears the last run across an owner A-B-A transition", async () => {
    const harness = renderExplorer();
    await act(async () => harness.hook().run({ kind: "all" }));
    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });

    expect(harness.hook().canRerunLastRun()).toBe(false);
    await expect(harness.hook().rerunLastRun()).resolves.toBe(false);
    harness.unmount();
  });

  it("returns false when a rerun settles after its activation is replaced", async () => {
    const pending = deferred<TestRunResponse>();
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(ok([]))
      .mockImplementationOnce(() => pending.promise);
    const harness = renderExplorer({ runGateway: { run } });
    await act(async () => harness.hook().run({ kind: "all" }));

    let rerunning!: Promise<boolean>;
    act(() => {
      rerunning = harness.hook().rerunLastRun();
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    harness.set({ runGateway: { run: vi.fn(async () => ok([])) } });
    await act(async () => pending.resolve(ok([])));

    await expect(rerunning).resolves.toBe(false);
    expect(harness.hook().canRerunLastRun()).toBe(false);
    expect(harness.hook().isRunning).toBe(false);
    harness.unmount();
  });

  it("reruns failed scopes sequentially and atomically publishes the aggregate", async () => {
    const failed = ok([
      runtimeCase("suite first", `${ROOT_A}/a.test.ts`, 2, "failed"),
      runtimeCase("suite second", `${ROOT_A}/a.test.ts`, 3, "error"),
    ]);
    const run = vi.fn<JsTestGateway["run"]>().mockResolvedValue(failed);
    let taskIndex = 0;
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(async (request) =>
      request.scope.kind === "all"
        ? taskEnvelope(request.runId, failed, taskOutput("baseline", ""))
        : taskEnvelope(
            request.runId,
            ok([
              runtimeCase(
                request.scope.kind === "test" ? request.scope.fullName : "",
                `${ROOT_A}/a.test.ts`,
                ++taskIndex + 1,
                "passed",
              ),
            ]),
            taskOutput(`child-${taskIndex}`, ""),
          ),
    );
    const harness = renderExplorer({
      discoveryGateway: discovery({
        readTextFileBounded: vi.fn(async () => ({
          status: "ok" as const,
          content: `describe("suite", () => {
  test("first", () => {});
  test("second", () => {});
});`,
        })),
      }),
      isOpen: true,
      runGateway: { run },
      taskGateway: { runTask, stopTask: async () => true },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().canRerunFailedTests()).toBe(true);

    await act(async () => expect(await harness.hook().rerunFailedTests()).toBe(true));

    expect(runTask).toHaveBeenCalledTimes(3);
    expect(harness.hook().result?.totals.tests).toBe(2);
    expect(harness.hook().result?.totals.failures).toBe(0);
    expect(harness.hook().outputSnapshot?.output.stdout.text).toBe("child-1\nchild-2");
    expect(harness.hook().failedRunPhase).toBe("idle");
    expect(harness.hook().canRerunFailedTests()).toBe(false);
    harness.unmount();
  });

  it("shares the normal run lock and restores the exact state after cancellation", async () => {
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const task = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const run = vi.fn<JsTestGateway["run"]>().mockResolvedValue(failed);
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failed))
      .mockImplementationOnce(() => task.promise);
    const harness = renderExplorer({
      isOpen: true,
      runGateway: { run },
      taskGateway: {
        runTask,
        stopTask,
      },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    const capturedResult = harness.hook().result;
    let batch!: Promise<boolean>;
    act(() => {
      batch = harness.hook().rerunFailedTests();
    });
    await waitForReact(() => expect(harness.hook().failedRunPhase).toBe("running"));
    expect(harness.hook().canRunScope({ kind: "file", relativeFilePath: "a.test.ts" })).toBe(false);
    await expect(
      harness.hook().runScope({ kind: "file", relativeFilePath: "a.test.ts" }),
    ).resolves.toBe(false);

    let cancelling!: Promise<boolean>;
    act(() => {
      cancelling = harness.hook().cancelTestRun();
    });
    expect(harness.hook().failedRunPhase).toBe("cancelling");
    await act(async () => expect(await cancelling).toBe(true));
    await act(async () => {
      task.resolve(
        taskEnvelope(
          "task-2",
          { status: "cancelled" },
          {
            stderr: { text: "cancel detail", truncated: false },
            stdout: { text: "partial output", truncated: true },
          },
        ),
      );
      expect(await batch).toBe(false);
    });

    expect(harness.hook().result).toBe(capturedResult);
    expect(harness.hook().tree?.status).toBe("failed");
    expect(harness.hook().outputSnapshot?.output).toEqual({
      stderr: { text: "cancel detail", truncated: false },
      stdout: { text: "partial output", truncated: true },
    });
    expect(stopTask).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("disables failed rerun for an ambiguous discovery", async () => {
    const failed = ok([runtimeCase("same", `${ROOT_A}/a.test.ts`, 1, "failed")]);
    const harness = renderExplorer({
      discoveryGateway: discovery({
        readTextFileBounded: vi.fn(async () => ({
          status: "ok" as const,
          content: `test("same", () => {});
test("same", () => {});`,
        })),
      }),
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: {
        runTask: async (request) => taskEnvelope(request.runId, failed),
        stopTask: vi.fn(),
      },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));

    expect(harness.hook().canRerunFailedTests()).toBe(false);
    await expect(harness.hook().rerunFailedTests()).resolves.toBe(false);
    harness.unmount();
  });

  it("invalidates and rolls back a late failed batch across trust A-B-A", async () => {
    const task = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failed))
      .mockImplementationOnce(() => task.promise);
    const harness = renderExplorer({
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: { runTask, stopTask },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    let batch!: Promise<boolean>;
    act(() => {
      batch = harness.hook().rerunFailedTests();
    });
    await waitForReact(() => expect(harness.hook().failedRunPhase).toBe("running"));

    harness.set({ workspaceTrusted: false });
    harness.set({ workspaceTrusted: true });
    await waitForReact(() => expect(stopTask).toHaveBeenCalledOnce());
    await act(async () => {
      task.resolve(taskEnvelope("task-2", ok([])));
      expect(await batch).toBe(false);
    });

    expect(harness.hook().failedRunPhase).toBe("idle");
    expect(harness.hook().tree?.status).toBe("idle");
    expect(harness.hook().canRerunFailedTests()).toBe(false);
    harness.unmount();
  });

  it("preserves a newer problem invalidation when a stale batch settles", async () => {
    const task = deferred<ReturnType<typeof taskEnvelope>>();
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failed))
      .mockImplementationOnce(() => task.promise);
    const harness = renderExplorer({
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: {
        runTask,
        stopTask: async () => true,
      },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    let batch!: Promise<boolean>;
    act(() => {
      batch = harness.hook().rerunFailedTests();
    });
    harness.set({ resultInvalidationVersion: 1 });
    await waitForReact(() => expect(harness.hook().problemSnapshot?.entries).toEqual([]));

    await act(async () => {
      task.resolve(taskEnvelope("task-2", ok([])));
      expect(await batch).toBe(false);
    });

    expect(harness.hook().problemSnapshot?.entries).toEqual([]);
    harness.unmount();
  });

  it("preserves discovery loaded=false when an invalidated batch settles", async () => {
    const task = deferred<ReturnType<typeof taskEnvelope>>();
    const enumerateJsTestFiles = vi.fn(async () => ({
      files: ["a.test.ts"],
      truncated: false,
      visited: 1,
    }));
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failed))
      .mockImplementationOnce(() => task.promise);
    const harness = renderExplorer({
      discoveryGateway: discovery({ enumerateJsTestFiles }),
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: { runTask, stopTask: async () => true },
    });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledOnce());
    await act(async () => harness.hook().run({ kind: "all" }));
    let batch!: Promise<boolean>;
    act(() => {
      batch = harness.hook().rerunFailedTests();
    });

    harness.set({ discoveryVersion: 1, isOpen: false });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    await act(async () => {
      task.resolve(taskEnvelope("task-2", ok([])));
      expect(await batch).toBe(false);
    });
    harness.set({ isOpen: true });

    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(2));
    harness.unmount();
  });

  it("publishes a bounded task error only on the exact current boundary", async () => {
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const harness = renderExplorer({
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: {
        runTask: vi
          .fn<JsTestTaskGateway["runTask"]>()
          .mockResolvedValueOnce(taskEnvelope("task-1", failed))
          .mockImplementationOnce(async (request) =>
            taskEnvelope(request.runId, { message: "task failed", status: "error" }),
          ),
        stopTask: async () => true,
      },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));

    await act(async () => expect(await harness.hook().rerunFailedTests()).toBe(false));

    expect(harness.hook().error).toBe("task failed");
    expect(harness.hook().tree?.status).toBe("failed");
    harness.unmount();
  });

  it("globally rejects workspace B until workspace A's exact batch is reaped", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const failedA = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const failedB = ok([runtimeCase("suite works", `${ROOT_B}/b.test.ts`, 2, "failed")]);
    const aTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failedA))
      .mockImplementationOnce(() => pending.promise);
    const a = renderExplorer({
      isOpen: true,
      runGateway: { run: vi.fn(async () => failedA) },
      taskGateway: { runTask: aTask, stopTask: async () => true },
    });
    const bTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failedB, emptyTaskOutput(), "workspace-b"))
      .mockImplementationOnce(async (request) =>
        taskEnvelope(request.runId, ok([]), emptyTaskOutput(), "workspace-b"),
      );
    const b = renderExplorer({
      isOpen: true,
      rootPath: ROOT_B,
      runGateway: { run: vi.fn(async () => failedB) },
      taskGateway: { runTask: bTask, stopTask: async () => true },
      workspaceId: "workspace-b",
    });
    await waitForReact(() => {
      expect(a.hook().tree?.children).toHaveLength(1);
      expect(b.hook().tree?.children).toHaveLength(1);
    });
    await act(async () => a.hook().run({ kind: "all" }));
    await act(async () => b.hook().run({ kind: "all" }));
    let batchA!: Promise<boolean>;
    act(() => {
      batchA = a.hook().rerunFailedTests();
    });
    expect(b.hook().canRerunFailedTests()).toBe(false);
    await expect(b.hook().rerunFailedTests()).resolves.toBe(false);

    await act(async () => {
      pending.resolve(taskEnvelope("task-2", { status: "cancelled" }));
      expect(await batchA).toBe(false);
    });
    expect(b.hook().canRerunFailedTests()).toBe(true);
    await act(async () => expect(await b.hook().rerunFailedTests()).toBe(true));
    expect(bTask).toHaveBeenCalledTimes(2);
    a.unmount();
    b.unmount();
  });

  it("invalidates and stops the exact active child on unmount", async () => {
    const pending = deferred<ReturnType<typeof taskEnvelope>>();
    const stopTask = vi.fn(async () => true);
    const failed = ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(taskEnvelope("task-1", failed))
      .mockImplementationOnce(() => pending.promise);
    const harness = renderExplorer({
      isOpen: true,
      runGateway: { run: vi.fn(async () => failed) },
      taskGateway: { runTask, stopTask },
    });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    const batch = harness.hook().rerunFailedTests();
    harness.unmount();
    await vi.waitFor(() =>
      expect(stopTask).toHaveBeenCalledExactlyOnceWith({
        runId: "task-2",
        workspaceId: "workspace-a",
      }),
    );
    pending.resolve(taskEnvelope("task-2", { status: "cancelled" }));
    await expect(batch).resolves.toBe(false);
  });

  it.each(["success", "reject"] as const)(
    "settles a stale pending %s without publishing last-run or running state",
    async (outcome) => {
      const pending = deferred<TestRunResponse>();
      const gateway = { run: vi.fn(() => pending.promise) };
      const harness = renderExplorer({ isOpen: true, runGateway: gateway });
      await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
      let running!: Promise<void>;
      act(() => {
        running = harness.hook().run({
          fullName: "suite works",
          kind: "test",
          nameMatch: "prefix",
          relativeFilePath: "a.test.ts",
        });
      });
      await waitForReact(() => expect(harness.hook().isRunning).toBe(true));

      harness.set({ workspaceTrusted: false });
      harness.set({ workspaceTrusted: true });
      await act(async () =>
        outcome === "success"
          ? pending.resolve(ok([]))
          : pending.reject(new Error("stale rejection")),
      );
      await running;

      expect(harness.hook().canRerunLastRun()).toBe(false);
      expect(harness.hook().isRunning).toBe(false);
      expect(harness.hook().error).toBeNull();
      expect(harness.hook().tree?.status).toBe("idle");
      harness.unmount();
    },
  );

  it("discovers on open without ever auto-running tests", async () => {
    const run = vi.fn<JsTestGateway["run"]>();
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });

    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));

    expect(run).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("allows untrusted discovery but blocks execution", async () => {
    const run = vi.fn<JsTestGateway["run"]>();
    const harness = renderExplorer({
      discoveryGateway: discovery(),
      runGateway: { run },
      workspaceTrusted: false,
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));

    await act(async () => harness.hook().run({ kind: "all" }));

    expect(run).not.toHaveBeenCalled();
    expect(harness.hook().unavailable).toContain("Trust this workspace");
    harness.unmount();
  });

  it("clears the trust banner and permits a retry when the workspace becomes trusted", async () => {
    const run = vi.fn<JsTestGateway["run"]>().mockResolvedValue(ok([]));
    const harness = renderExplorer({
      discoveryGateway: discovery(),
      runGateway: { run },
      workspaceTrusted: false,
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().unavailable).toContain("Trust this workspace");

    harness.set({ workspaceTrusted: true });
    await waitForReact(() => expect(harness.hook().unavailable).toBeNull());
    await act(async () => harness.hook().run({ kind: "all" }));

    expect(run).toHaveBeenCalledExactlyOnceWith(ROOT_A, { kind: "all" });
    harness.unmount();
  });

  it("permits a retry after a runner error", async () => {
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce({ message: "Runner failed", status: "error" })
      .mockResolvedValueOnce(ok([]));
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));

    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().error).toBe("Runner failed");
    await act(async () => harness.hook().run({ kind: "all" }));

    expect(run).toHaveBeenCalledTimes(2);
    expect(harness.hook().error).toBeNull();
    harness.unmount();
  });

  it("publishes and scope-merges problems with a monotonic exact-owner generation", async () => {
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(
        ok([
          runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed"),
          runtimeCase("suite other", `${ROOT_A}/a.test.ts`, 3, "failed"),
        ]),
      )
      .mockResolvedValueOnce(ok([]));
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });

    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().problemSnapshot).toMatchObject({
      generation: 1,
      owner: { rootKey: ROOT_A, workspaceId: "workspace-a" },
      total: 2,
      truncated: false,
    });
    expect(harness.hook().problemSnapshot?.entries.map(({ name }) => name)).toEqual([
      "suite works",
      "suite other",
    ]);

    await act(async () =>
      harness.hook().run({
        fullName: "suite works",
        kind: "test",
        relativeFilePath: "a.test.ts",
      }),
    );
    expect(harness.hook().problemSnapshot).toMatchObject({ generation: 2, total: 1 });
    expect(harness.hook().problemSnapshot?.entries.map(({ name }) => name)).toEqual([
      "suite other",
    ]);
    harness.unmount();
  });

  it("keeps the last accepted problems while running and after error, unavailable, or throw", async () => {
    const pending = deferred<TestRunResponse>();
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "failed")]))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ message: "missing", status: "unavailable" })
      .mockRejectedValueOnce(new Error("thrown"));
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    await act(async () => harness.hook().run({ kind: "all" }));
    const accepted = harness.hook().problemSnapshot;

    let running!: Promise<void>;
    act(() => {
      running = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(harness.hook().isRunning).toBe(true));
    expect(harness.hook().problemSnapshot).toBe(accepted);
    await act(async () => pending.resolve({ message: "failed", status: "error" }));
    await running;
    expect(harness.hook().problemSnapshot).toBe(accepted);
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().problemSnapshot).toBe(accepted);
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().problemSnapshot).toBe(accepted);
    harness.unmount();
  });

  it("invalidates problems while closed and rejects an older in-flight problem commit", async () => {
    const pending = deferred<TestRunResponse>();
    const first = ok([runtimeCase("old", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const late = ok([runtimeCase("late", `${ROOT_A}/a.test.ts`, 2, "failed")]);
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => pending.promise);
    const harness = renderExplorer({ isOpen: false, runGateway: { run } });
    await act(async () => harness.hook().run({ kind: "all" }));
    expect(harness.hook().problemSnapshot).toMatchObject({ generation: 1, total: 1 });
    expect(harness.hook().result).toBe(first);

    let running!: Promise<void>;
    act(() => {
      running = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(harness.hook().isRunning).toBe(true));
    harness.set({ resultInvalidationVersion: 1 });
    await waitForReact(() =>
      expect(harness.hook().problemSnapshot).toMatchObject({
        entries: [],
        generation: 3,
        total: 0,
      }),
    );
    expect(harness.hook().result).toBe(first);

    await act(async () => pending.resolve(late));
    await running;
    expect(harness.hook().problemSnapshot).toMatchObject({
      entries: [],
      generation: 3,
      total: 0,
    });
    expect(harness.hook().result).toBe(first);
    harness.unmount();
  });

  it("cancels an originating discovery and restarts it after an A to B to A switch", async () => {
    const aEnumeration = deferred<{
      files: readonly string[];
      truncated: boolean;
      visited: number;
    }>();
    const gateway = discovery({
      enumerateJsTestFiles: vi.fn(async (rootPath) =>
        rootPath === ROOT_A
          ? aEnumeration.promise
          : { files: ["b.test.ts"], truncated: false, visited: 1 },
      ),
    });
    const harness = renderExplorer({ discoveryGateway: gateway });
    harness.set({ isOpen: true });
    await waitForReact(() =>
      expect(gateway.enumerateJsTestFiles).toHaveBeenCalledWith(ROOT_A, expect.anything()),
    );

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().tree?.children[0]?.filePath).toBe("b.test.ts"));
    await act(async () =>
      aEnumeration.resolve({ files: ["a.test.ts"], truncated: false, visited: 1 }),
    );
    expect(gateway.readTextFileBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "a.test.ts",
      expect.anything(),
    );

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => {
      expect(harness.hook().isLoading).toBe(false);
      expect(harness.hook().tree?.children[0]?.filePath).toBe("a.test.ts");
    });
    expect(gateway.enumerateJsTestFiles).toHaveBeenCalledTimes(3);
    harness.unmount();
  });

  it("drops an A run completion after switching to B without leaking it", async () => {
    const aRun = deferred<TestRunResponse>();
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockImplementation((rootPath) =>
        rootPath === ROOT_A ? aRun.promise : Promise.resolve(ok([])),
      );
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));

    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(harness.hook().isRunning).toBe(true));
    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().tree?.rootPath).toBe(ROOT_B));

    await act(async () =>
      aRun.resolve(ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "passed")])),
    );
    await pending;
    expect(harness.hook().tree?.status).toBe("idle");
    expect(harness.hook().problemSnapshot).toBeNull();

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    expect(harness.hook().tree?.status).toBe("idle");
    expect(harness.hook().isRunning).toBe(false);
    expect(harness.hook().problemSnapshot).toBeNull();
    harness.unmount();
  });

  it("preserves completed statuses across an A to B to A switch", async () => {
    const passedGateway: JsTestGateway = {
      run: async () => ok([runtimeCase("suite works", `${ROOT_A}/a.test.ts`, 2, "passed")]),
    };
    const persistence = renderExplorer({
      discoveryGateway: discovery(),
      runGateway: passedGateway,
    });
    persistence.set({ isOpen: true });
    await waitForReact(() => expect(persistence.hook().tree?.children).toHaveLength(1));
    await act(async () => persistence.hook().run({ kind: "all" }));
    expect(persistence.hook().tree?.status).toBe("passed");
    const aProblems = persistence.hook().problemSnapshot;
    persistence.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(persistence.hook().tree?.rootPath).toBe(ROOT_B));
    expect(persistence.hook().problemSnapshot).toBeNull();
    persistence.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    expect(persistence.hook().tree?.status).toBe("passed");
    expect(persistence.hook().problemSnapshot).toBe(aProblems);
    persistence.unmount();
  });

  it("reports running while a sibling's previous failure remains visible", async () => {
    const secondRun = deferred<TestRunResponse>();
    const run = vi
      .fn<JsTestGateway["run"]>()
      .mockResolvedValueOnce(
        ok([
          runtimeCase("suite fails", `${ROOT_A}/a.test.ts`, 2, "failed"),
          runtimeCase("suite waits", `${ROOT_A}/a.test.ts`, 3, "passed"),
        ]),
      )
      .mockImplementationOnce(() => secondRun.promise);
    const harness = renderExplorer({
      discoveryGateway: discovery({
        readTextFileBounded: vi.fn(async () => ({
          status: "ok" as const,
          content: `describe("suite", () => {\n  test("fails", () => {});\n  test("waits", () => {});\n});`,
        })),
      }),
      runGateway: { run },
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    await act(async () => harness.hook().run({ kind: "all" }));

    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook().run({
        kind: "test",
        relativeFilePath: "a.test.ts",
        fullName: "suite waits",
      });
    });
    await waitForReact(() => {
      expect(harness.hook().tree?.status).toBe("failed");
      expect(harness.hook().isRunning).toBe(true);
    });
    await act(async () => secondRun.resolve(ok([])));
    await pending;
    harness.unmount();
  });

  it("allows only one run per workspace and blocks refresh while it is running", async () => {
    const pendingRun = deferred<TestRunResponse>();
    const run = vi.fn<JsTestGateway["run"]>().mockImplementation(() => pendingRun.promise);
    const gateway = discovery();
    const harness = renderExplorer({ discoveryGateway: gateway, runGateway: { run } });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    vi.mocked(gateway.enumerateJsTestFiles).mockClear();

    let first!: Promise<void>;
    act(() => {
      first = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(harness.hook().isRunning).toBe(true));
    await act(async () => {
      await harness.hook().run({ kind: "file", relativeFilePath: "a.test.ts" });
      await harness.hook().refresh();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(gateway.enumerateJsTestFiles).not.toHaveBeenCalled();
    await act(async () => pendingRun.resolve(ok([])));
    await first;
    harness.unmount();
  });

  it("reports a workspace run even when discovery found no test nodes", async () => {
    const pendingRun = deferred<TestRunResponse>();
    const harness = renderExplorer({
      discoveryGateway: discovery({
        enumerateJsTestFiles: vi.fn(async () => ({ files: [], truncated: false, visited: 0 })),
      }),
      runGateway: {
        run: vi.fn(() => pendingRun.promise),
      },
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().isLoading).toBe(false));

    let running!: Promise<void>;
    act(() => {
      running = harness.hook().run({ kind: "all" });
    });
    await waitForReact(() => expect(harness.hook().isRunning).toBe(true));
    await act(async () => pendingRun.resolve(ok([])));
    await running;
    expect(harness.hook().isRunning).toBe(false);
    harness.unmount();
  });

  it("runs all exactly once when the request version advances", async () => {
    const run = vi.fn<JsTestGateway["run"]>().mockResolvedValue(ok([]));
    const harness = renderExplorer({ discoveryGateway: discovery(), runGateway: { run } });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(1));
    expect(run).not.toHaveBeenCalled();

    harness.set({ runRequestVersion: 1 });
    await waitForReact(() => expect(run).toHaveBeenCalledExactlyOnceWith(ROOT_A, { kind: "all" }));
    harness.set({ isOpen: false });
    harness.set({ isOpen: true });
    await act(async () => Promise.resolve());
    expect(run).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("bounds concurrent source reads to eight", async () => {
    let active = 0;
    let maximum = 0;
    const gateway = discovery({
      enumerateJsTestFiles: vi.fn(async () => ({
        files: Array.from({ length: 24 }, (_, index) => `${index}.test.ts`),
        truncated: false,
        visited: 24,
      })),
      readTextFileBounded: vi.fn(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return { status: "ok" as const, content: TEST_SOURCE };
      }),
    });
    const harness = renderExplorer({ discoveryGateway: gateway });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().tree?.children).toHaveLength(24));

    expect(maximum).toBe(8);
    harness.unmount();
  });

  it("stops and marks discovery truncated at the aggregate source-byte budget", async () => {
    // Four UTF-8 bytes per scalar crosses the byte budget with fewer parser passes,
    // keeping the boundary test fast under coverage instrumentation.
    const largeSource = "💩".repeat(1024 * 1024);
    const gateway = discovery({
      enumerateJsTestFiles: vi.fn(async () => ({
        files: Array.from({ length: 40 }, (_, index) => `${index}.test.ts`),
        truncated: false,
        visited: 40,
      })),
      readTextFileBounded: vi.fn(async () => ({
        status: "ok" as const,
        content: largeSource,
      })),
    });
    const harness = renderExplorer({ discoveryGateway: gateway });
    await act(async () => harness.hook().refresh());

    expect(harness.hook().isLoading).toBe(false);
    expect(harness.hook().truncated).toBe(true);
    expect(vi.mocked(gateway.readTextFileBounded).mock.calls.length).toBeLessThan(40);
    harness.unmount();
  });

  it("ignores an older discovery failure after a newer refresh succeeds", async () => {
    const oldEnumeration = deferred<{
      files: readonly string[];
      truncated: boolean;
      visited: number;
    }>();
    const enumerateJsTestFiles = vi
      .fn<WorkspaceTestDiscoveryGateway["enumerateJsTestFiles"]>()
      .mockImplementationOnce(() => oldEnumeration.promise)
      .mockResolvedValueOnce({ files: ["fresh.test.ts"], truncated: false, visited: 1 });
    const harness = renderExplorer({
      discoveryGateway: discovery({ enumerateJsTestFiles }),
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(1));
    await act(async () => harness.hook().refresh());
    expect(harness.hook().tree?.children[0]?.filePath).toBe("fresh.test.ts");

    await act(async () => oldEnumeration.reject(new Error("stale failure")));
    expect(harness.hook().error).toBeNull();
    expect(harness.hook().isLoading).toBe(false);
    harness.unmount();
  });

  it("coalesces discovery invalidations, refreshes only while open, and never auto-runs", async () => {
    const enumerateJsTestFiles = vi.fn(async () => ({
      files: ["a.test.ts"],
      truncated: false,
      visited: 1,
    }));
    const run = vi.fn<JsTestGateway["run"]>();
    const harness = renderExplorer({
      discoveryGateway: discovery({ enumerateJsTestFiles }),
      runGateway: { run },
    });
    harness.set({ isOpen: true });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(1));

    harness.set({ discoveryVersion: 1 });
    harness.set({ discoveryVersion: 2 });
    harness.set({ discoveryVersion: 3 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(2));
    expect(run).not.toHaveBeenCalled();

    harness.set({ isOpen: false, discoveryVersion: 4 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(enumerateJsTestFiles).toHaveBeenCalledTimes(2);

    harness.set({ isOpen: true });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(3));
    expect(run).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps an invalidated workspace stale across a switch during the debounce window", async () => {
    const enumerateJsTestFiles = vi.fn(async (rootPath: string) => ({
      files: [rootPath === ROOT_A ? "a.test.ts" : "b.test.ts"],
      truncated: false,
      visited: 1,
    }));
    const harness = renderExplorer({
      discoveryGateway: discovery({ enumerateJsTestFiles }),
      isOpen: true,
    });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(1));

    harness.set({ discoveryVersion: 1 });
    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(enumerateJsTestFiles).toHaveBeenCalledTimes(3));
    expect(enumerateJsTestFiles.mock.calls[enumerateJsTestFiles.mock.calls.length - 1]?.[0]).toBe(
      ROOT_A,
    );
    harness.unmount();
  });
});

interface ExplorerProps {
  continuousRunBlocked: boolean;
  continuousRunVersion: number;
  continuousRunWatchCommand: JsTestWatchCommand | null;
  createTaskRunId: (() => string) | null;
  discoveryVersion: number;
  discoveryGateway: WorkspaceTestDiscoveryGateway;
  isOpen: boolean;
  rootPath: string | null;
  resultInvalidationVersion: number;
  runGateway: JsTestGateway;
  runRequestVersion: number;
  taskGateway: JsTestTaskGateway | null;
  watchGateway: JsTestWatchGateway | null;
  workspaceId: string | null;
  workspaceTrusted: boolean;
}

function renderExplorer(overrides: Partial<ExplorerProps> = {}) {
  const host = document.createElement("div");
  const reactRoot = createRoot(host);
  let props: ExplorerProps = {
    continuousRunBlocked: false,
    continuousRunVersion: 0,
    continuousRunWatchCommand: null,
    discoveryVersion: 0,
    createTaskRunId: (() => {
      let next = 0;
      return () => `task-${++next}`;
    })(),
    discoveryGateway: discovery(),
    isOpen: false,
    rootPath: ROOT_A,
    resultInvalidationVersion: 0,
    runGateway: { run: vi.fn(async () => ok([])) },
    runRequestVersion: 0,
    taskGateway: null,
    watchGateway: null,
    workspaceId: "workspace-a",
    workspaceTrusted: true,
    ...overrides,
  };
  let current: JsTestExplorerState | null = null;
  function Harness() {
    current = useJsTestExplorer(props);
    return null;
  }
  act(() => reactRoot.render(<Harness />));
  return {
    hook: () => {
      if (!current) throw new Error("hook not mounted");
      return current;
    },
    set(next: Partial<ExplorerProps>) {
      props = { ...props, ...next };
      act(() => reactRoot.render(<Harness />));
    },
    unmount: () => act(() => reactRoot.unmount()),
  };
}

function taskEnvelope(
  runId: string,
  response: Awaited<ReturnType<JsTestTaskGateway["runTask"]>>["response"],
  output = emptyTaskOutput(),
  workspaceId = "workspace-a",
) {
  return {
    owner: { runId, workspaceId },
    output,
    response,
  };
}

function emptyTaskOutput() {
  return taskOutput("", "");
}

function taskOutput(stdout: string, stderr: string) {
  return {
    stderr: { text: stderr, truncated: false },
    stdout: { text: stdout, truncated: false },
  };
}

function discovery(
  overrides: Partial<WorkspaceTestDiscoveryGateway> = {},
): WorkspaceTestDiscoveryGateway {
  return {
    enumerateJsTestFiles: vi.fn(async (rootPath) => ({
      files: [rootPath === ROOT_B ? "b.test.ts" : "a.test.ts"],
      truncated: false,
      visited: 1,
    })),
    readTextFileBounded: vi.fn(async () => ({ status: "ok" as const, content: TEST_SOURCE })),
    ...overrides,
  };
}

function ok(cases: ReturnType<typeof runtimeCase>[]): TestRunResponse {
  return {
    status: "ok",
    suites: [
      { name: "suite", tests: cases.length, failures: 0, errors: 0, skipped: 0, time: 0, cases },
    ],
    totals: { tests: cases.length, failures: 0, errors: 0, skipped: 0, time: 0 },
  };
}

function runtimeCase(
  name: string,
  file: string,
  line: number,
  status: "passed" | "failed" | "skipped" | "error",
) {
  return { name, classname: null, file, line, time: 0, status, message: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
