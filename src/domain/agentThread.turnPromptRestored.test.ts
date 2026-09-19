import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
} from "./agentThread";
import { serializeAgentThread } from "./agentThreadWire";
import { CLIPPED_AGENT_PROMPT_MARKER } from "./agentPromptClipping";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";
const CLIPPED_PROMPT = `do the thing${CLIPPED_AGENT_PROMPT_MARKER}`;
const FULL_PROMPT = `do the thing${"!".repeat(4_000)}`;

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: CLIPPED_PROMPT,
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 3,
    lastOutputSequence: 7,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: OWNER,
    target: { isolation: "worktree", worktreePath: "/repo/.worktrees/agt-1-0a1b" },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20,
    turns: [turn()],
    turnsTruncated: false,
    viewedAtEpochMs: 30,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function stateOf(value: AgentThread): AgentThreadsState {
  return { threads: new Map([[value.threadId, value]]) };
}

function restored(prompt: string): AgentThreadsAction {
  return { kind: "turnPromptRestored", threadId: THREAD_ID, turnId: TURN_ID, prompt };
}

describe("turnPromptRestored", () => {
  it("replaces only the prompt and marks the turn reconciled", () => {
    const before = thread();
    const after = agentThreadsReducer(stateOf(before), restored(FULL_PROMPT)).threads.get(
      THREAD_ID,
    )!;
    const { prompt, promptRestored, ...afterRest } = after.turns[0]!;
    const { prompt: _beforePrompt, ...beforeRest } = before.turns[0]!;

    expect(prompt).toBe(FULL_PROMPT);
    expect(promptRestored).toBe(true);
    expect(afterRest).toEqual(beforeRest);
    expect({ ...after, turns: [] }).toEqual({ ...before, turns: [] });
  });

  it("never moves the thread in the sort order", () => {
    const before = thread();
    const after = agentThreadsReducer(stateOf(before), restored(FULL_PROMPT)).threads.get(
      THREAD_ID,
    )!;

    expect(after.updatedAtEpochMs).toBe(before.updatedAtEpochMs);
    expect(after.viewedAtEpochMs).toBe(before.viewedAtEpochMs);
  });

  it("keeps the reconciliation mark out of the persisted v1 shape", () => {
    const after = agentThreadsReducer(stateOf(thread()), restored(FULL_PROMPT)).threads.get(
      THREAD_ID,
    )!;
    const document = serializeAgentThread(after);
    const turns = document.turns as ReadonlyArray<Record<string, unknown>>;

    expect(JSON.stringify(document)).not.toContain("promptRestored");
    expect(turns[0]?.prompt).toBe(FULL_PROMPT);
  });

  it("never touches a running turn", () => {
    const state = stateOf(
      thread({ turns: [turn({ status: { kind: "running" }, endedAtEpochMs: null })] }),
    );
    expect(agentThreadsReducer(state, restored(FULL_PROMPT))).toBe(state);
  });

  it("ignores a thread or a turn that is gone", () => {
    const state = stateOf(thread());
    expect(
      agentThreadsReducer(state, { ...restored(FULL_PROMPT), threadId: "agt-9-ffff" } as never),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, { ...restored(FULL_PROMPT), turnId: "agt-9-fffe" } as never),
    ).toBe(state);
  });

  it("fails closed on an empty, oversized or NUL bearing prompt", () => {
    const state = stateOf(thread());
    expect(agentThreadsReducer(state, restored(""))).toBe(state);
    expect(agentThreadsReducer(state, restored("a".repeat(MAX_AGENT_TASK_PROMPT_BYTES + 1)))).toBe(
      state,
    );
    expect(agentThreadsReducer(state, restored("ask\u0000me"))).toBe(state);
    expect(
      agentThreadsReducer(state, restored("a".repeat(MAX_AGENT_TASK_PROMPT_BYTES))).threads.get(
        THREAD_ID,
      )!.turns[0]!.prompt,
    ).toBe("a".repeat(MAX_AGENT_TASK_PROMPT_BYTES));
  });
});
