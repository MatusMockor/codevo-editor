import { describe, expect, it, vi } from "vitest";
import {
  decodeNodePackageTaskOutputEvent,
  decodeNodePackageTaskProblemsEvent,
  invokeNodePackageScriptsIpc,
  invokeAcknowledgeNodePackageTaskStartIpc,
  invokeStartNodePackageTaskIpc,
  invokeStopNodePackageTaskIpc,
  NODE_PACKAGE_SCRIPTS_IPC_COMMAND,
} from "./tauriNodePackageScriptsIpcContract";

const args = { workspaceId: "ws-1", maxManifests: 10, maxScripts: 20, maxVisited: 100 };

describe("Node package scripts IPC contract", () => {
  it("invokes the explicit bounded discovery command and decodes its response", async () => {
    const invoke = vi.fn(async () => result());

    await expect(invokeNodePackageScriptsIpc(invoke, args)).resolves.toMatchObject({
      scripts: [expect.objectContaining({ scriptName: "build" })],
      total: 1,
      truncated: false,
      visited: 7,
    });
    expect(invoke).toHaveBeenCalledWith(NODE_PACKAGE_SCRIPTS_IPC_COMMAND, { request: args });
  });

  it.each([
    { ...args, extra: true },
    { workspaceId: "ws-1", maxManifests: 10, maxScripts: 20 },
    { ...args, workspaceId: "" },
    { ...args, workspaceId: "ws\n1" },
    { ...args, maxManifests: 0 },
    { ...args, maxScripts: 20_001 },
    { ...args, maxVisited: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid requests before invoking the backend", async (invalidArgs) => {
    const invoke = vi.fn(async () => result());
    await expect(invokeNodePackageScriptsIpc(invoke, invalidArgs as typeof args)).rejects.toThrow(
      TypeError,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("enforces response limits captured by the request", async () => {
    const invoke = vi.fn(async () => ({ ...result(), visited: 8 }));
    await expect(invokeNodePackageScriptsIpc(invoke, { ...args, maxVisited: 7 })).rejects.toThrow(
      "result.visited",
    );
  });

  it("rejects unknown response and script fields", async () => {
    await expect(
      invokeNodePackageScriptsIpc(
        vi.fn(async () => ({ ...result(), extra: true })),
        args,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      invokeNodePackageScriptsIpc(
        vi.fn(async () => ({
          ...result(),
          scripts: [{ ...result().scripts[0], command: "rm -rf ." }],
        })),
        args,
      ),
    ).rejects.toThrow(TypeError);
  });

  it("invokes the exact typed start command and requires the echoed run id", async () => {
    const invoke = vi.fn(async () => ({ runId: "run-1" }));
    const request = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "apps/web/package.json",
      scriptName: "build prod ✓",
    };

    await expect(invokeStartNodePackageTaskIpc(invoke, request)).resolves.toEqual({
      runId: "run-1",
    });
    expect(invoke).toHaveBeenCalledWith("workspace_start_node_package_task", {
      request,
    });
    await expect(
      invokeStartNodePackageTaskIpc(
        vi.fn(async () => ({ runId: "substituted" })),
        request,
      ),
    ).rejects.toThrow("result.runId");
  });

  it.each(["-build", "bad\u0007name", "x".repeat(215)])(
    "rejects unsafe run script names before transport: %s",
    async (scriptName) => {
      const invoke = vi.fn(async () => ({ runId: "run-1" }));
      await expect(
        invokeStartNodePackageTaskIpc(invoke, {
          runId: "run-1",
          workspaceId: "ws-1",
          sessionId: 7,
          manifestRelativePath: "package.json",
          scriptName,
        }),
      ).rejects.toThrow("request.scriptName");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("strictly validates start requests and results", async () => {
    const invoke = vi.fn(async () => ({ runId: "run-1", extra: true }));
    await expect(
      invokeStartNodePackageTaskIpc(invoke, {
        runId: "run-1",
        workspaceId: "ws-1",
        sessionId: 7,
        manifestRelativePath: "package.json",
        scriptName: "build",
        extra: true,
      } as never),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      invokeStartNodePackageTaskIpc(
        vi.fn(async () => ({ runId: "" })),
        {
          runId: "run-1",
          workspaceId: "ws-1",
          sessionId: 7,
          manifestRelativePath: "package.json",
          scriptName: "build",
        },
      ),
    ).rejects.toThrow("result.runId");

    const valid = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "package.json",
      scriptName: "build",
    };
    for (const invalid of [
      { ...valid, runId: "x".repeat(129) },
      { ...valid, workspaceId: "x".repeat(1_025) },
      { ...valid, sessionId: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, manifestRelativePath: "package-lock.json" },
    ]) {
      const transport = vi.fn(async () => ({ runId: "run-1" }));
      await expect(invokeStartNodePackageTaskIpc(transport, invalid)).rejects.toThrow(TypeError);
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("invokes a strict idempotent stop request and accepts only null", async () => {
    const request = { runId: "run-1", workspaceId: "ws-1" };
    const invoke = vi.fn(async () => null);
    await expect(invokeStopNodePackageTaskIpc(invoke, request)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("workspace_stop_node_package_task", { request });

    await expect(
      invokeStopNodePackageTaskIpc(
        vi.fn(async () => ({})),
        request,
      ),
    ).rejects.toThrow("result");
    await expect(
      invokeStopNodePackageTaskIpc(invoke, { ...request, extra: true } as never),
    ).rejects.toThrow(TypeError);
  });

  it("invokes the strict start acknowledgement command", async () => {
    const invoke = vi.fn(async () => null);
    const request = { runId: "run-1", workspaceId: "ws-1" };
    await expect(
      invokeAcknowledgeNodePackageTaskStartIpc(invoke, request),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("workspace_acknowledge_node_package_task_start", {
      request,
    });
  });

  it("strictly decodes bounded output and problem snapshots", () => {
    const owner = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "package.json",
      scriptName: "lint",
    };
    expect(
      decodeNodePackageTaskOutputEvent({
        owner,
        sequence: 1,
        stream: "stderr",
        data: "x",
        truncated: false,
      }),
    ).toEqual({ owner, sequence: 1, stream: "stderr", data: "x", truncated: false });
    const problems = [
      {
        filePath: "/workspace/index.ts",
        lineNumber: 1,
        column: 2,
        severity: "error",
        message: "bad",
        code: "E1",
        source: "TypeScript",
      },
    ];
    expect(
      decodeNodePackageTaskProblemsEvent({
        kind: "complete",
        owner,
        sequence: 3,
        problems,
        total: 1,
        truncated: false,
      }),
    ).toMatchObject({ kind: "complete", sequence: 3, problems });

    expect(() =>
      decodeNodePackageTaskProblemsEvent({
        kind: "append",
        owner,
        sequence: 4,
        problems: Array(33).fill(problems[0]),
        total: 33,
        truncated: false,
      }),
    ).toThrow("at most 32 entries");
    expect(() =>
      decodeNodePackageTaskProblemsEvent({
        kind: "complete",
        owner,
        sequence: 5,
        problems: Array(257).fill(problems[0]),
        total: 257,
        truncated: false,
      }),
    ).toThrow("at most 256 entries");
    expect(() =>
      decodeNodePackageTaskProblemsEvent({
        kind: "append",
        owner,
        sequence: 6,
        problems: [{ ...problems[0], message: "x".repeat(2_049) }],
        total: 1,
        truncated: false,
      }),
    ).toThrow("event.problems[0].message");
    expect(() =>
      decodeNodePackageTaskProblemsEvent({
        kind: "append",
        owner,
        sequence: 7,
        problems: [{ ...problems[0], code: "x".repeat(129) }],
        total: 1,
        truncated: false,
      }),
    ).toThrow("event.problems[0].code");
  });

  it("matches Rust control-character policy for problem wire fields", () => {
    const owner = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "package.json",
      scriptName: "lint",
    };
    const problem = {
      filePath: "/workspace/index.ts",
      lineNumber: 1,
      column: 2,
      severity: "error",
      message: "bad\tdetail",
      code: "E1",
      source: "TypeScript",
    };
    const decode = (overrides: Partial<typeof problem>) =>
      decodeNodePackageTaskProblemsEvent({
        kind: "append",
        owner,
        sequence: 1,
        problems: [{ ...problem, ...overrides }],
        total: 1,
        truncated: false,
      });

    expect(decode({})).toMatchObject({ problems: [{ message: "bad\tdetail" }] });
    expect(() => decode({ message: "bad\nnext" })).toThrow("event.problems[0].message");
    expect(() => decode({ message: "bad\u0085next" })).toThrow("event.problems[0].message");
    expect(() => decode({ code: "E1\u0007" })).toThrow("event.problems[0].code");
    expect(() => decode({ code: "E1\u0085" })).toThrow("event.problems[0].code");
    expect(() => decode({ filePath: "/workspace/bad\u0007.ts" })).toThrow(
      "event.problems[0].filePath",
    );
    expect(() => decode({ filePath: "/workspace/bad\u0085.ts" })).toThrow(
      "event.problems[0].filePath",
    );
  });

  it.each([
    { owner: {}, sequence: 1, stream: "stdout", data: "x", truncated: false },
    { owner: { runId: "run-1" }, sequence: 0, stream: "stdout", data: "x" },
    { kind: "clear", owner: {}, sequence: 1 },
    { kind: "reset", owner: {}, sequence: 1, extra: true },
  ])("rejects malformed output/problem events", (event) => {
    expect(() => decodeNodePackageTaskOutputEvent(event)).toThrow(TypeError);
    expect(() => decodeNodePackageTaskProblemsEvent(event)).toThrow(TypeError);
  });

  it("requires the output truncation flag and an empty marker payload", () => {
    const owner = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "package.json",
      scriptName: "lint",
    };
    expect(() =>
      decodeNodePackageTaskOutputEvent({
        owner,
        sequence: 1,
        stream: "stdout",
        data: "x",
      }),
    ).toThrow(TypeError);
    expect(() =>
      decodeNodePackageTaskOutputEvent({
        owner,
        sequence: 1,
        stream: "stdout",
        data: "x",
        truncated: true,
      }),
    ).toThrow("empty truncation marker");
  });

  it("accepts only optional null or known start problem matchers", async () => {
    const base = {
      runId: "run-1",
      workspaceId: "ws-1",
      sessionId: 7,
      manifestRelativePath: "package.json",
      scriptName: "lint",
    };
    const invoke = vi.fn(async () => ({ runId: "run-1" }));
    await invokeStartNodePackageTaskIpc(invoke, { ...base, problemMatcher: null });
    await invokeStartNodePackageTaskIpc(invoke, { ...base, problemMatcher: "eslint" });
    await expect(
      invokeStartNodePackageTaskIpc(invoke, {
        ...base,
        problemMatcher: "custom",
      } as never),
    ).rejects.toThrow("problemMatcher");
  });
});

function result() {
  return {
    scripts: [
      {
        manifestRelativePath: "package.json",
        packageRootRelativePath: "",
        packageName: "demo",
        packageManager: "npm",
        scriptName: "build",
      },
    ],
    total: 1,
    truncated: false,
    visited: 7,
  };
}
