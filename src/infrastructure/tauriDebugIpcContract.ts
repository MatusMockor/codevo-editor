import type {
  Breakpoint,
  DebugEvent,
  DebugEventPayload,
  DebugDisconnectRequest,
  DebugCompoundStartRequest,
  DebugExceptionPauseMode,
  DebugLaunchTarget,
  DebugRestartFrameRequest,
  DebugSetBreakpointsActiveRequest,
  DebugSetExpressionRequest,
  DebugSetExpressionResult,
  DebugSetFunctionBreakpointsRequest,
  DebugRunToLocationRequest,
  DebugScope,
  DebugSetVariableRequest,
  DebugScopesRequest,
  DebugVariable,
  DebugVariablePage,
  DebugVariablePageRequest,
  FunctionBreakpointVerification,
  StackFrame,
  StepKind,
} from "../domain/debug";
import {
  decodeFunctionBreakpointVerificationList,
  functionBreakpointVerificationsMatch,
  validateFunctionBreakpointCommandArgs,
} from "../domain/debugFunctionBreakpoints";
import { isNodeDebugPort } from "../domain/debug";
import {
  MAX_DEBUG_EVALUATION_ERROR_BYTES,
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  MAX_DEBUG_EVALUATION_TYPE_BYTES,
  MAX_DEBUG_EVALUATION_VALUE_BYTES,
  isDebugEvaluationPolicy,
  type DebugEvaluationContext,
  type DebugEvaluationErrorKind,
} from "../domain/debugEvaluationPolicy";
import {
  MAX_DEBUG_BREAKPOINT_CONDITION_BYTES,
  MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES,
  MAX_DEBUG_BREAKPOINT_ID_BYTES,
  MAX_DEBUG_BREAKPOINT_LINE,
  MAX_DEBUG_BREAKPOINTS_PER_FILE,
  MAX_DEBUG_BREAKPOINTS_PER_SESSION,
  utf8ByteLength,
} from "../domain/debugBreakpointPolicy";
import { isBreakpointLogMessage } from "../domain/debugBreakpointLogMessage";
import {
  MAX_JS_TEST_DEBUG_FULL_NAME_BYTES,
  MAX_JS_TEST_DEBUG_PATH_BYTES,
} from "../domain/jsTestDebugScope";
import { isWellFormedUnicode } from "../domain/unicodeText";
import {
  MAX_DEBUG_COMPLETION_ITEMS,
  MAX_DEBUG_COMPLETION_LABEL_BYTES,
  MAX_DEBUG_COMPLETION_PREFIX_BYTES,
  MAX_DEBUG_COMPLETION_QUERY_BYTES,
  MAX_DEBUG_COMPLETION_RECEIVER_SEGMENTS,
  MAX_DEBUG_COMPLETION_RESPONSE_BYTES,
  isDebugCompletionItemKind,
  type DebugConsoleCompletionQuery,
  type DebugConsoleCompletionRequest,
  type DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import type { NativeNodeWatchDebugStartRequest } from "../domain/nativeNodeWatchDebugGateway";

const DEBUG_IDENTIFIER_PATTERN = /^(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*$/u;

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

export const MAX_DEBUG_VARIABLE_NAME_BYTES = 1_024;
export const MAX_DEBUG_VARIABLE_EVALUATE_NAME_BYTES = MAX_DEBUG_EVALUATION_EXPRESSION_BYTES;
export const MAX_DEBUG_EVALUATION_MESSAGE_BYTES = MAX_DEBUG_EVALUATION_ERROR_BYTES;
export const MAX_DEBUG_VARIABLE_TYPE_BYTES = MAX_DEBUG_EVALUATION_TYPE_BYTES;
export const MAX_DEBUG_VARIABLE_VALUE_BYTES = MAX_DEBUG_EVALUATION_VALUE_BYTES;
export const MAX_DEBUG_VARIABLE_PAGE_BYTES = 1_024 * 1_024;
export const MAX_DEBUG_VARIABLE_PAGE_COUNT = 100;
export const MAX_DEBUG_VARIABLE_PAGE_START = 1_000_000;
export const MAX_DEBUG_SCOPES = 256;
export const MAX_DEBUG_VARIABLES = 10_000;
export const MAX_DEBUG_STACK_FRAMES = 1_000;
const MAX_DEBUG_ROOT_PATH_BYTES = 4_096;
export const MIN_DEBUG_COMPOUND_MEMBERS = 2;
export const MAX_DEBUG_COMPOUND_MEMBERS = 4;
export const MAX_DEBUG_COMPOUND_MESSAGE_BYTES = 512;
export const MAX_DEBUG_COMPOUND_REQUEST_BYTES = 1_048_576;
export const MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES = 4_096;
export const MAX_DEBUG_RUN_TO_LOCATION_LINE = 4_294_967_295;
export const MAX_DEBUG_RUN_TO_LOCATION_COLUMN = 4_294_967_295;

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
      readonly launch: DebugLaunchTarget;
      readonly breakpoints: Breakpoint[];
      readonly exceptionPauseMode: DebugExceptionPauseMode;
    };
    readonly result: DebugStartResponseWire;
  };
  readonly debug_start_compound: {
    readonly args: { readonly request: DebugCompoundStartRequest };
    readonly result: DebugCompoundStartResponseWire;
  };
  readonly debug_start_native_node_watch: {
    readonly args: NativeNodeWatchDebugStartRequest;
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
    readonly args: {
      readonly sessionId: number;
      readonly mode: DebugExceptionPauseMode;
    };
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

/** Validates both directions while keeping the raw Tauri transport in one place. */
export async function invokeDebugIpc<Command extends DebugIpcCommand>(
  invokeCommand: InvokeDebugCommand,
  command: Command,
  args: DebugIpcCommandArgs<Command>,
): Promise<DebugIpcCommandResult<Command>> {
  validateDebugIpcArgs(command, args);
  const value = await invokeCommand(command, args);
  const result = decodeDebugIpcResult(command, value);
  if (command === "debug_set_breakpoints") {
    const request = (args as DebugIpcCommandArgs<"debug_set_breakpoints">).request;
    for (const [index, breakpoint] of (result as Breakpoint[]).entries()) {
      if (breakpoint.filePath !== request.filePath)
        throw invalidDebugWire(`${command} result[${index}].filePath`, "the request filePath");
    }
  }
  if (command === "debug_set_function_breakpoints") {
    const request = (args as DebugIpcCommandArgs<"debug_set_function_breakpoints">).request;
    const verification = result as readonly FunctionBreakpointVerification[];
    if (!functionBreakpointVerificationsMatch(verification, request.breakpoints)) {
      throw invalidDebugWire(
        `${command} result`,
        "one ordered verification per requested function breakpoint",
      );
    }
  }
  if (command === "debug_variables") {
    validateVariablePageForRequest(
      result as DebugVariablePage,
      (args as DebugIpcCommandArgs<"debug_variables">).request,
    );
  }
  if (command === "debug_set_variable") {
    const request = (args as DebugIpcCommandArgs<"debug_set_variable">).request;
    if ((result as DebugVariable).name !== request.name)
      throw invalidDebugWire(`${command} result.name`, "the request name");
  }
  if (command === "debug_set_expression") {
    const request = (args as DebugIpcCommandArgs<"debug_set_expression">).request;
    const expressionResult = result as DebugSetExpressionResult;
    if (expressionResult.setExpressionReference !== request.setExpressionReference)
      throw invalidDebugWire(`${command} result.setExpressionReference`, "the request reference");
    if (expressionResult.expression !== request.expression)
      throw invalidDebugWire(`${command} result.expression`, "the request expression");
  }
  if (
    command === "debug_start_compound" &&
    (result as DebugCompoundStartResponseWire).status === "ok"
  ) {
    const request = (args as DebugIpcCommandArgs<"debug_start_compound">).request;
    if (
      (result as Extract<DebugCompoundStartResponseWire, { status: "ok" }>).sessionIds.length !==
      request.members.length
    ) {
      throw invalidDebugWire(`${command} result.sessionIds`, "one session id per request member");
    }
  }
  return result;
}

export function decodeDebugIpcResult<Command extends DebugIpcCommand>(
  command: Command,
  value: unknown,
): DebugIpcCommandResult<Command> {
  let decoded: unknown;
  switch (command) {
    case "debug_completions": {
      decoded = decodeCompletionResponse(value, `${command} result`);
      break;
    }
    case "debug_start": {
      decoded = decodeDebugStartResponse(value);
      break;
    }
    case "debug_start_native_node_watch": {
      decoded = decodeDebugStartResponse(value);
      break;
    }
    case "debug_start_compound": {
      decoded = decodeDebugCompoundStartResponse(value);
      break;
    }
    case "debug_disconnect":
    case "debug_confirm_native_node_watch":
    case "debug_stop":
    case "debug_step":
    case "debug_pause":
    case "debug_restart_frame":
    case "debug_run_to_location":
    case "debug_set_breakpoints_active":
      decoded = decodeVoidResult(command, value);
      break;
    case "debug_set_exception_pause":
      decoded = decodeNullResult(command, value);
      break;
    case "debug_set_breakpoints":
      decoded = decodeBreakpointArray(
        value,
        `${command} result`,
        decodeBreakpoint,
        MAX_DEBUG_BREAKPOINTS_PER_FILE,
      );
      break;
    case "debug_set_function_breakpoints":
      decoded = decodeFunctionBreakpointVerificationList(value);
      if (!decoded) throw invalidDebugWire(`${command} result`, "closed verifications");
      break;
    case "debug_stack_trace":
      decoded = decodeArray(value, `${command} result`, decodeStackFrame, MAX_DEBUG_STACK_FRAMES);
      break;
    case "debug_scopes":
      decoded = decodeArray(value, `${command} result`, decodeScope, MAX_DEBUG_SCOPES);
      break;
    case "debug_variables":
      decoded = decodeVariablePage(value, `${command} result`);
      break;
    case "debug_set_variable":
      decoded = decodeVariable(value, `${command} result`);
      break;
    case "debug_set_expression":
      decoded = decodeSetExpressionResult(value, `${command} result`);
      break;
    case "debug_evaluate":
      decoded = decodeEvaluationResult(value, `${command} result`);
      break;
  }
  return decoded as DebugIpcCommandResult<Command>;
}

function validateSessionOwnerRequest(
  request: Record<string, unknown>,
  command: DebugIpcCommand,
): void {
  requireExactKeys(request, ["rootPath", "sessionId"], `${command} args.request`);
  const rootPath = requireBoundedString(
    request.rootPath,
    `${command} args.request.rootPath`,
    MAX_DEBUG_ROOT_PATH_BYTES,
    false,
  );
  requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
  requirePositiveSafeInteger(request.sessionId, `${command} args.request.sessionId`);
}

function validateCompletionRequest(
  request: Record<string, unknown>,
  command: DebugIpcCommand,
): void {
  const path = `${command} args.request`;
  requireExactKeys(request, ["rootPath", "sessionId", "pauseGeneration", "frameId", "query"], path);
  const rootPath = requireBoundedString(
    request.rootPath,
    `${path}.rootPath`,
    MAX_DEBUG_ROOT_PATH_BYTES,
    false,
  );
  requireNoControlCharacters(rootPath, `${path}.rootPath`, false);
  requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
  requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
  requirePositiveSafeInteger(request.frameId, `${path}.frameId`);
  decodeCompletionQuery(request.query, `${path}.query`);
}

function decodeCompletionQuery(value: unknown, path: string): DebugConsoleCompletionQuery {
  if (encodedJsonBytes(value, path) > MAX_DEBUG_COMPLETION_QUERY_BYTES)
    throw invalidDebugWire(path, `at most ${MAX_DEBUG_COMPLETION_QUERY_BYTES} UTF-8 bytes`);
  const query = requireRecord(value, path);
  if (query.kind === "lexical") {
    requireExactKeys(query, ["kind", "prefix"], path);
    const prefix = requireCompletionPrefix(query.prefix, `${path}.prefix`);
    return Object.freeze({ kind: "lexical", prefix });
  }
  if (query.kind !== "member") throw invalidDebugWire(`${path}.kind`, "lexical or member");

  requireExactKeys(query, ["kind", "root", "path", "prefix"], path);
  const rootRecord = requireRecord(query.root, `${path}.root`);
  const root =
    rootRecord.kind === "this"
      ? (() => {
          requireExactKeys(rootRecord, ["kind"], `${path}.root`);
          return Object.freeze({ kind: "this" as const });
        })()
      : (() => {
          if (rootRecord.kind !== "binding")
            throw invalidDebugWire(`${path}.root.kind`, "binding or this");
          requireExactKeys(rootRecord, ["kind", "name"], `${path}.root`);
          const name = requireCompletionIdentifier(rootRecord.name, `${path}.root.name`, false);
          return Object.freeze({ kind: "binding" as const, name });
        })();
  const staticPath = decodeArray(
    query.path,
    `${path}.path`,
    (segment, segmentPath) => {
      const text = requireCompletionText(segment, segmentPath, MAX_DEBUG_COMPLETION_QUERY_BYTES);
      if ([...text].some((value) => /\p{Cc}/u.test(value)))
        throw invalidDebugWire(segmentPath, "control-free text");
      return text;
    },
    MAX_DEBUG_COMPLETION_RECEIVER_SEGMENTS,
  );
  const prefix = requireCompletionPrefix(query.prefix, `${path}.prefix`);
  return Object.freeze({
    kind: "member",
    root,
    path: Object.freeze(staticPath),
    prefix,
  });
}

function requireCompletionPrefix(value: unknown, path: string): string {
  return requireCompletionIdentifier(value, path, true);
}

function requireCompletionIdentifier(value: unknown, path: string, allowEmpty: boolean): string {
  const text = requireCompletionText(value, path, MAX_DEBUG_COMPLETION_PREFIX_BYTES);
  if (
    (!allowEmpty && text.length === 0) ||
    (text.length > 0 && !DEBUG_IDENTIFIER_PATTERN.test(text))
  ) {
    throw invalidDebugWire(path, allowEmpty ? "an identifier prefix" : "an identifier");
  }
  return text;
}

function requireCompletionText(value: unknown, path: string, maximumBytes: number): string {
  const text = requireString(value, path);
  if (!isWellFormedUnicode(text)) throw invalidDebugWire(path, "valid Unicode text");
  if (utf8ByteLength(text) > maximumBytes)
    throw invalidDebugWire(path, `at most ${maximumBytes} UTF-8 bytes`);
  return text;
}

function decodeCompletionResponse(value: unknown, path: string): DebugConsoleCompletionResponse {
  if (encodedJsonBytes(value, path) > MAX_DEBUG_COMPLETION_RESPONSE_BYTES)
    throw invalidDebugWire(path, `at most ${MAX_DEBUG_COMPLETION_RESPONSE_BYTES} UTF-8 bytes`);
  const response = requireRecord(value, path);
  requireExactKeys(response, ["items", "isIncomplete"], path);
  const items = decodeArray(
    response.items,
    `${path}.items`,
    (item, itemPath) => {
      const record = requireRecord(item, itemPath);
      requireExactKeys(record, ["label", "kind"], itemPath);
      const label = requireCompletionText(
        record.label,
        `${itemPath}.label`,
        MAX_DEBUG_COMPLETION_LABEL_BYTES,
      );
      if (!DEBUG_IDENTIFIER_PATTERN.test(label)) {
        throw invalidDebugWire(`${itemPath}.label`, "a JavaScript identifier");
      }
      if (!isDebugCompletionItemKind(record.kind)) {
        throw invalidDebugWire(`${itemPath}.kind`, "variable or property");
      }
      return Object.freeze({ label, kind: record.kind });
    },
    MAX_DEBUG_COMPLETION_ITEMS,
  );
  return Object.freeze({
    items: Object.freeze(items),
    isIncomplete: requireBoolean(response.isIncomplete, `${path}.isIncomplete`),
  });
}

function encodedJsonBytes(value: unknown, path: string): number {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON");
    return utf8ByteLength(encoded);
  } catch {
    throw invalidDebugWire(path, "JSON-serializable data");
  }
}

export function decodeDebugStartResponse(value: unknown): DebugStartResponseWire {
  const record = requireRecord(value, "debug_start result");
  if (record.status === "ok") {
    requireExactKeys(record, ["status", "sessionId"], "debug_start result");
    return {
      status: "ok",
      sessionId: requirePositiveSafeInteger(record.sessionId, "debug_start result.sessionId"),
    };
  }
  if (record.status === "unavailable" || record.status === "error") {
    requireExactKeys(record, ["status", "message"], "debug_start result");
    return {
      status: record.status,
      message: requireString(record.message, `debug_start result.${record.status}.message`),
    };
  }
  throw invalidDebugWire("debug_start result.status", "a known status tag");
}

export function decodeDebugCompoundStartResponse(value: unknown): DebugCompoundStartResponseWire {
  const path = "debug_start_compound result";
  const record = requireRecord(value, path);
  if (record.status === "ok") {
    requireExactKeys(record, ["status", "sessionIds"], path);
    const sessionIds = decodeArray(
      record.sessionIds,
      `${path}.sessionIds`,
      (sessionId, itemPath) => requirePositiveSafeInteger(sessionId, itemPath),
      MAX_DEBUG_COMPOUND_MEMBERS,
    );
    if (
      sessionIds.length < MIN_DEBUG_COMPOUND_MEMBERS ||
      new Set(sessionIds).size !== sessionIds.length
    ) {
      throw invalidDebugWire(`${path}.sessionIds`, "2 to 4 unique session ids");
    }
    return { status: "ok", sessionIds };
  }
  if (record.status === "unavailable" || record.status === "error") {
    requireExactKeys(record, ["status", "message"], path);
    const message = requireBoundedString(
      record.message,
      `${path}.message`,
      MAX_DEBUG_COMPOUND_MESSAGE_BYTES,
      false,
    );
    requireNoControlCharacters(message, `${path}.message`, false);
    return { status: record.status, message };
  }
  throw invalidDebugWire(`${path}.status`, "a known status tag");
}

export function decodeDebugEvent(value: unknown): DebugEvent {
  const record = requireRecord(value, "debug event");
  requireExactKeys(record, ["rootPath", "sessionId", "seq", "payload"], "debug event");
  return {
    rootPath: requireString(record.rootPath, "debug event.rootPath"),
    sessionId: requirePositiveSafeInteger(record.sessionId, "debug event.sessionId"),
    seq: requireUnsignedInteger(record.seq, "debug event.seq", U64_MAX),
    payload: decodeDebugEventPayload(record.payload),
  };
}

function validateDebugIpcArgs(command: DebugIpcCommand, value: unknown): void {
  const args = requireRecord(value, `${command} args`);
  switch (command) {
    case "debug_completions": {
      requireExactKeys(args, ["request"], `${command} args`);
      validateCompletionRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    }
    case "debug_start": {
      requireExactKeys(
        args,
        ["rootPath", "launch", "breakpoints", "exceptionPauseMode"],
        `${command} args`,
      );
      requireString(args.rootPath, `${command} args.rootPath`);
      decodeLaunchTarget(args.launch, `${command} args.launch`);
      const startupBreakpoints = decodeBreakpointArray(
        args.breakpoints,
        `${command} args.breakpoints`,
        decodeBreakpointInput,
        MAX_DEBUG_BREAKPOINTS_PER_SESSION,
      );
      requireBreakpointFileCaps(startupBreakpoints, `${command} args.breakpoints`);
      requireExceptionPauseMode(args.exceptionPauseMode, `${command} args.exceptionPauseMode`);
      return;
    }
    case "debug_start_native_node_watch": {
      requireObjectShape(
        args,
        ["rootPath", "scriptPath", "watch", "breakpoints", "exceptionPauseMode"],
        ["preserveOutput", "justMyCode"],
        `${command} args`,
      );
      const rootPath = requireBoundedString(
        args.rootPath,
        `${command} args.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${command} args.rootPath`, false);
      const scriptPath = requireBoundedString(
        args.scriptPath,
        `${command} args.scriptPath`,
        MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(scriptPath, `${command} args.scriptPath`, false);
      if (args.watch !== true) {
        throw invalidDebugWire(`${command} args.watch`, "true");
      }
      if (args.preserveOutput !== undefined && args.preserveOutput !== true) {
        throw invalidDebugWire(`${command} args.preserveOutput`, "true when present");
      }
      const startupBreakpoints = decodeBreakpointArray(
        args.breakpoints,
        `${command} args.breakpoints`,
        decodeBreakpointInput,
        MAX_DEBUG_BREAKPOINTS_PER_SESSION,
      );
      requireBreakpointFileCaps(startupBreakpoints, `${command} args.breakpoints`);
      requireExceptionPauseMode(args.exceptionPauseMode, `${command} args.exceptionPauseMode`);
      decodeNodeDebugJustMyCode(args.justMyCode, `${command} args.justMyCode`);
      return;
    }
    case "debug_confirm_native_node_watch": {
      requireExactKeys(args, ["rootPath", "sessionId"], `${command} args`);
      const rootPath = requireBoundedString(
        args.rootPath,
        `${command} args.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${command} args.rootPath`, false);
      requireUnsignedInteger(args.sessionId, `${command} args.sessionId`, U64_MAX);
      return;
    }
    case "debug_start_compound": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      if (encodedJsonBytes(request, `${command} args.request`) > MAX_DEBUG_COMPOUND_REQUEST_BYTES) {
        throw invalidDebugWire(
          `${command} args.request`,
          `at most ${MAX_DEBUG_COMPOUND_REQUEST_BYTES} UTF-8 bytes`,
        );
      }
      requireExactKeys(request, ["rootPath", "members", "stopAll"], `${command} args.request`);
      const rootPath = requireBoundedString(
        request.rootPath,
        `${command} args.request.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
      if (request.stopAll !== true) {
        throw invalidDebugWire(`${command} args.request.stopAll`, "true");
      }
      const members = decodeArray(
        request.members,
        `${command} args.request.members`,
        (member, memberPath) => {
          const record = requireRecord(member, memberPath);
          requireExactKeys(record, ["launch", "breakpoints", "exceptionPauseMode"], memberPath);
          const launch = decodeLaunchTarget(record.launch, `${memberPath}.launch`);
          if (
            launch.kind !== "node-script" &&
            launch.kind !== "node-configured-script" &&
            launch.kind !== "node-npm-script"
          ) {
            throw invalidDebugWire(
              `${memberPath}.launch.kind`,
              "node-script, node-configured-script, or node-npm-script",
            );
          }
          const breakpoints = decodeBreakpointArray(
            record.breakpoints,
            `${memberPath}.breakpoints`,
            decodeBreakpointInput,
            MAX_DEBUG_BREAKPOINTS_PER_SESSION,
          );
          requireBreakpointFileCaps(breakpoints, `${memberPath}.breakpoints`);
          requireExceptionPauseMode(record.exceptionPauseMode, `${memberPath}.exceptionPauseMode`);
          return member;
        },
        MAX_DEBUG_COMPOUND_MEMBERS,
      );
      if (members.length < MIN_DEBUG_COMPOUND_MEMBERS) {
        throw invalidDebugWire(
          `${command} args.request.members`,
          `${MIN_DEBUG_COMPOUND_MEMBERS} to ${MAX_DEBUG_COMPOUND_MEMBERS} members`,
        );
      }
      return;
    }
    case "debug_disconnect":
      requireExactKeys(args, ["request"], `${command} args`);
      validateSessionOwnerRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    case "debug_run_to_location":
      requireExactKeys(args, ["request"], `${command} args`);
      validateRunToLocationRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    case "debug_restart_frame":
      requireExactKeys(args, ["request"], `${command} args`);
      validateScopesRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    case "debug_set_breakpoints": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      requireExactKeys(
        request,
        ["rootPath", "sessionId", "filePath", "breakpoints"],
        `${command} args.request`,
      );
      requireNonEmptyString(request.rootPath, `${command} args.request.rootPath`);
      requireUnsignedInteger(request.sessionId, `${command} args.request.sessionId`, U64_MAX);
      const filePath = requireBreakpointFilePath(
        request.filePath,
        `${command} args.request.filePath`,
      );
      const breakpoints = decodeBreakpointArray(
        request.breakpoints,
        `${command} args.request.breakpoints`,
        decodeBreakpointInput,
        MAX_DEBUG_BREAKPOINTS_PER_FILE,
      );
      requireUniqueBreakpointIds(breakpoints, `${command} args.request.breakpoints`);
      for (const [index, breakpoint] of breakpoints.entries()) {
        if (breakpoint.filePath !== filePath) {
          throw invalidDebugWire(
            `${command} args.request.breakpoints[${index}].filePath`,
            "the request filePath",
          );
        }
      }
      return;
    }
    case "debug_set_breakpoints_active": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      requireExactKeys(request, ["rootPath", "sessionId", "active"], `${command} args.request`);
      const rootPath = requireBoundedString(
        request.rootPath,
        `${command} args.request.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
      requirePositiveSafeInteger(request.sessionId, `${command} args.request.sessionId`);
      requireBoolean(request.active, `${command} args.request.active`);
      return;
    }
    case "debug_set_function_breakpoints": {
      const error = validateFunctionBreakpointCommandArgs(args);
      if (error) throw invalidDebugWire(`${command} args.${error.path}`, error.expected);
      return;
    }
    case "debug_step":
      requireUnsignedInteger(args.sessionId, `${command} args.sessionId`, U64_MAX);
      if (!STEP_KINDS.has(args.kind)) {
        throw invalidDebugWire(`${command} args.kind`, "a known step kind");
      }
      return;
    case "debug_set_exception_pause":
      requireExactKeys(args, ["sessionId", "mode"], `${command} args`);
      requireUnsignedInteger(args.sessionId, `${command} args.sessionId`, U64_MAX);
      requireExceptionPauseMode(args.mode, `${command} args.mode`);
      return;
    case "debug_scopes":
      requireExactKeys(args, ["request"], `${command} args`);
      validateScopesRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    case "debug_variables":
      requireExactKeys(args, ["request"], `${command} args`);
      validateVariablesRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    case "debug_set_variable": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      const path = `${command} args.request`;
      requireExactKeys(
        request,
        [
          "rootPath",
          "sessionId",
          "pauseGeneration",
          "frameId",
          "variablesReference",
          "name",
          "value",
        ],
        path,
      );
      const rootPath = requireBoundedString(
        request.rootPath,
        `${path}.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${path}.rootPath`, false);
      requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
      requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
      requirePositiveSafeInteger(request.frameId, `${path}.frameId`);
      requirePositiveSafeInteger(request.variablesReference, `${path}.variablesReference`);
      const name = requireBoundedString(
        request.name,
        `${path}.name`,
        MAX_DEBUG_VARIABLE_NAME_BYTES,
        false,
      );
      requireNoControlCharacters(name, `${path}.name`, false);
      const nextValue = requireBoundedString(
        request.value,
        `${path}.value`,
        MAX_DEBUG_VARIABLE_VALUE_BYTES,
        true,
      );
      requireNoControlCharacters(nextValue, `${path}.value`, true);
      return;
    }
    case "debug_set_expression": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      const path = `${command} args.request`;
      requireExactKeys(
        request,
        [
          "rootPath",
          "sessionId",
          "pauseGeneration",
          "frameId",
          "setExpressionReference",
          "expression",
          "value",
        ],
        path,
      );
      const rootPath = requireBoundedString(
        request.rootPath,
        `${path}.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${path}.rootPath`, false);
      requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
      requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
      requirePositiveSafeInteger(request.frameId, `${path}.frameId`);
      requirePositiveSafeInteger(request.setExpressionReference, `${path}.setExpressionReference`);
      const expression = requireBoundedString(
        request.expression,
        `${path}.expression`,
        MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
        false,
      );
      requireNoControlCharacters(expression, `${path}.expression`, true);
      const nextValue = requireBoundedString(
        request.value,
        `${path}.value`,
        MAX_DEBUG_VARIABLE_VALUE_BYTES,
        true,
      );
      requireNoControlCharacters(nextValue, `${path}.value`, true);
      return;
    }
    case "debug_evaluate":
      requireExactKeys(args, ["request"], `${command} args`);
      {
        const request = requireRecord(args.request, `${command} args.request`);
        requireExactKeys(
          request,
          [
            "rootPath",
            "sessionId",
            "frameId",
            "pauseGeneration",
            "expression",
            "context",
            "allowSideEffects",
          ],
          `${command} args.request`,
        );
        const rootPath = requireBoundedString(
          request.rootPath,
          `${command} args.request.rootPath`,
          MAX_DEBUG_ROOT_PATH_BYTES,
          false,
        );
        requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
        requirePositiveSafeInteger(request.sessionId, `${command} args.request.sessionId`);
        requirePositiveSafeInteger(request.frameId, `${command} args.request.frameId`);
        requirePositiveSafeInteger(
          request.pauseGeneration,
          `${command} args.request.pauseGeneration`,
        );
        const expression = requireBoundedString(
          request.expression,
          `${command} args.request.expression`,
          MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
          false,
        );
        requireNoControlCharacters(expression, `${command} args.request.expression`, true);
        if (
          request.context !== "clipboard" &&
          request.context !== "repl" &&
          request.context !== "watch"
        ) {
          throw invalidDebugWire(`${command} args.request.context`, "clipboard, repl, or watch");
        }
        requireBoolean(request.allowSideEffects, `${command} args.request.allowSideEffects`);
        if (
          !isDebugEvaluationPolicy({
            context: request.context,
            allowSideEffects: request.allowSideEffects,
          })
        ) {
          throw invalidDebugWire(
            `${command} args.request.allowSideEffects`,
            request.context === "watch"
              ? "false for an automatic watch evaluation"
              : `true for an explicit ${request.context} evaluation`,
          );
        }
        return;
      }
    case "debug_stop":
    case "debug_pause":
    case "debug_stack_trace":
      requireUnsignedInteger(args.sessionId, `${command} args.sessionId`, U64_MAX);
  }
}

function decodeLaunchTarget(value: unknown, path: string): DebugLaunchTarget {
  const record = requireRecord(value, path);
  switch (record.kind) {
    case "node-attach":
      requireObjectShape(record, ["kind", "port"], [], path);
      if (!isNodeDebugPort(record.port)) {
        throw invalidDebugWire(`${path}.port`, "an integer between 1 and 65535");
      }
      break;
    case "node-script":
      requireObjectShape(record, ["kind", "scriptPath"], [], path);
      requireString(record.scriptPath, `${path}.scriptPath`);
      break;
    case "php-script":
      requireObjectShape(record, ["kind", "scriptPath"], [], path);
      requireString(record.scriptPath, `${path}.scriptPath`);
      break;
    case "js-test-file":
      requireObjectShape(record, ["kind", "runner", "filePath", "packageRootPath"], [], path);
      if (record.runner !== "vitest" && record.runner !== "jest") {
        throw invalidDebugWire(`${path}.runner`, "vitest or jest");
      }
      requireString(record.filePath, `${path}.filePath`);
      requireString(record.packageRootPath, `${path}.packageRootPath`);
      break;
    case "js-test-selection":
      requireObjectShape(
        record,
        ["kind", "runner", "filePath", "packageRootPath", "selection"],
        [],
        path,
      );
      requireJsTestRunner(record.runner, `${path}.runner`);
      requireJsTestDebugText(record.filePath, `${path}.filePath`, MAX_JS_TEST_DEBUG_PATH_BYTES);
      requireJsTestDebugText(
        record.packageRootPath,
        `${path}.packageRootPath`,
        MAX_JS_TEST_DEBUG_PATH_BYTES,
      );
      decodeJsTestDebugSelection(record.selection, `${path}.selection`);
      break;
    case "node-configured-script":
      requireObjectShape(
        record,
        ["kind", "scriptPath", "args", "env"],
        ["cwd", "envFile", "justMyCode", "runtime"],
        path,
      );
      requireString(record.scriptPath, `${path}.scriptPath`);
      decodeNodeLaunchOptions(record, path);
      if (record.envFile !== undefined) requireString(record.envFile, `${path}.envFile`);
      decodeOptionalEnum(record.runtime, `${path}.runtime`, ["tsx", "ts-node"], "tsx or ts-node");
      decodeNodeDebugJustMyCode(record.justMyCode, `${path}.justMyCode`);
      break;
    case "js-configured-test":
      requireObjectShape(
        record,
        ["kind", "runner", "filePath", "packageRootPath", "args", "env"],
        ["cwd"],
        path,
      );
      if (record.runner !== "vitest" && record.runner !== "jest")
        throw invalidDebugWire(`${path}.runner`, "vitest or jest");
      requireString(record.filePath, `${path}.filePath`);
      requireString(record.packageRootPath, `${path}.packageRootPath`);
      decodeNodeLaunchOptions(record, path);
      break;
    case "node-npm-script":
      requireObjectShape(
        record,
        ["kind", "script", "packageRootPath", "args", "env"],
        ["cwd", "justMyCode"],
        path,
      );
      requireString(record.script, `${path}.script`);
      requireString(record.packageRootPath, `${path}.packageRootPath`);
      decodeNodeLaunchOptions(record, path);
      decodeNodeDebugJustMyCode(record.justMyCode, `${path}.justMyCode`);
      break;
    case "php-test-file":
      requireObjectShape(record, ["kind", "filePath"], [], path);
      requireString(record.filePath, `${path}.filePath`);
      break;
    case "php-listen":
      requireObjectShape(record, ["kind"], ["port"], path);
      if (record.port !== undefined) requireUnsignedInteger(record.port, `${path}.port`, U16_MAX);
      break;
    default:
      throw invalidDebugWire(`${path}.kind`, "a known launch target");
  }
  return value as DebugLaunchTarget;
}

function decodeJsTestDebugSelection(value: unknown, path: string): void {
  const selection = requireRecord(value, path);
  if (selection.kind === "file") {
    requireExactKeys(selection, ["kind"], path);
    return;
  }
  if (selection.kind === "suite") {
    requireExactKeys(selection, ["kind", "fullName"], path);
    requireJsTestDebugText(
      selection.fullName,
      `${path}.fullName`,
      MAX_JS_TEST_DEBUG_FULL_NAME_BYTES,
    );
    return;
  }
  if (selection.kind === "test") {
    requireExactKeys(selection, ["kind", "fullName", "nameMatch"], path);
    requireJsTestDebugText(
      selection.fullName,
      `${path}.fullName`,
      MAX_JS_TEST_DEBUG_FULL_NAME_BYTES,
    );
    if (selection.nameMatch !== "exact" && selection.nameMatch !== "prefix") {
      throw invalidDebugWire(`${path}.nameMatch`, "exact or prefix");
    }
    return;
  }
  throw invalidDebugWire(`${path}.kind`, "file, suite, or test");
}

function requireJsTestRunner(value: unknown, path: string): void {
  if (value !== "vitest" && value !== "jest") {
    throw invalidDebugWire(path, "vitest or jest");
  }
}

function requireJsTestDebugText(value: unknown, path: string, maximumBytes: number): string {
  const text = requireNonEmptyString(value, path);
  if (!isWellFormedUnicode(text)) {
    throw invalidDebugWire(path, "valid Unicode text");
  }
  if (utf8ByteLength(text) > maximumBytes) {
    throw invalidDebugWire(path, `at most ${maximumBytes} UTF-8 bytes`);
  }
  requireNoControlCharacters(text, path, false);
  return text;
}

function decodeNodeLaunchOptions(record: Record<string, unknown>, path: string): void {
  decodeArray(record.args, `${path}.args`, requireString);
  if (record.cwd !== undefined) requireString(record.cwd, `${path}.cwd`);
  const environment = requireRecord(record.env, `${path}.env`);
  for (const [key, value] of Object.entries(environment)) {
    requireString(value, `${path}.env.${key}`);
  }
}

function decodeNodeDebugJustMyCode(value: unknown, path: string): void {
  decodeOptionalEnum(
    value,
    path,
    ["dependencies", "nodeInternals", "nodeInternalsAndDependencies"],
    "dependencies, nodeInternals, or nodeInternalsAndDependencies",
  );
}

function decodeOptionalEnum(
  value: unknown,
  path: string,
  allowed: readonly unknown[],
  expected: string,
): void {
  if (value !== undefined && !allowed.includes(value)) throw invalidDebugWire(path, expected);
}

function decodeBreakpointInput(value: unknown, path: string): Breakpoint {
  return decodeBreakpointFields(value, path, false);
}

function decodeBreakpoint(value: unknown, path: string): Breakpoint {
  return decodeBreakpointFields(value, path, true);
}

function decodeBreakpointFields(
  value: unknown,
  path: string,
  defaultMissingVerified: boolean,
): Breakpoint {
  const record = requireRecord(value, path);
  requireOnlyKeys(
    record,
    [
      "id",
      "filePath",
      "lineNumber",
      "columnNumber",
      "condition",
      "hitCondition",
      "logMessage",
      "enabled",
      "verified",
    ],
    path,
  );
  const id = requireNonEmptyString(record.id, `${path}.id`);
  if (utf8ByteLength(id) > MAX_DEBUG_BREAKPOINT_ID_BYTES || id.includes("\0")) {
    throw invalidDebugWire(`${path}.id`, `at most ${MAX_DEBUG_BREAKPOINT_ID_BYTES} UTF-8 bytes`);
  }
  requireBreakpointFilePath(record.filePath, `${path}.filePath`);
  requireIntegerInRange(record.lineNumber, `${path}.lineNumber`, 1, MAX_DEBUG_BREAKPOINT_LINE);
  if (record.columnNumber !== undefined) {
    requireIntegerInRange(record.columnNumber, `${path}.columnNumber`, 1, U32_MAX);
  }
  requireNullableOptionalString(record.condition, `${path}.condition`);
  if (
    typeof record.condition === "string" &&
    (utf8ByteLength(record.condition) > MAX_DEBUG_BREAKPOINT_CONDITION_BYTES ||
      record.condition.includes("\0"))
  ) {
    throw invalidDebugWire(
      `${path}.condition`,
      `at most ${MAX_DEBUG_BREAKPOINT_CONDITION_BYTES} UTF-8 bytes`,
    );
  }
  decodeOptionalHitCondition(record.hitCondition, `${path}.hitCondition`);
  if (
    record.logMessage !== undefined &&
    record.logMessage !== null &&
    !isBreakpointLogMessage(record.logMessage)
  ) {
    throw invalidDebugWire(
      `${path}.logMessage`,
      "a valid bounded logpoint message, null, or omitted",
    );
  }
  requireBoolean(record.enabled, `${path}.enabled`);
  if (record.verified === undefined && defaultMissingVerified) {
    return { ...(record as unknown as Breakpoint), verified: false };
  }
  if (record.verified !== undefined) {
    requireBoolean(record.verified, `${path}.verified`);
  }
  return record as unknown as Breakpoint;
}

function decodeStackFrame(value: unknown, path: string): StackFrame {
  const record = requireRecord(value, path);
  requireUnsignedInteger(record.frameId, `${path}.frameId`, U64_MAX);
  requireString(record.name, `${path}.name`);
  if (record.filePath !== null) requireString(record.filePath, `${path}.filePath`);
  requireUnsignedInteger(record.lineNumber, `${path}.lineNumber`, U32_MAX);
  requireUnsignedInteger(record.column, `${path}.column`, U32_MAX);
  return record as unknown as StackFrame;
}

function decodeScope(value: unknown, path: string): DebugScope {
  const record = requireRecord(value, path);
  requireExactKeys(record, ["name", "variablesReference", "expensive"], path);
  const name = requireBoundedString(
    record.name,
    `${path}.name`,
    MAX_DEBUG_VARIABLE_NAME_BYTES,
    false,
  );
  requireNoControlCharacters(name, `${path}.name`, false);
  return {
    name,
    variablesReference: requirePositiveSafeInteger(
      record.variablesReference,
      `${path}.variablesReference`,
    ),
    expensive: requireBoolean(record.expensive, `${path}.expensive`),
  };
}

function validateScopesRequest(request: Record<string, unknown>, command: string): void {
  const path = `${command} args.request`;
  requireExactKeys(request, ["rootPath", "sessionId", "pauseGeneration", "frameId"], path);
  const rootPath = requireBoundedString(
    request.rootPath,
    `${path}.rootPath`,
    MAX_DEBUG_ROOT_PATH_BYTES,
    false,
  );
  requireNoControlCharacters(rootPath, `${path}.rootPath`, false);
  requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
  requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
  requirePositiveSafeInteger(request.frameId, `${path}.frameId`);
}

function decodeVariable(value: unknown, path: string): DebugVariable {
  const record = requireRecord(value, path);
  requireObjectShape(
    record,
    ["name", "value", "variablesReference"],
    ["type", "evaluateName", "canSetValue"],
    path,
  );
  const name = requireBoundedString(
    record.name,
    `${path}.name`,
    MAX_DEBUG_VARIABLE_NAME_BYTES,
    true,
  );
  requireNoControlCharacters(name, `${path}.name`, false);
  requireBoundedString(record.value, `${path}.value`, MAX_DEBUG_VARIABLE_VALUE_BYTES, true);
  if (record.type !== null && record.type !== undefined) {
    const variableType = requireBoundedString(
      record.type,
      `${path}.type`,
      MAX_DEBUG_VARIABLE_TYPE_BYTES,
      false,
    );
    requireNoControlCharacters(variableType, `${path}.type`, false);
  }
  if (record.evaluateName !== undefined) {
    const evaluateName = requireBoundedString(
      record.evaluateName,
      `${path}.evaluateName`,
      MAX_DEBUG_VARIABLE_EVALUATE_NAME_BYTES,
      false,
    );
    requireNoControlCharacters(evaluateName, `${path}.evaluateName`, false);
  }
  if (record.canSetValue !== undefined && record.canSetValue !== true) {
    throw invalidDebugWire(`${path}.canSetValue`, "true or omission");
  }
  requireUnsignedInteger(record.variablesReference, `${path}.variablesReference`, U64_MAX);
  return record as unknown as DebugVariable;
}

function decodeVariablePage(value: unknown, path: string): DebugVariablePage {
  const record = requireRecord(value, path);
  requireObjectShape(
    record,
    ["variables", "start", "returned", "truncated"],
    ["total", "nextStart"],
    path,
  );
  if (utf8ByteLength(JSON.stringify(record)) > MAX_DEBUG_VARIABLE_PAGE_BYTES) {
    throw invalidDebugWire(path, `at most ${MAX_DEBUG_VARIABLE_PAGE_BYTES} UTF-8 bytes`);
  }
  const variables = decodeArray(
    record.variables,
    `${path}.variables`,
    decodeVariable,
    MAX_DEBUG_VARIABLE_PAGE_COUNT,
  );
  const start = requireIntegerInRange(
    record.start,
    `${path}.start`,
    0,
    MAX_DEBUG_VARIABLE_PAGE_START,
  );
  const returned = requireIntegerInRange(
    record.returned,
    `${path}.returned`,
    0,
    MAX_DEBUG_VARIABLE_PAGE_COUNT,
  );
  if (returned !== variables.length) {
    throw invalidDebugWire(`${path}.returned`, "the exact variables array length");
  }
  const consumed = start + returned;
  if (!Number.isSafeInteger(consumed)) {
    throw invalidDebugWire(`${path}.returned`, "an offset that remains JavaScript-safe");
  }
  const total =
    record.total === undefined
      ? undefined
      : requireUnsignedInteger(record.total, `${path}.total`, U64_MAX);
  const nextStart =
    record.nextStart === undefined
      ? undefined
      : requireUnsignedInteger(record.nextStart, `${path}.nextStart`, U64_MAX);
  if (total !== undefined && total < consumed) {
    throw invalidDebugWire(`${path}.total`, "at least start + returned");
  }
  if (nextStart !== undefined && (returned === 0 || nextStart !== consumed)) {
    throw invalidDebugWire(`${path}.nextStart`, "the progressive start + returned offset");
  }
  if (total !== undefined && total > consumed && nextStart === undefined) {
    throw invalidDebugWire(`${path}.nextStart`, "present while total has more variables");
  }
  if (nextStart !== undefined && total !== undefined && nextStart >= total) {
    throw invalidDebugWire(`${path}.nextStart`, "less than total when both are present");
  }
  return {
    variables,
    start,
    returned,
    ...(total === undefined ? {} : { total }),
    ...(nextStart === undefined ? {} : { nextStart }),
    truncated: requireBoolean(record.truncated, `${path}.truncated`),
  };
}

function validateVariablesRequest(request: Record<string, unknown>, command: string): void {
  const path = `${command} args.request`;
  requireExactKeys(
    request,
    ["rootPath", "sessionId", "pauseGeneration", "frameId", "variablesReference", "start", "count"],
    path,
  );
  const rootPath = requireBoundedString(
    request.rootPath,
    `${path}.rootPath`,
    MAX_DEBUG_ROOT_PATH_BYTES,
    false,
  );
  requireNoControlCharacters(rootPath, `${path}.rootPath`, false);
  requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
  requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
  requirePositiveSafeInteger(request.frameId, `${path}.frameId`);
  requirePositiveSafeInteger(request.variablesReference, `${path}.variablesReference`);
  requireIntegerInRange(request.start, `${path}.start`, 0, MAX_DEBUG_VARIABLE_PAGE_START);
  requireIntegerInRange(request.count, `${path}.count`, 1, MAX_DEBUG_VARIABLE_PAGE_COUNT);
}

function validateRunToLocationRequest(request: Record<string, unknown>, command: string): void {
  const path = `${command} args.request`;
  requireExactKeys(
    request,
    ["rootPath", "sessionId", "pauseGeneration", "filePath", "lineNumber", "columnNumber"],
    path,
  );
  requireSafeDebugPath(request.rootPath, `${path}.rootPath`);
  requirePositiveSafeInteger(request.sessionId, `${path}.sessionId`);
  requirePositiveSafeInteger(request.pauseGeneration, `${path}.pauseGeneration`);
  requireSafeDebugPath(request.filePath, `${path}.filePath`);
  requireIntegerInRange(
    request.lineNumber,
    `${path}.lineNumber`,
    1,
    MAX_DEBUG_RUN_TO_LOCATION_LINE,
  );
  requireIntegerInRange(
    request.columnNumber,
    `${path}.columnNumber`,
    1,
    MAX_DEBUG_RUN_TO_LOCATION_COLUMN,
  );
}

function validateVariablePageForRequest(
  page: DebugVariablePage,
  request: DebugVariablePageRequest,
): void {
  if (page.start !== request.start) {
    throw invalidDebugWire("debug_variables result.start", "the request start");
  }
  if (page.returned > request.count) {
    throw invalidDebugWire("debug_variables result.returned", "at most the request count");
  }
}

function decodeEvaluationResult(value: unknown, path: string): DebugEvaluationResultWire {
  const record = requireRecord(value, path);
  if (record.status === "ok") {
    requireExactKeys(record, ["status", "value"], path);
    const nested = requireRecord(record.value, `${path}.value`);
    requireObjectShape(
      nested,
      ["name", "value", "type", "variablesReference"],
      ["evaluateName", "setExpressionReference"],
      `${path}.value`,
    );
    const valueType =
      nested.type === null
        ? null
        : requireBoundedString(
            nested.type,
            `${path}.value.type`,
            MAX_DEBUG_VARIABLE_TYPE_BYTES,
            false,
          );
    const evaluateName =
      nested.evaluateName === undefined
        ? undefined
        : requireBoundedString(
            nested.evaluateName,
            `${path}.value.evaluateName`,
            MAX_DEBUG_VARIABLE_EVALUATE_NAME_BYTES,
            false,
          );
    if (evaluateName !== undefined) {
      requireNoControlCharacters(evaluateName, `${path}.value.evaluateName`, false);
    }
    const setExpressionReference =
      nested.setExpressionReference === undefined
        ? undefined
        : requirePositiveSafeInteger(
            nested.setExpressionReference,
            `${path}.value.setExpressionReference`,
          );
    return {
      status: "ok",
      value: {
        name: requireBoundedString(
          nested.name,
          `${path}.value.name`,
          MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
          true,
        ),
        value: requireBoundedString(
          nested.value,
          `${path}.value.value`,
          MAX_DEBUG_VARIABLE_VALUE_BYTES,
          true,
        ),
        type: valueType,
        ...(evaluateName === undefined ? {} : { evaluateName }),
        ...(setExpressionReference === undefined ? {} : { setExpressionReference }),
        variablesReference: requireUnsignedInteger(
          nested.variablesReference,
          `${path}.value.variablesReference`,
          U64_MAX,
        ),
      },
    };
  }
  if (record.status === "error") {
    requireExactKeys(record, ["status", "kind", "message"], path);
    if (
      record.kind !== "exception" &&
      record.kind !== "side-effect" &&
      record.kind !== "unsupported"
    ) {
      throw invalidDebugWire(`${path}.kind`, "exception, side-effect, or unsupported");
    }
    return {
      status: "error",
      kind: record.kind,
      message: requireBoundedString(
        record.message,
        `${path}.message`,
        MAX_DEBUG_EVALUATION_MESSAGE_BYTES,
        false,
      ),
    };
  }
  throw invalidDebugWire(`${path}.status`, "ok or error");
}

function decodeSetExpressionResult(value: unknown, path: string): DebugSetExpressionResult {
  const record = requireRecord(value, path);
  requireExactKeys(record, ["setExpressionReference", "expression", "value"], path);
  const expression = requireBoundedString(
    record.expression,
    `${path}.expression`,
    MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
    false,
  );
  const nested = decodeEvaluationResult(
    { status: "ok", value: record.value },
    `${path}.evaluation`,
  );
  if (nested.status !== "ok") {
    throw invalidDebugWire(`${path}.value`, "a successful evaluation value");
  }
  if (nested.value.name !== expression) {
    throw invalidDebugWire(`${path}.value.name`, "the result expression");
  }
  if (nested.value.setExpressionReference !== undefined) {
    throw invalidDebugWire(`${path}.value.setExpressionReference`, "no derived mutation authority");
  }
  return {
    setExpressionReference: requirePositiveSafeInteger(
      record.setExpressionReference,
      `${path}.setExpressionReference`,
    ),
    expression,
    value: {
      status: "ok",
      value: nested.value.value,
      type: nested.value.type,
      ...(nested.value.evaluateName === undefined
        ? {}
        : { evaluateName: nested.value.evaluateName }),
      variablesReference: nested.value.variablesReference,
    },
  };
}

function decodeDebugEventPayload(value: unknown): DebugEventPayload {
  const path = "debug event.payload";
  const record = requireRecord(value, path);
  switch (record.kind) {
    case "started":
      requireExactKeys(record, ["kind", "sessionId"], path);
      return {
        kind: "started",
        sessionId: requirePositiveSafeInteger(record.sessionId, `${path}.sessionId`),
      };
    case "stopped":
      requireExactKeys(record, ["kind", "reason", "frames", "pauseGeneration"], path);
      if (!STOP_REASONS.has(record.reason)) {
        throw invalidDebugWire(`${path}.reason`, "a known stop reason");
      }
      return {
        kind: "stopped",
        reason: record.reason as Extract<DebugEventPayload, { kind: "stopped" }>["reason"],
        frames: decodeArray(record.frames, `${path}.frames`, decodeStackFrame),
        pauseGeneration: requirePositiveSafeInteger(
          record.pauseGeneration,
          `${path}.pauseGeneration`,
        ),
      };
    case "resumed":
      requireExactKeys(record, ["kind"], path);
      return { kind: "resumed" };
    case "output":
      requireExactKeys(record, ["kind", "stream", "text"], path);
      if (record.stream !== "stdout" && record.stream !== "stderr") {
        throw invalidDebugWire(`${path}.stream`, "stdout or stderr");
      }
      return {
        kind: "output",
        stream: record.stream,
        text: requireString(record.text, `${path}.text`),
      };
    case "terminated":
      requireExactKeys(record, ["kind", "exitCode"], path);
      return {
        kind: "terminated",
        exitCode:
          record.exitCode === null
            ? null
            : requireSignedInteger(record.exitCode, `${path}.exitCode`, I32_MIN, I32_MAX),
      };
    case "breakpointsVerified": {
      requireExactKeys(record, ["kind", "filePath", "breakpoints"], path);
      const eventFilePath = requireBreakpointFilePath(record.filePath, `${path}.filePath`);
      const eventBreakpoints = decodeBreakpointArray(
        record.breakpoints,
        `${path}.breakpoints`,
        decodeBreakpoint,
        MAX_DEBUG_BREAKPOINTS_PER_FILE,
      );
      requireUniqueBreakpointIds(eventBreakpoints, `${path}.breakpoints`);
      for (const [index, breakpoint] of eventBreakpoints.entries()) {
        if (breakpoint.filePath !== eventFilePath) {
          throw invalidDebugWire(`${path}.breakpoints[${index}].filePath`, "the event filePath");
        }
      }
      return {
        kind: "breakpointsVerified",
        filePath: eventFilePath,
        breakpoints: eventBreakpoints,
      };
    }
    default:
      throw invalidDebugWire(`${path}.kind`, "a known event kind");
  }
}

function decodeVoidResult(command: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    throw invalidDebugWire(`${command} result`, "null or undefined");
  }
}

function decodeNullResult(command: string, value: unknown): void {
  if (value !== null) {
    throw invalidDebugWire(`${command} result`, "null");
  }
}

function decodeArray<T>(
  value: unknown,
  path: string,
  decode: (item: unknown, itemPath: string) => T,
  maximum = Number.MAX_SAFE_INTEGER,
): T[] {
  if (!Array.isArray(value)) throw invalidDebugWire(path, "an array");
  if (value.length > maximum) throw invalidDebugWire(path, `at most ${maximum} entries`);
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function decodeBreakpointArray(
  value: unknown,
  path: string,
  decode: (item: unknown, itemPath: string) => Breakpoint,
  maximum: number,
): Breakpoint[] {
  if (!Array.isArray(value)) throw invalidDebugWire(path, "an array");
  if (value.length > maximum) throw invalidDebugWire(path, `at most ${maximum} breakpoints`);
  const breakpoints = value.map((item, index) => decode(item, `${path}[${index}]`));
  requireUniqueBreakpointIds(breakpoints, path);
  return breakpoints;
}

function requireUniqueBreakpointIds(breakpoints: readonly Breakpoint[], path: string): void {
  const ids = new Set<string>();
  for (const [index, breakpoint] of breakpoints.entries()) {
    if (ids.has(breakpoint.id)) {
      throw invalidDebugWire(`${path}[${index}].id`, "a unique breakpoint id");
    }
    ids.add(breakpoint.id);
  }
}

function requireBreakpointFileCaps(breakpoints: readonly Breakpoint[], path: string): void {
  const counts = new Map<string, number>();
  for (const [index, breakpoint] of breakpoints.entries()) {
    const count = (counts.get(breakpoint.filePath) ?? 0) + 1;
    if (count > MAX_DEBUG_BREAKPOINTS_PER_FILE) {
      throw invalidDebugWire(
        `${path}[${index}].filePath`,
        `at most ${MAX_DEBUG_BREAKPOINTS_PER_FILE} breakpoints per file`,
      );
    }
    counts.set(breakpoint.filePath, count);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidDebugWire(path, "an object");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key));
  if (unexpected) throw invalidDebugWire(`${path}.${unexpected}`, "no unknown field");
  const missing = expected.find((key) => !(key in value));
  if (missing) throw invalidDebugWire(`${path}.${missing}`, "a required field");
}

function requireObjectShape(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = [...required, ...optional];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw invalidDebugWire(`${path}.${unexpected}`, "no unknown field");
  const missing = required.find((key) => !(key in value));
  if (missing) throw invalidDebugWire(`${path}.${missing}`, "a required field");
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key));
  if (unexpected) throw invalidDebugWire(`${path}.${unexpected}`, "no unknown field");
}

function requireExceptionPauseMode(value: unknown, path: string): DebugExceptionPauseMode {
  if (!EXCEPTION_PAUSE_MODES.has(value)) {
    throw invalidDebugWire(path, '"none", "uncaught", or "all"');
  }
  return value as DebugExceptionPauseMode;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw invalidDebugWire(path, "a string");
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (result.length === 0) throw invalidDebugWire(path, "a non-empty string");
  return result;
}

function requireBoundedString(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty: boolean,
): string {
  const result = requireString(value, path);
  if ((!allowEmpty && result.trim() === "") || result.includes("\0")) {
    throw invalidDebugWire(
      path,
      allowEmpty ? "a string without NUL" : "a non-empty string without NUL",
    );
  }
  if (!isWellFormedUnicode(result)) {
    throw invalidDebugWire(path, "valid Unicode text");
  }
  if (utf8ByteLength(result) > maximumBytes) {
    throw invalidDebugWire(path, `at most ${maximumBytes} UTF-8 bytes`);
  }
  return result;
}

function requireNoControlCharacters(value: string, path: string, allowTab: boolean): void {
  if (
    [...value].some((character) => /\p{Cc}/u.test(character) && !(allowTab && character === "\t"))
  ) {
    throw invalidDebugWire(
      path,
      allowTab ? "no control characters other than tab" : "no control characters",
    );
  }
}

function requireSafeDebugPath(value: unknown, path: string): string {
  const result = requireBoundedString(value, path, MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES, false);
  if (!isWellFormedUnicode(result)) {
    throw invalidDebugWire(path, "valid Unicode path text");
  }
  if (/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(result)) {
    throw invalidDebugWire(path, "a path without unsafe control or direction characters");
  }
  return result;
}

function requirePositiveSafeInteger(value: unknown, path: string): number {
  const result = requireUnsignedInteger(value, path, U64_MAX);
  if (result === 0) throw invalidDebugWire(path, "a positive JavaScript-safe integer");
  return result;
}

function requireBreakpointFilePath(value: unknown, path: string): string {
  const filePath = requireNonEmptyString(value, path);
  if (utf8ByteLength(filePath) > MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES || filePath.includes("\0")) {
    throw invalidDebugWire(
      path,
      `a non-NUL path of at most ${MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES} UTF-8 bytes`,
    );
  }
  return filePath;
}

function requireNullableOptionalString(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw invalidDebugWire(path, "a string, null, or omitted");
  }
}

function decodeOptionalHitCondition(value: unknown, path: string): void {
  if (value === undefined || value === null) return;

  const record = requireRecord(value, path);
  requireExactKeys(record, ["kind", "count"], path);
  if (record.kind !== "equals" && record.kind !== "greaterOrEqual" && record.kind !== "multiple") {
    throw invalidDebugWire(`${path}.kind`, '"equals", "greaterOrEqual", or "multiple"');
  }
  requireIntegerInRange(record.count, `${path}.count`, 1, Number.MAX_SAFE_INTEGER);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw invalidDebugWire(path, "a boolean");
  return value;
}

function requireUnsignedInteger(value: unknown, path: string, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw invalidDebugWire(path, `an integer between 0 and ${max}`);
  }
  return value as number;
}

function requireIntegerInRange(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalidDebugWire(path, `an integer between ${min} and ${max}`);
  }
  return value as number;
}

function requireSignedInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalidDebugWire(path, `an integer between ${min} and ${max}`);
  }
  return value as number;
}

function invalidDebugWire(path: string, expectation: string): TypeError {
  return new TypeError(`Invalid debug IPC value at ${path}: expected ${expectation}.`);
}

const U16_MAX = 65_535;
const U32_MAX = 4_294_967_295;
const U64_MAX = Number.MAX_SAFE_INTEGER;
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
const STEP_KINDS = new Set<unknown>(["continue", "stepOver", "stepInto", "stepOut"]);
const EXCEPTION_PAUSE_MODES = new Set<unknown>(["none", "uncaught", "all"]);
const STOP_REASONS = new Set<unknown>([
  "breakpoint",
  "step",
  "pause",
  "entry",
  "exception",
  "restart",
]);
