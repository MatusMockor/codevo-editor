// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugEvent } from "../domain/debug";
import type { VscodeProcessTaskCompletion } from "./vscodeProcessTaskCoordinator";
import type {
  VscodeProcessTaskRunOwnership,
  VscodeProcessTasksState,
} from "./useVscodeProcessTasks";
import { useNodeDebugPreLaunchComposition } from "./useNodeDebugPreLaunchComposition";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

const PREPARED: PreparedNodeDebugLaunch = {
  launch: {
    kind: "node-configured-script",
    scriptPath: "/workspace/api.ts",
    args: [],
    env: {},
  },
  preLaunchTask: Object.freeze({ label: "build api" }),
};
const PREPARED_WITH_POST_TASK: PreparedNodeDebugLaunch = {
  ...PREPARED,
  postDebugTask: Object.freeze({ label: "stop api" }),
};
const PREPARED_WITH_SERVER_READY: PreparedNodeDebugLaunch = {
  ...PREPARED,
  preLaunchTask: null,
  serverReadyAction: Object.freeze({
    action: "openExternally",
    match: Object.freeze({ kind: "port", prefix: "Listening on port ", suffix: " ready" }),
    uri: Object.freeze({ host: "localhost", path: "/health", scheme: "http" }),
  }),
};
const PREPARED_NATIVE_WATCH: PreparedNodeDebugLaunch = {
  launch: {
    kind: "node-configured-script",
    scriptPath: "/workspace/server.js",
    args: [],
    env: {},
  },
  nativeWatch: {
    kind: "native-node-watch",
    scriptPath: "/workspace/server.js",
    watch: true,
    preserveOutput: true,
  },
  preLaunchTask: Object.freeze({ label: "build api" }),
};
const PREPARED_TSX_WITH_ENV_FILE: PreparedNodeDebugLaunch = {
  envFile: "config/dev.env",
  launch: {
    kind: "node-configured-script",
    scriptPath: "/workspace/src/server.ts",
    args: [],
    env: {},
    envFile: "config/dev.env",
    runtime: "tsx",
  },
  preLaunchTask: Object.freeze({ label: "build api" }),
};

describe("useNodeDebugPreLaunchComposition", () => {
  it("starts a configuration without task metadata directly", async () => {
    const ui = renderComposition();
    await act(async () =>
      expect(await ui.start()({ ...PREPARED, preLaunchTask: null })).toBe(true),
    );

    expect(ui.tasks.startAndWait).not.toHaveBeenCalled();
    expect(ui.startDebug).toHaveBeenCalledExactlyOnceWith(PREPARED.launch);
    ui.unmount();
  });

  it.each(["tsx", "ts-node"] as const)(
    "replays the complete envFile, %s runtime, and preLaunch recipe on ordinary Restart",
    async (runtime) => {
      const prepared: PreparedNodeDebugLaunch = {
        ...PREPARED_TSX_WITH_ENV_FILE,
        launch: { ...PREPARED_TSX_WITH_ENV_FILE.launch, runtime },
      };
      const order: string[] = [];
      const tasks = taskState({
        startAndWait: vi.fn(async (label: string) => {
          order.push(label);
          return { status: "exited" as const, exitCode: 0 };
        }),
      });
      const ui = renderComposition({ tasks });
      ui.startDebug.mockImplementation(async (launch) => {
        order.push("debug");
        expect(launch).toMatchObject({
          envFile: "config/dev.env",
          runtime,
        });
        return ui.startDebug.mock.calls.length === 1 ? 4 : 9;
      });
      ui.stopExactDebugSession.mockImplementationOnce(async () => {
        order.push("stop");
        return true;
      });

      await act(async () => expect(await ui.start()(prepared)).toBe(true));
      order.length = 0;
      await act(async () => expect(await ui.composition().restartPostTask()).toBe(true));

      expect(order).toEqual(["stop", "build api", "debug"]);
      expect(ui.startDebug).toHaveBeenCalledTimes(2);
      expect(ui.startDebug.mock.calls[1]?.[0]).toEqual(prepared.launch);
      expect(ui.startDebug.mock.calls[1]?.[0]).not.toBe(prepared.launch);
      ui.unmount();
    },
  );

  it("fails closed after stop when the ordinary Restart preLaunchTask fails", async () => {
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi
          .fn()
          .mockResolvedValueOnce({ status: "exited", exitCode: 0 })
          .mockResolvedValueOnce({ status: "exited", exitCode: 2 }),
      }),
    });
    await act(async () => expect(await ui.start()(PREPARED_TSX_WITH_ENV_FILE)).toBe(true));

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(false));

    expect(ui.stopExactDebugSession).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.startDebug).toHaveBeenCalledOnce();
    expect(ui.reportWarning).toHaveBeenCalledWith("Debug pre-launch task failed.");
    ui.unmount();
  });

  it("rejects an ordinary Restart after exact workspace A-B-A generation drift", async () => {
    const ui = renderComposition();
    const stopped = deferred<boolean>();
    ui.stopExactDebugSession.mockReturnValueOnce(stopped.promise);
    await act(async () => expect(await ui.start()(PREPARED_TSX_WITH_ENV_FILE)).toBe(true));

    const restarting = ui.composition().restartPostTask();
    await act(async () => Promise.resolve());
    act(() => ui.set({ workspaceId: "workspace-b" }));
    act(() => ui.set({ workspaceId: "workspace-a" }));
    stopped.resolve(true);
    await act(async () => expect(await restarting).toBe(false));

    expect(ui.stopExactDebugSession).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.startDebug).toHaveBeenCalledOnce();
    expect(ui.tasks.startAndWait).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("invalidates only the exact lease-free configured recipe on natural termination", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_TSX_WITH_ENV_FILE)).toBe(true));

    act(() => ui.emit(terminatedEvent(9)));
    expect(ui.composition().hasPostTaskRestart()).toBe(true);
    act(() => ui.emit(terminatedEvent(4)));

    expect(ui.composition().hasPostTaskRestart()).toBe(false);
    expect(ui.composition().canRestartPostTask()).toBe(false);
    ui.unmount();
  });

  it("buffers server output before accepted-session adoption and opens exactly once", async () => {
    const accepted = deferred<number>();
    const ui = renderComposition();
    ui.startDebug.mockReturnValueOnce(accepted.promise);
    const running = ui.start()(PREPARED_WITH_SERVER_READY);
    await act(async () => Promise.resolve());

    ui.emit(outputEvent(4, 1, "Listening on port 4173 ready"));
    ui.emit(outputEvent(5, 1, "Listening on port 5000 ready"));
    await act(async () => accepted.resolve(4));
    await expect(running).resolves.toBe(true);
    await act(async () => Promise.resolve());

    expect(ui.openServerReadyUrl).toHaveBeenCalledExactlyOnceWith("http://localhost:4173/health");
    ui.emit(outputEvent(4, 2, "Listening on port 4174 ready"));
    expect(ui.openServerReadyUrl).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("cancels server-ready ownership on stop, terminate, unmount, and A-B-A drift", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.composition().cancelServerReadyActionForSession("/workspace", 4);
    ui.emit(outputEvent(4, 1, "Listening on port 3000 ready"));

    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.emit(terminatedEvent(4, 1));
    ui.emit(outputEvent(4, 2, "Listening on port 3001 ready"));

    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    act(() => ui.set({ workspaceId: "workspace-b" }));
    act(() => ui.set({ workspaceId: "workspace-a" }));
    ui.emit(outputEvent(4, 1, "Listening on port 3002 ready"));

    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.unmount();
    ui.emit(outputEvent(4, 1, "Listening on port 3003 ready"));
    await Promise.resolve();
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();
  });

  it("retains and rearms the private server-ready recipe for Restart", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(true));
    ui.emit(outputEvent(4, 1, "Listening on port 8080 ready"));
    await act(async () => Promise.resolve());

    expect(ui.stopExactDebugSession).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.startDebug).toHaveBeenCalledTimes(2);
    expect(ui.openServerReadyUrl).toHaveBeenCalledExactlyOnceWith("http://localhost:8080/health");
    ui.unmount();
  });

  it("revalidates the lease after a match and before the opener microtask", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));

    ui.emit(outputEvent(4, 1, "Listening on port 3000 ready"));
    ui.composition().cancelServerReadyAction();
    await act(async () => Promise.resolve());
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();

    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    act(() => {
      ui.emit(outputEvent(4, 1, "Listening on port 3001 ready"));
      ui.set({ workspaceId: "workspace-b" });
    });
    await act(async () => Promise.resolve());
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();

    act(() => ui.set({ workspaceId: "workspace-a" }));
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    act(() => {
      ui.emit(outputEvent(4, 1, "Listening on port 3002 ready"));
      ui.unmount();
    });
    await Promise.resolve();
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();
  });

  it("invalidates trust and configuration-version A-B-A before the opener microtask", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.emit(outputEvent(4, 1, "Listening on port 3000 ready"));
    act(() => ui.set({ workspaceTrusted: false }));
    act(() => ui.set({ workspaceTrusted: true }));
    await act(async () => Promise.resolve());
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();

    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.emit(outputEvent(4, 1, "Listening on port 3001 ready"));
    act(() => ui.set({ launchConfigurationVersion: 1 }));
    act(() => ui.set({ launchConfigurationVersion: 0 }));
    await act(async () => Promise.resolve());
    expect(ui.openServerReadyUrl).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("reports opener failure without exposing the URL or output content", async () => {
    const ui = renderComposition();
    ui.openServerReadyUrl.mockRejectedValueOnce(new Error("secret output"));
    await act(async () => expect(await ui.start()(PREPARED_WITH_SERVER_READY)).toBe(true));
    ui.emit(outputEvent(4, 1, "Listening on port 6123 ready"));
    await act(async () => Promise.resolve());

    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Server ready URL could not be opened.",
    );
    expect(JSON.stringify(ui.reportWarning.mock.calls)).not.toMatch(/6123|health|secret output/);
    ui.unmount();
  });

  it("coalesces discovery before exact task admission and starts debug only after exit zero", async () => {
    const discovery = deferred<boolean>();
    const completion = deferred<VscodeProcessTaskCompletion | null>();
    const discover = vi.fn(() => discovery.promise);
    const ui = renderComposition({
      tasks: taskState({
        configRevision: null,
        discover,
        startAndWait: vi.fn(async () => {
          if (!(await discover())) return null;
          return completion.promise;
        }),
      }),
    });
    const first = ui.start()(PREPARED);
    const second = ui.start()(PREPARED);

    expect(ui.tasks.discover).toHaveBeenCalledOnce();
    await expect(second).resolves.toBe(false);
    discovery.resolve(true);
    await act(async () => Promise.resolve());
    expect(ui.tasks.startAndWait).toHaveBeenCalledOnce();
    expect(ui.tasks.startAndWait.mock.calls[0]?.[0]).toBe("build api");
    expect(JSON.stringify(ui.tasks.startAndWait.mock.calls)).not.toMatch(/command|args|cwd|env/);
    expect(ui.startDebug).not.toHaveBeenCalled();
    completion.resolve({ status: "exited", exitCode: 0 });
    await expect(first).resolves.toBe(true);
    expect(ui.startDebug).toHaveBeenCalledExactlyOnceWith(PREPARED.launch);
    ui.unmount();
  });

  it("orders the pre-task before dedicated native watch admission", async () => {
    const order: string[] = [];
    const ui = renderComposition({
      startNativeNodeWatch: vi.fn(async () => {
        order.push("native-watch");
        return 12;
      }),
      tasks: taskState({
        startAndWait: vi.fn(async () => {
          order.push("build api");
          return { status: "exited" as const, exitCode: 0 };
        }),
      }),
    });

    await act(async () => expect(await ui.start()(PREPARED_NATIVE_WATCH)).toBe(true));

    expect(order).toEqual(["build api", "native-watch"]);
    expect(ui.startNativeNodeWatch).toHaveBeenCalledExactlyOnceWith(PREPARED_NATIVE_WATCH);
    expect(ui.startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed when the native watch target becomes dirty during its pre-task", async () => {
    let clean = true;
    const startNativeNodeWatch = vi.fn(async () => (clean ? 12 : null));
    const ui = renderComposition({
      startNativeNodeWatch,
      tasks: taskState({
        startAndWait: vi.fn(async () => {
          clean = false;
          return { status: "exited" as const, exitCode: 0 };
        }),
      }),
    });

    await act(async () => expect(await ui.start()(PREPARED_NATIVE_WATCH)).toBe(false));

    expect(startNativeNodeWatch).toHaveBeenCalledExactlyOnceWith(PREPARED_NATIVE_WATCH);
    expect(ui.startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("arms the existing post-task lifecycle for an accepted native watch session", async () => {
    const ui = renderComposition({
      startNativeNodeWatch: vi.fn(async () => 12),
    });
    const prepared = {
      ...PREPARED_NATIVE_WATCH,
      postDebugTask: Object.freeze({ label: "clean api" }),
    };

    await act(async () => expect(await ui.start()(prepared)).toBe(true));
    await act(async () => {
      ui.emit(terminatedEvent(12));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api", "clean api"]);
    ui.unmount();
  });

  it("fails closed for task failure and reports only a bounded generic warning", async () => {
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn(async (): Promise<VscodeProcessTaskCompletion> => ({
          status: "exited",
          exitCode: 2,
        })),
      }),
    });

    await act(async () => expect(await ui.start()(PREPARED)).toBe(false));

    expect(ui.startDebug).not.toHaveBeenCalled();
    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith("Debug pre-launch task failed.");
    expect(JSON.stringify(ui.reportWarning.mock.calls)).not.toContain("build api");
    ui.unmount();
  });

  it("invalidates an in-flight task across workspace A-B-A and on unmount", async () => {
    const completion = deferred<VscodeProcessTaskCompletion | null>();
    const stop = vi.fn(async () => true);
    const ui = renderComposition({
      tasks: taskState({ startAndWait: vi.fn(() => completion.promise), stop }),
    });
    const running = ui.start()(PREPARED);

    act(() => ui.set({ rootPath: "/workspace-b", workspaceId: "workspace-b" }));
    act(() => ui.set({ rootPath: "/workspace", workspaceId: "workspace-a" }));
    await expect(running).resolves.toBe(false);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(ui.startDebug).not.toHaveBeenCalled();

    const next = ui.start()(PREPARED);
    ui.unmount();
    await expect(next).resolves.toBe(false);
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it("invalidates an in-flight barrier when launch configuration version changes", async () => {
    const completion = deferred<VscodeProcessTaskCompletion | null>();
    const stop = vi.fn(async () => true);
    const ui = renderComposition({
      tasks: taskState({ startAndWait: vi.fn(() => completion.promise), stop }),
    });
    const running = ui.start()(PREPARED);

    act(() => ui.set({ launchConfigurationVersion: 1 }));

    await expect(running).resolves.toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(ui.startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    [
      "launch configuration A-B-A",
      { launchConfigurationVersion: 1 },
      { launchConfigurationVersion: 0 },
    ],
    ["trust A-B-A", { workspaceTrusted: false }, { workspaceTrusted: true }],
  ])(
    "stops an accepted launch invalidated by pending-start %s",
    async (_name, invalidate, restore) => {
      const accepted = deferred<number>();
      const ui = renderComposition();
      ui.startDebug.mockReturnValueOnce(accepted.promise);
      const running = ui.start()(PREPARED_WITH_POST_TASK);
      await act(async () => Promise.resolve());
      expect(ui.startDebug).toHaveBeenCalledOnce();

      act(() => ui.set(invalidate));
      act(() => ui.set(restore));
      let result!: boolean;
      await act(async () => {
        accepted.resolve(4);
        result = await running;
      });
      expect(result).toBe(false);

      expect(ui.debugGateway.stop).toHaveBeenCalledExactlyOnceWith(4);
      expect(ui.debugGateway.disconnect).not.toHaveBeenCalled();
      expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api"]);
      ui.unmount();
    },
  );

  it("disconnects an accepted attach invalidated while its start is pending", async () => {
    const accepted = deferred<number>();
    const ui = renderComposition();
    ui.startDebug.mockReturnValueOnce(accepted.promise);
    const prepared: PreparedNodeDebugLaunch = {
      ...PREPARED_WITH_POST_TASK,
      launch: { kind: "node-attach", port: 9229 },
    };
    const running = ui.start()(prepared);
    await act(async () => Promise.resolve());
    expect(ui.startDebug).toHaveBeenCalledOnce();

    act(() => ui.set({ launchConfigurationVersion: 1 }));
    act(() => ui.set({ launchConfigurationVersion: 0 }));
    let result!: boolean;
    await act(async () => {
      accepted.resolve(4);
      result = await running;
    });
    expect(result).toBe(false);

    expect(ui.debugGateway.disconnect).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace",
      sessionId: 4,
    });
    expect(ui.debugGateway.stop).not.toHaveBeenCalled();
    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api"]);
    ui.unmount();
  });

  it("stops an accepted launch at its captured root after a permanent workspace switch", async () => {
    const accepted = deferred<number>();
    const ui = renderComposition();
    ui.startDebug.mockReturnValueOnce(accepted.promise);
    const running = ui.start()(PREPARED_WITH_POST_TASK);
    await act(async () => Promise.resolve());
    expect(ui.startDebug).toHaveBeenCalledOnce();

    act(() => ui.set({ rootPath: "/workspace-b", workspaceId: "workspace-b" }));
    let result!: boolean;
    await act(async () => {
      accepted.resolve(4);
      result = await running;
    });
    expect(result).toBe(false);

    expect(ui.debugGateway.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.debugGateway.disconnect).not.toHaveBeenCalled();
    expect(ui.stopExactDebugSession).not.toHaveBeenCalled();
    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api"]);
    ui.unmount();
  });

  it("disconnects instead of stopping an accepted attach whose recipe cannot be retained", async () => {
    const ui = renderComposition();
    const invalidAttach: PreparedNodeDebugLaunch = {
      ...PREPARED_WITH_POST_TASK,
      launch: { kind: "node-attach", port: Number.NaN },
    };

    await act(async () => expect(await ui.start()(invalidAttach)).toBe(false));

    expect(ui.debugGateway.disconnect).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace",
      sessionId: 4,
    });
    expect(ui.debugGateway.stop).not.toHaveBeenCalled();
    expect(ui.reportWarning).toHaveBeenCalledWith("Debug post-task could not be completed.");
    ui.unmount();
  });

  it("runs the exact post task once for the accepted terminated session", async () => {
    const ui = renderComposition();

    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    expect(ui.composition().postTaskActive).toBe(true);
    await act(async () => {
      ui.emit(terminatedEvent(4));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api", "stop api"]);
    expect(ui.composition().postTaskActive).toBe(false);
    await act(async () => {
      ui.emit(terminatedEvent(4, 3));
      await Promise.resolve();
    });
    expect(ui.tasks.startAndWait).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("does not miss a terminal event emitted before accepted start returns", async () => {
    const ui = renderComposition();
    ui.startDebug.mockImplementationOnce(async () => {
      ui.emit(terminatedEvent(4));
      return 4;
    });

    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    await act(async () => Promise.resolve());

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api", "stop api"]);
    expect(ui.composition().postTaskActive).toBe(false);
    ui.unmount();
  });

  it("blocks a replacement start until the exact post task settles", async () => {
    const postCompletion = deferred<VscodeProcessTaskCompletion | null>();
    const ui = renderComposition({
      tasks: taskState({
        activeLabel: "stop api",
        startAndWait: vi.fn(async (label: string): Promise<VscodeProcessTaskCompletion | null> =>
          label === "stop api" ? postCompletion.promise : { status: "exited", exitCode: 0 },
        ),
      }),
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    act(() => ui.emit(terminatedEvent(4)));
    await act(async () => Promise.resolve());
    expect(ui.composition().isPostTaskBusy()).toBe(true);
    await expect(ui.start()(PREPARED_WITH_POST_TASK)).resolves.toBe(false);
    expect(ui.startDebug).toHaveBeenCalledOnce();

    await act(async () => {
      postCompletion.resolve({ status: "exited", exitCode: 0 });
      await Promise.resolve();
    });
    expect(ui.composition().isPostTaskBusy()).toBe(false);
    ui.unmount();
  });

  it("blocks a replacement start while the accepted session post task is armed", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    await expect(ui.start()(PREPARED_WITH_POST_TASK)).resolves.toBe(false);

    expect(ui.startDebug).toHaveBeenCalledOnce();
    expect(ui.composition().postTaskActive).toBe(true);
    ui.unmount();
  });

  it("permanently invalidates an armed post task across trust revoke and restore", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    act(() => ui.set({ workspaceTrusted: false }));
    act(() => ui.set({ workspaceTrusted: true }));
    await act(async () => {
      ui.emit(terminatedEvent(4));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api"]);
    expect(ui.composition().postTaskActive).toBe(false);
    ui.unmount();
  });

  it("does not revive an armed post task across workspace A-B-A", async () => {
    const ui = renderComposition();
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    act(() => ui.set({ rootPath: "/workspace-b", workspaceId: "workspace-b" }));
    act(() => ui.set({ rootPath: "/workspace", workspaceId: "workspace-a" }));
    await act(async () => {
      ui.emit(terminatedEvent(4));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api"]);
    expect(ui.composition().postTaskActive).toBe(false);
    ui.unmount();
  });

  it("keeps the exact early terminal despite a flood from foreign roots", async () => {
    const ui = renderComposition();
    ui.startDebug.mockImplementationOnce(async () => {
      ui.emit(terminatedEvent(4));
      for (let sessionId = 100; sessionId < 140; sessionId += 1) {
        ui.emit(terminatedEvent(sessionId, 2, "/foreign"));
      }
      return 4;
    });

    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    await act(async () => Promise.resolve());

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api", "stop api"]);
    expect(ui.composition().postTaskActive).toBe(false);
    ui.unmount();
  });

  it("cancels the shared execution when unmounted during post-task settlement", async () => {
    const postCompletion = deferred<VscodeProcessTaskCompletion | null>();
    const stop = vi.fn(async () => true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ui = renderComposition({
      tasks: taskState({
        activeLabel: "stop api",
        startAndWait: vi.fn(async (label: string): Promise<VscodeProcessTaskCompletion | null> =>
          label === "stop api" ? postCompletion.promise : { status: "exited", exitCode: 0 },
        ),
        stop,
      }),
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    act(() => ui.emit(terminatedEvent(4)));
    await act(async () => Promise.resolve());

    ui.unmount();

    expect(stop).toHaveBeenCalledOnce();
    await act(async () => {
      postCompletion.resolve({ status: "stopped" });
      await Promise.resolve();
    });
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (value) => typeof value === "string" && value.toLowerCase().includes("state update"),
        ),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("remembers unmount cancellation until a late post-task ownership admission arrives", async () => {
    const ownershipAdmission = deferred<void>();
    const postCompletion = deferred<VscodeProcessTaskCompletion | null>();
    const cancel = vi.fn(async () => true);
    const ui = renderComposition({
      tasks: taskState(
        {
          startAndWait: vi.fn(
            async (
              label: string,
              onOwned?: (ownership: VscodeProcessTaskRunOwnership) => void,
            ): Promise<VscodeProcessTaskCompletion | null> => {
              if (label !== "stop api") {
                onOwned?.(Object.freeze({ cancel: vi.fn(async () => true) }));
                return { status: "exited", exitCode: 0 };
              }
              await ownershipAdmission.promise;
              onOwned?.(Object.freeze({ cancel }));
              return postCompletion.promise;
            },
          ),
        },
        { delegateOwnership: true },
      ),
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    act(() => ui.emit(terminatedEvent(4)));
    await act(async () => Promise.resolve());

    ui.unmount();
    await act(async () => {
      ownershipAdmission.resolve();
      await Promise.resolve();
    });

    expect(cancel).toHaveBeenCalledOnce();
    postCompletion.resolve({ status: "stopped" });
  });

  it("remembers boundary invalidation until a late post-task ownership admission arrives", async () => {
    const ownershipAdmission = deferred<void>();
    const postCompletion = deferred<VscodeProcessTaskCompletion | null>();
    const cancel = vi.fn(async () => true);
    const ui = renderComposition({
      tasks: taskState(
        {
          startAndWait: vi.fn(
            async (
              label: string,
              onOwned?: (ownership: VscodeProcessTaskRunOwnership) => void,
            ): Promise<VscodeProcessTaskCompletion | null> => {
              if (label !== "stop api") {
                onOwned?.(Object.freeze({ cancel: vi.fn(async () => true) }));
                return { status: "exited", exitCode: 0 };
              }
              await ownershipAdmission.promise;
              onOwned?.(Object.freeze({ cancel }));
              return postCompletion.promise;
            },
          ),
        },
        { delegateOwnership: true },
      ),
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    act(() => ui.emit(terminatedEvent(4)));
    await act(async () => Promise.resolve());

    act(() => ui.set({ rootPath: "/other", workspaceId: "workspace-b" }));
    await act(async () => {
      ownershipAdmission.resolve();
      await Promise.resolve();
    });

    expect(cancel).toHaveBeenCalledOnce();
    postCompletion.resolve({ status: "stopped" });
    ui.unmount();
  });

  it("remains reusable after React StrictMode effect replay", async () => {
    const ui = renderComposition({ strictMode: true });

    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    await act(async () => {
      ui.emit(terminatedEvent(4));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual(["build api", "stop api"]);
    expect(ui.startDebug).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("restarts a post-task launch in stop, post, pre, replay order", async () => {
    const order: string[] = [];
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn(async (label: string): Promise<VscodeProcessTaskCompletion | null> => {
          order.push(label);
          return { status: "exited", exitCode: 0 };
        }),
      }),
    });
    ui.startDebug
      .mockImplementationOnce(async () => {
        order.push("start-old");
        return 4;
      })
      .mockImplementationOnce(async () => {
        order.push("start-new");
        return 9;
      });
    ui.stopExactDebugSession.mockImplementationOnce(async () => {
      order.push("stop-old");
      return true;
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));
    order.length = 0;

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(true));

    expect(order).toEqual(["stop-old", "stop api", "build api", "start-new"]);
    expect(ui.composition().hasPostTaskRestart()).toBe(true);
    expect(ui.composition().postRestartPending).toBe(false);
    ui.unmount();
  });

  it("uses Disconnect for attach restart and fails closed when the post task fails", async () => {
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn(async (label: string): Promise<VscodeProcessTaskCompletion | null> =>
          label === "stop api"
            ? { status: "exited", exitCode: 2 }
            : { status: "exited", exitCode: 0 },
        ),
      }),
    });
    const prepared: PreparedNodeDebugLaunch = {
      ...PREPARED_WITH_POST_TASK,
      launch: { kind: "node-attach", port: 9229 },
    };
    await act(async () => expect(await ui.start()(prepared)).toBe(true));

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(false));

    expect(ui.disconnectExactDebugSession).toHaveBeenCalledWith(4);
    expect(ui.stopExactDebugSession).not.toHaveBeenCalled();
    expect(ui.startDebug).toHaveBeenCalledOnce();
    expect(ui.reportWarning).toHaveBeenCalledWith("Debug post-task could not be completed.");
    ui.unmount();
  });

  it("restarts attach in exact disconnect, post, pre, reattach order and rearms once", async () => {
    const order: string[] = [];
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn(async (label: string): Promise<VscodeProcessTaskCompletion | null> => {
          order.push(label);
          return { status: "exited", exitCode: 0 };
        }),
      }),
    });
    const prepared: PreparedNodeDebugLaunch = {
      ...PREPARED_WITH_POST_TASK,
      launch: { kind: "node-attach", port: 9229 },
    };
    ui.startDebug
      .mockImplementationOnce(async () => 4)
      .mockImplementationOnce(async () => {
        order.push("reattach-new");
        return 9;
      });
    ui.disconnectExactDebugSession.mockImplementationOnce(async () => {
      order.push("disconnect-old");
      return true;
    });
    await act(async () => expect(await ui.start()(prepared)).toBe(true));
    order.length = 0;

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(true));

    expect(order).toEqual(["disconnect-old", "stop api", "build api", "reattach-new"]);
    expect(ui.disconnectExactDebugSession).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.stopExactDebugSession).not.toHaveBeenCalled();
    expect(ui.composition().hasPostTaskRestart()).toBe(true);

    await act(async () => {
      ui.emit(terminatedEvent(9));
      await Promise.resolve();
    });
    await act(async () => {
      ui.emit(terminatedEvent(9, 3));
      await Promise.resolve();
    });

    expect(taskLabels(ui.tasks.startAndWait)).toEqual([
      "build api",
      "stop api",
      "build api",
      "stop api",
    ]);
    expect(ui.composition().hasPostTaskRestart()).toBe(false);
    ui.unmount();
  });

  it.each([
    ["no-op", async () => false],
    [
      "failure",
      async () => {
        throw new Error("stop failed");
      },
    ],
  ])("does not settle or replay when exact session end is a %s", async (_name, endSession) => {
    const ui = renderComposition();
    ui.stopExactDebugSession.mockImplementationOnce(endSession);
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(false));

    expect(ui.stopExactDebugSession).toHaveBeenCalledWith(4);
    expect(ui.tasks.startAndWait).toHaveBeenCalledTimes(1);
    expect(ui.startDebug).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("does not replay after the exact session ends under a stale workspace identity", async () => {
    const ui = renderComposition();
    ui.stopExactDebugSession.mockImplementationOnce(async () => {
      ui.set({ workspaceId: "workspace-b" });
      return true;
    });
    await act(async () => expect(await ui.start()(PREPARED_WITH_POST_TASK)).toBe(true));

    await act(async () => expect(await ui.composition().restartPostTask()).toBe(false));

    expect(ui.stopExactDebugSession).toHaveBeenCalledWith(4);
    expect(ui.startDebug).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
});

function renderComposition(
  overrides: {
    readonly startNativeNodeWatch?: (prepared: PreparedNodeDebugLaunch) => Promise<number | null>;
    readonly strictMode?: boolean;
    readonly tasks?: VscodeProcessTasksState;
  } = {},
) {
  const root = createRoot(document.createElement("div"));
  const tasks = overrides.tasks ?? taskState();
  const startDebug = vi.fn(async (_launch: PreparedNodeDebugLaunch["launch"]) => 4);
  const startNativeNodeWatch = vi.fn(overrides.startNativeNodeWatch ?? (async () => 12));
  const stopExactDebugSession = vi.fn(async () => true);
  const disconnectExactDebugSession = vi.fn(async () => true);
  const reportWarning = vi.fn();
  const openServerReadyUrl = vi.fn(async () => undefined);
  const serverReadyExternalUrlOpener = { openExternal: openServerReadyUrl };
  const subscribers = new Set<(event: DebugEvent) => void>();
  const debugGateway = {
    disconnect: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    subscribe: vi.fn((subscriber: (event: DebugEvent) => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }),
  };
  let options = {
    launchConfigurationVersion: 0,
    rootPath: "/workspace" as string | null,
    workspaceId: "workspace-a" as string | null,
    workspaceTrusted: true,
  };
  let composition: ReturnType<typeof useNodeDebugPreLaunchComposition> | null = null;
  function Harness() {
    composition = useNodeDebugPreLaunchComposition({
      ...options,
      debugGateway,
      disconnectExactDebugSession,
      isWorkspaceCurrent: (rootPath, workspaceId) =>
        rootPath === options.rootPath && workspaceId === options.workspaceId,
      processTasks: tasks,
      reportWarning,
      startDebug,
      startNativeNodeWatch,
      stopExactDebugSession,
      serverReadyExternalUrlOpener,
      workspaceTrusted: options.workspaceTrusted,
    });
    return null;
  }
  act(() =>
    root.render(
      overrides.strictMode ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    ),
  );
  return {
    composition: () => composition!,
    debugGateway,
    emit(event: DebugEvent) {
      for (const subscriber of subscribers) subscriber(event);
    },
    reportWarning,
    openServerReadyUrl,
    disconnectExactDebugSession,
    start: () => composition!.start,
    startDebug,
    startNativeNodeWatch,
    stopExactDebugSession,
    tasks: tasks as ReturnType<typeof taskState>,
    set(next: Partial<typeof options>) {
      options = { ...options, ...next };
      root.render(<Harness />);
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function terminatedEvent(sessionId: number, seq = 2, rootPath = "/workspace"): DebugEvent {
  return {
    payload: { exitCode: 0, kind: "terminated" },
    rootPath,
    seq,
    sessionId,
  };
}

function outputEvent(
  sessionId: number,
  seq: number,
  text: string,
  rootPath = "/workspace",
): DebugEvent {
  return {
    payload: { kind: "output", stream: "stdout", text, truncated: false },
    rootPath,
    seq,
    sessionId,
  };
}

function taskState(
  overrides: Partial<VscodeProcessTasksState> = {},
  options: { readonly delegateOwnership?: boolean } = {},
): VscodeProcessTasksState & {
  discover: ReturnType<typeof vi.fn>;
  startAndWait: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const suppliedStop = overrides.stop ?? (async () => true);
  const stop = vi.fn<() => Promise<boolean>>(async () => suppliedStop());
  const suppliedStartAndWait =
    overrides.startAndWait ?? (async () => ({ status: "exited" as const, exitCode: 0 }));
  const startAndWait = vi.fn(
    async (label: string, onOwned?: (ownership: { cancel(): Promise<boolean> }) => void) => {
      if (!options.delegateOwnership) {
        onOwned?.(
          Object.freeze({
            cancel: async () => Boolean(await stop()),
          }),
        );
      }
      return suppliedStartAndWait(label, onOwned);
    },
  );
  return {
    activeLabel: null,
    configRevision: "sha256:current",
    diagnostics: [],
    discover: vi.fn(async () => true),
    discovering: false,
    error: null,
    occupied: false,
    output: [],
    running: false,
    start: vi.fn(async () => true),
    status: null,
    stopping: false,
    tasks: [],
    truncated: false,
    unavailable: null,
    ...overrides,
    startAndWait,
    stop,
  } as never;
}

function taskLabels(startAndWait: ReturnType<typeof vi.fn>): string[] {
  return startAndWait.mock.calls.map(([label]) => label as string);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
