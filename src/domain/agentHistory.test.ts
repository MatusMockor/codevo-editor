import { describe, expect, it } from "vitest";
import { parseAgentHistoryTurnPage } from "./agentHistory";
import { serializeAgentHistoryThread } from "./agentThreadWire";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
const turns = serializeAgentHistoryThread(logThread({ turns: [logTurn()] })).turns;
const HALT_WIRE = {
  turnId: logTurn().turnId,
  source: "composerEscape",
  mode: "softInterrupt",
  requestedAtEpochMs: 1_000,
};
describe("agent history page wire", () => {
  it("parses bounded pages and their stable first-turn cursor", () => {
    expect(
      parseAgentHistoryTurnPage({
        turns,
        revision: 1,
        hasEarlier: true,
        beforeTurnId: logTurn().turnId,
        haltRequests: [],
      }).turns,
    ).toHaveLength(1);
    expect(
      parseAgentHistoryTurnPage({
        turns: [],
        revision: 1,
        hasEarlier: false,
        beforeTurnId: null,
        haltRequests: [],
      }).turns,
    ).toEqual([]);
  });
  it.each([
    { turns, revision: 1, hasEarlier: true, beforeTurnId: "different", haltRequests: [] },
    { turns: [], revision: 1, hasEarlier: true, beforeTurnId: null, haltRequests: [] },
    {
      turns,
      revision: 1,
      hasEarlier: false,
      beforeTurnId: logTurn().turnId,
      haltRequests: [],
      extra: true,
    },
    {
      turns: Array.from({ length: 65 }, () => (turns as unknown[])[0]),
      revision: 1,
      hasEarlier: true,
      beforeTurnId: logTurn().turnId,
      haltRequests: [],
    },
    { turns, revision: 1, hasEarlier: false, beforeTurnId: logTurn().turnId },
    { turns, revision: 1, hasEarlier: false, beforeTurnId: logTurn().turnId, haltRequests: null },
    {
      turns,
      revision: 1,
      hasEarlier: false,
      beforeTurnId: logTurn().turnId,
      haltRequests: [HALT_WIRE, HALT_WIRE],
    },
  ])("rejects malformed cursor and oversized pages", (page) => {
    expect(() => parseAgentHistoryTurnPage(page)).toThrow();
  });
  it("attaches a stored halt request to its turn and drops an unknown one", () => {
    const page = { turns, revision: 1, hasEarlier: false, beforeTurnId: logTurn().turnId };

    const attached = parseAgentHistoryTurnPage({ ...page, haltRequests: [HALT_WIRE] });
    const unknown = parseAgentHistoryTurnPage({
      ...page,
      haltRequests: [{ ...HALT_WIRE, source: "triggerFromANewerBuild" }],
    });

    expect(attached.turns[0]?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "softInterrupt",
      requestedAtEpochMs: 1_000,
    });
    expect(unknown.turns).toHaveLength(1);
    expect(unknown.turns[0]?.haltRequest).toBeUndefined();
  });
});
