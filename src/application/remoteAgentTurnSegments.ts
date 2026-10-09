import {
  remoteAgentTranscriptSegment,
  remoteRunnerEventsCarryOutput,
  remoteRunnerEventsEndLine,
  remoteRunnerEventsEndTask,
  type RemoteAgentTranscriptOutputStart,
  type RemoteAgentTranscriptSegmentLimits,
} from "@codevo/agent-events";
import { agentTurnEventUtf8Bytes, type AgentTurnEvent } from "../domain/agentThread";
import type { AgentTurnLogEntry } from "../domain/agentTurnLog";
import type { RemoteRunnerEvent, RemoteRunnerProvider } from "../domain/remoteRunner";
import {
  MAX_REMOTE_TURN_RAW_PAGES,
  RemoteTurnHistoryChanged,
  type RemoteTurnRawPage,
  type RemoteTurnRawPages,
  type RemoteTurnReadBudget,
} from "./remoteAgentTurnRawPages";

export const REMOTE_TURN_ACTIVITY_TAIL_SEQ = 2 ** 50;
export const MAX_REMOTE_TURN_LEAD_PAGES = 4;
export const MAX_REMOTE_TURN_CACHED_ENTRIES = 8_000;
export const MAX_REMOTE_TURN_CACHED_ENTRY_BYTES = 8 * 1_024 * 1_024;
export const REMOTE_TURN_SEGMENT_LIMITS: RemoteAgentTranscriptSegmentLimits = {
  maxEvents: 4_000,
  maxBytes: 2 * 1_024 * 1_024,
  maxLines: 4_000,
  maxPageBytes: 1_024 * 1_024,
  maxLeadLines: 4_000,
  maxLeadBytes: 1_024 * 1_024,
};

export interface RemoteTurnSegment {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly clipped: boolean;
}

export interface RemoteTurnSegmentsEnd {
  readonly firstSeq: number;
  readonly clipped: boolean;
  readonly discarded: boolean;
}

export interface RemoteTurnSegmentsRetention {
  readonly entries: number;
  readonly bytes: number;
}

interface SegmentRecord {
  readonly count: number;
  readonly lastSeq: number;
  readonly clipped: boolean;
  readonly oldest: boolean;
  readonly discarded: boolean;
}

interface ParsedSegment {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly clipped: boolean;
  readonly oldest: boolean;
  readonly discarded: boolean;
}

interface SegmentLead {
  readonly events: readonly RemoteRunnerEvent[];
  readonly outputStart: RemoteAgentTranscriptOutputStart | null;
}

interface CachedSegment {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly bytes: number;
}

const NO_ENTRIES: ReadonlyArray<AgentTurnLogEntry> = [];

export class RemoteTurnSegments {
  private readonly records: SegmentRecord[] = [];
  private readonly cache = new Map<number, CachedSegment>();

  constructor(
    private readonly raw: RemoteTurnRawPages,
    private readonly provider: RemoteRunnerProvider,
  ) {}

  async load(index: number, budget: RemoteTurnReadBudget): Promise<RemoteTurnSegment | null> {
    const known = this.records[index];
    if (known !== undefined && known.count === 0)
      return { entries: NO_ENTRIES, clipped: known.clipped };
    const cached = this.cache.get(index);
    if (known !== undefined && cached !== undefined)
      return { entries: this.retain(index, cached).entries, clipped: known.clipped };
    if (known === undefined && index !== this.records.length)
      throw new RangeError("Remote turn segments are parsed in order.");
    const parsed = await this.parse(index, budget);
    if (parsed === null) return null;
    const record = known ?? this.remember(index, parsed);
    if (record.count !== parsed.events.length) throw new RemoteTurnHistoryChanged();
    const entries = segmentEntries(record, parsed.events);
    this.retain(index, { entries, bytes: entriesBytes(entries) });
    return { entries, clipped: record.clipped };
  }

  indexBelow(seq: number): number {
    const index = this.records.findIndex((record) => record.count > 0 && firstSeqOf(record) < seq);
    if (index < 0) return this.records.length;
    return index;
  }

  indexAbove(seq: number): number {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];
      if (record !== undefined && record.count > 0 && record.lastSeq > seq) return index;
    }
    return -1;
  }

  end(): RemoteTurnSegmentsEnd | null {
    const last = this.records[this.records.length - 1];
    if (last === undefined) return null;
    const capped = this.records.length >= MAX_REMOTE_TURN_RAW_PAGES;
    if (!last.oldest && !capped) return null;
    return {
      firstSeq: firstSeqOf(last),
      clipped: !last.oldest,
      discarded: last.oldest && last.discarded,
    };
  }

  tailUnchanged(budget: RemoteTurnReadBudget): Promise<boolean> {
    return this.raw.tailUnchanged(budget);
  }

  trim(): void {
    for (const index of this.cache.keys()) {
      if (!overCap(this.retained())) return;
      this.cache.delete(index);
    }
  }

  retained(): RemoteTurnSegmentsRetention {
    let entries = 0;
    let bytes = 0;
    for (const cached of this.cache.values()) {
      entries += cached.entries.length;
      bytes += cached.bytes;
    }
    return { entries, bytes };
  }

  release(): void {
    this.raw.release();
    this.cache.clear();
  }

  private async parse(index: number, budget: RemoteTurnReadBudget): Promise<ParsedSegment | null> {
    const page = await this.raw.load(index, budget);
    if (page === null) return null;
    const finish = index === 0 && remoteRunnerEventsEndTask(page.events);
    const lead = await this.lead(index, page, finish, budget);
    const segment = remoteAgentTranscriptSegment({
      provider: this.provider,
      lead: lead.events,
      outputStart: lead.outputStart,
      events: page.events,
      finish,
      limits: REMOTE_TURN_SEGMENT_LIMITS,
    });
    return {
      events: segment.events,
      clipped: segment.clipped,
      oldest: page.oldest,
      discarded: page.discarded,
    };
  }

  private async lead(
    index: number,
    page: RemoteTurnRawPage,
    finish: boolean,
    budget: RemoteTurnReadBudget,
  ): Promise<SegmentLead> {
    if (page.outputStart) return { events: [], outputStart: outputStartOf(page) };
    let events: readonly RemoteRunnerEvent[] = [];
    let stdoutAnchored = false;
    let stderrAnchored = false;
    let stderrSought = completesStderrLine(page.events, finish);
    for (let depth = 1; depth <= MAX_REMOTE_TURN_LEAD_PAGES; depth += 1) {
      const older = await this.raw.load(index + depth, budget);
      if (older === null) return { events, outputStart: null };
      events = [...older.events, ...events];
      if (older.outputStart) return { events, outputStart: outputStartOf(older) };
      stdoutAnchored ||= remoteRunnerEventsEndLine(older.events, "stdout");
      stderrAnchored ||= remoteRunnerEventsEndLine(older.events, "stderr");
      stderrSought ||= finish && remoteRunnerEventsCarryOutput(older.events, "stderr");
      if (stdoutAnchored && (stderrAnchored || !stderrSought)) return { events, outputStart: null };
    }
    return { events, outputStart: null };
  }

  private remember(index: number, parsed: ParsedSegment): SegmentRecord {
    if (index !== this.records.length)
      throw new RangeError("Remote turn segments are parsed in order.");
    const newer = this.records[index - 1];
    const record: SegmentRecord = {
      count: parsed.events.length,
      lastSeq: newer === undefined ? REMOTE_TURN_ACTIVITY_TAIL_SEQ : newer.lastSeq - newer.count,
      clipped: parsed.clipped,
      oldest: parsed.oldest,
      discarded: parsed.discarded,
    };
    this.records.push(record);
    return record;
  }

  private retain(index: number, cached: CachedSegment): CachedSegment {
    this.cache.delete(index);
    this.cache.set(index, cached);
    return cached;
  }
}

function outputStartOf(page: RemoteTurnRawPage): RemoteAgentTranscriptOutputStart {
  return {
    stdoutAtLineBoundary: page.outputStartsAtLineBoundary,
    stderrAtLineBoundary: page.outputStartsAtLineBoundary,
  };
}

function completesStderrLine(events: readonly RemoteRunnerEvent[], finish: boolean): boolean {
  if (remoteRunnerEventsEndLine(events, "stderr")) return true;
  return finish && remoteRunnerEventsCarryOutput(events, "stderr");
}

function overCap(retained: RemoteTurnSegmentsRetention): boolean {
  if (retained.entries > MAX_REMOTE_TURN_CACHED_ENTRIES) return true;
  return retained.bytes > MAX_REMOTE_TURN_CACHED_ENTRY_BYTES;
}

function firstSeqOf(record: SegmentRecord): number {
  return record.lastSeq - record.count + 1;
}

function segmentEntries(
  record: SegmentRecord,
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentTurnLogEntry> {
  const firstSeq = firstSeqOf(record);
  return events.map((event, offset) => ({ seq: firstSeq + offset, event }));
}

function entriesBytes(entries: ReadonlyArray<AgentTurnLogEntry>): number {
  return entries.reduce((total, entry) => total + agentTurnEventUtf8Bytes(entry.event), 0);
}
