import { describe, expect, it, vi } from "vitest";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import {
  MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS,
  createAgentTurnLogFactsStore,
} from "./agentTurnLogStatusStore";
import type { AgentTurnLogSlotStatus } from "./agentTurnLogPorts";

function status(
  turnId: string,
  overrides: Partial<AgentTurnLogSlotStatus> = {},
): AgentTurnLogSlotStatus {
  return {
    turnId,
    threadId: "agt-owner",
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
    lifecycle: null,
    lifecycleOmitted: false,
    ...overrides,
  };
}

describe("agent turn log facts store evidence integrity", () => {
  it("notifies and changes the evidence revision of a thread evicted by an empty publish", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries("agt-evicted", [summary("turn-evicted")]);
    const evictedRevision = store.evidenceRevisionOf("agt-evicted");
    for (let index = 0; index < MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS - 1; index += 1) {
      store.publishSummaries(`agt-filler-${index}`, [summary(`turn-filler-${index}`)]);
    }
    const listener = vi.fn();
    store.subscribe(listener);

    store.publishSummaries("agt-lazy", []);

    expect(store.factsOf("turn-evicted")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.evidenceRevisionOf("agt-evicted")).not.toBe(evictedRevision);
  });

  it("notifies once for a publish of the whole per-thread retention window", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.publishSummaries(
      "agt-batch",
      Array.from({ length: 64 }, (_unused, index) => summary(`turn-batch-${index}`)),
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports the thread ids whose facts changed with every notification", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const changes: Array<ReadonlyArray<string>> = [];
    store.subscribe((changed) => changes.push([...changed]));

    store.publishSummaries("agt-a", [summary("turn-a")]);
    store.publishSummaries("agt-b", [summary("turn-b")]);

    expect(changes).toEqual([["agt-a"], ["agt-b"]]);
  });

  it("ignores a summary naming a turn another thread already owns", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries("agt-owner", [summary("turn-shared")]);

    store.publishSummaries("agt-thief", [summary("turn-shared", { loss: { kind: "unreadable" } })]);

    expect(store.threadIdOf("turn-shared")).toBe("agt-owner");
    expect(store.factsOf("turn-shared")?.loss).toEqual({ kind: "none" });
  });

  it("ignores a summary for a turn the caller did not ask about", () => {
    const store = createAgentTurnLogFactsStore(() => 0);

    store.publishSummaries(
      "agt-owner",
      [summary("turn-known"), summary("turn-foreign")],
      ["turn-known"],
    );

    expect(store.factsOf("turn-known")).not.toBeNull();
    expect(store.factsOf("turn-foreign")).toBeNull();
  });

  it("drops the visible-thread pin when every fact is cleared", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSummaries("agt-pinned", [summary("turn-pinned")]);
    store.setVisibleThread("agt-pinned");
    store.clear();

    store.publishSummaries("agt-pinned", [summary("turn-pinned")]);
    for (let index = 0; index < MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS; index += 1) {
      store.publishSummaries(`agt-after-${index}`, [summary(`turn-after-${index}`)]);
    }

    expect(store.hasThreadFacts("agt-pinned")).toBe(false);
  });

  it("keeps a live context-window tick out of the evidence revision", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    store.publishSlot("agt-owner", status("turn-live"));
    const revision = store.evidenceRevisionOf("agt-owner");

    store.publishSlot(
      "agt-owner",
      status("turn-live", { contextWindow: { usedTokens: 5, contextWindow: 9 } }),
    );

    expect(store.evidenceRevisionOf("agt-owner")).toBe(revision);
  });
});
