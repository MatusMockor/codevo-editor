import { describe, expect, it } from "vitest";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import type { RemoteRunnerServer, RemoteRunnerTask } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  loadUntilSettled,
  projectedTurns,
  remoteTurn,
  replayState,
  TAIL_FIRST_THREAD,
} from "./remoteAgentTailFirstTestSupport";
import { remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";
import { createRemoteReplayMemory, transitionRemoteReplayMemory } from "./remoteAgentReplayMemory";

const server: RemoteRunnerServer = {
  id: "server",
  name: "Server",
  host: "host",
  username: "user",
  port: 22,
  connected: true,
};

function restored(snapshot: RemoteAgentInventorySnapshot) {
  const lease = {};
  const selected = transitionRemoteReplayMemory(createRemoteReplayMemory(lease), {
    lease,
    servers: [server],
    snapshots: [],
    selectedThreadId: TAIL_FIRST_THREAD,
  });
  const away = transitionRemoteReplayMemory(selected.memory, {
    lease,
    servers: [server],
    snapshots: [snapshot],
    selectedThreadId: null,
  });
  return transitionRemoteReplayMemory(away.memory, {
    lease,
    servers: [server],
    snapshots: away.snapshots,
    selectedThreadId: TAIL_FIRST_THREAD,
  }).snapshots[0]!;
}

function output(runner: FakeRunnerEvents, count: number): void {
  for (let index = 0; index < count; index += 1)
    runner.output("turn-1", claudeTextLine(`line ${index} `));
}

describe("remembered remote inventory replay loading", () => {
  it.each([{}, { eventBackwardPaging: true }])(
    "rechecks terminal complete replay once and retains references for capability %j",
    async (capabilities) => {
      const runner = new FakeRunnerEvents();
      output(runner, 1_999);
      runner.lifecycle("turn-1", "task.succeeded");
      expect(runner.eventsOf("turn-1")).toHaveLength(2_000);
      const h = fakeRunnerGateway(runner, [remoteTurn(1)], capabilities);
      const first = await loadUntilSettled(h.gateway, runner);
      expect(h.forward().length + h.backward().length).toBe(40);
      h.calls.getTask.mockClear();
      h.calls.listTasks.mockClear();
      h.calls.listEvents.mockClear();
      h.calls.listEventsBefore.mockClear();

      let current = await loadTailFirst(h.gateway, restored(first));
      for (let index = 0; index < 3; index += 1) current = await loadTailFirst(h.gateway, current);

      expect(h.forward()).toEqual([
        { serverId: "server", taskId: "turn-1", after: first.replayCursors?.get("turn-1") },
      ]);
      expect(h.backward()).toEqual([]);
      expect(h.calls.listTasks.mock.calls).toEqual(
        Array.from({ length: 4 }, () => [{ serverId: "server", after: first.listingCursor }]),
      );
      expect(h.calls.getTask.mock.calls).toEqual([[{ serverId: "server", taskId: "turn-1" }]]);
      expect(current.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
      expect(replayState(current)).toEqual(replayState(first));
      expect(projectedTurns(current)).toEqual(projectedTurns(first));
    },
  );

  it("preserves the terminal tail probe through running progress and a failed resume request", async () => {
    const runner = new FakeRunnerEvents();
    runner.output("turn-1", claudeTextLine("terminal original "));
    runner.lifecycle("turn-1", "task.succeeded");
    runner.output("turn-2", claudeTextLine("running original "));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2, { status: "running" })]);
    const first = await loadUntilSettled(h.gateway, runner);
    runner.input("turn-1", "late-input", "late terminal steer");
    runner.output("turn-2", claudeTextLine("new running output "));
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    h.calls.getTaskResume.mockRejectedValueOnce(new Error("Request timed out."));
    const progress: RemoteAgentInventorySnapshot[] = [];

    await expect(
      loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
    ).rejects.toThrow("Request timed out.");

    expect(progress.length).toBeGreaterThan(0);
    const interrupted = progress[progress.length - 1]!;
    expect(interrupted.replayRestore).toBeUndefined();
    expect(interrupted.replayComplete.has("turn-1")).toBe(false);
    expect(h.forward().filter((request) => request.taskId === "turn-1")).toEqual([]);
    const current = await loadTailFirst(h.gateway, interrupted);
    expect(h.forward().filter((request) => request.taskId === "turn-1")).toEqual([
      { serverId: "server", taskId: "turn-1", after: first.replayCursors?.get("turn-1") },
    ]);
    expect(current.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
    expect(projectedTurns(current)?.[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "userMessage", text: "late terminal steer" }),
      ]),
    );
    await loadTailFirst(h.gateway, current);
    expect(h.forward().filter((request) => request.taskId === "turn-1")).toHaveLength(1);
  });

  it("does not repeat a successful empty terminal probe after a later resume failure", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 1);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEvents.mockClear();
    h.calls.getTaskResume.mockRejectedValueOnce(new Error("Request timed out."));
    const progress: RemoteAgentInventorySnapshot[] = [];
    await expect(
      loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
    ).rejects.toThrow("Request timed out.");
    expect(progress).toHaveLength(1);
    expect(progress[0]?.replayComplete.has("turn-1")).toBe(true);
    const current = await loadTailFirst(h.gateway, progress[0]);
    expect(h.forward()).toEqual([
      { serverId: "server", taskId: "turn-1", after: first.replayCursors?.get("turn-1") },
    ]);
    expect(current.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
  });

  it("catches up a formerly running task forward and settles it without duplication", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
    const first = await loadUntilSettled(h.gateway, runner);
    const cursor = first.replayCursors?.get("turn-1");
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    output(runner, 20);
    runner.lifecycle("turn-1", "task.succeeded");
    h.replaceTasks([remoteTurn(1)]);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.forward()).toEqual([{ serverId: "server", taskId: "turn-1", after: cursor }]);
    expect(h.backward()).toEqual([]);
    expect(current.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
    expect(current.replayComplete.has("turn-1")).toBe(true);
    expect(current.replayCursors?.get("turn-1")).toBe(lastOf(runner.eventsOf("turn-1"))?.sequence);
    await loadTailFirst(h.gateway, current);
    expect(h.forward()).toHaveLength(1);
  });

  it.each([{}, { eventBackwardPaging: true }])(
    "publishes cleared running catch-up provenance after an empty read before a resume failure for capability %j",
    async (capabilities) => {
      const runner = new FakeRunnerEvents();
      output(runner, 50);
      const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })], capabilities);
      const first = await loadUntilSettled(h.gateway, runner);
      h.calls.listEvents.mockClear();
      h.calls.listEventsBefore.mockClear();
      h.calls.getTaskResume.mockRejectedValueOnce(new Error("Request timed out."));
      const progress: RemoteAgentInventorySnapshot[] = [];

      await expect(
        loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
      ).rejects.toThrow("Request timed out.");

      expect(progress).toHaveLength(1);
      expect(progress[0]?.replayCatchUpTaskIds?.size).toBe(0);
      expect(progress[0]?.replayComplete.has("turn-1")).toBe(false);
      expect(progress[0]?.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
      expect(h.forward().map((request) => request.after)).toEqual([50]);
      output(runner, 1_300);
      h.calls.listEvents.mockClear();

      const current = await loadTailFirst(h.gateway, progress[0]);

      expect(h.forward().map((request) => request.after)).toEqual(
        Array.from({ length: 24 }, (_, index) => 50 + index * 50),
      );
      expect(current.replayCursors?.get("turn-1")).toBe(1_250);
      expect(current.replayCatchUpTaskIds?.size).toBe(0);
      expect(h.backward()).toEqual([]);
    },
  );

  it("catches a cancelled task becoming failed while deselected with one forward request", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    runner.lifecycle("turn-1", "task.cancelled");
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "cancelled" })]);
    const first = await loadUntilSettled(h.gateway, runner);
    const cursor = first.replayCursors?.get("turn-1");
    runner.lifecycle("turn-1", "task.failed");
    h.replaceTasks([remoteTurn(1, { status: "failed" })]);
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    const cold = fakeRunnerGateway(runner, [remoteTurn(1, { status: "failed" })], {});
    const expected = await loadUntilSettled(cold.gateway, runner);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.forward()).toEqual([{ serverId: "server", taskId: "turn-1", after: cursor }]);
    expect(h.backward()).toEqual([]);
    expect(current.tasks[0]?.status).toBe("failed");
    expect(lastOf(current.replays.get("turn-1") ?? [])?.type).toBe("task.failed");
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
    await loadTailFirst(h.gateway, current);
    expect(h.forward()).toHaveLength(1);
  });

  it("reads late input from only the newest restored terminal turn once", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    runner.lifecycle("turn-1", "task.succeeded");
    runner.output("turn-2", claudeTextLine("newest "));
    runner.lifecycle("turn-2", "task.succeeded");
    const tasks = [remoteTurn(1), remoteTurn(2)];
    const h = fakeRunnerGateway(runner, tasks);
    const first = await loadUntilSettled(h.gateway, runner);
    const cursor = first.replayCursors?.get("turn-2");
    runner.input("turn-2", "late-input", "late steering");
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    const cold = fakeRunnerGateway(runner, tasks, {});
    const expected = await loadUntilSettled(cold.gateway, runner);

    let current = await loadTailFirst(h.gateway, restored(first));
    for (let pass = 0; pass < 3; pass += 1) current = await loadTailFirst(h.gateway, current);

    expect(h.forward()).toEqual([{ serverId: "server", taskId: "turn-2", after: cursor }]);
    expect(h.backward()).toEqual([]);
    expect(current.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
    expect(lastOf(current.replays.get("turn-2") ?? [])?.messageId).toBe("late-input");
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
  });

  it("reads every forward page of late input after restoring a complete terminal task", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    runner.lifecycle("turn-1", "task.succeeded");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    const cursor = first.replayCursors!.get("turn-1")!;
    for (let index = 0; index < 70; index += 1)
      runner.input("turn-1", `late-${index}`, `late steering ${index}`);
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    const cold = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const expected = await loadUntilSettled(cold.gateway, runner);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.forward()).toEqual([
      { serverId: "server", taskId: "turn-1", after: cursor },
      { serverId: "server", taskId: "turn-1", after: cursor + 50 },
    ]);
    expect(h.backward()).toEqual([]);
    expect(current.replayCursors?.get("turn-1")).toBe(cursor + 70);
    expect(lastOf(current.replays.get("turn-1") ?? [])?.messageId).toBe("late-69");
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
    await loadTailFirst(h.gateway, current);
    expect(h.forward()).toHaveLength(2);
  });

  it("returns to forty turns with one detail call before the running turn catch-up", async () => {
    const runner = new FakeRunnerEvents();
    const tasks = Array.from({ length: 40 }, (_, index) =>
      remoteTurn(index + 1, index === 39 ? { status: "running" } : {}),
    );
    for (const task of tasks) runner.output(task.id, claudeTextLine(`${task.id} `));
    const h = fakeRunnerGateway(runner, tasks);
    const first = await loadUntilSettled(h.gateway, runner);
    expect(h.backward()).toHaveLength(40);
    expect(h.forward()).toEqual([]);
    const cursor = first.replayCursors?.get("turn-40");
    runner.output("turn-40", claudeTextLine("live catch-up "));
    h.calls.getTask.mockClear();
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.calls.getTask.mock.calls).toEqual([[{ serverId: "server", taskId: "turn-40" }]]);
    expect(h.forward()).toEqual([
      { serverId: "server", taskId: "turn-40", after: cursor },
      { serverId: "server", taskId: "turn-39", after: first.replayCursors?.get("turn-39") },
    ]);
    expect(h.backward()).toEqual([]);
    expect(h.calls.getTask.mock.invocationCallOrder[0]).toBeLessThan(
      h.calls.listEvents.mock.invocationCallOrder[0]!,
    );
    expect(current.replays.get("turn-40")).toEqual(runner.eventsOf("turn-40"));
    for (const task of tasks.slice(0, -1))
      expect(current.replays.get(task.id)).toBe(first.replays.get(task.id));
  });

  it("preserves canonical task parts when restored listing parts are abbreviated", async () => {
    const runner = new FakeRunnerEvents();
    const tasks = [1, 2].map((index) =>
      remoteTurn(index, {
        parts: [
          {
            type: "text",
            text: `Full canonical instructions for turn ${index}, with retained context.`,
          },
        ],
      }),
    );
    for (const task of tasks) runner.output(task.id, claudeTextLine(`${task.id} `));
    const h = fakeRunnerGateway(runner, tasks);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.getTask.mockClear();
    h.calls.listTasks.mockClear();
    h.calls.listTasks.mockImplementation(async ({ after }: { after: number }) => ({
      items: tasks
        .filter((task) => task.sequence > after)
        .sort((left, right) => left.sequence - right.sequence)
        .map((task) => ({ ...task, parts: [{ type: "text" as const, text: "Full canonical…" }] })),
      nextCursor: null,
    }));

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.calls.listTasks.mock.calls).toEqual([
      [{ serverId: "server", after: first.listingCursor }],
    ]);
    expect(h.calls.getTask.mock.calls).toEqual([[{ serverId: "server", taskId: "turn-2" }]]);
    expect(current.tasks).toEqual(first.tasks);
    expect(current.detailedTaskIds).toEqual(first.detailedTaskIds);
    for (const task of first.tasks)
      expect(current.tasks.find((currentTask) => currentTask.id === task.id)?.parts).toBe(
        task.parts,
      );
    expect(projectedTurns(current)).toEqual(projectedTurns(first));
  });

  it("matches a cold open when the thread gained a turn while deselected", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    runner.lifecycle("turn-1", "task.succeeded");
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    for (let index = 0; index < 80; index += 1)
      runner.output("turn-2", claudeTextLine(`new turn ${index} `));
    runner.input("turn-2", "new-turn-input", "steer the new turn");
    runner.lifecycle("turn-2", "task.succeeded");
    const tasks = [remoteTurn(1), remoteTurn(2)];
    h.replaceTasks(tasks);
    const cold = fakeRunnerGateway(runner, tasks, {});
    const expected = await loadUntilSettled(cold.gateway, runner);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
    expect(current.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
  });

  it("restarts from the newest tail after four restored forward catch-up pages", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 50);
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    output(runner, 400);
    runner.lifecycle("turn-1", "task.succeeded");
    h.replaceTasks([remoteTurn(1)]);
    const legacy = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const expected = await loadUntilSettled(legacy.gateway, runner);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.forward().map((request) => request.after)).toEqual([50, 100, 150, 200]);
    expect(h.backward()[0]).toEqual({
      serverId: "server",
      taskId: "turn-1",
      before: Number.MAX_SAFE_INTEGER,
    });
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
  });

  it("continues restored catch-up forward while backward paging is absent", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 50);
    const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })], {});
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEvents.mockClear();
    output(runner, 400);
    runner.lifecycle("turn-1", "task.succeeded");
    h.replaceTasks([remoteTurn(1)]);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.forward()).toHaveLength(9);
    expect(h.forward()[0]?.after).toBe(50);
    expect(h.backward()).toEqual([]);
    expect(current.replays.get("turn-1")).toEqual(runner.eventsOf("turn-1"));
  });

  it.each<Partial<RemoteRunnerTask>>([
    { status: "running" },
    { provider: "codex" },
    { createdAt: "2026-10-12T00:00:00Z" },
    { sequence: 2 },
  ])("drops replay when an authoritative restored task changes %j", async (change) => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEventsBefore.mockClear();
    h.replaceTasks([remoteTurn(1, change)]);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.backward()[0]?.before).toBe(Number.MAX_SAFE_INTEGER);
    expect(current.tasks.find((task) => task.id === "turn-1")).toEqual(remoteTurn(1, change));
    expect(current.replays.get("turn-1")).not.toBe(first.replays.get("turn-1"));
  });

  it("cold-opens every remembered turn after the newest turn's identity changes", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    for (let index = 0; index < 80; index += 1)
      runner.output("turn-2", claudeTextLine(`second ${index} `));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEventsBefore.mockClear();
    const changed = [remoteTurn(1), remoteTurn(2, { createdAt: "2026-10-12T00:00:00Z" })];
    h.replaceTasks(changed);
    const legacy = fakeRunnerGateway(runner, changed, {});
    const expected = await loadUntilSettled(legacy.gateway, runner);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.backward().slice(0, 2)).toEqual([
      { serverId: "server", taskId: "turn-2", before: Number.MAX_SAFE_INTEGER },
      { serverId: "server", taskId: "turn-1", before: Number.MAX_SAFE_INTEGER },
    ]);
    for (const taskId of ["turn-1", "turn-2"])
      expect(current.replays.get(taskId)).not.toBe(first.replays.get(taskId));
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
  });

  it("cold-opens all turns when the newest remembered identity reveals a reset", async () => {
    const runner = new FakeRunnerEvents();
    for (const taskId of ["turn-1", "turn-2"])
      runner.output(taskId, claudeTextLine(`old ${taskId} `));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const first = await loadUntilSettled(h.gateway, runner);
    const reset = new FakeRunnerEvents();
    for (const taskId of ["turn-1", "turn-2"])
      reset.output(taskId, claudeTextLine(`reset ${taskId} `));
    const tasks = [1, 2].map((index) => remoteTurn(index, { createdAt: "2026-10-12T00:00:00Z" }));
    h.replaceTasks(tasks);
    h.calls.listEvents.mockImplementation(reset.listEvents);
    h.calls.listEventsBefore.mockImplementation(reset.listEventsBefore);
    h.calls.listTasks.mockClear();
    const cold = fakeRunnerGateway(reset, tasks, {});
    const expected = await loadUntilSettled(cold.gateway, reset);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.calls.listTasks.mock.calls).toEqual([[{ serverId: "server", after: 0 }]]);
    expect(current.tasks).toEqual(tasks.slice().reverse());
    for (const taskId of ["turn-1", "turn-2"])
      expect(current.replays.get(taskId)).not.toBe(first.replays.get(taskId));
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
  });

  it("lists a low-sequence replacement after the newest remembered task is missing", async () => {
    const runner = new FakeRunnerEvents();
    for (const taskId of ["turn-1", "turn-2"])
      runner.output(taskId, claudeTextLine(`old ${taskId} `));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const first = await loadUntilSettled(h.gateway, runner);
    const reset = new FakeRunnerEvents();
    reset.output("turn-1", claudeTextLine("replacement "));
    const tasks = [remoteTurn(1, { createdAt: "2026-10-12T00:00:00Z" })];
    h.replaceTasks(tasks);
    h.calls.getTask.mockRejectedValueOnce(
      new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404)."),
    );
    h.calls.listEvents.mockImplementation(reset.listEvents);
    h.calls.listEventsBefore.mockImplementation(reset.listEventsBefore);
    h.calls.listTasks.mockClear();
    const cold = fakeRunnerGateway(reset, tasks, {});
    const expected = await loadUntilSettled(cold.gateway, reset);

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(h.calls.listTasks.mock.calls).toEqual([[{ serverId: "server", after: 0 }]]);
    expect(current.tasks).toEqual(tasks);
    expect(current.replays.has("turn-2")).toBe(false);
    expect(replayState(current)).toEqual(replayState(expected));
    expect(projectedTurns(current)).toEqual(projectedTurns(expected));
  });

  it("invalidates loaded and unread turns when the newest remembered turn's identity changes", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    for (let index = 0; index < 80; index += 1)
      runner.output("turn-2", claudeTextLine(`second ${index} `));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const snapshots: RemoteAgentInventorySnapshot[] = [];
    await loadTailFirst(h.gateway, undefined, (snapshot) => snapshots.push(snapshot));
    const suspended = snapshots.find(
      (snapshot) => snapshot.replays.has("turn-2") && !snapshot.replays.has("turn-1"),
    )!;
    expect(suspended.detailedTaskIds?.has("turn-1")).toBe(true);
    h.calls.listEventsBefore.mockClear();
    h.replaceTasks([remoteTurn(1), remoteTurn(2, { createdAt: "2026-10-12T00:00:00Z" })]);

    const current = await loadTailFirst(h.gateway, restored(suspended));

    expect(h.backward().slice(0, 2)).toEqual([
      { serverId: "server", taskId: "turn-2", before: Number.MAX_SAFE_INTEGER },
      { serverId: "server", taskId: "turn-1", before: Number.MAX_SAFE_INTEGER },
    ]);
    expect(current.tasks.find((task) => task.id === "turn-2")?.createdAt).toBe(
      "2026-10-12T00:00:00Z",
    );
    expect(current.replays.get("turn-2")).not.toBe(suspended.replays.get("turn-2"));
  });

  it("clears invalidation provenance after the task history has restarted", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.replaceTasks([remoteTurn(1, { status: "running" })]);
    const restarted = await loadTailFirst(h.gateway, restored(first));
    expect(restarted.replayInvalidatedTaskIds?.has("turn-1")).toBe(true);

    const current = await loadTailFirst(h.gateway, restarted);

    expect(current.replayInvalidatedTaskIds?.size ?? 0).toBe(0);
    expect(current.tasks[0]?.status).toBe("running");
  });

  it("removes a remembered task on an authoritative missing-task response", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.listEvents.mockClear();
    h.calls.listEventsBefore.mockClear();
    h.calls.getTask.mockRejectedValueOnce(
      new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404)."),
    );

    const current = await loadTailFirst(h.gateway, restored(first));

    expect(current.tasks).toEqual([]);
    expect(current.replays.size).toBe(0);
    expect(h.forward()).toEqual([]);
    expect(h.backward()).toEqual([]);
  });

  it("publishes invalidated replay before a later metadata request fails", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.replaceTasks([remoteTurn(1, { status: "running" })]);
    h.calls.listProjects.mockRejectedValueOnce(new Error("Request timed out."));
    const progress: RemoteAgentInventorySnapshot[] = [];

    await expect(
      loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
    ).rejects.toThrow("Request timed out.");

    expect(progress).toHaveLength(1);
    expect(progress[0]?.replays.size).toBe(0);
    expect(progress[0]?.replayCursors?.size).toBe(0);
    expect(progress[0]?.tasks[0]?.status).toBe("running");
    expect(progress[0]?.replayInvalidatedTaskIds?.has("turn-1")).toBe(true);
  });

  it("retries reset listing from zero after invalidation progress and a metadata failure", async () => {
    const runner = new FakeRunnerEvents();
    for (const taskId of ["turn-1", "turn-2"])
      runner.output(taskId, claudeTextLine(`old ${taskId} `));
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const first = await loadUntilSettled(h.gateway, runner);
    const reset = new FakeRunnerEvents();
    reset.output("turn-1", claudeTextLine("replacement "));
    const tasks = [remoteTurn(1, { createdAt: "2026-10-12T00:00:00Z" })];
    h.replaceTasks(tasks);
    h.calls.getTask.mockRejectedValueOnce(
      new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404)."),
    );
    h.calls.listProjects.mockRejectedValueOnce(new Error("Request timed out."));
    h.calls.listEvents.mockImplementation(reset.listEvents);
    h.calls.listEventsBefore.mockImplementation(reset.listEventsBefore);
    const progress: RemoteAgentInventorySnapshot[] = [];

    await expect(
      loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
    ).rejects.toThrow("Request timed out.");

    expect(progress).toHaveLength(1);
    expect(progress[0]?.listingCursor).toBe(0);
    h.calls.listTasks.mockClear();
    const current = await loadTailFirst(h.gateway, progress[0]);
    expect(h.calls.listTasks.mock.calls).toEqual([[{ serverId: "server", after: 0 }]]);
    expect(current.tasks).toEqual(tasks);
    expect(current.replays.get("turn-1")).toEqual(reset.eventsOf("turn-1"));
    expect(current.replays.has("turn-2")).toBe(false);
  });

  it("does not invalidate remembered replay on a transient detail failure", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 80);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadUntilSettled(h.gateway, runner);
    h.calls.getTask.mockRejectedValueOnce(new Error("Request timed out."));
    const progress: RemoteAgentInventorySnapshot[] = [];

    await expect(
      loadTailFirst(h.gateway, restored(first), (snapshot) => progress.push(snapshot)),
    ).rejects.toThrow("Request timed out.");

    expect(progress).toEqual([]);
    const current = await loadTailFirst(h.gateway, restored(first));
    expect(current.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
  });

  it("suspends remembered unfinished backward work until its capability returns", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, 2_000);
    runner.lifecycle("turn-1", "task.succeeded");
    const backward = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const first = await loadTailFirst(backward.gateway);
    expect(remoteReplayBackfillPending(first)).toBe(true);
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});

    const suspended = await loadTailFirst(forward.gateway, restored(first));

    expect(forward.forward()).toEqual([
      { serverId: "server", taskId: "turn-1", after: first.replayCursors?.get("turn-1") },
    ]);
    expect(suspended.replays.get("turn-1")).toBe(first.replays.get("turn-1"));
    expect(suspended.replayBackfill).toEqual(first.replayBackfill);
    backward.calls.listEventsBefore.mockClear();
    const resumed = await loadTailFirst(backward.gateway, restored(suspended));
    const before = first.replayBackfill?.get("turn-1");
    expect(backward.backward()[0]?.before).toBe(
      before && "before" in before ? before.before : undefined,
    );
    expect(remoteReplayBackfillPending(resumed)).toBe(false);
  });
});
