// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  Breakpoint,
  DebugEvent,
  DebugGateway,
  DebugRuntimeStatus,
  DebugVariable,
  StackFrame,
} from "../domain/debug";
import { useDebugSession, type UseDebugSessionResult } from "./useDebugSession";

const launch = {
  kind: "node-script",
  scriptPath: "/workspace/one/index.js",
} as const;

const frame: StackFrame = {
  frameId: 11,
  name: "main",
  filePath: "/workspace/one/index.js",
  lineNumber: 4,
  column: 1,
};

interface GatewayHarness {
  gateway: DebugGateway;
  emit(event: DebugEvent): void;
  start: ReturnType<typeof vi.fn<DebugGateway["start"]>>;
  stop: ReturnType<typeof vi.fn<DebugGateway["stop"]>>;
  setBreakpoints: ReturnType<typeof vi.fn<DebugGateway["setBreakpoints"]>>;
  step: ReturnType<typeof vi.fn<DebugGateway["step"]>>;
  scopes: ReturnType<typeof vi.fn<DebugGateway["scopes"]>>;
  variables: ReturnType<typeof vi.fn<DebugGateway["variables"]>>;
  evaluate: ReturnType<typeof vi.fn<DebugGateway["evaluate"]>>;
}

function createGateway(
  startStatus: DebugRuntimeStatus = { kind: "ok", sessionId: 4 },
): GatewayHarness {
  const handlers = new Set<(event: DebugEvent) => void>();
  const start = vi.fn<DebugGateway["start"]>().mockResolvedValue(startStatus);
  const stop = vi.fn<DebugGateway["stop"]>().mockResolvedValue(undefined);
  const setBreakpoints = vi
    .fn<DebugGateway["setBreakpoints"]>()
    .mockResolvedValue([]);
  const step = vi.fn<DebugGateway["step"]>().mockResolvedValue(undefined);
  const scopes = vi.fn<DebugGateway["scopes"]>().mockResolvedValue([]);
  const variables = vi.fn<DebugGateway["variables"]>().mockResolvedValue([]);
  const evaluate = vi.fn<DebugGateway["evaluate"]>().mockResolvedValue(null);
  const gateway: DebugGateway = {
    start,
    stop,
    setBreakpoints,
    step,
    pause: vi.fn<DebugGateway["pause"]>().mockResolvedValue(undefined),
    stackTrace: vi.fn<DebugGateway["stackTrace"]>().mockResolvedValue([]),
    scopes,
    variables,
    evaluate,
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };

  return {
    gateway,
    emit(event) {
      for (const handler of handlers) {
        handler(event);
      }
    },
    start,
    stop,
    setBreakpoints,
    step,
    scopes,
    variables,
    evaluate,
  };
}

function renderHook(
  gateway: DebugGateway,
  workspaceRoot: string | null,
  isWorkspaceTrusted: () => boolean = () => true,
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: UseDebugSessionResult | null } = { value: null };
  let props = { isWorkspaceTrusted, workspaceRoot };

  function Harness() {
    captured.value = useDebugSession({ gateway, ...props });
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();

  return {
    hook: () => {
      const value = captured.value;
      expect(value).not.toBeNull();
      return value as UseDebugSessionResult;
    },
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugSession", () => {
  it("starts a session and transitions through debugger events", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });

    expect(harness.start).toHaveBeenCalledWith("/workspace/one", launch, []);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({
      kind: "stopped",
      sessionId: 4,
      reason: "breakpoint",
      frames: [frame],
      topFrame: frame,
    });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({
      kind: "terminated",
      sessionId: 4,
      exitCode: 0,
    });
    ui.unmount();
  });

  it("adopts a session whose started event arrived before debug_start resolved", async () => {
    const harness = createGateway();
    harness.start.mockImplementation(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      return { kind: "ok", sessionId: 4 };
    });
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({
      kind: "stopped",
      sessionId: 4,
      reason: "breakpoint",
      frames: [frame],
      topFrame: frame,
    });
    ui.unmount();
  });

  it.each([
    {
      name: "stopped",
      event: {
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      } satisfies DebugEvent,
      expected: {
        kind: "stopped",
        sessionId: 4,
        reason: "breakpoint",
        frames: [frame],
        topFrame: frame,
      },
    },
    {
      name: "terminated",
      event: {
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: 0 },
      } satisfies DebugEvent,
      expected: { kind: "terminated", sessionId: 4, exitCode: 0 },
    },
  ])(
    "does not overwrite an earlier $name event when debug_start resolves",
    async ({ event, expected }) => {
      const harness = createGateway();
      const startResult = deferred<DebugRuntimeStatus>();
      harness.start.mockReturnValue(startResult.promise);
      const ui = renderHook(harness.gateway, "/workspace/one");
      let pending: Promise<void> | null = null;

      act(() => {
        pending = ui.hook().startDebug(launch);
      });
      act(() => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: { kind: "started", sessionId: 4 },
        });
        harness.emit(event);
      });
      await act(async () => {
        startResult.resolve({ kind: "ok", sessionId: 4 });
        await pending;
      });

      expect(ui.hook().snapshot.state).toEqual(expected);
      ui.unmount();
    },
  );

  it("stores the start failure message without activating a session", async () => {
    const harness = createGateway({
      kind: "unavailable",
      message: "Install a Node.js runtime to debug.",
    });
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(ui.hook().lastStartError).toBe(
      "Install a Node.js runtime to debug.",
    );
    ui.unmount();
  });

  it("routes background root events into that root's state without leaking into the active root", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    ui.set({ workspaceRoot: "/workspace/two" });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "output", stream: "stdout", text: "background" },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(ui.hook().output).toEqual([]);

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().snapshot.state).toEqual({
      kind: "terminated",
      sessionId: 4,
      exitCode: 0,
    });
    expect(ui.hook().output).toEqual([
      { stream: "stdout", text: "background" },
    ]);
    ui.unmount();
  });

  it("ignores malformed events", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    act(() => {
      harness.emit({} as unknown as DebugEvent);
      harness.emit(null as unknown as DebugEvent);
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
      } as unknown as DebugEvent);
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("ignores a second start while one is in flight for the root", async () => {
    const harness = createGateway();
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } =
      { resolve: null };
    harness.start.mockImplementation(
      () =>
        new Promise<DebugRuntimeStatus>((resolve) => {
          captured.resolve = resolve;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");

    let first: Promise<void> | null = null;
    let second: Promise<void> | null = null;
    act(() => {
      first = ui.hook().startDebug(launch);
      second = ui.hook().startDebug(launch);
    });
    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 4 });
      await first;
      await second;
    });

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    ui.unmount();
  });

  it("stops the superseded session and clears its output when restarting over an active one", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "output", stream: "stdout", text: "old" },
      });
    });
    expect(ui.hook().output).toHaveLength(1);

    await act(async () => {
      await ui.hook().startDebug(launch);
    });

    expect(harness.stop).toHaveBeenCalledWith(4);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("honours a stop requested while the start is still in flight", async () => {
    const harness = createGateway();
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } =
      { resolve: null };
    harness.start.mockImplementation(
      () =>
        new Promise<DebugRuntimeStatus>((resolve) => {
          captured.resolve = resolve;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");

    let pendingStart: Promise<void> | null = null;
    act(() => {
      pendingStart = ui.hook().startDebug(launch);
    });
    await act(async () => {
      await ui.hook().stopDebug();
    });
    expect(harness.stop).not.toHaveBeenCalled();

    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 9 });
      await pendingStart;
    });

    expect(harness.stop).toHaveBeenCalledWith(9);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("discards a start that resolves after the root switched and stops the orphan", async () => {
    const harness = createGateway();
    let resolveStart: ((status: DebugRuntimeStatus) => void) | null = null;
    harness.start.mockImplementation(
      () =>
        new Promise<DebugRuntimeStatus>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");

    let pending: Promise<void> | null = null;
    act(() => {
      pending = ui.hook().startDebug(launch);
    });
    ui.set({ workspaceRoot: "/workspace/two" });

    await act(async () => {
      resolveStart?.({ kind: "ok", sessionId: 9 });
      await pending;
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(harness.stop).toHaveBeenCalledWith(9);

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("keeps breakpoints isolated per workspace root", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });
    expect(ui.hook().breakpoints).toHaveLength(1);

    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().breakpoints).toEqual([]);

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().breakpoints).toHaveLength(1);

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });
    expect(ui.hook().breakpoints).toEqual([]);
    expect(harness.setBreakpoints).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("pushes breakpoints for the file to an active session and applies verification", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(
      async (_sessionId, _filePath, breakpoints) =>
        breakpoints.map((entry) => ({
          ...entry,
          lineNumber: entry.lineNumber + 1,
          verified: true,
        })),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });

    expect(harness.setBreakpoints).toHaveBeenCalledWith(
      4,
      "/workspace/one/index.js",
      [
        expect.objectContaining({
          filePath: "/workspace/one/index.js",
          lineNumber: 4,
          enabled: true,
        }),
      ],
    );
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ lineNumber: 5, verified: true }),
    ]);
    ui.unmount();
  });

  it("applies breakpointsVerified events to the root breakpoint list", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });
    const created = ui.hook().breakpoints[0] as Breakpoint;

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: {
          kind: "breakpointsVerified",
          filePath: "/workspace/one/index.js",
          breakpoints: [{ ...created, lineNumber: 6, verified: true }],
        },
      });
    });

    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({
        id: created.id,
        lineNumber: 6,
        verified: true,
      }),
    ]);
    ui.unmount();
  });

  it("buffers session output with an amortized cap", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      for (let line = 0; line < 5505; line += 1) {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 2 + line,
          payload: { kind: "output", stream: "stdout", text: `line ${line}` },
        });
      }
    });

    expect(ui.hook().output.length).toBeLessThanOrEqual(5500);
    expect(ui.hook().output[0]).toEqual({ stream: "stdout", text: "line 501" });
    expect(ui.hook().output[ui.hook().output.length - 1]).toEqual({
      stream: "stdout",
      text: "line 5504",
    });
    ui.unmount();
  });

  it("loads scopes and variables for a selected frame and evaluates against it", async () => {
    const harness = createGateway();
    const scope = { name: "Local", variablesReference: 21, expensive: false };
    const variable = {
      name: "count",
      value: "3",
      variablesReference: 0,
    };
    harness.scopes.mockResolvedValue([scope]);
    harness.variables.mockResolvedValue([variable]);
    harness.evaluate.mockResolvedValue(variable);
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      });
    });

    await act(async () => {
      await ui.hook().selectFrame(11);
    });
    expect(harness.scopes).toHaveBeenCalledWith(4, 11);
    expect(ui.hook().selectedFrameId).toBe(11);
    expect(ui.hook().scopes).toEqual([scope]);

    await act(async () => {
      await ui.hook().loadVariables(21);
    });
    expect(harness.variables).toHaveBeenCalledWith(4, 21);
    expect(ui.hook().variablesByReference[21]).toEqual([variable]);

    let evaluated = null;
    await act(async () => {
      evaluated = await ui.hook().evaluate("count");
    });
    expect(harness.evaluate).toHaveBeenCalledWith(
      "/workspace/one",
      4,
      11,
      "count",
    );
    expect(evaluated).toEqual(variable);
    expect(ui.hook().evaluationHistory).toEqual(["count"]);

    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().evaluationHistory).toEqual([]);
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().evaluationHistory).toEqual(["count"]);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "resumed" },
      });
    });
    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().scopes).toEqual([]);
    expect(ui.hook().variablesByReference).toEqual({});

    await act(async () => {
      await ui.hook().selectFrame(11);
      await ui.hook().loadVariables(21);
    });
    expect(harness.scopes).toHaveBeenCalledTimes(1);
    expect(harness.variables).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("drops evaluation results after a workspace switch or trust revocation", async () => {
    const harness = createGateway();
    const first = deferred<DebugVariable | null>();
    const second = deferred<DebugVariable | null>();
    let trusted = true;
    harness.evaluate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      });
    });

    const pending = ui.hook().evaluate("count");
    ui.set({ workspaceRoot: "/workspace/two" });
    first.resolve({ name: "count", value: "3", variablesReference: 0 });
    await expect(pending).resolves.toBeNull();

    ui.set({ workspaceRoot: "/workspace/one" });
    const revokedWhilePending = ui.hook().evaluate("total");
    trusted = false;
    second.resolve({ name: "total", value: "9", variablesReference: 0 });
    await expect(revokedWhilePending).resolves.toBeNull();
    await expect(ui.hook().evaluate("count")).resolves.toBeNull();
    expect(harness.evaluate).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("drops an evaluation result after the session is replaced", async () => {
    const harness = createGateway();
    const pendingResult = deferred<DebugVariable | null>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 5 });
    harness.evaluate.mockReturnValueOnce(pendingResult.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame] },
      });
    });

    const pending = ui.hook().evaluate("count");
    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    pendingResult.resolve({ name: "count", value: "3", variablesReference: 0 });

    await expect(pending).resolves.toBeNull();
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "running",
      sessionId: 5,
    });
    ui.unmount();
  });

  it("steps and stops the active session", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });

    await act(async () => {
      await ui.hook().stepDebug("stepInto");
      await ui.hook().stopDebug();
    });

    expect(harness.step).toHaveBeenCalledWith(4, "stepInto");
    expect(harness.stop).toHaveBeenCalledWith(4);
    ui.unmount();
  });

  it("restores persisted breakpoints for the active root without regenerating ids", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    const persisted: Breakpoint[] = [
      {
        id: "bp-7",
        filePath: "/workspace/one/index.js",
        lineNumber: 3,
        enabled: true,
      },
      {
        id: "bp-9",
        filePath: "/workspace/one/lib.js",
        lineNumber: 8,
        enabled: false,
        condition: "x > 1",
      },
    ];

    await act(async () => {
      await ui.hook().restoreBreakpoints(persisted);
    });

    expect(ui.hook().breakpoints).toEqual(persisted);
    expect(harness.setBreakpoints).not.toHaveBeenCalled();

    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().breakpoints).toEqual([]);

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().breakpoints).toEqual(persisted);
    ui.unmount();
  });

  it("ignores a restore when no workspace root is active", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, null);

    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "bp-1",
          filePath: "/workspace/one/index.js",
          lineNumber: 3,
          enabled: true,
        },
      ]);
    });

    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("does not reuse a restored breakpoint id for a newly toggled breakpoint", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "bp-1",
          filePath: "/workspace/one/index.js",
          lineNumber: 3,
          enabled: true,
        },
      ]);
    });
    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 9);
    });

    const ids = ui.hook().breakpoints.map((entry) => entry.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    ui.unmount();
  });

  it("syncs restored breakpoints per affected file into an active session", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(
      async (_sessionId, _filePath, breakpoints) =>
        breakpoints.map((entry) => ({ ...entry, verified: true })),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });

    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "bp-1",
          filePath: "/workspace/one/index.js",
          lineNumber: 3,
          enabled: true,
        },
        {
          id: "bp-2",
          filePath: "/workspace/one/lib.js",
          lineNumber: 8,
          enabled: true,
        },
      ]);
    });

    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    expect(harness.setBreakpoints).toHaveBeenCalledWith(
      4,
      "/workspace/one/index.js",
      [expect.objectContaining({ id: "bp-1", lineNumber: 3 })],
    );
    expect(harness.setBreakpoints).toHaveBeenCalledWith(
      4,
      "/workspace/one/lib.js",
      [expect.objectContaining({ id: "bp-2", lineNumber: 8 })],
    );
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ id: "bp-1", verified: true }),
      expect.objectContaining({ id: "bp-2", verified: true }),
    ]);
    ui.unmount();
  });

  it("unsubscribes from debugger events on unmount", async () => {
    const handlers = new Set<(event: DebugEvent) => void>();
    const harness = createGateway();
    const subscribe = vi.fn((handler: (event: DebugEvent) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    });
    const gateway: DebugGateway = { ...harness.gateway, subscribe };
    const ui = renderHook(gateway, "/workspace/one");

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(handlers.size).toBe(1);

    ui.unmount();
    expect(handlers.size).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
