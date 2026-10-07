import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-turn-log-wire.json";
import {
  NO_AGENT_TURN_LOG_LOSS,
  agentTurnLogLossSeverity,
  mergeAgentTurnLogLoss,
  type AgentTurnLogLoss,
  type AgentTurnLogLossKind,
} from "./agentTurnLog";
import {
  agentTurnContentLost,
  agentTurnLogProvablyComplete,
  agentTurnWindowDisplay,
  type AgentTurnLogEvidence,
} from "./agentTurnContentLoss";

const PRECEDENCE: ReadonlyArray<AgentTurnLogLossKind> = [
  "none",
  "legacyWindow",
  "backgroundBuffer",
  "supervisorGap",
  "writeFailure",
  "turnCeiling",
  "diskBudget",
  "unreadable",
];

const EVERY_KIND: Readonly<Record<AgentTurnLogLossKind, true>> = {
  none: true,
  legacyWindow: true,
  backgroundBuffer: true,
  supervisorGap: true,
  writeFailure: true,
  turnCeiling: true,
  diskBudget: true,
  unreadable: true,
};

function lossOf(kind: AgentTurnLogLossKind, atEpochMs = 1): AgentTurnLogLoss {
  if (kind === "diskBudget") return { kind, atEpochMs };
  return { kind };
}

function evidence(loss: AgentTurnLogLoss): AgentTurnLogEvidence {
  return { loss, sealed: true, live: false, hydration: "complete" };
}

describe("agent turn log loss precedence", () => {
  it("pins the exact kind strings and their order shared with the Rust store", () => {
    expect(wire.lossPrecedence).toEqual(PRECEDENCE);
    expect([...PRECEDENCE].sort()).toEqual(Object.keys(EVERY_KIND).sort());
    expect(wire.losses.map((loss) => loss.kind).sort()).toEqual([...PRECEDENCE].sort());
  });

  it("ranks every kind strictly above the one before it", () => {
    expect(PRECEDENCE.map(agentTurnLogLossSeverity)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the more severe loss for every pair of kinds, in either order", () => {
    for (const current of PRECEDENCE) {
      for (const next of PRECEDENCE) {
        const expected = PRECEDENCE.indexOf(next) > PRECEDENCE.indexOf(current) ? next : current;
        expect(mergeAgentTurnLogLoss(lossOf(current), lossOf(next)).kind).toBe(expected);
      }
    }
  });

  it("keeps the earlier report when two losses are equally severe", () => {
    const earlier = lossOf("diskBudget", 10);
    const later = lossOf("diskBudget", 20);
    expect(mergeAgentTurnLogLoss(earlier, later)).toBe(earlier);
    expect(mergeAgentTurnLogLoss(later, earlier)).toBe(later);
  });

  it("never lets a milder or absent loss replace a recorded one", () => {
    const failure = lossOf("writeFailure");
    expect(mergeAgentTurnLogLoss(failure, NO_AGENT_TURN_LOG_LOSS)).toBe(failure);
    expect(mergeAgentTurnLogLoss(failure, lossOf("supervisorGap"))).toBe(failure);
    expect(mergeAgentTurnLogLoss(failure, lossOf("backgroundBuffer"))).toBe(failure);
    expect(mergeAgentTurnLogLoss(lossOf("supervisorGap"), lossOf("backgroundBuffer")).kind).toBe(
      "supervisorGap",
    );
    expect(mergeAgentTurnLogLoss(lossOf("backgroundBuffer"), lossOf("legacyWindow")).kind).toBe(
      "backgroundBuffer",
    );
  });

  it("never merges an always visible loss into one that can be hidden", () => {
    for (const current of PRECEDENCE) {
      for (const next of PRECEDENCE) {
        const merged = evidence(mergeAgentTurnLogLoss(lossOf(current), lossOf(next)));
        const either =
          agentTurnContentLost(false, evidence(lossOf(current))) ||
          agentTurnContentLost(false, evidence(lossOf(next)));
        expect(agentTurnContentLost(false, merged)).toBe(either);
      }
    }
  });
});

describe("split loss kinds follow the supervisor gap in every safety decision", () => {
  const gap = evidence({ kind: "supervisorGap" });

  it.each([{ kind: "backgroundBuffer" }, { kind: "writeFailure" }] as const)(
    "treats $kind exactly like a supervisor gap",
    (loss) => {
      for (const eventsTruncated of [true, false]) {
        for (const sealed of [true, false]) {
          for (const live of [true, false]) {
            for (const hydration of ["notAttempted", "partial", "complete", "failed"] as const) {
              const subject = { loss, sealed, live, hydration };
              const reference = { ...gap, sealed, live, hydration };
              expect(agentTurnLogProvablyComplete(subject)).toBe(false);
              expect(agentTurnLogProvablyComplete(subject)).toBe(
                agentTurnLogProvablyComplete(reference),
              );
              expect(agentTurnContentLost(eventsTruncated, subject)).toBe(true);
              expect(agentTurnContentLost(eventsTruncated, subject)).toBe(
                agentTurnContentLost(eventsTruncated, reference),
              );
              expect(agentTurnWindowDisplay(eventsTruncated, subject)).toBe("lost");
              expect(agentTurnWindowDisplay(eventsTruncated, subject)).toBe(
                agentTurnWindowDisplay(eventsTruncated, reference),
              );
            }
          }
        }
      }
    },
  );
});
