import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { AGENT_TURN_UNTIMED, agentTurnTiming } from "./agentTurnHeadPresentation";

const STARTED = 1_700_000_000_000;

function turn(status: AgentTurnStatus, endedAtEpochMs: number | null): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt: "prompt",
    status,
    startedAtEpochMs: STARTED,
    endedAtEpochMs,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

describe("agentTurnTiming", () => {
  it("counts from the start while the turn is pending or running", () => {
    expect(agentTurnTiming(turn({ kind: "pending" }, null))).toEqual({
      kind: "running",
      startedAtEpochMs: STARTED,
    });
    expect(agentTurnTiming(turn({ kind: "running" }, null))).toEqual({
      kind: "running",
      startedAtEpochMs: STARTED,
    });
  });

  it("ignores a stale end time while the turn is still running", () => {
    expect(agentTurnTiming(turn({ kind: "running" }, STARTED + 5_000))).toEqual({
      kind: "running",
      startedAtEpochMs: STARTED,
    });
  });

  it("reports the elapsed span once the turn has settled", () => {
    expect(agentTurnTiming(turn({ kind: "exited", exitCode: 0 }, STARTED + 41_000))).toEqual({
      kind: "elapsed",
      elapsedMs: 41_000,
    });
    expect(agentTurnTiming(turn({ kind: "failed", message: "boom" }, STARTED + 1))).toEqual({
      kind: "elapsed",
      elapsedMs: 1,
    });
  });

  it("stays untimed when a settled turn never recorded an end", () => {
    expect(agentTurnTiming(turn({ kind: "interrupted" }, null))).toBe(AGENT_TURN_UNTIMED);
    expect(agentTurnTiming(turn({ kind: "exited", exitCode: 0 }, null))).toBe(AGENT_TURN_UNTIMED);
  });

  it("stays untimed rather than reporting a negative span when the clock went backwards", () => {
    expect(agentTurnTiming(turn({ kind: "exited", exitCode: 0 }, STARTED - 1))).toBe(
      AGENT_TURN_UNTIMED,
    );
  });
});
