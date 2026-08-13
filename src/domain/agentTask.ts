export const MAX_AGENT_TASK_ID_BYTES = 64;
export const MAX_AGENT_TASK_WORKSPACE_ID_BYTES = 1_024;
export const MAX_AGENT_TASK_PATH_BYTES = 4_096;
export const MAX_AGENT_TASK_PROMPT_BYTES = 32 * 1_024;
export const MAX_AGENT_TASK_OUTPUT_CHUNK_BYTES = 8 * 1_024;
export const MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES = 256 * 1_024;
export const MAX_AGENT_TASK_FAILURE_BYTES = 4_096;
export const MAX_RETAINED_AGENT_TASKS = 32;

export const AGENT_TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export type AgentTaskIsolation = "worktree" | "in-place";
export type AgentCliKind = "claudeCode" | "codex";
export type AgentTaskOutputStream = "stdout" | "stderr";

export interface AgentTaskOwner {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly repositoryRoot: string;
}

export type AgentTaskStatus =
  | { readonly kind: "pending" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" };

export interface AgentTaskRecord {
  readonly owner: AgentTaskOwner;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly prompt: string;
  readonly status: AgentTaskStatus;
  readonly outputTail: string;
  readonly outputTruncated: boolean;
  readonly lastStatusSequence: number;
  readonly lastOutputSequence: number;
  readonly startedAtEpochMs: number;
}

export type AgentTaskStatusEvent = AgentTaskOwner & {
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly sequence: number;
  readonly status: AgentTaskStatus;
};

export interface AgentTaskOutputEvent {
  readonly taskId: string;
  readonly sequence: number;
  readonly stream: AgentTaskOutputStream;
  readonly chunk: string;
  readonly truncated: boolean;
}

export interface StartAgentTaskRequest {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly repositoryRoot: string;
  readonly cwd: string;
  readonly isolation: AgentTaskIsolation;
  readonly prompt: string;
  readonly agentCliPath: string;
  readonly agentCliKind: AgentCliKind;
}

export interface StartAgentTaskResult {
  readonly taskId: string;
}

export interface AgentTaskReferenceRequest {
  readonly taskId: string;
  readonly workspaceId: string;
}

export interface StopAgentTasksForRootRequest {
  readonly workspaceId: string;
  readonly repositoryRoot: string;
}

export interface AgentTaskGateway {
  startAgentTask(request: StartAgentTaskRequest): Promise<StartAgentTaskResult>;
  acknowledgeAgentTaskStart(request: AgentTaskReferenceRequest): Promise<void>;
  stopAgentTask(request: AgentTaskReferenceRequest): Promise<void>;
  stopAgentTasksForRoot(request: StopAgentTasksForRootRequest): Promise<void>;
  subscribeAgentTaskStatus(handler: (event: AgentTaskStatusEvent) => void): Promise<() => void>;
  subscribeAgentTaskOutput(handler: (event: AgentTaskOutputEvent) => void): Promise<() => void>;
}

export type AgentTasksAction =
  | { readonly kind: "started"; readonly record: AgentTaskRecord }
  | { readonly kind: "statusEvent"; readonly event: AgentTaskStatusEvent }
  | { readonly kind: "outputEvent"; readonly event: AgentTaskOutputEvent }
  | { readonly kind: "dismissed"; readonly taskId: string }
  | { readonly kind: "workspaceReplaced"; readonly workspaceId: string }
  | { readonly kind: "projectReleased"; readonly ownerId: string };

export interface AgentTasksState {
  readonly tasks: ReadonlyMap<string, AgentTaskRecord>;
}

export type AgentIsolationPolicy = "auto" | "worktree" | "in-place";

export interface AgentTaskIsolationContext {
  readonly workspacePolicy: AgentIsolationPolicy;
  readonly repositoryStatusKnown: boolean;
  readonly repositoryDirty: boolean;
  readonly dirtyEditorDocumentsInRepository: number;
  readonly liveAgentTasksInRepository: number;
  readonly plannedParallelDispatch: boolean;
}

export type AgentIsolationReason =
  | "policy"
  | "agent-active"
  | "parallel-dispatch"
  | "status-unknown"
  | "dirty-tree"
  | "dirty-editors";

export type AgentIsolationDefault =
  | { readonly kind: "in-place" }
  | { readonly kind: "worktree"; readonly reason: AgentIsolationReason };

export type InPlaceDispatchUnsafeReason =
  "agent-active" | "dirty-tree" | "dirty-editors" | "status-unknown";

export type InPlaceDispatchGuard =
  | { readonly kind: "safe" }
  | { readonly kind: "unsafe"; readonly reasons: ReadonlyArray<InPlaceDispatchUnsafeReason> };

export interface AgentTaskOutputTailClip {
  readonly text: string;
  readonly clipped: boolean;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_MARKER = 0b1000_0000;

export function emptyAgentTasksState(): AgentTasksState {
  return { tasks: new Map() };
}

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  switch (status.kind) {
    case "pending":
    case "running":
      return false;
    case "exited":
    case "failed":
    case "stopped":
      return true;
    default:
      return unsupportedStatus(status);
  }
}

export function mintAgentTaskId(nowEpochMs: number, entropyHex4: string): string {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    invalid("mintAgentTaskId.nowEpochMs", "a non-negative safe integer");
  }
  if (!/^[0-9a-f]{4}$/.test(entropyHex4)) {
    invalid("mintAgentTaskId.entropyHex4", "exactly four lowercase hexadecimal digits");
  }
  const taskId = `agt-${nowEpochMs.toString(36)}-${entropyHex4}`;
  if (!AGENT_TASK_ID_PATTERN.test(taskId)) {
    invalid("mintAgentTaskId", "a task id within the safe agent task id pattern");
  }
  return taskId;
}

export function clipAgentTaskOutputTail(text: string): AgentTaskOutputTailClip {
  const bytes = UTF8_ENCODER.encode(text);
  if (bytes.byteLength <= MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES) {
    return { text, clipped: false };
  }
  let start = bytes.byteLength - MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES;
  while (
    start < bytes.byteLength &&
    (bytes[start] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_MARKER
  ) {
    start += 1;
  }
  return { text: UTF8_DECODER.decode(bytes.subarray(start)), clipped: true };
}

export function agentTasksReducer(
  state: AgentTasksState,
  action: AgentTasksAction,
): AgentTasksState {
  switch (action.kind) {
    case "started":
      return startAgentTask(state, action.record);
    case "statusEvent":
      return applyAgentTaskStatusEvent(state, action.event);
    case "outputEvent":
      return applyAgentTaskOutputEvent(state, action.event);
    case "dismissed":
      return dismissAgentTask(state, action.taskId);
    case "workspaceReplaced":
      return retainWorkspaceAgentTasks(state, action.workspaceId);
    case "projectReleased":
      return releaseProjectAgentTasks(state, action.ownerId);
    default:
      return unsupportedAction(action);
  }
}

export function defaultAgentTaskIsolation(
  context: AgentTaskIsolationContext,
): AgentIsolationDefault {
  if (context.workspacePolicy === "worktree") return { kind: "worktree", reason: "policy" };
  if (context.liveAgentTasksInRepository > 0) return { kind: "worktree", reason: "agent-active" };
  if (context.plannedParallelDispatch) return { kind: "worktree", reason: "parallel-dispatch" };
  if (context.workspacePolicy === "in-place") return { kind: "in-place" };
  if (!context.repositoryStatusKnown) return { kind: "worktree", reason: "status-unknown" };
  if (context.repositoryDirty) return { kind: "worktree", reason: "dirty-tree" };
  if (context.dirtyEditorDocumentsInRepository > 0) {
    return { kind: "worktree", reason: "dirty-editors" };
  }
  return { kind: "in-place" };
}

export function inPlaceDispatchGuard(context: AgentTaskIsolationContext): InPlaceDispatchGuard {
  const reasons: InPlaceDispatchUnsafeReason[] = [];
  if (context.liveAgentTasksInRepository > 0) reasons.push("agent-active");
  if (context.repositoryStatusKnown && context.repositoryDirty) reasons.push("dirty-tree");
  if (context.dirtyEditorDocumentsInRepository > 0) reasons.push("dirty-editors");
  if (!context.repositoryStatusKnown) reasons.push("status-unknown");
  if (reasons.length === 0) return { kind: "safe" };
  return { kind: "unsafe", reasons };
}

export function parseAgentTaskStatusEvent(value: unknown): AgentTaskStatusEvent {
  const event = record(value, "event");
  const status = parseAgentTaskStatus(event, "event");
  const isolation = agentTaskIsolation(event.isolation, "event.isolation");
  return {
    taskId: agentTaskId(event.taskId, "event.taskId"),
    workspaceId: agentWorkspaceId(event.workspaceId, "event.workspaceId"),
    repositoryRoot: agentPath(event.repositoryRoot, "event.repositoryRoot"),
    isolation,
    worktreePath: worktreePath(event.worktreePath, isolation, "event.worktreePath"),
    sequence: unsignedSafeInteger(event.sequence, "event.sequence"),
    status,
  };
}

export function parseAgentTaskOutputEvent(value: unknown): AgentTaskOutputEvent {
  const event = record(value, "event");
  exactKeys(event, ["taskId", "sequence", "stream", "chunk", "truncated"], "event");
  return {
    taskId: agentTaskId(event.taskId, "event.taskId"),
    sequence: unsignedSafeInteger(event.sequence, "event.sequence"),
    stream: outputStream(event.stream, "event.stream"),
    chunk: boundedText(event.chunk, "event.chunk", MAX_AGENT_TASK_OUTPUT_CHUNK_BYTES, true),
    truncated: booleanFlag(event.truncated, "event.truncated"),
  };
}

export function parseStartAgentTaskResult(value: unknown): StartAgentTaskResult {
  const result = record(value, "result");
  exactKeys(result, ["taskId"], "result");
  return { taskId: agentTaskId(result.taskId, "result.taskId") };
}

export function validateStartAgentTaskRequest(value: unknown): StartAgentTaskRequest {
  const request = record(value, "request");
  exactKeys(
    request,
    [
      "taskId",
      "workspaceId",
      "repositoryRoot",
      "cwd",
      "isolation",
      "prompt",
      "agentCliPath",
      "agentCliKind",
    ],
    "request",
  );
  const isolation = agentTaskIsolation(request.isolation, "request.isolation");
  const repositoryRoot = agentPath(request.repositoryRoot, "request.repositoryRoot");
  const cwd = agentPath(request.cwd, "request.cwd");
  if (isolation === "in-place" && cwd !== repositoryRoot) {
    invalid("request.cwd", "the repository root for an in-place agent task");
  }
  return {
    taskId: agentTaskId(request.taskId, "request.taskId"),
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    repositoryRoot,
    cwd,
    isolation,
    prompt: boundedText(request.prompt, "request.prompt", MAX_AGENT_TASK_PROMPT_BYTES, false),
    agentCliPath: agentPath(request.agentCliPath, "request.agentCliPath"),
    agentCliKind: agentCliKind(request.agentCliKind, "request.agentCliKind"),
  };
}

export function validateAgentTaskReferenceRequest(value: unknown): AgentTaskReferenceRequest {
  const request = record(value, "request");
  exactKeys(request, ["taskId", "workspaceId"], "request");
  return {
    taskId: agentTaskId(request.taskId, "request.taskId"),
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
  };
}

export function validateStopAgentTasksForRootRequest(value: unknown): StopAgentTasksForRootRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "repositoryRoot"], "request");
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    repositoryRoot: agentPath(request.repositoryRoot, "request.repositoryRoot"),
  };
}

function startAgentTask(state: AgentTasksState, task: AgentTaskRecord): AgentTasksState {
  if (state.tasks.has(task.owner.taskId)) return state;
  const tasks = new Map(state.tasks);
  tasks.set(task.owner.taskId, task);
  evictRetainedAgentTasks(tasks);
  return { tasks };
}

function applyAgentTaskStatusEvent(
  state: AgentTasksState,
  event: AgentTaskStatusEvent,
): AgentTasksState {
  const task = state.tasks.get(event.taskId);
  if (task === undefined) return state;
  if (event.workspaceId !== task.owner.workspaceId) return state;
  if (event.repositoryRoot !== task.owner.repositoryRoot) return state;
  if (event.isolation !== task.isolation) return state;
  if (task.worktreePath !== null && event.worktreePath !== task.worktreePath) return state;
  if (isTerminalAgentTaskStatus(task.status)) return state;
  if (event.sequence <= task.lastStatusSequence) return state;
  return replaceAgentTask(state, {
    ...task,
    worktreePath: event.worktreePath,
    status: event.status,
    lastStatusSequence: event.sequence,
  });
}

function applyAgentTaskOutputEvent(
  state: AgentTasksState,
  event: AgentTaskOutputEvent,
): AgentTasksState {
  const task = state.tasks.get(event.taskId);
  if (task === undefined) return state;
  if (isTerminalAgentTaskStatus(task.status)) return state;
  if (event.sequence <= task.lastOutputSequence) return state;
  const tail = clipAgentTaskOutputTail(task.outputTail + event.chunk);
  return replaceAgentTask(state, {
    ...task,
    outputTail: tail.text,
    outputTruncated: task.outputTruncated || event.truncated || tail.clipped,
    lastOutputSequence: event.sequence,
  });
}

function dismissAgentTask(state: AgentTasksState, taskId: string): AgentTasksState {
  if (!state.tasks.has(taskId)) return state;
  const tasks = new Map(state.tasks);
  tasks.delete(taskId);
  return { tasks };
}

function retainWorkspaceAgentTasks(state: AgentTasksState, workspaceId: string): AgentTasksState {
  const retained = new Map<string, AgentTaskRecord>();
  for (const [taskId, task] of state.tasks) {
    if (task.owner.workspaceId !== workspaceId && isTerminalAgentTaskStatus(task.status)) {
      continue;
    }
    retained.set(taskId, task);
  }
  if (retained.size === state.tasks.size) return state;
  return { tasks: retained };
}

function releaseProjectAgentTasks(state: AgentTasksState, ownerId: string): AgentTasksState {
  const retained = new Map<string, AgentTaskRecord>();
  for (const [taskId, task] of state.tasks) {
    if (task.owner.workspaceId === ownerId && isTerminalAgentTaskStatus(task.status)) {
      continue;
    }
    retained.set(taskId, task);
  }
  if (retained.size === state.tasks.size) return state;
  return { tasks: retained };
}

function replaceAgentTask(state: AgentTasksState, task: AgentTaskRecord): AgentTasksState {
  const tasks = new Map(state.tasks);
  tasks.set(task.owner.taskId, task);
  return { tasks };
}

function evictRetainedAgentTasks(tasks: Map<string, AgentTaskRecord>): void {
  if (tasks.size <= MAX_RETAINED_AGENT_TASKS) return;
  const evictable = [...tasks.values()]
    .filter((task) => isTerminalAgentTaskStatus(task.status))
    .sort(compareEvictionOrder);
  for (const task of evictable) {
    if (tasks.size <= MAX_RETAINED_AGENT_TASKS) return;
    tasks.delete(task.owner.taskId);
  }
}

function compareEvictionOrder(left: AgentTaskRecord, right: AgentTaskRecord): number {
  if (left.startedAtEpochMs !== right.startedAtEpochMs) {
    return left.startedAtEpochMs - right.startedAtEpochMs;
  }
  if (left.owner.taskId < right.owner.taskId) return -1;
  if (left.owner.taskId > right.owner.taskId) return 1;
  return 0;
}

function parseAgentTaskStatus(event: Record<string, unknown>, path: string): AgentTaskStatus {
  const kind = statusKind(event.status, `${path}.status`);
  const ownerKeys = ["taskId", "workspaceId", "repositoryRoot", "isolation", "worktreePath"];
  switch (kind) {
    case "exited":
      exactKeys(event, [...ownerKeys, "sequence", "status", "exitCode"], path);
      return { kind, exitCode: signedExitCode(event.exitCode, `${path}.exitCode`) };
    case "failed":
      exactKeys(event, [...ownerKeys, "sequence", "status", "message"], path);
      return {
        kind,
        message: boundedText(event.message, `${path}.message`, MAX_AGENT_TASK_FAILURE_BYTES, false),
      };
    case "pending":
    case "running":
    case "stopped":
      exactKeys(event, [...ownerKeys, "sequence", "status"], path);
      return { kind };
    default:
      return unsupportedStatusKind(kind);
  }
}

function statusKind(value: unknown, path: string): AgentTaskStatus["kind"] {
  if (
    value !== "pending" &&
    value !== "running" &&
    value !== "exited" &&
    value !== "failed" &&
    value !== "stopped"
  ) {
    invalid(path, "pending, running, exited, failed, or stopped");
  }
  return value;
}

function agentTaskIsolation(value: unknown, path: string): AgentTaskIsolation {
  if (value !== "worktree" && value !== "in-place") invalid(path, "worktree or in-place");
  return value;
}

function agentCliKind(value: unknown, path: string): AgentCliKind {
  if (value !== "claudeCode" && value !== "codex") invalid(path, "claudeCode or codex");
  return value;
}

function outputStream(value: unknown, path: string): AgentTaskOutputStream {
  if (value !== "stdout" && value !== "stderr") invalid(path, "stdout or stderr");
  return value;
}

function worktreePath(value: unknown, isolation: AgentTaskIsolation, path: string): string | null {
  if (isolation === "in-place") {
    if (value !== null) invalid(path, "null for an in-place agent task");
    return null;
  }
  return agentPath(value, path);
}

function agentPath(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_PATH_BYTES, false);
  if (candidate.trim() === "") invalid(path, "a non-blank bounded path");
  return candidate;
}

function agentTaskId(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_ID_BYTES, false, true);
  if (!AGENT_TASK_ID_PATTERN.test(candidate)) invalid(path, "a safe agent task id");
  return candidate;
}

function agentWorkspaceId(value: unknown, path: string): string {
  return boundedText(value, path, MAX_AGENT_TASK_WORKSPACE_ID_BYTES, false, true);
}

function boundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  allowEmpty: boolean,
  rejectControls = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.includes("\0") ||
    (rejectControls && /\p{Cc}/u.test(value)) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, `${allowEmpty ? "a" : "a non-empty"} bounded UTF-8 string`);
  }
  return value;
}

function booleanFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function signedExitCode(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < -2_147_483_648 ||
    (value as number) > 2_147_483_647
  ) {
    invalid(path, "a signed 32-bit integer");
  }
  return value as number;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported agent task action: ${JSON.stringify(action)}.`);
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent task status: ${JSON.stringify(status)}.`);
}

function unsupportedStatusKind(kind: never): never {
  throw new TypeError(`Unsupported agent task status kind: ${String(kind)}.`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent task value at ${path}: expected ${expectation}.`);
}
