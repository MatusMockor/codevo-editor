import { describe, expect, it } from "vitest";
import {
  cloneNativeNodeWatchLaunchRecipe,
  nativeNodeWatchRuntimeSupport,
} from "./nodeNativeWatchLaunchPolicy";

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "native-node-watch",
    runtime: { kind: "managed-node", major: 22, support: "supported" },
    scriptPath: "/workspace/server.mjs",
    watch: true,
    ...overrides,
  };
}

describe("native Node watch launch policy", () => {
  it.each([
    ["js", "/workspace/server.js"],
    ["mjs", "/workspace/server.mjs"],
    ["cjs", "/workspace/server.cjs"],
  ])("clones a managed Node %s recipe", (_extension, scriptPath) => {
    const source = recipe({ scriptPath, preserveOutput: true });
    const result = cloneNativeNodeWatchLaunchRecipe(source);

    expect(result).toEqual({
      kind: "ok",
      recipe: {
        kind: "native-node-watch",
        runtime: { kind: "managed-node", major: 22, support: "supported" },
        scriptPath,
        watch: true,
        preserveOutput: true,
      },
    });
    if (result.kind !== "ok") throw new Error("expected a valid recipe");
    expect(result.recipe).not.toBe(source);
    expect(result.recipe.runtime).not.toBe(source.runtime);
    expect(Object.isFrozen(result.recipe)).toBe(true);
    expect(Object.isFrozen(result.recipe.runtime)).toBe(true);
  });

  it("normalizes the optional preserve-output flag by omitting it", () => {
    const result = cloneNativeNodeWatchLaunchRecipe(recipe());

    expect(result).toEqual({
      kind: "ok",
      recipe: {
        kind: "native-node-watch",
        runtime: { kind: "managed-node", major: 22, support: "supported" },
        scriptPath: "/workspace/server.mjs",
        watch: true,
      },
    });
  });

  it.each([
    [22, "supported"],
    [24, "supported"],
    [26, "best-effort"],
  ] as const)("pins Node %i to %s support", (major, support) => {
    expect(nativeNodeWatchRuntimeSupport(major)).toBe(support);
    expect(
      cloneNativeNodeWatchLaunchRecipe(
        recipe({ runtime: { kind: "managed-node", major, support } }),
      ).kind,
    ).toBe("ok");
  });

  it.each([
    ["raw runtime arguments", { runtimeArgs: ["--watch"] }],
    ["shell", { shell: "/bin/sh" }],
    ["npm indirection", { npm: "dev" }],
    ["nodemon indirection", { nodemon: true }],
    ["tsx indirection", { tsx: true }],
    ["unknown root field", { extra: true }],
    ["watch disabled", { watch: false }],
    ["false preserve-output marker", { preserveOutput: false }],
    ["TypeScript entrypoint", { scriptPath: "/workspace/server.ts" }],
    ["uppercase extension", { scriptPath: "/workspace/server.JS" }],
    ["empty script", { scriptPath: "" }],
    ["NUL in script", { scriptPath: "/workspace/server.js\0ignored" }],
  ])("rejects %s", (_name, overrides) => {
    expect(cloneNativeNodeWatchLaunchRecipe(recipe(overrides))).toEqual({
      kind: "error",
      message: "Invalid native Node watch launch recipe.",
    });
  });

  it.each([
    ["unmanaged runtime", { kind: "system-node", major: 22, support: "supported" }],
    ["unsupported Node 20", { kind: "managed-node", major: 20, support: "supported" }],
    ["unsupported Node 23", { kind: "managed-node", major: 23, support: "supported" }],
    ["optimistic Node 26", { kind: "managed-node", major: 26, support: "supported" }],
    ["pessimistic Node 24", { kind: "managed-node", major: 24, support: "best-effort" }],
    [
      "raw runtime field",
      { kind: "managed-node", major: 22, support: "supported", executable: "/usr/bin/node" },
    ],
  ])("rejects %s", (_name, runtime) => {
    expect(cloneNativeNodeWatchLaunchRecipe(recipe({ runtime })).kind).toBe("error");
  });

  it("applies the script path limit to UTF-8 bytes", () => {
    expect(
      cloneNativeNodeWatchLaunchRecipe(recipe({ scriptPath: `/${"💾".repeat(1_022)}x.js` })).kind,
    ).toBe("ok");
    expect(
      cloneNativeNodeWatchLaunchRecipe(recipe({ scriptPath: `/${"💾".repeat(1_023)}x.js` })).kind,
    ).toBe("error");
  });
});
