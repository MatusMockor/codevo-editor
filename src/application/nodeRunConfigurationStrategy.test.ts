import { describe, expect, it } from "vitest";
import type { DebugLaunchTarget } from "../domain/debug";
import type { NodeLaunchConfiguration } from "../domain/nodeLaunchConfiguration";
import {
  nodeRunConfigurationStrategy,
  prepareNodeRunLaunchTarget,
} from "./nodeRunConfigurationStrategy";

const ROOT = "/workspace";

describe("nodeRunConfigurationStrategy", () => {
  it("clones and validates a configured script without exposing the source objects", () => {
    const configuration: NodeLaunchConfiguration = {
      args: ["--port", "3000"],
      cwd: "services/api",
      default: false,
      env: { API_TOKEN: "private" },
      name: "API",
      target: { kind: "script", path: "src/api.ts" },
    };

    const result = nodeRunConfigurationStrategy(configuration, ROOT);

    expect(result).toEqual({
      kind: "supported",
      value: {
        args: ["--port", "3000"],
        cwd: "/workspace/services/api",
        env: { API_TOKEN: "private" },
        kind: "node-configured-script",
        scriptPath: "/workspace/src/api.ts",
      },
    });
    if (result.kind !== "supported") throw new Error("expected supported target");
    if (result.value.kind !== "node-configured-script") {
      throw new Error("expected configured script target");
    }
    expect(result.value).not.toBe(configuration);
    expect(result.value.args).not.toBe(configuration.args);
    expect(result.value.env).not.toBe(configuration.env);
  });

  it("returns only a safe constant for attach and inspector configurations", () => {
    expect(
      nodeRunConfigurationStrategy(
        {
          args: [],
          default: false,
          env: {},
          name: "Attach",
          target: { kind: "attach", port: 9229 },
        },
        ROOT,
      ),
    ).toEqual({ kind: "unsupported", reason: "attachRequiresDebugger" });
    expect(
      nodeRunConfigurationStrategy(
        {
          args: ["--inspect-brk=0", "SECRET=do-not-leak"],
          default: false,
          env: {},
          name: "Inspector",
          target: { kind: "script", path: "src/api.ts" },
        },
        ROOT,
      ),
    ).toEqual({ kind: "unsupported", reason: "inspectorRequiresDebugger" });
  });

  it.each<DebugLaunchTarget>([
    { kind: "php-script", scriptPath: "/workspace/index.php" },
    { kind: "php-test-file", filePath: "/workspace/AppTest.php" },
    { kind: "php-listen", port: 9003 },
    {
      filePath: "/workspace/a.test.ts",
      kind: "js-test-selection",
      packageRootPath: ROOT,
      runner: "vitest",
      selection: { kind: "test", fullName: "secret suite", nameMatch: "exact" },
    },
  ])("fails closed for unsupported launch kind $kind", (launch) => {
    expect(prepareNodeRunLaunchTarget(launch)).toEqual({
      kind: "unsupported",
      reason: "unsupportedTarget",
    });
  });

  it.each([
    {
      label: "protected environment",
      launch: {
        args: [],
        env: { NODE_OPTIONS: "--require=secret.js" },
        kind: "node-configured-script",
        scriptPath: "/workspace/api.ts",
      },
    },
    {
      label: "invalid argument",
      launch: {
        args: ["bad\0secret"],
        env: {},
        kind: "node-configured-script",
        scriptPath: "/workspace/api.ts",
      },
    },
  ])("maps $label details to invalidOptions", ({ launch }) => {
    expect(prepareNodeRunLaunchTarget(launch as DebugLaunchTarget)).toEqual({
      kind: "unsupported",
      reason: "invalidOptions",
    });
  });
});
