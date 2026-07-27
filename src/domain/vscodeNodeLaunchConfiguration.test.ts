import { describe, expect, it } from "vitest";
import {
  parseVscodeNodeLaunchConfigurations,
  VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN,
  VSCODE_NODE_INTERNALS_SKIP_PATTERN,
  VSCODE_POST_DEBUG_TASK_MAX_BYTES,
  VSCODE_PRE_LAUNCH_TASK_MAX_BYTES,
  VSCODE_SERVER_READY_PATTERN_MAX_BYTES,
  VSCODE_SERVER_READY_URI_FORMAT_MAX_BYTES,
} from "./vscodeNodeLaunchConfiguration";
import {
  VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS,
  VSCODE_LAUNCH_GLOB_MAX_BYTES,
} from "./vscodeLaunchGlobList";

describe("VS Code Node launch configuration import", () => {
  it("imports bounded JSONC launch metadata without projecting a task command", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(`{
      // VS Code-compatible comments and trailing commas are accepted.
      "version": "0.2.0",
      "configurations": [{
        "type": "pwa-node",
        "request": "launch",
        "name": "API",
        "program": "\${workspaceFolder}/src/server.ts",
        "cwd": "\${workspaceFolder}/apps/api",
        "args": ["--port", "4100"],
        "env": { "NODE_ENV": "development" },
        "preLaunchTask": "build api",
        "postDebugTask": "stop api",
      }],
    }`);

    expect(parsed).toEqual({
      kind: "ok",
      diagnostics: [],
      configurations: [
        {
          configuration: {
            args: ["--port", "4100"],
            cwd: "apps/api",
            default: false,
            env: { NODE_ENV: "development" },
            name: "API",
            target: { kind: "script", path: "src/server.ts" },
          },
          justMyCode: "nodeInternals",
          preLaunchTask: "build api",
          postDebugTask: "stop api",
        },
      ],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[0]).not.toHaveProperty("command");
    expect(parsed.configurations[0]).not.toHaveProperty("task");
  });

  it("imports attach and preserves lifecycle task labels only as exact metadata", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Inspector",
              port: 9229,
              preLaunchTask: "start inspector",
              postDebugTask: "stop inspector",
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [
        {
          configuration: { target: { kind: "attach", port: 9229 } },
          preLaunchTask: "start inspector",
          postDebugTask: "stop inspector",
        },
      ],
    });
  });

  it("imports a strict serverReadyAction as a frozen semantic loopback recipe", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "pwa-node",
            request: "launch",
            name: "Express API",
            program: "src/server.ts",
            serverReadyAction: {
              action: "openExternally",
              pattern: "Example app listening on port ([0-9]+)!",
              uriFormat: "https://127.0.0.1:%s/api/v1",
            },
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      diagnostics: [],
      configurations: [
        {
          configuration: { name: "Express API" },
          serverReadyAction: {
            action: "openExternally",
            match: {
              kind: "port",
              prefix: "Example app listening on port ",
              suffix: "!",
            },
            uri: {
              scheme: "https",
              host: "127.0.0.1",
              path: "/api/v1",
            },
          },
        },
      ],
    });
    if (parsed.kind !== "ok") return;
    const recipe = parsed.configurations[0]?.serverReadyAction;
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe?.match)).toBe(true);
    expect(Object.isFrozen(recipe?.uri)).toBe(true);
    expect(recipe).not.toHaveProperty("pattern");
    expect(recipe).not.toHaveProperty("uriFormat");
    expect(parsed.configurations[0]).not.toHaveProperty("command");
  });

  it.each([
    ["missing action", { pattern: "listening on port ([0-9]+)", uriFormat: "http://localhost:%s" }],
    [
      "browser debugger action",
      {
        action: "debugWithChrome",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "arbitrary launch action",
      {
        action: "startDebugging",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "unknown command-like field",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s",
        command: "open",
      },
    ],
    [
      "raw regex operator",
      {
        action: "openExternally",
        pattern: "listening.* on port ([0-9]+)",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "nested quantifier",
      {
        action: "openExternally",
        pattern: "((a+)+)([0-9]+)",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "second capture",
      {
        action: "openExternally",
        pattern: "port ([0-9]+) or ([0-9]+)",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "digit-leading suffix with ambiguous capture",
      {
        action: "openExternally",
        pattern: "port ([0-9]+)0",
        uriFormat: "http://localhost:%s",
      },
    ],
    [
      "remote host",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "https://example.com:%s",
      },
    ],
    [
      "non-http scheme",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "file://localhost:%s",
      },
    ],
    [
      "credentials",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://user@localhost:%s",
      },
    ],
    [
      "query injection",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/?next=https://example.com",
      },
    ],
    [
      "parent path",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/../admin",
      },
    ],
    [
      "encoded parent path",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/%2e%2e/admin",
      },
    ],
    [
      "encoded path separator",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/safe%2f..%2fadmin",
      },
    ],
    [
      "encoded backslash",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/safe%5c..%5cadmin",
      },
    ],
    [
      "encoded control",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/safe%00admin",
      },
    ],
    [
      "double-encoded escape",
      {
        action: "openExternally",
        pattern: "listening on port ([0-9]+)",
        uriFormat: "http://localhost:%s/%252e%252e/admin",
      },
    ],
  ])("rejects unsafe serverReadyAction shape: %s", (_case, serverReadyAction) => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Unsafe",
              program: "src/server.js",
              serverReadyAction,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [
        { configurationIndex: 0, message: expect.stringContaining("serverReadyAction") },
      ],
    });
  });

  it("does not project an attacker-controlled unknown field name into diagnostics", () => {
    const privateField = `secret-token-\u202e${"x".repeat(64)}`;
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Private diagnostic",
            program: "src/server.js",
            serverReadyAction: {
              action: "openExternally",
              pattern: "port ([0-9]+)",
              uriFormat: "http://localhost:%s",
              [privateField]: true,
            },
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("unsupported") }],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.diagnostics[0]?.message).not.toContain(privateField);
    expect(parsed.diagnostics[0]?.message).not.toContain("secret-token");
  });

  it("rejects serverReadyAction for attach and for compound members", () => {
    const serverReadyAction = {
      action: "openExternally",
      pattern: "listening on port ([0-9]+)",
      uriFormat: "http://localhost:%s",
    };
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "attach",
            name: "Inspector",
            port: 9229,
            serverReadyAction,
          },
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/api.js",
            serverReadyAction,
          },
          { type: "node", request: "launch", name: "Worker", program: "src/worker.js" },
        ],
        compounds: [{ name: "Services", configurations: ["API", "Worker"], stopAll: true }],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [
        { configuration: { name: "API" }, serverReadyAction: { action: "openExternally" } },
        { configuration: { name: "Worker" } },
      ],
      compounds: [],
      diagnostics: [
        { configurationIndex: 0, message: expect.stringContaining("only for launch") },
        {
          compoundIndex: 0,
          message: expect.stringContaining("without serverReadyAction"),
        },
      ],
    });
  });

  it("imports an eight-member compound and rejects a nine-member compound", () => {
    const configurations = Array.from({ length: 9 }, (_, index) => ({
      type: "node",
      request: "launch",
      name: `Service ${index + 1}`,
      program: `src/service-${index + 1}.js`,
    }));
    const parse = (memberCount: number) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations,
          compounds: [
            {
              name: "Services",
              configurations: configurations
                .slice(0, memberCount)
                .map((configuration) => configuration.name),
              stopAll: true,
            },
          ],
        }),
      );

    expect(parse(8)).toMatchObject({
      kind: "ok",
      compounds: [{ members: Array.from({ length: 8 }, () => expect.anything()) }],
      diagnostics: [],
    });
    expect(parse(9)).toMatchObject({
      kind: "ok",
      compounds: [],
      diagnostics: [
        {
          compoundIndex: 0,
          message: expect.stringContaining("2 to 8"),
        },
      ],
    });
  });

  it("bounds serverReadyAction pattern and URI format by UTF-8 bytes", () => {
    const parse = (pattern: string, uriFormat: string) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Boundary",
              program: "src/server.js",
              serverReadyAction: { action: "openExternally", pattern, uriFormat },
            },
          ],
        }),
      );

    expect(
      parse(
        `${"a".repeat(VSCODE_SERVER_READY_PATTERN_MAX_BYTES - "([0-9]+)".length)}([0-9]+)`,
        "http://[::1]:%s",
      ),
    ).toMatchObject({ kind: "ok", configurations: [expect.anything()], diagnostics: [] });
    expect(
      parse(
        `${"a".repeat(VSCODE_SERVER_READY_PATTERN_MAX_BYTES - "([0-9]+)".length + 1)}([0-9]+)`,
        "http://localhost:%s",
      ),
    ).toMatchObject({ kind: "ok", configurations: [], diagnostics: [expect.anything()] });
    expect(
      parse(
        "port ([0-9]+)",
        `http://localhost:%s/${"a".repeat(VSCODE_SERVER_READY_URI_FORMAT_MAX_BYTES)}`,
      ),
    ).toMatchObject({ kind: "ok", configurations: [], diagnostics: [expect.anything()] });
  });

  it("imports only the exact npm run forms into the internal npm target", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "pwa-node",
            request: "launch",
            name: "API dev",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev:api"],
            cwd: "${workspaceFolder}/apps/api",
            env: { NODE_ENV: "development" },
            preLaunchTask: "generate api",
            postDebugTask: "stop api",
          },
          {
            type: "node",
            request: "launch",
            name: "Windows build",
            runtimeExecutable: "npm.cmd",
            runtimeArgs: ["run", "build"],
          },
          {
            type: "node",
            request: "launch",
            name: "Documented alias",
            runtimeExecutable: "npm",
            runtimeArgs: ["run-script", "serve"],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      kind: "ok",
      diagnostics: [],
      configurations: [
        {
          configuration: {
            args: [],
            cwd: "apps/api",
            default: false,
            env: { NODE_ENV: "development" },
            name: "API dev",
            target: { kind: "npm", script: "dev:api", packageRoot: "apps/api" },
          },
          justMyCode: "nodeInternals",
          preLaunchTask: "generate api",
          postDebugTask: "stop api",
        },
        {
          configuration: {
            args: [],
            default: false,
            env: {},
            name: "Windows build",
            target: { kind: "npm", script: "build" },
          },
          justMyCode: "nodeInternals",
        },
        {
          configuration: {
            args: [],
            default: false,
            env: {},
            name: "Documented alias",
            target: { kind: "npm", script: "serve" },
          },
          justMyCode: "nodeInternals",
        },
      ],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[0]).not.toHaveProperty("runtimeExecutable");
    expect(parsed.configurations[0]).not.toHaveProperty("runtimeArgs");
  });

  it.each(["tsx", "ts-node"] as const)(
    "imports the exact direct %s runtime as a configured script",
    (runtime) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: `${runtime} API`,
              runtimeExecutable: runtime,
              ...(runtime === "ts-node" ? { runtimeArgs: [] } : {}),
              program: "${workspaceFolder}/src/server.ts",
              args: ["--port", "4100"],
              cwd: "${workspaceFolder}/apps/api",
              env: { NODE_ENV: "development" },
              envFile: "${workspaceFolder}/config/dev.env",
            },
          ],
        }),
      );

      expect(parsed).toEqual({
        kind: "ok",
        diagnostics: [],
        configurations: [
          {
            configuration: {
              args: ["--port", "4100"],
              cwd: "apps/api",
              default: false,
              env: { NODE_ENV: "development" },
              envFile: "config/dev.env",
              name: `${runtime} API`,
              runtime,
              target: { kind: "script", path: "src/server.ts" },
            },
            envFile: "config/dev.env",
            justMyCode: "nodeInternals",
          },
        ],
      });
    },
  );

  it.each([
    ["unsupported runtime", "nodemon", undefined, "src/server.ts", "runtimeExecutable"],
    ["runtime arguments", "tsx", ["--esm"], "src/server.ts", "runtimeArgs"],
    ["parent program", "tsx", undefined, "../server.ts", "inside the workspace"],
    ["absolute program", "ts-node", undefined, "/tmp/server.ts", "inside the workspace"],
    ["unsupported extension", "tsx", undefined, "src/server.py", "program"],
  ])(
    "rejects direct wrapper launch with %s",
    (_case, runtimeExecutable, runtimeArgs, program, diagnostic) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Direct wrapper",
              runtimeExecutable,
              ...(runtimeArgs ? { runtimeArgs } : {}),
              program,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [],
        diagnostics: [{ message: expect.stringContaining(diagnostic) }],
      });
    },
  );

  it("imports exact direct native Node watch forms as frozen semantic metadata", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API watch",
            program: "${workspaceFolder}/src/server.js",
            runtimeArgs: ["--watch"],
          },
          {
            type: "pwa-node",
            request: "launch",
            name: "Worker watch",
            program: "src/worker.mjs",
            runtimeArgs: ["--watch", "--watch-preserve-output"],
            args: [],
            env: {},
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      kind: "ok",
      diagnostics: [],
      configurations: [
        {
          configuration: {
            args: [],
            default: false,
            env: {},
            name: "API watch",
            target: { kind: "script", path: "src/server.js" },
          },
          nativeWatch: {
            kind: "native-node-watch",
            scriptPath: "src/server.js",
            watch: true,
          },
          justMyCode: "nodeInternals",
        },
        {
          configuration: {
            args: [],
            default: false,
            env: {},
            name: "Worker watch",
            target: { kind: "script", path: "src/worker.mjs" },
          },
          nativeWatch: {
            kind: "native-node-watch",
            scriptPath: "src/worker.mjs",
            watch: true,
            preserveOutput: true,
          },
          justMyCode: "nodeInternals",
        },
      ],
    });
    if (parsed.kind !== "ok") return;
    expect(Object.isFrozen(parsed.configurations[0]?.nativeWatch)).toBe(true);
    expect(parsed.configurations[0]).not.toHaveProperty("runtimeArgs");
    expect(parsed.configurations[0]?.nativeWatch).not.toHaveProperty("runtime");
  });

  it.each([
    { runtimeExecutable: "node", runtimeArgs: undefined },
    { runtimeExecutable: "node", runtimeArgs: [] },
    { runtimeExecutable: undefined, runtimeArgs: [] },
  ] as const)(
    "accepts default Node compatibility with runtimeExecutable=$runtimeExecutable runtimeArgs=$runtimeArgs",
    ({ runtimeExecutable, runtimeArgs }) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Explicit Node",
              program: "src/server.js",
              ...(runtimeExecutable ? { runtimeExecutable } : {}),
              ...(runtimeArgs ? { runtimeArgs } : {}),
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [
          {
            configuration: {
              name: "Explicit Node",
              target: { kind: "script", path: "src/server.js" },
            },
          },
        ],
        diagnostics: [],
      });
      if (parsed.kind !== "ok") return;
      expect(parsed.configurations[0]).not.toHaveProperty("runtimeExecutable");
      expect(parsed.configurations[0]).not.toHaveProperty("runtimeArgs");
      expect(parsed.configurations[0]).not.toHaveProperty("nativeWatch");
    },
  );

  it.each([
    { runtimeArgs: ["--watch"] as const },
    { runtimeArgs: ["--watch", "--watch-preserve-output"] as const },
  ])(
    "maps explicit runtimeExecutable node with runtimeArgs=$runtimeArgs to the existing native-watch intent",
    ({ runtimeArgs }) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Explicit Node watch",
              program: "src/server.js",
              runtimeExecutable: "node",
              runtimeArgs,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [
          {
            nativeWatch: {
              kind: "native-node-watch",
              watch: true,
              ...(runtimeArgs.length === 2 ? { preserveOutput: true } : {}),
            },
          },
        ],
        diagnostics: [],
      });
    },
  );

  it.each([
    ["node.exe", undefined],
    ["Node", undefined],
    ["node", ["--enable-source-maps"]],
    ["node", ["--watch-preserve-output", "--watch"]],
    ["node", "[]"],
  ])("rejects unsupported explicit Node runtime form %j %j", (runtimeExecutable, runtimeArgs) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Unsupported Node runtime",
            program: "src/server.js",
            runtimeExecutable,
            ...(runtimeArgs === undefined ? {} : { runtimeArgs }),
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ configurationIndex: 0, message: expect.stringMatching(/runtime/) }],
    });
  });

  it.each([
    ["preserve only", ["--watch-preserve-output"]],
    ["reordered", ["--watch-preserve-output", "--watch"]],
    ["duplicate watch", ["--watch", "--watch"]],
    ["duplicate preserve", ["--watch", "--watch-preserve-output", "--watch-preserve-output"]],
    ["extra flag", ["--watch", "--trace-warnings"]],
    ["npm form without npm", ["run", "dev"]],
  ])("rejects native Node watch runtimeArgs: %s", (_case, runtimeArgs) => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Unsafe watch",
              program: "src/server.js",
              runtimeArgs,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("runtimeArgs must be exactly") }],
    });
  });

  it.each([
    ["TypeScript program", { program: "src/server.ts" }],
    ["tsx executable", { runtimeExecutable: "tsx" }],
    ["nodemon executable", { runtimeExecutable: "nodemon" }],
    ["shell executable", { runtimeExecutable: "/bin/sh" }],
    ["explicit cwd", { cwd: "apps/api" }],
    ["non-empty args", { args: ["--port", "4000"] }],
    ["non-empty env", { env: { NODE_ENV: "development" } }],
  ])("rejects unsupported native Node watch capability: %s", (_case, extra) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Unsafe watch",
            program: "src/server.js",
            runtimeArgs: ["--watch"],
            ...extra,
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [expect.anything()],
    });
  });

  it("fails closed when a compound contains native watch metadata", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API watch",
            program: "src/api.cjs",
            runtimeArgs: ["--watch"],
          },
          {
            type: "node",
            request: "launch",
            name: "Worker",
            program: "src/worker.js",
          },
        ],
        compounds: [{ name: "Services", configurations: ["API watch", "Worker"], stopAll: true }],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ nativeWatch: { kind: "native-node-watch" } }, expect.anything()],
      compounds: [],
      diagnostics: [
        {
          compoundIndex: 0,
          message: expect.stringContaining("task-free script or npm"),
        },
      ],
    });
  });

  it("accepts the backend-compatible 128-byte npm script-name boundary", () => {
    const script = "a".repeat(128);
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Boundary",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", script],
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { target: { kind: "npm", script } } }],
      diagnostics: [],
    });
  });

  it("applies the Node-internals launch default and respects an explicit empty opt-out", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "attach",
            name: "Attach",
            port: 9229,
          },
          {
            type: "node",
            request: "launch",
            name: "Default",
            program: "src/server.js",
          },
          {
            type: "node",
            request: "launch",
            name: "Explicit",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev"],
            skipFiles: [VSCODE_NODE_INTERNALS_SKIP_PATTERN],
          },
          {
            type: "node",
            request: "launch",
            name: "None",
            program: "src/none.js",
            skipFiles: [],
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [
        { configuration: { name: "Attach" } },
        { configuration: { name: "Default" }, justMyCode: "nodeInternals" },
        { configuration: { name: "Explicit" }, justMyCode: "nodeInternals" },
        { configuration: { name: "None" } },
      ],
      diagnostics: [],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[1]?.configuration).not.toHaveProperty("skipFiles");
    expect(parsed.configurations[3]).not.toHaveProperty("justMyCode");
  });

  it("canonicalizes the exact documented node_modules and Node-internals filters", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Dependencies",
            program: "src/dependencies.js",
            skipFiles: [VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN],
          },
          {
            type: "node",
            request: "launch",
            name: "Both documented order",
            program: "src/both.js",
            skipFiles: [VSCODE_NODE_INTERNALS_SKIP_PATTERN, VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN],
          },
          {
            type: "node",
            request: "launch",
            name: "Both reverse order",
            program: "src/reverse.js",
            skipFiles: [VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN, VSCODE_NODE_INTERNALS_SKIP_PATTERN],
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [
        { justMyCode: "dependencies" },
        { justMyCode: "nodeInternalsAndDependencies" },
        { justMyCode: "nodeInternalsAndDependencies" },
      ],
      diagnostics: [],
    });
    expect(JSON.stringify(parsed)).not.toContain("node_modules");
    expect(JSON.stringify(parsed)).not.toContain("<node_internals>");
  });

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["npm.cmd", { runtimeExecutable: "npm.cmd", runtimeArgs: ["run", "dev"] }],
    ["native watch", { program: "src/server.js", runtimeArgs: ["--watch"] }],
  ])("maps justMyCode booleans to the equivalent %s launch skipFiles policies", (_case, fields) => {
    const parseWith = (filter: object) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Filtered",
              ...fields,
              ...filter,
            },
          ],
        }),
      );

    expect(parseWith({ justMyCode: true })).toEqual(
      parseWith({
        skipFiles: [VSCODE_NODE_INTERNALS_SKIP_PATTERN, VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN],
      }),
    );
    expect(parseWith({ justMyCode: false })).toEqual(parseWith({ skipFiles: [] }));
  });

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["attach", { request: "attach", port: 9229 }],
    ["native watch", { program: "src/server.js", runtimeArgs: ["--watch"] }],
  ])("accepts explicit sourceMaps booleans for a %s configuration", (_case, fields) => {
    for (const sourceMaps of [true, false]) {
      expect(
        parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Source maps",
                ...fields,
                sourceMaps,
              },
            ],
          }),
        ),
      ).toMatchObject({
        kind: "ok",
        configurations: [{ sourceMaps }],
        diagnostics: [],
      });
    }
  });

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
  ])("accepts explicit stopOnEntry booleans for a %s launch", (_case, fields) => {
    for (const stopOnEntry of [true, false]) {
      expect(
        parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Entry policy",
                ...fields,
                stopOnEntry,
              },
            ],
          }),
        ),
      ).toMatchObject({
        kind: "ok",
        configurations: [{ stopOnEntry }],
        diagnostics: [],
      });
    }
  });

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["attach", { request: "attach", port: 9229 }],
    ["native watch", { program: "src/server.js", runtimeArgs: ["--watch"] }],
  ])("rejects a non-boolean stopOnEntry value for a %s configuration", (_case, fields) => {
    for (const stopOnEntry of ["true", null]) {
      expect(
        parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Entry policy",
                ...fields,
                stopOnEntry,
              },
            ],
          }),
        ),
      ).toEqual({
        kind: "ok",
        configurations: [],
        diagnostics: [
          {
            severity: "skipped",
            configurationIndex: 0,
            message: "configurations[0].stopOnEntry must be a boolean.",
          },
        ],
      });
    }
  });

  it("accepts false and rejects true stopOnEntry for attach configurations", () => {
    const parseWith = (stopOnEntry: boolean) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Inspector",
              port: 9229,
              stopOnEntry,
            },
          ],
        }),
      );

    expect(parseWith(false)).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { target: { kind: "attach" } } }],
      diagnostics: [],
    });
    expect(parseWith(false)).not.toMatchObject({
      configurations: [{ stopOnEntry: expect.anything() }],
    });
    expect(parseWith(true)).toEqual({
      kind: "ok",
      configurations: [],
      diagnostics: [
        {
          severity: "skipped",
          configurationIndex: 0,
          message: "configurations[0].stopOnEntry is supported only for launch.",
        },
      ],
    });
  });

  it.each([true, false])(
    "rejects stopOnEntry=%s for native Node watch with a clear limitation",
    (stopOnEntry) => {
      expect(
        parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "API watch",
                program: "src/server.js",
                runtimeArgs: ["--watch"],
                stopOnEntry,
              },
            ],
          }),
        ),
      ).toEqual({
        kind: "ok",
        configurations: [],
        diagnostics: [
          {
            severity: "skipped",
            configurationIndex: 0,
            message: "configurations[0].stopOnEntry is unsupported for a native Node watch launch.",
          },
        ],
      });
    },
  );

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["attach", { request: "attach", port: 9229 }],
    ["native watch", { program: "src/server.js", runtimeArgs: ["--watch"] }],
  ])("rejects a non-boolean sourceMaps value for a %s configuration", (_case, fields) => {
    for (const sourceMaps of ["false", null]) {
      expect(
        parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Source maps",
                ...fields,
                sourceMaps,
              },
            ],
          }),
        ),
      ).toEqual({
        kind: "ok",
        configurations: [],
        diagnostics: [
          {
            severity: "skipped",
            configurationIndex: 0,
            message: "configurations[0].sourceMaps must be a boolean.",
          },
        ],
      });
    }
  });

  it("reports stock source-map glob fields as reduced capability", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Source maps",
              program: "src/server.js",
              outFiles: ["${workspaceFolder}/dist/**/*.js"],
              resolveSourceMapLocations: ["${workspaceFolder}/**", "!**/node_modules/**"],
            },
          ],
        }),
      ),
    ).toEqual({
      kind: "ok",
      configurations: [
        {
          configuration: {
            args: [],
            default: false,
            env: {},
            name: "Source maps",
            target: { kind: "script", path: "src/server.js" },
          },
          justMyCode: "nodeInternals",
          outFiles: ["${workspaceFolder}/dist/**/*.js"],
          resolveSourceMapLocations: ["${workspaceFolder}/**", "!**/node_modules/**"],
        },
      ],
      diagnostics: [
        {
          configurationIndex: 0,
          severity: "reduced",
          fields: ["outFiles", "resolveSourceMapLocations"],
          message: expect.stringContaining("tsconfig outDir"),
        },
      ],
    });
  });

  it("preserves empty glob lists distinctly from absent fields", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Empty globs",
            program: "src/server.js",
            outFiles: [],
          },
          {
            type: "node",
            request: "launch",
            name: "Absent globs",
            program: "src/worker.js",
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ outFiles: [] }, { configuration: { name: "Absent globs" } }],
    });
    if (parsed.kind === "error") return;
    expect(parsed.configurations[0]).toHaveProperty("outFiles");
    expect(parsed.configurations[1]).not.toHaveProperty("outFiles");
  });

  it.each([
    ["a non-array", "outFiles", "**/*.js"],
    ["a non-string element", "resolveSourceMapLocations", ["**/*.js", 1]],
    ["a null element", "outFiles", [null]],
    [
      "an element count over the cap",
      "outFiles",
      Array.from({ length: VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS + 1 }, () => "**/*.js"),
    ],
    [
      "an element byte length over the cap",
      "resolveSourceMapLocations",
      ["é".repeat(VSCODE_LAUNCH_GLOB_MAX_BYTES / 2 + 1)],
    ],
  ])("rejects %s for %s", (_case, field, invalidValue) => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Invalid globs",
              program: "src/server.js",
              [field]: invalidValue,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [
        {
          configurationIndex: 0,
          message: expect.stringContaining(`configurations[0].${field} must be an array`),
        },
      ],
    });
  });

  it("still rejects an unrelated unknown launch field", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Unknown",
              program: "src/server.js",
              unknownCapability: true,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [
        { configurationIndex: 0, message: expect.stringContaining("unsupported field") },
      ],
    });
  });

  it.each([
    ["script", { program: "src/server.js" }],
    ["tsx", { program: "src/server.ts", runtimeExecutable: "tsx" }],
    ["ts-node", { program: "src/server.ts", runtimeExecutable: "ts-node" }],
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["npm.cmd", { runtimeExecutable: "npm.cmd", runtimeArgs: ["run", "dev"] }],
    ["native watch", { program: "src/server.js", runtimeArgs: ["--watch"] }],
  ])("rejects invalid justMyCode forms for a %s launch", (_case, fields) => {
    const parseWith = (filter: object) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Ambiguous",
              ...fields,
              ...filter,
            },
          ],
        }),
      );

    expect(parseWith({ justMyCode: "true" })).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("justMyCode must be a boolean") }],
    });
    expect(
      parseWith({
        justMyCode: true,
        skipFiles: [VSCODE_NODE_INTERNALS_SKIP_PATTERN, VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN],
      }),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("must not define both") }],
    });
  });

  it("mirrors attach skipFiles semantics for justMyCode", () => {
    const parseWith = (filter: object) =>
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Attach",
              port: 9229,
              ...filter,
            },
          ],
        }),
      );

    expect(parseWith({ justMyCode: false })).toEqual(parseWith({ skipFiles: [] }));
    expect(parseWith({ justMyCode: true })).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("cannot enable filtering for attach") }],
    });
    expect(parseWith({ justMyCode: 1 })).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("justMyCode must be a boolean") }],
    });
    expect(parseWith({ justMyCode: false, skipFiles: [] })).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("must not define both") }],
    });
  });

  it.each([
    ["raw string", VSCODE_NODE_INTERNALS_SKIP_PATTERN],
    ["unknown pattern", ["**/*.generated.js"]],
    ["workspace-expanded node modules", ["${workspaceFolder}/node_modules/**"]],
    ["duplicate", [VSCODE_NODE_INTERNALS_SKIP_PATTERN, VSCODE_NODE_INTERNALS_SKIP_PATTERN]],
    [
      "duplicate node modules",
      [VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN, VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN],
    ],
    [
      "extra",
      [
        VSCODE_NODE_INTERNALS_SKIP_PATTERN,
        "${workspaceFolder}/node_modules/**",
        "**/*.generated.js",
      ],
    ],
    ["non-string", [VSCODE_NODE_INTERNALS_SKIP_PATTERN, 1]],
  ])("fails closed for unsupported skipFiles form: %s", (_case, skipFiles) => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Unsafe",
              program: "src/server.js",
              skipFiles,
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("skipFiles") }],
    });
  });

  it("rejects non-empty attach skipFiles until attach filtering has an owned lifecycle", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Attach",
              port: 9229,
              skipFiles: [VSCODE_NODE_INTERNALS_SKIP_PATTERN],
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("absent or empty for attach") }],
    });
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", " build"],
    ["trailing whitespace", "build "],
    ["control", "build\nsecret"],
    ["bidi", "build\u202esecret"],
    ["oversize", "x".repeat(VSCODE_PRE_LAUNCH_TASK_MAX_BYTES + 1)],
    ["non-string", { label: "build" }],
  ])("fails closed for %s preLaunchTask metadata", (_case, preLaunchTask) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            preLaunchTask,
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("preLaunchTask") }],
    });
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", " cleanup"],
    ["trailing whitespace", "cleanup "],
    ["control", "cleanup\nsecret"],
    ["bidi", "cleanup\u202esecret"],
    ["oversize", "x".repeat(VSCODE_POST_DEBUG_TASK_MAX_BYTES + 1)],
    ["non-string", { label: "cleanup" }],
  ])("fails closed for %s postDebugTask metadata", (_case, postDebugTask) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "attach",
            name: "Inspector",
            port: 9229,
            postDebugTask,
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("postDebugTask") }],
    });
  });

  it("accepts only the internal console behavior already owned by configured starts", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            console: "internalConsole",
            internalConsoleOptions: "openOnSessionStart",
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { name: "API" } }],
      diagnostics: [],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[0]).not.toHaveProperty("console");
    expect(parsed.configurations[0]).not.toHaveProperty("internalConsoleOptions");
    expect(parsed.configurations[0]?.configuration).not.toHaveProperty("console");
    expect(parsed.configurations[0]?.configuration).not.toHaveProperty("internalConsoleOptions");
  });

  it("accepts exact std output capture without retaining compatibility metadata", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Piped output",
            program: "src/server.js",
            outputCapture: "std",
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { name: "Piped output" } }],
      diagnostics: [],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[0]).not.toHaveProperty("outputCapture");
    expect(parsed.configurations[0]?.configuration).not.toHaveProperty("outputCapture");
  });

  it.each(["console", "STD", false, null])(
    "rejects unsupported outputCapture=%j",
    (outputCapture) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Unsupported output",
              program: "src/server.js",
              outputCapture,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [],
        diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("outputCapture") }],
      });
    },
  );

  it("rejects std outputCapture for attach because Codevo owns no attached-process stdio", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Attach output",
              port: 9229,
              outputCapture: "std",
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("launch") }],
    });
  });

  it.each([
    ["console", "integratedTerminal", 'console must be exactly "internalConsole"'],
    ["console", "externalTerminal", 'console must be exactly "internalConsole"'],
    [
      "internalConsoleOptions",
      "neverOpen",
      'internalConsoleOptions must be exactly "openOnSessionStart"',
    ],
    [
      "internalConsoleOptions",
      "openOnFirstSessionStart",
      'internalConsoleOptions must be exactly "openOnSessionStart"',
    ],
  ])("rejects unsupported console behavior: %s=%s", (field, value, diagnostic) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            [field]: value,
          },
        ],
      }),
    );
    expect(parsed).toEqual({
      kind: "ok",
      configurations: [],
      diagnostics: [
        {
          severity: "skipped",
          configurationIndex: 0,
          message:
            field === "smartStep"
              ? "configurations[0].smartStep must be a boolean."
              : `configurations[0].${diagnostic}.`,
        },
      ],
    });
  });

  it("retains smartStep while dropping exact false no-op compatibility flags", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            autoAttachChildProcesses: false,
            smartStep: false,
            restart: false,
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { name: "API" }, smartStep: false }],
      diagnostics: [],
    });
    if (parsed.kind !== "ok") return;
    for (const field of ["autoAttachChildProcesses", "restart"]) {
      expect(parsed.configurations[0]).not.toHaveProperty(field);
      expect(parsed.configurations[0]?.configuration).not.toHaveProperty(field);
    }
    expect(parsed.configurations[0]?.configuration).not.toHaveProperty("smartStep");
  });

  it.each([
    ["autoAttachChildProcesses", true],
    ["autoAttachChildProcesses", 0],
    ["smartStep", "false"],
    ["restart", true],
    ["restart", null],
  ])("rejects unsupported compatibility flag %s=%j", (field, value) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/server.ts",
            [field]: value,
          },
        ],
      }),
    );
    expect(parsed).toEqual({
      kind: "ok",
      configurations: [],
      diagnostics: [
        {
          severity: "skipped",
          configurationIndex: 0,
          message:
            field === "smartStep"
              ? "configurations[0].smartStep must be a boolean."
              : `configurations[0].${field} must be exactly false.`,
        },
      ],
    });
  });

  it("accepts smartStep true and leaves the missing value for the loader default", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "pwa-node",
            request: "attach",
            name: "Attach",
            port: 9229,
            smartStep: true,
          },
          {
            type: "node",
            request: "launch",
            name: "Default",
            program: "server.js",
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ smartStep: true }, { configuration: { name: "Default" } }],
      diagnostics: [],
    });
    if (parsed.kind === "ok") {
      expect(parsed.configurations[1]).not.toHaveProperty("smartStep");
    }
  });

  it("accepts only the backend-owned numeric IPv4 loopback attach address as a no-op", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "attach",
            name: "Loopback",
            port: 9229,
            address: "127.0.0.1",
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { target: { kind: "attach", port: 9229 } } }],
      diagnostics: [],
    });
    if (parsed.kind !== "ok") return;
    expect(parsed.configurations[0]).not.toHaveProperty("address");
    expect(parsed.configurations[0]?.configuration).not.toHaveProperty("address");
  });

  it.each(["localhost", "::1", "0.0.0.0", "example.com", 2130706433, null])(
    "rejects attach address that does not exactly match the owned IPv4 loopback endpoint: %j",
    (address) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "attach",
              name: "Unsupported address",
              port: 9229,
              address,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [],
        diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("address") }],
      });
    },
  );

  it("rejects attach-only address metadata on a launch", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "Launch address",
              program: "src/server.js",
              address: "127.0.0.1",
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("attach") }],
    });
  });

  it.each([
    ["arbitrary executable", "node", ["run", "dev"], undefined],
    ["executable path", "./node_modules/.bin/npm", ["run", "dev"], undefined],
    ["missing runtime args", "npm", undefined, undefined],
    ["missing executable", undefined, ["run", "dev"], undefined],
    ["wrong verb", "npm", ["start", "dev"], undefined],
    ["missing script", "npm", ["run"], undefined],
    ["extra runtime arg", "npm", ["run", "dev", "--", "--watch"], undefined],
    ["leading dash", "npm", ["run", "-dev"], undefined],
    ["space", "npm", ["run", "dev api"], undefined],
    ["dynamic script", "npm", ["run", "${input:script}"], undefined],
    ["non-ASCII script", "npm", ["run", "développement"], undefined],
    ["oversized script", "npm", ["run", "a".repeat(129)], undefined],
    ["program mixed in", "npm", ["run", "dev"], "server.js"],
  ])("rejects unsafe npm launch form: %s", (_case, runtimeExecutable, runtimeArgs, program) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "npm",
            runtimeExecutable,
            runtimeArgs,
            ...(program ? { program } : {}),
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringMatching(/runtime|script program/) }],
    });
  });

  it("rejects non-empty npm args to avoid forwarding them with different semantics", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "npm",
              runtimeExecutable: "npm",
              runtimeArgs: ["run", "dev"],
              args: ["--watch"],
            },
          ],
        }),
      ),
    ).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("absent or empty") }],
    });
  });

  it.each([
    "PATH",
    "path",
    "NODE_OPTIONS",
    "SHELL",
    "COMSPEC",
    "PATHEXT",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "npm_config_registry",
  ])("rejects protected npm environment name %s without exposing its value", (name) => {
    const secret = "SUPER_SECRET_RAW_VALUE";
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "npm",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev"],
            env: { [name]: secret },
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("protected environment name") }],
    });
    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it.each([
    ["script", {}],
    ["tsx", { runtimeExecutable: "tsx" }],
    ["ts-node", { runtimeExecutable: "ts-node" }],
  ])(
    "rejects protected environment names at the parser boundary for a %s launch",
    (_case, runtimeFields) => {
      for (const name of ["PATH", "path", "NODE_OPTIONS", "npm_config_registry"]) {
        const secret = `PRIVATE_${name}_VALUE`;
        const parsed = parseVscodeNodeLaunchConfigurations(
          JSON.stringify({
            version: "0.2.0",
            configurations: [
              {
                type: "node",
                request: "launch",
                name: "Protected environment",
                program: "src/server.ts",
                ...runtimeFields,
                env: { SAFE: "visible", [name]: secret },
              },
            ],
          }),
        );

        expect(parsed).toMatchObject({
          kind: "ok",
          configurations: [],
          diagnostics: [
            {
              configurationIndex: 0,
              message: expect.stringContaining("protected environment name"),
            },
          ],
        });
        expect(JSON.stringify(parsed)).not.toContain(secret);
      }
    },
  );

  it("rejects dynamic substitutions, absolute paths, attach env, and launch ports", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Dynamic",
            program: "${file}",
          },
          {
            type: "node",
            request: "launch",
            name: "Absolute",
            program: "/private/server.js",
          },
          {
            type: "node",
            request: "attach",
            name: "Attach env",
            port: 9229,
            env: { SECRET: "value" },
          },
          {
            type: "node",
            request: "launch",
            name: "Launch port",
            program: "server.js",
            port: 9229,
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({ kind: "ok", configurations: [] });
    if (parsed.kind !== "ok") return;
    expect(parsed.diagnostics).toHaveLength(4);
  });

  it.each(["config/dev.env", "${workspaceFolder}/config/dev.env"])(
    "accepts a workspace-contained script envFile path %s",
    (envFile) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "API",
              program: "server.js",
              envFile,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [
          {
            configuration: { envFile: "config/dev.env" },
            envFile: "config/dev.env",
          },
        ],
        diagnostics: [],
      });
    },
  );

  it.each([
    ["npm", { runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] }],
    ["attach", { request: "attach", port: 9229 }],
    ["native watch", { runtimeArgs: ["--watch"], program: "server.js" }],
  ])("rejects envFile for %s configurations with a clear diagnostic", (_case, fields) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Unsupported",
            program: "server.js",
            envFile: ".env",
            ...fields,
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [],
      diagnostics: [{ message: expect.stringContaining("envFile") }],
    });
  });

  it.each(["../outside.env", "/tmp/outside.env", "${fileDirname}/.env", "env/${input:name}"])(
    "rejects an escaping or dynamic envFile path %s",
    (envFile) => {
      const parsed = parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [
            {
              type: "node",
              request: "launch",
              name: "API",
              program: "server.js",
              envFile,
            },
          ],
        }),
      );

      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [],
        diagnostics: [{ message: expect.stringContaining("envFile") }],
      });
    },
  );

  it("retains prototype-shaped environment names as exact own data properties", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      `{
        "version": "0.2.0",
        "configurations": [{
          "type": "node",
          "request": "launch",
          "name": "API",
          "program": "server.js",
          "env": {
            "__proto__": "literal-prototype",
            "constructor": "literal-constructor"
          }
        }]
      }`,
    );

    expect(parsed).toMatchObject({ kind: "ok", diagnostics: [] });
    if (parsed.kind !== "ok") return;
    const environment = parsed.configurations[0]!.configuration.env;
    expect(Object.prototype.hasOwnProperty.call(environment, "__proto__")).toBe(true);
    expect(environment.__proto__).toBe("literal-prototype");
    expect(environment.constructor).toBe("literal-constructor");
    expect(Object.getPrototypeOf(environment)).toBe(Object.prototype);
  });

  it("invalidates every duplicate name instead of creating ambiguous task binding", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          { type: "node", request: "launch", name: "API", program: "a.js" },
          { type: "node", request: "launch", name: "API", program: "b.js" },
          { type: "node", request: "launch", name: "Worker", program: "worker.js" },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      configurations: [{ configuration: { name: "Worker" } }],
      diagnostics: [
        expect.objectContaining({ message: expect.stringContaining('named "API"') }),
        expect.objectContaining({ message: expect.stringContaining('named "API"') }),
      ],
    });
  });

  it.each([
    '{"__proto__":{"version":"0.2.0","configurations":[]}}',
    '{"constructor":{"prototype":{"version":"0.2.0","configurations":[]}}}',
    '{"version":"0.2.0","version":"0.2.0","configurations":[]}',
  ])("rejects duplicate or prototype-shaped root payload %s", (source) => {
    expect(parseVscodeNodeLaunchConfigurations(source)).toMatchObject({ kind: "error" });
  });

  it("imports only resolved, bounded, task-safe script/npm compounds as frozen metadata", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "API",
            program: "src/api.js",
            stopOnEntry: true,
            outFiles: ["${workspaceFolder}/dist/**/*.js"],
          },
          {
            type: "node",
            request: "launch",
            name: "Worker",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "worker"],
            stopOnEntry: false,
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
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      compounds: [
        {
          name: "Services",
          members: [
            {
              configuration: { name: "API", target: { kind: "script" } },
              stopOnEntry: true,
              outFiles: ["${workspaceFolder}/dist/**/*.js"],
            },
            {
              configuration: { name: "Worker", target: { kind: "npm" } },
              stopOnEntry: false,
            },
          ],
          preLaunchTask: "build services",
        },
      ],
      diagnostics: [
        {
          configurationIndex: 0,
          severity: "reduced",
          fields: ["outFiles"],
        },
      ],
    });
    if (parsed.kind !== "ok" || !parsed.compounds) return;
    expect(Object.isFrozen(parsed.compounds)).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0])).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members)).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0])).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0]?.configuration)).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0]?.configuration.args)).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0]?.configuration.env)).toBe(true);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0]?.configuration.target)).toBe(true);
    expect(parsed.compounds[0]?.members[0]?.outFiles).toEqual(["${workspaceFolder}/dist/**/*.js"]);
    expect(Object.isFrozen(parsed.compounds[0]?.members[0]?.outFiles)).toBe(true);
    expect(parsed.compounds[0]).not.toHaveProperty("stopAll");
    expect(parsed.compounds[0]).not.toHaveProperty("configurations");
  });

  it("skips ambiguous, unknown, colliding, attach, and child-task compound bindings", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          { type: "node", request: "launch", name: "API", program: "src/api.js" },
          { type: "node", request: "launch", name: "Worker", program: "src/worker.js" },
          { type: "node", request: "attach", name: "Inspector", port: 9229 },
          {
            type: "node",
            request: "launch",
            name: "Prepared",
            program: "src/prepared.js",
            preLaunchTask: "build prepared",
          },
        ],
        compounds: [
          { name: "Duplicate", configurations: ["API", "Worker"], stopAll: true },
          { name: "Duplicate", configurations: ["API", "Worker"], stopAll: true },
          { name: "Unknown", configurations: ["API", "Missing"], stopAll: true },
          { name: "API", configurations: ["API", "Worker"], stopAll: true },
          { name: "Attach child", configurations: ["API", "Inspector"], stopAll: true },
          { name: "Task child", configurations: ["API", "Prepared"], stopAll: true },
          { name: "Repeated child", configurations: ["API", "API"], stopAll: true },
        ],
      }),
    );

    expect(parsed).toMatchObject({ kind: "ok", compounds: [] });
    if (parsed.kind !== "ok") return;
    expect(parsed.diagnostics).toHaveLength(7);
    expect(parsed.diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ambiguous"),
        expect.stringContaining("unknown launch configuration"),
        expect.stringContaining("collides"),
        expect.stringContaining("task-free script or npm"),
        expect.stringContaining("unique member names"),
      ]),
    );
  });

  it.each([
    ["stopAll missing", { name: "Services", configurations: ["API", "Worker"] }],
    ["stopAll false", { name: "Services", configurations: ["API", "Worker"], stopAll: false }],
    ["one member", { name: "Services", configurations: ["API"], stopAll: true }],
    [
      "five members",
      {
        name: "Services",
        configurations: ["API", "Worker", "Three", "Four", "Five"],
        stopAll: true,
      },
    ],
    [
      "unsafe task",
      {
        name: "Services",
        configurations: ["API", "Worker"],
        stopAll: true,
        preLaunchTask: " build",
      },
    ],
    [
      "post task",
      {
        name: "Services",
        configurations: ["API", "Worker"],
        stopAll: true,
        postDebugTask: "cleanup",
      },
    ],
  ])("fails closed for compound shape: %s", (_case, compound) => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({
        version: "0.2.0",
        configurations: [
          { type: "node", request: "launch", name: "API", program: "src/api.js" },
          { type: "node", request: "launch", name: "Worker", program: "src/worker.js" },
        ],
        compounds: [compound],
      }),
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      compounds: [],
      diagnostics: [{ compoundIndex: 0 }],
    });
  });

  it("bounds compound count and keeps the legacy result shape when none were declared", () => {
    expect(
      parseVscodeNodeLaunchConfigurations(
        JSON.stringify({
          version: "0.2.0",
          configurations: [],
          compounds: Array.from({ length: 17 }, (_, index) => ({
            name: `Compound ${index}`,
            configurations: ["A", "B"],
            stopAll: true,
          })),
        }),
      ),
    ).toMatchObject({ kind: "error", message: expect.stringContaining("at most 16") });

    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({ version: "0.2.0", configurations: [] }),
    );
    expect(parsed).toEqual({ kind: "ok", configurations: [], diagnostics: [] });
    expect(parsed).not.toHaveProperty("compounds");
  });

  it("rejects ignored VS Code root capability inputs", () => {
    const parsed = parseVscodeNodeLaunchConfigurations(
      JSON.stringify({ version: "0.2.0", configurations: [], inputs: [] }),
    );
    expect(parsed).toMatchObject({
      kind: "error",
      message: expect.stringContaining("unsupported field"),
    });
    expect(JSON.stringify(parsed)).not.toContain("inputs");
  });

  it.each(["root", "configuration", "compound"] as const)(
    "never retains an attacker-controlled unknown %s field name in diagnostics",
    (location) => {
      const privateField = `PRIVATE_TOKEN_\u202e${"x".repeat(64)}`;
      const source =
        location === "root"
          ? {
              version: "0.2.0",
              configurations: [],
              [privateField]: true,
            }
          : location === "configuration"
            ? {
                version: "0.2.0",
                configurations: [
                  {
                    type: "node",
                    request: "launch",
                    name: "Private field",
                    program: "src/server.js",
                    [privateField]: true,
                  },
                ],
              }
            : {
                version: "0.2.0",
                configurations: [
                  {
                    type: "node",
                    request: "launch",
                    name: "One",
                    program: "src/one.js",
                  },
                  {
                    type: "node",
                    request: "launch",
                    name: "Two",
                    program: "src/two.js",
                  },
                ],
                compounds: [
                  {
                    name: "Private compound field",
                    configurations: ["One", "Two"],
                    stopAll: true,
                    [privateField]: true,
                  },
                ],
              };

      const parsed = parseVscodeNodeLaunchConfigurations(JSON.stringify(source));
      expect(JSON.stringify(parsed)).not.toContain(privateField);
      expect(parsed).toMatchObject(
        location === "root"
          ? { kind: "error", message: expect.stringContaining("unsupported field") }
          : {
              kind: "ok",
              diagnostics: [
                {
                  message: expect.stringContaining("unsupported field"),
                  ...(location === "configuration"
                    ? { configurationIndex: 0 }
                    : { compoundIndex: 0 }),
                },
              ],
            },
      );
    },
  );

  it.each([
    {
      location: "root",
      source: {
        version: "0.2.0",
        configurations: [],
        "": true,
      },
    },
    {
      location: "configuration",
      source: {
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Empty field",
            program: "src/server.js",
            "": true,
          },
        ],
      },
    },
    {
      location: "compound",
      source: {
        version: "0.2.0",
        configurations: [
          { type: "node", request: "launch", name: "One", program: "src/one.js" },
          { type: "node", request: "launch", name: "Two", program: "src/two.js" },
        ],
        compounds: [
          {
            name: "Empty compound field",
            configurations: ["One", "Two"],
            stopAll: true,
            "": true,
          },
        ],
      },
    },
    {
      location: "serverReadyAction",
      source: {
        version: "0.2.0",
        configurations: [
          {
            type: "node",
            request: "launch",
            name: "Empty action field",
            program: "src/server.js",
            serverReadyAction: {
              action: "openExternally",
              pattern: "port ([0-9]+)",
              uriFormat: "http://127.0.0.1:%s",
              "": true,
            },
          },
        ],
      },
    },
  ])("rejects an empty unknown field name at the $location boundary", ({ source }) => {
    const parsed = parseVscodeNodeLaunchConfigurations(JSON.stringify(source));
    if ("compounds" in source) {
      expect(parsed).toMatchObject({
        kind: "ok",
        compounds: [],
        diagnostics: [{ compoundIndex: 0, message: expect.stringContaining("field") }],
      });
    } else if (source.configurations.length > 0) {
      expect(parsed).toMatchObject({
        kind: "ok",
        configurations: [],
        diagnostics: [{ configurationIndex: 0, message: expect.stringContaining("field") }],
      });
    } else {
      expect(parsed).toMatchObject({
        kind: "error",
        message: expect.stringContaining("field"),
      });
    }
  });
});
