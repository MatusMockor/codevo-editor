import { describe, expect, it } from "vitest";
import {
  agentActivityEntries,
  agentActivityAttentionCount,
  type AgentActivityTool,
} from "./agentActivityGrouping";

function activityTool(index: number, patch: Partial<AgentActivityTool> = {}): AgentActivityTool {
  return {
    kind: "tool",
    key: `e${index}`,
    toolId: `tool-${index}`,
    name: "Bash",
    rowKind: "command",
    status: "ok",
    inputSummary: "npm test",
    outcome: { isError: false, outputSummary: "ok" },
    label: `Command ${index}`,
    argument: null,
    command: "npm test",
    output: "ok",
    ...patch,
  };
}

describe("agentActivityEntries", () => {
  it("preserves conversational, subagent and failure boundaries", () => {
    const items = [
      activityTool(0),
      activityTool(1),
      { kind: "assistantText" as const, key: "e2", text: "Checking", paragraphs: ["Checking"] },
      activityTool(3),
      activityTool(4, { name: "Agent", rowKind: "agent" }),
      activityTool(5),
      activityTool(6, { status: "error" }),
      activityTool(7),
      activityTool(8),
    ];
    expect(agentActivityEntries(items).map((entry) => [entry.kind, entry.key])).toEqual([
      ["group", "e0"],
      ["item", "e2"],
      ["item", "e3"],
      ["item", "e4"],
      ["item", "e5"],
      ["item", "e6"],
      ["group", "e7"],
    ]);
    expect(agentActivityAttentionCount(items)).toBe(1);
  });
  it("recognizes both MCP transports and separates integrations", () => {
    const rows = [
      activityTool(0, { name: "mcp__chrome__navigate", rowKind: "other" }),
      activityTool(1, { name: "mcp__chrome__snapshot", rowKind: "other" }),
      activityTool(2, { name: "atlassian/search", rowKind: "other" }),
      activityTool(3, { name: "atlassian/read", rowKind: "other" }),
    ];
    expect(
      agentActivityEntries(rows).map((entry) => entry.kind === "group" && entry.label),
    ).toEqual(["Used chrome · 2 calls", "Used atlassian · 2 calls"]);
  });
  it("counts edits as operations without inventing distinct file or diff counts", () => {
    const edits = [0, 1].map((index) =>
      activityTool(index, { name: "Edit", rowKind: "edit", inputSummary: "same.ts" }),
    );
    expect(agentActivityEntries(edits)[0]).toMatchObject({ kind: "group", label: "2 file edits" });
  });
  it("does not mix parallel Claude subagent activities with the parent", () => {
    const entries = agentActivityEntries([
      activityTool(0),
      activityTool(1, { parentToolId: "a" }),
      activityTool(2, { parentToolId: "a" }),
      activityTool(3, { parentToolId: "b" }),
      activityTool(4),
    ]);
    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([
      ["item", "e0"],
      ["group", "e1"],
      ["item", "e3"],
      ["item", "e4"],
    ]);
  });

  it("keeps unknown tools separate", () => {
    expect(
      agentActivityEntries([
        activityTool(0, { name: "Skill", rowKind: "other" }),
        activityTool(1, { name: "Skill", rowKind: "other" }),
      ]).every((entry) => entry.kind === "item"),
    ).toBe(true);
  });
});
