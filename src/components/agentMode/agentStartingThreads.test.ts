import { describe, expect, it } from "vitest";
import { agentThreadAutoTitle } from "../../domain/agentThreadAutoTitle";
import { UNTITLED_AGENT_THREAD_TITLE } from "../../domain/agentThread";
import {
  MAX_AGENT_PENDING_SENDS,
  agentPendingSendFor,
  reduceAgentPendingSends,
  type AgentPendingSend,
  type AgentPendingSendAction,
  type AgentPendingSends,
} from "./agentPendingSend";
import {
  MAX_AGENT_STARTING_THREADS,
  NO_AGENT_STARTING_THREADS,
  agentStartingThreadKey,
  agentStartingThreadTitle,
  agentStartingThreads,
} from "./agentStartingThreads";

const DRAFT = { kind: "new", projectRootKey: "/app" } as const;
const OWNER = { ownerId: "agent-root:app", generation: 3 } as const;

function newSend(id: number, projectRootKey = "/app", prompt = `prompt ${id}`): AgentPendingSend {
  return {
    id,
    target: { kind: "new", projectRootKey, provider: "codex" },
    prompt,
    attachments: [],
    sentAtEpochMs: 1_000 + id,
    status: "sending",
    owner: OWNER,
  };
}

function followUpSend(id: number, threadId: string): AgentPendingSend {
  return {
    id,
    target: { kind: "followUp", threadId, baseTurnId: "t1" },
    prompt: `follow-up ${id}`,
    attachments: [],
    sentAtEpochMs: 1_000 + id,
    status: "sending",
  };
}

function reduce(...actions: ReadonlyArray<AgentPendingSendAction>): AgentPendingSends {
  return actions.reduce<AgentPendingSends>(reduceAgentPendingSends, []);
}

describe("agent starting threads", () => {
  it("lists a new send as a starting thread titled like the thread it becomes", () => {
    const prompt =
      "  ## Fix the **flaky** checkout test in `cart.spec.ts` before the release\n\nMore";
    const state = reduce({ kind: "begin", send: newSend(1, "/app", prompt) });

    expect(agentStartingThreads(state, 1)).toEqual([
      {
        key: agentStartingThreadKey(1),
        projectRootKey: "/app",
        owner: OWNER,
        provider: "codex",
        threadId: null,
        title: agentThreadAutoTitle(prompt.trim()),
        sentAtEpochMs: 1_001,
        current: true,
      },
    ]);
    expect(agentStartingThreadTitle(prompt)).toBe(agentThreadAutoTitle(prompt));
  });

  it("carries no owner for a send that captured none, and tells owners apart", () => {
    const unowned = { ...newSend(1), owner: undefined };
    const first = agentStartingThreads([unowned], null);
    expect(first[0]?.owner).toBeNull();

    const reowned = agentStartingThreads([{ ...newSend(1), owner: OWNER }], null, first);
    expect(reowned).not.toBe(first);
    expect(reowned[0]?.owner).toEqual(OWNER);
    expect(agentStartingThreads([{ ...newSend(1), owner: { ...OWNER } }], null, reowned)).toBe(
      reowned,
    );
    expect(
      agentStartingThreads(
        [{ ...newSend(1), owner: { ...OWNER, generation: OWNER.generation + 1 } }],
        null,
        reowned,
      ),
    ).not.toBe(reowned);
  });

  it("titles an attachment-only send like a thread without a prompt", () => {
    expect(agentStartingThreadTitle("   ")).toBe(agentThreadAutoTitle(""));
    expect(agentStartingThreadTitle("")).toBe(UNTITLED_AGENT_THREAD_TITLE);
  });

  it("marks only the send shown in the conversation as current", () => {
    const state = reduce(
      { kind: "begin", send: newSend(1, "/app") },
      { kind: "begin", send: newSend(2, "/other") },
    );

    expect(agentStartingThreads(state, 2).map((entry) => [entry.key, entry.current])).toEqual([
      [agentStartingThreadKey(1), false],
      [agentStartingThreadKey(2), true],
    ]);
    expect(agentStartingThreads(state, null).every((entry) => !entry.current)).toBe(true);
  });

  it("keeps an identified send in the list, carrying its thread id, and as the visible send", () => {
    const begun = reduce({ kind: "begin", send: newSend(1) });
    const identified = reduceAgentPendingSends(begun, {
      kind: "identified",
      id: 1,
      threadId: "agt-1",
    });

    expect(agentStartingThreads(identified, 1)).toEqual([
      expect.objectContaining({ key: agentStartingThreadKey(1), threadId: "agt-1" }),
    ]);
    expect(agentPendingSendFor(identified, DRAFT)).toEqual({
      ...newSend(1),
      identifiedThreadId: "agt-1",
    });
  });

  it("identifies only the exact sending new-thread send, once", () => {
    const state = reduce(
      { kind: "begin", send: newSend(1, "/app") },
      { kind: "begin", send: newSend(2, "/other") },
      { kind: "begin", send: followUpSend(3, "agt-9") },
    );

    const identified = reduceAgentPendingSends(state, {
      kind: "identified",
      id: 2,
      threadId: "agt-2",
    });
    expect(agentStartingThreads(identified, null).map((entry) => entry.threadId)).toEqual([
      null,
      "agt-2",
    ]);
    expect(
      reduceAgentPendingSends(identified, { kind: "identified", id: 2, threadId: "agt-other" }),
    ).toBe(identified);
    expect(reduceAgentPendingSends(state, { kind: "identified", id: 3, threadId: "agt-9" })).toBe(
      state,
    );
    expect(reduceAgentPendingSends(state, { kind: "identified", id: 99, threadId: "agt-x" })).toBe(
      state,
    );
  });

  it("ignores an identification that arrives after the send settled", () => {
    const failed = reduce(
      { kind: "begin", send: newSend(1) },
      { kind: "settle", id: 1, outcome: "failed" },
    );
    const sent = reduce(
      { kind: "begin", send: newSend(1) },
      { kind: "settle", id: 1, outcome: "sent" },
    );

    expect(reduceAgentPendingSends(failed, { kind: "identified", id: 1, threadId: "agt-1" })).toBe(
      failed,
    );
    expect(reduceAgentPendingSends(sent, { kind: "identified", id: 1, threadId: "agt-1" })).toBe(
      sent,
    );
  });

  it.each(["sent", "failed", "withdrawn"] as const)(
    "shows no starting thread once the send settles as %s",
    (outcome) => {
      const state = reduce(
        { kind: "begin", send: newSend(1) },
        { kind: "identified", id: 1, threadId: "agt-1" },
        { kind: "settle", id: 1, outcome },
      );

      expect(agentStartingThreads(state, 1)).toBe(NO_AGENT_STARTING_THREADS);
    },
  );

  it("keeps the failed send visible in the conversation without a starting thread", () => {
    const state = reduce(
      { kind: "begin", send: newSend(1) },
      { kind: "identified", id: 1, threadId: "agt-1" },
      { kind: "settle", id: 1, outcome: "failed" },
    );

    expect(agentPendingSendFor(state, DRAFT)?.status).toBe("failed");
    expect(agentStartingThreads(state, 1)).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("never lists a follow-up send", () => {
    const state = reduce({ kind: "begin", send: followUpSend(1, "agt-1") });

    expect(agentStartingThreads(state, 1)).toBe(NO_AGENT_STARTING_THREADS);
  });

  it("stays within the pending send bound", () => {
    const actions = Array.from({ length: MAX_AGENT_PENDING_SENDS + 8 }, (_, index) => ({
      kind: "begin" as const,
      send: newSend(index + 1, `/app-${index + 1}`),
    }));
    const starting = agentStartingThreads(reduce(...actions), null);

    expect(MAX_AGENT_STARTING_THREADS).toBe(MAX_AGENT_PENDING_SENDS);
    expect(starting).toHaveLength(MAX_AGENT_STARTING_THREADS);
    expect(starting[starting.length - 1]?.key).toBe(
      agentStartingThreadKey(MAX_AGENT_PENDING_SENDS + 8),
    );
    const unbounded = Array.from({ length: MAX_AGENT_STARTING_THREADS + 3 }, (_, index) =>
      newSend(index + 1, `/app-${index + 1}`),
    );
    expect(agentStartingThreads(unbounded, null)).toHaveLength(MAX_AGENT_STARTING_THREADS);
  });

  it("keeps the same list when nothing about the starting threads changed", () => {
    const begun = reduce({ kind: "begin", send: newSend(1) });
    const first = agentStartingThreads(begun, 1);
    const withFollowUp = reduceAgentPendingSends(begun, {
      kind: "begin",
      send: followUpSend(2, "agt-7"),
    });
    const followUpSettled = reduceAgentPendingSends(withFollowUp, {
      kind: "settle",
      id: 2,
      outcome: "sent",
    });

    expect(agentStartingThreads(withFollowUp, 1, first)).toBe(first);
    expect(agentStartingThreads(followUpSettled, 1, first)).toBe(first);
    expect(agentStartingThreads([], null, NO_AGENT_STARTING_THREADS)).toBe(
      NO_AGENT_STARTING_THREADS,
    );
  });

  it("replaces only the entry whose state changed", () => {
    const state = reduce(
      { kind: "begin", send: newSend(1, "/app") },
      { kind: "begin", send: newSend(2, "/other") },
    );
    const first = agentStartingThreads(state, 1);
    const next = agentStartingThreads(state, 2, first);

    expect(next).not.toBe(first);
    expect(next.map((entry) => entry.current)).toEqual([false, true]);
    const identified = reduceAgentPendingSends(state, {
      kind: "identified",
      id: 1,
      threadId: "agt-1",
    });
    const afterIdentification = agentStartingThreads(identified, 2, next);
    expect(afterIdentification[0]).not.toBe(next[0]);
    expect(afterIdentification[0]?.threadId).toBe("agt-1");
    expect(afterIdentification[1]).toBe(next[1]);
    const settled = reduceAgentPendingSends(identified, { kind: "settle", id: 1, outcome: "sent" });
    const remaining = agentStartingThreads(settled, 2, afterIdentification);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(next[1]);
  });
});
