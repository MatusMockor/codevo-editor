import type {
  VscodeProcessTaskDiagnostic,
  VscodeProcessTaskDisplay,
  VscodeProcessTaskEvent,
  VscodeProcessTaskOwner,
  VscodeProcessTasksSnapshot,
} from "../domain/vscodeProcessTasks";
import { vscodeProcessTaskOwnersEqual } from "../domain/vscodeProcessTasks";
import { vscodeProcessTaskDependencyPlan } from "../domain/vscodeProcessTaskDependencyPlan";

export const DISCOVER_VSCODE_PROCESS_TASKS_IPC_COMMAND =
  "workspace_discover_vscode_process_tasks" as const;
export const START_VSCODE_PROCESS_TASK_IPC_COMMAND = "workspace_start_vscode_process_task" as const;
export const ACKNOWLEDGE_VSCODE_PROCESS_TASK_START_IPC_COMMAND =
  "workspace_acknowledge_vscode_process_task_start" as const;
export const STOP_VSCODE_PROCESS_TASK_IPC_COMMAND = "workspace_stop_vscode_process_task" as const;
export const VSCODE_PROCESS_TASK_EVENT = "vscode-process-task://event" as const;

export const MAX_VSCODE_PROCESS_TASKS = 128;
export const MAX_VSCODE_PROCESS_TASK_DEPENDENCIES = 32;
export const MAX_VSCODE_PROCESS_TASK_DEPENDENCY_EDGES = 512;
export const MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS = 256;
export const MAX_VSCODE_PROCESS_TASK_RESPONSE_BYTES = 1_048_576;
export const MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES = 8_192;
export const MAX_VSCODE_PROCESS_TASK_STEPS = 128;

export interface DiscoverVscodeProcessTasksRequest {
  readonly workspaceId: string;
}

export type StartVscodeProcessTaskRequest = VscodeProcessTaskOwner;
export type AcknowledgeVscodeProcessTaskStartRequest = VscodeProcessTaskOwner;
export type StopVscodeProcessTaskRequest = VscodeProcessTaskOwner;

export type InvokeVscodeProcessTaskCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const UTF8_ENCODER = new TextEncoder();

export async function invokeDiscoverVscodeProcessTasksIpc(
  invokeCommand: InvokeVscodeProcessTaskCommand,
  request: DiscoverVscodeProcessTasksRequest,
): Promise<VscodeProcessTasksSnapshot> {
  const validated = validateDiscoveryRequest(request);
  const value = await invokeCommand(DISCOVER_VSCODE_PROCESS_TASKS_IPC_COMMAND, {
    request: validated,
  });
  assertEncodedSize(value, "result", MAX_VSCODE_PROCESS_TASK_RESPONSE_BYTES);
  return parseVscodeProcessTasksSnapshot(value);
}

export async function invokeStartVscodeProcessTaskIpc(
  invokeCommand: InvokeVscodeProcessTaskCommand,
  request: StartVscodeProcessTaskRequest,
): Promise<VscodeProcessTaskOwner> {
  const validated = validateOwner(request, "request");
  const result = validateOwner(
    await invokeCommand(START_VSCODE_PROCESS_TASK_IPC_COMMAND, { request: validated }),
    "result",
  );
  if (!vscodeProcessTaskOwnersEqual(validated, result)) {
    invalid("result", "the exact requested task owner");
  }
  return result;
}

export async function invokeAcknowledgeVscodeProcessTaskStartIpc(
  invokeCommand: InvokeVscodeProcessTaskCommand,
  request: AcknowledgeVscodeProcessTaskStartRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    ACKNOWLEDGE_VSCODE_PROCESS_TASK_START_IPC_COMMAND,
    validateOwner(request, "request"),
  );
}

export async function invokeStopVscodeProcessTaskIpc(
  invokeCommand: InvokeVscodeProcessTaskCommand,
  request: StopVscodeProcessTaskRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    STOP_VSCODE_PROCESS_TASK_IPC_COMMAND,
    validateOwner(request, "request"),
  );
}

export function decodeVscodeProcessTaskEvent(value: unknown): VscodeProcessTaskEvent {
  const event = record(value, "event");
  if (event.kind === "output") return parseOutputEvent(event);
  if (event.kind === "step") return parseStepEvent(event);
  if (event.kind === "status") return parseStatusEvent(event);
  return invalid("event.kind", "output, step, or status");
}

export function parseVscodeProcessTasksSnapshot(value: unknown): VscodeProcessTasksSnapshot {
  const result = record(value, "result");
  exactKeys(result, ["configRevision", "tasks", "diagnostics", "truncated"], "result");
  if (!Array.isArray(result.tasks) || result.tasks.length > MAX_VSCODE_PROCESS_TASKS) {
    invalid("result.tasks", `an array of at most ${MAX_VSCODE_PROCESS_TASKS} tasks`);
  }
  if (
    !Array.isArray(result.diagnostics) ||
    result.diagnostics.length > MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS
  ) {
    invalid(
      "result.diagnostics",
      `an array of at most ${MAX_VSCODE_PROCESS_TASK_DIAGNOSTICS} diagnostics`,
    );
  }
  const tasks = result.tasks.map((task, index) => parseTask(task, `result.tasks[${index}]`));
  if (
    tasks.reduce((total, task) => total + task.dependsOn.length, 0) >
    MAX_VSCODE_PROCESS_TASK_DEPENDENCY_EDGES
  ) {
    invalid("result.tasks", `at most ${MAX_VSCODE_PROCESS_TASK_DEPENDENCY_EDGES} dependency edges`);
  }
  if (new Set(tasks.map(({ label }) => label)).size !== tasks.length) {
    invalid("result.tasks", "tasks with unique labels");
  }
  if (
    tasks.some(
      (task) => task.executable && vscodeProcessTaskDependencyPlan(tasks, task.label) === null,
    )
  ) {
    invalid("result.tasks", "executable tasks with valid sequential dependency plans");
  }
  const diagnostics = result.diagnostics.map((diagnostic, index) =>
    parseDiagnostic(diagnostic, `result.diagnostics[${index}]`),
  );
  return Object.freeze({
    configRevision: configRevision(result.configRevision, "result.configRevision"),
    tasks: Object.freeze(tasks),
    diagnostics: Object.freeze(diagnostics),
    truncated: strictBoolean(result.truncated, "result.truncated"),
  });
}

function parseTask(value: unknown, path: string): VscodeProcessTaskDisplay {
  const task = record(value, path);
  exactKeys(task, ["label", "detail", "group", "source", "executable", "dependsOn"], path);
  if (task.group !== "build" && task.group !== "test" && task.group !== "none") {
    invalid(`${path}.group`, "build, test, or none");
  }
  if (
    !Array.isArray(task.dependsOn) ||
    task.dependsOn.length > MAX_VSCODE_PROCESS_TASK_DEPENDENCIES
  ) {
    invalid(
      `${path}.dependsOn`,
      `an array of at most ${MAX_VSCODE_PROCESS_TASK_DEPENDENCIES} labels`,
    );
  }
  const dependsOn = task.dependsOn.map((dependency, index) =>
    label(dependency, `${path}.dependsOn[${index}]`),
  );
  if (new Set(dependsOn).size !== dependsOn.length) {
    invalid(`${path}.dependsOn`, "unique task labels");
  }
  return Object.freeze({
    label: label(task.label, `${path}.label`),
    detail: task.detail === null ? null : displayText(task.detail, `${path}.detail`, 2_048, true),
    group: task.group,
    source: displayText(task.source, `${path}.source`, 256, false),
    executable: strictBoolean(task.executable, `${path}.executable`),
    dependsOn: Object.freeze(dependsOn),
  });
}

function parseDiagnostic(value: unknown, path: string): VscodeProcessTaskDiagnostic {
  const diagnostic = record(value, path);
  exactKeys(diagnostic, ["severity", "message"], path);
  if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") {
    invalid(`${path}.severity`, "error or warning");
  }
  return Object.freeze({
    severity: diagnostic.severity,
    message: displayText(diagnostic.message, `${path}.message`, 4_096, false, true),
  });
}

function parseOutputEvent(event: Record<string, unknown>): VscodeProcessTaskEvent {
  exactKeys(event, ["kind", "owner", "sequence", "stream", "data", "truncated"], "event");
  if (event.stream !== "stdout" && event.stream !== "stderr") {
    invalid("event.stream", "stdout or stderr");
  }
  const truncated = strictBoolean(event.truncated, "event.truncated");
  const data = outputText(event.data, "event.data");
  if (truncated && data !== "") invalid("event.data", "an empty truncation marker");
  return Object.freeze({
    kind: "output",
    owner: validateOwner(event.owner, "event.owner"),
    sequence: eventSequence(event.sequence, "event.sequence"),
    stream: event.stream,
    data,
    truncated,
  });
}

function parseStepEvent(event: Record<string, unknown>): VscodeProcessTaskEvent {
  exactKeys(event, ["kind", "owner", "sequence", "label", "index", "total"], "event");
  const total = boundedStepNumber(event.total, "event.total");
  const index = boundedStepNumber(event.index, "event.index");
  if (index > total) invalid("event.index", "a step index no greater than total");
  return Object.freeze({
    kind: "step",
    owner: validateOwner(event.owner, "event.owner"),
    sequence: eventSequence(event.sequence, "event.sequence"),
    label: label(event.label, "event.label"),
    index,
    total,
  });
}

function parseStatusEvent(event: Record<string, unknown>): VscodeProcessTaskEvent {
  const status = event.status;
  if (status !== "running" && status !== "exited" && status !== "failed" && status !== "stopped") {
    invalid("event.status", "running, exited, failed, or stopped");
  }
  exactKeys(
    event,
    [
      "kind",
      "owner",
      "sequence",
      "status",
      ...(status === "exited" ? ["exitCode"] : status === "failed" ? ["message"] : []),
    ],
    "event",
  );
  const base = {
    kind: "status" as const,
    owner: validateOwner(event.owner, "event.owner"),
    sequence: eventSequence(event.sequence, "event.sequence"),
  };
  if (status === "exited") {
    return Object.freeze({
      ...base,
      status,
      exitCode: event.exitCode === null ? null : signedI32(event.exitCode, "event.exitCode"),
    });
  }
  if (status === "failed") {
    return Object.freeze({
      ...base,
      status,
      message: displayText(event.message, "event.message", 4_096, false, true),
    });
  }
  return Object.freeze({ ...base, status });
}

function validateDiscoveryRequest(value: unknown): DiscoverVscodeProcessTasksRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId"], "request");
  return Object.freeze({
    workspaceId: identifier(request.workspaceId, "request.workspaceId", 1_024),
  });
}

function validateOwner(value: unknown, path: string): VscodeProcessTaskOwner {
  const owner = record(value, path);
  exactKeys(owner, ["runId", "workspaceId", "sessionId", "label", "configRevision"], path);
  return Object.freeze({
    runId: runId(owner.runId, `${path}.runId`),
    workspaceId: identifier(owner.workspaceId, `${path}.workspaceId`, 1_024),
    sessionId: unsignedU32(owner.sessionId, `${path}.sessionId`),
    label: label(owner.label, `${path}.label`),
    configRevision: configRevision(owner.configRevision, `${path}.configRevision`),
  });
}

async function invokeUnit(
  invokeCommand: InvokeVscodeProcessTaskCommand,
  command: string,
  request: VscodeProcessTaskOwner,
): Promise<void> {
  const result = await invokeCommand(command, { request });
  if (result !== null) invalid("result", "null");
}

function label(value: unknown, path: string): string {
  return displayText(value, path, 256, false);
}

function configRevision(value: unknown, path: string): string {
  const candidate = identifier(value, path, 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate)) {
    invalid(path, "an exact lowercase SHA-256 revision");
  }
  return candidate;
}

function runId(value: unknown, path: string): string {
  const candidate = identifier(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate)) {
    invalid(path, "a bounded run id using letters, numbers, dot, underscore, colon, or dash");
  }
  return candidate;
}

function identifier(value: unknown, path: string, maximumBytes: number): string {
  return displayText(value, path, maximumBytes, false);
}

function displayText(
  value: unknown,
  path: string,
  maximumBytes: number,
  allowEmpty: boolean,
  allowTab = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim() === "") ||
    !isWellFormedUnicode(value) ||
    UTF8_ENCODER.encode(value).byteLength > maximumBytes ||
    [...value].some((character) => /\p{Cc}/u.test(character) && !(allowTab && character === "\t"))
  ) {
    invalid(path, `a well-formed control-free UTF-8 string of at most ${maximumBytes} bytes`);
  }
  return value;
}

function outputText(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES
  ) {
    invalid(
      path,
      `well-formed UTF-8 output of at most ${MAX_VSCODE_PROCESS_TASK_EVENT_OUTPUT_BYTES} bytes without NUL`,
    );
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function strictBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function unsignedU32(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) {
    invalid(path, "a non-negative u32 integer");
  }
  return value as number;
}

function eventSequence(value: unknown, path: string): number {
  const sequence = unsignedU32(value, path);
  if (sequence === 0) invalid(path, "a non-zero u32 sequence");
  return sequence;
}

function boundedStepNumber(value: unknown, path: string): number {
  const step = unsignedU32(value, path);
  if (step === 0 || step > MAX_VSCODE_PROCESS_TASK_STEPS) {
    invalid(path, `an integer from 1 through ${MAX_VSCODE_PROCESS_TASK_STEPS}`);
  }
  return step;
}

function signedI32(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < -0x8000_0000 ||
    (value as number) > 0x7fff_ffff
  ) {
    invalid(path, "a signed i32 integer");
  }
  return value as number;
}

function assertEncodedSize(value: unknown, path: string, maximumBytes: number): void {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || UTF8_ENCODER.encode(encoded).byteLength > maximumBytes) {
      invalid(path, `a response of at most ${maximumBytes} encoded bytes`);
    }
  } catch {
    invalid(path, `a serializable response of at most ${maximumBytes} encoded bytes`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
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

function invalid(path: string, expected: string): never {
  throw new TypeError(`Invalid VS Code process task value at ${path}: expected ${expected}.`);
}
