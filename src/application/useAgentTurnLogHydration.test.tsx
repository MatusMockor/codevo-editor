// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  type AgentThread,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { agentTurnContentLost, agentTurnWindowDisplay } from "../domain/agentTurnContentLoss";
import {
  LOG_THREAD_ID,
  LOG_TURN_ID,
  logProject,
  logThread,
  logToolEvent,
  logToolEvents,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import { agentTurnLogEvidence } from "./agentTurnLogStatusStore";
import { MIN_AGENT_THREAD_PERSIST_INTERVAL_MS } from "./useAgentThreadStore";
import {
  MAX_CARRIED_AGENT_TURN_STEERS,
  carriedAgentTurnSteers,
} from "../domain/agentTurnHydrationCarry";
import {
  MAX_AGENT_TURN_HYDRATION_PAGES,
  MAX_HYDRATED_AGENT_THREADS,
  MAX_HYDRATED_AGENT_TURNS_PER_THREAD,
} from "./useAgentTurnLogHydration";

const PERSISTED_TAIL_EVENTS = 256;
const OTHER_THREAD_ID = "agt-2-0b1b";
const OTHER_TURN_ID = "agt-2-0b1c";

function settledThread(
  events: ReadonlyArray<AgentTurnEvent>,
  overrides: Partial<AgentThread> = {},
  turnId: string = LOG_TURN_ID,
): AgentThread {
  return logThread({
    turns: [
      logTurn({ turnId, events: events.slice(-PERSISTED_TAIL_EVENTS), eventsTruncated: true }),
    ],
    ...overrides,
  });
}

async function restartedWith(eventCount: number) {
  const events = logToolEvents(eventCount);
  const harness = renderLogStore({
    persisted: [settledThread(events)],
    summaries: [sealedLogSummary(LOG_TURN_ID, eventCount)],
  });
  harness.logGateway.seed(LOG_TURN_ID, events);
  await settleLogStore();
  return { harness, events };
}

function display(harness: ReturnType<typeof renderLogStore>, turnId: string = LOG_TURN_ID) {
  const turn = harness.turnOf(LOG_THREAD_ID, turnId);
  const evidence = agentTurnLogEvidence(harness.turnLog.facts.factsOf(turnId));
  return {
    hydration: evidence?.hydration ?? null,
    lost: agentTurnContentLost(turn?.eventsTruncated ?? false, evidence),
    window: agentTurnWindowDisplay(turn?.eventsTruncated ?? false, evidence),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent turn log hydration after a restart", () => {
  it("shows every event of a settled turn longer than the persisted 256 event tail", async () => {
    const { harness, events } = await restartedWith(400);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toHaveLength(PERSISTED_TAIL_EVENTS);
    expect(display(harness).window).toBe("lost");

    act(() => harness.turnLog.facts.ensureThreadFacts(LOG_THREAD_ID));
    await settleLogStore();
    expect(display(harness).window).toBe("savedNotShown");

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(turn?.events).toEqual(events);
    expect(turn?.eventsTruncated).toBe(false);
    expect(display(harness)).toEqual({ hydration: "complete", lost: false, window: "complete" });
    await harness.unmount();
  });

  it("shows every event of a settled turn longer than the persisted 512 event limit", async () => {
    const { harness, events } = await restartedWith(900);
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(turn?.events).toEqual(events);
    expect(turn?.eventsTruncated).toBe(false);
    expect(display(harness).window).toBe("complete");
    await harness.unmount();
  });

  it("fills exactly the in-memory window of a 5000 event turn and stays truthfully partial", async () => {
    const { harness, events } = await restartedWith(5_000);
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(turn?.events).toEqual(events.slice(-MAX_AGENT_EVENTS_PER_TURN));
    expect(turn?.eventsTruncated).toBe(true);
    expect(display(harness)).toEqual({
      hydration: "partial",
      lost: false,
      window: "savedNotShown",
    });
    expect(harness.logGateway.reads.length).toBeLessThanOrEqual(MAX_AGENT_TURN_HYDRATION_PAGES);
    expect(harness.logGateway.reads.map((read) => read.anchor.at)).toEqual([
      "tail",
      "before",
      "before",
      "before",
      "before",
      "before",
    ]);
    await harness.unmount();
  });

  it("never saves the thread JSON and never re-sends hydrated events to the writer", async () => {
    vi.useFakeTimers();
    const { harness } = await restartedWith(900);
    const savesBefore = harness.saved.length;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toHaveLength(900);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_AGENT_THREAD_PERSIST_INTERVAL_MS * 3);
    });
    harness.clock.advance(60_000);
    await settleLogStore();

    expect(harness.saved).toHaveLength(savesBefore);
    expect(harness.logGateway.opens).toEqual([]);
    expect(harness.logGateway.appends).toEqual([]);
    expect(harness.turnLog.writer.status(LOG_TURN_ID)).toBeNull();
    await harness.unmount();
  });

  it("re-renders the store once when hydration completes and never on a log status tick", async () => {
    const { harness } = await restartedWith(900);
    const rendersBefore = harness.renders();
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("running");
    act(() =>
      harness.turnLog.facts.publishSummaries("agt-9-0f0e", [sealedLogSummary("agt-9-0f0f", 3)]),
    );
    expect(harness.renders()).toBe(rendersBefore);

    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("complete");
    expect(harness.renders()).toBe(rendersBefore + 1);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.renders()).toBe(rendersBefore + 1);
    expect(harness.logGateway.reads).toHaveLength(5);
    await harness.unmount();
  });
});

describe("agent turn log hydration keeps pinned steers", () => {
  const steer = (index: number): AgentTurnEvent => ({
    kind: "userMessage",
    text: `steer ${index}`,
  });

  function steeredStream(): ReadonlyArray<AgentTurnEvent> {
    const events: AgentTurnEvent[] = [];
    const early = [100, 300, 500, 700, 900, 1_100, 1_300, 1_500, 1_700, 1_900, 1_950];
    const late = [2_500, 2_800, 2_950];
    const steerAt = new Map([...early, ...late].map((position, index) => [position, index]));
    for (let position = 0; position < 3_000; position += 1) {
      const index = steerAt.get(position);
      events.push(index === undefined ? logToolEvent(position) : steer(index));
    }
    return events;
  }

  function jsonTail(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
    const newest = events.length - PERSISTED_TAIL_EVENTS;
    return events.filter((event, index) => event.kind === "userMessage" || index >= newest);
  }

  it("keeps every steer of the JSON tail exactly once when the log window starts after them", async () => {
    const events = steeredStream();
    const harness = renderLogStore({
      persisted: [
        logThread({ turns: [logTurn({ events: jsonTail(events), eventsTruncated: true })] }),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, events.length)],
    });
    harness.logGateway.seed(LOG_TURN_ID, events);
    await settleLogStore();
    const steersOf = () =>
      (harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events ?? [])
        .filter((event) => event.kind === "userMessage")
        .map((event) => (event.kind === "userMessage" ? event.text : ""));
    const allSteers = Array.from({ length: 14 }, (_unused, index) => `steer ${index}`);
    expect(steersOf()).toEqual(allSteers);

    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(steersOf()).toEqual(allSteers);
    expect(turn?.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(turn?.events.length).toBeGreaterThan(PERSISTED_TAIL_EVENTS * 3);
    const newest = events.slice(-(MAX_AGENT_EVENTS_PER_TURN - 14));
    expect(turn?.events.slice(-newest.length)).toEqual(newest);
    expect(turn?.eventsTruncated).toBe(true);
    expect(display(harness).hydration).toBe("partial");
    await harness.unmount();
  });

  it("never repeats a steer that the hydrated range already holds, even with equal texts", async () => {
    const again: AgentTurnEvent = { kind: "userMessage", text: "continue" };
    const events: AgentTurnEvent[] = [
      logToolEvent(0),
      again,
      ...logToolEvents(1_500),
      again,
      ...logToolEvents(200),
      { kind: "userMessage", remoteMessageId: "remote-7", text: "with id" },
      ...logToolEvents(100),
    ];
    const harness = renderLogStore({
      persisted: [
        logThread({ turns: [logTurn({ events: jsonTail(events), eventsTruncated: true })] }),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, events.length)],
    });
    harness.logGateway.seed(LOG_TURN_ID, events);
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const steers = (harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events ?? []).filter(
      (event) => event.kind === "userMessage",
    );
    expect(steers).toEqual([again, again, events[1_703]]);
    await harness.unmount();
  });

  it("carries nothing over when the log window already reaches the start of the turn", async () => {
    const events: AgentTurnEvent[] = [steer(0), ...logToolEvents(600), steer(1)];
    const harness = renderLogStore({
      persisted: [
        logThread({ turns: [logTurn({ events: jsonTail(events), eventsTruncated: true })] }),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, events.length)],
    });
    harness.logGateway.seed(LOG_TURN_ID, events);
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toEqual(events);
    expect(display(harness).hydration).toBe("complete");
    await harness.unmount();
  });
});

describe("carriedAgentTurnSteers", () => {
  const steer = (text: string, remoteMessageId?: string): AgentTurnEvent =>
    remoteMessageId === undefined
      ? { kind: "userMessage", text }
      : { kind: "userMessage", text, remoteMessageId };

  it("never carries a steer the hydrated range holds when the two lists do not align", () => {
    const current = [steer("a"), steer("b"), steer("c")];
    const hydrated = [steer("b"), logToolEvent(1), steer("z")];
    expect(carriedAgentTurnSteers(current, hydrated)).toEqual([steer("a"), steer("c")]);
  });

  it("matches a steer saved without its message id against the logged one that has it", () => {
    const current = [steer("first"), steer("second")];
    const hydrated = [steer("second", "remote-2")];
    expect(carriedAgentTurnSteers(current, hydrated)).toEqual([steer("first")]);
  });

  it("carries at most a bounded number of the newest earlier steers", () => {
    const current = Array.from({ length: MAX_CARRIED_AGENT_TURN_STEERS + 6 }, (_unused, index) =>
      steer(`steer ${index}`),
    );
    const carried = carriedAgentTurnSteers(current, [logToolEvent(1)]);
    expect(carried).toEqual(current.slice(-MAX_CARRIED_AGENT_TURN_STEERS));
  });
});

describe("agent turn logs of turns a quit interrupted", () => {
  function loadedWithRunningTurn(eventCount: number, tailLength: number) {
    const events = logToolEvents(eventCount);
    const harness = renderLogStore({
      persisted: [
        logThread({
          turns: [
            logTurn({
              status: { kind: "running" },
              endedAtEpochMs: null,
              events: events.slice(-tailLength),
              eventsTruncated: tailLength < eventCount,
            }),
          ],
        }),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, eventCount, { sealed: false })],
    });
    harness.logGateway.seed(LOG_TURN_ID, events);
    return { harness, events };
  }

  it("seals a complete JSON tail without claiming a loss", async () => {
    const { harness } = loadedWithRunningTurn(5, 5);
    await settleLogStore();

    const sealed = harness.logGateway.appends.filter((append) => append.seal);
    expect(sealed).toHaveLength(1);
    expect(sealed[0]?.scope.turnId).toBe(LOG_TURN_ID);
    expect(sealed[0]?.loss).toEqual({ kind: "none" });
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.sealed).toBe(true);
    expect(display(harness)).toEqual({
      hydration: "notAttempted",
      lost: false,
      window: "complete",
    });
    await harness.unmount();
  });

  it("seals a truncated JSON tail as a supervisor gap and then lets hydration rebuild it", async () => {
    const { harness, events } = loadedWithRunningTurn(400, PERSISTED_TAIL_EVENTS);
    await settleLogStore();

    const sealed = harness.logGateway.appends.filter((append) => append.seal);
    expect(sealed).toHaveLength(1);
    expect(sealed[0]?.loss).toEqual({ kind: "supervisorGap" });

    act(() =>
      harness.turnLog.facts.publishSummaries(LOG_THREAD_ID, [sealedLogSummary(LOG_TURN_ID, 400)]),
    );
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toEqual(events);
    await harness.unmount();
  });

  it("never seals a log a summary already reports as sealed", async () => {
    const events = logToolEvents(5);
    const harness = renderLogStore({
      persisted: [
        logThread({
          turns: [logTurn({ status: { kind: "running" }, endedAtEpochMs: null, events })],
        }),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, 5)],
    });
    harness.logGateway.seed(LOG_TURN_ID, events);
    await settleLogStore();

    expect(harness.logGateway.opens).toEqual([]);
    expect(harness.logGateway.appends).toEqual([]);
    await harness.unmount();
  });
});

describe("agent turn log hydration releases what it rebuilt", () => {
  const HYDRATED_EVENTS = 300;

  function threadWithTurns(threadId: string, turnIds: ReadonlyArray<string>): AgentThread {
    const events = logToolEvents(HYDRATED_EVENTS);
    return logThread({
      threadId,
      turns: turnIds.map((turnId) =>
        logTurn({ turnId, events: events.slice(-PERSISTED_TAIL_EVENTS), eventsTruncated: true }),
      ),
    });
  }

  function renderThreads(threadIds: ReadonlyArray<string>, turnsPerThread: number) {
    const events = logToolEvents(HYDRATED_EVENTS);
    const turnIdsOf = (threadId: string): ReadonlyArray<string> =>
      Array.from({ length: turnsPerThread }, (_unused, index) => `${threadId}-t${index}`);
    const persisted = threadIds.map((threadId) => threadWithTurns(threadId, turnIdsOf(threadId)));
    const allTurnIds = threadIds.flatMap((threadId) => [...turnIdsOf(threadId)]);
    const harness = renderLogStore({
      persisted,
      summaries: allTurnIds.map((turnId) => sealedLogSummary(turnId, HYDRATED_EVENTS)),
    });
    for (const turnId of allTurnIds) harness.logGateway.seed(turnId, events);
    const hydratedTurnsOf = (threadId: string): ReadonlyArray<string> =>
      turnIdsOf(threadId).filter(
        (turnId) => (harness.turnOf(threadId, turnId)?.events.length ?? 0) > PERSISTED_TAIL_EVENTS,
      );
    const hydratedTotal = (): number =>
      threadIds.reduce((total, threadId) => total + hydratedTurnsOf(threadId).length, 0);
    return { harness, turnIdsOf, hydratedTurnsOf, hydratedTotal };
  }

  async function openThread(
    harness: ReturnType<typeof renderLogStore>,
    threadId: string,
  ): Promise<void> {
    act(() => harness.hook().hydrateThread?.(threadId));
    await settleLogStore();
    await settleLogStore();
  }

  it("restores the least recently opened thread to its persisted tail", async () => {
    const threadIds = ["agt-a-0001", "agt-b-0001", "agt-c-0001", "agt-d-0001"];
    const { harness, turnIdsOf, hydratedTurnsOf, hydratedTotal } = renderThreads(threadIds, 2);
    await settleLogStore();
    const savesBefore = harness.saved.length;

    for (const threadId of threadIds.slice(0, 3)) await openThread(harness, threadId);
    expect(hydratedTotal()).toBe(6);

    await openThread(harness, threadIds[3]!);

    const released = threadIds[0]!;
    expect(hydratedTurnsOf(released)).toEqual([]);
    for (const turnId of turnIdsOf(released)) {
      const turn = harness.turnOf(released, turnId);
      expect(turn?.events).toHaveLength(PERSISTED_TAIL_EVENTS);
      expect(turn?.eventsTruncated).toBe(true);
      expect(harness.turnLog.facts.factsOf(turnId)?.hydration).toBe("notAttempted");
    }
    expect(hydratedTotal()).toBe(6);
    expect(harness.saved).toHaveLength(savesBefore);

    await openThread(harness, released);
    expect(hydratedTurnsOf(released)).toEqual(turnIdsOf(released));
    await harness.unmount();
  });

  it("keeps at most a bounded number of hydrated turns per thread across re-opens", async () => {
    const threadId = "agt-a-0001";
    const turnCount = MAX_HYDRATED_AGENT_TURNS_PER_THREAD * 2 + 2;
    const { harness, turnIdsOf, hydratedTurnsOf } = renderThreads([threadId], turnCount);
    await settleLogStore();

    await openThread(harness, threadId);
    const turnIds = turnIdsOf(threadId);
    const newest = turnIds.slice(-MAX_HYDRATED_AGENT_TURNS_PER_THREAD);
    expect(hydratedTurnsOf(threadId)).toEqual(newest);

    await openThread(harness, threadId);
    await openThread(harness, threadId);

    const hydrated = hydratedTurnsOf(threadId);
    expect(hydrated).toHaveLength(MAX_HYDRATED_AGENT_TURNS_PER_THREAD);
    expect(hydrated).toEqual(newest);
    await harness.unmount();
  });

  it("holds at most three threads of hydrated turns at once", async () => {
    const threadIds = Array.from({ length: 6 }, (_unused, index) => `agt-${index}-0001`);
    const { harness, hydratedTotal } = renderThreads(
      threadIds,
      MAX_HYDRATED_AGENT_TURNS_PER_THREAD,
    );
    await settleLogStore();

    for (const threadId of threadIds) await openThread(harness, threadId);

    expect(hydratedTotal()).toBeLessThanOrEqual(
      MAX_HYDRATED_AGENT_THREADS * MAX_HYDRATED_AGENT_TURNS_PER_THREAD,
    );
    await harness.unmount();
  });

  it("never releases a turn the store replaced while it was hydrated", async () => {
    const threadIds = ["agt-a-0001", "agt-b-0001", "agt-c-0001", "agt-d-0001"];
    const { harness, turnIdsOf } = renderThreads(threadIds, 1);
    await settleLogStore();
    const released = threadIds[0]!;
    const turnId = turnIdsOf(released)[0]!;

    for (const threadId of threadIds.slice(0, 3)) await openThread(harness, threadId);
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnHydrated",
        threadId: released,
        turnId,
        events: [logToolEvent(77)],
        hasEarlier: true,
      }),
    );

    await openThread(harness, threadIds[3]!);

    expect(harness.turnOf(released, turnId)?.events).toEqual([logToolEvent(77)]);
    await harness.unmount();
  });
});

describe("agent turn log hydration authority", () => {
  it("drops a late page after another thread was opened", async () => {
    const first = logToolEvents(400);
    const second = Array.from({ length: 300 }, (_unused, index) => logToolEvent(10_000 + index));
    const harness = renderLogStore({
      persisted: [
        settledThread(first),
        settledThread(second, { threadId: OTHER_THREAD_ID }, OTHER_TURN_ID),
      ],
      summaries: [sealedLogSummary(LOG_TURN_ID, 400), sealedLogSummary(OTHER_TURN_ID, 300)],
    });
    harness.logGateway.seed(LOG_TURN_ID, first);
    harness.logGateway.seed(OTHER_TURN_ID, second);
    await settleLogStore();

    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(OTHER_THREAD_ID));
    await settleLogStore();
    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toHaveLength(PERSISTED_TAIL_EVENTS);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.eventsTruncated).toBe(true);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("notAttempted");
    expect(harness.turnOf(OTHER_THREAD_ID, OTHER_TURN_ID)?.events).toEqual(second);
    expect(harness.turnLog.facts.factsOf(OTHER_TURN_ID)?.hydration).toBe("complete");
    await harness.unmount();
  });

  it("drops a late page after the workspace went A, B and back to A", async () => {
    const { harness } = await restartedWith(400);
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    harness.setProjects([]);
    await settleLogStore();
    harness.setProjects([logProject({ generation: 2 })]);
    await settleLogStore();
    const reloaded = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(reloaded?.events).toHaveLength(PERSISTED_TAIL_EVENTS);

    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)).toBe(reloaded);
    expect(harness.logGateway.reads).toHaveLength(1);
    expect(harness.turnLog.facts.factsOf(LOG_TURN_ID)?.hydration).toBe("notAttempted");
    await harness.unmount();
  });

  it("drops a duplicate result when the turn window was replaced while a page was in flight", async () => {
    const { harness } = await restartedWith(400);
    harness.logGateway.holdReads = true;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnHydrated",
        threadId: LOG_THREAD_ID,
        turnId: LOG_TURN_ID,
        events: [logToolEvent(77)],
        hasEarlier: true,
      }),
    );
    harness.logGateway.holdReads = false;
    harness.logGateway.releaseReads();
    await settleLogStore();

    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toEqual([logToolEvent(77)]);
    await harness.unmount();
  });

  it("keeps the JSON tail and reports the failure when a page cannot be read", async () => {
    const { harness, events } = await restartedWith(400);
    harness.logGateway.readFails = true;
    const rendersBefore = harness.renders();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    const turn = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    expect(turn?.events).toEqual(events.slice(-PERSISTED_TAIL_EVENTS));
    expect(turn?.eventsTruncated).toBe(true);
    expect(display(harness)).toEqual({ hydration: "failed", lost: false, window: "savedNotShown" });
    expect(harness.renders()).toBe(rendersBefore);

    harness.logGateway.readFails = false;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toEqual(events);
    expect(display(harness).hydration).toBe("complete");
    await harness.unmount();
  });

  it("never reads the log of an unsealed turn, whose JSON tail may be newer than the log", async () => {
    const events = logToolEvents(400);
    const harness = renderLogStore({
      persisted: [settledThread(events)],
      summaries: [sealedLogSummary(LOG_TURN_ID, 120, { sealed: false })],
    });
    harness.logGateway.seed(LOG_TURN_ID, events.slice(0, 120));
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.reads).toEqual([]);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toHaveLength(PERSISTED_TAIL_EVENTS);
    expect(display(harness)).toEqual({ hydration: "notAttempted", lost: true, window: "lost" });
    await harness.unmount();
  });

  it("never touches the running turn of the opened thread", async () => {
    const harness = renderLogStore();
    await settleLogStore();
    act(() => {
      harness.hook().dispatchAction({ kind: "threadCreated", thread: logThread() });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: LOG_THREAD_ID,
        turn: logTurn({
          status: { kind: "running" },
          endedAtEpochMs: null,
          events: [logToolEvent(1)],
          eventsTruncated: true,
        }),
      });
    });
    await settleLogStore();
    const running = harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID);
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.reads).toEqual([]);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)).toBe(running);
    await harness.unmount();
  });

  it("hydrates only a bounded number of the newest truncated turns of one thread", async () => {
    const turnIds = Array.from({ length: 10 }, (_unused, index) => `agt-3-0c${index}0`);
    const events = logToolEvents(300);
    const harness = renderLogStore({
      persisted: [
        logThread({
          turns: turnIds.map((turnId) =>
            logTurn({
              turnId,
              events: events.slice(-PERSISTED_TAIL_EVENTS),
              eventsTruncated: true,
            }),
          ),
        }),
      ],
      summaries: turnIds.map((turnId) => sealedLogSummary(turnId, 300)),
    });
    for (const turnId of turnIds) harness.logGateway.seed(turnId, events);
    await settleLogStore();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();
    await settleLogStore();

    const hydrated = turnIds.filter(
      (turnId) => harness.turnOf(LOG_THREAD_ID, turnId)?.events.length === 300,
    );
    expect(hydrated).toEqual(turnIds.slice(-MAX_HYDRATED_AGENT_TURNS_PER_THREAD));
    expect(display(harness, turnIds[0]).window).toBe("savedNotShown");
    await harness.unmount();
  });

  it("asks for the summaries of the opened thread when its facts are not known yet", async () => {
    const { harness, events } = await restartedWith(400);
    act(() => harness.turnLog.facts.forgetTurn(LOG_TURN_ID));
    const summarizedBefore = harness.logGateway.summarized.length;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.logGateway.summarized).toHaveLength(summarizedBefore + 1);
    expect(harness.turnOf(LOG_THREAD_ID, LOG_TURN_ID)?.events).toEqual(events);
    await harness.unmount();
  });
});
