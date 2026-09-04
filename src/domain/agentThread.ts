import type { AgentLaunchOptions } from "./agentLaunch";
import {
  isAgentSessionId,
  isTerminalAgentTaskStatus,
  type AgentCliKind,
  type AgentTaskIsolation,
  type AgentTaskOutputStream,
  type AgentTaskStatus,
  type AgentTaskStatusEvent,
} from "./agentTask";
import type { GitIntegrationMode } from "./gitIntegration";
import type { ExternalAgentSessionHistory } from "./externalAgentSession";
import { MAX_AGENT_EVENT_TEXT_BYTES, MAX_AGENT_THREAD_TITLE_BYTES } from "./agentThreadLimits";

export { AGENT_SESSION_ID_PATTERN, MAX_AGENT_SESSION_ID_BYTES } from "./agentTask";
export { parseAgentThread, serializeAgentThread } from "./agentThreadWire";
export { MAX_AGENT_EVENT_TEXT_BYTES, MAX_AGENT_THREAD_TITLE_BYTES } from "./agentThreadLimits";

export const MAX_AGENT_THREADS_PER_ROOT = 64;
export const MAX_AGENT_TURNS_PER_THREAD = 64;
export const MAX_AGENT_EVENTS_PER_TURN = 512;
export const MAX_AGENT_EVENT_BYTES_PER_TURN = 512 * 1_024;
export const MAX_AGENT_TOOL_SUMMARY_BYTES = 512;
export const MAX_AGENT_TOOL_ID_BYTES = 256;
export const MAX_AGENT_TOOL_NAME_BYTES = 256;
export const MAX_AGENT_THREAD_TITLE_CHARS = 200;
export const AGENT_THREAD_SCHEMA_VERSION = 1;
export const UNTITLED_AGENT_THREAD_TITLE = "Untitled thread";
export const AGENT_THREAD_STORE_FULL_ERROR =
  "The agent thread store is full and no saved thread can be evicted.";

export interface AgentThreadOwner {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly repositoryRoot: string;
}

export interface AgentThreadTarget {
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
}

export interface AgentProviderSession {
  readonly kind: AgentCliKind;
  readonly sessionId: string | null;
}

export type AgentThreadLifecycle = "running" | "settled" | "archived";

export type AgentThreadAttention = "running" | "attention" | "settled" | "archived";

export type AgentTurnStatus = AgentTaskStatus | { readonly kind: "interrupted" };

export interface AgentTurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Provider-reported API-equivalent cost for the turn, when available. */
  readonly costUsd?: number | null;
  /** Tokens occupying the provider context window after the turn, when reported. */
  readonly contextTokens: number | null;
}

export interface AgentTurnStreamMetrics {
  readonly receivedUtf8Bytes: number;
  readonly complete: boolean;
}

export type AgentTurnEvent =
  | { readonly kind: "assistantText"; readonly text: string }
  | { readonly kind: "reasoning"; readonly text: string }
  | {
      readonly kind: "toolCall";
      readonly toolId: string;
      readonly name: string;
      readonly inputSummary: string;
    }
  | {
      readonly kind: "toolResult";
      readonly toolId: string;
      readonly outputSummary: string;
      readonly isError: boolean;
    }
  | {
      readonly kind: "result";
      readonly text: string;
      readonly isError: boolean;
      readonly usage: AgentTurnUsage | null;
    }
  | {
      readonly kind: "contextCompaction";
      readonly beforeTokens: number | null;
      readonly afterTokens: number | null;
    }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "unknownLine";
      readonly stream: AgentTaskOutputStream;
      readonly raw: string;
      readonly clipped: boolean;
    };

export interface AgentTurn {
  readonly turnId: string;
  readonly prompt: string;
  readonly status: AgentTurnStatus;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number | null;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly eventsTruncated: boolean;
  readonly lastStatusSequence: number;
  readonly lastOutputSequence: number;
  readonly streamMetrics?: AgentTurnStreamMetrics | null;
  readonly launch: AgentLaunchOptions | null;
  readonly cliVersion: string | null;
}

export interface AgentThreadPushReceipt {
  readonly remote: string;
  readonly branch: string;
}

export interface AgentThreadIntegrationReceipt {
  readonly intoBranch: string;
  readonly mergeSha: string;
  readonly mode: GitIntegrationMode;
}

export interface AgentThreadIntegration {
  readonly lastCommitSha: string | null;
  readonly pushed: AgentThreadPushReceipt | null;
  readonly integrated: AgentThreadIntegrationReceipt | null;
  readonly branchDeleted: boolean;
}

export interface AgentThreadExternalOrigin {
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly importedAtEpochMs: number;
  readonly history?: ExternalAgentSessionHistory;
}

export interface AgentThread {
  readonly threadId: string;
  readonly owner: AgentThreadOwner;
  readonly target: AgentThreadTarget;
  readonly provider: AgentProviderSession;
  readonly title: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly turns: ReadonlyArray<AgentTurn>;
  readonly turnsTruncated: boolean;
  readonly integration: AgentThreadIntegration | null;
  readonly viewedAtEpochMs: number | null;
  readonly externalOrigin: AgentThreadExternalOrigin | null;
}

export interface AgentThreadsState {
  readonly threads: ReadonlyMap<string, AgentThread>;
}

export interface AgentThreadLoadOwner {
  readonly rootKey: string;
  readonly ownerId: string;
}

export type AgentThreadsAction =
  | {
      readonly kind: "loaded";
      readonly owner: AgentThreadLoadOwner;
      readonly threads: ReadonlyArray<AgentThread>;
    }
  | { readonly kind: "threadCreated"; readonly thread: AgentThread }
  | {
      readonly kind: "externalHistoryLoaded";
      readonly threadId: string;
      readonly owner: AgentThreadOwner;
      readonly history: ExternalAgentSessionHistory;
    }
  | { readonly kind: "turnStarted"; readonly threadId: string; readonly turn: AgentTurn }
  | {
      readonly kind: "taskStatusEvent";
      readonly threadId: string;
      readonly event: AgentTaskStatusEvent;
      readonly nowEpochMs: number;
    }
  | {
      readonly kind: "turnEventsAppended";
      readonly threadId: string;
      readonly turnId: string;
      readonly workspaceId: string;
      readonly repositoryRoot: string;
      readonly isolation: AgentTaskIsolation;
      readonly worktreePath: string | null;
      readonly outputSequence: number;
      readonly events: ReadonlyArray<AgentTurnEvent>;
      readonly sessionId: string | null;
      readonly supervisorTruncated: boolean;
      readonly streamMetricsDelta?: AgentTurnStreamMetrics | null;
    }
  | { readonly kind: "turnInterrupted"; readonly turnId: string; readonly nowEpochMs: number }
  | {
      readonly kind: "integrationRecorded";
      readonly threadId: string;
      readonly integration: AgentThreadIntegration;
    }
  | {
      readonly kind: "threadViewed";
      readonly threadId: string;
      readonly atEpochMs: number;
    }
  | { readonly kind: "threadMarkedUnread"; readonly threadId: string }
  | { readonly kind: "threadRenamed"; readonly threadId: string; readonly title: string }
  | {
      readonly kind: "ownerRebound";
      readonly threadId: string;
      readonly previousOwnerId: string;
      readonly owner: AgentThreadOwner;
    }
  | { readonly kind: "pinToggled"; readonly threadId: string }
  | { readonly kind: "archived"; readonly threadId: string }
  | { readonly kind: "deleted"; readonly threadId: string }
  | { readonly kind: "ownerReleased"; readonly ownerId: string };

interface TurnLocation {
  readonly thread: AgentThread;
  readonly index: number;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_MARKER = 0b1000_0000;
const UTF16_HIGH_SURROGATE_START = 0xd800;
const UTF16_HIGH_SURROGATE_END = 0xdbff;
const UTF16_LOW_SURROGATE_START = 0xdc00;
const UTF16_LOW_SURROGATE_END = 0xdfff;
const TITLE_ELLIPSIS = "…";
const TITLE_ELLIPSIS_BYTES = UTF8_ENCODER.encode(TITLE_ELLIPSIS).byteLength;
const agentTextByteState = new WeakMap<AgentTurnEvent, AgentTextByteState>();
const agentEventByteState = new WeakMap<AgentTurnEvent, AgentEventByteState>();

interface AgentTextByteState {
  readonly byteLength: number;
  readonly text: string;
  readonly trailingHighSurrogate: boolean;
}

interface AgentEventByteState {
  readonly byteLength: number;
  readonly values: ReadonlyArray<string>;
}

export function emptyAgentThreadsState(): AgentThreadsState {
  return { threads: new Map() };
}

export function isTerminalAgentTurnStatus(status: AgentTurnStatus): boolean {
  if (status.kind === "interrupted") return true;
  return isTerminalAgentTaskStatus(status);
}

export function runningTurn(thread: AgentThread): AgentTurn | null {
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return null;
  if (isTerminalAgentTurnStatus(last.status)) return null;
  return last;
}

export function agentThreadLifecycle(thread: AgentThread): AgentThreadLifecycle {
  if (thread.archived) return "archived";
  if (runningTurn(thread) !== null) return "running";
  return "settled";
}

export function agentThreadAttention(thread: AgentThread): AgentThreadAttention {
  if (thread.archived) return "archived";
  if (runningTurn(thread) !== null) return "running";
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return "settled";
  if (turnNeedsAttention(last.status)) return "attention";
  return "settled";
}

function turnNeedsAttention(status: AgentTurnStatus): boolean {
  switch (status.kind) {
    case "failed":
    case "interrupted":
    case "stopped":
      return true;
    case "exited":
      return status.exitCode !== 0;
    case "pending":
    case "running":
      return false;
    default:
      return unsupportedTurnStatus(status);
  }
}

export function agentThreadUnread(thread: AgentThread): boolean {
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return false;
  if (!isTerminalAgentTurnStatus(last.status)) return false;
  if (last.endedAtEpochMs === null) return false;
  if (thread.viewedAtEpochMs === null) return true;
  return last.endedAtEpochMs > thread.viewedAtEpochMs;
}

export function lastUsedAgentLaunch(
  threads: Iterable<AgentThread>,
  rootKey: string,
  provider: AgentCliKind,
): AgentLaunchOptions | null {
  let best: AgentTurn | null = null;
  for (const thread of threads) {
    if (thread.owner.rootKey !== rootKey) continue;
    for (const turn of thread.turns) {
      if (turn.launch === null) continue;
      if (turn.launch.provider !== provider) continue;
      if (best !== null && compareTurnRecency(turn, best) <= 0) continue;
      best = turn;
    }
  }
  return best?.launch ?? null;
}

function compareTurnRecency(left: AgentTurn, right: AgentTurn): number {
  if (left.startedAtEpochMs !== right.startedAtEpochMs) {
    return left.startedAtEpochMs - right.startedAtEpochMs;
  }
  if (left.turnId < right.turnId) return -1;
  if (left.turnId > right.turnId) return 1;
  return 0;
}

export function agentThreadTitle(prompt: string): string {
  const line = firstNonEmptyLine(prompt);
  if (line === "") return UNTITLED_AGENT_THREAD_TITLE;
  const bytes = UTF8_ENCODER.encode(line);
  if (bytes.byteLength <= MAX_AGENT_THREAD_TITLE_BYTES) return line;
  let end = MAX_AGENT_THREAD_TITLE_BYTES - TITLE_ELLIPSIS_BYTES;
  while (end > 0 && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_MARKER) {
    end -= 1;
  }
  return `${UTF8_DECODER.decode(bytes.subarray(0, end))}${TITLE_ELLIPSIS}`;
}

export function normalizeAgentThreadTitle(raw: string): string | null {
  const line = firstNonEmptyLine(raw.slice(0, MAX_AGENT_THREAD_TITLE_CHARS));
  if (line === "") return null;
  return agentThreadTitle(line);
}

export function agentThreadsReducer(
  state: AgentThreadsState,
  action: AgentThreadsAction,
): AgentThreadsState {
  switch (action.kind) {
    case "loaded":
      return loadThreads(state, action.owner, action.threads);
    case "threadCreated":
      return createThread(state, action.thread);
    case "externalHistoryLoaded":
      return loadExternalHistory(state, action);
    case "turnStarted":
      return startTurn(state, action.threadId, action.turn);
    case "taskStatusEvent":
      return applyTurnStatusEvent(state, action);
    case "turnEventsAppended":
      return appendTurnEvents(state, action);
    case "turnInterrupted":
      return interruptTurn(state, action.turnId, action.nowEpochMs);
    case "integrationRecorded":
      return recordIntegration(state, action.threadId, action.integration);
    case "threadViewed":
      return markThreadViewed(state, action.threadId, action.atEpochMs);
    case "threadMarkedUnread":
      return markThreadUnread(state, action.threadId);
    case "threadRenamed":
      return renameThread(state, action.threadId, action.title);
    case "ownerRebound":
      return rebindOwner(state, action.threadId, action.previousOwnerId, action.owner);
    case "pinToggled":
      return togglePin(state, action.threadId);
    case "archived":
      return archiveThread(state, action.threadId);
    case "deleted":
      return deleteThread(state, action.threadId);
    case "ownerReleased":
      return releaseOwner(state, action.ownerId);
    default:
      return unsupportedAction(action);
  }
}

function loadExternalHistory(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "externalHistoryLoaded" }>,
): AgentThreadsState {
  const thread = state.threads.get(action.threadId);
  if (thread === undefined || thread.externalOrigin === null) return state;
  if (
    thread.owner.rootKey !== action.owner.rootKey ||
    thread.owner.ownerId !== action.owner.ownerId ||
    thread.owner.repositoryRoot !== action.owner.repositoryRoot ||
    thread.externalOrigin.provider !== action.history.provider ||
    thread.externalOrigin.sessionId !== action.history.sessionId ||
    thread.externalOrigin.history !== undefined
  )
    return state;
  return replaceThread(state, {
    ...thread,
    externalOrigin: { ...thread.externalOrigin, history: action.history },
  });
}

function loadThreads(
  state: AgentThreadsState,
  owner: AgentThreadLoadOwner,
  loaded: ReadonlyArray<AgentThread>,
): AgentThreadsState {
  const threads = new Map<string, AgentThread>();
  for (const [threadId, thread] of state.threads) {
    if (thread.owner.rootKey !== owner.rootKey) {
      threads.set(threadId, thread);
      continue;
    }
    if (runningTurn(thread) !== null) threads.set(threadId, thread);
  }
  for (const thread of loaded) {
    if (thread.owner.rootKey !== owner.rootKey) continue;
    if (thread.owner.ownerId !== owner.ownerId) continue;
    if (threads.has(thread.threadId)) continue;
    threads.set(thread.threadId, boundAgentThreadEvents(markInterruptedTurns(thread)));
  }
  evictThreadsForRoot(threads, owner.rootKey);
  return { threads };
}

function markInterruptedTurns(thread: AgentThread): AgentThread {
  if (thread.turns.every((turn) => isTerminalAgentTurnStatus(turn.status))) return thread;
  return {
    ...thread,
    turns: thread.turns.map((turn) =>
      isTerminalAgentTurnStatus(turn.status)
        ? turn
        : {
            ...turn,
            status: { kind: "interrupted" },
            streamMetrics: interruptedStreamMetrics(turn.streamMetrics ?? null),
          },
    ),
  };
}

function interruptedStreamMetrics(
  streamMetrics: AgentTurnStreamMetrics | null,
): AgentTurnStreamMetrics | null {
  if (streamMetrics === null) return null;
  return streamMetrics.complete ? { ...streamMetrics, complete: false } : streamMetrics;
}

function createThread(state: AgentThreadsState, thread: AgentThread): AgentThreadsState {
  if (state.threads.has(thread.threadId)) return state;
  if (thread.turns.some((turn) => findTurn(state, turn.turnId) !== null)) return state;
  const threads = new Map(state.threads);
  threads.set(thread.threadId, boundAgentThreadEvents(thread));
  evictThreadsForRoot(threads, thread.owner.rootKey);
  return { threads };
}

function startTurn(state: AgentThreadsState, threadId: string, turn: AgentTurn): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (thread.archived) return state;
  if (runningTurn(thread) !== null) return state;
  if (findTurn(state, turn.turnId) !== null) return state;
  const retained = retainTurnsForNewTurn(thread);
  if (retained === null) return state;
  const boundedTurn = boundAgentTurnEvents(turn);
  return replaceThread(state, {
    ...thread,
    turns: [...retained.turns, boundedTurn],
    turnsTruncated: thread.turnsTruncated || retained.evicted,
    updatedAtEpochMs: Math.max(thread.updatedAtEpochMs, turn.startedAtEpochMs),
  });
}

function retainTurnsForNewTurn(
  thread: AgentThread,
): { readonly turns: ReadonlyArray<AgentTurn>; readonly evicted: boolean } | null {
  if (thread.turns.length < MAX_AGENT_TURNS_PER_THREAD) {
    return { turns: thread.turns, evicted: false };
  }
  const oldest = thread.turns[0];
  if (oldest === undefined || !isTerminalAgentTurnStatus(oldest.status)) return null;
  return { turns: thread.turns.slice(1), evicted: true };
}

function applyTurnStatusEvent(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "taskStatusEvent" }>,
): AgentThreadsState {
  const location = acceptedTaskStatusLocation(state, action);
  if (location === null) return state;
  const { thread, index } = location;
  const turn = thread.turns[index];
  const { event } = action;
  const terminal = isTerminalAgentTaskStatus(event.status);
  return replaceTurn(
    state,
    thread,
    index,
    {
      ...turn,
      status: event.status,
      lastStatusSequence: event.sequence,
      endedAtEpochMs: terminal ? action.nowEpochMs : turn.endedAtEpochMs,
    },
    action.nowEpochMs,
  );
}

export function agentTaskStatusActionAccepted(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "taskStatusEvent" }>,
): boolean {
  return acceptedTaskStatusLocation(state, action) !== null;
}

function acceptedTaskStatusLocation(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "taskStatusEvent" }>,
): TurnLocation | null {
  const location = findTurnInThread(state, action.threadId, action.event.taskId);
  if (location === null) return null;
  const { thread, index } = location;
  const turn = thread.turns[index];
  const { event } = action;
  if (event.workspaceId !== thread.owner.ownerId) return null;
  if (event.repositoryRoot !== thread.owner.repositoryRoot) return null;
  if (event.isolation !== thread.target.isolation) return null;
  if (event.worktreePath !== thread.target.worktreePath) return null;
  if (isTerminalAgentTurnStatus(turn.status)) return null;
  if (event.sequence <= turn.lastStatusSequence) return null;
  return location;
}

function appendTurnEvents(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>,
): AgentThreadsState {
  const location = findTurnInThread(state, action.threadId, action.turnId);
  if (location === null) return state;
  const { thread, index } = location;
  const turn = thread.turns[index];
  if (action.workspaceId !== thread.owner.ownerId) return state;
  if (action.repositoryRoot !== thread.owner.repositoryRoot) return state;
  if (action.isolation !== thread.target.isolation) return state;
  if (action.worktreePath !== thread.target.worktreePath) return state;
  if (isTerminalAgentTurnStatus(turn.status)) return state;
  if (action.outputSequence <= turn.lastOutputSequence) return state;
  const merged = turn.eventsTruncated
    ? { events: turn.events, truncated: false }
    : mergeTurnEvents(turn.events, action.events);
  const updatedTurn: AgentTurn = {
    ...turn,
    events: merged.events,
    eventsTruncated: turn.eventsTruncated || merged.truncated || action.supervisorTruncated,
    lastOutputSequence: action.outputSequence,
    streamMetrics: mergeAgentTurnStreamMetrics(
      turn.streamMetrics ?? null,
      action.streamMetricsDelta ?? null,
    ),
  };
  const provider = providerWithSession(thread.provider, action.sessionId);
  const turns = thread.turns.map((candidate, position) =>
    position === index ? updatedTurn : candidate,
  );
  return replaceThread(state, { ...thread, provider, turns });
}

function mergeAgentTurnStreamMetrics(
  current: AgentTurnStreamMetrics | null,
  delta: AgentTurnStreamMetrics | null,
): AgentTurnStreamMetrics | null {
  if (delta === null) return current;
  if (!validStreamMetricBytes(delta.receivedUtf8Bytes) || typeof delta.complete !== "boolean") {
    return current === null ? null : { ...current, complete: false };
  }
  if (current === null) return delta;
  if (!validStreamMetricBytes(current.receivedUtf8Bytes)) return null;
  const receivedUtf8Bytes = current.receivedUtf8Bytes + delta.receivedUtf8Bytes;
  if (!validStreamMetricBytes(receivedUtf8Bytes)) return { ...current, complete: false };
  return {
    receivedUtf8Bytes,
    complete: current.complete && delta.complete,
  };
}

function validStreamMetricBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function providerWithSession(
  provider: AgentProviderSession,
  sessionId: string | null,
): AgentProviderSession {
  if (sessionId === null) return provider;
  if (provider.sessionId !== null) return provider;
  if (!isAgentSessionId(sessionId)) return provider;
  return { ...provider, sessionId };
}

function mergeTurnEvents(
  existing: ReadonlyArray<AgentTurnEvent>,
  incoming: ReadonlyArray<AgentTurnEvent>,
): { readonly events: ReadonlyArray<AgentTurnEvent>; readonly truncated: boolean } {
  if (incoming.length === 0) return { events: existing, truncated: false };
  const events = [...existing];
  let retainedBytes = agentTurnEventsUtf8Bytes(events);
  let truncated = false;
  for (const event of incoming) {
    if (truncated) continue;
    const coalesced = coalesceAgentTextEvents(events[events.length - 1], event);
    if (coalesced !== null) {
      const previous = events[events.length - 1];
      if (previous === undefined) continue;
      const nextBytes =
        retainedBytes - agentTurnEventUtf8Bytes(previous) + agentTurnEventUtf8Bytes(coalesced);
      if (nextBytes > MAX_AGENT_EVENT_BYTES_PER_TURN) {
        truncated = true;
        continue;
      }
      events[events.length - 1] = coalesced;
      retainedBytes = nextBytes;
      continue;
    }
    const eventBytes = agentTurnEventUtf8Bytes(event);
    if (
      events.length >= MAX_AGENT_EVENTS_PER_TURN ||
      retainedBytes + eventBytes > MAX_AGENT_EVENT_BYTES_PER_TURN
    ) {
      truncated = true;
      continue;
    }
    events.push(event);
    retainedBytes += eventBytes;
  }
  return { events, truncated };
}

export function agentTurnEventUtf8Bytes(event: AgentTurnEvent): number {
  if (event.kind === "assistantText" || event.kind === "reasoning" || event.kind === "result") {
    return agentTextEventByteState(event).byteLength;
  }
  const values = agentTurnEventStrings(event);
  const cached = agentEventByteState.get(event);
  if (cached !== undefined && sameStrings(cached.values, values)) return cached.byteLength;
  const byteLength = values.reduce(
    (total, value) => total + UTF8_ENCODER.encode(value).byteLength,
    0,
  );
  agentEventByteState.set(event, { byteLength, values });
  return byteLength;
}

function agentTurnEventsUtf8Bytes(events: ReadonlyArray<AgentTurnEvent>): number {
  return events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0);
}

function agentTurnEventStrings(event: AgentTurnEvent): ReadonlyArray<string> {
  switch (event.kind) {
    case "toolCall":
      return [event.toolId, event.name, event.inputSummary];
    case "toolResult":
      return [event.toolId, event.outputSummary];
    case "error":
      return [event.message];
    case "unknownLine":
      return [event.raw];
    case "contextCompaction":
      return [];
    case "assistantText":
    case "reasoning":
    case "result":
      return [event.text];
    default:
      return unsupportedTurnEvent(event);
  }
}

function sameStrings(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function boundAgentThreadEvents(thread: AgentThread): AgentThread {
  let changed = false;
  const turns = thread.turns.map((turn) => {
    const bounded = boundAgentTurnEvents(turn);
    if (bounded !== turn) changed = true;
    return bounded;
  });
  return changed ? { ...thread, turns } : thread;
}

function boundAgentTurnEvents(turn: AgentTurn): AgentTurn {
  const retained: AgentTurnEvent[] = [];
  let retainedBytes = 0;
  let truncated = turn.eventsTruncated;
  for (const event of turn.events) {
    const eventBytes = agentTurnEventUtf8Bytes(event);
    if (
      retained.length >= MAX_AGENT_EVENTS_PER_TURN ||
      retainedBytes + eventBytes > MAX_AGENT_EVENT_BYTES_PER_TURN
    ) {
      truncated = true;
      break;
    }
    retained.push(event);
    retainedBytes += eventBytes;
  }
  if (
    retained.length === turn.events.length &&
    truncated === turn.eventsTruncated &&
    turn.streamMetrics !== undefined
  ) {
    return turn;
  }
  return {
    ...turn,
    events: retained,
    eventsTruncated: truncated,
    streamMetrics: turn.streamMetrics ?? null,
  };
}

export function coalesceAgentTextEvents(
  last: AgentTurnEvent | undefined,
  next: AgentTurnEvent,
): AgentTurnEvent | null {
  if (last === undefined) return null;
  if (next.kind !== "assistantText" && next.kind !== "reasoning") return null;
  if (last.kind !== next.kind) return null;
  const lastState = agentTextEventByteState(last);
  const nextState = agentTextEventByteState(next);
  const repairsSplitScalar = lastState.trailingHighSurrogate && startsWithLowSurrogate(next.text);
  const byteLength = lastState.byteLength + nextState.byteLength - (repairsSplitScalar ? 2 : 0);
  if (byteLength > MAX_AGENT_EVENT_TEXT_BYTES) return null;
  const coalesced = { kind: next.kind, text: last.text + next.text };
  agentTextByteState.set(coalesced, {
    byteLength,
    text: coalesced.text,
    trailingHighSurrogate:
      next.text.length === 0 ? lastState.trailingHighSurrogate : endsWithHighSurrogate(next.text),
  });
  return coalesced;
}

function agentTextEventByteState(event: Extract<AgentTurnEvent, { readonly text: string }>) {
  const cached = agentTextByteState.get(event);
  if (cached?.text === event.text) return cached;
  const state = {
    byteLength: UTF8_ENCODER.encode(event.text).byteLength,
    text: event.text,
    trailingHighSurrogate: endsWithHighSurrogate(event.text),
  };
  agentTextByteState.set(event, state);
  return state;
}

function startsWithLowSurrogate(text: string): boolean {
  if (text.length === 0) return false;
  const codeUnit = text.charCodeAt(0);
  return codeUnit >= UTF16_LOW_SURROGATE_START && codeUnit <= UTF16_LOW_SURROGATE_END;
}

function endsWithHighSurrogate(text: string): boolean {
  if (text.length === 0) return false;
  const codeUnit = text.charCodeAt(text.length - 1);
  return codeUnit >= UTF16_HIGH_SURROGATE_START && codeUnit <= UTF16_HIGH_SURROGATE_END;
}

function interruptTurn(
  state: AgentThreadsState,
  turnId: string,
  nowEpochMs: number,
): AgentThreadsState {
  const location = findTurn(state, turnId);
  if (location === null) return state;
  const { thread, index } = location;
  const turn = thread.turns[index];
  if (isTerminalAgentTurnStatus(turn.status)) return state;
  return replaceTurn(
    state,
    thread,
    index,
    {
      ...turn,
      status: { kind: "interrupted" },
      endedAtEpochMs: nowEpochMs,
      streamMetrics: interruptedStreamMetrics(turn.streamMetrics ?? null),
    },
    nowEpochMs,
  );
}

function recordIntegration(
  state: AgentThreadsState,
  threadId: string,
  integration: AgentThreadIntegration,
): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (thread.archived) return state;
  return replaceThread(state, {
    ...thread,
    integration,
    updatedAtEpochMs: thread.updatedAtEpochMs + 1,
  });
}

function markThreadViewed(
  state: AgentThreadsState,
  threadId: string,
  atEpochMs: number,
): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (!Number.isSafeInteger(atEpochMs) || atEpochMs < 0) return state;
  if (thread.viewedAtEpochMs !== null && atEpochMs <= thread.viewedAtEpochMs) return state;
  return replaceThread(state, { ...thread, viewedAtEpochMs: atEpochMs });
}

function markThreadUnread(state: AgentThreadsState, threadId: string): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (thread.viewedAtEpochMs === null) return state;
  return replaceThread(state, { ...thread, viewedAtEpochMs: null });
}

function renameThread(state: AgentThreadsState, threadId: string, raw: string): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  const title = normalizeAgentThreadTitle(raw);
  if (title === null) return state;
  if (title === thread.title) return state;
  return replaceThread(state, { ...thread, title });
}

function rebindOwner(
  state: AgentThreadsState,
  threadId: string,
  previousOwnerId: string,
  owner: AgentThreadOwner,
): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (runningTurn(thread) !== null) return state;
  if (thread.owner.ownerId !== previousOwnerId) return state;
  if (thread.owner.rootKey !== owner.rootKey) return state;
  if (thread.owner.repositoryRoot !== owner.repositoryRoot) return state;
  if (owner.ownerId.trim() === "") return state;
  if (thread.owner.ownerId === owner.ownerId) return state;
  return replaceThread(state, { ...thread, owner });
}

function togglePin(state: AgentThreadsState, threadId: string): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  return replaceThread(state, { ...thread, pinned: !thread.pinned });
}

function archiveThread(state: AgentThreadsState, threadId: string): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (thread.archived) return state;
  if (runningTurn(thread) !== null) return state;
  return replaceThread(state, { ...thread, archived: true });
}

function deleteThread(state: AgentThreadsState, threadId: string): AgentThreadsState {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return state;
  if (runningTurn(thread) !== null) return state;
  const threads = new Map(state.threads);
  threads.delete(threadId);
  return { threads };
}

function releaseOwner(state: AgentThreadsState, ownerId: string): AgentThreadsState {
  const threads = new Map<string, AgentThread>();
  for (const [threadId, thread] of state.threads) {
    if (thread.owner.ownerId === ownerId && runningTurn(thread) === null) continue;
    threads.set(threadId, thread);
  }
  if (threads.size === state.threads.size) return state;
  return { threads };
}

function findTurn(state: AgentThreadsState, turnId: string): TurnLocation | null {
  for (const thread of state.threads.values()) {
    const index = thread.turns.findIndex((turn) => turn.turnId === turnId);
    if (index !== -1) return { thread, index };
  }
  return null;
}

function findTurnInThread(
  state: AgentThreadsState,
  threadId: string,
  turnId: string,
): TurnLocation | null {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return null;
  const index = thread.turns.findIndex((turn) => turn.turnId === turnId);
  if (index === -1) return null;
  return { thread, index };
}

function replaceTurn(
  state: AgentThreadsState,
  thread: AgentThread,
  index: number,
  turn: AgentTurn,
  nowEpochMs: number,
): AgentThreadsState {
  const turns = thread.turns.map((candidate, position) => (position === index ? turn : candidate));
  return replaceThread(state, {
    ...thread,
    turns,
    updatedAtEpochMs: Math.max(thread.updatedAtEpochMs, nowEpochMs),
  });
}

function replaceThread(state: AgentThreadsState, thread: AgentThread): AgentThreadsState {
  const threads = new Map(state.threads);
  threads.set(thread.threadId, thread);
  return { threads };
}

function evictThreadsForRoot(threads: Map<string, AgentThread>, rootKey: string): void {
  const inRoot = [...threads.values()].filter((thread) => thread.owner.rootKey === rootKey);
  if (inRoot.length <= MAX_AGENT_THREADS_PER_ROOT) return;
  const evictable = inRoot.filter(isEvictableThread).sort(compareThreadEvictionOrder);
  let count = inRoot.length;
  for (const thread of evictable) {
    if (count <= MAX_AGENT_THREADS_PER_ROOT) return;
    threads.delete(thread.threadId);
    count -= 1;
  }
}

function isEvictableThread(thread: AgentThread): boolean {
  if (thread.pinned) return false;
  return runningTurn(thread) === null;
}

function compareThreadEvictionOrder(left: AgentThread, right: AgentThread): number {
  if (left.updatedAtEpochMs !== right.updatedAtEpochMs) {
    return left.updatedAtEpochMs - right.updatedAtEpochMs;
  }
  if (left.threadId < right.threadId) return -1;
  if (left.threadId > right.threadId) return 1;
  return 0;
}

function firstNonEmptyLine(prompt: string): string {
  for (const line of prompt.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}.`);
}

function unsupportedTurnEvent(event: never): never {
  throw new TypeError(`Unsupported agent turn event: ${JSON.stringify(event)}.`);
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported agent thread action: ${JSON.stringify(action)}.`);
}
