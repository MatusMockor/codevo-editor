import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCodexAppServerLine } from "./codexAppServer";
import { createAgentOutputParserState, feedAgentOutput } from "./agentOutputParser";

const parse = (value: unknown) => parseCodexAppServerLine(JSON.stringify(value));
const assistant = { v: 1, t: "text", role: "assistant", text: "hello", clipped: false };

describe("Codex app-server projection parser", () => {
  it.each([
    { v: 1, t: "sessionFallback", previousThreadId: "old-session" },
    { v: 1, t: "sessionFallback", previousThreadId: "old-session", threadId: "old-session" },
    { v: 1, t: "sessionFallback", previousThreadId: "bad id", threadId: "new-session" },
    {
      v: 1,
      t: "sessionFallback",
      previousThreadId: "old-session",
      threadId: "new-session",
      extra: true,
    },
  ])("rejects malformed session fallback %#", (value) => {
    expect(parse(value).kind).toBe("unknown");
  });
  it.each(["session-basic", "session-subagent"])("accepts the Rust golden %s", (name) => {
    const lines = readFileSync(
      `src-tauri/tests/fixtures/codex_app_server/${name}.events.jsonl`,
      "utf8",
    )
      .trim()
      .split("\n");
    for (const line of lines)
      expect(parseCodexAppServerLine(line), line).not.toMatchObject({ kind: "unknown" });
  });
  it("keeps nested child output out of the parent text stream", () => {
    const { v: _v, ...inner } = assistant;
    expect(parse({ v: 1, t: "subagentItem", agentThreadId: "child", inner })).toEqual({
      kind: "events",
      sessionId: null,
      events: [
        {
          kind: "subagentEvent",
          agentThreadId: "child",
          event: { kind: "assistantText", text: "hello" },
        },
      ],
    });
  });
  it("selects app-server parsing explicitly and leaves exec parsing intact", () => {
    const result = feedAgentOutput(
      createAgentOutputParserState("codex", "appServer"),
      "stdout",
      JSON.stringify(assistant) + "\n",
    );
    expect(result.events).toEqual([{ kind: "assistantText", text: "hello" }]);
    expect(
      feedAgentOutput(
        createAgentOutputParserState("codex"),
        "stdout",
        JSON.stringify(assistant) + "\n",
      ).events,
    ).toEqual([]);
  });
  it.each([
    { ...assistant, v: 2 },
    { ...assistant, unexpected: true },
    { ...assistant, role: "system" },
    { ...assistant, text: "x".repeat(16385) },
    { ...assistant, clipped: 1 },
    { v: 1, t: "subagentItem", agentThreadId: "child", inner: { ...assistant } },
    {
      v: 1,
      t: "subagentItem",
      agentThreadId: "child",
      inner: { t: "subagentItem", agentThreadId: "nested", inner: assistant },
    },
    { v: 1, t: "subagentTurnCompleted", agentThreadId: "child", durationMs: -1, isError: false },
    { v: 1, t: "compaction", beforeTokens: 0, afterTokens: Number.MAX_SAFE_INTEGER + 1 },
    { v: 1, t: "new-variant" },
  ])("fails closed for invalid projection %#", (value) =>
    expect(parse(value).kind).toBe("unknown"),
  );
  it("exposes clipping instead of presenting complete output", () => {
    expect(parse({ ...assistant, clipped: true })).toMatchObject({
      kind: "events",
      events: [{ kind: "assistantText" }, { kind: "unknownLine", clipped: true }],
    });
  });
  it("preserves cumulative usage and its last-request context snapshot", () => {
    const last = {
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 0,
      outputTokens: 3,
      reasoningOutputTokens: 1,
      totalTokens: 13,
    };
    const total = { ...last, inputTokens: 100, outputTokens: 30, totalTokens: 130 };
    const usage = { last, total, contextWindow: 1000 };
    expect(
      parse({
        v: 1,
        t: "result",
        isError: false,
        durationMs: 250,
        text: "",
        clipped: false,
        usage,
      }),
    ).toMatchObject({
      kind: "events",
      events: [
        {
          kind: "result",
          durationMs: 250,
          usage: {
            inputTokens: 100,
            outputTokens: 30,
            contextTokens: 13,
            scope: "thread",
            appServerUsage: usage,
          },
        },
      ],
    });
    expect(parse({ v: 1, t: "usage", scope: "subagent", threadId: "child", usage })).toMatchObject({
      kind: "events",
      events: [{ kind: "subagentUsage", agentThreadId: "child", usage: { scope: "thread" } }],
    });
    expect(parse({ v: 1, t: "usage", scope: "thread", threadId: "root", usage })).toMatchObject({
      kind: "events",
      events: [],
    });
    expect(parse({ v: 1, t: "usage", scope: "other", threadId: "root", usage }).kind).toBe(
      "unknown",
    );
    expect(
      parse({
        v: 1,
        t: "usage",
        scope: "thread",
        threadId: "root",
        usage: { ...usage, last: { ...last, inputTokens: -1 } },
      }).kind,
    ).toBe("unknown");
  });
  it("accepts unnamed subagents emitted by the Rust projection", () => {
    expect(
      parse({
        v: 1,
        t: "subagent",
        kind: "started",
        agentThreadId: "child",
        agentPath: "",
        clipped: false,
      }),
    ).toMatchObject({ kind: "events", events: [{ kind: "subagentActivity", agentPath: "" }] });
  });
  it("keeps queue association and safe session identity", () => {
    expect(
      parse({ v: 1, t: "queued", threadId: "root", clientUserMessageId: "message-1" }),
    ).toMatchObject({
      kind: "events",
      events: [{ kind: "queued", clientUserMessageId: "message-1" }],
    });
    expect(parse({ v: 1, t: "session", threadId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })).toEqual(
      { kind: "events", events: [], sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    );
    expect(parse({ v: 1, t: "session", threadId: "invalid\n" }).kind).toBe("unknown");
  });
  it("handles malformed JSON and non-object values", () => {
    for (const line of ["{", "null", "[]", "42"])
      expect(parseCodexAppServerLine(line).kind).toBe("unknown");
  });
});
