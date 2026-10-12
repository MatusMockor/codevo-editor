import { expect, it } from "vitest";
import { fakeRunnerGateway, loadTailFirst, remoteTurn } from "./remoteAgentTailFirstTestSupport";
import {
  MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS,
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
  REMOTE_TASK_REPLAY_TAIL_BEFORE,
  remoteReplayBackfillAdvanced,
  remoteReplayBackfillPending,
} from "./remoteAgentTaskReplay";
import { FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

function outputEvents(runner: FakeRunnerEvents, taskId: string, count: number): void {
  for (let index = 0; index < count; index += 1) runner.output(taskId, "");
}

it("budgets all output backfill globally after opening every selected tail and resumes without rereading", async () => {
  const runner = new FakeRunnerEvents(10);
  for (const index of [1, 2, 3]) outputEvents(runner, `turn-${index}`, 2_000);
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);

  const first = await loadTailFirst(h.gateway);
  const firstRequests = h.backward();

  expect(MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS).toBe(48);
  expect(firstRequests.slice(0, 3)).toEqual(
    ["turn-3", "turn-2", "turn-1"].map((taskId) => ({
      serverId: "server",
      taskId,
      before: REMOTE_TASK_REPLAY_TAIL_BEFORE,
    })),
  );
  expect(firstRequests.slice(3).map((request) => request.taskId)).toEqual([
    ...Array<string>(MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS).fill("turn-3"),
    ...Array<string>(MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS).fill("turn-2"),
  ]);
  expect(firstRequests).toHaveLength(3 + MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS);
  expect(first.replays.get("turn-3")).toEqual(runner.eventsOf("turn-3").slice(-250));
  expect(first.replays.get("turn-2")).toEqual(runner.eventsOf("turn-2").slice(-250));
  expect(first.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1").slice(-10));
  expect(remoteReplayBackfillPending(first)).toBe(true);
  expect(remoteReplayBackfillAdvanced(first, first)).toBe(false);

  const second = await loadTailFirst(h.gateway, first);
  const resumedRequests = h.backward().slice(firstRequests.length);

  expect(resumedRequests).toHaveLength(MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS);
  for (const taskId of ["turn-3", "turn-2"]) {
    const prior = first.replayBackfill?.get(taskId);
    expect(prior?.kind).toBe("pending");
    expect(resumedRequests.find((request) => request.taskId === taskId)?.before).toBe(
      prior?.kind === "pending" ? prior.before : undefined,
    );
    expect(second.replays.get(taskId)).toEqual(runner.eventsOf(taskId).slice(-490));
  }
  expect(second.replays.get("turn-1")).toEqual(first.replays.get("turn-1"));
  expect(remoteReplayBackfillAdvanced(first, second)).toBe(true);
  const reads = h.backward().map((request) => `${request.taskId}:${request.before}`);
  expect(new Set(reads).size).toBe(reads.length);
  expect(h.forward()).toEqual([]);
});

it("shares the global and per-task budgets with input scans after all output backfill", async () => {
  const runner = new FakeRunnerEvents();
  outputEvents(runner, "turn-1", 51);
  for (const taskId of ["turn-2", "turn-3"]) outputEvents(runner, taskId, 2_000);
  const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2), remoteTurn(3)]);

  const first = await loadTailFirst(h.gateway);
  const requests = h.backward();

  expect(requests).toHaveLength(3 + MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS);
  expect(requests.slice(3).map((request) => request.taskId)).toEqual([
    ...Array<string>(22).fill("turn-3"),
    ...Array<string>(22).fill("turn-2"),
    "turn-1",
    "turn-3",
    "turn-3",
    "turn-2",
  ]);
  expect(first.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
  expect(first.replayBackfill?.get("turn-3")).toEqual({
    kind: "scanningInputs",
    before: runner.eventsOf("turn-3")[750]!.sequence,
  });
  expect(first.replayBackfill?.get("turn-2")).toEqual({
    kind: "scanningInputs",
    before: runner.eventsOf("turn-2")[800]!.sequence,
  });
  for (const taskId of ["turn-3", "turn-2"]) {
    expect(first.replays.get(taskId)).toEqual(runner.eventsOf(taskId).slice(-1_100));
    expect(first.replayTruncated.has(taskId)).toBe(true);
    expect(requests.filter((request) => request.taskId === taskId).length - 1).toBeLessThanOrEqual(
      MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
    );
  }

  const second = await loadTailFirst(h.gateway, first);
  const resumed = h.backward().slice(requests.length);

  expect(resumed[0]?.before).toBe(runner.eventsOf("turn-3")[750]!.sequence);
  expect(resumed.find((request) => request.taskId === "turn-2")?.before).toBe(
    runner.eventsOf("turn-2")[800]!.sequence,
  );
  expect(remoteReplayBackfillPending(second)).toBe(false);
  for (const taskId of ["turn-3", "turn-2"]) {
    expect(second.replayBackfill?.get(taskId)).toEqual({ kind: "retained" });
    expect(second.replays.get(taskId)).toEqual(first.replays.get(taskId));
    expect(second.replayGaps?.get(taskId)).toEqual(first.replayGaps?.get(taskId));
  }
  const reads = h.backward().map((request) => `${request.taskId}:${request.before}`);
  expect(new Set(reads).size).toBe(reads.length);
});
