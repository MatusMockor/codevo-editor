import { describe, expect, it } from "vitest";
import {
  type DebugEvent,
  type DebugGateway,
  type DebugRuntimeStatus,
  type DebuggerState,
  type StackFrame,
  debuggerSessionId,
} from "./debug";

function frame(overrides: Partial<StackFrame> = {}): StackFrame {
  return {
    frameId: 1,
    name: "main",
    filePath: "/app/index.ts",
    lineNumber: 10,
    column: 3,
    ...overrides,
  };
}

describe("DebuggerState", () => {
  it("models every lifecycle phase as a discriminated union", () => {
    const states: DebuggerState[] = [
      { kind: "inactive" },
      { kind: "starting", sessionId: 1 },
      { kind: "running", sessionId: 1 },
      {
        kind: "stopped",
        sessionId: 1,
        reason: "breakpoint",
        frames: [frame()],
        topFrame: frame(),
      },
      { kind: "terminated", sessionId: 1, exitCode: 0 },
    ];

    expect(states.map((state) => state.kind)).toEqual([
      "inactive",
      "starting",
      "running",
      "stopped",
      "terminated",
    ]);
  });

  it("allows native frames without a file path", () => {
    const native = frame({ filePath: null });

    expect(native.filePath).toBeNull();
  });

  it("allows a terminated session without an exit code", () => {
    const state: DebuggerState = {
      kind: "terminated",
      sessionId: 1,
      exitCode: null,
    };

    expect(state.exitCode).toBeNull();
  });
});

describe("debuggerSessionId", () => {
  it("returns null for the inactive state", () => {
    expect(debuggerSessionId({ kind: "inactive" })).toBeNull();
  });

  it("returns the session id for every session-bound state", () => {
    const states: DebuggerState[] = [
      { kind: "starting", sessionId: 1 },
      { kind: "running", sessionId: 1 },
      {
        kind: "stopped",
        sessionId: 1,
        reason: "step",
        frames: [],
        topFrame: null,
      },
      { kind: "terminated", sessionId: 1, exitCode: null },
    ];

    for (const state of states) {
      expect(debuggerSessionId(state)).toBe(1);
    }
  });
});

describe("DebugGateway", () => {
  it("is satisfiable by a plain in-memory implementation", async () => {
    const handlers: Array<(event: DebugEvent) => void> = [];
    const received: DebugEvent[] = [];

    const gateway: DebugGateway = {
      start: async (): Promise<DebugRuntimeStatus> => ({
        kind: "ok",
        sessionId: 1,
      }),
      stop: async () => {},
      setBreakpoints: async (_sessionId, _filePath, breakpoints) => [
        ...breakpoints,
      ],
      step: async () => {},
      pause: async () => {},
      stackTrace: async () => [frame()],
      scopes: async () => [
        { name: "Local", variablesReference: 7, expensive: false },
      ],
      variables: async () => [
        { name: "answer", value: "42", type: "number", variablesReference: 0 },
      ],
      evaluate: async () => null,
      subscribe: (handler) => {
        handlers.push(handler);

        return () => {
          handlers.splice(handlers.indexOf(handler), 1);
        };
      },
    };

    const status = await gateway.start(
      "/root",
      { kind: "node-script", scriptPath: "/root/main.js" },
      [],
    );

    expect(status).toEqual({ kind: "ok", sessionId: 1 });

    const unsubscribe = gateway.subscribe((event) => received.push(event));
    const event: DebugEvent = {
      rootPath: "/root",
      sessionId: 1,
      seq: 1,
      payload: { kind: "output", stream: "stdout", text: "hello" },
    };
    handlers.forEach((handler) => handler(event));
    unsubscribe();

    expect(received).toEqual([event]);
    expect(handlers).toHaveLength(0);
  });

  it("accepts every launch target kind", async () => {
    const seen: string[] = [];

    const gateway: Pick<DebugGateway, "start"> = {
      start: async (_rootPath, launch) => {
        seen.push(launch.kind);

        return { kind: "unavailable", message: "no runtime" };
      },
    };

    await gateway.start(
      "/root",
      { kind: "node-script", scriptPath: "/a.js" },
      [],
    );
    await gateway.start(
      "/root",
      { kind: "js-test-file", runner: "vitest", filePath: "/a.test.ts" },
      [],
    );
    await gateway.start(
      "/root",
      { kind: "php-script", scriptPath: "/a.php" },
      [],
    );
    await gateway.start(
      "/root",
      { kind: "php-test-file", filePath: "/tests/A.test.php" },
      [],
    );
    await gateway.start("/root", { kind: "php-listen" }, []);
    await gateway.start("/root", { kind: "php-listen", port: 9003 }, []);

    expect(seen).toEqual([
      "node-script",
      "js-test-file",
      "php-script",
      "php-test-file",
      "php-listen",
      "php-listen",
    ]);
  });
});
