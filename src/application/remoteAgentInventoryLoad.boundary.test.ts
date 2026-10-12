import { expect, it } from "vitest";
import type { RemoteRunnerEventsBeforeRequest } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  loadUntilSettled,
  projectedTurn,
  projectedTurns,
  remoteTurn,
  replayState,
  turnText,
} from "./remoteAgentTailFirstTestSupport";
import { remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

function lifecycle(runner: FakeRunnerEvents, count: number): void {
  for (let index = 0; index < count; index += 1) runner.lifecycle("turn-1", "task.created");
}

function inputs(runner: FakeRunnerEvents): void {
  for (let index = 0; index < 32; index += 1)
    runner.input("turn-1", `input-${index}`, `steer ${index}`);
}

async function equivalent(runner: FakeRunnerEvents) {
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const progress: RemoteAgentInventorySnapshot[] = [];
  const expected = await loadUntilSettled(forward.gateway, runner);
  const actual = await loadUntilSettled(backward.gateway, runner, (snapshot) =>
    progress.push(snapshot),
  );
  expect(replayState(actual)).toEqual(replayState(expected));
  expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
  expect(remoteReplayBackfillPending(actual)).toBe(false);
  return { actual, backward, progress };
}

it("exhausts the exact lifecycle-only prefix after retaining all 32 inputs without inventing a gap", async () => {
  const runner = new FakeRunnerEvents();
  lifecycle(runner, 50);
  inputs(runner);
  lifecycle(runner, 1_101);
  expect(runner.output("turn-1", claudeTextLine("complete line"))).toBe(1_184);

  const { actual, backward, progress } = await equivalent(runner);
  const scanning = progress.find(
    (snapshot) => snapshot.replayBackfill?.get("turn-1")?.kind === "scanningBoundary",
  )!;

  expect(scanning.replayBackfill?.get("turn-1")).toEqual({ kind: "scanningBoundary", before: 35 });
  expect(
    scanning.replays.get("turn-1")?.filter((event) => event.type === "task.input"),
  ).toHaveLength(32);
  expect(projectedTurn(scanning, "turn-1")?.eventsRetention).toBe("clientWindow");
  expect(projectedTurn(scanning, "turn-1")?.eventsTruncated).toBe(true);
  expect(backward.backward()).toHaveLength(24);
  expect(actual.replayGaps?.has("turn-1")).toBe(false);
  expect(turnText(projectedTurn(actual, "turn-1")!.events)).toContain("complete line");
});

it.each(["complete", "partial"] as const)(
  "establishes %s stdout framing below a lifecycle window independently of the input limit",
  async (framing) => {
    const runner = new FakeRunnerEvents();
    lifecycle(runner, 10);
    const line = claudeTextLine("retained line");
    const stdout = runner.output(
      "turn-1",
      framing === "complete" ? claudeTextLine("older line") : line.slice(0, 30),
    );
    lifecycle(runner, 100);
    inputs(runner);
    lifecycle(runner, 1_101);
    runner.output("turn-1", framing === "complete" ? line : line.slice(30));

    const { actual } = await equivalent(runner);

    expect(actual.replayGaps?.get("turn-1")).toEqual({
      throughSequence: stdout,
      startsAtLineBoundary: framing === "complete",
    });
    expect(actual.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  },
);

it.each(["complete", "partial"] as const)(
  "finds %s stdout below a stderr-only window even after all inputs are found",
  async (framing) => {
    const runner = new FakeRunnerEvents();
    const line = claudeTextLine("retained line");
    runner.output(
      "turn-1",
      framing === "complete" ? claudeTextLine("older line") : line.slice(0, 30),
    );
    for (let index = 0; index < 100; index += 1) runner.output("turn-1", "", "stderr");
    inputs(runner);
    for (let index = 0; index < 1_101; index += 1) runner.output("turn-1", "", "stderr");
    runner.output("turn-1", framing === "complete" ? line : line.slice(30));

    const { actual } = await equivalent(runner);

    expect(actual.replayGaps?.get("turn-1")?.startsAtLineBoundary).toBe(framing === "complete");
    expect(actual.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  },
);

it.each(["stdout", "exhaustion"] as const)(
  "resumes budgeted boundary lookbehind through %s without rereading",
  async (end) => {
    const runner = new FakeRunnerEvents();
    if (end === "stdout") runner.output("turn-1", claudeTextLine("older line"));
    lifecycle(runner, 1_000);
    inputs(runner);
    lifecycle(runner, 1_101);
    runner.output("turn-1", claudeTextLine("complete line"));
    const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadTailFirst(backward.gateway);
    const state = first.replayBackfill?.get("turn-1");
    const count = backward.backward().length;

    expect(state?.kind).toBe("scanningBoundary");
    expect(count).toBe(25);
    expect(remoteReplayBackfillPending(first)).toBe(true);
    expect(projectedTurn(first, "turn-1")?.eventsRetention).toBe("clientWindow");
    expect(projectedTurn(first, "turn-1")?.eventsTruncated).toBe(true);

    const actual = await loadTailFirst(backward.gateway, first);
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const expected = await loadUntilSettled(forward.gateway, runner);

    expect(backward.backward()[count]?.before).toBe(
      state?.kind === "scanningBoundary" ? state.before : undefined,
    );
    expect(new Set(backward.backward().map((request) => request.before)).size).toBe(
      backward.backward().length,
    );
    expect(replayState(actual)).toEqual(replayState(expected));
    expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
    if (end === "exhaustion") expect(actual.replayGaps?.has("turn-1")).toBe(false);
  },
);

it("preserves a failed boundary lookbehind cursor and resumes after finding inputs", async () => {
  const runner = new FakeRunnerEvents();
  runner.output("turn-1", claudeTextLine("older line"));
  lifecycle(runner, 1_000);
  inputs(runner);
  lifecycle(runner, 1_101);
  runner.output("turn-1", claudeTextLine("complete line"));
  const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const first = await loadTailFirst(backward.gateway);
  const progress: RemoteAgentInventorySnapshot[] = [];
  let failedBefore = 0;
  backward.calls.listEventsBefore.mockImplementation(
    async (request: RemoteRunnerEventsBeforeRequest) => {
      if (progress.length === 2) {
        failedBefore = request.before;
        return Promise.reject(new Error("Boundary scan failed."));
      }
      return runner.listEventsBefore(request);
    },
  );

  await expect(
    loadTailFirst(backward.gateway, first, (snapshot) => progress.push(snapshot)),
  ).rejects.toThrow("Boundary scan failed.");
  const kept = lastOf(progress)!;
  expect(kept.replayBackfill?.get("turn-1")).toEqual({
    kind: "scanningBoundary",
    before: failedBefore,
  });
  expect(kept.replayTruncated.has("turn-1")).toBe(true);
  expect(kept.replays).toEqual(first.replays);
  const requests = backward.backward().length;
  backward.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);
  const actual = await loadTailFirst(backward.gateway, kept);
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const expected = await loadUntilSettled(forward.gateway, runner);

  expect(backward.backward()[requests]?.before).toBe(failedBefore);
  expect(replayState(actual)).toEqual(replayState(expected));
  expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
});

it("continues boundary lookbehind after an input scan finds its 32nd input", async () => {
  const runner = new FakeRunnerEvents();
  runner.output("turn-1", claudeTextLine("older line"));
  lifecycle(runner, 500);
  inputs(runner);
  lifecycle(runner, 1_500);
  for (let index = 0; index < 1_100; index += 1) runner.output("turn-1", "", "stderr");
  runner.output("turn-1", claudeTextLine("retained line"));

  const { actual, progress } = await equivalent(runner);
  const inputScan = progress.find(
    (snapshot) => snapshot.replayBackfill?.get("turn-1")?.kind === "scanningInputs",
  )!;
  const boundaryScan = progress.find(
    (snapshot) => snapshot.replayBackfill?.get("turn-1")?.kind === "scanningBoundary",
  )!;

  expect(inputScan.replayBackfill?.get("turn-1")).toMatchObject({
    kind: "scanningInputs",
    stdoutBoundary: { kind: "pending" },
  });
  expect(
    boundaryScan.replays.get("turn-1")?.filter((event) => event.type === "task.input"),
  ).toHaveLength(32);
  expect(boundaryScan.replayBackfill?.get("turn-1")).toMatchObject({ kind: "scanningBoundary" });
  expect(boundaryScan.replayTruncated.has("turn-1")).toBe(true);
  expect(actual.replayGaps?.get("turn-1")?.startsAtLineBoundary).toBe(true);
});

it("continues input scanning after establishing the stdout boundary", async () => {
  const runner = new FakeRunnerEvents();
  inputs(runner);
  lifecycle(runner, 1_000);
  runner.output("turn-1", claudeTextLine("older line"));
  for (let index = 0; index < 1_500; index += 1) runner.output("turn-1", "", "stderr");
  runner.output("turn-1", claudeTextLine("retained line"));

  const { actual, progress } = await equivalent(runner);
  const unfinished = progress.find((snapshot) => {
    const state = snapshot.replayBackfill?.get("turn-1");
    return state?.kind === "scanningInputs" && state.stdoutBoundary === undefined;
  })!;

  expect(unfinished.replayBackfill?.get("turn-1")).toMatchObject({ kind: "scanningInputs" });
  expect(
    unfinished.replays.get("turn-1")?.filter((event) => event.type === "task.input"),
  ).toHaveLength(0);
  expect(projectedTurn(unfinished, "turn-1")?.eventsRetention).toBe("clientWindow");
  expect(actual.replays.get("turn-1")?.filter((event) => event.type === "task.input")).toHaveLength(
    32,
  );
});

it("records unread stderr loss and establishes a boundary by exhausting a stdout-free prefix", async () => {
  const runner = new FakeRunnerEvents();
  lifecycle(runner, 100);
  const stderr = runner.output("turn-1", "older error", "stderr");
  lifecycle(runner, 1_000);
  inputs(runner);
  lifecycle(runner, 1_101);
  runner.output("turn-1", claudeTextLine("retained line"));

  const { actual } = await equivalent(runner);

  expect(actual.replayGaps?.get("turn-1")).toEqual({
    throughSequence: stderr,
    startsAtLineBoundary: true,
  });
});
