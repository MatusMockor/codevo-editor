import { describe, expect, it, vi } from "vitest";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsState,
} from "../../domain/agentThread";
import {
  agentThreadsStructuralSnapshot,
  createAgentThreadStateStore,
} from "./agentThreadStateStore";

const OWNER_ID = "workspace-a";
const ROOT = "/workspace-a";

function thread(threadId: string, turnId: string): AgentThread {
  return {
    threadId,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "codex", sessionId: null },
    title: threadId,
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [
      {
        turnId,
        prompt: "go",
        status: { kind: "running" },
        startedAtEpochMs: 10,
        endedAtEpochMs: null,
        events: [{ kind: "assistantText", text: "a" }],
        eventsTruncated: false,
        foregroundSettled: false,
        queueBoundarySequence: 0,
        lastStatusSequence: 1,
        lastOutputSequence: 1,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: 10,
    externalOrigin: null,
  };
}

function withThreads(...threads: AgentThread[]): AgentThreadsState {
  return threads.reduce(
    (state, created) => agentThreadsReducer(state, { kind: "threadCreated", thread: created }),
    emptyAgentThreadsState(),
  );
}

function text(state: AgentThreadsState, threadId: string, turnId: string, sequence: number) {
  return agentThreadsReducer(state, {
    kind: "turnEventsAppended",
    threadId,
    turnId,
    workspaceId: OWNER_ID,
    repositoryRoot: ROOT,
    isolation: "in-place",
    worktreePath: null,
    outputSequence: sequence,
    events: [{ kind: "assistantText", text: `+${sequence}` }],
    sessionId: null,
    supervisorTruncated: false,
  });
}

describe("agent thread state store", () => {
  it("keeps the structural snapshot while only transcript text streams", () => {
    const initial = withThreads(thread("thread-a", "turn-a"), thread("thread-b", "turn-b"));
    const store = createAgentThreadStateStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    store.stage(text(initial, "thread-a", "turn-a", 2));
    store.notify();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.structural()).toBe(initial);
    const shown = store.structural().threads.get("thread-a")!;
    expect(store.liveThreadOf(shown)).toBe(store.current().threads.get("thread-a"));
    expect(store.liveThreadOf(shown).turns[0]?.events[0]).toEqual({
      kind: "assistantText",
      text: "a+2",
    });
    const other = store.structural().threads.get("thread-b")!;
    expect(store.liveThreadOf(other)).toBe(other);
  });

  it("publishes a new structural snapshot for status and identity changes", () => {
    const initial = withThreads(thread("thread-a", "turn-a"));
    const store = createAgentThreadStateStore(initial);
    const renamed = agentThreadsReducer(text(initial, "thread-a", "turn-a", 2), {
      kind: "threadRenamed",
      threadId: "thread-a",
      title: "Renamed",
    });

    store.stage(renamed);

    expect(store.structural()).not.toBe(initial);
    expect(store.structural().threads.get("thread-a")).toBe(renamed.threads.get("thread-a"));
  });

  it("hands out live content for an older view of the same thread but never for a foreign owner", () => {
    const initial = withThreads(thread("thread-a", "turn-a"));
    const store = createAgentThreadStateStore(initial);
    const stale = initial.threads.get("thread-a")!;
    store.stage(
      agentThreadsReducer(initial, { kind: "threadRenamed", threadId: "thread-a", title: "B" }),
    );
    store.stage(text(store.current(), "thread-a", "turn-a", 2));

    expect(store.liveThreadOf(stale)).toBe(store.current().threads.get("thread-a"));
    const foreign = { ...stale, owner: { ...stale.owner, ownerId: "x" } };
    expect(store.liveThreadOf(foreign)).toBe(foreign);
    const removed = { ...stale, threadId: "thread-gone" };
    expect(store.liveThreadOf(removed)).toBe(removed);
  });

  it("never resolves an old view to a deleted and recreated thread with the same id", () => {
    const original = thread("thread-a", "turn-a");
    const initial = withThreads(original);
    const store = createAgentThreadStateStore(initial);
    const shown = initial.threads.get("thread-a")!;
    store.stage(emptyAgentThreadsState());
    store.stage(withThreads(original));

    expect(store.current().threads.get("thread-a")).not.toBe(shown);
    expect(store.liveThreadOf(shown)).toBe(shown);

    store.stage(emptyAgentThreadsState());
    store.stage(withThreads({ ...original, createdAtEpochMs: 20 }));
    expect(store.liveThreadOf(shown)).toBe(shown);
  });

  it("never resolves a view across an A to B to A owner change", () => {
    const original = thread("thread-a", "turn-a");
    const initial = withThreads(original);
    const store = createAgentThreadStateStore(initial);
    const shown = initial.threads.get("thread-a")!;
    const reowned = (ownerId: string): AgentThreadsState => ({
      threads: new Map([
        [
          "thread-a",
          { ...store.current().threads.get("thread-a")!, owner: { ...original.owner, ownerId } },
        ],
      ]),
    });
    store.stage(reowned("workspace-b"));
    store.stage(reowned(OWNER_ID));

    expect(store.current().threads.get("thread-a")?.owner.ownerId).toBe(OWNER_ID);
    expect(store.liveThreadOf(shown)).toBe(shown);

    const continued = store.current().threads.get("thread-a")!;
    store.stage(text(store.current(), "thread-a", "turn-a", 2));
    expect(store.liveThreadOf(continued)).toBe(store.current().threads.get("thread-a"));
  });

  it("notifies once per staged change and never for an unchanged state", () => {
    const initial = withThreads(thread("thread-a", "turn-a"));
    const store = createAgentThreadStateStore(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.notify();
    store.stage(initial);
    store.notify();
    expect(listener).not.toHaveBeenCalled();

    store.stage(text(initial, "thread-a", "turn-a", 2));
    store.stage(text(store.current(), "thread-a", "turn-a", 3));
    store.notify();
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.stage(text(store.current(), "thread-a", "turn-a", 4));
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("follows removals, additions and reordering", () => {
    const a = thread("thread-a", "turn-a");
    const b = thread("thread-b", "turn-b");
    const shown = withThreads(a, b);
    const reordered: AgentThreadsState = {
      threads: new Map([
        ["thread-b", shown.threads.get("thread-b")!],
        ["thread-a", shown.threads.get("thread-a")!],
      ]),
    };
    const removed: AgentThreadsState = {
      threads: new Map([["thread-a", shown.threads.get("thread-a")!]]),
    };

    expect([...agentThreadsStructuralSnapshot(shown, reordered).threads.keys()]).toEqual([
      "thread-b",
      "thread-a",
    ]);
    expect([...agentThreadsStructuralSnapshot(shown, removed).threads.keys()]).toEqual([
      "thread-a",
    ]);
    expect(agentThreadsStructuralSnapshot(removed, shown).threads.get("thread-b")).toBe(
      shown.threads.get("thread-b"),
    );
  });
});
