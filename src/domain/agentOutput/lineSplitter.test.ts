import { describe, expect, it } from "vitest";
import {
  EMPTY_PENDING_LINE,
  MAX_AGENT_OUTPUT_LINE_BYTES,
  isDiscardingPendingLine,
  splitLines,
  type AgentOutputPendingLine,
} from "./lineSplitter";

function feed(chunks: ReadonlyArray<string>): {
  readonly lines: ReadonlyArray<string>;
  readonly overflow: number;
  readonly state: AgentOutputPendingLine;
} {
  let state = EMPTY_PENDING_LINE;
  const lines: string[] = [];
  let overflow = 0;
  for (const chunk of chunks) {
    const split = splitLines(state, chunk);
    state = split.state;
    lines.push(...split.lines);
    overflow += split.overflow;
  }
  return { lines, overflow, state };
}

describe("splitLines", () => {
  it("emits complete lines and keeps the trailing partial line pending", () => {
    const split = splitLines(EMPTY_PENDING_LINE, "alpha\nbeta\ngam");

    expect(split.lines).toEqual(["alpha", "beta"]);
    expect(split.overflow).toBe(0);
    expect(split.state).toEqual({ pending: "gam", pendingBytes: 3 });
  });

  it("joins a line split across chunk boundaries", () => {
    expect(feed(["al", "ph", "a\nbe", "ta\n"]).lines).toEqual(["alpha", "beta"]);
  });

  it("counts pending bytes in UTF-8, not UTF-16 units", () => {
    const split = splitLines(EMPTY_PENDING_LINE, "ř€𝄞");

    expect(split.state).toEqual({ pending: "ř€𝄞", pendingBytes: 2 + 3 + 4 });
  });

  it("strips a carriage return before the newline", () => {
    expect(feed(["alpha\r\nbeta\r", "\n"]).lines).toEqual(["alpha", "beta"]);
  });

  it("keeps empty lines", () => {
    expect(splitLines(EMPTY_PENDING_LINE, "\n\nalpha\n").lines).toEqual(["", "", "alpha"]);
  });

  it("returns the unchanged state for an empty chunk", () => {
    const state: AgentOutputPendingLine = { pending: "partial", pendingBytes: 7 };

    const split = splitLines(state, "");

    expect(split.state).toBe(state);
    expect(split.lines).toEqual([]);
    expect(split.overflow).toBe(0);
  });

  it("reports one overflow for an oversize line and resynchronises at the next newline", () => {
    const oversize = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES + 1);

    const split = splitLines(EMPTY_PENDING_LINE, `${oversize}\nalpha\n`);

    expect(split.overflow).toBe(1);
    expect(split.lines).toEqual(["alpha"]);
    expect(split.state).toEqual(EMPTY_PENDING_LINE);
  });

  it("reports the overflow once while the oversize line is still open", () => {
    const half = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES);
    const first = splitLines(EMPTY_PENDING_LINE, half);
    const second = splitLines(first.state, half);
    const third = splitLines(second.state, half);

    expect(first.overflow).toBe(0);
    expect(second.overflow).toBe(1);
    expect(third.overflow).toBe(0);
    expect(isDiscardingPendingLine(third.state)).toBe(true);

    const resynced = splitLines(third.state, "tail\nalpha\n");

    expect(resynced.overflow).toBe(0);
    expect(resynced.lines).toEqual(["alpha"]);
    expect(isDiscardingPendingLine(resynced.state)).toBe(false);
  });

  it("drops the oversize line without retaining its bytes", () => {
    const oversize = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES + 1);

    const split = splitLines(EMPTY_PENDING_LINE, oversize);

    expect(split.state.pending).toBe("");
    expect(split.overflow).toBe(1);
  });

  it("reports every oversize line in a chunk with several of them", () => {
    const oversize = "x".repeat(MAX_AGENT_OUTPUT_LINE_BYTES + 1);

    const split = splitLines(EMPTY_PENDING_LINE, `${oversize}\n${oversize}\nalpha\n`);

    expect(split.overflow).toBe(2);
    expect(split.lines).toEqual(["alpha"]);
  });
});
