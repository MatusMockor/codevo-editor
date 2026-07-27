// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import { waitForReact } from "../test/reactTestLifecycle";
import { VSCODE_TASKS_EMPTY_CONFIG_REVISION } from "./configureVscodeProcessTasks";
import {
  useWorkbenchVscodeProcessTasks,
  vscodeProcessTasksConfigurationAction,
} from "./useWorkbenchVscodeProcessTasks";

describe("vscodeProcessTasksConfigurationAction", () => {
  it("offers create only for the closed empty-revision warning state", () => {
    expect(
      vscodeProcessTasksConfigurationAction(VSCODE_TASKS_EMPTY_CONFIG_REVISION, [
        { severity: "warning", message: "localized or changed presentation text" },
      ]),
    ).toBe("create");

    expect(
      vscodeProcessTasksConfigurationAction(VSCODE_TASKS_EMPTY_CONFIG_REVISION, [
        { severity: "error", message: "No .vscode/tasks.json file was found." },
      ]),
    ).toBe("open");
    expect(
      vscodeProcessTasksConfigurationAction("sha256:present", [
        { severity: "warning", message: "No .vscode/tasks.json file was found." },
      ]),
    ).toBe("open");
  });

  it("opens present, malformed, or empty configurations", () => {
    expect(vscodeProcessTasksConfigurationAction("sha256:present", [])).toBe("open");
    expect(
      vscodeProcessTasksConfigurationAction("sha256:present", [
        { severity: "error", message: "tasks must be an array" },
      ]),
    ).toBe("open");
  });
});

describe("useWorkbenchVscodeProcessTasks configuration lifecycle", () => {
  it("creates only from the semantic missing state and rediscovers after success", async () => {
    const configureTasks = vi.fn(async () => true);
    const harness = renderHook(configureTasks);
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));

    await act(async () => expect(await harness.hook().state.configure()).toBe(true));

    expect(configureTasks).toHaveBeenCalledExactlyOnceWith("create");
    expect(harness.discover).toHaveBeenCalledTimes(2);
    expect(harness.hook().state.configuring).toBe(false);
    harness.unmount();
  });

  it("ignores late configuration settlement after the workspace owner changes", async () => {
    const pending = deferred<boolean>();
    const configureTasks = vi.fn(() => pending.promise);
    const harness = renderHook(configureTasks);
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));

    let result!: Promise<boolean>;
    act(() => {
      result = harness.hook().state.configure();
    });
    await waitForReact(() => expect(harness.hook().state.configuring).toBe(true));
    harness.rerender("/workspace/b", "workspace-b");
    act(() => pending.resolve(true));

    await expect(result).resolves.toBe(false);
    expect(harness.hook().state.configuring).toBe(false);
    harness.unmount();
  });

  it("rejects success and failure after trust revocation, including true-false-true", async () => {
    const staleSuccess = deferred<boolean>();
    const successHarness = renderHook(vi.fn(() => staleSuccess.promise));
    await waitForReact(() =>
      expect(successHarness.hook().state.configurationAction).toBe("create"),
    );
    let success!: Promise<boolean>;
    act(() => {
      success = successHarness.hook().state.configure();
    });
    successHarness.rerender("/workspace/a", "workspace-a", false);
    successHarness.rerender("/workspace/a", "workspace-a", true);
    act(() => staleSuccess.resolve(true));
    await expect(success).resolves.toBe(false);
    expect(successHarness.hook().state.error).toBeNull();
    successHarness.unmount();

    const staleFailure = deferred<boolean>();
    const failureHarness = renderHook(vi.fn(() => staleFailure.promise));
    await waitForReact(() =>
      expect(failureHarness.hook().state.configurationAction).toBe("create"),
    );
    let failure!: Promise<boolean>;
    act(() => {
      failure = failureHarness.hook().state.configure();
    });
    failureHarness.rerender("/workspace/a", "workspace-a", false);
    act(() => staleFailure.reject(new Error("stale failure")));
    await expect(failure).resolves.toBe(false);
    expect(failureHarness.hook().state.error).toBeNull();
    failureHarness.unmount();
  });

  it("rejects an A-B-A completion even when the owner key becomes equal again", async () => {
    const pending = deferred<boolean>();
    const harness = renderHook(vi.fn(() => pending.promise));
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));
    let result!: Promise<boolean>;
    act(() => {
      result = harness.hook().state.configure();
    });

    harness.rerender("/workspace/b", "workspace-b");
    harness.rerender("/workspace/a", "workspace-a");
    act(() => pending.resolve(true));

    await expect(result).resolves.toBe(false);
    expect(harness.hook().state.error).toBeNull();
    harness.unmount();
  });

  it("admits only one same-tick configure side effect", async () => {
    const pending = deferred<boolean>();
    const configureTasks = vi.fn(() => pending.promise);
    const harness = renderHook(configureTasks);
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = harness.hook().state.configure();
      duplicate = harness.hook().state.configure();
    });

    await expect(duplicate).resolves.toBe(false);
    expect(configureTasks).toHaveBeenCalledOnce();
    act(() => pending.resolve(true));
    await expect(first).resolves.toBe(true);
    harness.unmount();
  });

  it("does not publish after unmount", async () => {
    const pending = deferred<boolean>();
    const harness = renderHook(vi.fn(() => pending.promise));
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));
    let result!: Promise<boolean>;
    act(() => {
      result = harness.hook().state.configure();
    });

    harness.unmount();
    act(() => pending.resolve(true));

    await expect(result).resolves.toBe(false);
  });

  it("remains live after StrictMode effect replay and fences the final unmount", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const configureTasks = vi
      .fn<(action: "create" | "open") => Promise<boolean>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const harness = renderHook(configureTasks, true);
    await waitForReact(() => expect(harness.hook().state.configurationAction).toBe("create"));
    let firstResult!: Promise<boolean>;
    act(() => {
      firstResult = harness.hook().state.configure();
    });
    await act(async () => {
      first.resolve(true);
      await expect(firstResult).resolves.toBe(true);
    });
    expect(harness.hook().state.configuring).toBe(false);

    let secondResult!: Promise<boolean>;
    act(() => {
      secondResult = harness.hook().state.configure();
    });
    harness.unmount();
    second.resolve(true);
    await expect(secondResult).resolves.toBe(false);
  });
});

function renderHook(
  configureTasks: (action: "create" | "open") => Promise<boolean>,
  strictMode = false,
) {
  const host = document.createElement("div");
  const root: Root = createRoot(host);
  const discover = vi.fn(async () => ({
    configRevision: VSCODE_TASKS_EMPTY_CONFIG_REVISION,
    diagnostics: [{ severity: "warning" as const, message: "presentation is irrelevant" }],
    tasks: [],
    truncated: false,
  }));
  const gateway: VscodeProcessTasksGateway = {
    acknowledgeVscodeProcessTaskStart: vi.fn(async () => undefined),
    discoverVscodeProcessTasks: discover,
    startVscodeProcessTask: vi.fn(async (owner) => owner),
    stopVscodeProcessTask: vi.fn(async () => undefined),
    subscribeVscodeProcessTaskEvents: vi.fn(async () => () => undefined),
  };
  let current: ReturnType<typeof useWorkbenchVscodeProcessTasks> | null = null;

  function Hook({
    configurationVersion,
    rootPath,
    workspaceId,
    workspaceTrusted,
  }: {
    readonly configurationVersion: number;
    readonly rootPath: string;
    readonly workspaceId: string;
    readonly workspaceTrusted: boolean;
  }) {
    current = useWorkbenchVscodeProcessTasks({
      configurationVersion,
      configureTasks,
      gateway,
      requestTerminalSession: () => undefined,
      rootPath,
      setNotices: vi.fn(),
      workspaceId,
      workspaceTrusted,
    });
    return null;
  }

  const render = (
    rootPath: string,
    workspaceId: string,
    workspaceTrusted = true,
    configurationVersion = 1,
  ) => {
    const hook = createElement(Hook, {
      configurationVersion,
      rootPath,
      workspaceId,
      workspaceTrusted,
    });
    act(() => root.render(strictMode ? createElement(StrictMode, null, hook) : hook));
  };
  render("/workspace/a", "workspace-a");
  return {
    discover,
    hook: () => {
      if (!current) throw new Error("Hook has not rendered.");
      return current;
    },
    rerender: render,
    unmount: () => act(() => root.unmount()),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
