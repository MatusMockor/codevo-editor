import { describe, expect, it } from "vitest";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import { agentImportedHighlights, agentImportedTurns } from "./agentImportedPresentation";

function user(text: string): ExternalSessionExchange {
  return { role: "user", text };
}

function assistant(text: string): ExternalSessionExchange {
  return { role: "assistant", text };
}

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
    expect(turns[0]?.prompt).toEqual({ attachments: [], exchangeIndex: 0, text: "first" });
    expect(turns[0]?.responses.map((response) => response.text)).toEqual(["alpha", "beta"]);
    expect(turns[1]?.prompt).toEqual({ attachments: [], exchangeIndex: 3, text: "second" });
    expect(turns[1]?.responses.map((response) => response.exchangeIndex)).toEqual([4]);
    expect(turns.map((entry) => entry.headExchangeIndex)).toEqual([0, 3]);
  });

  it("keeps a leading answer that has no prompt of its own", () => {
    const turns = agentImportedTurns([assistant("orphan"), user("first"), assistant("alpha")]);

    expect(turns.map((entry) => entry.prompt?.text ?? null)).toEqual([null, "first"]);
    expect(turns[0]?.responses.map((response) => response.text)).toEqual(["orphan"]);
    expect(turns.map((entry) => entry.headExchangeIndex)).toEqual([0, 1]);
  });

  it("gives consecutive prompts a turn each", () => {
    const turns = agentImportedTurns([user("first"), user("second"), assistant("alpha")]);

    expect(turns.map((entry) => entry.prompt?.text ?? null)).toEqual(["first", "second"]);
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
