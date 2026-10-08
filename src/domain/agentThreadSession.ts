import type { AgentBackgroundTask } from "./agentBackgroundActivity";
import { parseAgentLaunchOptions, type AgentLaunchOptions } from "./agentLaunch";
import {
  agentTaskId,
  agentWorkspaceId,
  booleanFlag,
  exactKeys,
  failureMessageOf,
  invalid,
  isAgentSessionId,
  record,
} from "./agentTask";

export type { AgentSessionRestartPolicy } from "./agentTask";

export const AGENT_SESSION_ENDED_EVENT = "agent-session://ended" as const;
export const AGENT_SESSION_BACKGROUND_TURN_EVENT = "agent-session://background-turn" as const;
export const AGENT_SESSION_BACKGROUND_TASKS_EVENT = "agent-session://background-tasks" as const;
export const MAX_AGENT_SESSION_BACKGROUND_TASKS = 256;
export const MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS = 32;
const MAX_SESSION_BACKGROUND_TASK_ID_BYTES = 256;
const MAX_SESSION_BACKGROUND_TASK_DESCRIPTION_BYTES = 512;
const MAX_BACKGROUND_TASK_STOP_REASON_BYTES = 256;
export const AGENT_SESSION_RESTART_CONFIRMATION_PREFIX =
  "sessionRestartRequiresConfirmation:" as const;
export const AGENT_SESSION_RESTART_REFUSED_MESSAGE =
  "Claude was not restarted because it is running background tasks in this thread.";
export const MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES = 256 * 1_024;

export type AgentSessionEndReason =
  | "stopped"
  | "exited"
  | "crashed"
  | "protocolError"
  | "idleTimeout"
  | "evicted"
  | "restarted"
  | "released"
  | "trustRevoked"
  | "threadEnded"
  | "providerUpdated"
  | "shutdown"
  | "unownedActivity"
  | "interruptTimedOut"
  | "inputFailed";

const END_REASONS: ReadonlyArray<AgentSessionEndReason> = [
  "stopped",
  "exited",
  "crashed",
  "protocolError",
  "idleTimeout",
  "evicted",
  "restarted",
  "released",
  "trustRevoked",
  "threadEnded",
  "providerUpdated",
  "shutdown",
  "unownedActivity",
  "interruptTimedOut",
  "inputFailed",
];

export interface AgentSessionEndedEvent {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly reason: AgentSessionEndReason;
  readonly backgroundTasksLive: boolean;
}

export interface AgentSessionBackgroundTurnEvent {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly output: string;
  readonly truncated: boolean;
  readonly complete: boolean;
}

export type AgentSessionBackgroundReply = "none" | "inProgress";

const BACKGROUND_REPLIES: ReadonlyArray<AgentSessionBackgroundReply> = ["none", "inProgress"];

export interface AgentSessionBackgroundTasksEvent {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly total: number;
  readonly agents: number;
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly reply: AgentSessionBackgroundReply;
}

export type AgentTaskInterruptOutcomeKind =
  "interrupting" | "unsupported" | "unavailable" | "stopping";

export interface AgentTaskInterruptOutcome {
  readonly kind: AgentTaskInterruptOutcomeKind;
}

export type AgentSessionInspection =
  | { readonly kind: "none" }
  | { readonly kind: "reuse" | "restart"; readonly backgroundTasks: boolean };

export interface InterruptAgentTaskRequest {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface AgentThreadSessionRequest {
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface InspectAgentThreadSessionRequest extends AgentThreadSessionRequest {
  readonly resumeSessionId: string | null;
  readonly launch: AgentLaunchOptions;
}

export interface StopAgentBackgroundTaskRequest extends AgentThreadSessionRequest {
  readonly taskId: string;
}

export type AgentBackgroundTaskStopOutcome =
  | { readonly kind: "stopping" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "notLive" }
  | { readonly kind: "noSession" }
  | { readonly kind: "unavailable" };

export interface AgentThreadSessionGateway {
  interruptAgentTask(request: InterruptAgentTaskRequest): Promise<AgentTaskInterruptOutcome>;
  inspectAgentThreadSession(
    request: InspectAgentThreadSessionRequest,
  ): Promise<AgentSessionInspection>;
  endAgentThreadSession(request: AgentThreadSessionRequest): Promise<boolean>;
  stopAgentBackgroundTask(
    request: StopAgentBackgroundTaskRequest,
  ): Promise<AgentBackgroundTaskStopOutcome>;
  subscribeAgentSessionEnded(handler: (event: AgentSessionEndedEvent) => void): Promise<() => void>;
  subscribeAgentSessionBackgroundTurn(
    handler: (event: AgentSessionBackgroundTurnEvent) => void,
  ): Promise<() => void>;
  subscribeAgentSessionBackgroundTasks(
    handler: (event: AgentSessionBackgroundTasksEvent) => void,
  ): Promise<() => void>;
}

const UTF8_ENCODER = new TextEncoder();

export function validateInterruptAgentTaskRequest(value: unknown): InterruptAgentTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["taskId", "workspaceId", "threadId"], "request");
  return {
    taskId: agentTaskId(request.taskId, "request.taskId"),
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
  };
}

export function validateAgentThreadSessionRequest(value: unknown): AgentThreadSessionRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "threadId"], "request");
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
  };
}

export function validateStopAgentBackgroundTaskRequest(
  value: unknown,
): StopAgentBackgroundTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "threadId", "taskId"], "request");
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
    taskId: boundedSessionText(
      request.taskId,
      MAX_SESSION_BACKGROUND_TASK_ID_BYTES,
      "request.taskId",
    ),
  };
}

export function validateInspectAgentThreadSessionRequest(
  value: unknown,
): InspectAgentThreadSessionRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "threadId", "resumeSessionId", "launch"], "request");
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
    resumeSessionId: nullableSessionId(request.resumeSessionId, "request.resumeSessionId"),
    launch: parseAgentLaunchOptions(request.launch, "request.launch"),
  };
}

export function parseAgentTaskInterruptOutcome(value: unknown): AgentTaskInterruptOutcome {
  const outcome = record(value, "result");
  exactKeys(outcome, ["kind"], "result");
  switch (outcome.kind) {
    case "interrupting":
    case "unsupported":
    case "unavailable":
    case "stopping":
      return { kind: outcome.kind };
    default:
      return invalid("result.kind", "interrupting, unsupported, unavailable or stopping");
  }
}

export function parseAgentBackgroundTaskStopOutcome(
  value: unknown,
): AgentBackgroundTaskStopOutcome {
  const outcome = record(value, "result");
  if (outcome.kind === "refused") {
    exactKeys(outcome, ["kind", "reason"], "result");
    const reason = boundedSessionText(
      outcome.reason,
      MAX_BACKGROUND_TASK_STOP_REASON_BYTES,
      "result.reason",
    );
    return { kind: "refused", reason };
  }
  exactKeys(outcome, ["kind"], "result");
  switch (outcome.kind) {
    case "stopping":
    case "unconfirmed":
    case "notLive":
    case "noSession":
    case "unavailable":
      return { kind: outcome.kind };
    default:
      return invalid(
        "result.kind",
        "stopping, refused, unconfirmed, notLive, noSession or unavailable",
      );
  }
}

export function parseAgentSessionInspection(value: unknown): AgentSessionInspection {
  const inspection = record(value, "result");
  if (inspection.kind === "none") {
    exactKeys(inspection, ["kind"], "result");
    return { kind: "none" };
  }
  exactKeys(inspection, ["kind", "backgroundTasks"], "result");
  const backgroundTasks = booleanFlag(inspection.backgroundTasks, "result.backgroundTasks");
  if (inspection.kind === "reuse") return { kind: "reuse", backgroundTasks };
  if (inspection.kind === "restart") return { kind: "restart", backgroundTasks };
  return invalid("result.kind", "none, reuse or restart");
}

export function parseEndAgentThreadSessionResult(value: unknown): boolean {
  const result = record(value, "result");
  exactKeys(result, ["ended"], "result");
  return booleanFlag(result.ended, "result.ended");
}

export function parseAgentSessionEndedEvent(value: unknown): AgentSessionEndedEvent {
  const event = record(value, "event");
  exactKeys(event, ["workspaceId", "threadId", "reason", "backgroundTasksLive"], "event");
  return {
    workspaceId: agentWorkspaceId(event.workspaceId, "event.workspaceId"),
    threadId: agentTaskId(event.threadId, "event.threadId"),
    reason: sessionEndReason(event.reason, "event.reason"),
    backgroundTasksLive: booleanFlag(event.backgroundTasksLive, "event.backgroundTasksLive"),
  };
}

export function parseAgentSessionBackgroundTurnEvent(
  value: unknown,
): AgentSessionBackgroundTurnEvent {
  const event = record(value, "event");
  exactKeys(event, ["workspaceId", "threadId", "output", "truncated", "complete"], "event");
  return {
    workspaceId: agentWorkspaceId(event.workspaceId, "event.workspaceId"),
    threadId: agentTaskId(event.threadId, "event.threadId"),
    output: backgroundTurnOutput(event.output, "event.output"),
    truncated: booleanFlag(event.truncated, "event.truncated"),
    complete: booleanFlag(event.complete, "event.complete"),
  };
}

export function parseAgentSessionBackgroundTasksEvent(
  value: unknown,
): AgentSessionBackgroundTasksEvent {
  const event = record(value, "event");
  exactKeys(event, ["workspaceId", "threadId", "total", "agents", "tasks", "reply"], "event");
  const total = boundedCount(event.total, MAX_AGENT_SESSION_BACKGROUND_TASKS, "event.total");
  const agents = boundedCount(event.agents, total, "event.agents");
  const tasks = backgroundTasks(event.tasks, total, "event.tasks");
  if (total > 0 && tasks.length === 0) return invalid("event.tasks", "the live tasks it counts");
  return {
    workspaceId: agentWorkspaceId(event.workspaceId, "event.workspaceId"),
    threadId: agentTaskId(event.threadId, "event.threadId"),
    total,
    agents,
    tasks,
    reply: backgroundReply(event.reply, "event.reply"),
  };
}

export function isAgentSessionRestartConfirmationError(error: unknown): boolean {
  return failureMessageOf(error).startsWith(AGENT_SESSION_RESTART_CONFIRMATION_PREFIX);
}

export function agentSessionEndedNotice(event: AgentSessionEndedEvent): string | null {
  if (!event.backgroundTasksLive) return null;
  const cause = sessionEndCause(event.reason);
  if (cause === null) return null;
  return `${cause} while background tasks were still running in this thread; Claude can no longer report on them.`;
}

function nullableSessionId(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (!isAgentSessionId(value)) return invalid(path, "null or an agent session id");
  return value;
}

function sessionEndReason(value: unknown, path: string): AgentSessionEndReason {
  const reason = END_REASONS.find((known) => known === value);
  if (reason === undefined) return invalid(path, "a known session end reason");
  return reason;
}

function backgroundReply(value: unknown, path: string): AgentSessionBackgroundReply {
  const reply = BACKGROUND_REPLIES.find((known) => known === value);
  if (reply === undefined) return invalid(path, '"none" or "inProgress"');
  return reply;
}

function backgroundTurnOutput(value: unknown, path: string): string {
  const expectation = `a string of at most ${MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES} UTF-8 bytes without NUL`;
  if (typeof value !== "string") return invalid(path, expectation);
  if (value.length > MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES) {
    return invalid(path, expectation);
  }
  if (value.includes("\0")) return invalid(path, expectation);
  if (UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_SESSION_BACKGROUND_TURN_OUTPUT_BYTES) {
    return invalid(path, expectation);
  }
  return value;
}

function boundedCount(value: unknown, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    return invalid(path, `an integer from 0 to ${max}`);
  }
  return value;
}

function backgroundTasks(
  value: unknown,
  total: number,
  path: string,
): ReadonlyArray<AgentBackgroundTask> {
  const limit = Math.min(total, MAX_AGENT_SESSION_REPORTED_BACKGROUND_TASKS);
  if (!Array.isArray(value) || value.length > limit) {
    return invalid(path, `at most ${limit} live tasks`);
  }
  const tasks = value.map((entry, index) => backgroundTask(entry, `${path}[${index}]`));
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) {
    return invalid(path, "unique task ids");
  }
  return tasks;
}

function backgroundTask(value: unknown, path: string): AgentBackgroundTask {
  const task = record(value, path);
  const keys =
    task.description === undefined ? ["taskId", "taskType"] : ["taskId", "taskType", "description"];
  exactKeys(task, keys, path);
  const taskId = boundedSessionText(
    task.taskId,
    MAX_SESSION_BACKGROUND_TASK_ID_BYTES,
    `${path}.taskId`,
  );
  const taskType = backgroundTaskType(task.taskType, `${path}.taskType`);
  if (task.description === undefined) return { taskId, taskType };
  const description = boundedSessionText(
    task.description,
    MAX_SESSION_BACKGROUND_TASK_DESCRIPTION_BYTES,
    `${path}.description`,
  );
  return { taskId, taskType, description };
}

function backgroundTaskType(value: unknown, path: string): AgentBackgroundTask["taskType"] {
  switch (value) {
    case "agent":
    case "shell":
    case "monitor":
    case "other":
      return value;
    default:
      return invalid(path, "agent, shell, monitor or other");
  }
}

function boundedSessionText(value: unknown, maxBytes: number, path: string): string {
  const expectation = `non-empty text of at most ${maxBytes} UTF-8 bytes without control characters`;
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes) {
    return invalid(path, expectation);
  }
  if (/\p{Cc}/u.test(value) || UTF8_ENCODER.encode(value).byteLength > maxBytes) {
    return invalid(path, expectation);
  }
  return value;
}

function sessionEndCause(reason: AgentSessionEndReason): string | null {
  switch (reason) {
    case "stopped":
    case "threadEnded":
    case "restarted":
    case "released":
    case "shutdown":
      return null;
    case "exited":
      return "Claude exited";
    case "crashed":
      return "Claude stopped unexpectedly";
    case "protocolError":
      return "Claude sent a message Codevo could not accept";
    case "idleTimeout":
      return "The Claude session was idle too long";
    case "evicted":
      return "Too many Claude sessions were open";
    case "providerUpdated":
      return "Claude was updated";
    case "trustRevoked":
      return "Trust in this project was revoked";
    case "unownedActivity":
      return "Claude started work on its own";
    case "interruptTimedOut":
      return "Claude did not stop the current step in time";
    case "inputFailed":
      return "Codevo could not deliver your message to Claude";
    default:
      return unsupportedReason(reason);
  }
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported session end reason: ${String(reason)}.`);
}
