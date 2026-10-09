import { describe, expect, it } from "vitest";
import { AGENT_TURN_LOG_LIMITS, type AgentTurnLogAnchor } from "../domain/agentTurnLog";
import { RemoteTurnReaderRevoked } from "./remoteAgentTurnRawPages";
import {
  MAX_REMOTE_TURN_ACTIVE_READERS,
  RemoteAgentTurnActivitySources,
  type RemoteTurnActivityBinding,
} from "./remoteAgentTurnActivitySources";
import { FakeRunnerEvents, claudeTextLine } from "./remoteAgentTurnActivityTestSupport";
import {
  agentHistoryActivitySourceIdentity,
  type AgentHistoryActivitySource,
} from "./useAgentHistoryActivity";

const OWNER = {};

function runnerWith(turns: ReadonlyArray<string>): FakeRunnerEvents {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < 120; index += 1)
    for (const turn of turns) runner.output(turn, claudeTextLine(`${turn} ${index}`));
  return runner;
}

function binding(
  runner: FakeRunnerEvents,
  turnId: string,
  owner: object = OWNER,
): RemoteTurnActivityBinding {
  return {
    owner,
    gateway: runner,
    port: runner,
    serverId: "server",
    runnerId: "runner",
    provider: "claude",
    scope: { rootKey: "remote:server", ownerId: "remote:server", threadId: "thread", turnId },
  };
}

function read(source: AgentHistoryActivitySource, anchor: AgentTurnLogAnchor) {
  return source.readPage({
    scope: source.scope,
    anchor,
    maxEvents: 20,
    maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
  });
}

describe("remote turn activity sources", () => {
  it("keeps one source per turn and numbers every new binding with a new generation", () => {
    const runner = runnerWith(["a", "b"]);
    const sources = new RemoteAgentTurnActivitySources();
    const first = sources.resolve(binding(runner, "a"), () => true);
    const second = sources.resolve(binding(runner, "b"), () => true);
    const again = sources.resolve(binding(runner, "a"), () => true);
    const replaced = sources.resolve(binding(runner, "a", {}), () => true);

    expect(again).toBe(first);
    expect(second).not.toBe(first);
    expect(replaced).not.toBe(first);
    expect(new Set([first, second, replaced].map(agentHistoryActivitySourceIdentity)).size).toBe(3);
    expect([first.generation, second.generation, replaced.generation]).toEqual([1, 2, 3]);
  });

  it("revokes a replaced or pruned source and leaves the surviving one readable", async () => {
    const runner = runnerWith(["a", "b"]);
    const sources = new RemoteAgentTurnActivitySources();
    const stale = sources.resolve(binding(runner, "a"), () => true);
    const fresh = sources.resolve(binding(runner, "a", {}), () => true);
    const pruned = sources.resolve(binding(runner, "b"), () => true);

    sources.prune((bound) => bound.scope.turnId === "a");

    await expect(read(stale, { at: "tail" })).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    await expect(read(pruned, { at: "tail" })).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
    expect(runner.calls).toEqual([]);
    await expect(read(fresh, { at: "tail" })).resolves.toMatchObject({ hasEarlier: true });
  });

  it("releases the caches of the least recently read turns but keeps their seqs", async () => {
    const turns = Array.from(
      { length: MAX_REMOTE_TURN_ACTIVE_READERS + 1 },
      (_, index) => `turn-${index}`,
    );
    const runner = runnerWith(turns);
    const sources = new RemoteAgentTurnActivitySources();
    const bound = turns.map((turn) => sources.resolve(binding(runner, turn), () => true));
    const first = bound[0]!;

    const tail = await read(first, { at: "tail" });
    const cached = await read(first, { at: "before", seq: tail.firstSeq });
    const callsWhileCached = runner.calls.length;
    await read(first, { at: "before", seq: tail.firstSeq });
    expect(runner.calls).toHaveLength(callsWhileCached);

    for (const source of bound.slice(1)) await read(source, { at: "tail" });
    const callsAfterOthers = runner.calls.length;
    const reread = await read(first, { at: "before", seq: tail.firstSeq });

    expect(reread).toEqual(cached);
    expect(runner.calls.length).toBeGreaterThan(callsAfterOthers);
  });
});
