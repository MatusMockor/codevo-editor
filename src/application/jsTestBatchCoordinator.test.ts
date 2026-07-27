import { describe, expect, it, vi } from "vitest";
import type {
  JsTestBatchGateway,
  JsTestBatchRequest,
  JsTestBatchResponse,
} from "../domain/jsTestBatch";
import { createJsTestBatchCoordinator } from "./jsTestBatchCoordinator";

describe("createJsTestBatchCoordinator", () => {
  it("dispatches one immutable batch and publishes only its exact atomic owner response", async () => {
    const pending = deferred<JsTestBatchResponse>();
    let captured: JsTestBatchRequest | null = null;
    const coordinator = createCoordinator({
      runBatch: vi.fn((request) => {
        captured = request;
        return pending.promise;
      }),
      stopBatch: async () => true,
    });
    const running = coordinator.start(request());

    expect(captured).toEqual({
      packages: [
        { packageRootRelativePath: "packages/a" },
        { packageRootRelativePath: "packages/b" },
      ],
      runId: "run-1",
      workspaceId: "workspace-1",
    });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen((captured as JsTestBatchRequest | null)?.packages)).toBe(true);
    pending.resolve(okResponse("run-1"));

    await expect(running).resolves.toMatchObject({
      response: { status: "ok" },
      status: "settled",
    });
    expect(coordinator.canCancel()).toBe(false);
  });

  it("stops the exact batch owner once and rejects success after cancellation", async () => {
    const pending = deferred<JsTestBatchResponse>();
    const stopBatch = vi.fn(async () => true);
    const coordinator = createCoordinator({ runBatch: () => pending.promise, stopBatch });
    const running = coordinator.start(request());

    expect(coordinator.canCancel()).toBe(true);
    await expect(coordinator.cancel()).resolves.toBe(true);
    expect(stopBatch).toHaveBeenCalledExactlyOnceWith({
      runId: "run-1",
      workspaceId: "workspace-1",
    });
    pending.resolve(okResponse("run-1"));
    await expect(running).resolves.toEqual({
      message: "JavaScript test batch returned success after cancellation.",
      status: "error",
    });
  });

  it("fails closed across workspace A to B to A and foreign echoed owners", async () => {
    const pending = deferred<JsTestBatchResponse>();
    let activation = 1;
    const coordinator = createCoordinator(
      { runBatch: () => pending.promise, stopBatch: async () => true },
      (expected) => expected === activation,
    );
    const running = coordinator.start(request());
    activation = 2;
    activation = 3;
    pending.resolve(okResponse("run-1"));
    await expect(running).resolves.toEqual({ status: "stale" });

    const foreign = createCoordinator({
      runBatch: async () => okResponse("foreign"),
      stopBatch: async () => true,
    });
    await expect(foreign.start(request())).resolves.toEqual({
      message: "JavaScript test batch returned an invalid owner.",
      status: "error",
    });
  });

  it("rejects a mutable, overlapping, excessive, or stale package plan before dispatch", async () => {
    const runBatch = vi.fn(async () => okResponse("run-1"));
    const gateway = { runBatch, stopBatch: async () => true };
    const stale = createCoordinator(gateway, () => false);
    await expect(stale.start(request())).resolves.toEqual({ status: "rejected" });

    const invalid = createCoordinator(gateway);
    await expect(
      invalid.start({
        ...request(),
        packages: [
          { packageRootRelativePath: "packages/a" },
          { packageRootRelativePath: "packages/a/nested" },
        ],
      }),
    ).resolves.toMatchObject({ status: "error" });
    expect(runBatch).not.toHaveBeenCalled();
  });
});

function createCoordinator(
  gateway: JsTestBatchGateway,
  isCurrent: (activation: number) => boolean = () => true,
) {
  return createJsTestBatchCoordinator({
    createRunId: () => "run-1",
    gateway,
    isCurrent,
  });
}

function request() {
  return {
    activation: 1,
    packages: Object.freeze([
      Object.freeze({ packageRootRelativePath: "packages/a" }),
      Object.freeze({ packageRootRelativePath: "packages/b" }),
    ]),
    workspaceId: "workspace-1",
  };
}

function okResponse(runId: string): JsTestBatchResponse {
  return Object.freeze({
    owner: Object.freeze({ runId, workspaceId: "workspace-1" }),
    packages: Object.freeze([]),
    status: "ok" as const,
    totals: Object.freeze({ errors: 0, failures: 0, skipped: 0, tests: 0, time: null }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
