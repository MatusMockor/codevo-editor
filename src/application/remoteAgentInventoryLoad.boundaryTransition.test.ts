import { expect, it } from "vitest";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerEventsBeforeRequest,
} from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { MAX_REMOTE_REPLAY_INPUTS } from "./remoteAgentReplayWindow";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  loadUntilSettled,
  projectedTurn,
  projectedTurns,
  remoteTurn,
  replayState,
} from "./remoteAgentTailFirstTestSupport";
import {
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
  remoteReplayBackfillAdvanced,
  remoteReplayBackfillPending,
  REMOTE_TASK_REPLAY_TAIL_BEFORE,
} from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

type MissingCapability = "runner" | "gateway";

function boundaryTurn(): FakeRunnerEvents {
  const runner = new FakeRunnerEvents();
  runner.output("turn-1", claudeTextLine("older line"));
  for (let index = 0; index < 117; index += 1) runner.lifecycle("turn-1", "task.created");
  for (let index = 0; index < MAX_REMOTE_REPLAY_INPUTS; index += 1)
    runner.input("turn-1", `input-${index}`, `steer ${index}`);
  for (let index = 0; index < 1_100; index += 1) runner.lifecycle("turn-1", "task.created");
  runner.output("turn-1", claudeTextLine("retained line"));
  return runner;
}

function descriptor(backward: boolean): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId: "runner",
    name: "Server",
    capabilities: {
      taskExecution: true,
      eventReplay: true,
      taskContinuation: true,
      ...(backward ? { eventBackwardPaging: true } : {}),
    },
  };
}

function capability(
  h: ReturnType<typeof fakeRunnerGateway>,
  missing: MissingCapability,
  available: boolean,
): void {
  if (missing === "runner") {
    h.calls.getRunner.mockResolvedValue(descriptor(available));
    return;
  }
  Object.assign(h.gateway, {
    listEventsBefore: available ? h.calls.listEventsBefore : undefined,
  });
}

function beforeCursors(h: ReturnType<typeof fakeRunnerGateway>): number[] {
  return h
    .backward()
    .filter((request) => request.taskId === "turn-1")
    .map((request) => request.before);
}

function initialCursors(): number[] {
  return [
    REMOTE_TASK_REPLAY_TAIL_BEFORE,
    ...Array.from(
      { length: MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS },
      (_, index) => 1_202 - index * 50,
    ),
  ];
}

function truthful(snapshot: RemoteAgentInventorySnapshot): void {
  const turn = projectedTurn(snapshot, "turn-1");
  expect(turn, "The scanning turn must remain visible").toBeDefined();
  expect(turn?.status, "A terminal over-limit turn must remain terminal").toEqual({
    kind: "exited",
    exitCode: 0,
  });
  expect(turn?.eventsRetention, "Local retention must remain truthful throughout the scan").toBe(
    "clientWindow",
  );
  expect(turn?.eventsTruncated, "Over-limit history must remain visibly truncated").toBe(true);
  expect(snapshot.replayComplete.has("turn-1"), "The terminal tail is complete").toBe(true);
  expect(
    snapshot.replays.get("turn-1")?.filter((event) => event.type === "task.input"),
  ).toHaveLength(MAX_REMOTE_REPLAY_INPUTS);
}

async function expectLegacy(runner: FakeRunnerEvents, actual: RemoteAgentInventorySnapshot) {
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const expected = await loadUntilSettled(forward.gateway, runner);
  expect(remoteReplayBackfillPending(expected), "Legacy replay must settle").toBe(false);
  expect(expected.replayCursors?.get("turn-1")).toBe(lastOf(runner.eventsOf("turn-1"))?.sequence);
  expect(replayState(actual), "Final boundary replay must equal the legacy loader").toEqual(
    replayState(expected),
  );
  expect(projectedTurns(actual), "Fresh projection must equal the legacy projection").toEqual(
    projectedTurns(expected),
  );
}

it.each([
  { missing: "runner", passes: 1 },
  { missing: "runner", passes: 3 },
  { missing: "gateway", passes: 1 },
  { missing: "gateway", passes: 3 },
] as const)(
  "preserves scanningBoundary across $passes passes without the $missing backward capability",
  async ({ missing, passes }) => {
    const runner = boundaryTurn();
    const original = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const h = { ...original, gateway: { ...original.gateway } };
    const first = await loadTailFirst(h.gateway);
    expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
    expect(beforeCursors(h)).toEqual(initialCursors());
    truthful(first);
    capability(h, missing, false);

    let kept = first;
    for (let pass = 0; pass < passes; pass += 1) {
      const progress: RemoteAgentInventorySnapshot[] = [];
      kept = await loadTailFirst(h.gateway, kept, (snapshot) => progress.push(snapshot));
      expect(
        replayState(kept),
        `Suspended pass ${pass} must preserve the complete replay state`,
      ).toEqual(replayState(first));
      expect(remoteReplayBackfillAdvanced(first, kept)).toBe(false);
      expect(progress, "Suspension must not publish invented progress").toEqual([]);
      expect(beforeCursors(h)).toEqual(initialCursors());
      expect(h.forward()).toEqual([]);
      truthful(kept);
    }

    capability(h, missing, true);
    const actual = await loadTailFirst(h.gateway, kept, truthful);
    expect(beforeCursors(h), "Restore must read the preserved cursor exactly once").toEqual([
      ...initialCursors(),
      2,
    ]);
    expect(actual.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
    truthful(actual);
    await expectLegacy(runner, actual);
  },
);

it("retries only the failed scanningBoundary page and preserves truthful visible history", async () => {
  const runner = boundaryTurn();
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const first = await loadTailFirst(h.gateway);
  expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
  h.calls.listEventsBefore.mockImplementationOnce((request: RemoteRunnerEventsBeforeRequest) => {
    expect(request.before, "The failure must occur at the scanningBoundary cursor").toBe(2);
    return Promise.reject(new Error("Boundary page unavailable."));
  });
  const progress: RemoteAgentInventorySnapshot[] = [];

  await expect(
    loadTailFirst(h.gateway, first, (snapshot) => progress.push(snapshot)),
  ).rejects.toMatchObject({
    message: "Boundary page unavailable.",
  });

  expect(progress, "A failed page must not publish progress").toEqual([]);
  expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 2 });
  truthful(first);
  const actual = await loadTailFirst(h.gateway, first, truthful);
  expect(beforeCursors(h), "Only the failed request may repeat").toEqual([
    ...initialCursors(),
    2,
    2,
  ]);
  truthful(actual);
  await expectLegacy(runner, actual);
});
