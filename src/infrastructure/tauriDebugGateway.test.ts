import { describe, expect, it, vi } from "vitest";
import { TauriDebugGateway } from "./tauriDebugGateway";
import type { Breakpoint, DebugCompoundStartRequest, DebugEvent } from "../domain/debug";

type DebugGatewayConstructor = ConstructorParameters<typeof TauriDebugGateway>;
type InvokeCommand = NonNullable<DebugGatewayConstructor[0]>;
type ListenToEvent = NonNullable<DebugGatewayConstructor[1]>;

const breakpoint: Breakpoint = {
  id: "bp-1",
  filePath: "/workspace/one/index.js",
  lineNumber: 4,
  enabled: true,
};

const frame = {
  frameId: 11,
  name: "main",
  filePath: "/workspace/one/index.js",
  lineNumber: 4,
  column: 1,
};

describe("TauriDebugGateway", () => {
  it("keeps compound startup private, bounded, and unavailable outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
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
          launch: { kind: "node-script", scriptPath: "/workspace/b.js" },
          breakpoints: [],
          exceptionPauseMode: "none",
          exceptionTypeFilter: [],
        },
      ],
    };
    const browserGateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => false);
    await expect(browserGateway.startCompound(request)).resolves.toEqual({
      kind: "unavailable",
      message: "Debugging requires the Tauri desktop runtime.",
    });
    expect(invokeCommand).not.toHaveBeenCalled();

    invokeCommand.mockResolvedValue({ status: "ok", sessionIds: [7, 8] });
    const desktopGateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    await expect(desktopGateway.startCompound(request)).resolves.toEqual({
      kind: "ok",
      sessionIds: [7, 8],
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start_compound", { request });
    const invokedRequest = invokeCommand.mock.calls[0]?.[1]?.request as DebugCompoundStartRequest;
    expect(invokedRequest).not.toBe(request);
    expect(invokedRequest.members).not.toBe(request.members);
    expect(invokedRequest.members[0]?.breakpoints).not.toBe(request.members[0]?.breakpoints);
    expect(invokedRequest.members[0]?.exceptionTypeFilter).not.toBe(
      request.members[0]?.exceptionTypeFilter,
    );
  });

  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriDebugGateway(invokeCommand, listenToEvent, () => false);

    await expect(
      gateway.start(
        "/workspace/one",
        { kind: "node-script", scriptPath: "/workspace/one/index.js" },
        [breakpoint],
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      message: "Debugging requires the Tauri desktop runtime.",
    });
    await expect(gateway.stop(1)).resolves.toBeUndefined();
    await expect(
      gateway.disconnect({ rootPath: "/workspace/one", sessionId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.setBreakpoints("/workspace/one", 1, "/workspace/one/index.js", [breakpoint]),
    ).resolves.toEqual([]);
    await expect(
      gateway.setBreakpointsActive?.({
        rootPath: "/workspace/one",
        sessionId: 1,
        active: false,
      }),
    ).resolves.toBeUndefined();
    await expect(gateway.step(1, "continue")).resolves.toBeUndefined();
    await expect(gateway.pause(1)).resolves.toBeUndefined();
    await expect(
      gateway.restartFrame({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 2,
        frameId: 11,
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.runToLocation({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 2,
        filePath: "/workspace/one/index.js",
        lineNumber: 4,
        columnNumber: 2,
      }),
    ).resolves.toBeUndefined();
    await expect(gateway.setExceptionPause("/workspace/one", 1, "all")).resolves.toBeUndefined();
    await expect(gateway.stackTrace(1)).resolves.toEqual([]);
    await expect(
      gateway.scopesAtPause({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 1,
        frameId: 11,
      }),
    ).resolves.toEqual([]);
    await expect(
      gateway.variablesPage({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 1,
        frameId: 11,
        variablesReference: 21,
        start: 0,
        count: 100,
      }),
    ).resolves.toEqual({ variables: [], start: 0, returned: 0, truncated: false });
    await expect(
      gateway.setVariable({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 1,
        frameId: 11,
        variablesReference: 21,
        name: "count",
        value: "43",
      }),
    ).rejects.toThrow("Debugging requires the Tauri desktop runtime.");
    await expect(
      gateway.setExpression({
        rootPath: "/workspace/one",
        sessionId: 1,
        pauseGeneration: 1,
        frameId: 11,
        setExpressionReference: 31,
        expression: "count",
        value: "43",
      }),
    ).rejects.toThrow("Debugging requires the Tauri desktop runtime.");
    await expect(
      gateway.evaluate("/workspace/one", 1, 11, "count", "watch", false, 1),
    ).resolves.toBeNull();

    const unsubscribe = gateway.subscribe(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("invokes the exact Set Variable command and returns the decoded variable", async () => {
    const result = {
      name: "count",
      value: "43",
      type: "number",
      canSetValue: true as const,
      variablesReference: 7,
    };
    const invokeCommand = vi.fn<InvokeCommand>().mockResolvedValue(result);
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const request = {
      rootPath: "/workspace",
      sessionId: 1,
      pauseGeneration: 2,
      frameId: 3,
      variablesReference: 4,
      name: "count",
      value: "43",
    };
    await expect(gateway.setVariable(request)).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_variable", { request });
  });

  it("sets the exact function breakpoint replacement for an owned session", async () => {
    const invokeCommand = vi
      .fn<InvokeCommand>()
      .mockResolvedValue([{ id: "fn-1", verified: true }]);
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const request = {
      rootPath: "/workspace",
      sessionId: 7,
      breakpoints: [{ id: "fn-1", functionName: "app.render", enabled: true }],
    } as const;
    await expect(gateway.setFunctionBreakpoints(request)).resolves.toEqual([
      { id: "fn-1", verified: true },
    ]);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_function_breakpoints", {
      request,
    });
  });

  it("invokes the exact Set Expression command and validates its echoed authority", async () => {
    const request = {
      rootPath: "/workspace",
      sessionId: 1,
      pauseGeneration: 2,
      frameId: 3,
      setExpressionReference: 31,
      expression: "count",
      value: "43",
    };
    const wire = {
      setExpressionReference: 31,
      expression: "count",
      value: {
        name: "count",
        value: "43",
        type: "number",
        variablesReference: 0,
      },
    };
    const invokeCommand = vi.fn<InvokeCommand>().mockResolvedValue(wire);
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    await expect(gateway.setExpression(request)).resolves.toEqual({
      setExpressionReference: 31,
      expression: "count",
      value: { status: "ok", value: "43", type: "number", variablesReference: 0 },
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_set_expression", { request });
  });

  it("delegates debug commands inside Tauri", async () => {
    const scope = { name: "Local", variablesReference: 21, expensive: false };
    const variable = {
      name: "count",
      value: "3",
      type: "number",
      evaluateName: "state.count",
      variablesReference: 0,
    };
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "debug_start") {
        return { status: "ok", sessionId: 4 };
      }

      if (command === "debug_set_breakpoints") {
        return [{ ...breakpoint, verified: true }];
      }

      if (command === "debug_stack_trace") {
        return [frame];
      }

      if (command === "debug_scopes") {
        return [scope];
      }

      if (command === "debug_variables") {
        return { variables: [variable], start: 0, returned: 1, truncated: false };
      }

      if (command === "debug_evaluate") {
        return { status: "ok", value: variable };
      }

      if (command === "debug_set_exception_pause") {
        return null;
      }

      return undefined;
    });
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await expect(
      gateway.start(
        "/workspace/one",
        { kind: "node-script", scriptPath: "/workspace/one/index.js" },
        [breakpoint],
      ),
    ).resolves.toEqual({ kind: "ok", sessionId: 4 });
    await expect(gateway.stop(4)).resolves.toBeUndefined();
    await expect(
      gateway.disconnect({ rootPath: "/workspace/one", sessionId: 4 }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.setBreakpoints("/workspace/one", 4, "/workspace/one/index.js", [breakpoint]),
    ).resolves.toEqual([{ ...breakpoint, verified: true }]);
    await expect(
      gateway.setBreakpointsActive?.({
        rootPath: "/workspace/one",
        sessionId: 4,
        active: false,
      }),
    ).resolves.toBeUndefined();
    await expect(gateway.step(4, "stepOver")).resolves.toBeUndefined();
    await expect(gateway.pause(4)).resolves.toBeUndefined();
    await expect(
      gateway.restartFrame({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.runToLocation({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        filePath: "/workspace/one/index.js",
        lineNumber: 4,
        columnNumber: 2,
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.setExceptionPause("/workspace/one", 4, "uncaught", ["TypeError"]),
    ).resolves.toBeUndefined();
    await expect(gateway.stackTrace(4)).resolves.toEqual([frame]);
    await expect(
      gateway.scopesAtPause({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      }),
    ).resolves.toEqual([scope]);
    await expect(
      gateway.variablesPage({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
        variablesReference: 21,
        start: 0,
        count: 100,
      }),
    ).resolves.toEqual({ variables: [variable], start: 0, returned: 1, truncated: false });
    await expect(
      gateway.evaluate("/workspace/one", 4, 11, "count", "repl", true, 3),
    ).resolves.toEqual({
      status: "ok",
      value: "3",
      type: "number",
      evaluateName: "state.count",
      variablesReference: 0,
    });

    expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
      rootPath: "/workspace/one",
      launch: { kind: "node-script", scriptPath: "/workspace/one/index.js" },
      breakpoints: [breakpoint],
      exceptionPauseMode: "none",
      exceptionTypeFilter: [],
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_stop", { sessionId: 4 });
    expect(invokeCommand).toHaveBeenCalledWith("debug_disconnect", {
      request: { rootPath: "/workspace/one", sessionId: 4 },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_set_breakpoints", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        filePath: "/workspace/one/index.js",
        breakpoints: [breakpoint],
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_set_breakpoints_active", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        active: false,
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_step", {
      sessionId: 4,
      kind: "stepOver",
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_pause", { sessionId: 4 });
    expect(invokeCommand).toHaveBeenCalledWith("debug_restart_frame", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_run_to_location", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        filePath: "/workspace/one/index.js",
        lineNumber: 4,
        columnNumber: 2,
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_set_exception_pause", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        mode: "uncaught",
        exceptionTypeFilter: ["TypeError"],
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_stack_trace", {
      sessionId: 4,
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_scopes", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_variables", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
        variablesReference: 21,
        start: 0,
        count: 100,
      },
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_evaluate", {
      request: {
        rootPath: "/workspace/one",
        sessionId: 4,
        frameId: 11,
        pauseGeneration: 3,
        expression: "count",
        context: "repl",
        allowSideEffects: true,
      },
    });
  });

  it("does not leak runtime details when run-to-location fails", async () => {
    const invokeCommand = vi
      .fn<InvokeCommand>()
      .mockRejectedValue(new Error("adapter secret at /private/workspace/index.ts"));
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await expect(
      gateway.runToLocation({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        filePath: "/workspace/one/index.js",
        lineNumber: 4,
        columnNumber: 2,
      }),
    ).rejects.toThrow("Unable to run debugging to the selected location.");
    await expect(
      gateway.runToLocation({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        filePath: "/workspace/one/index.js",
        lineNumber: 4,
        columnNumber: 2,
      }),
    ).rejects.not.toThrow("/private/workspace/index.ts");
  });

  it("does not leak runtime details when restart-frame fails", async () => {
    const invokeCommand = vi
      .fn<InvokeCommand>()
      .mockRejectedValue(new Error("CDP secret callFrameId at /private/workspace/index.ts"));
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await expect(
      gateway.restartFrame({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      }),
    ).rejects.toThrow("Unable to restart the selected stack frame.");
    await expect(
      gateway.restartFrame({
        rootPath: "/workspace/one",
        sessionId: 4,
        pauseGeneration: 3,
        frameId: 11,
      }),
    ).rejects.not.toThrow("callFrameId");
  });

  it("forwards an explicit startup exception pause policy", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({ status: "ok", sessionId: 4 }));
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await gateway.start(
      "/workspace/one",
      { kind: "node-script", scriptPath: "/workspace/one/index.js" },
      [],
      "all",
      ["Error", "app.DomainError"],
    );

    expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
      rootPath: "/workspace/one",
      launch: { kind: "node-script", scriptPath: "/workspace/one/index.js" },
      breakpoints: [],
      exceptionPauseMode: "all",
      exceptionTypeFilter: ["Error", "app.DomainError"],
    });
  });

  it("forwards an exact Node attach launch", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({ status: "ok", sessionId: 4 }));
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const launch = { kind: "node-attach", port: 9229 } as const;

    await expect(
      gateway.start("/workspace/one", launch, [], "uncaught", ["TypeError"]),
    ).resolves.toEqual({
      kind: "ok",
      sessionId: 4,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start", {
      rootPath: "/workspace/one",
      launch,
      breakpoints: [],
      exceptionPauseMode: "uncaught",
      exceptionTypeFilter: ["TypeError"],
    });
  });

  it("maps unavailable and error start responses", async () => {
    const invokeCommand = vi
      .fn<InvokeCommand>()
      .mockResolvedValueOnce({ status: "unavailable", message: "no runtime" })
      .mockResolvedValueOnce({ status: "error", message: "spawn failed" });
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const launch = {
      kind: "node-script",
      scriptPath: "/workspace/one/index.js",
    } as const;

    await expect(gateway.start("/workspace/one", launch, [])).resolves.toEqual({
      kind: "unavailable",
      message: "no runtime",
    });
    await expect(gateway.start("/workspace/one", launch, [])).resolves.toEqual({
      kind: "error",
      message: "spawn failed",
    });
  });

  it("rejects a malformed start response at the IPC boundary", async () => {
    const invokeCommand = vi.fn<InvokeCommand>().mockResolvedValue({
      status: "ok",
      session_id: 4,
    });
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);

    await expect(
      gateway.start(
        "/workspace/one",
        { kind: "node-script", scriptPath: "/workspace/one/index.js" },
        [],
      ),
    ).rejects.toThrow("Invalid debug IPC value at debug_start result");
  });

  it("forwards the captured nested package context when starting a JS test", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({
      status: "ok",
      sessionId: 9,
    }));
    const gateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    const launch = {
      kind: "js-test-file",
      runner: "vitest",
      filePath: "/workspace/packages/math/src/sum.test.ts",
      packageRootPath: "/workspace/packages/math",
    } as const;

    await expect(gateway.start("/workspace", launch, [])).resolves.toEqual({
      kind: "ok",
      sessionId: 9,
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
      rootPath: "/workspace",
      launch,
      breakpoints: [],
      exceptionPauseMode: "none",
      exceptionTypeFilter: [],
    });
  });

  it("forwards debug events until unsubscribed", async () => {
    const unlisten = vi.fn();
    const captured: {
      emit: ((event: { payload: unknown }) => void) | null;
    } = { emit: null };
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      captured.emit = handler;
      return unlisten;
    });
    const handler = vi.fn();
    const gateway = new TauriDebugGateway(vi.fn(), listenToEvent, () => true);
    const event: DebugEvent = {
      rootPath: "/workspace/one",
      sessionId: 4,
      seq: 1,
      payload: { kind: "started", sessionId: 4 },
    };

    const unsubscribe = gateway.subscribe(handler);
    await Promise.resolve();

    expect(listenToEvent).toHaveBeenCalledWith("debug://event", expect.any(Function));
    expect(captured.emit).not.toBeNull();
    captured.emit?.({ payload: event });
    expect(handler).toHaveBeenCalledWith(event);

    expect(() =>
      captured.emit?.({
        payload: { ...event, sessionId: -1 },
      }),
    ).toThrow("Invalid debug IPC value at debug event.sessionId");
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    await Promise.resolve();

    captured.emit?.({ payload: { ...event, seq: 2 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
