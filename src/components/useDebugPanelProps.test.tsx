// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import type { DebugPanelProps } from "./DebugPanel";
import { useDebugPanelProps } from "./useDebugPanelProps";

describe("useDebugPanelProps", () => {
  it("maps debug session and watch orchestration into focused panel callbacks", () => {
    const loadVariables = vi.fn().mockResolvedValue(undefined);
    const stepDebug = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn();
    const invalidateEvaluations = vi.fn(() => true);
    const expressionMutations = { forWatch: vi.fn(() => null) };
    const openDebugLocation = vi.fn();
    const loadConfigurations = vi.fn().mockResolvedValue(undefined);
    const refreshConfigurations = vi.fn().mockResolvedValue(undefined);
    const selectConfiguration = vi.fn();
    const closeConfigurationPicker = vi.fn();
    const startNamedConfiguration = vi.fn().mockResolvedValue(true);
    const startSelectedConfiguration = vi.fn().mockResolvedValue(true);
    const restartDebug = vi.fn().mockResolvedValue(undefined);
    const disableAllBreakpoints = vi.fn().mockResolvedValue(undefined);
    const enableAllBreakpoints = vi.fn().mockResolvedValue(undefined);
    const removeAllBreakpoints = vi.fn().mockResolvedValue(undefined);
    const reportCommandError = vi.fn();
    const clearConsole = vi.fn();
    const acknowledgeFocusRequest = vi.fn();
    const consoleFocusRequest = { generation: 3, workspaceOwnerKey: "workspace-owner" };
    const canOpenNodeRunPicker = vi.fn(() => true);
    const openNodeRunPicker = vi.fn();
    const openNodeLaunchConfigurations = vi.fn();
    const debugCopyStackTrace = {
      canCopyStackTrace: vi.fn(() => true),
      copyStackTrace: vi.fn(() => true),
    };
    const debugRestartFrame = {
      canRestartFrame: vi.fn(() => true),
      restartFrame: vi.fn(() => true),
    };
    const debugCopyValue = {
      variables: { source: "variables" },
      watch: { source: "watch" },
    };
    const latencyTracker = createLatencyTracker();
    const debugSession = {
      breakpointBulkMutationPending: false,
      breakpointCounts: { disabled: 2, enabled: 1 },
      breakpoints: [],
      canRestartDebug: vi.fn(() => true),
      console: {
        state: {
          owner: null,
          entries: [],
          history: [],
          pendingRequestIds: [],
          nextSequence: 1,
          totalBytes: 0,
        },
        clear: vi.fn(),
        submit: vi.fn().mockResolvedValue(undefined),
      },
      consoleSurface: {
        acknowledgeFocusRequest,
        canClear: true,
        clear: clearConsole,
        focus: vi.fn(),
        focusRequest: consoleFocusRequest,
        workspaceOwnerKey: "workspace-owner",
      },
      configurationLauncher: {
        busy: false,
        closePicker: closeConfigurationPicker,
        choices: [
          {
            args: ["--private"],
            default: true,
            env: { SECRET: "do-not-forward" },
            name: "Launch app",
            targetKind: "script",
          },
        ],
        load: loadConfigurations,
        pickerOpen: true,
        refresh: refreshConfigurations,
        select: selectConfiguration,
        selectedName: "Launch app",
        startSelected: startSelectedConfiguration,
        startNamed: startNamedConfiguration,
        state: { kind: "error", message: "Invalid launch configuration" },
      },
      copyValue: debugCopyValue,
      debugAdapterKind: "node",
      debugControlPending: true,
      debugRestartPending: false,
      debugStartPending: true,
      debugStopPending: false,
      debugSessionAttached: false,
      debugStartBlockedByOtherOwner: true,
      disconnectDebug: vi.fn().mockResolvedValue(undefined),
      disableAllBreakpoints,
      enableAllBreakpoints,
      evaluationHistory: [],
      evaluate: vi.fn().mockResolvedValue(null),
      exceptionPauseError: null,
      exceptionPauseMode: "none",
      exceptionPausePending: false,
      exceptionTypeFilter: ["TypeError"],
      lastStartError: null,
      latencyTracker,
      loadVariables,
      output: [],
      pauseDebug: vi.fn().mockResolvedValue(undefined),
      restartDebug,
      removeAllBreakpoints,
      removeBreakpoint: vi.fn().mockResolvedValue(undefined),
      scopeLoadState: { kind: "inactive" },
      scopes: [],
      selectFrame: vi.fn().mockResolvedValue(undefined),
      selectedFrameId: null,
      setBreakpointCondition: vi.fn().mockResolvedValue(undefined),
      setBreakpointEnabled: vi.fn().mockResolvedValue(undefined),
      setBreakpointHitCondition: vi.fn().mockResolvedValue(undefined),
      setBreakpointLogMessage: vi.fn().mockResolvedValue(undefined),
      setExceptionPauseMode: vi.fn().mockResolvedValue(undefined),
      setExceptionTypeFilter: vi.fn().mockResolvedValue(undefined),
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      stepDebug,
      stopDebug: vi.fn().mockResolvedValue(undefined),
      variablesByReference: {},
      watches: {
        canInvalidateEvaluations: vi.fn(() => true),
        definitions: [],
        evaluations: {},
        expressionMutations,
        pendingIds: [],
        refreshPending: false,
        add,
        clear: vi.fn(),
        invalidateEvaluations,
        remove: vi.fn(),
        setEnabled: vi.fn(),
        update: vi.fn(),
      },
    };
    const captured: { current: DebugPanelProps | null } = { current: null };
    const host = document.createElement("div");
    const root = createRoot(host);
    function Harness() {
      captured.current = useDebugPanelProps({
        debugCopyStackTrace,
        debugRestartFrame,
        debugSession: debugSession as never,
        hasJavaScriptTypeScriptWorkspace: true,
        nodeRunConfigurationPicker: {
          canOpenPicker: canOpenNodeRunPicker,
          openPicker: openNodeRunPicker,
        },
        openNodeLaunchConfigurations,
        openDebugLocation,
        reportCommandError,
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }
    act(() => root.render(<Harness />));
    const panel = captured.current as DebugPanelProps | null;
    expect(panel).not.toBeNull();
    expect(panel?.latencyTracker).toBe(latencyTracker);
    panel?.onLoadVariables(21);
    expect(panel?.debugCopyStackTrace?.copyStackTrace()).toBe(true);
    panel?.onClearConsole?.();
    panel?.onConsoleFocusRequestHandled?.(consoleFocusRequest);
    panel?.onRestart?.();
    panel?.onDisableAllBreakpoints?.();
    panel?.onEnableAllBreakpoints?.();
    panel?.onRemoveAllBreakpoints?.();
    panel?.onStep("stepOver");
    panel?.onNavigateToFrame("/workspace/app.ts", 4);
    panel?.onNavigateToBreakpoint({
      columnNumber: 9,
      enabled: true,
      filePath: "/workspace/app.ts",
      id: "inline-1",
      lineNumber: 7,
    });
    panel?.watches.onAdd("count");
    panel?.watches.onRefresh?.();
    const launchConfigurations = panel?.nodeLaunchConfigurations;
    expect(launchConfigurations?.onLoad()).toBeUndefined();
    expect(launchConfigurations?.onClosePicker?.()).toBeUndefined();
    expect(launchConfigurations?.onRefresh()).toBeUndefined();
    expect(launchConfigurations?.onSelect("Launch app")).toBeUndefined();
    expect(launchConfigurations?.onStartNamed?.("Launch app")).toBeUndefined();
    expect(launchConfigurations?.onStartSelected()).toBeUndefined();
    expect(loadVariables).toHaveBeenCalledWith(21);
    expect(panel?.debugCopyStackTrace).toBe(debugCopyStackTrace);
    expect("debugCopyValue" in (panel ?? {})).toBe(false);
    expect(panel?.debugRestartFrame).toBe(debugRestartFrame);
    expect(panel?.watches.expressionMutations).toBe(expressionMutations);
    expect(panel?.debugRestartFrame?.restartFrame()).toBe(true);
    expect(debugRestartFrame.restartFrame).toHaveBeenCalledWith();
    expect(debugCopyStackTrace.copyStackTrace).toHaveBeenCalledOnce();
    expect(clearConsole).toHaveBeenCalledOnce();
    expect(acknowledgeFocusRequest).toHaveBeenCalledWith(consoleFocusRequest);
    expect(restartDebug).toHaveBeenCalledOnce();
    expect(disableAllBreakpoints).toHaveBeenCalledOnce();
    expect(enableAllBreakpoints).toHaveBeenCalledOnce();
    expect(removeAllBreakpoints).toHaveBeenCalledOnce();
    expect(stepDebug).toHaveBeenCalledWith("stepOver");
    expect(openDebugLocation).toHaveBeenCalledWith("/workspace/app.ts", 4);
    expect(openDebugLocation).toHaveBeenCalledWith("/workspace/app.ts", 7, 9);
    expect(add).toHaveBeenCalledWith("count");
    expect(panel?.watches.canRefresh).toBe(true);
    expect(panel?.watches.refreshPending).toBe(false);
    expect(invalidateEvaluations).toHaveBeenCalledOnce();
    expect(loadConfigurations).toHaveBeenCalledOnce();
    expect(closeConfigurationPicker).toHaveBeenCalledOnce();
    expect(refreshConfigurations).toHaveBeenCalledOnce();
    expect(selectConfiguration).toHaveBeenCalledWith("Launch app");
    expect(startSelectedConfiguration).toHaveBeenCalledOnce();
    expect(startNamedConfiguration).toHaveBeenCalledWith("Launch app");
    expect(launchConfigurations).toMatchObject({
      busy: false,
      choices: [{ default: true, name: "Launch app", targetKind: "script" }],
      error: "Invalid launch configuration",
      pickerOpen: true,
      selectedName: "Launch app",
      state: "error",
    });
    expect(launchConfigurations?.choices[0]).not.toHaveProperty("args");
    expect(launchConfigurations?.choices[0]).not.toHaveProperty("env");
    expect(panel?.nodeRunWithoutDebuggingPicker).toEqual({
      canOpenPicker: canOpenNodeRunPicker,
      openPicker: openNodeRunPicker,
    });
    expect(panel?.nodeRunWithoutDebuggingPicker).not.toHaveProperty("choices");
    expect(panel?.nodeRunWithoutDebuggingPicker).not.toHaveProperty("selectedName");
    panel?.onOpenNodeLaunchConfigurations?.();
    expect(openNodeLaunchConfigurations).toHaveBeenCalledOnce();
    expect(panel?.debugAdapterKind).toBe("node");
    expect(panel?.debugControlPending).toBe(true);
    expect(panel?.canRestartDebug).toBe(true);
    expect(panel?.canClearConsole).toBe(true);
    expect(panel?.consoleFocusRequest).toBe(consoleFocusRequest);
    expect(panel?.consoleWorkspaceOwnerKey).toBe("workspace-owner");
    expect(panel?.debugRestartPending).toBe(false);
    expect(panel?.debugStartPending).toBe(true);
    expect(panel?.debugStopPending).toBe(false);
    expect(panel?.debugStartBlockedByOtherOwner).toBe(true);
    expect(panel?.breakpointBulkMutationPending).toBe(false);
    expect(panel?.breakpointCounts).toEqual({ disabled: 2, enabled: 1 });
    expect(panel?.exceptionTypeFilter).toEqual(["TypeError"]);
    panel?.onSetExceptionTypeFilter?.(["RangeError"]);
    expect(debugSession.setExceptionTypeFilter).toHaveBeenCalledWith(["RangeError"]);
    expect(panel?.workspaceTrusted).toBe(true);
    act(() => root.unmount());
  });

  it("reports a rejected toolbar restart through the workbench command error channel", async () => {
    const restartError = new Error("Restart failed");
    const restartDebug = vi.fn().mockRejectedValue(restartError);
    const reportCommandError = vi.fn();
    const captured: { current: DebugPanelProps | null } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      captured.current = useDebugPanelProps({
        debugSession: debugSessionStub({ restartDebug }) as never,
        hasJavaScriptTypeScriptWorkspace: true,
        openDebugLocation: vi.fn(),
        reportCommandError,
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(captured.current?.onRestart?.()).toBeUndefined();

    await act(async () => {
      await Promise.resolve();
    });

    expect(restartDebug).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledWith(restartError);
    act(() => root.unmount());
  });

  it("reports every rejected breakpoint row mutation instead of dropping its promise", async () => {
    const mutationError = new Error("bounded breakpoint failure");
    const mutations = {
      removeBreakpoint: vi.fn().mockRejectedValue(mutationError),
      setBreakpointCondition: vi.fn().mockRejectedValue(mutationError),
      setBreakpointEnabled: vi.fn().mockRejectedValue(mutationError),
      setBreakpointHitCondition: vi.fn().mockRejectedValue(mutationError),
      setBreakpointLogMessage: vi.fn().mockRejectedValue(mutationError),
    };
    const reportCommandError = vi.fn();
    const captured: { current: DebugPanelProps | null } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      captured.current = useDebugPanelProps({
        debugSession: debugSessionStub(mutations) as never,
        hasJavaScriptTypeScriptWorkspace: true,
        openDebugLocation: vi.fn(),
        reportCommandError,
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    captured.current?.onRemoveBreakpoint("bp");
    captured.current?.onSetBreakpointCondition("bp", "ready");
    captured.current?.onSetBreakpointEnabled("bp", false);
    captured.current?.onSetBreakpointHitCondition("bp", { count: 2, kind: "equals" });
    captured.current?.onSetBreakpointLogMessage("bp", "value={value}");

    await act(async () => {
      await Promise.resolve();
    });

    expect(reportCommandError).toHaveBeenCalledTimes(5);
    expect(reportCommandError.mock.calls.every(([error]) => error === mutationError)).toBe(true);
    act(() => root.unmount());
  });

  it("preserves only safe aggregate compound choice metadata for the debug controls", () => {
    const captured: { current: DebugPanelProps | null } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      captured.current = useDebugPanelProps({
        debugSession: debugSessionStub({
          configurationLauncher: {
            busy: false,
            choices: [
              {
                compoundMemberCount: 2,
                default: false,
                hasPreLaunchTask: true,
                name: "Services",
                runnable: false,
                source: "vscode",
                targetKind: "compound",
              },
            ],
            closePicker: vi.fn(),
            load: vi.fn(async () => undefined),
            pickerOpen: true,
            refresh: vi.fn(async () => undefined),
            select: vi.fn(),
            selectedName: null,
            startNamed: vi.fn(async () => false),
            startSelected: vi.fn(async () => false),
            state: { kind: "ready" },
          },
        }) as never,
        hasJavaScriptTypeScriptWorkspace: true,
        openDebugLocation: vi.fn(),
        reportCommandError: vi.fn(),
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(captured.current?.nodeLaunchConfigurations?.choices).toEqual([
      {
        compoundMemberCount: 2,
        default: false,
        hasPreLaunchTask: true,
        name: "Services",
        runnable: false,
        source: "vscode",
        targetKind: "compound",
      },
    ]);
    expect(JSON.stringify(captured.current?.nodeLaunchConfigurations?.choices)).not.toContain(
      "member",
    );
    act(() => root.unmount());
  });

  it("reports a rejected toolbar stop through the workbench command error channel", async () => {
    const stopError = new Error("Stop failed");
    const stopDebug = vi.fn().mockRejectedValue(stopError);
    const reportCommandError = vi.fn();
    const captured: { current: DebugPanelProps | null } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      captured.current = useDebugPanelProps({
        debugSession: debugSessionStub({ stopDebug }) as never,
        hasJavaScriptTypeScriptWorkspace: true,
        openDebugLocation: vi.fn(),
        reportCommandError,
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(captured.current?.onStop()).toBeUndefined();

    await act(async () => {
      await Promise.resolve();
    });

    expect(stopDebug).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledWith(stopError);
    act(() => root.unmount());
  });

  it("reports a rejected toolbar disconnect through the workbench command error channel", async () => {
    const disconnectError = new Error("Disconnect failed");
    const disconnectDebug = vi.fn().mockRejectedValue(disconnectError);
    const reportCommandError = vi.fn();
    const captured: { current: DebugPanelProps | null } = { current: null };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      captured.current = useDebugPanelProps({
        debugSession: debugSessionStub({ debugSessionAttached: true, disconnectDebug }) as never,
        hasJavaScriptTypeScriptWorkspace: true,
        openDebugLocation: vi.fn(),
        reportCommandError,
        workspaceRoot: "/workspace",
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(captured.current?.debugSessionAttached).toBe(true);
    expect(captured.current?.onDisconnect?.()).toBeUndefined();
    await act(async () => Promise.resolve());
    expect(disconnectDebug).toHaveBeenCalledOnce();
    expect(reportCommandError).toHaveBeenCalledWith(disconnectError);
    act(() => root.unmount());
  });

  it.each([
    ["enable", "enableAllBreakpoints"],
    ["disable", "disableAllBreakpoints"],
    ["remove", "removeAllBreakpoints"],
  ] as const)(
    "reports a rejected bulk breakpoint %s through the command error channel",
    async (_, method) => {
      const mutationError = new Error(`${method} failed`);
      const mutation = vi.fn().mockRejectedValue(mutationError);
      const reportCommandError = vi.fn();
      const captured: { current: DebugPanelProps | null } = { current: null };
      const root = createRoot(document.createElement("div"));

      function Harness() {
        captured.current = useDebugPanelProps({
          debugSession: debugSessionStub({ [method]: mutation }) as never,
          hasJavaScriptTypeScriptWorkspace: true,
          openDebugLocation: vi.fn(),
          reportCommandError,
          workspaceRoot: "/workspace",
          workspaceTrusted: true,
        });
        return null;
      }

      act(() => root.render(<Harness />));
      const callback = {
        disableAllBreakpoints: captured.current?.onDisableAllBreakpoints,
        enableAllBreakpoints: captured.current?.onEnableAllBreakpoints,
        removeAllBreakpoints: captured.current?.onRemoveAllBreakpoints,
      }[method];
      expect(callback?.()).toBeUndefined();

      await act(async () => {
        await Promise.resolve();
      });

      expect(mutation).toHaveBeenCalledOnce();
      expect(reportCommandError).toHaveBeenCalledWith(mutationError);
      act(() => root.unmount());
    },
  );
});

function debugSessionStub(overrides: Record<string, unknown> = {}) {
  return {
    breakpointBulkMutationPending: false,
    breakpointCounts: { disabled: 0, enabled: 0 },
    breakpoints: [],
    canRestartDebug: vi.fn(() => true),
    console: {
      state: {
        owner: null,
        entries: [],
        history: [],
        pendingRequestIds: [],
        nextSequence: 1,
        totalBytes: 0,
      },
      clear: vi.fn(),
      submit: vi.fn().mockResolvedValue(undefined),
    },
    debugAdapterKind: "node",
    debugRestartPending: false,
    debugStartPending: false,
    debugStopPending: false,
    debugSessionAttached: false,
    debugStartBlockedByOtherOwner: false,
    disconnectDebug: vi.fn().mockResolvedValue(undefined),
    disableAllBreakpoints: vi.fn().mockResolvedValue(undefined),
    enableAllBreakpoints: vi.fn().mockResolvedValue(undefined),
    exceptionPauseError: null,
    exceptionPauseMode: "none",
    exceptionPausePending: false,
    exceptionTypeFilter: [],
    lastStartError: null,
    loadVariables: vi.fn().mockResolvedValue(undefined),
    loadVariablePage: vi.fn().mockResolvedValue(undefined),
    pauseDebug: vi.fn().mockResolvedValue(undefined),
    restartDebug: vi.fn().mockResolvedValue(undefined),
    removeAllBreakpoints: vi.fn().mockResolvedValue(undefined),
    removeBreakpoint: vi.fn().mockResolvedValue(undefined),
    scopeLoadState: { kind: "inactive" },
    scopes: [],
    selectFrame: vi.fn().mockResolvedValue(undefined),
    selectedFrameId: null,
    setBreakpointCondition: vi.fn().mockResolvedValue(undefined),
    setBreakpointEnabled: vi.fn().mockResolvedValue(undefined),
    setBreakpointHitCondition: vi.fn().mockResolvedValue(undefined),
    setBreakpointLogMessage: vi.fn().mockResolvedValue(undefined),
    setExceptionPauseMode: vi.fn().mockResolvedValue(undefined),
    setExceptionTypeFilter: vi.fn().mockResolvedValue(undefined),
    snapshot: { lastSeq: 0, state: { kind: "inactive" } },
    stepDebug: vi.fn().mockResolvedValue(undefined),
    stopDebug: vi.fn().mockResolvedValue(undefined),
    variablesByReference: {},
    watches: {
      definitions: [],
      evaluations: {},
      expressionMutations: { forWatch: vi.fn(() => null) },
      pendingIds: [],
      add: vi.fn(),
      clear: vi.fn(),
      remove: vi.fn(),
      setEnabled: vi.fn(),
      update: vi.fn(),
    },
    ...overrides,
  };
}
