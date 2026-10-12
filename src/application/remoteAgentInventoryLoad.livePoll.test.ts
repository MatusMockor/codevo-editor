import { expect, it } from "vitest";
import { fakeRunnerGateway, loadTailFirst, remoteTurn } from "./remoteAgentTailFirstTestSupport";
import { REMOTE_TASK_REPLAY_TAIL_BEFORE } from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

it.each(["draft", "queued"] as const)(
  "does not live-poll the newest %s turn during an older terminal turn's backfill",
  async (status) => {
    const runner = new FakeRunnerEvents();
    for (let index = 0; index < 500; index += 1) runner.output("turn-1", "");
    runner.lifecycle("turn-2", "task.created");
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2, { status })]);

    const snapshot = await loadTailFirst(h.gateway);

    expect(
      h.backward().filter((request) => request.before !== REMOTE_TASK_REPLAY_TAIL_BEFORE),
    ).toHaveLength(9);
    expect(h.forward()).toEqual([]);
    expect(snapshot.replayBackfill?.get("turn-1")).toEqual({ kind: "loaded" });
    expect(snapshot.replayComplete.has("turn-2")).toBe(false);
  },
);

it("live-polls an older running turn when the newest selected turn is terminal", async () => {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < 500; index += 1) runner.output("turn-1", "");
  runner.lifecycle("turn-2", "task.succeeded");
  const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" }), remoteTurn(2)]);
  let pages = 0;
  let liveSequence = 0;
  h.calls.listEventsBefore.mockImplementation(async (request) => {
    const page = await runner.listEventsBefore(request);
    if (request.before === REMOTE_TASK_REPLAY_TAIL_BEFORE) return page;
    pages += 1;
    if (pages === 4) liveSequence = runner.output("turn-1", claudeTextLine("live older turn"));
    return page;
  });
  const observed: number[] = [];

  const snapshot = await loadTailFirst(h.gateway, undefined, (progress) => {
    if (progress.replays.get("turn-1")?.some((event) => event.sequence === liveSequence))
      observed.push(pages);
  });

  expect(h.forward()).toEqual([
    { serverId: "server", taskId: "turn-1", after: 500 },
    { serverId: "server", taskId: "turn-1", after: liveSequence },
  ]);
  expect(observed[0]).toBe(4);
  expect(snapshot.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
  expect(snapshot.replayComplete.has("turn-1")).toBe(false);
  expect(snapshot.replayComplete.has("turn-2")).toBe(true);
});

it("live-polls only the newest selected running turn", async () => {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < 500; index += 1) runner.output("turn-1", "");
  runner.lifecycle("turn-2", "task.running");
  runner.lifecycle("turn-3", "task.succeeded");
  const h = fakeRunnerGateway(runner, [
    remoteTurn(1, { status: "running" }),
    remoteTurn(2, { status: "running" }),
    remoteTurn(3),
  ]);

  await loadTailFirst(h.gateway);

  expect(h.forward()).toEqual([
    { serverId: "server", taskId: "turn-2", after: 501 },
    { serverId: "server", taskId: "turn-2", after: 501 },
  ]);
});
