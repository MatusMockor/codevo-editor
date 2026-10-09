import {
  MAX_AGENT_OUTPUT_LINE_BYTES,
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputParserState,
} from "./agentOutput/agentOutputParser.js";
import { utf8ByteLength } from "./agentOutput/utf8Text.js";
import type { AgentTaskOutputStream } from "./agentProvider.js";
import type { AgentTurnEvent } from "./agentTurnEvent.js";
import { agentTurnEventUtf8Bytes } from "./agentTurnEventMerge.js";
import type { RemoteRunnerEvent, RemoteRunnerProvider } from "./remoteRunnerEvent.js";

export interface RemoteAgentTranscriptOutputStart {
  readonly stdoutAtLineBoundary: boolean;
  readonly stderrAtLineBoundary: boolean;
}

export interface RemoteAgentTranscriptSegmentLimits {
  readonly maxEvents: number;
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxPageBytes: number;
  readonly maxLeadLines: number;
  readonly maxLeadBytes: number;
}

export interface RemoteAgentTranscriptSegmentInput {
  readonly provider: RemoteRunnerProvider;
  readonly lead: readonly RemoteRunnerEvent[];
  readonly outputStart: RemoteAgentTranscriptOutputStart | null;
  readonly events: readonly RemoteRunnerEvent[];
  readonly finish: boolean;
  readonly limits: RemoteAgentTranscriptSegmentLimits;
}

export interface RemoteAgentTranscriptSegment {
  readonly events: readonly AgentTurnEvent[];
  readonly clipped: boolean;
}

type ChannelFraming =
  | { readonly kind: "framed" }
  | { readonly kind: "midLine" }
  | { readonly kind: "unknown"; readonly carriedBytes: number; readonly cut: boolean };

interface SegmentCursor {
  readonly parser: AgentOutputParserState;
  readonly stdout: ChannelFraming;
  readonly stderr: ChannelFraming;
}

interface SegmentStep {
  readonly cursor: SegmentCursor;
  readonly events: readonly AgentTurnEvent[];
}

interface LineEnds {
  readonly inPage: boolean;
  readonly atFinish: boolean;
}

interface SettledFraming {
  readonly framing: ChannelFraming;
  readonly clipped: boolean;
}

export type RemoteAgentTranscriptLeadStart = "whole" | "resumed" | "cut";

export interface RemoteAgentTranscriptBoundedLead {
  readonly events: readonly RemoteRunnerEvent[];
  readonly stdout: RemoteAgentTranscriptLeadStart;
  readonly stderr: RemoteAgentTranscriptLeadStart;
}

interface LeadBudget {
  lines: number;
  bytes: number;
  start: RemoteAgentTranscriptLeadStart;
}

interface PageBudget {
  lines: number;
  bytes: number;
}

interface BoundedFeed {
  readonly cursor: SegmentCursor;
  readonly cut: boolean;
}

interface RetainedEvents {
  readonly events: AgentTurnEvent[];
  bytes: number;
  full: boolean;
}

const NO_EVENTS: readonly AgentTurnEvent[] = [];
const NEWLINE = 10;
const FRAMED: ChannelFraming = { kind: "framed" };
const MID_LINE: ChannelFraming = { kind: "midLine" };
const UNKNOWN: ChannelFraming = { kind: "unknown", carriedBytes: 0, cut: false };
const CUT: ChannelFraming = { kind: "unknown", carriedBytes: 0, cut: true };
const TERMINAL_EVENT_TYPES: ReadonlySet<RemoteRunnerEvent["type"]> = new Set([
  "task.succeeded",
  "task.failed",
  "task.interrupted",
  "task.cancelled",
]);

export function remoteAgentTranscriptSegment(
  input: RemoteAgentTranscriptSegmentInput,
): RemoteAgentTranscriptSegment {
  const lead = boundedRemoteAgentTranscriptLead(input.lead, input.limits);
  let cursor = initialCursor(input.provider, lead, input.outputStart);
  for (const event of lead.events) cursor = feedOutput(cursor, event, event.text).cursor;
  const stdout = settledFraming(cursor.stdout, endsLine(input, "stdout"), true);
  const stderr = settledFraming(cursor.stderr, endsLine(input, "stderr"), false);
  return parsedSegment(
    { parser: cursor.parser, stdout: stdout.framing, stderr: stderr.framing },
    input,
    stdout.clipped || stderr.clipped,
  );
}

export function remoteRunnerEventsEndLine(
  events: readonly RemoteRunnerEvent[],
  channel: AgentTaskOutputStream,
): boolean {
  return events.some(
    (event) => outputChannel(event) === channel && event.text?.includes("\n") === true,
  );
}

export function remoteRunnerEventsCarryOutput(
  events: readonly RemoteRunnerEvent[],
  channel: AgentTaskOutputStream,
): boolean {
  return events.some(
    (event) => outputChannel(event) === channel && event.text !== undefined && event.text !== "",
  );
}

export function remoteRunnerEventsEndTask(events: readonly RemoteRunnerEvent[]): boolean {
  return events.some((event) => TERMINAL_EVENT_TYPES.has(event.type));
}

function parsedSegment(
  start: SegmentCursor,
  input: RemoteAgentTranscriptSegmentInput,
  clipped: boolean,
): RemoteAgentTranscriptSegment {
  const retained: RetainedEvents = { events: [], bytes: 0, full: false };
  const budget: PageBudget = { lines: input.limits.maxLines, bytes: input.limits.maxPageBytes };
  let cursor = start;
  for (const event of input.events) {
    const fed = feedBounded(cursor, event, budget, retained, input.limits);
    cursor = fed.cursor;
    if (fed.cut) return { events: retained.events, clipped: true };
    retain(retained, [...inputEvents(event), ...errorEvents(event)], input.limits);
    if (retained.full) return { events: retained.events, clipped: true };
  }
  if (!input.finish) return { events: retained.events, clipped };
  retain(retained, finishAgentOutput(cursor.parser).events, input.limits);
  return { events: retained.events, clipped: clipped || retained.full };
}

function feedBounded(
  start: SegmentCursor,
  event: RemoteRunnerEvent,
  budget: PageBudget,
  retained: RetainedEvents,
  limits: RemoteAgentTranscriptSegmentLimits,
): BoundedFeed {
  const text = outputText(event);
  let cursor = start;
  let from = 0;
  while (from < text.length) {
    const end = lineEnd(text, from);
    const terminated = text.charCodeAt(end - 1) === NEWLINE;
    const piece = text.slice(from, end);
    const bytes = utf8ByteLength(piece);
    if (bytes > budget.bytes || (terminated && budget.lines <= 0)) return { cursor, cut: true };
    budget.bytes -= bytes;
    budget.lines -= terminated ? 1 : 0;
    const step = feedOutput(cursor, event, piece);
    cursor = step.cursor;
    retain(retained, step.events, limits);
    if (retained.full) return { cursor, cut: true };
    from = end;
  }
  return { cursor, cut: false };
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  if (newline < 0) return text.length;
  return newline + 1;
}

function retain(
  retained: RetainedEvents,
  events: readonly AgentTurnEvent[],
  limits: RemoteAgentTranscriptSegmentLimits,
): void {
  for (const event of events) {
    const bytes = agentTurnEventUtf8Bytes(event);
    if (retained.events.length >= limits.maxEvents || retained.bytes + bytes > limits.maxBytes) {
      retained.full = true;
      return;
    }
    retained.events.push(event);
    retained.bytes += bytes;
  }
}

export function boundedRemoteAgentTranscriptLead(
  lead: readonly RemoteRunnerEvent[],
  limits: Pick<RemoteAgentTranscriptSegmentLimits, "maxLeadLines" | "maxLeadBytes">,
): RemoteAgentTranscriptBoundedLead {
  const stdout = leadBudget(limits);
  const stderr = leadBudget(limits);
  const kept: RemoteRunnerEvent[] = [];
  for (let index = lead.length - 1; index >= 0; index -= 1) {
    const event = lead[index];
    const channel = event === undefined ? null : outputChannel(event);
    if (event === undefined || channel === null) continue;
    const text = boundedLeadText(channel === "stdout" ? stdout : stderr, event.text ?? "");
    if (text !== null) kept.push({ ...event, text });
  }
  return { events: kept.reverse(), stdout: stdout.start, stderr: stderr.start };
}

function leadBudget(
  limits: Pick<RemoteAgentTranscriptSegmentLimits, "maxLeadLines" | "maxLeadBytes">,
): LeadBudget {
  return { lines: limits.maxLeadLines, bytes: limits.maxLeadBytes, start: "whole" };
}

function boundedLeadText(budget: LeadBudget, text: string): string | null {
  if (budget.start !== "whole") return null;
  const lines = newlineCount(text, budget.lines + 1);
  const bytes = utf8ByteLength(text);
  if (lines <= budget.lines && bytes <= budget.bytes) {
    budget.lines -= lines;
    budget.bytes -= bytes;
    return text;
  }
  const resume = resumeOffset(text, budget);
  budget.start = resume === null ? "cut" : "resumed";
  if (resume === null) return null;
  return text.slice(resume);
}

function resumeOffset(text: string, budget: LeadBudget): number | null {
  const newline = text.indexOf("\n", Math.max(0, suffixStartWithin(text, budget.bytes) - 1));
  if (newline < 0) return null;
  const suffix = text.slice(newline + 1);
  const excess = newlineCount(suffix, Number.MAX_SAFE_INTEGER) - budget.lines;
  if (excess <= 0) return newline + 1;
  return newline + 1 + throughNewline(suffix, excess).length;
}

function suffixStartWithin(text: string, maxBytes: number): number {
  let bytes = 0;
  let start = text.length;
  while (start > 0) {
    const size = utf8UnitBytesAtMost(text.charCodeAt(start - 1));
    if (bytes + size > maxBytes) return start;
    bytes += size;
    start -= 1;
  }
  return start;
}

function utf8UnitBytesAtMost(unit: number): number {
  if (unit < 0x80) return 1;
  if (unit < 0x800) return 2;
  return 3;
}

function newlineCount(text: string, limit: number): number {
  let count = 0;
  let from = text.indexOf("\n");
  while (from >= 0 && count < limit) {
    count += 1;
    from = text.indexOf("\n", from + 1);
  }
  return count;
}

function throughNewline(text: string, lines: number): string {
  let end = 0;
  for (let line = 0; line < lines; line += 1) end = text.indexOf("\n", end) + 1;
  return text.slice(0, end);
}

function initialCursor(
  provider: RemoteRunnerProvider,
  lead: RemoteAgentTranscriptBoundedLead,
  start: RemoteAgentTranscriptOutputStart | null,
): SegmentCursor {
  return {
    parser: createAgentOutputParserState(provider === "claude" ? "claudeCode" : "codex"),
    stdout: initialFraming(lead.stdout, start?.stdoutAtLineBoundary),
    stderr: initialFraming(lead.stderr, start?.stderrAtLineBoundary),
  };
}

function initialFraming(
  lead: RemoteAgentTranscriptLeadStart,
  atLineBoundary: boolean | undefined,
): ChannelFraming {
  if (lead === "resumed") return FRAMED;
  if (lead === "cut") return CUT;
  if (atLineBoundary === undefined) return UNKNOWN;
  return atLineBoundary ? FRAMED : MID_LINE;
}

function settledFraming(
  framing: ChannelFraming,
  ends: LineEnds,
  silenceIsUncertain: boolean,
): SettledFraming {
  if (framing.kind !== "unknown") return { framing, clipped: false };
  if (framing.carriedBytes > MAX_AGENT_OUTPUT_LINE_BYTES) return { framing, clipped: false };
  if (framing.carriedBytes > 0 || framing.cut)
    return { framing, clipped: ends.inPage || ends.atFinish };
  return { framing: FRAMED, clipped: silenceIsUncertain && ends.inPage };
}

function endsLine(
  input: RemoteAgentTranscriptSegmentInput,
  channel: AgentTaskOutputStream,
): LineEnds {
  return {
    inPage:
      remoteRunnerEventsEndLine(input.events, channel) ||
      (input.finish && remoteRunnerEventsCarryOutput(input.events, channel)),
    atFinish: input.finish,
  };
}

function feedOutput(cursor: SegmentCursor, event: RemoteRunnerEvent, text?: string): SegmentStep {
  const channel = outputChannel(event);
  if (channel === null || text === undefined) return { cursor, events: NO_EVENTS };
  const framed = framedText(cursor[channel], text);
  const result = feedAgentOutput(cursor.parser, channel, framed.text);
  return {
    cursor: { ...cursor, parser: result.state, [channel]: framed.framing },
    events: result.events,
  };
}

function framedText(
  framing: ChannelFraming,
  text: string,
): { readonly text: string; readonly framing: ChannelFraming } {
  if (framing.kind === "framed") return { text, framing };
  const newline = text.indexOf("\n");
  if (newline >= 0) return { text: text.slice(newline + 1), framing: FRAMED };
  if (framing.kind === "midLine") return { text: "", framing };
  return {
    text: "",
    framing: { ...framing, carriedBytes: framing.carriedBytes + utf8ByteLength(text) },
  };
}

function outputText(event: RemoteRunnerEvent | undefined): string {
  if (event === undefined || event.type !== "task.output") return "";
  return event.text ?? "";
}

function outputChannel(event: RemoteRunnerEvent): AgentTaskOutputStream | null {
  if (event.type !== "task.output") return null;
  return event.channel ?? "stdout";
}

function inputEvents(event: RemoteRunnerEvent): readonly AgentTurnEvent[] {
  if (event.type !== "task.input") return NO_EVENTS;
  if (event.messageId === undefined || event.parts === undefined) return NO_EVENTS;
  const text = event.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  return [{ kind: "userMessage", remoteMessageId: event.messageId, text }];
}

function errorEvents(event: RemoteRunnerEvent): readonly AgentTurnEvent[] {
  if (event.error === undefined || event.error === "") return NO_EVENTS;
  return [{ kind: "error", message: event.error }];
}
