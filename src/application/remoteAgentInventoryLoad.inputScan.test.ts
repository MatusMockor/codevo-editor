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
} from "./remoteAgentTailFirstTestSupport";
import { remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

function outputs(runner: FakeRunnerEvents, count: number): void {
  for (let index = 0; index < count; index += 1)
    runner.output("turn-1", claudeTextLine(`line ${index} `));
}

function inputScan(runner: FakeRunnerEvents, count: number): void {
  runner.lifecycle("turn-1", "task.created");
  for (let index = 0; index < count; index += 1) {
    runner.input("turn-1", `input-${index}`, `steer ${index}`);
    runner.output("turn-1", claudeTextLine("older output "));
  }
  outputs(runner, 2_400);
  runner.lifecycle("turn-1", "task.succeeded");
}

it("scans far below the output window for the newest 32 inputs and stops before older history", async () => {
  const runner = new FakeRunnerEvents();
  inputScan(runner, 80);
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);

  const expected = await loadUntilSettled(forward.gateway, runner);
  const actual = await loadUntilSettled(backward.gateway, runner);
  const inputs = actual.replays.get("turn-1")!.filter((event) => event.type === "task.input");
  const lastRequest = lastOf(backward.backward())!;
  const finalPage = await runner.listEventsBefore(lastRequest);

  expect(inputs).toHaveLength(32);
  expect(inputs[0]?.messageId).toBe("input-48");
  expect(lastOf(inputs)?.messageId).toBe("input-79");
  expect(finalPage.nextCursor).not.toBeNull();
  expect(remoteReplayBackfillPending(actual)).toBe(false);
  expect(actual.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  expect(replayState(actual)).toEqual(replayState(expected));
  expect(projectedTurns(actual)).toEqual(projectedTurns(expected));
});

it("retains the scan cursor and already found inputs across a failed page", async () => {
  const runner = new FakeRunnerEvents();
  runner.lifecycle("turn-1", "task.created");
  runner.input("turn-1", "old-input", "older steer");
  outputs(runner, 500);
  runner.input("turn-1", "scan-input", "found during scan");
  outputs(runner, 1_900);
  runner.lifecycle("turn-1", "task.succeeded");
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const first = await loadTailFirst(backward.gateway);
  expect(first.replayBackfill?.get("turn-1")?.kind).toBe("scanningInputs");
  const progress: RemoteAgentInventorySnapshot[] = [];
  let requestedBefore = 0;
  backward.calls.listEventsBefore.mockImplementation(
    async (request: RemoteRunnerEventsBeforeRequest) => {
      if (
        lastOf(progress)
          ?.replays.get("turn-1")
          ?.some((event) => event.type === "task.input")
      ) {
        requestedBefore = request.before;
        return Promise.reject(new Error("Scan failed."));
      }
      return runner.listEventsBefore(request);
    },
  );

  await expect(
    loadTailFirst(backward.gateway, first, (snapshot) => progress.push(snapshot)),
  ).rejects.toThrow("Scan failed.");
  const kept = lastOf(progress)!;
  expect(
    kept.replays
      .get("turn-1")!
      .filter((event) => event.type === "task.input")
      .map((event) => event.messageId),
  ).toEqual(["scan-input"]);
  expect(kept.replayBackfill?.get("turn-1")).toEqual({
    kind: "scanningInputs",
    before: requestedBefore,
  });
  expect(projectedTurn(kept, "turn-1")?.eventsRetention).toBe("clientWindow");
  expect(projectedTurn(kept, "turn-1")?.eventsTruncated).toBe(true);
  expect(kept.replayGaps).toEqual(first.replayGaps);
  backward.calls.listEventsBefore.mockClear();
  backward.calls.listEventsBefore.mockImplementation(runner.listEventsBefore);

  const resumed = await loadTailFirst(backward.gateway, kept);
  const expected = await loadUntilSettled(forward.gateway, runner);

  expect(backward.backward()[0]?.before).toBe(requestedBefore);
  expect(resumed.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  expect(replayState(resumed)).toEqual(replayState(expected));
  expect(projectedTurns(resumed)).toEqual(projectedTurns(expected));
});

it.each([0, 7])("ends scanning at exhaustion with %i accepted inputs", async (count) => {
  const runner = new FakeRunnerEvents();
  inputScan(runner, count);
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const expected = await loadUntilSettled(forward.gateway, runner);
  const actual = await loadUntilSettled(backward.gateway, runner);
  const pages = backward.backward().length;

  expect(actual.replays.get("turn-1")!.filter((event) => event.type === "task.input")).toHaveLength(
    count,
  );
  expect(actual.replayBackfill?.get("turn-1")).toEqual({ kind: "retained" });
  expect(pages).toBe(Math.ceil(runner.eventsOf("turn-1").length / 50));
  expect(replayState(actual)).toEqual(replayState(expected));
  expect(projectedTurns(actual)).toEqual(projectedTurns(expected));

  const again = await loadTailFirst(backward.gateway, actual);

  expect(backward.backward()).toHaveLength(pages);
  expect(replayState(again)).toEqual(replayState(actual));
});
