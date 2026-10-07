import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "../domain/agentThread";
import {
  AgentTurnLogFailure,
  type AgentTurnLogLease,
  type AgentTurnLogLoss,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type AgentTurnLogSummary,
  type AppendAgentTurnLogReceipt,
  type AppendAgentTurnLogRequest,
  type DeleteAgentThreadLogResult,
  type OpenAgentTurnLogRequest,
} from "../domain/agentTurnLog";
import { MAX_AGENT_TURN_LOG_EVENT_BYTES } from "../domain/agentTurnWindow";
import {
  MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS,
  MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS,
  systemAgentTurnLogTimers,
  type AgentTurnLogGateway,
  type AgentTurnLogSlotStatus,
} from "./agentTurnLogPorts";
import { createAgentTurnLogWriter } from "./agentTurnLogWriter";

const SCOPE: AgentTurnLogScope = {
  rootKey: "/projects/storefront",
  ownerId: "agent-root:f307e46f5f6c07dd",
  threadId: "thread-0a1b2c3d",
  turnId: "turn-0a1b2c3d",
};
const NO_LOSS: AgentTurnLogLoss = { kind: "none" };

class LossGateway implements AgentTurnLogGateway {
  readonly opens: OpenAgentTurnLogRequest[] = [];
  readonly appends: AppendAgentTurnLogRequest[] = [];
  readonly failures: unknown[] = [];
  refuseOps: unknown = null;
  nextSeq = 1;

  openTurnLog(request: OpenAgentTurnLogRequest): Promise<AgentTurnLogLease> {
    this.opens.push(request);
    return Promise.resolve({
      writerEpoch: 1,
      nextSeq: this.nextSeq,
      digest: null,
      digestThroughSeq: 0,
    });
  }

  appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt> {
    this.appends.push(request);
    if (this.refuseOps !== null && request.ops.length > 0) return Promise.reject(this.refuseOps);
    const failure = this.failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.nextSeq += request.ops.filter((op) => op.seq >= this.nextSeq).length;
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

function say(text: string): AgentTurnEvent {
  return { kind: "assistantText", text };
}

function ask(text: string): AgentTurnEvent {
  return { kind: "userMessage", text };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("agent turn log writer: loss kinds and their precedence", () => {
  let gateway: LossGateway;
  let statuses: AgentTurnLogSlotStatus[];

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new LossGateway();
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function opened(priorLoss: AgentTurnLogLoss = NO_LOSS) {
    const subject = createAgentTurnLogWriter({
      gateway,
      timers: systemAgentTurnLogTimers,
      authority: { ownsTurn: () => true, currentGeneration: () => 1 },
      onStatus: (status) => statuses.push(status),
    });
    subject.openTurn({
      scope: SCOPE,
      generation: 1,
      provider: "claudeCode",
      priorLoss,
      prompt: null,
    });
    return subject;
  }

  function exhaustTransport(): void {
    for (let attempt = 0; attempt <= MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS; attempt += 1) {
      gateway.failures.push(new Error("ipc closed"));
    }
  }

  function lossOnlyAppends(): ReadonlyArray<AppendAgentTurnLogRequest> {
    return gateway.appends.filter((request) => request.ops.length === 0 && !request.seal);
  }

  it("opens a slot with its known loss so no status or request ever reports none", async () => {
    const subject = opened({ kind: "backgroundBuffer" });
    await settle();
    subject.recordEvents(SCOPE.turnId, [say("kept")]);
    subject.sealTurn(SCOPE.turnId);
    await settle();

    expect(gateway.opens.map((request) => request.priorLoss)).toEqual([
      { kind: "backgroundBuffer" },
    ]);
    expect(gateway.appends).toHaveLength(1);
    expect(gateway.appends[0]?.seal).toBe(true);
    expect(gateway.appends[0]?.loss).toEqual({ kind: "backgroundBuffer" });
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.map((status) => status.loss.kind)).toEqual(
      statuses.map(() => "backgroundBuffer"),
    );
    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "sealed" });
    subject.dispose();
  });

  it("records a write failure when the transport never accepts the append", async () => {
    const subject = opened();
    await settle();
    exhaustTransport();
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();
    await vi.advanceTimersByTimeAsync(300_000);

    const final = subject.status(SCOPE.turnId);
    expect(final?.state).toEqual({ kind: "stopped", reason: "failed" });
    expect(final?.loss).toEqual({ kind: "writeFailure" });
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([{ kind: "writeFailure" }]);
    subject.dispose();
  });

  it("records a write failure when a busy log never frees inside the retry window", async () => {
    const subject = opened();
    await settle();
    gateway.refuseOps = new AgentTurnLogFailure("busy");
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();
    await vi.advanceTimersByTimeAsync(MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS);

    const final = subject.status(SCOPE.turnId);
    expect(final?.state).toEqual({ kind: "stopped", reason: "failed" });
    expect(final?.loss).toEqual({ kind: "writeFailure" });
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([{ kind: "writeFailure" }]);
    subject.dispose();
  });

  it("asks the store to record a write failure when the writer stops on a broken sequence", async () => {
    const subject = opened();
    await settle();
    gateway.failures.push(new AgentTurnLogFailure("sequenceGap", 99));
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();

    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "sequenceGap" });
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([{ kind: "writeFailure" }]);
    subject.dispose();
  });

  it("keeps a real stream gap as a supervisor gap", async () => {
    const subject = opened();
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    subject.sealTurn(SCOPE.turnId);
    await settle();

    expect(gateway.appends.length).toBeGreaterThan(0);
    expect(gateway.appends.map((request) => request.loss.kind)).toEqual(
      gateway.appends.map(() => "supervisorGap"),
    );
    expect(gateway.appends[gateway.appends.length - 1]?.seal).toBe(true);
    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "supervisorGap" });
    subject.dispose();
  });

  it("keeps an event too large to record as a supervisor gap", async () => {
    const subject = opened();
    await settle();
    subject.recordEvents(SCOPE.turnId, [say("x".repeat(MAX_AGENT_TURN_LOG_EVENT_BYTES + 1))]);
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();

    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "supervisorGap" });
    expect(gateway.appends[0]?.loss).toEqual({ kind: "supervisorGap" });
    subject.dispose();
  });

  it("raises a background buffer loss to a later stream gap and never lowers it again", async () => {
    const subject = opened({ kind: "backgroundBuffer" });
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    const raised = statuses.length;
    subject.reportLoss(SCOPE.turnId, { kind: "backgroundBuffer" });
    subject.reportLoss(SCOPE.turnId, { kind: "legacyWindow" });
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    subject.reportLoss(SCOPE.turnId, NO_LOSS);

    expect(statuses).toHaveLength(raised);
    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "supervisorGap" });
    subject.dispose();
  });

  it("replaces a stream gap with the write failure that follows it, live and on disk", async () => {
    const subject = opened();
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    exhaustTransport();
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "writeFailure" });
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([{ kind: "writeFailure" }]);
    subject.dispose();
  });

  it("keeps a write failure when a stream gap or an oversized event is seen after it", async () => {
    const subject = opened();
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "writeFailure" });
    subject.reportLoss(SCOPE.turnId, { kind: "supervisorGap" });
    subject.recordEvents(SCOPE.turnId, [say("x".repeat(MAX_AGENT_TURN_LOG_EVENT_BYTES + 1))]);
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();

    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "writeFailure" });
    expect(gateway.appends[0]?.loss).toEqual({ kind: "writeFailure" });
    subject.dispose();
  });

  it("never lets a later write failure hide a more severe loss it already recorded", async () => {
    const subject = opened();
    await settle();
    subject.reportLoss(SCOPE.turnId, { kind: "unreadable" });
    exhaustTransport();
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "failed" });
    expect(subject.status(SCOPE.turnId)?.loss).toEqual({ kind: "unreadable" });
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([{ kind: "unreadable" }]);
    subject.dispose();
  });

  it("keeps the earlier of two equally severe losses", async () => {
    const earlier: AgentTurnLogLoss = { kind: "diskBudget", atEpochMs: 5 };
    const subject = opened(earlier);
    await settle();
    gateway.refuseOps = new AgentTurnLogFailure("diskFull");
    subject.recordEvents(SCOPE.turnId, [ask("go")]);
    await settle();
    await vi.advanceTimersByTimeAsync(MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS);

    expect(subject.status(SCOPE.turnId)?.state).toEqual({ kind: "stopped", reason: "failed" });
    expect(subject.status(SCOPE.turnId)?.loss).toEqual(earlier);
    expect(lossOnlyAppends().map((request) => request.loss)).toEqual([earlier]);
    subject.dispose();
  });
});
