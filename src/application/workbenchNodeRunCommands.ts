import type { KeymapCommandId } from "../domain/keymap";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { Command } from "./commandRegistry";
import type { NodeRunWithoutDebuggingState } from "./useNodeRunWithoutDebugging";

interface NodeRunAvailability {
  readonly debugControlPending: boolean;
  readonly debugRestartPending: boolean;
  readonly debugSessionKind: DebuggerSessionSnapshot["state"]["kind"];
  readonly debugStartPending: boolean;
  readonly debugStopPending: boolean;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly hasRunnableCleanActiveDocument: boolean;
  readonly workspaceTrusted: boolean;
}

export function canRunNodeWithoutDebugging({
  debugControlPending,
  debugRestartPending,
  debugSessionKind,
  debugStartPending,
  debugStopPending,
  hasJavaScriptTypeScriptWorkspace,
  hasRunnableCleanActiveDocument,
  workspaceTrusted,
}: NodeRunAvailability): boolean {
  return (
    workspaceTrusted &&
    hasJavaScriptTypeScriptWorkspace &&
    hasRunnableCleanActiveDocument &&
    debugRuntimeAllowsNodeRun({
      debugControlPending,
      debugRestartPending,
      debugSessionKind,
      debugStartPending,
      debugStopPending,
    })
  );
}

export function debugRuntimeAllowsNodeRun({
  debugControlPending,
  debugRestartPending,
  debugSessionKind,
  debugStartPending,
  debugStopPending,
}: Pick<
  NodeRunAvailability,
  | "debugControlPending"
  | "debugRestartPending"
  | "debugSessionKind"
  | "debugStartPending"
  | "debugStopPending"
>): boolean {
  return (
    debugSessionKind !== "starting" &&
    debugSessionKind !== "running" &&
    debugSessionKind !== "stopped" &&
    !debugControlPending &&
    !debugRestartPending &&
    !debugStartPending &&
    !debugStopPending
  );
}

interface WorkbenchNodeRunCommandsOptions {
  readonly canRun: boolean;
  readonly canStop: boolean;
  readonly configurationLauncher: {
    readonly busy: boolean;
    readonly pickerOpen: boolean;
    canOpenPicker(): boolean;
    openPicker(): void;
  };
  readonly pending: boolean;
  shortcut(commandId: KeymapCommandId): string;
  run: Command["run"];
  stop: Command["run"];
}

export function canStopNodeRunWithoutDebugging(state: NodeRunWithoutDebuggingState): boolean {
  return (
    state.kind === "resolving" ||
    state.kind === "waiting-for-terminal" ||
    state.kind === "starting" ||
    state.kind === "running" ||
    (state.kind === "stopping" && state.retryable)
  );
}

/** Command projection for the owner-safe Node run lifecycle. */
export function workbenchNodeRunCommands({
  canRun,
  canStop,
  configurationLauncher,
  pending,
  run,
  shortcut,
  stop,
}: WorkbenchNodeRunCommandsOptions): Command[] {
  return [
    {
      id: "debug.runWithoutDebugging",
      title: "Run: Start Without Debugging",
      category: "Run",
      shortcut: shortcut("debug.runWithoutDebugging"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        !context.activeDocumentDirty &&
        canRun &&
        !pending,
      run,
    },
    {
      id: "debug.stopWithoutDebugging",
      title: "Run: Stop Without Debugging",
      category: "Run",
      isEnabled: (context) => context.hasWorkspace && canStop,
      run: stop,
    },
    {
      id: "debug.selectAndStartWithoutDebugging",
      title: "Run: Select and Start Without Debugging",
      category: "Run",
      isEnabled: (context) =>
        context.hasWorkspace &&
        !pending &&
        !canStop &&
        !configurationLauncher.busy &&
        !configurationLauncher.pickerOpen &&
        configurationLauncher.canOpenPicker(),
      run: configurationLauncher.openPicker,
    },
  ];
}
