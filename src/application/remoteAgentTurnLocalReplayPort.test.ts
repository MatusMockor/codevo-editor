import { describe, expect, it } from "vitest";
import type { RemoteRunnerEvent } from "../domain/remoteRunner";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { MAX_REMOTE_REPLAY_INPUTS } from "./remoteAgentReplayWindow";
import {
  remoteAgentTurnLocalReplayPort,
  remoteTurnLocalReplayOf,
  remoteTurnLocalReplayPage,
  type RemoteTurnLocalReplay,
} from "./remoteAgentTurnLocalReplayPort";
import { FakeRunnerEvents, loadedRemoteReplay } from "./remoteAgentTurnActivityTestSupport";

const TASK = "task";
const WINDOW_BYTES = 3_000_000;

interface Layout {
  readonly name: string;
  readonly chunks: number;
  readonly chunkChars: number;
  readonly inputEvery: number;
}

const LAYOUTS: ReadonlyArray<Layout> = [
  { name: "an untruncated replay", chunks: 300, chunkChars: 40, inputEvery: 0 },
  { name: "a count-evicted replay", chunks: 1_500, chunkChars: 40, inputEvery: 0 },
  { name: "a byte-evicted replay", chunks: 400, chunkChars: 8_000, inputEvery: 0 },
  { name: "few inputs left below the output", chunks: 1_500, chunkChars: 40, inputEvery: 100 },
  { name: "inputs dropped above the output", chunks: 1_500, chunkChars: 40, inputEvery: 20 },
  {
    name: "all retained inputs spanning the output",
    chunks: 2_000,
    chunkChars: 40,
    inputEvery: 40,
  },
  { name: "byte eviction with inputs", chunks: 600, chunkChars: 8_000, inputEvery: 7 },
];

function build(layout: Layout): FakeRunnerEvents {
  const runner = new FakeRunnerEvents();
  runner.lifecycle(TASK, "task.created");
  for (let index = 0; index < layout.chunks; index += 1) {
    runner.output(TASK, `${String(index).padEnd(layout.chunkChars - 1, "x")}\n`);
    runner.skip(index % 4);
    if (index % 5 === 0) runner.output("foreign", "noise\n");
    if (layout.inputEvery > 0 && index % layout.inputEvery === 3)
      runner.input(TASK, `message-${index}`, `steer ${index}`);
  }
  return runner;
}

function replayOf(events: readonly RemoteRunnerEvent[]): RemoteTurnLocalReplay {
  return { events, serverRetention: false };
}

function cursorsOf(local: readonly RemoteRunnerEvent[]): number[] {
  const last = local[local.length - 1]?.sequence ?? 0;
  return [
    ...new Set([
      ...local.flatMap((event) => [event.sequence, event.sequence + 1]),
      1,
      last + 2,
      Number.MAX_SAFE_INTEGER,
    ]),
  ];
}

describe("remote turn local replay page", () => {
  it.each(LAYOUTS)(
    "answers exactly like the runner for every cursor inside $name",
    async (layout) => {
      const runner = build(layout);
      const all = runner.eventsOf(TASK);
      const local = loadedRemoteReplay(all, WINDOW_BYTES);
      const firstOutput = local.find((event) => event.type !== "task.input")?.sequence ?? 0;
      const inputs = local.filter((event) => event.type === "task.input");
      const lost = all.filter((event) => event.sequence >= firstOutput && !local.includes(event));
      const completeFrom = Math.max(firstOutput, ...lost.map((event) => event.sequence + 1));
      const provableFrom =
        inputs.length < MAX_REMOTE_REPLAY_INPUTS
          ? firstOutput
          : Math.max(firstOutput, inputs[0]?.sequence ?? 0);
      const last = local[local.length - 1]?.sequence ?? 0;
      let served = 0;

      expect(provableFrom).toBeGreaterThanOrEqual(completeFrom);
      for (const before of cursorsOf(local)) {
        const page = remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before });
        const provable = local.filter(
          (event) => event.sequence >= provableFrom && event.sequence < before,
        ).length;
        if (page === null) {
          expect(provable < 51 || before > last + 1).toBe(true);
          continue;
        }
        served += 1;
        expect(provable).toBeGreaterThanOrEqual(51);
        expect(before).toBeLessThanOrEqual(last + 1);
        expect(page).toEqual(
          await runner.listEventsBefore({ serverId: "s", taskId: TASK, before }),
        );
      }

      expect(served).toBeGreaterThan(100);
      expect(lost.every((event) => event.type === "task.input")).toBe(true);
    },
  );

  it("keeps a dropped input from ever being skipped by a local page", async () => {
    const runner = build({ name: "", chunks: 1_500, chunkChars: 40, inputEvery: 20 });
    const all = runner.eventsOf(TASK);
    const local = loadedRemoteReplay(all, WINDOW_BYTES);
    const inputs = local.filter((event) => event.type === "task.input");
    const firstOutput = local.find((event) => event.type !== "task.input");
    const oldestInput = inputs[0]?.sequence ?? 0;
    const dropped = all.filter(
      (event) =>
        event.type === "task.input" &&
        event.sequence > (firstOutput?.sequence ?? 0) &&
        !local.includes(event),
    );
    const below = local.filter((event) => event.sequence < oldestInput);
    const before = (below[below.length - 1]?.sequence ?? 0) + 1;

    expect(inputs).toHaveLength(MAX_REMOTE_REPLAY_INPUTS);
    expect(dropped.length).toBeGreaterThan(0);
    expect(below.length).toBeGreaterThan(60);
    expect(remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before })).toBeNull();
    const fromRunner = await runner.listEventsBefore({ serverId: "s", taskId: TASK, before });
    expect(fromRunner.items.some((event) => dropped.includes(event))).toBe(true);
    expect(
      remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before: oldestInput + 400 }),
    ).not.toBeNull();
  });

  it("needs the fifty-first event to prove an older one exists", () => {
    const runner = build({ name: "", chunks: 200, chunkChars: 40, inputEvery: 0 });
    const local = runner.eventsOf(TASK);
    const cursor = (count: number) => local[count]?.sequence ?? 0;

    expect(
      remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before: cursor(50) }),
    ).toBeNull();
    expect(
      remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before: cursor(51) }),
    ).toEqual({ items: local.slice(1, 51), nextCursor: local[1]?.sequence });
  });

  it("never answers for the tail it cannot vouch for", () => {
    const runner = build({ name: "", chunks: 200, chunkChars: 40, inputEvery: 0 });
    const local = runner.eventsOf(TASK);
    const last = local[local.length - 1]?.sequence ?? 0;
    const page = (before: number) =>
      remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before });

    expect(page(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(page(last + 2)).toBeNull();
    expect(page(last + 1)?.items).toEqual(local.slice(-50));
    expect(page(last)?.items).toEqual(local.slice(-51, -1));
  });

  it("refuses foreign tasks, server retention evidence, missing and unusable replays", () => {
    const runner = build({ name: "", chunks: 200, chunkChars: 40, inputEvery: 0 });
    const local = runner.eventsOf(TASK);
    const before = (local[120]?.sequence ?? 0) + 1;
    const foreign = local.map((event, index) =>
      index === 100 ? { ...event, taskId: "other" } : event,
    );
    const unordered = [...local.slice(0, 90), local[91]!, local[90]!, ...local.slice(92)];
    const onlyInputs = Array.from({ length: 80 }, (_, index) => ({
      taskId: TASK,
      sequence: index + 1,
      type: "task.input" as const,
      createdAt: "2026-09-13T00:00:00Z",
      messageId: `m${index}`,
      parts: [{ type: "text" as const, text: "x" }],
    }));

    expect(remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before })).not.toBeNull();
    expect(remoteTurnLocalReplayPage(replayOf(local), { taskId: "other", before })).toBeNull();
    expect(remoteTurnLocalReplayPage(replayOf(foreign), { taskId: TASK, before })).toBeNull();
    expect(remoteTurnLocalReplayPage(replayOf(unordered), { taskId: TASK, before })).toBeNull();
    expect(
      remoteTurnLocalReplayPage({ events: local, serverRetention: true }, { taskId: TASK, before }),
    ).toBeNull();
    expect(remoteTurnLocalReplayPage(null, { taskId: TASK, before })).toBeNull();
    expect(remoteTurnLocalReplayPage(replayOf([]), { taskId: TASK, before })).toBeNull();
    expect(
      remoteTurnLocalReplayPage(replayOf(onlyInputs), { taskId: TASK, before: 70 }),
    ).toBeNull();
  });

  it("falls back when the runner's page byte budget could cut the page", () => {
    const runner = new FakeRunnerEvents();
    for (let index = 0; index < 120; index += 1) {
      runner.output(TASK, `${"\u0001".repeat(8_000)}\n`);
      if (index >= 100 && index <= 102) runner.input(TASK, `m${index}`, "\u0001".repeat(48_000));
    }
    const local = runner.eventsOf(TASK);
    const heavy = (local[local.length - 1]?.sequence ?? 0) + 1;
    const light = (local[90]?.sequence ?? 0) + 1;

    expect(remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before: heavy })).toBeNull();
    expect(
      remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before: light }),
    ).not.toBeNull();
  });
});

describe("remote turn local replay source", () => {
  const events = build({ name: "", chunks: 80, chunkChars: 40, inputEvery: 0 }).eventsOf(TASK);
  const snapshot = {
    ...emptyRemoteInventory("server", true),
    replays: new Map([[TASK, events]]),
  };

  it("serves a replay only when the snapshot proves the server discarded nothing", () => {
    expect(remoteTurnLocalReplayOf(snapshot, TASK)).toEqual({ events, serverRetention: false });
    expect(remoteTurnLocalReplayOf(snapshot, "other")).toBeNull();
    expect(remoteTurnLocalReplayOf(null, TASK)).toBeNull();
    expect(
      remoteTurnLocalReplayOf({ ...snapshot, replayServerEvictions: new Map([[TASK, 7]]) }, TASK)
        ?.serverRetention,
    ).toBe(true);
    expect(
      remoteTurnLocalReplayOf({ ...snapshot, replayDiscarded: new Set([TASK]) }, TASK)
        ?.serverRetention,
    ).toBe(true);
    expect(
      remoteTurnLocalReplayOf({ ...snapshot, replayServerEvictions: undefined }, TASK)
        ?.serverRetention,
    ).toBe(true);
    expect(
      remoteTurnLocalReplayOf(
        {
          ...snapshot,
          replayGaps: new Map([[TASK, { throughSequence: 3, startsAtLineBoundary: true }]]),
        },
        TASK,
      )?.serverRetention,
    ).toBe(false);
  });
});

describe("remote turn local replay port", () => {
  it("asks the gateway only for what the current replay cannot prove", async () => {
    const runner = build({ name: "", chunks: 1_500, chunkChars: 40, inputEvery: 0 });
    const all = runner.eventsOf(TASK);
    let local: RemoteTurnLocalReplay | null = replayOf(loadedRemoteReplay(all, WINDOW_BYTES));
    const asked: string[] = [];
    const port = remoteAgentTurnLocalReplayPort(runner, (taskId) => {
      asked.push(taskId);
      return local;
    });
    const last = all[all.length - 1]?.sequence ?? 0;
    const inside = { serverId: "s", taskId: TASK, before: last - 200 };
    const expected = await runner.listEventsBefore(inside);
    runner.calls.length = 0;

    expect(await port.listEventsBefore(inside)).toEqual(expected);
    expect(runner.calls).toEqual([]);
    expect(await port.listEventsBefore({ ...inside, before: Number.MAX_SAFE_INTEGER })).toEqual(
      await runner.listEventsBefore({ ...inside, before: Number.MAX_SAFE_INTEGER }),
    );
    expect(runner.calls).toHaveLength(2);

    local = replayOf(loadedRemoteReplay(all, 2_000));
    expect(await port.listEventsBefore(inside)).toEqual(expected);
    expect(runner.calls).toHaveLength(3);
    local = null;
    expect(await port.listEventsBefore(inside)).toEqual(expected);
    expect(runner.calls).toHaveLength(4);
    expect(asked).toEqual([TASK, TASK, TASK, TASK]);
  });
});

describe("remote turn local replay retention latch", () => {
  function twoTasks() {
    const runner = new FakeRunnerEvents();
    const sequences: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      sequences.push(runner.output("a", `a${index}\n`));
      runner.output("b", `b${index}\n`);
    }
    const cached = new Map([
      ["a", runner.eventsOf("a")],
      ["b", runner.eventsOf("b")],
    ]);
    const port = remoteAgentTurnLocalReplayPort(runner, (taskId) => {
      const events = cached.get(taskId);
      return events === undefined ? null : { events, serverRetention: false };
    });
    const inside = (taskId: string) => ({
      serverId: "s",
      taskId,
      before: (cached.get(taskId)?.[150]?.sequence ?? 0) + 1,
    });
    return { runner, sequences, cached, port, inside };
  }

  it("stops answering locally for a task once any gateway page reports server retention", async () => {
    const { runner, sequences, port, inside } = twoTasks();
    const tail = { serverId: "s", taskId: "a", before: Number.MAX_SAFE_INTEGER };

    expect((await port.listEventsBefore(inside("a"))).items).toHaveLength(50);
    expect(runner.calls).toEqual([]);

    runner.discardOutputThrough("a", sequences[99] ?? 0, true);
    const pinned = await port.listEventsBefore(tail);
    const afterLatch = await port.listEventsBefore(inside("a"));
    const again = await port.listEventsBefore(inside("a"));

    expect(pinned.outputTruncatedBeforeSequence).toBe(sequences[99]);
    expect(afterLatch).toEqual(await runner.listEventsBefore(inside("a")));
    expect(afterLatch.outputTruncatedBeforeSequence).toBe(sequences[99]);
    expect(again).toEqual(afterLatch);
    expect(runner.calls.map((call) => call.before)).toEqual([
      tail.before,
      inside("a").before,
      inside("a").before,
      inside("a").before,
    ]);
  });

  it("keeps the latch per task while the snapshot still shows no eviction", async () => {
    const { runner, sequences, port, inside } = twoTasks();
    runner.discardOutputThrough("a", sequences[99] ?? 0, true);
    await port.listEventsBefore({ serverId: "s", taskId: "a", before: Number.MAX_SAFE_INTEGER });
    await port.listEventsBefore({ serverId: "s", taskId: "b", before: Number.MAX_SAFE_INTEGER });
    const calls = runner.calls.length;

    const other = await port.listEventsBefore(inside("b"));

    expect(other.items).toHaveLength(50);
    expect(other.outputTruncatedBeforeSequence).toBeUndefined();
    expect(runner.calls).toHaveLength(calls);
    await port.listEventsBefore(inside("a"));
    expect(runner.calls).toHaveLength(calls + 1);
  });

  it("does not share the latch between port instances", async () => {
    const { runner, sequences, cached, port, inside } = twoTasks();
    runner.discardOutputThrough("a", sequences[99] ?? 0, true);
    await port.listEventsBefore({ serverId: "s", taskId: "a", before: Number.MAX_SAFE_INTEGER });
    const fresh = remoteAgentTurnLocalReplayPort(runner, (taskId) => ({
      events: cached.get(taskId) ?? [],
      serverRetention: false,
    }));
    const calls = runner.calls.length;

    await fresh.listEventsBefore(inside("a"));
    expect(runner.calls).toHaveLength(calls);
    await port.listEventsBefore(inside("a"));
    expect(runner.calls).toHaveLength(calls + 1);
  });
});

describe("remote turn local replay at the runner page byte budget", () => {
  it("never answers a cursor whose runner page the byte budget cuts", async () => {
    const runner = new FakeRunnerEvents();
    const light = (count: number) => {
      for (let index = 0; index < count; index += 1) runner.output(TASK, `light ${index}\n`);
    };
    light(200);
    for (let index = 0; index < 120; index += 1) {
      runner.output(TASK, `${"\u0001".repeat(8_000)}\n`);
      if (index % 12 === 5) runner.input(TASK, `m${index}`, "\u0001".repeat(48_000));
    }
    light(200);
    const local = runner.eventsOf(TASK);
    let cut = 0;
    let served = 0;
    let refusedWhole = 0;

    for (const before of cursorsOf(local)) {
      const fromRunner = await runner.listEventsBefore({ serverId: "s", taskId: TASK, before });
      const page = remoteTurnLocalReplayPage(replayOf(local), { taskId: TASK, before });
      const budgetCut = fromRunner.nextCursor !== null && fromRunner.items.length < 50;
      cut += budgetCut ? 1 : 0;
      served += page === null ? 0 : 1;
      refusedWhole += page === null && fromRunner.items.length === 50 ? 1 : 0;
      if (budgetCut) expect(page).toBeNull();
      if (page !== null) expect(page).toEqual(fromRunner);
    }

    expect(cut).toBeGreaterThan(50);
    expect(served).toBeGreaterThan(300);
    expect(refusedWhole).toBeGreaterThan(0);
  });
});
