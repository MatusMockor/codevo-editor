import type {
  DebugScopeLoadState,
  DebugVariableMutationRows,
} from "../application/debugSessionContracts";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugConsoleFocusRequest } from "../application/useDebugConsoleSurfaceCommands";
import type { ActiveDebugAdapterKind } from "../application/useDebugSession";
import type {
  Breakpoint,
  BreakpointHitCondition,
  DebugExceptionPauseMode,
  DebugExceptionTypeFilter,
  DebugScope,
  DebugVariable,
  DebugVariableFilter,
  FunctionBreakpoint,
  StepKind,
} from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import type { LatencyTracker } from "../domain/latencyTracker";
import type { DebugAddToWatchVariableSurface } from "./debugAddToWatchSurface";
import type {
  DebugCopyDisplayedValueSurface,
  DebugCopyValueSurface,
} from "./debugCopyValueSurface";
import type { DebugSetVariableSurface } from "./debugSetVariableSurface";
import type {
  DebugConsoleCompletionItem,
  DebugConsoleCompletionModel,
  DebugConsoleCompletionReplacement,
  DebugConsoleCompletionRequest,
} from "./DebugConsolePanel";
import type { DebugWatchesPanelProps } from "./DebugWatchesPanel";
import type { NodeDebugLaunchSelectorProps } from "./NodeDebugLaunchSelector";
import type { NodeLaunchConfigurationPickerDiagnosticNotice } from "./NodeLaunchConfigurationPicker";
import type { NodeRunWithoutDebuggingPickerCommand } from "./NodeRunWithoutDebuggingPickerAction";
import { DebugConsoleHeader, DebugConsoleRegion } from "./debug/DebugConsoleRegion";
import { DebugSectionsRegion } from "./debug/DebugSectionsRegion";
import { DebugToolbarRegion } from "./debug/DebugToolbarRegion";

type NodeLaunchConfigurationsProps = Omit<
  NodeDebugLaunchSelectorProps,
  "mutationPending" | "sessionActive" | "workspaceTrusted"
> & {
  readonly diagnosticNotice?: NodeLaunchConfigurationPickerDiagnosticNotice;
  readonly onClosePicker?: () => void;
  readonly onStartNamed?: (name: string) => void;
  readonly pickerOpen?: boolean;
};

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
    filter?: DebugVariableFilter,
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

export function DebugPanel(props: DebugPanelProps) {
  return (
    <div aria-label="Debug" className="cv-debug" role="tabpanel">
      <div className="cv-debug__top">
        <DebugToolbarRegion {...props} />
        <DebugConsoleHeader {...props} onShowDebugViews={null} />
      </div>
      <DebugSectionsRegion {...props} />
      <DebugConsoleRegion {...props} />
    </div>
  );
}
