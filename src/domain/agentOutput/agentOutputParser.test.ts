import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentCliKind, AgentTaskOutputStream } from "../agentTask";
import type { AgentAccountUsageObservation } from "../agentAccountUsage";
import { MAX_AGENT_EVENT_TEXT_BYTES, type AgentTurnEvent } from "../agentThread";
import {
  MAX_AGENT_OUTPUT_LINE_BYTES,
  OVERSIZE_AGENT_OUTPUT_LINE_RAW,
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
} from "./agentOutputParser";
import { utf8ByteLength } from "./utf8Text";

const FIXTURE_DIRECTORY = join(process.cwd(), "src", "domain", "agentOutput", "fixtures");
const CLAUDE_SESSION_ID = "e49e4ab6-b1c3-4d26-9c2c-601ac23714f7";
const CODEX_SESSION_ID = "01a0359d-3e55-74e0-8bbf-e040d2f05f43";
const CODEX_HOOK_ERROR =
  "`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.";

interface ParserRun {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly reportedSessionIds: ReadonlyArray<string>;
  readonly accountUsage: ReadonlyArray<AgentAccountUsageObservation>;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIRECTORY, `${name}.jsonl`), "utf8");
}

function run(
  kind: AgentCliKind,
  chunks: ReadonlyArray<string>,
  stream: AgentTaskOutputStream = "stdout",
): ParserRun {
  let state = createAgentOutputParserState(kind);
  const events: AgentTurnEvent[] = [];
  const reportedSessionIds: string[] = [];
  const accountUsage: AgentAccountUsageObservation[] = [];
  for (const chunk of chunks) {
    const result = feedAgentOutput(state, stream, chunk);
    state = result.state;
    events.push(...result.events);
    if (result.sessionId !== null) reportedSessionIds.push(result.sessionId);
    accountUsage.push(...result.accountUsage);
  }
  const finished = finishAgentOutput(state);
  events.push(...finished.events);
  expect(finished.sessionId).toBeNull();
  accountUsage.push(...finished.accountUsage);
  return { events, reportedSessionIds, accountUsage };
}

function fixedOffsets(length: number, count: number): ReadonlyArray<number> {
  let seed = 20_260_824;
  const offsets = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 48_271) % 2_147_483_647;
    offsets.add(1 + (seed % Math.max(length - 1, 1)));
  }
  return [...offsets].sort((left, right) => left - right);
}

function splitAtOffsets(text: string, offsets: ReadonlyArray<number>): ReadonlyArray<string> {
  const chunks: string[] = [];
  let start = 0;
  for (const offset of offsets) {
    if (offset <= start) continue;
    if (isSurrogateSplit(text, offset)) continue;
    chunks.push(text.slice(start, offset));
    start = offset;
  }
  chunks.push(text.slice(start));
  return chunks;
}

function isSurrogateSplit(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1);
  return previous >= 0xd800 && previous <= 0xdbff;
}

describe("agent output parser fixtures", () => {
  it("parses the claude first turn into the exact event sequence", () => {
    const parsed = run("claudeCode", [fixture("claude-first-turn")]);

    expect(parsed.events).toEqual([
      {
        kind: "toolCall",
        toolId: "toolu_01WxKtGyBLC9hZeQb8WMGqMw",
        name: "Bash",
        inputSummary: "echo 'hello' >> /repo/a.txt",
      },
      {
        kind: "toolResult",
        toolId: "toolu_01WxKtGyBLC9hZeQb8WMGqMw",
        outputSummary: "(Bash completed with no output)",
        isError: false,
      },
      { kind: "assistantText", text: "done" },
      {
        kind: "result",
        text: "done",
        isError: false,
        usage: { inputTokens: 58, outputTokens: 163 },
      },
    ]);
    expect(parsed.reportedSessionIds).toEqual([CLAUDE_SESSION_ID]);
  });

  it("parses the claude resume turn into the exact event sequence", () => {
    const parsed = run("claudeCode", [fixture("claude-resume-turn")]);

    expect(parsed.events).toEqual([
      { kind: "assistantText", text: "hello" },
      { kind: "result", text: "hello", isError: false, usage: { inputTokens: 2, outputTokens: 4 } },
    ]);
    expect(parsed.reportedSessionIds).toEqual([CLAUDE_SESSION_ID]);
  });

  it("parses the codex first turn into the exact event sequence", () => {
    const parsed = run("codex", [fixture("codex-first-turn")]);

    expect(parsed.events).toEqual([
      { kind: "error", message: CODEX_HOOK_ERROR },
      { kind: "error", message: CODEX_HOOK_ERROR },
      { kind: "assistantText", text: "Updating the file." },
      {
        kind: "toolCall",
        toolId: "item_3",
        name: "shell",
        inputSummary:
          "/bin/zsh -lc \"if [ -f a.txt ]; then tail -n 5 a.txt; else echo '__MISSING__'; fi\"",
      },
      { kind: "toolResult", toolId: "item_3", outputSummary: "hi\nhello\n", isError: false },
      { kind: "toolCall", toolId: "item_4", name: "apply_patch", inputSummary: "/repo/a.txt" },
      { kind: "assistantText", text: "done" },
      {
        kind: "result",
        text: "",
        isError: false,
        usage: { inputTokens: 49_996, outputTokens: 314 },
      },
    ]);
    expect(parsed.reportedSessionIds).toEqual([CODEX_SESSION_ID]);
  });

  it("parses the codex resume turn into the exact event sequence", () => {
    const parsed = run("codex", [fixture("codex-resume-turn")]);

    expect(parsed.events).toEqual([
      { kind: "error", message: CODEX_HOOK_ERROR },
      { kind: "error", message: CODEX_HOOK_ERROR },
      { kind: "assistantText", text: "hello" },
      {
        kind: "result",
        text: "",
        isError: false,
        usage: { inputTokens: 19_096, outputTokens: 5 },
      },
    ]);
    expect(parsed.reportedSessionIds).toEqual([CODEX_SESSION_ID]);
  });

  it("reports the session id exactly once even though every fixture repeats it", () => {
    for (const name of ["claude-first-turn", "claude-resume-turn"]) {
      expect(run("claudeCode", [fixture(name)]).reportedSessionIds).toEqual([CLAUDE_SESSION_ID]);
    }
    for (const name of ["codex-first-turn", "codex-resume-turn"]) {
      expect(run("codex", [fixture(name)]).reportedSessionIds).toEqual([CODEX_SESSION_ID]);
    }
  });

  it("reports a later different session id so the dispatcher can warn", () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const parsed = run("codex", [
      `${JSON.stringify({ type: "thread.started", thread_id: CODEX_SESSION_ID })}\n`,
      `${JSON.stringify({ type: "thread.started", thread_id: CODEX_SESSION_ID })}\n`,
      `${JSON.stringify({ type: "thread.started", thread_id: other })}\n`,
    ]);

    expect(parsed.reportedSessionIds).toEqual([CODEX_SESSION_ID, other]);
  });
});

describe("agent output parser chunking", () => {
  it("produces identical events when a fixture arrives in fixed split chunks", () => {
    const cases: ReadonlyArray<{ readonly name: string; readonly kind: AgentCliKind }> = [
      { name: "claude-first-turn", kind: "claudeCode" },
      { name: "claude-resume-turn", kind: "claudeCode" },
      { name: "codex-first-turn", kind: "codex" },
      { name: "codex-resume-turn", kind: "codex" },
    ];
    for (const testCase of cases) {
      const text = fixture(testCase.name);
      const whole = run(testCase.kind, [text]);
      const chunked = run(testCase.kind, splitAtOffsets(text, fixedOffsets(text.length, 24)));

      expect(chunked.events).toEqual(whole.events);
      expect(chunked.reportedSessionIds).toEqual(whole.reportedSessionIds);
    }
  });

  it("produces identical events when a fixture arrives one character at a time", () => {
    const text = fixture("codex-resume-turn");
    const whole = run("codex", [text]);
    const chunked = run("codex", [...text]);

    expect(chunked.events).toEqual(whole.events);
    expect(chunked.reportedSessionIds).toEqual(whole.reportedSessionIds);
  });

  it("parses CRLF terminated lines the same as LF terminated ones", () => {
    const text = fixture("codex-first-turn");
    const whole = run("codex", [text]);
    const crlf = run("codex", [text.split("\n").join("\r\n")]);

    expect(crlf.events).toEqual(whole.events);
  });

  it("ignores blank lines between records", () => {
    const text = fixture("codex-resume-turn");
    const whole = run("codex", [text]);
    const padded = run("codex", [text.split("\n").join("\n\n")]);

    expect(padded.events).toEqual(whole.events);
  });
});

describe("agent output parser bounds", () => {
  it("reports an oversize line once and resynchronises at the next line", () => {
    const oversize = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES + 1);
    const message = JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "done" },
    });
    const parsed = run("codex", [`${oversize}\n${message}\n`]);

    expect(parsed.events).toEqual([
      {
        kind: "unknownLine",
        stream: "stdout",
        raw: OVERSIZE_AGENT_OUTPUT_LINE_RAW,
        clipped: true,
      },
      { kind: "assistantText", text: "done" },
    ]);
  });

  it("reports an oversize line spread over several chunks only once", () => {
    const half = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES);
    const parsed = run("codex", [
      half,
      half,
      half,
      `\n${JSON.stringify({ type: "thread.started", thread_id: CODEX_SESSION_ID })}\n`,
    ]);

    expect(parsed.events).toEqual([
      {
        kind: "unknownLine",
        stream: "stdout",
        raw: OVERSIZE_AGENT_OUTPUT_LINE_RAW,
        clipped: true,
      },
    ]);
    expect(parsed.reportedSessionIds).toEqual([CODEX_SESSION_ID]);
  });

  it("flushes a trailing partial line as an unknown line at finish", () => {
    const parsed = run("claudeCode", ['{"type":"assistant","message":{"content":[{"type":"tex']);

    expect(parsed.events).toEqual([
      {
        kind: "unknownLine",
        stream: "stdout",
        raw: '{"type":"assistant","message":{"content":[{"type":"tex',
        clipped: false,
      },
    ]);
  });

  it("does not flush a blank pending line at finish", () => {
    const parsed = run("codex", [
      `${JSON.stringify({ type: "thread.started", thread_id: CODEX_SESSION_ID })}\n   `,
    ]);

    expect(parsed.events).toEqual([]);
  });

  it("turns stderr lines into bounded unknown line events", () => {
    const parsed = run("claudeCode", ["warning: slow\n", "trace: done\n"], "stderr");

    expect(parsed.events).toEqual([
      { kind: "unknownLine", stream: "stderr", raw: "warning: slow", clipped: false },
      { kind: "unknownLine", stream: "stderr", raw: "trace: done", clipped: false },
    ]);
  });

  it("clips an oversize stderr line on a UTF-8 boundary", () => {
    const parsed = run("claudeCode", [`${"é".repeat(MAX_AGENT_EVENT_TEXT_BYTES)}\n`], "stderr");
    const event = parsed.events[0];

    expect(event?.kind).toBe("unknownLine");
    const raw = event !== undefined && event.kind === "unknownLine" ? event.raw : "";
    expect(utf8ByteLength(raw)).toBe(MAX_AGENT_EVENT_TEXT_BYTES);
    expect(raw).toBe("é".repeat(MAX_AGENT_EVENT_TEXT_BYTES / 2));
    expect(event !== undefined && event.kind === "unknownLine" ? event.clipped : false).toBe(true);
  });

  it("keeps stdout and stderr pending lines independent", () => {
    let state = createAgentOutputParserState("codex");
    const events: AgentTurnEvent[] = [];
    const record = JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "done" },
    });
    for (const step of [
      { stream: "stdout" as const, chunk: record.slice(0, 20) },
      { stream: "stderr" as const, chunk: "partial stderr" },
      { stream: "stdout" as const, chunk: `${record.slice(20)}\n` },
      { stream: "stderr" as const, chunk: " line\n" },
    ]) {
      const result = feedAgentOutput(state, step.stream, step.chunk);
      state = result.state;
      events.push(...result.events);
    }

    expect(events).toEqual([
      { kind: "assistantText", text: "done" },
      { kind: "unknownLine", stream: "stderr", raw: "partial stderr line", clipped: false },
    ]);
  });

  it("reports non-JSON stdout lines as unknown and ignores unsupported record types", () => {
    const parsed = run("claudeCode", [
      "listening on stdout\n",
      `${JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} })}\n`,
    ]);

    expect(parsed.events).toEqual([
      { kind: "unknownLine", stream: "stdout", raw: "listening on stdout", clipped: false },
    ]);
    expect(parsed.accountUsage).toEqual([]);
  });

  it("separates Claude limit observations from persisted conversation events", () => {
    const parsed = run("claudeCode", [
      `${JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "five_hour",
          utilization: 0.32,
          resetsAt: 1_786_200_000,
        },
      })}\n`,
    ]);

    expect(parsed.events).toEqual([]);
    expect(parsed.accountUsage).toMatchObject([
      { provider: "claudeCode", windows: [{ id: "five_hour", usedPercent: 32 }] },
    ]);
  });

  it("returns the state unchanged for an empty chunk", () => {
    const state = createAgentOutputParserState("codex");

    const result = feedAgentOutput(state, "stdout", "");

    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
    expect(result.sessionId).toBeNull();
    expect(result.accountUsage).toEqual([]);
  });

  it("clears pending lines after finishing", () => {
    const state = createAgentOutputParserState("codex");
    const fed = feedAgentOutput(state, "stdout", "partial");

    const finished = finishAgentOutput(fed.state);

    expect(finished.state.stdout).toEqual({ pending: "", pendingBytes: 0 });
    expect(finished.state.stderr).toEqual({ pending: "", pendingBytes: 0 });
    expect(finishAgentOutput(finished.state).events).toEqual([]);
  });
});
