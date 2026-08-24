import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentThread";
import { MAX_CODEX_EMITTED_ITEM_IDS, parseCodexJsonlLine } from "./codexJsonl";
import type { ParsedAgentLine } from "./agentOutputParser";
import { utf8ByteLength } from "./utf8Text";

const THREAD_ID = "01a0359d-3e55-74e0-8bbf-e040d2f05f43";

function line(value: unknown): string {
  return JSON.stringify(value);
}

function parseAll(lines: ReadonlyArray<unknown>): {
  readonly results: ReadonlyArray<ParsedAgentLine>;
  readonly state: ReadonlySet<string>;
} {
  let state: ReadonlySet<string> = new Set();
  const results: ParsedAgentLine[] = [];
  for (const value of lines) {
    const parsed = parseCodexJsonlLine(line(value), state);
    state = parsed.state;
    results.push(parsed.result);
  }
  return { results, state };
}

describe("parseCodexJsonlLine session ids", () => {
  it("captures the thread id from thread.started without an event", () => {
    expect(
      parseCodexJsonlLine(line({ type: "thread.started", thread_id: THREAD_ID }), new Set()).result,
    ).toEqual({ kind: "events", events: [], sessionId: THREAD_ID });
  });

  it("drops a malformed thread id", () => {
    for (const malformed of ["-leading", "tiny", 7, null]) {
      expect(
        parseCodexJsonlLine(line({ type: "thread.started", thread_id: malformed }), new Set())
          .result,
      ).toEqual({ kind: "ignored" });
    }
  });
});

describe("parseCodexJsonlLine items", () => {
  it("emits an agent message only on completion", () => {
    const parsed = parseAll([
      { type: "item.started", item: { id: "item_1", type: "agent_message", text: "done" } },
      { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "done" } },
    ]);

    expect(parsed.results).toEqual([
      { kind: "ignored" },
      { kind: "events", events: [{ kind: "assistantText", text: "done" }], sessionId: null },
    ]);
  });

  it("emits reasoning only on completion", () => {
    const parsed = parseAll([
      { type: "item.completed", item: { id: "item_2", type: "reasoning", text: "thinking" } },
    ]);

    expect(parsed.results).toEqual([
      { kind: "events", events: [{ kind: "reasoning", text: "thinking" }], sessionId: null },
    ]);
  });

  it("emits the shell tool call once and the tool result on completion", () => {
    const item = {
      id: "item_3",
      type: "command_execution",
      command: "ls -la",
      aggregated_output: "a.txt\n",
      exit_code: 0,
      status: "completed",
    };
    const parsed = parseAll([
      { type: "item.started", item: { ...item, exit_code: null, status: "in_progress" } },
      { type: "item.completed", item },
      { type: "item.completed", item },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [{ kind: "toolCall", toolId: "item_3", name: "shell", inputSummary: "ls -la" }],
        sessionId: null,
      },
      {
        kind: "events",
        events: [
          { kind: "toolResult", toolId: "item_3", outputSummary: "a.txt\n", isError: false },
        ],
        sessionId: null,
      },
      {
        kind: "events",
        events: [
          { kind: "toolResult", toolId: "item_3", outputSummary: "a.txt\n", isError: false },
        ],
        sessionId: null,
      },
    ]);
    expect(parsed.state.has("item_3")).toBe(true);
  });

  it("emits the tool call from a completion that had no start", () => {
    const parsed = parseAll([
      {
        type: "item.completed",
        item: {
          id: "item_4",
          type: "command_execution",
          command: "false",
          aggregated_output: "",
          exit_code: 3,
        },
      },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [
          { kind: "toolCall", toolId: "item_4", name: "shell", inputSummary: "false" },
          { kind: "toolResult", toolId: "item_4", outputSummary: "", isError: true },
        ],
        sessionId: null,
      },
    ]);
  });

  it("treats a missing exit code as a failed command", () => {
    const parsed = parseAll([
      {
        type: "item.completed",
        item: { id: "item_5", type: "command_execution", command: "x", aggregated_output: "" },
      },
    ]);
    const events = parsed.results[0].kind === "events" ? parsed.results[0].events : [];

    expect(events[1]).toEqual({
      kind: "toolResult",
      toolId: "item_5",
      outputSummary: "",
      isError: true,
    });
  });

  it("emits a file change once with the joined paths", () => {
    const item = {
      id: "item_6",
      type: "file_change",
      changes: [
        { path: "/repo/a.txt", kind: "update" },
        { path: "/repo/b.txt", kind: "add" },
      ],
      status: "completed",
    };
    const parsed = parseAll([
      { type: "item.started", item },
      { type: "item.completed", item },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [
          {
            kind: "toolCall",
            toolId: "item_6",
            name: "apply_patch",
            inputSummary: "/repo/a.txt, /repo/b.txt",
          },
        ],
        sessionId: null,
      },
      { kind: "ignored" },
    ]);
  });

  it("maps mcp tool calls and web searches once each", () => {
    const parsed = parseAll([
      {
        type: "item.started",
        item: { id: "item_7", type: "mcp_tool_call", server: "atlassian", tool: "search" },
      },
      {
        type: "item.completed",
        item: { id: "item_7", type: "mcp_tool_call", server: "atlassian", tool: "search" },
      },
      { type: "item.started", item: { id: "item_8", type: "web_search", query: "codex jsonl" } },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [
          { kind: "toolCall", toolId: "item_7", name: "atlassian/search", inputSummary: "" },
        ],
        sessionId: null,
      },
      { kind: "ignored" },
      {
        kind: "events",
        events: [
          { kind: "toolCall", toolId: "item_8", name: "web_search", inputSummary: "codex jsonl" },
        ],
        sessionId: null,
      },
    ]);
  });

  it("emits a non-fatal error item once", () => {
    const item = { id: "item_9", type: "error", message: "hook trust bypassed" };
    const parsed = parseAll([
      { type: "item.completed", item },
      { type: "item.completed", item },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [{ kind: "error", message: "hook trust bypassed" }],
        sessionId: null,
      },
      { kind: "ignored" },
    ]);
  });

  it("ignores items without a safe id and unknown item types", () => {
    const parsed = parseAll([
      { type: "item.started", item: { type: "command_execution", command: "ls" } },
      { type: "item.completed", item: { id: "item_10", type: "todo_list", items: [] } },
      { type: "item.updated", item: { id: "item_11", type: "agent_message", text: "hi" } },
    ]);

    expect(parsed.results).toEqual([{ kind: "ignored" }, { kind: "ignored" }, { kind: "ignored" }]);
  });
});

describe("parseCodexJsonlLine turns", () => {
  it("maps turn.completed to a result with usage and ignores turn.started", () => {
    const parsed = parseAll([
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 },
      },
    ]);

    expect(parsed.results).toEqual([
      { kind: "ignored" },
      {
        kind: "events",
        events: [
          { kind: "result", text: "", isError: false, usage: { inputTokens: 12, outputTokens: 4 } },
        ],
        sessionId: null,
      },
    ]);
  });

  it("maps turn.failed to a failed result without usage", () => {
    const parsed = parseAll([{ type: "turn.failed", error: { message: "rate limited" } }]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [{ kind: "result", text: "rate limited", isError: true, usage: null }],
        sessionId: null,
      },
    ]);
  });

  it("maps a top level error line", () => {
    const parsed = parseAll([{ type: "error", message: "stream closed" }]);

    expect(parsed.results).toEqual([
      { kind: "events", events: [{ kind: "error", message: "stream closed" }], sessionId: null },
    ]);
  });
});

describe("parseCodexJsonlLine bounds and fail-closed handling", () => {
  it("reports non-JSON and non-object lines as unknown", () => {
    expect(parseCodexJsonlLine("boom", new Set()).result).toEqual({ kind: "unknown", raw: "boom" });
    expect(parseCodexJsonlLine("[]", new Set()).result).toEqual({ kind: "unknown", raw: "[]" });
  });

  it("ignores unknown line types", () => {
    expect(parseCodexJsonlLine(line({ type: "thread.finished" }), new Set()).result).toEqual({
      kind: "ignored",
    });
  });

  it("bounds command summaries on a UTF-8 boundary", () => {
    const parsed = parseAll([
      {
        type: "item.started",
        item: {
          id: "item_12",
          type: "command_execution",
          command: "€".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES),
        },
      },
    ]);
    const events = parsed.results[0].kind === "events" ? parsed.results[0].events : [];
    const summary = events[0]?.kind === "toolCall" ? events[0].inputSummary : "";

    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summary).toBe("€".repeat(Math.floor(MAX_AGENT_TOOL_SUMMARY_BYTES / 3)));
  });

  it("keeps the emitted item id set bounded and still deduplicates recent ids", () => {
    let state: ReadonlySet<string> = new Set();
    for (let index = 0; index < MAX_CODEX_EMITTED_ITEM_IDS + 16; index += 1) {
      const parsed = parseCodexJsonlLine(
        line({
          type: "item.started",
          item: { id: `item_${index}`, type: "command_execution", command: "ls" },
        }),
        state,
      );
      state = parsed.state;
    }

    expect(state.size).toBe(MAX_CODEX_EMITTED_ITEM_IDS);
    expect(state.has("item_0")).toBe(false);
    expect(state.has(`item_${MAX_CODEX_EMITTED_ITEM_IDS + 15}`)).toBe(true);

    const repeated = parseCodexJsonlLine(
      line({
        type: "item.completed",
        item: {
          id: `item_${MAX_CODEX_EMITTED_ITEM_IDS + 15}`,
          type: "command_execution",
          command: "ls",
          aggregated_output: "",
          exit_code: 0,
        },
      }),
      state,
    );
    const events = repeated.result.kind === "events" ? repeated.result.events : [];

    expect(events).toEqual([
      {
        kind: "toolResult",
        toolId: `item_${MAX_CODEX_EMITTED_ITEM_IDS + 15}`,
        outputSummary: "",
        isError: false,
      },
    ]);
  });
});
