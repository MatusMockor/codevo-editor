import { describe, expect, it } from "vitest";
import {
  cloneNativeNodeWatchLaunchIntent,
  type NativeNodeWatchLaunchIntent,
} from "./nativeNodeWatchLaunchIntent";

describe("native Node watch launch intent", () => {
  it.each(["server.js", "src/server.mjs", "worker.cjs"])(
    "clones and freezes the closed runtime-free %s intent",
    (scriptPath) => {
      const source: NativeNodeWatchLaunchIntent = {
        kind: "native-node-watch",
        scriptPath,
        watch: true,
        preserveOutput: true,
      };

      const result = cloneNativeNodeWatchLaunchIntent(source);

      expect(result).toEqual({ kind: "ok", intent: source });
      if (result.kind !== "ok") return;
      expect(result.intent).not.toBe(source);
      expect(Object.isFrozen(result.intent)).toBe(true);
      expect(result.intent).not.toHaveProperty("runtime");
      expect(result.intent).not.toHaveProperty("runtimeArgs");
      expect(result.intent).not.toHaveProperty("env");
    },
  );

  it("omits preserveOutput when it was not requested", () => {
    expect(
      cloneNativeNodeWatchLaunchIntent({
        kind: "native-node-watch",
        scriptPath: "server.js",
        watch: true,
      }),
    ).toEqual({
      kind: "ok",
      intent: {
        kind: "native-node-watch",
        scriptPath: "server.js",
        watch: true,
      },
    });
  });

  it.each([
    ["unknown field", { shell: true }],
    ["runtime", { runtime: { kind: "managed-node", major: 22 } }],
    ["runtime executable", { runtimeExecutable: "node" }],
    ["raw runtime arguments", { runtimeArgs: ["--watch"] }],
    ["arguments", { args: [] }],
    ["environment", { env: {} }],
  ])("rejects %s capability", (_case, extra) => {
    expect(
      cloneNativeNodeWatchLaunchIntent({
        kind: "native-node-watch",
        scriptPath: "server.js",
        watch: true,
        ...extra,
      }),
    ).toEqual({ kind: "error", message: "Invalid native Node watch launch intent." });
  });

  it.each([
    ["wrong kind", { kind: "node-watch" }],
    ["watch false", { watch: false }],
    ["preserve false", { preserveOutput: false }],
    ["TypeScript", { scriptPath: "server.ts" }],
    ["tsx tool", { scriptPath: "tsx" }],
    ["nodemon tool", { scriptPath: "nodemon" }],
    ["shell", { scriptPath: "/bin/sh" }],
    ["NUL", { scriptPath: "server.js\0ignored" }],
    ["empty", { scriptPath: "" }],
    ["oversize", { scriptPath: `${"é".repeat(2_048)}.js` }],
  ])("rejects %s", (_case, replacement) => {
    expect(
      cloneNativeNodeWatchLaunchIntent({
        kind: "native-node-watch",
        scriptPath: "server.js",
        watch: true,
        ...replacement,
      }),
    ).toEqual({ kind: "error", message: "Invalid native Node watch launch intent." });
  });
});
