import type {
  RemoteRunnerEvent,
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
} from "../domain/remoteRunner";
import { retainRemoteReplayWindow } from "./remoteAgentReplayWindow";

const CREATED_AT = "2026-09-13T00:00:00Z";
const LOADER_PAGE_ITEMS = 50;
const RUNNER_PAGE_BYTE_BUDGET = 3 * 1_024 * 1_024;
const UTF8 = new TextEncoder();

export function loadedRemoteReplay(
  events: readonly RemoteRunnerEvent[],
  maxBytes: number,
): readonly RemoteRunnerEvent[] {
  let retained: readonly RemoteRunnerEvent[] = [];
  for (let offset = 0; offset < events.length; offset += LOADER_PAGE_ITEMS)
    retained = retainRemoteReplayWindow(
      [...retained, ...events.slice(offset, offset + LOADER_PAGE_ITEMS)],
      maxBytes,
    ).events;
  return retainRemoteReplayWindow(retained, maxBytes).events;
}

export interface FakeRunnerWatermark {
  readonly through: number;
  readonly startsAtLineBoundary: boolean;
}

export function claudeTextLine(text: string): string {
  return `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`;
}

export class FakeRunnerEvents {
  readonly calls: RemoteRunnerEventsBeforeRequest[] = [];
  private readonly watermarks = new Map<string, FakeRunnerWatermark>();
  tamper:
    | ((
        page: RemoteRunnerEventPage,
        request: RemoteRunnerEventsBeforeRequest,
      ) => RemoteRunnerEventPage)
    | null = null;
  private events: RemoteRunnerEvent[] = [];
  private sequence = 0;

  constructor(private readonly pageSize = 50) {}

  output(taskId: string, text: string, channel: "stdout" | "stderr" = "stdout"): number {
    return this.append({ taskId, type: "task.output", text, channel });
  }

  input(taskId: string, messageId: string, text: string): number {
    return this.append({ taskId, type: "task.input", messageId, parts: [{ type: "text", text }] });
  }

  lifecycle(taskId: string, type: RemoteRunnerEvent["type"]): number {
    return this.append({ taskId, type });
  }

  eventsOf(taskId: string): readonly RemoteRunnerEvent[] {
    return this.events.filter((event) => event.taskId === taskId);
  }

  skip(count: number): void {
    this.sequence += count;
  }

  discardOutputThrough(taskId: string, through: number, startsAtLineBoundary: boolean): void {
    this.events = this.events.filter(
      (event) =>
        event.taskId !== taskId || event.type !== "task.output" || event.sequence > through,
    );
    this.watermarks.set(taskId, { through, startsAtLineBoundary });
  }

  readonly listEventsBefore = async (
    request: RemoteRunnerEventsBeforeRequest,
  ): Promise<RemoteRunnerEventPage> => {
    this.calls.push(request);
    const older = this.events.filter(
      (event) => event.taskId === request.taskId && event.sequence < request.before,
    );
    const items = newestWithinPage(older, this.pageSize);
    const watermark = this.watermarks.get(request.taskId);
    const page: RemoteRunnerEventPage = {
      items,
      nextCursor: items.length < older.length ? (items[0]?.sequence ?? null) : null,
      ...(watermark === undefined
        ? {}
        : {
            outputTruncatedBeforeSequence: watermark.through,
            outputStartsAtLineBoundary: watermark.startsAtLineBoundary,
          }),
    };
    if (this.tamper === null) return page;
    return this.tamper(page, request);
  };

  private append(
    event: Pick<RemoteRunnerEvent, "taskId" | "type"> & Partial<RemoteRunnerEvent>,
  ): number {
    this.sequence += 1;
    this.events.push({ ...event, sequence: this.sequence, createdAt: CREATED_AT });
    return this.sequence;
  }
}

function newestWithinPage(
  older: readonly RemoteRunnerEvent[],
  pageSize: number,
): readonly RemoteRunnerEvent[] {
  let start = older.length;
  let bytes = 0;
  while (start > 0 && older.length - start < pageSize) {
    const size = UTF8.encode(JSON.stringify(older[start - 1])).byteLength;
    if (start < older.length && bytes + size > RUNNER_PAGE_BYTE_BUDGET) break;
    bytes += size;
    start -= 1;
  }
  return older.slice(start);
}

export function feedClaudeLines(
  runner: FakeRunnerEvents,
  taskId: string,
  texts: ReadonlyArray<string>,
  chunkSize: number,
): void {
  const stream = texts.map(claudeTextLine).join("");
  for (let offset = 0; offset < stream.length; offset += chunkSize) {
    runner.output(taskId, stream.slice(offset, offset + chunkSize));
    runner.skip(offset % 3);
    runner.output("foreign-task", "noise\n");
  }
}
