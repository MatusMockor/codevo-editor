import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_TRANSCRIPT_OFFSET_PX,
  MAX_AGENT_TRANSCRIPT_POSITION_THREADS,
  MAX_AGENT_TRANSCRIPT_THREAD_ID_CHARS,
  MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS,
  agentTranscriptTurnPosition,
  boundAgentTranscriptPositionEntries,
  parseAgentTranscriptPositions,
  sameAgentTranscriptPosition,
  serializeAgentTranscriptPositions,
  validAgentTranscriptThreadId,
  type AgentTranscriptPositionEntry,
} from "./agentTranscriptPosition";

function entry(threadId: string, turnId: string, offsetPx: number): AgentTranscriptPositionEntry {
  return { threadId, position: { kind: "turn", turnId, offsetPx } };
}

function wire(positions: ReadonlyArray<unknown>, version: unknown = 1): string {
  return JSON.stringify({ version, positions });
}

describe("agentTranscriptTurnPosition", () => {
  it("rounds the offset to whole pixels", () => {
    expect(agentTranscriptTurnPosition("turn-1", -12.6)).toEqual({
      kind: "turn",
      turnId: "turn-1",
      offsetPx: -13,
    });
  });

  it("clamps the offset to the sane bound", () => {
    expect(agentTranscriptTurnPosition("turn-1", 9e9)?.offsetPx).toBe(
      MAX_AGENT_TRANSCRIPT_OFFSET_PX,
    );
    expect(agentTranscriptTurnPosition("turn-1", -9e9)?.offsetPx).toBe(
      -MAX_AGENT_TRANSCRIPT_OFFSET_PX,
    );
  });

  it("rejects non-finite offsets and invalid turn ids", () => {
    expect(agentTranscriptTurnPosition("turn-1", Number.NaN)).toBeNull();
    expect(agentTranscriptTurnPosition("turn-1", Number.POSITIVE_INFINITY)).toBeNull();
    expect(agentTranscriptTurnPosition("", 0)).toBeNull();
    expect(
      agentTranscriptTurnPosition("t".repeat(MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS + 1), 0),
    ).toBeNull();
  });
});

describe("sameAgentTranscriptPosition", () => {
  it("compares turn and offset", () => {
    const base = agentTranscriptTurnPosition("turn-1", 4);
    expect(sameAgentTranscriptPosition(base, agentTranscriptTurnPosition("turn-1", 4))).toBe(true);
    expect(sameAgentTranscriptPosition(base, agentTranscriptTurnPosition("turn-1", 5))).toBe(false);
    expect(sameAgentTranscriptPosition(base, agentTranscriptTurnPosition("turn-2", 4))).toBe(false);
    expect(sameAgentTranscriptPosition(base, null)).toBe(false);
    expect(sameAgentTranscriptPosition(null, null)).toBe(true);
  });
});

describe("boundAgentTranscriptPositionEntries", () => {
  it("keeps the most recent entry per thread at its latest place", () => {
    const bounded = boundAgentTranscriptPositionEntries([
      entry("a", "t1", 1),
      entry("b", "t2", 2),
      entry("a", "t3", 3),
    ]);
    expect(bounded).toEqual([entry("b", "t2", 2), entry("a", "t3", 3)]);
  });

  it("keeps only the most recent threads", () => {
    const many = Array.from({ length: MAX_AGENT_TRANSCRIPT_POSITION_THREADS + 5 }, (_, index) =>
      entry(`thread-${index}`, "turn", index),
    );
    const bounded = boundAgentTranscriptPositionEntries(many);
    expect(bounded).toHaveLength(MAX_AGENT_TRANSCRIPT_POSITION_THREADS);
    expect(bounded[0]?.threadId).toBe("thread-5");
    expect(bounded[bounded.length - 1]?.threadId).toBe(
      `thread-${MAX_AGENT_TRANSCRIPT_POSITION_THREADS + 4}`,
    );
  });

  it("drops entries with invalid thread ids", () => {
    const bounded = boundAgentTranscriptPositionEntries([
      entry("", "t1", 1),
      entry("x".repeat(MAX_AGENT_TRANSCRIPT_THREAD_ID_CHARS + 1), "t1", 1),
      entry("ok", "t1", 1),
    ]);
    expect(bounded).toEqual([entry("ok", "t1", 1)]);
  });
});

describe("parseAgentTranscriptPositions", () => {
  it("round-trips serialized positions in recency order", () => {
    const entries = [entry("agt-1", "turn-a", -40), entry("agt-2", "turn-b", 0)];
    const raw = serializeAgentTranscriptPositions(entries);
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      positions: [
        { threadId: "agt-1", turnId: "turn-a", offsetPx: -40 },
        { threadId: "agt-2", turnId: "turn-b", offsetPx: 0 },
      ],
    });
    expect(parseAgentTranscriptPositions(raw)).toEqual(entries);
  });

  it("treats nothing stored as no positions", () => {
    expect(parseAgentTranscriptPositions(null)).toEqual([]);
    expect(parseAgentTranscriptPositions("")).toEqual([]);
  });

  it.each([
    ["not JSON", "{version:1"],
    ["a JSON array", "[]"],
    ["null", "null"],
    ["an unknown version", wire([], 2)],
    ["a string version", wire([], "1")],
    ["missing positions", JSON.stringify({ version: 1 })],
    ["positions that are not an array", JSON.stringify({ version: 1, positions: {} })],
    ["an unknown top-level field", JSON.stringify({ version: 1, positions: [], extra: true })],
    ["an unknown entry field", wire([{ threadId: "a", turnId: "t", offsetPx: 0, kind: "x" }])],
    ["a missing entry field", wire([{ threadId: "a", turnId: "t" }])],
    ["an entry that is not an object", wire(["a"])],
    ["a fractional offset", wire([{ threadId: "a", turnId: "t", offsetPx: 1.5 }])],
    ["a string offset", wire([{ threadId: "a", turnId: "t", offsetPx: "1" }])],
    ["an empty thread id", wire([{ threadId: "", turnId: "t", offsetPx: 0 }])],
    ["an empty turn id", wire([{ threadId: "a", turnId: "", offsetPx: 0 }])],
    ["a numeric thread id", wire([{ threadId: 7, turnId: "t", offsetPx: 0 }])],
  ])("fails closed to no positions for %s", (_label, raw) => {
    expect(parseAgentTranscriptPositions(raw)).toEqual([]);
  });

  it("skips a bad entry but keeps the valid ones", () => {
    const raw = wire([
      { threadId: "a", turnId: "t", offsetPx: 1.5 },
      { threadId: "b", turnId: "t", offsetPx: -40 },
      { threadId: "remote-thread:x", turnId: "t", offsetPx: 0 },
    ]);
    expect(parseAgentTranscriptPositions(raw)).toEqual([entry("b", "t", -40)]);
  });

  it("does not track remote threads whose turns stream in later", () => {
    expect(validAgentTranscriptThreadId("remote-thread:server:1")).toBe(false);
    expect(validAgentTranscriptThreadId("agt-1")).toBe(true);
  });

  it("rejects oversize ids and an oversize payload", () => {
    const longThread = "a".repeat(MAX_AGENT_TRANSCRIPT_THREAD_ID_CHARS + 1);
    const longTurn = "t".repeat(MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS + 1);
    expect(
      parseAgentTranscriptPositions(wire([{ threadId: longThread, turnId: "t", offsetPx: 0 }])),
    ).toEqual([]);
    expect(
      parseAgentTranscriptPositions(wire([{ threadId: "a", turnId: longTurn, offsetPx: 0 }])),
    ).toEqual([]);
    expect(parseAgentTranscriptPositions(`${wire([])}${" ".repeat(200_000)}`)).toEqual([]);
  });

  it("clamps an out-of-range integer offset", () => {
    const raw = wire([{ threadId: "a", turnId: "t", offsetPx: 99_999_999 }]);
    expect(parseAgentTranscriptPositions(raw)).toEqual([
      entry("a", "t", MAX_AGENT_TRANSCRIPT_OFFSET_PX),
    ]);
  });

  it("keeps the most recent threads and the last duplicate", () => {
    const positions = Array.from(
      { length: MAX_AGENT_TRANSCRIPT_POSITION_THREADS + 3 },
      (_, index) => ({ threadId: `thread-${index}`, turnId: "t", offsetPx: index }),
    );
    positions.push({ threadId: "thread-10", turnId: "later", offsetPx: 1 });
    const parsed = parseAgentTranscriptPositions(wire(positions));
    expect(parsed).toHaveLength(MAX_AGENT_TRANSCRIPT_POSITION_THREADS);
    expect(parsed[parsed.length - 1]).toEqual(entry("thread-10", "later", 1));
    expect(parsed.some((item) => item.threadId === "thread-2")).toBe(false);
    expect(parsed[0]?.threadId).toBe("thread-3");
  });
});

describe("serializeAgentTranscriptPositions", () => {
  it("applies the same bounds as the parser", () => {
    const many = Array.from({ length: MAX_AGENT_TRANSCRIPT_POSITION_THREADS + 2 }, (_, index) =>
      entry(`thread-${index}`, "turn", index),
    );
    const parsed = parseAgentTranscriptPositions(serializeAgentTranscriptPositions(many));
    expect(parsed).toHaveLength(MAX_AGENT_TRANSCRIPT_POSITION_THREADS);
    expect(parsed[0]?.threadId).toBe("thread-2");
  });

  it("drops the oldest entries when escaped ids would exceed the stored size cap", () => {
    const escaped = "\u0001".repeat(MAX_AGENT_TRANSCRIPT_TURN_ID_CHARS);
    const many = Array.from({ length: MAX_AGENT_TRANSCRIPT_POSITION_THREADS }, (_, index) =>
      entry(`${"\u0002".repeat(200)}-${index}`, escaped, index),
    );
    const raw = serializeAgentTranscriptPositions(many);
    const parsed = parseAgentTranscriptPositions(raw);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(MAX_AGENT_TRANSCRIPT_POSITION_THREADS);
    expect(parsed[parsed.length - 1]?.threadId).toBe(
      `${"\u0002".repeat(200)}-${MAX_AGENT_TRANSCRIPT_POSITION_THREADS - 1}`,
    );
  });
});
