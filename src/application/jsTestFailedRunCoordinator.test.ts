import { describe, expect, it, vi } from "vitest";
import {
  createJsTestFailedRunCoordinator,
  type JsTestFailedRunRequest,
} from "./jsTestFailedRunCoordinator";
import type { JsTestFailedRunScope } from "../domain/jsTestFailedRunScopes";
import type {
  JsTestTaskGateway,
  JsTestTaskRunRequest,
  JsTestTaskRunResponse,
} from "../domain/jsTestTask";
import type { TestRunOk } from "../domain/testResults";

describe("createJsTestFailedRunCoordinator", () => {
  it("runs an exact owner-bound plan sequentially and publishes a frozen ordered clone", async () => {
    const first = deferred<JsTestTaskRunResponse>();
    const calls: JsTestTaskRunRequest[] = [];
    const responses = [first.promise, Promise.resolve(envelope("run-2", ok("second")))];
    const gateway = taskGateway({
      runTask: vi.fn((request) => {
        calls.push(request);
        return responses[calls.length - 1]!;
      }),
    });
    const coordinator = createCoordinator(gateway);
    const request = batchRequest([scope("b"), scope("a")]);
    const running = coordinator.start(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      packageRootRelativePath: "",
      runId: "run-1",
      scope: scope("b"),
      workspaceId: "workspace-1",
    });
    expect(coordinator.snapshot()).toEqual({ completed: 0, phase: "running", total: 2 });
    first.resolve(envelope("run-1", ok("first")));
    const outcome = await running;

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      packageRootRelativePath: "",
      runId: "run-2",
      scope: scope("a"),
      workspaceId: "workspace-1",
    });
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("expected success");
    expect(outcome.results.map(({ scope: resultScope }) => resultScope.fullName)).toEqual([
      "b",
      "a",
    ]);
    expect(outcome.results.map(({ response }) => response.suites[0]?.name)).toEqual([
      "first",
      "second",
    ]);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.results)).toBe(true);
    expect(outcome.results.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(outcome.results[0]!.scope)).toBe(true);
    expect(Object.isFrozen(outcome.results[0]!.response.suites[0]!.cases[0])).toBe(true);
    expect(outcome.results[0]!.scope).not.toBe(request.plan.scopes[0]);
    expect(coordinator.snapshot()).toEqual({ completed: 0, phase: "idle", total: 0 });
  });

  it("retains the exact package authority while keeping it out of the scoped wire payload", async () => {
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(async (request) =>
      envelope(request.runId, ok("nested")),
    );
    const coordinator = createCoordinator(taskGateway({ runTask }));
    const nestedScope = Object.freeze({
      ...scope("nested"),
      packageRootRelativePath: "packages/vitest-app",
    });

    await expect(coordinator.start(batchRequest([nestedScope]))).resolves.toMatchObject({
      status: "success",
    });

    expect(runTask).toHaveBeenCalledExactlyOnceWith({
      packageRootRelativePath: "packages/vitest-app",
      runId: "run-1",
      scope: scope("nested"),
      workspaceId: "workspace-1",
    });
  });

  it("is single-flight and rejects malformed, empty, stale, or mutable requests", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    let current = true;
    const gateway = taskGateway({ runTask: () => pending.promise });
    const coordinator = createCoordinator(gateway, { isCurrent: () => current });
    const valid = batchRequest([scope("one")]);
    const running = coordinator.start(valid);

    expect(coordinator.canStart(valid)).toBe(false);
    await expect(coordinator.start(valid)).resolves.toEqual({ status: "rejected" });
    current = false;
    const stale = createCoordinator(taskGateway(), { isCurrent: () => false });
    expect(stale.canStart(valid)).toBe(false);
    await expect(stale.start(valid)).resolves.toEqual({ status: "rejected" });

    const empty = batchRequest([]);
    expect(createCoordinator(taskGateway()).canStart(empty)).toBe(false);
    const mutable = {
      ...valid,
      plan: { scopes: [scope("one")], status: "available" as const, unresolved: 0 as const },
    };
    expect(createCoordinator(taskGateway()).canStart(mutable)).toBe(false);

    pending.resolve(envelope("run-1", ok()));
    await expect(running).resolves.toEqual({ status: "stale" });
  });

  it("publishes the active child before dispatch so cancel-before-first-await is owner exact", async () => {
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(
      taskGateway({
        runTask: vi.fn((request) => {
          expect(coordinator.canCancel()).toBe(true);
          expect(coordinator.snapshot().phase).toBe("running");
          void coordinator.cancel();
          return Promise.resolve(envelope(request.runId, ok()));
        }),
        stopTask,
      }),
    );

    await expect(coordinator.start(batchRequest([scope("one")]))).resolves.toEqual({
      outputs: [emptyTaskOutput()],
      status: "cancelled",
    });
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-1",
    });
  });

  it("cancels child 1/N, never dispatches the next child, and ignores late natural success", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    const runTask = vi.fn(() => pending.promise);
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(taskGateway({ runTask, stopTask }));
    const running = coordinator.start(batchRequest([scope("one"), scope("two")]));

    expect(coordinator.canCancel()).toBe(true);
    await expect(coordinator.cancel()).resolves.toBe(true);
    expect(coordinator.snapshot().phase).toBe("cancelling");
    pending.resolve(envelope("run-1", ok(), taskOutput("partial stdout", "partial stderr")));

    await expect(running).resolves.toEqual({
      outputs: [taskOutput("partial stdout", "partial stderr")],
      status: "cancelled",
    });
    expect(runTask).toHaveBeenCalledOnce();
    expect(coordinator.canCancel()).toBe(false);
  });

  it("cancels child N after retaining no externally visible partial success", async () => {
    const last = deferred<JsTestTaskRunResponse>();
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(envelope("run-1", ok("first")))
      .mockImplementationOnce(() => last.promise);
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(taskGateway({ runTask, stopTask }));
    const running = coordinator.start(batchRequest([scope("one"), scope("two")]));
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2));

    expect(coordinator.snapshot()).toEqual({ completed: 1, phase: "running", total: 2 });
    await expect(coordinator.cancel()).resolves.toBe(true);
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-2",
      workspaceId: "workspace-1",
    });
    last.resolve(envelope("run-2", ok("second")));

    await expect(running).resolves.toEqual({
      outputs: [emptyTaskOutput(), emptyTaskOutput()],
      status: "cancelled",
    });
  });

  it("serializes stop calls and permits retry after false or throw while the child lives", async () => {
    const run = deferred<JsTestTaskRunResponse>();
    const firstStop = deferred<boolean>();
    const stopTask = vi
      .fn<JsTestTaskGateway["stopTask"]>()
      .mockImplementationOnce(() => firstStop.promise)
      .mockRejectedValueOnce(new Error("stop failed"))
      .mockResolvedValueOnce(true);
    const coordinator = createCoordinator(taskGateway({ runTask: () => run.promise, stopTask }));
    const running = coordinator.start(batchRequest([scope("one")]));

    const cancelOne = coordinator.cancel();
    const cancelTwo = coordinator.cancel();
    expect(stopTask).toHaveBeenCalledOnce();
    firstStop.resolve(false);
    await expect(cancelOne).resolves.toBe(false);
    await expect(cancelTwo).resolves.toBe(false);
    await expect(coordinator.cancel()).resolves.toBe(false);
    await expect(coordinator.cancel()).resolves.toBe(true);
    expect(stopTask).toHaveBeenCalledTimes(3);

    run.resolve(envelope("run-1", { status: "cancelled" }));
    await expect(running).resolves.toEqual({
      outputs: [emptyTaskOutput()],
      status: "cancelled",
    });
  });

  it("invalidates and automatically stops the exact current owner", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(
      taskGateway({ runTask: () => pending.promise, stopTask }),
    );
    const running = coordinator.start(batchRequest([scope("one")]));

    await expect(coordinator.invalidate()).resolves.toBe(true);
    expect(coordinator.snapshot().phase).toBe("invalidating");
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-1",
    });
    pending.resolve(envelope("run-1", ok()));
    await expect(running).resolves.toEqual({ status: "stale" });
  });

  it("fences owner activation A-B-A after an await", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    let activation = 1;
    const coordinator = createCoordinator(taskGateway({ runTask: () => pending.promise }), {
      isCurrent: (expected) => expected === activation,
    });
    const running = coordinator.start(batchRequest([scope("one")]));
    activation = 2;
    activation = 3;
    pending.resolve(envelope("run-1", ok()));

    await expect(running).resolves.toEqual({ status: "stale" });
  });

  it.each([
    ["error", { message: "failed", status: "error" } as const],
    ["unavailable", { message: "missing", status: "unavailable" } as const],
    ["cancelled", { status: "cancelled" } as const],
  ])("stops the batch without results on a %s child response", async (status, response) => {
    const runTask = vi.fn(async (request: JsTestTaskRunRequest) =>
      envelope(request.runId, response),
    );
    const coordinator = createCoordinator(taskGateway({ runTask }));

    await expect(
      coordinator.start(batchRequest([scope("one"), scope("two")])),
    ).resolves.toMatchObject({
      status,
    });
    expect(runTask).toHaveBeenCalledOnce();
  });

  it("publishes no partial child results when a later child is non-ok", async () => {
    const runTask = vi
      .fn<JsTestTaskGateway["runTask"]>()
      .mockResolvedValueOnce(envelope("run-1", ok("first")))
      .mockResolvedValueOnce(envelope("run-2", { message: "second failed", status: "error" }));
    const coordinator = createCoordinator(taskGateway({ runTask }));

    const outcome = await coordinator.start(batchRequest([scope("one"), scope("two")]));

    expect(outcome).toMatchObject({ message: "second failed", status: "error" });
    expect("results" in outcome).toBe(false);
  });

  it("fails closed for gateway throws, malformed echoed IDs, and malformed or duplicate factory IDs", async () => {
    const throwing = createCoordinator(
      taskGateway({ runTask: async () => Promise.reject(new Error("run")) }),
    );
    await expect(throwing.start(batchRequest([scope("one")]))).resolves.toMatchObject({
      message: "run",
      status: "error",
    });

    const wrongEcho = createCoordinator(
      taskGateway({ runTask: async () => envelope("other", ok()) }),
    );
    await expect(wrongEcho.start(batchRequest([scope("one")]))).resolves.toMatchObject({
      status: "error",
    });

    const malformed = createCoordinator(taskGateway(), { createRunId: () => "\n" });
    await expect(malformed.start(batchRequest([scope("one")]))).resolves.toMatchObject({
      status: "error",
    });

    const duplicate = createCoordinator(taskGateway(), { createRunId: () => "same" });
    await expect(
      duplicate.start(batchRequest([scope("one"), scope("two")])),
    ).resolves.toMatchObject({ status: "error" });
  });

  it("bounds and removes controls from published failure messages", async () => {
    const coordinator = createCoordinator(
      taskGateway({
        runTask: async (request) =>
          envelope(request.runId, {
            message: `bad\n${"ž".repeat(3_000)}`,
            status: "unavailable",
          }),
      }),
    );

    const outcome = await coordinator.start(batchRequest([scope("one")]));

    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("expected unavailable");
    expect(outcome.message).not.toMatch(/\n/);
    expect(new TextEncoder().encode(outcome.message).byteLength).toBeLessThanOrEqual(4_096);
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it("executes the exact 256-child boundary sequentially with unique bounded owners", async () => {
    const runTask = vi.fn(async (request: JsTestTaskRunRequest) =>
      envelope(request.runId, ok(request.scope.kind === "test" ? request.scope.fullName : "")),
    );
    const coordinator = createCoordinator(taskGateway({ runTask }));
    const scopes = Array.from({ length: 256 }, (_, index) => scope(`test ${index}`));
    const outcome = await coordinator.start(batchRequest(scopes));

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("expected success");
    expect(outcome.results).toHaveLength(256);
    expect(runTask).toHaveBeenCalledTimes(256);
    expect(new Set(runTask.mock.calls.map(([request]) => request.runId))).toHaveLength(256);
  });
});

function createCoordinator(
  gateway: JsTestTaskGateway,
  overrides: Partial<{
    createRunId: () => string;
    isCurrent: (activation: number, workspaceId: string) => boolean;
  }> = {},
) {
  let nextId = 0;
  return createJsTestFailedRunCoordinator({
    createRunId: () => `run-${++nextId}`,
    gateway,
    isCurrent: (activation, workspaceId) => activation === 1 && workspaceId === "workspace-1",
    ...overrides,
  });
}

function taskGateway(overrides: Partial<JsTestTaskGateway> = {}): JsTestTaskGateway {
  return {
    runTask: async (request) => envelope(request.runId, ok()),
    stopTask: async () => true,
    ...overrides,
  };
}

function batchRequest(scopes: readonly JsTestFailedRunScope[]): JsTestFailedRunRequest {
  const frozenScopes = Object.freeze(scopes.map((item) => Object.freeze({ ...item })));
  return Object.freeze({
    activation: 1,
    plan: Object.freeze({
      scopes: frozenScopes,
      status: "available" as const,
      unresolved: 0 as const,
    }),
    workspaceId: "workspace-1",
  });
}

function scope(fullName: string): JsTestFailedRunScope {
  return Object.freeze({
    fullName,
    kind: "test",
    relativeFilePath: "a.test.ts",
  });
}

function envelope(
  runId: string,
  response: JsTestTaskRunResponse["response"],
  output = emptyTaskOutput(),
): JsTestTaskRunResponse {
  return {
    owner: { runId, workspaceId: "workspace-1" },
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

function ok(name = "suite"): TestRunOk {
  return {
    status: "ok",
    suites: [
      {
        cases: [
          {
            classname: null,
            file: "a.test.ts",
            line: 1,
            message: null,
            name: `${name} works`,
            status: "passed",
            time: 0,
          },
        ],
        errors: 0,
        failures: 0,
        name,
        skipped: 0,
        tests: 1,
        time: 0,
      },
    ],
    totals: { errors: 0, failures: 0, skipped: 0, tests: 1, time: 0 },
  };
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
