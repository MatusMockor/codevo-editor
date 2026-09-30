import { describe, expect, it, vi } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  MAX_AGENT_TURNS_PER_THREAD,
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentTurn,
} from "../domain/agentThread";
import type { AgentSessionBackgroundTurnEvent } from "../domain/agentThreadSession";
import {
  AgentBackgroundTurnRecorder,
  MAX_HELD_BACKGROUND_TURN_BYTES_PER_THREAD,
  MAX_HELD_BACKGROUND_TURNS_PER_THREAD,
  type AgentBackgroundTurnRecording,
} from "./agentBackgroundTurnRecorder";

const THREAD_ID = "agt-mue1wenj-7ede";
const OWNER_ID = "ws-1";

function turn(status: AgentTurn["status"]): AgentTurn {
  return {
    turnId: "agt-munzwbwl-bdcb",
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

function thread(status: AgentTurn["status"]): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId: THREAD_ID,
    title: "su tam dve veci",
    archived: false,
    owner: { ...base.owner, ownerId: OWNER_ID },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    turns: [turn(status)],
  };
}

function reply(text: string): AgentSessionBackgroundTurnEvent {
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
  return { workspaceId: OWNER_ID, threadId: THREAD_ID, output, truncated: false, complete: true };
}

function harness(earlierTurns = 0) {
  const earlier = Array.from({ length: earlierTurns }, (_, index) => ({
    ...turn({ kind: "exited", exitCode: 0 }),
    turnId: `agt-old-${index}`,
  }));
  let current: AgentThread = {
    ...thread({ kind: "running" }),
    turns: [...earlier, turn({ kind: "running" })],
  };
  let minted = 0;
  const setNotice = vi.fn();
  const recording: AgentBackgroundTurnRecording = {
    readThread: (threadId) => (threadId === THREAD_ID ? current : undefined),
    setNotice,
    ports: {
      mintTurnId: () => `agt-bg-${(minted += 1)}`,
      now: () => 10,
      dispatch: (action: AgentThreadsAction) => {
        const state = { threads: new Map([[THREAD_ID, current]]) };
        current = agentThreadsReducer(state, action).threads.get(THREAD_ID) ?? current;
      },
    },
  };
  return {
    recording,
    setNotice,
    thread: () => current,
    settle: () => {
      current = {
        ...current,
        turns: [...current.turns.slice(0, -1), turn({ kind: "exited", exitCode: 0 })],
      };
    },
  };
}

function recordedReplies(value: AgentThread): ReadonlyArray<string> {
  return value.turns.flatMap((recorded) =>
    recorded.events.flatMap((event) => (event.kind === "assistantText" ? [event.text] : [])),
  );
}

describe("AgentBackgroundTurnRecorder", () => {
  it("keeps every background reply that arrives during one long running turn", () => {
    const recorder = new AgentBackgroundTurnRecorder();
    const scene = harness();
    const replies = [
      "Integration gate passed.",
      "Review označenia „NEW“ našlo jednu vážnu chybu (P1).",
      "Adversarial review of stop_task is clean.",
      "TS stop UI is ready for review.",
    ];

    for (const text of replies) recorder.receive(scene.recording, scene.thread(), reply(text));
    scene.settle();
    recorder.flush(scene.recording);

    expect(scene.setNotice).not.toHaveBeenCalled();
    expect(recordedReplies(scene.thread())).toEqual(replies);
  });

  it("surfaces the oldest held reply once the per-thread count bound is exceeded", () => {
    const recorder = new AgentBackgroundTurnRecorder();
    const scene = harness();
    const replies = Array.from(
      { length: MAX_HELD_BACKGROUND_TURNS_PER_THREAD + 1 },
      (_, index) => `reply ${index}`,
    );

    for (const text of replies) recorder.receive(scene.recording, scene.thread(), reply(text));

    expect(scene.setNotice).toHaveBeenCalledTimes(1);
    expect(scene.setNotice.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining(
        'newer replies arrived before it could be added to the thread: "reply 0"',
      ),
    });
    scene.settle();
    recorder.flush(scene.recording);
    expect(recordedReplies(scene.thread())).toEqual(replies.slice(1));
  });

  it("surfaces the oldest held replies once the per-thread byte bound is exceeded", () => {
    const recorder = new AgentBackgroundTurnRecorder();
    const scene = harness();
    const large = "x".repeat(MAX_HELD_BACKGROUND_TURN_BYTES_PER_THREAD / 8);

    for (const prefix of ["a", "b", "c", "d"]) {
      recorder.receive(scene.recording, scene.thread(), reply(`${prefix}${large}`));
    }

    expect(scene.setNotice).toHaveBeenCalledTimes(1);
    scene.settle();
    recorder.flush(scene.recording);
    expect(recordedReplies(scene.thread()).map((text) => text[0])).toEqual(["b", "c", "d"]);
  });

  it("marks the thread truncated when recording held replies evicts its oldest turns", () => {
    const recorder = new AgentBackgroundTurnRecorder();
    const scene = harness(MAX_AGENT_TURNS_PER_THREAD - 1);
    const replies = ["first finished", "second finished", "third finished"];

    for (const text of replies) recorder.receive(scene.recording, scene.thread(), reply(text));
    scene.settle();
    recorder.flush(scene.recording);

    expect(scene.setNotice).not.toHaveBeenCalled();
    expect(scene.thread().turns).toHaveLength(MAX_AGENT_TURNS_PER_THREAD);
    expect(scene.thread().turnsTruncated).toBe(true);
    expect(recordedReplies(scene.thread())).toEqual(replies);
  });
});
