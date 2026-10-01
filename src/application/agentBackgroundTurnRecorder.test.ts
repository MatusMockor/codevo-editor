import { describe, expect, it, vi } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  MAX_AGENT_TURNS_PER_THREAD,
  agentThreadsReducer,
  runningTurn,
  type AgentThread,
  type AgentThreadsAction,
  type AgentTurn,
} from "../domain/agentThread";
import type { AgentSessionBackgroundTurnEvent } from "../domain/agentThreadSession";
import {
  recordAgentBackgroundTurn,
  type AgentBackgroundTurnRecording,
} from "./agentBackgroundTurnRecorder";

const THREAD_ID = "agt-mue1wenj-7ede";
const OWNER_ID = "ws-1";
const LEAD_TURN_ID = "agt-munzwbwl-bdcb";
const INCOMPLETE_INDEX = 7;
const TRUNCATED_INDEX = 13;

function turn(status: AgentTurn["status"], turnId = LEAD_TURN_ID): AgentTurn {
  return {
    turnId,
    prompt: "co bezi, dal som stop running background na agenta",
    status,
    startedAtEpochMs: 1,
    endedAtEpochMs: status.kind === "running" ? null : 2,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: defaultAgentLaunchOptions("claudeCode"),
    cliVersion: null,
  };
}

function reply(
  text: string,
  flags: Partial<Pick<AgentSessionBackgroundTurnEvent, "complete" | "truncated">> = {},
): AgentSessionBackgroundTurnEvent {
  const output = [
    { type: "system", subtype: "init", session_id: "sess-fixture-0001" },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      usage: { input_tokens: 3, output_tokens: 2 },
      origin: { kind: "task-notification" },
    },
  ]
    .map((line) => `${JSON.stringify(line)}\n`)
    .join("");
  return {
    workspaceId: OWNER_ID,
    threadId: THREAD_ID,
    output,
    truncated: false,
    complete: true,
    ...flags,
  };
}

function harness(earlierTurns = 0) {
  const base = surfaceThreadView().thread;
  const earlier = Array.from({ length: earlierTurns }, (_, index) =>
    turn({ kind: "exited", exitCode: 0 }, `agt-old-${index}`),
  );
  let current: AgentThread = {
    ...base,
    threadId: THREAD_ID,
    title: "su tam dve veci",
    archived: false,
    owner: { ...base.owner, ownerId: OWNER_ID },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    turns: [...earlier, turn({ kind: "running" })],
  };
  let minted = 0;
  const setNotice = vi.fn();
  const dispatch = (action: AgentThreadsAction) => {
    const state = { threads: new Map([[THREAD_ID, current]]) };
    current = agentThreadsReducer(state, action).threads.get(THREAD_ID) ?? current;
  };
  const recording: AgentBackgroundTurnRecording = {
    readThread: (threadId) => (threadId === THREAD_ID ? current : undefined),
    setNotice,
    ports: {
      mintTurnId: () => `agt-bg-${String((minted += 1)).padStart(4, "0")}`,
      now: () => 10 + minted,
      dispatch,
    },
  };
  return {
    recording,
    setNotice,
    dispatch,
    thread: () => current,
    receive: (event: AgentSessionBackgroundTurnEvent) =>
      recordAgentBackgroundTurn(recording, current, event),
    settle: () =>
      dispatch({
        kind: "taskStatusEvent",
        threadId: THREAD_ID,
        event: {
          taskId: LEAD_TURN_ID,
          workspaceId: OWNER_ID,
          repositoryRoot: current.owner.repositoryRoot,
          isolation: current.target.isolation,
          worktreePath: current.target.worktreePath,
          sequence: 2,
          status: { kind: "exited", exitCode: 0 },
        },
        nowEpochMs: 500,
      }),
  };
}

function recordedReplies(value: AgentThread): ReadonlyArray<string> {
  return value.turns.flatMap((recorded) =>
    recorded.events.flatMap((event) => (event.kind === "assistantText" ? [event.text] : [])),
  );
}

function arrivals(): ReadonlyArray<AgentSessionBackgroundTurnEvent> {
  return Array.from({ length: 25 }, (_, index) => {
    if (index === INCOMPLETE_INDEX) return reply(`reply ${index}`, { complete: false });
    if (index === TRUNCATED_INDEX) return reply(`reply ${index}`, { truncated: true });
    return reply(`reply ${index}`);
  });
}

describe("recordAgentBackgroundTurn", () => {
  it("records 25 replies that arrive during one long running turn at once and in order", () => {
    const scene = harness();
    const events = arrivals();

    events.forEach((event, index) => {
      scene.receive(event);
      expect(scene.thread().turns).toHaveLength(index + 2);
      expect(scene.thread().turns[index]?.origin).toBe("background");
    });

    const turns = scene.thread().turns;
    expect(scene.setNotice).not.toHaveBeenCalled();
    expect(turns.slice(0, -1).map((recorded) => recorded.origin)).toEqual(
      events.map(() => "background"),
    );
    expect(recordedReplies(scene.thread())).toEqual(events.map((_, index) => `reply ${index}`));
    expect(turns[turns.length - 1]?.turnId).toBe(LEAD_TURN_ID);
    expect(runningTurn(scene.thread())?.turnId).toBe(LEAD_TURN_ID);
    expect(turns[INCOMPLETE_INDEX]?.status).toEqual({ kind: "interrupted" });
    expect(turns[INCOMPLETE_INDEX]?.eventsTruncated).toBe(true);
    expect(turns[TRUNCATED_INDEX]?.eventsTruncated).toBe(true);
    expect(turns[TRUNCATED_INDEX]?.streamMetrics?.complete).toBe(false);

    scene.settle();

    const settled = scene.thread().turns;
    expect(settled).toHaveLength(26);
    expect(settled[settled.length - 1]).toMatchObject({
      turnId: LEAD_TURN_ID,
      status: { kind: "exited", exitCode: 0 },
    });
    expect(runningTurn(scene.thread())).toBeNull();
    expect(scene.setNotice).not.toHaveBeenCalled();
  });

  it("keeps steering and stop aimed at the running turn while replies arrive", () => {
    const scene = harness();
    for (const event of arrivals().slice(0, 3)) scene.receive(event);

    scene.dispatch({
      kind: "turnSteered",
      threadId: THREAD_ID,
      turnId: LEAD_TURN_ID,
      event: { kind: "userMessage", text: "also run the tests" },
    });
    scene.dispatch({
      kind: "turnHaltRequested",
      threadId: THREAD_ID,
      ownerId: OWNER_ID,
      turnId: LEAD_TURN_ID,
    });
    scene.receive(reply("after the stop request"));

    const lead = scene.thread().turns[scene.thread().turns.length - 1];
    expect(lead?.turnId).toBe(LEAD_TURN_ID);
    expect(lead?.haltRequested).toBe(true);
    expect(lead?.events).toContainEqual({ kind: "userMessage", text: "also run the tests" });
    expect(scene.thread().turns.filter((recorded) => recorded.haltRequested === true)).toHaveLength(
      1,
    );
    expect(scene.setNotice).not.toHaveBeenCalled();
  });

  it("appends a reply after the turn once it has settled", () => {
    const scene = harness();
    scene.receive(reply("during"));
    scene.settle();
    scene.receive(reply("after"));

    expect(recordedReplies(scene.thread())).toEqual(["during", "after"]);
    expect(scene.thread().turns.map((recorded) => recorded.turnId)).toEqual([
      "agt-bg-0001",
      LEAD_TURN_ID,
      "agt-bg-0002",
    ]);
  });

  it("never evicts the running turn when replies fill the turn cap", () => {
    const scene = harness(MAX_AGENT_TURNS_PER_THREAD - 1);
    const events = Array.from({ length: 25 }, (_, index) => reply(`capped ${index}`));

    for (const event of events) scene.receive(event);

    const turns = scene.thread().turns;
    expect(scene.setNotice).not.toHaveBeenCalled();
    expect(turns).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(turns[turns.length - 1]?.turnId).toBe(LEAD_TURN_ID);
    expect(runningTurn(scene.thread())?.turnId).toBe(LEAD_TURN_ID);
    expect(turns[0]?.turnId).toBe("agt-old-25");
    expect(recordedReplies(scene.thread())).toEqual(events.map((_, index) => `capped ${index}`));
    expect(scene.thread().turnsTruncated).toBe(true);
  });

  it("tells the user with a preview when the reducer rejects the reply", () => {
    const scene = harness();
    const archived = { ...scene.thread(), archived: true };
    const recording: AgentBackgroundTurnRecording = {
      ...scene.recording,
      readThread: () => archived,
      ports: { ...scene.recording.ports, dispatch: () => undefined },
    };

    recordAgentBackgroundTurn(recording, archived, reply("lost reply"));

    expect(scene.setNotice).toHaveBeenCalledTimes(1);
    expect(scene.setNotice.mock.calls[0]?.[0]).toEqual({
      kind: "info",
      message:
        'Claude replied in "su tam dve veci" after background work finished, but the reply could not be added to the thread: "lost reply"',
      action: null,
    });
  });
});
