import { useSyncExternalStore } from "react";
import type { AgentContextWindow } from "../domain/agentContextWindow";
import type { AgentTurnLogEvidence, AgentTurnLogHydration } from "../domain/agentTurnContentLoss";
import { agentTurnDigestContextWindow } from "../domain/agentTurnDigest";
import type { AgentTurnLogLoss, AgentTurnLogSummary } from "../domain/agentTurnLog";
import type {
  AgentTurnLogRetryError,
  AgentTurnLogSlotState,
  AgentTurnLogSlotStatus,
  AgentTurnLogStopReason,
} from "./agentTurnLogPorts";

export const MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS = 16;
export const MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD = 64;
export const AGENT_TURN_LOG_DEGRADED_NOTICE_MS = 10_000;

export type AgentTurnLogWriterHealth =
  { readonly kind: "ok" } | { readonly kind: "degraded"; readonly reason: string };

export interface AgentTurnLogFacts {
  readonly turnId: string;
  readonly logged: boolean;
  readonly loss: AgentTurnLogLoss;
  readonly sealed: boolean;
  readonly live: boolean;
  readonly hydration: AgentTurnLogHydration;
  readonly contextWindow: AgentContextWindow | null;
  readonly health: AgentTurnLogWriterHealth;
}

export type AgentTurnLogSummaryRequest = (threadId: string) => void;

export interface AgentTurnLogFactsSource {
  subscribe(listener: () => void): () => void;
  factsOf(turnId: string): AgentTurnLogFacts | null;
  threadIdOf(turnId: string): string | null;
  hasThreadFacts(threadId: string): boolean;
  evidenceRevisionOf(threadId: string): number;
  ensureThreadFacts(threadId: string): void;
}

export interface AgentTurnLogFactsStore extends AgentTurnLogFactsSource {
  publishSlot(threadId: string, status: AgentTurnLogSlotStatus): void;
  publishSummaries(threadId: string, summaries: ReadonlyArray<AgentTurnLogSummary>): void;
  publishHydration(turnId: string, hydration: AgentTurnLogHydration): void;
  forgetTurn(turnId: string): void;
  setVisibleThread(threadId: string | null): void;
  clear(): void;
}

export function agentTurnLogEvidence(facts: AgentTurnLogFacts | null): AgentTurnLogEvidence | null {
  if (facts === null) return null;
  if (!facts.logged) return null;
  return {
    loss: facts.loss,
    sealed: facts.sealed,
    live: facts.live,
    hydration: facts.hydration,
  };
}

interface FactsEntry {
  facts: AgentTurnLogFacts;
  degradedSinceMs: number | null;
}

interface ThreadEntry {
  readonly turns: Map<string, FactsEntry>;
  evidenceRevision: number;
}

const NO_SUMMARY_REQUEST: AgentTurnLogSummaryRequest = () => undefined;

export function createAgentTurnLogFactsStore(
  now: () => number,
  requestSummaries: AgentTurnLogSummaryRequest = NO_SUMMARY_REQUEST,
): AgentTurnLogFactsStore {
  const threads = new Map<string, ThreadEntry>();
  const threadOfTurn = new Map<string, string>();
  const listeners = new Set<() => void>();
  let visibleThreadId: string | null = null;
  let revision = 0;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const bump = (entry: ThreadEntry): void => {
    revision += 1;
    entry.evidenceRevision = revision;
  };

  const dropThread = (threadId: string): void => {
    const entry = threads.get(threadId);
    threads.delete(threadId);
    if (entry === undefined) return;
    for (const turnId of entry.turns.keys()) {
      if (threadOfTurn.get(turnId) !== threadId) continue;
      threadOfTurn.delete(turnId);
    }
  };

  const evictThreads = (keep: string): void => {
    while (threads.size > MAX_RETAINED_AGENT_TURN_LOG_FACT_THREADS) {
      const victim = [...threads.keys()].find(
        (threadId) => threadId !== keep && threadId !== visibleThreadId,
      );
      if (victim === undefined) return;
      dropThread(victim);
    }
  };

  const touchThread = (threadId: string): ThreadEntry => {
    const existing = threads.get(threadId);
    if (existing !== undefined) {
      threads.delete(threadId);
      threads.set(threadId, existing);
      return existing;
    }
    const created: ThreadEntry = { turns: new Map(), evidenceRevision: 0 };
    threads.set(threadId, created);
    evictThreads(threadId);
    return created;
  };

  const evictTurns = (threadId: string, entry: ThreadEntry): void => {
    while (entry.turns.size > MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD) {
      const oldest = entry.turns.keys().next().value;
      if (oldest === undefined) return;
      entry.turns.delete(oldest);
      if (threadOfTurn.get(oldest) === threadId) threadOfTurn.delete(oldest);
      bump(entry);
    }
  };

  const entryOf = (turnId: string): FactsEntry | null => {
    const threadId = threadOfTurn.get(turnId);
    if (threadId === undefined) return null;
    return threads.get(threadId)?.turns.get(turnId) ?? null;
  };

  const releaseElsewhere = (threadId: string, turnId: string): void => {
    const previousThreadId = threadOfTurn.get(turnId);
    if (previousThreadId === undefined || previousThreadId === threadId) return;
    const previous = threads.get(previousThreadId);
    if (previous === undefined) return;
    if (!previous.turns.delete(turnId)) return;
    bump(previous);
  };

  const retain = (
    threadId: string,
    turnId: string,
    facts: AgentTurnLogFacts,
    degradedSinceMs: number | null,
  ): void => {
    releaseElsewhere(threadId, turnId);
    const entry = touchThread(threadId);
    const existing = entry.turns.get(turnId);
    if (existing !== undefined && sameFacts(existing.facts, facts)) {
      existing.degradedSinceMs = degradedSinceMs;
      return;
    }
    entry.turns.delete(turnId);
    entry.turns.set(turnId, { facts, degradedSinceMs });
    threadOfTurn.set(turnId, threadId);
    if (existing === undefined || !sameEvidence(existing.facts, facts)) bump(entry);
    evictTurns(threadId, entry);
    notify();
  };

  return {
    publishSlot(threadId, status) {
      const existing = entryOf(status.turnId);
      const degradedSinceMs = degradedSince(existing?.degradedSinceMs ?? null, status.state, now());
      retain(
        threadId,
        status.turnId,
        {
          turnId: status.turnId,
          logged: true,
          loss: status.loss,
          sealed: status.state.kind === "stopped" && status.state.reason === "sealed",
          live: status.state.kind !== "stopped",
          hydration: existing?.facts.hydration ?? "notAttempted",
          contextWindow: status.contextWindow,
          health: writerHealth(status, degradedSinceMs, now()),
        },
        degradedSinceMs,
      );
    },
    publishSummaries(threadId, summaries) {
      touchThread(threadId);
      for (const summary of summaries.slice(-MAX_RETAINED_AGENT_TURN_LOG_FACTS_PER_THREAD)) {
        const existing = entryOf(summary.turnId);
        if (existing?.facts.live === true) continue;
        retain(
          threadId,
          summary.turnId,
          {
            turnId: summary.turnId,
            logged: true,
            loss: summary.loss,
            sealed: summary.sealed,
            live: false,
            hydration: existing?.facts.hydration ?? "notAttempted",
            contextWindow: agentTurnDigestContextWindow(summary.digest),
            health: HEALTHY,
          },
          null,
        );
      }
    },
    publishHydration(turnId, hydration) {
      const threadId = threadOfTurn.get(turnId);
      if (threadId === undefined) return;
      const existing = entryOf(turnId);
      if (existing === null) return;
      if (existing.facts.hydration === hydration) return;
      retain(threadId, turnId, { ...existing.facts, hydration }, existing.degradedSinceMs);
    },
    forgetTurn(turnId) {
      const threadId = threadOfTurn.get(turnId);
      if (threadId === undefined) return;
      threadOfTurn.delete(turnId);
      const entry = threads.get(threadId);
      if (entry === undefined) return;
      if (!entry.turns.delete(turnId)) return;
      bump(entry);
      if (entry.turns.size === 0) threads.delete(threadId);
      notify();
    },
    setVisibleThread(threadId) {
      visibleThreadId = threadId;
      if (threadId === null) return;
      if (!threads.has(threadId)) return;
      touchThread(threadId);
    },
    clear() {
      if (threads.size === 0) return;
      threads.clear();
      threadOfTurn.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    factsOf(turnId) {
      return entryOf(turnId)?.facts ?? null;
    },
    threadIdOf(turnId) {
      return threadOfTurn.get(turnId) ?? null;
    },
    hasThreadFacts(threadId) {
      return threads.has(threadId);
    },
    evidenceRevisionOf(threadId) {
      return threads.get(threadId)?.evidenceRevision ?? 0;
    },
    ensureThreadFacts(threadId) {
      requestSummaries(threadId);
    },
  };
}

const HEALTHY: AgentTurnLogWriterHealth = Object.freeze({ kind: "ok" });

export function useAgentTurnLogFacts(
  source: AgentTurnLogFactsSource | null,
  turnId: string | null,
): AgentTurnLogFacts | null {
  const subscribe = source === null ? subscribeToNothing : source.subscribe;
  const read = (): AgentTurnLogFacts | null => {
    if (source === null || turnId === null) return null;
    return source.factsOf(turnId);
  };
  return useSyncExternalStore(subscribe, read, read);
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function degradedSince(
  current: number | null,
  state: AgentTurnLogSlotState,
  nowMs: number,
): number | null {
  if (state.kind === "retrying") return current ?? nowMs;
  return null;
}

function writerHealth(
  status: AgentTurnLogSlotStatus,
  degradedSinceMs: number | null,
  nowMs: number,
): AgentTurnLogWriterHealth {
  const { state } = status;
  if (state.kind === "stopped") {
    const reason = stoppedReason(state.reason);
    return reason === null ? HEALTHY : { kind: "degraded", reason };
  }
  if (state.kind !== "retrying") return HEALTHY;
  if (degradedSinceMs === null) return HEALTHY;
  if (nowMs - degradedSinceMs < AGENT_TURN_LOG_DEGRADED_NOTICE_MS) return HEALTHY;
  return { kind: "degraded", reason: retryReason(state.error) };
}

function stoppedReason(reason: AgentTurnLogStopReason): string | null {
  switch (reason) {
    case "sealed":
      return null;
    case "turnCeiling":
      return "this turn reached its recording limit";
    case "budgetExhausted":
      return "the recording budget is exhausted";
    case "supersededWriter":
      return "another window took over this conversation";
    case "ownerMismatch":
      return "this project is no longer open";
    case "sequenceGap":
      return "the recorded order could not be kept";
    case "foreign":
      return "the log belongs to another build";
    case "failed":
      return "the log could not be written";
    default:
      return unsupportedStopReason(reason);
  }
}

function retryReason(error: AgentTurnLogRetryError): string {
  switch (error) {
    case "diskFull":
      return "the disk is full";
    case "unreadable":
      return "the log could not be read";
    case "busy":
      return "the log is busy";
    case "unavailable":
      return "the log is not responding";
    default:
      return unsupportedRetryError(error);
  }
}

function sameFacts(left: AgentTurnLogFacts, right: AgentTurnLogFacts): boolean {
  return (
    sameEvidence(left, right) &&
    sameContextWindow(left.contextWindow, right.contextWindow) &&
    sameHealth(left.health, right.health)
  );
}

function sameEvidence(left: AgentTurnLogFacts, right: AgentTurnLogFacts): boolean {
  return (
    left.turnId === right.turnId &&
    left.logged === right.logged &&
    left.sealed === right.sealed &&
    left.live === right.live &&
    left.hydration === right.hydration &&
    sameLoss(left.loss, right.loss)
  );
}

function sameLoss(left: AgentTurnLogLoss, right: AgentTurnLogLoss): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "diskBudget" && right.kind === "diskBudget")
    return left.atEpochMs === right.atEpochMs;
  return true;
}

function sameContextWindow(
  left: AgentContextWindow | null,
  right: AgentContextWindow | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.usedTokens === right.usedTokens && left.contextWindow === right.contextWindow;
}

function sameHealth(left: AgentTurnLogWriterHealth, right: AgentTurnLogWriterHealth): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "degraded" && right.kind === "degraded") return left.reason === right.reason;
  return true;
}

function unsupportedStopReason(reason: never): never {
  throw new TypeError(`Unsupported agent turn log stop reason: ${JSON.stringify(reason)}.`);
}

function unsupportedRetryError(error: never): never {
  throw new TypeError(`Unsupported agent turn log retry error: ${JSON.stringify(error)}.`);
}
