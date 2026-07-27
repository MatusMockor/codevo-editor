import type {
  Breakpoint,
  DebugEvent,
  DebugEventPayload,
  DebugSetExpressionResult,
  DebugScope,
  DebugVariable,
  DebugVariablePage,
  FunctionBreakpointVerification,
  StackFrame,
} from "../domain/debug";
import {
  decodeFunctionBreakpointVerificationList,
  functionBreakpointVerificationsMatch,
  validateFunctionBreakpointCommandArgs,
} from "../domain/debugFunctionBreakpoints";
import {
  isNodeDebugPort,
  MAX_DEBUG_SCOPE_COUNT,
  MAX_DEBUG_SCOPE_NAME_BYTES,
} from "../domain/debug";
import {
  MAX_DEBUG_EVALUATION_ERROR_BYTES,
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  MAX_DEBUG_EVALUATION_TYPE_BYTES,
  MAX_DEBUG_EVALUATION_VALUE_BYTES,
  isDebugEvaluationPolicy,
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
  type DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import { MAX_DEBUG_CONSOLE_OUTPUT_BYTES } from "../domain/debugConsoleState";
import { isExceptionTypeFilter } from "../domain/debugExceptionTypeFilter";
import {
  validateDebugVariablePageCompletion,
  validateDebugVariablePageRequestMatch,
} from "./debugVariablePageWireValidation";
import {
  type DebugCompoundStartResponseWire,
  type DebugEvaluationResultWire,
  type DebugIpcCommand,
  type DebugIpcCommandArgs,
  type DebugIpcCommandResult,
  type DebugLaunchTargetWire,
  type DebugStartResponseWire,
  type InvokeDebugCommand,
} from "./tauriDebugIpcProtocol";
export {
  DEBUG_IPC_COMMANDS,
  type DebugCompoundStartRequestWire,
  type DebugCompoundStartResponseWire,
  type DebugEvaluationResultWire,
  type DebugIpcCommand,
  type DebugIpcCommandArgs,
  type DebugIpcCommandResult,
  type DebugLaunchTargetWire,
  type DebugStartResponseWire,
  type InvokeDebugCommand,
} from "./tauriDebugIpcProtocol";

const DEBUG_IDENTIFIER_PATTERN = /^(?:[$_]|\p{ID_Start})(?:[$_\u200c\u200d]|\p{ID_Continue})*$/u;

export const MAX_DEBUG_VARIABLE_NAME_BYTES = MAX_DEBUG_SCOPE_NAME_BYTES;
export const MAX_DEBUG_VARIABLE_EVALUATE_NAME_BYTES = MAX_DEBUG_EVALUATION_EXPRESSION_BYTES;
export const MAX_DEBUG_EVALUATION_MESSAGE_BYTES = MAX_DEBUG_EVALUATION_ERROR_BYTES;
export const MAX_DEBUG_VARIABLE_TYPE_BYTES = MAX_DEBUG_EVALUATION_TYPE_BYTES;
export const MAX_DEBUG_VARIABLE_VALUE_BYTES = MAX_DEBUG_EVALUATION_VALUE_BYTES;
export const MAX_DEBUG_VARIABLE_PAGE_BYTES = 1_024 * 1_024;
export const MAX_DEBUG_VARIABLE_PAGE_COUNT = 100;
export const MAX_DEBUG_VARIABLE_PAGE_START = 1_000_000;
export const MAX_DEBUG_SCOPES = MAX_DEBUG_SCOPE_COUNT;
export const MAX_DEBUG_VARIABLES = 10_000;
export const MAX_DEBUG_STACK_FRAMES = 256;
const MAX_DEBUG_ROOT_PATH_BYTES = 4_096;
export const MIN_DEBUG_COMPOUND_MEMBERS = 2;
export const MAX_DEBUG_COMPOUND_MEMBERS = 8;
export const MAX_DEBUG_COMPOUND_MESSAGE_BYTES = 512;
export const MAX_DEBUG_COMPOUND_REQUEST_BYTES = 1_048_576;
export const MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES = 4_096;
export const MAX_DEBUG_RUN_TO_LOCATION_LINE = 4_294_967_295;
export const MAX_DEBUG_RUN_TO_LOCATION_COLUMN = 4_294_967_295;
/** Must match Rust `MAX_DEBUG_OUTPUT_EVENT_BYTES` at the debugger event wire boundary. */
export const MAX_DEBUG_OUTPUT_EVENT_BYTES = MAX_DEBUG_CONSOLE_OUTPUT_BYTES;

export class DebugCompoundRequestTooLargeError extends TypeError {
  constructor() {
    super(`Debug compound request exceeds ${MAX_DEBUG_COMPOUND_REQUEST_BYTES} UTF-8 bytes.`);
    this.name = "DebugCompoundRequestTooLargeError";
  }
}

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
    validateDebugVariablePageRequestMatch(
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
  extraFields: string[] = [],
) {
  requireExactKeys(request, ["rootPath", "sessionId", ...extraFields], `${command} args.request`);
  const rootPath = requireBoundedString(
    request.rootPath,
    `${command} args.request.rootPath`,
    MAX_DEBUG_ROOT_PATH_BYTES,
    false,
  );
  requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
  requirePositiveSafeInteger(request.sessionId, `${command} args.request.sessionId`);
}

function validateCompletionRequest(request: Record<string, unknown>, command: DebugIpcCommand) {
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
      throw invalidDebugWire(
        `${path}.sessionIds`,
        `${MIN_DEBUG_COMPOUND_MEMBERS} to ${MAX_DEBUG_COMPOUND_MEMBERS} unique session ids`,
      );
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

function validateDebugIpcArgs(command: DebugIpcCommand, value: unknown) {
  const args = requireRecord(value, `${command} args`);
  switch (command) {
    case "debug_completions": {
      requireExactKeys(args, ["request"], `${command} args`);
      validateCompletionRequest(requireRecord(args.request, `${command} args.request`), command);
      return;
    }
    case "debug_start": {
      requireObjectShape(
        args,
        ["rootPath", "launch", "breakpoints", "exceptionPauseMode", "exceptionTypeFilter"],
        ["functionBreakpoints"],
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
      if (args.functionBreakpoints !== undefined) {
        const functionBreakpointError = validateFunctionBreakpointCommandArgs({
          request: {
            rootPath: args.rootPath,
            sessionId: 1,
            generation: 1,
            breakpoints: args.functionBreakpoints,
          },
        });
        if (functionBreakpointError) {
          throw invalidDebugWire(
            `${command} args.functionBreakpoints`,
            functionBreakpointError.expected,
          );
        }
      }
      requireExceptionPausePolicy(args, "exceptionPauseMode", `${command} args`);
      return;
    }
    case "debug_start_native_node_watch": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      requireObjectShape(
        request,
        [
          "rootPath",
          "scriptPath",
          "watch",
          "breakpoints",
          "functionBreakpoints",
          "exceptionPauseMode",
          "exceptionTypeFilter",
        ],
        ["preserveOutput", "justMyCode", "sourceMaps", "smartStep"],
        `${command} args.request`,
      );
      const rootPath = requireBoundedString(
        request.rootPath,
        `${command} args.request.rootPath`,
        MAX_DEBUG_ROOT_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(rootPath, `${command} args.request.rootPath`, false);
      const scriptPath = requireBoundedString(
        request.scriptPath,
        `${command} args.request.scriptPath`,
        MAX_DEBUG_BREAKPOINT_FILE_PATH_BYTES,
        false,
      );
      requireNoControlCharacters(scriptPath, `${command} args.request.scriptPath`, false);
      if (request.watch !== true) {
        throw invalidDebugWire(`${command} args.request.watch`, "true");
      }
      if (request.preserveOutput !== undefined && request.preserveOutput !== true) {
        throw invalidDebugWire(`${command} args.request.preserveOutput`, "true when present");
      }
      const startupBreakpoints = decodeBreakpointArray(
        request.breakpoints,
        `${command} args.request.breakpoints`,
        decodeBreakpointInput,
        MAX_DEBUG_BREAKPOINTS_PER_SESSION,
      );
      requireBreakpointFileCaps(startupBreakpoints, `${command} args.request.breakpoints`);
      const functionBreakpointError = validateFunctionBreakpointCommandArgs({
        request: {
          rootPath,
          sessionId: 1,
          generation: 1,
          breakpoints: request.functionBreakpoints,
        },
      });
      if (functionBreakpointError) {
        throw invalidDebugWire(
          `${command} args.request.functionBreakpoints`,
          functionBreakpointError.expected,
        );
      }
      requireExceptionPausePolicy(request, "exceptionPauseMode", `${command} args.request`);
      decodeNodeDebugJustMyCode(request.justMyCode, `${command} args.request.justMyCode`);
      decodeOptionalBoolean(request.sourceMaps, `${command} args.request.sourceMaps`);
      decodeOptionalBoolean(request.smartStep, `${command} args.request.smartStep`);
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
        throw new DebugCompoundRequestTooLargeError();
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
          requireExactKeys(
            record,
            ["launch", "breakpoints", "exceptionPauseMode", "exceptionTypeFilter"],
            memberPath,
          );
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
          requireExceptionPausePolicy(record, "exceptionPauseMode", memberPath);
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
    case "debug_set_exception_pause": {
      requireExactKeys(args, ["request"], `${command} args`);
      const request = requireRecord(args.request, `${command} args.request`);
      validateSessionOwnerRequest(request, command, ["mode", "exceptionTypeFilter"]);
      requireExceptionPausePolicy(request, "mode", `${command} args.request`);
      return;
    }
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
        requireDebugEvaluationExpressionCharacters(
          expression,
          `${command} args.request.expression`,
        );
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

function decodeLaunchTarget(value: unknown, path: string): DebugLaunchTargetWire {
  const record = requireRecord(value, path);
  switch (record.kind) {
    case "node-attach":
      requireObjectShape(
        record,
        ["kind", "port"],
        ["sourceMaps", "smartStep", "stopOnEntry"],
        path,
      );
      if (!isNodeDebugPort(record.port)) {
        throw invalidDebugWire(`${path}.port`, "an integer between 1 and 65535");
      }
      decodeOptionalBoolean(record.sourceMaps, `${path}.sourceMaps`);
      decodeOptionalBoolean(record.smartStep, `${path}.smartStep`);
      if (record.stopOnEntry !== undefined && record.stopOnEntry !== false) {
        throw invalidDebugWire(`${path}.stopOnEntry`, "false when present");
      }
      break;
    case "node-script":
      requireObjectShape(
        record,
        ["kind", "scriptPath"],
        ["sourceMaps", "smartStep", "stopOnEntry"],
        path,
      );
      requireString(record.scriptPath, `${path}.scriptPath`);
      decodeOptionalBoolean(record.sourceMaps, `${path}.sourceMaps`);
      decodeOptionalBoolean(record.smartStep, `${path}.smartStep`);
      decodeOptionalBoolean(record.stopOnEntry, `${path}.stopOnEntry`);
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
        ["cwd", "envFile", "justMyCode", "runtime", "sourceMaps", "smartStep", "stopOnEntry"],
        path,
      );
      requireString(record.scriptPath, `${path}.scriptPath`);
      decodeNodeLaunchOptions(record, path);
      if (record.envFile !== undefined) requireString(record.envFile, `${path}.envFile`);
      decodeOptionalEnum(record.runtime, `${path}.runtime`, ["tsx", "ts-node"], "tsx or ts-node");
      decodeNodeDebugJustMyCode(record.justMyCode, `${path}.justMyCode`);
      decodeOptionalBoolean(record.sourceMaps, `${path}.sourceMaps`);
      decodeOptionalBoolean(record.smartStep, `${path}.smartStep`);
      decodeOptionalBoolean(record.stopOnEntry, `${path}.stopOnEntry`);
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
        ["cwd", "justMyCode", "sourceMaps", "smartStep", "stopOnEntry"],
        path,
      );
      requireString(record.script, `${path}.script`);
      requireString(record.packageRootPath, `${path}.packageRootPath`);
      decodeNodeLaunchOptions(record, path);
      decodeNodeDebugJustMyCode(record.justMyCode, `${path}.justMyCode`);
      decodeOptionalBoolean(record.sourceMaps, `${path}.sourceMaps`);
      decodeOptionalBoolean(record.smartStep, `${path}.smartStep`);
      decodeOptionalBoolean(record.stopOnEntry, `${path}.stopOnEntry`);
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
  return value as DebugLaunchTargetWire;
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

function decodeNodeDebugJustMyCode(value: unknown, path: string) {
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

function decodeOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) requireBoolean(value, path);
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
  requireAllowedKeys(
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
  requireExactKeys(record, ["frameId", "name", "filePath", "lineNumber", "column"], path);
  requirePositiveSafeInteger(record.frameId, `${path}.frameId`);
  const name = requireBoundedString(
    record.name,
    `${path}.name`,
    MAX_DEBUG_VARIABLE_NAME_BYTES,
    false,
  );
  requireNoControlCharacters(name, `${path}.name`, false);
  if (record.filePath !== null) {
    const filePath = requireBoundedString(
      record.filePath,
      `${path}.filePath`,
      MAX_DEBUG_ROOT_PATH_BYTES,
      false,
    );
    requireNoControlCharacters(filePath, `${path}.filePath`, false);
  }
  requireIntegerInRange(record.lineNumber, `${path}.lineNumber`, 1, U32_MAX);
  requireIntegerInRange(record.column, `${path}.column`, 1, U32_MAX);
  return record as unknown as StackFrame;
}

function requireUniqueStackFrameIds(frames: readonly StackFrame[], path: string): void {
  const ids = new Set<number>();
  for (const [index, frame] of frames.entries()) {
    if (ids.has(frame.frameId)) {
      throw invalidDebugWire(`${path}[${index}].frameId`, "a unique frame id");
    }
    ids.add(frame.frameId);
  }
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
    ["type", "evaluateName", "canSetValue", "childrenLimitReason"],
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
    requireDebugEvaluationExpressionCharacters(evaluateName, `${path}.evaluateName`);
  }
  if (record.canSetValue !== undefined && record.canSetValue !== true) {
    throw invalidDebugWire(`${path}.canSetValue`, "true or omission");
  }
  if (
    record.childrenLimitReason !== undefined &&
    record.childrenLimitReason !== "references" &&
    record.childrenLimitReason !== "referenceBytes"
  ) {
    throw invalidDebugWire(
      `${path}.childrenLimitReason`,
      '"references", "referenceBytes", or omission',
    );
  }
  requireUnsignedInteger(record.variablesReference, `${path}.variablesReference`, U64_MAX);
  if (record.childrenLimitReason !== undefined && record.variablesReference !== 0) {
    throw invalidDebugWire(`${path}.variablesReference`, "zero when children are limited");
  }
  return record as unknown as DebugVariable;
}

function decodeVariablePage(value: unknown, path: string): DebugVariablePage {
  const record = requireRecord(value, path);
  requireObjectShape(
    record,
    ["variables", "filter", "start", "returned", "total", "nextStart", "truncated", "limitReason"],
    [],
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
  if (record.filter !== "indexed" && record.filter !== "named") {
    throw invalidDebugWire(`${path}.filter`, '"indexed" or "named"');
  }
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
  const total =
    record.total === null ? null : requireUnsignedInteger(record.total, `${path}.total`, U64_MAX);
  const nextStart =
    record.nextStart === null
      ? null
      : requireUnsignedInteger(record.nextStart, `${path}.nextStart`, U64_MAX);
  const truncated = requireBoolean(record.truncated, `${path}.truncated`);
  const limitReason = decodeVariablePageLimitReason(record.limitReason, `${path}.limitReason`);
  validateDebugVariablePageCompletion({
    path,
    start,
    returned,
    total,
    nextStart,
    truncated,
    limitReason,
  });
  return {
    variables,
    filter: record.filter,
    start,
    returned,
    total,
    nextStart,
    truncated,
    limitReason,
  };
}

function decodeVariablePageLimitReason(value: unknown, path: string) {
  if (
    value === null ||
    value === "acquisition-count" ||
    value === "capability" ||
    value === "descriptor-count" ||
    value === "descriptor-bytes" ||
    value === "page-bytes" ||
    value === "references" ||
    value === "reference-bytes"
  ) {
    return value;
  }
  throw invalidDebugWire(path, "a supported variable page limit reason or null");
}

function validateVariablesRequest(request: Record<string, unknown>, command: string): void {
  const path = `${command} args.request`;
  requireExactKeys(
    request,
    [
      "rootPath",
      "sessionId",
      "pauseGeneration",
      "frameId",
      "variablesReference",
      "filter",
      "start",
      "count",
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
  if (request.filter !== "indexed" && request.filter !== "named") {
    throw invalidDebugWire(`${path}.filter`, '"indexed" or "named"');
  }
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
      requireDebugEvaluationExpressionCharacters(evaluateName, `${path}.value.evaluateName`);
    }
    const setExpressionReference =
      nested.setExpressionReference === undefined
        ? undefined
        : requirePositiveSafeInteger(
            nested.setExpressionReference,
            `${path}.value.setExpressionReference`,
          );
    const name = requireBoundedString(
      nested.name,
      `${path}.value.name`,
      MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
      true,
    );
    requireDebugEvaluationExpressionCharacters(name, `${path}.value.name`);
    return {
      status: "ok",
      value: {
        name,
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
    case "stopped": {
      requireObjectShape(
        record,
        ["kind", "reason", "frames", "pauseGeneration"],
        ["framesTruncated"],
        path,
      );
      if (!STOP_REASONS.has(record.reason)) {
        throw invalidDebugWire(`${path}.reason`, "a known stop reason");
      }
      if (record.framesTruncated !== undefined && record.framesTruncated !== true) {
        throw invalidDebugWire(`${path}.framesTruncated`, "true or omission");
      }
      const frames = decodeArray(
        record.frames,
        `${path}.frames`,
        decodeStackFrame,
        MAX_DEBUG_STACK_FRAMES,
      );
      requireUniqueStackFrameIds(frames, `${path}.frames`);
      return {
        kind: "stopped",
        reason: record.reason as Extract<DebugEventPayload, { kind: "stopped" }>["reason"],
        frames,
        pauseGeneration: requirePositiveSafeInteger(
          record.pauseGeneration,
          `${path}.pauseGeneration`,
        ),
        ...(record.framesTruncated === true ? { framesTruncated: true as const } : {}),
      };
    }
    case "resumed":
      requireExactKeys(record, ["kind"], path);
      return { kind: "resumed" };
    case "output":
      requireExactKeys(record, ["kind", "stream", "text", "truncated"], path);
      if (record.stream !== "stdout" && record.stream !== "stderr") {
        throw invalidDebugWire(`${path}.stream`, "stdout or stderr");
      }
      return {
        kind: "output",
        stream: record.stream,
        text: requireBoundedString(record.text, `${path}.text`, MAX_DEBUG_OUTPUT_EVENT_BYTES, true),
        truncated: requireBoolean(record.truncated, `${path}.truncated`),
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
) {
  requireAllowedKeys(value, expected, path);
  requirePresentKeys(value, expected, path);
}

function requireObjectShape(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) {
  requireAllowedKeys(value, [...required, ...optional], path);
  requirePresentKeys(value, required, path);
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw invalidDebugWire(`${path}.${unexpected}`, "no unknown field");
}

function requirePresentKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
) {
  const missing = required.find((key) => !(key in value));
  if (missing) throw invalidDebugWire(`${path}.${missing}`, "a required field");
}

function requireExceptionPausePolicy(
  value: Record<string, unknown>,
  modeKey: string,
  path: string,
) {
  if (!EXCEPTION_PAUSE_MODES.has(value[modeKey])) {
    throw invalidDebugWire(`${path}.${modeKey}`, '"none", "uncaught", or "all"');
  }
  if (isExceptionTypeFilter(value.exceptionTypeFilter)) return;
  throw invalidDebugWire(
    `${path}.exceptionTypeFilter`,
    "at most 8 unique exception constructor names",
  );
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

function requireDebugEvaluationExpressionCharacters(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\t" || character === "\n") continue;
    if (character === "\r" && value[index + 1] === "\n") continue;
    if (/\p{Cc}/u.test(character)) {
      throw invalidDebugWire(
        path,
        "no control characters other than tab, LF, or CRLF line endings",
      );
    }
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
