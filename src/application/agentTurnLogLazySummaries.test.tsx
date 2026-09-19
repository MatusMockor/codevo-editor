// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import type { AgentThread } from "../domain/agentThread";
import { buildAgentThreadSearchDocument } from "../domain/agentThreadSearch";
import {
  agentTurnContentLost,
  agentTurnWindowDisplay,
  type AgentTurnLogEvidenceLookup,
} from "../domain/agentTurnContentLoss";
import type { AgentTurnLogSummary } from "../domain/agentTurnLog";
import { aggregateAgentUsage } from "../domain/agentUsage";
import {
  LOG_OWNER_ID,
  LOG_ROOT_KEY,
  logThread,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import { agentTurnLogEvidence } from "./agentTurnLogStatusStore";

const THREAD_COUNT = 64;
const TURNS_PER_THREAD = 64;
const NOW_EPOCH_MS = 1_700_000_000_000;

function threadIdOf(index: number): string {
  return `agt-${index}-0a1b`;
}

function turnIdOf(threadIndex: number, turnIndex: number): string {
  return `agt-${threadIndex}-${turnIndex}-0a1c`;
}

function loggedThread(index: number): AgentThread {
  return logThread({
    threadId: threadIdOf(index),
    title: `thread ${index}`,
    updatedAtEpochMs: NOW_EPOCH_MS - index,
    turns: Array.from({ length: TURNS_PER_THREAD }, (_unused, turnIndex) =>
      logTurn({
        turnId: turnIdOf(index, turnIndex),
        prompt: `prompt ${index}-${turnIndex}`,
        startedAtEpochMs: NOW_EPOCH_MS - 2_000,
        endedAtEpochMs: NOW_EPOCH_MS - 1_000,
        events: [],
        eventsTruncated: true,
      }),
    ),
  });
}

function healthySummaries(threadIndex: number): ReadonlyArray<AgentTurnLogSummary> {
  return Array.from({ length: TURNS_PER_THREAD }, (_unused, turnIndex) =>
    sealedLogSummary(turnIdOf(threadIndex, turnIndex), 400),
  );
}

function loadedProject() {
  const persisted = Array.from({ length: THREAD_COUNT }, (_unused, index) => loggedThread(index));
  const summariesByThread = new Map<string, ReadonlyArray<AgentTurnLogSummary>>(
    persisted.map((thread, index) => [thread.threadId, healthySummaries(index)]),
  );
  return { persisted, harness: renderLogStore({ persisted, summariesByThread }) };
}

describe("agent turn log summaries are fetched lazily per thread", () => {
  it("does not summarize every saved thread when a project loads", async () => {
    const { harness } = loadedProject();
    await settleLogStore();

    expect(harness.logGateway.summarized).toEqual([]);

    act(() => harness.hook().hydrateThread?.(threadIdOf(0)));
    await settleLogStore();

    expect(harness.logGateway.summarized).toEqual([
      {
        rootKey: LOG_ROOT_KEY,
        ownerId: LOG_OWNER_ID,
        threadId: threadIdOf(0),
        includePrompts: false,
      },
    ]);
    expect(harness.turnLog.facts.factsOf(turnIdOf(0, 0))).not.toBeNull();

    act(() => harness.hook().hydrateThread?.(threadIdOf(0)));
    await settleLogStore();
    expect(harness.logGateway.summarized).toHaveLength(1);
    await harness.unmount();
  });

  it("keeps the facts of the thread the user opened while other threads publish theirs", async () => {
    const { harness, persisted } = loadedProject();
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(threadIdOf(0)));
    await settleLogStore();

    for (let index = 1; index <= 16; index += 1) {
      act(() => harness.turnLog.facts.publishSummaries(threadIdOf(index), healthySummaries(index)));
    }

    const evidenceOf: AgentTurnLogEvidenceLookup = (turnId) =>
      agentTurnLogEvidence(harness.turnLog.facts.factsOf(turnId));
    const opened = persisted[0]!;
    const lastTurn = opened.turns[opened.turns.length - 1]!;

    expect(agentTurnContentLost(true, evidenceOf(lastTurn.turnId))).toBe(false);
    expect(buildAgentThreadSearchDocument(opened, evidenceOf).truncated).toBe(false);
    expect(
      aggregateAgentUsage([opened], "30days", NOW_EPOCH_MS, evidenceOf).providers.claudeCode.total
        .cliUsage.incomplete,
    ).toBe(false);
    await harness.unmount();
  });

  it("never publishes summaries that arrive after the project went away", async () => {
    const { harness } = loadedProject();
    await settleLogStore();
    harness.logGateway.holdSummaries = true;

    act(() => {
      void harness.turnLog.facts.ensureThreadFacts(threadIdOf(0), [turnIdOf(0, 0)]);
    });
    await settleLogStore();
    expect(harness.logGateway.summarized).toHaveLength(1);

    harness.setProjects([]);
    harness.logGateway.holdSummaries = false;
    harness.logGateway.releaseSummaries();
    await settleLogStore();

    expect(harness.turnLog.facts.hasThreadFacts(threadIdOf(0))).toBe(false);
    expect(harness.turnLog.facts.factsOf(turnIdOf(0, 0))).toBeNull();
    await harness.unmount();
  });

  it("summarizes a legacy thread without log rows once however often it is opened", async () => {
    const harness = renderLogStore({ persisted: [loggedThread(0)] });
    await settleLogStore();

    for (let open = 0; open < 5; open += 1) {
      act(() => harness.hook().hydrateThread?.(threadIdOf(0)));
      await settleLogStore();
    }

    expect(harness.logGateway.summarized).toHaveLength(1);
    expect(harness.turnLog.facts.factsOf(turnIdOf(0, 0))).toBeNull();
    await harness.unmount();
  });

  it("keeps a partially hydrated turn of the open thread saved but not shown", async () => {
    const { harness, persisted } = loadedProject();
    await settleLogStore();

    act(() => harness.hook().hydrateThread?.(threadIdOf(0)));
    await settleLogStore();

    const opened = persisted[0]!;
    const lastTurn = opened.turns[opened.turns.length - 1]!;
    act(() => harness.turnLog.facts.publishHydration(lastTurn.turnId, "partial"));

    for (let index = 1; index <= 16; index += 1) {
      act(() => harness.turnLog.facts.publishSummaries(threadIdOf(index), healthySummaries(index)));
    }

    const evidence = agentTurnLogEvidence(harness.turnLog.facts.factsOf(lastTurn.turnId));
    expect(agentTurnWindowDisplay(true, evidence)).toBe("savedNotShown");
    await harness.unmount();
  });
});
