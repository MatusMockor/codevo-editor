import { expect, it } from "vitest";
import {
  fakeRunnerGateway,
  loadUntilSettled,
  remoteTurn,
  replayState,
} from "./remoteAgentTailFirstTestSupport";
import { FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

it("opens N one-page terminal tasks with N backward reads versus N forward reads", async () => {
  const runner = new FakeRunnerEvents();
  const tasks = Array.from({ length: 4 }, (_, index) => remoteTurn(index + 1));
  for (const task of tasks) {
    runner.lifecycle(task.id, "task.created");
    runner.lifecycle(task.id, "task.succeeded");
  }
  const backward = fakeRunnerGateway(runner, tasks);
  const forward = fakeRunnerGateway(runner, tasks, {});

  const actual = await loadUntilSettled(backward.gateway, runner);
  const expected = await loadUntilSettled(forward.gateway, runner);

  expect(backward.backward()).toHaveLength(tasks.length);
  expect(forward.forward()).toHaveLength(tasks.length);
  expect(backward.calls.getRunner).toHaveBeenCalledTimes(1);
  expect(forward.calls.getRunner).toHaveBeenCalledTimes(1);
  expect(backward.calls.getTaskResume).toHaveBeenCalledTimes(1);
  expect(forward.calls.getTaskResume).toHaveBeenCalledTimes(1);
  expect(replayState(actual)).toEqual(replayState(expected));
});

it.each([1_200, 2_000])(
  "completes a terminal %i-event turn without an extra forward completion read",
  async (count) => {
    const runner = new FakeRunnerEvents();
    for (let index = 0; index < count; index += 1) runner.output("turn-1", "");
    const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});

    const actual = await loadUntilSettled(backward.gateway, runner);
    const expected = await loadUntilSettled(forward.gateway, runner);

    expect(backward.backward()).toHaveLength(count / 50);
    expect(forward.forward()).toHaveLength(count / 50);
    expect(expected.replayComplete.has("turn-1")).toBe(true);
    expect(backward.calls.getRunner).toHaveBeenCalledTimes(count === 1_200 ? 1 : 2);
    expect(forward.calls.getRunner).toHaveBeenCalledTimes(count === 1_200 ? 1 : 2);
    expect(replayState(actual)).toEqual(replayState(expected));
  },
);
