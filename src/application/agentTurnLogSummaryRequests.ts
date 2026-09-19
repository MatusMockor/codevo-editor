import type { AgentTurnLogSummary, SummarizeAgentTurnLogsRequest } from "../domain/agentTurnLog";
import type { AgentTurnLogTimers } from "./agentTurnLogPorts";
import type { AgentTurnLogFactsStore } from "./agentTurnLogStatusStore";

export const MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS = 4;
export const MAX_QUEUED_AGENT_TURN_LOG_SUMMARY_REQUESTS = 16;
export const MAX_REMEMBERED_AGENT_TURN_LOG_SUMMARY_THREADS = 64;
export const AGENT_TURN_LOG_SUMMARY_REQUEST_TIMEOUT_MS = 10_000;
export const AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS = [2_000, 10_000, 60_000] as const;

export interface AgentTurnLogSummaryRequestPorts {
  readonly facts: AgentTurnLogFactsStore;
  readonly summarize: (
    request: SummarizeAgentTurnLogsRequest,
  ) => Promise<ReadonlyArray<AgentTurnLogSummary>>;
  readonly scopeOf: (threadId: string) => SummarizeAgentTurnLogsRequest | null;
  readonly generationOf: (request: SummarizeAgentTurnLogsRequest) => number | null;
  readonly active: () => boolean;
  readonly timers: AgentTurnLogTimers;
}

export interface AgentTurnLogSummaryRequester {
  ensure(threadId: string, turnIds: ReadonlyArray<string>): Promise<void>;
  rearm(threadId: string): void;
  cancel(): void;
}

type RequestOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

interface RetryState {
  readonly generation: number;
  readonly turnIds: ReadonlyArray<string>;
  readonly failures: number;
  cancel: (() => void) | null;
  waiting: boolean;
  exhausted: boolean;
}

interface CoverageState {
  readonly generation: number;
  readonly uncovered: ReadonlySet<string>;
}

export function createAgentTurnLogSummaryRequester(
  ports: AgentTurnLogSummaryRequestPorts,
): AgentTurnLogSummaryRequester {
  const inFlight = new Map<string, number>();
  const queued = new Map<string, ReadonlyArray<string>>();
  const retries = new Map<string, RetryState>();
  const coverage = new Map<string, CoverageState>();
  const waiters = new Map<string, Array<() => void>>();
  let run = 0;

  const generationFor = (threadId: string): number | null => {
    const scope = ports.scopeOf(threadId);
    if (scope === null) return null;
    return ports.generationOf(scope);
  };

  const cancelRetry = (state: RetryState | undefined): void => {
    if (state === undefined) return;
    state.cancel?.();
    state.cancel = null;
  };

  const rememberBounded = <T>(
    store: Map<string, T>,
    threadId: string,
    value: T,
    dispose: (stale: T) => void,
  ): void => {
    store.delete(threadId);
    store.set(threadId, value);
    while (store.size > MAX_REMEMBERED_AGENT_TURN_LOG_SUMMARY_THREADS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) return;
      const stale = store.get(oldest);
      store.delete(oldest);
      if (stale !== undefined) dispose(stale);
    }
  };

  const rememberRetry = (threadId: string, state: RetryState): void =>
    rememberBounded(retries, threadId, state, cancelRetry);

  const rememberCoverage = (threadId: string, state: CoverageState): void =>
    rememberBounded(coverage, threadId, state, forgetCoverage);

  const clearRetry = (threadId: string): void => {
    const state = retries.get(threadId);
    retries.delete(threadId);
    cancelRetry(state);
  };

  const waitersOf = (threadId: string): Array<() => void> => {
    const existing = waiters.get(threadId);
    if (existing !== undefined) return existing;
    const created: Array<() => void> = [];
    waiters.set(threadId, created);
    return created;
  };

  const waitFor = (threadId: string): Promise<void> =>
    new Promise<void>((resolve) => waitersOf(threadId).push(resolve));

  const release = (threadId: string): void => {
    const pending = waiters.get(threadId);
    waiters.delete(threadId);
    if (pending === undefined) return;
    for (const resolve of pending) resolve();
  };

  const missingTurnIds = (
    threadId: string,
    turnIds: ReadonlyArray<string>,
  ): ReadonlyArray<string> | null => {
    if (turnIds.length === 0) return ports.facts.hasThreadFacts(threadId) ? null : [];
    const missing = turnIds.filter((turnId) => ports.facts.factsOf(turnId) === null);
    return missing.length === 0 ? null : missing;
  };

  const eligible = (threadId: string, turnIds: ReadonlyArray<string>): boolean => {
    if (!ports.active()) return false;
    if (inFlight.has(threadId)) return false;
    const retry = retries.get(threadId);
    if (retry?.exhausted === true) return false;
    if (retry?.waiting === true) return false;
    const missing = missingTurnIds(threadId, turnIds);
    if (missing === null) return false;
    const covered = coverage.get(threadId);
    if (covered === undefined) return true;
    if (covered.generation !== generationFor(threadId)) return true;
    return missing.some((turnId) => !covered.uncovered.has(turnId));
  };

  const rearmOnGeneration = (threadId: string): void => {
    const generation = generationFor(threadId);
    const retry = retries.get(threadId);
    if (retry !== undefined && retry.generation !== generation) clearRetry(threadId);
    const covered = coverage.get(threadId);
    if (covered !== undefined && covered.generation !== generation) coverage.delete(threadId);
  };

  const enqueue = (threadId: string, turnIds: ReadonlyArray<string>): void => {
    const previous = queued.get(threadId) ?? [];
    queued.delete(threadId);
    queued.set(threadId, [...new Set([...previous, ...turnIds])]);
    while (queued.size > MAX_QUEUED_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
      const oldest = queued.keys().next().value;
      if (oldest === undefined) return;
      queued.delete(oldest);
      release(oldest);
    }
  };

  const deadlined = <T>(work: Promise<T>): Promise<RequestOutcome<T>> =>
    new Promise<RequestOutcome<T>>((resolve) => {
      let open = true;
      let cancelTimer: (() => void) | null = null;
      const close = (outcome: RequestOutcome<T>): void => {
        if (!open) return;
        open = false;
        cancelTimer?.();
        resolve(outcome);
      };
      cancelTimer = ports.timers.schedule(
        () => close({ ok: false }),
        AGENT_TURN_LOG_SUMMARY_REQUEST_TIMEOUT_MS,
      );
      work.then(
        (value) => close({ ok: true, value }),
        () => close({ ok: false }),
      );
    });

  const recordFailure = (
    threadId: string,
    generation: number,
    turnIds: ReadonlyArray<string>,
  ): void => {
    const previous = retries.get(threadId);
    const failures = (previous?.generation === generation ? previous.failures : 0) + 1;
    cancelRetry(previous);
    const delayMs = AGENT_TURN_LOG_SUMMARY_RETRY_DELAYS_MS[failures - 1];
    if (delayMs === undefined) {
      rememberRetry(threadId, {
        generation,
        turnIds,
        failures,
        cancel: null,
        waiting: false,
        exhausted: true,
      });
      return;
    }
    const state: RetryState = {
      generation,
      turnIds,
      failures,
      cancel: null,
      waiting: true,
      exhausted: false,
    };
    rememberRetry(threadId, state);
    state.cancel = ports.timers.schedule(() => {
      state.waiting = false;
      state.cancel = null;
      void request(threadId, turnIds);
    }, delayMs);
  };

  const recordCoverage = (
    threadId: string,
    generation: number,
    turnIds: ReadonlyArray<string>,
  ): void => {
    const uncovered = new Set(turnIds.filter((turnId) => ports.facts.factsOf(turnId) === null));
    rememberCoverage(threadId, { generation, uncovered });
  };

  const settle = (threadId: string, token: number): void => {
    if (inFlight.get(threadId) !== token) return;
    inFlight.delete(threadId);
    release(threadId);
    pump();
  };

  const finish = (
    threadId: string,
    turnIds: ReadonlyArray<string>,
    scope: SummarizeAgentTurnLogsRequest,
    generation: number,
    token: number,
    outcome: RequestOutcome<ReadonlyArray<AgentTurnLogSummary>>,
  ): void => {
    if (run !== token) return;
    if (!ports.active()) return;
    const current = ports.scopeOf(threadId);
    if (current === null) return;
    if (current.rootKey !== scope.rootKey) return;
    if (ports.generationOf(scope) !== generation) return;
    if (!outcome.ok) {
      recordFailure(threadId, generation, turnIds);
      return;
    }
    ports.facts.publishSummaries(threadId, outcome.value, turnIds.length === 0 ? null : turnIds);
    recordCoverage(threadId, generation, turnIds);
    clearRetry(threadId);
  };

  const load = async (
    threadId: string,
    turnIds: ReadonlyArray<string>,
    scope: SummarizeAgentTurnLogsRequest,
    generation: number,
    token: number,
  ): Promise<void> => {
    const outcome = await deadlined(ports.summarize(scope));
    finish(threadId, turnIds, scope, generation, token, outcome);
    settle(threadId, token);
  };

  const start = (threadId: string, turnIds: ReadonlyArray<string>): boolean => {
    const scope = ports.scopeOf(threadId);
    if (scope === null) return false;
    const generation = ports.generationOf(scope);
    if (generation === null) return false;
    const token = run;
    inFlight.set(threadId, token);
    void load(threadId, turnIds, scope, generation, token);
    return true;
  };

  const pump = (): void => {
    while (inFlight.size < MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
      const next = queued.keys().next().value;
      if (next === undefined) return;
      const turnIds = queued.get(next) ?? [];
      queued.delete(next);
      if (!eligible(next, turnIds)) {
        release(next);
        continue;
      }
      if (!start(next, turnIds)) release(next);
    }
  };

  const request = (threadId: string, turnIds: ReadonlyArray<string>): Promise<void> => {
    rearmOnGeneration(threadId);
    if (inFlight.has(threadId)) return waitFor(threadId);
    if (!eligible(threadId, turnIds)) return Promise.resolve();
    if (inFlight.size >= MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
      enqueue(threadId, turnIds);
      return waitFor(threadId);
    }
    if (!start(threadId, turnIds)) return Promise.resolve();
    return waitFor(threadId);
  };

  return {
    ensure: request,
    rearm(threadId) {
      clearRetry(threadId);
    },
    cancel() {
      run += 1;
      inFlight.clear();
      queued.clear();
      for (const state of retries.values()) cancelRetry(state);
      retries.clear();
      coverage.clear();
      for (const threadId of [...waiters.keys()]) release(threadId);
    },
  };
}

function forgetCoverage(_stale: CoverageState): void {
  return undefined;
}
