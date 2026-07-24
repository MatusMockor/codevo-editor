// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MAX_NODE_DEBUG_CONFIGURATION_LAUNCHER_MESSAGE_BYTES } from "./useNodeDebugConfigurationLauncher";
import { useConfiguredNodeLaunchStarter } from "./useConfiguredNodeLaunchStarter";

const ROOT = "/workspace";
const DOCUMENT = `${ROOT}/src/server.js`;
const WORKSPACE_ID = "workspace-id";

describe("useConfiguredNodeLaunchStarter", () => {
  it("allows the trusted current-document fallback without reading owner-scoped configuration", async () => {
    const readDirectory = vi.fn(configDirectories);
    const readTextFile = vi.fn(async () => configuredSource());
    const openDebugPanel = vi.fn();
    const reportWarning = vi.fn();
    const startDebug = vi.fn();
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      openDebugPanel,
      reportWarning,
      startDebug,
      workspaceFiles: { readDirectory, readTextFile },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, null)).toBe(false));

    expect(readDirectory).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
    expect(openDebugPanel).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(startDebug).not.toHaveBeenCalled();
  });

  it.each(["trust loss", "active debug session", "active document replacement"] as const)(
    "consumes a null-owner launch after %s instead of permitting fallback",
    async (transition) => {
      let trusted = true;
      let debugStartBlocked = false;
      let activeDocumentPath = DOCUMENT;
      const readDirectory = vi.fn(configDirectories);
      const readTextFile = vi.fn(async () => configuredSource());
      const openDebugPanel = vi.fn();
      const startDebug = vi.fn();
      const ui = renderStarter({
        getActiveDocumentPath: () => activeDocumentPath,
        isDebugStartBlocked: () => debugStartBlocked,
        isWorkspaceTrusted: () => trusted,
        openDebugPanel,
        startDebug,
        workspaceFiles: { readDirectory, readTextFile },
      });
      if (transition === "trust loss") trusted = false;
      else if (transition === "active debug session") debugStartBlocked = true;
      else activeDocumentPath = `${ROOT}/src/replacement.js`;

      await act(async () => expect(await ui.start()(ROOT, DOCUMENT, null)).toBe(true));

      expect(readDirectory).not.toHaveBeenCalled();
      expect(readTextFile).not.toHaveBeenCalled();
      expect(openDebugPanel).not.toHaveBeenCalled();
      expect(startDebug).not.toHaveBeenCalled();
    },
  );

  it("starts a matching configured launch", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      openDebugPanel: vi.fn(),
      reportWarning: vi.fn(),
      startDebug,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: async () =>
          JSON.stringify({
            version: 1,
            configurations: [{ name: "API", target: { kind: "script", path: "src/server.js" } }],
          }),
      },
    });
    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));
    expect(startDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: expect.objectContaining({
          kind: "node-configured-script",
          scriptPath: DOCUMENT,
        }),
        preLaunchTask: null,
      }),
    );
  });

  it("preserves an exact VS Code preLaunchTask for direct F5", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderStarter({
      startDebug,
      workspaceFiles: {
        readDirectory: async (path) =>
          path === ROOT
            ? [{ kind: "directory", name: ".vscode", path: `${ROOT}/.vscode` }]
            : [{ kind: "file", name: "launch.json", path: `${ROOT}/.vscode/launch.json` }],
        readTextFile: async () =>
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "API",
                program: "src/server.js",
                preLaunchTask: "build api",
                postDebugTask: "stop api",
              },
            ],
          }),
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));

    expect(startDebug).toHaveBeenCalledWith({
      launch: expect.objectContaining({
        kind: "node-configured-script",
        scriptPath: DOCUMENT,
      }),
      preLaunchTask: { label: "build api" },
      postDebugTask: { label: "stop api" },
    });
  });

  it("preserves the real gateway receiver while loading a direct VS Code F5 launch", async () => {
    const workspaceFiles = new ReceiverSensitiveWorkspaceReads();
    const startDebug = vi.fn(async () => true);
    const ui = renderStarter({ startDebug, workspaceFiles });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));

    expect(workspaceFiles.calls).toEqual([
      ["directory", ROOT],
      ["directory", `${ROOT}/.vscode`],
      ["bounded", `${ROOT}/.vscode/launch.json`, 262_144],
    ]);
    expect(startDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: expect.objectContaining({
          kind: "node-configured-script",
          scriptPath: DOCUMENT,
        }),
        preLaunchTask: null,
      }),
    );
  });

  it("starts the only imported VS Code npm target through direct F5", async () => {
    const startDebug = vi.fn(async () => true);
    const ui = renderStarter({
      startDebug,
      workspaceFiles: {
        readDirectory: vscodeConfigDirectories,
        readTextFile: async () =>
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "API dev",
                runtimeExecutable: "npm",
                runtimeArgs: ["run", "dev:api"],
                args: [],
                cwd: "${workspaceFolder}/apps/api",
                env: { NODE_ENV: "development" },
                preLaunchTask: "build api",
                skipFiles: ["<node_internals>/**"],
                serverReadyAction: {
                  action: "openExternally",
                  pattern: "Listening on port ([0-9]+)",
                  uriFormat: "http://localhost:%s/health",
                },
              },
            ],
          }),
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));

    expect(startDebug).toHaveBeenCalledWith({
      launch: {
        kind: "node-npm-script",
        script: "dev:api",
        packageRootPath: `${ROOT}/apps/api`,
        args: [],
        cwd: `${ROOT}/apps/api`,
        env: { NODE_ENV: "development" },
        justMyCode: "nodeInternals",
      },
      preLaunchTask: { label: "build api" },
      serverReadyAction: {
        action: "openExternally",
        match: { kind: "port", prefix: "Listening on port ", suffix: "" },
        uri: { host: "localhost", path: "/health", scheme: "http" },
      },
    });
  });

  it("does not guess a direct F5 npm target when multiple imported entries remain", async () => {
    const startDebug = vi.fn();
    const ui = renderStarter({
      startDebug,
      workspaceFiles: {
        readDirectory: vscodeConfigDirectories,
        readTextFile: async () =>
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Dev",
                runtimeExecutable: "npm",
                runtimeArgs: ["run", "dev"],
              },
              {
                type: "node",
                request: "launch",
                name: "Build",
                runtimeExecutable: "npm",
                runtimeArgs: ["run", "build"],
              },
            ],
          }),
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(false));
    expect(startDebug).not.toHaveBeenCalled();
  });

  it("starts the persisted default Node attach configuration", async () => {
    const openDebugPanel = vi.fn();
    const startDebug = vi.fn(async () => true);
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      openDebugPanel,
      reportWarning: vi.fn(),
      startDebug,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: async () =>
          JSON.stringify({
            version: 1,
            configurations: [
              {
                name: "Local inspector",
                default: true,
                target: { kind: "attach", port: 9229 },
              },
            ],
          }),
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));

    expect(openDebugPanel).toHaveBeenCalledOnce();
    expect(startDebug).toHaveBeenCalledWith({
      launch: { kind: "node-attach", port: 9229 },
      preLaunchTask: null,
    });
  });

  it("reports IO errors and fails closed without the active-file fallback", async () => {
    const reportWarning = vi.fn();
    const openDebugPanel = vi.fn();
    const startDebug = vi.fn();
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      openDebugPanel,
      reportWarning,
      startDebug,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: async () => {
          throw new Error("permission denied");
        },
      },
    });
    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));
    expect(reportWarning).toHaveBeenCalledWith("Debug: .codevo/launch.json could not be read.");
    expect(reportWarning).not.toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    expect(openDebugPanel).not.toHaveBeenCalled();
    expect(startDebug).not.toHaveBeenCalled();
  });

  it("consumes a stale read without launching or falling back", async () => {
    let workspaceCurrent = true;
    const read = deferred<string>();
    const startDebug = vi.fn();
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      isWorkspaceCurrent: () => workspaceCurrent,
      openDebugPanel: vi.fn(),
      reportWarning: vi.fn(),
      startDebug,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: () => read.promise,
      },
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = ui.start()(ROOT, DOCUMENT, WORKSPACE_ID);
    });
    workspaceCurrent = false;
    await act(async () => read.resolve('{"version":1,"configurations":[]}'));
    await expect(pending).resolves.toBe(true);
    expect(startDebug).not.toHaveBeenCalled();
  });

  it.each(["trust loss", "same-root owner replacement", "active debug session"] as const)(
    "consumes a deferred configured launch after %s without opening or starting",
    async (transition) => {
      let trusted = true;
      let currentWorkspaceId = WORKSPACE_ID;
      let debugStartBlocked = false;
      const read = deferred<string>();
      const openDebugPanel = vi.fn();
      const startDebug = vi.fn();
      const ui = renderStarter({
        getActiveDocumentPath: () => DOCUMENT,
        isDebugStartBlocked: () => debugStartBlocked,
        isWorkspaceCurrent: (_rootPath, workspaceId) => workspaceId === currentWorkspaceId,
        isWorkspaceTrusted: () => trusted,
        openDebugPanel,
        startDebug,
        workspaceFiles: {
          readDirectory: configDirectories,
          readTextFile: () => read.promise,
        },
      });
      let pending!: Promise<boolean>;
      act(() => {
        pending = ui.start()(ROOT, DOCUMENT, WORKSPACE_ID);
      });
      await act(async () => Promise.resolve());
      if (transition === "trust loss") trusted = false;
      else if (transition === "same-root owner replacement") currentWorkspaceId = "replacement";
      else debugStartBlocked = true;
      await act(async () => read.resolve(configuredSource()));

      await expect(pending).resolves.toBe(true);
      expect(openDebugPanel).not.toHaveBeenCalled();
      expect(startDebug).not.toHaveBeenCalled();
    },
  );

  it("rechecks admission after opening the panel and before starting", async () => {
    let trusted = true;
    const startDebug = vi.fn();
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      isWorkspaceTrusted: () => trusted,
      openDebugPanel: () => {
        trusted = false;
      },
      startDebug,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: async () => configuredSource(),
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));
    expect(startDebug).not.toHaveBeenCalled();
  });

  it("bounds and neutralizes control and bidi characters in invalid warnings", async () => {
    const reportWarning = vi.fn();
    const ui = renderStarter({
      getActiveDocumentPath: () => DOCUMENT,
      reportWarning,
      workspaceFiles: {
        readDirectory: configDirectories,
        readTextFile: async () => {
          throw new Error(`${"ž".repeat(5_000)}\n\u202e`);
        },
      },
    });

    await act(async () => expect(await ui.start()(ROOT, DOCUMENT, WORKSPACE_ID)).toBe(true));
    const warning = reportWarning.mock.lastCall?.[0] as string;
    expect(new TextEncoder().encode(warning).byteLength).toBeLessThanOrEqual(
      MAX_NODE_DEBUG_CONFIGURATION_LAUNCHER_MESSAGE_BYTES,
    );
    expect(warning).not.toMatch(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u);
  });
});

type StarterOptions = Parameters<typeof useConfiguredNodeLaunchStarter>[0];

function renderStarter(overrides: Partial<StarterOptions>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const options: StarterOptions = {
    getActiveDocumentPath: () => DOCUMENT,
    isDebugStartBlocked: () => false,
    isWorkspaceCurrent: (rootPath, workspaceId) =>
      rootPath === ROOT && workspaceId === WORKSPACE_ID,
    isWorkspaceTrusted: () => true,
    openDebugPanel: vi.fn(),
    reportWarning: vi.fn(),
    startDebug: vi.fn(async () => true),
    workspaceFiles: {
      readDirectory: configDirectories,
      readTextFile: async () => configuredSource(),
    },
    ...overrides,
  };
  let current: ReturnType<typeof useConfiguredNodeLaunchStarter> | null = null;
  function Harness() {
    current = useConfiguredNodeLaunchStarter(options);
    return null;
  }
  act(() => root.render(<Harness />));
  return { start: () => current as NonNullable<typeof current> };
}

function configuredSource(): string {
  return JSON.stringify({
    version: 1,
    configurations: [{ name: "API", target: { kind: "script", path: "src/server.js" } }],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function configDirectories(path: string) {
  return path === ROOT
    ? [{ kind: "directory" as const, name: ".codevo", path: `${ROOT}/.codevo` }]
    : [{ kind: "file" as const, name: "launch.json", path: `${ROOT}/.codevo/launch.json` }];
}

async function vscodeConfigDirectories(path: string) {
  return path === ROOT
    ? [{ kind: "directory" as const, name: ".vscode", path: `${ROOT}/.vscode` }]
    : [{ kind: "file" as const, name: "launch.json", path: `${ROOT}/.vscode/launch.json` }];
}

class ReceiverSensitiveWorkspaceReads {
  readonly calls: unknown[][] = [];
  readonly #receiver = "workspace-reads";

  async readDirectory(path: string) {
    this.assertReceiver();
    this.calls.push(["directory", path]);
    return vscodeConfigDirectories(path);
  }

  async readTextFile(path: string) {
    this.assertReceiver();
    this.calls.push(["file", path]);
    return this.source();
  }

  async readTextFileBounded(path: string, maxBytes: number) {
    this.assertReceiver();
    this.calls.push(["bounded", path, maxBytes]);
    return { status: "ok" as const, content: this.source() };
  }

  private source() {
    return JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          type: "node",
          request: "launch",
          name: "Watch server",
          program: "src/server.js",
          runtimeArgs: ["--watch"],
        },
      ],
    });
  }

  private assertReceiver() {
    if (this.#receiver !== "workspace-reads") {
      throw new Error("Workspace read method lost its receiver.");
    }
  }
}
