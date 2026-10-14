import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
  REMOTE_AGENT_THREAD_RESPOND_OUTCOMES,
  RemoteAgentThreadRequestNotSentError,
  type RemoteAgentThreadRequestGateway,
  type RemoteAgentThreadRequestResponse,
  type RemoteAgentThreadRequestTurn,
  type RemoteAgentThreadRequestsPage,
  type RemoteAgentThreadRequestsRequest,
  type RemoteAgentThreadRespondOutcome,
  type RemoteAgentThreadRespondRequest,
  type RemoteAgentThreadRespondResult,
} from "../application/remoteAgentThreadRequestPorts";
import { AGENT_APPROVAL_DECISIONS } from "../domain/agentApproval";
import {
  MAX_AGENT_QUESTIONS,
  MAX_AGENT_QUESTION_OPTIONS,
  MAX_AGENT_QUESTION_TEXT_BYTES,
  type AgentQuestionAnswer,
} from "../domain/agentQuestion";
import { parseAgentThreadRequests, type AgentThreadRequests } from "../domain/agentRuntimeRequest";

export const GET_REMOTE_AGENT_THREAD_REQUESTS_IPC_COMMAND =
  "get_remote_agent_thread_requests" as const;
export const RESPOND_REMOTE_AGENT_THREAD_REQUEST_IPC_COMMAND =
  "respond_remote_agent_thread_request" as const;
export const MAX_REMOTE_AGENT_THREAD_REQUESTS_CURSOR_CHARS = 256;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_BYTES = 128;

export type InvokeRemoteAgentThreadRequestCommand = (
  command: string,
  args: {
    readonly request: RemoteAgentThreadRequestsRequest | RemoteAgentThreadRespondRequest;
  },
) => Promise<unknown>;

export type RemoteAgentThreadRequestRuntimeDetector = () => boolean;

interface RequestBinding {
  readonly serverId: string;
  readonly threadId: string;
}

const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const THREAD_REQUESTS_FIELDS = ["serverId", "runnerId", "threadId", "turns", "cursor"] as const;
const RESPOND_FIELDS = [
  "serverId",
  "runnerId",
  "threadId",
  "turn",
  "requestId",
  "response",
] as const;
const TURN_FIELDS = ["turnId", "startedAtEpochMs", "interactionSequence", "terminal"] as const;
const ANSWER_FIELDS = ["questionId", "optionIds", "text"] as const;
const RESPONSE_KINDS = ["question", "approval"] as const;
const PAGE_FIELDS = ["message", "nextCursor"] as const;
const RESULT_FIELDS = ["outcome", "message"] as const;
const encoder = new TextEncoder();

const invokeRemoteAgentThreadRequestCommand: InvokeRemoteAgentThreadRequestCommand = (
  command,
  args,
) => invoke(command, args);

function invalid(): never {
  throw new Error("Invalid remote agent thread request payload.");
}

function unsupported(_value: never): never {
  return invalid();
}

function record<Field extends string>(
  value: unknown,
  fields: readonly Field[],
): Record<Field, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (Object.keys(value).length !== fields.length) return invalid();
  if (!fields.every((field) => Object.prototype.hasOwnProperty.call(value, field)))
    return invalid();
  return value as Record<Field, unknown>;
}

function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value as readonly unknown[];
}

function member<Member extends string>(value: unknown, members: readonly Member[]): Member {
  const match = members.find((candidate) => candidate === value);
  if (match === undefined) return invalid();
  return match;
}

function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return invalid();
  return value;
}

function distinct(values: readonly string[]): readonly string[] {
  if (new Set(values).size !== values.length) return invalid();
  return values;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

function nullable<Value>(value: unknown, parse: (present: unknown) => Value): Value | null {
  if (value === null) return null;
  return parse(value);
}

function runnerIdentity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return invalid();
  if (value.length > MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_BYTES) return invalid();
  if (CONTROL_PATTERN.test(value)) return invalid();
  if (encoder.encode(value).length > MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_BYTES)
    return invalid();
  return value;
}

function pageCursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_REMOTE_AGENT_THREAD_REQUESTS_CURSOR_CHARS)
    return invalid();
  return matching(value, CURSOR_PATTERN);
}

function turnDescriptor(value: unknown): RemoteAgentThreadRequestTurn {
  const item = record(value, TURN_FIELDS);
  return {
    turnId: matching(item.turnId, UUID_PATTERN),
    startedAtEpochMs: integer(item.startedAtEpochMs),
    interactionSequence: nullable(item.interactionSequence, integer),
    terminal: flag(item.terminal),
  };
}

function turnDescriptors(value: unknown): readonly RemoteAgentThreadRequestTurn[] {
  const turns = list(value, MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS).map(turnDescriptor);
  distinct(turns.map((turn) => turn.turnId));
  return turns;
}

function answerText(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_AGENT_QUESTION_TEXT_BYTES) return invalid();
  if (encoder.encode(value).length > MAX_AGENT_QUESTION_TEXT_BYTES) return invalid();
  return value;
}

function questionAnswer(value: unknown): AgentQuestionAnswer {
  const item = record(value, ANSWER_FIELDS);
  const optionIds = distinct(
    list(item.optionIds, MAX_AGENT_QUESTION_OPTIONS).map((optionId) =>
      matching(optionId, ID_PATTERN),
    ),
  );
  const text = answerText(item.text);
  if (optionIds.length === 0 && text.trim().length === 0) return invalid();
  return { questionId: matching(item.questionId, ID_PATTERN), optionIds, text };
}

function questionAnswers(value: unknown): readonly AgentQuestionAnswer[] {
  const answers = list(value, MAX_AGENT_QUESTIONS).map(questionAnswer);
  if (answers.length === 0) return invalid();
  distinct(answers.map((answer) => answer.questionId));
  return answers;
}

function requestResponse(value: unknown): RemoteAgentThreadRequestResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const kind = member((value as { readonly kind?: unknown }).kind, RESPONSE_KINDS);
  switch (kind) {
    case "question":
      return { kind, answers: questionAnswers(record(value, ["kind", "answers"]).answers) };
    case "approval":
      return {
        kind,
        decision: member(record(value, ["kind", "decision"]).decision, AGENT_APPROVAL_DECISIONS),
      };
    default:
      return unsupported(kind);
  }
}

function threadRequestsRequest(value: unknown): RemoteAgentThreadRequestsRequest {
  const item = record(value, THREAD_REQUESTS_FIELDS);
  return {
    serverId: matching(item.serverId, SERVER_ID_PATTERN),
    runnerId: runnerIdentity(item.runnerId),
    threadId: matching(item.threadId, UUID_PATTERN),
    turns: turnDescriptors(item.turns),
    cursor: pageCursor(item.cursor),
  };
}

function respondRequest(value: unknown): RemoteAgentThreadRespondRequest {
  const item = record(value, RESPOND_FIELDS);
  return {
    serverId: matching(item.serverId, SERVER_ID_PATTERN),
    runnerId: runnerIdentity(item.runnerId),
    threadId: matching(item.threadId, UUID_PATTERN),
    turn: turnDescriptor(item.turn),
    requestId: matching(item.requestId, UUID_PATTERN),
    response: requestResponse(item.response),
  };
}

function boundMessage(value: unknown, binding: RequestBinding): AgentThreadRequests {
  const message = parseAgentThreadRequests(value);
  if (message.threadId !== binding.threadId)
    throw new Error("Remote agent thread requests belong to another thread.");
  if (message.workspaceId !== binding.serverId)
    throw new Error("Remote agent thread requests belong to another server.");
  return message;
}

function parsePage(value: unknown, binding: RequestBinding): RemoteAgentThreadRequestsPage {
  const page = record(value, PAGE_FIELDS);
  return {
    message: boundMessage(page.message, binding),
    nextCursor: pageCursor(page.nextCursor),
  };
}

function respondResult(
  outcome: RemoteAgentThreadRespondOutcome,
  message: AgentThreadRequests | null,
): RemoteAgentThreadRespondResult {
  switch (outcome) {
    case "answered":
      if (message === null) return invalid();
      return { outcome, message };
    case "notAnswerable":
    case "deliveryUncertain":
      return { outcome, message };
    default:
      return unsupported(outcome);
  }
}

function parseResult(value: unknown, binding: RequestBinding): RemoteAgentThreadRespondResult {
  const result = record(value, RESULT_FIELDS);
  return respondResult(
    member(result.outcome, REMOTE_AGENT_THREAD_RESPOND_OUTCOMES),
    nullable(result.message, (message) => boundMessage(message, binding)),
  );
}

function failureMessage(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  return "Invalid remote agent thread request payload.";
}

function notSent<Outbound>(validate: () => Outbound): Outbound {
  try {
    return validate();
  } catch (failure) {
    throw new RemoteAgentThreadRequestNotSentError(failureMessage(failure));
  }
}

function runtimeUnavailable(): RemoteAgentThreadRequestNotSentError {
  return new RemoteAgentThreadRequestNotSentError(
    "Remote agent thread requests need the native runtime.",
  );
}

export class TauriRemoteAgentThreadRequestGateway implements RemoteAgentThreadRequestGateway {
  constructor(
    private readonly invokeCommand: InvokeRemoteAgentThreadRequestCommand = invokeRemoteAgentThreadRequestCommand,
    private readonly isRuntimeAvailable: RemoteAgentThreadRequestRuntimeDetector = isTauri,
  ) {}

  async threadRequests(
    request: RemoteAgentThreadRequestsRequest,
  ): Promise<RemoteAgentThreadRequestsPage> {
    const outbound = notSent(() => threadRequestsRequest(request));
    if (!this.isRuntimeAvailable()) throw runtimeUnavailable();
    return parsePage(
      await this.invokeCommand(GET_REMOTE_AGENT_THREAD_REQUESTS_IPC_COMMAND, { request: outbound }),
      outbound,
    );
  }

  async respond(request: RemoteAgentThreadRespondRequest): Promise<RemoteAgentThreadRespondResult> {
    const outbound = notSent(() => respondRequest(request));
    if (!this.isRuntimeAvailable()) throw runtimeUnavailable();
    return parseResult(
      await this.invokeCommand(RESPOND_REMOTE_AGENT_THREAD_REQUEST_IPC_COMMAND, {
        request: outbound,
      }),
      outbound,
    );
  }
}
