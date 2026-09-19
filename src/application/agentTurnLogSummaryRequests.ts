import type { AgentTurnLogSummary, SummarizeAgentTurnLogsRequest } from "../domain/agentTurnLog";
import type { AgentTurnLogFactsStore } from "./agentTurnLogStatusStore";

export const MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS = 4;
export const MAX_QUEUED_AGENT_TURN_LOG_SUMMARY_REQUESTS = 16;
export const MAX_REFUSED_AGENT_TURN_LOG_SUMMARY_THREADS = 64;

export interface AgentTurnLogSummaryRequestPorts {
  readonly facts: AgentTurnLogFactsStore;
  readonly summarize: (
    request: SummarizeAgentTurnLogsRequest,
  ) => Promise<ReadonlyArray<AgentTurnLogSummary>>;
  readonly scopeOf: (threadId: string) => SummarizeAgentTurnLogsRequest | null;
  readonly generationOf: (request: SummarizeAgentTurnLogsRequest) => number | null;
  readonly active: () => boolean;
}

export interface AgentTurnLogSummaryRequester {
  ensure(threadId: string): void;
  cancel(): void;
}

export function createAgentTurnLogSummaryRequester(
  ports: AgentTurnLogSummaryRequestPorts,
): AgentTurnLogSummaryRequester {
  const inFlight = new Map<string, number>();
  const queued = new Set<string>();
  const refused = new Set<string>();
  let run = 0;

  const refuse = (threadId: string): void => {
    refused.add(threadId);
    while (refused.size > MAX_REFUSED_AGENT_TURN_LOG_SUMMARY_THREADS) {
      const oldest = refused.values().next().value;
      if (oldest === undefined) return;
      refused.delete(oldest);
    }
  };

  const eligible = (threadId: string): boolean => {
    if (!ports.active()) return false;
    if (refused.has(threadId)) return false;
    if (inFlight.has(threadId)) return false;
    return !ports.facts.hasThreadFacts(threadId);
  };

  const pump = (): void => {
    while (inFlight.size < MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
      const next = queued.values().next().value;
      if (next === undefined) return;
      queued.delete(next);
      start(next);
    }
  };

  const settle = (threadId: string, token: number): void => {
    if (inFlight.get(threadId) !== token) return;
    inFlight.delete(threadId);
    pump();
  };

  const load = async (
    threadId: string,
    scope: SummarizeAgentTurnLogsRequest,
    generation: number,
    token: number,
  ): Promise<void> => {
    try {
      const summaries = await ports.summarize(scope);
      if (run !== token) return;
      if (!ports.active()) return;
      const current = ports.scopeOf(threadId);
      if (current === null) return;
      if (current.rootKey !== scope.rootKey || current.ownerId !== scope.ownerId) return;
      if (ports.generationOf(scope) !== generation) return;
      ports.facts.publishSummaries(threadId, summaries);
    } catch {
      if (run === token) refuse(threadId);
    } finally {
      settle(threadId, token);
    }
  };

  const start = (threadId: string): void => {
    if (!eligible(threadId)) return;
    const scope = ports.scopeOf(threadId);
    if (scope === null) return;
    const generation = ports.generationOf(scope);
    if (generation === null) return;
    const token = run;
    inFlight.set(threadId, token);
    void load(threadId, scope, generation, token);
  };

  const enqueue = (threadId: string): void => {
    queued.delete(threadId);
    queued.add(threadId);
    while (queued.size > MAX_QUEUED_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
      const oldest = queued.values().next().value;
      if (oldest === undefined) return;
      queued.delete(oldest);
    }
  };

  return {
    ensure(threadId) {
      if (!eligible(threadId)) return;
      if (queued.has(threadId)) return;
      if (inFlight.size >= MAX_IN_FLIGHT_AGENT_TURN_LOG_SUMMARY_REQUESTS) {
        enqueue(threadId);
        return;
      }
      start(threadId);
    },
    cancel() {
      run += 1;
      inFlight.clear();
      queued.clear();
      refused.clear();
    },
  };
}
