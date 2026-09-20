import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { parseAgentSubagentLifecycle, type AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { legacyAgentSubagentLifecycle } from "./agentSubagentLifecycleLegacy";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
} from "./agentThread";
import { serializeAgentThread } from "./agentThreadWire";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";
const RETAINED = parseAgentSubagentLifecycle(wire.valid.retained) as AgentSubagentLifecycle;
const PERSISTED = legacyAgentSubagentLifecycle(RETAINED);

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "do the thing",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 3,
    lastOutputSequence: 7,
    subagentLifecycle: PERSISTED,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(turns: ReadonlyArray<AgentTurn>): AgentThread {
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

function restored(lifecycle: AgentSubagentLifecycle, turnId = TURN_ID): AgentThreadsAction {
  return { kind: "turnLifecycleRestored", threadId: THREAD_ID, turnId, lifecycle };
}

describe("agentThreadsReducer turnLifecycleRestored", () => {
  it("restores the retained detail of a settled turn and keeps the written JSON unchanged", () => {
    const before = stateOf(thread([turn()]));
    const after = agentThreadsReducer(before, restored(RETAINED));
    const settled = after.threads.get(THREAD_ID)!;

    expect(settled.turns[0]?.subagentLifecycle).toEqual(RETAINED);
    expect(settled.updatedAtEpochMs).toBe(20);
    expect(serializeAgentThread(settled)).toEqual(
      serializeAgentThread(before.threads.get(THREAD_ID)!),
    );
  });

  it("never touches a running turn", () => {
    const before = stateOf(thread([turn({ status: { kind: "running" }, endedAtEpochMs: null })]));

    expect(agentThreadsReducer(before, restored(RETAINED))).toBe(before);
  });

  it("ignores a snapshot that describes another state, an unknown turn or an invalid payload", () => {
    const before = stateOf(thread([turn()]));
    const other = parseAgentSubagentLifecycle(wire.valid.legacy) as AgentSubagentLifecycle;

    expect(agentThreadsReducer(before, restored(other))).toBe(before);
    expect(agentThreadsReducer(before, restored(PERSISTED))).toBe(before);
    expect(agentThreadsReducer(before, restored(RETAINED, "agt-9-ffff"))).toBe(before);
    expect(agentThreadsReducer(before, restored({ ...RETAINED, unknown: 1 } as never))).toBe(
      before,
    );
  });

  it("keeps retained detail that the loaded JSON already carried and a turn without a lifecycle", () => {
    const carried = stateOf(thread([turn({ subagentLifecycle: RETAINED })]));
    const plain = stateOf(thread([turn({ subagentLifecycle: undefined })]));

    expect(agentThreadsReducer(carried, restored(RETAINED))).toBe(carried);
    expect(agentThreadsReducer(plain, restored(RETAINED))).toBe(plain);
  });
});
