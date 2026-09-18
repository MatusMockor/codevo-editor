import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputParserState,
} from "./agentOutput/agentOutputParser";
import {
  retainAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "./agentSubagentLifecycle";
import { mergeTurnEvents, type AgentTurnEvent } from "./agentThread";
import type { RemoteRunnerEvent, RemoteRunnerProvider } from "./remoteRunner";

export interface RemoteAgentTranscript {
  readonly taskId: string;
  readonly parser: AgentOutputParserState;
  readonly events: readonly AgentTurnEvent[];
  readonly subagentLifecycle?: AgentSubagentLifecycle;
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
  let subagentLifecycle =
    previous.subagentLifecycle ?? retainAgentSubagentLifecycle(undefined, previous.events);
  const append = (incomingEvents: readonly AgentTurnEvent[]) => {
    subagentLifecycle = retainAgentSubagentLifecycle(subagentLifecycle, incomingEvents);
    const merged = mergeRemoteTranscriptEvents(events, incomingEvents);
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
    if (event.type === "task.input" && event.messageId && event.parts) {
      if (
        !events.some(
          (item) => item.kind === "userMessage" && item.remoteMessageId === event.messageId,
        )
      )
        append([
          {
            kind: "userMessage",
            remoteMessageId: event.messageId,
            text: event.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n\n"),
          },
        ]);
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
    subagentLifecycle,
    lastRunnerSequence: sequence,
    outputOrdinal: ordinal,
    receivedUtf8Bytes: bytes,
    eventsTruncated: truncated || options.truncated === true,
    finished,
    endedAtEpochMs: ended !== null && Number.isFinite(ended) ? ended : null,
    error,
  };
}

/** Accepted inputs retain 32 × (48,000 text bytes + 30 separator bytes), outside output. */
function mergeRemoteTranscriptEvents(
  existing: readonly AgentTurnEvent[],
  incoming: readonly AgentTurnEvent[],
): ReturnType<typeof mergeTurnEvents> {
  if (incoming.length === 0) return { events: existing, truncated: false };
  const accepted = new Map<string, Extract<AgentTurnEvent, { kind: "userMessage" }>>();
  for (const event of [...existing, ...incoming]) {
    if (event.kind !== "userMessage" || event.remoteMessageId === undefined) continue;
    if (!accepted.has(event.remoteMessageId) && accepted.size >= 32)
      throw new Error("The runner exceeded the accepted message limit.");
    accepted.set(event.remoteMessageId, event);
  }
  for (const event of incoming) {
    if (
      event.kind === "userMessage" &&
      event.remoteMessageId !== undefined &&
      new TextEncoder().encode(event.text).byteLength > 48_030
    )
      throw new Error("The runner exceeded the accepted message byte limit.");
  }
  if (!accepted.size) return mergeTurnEvents(existing, incoming);
  const reference = (event: AgentTurnEvent): AgentTurnEvent =>
    event.kind === "userMessage" && event.remoteMessageId !== undefined
      ? { kind: "userMessage", remoteMessageId: event.remoteMessageId, text: "" }
      : event;
  const merged = mergeTurnEvents(existing.map(reference), incoming.map(reference));
  return {
    ...merged,
    events: merged.events.map((event) =>
      event.kind === "userMessage" && event.remoteMessageId !== undefined
        ? accepted.get(event.remoteMessageId)!
        : event,
    ),
  };
}
