import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputParserState,
} from "./agentOutput/agentOutputParser";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "./agentThread";
import type { RemoteRunnerEvent, RemoteRunnerProvider } from "./remoteRunner";

export interface RemoteAgentTranscript {
  readonly taskId: string;
  readonly parser: AgentOutputParserState;
  readonly events: readonly AgentTurnEvent[];
  readonly lastRunnerSequence: number;
  readonly outputOrdinal: number;
  readonly receivedUtf8Bytes: number;
  readonly eventsTruncated: boolean;
  readonly finished: boolean;
  readonly endedAtEpochMs: number | null;
  readonly error: string | null;
}

export function createRemoteAgentTranscript(
  taskId: string,
  provider: RemoteRunnerProvider,
): RemoteAgentTranscript {
  return {
    taskId,
    parser: createAgentOutputParserState(provider === "claude" ? "claudeCode" : "codex"),
    events: [],
    lastRunnerSequence: 0,
    outputOrdinal: 0,
    receivedUtf8Bytes: 0,
    eventsTruncated: false,
    finished: false,
    endedAtEpochMs: null,
    error: null,
  };
}

/** Runner sequence includes lifecycle records; outputOrdinal counts only accepted chunks. */
export function appendRemoteAgentTranscript(
  previous: RemoteAgentTranscript,
  incoming: readonly RemoteRunnerEvent[],
  options: { readonly complete: boolean; readonly terminal: boolean; readonly truncated?: boolean },
): RemoteAgentTranscript {
  if (previous.finished) return previous;
  let parser = previous.parser;
  let sequence = previous.lastRunnerSequence;
  let ordinal = previous.outputOrdinal;
  let bytes = previous.receivedUtf8Bytes;
  let ended = previous.endedAtEpochMs;
  let error = previous.error;
  let truncated = previous.eventsTruncated;
  const events = [...previous.events];
  let retainedBytes = events.reduce((sum, event) => sum + agentTurnEventUtf8Bytes(event), 0);
  const append = (event: AgentTurnEvent) => {
    if (truncated) return;
    const last = events[events.length - 1];
    const coalesced = coalesceAgentTextEvents(last, event);
    const size =
      retainedBytes +
      agentTurnEventUtf8Bytes(coalesced ?? event) -
      (coalesced && last ? agentTurnEventUtf8Bytes(last) : 0);
    if (
      size > MAX_AGENT_EVENT_BYTES_PER_TURN ||
      (!coalesced && events.length >= MAX_AGENT_EVENTS_PER_TURN)
    ) {
      truncated = true;
      return;
    }
    if (coalesced) events[events.length - 1] = coalesced;
    else events.push(event);
    retainedBytes = size;
  };
  for (const event of incoming) {
    if (event.taskId !== previous.taskId || event.sequence <= sequence)
      throw new Error("Invalid remote transcript event ordering or owner.");
    sequence = event.sequence;
    if (event.type === "task.output" && event.text !== undefined) {
      const result = feedAgentOutput(parser, event.channel ?? "stdout", event.text);
      parser = result.state;
      result.events.forEach(append);
      ordinal++;
      bytes += new TextEncoder().encode(event.text).byteLength;
    }
    if (event.error) {
      error = event.error;
      append({ kind: "error", message: event.error });
    }
    if (
      ["task.succeeded", "task.failed", "task.interrupted", "task.cancelled"].includes(event.type)
    )
      ended = Date.parse(event.createdAt);
  }
  const finished = options.complete && options.terminal;
  if (finished) {
    const result = finishAgentOutput(parser);
    parser = result.state;
    result.events.forEach(append);
  }
  return {
    taskId: previous.taskId,
    parser,
    events,
    lastRunnerSequence: sequence,
    outputOrdinal: ordinal,
    receivedUtf8Bytes: bytes,
    eventsTruncated: truncated || options.truncated === true,
    finished,
    endedAtEpochMs: ended !== null && Number.isFinite(ended) ? ended : null,
    error,
  };
}
