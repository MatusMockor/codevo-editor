import { agentTurnEventUtf8Bytes } from "../domain/agentThread";
import {
  AGENT_TURN_LOG_LIMITS,
  NO_AGENT_TURN_LOG_LOSS,
  type AgentTurnLogAnchor,
  type AgentTurnLogEntry,
  type AgentTurnLogPage,
} from "../domain/agentTurnLog";
import type { RemoteRunnerProvider } from "../domain/remoteRunner";
import {
  RemoteTurnHistoryChanged,
  RemoteTurnRawPages,
  RemoteTurnReadBudgetExhausted,
  RemoteTurnReaderRevoked,
  remoteTurnReadBudget,
  type RemoteTurnEventsPort,
  type RemoteTurnReadBudget,
  type RemoteTurnTarget,
} from "./remoteAgentTurnRawPages";
import {
  REMOTE_TURN_ACTIVITY_TAIL_SEQ,
  RemoteTurnSegments,
  type RemoteTurnSegment,
} from "./remoteAgentTurnSegments";

export interface RemoteAgentTurnActivityRequest {
  readonly anchor: AgentTurnLogAnchor;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export interface RemoteAgentTurnActivityReaderOptions {
  readonly port: RemoteTurnEventsPort;
  readonly target: RemoteTurnTarget;
  readonly provider: RemoteRunnerProvider;
  authorize(): boolean;
}

interface PageLimits {
  readonly maxEvents: number;
  readonly maxBytes: number;
}

interface Walk {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly clipped: boolean;
}

interface PageFlags {
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
  readonly clipped: boolean;
  readonly earlierDiscarded: boolean;
}

type SegmentStep =
  | { readonly kind: "segment"; readonly segment: RemoteTurnSegment }
  | { readonly kind: "end" }
  | { readonly kind: "exhausted" };

const END: SegmentStep = { kind: "end" };
const EXHAUSTED: SegmentStep = { kind: "exhausted" };

export class RemoteAgentTurnActivityReader {
  private session: RemoteTurnSegments | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RemoteAgentTurnActivityReaderOptions) {}

  readPage(request: RemoteAgentTurnActivityRequest): Promise<AgentTurnLogPage> {
    const page = this.queue.then(() => this.read(request));
    this.queue = page.then(
      () => undefined,
      () => undefined,
    );
    return page;
  }

  release(): void {
    this.session?.release();
  }

  private async read(request: RemoteAgentTurnActivityRequest): Promise<AgentTurnLogPage> {
    const budget = remoteTurnReadBudget();
    const session = await this.sessionFor(request.anchor, budget);
    try {
      return await readAnchoredPage(session, request.anchor, pageLimits(request), budget);
    } catch (error) {
      if (error instanceof RemoteTurnHistoryChanged) this.session = null;
      throw error;
    } finally {
      session.trim();
    }
  }

  private sessionFor(
    anchor: AgentTurnLogAnchor,
    budget: RemoteTurnReadBudget,
  ): Promise<RemoteTurnSegments> | RemoteTurnSegments {
    if (anchor.at === "tail") return this.pinnedTail(budget);
    if (this.session === null) throw new RemoteTurnReaderRevoked();
    return this.session;
  }

  private async pinnedTail(budget: RemoteTurnReadBudget): Promise<RemoteTurnSegments> {
    const pinned = this.session;
    if (pinned !== null && (await pinned.tailUnchanged(budget))) return pinned;
    return this.open();
  }

  private open(): RemoteTurnSegments {
    const raw = new RemoteTurnRawPages(this.options.port, this.options.target, () =>
      this.options.authorize(),
    );
    this.session = new RemoteTurnSegments(raw, this.options.provider);
    return this.session;
  }
}

function readAnchoredPage(
  segments: RemoteTurnSegments,
  anchor: AgentTurnLogAnchor,
  limits: PageLimits,
  budget: RemoteTurnReadBudget,
): Promise<AgentTurnLogPage> {
  switch (anchor.at) {
    case "tail":
      return readBackward(segments, REMOTE_TURN_ACTIVITY_TAIL_SEQ + 1, limits, budget);
    case "before":
      return readBackward(segments, anchor.seq, limits, budget);
    case "after":
      return readForward(segments, anchor.seq, limits, budget);
    case "around":
      return readAround(segments, anchor.seq, limits, budget);
    default:
      return unsupportedAnchor(anchor);
  }
}

async function readBackward(
  segments: RemoteTurnSegments,
  below: number,
  limits: PageLimits,
  budget: RemoteTurnReadBudget,
): Promise<AgentTurnLogPage> {
  const walk = await walkOlder(segments, below, limits.maxEvents, budget);
  const kept = newestWithin(walk.entries, limits);
  const end = segments.end();
  const firstSeq = kept[0]?.seq ?? below;
  const atStart = end !== null && (kept.length === 0 || firstSeq <= end.firstSeq);
  const lastSeq = kept[kept.length - 1]?.seq ?? below - 1;
  return pageOf(kept, below, {
    hasEarlier: !atStart,
    hasLater: lastSeq < REMOTE_TURN_ACTIVITY_TAIL_SEQ,
    clipped: walk.clipped || (atStart && end.clipped),
    earlierDiscarded: atStart && end.discarded,
  });
}

async function readForward(
  segments: RemoteTurnSegments,
  above: number,
  limits: PageLimits,
  budget: RemoteTurnReadBudget,
): Promise<AgentTurnLogPage> {
  const walk = await walkNewer(segments, above, limits.maxEvents, budget);
  const kept = oldestWithin(walk.entries, limits);
  const start = segments.end();
  const firstSeq = kept[0]?.seq ?? above + 1;
  const lastSeq = kept[kept.length - 1]?.seq ?? above;
  return pageOf(kept, above, {
    hasEarlier: start === null || firstSeq > start.firstSeq,
    hasLater: kept.length > 0 && lastSeq < REMOTE_TURN_ACTIVITY_TAIL_SEQ,
    clipped: walk.clipped,
    earlierDiscarded: false,
  });
}

async function readAround(
  segments: RemoteTurnSegments,
  seq: number,
  limits: PageLimits,
  budget: RemoteTurnReadBudget,
): Promise<AgentTurnLogPage> {
  const half = {
    maxEvents: Math.max(1, Math.floor(limits.maxEvents / 2)),
    maxBytes: Math.max(1, Math.floor(limits.maxBytes / 2)),
  };
  const earlier = await readBackward(segments, seq + 1, half, budget);
  const later = await readForward(segments, seq, half, budget);
  return pageOf([...earlier.entries, ...later.entries], seq, {
    hasEarlier: earlier.hasEarlier,
    hasLater: later.entries.length > 0 ? later.hasLater : earlier.hasLater,
    clipped: earlier.clipped || later.clipped,
    earlierDiscarded: earlier.earlierDiscarded === true,
  });
}

async function walkOlder(
  segments: RemoteTurnSegments,
  below: number,
  maxEvents: number,
  budget: RemoteTurnReadBudget,
): Promise<Walk> {
  const runs: ReadonlyArray<AgentTurnLogEntry>[] = [];
  let count = 0;
  let clipped = false;
  for (let index = segments.indexBelow(below); count < maxEvents; index += 1) {
    const step = await loadStep(segments, index, budget, count > 0);
    if (step.kind !== "segment") return { entries: runs.flat(), clipped };
    const eligible = step.segment.entries.filter((entry) => entry.seq < below);
    runs.unshift(eligible);
    count += eligible.length;
    clipped ||= step.segment.clipped;
  }
  return { entries: runs.flat(), clipped };
}

async function walkNewer(
  segments: RemoteTurnSegments,
  above: number,
  maxEvents: number,
  budget: RemoteTurnReadBudget,
): Promise<Walk> {
  const runs: ReadonlyArray<AgentTurnLogEntry>[] = [];
  let count = 0;
  let clipped = false;
  for (let index = segments.indexAbove(above); index >= 0 && count < maxEvents; index -= 1) {
    const step = await loadStep(segments, index, budget, count > 0);
    if (step.kind === "end") throw new RemoteTurnHistoryChanged();
    if (step.kind === "exhausted") return { entries: runs.flat(), clipped };
    const eligible = step.segment.entries.filter((entry) => entry.seq > above);
    runs.push(eligible);
    count += eligible.length;
    clipped ||= step.segment.clipped;
  }
  return { entries: runs.flat(), clipped };
}

async function loadStep(
  segments: RemoteTurnSegments,
  index: number,
  budget: RemoteTurnReadBudget,
  partial: boolean,
): Promise<SegmentStep> {
  try {
    const segment = await segments.load(index, budget);
    if (segment === null) return END;
    return { kind: "segment", segment };
  } catch (error) {
    if (!(error instanceof RemoteTurnReadBudgetExhausted)) throw error;
    if (partial) return EXHAUSTED;
    if (budget.reserve <= 0) throw error;
    budget.remaining = budget.reserve;
    budget.reserve = 0;
    return loadStep(segments, index, budget, partial);
  }
}

function newestWithin(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  limits: PageLimits,
): ReadonlyArray<AgentTurnLogEntry> {
  let start = entries.length;
  let bytes = 0;
  while (start > 0 && entries.length - start < limits.maxEvents) {
    const size = entryBytes(entries[start - 1]);
    if (start < entries.length && bytes + size > limits.maxBytes) break;
    bytes += size;
    start -= 1;
  }
  return entries.slice(start);
}

function oldestWithin(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  limits: PageLimits,
): ReadonlyArray<AgentTurnLogEntry> {
  let end = 0;
  let bytes = 0;
  while (end < entries.length && end < limits.maxEvents) {
    const size = entryBytes(entries[end]);
    if (end > 0 && bytes + size > limits.maxBytes) break;
    bytes += size;
    end += 1;
  }
  return entries.slice(0, end);
}

function entryBytes(entry: AgentTurnLogEntry | undefined): number {
  if (entry === undefined) return 0;
  return agentTurnEventUtf8Bytes(entry.event);
}

function pageOf(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  anchorSeq: number,
  flags: PageFlags,
): AgentTurnLogPage {
  return {
    entries,
    firstSeq: entries[0]?.seq ?? anchorSeq,
    lastSeq: entries[entries.length - 1]?.seq ?? anchorSeq,
    hasEarlier: flags.hasEarlier,
    hasLater: flags.hasLater,
    loss: NO_AGENT_TURN_LOG_LOSS,
    clipped: flags.clipped,
    ...(flags.earlierDiscarded ? { earlierDiscarded: true } : {}),
  };
}

function pageLimits(request: RemoteAgentTurnActivityRequest): PageLimits {
  return {
    maxEvents: boundedLimit(request.maxEvents, AGENT_TURN_LOG_LIMITS.pageEvents),
    maxBytes: boundedLimit(request.maxBytes, AGENT_TURN_LOG_LIMITS.pageBytes),
  };
}

function boundedLimit(value: number, cap: number): number {
  if (!Number.isFinite(value)) return cap;
  return Math.min(Math.max(1, Math.floor(value)), cap);
}

function unsupportedAnchor(anchor: never): never {
  throw new TypeError(`Unsupported agent turn log anchor: ${JSON.stringify(anchor)}.`);
}
