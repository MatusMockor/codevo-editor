import { describe, expect, it } from "vitest";
import {
  AGENT_PROJECT_BADGE_TONES,
  agentProjectBadgeMonogram,
  agentProjectBadgeTone,
} from "./agentProjectMonogram";

describe("agentProjectBadgeMonogram", () => {
  it("derives two glyphs the way t3code does", () => {
    expect(agentProjectBadgeMonogram("codevo-editor")).toBe("CE");
    expect(agentProjectBadgeMonogram("app")).toBe("AP");
    expect(agentProjectBadgeMonogram("web3")).toBe("W3");
    expect(agentProjectBadgeMonogram("x")).toBe("XX");
    expect(agentProjectBadgeMonogram("  über api ")).toBe("ÜA");
  });

  it("falls back to PR without letters or digits", () => {
    expect(agentProjectBadgeMonogram("")).toBe("PR");
    expect(agentProjectBadgeMonogram("---")).toBe("PR");
  });
});

describe("agentProjectBadgeTone", () => {
  it("gives a project the same bounded tone every time, independent of case and spacing", () => {
    const tone = agentProjectBadgeTone("playablemaker");
    expect(tone).toBeGreaterThanOrEqual(0);
    expect(tone).toBeLessThan(AGENT_PROJECT_BADGE_TONES);
    expect(agentProjectBadgeTone(" PlayableMaker ")).toBe(tone);
    const tones = new Set(
      ["editor", "ebox-crm", "playablemaker", "code-review", "api", "docs"].map(
        agentProjectBadgeTone,
      ),
    );
    expect(tones.size).toBeGreaterThan(1);
  });

  it("matches t3code's monograms for the owner's projects", () => {
    expect(agentProjectBadgeMonogram("playablemaker")).toBe("PR");
    expect(agentProjectBadgeMonogram("code-review")).toBe("CR");
  });
});
