import { describe, expect, it, vi } from "vitest";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import { loadVscodeNodeLaunchConfigurations } from "./vscodeNodeLaunchConfigurationLoader";

const ROOT = "/workspace/project";

describe("VS Code Node launch configuration loader", () => {
  it("loads only the exact bounded .vscode/launch.json path", async () => {
    const reads = fixtures(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            preLaunchTask: "build",
            postDebugTask: "cleanup",
            skipFiles: ["<node_internals>/**"],
            serverReadyAction: {
              action: "openExternally",
              pattern: "listening on port ([0-9]+)",
              uriFormat: "http://localhost:%s/health",
            },
          },
        ],
      }),
    );
    const result = await loadVscodeNodeLaunchConfigurations(ROOT, reads, () => true);
    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [
        {
          configuration: { name: "API" },
          justMyCode: "nodeInternals",
          preLaunchTask: "build",
          postDebugTask: "cleanup",
          serverReadyAction: {
            action: "openExternally",
            match: { kind: "port", prefix: "listening on port ", suffix: "" },
            uri: { scheme: "http", host: "localhost", path: "/health" },
          },
        },
      ],
    });
    if (result.kind !== "loaded") return;
    expect(result.configurations[0]?.configuration).not.toHaveProperty("skipFiles");
    expect(result.configurations[0]?.configuration).not.toHaveProperty("postDebugTask");
    expect(result.configurations[0]?.serverReadyAction).not.toHaveProperty("pattern");
    expect(Object.isFrozen(result.configurations[0]?.serverReadyAction)).toBe(true);
    expect(reads.readFileBounded).toHaveBeenCalledWith(`${ROOT}/.vscode/launch.json`, 262_144);
    expect(reads.readFile).not.toHaveBeenCalled();
  });

  it("returns none when the exact directory or file is absent", async () => {
    const noDirectory = fixtures("{}", false);
    expect(await loadVscodeNodeLaunchConfigurations(ROOT, noDirectory, () => true)).toEqual({
      kind: "none",
    });
    expect(noDirectory.readFileBounded).not.toHaveBeenCalled();

    const noFile = fixtures("{}", true, false);
    expect(await loadVscodeNodeLaunchConfigurations(ROOT, noFile, () => true)).toEqual({
      kind: "none",
    });
  });

  it("keeps resolved compounds private, frozen, and separate from launch configurations", async () => {
    const result = await loadVscodeNodeLaunchConfigurations(
      ROOT,
      fixtures(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            { type: "node", request: "launch", name: "API", program: "src/api.js" },
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
            },
          ],
        }),
      ),
      () => true,
    );

    expect(result).toMatchObject({
      kind: "loaded",
      configurations: [{ configuration: { name: "API" } }, { configuration: { name: "Worker" } }],
      compounds: [
        {
          name: "Services",
          members: [{ configuration: { name: "API" } }, { configuration: { name: "Worker" } }],
        },
      ],
    });
    if (result.kind !== "loaded" || !result.compounds) return;
    expect(Object.isFrozen(result.compounds)).toBe(true);
    expect(result.configurations).toHaveLength(2);
  });

  it("fails closed for oversized, unreadable, invalid, and stale reads", async () => {
    const oversized = fixtures("{}", true, true, { status: "tooLarge" });
    expect(await loadVscodeNodeLaunchConfigurations(ROOT, oversized, () => true)).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("262144"),
    });

    const unreadable = fixtures("{}");
    unreadable.readDirectory.mockRejectedValueOnce(new Error("private path"));
    expect(await loadVscodeNodeLaunchConfigurations(ROOT, unreadable, () => true)).toEqual({
      kind: "invalid",
      message: ".vscode/launch.json could not be read.",
    });

    expect(
      await loadVscodeNodeLaunchConfigurations(ROOT, fixtures("{}"), () => true),
    ).toMatchObject({ kind: "invalid" });

    expect(await loadVscodeNodeLaunchConfigurations(ROOT, fixtures("{}"), () => false)).toEqual({
      kind: "stale",
    });
  });
});

interface FixtureReads extends NodeLaunchConfigurationReads {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationReads["readDirectory"]>>;
  readFile: ReturnType<typeof vi.fn<NodeLaunchConfigurationReads["readFile"]>>;
  readFileBounded: ReturnType<
    typeof vi.fn<NonNullable<NodeLaunchConfigurationReads["readFileBounded"]>>
  >;
}

function fixtures(
  source: string,
  hasDirectory = true,
  hasFile = true,
  bounded: { readonly status: "ok"; readonly content: string } | { readonly status: "tooLarge" } = {
    status: "ok",
    content: source,
  },
): FixtureReads {
  return {
    readDirectory: vi.fn(async (path) =>
      path === ROOT
        ? hasDirectory
          ? [{ kind: "directory" as const, name: ".vscode", path: `${ROOT}/.vscode` }]
          : []
        : hasFile
          ? [
              {
                kind: "file" as const,
                name: "launch.json",
                path: `${ROOT}/.vscode/launch.json`,
              },
            ]
          : [],
    ),
    readFile: vi.fn(async () => source),
    readFileBounded: vi.fn(async () => bounded),
  };
}
