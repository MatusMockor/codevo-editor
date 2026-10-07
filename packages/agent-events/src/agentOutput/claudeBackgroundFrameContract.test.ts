import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
  type ParsedAgentLine,
} from "./agentOutputParser.js";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson.js";

type BufferState = "kept" | "dropped" | "gap";

interface ContractFrame {
  readonly name: string;
  readonly buffer: BufferState;
  readonly line: string;
  readonly projection: string | null;
}

const BUFFER_STATES: ReadonlyArray<string> = ["kept", "dropped", "gap"];

function record(value: unknown): Readonly<Record<string, unknown>> {
  expect(typeof value === "object" && value !== null && !Array.isArray(value)).toBe(true);
  return value as Readonly<Record<string, unknown>>;
}

function contractFrames(): ReadonlyArray<ContractFrame> {
  const path = join(process.cwd(), "contracts", "claude-background-frame-contract.json");
  const contract = record(JSON.parse(readFileSync(path, "utf8")) as unknown);
  expect(contract.schemaVersion).toBe(1);
  expect(Array.isArray(contract.frames)).toBe(true);
  return (contract.frames as ReadonlyArray<unknown>).map((value) => {
    const row = record(value);
    expect(typeof row.name).toBe("string");
    expect(BUFFER_STATES).toContain(row.buffer);
    expect("frame" in row).not.toBe("raw" in row);
    return {
      name: row.name as string,
      buffer: row.buffer as BufferState,
      line: typeof row.raw === "string" ? row.raw : JSON.stringify(row.frame),
      projection: "projection" in row ? JSON.stringify(row.projection) : null,
    };
  });
}

function producesNothing(parsed: ParsedAgentLine): boolean {
  if (parsed.kind === "ignored") return true;
  if (parsed.kind !== "events") return false;
  return parsed.events.length === 0 && parsed.sessionId === null;
}

function transcript(line: string): unknown {
  const fed = feedAgentOutput(createAgentOutputParserState("claudeCode"), "stdout", `${line}\n`);
  const finished = finishAgentOutput(fed.state);
  return {
    events: [...fed.events, ...finished.events],
    sessionId: fed.sessionId,
    accountUsage: fed.accountUsage,
  };
}

const FRAMES = contractFrames();
const EMPTY_TRANSCRIPT = { events: [], sessionId: null, accountUsage: [] };

describe("Claude background frame contract", () => {
  it("covers kept, dropped and unreadable frames", () => {
    for (const state of BUFFER_STATES) {
      expect(FRAMES.some((frame) => frame.buffer === state)).toBe(true);
    }
    expect(new Set(FRAMES.map((frame) => frame.name)).size).toBe(FRAMES.length);
  });

  it.each(FRAMES.filter((frame) => frame.buffer === "dropped"))(
    "shows nothing for a frame the router never buffers: $name",
    (frame) => {
      expect(producesNothing(parseClaudeStreamJsonLine(frame.line))).toBe(true);
      expect(transcript(frame.line)).toEqual(EMPTY_TRANSCRIPT);
    },
  );

  it.each(FRAMES.filter((frame) => frame.buffer !== "dropped"))(
    "reads something from a frame the router keeps or reports as a gap: $name",
    (frame) => {
      expect(producesNothing(parseClaudeStreamJsonLine(frame.line))).toBe(false);
      expect(transcript(frame.line)).not.toEqual(EMPTY_TRANSCRIPT);
    },
  );

  it.each(FRAMES.filter((frame) => frame.projection !== null))(
    "reads the buffered projection exactly like the original frame: $name",
    (frame) => {
      const projection = frame.projection ?? "";
      expect(projection.length).toBeLessThan(frame.line.length);
      expect(parseClaudeStreamJsonLine(projection)).toEqual(parseClaudeStreamJsonLine(frame.line));
      expect(transcript(projection)).toEqual(transcript(frame.line));
    },
  );
});
