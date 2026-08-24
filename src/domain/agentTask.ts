export const MAX_AGENT_TASK_ID_BYTES = 64;
export const MAX_AGENT_TASK_WORKSPACE_ID_BYTES = 1_024;
export const MAX_AGENT_TASK_PATH_BYTES = 4_096;
export const MAX_AGENT_TASK_PROMPT_BYTES = 32 * 1_024;
export const MAX_AGENT_TASK_OUTPUT_CHUNK_BYTES = 8 * 1_024;
export const MAX_AGENT_TASK_FAILURE_BYTES = 4_096;
export const MAX_AGENT_SESSION_ID_BYTES = 128;

export const AGENT_TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const AGENT_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

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
  readonly resumeSessionId: string | null;
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

const UTF8_ENCODER = new TextEncoder();

export class AgentTaskStartRejectedError extends Error {
  override readonly name = "AgentTaskStartRejectedError";

  constructor(message: string) {
    super(message);
  }
}

export function isDefiniteAgentTaskStartRejection(
  error: unknown,
): error is AgentTaskStartRejectedError {
  return error instanceof AgentTaskStartRejectedError;
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
      "resumeSessionId",
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
    resumeSessionId: optionalAgentSessionId(request.resumeSessionId, "request.resumeSessionId"),
  };
}

export function isAgentSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_AGENT_SESSION_ID_BYTES &&
    AGENT_SESSION_ID_PATTERN.test(value)
  );
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

function optionalAgentSessionId(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (!isAgentSessionId(value)) invalid(path, "null or a safe agent session id");
  return value;
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

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent task status: ${JSON.stringify(status)}.`);
}

function unsupportedStatusKind(kind: never): never {
  throw new TypeError(`Unsupported agent task status kind: ${String(kind)}.`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent task value at ${path}: expected ${expectation}.`);
}
