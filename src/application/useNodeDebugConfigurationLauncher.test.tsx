// @vitest-environment jsdom

import { act, StrictMode, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import {
  MAX_NODE_DEBUG_CONFIGURATION_LAUNCHER_MESSAGE_BYTES,
  NODE_DEBUG_CONFIGURATION_START_ERROR,
  useNodeDebugConfigurationLauncher,
  type NodeDebugConfigurationLauncher,
  type UseNodeDebugConfigurationLauncherOptions,
} from "./useNodeDebugConfigurationLauncher";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

describe("useNodeDebugConfigurationLauncher", () => {
  it("remains usable after StrictMode effect replay", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({ startDebug }, true);

    await act(async () => ui.hook().load());
    await act(async () => expect(await ui.hook().startSelected()).toBe(true));

    expect(ui.hook().state).toEqual({ kind: "ready" });
    expect(startDebug).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("exposes only bounded presentation choices and selects the persisted default", async () => {
    const ui = renderLauncher({
      workspaceReads: readsFor(
        configurationSource([
          {
            name: "API",
            target: { kind: "script", path: "src/api.ts" },
            args: ["--secret-argument"],
            env: { SECRET_TOKEN: "hidden" },
          },
          { name: "Inspector", default: true, target: { kind: "attach", port: 9229 } },
        ]),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().state).toEqual({ kind: "ready" });
    expect(ui.hook().selectedName).toBe("Inspector");
    expect(ui.hook().choices).toEqual([
      { default: false, name: "API", targetKind: "script" },
      { default: true, name: "Inspector", targetKind: "attach" },
    ]);
    expect(JSON.stringify(ui.hook())).not.toContain("secret-argument");
    expect(JSON.stringify(ui.hook())).not.toContain("SECRET_TOKEN");
    expect(Object.isFrozen(ui.hook().choices)).toBe(true);
    expect(Object.isFrozen(ui.hook().choices[0])).toBe(true);
    ui.unmount();
  });

  it("keeps imported npm script, cwd, and environment private while mapping the exact launch", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      startDebug,
      workspaceReads: vscodeReadsFor(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Imported npm",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", "private:dev"],
              args: [],
              cwd: "${workspaceFolder}/private-package",
              env: { PRIVATE_TOKEN: "hidden-value" },
              preLaunchTask: "build imported",
              postDebugTask: "stop imported",
              sourceMaps: false,
              stopOnEntry: true,
              skipFiles: ["<node_internals>/**"],
              serverReadyAction: {
                action: "openExternally",
                pattern: "Listening on port ([0-9]+)",
                uriFormat: "http://localhost:%s/private-health",
              },
            },
          ],
        }),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().choices).toEqual([
      {
        default: false,
        name: "Imported npm",
        preLaunchTask: "build imported",
        source: "vscode",
        targetKind: "npm",
      },
    ]);
    const publicState = JSON.stringify(ui.hook());
    expect(publicState).not.toContain("private:dev");
    expect(publicState).not.toContain("private-package");
    expect(publicState).not.toContain("PRIVATE_TOKEN");
    expect(publicState).not.toContain("hidden-value");
    expect(publicState).not.toContain("nodeInternals");
    expect(publicState).not.toContain("stop imported");
    expect(publicState).not.toContain("Listening on port");
    expect(publicState).not.toContain("private-health");
    expect(publicState).not.toContain("serverReadyAction");

    await act(async () => expect(await ui.hook().startSelected()).toBe(true));
    expect(startDebug).toHaveBeenCalledWith({
      launch: {
        kind: "node-npm-script",
        script: "private:dev",
        packageRootPath: `${ROOT_A}/private-package`,
        args: [],
        cwd: `${ROOT_A}/private-package`,
        env: { PRIVATE_TOKEN: "hidden-value" },
        justMyCode: "nodeInternals",
        smartStep: true,
        sourceMaps: false,
        stopOnEntry: true,
      },
      preLaunchTask: { label: "build imported" },
      postDebugTask: { label: "stop imported" },
      serverReadyAction: {
        action: "openExternally",
        match: { kind: "port", prefix: "Listening on port ", suffix: "" },
        uri: { host: "localhost", path: "/private-health", scheme: "http" },
      },
    });
    ui.unmount();
  });

  it("admits a clean native watch target and disables its exact dirty document", async () => {
    const source = JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          type: "node",
          request: "launch",
          name: "Watch server",
          runtimeArgs: ["--watch", "--watch-preserve-output"],
          program: "src/server.js",
        },
      ],
    });
    const startDebug = vi.fn(async () => true);
    const clean = renderLauncher({
      isDocumentClean: (path) => path === `${ROOT_A}/src/server.js`,
      startDebug,
      workspaceReads: vscodeReadsFor(source),
    });

    await act(async () => clean.hook().load());
    await act(async () => expect(await clean.hook().startSelected()).toBe(true));
    expect(startDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeWatch: {
          kind: "native-node-watch",
          scriptPath: `${ROOT_A}/src/server.js`,
          watch: true,
          preserveOutput: true,
        },
      }),
    );
    clean.unmount();

    const dirty = renderLauncher({
      isDocumentClean: () => false,
      startDebug,
      workspaceReads: vscodeReadsFor(source),
    });
    await act(async () => dirty.hook().load());
    expect(dirty.hook().choices).toEqual([
      expect.objectContaining({ name: "Watch server", runnable: false }),
    ]);
    await expect(dirty.hook().startNamed("Watch server")).resolves.toBe(false);
    expect(startDebug).toHaveBeenCalledTimes(1);
    dirty.unmount();
  });

  it("presents imported compounds as safe disabled choices without leaking private members", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      startDebug,
      workspaceReads: vscodeReadsFor(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "private-api-member",
              program: "src/private-api.ts",
              args: ["--private-argument"],
              env: { PRIVATE_TOKEN: "hidden-value" },
            },
            {
              type: "node",
              request: "launch",
              name: "private-worker-member",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", "private-worker"],
            },
          ],
          compounds: [
            {
              name: "Services",
              configurations: ["private-api-member", "private-worker-member"],
              preLaunchTask: "private-build-task",
              stopAll: true,
            },
          ],
        }),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().choices).toContainEqual({
      compoundMemberCount: 2,
      default: false,
      hasPreLaunchTask: true,
      name: "Services",
      runnable: false,
      source: "vscode",
      targetKind: "compound",
    });
    const presentation = JSON.stringify(
      ui.hook().choices.find(({ targetKind }) => targetKind === "compound"),
    );
    expect(presentation).not.toContain("private-api-member");
    expect(presentation).not.toContain("private-worker-member");
    expect(presentation).not.toContain("private-build-task");
    expect(presentation).not.toContain("private-argument");
    expect(presentation).not.toContain("PRIVATE_TOKEN");
    await act(async () => expect(await ui.hook().startNamed("Services")).toBe(false));
    expect(startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("selects and starts a valid imported compound through the real picker lifecycle", async () => {
    const startCompoundDebug = vi.fn(async () => true);
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      startCompoundDebug,
      startDebug,
      workspaceReads: vscodeReadsFor(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            { type: "node", request: "launch", name: "API", program: "src/api.ts" },
            {
              type: "node",
              request: "launch",
              name: "Worker",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", "worker"],
            },
          ],
          compounds: [
            {
              name: "Services",
              configurations: ["API", "Worker"],
              preLaunchTask: "build services",
              stopAll: true,
            },
          ],
        }),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().selectedName).toBe("API");
    expect(ui.hook().choices).toContainEqual({
      compoundMemberCount: 2,
      default: false,
      hasPreLaunchTask: true,
      name: "Services",
      source: "vscode",
      targetKind: "compound",
    });
    act(() => ui.hook().select("Services"));
    expect(ui.hook().selectedName).toBe("Services");

    await act(async () => expect(await ui.hook().startSelected()).toBe(true));

    expect(startDebug).not.toHaveBeenCalled();
    expect(startCompoundDebug).toHaveBeenCalledExactlyOnceWith({
      kind: "compound",
      members: [
        {
          launch: {
            args: [],
            env: {},
            justMyCode: "nodeInternals",
            kind: "node-configured-script",
            scriptPath: `${ROOT_A}/src/api.ts`,
            smartStep: true,
          },
          preLaunchTask: null,
        },
        {
          launch: {
            args: [],
            env: {},
            justMyCode: "nodeInternals",
            kind: "node-npm-script",
            packageRootPath: ROOT_A,
            script: "worker",
            smartStep: true,
          },
          preLaunchTask: null,
        },
      ],
      name: "Services",
      preLaunchTask: { label: "build services" },
    });
    ui.unmount();
  });

  it("does not present ambiguous imported compound names", async () => {
    const ui = renderLauncher({
      workspaceReads: vscodeReadsFor(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            { type: "node", request: "launch", name: "API", program: "src/api.ts" },
            {
              type: "node",
              request: "launch",
              name: "Worker",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", "worker"],
            },
          ],
          compounds: [
            { name: "Services", configurations: ["API", "Worker"], stopAll: true },
            { name: "Services", configurations: ["Worker", "API"], stopAll: true },
          ],
        }),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().choices.map(({ name }) => name)).toEqual(["API", "Worker"]);
    expect(ui.hook().state).toMatchObject({
      kind: "ready",
      diagnosticNotice: { count: 2 },
    });
    ui.unmount();
  });

  it("keeps an imported attach target unfiltered when skipFiles is empty", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      startDebug,
      workspaceReads: vscodeReadsFor(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Attach",
              port: 9229,
              skipFiles: [],
            },
          ],
        }),
      ),
    });

    await act(async () => ui.hook().load());
    expect(ui.hook().choices).toEqual([
      { default: false, name: "Attach", source: "vscode", targetKind: "attach" },
    ]);
    await act(async () => expect(await ui.hook().startSelected()).toBe(true));
    expect(startDebug).toHaveBeenCalledWith({
      launch: { kind: "node-attach", port: 9229, smartStep: true },
      preLaunchTask: null,
    });
    ui.unmount();
  });

  it("opens the picker only for an exact trusted current idle owner and loads on demand", async () => {
    const openDebugPanel = vi.fn();
    const workspaceReads = readsFor(defaultSource());
    const ui = renderLauncher({ openDebugPanel, workspaceReads });

    expect(ui.hook().canOpenPicker()).toBe(true);
    act(() => ui.hook().openPicker());
    expect(ui.hook().pickerOpen).toBe(true);
    expect(openDebugPanel).toHaveBeenCalledOnce();
    await act(async () => Promise.resolve());
    expect(workspaceReads.readDirectory).toHaveBeenCalled();
    await act(async () => {
      while (ui.hook().state.kind === "loading") await Promise.resolve();
    });

    const readsBeforeReopen = workspaceReads.readDirectory.mock.calls.length;
    act(() => {
      ui.hook().closePicker();
      ui.hook().openPicker();
    });
    expect(ui.hook().pickerOpen).toBe(true);
    expect(workspaceReads.readDirectory).toHaveBeenCalledTimes(readsBeforeReopen);
    ui.unmount();
  });

  it("coalesces repeated picker opens while its bounded configuration read is in flight", async () => {
    const pending = deferred<string>();
    const workspaceReads = readsForPromise(pending.promise);
    const openDebugPanel = vi.fn();
    const ui = renderLauncher({ openDebugPanel, workspaceReads });

    act(() => {
      ui.hook().openPicker();
      ui.hook().openPicker();
    });
    await act(async () => Promise.resolve());

    expect(openDebugPanel).toHaveBeenCalledTimes(2);
    // One authoritative .vscode probe plus the legacy .codevo root/file fallback,
    // with no duplicate sequence from the second picker open.
    expect(workspaceReads.readDirectory).toHaveBeenCalledTimes(3);
    await act(async () => pending.resolve(defaultSource()));
    expect(ui.hook().state).toEqual({ kind: "ready" });
    ui.unmount();
  });

  it("refuses or closes the picker when owner, trust, reads or start idleness invalidates", async () => {
    const blockedScenarios: Partial<UseNodeDebugConfigurationLauncherOptions>[] = [
      { rootPath: null },
      { workspaceId: null },
      { workspaceTrusted: false },
      { isWorkspaceTrusted: () => false },
      { debugStartBlocked: true },
      { isDebugStartBlocked: () => true },
      { isWorkspaceCurrent: () => false },
    ];
    for (const override of blockedScenarios) {
      const openDebugPanel = vi.fn();
      const workspaceReads = readsFor(defaultSource());
      const ui = renderLauncher({ openDebugPanel, workspaceReads, ...override });
      expect(ui.hook().canOpenPicker()).toBe(false);
      act(() => ui.hook().openPicker());
      expect(ui.hook().pickerOpen).toBe(false);
      expect(openDebugPanel).not.toHaveBeenCalled();
      expect(workspaceReads.readDirectory).not.toHaveBeenCalled();
      ui.unmount();
    }

    for (const transition of [
      { rootPath: ROOT_B, workspaceId: WORKSPACE_B },
      { workspaceTrusted: false },
      { debugStartBlocked: true },
      { workspaceReads: readsFor(defaultSource()) },
    ]) {
      const ui = renderLauncher();
      act(() => ui.hook().openPicker());
      expect(ui.hook().pickerOpen).toBe(true);
      act(() => ui.set(transition));
      expect(ui.hook().pickerOpen).toBe(false);
      ui.unmount();
    }
  });

  it("maps the privately retained selected configuration through the canonical launch mapper", async () => {
    const openDebugPanel = vi.fn();
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      openDebugPanel,
      startDebug,
      workspaceReads: readsFor(
        configurationSource([
          { name: "Inspector", target: { kind: "attach", port: 9230 } },
          {
            name: "API",
            target: { kind: "script", path: "src/api.ts" },
            args: ["--port", "3000"],
            cwd: "services/api",
            env: { NODE_ENV: "development" },
          },
        ]),
      ),
    });
    await act(async () => ui.hook().load());
    act(() => ui.hook().select("API"));

    await act(async () => expect(await ui.hook().startSelected()).toBe(true));

    expect(openDebugPanel).toHaveBeenCalledOnce();
    expect(startDebug).toHaveBeenCalledWith({
      launch: {
        kind: "node-configured-script",
        scriptPath: `${ROOT_A}/src/api.ts`,
        args: ["--port", "3000"],
        cwd: `${ROOT_A}/services/api`,
        env: { NODE_ENV: "development" },
      },
      preLaunchTask: null,
    });
    ui.unmount();
  });

  it("retains a VS Code script envFile without reading it in the frontend", async () => {
    const source = JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          type: "node",
          request: "launch",
          name: "API",
          program: "src/api.ts",
          envFile: "${workspaceFolder}/config/dev.env",
          env: { PORT: "4100" },
        },
      ],
    });
    const startDebug = vi.fn(async () => true);
    const workspaceReads = vscodeReadsFor(source);
    const ui = renderLauncher({ startDebug, workspaceReads });

    await act(async () => ui.hook().load());
    await act(async () => expect(await ui.hook().startNamed("API")).toBe(true));

    expect(startDebug).toHaveBeenCalledWith({
      envFile: "config/dev.env",
      launch: {
        args: [],
        cwd: undefined,
        env: { PORT: "4100" },
        envFile: "config/dev.env",
        justMyCode: "nodeInternals",
        kind: "node-configured-script",
        scriptPath: `${ROOT_A}/src/api.ts`,
        smartStep: true,
      },
      preLaunchTask: null,
    });
    expect(workspaceReads.readFile).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it.each(["tsx", "ts-node"] as const)(
    "threads the imported direct %s runtime into the private prepared launch",
    async (runtime) => {
      const startDebug = vi.fn(async () => true);
      const ui = renderLauncher({
        startDebug,
        workspaceReads: vscodeReadsFor(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "API",
                runtimeExecutable: runtime,
                program: "src/api.ts",
              },
            ],
          }),
        ),
      });

      await act(async () => ui.hook().load());
      await act(async () => expect(await ui.hook().startNamed("API")).toBe(true));

      expect(startDebug).toHaveBeenCalledWith({
        launch: {
          args: [],
          cwd: undefined,
          env: {},
          justMyCode: "nodeInternals",
          kind: "node-configured-script",
          runtime,
          scriptPath: `${ROOT_A}/src/api.ts`,
          smartStep: true,
        },
        preLaunchTask: null,
      });
      ui.unmount();
    },
  );

  it("starts an exact private named configuration without changing selection", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      startDebug,
      workspaceReads: readsFor(
        configurationSource([
          { name: "API", default: true, target: { kind: "script", path: "src/api.ts" } },
          {
            name: "Worker",
            target: { kind: "script", path: "src/worker.ts" },
            args: ["--secret-value"],
            env: { SECRET_TOKEN: "hidden" },
          },
        ]),
      ),
    });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());

    await act(async () => expect(await ui.hook().startNamed("Worker")).toBe(true));

    expect(ui.hook().selectedName).toBe("API");
    expect(ui.hook().pickerOpen).toBe(false);
    expect(startDebug).toHaveBeenCalledWith({
      launch: {
        kind: "node-configured-script",
        scriptPath: `${ROOT_A}/src/worker.ts`,
        args: ["--secret-value"],
        cwd: undefined,
        env: { SECRET_TOKEN: "hidden" },
      },
      preLaunchTask: null,
    });
    expect(JSON.stringify(ui.hook())).not.toContain("secret-value");
    expect(JSON.stringify(ui.hook())).not.toContain("SECRET_TOKEN");
    await act(async () => expect(await ui.hook().startNamed("Missing")).toBe(false));
    expect(startDebug).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("keeps the picker open unless the named start is accepted", async () => {
    const ui = renderLauncher({
      startDebug: vi.fn(async () => {
        throw new Error("SECRET_TOKEN=hidden");
      }),
    });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());

    await act(async () => expect(await ui.hook().startNamed("API")).toBe(false));

    expect(ui.hook().pickerOpen).toBe(true);
    expect(ui.hook().state).toEqual({
      kind: "error",
      message: NODE_DEBUG_CONFIGURATION_START_ERROR,
    });
    ui.unmount();
  });

  it("keeps the picker open and returns false when the debug session rejects the start", async () => {
    const startDebug = vi.fn(async () => false);
    const ui = renderLauncher({ startDebug });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());

    await act(async () => expect(await ui.hook().startSelected()).toBe(false));

    expect(startDebug).toHaveBeenCalledOnce();
    expect(ui.hook().pickerOpen).toBe(true);
    expect(ui.hook().state).toEqual({ kind: "ready" });
    expect(ui.hook().busy).toBe(false);
    ui.unmount();
  });

  it("keeps the picker visible while a named start is pending and closes after acceptance", async () => {
    const pending = deferred<boolean>();
    const ui = renderLauncher({ startDebug: vi.fn(() => pending.promise) });
    await act(async () => ui.hook().load());
    act(() => ui.hook().openPicker());
    let started!: Promise<boolean>;
    act(() => {
      started = ui.hook().startNamed("API");
    });

    expect(ui.hook().busy).toBe(true);
    expect(ui.hook().pickerOpen).toBe(true);
    await act(async () => pending.resolve(true));
    await expect(started).resolves.toBe(true);
    expect(ui.hook().pickerOpen).toBe(false);
    ui.unmount();
  });

  it("ignores unknown selections and never falls back to another configuration", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({ startDebug });
    await act(async () => ui.hook().load());
    expect(ui.hook().selectedName).toBe("API");
    act(() => ui.hook().select("Missing"));
    expect(ui.hook().selectedName).toBe("API");

    act(() => ui.set({ rootPath: ROOT_B, workspaceId: WORKSPACE_B }));
    await act(async () => expect(await ui.hook().startSelected()).toBe(false));
    expect(startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("represents missing, empty and invalid configuration files explicitly", async () => {
    const missing = renderLauncher({ workspaceReads: missingReads() });
    await act(async () => missing.hook().load());
    expect(missing.hook().state).toEqual({ kind: "empty" });
    expect(missing.hook().choices).toEqual([]);
    missing.unmount();

    const empty = renderLauncher({ workspaceReads: readsFor(configurationSource([])) });
    await act(async () => empty.hook().load());
    expect(empty.hook().state).toEqual({ kind: "empty" });
    empty.unmount();

    const invalid = renderLauncher({ workspaceReads: readsFor("not-json") });
    await act(async () => invalid.hook().refresh());
    expect(invalid.hook().state).toMatchObject({ kind: "error" });
    invalid.unmount();
  });

  it("keeps workspace read exception details out of public launcher state", async () => {
    const secretPath = "/private/workspace/SECRET_TOKEN/launch.json";
    const secretToken = "token-super-secret";
    const ui = renderLauncher({
      workspaceReads: directoryReads(
        vi.fn(async () => {
          throw new Error(`permission denied at ${secretPath}: ${secretToken}`);
        }),
      ),
    });

    await act(async () => ui.hook().load());

    expect(ui.hook().state).toEqual({
      kind: "error",
      message: ".codevo/launch.json could not be read.",
    });
    const publicState = JSON.stringify(ui.hook().state);
    expect(publicState).not.toContain(secretPath);
    expect(publicState).not.toContain(secretToken);
    expect(publicState).not.toContain("permission denied");
    ui.unmount();
  });

  it("fails closed before IO without a trusted current idle workspace identity", async () => {
    const scenarios: Partial<UseNodeDebugConfigurationLauncherOptions>[] = [
      { rootPath: null },
      { workspaceId: null },
      { workspaceTrusted: false },
      { isWorkspaceTrusted: () => false },
      { debugStartBlocked: true },
      { isDebugStartBlocked: () => true },
      { isWorkspaceCurrent: () => false },
      {
        isWorkspaceCurrent: () => {
          throw new Error("identity unavailable");
        },
      },
    ];
    for (const override of scenarios) {
      const workspaceReads = readsFor(defaultSource());
      const ui = renderLauncher({ workspaceReads, ...override });
      await act(async () => ui.hook().load());
      expect(workspaceReads.readDirectory).not.toHaveBeenCalled();
      expect(ui.hook().state).toEqual({ kind: "idle" });
      ui.unmount();
    }
  });

  it("drops a read when root, identity, trust or debug idleness changes before completion", async () => {
    for (const transition of [
      { rootPath: ROOT_B, workspaceId: WORKSPACE_B },
      { workspaceId: WORKSPACE_B },
      { workspaceTrusted: false },
      { debugStartBlocked: true },
    ]) {
      const pending = deferred<string>();
      const ui = renderLauncher({ workspaceReads: readsForPromise(pending.promise) });
      let load!: Promise<void>;
      act(() => {
        load = ui.hook().load();
      });
      await act(async () => Promise.resolve());
      act(() => ui.set(transition));
      await act(async () => pending.resolve(defaultSource()));
      await load;
      expect(ui.hook().state).toEqual({ kind: "idle" });
      expect(ui.hook().choices).toEqual([]);
      ui.unmount();
    }
  });

  it("uses request generations so a newer refresh wins and stale selections cannot start", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const readFile = vi
      .fn<NodeLaunchConfigurationReads["readFile"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({ startDebug, workspaceReads: directoryReads(readFile) });
    let firstLoad!: Promise<void>;
    let secondLoad!: Promise<void>;
    act(() => {
      firstLoad = ui.hook().load();
    });
    await act(async () => Promise.resolve());
    expect(readFile).toHaveBeenCalledTimes(1);
    act(() => {
      secondLoad = ui.hook().refresh();
    });
    await act(async () =>
      second.resolve(
        configurationSource([{ name: "New", target: { kind: "attach", port: 9231 } }]),
      ),
    );
    await secondLoad;
    await act(async () => first.resolve(defaultSource()));
    await firstLoad;

    expect(ui.hook().choices.map(({ name }) => name)).toEqual(["New"]);
    expect(ui.hook().selectedName).toBe("New");
    await act(async () => expect(await ui.hook().startSelected()).toBe(true));
    expect(startDebug).toHaveBeenCalledWith({
      launch: { kind: "node-attach", port: 9231 },
      preLaunchTask: null,
    });
    ui.unmount();
  });

  it("invalidates the previous generation immediately when refresh begins", async () => {
    const pending = deferred<string>();
    const readFile = vi
      .fn<NodeLaunchConfigurationReads["readFile"]>()
      .mockResolvedValueOnce(defaultSource())
      .mockImplementationOnce(() => pending.promise);
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({ startDebug, workspaceReads: directoryReads(readFile) });
    await act(async () => ui.hook().load());
    let refresh!: Promise<void>;
    act(() => {
      refresh = ui.hook().refresh();
    });

    expect(ui.hook().state).toEqual({ kind: "loading" });
    expect(ui.hook().selectedName).toBeNull();
    await act(async () => expect(await ui.hook().startSelected()).toBe(false));
    expect(startDebug).not.toHaveBeenCalled();
    await act(async () => pending.resolve(defaultSource()));
    await refresh;
    ui.unmount();
  });

  it("rechecks owner, trust and idle session after opening the panel but before start", async () => {
    let trusted = true;
    const startDebug = vi.fn(async () => true);
    const ui = renderLauncher({
      isWorkspaceTrusted: () => trusted,
      openDebugPanel: () => {
        trusted = false;
      },
      startDebug,
    });
    await act(async () => ui.hook().load());

    await act(async () => expect(await ui.hook().startSelected()).toBe(false));
    expect(startDebug).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("allows only one physical launch and never exposes a start error containing secrets", async () => {
    const pending = deferred<boolean>();
    const startDebug = vi
      .fn(async () => pending.promise)
      .mockImplementationOnce(async () => pending.promise);
    const ui = renderLauncher({ startDebug });
    await act(async () => ui.hook().load());
    let first!: Promise<boolean>;
    act(() => {
      first = ui.hook().startSelected();
    });
    expect(ui.hook().busy).toBe(true);
    await act(async () => expect(await ui.hook().startSelected()).toBe(false));
    expect(startDebug).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    await expect(first).resolves.toBe(true);
    expect(ui.hook().busy).toBe(false);
    ui.unmount();

    const message = `${"ž".repeat(MAX_NODE_DEBUG_CONFIGURATION_LAUNCHER_MESSAGE_BYTES)} SECRET_TOKEN=hidden --secret-argument\u202e`;
    const failing = renderLauncher({
      startDebug: vi.fn(async () => {
        throw new Error(message);
      }),
    });
    await act(async () => failing.hook().load());
    await act(async () => expect(await failing.hook().startSelected()).toBe(false));
    const failedState = failing.hook().state;
    expect(failedState.kind).toBe("error");
    const rendered = failedState.kind === "error" ? failedState.message : "";
    expect(rendered).toBe(NODE_DEBUG_CONFIGURATION_START_ERROR);
    expect(rendered).not.toContain("SECRET_TOKEN");
    expect(rendered).not.toContain("secret-argument");
    expect(rendered).not.toContain("\u202e");
    failing.unmount();
  });

  it("blocks an old loaded configuration synchronously when the read port changes", async () => {
    const root = createRoot(document.createElement("div"));
    const startDebug = vi.fn(async () => true);
    let workspaceReads = readsFor(defaultSource());
    let launcher: NodeDebugConfigurationLauncher | null = null;
    let immediateStart: Promise<boolean> | null = null;
    function Harness() {
      launcher = useNodeDebugConfigurationLauncher({
        debugStartBlocked: false,
        isDebugStartBlocked: () => false,
        isWorkspaceCurrent: () => true,
        isWorkspaceTrusted: () => true,
        openDebugPanel: vi.fn(),
        rootPath: ROOT_A,
        startDebug,
        workspaceId: WORKSPACE_A,
        workspaceReads,
        workspaceTrusted: true,
      });
      const previousReadsRef = useRef(workspaceReads);
      useLayoutEffect(() => {
        if (previousReadsRef.current === workspaceReads) return;
        previousReadsRef.current = workspaceReads;
        immediateStart = launcher!.startSelected();
      });
      return null;
    }
    act(() => root.render(<Harness />));
    await act(async () => launcher!.load());

    workspaceReads = readsFor(defaultSource());
    act(() => root.render(<Harness />));

    await expect(immediateStart).resolves.toBe(false);
    expect(startDebug).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

function renderLauncher(
  overrides: Partial<UseNodeDebugConfigurationLauncherOptions> = {},
  strictMode = false,
) {
  const root = createRoot(document.createElement("div"));
  let props: UseNodeDebugConfigurationLauncherOptions = {
    debugStartBlocked: false,
    isDebugStartBlocked: () => false,
    isWorkspaceCurrent: (rootPath, workspaceId) =>
      rootPath === props.rootPath && workspaceId === props.workspaceId,
    isWorkspaceTrusted: () => true,
    openDebugPanel: vi.fn(),
    rootPath: ROOT_A,
    startDebug: vi.fn(async () => true),
    workspaceId: WORKSPACE_A,
    workspaceReads: readsFor(defaultSource()),
    workspaceTrusted: true,
    ...overrides,
  };
  let current: NodeDebugConfigurationLauncher | null = null;
  function Harness() {
    current = useNodeDebugConfigurationLauncher(props);
    return null;
  }
  act(() =>
    root.render(
      strictMode ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    ),
  );
  return {
    hook: () => current as NodeDebugConfigurationLauncher,
    set(overrides: Partial<UseNodeDebugConfigurationLauncherOptions>) {
      props = { ...props, ...overrides };
      root.render(<Harness />);
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function defaultSource(): string {
  return configurationSource([{ name: "API", target: { kind: "script", path: "src/api.ts" } }]);
}

function configurationSource(configurations: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ version: 1, configurations });
}

function readsFor(source: string): NodeLaunchConfigurationReads & {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationReads["readDirectory"]>>;
} {
  return directoryReads(vi.fn(async () => source));
}

function readsForPromise(source: Promise<string>): NodeLaunchConfigurationReads {
  return directoryReads(vi.fn(() => source));
}

function vscodeReadsFor(source: string): NodeLaunchConfigurationReads {
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT_A || path === ROOT_B
        ? [{ kind: "directory" as const, name: ".vscode", path: `${path}/.vscode` }]
        : [{ kind: "file" as const, name: "launch.json", path: `${path}/launch.json` }],
    ),
    readFile: vi.fn(async () => source),
  };
}

function directoryReads(
  readFile: NodeLaunchConfigurationReads["readFile"],
): NodeLaunchConfigurationReads & {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationReads["readDirectory"]>>;
} {
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT_A || path === ROOT_B
        ? [{ kind: "directory" as const, name: ".codevo", path: `${path}/.codevo` }]
        : [
            {
              kind: "file" as const,
              name: "launch.json",
              path: `${path}/launch.json`,
            },
          ],
    ),
    readFile,
  };
}

function missingReads(): NodeLaunchConfigurationReads & {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationReads["readDirectory"]>>;
} {
  return { readDirectory: vi.fn(async () => []), readFile: vi.fn(async () => "") };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
