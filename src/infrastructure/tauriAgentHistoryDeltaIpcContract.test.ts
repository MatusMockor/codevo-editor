import { describe, expect, it, vi } from "vitest";
import wire from "../../contracts/agent-history-delta-save-wire.json";
import { planAgentHistoryTurnDelta } from "../domain/agentHistoryTurnDelta";
import type { AgentTurnEvent } from "../domain/agentThread";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import {
  AGENT_HISTORY_DELTA_REFUSAL_REASONS,
  SAVE_AGENT_HISTORY_TURN_DELTA_IPC_COMMAND,
  parseAgentHistoryTurnDeltaOutcome,
  prepareAgentHistoryTurnDelta,
  savePreparedAgentHistoryTurnDelta,
} from "./tauriAgentHistoryDeltaIpcContract";
import {
  prepareAgentHistoryThreadWrite,
  savePreparedAgentHistoryThread,
} from "./tauriAgentHistoryIpcContract";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";

const kept: AgentTurnEvent = { kind: "assistantText", text: "kept" };
const appended: AgentTurnEvent = {
  kind: "toolCall",
  toolId: "tool-1",
  name: "Bash",
  inputSummary: "ls",
};

function contractRequest() {
  const turn = logTurn({
    status: { kind: "running" },
    endedAtEpochMs: null,
    events: [kept, appended],
  });
  const thread = logThread({ turns: [turn] });
  const plan = planAgentHistoryTurnDelta([kept], turn.events)!;
  return prepareAgentHistoryTurnDelta(
    { rootKey: thread.owner.rootKey, ownerId: thread.owner.ownerId },
    thread,
    turn,
    plan,
    wire.validRequest.delta.baseEventsDigest,
    wire.validRequest.expectedRevision,
  );
}

describe("agent history delta wire contract", () => {
  it("builds exactly the request shape the Rust command accepts", () => {
    expect(SAVE_AGENT_HISTORY_TURN_DELTA_IPC_COMMAND).toBe(wire.command);
    const request = contractRequest();
    expect(JSON.parse(JSON.stringify(request))).toEqual(wire.validRequest);
    expect(Object.keys(request).sort()).toEqual([...wire.requestFields].sort());
    expect(Object.keys(request.delta).sort()).toEqual([...wire.deltaFields].sort());
  });

  it("shares the closed refusal reasons and outcome shapes", () => {
    expect([...AGENT_HISTORY_DELTA_REFUSAL_REASONS]).toEqual(wire.refusalReasons);
    expect(parseAgentHistoryTurnDeltaOutcome(wire.outcomes[0], 3)).toEqual({
      revision: 4,
      eventsDigest: wire.validRequest.delta.baseEventsDigest,
    });
    expect(parseAgentHistoryTurnDeltaOutcome(wire.outcomes[1], 3)).toBeNull();
    for (const reason of wire.refusalReasons) {
      expect(parseAgentHistoryTurnDeltaOutcome({ kind: "needsFullSave", reason }, 3)).toBeNull();
    }
    for (const invalid of wire.invalidOutcomes) {
      expect(() => parseAgentHistoryTurnDeltaOutcome(invalid, 3)).toThrow(TypeError);
    }
  });

  it("refuses a saved receipt that skips or repeats a revision", () => {
    const eventsDigest = wire.validRequest.delta.baseEventsDigest;
    expect(() =>
      parseAgentHistoryTurnDeltaOutcome({ kind: "saved", revision: 5, eventsDigest }, 3),
    ).toThrow("Invalid agent history save revision.");
    expect(() =>
      parseAgentHistoryTurnDeltaOutcome({ kind: "saved", revision: 3, eventsDigest }, 3),
    ).toThrow("Invalid agent history save revision.");
  });

  it("invokes the delta command with the prepared request only", async () => {
    const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(wire.outcomes[0]);
    const request = contractRequest();
    await expect(savePreparedAgentHistoryTurnDelta(invoke, request)).resolves.toEqual({
      revision: 4,
      eventsDigest: wire.validRequest.delta.baseEventsDigest,
    });
    expect(invoke).toHaveBeenCalledWith(wire.command, { request });
  });

  it("rejects a foreign owner before building a request", () => {
    const turn = logTurn({ events: [kept, appended] });
    const thread = logThread({ turns: [turn] });
    const plan = planAgentHistoryTurnDelta([kept], turn.events)!;
    expect(() =>
      prepareAgentHistoryTurnDelta(
        { rootKey: "/workspace/other", ownerId: thread.owner.ownerId },
        thread,
        turn,
        plan,
        wire.validRequest.delta.baseEventsDigest,
        3,
      ),
    ).toThrow();
  });

  it("parses the full-save receipt digest the Rust store returns", async () => {
    const thread = logThread({ turns: [logTurn({ events: [kept] })] });
    const write = prepareAgentHistoryThreadWrite(
      { rootKey: thread.owner.rootKey, ownerId: thread.owner.ownerId },
      thread,
      3,
    );
    const invoke = vi.fn<InvokeAgentThreadStoreCommand>().mockResolvedValue(wire.fullSaveReceipt);
    await expect(savePreparedAgentHistoryThread(invoke, write)).resolves.toEqual({
      revision: 4,
      eventsDigest: wire.fullSaveReceipt.eventsDigest,
    });
    invoke.mockResolvedValue({ revision: 4, eventsDigest: "ABC" });
    await expect(savePreparedAgentHistoryThread(invoke, write)).rejects.toThrow(TypeError);
    invoke.mockResolvedValue({ revision: 4, eventsDigest: null, extra: 1 });
    await expect(savePreparedAgentHistoryThread(invoke, write)).rejects.toThrow(TypeError);
  });

  it("refuses a malformed base digest before building a request", () => {
    const turn = logTurn({ events: [kept, appended] });
    const thread = logThread({ turns: [turn] });
    const plan = planAgentHistoryTurnDelta([kept], turn.events)!;
    expect(() =>
      prepareAgentHistoryTurnDelta(
        { rootKey: thread.owner.rootKey, ownerId: thread.owner.ownerId },
        thread,
        turn,
        plan,
        "not-a-digest",
        3,
      ),
    ).toThrow("Invalid agent history events digest.");
  });
});
