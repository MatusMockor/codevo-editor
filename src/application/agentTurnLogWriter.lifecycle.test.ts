import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import {
  parseAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "../domain/agentSubagentLifecycle";
import type { AgentTurnEvent } from "../domain/agentThread";
import {
  AgentTurnLogFailure,
  type AgentTurnLogLease,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type AgentTurnLogSummary,
  type AppendAgentTurnLogReceipt,
  type AppendAgentTurnLogRequest,
  type DeleteAgentThreadLogResult,
} from "../domain/agentTurnLog";
import { systemAgentTurnLogTimers, type AgentTurnLogGateway } from "./agentTurnLogPorts";
import { createAgentTurnLogWriter } from "./agentTurnLogWriter";

const SCOPE: AgentTurnLogScope = {
  rootKey: "/projects/storefront",
  ownerId: "agent-root:f307e46f5f6c07dd",
  threadId: "thread-0a1b2c3d",
  turnId: "turn-0a1b2c3d",
};
const RETAINED = parseAgentSubagentLifecycle(wire.valid.retained) as AgentSubagentLifecycle;

class LifecycleGateway implements AgentTurnLogGateway {
  readonly appends: AppendAgentTurnLogRequest[] = [];
  readonly failures: unknown[] = [];
  stored: AgentSubagentLifecycle | null = null;
  nextSeq = 1;

  openTurnLog(): Promise<AgentTurnLogLease> {
    return Promise.resolve({
      writerEpoch: 1,
      nextSeq: this.nextSeq,
      digest: null,
      digestThroughSeq: 0,
    });
  }

  appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt> {
    this.appends.push(request);
    const failure = this.failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.nextSeq += request.ops.filter((op) => op.seq >= this.nextSeq).length;
    if (request.lifecycle !== null) this.stored = request.lifecycle;
    return Promise.resolve({
      persistedThroughSeq: this.nextSeq - 1,
      nextSeq: this.nextSeq,
      turnBytes: 1,
      budget: "ok",
    });
  }

  readTurnLogPage(): Promise<AgentTurnLogPage> {
    return Promise.reject(new Error("not used"));
  }

  summarizeTurnLogs(): Promise<ReadonlyArray<AgentTurnLogSummary>> {
    return Promise.resolve([]);
  }

  deleteThreadLog(): Promise<DeleteAgentThreadLogResult> {
    return Promise.reject(new Error("not used"));
  }
}

function toolCall(index: number): AgentTurnEvent {
  return { kind: "toolCall", toolId: `tool-${index}`, name: "Read", inputSummary: `file-${index}` };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("agent turn log writer: retained subagent lifecycle", () => {
  let gateway: LifecycleGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new LifecycleGateway();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openedWriter() {
    const subject = createAgentTurnLogWriter({
      gateway,
      timers: systemAgentTurnLogTimers,
      authority: { ownsTurn: () => true, currentGeneration: () => 1 },
    });
    subject.openTurn({
      scope: SCOPE,
      generation: 1,
      provider: "claudeCode",
      priorLoss: { kind: "none" },
      prompt: null,
    });
    return subject;
  }

  it("sends a changed lifecycle with the normal coalesced flush and never resends an unchanged one", async () => {
    const subject = openedWriter();
    await settle();
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    expect(gateway.appends).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.ops).toHaveLength(1);
    expect(gateway.appends[0]?.lifecycle).toBe(RETAINED);

    subject.recordEvents(SCOPE.turnId, [toolCall(2)]);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends).toHaveLength(2);
    expect(gateway.appends[1]?.lifecycle).toBeNull();
    subject.dispose();
  });

  it("flushes a lifecycle that changed without any new event and keeps the last write", async () => {
    const subject = openedWriter();
    await settle();
    const first = { ...RETAINED, truncated: true };
    subject.recordLifecycle(SCOPE.turnId, first);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.ops).toEqual([]);
    expect(gateway.appends[0]?.seal).toBe(false);
    expect(gateway.stored).toBe(RETAINED);
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBe(RETAINED);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.appends).toHaveLength(1);
    subject.dispose();
  });

  it("carries the final lifecycle in the sealing append", async () => {
    const subject = openedWriter();
    await settle();
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    subject.sealTurn(SCOPE.turnId);
    await settle();

    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.seal).toBe(true);
    expect(gateway.appends[0]?.lifecycle).toBe(RETAINED);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "sealed" });
    subject.dispose();
  });

  it("buffers a lifecycle recorded before the lease and sends it once the log opens", async () => {
    const subject = openedWriter();
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(gateway.appends.map((request) => request.lifecycle)).toEqual([RETAINED]);
    subject.dispose();
  });

  it("retries the lifecycle with the batch that failed and stores it exactly once", async () => {
    const subject = openedWriter();
    await settle();
    gateway.failures.push(new AgentTurnLogFailure("busy"));
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.stored).toBeNull();
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends.map((request) => request.lifecycle)).toEqual([RETAINED, RETAINED]);
    expect(gateway.stored).toBe(RETAINED);
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBe(RETAINED);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.appends).toHaveLength(2);
    subject.dispose();
  });

  it("does not certify lifecycle metadata from sequence-gap event reconciliation", async () => {
    const subject = openedWriter();
    await settle();
    gateway.nextSeq = 2;
    gateway.failures.push(
      new AgentTurnLogFailure("sequenceGap", 2),
      new AgentTurnLogFailure("busy"),
    );
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends).toHaveLength(2);
    expect(gateway.appends[1]?.ops).toEqual([]);
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBe(RETAINED);
    subject.dispose();
  });

  it("never sends a snapshot the strict validator would refuse and keeps logging events", async () => {
    const subject = openedWriter();
    await settle();
    const incoherent = {
      entries: [{ id: "tool:t", toolId: "t", name: "Agent", description: "", state: "completed" }],
      truncated: false,
    } as AgentSubagentLifecycle;
    const oversized = {
      entries: Array.from({ length: 32 }, (_unused, index) => ({
        id: `tool:t${index}`,
        toolId: `t${index}`,
        name: "\u0000".repeat(128),
        description: "\u0000".repeat(512),
        state: "running",
        lastToolName: "\u0000".repeat(128),
      })),
      truncated: false,
    } as AgentSubagentLifecycle;

    subject.recordLifecycle(SCOPE.turnId, incoherent);
    await vi.advanceTimersByTimeAsync(1_000);
    subject.recordLifecycle(SCOPE.turnId, oversized);
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.lifecycle).toBeNull();
    expect(gateway.appends[0]?.ops).toHaveLength(1);
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("writing");
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBeNull();
    subject.dispose();
  });

  it("certifies only the exact lifecycle acknowledged by an append", async () => {
    const subject = openedWriter();
    await settle();
    let acknowledge: (() => void) | undefined;
    vi.spyOn(gateway, "appendTurnLog").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({ persistedThroughSeq: 0, nextSeq: 1, turnBytes: 1, budget: "ok" });
        }),
    );
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBeNull();
    const newer = { ...RETAINED, truncated: true };
    subject.recordLifecycle(SCOPE.turnId, newer);
    gateway.failures.push(new AgentTurnLogFailure("busy"));
    acknowledge?.();
    await settle();
    expect(subject.status(SCOPE.turnId)?.lifecycleStored).toBe(RETAINED);
    subject.dispose();
  });

  it("ignores a lifecycle for an unknown or stopped turn", async () => {
    const subject = openedWriter();
    await settle();
    subject.recordLifecycle("turn-unknown", RETAINED);
    subject.sealTurn(SCOPE.turnId);
    await settle();
    subject.recordLifecycle(SCOPE.turnId, RETAINED);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(gateway.appends.map((request) => request.lifecycle)).toEqual([null]);
    subject.dispose();
  });
});
