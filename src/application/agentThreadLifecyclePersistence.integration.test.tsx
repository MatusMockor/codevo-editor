// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { AgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import { parseAgentThread, serializeAgentThread } from "../domain/agentThreadWire";
import { validateSaveAgentThreadRequest } from "../infrastructure/tauriAgentThreadStoreIpcContract";
import {
  LOG_THREAD_ID,
  logThread,
  logTurn,
  renderLogStore,
  sealedLogSummary,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";

function largeThread() {
  const lifecycle: AgentSubagentLifecycle = {
    entries: Array.from({ length: 32 }, (_, index) => ({
      id: `tool:${index}`,
      toolId: `t${index}`,
      name: "Agent",
      description: "x".repeat(512),
      state: "completed",
      resultState: "completed",
    })),
    truncated: false,
  };
  return logThread({
    turns: Array.from({ length: 64 }, (_, index) =>
      logTurn({
        turnId: `agt-1-${index.toString(16).padStart(4, "0")}`,
        subagentLifecycle: lifecycle,
      }),
    ),
  });
}

async function settleAll() {
  for (let index = 0; index < 8; index += 1) await settleLogStore();
}

describe("large lifecycle thread persistence through hydration", () => {
  it("restores oldest compacted turns beyond the summary response budget", async () => {
    const full = largeThread();
    const logged = new Map(full.turns.map((turn) => [turn.turnId, turn.subagentLifecycle!]));
    const compact = parseAgentThread(serializeAgentThread(full, undefined, logged));
    expect(compact.turns[0]!.subagentLifecycle!.entries).toHaveLength(1);
    const summaries = full.turns.map((turn) =>
      sealedLogSummary(turn.turnId, 0, { lifecycle: turn.subagentLifecycle! }),
    );
    const harness = renderLogStore({ persisted: [compact], summaries });
    const requests: string[] = [];
    harness.logGateway.summarizeTurnLogs = async (request) => {
      if (request.turnId !== undefined) {
        requests.push(request.turnId);
        return summaries.filter((entry) => entry.turnId === request.turnId);
      }
      return summaries.map((summary, index) =>
        index < 40 || !request.includeLifecycles
          ? { ...summary, lifecycle: null, lifecycleOmitted: true }
          : summary,
      );
    };
    await settleAll();
    const savesBefore = harness.saved.length;
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleAll();
    expect(requests).toHaveLength(40);
    for (const turn of full.turns) {
      expect(harness.turnOf(LOG_THREAD_ID, turn.turnId)?.subagentLifecycle).toEqual(
        turn.subagentLifecycle,
      );
    }
    expect(harness.saved).toHaveLength(savesBefore);
    act(() => harness.hook().rename(LOG_THREAD_ID, "Restored"));
    await settleAll();
    const request = harness.saved[harness.saved.length - 1]!;
    const wire = validateSaveAgentThreadRequest(request);
    expect(new TextEncoder().encode(JSON.stringify(wire.thread)).byteLength).toBeLessThan(
      1_048_576,
    );
    await harness.unmount();
  });

  it("migrates old legacy snapshots and immediately uses acknowledged evidence on the next save", async () => {
    const full = largeThread();
    const harness = renderLogStore({
      persisted: [full],
      summaries: full.turns.map((turn) => sealedLogSummary(turn.turnId, 0)),
    });
    await settleAll();
    act(() => harness.hook().hydrateThread?.(LOG_THREAD_ID));
    await settleAll();
    expect(harness.logGateway.appends).toHaveLength(64);
    expect(harness.turnLog.facts.factsOf(full.turns[0]!.turnId)?.lifecycleInLog).toEqual(
      full.turns[0]!.subagentLifecycle,
    );
    act(() => harness.hook().rename(LOG_THREAD_ID, "Migrated"));
    await settleAll();
    const wire = validateSaveAgentThreadRequest(harness.saved[harness.saved.length - 1]!);
    expect(new TextEncoder().encode(JSON.stringify(wire.thread)).byteLength).toBeLessThan(
      1_048_576,
    );
    await harness.unmount();
  });
});
