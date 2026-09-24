import { describe, expect, it } from "vitest";
import { agentClockTime, agentTurnMetaAgentLabel, agentTurnMetaAt } from "./agentTurnMetaLine";

const EPOCH = Date.UTC(2026, 8, 24, 8, 42, 0);

describe("agentClockTime", () => {
  it("formats a two-digit clock time with a machine-readable instant and a full title", () => {
    const time = agentClockTime(EPOCH, "en-GB");

    expect(time?.label).toMatch(/^\d{2}:\d{2}$/);
    expect(time?.iso).toBe(new Date(EPOCH).toISOString());
    expect(time?.title).toContain("2026");
  });

  it("drops unusable instants instead of throwing", () => {
    expect(agentClockTime(null)).toBeNull();
    expect(agentClockTime(Number.NaN)).toBeNull();
    expect(agentClockTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(agentClockTime(8_640_000_000_000_001)).toBeNull();
  });
});

describe("agentTurnMetaAgentLabel", () => {
  it("names the model when the launch chose one and the provider otherwise", () => {
    expect(agentTurnMetaAgentLabel("claudeCode", null)).toBe("Claude Code");
    expect(agentTurnMetaAgentLabel("codex", null)).toBe("Codex");
  });
});

describe("agentTurnMetaAt", () => {
  it("stamps an answer with its end and a running answer with its start", () => {
    expect(agentTurnMetaAt({ startedAtEpochMs: 10, endedAtEpochMs: 20 })).toBe(20);
    expect(agentTurnMetaAt({ startedAtEpochMs: 10, endedAtEpochMs: null })).toBe(10);
  });
});
