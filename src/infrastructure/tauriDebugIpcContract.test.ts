import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DebugCompoundStartRequest, DebugLaunchTarget, DebugVariable } from "../domain/debug";
import {
  DEBUG_IPC_COMMANDS,
  MAX_DEBUG_VARIABLE_NAME_BYTES,
  MAX_DEBUG_VARIABLE_VALUE_BYTES,
  MAX_DEBUG_COMPOUND_MEMBERS,
  MAX_DEBUG_OUTPUT_EVENT_BYTES,
  MAX_DEBUG_STACK_FRAMES,
  decodeDebugEvent,
  decodeDebugIpcResult,
  decodeDebugStartResponse,
  decodeDebugCompoundStartResponse,
  invokeDebugIpc,
  type DebugIpcCommandArgs,
  type DebugIpcCommandResult,
  type DebugCompoundStartRequestWire,
  type DebugLaunchTargetWire,
  type InvokeDebugCommand,
} from "./tauriDebugIpcContract";

describe("debug Tauri IPC contract", () => {
  it("strictly forwards a bounded stopAll compound without attach or task metadata", async () => {
    const request: DebugCompoundStartRequest = {
      rootPath: "/workspace",
      stopAll: true,
      members: [
        {
          launch: { kind: "node-script", scriptPath: "/workspace/a.js" },
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        },
        {
          launch: {
            kind: "node-npm-script",
            script: "dev",
            packageRootPath: "/workspace",
            args: [],
            env: {},
          },
          breakpoints: [],
          exceptionPauseMode: "uncaught",
          exceptionTypeFilter: [],
        },
      ],
    };
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ status: "ok", sessionIds: [11, 12] });

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_compound", { request }),
    ).resolves.toEqual({ status: "ok", sessionIds: [11, 12] });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start_compound", { request });

    for (const malformed of [
      { ...request, stopAll: false },
      { ...request, members: request.members.slice(0, 1) },
      {
        ...request,
        members: [
          ...request.members,
          ...request.members,
          {
            launch: { kind: "node-script", scriptPath: "/workspace/e.js" },
            breakpoints: [],
            exceptionPauseMode: "none",
            exceptionTypeFilter: [],
          },
        ],
      },
      {
        ...request,
        members: [
          {
            launch: { kind: "node-attach", port: 9229 },
            breakpoints: [],
            exceptionPauseMode: "none",
            exceptionTypeFilter: [],
          },
          request.members[1],
        ],
      },
      {
        ...request,
        members: [{ ...request.members[0], postDebugTask: "private" }, request.members[1]],
      },
    ]) {
      await expect(
        invokeDebugIpc(invokeCommand, "debug_start_compound", {
          request: malformed as never,
        }),
      ).rejects.toThrow(/^Invalid debug IPC value at debug_start_compound args/);
    }
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("strictly decodes generic bounded compound responses", () => {
    expect(decodeDebugCompoundStartResponse({ status: "ok", sessionIds: [1, 2] })).toEqual({
      status: "ok",
      sessionIds: [1, 2],
    });
    expect(() => decodeDebugCompoundStartResponse({ status: "ok", sessionIds: [1, 1] })).toThrow(
      "unique session ids",
    );
    expect(() =>
      decodeDebugCompoundStartResponse({
        status: "ok",
        sessionIds: Array.from({ length: MAX_DEBUG_COMPOUND_MEMBERS + 1 }, (_, index) => index + 1),
      }),
    ).toThrow(`at most ${MAX_DEBUG_COMPOUND_MEMBERS}`);
    expect(() =>
      decodeDebugCompoundStartResponse({
        status: "error",
        message: "unsafe\nreflection",
      }),
    ).toThrow("no control characters");
  });

  it("keeps command arguments and results statically associated", () => {
    expectTypeOf<DebugIpcCommandArgs<"debug_scopes">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly pauseGeneration: number;
        readonly frameId: number;
      };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_restart_frame">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly pauseGeneration: number;
        readonly frameId: number;
      };
    }>();
    expectTypeOf<DebugIpcCommandResult<"debug_stop">>().toEqualTypeOf<void>();
    expectTypeOf<DebugIpcCommandArgs<"debug_disconnect">>().toEqualTypeOf<{
      readonly request: { readonly rootPath: string; readonly sessionId: number };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_set_exception_pause">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly mode: "none" | "uncaught" | "all";
        readonly exceptionTypeFilter: readonly string[];
      };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_set_breakpoints_active">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly active: boolean;
      };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_set_function_breakpoints">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly generation: number;
        readonly breakpoints: readonly {
          readonly id: string;
          readonly functionName: string;
          readonly enabled: boolean;
        }[];
      };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_evaluate">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly frameId: number;
        readonly pauseGeneration: number;
        readonly expression: string;
        readonly context: "clipboard" | "repl" | "watch";
        readonly allowSideEffects: boolean;
      };
    }>();
    expectTypeOf<DebugIpcCommandArgs<"debug_run_to_location">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly pauseGeneration: number;
        readonly filePath: string;
        readonly lineNumber: number;
        readonly columnNumber: number;
      };
    }>();
  });

  it("enforces the exact breakpoint activation request before IPC", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(undefined);
    const request = {
      rootPath: "/workspace",
      sessionId: 7,
      active: false,
    };
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setBreakpointsActive, { request }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledWith("debug_set_breakpoints_active", { request });

    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setBreakpointsActive, {
        request: { ...request, unexpected: true },
      } as never),
    ).rejects.toThrow("expected no unknown field");
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setBreakpointsActive, {
        request: { ...request, active: "false" },
      } as never),
    ).rejects.toThrow("a boolean");
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("accepts only closed function breakpoint names before IPC", async () => {
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue([{ id: "fn-1", verified: true }]);
    const request = {
      rootPath: "/workspace",
      sessionId: 7,
      generation: 1,
      breakpoints: [{ id: "fn-1", functionName: "app.render", enabled: true }],
    } as const;
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setFunctionBreakpoints, { request }),
    ).resolves.toEqual([{ id: "fn-1", verified: true }]);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_function_breakpoints", {
      request,
    });

    for (const functionName of ["app.render()", "app;process.exit()", "app\nrender"]) {
      await expect(
        invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setFunctionBreakpoints, {
          request: {
            ...request,
            breakpoints: [{ id: "fn-1", functionName, enabled: true }],
          },
        }),
      ).rejects.toThrow("functionName");
    }
    expect(invokeCommand).toHaveBeenCalledTimes(1);

    invokeCommand.mockResolvedValueOnce([{ id: "foreign", verified: true }]);
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setFunctionBreakpoints, { request }),
    ).rejects.toThrow("one ordered verification");
  });

  it("forwards and strictly validates an exact disconnect owner", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(null);
    const args = { request: { rootPath: "/workspace exact", sessionId: 8 } } as const;
    await expect(invokeDebugIpc(invokeCommand, "debug_disconnect", args)).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_disconnect", args);
    expect(decodeDebugIpcResult("debug_disconnect", null)).toBeUndefined();
    expect(() => decodeDebugIpcResult("debug_disconnect", {})).toThrow("debug_disconnect result");

    for (const malformed of [
      { request: { rootPath: "/workspace", sessionId: 0 } },
      { request: { rootPath: "/work\nspace", sessionId: 8 } },
      { request: { rootPath: "/workspace", sessionId: 8, extra: true } },
      { rootPath: "/workspace", sessionId: 8 },
    ]) {
      await expect(
        invokeDebugIpc(invokeCommand, "debug_disconnect", malformed as never),
      ).rejects.toThrow(/^Invalid debug IPC value at debug_disconnect args/);
    }
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("forwards a closed restart-frame owner and strictly decodes its result", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(null);
    const args: DebugIpcCommandArgs<"debug_restart_frame"> = {
      request: {
        rootPath: "/workspace exact",
        sessionId: 8,
        pauseGeneration: 3,
        frameId: 11,
      },
    };

    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.restartFrame, args),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_restart_frame", args);
    expect(decodeDebugIpcResult("debug_restart_frame", null)).toBeUndefined();
    expect(decodeDebugIpcResult("debug_restart_frame", undefined)).toBeUndefined();
    expect(() => decodeDebugIpcResult("debug_restart_frame", {})).toThrow(
      "debug_restart_frame result",
    );
  });

  it.each([
    { request: null },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        frameId: 11,
        extra: true,
      },
    },
    {
      request: { rootPath: "/workspace", sessionId: 0, pauseGeneration: 3, frameId: 11 },
    },
    {
      request: { rootPath: "/workspace", sessionId: 8, pauseGeneration: 0, frameId: 11 },
    },
    {
      request: { rootPath: "/workspace", sessionId: 8, pauseGeneration: 3, frameId: 0 },
    },
  ])("rejects malformed restart-frame request %# before invocation", async (args) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_restart_frame", args as never),
    ).rejects.toThrow(/^Invalid debug IPC value at debug_restart_frame args/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("forwards the exact 1-based run-to-location request and strictly decodes its result", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(null);
    const args: DebugIpcCommandArgs<"debug_run_to_location"> = {
      request: {
        rootPath: "/workspace exact",
        sessionId: 8,
        pauseGeneration: 3,
        filePath: "/workspace exact/src/index.ts",
        lineNumber: 41,
        columnNumber: 7,
      },
    };

    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.runToLocation, args),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_run_to_location", args);
    expect(decodeDebugIpcResult("debug_run_to_location", null)).toBeUndefined();
    expect(decodeDebugIpcResult("debug_run_to_location", undefined)).toBeUndefined();
    expect(() => decodeDebugIpcResult("debug_run_to_location", {})).toThrow(
      "debug_run_to_location result",
    );
  });

  it.each([
    { request: null },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        filePath: "/workspace/src/index.ts",
        lineNumber: 41,
        columnNumber: 7,
        extra: true,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        filePath: "/workspace/src/index.ts",
        lineNumber: 41,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 0,
        pauseGeneration: 3,
        filePath: "/workspace/src/index.ts",
        lineNumber: 41,
        columnNumber: 7,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: Number.MAX_SAFE_INTEGER + 1,
        filePath: "/workspace/src/index.ts",
        lineNumber: 41,
        columnNumber: 7,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        filePath: "/workspace/src/index.ts",
        lineNumber: 0,
        columnNumber: 7,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        filePath: "/workspace/src/index.ts",
        lineNumber: 41,
        columnNumber: 4_294_967_296,
      },
    },
  ])("rejects malformed run-to-location requests %#", async (args) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    await expect(
      invokeDebugIpc(invokeCommand, "debug_run_to_location", args as never),
    ).rejects.toThrow(/^Invalid debug IPC value at debug_run_to_location args/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "/work\nspace", "/spoof\u202epath", "/split\u2028path", "\ud800"])(
    "rejects unsafe run-to-location path %# without reflecting it",
    async (unsafePath) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>();
      const invocation = invokeDebugIpc(invokeCommand, "debug_run_to_location", {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          pauseGeneration: 3,
          filePath: unsafePath,
          lineNumber: 41,
          columnNumber: 7,
        },
      });

      const error = await invocation.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(TypeError);
      if (unsafePath.length > 0) expect(String(error)).not.toContain(unsafePath);
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("accepts exact 4 KiB paths and rejects larger paths before invoking Tauri", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(null);
    const exactPath = `/${"a".repeat(4_095)}`;
    const request = {
      rootPath: exactPath,
      sessionId: 8,
      pauseGeneration: 3,
      filePath: exactPath,
      lineNumber: 1,
      columnNumber: 1,
    } as const;

    await expect(
      invokeDebugIpc(invokeCommand, "debug_run_to_location", { request }),
    ).resolves.toBeUndefined();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_run_to_location", {
        request: { ...request, filePath: `${exactPath}a` },
      }),
    ).rejects.toThrow("debug_run_to_location args.request.filePath");
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("encodes and strictly decodes exception pause commands", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(null);

    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace exact",
          sessionId: 8,
          mode: "uncaught",
          exceptionTypeFilter: ["TypeError", "app.DomainError"],
        },
      }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_exception_pause", {
      request: {
        rootPath: "/workspace exact",
        sessionId: 8,
        mode: "uncaught",
        exceptionTypeFilter: ["TypeError", "app.DomainError"],
      },
    });
    expect(decodeDebugIpcResult("debug_set_exception_pause", null)).toBeUndefined();
    expect(() => decodeDebugIpcResult("debug_set_exception_pause", undefined)).toThrow(
      "debug_set_exception_pause result",
    );
    expect(() => decodeDebugIpcResult("debug_set_exception_pause", {})).toThrow(
      "debug_set_exception_pause result",
    );
  });

  it("decodes a real Rust-equivalent nested evaluation fixture", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      value: { name: "count\t+ 1", value: "3", type: "number", variablesReference: 0 },
    });
    const args: DebugIpcCommandArgs<"debug_evaluate"> = {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        pauseGeneration: 3,
        expression: "count\t+ 1",
        context: "watch",
        allowSideEffects: false,
      },
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_evaluate", args)).resolves.toEqual({
      status: "ok",
      value: { name: "count\t+ 1", value: "3", type: "number", variablesReference: 0 },
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_evaluate", args);
  });

  it.each([
    "({root:\n{child:{value:42}}, list:[1,2,3]})",
    "(() => {\r\n\treturn { nested: true };\r\n})()",
  ])("forwards a bounded multiline evaluation expression exactly", async (expression) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      value: { name: expression, value: "Object", type: "object", variablesReference: 7 },
    });
    const args: DebugIpcCommandArgs<"debug_evaluate"> = {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        pauseGeneration: 3,
        expression,
        context: "repl",
        allowSideEffects: true,
      },
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_evaluate", args)).resolves.toMatchObject({
      status: "ok",
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_evaluate", args);
  });

  it.each(["before\rafter", "before\u000bafter", "before\u0085after", "before\0after"])(
    "rejects unsafe evaluation expression control characters %#",
    async (expression) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>();

      await expect(
        invokeDebugIpc(invokeCommand, "debug_evaluate", {
          request: {
            rootPath: "/workspace",
            sessionId: 8,
            frameId: 11,
            pauseGeneration: 3,
            expression,
            context: "repl",
            allowSideEffects: true,
          },
        }),
      ).rejects.toThrow("debug_evaluate args.request.expression");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("forwards the exact side-effectful clipboard evaluation policy", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      value: { name: "user", value: "User", type: "object", variablesReference: 9 },
    });
    const args: DebugIpcCommandArgs<"debug_evaluate"> = {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        pauseGeneration: 3,
        expression: "user",
        context: "clipboard",
        allowSideEffects: true,
      },
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_evaluate", args)).resolves.toMatchObject({
      status: "ok",
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_evaluate", args);
    await expect(
      invokeDebugIpc(invokeCommand, "debug_evaluate", {
        request: { ...args.request, allowSideEffects: false },
      }),
    ).rejects.toThrow("debug_evaluate args.request.allowSideEffects");
  });

  it.each([
    {
      rootPath: "/workspace",
      sessionId: 8,
      frameId: 11,
      expression: "count",
      context: "watch",
      allowSideEffects: false,
    },
    { request: { rootPath: "/workspace", sessionId: 8, frameId: 11, expression: "count" } },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        expression: "count",
        context: "watch",
        allowSideEffects: false,
        extra: true,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: Number.MAX_SAFE_INTEGER + 1,
        pauseGeneration: 3,
        frameId: 11,
        variablesReference: 21,
        start: 0,
        count: 100,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        expression: "count",
        context: "watch",
        allowSideEffects: true,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 11,
        expression: "count",
        context: "repl",
        allowSideEffects: false,
      },
    },
    {
      request: {
        rootPath: "/workspace\nother",
        sessionId: 8,
        frameId: 11,
        expression: "count",
        context: "watch",
        allowSideEffects: false,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 0,
        frameId: 11,
        expression: "count",
        context: "watch",
        allowSideEffects: false,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        frameId: 0,
        expression: "count\u0085next",
        context: "watch",
        allowSideEffects: false,
      },
    },
  ])("rejects evaluation request wire drift %#", async (args) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(invokeDebugIpc(invokeCommand, "debug_evaluate", args as never)).rejects.toThrow(
      "debug_evaluate args",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("enforces evaluation request and response byte caps", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_evaluate", {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          frameId: 11,
          pauseGeneration: 3,
          expression: "x".repeat(4_097),
          context: "watch",
          allowSideEffects: false,
        },
      }),
    ).rejects.toThrow("debug_evaluate args.request.expression");
    expect(() =>
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: {
          name: "count",
          value: "x".repeat(65_537),
          type: null,
          variablesReference: 0,
        },
      }),
    ).toThrow("debug_evaluate result.value");
    expect(() =>
      decodeDebugIpcResult("debug_evaluate", {
        status: "error",
        kind: "exception",
        message: "x".repeat(4_097),
      }),
    ).toThrow("debug_evaluate result.message");
  });

  it("strictly decodes both evaluation result variants", () => {
    for (const name of ["({root:\n{child:{value:42}}})", "(() => {\r\n\treturn 42;\r\n})()"]) {
      expect(
        decodeDebugIpcResult("debug_evaluate", {
          status: "ok",
          value: { name, value: "Object", type: "object", variablesReference: 7 },
        }),
      ).toMatchObject({ status: "ok", value: { name } });
    }
    for (const name of [
      "before\rafter",
      "before\u000bafter",
      "before\u0085after",
      "before\0after",
    ]) {
      expect(() =>
        decodeDebugIpcResult("debug_evaluate", {
          status: "ok",
          value: { name, value: "Object", type: "object", variablesReference: 7 },
        }),
      ).toThrow("debug_evaluate result.value.name");
    }
    expect(
      decodeDebugIpcResult("debug_evaluate", {
        status: "error",
        kind: "side-effect",
        message: "Assignment is disabled for watches.",
      }),
    ).toEqual({
      status: "error",
      kind: "side-effect",
      message: "Assignment is disabled for watches.",
    });
    expect(() =>
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: { name: "count", value: "3", type: null, variablesReference: 0 },
        extra: true,
      }),
    ).toThrow("debug_evaluate result.extra");
    for (const value of [
      { name: "count", value: "3", type: null },
      { name: "count", value: "3", type: null, variablesReference: 0, extra: true },
      { name: "count", value: "3", type: "x".repeat(257), variablesReference: 0 },
    ]) {
      expect(() => decodeDebugIpcResult("debug_evaluate", { status: "ok", value })).toThrow(
        "debug_evaluate result.value",
      );
    }
    expect(() =>
      decodeDebugIpcResult("debug_evaluate", {
        status: "error",
        kind: "renamed",
        message: "drift",
      }),
    ).toThrow("debug_evaluate result.kind");
  });

  it("strictly preserves an optional bounded evaluate name on evaluation results", () => {
    const base = { name: "user", value: "User", type: "object", variablesReference: 9 };
    expect(decodeDebugIpcResult("debug_evaluate", { status: "ok", value: base })).toEqual({
      status: "ok",
      value: base,
    });
    const withEvaluateName = { ...base, evaluateName: 'root["user"]' };
    expect(
      decodeDebugIpcResult("debug_evaluate", { status: "ok", value: withEvaluateName }),
    ).toEqual({ status: "ok", value: withEvaluateName });
    const multilineEvaluateName = { ...base, evaluateName: "(\n  root\n).user" };
    expect(
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: multilineEvaluateName,
      }),
    ).toEqual({ status: "ok", value: multilineEvaluateName });
    expect(
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: { ...base, evaluateName: "x".repeat(4 * 1_024) },
      }),
    ).toMatchObject({ status: "ok" });

    for (const evaluateName of [
      "",
      "   ",
      "user\rname",
      "user\u000bname",
      "x".repeat(4 * 1_024 + 1),
    ]) {
      expect(() =>
        decodeDebugIpcResult("debug_evaluate", {
          status: "ok",
          value: { ...base, evaluateName },
        }),
      ).toThrow("debug_evaluate result.value.evaluateName");
    }
    expect(() =>
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: { ...base, evaluateName: "user", extra: true },
      }),
    ).toThrow("debug_evaluate result.value.extra");
  });

  it("encodes and decodes the exact Rust-equivalent paged variables wire", async () => {
    const page = {
      variables: [{ name: "value", value: "1", type: null, variablesReference: 0 }],
      start: 100,
      returned: 1,
      total: 102,
      nextStart: 101,
      truncated: false,
    };
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(page);
    const args: DebugIpcCommandArgs<"debug_variables"> = {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        frameId: 11,
        variablesReference: 21,
        start: 100,
        count: 100,
      },
    };
    await expect(invokeDebugIpc(invokeCommand, "debug_variables", args)).resolves.toEqual(page);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_variables", args);
  });

  it("strictly preserves optional evaluate names on variable pages", () => {
    const page = (variable: Record<string, unknown>) => ({
      variables: [variable],
      start: 0,
      returned: 1,
      truncated: false,
    });
    const base = { name: "item", value: "1", variablesReference: 0 };
    expect(decodeDebugIpcResult("debug_variables", page(base))).toEqual(page(base));
    const withEvaluateName = { ...base, evaluateName: "items[0]" };
    expect(decodeDebugIpcResult("debug_variables", page(withEvaluateName))).toEqual(
      page(withEvaluateName),
    );
    const multilineEvaluateName = { ...base, evaluateName: "(\n  items\n)[0]" };
    expect(decodeDebugIpcResult("debug_variables", page(multilineEvaluateName))).toEqual(
      page(multilineEvaluateName),
    );
    expect(
      decodeDebugIpcResult(
        "debug_variables",
        page({ ...base, evaluateName: "x".repeat(4 * 1_024) }),
      ),
    ).toMatchObject({ returned: 1 });

    for (const evaluateName of [
      "",
      "   ",
      "items\u0000name",
      "items\rname",
      "x".repeat(4 * 1_024 + 1),
    ]) {
      expect(() =>
        decodeDebugIpcResult("debug_variables", page({ ...base, evaluateName })),
      ).toThrow("debug_variables result.variables[0].evaluateName");
    }
    expect(() =>
      decodeDebugIpcResult(
        "debug_variables",
        page({ ...base, evaluateName: "items[0]", extra: true }),
      ),
    ).toThrow("debug_variables result.variables[0].extra");
  });

  it.each([
    {},
    { request: { rootPath: "/workspace", sessionId: 8 } },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        frameId: 11,
        variablesReference: 21,
        start: 0,
        count: 101,
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 0,
        frameId: 11,
        variablesReference: 21,
        start: 1_000_001,
        count: 100,
        extra: true,
      },
    },
  ])("rejects variables request drift %#", async (args) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(invokeDebugIpc(invokeCommand, "debug_variables", args as never)).rejects.toThrow(
      "debug_variables args",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { status: "ok", sessionId: 7, extra: true },
    { status: "error", message: "failed", extra: true },
    { status: "unavailable", message: "missing", extra: true },
    { status: "ok", sessionId: 0 },
    { variables: [], start: 0, returned: 0, truncated: false, extra: true },
    { variables: [], start: 0, returned: 1, truncated: false },
    { variables: [], start: 0, returned: 0, total: 1, truncated: false },
    {
      variables: [{ name: "value", value: "1", variablesReference: 0 }],
      start: 0,
      returned: 1,
      nextStart: 1,
      total: 1,
      truncated: false,
    },
    {
      variables: [{ name: "bad\nname", value: "1", variablesReference: 0 }],
      start: 0,
      returned: 1,
      truncated: false,
    },
  ])("rejects malformed variable page %#", (page) => {
    expect(() => decodeDebugIpcResult("debug_variables", page)).toThrow(
      /^Invalid debug IPC value at debug_variables result/,
    );
  });

  it("enforces variable page aggregate and request-relative bounds", async () => {
    expect(() =>
      decodeDebugIpcResult("debug_variables", {
        variables: Array.from({ length: 17 }, (_, index) => ({
          name: `value-${index}`,
          value: "x".repeat(65_000),
          variablesReference: 0,
        })),
        start: 0,
        returned: 17,
        truncated: true,
      }),
    ).toThrow("debug_variables result");

    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      variables: [],
      start: 1,
      returned: 0,
      truncated: false,
    });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_variables", {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          pauseGeneration: 3,
          frameId: 11,
          variablesReference: 21,
          start: 0,
          count: 1,
        },
      }),
    ).rejects.toThrow("debug_variables result.start");

    invokeCommand.mockResolvedValueOnce({
      variables: [
        { name: "one", value: "1", variablesReference: 0 },
        { name: "two", value: "2", variablesReference: 0 },
      ],
      start: 0,
      returned: 2,
      truncated: false,
    });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_variables", {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          pauseGeneration: 3,
          frameId: 11,
          variablesReference: 21,
          start: 0,
          count: 1,
        },
      }),
    ).rejects.toThrow("debug_variables result.returned");
  });

  it("accepts Rust aggregate truncation with an exact progressive cursor", () => {
    expect(
      decodeDebugIpcResult("debug_variables", {
        variables: [{ name: "first", value: "1", variablesReference: 0 }],
        start: 0,
        returned: 1,
        total: 3,
        nextStart: 1,
        truncated: true,
      }),
    ).toMatchObject({ returned: 1, nextStart: 1, truncated: true });
  });

  it("requires the canonical positive pause generation on stopped events", () => {
    const event = {
      rootPath: "/workspace",
      sessionId: 8,
      seq: 4,
      payload: { kind: "stopped", reason: "breakpoint", frames: [], pauseGeneration: 3 },
    };
    expect(decodeDebugEvent(event)).toEqual(event);
    for (const payload of [
      { kind: "stopped", reason: "breakpoint", frames: [] },
      { kind: "stopped", reason: "breakpoint", frames: [], pauseGeneration: 0 },
      { kind: "stopped", reason: "breakpoint", frames: [], pauseGeneration: 3, extra: true },
    ]) {
      expect(() => decodeDebugEvent({ ...event, payload })).toThrow(
        /^Invalid debug IPC value at debug event.payload/,
      );
    }
  });

  it("accepts only the bounded closed stopped-stack projection and truncation receipt", () => {
    const frame = (frameId: number) => ({
      frameId,
      name: "main",
      filePath: "/workspace/app.js",
      lineNumber: 1,
      column: 1,
    });
    const event = {
      rootPath: "/workspace",
      sessionId: 8,
      seq: 4,
      payload: {
        kind: "stopped",
        reason: "breakpoint",
        frames: Array.from({ length: MAX_DEBUG_STACK_FRAMES }, (_, index) => frame(index + 1)),
        pauseGeneration: 3,
        framesTruncated: true,
      },
    };
    expect(decodeDebugEvent(event)).toEqual(event);
    expect(() =>
      decodeDebugEvent({
        ...event,
        payload: { ...event.payload, frames: [...event.payload.frames, frame(257)] },
      }),
    ).toThrow(`at most ${MAX_DEBUG_STACK_FRAMES} entries`);
    for (const payload of [
      { ...event.payload, framesTruncated: false },
      { ...event.payload, framesTruncated: "true" },
      { ...event.payload, frames: [{ ...frame(1), name: "bad\nframe" }] },
      { ...event.payload, frames: [{ ...frame(1), extra: true }] },
      { ...event.payload, frames: [{ ...frame(1), frameId: 0 }] },
      { ...event.payload, frames: [{ ...frame(1), lineNumber: 0 }] },
      { ...event.payload, frames: [{ ...frame(1), column: 0 }] },
      { ...event.payload, frames: [frame(1), frame(1)] },
    ]) {
      expect(() => decodeDebugEvent({ ...event, payload })).toThrow(
        /^Invalid debug IPC value at debug event.payload/,
      );
    }
  });

  it("accepts only bounded well-formed UTF-8 debug output events", () => {
    const event = (text: string, truncated = false) => ({
      rootPath: "/workspace",
      sessionId: 8,
      seq: 4,
      payload: { kind: "output", stream: "stdout", text, truncated },
    });
    const exactMultibyte = "ž".repeat(MAX_DEBUG_OUTPUT_EVENT_BYTES / 2);
    expect(decodeDebugEvent(event(exactMultibyte))).toEqual(event(exactMultibyte));
    expect(decodeDebugEvent(event("line one\n\tline two"))).toEqual(event("line one\n\tline two"));

    for (const malformed of [
      `${exactMultibyte}ž`,
      "x".repeat(MAX_DEBUG_OUTPUT_EVENT_BYTES * 16),
      "before\0after",
      "\ud800",
    ]) {
      expect(() => decodeDebugEvent(event(malformed))).toThrow(
        "Invalid debug IPC value at debug event.payload.text",
      );
    }
    for (const malformed of [
      { kind: "output", stream: "stdout", text: "missing flag" },
      { kind: "output", stream: "stdout", text: "wrong flag", truncated: "false" },
    ]) {
      expect(() => decodeDebugEvent({ ...event("valid"), payload: malformed })).toThrow(
        "Invalid debug IPC value at debug event.payload",
      );
    }
    expect(decodeDebugEvent(event("bounded partial", true))).toEqual(
      event("bounded partial", true),
    );
  });

  it("accepts the exact restart stop reason and rejects unknown reason drift", () => {
    const event = {
      rootPath: "/workspace",
      sessionId: 8,
      seq: 4,
      payload: { kind: "stopped", reason: "restart", frames: [], pauseGeneration: 3 },
    };
    expect(decodeDebugEvent(event)).toEqual(event);
    expect(() =>
      decodeDebugEvent({
        ...event,
        payload: { ...event.payload, reason: "restarted" },
      }),
    ).toThrow("debug event.payload.reason");
  });

  it("encodes exact pause-owned scopes and rejects request/response drift", async () => {
    const scope = { name: "Local", variablesReference: 21, expensive: false };
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue([scope]);
    const args: DebugIpcCommandArgs<"debug_scopes"> = {
      request: {
        rootPath: "/workspace",
        sessionId: 8,
        pauseGeneration: 3,
        frameId: 11,
      },
    };
    await expect(invokeDebugIpc(invokeCommand, "debug_scopes", args)).resolves.toEqual([scope]);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_scopes", args);
    for (const bad of [
      { request: { ...args.request, pauseGeneration: 0 } },
      { request: { ...args.request, extra: true } },
      { sessionId: 8, frameId: 11 },
    ]) {
      await expect(invokeDebugIpc(vi.fn(), "debug_scopes", bad as never)).rejects.toThrow(
        "debug_scopes args",
      );
    }
    for (const badScope of [
      { name: "", variablesReference: 21, expensive: false },
      { name: "bad\nname", variablesReference: 21, expensive: false },
      { name: "x".repeat(1_025), variablesReference: 21, expensive: false },
      { name: "Local", variablesReference: 0, expensive: false },
      { ...scope, extra: true },
    ]) {
      expect(() => decodeDebugIpcResult("debug_scopes", [badScope])).toThrow(
        /^Invalid debug IPC value at debug_scopes result/,
      );
    }
  });

  it.each(["caught", "", null, 1])("rejects exception pause mode %# before IPC", async (mode) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          mode: mode as "all",
          exceptionTypeFilter: [],
        },
      }),
    ).rejects.toThrow("debug_set_exception_pause args.request.mode");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects missing and unknown exception pause fields before IPC", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          exceptionTypeFilter: [],
        },
      } as never),
    ).rejects.toThrow("debug_set_exception_pause args.request.mode");
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          mode: "all",
        },
      } as never),
    ).rejects.toThrow("debug_set_exception_pause args.request.exceptionTypeFilter");
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          mode: "all",
          exceptionTypeFilter: [],
          extra: true,
        },
      } as never),
    ).rejects.toThrow("debug_set_exception_pause args.request.extra");
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/work\nspace",
          sessionId: 8,
          mode: "all",
          exceptionTypeFilter: [],
        },
      }),
    ).rejects.toThrow("debug_set_exception_pause args.request.rootPath");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "TypeError",
    ["not valid"],
    ["TypeError", "TypeError"],
    Array.from({ length: 9 }, (_, index) => `Error${index}`),
    ["a.b.c.d.e.f.g.h.i"],
    ["é".repeat(129)],
  ])("rejects malformed exception type filter %# before IPC", async (exceptionTypeFilter) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
        request: {
          rootPath: "/workspace",
          sessionId: 8,
          mode: "all",
          exceptionTypeFilter,
        },
      } as never),
    ).rejects.toThrow("debug_set_exception_pause args.request.exceptionTypeFilter");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("preserves the exact command and argument wire payload", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(undefined);

    await invokeDebugIpc(invokeCommand, "debug_step", {
      sessionId: 8,
      kind: "stepInto",
    });

    expect(invokeCommand).toHaveBeenCalledWith("debug_step", {
      sessionId: 8,
      kind: "stepInto",
    });
  });

  it("validates configured Node launch args, cwd, and string environment", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const launch = {
      kind: "node-configured-script" as const,
      scriptPath: "/workspace/app.ts",
      args: ["--port", "3000"],
      cwd: "/workspace",
      env: { PORT: "3000" },
      sourceMaps: false,
    };
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: { ...launch, sourceMaps: "false" } as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch.sourceMaps");

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: { ...launch, env: { PORT: 3000 } } as unknown as typeof launch,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("launch.env.PORT");
  });

  const stopOnEntryLaunchTargets: DebugLaunchTargetWire[] = [
    {
      kind: "node-script",
      scriptPath: "/workspace/app.js",
      stopOnEntry: true,
    },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: [],
      env: {},
      stopOnEntry: false,
    },
    {
      kind: "node-npm-script",
      script: "dev",
      packageRootPath: "/workspace",
      args: [],
      env: {},
      stopOnEntry: true,
    },
  ];

  it.each(stopOnEntryLaunchTargets)("accepts and forwards stopOnEntry on $kind", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const args = {
      rootPath: "/workspace",
      launch,
      breakpoints: [],
      exceptionPauseMode: "none" as const,
      exceptionTypeFilter: [],
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_start", args)).resolves.toEqual({
      status: "ok",
      sessionId: 9,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start", args);
  });

  it.each([
    {
      kind: "node-script",
      scriptPath: "/workspace/app.js",
    },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: [],
      env: {},
    },
    {
      kind: "node-npm-script",
      script: "dev",
      packageRootPath: "/workspace",
      args: [],
      env: {},
    },
  ])("rejects null and non-boolean stopOnEntry on $kind", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    for (const stopOnEntry of [null, "true", 1]) {
      await expect(
        invokeDebugIpc(invokeCommand, "debug_start", {
          rootPath: "/workspace",
          launch: { ...launch, stopOnEntry } as never,
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        }),
      ).rejects.toThrow("debug_start args.launch.stopOnEntry");
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts only false stopOnEntry on Node attach", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const args = {
      rootPath: "/workspace",
      launch: { kind: "node-attach", port: 9229, stopOnEntry: false } as const,
      breakpoints: [],
      exceptionPauseMode: "none" as const,
      exceptionTypeFilter: [],
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_start", args)).resolves.toEqual({
      status: "ok",
      sessionId: 9,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start", args);

    for (const stopOnEntry of [true, null, "false"]) {
      await expect(
        invokeDebugIpc(invokeCommand, "debug_start", {
          ...args,
          launch: { ...args.launch, stopOnEntry } as never,
        }),
      ).rejects.toThrow("debug_start args.launch.stopOnEntry");
    }
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("preserves stopOnEntry in strict compound member launch payloads", async () => {
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ status: "ok", sessionIds: [11, 12] });
    const request: DebugCompoundStartRequestWire = {
      rootPath: "/workspace",
      stopAll: true,
      members: [
        {
          launch: {
            kind: "node-script",
            scriptPath: "/workspace/a.js",
            stopOnEntry: true,
          },
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        },
        {
          launch: {
            kind: "node-npm-script",
            script: "dev",
            packageRootPath: "/workspace",
            args: [],
            env: {},
            stopOnEntry: false,
          },
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        },
      ],
    };

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_compound", { request }),
    ).resolves.toEqual({ status: "ok", sessionIds: [11, 12] });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start_compound", { request });
  });

  it("validates native Node watch sourceMaps as a boolean", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const args = {
      rootPath: "/workspace",
      scriptPath: "/workspace/app.js",
      watch: true as const,
      breakpoints: [],
      functionBreakpoints: [],
      exceptionPauseMode: "none" as const,
      exceptionTypeFilter: [],
      sourceMaps: false,
    };

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", { request: args }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", {
        request: { ...args, sourceMaps: "false" },
      } as never),
    ).rejects.toThrow("debug_start_native_node_watch args.request.sourceMaps");
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", {
        request: { ...args, sourceMaps: null },
      } as never),
    ).rejects.toThrow("debug_start_native_node_watch args.request.sourceMaps");
  });

  it("rejects stopOnEntry from the native Node watch wire shape", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", {
        request: {
          rootPath: "/workspace",
          scriptPath: "/workspace/app.js",
          watch: true,
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
          stopOnEntry: true,
        },
      } as never),
    ).rejects.toThrow("debug_start_native_node_watch args.request.stopOnEntry");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each(["tsx", "ts-node"] as const)(
    "accepts the exact configured Node %s runtime",
    async (runtime) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
        status: "ok",
        sessionId: 9,
      });
      const launch = {
        kind: "node-configured-script",
        scriptPath: "/workspace/app.ts",
        args: [],
        env: {},
        runtime,
      } as unknown as DebugLaunchTarget;

      await expect(
        invokeDebugIpc(invokeCommand, "debug_start", {
          rootPath: "/workspace",
          launch,
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        }),
      ).resolves.toEqual({ status: "ok", sessionId: 9 });
      expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
        rootPath: "/workspace",
        launch,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      });
    },
  );

  it("rejects an unknown configured Node runtime", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: {
          kind: "node-configured-script",
          scriptPath: "/workspace/app.ts",
          args: [],
          env: {},
          runtime: "nodemon",
        } as unknown as DebugLaunchTarget,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch.runtime");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts envFile only on a configured Node script launch", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const launch = {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: [],
      env: {},
      envFile: "config/dev.env",
    } as unknown as DebugLaunchTarget;

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });
    expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
      rootPath: "/workspace",
      launch,
      breakpoints: [],
      exceptionPauseMode: "none",
      exceptionTypeFilter: [],
    });

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: {
          kind: "node-npm-script",
          script: "dev",
          packageRootPath: "/workspace",
          args: [],
          env: {},
          envFile: ".env",
        } as unknown as DebugLaunchTarget,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch.envFile");
  });

  it("requires an exact startup exception pause field", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const base = {
      rootPath: "/workspace",
      launch: { kind: "node-script" as const, scriptPath: "/workspace/app.ts" },
      breakpoints: [],
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_start", base as never)).rejects.toThrow(
      "debug_start args.exceptionPauseMode",
    );
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        ...base,
        exceptionPauseMode: "caught",
        exceptionTypeFilter: [],
      } as never),
    ).rejects.toThrow("debug_start args.exceptionPauseMode");
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        ...base,
        exceptionPauseMode: "all",
      } as never),
    ).rejects.toThrow("debug_start args.exceptionTypeFilter");
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        ...base,
        exceptionPauseMode: "all",
        exceptionTypeFilter: [],
        extra: true,
      } as never),
    ).rejects.toThrow("debug_start args.extra");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("encodes a strict single-target Node attach launch", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const args = {
      rootPath: "/workspace",
      launch: { kind: "node-attach" as const, port: 9229 },
      breakpoints: [],
      exceptionPauseMode: "uncaught" as const,
      exceptionTypeFilter: [],
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_start", args)).resolves.toEqual({
      status: "ok",
      sessionId: 9,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start", args);
  });

  it.each([0, 65_536, 9229.5, "9229", null])(
    "rejects invalid Node attach port %# before IPC",
    async (port) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>();
      await expect(
        invokeDebugIpc(invokeCommand, "debug_start", {
          rootPath: "/workspace",
          launch: { kind: "node-attach", port } as never,
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        }),
      ).rejects.toThrow("debug_start args.launch.port");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it.each([
    { kind: "node-attach" },
    { kind: "node-attach", port: 9229, cwd: "/workspace" },
    { kind: "node-attach", port: 9229, args: [] },
    { kind: "node-attach", port: 9229, env: {} },
    { kind: "node-attach", port: 9229, scriptPath: "/workspace/app.js" },
  ])("rejects missing or unknown Node attach fields before IPC", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: launch as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  const validLaunchTargets: DebugLaunchTarget[] = [
    { kind: "node-attach", port: 9229 },
    { kind: "node-script", scriptPath: "/workspace/app.js" },
    {
      kind: "js-test-file",
      runner: "vitest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
    },
    {
      kind: "js-test-selection",
      runner: "jest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
      selection: { kind: "test", fullName: "math adds", nameMatch: "exact" },
    },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: ["--inspect"],
      cwd: "/workspace",
      env: { NODE_ENV: "test" },
      justMyCode: "nodeInternals",
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
      script: "test",
      packageRootPath: "/workspace",
      args: ["--watch=false"],
      env: {},
      justMyCode: "nodeInternals",
    },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/dependencies.ts",
      args: [],
      env: {},
      justMyCode: "dependencies",
    },
    {
      kind: "node-npm-script",
      script: "dev",
      packageRootPath: "/workspace",
      args: [],
      env: {},
      justMyCode: "nodeInternalsAndDependencies",
    },
    { kind: "php-script", scriptPath: "/workspace/app.php" },
    { kind: "php-test-file", filePath: "/workspace/AppTest.php" },
    { kind: "php-listen" },
  ];

  it.each(validLaunchTargets)("accepts the exact $kind launch shape", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });
  });

  it.each(validLaunchTargets)("rejects an unknown field on $kind", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: { ...launch, extra: true } as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch.extra");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: [],
      env: {},
      justMyCode: "nodeModules",
    },
    {
      kind: "node-npm-script",
      script: "dev",
      packageRootPath: "/workspace",
      args: [],
      env: {},
      justMyCode: "<node_internals>/**",
    },
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: [],
      env: {},
      justMyCode: "**/node_modules/**",
    },
    { kind: "node-attach", port: 9229, justMyCode: "nodeInternals" },
    {
      kind: "js-configured-test",
      runner: "vitest",
      filePath: "/workspace/app.test.ts",
      packageRootPath: "/workspace",
      args: [],
      env: {},
      justMyCode: "nodeInternals",
    },
  ])("rejects malformed or unsupported Just My Code IPC policy %#", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: launch as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "node-attach" },
    { kind: "node-script" },
    { kind: "js-test-file", runner: "vitest", filePath: "/workspace/test.ts" },
    {
      kind: "js-test-selection",
      runner: "vitest",
      filePath: "/workspace/test.ts",
      packageRootPath: "/workspace",
    },
    { kind: "node-configured-script", scriptPath: "/workspace/app.ts", env: {} },
    {
      kind: "js-configured-test",
      runner: "jest",
      filePath: "/workspace/test.ts",
      packageRootPath: "/workspace",
      args: [],
    },
    { kind: "node-npm-script", script: "test", packageRootPath: "/workspace", env: {} },
    { kind: "php-script" },
    { kind: "php-test-file" },
  ])("rejects a missing required field on $kind", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: launch as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "node-configured-script",
      scriptPath: "/workspace/app.ts",
      args: "--inspect",
      env: {},
    },
    {
      kind: "js-configured-test",
      runner: "mocha",
      filePath: "/workspace/test.ts",
      packageRootPath: "/workspace",
      args: [],
      env: {},
    },
    {
      kind: "js-test-selection",
      runner: "mocha",
      filePath: "/workspace/test.ts",
      packageRootPath: "/workspace",
      selection: { kind: "file" },
    },
    {
      kind: "node-npm-script",
      script: "test",
      packageRootPath: "/workspace",
      args: [],
      env: [],
    },
    { kind: "php-listen", port: -1 },
  ])("rejects invalid configured option types on $kind", async (launch) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: launch as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "file", extra: true },
    { kind: "suite" },
    { kind: "suite", fullName: "math", extra: true },
    { kind: "test", fullName: "math", nameMatch: "contains" },
    { kind: "test", fullName: "math\nadds", nameMatch: "exact" },
    { kind: "test", fullName: "é".repeat(2_049), nameMatch: "prefix" },
  ])("rejects an invalid selected-test shape %#", async (selection) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: {
          kind: "js-test-selection",
          runner: "vitest",
          filePath: "/workspace/test.ts",
          packageRootPath: "/workspace",
          selection,
        } as never,
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("debug_start args.launch.selection");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "file" } as const,
    { kind: "suite", fullName: "math" } as const,
    { kind: "test", fullName: "math adds", nameMatch: "exact" } as const,
    { kind: "test", fullName: "math cases", nameMatch: "prefix" } as const,
  ])("accepts the exact selected-test shape %#", async (selection) => {
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ status: "ok", sessionId: 9 });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: {
          kind: "js-test-selection",
          runner: "jest",
          filePath: "/workspace/test.ts",
          packageRootPath: "/workspace",
          selection,
        },
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });
  });

  it.each(["filePath", "packageRootPath"])(
    "bounds and rejects controls in selected-test %s",
    async (field) => {
      for (const invalid of ["/workspace/bad\npath", `/${"é".repeat(2_049)}`]) {
        const invokeCommand = vi.fn<InvokeDebugCommand>();
        await expect(
          invokeDebugIpc(invokeCommand, "debug_start", {
            rootPath: "/workspace",
            launch: {
              kind: "js-test-selection",
              runner: "jest",
              filePath: "/workspace/test.ts",
              packageRootPath: "/workspace",
              selection: { kind: "file" },
              [field]: invalid,
            },
            breakpoints: [],
            exceptionPauseMode: "none",
            exceptionTypeFilter: [],
          }),
        ).rejects.toThrow(`debug_start args.launch.${field}`);
        expect(invokeCommand).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["filePath", "packageRootPath"])(
    "rejects unpaired surrogates in selected-test %s",
    async (field) => {
      for (const invalid of ["/workspace/\ud800", "/workspace/\udc00"]) {
        const invokeCommand = vi.fn<InvokeDebugCommand>();
        await expect(
          invokeDebugIpc(invokeCommand, "debug_start", {
            rootPath: "/workspace",
            launch: {
              kind: "js-test-selection",
              runner: "jest",
              filePath: "/workspace/test.ts",
              packageRootPath: "/workspace",
              selection: { kind: "file" },
              [field]: invalid,
            },
            breakpoints: [],
            exceptionPauseMode: "none",
            exceptionTypeFilter: [],
          }),
        ).rejects.toThrow(`debug_start args.launch.${field}`);
        expect(invokeCommand).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["\ud800", "\udc00"])(
    "rejects an unpaired surrogate in selected-test fullName %j",
    async (surrogate) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>();
      await expect(
        invokeDebugIpc(invokeCommand, "debug_start", {
          rootPath: "/workspace",
          launch: {
            kind: "js-test-selection",
            runner: "vitest",
            filePath: "/workspace/test.ts",
            packageRootPath: "/workspace",
            selection: { kind: "suite", fullName: `math ${surrogate}` },
          },
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        }),
      ).rejects.toThrow("debug_start args.launch.selection.fullName");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("accepts valid surrogate pairs in selected-test text", async () => {
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ status: "ok", sessionId: 10 });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: {
          kind: "js-test-selection",
          runner: "vitest",
          filePath: "/workspace/\ud83e\uddea.test.ts",
          packageRootPath: "/workspace/\ud83e\uddea",
          selection: { kind: "suite", fullName: "math \ud83e\uddea" },
        },
        breakpoints: [],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 10 });
  });

  it("accepts an outbound breakpoint without verified for Rust's serde default", async () => {
    const breakpoint = {
      id: "bp-1",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      condition: null,
      hitCondition: { kind: "greaterOrEqual", count: 4 } as const,
      logMessage: "value={value}",
      enabled: true,
    };
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue([{ ...breakpoint, verified: false }]);

    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setBreakpoints, {
        request: {
          rootPath: "/workspace",
          sessionId: 1,
          filePath: breakpoint.filePath,
          breakpoints: [breakpoint],
        },
      }),
    ).resolves.toEqual([{ ...breakpoint, verified: false }]);
  });

  it.each([
    { kind: "equals", count: 0 },
    { kind: "equals", count: Number.MAX_SAFE_INTEGER + 1 },
    { kind: "unknown", count: 2 },
    { kind: "multiple", count: 2, extra: true },
    { kind: "multiple" },
    "3",
  ])("rejects malformed nested hit conditions before IPC: %#", async (hitCondition) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, DEBUG_IPC_COMMANDS.setBreakpoints, {
        request: {
          rootPath: "/workspace",
          sessionId: 1,
          filePath: "/workspace/app.ts",
          breakpoints: [
            {
              id: "bp-1",
              filePath: "/workspace/app.ts",
              lineNumber: 4,
              enabled: true,
              hitCondition,
            } as never,
          ],
        },
      }),
    ).rejects.toThrow("hitCondition");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts composed logpoint fields and rejects malformed nested log messages before IPC", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 9,
    });
    const breakpoint = {
      id: "bp-log",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      condition: "ready",
      hitCondition: { kind: "multiple", count: 3 } as const,
      logMessage: "count={count}",
      enabled: true,
    };
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: { kind: "node-script", scriptPath: "/workspace/app.ts" },
        breakpoints: [breakpoint],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).resolves.toEqual({ status: "ok", sessionId: 9 });

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start", {
        rootPath: "/workspace",
        launch: { kind: "node-script", scriptPath: "/workspace/app.ts" },
        breakpoints: [{ ...breakpoint, logMessage: "count={" }],
        exceptionPauseMode: "none",
        exceptionTypeFilter: [],
      }),
    ).rejects.toThrow("logMessage");
  });

  it.each([
    {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: "/workspace/app.ts",
        breakpoints: [{ id: "zero", filePath: "/workspace/app.ts", lineNumber: 0, enabled: true }],
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: "/workspace/app.ts",
        breakpoints: [
          { id: "mismatch", filePath: "/workspace/other.ts", lineNumber: 1, enabled: true },
        ],
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: "/workspace/app.ts",
        breakpoints: [
          { id: "duplicate", filePath: "/workspace/app.ts", lineNumber: 1, enabled: true },
          { id: "duplicate", filePath: "/workspace/app.ts", lineNumber: 2, enabled: true },
        ],
      },
    },
    {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: "/workspace/app.ts",
        breakpoints: [
          { id: "é".repeat(65), filePath: "/workspace/app.ts", lineNumber: 1, enabled: true },
        ],
      },
    },
  ])("rejects invalid live breakpoint requests before IPC", async (args) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(invokeDebugIpc(invokeCommand, "debug_set_breakpoints", args)).rejects.toThrow(
      "debug_set_breakpoints args.request.breakpoints",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("forwards optional 1-based breakpoint columns through the existing command", async () => {
    const breakpoint = {
      id: "inline",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      columnNumber: 17,
      enabled: true,
    };
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue([{ ...breakpoint, verified: true }]);
    const args = {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: breakpoint.filePath,
        breakpoints: [breakpoint],
      },
    };

    await expect(invokeDebugIpc(invokeCommand, "debug_set_breakpoints", args)).resolves.toEqual([
      { ...breakpoint, verified: true },
    ]);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_breakpoints", args);
  });

  it.each([0, 4_294_967_296, 1.5, null])(
    "rejects invalid breakpoint column %# before IPC",
    async (columnNumber) => {
      const invokeCommand = vi.fn<InvokeDebugCommand>();
      const breakpoint = {
        id: "inline",
        filePath: "/workspace/app.ts",
        lineNumber: 4,
        columnNumber,
        enabled: true,
      };

      await expect(
        invokeDebugIpc(invokeCommand, "debug_set_breakpoints", {
          request: {
            rootPath: "/workspace",
            sessionId: 1,
            filePath: breakpoint.filePath,
            breakpoints: [breakpoint],
          },
        } as never),
      ).rejects.toThrow("debug_set_breakpoints args.request.breakpoints[0].columnNumber");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("strictly decodes optional breakpoint columns and rejects result drift", () => {
    const breakpoint = {
      id: "inline",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      columnNumber: 4_294_967_295,
      enabled: true,
      verified: true,
    };

    expect(decodeDebugIpcResult("debug_set_breakpoints", [breakpoint])).toEqual([breakpoint]);
    expect(() =>
      decodeDebugIpcResult("debug_set_breakpoints", [{ ...breakpoint, columnNumber: 0 }]),
    ).toThrow("debug_set_breakpoints result[0].columnNumber");
    expect(() =>
      decodeDebugIpcResult("debug_set_breakpoints", [{ ...breakpoint, wireDrift: true }]),
    ).toThrow("debug_set_breakpoints result[0].wireDrift");
  });

  it("rejects unknown nested fields and mismatched backend results", async () => {
    const breakpoint = {
      id: "bp-1",
      filePath: "/workspace/app.ts",
      lineNumber: 1,
      enabled: true,
    };
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue([{ ...breakpoint, filePath: "/workspace/other.ts", verified: true }]);
    const args = {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: breakpoint.filePath,
        breakpoints: [breakpoint],
      },
    };
    await expect(invokeDebugIpc(invokeCommand, "debug_set_breakpoints", args)).rejects.toThrow(
      "debug_set_breakpoints result[0].filePath",
    );
    await expect(
      invokeDebugIpc(vi.fn(), "debug_set_breakpoints", {
        request: { ...args.request, extra: true },
      } as never),
    ).rejects.toThrow("debug_set_breakpoints args.request.extra");
  });

  it("keeps outside-workspace paths representable for authoritative backend rejection", async () => {
    const breakpoint = {
      id: "outside",
      filePath: "/other/app.ts",
      lineNumber: 1,
      enabled: true,
    };
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue([]);
    await invokeDebugIpc(invokeCommand, "debug_set_breakpoints", {
      request: {
        rootPath: "/workspace",
        sessionId: 1,
        filePath: breakpoint.filePath,
        breakpoints: [breakpoint],
      },
    });
    expect(invokeCommand).toHaveBeenCalledOnce();
  });

  it.each([
    [
      { status: "ok", sessionId: 7 },
      { status: "ok", sessionId: 7 },
    ],
    [
      { status: "unavailable", message: "missing runtime" },
      { status: "unavailable", message: "missing runtime" },
    ],
    [
      { status: "error", message: "spawn failed" },
      { status: "error", message: "spawn failed" },
    ],
  ])("decodes a valid start response", (wire, expected) => {
    expect(decodeDebugStartResponse(wire)).toEqual(expected);
  });

  it.each([
    null,
    { status: "ok", sessionId: -1 },
    { status: "ok", sessionId: Number.MAX_SAFE_INTEGER + 1 },
    { status: "error", message: 42 },
    { status: "renamed", message: "drift" },
  ])("rejects malformed start response %#", (wire) => {
    expect(() => decodeDebugStartResponse(wire)).toThrow(/^Invalid debug IPC value at/);
  });

  it("rejects extra fields on the event envelope and every payload variant", () => {
    const event = (payload: object) => ({
      rootPath: "/workspace",
      sessionId: 2,
      seq: 3,
      payload,
    });
    const breakpoint = {
      id: "bp-1",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      enabled: true,
    };
    const payloads = [
      { kind: "started", sessionId: 2, extra: true },
      { kind: "resumed", extra: true },
      { kind: "output", stream: "stdout", text: "ready", truncated: false, extra: true },
      { kind: "terminated", exitCode: null, extra: true },
      {
        kind: "breakpointsVerified",
        filePath: "/workspace/app.ts",
        breakpoints: [breakpoint],
        extra: true,
      },
    ];
    expect(() => decodeDebugEvent({ ...event({ kind: "resumed" }), extra: true })).toThrow(
      "Invalid debug IPC value at debug event",
    );
    for (const payload of payloads) {
      expect(() => decodeDebugEvent(event(payload))).toThrow(
        "Invalid debug IPC value at debug event.payload",
      );
    }
  });

  it("decodes every non-void debug result shape", () => {
    const breakpoint = {
      id: "bp-1",
      filePath: "/workspace/app.ts",
      lineNumber: 4,
      condition: null,
      enabled: true,
      verified: true,
    };
    expect(decodeDebugIpcResult("debug_set_breakpoints", [breakpoint])).toEqual([breakpoint]);
    expect(
      decodeDebugIpcResult("debug_stack_trace", [
        { frameId: 2, name: "main", filePath: null, lineNumber: 4, column: 1 },
      ]),
    ).toHaveLength(1);
    expect(
      decodeDebugIpcResult("debug_scopes", [
        { name: "Local", variablesReference: 3, expensive: false },
      ]),
    ).toHaveLength(1);
    expect(
      decodeDebugIpcResult("debug_variables", {
        variables: [{ name: "value", value: "1", type: null, variablesReference: 0 }],
        start: 0,
        returned: 1,
        truncated: false,
      }),
    ).toMatchObject({ returned: 1, start: 0 });
    expect(
      decodeDebugIpcResult("debug_evaluate", {
        status: "ok",
        value: { name: "count", value: "1", type: null, variablesReference: 0 },
      }),
    ).toEqual({
      status: "ok",
      value: { name: "count", value: "1", type: null, variablesReference: 0 },
    });
  });

  it("accepts Rust unit results and rejects payload drift", () => {
    expect(decodeDebugIpcResult("debug_stop", null)).toBeUndefined();
    expect(decodeDebugIpcResult("debug_pause", undefined)).toBeUndefined();
    expect(() => decodeDebugIpcResult("debug_step", {})).toThrow(
      "Invalid debug IPC value at debug_step result",
    );
  });

  it("decodes tagged debug events and nullable Option fields", () => {
    const wire = {
      rootPath: "/workspace",
      sessionId: 2,
      seq: 3,
      payload: {
        kind: "breakpointsVerified",
        filePath: "/workspace/app.ts",
        breakpoints: [
          {
            id: "bp-1",
            filePath: "/workspace/app.ts",
            lineNumber: 4,
            condition: null,
            enabled: true,
          },
        ],
      },
    };

    expect(decodeDebugEvent(wire)).toEqual({
      ...wire,
      payload: {
        ...wire.payload,
        breakpoints: [{ ...wire.payload.breakpoints[0], verified: false }],
      },
    });
  });

  it.each([
    { rootPath: "/workspace", sessionId: -1, seq: 1, payload: { kind: "resumed" } },
    {
      rootPath: "/workspace",
      sessionId: 1,
      seq: Number.MAX_SAFE_INTEGER + 1,
      payload: { kind: "resumed" },
    },
    {
      rootPath: "/workspace",
      sessionId: 1,
      seq: 1,
      payload: { kind: "terminated", exitCode: 2_147_483_648 },
    },
  ])("rejects Rust integer overflow in event %#", (wire) => {
    expect(() => decodeDebugEvent(wire)).toThrow(/^Invalid debug IPC value at/);
  });

  it("rejects Rust integer overflow before invoking a command", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_scopes", {
        request: {
          rootPath: "/workspace",
          sessionId: 1,
          pauseGeneration: 1,
          frameId: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).rejects.toThrow("debug_scopes args.request.frameId");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("keeps Set Variable request/result types closed and decodes writable provenance", async () => {
    expectTypeOf<DebugIpcCommandArgs<"debug_set_variable">>().toEqualTypeOf<{
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly pauseGeneration: number;
        readonly frameId: number;
        readonly variablesReference: number;
        readonly name: string;
        readonly value: string;
      };
    }>();
    expectTypeOf<DebugIpcCommandResult<"debug_set_variable">>().toEqualTypeOf<DebugVariable>();
    const request = {
      rootPath: "/workspace",
      sessionId: 1,
      pauseGeneration: 2,
      frameId: 3,
      variablesReference: 4,
      name: "count",
      value: "43",
    };
    const result = {
      name: "count",
      value: "43",
      type: "number",
      evaluateName: "state.count",
      canSetValue: true as const,
      variablesReference: 9,
    };
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(result);
    await expect(invokeDebugIpc(invokeCommand, "debug_set_variable", { request })).resolves.toEqual(
      result,
    );
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_variable", { request });
    const { canSetValue: _canSetValue, ...withoutCanSetValue } = result;
    expect(decodeDebugIpcResult("debug_set_variable", withoutCanSetValue)).toEqual(
      withoutCanSetValue,
    );

    const unicodeRequest = {
      ...request,
      rootPath: "/workspace/😀",
      name: "😀",
      value: "updated 😀",
    };
    const unicodeResult = { ...result, name: unicodeRequest.name, value: unicodeRequest.value };
    const unicodeInvoke = vi.fn<InvokeDebugCommand>().mockResolvedValue(unicodeResult);
    await expect(
      invokeDebugIpc(unicodeInvoke, "debug_set_variable", { request: unicodeRequest }),
    ).resolves.toEqual(unicodeResult);
  });

  it.each([
    ["extra", { extra: true }],
    ["forbidden evaluate name", { evaluateName: "state.count" }],
    ["forbidden object id", { objectId: "remote-1" }],
    ["forbidden call frame id", { callFrameId: "frame-1" }],
    ["forbidden scope index", { scopeIndex: 0 }],
    ["zero parent", { variablesReference: 0 }],
    ["unsafe frame", { frameId: Number.MAX_SAFE_INTEGER + 1 }],
    ["control name", { name: "bad\nname" }],
    ["control value", { value: "bad\0value" }],
    ["NUL path", { rootPath: "/workspace\0foreign" }],
    ["lone high surrogate path", { rootPath: "/workspace/\ud800" }],
    ["lone low surrogate name", { name: "\udc00" }],
    ["lone high surrogate value", { value: "\ud800" }],
    ["oversized UTF-8 path", { rootPath: `/${"ž".repeat(2_048)}` }],
    ["oversized UTF-8 name", { name: "ž".repeat(MAX_DEBUG_VARIABLE_NAME_BYTES / 2 + 1) }],
    ["oversized UTF-8 value", { value: "ž".repeat(MAX_DEBUG_VARIABLE_VALUE_BYTES / 2 + 1) }],
  ])("rejects malformed Set Variable request: %s", async (_label, change) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();
    await expect(
      invokeDebugIpc(invokeCommand, "debug_set_variable", {
        request: {
          rootPath: "/workspace",
          sessionId: 1,
          pauseGeneration: 2,
          frameId: 3,
          variablesReference: 4,
          name: "count",
          value: "43",
          ...change,
        },
      } as never),
    ).rejects.toThrow("debug_set_variable args.request");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([false, null, "true", 1])("rejects invalid canSetValue %#", (canSetValue) => {
    expect(() =>
      decodeDebugIpcResult("debug_set_variable", {
        name: "count",
        value: "43",
        variablesReference: 0,
        canSetValue,
      }),
    ).toThrow("debug_set_variable result.canSetValue");
  });

  it("rejects a Set Variable result bound to a different requested name", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      name: "foreign",
      value: "43",
      variablesReference: 0,
    });
    await expect(
      invokeDebugIpc(invokeCommand, "debug_set_variable", {
        request: {
          rootPath: "/workspace",
          sessionId: 1,
          pauseGeneration: 2,
          frameId: 3,
          variablesReference: 4,
          name: "count",
          value: "43",
        },
      }),
    ).rejects.toThrow("debug_set_variable result.name");
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["extra", { name: "count", value: "43", variablesReference: 0, extra: true }],
    ["missing value", { name: "count", variablesReference: 0 }],
    ["unsafe reference", { name: "count", value: "43", variablesReference: 2 ** 53 }],
  ])("rejects malformed Set Variable result: %s", (_label, result) => {
    expect(() => decodeDebugIpcResult("debug_set_variable", result)).toThrow(
      "debug_set_variable result",
    );
  });

  it("rejects a Set Expression value bound to a different expression name", () => {
    expect(() =>
      decodeDebugIpcResult("debug_set_expression", {
        setExpressionReference: 31,
        expression: "count",
        value: {
          name: "foreign",
          value: "43",
          type: "number",
          variablesReference: 0,
        },
      }),
    ).toThrow("debug_set_expression result.value.name");
  });

  it("rejects mutation authority nested in a Set Expression value result", () => {
    expect(() =>
      decodeDebugIpcResult("debug_set_expression", {
        setExpressionReference: 31,
        expression: "count",
        value: {
          name: "count",
          value: "43",
          type: "number",
          variablesReference: 0,
          setExpressionReference: 32,
        },
      }),
    ).toThrow("debug_set_expression result.value.setExpressionReference");
  });
});
