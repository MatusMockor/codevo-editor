import { afterAll, beforeAll, expect, it } from "vitest";
import type {
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
  RemoteRunnerServer,
} from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { RemoteAgentProjection } from "./remoteAgentProjection";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";
import { remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  projectedTurns,
  replayState,
  TAIL_FIRST_THREAD,
} from "./remoteAgentTailFirstTestSupport";
import {
  CASES_PER_SEED,
  discoverReplayLimits,
  EXTRA_CASES,
  generateStream,
  SEEDS,
  seededDeselectionPasses,
  type GeneratedStream,
  type ReplayLimits,
} from "./remoteAgentDifferentialTestSupport";
import { createRemoteReplayMemory, transitionRemoteReplayMemory } from "./remoteAgentReplayMemory";

const CASES: readonly (readonly [number, number])[] =
  EXTRA_CASES.length > 0
    ? EXTRA_CASES
    : SEEDS.flatMap((seed) =>
        Array.from({ length: CASES_PER_SEED }, (_, index) => [seed, index] as const),
      );
const MAX_PASSES = 160;
const SERVER: RemoteRunnerServer = {
  id: "server",
  name: "Server",
  host: "host",
  username: "user",
  port: 22,
  connected: true,
};
let limits: ReplayLimits;
const mix = {
  cases: 0,
  count: { under: 0, at: 0, over: 0 },
  bytes: { under: 0, at: 0, over: 0 },
  withInputs: 0,
  serverLoss: 0,
  failures: 0,
  suspensions: { pending: 0, scanningInputs: 0, scanningBoundary: 0 },
  multiTask: 0,
  modes: new Map<string, number>(),
  scanPaths: new Set<string>(),
  scanOutcomes: new Set<string>(),
  completionOrders: new Set<string>(),
  unfinishedPasses: new Set<string>(),
  deselections: new Map<number, number>(),
  rememberedPhases: new Set<string>(),
};

beforeAll(async () => {
  limits = await discoverReplayLimits();
});

afterAll(() => {
  expect(CASES.length).toBeGreaterThanOrEqual(320);
  expect([...mix.scanPaths].sort()).toEqual([
    "inputs:boundaryPending",
    "inputs:boundaryResolved",
    "scanningBoundary",
  ]);
  expect([...mix.scanOutcomes]).toEqual(
    expect.arrayContaining(
      ["scanningInputs", "scanningBoundary"].flatMap((phase) =>
        [
          "stdout:true",
          "stdout:false",
          "server:true",
          "server:false",
          "exhaustion",
          "continue",
        ].map((outcome) => `${phase}:${outcome}`),
      ),
    ),
  );
  expect([...mix.completionOrders].sort()).toEqual(["boundaryFirst", "inputsFirst"]);
  expect([...mix.unfinishedPasses]).toEqual(
    expect.arrayContaining(["pending", "scanningInputs", "scanningBoundary", "multiTask"]),
  );
  expect([...mix.deselections.keys()].sort()).toEqual([0, 1, 2, 3]);
  expect([...mix.rememberedPhases]).toEqual(
    expect.arrayContaining(["pending", "scanningInputs", "scanningBoundary"]),
  );
  console.info(
    "Differential mix",
    JSON.stringify({
      limits,
      ...mix,
      modes: Object.fromEntries(mix.modes),
      scanPaths: [...mix.scanPaths],
      scanOutcomes: [...mix.scanOutcomes],
      completionOrders: [...mix.completionOrders],
      unfinishedPasses: [...mix.unfinishedPasses],
      deselections: Object.fromEntries(mix.deselections),
      rememberedPhases: [...mix.rememberedPhases],
    }),
  );
});

function caughtUp(snapshot: RemoteAgentInventorySnapshot, stream: GeneratedStream): boolean {
  if (remoteReplayBackfillPending(snapshot)) return false;
  return stream.tasks.every((task) => {
    if (!snapshot.replays.has(task.id)) return false;
    if (isRemoteTaskTerminal(task) && !snapshot.replayComplete.has(task.id)) return false;
    return (
      snapshot.replayCursors?.get(task.id) ===
      (lastOf(stream.runner.eventsOf(task.id))?.sequence ?? 0)
    );
  });
}

async function forwardEnd(stream: GeneratedStream, context: string) {
  const h = fakeRunnerGateway(stream.runner, stream.tasks, {});
  let snapshot = emptyRemoteInventory("server", true);
  let passes = 0;
  do {
    snapshot = await loadTailFirst(h.gateway, snapshot);
    passes += 1;
  } while (passes < MAX_PASSES && !caughtUp(snapshot, stream));
  expect(passes, `${context}; forward pass bound`).toBeLessThan(MAX_PASSES);
  expect(caughtUp(snapshot, stream), `${context}; forward must catch up`).toBe(true);
  return snapshot;
}

function scanOutcome(page: RemoteRunnerEventPage): string {
  const stdout = lastOf(
    page.items.filter((event) => event.type === "task.output" && event.channel !== "stderr"),
  );
  if (stdout) return `stdout:${stdout.text?.endsWith("\n") ?? true}`;
  const removed = page.outputTruncatedBeforeSequence ?? 0;
  if (removed > 0 && (page.nextCursor === null || page.nextCursor <= removed))
    return `server:${page.outputStartsAtLineBoundary === true}`;
  if (page.nextCursor === null) return "exhaustion";
  return "continue";
}

async function backwardEnd(
  stream: GeneratedStream,
  context: string,
  deselectionPasses: readonly number[],
) {
  const h = fakeRunnerGateway(stream.runner, stream.tasks);
  const incremental = new RemoteAgentProjection();
  let snapshot = emptyRemoteInventory("server", true);
  let failureUsed = false;
  let suspensionUsed = false;
  let suspensionRemaining = 0;
  let suspensionReads = 0;
  let suspensionState: RemoteAgentInventorySnapshot | undefined;
  let progress = snapshot;
  let passes = 0;
  const lease = {};
  let memory = transitionRemoteReplayMemory(createRemoteReplayMemory(lease), {
    lease,
    servers: [SERVER],
    snapshots: [snapshot],
    selectedThreadId: TAIL_FIRST_THREAD,
  }).memory;
  let deselections = 0;
  const reselect = async () => {
    const remembered = snapshot;
    for (const state of remembered.replayBackfill?.values() ?? [])
      mix.rememberedPhases.add(state.kind);
    const deselected = transitionRemoteReplayMemory(memory, {
      lease,
      servers: [SERVER],
      snapshots: [remembered],
      selectedThreadId: null,
    });
    const requests = h.forward().length + h.backward().length;
    const away = await loadRemoteAgentInventory(
      h.gateway,
      deselected.snapshots[0]!,
      null,
      () => true,
    );
    expect(h.forward().length + h.backward().length, `${context}; deselected replay is idle`).toBe(
      requests,
    );
    const restored = transitionRemoteReplayMemory(deselected.memory, {
      lease,
      servers: [SERVER],
      snapshots: [away],
      selectedThreadId: TAIL_FIRST_THREAD,
    });
    expect(restored.restored, `${context}; reselect restores remembered replay`).toBe(true);
    snapshot = restored.snapshots[0]!;
    memory = restored.memory;
    expect(replayState(snapshot), `${context}; restored state is unchanged`).toEqual(
      replayState(remembered),
    );
    for (const [taskId, events] of remembered.replays)
      expect(snapshot.replays.get(taskId), `${context}; ${taskId} reuses remembered events`).toBe(
        events,
      );
    progress = snapshot;
    incremental.project({ ...snapshot, runnerId: "runner" });
    deselections += 1;
  };
  const observe = (next: RemoteAgentInventorySnapshot) => {
    for (const [taskId, state] of next.replayBackfill ?? []) {
      const prior = progress.replayBackfill?.get(taskId);
      if (prior?.kind === "scanningInputs" && prior.stdoutBoundary) {
        if (state.kind === "scanningBoundary") mix.completionOrders.add("inputsFirst");
        if (state.kind === "scanningInputs" && !state.stdoutBoundary)
          mix.completionOrders.add("boundaryFirst");
      }
      if (state.kind === "scanningBoundary") mix.scanPaths.add("scanningBoundary");
      if (state.kind === "scanningInputs")
        mix.scanPaths.add(
          state.stdoutBoundary ? "inputs:boundaryPending" : "inputs:boundaryResolved",
        );
    }
  };
  const descriptor = await h.gateway.getRunner({ serverId: "server" });
  h.calls.listEventsBefore.mockImplementation(async (request: RemoteRunnerEventsBeforeRequest) => {
    if (!failureUsed && stream.failureAt !== null && h.backward().length === stream.failureAt) {
      failureUsed = true;
      return Promise.reject(new Error("Seeded backward page failure"));
    }
    const state = progress.replayBackfill?.get(request.taskId);
    const page = await stream.runner.listEventsBefore(request);
    if (
      state?.kind === "scanningBoundary" ||
      (state?.kind === "scanningInputs" && state.stdoutBoundary)
    )
      mix.scanOutcomes.add(`${state.kind}:${scanOutcome(page)}`);
    return page;
  });
  do {
    const result = await loadTailFirst(h.gateway, snapshot, (next) => {
      observe(next);
      progress = next;
      incremental.project({ ...next, runnerId: "runner" });
    }).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    passes += 1;
    if (result.value === undefined) {
      expect(result.error, `${context}; only the seeded failure may reject`).toEqual(
        new Error("Seeded backward page failure"),
      );
      snapshot = progress;
      continue;
    }
    snapshot = result.value;
    for (const state of snapshot.replayBackfill?.values() ?? []) {
      if (state.kind === "loaded" || state.kind === "retained") continue;
      mix.unfinishedPasses.add(state.kind);
      if (stream.tasks.length > 1) mix.unfinishedPasses.add("multiTask");
    }
    incremental.project({ ...snapshot, runnerId: "runner" });
    while (
      deselections < deselectionPasses.length &&
      (passes >= deselectionPasses[deselections]! || caughtUp(snapshot, stream))
    )
      await reselect();
    if (suspensionRemaining > 0) {
      expect(snapshot.replayBackfill, `${context}; suspended cursors must be preserved`).toEqual(
        suspensionState?.replayBackfill,
      );
      expect(snapshot.replays, `${context}; suspension must preserve retained events`).toEqual(
        suspensionState?.replays,
      );
      expect(h.backward().length, `${context}; suspension must not read backward pages`).toBe(
        suspensionReads,
      );
      suspensionRemaining -= 1;
      if (suspensionRemaining === 0) h.calls.getRunner.mockResolvedValue(descriptor);
      continue;
    }
    if (
      !suspensionUsed &&
      stream.suspension &&
      [...(snapshot.replayBackfill?.values() ?? [])].some(
        (state) => state.kind === stream.suspension?.phase,
      )
    ) {
      suspensionUsed = true;
      suspensionRemaining = stream.suspension.passes;
      suspensionState = snapshot;
      suspensionReads = h.backward().length;
      h.calls.getRunner.mockResolvedValue({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, eventBackwardPaging: false },
      });
    }
  } while (passes < MAX_PASSES && (!caughtUp(snapshot, stream) || suspensionRemaining > 0));
  expect(passes, `${context}; backward pass bound`).toBeLessThan(MAX_PASSES);
  expect(caughtUp(snapshot, stream), `${context}; backward must settle`).toBe(true);
  if (stream.suspension) {
    expect(suspensionUsed, `${context}; requested suspension phase must occur`).toBe(true);
    mix.suspensions[stream.suspension.phase] += 1;
  }
  if (failureUsed) mix.failures += 1;
  expect(deselections, `${context}; all seeded reselections occurred`).toBe(
    deselectionPasses.length,
  );
  mix.deselections.set(deselections, (mix.deselections.get(deselections) ?? 0) + 1);
  const incrementalTurns = incremental.project({ ...snapshot, runnerId: "runner" })[0]?.thread
    .turns;
  expect(incrementalTurns, `${context}; incremental must equal fresh final projection`).toEqual(
    projectedTurns(snapshot),
  );
  return snapshot;
}

it.each(CASES)("matches legacy replay for seed %i case %i", async (seed, index) => {
  const stream = generateStream(seed, index, limits);
  const deselectionPasses = seededDeselectionPasses(seed, index);
  const context = `seed=${seed};case=${index};deselect@${deselectionPasses.join("/")};mode=${stream.mode};${stream.description}`;
  mix.cases += 1;
  mix.modes.set(stream.mode, (mix.modes.get(stream.mode) ?? 0) + 1);
  mix.count[stream.countClass] += 1;
  mix.bytes[stream.byteClass] += 1;
  if (stream.inputCount > 0) mix.withInputs += 1;
  if (stream.serverLoss) mix.serverLoss += 1;
  if (stream.tasks.length > 1) mix.multiTask += 1;
  const expected = await forwardEnd(stream, context);
  const actual = await backwardEnd(stream, context, deselectionPasses);
  for (const task of stream.tasks) {
    expect(
      actual.replays.get(task.id)?.map((event) => event.sequence),
      `${context}; ${task.id} sequences`,
    ).toEqual(expected.replays.get(task.id)?.map((event) => event.sequence));
    expect(actual.replays.get(task.id), `${context}; ${task.id} event content`).toEqual(
      expected.replays.get(task.id),
    );
  }
  expect(replayState(actual), `${context}; replay and retention metadata`).toEqual(
    replayState(expected),
  );
  expect(projectedTurns(actual), `${context}; fresh projection`).toEqual(projectedTurns(expected));
});
