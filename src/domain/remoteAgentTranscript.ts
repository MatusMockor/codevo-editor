import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputParserState,
} from "./agentOutput/agentOutputParser";
import { mergeTurnEvents, type AgentTurnEvent } from "./agentThread";
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
  readonly discardStdoutUntilNewline?: boolean;
  readonly appliedGapThrough?: number;
  readonly pendingGap?: {
    readonly throughSequence: number;
    readonly startsAtLineBoundary: boolean;
  };
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
  options: {
    readonly complete: boolean;
    readonly terminal: boolean;
    readonly truncated?: boolean;
    readonly gap?: { readonly throughSequence: number; readonly startsAtLineBoundary: boolean };
  },
): RemoteAgentTranscript {
  if (previous.finished) return previous;
  const gap = options.gap;
  let pendingGap =
    gap !== undefined &&
    gap.throughSequence > previous.lastRunnerSequence &&
    gap.throughSequence > (previous.appliedGapThrough ?? 0)
      ? gap
      : previous.pendingGap;
  let appliedGapThrough = previous.appliedGapThrough;
  let parser = previous.parser;
  let discardStdoutUntilNewline = previous.discardStdoutUntilNewline === true;
  const resetAtGap = () => {
    if (!pendingGap) return;
    parser = createAgentOutputParserState(previous.parser.kind, previous.parser.transport);
    discardStdoutUntilNewline = !pendingGap.startsAtLineBoundary;
    appliedGapThrough = pendingGap.throughSequence;
    pendingGap = undefined;
  };
  let sequence = previous.lastRunnerSequence;
  let ordinal = previous.outputOrdinal;
  let bytes = previous.receivedUtf8Bytes;
  let ended = previous.endedAtEpochMs;
  let error = previous.error;
  let truncated = previous.eventsTruncated || pendingGap !== undefined;
  let events = previous.events;
  const append = (incomingEvents: readonly AgentTurnEvent[]) => {
    const merged = mergeTurnEvents(events, incomingEvents);
    events = merged.events;
    truncated ||= merged.truncated;
  };
  for (const event of incoming) {
    if (event.taskId !== previous.taskId || event.sequence <= sequence)
      throw new Error("Invalid remote transcript event ordering or owner.");
    if (pendingGap && event.sequence > pendingGap.throughSequence) resetAtGap();
    sequence = event.sequence;
    if (event.type === "task.output" && event.text !== undefined) {
      let text = event.text;
      if (discardStdoutUntilNewline && event.channel !== "stderr") {
        const newline = text.indexOf("\n");
        text = newline < 0 ? "" : text.slice(newline + 1);
        discardStdoutUntilNewline = newline < 0;
      }
      const result = feedAgentOutput(parser, event.channel ?? "stdout", text);
      parser = result.state;
      append(result.events);
      ordinal++;
      bytes += new TextEncoder().encode(event.text).byteLength;
    }
    if (event.error) {
      error = event.error;
      append([{ kind: "error", message: event.error }]);
    }
    if (
      ["task.succeeded", "task.failed", "task.interrupted", "task.cancelled"].includes(event.type)
    )
      ended = Date.parse(event.createdAt);
  }
  const finished = options.complete && options.terminal;
  if (finished) {
    resetAtGap();
    const result = finishAgentOutput(parser);
    parser = result.state;
    append(result.events);
  }
  return {
    taskId: previous.taskId,
    discardStdoutUntilNewline,
    appliedGapThrough,
    pendingGap,
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
