import type {
  AgentCliKind,
  AgentTaskIsolation,
  AgentTaskOutputEvent,
  AgentTaskOutputStream,
} from "../domain/agentTask";
import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputFeedResult,
  type AgentOutputParserState,
} from "../domain/agentOutput/agentOutputParser";
import type { AgentTaskStatusEvent } from "../domain/agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { warning } from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export interface AgentOutputParserPort {
  create(kind: AgentCliKind): AgentOutputParserState;
  feed(
    state: AgentOutputParserState,
    stream: AgentTaskOutputStream,
    chunk: string,
  ): AgentOutputFeedResult;
  finish(state: AgentOutputParserState): AgentOutputFeedResult;
}

export const domainAgentOutputParser: AgentOutputParserPort = {
  create: createAgentOutputParserState,
  feed: feedAgentOutput,
  finish: finishAgentOutput,
};

export interface AgentTurnOutputStream {
  readonly threadId: string;
  readonly turnId: string;
  readonly ownerId: string;
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly resumed: boolean;
  readonly outputSubscriptionEpoch: number | null;
  parser: AgentOutputParserState;
  lastSequence: number;
  pendingEvents: AgentTurnEvent[];
  pendingEventBytes: number;
  eventRetentionStopped: boolean;
  pendingSessionId: string | null;
  pendingTruncated: boolean;
  pendingDropped: boolean;
  pendingReceivedUtf8Bytes: number;
  pendingStreamMetricsObserved: boolean;
  rawStreamComplete: boolean;
  sawSessionId: boolean;
  sawResult: boolean;
}

export type TurnEventsAppendedAction = Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>;

export function createAgentTurnOutputStream(
  parser: AgentOutputParserPort,
  identity: {
    readonly threadId: string;
    readonly turnId: string;
    readonly ownerId: string;
    readonly repositoryRoot: string;
    readonly isolation: AgentTaskIsolation;
    readonly worktreePath: string | null;
    readonly kind: AgentCliKind;
    readonly resumed: boolean;
    readonly outputSubscriptionEpoch?: number | null;
  },
): AgentTurnOutputStream {
  return {
    threadId: identity.threadId,
    turnId: identity.turnId,
    ownerId: identity.ownerId,
    repositoryRoot: identity.repositoryRoot,
    isolation: identity.isolation,
    worktreePath: identity.worktreePath,
    resumed: identity.resumed,
    outputSubscriptionEpoch:
      identity.outputSubscriptionEpoch === undefined ? 0 : identity.outputSubscriptionEpoch,
    parser: parser.create(identity.kind),
    lastSequence: 0,
    pendingEvents: [],
    pendingEventBytes: 0,
    eventRetentionStopped: false,
    pendingSessionId: null,
    pendingTruncated: false,
    pendingDropped: false,
    pendingReceivedUtf8Bytes: 0,
    pendingStreamMetricsObserved: false,
    rawStreamComplete:
      identity.outputSubscriptionEpoch === undefined || identity.outputSubscriptionEpoch !== null,
    sawSessionId: false,
    sawResult: false,
  };
}

export function acceptAgentTurnOutput(
  parser: AgentOutputParserPort,
  stream: AgentTurnOutputStream,
  event: AgentTaskOutputEvent,
): boolean {
  if (event.taskId !== stream.turnId) return false;
  if (event.sequence <= stream.lastSequence) return false;
  if (event.sequence !== stream.lastSequence + 1) stream.rawStreamComplete = false;
  stream.lastSequence = event.sequence;
  recordRawStreamChunk(stream, event.chunk);
  stream.pendingTruncated = stream.pendingTruncated || event.truncated;
  absorb(stream, parser.feed(stream.parser, event.stream, event.chunk));
  if (event.truncated) {
    stream.eventRetentionStopped = true;
    stream.rawStreamComplete = false;
  }
  return true;
}

export function drainAgentTurnOutput(
  stream: AgentTurnOutputStream,
  outputSequence: number,
): TurnEventsAppendedAction | null {
  if (
    stream.pendingEvents.length === 0 &&
    stream.pendingSessionId === null &&
    !stream.pendingTruncated &&
    !stream.pendingDropped &&
    !stream.pendingStreamMetricsObserved
  ) {
    return null;
  }
  const action: TurnEventsAppendedAction = {
    kind: "turnEventsAppended",
    threadId: stream.threadId,
    turnId: stream.turnId,
    workspaceId: stream.ownerId,
    repositoryRoot: stream.repositoryRoot,
    isolation: stream.isolation,
    worktreePath: stream.worktreePath,
    outputSequence,
    events: stream.pendingEvents,
    sessionId: stream.pendingSessionId,
    supervisorTruncated: stream.pendingTruncated || stream.pendingDropped,
    streamMetricsDelta: stream.pendingStreamMetricsObserved
      ? {
          receivedUtf8Bytes: stream.pendingReceivedUtf8Bytes,
          complete: stream.rawStreamComplete,
        }
      : null,
  };
  stream.pendingEvents = [];
  stream.pendingEventBytes = 0;
  stream.pendingSessionId = null;
  stream.pendingTruncated = false;
  stream.pendingDropped = false;
  stream.pendingReceivedUtf8Bytes = 0;
  stream.pendingStreamMetricsObserved = false;
  return action;
}

const RAW_STREAM_ENCODER = new TextEncoder();

function recordRawStreamChunk(stream: AgentTurnOutputStream, chunk: string): void {
  stream.pendingStreamMetricsObserved = true;
  const chunkBytes = RAW_STREAM_ENCODER.encode(chunk).byteLength;
  const receivedUtf8Bytes = stream.pendingReceivedUtf8Bytes + chunkBytes;
  if (!Number.isSafeInteger(receivedUtf8Bytes)) {
    stream.rawStreamComplete = false;
    return;
  }
  stream.pendingReceivedUtf8Bytes = receivedUtf8Bytes;
}

export function finishAgentTurnOutput(
  parser: AgentOutputParserPort,
  stream: AgentTurnOutputStream,
  completionKnownClean = true,
): TurnEventsAppendedAction | null {
  absorb(stream, parser.finish(stream.parser));
  if (!completionKnownClean) stream.rawStreamComplete = false;
  if (stream.lastSequence === 0 || !completionKnownClean) {
    stream.pendingStreamMetricsObserved = true;
  }
  return drainAgentTurnOutput(stream, stream.lastSequence + 1);
}

function absorb(stream: AgentTurnOutputStream, result: AgentOutputFeedResult): void {
  stream.parser = result.state;
  for (const event of result.events) {
    if (event.kind === "result") stream.sawResult = true;
    appendPendingEvent(stream, event);
  }
  if (result.sessionId === null) return;
  stream.sawSessionId = true;
  if (stream.pendingSessionId === null) stream.pendingSessionId = result.sessionId;
}

function appendPendingEvent(stream: AgentTurnOutputStream, event: AgentTurnEvent): void {
  if (stream.eventRetentionStopped) return;
  const last = stream.pendingEvents[stream.pendingEvents.length - 1];
  const coalesced = coalesceAgentTextEvents(last, event);
  if (coalesced !== null) {
    if (last === undefined) return;
    const nextBytes =
      stream.pendingEventBytes - agentTurnEventUtf8Bytes(last) + agentTurnEventUtf8Bytes(coalesced);
    if (nextBytes > MAX_AGENT_EVENT_BYTES_PER_TURN) {
      stream.pendingDropped = true;
      stream.eventRetentionStopped = true;
      return;
    }
    stream.pendingEvents[stream.pendingEvents.length - 1] = coalesced;
    stream.pendingEventBytes = nextBytes;
    return;
  }
  const eventBytes = agentTurnEventUtf8Bytes(event);
  if (
    stream.pendingEvents.length >= MAX_AGENT_EVENTS_PER_TURN ||
    stream.pendingEventBytes + eventBytes > MAX_AGENT_EVENT_BYTES_PER_TURN
  ) {
    stream.pendingDropped = true;
    stream.eventRetentionStopped = true;
    return;
  }
  stream.pendingEvents.push(event);
  stream.pendingEventBytes += eventBytes;
}

const SESSION_CHANGED_NOTICE =
  "The agent reported a different session id for this thread; the original session is kept.";
const FRAME_FALLBACK_MS = 16;
export const AGENT_OUTPUT_FLUSH_FALLBACK_MS = 100;

export function sessionChangeNotice(
  state: AgentThreadsState,
  threadId: string,
  sessionId: string | null,
): AgentTasksNotice | null {
  if (sessionId === null) return null;
  const known = state.threads.get(threadId)?.provider.sessionId ?? null;
  if (known === null || known === sessionId) return null;
  return warning(SESSION_CHANGED_NOTICE);
}

export function resumeRejected(
  stream: AgentTurnOutputStream,
  event: AgentTaskStatusEvent,
): boolean {
  if (!stream.resumed) return false;
  if (event.status.kind !== "exited" || event.status.exitCode === 0) return false;
  return !stream.sawSessionId && !stream.sawResult;
}

export function scheduleAgentOutputFrame(callback: () => void): () => void {
  const framesAvailable =
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  let settled = false;
  let frameHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    settled = true;
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    if (timerHandle !== null) clearTimeout(timerHandle);
    frameHandle = null;
    timerHandle = null;
  };

  const run = (): void => {
    if (settled) return;
    cancel();
    callback();
  };

  timerHandle = setTimeout(
    run,
    framesAvailable ? AGENT_OUTPUT_FLUSH_FALLBACK_MS : FRAME_FALLBACK_MS,
  );
  if (framesAvailable) frameHandle = requestAnimationFrame(run);
  return cancel;
}
