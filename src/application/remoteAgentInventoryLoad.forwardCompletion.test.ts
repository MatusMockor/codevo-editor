import { expect, it } from "vitest";
import type { RemoteRunnerEventPage } from "../domain/remoteRunner";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  projectedTurn,
  remoteTurn,
} from "./remoteAgentTailFirstTestSupport";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

it.each([
  { name: "a final short page", count: 5, pageLengths: [5] },
  { name: "a final page of exactly 50", count: 50, pageLengths: [50] },
  { name: "a full page with more events", count: 57, pageLengths: [50, 7] },
  { name: "a final full page after another page", count: 100, pageLengths: [50, 50] },
  { name: "empty history", count: 0, pageLengths: [0] },
])("settles forward replay on the null cursor for $name", async ({ count, pageLengths }) => {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < count; index += 1) {
    runner.output("turn-1", claudeTextLine(`line ${index} `));
    runner.skip(index % 3);
    runner.output("foreign-task", "noise\n");
  }
  const h = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const pages: RemoteRunnerEventPage[] = [];
  h.calls.listEvents.mockImplementation(async (request) => {
    const page = await runner.listEvents(request);
    pages.push(page);
    return page;
  });

  const snapshot = await loadTailFirst(h.gateway);
  const expected = runner.eventsOf("turn-1");

  expect(pages.map((page) => page.items.length)).toEqual(pageLengths);
  expect(h.forward()).toHaveLength(pageLengths.length);
  expect(h.forward().map((request) => request.after)).toEqual([
    0,
    ...pages.slice(0, -1).map((page) => lastOf(page.items)?.sequence),
  ]);
  for (const page of pages.slice(0, -1)) expect(page.nextCursor).toBe(lastOf(page.items)?.sequence);
  expect(lastOf(pages)?.nextCursor).toBeNull();
  expect(snapshot.replays.get("turn-1")).toEqual(expected);
  expect(snapshot.replayCursors?.get("turn-1")).toBe(lastOf(expected)?.sequence ?? 0);
  expect(snapshot.replayComplete.has("turn-1")).toBe(true);
  expect(snapshot.replayTruncated.has("turn-1")).toBe(false);
  expect(snapshot.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
  expect(projectedTurn(snapshot, "turn-1")?.streamMetrics?.complete).toBe(true);
  expect(h.backward()).toEqual([]);
});

it("settles a non-conforming final non-empty cursor after one defensive empty read", async () => {
  const runner = new FakeRunnerEvents();
  runner.output("turn-1", claudeTextLine("final line"));
  const h = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const items = runner.eventsOf("turn-1");
  const newest = lastOf(items)!.sequence;
  h.calls.listEvents
    .mockResolvedValueOnce({ items, nextCursor: newest })
    .mockResolvedValueOnce({ items: [], nextCursor: null });

  const snapshot = await loadTailFirst(h.gateway);

  expect(h.forward()).toEqual([
    { serverId: "server", taskId: "turn-1", after: 0 },
    { serverId: "server", taskId: "turn-1", after: newest },
  ]);
  expect(snapshot.replays.get("turn-1")).toEqual(items);
  expect(snapshot.replayCursors?.get("turn-1")).toBe(newest);
  expect(snapshot.replayComplete.has("turn-1")).toBe(true);
  expect(snapshot.replayTruncated.has("turn-1")).toBe(false);
  expect(projectedTurn(snapshot, "turn-1")?.streamMetrics?.complete).toBe(true);
});

it.each([5, 50, 57, 0])(
  "pages %i events backward with a null cursor only at exhaustion",
  async (count) => {
    const runner = new FakeRunnerEvents();
    for (let index = 0; index < count; index += 1) {
      runner.output("turn-1", "");
      runner.skip(2);
      runner.output("foreign-task", "noise\n");
    }
    const items = runner.eventsOf("turn-1");
    const page = await runner.listEventsBefore({
      serverId: "server",
      taskId: "turn-1",
      before: Number.MAX_SAFE_INTEGER,
    });

    expect(page.items).toEqual(items.slice(-50));
    if (count <= 50) {
      expect(page.nextCursor).toBeNull();
      return;
    }
    expect(page.nextCursor).toBe(page.items[0]?.sequence);
    const finalPage = await runner.listEventsBefore({
      serverId: "server",
      taskId: "turn-1",
      before: page.nextCursor!,
    });
    expect(finalPage).toMatchObject({ items: items.slice(0, -50), nextCursor: null });
  },
);

it("preserves byte-limited pages and exhaustion cursors in both directions", async () => {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < 3; index += 1) runner.output("turn-1", "x".repeat(1_600_000));
  const items = runner.eventsOf("turn-1");
  const forward = await runner.listEvents({ serverId: "server", taskId: "turn-1", after: 0 });
  const backward = await runner.listEventsBefore({
    serverId: "server",
    taskId: "turn-1",
    before: Number.MAX_SAFE_INTEGER,
  });

  expect(forward).toMatchObject({ items: items.slice(0, 1), nextCursor: items[0]!.sequence });
  expect(backward).toMatchObject({ items: items.slice(-1), nextCursor: items[2]!.sequence });
  const middleForward = await runner.listEvents({
    serverId: "server",
    taskId: "turn-1",
    after: forward.nextCursor!,
  });
  const middleBackward = await runner.listEventsBefore({
    serverId: "server",
    taskId: "turn-1",
    before: backward.nextCursor!,
  });
  expect(middleForward).toMatchObject({ items: items.slice(1, 2), nextCursor: items[1]!.sequence });
  expect(middleBackward).toEqual(middleForward);
  expect(
    await runner.listEvents({
      serverId: "server",
      taskId: "turn-1",
      after: middleForward.nextCursor!,
    }),
  ).toMatchObject({ items: items.slice(-1), nextCursor: null });
  expect(
    await runner.listEventsBefore({
      serverId: "server",
      taskId: "turn-1",
      before: middleBackward.nextCursor!,
    }),
  ).toMatchObject({ items: items.slice(0, 1), nextCursor: null });
});
