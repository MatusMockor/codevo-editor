import { describe, expect, it } from "vitest";
import type { AgentTurnLogFacts } from "../../application/agentTurnLogStatusStore";
import type { AgentTurnLogLoss } from "../../domain/agentTurnLog";
import {
  AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE,
  AGENT_TURN_WINDOW_NOTICE,
  agentTurnLogNoticeModel,
  agentTurnLossNotice,
  agentTurnUnsavedNotice,
} from "./agentTurnLogNotice";

function facts(overrides: Partial<AgentTurnLogFacts> = {}): AgentTurnLogFacts {
  return {
    turnId: "turn-1",
    logged: true,
    loss: { kind: "none" },
    sealed: true,
    live: false,
    hydration: "complete",
    contextWindow: null,
    health: { kind: "ok" },
    ...overrides,
  };
}

describe("agent turn log notices", () => {
  it("shows nothing once the window was rebuilt from a log that holds the whole turn", () => {
    expect(agentTurnLossNotice(facts(), true)).toBeNull();
    expect(agentTurnLossNotice(facts(), false)).toBeNull();
  });

  it("says the earlier activity is saved but not shown until the window is rebuilt", () => {
    expect(agentTurnLossNotice(facts({ hydration: "notAttempted" }), true)).toBe(
      AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE,
    );
    expect(agentTurnLossNotice(facts({ hydration: "partial" }), true)).toBe(
      AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE,
    );
    expect(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE).toBe(
      "Earlier activity of this turn is saved but not shown here yet.",
    );
  });

  it("tells the JSON truth when an unsealed log of a turn that is not live cannot vouch", () => {
    expect(agentTurnLossNotice(facts({ sealed: false, live: false }), true)).toBe(
      AGENT_TURN_WINDOW_NOTICE,
    );
    expect(
      agentTurnLossNotice(facts({ sealed: false, live: true, hydration: "notAttempted" }), true),
    ).toBe(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
    expect(agentTurnLossNotice(facts({ sealed: false, live: false }), false)).toBeNull();
  });

  it("falls back to the JSON truth when no log fact exists for the turn", () => {
    expect(agentTurnLossNotice(null, true)).toBe(AGENT_TURN_WINDOW_NOTICE);
    expect(agentTurnLossNotice(null, false)).toBeNull();
  });

  it("words every real loss kind", () => {
    const wording = (loss: AgentTurnLogLoss) => agentTurnLossNotice(facts({ loss }), true);
    expect(wording({ kind: "legacyWindow" })).toBe(
      "Part of this turn ran before full transcripts were kept, so some activity is gone.",
    );
    expect(wording({ kind: "supervisorGap" })).toBe(
      "Some activity from this turn was too large to record and is not shown.",
    );
    expect(wording({ kind: "turnCeiling" })).toBe(
      "This turn reached its recording limit, so later activity was not saved.",
    );
    expect(wording({ kind: "unreadable" })).toBe(
      "The saved activity for this turn could not be read, so some of it is not shown.",
    );
    expect(wording({ kind: "diskBudget", atEpochMs: 5 })).toBe(
      "Older activity from this turn was removed to free disk space.",
    );
  });

  it("adds one bounded line when the writer is not saving to disk", () => {
    expect(agentTurnUnsavedNotice(facts())).toBeNull();
    expect(agentTurnUnsavedNotice(null)).toBeNull();
    expect(
      agentTurnUnsavedNotice(facts({ health: { kind: "degraded", reason: "the disk is full" } })),
    ).toBe("Activity is not being saved to disk: the disk is full.");
  });

  it("combines the loss and the writer line into one model", () => {
    expect(
      agentTurnLogNoticeModel(
        facts({
          loss: { kind: "turnCeiling" },
          health: { kind: "degraded", reason: "the log could not be written" },
        }),
        true,
      ),
    ).toEqual({
      loss: "This turn reached its recording limit, so later activity was not saved.",
      unsaved: "Activity is not being saved to disk: the log could not be written.",
    });
  });
});
