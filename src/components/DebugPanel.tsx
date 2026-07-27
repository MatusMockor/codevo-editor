import {
  ArrowDownToDot,
  ArrowUpFromDot,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleOff,
  Copy,
  Pause,
  Play,
  RotateCw,
  Square,
  StepForward,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  Breakpoint,
  BreakpointHitCondition,
  DebugExceptionPauseMode,
  DebugExceptionTypeFilter,
  DebugScope,
  DebugVariable,
  StackFrame,
  StepKind,
  FunctionBreakpoint,
} from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { LatencyTracker } from "../domain/latencyTracker";
import type { ActiveDebugAdapterKind } from "../application/useDebugSession";
import type {
  DebugScopeLoadState,
  DebugVariableMutationRows,
} from "../application/debugSessionContracts";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugConsoleFocusRequest } from "../application/useDebugConsoleSurfaceCommands";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { isBreakpointPathSupported } from "../domain/debugBreakpointPolicy";
import {
  breakpointHitConditionError,
  formatBreakpointHitCondition,
  parseBreakpointHitCondition,
} from "../domain/debugBreakpointHitCondition";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
} from "../domain/debugBreakpointLogMessage";
import { DebugWatchesPanel, type DebugWatchesPanelProps } from "./DebugWatchesPanel";
import {
  DebugConsolePanel,
  type DebugConsoleCompletionItem,
  type DebugConsoleCompletionModel,
  type DebugConsoleCompletionReplacement,
  type DebugConsoleCompletionRequest,
} from "./DebugConsolePanel";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { DebugVariableTree, type DebugVariableTreeRoot } from "./DebugVariableTree";
import {
  NodeDebugLaunchSelector,
  type NodeDebugLaunchSelectorProps,
} from "./NodeDebugLaunchSelector";
import { NodeDebugConfigurationPicker } from "./NodeDebugConfigurationPicker";
import type { NodeLaunchConfigurationPickerDiagnosticNotice } from "./NodeLaunchConfigurationPicker";
import {
  NodeRunWithoutDebuggingPickerAction,
  type NodeRunWithoutDebuggingPickerCommand,
} from "./NodeRunWithoutDebuggingPickerAction";
import { NodeLaunchConfigurationsAction } from "./NodeLaunchConfigurationsAction";
import type {
  DebugCopyDisplayedValueSurface,
  DebugCopyValueSurface,
} from "./debugCopyValueSurface";
import type { DebugSetVariableSurface } from "./debugSetVariableSurface";
import type { DebugAddToWatchVariableSurface } from "./debugAddToWatchSurface";
import { FunctionBreakpoints } from "./FunctionBreakpoints";
import { ExceptionTypeFilter } from "./ExceptionTypeFilter";
import { useWindowedRows } from "./useWindowedRows";
import { createBreakpointGroupRows, groupBreakpointsByFile } from "../domain/debugBreakpointGroups";
import { useBreakpointGroupCollapseState } from "../application/useBreakpointGroupCollapseState";
import { useBreakpointRowFocus } from "../application/useBreakpointRowFocus";

const DEBUG_LIST_VIRTUALIZATION_THRESHOLD = 50;
const DEBUG_LIST_VIEWPORT_HEIGHT = 240;
const CALL_STACK_ROW_HEIGHT = 25;
const BREAKPOINT_ROW_HEIGHT = 36;
const BREAKPOINT_GROUP_ROW_HEIGHT = 28;

type NodeLaunchConfigurationsProps = Omit<
  NodeDebugLaunchSelectorProps,
  "mutationPending" | "sessionActive" | "workspaceTrusted"
> & {
  readonly diagnosticNotice?: NodeLaunchConfigurationPickerDiagnosticNotice;
  readonly onClosePicker?: () => void;
  readonly onStartNamed?: (name: string) => void;
  readonly pickerOpen?: boolean;
};

const EMPTY_STACK_FRAMES: readonly StackFrame[] = Object.freeze([]);
const EMPTY_EXCEPTION_TYPE_FILTER: DebugExceptionTypeFilter = Object.freeze([]);

export interface DebugCopyStackTraceCommand {
  canCopyStackTrace(): boolean;
  copyStackTrace(): boolean;
}

export interface DebugRestartFrameCommand {
  canRestartFrame(): boolean;
  restartFrame(): boolean;
}

export interface DebugCopyValuePanelSurfaces {
  readonly console: DebugCopyDisplayedValueSurface;
  readonly variables: DebugCopyValueSurface;
  readonly watch: DebugCopyValueSurface;
}

export interface DebugPanelProps {
  breakpointBulkMutationPending?: boolean;
  breakpointsActivated?: boolean;
  canToggleBreakpointsActivated?: boolean;
  breakpointCounts?: {
    readonly disabled: number;
    readonly enabled: number;
  };
  breakpoints: Breakpoint[];
  functionBreakpoints?: readonly FunctionBreakpoint[];
  canRestartDebug?: boolean;
  canClearConsole?: boolean;
  console: UseDebugConsoleResult;
  consoleCompletion?: DebugConsoleCompletionModel | null;
  consoleFocusRequest?: DebugConsoleFocusRequest | null;
  consoleWorkspaceOwnerKey?: string | null;
  debugAdapterKind: ActiveDebugAdapterKind;
  debugAddToWatch?: DebugAddToWatchVariableSurface;
  debugControlPending?: boolean;
  debugCompoundActive?: boolean;
  debugCompoundStartPending?: boolean;
  debugCopyValue?: DebugCopyValuePanelSurfaces;
  debugSetVariable?: DebugSetVariableSurface;
  debugCopyStackTrace?: DebugCopyStackTraceCommand;
  debugRestartFrame?: DebugRestartFrameCommand;
  debugRestartPending?: boolean;
  debugStartPending?: boolean;
  debugStopPending?: boolean;
  debugSessionAttached?: boolean;
  debugStartBlockedByOtherOwner?: boolean;
  lastStartError: string | null;
  latencyTracker?: LatencyTracker;
  exceptionPauseError: string | null;
  exceptionPauseMode: DebugExceptionPauseMode;
  exceptionPausePending: boolean;
  exceptionTypeFilter?: DebugExceptionTypeFilter;
  hasJavaScriptTypeScriptWorkspace: boolean;
  nodeLaunchConfigurations?: NodeLaunchConfigurationsProps;
  nodeRunWithoutDebuggingPicker?: NodeRunWithoutDebuggingPickerCommand;
  onOpenNodeLaunchConfigurations?: () => void;
  onLoadVariables(variablesReference: number): void;
  onClearConsole?(): void;
  onConsoleFocusRequestHandled?(request: DebugConsoleFocusRequest): void;
  onConsoleCompletionAccept?(
    item: DebugConsoleCompletionItem,
    request: DebugConsoleCompletionRequest,
  ): DebugConsoleCompletionReplacement | null;
  onConsoleCompletionDismiss?(): void;
  onConsoleCompletionInputChanged?(request: DebugConsoleCompletionRequest): void;
  onConsoleCompletionRequest?(request: DebugConsoleCompletionRequest): void;
  onDisableAllBreakpoints?(): void;
  onDisconnect(): void;
  onEnableAllBreakpoints?(): void;
  onToggleBreakpointsActivated?(): void;
  onNavigateToBreakpoint(breakpoint: Breakpoint): void;
  onNavigateToFrame(filePath: string, lineNumber: number): void;
  onPause(): void;
  onRestart?(): void;
  onRemoveBreakpoint(id: string): void;
  onRemoveAllBreakpoints?(): void;
  onAddFunctionBreakpoint?(functionName: string): void;
  onRemoveFunctionBreakpoint?(id: string): void;
  onSelectFrame(frameId: number): void;
  onSetBreakpointCondition(id: string, condition: string | null): void;
  onSetBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): void;
  onSetBreakpointLogMessage(id: string, logMessage: string | null): void;
  onSetBreakpointEnabled(id: string, enabled: boolean): void;
  onSetFunctionBreakpointEnabled?(id: string, enabled: boolean): void;
  onSetExceptionPauseMode(mode: DebugExceptionPauseMode): void;
  onSetExceptionTypeFilter?(filter: DebugExceptionTypeFilter): void;
  onStep(kind: StepKind): void;
  onStop(): void;
  rootPath: string | null;
  scopeLoadState: DebugScopeLoadState;
  scopes: DebugScope[];
  selectedFrameId: number | null;
  snapshot: DebuggerSessionSnapshot;
  variablesByReference: Record<number, DebugVariable[]>;
  inspectionOwner?: DebugInspectionOwner | null;
  variablePages?: DebugVariablePagesState;
  variableMutationRows?: DebugVariableMutationRows;
  onLoadVariablePage?(
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
    filter?: import("../domain/debug").DebugVariableFilter,
  ): void | Promise<void>;
  watches: Omit<
    DebugWatchesPanelProps,
    | "debugAdapterKind"
    | "sessionState"
    | "setVariableSurface"
    | "variableMutationRows"
    | "workspaceRoot"
    | "workspaceTrusted"
  >;
  workspaceTrusted: boolean;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    padding: 2,
  },
  breakpointRow: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 6,
    padding: "3px 8px",
  },
  breakpointGroupHeader: {
    alignItems: "center",
    background: "var(--background-active, rgba(127, 127, 127, 0.08))",
    border: 0,
    borderBottom: "1px solid var(--border-subtle)",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    gap: 4,
    overflow: "hidden",
    padding: "4px 8px",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  exceptionPause: {
    borderBottom: "1px solid var(--border-subtle)",
    display: "grid",
    gap: 4,
    padding: "6px 8px",
  },
  column: {
    borderRight: "1px solid var(--border-subtle)",
    minHeight: 0,
    overflow: "auto",
  },
  variableColumn: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  columnTitle: {
    borderBottom: "1px solid var(--border-subtle)",
    display: "block",
    padding: "4px 8px",
  },
  columnTitleBar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 8px",
  },
  columnTitleActions: {
    alignItems: "center",
    display: "inline-flex",
    gap: 4,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    minHeight: 0,
  },
  conditionInput: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    flex: 1,
    fontSize: 11,
    minWidth: 0,
    padding: "1px 4px",
  },
  console: {
    borderTop: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  frame: {
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "block",
    overflow: "hidden",
    padding: "3px 8px",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  frameActive: {
    background: "var(--background-active, rgba(127, 127, 127, 0.2))",
  },
  windowedList: {
    maxHeight: DEBUG_LIST_VIEWPORT_HEIGHT,
    minHeight: 0,
    overflow: "auto",
    position: "relative",
  },
  windowedRow: {
    boxSizing: "border-box",
    left: 0,
    position: "absolute",
    width: "100%",
  },
  location: {
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    overflow: "hidden",
    padding: 0,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { color: "var(--text-muted)", padding: 8 },
  muted: { color: "var(--text-muted)" },
  panel: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) minmax(0, 35%)",
    height: "100%",
  },
  stderr: { color: "var(--status-error, #ef4444)" },
  toolbar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 6,
    padding: "4px 8px",
  },
  variableRow: {
    overflow: "hidden",
    padding: "2px 8px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export function DebugPanel({
  breakpointBulkMutationPending = false,
  breakpointsActivated = true,
  breakpointCounts = { disabled: 0, enabled: 0 },
  breakpoints,
  functionBreakpoints = [],
  canRestartDebug = false,
  canToggleBreakpointsActivated = false,
  canClearConsole = false,
  console,
  consoleCompletion,
  consoleFocusRequest = null,
  consoleWorkspaceOwnerKey = null,
  debugAdapterKind,
  debugAddToWatch,
  debugControlPending = false,
  debugCompoundActive = false,
  debugCompoundStartPending = false,
  debugCopyValue,
  debugSetVariable,
  debugCopyStackTrace,
  debugRestartFrame,
  debugRestartPending = false,
  debugStartPending = false,
  debugStopPending = false,
  debugSessionAttached = false,
  debugStartBlockedByOtherOwner = false,
  exceptionPauseError,
  exceptionPauseMode,
  exceptionPausePending,
  exceptionTypeFilter = EMPTY_EXCEPTION_TYPE_FILTER,
  hasJavaScriptTypeScriptWorkspace,
  lastStartError,
  latencyTracker,
  nodeLaunchConfigurations,
  nodeRunWithoutDebuggingPicker,
  onOpenNodeLaunchConfigurations,
  onDisableAllBreakpoints,
  onDisconnect,
  onEnableAllBreakpoints,
  onToggleBreakpointsActivated,
  onLoadVariables,
  onClearConsole,
  onConsoleCompletionAccept,
  onConsoleCompletionDismiss,
  onConsoleCompletionInputChanged,
  onConsoleCompletionRequest,
  onConsoleFocusRequestHandled,
  onLoadVariablePage,
  onNavigateToBreakpoint,
  onNavigateToFrame,
  onPause,
  onRestart,
  onRemoveBreakpoint,
  onRemoveAllBreakpoints,
  onAddFunctionBreakpoint,
  onRemoveFunctionBreakpoint,
  onSelectFrame,
  onSetBreakpointCondition,
  onSetBreakpointHitCondition,
  onSetBreakpointLogMessage,
  onSetBreakpointEnabled,
  onSetFunctionBreakpointEnabled,
  onSetExceptionPauseMode,
  onSetExceptionTypeFilter,
  onStep,
  onStop,
  rootPath,
  scopeLoadState,
  scopes,
  selectedFrameId,
  snapshot,
  variablesByReference,
  inspectionOwner,
  variablePages,
  variableMutationRows,
  watches,
  workspaceTrusted,
}: DebugPanelProps) {
  const state = snapshot.state;
  const stopped = state.kind === "stopped";
  const running = state.kind === "running";
  const sessionActive =
    running ||
    stopped ||
    state.kind === "starting" ||
    debugStartPending ||
    debugStartBlockedByOtherOwner ||
    debugCompoundStartPending;
  const copyStackTraceVisible = canCopyStackTrace(debugCopyStackTrace);
  const nodeConfigurationPickerVisible =
    hasJavaScriptTypeScriptWorkspace &&
    Boolean(nodeLaunchConfigurations?.pickerOpen) &&
    workspaceTrusted &&
    !sessionActive &&
    !debugStopPending &&
    !debugRestartPending;
  const exceptionPauseDisabled =
    exceptionPausePending ||
    !workspaceTrusted ||
    (sessionActive ? debugAdapterKind !== "node" : !hasJavaScriptTypeScriptWorkspace);

  return (
    <div aria-label="Debug" role="tabpanel" style={styles.panel}>
      <div style={styles.toolbar}>
        <ToolbarButton
          disabled={!stopped || !workspaceTrusted || debugRestartPending || debugStopPending}
          label="Continue"
          onClick={() => onStep("continue")}
        >
          <Play aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!running || !workspaceTrusted || debugRestartPending || debugStopPending}
          label="Pause"
          onClick={onPause}
        >
          <Pause aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          busy={debugRestartPending}
          disabled={
            (!running && !stopped) ||
            debugAdapterKind !== "node" ||
            !workspaceTrusted ||
            !canRestartDebug ||
            debugRestartPending ||
            debugStopPending ||
            !onRestart
          }
          label="Restart debugging"
          onClick={() => onRestart?.()}
          title={
            debugRestartPending
              ? "Restarting debugging"
              : debugStopPending
                ? "Stopping debugging"
                : "Restart debugging"
          }
        >
          <RotateCw aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped || !workspaceTrusted || debugRestartPending || debugStopPending}
          label="Step over"
          onClick={() => onStep("stepOver")}
        >
          <StepForward aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped || !workspaceTrusted || debugRestartPending || debugStopPending}
          label="Step into"
          onClick={() => onStep("stepInto")}
        >
          <ArrowDownToDot aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped || !workspaceTrusted || debugRestartPending || debugStopPending}
          label="Step out"
          onClick={() => onStep("stepOut")}
        >
          <ArrowUpFromDot aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          busy={debugStopPending}
          disabled={
            debugRestartPending ||
            debugStopPending ||
            (!running &&
              !stopped &&
              state.kind !== "starting" &&
              !debugStartPending &&
              !debugCompoundStartPending)
          }
          label={debugSessionAttached ? "Disconnect debugging" : "Stop debugging"}
          onClick={debugSessionAttached ? onDisconnect : onStop}
          title={
            debugStopPending
              ? debugSessionAttached
                ? "Disconnecting debugging"
                : "Stopping debugging"
              : debugSessionAttached
                ? "Disconnect debugging"
                : "Stop debugging"
          }
        >
          {debugSessionAttached ? (
            <Unplug aria-hidden="true" size={14} />
          ) : (
            <Square aria-hidden="true" size={14} />
          )}
        </ToolbarButton>
        {hasJavaScriptTypeScriptWorkspace && nodeLaunchConfigurations ? (
          <NodeDebugLaunchSelector
            {...nodeLaunchConfigurations}
            mutationPending={debugStopPending || debugRestartPending}
            sessionActive={sessionActive}
            workspaceTrusted={workspaceTrusted}
          />
        ) : null}
        {hasJavaScriptTypeScriptWorkspace && nodeRunWithoutDebuggingPicker ? (
          <NodeRunWithoutDebuggingPickerAction command={nodeRunWithoutDebuggingPicker} />
        ) : null}
        {hasJavaScriptTypeScriptWorkspace && onOpenNodeLaunchConfigurations ? (
          <NodeLaunchConfigurationsAction onOpen={onOpenNodeLaunchConfigurations} />
        ) : null}
        <span data-testid="debug-status" style={styles.muted}>
          {debuggerStatusLabel(
            snapshot,
            debugStartPending || debugCompoundStartPending,
            debugStopPending,
            debugStartBlockedByOtherOwner,
          )}
        </span>
        {lastStartError ? (
          <span role="alert" style={styles.stderr}>
            {lastStartError}
          </span>
        ) : null}
      </div>
      <div style={styles.columns}>
        <section aria-label="Call Stack" style={styles.column}>
          <div style={styles.columnTitleBar}>
            <strong>Call Stack</strong>
            {copyStackTraceVisible ? (
              <span
                aria-label="Call stack actions"
                role="toolbar"
                style={styles.columnTitleActions}
              >
                <ToolbarButton
                  disabled={false}
                  label="Copy Call Stack"
                  onClick={() => {
                    if (canCopyStackTrace(debugCopyStackTrace)) {
                      debugCopyStackTrace?.copyStackTrace();
                    }
                  }}
                  title="Copy Call Stack"
                >
                  <Copy aria-hidden="true" size={12} />
                </ToolbarButton>
              </span>
            ) : null}
          </div>
          <CallStack
            debugAdapterKind={debugAdapterKind}
            debugControlPending={debugControlPending}
            debugRestartFrame={debugRestartFrame}
            onNavigateToFrame={onNavigateToFrame}
            onSelectFrame={onSelectFrame}
            rootPath={rootPath}
            selectedFrameId={selectedFrameId}
            snapshot={snapshot}
            workspaceTrusted={workspaceTrusted}
          />
        </section>
        <section aria-label="Variables" style={{ ...styles.column, ...styles.variableColumn }}>
          <strong style={styles.columnTitle}>Variables</strong>
          <Variables
            addToWatchSurface={debugAddToWatch}
            copyValueSurface={debugCopyValue?.variables}
            inspectionOwner={inspectionOwner}
            latencyTracker={latencyTracker}
            onLoadVariablePage={onLoadVariablePage}
            onLoadVariables={onLoadVariables}
            onRetryFrame={onSelectFrame}
            scopeLoadState={scopeLoadState}
            scopes={scopes}
            setVariableSurface={debugSetVariable}
            stopped={stopped}
            variablePages={variablePages}
            variableMutationRows={variableMutationRows}
            variablesByReference={variablesByReference}
          />
        </section>
        <section aria-label="Breakpoints" style={styles.column}>
          <div style={styles.columnTitleBar}>
            <strong>Breakpoints</strong>
            <span
              aria-busy={breakpointBulkMutationPending || undefined}
              aria-label="Breakpoint actions"
              role="toolbar"
              style={styles.columnTitleActions}
            >
              {debugAdapterKind === "node" ? (
                <ToolbarButton
                  busy={debugControlPending}
                  disabled={
                    !canToggleBreakpointsActivated ||
                    breakpointBulkMutationPending ||
                    debugControlPending ||
                    !onToggleBreakpointsActivated
                  }
                  label={breakpointsActivated ? "Deactivate breakpoints" : "Activate breakpoints"}
                  onClick={() => onToggleBreakpointsActivated?.()}
                  pressed={breakpointsActivated}
                  title={
                    debugControlPending
                      ? "Updating breakpoint activation"
                      : breakpointsActivated
                        ? "Deactivate breakpoints"
                        : "Activate breakpoints"
                  }
                >
                  {breakpointsActivated ? (
                    <CircleCheckBig aria-hidden="true" size={12} />
                  ) : (
                    <CircleOff aria-hidden="true" size={12} />
                  )}
                </ToolbarButton>
              ) : null}
              <ToolbarButton
                busy={breakpointBulkMutationPending}
                disabled={
                  breakpointCounts.disabled === 0 ||
                  breakpointBulkMutationPending ||
                  !onEnableAllBreakpoints
                }
                label="Enable all breakpoints"
                onClick={() => onEnableAllBreakpoints?.()}
                title={
                  breakpointBulkMutationPending ? "Updating breakpoints" : "Enable all breakpoints"
                }
              >
                <CircleCheckBig aria-hidden="true" size={12} />
              </ToolbarButton>
              <ToolbarButton
                busy={breakpointBulkMutationPending}
                disabled={
                  breakpointCounts.enabled === 0 ||
                  breakpointBulkMutationPending ||
                  !onDisableAllBreakpoints
                }
                label="Disable all breakpoints"
                onClick={() => onDisableAllBreakpoints?.()}
                title={
                  breakpointBulkMutationPending ? "Updating breakpoints" : "Disable all breakpoints"
                }
              >
                <CircleOff aria-hidden="true" size={12} />
              </ToolbarButton>
              <ToolbarButton
                busy={breakpointBulkMutationPending}
                disabled={
                  breakpointCounts.enabled + breakpointCounts.disabled === 0 ||
                  breakpointBulkMutationPending ||
                  !onRemoveAllBreakpoints
                }
                label="Remove all breakpoints"
                onClick={() => onRemoveAllBreakpoints?.()}
                title={
                  breakpointBulkMutationPending ? "Updating breakpoints" : "Remove all breakpoints"
                }
              >
                <Trash2 aria-hidden="true" size={12} />
              </ToolbarButton>
            </span>
          </div>
          <label aria-busy={exceptionPausePending} style={styles.exceptionPause}>
            <span>Pause on exceptions</span>
            <select
              aria-label="Pause on exceptions"
              disabled={exceptionPauseDisabled}
              onChange={(event) =>
                onSetExceptionPauseMode(event.target.value as DebugExceptionPauseMode)
              }
              value={exceptionPauseMode}
            >
              <option value="none">None</option>
              <option value="uncaught">Uncaught</option>
              <option value="all">All</option>
            </select>
            {exceptionPauseError ? (
              <span role="alert" style={styles.stderr}>
                {exceptionPauseError}
              </span>
            ) : null}
          </label>
          {debugAdapterKind !== "php" &&
          hasJavaScriptTypeScriptWorkspace &&
          onSetExceptionTypeFilter ? (
            <ExceptionTypeFilter
              disabled={exceptionPauseDisabled || exceptionPauseMode === "none"}
              filter={exceptionTypeFilter}
              key={rootPath ?? ""}
              onChange={onSetExceptionTypeFilter}
            />
          ) : null}
          <Breakpoints
            breakpoints={breakpoints}
            onNavigateToBreakpoint={onNavigateToBreakpoint}
            onRemoveBreakpoint={onRemoveBreakpoint}
            onSetBreakpointCondition={onSetBreakpointCondition}
            onSetBreakpointHitCondition={onSetBreakpointHitCondition}
            onSetBreakpointLogMessage={onSetBreakpointLogMessage}
            onSetBreakpointEnabled={onSetBreakpointEnabled}
            supportsHitConditions={debugAdapterKind !== "php" && hasJavaScriptTypeScriptWorkspace}
            supportsLogpoints={debugAdapterKind !== "php" && hasJavaScriptTypeScriptWorkspace}
            rootPath={rootPath}
          />
          {debugAdapterKind !== "php" &&
          !debugCompoundActive &&
          !debugCompoundStartPending &&
          hasJavaScriptTypeScriptWorkspace &&
          onAddFunctionBreakpoint &&
          onRemoveFunctionBreakpoint &&
          onSetFunctionBreakpointEnabled ? (
            <FunctionBreakpoints
              breakpoints={functionBreakpoints}
              disabled={!workspaceTrusted}
              onAdd={onAddFunctionBreakpoint}
              onRemove={onRemoveFunctionBreakpoint}
              onSetEnabled={onSetFunctionBreakpointEnabled}
            />
          ) : null}
        </section>
        <div style={{ ...styles.column, borderRight: 0 }}>
          <DebugWatchesPanel
            {...watches}
            copyValueSurface={debugCopyValue?.watch}
            debugAdapterKind={debugAdapterKind}
            onLoadVariablePage={onLoadVariablePage}
            setVariableSurface={debugSetVariable}
            sessionState={state.kind}
            variablePages={variablePages}
            variableMutationRows={variableMutationRows}
            workspaceRoot={rootPath}
            workspaceTrusted={workspaceTrusted}
          />
        </div>
      </div>
      <section aria-label="Debug console" style={styles.console}>
        <div style={styles.columnTitleBar}>
          <strong>Console</strong>
          <span aria-label="Debug console actions" role="toolbar" style={styles.columnTitleActions}>
            <ToolbarButton
              disabled={!workspaceTrusted || !canClearConsole || !onClearConsole}
              label="Clear debug console"
              onClick={() => onClearConsole?.()}
            >
              <Trash2 aria-hidden="true" size={12} />
            </ToolbarButton>
          </span>
        </div>
        <DebugConsolePanel
          completion={consoleCompletion}
          console={console}
          copyDisplayedValueSurface={debugCopyValue?.console}
          enabled={stopped && workspaceTrusted}
          focusRequest={consoleFocusRequest}
          onAccept={onConsoleCompletionAccept}
          onDismiss={onConsoleCompletionDismiss}
          onFocusRequestHandled={onConsoleFocusRequestHandled}
          onInputChanged={onConsoleCompletionInputChanged}
          onLoadVariablePage={onLoadVariablePage}
          onRequest={onConsoleCompletionRequest}
          inspectionOwner={inspectionOwner}
          latencyTracker={latencyTracker}
          variablePages={variablePages}
          workspaceOwnerKey={consoleWorkspaceOwnerKey}
        />
      </section>
      {nodeConfigurationPickerVisible && nodeLaunchConfigurations ? (
        <NodeDebugConfigurationPicker
          busy={nodeLaunchConfigurations.busy}
          choices={nodeLaunchConfigurations.choices}
          diagnosticNotice={nodeLaunchConfigurations.diagnosticNotice}
          error={nodeLaunchConfigurations.error}
          onClose={nodeLaunchConfigurations.onClosePicker ?? (() => undefined)}
          onRefresh={nodeLaunchConfigurations.onRefresh}
          onStartNamed={nodeLaunchConfigurations.onStartNamed ?? (() => undefined)}
          open
          selectedName={nodeLaunchConfigurations.selectedName}
          state={nodeLaunchConfigurations.state}
        />
      ) : null}
    </div>
  );
}

function canCopyStackTrace(command: DebugPanelProps["debugCopyStackTrace"]): boolean {
  try {
    return command?.canCopyStackTrace() === true;
  } catch {
    return false;
  }
}

function ToolbarButton({
  busy,
  children,
  disabled,
  label,
  onClick,
  pressed,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick(): void;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <button
      aria-busy={busy || undefined}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      style={styles.action}
      title={title ?? label}
      type="button"
    >
      {children}
    </button>
  );
}

function debuggerStatusLabel(
  snapshot: DebuggerSessionSnapshot,
  startPending: boolean,
  stopPending: boolean,
  startBlockedByOtherOwner: boolean,
): string {
  const state = snapshot.state;

  if (startPending && stopPending) {
    return "Stopping";
  }

  if (startPending || state.kind === "starting") {
    return "Starting";
  }

  if (startBlockedByOtherOwner) {
    return "Waiting for another debug session";
  }

  if (state.kind === "running") {
    return "Running";
  }

  if (state.kind === "stopped") {
    const reason = state.reason === "entry" ? "Entry" : state.reason;
    return `Paused (${reason})`;
  }

  if (state.kind === "terminated") {
    if (state.exitCode === null) {
      return "Terminated";
    }

    return `Terminated (exit code ${state.exitCode})`;
  }

  return "Inactive";
}

function displayPath(rootPath: string | null, filePath: string): string {
  if (!rootPath) {
    return filePath;
  }

  return workspaceRelativePath(rootPath, filePath) ?? filePath;
}

function breakpointLocationLabel(breakpoint: Breakpoint, rootPath?: string | null): string {
  const path =
    rootPath === undefined ? breakpoint.filePath : displayPath(rootPath, breakpoint.filePath);
  const column = breakpoint.columnNumber === undefined ? "" : `:${breakpoint.columnNumber}`;
  return `${path}:${breakpoint.lineNumber}${column}`;
}

function CallStack({
  debugAdapterKind,
  debugControlPending,
  debugRestartFrame,
  onNavigateToFrame,
  onSelectFrame,
  rootPath,
  selectedFrameId,
  snapshot,
  workspaceTrusted,
}: {
  debugAdapterKind: ActiveDebugAdapterKind;
  debugControlPending: boolean;
  debugRestartFrame?: DebugRestartFrameCommand;
  onNavigateToFrame(filePath: string, lineNumber: number): void;
  onSelectFrame(frameId: number): void;
  rootPath: string | null;
  selectedFrameId: number | null;
  snapshot: DebuggerSessionSnapshot;
  workspaceTrusted: boolean;
}) {
  const state = snapshot.state;
  const [rovingFrameId, setRovingFrameId] = useState<number | null>(null);
  const frameButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const frameFocusOwnedRef = useRef(false);
  const previousSelectedFrameIdRef = useRef(selectedFrameId);
  const visibleFrames = state.kind === "stopped" ? state.frames : EMPTY_STACK_FRAMES;
  const highlightedFrameId =
    state.kind === "stopped" ? (selectedFrameId ?? state.topFrame?.frameId ?? null) : null;
  const visibleFrameIds = visibleFrames.map(({ frameId }) => frameId).join(":");
  const rovingFrameIndex = visibleFrames.findIndex(({ frameId }) => frameId === rovingFrameId);
  const highlightedFrameIndex = visibleFrames.findIndex(
    ({ frameId }) => frameId === highlightedFrameId,
  );
  const pinnedFrameIndices = useMemo(
    () => [...new Set([rovingFrameIndex, highlightedFrameIndex].filter((index) => index >= 0))],
    [highlightedFrameIndex, rovingFrameIndex],
  );
  const estimateFrameHeight = useCallback(() => CALL_STACK_ROW_HEIGHT, []);
  const keyForFrameIndex = useCallback(
    (index: number) => String(visibleFrames[index]?.frameId ?? index),
    [visibleFrames],
  );
  const windowedFrames = useWindowedRows({
    enabled: visibleFrames.length > DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
    estimateHeight: estimateFrameHeight,
    fallbackViewportHeight: DEBUG_LIST_VIEWPORT_HEIGHT,
    itemCount: visibleFrames.length,
    keyForIndex: keyForFrameIndex,
    pinnedIndices: pinnedFrameIndices,
  });
  const scrollToFrameIndex = windowedFrames.scrollToIndex;

  useEffect(() => {
    const selectionChanged = previousSelectedFrameIdRef.current !== selectedFrameId;
    previousSelectedFrameIdRef.current = selectedFrameId;
    if (visibleFrames.length === 0) {
      frameFocusOwnedRef.current = false;
      if (rovingFrameId !== null) setRovingFrameId(null);
      return;
    }
    const selectedIsVisible = visibleFrames.some(({ frameId }) => frameId === selectedFrameId);
    const rovingIsVisible = visibleFrames.some(({ frameId }) => frameId === rovingFrameId);
    const highlightedIsVisible = visibleFrames.some(
      ({ frameId }) => frameId === highlightedFrameId,
    );
    const nextFrameId: number =
      selectionChanged && selectedIsVisible
        ? selectedFrameId!
        : rovingIsVisible
          ? rovingFrameId!
          : highlightedIsVisible
            ? highlightedFrameId!
            : visibleFrames[0]!.frameId;
    const activeFrameIsVisible = [...frameButtonRefs.current.values()].some(
      (element) => element === document.activeElement,
    );
    if (rovingFrameId !== nextFrameId) setRovingFrameId(nextFrameId);
    if (frameFocusOwnedRef.current && !activeFrameIsVisible) {
      frameButtonRefs.current.get(nextFrameId)?.focus();
    }
  }, [highlightedFrameId, rovingFrameId, selectedFrameId, visibleFrameIds, visibleFrames]);

  useLayoutEffect(() => {
    if (highlightedFrameIndex >= 0) {
      scrollToFrameIndex(highlightedFrameIndex, "nearest");
    }
  }, [highlightedFrameIndex, scrollToFrameIndex]);

  if (state.kind !== "stopped") {
    return <div style={styles.message}>Not paused</div>;
  }

  const rovingFrame = state.frames.some(({ frameId }) => frameId === rovingFrameId)
    ? rovingFrameId
    : state.frames.some(({ frameId }) => frameId === highlightedFrameId)
      ? highlightedFrameId
      : (state.frames[0]?.frameId ?? null);

  if (state.frames.length === 0) {
    return (
      <div
        data-testid={state.framesTruncated ? "debug-stack-truncated" : undefined}
        role={state.framesTruncated ? "status" : undefined}
        style={styles.message}
      >
        {state.framesTruncated
          ? "Stack trace truncated; no inspectable frames were retained."
          : "No stack frames"}
      </div>
    );
  }

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, frameId: number) => {
    const currentIndex = state.frames.findIndex((frame) => frame.frameId === frameId);
    if (currentIndex < 0) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + 1, state.frames.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = state.frames.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextFrameId = state.frames[nextIndex]?.frameId;
    if (nextFrameId === undefined) return;
    setRovingFrameId(nextFrameId);
    scrollToFrameIndex(nextIndex, "nearest");
    const mountedFrame = frameButtonRefs.current.get(nextFrameId);
    if (mountedFrame) {
      mountedFrame.focus();
    } else {
      requestAnimationFrame(() => frameButtonRefs.current.get(nextFrameId)?.focus());
    }
  };

  return (
    <>
      {state.framesTruncated ? (
        <div data-testid="debug-stack-truncated" role="status" style={styles.message}>
          Stack trace truncated to the inspectable frame limit.
        </div>
      ) : null}
      <div
        aria-label="Call stack frames"
        onScroll={windowedFrames.onScroll}
        ref={windowedFrames.containerRef}
        role="list"
        style={styles.windowedList}
      >
        <div style={{ height: windowedFrames.totalHeight, position: "relative" }}>
          {windowedFrames.rows.map(({ index, offsetTop }) => {
            const frame = state.frames[index];
            if (!frame) return null;
            const selected = frame.frameId === highlightedFrameId;
            const showRestart =
              selected &&
              index === state.frames.findIndex(({ frameId }) => frameId === highlightedFrameId) &&
              debugAdapterKind === "node" &&
              !debugControlPending &&
              workspaceTrusted &&
              frameAllowsInlineActions(frame) &&
              canRestartFrame(debugRestartFrame);
            return (
              <div
                aria-posinset={index + 1}
                aria-setsize={state.frames.length}
                key={frame.frameId}
                ref={(element) => windowedFrames.measureRow(String(frame.frameId), element)}
                role="listitem"
                style={
                  selected
                    ? {
                        ...styles.windowedRow,
                        ...styles.breakpointRow,
                        ...styles.frameActive,
                        top: offsetTop,
                      }
                    : { ...styles.windowedRow, ...styles.breakpointRow, top: offsetTop }
                }
              >
                <button
                  aria-current={selected ? "true" : undefined}
                  data-testid="debug-frame"
                  onClick={() => activateFrame(frame, onSelectFrame, onNavigateToFrame)}
                  onBlur={(event) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof HTMLElement) || next.dataset.testid !== "debug-frame") {
                      frameFocusOwnedRef.current = false;
                    }
                  }}
                  onFocus={() => {
                    frameFocusOwnedRef.current = true;
                    setRovingFrameId(frame.frameId);
                  }}
                  onKeyDown={(event) => moveFocus(event, frame.frameId)}
                  ref={(element) => {
                    if (element) frameButtonRefs.current.set(frame.frameId, element);
                    else frameButtonRefs.current.delete(frame.frameId);
                  }}
                  style={{ ...styles.frame, padding: 0 }}
                  tabIndex={frame.frameId === rovingFrame ? 0 : -1}
                  type="button"
                >
                  {frame.name}{" "}
                  <span style={styles.muted}>
                    {frame.filePath
                      ? `${displayPath(rootPath, frame.filePath)}:${frame.lineNumber}`
                      : `line ${frame.lineNumber}`}
                  </span>
                </button>
                {showRestart ? (
                  <ToolbarButton
                    disabled={false}
                    label="Restart Frame"
                    onClick={() => {
                      if (canRestartFrame(debugRestartFrame)) debugRestartFrame?.restartFrame();
                    }}
                    title="Restart Frame"
                  >
                    <RotateCw aria-hidden="true" size={12} />
                  </ToolbarButton>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function canRestartFrame(command: DebugRestartFrameCommand | undefined): boolean {
  try {
    return command?.canRestartFrame() === true;
  } catch {
    return false;
  }
}

function frameAllowsInlineActions(frame: StackFrame): boolean {
  const presentationHint = (frame as StackFrame & { presentationHint?: unknown }).presentationHint;
  return presentationHint !== "label" && presentationHint !== "subtle";
}

function activateFrame(
  frame: StackFrame,
  onSelectFrame: (frameId: number) => void,
  onNavigateToFrame: (filePath: string, lineNumber: number) => void,
) {
  onSelectFrame(frame.frameId);

  if (frame.filePath === null) {
    return;
  }

  onNavigateToFrame(frame.filePath, frame.lineNumber);
}

function Variables({
  addToWatchSurface,
  copyValueSurface,
  inspectionOwner,
  latencyTracker,
  onLoadVariablePage,
  onLoadVariables,
  onRetryFrame,
  scopeLoadState,
  scopes,
  setVariableSurface,
  stopped,
  variablePages,
  variableMutationRows,
  variablesByReference,
}: {
  addToWatchSurface?: DebugAddToWatchVariableSurface;
  copyValueSurface?: DebugCopyValueSurface;
  inspectionOwner?: DebugInspectionOwner | null;
  latencyTracker?: LatencyTracker;
  onLoadVariablePage?(
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
    filter?: import("../domain/debug").DebugVariableFilter,
  ): void | Promise<void>;
  onLoadVariables(variablesReference: number): void;
  onRetryFrame(frameId: number): void;
  scopeLoadState: DebugScopeLoadState;
  scopes: DebugScope[];
  setVariableSurface?: DebugSetVariableSurface;
  stopped: boolean;
  variablePages?: DebugVariablePagesState;
  variableMutationRows?: DebugVariableMutationRows;
  variablesByReference: Record<number, DebugVariable[]>;
}) {
  if (!stopped || scopeLoadState.kind === "inactive") {
    return <div style={styles.message}>Not paused</div>;
  }

  if (scopeLoadState.kind === "unavailable") {
    return <div style={styles.message}>No stack frame available</div>;
  }

  if (scopeLoadState.kind === "loading") {
    return (
      <div aria-live="polite" role="status" style={styles.message}>
        Loading variables…
      </div>
    );
  }

  if (scopeLoadState.kind === "error") {
    return (
      <div role="alert" style={styles.message}>
        <div>{scopeLoadState.message}</div>
        <button
          aria-label="Retry"
          onClick={() => onRetryFrame(scopeLoadState.frameId)}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  if (scopes.length === 0) {
    return <div style={styles.message}>No variables in selected frame</div>;
  }

  const roots: DebugVariableTreeRoot[] = scopes.map((scope, index) => ({
    id: `${index}:${scope.variablesReference}`,
    label: scope.name,
    owner: inspectionOwner ?? null,
    variablesReference: scope.variablesReference,
    testId: "debug-scope",
  }));
  return (
    <DebugVariableTree
      addToWatchSurface={addToWatchSurface}
      ariaLabel="Variables"
      copyValueSurface={copyValueSurface}
      latencyTracker={latencyTracker}
      onLoadPage={onLoadVariablePage}
      onLoadVariables={onLoadVariables}
      roots={roots}
      setVariableSurface={setVariableSurface}
      variablePages={variablePages}
      variableMutationRows={variableMutationRows}
      variablesByReference={variablesByReference}
      virtualizeRows
    />
  );
}

function Breakpoints({
  breakpoints,
  onNavigateToBreakpoint,
  onRemoveBreakpoint,
  onSetBreakpointCondition,
  onSetBreakpointHitCondition,
  onSetBreakpointLogMessage,
  onSetBreakpointEnabled,
  supportsHitConditions,
  supportsLogpoints,
  rootPath,
}: {
  breakpoints: Breakpoint[];
  onNavigateToBreakpoint(breakpoint: Breakpoint): void;
  onRemoveBreakpoint(id: string): void;
  onSetBreakpointCondition(id: string, condition: string | null): void;
  onSetBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): void;
  onSetBreakpointLogMessage(id: string, logMessage: string | null): void;
  onSetBreakpointEnabled(id: string, enabled: boolean): void;
  supportsHitConditions: boolean;
  supportsLogpoints: boolean;
  rootPath: string | null;
}) {
  const groups = useMemo(
    () => groupBreakpointsByFile(breakpoints, rootPath),
    [breakpoints, rootPath],
  );
  const activeFilePaths = useMemo(() => groups.map(({ filePath }) => filePath), [groups]);
  const { collapsedFilePaths, toggle } = useBreakpointGroupCollapseState(rootPath, activeFilePaths);
  const rows = useMemo(
    () => createBreakpointGroupRows(groups, collapsedFilePaths),
    [collapsedFilePaths, groups],
  );
  const breakpointPositionById = useMemo(() => {
    const positions = new Map<string, number>();
    let position = 0;
    for (const row of rows) {
      if (row.kind === "group") {
        continue;
      }
      positions.set(row.breakpoint.id, position);
      position += 1;
    }
    return positions;
  }, [rows]);
  const rowFocus = useBreakpointRowFocus({
    collapsedFilePaths,
    rows,
    toggleGroupCollapse: toggle,
  });
  const estimateRowHeight = useCallback(
    (index: number) =>
      rows[index]?.kind === "group" ? BREAKPOINT_GROUP_ROW_HEIGHT : BREAKPOINT_ROW_HEIGHT,
    [rows],
  );
  const keyForRowIndex = useCallback((index: number) => rows[index]?.key ?? String(index), [rows]);
  const windowedRows = useWindowedRows({
    enabled: rows.length > DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
    estimateHeight: estimateRowHeight,
    fallbackViewportHeight: DEBUG_LIST_VIEWPORT_HEIGHT,
    itemCount: rows.length,
    keyForIndex: keyForRowIndex,
    pinnedIndices: rowFocus.pinnedRowIndices,
    preserveScrollAnchor: true,
  });

  if (breakpoints.length === 0) {
    return <div style={styles.message}>No breakpoints</div>;
  }

  return (
    <div
      aria-label="Source breakpoints"
      onBlurCapture={rowFocus.handleBlur}
      onFocusCapture={rowFocus.handleFocus}
      onScroll={windowedRows.onScroll}
      ref={windowedRows.containerRef}
      role="list"
      style={styles.windowedList}
    >
      <div style={{ height: windowedRows.totalHeight, position: "relative" }}>
        {windowedRows.rows.map(({ index, offsetTop }) => {
          const row = rows[index];
          if (!row) return null;
          if (row.kind === "group") {
            const collapsed = collapsedFilePaths.has(row.group.filePath);
            const breakpointNoun = row.group.count === 1 ? "breakpoint" : "breakpoints";
            const pathLabel =
              row.group.relativePath === null
                ? row.group.fileName
                : `${row.group.fileName}, ${row.group.relativePath}`;
            return (
              <div
                key={row.key}
                ref={(element) => windowedRows.measureRow(row.key, element)}
                role="listitem"
                style={{ ...styles.windowedRow, top: offsetTop }}
              >
                <button
                  aria-expanded={!collapsed}
                  aria-label={`${pathLabel}, ${row.group.count} ${breakpointNoun}`}
                  data-breakpoint-group=""
                  data-breakpoint-row-key={row.key}
                  onClick={() => rowFocus.toggleGroup(row.group.filePath)}
                  onKeyDown={(event) =>
                    rowFocus.handleNavigationKey(event, row, windowedRows.scrollToIndex)
                  }
                  ref={(element) => rowFocus.registerRowFocusElement(row.key, element)}
                  style={styles.breakpointGroupHeader}
                  tabIndex={row.key === rowFocus.effectiveRovingRowKey ? 0 : -1}
                  type="button"
                >
                  {collapsed ? (
                    <ChevronRight aria-hidden="true" size={12} />
                  ) : (
                    <ChevronDown aria-hidden="true" size={12} />
                  )}
                  <strong>{row.group.fileName}</strong>
                  {row.group.relativePath === null ? null : (
                    <span style={styles.muted}>— {row.group.relativePath}</span>
                  )}
                  <span style={styles.muted}>({row.group.count})</span>
                </button>
              </div>
            );
          }
          const breakpoint = row.breakpoint;
          return (
            <div
              aria-posinset={(breakpointPositionById.get(breakpoint.id) ?? 0) + 1}
              aria-setsize={breakpointPositionById.size}
              data-breakpoint-id={breakpoint.id}
              data-breakpoint-row-key={row.key}
              data-testid="debug-breakpoint"
              key={row.key}
              ref={(element) => windowedRows.measureRow(row.key, element)}
              role="listitem"
              style={{ ...styles.windowedRow, ...styles.breakpointRow, top: offsetTop }}
            >
              <input
                aria-label={`Enable breakpoint ${breakpointLocationLabel(breakpoint)}`}
                checked={breakpoint.enabled}
                onChange={(event) => onSetBreakpointEnabled(breakpoint.id, event.target.checked)}
                type="checkbox"
              />
              <button
                data-breakpoint-row-key={row.key}
                data-testid="debug-breakpoint-location"
                onClick={() => onNavigateToBreakpoint(breakpoint)}
                onKeyDown={(event) =>
                  rowFocus.handleNavigationKey(event, row, windowedRows.scrollToIndex)
                }
                ref={(element) => rowFocus.registerRowFocusElement(row.key, element)}
                style={styles.location}
                tabIndex={row.key === rowFocus.effectiveRovingRowKey ? 0 : -1}
                title={breakpointLocationLabel(breakpoint)}
                type="button"
              >
                {breakpointLocationLabel(breakpoint, rootPath)}
                {breakpoint.verified === false ? (
                  <span style={styles.muted}> (unverified)</span>
                ) : null}
              </button>
              <BreakpointConditionInput
                breakpoint={breakpoint}
                key={`condition:${breakpoint.id}:${breakpoint.condition ?? ""}`}
                onSetBreakpointCondition={onSetBreakpointCondition}
              />
              {supportsHitConditions &&
              rootPath &&
              isBreakpointPathSupported(rootPath, "node", breakpoint.filePath) ? (
                <BreakpointHitConditionInput
                  breakpoint={breakpoint}
                  key={`hit:${breakpoint.id}:${formatBreakpointHitCondition(breakpoint.hitCondition)}`}
                  onSetBreakpointHitCondition={onSetBreakpointHitCondition}
                />
              ) : null}
              {supportsLogpoints &&
              rootPath &&
              isBreakpointPathSupported(rootPath, "node", breakpoint.filePath) ? (
                <BreakpointLogMessageInput
                  breakpoint={breakpoint}
                  key={`log:${breakpoint.id}:${breakpoint.logMessage ?? ""}`}
                  onSetBreakpointLogMessage={onSetBreakpointLogMessage}
                />
              ) : null}
              <button
                aria-label="Remove breakpoint"
                onClick={() => onRemoveBreakpoint(breakpoint.id)}
                style={styles.action}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BreakpointLogMessageInput({
  breakpoint,
  onSetBreakpointLogMessage,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointLogMessage(id: string, logMessage: string | null): void;
}) {
  const [value, setValue] = useState(breakpoint.logMessage ?? "");
  const error = breakpointLogMessageError(value);
  const errorId = `${useId()}-logpoint-error`;

  const commit = () => {
    if (error) return;
    const logMessage = isBreakpointLogMessage(value) ? value : null;
    if (logMessage === (breakpoint.logMessage ?? null)) return;
    onSetBreakpointLogMessage(breakpoint.id, logMessage);
  };

  return (
    <>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-label={`Log message for ${breakpointLocationLabel(breakpoint)}`}
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder="Log Message"
        style={styles.conditionInput}
        title={error ?? "Use text and expressions in {braces}"}
        value={value}
      />
      {error ? (
        <span id={errorId} role="alert" style={styles.muted}>
          {error}
        </span>
      ) : null}
    </>
  );
}

function BreakpointHitConditionInput({
  breakpoint,
  onSetBreakpointHitCondition,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): void;
}) {
  const [value, setValue] = useState(formatBreakpointHitCondition(breakpoint.hitCondition));
  const error = breakpointHitConditionError(value);
  const errorId = `${useId()}-hit-count-error`;

  const commit = () => {
    if (error) return;
    const hitCondition = parseBreakpointHitCondition(value);
    if (
      formatBreakpointHitCondition(hitCondition) ===
      formatBreakpointHitCondition(breakpoint.hitCondition)
    )
      return;
    onSetBreakpointHitCondition(breakpoint.id, hitCondition);
  };

  return (
    <>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-label="Hit Count"
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder="Hit Count"
        style={styles.conditionInput}
        title={error ?? "Use N, >=N, or %N"}
        value={value}
      />
      {error ? (
        <span id={errorId} role="alert" style={styles.muted}>
          {error}
        </span>
      ) : null}
    </>
  );
}

function BreakpointConditionInput({
  breakpoint,
  onSetBreakpointCondition,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointCondition(id: string, condition: string | null): void;
}) {
  const [value, setValue] = useState(breakpoint.condition ?? "");

  const commit = () => {
    const trimmed = value.trim();
    const condition = trimmed === "" ? null : trimmed;

    if (condition === (breakpoint.condition ?? null)) {
      return;
    }

    onSetBreakpointCondition(breakpoint.id, condition);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    commit();
  };

  return (
    <input
      aria-label="Condition"
      onBlur={commit}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Condition"
      style={styles.conditionInput}
      value={value}
    />
  );
}
