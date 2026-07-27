import { describe, expect, it } from "vitest";
import {
  clonePreparedNodeDebugLaunch,
  createPreparedNodeDebugRestartStrategy,
} from "./nodeDebugPreparedLaunchRecipe";
import {
  prepareNodeDebugLaunch,
  type PreparedNodeDebugLaunch,
} from "./useNodeDebugConfigurationLauncher";

describe("clonePreparedNodeDebugLaunch", () => {
  it("retains a bounded immutable private recipe without caller aliases", () => {
    const prepared: PreparedNodeDebugLaunch = {
      envFile: "config/dev.env",
      launch: {
        args: ["--mode", "safe"],
        env: { TOKEN: "accepted" },
        envFile: "config/dev.env",
        kind: "node-configured-script",
        runtime: "tsx",
        scriptPath: "/workspace/api.js",
        stopOnEntry: true,
      },
      postDebugTask: { label: "stop api" },
      preLaunchTask: { label: "build api" },
    };

    const clone = clonePreparedNodeDebugLaunch(prepared);
    expect(clone).toEqual(prepared);
    expect(clone).not.toBe(prepared);
    expect(clone?.launch).not.toBe(prepared.launch);
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(clone?.launch)).toBe(true);

    if (prepared.launch.kind === "node-configured-script") {
      prepared.launch.args.push("--mutated");
      prepared.launch.env.TOKEN = "mutated";
    }
    expect(clone).toEqual({
      envFile: "config/dev.env",
      launch: {
        args: ["--mode", "safe"],
        env: { TOKEN: "accepted" },
        envFile: "config/dev.env",
        kind: "node-configured-script",
        runtime: "tsx",
        scriptPath: "/workspace/api.js",
        stopOnEntry: true,
      },
      postDebugTask: { label: "stop api" },
      preLaunchTask: { label: "build api" },
    });
  });

  it("rejects a structurally typed configured script with an unknown runtime", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        launch: {
          args: [],
          env: {},
          kind: "node-configured-script",
          runtime: "nodemon",
          scriptPath: "/workspace/api.ts",
        },
        preLaunchTask: null,
      } as unknown as PreparedNodeDebugLaunch),
    ).toBeNull();
  });

  it("rejects a structurally typed launch with a null stopOnEntry", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        launch: {
          args: [],
          env: {},
          kind: "node-configured-script",
          scriptPath: "/workspace/api.ts",
          stopOnEntry: null,
        },
        preLaunchTask: null,
      } as unknown as PreparedNodeDebugLaunch),
    ).toBeNull();
  });

  it("accepts an ordinary launch recipe and rejects an unsupported launch", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        launch: { kind: "php-script", scriptPath: "/workspace/index.php" },
        postDebugTask: { label: "stop api" },
        preLaunchTask: null,
      }),
    ).toBeNull();
    const ordinary = {
      launch: { kind: "node-script", scriptPath: "/workspace/api.js" },
      preLaunchTask: null,
    } as const;
    expect(clonePreparedNodeDebugLaunch(ordinary)).toEqual(ordinary);
    const strategy = createPreparedNodeDebugRestartStrategy(ordinary);
    expect(strategy).toEqual({ kind: "replay-prepared", prepared: ordinary });
    expect(Object.isFrozen(strategy)).toBe(true);
    expect(Object.isFrozen(strategy?.prepared)).toBe(true);
  });

  it("retains the exact relative VS Code Node compatibility launch used by desktop QA", () => {
    const configuration = {
      args: [],
      default: false,
      env: {},
      name: "Compat node smartStep off",
      target: { kind: "script" as const, path: "qa-large.js" },
    };
    const prepared = prepareNodeDebugLaunch(configuration, "/workspace", {
      configuration,
      smartStep: false,
      source: "vscode",
    });

    expect(prepared).toMatchObject({
      kind: "supported",
      value: {
        launch: {
          args: [],
          env: {},
          kind: "node-configured-script",
          scriptPath: "/workspace/qa-large.js",
          smartStep: false,
        },
        preLaunchTask: null,
      },
    });
    if (prepared.kind !== "supported") return;
    expect(createPreparedNodeDebugRestartStrategy(prepared.value)).not.toBeNull();
  });

  it("rejects a structurally typed recipe that bypasses parser URL and matcher grammar", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        launch: { kind: "node-script", scriptPath: "/workspace/api.js" },
        preLaunchTask: null,
        serverReadyAction: {
          action: "openExternally",
          match: { kind: "port", prefix: "port ", suffix: "0" },
          uri: { scheme: "https", host: "localhost", path: "/%2e%2e/private" },
        },
      }),
    ).toBeNull();
  });

  it("rejects envFile metadata that is missing from the configured-script wire recipe", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        envFile: "config/dev.env",
        launch: {
          args: [],
          env: {},
          kind: "node-configured-script",
          scriptPath: "/workspace/api.js",
        },
        postDebugTask: { label: "stop api" },
        preLaunchTask: null,
      }),
    ).toBeNull();
  });
});
