// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTaskStatusEvent } from "../domain/agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  serializeAgentThread,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { MAX_PERSISTED_AGENT_EVENTS_PER_TURN } from "../domain/agentThreadTailCap";
import type {
  AgentTurnLogLease,
  AgentTurnLogSummary,
  AppendAgentTurnLogReceipt,
  AppendAgentTurnLogRequest,
  DeleteAgentThreadLogRequest,
  OpenAgentTurnLogRequest,
  SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";
import { agentTurnStream } from "../test/agentTurnEventStreams";
import type {
  AgentThreadStoreGateway,
  AgentThreadStoreSnapshot,
  AgentThreadStoreSurface,
  SaveAgentThreadRequest,
} from "./agentThreadPorts";
import type { AgentTurnLogGateway, AgentTurnLogTimers } from "./agentTurnLogPorts";
import {
  MIN_AGENT_THREAD_PERSIST_INTERVAL_MS,
  useAgentThreadStore,
  type AgentThreadStoreDependencies,
} from "./useAgentThreadStore";
import {
  createAgentTurnLogIntegration,
  type AgentTurnLogIntegration,
  type AgentTurnLoggingDependencies,
} from "./useAgentTurnLogging";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);
const REPOSITORY_ROOT = "/workspace/app";
const WORKTREE = `${REPOSITORY_ROOT}/.worktrees/agt-1-0a1b`;
const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      {
        mapping: { rootRelativePath: "" },
        repositoryRoot: REPOSITORY_ROOT,
        repositoryRelativePath: "",
      },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "do the thing",
    status: { kind: "pending" },
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function appended(events: ReadonlyArray<AgentTurnEvent>, outputSequence: number, overrides = {}) {
  return {
    kind: "turnEventsAppended" as const,
    threadId: THREAD_ID,
    turnId: TURN_ID,
    workspaceId: OWNER_ID,
    repositoryRoot: REPOSITORY_ROOT,
    isolation: "worktree" as const,
    worktreePath: WORKTREE,
    outputSequence,
    events,
    sessionId: null,
    supervisorTruncated: false,
    ...overrides,
  };
}

function statusEvent(
  sequence: number,
  status: AgentTaskStatusEvent["status"],
): AgentTaskStatusEvent {
  return {
    taskId: TURN_ID,
    workspaceId: OWNER_ID,
    repositoryRoot: REPOSITORY_ROOT,
    isolation: "worktree",
    worktreePath: WORKTREE,
    sequence,
    status,
  } as AgentTaskStatusEvent;
}

interface FakeTurnLogGateway extends AgentTurnLogGateway {
  readonly opens: OpenAgentTurnLogRequest[];
  readonly appends: AppendAgentTurnLogRequest[];
  readonly summarized: SummarizeAgentTurnLogsRequest[];
  readonly deletedLogs: DeleteAgentThreadLogRequest[];
  summaries: ReadonlyArray<AgentTurnLogSummary>;
  summarizeFails: boolean;
  holdOpen: boolean;
  releaseOpen(): void;
}

function fakeTurnLogGateway(): FakeTurnLogGateway {
  const opens: OpenAgentTurnLogRequest[] = [];
  const appends: AppendAgentTurnLogRequest[] = [];
  const summarized: SummarizeAgentTurnLogsRequest[] = [];
  const deletedLogs: DeleteAgentThreadLogRequest[] = [];
  const gates: Array<() => void> = [];
  let nextSeq = 1;

  const gateway: FakeTurnLogGateway = {
    opens,
    appends,
    summarized,
    deletedLogs,
    summaries: [],
    summarizeFails: false,
    holdOpen: false,
    releaseOpen() {
      for (const gate of gates.splice(0)) gate();
    },
    async openTurnLog(request: OpenAgentTurnLogRequest): Promise<AgentTurnLogLease> {
      opens.push(request);
      if (gateway.holdOpen) await new Promise<void>((resolve) => gates.push(resolve));
      return { writerEpoch: opens.length, nextSeq, digest: null, digestThroughSeq: 0 };
    },
    async appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt> {
      appends.push(request);
      const highest = request.ops.reduce((top, op) => Math.max(top, op.seq), nextSeq - 1);
      nextSeq = highest + 1;
      return { persistedThroughSeq: highest, nextSeq, turnBytes: 0, budget: "ok" };
    },
    async readTurnLogPage() {
      throw new Error("not used");
    },
    async summarizeTurnLogs(request: SummarizeAgentTurnLogsRequest) {
      summarized.push(request);
      if (gateway.summarizeFails) throw new Error("log unavailable");
      return gateway.summaries;
    },
    async deleteThreadLog(request: DeleteAgentThreadLogRequest) {
      deletedLogs.push(request);
      return { deleted: true };
    },
  };
  return gateway;
}

function manualTimers() {
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
  return { timers, advance, pendingCount: () => pending.size };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  agentModeActive: boolean;
}

interface StoreOptions extends Partial<Environment> {
  readonly persisted?: ReadonlyArray<AgentThread>;
  readonly summaries?: ReadonlyArray<AgentTurnLogSummary>;
  readonly summarizeFails?: boolean;
}

function renderStore(overrides: StoreOptions = {}) {
  const environment: Environment = {
    projects: overrides.projects ?? [project()],
    agentModeActive: overrides.agentModeActive ?? true,
  };

  const snapshots = new Map<string, AgentThreadStoreSnapshot>();
  if (overrides.persisted !== undefined) {
    snapshots.set(ROOT_KEY, { threads: overrides.persisted, unreadable: [], evicted: 0 });
  }
  const saved: SaveAgentThreadRequest[] = [];
  const threadGateway = {
    loadAgentThreads: vi.fn(
      async (request: { rootKey: string }) =>
        snapshots.get(request.rootKey) ?? { threads: [], unreadable: [], evicted: 0 },
    ),
    saveAgentThread: vi.fn(async (request: SaveAgentThreadRequest) => {
      saved.push(request);
    }),
    deleteAgentThread: vi.fn(async () => undefined),
  };

  const logGateway = fakeTurnLogGateway();
  logGateway.summaries = overrides.summaries ?? [];
  logGateway.summarizeFails = overrides.summarizeFails ?? false;
  const clock = manualTimers();
  const captured: { value: AgentThreadStoreSurface | null } = { value: null };
  const loggingRef = {
    current: {
      gateway: logGateway,
      projects: environment.projects,
      timers: clock.timers,
      now: () => clock.timers.now(),
      loggedThreadRootKey: (threadId: string) =>
        captured.value?.currentState().threads.get(threadId)?.owner.rootKey ?? null,
    } satisfies AgentTurnLoggingDependencies,
  };
  const real = createAgentTurnLogIntegration(loggingRef);
  const seams: string[] = [];
  const turnLog: AgentTurnLogIntegration = {
    ...real,
    writer: {
      openTurn: (request) => {
        seams.push(`openTurn:${request.scope.turnId}`);
        real.writer.openTurn(request);
      },
      recordEvents: (turnId, events) => {
        seams.push(`recordEvents:${turnId}:${events.length}`);
        real.writer.recordEvents(turnId, events);
      },
      reportLoss: (turnId, loss) => {
        seams.push(`reportLoss:${turnId}:${loss.kind}`);
        real.writer.reportLoss(turnId, loss);
      },
      sealTurn: (turnId) => {
        seams.push(`sealTurn:${turnId}`);
        real.writer.sealTurn(turnId);
      },
      closeTurn: (turnId) => {
        seams.push(`closeTurn:${turnId}`);
        real.writer.closeTurn(turnId);
      },
      status: (turnId) => real.writer.status(turnId),
      flushAll: (budgetMs) => real.writer.flushAll(budgetMs),
      dispose: () => real.writer.dispose(),
    },
  };

  const dependencies = (): AgentThreadStoreDependencies => ({
    agentThreadStoreGateway: threadGateway as unknown as AgentThreadStoreGateway,
    projects: environment.projects,
    agentModeActive: environment.agentModeActive,
    reportError: vi.fn(),
    setNotice: vi.fn(),
    turnLog,
  });

  const host = document.createElement("div");
  const root = createRoot(host);

  function Harness(props: { readonly dependencies: AgentThreadStoreDependencies }) {
    captured.value = useAgentThreadStore(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    clock,
    logGateway,
    threadGateway,
    saved,
    seams,
    snapshots,
    turnLog,
    hook: () => captured.value as AgentThreadStoreSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      loggingRef.current = { ...loggingRef.current, projects: environment.projects };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lastAppend(
  appends: ReadonlyArray<AppendAgentTurnLogRequest>,
): AppendAgentTurnLogRequest | undefined {
  return appends[appends.length - 1];
}

const say = (text: string): AgentTurnEvent => ({ kind: "assistantText", text });
const tool = (id: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId: id,
  name: "Bash",
  inputSummary: id,
});

describe("useAgentThreadStore turn log lifecycle", () => {
  it("opens, records and seals a local turn in order", async () => {
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    await settle();
    act(() => harness.hook().dispatchAction(appended([say("hello")], 1)));
    act(() =>
      harness.hook().dispatchAction({
        kind: "taskStatusEvent",
        threadId: THREAD_ID,
        event: statusEvent(1, { kind: "exited", exitCode: 0 }),
        nowEpochMs: 50,
      }),
    );
    await settle();

    expect(harness.seams).toEqual([
      `openTurn:${TURN_ID}`,
      `recordEvents:${TURN_ID}:1`,
      `sealTurn:${TURN_ID}`,
    ]);
    expect(harness.logGateway.opens[0]?.scope).toEqual({
      rootKey: ROOT_KEY,
      ownerId: OWNER_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(harness.logGateway.opens[0]?.priorLoss).toEqual({ kind: "none" });
    const sealed = lastAppend(harness.logGateway.appends);
    expect(sealed?.seal).toBe(true);
    expect(sealed?.ops.map((entry) => entry.event)).toEqual([say("hello")]);
    expect(sealed?.expectedNextSeq).toBe(1);
    harness.unmount();
  });

  it("opens a resumed truncated turn with the legacy window loss", async () => {
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: THREAD_ID,
        turn: turn({ eventsTruncated: true }),
      }),
    );
    await settle();
    expect(harness.logGateway.opens[0]?.priorLoss).toEqual({ kind: "legacyWindow" });
    harness.unmount();
  });

  it("keeps events that arrive before the lease and reports a supervisor gap", async () => {
    const harness = renderStore();
    await settle();
    harness.logGateway.holdOpen = true;
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    act(() => harness.hook().dispatchAction(appended([tool("early")], 1)));
    act(() =>
      harness.hook().dispatchAction(appended([tool("late")], 2, { supervisorTruncated: true })),
    );
    expect(harness.logGateway.appends).toHaveLength(0);

    harness.logGateway.holdOpen = false;
    harness.logGateway.releaseOpen();
    await settle();
    act(() => harness.clock.advance(1_000));
    await settle();

    const recorded = harness.logGateway.appends.flatMap((request) =>
      request.ops.map((op) => op.event),
    );
    expect(recorded).toEqual([tool("early"), tool("late")]);
    expect(lastAppend(harness.logGateway.appends)?.loss).toEqual({ kind: "supervisorGap" });
    harness.unmount();
  });

  it("never opens a log for a remote or imported thread", async () => {
    const harness = renderStore();
    await settle();
    const remote = thread({ threadId: "remote-thread:server/one" });
    const imported = thread({
      threadId: "agt-2-0a1b",
      externalOrigin: { provider: "claudeCode", sessionId: "s-1", importedAtEpochMs: 1 },
    });
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: remote }));
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: imported }));
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: remote.threadId,
        turn: turn({ turnId: "agt-r-0a1c" }),
      }),
    );
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: imported.threadId,
        turn: turn({ turnId: "agt-i-0a1c" }),
      }),
    );
    await settle();
    expect(harness.seams).toEqual([]);
    expect(harness.logGateway.opens).toHaveLength(0);
    harness.unmount();
  });

  it("keeps logging under a new generation of the same root and stops when the root goes away", async () => {
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    await settle();
    act(() => harness.hook().dispatchAction(appended([say("before")], 1)));
    act(() => harness.clock.advance(1_000));
    await settle();
    const beforeCount = harness.logGateway.appends.length;
    expect(beforeCount).toBeGreaterThan(0);

    harness.set({ projects: [project({ generation: 2 })] });
    act(() => harness.hook().dispatchAction(appended([tool("after")], 2)));
    act(() => harness.clock.advance(5_000));
    await settle();

    expect(harness.logGateway.opens).toHaveLength(2);
    expect(harness.logGateway.appends.length).toBeGreaterThan(beforeCount);
    expect(harness.turnLog.writer.status(TURN_ID)?.state).toEqual({ kind: "writing" });

    const continuedCount = harness.logGateway.appends.length;
    harness.set({ projects: [] });
    act(() => harness.turnLog.writer.recordEvents(TURN_ID, [tool("orphan")]));
    act(() => harness.clock.advance(5_000));
    await settle();

    const orphaned = harness.logGateway.appends
      .slice(continuedCount)
      .flatMap((append) => append.ops);
    expect(orphaned).toEqual([]);
    expect(harness.turnLog.writer.status(TURN_ID)?.state).toEqual({
      kind: "stopped",
      reason: "ownerMismatch",
    });
    harness.unmount();
  });

  it("closes every live slot of a deleted thread", async () => {
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    await settle();
    act(() =>
      harness.hook().dispatchAction({
        kind: "taskStatusEvent",
        threadId: THREAD_ID,
        event: statusEvent(1, { kind: "exited", exitCode: 0 }),
        nowEpochMs: 50,
      }),
    );
    act(() => harness.hook().dispatchAction({ kind: "deleted", threadId: THREAD_ID }));
    await settle();
    expect(harness.seams).toContain(`closeTurn:${TURN_ID}`);
    expect(harness.turnLog.writer.status(TURN_ID)).toBeNull();
    harness.unmount();
  });

  it("sends every event of a 5000 event turn to the log while both windows stay bounded", async () => {
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    await settle();

    const raw = agentTurnStream(7, 5_000);
    for (let index = 0; index < raw.length; index += 50) {
      const batch = raw.slice(index, index + 50);
      act(() => harness.hook().dispatchAction(appended(batch, index + 1)));
      act(() => harness.clock.advance(1_000));
      await settle();
    }

    const recordedEvents = harness.seams
      .filter((seam) => seam.startsWith("recordEvents:"))
      .reduce((total, seam) => total + Number(seam.split(":")[2]), 0);
    expect(recordedEvents).toBe(raw.length);

    const live = harness.hook().currentState().threads.get(THREAD_ID)?.turns[0];
    expect(live?.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(live?.eventsTruncated).toBe(true);

    const document = serializeAgentThread(
      harness.hook().currentState().threads.get(THREAD_ID) as AgentThread,
    );
    const turns = document.turns as ReadonlyArray<{ events: ReadonlyArray<unknown> }>;
    expect(turns[0]?.events.length).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_EVENTS_PER_TURN);
    expect(new TextEncoder().encode(JSON.stringify(document)).byteLength).toBeLessThan(
      1_024 * 1_024,
    );
    harness.unmount();
  });
});

describe("useAgentThreadStore turn log summaries on demand", () => {
  it("keeps the log loss as the authority over the persisted JSON flag", async () => {
    const harness = renderStore({
      persisted: [
        thread({
          turns: [turn({ status: { kind: "exited", exitCode: 0 }, eventsTruncated: true })],
        }),
      ],
      summaries: [
        {
          turnId: TURN_ID,
          eventCount: 4,
          bytes: 20,
          loss: { kind: "none" },
          sealed: true,
          digest: null,
          prompt: null,
          promptOmitted: false,
        },
      ],
    });
    await settle();
    await settle();
    expect(harness.logGateway.summarized).toEqual([]);

    act(() => harness.hook().hydrateThread?.(THREAD_ID));
    await settle();
    await settle();

    expect(harness.logGateway.summarized).toEqual([
      { rootKey: ROOT_KEY, ownerId: OWNER_ID, threadId: THREAD_ID, includePrompts: false },
    ]);
    expect(harness.turnLog.facts.factsOf(TURN_ID)).toMatchObject({
      logged: true,
      loss: { kind: "none" },
    });
    harness.unmount();
  });

  it("falls back to the JSON truth when the summary fails", async () => {
    const harness = renderStore({
      persisted: [
        thread({
          turns: [turn({ status: { kind: "exited", exitCode: 0 }, eventsTruncated: true })],
        }),
      ],
      summarizeFails: true,
    });
    await settle();
    await settle();

    act(() => harness.hook().hydrateThread?.(THREAD_ID));
    await settle();
    await settle();

    expect(harness.logGateway.summarized).toHaveLength(1);
    expect(harness.turnLog.facts.factsOf(TURN_ID)).toBeNull();
    harness.unmount();
  });
});

async function flushSaves(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useAgentThreadStore save cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces streaming saves to one per ten seconds and saves user input at once", async () => {
    expect(MIN_AGENT_THREAD_PERSIST_INTERVAL_MS).toBe(10_000);
    const harness = renderStore();
    await settle();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    await flushSaves();
    const afterCreate = harness.saved.length;
    expect(afterCreate).toBe(1);

    act(() =>
      harness.hook().dispatchAction({ kind: "turnStarted", threadId: THREAD_ID, turn: turn() }),
    );
    await flushSaves();
    expect(harness.saved.length).toBe(2);

    for (let index = 1; index <= 8; index += 1) {
      act(() => harness.hook().dispatchAction(appended([say(`chunk ${index}`)], index)));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(harness.saved.length).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.saved.length).toBe(3);

    act(() =>
      harness
        .hook()
        .dispatchAction(appended([{ kind: "userMessage", text: "also fix lint" }], 100)),
    );
    await flushSaves();
    expect(harness.saved.length).toBe(4);

    act(() =>
      harness.hook().dispatchAction({
        kind: "taskStatusEvent",
        threadId: THREAD_ID,
        event: statusEvent(1, { kind: "exited", exitCode: 0 }),
        nowEpochMs: 50,
      }),
    );
    await flushSaves();
    expect(harness.saved.length).toBe(5);
    harness.unmount();
  });
});
