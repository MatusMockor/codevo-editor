// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  Breakpoint,
  BreakpointCreationOwnership,
  DebugEvent,
  DebugGateway,
  DebugLaunchTarget,
  DebugSetBreakpointsActiveRequest,
  DebugRuntimeStatus,
  DebugScope,
  DebugVariable,
  DebugVariablePage,
  StackFrame,
} from "../domain/debug";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebugConsoleCompletionResponse } from "../domain/debugConsoleCompletions";
import { DebugRestartCoordinator } from "./debugRestartCoordinator";
import type { DebugStartDescriptor } from "./debugStartDescriptor";
import type {
  DebugRestartFrameCandidate,
  NodeDebugAttachCandidateStartPort,
} from "./debugSessionContracts";
import { useWorkbenchDebugSession } from "./useDebugSession";

const launch = {
  kind: "node-script",
  scriptPath: "/workspace/one/index.js",
} as const;

const compoundMembers = [
  launch,
  {
    kind: "node-npm-script",
    script: "worker",
    packageRootPath: "/workspace/one",
    args: [] as string[],
    env: {},
  },
] as const;

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
  pause: ReturnType<typeof vi.fn<DebugGateway["pause"]>>;
  runToLocation: ReturnType<typeof vi.fn<DebugGateway["runToLocation"]>>;
  restartFrame: ReturnType<typeof vi.fn<DebugGateway["restartFrame"]>>;
  start: ReturnType<typeof vi.fn<DebugGateway["start"]>>;
  startCompound: ReturnType<typeof vi.fn<NonNullable<DebugGateway["startCompound"]>>>;
  stop: ReturnType<typeof vi.fn<DebugGateway["stop"]>>;
  disconnect: ReturnType<typeof vi.fn<DebugGateway["disconnect"]>>;
  setBreakpoints: ReturnType<typeof vi.fn<DebugGateway["setBreakpoints"]>>;
  setFunctionBreakpoints: ReturnType<
    typeof vi.fn<NonNullable<DebugGateway["setFunctionBreakpoints"]>>
  >;
  setBreakpointsActive: ReturnType<
    typeof vi.fn<(request: DebugSetBreakpointsActiveRequest) => Promise<void>>
  >;
  setExceptionPause: ReturnType<typeof vi.fn<DebugGateway["setExceptionPause"]>>;
  step: ReturnType<typeof vi.fn<DebugGateway["step"]>>;
  scopesAtPause: ReturnType<typeof vi.fn<DebugGateway["scopesAtPause"]>>;
  variablesPage: ReturnType<typeof vi.fn<DebugGateway["variablesPage"]>>;
  setVariable: ReturnType<typeof vi.fn<DebugGateway["setVariable"]>>;
  setExpression: ReturnType<typeof vi.fn<DebugGateway["setExpression"]>>;
  evaluate: ReturnType<typeof vi.fn<DebugGateway["evaluate"]>>;
  completions: ReturnType<typeof vi.fn<NonNullable<DebugGateway["completions"]>>>;
}

function createGateway(
  startStatus: DebugRuntimeStatus = { kind: "ok", sessionId: 4 },
): GatewayHarness {
  const handlers = new Set<(event: DebugEvent) => void>();
  const start = vi.fn<DebugGateway["start"]>().mockResolvedValue(startStatus);
  const startCompound = vi
    .fn<NonNullable<DebugGateway["startCompound"]>>()
    .mockResolvedValue({ kind: "ok", sessionIds: [41, 42] });
  const stop = vi.fn<DebugGateway["stop"]>().mockResolvedValue(undefined);
  const disconnect = vi.fn<DebugGateway["disconnect"]>().mockResolvedValue(undefined);
  const setBreakpoints = vi.fn<DebugGateway["setBreakpoints"]>().mockResolvedValue([]);
  const setFunctionBreakpoints = vi
    .fn<NonNullable<DebugGateway["setFunctionBreakpoints"]>>()
    .mockImplementation(async ({ breakpoints }) =>
      breakpoints.map(({ id }) => ({ id, verified: true })),
    );
  const setBreakpointsActive = vi.fn(
    async (_request: DebugSetBreakpointsActiveRequest): Promise<void> => undefined,
  );
  const step = vi.fn<DebugGateway["step"]>().mockResolvedValue(undefined);
  const pause = vi.fn<DebugGateway["pause"]>().mockResolvedValue(undefined);
  const scopesAtPause = vi.fn<DebugGateway["scopesAtPause"]>().mockResolvedValue([]);
  const variablesPage = vi
    .fn<DebugGateway["variablesPage"]>()
    .mockImplementation(async (request) => ({
      variables: [],
      start: request.start,
      returned: 0,
      truncated: false,
    }));
  const evaluate = vi.fn<DebugGateway["evaluate"]>().mockResolvedValue(null);
  const completions = vi
    .fn<NonNullable<DebugGateway["completions"]>>()
    .mockResolvedValue({ items: [], isIncomplete: false });
  const setVariable = vi.fn<DebugGateway["setVariable"]>();
  const setExpression = vi.fn<DebugGateway["setExpression"]>();
  const setExceptionPause = vi.fn<DebugGateway["setExceptionPause"]>().mockResolvedValue(undefined);
  const runToLocation = vi.fn<DebugGateway["runToLocation"]>().mockResolvedValue(undefined);
  const restartFrame = vi.fn<DebugGateway["restartFrame"]>().mockResolvedValue(undefined);
  const gateway: DebugGateway = {
    start,
    startCompound,
    stop,
    disconnect,
    setBreakpoints,
    setFunctionBreakpoints,
    setBreakpointsActive,
    step,
    pause,
    runToLocation,
    restartFrame,
    setExceptionPause,
    stackTrace: vi.fn<DebugGateway["stackTrace"]>().mockResolvedValue([]),
    scopesAtPause,
    variablesPage,
    setVariable,
    setExpression,
    evaluate,
    completions,
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
    startCompound,
    stop,
    disconnect,
    pause,
    runToLocation,
    restartFrame,
    setBreakpoints,
    setFunctionBreakpoints,
    setBreakpointsActive,
    setExceptionPause,
    step,
    scopesAtPause,
    variablesPage,
    setVariable,
    setExpression,
    evaluate,
    completions,
  };
}

function renderHook(
  gateway: DebugGateway,
  workspaceRoot: string | null,
  isWorkspaceTrusted: () => boolean = () => true,
  strictMode = false,
  workspaceId: string | null = null,
  isWorkspaceCurrent?: (rootPath: string, workspaceId: string) => boolean,
  nodeDebugAttachCandidateStart?: NodeDebugAttachCandidateStartPort,
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  type TestDebugSession = ReturnType<typeof useWorkbenchDebugSession>["session"] &
    Pick<
      ReturnType<typeof useWorkbenchDebugSession>,
      "startDebugCompoundAccepted" | "startNodeAttachCandidateAccepted"
    >;
  const captured: { value: TestDebugSession | null } = { value: null };
  let props = { isWorkspaceCurrent, isWorkspaceTrusted, workspaceId, workspaceRoot };
  let renderCount = 0;

  function Harness() {
    renderCount += 1;
    const internal = useWorkbenchDebugSession({
      gateway,
      nodeDebugAttachCandidateStart,
      ...props,
    });
    captured.value = {
      ...internal.session,
      startDebugCompoundAccepted: internal.startDebugCompoundAccepted,
      startNodeAttachCandidateAccepted: internal.startNodeAttachCandidateAccepted,
    };
    return null;
  }

  const render = () =>
    act(() =>
      root.render(
        strictMode ? (
          <StrictMode>
            <Harness />
          </StrictMode>
        ) : (
          <Harness />
        ),
      ),
    );
  render();

  return {
    hook: () => {
      const value = captured.value;
      expect(value).not.toBeNull();
      return value as TestDebugSession;
    },
    renders: () => renderCount,
    set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function startStoppedNodeSession(
  ui: ReturnType<typeof renderHook>,
  harness: GatewayHarness,
  frames: StackFrame[] = [frame],
) {
  await act(async () => void (await ui.hook().startDebug(launch)));
  act(() => {
    harness.emit({
      rootPath: "/workspace/one",
      sessionId: 4,
      seq: 1,
      payload: { kind: "stopped", reason: "breakpoint", frames, pauseGeneration: 1 },
    });
  });
}

function restartFrameCandidate(
  overrides: Partial<DebugRestartFrameCandidate> = {},
): DebugRestartFrameCandidate {
  return {
    frameId: 11,
    isCurrent: () => true,
    pauseGeneration: 1,
    rootPath: "/workspace/one",
    sessionId: 4,
    workspaceOwnerKey: "owner-1",
    ...overrides,
  };
}

async function flushDebugOutputBatch(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("useDebugSession", () => {
  it("subscribes before native compound start, adopts an early stopped child, and targets it", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().setExceptionPauseMode("all");
      await ui.hook().setExceptionTypeFilter(["TypeError"]);
    });
    harness.startCompound.mockImplementationOnce(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 1,
        payload: { kind: "started", sessionId: 41 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: { kind: "started", sessionId: 42 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 2,
        payload: {
          kind: "stopped",
          reason: "breakpoint",
          frames: [frame],
          pauseGeneration: 1,
        },
      });
      return { kind: "ok", sessionIds: [41, 42] };
    });

    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    expect(ui.hook().debugCompoundActive).toBe(true);
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "stopped",
      sessionId: 42,
      topFrame: frame,
    });
    expect(ui.hook().pauseGeneration).toBe(1);
    expect(ui.hook().canRunToLocation()).toBe(true);
    expect(harness.startCompound).toHaveBeenCalledWith({
      rootPath: "/workspace/one",
      members: [
        {
          launch,
          breakpoints: [],
          exceptionPauseMode: "all",
          exceptionTypeFilter: ["TypeError"],
        },
        {
          launch: compoundMembers[1],
          breakpoints: [],
          exceptionPauseMode: "all",
          exceptionTypeFilter: ["TypeError"],
        },
      ],
      stopAll: true,
    });

    await act(async () => void (await ui.hook().pauseDebug()));
    expect(harness.pause).toHaveBeenCalledWith(42);
    ui.unmount();
  });

  it("flushes selected compound output before another child changes the projection", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    expect(ui.hook().snapshot.state).toMatchObject({ kind: "running", sessionId: 41 });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 1,
        payload: { kind: "started", sessionId: 41 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: { kind: "started", sessionId: 42 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 2,
        payload: {
          kind: "output",
          stream: "stdout",
          text: "child 41 output",
          truncated: false,
        },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 2,
        payload: {
          kind: "stopped",
          reason: "breakpoint",
          frames: [frame],
          pauseGeneration: 1,
        },
      });
    });
    expect(ui.hook().snapshot.state).toMatchObject({ kind: "stopped", sessionId: 42 });
    expect(ui.hook().output).toEqual([]);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 3,
        payload: { kind: "resumed" },
      });
    });
    expect(ui.hook().snapshot.state).toMatchObject({ kind: "running", sessionId: 41 });
    expect(ui.hook().output).toEqual([
      { stream: "stdout", text: "child 41 output", truncated: false },
    ]);
    ui.unmount();
  });

  it("reprojects the exact stopped sibling after the selected compound child resumes", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    const firstFrame = { ...frame, frameId: 41 };
    const secondFrame = { ...frame, frameId: 42 };
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 1,
        payload: { kind: "started", sessionId: 41 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: { kind: "started", sessionId: 42 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 2,
        payload: {
          kind: "stopped",
          reason: "breakpoint",
          frames: [firstFrame],
          pauseGeneration: 2,
        },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 2,
        payload: {
          kind: "stopped",
          reason: "breakpoint",
          frames: [secondFrame],
          pauseGeneration: 3,
        },
      });
    });
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "stopped",
      sessionId: 42,
      topFrame: secondFrame,
    });
    expect(ui.hook().pauseGeneration).toBe(3);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 3,
        payload: { kind: "resumed" },
      });
    });
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "stopped",
      sessionId: 41,
      topFrame: firstFrame,
    });
    expect(ui.hook().pauseGeneration).toBe(2);
    expect(ui.hook().canRunToLocation()).toBe(true);

    await act(async () => void (await ui.hook().stepDebug("continue")));
    expect(harness.step).toHaveBeenCalledExactlyOnceWith(41, "continue");
    ui.unmount();
  });

  it("fans live breakpoint and exception policies out to every exact compound member", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(
      async (_rootPath, _sessionId, _filePath, breakpoints) => [...breakpoints],
    );
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.compoundOnly")).toBe(false);
    });
    expect(ui.hook().functionBreakpoints).toEqual([]);

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 9);
    });
    expect(harness.setBreakpoints.mock.calls.map((call) => call[1])).toEqual([41, 42]);

    harness.setBreakpoints.mockClear();
    const breakpointId = ui.hook().breakpoints[0]!.id;
    await act(async () => {
      await ui.hook().setBreakpointEnabled(breakpointId, false);
    });
    expect(harness.setBreakpoints.mock.calls.map((call) => call[1])).toEqual([41, 42]);

    await act(async () => void (await ui.hook().toggleBreakpointsActivated()));
    expect(harness.setBreakpointsActive.mock.calls.map(([request]) => request.sessionId)).toEqual([
      41, 42,
    ]);

    await act(async () => void (await ui.hook().setExceptionPauseMode("all")));
    expect(harness.setExceptionPause.mock.calls).toEqual([
      ["/workspace/one", 41, "all"],
      ["/workspace/one", 42, "all"],
    ]);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 41 });
    ui.unmount();
  });

  it("stops the exact compound after a partial breakpoint-policy failure", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(async (_root, sessionId, _file, breakpoints) => {
      if (sessionId === 42) throw new Error("secret adapter failure");
      return [...breakpoints];
    });
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    await act(async () => {
      await expect(ui.hook().toggleBreakpoint("/workspace/one/index.js", 9)).rejects.toThrow(
        "Breakpoint update was cancelled because the debug session changed.",
      );
    });
    expect(ui.hook().breakpoints).toEqual([]);
    expect(JSON.stringify(harness.setBreakpoints.mock.calls)).not.toContain("secret");
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    expect(ui.hook().snapshot.state.kind).toBe("terminated");
    expect(ui.hook().canRunToLocation()).toBe(false);
    ui.unmount();
  });

  it("stops the exact compound after a partial exception-policy failure", async () => {
    const harness = createGateway();
    harness.setExceptionPause.mockImplementation(async (_rootPath, sessionId) => {
      if (sessionId === 42) throw new Error("secret exception failure");
    });
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    await act(async () => void (await ui.hook().setExceptionPauseMode("all")));
    expect(ui.hook().exceptionPauseError).toBeNull();
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    expect(ui.hook().snapshot.state.kind).toBe("terminated");
    ui.unmount();
  });

  it("does not fan policy mutations out after the first compound terminal", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: { kind: "terminated", exitCode: 1 },
      });
    });

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 9);
      await ui.hook().setExceptionPauseMode("uncaught");
      expect(await ui.hook().toggleBreakpointsActivated()).toBe(false);
    });
    expect(harness.setBreakpoints).not.toHaveBeenCalled();
    expect(harness.setBreakpointsActive).not.toHaveBeenCalled();
    expect(harness.setExceptionPause).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("does not fan policy mutations out after compound workspace ownership changes", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    ui.set({ workspaceId: "foreign-owner" });
    await act(async () => undefined);
    harness.setBreakpoints.mockClear();
    harness.setBreakpointsActive.mockClear();
    harness.setExceptionPause.mockClear();

    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 9);
      await ui.hook().setExceptionPauseMode("all");
      expect(await ui.hook().toggleBreakpointsActivated()).toBe(false);
    });
    expect(harness.setBreakpoints).not.toHaveBeenCalled();
    expect(harness.setBreakpointsActive).not.toHaveBeenCalled();
    expect(harness.setExceptionPause).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("disables controls on the first compound terminal and returns idle after all terminate", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 41,
        seq: 1,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().debugCompoundActive).toBe(true);
    await act(async () => void (await ui.hook().pauseDebug()));
    expect(harness.pause).not.toHaveBeenCalled();

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().debugCompoundActive).toBe(false);
    ui.unmount();
  });

  it("stops a compound group through one representative and rejects restart or disconnect", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    expect(ui.hook().canRestartDebug()).toBe(false);
    await act(async () => {
      await ui.hook().restartDebug();
      await ui.hook().disconnectDebug();
      await ui.hook().stopDebug();
      await ui.hook().stopDebug();
    });
    expect(harness.disconnect).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    ui.unmount();
  });

  it("projects and coalesces an active compound Stop until settlement", async () => {
    const harness = createGateway();
    const pending = deferred<void>();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    harness.stop.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = ui.hook().stopDebug();
      second = ui.hook().stopDebug();
    });
    await act(async () => Promise.resolve());
    expect(ui.hook().debugStopPending).toBe(true);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);

    pending.resolve();
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().debugCompoundActive).toBe(false);
    ui.unmount();
  });

  it("keeps an exact compound active and retries Stop All after a transient failure", async () => {
    const harness = createGateway();
    harness.stop
      .mockRejectedValueOnce(new Error("transient stop failure"))
      .mockResolvedValueOnce(undefined);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    await act(async () => {
      await expect(ui.hook().stopDebug()).rejects.toThrow("transient stop failure");
    });
    expect(ui.hook().debugCompoundActive).toBe(true);

    await act(async () => {
      await expect(ui.hook().stopDebug()).resolves.toBeUndefined();
    });
    expect(harness.stop).toHaveBeenCalledTimes(2);
    expect(harness.stop).toHaveBeenNthCalledWith(1, 41);
    expect(harness.stop).toHaveBeenNthCalledWith(2, 41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    ui.unmount();
  });

  it("coalesces Stop while native compound start is pending and rolls back accepted IDs once", async () => {
    const harness = createGateway();
    const status = deferred<{ readonly kind: "ok"; readonly sessionIds: readonly number[] }>();
    harness.startCompound.mockReturnValueOnce(status.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let starting!: Promise<boolean>;
    let firstStop!: Promise<void>;
    let secondStop!: Promise<void>;

    act(() => {
      starting = ui.hook().startDebugCompoundAccepted(compoundMembers);
    });
    await act(async () => Promise.resolve());
    expect(ui.hook().debugCompoundStartPending).toBe(true);

    act(() => {
      firstStop = ui.hook().stopDebug();
      secondStop = ui.hook().stopDebug();
    });
    expect(ui.hook().debugStopPending).toBe(true);
    expect(harness.stop).not.toHaveBeenCalled();

    status.resolve({ kind: "ok", sessionIds: [41, 42] });
    await act(async () => {
      await Promise.all([starting, firstStop, secondStop]);
    });

    await expect(starting).resolves.toBe(false);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);
    expect(ui.hook().debugCompoundStartPending).toBe(false);
    expect(ui.hook().debugCompoundActive).toBe(false);
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().snapshot.state.kind).toBe("inactive");
    ui.unmount();
  });

  it("settles a pending compound Stop without a backend stop when native start rejects", async () => {
    const harness = createGateway();
    const status = deferred<{ readonly kind: "error"; readonly message: string }>();
    harness.startCompound.mockReturnValueOnce(status.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let starting!: Promise<boolean>;
    let stopping!: Promise<void>;

    act(() => {
      starting = ui.hook().startDebugCompoundAccepted(compoundMembers);
    });
    await act(async () => Promise.resolve());
    act(() => {
      stopping = ui.hook().stopDebug();
    });
    status.resolve({ kind: "error", message: "generic failure" });
    await act(async () => {
      await Promise.all([starting, stopping]);
    });

    await expect(starting).resolves.toBe(false);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(ui.hook().debugCompoundStartPending).toBe(false);
    expect(ui.hook().debugStopPending).toBe(false);
    ui.unmount();
  });

  it("does not project an old compound cancellation after an A-B-A owner replacement", async () => {
    const harness = createGateway();
    const status = deferred<{ readonly kind: "ok"; readonly sessionIds: readonly number[] }>();
    harness.startCompound.mockReturnValueOnce(status.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let starting!: Promise<boolean>;
    let stopping!: Promise<void>;

    act(() => {
      starting = ui.hook().startDebugCompoundAccepted(compoundMembers);
    });
    await act(async () => Promise.resolve());
    expect(ui.hook().debugCompoundStartPending).toBe(true);
    act(() => {
      stopping = ui.hook().stopDebug();
    });
    await act(async () => Promise.resolve());
    expect(ui.hook().debugStopPending).toBe(true);

    ui.set({ workspaceId: "owner-2", workspaceRoot: "/workspace/two" });
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().debugCompoundStartPending).toBe(false);
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);
    expect(ui.hook().isDebugStartBlocked()).toBe(true);
    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    expect(harness.start).not.toHaveBeenCalled();
    ui.set({ workspaceId: "owner-1", workspaceRoot: "/workspace/one" });
    expect(ui.hook().debugCompoundStartPending).toBe(false);
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);
    expect(ui.hook().isDebugStartBlocked()).toBe(true);
    expect(ui.hook().debugStopPending).toBe(false);
    expect(harness.stop).not.toHaveBeenCalled();

    status.resolve({ kind: "ok", sessionIds: [41, 42] });
    await act(async () => {
      await Promise.all([starting, stopping]);
    });
    await expect(starting).resolves.toBe(false);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(false);
    ui.unmount();
  });

  it("rolls an invalid duplicate response back once without publishing group identities", async () => {
    const harness = createGateway();
    harness.startCompound.mockResolvedValueOnce({ kind: "ok", sessionIds: [41, 41] });
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(false);
    });
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    expect(ui.hook()).not.toHaveProperty("compoundSessionIds");
    expect(ui.hook()).not.toHaveProperty("compoundLease");
    ui.unmount();
  });

  it("invalidates exact compound ownership across workspace A-B-A and unmounts once", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });
    ui.set({ workspaceId: "owner-2" });
    ui.set({ workspaceId: "owner-1" });
    await act(async () => undefined);
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(ui.hook().debugCompoundActive).toBe(false);
    ui.unmount();
    expect(harness.stop).toHaveBeenCalledTimes(1);
  });

  it("fails closed before routing a same-root event whose workspace owner is stale", async () => {
    const harness = createGateway();
    let ownerCurrent = true;
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      () => ownerCurrent,
    );
    await act(async () => {
      expect(await ui.hook().startDebugCompoundAccepted(compoundMembers)).toBe(true);
    });

    ownerCurrent = false;
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 42,
        seq: 1,
        payload: {
          kind: "stopped",
          reason: "breakpoint",
          frames: [frame],
          pauseGeneration: 1,
        },
      });
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(41);
    expect(ui.hook().debugCompoundActive).toBe(false);
    expect(ui.hook().snapshot.state.kind).toBe("terminated");
    ui.unmount();
  });

  it("rolls back once when an exact compound response arrives after unmount", async () => {
    const harness = createGateway();
    const status = deferred<{ readonly kind: "ok"; readonly sessionIds: readonly number[] }>();
    harness.startCompound.mockReturnValueOnce(status.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = ui.hook().startDebugCompoundAccepted(compoundMembers);
      await Promise.resolve();
    });
    ui.unmount();
    status.resolve({ kind: "ok", sessionIds: [41, 42] });
    await expect(pending).resolves.toBe(false);
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(41);
  });

  it("completes only for the exact current inspection owner and drops workspace A-B-A", async () => {
    const harness = createGateway();
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      (rootPath, workspaceId) => rootPath === "/workspace/one" && workspaceId === "owner-1",
    );
    await startStoppedNodeSession(ui, harness);
    const exactOwner = ui.hook().inspectionOwner!;
    harness.completions.mockResolvedValueOnce({
      items: [{ kind: "variable", label: "console" }],
      isIncomplete: false,
    });

    await expect(
      ui.hook().completeDebugConsole(exactOwner, { kind: "lexical", prefix: "co" }),
    ).resolves.toEqual({
      items: [{ kind: "variable", label: "console" }],
      isIncomplete: false,
    });
    expect(harness.completions).toHaveBeenCalledWith({
      frameId: 11,
      pauseGeneration: 1,
      query: { kind: "lexical", prefix: "co" },
      rootPath: "/workspace/one",
      sessionId: 4,
    });
    await expect(
      ui.hook().completeDebugConsole(
        { ...exactOwner, frameId: 99 },
        {
          kind: "lexical",
          prefix: "co",
        },
      ),
    ).resolves.toBeNull();
    expect(harness.completions).toHaveBeenCalledOnce();

    const pending = deferred<DebugConsoleCompletionResponse>();
    harness.completions.mockReturnValueOnce(pending.promise);
    const stale = ui.hook().completeDebugConsole(exactOwner, { kind: "lexical", prefix: "la" });
    ui.set({ workspaceId: "owner-2" });
    ui.set({ workspaceId: "owner-1" });
    pending.resolve({ items: [{ kind: "variable", label: "late" }], isIncomplete: false });
    await expect(stale).resolves.toBeNull();
    ui.unmount();
  });

  it("starts a session and transitions through debugger events", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    expect(ui.hook().isDebugStartBlocked()).toBe(false);

    await act(async () => {
      await ui.hook().startDebug(launch);
    });

    expect(harness.start).toHaveBeenCalledWith("/workspace/one", launch, [], "none", [], []);
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    expect(ui.hook().isDebugStartBlocked()).toBe(true);

    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({
      kind: "stopped",
      sessionId: 4,
      reason: "breakpoint",
      frames: [frame],
      topFrame: frame,
    });

    await act(async () => {
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
    expect(ui.hook().isDebugStartBlocked()).toBe(false);
    ui.unmount();
  });

  it("installs the captured function-breakpoint snapshot only once during a fast start", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "fast-start-owner");
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.startServer")).toBe(true);
      await ui.hook().startDebug(launch);
    });

    expect(harness.start).toHaveBeenCalledWith(
      "/workspace/one",
      launch,
      [],
      "none",
      [],
      [
        expect.objectContaining({
          enabled: true,
          functionName: "globalThis.startServer",
        }),
      ],
    );
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("replays the exact startup function-breakpoint receipt and later generation-one upgrades", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(
      async (_rootPath, _launch, _lines, _mode, _filter, list) => {
        const breakpoints = list ?? [];
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 99,
          seq: 1,
          payload: {
            kind: "functionBreakpointsVerified",
            generation: 1,
            breakpoints: breakpoints.map(({ id }) => ({ id, verified: true })),
          },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: {
            kind: "functionBreakpointsVerified",
            generation: 1,
            breakpoints: breakpoints.map(({ id }, index) => ({ id, verified: index === 0 })),
          },
        });
        return { kind: "ok", sessionId: 4 };
      },
    );
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "startup-receipt-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.immediate")).toBe(true);
      expect(await ui.hook().addFunctionBreakpoint("globalThis.late")).toBe(true);
      await ui.hook().startDebug(launch);
    });

    expect(ui.hook().functionBreakpoints.map(({ verified }) => verified)).toEqual([true, false]);
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    const lateId = ui.hook().functionBreakpoints[1]?.id ?? "";
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 1,
          breakpoints: [{ id: lateId, verified: true }],
        },
      });
    });
    expect(ui.hook().functionBreakpoints.map(({ verified }) => verified)).toEqual([true, true]);
    ui.unmount();
  });

  it("rejects a partial startup verification that precedes the exact full receipt", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(
      async (_rootPath, _launch, _lines, _mode, _filter, list) => {
        const breakpoints = list ?? [];
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: {
            kind: "functionBreakpointsVerified",
            generation: 1,
            breakpoints: breakpoints.slice(0, 1).map(({ id }) => ({ id, verified: true })),
          },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 2,
          payload: {
            kind: "functionBreakpointsVerified",
            generation: 1,
            breakpoints: breakpoints.map(({ id }) => ({ id, verified: true })),
          },
        });
        return { kind: "ok", sessionId: 4 };
      },
    );
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "partial-before-full-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.first")).toBe(true);
      expect(await ui.hook().addFunctionBreakpoint("globalThis.second")).toBe(true);
      await ui.hook().startDebug(launch);
    });

    expect(ui.hook().functionBreakpoints.map(({ verified }) => verified)).toEqual([false, false]);
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed when the bounded startup-verification receipt queue overflows", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(
      async (_rootPath, _launch, _lines, _mode, _filter, list) => {
        const breakpoints = list ?? [];
        for (let seq = 1; seq <= 33; seq += 1) {
          harness.emit({
            rootPath: "/workspace/one",
            sessionId: 4,
            seq,
            payload: {
              kind: "functionBreakpointsVerified",
              generation: 1,
              breakpoints: breakpoints.map(({ id }) => ({ id, verified: true })),
            },
          });
        }
        return { kind: "ok", sessionId: 4 };
      },
    );
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "overflow-receipt-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.overflow")).toBe(true);
      await ui.hook().startDebug(launch);
    });

    expect(ui.hook().functionBreakpoints[0]?.verified).not.toBe(true);
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    const id = ui.hook().functionBreakpoints[0]?.id ?? "";
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 34,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 1,
          breakpoints: [{ id, verified: true }],
        },
      });
    });
    expect(ui.hook().functionBreakpoints[0]?.verified).not.toBe(true);
    ui.unmount();
  });

  it("rejects verification older than a lifecycle event replayed during start", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(
      async (_rootPath, _launch, _lines, _mode, _filter, list) => {
        const breakpoints = list ?? [];
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: {
            kind: "functionBreakpointsVerified",
            generation: 1,
            breakpoints: breakpoints.map(({ id }) => ({ id, verified: false })),
          },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 10,
          payload: { kind: "started", sessionId: 4 },
        });
        return { kind: "ok", sessionId: 4 };
      },
    );
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "lifecycle-sequence-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.sequence")).toBe(true);
      await ui.hook().startDebug(launch);
    });
    const id = ui.hook().functionBreakpoints[0]?.id ?? "";

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 9,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 1,
          breakpoints: [{ id, verified: true }],
        },
      });
    });

    expect(ui.hook().functionBreakpoints[0]?.verified).toBe(false);
    ui.unmount();
  });

  it("rejects a buffered startup verification after an A-B-A workspace replacement", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "receipt-owner-a");
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.stale")).toBe(true);
    });
    const id = ui.hook().functionBreakpoints[0]?.id ?? "";
    let pending!: Promise<void>;
    act(() => {
      pending = ui.hook().startDebug(launch);
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: {
          kind: "functionBreakpointsVerified",
          generation: 1,
          breakpoints: [{ id, verified: true }],
        },
      });
    });
    ui.set({ workspaceId: "receipt-owner-b" });
    ui.set({ workspaceId: "receipt-owner-a" });
    await act(async () => {
      startResult.resolve({ kind: "ok", sessionId: 4 });
      await pending;
    });

    expect(ui.hook().functionBreakpoints).toEqual([expect.objectContaining({ id })]);
    expect(ui.hook().functionBreakpoints[0]?.verified).not.toBe(true);
    expect(harness.setFunctionBreakpoints).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("synchronizes the exact latest function-breakpoint snapshot when it changes during start", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "changed-start-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.first")).toBe(true);
    });

    let pending!: Promise<void>;
    act(() => {
      pending = ui.hook().startDebug(launch);
    });
    expect(harness.start.mock.calls[0]?.[5]).toEqual([
      expect.objectContaining({ functionName: "globalThis.first" }),
    ]);

    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.latest")).toBe(true);
      startResult.resolve({ kind: "ok", sessionId: 4 });
      await pending;
    });

    expect(harness.setFunctionBreakpoints).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      generation: 2,
      breakpoints: [
        expect.objectContaining({ functionName: "globalThis.first" }),
        expect.objectContaining({ functionName: "globalThis.latest" }),
      ],
    });
    ui.unmount();
  });

  it("compensates and rejects a start when the changed snapshot cannot be synchronized", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    harness.setFunctionBreakpoints.mockRejectedValueOnce(new Error("rejected"));
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "rejected-start-sync-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.first")).toBe(true);
    });

    let accepted: number | null = 4;
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugSessionAccepted(launch);
    });
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.latest")).toBe(true);
      startResult.resolve({ kind: "ok", sessionId: 4 });
      accepted = await pending;
    });

    expect(accepted).toBeNull();
    expect(harness.setFunctionBreakpoints).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ generation: 2, sessionId: 4 }),
    );
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    ui.unmount();
  });

  it("resynchronizes after an A-B-A function-breakpoint edit during start", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "aba-start-owner");
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.same")).toBe(true);
    });
    const id = ui.hook().functionBreakpoints[0]?.id ?? "";

    let pending!: Promise<void>;
    act(() => {
      pending = ui.hook().startDebug(launch);
    });
    await act(async () => {
      expect(await ui.hook().setFunctionBreakpointEnabled(id, false)).toBe(true);
      expect(await ui.hook().setFunctionBreakpointEnabled(id, true)).toBe(true);
      startResult.resolve({ kind: "ok", sessionId: 4 });
      await pending;
    });

    expect(harness.setFunctionBreakpoints).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      generation: 2,
      breakpoints: [
        expect.objectContaining({
          enabled: true,
          functionName: "globalThis.same",
          id,
        }),
      ],
    });
    ui.unmount();
  });

  it("keeps a per-workspace Node exception preference and forces PHP starts to none", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => void (await ui.hook().setExceptionPauseMode("all")));
    await act(async () => void (await ui.hook().setExceptionTypeFilter(["TypeError"])));
    expect(harness.setExceptionPause).not.toHaveBeenCalled();
    await act(async () => void (await ui.hook().startDebug(launch)));
    expect(harness.start).toHaveBeenLastCalledWith(
      "/workspace/one",
      launch,
      [],
      "all",
      ["TypeError"],
      [],
    );
    expect(ui.hook().debugAdapterKind).toBe("node");

    ui.set({ workspaceRoot: "/workspace/two" });
    await act(async () => void (await ui.hook().setExceptionPauseMode("all")));
    const phpLaunch = { kind: "php-script", scriptPath: "/workspace/two/index.php" } as const;
    await act(async () => void (await ui.hook().startDebug(phpLaunch)));
    expect(harness.start).toHaveBeenLastCalledWith("/workspace/two", phpLaunch, [], "none", [], []);
    expect(ui.hook().debugAdapterKind).toBe("php");

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().exceptionPauseMode).toBe("all");
    expect(ui.hook().debugAdapterKind).toBe("node");
    ui.unmount();
  });

  it("sends a stored exception filter to a supporting native watch descriptor", async () => {
    const harness = createGateway();
    const start = vi.fn(async () => ({ kind: "ok" as const, sessionId: 19 }));
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start,
    };
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => void (await ui.hook().setExceptionPauseMode("all")));
    await act(async () => void (await ui.hook().setExceptionTypeFilter(["TypeError"])));
    await act(async () => {
      await ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });

    expect(start).toHaveBeenCalledExactlyOnceWith("/workspace/one", [], "all", ["TypeError"], []);
    ui.unmount();
  });

  it("keeps the selected preference when a live Node update fails", async () => {
    const harness = createGateway();
    harness.setExceptionPause.mockRejectedValueOnce(new Error("CDP rejected pause policy"));
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, true);
    await act(async () => void (await ui.hook().startDebug(launch)));
    await act(async () => void (await ui.hook().setExceptionPauseMode("uncaught")));
    expect(harness.setExceptionPause).toHaveBeenCalledWith("/workspace/one", 4, "uncaught");
    expect(ui.hook().exceptionPauseMode).toBe("uncaught");
    expect(ui.hook().exceptionPauseError).toBe("CDP rejected pause policy");
    expect(ui.hook().exceptionPausePending).toBe(false);
    ui.unmount();
  });

  it("drops stale live-toggle failures after root and session changes", async () => {
    const harness = createGateway();
    let rejectRootRequest!: (error: Error) => void;
    harness.setExceptionPause.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRootRequest = reject;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => void (await ui.hook().startDebug(launch)));
    let rootRequest!: Promise<void>;
    act(() => {
      rootRequest = ui.hook().setExceptionPauseMode("all");
    });
    expect(ui.hook().exceptionPausePending).toBe(true);
    ui.set({ workspaceRoot: "/workspace/two" });
    await act(async () => {
      rejectRootRequest(new Error("stale root failure"));
      await rootRequest;
    });
    expect(ui.hook().exceptionPauseError).toBeNull();
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().exceptionPauseError).toBeNull();
    expect(ui.hook().exceptionPausePending).toBe(false);

    let rejectSessionRequest!: (error: Error) => void;
    harness.setExceptionPause.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSessionRequest = reject;
        }),
    );
    let sessionRequest!: Promise<void>;
    act(() => {
      sessionRequest = ui.hook().setExceptionPauseMode("uncaught");
    });
    harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    await act(async () => void (await ui.hook().startDebug(launch)));
    await act(async () => {
      rejectSessionRequest(new Error("stale session failure"));
      await sessionRequest;
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().exceptionPauseMode).toBe("uncaught");
    expect(ui.hook().exceptionPauseError).toBeNull();
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
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
    expect(ui.hook().lastStartError).toBe("Install a Node.js runtime to debug.");
    ui.unmount();
  });

  it("routes background lifecycle state without leaking output across a replaced workspace epoch", async () => {
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
        payload: {
          kind: "output",
          stream: "stdout",
          text: "background",
          truncated: false,
        },
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
    expect(ui.hook().output).toEqual([]);
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
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } = { resolve: null };
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
    expect(ui.hook().debugStartPending).toBe(true);
    expect(ui.hook().isDebugStartBlocked()).toBe(true);
    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 4 });
      await first;
      await second;
    });

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    ui.unmount();
  });

  it("adopts an atomically superseded session without a redundant stop and clears old output", async () => {
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
        payload: { kind: "output", stream: "stdout", text: "old", truncated: false },
      });
    });
    await flushDebugOutputBatch();
    expect(ui.hook().output).toHaveLength(1);

    await act(async () => {
      await ui.hook().startDebug(launch);
    });

    expect(harness.stop).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("restarts the exact accepted Node launch without retaining caller mutations", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    const ui = renderHook(harness.gateway, "/workspace/one");
    const configuredLaunch: DebugLaunchTarget = {
      kind: "node-configured-script",
      scriptPath: "/workspace/one/index.js",
      args: ["--mode", "safe"],
      cwd: "/workspace/one",
      env: { TOKEN: "accepted" },
    };

    await act(async () => ui.hook().startDebug(configuredLaunch));
    expect(harness.start.mock.calls[0]?.[1]).toBe(configuredLaunch);
    configuredLaunch.args.push("--mutated");
    configuredLaunch.env.TOKEN = "mutated";
    expect(ui.hook().canRestartDebug()).toBe(true);

    await act(async () => ui.hook().restartDebug());

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(harness.start).toHaveBeenNthCalledWith(
      2,
      "/workspace/one",
      {
        kind: "node-configured-script",
        scriptPath: "/workspace/one/index.js",
        args: ["--mode", "safe"],
        cwd: "/workspace/one",
        env: { TOKEN: "accepted" },
      },
      [],
      "none",
      [],
      [],
    );
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().debugRestartPending).toBe(false);
    expect(ui.hook().canRestartDebug()).toBe(true);
    ui.unmount();
  });

  it("queues a function-breakpoint edit made during replacement-start synchronization", async () => {
    const harness = createGateway();
    const replacementStart = deferred<DebugRuntimeStatus>();
    const firstSync = deferred<readonly { readonly id: string; readonly verified: boolean }[]>();
    const secondSync = deferred<readonly { readonly id: string; readonly verified: boolean }[]>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replacementStart.promise);
    harness.setFunctionBreakpoints
      .mockReturnValueOnce(firstSync.promise)
      .mockReturnValueOnce(secondSync.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "restart-sync-edit-owner",
    );
    await act(async () => {
      expect(await ui.hook().addFunctionBreakpoint("globalThis.initial")).toBe(true);
      await ui.hook().startDebug(launch);
    });
    harness.setFunctionBreakpoints.mockClear();

    let restart!: Promise<void>;
    act(() => {
      restart = ui.hook().restartDebug();
    });
    await act(async () => {
      await Promise.resolve();
      expect(await ui.hook().addFunctionBreakpoint("globalThis.beforeSync")).toBe(true);
      replacementStart.resolve({ kind: "ok", sessionId: 9 });
      await Promise.resolve();
    });
    expect(harness.setFunctionBreakpoints).toHaveBeenCalledTimes(1);
    expect(harness.setFunctionBreakpoints.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        generation: 2,
        sessionId: 9,
        breakpoints: [
          expect.objectContaining({ functionName: "globalThis.initial" }),
          expect.objectContaining({ functionName: "globalThis.beforeSync" }),
        ],
      }),
    );

    let edit!: Promise<boolean>;
    act(() => {
      edit = ui.hook().addFunctionBreakpoint("globalThis.duringSync");
    });
    await act(async () => {
      firstSync.resolve([]);
      await Promise.resolve();
    });
    expect(harness.setFunctionBreakpoints).toHaveBeenCalledTimes(2);
    expect(harness.setFunctionBreakpoints.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        generation: 3,
        sessionId: 9,
        breakpoints: [
          expect.objectContaining({ functionName: "globalThis.initial" }),
          expect.objectContaining({ functionName: "globalThis.beforeSync" }),
          expect.objectContaining({ functionName: "globalThis.duringSync" }),
        ],
      }),
    );
    await act(async () => {
      secondSync.resolve([]);
      await expect(edit).resolves.toBe(true);
      await restart;
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    ui.unmount();
  });

  it("keeps an initial session terminated when it exits before start resolves", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(async () => {
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
        payload: { kind: "terminated", exitCode: 0 },
      });
      return { kind: "ok", sessionId: 4 };
    });
    const retain = vi.spyOn(DebugRestartCoordinator.prototype, "retain");
    const ui = renderHook(harness.gateway, "/workspace/one");

    let accepted = true;
    await act(async () => {
      accepted = await ui.hook().startDebugAccepted(launch);
    });

    expect(accepted).toBe(false);
    expect(ui.hook().snapshot.state).toEqual({ kind: "terminated", sessionId: 4, exitCode: 0 });
    expect(ui.hook().canRestartDebug()).toBe(false);
    expect(retain).not.toHaveBeenCalled();
    retain.mockRestore();
    ui.unmount();
  });

  it("returns the exact accepted session identity for post-debug lifecycle ownership", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");

    let sessionId: number | null = null;
    await act(async () => {
      sessionId = await ui.hook().startDebugSessionAccepted(launch);
    });

    expect(sessionId).toBe(4);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    ui.unmount();
  });

  it("accepts a candidate attach through the shared lifecycle with Node policy and ownership", async () => {
    const harness = createGateway();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockImplementation(async () => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 23,
          seq: 1,
          payload: { kind: "started", sessionId: 23 },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 23,
          seq: 2,
          payload: {
            kind: "stopped",
            reason: "breakpoint",
            frames: [frame],
            pauseGeneration: 1,
          },
        });
        return { kind: "ok", sessionId: 23 };
      });
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      undefined,
      { start: candidateStart },
    );
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "node",
          filePath: "/workspace/one/index.js",
          lineNumber: 4,
          enabled: true,
        },
        {
          id: "php",
          filePath: "/workspace/one/index.php",
          lineNumber: 5,
          enabled: true,
        },
      ]);
      await ui.hook().setExceptionPauseMode("all");
      await ui.hook().setExceptionTypeFilter(["TypeError"]);
      expect(await ui.hook().addFunctionBreakpoint("globalThis.attached")).toBe(true);
    });

    let accepted: number | null = null;
    await act(async () => {
      accepted = await ui
        .hook()
        .startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef");
    });

    expect(accepted).toBe(23);
    expect(candidateStart).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      candidateLeaseId: "0123456789abcdef0123456789abcdef",
      breakpoints: [
        expect.objectContaining({
          id: "node",
          filePath: "/workspace/one/index.js",
        }),
      ],
      exceptionPauseMode: "all",
      exceptionTypeFilter: ["TypeError"],
    });
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.setFunctionBreakpoints).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 23,
      generation: 2,
      breakpoints: [
        expect.objectContaining({
          functionName: "globalThis.attached",
        }),
      ],
    });
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "stopped",
      sessionId: 23,
      topFrame: frame,
    });
    expect(ui.hook().debugAdapterKind).toBe("node");
    expect(ui.hook().debugSessionAttached).toBe(true);

    await act(async () => void (await ui.hook().disconnectDebug()));
    expect(harness.disconnect).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 23,
    });
    ui.unmount();
  });

  it("stops a candidate session whose owner becomes stale before acceptance", async () => {
    const harness = createGateway();
    const result = deferred<DebugRuntimeStatus>();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockReturnValue(result.promise);
    let owner = "owner-1";
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      owner,
      (_rootPath, workspaceId) => workspaceId === owner,
      { start: candidateStart },
    );
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef");
    });
    owner = "owner-2";
    ui.set({ workspaceId: owner });

    await act(async () => {
      result.resolve({ kind: "ok", sessionId: 23 });
      expect(await pending).toBeNull();
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(23);
    expect(harness.start).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("honors a stop requested while candidate attach is still pending", async () => {
    const harness = createGateway();
    const result = deferred<DebugRuntimeStatus>();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockReturnValue(result.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      undefined,
      { start: candidateStart },
    );
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef");
    });
    await act(async () => void (await ui.hook().stopDebug()));

    await act(async () => {
      result.resolve({ kind: "ok", sessionId: 23 });
      expect(await pending).toBeNull();
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(23);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("projects candidate start errors without adopting a session", async () => {
    const harness = createGateway();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockResolvedValue({ kind: "error", message: "Candidate attach failed." });
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      undefined,
      { start: candidateStart },
    );

    await act(async () => {
      expect(
        await ui.hook().startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef"),
      ).toBeNull();
    });

    expect(ui.hook().lastStartError).toBe("Candidate attach failed.");
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(harness.start).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("shares the pending start gate between candidate and legacy starts", async () => {
    const harness = createGateway();
    const result = deferred<DebugRuntimeStatus>();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockReturnValue(result.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      undefined,
      { start: candidateStart },
    );
    let candidate!: Promise<number | null>;
    let legacy!: Promise<boolean>;
    act(() => {
      candidate = ui.hook().startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef");
      legacy = ui.hook().startDebugAccepted(launch);
    });
    await expect(legacy).resolves.toBe(false);
    expect(harness.start).not.toHaveBeenCalled();

    await act(async () => {
      result.resolve({ kind: "ok", sessionId: 23 });
      expect(await candidate).toBe(23);
    });
    expect(candidateStart).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("never retains or replays a consumed candidate capability for restart", async () => {
    const harness = createGateway();
    const candidateStart = vi
      .fn<NodeDebugAttachCandidateStartPort["start"]>()
      .mockResolvedValue({ kind: "ok", sessionId: 23 });
    const retain = vi.spyOn(DebugRestartCoordinator.prototype, "retain");
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
      undefined,
      { start: candidateStart },
    );
    await act(async () => {
      expect(
        await ui.hook().startNodeAttachCandidateAccepted("0123456789abcdef0123456789abcdef"),
      ).toBe(23);
    });

    expect(retain).not.toHaveBeenCalled();
    expect(ui.hook().canRestartDebug()).toBe(false);
    await act(async () => void (await ui.hook().restartDebug()));
    expect(candidateStart).toHaveBeenCalledTimes(1);
    expect(harness.start).not.toHaveBeenCalled();
    retain.mockRestore();
    ui.unmount();
  });

  it("returns an early terminated session identity only through the lifecycle-aware start seam", async () => {
    const harness = createGateway();
    harness.start.mockImplementationOnce(async () => {
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
        payload: { kind: "terminated", exitCode: 0 },
      });
      return { kind: "ok", sessionId: 4 };
    });
    const ui = renderHook(harness.gateway, "/workspace/one");

    let sessionId: number | null = null;
    await act(async () => {
      sessionId = await ui.hook().startDebugSessionAccepted(launch);
    });

    expect(sessionId).toBe(4);
    expect(ui.hook().snapshot.state).toEqual({
      kind: "terminated",
      sessionId: 4,
      exitCode: 0,
    });
    ui.unmount();
  });

  it("preserves an early replay termination instead of synthesizing a ghost session", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockImplementationOnce(async () => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 9,
          seq: 1,
          payload: { kind: "started", sessionId: 9 },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 9,
          seq: 2,
          payload: { kind: "terminated", exitCode: 7 },
        });
        return { kind: "ok", sessionId: 9 };
      });
    const release = vi.spyOn(DebugRestartCoordinator.prototype, "release");
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    await act(async () => ui.hook().restartDebug());

    expect(ui.hook().snapshot.state).toEqual({ kind: "terminated", sessionId: 9, exitCode: 7 });
    expect(ui.hook().canRestartDebug()).toBe(false);
    expect(release).toHaveBeenCalledWith("/workspace/one", 4);
    release.mockRestore();
    ui.unmount();
  });

  it("coalesces concurrent restarts into one stop and one replacement start", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = ui.hook().restartDebug();
      second = ui.hook().restartDebug();
    });
    expect(ui.hook().debugRestartPending).toBe(true);
    expect(ui.hook().canRestartDebug()).toBe(false);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);

    await act(async () => {
      stopped.resolve();
      await Promise.all([first, second]);
    });
    expect(harness.start).toHaveBeenCalledTimes(2);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    ui.unmount();
  });

  it("lets an explicit stop cancel an in-flight restart without stopping twice", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 4 });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    const restart = ui.hook().restartDebug();
    const stop = ui.hook().stopDebug();
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);

    await act(async () => {
      stopped.resolve();
      await Promise.all([restart, stop]);
    });
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    expect(ui.hook().debugRestartPending).toBe(false);
    ui.unmount();
  });

  it("ends only the exact requested debug session and reports whether it was confirmed", async () => {
    const harness = createGateway();
    harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 4 });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    let staleResult!: boolean;
    await act(async () => {
      staleResult = await ui.hook().stopExactDebugSession(9);
    });
    expect(staleResult).toBe(false);
    expect(harness.stop).not.toHaveBeenCalled();

    let exactResult!: boolean;
    await act(async () => {
      exactResult = await ui.hook().stopExactDebugSession(4);
    });
    expect(exactResult).toBe(true);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    ui.unmount();
  });

  it("propagates an exact session-end failure without finalizing the retained session", async () => {
    const harness = createGateway();
    harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 4 });
    harness.stop.mockRejectedValueOnce(new Error("stop failed"));
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    await act(async () => {
      await expect(ui.hook().stopExactDebugSession(4)).rejects.toThrow("stop failed");
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    ui.unmount();
  });

  it("blocks pause and stepping while a restart stop is pending", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    const restart = ui.hook().restartDebug();
    await act(async () => {
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
    });

    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);

    await act(async () => {
      stopped.resolve();
      await restart;
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    ui.unmount();
  });

  it("coalesces an active stop, gates start and restart, and releases restart before its event", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.stop.mockReturnValueOnce(stopped.promise);
    const release = vi.spyOn(DebugRestartCoordinator.prototype, "release");
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        payload: {
          frames: [frame],
          kind: "stopped",
          pauseGeneration: 7,
          reason: "pause",
        },
        rootPath: "/workspace/one",
        seq: 1,
        sessionId: 4,
      });
    });
    expect(ui.hook().pauseGeneration).toBe(7);
    expect(ui.hook().inspectionOwner).toMatchObject({ sessionId: 4, frameId: 11 });
    expect(ui.hook().canRestartDebug()).toBe(true);

    let firstStop!: Promise<void>;
    let secondStop!: Promise<void>;
    let blockedStart!: Promise<void>;
    let blockedRestart!: Promise<void>;
    act(() => {
      firstStop = ui.hook().stopDebug();
      secondStop = ui.hook().stopDebug();
      blockedStart = ui.hook().startDebug(launch);
      blockedRestart = ui.hook().restartDebug();
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(ui.hook().debugStopPending).toBe(true);
    expect(ui.hook().canRestartDebug()).toBe(false);

    await act(async () => {
      stopped.resolve();
      await Promise.all([firstStop, secondStop, blockedStart, blockedRestart]);
    });

    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("/workspace/one", 4);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    expect(ui.hook().pauseGeneration).toBe(0);
    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().inspectionOwner).toBeNull();
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().canRestartDebug()).toBe(false);

    await act(async () => ui.hook().stopDebug());
    expect(harness.stop).toHaveBeenCalledTimes(1);

    act(() => {
      harness.emit({
        payload: { exitCode: 0, kind: "terminated" },
        rootPath: "/workspace/one",
        seq: 1,
        sessionId: 4,
      });
    });
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    release.mockRestore();
    ui.unmount();
  });

  it("keeps start blocked when termination arrives before an explicit stop response", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    let stop!: Promise<void>;
    act(() => {
      stop = ui.hook().stopDebug();
    });
    act(() => {
      harness.emit({
        payload: { exitCode: 0, kind: "terminated" },
        rootPath: "/workspace/one",
        seq: 1,
        sessionId: 4,
      });
    });

    expect(ui.hook().snapshot.state).toEqual({
      exitCode: 0,
      kind: "terminated",
      sessionId: 4,
    });
    expect(ui.hook().isDebugStartBlocked()).toBe(true);

    await act(async () => {
      stopped.resolve();
      await stop;
    });

    expect(ui.hook().isDebugStartBlocked()).toBe(false);
    ui.unmount();
  });

  it("disconnects only an exact accepted Node attach and keeps failures retryable", async () => {
    const harness = createGateway();
    harness.disconnect
      .mockRejectedValueOnce(new Error("disconnect failed"))
      .mockResolvedValueOnce(undefined);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().startDebug({ kind: "node-attach", port: 9229 });
    });

    expect(ui.hook().debugSessionAttached).toBe(true);
    await act(async () => {
      await expect(ui.hook().disconnectDebug()).rejects.toThrow("disconnect failed");
    });
    expect(ui.hook().debugSessionAttached).toBe(true);
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });

    await act(async () => ui.hook().disconnectDebug());
    expect(harness.disconnect).toHaveBeenNthCalledWith(1, {
      rootPath: "/workspace/one",
      sessionId: 4,
    });
    expect(harness.disconnect).toHaveBeenNthCalledWith(2, {
      rootPath: "/workspace/one",
      sessionId: 4,
    });
    expect(harness.stop).not.toHaveBeenCalled();
    expect(ui.hook().debugSessionAttached).toBe(false);
    expect(ui.hook().snapshot.state).toMatchObject({ kind: "terminated", sessionId: 4 });
    ui.unmount();
  });

  it("keeps a not-yet-accepted attach on Stop until its start response resolves", async () => {
    const harness = createGateway();
    const starting = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(starting.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let start!: Promise<void>;
    act(() => {
      start = ui.hook().startDebug({ kind: "node-attach", port: 9229 });
    });
    act(() => {
      harness.emit({
        payload: { kind: "started", sessionId: 4 },
        rootPath: "/workspace/one",
        seq: 1,
        sessionId: 4,
      });
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 4 });
    expect(ui.hook().debugSessionAttached).toBe(false);
    await act(async () => ui.hook().disconnectDebug());
    expect(harness.disconnect).not.toHaveBeenCalled();

    let stop!: Promise<void>;
    act(() => {
      stop = ui.hook().stopDebug();
    });
    await act(async () => {
      starting.resolve({ kind: "ok", sessionId: 4 });
      await Promise.all([start, stop]);
    });
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    expect(harness.disconnect).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("does not let a stale attach termination clear a replacement launch owner", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => ui.hook().startDebug({ kind: "node-attach", port: 9229 }));
    expect(ui.hook().debugSessionAttached).toBe(true);
    await act(async () => ui.hook().startDebug(launch));
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().debugSessionAttached).toBe(false);

    act(() => {
      harness.emit({
        payload: { exitCode: null, kind: "terminated" },
        rootPath: "/workspace/one",
        seq: 2,
        sessionId: 4,
      });
    });
    await act(async () => ui.hook().disconnectDebug());
    expect(harness.disconnect).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    ui.unmount();
  });

  it("keeps start blocked when termination arrives before a restart stop response", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "unavailable", message: "runtime unavailable" });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));

    let restart!: Promise<void>;
    act(() => {
      restart = ui.hook().restartDebug();
    });
    act(() => {
      harness.emit({
        payload: { exitCode: 0, kind: "terminated" },
        rootPath: "/workspace/one",
        seq: 1,
        sessionId: 4,
      });
    });

    expect(ui.hook().snapshot.state).toEqual({
      exitCode: 0,
      kind: "terminated",
      sessionId: 4,
    });
    expect(ui.hook().isDebugStartBlocked()).toBe(true);

    await act(async () => {
      stopped.resolve();
      await restart;
    });

    expect(harness.start).toHaveBeenCalledTimes(2);
    expect(ui.hook().isDebugStartBlocked()).toBe(false);
    ui.unmount();
  });

  it("lets an explicit stop cancel a pending replay and stops only the accepted replacement", async () => {
    const harness = createGateway();
    const replay = deferred<DebugRuntimeStatus>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replay.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();
    await act(async () => Promise.resolve());
    expect(harness.start).toHaveBeenCalledTimes(2);

    const explicitStop = ui.hook().stopDebug();
    await act(async () => {
      replay.resolve({ kind: "ok", sessionId: 9 });
      await Promise.all([restart, explicitStop]);
    });

    expect(harness.stop.mock.calls).toEqual([[4], [9]]);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 9,
    });
    expect(ui.hook().debugRestartPending).toBe(false);
    ui.unmount();
  });

  it("does not double-stop a replacement accepted just before explicit cancellation", async () => {
    const harness = createGateway();
    const replay = deferred<DebugRuntimeStatus>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replay.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();
    await act(async () => Promise.resolve());

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 9,
        seq: 1,
        payload: { kind: "started", sessionId: 9 },
      });
      replay.resolve({ kind: "ok", sessionId: 9 });
    });
    const explicitStop = ui.hook().stopDebug();
    await act(async () => Promise.all([restart, explicitStop]));

    expect(harness.stop.mock.calls).toEqual([[4], [9]]);
    expect(ui.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 9,
    });
    ui.unmount();
  });

  it.each(["unavailable", "throw"] as const)(
    "releases the stopped owner when replay returns %s",
    async (failure) => {
      const harness = createGateway();
      harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 4 });
      if (failure === "unavailable") {
        harness.start.mockResolvedValueOnce({ kind: "unavailable", message: "runtime missing" });
      } else {
        harness.start.mockRejectedValueOnce(new Error("replay failed"));
      }
      const release = vi.spyOn(DebugRestartCoordinator.prototype, "release");
      const ui = renderHook(harness.gateway, "/workspace/one");
      await act(async () => ui.hook().startDebug(launch));

      await act(async () => {
        const restart = ui.hook().restartDebug();
        if (failure === "throw") await expect(restart).rejects.toThrow("replay failed");
        else await restart;
      });

      expect(release).toHaveBeenCalledWith("/workspace/one", 4);
      expect(ui.hook().snapshot.state).toEqual({
        exitCode: null,
        kind: "terminated",
        sessionId: 4,
      });
      expect(ui.hook().debugRestartPending).toBe(false);
      release.mockRestore();
      ui.unmount();
    },
  );

  it("never starts a replacement when stop fails or restart ownership becomes stale", async () => {
    const failedHarness = createGateway();
    failedHarness.stop.mockRejectedValueOnce(new Error("stop failed"));
    const failedUi = renderHook(failedHarness.gateway, "/workspace/one");
    await act(async () => failedUi.hook().startDebug(launch));
    await act(async () => {
      await expect(failedUi.hook().restartDebug()).rejects.toThrow("stop failed");
    });
    expect(failedHarness.start).toHaveBeenCalledTimes(1);
    expect(failedUi.hook().debugRestartPending).toBe(false);
    failedUi.unmount();

    const staleHarness = createGateway();
    const stopped = deferred<void>();
    staleHarness.stop.mockReturnValueOnce(stopped.promise);
    const staleUi = renderHook(staleHarness.gateway, "/workspace/one");
    await act(async () => staleUi.hook().startDebug(launch));
    let restart!: Promise<void>;
    act(() => {
      restart = staleUi.hook().restartDebug();
    });
    staleUi.set({ workspaceRoot: "/workspace/two" });
    await act(async () => {
      stopped.resolve();
      await restart;
    });
    expect(staleHarness.start).toHaveBeenCalledTimes(1);
    staleUi.set({ workspaceRoot: "/workspace/one" });
    expect(staleUi.hook().snapshot.state).toEqual({
      exitCode: null,
      kind: "terminated",
      sessionId: 4,
    });
    staleUi.unmount();
  });

  it("rechecks trust and mount ownership after the old session stops", async () => {
    const untrustedHarness = createGateway();
    const untrustedStop = deferred<void>();
    let trusted = true;
    untrustedHarness.stop.mockReturnValueOnce(untrustedStop.promise);
    const untrustedUi = renderHook(untrustedHarness.gateway, "/workspace/one", () => trusted);
    await act(async () => untrustedUi.hook().startDebug(launch));
    let untrustedRestart!: Promise<void>;
    act(() => {
      untrustedRestart = untrustedUi.hook().restartDebug();
    });
    trusted = false;
    await act(async () => {
      untrustedStop.resolve();
      await untrustedRestart;
    });
    expect(untrustedHarness.start).toHaveBeenCalledTimes(1);
    untrustedUi.unmount();

    const unmountedHarness = createGateway();
    const unmountedStop = deferred<void>();
    unmountedHarness.stop.mockReturnValueOnce(unmountedStop.promise);
    const unmountedUi = renderHook(unmountedHarness.gateway, "/workspace/one");
    await act(async () => unmountedUi.hook().startDebug(launch));
    const unmountedRestart = unmountedUi.hook().restartDebug();
    unmountedUi.unmount();
    unmountedStop.resolve();
    await unmountedRestart;
    expect(unmountedHarness.start).toHaveBeenCalledTimes(1);
  });

  it.each(["root", "trust", "unmount"] as const)(
    "releases the stopped restart owner after %s ownership drift",
    async (drift) => {
      const harness = createGateway();
      const stopped = deferred<void>();
      let trusted = true;
      harness.stop.mockReturnValueOnce(stopped.promise);
      const release = vi.spyOn(DebugRestartCoordinator.prototype, "release");
      const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);
      await act(async () => ui.hook().startDebug(launch));
      const restart = ui.hook().restartDebug();
      act(() => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: { kind: "terminated", exitCode: 0 },
        });
      });

      if (drift === "root") ui.set({ workspaceRoot: "/workspace/two" });
      else if (drift === "trust") trusted = false;
      else ui.unmount();
      await act(async () => {
        stopped.resolve();
        await restart;
      });

      expect(harness.start).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith("/workspace/one", 4);
      release.mockRestore();
      if (drift !== "unmount") ui.unmount();
    },
  );

  it("blocks an ordinary start while restart owns the session", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();

    await act(async () => ui.hook().startDebug(launch));
    expect(harness.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      stopped.resolve();
      await restart;
    });
    expect(harness.start).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("keeps the restart lease across the old termination event and releases natural exits", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    await act(async () => {
      stopped.resolve();
      await restart;
    });
    expect(harness.start).toHaveBeenCalledTimes(2);
    expect(ui.hook().canRestartDebug()).toBe(true);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 9,
        seq: 1,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().canRestartDebug()).toBe(false);
    ui.unmount();
  });

  it("stops an accepted replay that becomes untrusted before start resolves", async () => {
    const harness = createGateway();
    const replay = deferred<DebugRuntimeStatus>();
    let trusted = true;
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replay.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();
    await act(async () => {
      await Promise.resolve();
    });
    expect(harness.start).toHaveBeenCalledTimes(2);
    trusted = false;
    await act(async () => {
      replay.resolve({ kind: "ok", sessionId: 9 });
      await restart;
    });
    expect(harness.stop).toHaveBeenNthCalledWith(1, 4);
    expect(harness.stop).toHaveBeenNthCalledWith(2, 9);
    expect(ui.hook().canRestartDebug()).toBe(false);
    ui.unmount();
  });

  it("awaits stale replay cleanup before the restart finishes", async () => {
    const harness = createGateway();
    const replay = deferred<DebugRuntimeStatus>();
    const cleanup = deferred<void>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replay.promise);
    harness.stop.mockResolvedValueOnce(undefined).mockReturnValueOnce(cleanup.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    let finished = false;
    const restart = ui
      .hook()
      .restartDebug()
      .then(() => {
        finished = true;
      });
    await act(async () => Promise.resolve());
    ui.set({ workspaceRoot: "/workspace/two" });

    await act(async () => {
      replay.resolve({ kind: "ok", sessionId: 9 });
      await Promise.resolve();
    });

    expect(harness.stop.mock.calls).toEqual([[4], [9]]);
    expect(finished).toBe(false);

    await act(async () => {
      cleanup.resolve();
      await restart;
    });
    expect(finished).toBe(true);
    ui.unmount();
  });

  it("propagates a rejected stale replay cleanup instead of dropping it", async () => {
    const harness = createGateway();
    const replay = deferred<DebugRuntimeStatus>();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockReturnValueOnce(replay.promise);
    harness.stop
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    const restart = ui.hook().restartDebug();
    await act(async () => Promise.resolve());
    ui.set({ workspaceRoot: "/workspace/two" });

    replay.resolve({ kind: "ok", sessionId: 9 });
    await act(async () => {
      await expect(restart).rejects.toThrow("cleanup failed");
    });

    expect(harness.stop.mock.calls).toEqual([[4], [9]]);
    expect(ui.hook().debugRestartPending).toBe(false);
    ui.unmount();
  });

  it("disables restart without an active accepted Node target", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    expect(ui.hook().canRestartDebug()).toBe(false);
    await act(async () => ui.hook().restartDebug());
    expect(harness.stop).not.toHaveBeenCalled();

    await act(async () =>
      ui.hook().startDebug({ kind: "php-script", scriptPath: "/workspace/one/index.php" }),
    );
    expect(ui.hook().canRestartDebug()).toBe(false);
    await act(async () => ui.hook().restartDebug());
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("ignores stale events from the stopped session after restart replacement", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 9 });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    await act(async () => ui.hook().restartDebug());

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 100,
        payload: { kind: "terminated", exitCode: 1 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 101,
        payload: { kind: "output", stream: "stderr", text: "stale", truncated: false },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 9 });
    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("honours a stop requested while the start is still in flight", async () => {
    const harness = createGateway();
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } = { resolve: null };
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
    expect(ui.hook().debugStartPending).toBe(true);
    expect(ui.hook().debugStopPending).toBe(true);

    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 9 });
      await pendingStart;
    });

    expect(harness.stop).toHaveBeenCalledWith(9);
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("does not project an old pending-start cancellation into a replacement owner", async () => {
    const harness = createGateway();
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } = { resolve: null };
    harness.start.mockImplementation(
      () =>
        new Promise<DebugRuntimeStatus>((resolve) => {
          captured.resolve = resolve;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");

    let pendingStart: Promise<void> | null = null;
    act(() => {
      pendingStart = ui.hook().startDebug(launch);
    });
    await act(async () => {
      await ui.hook().stopDebug();
    });
    expect(ui.hook().debugStopPending).toBe(true);

    ui.set({ workspaceId: "owner-2", workspaceRoot: "/workspace/two" });
    expect(ui.hook().debugStopPending).toBe(false);
    ui.set({ workspaceId: "owner-1", workspaceRoot: "/workspace/one" });
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);
    expect(ui.hook().isDebugStartBlocked()).toBe(true);

    await act(async () => {
      await ui.hook().stopDebug();
      await ui.hook().startDebug(launch);
    });
    expect(harness.start).toHaveBeenCalledOnce();
    expect(ui.hook().debugStopPending).toBe(false);

    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 9 });
      await pendingStart;
    });
    expect(harness.stop).toHaveBeenCalledWith(9);
    expect(ui.hook().debugStopPending).toBe(false);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(false);
    ui.unmount();
  });

  it("compensates an un-cancelled start after an A-B-A owner replacement", async () => {
    const harness = createGateway();
    const captured: { resolve: ((status: DebugRuntimeStatus) => void) | null } = { resolve: null };
    harness.start.mockImplementation(
      () =>
        new Promise<DebugRuntimeStatus>((resolve) => {
          captured.resolve = resolve;
        }),
    );
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let pendingStart: Promise<void> | null = null;

    act(() => {
      pendingStart = ui.hook().startDebug(launch);
    });
    ui.set({ workspaceId: "owner-2", workspaceRoot: "/workspace/two" });
    ui.set({ workspaceId: "owner-1", workspaceRoot: "/workspace/one" });
    expect(ui.hook().debugStartPending).toBe(false);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);

    await act(async () => {
      captured.resolve?.({ kind: "ok", sessionId: 9 });
      await pendingStart;
    });
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(9);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(false);
    expect(ui.hook().isDebugStartBlocked()).toBe(false);
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

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = ui.hook().startDebugAccepted(launch);
    });
    ui.set({ workspaceRoot: "/workspace/two" });

    await act(async () => {
      resolveStart?.({ kind: "ok", sessionId: 9 });
      expect(await pending).toBe(false);
    });

    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(harness.stop).toHaveBeenCalledWith(9);

    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("rejects and stops a successful start after trust is revoked", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    let trusted = true;
    const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);
    let pending!: Promise<boolean>;
    act(() => {
      pending = ui.hook().startDebugAccepted(launch);
    });

    trusted = false;
    let accepted = true;
    await act(async () => {
      startResult.resolve({ kind: "ok", sessionId: 9 });
      accepted = await pending;
    });

    expect(accepted).toBe(false);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(9);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("rejects and stops a descriptor start whose clean-target lease expires while pending", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    const confirmStart = vi.fn<NonNullable<DebugStartDescriptor["confirmStart"]>>();
    let authorized = true;
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart,
      exceptionTypeFilterSupported: true,
      isStartAuthorized: () => authorized,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: () => startResult.promise,
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });

    authorized = false;
    await act(async () => {
      startResult.resolve({ kind: "ok", sessionId: 19 });
      await expect(pending).resolves.toBeNull();
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(19);
    expect(confirmStart).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("does not adopt a descriptor session before its start confirmation succeeds", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    const confirmStart = vi
      .fn<NonNullable<DebugStartDescriptor["confirmStart"]>>()
      .mockReturnValueOnce(confirmation.promise);
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(confirmStart).toHaveBeenCalledExactlyOnceWith("/workspace/one", 19);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 19,
        seq: 1,
        payload: { kind: "started", sessionId: 19 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 19,
        seq: 2,
        payload: {
          kind: "output",
          stream: "stdout",
          text: "premature user output",
          truncated: false,
        },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    expect(ui.hook().output).toEqual([]);

    let accepted: number | null = null;
    await act(async () => {
      confirmation.resolve();
      accepted = await pending;
    });

    expect(accepted).toBe(19);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(ui.hook().snapshot.state).toEqual({ kind: "running", sessionId: 19 });
    ui.unmount();
  });

  it("replays a breakpoint stop that arrives while descriptor confirmation is pending", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart: () => confirmation.promise,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });
    await act(async () => Promise.resolve());

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 19,
        seq: 1,
        payload: { kind: "started", sessionId: 19 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 19,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 7 },
      });
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });

    await act(async () => {
      confirmation.resolve();
      await expect(pending).resolves.toBe(19);
    });

    expect(ui.hook().snapshot).toEqual({
      state: {
        kind: "stopped",
        sessionId: 19,
        reason: "breakpoint",
        frames: [frame],
        topFrame: frame,
      },
      lastSeq: 2,
    });
    expect(ui.hook().pauseGeneration).toBe(7);
    expect(harness.stop).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("does not let foreign session events evict an exact pending confirmation stop", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart: () => confirmation.promise,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });
    await act(async () => Promise.resolve());

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 19,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 7 },
      });
      for (let seq = 1; seq <= 33; seq += 1) {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 99,
          seq,
          payload: { kind: "resumed" },
        });
      }
    });
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });

    await act(async () => {
      confirmation.resolve();
      await expect(pending).resolves.toBe(19);
    });

    expect(ui.hook().snapshot).toEqual({
      state: {
        kind: "stopped",
        sessionId: 19,
        reason: "breakpoint",
        frames: [frame],
        topFrame: frame,
      },
      lastSeq: 2,
    });
    expect(ui.hook().pauseGeneration).toBe(7);
    expect(harness.stop).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("replays only the exact session breakpoint verification after confirmation", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });
    const created = ui.hook().breakpoints[0] as Breakpoint;
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart: () => confirmation.promise,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 99,
          seq: 1,
          payload: {
            kind: "breakpointsVerified",
            filePath: created.filePath,
            breakpoints: [{ ...created, verified: true }],
          },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 19,
          seq: 2,
          payload: {
            kind: "breakpointsVerified",
            filePath: created.filePath,
            breakpoints: [{ ...created, verified: true }],
          },
        });
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 19,
          seq: 3,
          payload: {
            kind: "output",
            stream: "stdout",
            text: "still hidden",
            truncated: false,
          },
        });
        return { kind: "ok", sessionId: 19 };
      },
    };
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });
    await act(async () => Promise.resolve());

    expect(ui.hook().breakpoints[0]?.verified).not.toBe(true);
    expect(ui.hook().output).toEqual([]);

    await act(async () => {
      confirmation.resolve();
      await expect(pending).resolves.toBe(19);
    });

    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ id: created.id, verified: true }),
    ]);
    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("stops and does not adopt a descriptor session whose start confirmation rejects", async () => {
    const harness = createGateway();
    const confirmStart = vi
      .fn<NonNullable<DebugStartDescriptor["confirmStart"]>>()
      .mockRejectedValueOnce(new Error("confirmation rejected"));
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let accepted: number | null = 19;

    await act(async () => {
      accepted = await ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });

    expect(confirmStart).toHaveBeenCalledExactlyOnceWith("/workspace/one", 19);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(19);
    expect(accepted).toBeNull();
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("honors Stop received while a descriptor confirmation is pending", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    const confirmStart = vi
      .fn<NonNullable<DebugStartDescriptor["confirmStart"]>>()
      .mockReturnValueOnce(confirmation.promise);
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart,
      exceptionTypeFilterSupported: true,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });
    await act(async () => Promise.resolve());

    await act(async () => ui.hook().stopDebug());
    expect(harness.stop).not.toHaveBeenCalled();

    await act(async () => {
      confirmation.resolve();
      await expect(pending).resolves.toBeNull();
    });

    expect(confirmStart).toHaveBeenCalledExactlyOnceWith("/workspace/one", 19);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(19);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("rechecks a descriptor lease after confirmation before adopting the session", async () => {
    const harness = createGateway();
    const confirmation = deferred<void>();
    let authorized = true;
    const descriptor: DebugStartDescriptor = {
      adapterKind: "node",
      confirmStart: () => confirmation.promise,
      exceptionTypeFilterSupported: true,
      isStartAuthorized: () => authorized,
      restartLaunch: null,
      targetKind: "node-configured-script",
      start: async () => ({ kind: "ok", sessionId: 19 }),
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    let pending!: Promise<number | null>;
    act(() => {
      pending = ui.hook().startDebugDescriptorSessionAccepted(descriptor);
    });
    await act(async () => Promise.resolve());

    authorized = false;
    await act(async () => {
      confirmation.resolve();
      await expect(pending).resolves.toBeNull();
    });

    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(19);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("rejects and stops a successful start after the same-root workspace owner changes", async () => {
    const harness = createGateway();
    const startResult = deferred<DebugRuntimeStatus>();
    harness.start.mockReturnValueOnce(startResult.promise);
    let currentWorkspaceId = "workspace-a";
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      currentWorkspaceId,
      (rootPath, workspaceId) =>
        rootPath === "/workspace/one" && workspaceId === currentWorkspaceId,
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = ui.hook().startDebugAccepted(launch);
    });

    currentWorkspaceId = "workspace-b";
    ui.set({ workspaceId: currentWorkspaceId });
    let accepted = true;
    await act(async () => {
      startResult.resolve({ kind: "ok", sessionId: 9 });
      accepted = await pending;
    });

    expect(accepted).toBe(false);
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(9);
    expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
    ui.unmount();
  });

  it("invalidates the retained restart recipe when the same-root workspace owner changes", async () => {
    const harness = createGateway();
    let currentWorkspaceId = "workspace-a";
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      currentWorkspaceId,
      (rootPath, workspaceId) =>
        rootPath === "/workspace/one" && workspaceId === currentWorkspaceId,
    );
    const configuredLaunch: DebugLaunchTarget = {
      args: ["--owner", "a"],
      env: { OWNER_SECRET: "a-only" },
      kind: "node-configured-script",
      scriptPath: "/workspace/one/index.js",
    };
    await act(async () => void (await ui.hook().startDebug(configuredLaunch)));
    expect(ui.hook().canRestartDebug()).toBe(true);

    currentWorkspaceId = "workspace-b";
    ui.set({ workspaceId: currentWorkspaceId });
    expect(ui.hook().canRestartDebug()).toBe(false);
    await act(async () => {
      await ui.hook().restartDebug();
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
    });

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("hides the full active-session projection across a same-root A to B to A switch", async () => {
    const harness = createGateway();
    let currentWorkspaceId = "workspace-a";
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      currentWorkspaceId,
      (rootPath, workspaceId) =>
        rootPath === "/workspace/one" && workspaceId === currentWorkspaceId,
    );

    await act(async () => void (await ui.hook().startDebug(launch)));
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });

    expect(ui.hook().pauseOwner).toMatchObject({ workspaceOwnerKey: "workspace-a" });
    expect(ui.hook().inspectionOwner).toMatchObject({ sessionId: 4, pauseGeneration: 1 });
    harness.scopesAtPause.mockResolvedValueOnce([
      { expensive: false, name: "Local", variablesReference: 21 },
    ]);
    await act(async () => {
      await ui.hook().selectFrame(11);
    });
    expect(ui.hook().selectedFrameId).toBe(11);
    expect(ui.hook().scopes).toHaveLength(1);

    currentWorkspaceId = "workspace-b";
    ui.set({ workspaceId: currentWorkspaceId });
    expect(ui.hook().snapshot.state.kind).toBe("inactive");
    expect(ui.hook().pauseOwner).toBeNull();
    expect(ui.hook().inspectionOwner).toBeNull();
    expect(ui.hook().pauseGeneration).toBe(0);
    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().scopes).toEqual([]);

    currentWorkspaceId = "workspace-a";
    ui.set({ workspaceId: currentWorkspaceId });
    expect(ui.hook().snapshot.state.kind).toBe("inactive");
    expect(ui.hook().pauseOwner).toBeNull();
    expect(ui.hook().inspectionOwner).toBeNull();
    expect(ui.hook().pauseGeneration).toBe(0);
    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().scopes).toEqual([]);
    expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);
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

  it("counts breakpoints and performs local-only bulk mutations without no-op work", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "enabled", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        { id: "disabled", filePath: "/workspace/one/b.ts", lineNumber: 2, enabled: false },
      ]);
    });

    expect(ui.hook().breakpointCounts).toEqual({ disabled: 1, enabled: 1 });
    await act(async () => ui.hook().disableAllBreakpoints());
    expect(ui.hook().breakpointCounts).toEqual({ disabled: 2, enabled: 0 });
    expect(ui.hook().breakpointBulkMutationPending).toBe(false);
    expect(harness.setBreakpoints).not.toHaveBeenCalled();

    const noOpList = ui.hook().breakpoints;
    await act(async () => ui.hook().disableAllBreakpoints());
    expect(ui.hook().breakpoints).toBe(noOpList);
    expect(harness.setBreakpoints).not.toHaveBeenCalled();

    await act(async () => ui.hook().removeAllBreakpoints());
    expect(ui.hook().breakpoints).toEqual([]);
    expect(ui.hook().breakpointCounts).toEqual({ disabled: 0, enabled: 0 });
    ui.unmount();
  });

  it("syncs the exact old/new file union once and sends empty lists when removing all", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(async (_root, _session, _file, list) => [...list]);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "a", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        { id: "b", filePath: "/workspace/one/b.ts", lineNumber: 2, enabled: true },
        { id: "a-2", filePath: "/workspace/one/a.ts", lineNumber: 3, enabled: true },
      ]);
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

    await act(async () => ui.hook().disableAllBreakpoints());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    expect(harness.setBreakpoints.mock.calls.map((call) => call[2]).sort()).toEqual([
      "/workspace/one/a.ts",
      "/workspace/one/b.ts",
    ]);
    expect(harness.setBreakpoints.mock.calls.flatMap((call) => call[3])).toHaveLength(3);
    expect(
      harness.setBreakpoints.mock.calls.every((call) => call[3].every((bp) => !bp.enabled)),
    ).toBe(true);

    harness.setBreakpoints.mockClear();
    await act(async () => ui.hook().removeAllBreakpoints());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    expect(harness.setBreakpoints.mock.calls.map((call) => [call[2], call[3]]).sort()).toEqual([
      ["/workspace/one/a.ts", []],
      ["/workspace/one/b.ts", []],
    ]);
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("limits bulk synchronization to four requests and keeps the operation single-flight", async () => {
    const harness = createGateway();
    const replies: Array<ReturnType<typeof deferred<Breakpoint[]>>> = [];
    let active = 0;
    let maximumActive = 0;
    harness.setBreakpoints.mockImplementation(() => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const reply = deferred<Breakpoint[]>();
      replies.push(reply);
      return reply.promise.finally(() => {
        active -= 1;
      });
    });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints(
        Array.from({ length: 6 }, (_, index) => ({
          id: `bp-${index}`,
          filePath: `/workspace/one/${index}.ts`,
          lineNumber: 1,
          enabled: true,
        })),
      );
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

    let first!: Promise<void>;
    let overlapping!: Promise<void>;
    act(() => {
      first = ui.hook().disableAllBreakpoints();
      overlapping = ui.hook().enableAllBreakpoints();
    });
    expect(ui.hook().breakpointBulkMutationPending).toBe(true);
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(4);
    await act(async () => {
      replies.slice(0, 4).forEach((reply) => reply.resolve([]));
      await Promise.resolve();
    });
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(6);
    await act(async () => {
      replies.slice(4).forEach((reply) => reply.resolve([]));
      await Promise.all([first, overlapping]);
    });
    expect(maximumActive).toBe(4);
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(6);
    expect(ui.hook().breakpoints.every((breakpoint) => !breakpoint.enabled)).toBe(true);
    expect(ui.hook().breakpointBulkMutationPending).toBe(false);
    ui.unmount();
  });

  it("suppresses a superseded first-wave rejection without abandoning queued bulk files", async () => {
    const harness = createGateway();
    const firstWave = Array.from({ length: 4 }, () => deferred<Breakpoint[]>());
    harness.setBreakpoints.mockImplementation(async (_root, _session, _filePath, list) => {
      const callIndex = harness.setBreakpoints.mock.calls.length - 1;
      if (callIndex < firstWave.length) return firstWave[callIndex].promise;
      return [...list];
    });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints(
        Array.from({ length: 6 }, (_, index) => ({
          id: `bp-${index}`,
          filePath: `/workspace/one/${index}.ts`,
          lineNumber: 1,
          enabled: true,
        })),
      );
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

    let bulk!: Promise<void>;
    act(() => {
      bulk = ui.hook().disableAllBreakpoints();
    });
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(4);
    await act(async () => ui.hook().setBreakpointEnabled("bp-0", true));
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(5);

    await act(async () => {
      firstWave[0].reject(new Error("obsolete bulk failure"));
      firstWave.slice(1).forEach((reply) => reply.resolve([]));
      await bulk;
    });
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(7);
    const paths = harness.setBreakpoints.mock.calls.map((call) => call[2]);
    expect(paths.filter((path) => path === "/workspace/one/0.ts")).toHaveLength(2);
    expect(paths.filter((path) => path === "/workspace/one/4.ts")).toHaveLength(1);
    expect(paths.filter((path) => path === "/workspace/one/5.ts")).toHaveLength(1);
    expect(ui.hook().breakpoints.find((entry) => entry.id === "bp-0")).toEqual(
      expect.objectContaining({ enabled: true, lineNumber: 1 }),
    );
    ui.unmount();
  });

  it.each(["trust", "owner", "root", "unmount", "stop"] as const)(
    "stops queued bulk dispatch after the %s boundary becomes stale",
    async (boundary) => {
      const harness = createGateway();
      const replies: Array<ReturnType<typeof deferred<Breakpoint[]>>> = [];
      let trusted = true;
      let activeOwner = "owner-a";
      harness.setBreakpoints.mockImplementation(() => {
        const reply = deferred<Breakpoint[]>();
        replies.push(reply);
        return reply.promise;
      });
      const ui = renderHook(
        harness.gateway,
        "/workspace/one",
        () => trusted,
        false,
        "owner-a",
        (_rootPath, candidateOwner) => candidateOwner === activeOwner,
      );
      await act(async () => {
        await ui.hook().restoreBreakpoints(
          Array.from({ length: 6 }, (_, index) => ({
            id: `bp-${index}`,
            filePath: `/workspace/one/${index}.ts`,
            lineNumber: 1,
            enabled: true,
          })),
        );
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

      let mutation!: Promise<void>;
      act(() => {
        mutation = ui.hook().disableAllBreakpoints();
      });
      expect(harness.setBreakpoints).toHaveBeenCalledTimes(4);
      if (boundary === "trust") trusted = false;
      if (boundary === "owner") {
        activeOwner = "owner-b";
        ui.set({ workspaceId: "owner-b" });
      }
      if (boundary === "root") ui.set({ workspaceRoot: "/workspace/two" });
      if (boundary === "stop") await act(async () => ui.hook().stopDebug());
      if (boundary === "unmount") ui.unmount();

      await act(async () => {
        replies.forEach((reply) => reply.resolve([]));
        await mutation;
      });
      expect(harness.setBreakpoints).toHaveBeenCalledTimes(4);
      if (boundary !== "unmount") ui.unmount();
    },
  );

  it("lets a later per-file mutation win over a pending bulk response", async () => {
    const harness = createGateway();
    const bulkReply = deferred<Breakpoint[]>();
    const individualReply = deferred<Breakpoint[]>();
    harness.setBreakpoints
      .mockReturnValueOnce(bulkReply.promise)
      .mockReturnValueOnce(individualReply.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        ]);
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

    let bulk!: Promise<void>;
    let individual!: Promise<void>;
    act(() => {
      bulk = ui.hook().disableAllBreakpoints();
      individual = ui.hook().setBreakpointEnabled("bp", true);
    });
    await act(async () => {
      individualReply.resolve([
        { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true, verified: true },
      ]);
      await individual;
      bulkReply.resolve([
        { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 99, enabled: false },
      ]);
      await bulk;
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ enabled: true, lineNumber: 1, verified: true }),
    ]);
    ui.unmount();
  });

  it("invalidates queued row edits when a later bulk mutation commits", async () => {
    const harness = createGateway();
    const firstReply = deferred<Breakpoint[]>();
    harness.setBreakpoints
      .mockReturnValueOnce(firstReply.promise)
      .mockImplementation(async (_root, _session, _file, breakpoints) => [...breakpoints]);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { enabled: true, filePath: "/workspace/one/a.ts", id: "bp", lineNumber: 1 },
        ]);
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

    let first!: Promise<void>;
    let queued!: Promise<void>;
    act(() => {
      first = ui.hook().setBreakpointCondition("bp", "pending");
      queued = ui.hook().setBreakpointEnabled("bp", true);
    });
    const firstRejected = expect(first).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    const queuedRejected = expect(queued).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    await act(async () => Promise.resolve());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(1);

    await act(async () => ui.hook().disableAllBreakpoints());
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ condition: "pending", enabled: false }),
    ]);
    await act(async () => {
      firstReply.resolve([
        {
          condition: "pending",
          enabled: true,
          filePath: "/workspace/one/a.ts",
          id: "bp",
          lineNumber: 1,
        },
      ]);
      await firstRejected;
      await queuedRejected;
    });

    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ condition: "pending", enabled: false }),
    ]);
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it.each(["trust", "owner", "stop", "restart"] as const)(
    "does not send an individual breakpoint sync after the %s boundary is already stale",
    async (boundary) => {
      const harness = createGateway();
      const pendingStop = deferred<void>();
      let trusted = true;
      let activeOwner = "owner-a";
      const ui = renderHook(
        harness.gateway,
        "/workspace/one",
        () => trusted,
        false,
        "owner-a",
        (_rootPath, candidateOwner) => candidateOwner === activeOwner,
      );
      await act(async () => {
        await ui
          .hook()
          .restoreBreakpoints([
            { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
          ]);
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

      let lifecycle: Promise<void> | null = null;
      if (boundary === "trust") trusted = false;
      if (boundary === "owner") {
        activeOwner = "owner-b";
        ui.set({ workspaceId: "owner-b" });
      }
      if (boundary === "stop" || boundary === "restart") {
        harness.stop.mockReturnValueOnce(pendingStop.promise);
        if (boundary === "restart")
          harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 5 });
        act(() => {
          lifecycle = boundary === "stop" ? ui.hook().stopDebug() : ui.hook().restartDebug();
        });
      }
      await act(async () => {
        await expect(ui.hook().setBreakpointEnabled("bp", false)).rejects.toThrow(
          "Breakpoint update was cancelled because the debug session changed.",
        );
      });
      expect(harness.setBreakpoints).not.toHaveBeenCalled();
      expect(ui.hook().breakpoints[0]?.enabled).toBe(true);
      if (lifecycle) {
        await act(async () => {
          pendingStop.resolve();
          await lifecycle;
        });
      }
      ui.unmount();
    },
  );

  it.each(["trust", "owner", "stop", "restart"] as const)(
    "drops an individual breakpoint response after the %s boundary becomes stale",
    async (boundary) => {
      const harness = createGateway();
      const reply = deferred<Breakpoint[]>();
      let trusted = true;
      let activeOwner = "owner-a";
      harness.setBreakpoints.mockReturnValueOnce(reply.promise);
      const ui = renderHook(
        harness.gateway,
        "/workspace/one",
        () => trusted,
        false,
        "owner-a",
        (_rootPath, candidateOwner) => candidateOwner === activeOwner,
      );
      await act(async () => {
        await ui
          .hook()
          .restoreBreakpoints([
            { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
          ]);
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

      let mutation!: Promise<void>;
      act(() => {
        mutation = ui.hook().setBreakpointEnabled("bp", false);
      });
      const rejectedMutation = expect(mutation).rejects.toThrow(
        "Breakpoint update was cancelled because the debug session changed.",
      );
      await act(async () => Promise.resolve());
      if (boundary === "trust") trusted = false;
      if (boundary === "owner") {
        activeOwner = "owner-b";
        ui.set({ workspaceId: "owner-b" });
      }
      if (boundary === "stop") await act(async () => ui.hook().stopDebug());
      if (boundary === "restart") {
        harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 5 });
        await act(async () => ui.hook().restartDebug());
      }
      await act(async () => {
        reply.resolve([
          { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 99, enabled: false },
        ]);
        await rejectedMutation;
      });
      expect(ui.hook().breakpoints).toEqual([
        expect.objectContaining({ enabled: true, lineNumber: 1 }),
      ]);
      ui.unmount();
    },
  );

  it.each(["trust", "owner", "stop", "restart", "newer-token"] as const)(
    "suppresses an individual breakpoint rejection after the %s boundary becomes stale",
    async (boundary) => {
      const harness = createGateway();
      const reply = deferred<Breakpoint[]>();
      let trusted = true;
      let activeOwner = "owner-a";
      harness.setBreakpoints
        .mockReturnValueOnce(reply.promise)
        .mockImplementation(async (_root, _session, _file, list) => [...list]);
      const ui = renderHook(
        harness.gateway,
        "/workspace/one",
        () => trusted,
        false,
        "owner-a",
        (_rootPath, candidateOwner) => candidateOwner === activeOwner,
      );
      await act(async () => {
        await ui
          .hook()
          .restoreBreakpoints([
            { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
          ]);
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

      let mutation!: Promise<void>;
      act(() => {
        mutation = ui.hook().setBreakpointEnabled("bp", false);
      });
      const rejectedMutation = expect(mutation).rejects.toThrow(
        boundary === "newer-token"
          ? "Unable to synchronize the breakpoint."
          : "Breakpoint update was cancelled because the debug session changed.",
      );
      await act(async () => Promise.resolve());
      if (boundary === "trust") trusted = false;
      if (boundary === "owner") {
        activeOwner = "owner-b";
        ui.set({ workspaceId: "owner-b" });
      }
      if (boundary === "stop") await act(async () => ui.hook().stopDebug());
      if (boundary === "restart") {
        harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 5 });
        await act(async () => ui.hook().restartDebug());
      }
      const newerMutation =
        boundary === "newer-token" ? ui.hook().setBreakpointEnabled("bp", true) : null;
      await act(async () => {
        reply.reject(new Error("obsolete individual failure"));
        await rejectedMutation;
        await newerMutation;
      });
      expect(ui.hook().breakpoints[0]).toEqual(
        expect.objectContaining({
          enabled: true,
          lineNumber: 1,
        }),
      );
      ui.unmount();
    },
  );

  it("does not apply a bulk verification after trust is revoked", async () => {
    const harness = createGateway();
    const reply = deferred<Breakpoint[]>();
    let trusted = true;
    harness.setBreakpoints.mockReturnValueOnce(reply.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        ]);
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

    let mutation!: Promise<void>;
    act(() => {
      mutation = ui.hook().disableAllBreakpoints();
    });
    trusted = false;
    await act(async () => {
      reply.resolve([
        { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 99, enabled: false },
      ]);
      await mutation;
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ enabled: false, lineNumber: 1 }),
    ]);
    ui.unmount();
  });

  it("does not apply a bulk verification after the workspace root changes", async () => {
    const harness = createGateway();
    const reply = deferred<Breakpoint[]>();
    harness.setBreakpoints.mockReturnValueOnce(reply.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        ]);
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

    let mutation!: Promise<void>;
    act(() => {
      mutation = ui.hook().disableAllBreakpoints();
    });
    ui.set({ workspaceRoot: "/workspace/two" });
    await act(async () => {
      reply.resolve([
        { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 99, enabled: false },
      ]);
      await mutation;
    });
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ enabled: false, lineNumber: 1 }),
    ]);
    ui.unmount();
  });

  it("does not apply a bulk verification after the active session is replaced", async () => {
    const harness = createGateway();
    const reply = deferred<Breakpoint[]>();
    harness.setBreakpoints.mockReturnValueOnce(reply.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        ]);
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

    let mutation!: Promise<void>;
    act(() => {
      mutation = ui.hook().disableAllBreakpoints();
    });
    harness.start.mockResolvedValueOnce({ kind: "ok", sessionId: 5 });
    await act(async () => ui.hook().startDebug(launch));
    await act(async () => {
      reply.resolve([
        { id: "bp", filePath: "/workspace/one/a.ts", lineNumber: 99, enabled: false },
      ]);
      await mutation;
    });
    expect(ui.hook().snapshot.state).toMatchObject({ sessionId: 5 });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ enabled: false, lineNumber: 1 }),
    ]);
    ui.unmount();
  });

  it("clears breakpoint creation ownership when removing all", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    let ownership!: BreakpointCreationOwnership;
    await act(async () => {
      ownership = (await ui.hook().toggleBreakpoint("/workspace/one/a.ts", 1))!;
      await ui.hook().removeAllBreakpoints();
      await ui.hook().restoreBreakpoints([
        {
          id: ownership.breakpointId,
          filePath: "/workspace/one/replacement.ts",
          lineNumber: 2,
          enabled: true,
        },
      ]);
      await ownership.rollback();
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ filePath: "/workspace/one/replacement.ts" }),
    ]);
    ui.unmount();
  });

  it("keeps intended local bulk state and exposes only a bounded error after partial failure", async () => {
    const harness = createGateway();
    harness.setBreakpoints
      .mockRejectedValueOnce(new Error("secret adapter details"))
      .mockResolvedValueOnce([]);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "a", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        { id: "b", filePath: "/workspace/one/b.ts", lineNumber: 2, enabled: true },
      ]);
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
      await expect(ui.hook().disableAllBreakpoints()).rejects.toThrow(
        "Unable to synchronize all breakpoints.",
      );
    });
    expect(ui.hook().breakpoints).toHaveLength(2);
    expect(ui.hook().breakpoints.every((breakpoint) => !breakpoint.enabled)).toBe(true);
    expect(ui.hook().breakpointBulkMutationPending).toBe(false);
    ui.unmount();
  });

  it("rolls back only the exact breakpoint creation ownership", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    let ownership!: BreakpointCreationOwnership;
    await act(async () => {
      ownership = (await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4))!;
    });
    expect(ownership.breakpointId).toBe(ui.hook().breakpoints[0]?.id);
    await act(async () => ownership.rollback());
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("adds an exact inline sibling once and F9 only toggles the line sibling", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    const candidate = {
      columnNumber: 7,
      filePath: "/workspace/one/index.js",
      isCurrent: () => true,
      lineNumber: 4,
      workspaceOwnerKey: "owner-1",
      workspaceRoot: "/workspace/one",
    };
    let ownership!: BreakpointCreationOwnership;
    await act(async () => {
      ownership = (await ui.hook().addInlineBreakpoint(candidate))!;
    });
    expect(ownership).toMatchObject({
      columnNumber: 7,
      filePath: candidate.filePath,
      lineNumber: 4,
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ columnNumber: 7, lineNumber: 4 }),
    ]);

    await act(async () => {
      await expect(ui.hook().addInlineBreakpoint(candidate)).resolves.toBeNull();
      await ui.hook().toggleBreakpoint(candidate.filePath, candidate.lineNumber);
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ columnNumber: 7, lineNumber: 4 }),
      expect.not.objectContaining({ columnNumber: expect.anything() }),
    ]);

    await act(async () => {
      await ui.hook().toggleBreakpoint(candidate.filePath, candidate.lineNumber);
      await ownership.rollback();
    });
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("rejects stale and foreign inline breakpoint candidates", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await expect(
        ui.hook().addInlineBreakpoint({
          columnNumber: 7,
          filePath: "/workspace/one/index.js",
          isCurrent: () => false,
          lineNumber: 4,
          workspaceOwnerKey: "owner-1",
          workspaceRoot: "/workspace/one",
        }),
      ).resolves.toBeNull();
      await expect(
        ui.hook().addInlineBreakpoint({
          columnNumber: 7,
          filePath: "/workspace/one/index.js",
          isCurrent: () => true,
          lineNumber: 4,
          workspaceOwnerKey: "owner-2",
          workspaceRoot: "/workspace/one",
        }),
      ).resolves.toBeNull();
    });
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("rolls back and bounds an inline breakpoint synchronization rejection", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    harness.setBreakpoints
      .mockRejectedValueOnce(new Error("private adapter details"))
      .mockResolvedValueOnce([]);

    await act(async () => {
      await expect(
        ui.hook().addInlineBreakpoint({
          columnNumber: 7,
          filePath: "/workspace/one/index.js",
          isCurrent: () => true,
          lineNumber: 4,
          workspaceOwnerKey: "owner-1",
          workspaceRoot: "/workspace/one",
        }),
      ).rejects.toThrow("Unable to synchronize the breakpoint.");
    });

    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("rolls back a stale inline add without synchronizing into an A to B to A replacement", async () => {
    const harness = createGateway();
    const reply = deferred<Breakpoint[]>();
    let activeOwner = "owner-a";
    harness.setBreakpoints.mockReturnValueOnce(reply.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-a",
      (_rootPath, candidateOwner) => candidateOwner === activeOwner,
    );
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });

    let addition!: Promise<BreakpointCreationOwnership | null>;
    act(() => {
      addition = ui.hook().addInlineBreakpoint({
        columnNumber: 7,
        filePath: "/workspace/one/index.js",
        isCurrent: () => true,
        lineNumber: 4,
        workspaceOwnerKey: "owner-a",
        workspaceRoot: "/workspace/one",
      });
    });
    const rejectedAddition = expect(addition).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    await act(async () => Promise.resolve());
    activeOwner = "owner-b";
    ui.set({ workspaceId: "owner-b" });
    activeOwner = "owner-a";
    ui.set({ workspaceId: "owner-a" });

    await act(async () => {
      reply.resolve([
        {
          columnNumber: 7,
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 4,
          verified: true,
        },
      ]);
      await rejectedAddition;
    });

    expect(harness.setBreakpoints).toHaveBeenCalledTimes(1);
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("relocates an inline entity by id and sync verification preserves line siblings", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(async (_root, _session, _file, breakpoints) =>
      breakpoints.map((entry) => ({
        ...entry,
        columnNumber: entry.columnNumber === undefined ? undefined : entry.columnNumber + 20,
        lineNumber: entry.lineNumber + 20,
        verified: true,
      })),
    );
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "line", enabled: true, filePath: "/workspace/one/index.js", lineNumber: 4 },
        {
          id: "inline",
          columnNumber: 7,
          condition: "ready",
          enabled: true,
          filePath: "/workspace/one/index.js",
          lineNumber: 4,
        },
      ]);
      await ui.hook().startDebug(launch);
    });
    harness.setBreakpoints.mockClear();

    await act(async () => {
      await expect(
        ui.hook().relocateBreakpoint({
          breakpointId: "inline",
          columnNumber: 9,
          filePath: "/workspace/one/index.js",
          isCurrent: () => true,
          lineNumber: 5,
          workspaceOwnerKey: "owner-1",
          workspaceRoot: "/workspace/one",
        }),
      ).resolves.toBe(true);
    });
    expect(harness.setBreakpoints).toHaveBeenCalledWith(
      "/workspace/one",
      4,
      "/workspace/one/index.js",
      [
        {
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "line",
          lineNumber: 4,
        },
        {
          columnNumber: 9,
          condition: "ready",
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 5,
        },
      ],
    );
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ id: "line", lineNumber: 4, verified: true }),
      expect.objectContaining({
        id: "inline",
        columnNumber: 9,
        condition: "ready",
        lineNumber: 5,
        verified: true,
      }),
    ]);
    ui.unmount();
  });

  it("serializes a condition edit before relocation on the same breakpoint file", async () => {
    const harness = createGateway();
    const conditionReply = deferred<Breakpoint[]>();
    harness.setBreakpoints
      .mockReturnValueOnce(conditionReply.promise)
      .mockImplementation(async (_root, _session, _file, breakpoints) => [...breakpoints]);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          columnNumber: 7,
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 4,
        },
      ]);
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

    let condition!: Promise<void>;
    let relocation!: Promise<boolean>;
    act(() => {
      condition = ui.hook().setBreakpointCondition("inline", "ready");
      relocation = ui.hook().relocateBreakpoint({
        breakpointId: "inline",
        columnNumber: 9,
        filePath: "/workspace/one/index.js",
        isCurrent: () => true,
        lineNumber: 5,
        workspaceOwnerKey: "owner-1",
        workspaceRoot: "/workspace/one",
      });
    });
    await act(async () => Promise.resolve());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(1);

    await act(async () => {
      conditionReply.resolve([
        {
          columnNumber: 7,
          condition: "ready",
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 4,
          verified: true,
        },
      ]);
      await condition;
      await expect(relocation).resolves.toBe(true);
    });

    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({
        columnNumber: 9,
        condition: "ready",
        id: "inline",
        lineNumber: 5,
      }),
    ]);
    ui.unmount();
  });

  it("rolls back relocation after an A to B to A epoch replacement without new-session IPC", async () => {
    const harness = createGateway();
    const relocationReply = deferred<Breakpoint[]>();
    let activeOwner = "owner-a";
    harness.setBreakpoints.mockReturnValueOnce(relocationReply.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-a",
      (_rootPath, candidateOwner) => candidateOwner === activeOwner,
    );
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          columnNumber: 7,
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 4,
        },
      ]);
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

    let relocation!: Promise<boolean>;
    act(() => {
      relocation = ui.hook().relocateBreakpoint({
        breakpointId: "inline",
        columnNumber: 9,
        filePath: "/workspace/one/index.js",
        isCurrent: () => true,
        lineNumber: 5,
        workspaceOwnerKey: "owner-a",
        workspaceRoot: "/workspace/one",
      });
    });
    const rejectedRelocation = expect(relocation).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    await act(async () => Promise.resolve());
    activeOwner = "owner-b";
    ui.set({ workspaceId: "owner-b" });
    activeOwner = "owner-a";
    ui.set({ workspaceId: "owner-a" });

    await act(async () => {
      relocationReply.resolve([
        {
          columnNumber: 9,
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "inline",
          lineNumber: 5,
          verified: true,
        },
      ]);
      await rejectedRelocation;
    });

    expect(harness.setBreakpoints).toHaveBeenCalledExactlyOnceWith(
      "/workspace/one",
      4,
      "/workspace/one/index.js",
      [
        expect.objectContaining({
          columnNumber: 9,
          id: "inline",
          lineNumber: 5,
        }),
      ],
    );
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ columnNumber: 7, id: "inline", lineNumber: 4 }),
    ]);
    ui.unmount();
  });

  it("rolls back only its relocation when the tracked capture becomes stale", async () => {
    const harness = createGateway();
    const pending = deferred<Breakpoint[]>();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "inline",
          columnNumber: 7,
          enabled: true,
          filePath: "/workspace/one/index.js",
          lineNumber: 4,
        },
      ]);
      await ui.hook().startDebug(launch);
    });
    harness.setBreakpoints.mockReturnValueOnce(pending.promise);
    let current = true;
    let relocation!: Promise<boolean>;
    act(() => {
      relocation = ui.hook().relocateBreakpoint({
        breakpointId: "inline",
        columnNumber: 9,
        filePath: "/workspace/one/index.js",
        isCurrent: () => current,
        lineNumber: 5,
        workspaceOwnerKey: "owner-1",
        workspaceRoot: "/workspace/one",
      });
    });
    await act(async () => Promise.resolve());
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ id: "inline", columnNumber: 9, lineNumber: 5 }),
    ]);
    current = false;
    await act(async () => {
      pending.resolve([]);
      await expect(relocation).resolves.toBe(false);
    });
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({ id: "inline", columnNumber: 7, lineNumber: 4 }),
    ]);
    ui.unmount();
  });

  it("does not let stale ownership delete a restored replacement", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    let ownership!: BreakpointCreationOwnership;
    await act(async () => {
      ownership = (await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4))!;
    });
    const id = ownership.breakpointId;
    const replacement = {
      enabled: true,
      filePath: "/workspace/one/replacement.js",
      id,
      lineNumber: 9,
    };
    await act(async () => ui.hook().restoreBreakpoints([replacement]));
    await act(async () => ownership.rollback());
    expect(ui.hook().breakpoints).toEqual([replacement]);
    ui.unmount();
  });

  it("does not let stale inline ownership remove a same-ID restored replacement", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    let ownership!: BreakpointCreationOwnership;
    await act(async () => {
      ownership = (await ui.hook().addInlineBreakpoint({
        columnNumber: 7,
        filePath: "/workspace/one/index.js",
        isCurrent: () => true,
        lineNumber: 4,
        workspaceOwnerKey: "owner-1",
        workspaceRoot: "/workspace/one",
      }))!;
    });
    const replacement: Breakpoint = {
      columnNumber: 7,
      condition: "replacement",
      enabled: true,
      filePath: "/workspace/one/index.js",
      id: ownership.breakpointId,
      lineNumber: 4,
    };

    await act(async () => {
      await ui.hook().restoreBreakpoints([replacement]);
      await ownership.rollback();
    });

    expect(ui.hook().breakpoints).toEqual([replacement]);
    expect(harness.setBreakpoints).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("removes a locally created breakpoint when its initial synchronization fails", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    harness.setBreakpoints.mockRejectedValueOnce(new Error("sync failed"));
    await act(async () =>
      expect(ui.hook().toggleBreakpoint("/workspace/one/index.js", 4)).rejects.toThrow(
        "Unable to synchronize the breakpoint.",
      ),
    );
    expect(ui.hook().breakpoints).toEqual([]);
    ui.unmount();
  });

  it("pushes breakpoints for the file to an active session and applies verification", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(
      async (_rootPath, _sessionId, _filePath, breakpoints) =>
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
      "/workspace/one",
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
      expect.objectContaining({ lineNumber: 4, verified: true }),
    ]);
    ui.unmount();
  });

  it("syncs a composed Node logpoint without clearing condition or hit condition", async () => {
    const harness = createGateway();
    harness.setBreakpoints.mockImplementation(async (_root, _session, _file, breakpoints) => [
      ...breakpoints,
    ]);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        {
          id: "bp-log",
          filePath: "/workspace/one/index.js",
          lineNumber: 4,
          enabled: true,
          condition: "ready",
          hitCondition: { kind: "multiple", count: 3 },
        },
      ]);
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
    harness.setBreakpoints.mockClear();

    await act(async () => {
      await ui.hook().setBreakpointLogMessage("bp-log", "count={count}");
    });

    expect(harness.setBreakpoints).toHaveBeenCalledExactlyOnceWith(
      "/workspace/one",
      4,
      "/workspace/one/index.js",
      [
        expect.objectContaining({
          id: "bp-log",
          condition: "ready",
          hitCondition: { kind: "multiple", count: 3 },
          logMessage: "count={count}",
        }),
      ],
    );
    expect(ui.hook().breakpoints[0]).toEqual(
      expect.objectContaining({
        condition: "ready",
        hitCondition: { kind: "multiple", count: 3 },
        logMessage: "count={count}",
      }),
    );
    ui.unmount();
  });

  it.each(["enabled", "condition", "hitCondition", "logMessage", "remove"] as const)(
    "rolls back a rejected %s mutation and exposes only a bounded error",
    async (kind) => {
      const harness = createGateway();
      const original: Breakpoint = {
        condition: "ready",
        enabled: true,
        filePath: "/workspace/one/index.js",
        hitCondition: { count: 3, kind: "multiple" },
        id: "bp",
        lineNumber: 4,
        logMessage: "old={value}",
      };
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
      await act(async () => {
        await ui.hook().restoreBreakpoints([original]);
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
      harness.setBreakpoints.mockRejectedValueOnce(new Error("private adapter details"));

      await act(async () => {
        const mutation =
          kind === "enabled"
            ? ui.hook().setBreakpointEnabled("bp", false)
            : kind === "condition"
              ? ui.hook().setBreakpointCondition("bp", "changed")
              : kind === "hitCondition"
                ? ui.hook().setBreakpointHitCondition("bp", { count: 9, kind: "equals" })
                : kind === "logMessage"
                  ? ui.hook().setBreakpointLogMessage("bp", "new={value}")
                  : ui.hook().removeBreakpoint("bp");
        await expect(mutation).rejects.toThrow("Unable to synchronize the breakpoint.");
      });

      expect(ui.hook().breakpoints).toEqual([original]);
      expect(JSON.stringify(harness.setBreakpoints.mock.calls)).not.toContain("private");
      ui.unmount();
    },
  );

  it("continues queued edits from rolled-back state after a rejection", async () => {
    const harness = createGateway();
    const firstReply = deferred<Breakpoint[]>();
    harness.setBreakpoints
      .mockReturnValueOnce(firstReply.promise)
      .mockImplementation(async (_root, _session, _file, breakpoints) => [...breakpoints]);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { enabled: true, filePath: "/workspace/one/index.js", id: "bp", lineNumber: 4 },
        ]);
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

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = ui.hook().setBreakpointCondition("bp", "rejected");
      second = ui.hook().setBreakpointLogMessage("bp", "kept={value}");
    });
    const firstRejection = expect(first).rejects.toThrow("Unable to synchronize the breakpoint.");
    await act(async () => Promise.resolve());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstReply.reject(new Error("private"));
      await firstRejection;
      await second;
    });

    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    expect(ui.hook().breakpoints).toEqual([
      expect.objectContaining({
        id: "bp",
        logMessage: "kept={value}",
      }),
    ]);
    expect(ui.hook().breakpoints[0]).not.toHaveProperty("condition");
    ui.unmount();
  });

  it("rolls back a late mutation ACK across a same-root A to B to A epoch replacement", async () => {
    const harness = createGateway();
    const reply = deferred<Breakpoint[]>();
    let activeOwner = "owner-a";
    harness.setBreakpoints.mockReturnValueOnce(reply.promise);
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-a",
      (_rootPath, candidateOwner) => candidateOwner === activeOwner,
    );
    await act(async () => {
      await ui
        .hook()
        .restoreBreakpoints([
          { enabled: true, filePath: "/workspace/one/index.js", id: "bp", lineNumber: 4 },
        ]);
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

    let mutation!: Promise<void>;
    act(() => {
      mutation = ui.hook().setBreakpointCondition("bp", "stale");
    });
    const rejectedMutation = expect(mutation).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    await act(async () => Promise.resolve());
    activeOwner = "owner-b";
    ui.set({ workspaceId: "owner-b" });
    activeOwner = "owner-a";
    ui.set({ workspaceId: "owner-a" });

    await act(async () => {
      reply.resolve([
        {
          condition: "stale",
          enabled: true,
          filePath: "/workspace/one/index.js",
          id: "bp",
          lineNumber: 4,
          verified: true,
        },
      ]);
      await rejectedMutation;
    });

    expect(ui.hook().breakpoints).toEqual([
      expect.not.objectContaining({ condition: expect.anything() }),
    ]);
    ui.unmount();
  });

  it("filters initial and live breakpoints by adapter capability and workspace", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "js", filePath: "/workspace/one/app.ts", lineNumber: 1, enabled: true },
        { id: "php", filePath: "/workspace/one/App.php", lineNumber: 2, enabled: true },
        { id: "outside", filePath: "/other/app.ts", lineNumber: 3, enabled: true },
      ]);
      await ui.hook().startDebug({ kind: "php-script", scriptPath: "/workspace/one/App.php" });
    });
    expect(harness.start).toHaveBeenCalledWith(
      "/workspace/one",
      expect.objectContaining({ kind: "php-script" }),
      [expect.objectContaining({ id: "php" })],
      "none",
      [],
      [],
    );
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/new.ts", 5);
    });
    expect(harness.setBreakpoints).not.toHaveBeenCalled();
    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/New.php", 6);
    });
    expect(harness.setBreakpoints).toHaveBeenCalledExactlyOnceWith(
      "/workspace/one",
      4,
      "/workspace/one/New.php",
      [expect.objectContaining({ filePath: "/workspace/one/New.php" })],
    );
    ui.unmount();
  });

  it("serializes overlapping breakpoint mutations for one exact file", async () => {
    const harness = createGateway();
    const first = deferred<Breakpoint[]>();
    const second = deferred<Breakpoint[]>();
    harness.setBreakpoints.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    let firstMutation!: Promise<unknown>;
    let secondMutation!: Promise<unknown>;
    act(() => {
      firstMutation = ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
      secondMutation = ui.hook().toggleBreakpoint("/workspace/one/index.js", 8);
    });
    await act(async () => Promise.resolve());
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve([
        {
          ...harness.setBreakpoints.mock.calls[0]![3][0]!,
          lineNumber: 40,
          verified: true,
        },
      ]);
      await firstMutation;
      await Promise.resolve();
    });
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    const latest = harness.setBreakpoints.mock.calls[1]![3];
    await act(async () => {
      second.resolve(latest.map((entry) => ({ ...entry, verified: true })));
      await secondMutation;
    });
    expect(ui.hook().breakpoints.map(({ lineNumber }) => lineNumber)).toEqual([4, 8]);
    expect(ui.hook().breakpoints.every(({ verified }) => verified)).toBe(true);
    ui.unmount();
  });

  it("ignores breakpoint events from a stale session", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => {
      await ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
      await ui.hook().startDebug(launch);
    });
    const created = ui.hook().breakpoints[0]!;
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 99,
        seq: 2,
        payload: {
          kind: "breakpointsVerified",
          filePath: created.filePath,
          breakpoints: [{ ...created, lineNumber: 99, verified: true }],
        },
      });
    });
    expect(ui.hook().breakpoints[0]?.lineNumber).toBe(4);
    ui.unmount();
  });

  it("rolls back a live breakpoint creation after the workspace root changes", async () => {
    const harness = createGateway();
    const response = deferred<Breakpoint[]>();
    harness.setBreakpoints.mockReturnValueOnce(response.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
    });
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = ui.hook().toggleBreakpoint("/workspace/one/index.js", 4);
    });
    const rejectedMutation = expect(mutation).rejects.toThrow(
      "Breakpoint update was cancelled because the debug session changed.",
    );
    await act(async () => Promise.resolve());
    const created = ui.hook().breakpoints[0]!;
    ui.set({ workspaceRoot: "/workspace/two" });
    await act(async () => {
      response.resolve([{ ...created, lineNumber: 40, verified: true }]);
      await rejectedMutation;
    });
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().breakpoints).toEqual([]);
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
        lineNumber: 4,
        verified: true,
      }),
    ]);
    ui.unmount();
  });

  it("coalesces 50k session output events into one bounded React render", async () => {
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
    const rendersBeforeBurst = ui.renders();
    act(() => {
      for (let line = 0; line < 50_000; line += 1) {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 2 + line,
          payload: {
            kind: "output",
            stream: "stdout",
            text: `line ${line}`,
            truncated: false,
          },
        });
      }
    });

    expect(ui.renders()).toBe(rendersBeforeBurst);
    await flushDebugOutputBatch();
    expect(ui.renders() - rendersBeforeBurst).toBe(1);
    expect(ui.hook().output).toHaveLength(5000);
    expect(ui.hook().output[0]).toEqual({
      stream: "stderr",
      text: "[Earlier debugger output was omitted because the retained output limit was reached.]",
      truncated: true,
    });
    expect(ui.hook().output[1]).toEqual({
      stream: "stdout",
      text: "line 45001",
      truncated: false,
    });
    expect(ui.hook().output[ui.hook().output.length - 1]).toEqual({
      stream: "stdout",
      text: "line 49999",
      truncated: false,
    });
    ui.unmount();
  });

  it("flushes the final ordered output batch before exact-session termination", async () => {
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
        payload: {
          kind: "output",
          stream: "stdout",
          text: "final stdout",
          truncated: false,
        },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: {
          kind: "output",
          stream: "stderr",
          text: "final stderr",
          truncated: false,
        },
      });
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
    expect(ui.hook().output).toEqual([
      { stream: "stdout", text: "final stdout", truncated: false },
      { stream: "stderr", text: "final stderr", truncated: false },
    ]);
    ui.unmount();
  });

  it("rejects a delayed output batch after an A-B-A workspace epoch replacement", async () => {
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
        payload: {
          kind: "output",
          stream: "stdout",
          text: "stale after replacement",
          truncated: false,
        },
      });
    });
    ui.set({ workspaceRoot: "/workspace/two" });
    ui.set({ workspaceRoot: "/workspace/one" });
    await flushDebugOutputBatch();

    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("does not re-expose accepted terminated output after an A-B-A owner replacement", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-a");

    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: {
          kind: "output",
          stream: "stdout",
          text: "owned by the first A generation",
          truncated: false,
        },
      });
    });
    await flushDebugOutputBatch();
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().output).toEqual([
      {
        stream: "stdout",
        text: "owned by the first A generation",
        truncated: false,
      },
    ]);

    ui.set({ workspaceId: "owner-b", workspaceRoot: "/workspace/two" });
    ui.set({ workspaceId: "owner-a", workspaceRoot: "/workspace/one" });

    expect(ui.hook().snapshot.state).toEqual({
      kind: "terminated",
      sessionId: 4,
      exitCode: 0,
    });
    expect(ui.hook().output).toEqual([]);
    ui.unmount();
  });

  it("preserves upstream output truncation in the session projection", async () => {
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
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: {
          kind: "output",
          stream: "stderr",
          text: "bounded output\n[Debugger output truncated]",
          truncated: true,
        },
      });
    });
    await flushDebugOutputBatch();

    expect(ui.hook().output).toEqual([
      {
        stream: "stderr",
        text: "bounded output\n[Debugger output truncated]",
        truncated: true,
      },
    ]);
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
    harness.scopesAtPause.mockResolvedValue([scope]);
    harness.variablesPage.mockResolvedValue({
      variables: [variable],
      start: 0,
      returned: 1,
      truncated: false,
    });
    harness.evaluate.mockResolvedValue({
      status: "ok",
      value: "Object",
      type: "object",
      evaluateName: "state",
      variablesReference: 31,
    });
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });

    await act(async () => {
      await ui.hook().selectFrame(11);
    });
    expect(harness.scopesAtPause).toHaveBeenCalledWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 1,
      frameId: 11,
    });
    expect(ui.hook().selectedFrameId).toBe(11);
    expect(ui.hook().scopes).toEqual([scope]);

    await act(async () => {
      await ui.hook().loadVariables(21);
    });
    expect(harness.variablesPage).toHaveBeenCalledWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 1,
      frameId: 11,
      variablesReference: 21,
      start: 0,
      count: 100,
    });
    expect(ui.hook().variablesByReference[21]).toEqual([variable]);

    let evaluated: DebugVariable | null = null;
    await act(async () => {
      evaluated = await ui.hook().evaluate("state");
    });
    expect(harness.evaluate).toHaveBeenCalledWith(
      "/workspace/one",
      4,
      11,
      "state",
      "repl",
      true,
      1,
    );
    expect(evaluated).toEqual({
      name: "state",
      value: "Object",
      type: "object",
      evaluateName: "state",
      variablesReference: 31,
    });
    expect(ui.hook().evaluationHistory).toEqual(["state"]);

    const evaluationOwner = ui.hook().inspectionOwner!;
    await act(async () => {
      await ui.hook().loadVariablePage(evaluationOwner, 31, 0);
    });
    expect(harness.variablesPage).toHaveBeenLastCalledWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 1,
      frameId: 11,
      variablesReference: 31,
      start: 0,
      count: 100,
    });

    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().evaluationHistory).toEqual([]);
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().evaluationHistory).toEqual([]);

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
    expect(harness.scopesAtPause).toHaveBeenCalledTimes(1);
    expect(harness.variablesPage).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("prunes superseded evaluation history for one root without affecting another", async () => {
    const harness = createGateway();
    harness.start
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 8 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 5 })
      .mockResolvedValueOnce({ kind: "ok", sessionId: 4 });
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    await act(async () => void (await ui.hook().evaluate("rootAFirst")));

    ui.set({ workspaceRoot: "/workspace/one-extra" });
    await act(async () => ui.hook().startDebug(launch));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one-extra",
        sessionId: 8,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    await act(async () => void (await ui.hook().evaluate("rootB")));

    ui.set({ workspaceRoot: "/workspace/one" });
    await act(async () => ui.hook().startDebug(launch));
    expect(ui.hook().evaluationHistory).toEqual([]);
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 5,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    await act(async () => void (await ui.hook().evaluate("rootASecond")));
    expect(ui.hook().evaluationHistory).toEqual(["rootASecond"]);

    ui.set({ workspaceRoot: "/workspace/one-extra" });
    expect(ui.hook().evaluationHistory).toEqual([]);

    ui.set({ workspaceRoot: "/workspace/one" });
    await act(async () => ui.hook().startDebug(launch));
    expect(ui.hook().evaluationHistory).toEqual([]);
    ui.unmount();
  });

  it("drops scopes that resolve after workspace trust is revoked", async () => {
    const harness = createGateway();
    const pendingScopes = deferred<DebugScope[]>();
    harness.scopesAtPause.mockReturnValueOnce(pendingScopes.promise);
    let trusted = true;
    const isWorkspaceTrusted = () => trusted;
    const ui = renderHook(harness.gateway, "/workspace/one", isWorkspaceTrusted);

    await act(async () => ui.hook().startDebug(launch));
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
          kind: "stopped",
          reason: "breakpoint",
          frames: [frame, { ...frame, frameId: 12 }],
          pauseGeneration: 1,
        },
      });
    });

    let selection!: Promise<void>;
    act(() => {
      selection = ui.hook().selectFrame(12);
    });
    trusted = false;
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().inspectionOwner).toBeNull();
    expect(ui.hook().variablePages.owner).toBeNull();
    await act(async () => {
      pendingScopes.resolve([{ name: "Locals", variablesReference: 21, expensive: false }]);
      await selection;
    });

    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().scopes).toEqual([]);
    trusted = true;
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().inspectionOwner).toEqual({
      rootKey: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 1,
      frameId: 11,
    });
    ui.unmount();
  });

  it("deduplicates variable pages and rejects late pages after pause ownership changes", async () => {
    const harness = createGateway();
    const stalePage = deferred<DebugVariablePage>();
    harness.variablesPage.mockReturnValueOnce(stalePage.promise).mockResolvedValueOnce({
      variables: [{ name: "fresh", value: "2", variablesReference: 0 }],
      start: 0,
      returned: 1,
      truncated: false,
    });
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => ui.hook().startDebug(launch));
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    const firstOwner = ui.hook().inspectionOwner;
    expect(firstOwner).not.toBeNull();
    let first!: Promise<void>;
    act(() => {
      first = ui.hook().loadVariablePage(firstOwner!, 21, 0);
      void ui.hook().loadVariablePage(firstOwner!, 21, 0);
    });
    expect(harness.variablesPage).toHaveBeenCalledTimes(1);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "resumed" },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 4,
        payload: { kind: "stopped", reason: "step", frames: [frame], pauseGeneration: 2 },
      });
    });
    const secondOwner = ui.hook().inspectionOwner;
    expect(secondOwner).toMatchObject({ pauseGeneration: 2 });
    await act(async () => ui.hook().loadVariablePage(secondOwner!, 21, 0));
    expect(ui.hook().variablesByReference[21]).toEqual([
      { name: "fresh", value: "2", variablesReference: 0 },
    ]);

    await act(async () => {
      stalePage.resolve({
        variables: [{ name: "stale", value: "1", variablesReference: 0 }],
        start: 0,
        returned: 1,
        truncated: false,
      });
      await first;
    });
    expect(ui.hook().variablesByReference[21]).toEqual([
      { name: "fresh", value: "2", variablesReference: 0 },
    ]);
    ui.unmount();
  });

  it("admits at most sixteen concurrent variable requests before invoking the gateway", async () => {
    const harness = createGateway();
    harness.variablesPage.mockImplementation(async (request) => ({
      variables: [],
      start: request.start,
      returned: 0,
      truncated: false,
    }));
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => ui.hook().startDebug(launch));
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    const owner = ui.hook().inspectionOwner;
    expect(owner).not.toBeNull();
    await act(async () => {
      await Promise.all(
        Array.from({ length: 17 }, (_, index) => ui.hook().loadVariablePage(owner!, index + 1, 0)),
      );
    });
    expect(harness.variablesPage).toHaveBeenCalledTimes(16);
    ui.unmount();
  });

  it("keeps invalidated hung retries inside the physical variable request limit", async () => {
    const harness = createGateway();
    const hungPages: ReturnType<typeof deferred<DebugVariablePage>>[] = [];
    harness.variablesPage.mockImplementation((request) => {
      if (request.variablesReference === 20 && request.start === 0) {
        return Promise.resolve({
          variables: [{ name: "count", value: "0", variablesReference: 30, canSetValue: true }],
          start: 0,
          returned: 1,
          truncated: true,
          nextStart: 1,
        });
      }
      const page = deferred<DebugVariablePage>();
      hungPages.push(page);
      return page.promise;
    });
    harness.setVariable.mockImplementation(async (request) => ({
      name: request.name,
      value: request.value,
      variablesReference: 30,
      canSetValue: true,
    }));
    const ui = renderHook(harness.gateway, "/workspace/one");
    await startStoppedNodeSession(ui, harness);
    const owner = ui.hook().inspectionOwner!;
    await act(async () => ui.hook().loadVariablePage(owner, 20, 0));

    const staleFlights: Promise<void>[] = [];
    for (let index = 0; index < 16; index += 1) {
      act(() => {
        staleFlights.push(ui.hook().loadVariablePage(owner, 20, 1));
      });
      await act(async () => {
        await ui
          .hook()
          .variableMutationRows.forRow(owner, 20, 0, 0)!
          .commit(String(index + 1));
      });
    }
    expect(hungPages).toHaveLength(16);

    await act(async () => ui.hook().loadVariablePage(owner, 20, 1));
    expect(hungPages).toHaveLength(16);

    await act(async () => {
      hungPages[0]!.resolve({
        variables: [{ name: "stale", value: "old", variablesReference: 0 }],
        start: 1,
        returned: 1,
        truncated: false,
      });
      await staleFlights[0];
    });
    act(() => {
      void ui.hook().loadVariablePage(owner, 20, 1);
    });
    expect(hungPages).toHaveLength(17);
    ui.unmount();
  });

  it("drops evaluation results after a workspace switch or trust revocation", async () => {
    const harness = createGateway();
    const first = deferred<DebugEvaluationResult | null>();
    const second = deferred<DebugEvaluationResult | null>();
    let trusted = true;
    harness.evaluate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });

    let pending!: Promise<DebugVariable | null>;
    act(() => {
      pending = ui.hook().evaluate("count");
    });
    ui.set({ workspaceRoot: "/workspace/two" });
    await act(async () => {
      first.resolve({ status: "ok", value: "3", variablesReference: 0 });
      await expect(pending).resolves.toBeNull();
    });

    ui.set({ workspaceRoot: "/workspace/one" });
    let revokedWhilePending!: Promise<DebugVariable | null>;
    act(() => {
      revokedWhilePending = ui.hook().evaluate("total");
    });
    trusted = false;
    await act(async () => {
      second.resolve({ status: "ok", value: "9", variablesReference: 0 });
      await expect(revokedWhilePending).resolves.toBeNull();
      await expect(ui.hook().evaluate("count")).resolves.toBeNull();
    });
    expect(harness.evaluate).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("drops an evaluation result after the session is replaced", async () => {
    const harness = createGateway();
    const pendingResult = deferred<DebugEvaluationResult | null>();
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });

    let pending!: Promise<DebugVariable | null>;
    act(() => {
      pending = ui.hook().evaluate("count");
    });
    await act(async () => {
      await ui.hook().startDebug(launch);
    });
    await act(async () => {
      pendingResult.resolve({ status: "ok", value: "3", variablesReference: 0 });
      await expect(pending).resolves.toBeNull();
    });
    expect(ui.hook().snapshot.state).toMatchObject({
      kind: "running",
      sessionId: 5,
    });
    ui.unmount();
  });

  it("drops an evaluation reply after resume and a new pause in the same session", async () => {
    const harness = createGateway();
    const result = deferred<DebugEvaluationResult | null>();
    harness.evaluate.mockReturnValueOnce(result.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => ui.hook().startDebug(launch));
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    const firstPauseGeneration = ui.hook().pauseGeneration;

    let pending!: Promise<DebugVariable | null>;
    act(() => {
      pending = ui.hook().evaluate("count");
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "resumed" },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 4,
        payload: { kind: "stopped", reason: "step", frames: [frame], pauseGeneration: 3 },
      });
    });
    expect(ui.hook().pauseGeneration).toBe(firstPauseGeneration + 2);
    await act(async () => {
      result.resolve({ status: "ok", value: "3", variablesReference: 99 });
      await expect(pending).resolves.toBeNull();
    });
    ui.unmount();
  });

  it("drops an evaluation reply when frame selection changes", async () => {
    const harness = createGateway();
    const result = deferred<DebugEvaluationResult | null>();
    const nextScopes = deferred<DebugScope[]>();
    harness.evaluate.mockReturnValueOnce(result.promise);
    harness.scopesAtPause.mockReturnValueOnce(nextScopes.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");

    await act(async () => ui.hook().startDebug(launch));
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
          kind: "stopped",
          reason: "breakpoint",
          frames: [frame, { ...frame, frameId: 12, name: "caller" }],
          pauseGeneration: 1,
        },
      });
    });

    let pendingEvaluation!: Promise<DebugVariable | null>;
    let pendingSelection!: Promise<void>;
    act(() => {
      pendingEvaluation = ui.hook().evaluate("count");
      pendingSelection = ui.hook().selectFrame(12);
    });
    await act(async () => {
      result.resolve({ status: "ok", value: "3", variablesReference: 7 });
      await expect(pendingEvaluation).resolves.toBeNull();
      nextScopes.resolve([]);
      await pendingSelection;
    });
    expect(ui.hook().selectedFrameId).toBe(12);
    ui.unmount();
  });

  it("uses safe watch policy for Node and maps PHP watches to unsupported locally", async () => {
    const nodeHarness = createGateway();
    nodeHarness.evaluate.mockResolvedValueOnce({ status: "ok", value: "3", variablesReference: 8 });
    const nodeUi = renderHook(nodeHarness.gateway, "/workspace/one");
    await act(async () => nodeUi.hook().startDebug(launch));
    act(() => {
      nodeHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      nodeHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    await act(async () => {
      await expect(nodeUi.hook().evaluateWatch("count")).resolves.toMatchObject({
        status: "ok",
        value: "3",
      });
    });
    expect(nodeHarness.evaluate).toHaveBeenCalledWith(
      "/workspace/one",
      4,
      11,
      "count",
      "watch",
      false,
      1,
    );
    expect(nodeUi.hook().evaluationHistory).toEqual([]);
    nodeUi.unmount();

    const phpHarness = createGateway();
    const phpUi = renderHook(phpHarness.gateway, "/workspace/one");
    await act(async () =>
      phpUi.hook().startDebug({ kind: "php-script", scriptPath: "/workspace/one/index.php" }),
    );
    act(() => {
      phpHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "started", sessionId: 4 },
      });
      phpHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    await act(async () => {
      await expect(phpUi.hook().evaluateWatch("$count")).resolves.toEqual({
        status: "error",
        kind: "unsupported",
        message: "Safe automatic watch evaluation is only available for Node.js debugging.",
      });
      await expect(phpUi.hook().evaluateClipboard("$count")).resolves.toEqual({
        status: "error",
        kind: "unsupported",
        message: "Clipboard evaluation is only available for Node.js debugging.",
      });
    });
    expect(phpHarness.evaluate).not.toHaveBeenCalled();
    phpUi.unmount();
  });

  it("fences clipboard evaluation across owner epochs and pauses without touching history", async () => {
    const harness = createGateway();
    const ownerReply = deferred<DebugEvaluationResult | null>();
    const resumedReply = deferred<DebugEvaluationResult | null>();
    const adapterError = {
      status: "error",
      kind: "exception",
      message: "Getter failed.",
    } as const;
    harness.evaluate
      .mockReturnValueOnce(ownerReply.promise)
      .mockReturnValueOnce(resumedReply.promise)
      .mockResolvedValueOnce(adapterError);
    let currentOwner = "owner-a";
    const ui = renderHook(
      harness.gateway,
      "/workspace/one",
      () => true,
      false,
      currentOwner,
      (rootPath, workspaceId) => rootPath === "/workspace/one" && workspaceId === currentOwner,
    );
    await act(async () => ui.hook().startDebug(launch));
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
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });

    let staleOwner!: Promise<DebugEvaluationResult | null>;
    act(() => {
      staleOwner = ui.hook().evaluateClipboard("  user  ");
    });
    expect(harness.evaluate).toHaveBeenLastCalledWith(
      "/workspace/one",
      4,
      11,
      "user",
      "clipboard",
      true,
      1,
    );
    expect(ui.hook().evaluationHistory).toEqual([]);
    currentOwner = "owner-b";
    ui.set({ workspaceId: currentOwner });
    currentOwner = "owner-a";
    ui.set({ workspaceId: currentOwner });
    await act(async () => {
      ownerReply.resolve(adapterError);
      await expect(staleOwner).resolves.toBeNull();
    });

    let stalePause!: Promise<DebugEvaluationResult | null>;
    act(() => {
      stalePause = ui.hook().evaluateClipboard("user");
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "resumed" },
      });
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 4,
        payload: { kind: "stopped", reason: "step", frames: [frame], pauseGeneration: 2 },
      });
    });
    await act(async () => {
      resumedReply.resolve({ status: "ok", value: "User", variablesReference: 9 });
      await expect(stalePause).resolves.toBeNull();
      await expect(ui.hook().evaluateClipboard("user")).resolves.toEqual(adapterError);
    });
    expect(harness.evaluate).toHaveBeenLastCalledWith(
      "/workspace/one",
      4,
      11,
      "user",
      "clipboard",
      true,
      2,
    );
    expect(ui.hook().evaluationHistory).toEqual([]);
    ui.unmount();
  });

  it("reconciles a verified Set Variable row in paged and legacy cache views", async () => {
    const harness = createGateway();
    harness.variablesPage.mockImplementation(async (request) => ({
      variables:
        request.variablesReference === 20
          ? [
              {
                name: "count",
                value: "42",
                variablesReference: 30,
                canSetValue: true as const,
              },
            ]
          : [{ name: "child", value: "old", variablesReference: 0 }],
      start: request.start,
      returned: 1,
      truncated: false,
    }));
    const result = {
      name: "count",
      value: "43",
      evaluateName: "state.count",
      canSetValue: true as const,
      variablesReference: 40,
    };
    const setReply = deferred<DebugVariable>();
    const replReply = deferred<DebugEvaluationResult | null>();
    harness.setVariable.mockReturnValueOnce(setReply.promise);
    harness.evaluate
      .mockResolvedValueOnce({ status: "ok", value: "watch", variablesReference: 0 })
      .mockResolvedValueOnce({ status: "ok", value: "clipboard", variablesReference: 0 })
      .mockReturnValueOnce(replReply.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await startStoppedNodeSession(ui, harness);
    const owner = ui.hook().inspectionOwner!;
    await act(async () => {
      await ui.hook().loadVariablePage(owner, 20, 0);
      await ui.hook().loadVariablePage(owner, 30, 0);
    });
    const row = ui.hook().variableMutationRows.forRow(owner, 20, 0, 0);
    expect(row?.currentValue).toBe("42");
    expect(ui.hook().debugInspectionRevision).toBe(0);

    let pendingSet!: Promise<DebugVariable | null>;
    act(() => {
      pendingSet = row!.commit("43");
    });
    await expect(ui.hook().evaluateWatch("count")).resolves.toMatchObject({ value: "watch" });
    await expect(ui.hook().evaluateClipboard("count")).resolves.toMatchObject({
      value: "clipboard",
    });
    await act(async () => {
      setReply.resolve(result);
      await expect(pendingSet).resolves.toEqual(result);
    });
    expect(ui.hook().variablePages.references[20]?.pages[0]?.variables[0]).toEqual(result);
    expect(ui.hook().variablesByReference[20]?.[0]).toEqual(result);
    expect(ui.hook().variablePages.references[30]).toBeUndefined();
    expect(ui.hook().variablesByReference[30]).toBeUndefined();
    expect(ui.hook().debugInspectionRevision).toBe(1);

    let pendingRepl!: Promise<DebugVariable | null>;
    act(() => {
      pendingRepl = ui.hook().evaluate("count = 44");
    });
    await expect(
      ui.hook().variableMutationRows.forRow(owner, 20, 0, 0)?.commit("44"),
    ).resolves.toBeNull();
    expect(harness.setVariable).toHaveBeenCalledTimes(1);
    await act(async () => {
      replReply.resolve({ status: "ok", value: "44", variablesReference: 0 });
      await pendingRepl;
    });
    ui.unmount();
  });

  it("releases invalidated parent and descendant page flights without old-finally races", async () => {
    const harness = createGateway();
    const oldParent = deferred<DebugVariablePage>();
    const oldChild = deferred<DebugVariablePage>();
    const newParent = deferred<DebugVariablePage>();
    const newChild = deferred<DebugVariablePage>();
    let parentAttempt = 0;
    let childAttempt = 0;
    harness.variablesPage.mockImplementation((request) => {
      if (request.variablesReference === 20 && request.start === 0) {
        return Promise.resolve({
          variables: [{ name: "count", value: "42", variablesReference: 30, canSetValue: true }],
          start: 0,
          returned: 1,
          truncated: true,
          nextStart: 1,
        });
      }
      if (request.variablesReference === 20) {
        parentAttempt += 1;
        return parentAttempt === 1 ? oldParent.promise : newParent.promise;
      }
      childAttempt += 1;
      return childAttempt === 1 ? oldChild.promise : newChild.promise;
    });
    harness.setVariable.mockResolvedValueOnce({
      name: "count",
      value: "43",
      variablesReference: 30,
      canSetValue: true,
    });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await startStoppedNodeSession(ui, harness);
    const owner = ui.hook().inspectionOwner!;
    await act(async () => ui.hook().loadVariablePage(owner, 20, 0));
    let staleParent!: Promise<void>;
    let staleChild!: Promise<void>;
    act(() => {
      staleParent = ui.hook().loadVariablePage(owner, 20, 1);
      staleChild = ui.hook().loadVariablePage(owner, 30, 0);
    });

    await act(async () => {
      await ui.hook().variableMutationRows.forRow(owner, 20, 0, 0)!.commit("43");
    });
    let currentParent!: Promise<void>;
    let currentChild!: Promise<void>;
    act(() => {
      currentParent = ui.hook().loadVariablePage(owner, 20, 1);
      currentChild = ui.hook().loadVariablePage(owner, 30, 0);
    });
    expect(harness.variablesPage).toHaveBeenCalledTimes(5);

    await act(async () => {
      oldParent.resolve({
        variables: [{ name: "stale parent", value: "old", variablesReference: 0 }],
        start: 1,
        returned: 1,
        truncated: false,
      });
      oldChild.resolve({
        variables: [{ name: "stale child", value: "old", variablesReference: 0 }],
        start: 0,
        returned: 1,
        truncated: false,
      });
      await Promise.all([staleParent, staleChild]);
    });
    await act(async () => {
      void ui.hook().loadVariablePage(owner, 20, 1);
      void ui.hook().loadVariablePage(owner, 30, 0);
    });
    expect(harness.variablesPage).toHaveBeenCalledTimes(5);

    await act(async () => {
      newParent.resolve({
        variables: [{ name: "fresh parent", value: "new", variablesReference: 0 }],
        start: 1,
        returned: 1,
        truncated: false,
      });
      newChild.resolve({
        variables: [{ name: "fresh child", value: "new", variablesReference: 0 }],
        start: 0,
        returned: 1,
        truncated: false,
      });
      await Promise.all([currentParent, currentChild]);
    });
    expect(ui.hook().variablesByReference[20]?.map((entry) => entry.name)).toEqual([
      "count",
      "fresh parent",
    ]);
    expect(ui.hook().variablesByReference[30]?.[0]?.name).toBe("fresh child");
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

  it("keeps Restart Frame in the shared control flight through ACK until a fresh pause", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);

    let restarted!: Promise<boolean>;
    act(() => {
      restarted = ui.hook().restartFrame(restartFrameCandidate());
    });
    await act(async () => Promise.resolve());
    expect(harness.restartFrame).toHaveBeenCalledExactlyOnceWith({
      frameId: 11,
      pauseGeneration: 1,
      rootPath: "/workspace/one",
      sessionId: 4,
    });
    expect(ui.hook().debugControlPending).toBe(true);
    expect(ui.hook().pauseGeneration).toBe(0);
    await expect(ui.hook().restartFrame(restartFrameCandidate())).resolves.toBe(false);
    await act(async () => {
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
    });
    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "resumed" },
      });
    });
    expect(ui.hook().debugControlPending).toBe(true);
    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 3,
        payload: { kind: "stopped", reason: "restart", frames: [frame], pauseGeneration: 2 },
      });
      await expect(restarted).resolves.toBe(true);
    });
    expect(ui.hook().debugControlPending).toBe(false);
    expect(ui.hook().pauseGeneration).toBe(2);
    expect(ui.hook().selectedFrameId).toBeNull();
    expect(ui.hook().scopes).toEqual([]);
    ui.unmount();
  });

  it("preserves a fresh Restart Frame pause that races ahead of the gateway ACK", async () => {
    const harness = createGateway();
    const acknowledgement = deferred<void>();
    harness.restartFrame.mockReturnValueOnce(acknowledgement.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);

    let restarted!: Promise<boolean>;
    act(() => {
      restarted = ui.hook().restartFrame(restartFrameCandidate());
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "stopped", reason: "restart", frames: [frame], pauseGeneration: 2 },
      });
    });
    expect(ui.hook().pauseGeneration).toBe(2);
    expect(ui.hook().debugControlPending).toBe(true);

    await act(async () => {
      acknowledgement.resolve();
      await expect(restarted).resolves.toBe(true);
    });
    expect(ui.hook().pauseGeneration).toBe(2);
    expect(ui.hook().debugControlPending).toBe(false);
    ui.unmount();
  });

  it("starts the Restart Frame watchdog only after ACK and invalidates the old frame tree", async () => {
    vi.useFakeTimers();
    try {
      const harness = createGateway();
      const acknowledgement = deferred<void>();
      harness.restartFrame.mockReturnValueOnce(acknowledgement.promise);
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
      await startStoppedNodeSession(ui, harness);
      const restarted = ui.hook().restartFrame(restartFrameCandidate());
      const rejection = expect(restarted).rejects.toThrow("did not reach a fresh pause");

      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(ui.hook().debugControlPending).toBe(true);
      expect(ui.hook().pauseGeneration).toBe(1);
      expect(ui.hook().snapshot.state.kind).toBe("stopped");

      await act(async () => {
        acknowledgement.resolve();
        await Promise.resolve();
      });
      expect(ui.hook().pauseGeneration).toBe(0);
      expect(ui.hook().snapshot.state).toMatchObject({
        kind: "stopped",
        frames: [],
        topFrame: null,
      });
      expect(ui.hook().variablePages.references).toEqual({});

      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await rejection;
      expect(ui.hook().debugControlPending).toBe(false);
      ui.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes Restart Frame on termination and cancels an unmounted lifecycle", async () => {
    const terminatedHarness = createGateway();
    const terminatedUi = renderHook(
      terminatedHarness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
    );
    await startStoppedNodeSession(terminatedUi, terminatedHarness);
    const terminated = terminatedUi.hook().restartFrame(restartFrameCandidate());
    await act(async () => {
      terminatedHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: null },
      });
      await expect(terminated).resolves.toBe(true);
    });
    expect(terminatedUi.hook().debugControlPending).toBe(false);
    expect(terminatedUi.hook().snapshot.state.kind).toBe("terminated");
    terminatedUi.unmount();

    const unmountedHarness = createGateway();
    const acknowledgement = deferred<void>();
    unmountedHarness.restartFrame.mockReturnValueOnce(acknowledgement.promise);
    const unmountedUi = renderHook(
      unmountedHarness.gateway,
      "/workspace/one",
      () => true,
      false,
      "owner-1",
    );
    await startStoppedNodeSession(unmountedUi, unmountedHarness);
    const cancelled = unmountedUi.hook().restartFrame(restartFrameCandidate());
    const cancellation = expect(cancelled).rejects.toThrow("was cancelled");
    unmountedUi.unmount();
    await cancellation;
    await expect(unmountedUi.hook().restartFrame(restartFrameCandidate())).resolves.toBe(false);
    expect(unmountedHarness.restartFrame).toHaveBeenCalledTimes(1);
    acknowledgement.resolve();
    await Promise.resolve();
  });

  it("restarts a fileless current frame using only the exact protocol identity", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    const fileless = { ...frame, filePath: null, frameId: 12 };
    await startStoppedNodeSession(ui, harness, [fileless]);
    let restarted!: Promise<boolean>;
    act(() => {
      restarted = ui.hook().restartFrame(restartFrameCandidate({ frameId: 12 }));
    });
    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: {
          kind: "stopped",
          reason: "restart",
          frames: [fileless],
          pauseGeneration: 2,
        },
      });
      await expect(restarted).resolves.toBe(true);
    });
    expect(harness.restartFrame).toHaveBeenCalledExactlyOnceWith({
      frameId: 12,
      pauseGeneration: 1,
      rootPath: "/workspace/one",
      sessionId: 4,
    });
    ui.unmount();
  });

  it("preserves the old pause on Restart Frame protocol rejection and releases the flight", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);
    harness.restartFrame.mockRejectedValueOnce(new Error("protocol rejected"));
    await act(async () => {
      await expect(ui.hook().restartFrame(restartFrameCandidate())).rejects.toThrow(
        "protocol rejected",
      );
    });
    expect(ui.hook().snapshot.state.kind).toBe("stopped");
    expect(ui.hook().pauseGeneration).toBe(1);
    expect(ui.hook().debugControlPending).toBe(false);

    harness.restartFrame.mockImplementationOnce(() => {
      throw new Error("sync rejected");
    });
    await act(async () => {
      await expect(ui.hook().restartFrame(restartFrameCandidate())).rejects.toThrow(
        "sync rejected",
      );
    });
    expect(ui.hook().pauseGeneration).toBe(1);
    expect(ui.hook().debugControlPending).toBe(false);
    ui.unmount();
  });

  it("fails closed for foreign, running, PHP, and missing-frame Restart Frame requests", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    expect(ui.hook().canRestartFrame()).toBe(false);
    await startStoppedNodeSession(ui, harness);
    await expect(
      ui.hook().restartFrame(restartFrameCandidate({ workspaceOwnerKey: "owner-2" })),
    ).resolves.toBe(false);
    await expect(ui.hook().restartFrame(restartFrameCandidate({ frameId: 99 }))).resolves.toBe(
      false,
    );
    expect(harness.restartFrame).not.toHaveBeenCalled();
    ui.unmount();

    const phpHarness = createGateway();
    const phpUi = renderHook(phpHarness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await phpUi.hook().startDebug({ kind: "php-listen" });
      phpHarness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "pause", frames: [frame], pauseGeneration: 1 },
      });
    });
    expect(phpUi.hook().canRestartFrame()).toBe(false);
    await expect(phpUi.hook().restartFrame(restartFrameCandidate())).resolves.toBe(false);
    expect(phpHarness.restartFrame).not.toHaveBeenCalled();
    phpUi.unmount();
  });

  it("bounds an acknowledged Restart Frame lifecycle without reviving the old pause", async () => {
    vi.useFakeTimers();
    try {
      const harness = createGateway();
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
      await startStoppedNodeSession(ui, harness);
      harness.scopesAtPause.mockResolvedValueOnce([
        { name: "Local", variablesReference: 21, expensive: false },
      ]);
      await act(async () => ui.hook().selectFrame(11));
      expect(ui.hook().selectedFrameId).toBe(11);
      expect(ui.hook().scopes).toHaveLength(1);
      const restarted = ui.hook().restartFrame(restartFrameCandidate());
      await act(async () => Promise.resolve());
      expect(ui.hook().pauseGeneration).toBe(0);
      expect(ui.hook().selectedFrameId).toBeNull();
      expect(ui.hook().scopes).toEqual([]);
      expect(ui.hook().inspectionOwner).toBeNull();
      const rejection = expect(restarted).rejects.toThrow("did not reach a fresh pause");
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      await rejection;
      expect(ui.hook().debugControlPending).toBe(false);
      expect(ui.hook().canRestartFrame()).toBe(false);
      ui.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a stopped Node session to the captured location with a single control flight", async () => {
    const harness = createGateway();
    const pending = deferred<void>();
    harness.runToLocation.mockReturnValueOnce(pending.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => void (await ui.hook().startDebug(launch)));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 3 },
      });
    });
    expect(ui.hook().canRunToLocation()).toBe(true);

    let accepted!: Promise<boolean>;
    act(() => {
      accepted = ui.hook().runToLocation({
        filePath: "/workspace/one/index.js",
        lineNumber: 8,
        columnNumber: 2,
        isCurrent: () => true,
      });
    });
    expect(ui.hook().debugControlPending).toBe(true);
    expect(ui.hook().canRunToLocation()).toBe(false);
    await act(async () => {
      await ui.hook().startDebug(launch);
      await ui.hook().restartDebug();
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
    });
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    expect(harness.runToLocation).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      pauseGeneration: 3,
      filePath: "/workspace/one/index.js",
      lineNumber: 8,
      columnNumber: 2,
    });

    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "resumed" },
      });
      pending.resolve();
      await expect(accepted).resolves.toBe(true);
    });
    expect(ui.hook().debugControlPending).toBe(false);
    ui.unmount();
  });

  it("keeps bulk breakpoint state atomic while run-to-location owns the session", async () => {
    const harness = createGateway();
    const pending = deferred<void>();
    harness.runToLocation.mockReturnValueOnce(pending.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => {
      await ui.hook().restoreBreakpoints([
        { id: "enabled", filePath: "/workspace/one/a.ts", lineNumber: 1, enabled: true },
        { id: "disabled", filePath: "/workspace/one/b.ts", lineNumber: 2, enabled: false },
      ]);
      await ui.hook().startDebug(launch);
    });
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 3 },
      });
    });
    harness.setBreakpoints.mockClear();

    let control!: Promise<boolean>;
    act(() => {
      control = ui.hook().runToLocation({
        filePath: "/workspace/one/index.js",
        lineNumber: 8,
        columnNumber: 2,
        isCurrent: () => true,
      });
    });
    const before = ui.hook().breakpoints;
    await act(async () => {
      await ui.hook().enableAllBreakpoints();
      await ui.hook().disableAllBreakpoints();
      await ui.hook().removeAllBreakpoints();
    });
    expect(ui.hook().breakpoints).toBe(before);
    expect(ui.hook().breakpointCounts).toEqual({ disabled: 1, enabled: 1 });
    expect(harness.setBreakpoints).not.toHaveBeenCalled();

    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "resumed" },
      });
      pending.resolve();
      await expect(control).resolves.toBe(true);
    });
    await act(async () => ui.hook().disableAllBreakpoints());
    expect(ui.hook().breakpointCounts).toEqual({ disabled: 2, enabled: 0 });
    expect(harness.setBreakpoints).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it("does not run to a location without an exact non-null workspace owner", async () => {
    const harness = createGateway();
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => void (await ui.hook().startDebug(launch)));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    expect(ui.hook().canRunToLocation()).toBe(false);
    await expect(
      ui.hook().runToLocation({
        filePath: "/workspace/one/index.js",
        lineNumber: 1,
        columnNumber: 1,
        isCurrent: () => true,
      }),
    ).resolves.toBe(false);
    expect(harness.runToLocation).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("waits for run-to-location before Stop and rejects a terminated pre-response owner", async () => {
    const harness = createGateway();
    const pending = deferred<void>();
    harness.runToLocation.mockReturnValueOnce(pending.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => void (await ui.hook().startDebug(launch)));
    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    let accepted!: Promise<boolean>;
    let stopped!: Promise<void>;
    act(() => {
      accepted = ui.hook().runToLocation({
        filePath: "/workspace/one/index.js",
        lineNumber: 5,
        columnNumber: 1,
        isCurrent: () => true,
      });
      stopped = ui.hook().stopDebug();
    });
    expect(harness.stop).not.toHaveBeenCalled();
    await act(async () => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: 0 },
      });
      pending.resolve();
      await expect(accepted).resolves.toBe(false);
      await stopped;
    });
    expect(harness.stop).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("still stops the exact session after a pending control rejects", async () => {
    const harness = createGateway();
    const pending = deferred<void>();
    harness.runToLocation.mockReturnValueOnce(pending.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await act(async () => void (await ui.hook().startDebug(launch)));
    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 1,
        payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
      });
    });
    let control!: Promise<boolean>;
    let stop!: Promise<void>;
    act(() => {
      control = ui.hook().runToLocation({
        filePath: "/workspace/one/index.js",
        lineNumber: 5,
        columnNumber: 1,
        isCurrent: () => true,
      });
      stop = ui.hook().stopDebug();
    });
    await act(async () => {
      pending.reject(new Error("control failed"));
      await expect(control).rejects.toThrow("control failed");
      await stop;
    });
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);
    ui.unmount();
  });

  it.each(["stop", "disconnect"] as const)(
    "does not %s a same-root session after workspace ownership changes during a pending control",
    async (intent) => {
      const harness = createGateway();
      const pending = deferred<void>();
      harness.runToLocation.mockReturnValueOnce(pending.promise);
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-a");
      await act(async () =>
        ui
          .hook()
          .startDebug(intent === "disconnect" ? { kind: "node-attach", port: 9229 } : launch),
      );
      act(() => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
        });
      });
      let control!: Promise<boolean>;
      let end!: Promise<void>;
      act(() => {
        control = ui.hook().runToLocation({
          filePath: "/workspace/one/index.js",
          lineNumber: 5,
          columnNumber: 1,
          isCurrent: () => true,
        });
        end = intent === "disconnect" ? ui.hook().disconnectDebug() : ui.hook().stopDebug();
      });
      ui.set({ workspaceId: "owner-b" });
      await act(async () => {
        pending.resolve();
        await Promise.all([control, end]);
      });

      expect(harness.stop).not.toHaveBeenCalled();
      expect(harness.disconnect).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it.each(["stop", "disconnect"] as const)(
    "does not expose or %s an active session after an A-B-A owner replacement",
    async (intent) => {
      const harness = createGateway();
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-a");
      await act(async () =>
        ui
          .hook()
          .startDebug(intent === "disconnect" ? { kind: "node-attach", port: 9229 } : launch),
      );
      act(() => {
        harness.emit({
          rootPath: "/workspace/one",
          sessionId: 4,
          seq: 1,
          payload: { kind: "stopped", reason: "breakpoint", frames: [frame], pauseGeneration: 1 },
        });
      });

      ui.set({ workspaceId: "owner-b", workspaceRoot: "/workspace/two" });
      ui.set({ workspaceId: "owner-a", workspaceRoot: "/workspace/one" });
      expect(ui.hook().snapshot.state).toEqual({ kind: "inactive" });
      expect(ui.hook().debugSessionAttached).toBe(false);
      expect(ui.hook().debugStartBlockedByOtherOwner).toBe(true);
      expect(ui.hook().isDebugStartBlocked()).toBe(true);
      expect(ui.hook().pauseOwner).toBeNull();
      expect(ui.hook().output).toEqual([]);

      await act(async () => {
        await ui.hook().pauseDebug();
        await ui.hook().stepDebug("continue");
        await ui.hook().runToLocation({
          filePath: "/workspace/one/index.js",
          lineNumber: 5,
          columnNumber: 1,
          isCurrent: () => true,
        });
        if (intent === "disconnect") {
          await ui.hook().disconnectDebug();
        } else {
          await ui.hook().stopDebug();
        }
      });

      expect(harness.pause).not.toHaveBeenCalled();
      expect(harness.step).not.toHaveBeenCalled();
      expect(harness.runToLocation).not.toHaveBeenCalled();
      expect(harness.stop).not.toHaveBeenCalled();
      expect(harness.disconnect).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it.each(["stop", "disconnect"] as const)(
    "does not project or coalesce an in-flight %s into an A-B-A replacement owner",
    async (intent) => {
      const harness = createGateway();
      const pending = deferred<void>();
      if (intent === "disconnect") {
        harness.disconnect.mockReturnValueOnce(pending.promise);
      } else {
        harness.stop.mockReturnValueOnce(pending.promise);
      }
      const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-a");
      await act(async () =>
        ui
          .hook()
          .startDebug(intent === "disconnect" ? { kind: "node-attach", port: 9229 } : launch),
      );
      let ending!: Promise<void>;
      act(() => {
        ending = intent === "disconnect" ? ui.hook().disconnectDebug() : ui.hook().stopDebug();
      });
      await act(async () => Promise.resolve());
      expect(ui.hook().debugStopPending).toBe(true);

      ui.set({ workspaceId: "owner-b", workspaceRoot: "/workspace/two" });
      ui.set({ workspaceId: "owner-a", workspaceRoot: "/workspace/one" });
      expect(ui.hook().debugStopPending).toBe(false);
      await act(async () => {
        if (intent === "disconnect") {
          await ui.hook().disconnectDebug();
        } else {
          await ui.hook().stopDebug();
        }
      });
      expect(intent === "disconnect" ? harness.disconnect : harness.stop).toHaveBeenCalledOnce();

      pending.resolve();
      await act(async () => {
        await ending;
      });
      expect(ui.hook().debugStopPending).toBe(false);
      ui.unmount();
    },
  );

  it("fails closed for pause and stepping after workspace trust is revoked", async () => {
    const harness = createGateway();
    let trusted = true;
    const ui = renderHook(harness.gateway, "/workspace/one", () => trusted);
    await act(async () => void (await ui.hook().startDebug(launch)));

    trusted = false;
    await act(async () => {
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
      await ui.hook().stepDebug("stepOver");
    });

    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rechecks trust immediately before pause and step gateway calls", async () => {
    const harness = createGateway();
    let trustChecks = 0;
    const isWorkspaceTrusted = () => {
      trustChecks += 1;
      return trustChecks % 2 === 1;
    };
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => void (await ui.hook().startDebug(launch)));
    ui.set({ isWorkspaceTrusted });

    await act(async () => {
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("stepInto");
    });

    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("blocks pause and stepping during an exact-root active stop while Stop remains coalesced", async () => {
    const harness = createGateway();
    const stopped = deferred<void>();
    harness.stop.mockReturnValueOnce(stopped.promise);
    const ui = renderHook(harness.gateway, "/workspace/one");
    await act(async () => void (await ui.hook().startDebug(launch)));

    let firstStop!: Promise<void>;
    let secondStop!: Promise<void>;
    act(() => {
      firstStop = ui.hook().stopDebug();
      secondStop = ui.hook().stopDebug();
    });
    await act(async () => {
      await ui.hook().pauseDebug();
      await ui.hook().stepDebug("continue");
    });

    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.step).not.toHaveBeenCalled();
    expect(harness.stop).toHaveBeenCalledExactlyOnceWith(4);

    await act(async () => {
      stopped.resolve();
      await Promise.all([firstStop, secondStop]);
    });
    expect(ui.hook().debugStopPending).toBe(false);
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
      async (_rootPath, _sessionId, _filePath, breakpoints) =>
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
      "/workspace/one",
      4,
      "/workspace/one/index.js",
      [expect.objectContaining({ id: "bp-1", lineNumber: 3 })],
    );
    expect(harness.setBreakpoints).toHaveBeenCalledWith(
      "/workspace/one",
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

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(2);

    ui.unmount();
    expect(handlers.size).toBe(0);
  });

  it("publishes Node breakpoint activation only after the exact session ACK", async () => {
    const harness = createGateway();
    const ack = deferred<void>();
    harness.setBreakpointsActive.mockReturnValueOnce(ack.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);
    const persistedBreakpoints = ui.hook().breakpoints;

    let toggle!: Promise<boolean>;
    act(() => {
      toggle = ui.hook().toggleBreakpointsActivated();
    });
    expect(harness.setBreakpointsActive).toHaveBeenCalledWith({
      rootPath: "/workspace/one",
      sessionId: 4,
      active: false,
    });
    expect(ui.hook().breakpointsActivated).toBe(true);
    expect(ui.hook().canToggleBreakpointsActivated()).toBe(false);

    await act(async () => {
      ack.resolve();
      await toggle;
    });
    expect(ui.hook().breakpointsActivated).toBe(false);
    expect(ui.hook().breakpoints).toBe(persistedBreakpoints);
    ui.unmount();
  });

  it("drops a stale breakpoint activation ACK after an A-B-A workspace switch", async () => {
    const harness = createGateway();
    const ack = deferred<void>();
    harness.setBreakpointsActive.mockReturnValueOnce(ack.promise);
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);

    let toggle!: Promise<boolean>;
    act(() => {
      toggle = ui.hook().toggleBreakpointsActivated();
    });
    ui.set({ workspaceId: "owner-2", workspaceRoot: "/workspace/two" });
    ui.set({ workspaceId: "owner-1", workspaceRoot: "/workspace/one" });
    await act(async () => {
      ack.resolve();
      expect(await toggle).toBe(false);
    });
    expect(ui.hook().breakpointsActivated).toBe(true);
    ui.unmount();
  });

  it("rolls back a failed activation toggle, allows retry, and resets on termination", async () => {
    const harness = createGateway();
    harness.setBreakpointsActive.mockRejectedValueOnce(new Error("CDP unavailable"));
    const ui = renderHook(harness.gateway, "/workspace/one", () => true, false, "owner-1");
    await startStoppedNodeSession(ui, harness);

    await act(async () => {
      await expect(ui.hook().toggleBreakpointsActivated()).rejects.toThrow("CDP unavailable");
    });
    expect(ui.hook().breakpointsActivated).toBe(true);
    await act(async () => {
      expect(await ui.hook().toggleBreakpointsActivated()).toBe(true);
    });
    expect(ui.hook().breakpointsActivated).toBe(false);

    act(() => {
      harness.emit({
        rootPath: "/workspace/one",
        sessionId: 4,
        seq: 2,
        payload: { kind: "terminated", exitCode: 0 },
      });
    });
    expect(ui.hook().breakpointsActivated).toBe(true);
    ui.unmount();
  });

  it("invalidates Watch and variable inspection caches after Set Expression settles", async () => {
    const harness = createGateway();
    harness.variablesPage.mockResolvedValueOnce({
      variables: [{ name: "child", value: "1", variablesReference: 0 }],
      start: 0,
      returned: 1,
      truncated: false,
    });
    harness.setExpression.mockResolvedValueOnce({
      setExpressionReference: 31,
      expression: "count",
      value: { status: "ok", value: "43", variablesReference: 0 },
    });
    const ui = renderHook(harness.gateway, "/workspace/one");
    await startStoppedNodeSession(ui, harness);
    await act(async () => void (await ui.hook().loadVariables(21)));
    expect(ui.hook().variablePages.references[21]).toBeDefined();
    expect(ui.hook().debugInspectionRevision).toBe(0);

    await act(async () => {
      await ui.hook().setWatchExpression(
        {
          definitionId: "watch-1",
          definitionRevision: 1,
          expression: "count",
          owner: {
            rootKey: "/workspace/one",
            sessionId: 4,
            pauseGeneration: 1,
            frameId: 11,
          },
          setExpressionReference: 31,
          isCurrent: () => true,
        },
        "43",
      );
    });
    expect(ui.hook().variablePages.references).toEqual({});
    expect(ui.hook().debugInspectionRevision).toBe(1);
    ui.unmount();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, reject, resolve };
}
