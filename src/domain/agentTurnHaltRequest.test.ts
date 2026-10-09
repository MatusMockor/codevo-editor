import { describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnStatus,
} from "./agentThread";
import { reconcileAgentThreadLoad } from "./agentThreadLoadReconciliation";
import { serializeAgentHistoryThread, serializeAgentThread } from "./agentThreadWire";
import type { AgentTurnHaltMode, AgentTurnHaltTrigger } from "./agentTurnHaltRecord";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const THREAD_ID = "agt-1-0a1b";
const TURN_A = "agt-1-0a1c";
const TURN_B = "agt-1-0a1d";

function turn(turnId: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId,
    prompt: "sleep a minute",
    status,
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(turns: ReadonlyArray<AgentTurn>): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: OWNER,
    target: { isolation: "worktree", worktreePath: "/repo/.worktrees/agt-1-0a1b" },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Sleep",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: 30,
    externalOrigin: null,
    integration: null,
  };
}

function stateOf(value: AgentThread): AgentThreadsState {
  return { threads: new Map([[value.threadId, value]]) };
}

const ESCAPE: AgentTurnHaltTrigger = { kind: "ui", source: "composerEscape" };
const STOP_BUTTON: AgentTurnHaltTrigger = { kind: "ui", source: "composerStopButton" };

function requested(turnId: string, ownerId: string = OWNER.ownerId): AgentThreadsAction {
  return haltAction(turnId, ESCAPE, "softInterrupt", 100, ownerId);
}

function haltAction(
  turnId: string,
  trigger: AgentTurnHaltTrigger,
  mode: AgentTurnHaltMode,
  requestedAtEpochMs: number,
  ownerId: string = OWNER.ownerId,
): AgentThreadsAction {
  return {
    kind: "turnHaltRequested",
    threadId: THREAD_ID,
    ownerId,
    turnId,
    trigger,
    mode,
    requestedAtEpochMs,
  };
}

function turnOf(state: AgentThreadsState, turnId: string): AgentTurn | undefined {
  return state.threads.get(THREAD_ID)?.turns.find((candidate) => candidate.turnId === turnId);
}

describe("turnHaltRequested", () => {
  it("marks only the exact running turn and keeps the thread order", () => {
    const before = stateOf(
      thread([turn(TURN_A, { kind: "stopped" }), turn(TURN_B, { kind: "running" })]),
    );

    const after = agentThreadsReducer(before, requested(TURN_B));

    expect(turnOf(after, TURN_B)?.haltRequested).toBe(true);
    expect(turnOf(after, TURN_B)?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "softInterrupt",
      requestedAtEpochMs: 100,
    });
    expect(turnOf(after, TURN_A)?.haltRequested).toBeUndefined();
    expect(turnOf(after, TURN_A)?.haltRequest).toBeUndefined();
    expect(after.threads.get(THREAD_ID)?.updatedAtEpochMs).toBe(20);
  });

  it("keeps the first request and records one hard-stop escalation", () => {
    const before = stateOf(thread([turn(TURN_A, { kind: "running" })]));
    const interrupted = agentThreadsReducer(before, requested(TURN_A));

    const escalated = agentThreadsReducer(
      interrupted,
      haltAction(TURN_A, STOP_BUTTON, "hardStop", 250),
    );
    const again = agentThreadsReducer(
      escalated,
      haltAction(TURN_A, { kind: "ui", source: "threadMenu" }, "hardStop", 400),
    );

    expect(turnOf(escalated, TURN_A)?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "softInterrupt",
      requestedAtEpochMs: 100,
      escalation: { source: "composerStopButton", requestedAtEpochMs: 250 },
    });
    expect(again).toBe(escalated);
  });

  it("names a refused interrupt as the escalation of the original request", () => {
    const interrupted = agentThreadsReducer(
      stateOf(thread([turn(TURN_A, { kind: "running" })])),
      requested(TURN_A),
    );

    const fallback = agentThreadsReducer(
      interrupted,
      haltAction(TURN_A, { kind: "interruptRefused", source: "composerEscape" }, "hardStop", 130),
    );

    expect(turnOf(fallback, TURN_A)?.haltRequest?.escalation).toEqual({
      source: "interruptRefused",
      requestedAtEpochMs: 130,
    });
  });

  it("records a refused interrupt that was never recorded under its original source", () => {
    const before = stateOf(thread([turn(TURN_A, { kind: "running" })]));

    const fallback = agentThreadsReducer(
      before,
      haltAction(TURN_A, { kind: "interruptRefused", source: "composerEscape" }, "hardStop", 130),
    );

    expect(turnOf(fallback, TURN_A)?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "hardStop",
      requestedAtEpochMs: 130,
    });
  });

  it("never rewrites a hard stop with a later request", () => {
    const stopped = agentThreadsReducer(
      stateOf(thread([turn(TURN_A, { kind: "running" })])),
      haltAction(TURN_A, STOP_BUTTON, "hardStop", 100),
    );

    expect(agentThreadsReducer(stopped, requested(TURN_A))).toBe(stopped);
    expect(agentThreadsReducer(stopped, haltAction(TURN_A, ESCAPE, "hardStop", 300))).toBe(stopped);
  });

  it("marks the turn but records nothing for an unusable request time", () => {
    const before = stateOf(thread([turn(TURN_A, { kind: "running" })]));

    const after = agentThreadsReducer(before, haltAction(TURN_A, ESCAPE, "softInterrupt", -1));

    expect(turnOf(after, TURN_A)?.haltRequested).toBe(true);
    expect(turnOf(after, TURN_A)?.haltRequest).toBeUndefined();
  });

  it("keeps the record through settlement and log hydration", () => {
    const requestedState = agentThreadsReducer(
      stateOf(thread([turn(TURN_A, { kind: "running" })])),
      requested(TURN_A),
    );
    const settled = agentThreadsReducer(requestedState, {
      kind: "turnInterrupted",
      turnId: TURN_A,
      nowEpochMs: 500,
    });
    const hydrated = agentThreadsReducer(settled, {
      kind: "turnHydrated",
      threadId: THREAD_ID,
      turnId: TURN_A,
      events: [{ kind: "assistantText", text: "partial answer" }],
      hasEarlier: false,
    });

    expect(turnOf(settled, TURN_A)?.status).toEqual({ kind: "interrupted" });
    expect(turnOf(hydrated, TURN_A)?.events).toEqual([
      { kind: "assistantText", text: "partial answer" },
    ]);
    expect(turnOf(hydrated, TURN_A)?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "softInterrupt",
      requestedAtEpochMs: 100,
    });
  });

  it("keeps a request made during a load instead of the older loaded snapshot", () => {
    const before = stateOf(thread([turn(TURN_A, { kind: "running" })]));
    const current = agentThreadsReducer(before, requested(TURN_A));
    const owner = { rootKey: OWNER.rootKey, ownerId: OWNER.ownerId };

    const reconciled = reconcileAgentThreadLoad(before, current, owner, [
      thread([turn(TURN_A, { kind: "running" })]),
    ]);
    const loaded = agentThreadsReducer(current, {
      kind: "loaded",
      owner,
      threads: reconciled.threads,
      retainedThreadIds: reconciled.retainedThreadIds,
    });

    expect(reconciled.retainedThreadIds.has(THREAD_ID)).toBe(true);
    expect(turnOf(loaded, TURN_A)?.haltRequest).toEqual({
      source: "composerEscape",
      mode: "softInterrupt",
      requestedAtEpochMs: 100,
    });
  });

  it("adopts the record carried by a loaded thread", () => {
    const record = {
      source: "threadMenu",
      mode: "hardStop",
      requestedAtEpochMs: 70,
    } as const;
    const stored = thread([{ ...turn(TURN_A, { kind: "stopped" }), haltRequest: record }]);
    const empty: AgentThreadsState = { threads: new Map() };
    const owner = { rootKey: OWNER.rootKey, ownerId: OWNER.ownerId };

    const reconciled = reconcileAgentThreadLoad(empty, empty, owner, [stored]);
    const loaded = agentThreadsReducer(empty, {
      kind: "loaded",
      owner,
      threads: reconciled.threads,
      retainedThreadIds: reconciled.retainedThreadIds,
    });

    expect(turnOf(loaded, TURN_A)?.haltRequest).toEqual(record);
    expect(turnOf(loaded, TURN_A)?.haltRequested).toBeUndefined();
  });

  it.each([
    { kind: "stopped" } as const,
    { kind: "interrupted" } as const,
    { kind: "exited", exitCode: 1 } as const,
    { kind: "failed", message: "boom" } as const,
  ])("ignores a request for a $kind turn", (status) => {
    const before = stateOf(thread([turn(TURN_A, status)]));

    expect(agentThreadsReducer(before, requested(TURN_A))).toBe(before);
  });

  it("ignores a foreign owner, an unknown turn and a repeated request", () => {
    const before = stateOf(thread([turn(TURN_A, { kind: "running" })]));
    const once = agentThreadsReducer(before, requested(TURN_A));

    expect(agentThreadsReducer(before, requested(TURN_A, "ws-2"))).toBe(before);
    expect(agentThreadsReducer(before, requested(TURN_B))).toBe(before);
    expect(agentThreadsReducer(once, requested(TURN_A))).toBe(once);
  });

  it("survives streamed output and a running status but is never persisted", () => {
    const marked = agentThreadsReducer(
      stateOf(thread([turn(TURN_A, { kind: "running" })])),
      requested(TURN_A),
    );
    const streamed = agentThreadsReducer(marked, {
      kind: "turnEventsAppended",
      threadId: THREAD_ID,
      turnId: TURN_A,
      workspaceId: OWNER.ownerId,
      repositoryRoot: OWNER.repositoryRoot,
      isolation: "worktree",
      worktreePath: "/repo/.worktrees/agt-1-0a1b",
      outputSequence: 1,
      events: [{ kind: "result", text: "", isError: true, usage: null }],
      sessionId: null,
      supervisorTruncated: false,
    });

    expect(turnOf(streamed, TURN_A)?.haltRequested).toBe(true);
    const persisted = streamed.threads.get(THREAD_ID);
    expect(persisted).toBeDefined();
    expect(JSON.stringify(serializeAgentThread(persisted ?? thread([])))).not.toContain(
      "haltRequest",
    );
    expect(JSON.stringify(serializeAgentHistoryThread(persisted ?? thread([])))).not.toContain(
      "haltRequest",
    );
  });
});
