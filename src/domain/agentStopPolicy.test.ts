import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "./agentThread";
import {
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  agentStopArmIsLive,
  decideAgentStop,
} from "./agentStopPolicy";

const result: AgentTurnEvent = { kind: "result", text: "Started", isError: false, usage: null };
const shell = (
  status: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"],
): AgentTurnEvent => ({
  kind: "backgroundTask",
  taskId: "watch",
  status,
  taskType: "shell",
  description: "npm run dev",
});
const assistant: AgentTurnEvent = { kind: "assistantText", text: "Working" };

function turn(events: ReadonlyArray<AgentTurnEvent>, turnId = "agt-1-t1"): AgentTurn {
  return {
    turnId,
    prompt: "Start the dev server",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: events.length,
    launch: null,
    cliVersion: null,
  };
}

describe("decideAgentStop", () => {
  it("ignores a thread without a running turn", () => {
    expect(decideAgentStop({ threadId: "t", turn: null, arm: null, nowEpochMs: 5 })).toEqual({
      kind: "ignore",
    });
  });

  it("hard-stops while the foreground is still running", () => {
    expect(
      decideAgentStop({ threadId: "t", turn: turn([assistant]), arm: null, nowEpochMs: 5 }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("hard-stops when the foreground settled and no background work is live", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), shell("completed"), result]),
        arm: null,
        nowEpochMs: 5,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("asks for confirmation when only background work is live", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm: null,
        nowEpochMs: 5,
      }),
    ).toEqual({ kind: "confirmBackground", turnId: "agt-1-t1", liveTaskCount: 1 });
  });

  it("hard-stops while the lead is still streaming and no result arrived", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), assistant]),
        arm: null,
        nowEpochMs: 5,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("hard-stops a background wake-up that begins with reasoning or a user message", () => {
    for (const wake of [
      { kind: "reasoning", text: "Checking the server" },
      { kind: "userMessage", text: "Now deploy" },
    ] satisfies ReadonlyArray<AgentTurnEvent>) {
      expect(
        decideAgentStop({
          threadId: "t",
          turn: turn([shell("starting"), result, wake]),
          arm: null,
          nowEpochMs: 5,
        }),
      ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
    }
  });

  it("hard-stops on the second press inside the confirmation window", () => {
    const arm = { threadId: "t", turnId: "agt-1-t1", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm,
        nowEpochMs: 100 + AGENT_STOP_CONFIRMATION_WINDOW_MS - 1,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("a stale arm from a previous turn never hard-stops a new turn", () => {
    const arm = { threadId: "t", turnId: "agt-1-t0", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result], "agt-1-t1"),
        arm,
        nowEpochMs: 200,
      }),
    ).toEqual({ kind: "confirmBackground", turnId: "agt-1-t1", liveTaskCount: 1 });
  });

  it("an expired arm asks again instead of stopping", () => {
    const arm = { threadId: "t", turnId: "agt-1-t1", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm,
        nowEpochMs: 100 + AGENT_STOP_CONFIRMATION_WINDOW_MS,
      }).kind,
    ).toBe("confirmBackground");
  });
});

describe("agentStopArmIsLive", () => {
  it("rejects another thread, a future arm and a missing arm", () => {
    const arm = { threadId: "t", turnId: "x", armedAtEpochMs: 100 };
    expect(agentStopArmIsLive(arm, "other", "x", 150)).toBe(false);
    expect(agentStopArmIsLive(arm, "t", "x", 50)).toBe(false);
    expect(agentStopArmIsLive(null, "t", "x", 150)).toBe(false);
    expect(agentStopArmIsLive(arm, "t", "x", 150)).toBe(true);
  });
});
