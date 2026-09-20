import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import { serializeAgentHistoryThread } from "../domain/agentThreadWire";
import { logThread, logTurn } from "../test/agentTurnLogStoreHarness";
import { findAgentHistoryImport, readAgentHistoryTurns } from "./tauriAgentHistoryIpcContract";

describe("agent history IPC ownership", () => {
  const thread = logThread();
  const owner = { rootKey: thread.owner.rootKey, ownerId: agentRootOwnerId(thread.owner.rootKey) };
  it("uses the stable before-turn cursor and rejects unknown request cursors", async () => {
    const turn = logTurn();
    const turns = serializeAgentHistoryThread({ ...thread, turns: [turn] }).turns;
    const invoke = vi
      .fn()
      .mockResolvedValue({ turns, hasEarlier: false, beforeTurnId: turn.turnId, revision: 1 });
    expect(
      (
        await readAgentHistoryTurns(invoke, {
          ...owner,
          threadId: thread.threadId,
          beforeTurnId: "newer",
        })
      ).turns,
    ).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("read_agent_history_turns", {
      request: { ...owner, threadId: thread.threadId, beforeTurnId: "newer" },
    });
    await expect(
      readAgentHistoryTurns(invoke, {
        ...owner,
        threadId: thread.threadId,
        beforeTurnId: "../foreign",
      }),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("requires the imported provider/session/root to match the lookup", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000000";
    const request = {
      ...owner,
      provider: "codex" as const,
      sessionId,
      repositoryRoot: thread.owner.repositoryRoot,
    };
    const imported = {
      ...thread,
      provider: { kind: "codex" as const, sessionId },
      owner: { ...thread.owner, ownerId: owner.ownerId },
      externalOrigin: { provider: "codex" as const, sessionId, importedAtEpochMs: 1 },
    };
    const invoke = vi
      .fn()
      .mockResolvedValue({ thread: serializeAgentHistoryThread(imported), revision: 1 });
    expect((await findAgentHistoryImport(invoke, request))?.threadId).toBe(thread.threadId);
    await expect(
      findAgentHistoryImport(invoke, {
        ...request,
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow("Foreign");
    invoke.mockResolvedValue(null);
    expect(await findAgentHistoryImport(invoke, request)).toBeNull();
  });
});
