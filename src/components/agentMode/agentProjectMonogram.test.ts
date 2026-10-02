import { describe, expect, it } from "vitest";
import { agentProjectBadgeMonogram } from "./agentProjectMonogram";

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
