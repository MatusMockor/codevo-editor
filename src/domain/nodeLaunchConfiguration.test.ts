import { describe, expect, it } from "vitest";
import {
  configuredNodeLaunchForDocument,
  deleteNodeLaunchConfiguration,
  NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
  parseNodeLaunchConfigurations,
  serializeNodeLaunchConfigurations,
  upsertNodeLaunchConfiguration,
  type NodeLaunchConfiguration,
} from "./nodeLaunchConfiguration";

const ROOT = "/workspace/project";

function configuration(name: string, isDefault: boolean): NodeLaunchConfiguration {
  return {
    args: [],
    default: isDefault,
    env: {},
    name,
    target: { kind: "script", path: "src/index.ts" },
  };
}

describe("Node launch configurations", () => {
  it("serializes normalized strict configuration JSON and validates edits", () => {
    const saved = serializeNodeLaunchConfigurations([
      {
        args: ["--watch"],
        cwd: "packages\\api",
        default: true,
        env: { NODE_ENV: "test" },
        name: "API",
        target: { kind: "npm", packageRoot: "packages/api", script: "dev" },
      },
    ]);

    expect(saved).toMatchObject({ kind: "ok" });
    if (saved.kind !== "ok") return;
    expect(saved.configurations[0]?.cwd).toBe("packages/api");
    expect(saved.source).toContain('"version": 1');
    expect(parseNodeLaunchConfigurations(saved.source)).toEqual({
      configurations: saved.configurations,
      kind: "ok",
    });
  });

  it("upserts, transfers default, rejects duplicate names, and deletes immutably", () => {
    const original = [configuration("First", true), configuration("Second", false)];
    const updated = upsertNodeLaunchConfiguration(
      original,
      "Second",
      configuration("Second", true),
    );
    expect(updated).toMatchObject({ kind: "ok" });
    if (updated.kind !== "ok") return;
    expect(updated.configurations.map(({ default: isDefault }) => isDefault)).toEqual([
      false,
      true,
    ]);
    expect(original[0]?.default).toBe(true);

    expect(
      upsertNodeLaunchConfiguration(original, null, configuration("First", false)),
    ).toMatchObject({ kind: "error", message: expect.stringContaining("duplicate") });
    expect(deleteNodeLaunchConfiguration(original, "First").map(({ name }) => name)).toEqual([
      "Second",
    ]);
  });
  it("parses and resolves project-scoped script configuration", () => {
    const result = parseNodeLaunchConfigurations(
      JSON.stringify({
        version: 1,
        configurations: [
          {
            name: "API",
            target: { kind: "script", path: "src/server.ts" },
            args: ["--port", "4100"],
            cwd: "apps/api",
            env: { NODE_ENV: "development", PORT: "4100" },
          },
        ],
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      configuredNodeLaunchForDocument(result.configurations, ROOT, `${ROOT}/src/server.ts`),
    ).toEqual({
      kind: "node-configured-script",
      scriptPath: `${ROOT}/src/server.ts`,
      args: ["--port", "4100"],
      cwd: `${ROOT}/apps/api`,
      env: { NODE_ENV: "development", PORT: "4100" },
    });
  });

  it("supports test and explicit default npm targets", () => {
    const result = parseNodeLaunchConfigurations(
      JSON.stringify({
        version: 1,
        configurations: [
          {
            name: "Unit",
            target: {
              kind: "test",
              path: "src/a.test.ts",
              runner: "vitest",
              packageRoot: "apps/api",
            },
            args: ["-t", "one"],
          },
          {
            name: "Dev",
            default: true,
            target: { kind: "npm", script: "dev", packageRoot: "apps/web" },
            env: { PORT: "3000" },
          },
        ],
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      configuredNodeLaunchForDocument(result.configurations, ROOT, `${ROOT}/src/a.test.ts`),
    ).toMatchObject({
      kind: "js-configured-test",
      filePath: `${ROOT}/src/a.test.ts`,
      packageRootPath: `${ROOT}/apps/api`,
      args: ["-t", "one"],
    });
    expect(
      configuredNodeLaunchForDocument(result.configurations, ROOT, `${ROOT}/src/other.ts`),
    ).toEqual({
      kind: "node-npm-script",
      script: "dev",
      packageRootPath: `${ROOT}/apps/web`,
      args: [],
      cwd: undefined,
      env: { PORT: "3000" },
    });
  });

  it("roundtrips and maps a strict attach configuration", () => {
    const result = parseNodeLaunchConfigurations(
      JSON.stringify({
        version: 1,
        configurations: [
          { name: "Local inspector", default: true, target: { kind: "attach", port: 9229 } },
        ],
      }),
    );
    expect(result).toEqual({
      kind: "ok",
      configurations: [
        {
          name: "Local inspector",
          default: true,
          target: { kind: "attach", port: 9229 },
          args: [],
          env: {},
        },
      ],
    });
    if (result.kind !== "ok") return;
    expect(
      configuredNodeLaunchForDocument(result.configurations, ROOT, `${ROOT}/src/other.ts`),
    ).toEqual({ kind: "node-attach", port: 9229 });

    const serialized = serializeNodeLaunchConfigurations(result.configurations);
    expect(serialized).toMatchObject({ kind: "ok" });
    if (serialized.kind !== "ok") return;
    expect(JSON.parse(serialized.source)).toEqual({
      version: 1,
      configurations: [
        { name: "Local inspector", default: true, target: { kind: "attach", port: 9229 } },
      ],
    });
    expect(parseNodeLaunchConfigurations(serialized.source)).toEqual(result);
  });

  it.each([0, 65_536, 9229.5, "9229", null])("rejects invalid attach port %#", (port) => {
    expect(
      parseNodeLaunchConfigurations(
        JSON.stringify({
          version: 1,
          configurations: [{ name: "Attach", target: { kind: "attach", port } }],
        }),
      ),
    ).toMatchObject({
      kind: "error",
      message: expect.stringContaining("integer between 1 and 65535"),
    });
  });

  it.each(["args", "cwd", "env"])("rejects attach-only forbidden field %s", (field) => {
    const forbidden = field === "args" ? [] : field === "env" ? {} : "packages/api";
    expect(
      parseNodeLaunchConfigurations(
        JSON.stringify({
          version: 1,
          configurations: [
            {
              name: "Attach",
              target: { kind: "attach", port: 9229 },
              [field]: forbidden,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "error",
      message: expect.stringContaining(`contains unknown field "${field}"`),
    });
  });

  it.each(["path", "script", "file"])("rejects attach target field %s", (field) => {
    expect(
      parseNodeLaunchConfigurations(
        JSON.stringify({
          version: 1,
          configurations: [
            {
              name: "Attach",
              target: { kind: "attach", port: 9229, [field]: "src/server.ts" },
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "error",
      message: expect.stringContaining(`contains unknown field "${field}"`),
    });
  });

  it("rejects programmatic attach options instead of silently discarding them", () => {
    expect(
      serializeNodeLaunchConfigurations([
        {
          name: "Attach",
          default: false,
          target: { kind: "attach", port: 9229 },
          args: ["--inspect"],
          env: {},
        },
      ]),
    ).toMatchObject({
      kind: "error",
      message: expect.stringContaining("may not define args, cwd, or env"),
    });
  });

  it.each([
    [
      {
        version: 1,
        configurations: [{ name: "escape", target: { kind: "script", path: "../outside.js" } }],
      },
      "must stay inside",
    ],
    [
      {
        version: 1,
        configurations: [
          { name: "env", target: { kind: "script", path: "index.js" }, env: { PORT: 3000 } },
        ],
      },
      "values of at most",
    ],
    [
      {
        version: 1,
        configurations: [
          { name: "one", default: true, target: { kind: "npm", script: "a" } },
          { name: "two", default: true, target: { kind: "npm", script: "b" } },
        ],
      },
      "only one default",
    ],
  ])("rejects malformed or unsafe config with an actionable message", (value, message) => {
    expect(parseNodeLaunchConfigurations(JSON.stringify(value))).toMatchObject({
      kind: "error",
      message: expect.stringContaining(message),
    });
  });

  it.each([
    [{ version: 1, configurations: [], extra: true }, "root"],
    [
      {
        version: 1,
        configurations: [{ name: "API", target: { kind: "script", path: "index.js" }, typo: true }],
      },
      "configurations[0]",
    ],
    [
      {
        version: 1,
        configurations: [
          { name: "API", target: { kind: "script", path: "index.js", runner: "jest" } },
        ],
      },
      "target",
    ],
  ])("rejects unknown fields instead of silently drifting", (value, path) => {
    expect(parseNodeLaunchConfigurations(JSON.stringify(value))).toMatchObject({
      kind: "error",
      message: expect.stringContaining(`${path} contains unknown field`),
    });
  });

  it("enforces the total launch file UTF-8 byte budget before parsing", () => {
    const source = `{"version":1,"configurations":[],"padding":"${"é".repeat(
      NODE_LAUNCH_CONFIGURATION_MAX_BYTES / 2,
    )}"}`;
    expect(parseNodeLaunchConfigurations(source)).toMatchObject({
      kind: "error",
      message: expect.stringContaining(`${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes`),
    });
  });

  it.each([
    "line\nbreak",
    "tab\tname",
    "spoof\u202eexe",
    "isolate\u2066name",
    "separator\u2028name",
  ])("rejects display-unsafe configuration name %j before it reaches launcher choices", (name) => {
    expect(
      parseNodeLaunchConfigurations(
        JSON.stringify({
          version: 1,
          configurations: [{ name, target: { kind: "script", path: "index.js" } }],
        }),
      ),
    ).toMatchObject({ kind: "error", message: expect.stringContaining("display-safe") });
  });

  it.each([
    ["configuration name", { name: "é".repeat(129), target: { kind: "script", path: "a.js" } }],
    ["script name", { name: "npm", target: { kind: "npm", script: "é".repeat(129) } }],
    [
      "argument",
      { name: "args", target: { kind: "script", path: "a.js" }, args: ["é".repeat(8_193)] },
    ],
    [
      "environment value",
      { name: "env", target: { kind: "script", path: "a.js" }, env: { VALUE: "é".repeat(8_193) } },
    ],
  ])("enforces the per-field UTF-8 byte budget for %s", (_label, value) => {
    expect(
      parseNodeLaunchConfigurations(JSON.stringify({ version: 1, configurations: [value] })),
    ).toMatchObject({ kind: "error", message: expect.stringContaining("UTF-8 bytes") });
  });

  it("does not leak exact-path configurations across workspace roots", () => {
    const result = parseNodeLaunchConfigurations(
      '{"version":1,"configurations":[{"name":"API","target":{"kind":"script","path":"src/server.ts"}}]}',
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      configuredNodeLaunchForDocument(
        result.configurations,
        ROOT,
        "/workspace/other/src/server.ts",
      ),
    ).toBeNull();
  });
});
