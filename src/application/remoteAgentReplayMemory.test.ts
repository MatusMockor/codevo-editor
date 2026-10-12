import { describe, expect, it } from "vitest";
import type { RemoteRunnerServer, RemoteRunnerTask } from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { REMOTE_OUTPUT_DISCARDED_ERROR } from "./remoteAgentReplayWindow";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import { remoteTurn } from "./remoteAgentTailFirstTestSupport";
import type { RemoteReplayBackfill } from "./remoteAgentTaskReplay";
import {
  createRemoteReplayMemory,
  transitionRemoteReplayMemory,
  MAX_REMOTE_REPLAY_MEMORY_BYTES,
  MAX_REMOTE_REPLAY_MEMORY_THREADS,
  invalidateRemoteReplayMemoryServer,
  remoteReplayMemoryTaskBytes,
} from "./remoteAgentReplayMemory";

function retainedStringLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    return values.reduce<number>((total, item) => total + retainedStringLength(item), 0);
  }
  if (value !== null && typeof value === "object")
    return Object.entries(value).reduce<number>(
      (total, [key, item]) => total + key.length + retainedStringLength(item),
      0,
    );
  return 0;
}

const server: RemoteRunnerServer = {
  id: "server",
  name: "Server",
  host: "host",
  username: "user",
  port: 22,
  connected: true,
};
const thread = (id: string) => remoteAgentThreadKey("server", "runner", id);
const task = (id: string, change: Partial<RemoteRunnerTask> = {}) =>
  remoteTurn(Number(id.slice(1)), { id, conversationId: id, parentTaskId: undefined, ...change });
function snapshot(
  tasks: readonly RemoteRunnerTask[],
  selected = tasks[0]!,
  bytes = 2,
): RemoteAgentInventorySnapshot {
  return {
    ...emptyRemoteInventory("server", true),
    descriptor: {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true },
    },
    tasks,
    replays: new Map([
      [
        selected.id,
        [
          {
            sequence: 2,
            taskId: selected.id,
            type: "task.output",
            text: "x".repeat(bytes / 2),
            createdAt: selected.createdAt,
          },
        ],
      ],
    ]),
    replayCursors: new Map([[selected.id, 2]]),
    replayBackfill: new Map([[selected.id, { kind: "loaded" }]]),
    replayComplete: new Set([selected.id]),
  };
}
function session(tasks: readonly RemoteRunnerTask[]) {
  const lease = {};
  let memory = createRemoteReplayMemory(lease);
  let snapshots: readonly RemoteAgentInventorySnapshot[] = [];
  const move = (
    selectedThreadId: string | null,
    next = snapshots,
    servers = [server],
    owner = lease,
    excludedServerIds?: ReadonlySet<string>,
  ) => {
    const result = transitionRemoteReplayMemory(memory, {
      lease: owner,
      servers,
      snapshots: next,
      selectedThreadId,
      excludedServerIds,
    });
    memory = result.memory;
    snapshots = result.snapshots;
    return result;
  };
  const select = (selected: RemoteRunnerTask, bytes = 2) => {
    move(thread(selected.id));
    return move(thread(selected.id), [snapshot(tasks, selected, bytes)]);
  };
  return {
    move,
    select,
    lease,
    entries: () => memory.entries,
    current: () => snapshots,
    invalidate: () => {
      memory = invalidateRemoteReplayMemoryServer(memory, server.id);
    },
  };
}

describe("remote replay memory", () => {
  it("restores a deselected replay with identical arrays and its complete state", () => {
    const a = task("t1");
    const b = task("t2");
    const state = session([a, b]);
    const before = state.select(a).snapshots[0]!;
    state.move(thread(b.id));
    expect(state.current()[0]!.replays.size).toBe(0);
    const restored = state.move(thread(a.id));
    expect(restored.restored).toBe(true);
    expect(restored.snapshots[0]!.replays.get(a.id)).toBe(before.replays.get(a.id));
    expect(restored.snapshots[0]!.replayCursors).toEqual(before.replayCursors);
    expect(restored.snapshots[0]!.replayComplete).toEqual(before.replayComplete);
    expect([...restored.snapshots[0]!.replayRestore!.keys()]).toEqual([a.id]);
    expect(restored.snapshots[0]!.replayRestore!.get(a.id)?.kind).toBe("recheckTail");
    expect(state.entries()).toHaveLength(0);
  });

  it.each(["pending", "scanningInputs", "scanningBoundary"] as const)(
    "preserves suspended %s cursors and unread turn markers",
    (kind) => {
      const a = task("t1");
      const later = task("t2", { conversationId: a.id, parentTaskId: a.id });
      const state = session([a, later]);
      state.select(a);
      const phase: RemoteReplayBackfill =
        kind === "pending" ? { kind, before: 73, truncated: false } : { kind, before: 73 };
      const original = {
        ...state.current()[0]!,
        replayBackfill: new Map([[a.id, phase]]),
        replayTruncated: new Set([a.id, later.id]),
        replayGaps: new Map([[a.id, { throughSequence: 72, startsAtLineBoundary: false }]]),
      };
      state.move(thread(a.id), [original]);
      state.move(null);
      const restored = state.move(thread(a.id)).snapshots[0]!;
      expect(restored.replayBackfill).toEqual(original.replayBackfill);
      expect(restored.replayTruncated).toEqual(original.replayTruncated);
      expect(restored.replayGaps).toEqual(original.replayGaps);
      expect(restored.replays.get(a.id)).toBe(original.replays.get(a.id));
      expect([...restored.replayRestore!.keys()]).toEqual([a.id]);
    },
  );

  it("keeps terminal status changes and drops only remembered completion", () => {
    const a = task("t1", { status: "cancelled" });
    const state = session([a]);
    const first = state.select(a).snapshots[0]!;
    state.move(null);
    const prior = state.current()[0]!;
    const incoming = { ...prior, tasks: [{ ...a, status: "failed" as const }] };

    const returned = state.move(thread(a.id), [incoming]);

    expect(returned.restored).toBe(true);
    expect(returned.snapshots[0]!.replays.get(a.id)).toBe(first.replays.get(a.id));
    expect(returned.snapshots[0]!.replayComplete.has(a.id)).toBe(false);
    expect(returned.snapshots[0]!.replayCursors).toEqual(first.replayCursors);
    expect(returned.snapshots[0]!.replayRestore!.get(a.id)?.kind).toBe("recheckTail");
  });

  it.each([
    ["Could not refresh remote tasks.", null],
    [null, "Current server notice."],
  ])(
    "keeps current error when remembered and current values are %j then %j",
    (rememberedError, currentError) => {
      const a = task("t1");
      const state = session([a]);
      state.select(a);
      state.move(thread(a.id), [{ ...state.current()[0]!, error: rememberedError }]);
      state.move(null);
      const current = { ...state.current()[0]!, error: currentError, connected: true };

      const returned = state.move(thread(a.id), [current]).snapshots[0]!;

      expect(returned.connected).toBe(true);
      expect(returned.error).toBe(currentError);
    },
  );

  it("restores the discarded-output notice from remembered replay state", () => {
    const a = task("t1");
    const state = session([a]);
    state.select(a);
    state.move(thread(a.id), [
      {
        ...state.current()[0]!,
        replayDiscarded: new Set([a.id]),
        replayTruncated: new Set([a.id]),
        error: REMOTE_OUTPUT_DISCARDED_ERROR,
      },
    ]);
    state.move(null);
    const current = { ...state.current()[0]!, error: "Current server notice." };

    expect(state.move(thread(a.id), [current]).snapshots[0]!.error).toBe(
      REMOTE_OUTPUT_DISCARDED_ERROR,
    );
  });

  it("restores only the bounded turns carrying remembered replay content", () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task(`t${index + 1}`, { conversationId: "t1" }),
    );
    const a = tasks[0]!;
    const state = session(tasks);
    state.select(a);
    const records = tasks.slice(0, 64);
    const original = state.current()[0]!;
    state.move(thread(a.id), [
      {
        ...original,
        replays: new Map(
          records.map((record) => [
            record.id,
            [{ ...original.replays.get(a.id)![0]!, taskId: record.id }],
          ]),
        ),
        replayCursors: new Map(records.map((record) => [record.id, 2])),
        replayComplete: new Set(records.map((record) => record.id)),
        replayBackfill: new Map(records.map((record) => [record.id, { kind: "loaded" as const }])),
      },
    ]);
    state.move(null);
    expect(state.entries()[0]!.tasks).toHaveLength(64);

    const returned = state.move(thread(a.id)).snapshots[0]!;

    expect(returned.replayRestore?.size).toBe(64);
    expect([...returned.replayRestore!.keys()]).toEqual(records.map((record) => record.id));
    expect(returned.replayRestore?.has("t65")).toBe(false);
    expect(returned.replayRestore?.has("t100")).toBe(false);
  });

  it("accounts for every retained event field, resume and lifecycle monotonically", () => {
    const a = task("t1");
    const state = session([a]);
    state.select(a);
    state.move(null);
    const record = state.entries()[0]!.tasks[0]!;
    const representative = {
      ...record,
      resume: { available: false as const, reason: "session_unavailable" as const },
      replay: {
        ...record.replay,
        events: [
          {
            sequence: 1,
            taskId: "t".repeat(200),
            type: "task.created" as const,
            createdAt: a.createdAt,
          },
          {
            sequence: 2,
            taskId: a.id,
            type: "task.output" as const,
            createdAt: a.createdAt,
            channel: "stderr" as const,
            text: "汉字".repeat(10_000) + '\u0000\u001fé🧪"\n',
            error: "error",
            exitCode: 1,
          },
          {
            sequence: 3,
            taskId: a.id,
            type: "task.input" as const,
            createdAt: a.createdAt,
            messageId: "message".repeat(50),
            parts: [
              { type: "text" as const, text: "steer é🧪" },
              { type: "attachment" as const, attachmentId: "attachment".repeat(100) },
            ],
          },
        ],
        lifecycle: {
          entries: [
            {
              id: "agent",
              name: "Agent",
              description: "retained detail",
              state: "running" as const,
            },
          ],
          truncated: false,
          openBatchKey: "batch",
          countedNestedToolIds: ["nested"],
        },
      },
    };

    expect(remoteReplayMemoryTaskBytes(representative)).toBeGreaterThan(
      remoteReplayMemoryTaskBytes(record),
    );
    expect(remoteReplayMemoryTaskBytes(representative)).toBeGreaterThanOrEqual(
      2 * retainedStringLength(representative),
    );
    expect(remoteReplayMemoryTaskBytes(record)).toBeGreaterThanOrEqual(
      new TextEncoder().encode(JSON.stringify(record)).byteLength,
    );
  });

  it("stops accounting an over-cap 64-turn thread before visiting every event", () => {
    const tasks = Array.from({ length: 64 }, (_, index) =>
      task(`t${index + 1}`, { conversationId: "t1" }),
    );
    const state = session(tasks);
    state.select(tasks[0]!);
    let visitedEvents = 0;
    const replays = new Map(
      tasks.map((turn) => [
        turn.id,
        Array.from({ length: 1_100 }, (_, index) => ({
          sequence: index + 1,
          taskId: turn.id,
          type: "task.output" as const,
          createdAt: turn.createdAt,
          get text() {
            visitedEvents += 1;
            return "x".repeat(256);
          },
        })),
      ]),
    );
    const original = state.current()[0]!;
    state.move(thread(tasks[0]!.id), [
      {
        ...original,
        replays,
        replayCursors: new Map(tasks.map((turn) => [turn.id, 1_100])),
        replayComplete: new Set(tasks.map((turn) => turn.id)),
        replayBackfill: new Map(tasks.map((turn) => [turn.id, { kind: "loaded" as const }])),
      },
    ]);

    state.move(null);

    expect(state.entries()).toHaveLength(0);
    expect(visitedEvents).toBeGreaterThan(0);
    expect(visitedEvents).toBeLessThan(40_000);
  });

  it.each([1, 10])("remembers %i turns of 1,100 small events within the cap", (turnCount) => {
    const tasks = Array.from({ length: turnCount }, (_, index) =>
      task(`t${index + 1}`, { conversationId: "t1" }),
    );
    const state = session(tasks);
    state.select(tasks[0]!);
    const original = state.current()[0]!;
    state.move(thread(tasks[0]!.id), [
      {
        ...original,
        replays: new Map(
          tasks.map((turn) => [
            turn.id,
            Array.from({ length: 1_100 }, (_, index) => ({
              sequence: index + 1,
              taskId: turn.id,
              type: "task.output" as const,
              createdAt: turn.createdAt,
              text: "x".repeat(256),
            })),
          ]),
        ),
        replayCursors: new Map(tasks.map((turn) => [turn.id, 1_100])),
        replayComplete: new Set(tasks.map((turn) => turn.id)),
        replayBackfill: new Map(tasks.map((turn) => [turn.id, { kind: "loaded" as const }])),
      },
    ]);

    state.move(null);

    expect(state.entries()).toHaveLength(1);
    expect(state.entries()[0]!.tasks).toHaveLength(turnCount);
    expect(state.entries()[0]!.bytes).toBeGreaterThan(turnCount * 1_100 * 512);
    expect(state.entries()[0]!.bytes).toBeLessThan(turnCount * 1024 * 1024);
  });

  it("counts input text and event overhead in the retained byte limit", () => {
    const a = task("t1");
    const state = session([a]);
    state.select(a);
    const prior = state.current()[0]!;
    const event = prior.replays.get(a.id)![0]!;
    state.move(thread(a.id), [
      {
        ...prior,
        replays: new Map([
          [
            a.id,
            [
              {
                ...event,
                type: "task.input",
                parts: [{ type: "text", text: "x".repeat(MAX_REMOTE_REPLAY_MEMORY_BYTES / 2) }],
              },
            ],
          ],
        ]),
      },
    ]);
    state.move(null);
    expect(state.entries()).toHaveLength(0);
  });

  it("evicts the oldest selection at the ninth deselected thread and updates recency", () => {
    const tasks = Array.from({ length: 10 }, (_, index) => task(`t${index + 1}`));
    const state = session(tasks);
    for (const selected of tasks.slice(0, 8)) state.select(selected);
    state.move(null);
    state.move(thread(tasks[0]!.id));
    state.move(null);
    state.select(tasks[8]!);
    state.move(null);
    expect(state.entries()).toHaveLength(MAX_REMOTE_REPLAY_MEMORY_THREADS);
    expect(state.entries().map((entry) => entry.threadId)).toEqual([
      ...tasks.slice(2, 8).map((item) => thread(item.id)),
      thread(tasks[0]!.id),
      thread(tasks[8]!.id),
    ]);
    expect(state.move(thread(tasks[1]!.id)).restored).toBe(false);
  });

  it("evicts by accounted bytes and refuses a single over-cap thread", () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const state = session(tasks);
    state.select(tasks[0]!, MAX_REMOTE_REPLAY_MEMORY_BYTES / 2);
    state.select(tasks[1]!, MAX_REMOTE_REPLAY_MEMORY_BYTES / 2);
    state.move(null);
    expect(state.entries().map((entry) => entry.threadId)).toEqual([thread(tasks[1]!.id)]);
    state.select(tasks[2]!, MAX_REMOTE_REPLAY_MEMORY_BYTES);
    state.move(null);
    expect(state.entries().map((entry) => entry.threadId)).toEqual([thread(tasks[1]!.id)]);
  });

  it.each([
    ["task removed", () => []],
    ["runner changed", (a: RemoteRunnerTask) => [{ ...a, runnerId: "other" }]],
    ["membership changed", (a: RemoteRunnerTask) => [{ ...a, conversationId: "other" }]],
    ["provider changed", (a: RemoteRunnerTask) => [{ ...a, provider: "codex" as const }]],
    ["created time changed", (a: RemoteRunnerTask) => [{ ...a, createdAt: "later" }]],
    ["sequence changed", (a: RemoteRunnerTask) => [{ ...a, sequence: a.sequence + 1 }]],
    ["status moved backwards", (a: RemoteRunnerTask) => [{ ...a, status: "running" as const }]],
  ])("invalidates remembered histories when %s", (_, change) => {
    const a = task("t1");
    const state = session([a]);
    state.select(a);
    state.move(null);
    const prior = state.current()[0]!;
    expect(state.move(thread(a.id), [{ ...prior, tasks: change(a) }]).restored).toBe(false);
    expect(state.entries()).toHaveLength(0);
  });

  it("keeps plain reconnects but invalidates endpoint, removal, lease and runner changes", () => {
    const a = task("t1");
    const variants = [
      { servers: [{ ...server, host: "different" }], lease: undefined, runnerId: "runner" },
      { servers: [], lease: undefined, runnerId: "runner" },
      { servers: [server], lease: {}, runnerId: "runner" },
      { servers: [server], lease: undefined, runnerId: "different" },
    ];
    for (const variant of variants) {
      const state = session([a]);
      state.select(a);
      state.move(null);
      const prior = state.current()[0]!;
      state.move(
        null,
        [{ ...prior, descriptor: { ...prior.descriptor!, runnerId: variant.runnerId } }],
        variant.servers,
        variant.lease ?? state.lease,
      );
      expect(state.entries()).toHaveLength(0);
      expect(state.move(thread(a.id)).restored).toBe(false);
    }
    const state = session([a]);
    state.select(a);
    state.move(null, undefined, [{ ...server, connected: false }]);
    state.move(null, undefined, [server]);
    expect(state.move(thread(a.id)).restored).toBe(true);
  });

  it("explicitly invalidates all entries for a replaced runner", () => {
    const a = task("t1");
    const state = session([a]);
    state.select(a);
    state.move(null);
    state.invalidate();
    expect(state.move(thread(a.id)).restored).toBe(false);
  });

  it("keeps selected replay and excludes a replaced server from later memory", () => {
    const a = task("t1");
    const state = session([a]);
    const original = state.select(a).snapshots[0]!;
    const excluded = new Set([server.id]);

    const pinned = state.move(thread(a.id), undefined, [server], state.lease, excluded);

    expect(pinned.snapshots[0]!.replays).toBe(original.replays);
    expect(pinned.snapshots[0]!.replayTruncated).toBe(original.replayTruncated);
    state.move(null, undefined, [server], state.lease, excluded);
    expect(state.entries()).toHaveLength(0);
    expect(state.move(thread(a.id), undefined, [server], state.lease, excluded).restored).toBe(
      false,
    );
  });
});
