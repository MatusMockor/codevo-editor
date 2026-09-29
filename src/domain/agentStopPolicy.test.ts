import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "./agentThread";
import {
  AGENT_INTERRUPT_SETTLE_DEADLINE_MS,
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  agentInterruptingDeadlineEpochMs,
  agentStopDeadlineRemainingMs,
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
    expect(
      decideAgentStop({
        threadId: "t",
        turn: null,
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: false,
        interruptedTurnId: null,
      }),
    ).toEqual({
      kind: "ignore",
    });
  });

  it("hard-stops while the foreground is still running", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: false,
        interruptedTurnId: null,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("hard-stops when the foreground settled and no background work is live", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), shell("completed"), result]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: false,
        interruptedTurnId: null,
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
        interruptAvailable: false,
        interruptedTurnId: null,
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
        interruptAvailable: false,
        interruptedTurnId: null,
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
          interruptAvailable: false,
          interruptedTurnId: null,
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
        interruptAvailable: false,
        interruptedTurnId: null,
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
        interruptAvailable: false,
        interruptedTurnId: null,
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
        interruptAvailable: false,
        interruptedTurnId: null,
      }).kind,
    ).toBe("confirmBackground");
  });
});

describe("decideAgentStop with an interruptible session", () => {
  it("interrupts a running foreground first", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: null,
      }),
    ).toEqual({ kind: "interrupt", turnId: "agt-1-t1" });
  });

  it("hard-stops once this turn was already interrupted", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: "agt-1-t1",
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("still asks before ending background-only work", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: null,
      }).kind,
    ).toBe("confirmBackground");
  });

  it("a previous turn's interrupt never hard-stops a new turn", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant], "agt-1-t2"),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: "agt-1-t1",
      }),
    ).toEqual({ kind: "interrupt", turnId: "agt-1-t2" });
  });

  it("hard-stops a live background turn that was already interrupted", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: "agt-1-t1",
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("hard-stops a running foreground when the runtime cannot interrupt", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: false,
        interruptedTurnId: null,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
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

describe("agent stop deadlines", () => {
  it("bounds the interrupting state by the backend settle deadline from the request", () => {
    expect(agentInterruptingDeadlineEpochMs(5_000)).toBe(
      5_000 + AGENT_INTERRUPT_SETTLE_DEADLINE_MS,
    );
  });

  it("counts down to zero and fails closed when the clock moved backwards", () => {
    expect(agentStopDeadlineRemainingMs(12_000, 10_000)).toBe(2_000);
    expect(agentStopDeadlineRemainingMs(12_000, 12_000)).toBe(0);
    expect(agentStopDeadlineRemainingMs(12_000, 13_000)).toBe(0);
    expect(
      agentStopDeadlineRemainingMs(
        12_000,
        12_000 - AGENT_STOP_CONFIRMATION_WINDOW_MS - AGENT_INTERRUPT_SETTLE_DEADLINE_MS - 1,
      ),
    ).toBe(0);
  });
});
