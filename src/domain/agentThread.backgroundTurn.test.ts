import { describe, expect, it } from "vitest";
import { agentBackgroundTurn, parseAgentBackgroundTurn } from "./agentBackgroundTurn";
import { defaultAgentLaunchOptions } from "./agentLaunch";
import {
  MAX_AGENT_TURNS_PER_THREAD,
  agentThreadsReducer,
  runningTurn,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
} from "./agentThread";
import {
  parseAgentHistoryTurn,
  parseAgentThread,
  serializeAgentHistoryThread,
  serializeAgentThread,
} from "./agentThreadWire";
import { findInThread } from "./agentThreadSearch";
import { agentFailedLastTurn } from "./agentTurnRetry";
import { AGENT_BACKGROUND_TURN_LABEL, AGENT_UNPROMPTED_TURN_LABEL } from "./agentTurnOrigin";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const THREAD_ID = "agt-1-0a1b";
const NOW = 5_000;

const REPLY = [
  { type: "system", subtype: "init", session_id: "sess-fixture-0001" },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: "background-finished" }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "background-finished",
    total_cost_usd: 0.01,
    usage: { input_tokens: 3, output_tokens: 2 },
    origin: { kind: "task-notification" },
  },
]
  .map((line) => `${JSON.stringify(line)}\n`)
  .join("");

const UNPROMPTED_REPLY = REPLY.replace(',"origin":{"kind":"task-notification"}', "");

function userTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-0a1c",
    prompt: "start the build in the background",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 10,
    endedAtEpochMs: 20,
    events: [{ kind: "assistantText", text: "started" }],
    eventsTruncated: false,
    lastStatusSequence: 2,
    lastOutputSequence: 3,
    streamMetrics: null,
    launch: defaultAgentLaunchOptions("claudeCode"),
    cliVersion: "2.1.281",
    ...overrides,
  };
}

function backgroundTurn(
  turnId = "agt-bg-0001",
  flags: { readonly truncated: boolean; readonly complete: boolean } = {
    truncated: false,
    complete: true,
  },
): AgentTurn {
  return agentBackgroundTurn(turnId, parseAgentBackgroundTurn({ output: REPLY, ...flags }), NOW);
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: OWNER,
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    title: "Build in the background",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 20,
    turns: [userTurn()],
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

function recorded(
  turn: AgentTurn,
  overrides: Partial<Extract<AgentThreadsAction, { kind: "backgroundTurnRecorded" }>> = {},
): AgentThreadsAction {
  return {
    kind: "backgroundTurnRecorded",
    threadId: THREAD_ID,
    workspaceId: OWNER.ownerId,
    turn,
    ...overrides,
  };
}

describe("agentThreadsReducer backgroundTurnRecorded", () => {
  it("appends a terminal background turn after the settled user turn", () => {
    const state = stateOf(thread());
    const next = agentThreadsReducer(state, recorded(backgroundTurn()));
    const saved = next.threads.get(THREAD_ID);

    expect(saved?.turns.map((turn) => turn.turnId)).toEqual(["agt-1-0a1c", "agt-bg-0001"]);
    expect(saved?.turns[1]?.origin).toBe("background");
    expect(saved?.updatedAtEpochMs).toBe(NOW);
    expect(saved === undefined ? null : runningTurn(saved)).toBeNull();
  });

  it("fails closed for a foreign owner, an unknown or archived thread or a duplicate id", () => {
    const running = thread({
      turns: [userTurn({ status: { kind: "running" }, endedAtEpochMs: null })],
    });
    const cases: ReadonlyArray<readonly [AgentThreadsState, AgentThreadsAction]> = [
      [stateOf(thread()), recorded(backgroundTurn(), { workspaceId: "ws-other" })],
      [stateOf(thread()), recorded(backgroundTurn(), { threadId: "agt-9-9999" })],
      [stateOf(running), recorded(backgroundTurn(), { workspaceId: "ws-other" })],
      [stateOf(running), recorded(backgroundTurn("agt-1-0a1c"))],
      [stateOf({ ...running, archived: true }), recorded(backgroundTurn())],
      [stateOf(thread({ archived: true })), recorded(backgroundTurn())],
      [stateOf(thread()), recorded(backgroundTurn("agt-1-0a1c"))],
      [stateOf(thread()), recorded(userTurn({ turnId: "agt-bg-0009" }))],
      [
        stateOf(thread()),
        recorded({
          ...backgroundTurn(),
          status: { kind: "running" },
          endedAtEpochMs: null,
        }),
      ],
    ];
    for (const [state, action] of cases) {
      expect(agentThreadsReducer(state, action)).toBe(state);
    }
  });

  it("evicts the oldest settled turn at the turn cap like any new turn", () => {
    const turns = Array.from({ length: MAX_AGENT_TURNS_PER_THREAD }, (_, index) =>
      userTurn({ turnId: `agt-1-${index.toString(16).padStart(4, "0")}` }),
    );
    const next = agentThreadsReducer(stateOf(thread({ turns })), recorded(backgroundTurn()));
    const saved = next.threads.get(THREAD_ID);

    expect(saved?.turns).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(saved?.turns[0]?.turnId).toBe("agt-1-0001");
    expect(saved?.turnsTruncated).toBe(true);
  });

  it("inserts replies that arrive during a running turn before it, in arrival order", () => {
    const running = userTurn({
      turnId: "agt-1-0a1d",
      prompt: "keep working on the release",
      status: { kind: "running" },
      endedAtEpochMs: null,
      lastStatusSequence: 1,
    });
    let state = stateOf(thread({ turns: [userTurn(), running] }));
    for (const turnId of ["agt-bg-0001", "agt-bg-0002", "agt-bg-0003"]) {
      state = agentThreadsReducer(state, recorded(backgroundTurn(turnId)));
    }
    const saved = state.threads.get(THREAD_ID);

    expect(saved?.turns.map((turn) => turn.turnId)).toEqual([
      "agt-1-0a1c",
      "agt-bg-0001",
      "agt-bg-0002",
      "agt-bg-0003",
      "agt-1-0a1d",
    ]);
    expect(saved === undefined ? null : runningTurn(saved)?.turnId).toBe("agt-1-0a1d");
    expect(saved?.updatedAtEpochMs).toBe(NOW);
  });

  it("keeps steering, halting and settling aimed at the running turn after insertion", () => {
    const running = userTurn({
      turnId: "agt-1-0a1d",
      status: { kind: "running" },
      endedAtEpochMs: null,
      lastStatusSequence: 1,
    });
    let state = stateOf(thread({ turns: [userTurn(), running] }));
    state = agentThreadsReducer(state, recorded(backgroundTurn("agt-bg-0001")));
    state = agentThreadsReducer(state, {
      kind: "turnSteered",
      threadId: THREAD_ID,
      turnId: "agt-1-0a1d",
      event: { kind: "userMessage", text: "also run the tests" },
    });
    state = agentThreadsReducer(state, {
      kind: "turnHaltRequested",
      threadId: THREAD_ID,
      ownerId: OWNER.ownerId,
      turnId: "agt-1-0a1d",
      trigger: { kind: "ui", source: "composerStopButton" },
      mode: "hardStop",
      requestedAtEpochMs: 40,
    });
    const steered = state.threads.get(THREAD_ID);
    expect(steered?.turns[2]?.events).toContainEqual({
      kind: "userMessage",
      text: "also run the tests",
    });
    expect(steered?.turns[2]?.haltRequested).toBe(true);
    expect(steered?.turns[1]?.haltRequested).toBeUndefined();

    state = agentThreadsReducer(state, {
      kind: "turnInterrupted",
      turnId: "agt-1-0a1d",
      nowEpochMs: 90,
    });
    const settled = state.threads.get(THREAD_ID);
    expect(settled?.turns.map((turn) => [turn.turnId, turn.status.kind])).toEqual([
      ["agt-1-0a1c", "exited"],
      ["agt-bg-0001", "exited"],
      ["agt-1-0a1d", "interrupted"],
    ]);
    expect(settled === undefined ? null : runningTurn(settled)).toBeNull();
  });

  it("never evicts the running turn at the turn cap and evicts the oldest settled turns", () => {
    const settledTurns = Array.from({ length: MAX_AGENT_TURNS_PER_THREAD - 1 }, (_, index) =>
      userTurn({ turnId: `agt-1-${index.toString(16).padStart(4, "0")}` }),
    );
    const running = userTurn({
      turnId: "agt-2-live",
      status: { kind: "running" },
      endedAtEpochMs: null,
    });
    let state = stateOf(thread({ turns: [...settledTurns, running] }));
    const arrivals = Array.from(
      { length: MAX_AGENT_TURNS_PER_THREAD + 6 },
      (_, index) => `agt-bg-${index.toString(16).padStart(4, "0")}`,
    );
    for (const turnId of arrivals) {
      state = agentThreadsReducer(state, recorded(backgroundTurn(turnId)));
    }
    const saved = state.threads.get(THREAD_ID);

    expect(saved?.turns).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(saved?.turns[MAX_AGENT_TURNS_PER_THREAD - 1]?.turnId).toBe("agt-2-live");
    expect(saved?.turns.slice(0, -1).map((turn) => turn.turnId)).toEqual(
      arrivals.slice(-(MAX_AGENT_TURNS_PER_THREAD - 1)),
    );
    expect(saved?.turnsTruncated).toBe(true);
    expect(saved === undefined ? null : runningTurn(saved)?.turnId).toBe("agt-2-live");
  });

  it("records an incomplete background turn as interrupted without a truncation marker", () => {
    const next = agentThreadsReducer(
      stateOf(thread()),
      recorded(backgroundTurn("agt-bg-0002", { truncated: false, complete: false })),
    );
    const saved = next.threads.get(THREAD_ID)?.turns[1];

    expect(saved?.eventsTruncated).toBe(false);
    expect(saved?.status).toEqual({ kind: "interrupted" });
  });

  it("never finds the background label as a user prompt", () => {
    const value = thread({ turns: [userTurn(), backgroundTurn()] });

    expect(findInThread(value, "continued after background")).toEqual([]);
    expect(findInThread(value, "background-finished").length).toBeGreaterThan(0);
  });

  it("never offers a retry for a failed background turn", () => {
    const failed: AgentTurn = {
      ...backgroundTurn(),
      status: { kind: "failed", message: "The provider reported a failed turn." },
    };
    expect(agentFailedLastTurn(thread({ turns: [userTurn(), failed] }))).toBeNull();
  });
});

describe("background turn persistence", () => {
  it("never writes an origin key to the v1 thread file or the history snapshot", () => {
    const value = thread({ turns: [userTurn(), backgroundTurn()] });
    const v1 = JSON.stringify(serializeAgentThread(value));
    const history = JSON.stringify(serializeAgentHistoryThread(value));

    expect(v1).not.toContain('"origin"');
    expect(history).not.toContain('"origin"');
    expect(v1).toContain(AGENT_BACKGROUND_TURN_LABEL);
  });

  it("restores the background origin after a reload through both stores", () => {
    const value = thread({ turns: [userTurn(), backgroundTurn()] });
    const v1 = parseAgentThread(JSON.parse(JSON.stringify(serializeAgentThread(value))));
    const historyDocument = serializeAgentHistoryThread(value) as {
      readonly turns: ReadonlyArray<unknown>;
    };
    const historyTurn = parseAgentHistoryTurn(JSON.parse(JSON.stringify(historyDocument.turns[1])));

    expect(v1.turns[0]?.origin).toBeUndefined();
    expect(v1.turns[1]).toEqual(value.turns[1]);
    expect(historyTurn).toEqual(value.turns[1]);
  });

  it("restores both background labels after a reload through both stores", () => {
    const unprompted = agentBackgroundTurn(
      "agt-bg-0002",
      parseAgentBackgroundTurn({ output: UNPROMPTED_REPLY, truncated: false, complete: true }),
      NOW,
    );
    const value = thread({ turns: [userTurn(), backgroundTurn(), unprompted] });
    const v1 = parseAgentThread(JSON.parse(JSON.stringify(serializeAgentThread(value))));
    const historyDocument = serializeAgentHistoryThread(value) as {
      readonly turns: ReadonlyArray<unknown>;
    };
    const history = historyDocument.turns.map((turn) =>
      parseAgentHistoryTurn(JSON.parse(JSON.stringify(turn))),
    );

    expect(UNPROMPTED_REPLY).not.toContain("task-notification");
    expect(unprompted.prompt).toBe(AGENT_UNPROMPTED_TURN_LABEL);
    expect(v1.turns.map((turn) => [turn.origin, turn.prompt])).toEqual([
      [undefined, "start the build in the background"],
      ["background", AGENT_BACKGROUND_TURN_LABEL],
      ["background", AGENT_UNPROMPTED_TURN_LABEL],
    ]);
    expect(v1.turns[2]).toEqual(unprompted);
    expect(history[2]).toEqual(unprompted);
  });

  it("reloads background turns inserted before a running turn in the same order", () => {
    const running = userTurn({
      turnId: "agt-1-0a1d",
      status: { kind: "running" },
      endedAtEpochMs: null,
    });
    let state = stateOf(thread({ turns: [userTurn(), running] }));
    state = agentThreadsReducer(state, recorded(backgroundTurn("agt-bg-0001")));
    state = agentThreadsReducer(
      state,
      recorded(backgroundTurn("agt-bg-0002", { truncated: true, complete: true })),
    );
    const value = state.threads.get(THREAD_ID);
    expect(value).toBeDefined();
    const live = value as AgentThread;
    const v1 = parseAgentThread(JSON.parse(JSON.stringify(serializeAgentThread(live))));
    const historyDocument = serializeAgentHistoryThread(live) as {
      readonly turns: ReadonlyArray<unknown>;
    };
    const history = historyDocument.turns.map((turn) =>
      parseAgentHistoryTurn(JSON.parse(JSON.stringify(turn))),
    );
    const order = ["agt-1-0a1c", "agt-bg-0001", "agt-bg-0002", "agt-1-0a1d"];

    expect(v1.turns.map((turn) => turn.turnId)).toEqual(order);
    expect(v1.turns.map((turn) => turn.origin)).toEqual([
      undefined,
      "background",
      "background",
      undefined,
    ]);
    expect(runningTurn(v1)?.turnId).toBe("agt-1-0a1d");
    expect(history.map((turn) => turn.turnId)).toEqual(order);
  });

  it("keeps a user turn that only repeats the marker text a user turn", () => {
    const repeated = userTurn({ prompt: AGENT_BACKGROUND_TURN_LABEL });
    const repeatedUnprompted = userTurn({
      turnId: "agt-1-0a1d",
      prompt: AGENT_UNPROMPTED_TURN_LABEL,
    });
    const parsed = parseAgentThread(
      JSON.parse(
        JSON.stringify(serializeAgentThread(thread({ turns: [repeated, repeatedUnprompted] }))),
      ),
    );

    expect(parsed.turns.map((turn) => turn.origin)).toEqual([undefined, undefined]);
  });

  it("rejects an explicit origin key in a stored turn", () => {
    const document = serializeAgentThread(thread({ turns: [userTurn()] })) as {
      readonly turns: ReadonlyArray<Record<string, unknown>>;
    };
    for (const origin of ["background", "user", null]) {
      const stored = { ...document, turns: [{ ...document.turns[0], origin }] };
      expect(() => parseAgentThread(stored)).toThrow(TypeError);
    }
  });
});
