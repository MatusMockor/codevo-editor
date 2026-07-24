// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Breakpoint, StackFrame } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import {
  createDebugConsoleState,
  reduceDebugConsoleState,
  type DebugConsoleState,
} from "../domain/debugConsoleState";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import { DebugPanel, type DebugPanelProps } from "./DebugPanel";

const FRAME_A: StackFrame = {
  frameId: 1,
  name: "main",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  column: 3,
};

const FRAME_B: StackFrame = {
  frameId: 2,
  name: "helper",
  filePath: null,
  lineNumber: 4,
  column: 1,
};

const FRAME_C: StackFrame = {
  frameId: 3,
  name: "worker",
  filePath: "/workspace/src/worker.ts",
  lineNumber: 8,
  column: 1,
};

const BREAKPOINT: Breakpoint = {
  id: "bp-1",
  filePath: "/workspace/src/index.ts",
  lineNumber: 12,
  enabled: true,
};

function stoppedSnapshot(): DebuggerSessionSnapshot {
  return {
    state: {
      kind: "stopped",
      sessionId: 7,
      reason: "breakpoint",
      frames: [FRAME_A, FRAME_B],
      topFrame: FRAME_A,
    },
    lastSeq: 3,
  };
}

function defaultProps(): DebugPanelProps {
  return {
    breakpointBulkMutationPending: false,
    breakpointCounts: { disabled: 0, enabled: 0 },
    breakpoints: [],
    console: consoleResult(),
    debugAdapterKind: null,
    exceptionPauseError: null,
    exceptionPauseMode: "none",
    exceptionPausePending: false,
    hasJavaScriptTypeScriptWorkspace: true,
    lastStartError: null,
    onLoadVariables: vi.fn(),
    onDisableAllBreakpoints: vi.fn(),
    onDisconnect: vi.fn(),
    onEnableAllBreakpoints: vi.fn(),
    onNavigateToBreakpoint: vi.fn(),
    onNavigateToFrame: vi.fn(),
    onPause: vi.fn(),
    onRemoveBreakpoint: vi.fn(),
    onRemoveAllBreakpoints: vi.fn(),
    onSelectFrame: vi.fn(),
    onSetBreakpointCondition: vi.fn(),
    onSetBreakpointHitCondition: vi.fn(),
    onSetBreakpointLogMessage: vi.fn(),
    onSetBreakpointEnabled: vi.fn(),
    onSetExceptionPauseMode: vi.fn(),
    onStep: vi.fn(),
    onStop: vi.fn(),
    rootPath: "/workspace",
    scopes: [],
    selectedFrameId: null,
    snapshot: { state: { kind: "inactive" }, lastSeq: 0 },
    variablesByReference: {},
    watches: {
      definitions: [],
      evaluations: {},
      pendingIds: [],
      onAdd: vi.fn(),
      onClear: vi.fn(),
      onRemove: vi.fn(),
      onSetEnabled: vi.fn(),
      onUpdate: vi.fn(),
    },
    workspaceTrusted: true,
  };
}

function consoleResult(
  state: DebugConsoleState = createDebugConsoleState({ sessionId: 7, pauseGeneration: 1 }),
  submit = vi.fn().mockResolvedValue(undefined),
): UseDebugConsoleResult {
  return { state, clear: vi.fn(), submit };
}

function populatedConsole(
  entries: Array<
    | { stream: "stdout" | "stderr"; text: string }
    | { expression: string; result?: { value: string; type?: string | null }; error?: string }
  >,
): UseDebugConsoleResult {
  const owner = { sessionId: 7, pauseGeneration: 1 };
  let state = createDebugConsoleState(owner);
  entries.forEach((entry, index) => {
    if ("stream" in entry) {
      state = reduceDebugConsoleState(state, { type: "output", owner, ...entry });
      return;
    }
    const requestId = `request-${index}`;
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId,
      expression: entry.expression,
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId,
      result: entry.error
        ? { status: "error", kind: "exception", message: entry.error }
        : { status: "ok", value: entry.result?.value ?? "", type: entry.result?.type },
    });
  });
  return consoleResult(state);
}

describe("DebugPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(overrides: Partial<DebugPanelProps>) {
    const props = { ...defaultProps(), ...overrides };
    act(() => {
      root.render(<DebugPanel {...props} />);
    });

    return props;
  }

  function button(label: string): HTMLButtonElement {
    const element =
      host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
      host.querySelector<HTMLButtonElement>(`[role="treeitem"][aria-label="${label}"]`);
    expect(element).not.toBeNull();

    return element as HTMLButtonElement;
  }

  it("disables all session controls while inactive and labels the state", () => {
    render({ snapshot: { state: { kind: "inactive" }, lastSeq: 0 } });

    for (const label of [
      "Continue",
      "Pause",
      "Restart debugging",
      "Step over",
      "Step into",
      "Step out",
      "Stop debugging",
    ]) {
      expect(button(label).disabled).toBe(true);
    }
    expect(host.querySelector('[data-testid="debug-status"]')?.textContent).toBe("Inactive");
  });

  it("shows Copy Call Stack only from its public capability and rechecks it on click", () => {
    let accepted = true;
    const copyStackTrace = vi.fn(() => true);
    const canCopyStackTrace = vi.fn(() => accepted);
    render({
      debugCopyStackTrace: { canCopyStackTrace, copyStackTrace },
      workspaceTrusted: false,
    });

    const copy = button("Copy Call Stack");
    expect(copy.title).toBe("Copy Call Stack");
    expect(copy.closest('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Call stack actions");

    accepted = false;
    act(() => copy.click());
    expect(copyStackTrace).not.toHaveBeenCalled();
    expect(canCopyStackTrace).toHaveBeenCalledTimes(2);

    accepted = true;
    act(() => copy.click());
    expect(copyStackTrace).toHaveBeenCalledOnce();
  });

  it("hides Copy Call Stack when the public capability is absent, false, or throws", () => {
    for (const debugCopyStackTrace of [
      undefined,
      { canCopyStackTrace: () => false, copyStackTrace: vi.fn(() => true) },
      {
        canCopyStackTrace: () => {
          throw new Error("capability unavailable");
        },
        copyStackTrace: vi.fn(() => true),
      },
    ]) {
      render({ debugCopyStackTrace });
      expect(host.querySelector('button[aria-label="Copy Call Stack"]')).toBeNull();
    }
  });

  it("integrates the controlled Node launch selector with session and trust guards", () => {
    const onStartSelected = vi.fn();
    render({
      nodeLaunchConfigurations: {
        busy: false,
        choices: [{ default: true, name: "API", targetKind: "script" }],
        error: null,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartSelected,
        selectedName: "API",
        state: "ready",
      },
    });
    act(() => button("Start selected Node launch configuration").click());
    expect(onStartSelected).toHaveBeenCalledOnce();

    render({
      nodeLaunchConfigurations: {
        busy: false,
        choices: [{ default: true, name: "API", targetKind: "script" }],
        error: null,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartSelected,
        selectedName: "API",
        state: "ready",
      },
      snapshot: { state: { kind: "starting", sessionId: 7 }, lastSeq: 0 },
    });
    expect(button("Start selected Node launch configuration").disabled).toBe(true);

    render({
      nodeLaunchConfigurations: {
        busy: false,
        choices: [{ default: true, name: "API", targetKind: "script" }],
        error: null,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartSelected,
        selectedName: "API",
        state: "ready",
      },
      workspaceTrusted: false,
    });
    expect(button("Start selected Node launch configuration").disabled).toBe(true);
  });

  it.each([
    ["an explicit stop", { debugStopPending: true }],
    ["a restart", { debugRestartPending: true }],
  ] satisfies ReadonlyArray<[string, Partial<DebugPanelProps>]>)(
    "locks Node launch selection, start, and refresh during %s even after the session is inactive",
    (_label, pendingProps) => {
      render({
        ...pendingProps,
        nodeLaunchConfigurations: {
          busy: false,
          choices: [{ default: true, name: "API", targetKind: "script" }],
          error: null,
          onLoad: vi.fn(),
          onRefresh: vi.fn(),
          onSelect: vi.fn(),
          onStartSelected: vi.fn(),
          selectedName: "API",
          state: "ready",
        },
        snapshot: { state: { kind: "inactive" }, lastSeq: 2 },
      });

      expect(host.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
      expect(button("Start selected Node launch configuration").disabled).toBe(true);
      expect(button("Refresh Node launch configurations").disabled).toBe(true);
    },
  );

  it("enables the Stop surface while a native compound batch is pending", () => {
    const onStop = vi.fn();
    render({
      debugCompoundStartPending: true,
      onStop,
      snapshot: { state: { kind: "inactive" }, lastSeq: 0 },
    });

    const stop = button("Stop debugging");
    expect(stop.disabled).toBe(false);
    act(() => stop.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("renders the Node-only breakpoint activation toggle with accessible state", () => {
    const onToggleBreakpointsActivated = vi.fn();
    render({
      breakpointsActivated: true,
      canToggleBreakpointsActivated: true,
      debugAdapterKind: "node",
      onToggleBreakpointsActivated,
      snapshot: stoppedSnapshot(),
    });
    const deactivate = button("Deactivate breakpoints");
    expect(deactivate.disabled).toBe(false);
    expect(deactivate.getAttribute("aria-pressed")).toBe("true");
    act(() => deactivate.click());
    expect(onToggleBreakpointsActivated).toHaveBeenCalledOnce();

    render({
      breakpointsActivated: false,
      canToggleBreakpointsActivated: true,
      debugAdapterKind: "node",
      onToggleBreakpointsActivated,
      snapshot: stoppedSnapshot(),
    });
    expect(button("Activate breakpoints").getAttribute("aria-pressed")).toBe("false");

    render({
      breakpointsActivated: true,
      canToggleBreakpointsActivated: true,
      debugAdapterKind: "php",
      onToggleBreakpointsActivated,
      snapshot: stoppedSnapshot(),
    });
    expect(host.querySelector('button[aria-label="Deactivate breakpoints"]')).toBeNull();
  });

  it("hides Node launch controls in a PHP-only workspace", () => {
    render({
      hasJavaScriptTypeScriptWorkspace: false,
      nodeLaunchConfigurations: {
        busy: false,
        choices: [{ default: true, name: "API", targetKind: "script" }],
        error: null,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartSelected: vi.fn(),
        selectedName: "API",
        state: "ready",
      },
    });

    expect(host.querySelector('[aria-label="Node launch configuration controls"]')).toBeNull();
  });

  it("exposes the owner-safe Run picker action only for a JavaScript or TypeScript workspace", () => {
    const openPicker = vi.fn();
    const picker = { canOpenPicker: () => true, openPicker };

    render({ nodeRunWithoutDebuggingPicker: picker });
    const action = button("Select and start without debugging");
    expect(action.disabled).toBe(false);
    act(() => action.click());
    expect(openPicker).toHaveBeenCalledOnce();

    render({
      hasJavaScriptTypeScriptWorkspace: false,
      nodeRunWithoutDebuggingPicker: picker,
    });
    expect(
      host.querySelector('button[aria-label="Select and start without debugging"]'),
    ).toBeNull();
  });

  it("exposes the configuration gear only for a JavaScript or TypeScript workspace", () => {
    const openNodeLaunchConfigurations = vi.fn();

    render({ onOpenNodeLaunchConfigurations: openNodeLaunchConfigurations });
    const action = button("Configure Node launch configurations");
    expect(action.type).toBe("button");
    expect(action.title).toBe("Run: Configure Node Launch Configurations");
    act(() => action.click());
    expect(openNodeLaunchConfigurations).toHaveBeenCalledOnce();

    render({
      hasJavaScriptTypeScriptWorkspace: false,
      onOpenNodeLaunchConfigurations: openNodeLaunchConfigurations,
    });
    expect(
      host.querySelector('button[aria-label="Configure Node launch configurations"]'),
    ).toBeNull();
  });

  it("renders the keyboard-first Node configuration picker inside the debug panel", () => {
    const onClosePicker = vi.fn();
    const onStartNamed = vi.fn();
    render({
      nodeLaunchConfigurations: {
        busy: false,
        choices: [
          { default: true, name: "API", targetKind: "script" },
          { default: false, name: "Worker", targetKind: "npm" },
        ],
        error: null,
        onClosePicker,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartNamed,
        onStartSelected: vi.fn(),
        pickerOpen: true,
        selectedName: "API",
        state: "ready",
      },
    });

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    expect(onStartNamed).toHaveBeenCalledWith("API");
    expect(onClosePicker).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-JavaScript workspace", { hasJavaScriptTypeScriptWorkspace: false }],
    ["an untrusted workspace", { workspaceTrusted: false }],
    ["a pending explicit stop", { debugStopPending: true }],
    ["a pending restart", { debugRestartPending: true }],
    [
      "a starting debugger",
      { snapshot: { state: { kind: "starting", sessionId: 7 }, lastSeq: 0 } },
    ],
    ["a running debugger", { snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 } }],
    ["a stopped debugger", { snapshot: stoppedSnapshot() }],
  ] satisfies ReadonlyArray<[string, Partial<DebugPanelProps>]>)(
    "fails closed instead of rendering a stale Node picker for %s",
    (_label, staleProps) => {
      render({
        ...staleProps,
        nodeLaunchConfigurations: {
          busy: false,
          choices: [{ default: true, name: "API", targetKind: "script" }],
          error: null,
          onLoad: vi.fn(),
          onRefresh: vi.fn(),
          onSelect: vi.fn(),
          onStartNamed: vi.fn(),
          onStartSelected: vi.fn(),
          pickerOpen: true,
          selectedName: "API",
          state: "ready",
        },
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it("enables pause and stop while running", () => {
    render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    expect(button("Pause").disabled).toBe(false);
    expect(button("Stop debugging").disabled).toBe(false);
    expect(button("Continue").disabled).toBe(true);
    expect(button("Step over").disabled).toBe(true);
    expect(host.querySelector('[data-testid="debug-status"]')?.textContent).toBe("Running");
  });

  it("presents an attached session as an accessible retry-safe Disconnect action", () => {
    const onDisconnect = vi.fn();
    render({
      debugSessionAttached: true,
      onDisconnect,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    const disconnect = button("Disconnect debugging");
    expect(disconnect.disabled).toBe(false);
    expect(disconnect.title).toBe("Disconnect debugging");
    expect(disconnect.querySelector(".lucide-unplug")).not.toBeNull();
    act(() => disconnect.click());
    expect(onDisconnect).toHaveBeenCalledOnce();

    render({
      debugSessionAttached: true,
      debugStopPending: true,
      onDisconnect,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    const pending = button("Disconnect debugging");
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.title).toBe("Disconnecting debugging");
  });

  it("requires a disconnect callback in the public panel contract", () => {
    expectTypeOf<DebugPanelProps>().toMatchTypeOf<{ onDisconnect(): void }>();
  });

  it("restarts only an eligible trusted active Node session", () => {
    const onRestart = vi.fn();
    render({
      debugAdapterKind: "node",
      onRestart,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    expect(button("Restart debugging").disabled).toBe(true);

    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      onRestart,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    expect(button("Restart debugging").disabled).toBe(false);
    act(() => button("Restart debugging").click());
    expect(onRestart).toHaveBeenCalledOnce();

    render({
      canRestartDebug: true,
      debugAdapterKind: "php",
      onRestart,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    expect(button("Restart debugging").disabled).toBe(true);

    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      onRestart,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
      workspaceTrusted: false,
    });
    expect(button("Restart debugging").disabled).toBe(true);

    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      onRestart,
      snapshot: { state: { kind: "starting", sessionId: 7 }, lastSeq: 0 },
    });
    expect(button("Restart debugging").disabled).toBe(true);
  });

  it("exposes restart progress accessibly and does not render private launch data", () => {
    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      debugRestartPending: true,
      nodeLaunchConfigurations: {
        busy: false,
        choices: [
          {
            args: ["--private-argument"],
            default: true,
            env: { SECRET: "private-environment-value" },
            name: "API",
            targetKind: "script",
          } as never,
        ],
        error: null,
        onLoad: vi.fn(),
        onRefresh: vi.fn(),
        onSelect: vi.fn(),
        onStartSelected: vi.fn(),
        selectedName: "API",
        state: "ready",
      },
      onRestart: vi.fn(),
      snapshot: stoppedSnapshot(),
    });

    const restart = button("Restart debugging");
    expect(restart.disabled).toBe(true);
    expect(restart.getAttribute("aria-busy")).toBe("true");
    expect(restart.title).toBe("Restarting debugging");
    expect(host.textContent).not.toContain("--private-argument");
    expect(host.textContent).not.toContain("private-environment-value");
  });

  it("disables restart while an explicit stop is pending", () => {
    const onRestart = vi.fn();
    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      debugStopPending: true,
      onRestart,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    const restart = button("Restart debugging");
    expect(restart.disabled).toBe(true);
    expect(restart.title).toBe("Stopping debugging");
    act(() => restart.click());
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("locks every toolbar session mutation while an explicit stop is pending", () => {
    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      debugStopPending: true,
      onRestart: vi.fn(),
      snapshot: stoppedSnapshot(),
    });

    for (const label of [
      "Continue",
      "Pause",
      "Restart debugging",
      "Step over",
      "Step into",
      "Step out",
      "Stop debugging",
    ]) {
      expect(button(label).disabled, label).toBe(true);
    }
    expect(button("Stop debugging").getAttribute("aria-busy")).toBe("true");
    expect(button("Stop debugging").title).toBe("Stopping debugging");
  });

  it("locks every toolbar session mutation while a restart is pending", () => {
    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      debugRestartPending: true,
      onRestart: vi.fn(),
      snapshot: stoppedSnapshot(),
    });

    for (const label of [
      "Continue",
      "Pause",
      "Restart debugging",
      "Step over",
      "Step into",
      "Step out",
      "Stop debugging",
    ]) {
      expect(button(label).disabled, label).toBe(true);
    }
    expect(button("Restart debugging").getAttribute("aria-busy")).toBe("true");
  });

  it("revokes trusted mutations but keeps stop available", () => {
    render({
      canRestartDebug: true,
      debugAdapterKind: "node",
      onRestart: vi.fn(),
      snapshot: stoppedSnapshot(),
      workspaceTrusted: false,
    });

    for (const label of ["Continue", "Restart debugging", "Step over", "Step into", "Step out"]) {
      expect(button(label).disabled, label).toBe(true);
    }
    expect(button("Stop debugging").disabled).toBe(false);

    render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
      workspaceTrusted: false,
    });
    expect(button("Pause").disabled).toBe(true);
    expect(button("Stop debugging").disabled).toBe(false);
  });

  it("configures exception pausing before the first Node run", () => {
    const props = render({});
    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Pause on exceptions"]',
    );
    expect(select?.disabled).toBe(false);
    act(() => {
      if (!select) return;
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(props.onSetExceptionPauseMode).toHaveBeenCalledWith("all");
  });

  it("enables live changes only for Node sessions and exposes pending errors", () => {
    render({
      debugAdapterKind: "node",
      exceptionPauseError: "CDP rejected pause policy",
      exceptionPauseMode: "uncaught",
      exceptionPausePending: true,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Pause on exceptions"]',
    );
    expect(select?.value).toBe("uncaught");
    expect(select?.disabled).toBe(true);
    expect(select?.closest("label")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("CDP rejected");

    render({
      debugAdapterKind: "node",
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Pause on exceptions"]')?.disabled,
    ).toBe(false);
  });

  it("disables exception pausing without a JS workspace and during PHP sessions", () => {
    render({ hasJavaScriptTypeScriptWorkspace: false });
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Pause on exceptions"]')?.disabled,
    ).toBe(true);
    render({
      debugAdapterKind: "php",
      hasJavaScriptTypeScriptWorkspace: true,
      snapshot: {
        state: { kind: "stopped", sessionId: 7, reason: "pause", frames: [], topFrame: null },
        lastSeq: 1,
      },
    });
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Pause on exceptions"]')?.disabled,
    ).toBe(true);
  });

  it("enables stepping while stopped and reports the pause reason", () => {
    const props = render({ snapshot: stoppedSnapshot() });

    expect(button("Pause").disabled).toBe(true);
    expect(button("Stop debugging").disabled).toBe(false);

    for (const [label, kind] of [
      ["Continue", "continue"],
      ["Step over", "stepOver"],
      ["Step into", "stepInto"],
      ["Step out", "stepOut"],
    ] as const) {
      expect(button(label).disabled).toBe(false);
      act(() => button(label).click());
      expect(props.onStep).toHaveBeenCalledWith(kind);
    }

    act(() => button("Stop debugging").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="debug-status"]')?.textContent).toBe(
      "Paused (breakpoint)",
    );
  });

  it("composes the extracted watch panel with debugger context", () => {
    const onAdd = vi.fn();
    render({
      debugAdapterKind: "php",
      snapshot: stoppedSnapshot(),
      watches: {
        ...defaultProps().watches,
        definitions: [{ id: "watch-1", expression: "$count", enabled: true, revision: 1 }],
        onAdd,
      },
    });
    expect(host.querySelector('[aria-label="Watch expressions"]')).not.toBeNull();
    expect(host.textContent).toContain("not supported for PHP");
    expect(host.textContent).toContain("$count");
  });

  it("allows stopping while the session is starting", () => {
    const props = render({
      snapshot: { state: { kind: "starting", sessionId: 7 }, lastSeq: 0 },
    });

    expect(button("Stop debugging").disabled).toBe(false);
    expect(button("Continue").disabled).toBe(true);
    expect(button("Pause").disabled).toBe(true);
    expect(host.querySelector('[data-testid="debug-status"]')?.textContent).toBe("Starting");

    act(() => button("Stop debugging").click());
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("pauses a running session", () => {
    const props = render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    act(() => button("Pause").click());

    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it("reports the exit code after termination and the last start error", () => {
    render({
      lastStartError: "node not found",
      snapshot: {
        state: { kind: "terminated", sessionId: 7, exitCode: 2 },
        lastSeq: 9,
      },
    });

    expect(host.querySelector('[data-testid="debug-status"]')?.textContent).toBe(
      "Terminated (exit code 2)",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("node not found");
  });

  it("lists stack frames, highlights the selection, and navigates on click", () => {
    const props = render({
      selectedFrameId: 2,
      snapshot: stoppedSnapshot(),
    });

    const frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');
    expect(frames).toHaveLength(2);
    expect(frames[0]?.textContent).toContain("main");
    expect(frames[0]?.textContent).toContain("src/index.ts:12");
    expect(frames[0]?.getAttribute("aria-current")).toBeNull();
    expect(frames[1]?.getAttribute("aria-current")).toBe("true");
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([-1, 0]);

    act(() => frames[0]?.click());

    expect(props.onSelectFrame).toHaveBeenCalledWith(1);
    expect(props.onNavigateToFrame).toHaveBeenCalledWith("/workspace/src/index.ts", 12);
  });

  it("shows one accessible Restart Frame action only for the selected restartable Node frame", () => {
    const restartFrame = vi.fn(() => true);
    const canRestartFrame = vi.fn(() => true);
    render({
      debugAdapterKind: "node",
      debugRestartFrame: { canRestartFrame, restartFrame },
      selectedFrameId: 2,
      snapshot: stoppedSnapshot(),
    });

    const actions = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Restart Frame"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Restart Frame");
    expect(
      actions[0]?.parentElement?.querySelector('[aria-current="true"]')?.textContent,
    ).toContain("helper");

    const capabilityChecksBeforeClick = canRestartFrame.mock.calls.length;
    act(() => actions[0]?.click());
    expect(restartFrame).toHaveBeenCalledOnce();
    expect(restartFrame).toHaveBeenCalledWith();
    expect(canRestartFrame).toHaveBeenCalledTimes(capabilityChecksBeforeClick + 1);
  });

  it("updates Restart Frame visibility from its live capability and fails closed", () => {
    let allowed = true;
    const debugRestartFrame = {
      canRestartFrame: vi.fn(() => allowed),
      restartFrame: vi.fn(() => true),
    };
    const props = {
      ...defaultProps(),
      debugAdapterKind: "node" as const,
      debugRestartFrame,
      snapshot: stoppedSnapshot(),
    };

    act(() => root.render(<DebugPanel {...props} />));
    expect(host.querySelectorAll('button[aria-label="Restart Frame"]')).toHaveLength(1);

    allowed = false;
    act(() => root.render(<DebugPanel {...props} />));
    expect(host.querySelector('button[aria-label="Restart Frame"]')).toBeNull();

    debugRestartFrame.canRestartFrame.mockImplementation(() => {
      throw new Error("stale capability");
    });
    act(() => root.render(<DebugPanel {...props} />));
    expect(host.querySelector('button[aria-label="Restart Frame"]')).toBeNull();
  });

  it("renders at most one Restart Frame action for a malformed duplicate frame id", () => {
    const duplicate = { ...FRAME_A, name: "duplicate" };
    render({
      debugAdapterKind: "node",
      debugRestartFrame: { canRestartFrame: () => true, restartFrame: () => true },
      snapshot: {
        lastSeq: 3,
        state: {
          frames: [FRAME_A, duplicate],
          kind: "stopped",
          reason: "breakpoint",
          sessionId: 7,
          topFrame: FRAME_A,
        },
      },
    });

    expect(host.querySelectorAll('button[aria-label="Restart Frame"]')).toHaveLength(1);
  });

  it("hides Restart Frame outside eligible Node frames and presentation hints", () => {
    const command = { canRestartFrame: () => true, restartFrame: () => true };
    const hintedSnapshot = (presentationHint: "label" | "subtle"): DebuggerSessionSnapshot => ({
      lastSeq: 3,
      state: {
        kind: "stopped",
        sessionId: 7,
        reason: "breakpoint",
        frames: [{ ...FRAME_A, presentationHint } as StackFrame],
        topFrame: { ...FRAME_A, presentationHint } as StackFrame,
      },
    });

    for (const overrides of [
      { debugAdapterKind: "php" as const, snapshot: stoppedSnapshot() },
      {
        debugAdapterKind: "node" as const,
        snapshot: { state: { kind: "running" as const, sessionId: 7 }, lastSeq: 4 },
      },
      { debugAdapterKind: "node" as const, snapshot: hintedSnapshot("label") },
      { debugAdapterKind: "node" as const, snapshot: hintedSnapshot("subtle") },
      {
        debugAdapterKind: "node" as const,
        debugControlPending: true,
        snapshot: stoppedSnapshot(),
      },
      {
        debugAdapterKind: "node" as const,
        snapshot: stoppedSnapshot(),
        workspaceTrusted: false,
      },
    ]) {
      render({ ...overrides, debugRestartFrame: command });
      expect(host.querySelector('button[aria-label="Restart Frame"]')).toBeNull();
    }
  });

  it("roves keyboard focus across visible frames without selecting or navigating", () => {
    const props = render({ selectedFrameId: 2, snapshot: stoppedSnapshot() });
    const frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');

    const arrowUp = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    act(() => {
      frames[1]?.focus();
      frames[1]?.dispatchEvent(arrowUp);
    });
    expect(arrowUp.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(frames[0]);
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([0, -1]);
    expect(frames[1]?.getAttribute("aria-current")).toBe("true");
    expect(props.onSelectFrame).not.toHaveBeenCalled();
    expect(props.onNavigateToFrame).not.toHaveBeenCalled();

    act(() => {
      frames[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement).toBe(frames[1]);
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([-1, 0]);

    act(() => {
      frames[1]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement).toBe(frames[0]);
    act(() => {
      frames[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.activeElement).toBe(frames[1]);
    expect(props.onSelectFrame).not.toHaveBeenCalled();
    expect(props.onNavigateToFrame).not.toHaveBeenCalled();
  });

  it("follows external selection and preserves owned focus when a frame disappears", () => {
    const props = {
      ...defaultProps(),
      selectedFrameId: 1,
      snapshot: {
        ...stoppedSnapshot(),
        state: {
          ...stoppedSnapshot().state,
          frames: [FRAME_A, FRAME_B, FRAME_C],
        },
      } as DebuggerSessionSnapshot,
    };
    act(() => root.render(<DebugPanel {...props} />));
    let frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');
    act(() => frames[1]?.focus());
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([-1, 0, -1]);

    act(() => root.render(<DebugPanel {...props} selectedFrameId={3} />));
    frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([-1, -1, 0]);
    expect(frames[2]?.getAttribute("aria-current")).toBe("true");

    act(() => frames[1]?.focus());
    const reducedSnapshot: DebuggerSessionSnapshot = {
      lastSeq: props.snapshot.lastSeq,
      state: {
        kind: "stopped",
        sessionId: 7,
        reason: "breakpoint",
        frames: [FRAME_A, FRAME_C],
        topFrame: FRAME_A,
      },
    };
    act(() =>
      root.render(<DebugPanel {...props} selectedFrameId={1} snapshot={reducedSnapshot} />),
    );
    frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');
    expect(document.activeElement).toBe(frames[0]);
    expect([...frames].map((frame) => frame.tabIndex)).toEqual([0, -1]);
    expect(props.onSelectFrame).not.toHaveBeenCalled();
    expect(props.onNavigateToFrame).not.toHaveBeenCalled();
  });

  it("falls back to the first visible tab stop when the selected frame is hidden", () => {
    render({ selectedFrameId: 99, snapshot: stoppedSnapshot() });
    const frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');

    expect([...frames].map((frame) => frame.tabIndex)).toEqual([0, -1]);
    expect([...frames].every((frame) => frame.getAttribute("aria-current") === null)).toBe(true);
  });

  it("exposes no frame tab stop for an empty or non-stopped call stack", () => {
    render({
      snapshot: {
        state: { kind: "stopped", sessionId: 7, reason: "pause", frames: [], topFrame: null },
        lastSeq: 1,
      },
    });
    expect(host.textContent).toContain("No stack frames");
    expect(host.querySelector('[data-testid="debug-frame"]')).toBeNull();

    render({ snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 2 } });
    expect(host.textContent).toContain("Not paused");
    expect(host.querySelector('[data-testid="debug-frame"]')).toBeNull();
  });

  it("falls back to highlighting the top frame and skips navigation without a file", () => {
    const props = render({ snapshot: stoppedSnapshot() });

    const frames = host.querySelectorAll<HTMLButtonElement>('[data-testid="debug-frame"]');
    expect(frames[0]?.getAttribute("aria-current")).toBe("true");
    expect(frames[0]?.tabIndex).toBe(0);

    act(() => frames[1]?.click());

    expect(props.onSelectFrame).toHaveBeenCalledWith(2);
    expect(props.onNavigateToFrame).not.toHaveBeenCalled();
  });

  it("expands scopes lazily and renders loaded variables with their types", () => {
    const props = render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {},
    });

    const scope = host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]');
    expect(scope?.textContent).toContain("Local");

    act(() => scope?.click());
    expect(props.onLoadVariables).toHaveBeenCalledWith(10);

    render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [
          { name: "count", value: "3", type: "number", variablesReference: 0 },
          { name: "user", value: "Object", variablesReference: 11 },
        ],
      },
    });

    const variables = host.querySelectorAll('[data-testid="debug-variable"]');
    expect(variables[0]?.textContent).toContain("count");
    expect(variables[0]?.textContent).toContain("3");
    expect(variables[0]?.textContent).toContain("number");
  });

  it("expands nested variables lazily", () => {
    const props = render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [{ name: "user", value: "Object", variablesReference: 11 }],
      },
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click();
    });
    act(() => button("Expand user").click());

    expect(props.onLoadVariables).toHaveBeenCalledWith(11);
  });

  it("renders a cyclic variable reference without recursing", () => {
    render({
      scopes: [{ name: "Local", variablesReference: 10, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference: {
        10: [{ name: "self", value: "Object", variablesReference: 10 }],
      },
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click();
    });

    const variables = host.querySelectorAll('[data-testid="debug-variable"]');
    expect(variables).toHaveLength(1);
    expect(variables[0]?.textContent).toContain("self");
    expect(host.querySelector('button[aria-label="Expand self"]')).toBeNull();
  });

  it("stops offering expansion beyond the depth cap", () => {
    const variablesByReference: Record<
      number,
      { name: string; value: string; variablesReference: number }[]
    > = {};
    for (let level = 0; level < 15; level += 1) {
      variablesByReference[100 + level] = [
        {
          name: `v${level + 1}`,
          value: "Object",
          variablesReference: 101 + level,
        },
      ];
    }

    render({
      scopes: [{ name: "Local", variablesReference: 100, expensive: false }],
      snapshot: stoppedSnapshot(),
      variablesByReference,
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="debug-scope"]')?.click();
    });

    for (let level = 1; level < 10; level += 1) {
      act(() => button(`Expand v${level}`).click());
    }

    expect(host.querySelector('button[aria-label="Expand v10"]')).toBeNull();
  });

  it("manages breakpoints from the list", () => {
    const props = render({ breakpoints: [BREAKPOINT] });

    const row = host.querySelector('[data-testid="debug-breakpoint"]');
    expect(row?.textContent).toContain("src/index.ts:12");

    const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    act(() => checkbox?.click());
    expect(props.onSetBreakpointEnabled).toHaveBeenCalledWith("bp-1", false);

    act(() => {
      row?.querySelector<HTMLButtonElement>('[data-testid="debug-breakpoint-location"]')?.click();
    });
    expect(props.onNavigateToBreakpoint).toHaveBeenCalledWith(BREAKPOINT);

    act(() => button("Remove breakpoint").click());
    expect(props.onRemoveBreakpoint).toHaveBeenCalledWith("bp-1");
  });

  it("renders an inline breakpoint with its exact accessible column label", () => {
    const inline = { ...BREAKPOINT, columnNumber: 9, id: "inline-1" };
    const props = render({ breakpoints: [inline] });

    const location = host.querySelector<HTMLButtonElement>(
      '[data-testid="debug-breakpoint-location"]',
    );
    expect(location?.textContent).toContain("src/index.ts:12:9");
    expect(location?.title).toBe("/workspace/src/index.ts:12:9");
    expect(
      host.querySelector('input[aria-label="Enable breakpoint /workspace/src/index.ts:12:9"]'),
    ).not.toBeNull();

    act(() => location?.click());
    expect(props.onNavigateToBreakpoint).toHaveBeenCalledWith(inline);
  });

  it.each([
    [{ disabled: 0, enabled: 0 }, [true, true, true]],
    [{ disabled: 2, enabled: 0 }, [false, true, false]],
    [{ disabled: 0, enabled: 2 }, [true, false, false]],
    [{ disabled: 1, enabled: 1 }, [false, false, false]],
  ] as const)(
    "derives bulk breakpoint actions from exact enabled and disabled counts",
    (breakpointCounts, expectedDisabled) => {
      const props = render({ breakpointCounts });
      const labels = [
        "Enable all breakpoints",
        "Disable all breakpoints",
        "Remove all breakpoints",
      ] as const;

      labels.forEach((label, index) => {
        const action = button(label);
        expect(action.disabled, label).toBe(expectedDisabled[index]);
        expect(action.title).toBe(label);
      });

      for (const [label, callback] of [
        ["Enable all breakpoints", props.onEnableAllBreakpoints!],
        ["Disable all breakpoints", props.onDisableAllBreakpoints!],
        ["Remove all breakpoints", props.onRemoveAllBreakpoints!],
      ] as const) {
        const action = button(label);
        act(() => action.click());
        expect(callback).toHaveBeenCalledTimes(action.disabled ? 0 : 1);
      }
    },
  );

  it("locks and accessibly marks every breakpoint action during a bulk mutation", () => {
    const props = render({
      breakpointBulkMutationPending: true,
      breakpointCounts: { disabled: 1, enabled: 1 },
    });
    const toolbar = host.querySelector('[role="toolbar"][aria-label="Breakpoint actions"]');
    expect(toolbar?.getAttribute("aria-busy")).toBe("true");

    for (const [label, callback] of [
      ["Enable all breakpoints", props.onEnableAllBreakpoints!],
      ["Disable all breakpoints", props.onDisableAllBreakpoints!],
      ["Remove all breakpoints", props.onRemoveAllBreakpoints!],
    ] as const) {
      const action = button(label);
      expect(action.disabled).toBe(true);
      expect(action.getAttribute("aria-busy")).toBe("true");
      expect(action.title).toBe("Updating breakpoints");
      act(() => action.click());
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it("commits breakpoint conditions on enter and clears blank ones on blur", () => {
    const props = render({ breakpoints: [BREAKPOINT] });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Condition"]');
    expect(input).not.toBeNull();

    act(() => {
      if (!input) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "count > 2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(props.onSetBreakpointCondition).toHaveBeenCalledWith("bp-1", "count > 2");

    const propsWithCondition = render({
      breakpoints: [{ ...BREAKPOINT, condition: "count > 2" }],
    });
    const conditionedInput = host.querySelector<HTMLInputElement>('input[aria-label="Condition"]');
    expect(conditionedInput?.value).toBe("count > 2");

    act(() => {
      if (!conditionedInput) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(conditionedInput, "   ");
      conditionedInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      conditionedInput?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(propsWithCondition.onSetBreakpointCondition).toHaveBeenCalledWith("bp-1", null);
  });

  it("edits hit counts for Node while preserving conditions and hides them for PHP", () => {
    const props = render({
      breakpoints: [
        {
          ...BREAKPOINT,
          condition: "ready",
          hitCondition: { count: 2, kind: "multiple" },
        },
      ],
      debugAdapterKind: "node",
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Hit Count"]');
    expect(input?.value).toBe("%2");
    act(() => {
      setInputValue(input, ">=4");
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(props.onSetBreakpointHitCondition).toHaveBeenCalledWith("bp-1", {
      count: 4,
      kind: "greaterOrEqual",
    });
    expect(props.onSetBreakpointCondition).not.toHaveBeenCalled();

    render({ breakpoints: [BREAKPOINT], debugAdapterKind: "php" });
    expect(host.querySelector('input[aria-label="Hit Count"]')).toBeNull();
  });

  it("edits and validates composed Node logpoints while hiding them for PHP", () => {
    const props = render({
      breakpoints: [
        {
          ...BREAKPOINT,
          condition: "ready",
          hitCondition: { count: 2, kind: "multiple" },
          logMessage: "value={value}",
        },
      ],
      debugAdapterKind: "node",
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label^="Log message for"]');
    expect(input?.value).toBe("value={value}");
    act(() => {
      setInputValue(input, "next={next}");
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(props.onSetBreakpointLogMessage).toHaveBeenCalledWith("bp-1", "next={next}");
    expect(props.onSetBreakpointCondition).not.toHaveBeenCalled();
    expect(props.onSetBreakpointHitCondition).not.toHaveBeenCalled();

    act(() => setInputValue(input, "broken={"));
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("{braces}");

    render({ breakpoints: [BREAKPOINT], debugAdapterKind: "php" });
    expect(host.querySelector('input[aria-label^="Log message for"]')).toBeNull();
  });

  it("renders console output with stderr marked and an empty state", () => {
    render({
      console: populatedConsole([
        { stream: "stdout", text: "listening" },
        { stream: "stderr", text: "boom" },
      ]),
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    const lines = host.querySelectorAll('[data-testid="debug-output-line"]');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.getAttribute("data-stream")).toBe("stdout");
    expect(lines[1]?.getAttribute("data-stream")).toBe("stderr");
    expect(lines[1]?.textContent).toBe("boom");
    expect(host.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe("polite");
    expect(host.textContent).toContain("REPL expressions may execute code");

    render({ console: consoleResult() });
    expect(host.querySelector('[data-testid="debug-output-empty"]')?.textContent).toBe("No output");
  });

  it("focuses the debug expression once when a matching request reaches a mounted panel", () => {
    const console = consoleResult();
    const onConsoleFocusRequestHandled = vi.fn();
    const request = { generation: 1, workspaceOwnerKey: "workspace-a" };
    act(() => root.render(null));

    render({
      console,
      consoleFocusRequest: request,
      consoleWorkspaceOwnerKey: "workspace-a",
      onConsoleFocusRequestHandled,
      snapshot: stoppedSnapshot(),
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]');
    expect(document.activeElement).toBe(input);
    expect(console.submit).not.toHaveBeenCalled();
    expect(console.clear).not.toHaveBeenCalled();
    expect(onConsoleFocusRequestHandled).toHaveBeenCalledWith(request);

    const continueButton = button("Continue");
    act(() => continueButton.focus());
    render({
      console,
      consoleFocusRequest: request,
      consoleWorkspaceOwnerKey: "workspace-a",
      onConsoleFocusRequestHandled,
      snapshot: stoppedSnapshot(),
    });
    expect(document.activeElement).toBe(continueButton);

    render({
      console,
      consoleFocusRequest: { ...request, generation: 2 },
      consoleWorkspaceOwnerKey: "workspace-a",
      onConsoleFocusRequestHandled,
      snapshot: stoppedSnapshot(),
    });
    expect(document.activeElement).toBe(input);
    expect(console.submit).not.toHaveBeenCalled();
    expect(console.clear).not.toHaveBeenCalled();
    expect(onConsoleFocusRequestHandled).toHaveBeenCalledTimes(2);
  });

  it("focuses and acknowledges the console output while evaluation is disabled", () => {
    const onConsoleFocusRequestHandled = vi.fn();
    const runningRequest = { generation: 1, workspaceOwnerKey: "workspace-a" };
    render({
      consoleFocusRequest: runningRequest,
      consoleWorkspaceOwnerKey: "workspace-a",
      onConsoleFocusRequestHandled,
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]');
    const output = host.querySelector<HTMLDivElement>('[aria-label="Debug console output"]');
    expect(input?.disabled).toBe(true);
    expect(output?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(output);
    expect(onConsoleFocusRequestHandled).toHaveBeenCalledWith(runningRequest);

    const inactiveRequest = { generation: 2, workspaceOwnerKey: "workspace-a" };
    render({
      consoleFocusRequest: inactiveRequest,
      consoleWorkspaceOwnerKey: "workspace-a",
      onConsoleFocusRequestHandled,
      snapshot: { state: { kind: "inactive" }, lastSeq: 2 },
    });
    expect(document.activeElement).toBe(output);
    expect(onConsoleFocusRequestHandled).toHaveBeenLastCalledWith(inactiveRequest);
    expect(onConsoleFocusRequestHandled).toHaveBeenCalledTimes(2);
  });

  it("rejects a focus request owned by another workspace", () => {
    const console = consoleResult();
    render({
      console,
      consoleFocusRequest: { generation: 1, workspaceOwnerKey: "workspace-a" },
      consoleWorkspaceOwnerKey: "workspace-b",
      snapshot: stoppedSnapshot(),
    });

    expect(document.activeElement).not.toBe(
      host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]'),
    );
    expect(console.submit).not.toHaveBeenCalled();
    expect(console.clear).not.toHaveBeenCalled();
  });

  it("keeps console clear disabled when empty and delegates enabled clearing", () => {
    const onClearConsole = vi.fn();
    render({ canClearConsole: false, onClearConsole });
    expect(button("Clear debug console").disabled).toBe(true);
    act(() => button("Clear debug console").click());
    expect(onClearConsole).not.toHaveBeenCalled();

    render({
      canClearConsole: true,
      console: populatedConsole([{ stream: "stdout", text: "one" }]),
      onClearConsole,
    });
    expect(button("Clear debug console").disabled).toBe(false);
    act(() => button("Clear debug console").click());
    expect(onClearConsole).toHaveBeenCalledTimes(1);

    render({
      canClearConsole: true,
      console: populatedConsole([{ stream: "stdout", text: "one" }]),
      onClearConsole,
      workspaceTrusted: false,
    });
    expect(button("Clear debug console").disabled).toBe(true);
    act(() => button("Clear debug console").click());
    expect(onClearConsole).toHaveBeenCalledTimes(1);
  });

  it("evaluates expressions while paused and keeps history isolated by session", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render({ console: consoleResult(undefined, submit), snapshot: stoppedSnapshot() });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]');
    expect(input?.disabled).toBe(false);

    await act(async () => {
      setInputValue(input, "count + 1");
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith("count + 1");

    render({
      console: populatedConsole([
        { expression: "count + 1", result: { value: "42", type: "number" } },
      ]),
      snapshot: stoppedSnapshot(),
    });
    expect(host.querySelector('[data-testid="debug-evaluation"]')?.textContent).toContain(
      "42 (number)",
    );
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(input?.value).toBe("count + 1");
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(input?.value).toBe("");

    render({
      console: consoleResult(createDebugConsoleState({ sessionId: 8, pauseGeneration: 1 })),
      snapshot: {
        lastSeq: 4,
        state: {
          kind: "stopped",
          sessionId: 8,
          reason: "breakpoint",
          frames: [FRAME_A, FRAME_B],
          topFrame: FRAME_A,
        },
      },
    });
    expect(input?.value).toBe("");
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(input?.value).toBe("");
  });

  it("disables expression evaluation unless paused in a trusted workspace", () => {
    render({
      snapshot: { state: { kind: "running", sessionId: 7 }, lastSeq: 1 },
    });
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]')?.disabled,
    ).toBe(true);

    render({ snapshot: stoppedSnapshot(), workspaceTrusted: false });
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]')?.disabled,
    ).toBe(true);
  });

  it("renders evaluation errors and Escape clears the pending expression", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render({ console: consoleResult(undefined, submit), snapshot: stoppedSnapshot() });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Debug expression"]');

    await act(async () => {
      setInputValue(input, "broken(");
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith("broken(");
    render({
      console: populatedConsole([{ expression: "broken(", error: "Invalid expression" }]),
      snapshot: stoppedSnapshot(),
    });
    expect(host.querySelector('[data-testid="debug-evaluation"]')?.textContent).toContain(
      "Invalid expression",
    );

    act(() => {
      setInputValue(input, "temporary");
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(input?.value).toBe("");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps the console pinned to the bottom while the reader stays there", () => {
    render({ console: populatedConsole([{ stream: "stdout", text: "one" }]) });

    const body = host.querySelector<HTMLDivElement>('[data-testid="debug-console-body"]');
    expect(body).not.toBeNull();
    mockScrollMetrics(body as HTMLDivElement, {
      clientHeight: 50,
      scrollHeight: 100,
      scrollTop: 50,
    });
    act(() => {
      body?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    render({
      console: populatedConsole([
        { stream: "stdout", text: "one" },
        { stream: "stdout", text: "two" },
      ]),
    });

    expect(body?.scrollTop).toBe(100);
  });

  it("does not hijack the scroll position after the reader scrolls up", () => {
    render({ console: populatedConsole([{ stream: "stdout", text: "one" }]) });

    const body = host.querySelector<HTMLDivElement>('[data-testid="debug-console-body"]');
    expect(body).not.toBeNull();
    mockScrollMetrics(body as HTMLDivElement, {
      clientHeight: 50,
      scrollHeight: 200,
      scrollTop: 0,
    });
    act(() => {
      body?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    render({
      console: populatedConsole([
        { stream: "stdout", text: "one" },
        { stream: "stdout", text: "two" },
      ]),
    });

    expect(body?.scrollTop).toBe(0);
  });
});

function mockScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  let top = metrics.scrollTop;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
