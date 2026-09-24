import { describe, expect, it } from "vitest";
import {
  agentDiffScopeActiveTurnId,
  agentDiffScopeLabel,
  agentDiffScopesEqual,
  agentDiffTurnOptions,
  resolveAgentDiffScope,
} from "./agentDiffScope";

const turns = [
  { turnId: "t1", endedAtEpochMs: 1_000 },
  { turnId: "t2", endedAtEpochMs: 2_000 },
  { turnId: "t3", endedAtEpochMs: null },
];

describe("agent diff scope", () => {
  it("offers finished turns newest first with their 1-based position", () => {
    expect(agentDiffTurnOptions(turns)).toEqual([
      { turnId: "t2", label: "Turn 2", endedAtEpochMs: 2_000 },
      { turnId: "t1", label: "Turn 1", endedAtEpochMs: 1_000 },
    ]);
  });

  it("resolves the latest turn to the newest finished turn", () => {
    expect(resolveAgentDiffScope({ kind: "latestTurn" }, turns)).toEqual({
      kind: "turn",
      turnId: "t2",
      label: "Turn 2",
    });
    expect(resolveAgentDiffScope({ kind: "latestTurn" }, [])).toEqual({ kind: "noTurns" });
  });

  it("labels every scope for the toolbar", () => {
    expect(agentDiffScopeLabel({ kind: "latestTurn" }, turns)).toBe("Latest turn");
    expect(agentDiffScopeLabel({ kind: "turn", turnId: "t1" }, turns)).toBe("Turn 1");
    expect(agentDiffScopeLabel({ kind: "workingTree" }, turns)).toBe("Working tree");
    expect(agentDiffScopeLabel({ kind: "branch", baseRef: "main" }, turns)).toBe("Branch changes");
  });

  it("reports the active turn only for turn scopes", () => {
    expect(agentDiffScopeActiveTurnId({ kind: "latestTurn" }, turns)).toBe("t2");
    expect(agentDiffScopeActiveTurnId({ kind: "turn", turnId: "gone" }, turns)).toBeNull();
    expect(agentDiffScopeActiveTurnId({ kind: "workingTree" }, turns)).toBeNull();
  });

  it("compares scopes structurally", () => {
    expect(
      agentDiffScopesEqual(
        { kind: "branch", baseRef: "main" },
        { kind: "branch", baseRef: "main" },
      ),
    ).toBe(true);
    expect(agentDiffScopesEqual({ kind: "turn", turnId: "a" }, { kind: "turn", turnId: "b" })).toBe(
      false,
    );
  });
});
