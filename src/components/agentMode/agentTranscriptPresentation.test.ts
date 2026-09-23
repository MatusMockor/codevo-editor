import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { agentTurnEndMarker } from "./agentTurnErrorPresentation";
import { sameAgentTurnItem, agentTurnItemsMissingFrom } from "./agentTurnItemEquality";
import { agentSubagentTokensLabel, agentTurnLaunchLabel } from "./agentTurnMetaPresentation";
import {
  MAX_RENDERED_EVENTS_PER_TURN,
  MAX_REVEALED_EVENTS_PER_TURN,
  agentPartialWorkSummary,
  agentRenderedEventLimit,
  agentSubagentGroupSettlement,
  agentToolSettlement,
  agentTurnLiveActivity,
  agentTurnProjection,
  agentTurnWorkFold,
} from "./agentTurnProjection";

function liveTurn(events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId: "t1",
    prompt: "Do it",
    status: { kind: "running" },
    startedAtEpochMs: 0,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

describe("agentToolSettlement", () => {
  it("never reports unresolved tools of a failed, crashed or app-closed turn as successful", () => {
    const cases: ReadonlyArray<readonly [AgentTurnStatus, string]> = [
      [{ kind: "pending" }, "running"],
      [{ kind: "running" }, "running"],
      [{ kind: "stopped" }, "stopped"],
      [{ kind: "interrupted" }, "interrupted"],
      [{ kind: "failed", message: "boom" }, "interrupted"],
      [{ kind: "exited", exitCode: 3 }, "interrupted"],
      [{ kind: "exited", exitCode: 0 }, "settled"],
    ];
    for (const [status, expected] of cases) expect(agentToolSettlement(status)).toBe(expected);
  });

  it("renders a result-less call as interrupted, and a returned result keeps its outcome", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "toolCall", toolId: "a", name: "Bash", inputSummary: "npm test" },
      { kind: "toolCall", toolId: "b", name: "Read", inputSummary: "src/a.ts" },
      { kind: "toolResult", toolId: "b", outputSummary: "ok", isError: false },
    ];
    const items = agentTurnProjection(events, null, null, "interrupted").items;
    expect(items.map((item) => (item.kind === "tool" ? [item.status, item.label] : null))).toEqual([
      ["interrupted", "Interrupted npm test"],
      ["ok", "Read src/a.ts"],
    ]);
  });

  it("settles a subagent group from its own state before falling back to the parent turn", () => {
    expect(agentSubagentGroupSettlement("completed", "interrupted")).toBe("settled");
    expect(agentSubagentGroupSettlement("failed", "running")).toBe("interrupted");
    expect(agentSubagentGroupSettlement("interrupted", "settled")).toBe("interrupted");
    expect(agentSubagentGroupSettlement("started", "running")).toBe("running");
    expect(agentSubagentGroupSettlement("started", "settled")).toBe("interrupted");
    expect(agentSubagentGroupSettlement("started", "stopped")).toBe("stopped");
  });
});

describe("agentTurnLiveActivity", () => {
  it("prefers newer narration over a stale unresolved call", () => {
    expect(
      agentTurnLiveActivity(
        liveTurn([
          { kind: "toolCall", toolId: "bg", name: "Bash", inputSummary: "npm run dev" },
          { kind: "assistantText", text: "The server is up; now checking routes." },
        ]),
      ),
    ).toEqual({ kind: "working" });
  });

  it("reports a call made after the latest narration", () => {
    expect(
      agentTurnLiveActivity(
        liveTurn([
          { kind: "toolCall", toolId: "bg", name: "Bash", inputSummary: "npm run dev" },
          { kind: "reasoning", text: "Next, read the routes." },
          { kind: "toolCall", toolId: "read", name: "Read", inputSummary: "src/routes.ts" },
        ]),
      ),
    ).toEqual({ kind: "tool", toolId: "read" });
  });

  it("ignores subagent narration when choosing the live call", () => {
    expect(
      agentTurnLiveActivity(
        liveTurn([
          { kind: "toolCall", toolId: "run", name: "Bash", inputSummary: "npm test" },
          { kind: "assistantText", text: "child says hi", parentToolId: "spawn" },
        ]),
      ),
    ).toEqual({ kind: "tool", toolId: "run" });
  });
});

describe("work summary", () => {
  function summary(events: ReadonlyArray<AgentTurnEvent>): string | undefined {
    const items = agentTurnProjection(
      [...events, { kind: "assistantText", text: "Done." }],
      null,
      null,
      "settled",
    ).items;
    return agentTurnWorkFold(items, false)?.summary;
  }

  it("classifies searches and counts distinct changed files across patches", () => {
    expect(
      summary([
        { kind: "toolCall", toolId: "g", name: "Grep", inputSummary: "needle" },
        { kind: "toolCall", toolId: "gl", name: "Glob", inputSummary: "**/*.ts" },
        { kind: "toolCall", toolId: "ws", name: "web_search", inputSummary: "vitest" },
        { kind: "toolCall", toolId: "wf", name: "WebFetch", inputSummary: "https://x" },
        {
          kind: "toolCall",
          toolId: "p1",
          name: "apply_patch",
          inputSummary: "/repo/a.ts, /repo/b.ts, /repo/c.ts",
        },
        { kind: "toolCall", toolId: "e1", name: "Edit", inputSummary: "/repo/a.ts" },
        { kind: "toolCall", toolId: "e2", name: "MultiEdit", inputSummary: "/repo/d.ts" },
        { kind: "toolCall", toolId: "n1", name: "NotebookEdit", inputSummary: "" },
      ]),
    ).toBe("3 searches · 5 files changed · 1 page fetched");
  });
});

describe("work summary honesty", () => {
  it("counts only edits that completed successfully", () => {
    const items = agentTurnProjection(
      [
        { kind: "toolCall", toolId: "ok", name: "Edit", inputSummary: "/repo/a.ts" },
        { kind: "toolResult", toolId: "ok", outputSummary: "", isError: false },
        { kind: "toolCall", toolId: "bad", name: "Edit", inputSummary: "/repo/b.ts" },
        { kind: "toolResult", toolId: "bad", outputSummary: "no match", isError: true },
        { kind: "toolCall", toolId: "cut", name: "Write", inputSummary: "/repo/c.ts" },
        { kind: "assistantText", text: "Done." },
      ],
      null,
      null,
      "interrupted",
    ).items;
    expect(agentTurnWorkFold(items, false)?.summary).toBe("1 file changed");
  });

  it("marks a summary as partial when earlier events are hidden", () => {
    expect(agentPartialWorkSummary("2 commands", 0)).toBe("2 commands");
    expect(agentPartialWorkSummary("2 commands", 5)).toBe("At least 2 commands");
    expect(agentPartialWorkSummary("Activity", 5)).toBe("Activity · earlier events hidden");
  });
});

describe("subagent narration", () => {
  it("keeps child replies out of the main transcript and tags child reasoning", () => {
    const items = agentTurnProjection(
      [
        { kind: "toolCall", toolId: "spawn", name: "Task", inputSummary: "Review" },
        { kind: "reasoning", text: "child thinking", parentToolId: "spawn" },
        { kind: "assistantText", text: "child reply", parentToolId: "spawn" },
        { kind: "assistantText", text: "lead reply" },
      ],
      null,
      null,
      "settled",
    ).items;
    expect(items.map((item) => item.kind)).toEqual(["tool", "reasoning", "assistantText"]);
    expect(items[1]).toMatchObject({ kind: "reasoning", parentToolId: "spawn" });
    expect(items[2]).toMatchObject({ kind: "assistantText", text: "lead reply" });
  });
});

describe("rendered event window", () => {
  it("reveals earlier events in bounded increments", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 450 }, (_unused, index) => ({
      kind: "assistantText",
      text: `line ${index}`,
    }));
    const first = agentTurnProjection(events);
    expect(first.hiddenCount).toBe(450 - MAX_RENDERED_EVENTS_PER_TURN);
    const second = agentTurnProjection(events, null, null, "running", 0, 400);
    expect(second.items).toHaveLength(400);
    expect(second.hiddenCount).toBe(50);
    expect(agentRenderedEventLimit(10)).toBe(MAX_RENDERED_EVENTS_PER_TURN);
    expect(agentRenderedEventLimit(1e9)).toBe(MAX_REVEALED_EVENTS_PER_TURN);
    expect(agentRenderedEventLimit(Number.NaN)).toBe(MAX_RENDERED_EVENTS_PER_TURN);
  });
});

describe("agentTurnEndMarker", () => {
  it("marks stopped, app-closed and non-zero exits but leaves success and failures alone", () => {
    expect(agentTurnEndMarker({ kind: "stopped" })).toEqual({
      kind: "stopped",
      label: "Stopped",
    });
    expect(agentTurnEndMarker({ kind: "interrupted" })?.label).toBe("Interrupted");
    expect(agentTurnEndMarker({ kind: "interrupted" })).toMatchObject({
      detail: "The app closed before this turn finished.",
    });
    expect(agentTurnEndMarker({ kind: "interrupted" }, "remote")).toMatchObject({
      detail: "The remote run ended before this turn finished.",
    });
    expect(agentTurnEndMarker({ kind: "exited", exitCode: 2 })?.label).toBe("Exited with code 2");
    expect(agentTurnEndMarker({ kind: "exited", exitCode: 0 })).toBeNull();
    expect(agentTurnEndMarker({ kind: "failed", message: "x" })).toBeNull();
    expect(agentTurnEndMarker({ kind: "running" })).toBeNull();
  });
});

describe("turn meta presentation", () => {
  it("labels subagent token totals compactly and hides empty usage", () => {
    expect(
      agentSubagentTokensLabel({ inputTokens: 1_200, outputTokens: 300, contextTokens: null }),
    ).toBe("1.5k tok");
    expect(
      agentSubagentTokensLabel({
        inputTokens: 1,
        outputTokens: 1,
        contextTokens: null,
        appServerUsage: {
          last: breakdown(10),
          total: breakdown(2_500_000),
          contextWindow: null,
        },
      }),
    ).toBe("2.5M tok");
    expect(agentSubagentTokensLabel({ inputTokens: 0, outputTokens: 0, contextTokens: null })).toBe(
      null,
    );
    expect(agentSubagentTokensLabel(null)).toBeNull();
  });

  it("names the explicit model and effort but hides provider defaults", () => {
    expect(
      agentTurnLaunchLabel({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBeNull();
    expect(
      agentTurnLaunchLabel({
        provider: "claudeCode",
        model: "default",
        mode: "plan",
        effort: "high",
      }),
    ).toBe("High effort");
    expect(agentTurnLaunchLabel({ provider: "codex", model: "gpt-5.5", mode: "readOnly" })).toMatch(
      /\S/,
    );
    expect(agentTurnLaunchLabel(null)).toBeNull();
  });
});

describe("turn item equality", () => {
  it("compares structurally without serializing", () => {
    const left = agentTurnProjection([{ kind: "assistantText", text: "a\n\nb" }]).items;
    const right = agentTurnProjection([{ kind: "assistantText", text: "a\n\nb" }]).items;
    const other = agentTurnProjection([{ kind: "assistantText", text: "a\n\nc" }]).items;
    expect(left[0] !== right[0]).toBe(true);
    expect(sameAgentTurnItem(left[0]!, right[0]!)).toBe(true);
    expect(sameAgentTurnItem(left[0]!, other[0]!)).toBe(false);
    expect(agentTurnItemsMissingFrom(other, left)).toEqual(other);
    expect(agentTurnItemsMissingFrom(right, left)).toEqual([]);
  });
});

function breakdown(totalTokens: number) {
  return {
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
  };
}
