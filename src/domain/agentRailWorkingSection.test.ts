import { describe, expect, it } from "vitest";
import { WORKING_SECTION_OFF, parseAgentRailWorkingSection } from "./agentRailWorkingSection";

describe("parseAgentRailWorkingSection", () => {
  it("accepts only the two known modes", () => {
    expect(parseAgentRailWorkingSection("on")).toBe("on");
    expect(parseAgentRailWorkingSection("off")).toBe("off");
  });

  it("defaults to off when nothing is stored", () => {
    expect(WORKING_SECTION_OFF).toBe("off");
    expect(parseAgentRailWorkingSection(null)).toBe("off");
    expect(parseAgentRailWorkingSection("")).toBe("off");
  });

  it("rejects garbage instead of guessing", () => {
    for (const raw of [" on", "on ", "ON", "On", "true", "1", "enabled", '"on"', "on\n", "{}"]) {
      expect(parseAgentRailWorkingSection(raw)).toBe("off");
    }
  });
});
