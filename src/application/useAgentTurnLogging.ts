import { useEffect, useLayoutEffect, useRef } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type {
  AgentTurnLogPage,
  AgentTurnLogScope,
  AgentTurnLogSummary,
  DeleteAgentThreadLogRequest,
  DeleteAgentThreadLogResult,
  ReadAgentTurnLogPageRequest,
  SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";
import {
  createAgentTurnLogFactsStore,
  type AgentTurnLogFactsStore,
} from "./agentTurnLogStatusStore";
import {
  createAgentTurnLogSummaryRequester,
  type AgentTurnLogSummaryRequester,
} from "./agentTurnLogSummaryRequests";
import {
  AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS,
  systemAgentTurnLogTimers,
  type AgentTurnLogGateway,
  type AgentTurnLogOwnerAuthority,
  type AgentTurnLogSlotStatus,
  type AgentTurnLogTimers,
  type AgentTurnLogWriter,
  type OpenAgentTurnLogSlotRequest,
} from "./agentTurnLogPorts";
import { createAgentTurnLogWriter } from "./agentTurnLogWriter";

export const MAX_TRACKED_OPEN_AGENT_TURN_LOGS = 64;

export interface AgentTurnLogIntegration {
  readonly writer: AgentTurnLogWriter;
  readonly facts: AgentTurnLogFactsStore;
  readonly summarize: (
    request: SummarizeAgentTurnLogsRequest,
  ) => Promise<ReadonlyArray<AgentTurnLogSummary>>;
  readonly readPage: (request: ReadAgentTurnLogPageRequest) => Promise<AgentTurnLogPage>;
  readonly deleteThreadLog: (
    request: DeleteAgentThreadLogRequest,
  ) => Promise<DeleteAgentThreadLogResult>;
}

export interface AgentTurnLogLifecycle {
  readonly integration: AgentTurnLogIntegration;
  mount(): void;
  unmount(): void;
}

export interface AgentTurnLoggingDependencies {
  readonly gateway: AgentTurnLogGateway;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly timers?: AgentTurnLogTimers;
  readonly now?: () => number;
  readonly loggedThreadRootKey?: (threadId: string) => string | null;
}

export function useAgentTurnLogging(
  dependencies: AgentTurnLoggingDependencies,
): AgentTurnLogIntegration {
  const dependenciesRef = useRef(dependencies);
  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  const lifecycleRef = useRef<AgentTurnLogLifecycle | null>(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = createAgentTurnLogLifecycle(dependenciesRef);
  }
  const lifecycle = lifecycleRef.current;

  useEffect(() => {
    lifecycle.mount();
    return () => lifecycle.unmount();
  }, [lifecycle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = (): void => {
      void lifecycle.integration.writer.flushAll(AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [lifecycle]);

  return lifecycle.integration;
}

interface AgentTurnLoggingRef {
  readonly current: AgentTurnLoggingDependencies;
}

type LifecyclePhase = "idle" | "mounted" | "unmounted";

export function createAgentTurnLogIntegration(
  dependenciesRef: AgentTurnLoggingRef,
): AgentTurnLogIntegration {
  return createAgentTurnLogLifecycle(dependenciesRef).integration;
}

export function createAgentTurnLogLifecycle(
  dependenciesRef: AgentTurnLoggingRef,
): AgentTurnLogLifecycle {
  const now = (): number => (dependenciesRef.current.now ?? Date.now)();
  const openRequests = new Map<string, OpenAgentTurnLogSlotRequest>();
  let phase: LifecyclePhase = "idle";
  let live: AgentTurnLogWriter | null = null;
  let retiring: Promise<void> | null = null;
  let summaryRequester: AgentTurnLogSummaryRequester | null = null;

  const facts = createAgentTurnLogFactsStore(now, (threadId) => summaryRequester?.ensure(threadId));

  const authority: AgentTurnLogOwnerAuthority = {
    ownsTurn: (scope, generation) =>
      ownsAgentTurnLogScope(dependenciesRef.current.projects, scope, generation),
    currentGeneration: (scope) =>
      currentAgentTurnLogGeneration(dependenciesRef.current.projects, scope),
  };

  const requester = createAgentTurnLogSummaryRequester({
    facts,
    summarize: (request) => dependenciesRef.current.gateway.summarizeTurnLogs(request),
    scopeOf: (threadId) => summaryScopeOf(dependenciesRef.current, threadId),
    generationOf: (request) =>
      currentAgentTurnLogGeneration(dependenciesRef.current.projects, request),
    active: () => phase !== "unmounted",
  });
  summaryRequester = requester;

  const onStatus = (writer: AgentTurnLogWriter, status: AgentTurnLogSlotStatus): void => {
    if (live !== writer) return;
    const threadId =
      openRequests.get(status.turnId)?.scope.threadId ?? facts.threadIdOf(status.turnId);
    if (status.state.kind === "stopped") openRequests.delete(status.turnId);
    if (threadId === null) return;
    facts.publishSlot(threadId, status);
  };

  const createWriter = (): AgentTurnLogWriter => {
    const writer: AgentTurnLogWriter = createAgentTurnLogWriter({
      gateway: {
        openTurnLog: (request) => {
          const gateway = dependenciesRef.current.gateway;
          const pending = retiring;
          if (pending === null) return gateway.openTurnLog(request);
          return pending.then(() => dependenciesRef.current.gateway.openTurnLog(request));
        },
        appendTurnLog: (request) => dependenciesRef.current.gateway.appendTurnLog(request),
        readTurnLogPage: (request) => dependenciesRef.current.gateway.readTurnLogPage(request),
        summarizeTurnLogs: (request) => dependenciesRef.current.gateway.summarizeTurnLogs(request),
        deleteThreadLog: (request) => dependenciesRef.current.gateway.deleteThreadLog(request),
      },
      timers: dependenciesRef.current.timers ?? systemAgentTurnLogTimers,
      authority,
      onStatus: (status) => onStatus(writer, status),
    });
    return writer;
  };

  const reopenLiveTurns = (writer: AgentTurnLogWriter): void => {
    for (const [turnId, request] of [...openRequests]) {
      const generation = authority.currentGeneration(request.scope);
      if (generation === null) {
        openRequests.delete(turnId);
        continue;
      }
      writer.openTurn({ ...request, generation });
    }
  };

  const liveWriter = (): AgentTurnLogWriter | null => {
    if (phase === "unmounted") return null;
    if (live !== null) return live;
    live = createWriter();
    reopenLiveTurns(live);
    return live;
  };

  const retire = (writer: AgentTurnLogWriter): void => {
    const settled = writer
      .flushAll(AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS)
      .catch(() => undefined)
      .then(() => {
        writer.dispose();
        if (retiring === settled) retiring = null;
      });
    retiring = settled;
  };

  const trackOpenRequest = (request: OpenAgentTurnLogSlotRequest): void => {
    openRequests.delete(request.scope.turnId);
    openRequests.set(request.scope.turnId, request);
    while (openRequests.size > MAX_TRACKED_OPEN_AGENT_TURN_LOGS) {
      const oldest = openRequests.keys().next().value;
      if (oldest === undefined) return;
      openRequests.delete(oldest);
    }
  };

  const writer: AgentTurnLogWriter = {
    openTurn(request) {
      const target = liveWriter();
      if (target === null) return;
      trackOpenRequest(request);
      target.openTurn(request);
    },
    recordEvents: (turnId, events) => liveWriter()?.recordEvents(turnId, events),
    reportLoss: (turnId, loss) => liveWriter()?.reportLoss(turnId, loss),
    sealTurn: (turnId) => liveWriter()?.sealTurn(turnId),
    closeTurn(turnId) {
      openRequests.delete(turnId);
      live?.closeTurn(turnId);
    },
    status: (turnId) => live?.status(turnId) ?? null,
    flushAll: (budgetMs) => live?.flushAll(budgetMs) ?? Promise.resolve(),
    dispose() {
      openRequests.clear();
      phase = "unmounted";
      live?.dispose();
      live = null;
    },
  };

  return {
    integration: {
      writer,
      facts,
      summarize: (request) => dependenciesRef.current.gateway.summarizeTurnLogs(request),
      readPage: (request) => dependenciesRef.current.gateway.readTurnLogPage(request),
      deleteThreadLog: (request) => dependenciesRef.current.gateway.deleteThreadLog(request),
    },
    mount() {
      phase = "mounted";
      liveWriter();
    },
    unmount() {
      phase = "unmounted";
      requester.cancel();
      const writer = live;
      live = null;
      if (writer === null) return;
      retire(writer);
    },
  };
}

function summaryScopeOf(
  dependencies: AgentTurnLoggingDependencies,
  threadId: string,
): SummarizeAgentTurnLogsRequest | null {
  const rootKey = dependencies.loggedThreadRootKey?.(threadId) ?? null;
  if (rootKey === null) return null;
  return { rootKey, ownerId: agentRootOwnerId(rootKey), threadId };
}

export function ownsAgentTurnLogScope(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  scope: AgentTurnLogScope,
  generation: number,
): boolean {
  return currentAgentTurnLogGeneration(projects, scope) === generation;
}

export function currentAgentTurnLogGeneration(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  scope: Pick<AgentTurnLogScope, "rootKey" | "ownerId">,
): number | null {
  const project = projects.find((candidate) => candidate.rootKey === scope.rootKey);
  if (project === undefined) return null;
  if (agentRootOwnerId(project.rootKey) !== scope.ownerId) return null;
  return project.generation;
}
