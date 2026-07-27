import type {
  Breakpoint,
  BreakpointCreationOwnership,
  BreakpointHitCondition,
  DebugExceptionPauseMode,
  DebugExceptionTypeFilter,
  DebugGateway,
  DebugLaunchTarget,
  DebugRuntimeStatus,
  DebugScope,
  DebugVariable,
  FunctionBreakpoint,
  StepKind,
} from "../domain/debug";
import type {
  DebugEvaluationResult,
  DebugEvaluationSuccess,
} from "../domain/debugEvaluationPolicy";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import type { BreakpointCounts } from "../domain/debugBreakpoints";
import type { DebugSetExpressionCandidate } from "./useDebugSetExpression";
import type {
  DebugConsoleCompletionQuery,
  DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";

export interface DebugRunToLocationCandidate {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
  /** Revalidates the editor-owned document/cursor capture at the IPC boundary. */
  isCurrent(): boolean;
}

export interface DebugInlineBreakpointCandidate {
  readonly columnNumber?: number;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
  isCurrent(): boolean;
}

export interface DebugBreakpointRelocationCandidate {
  readonly breakpointId: string;
  readonly columnNumber?: number;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
  isCurrent(): boolean;
}

export interface DebugRestartFrameCandidate {
  readonly frameId: number;
  readonly pauseGeneration: number;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceOwnerKey: string;
  isCurrent(): boolean;
}

export interface DebugOutputLine {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
  readonly truncated: boolean;
}

export type ActiveDebugAdapterKind = "node" | "php" | null;

export interface DebugPauseOwner {
  readonly pauseGeneration: number;
  readonly rootKey: string;
  readonly sessionId: number;
  readonly workspaceOwnerKey: string;
}

export interface DebugVariableRowMutation {
  readonly currentValue: string;
  commit(nextValue: string): Promise<DebugVariable | null>;
}

export interface DebugVariableMutationRows {
  forRow(
    owner: DebugInspectionOwner,
    parentVariablesReference: number,
    pageStart: number,
    index: number,
  ): DebugVariableRowMutation | null;
}

export interface DebugWatchExpressionMutationIdentity {
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly expression: string;
}

export interface DebugWatchExpressionMutation {
  readonly identity: DebugWatchExpressionMutationIdentity;
  readonly currentValue: string;
  setValue(nextValue: string): Promise<DebugEvaluationSuccess | null>;
}

export interface DebugWatchExpressionMutations {
  forWatch(
    definition: import("../domain/debugWatchExpressions").DebugWatchDefinition,
    evaluation: import("./useDebugWatchExpressions").DebugWatchEvaluation | undefined,
  ): DebugWatchExpressionMutation | null;
}

export interface UseDebugSessionOptions {
  gateway: DebugGateway;
  isWorkspaceCurrent?: (rootPath: string, workspaceId: string) => boolean;
  isWorkspaceTrusted?: () => boolean;
  nodeDebugAttachCandidateStart?: NodeDebugAttachCandidateStartPort;
  workspaceId?: string | null;
  workspaceRoot: string | null;
}

export interface NodeDebugAttachCandidateStartPort {
  start(request: {
    readonly rootPath: string;
    readonly candidateLeaseId: string;
    readonly breakpoints: readonly Breakpoint[];
    readonly exceptionPauseMode: DebugExceptionPauseMode;
    readonly exceptionTypeFilter: DebugExceptionTypeFilter;
  }): Promise<DebugRuntimeStatus>;
}

export interface UseDebugSessionResult {
  snapshot: DebuggerSessionSnapshot;
  breakpoints: Breakpoint[];
  functionBreakpoints: readonly FunctionBreakpoint[];
  breakpointCounts: BreakpointCounts;
  breakpointsActivated: boolean;
  breakpointBulkMutationPending: boolean;
  debugAdapterKind: ActiveDebugAdapterKind;
  debugRestartPending: boolean;
  debugControlPending: boolean;
  debugCompoundActive: boolean;
  debugCompoundStartPending: boolean;
  debugInspectionRevision: number;
  debugStopPending: boolean;
  debugSessionAttached: boolean;
  debugStartBlockedByOtherOwner: boolean;
  debugStartPending: boolean;
  evaluationHistory: string[];
  pauseGeneration: number;
  pauseOwner: DebugPauseOwner | null;
  exceptionPauseError: string | null;
  exceptionPauseMode: DebugExceptionPauseMode;
  exceptionPausePending: boolean;
  exceptionTypeFilter: DebugExceptionTypeFilter;
  output: DebugOutputLine[];
  lastStartError: string | null;
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  inspectionOwner: DebugInspectionOwner | null;
  variablePages: DebugVariablePagesState;
  variableMutationRows: DebugVariableMutationRows;
  setWatchExpression(
    candidate: DebugSetExpressionCandidate,
    value: string,
  ): Promise<DebugEvaluationSuccess | null>;
  canRestartDebug(): boolean;
  canToggleBreakpointsActivated(): boolean;
  canRestartFrame(): boolean;
  canRunToLocation(): boolean;
  isDebugStartBlocked(): boolean;
  restartDebug(): Promise<void>;
  restartFrame(candidate: DebugRestartFrameCandidate): Promise<boolean>;
  runToLocation(candidate: DebugRunToLocationCandidate): Promise<boolean>;
  startDebug(launch: DebugLaunchTarget): Promise<void>;
  startDebugAccepted(launch: DebugLaunchTarget): Promise<boolean>;
  startDebugSessionAccepted(launch: DebugLaunchTarget): Promise<number | null>;
  stopDebug(): Promise<void>;
  stopExactDebugSession(sessionId: number): Promise<boolean>;
  disconnectDebug(): Promise<void>;
  disconnectExactDebugSession(sessionId: number): Promise<boolean>;
  stepDebug(kind: StepKind): Promise<void>;
  pauseDebug(): Promise<void>;
  toggleBreakpointsActivated(): Promise<boolean>;
  setExceptionPauseMode(mode: DebugExceptionPauseMode): Promise<void>;
  setExceptionTypeFilter(filter: DebugExceptionTypeFilter): Promise<void>;
  toggleBreakpoint(
    filePath: string,
    lineNumber: number,
  ): Promise<BreakpointCreationOwnership | null>;
  addInlineBreakpoint(
    candidate: DebugInlineBreakpointCandidate,
  ): Promise<BreakpointCreationOwnership | null>;
  relocateBreakpoint(candidate: DebugBreakpointRelocationCandidate): Promise<boolean>;
  setBreakpointEnabled(id: string, enabled: boolean): Promise<void>;
  setBreakpointCondition(id: string, condition: string | null): Promise<void>;
  setBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): Promise<void>;
  setBreakpointLogMessage(id: string, logMessage: string | null): Promise<void>;
  removeBreakpoint(id: string): Promise<void>;
  enableAllBreakpoints(): Promise<void>;
  disableAllBreakpoints(): Promise<void>;
  removeAllBreakpoints(): Promise<void>;
  restoreBreakpoints(list: Breakpoint[]): Promise<void>;
  addFunctionBreakpoint(functionName: string): Promise<boolean>;
  removeFunctionBreakpoint(id: string): Promise<boolean>;
  setFunctionBreakpointEnabled(id: string, enabled: boolean): Promise<boolean>;
  selectFrame(frameId: number): Promise<void>;
  loadVariables(variablesReference: number): Promise<void>;
  loadVariablePage(
    owner: DebugInspectionOwner,
    variablesReference: number,
    start: number,
  ): Promise<void>;
  evaluate(expression: string): Promise<DebugVariable | null>;
  evaluateClipboard(expression: string): Promise<DebugEvaluationResult | null>;
  evaluateWatch(expression: string): Promise<DebugEvaluationResult | null>;
  completeDebugConsole(
    owner: DebugInspectionOwner,
    query: DebugConsoleCompletionQuery,
  ): Promise<DebugConsoleCompletionResponse | null>;
}
