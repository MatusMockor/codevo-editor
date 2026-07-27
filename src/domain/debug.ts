import type { BreakpointHitCondition } from "./debugBreakpointHitCondition";
import type { NodeDebugJustMyCodePolicy } from "./nodeDebugJustMyCode";
import type {
  DebugEvaluationContext,
  DebugEvaluationResult,
  DebugEvaluationSuccess,
} from "./debugEvaluationPolicy";
import type {
  DebugConsoleCompletionRequest,
  DebugConsoleCompletionResponse,
} from "./debugConsoleCompletions";
import type { DebugExceptionTypeFilter } from "./debugExceptionTypeFilter";
export type { BreakpointHitCondition } from "./debugBreakpointHitCondition";
export type { DebugExceptionTypeFilter } from "./debugExceptionTypeFilter";

export interface Breakpoint {
  id: string;
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  condition?: string | null;
  hitCondition?: BreakpointHitCondition | null;
  logMessage?: string | null;
  enabled: boolean;
  verified?: boolean;
}

export interface FunctionBreakpoint {
  readonly id: string;
  readonly functionName: string;
  readonly enabled: boolean;
  readonly verified?: boolean;
}

export interface FunctionBreakpointVerification {
  readonly id: string;
  readonly verified: boolean;
}

export interface DebugFunctionBreakpointInput {
  readonly id: string;
  readonly functionName: string;
  readonly enabled: boolean;
}

export interface DebugSetFunctionBreakpointsRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly generation: number;
  readonly breakpoints: readonly DebugFunctionBreakpointInput[];
}

export interface BreakpointCreationOwnership {
  readonly breakpointId: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber?: number;
  isCurrent(): boolean;
  rollback(): void | Promise<void>;
}

export interface StackFrame {
  frameId: number;
  name: string;
  filePath: string | null;
  lineNumber: number;
  column: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string | null;
  readonly evaluateName?: string;
  readonly canSetValue?: true;
  variablesReference: number;
}

export interface DebugSetVariableRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
  readonly variablesReference: number;
  readonly name: string;
  readonly value: string;
}

export interface DebugSetExpressionRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
  /** Opaque authority minted by the adapter for this exact paused evaluation. */
  readonly setExpressionReference: number;
  /** Comparison-only identity; the adapter must not execute this client string. */
  readonly expression: string;
  readonly value: string;
}

export interface DebugSetExpressionResult {
  readonly setExpressionReference: number;
  readonly expression: string;
  readonly value: DebugEvaluationSuccess;
}

export interface DebugVariablePageRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
  readonly variablesReference: number;
  readonly start: number;
  readonly count: number;
}

export interface DebugScopesRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
}

export interface DebugRestartFrameRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
}

export interface DebugDisconnectRequest {
  readonly rootPath: string;
  readonly sessionId: number;
}

/**
 * Requests a one-shot breakpoint at an editor position. Editor line and column
 * numbers are 1-based; the Rust adapter is responsible for converting them to
 * the debugger protocol's coordinate system.
 */
export interface DebugRunToLocationRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface DebugSetBreakpointsActiveRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly active: boolean;
}

export interface DebugVariablePage {
  readonly variables: DebugVariable[];
  readonly start: number;
  readonly returned: number;
  readonly total?: number;
  readonly nextStart?: number;
  readonly truncated: boolean;
}

export type DebugStopReason = "breakpoint" | "step" | "pause" | "entry" | "exception" | "restart";

export type StepKind = "continue" | "stepOver" | "stepInto" | "stepOut";

export type DebugExceptionPauseMode = "none" | "uncaught" | "all";

export interface DebugSetExceptionPauseRequest {
  readonly rootPath: string;
  readonly sessionId: number;
  readonly mode: DebugExceptionPauseMode;
  readonly exceptionTypeFilter: DebugExceptionTypeFilter;
}

export const MIN_NODE_DEBUG_PORT = 1;
export const MAX_NODE_DEBUG_PORT = 65_535;

export function isNodeDebugPort(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= MIN_NODE_DEBUG_PORT &&
    (value as number) <= MAX_NODE_DEBUG_PORT
  );
}

export type DebuggerState =
  | { kind: "inactive" }
  | { kind: "starting"; sessionId: number }
  | { kind: "running"; sessionId: number }
  | {
      kind: "stopped";
      sessionId: number;
      reason: DebugStopReason;
      frames: StackFrame[];
      topFrame: StackFrame | null;
    }
  | { kind: "terminated"; sessionId: number; exitCode: number | null };

export type DebugLaunchTarget =
  | { kind: "node-attach"; port: number; sourceMaps?: boolean }
  | { kind: "node-script"; scriptPath: string; sourceMaps?: boolean }
  | {
      kind: "js-test-file";
      runner: "vitest" | "jest";
      filePath: string;
      packageRootPath: string;
    }
  | {
      kind: "js-test-selection";
      runner: "vitest" | "jest";
      filePath: string;
      packageRootPath: string;
      selection:
        | { kind: "file" }
        | { kind: "suite"; fullName: string }
        | { kind: "test"; fullName: string; nameMatch: "exact" | "prefix" };
    }
  | {
      kind: "node-configured-script";
      scriptPath: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
      justMyCode?: NodeDebugJustMyCodePolicy;
      sourceMaps?: boolean;
    }
  | {
      kind: "js-configured-test";
      runner: "vitest" | "jest";
      filePath: string;
      packageRootPath: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
    }
  | {
      kind: "node-npm-script";
      script: string;
      packageRootPath: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
      justMyCode?: NodeDebugJustMyCodePolicy;
      sourceMaps?: boolean;
    }
  | { kind: "php-script"; scriptPath: string }
  | { kind: "php-test-file"; filePath: string }
  | { kind: "php-listen"; port?: number };

export type DebugCompoundLaunchTarget = Extract<
  DebugLaunchTarget,
  { kind: "node-script" | "node-configured-script" | "node-npm-script" }
>;

export interface DebugCompoundLaunchMember {
  readonly launch: DebugCompoundLaunchTarget;
  readonly breakpoints: readonly Breakpoint[];
  readonly exceptionPauseMode: DebugExceptionPauseMode;
  readonly exceptionTypeFilter: DebugExceptionTypeFilter;
}

export interface DebugCompoundStartRequest {
  readonly rootPath: string;
  readonly members: readonly DebugCompoundLaunchMember[];
  /** Compound members share one lifetime; terminating one stops every sibling. */
  readonly stopAll: true;
}

export type DebugCompoundRuntimeStatus =
  | { readonly kind: "ok"; readonly sessionIds: readonly number[] }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type DebugEventPayload =
  | { kind: "started"; sessionId: number }
  | {
      kind: "stopped";
      reason: DebugStopReason;
      frames: StackFrame[];
      pauseGeneration: number;
    }
  | { kind: "resumed" }
  | {
      readonly kind: "output";
      readonly stream: "stdout" | "stderr";
      readonly text: string;
      readonly truncated: boolean;
    }
  | { kind: "terminated"; exitCode: number | null }
  | {
      kind: "breakpointsVerified";
      filePath: string;
      breakpoints: Breakpoint[];
    }
  | {
      kind: "functionBreakpointsVerified";
      generation: number;
      breakpoints: readonly FunctionBreakpointVerification[];
    };

export interface DebugEvent {
  rootPath: string;
  sessionId: number;
  seq: number;
  payload: DebugEventPayload;
}

export type DebugRuntimeStatus =
  | { kind: "ok"; sessionId: number }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export interface DebugGateway {
  start(
    rootPath: string,
    launch: DebugLaunchTarget,
    breakpoints: readonly Breakpoint[],
    exceptionPauseMode?: DebugExceptionPauseMode,
    exceptionTypeFilter?: DebugExceptionTypeFilter,
    functionBreakpoints?: readonly DebugFunctionBreakpointInput[],
  ): Promise<DebugRuntimeStatus>;
  /** Private application foundation; orchestration intentionally remains opt-in. */
  startCompound?(request: DebugCompoundStartRequest): Promise<DebugCompoundRuntimeStatus>;
  stop(sessionId: number): Promise<void>;
  disconnect(request: DebugDisconnectRequest): Promise<void>;
  setBreakpoints(
    rootPath: string,
    sessionId: number,
    filePath: string,
    breakpoints: readonly Breakpoint[],
  ): Promise<Breakpoint[]>;
  setBreakpointsActive?(request: DebugSetBreakpointsActiveRequest): Promise<void>;
  setFunctionBreakpoints?(
    request: DebugSetFunctionBreakpointsRequest,
  ): Promise<readonly FunctionBreakpointVerification[]>;
  step(sessionId: number, kind: StepKind): Promise<void>;
  pause(sessionId: number): Promise<void>;
  restartFrame(request: DebugRestartFrameRequest): Promise<void>;
  runToLocation(request: DebugRunToLocationRequest): Promise<void>;
  setExceptionPause(
    rootPath: string,
    sessionId: number,
    mode: DebugExceptionPauseMode,
    exceptionTypeFilter?: DebugExceptionTypeFilter,
  ): Promise<void>;
  stackTrace(sessionId: number): Promise<StackFrame[]>;
  scopesAtPause(request: DebugScopesRequest): Promise<DebugScope[]>;
  variablesPage(request: DebugVariablePageRequest): Promise<DebugVariablePage>;
  setVariable(request: DebugSetVariableRequest): Promise<DebugVariable>;
  setExpression(request: DebugSetExpressionRequest): Promise<DebugSetExpressionResult>;
  completions?(request: DebugConsoleCompletionRequest): Promise<DebugConsoleCompletionResponse>;
  evaluate(
    rootPath: string,
    sessionId: number,
    frameId: number,
    expression: string,
    context: DebugEvaluationContext,
    allowSideEffects: boolean,
    pauseGeneration: number,
  ): Promise<DebugEvaluationResult | null>;
  subscribe(handler: (event: DebugEvent) => void): () => void;
}

export function debuggerSessionId(state: DebuggerState): number | null {
  if (state.kind === "inactive") {
    return null;
  }

  return state.sessionId;
}
