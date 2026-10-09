import type {
  RemoteRunnerEvent,
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
} from "../domain/remoteRunner";
import { assertRemoteRunnerBackwardPage } from "../domain/remoteRunnerBackwardPage";

export const MAX_REMOTE_TURN_RAW_PAGES = 4_096;
export const MAX_REMOTE_TURN_CACHED_RAW_PAGES = 12;
export const MAX_REMOTE_TURN_RAW_READS_PER_CALL = 12;
export const MAX_REMOTE_TURN_EMPTY_SCAN_READS = 52;

export interface RemoteTurnEventsPort {
  listEventsBefore(request: RemoteRunnerEventsBeforeRequest): Promise<RemoteRunnerEventPage>;
}

export interface RemoteTurnTarget {
  readonly serverId: string;
  readonly taskId: string;
}

export interface RemoteTurnRawPage {
  readonly events: readonly RemoteRunnerEvent[];
  readonly oldest: boolean;
  readonly outputStart: boolean;
  readonly outputStartsAtLineBoundary: boolean;
  readonly discarded: boolean;
}

export interface RemoteTurnReadBudget {
  remaining: number;
  reserve: number;
}

export class RemoteTurnReadBudgetExhausted extends Error {
  constructor() {
    super("The remote turn activity read budget is exhausted.");
    this.name = "RemoteTurnReadBudgetExhausted";
  }
}

export class RemoteTurnReaderRevoked extends Error {
  constructor() {
    super("The remote turn activity reader no longer owns this turn.");
    this.name = "RemoteTurnReaderRevoked";
  }
}

export class RemoteTurnHistoryChanged extends Error {
  constructor() {
    super("The remote turn activity changed on the server.");
    this.name = "RemoteTurnHistoryChanged";
  }
}

interface RawPageRecord {
  readonly before: number;
  readonly first: number | null;
  readonly last: number | null;
  readonly length: number;
  readonly olderCursor: number | null;
  readonly outputStart: boolean;
  readonly outputStartsAtLineBoundary: boolean;
  readonly discarded: boolean;
}

export function remoteTurnReadBudget(): RemoteTurnReadBudget {
  return {
    remaining: MAX_REMOTE_TURN_RAW_READS_PER_CALL,
    reserve: MAX_REMOTE_TURN_EMPTY_SCAN_READS,
  };
}

export class RemoteTurnRawPages {
  private readonly records: RawPageRecord[] = [];
  private readonly cache = new Map<number, RemoteTurnRawPage>();

  constructor(
    private readonly port: RemoteTurnEventsPort,
    private readonly target: RemoteTurnTarget,
    private readonly authorize: () => boolean,
  ) {}

  async load(index: number, budget: RemoteTurnReadBudget): Promise<RemoteTurnRawPage | null> {
    const cached = this.cache.get(index);
    if (cached !== undefined) return this.retain(index, cached);
    const before = this.cursorOf(index);
    if (before === null) return null;
    const response = await this.fetch(before, budget);
    const record = this.remember(index, rawPageRecord(before, response));
    return this.retain(index, rawPage(record, response));
  }

  async tailUnchanged(budget: RemoteTurnReadBudget): Promise<boolean> {
    const known = this.records[0];
    if (known === undefined) return false;
    const response = await this.fetch(Number.MAX_SAFE_INTEGER, budget);
    if (!sameRecord(known, rawPageRecord(Number.MAX_SAFE_INTEGER, response))) return false;
    this.retain(0, rawPage(known, response));
    return true;
  }

  release(): void {
    this.cache.clear();
  }

  private cursorOf(index: number): number | null {
    const known = this.records[index];
    if (known !== undefined) return known.before;
    if (index !== this.records.length)
      throw new RangeError("Remote turn pages are discovered in order.");
    if (index >= MAX_REMOTE_TURN_RAW_PAGES) return null;
    const newer = this.records[index - 1];
    if (newer === undefined) return Number.MAX_SAFE_INTEGER;
    return newer.olderCursor;
  }

  private async fetch(
    before: number,
    budget: RemoteTurnReadBudget,
  ): Promise<RemoteRunnerEventPage> {
    if (!this.authorize()) throw new RemoteTurnReaderRevoked();
    if (budget.remaining <= 0) throw new RemoteTurnReadBudgetExhausted();
    budget.remaining -= 1;
    const request = { ...this.target, before };
    const response = await this.port.listEventsBefore(request);
    if (!this.authorize()) throw new RemoteTurnReaderRevoked();
    assertRemoteRunnerBackwardPage(response, request);
    return response;
  }

  private remember(index: number, record: RawPageRecord): RawPageRecord {
    const known = this.records[index];
    if (known === undefined) {
      this.records.push(record);
      return record;
    }
    if (!sameRecord(known, record)) throw new RemoteTurnHistoryChanged();
    return known;
  }

  private retain(index: number, page: RemoteTurnRawPage): RemoteTurnRawPage {
    this.cache.delete(index);
    this.cache.set(index, page);
    this.trim();
    return page;
  }

  private trim(): void {
    for (const oldest of this.cache.keys()) {
      if (this.cache.size <= MAX_REMOTE_TURN_CACHED_RAW_PAGES) return;
      this.cache.delete(oldest);
    }
  }
}

function rawPageRecord(before: number, response: RemoteRunnerEventPage): RawPageRecord {
  const watermark = response.outputTruncatedBeforeSequence ?? 0;
  const first = response.items[0]?.sequence ?? null;
  const last = response.items[response.items.length - 1]?.sequence ?? null;
  return {
    before: last === null ? before : last + 1,
    first,
    last,
    length: response.items.length,
    olderCursor: response.nextCursor,
    outputStart: response.nextCursor === null || (first !== null && first <= watermark),
    outputStartsAtLineBoundary: watermark === 0 || response.outputStartsAtLineBoundary === true,
    discarded: watermark > 0,
  };
}

function rawPage(record: RawPageRecord, response: RemoteRunnerEventPage): RemoteTurnRawPage {
  const watermark = response.outputTruncatedBeforeSequence ?? 0;
  return {
    events: response.items.filter(
      (event) => event.type !== "task.output" || event.sequence > watermark,
    ),
    oldest: record.olderCursor === null,
    outputStart: record.outputStart,
    outputStartsAtLineBoundary: record.outputStartsAtLineBoundary,
    discarded: record.discarded,
  };
}

function sameRecord(left: RawPageRecord, right: RawPageRecord): boolean {
  return (
    left.before === right.before &&
    left.first === right.first &&
    left.last === right.last &&
    left.length === right.length &&
    left.olderCursor === right.olderCursor &&
    left.outputStart === right.outputStart &&
    left.outputStartsAtLineBoundary === right.outputStartsAtLineBoundary &&
    left.discarded === right.discarded
  );
}
