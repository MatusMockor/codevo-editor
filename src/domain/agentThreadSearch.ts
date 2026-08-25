import type { AgentThread, AgentTurn } from "./agentThread";
import {
  CONTENT_INCLUDES_SCORE,
  insertRankedSearchResult,
  titleMatchScore,
  type RankedSearchEntry,
} from "./agentThreadSearchRanking";

export const MIN_THREAD_SEARCH_QUERY_CHARS = 2;
export const MAX_THREAD_SEARCH_QUERY_CHARS = 200;
export const MAX_THREAD_SEARCH_RESULTS = 50;
export const MAX_THREAD_SEARCH_SNIPPET_CHARS = 240;
export const MAX_THREAD_SEARCH_DOC_BYTES = 64 * 1_024;
export const MAX_THREAD_SEARCH_SEGMENTS = 512;
export const MAX_THREAD_FIND_HITS = 500;

export type AgentThreadSearchSource = "title" | "user" | "assistant";

export interface AgentThreadSearchRange {
  readonly start: number;
  readonly end: number;
}

export interface AgentThreadSearchSegment {
  readonly source: AgentThreadSearchSource;
  readonly turnId: string | null;
  readonly eventIndex: number | null;
  readonly text: string;
  readonly lower: string;
}

export interface AgentThreadSearchDocument {
  readonly threadId: string;
  readonly updatedAtEpochMs: number;
  readonly titleLower: string;
  readonly segments: ReadonlyArray<AgentThreadSearchSegment>;
  readonly truncated: boolean;
}

export interface AgentThreadSearchMatch {
  readonly threadId: string;
  readonly source: AgentThreadSearchSource;
  readonly turnId: string | null;
  readonly eventIndex: number | null;
  readonly snippet: string;
  readonly ranges: ReadonlyArray<AgentThreadSearchRange>;
  readonly segmentStart: number;
  readonly segmentEnd: number;
  readonly score: number;
}

export interface AgentThreadSearchResult {
  readonly query: string;
  readonly matches: ReadonlyArray<AgentThreadSearchMatch>;
  readonly truncated: boolean;
  readonly documentsTruncated: boolean;
}

export interface AgentThreadFindOptions {
  readonly maxEventsPerTurn?: number;
}

export interface AgentThreadSearchSnippet {
  readonly snippet: string;
  readonly ranges: ReadonlyArray<AgentThreadSearchRange>;
}

export interface AgentThreadFindHit {
  readonly turnId: string;
  readonly eventIndex: number | null;
  readonly start: number;
  readonly end: number;
}

interface RankedMatch extends RankedSearchEntry {
  readonly match: AgentThreadSearchMatch;
}

interface CollectOutcome {
  readonly bytes: number;
  readonly stopped: boolean;
}

const SNIPPET_ELLIPSIS = "…";
const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const UTF8_ENCODER = new TextEncoder();
const EMPTY_RESULT: AgentThreadSearchResult = {
  query: "",
  matches: [],
  truncated: false,
  documentsTruncated: false,
};

export function normalizeThreadSearchQuery(raw: string): string | null {
  const clipped = raw
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, MAX_THREAD_SEARCH_QUERY_CHARS)
    .trim();
  if (clipped.length < MIN_THREAD_SEARCH_QUERY_CHARS) return null;
  return clipped.toLowerCase();
}

export function buildAgentThreadSearchDocument(thread: AgentThread): AgentThreadSearchDocument {
  const title = segment("title", null, null, thread.title);
  const collected: AgentThreadSearchSegment[] = [];
  let bytes = utf8ByteLength(title.text);
  let truncated = thread.turnsTruncated;

  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn === undefined) continue;
    if (turn.eventsTruncated) truncated = true;
    const outcome = collectTurnSegments(turn, collected, bytes);
    bytes = outcome.bytes;
    if (!outcome.stopped) continue;
    truncated = true;
    break;
  }

  return {
    threadId: thread.threadId,
    updatedAtEpochMs: thread.updatedAtEpochMs,
    titleLower: title.lower,
    segments: [title, ...collected],
    truncated,
  };
}

export function searchAgentThreadDocuments(
  docs: ReadonlyArray<AgentThreadSearchDocument>,
  query: string,
  limit: number = MAX_THREAD_SEARCH_RESULTS,
): AgentThreadSearchResult {
  const normalized = normalizeThreadSearchQuery(query);
  if (normalized === null) return EMPTY_RESULT;

  const cap = boundedLimit(limit);
  const ranked: RankedMatch[] = [];
  let matching = 0;
  let documentsTruncated = false;
  for (const doc of docs) {
    const match = bestDocumentMatch(doc, normalized);
    if (match === null) continue;
    matching += 1;
    if (doc.truncated) documentsTruncated = true;
    insertRankedSearchResult(
      ranked,
      {
        match,
        score: match.score,
        recencyEpochMs: doc.updatedAtEpochMs,
        tieBreakKey: doc.threadId,
      },
      cap,
    );
  }

  return {
    query: normalized,
    matches: ranked.map((entry) => entry.match),
    truncated: matching > cap,
    documentsTruncated,
  };
}

export function threadSearchSnippet(
  source: AgentThreadSearchSegment,
  index: number,
  queryLength: number,
): AgentThreadSearchSnippet {
  const text = source.text;
  if (text.length <= MAX_THREAD_SEARCH_SNIPPET_CHARS) {
    return { snippet: text, ranges: [clampRange(index, queryLength, text.length)] };
  }

  const window = Math.max(MAX_THREAD_SEARCH_SNIPPET_CHARS - queryLength, 0);
  const preferred = Math.max(index - Math.floor(window / 2), 0);
  const end = alignEnd(text, Math.min(preferred + MAX_THREAD_SEARCH_SNIPPET_CHARS, text.length));
  const start = alignStart(text, Math.max(end - MAX_THREAD_SEARCH_SNIPPET_CHARS, 0));
  const prefix = start > 0 ? SNIPPET_ELLIPSIS : "";
  const suffix = end < text.length ? SNIPPET_ELLIPSIS : "";
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const offset = prefix.length - start;
  return { snippet, ranges: [clampRange(index + offset, queryLength, snippet.length)] };
}

export function findInThread(
  thread: AgentThread,
  query: string,
  options: AgentThreadFindOptions = {},
): ReadonlyArray<AgentThreadFindHit> {
  const normalized = normalizeThreadSearchQuery(query);
  if (normalized === null) return [];

  const maxEventsPerTurn = boundedEventCap(options.maxEventsPerTurn);
  const hits: AgentThreadFindHit[] = [];
  for (const turn of thread.turns) {
    for (const candidate of turnSegments(turn, maxEventsPerTurn)) {
      collectFindHits(candidate, normalized, hits);
      if (hits.length >= MAX_THREAD_FIND_HITS) return hits;
    }
  }
  return hits;
}

function collectTurnSegments(
  turn: AgentTurn,
  into: AgentThreadSearchSegment[],
  bytes: number,
): CollectOutcome {
  let used = bytes;
  for (const candidate of turnSegments(turn)) {
    if (into.length + 1 >= MAX_THREAD_SEARCH_SEGMENTS) return { bytes: used, stopped: true };
    const size = utf8ByteLength(candidate.text);
    if (used + size > MAX_THREAD_SEARCH_DOC_BYTES) return { bytes: used, stopped: true };
    used += size;
    into.push(candidate);
  }
  return { bytes: used, stopped: false };
}

function collectFindHits(
  candidate: AgentThreadSearchSegment,
  query: string,
  hits: AgentThreadFindHit[],
): void {
  const turnId = candidate.turnId;
  if (turnId === null) return;
  let index = candidate.lower.indexOf(query);
  while (index !== -1 && hits.length < MAX_THREAD_FIND_HITS) {
    hits.push({
      turnId,
      eventIndex: candidate.eventIndex,
      start: index,
      end: index + query.length,
    });
    index = candidate.lower.indexOf(query, index + query.length);
  }
}

function bestDocumentMatch(
  doc: AgentThreadSearchDocument,
  query: string,
): AgentThreadSearchMatch | null {
  const titleSegment = doc.segments[0];
  if (titleSegment === undefined || titleSegment.source !== "title") return null;

  const titleScore = titleMatchScore(doc.titleLower, query);
  if (titleScore !== null) {
    const index = Math.max(doc.titleLower.indexOf(query), 0);
    return documentMatch(doc, titleSegment, index, query.length, titleScore);
  }

  for (const candidate of doc.segments) {
    if (candidate.source === "title") continue;
    const index = candidate.lower.indexOf(query);
    if (index === -1) continue;
    return documentMatch(doc, candidate, index, query.length, CONTENT_INCLUDES_SCORE);
  }

  return null;
}

function documentMatch(
  doc: AgentThreadSearchDocument,
  source: AgentThreadSearchSegment,
  index: number,
  queryLength: number,
  score: number,
): AgentThreadSearchMatch {
  const snippet = threadSearchSnippet(source, index, queryLength);
  return {
    threadId: doc.threadId,
    source: source.source,
    turnId: source.turnId,
    eventIndex: source.eventIndex,
    snippet: snippet.snippet,
    ranges: snippet.ranges,
    segmentStart: index,
    segmentEnd: Math.min(index + queryLength, source.text.length),
    score,
  };
}

function turnSegments(
  turn: AgentTurn,
  maxEventsPerTurn: number = Number.POSITIVE_INFINITY,
): ReadonlyArray<AgentThreadSearchSegment> {
  const segments: AgentThreadSearchSegment[] = [segment("user", turn.turnId, null, turn.prompt)];
  const firstVisible = Math.max(0, turn.events.length - maxEventsPerTurn);
  turn.events.forEach((event, index) => {
    if (index < firstVisible) return;
    if (event.kind === "assistantText") {
      segments.push(segment("assistant", turn.turnId, index, event.text));
      return;
    }
    if (event.kind !== "result") return;
    segments.push(segment("assistant", turn.turnId, index, event.text));
  });
  return segments;
}

function segment(
  source: AgentThreadSearchSource,
  turnId: string | null,
  eventIndex: number | null,
  text: string,
): AgentThreadSearchSegment {
  return { source, turnId, eventIndex, text, lower: text.toLowerCase() };
}

function utf8ByteLength(text: string): number {
  return UTF8_ENCODER.encode(text).byteLength;
}

function boundedEventCap(cap: number | undefined): number {
  if (cap === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(cap) || cap < 0) return Number.POSITIVE_INFINITY;
  return cap;
}

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) return MAX_THREAD_SEARCH_RESULTS;
  return Math.min(limit, MAX_THREAD_SEARCH_RESULTS);
}

function clampRange(start: number, length: number, bound: number): AgentThreadSearchRange {
  const from = Math.min(Math.max(start, 0), bound);
  return { start: from, end: Math.min(from + Math.max(length, 0), bound) };
}

function alignStart(text: string, start: number): number {
  if (start <= 0) return 0;
  const code = text.charCodeAt(start);
  if (code < LOW_SURROGATE_START || code > LOW_SURROGATE_END) return start;
  return start - 1;
}

function alignEnd(text: string, end: number): number {
  if (end >= text.length) return text.length;
  const code = text.charCodeAt(end - 1);
  if (code < HIGH_SURROGATE_START || code >= LOW_SURROGATE_START) return end;
  return end - 1;
}
