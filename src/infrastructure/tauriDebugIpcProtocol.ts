import type {
  Breakpoint,
  DebugCompoundStartRequest,
  DebugDisconnectRequest,
  DebugExceptionPauseMode,
  DebugLaunchTarget,
  DebugRestartFrameRequest,
  DebugRunToLocationRequest,
  DebugScope,
  DebugScopesRequest,
  DebugSetBreakpointsActiveRequest,
  DebugSetExceptionPauseRequest,
  DebugSetExpressionRequest,
  DebugSetExpressionResult,
  DebugSetFunctionBreakpointsRequest,
  DebugSetVariableRequest,
  DebugVariable,
  DebugVariablePage,
  DebugVariablePageRequest,
  FunctionBreakpointVerification,
  StackFrame,
  StepKind,
} from "../domain/debug";
import type {
  DebugEvaluationContext,
  DebugEvaluationErrorKind,
} from "../domain/debugEvaluationPolicy";
import type {
  DebugConsoleCompletionRequest,
  DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import type { NativeNodeWatchDebugStartRequest } from "../domain/nativeNodeWatchDebugGateway";

type NodeLaunchWithStopOnEntry<Launch> = Launch extends {
  readonly kind: "node-script" | "node-configured-script" | "node-npm-script";
}
  ? Launch & { readonly stopOnEntry?: boolean }
  : Launch extends { readonly kind: "node-attach" }
    ? Launch & { readonly stopOnEntry?: false }
    : Launch;

export type DebugLaunchTargetWire = NodeLaunchWithStopOnEntry<DebugLaunchTarget>;

type DebugCompoundLaunchMemberWire = Omit<
  DebugCompoundStartRequest["members"][number],
  "launch"
> & {
  readonly launch: Extract<
    DebugLaunchTargetWire,
    { readonly kind: "node-script" | "node-configured-script" | "node-npm-script" }
  >;
};

export type DebugCompoundStartRequestWire = Omit<DebugCompoundStartRequest, "members"> & {
  readonly members: readonly DebugCompoundLaunchMemberWire[];
};

export const DEBUG_IPC_COMMANDS = {
  completions: "debug_completions",
  disconnect: "debug_disconnect",
  evaluate: "debug_evaluate",
  pause: "debug_pause",
  restartFrame: "debug_restart_frame",
  runToLocation: "debug_run_to_location",
  scopes: "debug_scopes",
  setBreakpoints: "debug_set_breakpoints",
  setBreakpointsActive: "debug_set_breakpoints_active",
  setExceptionPause: "debug_set_exception_pause",
  setExpression: "debug_set_expression",
  setFunctionBreakpoints: "debug_set_function_breakpoints",
  setVariable: "debug_set_variable",
  stackTrace: "debug_stack_trace",
  start: "debug_start",
  startCompound: "debug_start_compound",
  startNativeNodeWatch: "debug_start_native_node_watch",
  confirmNativeNodeWatch: "debug_confirm_native_node_watch",
  step: "debug_step",
  stop: "debug_stop",
  variables: "debug_variables",
} as const;

export type DebugStartResponseWire =
  | { status: "ok"; sessionId: number }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export type DebugCompoundStartResponseWire =
  | { status: "ok"; sessionIds: number[] }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export type DebugEvaluationResultWire =
  | {
      readonly status: "ok";
      readonly value: {
        readonly name: string;
        readonly value: string;
        readonly type: string | null;
        readonly evaluateName?: string;
        readonly setExpressionReference?: number;
        readonly variablesReference: number;
      };
    }
  | {
      readonly status: "error";
      readonly kind: DebugEvaluationErrorKind;
      readonly message: string;
    };

interface DebugIpcContract {
  readonly debug_completions: {
    readonly args: { readonly request: DebugConsoleCompletionRequest };
    readonly result: DebugConsoleCompletionResponse;
  };
  readonly debug_disconnect: {
    readonly args: { readonly request: DebugDisconnectRequest };
    readonly result: void;
  };
  readonly debug_start: {
    readonly args: {
      readonly rootPath: string;
      readonly launch: DebugLaunchTargetWire;
      readonly breakpoints: Breakpoint[];
      readonly exceptionPauseMode: DebugExceptionPauseMode;
      readonly exceptionTypeFilter: readonly string[];
    };
    readonly result: DebugStartResponseWire;
  };
  readonly debug_start_compound: {
    readonly args: { readonly request: DebugCompoundStartRequestWire };
    readonly result: DebugCompoundStartResponseWire;
  };
  readonly debug_start_native_node_watch: {
    readonly args: { readonly request: NativeNodeWatchDebugStartRequest };
    readonly result: DebugStartResponseWire;
  };
  readonly debug_confirm_native_node_watch: {
    readonly args: { readonly rootPath: string; readonly sessionId: number };
    readonly result: void;
  };
  readonly debug_stop: {
    readonly args: { readonly sessionId: number };
    readonly result: void;
  };
  readonly debug_set_breakpoints: {
    readonly args: {
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly filePath: string;
        readonly breakpoints: Breakpoint[];
      };
    };
    readonly result: Breakpoint[];
  };
  readonly debug_set_breakpoints_active: {
    readonly args: { readonly request: DebugSetBreakpointsActiveRequest };
    readonly result: void;
  };
  readonly debug_set_function_breakpoints: {
    readonly args: { readonly request: DebugSetFunctionBreakpointsRequest };
    readonly result: readonly FunctionBreakpointVerification[];
  };
  readonly debug_set_exception_pause: {
    readonly args: { readonly request: DebugSetExceptionPauseRequest };
    readonly result: void;
  };
  readonly debug_step: {
    readonly args: { readonly sessionId: number; readonly kind: StepKind };
    readonly result: void;
  };
  readonly debug_pause: {
    readonly args: { readonly sessionId: number };
    readonly result: void;
  };
  readonly debug_restart_frame: {
    readonly args: { readonly request: DebugRestartFrameRequest };
    readonly result: void;
  };
  readonly debug_run_to_location: {
    readonly args: { readonly request: DebugRunToLocationRequest };
    readonly result: void;
  };
  readonly debug_stack_trace: {
    readonly args: { readonly sessionId: number };
    readonly result: StackFrame[];
  };
  readonly debug_scopes: {
    readonly args: { readonly request: DebugScopesRequest };
    readonly result: DebugScope[];
  };
  readonly debug_variables: {
    readonly args: { readonly request: DebugVariablePageRequest };
    readonly result: DebugVariablePage;
  };
  readonly debug_set_variable: {
    readonly args: { readonly request: DebugSetVariableRequest };
    readonly result: DebugVariable;
  };
  readonly debug_set_expression: {
    readonly args: { readonly request: DebugSetExpressionRequest };
    readonly result: DebugSetExpressionResult;
  };
  readonly debug_evaluate: {
    readonly args: {
      readonly request: {
        readonly rootPath: string;
        readonly sessionId: number;
        readonly frameId: number;
        readonly pauseGeneration: number;
        readonly expression: string;
        readonly context: DebugEvaluationContext;
        readonly allowSideEffects: boolean;
      };
    };
    readonly result: DebugEvaluationResultWire;
  };
}

export type DebugIpcCommand = keyof DebugIpcContract;
export type DebugIpcCommandArgs<Command extends DebugIpcCommand> =
  DebugIpcContract[Command]["args"];
export type DebugIpcCommandResult<Command extends DebugIpcCommand> =
  DebugIpcContract[Command]["result"];

export type InvokeDebugCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
