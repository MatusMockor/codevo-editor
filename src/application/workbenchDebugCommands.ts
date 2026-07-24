import type { StepKind } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { KeymapCommandId } from "../domain/keymap";
import { isDebuggableNodeScriptPath, isDebuggablePhpScriptPath } from "../domain/debugScriptPath";
import type { Command } from "./commandRegistry";
import type { DebugSetVariableSafeCommands } from "./debugSetVariableCommandBridge";
import {
  unavailableDebugAddToWatchCommands,
  type DebugAddToWatchSafeCommands,
} from "./debugAddToWatchCommandBridge";
export { isDebuggableNodeScriptPath, isDebuggablePhpScriptPath };

interface WorkbenchDebugCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  attachNodeDebug: Command["run"];
  configurationLauncher: {
    readonly busy: boolean;
    readonly pickerOpen: boolean;
    canOpenPicker(): boolean;
    openPicker(): void;
  };
  configureNodeLaunchConfigurations: Command["run"];
  canRestartDebug: boolean;
  canRunToCursor: boolean;
  canToggleBreakpointsActivated?: boolean;
  canClearDebugConsole: boolean;
  breakpointBulkMutationPending: boolean;
  breakpointCounts: {
    readonly disabled: number;
    readonly enabled: number;
  };
  debugRestartPending: boolean;
  debugAddToWatch?: DebugAddToWatchSafeCommands;
  debugCompoundStartPending: boolean;
  debugControlPending: boolean;
  debugStopPending: boolean;
  debugSessionAttached: boolean;
  debugStartPending: boolean;
  debugEvaluateInConsole: {
    canEvaluateInConsole(): boolean;
    evaluateInConsole(): boolean;
  };
  debugBreakpointNavigation: {
    canGoToNextBreakpoint(): boolean;
    canGoToPreviousBreakpoint(): boolean;
    goToNextBreakpoint(): boolean;
    goToPreviousBreakpoint(): boolean;
  };
  debugInlineBreakpoint: {
    addInlineBreakpoint(): boolean;
    canAddInlineBreakpoint(): boolean;
  };
  debugCopyValue: {
    canCopyEvaluatePath(): boolean;
    canCopyValue(): boolean;
    copyEvaluatePath(): Promise<boolean>;
    copyValue(): Promise<boolean>;
  };
  debugCopyStackTrace: {
    canCopyStackTrace(): boolean;
    copyStackTrace(): boolean;
  };
  debugCallStackNavigation: {
    canSelectCallStackFrame(): boolean;
    selectCallStackTop(): boolean;
    selectCallStackBottom(): boolean;
    selectCallStackUp(): boolean;
    selectCallStackDown(): boolean;
  };
  debugRestartFrame: {
    canRestartFrame(): boolean;
    restartFrame(): boolean;
  };
  debugSetVariable: DebugSetVariableSafeCommands;
  debugWatchAtCursor: {
    addToWatchAtCursor(): boolean;
    canAddAtCursor(): boolean;
  };
  hasJsWorkspace: boolean;
  hasPhpWorkspace: boolean;
  isActiveDocumentDebuggable: boolean;
  isWorkspaceTrusted: boolean;
  snapshot: DebuggerSessionSnapshot;
  openDebugPanel: Command["run"];
  clearDebugConsole: Command["run"];
  focusDebugConsole: Command["run"];
  disableAllBreakpoints: Command["run"];
  enableAllBreakpoints: Command["run"];
  pauseDebug: Command["run"];
  restartDebug: Command["run"];
  runToCursor: Command["run"];
  removeAllBreakpoints: Command["run"];
  startOrContinueDebug: Command["run"];
  startPhpListenDebug: Command["run"];
  stepDebug(kind: StepKind): void | Promise<void>;
  stopDebug: Command["run"];
  disconnectDebug: Command["run"];
  toggleBreakpointAtCursor: Command["run"];
  toggleBreakpointsActivated?: Command["run"];
}

export function workbenchDebugCommands({
  shortcut,
  attachNodeDebug,
  configurationLauncher,
  configureNodeLaunchConfigurations,
  canRestartDebug,
  canRunToCursor,
  canToggleBreakpointsActivated = false,
  canClearDebugConsole,
  breakpointBulkMutationPending,
  breakpointCounts,
  debugRestartPending,
  debugAddToWatch = unavailableDebugAddToWatchCommands,
  debugCompoundStartPending,
  debugControlPending,
  debugStopPending,
  debugSessionAttached,
  debugStartPending,
  debugEvaluateInConsole,
  debugBreakpointNavigation,
  debugInlineBreakpoint,
  debugCopyValue,
  debugCopyStackTrace,
  debugCallStackNavigation,
  debugRestartFrame,
  debugSetVariable,
  debugWatchAtCursor,
  hasJsWorkspace,
  hasPhpWorkspace,
  isActiveDocumentDebuggable,
  isWorkspaceTrusted,
  snapshot,
  openDebugPanel,
  clearDebugConsole,
  focusDebugConsole,
  disableAllBreakpoints,
  enableAllBreakpoints,
  pauseDebug,
  restartDebug,
  runToCursor,
  removeAllBreakpoints,
  startOrContinueDebug,
  startPhpListenDebug,
  stepDebug,
  stopDebug,
  disconnectDebug,
  toggleBreakpointAtCursor,
  toggleBreakpointsActivated = () => undefined,
}: WorkbenchDebugCommandsOptions): Command[] {
  const sessionKind = snapshot.state.kind;
  const sessionActive =
    sessionKind === "starting" ||
    sessionKind === "running" ||
    sessionKind === "stopped" ||
    debugCompoundStartPending;
  const sessionStopped = sessionKind === "stopped";
  const canStart =
    (hasJsWorkspace || hasPhpWorkspace) && isWorkspaceTrusted && isActiveDocumentDebuggable;
  const sessionMutationPending = debugControlPending || debugRestartPending || debugStopPending;
  const canStep =
    sessionStopped &&
    isWorkspaceTrusted &&
    !debugStartPending &&
    !breakpointBulkMutationPending &&
    !sessionMutationPending;

  return [
    {
      id: "debug.addToWatchExpressions",
      title: "Add to Watch",
      category: "Debug",
      visibleInCommandPalette: false,
      isEnabled: () => debugAddToWatch.canAddToWatch(),
      run: () => {
        debugAddToWatch.addToWatch();
      },
    },
    {
      id: "debug.setVariable",
      title: "Set Value",
      category: "Debug",
      shortcut: shortcut("debug.setVariable"),
      isEnabled: () => debugSetVariable.canBeginEdit(),
      run: () => {
        debugSetVariable.beginEdit();
      },
    },
    {
      id: "workbench.action.debug.restartFrame",
      title: "Restart Frame",
      category: "Debug",
      visibleInCommandPalette: false,
      isEnabled: () => debugRestartFrame.canRestartFrame(),
      run: () => {
        debugRestartFrame.restartFrame();
      },
    },
    {
      id: "workbench.action.debug.callStackTop",
      title: "Debug: Navigate to Top of Call Stack",
      category: "Debug",
      isEnabled: () => debugCallStackNavigation.canSelectCallStackFrame(),
      run: () => {
        debugCallStackNavigation.selectCallStackTop();
      },
    },
    {
      id: "workbench.action.debug.callStackBottom",
      title: "Debug: Navigate to Bottom of Call Stack",
      category: "Debug",
      isEnabled: () => debugCallStackNavigation.canSelectCallStackFrame(),
      run: () => {
        debugCallStackNavigation.selectCallStackBottom();
      },
    },
    {
      id: "workbench.action.debug.callStackUp",
      title: "Debug: Navigate Up Call Stack",
      category: "Debug",
      isEnabled: () => debugCallStackNavigation.canSelectCallStackFrame(),
      run: () => {
        debugCallStackNavigation.selectCallStackUp();
      },
    },
    {
      id: "workbench.action.debug.callStackDown",
      title: "Debug: Navigate Down Call Stack",
      category: "Debug",
      isEnabled: () => debugCallStackNavigation.canSelectCallStackFrame(),
      run: () => {
        debugCallStackNavigation.selectCallStackDown();
      },
    },
    {
      id: "workbench.debug.viewlet.action.copyValue",
      title: "Copy Value",
      category: "Debug",
      visibleInCommandPalette: false,
      isEnabled: () => debugCopyValue.canCopyValue(),
      run: async () => {
        await debugCopyValue.copyValue();
      },
    },
    {
      id: "debug.copyEvaluatePath",
      title: "Copy as Expression",
      category: "Debug",
      visibleInCommandPalette: false,
      isEnabled: () => debugCopyValue.canCopyEvaluatePath(),
      run: async () => {
        await debugCopyValue.copyEvaluatePath();
      },
    },
    {
      id: "debug.copyStackTrace",
      title: "Debug: Copy Call Stack",
      category: "Debug",
      isEnabled: () => debugCopyStackTrace.canCopyStackTrace(),
      run: () => {
        debugCopyStackTrace.copyStackTrace();
      },
    },
    {
      id: "debug.attachNode",
      title: "Debug: Attach to Node Inspector",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        isWorkspaceTrusted &&
        !sessionActive &&
        !debugStartPending &&
        !sessionMutationPending,
      run: attachNodeDebug,
    },
    {
      id: "debug.start",
      title: "Debug: Start or Continue",
      category: "Debug",
      shortcut: shortcut("debug.start"),
      isEnabled: (context) =>
        !sessionMutationPending &&
        !debugStartPending &&
        isWorkspaceTrusted &&
        (sessionStopped ||
          (context.hasWorkspace && context.hasActiveDocument && canStart && !sessionActive)),
      run: startOrContinueDebug,
    },
    {
      id: "debug.selectAndStartConfiguration",
      title: "Debug: Select and Start Configuration",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        isWorkspaceTrusted &&
        !sessionActive &&
        !debugStartPending &&
        !debugRestartPending &&
        !debugStopPending &&
        !configurationLauncher.busy &&
        !configurationLauncher.pickerOpen &&
        configurationLauncher.canOpenPicker(),
      run: configurationLauncher.openPicker,
    },
    {
      id: "debug.configureNodeLaunchConfigurations",
      title: "Run: Configure Node Launch Configurations",
      category: "Run",
      isEnabled: (context) => context.hasWorkspace && hasJsWorkspace,
      run: configureNodeLaunchConfigurations,
    },
    {
      id: "debug.restart",
      title: "Debug: Restart",
      category: "Debug",
      shortcut: shortcut("debug.restart"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        isWorkspaceTrusted &&
        canRestartDebug &&
        !debugRestartPending &&
        !debugStopPending,
      run: restartDebug,
    },
    {
      id: "debug.runToCursor",
      title: "Debug: Run to Cursor",
      category: "Debug",
      shortcut: shortcut("debug.runToCursor"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        !context.activeDocumentDirty &&
        hasJsWorkspace &&
        isWorkspaceTrusted &&
        sessionStopped &&
        canRunToCursor &&
        !debugStartPending &&
        !breakpointBulkMutationPending &&
        !sessionMutationPending,
      run: runToCursor,
    },
    {
      id: "debug.addToWatchAtCursor",
      title: "Debug: Add to Watch",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace && hasJsWorkspace && debugWatchAtCursor.canAddAtCursor(),
      run: () => {
        debugWatchAtCursor.addToWatchAtCursor();
      },
    },
    {
      id: "debug.evaluateInConsole",
      title: "Debug: Evaluate in Console",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace && hasJsWorkspace && debugEvaluateInConsole.canEvaluateInConsole(),
      run: () => {
        debugEvaluateInConsole.evaluateInConsole();
      },
    },
    {
      id: "editor.debug.action.toggleInlineBreakpoint",
      title: "Debug: Inline Breakpoint",
      category: "Debug",
      shortcut: shortcut("editor.debug.action.toggleInlineBreakpoint"),
      isEnabled: (context) =>
        context.hasWorkspace && hasJsWorkspace && debugInlineBreakpoint.canAddInlineBreakpoint(),
      run: () => {
        debugInlineBreakpoint.addInlineBreakpoint();
      },
    },
    {
      id: "editor.debug.action.goToNextBreakpoint",
      title: "Debug: Go to Next Breakpoint",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace && hasJsWorkspace && debugBreakpointNavigation.canGoToNextBreakpoint(),
      run: () => {
        debugBreakpointNavigation.goToNextBreakpoint();
      },
    },
    {
      id: "editor.debug.action.goToPreviousBreakpoint",
      title: "Debug: Go to Previous Breakpoint",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        debugBreakpointNavigation.canGoToPreviousBreakpoint(),
      run: () => {
        debugBreakpointNavigation.goToPreviousBreakpoint();
      },
    },
    {
      id: "debug.listenPhp",
      title: "Debug: Listen for PHP (Xdebug)",
      category: "Debug",
      isEnabled: () =>
        hasPhpWorkspace && isWorkspaceTrusted && !sessionActive && !sessionMutationPending,
      run: startPhpListenDebug,
    },
    {
      id: "debug.continue",
      title: "Debug: Continue",
      category: "Debug",
      isEnabled: () => canStep,
      run: () => stepDebug("continue"),
    },
    {
      id: "debug.stepOver",
      title: "Debug: Step Over",
      category: "Debug",
      shortcut: shortcut("debug.stepOver"),
      isEnabled: () => canStep,
      run: () => stepDebug("stepOver"),
    },
    {
      id: "debug.stepInto",
      title: "Debug: Step Into",
      category: "Debug",
      shortcut: shortcut("debug.stepInto"),
      isEnabled: () => canStep,
      run: () => stepDebug("stepInto"),
    },
    {
      id: "debug.stepOut",
      title: "Debug: Step Out",
      category: "Debug",
      shortcut: shortcut("debug.stepOut"),
      isEnabled: () => canStep,
      run: () => stepDebug("stepOut"),
    },
    {
      id: "debug.pause",
      title: "Debug: Pause",
      category: "Debug",
      isEnabled: () => sessionKind === "running" && isWorkspaceTrusted && !sessionMutationPending,
      run: pauseDebug,
    },
    {
      id: "workbench.action.debug.disconnect",
      title: "Debug: Disconnect",
      category: "Debug",
      shortcut: shortcut("workbench.action.debug.disconnect"),
      isEnabled: () => sessionActive && debugSessionAttached && !sessionMutationPending,
      run: disconnectDebug,
    },
    {
      id: "debug.stop",
      title: "Debug: Stop",
      category: "Debug",
      shortcut: shortcut("debug.stop"),
      isEnabled: () => sessionActive && !debugSessionAttached && !sessionMutationPending,
      run: stopDebug,
    },
    {
      id: "debug.toggleBreakpoint",
      title: "Debug: Toggle Breakpoint",
      category: "Debug",
      shortcut: shortcut("debug.toggleBreakpoint"),
      isEnabled: (context) => context.hasWorkspace && context.hasActiveDocument,
      run: toggleBreakpointAtCursor,
    },
    {
      id: "debug.enableAllBreakpoints",
      title: "Debug: Enable All Breakpoints",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        breakpointCounts.disabled > 0 &&
        !breakpointBulkMutationPending &&
        !debugControlPending,
      run: enableAllBreakpoints,
    },
    {
      id: "workbench.debug.viewlet.action.toggleBreakpointsActivatedAction",
      title: "Debug: Toggle Activate Breakpoints",
      category: "Debug",
      shortcut: shortcut("workbench.debug.viewlet.action.toggleBreakpointsActivatedAction"),
      isEnabled: () => canToggleBreakpointsActivated,
      run: toggleBreakpointsActivated,
    },
    {
      id: "debug.disableAllBreakpoints",
      title: "Debug: Disable All Breakpoints",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        breakpointCounts.enabled > 0 &&
        !breakpointBulkMutationPending &&
        !debugControlPending,
      run: disableAllBreakpoints,
    },
    {
      id: "debug.removeAllBreakpoints",
      title: "Debug: Remove All Breakpoints",
      category: "Debug",
      isEnabled: (context) =>
        context.hasWorkspace &&
        breakpointCounts.enabled + breakpointCounts.disabled > 0 &&
        !breakpointBulkMutationPending &&
        !debugControlPending,
      run: removeAllBreakpoints,
    },
    {
      id: "debug.focusConsole",
      title: "Debug: Focus Debug Console",
      category: "Debug",
      shortcut: shortcut("debug.focusConsole"),
      isEnabled: (context) => context.hasWorkspace && isWorkspaceTrusted,
      run: focusDebugConsole,
    },
    {
      id: "debug.clearConsole",
      title: "Debug: Clear Console",
      category: "Debug",
      isEnabled: (context) => context.hasWorkspace && isWorkspaceTrusted && canClearDebugConsole,
      run: clearDebugConsole,
    },
    {
      id: "debug.openPanel",
      title: "Debug: Show Debug Panel",
      category: "Debug",
      isEnabled: (context) => context.hasWorkspace,
      run: openDebugPanel,
    },
  ];
}
