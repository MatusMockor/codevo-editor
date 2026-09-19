import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentTurnEventUtf8Bytes,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import type {
  AgentTurnLogEntry,
  AgentTurnLogLease,
  AgentTurnLogPage,
  AgentTurnLogSummary,
  AppendAgentTurnLogReceipt,
  AppendAgentTurnLogRequest,
  DeleteAgentThreadLogRequest,
  OpenAgentTurnLogRequest,
  ReadAgentTurnLogPageRequest,
  SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";
import type {
  AgentTasksNotice,
  AgentThreadStoreGateway,
  AgentThreadStoreSnapshot,
  AgentThreadStoreSurface,
  DeleteAgentThreadRequest,
  SaveAgentThreadRequest,
} from "../application/agentThreadPorts";
import type { AgentTurnLogGateway, AgentTurnLogTimers } from "../application/agentTurnLogPorts";
import {
  useAgentThreadStore,
  type AgentThreadStoreDependencies,
} from "../application/useAgentThreadStore";
import {
  createAgentTurnLogIntegration,
  type AgentTurnLogIntegration,
  type AgentTurnLoggingDependencies,
} from "../application/useAgentTurnLogging";

export const LOG_ROOT_KEY = "/workspace/app";
export const LOG_OWNER_ID = agentRootOwnerId(LOG_ROOT_KEY);
export const LOG_REPOSITORY_ROOT = "/workspace/app";
export const LOG_THREAD_ID = "agt-1-0a1b";
export const LOG_TURN_ID = "agt-1-0a1c";

export function logProject(
  overrides: Partial<AgentProjectDescriptor> = {},
): AgentProjectDescriptor {
  return {
    rootKey: LOG_ROOT_KEY,
    rootPath: LOG_ROOT_KEY,
    ownerId: LOG_OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      {
        mapping: { rootRelativePath: "" },
        repositoryRoot: LOG_REPOSITORY_ROOT,
        repositoryRelativePath: "",
      },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

export function logTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: LOG_TURN_ID,
    prompt: "do the thing",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 2,
    lastOutputSequence: 2,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

export function logThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: LOG_THREAD_ID,
    owner: { rootKey: LOG_ROOT_KEY, ownerId: LOG_OWNER_ID, repositoryRoot: LOG_REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: `${LOG_REPOSITORY_ROOT}/.worktrees/one` },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: 30,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

export function logToolEvent(index: number): AgentTurnEvent {
  return { kind: "toolCall", toolId: `tool-${index}`, name: "Bash", inputSummary: `run ${index}` };
}

export function logToolEvents(length: number): ReadonlyArray<AgentTurnEvent> {
  return Array.from({ length }, (_unused, index) => logToolEvent(index));
}

export function sealedLogSummary(
  turnId: string,
  eventCount: number,
  overrides: Partial<AgentTurnLogSummary> = {},
): AgentTurnLogSummary {
  return {
    turnId,
    eventCount,
    bytes: eventCount * 64,
    loss: { kind: "none" },
    sealed: true,
    digest: null,
    ...overrides,
  };
}

export interface InMemoryTurnLogGateway extends AgentTurnLogGateway {
  readonly opens: OpenAgentTurnLogRequest[];
  readonly appends: AppendAgentTurnLogRequest[];
  readonly reads: ReadAgentTurnLogPageRequest[];
  readonly summarized: SummarizeAgentTurnLogsRequest[];
  readonly deletedLogs: DeleteAgentThreadLogRequest[];
  readonly rows: Map<string, AgentTurnLogEntry[]>;
  readonly summariesByThread: Map<string, ReadonlyArray<AgentTurnLogSummary>>;
  summaries: ReadonlyArray<AgentTurnLogSummary>;
  readFails: boolean;
  deleteFails: boolean;
  holdReads: boolean;
  holdSummaries: boolean;
  releaseReads(): void;
  releaseSummaries(): void;
  seed(turnId: string, events: ReadonlyArray<AgentTurnEvent>): void;
}

export function inMemoryTurnLogGateway(): InMemoryTurnLogGateway {
  const gates: Array<() => void> = [];
  const summaryGates: Array<() => void> = [];
  const rows = new Map<string, AgentTurnLogEntry[]>();
  const rowsOf = (turnId: string): AgentTurnLogEntry[] => {
    const existing = rows.get(turnId);
    if (existing !== undefined) return existing;
    const created: AgentTurnLogEntry[] = [];
    rows.set(turnId, created);
    return created;
  };
  const nextSeqOf = (turnId: string): number => {
    const entries = rowsOf(turnId);
    return (entries[entries.length - 1]?.seq ?? 0) + 1;
  };

  const gateway: InMemoryTurnLogGateway = {
    opens: [],
    appends: [],
    reads: [],
    summarized: [],
    deletedLogs: [],
    rows,
    summariesByThread: new Map<string, ReadonlyArray<AgentTurnLogSummary>>(),
    summaries: [],
    readFails: false,
    deleteFails: false,
    holdReads: false,
    holdSummaries: false,
    releaseReads() {
      for (const gate of gates.splice(0)) gate();
    },
    releaseSummaries() {
      for (const gate of summaryGates.splice(0)) gate();
    },
    seed(turnId, events) {
      rows.set(
        turnId,
        events.map((event, index) => ({ seq: index + 1, event })),
      );
    },
    async openTurnLog(request): Promise<AgentTurnLogLease> {
      gateway.opens.push(request);
      return {
        writerEpoch: gateway.opens.length,
        nextSeq: nextSeqOf(request.scope.turnId),
        digest: null,
        digestThroughSeq: 0,
      };
    },
    async appendTurnLog(request): Promise<AppendAgentTurnLogReceipt> {
      gateway.appends.push(request);
      const entries = rowsOf(request.scope.turnId);
      for (const op of request.ops) {
        const index = entries.findIndex((entry) => entry.seq === op.seq);
        if (index === -1) entries.push(op);
        if (index !== -1) entries[index] = op;
      }
      const nextSeq = nextSeqOf(request.scope.turnId);
      return { persistedThroughSeq: nextSeq - 1, nextSeq, turnBytes: 0, budget: "ok" };
    },
    async readTurnLogPage(request): Promise<AgentTurnLogPage> {
      gateway.reads.push(request);
      if (gateway.holdReads) await new Promise<void>((resolve) => gates.push(resolve));
      if (gateway.readFails) throw new Error("unreadable");
      return pageOf(rowsOf(request.scope.turnId), request);
    },
    async summarizeTurnLogs(request) {
      gateway.summarized.push(request);
      if (gateway.holdSummaries) await new Promise<void>((resolve) => summaryGates.push(resolve));
      return gateway.summariesByThread.get(request.threadId) ?? gateway.summaries;
    },
    async deleteThreadLog(request) {
      gateway.deletedLogs.push(request);
      if (gateway.deleteFails) throw new Error("unreadable");
      return { deleted: true };
    },
  };
  return gateway;
}

function pageOf(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  request: ReadAgentTurnLogPageRequest,
): AgentTurnLogPage {
  const anchor = request.anchor;
  const eligible =
    anchor.at === "before" ? entries.filter((entry) => entry.seq < anchor.seq) : entries;
  const selected: AgentTurnLogEntry[] = [];
  let bytes = 0;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const entry = eligible[index]!;
    const size = agentTurnEventUtf8Bytes(entry.event);
    if (selected.length >= request.maxEvents) break;
    if (selected.length > 0 && bytes + size > request.maxBytes) break;
    selected.unshift(entry);
    bytes += size;
  }
  const firstSeq = selected[0]?.seq ?? 0;
  const lastSeq = selected[selected.length - 1]?.seq ?? 0;
  return {
    entries: selected,
    firstSeq,
    lastSeq,
    hasEarlier: entries.some((entry) => entry.seq < firstSeq),
    hasLater: entries.some((entry) => entry.seq > lastSeq),
    loss: { kind: "none" },
    clipped: selected.length < eligible.length,
  };
}

export function manualLogTimers() {
  const pending = new Map<number, { at: number; run: () => void }>();
  let handle = 0;
  const state = { clock: 0 };
  const timers: AgentTurnLogTimers = {
    now: () => state.clock,
    schedule: (run, delayMs) => {
      handle += 1;
      const key = handle;
      pending.set(key, { at: state.clock + delayMs, run });
      return () => pending.delete(key);
    },
  };
  const advance = (ms: number): void => {
    state.clock += ms;
    for (const [key, entry] of [...pending]) {
      if (entry.at > state.clock) continue;
      pending.delete(key);
      entry.run();
    }
  };
  return { timers, advance };
}

interface LogStoreEnvironment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
}

export interface LogStoreOptions {
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly persisted?: ReadonlyArray<AgentThread>;
  readonly summaries?: ReadonlyArray<AgentTurnLogSummary>;
  readonly summariesByThread?: ReadonlyMap<string, ReadonlyArray<AgentTurnLogSummary>>;
}

export function renderLogStore(options: LogStoreOptions = {}) {
  const environment: LogStoreEnvironment = { projects: options.projects ?? [logProject()] };
  const snapshots = new Map<string, AgentThreadStoreSnapshot>();
  snapshots.set(LOG_ROOT_KEY, { threads: options.persisted ?? [], unreadable: [], evicted: 0 });
  const saved: SaveAgentThreadRequest[] = [];
  const deleted: DeleteAgentThreadRequest[] = [];
  const notices: Array<AgentTasksNotice | null> = [];
  const threadGateway = {
    deleteFails: false,
    loadAgentThreads: async (request: { rootKey: string }) =>
      snapshots.get(request.rootKey) ?? { threads: [], unreadable: [], evicted: 0 },
    saveAgentThread: async (request: SaveAgentThreadRequest) => {
      saved.push(request);
    },
    deleteAgentThread: async (request: DeleteAgentThreadRequest) => {
      deleted.push(request);
      if (threadGateway.deleteFails) throw new Error("Unable to delete the saved thread.");
    },
  };

  const logGateway = inMemoryTurnLogGateway();
  logGateway.summaries = options.summaries ?? [];
  for (const [threadId, summaries] of options.summariesByThread ?? []) {
    logGateway.summariesByThread.set(threadId, summaries);
  }
  const clock = manualLogTimers();
  const captured: { value: AgentThreadStoreSurface | null; renders: number } = {
    value: null,
    renders: 0,
  };
  const loggingRef: { current: AgentTurnLoggingDependencies } = {
    current: {
      gateway: logGateway,
      projects: environment.projects,
      timers: clock.timers,
      now: () => clock.timers.now(),
      loggedThreadRootKey: (threadId) =>
        captured.value?.currentState().threads.get(threadId)?.owner.rootKey ?? null,
    },
  };
  const turnLog: AgentTurnLogIntegration = createAgentTurnLogIntegration(loggingRef);
  const reportError = vi.fn();

  const dependencies = (): AgentThreadStoreDependencies => ({
    agentThreadStoreGateway: threadGateway as unknown as AgentThreadStoreGateway,
    projects: environment.projects,
    agentModeActive: true,
    reportError,
    setNotice: (notice) => notices.push(notice),
    turnLog,
  });

  const host = document.createElement("div");
  const root = createRoot(host);

  function Harness(props: { readonly dependencies: AgentThreadStoreDependencies }) {
    captured.value = useAgentThreadStore(props.dependencies);
    captured.renders += 1;
    return null;
  }

  const render = () =>
    act(() => root.render(createElement(Harness, { dependencies: dependencies() })));
  render();

  return {
    clock,
    logGateway,
    threadGateway,
    saved,
    deleted,
    notices,
    reportError,
    turnLog,
    renders: () => captured.renders,
    hook: () => captured.value as AgentThreadStoreSurface,
    turnOf: (threadId: string, turnId: string): AgentTurn | undefined =>
      (captured.value as AgentThreadStoreSurface)
        .currentState()
        .threads.get(threadId)
        ?.turns.find((turn) => turn.turnId === turnId),
    setProjects: (projects: ReadonlyArray<AgentProjectDescriptor>) => {
      environment.projects = projects;
      loggingRef.current = { ...loggingRef.current, projects };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

export async function settleLogStore(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
  });
}
