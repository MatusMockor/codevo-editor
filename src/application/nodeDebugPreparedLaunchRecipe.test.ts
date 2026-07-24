import { describe, expect, it } from "vitest";
import { clonePreparedNodeDebugLaunch } from "./nodeDebugPreparedLaunchRecipe";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

describe("clonePreparedNodeDebugLaunch", () => {
  it("retains a bounded immutable private recipe without caller aliases", () => {
    const prepared: PreparedNodeDebugLaunch = {
      envFile: "config/dev.env",
      launch: {
        args: ["--mode", "safe"],
        env: { TOKEN: "accepted" },
        envFile: "config/dev.env",
        kind: "node-configured-script",
        scriptPath: "/workspace/api.js",
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
        scriptPath: "/workspace/api.js",
      },
      postDebugTask: { label: "stop api" },
      preLaunchTask: { label: "build api" },
    });
  });

  it("rejects recipes without an exact post task or with an unsupported launch", () => {
    expect(
      clonePreparedNodeDebugLaunch({
        launch: { kind: "php-script", scriptPath: "/workspace/index.php" },
        postDebugTask: { label: "stop api" },
        preLaunchTask: null,
      }),
    ).toBeNull();
    expect(
      clonePreparedNodeDebugLaunch({
        launch: { kind: "node-script", scriptPath: "/workspace/api.js" },
        preLaunchTask: null,
      }),
    ).toBeNull();
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
