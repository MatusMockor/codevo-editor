import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "./agentThread";
import { attributeClaudeTurnCosts, type ClaudeTurnCost } from "./claudeTurnCostAttribution";

describe("attributeClaudeTurnCosts", () => {
  it("attributes process-local deltas from one long-lived Claude process", () => {
    const costs = attributeClaudeTurnCosts([turn(reading(0.5)), turn(reading(0.25))], false);

    expectCosts(costs, [0.5, 0.25]);
  });

  it("reduces the session total Claude restores on resume to the resumed turn's share", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(0.5)), turn(reading(0.25)), turn(reading(1.15)), turn(reading(0.1))],
      false,
    );

    expectCosts(costs, [0.5, 0.25, 0.4, 0.1]);
  });

  it("turns cumulative readings from one-process-per-turn history into per-turn costs", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(1_055.9)), turn(reading(1_185.3)), turn(reading(1_212.8))],
      false,
    );

    expectCosts(costs, [1_055.9, 129.4, 27.5]);
  });

  it("keeps the attributed total equal to the session's latest total when readings are ambiguous", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(0.6)), turn(reading(2.1)), turn(reading(0.17)), turn(reading(3.84))],
      false,
    );

    expect(sumOf(costs)).toBeCloseTo(3.84, 9);
  });

  it("fails closed while earlier session spend is unknown instead of summing a restored total", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(40)), turn(reading(2)), turn(reading(3)), turn(reading(1_951.78))],
      true,
    );

    expectCosts(costs, [null, 2, 3, null]);
  });

  it("resynchronises on a zero-token result that only reports the restored session total", () => {
    const costs = attributeClaudeTurnCosts(
      [
        turn(reading(7.19)),
        turn(reading(20.5)),
        turn(reading(2_437.14, 0, 0)),
        turn(reading(1.5)),
        turn(reading(2_469.9)),
        turn(reading(0)),
      ],
      true,
    );

    expectCosts(costs, [null, null, 0, 1.5, 31.26, 0]);
  });

  it("sums several results in one turn and fails the whole turn closed when one is unknown", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(10)), turn([reading(1), reading(2)]), turn([reading(3), reading(500)])],
      true,
    );

    expectCosts(costs, [null, 3, null]);
  });

  it("marks a share taken from a restored session total as inferred", () => {
    const costs = attributeClaudeTurnCosts(
      [turn(reading(0.5)), turn(reading(0.25)), turn(reading(1.15)), turn(reading(0.1))],
      false,
    );

    expect(costs.map((cost) => cost.kind === "attributed" && cost.inferred)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("never attributes a negative cost when a reading sits just below the session total", () => {
    const costs = attributeClaudeTurnCosts([turn(reading(1)), turn(reading(1 - 5e-7))], false);

    expectCosts(costs, [1, 0]);
  });

  it("starts a new session counter after Claude lost the session, so its totals are not deltas", () => {
    const lost: AgentTurnEvent = {
      kind: "error",
      message: "No conversation found with session ID: 0f3c",
    };
    const costs = attributeClaudeTurnCosts(
      [
        turn(reading(10)),
        turn(lost, FAILED_EXIT),
        turn(reading(0.5)),
        turn(reading(0.7)),
        turn(reading(1.5)),
      ],
      false,
    );

    expect(costs[1]).toEqual(UNREPORTED);
    expect(sumOf(costs.slice(2))).toBeCloseTo(1.5, 9);
    expect(sumOf(costs)).toBeCloseTo(11.5, 9);
  });

  it("keeps the session counter when the lost-session text appears without a failed resume", () => {
    const marker: AgentTurnEvent = {
      kind: "error",
      message: "No conversation found with session ID: 0f3c",
    };
    const result: AgentTurnEvent = { kind: "result", text: "", isError: false, usage: null };
    const variants: ReadonlyArray<AgentTurn> = [
      turn(marker),
      turn(marker, { kind: "stopped" }),
      turn([marker, result], FAILED_EXIT),
    ];

    for (const candidate of variants) {
      const costs = attributeClaudeTurnCosts(
        [turn(reading(10)), candidate, turn(reading(0.5)), turn(reading(10.7))],
        false,
      );

      expect(sumOf(costs)).toBeCloseTo(10.7, 9);
    }
  });

  it("reports turns without a cost reading and ignores results without usage", () => {
    const withoutUsage: AgentTurnEvent = { kind: "result", text: "", isError: false, usage: null };
    const withoutCost: AgentTurnEvent = {
      kind: "result",
      text: "",
      isError: false,
      usage: { inputTokens: 3, outputTokens: 1, contextTokens: 3 },
    };

    const costs = attributeClaudeTurnCosts(
      [turn([]), turn(withoutUsage), turn(withoutCost), turn(reading(1))],
      false,
    );

    expect(costs.slice(0, 3)).toEqual([UNREPORTED, UNREPORTED, UNREPORTED]);
    expectCosts(costs.slice(3), [1]);
  });
});

const UNREPORTED: ClaudeTurnCost = { kind: "unreported" };

function expectCosts(
  costs: ReadonlyArray<ClaudeTurnCost>,
  expected: ReadonlyArray<number | null>,
): void {
  expect(costs).toHaveLength(expected.length);
  costs.forEach((cost, index) => {
    const want = expected[index];
    if (want === null) {
      expect(cost, `turn ${index}`).toEqual({ kind: "unattributable" });
      return;
    }
    expect(cost.kind, `turn ${index}`).toBe("attributed");
    expect(cost.kind === "attributed" ? cost.costUsd : Number.NaN).toBeCloseTo(want, 9);
  });
}

function sumOf(costs: ReadonlyArray<ClaudeTurnCost>): number {
  return costs.reduce((sum, cost) => sum + (cost.kind === "attributed" ? cost.costUsd : 0), 0);
}

function reading(costUsd: number, inputTokens = 1_000, outputTokens = 100): AgentTurnEvent {
  return {
    kind: "result",
    text: "",
    isError: false,
    usage: { inputTokens, outputTokens, contextTokens: inputTokens, costUsd },
  };
}

let sequence = 0;

const FAILED_EXIT: AgentTurn["status"] = { kind: "exited", exitCode: 1 };

function turn(
  events: AgentTurnEvent | ReadonlyArray<AgentTurnEvent>,
  status: AgentTurn["status"] = { kind: "exited", exitCode: 0 },
): AgentTurn {
  sequence += 1;
  return {
    turnId: `turn-${sequence}`,
    prompt: "prompt",
    status,
    startedAtEpochMs: sequence,
    endedAtEpochMs: sequence + 1,
    events: Array.isArray(events) ? events : [events],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
}
