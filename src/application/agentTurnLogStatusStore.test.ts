import { describe, expect, it, vi } from "vitest";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import { agentTurnContentLost, agentTurnWindowDisplay } from "../domain/agentTurnContentLoss";
import {
  AGENT_TURN_LOG_DEGRADED_NOTICE_MS,
  MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD,
  MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS,
  agentTurnLogEvidence,
  createAgentTurnLogFactsStore,
} from "./agentTurnLogStatusStore";
import type { AgentTurnLogSlotState, AgentTurnLogSlotStatus } from "./agentTurnLogPorts";

const THREAD_ID = "agt-1-0a1b";

function status(
  turnId: string,
  overrides: Partial<AgentTurnLogSlotStatus> = {},
): AgentTurnLogSlotStatus {
  return {
    turnId,
    threadId: THREAD_ID,
    state: { kind: "writing" },
    loss: { kind: "none" },
    pendingOps: 0,
    pendingBytes: 0,
    backpressure: false,
    persistedThroughSeq: 0,
    bounded: false,
    contextWindow: null,
    promptStored: false,
    ...overrides,
  };
}

function summary(
  turnId: string,
  overrides: Partial<AgentTurnLogSummary> = {},
): AgentTurnLogSummary {
  return {
    turnId,
    eventCount: 10,
    bytes: 100,
    loss: { kind: "none" },
    sealed: true,
    digest: null,
    prompt: null,
    promptOmitted: false,
    ...overrides,
  };
}

function retrying(attempts: number): AgentTurnLogSlotState {
  return { kind: "retrying", error: "diskFull", attempts, nextAttemptAtMs: 0 };
}

describe("agent turn log facts store", () => {
  it("keeps the latest facts per turn and notifies only on a visible change", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.publishSlot(THREAD_ID, status("turn-1"));
    expect(listener).toHaveBeenCalledTimes(1);
    const first = store.factsOf("turn-1");

    store.publishSlot(THREAD_ID, status("turn-1", { pendingOps: 12, persistedThroughSeq: 99 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.factsOf("turn-1")).toBe(first);

    store.publishSlot(
      THREAD_ID,
      status("turn-1", { contextWindow: { usedTokens: 1, contextWindow: 2 } }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.factsOf("turn-1")?.contextWindow).toEqual({ usedTokens: 1, contextWindow: 2 });
  });

  it("marks a turn as logged with its loss from a load summary", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const summaries: ReadonlyArray<AgentTurnLogSummary> = [
      {
        turnId: "turn-1",
        eventCount: 10,
        bytes: 100,
        loss: { kind: "legacyWindow" },
        sealed: true,
        prompt: null,
        promptOmitted: false,
        digest: {
          version: 1,
          context: {
            provider: "claudeCode",
            capacities: [],
            primary: null,
            current: { usedTokens: 7, contextWindow: 9 },
            bounded: false,
          },
        },
      },
    ];
    store.publishSummaries(THREAD_ID, summaries);
    expect(store.factsOf("turn-1")).toEqual({
      turnId: "turn-1",
      logged: true,
      loss: { kind: "legacyWindow" },
      sealed: true,
      live: false,
      hydration: "notAttempted",
      contextWindow: { usedTokens: 7, contextWindow: 9 },
      health: { kind: "ok" },
      promptInLog: false,
    });
  });

  it("stays healthy while a retry is younger than the quiet-notice delay", () => {
    let clock = 0;
    const store = createAgentTurnLogFactsStore(() => clock);
    store.publishSlot(THREAD_ID, status("turn-1", { state: retrying(1) }));
    expect(store.factsOf("turn-1")?.health).toEqual({ kind: "ok" });

    clock = AGENT_TURN_LOG_DEGRADED_NOTICE_MS - 1;
    store.publishSlot(THREAD_ID, status("turn-1", { state: retrying(2) }));
    expect(store.factsOf("turn-1")?.health).toEqual({ kind: "ok" });

    clock = AGENT_TURN_LOG_DEGRADED_NOTICE_MS;
    store.publishSlot(THREAD_ID, status("turn-1", { state: retrying(3) }));
    expect(store.factsOf("turn-1")?.health).toEqual({
      kind: "degraded",
      reason: "the disk is full",
    });

    clock += 1;
    store.publishSlot(THREAD_ID, status("turn-1"));
    expect(store.factsOf("turn-1")?.health).toEqual({ kind: "ok" });
  });

  it("reports a stopped writer at once but stays quiet for a sealed turn", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(
      THREAD_ID,
      status("turn-1", { state: { kind: "stopped", reason: "turnCeiling" } }),
    );
    expect(store.factsOf("turn-1")?.health).toEqual({
      kind: "degraded",
      reason: "this turn reached its recording limit",
    });
    store.publishSlot(
      THREAD_ID,
      status("turn-2", { state: { kind: "stopped", reason: "sealed" } }),
    );
    expect(store.factsOf("turn-2")?.health).toEqual({ kind: "ok" });
  });

  it("evicts the oldest turn of a thread deterministically and forgets a turn on request", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    for (let index = 0; index <= MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD; index += 1) {
      store.publishSlot(THREAD_ID, status(`turn-${index}`));
    }
    expect(store.factsOf("turn-0")).toBeNull();
    expect(store.factsOf(`turn-${MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD}`)).not.toBeNull();
    expect(store.threadIdOf("turn-0")).toBeNull();
    expect(store.threadIdOf("turn-5")).toBe(THREAD_ID);

    store.forgetTurn("turn-5");
    expect(store.factsOf("turn-5")).toBeNull();
  });

  it("evicts the least recently published thread and never the visible one", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [summary("turn-visible")]);
    store.setVisibleThread(THREAD_ID);
    for (let index = 0; index <= MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS; index += 1) {
      store.publishSummaries(`agt-other-${index}`, [summary(`turn-other-${index}`)]);
    }

    expect(store.factsOf("turn-visible")).not.toBeNull();
    expect(store.hasThreadFacts(THREAD_ID)).toBe(true);
    expect(store.factsOf("turn-other-0")).toBeNull();
    expect(store.hasThreadFacts("agt-other-0")).toBe(false);
    expect(store.factsOf(`turn-other-${MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS}`)).not.toBeNull();
  });

  it("bumps the evidence revision only when the evidence of that thread changed", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [summary("turn-1")]);
    const revision = store.evidenceRevisionOf(THREAD_ID);
    expect(revision).toBeGreaterThan(0);
    expect(store.evidenceRevisionOf("agt-unknown")).toBe(0);

    store.publishSummaries(THREAD_ID, [summary("turn-1")]);
    expect(store.evidenceRevisionOf(THREAD_ID)).toBe(revision);

    store.publishSummaries("agt-other", [summary("turn-other")]);
    expect(store.evidenceRevisionOf(THREAD_ID)).toBe(revision);

    store.publishHydration("turn-1", "complete");
    expect(store.evidenceRevisionOf(THREAD_ID)).toBeGreaterThan(revision);
  });

  it("forwards every facts request and visible-thread pin to the injected request port", async () => {
    const requested: Array<{ threadId: string; turnIds: ReadonlyArray<string> }> = [];
    const rearmed: string[] = [];
    const store = createAgentTurnLogFactsStore(() => 0, {
      ensure: (threadId, turnIds) => {
        requested.push({ threadId, turnIds });
        return Promise.resolve();
      },
      rearm: (threadId) => rearmed.push(threadId),
    });

    await store.ensureThreadFacts(THREAD_ID, ["turn-1"]);
    store.setVisibleThread(THREAD_ID);
    store.setVisibleThread(null);

    expect(requested).toEqual([{ threadId: THREAD_ID, turnIds: ["turn-1"] }]);
    expect(rearmed).toEqual([THREAD_ID]);
  });

  it("stops notifying an unsubscribed listener and clears every turn", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.publishSlot(THREAD_ID, status("turn-1"));
    unsubscribe();
    store.publishSlot(THREAD_ID, status("turn-2"));
    expect(listener).toHaveBeenCalledTimes(1);

    store.clear();
    expect(store.factsOf("turn-1")).toBeNull();
    expect(store.factsOf("turn-2")).toBeNull();
  });

  it("presents an unsealed summary of a turn that is not live here as not provably complete", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [summary("turn-1", { sealed: false })]);
    const evidence = agentTurnLogEvidence(store.factsOf("turn-1"));
    expect(evidence).toEqual({
      loss: { kind: "none" },
      sealed: false,
      live: false,
      hydration: "notAttempted",
    });
    expect(agentTurnContentLost(true, evidence)).toBe(true);
    expect(agentTurnWindowDisplay(true, evidence)).toBe("lost");
  });

  it("treats a writer that stopped mid-turn as not live and not sealed", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(
      THREAD_ID,
      status("turn-1", { state: { kind: "stopped", reason: "sequenceGap" } }),
    );
    const evidence = agentTurnLogEvidence(store.factsOf("turn-1"));
    expect(evidence?.sealed).toBe(false);
    expect(evidence?.live).toBe(false);
    expect(agentTurnContentLost(true, evidence)).toBe(true);
  });

  it("keeps the live writer slot as the authority over a stale load summary", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, status("turn-1"));
    store.publishSummaries(THREAD_ID, [
      summary("turn-1", { sealed: false, loss: { kind: "unreadable" } }),
    ]);
    const evidence = agentTurnLogEvidence(store.factsOf("turn-1"));
    expect(evidence).toEqual({
      loss: { kind: "none" },
      sealed: false,
      live: true,
      hydration: "notAttempted",
    });
    expect(agentTurnContentLost(true, evidence)).toBe(false);
  });

  it("falls back to the JSON truth for a current turn the summary list misses", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.publishSummaries(THREAD_ID, [summary("turn-older")]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.factsOf("turn-current")).toBeNull();
    expect(agentTurnLogEvidence(store.factsOf("turn-current"))).toBeNull();
    expect(agentTurnContentLost(true, agentTurnLogEvidence(store.factsOf("turn-current")))).toBe(
      true,
    );
    expect(agentTurnContentLost(false, agentTurnLogEvidence(store.factsOf("turn-current")))).toBe(
      false,
    );

    store.publishSummaries(THREAD_ID, []);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes hydration progress once per change and only for a known turn", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    store.publishSummaries(THREAD_ID, [summary("turn-1")]);
    store.subscribe(listener);

    store.publishHydration("turn-unknown", "running");
    expect(listener).not.toHaveBeenCalled();
    expect(store.factsOf("turn-unknown")).toBeNull();

    store.publishHydration("turn-1", "running");
    store.publishHydration("turn-1", "running");
    expect(listener).toHaveBeenCalledTimes(1);

    store.publishHydration("turn-1", "complete");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(agentTurnWindowDisplay(true, agentTurnLogEvidence(store.factsOf("turn-1")))).toBe(
      "complete",
    );
  });

  it("keeps the hydration outcome when the writer or a later summary republishes the turn", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [summary("turn-1")]);
    store.publishHydration("turn-1", "partial");
    store.publishSummaries(THREAD_ID, [summary("turn-1", { eventCount: 11 })]);
    expect(store.factsOf("turn-1")?.hydration).toBe("partial");
  });
});

describe("agent turn log prompt evidence", () => {
  const OTHER_THREAD_ID = "agt-2-0b1b";

  it("derives promptInLog from a slot status that stored the prompt", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, status("turn-1"));
    expect(store.factsOf("turn-1")?.promptInLog).toBe(false);

    store.publishSlot(THREAD_ID, status("turn-1", { promptStored: true }));
    expect(store.factsOf("turn-1")?.promptInLog).toBe(true);
  });

  it("derives promptInLog from a summary that carries or omits the prompt", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [
      summary("turn-1", { prompt: "the whole prompt" }),
      summary("turn-2", { prompt: null, promptOmitted: true }),
      summary("turn-3"),
    ]);

    expect(store.factsOf("turn-1")?.promptInLog).toBe(true);
    expect(store.factsOf("turn-2")?.promptInLog).toBe(true);
    expect(store.factsOf("turn-3")?.promptInLog).toBe(false);
  });

  it("notifies the thread when only the prompt evidence changed", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    store.publishSummaries(THREAD_ID, [summary("turn-1")]);
    const before = store.evidenceRevisionOf(THREAD_ID);
    store.subscribe(listener);

    store.publishSummaries(THREAD_ID, [summary("turn-1", { prompt: "the whole prompt" })]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.evidenceRevisionOf(THREAD_ID)).not.toBe(before);
    expect(store.factsOf("turn-1")?.promptInLog).toBe(true);
  });

  it("reports exactly the turns of one thread whose log holds the prompt", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [
      summary("turn-1", { prompt: "kept" }),
      summary("turn-2"),
      summary("turn-3", { promptOmitted: true }),
    ]);
    store.publishSummaries(OTHER_THREAD_ID, [summary("turn-9", { prompt: "other" })]);

    expect([...store.promptLoggedTurnIds(THREAD_ID)]).toEqual(["turn-1", "turn-3"]);
    expect([...store.promptLoggedTurnIds(OTHER_THREAD_ID)]).toEqual(["turn-9"]);
    expect([...store.promptLoggedTurnIds("agt-3-0c1c")]).toEqual([]);
  });

  it("keeps the reported prompt turns inside the retained facts cap", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const total = MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD + 8;
    for (let index = 0; index < total; index += 1) {
      store.publishSummaries(THREAD_ID, [summary(`turn-${index}`, { prompt: "kept" })]);
    }

    expect(store.promptLoggedTurnIds(THREAD_ID).size).toBe(
      MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD,
    );
  });
});
