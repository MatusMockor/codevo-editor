import { describe, expect, it } from "vitest";
import { toolRowKind } from "../../domain/agentToolRowPresentation";
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

function read(index: number, patch: Partial<AgentActivityTool> = {}): AgentActivityTool {
  return activityTool(index, { name: "Read", rowKind: "read", inputSummary: "a.ts", ...patch });
}

function search(index: number, patch: Partial<AgentActivityTool> = {}): AgentActivityTool {
  return activityTool(index, { name: "Grep", rowKind: "search", inputSummary: "todo", ...patch });
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
      ["group", "group:tool-0"],
      ["item", "e2"],
      ["item", "e3"],
      ["item", "e4"],
      ["item", "e5"],
      ["item", "e6"],
      ["group", "group:tool-7"],
    ]);
    expect(agentActivityAttentionCount(items)).toBe(1);
  });

  it("folds an adjacent run of different tool kinds into one summarized group", () => {
    const entries = agentActivityEntries([
      search(0),
      read(1),
      activityTool(2),
      read(3),
      activityTool(4),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "group",
      key: "group:tool-0",
      category: "read",
      label: "1 search · 2 file reads · 2 commands",
    });
  });

  it("keeps interleaved parallel subagent activities inside one adjacent run", () => {
    const entries = agentActivityEntries([
      activityTool(0),
      read(1, { parentToolId: "a" }),
      activityTool(2, { parentToolId: "a" }),
      search(3, { parentToolId: "b" }),
      activityTool(4),
    ]);
    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([["group", "group:tool-0"]]);
    const [group] = entries;
    expect(group.kind === "group" && group.items.map((item) => item.parentToolId)).toEqual([
      undefined,
      "a",
      "a",
      "b",
      undefined,
    ]);
    expect(group).toMatchObject({ label: "3 commands · 1 file read · 1 search" });
  });

  it("recognizes both MCP transports and counts each integration separately", () => {
    const rows = [
      activityTool(0, { name: "mcp__chrome__navigate", rowKind: "other" }),
      activityTool(1, { name: "mcp__chrome__snapshot", rowKind: "other" }),
      activityTool(2, { name: "atlassian/search", rowKind: "other" }),
      activityTool(3, { name: "atlassian/read", rowKind: "other" }),
    ];
    expect(
      agentActivityEntries(rows).map((entry) => entry.kind === "group" && entry.label),
    ).toEqual(["2 chrome calls · 2 atlassian calls"]);
  });

  it("bounds a summary that mixes many integrations instead of listing every server", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].map((server, index) =>
      activityTool(index, { name: `mcp__${server}__call`, rowKind: "other" }),
    );
    expect(agentActivityEntries(rows)[0]).toMatchObject({
      kind: "group",
      label: "1 a call · 1 b call · 1 c call · 1 d call · +2 more",
    });
  });

  it("keeps the single-integration headline when a run uses one server", () => {
    const rows = [
      activityTool(0, { name: "mcp__chrome__navigate", rowKind: "other" }),
      activityTool(1, { name: "mcp__chrome__snapshot", rowKind: "other" }),
    ];
    expect(agentActivityEntries(rows)[0]).toMatchObject({
      category: "mcp:chrome",
      label: "Used chrome · 2 calls",
    });
  });

  it("counts edits as operations without inventing distinct file or diff counts", () => {
    const edits = [0, 1].map((index) =>
      activityTool(index, { name: "Edit", rowKind: "edit", inputSummary: "same.ts" }),
    );
    expect(agentActivityEntries(edits)[0]).toMatchObject({ kind: "group", label: "2 file edits" });
  });

  it("reports running work and never claims completion without result telemetry", () => {
    const entries = agentActivityEntries([
      activityTool(0, { status: "running", outcome: null }),
      read(1, { outcome: null }),
      search(2),
    ]);
    expect(entries[0]).toMatchObject({
      kind: "group",
      running: 1,
      completed: 1,
      label: "1 command · 1 file read · 1 search",
    });
  });

  it("keeps a running-only command run in the present tense", () => {
    const entries = agentActivityEntries([
      activityTool(0, { status: "running", outcome: null }),
      activityTool(1, { status: "running", outcome: null }),
    ]);
    expect(entries[0]).toMatchObject({ label: "Running 2 commands", running: 2, completed: 0 });
  });

  it("labels web requests and falls back to the item key without a tool id", () => {
    const entries = agentActivityEntries([
      activityTool(0, { name: "WebFetch", rowKind: "web", toolId: "" }),
      activityTool(1, { name: "WebSearch", rowKind: "web", toolId: "" }),
    ]);
    expect(entries[0]).toMatchObject({ key: "e0", category: "web", label: "2 web requests" });
  });

  it("folds a 10k activity turn into bounded entries without quadratic cost", () => {
    const items = Array.from({ length: 10_000 }, (_, index) =>
      index % 1_000 === 999
        ? activityTool(index, { status: "error" })
        : activityTool(index, index % 3 === 0 ? { name: "Read", rowKind: "read" } : {}),
    );
    const started = performance.now();
    const entries = agentActivityEntries(items);
    const elapsed = performance.now() - started;
    expect(entries.filter((entry) => entry.kind === "group")).toHaveLength(10);
    expect(entries).toHaveLength(20);
    expect(elapsed).toBeLessThan(500);
  });

  it("keeps unknown tools separate", () => {
    expect(
      agentActivityEntries([
        activityTool(0, { name: "Skill", rowKind: "other" }),
        activityTool(1, { name: "Skill", rowKind: "other" }),
      ]).every((entry) => entry.kind === "item"),
    ).toBe(true);
  });

  it("keeps group keys stable when earlier conversation is prepended", () => {
    const run = [search(7), read(8), activityTool(9)];
    const initial = agentActivityEntries(run);
    const rebuilt = agentActivityEntries([
      { kind: "assistantText" as const, key: "e0", text: "Start", paragraphs: ["Start"] },
      ...run.map((item, offset) => ({ ...item, key: `e${offset + 1}` })),
    ]);
    expect(initial[0].key).toBe("group:tool-7");
    expect(rebuilt[1].key).toBe("group:tool-7");
  });

  it("produces identical groups for every provider and environment combination", () => {
    const names = {
      claude: ["Grep", "Read", "Bash", "mcp__chrome__navigate", "Bash"],
      codex: ["file_search", "read_file", "shell", "chrome/navigate", "local_shell"],
    } as const;
    const combination = (provider: "claude" | "codex") =>
      agentActivityEntries([
        ...names[provider].map((name, index) =>
          activityTool(index, { name, rowKind: toolRowKind(name) }),
        ),
        activityTool(5, {
          name: names[provider][2],
          rowKind: toolRowKind(names[provider][2]),
          status: "error",
        }),
      ]);
    const shape = (entries: ReturnType<typeof agentActivityEntries>) =>
      entries.map((entry) =>
        entry.kind === "group"
          ? [entry.kind, entry.key, entry.category, entry.label, entry.items.length]
          : [entry.kind, entry.key],
      );
    const runs = [
      combination("claude"),
      combination("claude"),
      combination("codex"),
      combination("codex"),
    ].map(shape);
    for (const run of runs) expect(run).toEqual(runs[0]);
    expect(runs[0]).toEqual([
      [
        "group",
        "group:tool-0",
        "command",
        "1 search · 1 file read · 2 commands · 1 chrome call",
        5,
      ],
      ["item", "e5"],
    ]);
  });
});
