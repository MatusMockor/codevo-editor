import { describe, expect, it } from "vitest";
import { agentTurnStream } from "../test/agentTurnEventStreams";
import {
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_SUBAGENT_THREADS_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "./agentThread";
import { emptyAgentTurnDigest } from "./agentTurnDigest";
import { retainAgentTurnEvents } from "./agentTurnEventRetention";
import { AGENT_TURN_LOG_LIMITS } from "./agentTurnLog";
import { agentTurnLogOpBytes } from "./agentTurnLogWire";
import {
  MAX_AGENT_TURN_LOG_EVENT_BYTES,
  MAX_AGENT_TURN_LOG_OP_BYTES,
  createAgentTurnWindow,
} from "./agentTurnWindow";

const DELIVERY_BATCH = 16;

interface WindowSize {
  readonly label: string;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

const WINDOW_SIZES: ReadonlyArray<WindowSize> = [
  {
    label: "512 events / 512 KiB",
    maxEvents: MAX_AGENT_EVENTS_PER_TURN,
    maxBytes: MAX_AGENT_EVENT_BYTES_PER_TURN,
  },
  { label: "1024 events / 2 MiB", maxEvents: 1_024, maxBytes: 2_097_152 },
];

interface Measurement {
  readonly steps: number;
  readonly totalMs: number;
  readonly worstBatchMs: number;
  readonly batches: number;
}

function batchesOf(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<ReadonlyArray<AgentTurnEvent>> {
  const batches: AgentTurnEvent[][] = [];
  for (let index = 0; index < events.length; index += DELIVERY_BATCH)
    batches.push([...events.slice(index, index + DELIVERY_BATCH)]);
  return batches;
}

function measure(
  batches: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>,
  run: (batch: ReadonlyArray<AgentTurnEvent>) => void,
  steps: () => number,
): Measurement {
  let worstBatchMs = 0;
  const started = performance.now();
  for (const batch of batches) {
    const batchStarted = performance.now();
    run(batch);
    worstBatchMs = Math.max(worstBatchMs, performance.now() - batchStarted);
  }
  return {
    steps: steps(),
    totalMs: performance.now() - started,
    worstBatchMs,
    batches: batches.length,
  };
}

function measureRetention(
  batches: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>,
  size: WindowSize,
): Measurement {
  let steps = 0;
  let events: ReadonlyArray<AgentTurnEvent> = [];
  return measure(
    batches,
    (batch) => {
      events = retainAgentTurnEvents(events, batch, {
        maxEvents: size.maxEvents,
        maxBytes: size.maxBytes,
        maxSubagentThreads: MAX_SUBAGENT_THREADS_PER_TURN,
        eventBytes: agentTurnEventUtf8Bytes,
        coalesceText: coalesceAgentTextEvents,
        probe: { step: () => (steps += 1) },
      }).events;
    },
    () => steps,
  );
}

function measureLedger(batches: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>): Measurement {
  let steps = 0;
  const window = createAgentTurnWindow({
    digest: emptyAgentTurnDigest("claudeCode"),
    policy: {
      eventBytes: agentTurnEventUtf8Bytes,
      opBytes: agentTurnLogOpBytes,
      coalesceText: coalesceAgentTextEvents,
      maxEventBytes: MAX_AGENT_TURN_LOG_EVENT_BYTES,
      maxOpBytes: MAX_AGENT_TURN_LOG_OP_BYTES,
      probe: { step: () => (steps += 1) },
    },
  });
  return measure(
    batches,
    (batch) => {
      window.accept(batch);
      for (;;) {
        const taken = window.take(
          AGENT_TURN_LOG_LIMITS.appendOps,
          AGENT_TURN_LOG_LIMITS.appendBytes,
        );
        if (taken.ops.length === 0) break;
        window.commit(taken);
      }
    },
    () => steps,
  );
}

function report(label: string, measurement: Measurement): void {
  const perBatch = measurement.totalMs / measurement.batches;
  console.info(
    `[agentTurnWindow] ${label}: steps=${measurement.steps} total=${measurement.totalMs.toFixed(1)}ms ` +
      `perBatch=${perBatch.toFixed(3)}ms worstBatch=${measurement.worstBatchMs.toFixed(3)}ms`,
  );
}

describe("agent turn window cost", () => {
  it.each([7_310, 100_000])(
    "does bounded work per delivery batch for %i events",
    { timeout: 180_000 },
    (length) => {
      const events = agentTurnStream(7, length);
      const batches = batchesOf(events);

      const ledger = measureLedger(batches);
      report(`ledger ${length}`, ledger);
      expect(ledger.steps).toBeLessThanOrEqual(length * 8);

      for (const size of WINDOW_SIZES) {
        const retention = measureRetention(batches, size);
        report(`window ${size.label} ${length}`, retention);
        expect(retention.steps).toBeLessThanOrEqual(
          batches.length * (size.maxEvents + DELIVERY_BATCH) * 4,
        );
      }
    },
  );

  it("keeps ledger work independent of the stream length", () => {
    const short = measureLedger(batchesOf(agentTurnStream(7, 5_000)));
    const long = measureLedger(batchesOf(agentTurnStream(7, 50_000)));
    expect(long.steps).toBeLessThanOrEqual(short.steps * 12);
  });
});
