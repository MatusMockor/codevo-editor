import { describe, expect, it } from "vitest";
import type { RemoteRunnerEvent, RemoteRunnerEventsBeforeRequest } from "../domain/remoteRunner";
import {
  RemoteInventoryRevoked,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { RemoteAgentProjection } from "./remoteAgentProjection";
import { REMOTE_OUTPUT_DISCARDED_ERROR } from "./remoteAgentReplayWindow";
import {
  emitStreamTurn,
  fakeRunnerGateway,
  lastOf,
  lineNumbers,
  loadTailFirst,
  loadUntilSettled,
  numberedLines,
  projectedTurn,
  projectedTurns,
  remoteTurn,
  replayState,
  TAIL_FIRST_THREAD,
  turnText,
  type StreamTurn,
} from "./remoteAgentTailFirstTestSupport";
import {
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
  REMOTE_BACKFILL_PAGES_PER_LIVE_POLL,
  remoteReplayBackfillPending,
} from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

const TAIL = Number.MAX_SAFE_INTEGER;
const LINES = 400;

function longTurn(runner: FakeRunnerEvents, taskId: string): void {
  emitStreamTurn(runner, taskId, { lines: LINES });
}

function lineAlignedTurn(runner: FakeRunnerEvents, taskId: string, count: number): void {
  for (const line of numberedLines(count)) runner.output(taskId, claudeTextLine(line));
  runner.lifecycle(taskId, "task.succeeded");
}

function consecutive(numbers: readonly number[]): boolean {
  return numbers.every((value, index) => index === 0 || value === numbers[index - 1]! + 1);
}

function upTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function outputBytes(events: readonly RemoteRunnerEvent[]): number {
  return events.reduce((sum, event) => sum + (event.text?.length ?? 0) * 2, 0);
}

function recorded() {
  const snapshots: RemoteAgentInventorySnapshot[] = [];
  return {
    snapshots,
    record: (snapshot: RemoteAgentInventorySnapshot) => {
      snapshots.push(snapshot);
    },
    firstWith: (taskId: string) => snapshots.find((snapshot) => snapshot.replays.has(taskId)),
  };
}

function incrementalTurns(snapshots: readonly RemoteAgentInventorySnapshot[]) {
  const projection = new RemoteAgentProjection();
  let turns;
  for (const snapshot of snapshots)
    turns = projection
      .project({ ...snapshot, runnerId: "runner" })
      .find((view) => view.thread.threadId === TAIL_FIRST_THREAD)?.thread.turns;
  return turns;
}

describe("remote inventory tail-first replay", () => {
  it("opens a long turn from its newest page before any older page is requested", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const all = runner.eventsOf("turn-1");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();
    const reads: number[] = [];

    await loadTailFirst(h.gateway, undefined, (snapshot) => {
      progress.record(snapshot);
      reads.push(h.backward().length);
    });
    const opened = progress.firstWith("turn-1")!;
    const oldest = all[all.length - 50]!.sequence;

    expect(h.backward()[0]).toEqual({ serverId: "server", taskId: "turn-1", before: TAIL });
    expect(reads[progress.snapshots.indexOf(opened)]).toBe(1);
    expect(h.forward()).toEqual([]);
    expect(all.length).toBeGreaterThan(300);
    expect(opened.replays.get("turn-1")).toEqual(all.slice(-50));
    expect(opened.replayCursors?.get("turn-1")).toBe(lastOf(all)?.sequence);
    expect(opened.replayComplete.has("turn-1")).toBe(true);
    expect(opened.replayTruncated.has("turn-1")).toBe(true);
    expect(opened.replayDiscarded?.has("turn-1")).toBe(false);
    expect(opened.replayBackfill?.get("turn-1")).toEqual({
      kind: "pending",
      before: oldest,
      truncated: false,
      gap: undefined,
    });
    expect(opened.replayGaps?.get("turn-1")).toEqual({
      throughSequence: oldest - 1,
      startsAtLineBoundary: false,
    });
    expect(opened.error).toBeNull();
    const turn = projectedTurn(opened, "turn-1");
    const shown = lineNumbers(turnText(turn?.events ?? []));
    expect(turn?.eventsTruncated).toBe(true);
    expect(turn?.eventsRetention).toBe("clientWindow");
    expect(turn?.status).toEqual({ kind: "exited", exitCode: 0 });
    expect(lastOf(shown)).toBe(LINES - 1);
    expect(shown[0]).toBeGreaterThan(LINES - 80);
    expect(consecutive(shown)).toBe(true);
  });

  it.each<{ name: string; turn: StreamTurn; discard?: { at: number; boundary: boolean } }>([
    {
      name: "split lines, stderr and steering messages on both sides of page seams",
      turn: { lines: 400, steerFromEnd: [49, 50, 99, 100, 149, 213], stderrEvery: 23 },
    },
    {
      name: "a server discard that starts at a line boundary",
      turn: { lines: 400, steerFromEnd: [49, 150] },
      discard: { at: 120, boundary: true },
    },
    {
      name: "a server discard that cuts a line",
      turn: { lines: 400, steerFromEnd: [50, 100] },
      discard: { at: 171, boundary: false },
    },
    {
      name: "more events than the retained window holds",
      turn: { lines: 1_700, steerFromEnd: [49, 50, 600] },
    },
    {
      name: "more bytes than the retained window holds",
      turn: {
        lines: 150,
        steerFromEnd: [10],
        lineText: (index) => `line ${String(index).padStart(4, "0")} ${"x".repeat(31_000)}`,
      },
    },
  ])("ends in the state the forward loader builds for $name", async ({ turn, discard }) => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", turn);
    if (discard !== undefined)
      runner.discardOutputThrough(
        "turn-1",
        runner.eventsOf("turn-1")[discard.at]!.sequence,
        discard.boundary,
      );
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const tailFirst = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadUntilSettled(tailFirst.gateway, runner, progress.record);

    expect(tailFirst.forward()).toEqual([]);
    expect(remoteReplayBackfillPending(actual)).toBe(false);
    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(incrementalTurns([...progress.snapshots, actual])).toEqual(projectedTurns(expected));
  });

  it("preserves a complete stdout line when only task.created is evicted at exhaustion", async () => {
    const runner = new FakeRunnerEvents();
    runner.lifecycle("turn-1", "task.created");
    runner.output("turn-1", claudeTextLine("complete line"));
    for (let index = 1; index < 1_100; index += 1) runner.output("turn-1", "");
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadUntilSettled(backward.gateway, runner, progress.record);

    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(incrementalTurns([...progress.snapshots, actual])).toEqual(projectedTurns(expected));
    expect(turnText(projectedTurn(actual, "turn-1")!.events)).toBe("complete line");
    expect(actual.replayGaps?.has("turn-1")).toBe(false);
  });

  it("derives stdout framing at exhaustion when only stderr output was evicted", async () => {
    const runner = new FakeRunnerEvents();
    runner.lifecycle("turn-1", "task.created");
    for (let index = 0; index < 1_200; index += 1) runner.output("turn-1", "", "stderr");
    runner.output("turn-1", claudeTextLine("complete line"));
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadUntilSettled(backward.gateway, runner);

    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(turnText(projectedTurn(actual, "turn-1")!.events)).toBe("complete line");
  });

  it.each(["complete", "partial"] as const)(
    "finds %s evicted stdout framing across a stderr-only window",
    async (framing) => {
      const runner = new FakeRunnerEvents();
      runner.lifecycle("turn-1", "task.created");
      const line = claudeTextLine("complete line");
      runner.output(
        "turn-1",
        framing === "complete" ? claudeTextLine("older line") : line.slice(0, 30),
      );
      for (let index = 0; index < 1_200; index += 1) runner.output("turn-1", "", "stderr");
      runner.output("turn-1", framing === "complete" ? line : line.slice(30));
      runner.discardOutputThrough("turn-1", 1, true);
      const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
      const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);

      const expected = await loadUntilSettled(forward.gateway, runner);
      const actual = await loadUntilSettled(backward.gateway, runner);

      expect(replayState(actual)).toEqual(replayState(expected));
      expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
      expect(actual.replayGaps?.get("turn-1")?.startsAtLineBoundary).toBe(framing === "complete");
    },
  );

  it("keeps unknown stdout framing across forward eviction while input scanning", async () => {
    const runner = new FakeRunnerEvents();
    runner.lifecycle("turn-1", "task.created");
    for (let index = 0; index < 2_000; index += 1) runner.output("turn-1", "", "stderr");
    runner.output("turn-1", claudeTextLine("first line "));
    const task = remoteTurn(1, { status: "running" });
    const backward = fakeRunnerGateway(runner, [task]);
    const first = await loadTailFirst(backward.gateway);
    expect(first.replayBackfill?.get("turn-1")).toMatchObject({
      kind: "scanningInputs",
      stdoutBoundary: { kind: "pending" },
    });
    runner.output("turn-1", claudeTextLine("new line"));
    const forward = fakeRunnerGateway(runner, [task], {});

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadTailFirst(backward.gateway, first);

    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(turnText(projectedTurn(actual, "turn-1")!.events)).toBe("first line new line");
  });

  it("stops retaining output at the window and finishes scanning inputs on the next pass", async () => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", { lines: 1_700 });
    const all = runner.eventsOf("turn-1");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);

    const first = await loadTailFirst(h.gateway);
    const pages = h.backward().length;
    const second = await loadTailFirst(h.gateway, first);
    const replay = first.replays.get("turn-1")!;
    const retainedFrom = all.indexOf(replay[0]!);

    expect(replay).toHaveLength(1_100);
    expect(first.replayBackfill?.get("turn-1")).toMatchObject({ kind: "scanningInputs" });
    expect(second.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
    expect(first.replayTruncated.has("turn-1")).toBe(true);
    expect(first.replayDiscarded?.has("turn-1")).toBe(false);
    expect(first.replayGaps?.get("turn-1")).toEqual({
      throughSequence: all[retainedFrom - 1]!.sequence,
      startsAtLineBoundary: all[retainedFrom - 1]!.text?.endsWith("\n") === true,
    });
    expect(pages).toBe(1 + MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS);
    expect(h.backward()).toHaveLength(Math.ceil(all.length / 50));
    expect(second.replays.get("turn-1")).toBe(replay);
    expect(projectedTurn(first, "turn-1")?.eventsRetention).toBe("clientWindow");
  });

  it("collects steering messages far below the retained output window", async () => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", { lines: 1_700, steerFromEnd: [1_300] });
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const tailFirst = fakeRunnerGateway(runner, [remoteTurn(1)]);

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadUntilSettled(tailFirst.gateway, runner);
    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(expected.replays.get("turn-1")![0]?.type).toBe("task.input");
    expect(actual.replays.get("turn-1")!.some((event) => event.type === "task.input")).toBe(true);
  });

  it("resumes an unfinished backfill on the next pass from its stored cursor", async () => {
    const runner = new FakeRunnerEvents(10);
    emitStreamTurn(runner, "turn-1", { lines: 700, steerFromEnd: [9, 10, 250] });
    const all = runner.eventsOf("turn-1");
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);

    const first = await loadTailFirst(h.gateway);
    const stored = first.replayBackfill?.get("turn-1");

    expect(h.backward()).toHaveLength(1 + MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS);
    expect(first.replays.get("turn-1")).toEqual(all.slice(-250));
    expect(stored).toEqual({
      kind: "pending",
      before: all[all.length - 250]!.sequence,
      truncated: false,
      gap: undefined,
    });
    expect(remoteReplayBackfillPending(first)).toBe(true);
    expect(projectedTurn(first, "turn-1")?.eventsTruncated).toBe(true);

    h.calls.listEventsBefore.mockClear();
    const second = await loadTailFirst(h.gateway, first);

    expect(h.backward()).toHaveLength(MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS);
    expect(h.backward()[0]?.before).toBe(all[all.length - 250]!.sequence);
    expect(second.replays.get("turn-1")).toEqual(all.slice(-490));

    const expected = await loadUntilSettled(forward.gateway, runner);
    const actual = await loadUntilSettled(h.gateway, runner);

    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    expect(projectedTurn(actual, "turn-1")?.eventsTruncated).toBe(false);
  });

  it("resumes a backfill after a failed page from the last applied page", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const all = runner.eventsOf("turn-1");
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    h.calls.listEventsBefore.mockImplementation(
      async (request: RemoteRunnerEventsBeforeRequest) => {
        if (h.backward().length === 4) return Promise.reject(new Error("Request timed out."));
        return runner.listEventsBefore(request);
      },
    );
    const progress = recorded();

    await expect(loadTailFirst(h.gateway, undefined, progress.record)).rejects.toThrow(
      "Request timed out.",
    );
    const kept = lastOf(progress.snapshots)!;

    expect(kept.replays.get("turn-1")).toEqual(all.slice(-150));
    expect(kept.replayBackfill?.get("turn-1")).toMatchObject({
      kind: "pending",
      before: all[all.length - 150]!.sequence,
    });

    h.calls.listEventsBefore.mockClear();
    h.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
    const resumed = await loadTailFirst(h.gateway, kept);
    const expected = await loadUntilSettled(forward.gateway, runner);

    expect(h.backward()[0]).toEqual({
      serverId: "server",
      taskId: "turn-1",
      before: all[all.length - 150]!.sequence,
    });
    expect(replayState(resumed)).toEqual(replayState(expected));
    expect(projectedTurns(resumed)).toEqual(projectedTurns(expected));
  });

  it("applies new events of the running turn between backfill pages without repeating any", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    emitStreamTurn(runner, "turn-2", { lines: 300, end: "open" });
    const split = claudeTextLine("line 0300 ");
    runner.output("turn-2", split.slice(0, 31));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2, { status: "running" })]);
    let arrived = 0;
    h.calls.listEventsBefore.mockImplementation(
      async (request: RemoteRunnerEventsBeforeRequest) => {
        const page = await runner.listEventsBefore(request);
        if (request.before === TAIL && request.taskId === "turn-2")
          runner.output("turn-2", split.slice(31));
        if (request.before !== TAIL) {
          arrived += 1;
          runner.output(
            "turn-2",
            claudeTextLine(`line ${String(300 + arrived).padStart(4, "0")} `),
          );
        }
        return page;
      },
    );
    const forward = fakeRunnerGateway(
      runner,
      [remoteTurn(1), remoteTurn(2, { status: "running" })],
      {},
    );
    const progress = recorded();

    const first = await loadTailFirst(h.gateway, undefined, progress.record);
    const backfillPages = h.backward().length - 2;
    const polls = h.forward();
    const sequences = first.replays.get("turn-2")!.map((event) => event.sequence);

    expect(backfillPages).toBeGreaterThan(8);
    expect(polls).toHaveLength(Math.floor(backfillPages / REMOTE_BACKFILL_PAGES_PER_LIVE_POLL));
    expect(polls.every((request) => request.taskId === "turn-2")).toBe(true);
    expect(polls.map((request) => request.after)).toEqual(
      [...polls.map((request) => request.after)].sort((left, right) => left - right),
    );
    expect(polls[0]?.after).toBe(progress.firstWith("turn-2")?.replayCursors?.get("turn-2"));
    expect(sequences).toEqual([...new Set(sequences)].sort((left, right) => left - right));
    expect(first.replayComplete.has("turn-2")).toBe(false);

    const settled = await loadUntilSettled(h.gateway, runner);
    const expected = await loadUntilSettled(forward.gateway, runner);
    const shown = lineNumbers(turnText(projectedTurn(settled, "turn-2")?.events ?? []));

    expect(shown).toEqual(upTo(301 + arrived));
    expect(replayState(settled)).toEqual(replayState(expected));
    expect(projectedTurns(settled)).toEqual(projectedTurns(expected));
  });

  it("stops a backfill whose owner was revoked and reports nothing afterwards", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    let valid = true;
    h.calls.listEventsBefore.mockImplementation(
      async (request: RemoteRunnerEventsBeforeRequest) => {
        valid = h.backward().length < 3;
        return runner.listEventsBefore(request);
      },
    );
    const progress = recorded();

    await expect(
      loadTailFirst(h.gateway, undefined, progress.record, () => valid),
    ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

    expect(h.backward()).toHaveLength(3);
    expect(lastOf(progress.snapshots)?.replays.get("turn-1")).toHaveLength(100);
  });

  it("rejects a backfill page that overlaps the loaded replay and keeps what was applied", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const all = runner.eventsOf("turn-1");
    runner.tamper = (page, request) => {
      if (request.before === TAIL) return page;
      return { ...page, items: [...page.items.slice(0, -1), all[all.length - 50]!] };
    };
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    await expect(loadTailFirst(h.gateway, undefined, progress.record)).rejects.toThrow(
      "Invalid remote runner backward event page: notBefore.",
    );

    expect(lastOf(progress.snapshots)?.replays.get("turn-1")).toEqual(all.slice(-50));
    expect(lastOf(progress.snapshots)?.replayBackfill?.get("turn-1")).toMatchObject({
      kind: "pending",
      before: all[all.length - 50]!.sequence,
    });
  });

  it("reports nothing earlier when the newest page is the whole history", async () => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", { lines: 12 });
    const tailFirst = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const forwardOnly = fakeRunnerGateway(runner, [remoteTurn(1)], {});

    const result = await loadTailFirst(tailFirst.gateway);
    const legacy = await loadTailFirst(forwardOnly.gateway);

    expect(tailFirst.backward()).toHaveLength(1);
    expect(tailFirst.forward()).toEqual([]);
    expect(result.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(replayState(result)).toEqual(replayState(legacy));
    const turn = projectedTurn(result, "turn-1");
    expect(turn?.eventsTruncated).toBe(false);
    expect(turn?.eventsRetention).toBeUndefined();
    expect(lineNumbers(turnText(turn?.events ?? []))).toEqual(upTo(12));
  });

  it("continues a streaming turn after its newest sequence on the next pass", async () => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", { lines: 40, end: "open" });
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
    const first = await loadTailFirst(h.gateway);
    const newest = first.replayCursors?.get("turn-1");
    runner.output("turn-1", claudeTextLine("line 0040 "));

    const second = await loadTailFirst(h.gateway, first);
    runner.lifecycle("turn-1", "task.succeeded");
    h.replaceTasks([remoteTurn(1)]);
    const third = await loadTailFirst(h.gateway, second);
    h.calls.listEvents.mockClear();
    const progress = recorded();
    const settled = await loadTailFirst(h.gateway, third, progress.record);

    expect(h.backward()).toHaveLength(1);
    expect(first.replayComplete.has("turn-1")).toBe(false);
    expect(lineNumbers(turnText(projectedTurn(second, "turn-1")?.events ?? []))).toEqual(upTo(41));
    expect(newest).toBe(lastOf(first.replays.get("turn-1")!)?.sequence);
    expect(second.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1").slice(0, -1));
    expect(third.replayComplete.has("turn-1")).toBe(true);
    expect(projectedTurn(third, "turn-1")?.status).toEqual({ kind: "exited", exitCode: 0 });
    expect(h.forward()).toEqual([]);
    expect(progress.snapshots).toEqual([]);
    expect(settled.replays.get("turn-1")).toBe(third.replays.get("turn-1"));
  });

  it("keeps the forward path when the runner cannot page backward", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const all = runner.eventsOf("turn-1");
    const unsupported = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const unimplemented = fakeRunnerGateway(runner, [remoteTurn(1)]);
    Reflect.deleteProperty(unimplemented.calls, "listEventsBefore");
    const progress = recorded();

    const result = await loadTailFirst(unsupported.gateway, undefined, progress.record);
    const second = await loadTailFirst(unimplemented.gateway);

    expect(unsupported.backward()).toEqual([]);
    expect(unsupported.forward()[0]).toEqual({ serverId: "server", taskId: "turn-1", after: 0 });
    expect(unsupported.forward()).toHaveLength(Math.ceil(all.length / 50));
    expect(result.replays.get("turn-1")).toEqual(all);
    expect(result.replayTruncated.has("turn-1")).toBe(false);
    expect(result.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(projectedTurn(result, "turn-1")?.eventsTruncated).toBe(false);
    expect(progress.snapshots).toHaveLength(2);
    expect(progress.snapshots[0]?.replayTruncated.has("turn-1")).toBe(true);
    expect(progress.snapshots[0]?.replays.has("turn-1")).toBe(false);
    expect(lastOf(progress.snapshots)?.replayComplete.has("turn-1")).toBe(true);
    expect(second.replays.get("turn-1")).toEqual(all);
    expect(unimplemented.forward()[0]?.after).toBe(0);
  });

  it("loads the newest page of every turn, newest turn first, before any older page", async () => {
    const runner = new FakeRunnerEvents();
    for (const index of [1, 2, 3]) longTurn(runner, `turn-${index}`);
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);
    const progress: { snapshot: RemoteAgentInventorySnapshot; eventReads: number }[] = [];

    const result = await loadTailFirst(h.gateway, undefined, (snapshot) =>
      progress.push({ snapshot, eventReads: h.backward().length }),
    );
    const requests = h.backward();

    expect(requests.slice(0, 3)).toEqual(
      ["turn-3", "turn-2", "turn-1"].map((taskId) => ({
        serverId: "server",
        taskId,
        before: TAIL,
      })),
    );
    expect(requests.slice(3).every((request) => request.before !== TAIL)).toBe(true);
    expect(requests[3]?.taskId).toBe("turn-3");
    expect(progress.slice(0, 4).map((entry) => entry.eventReads)).toEqual([0, 1, 2, 3]);
    expect(progress.slice(0, 4).map((entry) => [...entry.snapshot.replays.keys()])).toEqual([
      [],
      ["turn-3"],
      ["turn-3", "turn-2"],
      ["turn-3", "turn-2", "turn-1"],
    ]);
    expect(progress[0]?.snapshot.tasks.map((task) => task.id)).toEqual([
      "turn-3",
      "turn-2",
      "turn-1",
    ]);
    expect([...(progress[0]?.snapshot.replayTruncated ?? [])].sort()).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
    ]);
    expect(progress[1]?.snapshot.replays.get("turn-3")).toEqual(
      runner.eventsOf("turn-3").slice(-50),
    );
    expect(h.calls.getTaskResume.mock.invocationCallOrder[0]).toBeLessThan(
      h.calls.listEventsBefore.mock.invocationCallOrder[1]!,
    );
    expect(result.resumes.get("turn-3")).toEqual({ available: true, reason: null });
    expect(result.replayTruncated.size).toBe(0);
    expect([...result.replayComplete].sort()).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  it("shows a turn as not loaded until its replay proves it complete", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-2");
    runner.output("turn-1", claudeTextLine("line 0000 "));
    runner.lifecycle("turn-1", "task.succeeded");
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const projection = new RemoteAgentProjection();
    const shown: (boolean | undefined)[][] = [];
    const project = (snapshot: RemoteAgentInventorySnapshot) =>
      projection
        .project({ ...snapshot, runnerId: "runner" })
        .find((view) => view.thread.threadId === TAIL_FIRST_THREAD)
        ?.thread.turns.map((turn) => turn.eventsTruncated) ?? [];

    const result = await loadTailFirst(h.gateway, undefined, (snapshot) =>
      shown.push(project(snapshot)),
    );

    expect(shown.slice(0, 3)).toEqual([
      [true, true],
      [true, true],
      [false, true],
    ]);
    expect(shown.slice(3, -1).every(([, newest]) => newest === true)).toBe(true);
    expect(lastOf(shown)).toEqual([false, false]);
    expect(project(result)).toEqual([false, false]);
    expect(result.replayTruncated.size).toBe(0);
  });

  it("resumes from the last reported page after a newest page fails", async () => {
    const runner = new FakeRunnerEvents();
    runner.output("turn-1", claudeTextLine("line 0000 "));
    runner.lifecycle("turn-1", "task.succeeded");
    for (const index of [2, 3]) longTurn(runner, `turn-${index}`);
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);
    h.calls.listEventsBefore.mockImplementation(
      async (request: RemoteRunnerEventsBeforeRequest) => {
        if (request.taskId === "turn-2") return Promise.reject(new Error("Request timed out."));
        return runner.listEventsBefore(request);
      },
    );
    const progress = recorded();

    await expect(loadTailFirst(h.gateway, undefined, progress.record)).rejects.toThrow(
      "Request timed out.",
    );
    const kept = lastOf(progress.snapshots)!;
    const stored = kept.replayBackfill?.get("turn-3");

    expect([...kept.replays.keys()]).toEqual(["turn-3"]);
    expect([...kept.replayTruncated].sort()).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(kept.replayCursors?.get("turn-3")).toBe(lastOf(runner.eventsOf("turn-3"))?.sequence);
    expect(kept.replayCursors?.has("turn-2")).toBe(false);
    expect(stored?.kind).toBe("pending");

    h.calls.listEventsBefore.mockClear();
    h.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
    const resumed = await loadTailFirst(h.gateway, kept);

    expect(h.backward().slice(0, 3)).toEqual([
      { serverId: "server", taskId: "turn-2", before: TAIL },
      { serverId: "server", taskId: "turn-1", before: TAIL },
      {
        serverId: "server",
        taskId: "turn-3",
        before: runner.eventsOf("turn-3").slice(-50)[0]!.sequence,
      },
    ]);
    expect(h.forward()).toEqual([]);
    expect(resumed.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
    expect(resumed.replays.get("turn-2")).toEqual(runner.eventsOf("turn-2"));
    expect(resumed.replays.get("turn-3")).toEqual(runner.eventsOf("turn-3"));
    expect(resumed.replayTruncated.size).toBe(0);
  });

  it("stays truthful about output the server discarded before the newest page", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const discardedThrough = runner.eventsOf("turn-1")[20]!.sequence;
    runner.discardOutputThrough("turn-1", discardedThrough, true);
    const kept = runner.eventsOf("turn-1");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    const result = await loadTailFirst(h.gateway, undefined, progress.record);
    const opened = progress.firstWith("turn-1")!;

    expect(opened.replayDiscarded?.has("turn-1")).toBe(true);
    expect(opened.replayServerEvictions?.get("turn-1")).toBe(discardedThrough);
    expect(opened.replayGaps?.get("turn-1")).toEqual({
      throughSequence: kept[kept.length - 50]!.sequence - 1,
      startsAtLineBoundary: false,
    });
    expect(opened.error).toBe(REMOTE_OUTPUT_DISCARDED_ERROR);
    expect(projectedTurn(opened, "turn-1")?.eventsRetention).toBe("serverGap");
    expect(result.replays.get("turn-1")).toEqual(kept);
    expect(result.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(result.replayGaps?.get("turn-1")).toEqual({
      throughSequence: discardedThrough,
      startsAtLineBoundary: true,
    });
    expect(result.error).toBe(REMOTE_OUTPUT_DISCARDED_ERROR);
    expect(projectedTurn(result, "turn-1")?.eventsRetention).toBe("serverGap");
  });

  it.each([
    { startsAtLineBoundary: true, first: 80 },
    { startsAtLineBoundary: false, first: 81 },
  ])(
    "frames the newest page from a server discard inside it (line boundary $startsAtLineBoundary)",
    async ({ startsAtLineBoundary, first }) => {
      const runner = new FakeRunnerEvents();
      const lines = numberedLines(100);
      for (let index = 0; index < 20; index += 1)
        runner.input("turn-1", `early-${index}`, `early ${index}`);
      for (const line of lines.slice(0, 60)) runner.output("turn-1", claudeTextLine(line));
      for (let index = 0; index < 10; index += 1)
        runner.input("turn-1", `mid-${index}`, `mid ${index}`);
      for (const line of lines.slice(60)) runner.output("turn-1", claudeTextLine(line));
      runner.lifecycle("turn-1", "task.succeeded");
      const discardedThrough = runner
        .eventsOf("turn-1")
        .find((event) => event.text?.includes("line 0079 "))!.sequence;
      runner.discardOutputThrough("turn-1", discardedThrough, startsAtLineBoundary);
      const kept = runner.eventsOf("turn-1");
      const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
      const progress = recorded();

      const result = await loadTailFirst(h.gateway, undefined, progress.record);
      const opened = progress.firstWith("turn-1")!;

      expect(kept).toHaveLength(51);
      expect(opened.replays.get("turn-1")).toEqual(kept.slice(1));
      for (const snapshot of [opened, result]) {
        const turn = projectedTurn(snapshot, "turn-1");
        expect(snapshot.replayGaps?.get("turn-1")).toEqual({
          throughSequence: discardedThrough,
          startsAtLineBoundary,
        });
        expect(snapshot.replayTruncated.has("turn-1")).toBe(true);
        expect(snapshot.replayDiscarded?.has("turn-1")).toBe(true);
        expect(turn?.eventsRetention).toBe("serverGap");
        expect(lineNumbers(turnText(turn?.events ?? []))).toEqual(upTo(100).slice(first));
      }
      expect(result.replays.get("turn-1")).toEqual(kept);
    },
  );

  it("restores the line cut by the unloaded start once the older page arrives", async () => {
    const runner = new FakeRunnerEvents();
    lineAlignedTurn(runner, "turn-1", 120);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    const result = await loadTailFirst(h.gateway, undefined, progress.record);
    const opened = lineNumbers(
      turnText(projectedTurn(progress.firstWith("turn-1")!, "turn-1")?.events ?? []),
    );

    expect(opened).toEqual(upTo(120).slice(72));
    expect(lineNumbers(turnText(projectedTurn(result, "turn-1")?.events ?? []))).toEqual(upTo(120));
    expect(
      lineNumbers(turnText(incrementalTurns([...progress.snapshots, result])?.[0]?.events ?? [])),
    ).toEqual(upTo(120));
  });

  it.each([
    {
      name: "a cursor that does not match its oldest event",
      tamper: (items: readonly RemoteRunnerEvent[]) => ({ items, nextCursor: 1 }),
      rejection: "inconsistentCursor",
    },
    {
      name: "events of another task",
      tamper: (items: readonly RemoteRunnerEvent[]) => ({
        items: items.map((event) => ({ ...event, taskId: "foreign" })),
        nextCursor: items[0]!.sequence,
      }),
      rejection: "foreignTask",
    },
    {
      name: "more events than a page may hold",
      tamper: (items: readonly RemoteRunnerEvent[]) => ({
        items: [{ ...items[0]!, sequence: items[0]!.sequence - 1 }, ...items],
        nextCursor: items[0]!.sequence - 1,
      }),
      rejection: "oversized",
    },
  ])("rejects a newest page with $name", async ({ tamper, rejection }) => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    runner.tamper = (page) => tamper(page.items);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const progress = recorded();

    await expect(loadTailFirst(h.gateway, undefined, progress.record)).rejects.toThrow(
      `Invalid remote runner backward event page: ${rejection}.`,
    );
    expect(progress.snapshots.every((snapshot) => snapshot.replays.size === 0)).toBe(true);
  });

  it("rejects a duplicate forward page without regressing the loaded replay", async () => {
    const runner = new FakeRunnerEvents();
    emitStreamTurn(runner, "turn-1", { lines: 40, end: "open" });
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
    const first = await loadTailFirst(h.gateway);
    const replay = first.replays.get("turn-1")!;
    const cursor = first.replayCursors?.get("turn-1");
    h.calls.listEvents.mockResolvedValueOnce({ items: replay.slice(-2), nextCursor: null });

    await expect(loadTailFirst(h.gateway, first)).rejects.toThrow("invalid event ordering");

    expect(first.replays.get("turn-1")).toBe(replay);
    expect(first.replayCursors?.get("turn-1")).toBe(cursor);
    const recovered = await loadTailFirst(h.gateway, first);
    expect(recovered.replays.get("turn-1")).toEqual(replay);
  });

  it("stops without reporting a newest page that arrives after its owner was revoked", async () => {
    const runner = new FakeRunnerEvents();
    longTurn(runner, "turn-1");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    let valid = true;
    h.calls.listEventsBefore.mockImplementationOnce(
      async (request: RemoteRunnerEventsBeforeRequest) => {
        valid = false;
        return runner.listEventsBefore(request);
      },
    );
    const progress = recorded();

    await expect(
      loadTailFirst(h.gateway, undefined, progress.record, () => valid),
    ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

    expect(progress.snapshots).toHaveLength(1);
    expect(progress.snapshots[0]?.replays.size).toBe(0);
    expect(h.calls.getTaskResume).not.toHaveBeenCalled();
  });

  it("reads a turn without events once backward and then forward from its start", async () => {
    const runner = new FakeRunnerEvents();
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "queued" })]);

    const first = await loadTailFirst(h.gateway);
    runner.output("turn-1", claudeTextLine("line 0000 "));
    const second = await loadTailFirst(h.gateway, first);

    expect(first.replays.get("turn-1")).toEqual([]);
    expect(first.replayCursors?.get("turn-1")).toBe(0);
    expect(first.replayTruncated.has("turn-1")).toBe(false);
    expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(h.backward()).toHaveLength(1);
    expect(h.forward()).toEqual([{ serverId: "server", taskId: "turn-1", after: 0 }]);
    expect(second.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
    expect(second.replayTruncated.has("turn-1")).toBe(false);
  });

  it("holds the per-turn byte budgets without backfilling turns that are already full", async () => {
    const runner = new FakeRunnerEvents();
    for (const index of [1, 2, 3])
      for (let chunk = 0; chunk < 60; chunk += 1)
        runner.output(`turn-${index}`, `${"x".repeat(99_999)}\n`);
    const tasks = [remoteTurn(1), remoteTurn(2), remoteTurn(3)];
    const h = fakeRunnerGateway(runner, tasks);
    const forward = fakeRunnerGateway(runner, tasks, {});

    const result = await loadTailFirst(h.gateway);
    const legacy = await loadTailFirst(forward.gateway);

    expect(h.backward()).toHaveLength(6);
    expect(forward.forward()).toHaveLength(6);
    expect(replayState(result)).toEqual(replayState(legacy));
    expect(outputBytes(result.replays.get("turn-3")!)).toBeLessThanOrEqual(3_000_000);
    expect(outputBytes(result.replays.get("turn-3")!)).toBeGreaterThan(2_800_000);
    for (const older of ["turn-2", "turn-1"]) {
      const events = result.replays.get(older)!;
      expect(outputBytes(events)).toBeLessThanOrEqual(1_500_000);
      expect(result.replayCursors?.get(older)).toBe(lastOf(runner.eventsOf(older))?.sequence);
      expect(result.replayGaps?.get(older)?.throughSequence).toBe(events[0]!.sequence - 1);
      expect(result.replayGaps?.get(older)?.startsAtLineBoundary).toBe(true);
      expect(result.replayBackfill?.get(older)).toEqual({ kind: "retained" });
      expect(result.replayTruncated.has(older)).toBe(true);
      expect(result.replayDiscarded?.has(older)).toBe(false);
    }
  });
});
