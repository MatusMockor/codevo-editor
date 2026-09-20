import { describe, expect, it } from "vitest";
import {
  agentActivityCategoryKey,
  foldAgentActivity,
  type AgentActivityCandidate,
  type AgentActivityCategory,
  type AgentActivityFoldEntry,
} from "./agentActivityFold";

function candidate(
  category: AgentActivityCategory | null,
  patch: Partial<AgentActivityCandidate> = {},
): AgentActivityCandidate {
  return {
    stableId: null,
    category,
    running: false,
    settledOk: category !== null,
    ...patch,
  };
}

function tool(
  kind: "command" | "edit" | "read" | "search" | "web",
  patch: Partial<AgentActivityCandidate> = {},
): AgentActivityCandidate {
  return candidate({ kind }, patch);
}

function groups(
  entries: ReadonlyArray<AgentActivityFoldEntry>,
): ReadonlyArray<Extract<AgentActivityFoldEntry, { kind: "group" }>> {
  return entries.filter((entry) => entry.kind === "group");
}

describe("foldAgentActivity", () => {
  it("folds a mixed run of tool kinds into one group with first-appearance counts", () => {
    const entries = foldAgentActivity([
      tool("search"),
      tool("read"),
      tool("command"),
      tool("read"),
      candidate({ kind: "integration", server: "chrome" }),
    ]);
    expect(entries).toHaveLength(1);
    const [group] = groups(entries);
    expect([group.start, group.end]).toEqual([0, 5]);
    expect(
      group.categories.map(({ category, count }) => [agentActivityCategoryKey(category), count]),
    ).toEqual([
      ["search", 1],
      ["read", 2],
      ["command", 1],
      ["mcp:chrome", 1],
    ]);
  });

  it("returns no entries for an empty turn", () => {
    expect(foldAgentActivity([])).toEqual([]);
  });

  it("breaks a run on every non-groupable item and keeps its position", () => {
    const entries = foldAgentActivity([
      tool("command"),
      tool("read"),
      candidate(null),
      tool("command"),
      tool("edit"),
    ]);
    expect(
      entries.map((entry) => [entry.kind, entry.kind === "group" ? entry.start : entry.index]),
    ).toEqual([
      ["group", 0],
      ["item", 2],
      ["group", 3],
    ]);
  });

  it("keeps a single groupable activity as a plain item", () => {
    expect(foldAgentActivity([candidate(null), tool("read"), candidate(null)])).toEqual([
      { kind: "item", index: 0 },
      { kind: "item", index: 1 },
      { kind: "item", index: 2 },
    ]);
  });

  it("counts running activities and never reports completion without result telemetry", () => {
    const [group] = groups(
      foldAgentActivity([
        tool("command", { running: true, settledOk: false }),
        tool("command", { settledOk: false }),
        tool("read", { settledOk: true }),
      ]),
    );
    expect([group.running, group.completed]).toEqual([1, 1]);
  });

  it("keys a group by the first member's stable id across a prefix rebuild", () => {
    const run = [
      tool("read", { stableId: "call-a" }),
      tool("command", { stableId: "call-b" }),
      tool("read", { stableId: "call-c" }),
    ];
    const [initial] = groups(foldAgentActivity(run));
    const [rebuilt] = groups(foldAgentActivity([candidate(null), candidate(null), ...run]));
    expect(initial.stableId).toBe("call-a");
    expect(rebuilt.stableId).toBe("call-a");
    expect(rebuilt.start).toBe(2);
  });

  it("falls back to no stable id when the first member has none", () => {
    const [group] = groups(foldAgentActivity([tool("read"), tool("command", { stableId: "b" })]));
    expect(group.stableId).toBeNull();
  });

  it("folds a 10k activity turn into a bounded number of entries quickly", () => {
    const kinds = ["command", "read", "search", "edit", "web"] as const;
    const candidates = Array.from({ length: 10_000 }, (_, index) =>
      index % 500 === 499 ? candidate(null) : tool(kinds[index % kinds.length]),
    );
    const started = performance.now();
    const entries = foldAgentActivity(candidates);
    const elapsed = performance.now() - started;
    expect(groups(entries)).toHaveLength(20);
    expect(entries).toHaveLength(40);
    expect(elapsed).toBeLessThan(250);
  });
});

describe("agentActivityCategoryKey", () => {
  it("maps every category to a stable key", () => {
    expect(
      (
        [
          { kind: "command" },
          { kind: "edit" },
          { kind: "read" },
          { kind: "search" },
          { kind: "web" },
          { kind: "integration", server: "atlassian" },
        ] as const
      ).map(agentActivityCategoryKey),
    ).toEqual(["command", "edit", "read", "search", "web", "mcp:atlassian"]);
  });

  it("rejects an unknown category fail-closed", () => {
    expect(() =>
      agentActivityCategoryKey({ kind: "browser" } as unknown as AgentActivityCategory),
    ).toThrow(TypeError);
  });
});
