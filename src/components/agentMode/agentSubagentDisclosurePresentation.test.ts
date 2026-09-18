import { describe, expect, it } from "vitest";
import { agentSubagentDisclosureEntries } from "./agentSubagentDisclosurePresentation";

describe("agentSubagentDisclosureEntries", () => {
  it("shows Claude reported telemetry and bounds a child output preview", () => {
    const entries = agentSubagentDisclosureEntries([
      { kind: "toolCall", toolId: "a", name: "Agent", inputSummary: "Audit" },
      {
        kind: "subagent",
        toolId: "a",
        status: "running",
        subagentType: "Reviewer",
        totalTokens: 12,
        lastToolName: "Read",
      },
      { kind: "assistantText", parentToolId: "a", text: "x".repeat(3_000) },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "Reviewer",
      description: "Audit",
      state: "running",
      totalTokens: 12,
      lastToolName: "Read",
    });
    expect(entries[0]?.detail?.length).toBeLessThan(2_050);
    expect(entries[0]?.detail).toContain("preview shortened");
  });

  it("uses Codex child identities instead of double-counting spawn-tool acknowledgements", () => {
    const entries = agentSubagentDisclosureEntries([
      { kind: "toolCall", toolId: "spawn", name: "spawn_agent", inputSummary: "Review" },
      { kind: "toolResult", toolId: "spawn", outputSummary: "spawned", isError: false },
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "/review",
        activity: "started",
      },
      {
        kind: "subagentEvent",
        agentThreadId: "child",
        event: { kind: "assistantText", text: "Review complete" },
      },
      { kind: "subagentTurnDone", agentThreadId: "child", isError: false, durationMs: 5000 },
    ]);
    expect(entries).toEqual([
      {
        toolId: "thread:child",
        name: "/review",
        description: "",
        state: "completed",
        durationMs: 5000,
        detail: "Review complete",
      },
    ]);
  });

  it("does not invent status or metrics for a Codex child with only content", () => {
    expect(
      agentSubagentDisclosureEntries([
        {
          kind: "subagentEvent",
          agentThreadId: "child",
          event: { kind: "assistantText", text: "partial" },
        },
      ])[0],
    ).toEqual({
      toolId: "thread:child",
      name: "Subagent",
      description: "",
      state: "unknown",
      detail: "partial",
    });
  });

  it("keeps retained lifecycle authoritative after output eviction", () => {
    const entries = agentSubagentDisclosureEntries([], {
      entries: [
        {
          id: "a",
          toolId: "a",
          name: "Reviewer",
          description: "Audit",
          state: "completed",
          steps: 3,
        },
      ],
      truncated: false,
    });
    expect(entries[0]).toMatchObject({
      toolId: "tool:a",
      name: "Reviewer",
      state: "completed",
      steps: 3,
    });
    expect(entries[0]?.detail).toBeUndefined();
  });

  it("uses retained spawn identity to attach a child answer after spawn output eviction", () => {
    const entries = agentSubagentDisclosureEntries(
      [{ kind: "assistantText", parentToolId: "a", text: "Done" }],
      {
        entries: [
          { id: "a", toolId: "a", name: "Reviewer", description: "Audit", state: "completed" },
        ],
        truncated: false,
      },
    );
    expect(entries[0]?.detail).toBe("Done");
  });

  it.each(["stopped", "settled"] as const)(
    "does not show retained work as live after the process is %s",
    (settlement) => {
      const entries = agentSubagentDisclosureEntries(
        [],
        {
          entries: [
            { id: "a", toolId: "a", name: "Reviewer", description: "Audit", state: "running" },
          ],
          truncated: false,
        },
        settlement,
      );
      expect(entries[0]?.state).toBe(settlement === "stopped" ? "interrupted" : "unknown");
    },
  );

  it("keeps retained final state despite a retained stale start event", () => {
    const entries = agentSubagentDisclosureEntries(
      [
        {
          kind: "subagentActivity",
          agentThreadId: "child",
          agentPath: "/review",
          activity: "started",
        },
      ],
      {
        entries: [
          {
            id: "child",
            agentThreadId: "child",
            name: "/review",
            description: "",
            state: "failed",
          },
        ],
        truncated: false,
      },
    );
    expect(entries[0]?.state).toBe("failed");
  });
});
