import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import { NODE_LAUNCH_CONFIGURATION_MAX_BYTES } from "../domain/nodeLaunchConfiguration";
import {
  loadConfiguredNodeLaunch,
  loadNodeLaunchConfigurations,
  NODE_LAUNCH_CONFIGURATION_READ_ERROR,
} from "./nodeLaunchConfigurationLoader";

const ROOT = "/workspace/project";
const DOCUMENT = `${ROOT}/src/server.ts`;
const CONFIG_DIRECTORY = `${ROOT}/.codevo`;
const CONFIG_PATH = `${CONFIG_DIRECTORY}/launch.json`;

describe("loadNodeLaunchConfigurations", () => {
  it("retains every named target, including non-default npm and attach configurations", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("unbounded read must not run");
    });
    const readFileBounded = vi.fn(async () => ({
      status: "ok" as const,
      content: JSON.stringify({
        version: 1,
        configurations: [
          { name: "Inspector", target: { kind: "attach", port: 9230 } },
          {
            name: "API",
            default: true,
            target: { kind: "script", path: "src/server.ts" },
            args: ["--watch"],
            cwd: "services/api",
            env: { NODE_ENV: "development" },
          },
          {
            name: "Focused tests",
            target: {
              kind: "test",
              path: "src/server.test.ts",
              runner: "vitest",
              packageRoot: "services/api",
            },
          },
          {
            name: "Worker npm",
            target: { kind: "npm", script: "worker:dev", packageRoot: "services/worker" },
            args: ["--verbose"],
          },
        ],
      }),
    }));

    const result = await loadNodeLaunchConfigurations(
      ROOT,
      { readDirectory: configDirectories, readFile, readFileBounded },
      () => true,
    );

    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [
        {
          name: "Inspector",
          default: false,
          target: { kind: "attach", port: 9230 },
          args: [],
          env: {},
        },
        {
          name: "API",
          default: true,
          target: { kind: "script", path: "src/server.ts" },
          args: ["--watch"],
          cwd: "services/api",
          env: { NODE_ENV: "development" },
        },
        {
          name: "Focused tests",
          default: false,
          target: {
            kind: "test",
            path: "src/server.test.ts",
            runner: "vitest",
            packageRoot: "services/api",
          },
          args: [],
          env: {},
        },
        {
          name: "Worker npm",
          default: false,
          target: { kind: "npm", script: "worker:dev", packageRoot: "services/worker" },
          args: ["--verbose"],
          env: {},
        },
      ],
      entries: [
        { source: "codevo", configuration: { name: "Inspector" } },
        { source: "codevo", configuration: { name: "API" } },
        { source: "codevo", configuration: { name: "Focused tests" } },
        { source: "codevo", configuration: { name: "Worker npm" } },
      ],
      diagnostics: [],
    });
    expect(readFileBounded).toHaveBeenCalledWith(CONFIG_PATH, NODE_LAUNCH_CONFIGURATION_MAX_BYTES);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("never follows forged directory-entry paths outside the workspace", async () => {
    const readDirectory = vi.fn(async (path: string) =>
      path === ROOT
        ? [{ kind: "directory" as const, name: ".codevo", path: "/outside/forged" }]
        : [{ kind: "file" as const, name: "launch.json", path: "/outside/secret.json" }],
    );
    const readFile = vi.fn(async () => JSON.stringify({ version: 1, configurations: [] }));

    await expect(
      loadNodeLaunchConfigurations(ROOT, { readDirectory, readFile }, () => true),
    ).resolves.toEqual({
      kind: "loaded",
      configurations: [],
      entries: [],
      diagnostics: [],
    });

    expect(readDirectory).toHaveBeenNthCalledWith(1, ROOT);
    expect(readDirectory).toHaveBeenNthCalledWith(2, ROOT);
    expect(readDirectory).toHaveBeenNthCalledWith(3, CONFIG_DIRECTORY);
    expect(readFile).toHaveBeenCalledWith(CONFIG_PATH);
    expect(readDirectory).not.toHaveBeenCalledWith("/outside/forged");
    expect(readFile).not.toHaveBeenCalledWith("/outside/secret.json");
  });

  it("distinguishes a missing file from malformed and oversized files", async () => {
    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        { readDirectory: async () => [], readFile: vi.fn() },
        () => true,
      ),
    ).resolves.toEqual({ kind: "none" });
    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        { readDirectory: configDirectories, readFile: async () => "{" },
        () => true,
      ),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("must contain valid JSON"),
    });
    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        {
          readDirectory: configDirectories,
          readFile: vi.fn(),
          readFileBounded: async () => ({ status: "tooLarge" }),
        },
        () => true,
      ),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining(`${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes`),
    });
  });

  it("retains exactly 64 configurations and rejects a 65th", async () => {
    const configurations = Array.from({ length: 65 }, (_, index) => ({
      name: `Target ${index}`,
      target: { kind: "script", path: `src/${index}.js` },
    }));
    const load = (count: number) =>
      loadNodeLaunchConfigurations(
        ROOT,
        {
          readDirectory: configDirectories,
          readFile: async () =>
            JSON.stringify({ version: 1, configurations: configurations.slice(0, count) }),
        },
        () => true,
      );

    await expect(load(64)).resolves.toMatchObject({
      kind: "loaded",
      configurations: { length: 64 },
    });
    await expect(load(65)).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("at most 64 configurations"),
    });
  });

  it("returns stale before IO and after an awaited root read", async () => {
    const readDirectory = vi.fn(configDirectories);
    await expect(
      loadNodeLaunchConfigurations(ROOT, { readDirectory, readFile: vi.fn() }, () => false),
    ).resolves.toEqual({ kind: "stale" });
    expect(readDirectory).not.toHaveBeenCalled();

    const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(
      loadNodeLaunchConfigurations(ROOT, { readDirectory, readFile: vi.fn() }, current),
    ).resolves.toEqual({ kind: "stale" });
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it("keeps .vscode authoritative and never reads .codevo when both files exist", async () => {
    const readFileBounded = vi.fn(async (path: string) => {
      if (path.includes("/.codevo/")) throw new Error("Codevo fallback must not be read");
      return {
        status: "ok" as const,
        content: JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "VS Code API",
              program: "src/server.ts",
            },
          ],
        }),
      };
    });
    const result = await loadNodeLaunchConfigurations(
      ROOT,
      {
        readDirectory: bothConfigurationDirectories,
        readFile: vi.fn(),
        readFileBounded,
      },
      () => true,
    );

    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [{ name: "VS Code API" }],
      entries: [{ source: "vscode", configuration: { name: "VS Code API" } }],
      diagnostics: [],
    });
    expect(readFileBounded).toHaveBeenCalledOnce();
    expect(readFileBounded).toHaveBeenCalledWith(
      `${ROOT}/.vscode/launch.json`,
      NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
    );
  });

  it("does not hide an invalid .vscode file behind a valid Codevo fallback", async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.vscode/launch.json`) return "{";
      throw new Error("Codevo fallback must not be read");
    });

    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        { readDirectory: bothConfigurationDirectories, readFile },
        () => true,
      ),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining(".vscode/launch.json"),
    });
    expect(readFile).toHaveBeenCalledOnce();
  });

  it("imports VS Code entries, diagnostics, and private lifecycle task metadata", async () => {
    const vscodePath = `${ROOT}/.vscode/launch.json`;
    const source = `{
      "version": "0.2.0",
      "configurations": [
        {
          "type": "node",
          "request": "launch",
          "name": "VS Code API",
          "program": "src/server.ts",
          "preLaunchTask": "build",
          "postDebugTask": "cleanup",
          "skipFiles": ["<node_internals>/**"]
        },
        {
          "type": "python",
          "request": "launch",
          "name": "Ignored",
          "program": "src/server.py"
        }
      ]
    }`;
    const readFileBounded = vi.fn(async (path: string) => {
      expect(path).toBe(vscodePath);
      return { status: "ok" as const, content: source };
    });
    const result = await loadNodeLaunchConfigurations(
      ROOT,
      {
        readDirectory: vscodeConfigurationDirectories,
        readFile: vi.fn(),
        readFileBounded,
      },
      () => true,
    );

    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [{ name: "VS Code API" }],
      entries: [
        {
          source: "vscode",
          configuration: { name: "VS Code API" },
          justMyCode: "nodeInternals",
          preLaunchTask: "build",
          postDebugTask: "cleanup",
        },
      ],
      diagnostics: [
        {
          source: "vscode",
          configurationIndex: 1,
          message: expect.stringContaining('type must be "node" or "pwa-node"'),
        },
      ],
    });
    if (result.kind !== "loaded") return;
    expect(result.configurations[0]).not.toHaveProperty("postDebugTask");
  });

  it("retains private native watch metadata without projecting it into launch configurations", async () => {
    const result = await loadNodeLaunchConfigurations(
      ROOT,
      {
        readDirectory: vscodeConfigurationDirectories,
        readFile: async () =>
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Native watch",
                program: "src/server.cjs",
                runtimeArgs: ["--watch", "--watch-preserve-output"],
              },
            ],
          }),
      },
      () => true,
    );

    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [
        {
          name: "Native watch",
          target: { kind: "script", path: "src/server.cjs" },
        },
      ],
      entries: [
        {
          source: "vscode",
          configuration: {
            name: "Native watch",
            target: { kind: "script", path: "src/server.cjs" },
          },
          nativeWatch: {
            kind: "native-node-watch",
            scriptPath: "src/server.cjs",
            watch: true,
            preserveOutput: true,
          },
        },
      ],
    });
    if (result.kind !== "loaded") return;
    expect(result.configurations[0]).not.toHaveProperty("nativeWatch");
    expect(result.configurations[0]).not.toHaveProperty("runtimeArgs");
    const entry = result.entries[0];
    expect(entry?.source).toBe("vscode");
    if (entry?.source !== "vscode") return;
    expect(entry.nativeWatch).not.toHaveProperty("runtime");
  });

  it("loads the exact minimal VS Code native-watch configuration without a Codevo file", async () => {
    const vscodePath = `${ROOT}/.vscode/launch.json`;
    const readFile = vi.fn(async (path: string) => {
      expect(path).toBe(vscodePath);
      return JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Watch server",
            program: "server.js",
            runtimeArgs: ["--watch"],
          },
        ],
      });
    });

    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        { readDirectory: vscodeConfigurationDirectories, readFile },
        () => true,
      ),
    ).resolves.toMatchObject({
      kind: "loaded",
      configurations: [
        {
          name: "Watch server",
          target: { kind: "script", path: "server.js" },
        },
      ],
      entries: [
        {
          source: "vscode",
          configuration: {
            name: "Watch server",
            target: { kind: "script", path: "server.js" },
          },
          nativeWatch: {
            kind: "native-node-watch",
            scriptPath: "server.js",
            watch: true,
          },
        },
      ],
      diagnostics: [],
    });
    expect(readFile).toHaveBeenCalledOnce();
  });

  it("loads authoritative .vscode without probing an available Codevo fallback", async () => {
    const source = JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          type: "node",
          request: "attach",
          name: "Inspector",
          port: 9229,
        },
      ],
    });
    const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === ROOT) {
        return [
          { kind: "directory", name: ".codevo", path: CONFIG_DIRECTORY },
          { kind: "directory", name: ".vscode", path: `${ROOT}/.vscode` },
        ];
      }
      if (path === CONFIG_DIRECTORY) return [];
      return [
        {
          kind: "file",
          name: "launch.json",
          path: `${ROOT}/.vscode/launch.json`,
        },
      ];
    });

    await expect(
      loadNodeLaunchConfigurations(
        ROOT,
        { readDirectory, readFile: async () => source },
        () => true,
      ),
    ).resolves.toMatchObject({
      kind: "loaded",
      entries: [
        {
          source: "vscode",
          configuration: { name: "Inspector", target: { kind: "attach", port: 9229 } },
        },
      ],
    });
    expect(readDirectory).not.toHaveBeenCalledWith(CONFIG_DIRECTORY);
    expect(readDirectory).toHaveBeenCalledWith(`${ROOT}/.vscode`);
  });

  it("propagates invalid and stale authoritative VS Code results", async () => {
    const invalidReads = {
      readDirectory: vscodeConfigurationDirectories,
      readFile: async () => "{}",
    };
    await expect(
      loadNodeLaunchConfigurations(ROOT, invalidReads, () => true),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining(".vscode/launch.json"),
    });

    const current = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    await expect(loadNodeLaunchConfigurations(ROOT, invalidReads, current)).resolves.toEqual({
      kind: "stale",
    });
  });
});

describe("loadConfiguredNodeLaunch", () => {
  it("loads only the current project's config", async () => {
    const readFile = vi.fn(async () =>
      JSON.stringify({
        version: 1,
        configurations: [
          {
            name: "API",
            target: { kind: "script", path: "src/server.ts" },
            args: ["dev"],
          },
        ],
      }),
    );

    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile,
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({
      kind: "configured",
      launch: { kind: "node-configured-script", scriptPath: DOCUMENT, args: ["dev"] },
    });
    expect(readFile).toHaveBeenCalledWith(CONFIG_PATH);
  });

  it("loads a default single-target Node attach configuration", async () => {
    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile: async () =>
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
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({
      kind: "configured",
      launch: { kind: "node-attach", port: 9229 },
    });
  });

  it("uses one exact imported VS Code npm target as the direct-launch fallback", async () => {
    const result = await loadConfiguredNodeLaunch({
      workspaceRoot: ROOT,
      documentPath: DOCUMENT,
      readDirectory: vscodeConfigurationDirectories,
      readFile: async () =>
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
            },
          ],
        }),
      isCurrent: () => true,
    });

    expect(result).toEqual({
      kind: "configured",
      entry: {
        source: "vscode",
        configuration: {
          name: "API dev",
          default: false,
          target: { kind: "npm", script: "dev:api", packageRoot: "apps/api" },
          args: [],
          cwd: "apps/api",
          env: { NODE_ENV: "development" },
        },
        justMyCode: "nodeInternals",
        preLaunchTask: "build api",
      },
      launch: {
        kind: "node-npm-script",
        script: "dev:api",
        packageRootPath: `${ROOT}/apps/api`,
        args: [],
        cwd: `${ROOT}/apps/api`,
        env: { NODE_ENV: "development" },
      },
    });
    if (result.kind !== "configured") return;
    expect(result.entry.configuration).not.toHaveProperty("justMyCode");
    expect(result.entry.configuration).not.toHaveProperty("skipFiles");
  });

  it("keeps imported compounds out of the configured F5 projection", async () => {
    const result = await loadConfiguredNodeLaunch({
      workspaceRoot: ROOT,
      documentPath: DOCUMENT,
      readDirectory: vscodeConfigurationDirectories,
      readFile: async () =>
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "API",
              program: "src/server.ts",
            },
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
              stopAll: true,
              preLaunchTask: "build services",
            },
          ],
        }),
      isCurrent: () => true,
    });

    expect(result).toMatchObject({
      kind: "configured",
      entry: {
        source: "vscode",
        configuration: { name: "API", target: { kind: "script" } },
      },
      launch: { kind: "node-configured-script", scriptPath: DOCUMENT },
    });
    expect(result).not.toHaveProperty("compounds");
    if (result.kind !== "configured") return;
    expect(result.entry).not.toHaveProperty("compound");
    expect(result.entry).not.toHaveProperty("preLaunchTask");
  });

  it("never guesses a direct npm launch from multiple or mixed imported entries", async () => {
    const load = (configurations: readonly Record<string, unknown>[]) =>
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: vscodeConfigurationDirectories,
        readFile: async () => JSON.stringify({ version: "0.2.0", configurations }),
        isCurrent: () => true,
      });
    const npm = {
      type: "node",
      request: "launch",
      name: "npm",
      runtimeExecutable: "npm",
      runtimeArgs: ["run", "dev"],
    };

    await expect(
      load([npm, { ...npm, name: "npm build", runtimeArgs: ["run", "build"] }]),
    ).resolves.toEqual({ kind: "none" });
    await expect(
      load([
        npm,
        {
          type: "node",
          request: "launch",
          name: "Other script",
          program: "src/other.ts",
        },
      ]),
    ).resolves.toEqual({ kind: "none" });
    await expect(
      load([
        npm,
        {
          type: "node",
          request: "launch",
          name: "Unsupported",
          runtimeExecutable: "node",
          runtimeArgs: ["server.js"],
        },
      ]),
    ).resolves.toEqual({ kind: "none" });
  });

  it("drops a result after the workspace or active document changes", async () => {
    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile: async () => '{"version":1,"configurations":[]}',
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ kind: "stale" });
  });

  it("returns an actionable invalid result for malformed JSON", async () => {
    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile: async () => "{",
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining(".codevo/launch.json"),
    });
  });

  it("uses directory entries as a typed missing-file result", async () => {
    for (const readDirectory of [
      async () => [] as FileEntry[],
      async (path: string) =>
        path === ROOT
          ? [{ kind: "directory" as const, name: ".codevo", path: CONFIG_DIRECTORY }]
          : [],
    ]) {
      await expect(
        loadConfiguredNodeLaunch({
          workspaceRoot: ROOT,
          documentPath: DOCUMENT,
          readDirectory,
          readFile: async () => {
            throw new Error("must not read a missing configuration");
          },
          isCurrent: () => true,
        }),
      ).resolves.toEqual({ kind: "none" });
    }
  });

  it("reports an IO failure without exposing exception, path or token details", async () => {
    const secretPath = "/private/workspace/SECRET_TOKEN/launch.json";
    const secretToken = "token-super-secret";
    const result = await loadConfiguredNodeLaunch({
      workspaceRoot: ROOT,
      documentPath: DOCUMENT,
      readDirectory: configDirectories,
      readFile: async () => {
        throw new Error(`permission denied at ${secretPath}: ${secretToken}`);
      },
      isCurrent: () => true,
    });

    expect(result).toEqual({
      kind: "invalid",
      message: NODE_LAUNCH_CONFIGURATION_READ_ERROR,
    });
    expect(JSON.stringify(result)).not.toContain(secretPath);
    expect(JSON.stringify(result)).not.toContain(secretToken);
    expect(JSON.stringify(result)).not.toContain("permission denied");

    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile: async () => Promise.reject({ secretPath, secretToken }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({
      kind: "invalid",
      message: NODE_LAUNCH_CONFIGURATION_READ_ERROR,
    });
  });

  it("rejects a launch file that exceeds the UTF-8 byte budget", async () => {
    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile: async () => "é".repeat(NODE_LAUNCH_CONFIGURATION_MAX_BYTES / 2 + 1),
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining(`${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes`),
    });
  });

  it("uses the native bounded read when the gateway provides it", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("unbounded read must not run");
    });
    const readFileBounded = vi.fn(async () => ({ status: "tooLarge" as const }));
    await expect(
      loadConfiguredNodeLaunch({
        workspaceRoot: ROOT,
        documentPath: DOCUMENT,
        readDirectory: configDirectories,
        readFile,
        readFileBounded,
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({ kind: "invalid", message: expect.stringContaining("UTF-8 bytes") });
    expect(readFileBounded).toHaveBeenCalledWith(CONFIG_PATH, NODE_LAUNCH_CONFIGURATION_MAX_BYTES);
    expect(readFile).not.toHaveBeenCalled();
  });
});

async function configDirectories(path: string): Promise<FileEntry[]> {
  if (path === ROOT) {
    return [{ kind: "directory", name: ".codevo", path: CONFIG_DIRECTORY }];
  }
  return [{ kind: "file", name: "launch.json", path: CONFIG_PATH }];
}

async function bothConfigurationDirectories(path: string): Promise<FileEntry[]> {
  if (path === ROOT) {
    return [
      { kind: "directory", name: ".codevo", path: CONFIG_DIRECTORY },
      { kind: "directory", name: ".vscode", path: `${ROOT}/.vscode` },
    ];
  }
  return [{ kind: "file", name: "launch.json", path: `${path}/launch.json` }];
}

async function vscodeConfigurationDirectories(path: string): Promise<FileEntry[]> {
  if (path === ROOT) {
    return [{ kind: "directory", name: ".vscode", path: `${ROOT}/.vscode` }];
  }
  if (path === `${ROOT}/.vscode`) {
    return [
      {
        kind: "file",
        name: "launch.json",
        path: `${ROOT}/.vscode/launch.json`,
      },
    ];
  }
  return [];
}
