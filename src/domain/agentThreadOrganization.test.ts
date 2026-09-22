import { describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
} from "./agentThread";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";
import { agentThreadReorderPlan, compareAgentThreadOrder } from "./agentThreadOrganization";

function thread(id = "agt-t1-0001"): AgentThread {
  return {
    threadId: id,
    owner: { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "title",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1000,
    updatedAtEpochMs: 2000,
    turns: [],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}
function state(...threads: AgentThread[]): AgentThreadsState {
  return { threads: new Map(threads.map((t) => [t.threadId, t])) };
}
describe("thread organization", () => {
  it("keeps legacy documents byte-shape compatible and roundtrips organization", () => {
    const legacy = serializeAgentThread(thread());
    expect(serializeAgentThread(parseAgentThread(legacy))).toEqual(legacy);
    expect(legacy).not.toHaveProperty("snoozedUntil");
    const current = { ...thread(), snoozedUntil: 3000, settledAt: null, sortOrder: 0 };
    expect(parseAgentThread(serializeAgentThread(current))).toEqual(current);
  });
  it.each([NaN, Infinity, -1, 1.5, 8_640_000_000_000_001, "3", {}, true, undefined])(
    "rejects invalid stored value %s",
    (value) => {
      for (const field of ["snoozedUntil", "settledAt"])
        expect(() =>
          parseAgentThread({ ...serializeAgentThread(thread()), [field]: value }),
        ).toThrow();
    },
  );
  it("supports finite fractional and negative order keys, rejects invalid order", () => {
    for (const sortOrder of [-1.5, 0.5, Number.MAX_SAFE_INTEGER])
      expect(parseAgentThread({ ...serializeAgentThread(thread()), sortOrder }).sortOrder).toBe(
        sortOrder,
      );
    for (const sortOrder of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", undefined])
      expect(() => parseAgentThread({ ...serializeAgentThread(thread()), sortOrder })).toThrow();
  });
  it("rejects foreign and stale owner writes, invalid and conflicting patches", () => {
    const t = thread();
    const initial = state(t);
    for (const owner of [
      { ...t.owner, ownerId: "other" },
      { ...t.owner, rootKey: "/other" },
      { ...t.owner, repositoryRoot: "/other" },
    ]) {
      expect(
        agentThreadsReducer(initial, {
          kind: "threadOrganizationUpdated",
          threadId: t.threadId,
          owner,
          patch: { settledAt: 3000 },
        }),
      ).toBe(initial);
    }
    for (const patch of [
      { settledAt: -1 },
      { sortOrder: NaN },
      { settledAt: 3000, snoozedUntil: 4000 },
    ])
      expect(
        agentThreadsReducer(initial, {
          kind: "threadOrganizationUpdated",
          threadId: t.threadId,
          owner: t.owner,
          patch,
        }),
      ).toBe(initial);
    const changed = agentThreadsReducer(initial, {
      kind: "threadOrganizationUpdated",
      threadId: t.threadId,
      owner: t.owner,
      patch: { settledAt: 3000 },
    });
    expect(changed.threads.get(t.threadId)?.settledAt).toBe(3000);
    expect(t.settledAt).toBeUndefined();
  });
  it("does not settle a running thread and restores settled metadata without altering history", () => {
    const t: AgentThread = {
      ...thread(),
      turns: [
        {
          turnId: "agt-1-0a1b",
          prompt: "work",
          status: { kind: "running" },
          startedAtEpochMs: 1000,
          endedAtEpochMs: null,
          events: [],
          eventsTruncated: false,
          lastStatusSequence: 0,
          lastOutputSequence: 0,
          streamMetrics: null,
          launch: null,
          cliVersion: null,
        },
      ],
    };
    const initial = state(t);
    expect(
      agentThreadsReducer(initial, {
        kind: "threadOrganizationUpdated",
        threadId: t.threadId,
        owner: t.owner,
        patch: { settledAt: 3000 },
      }),
    ).toBe(initial);
    const snoozed = agentThreadsReducer(initial, {
      kind: "threadOrganizationUpdated",
      threadId: t.threadId,
      owner: t.owner,
      patch: { snoozedUntil: 3000, settledAt: null },
    });
    expect(snoozed.threads.get(t.threadId)?.turns).toBe(t.turns);
    const restored = agentThreadsReducer(snoozed, {
      kind: "threadOrganizationUpdated",
      threadId: t.threadId,
      owner: t.owner,
      patch: { snoozedUntil: null, settledAt: null },
    });
    expect(restored.threads.get(t.threadId)?.snoozedUntil).toBeNull();
  });
  it("renumbers only exact owner and section and does not lose precision on repeated moves", () => {
    const a = thread(),
      b = thread("agt-t2-0002"),
      c = { ...thread("agt-t3-0003"), settledAt: 2000 };
    const foreign = { ...thread("agt-t4-0004"), owner: { ...a.owner, ownerId: "other" } };
    let current = state(a, b, c, foreign);
    for (let i = 0; i < 200; i++)
      current = agentThreadsReducer(current, {
        kind: "threadReordered",
        threadId: a.threadId,
        owner: a.owner,
        targetThreadId: b.threadId,
        placement: i % 2 === 0 ? "before" : "after",
        now: 3000,
      });
    expect(
      [...current.threads.values()]
        .filter((t) => t.threadId === a.threadId || t.threadId === b.threadId)
        .sort(compareAgentThreadOrder)
        .map((t) => t.threadId),
    ).toEqual([b.threadId, a.threadId]);
    expect(current.threads.get(c.threadId)).toBe(c);
    expect(current.threads.get(foreign.threadId)).toBe(foreign);
    expect(
      agentThreadReorderPlan([a, b, c, foreign], a.threadId, c.threadId, "before", 3000),
    ).toEqual([]);
    expect(
      agentThreadReorderPlan([a, b, c, foreign], a.threadId, foreign.threadId, "before", 3000),
    ).toEqual([]);
  });
});

const newTurn: AgentTurn = {
  turnId: "agt-1-0a1b",
  prompt: "continue",
  status: { kind: "pending" },
  startedAtEpochMs: 4000,
  endedAtEpochMs: null,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 0,
  lastOutputSequence: 0,
  streamMetrics: null,
  launch: null,
  cliVersion: null,
};

describe("organization on new activity", () => {
  it.each([{ snoozedUntil: 5000 }, { settledAt: 3000 }])(
    "wakes a thread on a newly accepted turn: %s",
    (organization) => {
      const t = { ...thread(), ...organization, sortOrder: 3 };
      const result = agentThreadsReducer(state(t), {
        kind: "turnStarted",
        threadId: t.threadId,
        turn: newTurn,
      });
      expect(result.threads.get(t.threadId)?.snoozedUntil ?? null).toBeNull();
      expect(result.threads.get(t.threadId)?.settledAt ?? null).toBeNull();
      expect(result.threads.get(t.threadId)?.sortOrder).toBe(3);
      expect(result.threads.get(t.threadId)?.turns).toHaveLength(1);
      const archived = state({ ...t, archived: true });
      expect(
        agentThreadsReducer(archived, { kind: "turnStarted", threadId: t.threadId, turn: newTurn }),
      ).toBe(archived);
    },
  );
  it.each([{ snoozedUntil: 5000 }, { settledAt: 3000 }])(
    "preserves organization when opening or restoring history: %s",
    (organization) => {
      const t = {
        ...thread(),
        ...organization,
        turns: [
          { ...newTurn, status: { kind: "exited", exitCode: 0 } as const, endedAtEpochMs: 4500 },
        ],
      };
      const opened = agentThreadsReducer(state(), {
        kind: "historyThreadOpened",
        thread: t,
        evictThreadId: null,
      });
      const loaded = agentThreadsReducer(state(), { kind: "loaded", owner: t.owner, threads: [t] });
      for (const restored of [opened, loaded]) {
        expect(restored.threads.get(t.threadId)?.snoozedUntil).toBe(t.snoozedUntil);
        expect(restored.threads.get(t.threadId)?.settledAt).toBe(t.settledAt);
      }
    },
  );
});
