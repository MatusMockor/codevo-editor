import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentTurnStream } from "../test/agentTurnEventStreams";
import type { AgentTurnEvent } from "../domain/agentThread";
import {
  AgentTurnLogFailure,
  type AgentTurnLogError,
  type AgentTurnLogLease,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type AgentTurnLogSummary,
  type AppendAgentTurnLogReceipt,
  type AppendAgentTurnLogRequest,
  type DeleteAgentThreadLogResult,
  type OpenAgentTurnLogRequest,
} from "../domain/agentTurnLog";
import {
  AGENT_TURN_LOG_BACKPRESSURE,
  AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS,
  MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS,
  MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS,
  MAX_RETAINED_AGENT_TURN_LOG_FINAL_STATUSES,
  systemAgentTurnLogTimers,
  type AgentTurnLogGateway,
  type AgentTurnLogOwnerAuthority,
  type AgentTurnLogSlotStatus,
} from "./agentTurnLogPorts";
import {
  AGENT_TURN_LOG_COMMANDS,
  TauriAgentTurnLogGateway,
} from "../infrastructure/tauriAgentTurnLogGateway";
import * as turnWindow from "../domain/agentTurnWindow";
import { createAgentTurnLogWriter } from "./agentTurnLogWriter";

const SCOPE: AgentTurnLogScope = {
  rootKey: "/projects/storefront",
  ownerId: "agent-root:f307e46f5f6c07dd",
  threadId: "thread-0a1b2c3d",
  turnId: "turn-0a1b2c3d",
};

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<TValue>(): Deferred<TValue> {
  let resolve: (value: TValue) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<TValue>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

class FakeAgentTurnLogGateway implements AgentTurnLogGateway {
  readonly opens: OpenAgentTurnLogRequest[] = [];
  readonly appends: AppendAgentTurnLogRequest[] = [];
  readonly log = new Map<number, AgentTurnEvent>();
  readonly failures: unknown[] = [];
  nextSeq = 1;
  writerEpoch = 1;
  sealed = false;
  manual: Deferred<AppendAgentTurnLogReceipt> | null = null;
  manualMode = false;
  loseReplyOnce = false;
  openGate: Promise<void> | null = null;
  refuseOps: unknown = null;
  rejected = 0;

  openTurnLog(request: OpenAgentTurnLogRequest): Promise<AgentTurnLogLease> {
    this.opens.push(request);
    const failure = this.failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    const gate = this.openGate;
    if (gate === null) return Promise.resolve(this.lease());
    return gate.then(() => this.lease());
  }

  lease(): AgentTurnLogLease {
    return {
      writerEpoch: this.writerEpoch,
      nextSeq: this.nextSeq,
      digest: null,
      digestThroughSeq: 0,
    };
  }

  appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt> {
    this.appends.push(request);
    const refusal = this.refuseOps;
    if (refusal !== null && request.ops.length > 0) {
      this.rejected += 1;
      return Promise.reject(refusal);
    }
    if (this.loseReplyOnce) {
      this.loseReplyOnce = false;
      this.apply(request);
      return Promise.reject(new AgentTurnLogFailure("sequenceGap", this.nextSeq));
    }
    const failure = this.failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    if (!this.manualMode) return Promise.resolve(this.apply(request));
    const pending = deferred<AppendAgentTurnLogReceipt>();
    this.manual = pending;
    return pending.promise;
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

  apply(request: AppendAgentTurnLogRequest): AppendAgentTurnLogReceipt {
    for (const op of request.ops) {
      this.log.set(op.seq, op.event);
      this.nextSeq = Math.max(this.nextSeq, op.seq + 1);
    }
    this.sealed = this.sealed || request.seal;
    return {
      persistedThroughSeq: this.nextSeq - 1,
      nextSeq: this.nextSeq,
      turnBytes: this.log.size,
      budget: "ok",
    };
  }

  settle(request: AppendAgentTurnLogRequest): void {
    const pending = this.manual;
    if (pending === null) return;
    this.manual = null;
    pending.resolve(this.apply(request));
  }
}

function failure(code: AgentTurnLogError): AgentTurnLogFailure {
  return new AgentTurnLogFailure(code);
}

interface OwnerState {
  generation: number;
  owns: boolean;
  rootKey?: string;
  turnIds?: ReadonlySet<string>;
}

function ownerAuthority(state: OwnerState): AgentTurnLogOwnerAuthority {
  const ownsRoot = (scope: AgentTurnLogScope): boolean =>
    state.owns && scope.rootKey === (state.rootKey ?? SCOPE.rootKey);
  const ownsTurnId = (turnId: string): boolean =>
    state.turnIds?.has(turnId) ?? turnId === SCOPE.turnId;
  return {
    ownsTurn: (scope, generation) =>
      ownsRoot(scope) && generation === state.generation && ownsTurnId(scope.turnId),
    currentGeneration: (scope) => (ownsRoot(scope) ? state.generation : null),
  };
}

function text(value: string): AgentTurnEvent {
  return { kind: "assistantText", text: value };
}

function toolCall(index: number): AgentTurnEvent {
  return {
    kind: "toolCall",
    toolId: `tool-${index}`,
    name: "Read",
    inputSummary: `file-${index}`,
  };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function lastStatus(statuses: ReadonlyArray<AgentTurnLogSlotStatus>): AgentTurnLogSlotStatus {
  const status = statuses[statuses.length - 1];
  expect(status).toBeDefined();
  return status as AgentTurnLogSlotStatus;
}

describe("agent turn log writer", () => {
  let gateway: FakeAgentTurnLogGateway;
  let owner: OwnerState;
  let statuses: AgentTurnLogSlotStatus[];

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new FakeAgentTurnLogGateway();
    owner = { generation: 7, owns: true };
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function writer() {
    return createAgentTurnLogWriter({
      gateway,
      timers: systemAgentTurnLogTimers,
      authority: ownerAuthority(owner),
      onStatus: (status) => statuses.push(status),
    });
  }

  function open(subject: ReturnType<typeof writer>): void {
    subject.openTurn({
      scope: SCOPE,
      generation: owner.generation,
      provider: "claudeCode",
      priorLoss: { kind: "none" },
      prompt: null,
    });
  }

  it("keeps writing beyond the historical cumulative byte ceiling", async () => {
    const createWindow = turnWindow.createAgentTurnWindow;
    const spy = vi.spyOn(turnWindow, "createAgentTurnWindow").mockImplementation((options) => ({
      ...createWindow(options),
      totalBytes: () => 268_435_457,
    }));
    const subject = writer();
    try {
      open(subject);
      await settle();
      subject.recordEvents(SCOPE.turnId, [
        { kind: "unknownLine", stream: "stdout", raw: "later event", clipped: false },
      ]);
      await subject.flushAll();
      expect(subject.status(SCOPE.turnId)?.state.kind).toBe("writing");
      expect(gateway.log.size).toBe(1);
      expect(gateway.appends.every((request) => request.loss.kind === "none")).toBe(true);
    } finally {
      subject.dispose();
      spy.mockRestore();
    }
  });

  it("sends the turn's full prompt on open and reports it stored only once the lease resolved", async () => {
    const gate = deferred<void>();
    gateway.openGate = gate.promise;
    const subject = writer();
    subject.openTurn({
      scope: SCOPE,
      generation: owner.generation,
      provider: "claudeCode",
      priorLoss: { kind: "none" },
      prompt: "write the whole parser",
    });
    await settle();

    expect(gateway.opens.map((request) => request.prompt)).toEqual(["write the whole parser"]);
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("opening");
    expect(subject.status(SCOPE.turnId)?.promptStored).toBe(false);

    gate.resolve();
    await settle();

    expect(subject.status(SCOPE.turnId)?.promptStored).toBe(true);
    expect(lastStatus(statuses).promptStored).toBe(true);
    subject.dispose();
  });

  it("never claims the prompt is stored when the open failed or the slot carries none", async () => {
    gateway.failures.push(new AgentTurnLogFailure("ownerMismatch"));
    const failing = writer();
    failing.openTurn({
      scope: SCOPE,
      generation: owner.generation,
      provider: "claudeCode",
      priorLoss: { kind: "none" },
      prompt: "write the whole parser",
    });
    await settle();
    expect(lastStatus(statuses).promptStored).toBe(false);
    failing.dispose();

    statuses = [];
    const withoutPrompt = writer();
    open(withoutPrompt);
    await settle();
    expect(withoutPrompt.status(SCOPE.turnId)?.promptStored).toBe(false);
    withoutPrompt.dispose();
  });

  it("opens a lease before it appends and coalesces one flush per interval", async () => {
    const subject = writer();
    open(subject);
    subject.recordEvents(SCOPE.turnId, [text("a")]);
    await settle();
    expect(gateway.opens).toHaveLength(1);
    expect(gateway.appends).toHaveLength(0);

    subject.recordEvents(SCOPE.turnId, [text("b"), toolCall(1)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.expectedNextSeq).toBe(1);
    expect(gateway.appends[0]?.ops.map((op) => op.seq)).toEqual([1, 2]);
    expect(gateway.log.get(1)).toEqual({ kind: "assistantText", text: "ab" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    subject.dispose();
  });

  it("flushes steering, results and errors immediately", async () => {
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "stop" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);

    subject.recordEvents(SCOPE.turnId, [{ kind: "error", message: "boom" }]);
    await settle();
    expect(gateway.appends).toHaveLength(2);
    expect(gateway.appends[1]?.expectedNextSeq).toBe(2);
    subject.dispose();
  });

  it("chains the expected next sequence across flushes and never loses an event", async () => {
    const subject = writer();
    open(subject);
    await settle();
    const stream = agentTurnStream(3, 900);
    for (let index = 0; index < stream.length; index += 25) {
      subject.recordEvents(SCOPE.turnId, stream.slice(index, index + 25));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    subject.sealTurn(SCOPE.turnId);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(gateway.sealed).toBe(true);
    expect(lastStatus(statuses).state).toEqual({ kind: "stopped", reason: "sealed" });
    expect(subject.status(SCOPE.turnId)).toEqual(lastStatus(statuses));
    expect(gateway.log.size).toBeGreaterThan(512);
    const seqs = [...gateway.log.keys()].sort((left, right) => left - right);
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(seqs.length);
    for (const request of gateway.appends) {
      expect(request.ops.length).toBeLessThanOrEqual(256);
    }
    subject.dispose();
  });

  it("keeps one flush in flight and seals in the follow-up append", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);

    subject.recordEvents(SCOPE.turnId, [text("during")]);
    subject.sealTurn(SCOPE.turnId);
    await settle();
    expect(gateway.appends).toHaveLength(1);

    gateway.settle(gateway.appends[0]!);
    await settle();
    expect(gateway.appends).toHaveLength(2);
    expect(gateway.appends[1]?.seal).toBe(true);
    gateway.settle(gateway.appends[1]!);
    await settle();
    expect(lastStatus(statuses).state).toEqual({ kind: "stopped", reason: "sealed" });
    expect(subject.status(SCOPE.turnId)).toEqual(lastStatus(statuses));
    subject.dispose();
  });

  it("stops the slot when a superseding writer takes the log", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.failures.push(failure("supersededWriter"));
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state).toEqual({
      kind: "stopped",
      reason: "supersededWriter",
    });

    subject.recordEvents(SCOPE.turnId, [text("ignored")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.appends.map((request) => request.ops.length)).toEqual([1, 0]);
    subject.dispose();
  });

  it("continues the live turn when the same root bumps its generation", async () => {
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);
    expect(gateway.opens).toHaveLength(1);

    owner.generation = 8;
    subject.recordEvents(SCOPE.turnId, [text("after the bump")]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(gateway.opens).toHaveLength(2);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(gateway.log.get(2)).toEqual({ kind: "assistantText", text: "after the bump" });
    expect(gateway.appends.every((request) => request.ops.length > 0)).toBe(true);
    subject.dispose();
  });

  it("stops the slot when a different root claims the turn", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);

    owner.rootKey = "/projects/other";
    gateway.settle(gateway.appends[0]!);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state).toEqual({
      kind: "stopped",
      reason: "ownerMismatch",
    });

    owner.rootKey = SCOPE.rootKey;
    subject.recordEvents(SCOPE.turnId, [text("after")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.appends.filter((request) => request.ops.length > 0)).toHaveLength(1);
    subject.dispose();
  });

  it("ignores a receipt that lands after dispose", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    const pending = gateway.appends[0]!;
    subject.dispose();
    gateway.settle(pending);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.appends).toHaveLength(1);
    expect(subject.status(SCOPE.turnId)).toBeNull();
  });

  it("raises and releases backpressure without dropping pending operations", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();

    const burst = Array.from({ length: AGENT_TURN_LOG_BACKPRESSURE.ops + 8 }, (_, index) =>
      toolCall(index),
    );
    subject.recordEvents(SCOPE.turnId, burst);
    expect(subject.status(SCOPE.turnId)?.backpressure).toBe(true);
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBeGreaterThanOrEqual(
      AGENT_TURN_LOG_BACKPRESSURE.ops,
    );

    gateway.manualMode = false;
    gateway.settle(gateway.appends[0]!);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(subject.status(SCOPE.turnId)?.backpressure).toBe(false);
    expect(gateway.log.size).toBe(burst.length + 1);
    subject.dispose();
  });

  it("keeps pending operations and retries after a full disk", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.failures.push(failure("diskFull"));
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }, text("tail")]);
    await settle();

    const retrying = subject.status(SCOPE.turnId);
    expect(retrying?.state.kind).toBe("retrying");
    expect(retrying?.pendingOps).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.appends).toHaveLength(2);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(gateway.log.size).toBe(2);
    subject.dispose();
  });

  it("retries an unknown transport failure and stops after the attempt budget", async () => {
    const subject = writer();
    open(subject);
    await settle();
    for (let attempt = 0; attempt <= MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS; attempt += 1) {
      gateway.failures.push(new Error("ipc closed"));
    }
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "failed" });
    subject.dispose();
  });

  it("buffers events recorded before the lease arrives", async () => {
    gateway.nextSeq = 41;
    const subject = writer();
    open(subject);
    subject.recordEvents(SCOPE.turnId, [text("early"), { kind: "userMessage", text: "go" }]);
    expect(gateway.appends).toHaveLength(0);
    await settle();
    expect(gateway.appends[0]?.expectedNextSeq).toBe(41);
    expect(gateway.appends[0]?.ops.map((op) => op.seq)).toEqual([41, 42]);
    subject.dispose();
  });

  it("reports an open failure as a retry and recovers", async () => {
    gateway.failures.push(failure("unreadable"));
    const subject = writer();
    open(subject);
    subject.recordEvents(SCOPE.turnId, [text("kept")]);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("retrying");
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.opens).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.log.size).toBe(1);
    subject.dispose();
  });

  it("carries a reported supervisor gap and the uncapped context meter", async () => {
    const subject = writer();
    open(subject);
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    subject.recordEvents(SCOPE.turnId, [
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1_000 },
      { kind: "contextUsage", model: "m", inputTokens: 400, contextWindow: null },
    ]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(gateway.appends[0]?.loss).toEqual({ kind: "supervisorGap" });
    expect(gateway.appends[0]?.digest?.context.current).toEqual({
      usedTokens: 400,
      contextWindow: 1_000,
    });
    expect(subject.status(SCOPE.turnId)?.contextWindow).toEqual({
      usedTokens: 400,
      contextWindow: 1_000,
    });
    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "supervisorGap" });
    subject.dispose();
  });

  it("treats a lost reply as committed and keeps writing", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.loseReplyOnce = true;
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }, toolCall(1)]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(gateway.appends).toHaveLength(1);
    expect(gateway.log.size).toBe(2);

    subject.recordEvents(SCOPE.turnId, [text("next")]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(gateway.appends[1]?.expectedNextSeq).toBe(3);
    expect(gateway.log.get(3)).toEqual({ kind: "assistantText", text: "next" });
    subject.dispose();
  });

  it("stops with an unexplained sequence and records one loss-only append", async () => {
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [
      { kind: "contextUsage", model: "m", inputTokens: 400, contextWindow: 1_000 },
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    gateway.failures.push(new AgentTurnLogFailure("sequenceGap", 99));
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }, toolCall(2)]);
    await vi.advanceTimersByTimeAsync(30_000);

    const final = subject.status(SCOPE.turnId);
    expect(final?.state).toEqual({ kind: "stopped", reason: "sequenceGap" });
    expect(final?.pendingOps).toBe(0);
    expect(final?.pendingBytes).toBe(0);
    expect(final?.backpressure).toBe(false);
    expect(final?.contextWindow).toEqual({ usedTokens: 400, contextWindow: 1_000 });

    const notes = gateway.appends.filter((request) => request.ops.length === 0);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.loss).toEqual({ kind: "supervisorGap" });
    expect(notes[0]?.seal).toBe(false);
    expect(lastStatus(statuses)).toEqual(final);
    subject.dispose();
  });

  it("retries a busy log past the transport attempt budget", async () => {
    const subject = writer();
    open(subject);
    await settle();
    for (let attempt = 0; attempt <= MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS + 2; attempt += 1) {
      gateway.failures.push(failure("busy"));
    }
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("retrying");

    await vi.advanceTimersByTimeAsync(300_000);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(gateway.log.size).toBe(1);
    subject.dispose();
  });

  it("flushes everything that is pending behind an in-flight append", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);
    subject.recordEvents(SCOPE.turnId, [toolCall(1), toolCall(2)]);

    const flushed = subject.flushAll();
    gateway.manualMode = false;
    gateway.settle(gateway.appends[0]!);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushed;

    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(gateway.log.size).toBe(3);
    subject.dispose();
  });

  it("gives up the quit flush when the budget expires", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);

    let resolved = false;
    const flushed = subject.flushAll().then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS);
    await flushed;
    expect(resolved).toBe(true);
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(2);
    subject.dispose();
  });

  it("does nothing when the quit flush runs after dispose", async () => {
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    subject.dispose();
    await subject.flushAll();
    expect(gateway.appends).toHaveLength(0);
  });

  it("forgets a stopped slot and keeps only a bounded number of final statuses", async () => {
    const turnIds = Array.from(
      { length: MAX_RETAINED_AGENT_TURN_LOG_FINAL_STATUSES + 2 },
      (_, index) => `turn-stopped-${index}`,
    );
    owner.turnIds = new Set([...turnIds, SCOPE.turnId]);
    const subject = writer();
    for (const turnId of turnIds) {
      subject.openTurn({
        scope: { ...SCOPE, turnId },
        generation: owner.generation,
        provider: "claudeCode",
        priorLoss: { kind: "none" },
        prompt: null,
      });
      await settle();
      gateway.failures.push(failure("supersededWriter"));
      subject.recordEvents(turnId, [{ kind: "userMessage", text: "go" }]);
      await settle();
    }

    expect(subject.status(turnIds[turnIds.length - 1]!)?.state).toEqual({
      kind: "stopped",
      reason: "supersededWriter",
    });
    expect(subject.status("turn-stopped-0")).toBeNull();
    expect(subject.status("turn-stopped-1")).toBeNull();

    const appendsBefore = gateway.appends.length;
    await subject.flushAll();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.appends).toHaveLength(appendsBefore);

    subject.closeTurn(turnIds[turnIds.length - 1]!);
    expect(subject.status(turnIds[turnIds.length - 1]!)).toBeNull();
    subject.dispose();
  });

  it("does not resurrect a turn closed while its incomplete note is in flight", async () => {
    gateway.manualMode = true;
    const subject = writer();
    open(subject);
    await settle();
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(gateway.appends).toHaveLength(1);

    owner.rootKey = "/projects/other";
    gateway.settle(gateway.appends[0]!);
    await settle();
    expect(gateway.appends).toHaveLength(2);
    expect(lastStatus(statuses).state).toEqual({ kind: "stopped", reason: "ownerMismatch" });

    subject.closeTurn(SCOPE.turnId);
    gateway.settle(gateway.appends[1]!);
    await settle();
    expect(subject.status(SCOPE.turnId)).toBeNull();
    subject.dispose();
  });

  it("reopens a turn that a superseding writer stopped", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.failures.push(failure("supersededWriter"));
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state).toEqual({
      kind: "stopped",
      reason: "supersededWriter",
    });

    open(subject);
    subject.recordEvents(SCOPE.turnId, [text("after the takeover")]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(gateway.opens).toHaveLength(2);
    expect(gateway.log.get(1)).toEqual({ kind: "assistantText", text: "after the takeover" });
    subject.dispose();
  });

  it("stops a slot whose retries never land inside the retry window", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.refuseOps = failure("diskFull");
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }, text("tail")]);
    await settle();
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("retrying");

    await vi.advanceTimersByTimeAsync(MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS);
    const final = subject.status(SCOPE.turnId);
    expect(final?.state).toEqual({ kind: "stopped", reason: "failed" });
    expect(final?.pendingOps).toBe(0);
    expect(final?.pendingBytes).toBe(0);
    expect(final?.backpressure).toBe(false);
    expect(final?.loss.kind).toBe("diskBudget");
    expect(lastStatus(statuses)).toEqual(final);

    const notes = gateway.appends.filter((request) => request.ops.length === 0);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.loss.kind).toBe("diskBudget");
    expect(notes[0]?.seal).toBe(false);
    expect(gateway.rejected).toBe(gateway.appends.length - 1);

    const settled = gateway.appends.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(gateway.appends).toHaveLength(settled);
    subject.dispose();
  });

  it("restarts the retry window after an append lands", async () => {
    const subject = writer();
    open(subject);
    await settle();
    gateway.refuseOps = failure("busy");
    subject.recordEvents(SCOPE.turnId, [{ kind: "userMessage", text: "go" }]);
    await settle();
    await vi.advanceTimersByTimeAsync(MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS - 60_000);
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("retrying");

    gateway.refuseOps = null;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(gateway.log.size).toBe(1);

    gateway.refuseOps = failure("busy");
    subject.recordEvents(SCOPE.turnId, [text("more")]);
    await vi.advanceTimersByTimeAsync(MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS - 60_000);
    expect(subject.status(SCOPE.turnId)?.state.kind).toBe("retrying");
    subject.dispose();
  });

  it("appends what an unopened slot buffered once the open lands inside the quit budget", async () => {
    const gate = deferred<void>();
    gateway.openGate = gate.promise;
    const subject = writer();
    open(subject);
    subject.recordEvents(SCOPE.turnId, [toolCall(1), toolCall(2)]);
    await settle();
    expect(gateway.appends).toHaveLength(0);

    let persistedAtFlush: number | null = null;
    const flushed = subject.flushAll().then(() => {
      persistedAtFlush = gateway.log.size;
    });
    await settle();
    expect(persistedAtFlush).toBeNull();

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flushed;
    expect(persistedAtFlush).toBe(2);
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    subject.dispose();
  });

  it("resolves the quit flush at the budget when the open never lands", async () => {
    const gate = deferred<void>();
    gateway.openGate = gate.promise;
    const subject = writer();
    open(subject);
    subject.recordEvents(SCOPE.turnId, [toolCall(1)]);
    await settle();

    let resolved = false;
    const flushed = subject.flushAll().then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS);
    await flushed;
    expect(resolved).toBe(true);
    expect(gateway.appends).toHaveLength(0);
    subject.dispose();
  });

  it("does nothing for an unknown turn and reports no status", () => {
    const subject = writer();
    subject.recordEvents("turn-unknown", [text("x")]);
    subject.sealTurn("turn-unknown");
    subject.closeTurn("turn-unknown");
    expect(subject.status("turn-unknown")).toBeNull();
    expect(gateway.appends).toHaveLength(0);
    subject.dispose();
  });
});

interface BackendAppend {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly ops: number;
}

class ValidatingAgentTurnLogBackend {
  readonly commands: string[] = [];
  readonly applied: BackendAppend[] = [];
  readonly rows = new Map<number, unknown>();
  nextSeq = 1;
  writerEpoch = 1;
  sealed = false;

  readonly invoke = (command: string, args: Readonly<{ request: unknown }>): Promise<unknown> => {
    this.commands.push(command);
    if (command === AGENT_TURN_LOG_COMMANDS.open) return Promise.resolve(this.lease());
    if (command !== AGENT_TURN_LOG_COMMANDS.append)
      return Promise.reject(new Error(`unexpected ${command}`));
    return this.append(args.request as AppendAgentTurnLogRequest);
  };

  private lease(): unknown {
    return {
      writerEpoch: this.writerEpoch,
      nextSeq: this.nextSeq,
      digest: null,
      digestThroughSeq: 0,
    };
  }

  private append(request: AppendAgentTurnLogRequest): Promise<unknown> {
    if (request.expectedNextSeq !== this.nextSeq)
      return Promise.reject(`sequenceGap:${this.nextSeq}`);
    for (const op of request.ops) {
      this.rows.set(op.seq, op.event);
      this.nextSeq = Math.max(this.nextSeq, op.seq + 1);
    }
    const first = request.ops[0];
    const last = request.ops[request.ops.length - 1];
    if (first !== undefined && last !== undefined)
      this.applied.push({ firstSeq: first.seq, lastSeq: last.seq, ops: request.ops.length });
    this.sealed = this.sealed || request.seal;
    return Promise.resolve({
      persistedThroughSeq: this.nextSeq - 1,
      nextSeq: this.nextSeq,
      turnBytes: this.rows.size,
      budget: "ok",
    });
  }
}

describe("agent turn log writer against the real wire validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits a newline-heavy batch that only escapes over the wire bound", async () => {
    const backend = new ValidatingAgentTurnLogBackend();
    const subject = createAgentTurnLogWriter({
      gateway: new TauriAgentTurnLogGateway(backend.invoke),
      timers: systemAgentTurnLogTimers,
      authority: ownerAuthority({ generation: 7, owns: true }),
    });
    subject.openTurn({
      scope: SCOPE,
      generation: 7,
      provider: "claudeCode",
      priorLoss: { kind: "none" },
      prompt: null,
    });
    await settle();

    const line = "src/a/b.ts:12\n";
    const body = line.repeat(Math.floor(16_000 / line.length));
    const events = Array.from({ length: 200 }, (_, index): AgentTurnEvent =>
      index % 2 === 0 ? { kind: "assistantText", text: body } : { kind: "reasoning", text: body },
    );
    subject.recordEvents(SCOPE.turnId, events);
    await vi.advanceTimersByTimeAsync(300_000);

    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "writing" });
    expect(subject.status(SCOPE.turnId)?.pendingOps).toBe(0);
    expect(backend.rows.size).toBe(events.length);
    const ranges = backend.applied.map((entry) => `${entry.firstSeq}-${entry.lastSeq}`);
    expect(new Set(ranges).size).toBe(ranges.length);
    expect(backend.applied.reduce((total, entry) => total + entry.ops, 0)).toBe(events.length);
    subject.dispose();
  });
});
