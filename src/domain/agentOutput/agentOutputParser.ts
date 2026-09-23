import {
  flushClaudeNotices,
  throttleClaudeNotices,
  type ClaudeNoticeThrottle,
} from "./claudeNoticeThrottle";
import {
  classifyClaudeSubagentTelemetry,
  type ClaudeSubagentClassification,
} from "./claudeSubagentClassification";
import type { AgentCliKind, AgentTaskOutputStream } from "../agentTask";
import type { AgentAccountUsageObservation } from "../agentAccountUsage";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  type AgentSessionFallback,
  type AgentTurnEvent,
} from "../agentThread";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson";
import { parseCodexAppServerLine } from "./codexAppServer";
import { parseCodexJsonlLine } from "./codexJsonl";
import { EMPTY_PENDING_LINE, splitLines, type AgentOutputPendingLine } from "./lineSplitter";
import { boundUtf8Text } from "./utf8Text";

export { MAX_AGENT_OUTPUT_LINE_BYTES } from "./lineSplitter";
export type { AgentOutputPendingLine } from "./lineSplitter";

export const OVERSIZE_AGENT_OUTPUT_LINE_RAW = "<line exceeded 256 KiB>";

export type ParsedAgentLine =
  | {
      readonly kind: "events";
      readonly events: ReadonlyArray<AgentTurnEvent>;
      readonly sessionId: string | null;
      readonly sessionFallback?: AgentSessionFallback;
    }
  | { readonly kind: "accountUsage"; readonly observation: AgentAccountUsageObservation }
  | { readonly kind: "ignored" }
  | { readonly kind: "unknown"; readonly raw: string };

export interface AgentOutputParserState {
  readonly kind: AgentCliKind;
  readonly transport: "exec" | "appServer";
  readonly stdout: AgentOutputPendingLine;
  readonly stderr: AgentOutputPendingLine;
  readonly emittedToolIds: ReadonlySet<string>;
  readonly claudeSubagentClassification?: ClaudeSubagentClassification;
  readonly claudeNoticeThrottle?: ClaudeNoticeThrottle;
  readonly sessionId: string | null;
}

export interface AgentOutputFeedResult {
  readonly state: AgentOutputParserState;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly sessionId: string | null;
  readonly accountUsage: ReadonlyArray<AgentAccountUsageObservation>;
  readonly sessionFallback?: AgentSessionFallback;
}

interface AgentOutputLineStrategy {
  parse(
    line: string,
    emittedToolIds: ReadonlySet<string>,
  ): { readonly result: ParsedAgentLine; readonly emittedToolIds: ReadonlySet<string> };
}

interface ParsedLines {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly emittedToolIds: ReadonlySet<string>;
  readonly claudeSubagentClassification?: ClaudeSubagentClassification;
  readonly claudeNoticeThrottle?: ClaudeNoticeThrottle;
  readonly capturedSessionId: string | null;
  readonly reportedSessionId: string | null;
  readonly accountUsage: ReadonlyArray<AgentAccountUsageObservation>;
  readonly sessionFallback?: AgentSessionFallback;
}

const NO_EVENTS: ReadonlyArray<AgentTurnEvent> = [];

const CLAUDE_STRATEGY: AgentOutputLineStrategy = {
  parse: (line, emittedToolIds) => ({ result: parseClaudeStreamJsonLine(line), emittedToolIds }),
};

const CODEX_STRATEGY: AgentOutputLineStrategy = {
  parse: (line, emittedToolIds) => {
    const parsed = parseCodexJsonlLine(line, emittedToolIds);
    return { result: parsed.result, emittedToolIds: parsed.state };
  },
};

export function createAgentOutputParserState(
  kind: AgentCliKind,
  transport: "exec" | "appServer" = "exec",
): AgentOutputParserState {
  return {
    kind,
    transport,
    stdout: EMPTY_PENDING_LINE,
    stderr: EMPTY_PENDING_LINE,
    emittedToolIds: new Set(),
    sessionId: null,
  };
}

export function feedAgentOutput(
  state: AgentOutputParserState,
  stream: AgentTaskOutputStream,
  chunk: string,
): AgentOutputFeedResult {
  if (chunk.length === 0) return { state, events: NO_EVENTS, sessionId: null, accountUsage: [] };
  const split = splitLines(pendingLine(state, stream), chunk);
  const overflowEvents = oversizeLineEvents(stream, split.overflow);
  const parsed = parseLines(state, stream, split.lines);
  return {
    state: {
      ...withPendingLine(state, stream, split.state),
      emittedToolIds: parsed.emittedToolIds,
      claudeSubagentClassification: parsed.claudeSubagentClassification,
      claudeNoticeThrottle: parsed.claudeNoticeThrottle,
      sessionId: parsed.capturedSessionId,
    },
    events: [...overflowEvents, ...parsed.events],
    sessionId: parsed.reportedSessionId,
    accountUsage: parsed.accountUsage,
    ...(parsed.sessionFallback === undefined ? {} : { sessionFallback: parsed.sessionFallback }),
  };
}

export function finishAgentOutput(state: AgentOutputParserState): AgentOutputFeedResult {
  const notices = flushClaudeNotices(state.claudeNoticeThrottle);
  const events = [
    ...notices.events,
    ...trailingLineEvents("stdout", state.stdout),
    ...trailingLineEvents("stderr", state.stderr),
  ];
  return {
    state: {
      ...state,
      stdout: EMPTY_PENDING_LINE,
      stderr: EMPTY_PENDING_LINE,
      ...(state.claudeNoticeThrottle === undefined ? {} : { claudeNoticeThrottle: notices.state }),
    },
    events,
    sessionId: null,
    accountUsage: [],
  };
}

function parseLines(
  state: AgentOutputParserState,
  stream: AgentTaskOutputStream,
  lines: ReadonlyArray<string>,
): ParsedLines {
  const events: AgentTurnEvent[] = [];
  let emittedToolIds = state.emittedToolIds;
  let claudeSubagentClassification = state.claudeSubagentClassification;
  let claudeNoticeThrottle = state.claudeNoticeThrottle;
  let capturedSessionId = state.sessionId;
  let reportedSessionId: string | null = null;
  let sessionFallback: AgentSessionFallback | undefined;
  const accountUsage: AgentAccountUsageObservation[] = [];
  const strategy = strategyFor(state.kind, state.transport);
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (stream === "stderr") {
      events.push(unknownLineEvent(stream, line));
      continue;
    }
    const parsed = strategy.parse(line, emittedToolIds);
    emittedToolIds = parsed.emittedToolIds;
    if (parsed.result.kind === "unknown") {
      events.push(unknownLineEvent(stream, parsed.result.raw));
      continue;
    }
    if (parsed.result.kind === "ignored") continue;
    if (parsed.result.kind === "accountUsage") {
      accountUsage.push(parsed.result.observation);
      continue;
    }
    if (parsed.result.sessionFallback !== undefined) {
      // Only the adapter's initial session declaration can authorize fallback.
      // Replayed or later declarations must not replace an established session.
      if (capturedSessionId !== null) continue;
      sessionFallback = parsed.result.sessionFallback;
    }
    if (state.kind === "claudeCode") {
      const classified = classifyClaudeSubagentTelemetry(
        claudeSubagentClassification,
        parsed.result.events,
      );
      claudeSubagentClassification = classified.state;
      const throttled = throttleClaudeNotices(claudeNoticeThrottle, classified.events);
      claudeNoticeThrottle = throttled.state;
      events.push(...throttled.events);
    } else events.push(...parsed.result.events);
    const candidate = parsed.result.sessionId;
    if (candidate === null || candidate === capturedSessionId) continue;
    reportedSessionId = candidate;
    capturedSessionId = capturedSessionId ?? candidate;
  }
  return {
    events,
    emittedToolIds,
    claudeSubagentClassification,
    claudeNoticeThrottle,
    capturedSessionId,
    reportedSessionId,
    accountUsage,
    ...(sessionFallback === undefined ? {} : { sessionFallback }),
  };
}

const CODEX_APP_SERVER_STRATEGY: AgentOutputLineStrategy = {
  parse: (line, emittedToolIds) => ({ result: parseCodexAppServerLine(line), emittedToolIds }),
};

function strategyFor(kind: AgentCliKind, transport: "exec" | "appServer"): AgentOutputLineStrategy {
  if (kind === "codex" && transport === "appServer") return CODEX_APP_SERVER_STRATEGY;
  if (kind === "codex") return CODEX_STRATEGY;
  return CLAUDE_STRATEGY;
}

function oversizeLineEvents(
  stream: AgentTaskOutputStream,
  overflow: number,
): ReadonlyArray<AgentTurnEvent> {
  if (overflow === 0) return NO_EVENTS;
  const events: AgentTurnEvent[] = [];
  for (let index = 0; index < overflow; index += 1) {
    events.push({
      kind: "unknownLine",
      stream,
      raw: OVERSIZE_AGENT_OUTPUT_LINE_RAW,
      clipped: true,
    });
  }
  return events;
}

function trailingLineEvents(
  stream: AgentTaskOutputStream,
  pending: AgentOutputPendingLine,
): ReadonlyArray<AgentTurnEvent> {
  if (pending.pending.trim() === "") return NO_EVENTS;
  return [unknownLineEvent(stream, pending.pending)];
}

function unknownLineEvent(stream: AgentTaskOutputStream, raw: string): AgentTurnEvent {
  const bounded = boundUtf8Text(raw, MAX_AGENT_EVENT_TEXT_BYTES);
  return { kind: "unknownLine", stream, raw: bounded.text, clipped: bounded.clipped };
}

function pendingLine(
  state: AgentOutputParserState,
  stream: AgentTaskOutputStream,
): AgentOutputPendingLine {
  if (stream === "stderr") return state.stderr;
  return state.stdout;
}

function withPendingLine(
  state: AgentOutputParserState,
  stream: AgentTaskOutputStream,
  pending: AgentOutputPendingLine,
): AgentOutputParserState {
  if (stream === "stderr") return { ...state, stderr: pending };
  return { ...state, stdout: pending };
}
