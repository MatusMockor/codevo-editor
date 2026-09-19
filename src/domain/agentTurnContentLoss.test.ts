import { describe, expect, it } from "vitest";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  agentTurnContentLost,
  agentTurnLogProvablyComplete,
  agentTurnWindowDisplay,
  type AgentTurnLogEvidence,
} from "./agentTurnContentLoss";

function evidence(overrides: Partial<AgentTurnLogEvidence> = {}): AgentTurnLogEvidence {
  return {
    loss: { kind: "none" },
    sealed: true,
    live: false,
    hydration: "notAttempted",
    ...overrides,
  };
}

describe("agentTurnLogProvablyComplete", () => {
  it("trusts a sealed log without loss", () => {
    expect(agentTurnLogProvablyComplete(evidence())).toBe(true);
  });

  it("trusts an unsealed log while its writer is still live in this process", () => {
    expect(agentTurnLogProvablyComplete(evidence({ sealed: false, live: true }))).toBe(true);
  });

  it("refuses an unsealed log of a turn that is no longer live", () => {
    expect(agentTurnLogProvablyComplete(evidence({ sealed: false, live: false }))).toBe(false);
  });

  it("refuses any recorded loss", () => {
    expect(agentTurnLogProvablyComplete(evidence({ loss: { kind: "supervisorGap" } }))).toBe(false);
    expect(agentTurnLogProvablyComplete(evidence({ loss: { kind: "unreadable" } }))).toBe(false);
  });
});

describe("agentTurnContentLost", () => {
  it("falls back to the JSON truth when no log covers the turn", () => {
    expect(agentTurnContentLost(true, null)).toBe(true);
    expect(agentTurnContentLost(false, null)).toBe(false);
    expect(agentTurnContentLost(true, NO_AGENT_TURN_LOG_EVIDENCE("turn"))).toBe(true);
  });

  it("does not call a window truncated turn lost when its log is provably complete", () => {
    expect(agentTurnContentLost(true, evidence())).toBe(false);
  });

  it("calls an untruncated turn lost when its own log recorded a gap", () => {
    expect(agentTurnContentLost(false, evidence({ loss: { kind: "turnCeiling" } }))).toBe(true);
  });

  it("keeps a never truncated turn whose unsealed log was interrupted by a quit", () => {
    const interrupted = evidence({ sealed: false, live: false, hydration: "notAttempted" });
    expect(agentTurnContentLost(false, interrupted)).toBe(false);
    expect(agentTurnWindowDisplay(false, interrupted)).toBe("complete");
  });

  it("calls a never truncated turn lost when its log admits a supervisor gap", () => {
    expect(agentTurnContentLost(false, evidence({ loss: { kind: "supervisorGap" } }))).toBe(true);
  });

  it("still calls a truncated turn lost when its unsealed log is no longer live", () => {
    expect(agentTurnContentLost(true, evidence({ sealed: false, live: false }))).toBe(true);
  });

  it("does not call a truncated turn with a sealed loss free log lost", () => {
    expect(agentTurnContentLost(true, evidence())).toBe(false);
    expect(agentTurnWindowDisplay(true, evidence())).toBe("savedNotShown");
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "complete" }))).toBe("complete");
  });
});

describe("agentTurnWindowDisplay", () => {
  it("is complete when nothing left the window", () => {
    expect(agentTurnWindowDisplay(false, null)).toBe("complete");
    expect(agentTurnWindowDisplay(false, evidence())).toBe("complete");
  });

  it("is complete when the window was rebuilt from the whole log", () => {
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "complete" }))).toBe("complete");
  });

  it("is saved but not shown while the window holds less than the healthy log", () => {
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "notAttempted" }))).toBe(
      "savedNotShown",
    );
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "partial" }))).toBe("savedNotShown");
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "running" }))).toBe("savedNotShown");
  });

  it("is lost when the log cannot vouch for the turn", () => {
    expect(agentTurnWindowDisplay(true, null)).toBe("lost");
    expect(agentTurnWindowDisplay(true, evidence({ sealed: false, live: false }))).toBe("lost");
    expect(agentTurnWindowDisplay(true, evidence({ loss: { kind: "legacyWindow" } }))).toBe("lost");
    expect(agentTurnWindowDisplay(true, evidence({ hydration: "failed" }))).toBe("savedNotShown");
  });
});
