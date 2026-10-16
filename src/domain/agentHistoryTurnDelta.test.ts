import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_HISTORY_DELTA_EDITS,
  planAgentHistoryTurnDelta,
  type AgentHistoryTurnDeltaPlan,
} from "./agentHistoryTurnDelta";
import type { AgentTurnEvent } from "./agentThread";
import { persistedAgentEventsBytes } from "./agentThreadTailCap";

function events(count: number, label = "event"): AgentTurnEvent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    kind: "assistantText" as const,
    text: `${label}-${index}`,
  }));
}

function rebuilt(
  base: ReadonlyArray<AgentTurnEvent>,
  plan: AgentHistoryTurnDeltaPlan,
): ReadonlyArray<AgentTurnEvent> {
  expect(plan.baseEventCount).toBe(base.length);
  return plan.edits.flatMap((edit) => {
    if (edit.kind === "insert") return [...edit.events];
    expect(edit.count).toBeGreaterThan(0);
    expect(edit.start + edit.count).toBeLessThanOrEqual(base.length);
    return base.slice(edit.start, edit.start + edit.count);
  });
}

describe("planAgentHistoryTurnDelta", () => {
  it("copies the acknowledged prefix and inserts only appended events", () => {
    const base = events(40);
    const appended = events(3, "new");
    const next = [...base, ...appended];

    const plan = planAgentHistoryTurnDelta(base, next)!;

    expect(plan.edits).toEqual([
      { kind: "copy", start: 0, count: 40 },
      { kind: "insert", events: appended },
    ]);
    expect(plan.retainedBytes).toBe(persistedAgentEventsBytes(base));
    expect(plan.insertedBytes).toBe(persistedAgentEventsBytes(appended));
    expect(rebuilt(base, plan)).toEqual(next);
  });

  it("re-sends a merged trailing event and drops head events evicted by the tail cap", () => {
    const base = events(10);
    const merged: AgentTurnEvent = { kind: "assistantText", text: "event-9 continued" };
    const next = [...base.slice(2, 9), merged];

    const plan = planAgentHistoryTurnDelta(base, next)!;

    expect(plan.edits).toEqual([
      { kind: "copy", start: 2, count: 7 },
      { kind: "insert", events: [merged] },
    ]);
    expect(rebuilt(base, plan)).toEqual(next);
  });

  it("keeps a sparse tail selection exact with separate copy runs", () => {
    const base = events(12);
    const next = [base[0]!, base[5]!, base[6]!, ...events(1, "late"), base[11]!];

    const plan = planAgentHistoryTurnDelta(base, next)!;

    expect(plan.edits.map((edit) => edit.kind)).toEqual(["copy", "copy", "insert", "copy"]);
    expect(rebuilt(base, plan)).toEqual(next);
  });

  it("treats an unchanged event list as a single copy", () => {
    const base = events(5);
    const plan = planAgentHistoryTurnDelta(base, base)!;
    expect(plan.edits).toEqual([{ kind: "copy", start: 0, count: 5 }]);
    expect(plan.insertedBytes).toBe(0);
  });

  it("matches events by acknowledged identity, never by equal content", () => {
    const base = events(2);
    const lookalike = events(2);
    const plan = planAgentHistoryTurnDelta(base, lookalike)!;
    expect(plan.edits).toEqual([{ kind: "insert", events: lookalike }]);
    expect(plan.retainedBytes).toBe(0);
  });

  it("declines empty or out-of-bounds event lists", () => {
    expect(planAgentHistoryTurnDelta(events(3), [])).toBeNull();
    expect(
      planAgentHistoryTurnDelta(events(MAX_AGENT_HISTORY_DELTA_EDITS + 1), events(1)),
    ).toBeNull();
    expect(
      planAgentHistoryTurnDelta(events(1), events(MAX_AGENT_HISTORY_DELTA_EDITS + 1)),
    ).toBeNull();
  });
});
