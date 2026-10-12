import { expect, it } from "vitest";
import type { RemoteRunnerDescriptor } from "../domain/remoteRunner";
import {
  fakeRunnerGateway,
  loadTailFirst,
  loadUntilSettled,
  projectedTurn,
  projectedTurns,
  remoteTurn,
  replayState,
} from "./remoteAgentTailFirstTestSupport";
import { remoteReplayBackfillAdvanced, remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

type MissingCapability = "runner" | "gateway";
type PendingPhase = "pending" | "scanningInputs";

function descriptor(direction: "backward" | "forward"): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId: "runner",
    name: "Server",
    capabilities: {
      taskExecution: true,
      eventReplay: true,
      taskContinuation: true,
      ...(direction === "backward" ? { eventBackwardPaging: true } : {}),
    },
  };
}

function unfinishedTurn(phase: PendingPhase): FakeRunnerEvents {
  const runner = new FakeRunnerEvents(phase === "pending" ? 10 : 50);
  runner.lifecycle("turn-1", "task.created");
  runner.input("turn-1", "early-input", "earlier steer");
  const count = phase === "pending" ? 800 : 2_400;
  for (let index = 0; index < count; index += 1)
    runner.output("turn-1", claudeTextLine(`line ${index} `));
  runner.lifecycle("turn-1", "task.succeeded");
  return runner;
}

function suspend(h: ReturnType<typeof fakeRunnerGateway>, capability: MissingCapability): void {
  if (capability === "runner") {
    h.calls.getRunner.mockResolvedValue(descriptor("forward"));
    return;
  }
  Object.assign(h.gateway, { listEventsBefore: undefined });
}

function restore(h: ReturnType<typeof fakeRunnerGateway>, capability: MissingCapability): void {
  if (capability === "runner") {
    h.calls.getRunner.mockResolvedValue(descriptor("backward"));
    return;
  }
  Object.assign(h.gateway, { listEventsBefore: h.calls.listEventsBefore });
}

it.each([
  { phase: "pending", capability: "runner" },
  { phase: "pending", capability: "gateway" },
  { phase: "scanningInputs", capability: "runner" },
  { phase: "scanningInputs", capability: "gateway" },
] as const)(
  "suspends $phase without losing its cursor while the $capability backward capability is absent",
  async ({ phase, capability }) => {
    const runner = unfinishedTurn(phase);
    const original = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const h = { ...original, gateway: { ...original.gateway } };
    const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const first = await loadTailFirst(h.gateway);
    const stored = first.replayBackfill?.get("turn-1");
    const reads = h.backward().length;
    expect(stored?.kind).toBe(phase);
    expect(first.replayComplete.has("turn-1")).toBe(true);
    expect(first.replays.get("turn-1")?.some((event) => event.type === "task.input")).toBe(false);
    suspend(h, capability);

    let suspended = first;
    for (let pass = 0; pass < 2; pass += 1) {
      const publications: unknown[] = [];
      suspended = await loadTailFirst(h.gateway, suspended, (snapshot) =>
        publications.push(snapshot),
      );
      expect(suspended.replayBackfill).toEqual(first.replayBackfill);
      expect(replayState(suspended)).toEqual(replayState(first));
      expect(remoteReplayBackfillPending(suspended)).toBe(true);
      expect(remoteReplayBackfillAdvanced(first, suspended)).toBe(false);
      expect(projectedTurn(suspended, "turn-1")?.eventsRetention).toBe("clientWindow");
      expect(projectedTurn(suspended, "turn-1")?.eventsTruncated).toBe(true);
      expect(h.backward()).toHaveLength(reads);
      expect(h.forward()).toEqual([]);
      expect(publications).toEqual([]);
    }
    restore(h, capability);
    let resumed = await loadTailFirst(h.gateway, suspended);
    expect(h.backward()[reads]?.before).toBe(
      stored?.kind === "pending" || stored?.kind === "scanningInputs" ? stored.before : undefined,
    );
    for (let pass = 0; pass < 40 && remoteReplayBackfillPending(resumed); pass += 1)
      resumed = await loadTailFirst(h.gateway, resumed);
    const expected = await loadUntilSettled(forward.gateway, runner);
    const requests = h.backward().map((request) => `${request.taskId}:${request.before}`);

    expect(new Set(requests).size).toBe(requests.length);
    expect(remoteReplayBackfillPending(resumed)).toBe(false);
    expect(replayState(resumed)).toEqual(replayState(expected));
    expect(projectedTurns(resumed)).toEqual(projectedTurns(expected));
    expect(
      resumed.replays
        .get("turn-1")
        ?.filter((event) => event.type === "task.input")
        .map((event) => event.messageId),
    ).toEqual(["early-input"]);
  },
);
