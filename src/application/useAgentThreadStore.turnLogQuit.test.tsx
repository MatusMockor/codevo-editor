// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  LOG_OWNER_ID,
  LOG_ROOT_KEY,
  LOG_THREAD_ID,
  logThread,
  logToolEvent,
  logTurn,
  renderLogStore,
  settleLogStore,
} from "../test/agentTurnLogStoreHarness";
import { TURN_LOG_DELETE_FAILURE_NOTICE } from "./useAgentThreadStore";

const LOG_SCOPE = { rootKey: LOG_ROOT_KEY, ownerId: LOG_OWNER_ID, threadId: LOG_THREAD_ID };

function settledThread() {
  return logThread({ turns: [logTurn({ events: [logToolEvent(1)] })] });
}

describe("useAgentThreadStore thread deletion and the turn log", () => {
  it("deletes the log of a removed thread exactly once after the JSON delete", async () => {
    const harness = renderLogStore({ persisted: [settledThread()] });
    await settleLogStore();
    act(() => harness.hook().remove(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.deleted).toEqual([LOG_SCOPE]);
    expect(harness.logGateway.deletedLogs).toEqual([LOG_SCOPE]);
    expect(harness.notices).toEqual([]);
    await harness.unmount();
  });

  it("keeps the thread deleted and shows a bounded notice when the log cannot be deleted", async () => {
    const harness = renderLogStore({ persisted: [settledThread()] });
    await settleLogStore();
    harness.logGateway.deleteFails = true;
    act(() => harness.hook().remove(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.hook().currentState().threads.has(LOG_THREAD_ID)).toBe(false);
    expect(harness.deleted).toEqual([LOG_SCOPE]);
    expect(harness.logGateway.deletedLogs).toHaveLength(1);
    expect(harness.notices).toEqual([
      { kind: "warning", message: TURN_LOG_DELETE_FAILURE_NOTICE, action: null },
    ]);
    expect(harness.reportError).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  it("leaves the log alone when the JSON delete failed", async () => {
    const harness = renderLogStore({ persisted: [settledThread()] });
    await settleLogStore();
    harness.threadGateway.deleteFails = true;
    act(() => harness.hook().remove(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.deleted).toHaveLength(1);
    expect(harness.logGateway.deletedLogs).toEqual([]);
    await harness.unmount();
  });

  it("leaves the log alone when the project went away while the JSON delete was in flight", async () => {
    const harness = renderLogStore({ persisted: [settledThread()] });
    await settleLogStore();
    act(() => harness.hook().remove(LOG_THREAD_ID));
    harness.setProjects([]);
    await settleLogStore();

    expect(harness.deleted).toHaveLength(1);
    expect(harness.logGateway.deletedLogs).toEqual([]);
    await harness.unmount();
  });

  it("deletes resumed-turn logs when an imported thread is removed", async () => {
    const harness = renderLogStore({
      persisted: [
        logThread({
          externalOrigin: {
            provider: "claudeCode",
            sessionId: "987b95ad-c9bc-4d08-ae49-9b431efc8f87",
            importedAtEpochMs: 5,
          },
          turns: [logTurn()],
        }),
      ],
    });
    await settleLogStore();
    act(() => harness.hook().remove(LOG_THREAD_ID));
    await settleLogStore();

    expect(harness.deleted).toHaveLength(1);
    expect(harness.logGateway.deletedLogs).toEqual([LOG_SCOPE]);
    await harness.unmount();
  });
});

describe("useAgentThreadStore quit save", () => {
  it("saves the JSON of every running turn at once on pagehide and stops after unmount", async () => {
    const harness = renderLogStore({ persisted: [settledThread()] });
    await settleLogStore();
    const runningThreadId = "agt-4-0d1b";
    const runningTurnId = "agt-4-0d1c";
    act(() => {
      harness.hook().dispatchAction({
        kind: "threadCreated",
        thread: logThread({ threadId: runningThreadId }),
      });
      harness.hook().dispatchAction({
        kind: "turnStarted",
        threadId: runningThreadId,
        turn: logTurn({ turnId: runningTurnId, status: { kind: "running" }, endedAtEpochMs: null }),
      });
    });
    await settleLogStore();
    act(() =>
      harness.hook().dispatchAction({
        kind: "turnEventsAppended",
        threadId: runningThreadId,
        turnId: runningTurnId,
        workspaceId: LOG_OWNER_ID,
        repositoryRoot: LOG_ROOT_KEY,
        isolation: "worktree",
        worktreePath: `${LOG_ROOT_KEY}/.worktrees/one`,
        outputSequence: 3,
        events: [logToolEvent(1), logToolEvent(2)],
        sessionId: null,
        supervisorTruncated: false,
      }),
    );
    await settleLogStore();
    const savesBefore = harness.saved.length;
    expect(harness.saved[savesBefore - 1]?.thread.turns[0]?.events).toEqual([]);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settleLogStore();

    expect(harness.saved).toHaveLength(savesBefore + 1);
    const last = harness.saved[harness.saved.length - 1];
    expect(last?.thread.threadId).toBe(runningThreadId);
    expect(last?.thread.turns[0]?.events).toEqual([logToolEvent(1), logToolEvent(2)]);
    expect(harness.saved.some((save) => save.thread.threadId === LOG_THREAD_ID)).toBe(false);

    await harness.unmount();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settleLogStore();
    expect(harness.saved).toHaveLength(savesBefore + 1);
  });
});
