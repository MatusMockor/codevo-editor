// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { JsTestRunnableScope } from "../domain/jsTestRunSelection";
import {
  useJsTestExplorerScopeRunnerPort,
  type JsTestExplorerScopeLifecycle,
} from "./useJsTestExplorerScopeRunnerPort";

const FILE_SCOPE: JsTestRunnableScope = {
  kind: "file",
  relativeFilePath: "src/example.test.ts",
};

describe("useJsTestExplorerScopeRunnerPort", () => {
  it("stays stable while delegating to the latest Explorer lifecycle", async () => {
    const first = lifecycle({
      canCancelTestRun: vi.fn(() => true),
      canRerunFailedTests: vi.fn(() => true),
      canRerunLastRun: vi.fn(() => true),
      canRunScope: vi.fn(() => true),
      cancelTestRun: vi.fn(async () => true),
      rerunFailedTests: vi.fn(async () => true),
      rerunLastRun: vi.fn(async () => true),
      runScope: vi.fn(async () => true),
    });
    const second = lifecycle({
      canCancelTestRun: vi.fn(() => false),
      canRerunFailedTests: vi.fn(() => false),
      canRerunLastRun: vi.fn(() => false),
      canRunScope: vi.fn(() => false),
      cancelTestRun: vi.fn(async () => false),
      rerunFailedTests: vi.fn(async () => false),
      rerunLastRun: vi.fn(async () => false),
      runScope: vi.fn(async () => false),
    });
    const harness = renderPort(first);
    const port = harness.port();

    expect(port.canCancelTestRun()).toBe(true);
    expect(port.canRerunFailedTests()).toBe(true);
    expect(port.canRunScope(FILE_SCOPE)).toBe(true);
    expect(port.canRerunLastRun()).toBe(true);
    await expect(port.cancelTestRun()).resolves.toBe(true);
    await expect(port.rerunFailedTests()).resolves.toBe(true);
    await expect(port.runScope(FILE_SCOPE)).resolves.toBe(true);
    await expect(port.rerunLastRun()).resolves.toBe(true);
    expect(first.runScope).toHaveBeenCalledExactlyOnceWith(FILE_SCOPE);

    harness.render(second);
    expect(harness.port()).toBe(port);
    expect(port.canCancelTestRun()).toBe(false);
    expect(port.canRerunFailedTests()).toBe(false);
    expect(port.canRunScope(FILE_SCOPE)).toBe(false);
    expect(port.canRerunLastRun()).toBe(false);
    await expect(port.runScope(FILE_SCOPE)).resolves.toBe(false);
    await expect(port.rerunLastRun()).resolves.toBe(false);
    expect(second.runScope).toHaveBeenCalledExactlyOnceWith(FILE_SCOPE);
    harness.unmount();
  });

  it("fails closed across synchronous and asynchronous lifecycle failures", async () => {
    const harness = renderPort(
      lifecycle({
        canCancelTestRun: () => {
          throw new Error("can cancel");
        },
        canRerunFailedTests: () => {
          throw new Error("can failed");
        },
        canRerunLastRun: () => {
          throw new Error("can rerun");
        },
        canRunScope: () => {
          throw new Error("can");
        },
        cancelTestRun: async () => Promise.reject(new Error("cancel")),
        rerunFailedTests: async () => Promise.reject(new Error("failed")),
        rerunLastRun: async () => Promise.reject(new Error("rerun")),
        runScope: async () => Promise.reject(new Error("run")),
      }),
    );

    expect(harness.port().canCancelTestRun()).toBe(false);
    expect(harness.port().canRerunFailedTests()).toBe(false);
    expect(harness.port().canRerunLastRun()).toBe(false);
    expect(harness.port().canRunScope(FILE_SCOPE)).toBe(false);
    await expect(harness.port().cancelTestRun()).resolves.toBe(false);
    await expect(harness.port().rerunFailedTests()).resolves.toBe(false);
    await expect(harness.port().rerunLastRun()).resolves.toBe(false);
    await expect(harness.port().runScope(FILE_SCOPE)).resolves.toBe(false);
    harness.unmount();
  });

  it("rejects a lifecycle result that settles after unmount", async () => {
    let resolve!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((next) => {
      resolve = next;
    });
    const harness = renderPort(
      lifecycle({
        canRerunLastRun: () => true,
        canRunScope: () => true,
        rerunLastRun: () => pending,
        runScope: () => pending,
      }),
    );
    const running = harness.port().rerunLastRun();

    harness.unmount();
    resolve(true);
    await expect(running).resolves.toBe(false);
    expect(harness.port().canRerunLastRun()).toBe(false);
    expect(harness.port().canRunScope(FILE_SCOPE)).toBe(false);
  });

  it("rejects a lifecycle result that settles after lifecycle replacement", async () => {
    let resolve!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((next) => {
      resolve = next;
    });
    const harness = renderPort(
      lifecycle({
        canRerunLastRun: () => true,
        canRunScope: () => true,
        rerunLastRun: () => pending,
        runScope: () => pending,
      }),
    );
    const rerunning = harness.port().rerunLastRun();
    harness.render(
      lifecycle({
        canRerunLastRun: () => true,
        canRunScope: () => true,
        rerunLastRun: async () => true,
        runScope: async () => true,
      }),
    );
    resolve(true);

    await expect(rerunning).resolves.toBe(false);
    harness.unmount();
  });

  it("fences failed rerun and cancel settlements to the exact lifecycle identity", async () => {
    let resolveFailed!: (accepted: boolean) => void;
    let resolveCancel!: (accepted: boolean) => void;
    const harness = renderPort(
      lifecycle({
        rerunFailedTests: () =>
          new Promise<boolean>((resolve) => {
            resolveFailed = resolve;
          }),
        cancelTestRun: () =>
          new Promise<boolean>((resolve) => {
            resolveCancel = resolve;
          }),
      }),
    );
    const failed = harness.port().rerunFailedTests();
    const cancel = harness.port().cancelTestRun();
    harness.render(lifecycle());
    resolveFailed(true);
    resolveCancel(true);

    await expect(failed).resolves.toBe(false);
    await expect(cancel).resolves.toBe(false);
    harness.unmount();
  });
});

function lifecycle(
  overrides: Partial<JsTestExplorerScopeLifecycle> = {},
): JsTestExplorerScopeLifecycle {
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

function renderPort(initial: JsTestExplorerScopeLifecycle) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let lifecycle = initial;
  let current: ReturnType<typeof useJsTestExplorerScopeRunnerPort> | null = null;
  function Harness() {
    current = useJsTestExplorerScopeRunnerPort(lifecycle);
    return null;
  }
  const render = (next: JsTestExplorerScopeLifecycle) => {
    lifecycle = next;
    act(() => root.render(<Harness />));
  };
  render(initial);
  return {
    port: () => current!,
    render,
    unmount: () => act(() => root.unmount()),
  };
}
