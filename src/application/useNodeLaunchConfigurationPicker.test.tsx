// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import {
  createNodeLaunchPickerCoordinator,
  useNodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPickerStrategy,
  type UseNodeLaunchConfigurationPickerOptions,
} from "./useNodeLaunchConfigurationPicker";

const ROOT = "/workspace";
const WORKSPACE = "workspace-a";

interface PrivateTarget {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly path: string;
}

describe("useNodeLaunchConfigurationPicker", () => {
  it("keeps prepared targets private while starting the exact cached value", async () => {
    const start = vi.fn(async () => true);
    const ui = renderPicker({ strategy: privateStrategy(start) });
    await act(async () => ui.hook().load());

    expect(ui.hook().choices).toEqual([
      {
        default: true,
        name: "API",
        runnable: true,
        targetKind: "script",
      },
    ]);
    expect(JSON.stringify(ui.hook())).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(ui.hook())).not.toContain("hidden-value");

    await act(async () => expect(await ui.hook().startSelected()).toBe(true));
    expect(start).toHaveBeenCalledWith({
      args: ["hidden-value"],
      env: { SECRET_TOKEN: "hidden" },
      path: `${ROOT}/src/api.ts`,
    });
    ui.unmount();
  });

  it("publishes only safe unsupported reasons and never selects or starts them", async () => {
    const start = vi.fn(async () => true);
    const strategy: NodeLaunchConfigurationPickerStrategy<PrivateTarget> = {
      prepare: () => ({ kind: "unsupported", reason: "attachRequiresDebugger" }),
      start,
      startErrorMessage: "Could not start.",
    };
    const ui = renderPicker({
      strategy,
      workspaceReads: readsFor([
        { name: "Attach", default: true, target: { kind: "attach", port: 9229 } },
      ]),
    });
    await act(async () => ui.hook().load());

    expect(ui.hook().choices).toEqual([
      {
        default: true,
        name: "Attach",
        runnable: false,
        targetKind: "attach",
        reason: "attachRequiresDebugger",
      },
    ]);
    expect(ui.hook().selectedName).toBeNull();
    await act(async () => expect(await ui.hook().startNamed("Attach")).toBe(false));
    expect(start).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("projects only safe VS Code source metadata and a generic skipped count", async () => {
    const ui = renderPicker({ workspaceReads: vscodeReads() });
    await act(async () => ui.hook().load());

    expect(ui.hook().choices).toEqual([
      {
        default: false,
        name: "Imported API",
        preLaunchTask: "build",
        runnable: true,
        source: "vscode",
        targetKind: "script",
      },
    ]);
    expect(ui.hook().state).toEqual({
      kind: "ready",
      diagnosticNotice: {
        count: 1,
        message: "1 VS Code launch configuration was skipped because it is unsupported or invalid.",
      },
    });
    expect(JSON.stringify(ui.hook())).not.toContain("configurations[1]");
    expect(JSON.stringify(ui.hook())).not.toContain("unsupported field");
    ui.unmount();
  });

  it("uses an instance-scoped coordinator so a new picker revokes the old focus trap", () => {
    const coordinator = createNodeLaunchPickerCoordinator();
    const first = renderPicker({ coordinator });
    const second = renderPicker({ coordinator });

    act(() => first.hook().openPicker());
    expect(first.hook().pickerOpen).toBe(true);
    expect(second.hook().pickerOpen).toBe(false);

    act(() => second.hook().openPicker());
    expect(first.hook().pickerOpen).toBe(false);
    expect(second.hook().pickerOpen).toBe(true);

    act(() => first.hook().openPicker());
    expect(first.hook().pickerOpen).toBe(true);
    expect(second.hook().pickerOpen).toBe(false);
    first.unmount();
    second.unmount();
  });

  it("does not let an old claim release a newer picker", () => {
    const coordinator = createNodeLaunchPickerCoordinator();
    const revoked = vi.fn();
    const old = coordinator.claim(revoked);
    const currentRevoked = vi.fn();
    const current = coordinator.claim(currentRevoked);
    expect(revoked).toHaveBeenCalledOnce();

    old.release();
    const latestRevoked = vi.fn();
    coordinator.claim(latestRevoked);
    expect(currentRevoked).toHaveBeenCalledOnce();
    expect(latestRevoked).not.toHaveBeenCalled();
    current.release();
  });

  it("rechecks owner after an accepted async start and never closes a replacement workspace", async () => {
    const pending = deferred<boolean>();
    const strategy = privateStrategy(vi.fn(() => pending.promise));
    const ui = renderPicker({ strategy });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());
    let started!: Promise<boolean>;
    act(() => {
      started = ui.hook().startSelected();
    });

    act(() => ui.set({ rootPath: "/other", workspaceId: "workspace-b" }));
    await act(async () => pending.resolve(true));

    await expect(started).resolves.toBe(false);
    expect(ui.hook().pickerOpen).toBe(false);
    expect(ui.hook().state).toEqual({ kind: "idle" });
    ui.unmount();
  });

  it("keeps an accepted result when that start itself transitions the capability to blocked", async () => {
    const pending = deferred<boolean>();
    const ui = renderPicker({ strategy: privateStrategy(vi.fn(() => pending.promise)) });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());
    let started!: Promise<boolean>;
    act(() => {
      started = ui.hook().startSelected();
    });

    act(() => ui.set({ blocked: true, isBlocked: () => true }));
    await act(async () => pending.resolve(true));

    await expect(started).resolves.toBe(true);
    expect(ui.hook().pickerOpen).toBe(false);
    ui.unmount();
  });

  it("invalidates a loaded private target when the configuration watcher version changes", async () => {
    const start = vi.fn(async () => true);
    const ui = renderPicker({ strategy: privateStrategy(start) });
    await act(async () => ui.hook().load());

    act(() => ui.set({ configurationVersion: 1 }));

    expect(ui.hook().state).toEqual({ kind: "idle" });
    await act(async () => expect(await ui.hook().startNamed("API")).toBe(false));
    expect(start).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("drops an in-flight old-version read and loads only the replacement source", async () => {
    const oldSource = deferred<string>();
    const oldReads = {
      ...readsFor([{ name: "Old", default: true, target: { kind: "script", path: "old.ts" } }]),
      readFile: vi.fn(() => oldSource.promise),
    };
    const ui = renderPicker({ workspaceReads: oldReads });
    let oldLoad!: Promise<void>;
    act(() => {
      oldLoad = ui.hook().load();
    });
    await act(async () => Promise.resolve());

    const newReads = readsFor([
      { name: "New", default: true, target: { kind: "script", path: "new.ts" } },
    ]);
    act(() => ui.set({ configurationVersion: 1, workspaceReads: newReads }));
    await act(async () =>
      oldSource.resolve(
        JSON.stringify({
          version: 1,
          configurations: [
            { name: "Old", default: true, target: { kind: "script", path: "old.ts" } },
          ],
        }),
      ),
    );
    await oldLoad;
    expect(ui.hook().state).toEqual({ kind: "idle" });

    await act(async () => ui.hook().load());
    expect(ui.hook().choices.map(({ name }) => name)).toEqual(["New"]);
    ui.unmount();
  });
});

function privateStrategy(
  start: NodeLaunchConfigurationPickerStrategy<PrivateTarget>["start"],
): NodeLaunchConfigurationPickerStrategy<PrivateTarget> {
  return {
    prepare: (configuration, rootPath) => ({
      kind: "supported",
      value: {
        args: ["hidden-value"],
        env: { SECRET_TOKEN: "hidden" },
        path: `${rootPath}/${configuration.target.kind === "script" ? configuration.target.path : ""}`,
      },
    }),
    start,
    startErrorMessage: "Could not start.",
  };
}

function renderPicker(
  overrides: Partial<UseNodeLaunchConfigurationPickerOptions<PrivateTarget>> = {},
) {
  const root = createRoot(document.createElement("div"));
  let props: UseNodeLaunchConfigurationPickerOptions<PrivateTarget> = {
    blocked: false,
    isBlocked: () => false,
    isWorkspaceCurrent: (rootPath, workspaceId) =>
      rootPath === props.rootPath && workspaceId === props.workspaceId,
    isWorkspaceTrusted: () => true,
    revealPicker: vi.fn(),
    rootPath: ROOT,
    strategy: privateStrategy(vi.fn(async () => true)),
    workspaceId: WORKSPACE,
    workspaceReads: readsFor([
      { name: "API", default: true, target: { kind: "script", path: "src/api.ts" } },
    ]),
    workspaceTrusted: true,
    ...overrides,
    configurationVersion: overrides.configurationVersion ?? 0,
  };
  let current: NodeLaunchConfigurationPicker | null = null;
  function Harness() {
    current = useNodeLaunchConfigurationPicker(props);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    hook: () => current as NodeLaunchConfigurationPicker,
    set(next: Partial<UseNodeLaunchConfigurationPickerOptions<PrivateTarget>>) {
      props = { ...props, ...next };
      root.render(<Harness />);
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function readsFor(
  configurations: readonly Record<string, unknown>[],
): NodeLaunchConfigurationReads {
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT || path === "/other"
        ? [{ kind: "directory" as const, name: ".codevo", path: `${path}/.codevo` }]
        : [{ kind: "file" as const, name: "launch.json", path: `${path}/launch.json` }],
    ),
    readFile: vi.fn(async () => JSON.stringify({ version: 1, configurations })),
  };
}

function vscodeReads(): NodeLaunchConfigurationReads {
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT
        ? [{ kind: "directory" as const, name: ".vscode", path: `${path}/.vscode` }]
        : [{ kind: "file" as const, name: "launch.json", path: `${path}/launch.json` }],
    ),
    readFile: vi.fn(async () =>
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Imported API",
            program: "src/api.ts",
            preLaunchTask: "build",
          },
          {
            type: "node",
            request: "launch",
            name: "Skipped secret",
            program: "src/secret.ts",
            unsupported: "/private/path",
          },
        ],
      }),
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
