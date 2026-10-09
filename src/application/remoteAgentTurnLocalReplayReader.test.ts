import { describe, expect, it } from "vitest";
import { agentTurnActivityPageRejection } from "../domain/agentTurnActivityWindow";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogEntry,
  type AgentTurnLogPage,
} from "../domain/agentTurnLog";
import type { RemoteRunnerEvent } from "../domain/remoteRunner";
import { RemoteAgentTurnActivityReader } from "./remoteAgentTurnActivityReader";
import {
  remoteAgentTurnLocalReplayPort,
  type RemoteTurnLocalReplay,
} from "./remoteAgentTurnLocalReplayPort";
import {
  RemoteTurnHistoryChanged,
  RemoteTurnReaderRevoked,
  type RemoteTurnEventsPort,
} from "./remoteAgentTurnRawPages";
import {
  FakeRunnerEvents,
  feedClaudeLines,
  loadedRemoteReplay,
} from "./remoteAgentTurnActivityTestSupport";

const TASK = "task";
const WINDOW_BYTES = 3_000_000;

function longTurn(lines: number): FakeRunnerEvents {
  const runner = new FakeRunnerEvents();
  runner.lifecycle(TASK, "task.created");
  feedClaudeLines(
    runner,
    TASK,
    Array.from({ length: lines }, (_, index) => `line ${String(index).padStart(5, "0")}`),
    97,
  );
  runner.lifecycle(TASK, "task.succeeded");
  return runner;
}

function readerOver(port: RemoteTurnEventsPort): RemoteAgentTurnActivityReader {
  return new RemoteAgentTurnActivityReader({
    port,
    target: { serverId: "server", taskId: TASK },
    provider: "claude",
    authorize: () => true,
  });
}

function read(reader: RemoteAgentTurnActivityReader, anchor: AgentTurnLogAnchor) {
  return reader.readPage({
    anchor,
    maxEvents: AGENT_TURN_LOG_LIMITS.pageEvents,
    maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
  });
}

async function pagesToStart(reader: RemoteAgentTurnActivityReader): Promise<AgentTurnLogPage[]> {
  const pages: AgentTurnLogPage[] = [];
  let anchor: AgentTurnLogAnchor = { at: "tail" };
  for (let step = 0; step < 500; step += 1) {
    const page = await read(reader, anchor);
    expect(agentTurnActivityPageRejection(page, anchor)).toBeNull();
    pages.push(page);
    if (!page.hasEarlier) return pages;
    anchor = { at: "before", seq: page.firstSeq };
  }
  return pages;
}

async function entriesToTail(
  reader: RemoteAgentTurnActivityReader,
  fromSeq: number,
): Promise<AgentTurnLogEntry[]> {
  const entries: AgentTurnLogEntry[] = [];
  let anchor: AgentTurnLogAnchor = { at: "after", seq: fromSeq };
  for (let step = 0; step < 500; step += 1) {
    const page = await read(reader, anchor);
    entries.push(...page.entries);
    if (!page.hasLater) return entries;
    anchor = { at: "after", seq: page.lastSeq };
  }
  return entries;
}

function entriesOf(pages: ReadonlyArray<AgentTurnLogPage>): AgentTurnLogEntry[] {
  return pages
    .slice()
    .reverse()
    .flatMap((page) => [...page.entries]);
}

describe("remote turn activity reader over the local replay", () => {
  it("returns the same pages and seqs while asking the runner far less", async () => {
    const plain = longTurn(3_000);
    const decorated = longTurn(3_000);
    const local = loadedRemoteReplay(decorated.eventsOf(TASK), WINDOW_BYTES);
    const port = remoteAgentTurnLocalReplayPort(decorated, () => ({
      events: local,
      serverRetention: false,
    }));

    const expected = await pagesToStart(readerOver(plain));
    const actual = await pagesToStart(readerOver(port));
    const rawPages = Math.ceil(plain.eventsOf(TASK).length / 50);
    const localPages = Math.floor(local.length / 50);

    expect(actual).toEqual(expected);
    expect(plain.calls).toHaveLength(rawPages);
    expect(local.length).toBeGreaterThan(1_000);
    expect(decorated.calls.length).toBeLessThanOrEqual(rawPages - localPages + 2);
    expect(decorated.calls[0]?.before).toBe(Number.MAX_SAFE_INTEGER);
    expect(decorated.calls[1]?.before).toBeLessThan(local[60]?.sequence ?? 0);
  });

  it("accepts the same raw page from either source when it is fetched again", async () => {
    const runner = longTurn(12_000);
    const local = loadedRemoteReplay(runner.eventsOf(TASK), WINDOW_BYTES);
    let replay: RemoteTurnLocalReplay | null = { events: local, serverRetention: false };
    const reader = readerOver(remoteAgentTurnLocalReplayPort(runner, () => replay));

    const first = entriesOf(await pagesToStart(reader));
    const localCalls = runner.calls.length;
    reader.release();
    replay = null;
    const fromGateway = await entriesToTail(reader, (first[0]?.seq ?? 0) - 1);
    const gatewayCalls = runner.calls.length - localCalls;
    reader.release();
    replay = { events: local, serverRetention: false };
    const fromLocalAgain = await entriesToTail(reader, (first[0]?.seq ?? 0) - 1);
    const mixedCalls = runner.calls.length - localCalls - gatewayCalls;

    expect(first).toHaveLength(12_000);
    expect(fromGateway).toEqual(first);
    expect(fromLocalAgain).toEqual(first);
    expect(gatewayCalls).toBeGreaterThan(mixedCalls + 15);
  });

  it("keeps paging correctly while newer snapshots evict the replay under it", async () => {
    const runner = longTurn(3_000);
    const all = runner.eventsOf(TASK);
    const shrinking: ReadonlyArray<readonly RemoteRunnerEvent[]> = [
      loadedRemoteReplay(all, WINDOW_BYTES),
      loadedRemoteReplay(all, 80_000),
      loadedRemoteReplay(all, 40_000),
      loadedRemoteReplay(all, 12_000),
      [],
    ];
    let asked = 0;
    const port = remoteAgentTurnLocalReplayPort(runner, () => {
      const events = shrinking[Math.min(shrinking.length - 1, Math.floor(asked / 3))] ?? [];
      asked += 1;
      return { events, serverRetention: false };
    });

    const expected = await pagesToStart(readerOver(longTurn(3_000)));
    const actual = await pagesToStart(readerOver(port));

    expect(actual).toEqual(expected);
    expect(asked).toBeGreaterThan(12);
  });

  it("keeps the reader's authority around local answers too", async () => {
    const runner = longTurn(3_000);
    const local = loadedRemoteReplay(runner.eventsOf(TASK), WINDOW_BYTES);
    let authorized = true;
    let consulted = 0;
    const port = remoteAgentTurnLocalReplayPort(runner, () => {
      consulted += 1;
      return { events: local, serverRetention: false };
    });
    const reader = new RemoteAgentTurnActivityReader({
      port,
      target: { serverId: "server", taskId: TASK },
      provider: "claude",
      authorize: () => authorized,
    });
    const tail = await read(reader, { at: "tail" });
    const consultedWhileAuthorized = consulted;
    const gatewayCalls = runner.calls.length;

    authorized = false;
    const revoked = read(reader, { at: "before", seq: tail.firstSeq });

    await expect(revoked).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    expect(consultedWhileAuthorized).toBeGreaterThan(1);
    expect(consulted).toBe(consultedWhileAuthorized);
    expect(runner.calls).toHaveLength(gatewayCalls);
  });

  it("drops a local answer that arrives after the authority was revoked", async () => {
    const runner = longTurn(3_000);
    const local = loadedRemoteReplay(runner.eventsOf(TASK), WINDOW_BYTES);
    let authorized = true;
    let revokeOnLocalAnswer = false;
    const port = remoteAgentTurnLocalReplayPort(runner, () => {
      if (revokeOnLocalAnswer) authorized = false;
      return { events: local, serverRetention: false };
    });
    const reader = new RemoteAgentTurnActivityReader({
      port,
      target: { serverId: "server", taskId: TASK },
      provider: "claude",
      authorize: () => authorized,
    });
    const tail = await read(reader, { at: "tail" });
    const gatewayCalls = runner.calls.length;

    revokeOnLocalAnswer = true;
    const revoked = read(reader, { at: "before", seq: tail.firstSeq });

    await expect(revoked).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    expect(runner.calls).toHaveLength(gatewayCalls);
  });

  it("pins the server's real tail when the replay is behind a running turn", async () => {
    const runner = longTurn(600);
    const local = loadedRemoteReplay(runner.eventsOf(TASK).slice(0, -130), WINDOW_BYTES);
    const port = remoteAgentTurnLocalReplayPort(runner, () => ({
      events: local,
      serverRetention: false,
    }));

    const expected = await pagesToStart(readerOver(longTurn(600)));
    const actual = await pagesToStart(readerOver(port));
    const localLast = local[local.length - 1]?.sequence ?? 0;

    expect(actual).toEqual(expected);
    expect(runner.calls.slice(0, 3).every((call) => call.before > localLast + 1)).toBe(true);
    expect(runner.calls.length).toBeLessThan(Math.ceil(runner.eventsOf(TASK).length / 50));
  });
});

describe("remote turn activity reader over a replay the server discarded from", () => {
  function cachedThenDiscarded() {
    const runner = new FakeRunnerEvents();
    runner.lifecycle(TASK, "task.created");
    for (let index = 0; index < 200; index += 1)
      runner.output(
        TASK,
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `line ${index}` }] } })}\n`,
      );
    runner.lifecycle(TASK, "task.succeeded");
    const cached = runner.eventsOf(TASK);
    const port = remoteAgentTurnLocalReplayPort(runner, () => ({
      events: cached,
      serverRetention: false,
    }));
    return { runner, cached, port };
  }

  it("reads only what the server still holds once its tail reports the discard", async () => {
    const { runner, cached, port } = cachedThenDiscarded();
    runner.discardOutputThrough(TASK, 101, true);
    const gatewayOnly = readerOver(runner);
    const decorated = readerOver(port);

    const expected = await pagesToStart(gatewayOnly);
    const expectedCalls = runner.calls.length;
    const actual = await pagesToStart(decorated);
    const actualCalls = runner.calls.length - expectedCalls;
    const first = entriesOf(actual)[0]?.seq ?? 0;
    decorated.release();
    gatewayOnly.release();
    const refetched = await entriesToTail(decorated, first - 1);

    expect(cached).toHaveLength(202);
    expect(cached[101]?.sequence).toBe(102);
    expect(actual).toEqual(expected);
    expect(actualCalls).toBe(expectedCalls);
    expect(entriesOf(actual)).toHaveLength(100);
    expect(actual[actual.length - 1]?.earlierDiscarded).toBe(true);
    expect(actual[actual.length - 1]?.hasEarlier).toBe(false);
    expect(refetched).toEqual(entriesOf(expected));
    expect(refetched).toEqual(await entriesToTail(gatewayOnly, first - 1));
  });

  it("serves what it had cached, then fails closed and recovers, when the discard comes after the tail read", async () => {
    const { runner, port } = cachedThenDiscarded();
    const decorated = readerOver(port);
    const pages = [
      await decorated.readPage({
        anchor: { at: "tail" },
        maxEvents: 60,
        maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
      }),
    ];
    const callsForTail = runner.calls.length;

    runner.discardOutputThrough(TASK, 101, true);
    while (pages[pages.length - 1]?.hasEarlier === true)
      pages.push(
        await read(decorated, { at: "before", seq: pages[pages.length - 1]?.firstSeq ?? 0 }),
      );
    const served = entriesOf(pages);
    const last = pages[pages.length - 1];

    expect(callsForTail).toBe(1);
    expect(served).toHaveLength(199);
    expect(served[0]?.event).toEqual({ kind: "assistantText", text: "line 1" });
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1]?.before).toBe(3);
    expect(last?.hasEarlier).toBe(false);
    expect(last?.earlierDiscarded).toBe(true);

    decorated.release();
    const refetch = read(decorated, { at: "after", seq: (served[0]?.seq ?? 0) - 1 });
    await expect(refetch).rejects.toBeInstanceOf(RemoteTurnHistoryChanged);
    await expect(
      read(decorated, { at: "after", seq: (served[0]?.seq ?? 0) - 1 }),
    ).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);

    const recovered = await pagesToStart(decorated);
    expect(recovered).toEqual(await pagesToStart(readerOver(runner)));
    expect(entriesOf(recovered)).toHaveLength(100);
    expect(recovered[recovered.length - 1]?.earlierDiscarded).toBe(true);
  });
});
