import { describe, expect, it, vi } from "vitest";
import type { JsTestRunnableScope } from "../domain/jsTestRunSelection";
import { createJsTestExplorerScopeRunnerBridge } from "./jsTestExplorerScopeRunnerBridge";
import type { JsTestExplorerScopeRunnerPort } from "./useJsTestRunSelectionCommands";

const scope: JsTestRunnableScope = Object.freeze({
  kind: "file",
  relativeFilePath: "src/example.test.ts",
});

describe("createJsTestExplorerScopeRunnerBridge", () => {
  it("fails closed until a runner is bound and after its exact cleanup", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    expect(bridge.runner.canCancelTestRun()).toBe(false);
    expect(bridge.runner.canRerunFailedTests()).toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(false);
    expect(bridge.runner.canRunScope(scope)).toBe(false);
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    await expect(bridge.runner.rerunFailedTests()).resolves.toBe(false);
    await expect(bridge.runner.rerunLastRun()).resolves.toBe(false);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);

    const bound = port({
      canRerunLastRun: vi.fn(() => true),
      canRunScope: vi.fn(() => true),
      rerunLastRun: vi.fn(async () => true),
      runScope: vi.fn(async () => true),
    });
    const unbind = bridge.bind(bound);
    expect(bridge.runner.canRunScope(scope)).toBe(true);
    expect(bridge.runner.canRerunLastRun()).toBe(true);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(true);
    await expect(bridge.runner.rerunLastRun()).resolves.toBe(true);
    unbind();
    expect(bridge.runner.canRunScope(scope)).toBe(false);
  });

  it("does not let stale cleanup remove a replacement runner", () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    const unbindFirst = bridge.bind(port({ canRunScope: () => false }));
    bridge.bind(port());
    unbindFirst();
    expect(bridge.runner.canRunScope(scope)).toBe(true);
  });

  it("rejects reentrancy, exceptions, and publication replacement during a run", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    let finish!: (accepted: boolean) => void;
    bridge.bind(
      port({
        canRunScope: () => true,
        runScope: () => new Promise<boolean>((resolve) => (finish = resolve)),
      }),
    );
    const pending = bridge.runner.runScope(scope);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);
    expect(bridge.runner.canRunScope(scope)).toBe(false);
    bridge.bind(port());
    finish(true);
    await expect(pending).resolves.toBe(false);

    bridge.bind(
      port({
        canRerunLastRun: () => {
          throw new Error("can rerun");
        },
        canRunScope: () => {
          throw new Error("can");
        },
        rerunLastRun: async () => {
          throw new Error("rerun");
        },
        runScope: async () => {
          throw new Error("run");
        },
      }),
    );
    expect(bridge.runner.canRerunLastRun()).toBe(false);
    expect(bridge.runner.canRunScope(scope)).toBe(false);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);

    bridge.bind(
      port({
        canRunScope: () => true,
        runScope: async () => {
          throw new Error("run");
        },
      }),
    );
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);
  });

  it("serializes scope runs and reruns and fences A-B-A publication replacement", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    let finish!: (accepted: boolean) => void;
    const first = port({
      rerunLastRun: () => new Promise<boolean>((resolve) => (finish = resolve)),
    });
    const unbindFirst = bridge.bind(first);

    const pending = bridge.runner.rerunLastRun();
    expect(bridge.runner.canRunScope(scope)).toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(false);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);
    const unbindSecond = bridge.bind(port());
    unbindSecond();
    bridge.bind(first);
    unbindFirst();
    finish(true);

    await expect(pending).resolves.toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(true);
  });

  it("allows one exact cancel only during an active failed rerun", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    let finishRun!: (accepted: boolean) => void;
    let finishCancel!: (accepted: boolean) => void;
    const cancelTestRun = vi.fn(() => new Promise<boolean>((resolve) => (finishCancel = resolve)));
    bridge.bind(
      port({
        cancelTestRun,
        rerunFailedTests: () => new Promise<boolean>((resolve) => (finishRun = resolve)),
      }),
    );

    expect(bridge.runner.canCancelTestRun()).toBe(false);
    const failed = bridge.runner.rerunFailedTests();
    expect(bridge.runner.canCancelTestRun()).toBe(true);
    expect(bridge.runner.canRerunFailedTests()).toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(false);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);

    const cancelling = bridge.runner.cancelTestRun();
    expect(bridge.runner.canCancelTestRun()).toBe(false);
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    expect(cancelTestRun).toHaveBeenCalledOnce();
    await expect(bridge.runner.rerunFailedTests()).resolves.toBe(false);

    finishCancel(true);
    await expect(cancelling).resolves.toBe(true);
    finishRun(false);
    await expect(failed).resolves.toBe(false);
    expect(bridge.runner.canCancelTestRun()).toBe(false);
  });

  it("keeps start admission closed until a pending cancel settles", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    let finishRun!: (accepted: boolean) => void;
    let finishCancel!: (accepted: boolean) => void;
    bridge.bind(
      port({
        cancelTestRun: () =>
          new Promise<boolean>((resolve) => {
            finishCancel = resolve;
          }),
        rerunFailedTests: () =>
          new Promise<boolean>((resolve) => {
            finishRun = resolve;
          }),
      }),
    );

    const failed = bridge.runner.rerunFailedTests();
    const cancelling = bridge.runner.cancelTestRun();
    finishRun(false);
    await expect(failed).resolves.toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(false);
    await expect(bridge.runner.rerunLastRun()).resolves.toBe(false);
    await expect(bridge.runner.runScope(scope)).resolves.toBe(false);

    finishCancel(true);
    await expect(cancelling).resolves.toBe(false);
    expect(bridge.runner.canRerunLastRun()).toBe(true);
  });

  it("never exposes cancel for ordinary starts and fences stale failed publications", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    let finishFailed!: (accepted: boolean) => void;
    const first = port({
      rerunFailedTests: () => new Promise<boolean>((resolve) => (finishFailed = resolve)),
    });
    const unbindFirst = bridge.bind(first);

    const ordinary = bridge.runner.rerunLastRun();
    expect(bridge.runner.canCancelTestRun()).toBe(false);
    await ordinary;

    const failed = bridge.runner.rerunFailedTests();
    expect(bridge.runner.canCancelTestRun()).toBe(true);
    const unbindSecond = bridge.bind(port());
    expect(bridge.runner.canCancelTestRun()).toBe(false);
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    unbindSecond();
    bridge.bind(first);
    unbindFirst();
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    finishFailed(true);
    await expect(failed).resolves.toBe(false);
  });

  it("fails closed when failed or cancel capabilities and verbs throw", async () => {
    const bridge = createJsTestExplorerScopeRunnerBridge();
    bridge.bind(
      port({
        canRerunFailedTests: () => {
          throw new Error("can failed");
        },
      }),
    );
    expect(bridge.runner.canRerunFailedTests()).toBe(false);
    await expect(bridge.runner.rerunFailedTests()).resolves.toBe(false);

    let finish!: (accepted: boolean) => void;
    bridge.bind(
      port({
        canCancelTestRun: () => {
          throw new Error("can cancel");
        },
        rerunFailedTests: () => new Promise<boolean>((resolve) => (finish = resolve)),
      }),
    );
    const failed = bridge.runner.rerunFailedTests();
    expect(bridge.runner.canCancelTestRun()).toBe(false);
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    finish(false);
    await failed;

    bridge.bind(
      port({
        cancelTestRun: async () => {
          throw new Error("cancel");
        },
        rerunFailedTests: () => new Promise<boolean>((resolve) => (finish = resolve)),
      }),
    );
    const failing = bridge.runner.rerunFailedTests();
    await expect(bridge.runner.cancelTestRun()).resolves.toBe(false);
    finish(false);
    await failing;
  });
});

function port(
  overrides: Partial<JsTestExplorerScopeRunnerPort> = {},
): JsTestExplorerScopeRunnerPort {
  return {
    canCancelTestRun: () => true,
    canRerunFailedTests: () => true,
    canRerunLastRun: () => true,
    canRunScope: () => true,
    cancelTestRun: async () => true,
    rerunFailedTests: async () => true,
    rerunLastRun: async () => true,
    runScope: async () => true,
    ...overrides,
  };
}
