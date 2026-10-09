import { OVERSIZE_AGENT_OUTPUT_LINE_RAW } from "@codevo/agent-events";
import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../domain/agentThread";
import {
  agentTurnActivityPageRejection,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
  type AgentTurnActivityWindow,
} from "../domain/agentTurnActivityWindow";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogEntry,
  type AgentTurnLogPage,
} from "../domain/agentTurnLog";
import { RemoteAgentTurnActivityReader } from "./remoteAgentTurnActivityReader";
import {
  MAX_REMOTE_TURN_EMPTY_SCAN_READS,
  MAX_REMOTE_TURN_RAW_PAGES,
  MAX_REMOTE_TURN_RAW_READS_PER_CALL,
  RemoteTurnHistoryChanged,
  RemoteTurnRawPages,
  RemoteTurnReadBudgetExhausted,
  RemoteTurnReaderRevoked,
  remoteTurnReadBudget,
} from "./remoteAgentTurnRawPages";
import {
  MAX_REMOTE_TURN_CACHED_ENTRIES,
  MAX_REMOTE_TURN_CACHED_ENTRY_BYTES,
  REMOTE_TURN_ACTIVITY_TAIL_SEQ,
  REMOTE_TURN_SEGMENT_LIMITS,
  RemoteTurnSegments,
} from "./remoteAgentTurnSegments";
import {
  FakeRunnerEvents,
  claudeTextLine,
  feedClaudeLines,
} from "./remoteAgentTurnActivityTestSupport";

const TASK = "task";
const TAIL = REMOTE_TURN_ACTIVITY_TAIL_SEQ;

interface Traversal {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly pages: ReadonlyArray<AgentTurnLogPage>;
  readonly window: AgentTurnActivityWindow | null;
}

function readerFor(runner: FakeRunnerEvents, authorize: () => boolean = () => true) {
  return new RemoteAgentTurnActivityReader({
    port: runner,
    target: { serverId: "server", taskId: TASK },
    provider: "claude",
    authorize,
  });
}

function read(
  reader: RemoteAgentTurnActivityReader,
  anchor: AgentTurnLogAnchor,
  maxEvents: number = AGENT_TURN_LOG_LIMITS.pageEvents,
  maxBytes: number = AGENT_TURN_LOG_LIMITS.pageBytes,
): Promise<AgentTurnLogPage> {
  return reader.readPage({ anchor, maxEvents, maxBytes });
}

function texts(entries: ReadonlyArray<AgentTurnLogEntry>): string[] {
  return entries.map((entry) => textOf(entry.event));
}

function textOf(event: AgentTurnEvent): string {
  if (event.kind === "assistantText") return event.text;
  if (event.kind === "unknownLine") return `raw:${event.raw}`;
  return event.kind;
}

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${String(index).padStart(4, "0")}`);
}

function expectContiguous(entries: ReadonlyArray<AgentTurnLogEntry>): void {
  expect(entries.map((entry) => entry.seq)).toEqual(
    entries.map((_, index) => (entries[0]?.seq ?? 0) + index),
  );
}

async function readToStart(reader: RemoteAgentTurnActivityReader): Promise<Traversal> {
  const pages: AgentTurnLogPage[] = [];
  let entries: ReadonlyArray<AgentTurnLogEntry> = [];
  let window: AgentTurnActivityWindow | null = null;
  let anchor: AgentTurnLogAnchor = { at: "tail" };
  for (let step = 0; step < 2_000; step += 1) {
    const page = await read(reader, anchor);
    expect(agentTurnActivityPageRejection(page, anchor)).toBeNull();
    pages.push(page);
    entries = [...page.entries, ...entries];
    window =
      window === null
        ? openAgentTurnActivityWindow(page)
        : prependAgentTurnActivityPage(window, page);
    if (!page.hasEarlier) return { entries, pages, window };
    anchor = { at: "before", seq: entries[0]?.seq ?? TAIL + 1 };
  }
  return { entries, pages, window };
}

async function readToTail(
  reader: RemoteAgentTurnActivityReader,
  fromSeq: number,
): Promise<ReadonlyArray<AgentTurnLogEntry>> {
  let entries: ReadonlyArray<AgentTurnLogEntry> = [];
  let anchor: AgentTurnLogAnchor = { at: "after", seq: fromSeq };
  for (let step = 0; step < 2_000; step += 1) {
    const page = await read(reader, anchor);
    expect(agentTurnActivityPageRejection(page, anchor)).toBeNull();
    entries = [...entries, ...page.entries];
    if (!page.hasLater) return entries;
    anchor = { at: "after", seq: page.lastSeq };
  }
  return entries;
}

describe("remote turn activity reader paging", () => {
  it("pages a long turn back to its start with contiguous seqs that end at the tail", async () => {
    const runner = new FakeRunnerEvents();
    const lines = numbered(700);
    runner.lifecycle(TASK, "task.created");
    runner.lifecycle(TASK, "task.running");
    feedClaudeLines(runner, TASK, lines, 97);
    runner.lifecycle(TASK, "task.succeeded");

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries)).toEqual(lines);
    expectContiguous(result.entries);
    expect(result.entries[result.entries.length - 1]?.seq).toBe(TAIL);
    expect(result.pages.every((page) => page.entries.length <= 200)).toBe(true);
    expect(result.pages.length).toBeGreaterThan(3);
    expect(result.window?.gap).toBe(false);
    expect(result.window?.clipped).toBe(false);
    expect(result.window?.hasEarlier).toBe(false);
    expect(result.window?.earlierDiscarded).toBeUndefined();
    expect(result.pages[0]?.hasLater).toBe(false);
    expect(runner.calls.every((call) => call.taskId === TASK && call.serverId === "server")).toBe(
      true,
    );
    expect(runner.calls).toHaveLength(Math.ceil(runner.eventsOf(TASK).length / 50));
  });

  it("splits one raw page that yields more than 200 agent events into several log pages", async () => {
    const runner = new FakeRunnerEvents();
    const lines = numbered(300);
    for (let chunk = 0; chunk < 50; chunk += 1)
      runner.output(
        TASK,
        lines
          .slice(chunk * 6, chunk * 6 + 6)
          .map(claudeTextLine)
          .join(""),
      );
    const reader = readerFor(runner);

    const tail = await read(reader, { at: "tail" });
    const earlier = await read(reader, { at: "before", seq: tail.firstSeq });

    expect(texts(tail.entries)).toEqual(lines.slice(100));
    expect(tail.hasEarlier).toBe(true);
    expect(texts(earlier.entries)).toEqual(lines.slice(0, 100));
    expect(earlier.hasEarlier).toBe(false);
    expect(earlier.lastSeq + 1).toBe(tail.firstSeq);
    expect(runner.calls).toHaveLength(1);
  });

  it("honours the byte limit of a page without losing the entries it leaves behind", async () => {
    const runner = new FakeRunnerEvents();
    const lines = numbered(40);
    feedClaudeLines(runner, TASK, lines, 500);
    const reader = readerFor(runner);

    const tail = await read(reader, { at: "tail" }, 200, 25);
    const earlier = await read(reader, { at: "before", seq: tail.firstSeq }, 200, 1);

    expect(texts(tail.entries)).toEqual(lines.slice(38));
    expect(tail.hasEarlier).toBe(true);
    expect(texts(earlier.entries)).toEqual(lines.slice(37, 38));
  });

  it("serves the same entries again in both directions after its caches evicted them", async () => {
    const runner = new FakeRunnerEvents();
    const lines = numbered(10_000);
    feedClaudeLines(runner, TASK, lines, 97);
    runner.lifecycle(TASK, "task.succeeded");
    const reader = readerFor(runner);

    const backward = await readToStart(reader);
    const fetchedOnce = runner.calls.length;
    const first = backward.entries[0]?.seq ?? 0;
    const forward = await readToTail(reader, first - 1);
    const middle = await read(reader, { at: "before", seq: first + 1_500 });
    const around = await read(reader, { at: "around", seq: TAIL - 50 }, 20);
    const beyond = await read(reader, { at: "after", seq: TAIL });

    expect(texts(backward.entries)).toEqual(lines);
    expect(forward).toEqual(backward.entries);
    expect(runner.calls.length).toBeGreaterThan(fetchedOnce);
    expect(middle.entries).toEqual(backward.entries.slice(1_300, 1_500));
    expect(around.entries).toEqual(backward.entries.slice(-60, -40));
    expect(around.hasEarlier).toBe(true);
    expect(around.hasLater).toBe(true);
    expect(beyond.entries).toEqual([]);
    expect(beyond.hasLater).toBe(false);
  });
});

describe("remote turn activity reader tail", () => {
  it("leaves the unfinished last line of a running turn out and pins the tail it read", async () => {
    const runner = new FakeRunnerEvents();
    runner.output(TASK, claudeTextLine("one") + '{"type":"assis');
    const reader = readerFor(runner);

    const running = await read(reader, { at: "tail" });
    runner.output(TASK, `tant","message":{"content":[{"type":"text","text":"two"}]}}\n`);
    runner.output(TASK, "not json");
    runner.lifecycle(TASK, "task.succeeded");
    const pinned = await read(reader, { at: "after", seq: running.lastSeq });
    const finished = await read(reader, { at: "tail" });

    expect(texts(running.entries)).toEqual(["one"]);
    expect(running.lastSeq).toBe(TAIL);
    expect(pinned.entries).toEqual([]);
    expect(pinned.hasLater).toBe(false);
    expect(texts(finished.entries)).toEqual(["one", "two", "raw:not json"]);
    expect(finished.lastSeq).toBe(TAIL);
  });

  it("answers an empty turn with an empty complete page", async () => {
    const page = await read(readerFor(new FakeRunnerEvents()), { at: "tail" });

    expect(page.entries).toEqual([]);
    expect(page.hasEarlier).toBe(false);
    expect(page.hasLater).toBe(false);
  });

  it("refuses to continue a window it never pinned", async () => {
    const runner = new FakeRunnerEvents();
    runner.output(TASK, claudeTextLine("one"));

    await expect(read(readerFor(runner), { at: "before", seq: TAIL })).rejects.toBeInstanceOf(
      RemoteTurnReaderRevoked,
    );
    expect(runner.calls).toEqual([]);
  });
});

describe("remote turn activity reader limits", () => {
  function sparse(blankChunks: number) {
    const runner = new FakeRunnerEvents();
    const old = numbered(20);
    const recent = numbered(40).slice(20);
    runner.output(TASK, old.map(claudeTextLine).join(""));
    for (let blank = 0; blank < blankChunks; blank += 1) runner.output(TASK, "\n");
    runner.output(TASK, recent.map(claudeTextLine).join(""));
    runner.lifecycle(TASK, "task.succeeded");
    return { runner, old, recent };
  }

  it("scans past raw pages that yield nothing within one bounded read", async () => {
    const { runner, old, recent } = sparse(1_400);
    const reader = readerFor(runner);

    const tail = await read(reader, { at: "tail" });
    const earlier = await read(reader, { at: "before", seq: tail.firstSeq });

    expect(texts(tail.entries)).toEqual(recent);
    expect(tail.hasEarlier).toBe(true);
    expect(runner.calls).toHaveLength(29);
    expect(texts(earlier.entries)).toEqual(old);
    expect(earlier.hasEarlier).toBe(false);
    expect(earlier.lastSeq + 1).toBe(tail.firstSeq);
  });

  it("fails closed at its read cap instead of claiming the start, then resumes", async () => {
    const { runner, old, recent } = sparse(4_000);
    const reader = readerFor(runner);
    const perCall = MAX_REMOTE_TURN_RAW_READS_PER_CALL + MAX_REMOTE_TURN_EMPTY_SCAN_READS;

    const tail = await read(reader, { at: "tail" });
    const anchor: AgentTurnLogAnchor = { at: "before", seq: tail.firstSeq };
    const exhausted = read(reader, anchor);
    await expect(exhausted).rejects.toBeInstanceOf(RemoteTurnReadBudgetExhausted);
    expect(runner.calls).toHaveLength(MAX_REMOTE_TURN_RAW_READS_PER_CALL + perCall);
    const again = await read(reader, { at: "tail" });
    const resumed = await read(reader, anchor);

    expect(texts(tail.entries)).toEqual(recent);
    expect(tail.hasEarlier).toBe(true);
    expect(texts(again.entries)).toEqual([...old, ...recent]);
    expect(again.entries.slice(old.length)).toEqual(tail.entries);
    expect(again.hasEarlier).toBe(false);
    expect(resumed.entries).toEqual(again.entries.slice(0, old.length));
    expect(texts(resumed.entries)).toEqual(old);
    expect(resumed.hasEarlier).toBe(false);
    expect(resumed.lastSeq + 1).toBe(tail.firstSeq);
    expect(runner.calls).toHaveLength(81 + 1);
  });

  it("drops a line above the line cap exactly like the live parser, without calling it clipped", async () => {
    const runner = new FakeRunnerEvents();
    const stream =
      claudeTextLine("first") + claudeTextLine("x".repeat(450_000)) + claudeTextLine("last");
    for (let offset = 0; offset < stream.length; offset += 1_500)
      runner.output(TASK, stream.slice(offset, offset + 1_500));
    runner.lifecycle(TASK, "task.succeeded");

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries)).toEqual([
      "first",
      `raw:${OVERSIZE_AGENT_OUTPUT_LINE_RAW}`,
      "last",
    ]);
    expect(result.window?.clipped).toBe(false);
    expect(result.window?.gap).toBe(false);
  });

  it("reports a line too long to anchor as clipped instead of parsing half of it", async () => {
    const runner = new FakeRunnerEvents();
    const stream =
      claudeTextLine("first") + claudeTextLine("x".repeat(3_000)) + claudeTextLine("last");
    for (let offset = 0; offset < stream.length; offset += 10)
      runner.output(TASK, stream.slice(offset, offset + 10));
    runner.lifecycle(TASK, "task.succeeded");

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries)).toEqual(["first", "last"]);
    expect(result.window?.clipped).toBe(true);
    expect(result.window?.gap).toBe(false);
  });

  it("keeps a dense raw page within the segment cap and says it was clipped", async () => {
    const runner = new FakeRunnerEvents();
    for (let chunk = 0; chunk < 50; chunk += 1) runner.output(TASK, "x\n".repeat(4_096));
    const reader = readerFor(runner);

    const result = await readToStart(reader);
    const again = await readToStart(reader);

    expect(result.entries).toHaveLength(REMOTE_TURN_SEGMENT_LIMITS.maxEvents);
    expectContiguous(result.entries);
    expect(result.entries[result.entries.length - 1]?.seq).toBe(TAIL);
    expect(result.window?.clipped).toBe(true);
    expect(result.window?.hasEarlier).toBe(false);
    expect(again.entries).toEqual(result.entries);
  });

  it("never retains more parsed entries than its cache cap, whatever the pages hold", async () => {
    const runner = new FakeRunnerEvents();
    for (let chunk = 0; chunk < 300; chunk += 1) runner.output(TASK, "x\n".repeat(4_096));
    const raw = new RemoteTurnRawPages(runner, { serverId: "server", taskId: TASK }, () => true);
    const segments = new RemoteTurnSegments(raw, "claude");
    const counts: number[] = [];

    for (let index = 0; index < 6; index += 1) {
      const segment = await segments.load(index, remoteTurnReadBudget());
      counts.push(segment?.entries.length ?? -1);
      segments.trim();
      expect(segments.retained().entries).toBeLessThanOrEqual(MAX_REMOTE_TURN_CACHED_ENTRIES);
      expect(segments.retained().bytes).toBeLessThanOrEqual(MAX_REMOTE_TURN_CACHED_ENTRY_BYTES);
    }

    expect(counts).toEqual(Array.from({ length: 6 }, () => REMOTE_TURN_SEGMENT_LIMITS.maxEvents));
    expect(segments.retained().entries).toBe(MAX_REMOTE_TURN_CACHED_ENTRIES);
    const reloaded = await segments.load(0, remoteTurnReadBudget());
    expect(reloaded?.entries).toHaveLength(REMOTE_TURN_SEGMENT_LIMITS.maxEvents);
    expect(reloaded?.entries[reloaded.entries.length - 1]?.seq).toBe(TAIL);
    expect(reloaded?.clipped).toBe(true);
  });

  it("stops at its raw page cap and says the result was clipped", async () => {
    const runner = new FakeRunnerEvents(1);
    const count = MAX_REMOTE_TURN_RAW_PAGES + 7;
    for (let index = 0; index < count; index += 1) runner.output(TASK, claudeTextLine("l"));

    const result = await readToStart(readerFor(runner));
    const last = result.pages[result.pages.length - 1];

    expect(result.entries).toHaveLength(MAX_REMOTE_TURN_RAW_PAGES);
    expectContiguous(result.entries);
    expect(last?.hasEarlier).toBe(false);
    expect(last?.clipped).toBe(true);
    expect(runner.calls).toHaveLength(MAX_REMOTE_TURN_RAW_PAGES);
  });
});

describe("remote turn activity reader stderr framing", () => {
  function pagesOfFive(build: (runner: FakeRunnerEvents) => void) {
    const runner = new FakeRunnerEvents(5);
    build(runner);
    return runner;
  }

  function filler(runner: FakeRunnerEvents, from: number, count: number): void {
    for (let index = from; index < from + count; index += 1)
      runner.output(TASK, claudeTextLine(`line ${index}`));
  }

  it("looks further back for the start of a stderr line and emits it whole", async () => {
    const runner = pagesOfFive((events) => {
      filler(events, 0, 5);
      events.output(TASK, "prefix ", "stderr");
      filler(events, 5, 4);
      events.output(TASK, "middle ", "stderr");
      filler(events, 9, 4);
      events.output(TASK, "tail\n", "stderr");
      filler(events, 13, 4);
    });

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries).filter((text) => text.startsWith("raw:"))).toEqual([
      "raw:prefix middle tail",
    ]);
    expect(texts(result.entries).filter((text) => !text.startsWith("raw:"))).toHaveLength(17);
    expect(result.window?.clipped).toBe(false);
  });

  it("drops a stderr tail whose start is beyond the look-behind and reports the clip", async () => {
    const runner = pagesOfFive((events) => {
      filler(events, 0, 5);
      events.output(TASK, "prefix ", "stderr");
      filler(events, 5, 4);
      for (let page = 0; page < 5; page += 1) {
        events.output(TASK, "middle ", "stderr");
        filler(events, 9 + page * 4, 4);
      }
      events.output(TASK, "tail\n", "stderr");
      filler(events, 29, 4);
    });

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries).filter((text) => text.startsWith("raw:"))).toEqual([]);
    expect(texts(result.entries)).toHaveLength(33);
    expect(result.window?.clipped).toBe(true);
  });
});

describe("remote turn activity reader server retention", () => {
  function retained(startsAtLineBoundary: boolean, chunkSize: number) {
    const runner = new FakeRunnerEvents();
    const lines = numbered(200);
    const stream = lines.map(claudeTextLine).join("");
    const sequences: number[] = [];
    runner.lifecycle(TASK, "task.created");
    for (let offset = 0; offset < stream.length; offset += chunkSize)
      sequences.push(runner.output(TASK, stream.slice(offset, offset + chunkSize)));
    runner.lifecycle(TASK, "task.succeeded");
    const kept = Math.floor(sequences.length / 2);
    runner.discardOutputThrough(TASK, sequences[kept - 1] ?? 0, startsAtLineBoundary);
    const rest = stream.slice(kept * chunkSize);
    return { runner, lines, rest };
  }

  it("ends at the watermark, drops the cut first line and reports the discard", async () => {
    const { runner, lines, rest } = retained(false, 97);
    const expected = rest
      .slice(rest.indexOf("\n") + 1)
      .split("\n")
      .filter((line) => line !== "").length;

    const result = await readToStart(readerFor(runner));
    const last = result.pages[result.pages.length - 1];

    expect(expected).toBeGreaterThan(50);
    expect(texts(result.entries)).toEqual(lines.slice(lines.length - expected));
    expect(last?.hasEarlier).toBe(false);
    expect(last?.earlierDiscarded).toBe(true);
    expect(result.pages.slice(0, -1).every((page) => page.earlierDiscarded === undefined)).toBe(
      true,
    );
    expect(result.window?.earlierDiscarded).toBe(true);
  });

  it("keeps the first retained line when the server cut at a line boundary", async () => {
    const width = claudeTextLine("line 0000").length;
    const { runner, lines } = retained(true, width);

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries)).toEqual(lines.slice(100));
    expect(result.window?.earlierDiscarded).toBe(true);
  });

  function retainedInput(retainedChunks: number) {
    const runner = new FakeRunnerEvents();
    const lines = numbered(retainedChunks + 30);
    runner.lifecycle(TASK, "task.created");
    runner.input(TASK, "message-1", "follow-up prompt");
    runner.lifecycle(TASK, "task.running");
    const sequences = lines.map((line) => runner.output(TASK, claudeTextLine(line)));
    runner.discardOutputThrough(TASK, sequences[29] ?? 0, true);
    return { runner, lines: lines.slice(30) };
  }

  it("keeps an accepted input that sits below the watermark on the same raw page", async () => {
    const { runner, lines } = retainedInput(20);

    const result = await readToStart(readerFor(runner));

    expect(runner.calls).toHaveLength(1);
    expect(texts(result.entries)).toEqual(["userMessage", ...lines]);
    expect(result.entries[0]?.event).toEqual({
      kind: "userMessage",
      remoteMessageId: "message-1",
      text: "follow-up prompt",
    });
    expect(result.window?.hasEarlier).toBe(false);
    expect(result.window?.earlierDiscarded).toBe(true);
  });

  it("keeps paging below the watermark to an accepted input on an older raw page", async () => {
    const { runner, lines } = retainedInput(99);

    const result = await readToStart(readerFor(runner));
    const last = result.pages[result.pages.length - 1];

    expect(runner.calls).toHaveLength(3);
    expect(texts(result.entries)).toEqual(["userMessage", ...lines]);
    expectContiguous(result.entries);
    expect(last?.hasEarlier).toBe(false);
    expect(last?.earlierDiscarded).toBe(true);
    expect(result.pages.slice(0, -1).every((page) => page.earlierDiscarded === undefined)).toBe(
      true,
    );
  });

  it("frames the first retained line by the watermark even with records below it", async () => {
    const runner = new FakeRunnerEvents();
    const lines = numbered(120);
    const stream = lines.map(claudeTextLine).join("");
    const sequences: number[] = [];
    runner.input(TASK, "message-1", "follow-up prompt");
    for (let offset = 0; offset < stream.length; offset += 97)
      sequences.push(runner.output(TASK, stream.slice(offset, offset + 97)));
    runner.discardOutputThrough(TASK, sequences[39] ?? 0, false);
    const rest = stream.slice(40 * 97);
    const kept = rest.slice(rest.indexOf("\n") + 1).split("\n").length - 1;

    const result = await readToStart(readerFor(runner));

    expect(texts(result.entries)).toEqual(["userMessage", ...lines.slice(lines.length - kept)]);
    expect(result.window?.clipped).toBe(false);
    expect(result.window?.earlierDiscarded).toBe(true);
  });

  it("fails closed when the server history changed under an evicted page", async () => {
    const runner = new FakeRunnerEvents();
    const sequences: number[] = [];
    for (const line of numbered(400)) sequences.push(runner.output(TASK, claudeTextLine(line)));
    const reader = readerFor(runner);
    const before = await readToStart(reader);

    reader.release();
    runner.discardOutputThrough(TASK, sequences[380] ?? 0, true);
    const reread = read(reader, { at: "after", seq: (before.entries[0]?.seq ?? 0) - 1 });

    await expect(reread).rejects.toBeInstanceOf(RemoteTurnHistoryChanged);
    await expect(
      read(reader, { at: "after", seq: (before.entries[0]?.seq ?? 0) - 1 }),
    ).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    const fresh = await readToStart(reader);
    expect(texts(fresh.entries)).toEqual(numbered(400).slice(381));
    expect(fresh.window?.earlierDiscarded).toBe(true);
  });

  it("keeps its seqs and pages when the same tail is opened again", async () => {
    const runner = new FakeRunnerEvents();
    feedClaudeLines(runner, TASK, numbered(600), 97);
    runner.lifecycle(TASK, "task.succeeded");
    const reader = readerFor(runner);

    const tail = await read(reader, { at: "tail" });
    const earlier = await read(reader, { at: "before", seq: tail.firstSeq });
    const calls = runner.calls.length;
    const reopened = await read(reader, { at: "tail" });
    const reread = await read(reader, { at: "before", seq: reopened.firstSeq });

    expect(reopened).toEqual(tail);
    expect(reread).toEqual(earlier);
    expect(runner.calls).toHaveLength(calls + 1);
  });
});

describe("remote turn activity reader trust boundary", () => {
  function twoPages(): FakeRunnerEvents {
    const runner = new FakeRunnerEvents();
    feedClaudeLines(runner, TASK, numbered(200), 97);
    return runner;
  }

  it.each([
    ["unordered", (page) => ({ ...page, items: [...page.items].reverse() })],
    [
      "foreignTask",
      (page) => ({
        ...page,
        items: page.items.map((item, index) => (index === 3 ? { ...item, taskId: "other" } : item)),
      }),
    ],
    [
      "notBefore",
      (page, request) => ({
        ...page,
        items: page.items.map((item, index) =>
          index === page.items.length - 1 && request.before < Number.MAX_SAFE_INTEGER
            ? { ...item, sequence: request.before }
            : item,
        ),
      }),
    ],
    ["inconsistentCursor", (page) => ({ ...page, nextCursor: (page.items[0]?.sequence ?? 0) + 1 })],
    ["inconsistentCursor", (page) => ({ ...page, items: [], nextCursor: 7 })],
  ] satisfies ReadonlyArray<[string, NonNullable<FakeRunnerEvents["tamper"]>]>)(
    "rejects a server page that is %s",
    async (reason, tamper) => {
      const runner = twoPages();
      runner.tamper = tamper;

      await expect(read(readerFor(runner), { at: "tail" })).rejects.toThrow(
        `Invalid remote runner backward event page: ${reason}.`,
      );
    },
  );

  it("rejects a server page with more events than the contract allows", async () => {
    const runner = new FakeRunnerEvents(51);
    for (let index = 0; index < 60; index += 1) runner.output(TASK, claudeTextLine("l"));

    await expect(read(readerFor(runner), { at: "tail" })).rejects.toThrow(
      "Invalid remote runner backward event page: oversized.",
    );
  });

  it("asks nothing once its authority is gone", async () => {
    const runner = twoPages();

    await expect(
      read(
        readerFor(runner, () => false),
        { at: "tail" },
      ),
    ).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    expect(runner.calls).toEqual([]);
  });

  it("discards a response that arrives after its authority was revoked", async () => {
    const runner = twoPages();
    let authorized = true;
    runner.tamper = (page) => {
      authorized = false;
      return page;
    };
    const reader = readerFor(runner, () => authorized);

    await expect(read(reader, { at: "tail" })).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    expect(runner.calls).toHaveLength(1);
    authorized = true;
    runner.tamper = null;
    await expect(
      read(reader, { at: "before", seq: REMOTE_TURN_ACTIVITY_TAIL_SEQ }),
    ).resolves.toMatchObject({ lastSeq: TAIL - 1 });
  });

  it("runs reads one at a time so a new tail never interleaves with the read in flight", async () => {
    const runner = new FakeRunnerEvents();
    feedClaudeLines(runner, TASK, numbered(2_000), 97);
    const reader = readerFor(runner);
    const tail = await read(reader, { at: "tail" });
    const settledCalls = runner.calls.length;
    let repinned: Promise<AgentTurnLogPage> | null = null;
    runner.tamper = (page) => {
      runner.tamper = null;
      repinned = read(reader, { at: "tail" });
      return page;
    };

    const earlier = await read(reader, { at: "before", seq: tail.firstSeq - 600 });
    const again = await repinned;
    const later = runner.calls.slice(settledCalls).map((call) => call.before);

    expect(earlier.lastSeq).toBe(tail.firstSeq - 601);
    expect(again).toEqual(tail);
    expect(later.length).toBeGreaterThan(2);
    expect(later[later.length - 1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(later.slice(0, -1).every((before) => before < Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
