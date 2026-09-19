import { describe, expect, it } from "vitest";
import {
  agentTurnStream,
  batchedAgentTurnStream,
  canonicalJson,
} from "../test/agentTurnEventStreams";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  mergeTurnEvents,
  type AgentTurnEvent,
} from "./agentThread";
import { emptyAgentTurnDigest } from "./agentTurnDigest";
import {
  retainAgentTurnEvents,
  type AgentTurnEventRetentionPolicy,
} from "./agentTurnEventRetention";
import { AGENT_TURN_LOG_FIRST_SEQ } from "./agentTurnLog";
import { agentTurnLogOpBytes, agentTurnLogOpsBytes } from "./agentTurnLogWire";
import {
  CLIPPED_AGENT_TURN_LOG_ROW,
  MAX_AGENT_TURN_LOG_EVENT_BYTES,
  MAX_AGENT_TURN_LOG_OP_BYTES,
  createAgentTurnWindow,
  urgentAgentTurnLogEvent,
  type AgentTurnWindow,
  type AgentTurnWindowPolicy,
} from "./agentTurnWindow";

const UNCAPPED: AgentTurnEventRetentionPolicy = {
  maxEvents: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
  maxSubagentThreads: Number.MAX_SAFE_INTEGER,
  eventBytes: agentTurnEventUtf8Bytes,
  coalesceText: coalesceAgentTextEvents,
};

const WINDOW_POLICY: AgentTurnWindowPolicy = {
  eventBytes: agentTurnEventUtf8Bytes,
  opBytes: agentTurnLogOpBytes,
  coalesceText: coalesceAgentTextEvents,
  maxEventBytes: MAX_AGENT_TURN_LOG_EVENT_BYTES,
  maxOpBytes: MAX_AGENT_TURN_LOG_OP_BYTES,
};

function newWindow(policy: Partial<AgentTurnWindowPolicy> = {}, firstSeq?: number) {
  return createAgentTurnWindow({
    policy: { ...WINDOW_POLICY, ...policy },
    digest: emptyAgentTurnDigest("claudeCode"),
    ...(firstSeq === undefined ? {} : { firstSeq }),
  });
}

function uncapped(raw: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  return retainAgentTurnEvents([], raw, UNCAPPED).events;
}

function drain(
  window: AgentTurnWindow,
  log: Map<number, AgentTurnEvent>,
  maxOps: number,
  maxBytes: number,
): void {
  for (;;) {
    const batch = window.take(maxOps, maxBytes);
    if (batch.ops.length === 0) return;
    for (const op of batch.ops) log.set(op.seq, op.event);
    window.commit(batch);
  }
}

function replayFlushes(
  batches: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>,
  maxOps: number,
  maxBytes = 1_048_576,
): { readonly log: Map<number, AgentTurnEvent>; readonly window: AgentTurnWindow } {
  const window = newWindow();
  const log = new Map<number, AgentTurnEvent>();
  for (const batch of batches) {
    window.accept(batch);
    drain(window, log, maxOps, maxBytes);
  }
  drain(window, log, maxOps, maxBytes);
  return { log, window };
}

function orderedLog(log: ReadonlyMap<number, AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
  return [...log.entries()].sort((left, right) => left[0] - right[0]).map(([, event]) => event);
}

describe("agent turn window ledger", () => {
  it("assigns the first sequence and never reuses one", () => {
    const window = newWindow();
    window.accept([{ kind: "assistantText", text: "a" }]);
    const first = window.take(16, 1_024);
    expect(first.ops.map((op) => op.seq)).toEqual([AGENT_TURN_LOG_FIRST_SEQ]);
    window.commit(first);

    window.accept([{ kind: "reasoning", text: "r" }]);
    const second = window.take(16, 1_024);
    expect(second.ops.map((op) => op.seq)).toEqual([AGENT_TURN_LOG_FIRST_SEQ + 1]);
    expect(window.nextSeq()).toBe(AGENT_TURN_LOG_FIRST_SEQ + 2);
  });

  it("starts from a resumed lease sequence", () => {
    const window = newWindow({}, 941);
    window.accept([{ kind: "assistantText", text: "a" }]);
    expect(window.take(16, 1_024).ops[0]?.seq).toBe(941);
  });

  it("reports a coalesced tail as a change to the same sequence", () => {
    const window = newWindow();
    window.accept([{ kind: "assistantText", text: "one " }]);
    const first = window.take(16, 4_096);
    window.commit(first);
    window.accept([{ kind: "assistantText", text: "two" }]);
    const second = window.take(16, 4_096);
    expect(second.ops).toEqual([{ seq: 1, event: { kind: "assistantText", text: "one two" } }]);
    expect(window.nextSeq()).toBe(2);
  });

  it("reports an in-place snapshot supersession as a change to the original sequence", () => {
    const window = newWindow();
    window.accept([
      { kind: "backgroundTask", taskId: "t1", status: "running", taskType: "shell" },
      { kind: "assistantText", text: "noise" },
      { kind: "toolCall", toolId: "tool-1", name: "Read", inputSummary: "x" },
    ]);
    drain(window, new Map(), 64, 65_536);
    window.accept([
      {
        kind: "backgroundTask",
        taskId: "t1",
        status: "running",
        taskType: "shell",
        description: "fresh",
      },
    ]);
    const batch = window.take(64, 65_536);
    expect(batch.ops).toEqual([
      {
        seq: 1,
        event: {
          kind: "backgroundTask",
          taskId: "t1",
          status: "running",
          taskType: "shell",
          description: "fresh",
        },
      },
    ]);
    expect(window.nextSeq()).toBe(4);
  });

  it("keeps a row dirty when it changes while a flush is in flight", () => {
    const window = newWindow();
    window.accept([{ kind: "assistantText", text: "one" }]);
    const inFlight = window.take(16, 4_096);
    window.accept([{ kind: "assistantText", text: " two" }]);
    window.commit(inFlight);
    expect(window.pending().ops).toBe(1);
    expect(window.take(16, 4_096).ops).toEqual([
      { seq: 1, event: { kind: "assistantText", text: "one two" } },
    ]);
  });

  it("bounds a flush batch by operations and bytes without dropping a row", () => {
    const window = newWindow();
    const events = Array.from({ length: 40 }, (_, index): AgentTurnEvent => ({
      kind: "toolCall",
      toolId: `tool-${index}`,
      name: "Read",
      inputSummary: `file-${index}`,
    }));
    window.accept(events);
    const byOps = window.take(8, 1_048_576);
    expect(byOps.ops).toHaveLength(8);
    expect(byOps.complete).toBe(false);
    expect(byOps.digest).toBeNull();
    const byBytes = window.take(64, agentTurnLogOpBytes({ seq: 1, event: events[0]! }) + 4);
    expect(byBytes.ops).toHaveLength(1);

    const log = new Map<number, AgentTurnEvent>();
    drain(window, log, 8, 1_048_576);
    expect(orderedLog(log)).toEqual(events);
  });

  it("carries the digest only with a complete batch", () => {
    const window = newWindow();
    window.accept([
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1_000 },
      { kind: "contextUsage", model: "m", inputTokens: 400, contextWindow: null },
    ]);
    const complete = window.take(64, 1_048_576);
    expect(complete.complete).toBe(true);
    expect(complete.digest?.context.current).toEqual({ usedTokens: 400, contextWindow: 1_000 });
  });

  it("refuses an event above the per-event bound and reports the gap", () => {
    const window = newWindow({ maxEventBytes: 8 });
    window.accept([{ kind: "assistantText", text: "far beyond the bound" }]);
    expect(window.pending().ops).toBe(0);
    expect(window.loss()).toEqual({ kind: "supervisorGap" });
  });

  it("marks itself bounded when supersession identities overflow", () => {
    const window = newWindow({ maxLiveSnapshots: 1 });
    window.accept([
      { kind: "backgroundTask", taskId: "a", status: "running", taskType: "shell" },
      { kind: "backgroundTask", taskId: "b", status: "running", taskType: "shell" },
      { kind: "backgroundTask", taskId: "a", status: "running", taskType: "shell" },
    ]);
    expect(window.bounded()).toBe(true);
    expect(window.nextSeq()).toBe(4);
  });

  it("sizes a batch by the exact serialized bytes the wire validator measures", () => {
    const window = newWindow();
    const line = "src/a/b.ts:12\n";
    const body = line.repeat(Math.floor(16_000 / line.length));
    window.accept(
      Array.from({ length: 200 }, (_, index): AgentTurnEvent =>
        index % 2 === 0 ? { kind: "assistantText", text: body } : { kind: "reasoning", text: body },
      ),
    );
    const batch = window.take(256, 524_288);
    expect(batch.ops.length).toBeGreaterThan(0);
    expect(batch.ops.length).toBeLessThan(200);
    expect(agentTurnLogOpsBytes(batch.ops)).toBeLessThanOrEqual(524_288);
  });

  it("never lets a coalesced or superseded row grow past the operation bound", () => {
    const window = newWindow({ maxOpBytes: 200 });
    window.accept([{ kind: "assistantText", text: "a".repeat(100) }]);
    window.accept([{ kind: "assistantText", text: "b".repeat(100) }]);
    const batch = window.take(64, 65_536);
    expect(batch.ops.map((op) => op.seq)).toEqual([1, 2]);
    for (const op of batch.ops) expect(agentTurnLogOpBytes(op)).toBeLessThanOrEqual(200);
  });

  it("refuses an event whose escaped payload would pass the raw bound", () => {
    const window = newWindow({ maxEventBytes: 4_096, maxOpBytes: 4_096 });
    window.accept([{ kind: "assistantText", text: "\n".repeat(3_000) }]);
    expect(window.pending().ops).toBe(0);
    expect(window.loss()).toEqual({ kind: "supervisorGap" });
  });

  it("clips exactly one refused row and keeps the sequence contiguous", () => {
    const window = newWindow();
    window.accept([
      { kind: "assistantText", text: "keep" },
      { kind: "toolCall", toolId: "tool-1", name: "Read", inputSummary: "huge" },
    ]);
    expect(window.clip(2)).toBe(true);
    expect(window.clip(2)).toBe(false);
    expect(window.clip(99)).toBe(false);
    expect(window.take(64, 65_536).ops).toEqual([
      { seq: 1, event: { kind: "assistantText", text: "keep" } },
      { seq: 2, event: CLIPPED_AGENT_TURN_LOG_ROW },
    ]);
    expect(window.loss()).toEqual({ kind: "supervisorGap" });
  });

  it("treats steering, results and errors as urgent", () => {
    expect(urgentAgentTurnLogEvent({ kind: "userMessage", text: "stop" })).toBe(true);
    expect(urgentAgentTurnLogEvent({ kind: "error", message: "boom" })).toBe(true);
    expect(urgentAgentTurnLogEvent({ kind: "result", text: "", isError: false, usage: null })).toBe(
      true,
    );
    expect(urgentAgentTurnLogEvent({ kind: "assistantText", text: "x" })).toBe(false);
  });
});

describe("replayed flush batches reproduce the uncapped stream", () => {
  const BATCH_SIZES = [1, 7, 64, 0] as const;
  const FLUSH_SIZES = [1, 13, 256] as const;

  it.each([0, 1, 2, 3])(
    "loses and duplicates nothing for seed block %i",
    { timeout: 120_000 },
    (block) => {
      const divergences: string[] = [];
      for (let seed = block * 12 + 1; seed <= block * 12 + 12; seed += 1) {
        const length = 600 + ((seed * 37) % 1_400);
        const truth = uncapped(agentTurnStream(seed, length));
        for (const batchSize of BATCH_SIZES) {
          const batches = batchedAgentTurnStream(seed, length, batchSize);
          const flushSize = FLUSH_SIZES[seed % FLUSH_SIZES.length]!;
          const replayed = replayFlushes(batches, flushSize);
          const rows = orderedLog(replayed.log);
          if (canonicalJson(rows) !== canonicalJson(truth))
            divergences.push(`seed ${seed} batch ${batchSize} content`);
          if (replayed.log.size !== truth.length)
            divergences.push(`seed ${seed} batch ${batchSize} size`);
          const seqs = [...replayed.log.keys()].sort((left, right) => left - right);
          const contiguous = seqs.every((seq, index) => seq === AGENT_TURN_LOG_FIRST_SEQ + index);
          if (!contiguous) divergences.push(`seed ${seed} batch ${batchSize} sequences`);
          if (replayed.window.pending().ops !== 0)
            divergences.push(`seed ${seed} batch ${batchSize} pending`);
        }
      }
      expect(divergences).toEqual([]);
    },
  );

  it("covers streams far beyond the in-memory window", { timeout: 120_000 }, () => {
    for (const seed of [11, 12, 13]) {
      const raw = agentTurnStream(seed, 20_000);
      const truth = uncapped(raw);
      const batches: AgentTurnEvent[][] = [];
      for (let index = 0; index < raw.length; index += 37)
        batches.push(raw.slice(index, index + 37));
      const replayed = replayFlushes(batches, 256);
      expect(replayed.log.size).toBe(truth.length);
      expect(truth.length).toBeGreaterThan(512 * 4);
      expect(canonicalJson(orderedLog(replayed.log))).toBe(canonicalJson(truth));
    }
  });

  it("keeps every event the in-memory window evicts", () => {
    const seed = 5;
    const raw = agentTurnStream(seed, 4_000);
    const replayed = replayFlushes([raw], 256);
    const merged = mergeTurnEvents([], raw);
    expect(merged.truncated).toBe(true);
    expect(merged.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(replayed.log.size).toBeGreaterThan(merged.events.length * 2);
    const logged = new Set(orderedLog(replayed.log).map((event) => canonicalJson(event)));
    const missing = merged.events.filter((event) => !logged.has(canonicalJson(event)));
    expect(missing).toEqual([]);
  });

  it("replays identically whether flushes happen per batch or once at the end", () => {
    for (let seed = 30; seed < 36; seed += 1) {
      const batches = batchedAgentTurnStream(seed, 900, 5);
      const eager = replayFlushes(batches, 4);
      const lazy = newWindow();
      const lazyLog = new Map<number, AgentTurnEvent>();
      for (const batch of batches) lazy.accept(batch);
      drain(lazy, lazyLog, 256, 1_048_576);
      expect(canonicalJson(orderedLog(lazyLog))).toBe(canonicalJson(orderedLog(eager.log)));
    }
  });
});
