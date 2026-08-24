import { describe, expect, it } from "vitest";
import { MAX_AGENT_EVENT_TEXT_BYTES, MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentThread";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson";
import { utf8ByteLength } from "./utf8Text";

const SESSION_ID = "e49e4ab6-b1c3-4d26-9c2c-601ac23714f7";

function line(value: unknown): string {
  return JSON.stringify(value);
}

function assistant(content: ReadonlyArray<unknown>): string {
  return line({
    type: "assistant",
    session_id: SESSION_ID,
    message: { role: "assistant", content },
  });
}

describe("parseClaudeStreamJsonLine session ids", () => {
  it("captures the session id from the init system line without an event", () => {
    const parsed = parseClaudeStreamJsonLine(
      line({ type: "system", subtype: "init", session_id: SESSION_ID }),
    );

    expect(parsed).toEqual({ kind: "events", events: [], sessionId: SESSION_ID });
  });

  it("ignores hook system lines", () => {
    expect(parseClaudeStreamJsonLine(line({ type: "system", subtype: "hook_started" }))).toEqual({
      kind: "ignored",
    });
    expect(
      parseClaudeStreamJsonLine(line({ type: "system", subtype: "hook_response", exit_code: 0 })),
    ).toEqual({ kind: "ignored" });
  });

  it("drops a malformed session id", () => {
    for (const malformed of ["-dash-leading-id", "short", "", 42, null, `${"a".repeat(129)}`]) {
      expect(
        parseClaudeStreamJsonLine(line({ type: "system", subtype: "init", session_id: malformed })),
      ).toEqual({ kind: "ignored" });
    }
  });

  it("drops a malformed session id on the result line but keeps the result event", () => {
    const parsed = parseClaudeStreamJsonLine(
      line({ type: "result", subtype: "success", result: "done", session_id: "no" }),
    );

    expect(parsed).toEqual({
      kind: "events",
      events: [{ kind: "result", text: "done", isError: false, usage: null }],
      sessionId: null,
    });
  });
});

describe("parseClaudeStreamJsonLine content", () => {
  it("maps text, thinking, and tool_use blocks in order", () => {
    const parsed = parseClaudeStreamJsonLine(
      assistant([
        { type: "thinking", thinking: "weighing it" },
        { type: "text", text: "on it" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "echo hi", description: "greet" },
        },
      ]),
    );

    expect(parsed).toEqual({
      kind: "events",
      events: [
        { kind: "reasoning", text: "weighing it" },
        { kind: "assistantText", text: "on it" },
        { kind: "toolCall", toolId: "toolu_1", name: "Bash", inputSummary: "echo hi" },
      ],
      sessionId: null,
    });
  });

  it("skips unknown blocks and tool calls without a safe id or name", () => {
    const parsed = parseClaudeStreamJsonLine(
      assistant([
        { type: "image", source: {} },
        { type: "tool_use", id: "", name: "Bash", input: {} },
        { type: "tool_use", id: "toolu_2", name: "Bash", input: {} },
        { type: "text", text: "" },
      ]),
    );

    expect(parsed).toEqual({ kind: "events", events: [], sessionId: null });
  });

  it("maps tool results with string and text-block content", () => {
    const stringResult = parseClaudeStreamJsonLine(
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { tool_use_id: "toolu_1", type: "tool_result", content: "ok", is_error: false },
          ],
        },
      }),
    );
    const blockResult = parseClaudeStreamJsonLine(
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_2",
              type: "tool_result",
              content: [{ type: "text", text: "boom" }],
              is_error: true,
            },
          ],
        },
      }),
    );

    expect(stringResult).toEqual({
      kind: "events",
      events: [{ kind: "toolResult", toolId: "toolu_1", outputSummary: "ok", isError: false }],
      sessionId: null,
    });
    expect(blockResult).toEqual({
      kind: "events",
      events: [{ kind: "toolResult", toolId: "toolu_2", outputSummary: "boom", isError: true }],
      sessionId: null,
    });
  });

  it("marks a failed result and reports usage only when both counters are present", () => {
    const failed = parseClaudeStreamJsonLine(
      line({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "boom",
        session_id: SESSION_ID,
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    );
    const partialUsage = parseClaudeStreamJsonLine(
      line({ type: "result", subtype: "success", result: "done", usage: { input_tokens: 5 } }),
    );

    expect(failed).toEqual({
      kind: "events",
      events: [
        { kind: "result", text: "boom", isError: true, usage: { inputTokens: 5, outputTokens: 7 } },
      ],
      sessionId: SESSION_ID,
    });
    expect(partialUsage).toEqual({
      kind: "events",
      events: [{ kind: "result", text: "done", isError: false, usage: null }],
      sessionId: null,
    });
  });

  it("treats a non-success subtype as an error even without is_error", () => {
    const parsed = parseClaudeStreamJsonLine(line({ type: "result", subtype: "error_max_turns" }));

    expect(parsed).toEqual({
      kind: "events",
      events: [{ kind: "result", text: "", isError: true, usage: null }],
      sessionId: null,
    });
  });
});

describe("parseClaudeStreamJsonLine bounds and fail-closed handling", () => {
  it("ignores unknown line types", () => {
    expect(
      parseClaudeStreamJsonLine(line({ type: "rate_limit_event", rate_limit_info: {} })),
    ).toEqual({ kind: "ignored" });
    expect(parseClaudeStreamJsonLine(line({ type: "stream_event" }))).toEqual({ kind: "ignored" });
  });

  it("reports non-JSON and non-object lines as unknown", () => {
    expect(parseClaudeStreamJsonLine("not json")).toEqual({ kind: "unknown", raw: "not json" });
    expect(parseClaudeStreamJsonLine("[1,2]")).toEqual({ kind: "unknown", raw: "[1,2]" });
  });

  it("ignores a known type with an unusable message shape", () => {
    expect(parseClaudeStreamJsonLine(line({ type: "assistant", message: "hi" }))).toEqual({
      kind: "ignored",
    });
    expect(parseClaudeStreamJsonLine(line({ type: "user", message: { content: "hi" } }))).toEqual({
      kind: "ignored",
    });
  });

  it("bounds assistant text on a UTF-8 boundary", () => {
    const parsed = parseClaudeStreamJsonLine(
      assistant([{ type: "text", text: "€".repeat(MAX_AGENT_EVENT_TEXT_BYTES) }]),
    );

    expect(parsed.kind).toBe("events");
    const event = parsed.kind === "events" ? parsed.events[0] : null;
    expect(event?.kind).toBe("assistantText");
    const text = event !== null && event.kind === "assistantText" ? event.text : "";
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(MAX_AGENT_EVENT_TEXT_BYTES);
    expect(text.includes("�")).toBe(false);
    expect(text).toBe("€".repeat(Math.floor(MAX_AGENT_EVENT_TEXT_BYTES / 3)));
  });

  it("bounds tool summaries on a UTF-8 boundary", () => {
    const parsed = parseClaudeStreamJsonLine(
      assistant([
        {
          type: "tool_use",
          id: "toolu_3",
          name: "Bash",
          input: { command: "€".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES) },
        },
      ]),
    );

    const event = parsed.kind === "events" ? parsed.events[0] : null;
    const summary = event !== null && event.kind === "toolCall" ? event.inputSummary : "";
    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(MAX_AGENT_TOOL_SUMMARY_BYTES);
    expect(summary).toBe("€".repeat(Math.floor(MAX_AGENT_TOOL_SUMMARY_BYTES / 3)));
  });
});
