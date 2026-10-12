import { expect, it } from "vitest";
import type { RemoteRunnerEventsBeforeRequest } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { RemoteAgentProjection, projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  remoteTurn,
  turnText,
} from "./remoteAgentTailFirstTestSupport";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

async function terminalBackfill() {
  const runner = new FakeRunnerEvents();
  runner.lifecycle("turn-1", "task.created");
  runner.skip(49);
  for (let index = 0; index < 1_100; index += 1)
    runner.output("turn-1", index === 6 ? claudeTextLine("retained line") : "");
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  h.calls.listEventsBefore.mockImplementation(async (request: RemoteRunnerEventsBeforeRequest) => {
    const page = await runner.listEventsBefore(request);
    if (request.before !== 51) return page;
    return {
      ...page,
      outputTruncatedBeforeSequence: 55,
      outputStartsAtLineBoundary: true,
    };
  });
  const snapshots: RemoteAgentInventorySnapshot[] = [];
  const settled = await loadTailFirst(h.gateway, undefined, (snapshot) => snapshots.push(snapshot));
  const pending = snapshots.find(
    (snapshot) =>
      snapshot.replayBackfill?.get("turn-1")?.kind === "pending" &&
      snapshot.replays.get("turn-1")?.length === 1_100,
  )!;
  expect(pending).toBeDefined();
  return { pending, settled };
}

function projected(snapshot: RemoteAgentInventorySnapshot, projection: RemoteAgentProjection) {
  return projection.project({ ...snapshot, runnerId: "runner" })[0]!.thread.turns[0]!;
}

function fresh(snapshot: RemoteAgentInventorySnapshot) {
  return projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" })[0]!.thread.turns[0]!;
}

it("rebuilds a finished backfill transcript when server loss grows without moving its origin", async () => {
  const { pending, settled } = await terminalBackfill();
  const projection = new RemoteAgentProjection();
  const before = projected(pending, projection);

  expect(pending.replays.get("turn-1")?.[0]?.sequence).toBe(51);
  expect(lastOf(pending.replays.get("turn-1") ?? [])?.sequence).toBe(1_150);
  expect(pending.replayBackfill?.get("turn-1")).toMatchObject({ kind: "pending", before: 51 });
  expect(before.status).toEqual({ kind: "exited", exitCode: 0 });
  expect(before.eventsRetention).toBe("clientWindow");
  expect(settled.replays.get("turn-1")).toEqual(pending.replays.get("turn-1"));
  expect(settled.replayGaps?.get("turn-1")).toEqual({
    throughSequence: 55,
    startsAtLineBoundary: true,
  });

  const after = projected(settled, projection);

  expect(after.eventsRetention).toBe("serverGap");
  expect(turnText(after.events)).toBe("retained line");
  expect(after).toEqual(fresh(settled));
});

it("rebuilds a finished transcript when only its retention classification changes", async () => {
  const { pending } = await terminalBackfill();
  const projection = new RemoteAgentProjection();
  expect(projected(pending, projection).eventsRetention).toBe("clientWindow");
  const changed = { ...pending, replayDiscarded: new Set(["turn-1"]) };

  expect(projected(changed, projection)).toEqual(fresh(changed));
  expect(projected(changed, projection).eventsRetention).toBe("serverGap");
});

it("rebuilds a finished transcript when only the gap line boundary changes", async () => {
  const { pending } = await terminalBackfill();
  const projection = new RemoteAgentProjection();
  expect(turnText(projected(pending, projection).events)).toBe("");
  const changed = {
    ...pending,
    replayGaps: new Map([["turn-1", { throughSequence: 50, startsAtLineBoundary: true }]]),
  };

  const after = projected(changed, projection);

  expect(turnText(after.events)).toBe("retained line");
  expect(after).toEqual(fresh(changed));
});
