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

describe("agent turn activity window source discard", () => {
  it("never carries the flag for pages that do not report a discard", () => {
    const opened = openAgentTurnActivityWindow(page(range(401, 600)));
    const earlier = prependAgentTurnActivityPage(opened, page(range(201, 400)));
    const later = appendAgentTurnActivityPage(earlier, page(range(601, 800)));

    expect("earlierDiscarded" in opened).toBe(false);
    expect("earlierDiscarded" in earlier).toBe(false);
    expect("earlierDiscarded" in later).toBe(false);
    expect(
      "earlierDiscarded" in openAgentTurnActivityWindow(page([], { earlierDiscarded: false })),
    ).toBe(false);
  });

  it("keeps a reported discard through later pages and eviction", () => {
    const start = page(range(1, 200), { hasEarlier: false, earlierDiscarded: true });
    let window = prependAgentTurnActivityPage(
      openAgentTurnActivityWindow(page(range(201, 400))),
      start,
    );
    expect(window.earlierDiscarded).toBe(true);
    expect(window.hasEarlier).toBe(false);
    expect(openAgentTurnActivityWindow(start).earlierDiscarded).toBe(true);

    for (let first = 401; first <= 1401; first += 200)
      window = appendAgentTurnActivityPage(window, page(range(first, first + 199)));

    expect(window.entries.length).toBe(MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES);
    expect(window.hasEarlier).toBe(true);
    expect(window.earlierDiscarded).toBe(true);
    expect(
      appendAgentTurnActivityPage(
        openAgentTurnActivityWindow(page(range(1, 10))),
        page(range(11, 20), { earlierDiscarded: true }),
      ).earlierDiscarded,
    ).toBe(true);
  });
});

describe("agent turn activity window re-announced tool calls", () => {
  function call(seq: number, toolId: string, parentToolId?: string): AgentTurnLogEntry {
    return {
      seq,
      event: {
        kind: "toolCall",
        toolId,
        name: "shell",
        inputSummary: "ls",
        ...(parentToolId === undefined ? {} : { parentToolId }),
      },
    };
  }

  function result(seq: number, toolId: string, parentToolId?: string): AgentTurnLogEntry {
    return {
      seq,
      event: {
        kind: "toolResult",
        toolId,
        outputSummary: "ok",
        isError: false,
        ...(parentToolId === undefined ? {} : { parentToolId }),
      },
    };
  }

  function viewOf(entries: ReadonlyArray<AgentTurnLogEntry>) {
    const view = agentTurnActivityWindowEvents(openAgentTurnActivityWindow(page(entries)));
    expect(view.seqs).toHaveLength(view.events.length);
    return view;
  }

  it("drops a tool call announced again right before its result and keeps the result", () => {
    const entries = [call(1, "x"), text(2, "between"), call(3, "x"), result(4, "x"), tool(5)];
    const view = viewOf(entries);

    expect(view.seqs).toEqual([1, 2, 4, 5]);
    expect(view.events).toEqual(
      [entries[0], entries[1], entries[3], entries[4]].map((e) => e?.event),
    );
  });

  it("keeps a repeated call when the earlier one was already settled", () => {
    const entries = [call(1, "x"), result(2, "x"), call(3, "x"), result(4, "x")];

    expect(viewOf(entries).seqs).toEqual([1, 2, 3, 4]);
  });

  it("keeps calls with different ids", () => {
    const entries = [call(1, "x"), call(2, "y"), result(3, "y"), result(4, "x")];

    expect(viewOf(entries).seqs).toEqual([1, 2, 3, 4]);
  });

  it("matches nested calls by tool id and parent together", () => {
    const sameParent = [call(1, "x", "agent"), call(2, "x", "agent"), result(3, "x", "agent")];
    const otherParent = [call(1, "x", "agent"), call(2, "x", "other"), result(3, "x", "other")];
    const rootAndNested = [call(1, "x"), call(2, "x", "agent"), result(3, "x", "agent")];
    const foreignResult = [call(1, "x", "agent"), call(2, "x", "agent"), result(3, "x")];

    expect(viewOf(sameParent).seqs).toEqual([1, 3]);
    expect(viewOf(otherParent).seqs).toEqual([1, 2, 3]);
    expect(viewOf(rootAndNested).seqs).toEqual([1, 2, 3]);
    expect(viewOf(foreignResult).seqs).toEqual([1, 2, 3]);
  });

  it("keeps a repeated call that is not immediately followed by its own result", () => {
    const apart = [call(1, "x"), call(2, "x"), text(3, "between"), result(4, "x")];
    const otherResult = [call(1, "x"), call(2, "y"), call(3, "x"), result(4, "y")];
    const atWindowEnd = [call(1, "x"), text(2, "between"), call(3, "x")];

    expect(viewOf(apart).seqs).toEqual([1, 2, 3, 4]);
    expect(viewOf(otherResult).seqs).toEqual([1, 2, 3, 4]);
    expect(viewOf(atWindowEnd).seqs).toEqual([1, 2, 3]);
  });

  it("reconciles each re-announcement of a long running call only against an open one", () => {
    const entries = [
      call(1, "x"),
      call(2, "x"),
      result(3, "x"),
      call(4, "x"),
      result(5, "x"),
      call(6, "x"),
      call(7, "x"),
      result(8, "x"),
    ];

    expect(viewOf(entries).seqs).toEqual([1, 3, 4, 5, 6, 8]);
  });
});
