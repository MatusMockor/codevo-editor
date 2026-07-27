// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugCompoundLaunchTarget } from "../domain/debug";
import type { VscodeProcessTaskCompletion } from "./vscodeProcessTaskCoordinator";
import type { DebugCompoundStartOutcome } from "./debugCompoundStart";
import { useNodeDebugCompoundComposition } from "./useNodeDebugCompoundComposition";
import type { PreparedNodeDebugCompoundLaunch } from "./useNodeDebugConfigurationLauncher";
import type { VscodeProcessTasksState } from "./useVscodeProcessTasks";

const PREPARED: PreparedNodeDebugCompoundLaunch = {
  kind: "compound",
  members: [
    {
      launch: { kind: "node-script", scriptPath: "/workspace/api.ts" },
      preLaunchTask: null,
    },
    {
      launch: {
        kind: "node-configured-script",
        scriptPath: "/workspace/worker.ts",
        args: [],
        env: {},
      },
      preLaunchTask: null,
    },
  ],
  name: "API + worker",
  preLaunchTask: Object.freeze({ label: "build all" }),
};

describe("useNodeDebugCompoundComposition", () => {
  it("runs one shared pre-launch task before one private immutable compound batch", async () => {
    const completion = deferred<VscodeProcessTaskCompletion | null>();
    const ui = renderComposition({
      tasks: taskState({ startAndWait: vi.fn(() => completion.promise) }),
    });
    const mutablePrepared: PreparedNodeDebugCompoundLaunch = {
      ...PREPARED,
      members: PREPARED.members.map((member) => ({
        ...member,
        launch: { ...member.launch },
      })),
    };
    const running = ui.start()(mutablePrepared);

    expect(ui.tasks.startAndWait).toHaveBeenCalledExactlyOnceWith(
      "build all",
      expect.any(Function),
    );
    expect(ui.startCompound).not.toHaveBeenCalled();
    (mutablePrepared.members[0]!.launch as { scriptPath: string }).scriptPath =
      "/private/changed.ts";
    completion.resolve({ status: "exited", exitCode: 0 });
    await act(async () => expect(await running).toBe(true));

    const members = ui.startCompound.mock.calls[0]![0];
    expect(members.map((member) => ("scriptPath" in member ? member.scriptPath : null))).toEqual([
      "/workspace/api.ts",
      "/workspace/worker.ts",
    ]);
    expect(Object.isFrozen(members)).toBe(true);
    expect(Object.isFrozen(members[0])).toBe(true);
    expect(JSON.stringify(ui.startCompound.mock.calls)).not.toContain("API + worker");
    ui.unmount();
  });

  it("fails closed before batch start on task failure with a generic warning", async () => {
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn<VscodeProcessTasksState["startAndWait"]>(
          async (): Promise<VscodeProcessTaskCompletion> => ({
            status: "exited",
            exitCode: 2,
          }),
        ),
      }),
    });

    await act(async () => expect(await ui.start()(PREPARED)).toBe(false));

    expect(ui.startCompound).not.toHaveBeenCalled();
    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Debug compound pre-launch task failed.",
    );
    expect(JSON.stringify(ui.reportWarning.mock.calls)).not.toContain("build all");
    ui.unmount();
  });

  it("reports the bounded payload reason for a compound request above one MiB", async () => {
    const ui = renderComposition();
    ui.startCompound.mockResolvedValueOnce({ kind: "request-too-large" });

    await act(async () => expect(await ui.start()(PREPARED)).toBe(false));

    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Node debug compound request exceeded the 1 MiB payload limit.",
    );
    ui.unmount();
  });

  it("reports the generic start warning for an ordinary compound rejection", async () => {
    const ui = renderComposition();
    ui.startCompound.mockResolvedValueOnce({ kind: "rejected" });

    await act(async () => expect(await ui.start()(PREPARED)).toBe(false));

    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Node debug compound could not be started.",
    );
    ui.unmount();
  });

  it("reports the bounded lifecycle buffer reason only for lifecycle replay overflow", async () => {
    const ui = renderComposition();
    ui.startCompound.mockResolvedValueOnce({ kind: "lifecycle-buffer-overflow" });

    await act(async () => expect(await ui.start()(PREPARED)).toBe(false));

    expect(ui.reportWarning).toHaveBeenCalledExactlyOnceWith(
      "Node debug compound start was rejected by bounded safety checks.",
    );
    ui.unmount();
  });

  it.each([
    ["workspace A-B-A", { rootPath: "/workspace-b", workspaceId: "workspace-b" }, {}],
    ["trust A-B-A", { workspaceTrusted: false }, { workspaceTrusted: true }],
    ["configuration A-B-A", { launchConfigurationVersion: 1 }, { launchConfigurationVersion: 0 }],
  ])("invalidates an in-flight task across %s", async (_name, changed, restored) => {
    const completion = deferred<VscodeProcessTaskCompletion | null>();
    const cancel = vi.fn(async () => true);
    const ui = renderComposition({
      tasks: taskState({
        startAndWait: vi.fn((_label, onOwned) => {
          onOwned?.({ cancel });
          return completion.promise;
        }),
      }),
    });
    const running = ui.start()(PREPARED);

    act(() => ui.set(changed));
    act(() =>
      ui.set({
        launchConfigurationVersion: 0,
        rootPath: "/workspace",
        workspaceId: "workspace-a",
        workspaceTrusted: true,
        ...restored,
      }),
    );
    await expect(running).resolves.toBe(false);
    expect(cancel).toHaveBeenCalled();
    expect(ui.startCompound).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("revalidates the exact owner after the atomic start port resolves", async () => {
    const accepted = deferred<DebugCompoundStartOutcome>();
    const ui = renderComposition();
    ui.startCompound.mockReturnValueOnce(accepted.promise);
    const running = ui.start()({ ...PREPARED, preLaunchTask: null });
    await act(async () => Promise.resolve());

    act(() => ui.set({ workspaceTrusted: false }));
    act(() => ui.set({ workspaceTrusted: true }));
    accepted.resolve({ kind: "accepted" });

    await expect(running).resolves.toBe(false);
    expect(ui.startCompound).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("stops one accepted compound when the configuration generation changes during start", async () => {
    const accepted = deferred<DebugCompoundStartOutcome>();
    const ui = renderComposition();
    ui.startCompound.mockReturnValueOnce(accepted.promise);
    const running = ui.start()({ ...PREPARED, preLaunchTask: null });
    await act(async () => Promise.resolve());

    act(() => ui.set({ launchConfigurationVersion: 1 }));
    act(() => ui.set({ launchConfigurationVersion: 0 }));
    accepted.resolve({ kind: "accepted" });

    await expect(running).resolves.toBe(false);
    expect(ui.startCompound).toHaveBeenCalledOnce();
    expect(ui.stopAcceptedCompound).toHaveBeenCalledOnce();
    ui.unmount();
  });
});

function renderComposition(overrides: { readonly tasks?: VscodeProcessTasksState } = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const tasks = overrides.tasks ?? taskState();
  const reportWarning = vi.fn();
  const stopAcceptedCompound = vi.fn(async () => undefined);
  const startCompound = vi.fn<
    (members: readonly DebugCompoundLaunchTarget[]) => Promise<DebugCompoundStartOutcome>
  >(async () => ({ kind: "accepted" }));
  let patch: Partial<Parameters<typeof useNodeDebugCompoundComposition>[0]> = {};
  let hook: ReturnType<typeof useNodeDebugCompoundComposition> | null = null;

  function Harness() {
    hook = useNodeDebugCompoundComposition({
      isWorkspaceCurrent: (rootPath, workspaceId) =>
        rootPath === "/workspace" && workspaceId === "workspace-a",
      launchConfigurationVersion: 0,
      processTasks: tasks,
      reportWarning,
      rootPath: "/workspace",
      startCompound,
      stopAcceptedCompound,
      workspaceId: "workspace-a",
      workspaceTrusted: true,
      ...patch,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    reportWarning,
    set(next: typeof patch) {
      patch = { ...patch, ...next };
      act(() => root.render(<Harness />));
    },
    start: () => hook!.start,
    startCompound,
    stopAcceptedCompound,
    tasks: tasks as ReturnType<typeof taskState>,
    unmount() {
      act(() => root.unmount());
    },
  };
}

function taskState(overrides: Partial<VscodeProcessTasksState> = {}): VscodeProcessTasksState & {
  readonly startAndWait: ReturnType<typeof vi.fn>;
} {
  return {
    activeLabel: null,
    configRevision: "revision",
    currentStep: null,
    diagnostics: [],
    discover: vi.fn(async () => true),
    discovering: false,
    error: null,
    occupied: false,
    output: [],
    running: false,
    start: vi.fn(async () => true),
    startAndWait: vi.fn(async () => ({ status: "exited", exitCode: 0 })),
    status: null,
    stop: vi.fn(async () => true),
    stopping: false,
    tasks: [],
    truncated: false,
    unavailable: null,
    ...overrides,
  } as VscodeProcessTasksState & { readonly startAndWait: ReturnType<typeof vi.fn> };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
