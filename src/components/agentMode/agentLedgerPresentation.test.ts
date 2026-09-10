import { describe, expect, it } from "vitest";
import type { AgentThread, AgentTurn } from "../../domain/agentThread";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import {
  agentImportedHighlights,
  agentImportedTurns,
  agentLedgerImportedOrdinal,
  agentLedgerOrdinals,
  agentLedgerTurnOrdinal,
} from "./agentLedgerPresentation";

const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";

function user(text: string): ExternalSessionExchange {
  return { role: "user", text };
}

function assistant(text: string): ExternalSessionExchange {
  return { role: "assistant", text };
}

function turn(turnId: string): AgentTurn {
  return {
    turnId,
    prompt: "prompt",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 2_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1",
    owner: { rootKey: "/ws", ownerId: "agent-root:ws", repositoryRoot: "/ws" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [turn("t1"), turn("t2")],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    ...overrides,
  };
}

function origin(
  exchanges: ReadonlyArray<ExternalSessionExchange> | null,
  exchangesTruncated = false,
): AgentThread["externalOrigin"] {
  return {
    provider: "claudeCode",
    sessionId: SESSION_ID,
    importedAtEpochMs: 500,
    ...(exchanges === null
      ? {}
      : {
          history: {
            provider: "claudeCode",
            sessionId: SESSION_ID,
            exchanges,
            exchangesTruncated,
            totalPreviewBytes: 16,
          },
        }),
  };
}

describe("agentLedgerOrdinals", () => {
  it("numbers a native thread from one", () => {
    const ordinals = agentLedgerOrdinals(thread());

    expect(ordinals).toEqual({ kind: "shown", importedPrompts: 0 });
    expect(agentLedgerTurnOrdinal(ordinals, 0)).toBe(1);
    expect(agentLedgerTurnOrdinal(ordinals, 1)).toBe(2);
  });

  it("continues one sequence from the imported prompts into the live turns", () => {
    const ordinals = agentLedgerOrdinals(
      thread({ externalOrigin: origin([user("a"), assistant("b"), user("c"), assistant("d")]) }),
    );

    expect(ordinals).toEqual({ kind: "shown", importedPrompts: 2 });
    expect(agentLedgerImportedOrdinal(ordinals, 0)).toBe(1);
    expect(agentLedgerImportedOrdinal(ordinals, 1)).toBe(2);
    expect(agentLedgerTurnOrdinal(ordinals, 0)).toBe(3);
    expect(agentLedgerTurnOrdinal(ordinals, 1)).toBe(4);
  });

  it("hides every ordinal when the imported history is truncated", () => {
    const ordinals = agentLedgerOrdinals(
      thread({ externalOrigin: origin([user("a"), assistant("b")], true) }),
    );

    expect(ordinals).toEqual({ kind: "hidden" });
    expect(agentLedgerImportedOrdinal(ordinals, 0)).toBeNull();
    expect(agentLedgerTurnOrdinal(ordinals, 0)).toBeNull();
  });

  it("hides every ordinal when the live turns are truncated", () => {
    const ordinals = agentLedgerOrdinals(
      thread({ turnsTruncated: true, externalOrigin: origin([user("a"), assistant("b")]) }),
    );

    expect(ordinals).toEqual({ kind: "hidden" });
    expect(agentLedgerImportedOrdinal(ordinals, 0)).toBeNull();
    expect(agentLedgerTurnOrdinal(ordinals, 0)).toBeNull();
  });

  it("hides every ordinal while the imported history is still unknown", () => {
    const ordinals = agentLedgerOrdinals(thread({ externalOrigin: origin(null) }));

    expect(ordinals).toEqual({ kind: "hidden" });
    expect(agentLedgerTurnOrdinal(ordinals, 0)).toBeNull();
  });

  it("never numbers an imported prompt beyond the counted history", () => {
    const ordinals = agentLedgerOrdinals(thread({ externalOrigin: origin([user("a")]) }));

    expect(agentLedgerImportedOrdinal(ordinals, 0)).toBe(1);
    expect(agentLedgerImportedOrdinal(ordinals, 1)).toBeNull();
  });
});

describe("agentImportedTurns", () => {
  it("groups each prompt with the answers that follow it", () => {
    const turns = agentImportedTurns([
      user("first"),
      assistant("alpha"),
      assistant("beta"),
      user("second"),
      assistant("gamma"),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt).toEqual({ exchangeIndex: 0, promptIndex: 0, text: "first" });
    expect(turns[0]?.responses.map((response) => response.text)).toEqual(["alpha", "beta"]);
    expect(turns[1]?.prompt).toEqual({ exchangeIndex: 3, promptIndex: 1, text: "second" });
    expect(turns[1]?.responses.map((response) => response.exchangeIndex)).toEqual([4]);
  });

  it("keeps a leading answer that has no prompt of its own", () => {
    const turns = agentImportedTurns([assistant("orphan"), user("first"), assistant("alpha")]);

    expect(turns.map((entry) => entry.prompt?.text ?? null)).toEqual([null, "first"]);
    expect(turns[0]?.responses.map((response) => response.text)).toEqual(["orphan"]);
  });

  it("gives consecutive prompts their own turn and their own ordinal", () => {
    const turns = agentImportedTurns([user("first"), user("second"), assistant("alpha")]);

    expect(turns.map((entry) => entry.prompt?.promptIndex ?? null)).toEqual([0, 1]);
    expect(turns[0]?.responses).toEqual([]);
    expect(turns[1]?.responses.map((response) => response.text)).toEqual(["alpha"]);
  });

  it("returns nothing for an empty history", () => {
    expect(agentImportedTurns([])).toEqual([]);
  });
});

describe("agentImportedHighlights", () => {
  const hits: ReadonlyArray<AgentThreadFindHit> = [
    { scope: "imported", exchangeIndex: 1, start: 0, end: 6 },
    { scope: "imported", exchangeIndex: 1, start: 20, end: 26 },
    { scope: "turn", turnId: "t1", eventIndex: null, start: 0, end: 6 },
    { scope: "imported", exchangeIndex: 3, start: 4, end: 10 },
  ];

  it("marks every matched exchange and the occurrence that carries the cursor", () => {
    const highlights = agentImportedHighlights(hits, 1, "parser");

    expect(highlights.get(1)).toEqual({ query: "parser", current: 1 });
    expect(highlights.get(3)).toEqual({ query: "parser", current: null });
    expect(highlights.has(0)).toBe(false);
  });

  it("counts occurrences per exchange rather than across the thread", () => {
    expect(agentImportedHighlights(hits, 3, "parser").get(3)).toEqual({
      query: "parser",
      current: 0,
    });
  });

  it("ignores a cursor that sits on a live turn", () => {
    const highlights = agentImportedHighlights(hits, 2, "parser");

    expect(highlights.get(1)).toEqual({ query: "parser", current: null });
    expect(highlights.get(3)).toEqual({ query: "parser", current: null });
  });

  it("publishes nothing without a query", () => {
    expect(agentImportedHighlights(hits, 0, "").size).toBe(0);
  });
});
