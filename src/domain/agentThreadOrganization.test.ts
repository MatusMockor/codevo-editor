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
  it("moves across sections atomically, preserves history, and rejects foreign or stale destinations", () => {
    const a = thread();
    const b = { ...thread("agt-t2-0002"), pinned: true };
    const initial = state(a, b);
    const move = (
      destination: "active" | "pinned" | "settled",
      targetThreadId = b.threadId,
      base = initial,
    ) =>
      agentThreadsReducer(base, {
        kind: "threadReordered",
        threadId: a.threadId,
        owner: a.owner,
        targetThreadId,
        placement: "before",
        destination,
        now: 3000,
      });
    const pinned = move("pinned");
    expect(pinned.threads.get(a.threadId)).toMatchObject({
      pinned: true,
      sortOrder: 0,
      settledAt: null,
      snoozedUntil: null,
    });
    expect(pinned.threads.get(a.threadId)?.turns).toBe(a.turns);
    const settled = move("settled", a.threadId, pinned);
    expect(settled.threads.get(a.threadId)?.settledAt).toBe(3000);
    const active = move("active", a.threadId, settled);
    expect(active.threads.get(a.threadId)).toMatchObject({
      pinned: false,
      settledAt: null,
      snoozedUntil: null,
    });
    expect(move("settled")).toBe(initial); // target is pinned, not settled
    const foreign = state(a, { ...b, owner: { ...b.owner, ownerId: "foreign" } });
    expect(move("pinned", b.threadId, foreign)).toBe(foreign);
    const running = state({ ...a, turns: [{ ...newTurn, status: { kind: "running" } }] }, b);
    expect(move("settled", a.threadId, running)).toBe(running);
    const archived = state({ ...a, archived: true }, b);
    expect(move("pinned", b.threadId, archived)).toBe(archived);
    const snoozed = state(a, { ...b, pinned: false, snoozedUntil: 4000 });
    expect(move("active", b.threadId, snoozed)).toBe(snoozed);
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

describe("manual order with recency", () => {
  const at = (id: string, updatedAtEpochMs: number, sortOrder?: number | null): AgentThread => ({
    ...thread(id),
    updatedAtEpochMs,
    ...(sortOrder === undefined ? {} : { sortOrder }),
  });
  const ordered = (current: AgentThreadsState) =>
    [...current.threads.values()].sort(compareAgentThreadOrder).map((t) => t.threadId);
  const move = (
    current: AgentThreadsState,
    threadId: string,
    targetThreadId: string,
    placement: "before" | "after",
  ) =>
    agentThreadsReducer(current, {
      kind: "threadReordered",
      threadId,
      owner: thread().owner,
      targetThreadId,
      placement,
      now: 3000,
    });

  it("keeps new and recently active unordered threads above manually ordered ones", () => {
    const manual = state(at("agt-a", 1000, 0), at("agt-b", 9000, 1));
    const withNew = { threads: new Map(manual.threads).set("agt-new", at("agt-new", 500)) };
    const withNewer = {
      threads: new Map(withNew.threads).set("agt-newer", at("agt-newer", 700)),
    };
    expect(ordered(withNewer)).toEqual(["agt-newer", "agt-new", "agt-a", "agt-b"]);
  });

  it("writes only the moved thread when neighbours are already ordered", () => {
    const initial = state(at("agt-a", 1000, 0), at("agt-b", 1000, 1), at("agt-c", 1000, 2));
    const moved = move(initial, "agt-c", "agt-b", "before");
    expect(ordered(moved)).toEqual(["agt-a", "agt-c", "agt-b"]);
    const changed = [...moved.threads.values()].filter(
      (t) => t !== initial.threads.get(t.threadId),
    );
    expect(changed.map((t) => t.threadId)).toEqual(["agt-c"]);
  });

  it("numbers only the moved thread and the unordered threads it lands above", () => {
    const initial = state(
      at("agt-new", 9000),
      at("agt-mid", 8000),
      at("agt-a", 1000, 0),
      at("agt-b", 1000, 1),
    );
    const moved = move(initial, "agt-b", "agt-mid", "before");
    expect(ordered(moved)).toEqual(["agt-new", "agt-b", "agt-mid", "agt-a"]);
    expect(moved.threads.get("agt-new")).toBe(initial.threads.get("agt-new"));
    expect(moved.threads.get("agt-a")).toBe(initial.threads.get("agt-a"));
    const later = {
      threads: new Map(moved.threads).set("agt-later", at("agt-later", 10_000)),
    };
    expect(ordered(later)[0]).toBe("agt-later");
  });

  it("renumbers the ordered tail when no key fits between neighbours", () => {
    const initial = state(
      at("agt-a", 1000, 0),
      at("agt-b", 1000, Number.MIN_VALUE),
      at("agt-c", 1000, 1),
    );
    const moved = move(initial, "agt-c", "agt-b", "before");
    expect(ordered(moved)).toEqual(["agt-a", "agt-c", "agt-b"]);
    expect([...moved.threads.values()].every((t) => Number.isInteger(t.sortOrder))).toBe(true);
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
