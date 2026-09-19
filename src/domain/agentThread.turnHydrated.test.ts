import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "./agentThread";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const THREAD_ID = "agt-1-0a1b";
const TURN_ID = "agt-1-0a1c";

function tool(index: number): AgentTurnEvent {
  return { kind: "toolCall", toolId: `tool-${index}`, name: "Bash", inputSummary: `run ${index}` };
}

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "do the thing",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [tool(900), tool(901)],
    eventsTruncated: true,
    lastStatusSequence: 3,
    lastOutputSequence: 7,
    streamMetrics: null,
    launch: null,
    cliVersion: "1.2.3",
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

function hydrated(events: ReadonlyArray<AgentTurnEvent>, hasEarlier: boolean) {
  return {
    kind: "turnHydrated" as const,
    threadId: THREAD_ID,
    turnId: TURN_ID,
    events,
    hasEarlier,
  };
}

describe("turnHydrated", () => {
  it("replaces only the events, the truncation flag and the key offset of a settled turn", () => {
    const before = thread();
    const events = Array.from({ length: 700 }, (_unused, index) => tool(index));
    const next = agentThreadsReducer(stateOf(before), hydrated(events, false));
    const after = next.threads.get(THREAD_ID)!;
    const {
      events: afterEvents,
      eventsTruncated,
      firstEventOffset,
      ...afterRest
    } = after.turns[0]!;
    const { events: _beforeEvents, eventsTruncated: _beforeFlag, ...beforeRest } = before.turns[0]!;

    expect(afterEvents).toEqual(events);
    expect(eventsTruncated).toBe(false);
    expect(firstEventOffset).toBe(-698);
    expect(afterRest).toEqual(beforeRest);
    expect({ ...after, turns: [] }).toEqual({ ...before, turns: [] });
    expect(Object.keys(after.turns[0]!).sort()).toEqual(
      [...Object.keys(before.turns[0]!), "firstEventOffset"].sort(),
    );
  });

  it("counts the key offset from the end so settled rows keep their identity", () => {
    const tail = [tool(900), tool(901)];
    const once = agentThreadsReducer(
      stateOf(thread()),
      hydrated([tool(1), tool(2), tool(3), ...tail], false),
    ).threads.get(THREAD_ID)!.turns[0]!;
    expect(once.firstEventOffset).toBe(-3);

    const twice = agentThreadsReducer(
      stateOf(thread({ turns: [once] })),
      hydrated([tool(0), tool(1), tool(2), tool(3), ...tail], true),
    ).threads.get(THREAD_ID)!.turns[0]!;
    expect(twice.firstEventOffset).toBe(-4);
  });

  it("keeps the key offset out of the persisted thread shape", () => {
    const hydratedThread = agentThreadsReducer(
      stateOf(thread()),
      hydrated([tool(1), tool(900), tool(901)], false),
    ).threads.get(THREAD_ID)!;
    expect(hydratedThread.turns[0]!.firstEventOffset).toBe(-1);

    const wire = serializeAgentThread(hydratedThread);
    expect(JSON.stringify(wire)).not.toContain("firstEventOffset");
    expect(parseAgentThread(JSON.parse(JSON.stringify(wire))).turns[0]!.firstEventOffset).toBe(
      undefined,
    );
  });

  it("never turns the key offset positive when a hydration returns fewer events", () => {
    const shrunk = agentThreadsReducer(stateOf(thread()), hydrated([tool(900)], true)).threads.get(
      THREAD_ID,
    )!.turns[0]!;
    expect(shrunk.firstEventOffset).toBeUndefined();

    const hydratedOnce = agentThreadsReducer(
      stateOf(thread()),
      hydrated([tool(1), tool(900), tool(901)], false),
    ).threads.get(THREAD_ID)!.turns[0]!;
    const again = agentThreadsReducer(
      stateOf(thread({ turns: [hydratedOnce] })),
      hydrated([tool(901)], true),
    ).threads.get(THREAD_ID)!.turns[0]!;
    expect(again.firstEventOffset).toBe(-1);
  });

  it("stays truncated when the log holds earlier events", () => {
    const next = agentThreadsReducer(stateOf(thread()), hydrated([tool(1), tool(2)], true));
    expect(next.threads.get(THREAD_ID)!.turns[0]!.eventsTruncated).toBe(true);
  });

  it("caps an oversized hydration to the in-memory window and reports the truncation", () => {
    const events = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 5 }, (_unused, index) =>
      tool(index),
    );
    const next = agentThreadsReducer(stateOf(thread()), hydrated(events, false));
    const after = next.threads.get(THREAD_ID)!.turns[0]!;
    expect(after.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(after.events[after.events.length - 1]).toEqual(tool(MAX_AGENT_EVENTS_PER_TURN + 4));
    expect(after.eventsTruncated).toBe(true);
  });

  it("never clobbers a running turn", () => {
    const state = stateOf(
      thread({ turns: [turn({ status: { kind: "running" }, endedAtEpochMs: null })] }),
    );
    expect(agentThreadsReducer(state, hydrated([tool(1)], false))).toBe(state);
  });

  it("ignores a thread or a turn that is gone", () => {
    const state = stateOf(thread());
    expect(
      agentThreadsReducer(state, { ...hydrated([tool(1)], false), threadId: "agt-9-ffff" }),
    ).toBe(state);
    expect(
      agentThreadsReducer(state, { ...hydrated([tool(1)], false), turnId: "agt-9-fffe" }),
    ).toBe(state);
  });
});
