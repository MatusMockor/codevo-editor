import type { CodexTransport } from "../domain/agentProviderSettings";
import type {
  AgentCliKind,
  AgentTaskIsolation,
  AgentTaskOutputEvent,
  AgentTaskOutputStream,
} from "../domain/agentTask";
import type { AgentAccountUsageObservation } from "../domain/agentAccountUsage";
import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputFeedResult,
  type AgentOutputParserState,
} from "../domain/agentOutput/agentOutputParser";
import type { AgentTaskStatusEvent } from "../domain/agentTask";
import {
  agentTurnEventUtf8Bytes,
  mergeTurnEvents,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurnEvent,
  type AgentSessionFallback,
} from "../domain/agentThread";
import { EMPTY_PENDING_LINE } from "../domain/agentOutput/lineSplitter";
import { warning } from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export interface AgentOutputParserPort {
  create(kind: AgentCliKind, transport?: CodexTransport): AgentOutputParserState;
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
  readonly resumedSessionId: string | null;
  readonly outputSubscriptionEpoch: number | null;
  parser: AgentOutputParserState;
  lastSequence: number;
  lastOutputObservedAtEpochMs?: number;
  resyncStdout: boolean;
  resyncStderr: boolean;
  pendingEvents: ReadonlyArray<AgentTurnEvent>;
  pendingEventBytes: number;
  pendingSessionId: string | null;
  pendingSessionFallback: AgentSessionFallback | null;
  pendingTruncated: boolean;
  pendingDropped: boolean;
  pendingReceivedUtf8Bytes: number;
  pendingStreamMetricsObserved: boolean;
  pendingAccountUsage: AgentAccountUsageObservation[];
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
    readonly resumedSessionId?: string | null;
    readonly codexTransport?: CodexTransport;
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
    resumedSessionId: identity.resumedSessionId ?? null,
    outputSubscriptionEpoch:
      identity.outputSubscriptionEpoch === undefined ? 0 : identity.outputSubscriptionEpoch,
    parser: parser.create(identity.kind, identity.codexTransport ?? "exec"),
    lastSequence: 0,
    resyncStdout: false,
    resyncStderr: false,
    pendingEvents: [],
    pendingEventBytes: 0,
    pendingSessionId: null,
    pendingSessionFallback: null,
    pendingTruncated: false,
    pendingDropped: false,
    pendingReceivedUtf8Bytes: 0,
    pendingStreamMetricsObserved: false,
    pendingAccountUsage: [],
    rawStreamComplete:
      identity.outputSubscriptionEpoch === undefined || identity.outputSubscriptionEpoch !== null,
    sawSessionId: false,
    sawResult: false,
  };
}

export function drainAgentAccountUsage(
  stream: AgentTurnOutputStream,
): ReadonlyArray<AgentAccountUsageObservation> {
  const observations = stream.pendingAccountUsage;
  stream.pendingAccountUsage = [];
  return observations;
}

export function acceptAgentTurnOutput(
  parser: AgentOutputParserPort,
  stream: AgentTurnOutputStream,
  event: AgentTaskOutputEvent,
  observedAtEpochMs: number = Date.now(),
): boolean {
  if (event.taskId !== stream.turnId) return false;
  if (event.sequence <= stream.lastSequence) return false;
  if (event.sequence !== stream.lastSequence + 1 || event.truncated) {
    stream.rawStreamComplete = false;
    stream.pendingTruncated = true;
    stream.parser = { ...stream.parser, stdout: EMPTY_PENDING_LINE, stderr: EMPTY_PENDING_LINE };
    stream.resyncStdout = true;
    stream.resyncStderr = true;
  }
  stream.lastSequence = event.sequence;
  stream.lastOutputObservedAtEpochMs = observedAtEpochMs;
  recordRawStreamChunk(stream, event.chunk);
  stream.pendingTruncated = stream.pendingTruncated || event.truncated;
  absorb(stream, parser.feed(stream.parser, event.stream, resynchronizedChunk(stream, event)));
  if (event.truncated) {
    stream.rawStreamComplete = false;
  }
  return true;
}

/** Never join retained bytes across a lost transport segment. */
function resynchronizedChunk(stream: AgentTurnOutputStream, event: AgentTaskOutputEvent): string {
  const field = event.stream === "stderr" ? "resyncStderr" : "resyncStdout";
  if (!stream[field]) return event.chunk;
  if (event.startsAtLineBoundary === true) {
    stream[field] = false;
    return event.chunk;
  }
  // Older transports cannot attest to a boundary: discard their first partial line.
  const newline = event.chunk.indexOf("\n");
  if (newline < 0) return "";
  stream[field] = false;
  return event.chunk.slice(newline + 1);
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
    ...(stream.pendingSessionFallback === null
      ? {}
      : { sessionFallback: stream.pendingSessionFallback }),
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
  stream.pendingSessionFallback = null;
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
  stream.pendingAccountUsage.push(...result.accountUsage);
  for (const event of result.events) {
    if (event.kind === "result") stream.sawResult = true;
  }
  if (result.events.length > 0) {
    const events = result.events.map((event) =>
      event.kind === "contextUsage" &&
      event.inputTokens !== null &&
      event.observedAtEpochMs === undefined &&
      stream.lastOutputObservedAtEpochMs !== undefined
        ? { ...event, observedAtEpochMs: stream.lastOutputObservedAtEpochMs }
        : event,
    );
    const retained = mergeTurnEvents(stream.pendingEvents, events);
    stream.pendingEvents = retained.events;
    stream.pendingEventBytes = retained.events.reduce(
      (total, event) => total + agentTurnEventUtf8Bytes(event),
      0,
    );
    stream.pendingDropped = stream.pendingDropped || retained.truncated;
  }
  if (result.sessionId === null) return;
  if (
    stream.resumed &&
    result.sessionFallback !== undefined &&
    result.sessionFallback.previousThreadId === stream.resumedSessionId
  ) {
    stream.pendingSessionFallback = result.sessionFallback;
  }
  stream.sawSessionId = true;
  if (stream.pendingSessionId === null) stream.pendingSessionId = result.sessionId;
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
