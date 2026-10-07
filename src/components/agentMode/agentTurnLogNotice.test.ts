import { describe, expect, it } from "vitest";
import type { AgentTurnLogFacts } from "../../application/agentTurnLogStatusStore";
import type { AgentTurnLogLoss } from "../../domain/agentTurnLog";
import {
  AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE,
  AGENT_TURN_REMOTE_DISCARDED_NOTICE,
  AGENT_TURN_REMOTE_WINDOW_NOTICE,
  AGENT_TURN_WINDOW_NOTICE,
  agentTurnLogLossNotice,
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
    promptInLog: false,
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

  it("leaves the saved-but-not-shown case to the load control when a reader exists", () => {
    const partial = facts({ hydration: "partial" });
    expect(agentTurnLossNotice(partial, true)).toBe(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
    expect(agentTurnLossNotice(partial, true, { readerAvailable: true })).toBeNull();
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

  it("hides the legacy window notice for a turn whose document holds every event", () => {
    const stamped = facts({ loss: { kind: "legacyWindow" }, hydration: "notAttempted" });
    expect(agentTurnLossNotice(stamped, false)).toBeNull();
    expect(agentTurnLossNotice(stamped, true)).toBe(
      "Part of this turn ran before full transcripts were kept, so some activity is gone.",
    );
  });

  it("keeps every other loss visible on a turn whose document holds every event", () => {
    const wording = (loss: AgentTurnLogLoss) => agentTurnLossNotice(facts({ loss }), false);
    expect(wording({ kind: "supervisorGap" })).not.toBeNull();
    expect(wording({ kind: "backgroundBuffer" })).not.toBeNull();
    expect(wording({ kind: "writeFailure" })).not.toBeNull();
    expect(wording({ kind: "turnCeiling" })).not.toBeNull();
    expect(wording({ kind: "unreadable" })).not.toBeNull();
    expect(wording({ kind: "diskBudget", atEpochMs: 1 })).not.toBeNull();
  });

  it("words every real loss kind", () => {
    const wording = (loss: AgentTurnLogLoss) => agentTurnLossNotice(facts({ loss }), true);
    expect(wording({ kind: "legacyWindow" })).toBe(
      "Part of this turn ran before full transcripts were kept, so some activity is gone.",
    );
    expect(wording({ kind: "supervisorGap" })).toBe(
      "Part of this turn's activity did not reach the saved transcript and is not shown.",
    );
    expect(wording({ kind: "backgroundBuffer" })).toBe(
      "This turn started without a prompt and only part of its activity was kept, so some of it is not shown.",
    );
    expect(wording({ kind: "writeFailure" })).toBe(
      "This turn's activity was not completely saved, so some of it may not be shown.",
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

  it("gives each cause of missing activity its own sentence", () => {
    const sentences = (
      [
        { kind: "legacyWindow" },
        { kind: "backgroundBuffer" },
        { kind: "supervisorGap" },
        { kind: "writeFailure" },
        { kind: "turnCeiling" },
        { kind: "unreadable" },
        { kind: "diskBudget", atEpochMs: 1 },
      ] as const
    ).map((loss) => agentTurnLogLossNotice(loss));
    expect(agentTurnLogLossNotice({ kind: "none" })).toBeNull();
    expect(sentences.every((sentence) => sentence !== null)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(agentTurnLogLossNotice({ kind: "backgroundBuffer" })).not.toContain("saved");
    expect(agentTurnLogLossNotice({ kind: "supervisorGap" })).not.toContain("agent process");
    expect(agentTurnLogLossNotice({ kind: "writeFailure" })).not.toContain("disk");
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

  it("tells a remote client window apart from output the server discarded", () => {
    expect(agentTurnLossNotice(null, true, { retention: "clientWindow" })).toBe(
      AGENT_TURN_REMOTE_WINDOW_NOTICE,
    );
    expect(AGENT_TURN_REMOTE_WINDOW_NOTICE).toBe(
      "Some activity from this turn is still on the server and not shown here.",
    );
    expect(agentTurnLossNotice(null, true, { retention: "serverGap" })).toBe(
      AGENT_TURN_REMOTE_DISCARDED_NOTICE,
    );
    expect(AGENT_TURN_REMOTE_DISCARDED_NOTICE).toBe(
      "Some activity from this turn was discarded by the server and is not shown.",
    );
    expect(agentTurnLossNotice(null, false, { retention: "serverGap" })).toBeNull();
    expect(agentTurnLogNoticeModel(null, true, { retention: "clientWindow" }).loss).toBe(
      AGENT_TURN_REMOTE_WINDOW_NOTICE,
    );
  });

  it("keeps the local wording when no remote provenance is given", () => {
    expect(agentTurnLossNotice(null, true, {})).toBe(AGENT_TURN_WINDOW_NOTICE);
    expect(AGENT_TURN_WINDOW_NOTICE).toBe("Some activity from this turn is not shown.");
  });
});
