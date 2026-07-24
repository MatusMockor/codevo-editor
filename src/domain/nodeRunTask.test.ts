import { describe, expect, it } from "vitest";
import type { DebugLaunchTarget } from "./debug";
import {
  MAX_NODE_RUN_TASK_ARGUMENTS,
  MAX_NODE_RUN_TASK_ARGUMENT_BYTES,
  MAX_NODE_RUN_TASK_ENV_ENTRIES,
  MAX_NODE_RUN_TASK_ENV_KEY_BYTES,
  MAX_NODE_RUN_TASK_ENV_VALUE_BYTES,
  parseNodeRunTarget,
  parseNodeRunTaskStatusEvent,
  toNodeRunTarget,
} from "./nodeRunTask";

describe("Node run task domain", () => {
  it.each<DebugLaunchTarget>([
    { kind: "node-script", scriptPath: "/workspace/app.js" },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.js",
      args: ["--port", "3000"],
      cwd: "/workspace",
      env: { NODE_ENV: "test" },
    },
    {
      kind: "js-test-file",
      runner: "vitest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
    },
    {
      kind: "js-configured-test",
      runner: "jest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
      args: [],
      env: {},
    },
    {
      kind: "node-npm-script",
      script: "test:unit",
      packageRootPath: "/workspace",
      args: ["--watch=false"],
      env: {},
    },
  ])("accepts and clones $kind", (target) => {
    const parsed = toNodeRunTarget(target);
    expect(parsed).toEqual(target);
    expect(parsed).not.toBe(target);
  });

  it.each<DebugLaunchTarget>([
    { kind: "node-attach", port: 9229 },
    {
      kind: "js-test-selection",
      runner: "vitest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
      selection: { kind: "file" },
    },
    { kind: "php-script", scriptPath: "/workspace/app.php" },
    { kind: "php-test-file", filePath: "/workspace/appTest.php" },
    { kind: "php-listen" },
  ])("fails closed for $kind", (target) => {
    expect(toNodeRunTarget(target)).toBeNull();
  });

  it.each([
    { kind: "node-script", scriptPath: "/app.js", shell: "rm -rf /" },
    { kind: "node-attach", port: 9229 },
    { kind: "php-script", scriptPath: "/app.php" },
    { kind: "js-test-selection", selection: { kind: "file" } },
    { kind: "node-npm-script", script: "test", packageRootPath: "/w", args: [], env: {}, extra: 1 },
  ])("rejects unknown fields or unsupported targets", (target) => {
    expect(() => parseNodeRunTarget(target)).toThrow(TypeError);
  });

  it("bounds structured args and environment without accepting raw commands", () => {
    const base = {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.js",
      args: [],
      env: {},
    };
    expect(() =>
      parseNodeRunTarget({ ...base, args: Array(MAX_NODE_RUN_TASK_ARGUMENTS + 1).fill("x") }),
    ).toThrow("target.args");
    expect(() =>
      parseNodeRunTarget({
        ...base,
        env: Object.fromEntries(
          Array.from({ length: MAX_NODE_RUN_TASK_ENV_ENTRIES + 1 }, (_, index) => [
            `K${index}`,
            "x",
          ]),
        ),
      }),
    ).toThrow("target.env");
    expect(() => parseNodeRunTarget({ ...base, env: { "BAD=KEY": "x" } })).toThrow(
      "environment name",
    );
    expect(() => parseNodeRunTarget({ ...base, command: "node app.js" })).toThrow(TypeError);
  });

  it("matches the native launch-option boundaries and protected environment policy", () => {
    const base = {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.js",
      args: Array(MAX_NODE_RUN_TASK_ARGUMENTS).fill("x".repeat(MAX_NODE_RUN_TASK_ARGUMENT_BYTES)),
      env: Object.fromEntries(
        Array.from({ length: MAX_NODE_RUN_TASK_ENV_ENTRIES }, (_, index) => [
          `SAFE_${index}`,
          "x".repeat(MAX_NODE_RUN_TASK_ENV_VALUE_BYTES),
        ]),
      ),
    };
    expect(parseNodeRunTarget(base)).toMatchObject({ kind: "node-configured-script" });
    expect(() =>
      parseNodeRunTarget({ ...base, args: ["x".repeat(MAX_NODE_RUN_TASK_ARGUMENT_BYTES + 1)] }),
    ).toThrow("target.args[0]");
    expect(() =>
      parseNodeRunTarget({
        ...base,
        env: { [`A${"B".repeat(MAX_NODE_RUN_TASK_ENV_KEY_BYTES)}`]: "x" },
      }),
    ).toThrow("target.env key");
    expect(() =>
      parseNodeRunTarget({
        ...base,
        env: { SAFE: "x".repeat(MAX_NODE_RUN_TASK_ENV_VALUE_BYTES + 1) },
      }),
    ).toThrow("target.env.SAFE");

    for (const key of [
      "PATH",
      "path",
      "Node_Options",
      "shell",
      "ComSpec",
      "pathext",
      "npm_config_userconfig",
    ]) {
      expect(() => parseNodeRunTarget({ ...base, env: { [key]: "x" } })).toThrow(
        "unprotected environment name",
      );
    }
    for (const key of ["1BAD", "BAD-NAME", "BAD.NAME", "ŽLTÝ"]) {
      expect(() => parseNodeRunTarget({ ...base, env: { [key]: "x" } })).toThrow(
        "unprotected environment name",
      );
    }
    for (const argument of ["--inspect", "--INSPECT-brk=9230", "--inspector-mode"]) {
      expect(() => parseNodeRunTarget({ ...base, args: [argument] })).toThrow(
        "does not enable the inspector",
      );
    }
  });

  it("strictly decodes bounded status variants without echoing target secrets", () => {
    const owner = { runId: "run-1", workspaceId: "ws-1", terminalSessionId: 4 };
    expect(parseNodeRunTaskStatusEvent({ ...owner, status: "running" })).toEqual({
      ...owner,
      status: "running",
    });
    expect(
      parseNodeRunTaskStatusEvent({ ...owner, status: "exited", exitCode: null }),
    ).toMatchObject({ status: "exited", exitCode: null });
    expect(
      parseNodeRunTaskStatusEvent({ ...owner, status: "failed", message: "failed" }),
    ).toMatchObject({ status: "failed", message: "failed" });

    expect(() =>
      parseNodeRunTaskStatusEvent({ ...owner, status: "running", target: { env: { TOKEN: "x" } } }),
    ).toThrow(TypeError);
    expect(() => parseNodeRunTaskStatusEvent({ ...owner, status: "exited" })).toThrow(TypeError);
    expect(() =>
      parseNodeRunTaskStatusEvent({ ...owner, status: "failed", message: "x".repeat(4_097) }),
    ).toThrow("event.message");
  });
});
