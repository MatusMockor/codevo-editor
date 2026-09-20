// @vitest-environment jsdom

import { act, createElement, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import type { AgentTurnLogSlotStatus } from "./agentTurnLogPorts";
import {
  MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS,
  createAgentTurnLogFactsStore,
  useAgentTurnLogThreadEvidence,
  type AgentTurnLogFactsSource,
} from "./agentTurnLogStatusStore";

const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";

function summary(turnId: string): AgentTurnLogSummary {
  return {
    turnId,
    eventCount: 10,
    bytes: 100,
    loss: { kind: "none" },
    sealed: true,
    digest: null,
    prompt: null,
    promptOmitted: false,
    lifecycle: null,
    lifecycleOmitted: false,
  };
}

function liveSlot(
  contextWindow: { usedTokens: number; contextWindow: number } | null,
): AgentTurnLogSlotStatus {
  return {
    turnId: TURN_ID,
    threadId: THREAD_ID,
    state: { kind: "writing" },
    loss: { kind: "none" },
    pendingOps: 0,
    pendingBytes: 0,
    backpressure: false,
    persistedThroughSeq: 0,
    bounded: false,
    contextWindow,
    promptStored: false,
  };
}

function renderUsageMemo(source: AgentTurnLogFactsSource, threadIds: ReadonlyArray<string>) {
  const captured = { renders: 0, aggregates: new Set<unknown>() };

  function Harness() {
    const evidence = useAgentTurnLogThreadEvidence(source, threadIds);
    const aggregate = useMemo(() => ({ lost: evidence(TURN_ID) === null }), [evidence]);
    captured.aggregates.add(aggregate);
    captured.renders += 1;
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  return {
    aggregates: () => captured.aggregates.size,
    renders: () => captured.renders,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentTurnLogThreadEvidence", () => {
  it("ignores a live context window tick of a thread it aggregates", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot(THREAD_ID, liveSlot(null));
    const harness = renderUsageMemo(store, [THREAD_ID]);
    const renders = harness.renders();

    act(() => store.publishSlot(THREAD_ID, liveSlot({ usedTokens: 5, contextWindow: 9 })));

    expect(harness.renders()).toBe(renders);
    expect(harness.aggregates()).toBe(1);
    harness.unmount();
  });

  it("recomputes when the evidence of an aggregated thread arrives", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const harness = renderUsageMemo(store, [THREAD_ID]);
    expect(harness.aggregates()).toBe(1);

    act(() => store.publishSummaries(THREAD_ID, [summary(TURN_ID)]));

    expect(harness.aggregates()).toBe(2);
    harness.unmount();
  });

  it("recomputes when the store evicts an aggregated thread", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries(THREAD_ID, [summary(TURN_ID)]);
    const harness = renderUsageMemo(store, [THREAD_ID]);
    const aggregates = harness.aggregates();

    act(() => {
      for (let index = 0; index <= MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS; index += 1) {
        store.publishSummaries(`agt-filler-${index}`, [summary(`turn-filler-${index}`)]);
      }
    });

    expect(store.hasThreadFacts(THREAD_ID)).toBe(false);
    expect(harness.aggregates()).toBe(aggregates + 1);
    harness.unmount();
  });

  it("ignores a thread it does not aggregate", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const harness = renderUsageMemo(store, [THREAD_ID]);
    const renders = harness.renders();

    act(() => store.publishSummaries("agt-other", [summary("turn-other")]));

    expect(harness.renders()).toBe(renders);
    expect(harness.aggregates()).toBe(1);
    harness.unmount();
  });
});
