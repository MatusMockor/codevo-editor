import {
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "../domain/agentThread";
import {
  agentTurnDigestContextWindow,
  emptyAgentTurnDigest,
  type AgentTurnDigestWire,
} from "../domain/agentTurnDigest";
import {
  AGENT_TURN_LOG_LIMITS,
  NO_AGENT_TURN_LOG_LOSS,
  agentTurnLogFailureCode,
  agentTurnLogFailureNextSeq,
  isAgentTurnLogBatchTooLarge,
  type AgentTurnLogError,
  type AgentTurnLogLease,
  type AgentTurnLogLoss,
  type AgentTurnLogScope,
} from "../domain/agentTurnLog";
import { agentTurnLogOpBytes } from "../domain/agentTurnLogWire";
import {
  MAX_AGENT_TURN_LOG_EVENT_BYTES,
  MAX_AGENT_TURN_LOG_OP_BYTES,
  createAgentTurnWindow,
  type AgentTurnWindow,
  type AgentTurnWindowBatch,
  type AgentTurnWindowPending,
  type AgentTurnWindowPolicy,
} from "../domain/agentTurnWindow";
import { attempt } from "./agentProjectAuthority";
import {
  AGENT_TURN_LOG_APPEND_TARGET_BYTES,
  AGENT_TURN_LOG_BACKPRESSURE,
  AGENT_TURN_LOG_FLUSH_INTERVAL_MS,
  AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS,
  AGENT_TURN_LOG_RETRY_DELAYS_MS,
  MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS,
  MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS,
  MAX_RETAINED_AGENT_TURN_LOG_FINAL_STATUSES,
  type AgentTurnLogGateway,
  type AgentTurnLogOwnerAuthority,
  type AgentTurnLogRetryError,
  type AgentTurnLogSlotState,
  type AgentTurnLogSlotStatus,
  type AgentTurnLogStopReason,
  type AgentTurnLogTimers,
  type AgentTurnLogWriter,
  type OpenAgentTurnLogSlotRequest,
} from "./agentTurnLogPorts";

const MAX_AGENT_TURN_LOG_QUIT_FLUSH_ROUNDS = 8;
const INCOMPLETE_AGENT_TURN_LOG_LOSS: AgentTurnLogLoss = Object.freeze({ kind: "supervisorGap" });

export interface AgentTurnLogWriterDependencies {
  readonly gateway: AgentTurnLogGateway;
  readonly timers: AgentTurnLogTimers;
  readonly authority: AgentTurnLogOwnerAuthority;
  readonly onStatus?: (status: AgentTurnLogSlotStatus) => void;
  readonly flushIntervalMs?: number;
}

interface WriterSlot {
  readonly scope: AgentTurnLogScope;
  readonly request: OpenAgentTurnLogSlotRequest;
  readonly buffered: AgentTurnEvent[];
  generation: number;
  window: AgentTurnWindow | null;
  bufferedBytes: number;
  writerEpoch: number;
  expectedNextSeq: number;
  persistedThroughSeq: number;
  maxBatchOps: number;
  flushing: boolean;
  flushRequested: boolean;
  sealRequested: boolean;
  reopenPending: boolean;
  inFlight: Promise<void> | null;
  opening: Promise<void> | null;
  cancelTimer: (() => void) | null;
  attempts: number;
  retryWindowStartMs: number | null;
  backpressure: boolean;
  reportedLoss: AgentTurnLogLoss;
  state: AgentTurnLogSlotState;
  final: AgentTurnLogSlotStatus | null;
}

interface InFlightBatch {
  readonly window: AgentTurnWindow;
  readonly batch: AgentTurnWindowBatch;
  readonly seal: boolean;
}

export function agentTurnLogWindowPolicy(): AgentTurnWindowPolicy {
  return {
    eventBytes: agentTurnEventUtf8Bytes,
    opBytes: agentTurnLogOpBytes,
    coalesceText: coalesceAgentTextEvents,
    maxEventBytes: MAX_AGENT_TURN_LOG_EVENT_BYTES,
    maxOpBytes: MAX_AGENT_TURN_LOG_OP_BYTES,
  };
}

export function createAgentTurnLogWriter(
  dependencies: AgentTurnLogWriterDependencies,
): AgentTurnLogWriter {
  const slots = new Map<string, WriterSlot>();
  const finals = new Map<string, AgentTurnLogSlotStatus>();
  let disposed = false;

  const publish = (slot: WriterSlot): void => {
    dependencies.onStatus?.(slotStatus(slot));
  };

  const cancelTimer = (slot: WriterSlot): void => {
    if (slot.cancelTimer === null) return;
    slot.cancelTimer();
    slot.cancelTimer = null;
  };

  const stop = (
    slot: WriterSlot,
    reason: AgentTurnLogStopReason,
    loss: AgentTurnLogLoss = INCOMPLETE_AGENT_TURN_LOG_LOSS,
  ): void => {
    cancelTimer(slot);
    slot.state = { kind: "stopped", reason };
    slot.final = { ...slotStatus(slot), pendingOps: 0, pendingBytes: 0, backpressure: false };
    release(slot);
    dependencies.onStatus?.(slot.final);
    if (reason === "sealed") {
      forget(slot);
      return;
    }
    void retire(slot, loss);
  };

  const retire = async (slot: WriterSlot, loss: AgentTurnLogLoss): Promise<void> => {
    await recordIncomplete(slot, loss);
    forget(slot);
  };

  const forget = (slot: WriterSlot): void => {
    if (slots.get(slot.scope.turnId) !== slot) return;
    slots.delete(slot.scope.turnId);
    rememberFinal(slot);
  };

  const rememberFinal = (slot: WriterSlot): void => {
    const final = slot.final;
    if (final === null) return;
    finals.delete(final.turnId);
    finals.set(final.turnId, final);
    while (finals.size > MAX_RETAINED_AGENT_TURN_LOG_FINAL_STATUSES) {
      const oldest = finals.keys().next().value;
      if (oldest === undefined) return;
      finals.delete(oldest);
    }
  };

  const release = (slot: WriterSlot): void => {
    slot.window = null;
    slot.buffered.length = 0;
    slot.bufferedBytes = 0;
    slot.backpressure = false;
    slot.inFlight = null;
    slot.opening = null;
    slot.flushing = false;
  };

  const recordIncomplete = async (slot: WriterSlot, loss: AgentTurnLogLoss): Promise<void> => {
    if (slot.writerEpoch === 0) return;
    await attempt(() =>
      dependencies.gateway.appendTurnLog({
        scope: slot.scope,
        writerEpoch: slot.writerEpoch,
        expectedNextSeq: slot.expectedNextSeq,
        ops: [],
        digest: null,
        seal: false,
        loss,
      }),
    );
  };

  const alive = (slot: WriterSlot): boolean => {
    if (disposed) return false;
    if (slots.get(slot.scope.turnId) !== slot) return false;
    if (slot.state.kind === "stopped") return false;
    if (dependencies.authority.ownsTurn(slot.scope, slot.generation)) return true;
    return adoptGeneration(slot);
  };

  const adoptGeneration = (slot: WriterSlot): boolean => {
    const generation = dependencies.authority.currentGeneration(slot.scope);
    if (generation === null || generation === slot.generation) {
      stop(slot, "ownerMismatch");
      return false;
    }
    if (!dependencies.authority.ownsTurn(slot.scope, generation)) {
      stop(slot, "ownerMismatch");
      return false;
    }
    slot.generation = generation;
    slot.reopenPending = true;
    return true;
  };

  const applyBackpressure = (slot: WriterSlot, pending: AgentTurnWindowPending): void => {
    const raised =
      pending.ops >= AGENT_TURN_LOG_BACKPRESSURE.ops ||
      pending.bytes >= AGENT_TURN_LOG_BACKPRESSURE.bytes;
    const released =
      pending.ops <= AGENT_TURN_LOG_BACKPRESSURE.releaseOps &&
      pending.bytes <= AGENT_TURN_LOG_BACKPRESSURE.releaseBytes;
    if (!slot.backpressure && raised) {
      slot.backpressure = true;
      publish(slot);
      return;
    }
    if (slot.backpressure && released) {
      slot.backpressure = false;
      publish(slot);
    }
  };

  const scheduleFlush = (slot: WriterSlot, immediate: boolean): void => {
    if (slot.state.kind === "stopped") return;
    if (slot.state.kind === "retrying") return;
    if (slot.window === null) return;
    if (immediate) {
      cancelTimer(slot);
      void runFlush(slot);
      return;
    }
    if (slot.cancelTimer !== null) return;
    slot.cancelTimer = dependencies.timers.schedule(() => {
      slot.cancelTimer = null;
      void runFlush(slot);
    }, dependencies.flushIntervalMs ?? AGENT_TURN_LOG_FLUSH_INTERVAL_MS);
  };

  const retryLater = (slot: WriterSlot, error: AgentTurnLogRetryError, retry: () => void): void => {
    slot.attempts += 1;
    if (error === "unavailable" && slot.attempts > MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS) {
      stopRetries(slot, error);
      return;
    }
    const nowMs = dependencies.timers.now();
    const startedAtMs = slot.retryWindowStartMs ?? nowMs;
    slot.retryWindowStartMs = startedAtMs;
    const delayMs = retryDelayMs(slot.attempts);
    const nextAttemptAtMs = nowMs + delayMs;
    if (nextAttemptAtMs - startedAtMs > MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS) {
      stopRetries(slot, error);
      return;
    }
    cancelTimer(slot);
    slot.state = {
      kind: "retrying",
      error,
      attempts: slot.attempts,
      nextAttemptAtMs,
    };
    publish(slot);
    slot.cancelTimer = dependencies.timers.schedule(() => {
      slot.cancelTimer = null;
      if (!alive(slot)) return;
      slot.state = slot.window === null ? { kind: "opening" } : { kind: "writing" };
      retry();
    }, delayMs);
  };

  const stopRetries = (slot: WriterSlot, error: AgentTurnLogRetryError): void => {
    const loss = retryLoss(error, dependencies.timers.now());
    if (slot.reportedLoss.kind === "none") slot.reportedLoss = loss;
    stop(slot, "failed", loss);
  };

  const handleFailure = (
    slot: WriterSlot,
    error: unknown,
    inflight: InFlightBatch | null,
    retry: () => void,
  ): void => {
    if (isAgentTurnLogBatchTooLarge(error)) return shrinkBatch(slot, inflight, retry);
    const code = agentTurnLogFailureCode(error);
    if (code === "sequenceGap") return reconcileSequenceGap(slot, error, inflight);
    if (code === "diskFull" || code === "unreadable" || code === "busy")
      return retryLater(slot, code, retry);
    if (code !== null) return stop(slot, stopReasonFor(code));
    retryLater(slot, "unavailable", retry);
  };

  const shrinkBatch = (
    slot: WriterSlot,
    inflight: InFlightBatch | null,
    retry: () => void,
  ): void => {
    const only = inflight?.batch.ops[0];
    if (inflight === null || only === undefined) return stop(slot, "failed");
    if (inflight.batch.ops.length > 1) {
      slot.maxBatchOps = Math.floor(inflight.batch.ops.length / 2);
      retry();
      return;
    }
    if (!inflight.window.clip(only.seq)) return stop(slot, "failed");
    publish(slot);
    retry();
  };

  const reconcileSequenceGap = (
    slot: WriterSlot,
    error: unknown,
    inflight: InFlightBatch | null,
  ): void => {
    const reported = agentTurnLogFailureNextSeq(error);
    const last = inflight?.batch.ops[inflight.batch.ops.length - 1]?.seq;
    if (reported === null || inflight === null || last === undefined)
      return stop(slot, "sequenceGap");
    if (reported !== Math.max(slot.expectedNextSeq, last + 1)) return stop(slot, "sequenceGap");
    settleFlush(slot, inflight, reported, reported - 1);
  };

  const beginOpen = (slot: WriterSlot): void => {
    const running = runOpen(slot);
    slot.opening = running;
    void running.then(() => {
      if (slot.opening === running) slot.opening = null;
    });
  };

  const runOpen = async (slot: WriterSlot): Promise<void> => {
    const opened = await attempt(() =>
      dependencies.gateway.openTurnLog({
        scope: slot.scope,
        priorLoss: slot.request.priorLoss,
      }),
    );
    if (!alive(slot)) return;
    if (!opened.ok) {
      handleFailure(slot, opened.error, null, () => beginOpen(slot));
      return;
    }
    adoptLease(slot, opened.value);
    const buffered = slot.buffered.splice(0);
    slot.bufferedBytes = 0;
    const acceptance = slot.window?.accept(buffered);
    publish(slot);
    if (acceptance !== undefined) applyBackpressure(slot, acceptance.pending);
    guardTurnCeiling(slot);
    scheduleFlush(slot, (acceptance?.urgent ?? false) || slot.sealRequested);
  };

  const adoptLease = (slot: WriterSlot, lease: AgentTurnLogLease): void => {
    slot.writerEpoch = lease.writerEpoch;
    slot.expectedNextSeq = lease.nextSeq;
    slot.persistedThroughSeq = lease.nextSeq - 1;
    slot.attempts = 0;
    slot.retryWindowStartMs = null;
    slot.state = { kind: "writing" };
    slot.window = createAgentTurnWindow({
      policy: agentTurnLogWindowPolicy(),
      firstSeq: lease.nextSeq,
      digest: resumedDigest(slot, lease.digest),
    });
  };

  const resumedDigest = (
    slot: WriterSlot,
    digest: AgentTurnDigestWire | null,
  ): AgentTurnDigestWire => {
    if (digest === null) return emptyAgentTurnDigest(slot.request.provider);
    if (digest.context.provider !== slot.request.provider)
      return emptyAgentTurnDigest(slot.request.provider);
    return digest;
  };

  const guardTurnCeiling = (slot: WriterSlot): void => {
    if (slot.window === null) return;
    if (slot.window.totalBytes() <= AGENT_TURN_LOG_LIMITS.turnCeilingBytes) return;
    stop(slot, "turnCeiling", { kind: "turnCeiling" });
  };

  const runFlush = async (slot: WriterSlot): Promise<void> => {
    if (!alive(slot)) return;
    const window = slot.window;
    if (window === null) return;
    if (slot.flushing) {
      slot.flushRequested = true;
      await (slot.inFlight ?? Promise.resolve());
      return;
    }
    slot.flushing = true;
    const running = flushOnce(slot, window);
    slot.inFlight = running;
    await running;
    if (slot.inFlight === running) slot.inFlight = null;
  };

  const flushOnce = async (slot: WriterSlot, window: AgentTurnWindow): Promise<void> => {
    if (slot.reopenPending) {
      const reopened = await reopenLease(slot);
      slot.flushing = false;
      if (!reopened) return;
      slot.reopenPending = false;
      void runFlush(slot);
      return;
    }
    const batch = window.take(slot.maxBatchOps, AGENT_TURN_LOG_APPEND_TARGET_BYTES);
    const seal = slot.sealRequested && batch.complete;
    if (batch.ops.length === 0 && !seal) {
      slot.flushing = false;
      return;
    }
    cancelTimer(slot);
    const inflight: InFlightBatch = { window, batch, seal };
    const written = await attempt(() =>
      dependencies.gateway.appendTurnLog({
        scope: slot.scope,
        writerEpoch: slot.writerEpoch,
        expectedNextSeq: slot.expectedNextSeq,
        ops: batch.ops,
        digest: batch.digest,
        seal,
        loss: slotLoss(slot),
      }),
    );
    slot.flushing = false;
    if (!alive(slot)) return;
    if (!written.ok) {
      handleFailure(slot, written.error, inflight, () => void runFlush(slot));
      return;
    }
    slot.maxBatchOps = AGENT_TURN_LOG_LIMITS.appendOps;
    settleFlush(slot, inflight, written.value.nextSeq, written.value.persistedThroughSeq);
  };

  const reopenLease = async (slot: WriterSlot): Promise<boolean> => {
    const opened = await attempt(() =>
      dependencies.gateway.openTurnLog({ scope: slot.scope, priorLoss: slot.request.priorLoss }),
    );
    if (!alive(slot)) return false;
    if (!opened.ok) {
      handleFailure(slot, opened.error, null, () => void runFlush(slot));
      return false;
    }
    if (opened.value.nextSeq !== slot.expectedNextSeq) {
      stop(slot, "sequenceGap");
      return false;
    }
    slot.writerEpoch = opened.value.writerEpoch;
    slot.attempts = 0;
    slot.retryWindowStartMs = null;
    return true;
  };

  const settleFlush = (
    slot: WriterSlot,
    inflight: InFlightBatch,
    nextSeq: number,
    persistedThroughSeq: number,
  ): void => {
    inflight.window.commit(inflight.batch);
    slot.attempts = 0;
    slot.retryWindowStartMs = null;
    slot.expectedNextSeq = nextSeq;
    slot.persistedThroughSeq = persistedThroughSeq;
    slot.state = { kind: "writing" };
    applyBackpressure(slot, inflight.window.pending());
    if (inflight.seal) {
      stop(slot, "sealed");
      return;
    }
    publish(slot);
    const chase = slot.flushRequested || slot.sealRequested || inflight.window.pending().ops > 0;
    slot.flushRequested = false;
    if (!chase) return;
    void runFlush(slot);
  };

  const drainSlot = async (slot: WriterSlot, deadline: number): Promise<void> => {
    for (let round = 0; round < MAX_AGENT_TURN_LOG_QUIT_FLUSH_ROUNDS; round += 1) {
      if (!alive(slot)) return;
      if (dependencies.timers.now() >= deadline) return;
      const pendingFlush = slot.inFlight;
      if (pendingFlush !== null) {
        await withinBudget(pendingFlush, deadline);
        continue;
      }
      if (slot.window === null) {
        const pendingOpen = slot.opening;
        if (pendingOpen === null) return;
        await withinBudget(pendingOpen, deadline);
        continue;
      }
      if (slot.window.pending().ops === 0) return;
      cancelTimer(slot);
      await withinBudget(runFlush(slot), deadline);
    }
  };

  const withinBudget = (work: Promise<void>, deadline: number): Promise<void> => {
    const remainingMs = deadline - dependencies.timers.now();
    if (remainingMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        cancel();
        resolve();
      };
      const cancel = dependencies.timers.schedule(finish, remainingMs);
      void work.then(finish, finish);
    });
  };

  const slotLoss = (slot: WriterSlot): AgentTurnLogLoss => {
    const observed = slot.window?.loss() ?? NO_AGENT_TURN_LOG_LOSS;
    if (observed.kind !== "none") return observed;
    if (slot.reportedLoss.kind !== "none") return slot.reportedLoss;
    return slot.request.priorLoss;
  };

  const slotStatus = (slot: WriterSlot): AgentTurnLogSlotStatus => {
    if (slot.final !== null) return slot.final;
    const pending = slot.window?.pending() ?? {
      ops: slot.buffered.length,
      bytes: slot.bufferedBytes,
    };
    return {
      turnId: slot.scope.turnId,
      threadId: slot.scope.threadId,
      state: slot.state,
      loss: slotLoss(slot),
      pendingOps: pending.ops,
      pendingBytes: pending.bytes,
      backpressure: slot.backpressure,
      persistedThroughSeq: slot.persistedThroughSeq,
      bounded: slot.window?.bounded() ?? false,
      contextWindow: agentTurnDigestContextWindow(slot.window?.digest() ?? null),
    };
  };

  return {
    openTurn(request) {
      if (disposed) return;
      const existing = slots.get(request.scope.turnId);
      if (existing !== undefined && existing.state.kind !== "stopped") return;
      if (existing !== undefined) cancelTimer(existing);
      const slot: WriterSlot = {
        scope: request.scope,
        request,
        buffered: [],
        generation: request.generation,
        window: null,
        bufferedBytes: 0,
        writerEpoch: 0,
        expectedNextSeq: 0,
        persistedThroughSeq: 0,
        maxBatchOps: AGENT_TURN_LOG_LIMITS.appendOps,
        flushing: false,
        flushRequested: false,
        sealRequested: false,
        reopenPending: false,
        inFlight: null,
        opening: null,
        cancelTimer: null,
        attempts: 0,
        retryWindowStartMs: null,
        backpressure: false,
        reportedLoss: NO_AGENT_TURN_LOG_LOSS,
        state: { kind: "opening" },
        final: null,
      };
      finals.delete(request.scope.turnId);
      slots.set(request.scope.turnId, slot);
      publish(slot);
      beginOpen(slot);
    },
    recordEvents(turnId, events) {
      if (disposed) return;
      if (events.length === 0) return;
      const slot = slots.get(turnId);
      if (slot === undefined) return;
      if (slot.state.kind === "stopped") return;
      const window = slot.window;
      if (window === null) {
        slot.buffered.push(...events);
        slot.bufferedBytes += events.reduce(
          (total, event) => total + agentTurnEventUtf8Bytes(event),
          0,
        );
        applyBackpressure(slot, { ops: slot.buffered.length, bytes: slot.bufferedBytes });
        return;
      }
      const acceptance = window.accept(events);
      applyBackpressure(slot, acceptance.pending);
      guardTurnCeiling(slot);
      scheduleFlush(slot, acceptance.urgent);
    },
    reportLoss(turnId, loss) {
      if (disposed) return;
      if (loss.kind === "none") return;
      const slot = slots.get(turnId);
      if (slot === undefined) return;
      if (slot.state.kind === "stopped") return;
      if (slot.reportedLoss.kind !== "none") return;
      slot.reportedLoss = loss;
      publish(slot);
      scheduleFlush(slot, false);
    },
    sealTurn(turnId) {
      if (disposed) return;
      const slot = slots.get(turnId);
      if (slot === undefined) return;
      if (slot.state.kind === "stopped") return;
      slot.sealRequested = true;
      scheduleFlush(slot, true);
    },
    closeTurn(turnId) {
      finals.delete(turnId);
      const slot = slots.get(turnId);
      if (slot === undefined) return;
      cancelTimer(slot);
      slots.delete(turnId);
    },
    status(turnId) {
      const slot = slots.get(turnId);
      if (slot === undefined) return finals.get(turnId) ?? null;
      return slotStatus(slot);
    },
    async flushAll(budgetMs = AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS) {
      if (disposed) return;
      const deadline = dependencies.timers.now() + budgetMs;
      await Promise.all([...slots.values()].map((slot) => drainSlot(slot, deadline)));
    },
    dispose() {
      disposed = true;
      for (const slot of slots.values()) cancelTimer(slot);
      slots.clear();
      finals.clear();
    },
  };
}

function retryDelayMs(attempts: number): number {
  const index = Math.min(attempts, AGENT_TURN_LOG_RETRY_DELAYS_MS.length) - 1;
  return AGENT_TURN_LOG_RETRY_DELAYS_MS[Math.max(index, 0)] ?? 1_000;
}

function retryLoss(error: AgentTurnLogRetryError, atEpochMs: number): AgentTurnLogLoss {
  switch (error) {
    case "diskFull":
      return { kind: "diskBudget", atEpochMs };
    case "unreadable":
      return { kind: "unreadable" };
    case "busy":
    case "unavailable":
      return INCOMPLETE_AGENT_TURN_LOG_LOSS;
    default:
      return unsupportedAgentTurnLogRetryError(error);
  }
}

function unsupportedAgentTurnLogRetryError(error: never): never {
  throw new TypeError(`Unsupported agent turn log retry error: ${JSON.stringify(error)}`);
}

function stopReasonFor(code: AgentTurnLogError): AgentTurnLogStopReason {
  switch (code) {
    case "supersededWriter":
      return "supersededWriter";
    case "sequenceGap":
      return "sequenceGap";
    case "sealed":
      return "sealed";
    case "ownerMismatch":
      return "ownerMismatch";
    case "budgetExhausted":
      return "budgetExhausted";
    case "foreign":
      return "foreign";
    case "diskFull":
    case "unreadable":
    case "busy":
      return "failed";
    default:
      return unsupportedAgentTurnLogError(code);
  }
}

function unsupportedAgentTurnLogError(code: never): never {
  throw new TypeError(`Unsupported agent turn log error: ${JSON.stringify(code)}`);
}
