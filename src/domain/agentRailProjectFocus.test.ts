import { describe, expect, it } from "vitest";
import { parseAgentRailProjectFocus } from "./agentRailProjectFocus";

describe("parseAgentRailProjectFocus", () => {
  it("accepts only the two known modes and falls back to all projects", () => {
    expect(parseAgentRailProjectFocus("active")).toBe("active");
    expect(parseAgentRailProjectFocus("all")).toBe("all");
    expect(parseAgentRailProjectFocus(null)).toBe("all");
    expect(parseAgentRailProjectFocus("")).toBe("all");
    expect(parseAgentRailProjectFocus("project:/workspace/app")).toBe("all");
    expect(parseAgentRailProjectFocus(" active")).toBe("all");
  });
});
