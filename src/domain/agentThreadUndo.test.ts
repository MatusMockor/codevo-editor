import { describe, expect, it } from "vitest";
import {
  AGENT_THREAD_UNDO_LIMIT,
  agentThreadSectionUndoAction,
  agentThreadUndoEntry,
  agentThreadUndoFailureMessage,
  agentThreadUndoItemApplied,
  agentThreadUndoMessage,
  agentThreadUndoObservation,
  agentThreadUndoOfferValid,
  agentThreadUndoReduce,
  agentThreadUndoUnrestoredIds,
  idleAgentThreadUndoState,
  sameAgentThreadUndoIdentity,
  type AgentThreadUndoAction,
  type AgentThreadUndoEntry,
  type AgentThreadUndoIdentity,
  type AgentThreadUndoLookup,
  type AgentThreadUndoPlacement,
  type AgentThreadUndoState,
  type AgentThreadUndoSubject,
} from "./agentThreadUndo";

const ACTIVE: AgentThreadUndoPlacement = {
  pinned: false,
  archived: false,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: 3,
};

function identity(threadId: string): AgentThreadUndoIdentity {
  return {
    threadId,
    rootKey: "/workspace/app",
    ownerId: "owner-a",
    repositoryRoot: "/workspace/app",
    execution: { kind: "local" },
  };
}

function subject(
  threadId: string,
  placement: Partial<AgentThreadUndoPlacement> = {},
): AgentThreadUndoSubject {
  return { identity: identity(threadId), placement: { ...ACTIVE, ...placement } };
}

function lookupOf(subjects: ReadonlyArray<AgentThreadUndoSubject>): AgentThreadUndoLookup {
  return (threadId) =>
    subjects.find((candidate) => candidate.identity.threadId === threadId) ?? null;
}

function entryFor(
  action: AgentThreadUndoAction,
  subjects: ReadonlyArray<AgentThreadUndoSubject>,
  selectedThreadId: string | null = null,
): AgentThreadUndoEntry | null {
  return agentThreadUndoEntry({ id: 1, generation: 4, action, subjects, selectedThreadId });
}

function required(entry: AgentThreadUndoEntry | null): AgentThreadUndoEntry {
  expect(entry).not.toBeNull();
  return entry as AgentThreadUndoEntry;
}

const IDLE = idleAgentThreadUndoState("/workspace/a");

function atGeneration(generation: number): AgentThreadUndoState {
  return { ...IDLE, generation };
}

function offered(entry: AgentThreadUndoEntry, applied: ReadonlyArray<AgentThreadUndoPlacement>) {
  const awaiting = agentThreadUndoReduce(atGeneration(entry.generation), {
    kind: "recorded",
    entry,
  });
  return agentThreadUndoReduce(awaiting, { kind: "landed", id: entry.id, applied });
}

describe("agentThreadUndoEntry", () => {
  it("captures the pinned placement that an unpin overwrote", () => {
    const pinned = subject("a", { pinned: true, sortOrder: 7 });
    const entry = required(entryFor({ kind: "unpin" }, [pinned]));
    expect(entry.items).toEqual([{ before: pinned, inverse: { kind: "pin", threadId: "a" } }]);
    expect(entry.generation).toBe(4);
    expect(entry.reselectThreadId).toBeNull();
  });

  it("captures the snooze wake time that a settle cleared", () => {
    const snoozed = subject("a", { snoozedUntil: 9_000 });
    const entry = required(entryFor({ kind: "settle" }, [snoozed]));
    expect(entry.items[0]?.inverse).toEqual({
      kind: "unsettle",
      threadId: "a",
      snoozedUntil: 9_000,
    });
  });

  it("captures the prior wake time and settled time that a snooze overwrote", () => {
    const settled = subject("a", { settledAt: 500 });
    const entry = required(entryFor({ kind: "snooze", until: 9_000 }, [settled]));
    expect(entry.items[0]?.inverse).toEqual({
      kind: "unsnooze",
      threadId: "a",
      snoozedUntil: null,
      settledAt: 500,
    });
  });

  it("reselects only an archived thread that was being viewed", () => {
    const subjects = [subject("a"), subject("b")];
    expect(required(entryFor({ kind: "archive" }, subjects, "b")).reselectThreadId).toBe("b");
    expect(required(entryFor({ kind: "archive" }, subjects, "c")).reselectThreadId).toBeNull();
    expect(required(entryFor({ kind: "settle" }, subjects, "b")).reselectThreadId).toBeNull();
  });

  it.each<readonly [string, AgentThreadUndoAction, Partial<AgentThreadUndoPlacement>]>([
    ["pinning an unpinned thread", { kind: "unpin" }, { pinned: false }],
    ["settling a settled thread", { kind: "settle" }, { settledAt: 100 }],
    ["snoozing to the same wake time", { kind: "snooze", until: 9_000 }, { snoozedUntil: 9_000 }],
    ["archiving an archived thread", { kind: "archive" }, { archived: true }],
  ])("offers nothing for %s", (_label, action, placement) => {
    expect(entryFor(action, [subject("a", placement)])).toBeNull();
  });

  it("drops ineligible and duplicate threads from a bulk entry", () => {
    const entry = required(
      entryFor({ kind: "archive" }, [
        subject("a"),
        subject("a"),
        subject("b", { archived: true }),
        subject("c"),
      ]),
    );
    expect(entry.items.map((item) => item.before.identity.threadId)).toEqual(["a", "c"]);
  });

  it("refuses an entry beyond the bulk limit instead of truncating it", () => {
    const subjects = Array.from({ length: AGENT_THREAD_UNDO_LIMIT + 1 }, (_unused, index) =>
      subject(`t-${index}`),
    );
    expect(entryFor({ kind: "archive" }, subjects)).toBeNull();
    expect(entryFor({ kind: "archive" }, subjects.slice(1))?.items).toHaveLength(
      AGENT_THREAD_UNDO_LIMIT,
    );
  });
});

describe("agentThreadSectionUndoAction", () => {
  it("maps a single unpin or settle move and nothing else", () => {
    expect(agentThreadSectionUndoAction(["togglePin"])).toEqual({ kind: "unpin" });
    expect(agentThreadSectionUndoAction(["settle"])).toEqual({ kind: "settle" });
    expect(agentThreadSectionUndoAction(["togglePin", "settle"])).toBeNull();
    expect(agentThreadSectionUndoAction(["restore"])).toBeNull();
    expect(agentThreadSectionUndoAction(["unsnooze"])).toBeNull();
    expect(agentThreadSectionUndoAction([])).toBeNull();
  });
});

describe("agentThreadUndoObservation", () => {
  const before = subject("a", { pinned: true, sortOrder: 2 });
  const entry = required(entryFor({ kind: "unpin" }, [before]));

  it("waits while the thread still holds its prior placement", () => {
    expect(agentThreadUndoObservation(entry, lookupOf([before]))).toEqual({ kind: "pending" });
  });

  it("lands with the observed placement once only the acted field changed", () => {
    const after = subject("a", { pinned: false, sortOrder: 2 });
    expect(agentThreadUndoObservation(entry, lookupOf([after]))).toEqual({
      kind: "landed",
      applied: [after.placement],
    });
  });

  it("diverges when another field changed, the thread vanished, or its owner changed", () => {
    const reordered = subject("a", { pinned: false, sortOrder: 5 });
    const foreign: AgentThreadUndoSubject = {
      identity: { ...identity("a"), ownerId: "owner-b" },
      placement: { ...before.placement, pinned: false },
    };
    expect(agentThreadUndoObservation(entry, lookupOf([reordered]))).toEqual({ kind: "diverged" });
    expect(agentThreadUndoObservation(entry, lookupOf([]))).toEqual({ kind: "diverged" });
    expect(agentThreadUndoObservation(entry, lookupOf([foreign]))).toEqual({ kind: "diverged" });
  });

  it("accepts any settled time but requires the snooze to be cleared", () => {
    const settle = required(entryFor({ kind: "settle" }, [subject("a", { snoozedUntil: 50 })]));
    const settled = subject("a", { settledAt: 777 });
    const stillSnoozed = subject("a", { settledAt: 777, snoozedUntil: 50 });
    expect(agentThreadUndoObservation(settle, lookupOf([settled])).kind).toBe("landed");
    expect(agentThreadUndoObservation(settle, lookupOf([stillSnoozed])).kind).toBe("diverged");
  });

  it("requires the exact requested wake time for a snooze", () => {
    const snooze = required(entryFor({ kind: "snooze", until: 9_000 }, [subject("a")]));
    const exact = subject("a", { snoozedUntil: 9_000 });
    const other = subject("a", { snoozedUntil: 9_001 });
    expect(agentThreadUndoObservation(snooze, lookupOf([exact])).kind).toBe("landed");
    expect(agentThreadUndoObservation(snooze, lookupOf([other])).kind).toBe("diverged");
  });

  it("keeps a bulk entry pending until every thread landed", () => {
    const bulk = required(entryFor({ kind: "archive" }, [subject("a"), subject("b")]));
    const partial = lookupOf([subject("a", { archived: true }), subject("b")]);
    const complete = lookupOf([subject("a", { archived: true }), subject("b", { archived: true })]);
    expect(agentThreadUndoObservation(bulk, partial)).toEqual({ kind: "pending" });
    expect(agentThreadUndoObservation(bulk, complete).kind).toBe("landed");
  });
});

describe("offer validity and restoration", () => {
  const before = subject("a");
  const entry = required(entryFor({ kind: "archive" }, [before]));
  const applied = [{ ...before.placement, archived: true }];
  const offer = { entry, applied };

  it("stays valid only while the thread holds the exact applied placement", () => {
    const archived = subject("a", { archived: true });
    const repinned = subject("a", { archived: true, pinned: true });
    expect(agentThreadUndoOfferValid(offer, lookupOf([archived]))).toBe(true);
    expect(agentThreadUndoItemApplied(offer, 0, lookupOf([archived]))).toBe(true);
    expect(agentThreadUndoOfferValid(offer, lookupOf([repinned]))).toBe(false);
    expect(agentThreadUndoOfferValid(offer, lookupOf([]))).toBe(false);
    expect(agentThreadUndoItemApplied(offer, 1, lookupOf([archived]))).toBe(false);
    expect(agentThreadUndoOfferValid({ entry, applied: [] }, lookupOf([archived]))).toBe(false);
  });

  it("lists threads that do not hold their prior placement as unrestored", () => {
    expect(agentThreadUndoUnrestoredIds(entry, lookupOf([before]))).toEqual([]);
    expect(
      agentThreadUndoUnrestoredIds(entry, lookupOf([subject("a", { archived: true })])),
    ).toEqual(["a"]);
    expect(agentThreadUndoUnrestoredIds(entry, lookupOf([]))).toEqual(["a"]);
  });
});

describe("sameAgentThreadUndoIdentity", () => {
  it("separates local from remote execution and remote conversations from each other", () => {
    const local = identity("a");
    const execution = {
      kind: "remote",
      serverId: "s",
      runnerId: "r",
      projectId: "p",
      conversationId: "c",
    } as const;
    const remote: AgentThreadUndoIdentity = { ...local, execution };
    const otherConversation: AgentThreadUndoIdentity = {
      ...local,
      execution: { ...execution, conversationId: "d" },
    };
    expect(sameAgentThreadUndoIdentity(local, { ...local })).toBe(true);
    expect(sameAgentThreadUndoIdentity(local, remote)).toBe(false);
    expect(sameAgentThreadUndoIdentity(remote, { ...remote })).toBe(true);
    expect(sameAgentThreadUndoIdentity(remote, otherConversation)).toBe(false);
    expect(sameAgentThreadUndoIdentity(local, { ...local, repositoryRoot: "/other" })).toBe(false);
  });
});

describe("agentThreadUndoReduce", () => {
  const first = required(entryFor({ kind: "archive" }, [subject("a")]));
  const second: AgentThreadUndoEntry = { ...first, id: 2 };
  const applied = [{ ...ACTIVE, archived: true }];
  const start = atGeneration(first.generation);

  it("offers an entry only after its forward action landed", () => {
    const awaiting = agentThreadUndoReduce(start, { kind: "recorded", entry: first });
    expect(awaiting.awaiting).toBe(first);
    expect(awaiting.offered).toBeNull();
    const landed = offered(first, applied);
    expect(landed.awaiting).toBeNull();
    expect(landed.offered).toEqual({ entry: first, applied });
  });

  it("keeps the live offer while a newer action is still unconfirmed", () => {
    const state = agentThreadUndoReduce(offered(first, applied), {
      kind: "recorded",
      entry: second,
    });
    expect(state.offered).toEqual({ entry: first, applied });
    expect(state.awaiting).toBe(second);
  });

  it("keeps the live offer when the newer action is refused or diverges", () => {
    const state = agentThreadUndoReduce(offered(first, applied), {
      kind: "recorded",
      entry: second,
    });
    const refused = agentThreadUndoReduce(state, { kind: "dropped", id: second.id });
    expect(refused.awaiting).toBeNull();
    expect(refused.offered).toEqual({ entry: first, applied });
    const incomplete = agentThreadUndoReduce(state, { kind: "landed", id: second.id, applied: [] });
    expect(incomplete.awaiting).toBeNull();
    expect(incomplete.offered).toEqual({ entry: first, applied });
  });

  it("replaces the live offer once the newer action landed", () => {
    const state = agentThreadUndoReduce(offered(first, applied), {
      kind: "recorded",
      entry: second,
    });
    const landed = agentThreadUndoReduce(state, { kind: "landed", id: second.id, applied });
    expect(landed.awaiting).toBeNull();
    expect(landed.offered).toEqual({ entry: second, applied });
    expect(agentThreadUndoReduce(landed, { kind: "undone", id: first.id })).toBe(landed);
    expect(agentThreadUndoReduce(landed, { kind: "landed", id: first.id, applied })).toBe(landed);
    expect(agentThreadUndoReduce(landed, { kind: "dropped", id: first.id })).toBe(landed);
  });

  it("replaces only an older unconfirmed action when another is recorded", () => {
    const awaiting = agentThreadUndoReduce(start, { kind: "recorded", entry: first });
    const replaced = agentThreadUndoReduce(awaiting, { kind: "recorded", entry: second });
    expect(replaced.awaiting).toBe(second);
    expect(agentThreadUndoReduce(replaced, { kind: "landed", id: first.id, applied })).toBe(
      replaced,
    );
  });

  it("consumes an offer exactly once", () => {
    const state = offered(first, applied);
    const restoring = agentThreadUndoReduce(state, { kind: "undone", id: first.id });
    expect(restoring.offered).toBeNull();
    expect(restoring.restoring).toEqual({ entry: first, applied });
    expect(agentThreadUndoReduce(restoring, { kind: "undone", id: first.id })).toBe(restoring);
    const settled = agentThreadUndoReduce(restoring, { kind: "restored", id: first.id });
    expect(settled).toEqual(start);
    expect(agentThreadUndoReduce(settled, { kind: "restored", id: first.id })).toBe(settled);
  });

  it("refuses a second undo while a restore is still in flight", () => {
    const restoring = agentThreadUndoReduce(offered(first, applied), {
      kind: "undone",
      id: first.id,
    });
    const recorded = agentThreadUndoReduce(restoring, { kind: "recorded", entry: second });
    const next = agentThreadUndoReduce(recorded, { kind: "landed", id: second.id, applied });
    expect(next.offered).toEqual({ entry: second, applied });
    expect(agentThreadUndoReduce(next, { kind: "undone", id: second.id })).toBe(next);
    const free = agentThreadUndoReduce(next, { kind: "restored", id: first.id });
    const undone = agentThreadUndoReduce(free, { kind: "undone", id: second.id });
    expect(undone.offered).toBeNull();
    expect(undone.restoring).toEqual({ entry: second, applied });
  });

  it("cannot undo an entry that has not landed", () => {
    const awaiting = agentThreadUndoReduce(start, { kind: "recorded", entry: first });
    expect(agentThreadUndoReduce(awaiting, { kind: "undone", id: first.id })).toBe(awaiting);
  });

  it("refuses an entry recorded under another owner generation", () => {
    expect(agentThreadUndoReduce(IDLE, { kind: "recorded", entry: first })).toBe(IDLE);
  });

  it("drops an entry whose landing does not cover every thread", () => {
    const awaiting = agentThreadUndoReduce(start, { kind: "recorded", entry: first });
    expect(agentThreadUndoReduce(awaiting, { kind: "landed", id: first.id, applied: [] })).toEqual(
      start,
    );
  });

  it("clears every slot and advances the generation when the owner changes, including A to B to A", () => {
    const restoring = agentThreadUndoReduce(offered(first, applied), {
      kind: "undone",
      id: first.id,
    });
    const busy = agentThreadUndoReduce(restoring, { kind: "recorded", entry: second });
    expect(agentThreadUndoReduce(busy, { kind: "ownerChanged", ownerKey: "/workspace/a" })).toBe(
      busy,
    );
    const moved = agentThreadUndoReduce(busy, { kind: "ownerChanged", ownerKey: "/workspace/b" });
    expect(moved).toEqual({
      ownerKey: "/workspace/b",
      generation: first.generation + 1,
      awaiting: null,
      offered: null,
      restoring: null,
    });
    const back = agentThreadUndoReduce(moved, { kind: "ownerChanged", ownerKey: "/workspace/a" });
    expect(back.generation).toBe(first.generation + 2);
    expect(agentThreadUndoReduce(back, { kind: "recorded", entry: first })).toBe(back);
  });
});

describe("copy", () => {
  it("names the action in singular and plural form", () => {
    expect(agentThreadUndoMessage("archive", 1)).toBe("Thread archived");
    expect(agentThreadUndoMessage("settle", 1)).toBe("Thread settled");
    expect(agentThreadUndoMessage("snooze", 1)).toBe("Thread snoozed");
    expect(agentThreadUndoMessage("unpin", 1)).toBe("Thread unpinned");
    expect(agentThreadUndoMessage("archive", 3)).toBe("3 threads archived");
  });

  it("reports a failed undo without claiming a restore", () => {
    expect(agentThreadUndoFailureMessage(1, 1)).toBe("Undo failed. The thread was not restored.");
    expect(agentThreadUndoFailureMessage(2, 3)).toBe(
      "Undo failed. 2 of 3 threads were not restored.",
    );
  });
});
