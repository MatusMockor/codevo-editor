import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  type AgentTurnEvent,
} from "../agentThread";
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
        {
          kind: "result",
          text: "boom",
          isError: true,
          usage: { inputTokens: 5, outputTokens: 7, contextTokens: 5 },
        },
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
    ).toEqual({
      kind: "ignored",
    });
    expect(parseClaudeStreamJsonLine(line({ type: "stream_event" }))).toEqual({ kind: "ignored" });
  });

  it("parses all valid Claude subscription windows without exposing them as chat events", () => {
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "rate_limit_event",
          rate_limit_info: {
            rateLimitType: "five_hour",
            utilization: 0.2,
            resetsAt: 1_786_200_000,
            unifiedWindows: {
              five_hour: { utilization: 0.2, resetsAt: 1_786_200_000 },
              seven_day: { utilization: 0.615, resetsAt: 1_786_500_000 },
              seven_day_overage_included: {
                utilization: 0.27,
                resetsAt: 1_786_500_000,
              },
            },
          },
        }),
      ),
    ).toEqual({
      kind: "accountUsage",
      observation: {
        provider: "claudeCode",
        windows: [
          {
            id: "five_hour",
            label: "5-hour limit",
            usedPercent: 20,
            windowDurationMinutes: 300,
            resetsAtEpochMs: 1_786_200_000_000,
            resetsLabel: null,
          },
          {
            id: "seven_day",
            label: "Weekly limit",
            usedPercent: 61.5,
            windowDurationMinutes: 10_080,
            resetsAtEpochMs: 1_786_500_000_000,
            resetsLabel: null,
          },
          {
            id: "seven_day_fable",
            label: "Weekly Fable limit",
            usedPercent: 27,
            windowDurationMinutes: 10_080,
            resetsAtEpochMs: 1_786_500_000_000,
            resetsLabel: null,
          },
        ],
      },
    });
  });

  it("falls back to Claude's representative window and rejects invalid utilization", () => {
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "rate_limit_event",
          rate_limit_info: { rateLimitType: "seven_day", utilization: 0.81, resetsAt: null },
        }),
      ),
    ).toMatchObject({
      kind: "accountUsage",
      observation: { windows: [{ id: "seven_day", usedPercent: 81 }] },
    });
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "rate_limit_event",
          rate_limit_info: { rateLimitType: "five_hour", utilization: 4 },
        }),
      ),
    ).toEqual({ kind: "ignored" });
  });

  it("reports non-JSON and non-object lines as unknown", () => {
    expect(parseClaudeStreamJsonLine("not json")).toEqual({ kind: "unknown", raw: "not json" });
    expect(parseClaudeStreamJsonLine("[1,2]")).toEqual({ kind: "unknown", raw: "[1,2]" });
  });

  it("maps a compact boundary to a visible context event", () => {
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "system",
          subtype: "compact_boundary",
          session_id: "session-1",
          compact_metadata: { pre_tokens: 130_000, post_tokens: 41_000 },
        }),
      ),
    ).toEqual({
      kind: "events",
      events: [{ kind: "contextCompaction", beforeTokens: 130_000, afterTokens: 41_000 }],
      sessionId: "session-1",
    });
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

const PARENT_TOOL_ID = "toolu_0178BjWfKajSpcXTHr9LFppE";
const TASK_ID = "ab3bc0126d64bc47c";

function fixtureEvents(): ReadonlyArray<AgentTurnEvent> {
  const path = join(process.cwd(), "src", "domain", "agentOutput", "fixtures");
  return readFileSync(join(path, "claude-subagent-turn.jsonl"), "utf8")
    .split("\n")
    .filter((raw) => raw.trim() !== "")
    .flatMap((raw) => {
      const parsed = parseClaudeStreamJsonLine(raw);
      return parsed.kind === "events" ? parsed.events : [];
    });
}

describe("parseClaudeStreamJsonLine subagent telemetry", () => {
  it("parses the captured subagent turn into spawn, telemetry and parented steps", () => {
    const events = fixtureEvents();

    expect(events.slice(0, 7)).toEqual([
      {
        kind: "toolCall",
        toolId: PARENT_TOOL_ID,
        name: "Agent",
        inputSummary: "Spustiť echo alpha",
      },
      {
        kind: "subagent",
        status: "starting",
        toolId: PARENT_TOOL_ID,
        taskId: TASK_ID,
        subagentType: "general-purpose",
        description: "Spustiť echo alpha",
      },
      {
        kind: "subagent",
        status: "running",
        toolId: PARENT_TOOL_ID,
        taskId: TASK_ID,
        subagentType: "general-purpose",
        description: "Running Echo the string alpha",
        durationMs: 2_450,
        totalTokens: 23_111,
        toolUses: 1,
        lastToolName: "Bash",
      },
      {
        kind: "toolCall",
        toolId: "toolu_01XEYBXi9WLdjWVeAnfpx1QT",
        name: "Bash",
        inputSummary: "echo alpha",
        parentToolId: PARENT_TOOL_ID,
      },
      {
        kind: "toolResult",
        toolId: "toolu_01XEYBXi9WLdjWVeAnfpx1QT",
        outputSummary: "alpha",
        isError: false,
        parentToolId: PARENT_TOOL_ID,
      },
      { kind: "subagent", status: "completed", taskId: TASK_ID },
      {
        kind: "subagent",
        status: "completed",
        toolId: PARENT_TOOL_ID,
        taskId: TASK_ID,
        durationMs: 4_286,
        totalTokens: 23_949,
        toolUses: 1,
      },
    ]);
    expect(events[7]).toMatchObject({
      kind: "toolResult",
      toolId: PARENT_TOOL_ID,
      isError: false,
    });
    expect(events[8]).toEqual({
      kind: "subagent",
      status: "completed",
      toolId: PARENT_TOOL_ID,
      taskId: TASK_ID,
      subagentType: "general-purpose",
      durationMs: 4_288,
      totalTokens: 23_956,
      toolUses: 1,
    });
    expect(events).toHaveLength(9);
  });

  it("summarises the spawn tool by its description instead of the whole prompt", () => {
    for (const name of ["Agent", "Task"]) {
      const parsed = parseClaudeStreamJsonLine(
        assistant([
          {
            type: "tool_use",
            id: "toolu_spawn",
            name,
            input: { description: "Review UI", prompt: "a".repeat(4_096), subagent_type: "x" },
          },
        ]),
      );

      const event = parsed.kind === "events" ? parsed.events[0] : null;
      expect(event).toEqual({
        kind: "toolCall",
        toolId: "toolu_spawn",
        name,
        inputSummary: "Review UI",
      });
    }
  });

  it("drops task telemetry without an identity, with an unknown status or malformed metrics", () => {
    const dropped = [
      { type: "system", subtype: "task_started", description: "no ids" },
      { type: "system", subtype: "task_updated", task_id: TASK_ID, patch: { status: "queued" } },
      { type: "system", subtype: "task_updated", task_id: TASK_ID, patch: "completed" },
      { type: "system", subtype: "task_notification", task_id: TASK_ID },
      { type: "system", subtype: "task_notification", task_id: TASK_ID, status: 7 },
      { type: "system", subtype: "task_finished", task_id: TASK_ID, status: "completed" },
    ];
    for (const value of dropped) {
      expect(parseClaudeStreamJsonLine(line(value))).toEqual({ kind: "ignored" });
    }

    const parsed = parseClaudeStreamJsonLine(
      line({
        type: "system",
        subtype: "task_progress",
        task_id: TASK_ID,
        subagent_type: "x".repeat(300),
        last_tool_name: "Bash",
        usage: { total_tokens: -1, tool_uses: 1.5, duration_ms: "2450" },
      }),
    );

    expect(parsed).toEqual({
      kind: "events",
      events: [{ kind: "subagent", status: "running", taskId: TASK_ID }],
      sessionId: null,
    });
  });

  it("drops a description the thread wire would refuse to load back", () => {
    const parsed = parseClaudeStreamJsonLine(
      line({
        type: "system",
        subtype: "task_started",
        task_id: TASK_ID,
        tool_use_id: PARENT_TOOL_ID,
        description: "before\u0000after",
      }),
    );

    expect(parsed).toEqual({
      kind: "events",
      events: [{ kind: "subagent", status: "starting", toolId: PARENT_TOOL_ID, taskId: TASK_ID }],
      sessionId: null,
    });
  });

  it("drops a final subagent result that is missing its agent identity or status", () => {
    const incomplete = [
      { agentId: TASK_ID, totalTokens: 10 },
      { agentType: "general-purpose", status: "completed" },
      { agentId: TASK_ID, agentType: "general-purpose", status: "unknown" },
    ];
    for (const toolUseResult of incomplete) {
      const parsed = parseClaudeStreamJsonLine(
        line({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
          },
          tool_use_result: toolUseResult,
        }),
      );

      expect(parsed).toEqual({
        kind: "events",
        events: [{ kind: "toolResult", toolId: "toolu_1", outputSummary: "ok", isError: false }],
        sessionId: null,
      });
    }
  });

  it("keeps a final subagent result that has no matching tool result block", () => {
    const parsed = parseClaudeStreamJsonLine(
      line({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "done" }] },
        tool_use_result: {
          status: "completed",
          agentId: TASK_ID,
          agentType: "general-purpose",
          totalDurationMs: 4_288,
          totalTokens: 23_956,
          totalToolUseCount: 1,
        },
      }),
    );

    expect(parsed).toEqual({
      kind: "events",
      events: [
        {
          kind: "subagent",
          status: "completed",
          taskId: TASK_ID,
          subagentType: "general-purpose",
          durationMs: 4_288,
          totalTokens: 23_956,
          toolUses: 1,
        },
      ],
      sessionId: null,
    });
  });
});

describe("subagent telemetry review regressions", () => {
  it("never binds a completion to a tool result it cannot identify", () => {
    const parsed = parseClaudeStreamJsonLine(
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_bash", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_agent", content: "done" },
          ],
        },
        tool_use_result: {
          status: "completed",
          agentId: TASK_ID,
          agentType: "general-purpose",
        },
      }),
    );
    const events = parsed.kind === "events" ? parsed.events : [];

    expect(events[2]).toEqual({
      kind: "subagent",
      status: "completed",
      taskId: TASK_ID,
      subagentType: "general-purpose",
    });
  });

  it("drops task telemetry for a task type the editor does not support", () => {
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "system",
          subtype: "task_started",
          task_id: TASK_ID,
          tool_use_id: PARENT_TOOL_ID,
          task_type: "remote_agent",
        }),
      ),
    ).toEqual({ kind: "ignored" });
    expect(
      parseClaudeStreamJsonLine(
        line({
          type: "system",
          subtype: "task_started",
          task_id: TASK_ID,
          tool_use_id: PARENT_TOOL_ID,
          task_type: "local_agent",
        }),
      ),
    ).toEqual({
      kind: "events",
      events: [{ kind: "subagent", status: "starting", toolId: PARENT_TOOL_ID, taskId: TASK_ID }],
      sessionId: null,
    });
  });
});
