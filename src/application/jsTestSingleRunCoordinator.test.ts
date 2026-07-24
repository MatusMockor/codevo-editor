import { describe, expect, it, vi } from "vitest";
import type {
  JsTestTaskGateway,
  JsTestTaskRunRequest,
  JsTestTaskRunResponse,
} from "../domain/jsTestTask";
import { createJsTestSingleRunCoordinator } from "./jsTestSingleRunCoordinator";

describe("createJsTestSingleRunCoordinator", () => {
  it("dispatches one immutable owner-bound request and accepts its exact echoed owner", async () => {
    const runTask = vi.fn(async (request: JsTestTaskRunRequest) => envelope(request, "done"));
    const coordinator = createCoordinator(gateway({ runTask }));

    const outcome = await coordinator.start(request());

    expect(outcome.status).toBe("settled");
    expect(runTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      scope: { kind: "file", relativeFilePath: "a.test.ts" },
      workspaceId: "workspace-1",
    });
    const dispatched = runTask.mock.calls[0]![0];
    expect("activation" in dispatched).toBe(false);
    expect(Object.isFrozen(dispatched)).toBe(true);
    expect(Object.isFrozen(dispatched.scope)).toBe(true);
    expect(coordinator.canCancel()).toBe(false);
  });

  it("is single-flight and rejects malformed or stale requests without dispatch", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    const runTask = vi.fn<JsTestTaskGateway["runTask"]>(() => pending.promise);
    const coordinator = createCoordinator(gateway({ runTask }));
    const running = coordinator.start(request());

    expect(coordinator.canCancel()).toBe(true);
    await expect(coordinator.start(request())).resolves.toEqual({ status: "rejected" });
    await expect(coordinator.start({ ...request(), workspaceId: "\n" })).resolves.toEqual({
      status: "rejected",
    });
    expect(runTask).toHaveBeenCalledOnce();
    pending.resolve(envelope(runTask.mock.calls[0]![0], "done"));
    await running;

    const stale = createCoordinator(gateway(), { isCurrent: () => false });
    await expect(stale.start(request())).resolves.toEqual({ status: "rejected" });
  });

  it("cancels the exact active owner and retains the backend cancellation output", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(gateway({ runTask: () => pending.promise, stopTask }));
    const running = coordinator.start(request());

    await expect(coordinator.cancel()).resolves.toBe(true);
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-1",
    });
    pending.resolve({
      owner: { runId: "run-1", workspaceId: "workspace-1" },
      output: {
        stderr: { text: "stopped", truncated: false },
        stdout: { text: "partial", truncated: true },
      },
      response: { status: "cancelled" },
    });

    await expect(running).resolves.toMatchObject({
      envelope: {
        output: {
          stderr: { text: "stopped", truncated: false },
          stdout: { text: "partial", truncated: true },
        },
        response: { status: "cancelled" },
      },
      status: "settled",
    });
  });

  it("invalidates the exact owner and fences a late A-B-A settlement", async () => {
    const pending = deferred<JsTestTaskRunResponse>();
    let activation = 1;
    const stopTask = vi.fn(async () => true);
    const coordinator = createCoordinator(gateway({ runTask: () => pending.promise, stopTask }), {
      isCurrent: (expected, workspaceId) =>
        expected === activation && workspaceId === "workspace-1",
    });
    const running = coordinator.start(request());
    activation = 2;
    activation = 3;

    await expect(coordinator.invalidate()).resolves.toBe(false);
    pending.resolve(
      envelope({ runId: "run-1", scope: request().scope, workspaceId: "workspace-1" }, "late"),
    );
    await expect(running).resolves.toEqual({ status: "stale" });
    expect(stopTask).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-1",
    });
  });

  it("fails closed on a mismatched echoed owner and reports only current gateway errors", async () => {
    const wrongOwner = createCoordinator(
      gateway({
        runTask: async (request) => ({
          ...envelope(request, ""),
          owner: { ...request, runId: "other" },
        }),
      }),
    );
    await expect(wrongOwner.start(request())).resolves.toEqual({
      message: "JavaScript test task returned an invalid owner.",
      status: "error",
    });

    const currentError = createCoordinator(
      gateway({ runTask: async () => Promise.reject(new Error("runner failed")) }),
    );
    await expect(currentError.start(request())).resolves.toEqual({
      message: "runner failed",
      status: "error",
    });
  });
});

function createCoordinator(
  taskGateway: JsTestTaskGateway,
  overrides: Partial<{
    isCurrent: (activation: number, workspaceId: string) => boolean;
  }> = {},
) {
  return createJsTestSingleRunCoordinator({
    createRunId: () => "run-1",
    gateway: taskGateway,
    isCurrent: (activation, workspaceId) => activation === 1 && workspaceId === "workspace-1",
    ...overrides,
  });
}

function request() {
  return {
    activation: 1,
    scope: { kind: "file", relativeFilePath: "a.test.ts" } as const,
    workspaceId: "workspace-1",
  };
}

function gateway(overrides: Partial<JsTestTaskGateway> = {}): JsTestTaskGateway {
  return {
    runTask: async (runRequest) => envelope(runRequest, ""),
    stopTask: async () => true,
    ...overrides,
  };
}

function envelope(request: JsTestTaskRunRequest, stdout: string): JsTestTaskRunResponse {
  return {
    owner: { runId: request.runId, workspaceId: request.workspaceId },
    output: {
      stderr: { text: "", truncated: false },
      stdout: { text: stdout, truncated: false },
    },
    response: {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: 0 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
