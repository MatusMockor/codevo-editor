import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../agentThread";
import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type AgentOutputParserState,
} from "./agentOutputParser";
import { MAX_CLAUDE_RETRY_NOTICES, MAX_CLAUDE_UNKNOWN_FRAME_TYPES } from "./claudeNoticeThrottle";

function jsonl(values: ReadonlyArray<unknown>): string {
  return values.map((value) => `${JSON.stringify(value)}\n`).join("");
}

function retry(attempt: number): unknown {
  return { type: "system", subtype: "api_retry", attempt, max_retries: 10, retry_delay_ms: 500 };
}

function text(value: string): unknown {
  return { type: "assistant", message: { content: [{ type: "text", text: value }] } };
}

function rawLines(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<string> {
  return events.map((event) => (event.kind === "unknownLine" ? event.raw : `<${event.kind}>`));
}

function feedAll(
  chunks: ReadonlyArray<string>,
  initial: AgentOutputParserState = createAgentOutputParserState("claudeCode"),
): { readonly state: AgentOutputParserState; readonly events: ReadonlyArray<AgentTurnEvent> } {
  let state = initial;
  const events: AgentTurnEvent[] = [];
  for (const chunk of chunks) {
    const result = feedAgentOutput(state, "stdout", chunk);
    state = result.state;
    events.push(...result.events);
  }
  const finished = finishAgentOutput(state);
  return { state: finished.state, events: [...events, ...finished.events] };
}

describe("Claude notice throttling per turn", () => {
  it("reports each unknown frame type once and bounds the distinct types", () => {
    const repeated = Array.from({ length: 2_000 }, () => ({ type: "token_delta", delta: "x" }));
    const distinct = Array.from({ length: MAX_CLAUDE_UNKNOWN_FRAME_TYPES + 20 }, (_, index) => ({
      type: `frame_${index}`,
    }));
    const { events } = feedAll([jsonl(repeated), jsonl(distinct), jsonl(distinct)]);

    expect(rawLines(events)).toEqual([
      "Unsupported Claude stream frame: token_delta",
      ...Array.from(
        { length: MAX_CLAUDE_UNKNOWN_FRAME_TYPES - 1 },
        (_, index) => `Unsupported Claude stream frame: frame_${index}`,
      ),
      "Further unsupported Claude stream frame types omitted for this turn",
    ]);
  });

  it("coalesces a retry storm into the first and the latest retry", () => {
    const storm = Array.from({ length: 50 }, (_, index) => retry(index + 1));
    const { events } = feedAll([
      jsonl(storm.slice(0, 20)),
      jsonl(storm.slice(20)),
      jsonl([text("ok")]),
    ]);

    expect(rawLines(events)).toEqual([
      "Claude API request failed; retry 1/10 in 500ms",
      "Claude API request failed; retry 50/10 in 500ms (48 earlier retries coalesced)",
      "<assistantText>",
    ]);
  });

  it("keeps a single follow-up retry unannotated and flushes held retries at finish", () => {
    const { events } = feedAll([jsonl([retry(1), retry(2)])]);

    expect(rawLines(events)).toEqual([
      "Claude API request failed; retry 1/10 in 500ms",
      "Claude API request failed; retry 2/10 in 500ms",
    ]);
  });

  it("bounds the retry notices across repeated storms", () => {
    const chunks = Array.from({ length: 30 }, (_, index) =>
      jsonl([retry(1), retry(2), text(`t${index}`)]),
    );
    const retries = rawLines(feedAll(chunks).events).filter((line) =>
      line.startsWith("Claude API"),
    );

    expect(retries).toHaveLength(MAX_CLAUDE_RETRY_NOTICES);
    expect(rawLines(feedAll(chunks).events)).toContain(
      "Further Claude API retry notices omitted for this turn",
    );
  });

  it("starts every turn with a fresh throttle", () => {
    const first = feedAll([jsonl([{ type: "token_delta" }])]);
    expect(first.state.claudeNoticeThrottle?.frameTypes.size).toBe(1);

    const second = feedAll([jsonl([{ type: "token_delta" }])]);
    expect(rawLines(second.events)).toEqual(["Unsupported Claude stream frame: token_delta"]);
  });

  it("does not throttle Codex output", () => {
    const state = createAgentOutputParserState("codex");
    const result = feedAgentOutput(state, "stdout", "not json\nnot json\n");

    expect(result.state.claudeNoticeThrottle).toBeUndefined();
    expect(result.events).toHaveLength(2);
  });
});
