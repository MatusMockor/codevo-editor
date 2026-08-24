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
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_THREADS_PER_ROOT,
  MAX_AGENT_THREAD_TITLE_BYTES,
  MAX_AGENT_TURNS_PER_THREAD,
  agentThreadLifecycle,
  agentThreadTitle,
  agentThreadsReducer,
  emptyAgentThreadsState,
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
): AgentThreadsAction {
  return { kind: "taskStatusEvent", event: statusEvent(overrides), nowEpochMs };
}

function appendAction(
  events: ReadonlyArray<AgentTurnEvent>,
  overrides: Partial<Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>> = {},
): AgentThreadsAction {
  return {
    kind: "turnEventsAppended",
    turnId: "agt-1-0a1b",
    outputSequence: 1,
    events,
    sessionId: null,
    supervisorTruncated: false,
    ...overrides,
  };
}

function text(value: string): AgentTurnEvent {
  return { kind: "assistantText", text: value };
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
    ];
    for (const overrides of dropped) {
      expect(agentThreadsReducer(state, statusAction(overrides))).toBe(state);
    }
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
    const next = turn({ turnId: "agt-2-0a1b", startedAtEpochMs: 9_000 });
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
    const state = stateWith(thread());
    const interrupted = agentThreadsReducer(state, {
      kind: "turnInterrupted",
      turnId: "agt-1-0a1b",
      nowEpochMs: 4_000,
    });
    const updated = interrupted.threads.get("agt-t1-0001")?.turns[0];
    expect(updated?.status).toEqual({ kind: "interrupted" });
    expect(updated?.endedAtEpochMs).toBe(4_000);
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
          turns: [turn({ turnId: "agt-d-0a1b", status: { kind: "running" } })],
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
    expect(agentThreadLifecycle(loaded.threads.get("agt-disk-0001") as AgentThread)).toBe(
      "settled",
    );
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
      }),
      turn({ turnId: "agt-2-0a1b", status: { kind: "interrupted" } }),
    ],
    turnsTruncated: true,
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
