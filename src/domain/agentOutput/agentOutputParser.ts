import type { AgentCliKind, AgentTaskOutputStream } from "../agentTask";
import type { AgentAccountUsageObservation } from "../agentAccountUsage";
import { MAX_AGENT_EVENT_TEXT_BYTES, type AgentTurnEvent } from "../agentThread";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson";
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
    }
  | { readonly kind: "accountUsage"; readonly observation: AgentAccountUsageObservation }
  | { readonly kind: "ignored" }
  | { readonly kind: "unknown"; readonly raw: string };

export interface AgentOutputParserState {
  readonly kind: AgentCliKind;
  readonly stdout: AgentOutputPendingLine;
  readonly stderr: AgentOutputPendingLine;
  readonly emittedToolIds: ReadonlySet<string>;
  readonly sessionId: string | null;
}

export interface AgentOutputFeedResult {
  readonly state: AgentOutputParserState;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly sessionId: string | null;
  readonly accountUsage: ReadonlyArray<AgentAccountUsageObservation>;
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
  readonly capturedSessionId: string | null;
  readonly reportedSessionId: string | null;
  readonly accountUsage: ReadonlyArray<AgentAccountUsageObservation>;
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

export function createAgentOutputParserState(kind: AgentCliKind): AgentOutputParserState {
  return {
    kind,
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
      sessionId: parsed.capturedSessionId,
    },
    events: [...overflowEvents, ...parsed.events],
    sessionId: parsed.reportedSessionId,
    accountUsage: parsed.accountUsage,
  };
}

export function finishAgentOutput(state: AgentOutputParserState): AgentOutputFeedResult {
  const events = [
    ...trailingLineEvents("stdout", state.stdout),
    ...trailingLineEvents("stderr", state.stderr),
  ];
  return {
    state: { ...state, stdout: EMPTY_PENDING_LINE, stderr: EMPTY_PENDING_LINE },
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
  let capturedSessionId = state.sessionId;
  let reportedSessionId: string | null = null;
  const accountUsage: AgentAccountUsageObservation[] = [];
  const strategy = strategyFor(state.kind);
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
    events.push(...parsed.result.events);
    const candidate = parsed.result.sessionId;
    if (candidate === null || candidate === capturedSessionId) continue;
    reportedSessionId = candidate;
    capturedSessionId = capturedSessionId ?? candidate;
  }
  return { events, emittedToolIds, capturedSessionId, reportedSessionId, accountUsage };
}

function strategyFor(kind: AgentCliKind): AgentOutputLineStrategy {
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
