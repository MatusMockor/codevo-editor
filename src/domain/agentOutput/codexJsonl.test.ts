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
          { kind: "toolResult", toolId: "item_4", outputSummary: "exit 3", isError: true },
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
      {
        kind: "events",
        events: [
          {
            kind: "toolResult",
            toolId: "item_6",
            outputSummary: "update /repo/a.txt\nadd /repo/b.txt",
            isError: false,
          },
        ],
        sessionId: null,
      },
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
      {
        kind: "events",
        events: [
          {
            kind: "toolResult",
            toolId: "item_7",
            outputSummary: "MCP call status unknown: <missing>",
            isError: true,
          },
        ],
        sessionId: null,
      },
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

  it("ignores items without a safe id and item updates", () => {
    const parsed = parseAll([
      { type: "item.started", item: { type: "command_execution", command: "ls" } },
      { type: "item.updated", item: { id: "item_11", type: "agent_message", text: "hi" } },
    ]);

    expect(parsed.results).toEqual([{ kind: "ignored" }, { kind: "ignored" }]);
  });

  it("reports unknown item types visibly once per item", () => {
    const item = { id: "item_12", type: "hologram", payload: "secret" };
    const parsed = parseAll([
      { type: "item.started", item },
      { type: "item.completed", item },
    ]);

    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [
          {
            kind: "unknownLine",
            stream: "stdout",
            raw: "Unsupported Codex exec item: hologram",
            clipped: false,
          },
        ],
        sessionId: null,
      },
      { kind: "ignored" },
    ]);
  });

  it("summarises a todo list as a bounded checklist row", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      text: `step ${index}`,
      completed: index === 0,
    }));
    const parsed = parseAll([
      { type: "item.started", item: { id: "todo_1", type: "todo_list", items } },
      { type: "item.completed", item: { id: "todo_1", type: "todo_list", items } },
    ]);

    const [started, completed] = parsed.results;
    expect(started).toMatchObject({
      kind: "events",
      events: [{ kind: "toolCall", toolId: "todo_1", name: "update_plan" }],
    });
    expect(completed).toMatchObject({
      kind: "events",
      events: [{ kind: "toolResult", toolId: "todo_1", isError: false }],
    });
    const call = started?.kind === "events" ? started.events[0] : undefined;
    expect(call?.kind === "toolCall" ? call.inputSummary : "").toMatch(
      /^\[x\] step 0\n\[ \] step 1\n/u,
    );
    expect(utf8ByteLength(call?.kind === "toolCall" ? call.inputSummary : "")).toBeLessThanOrEqual(
      MAX_AGENT_TOOL_SUMMARY_BYTES,
    );
  });

  it("settles failed patches, failed mcp calls, and web searches", () => {
    const parsed = parseAll([
      {
        type: "item.completed",
        item: {
          id: "patch_1",
          type: "file_change",
          changes: [{ path: "a.ts", kind: "add" }],
          status: "failed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "mcp_1",
          type: "mcp_tool_call",
          server: "s",
          tool: "t",
          status: "failed",
          error: { message: "denied" },
        },
      },
      {
        type: "item.completed",
        item: {
          id: "mcp_2",
          type: "mcp_tool_call",
          server: "s",
          tool: "t",
          status: "completed",
          result: { content: [{ type: "text", text: "ok" }, { type: "image" }] },
        },
      },
      { type: "item.completed", item: { id: "web_1", type: "web_search", query: "vitest" } },
    ]);

    const results = parsed.results.flatMap((result) =>
      result.kind === "events" ? result.events.filter((event) => event.kind === "toolResult") : [],
    );
    expect(results).toEqual([
      {
        kind: "toolResult",
        toolId: "patch_1",
        outputSummary: "patch failed\nadd a.ts",
        isError: true,
      },
      { kind: "toolResult", toolId: "mcp_1", outputSummary: "denied", isError: true },
      { kind: "toolResult", toolId: "mcp_2", outputSummary: "ok\n[image]", isError: false },
      { kind: "toolResult", toolId: "web_1", outputSummary: "vitest", isError: false },
    ]);
  });

  it("keeps the exit code and the failing tail of long command output", () => {
    const output = `${"ok line\n".repeat(400)}FAIL src/a.test.ts\n`;
    const parsed = parseAll([
      {
        type: "item.completed",
        item: {
          id: "cmd_1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: output,
          exit_code: 1,
          status: "failed",
        },
      },
    ]);

    const result = parsed.results[0];
    const event = result?.kind === "events" ? result.events[1] : undefined;
    const summary = event?.kind === "toolResult" ? event.outputSummary : "";
    expect(summary.startsWith("exit 1\nok line")).toBe(true);
    expect(summary.endsWith("FAIL src/a.test.ts\n")).toBe(true);
    expect(summary).toContain("bytes omitted");
    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(MAX_AGENT_TOOL_SUMMARY_BYTES);
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
          {
            kind: "result",
            text: "",
            isError: false,
            usage: { inputTokens: 12, outputTokens: 4, contextTokens: 12 },
          },
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

  it("maps a completed context compaction item once", () => {
    const parsed = parseAll([
      {
        type: "item.completed",
        item: {
          id: "compact-1",
          type: "context_compaction",
          pre_tokens: 140_000,
          post_tokens: 50_000,
        },
      },
      {
        type: "item.completed",
        item: {
          id: "compact-1",
          type: "context_compaction",
          pre_tokens: 140_000,
          post_tokens: 50_000,
        },
      },
    ]);
    expect(parsed.results).toEqual([
      {
        kind: "events",
        events: [{ kind: "contextCompaction", beforeTokens: 140_000, afterTokens: 50_000 }],
        sessionId: null,
      },
      { kind: "ignored" },
    ]);
  });
});

describe("parseCodexJsonlLine bounds and fail-closed handling", () => {
  it("reports non-JSON and non-object lines as unknown", () => {
    expect(parseCodexJsonlLine("boom", new Set()).result).toEqual({ kind: "unknown", raw: "boom" });
    expect(parseCodexJsonlLine("[]", new Set()).result).toEqual({ kind: "unknown", raw: "[]" });
  });

  it("reports unknown line types visibly and ignores known lifecycle lines", () => {
    expect(parseCodexJsonlLine(line({ type: "thread.finished" }), new Set()).result).toEqual({
      kind: "unknown",
      raw: "Unsupported Codex exec event: thread.finished",
    });
    expect(parseCodexJsonlLine(line({ type: 7 }), new Set()).result).toEqual({
      kind: "unknown",
      raw: "Unsupported Codex exec event: <invalid type>",
    });
    expect(parseCodexJsonlLine(line({ type: "turn.started" }), new Set()).result).toEqual({
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

describe("parseCodexJsonlLine completion status", () => {
  const completedResult = (item: Record<string, unknown>) => {
    const parsed = parseCodexJsonlLine(line({ type: "item.completed", item }), new Set()).result;
    const events = parsed.kind === "events" ? parsed.events : [];
    return events.find((event) => event.kind === "toolResult");
  };

  it.each([
    [undefined, "MCP call status unknown: <missing>"],
    ["in_progress", "MCP call did not finish"],
    ["paused", "MCP call status unknown: paused"],
    ["failed", "MCP call failed"],
  ])("treats an MCP completion with status %s as an error", (status, summary) => {
    expect(
      completedResult({ id: "m", type: "mcp_tool_call", server: "s", tool: "t", status }),
    ).toEqual({ kind: "toolResult", toolId: "m", outputSummary: summary, isError: true });
  });

  it.each([
    [undefined, "patch status unknown: <missing>"],
    ["in_progress", "patch did not finish"],
    ["declined", "patch declined"],
  ])("treats a file change completion with status %s as an error", (status, label) => {
    expect(
      completedResult({
        id: "p",
        type: "file_change",
        changes: [{ path: "a.ts", kind: "add" }],
        status,
      }),
    ).toEqual({
      kind: "toolResult",
      toolId: "p",
      outputSummary: `${label}\nadd a.ts`,
      isError: true,
    });
  });
});

describe("parseCodexJsonlLine MCP argument redaction", () => {
  it("redacts camelCase keys, header pairs, URL credentials, and bearer tokens", () => {
    const parsed = parseCodexJsonlLine(
      line({
        type: "item.started",
        item: {
          id: "m",
          type: "mcp_tool_call",
          server: "http",
          tool: "fetch",
          status: "in_progress",
          arguments: {
            privateKey: "pk-1",
            headers: [{ name: "X-Api-Key", value: "hk-2" }],
            url: "https://me:pw-3@api.example.com/v1",
            note: "Bearer tok-4-abcdef",
          },
        },
      }),
      new Set(),
    ).result;

    const call = parsed.kind === "events" ? parsed.events[0] : undefined;
    const summary = call?.kind === "toolCall" ? call.inputSummary : "";
    for (const secret of ["pk-1", "hk-2", "pw-3", "tok-4"]) expect(summary).not.toContain(secret);
    expect(summary).not.toContain("abcdef");
    expect(summary).toContain("https://me:[redacted]@api.example.com/v1");
    expect(summary).toContain("Bearer [redacted]");
  });
});
