import { useMemo } from "react";
import type {
  DebugWatchExpressionMutations,
  UseDebugSessionResult,
} from "../application/debugSessionContracts";
import type { NodeDebugConfigurationLauncher } from "../application/useNodeDebugConfigurationLauncher";
import type { UseDebugWatchExpressionsResult } from "../application/useDebugWatchExpressions";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { UseDebugConsoleSurfaceCommandsResult } from "../application/useDebugConsoleSurfaceCommands";
import type { UseDebugConsoleCompletionsResult } from "../application/useDebugConsoleCompletions";
import type {
  DebugCopyStackTraceCommand,
  DebugPanelProps,
  DebugRestartFrameCommand,
} from "./DebugPanel";
import type { NodeRunWithoutDebuggingPickerCommand } from "./NodeRunWithoutDebuggingPickerAction";

export type PublicDebugPanelProps = Omit<
  DebugPanelProps,
  "debugAddToWatch" | "debugCopyValue" | "debugSetVariable"
>;

interface UseDebugPanelPropsOptions {
  readonly debugCopyStackTrace?: DebugCopyStackTraceCommand;
  readonly debugRestartFrame?: DebugRestartFrameCommand;
  readonly debugSession: UseDebugSessionResult & {
    readonly console: UseDebugConsoleResult;
    readonly consoleSurface?: UseDebugConsoleSurfaceCommandsResult;
    readonly consoleCompletions?: UseDebugConsoleCompletionsResult;
    readonly configurationLauncher?: NodeDebugConfigurationLauncher;
    readonly watches: UseDebugWatchExpressionsResult & {
      readonly expressionMutations: DebugWatchExpressionMutations;
    };
  };
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly nodeRunConfigurationPicker?: NodeRunWithoutDebuggingPickerCommand;
  readonly openNodeLaunchConfigurations?: () => void;
  readonly openDebugLocation: (
    filePath: string,
    lineNumber: number,
    columnNumber?: number,
  ) => unknown;
  readonly reportCommandError: (error: unknown) => void;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function useDebugPanelProps({
  debugCopyStackTrace,
  debugRestartFrame,
  debugSession,
  hasJavaScriptTypeScriptWorkspace,
  nodeRunConfigurationPicker,
  openNodeLaunchConfigurations,
  openDebugLocation,
  reportCommandError,
  workspaceRoot,
  workspaceTrusted,
}: UseDebugPanelPropsOptions): DebugPanelProps {
  const {
    breakpointBulkMutationPending,
    breakpointCounts,
    breakpoints,
    breakpointsActivated,
    canRestartDebug,
    canToggleBreakpointsActivated,
    console,
    consoleSurface,
    consoleCompletions,
    configurationLauncher,
    debugAdapterKind,
    debugCompoundStartPending,
    debugControlPending,
    debugRestartPending,
    debugStopPending,
    debugSessionAttached,
    disconnectDebug,
    disableAllBreakpoints,
    enableAllBreakpoints,
    exceptionPauseError,
    exceptionPauseMode,
    exceptionPausePending,
    lastStartError,
    inspectionOwner,
    loadVariables,
    loadVariablePage,
    pauseDebug,
    restartDebug,
    removeAllBreakpoints,
    removeBreakpoint,
    scopes,
    selectFrame,
    selectedFrameId,
    setBreakpointCondition,
    setBreakpointEnabled,
    setBreakpointHitCondition,
    setBreakpointLogMessage,
    setExceptionPauseMode,
    snapshot,
    stepDebug,
    stopDebug,
    toggleBreakpointsActivated,
    variablesByReference,
    variablePages,
    variableMutationRows,
    watches,
  } = debugSession;
  return useMemo<PublicDebugPanelProps>(
    () => ({
      breakpointBulkMutationPending,
      breakpointCounts,
      breakpoints,
      breakpointsActivated,
      canRestartDebug: canRestartDebug(),
      canToggleBreakpointsActivated: canToggleBreakpointsActivated?.() ?? false,
      canClearConsole: consoleSurface?.canClear ?? false,
      console,
      consoleCompletion: consoleCompletions?.model ?? null,
      consoleFocusRequest: consoleSurface?.focusRequest ?? null,
      consoleWorkspaceOwnerKey: consoleSurface?.workspaceOwnerKey ?? null,
      debugAdapterKind,
      debugCompoundStartPending,
      debugControlPending,
      debugCopyStackTrace,
      debugRestartFrame,
      debugRestartPending,
      debugStopPending,
      debugSessionAttached,
      exceptionPauseError,
      exceptionPauseMode,
      exceptionPausePending,
      hasJavaScriptTypeScriptWorkspace,
      lastStartError,
      inspectionOwner,
      nodeLaunchConfigurations: configurationLauncher
        ? {
            busy: configurationLauncher.busy,
            choices: configurationLauncher.choices.map(
              ({
                compoundMemberCount,
                default: isDefault,
                hasPreLaunchTask,
                name,
                preLaunchTask,
                runnable,
                source,
                targetKind,
              }) => ({
                ...(compoundMemberCount ? { compoundMemberCount } : {}),
                default: isDefault,
                ...(hasPreLaunchTask ? { hasPreLaunchTask } : {}),
                name,
                ...(preLaunchTask ? { preLaunchTask } : {}),
                ...(runnable === false ? { runnable: false } : {}),
                source,
                targetKind,
              }),
            ),
            diagnosticNotice:
              configurationLauncher.state.kind === "ready" ||
              configurationLauncher.state.kind === "empty"
                ? configurationLauncher.state.diagnosticNotice
                : undefined,
            error:
              configurationLauncher.state.kind === "error"
                ? configurationLauncher.state.message
                : null,
            onLoad: () => void configurationLauncher.load(),
            onClosePicker: configurationLauncher.closePicker,
            onRefresh: () => void configurationLauncher.refresh(),
            onSelect: (name) => void configurationLauncher.select(name),
            onStartNamed: (name) => void configurationLauncher.startNamed(name),
            onStartSelected: () => void configurationLauncher.startSelected(),
            pickerOpen: configurationLauncher.pickerOpen,
            selectedName: configurationLauncher.selectedName,
            state: configurationLauncher.state.kind,
          }
        : undefined,
      nodeRunWithoutDebuggingPicker: nodeRunConfigurationPicker
        ? {
            canOpenPicker: nodeRunConfigurationPicker.canOpenPicker,
            openPicker: nodeRunConfigurationPicker.openPicker,
          }
        : undefined,
      onOpenNodeLaunchConfigurations: openNodeLaunchConfigurations,
      onLoadVariables: (variablesReference) => void loadVariables(variablesReference),
      onClearConsole: consoleSurface?.clear,
      onConsoleFocusRequestHandled: consoleSurface?.acknowledgeFocusRequest,
      onConsoleCompletionAccept: consoleCompletions?.accept,
      onConsoleCompletionDismiss: consoleCompletions?.dismiss,
      onConsoleCompletionInputChanged: consoleCompletions?.inputChanged,
      onConsoleCompletionRequest: consoleCompletions?.request,
      onLoadVariablePage: (owner, variablesReference, start) =>
        void loadVariablePage(owner, variablesReference, start),
      onDisableAllBreakpoints: () => void disableAllBreakpoints().catch(reportCommandError),
      onDisconnect: () => void disconnectDebug().catch(reportCommandError),
      onEnableAllBreakpoints: () => void enableAllBreakpoints().catch(reportCommandError),
      onToggleBreakpointsActivated: () =>
        void toggleBreakpointsActivated?.().catch(reportCommandError),
      onNavigateToBreakpoint: (breakpoint) =>
        void openDebugLocation(breakpoint.filePath, breakpoint.lineNumber, breakpoint.columnNumber),
      onNavigateToFrame: (filePath, lineNumber) => void openDebugLocation(filePath, lineNumber),
      onPause: () => void pauseDebug(),
      onRestart: () => void restartDebug().catch(reportCommandError),
      onRemoveBreakpoint: (id) => void removeBreakpoint(id),
      onRemoveAllBreakpoints: () => void removeAllBreakpoints().catch(reportCommandError),
      onSelectFrame: (frameId) => void selectFrame(frameId),
      onSetBreakpointCondition: (id, condition) => void setBreakpointCondition(id, condition),
      onSetBreakpointEnabled: (id, enabled) => void setBreakpointEnabled(id, enabled),
      onSetBreakpointHitCondition: (id, hitCondition) =>
        void setBreakpointHitCondition(id, hitCondition),
      onSetBreakpointLogMessage: (id, logMessage) => void setBreakpointLogMessage(id, logMessage),
      onSetExceptionPauseMode: (mode) => void setExceptionPauseMode(mode),
      onStep: (kind) => void stepDebug(kind),
      onStop: () => void stopDebug().catch(reportCommandError),
      rootPath: workspaceRoot,
      scopes,
      selectedFrameId,
      snapshot,
      variablesByReference,
      variablePages,
      variableMutationRows,
      watches: {
        definitions: watches.definitions,
        evaluations: watches.evaluations,
        expressionMutations: watches.expressionMutations,
        pendingIds: watches.pendingIds,
        onAdd: watches.add,
        onClear: watches.clear,
        onRemove: watches.remove,
        onSetEnabled: watches.setEnabled,
        onUpdate: watches.update,
      },
      workspaceTrusted,
    }),
    [
      breakpointBulkMutationPending,
      breakpointCounts,
      breakpoints,
      breakpointsActivated,
      canRestartDebug,
      canToggleBreakpointsActivated,
      console,
      consoleCompletions,
      consoleSurface,
      configurationLauncher,
      debugAdapterKind,
      debugCompoundStartPending,
      debugControlPending,
      debugCopyStackTrace,
      debugRestartFrame,
      debugRestartPending,
      debugStopPending,
      debugSessionAttached,
      disconnectDebug,
      disableAllBreakpoints,
      enableAllBreakpoints,
      exceptionPauseError,
      exceptionPauseMode,
      exceptionPausePending,
      hasJavaScriptTypeScriptWorkspace,
      lastStartError,
      inspectionOwner,
      loadVariables,
      loadVariablePage,
      nodeRunConfigurationPicker,
      openNodeLaunchConfigurations,
      openDebugLocation,
      pauseDebug,
      restartDebug,
      reportCommandError,
      removeAllBreakpoints,
      removeBreakpoint,
      scopes,
      selectFrame,
      selectedFrameId,
      setBreakpointCondition,
      setBreakpointEnabled,
      setBreakpointHitCondition,
      setBreakpointLogMessage,
      setExceptionPauseMode,
      snapshot,
      stepDebug,
      stopDebug,
      toggleBreakpointsActivated,
      variablesByReference,
      variablePages,
      variableMutationRows,
      watches,
      workspaceRoot,
      workspaceTrusted,
    ],
  );
}
