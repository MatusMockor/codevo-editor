import { describe, expect, it } from "vitest";
import { parseAgentHistoryTurnPage } from "./agentHistory";
import { serializeAgentHistoryThread } from "./agentThreadWire";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
const turns = serializeAgentHistoryThread(logThread({ turns: [logTurn()] })).turns;
describe("agent history page wire", () => {
  it("parses bounded pages and their stable first-turn cursor", () => {
    expect(
      parseAgentHistoryTurnPage({
        turns,
        revision: 1,
        hasEarlier: true,
        beforeTurnId: logTurn().turnId,
      }).turns,
    ).toHaveLength(1);
    expect(
      parseAgentHistoryTurnPage({ turns: [], revision: 1, hasEarlier: false, beforeTurnId: null })
        .turns,
    ).toEqual([]);
  });
  it.each([
    { turns, revision: 1, hasEarlier: true, beforeTurnId: "different" },
    { turns: [], revision: 1, hasEarlier: true, beforeTurnId: null },
    { turns, revision: 1, hasEarlier: false, beforeTurnId: logTurn().turnId, extra: true },
    {
      turns: Array.from({ length: 65 }, () => (turns as unknown[])[0]),
      revision: 1,
      hasEarlier: true,
      beforeTurnId: logTurn().turnId,
    },
  ])("rejects malformed cursor and oversized pages", (page) => {
    expect(() => parseAgentHistoryTurnPage(page)).toThrow();
  });
});
