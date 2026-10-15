// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type WorkspaceSettings,
} from "../../domain/settings";
import type { WorkspaceRuntimeLifecycleGateway } from "../../domain/workspaceRuntimeLifecycle";
import {
  agentDescriptor,
  agentIdentityGateway,
  agentRuntimeLifecycleGateway,
  agentSettingsGateway,
  deferred,
  fakeNativeShutdown,
  flushAgentTurns,
  renderAgentWorkspaceHarness,
  unmountAgentWorkspaceHarnesses,
} from "../../test/agentAppWorkspaceHarness";
import { UNCERTAIN_BACKEND_CLOSE_MESSAGE } from "./agentWorkspaceTabDisposal";
import { AGENT_QUIT_PREPARATION_TIMEOUT_MS } from "./useAgentApplicationShutdown";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

afterEach(() => {
  vi.useRealTimers();
  unmountAgentWorkspaceHarnesses();
});

type Harness = ReturnType<typeof renderAgentWorkspaceHarness>;

async function activate(harness: Harness, path: string) {
  await act(async () => harness.current().transition.activateWorkspaceTab(path));
  await flushAgentTurns();
}

async function closeTab(harness: Harness, path: string) {
  await act(async () => harness.current().close.closeWorkspaceTab(path));
  await flushAgentTurns();
}

function rotatingIdentityGateway() {
  let nextAdmissionToken = 0;
  return agentIdentityGateway({
    openPath: vi.fn(async (path: string) => {
      nextAdmissionToken += 1;
      return agentDescriptor(path === WORKSPACE_A ? "ws-a" : "ws-b", path, nextAdmissionToken);
    }),
  });
}

describe("useAgentCloseLifecycle workspace tabs", () => {
  it("closes a reopened A with its newest admission token after A to B to A", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway();
    const harness = renderAgentWorkspaceHarness({
      identityGateway: rotatingIdentityGateway(),
      runtimeLifecycleGateway,
    });
    await flushAgentTurns();
    for (const path of [WORKSPACE_A, WORKSPACE_B, WORKSPACE_A]) await activate(harness, path);
    expect(harness.current().transition.workspaceIdentityDescriptor).toMatchObject({
      workspaceId: "ws-a",
      admissionToken: 3,
    });

    await closeTab(harness, WORKSPACE_A);

    expect(runtimeLifecycleGateway.disposeRegisteredWorkspace).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "ws-a",
      admissionToken: 3,
      selectedRootPath: WORKSPACE_A,
      canonicalRootPath: WORKSPACE_A,
    });
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_B]);
    expect(
      harness.current().authority.workspaceRuntimeOwnerClaimsRef.current.generationFor("ws-a"),
    ).toBeUndefined();
  });

  it("clears the active workspace when its last tab closes", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway();
    const harness = renderAgentWorkspaceHarness({ runtimeLifecycleGateway });
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);

    await closeTab(harness, WORKSPACE_A);

    expect(harness.current().transition.workspaceRoot).toBeNull();
    expect(harness.current().transition.workspaceTrust).toBeNull();
    expect(harness.current().appSettings.workspaceTabs).toEqual([]);
    expect(runtimeLifecycleGateway.disposeRegisteredWorkspace).toHaveBeenCalledOnce();
    expect(runtimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();
    expect(harness.git.reset).toHaveBeenLastCalledWith(null);
  });

  it("closes an inactive tab without switching away from the active workspace", async () => {
    const harness = renderAgentWorkspaceHarness();
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);
    await activate(harness, WORKSPACE_B);

    await closeTab(harness, WORKSPACE_A);

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_B]);
    expect(harness.current().appSettings.recentWorkspacePath).toBe(WORKSPACE_B);
    expect(
      harness.current().authority.workspaceIdentityByRootRef.current[WORKSPACE_A],
    ).toBeUndefined();
  });

  it("does not continue a pending workspace open after closing its project tab", async () => {
    const settingsA = deferred<WorkspaceSettings>();
    const { gateway } = agentSettingsGateway({
      ...defaultAppSettings(),
      recentWorkspacePath: WORKSPACE_A,
      workspaceTabs: [WORKSPACE_A],
    });
    gateway.loadWorkspaceSettings.mockImplementationOnce(() => settingsA.promise);
    const harness = renderAgentWorkspaceHarness({ settingsGateway: gateway });
    await flushAgentTurns();
    expect(gateway.loadWorkspaceSettings).toHaveBeenCalledOnce();

    await closeTab(harness, WORKSPACE_A);
    expect(harness.current().transition.workspaceRoot).toBeNull();
    expect(harness.current().appSettings.workspaceTabs).toEqual([]);

    await act(async () => settingsA.resolve(defaultWorkspaceSettings()));
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBeNull();
    expect(harness.current().appSettings.workspaceTabs).toEqual([]);
    expect(harness.trustGateway.getTrust).not.toHaveBeenCalled();
    expect(harness.scriptsReader.readDirectoryBounded).not.toHaveBeenCalled();
    expect(harness.identityGateway.rollbackAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-a", admissionToken: 1 }),
    );
  });

  it("keeps an admitted tab whose re-admission is pending and never commits the cancelled open", async () => {
    const settingsA = deferred<WorkspaceSettings>();
    const { gateway } = agentSettingsGateway();
    const harness = renderAgentWorkspaceHarness({ settingsGateway: gateway });
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);
    await activate(harness, WORKSPACE_B);
    gateway.loadWorkspaceSettings.mockImplementationOnce(() => settingsA.promise);

    let reopening: Promise<void> = Promise.resolve();
    act(() => {
      reopening = harness.current().transition.activateWorkspaceTab(WORKSPACE_A);
    });
    await flushAgentTurns();
    await closeTab(harness, WORKSPACE_A);
    await act(async () => {
      settingsA.resolve(defaultWorkspaceSettings());
      await reopening;
    });
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect(harness.runtimeLifecycleGateway.disposeRegisteredWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the tab and reports when the registered runtime close is incomplete", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway({
      disposeRegisteredWorkspace: vi.fn<
        NonNullable<WorkspaceRuntimeLifecycleGateway["disposeRegisteredWorkspace"]>
      >(async () => ({ status: "incomplete", errors: ["terminal still running"] })),
    });
    const harness = renderAgentWorkspaceHarness({ runtimeLifecycleGateway });
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);
    await activate(harness, WORKSPACE_B);

    await closeTab(harness, WORKSPACE_B);

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect(harness.errors).toEqual([
      { source: "Runtime cleanup", error: new Error("terminal still running") },
    ]);
  });

  it("settles the agent project close as not closed when the backend disposal rejects", async () => {
    const complete = vi.fn(async (_outcome: "backend-closed" | "backend-not-closed") => undefined);
    const finalizeBackendClosed = vi.fn();
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway({
      disposeRegisteredWorkspace: vi.fn<
        NonNullable<WorkspaceRuntimeLifecycleGateway["disposeRegisteredWorkspace"]>
      >(async () => {
        throw new Error("reply lost");
      }),
    });
    const harness = renderAgentWorkspaceHarness({
      projects: {
        closeWorkspaceProject: vi.fn(async () => ({
          status: "closed" as const,
          settlement: { complete, finalizeBackendClosed },
        })),
      },
      runtimeLifecycleGateway,
    });
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);

    await closeTab(harness, WORKSPACE_A);

    expect(complete).toHaveBeenCalledExactlyOnceWith("backend-not-closed");
    expect(finalizeBackendClosed).not.toHaveBeenCalled();
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_A]);
    expect(harness.errors).toEqual([
      {
        source: "Runtime cleanup",
        error: new Error(`${UNCERTAIN_BACKEND_CLOSE_MESSAGE} reply lost`),
      },
    ]);
  });

  it("runs the agent project close before the backend disposal and completes it", async () => {
    const order: string[] = [];
    const complete = vi.fn(async (outcome: "backend-closed" | "backend-not-closed") => {
      order.push(`complete:${outcome}`);
    });
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway({
      disposeRegisteredWorkspace: vi.fn<
        NonNullable<WorkspaceRuntimeLifecycleGateway["disposeRegisteredWorkspace"]>
      >(async () => {
        order.push("dispose");
        return { status: "closed" };
      }),
    });
    const harness = renderAgentWorkspaceHarness({
      projects: {
        closeWorkspaceProject: vi.fn(async () => {
          order.push("agents");
          return {
            status: "closed" as const,
            settlement: { complete, finalizeBackendClosed: vi.fn() },
          };
        }),
      },
      runtimeLifecycleGateway,
    });
    await flushAgentTurns();
    await activate(harness, WORKSPACE_A);

    await closeTab(harness, WORKSPACE_A);

    expect(order).toEqual(["agents", "dispose", "complete:backend-closed"]);
  });
});

describe("useAgentCloseLifecycle application shutdown", () => {
  it("quits after the agent turn flush settles within the budget", async () => {
    const flush = deferred<void>();
    const prepareAgentQuit = vi.fn(() => flush.promise);
    const nativeShutdown = fakeNativeShutdown();
    const harness = renderAgentWorkspaceHarness({ nativeShutdown, prepareAgentQuit });
    await flushAgentTurns();

    act(() => harness.current().close.quitApplication());
    await flushAgentTurns();
    expect(prepareAgentQuit).toHaveBeenCalledExactlyOnceWith(1_500);
    expect(nativeShutdown.quit).not.toHaveBeenCalled();

    await act(async () => flush.resolve());
    await flushAgentTurns();
    expect(nativeShutdown.quit).toHaveBeenCalledOnce();
  });

  it("quits once the preparation budget elapses while an agent turn keeps running", async () => {
    const prepareAgentQuit = vi.fn(() => new Promise<void>(() => undefined));
    const nativeShutdown = fakeNativeShutdown();
    const harness = renderAgentWorkspaceHarness({ nativeShutdown, prepareAgentQuit });
    await flushAgentTurns();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    act(() => harness.current().close.quitApplication());
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_QUIT_PREPARATION_TIMEOUT_MS - 1));
    expect(nativeShutdown.quit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await flushAgentTurns();

    expect(nativeShutdown.quit).toHaveBeenCalledOnce();
    expect(harness.errors).toEqual([]);
  });

  it("confirms one native close at a time and rejects an invalid close payload", async () => {
    const flush = deferred<void>();
    const nativeShutdown = fakeNativeShutdown();
    const harness = renderAgentWorkspaceHarness({
      nativeShutdown,
      prepareAgentQuit: vi.fn(() => flush.promise),
    });
    await flushAgentTurns();
    expect(nativeShutdown.setCloseListenerReady).toHaveBeenCalledWith(true);

    act(() => {
      nativeShutdown.emit("close");
      nativeShutdown.emit("quit");
      nativeShutdown.emit("explode");
    });
    await act(async () => flush.resolve());
    await flushAgentTurns();

    expect(nativeShutdown.confirmShutdown).toHaveBeenCalledExactlyOnceWith("close");
    expect(harness.errors).toEqual([
      { source: "Application", error: new Error("Invalid native close request") },
    ]);

    harness.unmount();
    expect(nativeShutdown.setCloseListenerReady).toHaveBeenLastCalledWith(false);
  });

  it("reports an agent quit preparation failure and still confirms the close", async () => {
    const nativeShutdown = fakeNativeShutdown();
    const harness = renderAgentWorkspaceHarness({
      appSettings: defaultAppSettings(),
      nativeShutdown,
      prepareAgentQuit: vi.fn(async () => {
        throw new Error("turn log flush failed");
      }),
    });
    await flushAgentTurns();

    act(() => harness.current().close.closeApplicationWindow());
    await flushAgentTurns();

    expect(nativeShutdown.confirmShutdown).toHaveBeenCalledExactlyOnceWith("close");
    expect(harness.errors).toEqual([
      { source: "Agent", error: new Error("turn log flush failed") },
    ]);
  });
});
