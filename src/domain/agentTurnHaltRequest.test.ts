import { describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnStatus,
} from "./agentThread";
import { serializeAgentThread } from "./agentThreadWire";

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

function requested(turnId: string, ownerId: string = OWNER.ownerId): AgentThreadsAction {
  return { kind: "turnHaltRequested", threadId: THREAD_ID, ownerId, turnId };
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
    expect(turnOf(after, TURN_A)?.haltRequested).toBeUndefined();
    expect(after.threads.get(THREAD_ID)?.updatedAtEpochMs).toBe(20);
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
      "haltRequested",
    );
  });
});
