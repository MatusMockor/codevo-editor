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

export interface AgentThreadSessionGateway {
  interruptAgentTask(request: InterruptAgentTaskRequest): Promise<AgentTaskInterruptOutcome>;
  inspectAgentThreadSession(
    request: InspectAgentThreadSessionRequest,
  ): Promise<AgentSessionInspection>;
  endAgentThreadSession(request: AgentThreadSessionRequest): Promise<boolean>;
  subscribeAgentSessionEnded(handler: (event: AgentSessionEndedEvent) => void): Promise<() => void>;
  subscribeAgentSessionBackgroundTurn(
    handler: (event: AgentSessionBackgroundTurnEvent) => void,
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
