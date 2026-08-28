import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentOutputParserState, feedAgentOutput } from "./agentOutput/agentOutputParser";
import type { AgentCliKind, AgentTaskStatusEvent } from "./agentTask";
import {
  parseAgentThread as wireParseAgentThread,
  serializeAgentThread as wireSerializeAgentThread,
} from "./agentThreadWire";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_THREADS_PER_ROOT,
  MAX_AGENT_THREAD_TITLE_BYTES,
  MAX_AGENT_THREAD_TITLE_CHARS,
  MAX_AGENT_TURNS_PER_THREAD,
  agentThreadAttention,
  agentThreadLifecycle,
  agentThreadTitle,
  agentThreadUnread,
  agentThreadsReducer,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  emptyAgentThreadsState,
  lastUsedAgentLaunch,
  normalizeAgentThreadTitle,
  parseAgentThread,
  runningTurn,
  serializeAgentThread,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";

const ENCODER = new TextEncoder();
const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-0a1b",
    prompt: "do the thing",
    status: { kind: "pending" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  const threadId = overrides.threadId ?? "agt-t1-0001";
  return {
    threadId,
    owner: OWNER,
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "do the thing",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 1_000,
    turns: [turn({ turnId: firstTurnIdOf(threadId) })],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
    ...overrides,
  };
}

function firstTurnIdOf(threadId: string): string {
  if (threadId === "agt-t1-0001") return "agt-1-0a1b";
  return `${threadId}-t`;
}

function settledThread(overrides: Partial<AgentThread> = {}): AgentThread {
  const threadId = overrides.threadId ?? "agt-t1-0001";
  return thread({
    turns: [
      turn({
        turnId: firstTurnIdOf(threadId),
        status: { kind: "exited", exitCode: 0 },
        endedAtEpochMs: 2_000,
      }),
    ],
    ...overrides,
  });
}

function statusEvent(overrides: Partial<AgentTaskStatusEvent> = {}): AgentTaskStatusEvent {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    sequence: 1,
    status: { kind: "running" },
    ...overrides,
  };
}

function stateWith(...threads: readonly AgentThread[]): AgentThreadsState {
  return threads.reduce(
    (state, created) => agentThreadsReducer(state, { kind: "threadCreated", thread: created }),
    emptyAgentThreadsState(),
  );
}

function statusAction(
  overrides: Partial<AgentTaskStatusEvent> = {},
  nowEpochMs = 5_000,
): Extract<AgentThreadsAction, { kind: "taskStatusEvent" }> {
  return {
    kind: "taskStatusEvent",
    threadId: "agt-t1-0001",
    event: statusEvent(overrides),
    nowEpochMs,
  };
}

function appendAction(
  events: ReadonlyArray<AgentTurnEvent>,
  overrides: Partial<Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>> = {},
): Extract<AgentThreadsAction, { kind: "turnEventsAppended" }> {
  return {
    kind: "turnEventsAppended",
    threadId: "agt-t1-0001",
    turnId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    outputSequence: 1,
    events,
    sessionId: null,
    supervisorTruncated: false,
    streamMetricsDelta: null,
    ...overrides,
  };
}

function text(value: string): AgentTurnEvent {
  return { kind: "assistantText", text: value };
}

function countEncodedCodeUnits<T>(operation: () => T): {
  readonly encodedCodeUnits: number;
  readonly result: T;
} {
  const encode = TextEncoder.prototype.encode;
  let encodedCodeUnits = 0;
  TextEncoder.prototype.encode = function (input?: string) {
    encodedCodeUnits += input?.length ?? 0;
    return encode.call(this, input);
  };
  try {
    const result = operation();
    return { encodedCodeUnits, result };
  } finally {
    TextEncoder.prototype.encode = encode;
  }
}

describe("agentThreadsReducer status events", () => {
  it("advances pending to running to exited, stamps the end time, then freezes", () => {
    const running = agentThreadsReducer(stateWith(thread()), statusAction());
    expect(running.threads.get("agt-t1-0001")?.turns[0].status).toEqual({ kind: "running" });

    const exited = agentThreadsReducer(
      running,
      statusAction({ sequence: 2, status: { kind: "exited", exitCode: 0 } }, 7_000),
    );
    const exitedTurn = exited.threads.get("agt-t1-0001")?.turns[0];
    expect(exitedTurn?.status).toEqual({ kind: "exited", exitCode: 0 });
    expect(exitedTurn?.endedAtEpochMs).toBe(7_000);
    expect(exited.threads.get("agt-t1-0001")?.updatedAtEpochMs).toBe(7_000);

    const afterTerminal = agentThreadsReducer(
      exited,
      statusAction({ sequence: 3, status: { kind: "running" } }),
    );
    expect(afterTerminal).toBe(exited);
  });

  it("drops stale, duplicate, unknown, and foreign status events", () => {
    const state = agentThreadsReducer(stateWith(thread()), statusAction({ sequence: 5 }));
    const dropped: readonly Partial<AgentTaskStatusEvent>[] = [
      { sequence: 4, status: { kind: "stopped" } },
      { sequence: 5, status: { kind: "stopped" } },
      { sequence: 6, taskId: "agt-9-9999" },
      { sequence: 6, workspaceId: "ws-2" },
      { sequence: 6, repositoryRoot: "/other" },
      { sequence: 6, isolation: "worktree", worktreePath: "/repo/.worktrees/a" },
      { sequence: 6, worktreePath: "/unexpected" },
    ];
    for (const overrides of dropped) {
      expect(agentThreadsReducer(state, statusAction(overrides))).toBe(state);
    }
    expect(
      agentThreadsReducer(state, {
        ...statusAction({ sequence: 6 }),
        threadId: "agt-other",
      }),
    ).toBe(state);
  });

  it("drops a worktree status event that reports a different worktree path", () => {
    const state = stateWith(
      thread({
        target: { isolation: "worktree", worktreePath: "/repo/.worktrees/agt-t1-0001" },
      }),
    );
    const next = agentThreadsReducer(
      state,
      statusAction({ isolation: "worktree", worktreePath: "/repo/.worktrees/other" }),
    );
    expect(next).toBe(state);
  });
});

describe("agentThreadsReducer output events", () => {
  it("updates one exact live turn without inspecting unrelated turn arrays", () => {
    let unrelatedReads = 0;
    const threads = new Map<string, AgentThread>();
    for (let threadIndex = 0; threadIndex < 128; threadIndex += 1) {
      const threadId = `agt-thread-${threadIndex}`;
      const turns = Array.from({ length: MAX_AGENT_TURNS_PER_THREAD }, (_, turnIndex) =>
        turn({ turnId: `${threadId}-turn-${turnIndex}` }),
      );
      const guarded = new Proxy(turns, {
        get(target, property, receiver) {
          unrelatedReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      threads.set(
        threadId,
        thread({
          threadId,
          turns: threadIndex === 127 ? turns : guarded,
        }),
      );
    }
    let state: AgentThreadsState = { threads };
    const threadId = "agt-thread-127";
    const turnId = `${threadId}-turn-${MAX_AGENT_TURNS_PER_THREAD - 1}`;

    for (let sequence = 1; sequence <= 120; sequence += 1) {
      state = agentThreadsReducer(
        state,
        appendAction([text(`frame ${sequence}`)], { threadId, turnId, outputSequence: sequence }),
      );
    }

    expect(unrelatedReads).toBe(0);
    expect(
      state.threads.get(threadId)?.turns[MAX_AGENT_TURNS_PER_THREAD - 1]?.lastOutputSequence,
    ).toBe(120);
  });

  it("drops mismatched live output authority with the same state identity", () => {
    const state = stateWith(thread());
    const mismatches: ReadonlyArray<
      Partial<Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>>
    > = [
      { threadId: "agt-other" },
      { turnId: "agt-other-turn" },
      { workspaceId: "ws-other" },
      { repositoryRoot: "/other" },
      { isolation: "worktree", worktreePath: "/repo/.worktrees/other" },
      { worktreePath: "/unexpected" },
    ];
    for (const mismatch of mismatches) {
      expect(agentThreadsReducer(state, appendAction([text("late")], mismatch))).toBe(state);
    }
  });

  it("coalesces consecutive assistant text and keeps other kinds separate", () => {
    const first = agentThreadsReducer(
      stateWith(thread()),
      appendAction([text("Hel"), text("lo"), { kind: "reasoning", text: "a" }]),
    );
    const second = agentThreadsReducer(
      first,
      appendAction([{ kind: "reasoning", text: "b" }, text("!")], { outputSequence: 2 }),
    );
    const events = second.threads.get("agt-t1-0001")?.turns[0].events;
    expect(events).toEqual([text("Hello"), { kind: "reasoning", text: "ab" }, text("!")]);
    expect(second.threads.get("agt-t1-0001")?.turns[0].lastOutputSequence).toBe(2);
  });

  it("starts a new text event when the merged text would exceed the byte bound", () => {
    const big = "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES - 1);
    const state = agentThreadsReducer(stateWith(thread()), appendAction([text(big), text("yy")]));
    const events = state.threads.get("agt-t1-0001")?.turns[0].events;
    expect(events).toEqual([text(big), text("yy")]);
  });

  it("encodes only incoming suffixes while preserving a split multibyte boundary", () => {
    const measured = countEncodedCodeUnits(() => {
      let merged = text("");
      for (let index = 0; index < MAX_AGENT_EVENT_TEXT_BYTES; index += 1) {
        const next = coalesceAgentTextEvents(merged, text("x"));
        if (next === null) throw new Error("One-byte text chunk exceeded the event bound.");
        merged = next;
      }
      return merged;
    });
    expect(measured.result).toEqual(text("x".repeat(MAX_AGENT_EVENT_TEXT_BYTES)));
    expect(measured.encodedCodeUnits).toBeLessThanOrEqual(MAX_AGENT_EVENT_TEXT_BYTES + 1);

    const highSurrogate = coalesceAgentTextEvents(text("x".repeat(16_380)), text("\ud83d"));
    if (highSurrogate === null) throw new Error("High surrogate did not fit the event bound.");
    const completeScalar = coalesceAgentTextEvents(highSurrogate, text("\ude00"));
    expect(completeScalar).toEqual(text(`${"x".repeat(16_380)}😀`));
    expect(coalesceAgentTextEvents(completeScalar ?? undefined, text("x"))).toBeNull();
  });

  it("coalesces frozen text events", () => {
    expect(
      coalesceAgentTextEvents(Object.freeze(text("frozen ")), Object.freeze(text("text"))),
    ).toEqual(text("frozen text"));
  });

  it("does not share byte state across structurally equal event identities", () => {
    const first = text("same");
    expect(coalesceAgentTextEvents(first, text(""))).toEqual(first);
    const equalButDistinct = text("same");
    const measured = countEncodedCodeUnits(() =>
      coalesceAgentTextEvents(equalButDistinct, text("!")),
    );
    expect(measured.result).toEqual(text("same!"));
    expect(measured.encodedCodeUnits).toBe(5);
  });

  it("reuses byte state only while the exact event text remains unchanged", () => {
    const reused = text("stable");
    expect(coalesceAgentTextEvents(reused, text(""))).toEqual(reused);
    const measured = countEncodedCodeUnits(() => coalesceAgentTextEvents(reused, text("!")));
    expect(measured.result).toEqual(text("stable!"));
    expect(measured.encodedCodeUnits).toBe(1);
  });

  it("recomputes byte state for a mutated reused event identity", () => {
    const reused = { kind: "assistantText" as const, text: "short" };
    expect(coalesceAgentTextEvents(reused, text(""))).toEqual(text("short"));
    reused.text = "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES);
    const measured = countEncodedCodeUnits(() => coalesceAgentTextEvents(reused, text("!")));
    expect(measured.result).toBeNull();
    expect(measured.encodedCodeUnits).toBe(MAX_AGENT_EVENT_TEXT_BYTES + 1);
  });

  it("drops events past the per-turn cap and marks the turn truncated", () => {
    const events = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 3 }, (_, index) => ({
      kind: "error" as const,
      message: `e${index}`,
    }));
    const state = agentThreadsReducer(stateWith(thread()), appendAction(events));
    const updated = state.threads.get("agt-t1-0001")?.turns[0];
    expect(updated?.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(updated?.eventsTruncated).toBe(true);
  });

  it("caps aggregate UTF-8 event bytes across repeated output drains", () => {
    const wideText = "€".repeat(Math.floor(MAX_AGENT_EVENT_TEXT_BYTES / 3));
    let state = stateWith(thread());
    let sequence = 0;

    while (sequence < 100) {
      sequence += 1;
      state = agentThreadsReducer(
        state,
        appendAction(
          [sequence % 2 === 0 ? { kind: "reasoning", text: wideText } : text(wideText)],
          { outputSequence: sequence },
        ),
      );
    }

    const updated = state.threads.get("agt-t1-0001")?.turns[0];
    const retainedBytes =
      updated?.events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0) ?? 0;
    expect(retainedBytes).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(updated?.eventsTruncated).toBe(true);
    expect(updated?.lastOutputSequence).toBe(sequence);
  });

  it("counts every retained event string and rejects a multibyte overflow deterministically", () => {
    const metadataEvent = {
      kind: "toolCall" as const,
      toolId: "é".repeat(64),
      name: "工具",
      inputSummary: "😀".repeat(32),
    };
    expect(agentTurnEventUtf8Bytes(metadataEvent)).toBe(
      new TextEncoder().encode(
        metadataEvent.toolId + metadataEvent.name + metadataEvent.inputSummary,
      ).byteLength,
    );

    const almostFull = Array.from(
      { length: MAX_AGENT_EVENT_BYTES_PER_TURN / MAX_AGENT_EVENT_TEXT_BYTES },
      (_, index) =>
        index === MAX_AGENT_EVENT_BYTES_PER_TURN / MAX_AGENT_EVENT_TEXT_BYTES - 1
          ? index % 2 === 0
            ? text("x".repeat(MAX_AGENT_EVENT_TEXT_BYTES - 2))
            : { kind: "reasoning" as const, text: "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES - 2) }
          : index % 2 === 0
            ? text("x".repeat(MAX_AGENT_EVENT_TEXT_BYTES))
            : { kind: "reasoning" as const, text: "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES) },
    );
    const overflow = text("€");
    const state = agentThreadsReducer(stateWith(thread()), appendAction([...almostFull, overflow]));
    const updated = state.threads.get("agt-t1-0001")?.turns[0];
    expect(updated?.events).toEqual(almostFull);
    expect(updated?.eventsTruncated).toBe(true);

    const later = agentThreadsReducer(
      state,
      appendAction([text("x")], { outputSequence: 2, sessionId: "session-0001" }),
    ).threads.get("agt-t1-0001");
    expect(later?.turns[0].events).toBe(updated?.events);
    expect(later?.turns[0].events).toEqual(almostFull);
    expect(later?.turns[0].lastOutputSequence).toBe(2);
    expect(later?.provider.sessionId).toBe("session-0001");
  });

  it("aggregates raw stream byte deltas independently from the retained event prefix", () => {
    const first = agentThreadsReducer(
      stateWith(thread()),
      appendAction([text("retained")], {
        streamMetricsDelta: { receivedUtf8Bytes: 3, complete: true },
      }),
    );
    const truncated = agentThreadsReducer(
      first,
      appendAction([], {
        outputSequence: 2,
        supervisorTruncated: true,
        streamMetricsDelta: { receivedUtf8Bytes: 4, complete: false },
      }),
    );
    const later = agentThreadsReducer(
      truncated,
      appendAction([text("not retained")], {
        outputSequence: 3,
        streamMetricsDelta: { receivedUtf8Bytes: 1, complete: true },
      }),
    );

    const updated = later.threads.get("agt-t1-0001")?.turns[0];
    expect(updated?.events).toEqual([text("retained")]);
    expect(updated?.streamMetrics).toEqual({ receivedUtf8Bytes: 8, complete: false });
  });

  it("fails closed when a raw stream byte delta would overflow safe integer accounting", () => {
    const state = stateWith(
      thread({
        turns: [
          turn({
            streamMetrics: { receivedUtf8Bytes: Number.MAX_SAFE_INTEGER - 1, complete: true },
          }),
        ],
      }),
    );
    const updated = agentThreadsReducer(
      state,
      appendAction([], {
        streamMetricsDelta: { receivedUtf8Bytes: 2, complete: true },
      }),
    ).threads.get("agt-t1-0001")?.turns[0];

    expect(updated?.streamMetrics).toEqual({
      receivedUtf8Bytes: Number.MAX_SAFE_INTEGER - 1,
      complete: false,
    });
  });

  it("drops stale, duplicate, unknown, and post-terminal output", () => {
    const state = agentThreadsReducer(stateWith(thread()), appendAction([text("a")]));
    expect(agentThreadsReducer(state, appendAction([text("b")]))).toBe(state);
    expect(agentThreadsReducer(state, appendAction([text("b")], { outputSequence: 0 }))).toBe(
      state,
    );
    expect(agentThreadsReducer(state, appendAction([text("b")], { turnId: "agt-9-9999" }))).toBe(
      state,
    );
    const terminal = agentThreadsReducer(state, statusAction({ status: { kind: "stopped" } }));
    expect(agentThreadsReducer(terminal, appendAction([text("b")], { outputSequence: 2 }))).toBe(
      terminal,
    );
  });

  it("captures the first session id only and ignores a later different one", () => {
    const first = agentThreadsReducer(
      stateWith(thread()),
      appendAction([], { sessionId: "session-0001" }),
    );
    expect(first.threads.get("agt-t1-0001")?.provider.sessionId).toBe("session-0001");
    const second = agentThreadsReducer(
      first,
      appendAction([], { outputSequence: 2, sessionId: "session-0002" }),
    );
    expect(second.threads.get("agt-t1-0001")?.provider.sessionId).toBe("session-0001");
  });

  it("drops a malformed session id", () => {
    const state = agentThreadsReducer(
      stateWith(thread()),
      appendAction([], { sessionId: "-not-a-session-id" }),
    );
    expect(state.threads.get("agt-t1-0001")?.provider.sessionId).toBeNull();
  });

  it("keeps the supervisor truncation marker sticky", () => {
    const state = agentThreadsReducer(
      stateWith(thread()),
      appendAction([], { supervisorTruncated: true }),
    );
    expect(state.threads.get("agt-t1-0001")?.turns[0].eventsTruncated).toBe(true);
  });
});

describe("agentThreadsReducer turn lifecycle", () => {
  it("refuses a second turn while one is running and accepts one after settlement", () => {
    const running = stateWith(thread());
    const next = turn({
      turnId: "agt-2-0a1b",
      startedAtEpochMs: 9_000,
      streamMetrics: undefined,
    });
    expect(
      agentThreadsReducer(running, { kind: "turnStarted", threadId: "agt-t1-0001", turn: next }),
    ).toBe(running);

    const settled = stateWith(settledThread());
    const started = agentThreadsReducer(settled, {
      kind: "turnStarted",
      threadId: "agt-t1-0001",
      turn: next,
    });
    const updated = started.threads.get("agt-t1-0001");
    expect(updated?.turns.map((candidate) => candidate.turnId)).toEqual([
      "agt-1-0a1b",
      "agt-2-0a1b",
    ]);
    expect(updated?.updatedAtEpochMs).toBe(9_000);
    expect(runningTurn(updated as AgentThread)?.turnId).toBe("agt-2-0a1b");
    expect(runningTurn(updated as AgentThread)?.streamMetrics).toBeNull();
  });

  it("refuses a turn on an archived thread and a duplicate turn id", () => {
    const archived = stateWith(settledThread({ archived: true }));
    const next = turn({ turnId: "agt-2-0a1b" });
    expect(
      agentThreadsReducer(archived, { kind: "turnStarted", threadId: "agt-t1-0001", turn: next }),
    ).toBe(archived);
    const settled = stateWith(settledThread());
    expect(
      agentThreadsReducer(settled, { kind: "turnStarted", threadId: "agt-t1-0001", turn: turn() }),
    ).toBe(settled);
  });

  it("evicts the oldest terminal turn at the cap and marks the thread truncated", () => {
    const turns = Array.from({ length: MAX_AGENT_TURNS_PER_THREAD }, (_, index) =>
      turn({
        turnId: `agt-${index}-0a1b`,
        status: { kind: "exited", exitCode: 0 },
        endedAtEpochMs: 2_000,
      }),
    );
    const state = stateWith(thread({ turns }));
    const next = turn({ turnId: "agt-new-0a1b" });
    const started = agentThreadsReducer(state, {
      kind: "turnStarted",
      threadId: "agt-t1-0001",
      turn: next,
    });
    const updated = started.threads.get("agt-t1-0001");
    expect(updated?.turns).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(updated?.turns[0].turnId).toBe("agt-1-0a1b");
    expect(updated?.turns[updated.turns.length - 1].turnId).toBe("agt-new-0a1b");
    expect(updated?.turnsTruncated).toBe(true);
  });

  it("marks a running turn interrupted once and ignores repeats", () => {
    const state = stateWith(
      thread({
        turns: [turn({ streamMetrics: { receivedUtf8Bytes: 5, complete: true } })],
      }),
    );
    const interrupted = agentThreadsReducer(state, {
      kind: "turnInterrupted",
      turnId: "agt-1-0a1b",
      nowEpochMs: 4_000,
    });
    const updated = interrupted.threads.get("agt-t1-0001")?.turns[0];
    expect(updated?.status).toEqual({ kind: "interrupted" });
    expect(updated?.endedAtEpochMs).toBe(4_000);
    expect(updated?.streamMetrics).toEqual({ receivedUtf8Bytes: 5, complete: false });
    expect(
      agentThreadsReducer(interrupted, {
        kind: "turnInterrupted",
        turnId: "agt-1-0a1b",
        nowEpochMs: 5_000,
      }),
    ).toBe(interrupted);
    expect(agentThreadsReducer(interrupted, statusAction({ sequence: 9 }))).toBe(interrupted);
  });
});

describe("agentThreadsReducer loaded", () => {
  it("replaces the root's threads, keeps in-memory running threads, and interrupts loaded live turns", () => {
    const inMemoryRunning = thread({ threadId: "agt-run-0001" });
    const inMemorySettled = settledThread({ threadId: "agt-old-0001" });
    const foreign = settledThread({
      threadId: "agt-for-0001",
      owner: { rootKey: "/other", ownerId: "ws-2", repositoryRoot: "/other" },
    });
    const state = stateWith(inMemoryRunning, inMemorySettled, foreign);
    const loaded = agentThreadsReducer(state, {
      kind: "loaded",
      owner: { rootKey: "/workspace", ownerId: "ws-1" },
      threads: [
        thread({
          threadId: "agt-run-0001",
          turns: [turn({ turnId: "agt-1-0a1b", status: { kind: "running" } })],
        }),
        thread({
          threadId: "agt-disk-0001",
          turns: [
            turn({
              turnId: "agt-d-0a1b",
              status: { kind: "running" },
              streamMetrics: { receivedUtf8Bytes: 7, complete: true },
            }),
          ],
        }),
        settledThread({
          threadId: "agt-bad-0001",
          owner: { rootKey: "/workspace", ownerId: "ws-9", repositoryRoot: "/repo" },
        }),
      ],
    });
    expect([...loaded.threads.keys()].sort()).toEqual([
      "agt-disk-0001",
      "agt-for-0001",
      "agt-run-0001",
    ]);
    expect(loaded.threads.get("agt-run-0001")).toBe(inMemoryRunning);
    expect(loaded.threads.get("agt-disk-0001")?.turns[0].status).toEqual({ kind: "interrupted" });
    expect(loaded.threads.get("agt-disk-0001")?.turns[0].streamMetrics).toEqual({
      receivedUtf8Bytes: 7,
      complete: false,
    });
    expect(agentThreadLifecycle(loaded.threads.get("agt-disk-0001") as AgentThread)).toBe(
      "settled",
    );
  });

  it("bounds aggregate event bytes while hydrating persisted threads", () => {
    const wideText = "€".repeat(Math.floor(MAX_AGENT_EVENT_TEXT_BYTES / 3));
    const events = Array.from({ length: 100 }, (_, index) =>
      index % 2 === 0 ? text(wideText) : { kind: "reasoning" as const, text: wideText },
    );
    const loaded = agentThreadsReducer(emptyAgentThreadsState(), {
      kind: "loaded",
      owner: { rootKey: "/workspace", ownerId: "ws-1" },
      threads: [
        settledThread({
          threadId: "agt-disk-0001",
          turns: [turn({ turnId: "agt-d-0a1b", events })],
        }),
      ],
    });

    const hydrated = loaded.threads.get("agt-disk-0001")?.turns[0];
    const retainedBytes =
      hydrated?.events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0) ?? 0;
    expect(retainedBytes).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(hydrated?.eventsTruncated).toBe(true);
  });
});

describe("agentThreadsReducer thread eviction", () => {
  it("evicts unpinned settled threads first, oldest updatedAt then threadId, never a running one", () => {
    const threads = Array.from({ length: MAX_AGENT_THREADS_PER_ROOT }, (_, index) =>
      settledThread({
        threadId: `agt-s${index.toString().padStart(2, "0")}-0001`,
        updatedAtEpochMs: 10_000 - index,
      }),
    );
    const pinnedOldest = settledThread({
      threadId: "agt-pin-0001",
      pinned: true,
      updatedAtEpochMs: 1,
    });
    const runningOldest = thread({ threadId: "agt-run-0001", updatedAtEpochMs: 2 });
    const state = stateWith(...threads, pinnedOldest, runningOldest);
    expect(state.threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    expect(state.threads.has("agt-pin-0001")).toBe(true);
    expect(state.threads.has("agt-run-0001")).toBe(true);
    const lastIndex = MAX_AGENT_THREADS_PER_ROOT - 1;
    expect(state.threads.has(`agt-s${lastIndex}-0001`)).toBe(false);
    expect(state.threads.has(`agt-s${lastIndex - 1}-0001`)).toBe(false);
    expect(state.threads.has("agt-s00-0001")).toBe(true);
  });

  it("never evicts a pinned thread, even when only pinned threads remain", () => {
    const pinnedThreads = Array.from({ length: MAX_AGENT_THREADS_PER_ROOT }, (_, index) =>
      settledThread({
        threadId: `agt-p${index.toString().padStart(2, "0")}-0001`,
        pinned: true,
        updatedAtEpochMs: index,
      }),
    );
    const unpinnedNewest = settledThread({ threadId: "agt-new-0001", updatedAtEpochMs: 99_999 });
    const state = stateWith(...pinnedThreads, unpinnedNewest);
    expect(state.threads.has("agt-new-0001")).toBe(false);
    expect(state.threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    const overfull = stateWith(
      ...pinnedThreads,
      settledThread({ threadId: "agt-x-0001", pinned: true }),
    );
    expect(overfull.threads.size).toBe(MAX_AGENT_THREADS_PER_ROOT + 1);
  });

  it("breaks eviction ties by thread id", () => {
    const threads = Array.from({ length: MAX_AGENT_THREADS_PER_ROOT + 1 }, (_, index) =>
      settledThread({ threadId: `agt-t${index.toString().padStart(2, "0")}-0001` }),
    );
    const state = stateWith(...threads);
    expect(state.threads.has("agt-t00-0001")).toBe(false);
    expect(state.threads.has("agt-t64-0001")).toBe(true);
  });
});

describe("agentThreadsReducer ownership and bookkeeping", () => {
  it("releases settled threads of an owner and keeps running ones", () => {
    const state = stateWith(
      settledThread({ threadId: "agt-a-0001" }),
      thread({ threadId: "agt-b-0001", turns: [turn({ turnId: "agt-b-0a1b" })] }),
      settledThread({
        threadId: "agt-c-0001",
        owner: { rootKey: "/other", ownerId: "ws-2", repositoryRoot: "/other" },
      }),
    );
    const released = agentThreadsReducer(state, { kind: "ownerReleased", ownerId: "ws-1" });
    expect([...released.threads.keys()].sort()).toEqual(["agt-b-0001", "agt-c-0001"]);
    expect(agentThreadsReducer(released, { kind: "ownerReleased", ownerId: "ws-x" })).toBe(
      released,
    );
  });

  it("toggles pins, archives settled threads only, and deletes settled threads only", () => {
    const state = stateWith(settledThread(), thread({ threadId: "agt-live-0001" }));
    const pinned = agentThreadsReducer(state, { kind: "pinToggled", threadId: "agt-t1-0001" });
    expect(pinned.threads.get("agt-t1-0001")?.pinned).toBe(true);
    const archived = agentThreadsReducer(pinned, { kind: "archived", threadId: "agt-t1-0001" });
    expect(agentThreadLifecycle(archived.threads.get("agt-t1-0001") as AgentThread)).toBe(
      "archived",
    );
    expect(agentThreadsReducer(archived, { kind: "archived", threadId: "agt-live-0001" })).toBe(
      archived,
    );
    expect(agentThreadsReducer(archived, { kind: "deleted", threadId: "agt-live-0001" })).toBe(
      archived,
    );
    const deleted = agentThreadsReducer(archived, { kind: "deleted", threadId: "agt-t1-0001" });
    expect(deleted.threads.has("agt-t1-0001")).toBe(false);
  });

  it("ignores a duplicate thread creation and a thread reusing a known turn id", () => {
    const state = stateWith(thread());
    expect(agentThreadsReducer(state, { kind: "threadCreated", thread: thread() })).toBe(state);
    const reused = thread({ threadId: "agt-other-0001", turns: [turn()] });
    expect(agentThreadsReducer(state, { kind: "threadCreated", thread: reused })).toBe(state);
  });

  it("rejects an unsupported action kind fail closed", () => {
    const action = { kind: "bogus" } as unknown as AgentThreadsAction;
    expect(() => agentThreadsReducer(emptyAgentThreadsState(), action)).toThrow(TypeError);
  });
});

describe("agentThreadTitle", () => {
  it("uses the first non-empty trimmed line", () => {
    expect(agentThreadTitle("\n  \n  Fix the bug  \nmore")).toBe("Fix the bug");
    expect(agentThreadTitle("  \n ")).toBe("Untitled thread");
  });

  it("clips on a UTF-8 boundary within the byte bound", () => {
    const title = agentThreadTitle("é".repeat(MAX_AGENT_THREAD_TITLE_BYTES));
    expect(ENCODER.encode(title).byteLength).toBeLessThanOrEqual(MAX_AGENT_THREAD_TITLE_BYTES);
    expect(title.endsWith("…")).toBe(true);
    expect(title.includes("�")).toBe(false);
  });
});

describe("threadViewed", () => {
  it("stamps the view time on the addressed thread only", () => {
    const state = agentThreadsReducer(emptyAgentThreadsState(), {
      kind: "threadCreated",
      thread: settledThread(),
    });

    const viewed = agentThreadsReducer(state, {
      kind: "threadViewed",
      threadId: "agt-t1-0001",
      atEpochMs: 5_000,
    });

    expect(viewed.threads.get("agt-t1-0001")?.viewedAtEpochMs).toBe(5_000);
  });

  it("is a no-op for a missing thread, an unchanged stamp, and an invalid time", () => {
    const state = agentThreadsReducer(emptyAgentThreadsState(), {
      kind: "threadCreated",
      thread: settledThread({ viewedAtEpochMs: 5_000 }),
    });

    expect(
      agentThreadsReducer(state, { kind: "threadViewed", threadId: "agt-gone", atEpochMs: 9 }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, {
        kind: "threadViewed",
        threadId: "agt-t1-0001",
        atEpochMs: 5_000,
      }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, {
        kind: "threadViewed",
        threadId: "agt-t1-0001",
        atEpochMs: -1,
      }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, {
        kind: "threadViewed",
        threadId: "agt-t1-0001",
        atEpochMs: 5_000.5,
      }),
    ).toBe(state);
  });

  it("advances the stamp monotonically and ignores a late older stamp", () => {
    const state = stateWith(settledThread());

    const first = agentThreadsReducer(state, {
      kind: "threadViewed",
      threadId: "agt-t1-0001",
      atEpochMs: 5_000,
    });
    const later = agentThreadsReducer(first, {
      kind: "threadViewed",
      threadId: "agt-t1-0001",
      atEpochMs: 6_000,
    });
    const stale = agentThreadsReducer(later, {
      kind: "threadViewed",
      threadId: "agt-t1-0001",
      atEpochMs: 4_999,
    });

    expect(later.threads.get("agt-t1-0001")?.viewedAtEpochMs).toBe(6_000);
    expect(stale).toBe(later);
    expect(agentThreadUnread(stale.threads.get("agt-t1-0001") as AgentThread)).toBe(false);
  });

  it("leaves every other thread field untouched, including the update time", () => {
    const before = settledThread({ pinned: true, updatedAtEpochMs: 3_000 });

    const viewed = agentThreadsReducer(stateWith(before), {
      kind: "threadViewed",
      threadId: "agt-t1-0001",
      atEpochMs: 7_000,
    });

    expect(viewed.threads.get("agt-t1-0001")).toEqual({ ...before, viewedAtEpochMs: 7_000 });
  });
});

describe("threadRenamed", () => {
  it("renames a thread with a trimmed title and leaves other fields untouched", () => {
    const before = settledThread({ pinned: true, updatedAtEpochMs: 3_000, viewedAtEpochMs: 5 });

    const renamed = agentThreadsReducer(stateWith(before), {
      kind: "threadRenamed",
      threadId: "agt-t1-0001",
      title: "  Parser rewrite  ",
    });

    expect(renamed.threads.get("agt-t1-0001")).toEqual({ ...before, title: "Parser rewrite" });
  });

  it("is a no-op for a missing thread, an unchanged title, and a blank title", () => {
    const state = stateWith(settledThread({ title: "Same" }));

    expect(
      agentThreadsReducer(state, { kind: "threadRenamed", threadId: "agt-gone", title: "New" }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, { kind: "threadRenamed", threadId: "agt-t1-0001", title: "Same" }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, { kind: "threadRenamed", threadId: "agt-t1-0001", title: " \n " }),
    ).toBe(state);
  });

  it("bounds the title to the first line, 200 chars, and the wire byte limit", () => {
    const long = "x".repeat(MAX_AGENT_THREAD_TITLE_CHARS + 50);
    expect(normalizeAgentThreadTitle(long)).toHaveLength(MAX_AGENT_THREAD_TITLE_CHARS);
    expect(normalizeAgentThreadTitle("\n\n first line \nsecond")).toBe("first line");
    expect(normalizeAgentThreadTitle("   ")).toBeNull();

    const wide = "😀".repeat(MAX_AGENT_THREAD_TITLE_CHARS);
    const bounded = normalizeAgentThreadTitle(wide) ?? "";
    expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(
      MAX_AGENT_THREAD_TITLE_BYTES,
    );
    expect(bounded.endsWith("…")).toBe(true);

    const renamed = agentThreadsReducer(stateWith(settledThread()), {
      kind: "threadRenamed",
      threadId: "agt-t1-0001",
      title: wide,
    });
    const after = renamed.threads.get("agt-t1-0001") as AgentThread;
    expect(after.title).toBe(bounded);
    expect(parseAgentThread(serializeAgentThread(after))).toEqual(after);
  });
});

describe("threadMarkedUnread", () => {
  it("clears the view stamp and makes a settled thread unread again", () => {
    const state = stateWith(settledThread({ viewedAtEpochMs: 5_000 }));

    const unread = agentThreadsReducer(state, {
      kind: "threadMarkedUnread",
      threadId: "agt-t1-0001",
    });

    expect(unread.threads.get("agt-t1-0001")?.viewedAtEpochMs).toBeNull();
    expect(agentThreadUnread(unread.threads.get("agt-t1-0001") as AgentThread)).toBe(true);
  });

  it("is a no-op for a missing thread and for an already unread thread", () => {
    const state = stateWith(settledThread({ viewedAtEpochMs: null }));

    expect(agentThreadsReducer(state, { kind: "threadMarkedUnread", threadId: "agt-gone" })).toBe(
      state,
    );
    expect(
      agentThreadsReducer(state, { kind: "threadMarkedUnread", threadId: "agt-t1-0001" }),
    ).toBe(state);
  });

  it("leaves every other thread field untouched, including the update time", () => {
    const before = settledThread({
      pinned: true,
      updatedAtEpochMs: 3_000,
      viewedAtEpochMs: 5_000,
    });

    const unread = agentThreadsReducer(stateWith(before), {
      kind: "threadMarkedUnread",
      threadId: "agt-t1-0001",
    });

    expect(unread.threads.get("agt-t1-0001")).toEqual({ ...before, viewedAtEpochMs: null });
  });

  it("keeps the persisted wire document unchanged apart from the null view stamp", () => {
    const before = settledThread({ viewedAtEpochMs: 5_000 });
    const unread = agentThreadsReducer(stateWith(before), {
      kind: "threadMarkedUnread",
      threadId: "agt-t1-0001",
    });
    const after = unread.threads.get("agt-t1-0001") as AgentThread;

    expect(serializeAgentThread(after)).toEqual({
      ...serializeAgentThread(before),
      viewedAtEpochMs: null,
    });
    expect(parseAgentThread(serializeAgentThread(after))).toEqual(after);
  });
});

describe("agentThreadAttention", () => {
  it("classifies archived, running, attention, and settled threads", () => {
    expect(agentThreadAttention(settledThread({ archived: true }))).toBe("archived");
    expect(agentThreadAttention(thread({ turns: [turn({ status: { kind: "running" } })] }))).toBe(
      "running",
    );
    expect(agentThreadAttention(thread({ turns: [turn({ status: { kind: "pending" } })] }))).toBe(
      "running",
    );
    expect(
      agentThreadAttention(thread({ turns: [turn({ status: { kind: "failed", message: "x" } })] })),
    ).toBe("attention");
    expect(
      agentThreadAttention(thread({ turns: [turn({ status: { kind: "interrupted" } })] })),
    ).toBe("attention");
    expect(agentThreadAttention(thread({ turns: [turn({ status: { kind: "stopped" } })] }))).toBe(
      "attention",
    );
    expect(
      agentThreadAttention(thread({ turns: [turn({ status: { kind: "exited", exitCode: 2 } })] })),
    ).toBe("attention");
    expect(
      agentThreadAttention(thread({ turns: [turn({ status: { kind: "exited", exitCode: 0 } })] })),
    ).toBe("settled");
    expect(agentThreadAttention(thread({ turns: [] }))).toBe("settled");
  });

  it("treats a signal exit as attention and a clean exit after a failure as settled", () => {
    expect(
      agentThreadAttention(thread({ turns: [turn({ status: { kind: "exited", exitCode: -9 } })] })),
    ).toBe("attention");
    expect(
      agentThreadAttention(
        thread({
          turns: [
            turn({ turnId: "agt-1-0a1b", status: { kind: "failed", message: "x" } }),
            turn({ turnId: "agt-2-0a1b", status: { kind: "exited", exitCode: 0 } }),
          ],
        }),
      ),
    ).toBe("settled");
  });

  it("lets archived win over a running or failed last turn", () => {
    expect(
      agentThreadAttention(
        thread({ archived: true, turns: [turn({ status: { kind: "running" } })] }),
      ),
    ).toBe("archived");
    expect(
      agentThreadAttention(
        thread({ archived: true, turns: [turn({ status: { kind: "failed", message: "x" } })] }),
      ),
    ).toBe("archived");
  });

  it("classifies pinned threads exactly like unpinned ones", () => {
    const statuses: ReadonlyArray<AgentTurn["status"]> = [
      { kind: "pending" },
      { kind: "running" },
      { kind: "failed", message: "x" },
      { kind: "interrupted" },
      { kind: "stopped" },
      { kind: "exited", exitCode: 0 },
      { kind: "exited", exitCode: 2 },
    ];

    for (const status of statuses) {
      expect(agentThreadAttention(thread({ pinned: true, turns: [turn({ status })] }))).toBe(
        agentThreadAttention(thread({ pinned: false, turns: [turn({ status })] })),
      );
    }
  });
});

describe("agentThreadUnread", () => {
  it("is unread only while a settled result is newer than the last view", () => {
    const settled = (endedAtEpochMs: number | null): AgentTurn =>
      turn({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs });

    expect(agentThreadUnread(thread({ turns: [settled(2_000)] }))).toBe(true);
    expect(agentThreadUnread(thread({ turns: [settled(2_000)], viewedAtEpochMs: 1_000 }))).toBe(
      true,
    );
    expect(agentThreadUnread(thread({ turns: [settled(2_000)], viewedAtEpochMs: 2_000 }))).toBe(
      false,
    );
    expect(agentThreadUnread(thread({ turns: [settled(2_000)], viewedAtEpochMs: 3_000 }))).toBe(
      false,
    );
    expect(agentThreadUnread(thread({ turns: [settled(null)] }))).toBe(false);
    expect(agentThreadUnread(thread({ turns: [turn({ status: { kind: "running" } })] }))).toBe(
      false,
    );
    expect(agentThreadUnread(thread({ turns: [] }))).toBe(false);
  });

  it("counts every terminal status and ignores a pending first turn", () => {
    const ended = (status: AgentTurn["status"]): AgentThread =>
      thread({ turns: [turn({ status, endedAtEpochMs: 2_000 })], viewedAtEpochMs: 1_000 });

    expect(agentThreadUnread(ended({ kind: "failed", message: "x" }))).toBe(true);
    expect(agentThreadUnread(ended({ kind: "interrupted" }))).toBe(true);
    expect(agentThreadUnread(ended({ kind: "stopped" }))).toBe(true);
    expect(agentThreadUnread(ended({ kind: "exited", exitCode: 3 }))).toBe(true);
    expect(agentThreadUnread(thread({ turns: [turn({ status: { kind: "pending" } })] }))).toBe(
      false,
    );
  });

  it("reads only the last turn and ignores pinning and archiving", () => {
    const trailing = (viewedAtEpochMs: number | null): AgentThread =>
      thread({
        viewedAtEpochMs,
        turns: [
          turn({
            turnId: "agt-1-0a1b",
            status: { kind: "exited", exitCode: 0 },
            endedAtEpochMs: 9_000,
          }),
          turn({
            turnId: "agt-2-0a1b",
            status: { kind: "exited", exitCode: 0 },
            endedAtEpochMs: 2_000,
          }),
        ],
      });

    expect(agentThreadUnread(trailing(3_000))).toBe(false);
    expect(agentThreadUnread(trailing(1_000))).toBe(true);
    expect(agentThreadUnread({ ...trailing(1_000), pinned: true, archived: true })).toBe(true);
  });
});

describe("lastUsedAgentLaunch", () => {
  const stamped = (
    turnId: string,
    startedAtEpochMs: number,
    launch: AgentTurn["launch"],
  ): AgentTurn => turn({ turnId, startedAtEpochMs, launch });

  it("picks the newest launch by start time then turn id for the root and provider", () => {
    const threads = [
      thread({
        threadId: "agt-t1-0001",
        turns: [
          stamped("agt-1-0a1b", 1_000, { provider: "codex", model: "gpt-5.4", mode: "default" }),
        ],
      }),
      thread({
        threadId: "agt-t2-0001",
        turns: [
          stamped("agt-2-0a1b", 2_000, {
            provider: "codex",
            model: "gpt-5.5",
            mode: "workspaceWrite",
          }),
          stamped("agt-3-0a1b", 2_000, {
            provider: "codex",
            model: "gpt-5.6-sol",
            mode: "readOnly",
          }),
        ],
      }),
    ];

    expect(lastUsedAgentLaunch(threads, OWNER.rootKey, "codex")).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      mode: "readOnly",
    });
  });

  it("ignores other roots, other providers, and unstamped turns", () => {
    const foreign = thread({
      threadId: "agt-t3-0001",
      owner: { ...OWNER, rootKey: "/other" },
      turns: [
        stamped("agt-9-0a1b", 9_000, { provider: "codex", model: "gpt-5.5", mode: "default" }),
      ],
    });
    const claude = thread({
      threadId: "agt-t4-0001",
      turns: [
        stamped("agt-8-0a1b", 8_000, {
          provider: "claudeCode",
          model: "opus",
          mode: "plan",
          effort: "default",
        }),
      ],
    });
    const bare = thread({ threadId: "agt-t5-0001", turns: [turn({ turnId: "agt-7-0a1b" })] });

    expect(lastUsedAgentLaunch([foreign, claude, bare], OWNER.rootKey, "codex")).toBeNull();
    expect(lastUsedAgentLaunch([foreign, claude, bare], OWNER.rootKey, "claudeCode")).toEqual({
      provider: "claudeCode",
      model: "opus",
      mode: "plan",
      effort: "default",
    });
    expect(lastUsedAgentLaunch([], OWNER.rootKey, "codex")).toBeNull();
  });

  it("breaks a cross-thread tie by the higher turn id, whatever the iteration order", () => {
    const threads = [
      thread({
        threadId: "agt-t1-0001",
        turns: [
          stamped("agt-a-0a1b", 4_000, { provider: "codex", model: "gpt-5.4", mode: "readOnly" }),
        ],
      }),
      thread({
        threadId: "agt-t2-0001",
        turns: [
          stamped("agt-b-0a1b", 4_000, {
            provider: "codex",
            model: "gpt-5.5",
            mode: "workspaceWrite",
          }),
        ],
      }),
    ];
    const expected = { provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" };

    expect(lastUsedAgentLaunch(threads, OWNER.rootKey, "codex")).toEqual(expected);
    expect(lastUsedAgentLaunch([...threads].reverse(), OWNER.rootKey, "codex")).toEqual(expected);
  });

  it("skips a foreign provider turn that sits after the matching one in the same thread", () => {
    const mixed = thread({
      threadId: "agt-t1-0001",
      turns: [
        stamped("agt-1-0a1b", 1_000, { provider: "codex", model: "gpt-5.5", mode: "readOnly" }),
        stamped("agt-2-0a1b", 2_000, {
          provider: "claudeCode",
          model: "opus",
          mode: "acceptEdits",
          effort: "default",
        }),
      ],
    });

    expect(lastUsedAgentLaunch([mixed], OWNER.rootKey, "codex")).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      mode: "readOnly",
    });
  });
});

describe("agent thread wire compatibility", () => {
  it("reads a pre-slice document without launch or viewedAtEpochMs", () => {
    const stamped = thread({
      turns: [turn({ launch: { provider: "codex", model: "gpt-5.5", mode: "readOnly" } })],
      viewedAtEpochMs: 4_000,
    });
    const wire = serializeAgentThread(stamped) as Record<string, unknown>;
    const turns = (wire.turns as Record<string, unknown>[]).map((entry) => {
      const { launch: _launch, ...rest } = entry;
      return rest;
    });
    const { viewedAtEpochMs: _viewed, ...rest } = wire;

    const parsed = parseAgentThread({ ...rest, turns });

    expect(parsed.viewedAtEpochMs).toBeNull();
    expect(parsed.turns[0]?.launch).toBeNull();
  });

  it("round trips a stamped launch and view time and rejects an invalid launch", () => {
    const stamped = thread({
      turns: [
        turn({
          launch: {
            provider: "claudeCode",
            model: "sonnet",
            mode: "bypassPermissions",
            effort: "default",
          },
        }),
      ],
      viewedAtEpochMs: 4_000,
    });

    const wire = JSON.parse(JSON.stringify(serializeAgentThread(stamped))) as Record<
      string,
      unknown
    >;
    expect(parseAgentThread(wire)).toEqual(stamped);

    const turns = (wire.turns as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      launch: { provider: "claudeCode", model: "sonnet", mode: "yolo", effort: "default" },
    }));
    expect(() => parseAgentThread({ ...wire, turns })).toThrow(TypeError);
  });

  it("accepts an explicit null launch and view time", () => {
    const wire = serializeAgentThread(thread()) as Record<string, unknown>;
    const turns = (wire.turns as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      launch: null,
    }));

    const parsed = parseAgentThread({ ...wire, turns, viewedAtEpochMs: null });

    expect(parsed.viewedAtEpochMs).toBeNull();
    expect(parsed.turns[0]?.launch).toBeNull();
  });

  it("round trips the default launch of both providers", () => {
    for (const launch of [
      { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
      { provider: "codex", model: "default", mode: "default" },
    ] as const) {
      const stamped = thread({ turns: [turn({ launch })] });
      const wire = JSON.parse(JSON.stringify(serializeAgentThread(stamped))) as unknown;
      expect(parseAgentThread(wire).turns[0]?.launch).toEqual(launch);
    }
  });

  it("fails the whole thread closed on an unknown key inside a persisted launch", () => {
    const wire = serializeAgentThread(thread()) as Record<string, unknown>;
    const turns = (wire.turns as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      launch: { provider: "codex", model: "default", mode: "default", effort: "high" },
    }));

    expect(() => parseAgentThread({ ...wire, turns })).toThrow(/thread\.turns\[0\]\.launch/);
  });

  it("rejects a view time that is not an unsigned safe integer", () => {
    const wire = serializeAgentThread(thread()) as Record<string, unknown>;

    expect(() => parseAgentThread({ ...wire, viewedAtEpochMs: -1 })).toThrow(TypeError);
    expect(() => parseAgentThread({ ...wire, viewedAtEpochMs: 1.5 })).toThrow(TypeError);
    expect(() => parseAgentThread({ ...wire, viewedAtEpochMs: "4000" })).toThrow(TypeError);
  });
});

describe("parseAgentThread", () => {
  const full = thread({
    target: { isolation: "worktree", worktreePath: "/repo/.worktrees/agt-t1-0001" },
    provider: { kind: "codex", sessionId: "019b0c7e-1234-7abc-8def-0123456789ab" },
    pinned: true,
    turns: [
      turn({
        status: { kind: "failed", message: "boom" },
        endedAtEpochMs: 3_000,
        events: [
          text("hi"),
          { kind: "reasoning", text: "why" },
          { kind: "toolCall", toolId: "t1", name: "Bash", inputSummary: "ls" },
          { kind: "toolResult", toolId: "t1", outputSummary: "ok", isError: false },
          {
            kind: "result",
            text: "done",
            isError: false,
            usage: { inputTokens: 1, outputTokens: 2 },
          },
          { kind: "result", text: "", isError: true, usage: null },
          { kind: "error", message: "e" },
          { kind: "unknownLine", stream: "stderr", raw: "raw", clipped: true },
        ],
        eventsTruncated: true,
        lastStatusSequence: 3,
        lastOutputSequence: 7,
        launch: null,
      }),
      turn({ turnId: "agt-2-0a1b", status: { kind: "interrupted" } }),
    ],
    turnsTruncated: true,
    viewedAtEpochMs: null,
  });

  it("round trips through serialize and parse", () => {
    const wire = JSON.parse(JSON.stringify(serializeAgentThread(full))) as unknown;
    expect(parseAgentThread(wire)).toEqual(full);
  });

  it("rejects unknown and missing fields fail closed", () => {
    const base = serializeAgentThread(full);
    const rejected: readonly unknown[] = [
      { ...base, extra: 1 },
      (() => {
        const { title: _title, ...rest } = base;
        return rest;
      })(),
      { ...base, owner: { ...(base.owner as object), extra: 1 } },
      { ...base, provider: { kind: "codex", sessionId: "-bad" } },
      { ...base, provider: { kind: "gemini", sessionId: null } },
      { ...base, target: { isolation: "in-place", worktreePath: "/x" } },
      { ...base, turns: [{ ...(serializeAgentThread(full).turns as object[])[0], extra: 1 }] },
      {
        ...base,
        turns: [{ ...(base.turns as Record<string, unknown>[])[1], status: { kind: "exited" } }],
      },
      {
        ...base,
        turns: [
          {
            ...(base.turns as Record<string, unknown>[])[1],
            events: [{ kind: "toolCall", toolId: "t", name: "n" }],
          },
        ],
      },
      { ...base, turns: [(base.turns as unknown[])[1], (base.turns as unknown[])[1]] },
      { ...base, threadId: "Bad Id" },
      { ...base, createdAtEpochMs: -1 },
      { ...base, title: "" },
      null,
      [],
    ];
    for (const value of rejected) {
      expect(() => parseAgentThread(value)).toThrow(TypeError);
    }
  });

  it("rejects a non-terminal turn that is not the last one", () => {
    const wire = serializeAgentThread(thread({ turns: [turn(), turn({ turnId: "agt-2-0a1b" })] }));
    expect(() => parseAgentThread(wire)).toThrow(TypeError);
  });

  it("rejects over-cap collections", () => {
    const wire = serializeAgentThread(full);
    const turns = Array.from({ length: MAX_AGENT_TURNS_PER_THREAD + 1 }, (_, index) => ({
      ...(wire.turns as Record<string, unknown>[])[1],
      turnId: `agt-${index}-0a1b`,
    }));
    expect(() => parseAgentThread({ ...wire, turns })).toThrow(TypeError);
  });
});

describe("agent thread wire module", () => {
  it("keeps the wire parser reachable from the domain module after the extraction", () => {
    expect(parseAgentThread).toBe(wireParseAgentThread);
    expect(serializeAgentThread).toBe(wireSerializeAgentThread);
  });

  it("round trips every event the output parser produces from the captured fixtures", () => {
    const fixtures: ReadonlyArray<{ readonly name: string; readonly kind: AgentCliKind }> = [
      { name: "claude-first-turn", kind: "claudeCode" },
      { name: "claude-resume-turn", kind: "claudeCode" },
      { name: "codex-first-turn", kind: "codex" },
      { name: "codex-resume-turn", kind: "codex" },
    ];
    for (const entry of fixtures) {
      const chunk = readFileSync(
        join(process.cwd(), "src", "domain", "agentOutput", "fixtures", `${entry.name}.jsonl`),
        "utf8",
      );
      const parserState = createAgentOutputParserState(entry.kind);
      const fed = feedAgentOutput(parserState, "stdout", chunk);
      const persisted = thread({
        provider: { kind: entry.kind, sessionId: fed.sessionId },
        turns: [
          turn({
            status: { kind: "exited", exitCode: 0 },
            endedAtEpochMs: 2_000,
            events: fed.events,
          }),
        ],
      });

      expect(parseAgentThread(serializeAgentThread(persisted))).toEqual(persisted);
    }
  });
});
