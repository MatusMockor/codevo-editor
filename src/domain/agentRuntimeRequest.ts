import { MAX_AGENT_TOOL_ID_BYTES } from "@codevo/agent-events";
import {
  parseAgentApprovalDecision,
  parseAgentApprovalRequest,
  type AgentApprovalDecision,
  type AgentApprovalFact,
  type AgentApprovalKind,
} from "./agentApproval";
import {
  parseAgentQuestionRequest,
  parseAgentQuestionResponse,
  type AgentQuestion,
  type AgentQuestionAnswer,
} from "./agentQuestion";
import type { AgentCliKind } from "./agentTask";

export const AGENT_RUNTIME_REQUEST_STATUSES = [
  "pending",
  "submitting",
  "resolved",
  "cancelled",
  "expired",
  "timedOut",
] as const;
export type AgentRuntimeRequestStatus = (typeof AGENT_RUNTIME_REQUEST_STATUSES)[number];

export const AGENT_RUNTIME_REQUEST_CLOSE_REASONS = [
  "turnEnded",
  "providerCancelled",
  "timedOut",
  "deliveryFailed",
  "appRestarted",
  "answerUnconfirmed",
  "runnerRestarted",
  "runnerStopped",
  "taskCancelled",
  "unknown",
] as const;
export type AgentRuntimeRequestCloseReason = (typeof AGENT_RUNTIME_REQUEST_CLOSE_REASONS)[number];

export const AGENT_RUNTIME_REQUEST_PROVIDERS = [
  "codex",
  "claudeCode",
] as const satisfies readonly AgentCliKind[];

export const AGENT_RUNTIME_REQUEST_BODY_KINDS = ["question", "approval"] as const;
export type AgentRuntimeRequestBodyKind = (typeof AGENT_RUNTIME_REQUEST_BODY_KINDS)[number];

export const AGENT_THREAD_REQUESTS_JOURNALS = ["saved", "degraded"] as const;
export type AgentThreadRequestsJournal = (typeof AGENT_THREAD_REQUESTS_JOURNALS)[number];

export const MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE = 64;
export const MAX_AGENT_THREAD_REQUESTS_RETAINED = 256;
export const MAX_AGENT_THREAD_REQUEST_FENCES = 1024;

export const AGENT_RUNTIME_REQUEST_TRANSITIONS: Readonly<
  Record<AgentRuntimeRequestStatus, readonly AgentRuntimeRequestStatus[]>
> = {
  pending: ["submitting", "cancelled", "expired", "timedOut"],
  submitting: ["resolved", "pending", "expired"],
  resolved: [],
  cancelled: [],
  expired: [],
  timedOut: [],
};

export interface AgentRuntimeQuestionBody {
  readonly kind: "question";
  readonly questions: readonly AgentQuestion[];
}

export interface AgentRuntimeApprovalBody {
  readonly kind: "approval";
  readonly approvalKind: AgentApprovalKind;
  readonly title: string;
  readonly detail: string;
  readonly detailTruncated: boolean;
  readonly facts: readonly AgentApprovalFact[];
  readonly decisions: readonly AgentApprovalDecision[];
}

export type AgentRuntimeRequestBody = AgentRuntimeQuestionBody | AgentRuntimeApprovalBody;

export interface AgentRuntimeAnswersResolution {
  readonly kind: "answers";
  readonly answers: readonly AgentQuestionAnswer[];
}

export interface AgentRuntimeDecisionResolution {
  readonly kind: "decision";
  readonly decision: AgentApprovalDecision;
}

export type AgentRuntimeRequestResolution =
  AgentRuntimeAnswersResolution | AgentRuntimeDecisionResolution;

interface LiveCapability {
  readonly kind: "live";
}

interface NotResumableCapability<
  Reason extends AgentRuntimeRequestCloseReason = AgentRuntimeRequestCloseReason,
> {
  readonly kind: "notResumable";
  readonly reason: Reason;
}

export type AgentRuntimeRequestResponseCapability = LiveCapability | NotResumableCapability;

type RequestLifecycle<Resolution> =
  | {
      readonly status: "pending";
      readonly responseCapability: LiveCapability;
      readonly resolvedAtEpochMs: null;
      readonly resolution: null;
    }
  | {
      readonly status: "submitting";
      readonly responseCapability: NotResumableCapability;
      readonly resolvedAtEpochMs: null;
      readonly resolution: Resolution | null;
    }
  | {
      readonly status: "resolved";
      readonly responseCapability: NotResumableCapability;
      readonly resolvedAtEpochMs: number;
      readonly resolution: Resolution;
    }
  | {
      readonly status: "expired";
      readonly responseCapability: NotResumableCapability<"answerUnconfirmed">;
      readonly resolvedAtEpochMs: number;
      readonly resolution: Resolution | null;
    }
  | {
      readonly status: "expired";
      readonly responseCapability: NotResumableCapability<
        Exclude<AgentRuntimeRequestCloseReason, "answerUnconfirmed">
      >;
      readonly resolvedAtEpochMs: number;
      readonly resolution: null;
    }
  | {
      readonly status: "cancelled" | "timedOut";
      readonly responseCapability: NotResumableCapability;
      readonly resolvedAtEpochMs: number;
      readonly resolution: null;
    };

interface RequestIdentity {
  readonly id: string;
  readonly turnId: string;
  readonly provider: AgentCliKind;
}

interface RequestBase extends RequestIdentity {
  readonly createdAtEpochMs: number;
  readonly order: number;
  readonly version: number;
  readonly anchorToolId: string | null;
}

export type AgentRuntimeRequest = RequestBase &
  (
    | ({
        readonly body: AgentRuntimeQuestionBody;
      } & RequestLifecycle<AgentRuntimeAnswersResolution>)
    | ({
        readonly body: AgentRuntimeApprovalBody;
      } & RequestLifecycle<AgentRuntimeDecisionResolution>)
  );

export type PendingAgentRuntimeRequest = Extract<AgentRuntimeRequest, { status: "pending" }>;

export interface AgentRuntimeRequestFence {
  readonly turnId: string;
  readonly id: string;
  readonly version: number;
  readonly createdAtEpochMs: number;
}

export interface AgentThreadRequestsRetention {
  readonly fences: readonly AgentRuntimeRequestFence[];
  readonly forgottenThroughEpochMs: number | null;
}

interface AgentThreadRequestsSnapshot {
  readonly threadId: string;
  readonly epoch: string;
  readonly journal: AgentThreadRequestsJournal;
  readonly requests: readonly AgentRuntimeRequest[];
  readonly truncated: boolean;
  readonly unreadable: number;
}

export interface AgentThreadRequestsState extends AgentThreadRequestsSnapshot {
  readonly retention: AgentThreadRequestsRetention;
}

export interface AgentThreadRequests extends AgentThreadRequestsSnapshot {
  readonly workspaceId: string | null;
  readonly reset: boolean;
}

export type AgentThreadRequestsSource = "pull" | "push";

export interface AgentThreadRequestsMerge extends AgentThreadRequestsSnapshot {
  readonly reset: boolean;
  readonly source: AgentThreadRequestsSource;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const REQUEST_FIELDS = [
  "id",
  "turnId",
  "provider",
  "createdAtEpochMs",
  "resolvedAtEpochMs",
  "order",
  "version",
  "anchorToolId",
  "body",
  "status",
  "responseCapability",
  "resolution",
] as const;
const APPROVAL_BODY_FIELDS = [
  "kind",
  "approvalKind",
  "title",
  "detail",
  "detailTruncated",
  "facts",
  "decisions",
] as const;
const THREAD_REQUESTS_FIELDS = [
  "workspaceId",
  "threadId",
  "epoch",
  "journal",
  "requests",
  "truncated",
  "unreadable",
  "reset",
] as const;
const encoder = new TextEncoder();

function invalid(): never {
  throw new Error("Invalid agent runtime request payload.");
}

function unsupported(_value: never): never {
  return invalid();
}

function plain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function record<Field extends string>(
  value: unknown,
  fields: readonly Field[],
): Record<Field, unknown> {
  const result = plain(value);
  if (Object.keys(result).length !== fields.length) return invalid();
  if (!fields.every((field) => Object.prototype.hasOwnProperty.call(result, field)))
    return invalid();
  return result;
}

function member<Member extends string>(value: unknown, members: readonly Member[]): Member {
  const match = members.find((candidate) => candidate === value);
  if (match === undefined) return invalid();
  return match;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return invalid();
  return value;
}

function integer(value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return invalid();
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

function absent(value: unknown): null {
  if (value !== null) return invalid();
  return null;
}

function nullable<Value>(value: unknown, parse: (present: unknown) => Value): Value | null {
  if (value === null) return null;
  return parse(value);
}

function toolId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return invalid();
  if (value.length > MAX_AGENT_TOOL_ID_BYTES || CONTROL_PATTERN.test(value)) return invalid();
  if (encoder.encode(value).length > MAX_AGENT_TOOL_ID_BYTES) return invalid();
  return value;
}

function liveCapability(value: unknown): LiveCapability {
  if (record(value, ["kind"]).kind !== "live") return invalid();
  return { kind: "live" };
}

function notResumableCapability(value: unknown): NotResumableCapability {
  const item = record(value, ["kind", "reason"]);
  if (item.kind !== "notResumable") return invalid();
  return {
    kind: "notResumable",
    reason: member(item.reason, AGENT_RUNTIME_REQUEST_CLOSE_REASONS),
  };
}

function questionBody(value: unknown, owner: RequestIdentity): AgentRuntimeQuestionBody {
  const item = record(value, ["kind", "questions"]);
  const { questions } = parseAgentQuestionRequest({
    id: owner.id,
    taskId: owner.turnId,
    provider: owner.provider,
    questions: item.questions,
    status: "pending",
  });
  return { kind: "question", questions };
}

function approvalBody(value: unknown, owner: RequestIdentity): AgentRuntimeApprovalBody {
  const item = record(value, APPROVAL_BODY_FIELDS);
  const request = parseAgentApprovalRequest({
    id: owner.id,
    taskId: owner.turnId,
    provider: owner.provider,
    kind: item.approvalKind,
    title: item.title,
    detail: item.detail,
    detailTruncated: item.detailTruncated,
    facts: item.facts,
    decisions: item.decisions,
    status: "pending",
  });
  return {
    kind: "approval",
    approvalKind: request.kind,
    title: request.title,
    detail: request.detail,
    detailTruncated: request.detailTruncated,
    facts: request.facts,
    decisions: request.decisions,
  };
}

function answersResolution(
  value: unknown,
  body: AgentRuntimeQuestionBody,
): AgentRuntimeAnswersResolution {
  const item = record(value, ["kind", "answers"]);
  if (item.kind !== "answers") return invalid();
  const { answers } = parseAgentQuestionResponse({ answers: item.answers }, body);
  return { kind: "answers", answers };
}

function decisionResolution(
  value: unknown,
  body: AgentRuntimeApprovalBody,
): AgentRuntimeDecisionResolution {
  const item = record(value, ["kind", "decision"]);
  if (item.kind !== "decision") return invalid();
  const decision = parseAgentApprovalDecision(item.decision);
  if (!body.decisions.includes(decision)) return invalid();
  return { kind: "decision", decision };
}

function expiredLifecycle<Resolution>(
  item: Record<(typeof REQUEST_FIELDS)[number], unknown>,
  resolve: (value: unknown) => Resolution,
): RequestLifecycle<Resolution> {
  const { reason } = notResumableCapability(item.responseCapability);
  const resolvedAtEpochMs = integer(item.resolvedAtEpochMs, 0);
  if (reason === "answerUnconfirmed") {
    return {
      status: "expired",
      responseCapability: { kind: "notResumable", reason },
      resolvedAtEpochMs,
      resolution: nullable(item.resolution, resolve),
    };
  }
  return {
    status: "expired",
    responseCapability: { kind: "notResumable", reason },
    resolvedAtEpochMs,
    resolution: absent(item.resolution),
  };
}

function lifecycle<Resolution>(
  item: Record<(typeof REQUEST_FIELDS)[number], unknown>,
  resolve: (value: unknown) => Resolution,
): RequestLifecycle<Resolution> {
  const status = member(item.status, AGENT_RUNTIME_REQUEST_STATUSES);
  switch (status) {
    case "pending":
      return {
        status,
        responseCapability: liveCapability(item.responseCapability),
        resolvedAtEpochMs: absent(item.resolvedAtEpochMs),
        resolution: absent(item.resolution),
      };
    case "submitting":
      return {
        status,
        responseCapability: notResumableCapability(item.responseCapability),
        resolvedAtEpochMs: absent(item.resolvedAtEpochMs),
        resolution: nullable(item.resolution, resolve),
      };
    case "resolved":
      return {
        status,
        responseCapability: notResumableCapability(item.responseCapability),
        resolvedAtEpochMs: integer(item.resolvedAtEpochMs, 0),
        resolution: resolve(item.resolution),
      };
    case "expired":
      return expiredLifecycle(item, resolve);
    case "cancelled":
    case "timedOut":
      return {
        status,
        responseCapability: notResumableCapability(item.responseCapability),
        resolvedAtEpochMs: integer(item.resolvedAtEpochMs, 0),
        resolution: absent(item.resolution),
      };
    default:
      return unsupported(status);
  }
}

export function parseAgentRuntimeRequest(value: unknown): AgentRuntimeRequest {
  const item = record(value, REQUEST_FIELDS);
  const base: RequestBase = {
    id: identifier(item.id),
    turnId: identifier(item.turnId),
    provider: member(item.provider, AGENT_RUNTIME_REQUEST_PROVIDERS),
    createdAtEpochMs: integer(item.createdAtEpochMs, 0),
    order: integer(item.order, 0),
    version: integer(item.version, 1),
    anchorToolId: nullable(item.anchorToolId, toolId),
  };
  const kind = member(plain(item.body).kind, AGENT_RUNTIME_REQUEST_BODY_KINDS);
  switch (kind) {
    case "question": {
      const body = questionBody(item.body, base);
      return { ...base, body, ...lifecycle(item, (sent) => answersResolution(sent, body)) };
    }
    case "approval": {
      const body = approvalBody(item.body, base);
      return { ...base, body, ...lifecycle(item, (sent) => decisionResolution(sent, body)) };
    }
    default:
      return unsupported(kind);
  }
}

function requestKey(request: Pick<AgentRuntimeRequest, "turnId" | "id">): string {
  return `${request.turnId}/${request.id}`;
}

export function parseAgentThreadRequests(value: unknown): AgentThreadRequests {
  const item = record(value, THREAD_REQUESTS_FIELDS);
  if (!Array.isArray(item.requests)) return invalid();
  if (item.requests.length > MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE) return invalid();
  const requests = (item.requests as readonly unknown[]).map((request) =>
    parseAgentRuntimeRequest(request),
  );
  if (new Set(requests.map(requestKey)).size !== requests.length) return invalid();
  return {
    workspaceId: nullable(item.workspaceId, identifier),
    threadId: identifier(item.threadId),
    epoch: identifier(item.epoch),
    journal: member(item.journal, AGENT_THREAD_REQUESTS_JOURNALS),
    requests,
    truncated: flag(item.truncated),
    unreadable: integer(item.unreadable, 0),
    reset: flag(item.reset),
  };
}

export function isAgentRuntimeRequestTransitionAllowed(
  from: AgentRuntimeRequestStatus,
  to: AgentRuntimeRequestStatus,
): boolean {
  return AGENT_RUNTIME_REQUEST_TRANSITIONS[from].includes(to);
}

function isOpen(request: AgentRuntimeRequest): boolean {
  return AGENT_RUNTIME_REQUEST_TRANSITIONS[request.status].length > 0;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ordered(requests: readonly AgentRuntimeRequest[]): readonly AgentRuntimeRequest[] {
  const turnStarts = new Map<string, number>();
  for (const request of requests) {
    const known = turnStarts.get(request.turnId) ?? request.createdAtEpochMs;
    turnStarts.set(request.turnId, Math.min(known, request.createdAtEpochMs));
  }
  return [...requests].sort((left, right) => {
    const leftStart = turnStarts.get(left.turnId) ?? left.createdAtEpochMs;
    const rightStart = turnStarts.get(right.turnId) ?? right.createdAtEpochMs;
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (left.turnId !== right.turnId) return compareText(left.turnId, right.turnId);
    if (left.order !== right.order) return left.order - right.order;
    return compareText(left.id, right.id);
  });
}

const NO_RETENTION: AgentThreadRequestsRetention = { fences: [], forgottenThroughEpochMs: null };

interface Partition {
  readonly kept: readonly AgentRuntimeRequest[];
  readonly dropped: readonly AgentRuntimeRequest[];
}

function partitioned(requests: readonly AgentRuntimeRequest[]): Partition {
  const sorted = ordered(requests);
  const excess = sorted.length - MAX_AGENT_THREAD_REQUESTS_RETAINED;
  if (excess <= 0) return { kept: sorted, dropped: [] };
  const closed = new Set(sorted.filter((request) => !isOpen(request)).slice(0, excess));
  const survivors = sorted.filter((request) => !closed.has(request));
  const overflow = survivors.length - MAX_AGENT_THREAD_REQUESTS_RETAINED;
  return {
    kept: ordered(survivors.slice(overflow)),
    dropped: [...closed, ...survivors.slice(0, overflow)],
  };
}

function sameItems<Item>(left: readonly Item[], right: readonly Item[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function fenceOf(request: AgentRuntimeRequest): AgentRuntimeRequestFence {
  return {
    turnId: request.turnId,
    id: request.id,
    version: request.version,
    createdAtEpochMs: request.createdAtEpochMs,
  };
}

function compareFences(left: AgentRuntimeRequestFence, right: AgentRuntimeRequestFence): number {
  if (left.createdAtEpochMs !== right.createdAtEpochMs)
    return left.createdAtEpochMs - right.createdAtEpochMs;
  if (left.turnId !== right.turnId) return compareText(left.turnId, right.turnId);
  return compareText(left.id, right.id);
}

function forgottenThrough(
  previous: number | null,
  latestForgotten: AgentRuntimeRequestFence | undefined,
): number | null {
  if (latestForgotten === undefined) return previous;
  return Math.max(previous ?? latestForgotten.createdAtEpochMs, latestForgotten.createdAtEpochMs);
}

function refenced(
  retention: AgentThreadRequestsRetention,
  fences: Map<string, AgentRuntimeRequestFence>,
  partition: Partition,
): AgentThreadRequestsRetention {
  for (const request of partition.kept) fences.delete(requestKey(request));
  for (const request of partition.dropped) fences.set(requestKey(request), fenceOf(request));
  const sorted = [...fences.values()].sort(compareFences);
  const overflow = Math.max(0, sorted.length - MAX_AGENT_THREAD_REQUEST_FENCES);
  const horizon = forgottenThrough(retention.forgottenThroughEpochMs, sorted[overflow - 1]);
  const kept = sorted.slice(overflow);
  if (horizon === retention.forgottenThroughEpochMs && sameItems(kept, retention.fences))
    return retention;
  return { fences: kept, forgottenThroughEpochMs: horizon };
}

function isBeyondForgottenFences(
  candidate: AgentRuntimeRequest,
  source: AgentThreadRequestsSource,
  forgottenThroughEpochMs: number | null,
): boolean {
  switch (source) {
    case "pull":
      return true;
    case "push":
      return (
        forgottenThroughEpochMs === null || candidate.createdAtEpochMs > forgottenThroughEpochMs
      );
    default:
      return unsupported(source);
  }
}

function isAdmissible(
  candidate: AgentRuntimeRequest,
  known: Pick<AgentRuntimeRequest, "version"> | undefined,
  source: AgentThreadRequestsSource,
  forgottenThroughEpochMs: number | null,
): boolean {
  if (known !== undefined) return candidate.version > known.version;
  if (!isOpen(candidate)) return true;
  return isBeyondForgottenFences(candidate, source, forgottenThroughEpochMs);
}

function blank(message: AgentThreadRequestsMerge): AgentThreadRequestsState {
  return {
    threadId: message.threadId,
    epoch: message.epoch,
    journal: message.journal,
    requests: [],
    truncated: false,
    unreadable: message.unreadable,
    retention: NO_RETENTION,
  };
}

function published(
  state: AgentThreadRequestsState,
  message: AgentThreadRequestsMerge,
  requests: readonly AgentRuntimeRequest[],
  retention: AgentThreadRequestsRetention,
  evicted: boolean,
): AgentThreadRequestsState {
  const truncated = state.truncated || message.truncated || evicted;
  if (
    requests === state.requests &&
    retention === state.retention &&
    truncated === state.truncated &&
    message.journal === state.journal &&
    message.unreadable === state.unreadable
  )
    return state;
  return {
    ...state,
    journal: message.journal,
    requests,
    truncated,
    unreadable: message.unreadable,
    retention,
  };
}

function applied(
  state: AgentThreadRequestsState,
  message: AgentThreadRequestsMerge,
): AgentThreadRequestsState {
  const displayed = new Map(state.requests.map((request) => [requestKey(request), request]));
  const fences = new Map(state.retention.fences.map((fence) => [requestKey(fence), fence]));
  const horizon = state.retention.forgottenThroughEpochMs;
  let admitted = false;
  for (const candidate of message.requests) {
    const key = requestKey(candidate);
    const known = displayed.get(key) ?? fences.get(key);
    if (!isAdmissible(candidate, known, message.source, horizon)) continue;
    displayed.set(key, candidate);
    admitted = true;
  }
  if (!admitted) return published(state, message, state.requests, state.retention, false);
  const partition = partitioned([...displayed.values()]);
  return published(
    state,
    message,
    sameItems(state.requests, partition.kept) ? state.requests : partition.kept,
    refenced(state.retention, fences, partition),
    partition.dropped.length > 0,
  );
}

export function mergeAgentThreadRequests(
  state: AgentThreadRequestsState | null,
  message: AgentThreadRequestsMerge,
): AgentThreadRequestsState {
  if (state === null) return applied(blank(message), message);
  if (state.threadId !== message.threadId) return state;
  if (message.reset || state.epoch !== message.epoch) return applied(blank(message), message);
  return applied(state, message);
}

function isPending(request: AgentRuntimeRequest): request is PendingAgentRuntimeRequest {
  return request.status === "pending";
}

export function pendingAgentRuntimeRequests(
  state: AgentThreadRequestsState | null,
): readonly PendingAgentRuntimeRequest[] {
  if (state === null) return [];
  return state.requests.filter(isPending);
}
