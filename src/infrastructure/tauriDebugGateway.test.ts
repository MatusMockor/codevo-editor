import { describe, expect, it, vi } from "vitest";
import { TauriDebugGateway } from "./tauriDebugGateway";
import type { Breakpoint, DebugEvent } from "../domain/debug";

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
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriDebugGateway(
      invokeCommand,
      listenToEvent,
      () => false,
    );

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
      gateway.setBreakpoints(1, "/workspace/one/index.js", [breakpoint]),
    ).resolves.toEqual([]);
    await expect(gateway.step(1, "continue")).resolves.toBeUndefined();
    await expect(gateway.pause(1)).resolves.toBeUndefined();
    await expect(gateway.stackTrace(1)).resolves.toEqual([]);
    await expect(gateway.scopes(1, 11)).resolves.toEqual([]);
    await expect(gateway.variables(1, 21)).resolves.toEqual([]);
    await expect(gateway.evaluate(1, 11, "count")).resolves.toBeNull();

    const unsubscribe = gateway.subscribe(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates debug commands inside Tauri", async () => {
    const scope = { name: "Local", variablesReference: 21, expensive: false };
    const variable = {
      name: "count",
      value: "3",
      type: "number",
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
        return [variable];
      }

      if (command === "debug_evaluate") {
        return variable;
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
      gateway.setBreakpoints(4, "/workspace/one/index.js", [breakpoint]),
    ).resolves.toEqual([{ ...breakpoint, verified: true }]);
    await expect(gateway.step(4, "stepOver")).resolves.toBeUndefined();
    await expect(gateway.pause(4)).resolves.toBeUndefined();
    await expect(gateway.stackTrace(4)).resolves.toEqual([frame]);
    await expect(gateway.scopes(4, 11)).resolves.toEqual([scope]);
    await expect(gateway.variables(4, 21)).resolves.toEqual([variable]);
    await expect(gateway.evaluate(4, 11, "count")).resolves.toEqual(variable);

    expect(invokeCommand).toHaveBeenCalledWith("debug_start", {
      rootPath: "/workspace/one",
      launch: { kind: "node-script", scriptPath: "/workspace/one/index.js" },
      breakpoints: [breakpoint],
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_stop", { sessionId: 4 });
    expect(invokeCommand).toHaveBeenCalledWith("debug_set_breakpoints", {
      sessionId: 4,
      filePath: "/workspace/one/index.js",
      breakpoints: [breakpoint],
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_step", {
      sessionId: 4,
      kind: "stepOver",
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_pause", { sessionId: 4 });
    expect(invokeCommand).toHaveBeenCalledWith("debug_stack_trace", {
      sessionId: 4,
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_scopes", {
      sessionId: 4,
      frameId: 11,
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_variables", {
      sessionId: 4,
      variablesReference: 21,
    });
    expect(invokeCommand).toHaveBeenCalledWith("debug_evaluate", {
      sessionId: 4,
      frameId: 11,
      expression: "count",
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

  it("forwards debug events until unsubscribed", async () => {
    const unlisten = vi.fn();
    const captured: {
      emit: ((event: { payload: DebugEvent }) => void) | null;
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

    expect(listenToEvent).toHaveBeenCalledWith(
      "debug://event",
      expect.any(Function),
    );
    expect(captured.emit).not.toBeNull();
    captured.emit?.({ payload: event });
    expect(handler).toHaveBeenCalledWith(event);

    unsubscribe();
    await Promise.resolve();

    captured.emit?.({ payload: { ...event, seq: 2 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
