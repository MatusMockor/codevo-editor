import { describe, expect, it } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentTurnLogSummary, SummarizeAgentTurnLogsRequest } from "../domain/agentTurnLog";
import { manualLogTimers } from "../test/agentTurnLogStoreHarness";
import {
  AGENT_TURN_LOG_SUMMARY_REQUEST_TIMEOUT_MS,
  AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS,
  MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS,
  createAgentTurnLogSummaryRequester,
} from "./agentTurnLogSummaryRequests";
import { createAgentTurnLogFactsStore } from "./agentTurnLogStatusStore";
import type { AgentTurnLogSlotStatus } from "./agentTurnLogPorts";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);

function summary(turnId: string): AgentTurnLogSummary {
  return {
    turnId,
    eventCount: 10,
    bytes: 100,
    loss: { kind: "none" },
    sealed: true,
    digest: null,
  };
}

function liveStatus(threadId: string, turnId: string): AgentTurnLogSlotStatus {
  return {
    turnId,
    threadId,
    state: { kind: "writing" },
    loss: { kind: "none" },
    pendingOps: 0,
    pendingBytes: 0,
    backpressure: false,
    persistedThroughSeq: 0,
    bounded: false,
    contextWindow: null,
  };
}

function requesterHarness() {
  const clock = manualLogTimers();
  const facts = createAgentTurnLogFactsStore(() => clock.timers.now());
  const asked: SummarizeAgentTurnLogsRequest[] = [];
  const gates: Array<(summaries: ReadonlyArray<AgentTurnLogSummary>) => void> = [];
  const state = {
    generation: 1 as number | null,
    hold: false,
    fails: false,
    summaries: [] as ReadonlyArray<AgentTurnLogSummary>,
  };
  const requester = createAgentTurnLogSummaryRequester({
    facts,
    summarize: async (request) => {
      asked.push(request);
      if (state.hold) {
        return await new Promise<ReadonlyArray<AgentTurnLogSummary>>((resolve) =>
          gates.push(resolve),
        );
      }
      if (state.fails) throw new Error("busy");
      return state.summaries;
    },
    scopeOf: (threadId) => ({ rootKey: ROOT_KEY, ownerId: OWNER_ID, threadId }),
    generationOf: () => state.generation,
    active: () => true,
    timers: clock.timers,
  });
  return { asked, clock, facts, gates, requester, state };
}

async function drain(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("agent turn log summary requester", () => {
  it("fills a partially known thread whose older turns still lack facts", async () => {
    const harness = requesterHarness();
    harness.state.summaries = [summary("turn-old"), summary("turn-live")];
    harness.facts.publishSlot("agt-1", liveStatus("agt-1", "turn-live"));
    expect(harness.facts.hasThreadFacts("agt-1")).toBe(true);

    await harness.requester.ensure("agt-1", ["turn-old", "turn-live"]);
    await drain();

    expect(harness.asked).toHaveLength(1);
    expect(harness.facts.factsOf("turn-old")).not.toBeNull();
  });

  it("retries a refused thread with backoff and re-arms it when the thread is opened", async () => {
    const harness = requesterHarness();
    harness.state.fails = true;

    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();
    expect(harness.asked).toHaveLength(1);

    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();
    expect(harness.asked).toHaveLength(1);

    for (const delayMs of AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS) {
      harness.clock.advance(delayMs);
      await drain();
    }
    expect(harness.asked).toHaveLength(1 + AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS.length);

    harness.clock.advance(600_000);
    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();
    expect(harness.asked).toHaveLength(1 + AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS.length);

    harness.state.fails = false;
    harness.state.summaries = [summary("turn-1")];
    harness.requester.rearm("agt-1");
    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();

    expect(harness.asked).toHaveLength(2 + AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS.length);
    expect(harness.facts.factsOf("turn-1")).not.toBeNull();
  });

  it("re-arms a refused thread on a new generation of the same root", async () => {
    const harness = requesterHarness();
    harness.state.fails = true;
    for (let attempt = 0; attempt <= AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS.length; attempt += 1) {
      await harness.requester.ensure("agt-1", ["turn-1"]);
      await drain();
      harness.clock.advance(60_000);
      await drain();
    }
    const refused = harness.asked.length;

    harness.state.fails = false;
    harness.state.summaries = [summary("turn-1")];
    harness.state.generation = 2;
    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();

    expect(harness.asked.length).toBe(refused + 1);
    expect(harness.facts.factsOf("turn-1")).not.toBeNull();
  });

  it("releases a hung slot at the deadline so a queued thread is still served", async () => {
    const harness = requesterHarness();
    harness.state.hold = true;
    for (let index = 0; index < MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS; index += 1) {
      void harness.requester.ensure(`agt-hung-${index}`, [`turn-hung-${index}`]);
    }
    await drain();
    expect(harness.asked).toHaveLength(MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS);

    harness.state.hold = false;
    harness.state.summaries = [summary("turn-fifth")];
    void harness.requester.ensure("agt-fifth", ["turn-fifth"]);
    await drain();
    expect(harness.asked).toHaveLength(MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS);

    harness.clock.advance(AGENT_TURN_LOG_SUMMARY_REQUEST_TIMEOUT_MS);
    await drain();

    expect(harness.asked).toHaveLength(MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS + 1);
    expect(harness.facts.factsOf("turn-fifth")).not.toBeNull();
  });

  it("drops a summarize result that arrived after its deadline", async () => {
    const harness = requesterHarness();
    harness.state.hold = true;
    void harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();

    harness.clock.advance(AGENT_TURN_LOG_SUMMARY_REQUEST_TIMEOUT_MS);
    await drain();
    for (const gate of harness.gates.splice(0)) gate([summary("turn-1")]);
    await drain();

    expect(harness.facts.factsOf("turn-1")).toBeNull();
  });

  it("summarizes a legacy thread without log rows once per generation", async () => {
    const harness = requesterHarness();
    harness.state.summaries = [];

    for (let open = 0; open < 5; open += 1) {
      await harness.requester.ensure("agt-legacy", ["turn-a", "turn-b"]);
      await drain();
    }

    expect(harness.asked).toHaveLength(1);
    expect(harness.facts.factsOf("turn-a")).toBeNull();
  });

  it("asks again for a legacy thread once a new turn appears", async () => {
    const harness = requesterHarness();
    harness.state.summaries = [];
    await harness.requester.ensure("agt-legacy", ["turn-a"]);
    await drain();
    expect(harness.asked).toHaveLength(1);

    await harness.requester.ensure("agt-legacy", ["turn-a", "turn-b"]);
    await drain();

    expect(harness.asked).toHaveLength(2);
  });

  it("shares one in-flight request between two callers of the same thread", async () => {
    const harness = requesterHarness();
    harness.state.hold = true;
    const first = harness.requester.ensure("agt-1", ["turn-1"]);
    const second = harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();
    expect(harness.asked).toHaveLength(1);

    for (const gate of harness.gates.splice(0)) gate([summary("turn-1")]);
    await first;
    await second;

    expect(harness.facts.factsOf("turn-1")).not.toBeNull();
  });

  it("never publishes a summary naming a turn the caller did not ask about", async () => {
    const harness = requesterHarness();
    harness.state.summaries = [summary("turn-1"), summary("turn-foreign")];

    await harness.requester.ensure("agt-1", ["turn-1"]);
    await drain();

    expect(harness.facts.factsOf("turn-1")).not.toBeNull();
    expect(harness.facts.factsOf("turn-foreign")).toBeNull();
  });
});
