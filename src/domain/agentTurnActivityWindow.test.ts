import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentThread";
import type { AgentTurnLogEntry, AgentTurnLogPage } from "./agentTurnLog";
import {
  MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES,
  MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES,
  agentTurnActivityPageRejection,
  agentTurnActivityWindowEvents,
  agentTurnActivityWindowFirstSeq,
  agentTurnActivityWindowLastSeq,
  appendAgentTurnActivityPage,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
} from "./agentTurnActivityWindow";

function tool(seq: number): AgentTurnLogEntry {
  return { seq, event: { kind: "toolCall", toolId: `t${seq}`, name: "Bash", inputSummary: "ls" } };
}

function text(seq: number, value: string): AgentTurnLogEntry {
  return { seq, event: { kind: "assistantText", text: value } };
}

function page(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  patch: Partial<AgentTurnLogPage> = {},
): AgentTurnLogPage {
  return {
    entries,
    firstSeq: entries[0]?.seq ?? 0,
    lastSeq: entries[entries.length - 1]?.seq ?? 0,
    hasEarlier: true,
    hasLater: false,
    loss: { kind: "none" },
    clipped: false,
    ...patch,
  };
}

function range(from: number, to: number): ReadonlyArray<AgentTurnLogEntry> {
  return Array.from({ length: to - from + 1 }, (_, index) => tool(from + index));
}

describe("agent turn activity window", () => {
  it("opens from the tail and grows backwards contiguously", () => {
    const opened = openAgentTurnActivityWindow(page(range(801, 1000)));
    const grown = prependAgentTurnActivityPage(opened, page(range(601, 800)));

    expect(agentTurnActivityWindowFirstSeq(grown)).toBe(601);
    expect(agentTurnActivityWindowLastSeq(grown)).toBe(1000);
    expect(grown.entries).toHaveLength(400);
    expect(grown.hasEarlier).toBe(true);
    expect(grown.hasLater).toBe(false);
    expect(grown.gap).toBe(false);
  });

  it("evicts the newest entries past the entry and byte caps", () => {
    let window = openAgentTurnActivityWindow(page(range(4801, 5000)));
    for (let first = 4601; first >= 3401; first -= 200) {
      window = prependAgentTurnActivityPage(window, page(range(first, first + 199)));
    }
    expect(window.entries).toHaveLength(MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES);
    expect(agentTurnActivityWindowFirstSeq(window)).toBe(3401);
    expect(agentTurnActivityWindowLastSeq(window)).toBe(4400);
    expect(window.hasLater).toBe(true);

    const big = "x".repeat(300_000);
    let heavy = openAgentTurnActivityWindow(page([text(100, big)]));
    for (let seq = 99; seq >= 92; seq -= 1) {
      heavy = prependAgentTurnActivityPage(heavy, page([text(seq, big)]));
    }
    expect(heavy.bytes).toBeLessThanOrEqual(MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES);
    expect(heavy.entries).toHaveLength(6);
    expect(agentTurnActivityWindowFirstSeq(heavy)).toBe(92);
    expect(heavy.hasLater).toBe(true);
  });

  it("slides forward by evicting the earliest entries", () => {
    let window = openAgentTurnActivityWindow(
      page(range(1, 1000), { hasEarlier: false, hasLater: true }),
    );
    window = appendAgentTurnActivityPage(
      window,
      page(range(1001, 1200), { hasEarlier: true, hasLater: false }),
    );

    expect(agentTurnActivityWindowFirstSeq(window)).toBe(201);
    expect(agentTurnActivityWindowLastSeq(window)).toBe(1200);
    expect(window.hasEarlier).toBe(true);
    expect(window.hasLater).toBe(false);
  });

  it("marks a discontinuity, keeps the first loss and remembers clipping", () => {
    const opened = openAgentTurnActivityWindow(page(range(50, 60)));
    const gapped = prependAgentTurnActivityPage(
      opened,
      page(range(10, 20), { loss: { kind: "diskBudget", atEpochMs: 1 }, clipped: true }),
    );
    expect(gapped.gap).toBe(true);
    expect(gapped.loss).toEqual({ kind: "diskBudget", atEpochMs: 1 });
    expect(gapped.clipped).toBe(true);
  });

  it("keeps the most severe loss across pages and never lets a milder page replace it", () => {
    const opened = openAgentTurnActivityWindow(
      page(range(50, 60), { loss: { kind: "backgroundBuffer" } }),
    );
    const failed = prependAgentTurnActivityPage(
      opened,
      page(range(40, 50), { loss: { kind: "writeFailure" } }),
    );
    const milder = appendAgentTurnActivityPage(
      failed,
      page(range(60, 70), { loss: { kind: "supervisorGap" } }),
    );
    const unreadable = appendAgentTurnActivityPage(
      milder,
      page(range(70, 80), { loss: { kind: "unreadable" } }),
    );
    const clean = appendAgentTurnActivityPage(unreadable, page(range(80, 90)));

    expect(opened.loss).toEqual({ kind: "backgroundBuffer" });
    expect(failed.loss).toEqual({ kind: "writeFailure" });
    expect(milder.loss).toEqual({ kind: "writeFailure" });
    expect(unreadable.loss).toEqual({ kind: "unreadable" });
    expect(clean.loss).toEqual({ kind: "unreadable" });
  });

  it("rejects pages that overflow, reorder, disagree with their bounds or do not advance", () => {
    expect(agentTurnActivityPageRejection(page(range(1, 201)), { at: "tail" })).toBe("oversized");
    expect(agentTurnActivityPageRejection(page([tool(5), tool(4)]), { at: "tail" })).toBe(
      "unordered",
    );
    expect(
      agentTurnActivityPageRejection(page([tool(4), tool(5)], { firstSeq: 3 }), { at: "tail" }),
    ).toBe("inconsistent");
    expect(agentTurnActivityPageRejection(page(range(10, 20)), { at: "before", seq: 15 })).toBe(
      "notAdvancing",
    );
    expect(agentTurnActivityPageRejection(page(range(10, 20)), { at: "after", seq: 12 })).toBe(
      "notAdvancing",
    );
    expect(
      agentTurnActivityPageRejection(page([], { hasEarlier: true }), { at: "before", seq: 5 }),
    ).toBe("notAdvancing");
    expect(
      agentTurnActivityPageRejection(page(range(10, 20)), { at: "before", seq: 21 }),
    ).toBeNull();
  });

  it("coalesces streamed text for display and keys each run by its first seq", () => {
    const window = openAgentTurnActivityWindow(
      page([text(7, "Hel"), text(8, "lo"), tool(9), text(10, "Done")]),
    );
    const view = agentTurnActivityWindowEvents(window);

    expect(view.seqs).toEqual([7, 9, 10]);
    expect(view.events.map((event: AgentTurnEvent) => event.kind)).toEqual([
      "assistantText",
      "toolCall",
      "assistantText",
    ]);
    expect(view.events[0]).toMatchObject({ text: "Hello" });
  });

  it("collapses consecutive settled snapshot updates of the same tool into the latest one", () => {
    const window = openAgentTurnActivityWindow(
      page([
        snapshotCall(1, "a", "TodoWrite", "1 todo"),
        snapshotResult(2, "a"),
        snapshotCall(3, "b", "TodoWrite", "2 todos"),
        snapshotResult(4, "b"),
        snapshotCall(5, "c", "TodoWrite", "3 todos"),
        snapshotResult(6, "c"),
        tool(7),
        snapshotCall(8, "d", "TodoWrite", "4 todos"),
        snapshotResult(9, "d"),
      ]),
    );
    const view = agentTurnActivityWindowEvents(window);

    expect(view.seqs).toEqual([1, 6, 7, 8, 9]);
    expect(view.events[0]).toMatchObject({
      kind: "toolCall",
      toolId: "c",
      inputSummary: "3 todos",
    });
    expect(view.events[1]).toMatchObject({ kind: "toolResult", toolId: "c" });
    expect(view.events[3]).toMatchObject({ kind: "toolCall", toolId: "d" });
    expect(window.entries).toHaveLength(9);
  });

  it("keeps snapshot updates that are open, of another tool or of another parent", () => {
    const view = agentTurnActivityWindowEvents(
      openAgentTurnActivityWindow(
        page([
          snapshotCall(1, "a", "TodoWrite", "open"),
          snapshotCall(2, "b", "TodoWrite", "next"),
          snapshotResult(3, "b"),
          snapshotCall(4, "c", "update_plan", "plan"),
          snapshotResult(5, "c"),
          { ...snapshotCall(6, "d", "update_plan", "child"), event: childCall("d") },
          snapshotResult(7, "d"),
          snapshotCall(8, "e", "Bash", "ls"),
          snapshotResult(9, "e"),
          snapshotCall(10, "f", "Bash", "pwd"),
        ]),
      ),
    );

    expect(view.seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

function snapshotCall(
  seq: number,
  toolId: string,
  name: string,
  inputSummary: string,
): AgentTurnLogEntry {
  return { seq, event: { kind: "toolCall", toolId, name, inputSummary } };
}

function snapshotResult(seq: number, toolId: string): AgentTurnLogEntry {
  return { seq, event: { kind: "toolResult", toolId, outputSummary: "ok", isError: false } };
}

function childCall(toolId: string): AgentTurnEvent {
  return {
    kind: "toolCall",
    toolId,
    name: "update_plan",
    inputSummary: "child",
    parentToolId: "agent",
  };
}
