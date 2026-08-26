import {
  normalizeNodePackageTaskLaunchTarget,
  MAX_NODE_PACKAGE_DISCOVERY_MANIFESTS,
  MAX_NODE_PACKAGE_DISCOVERY_SCRIPTS,
  MAX_NODE_PACKAGE_DISCOVERY_VISITED,
  isNodePackageTaskRunId,
  isNodePackageScriptName,
  parseNodePackageTaskEvent,
  parseNodePackageScriptsResult,
  parseStartNodePackageTaskResult,
  type NodePackageDiscoveryLimits,
  type NodePackageTaskLaunchTarget,
  type NodePackageTaskEvent,
  type NodePackageScriptsResult,
  type StartNodePackageTaskRequest,
  type StartNodePackageTaskResult,
  type StopNodePackageTaskRequest,
} from "../domain/nodePackageScripts";
import {
  MAX_NODE_PACKAGE_TASK_OUTPUT_BYTES,
  MAX_NODE_PACKAGE_TASK_PROBLEM_CODE_BYTES,
  MAX_NODE_PACKAGE_TASK_PROBLEM_MESSAGE_BYTES,
  MAX_NODE_PACKAGE_TASK_PROBLEMS,
  MAX_NODE_PACKAGE_TASK_PROBLEMS_PER_EVENT,
  type NodePackageProblemMatcher,
  type NodePackageTaskOutputEvent,
  type NodePackageTaskProblem,
  type NodePackageTaskProblemsEvent,
} from "../domain/nodePackageTaskProblems";

export const NODE_PACKAGE_SCRIPTS_IPC_COMMAND = "workspace_discover_node_package_scripts" as const;
export const START_NODE_PACKAGE_TASK_IPC_COMMAND = "workspace_start_node_package_task" as const;
export const ACKNOWLEDGE_NODE_PACKAGE_TASK_START_IPC_COMMAND =
  "workspace_acknowledge_node_package_task_start" as const;
export const STOP_NODE_PACKAGE_TASK_IPC_COMMAND = "workspace_stop_node_package_task" as const;
export const NODE_PACKAGE_TASK_STATUS_EVENT = "node-package-task://status" as const;
export const NODE_PACKAGE_TASK_OUTPUT_EVENT = "node-package-task://output" as const;
export const NODE_PACKAGE_TASK_PROBLEMS_EVENT = "node-package-task://problems" as const;

export interface NodePackageScriptsIpcArgs extends NodePackageDiscoveryLimits {
  readonly workspaceId: string;
}

export type InvokeNodePackageScriptsCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const MAX_WORKSPACE_ID_BYTES = 1_024;
const UTF8_ENCODER = new TextEncoder();

export async function invokeNodePackageScriptsIpc(
  invokeCommand: InvokeNodePackageScriptsCommand,
  args: NodePackageScriptsIpcArgs,
): Promise<NodePackageScriptsResult> {
  const validated = validateArgs(args);
  const value = await invokeCommand(NODE_PACKAGE_SCRIPTS_IPC_COMMAND, {
    request: validated,
  });
  return parseNodePackageScriptsResult(value, validated);
}

export async function invokeStartNodePackageTaskIpc(
  invokeCommand: InvokeNodePackageScriptsCommand,
  request: StartNodePackageTaskRequest,
): Promise<StartNodePackageTaskResult> {
  const validated = validateStartRequest(request);
  const value = await invokeCommand(START_NODE_PACKAGE_TASK_IPC_COMMAND, {
    request: validated,
  });
  const result = parseStartNodePackageTaskResult(value);
  if (result.runId !== validated.runId) {
    invalid("result.runId", "the requested run id");
  }
  return result;
}

export async function invokeStopNodePackageTaskIpc(
  invokeCommand: InvokeNodePackageScriptsCommand,
  request: StopNodePackageTaskRequest,
): Promise<void> {
  const validated = validateStopRequest(request);
  const value = await invokeCommand(STOP_NODE_PACKAGE_TASK_IPC_COMMAND, { request: validated });
  if (value !== null) invalid("result", "null");
}

export async function invokeAcknowledgeNodePackageTaskStartIpc(
  invokeCommand: InvokeNodePackageScriptsCommand,
  request: StopNodePackageTaskRequest,
): Promise<void> {
  const validated = validateStopRequest(request);
  const value = await invokeCommand(ACKNOWLEDGE_NODE_PACKAGE_TASK_START_IPC_COMMAND, {
    request: validated,
  });
  if (value !== null) invalid("result", "null");
}

export function decodeNodePackageTaskEvent(value: unknown): NodePackageTaskEvent {
  return parseNodePackageTaskEvent(value);
}

export function decodeNodePackageTaskOutputEvent(value: unknown): NodePackageTaskOutputEvent {
  const event = record(value, "event");
  exactKeys(event, ["owner", "sequence", "stream", "data", "truncated"], "event");
  const stream = event.stream;
  if (stream !== "stdout" && stream !== "stderr") {
    invalid("event.stream", "stdout or stderr");
  }
  const data = boundedStringAllowEmpty(
    event.data,
    "event.data",
    MAX_NODE_PACKAGE_TASK_OUTPUT_BYTES,
  );
  const truncated = strictBoolean(event.truncated, "event.truncated");
  if (truncated && data !== "") invalid("event.data", "an empty truncation marker");
  return {
    owner: validateOwner(event.owner, "event.owner"),
    sequence: eventSequence(event.sequence, "event.sequence"),
    stream,
    data,
    truncated,
  };
}

export function decodeNodePackageTaskProblemsEvent(value: unknown): NodePackageTaskProblemsEvent {
  const event = record(value, "event");
  const kind = problemEventKind(event.kind);
  const withProblems = kind === "append" || kind === "complete";
  exactKeys(
    event,
    withProblems
      ? ["kind", "owner", "sequence", "problems", "total", "truncated"]
      : ["kind", "owner", "sequence"],
    "event",
  );
  const base = {
    kind,
    owner: validateOwner(event.owner, "event.owner"),
    sequence: eventSequence(event.sequence, "event.sequence"),
  };
  if (kind === "reset" || kind === "clear") return { ...base, kind };
  if (!Array.isArray(event.problems)) invalid("event.problems", "an array");
  const maximum =
    kind === "complete" ? MAX_NODE_PACKAGE_TASK_PROBLEMS : MAX_NODE_PACKAGE_TASK_PROBLEMS_PER_EVENT;
  if (event.problems.length > maximum) {
    invalid("event.problems", `at most ${maximum} entries`);
  }
  const problems = event.problems.map((problem, index) =>
    validateProblem(problem, `event.problems[${index}]`),
  );
  const total = unsignedSafeInteger(event.total, "event.total");
  const truncated = strictBoolean(event.truncated, "event.truncated");
  if (total < problems.length) {
    invalid("event.total", "a count at least as large as the event problem count");
  }
  if (kind === "complete" && !truncated && total !== problems.length) {
    invalid("event.total", "the complete snapshot size, or a larger truncated total");
  }
  return { ...base, kind, problems, total, truncated };
}

function validateStartRequest(value: unknown): StartNodePackageTaskRequest {
  const request = record(value, "request");
  exactOptionalKeys(
    request,
    [
      "runId",
      "workspaceId",
      "sessionId",
      "manifestRelativePath",
      "scriptName",
      "repositoryRoot",
      "target",
    ],
    ["problemMatcher"],
    "request",
  );
  const problemMatcher = hasOwn(request, "problemMatcher")
    ? validateProblemMatcher(request.problemMatcher, "request.problemMatcher")
    : undefined;
  return {
    runId: runId(request.runId, "request.runId"),
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
    sessionId: unsignedSafeInteger(request.sessionId, "request.sessionId"),
    manifestRelativePath: manifestRelativePath(request.manifestRelativePath),
    scriptName: scriptName(request.scriptName),
    repositoryRoot: absoluteDirectoryPath(request.repositoryRoot, "request.repositoryRoot"),
    target: validateLaunchTarget(request.target),
    ...(problemMatcher !== undefined ? { problemMatcher } : {}),
  };
}

function absoluteDirectoryPath(value: unknown, path: string): string {
  const candidate = boundedString(value, path, 4_096);
  if (!candidate.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(candidate)) {
    invalid(path, "an absolute directory path");
  }
  if (/\p{Cc}/u.test(candidate)) invalid(path, "an absolute path without control characters");
  return candidate;
}

function validateLaunchTarget(value: unknown): NodePackageTaskLaunchTarget {
  const target = record(value, "request.target");
  if (target.kind === "workspaceRoot") {
    exactKeys(target, ["kind"], "request.target");
    return normalizeNodePackageTaskLaunchTarget({ kind: "workspaceRoot" });
  }
  if (target.kind === "agentWorktree") {
    exactKeys(target, ["kind", "threadId"], "request.target");
    try {
      return normalizeNodePackageTaskLaunchTarget(target as NodePackageTaskLaunchTarget);
    } catch {
      invalid("request.target.threadId", "a safe agent thread id");
    }
  }
  invalid("request.target.kind", "workspaceRoot or agentWorktree");
}

function validateProblemMatcher(value: unknown, path: string): NodePackageProblemMatcher | null {
  if (value === null || value === "eslint" || value === "typescript") return value;
  invalid(path, "eslint, typescript, or null");
}

function problemEventKind(value: unknown): NodePackageTaskProblemsEvent["kind"] {
  if (value === "reset" || value === "append" || value === "complete" || value === "clear") {
    return value;
  }
  invalid("event.kind", "reset, append, complete, or clear");
}

function validateOwner(value: unknown, path: string) {
  const owner = record(value, path);
  exactKeys(
    owner,
    ["runId", "workspaceId", "sessionId", "manifestRelativePath", "scriptName"],
    path,
  );
  return {
    runId: runId(owner.runId, `${path}.runId`),
    workspaceId: workspaceId(owner.workspaceId, `${path}.workspaceId`),
    sessionId: unsignedSafeInteger(owner.sessionId, `${path}.sessionId`),
    manifestRelativePath: manifestRelativePathAt(
      owner.manifestRelativePath,
      `${path}.manifestRelativePath`,
    ),
    scriptName: scriptNameAt(owner.scriptName, `${path}.scriptName`),
  };
}

function validateProblem(value: unknown, path: string): NodePackageTaskProblem {
  const problem = record(value, path);
  exactKeys(
    problem,
    ["filePath", "lineNumber", "column", "severity", "message", "code", "source"],
    path,
  );
  const lineNumber = positiveSafeInteger(problem.lineNumber, `${path}.lineNumber`);
  const column = positiveSafeInteger(problem.column, `${path}.column`);
  if (problem.severity !== "warning" && problem.severity !== "error") {
    invalid(`${path}.severity`, "warning or error");
  }
  if (problem.source !== "TypeScript" && problem.source !== "ESLint") {
    invalid(`${path}.source`, "TypeScript or ESLint");
  }
  return {
    filePath: absoluteFilePath(problem.filePath, `${path}.filePath`),
    lineNumber,
    column,
    severity: problem.severity,
    message: boundedProblemMessage(
      problem.message,
      `${path}.message`,
      MAX_NODE_PACKAGE_TASK_PROBLEM_MESSAGE_BYTES,
    ),
    code:
      problem.code === null
        ? null
        : boundedControlFreeString(
            problem.code,
            `${path}.code`,
            MAX_NODE_PACKAGE_TASK_PROBLEM_CODE_BYTES,
          ),
    source: problem.source,
  };
}

function validateStopRequest(value: unknown): StopNodePackageTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["runId", "workspaceId"], "request");
  return {
    runId: runId(request.runId, "request.runId"),
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
  };
}

function validateArgs(value: unknown): NodePackageScriptsIpcArgs {
  const args = record(value, "args");
  exactKeys(args, ["workspaceId", "maxManifests", "maxScripts", "maxVisited"], "args");
  return {
    workspaceId: workspaceId(args.workspaceId),
    maxManifests: boundedPositiveInteger(
      args.maxManifests,
      "args.maxManifests",
      MAX_NODE_PACKAGE_DISCOVERY_MANIFESTS,
    ),
    maxScripts: boundedPositiveInteger(
      args.maxScripts,
      "args.maxScripts",
      MAX_NODE_PACKAGE_DISCOVERY_SCRIPTS,
    ),
    maxVisited: boundedPositiveInteger(
      args.maxVisited,
      "args.maxVisited",
      MAX_NODE_PACKAGE_DISCOVERY_VISITED,
    ),
  };
}

function workspaceId(value: unknown, path = "args.workspaceId"): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /\p{Cc}/u.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_WORKSPACE_ID_BYTES
  ) {
    invalid(
      path,
      `a non-empty UTF-8 string of at most ${MAX_WORKSPACE_ID_BYTES} bytes without control characters`,
    );
  }
  return value;
}

function boundedPositiveInteger(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    invalid(path, `a positive safe integer no greater than ${maximum}`);
  }
  return value as number;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function runId(value: unknown, path: string): string {
  if (typeof value !== "string" || !isNodePackageTaskRunId(value)) {
    invalid(path, "a bounded task run id without control characters");
  }
  return value;
}

function manifestRelativePath(value: unknown): string {
  return manifestRelativePathAt(value, "request.manifestRelativePath");
}

function manifestRelativePathAt(value: unknown, field: string): string {
  const path = boundedString(value, field, 4_096);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..") ||
    path.split("/")[path.split("/").length - 1] !== "package.json"
  ) {
    invalid(field, "a safe workspace-relative package.json path");
  }
  return path;
}

function scriptName(value: unknown): string {
  return scriptNameAt(value, "request.scriptName");
}

function scriptNameAt(value: unknown, path: string): string {
  if (typeof value !== "string" || !isNodePackageScriptName(value)) {
    invalid(path, "a safe package script name");
  }
  return value;
}

function absoluteFilePath(value: unknown, path: string): string {
  const candidate = boundedControlFreeString(value, path, 4_096);
  const parts = candidate.replace(/^[A-Za-z]:/, "").split(/[\\/]/);
  if (
    (!candidate.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(candidate)) ||
    candidate.endsWith("/") ||
    candidate.endsWith("\\") ||
    parts.some((part, index) => index > 0 && (part === "" || part === "." || part === ".."))
  ) {
    invalid(path, "a normalized absolute file path");
  }
  return candidate;
}

function eventSequence(value: unknown, path: string): number {
  const sequence = positiveSafeInteger(value, path);
  if (sequence > 0xffff_ffff) invalid(path, "a non-zero u32 sequence");
  return sequence;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    invalid(path, "a positive safe integer");
  }
  return value as number;
}

function strictBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function boundedStringAllowEmpty(value: unknown, path: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > maximumBytes
  ) {
    invalid(path, `a UTF-8 string of at most ${maximumBytes} bytes without NUL bytes`);
  }
  return value;
}

function boundedString(value: unknown, path: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > maximumBytes
  ) {
    invalid(path, `a non-empty UTF-8 string of at most ${maximumBytes} bytes without NUL bytes`);
  }
  return value;
}

function boundedProblemMessage(value: unknown, path: string, maximumBytes: number): string {
  const candidate = boundedString(value, path, maximumBytes);
  if ([...candidate].some((character) => character !== "\t" && /\p{Cc}/u.test(character))) {
    invalid(path, "a bounded message without control characters other than tab");
  }
  return candidate;
}

function boundedControlFreeString(value: unknown, path: string, maximumBytes: number): string {
  const candidate = boundedString(value, path, maximumBytes);
  if (/\p{Cc}/u.test(candidate)) {
    invalid(path, "a bounded string without control characters");
  }
  return candidate;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    invalid(
      path,
      `the required fields ${required.join(", ")} and optional fields ${optional.join(", ")}`,
    );
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid Node package scripts IPC value at ${path}: expected ${expectation}.`,
  );
}
