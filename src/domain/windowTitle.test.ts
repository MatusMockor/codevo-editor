import { describe, expect, it } from "vitest";
import { formatAgentModeWindowTitle } from "./windowTitle";

describe("formatAgentModeWindowTitle", () => {
  it.each([
    { workspaceName: "/projects/myproject", expected: "Agents - myproject" },
    { workspaceName: "/projects/myproject/", expected: "Agents - myproject" },
    { workspaceName: "C:\\projects\\myproject\\", expected: "Agents - myproject" },
    { workspaceName: "/projects/myproject//", expected: "Agents - myproject" },
    { workspaceName: null, expected: "Agents" },
    { workspaceName: "", expected: "Agents" },
  ])("formats $expected for $workspaceName", ({ workspaceName, expected }) => {
    expect(formatAgentModeWindowTitle(workspaceName)).toBe(expected);
  });

  it("never names an active file or a dirty marker", () => {
    const title = formatAgentModeWindowTitle("/projects/myproject");

    expect(title).not.toContain("•");
    expect(title).not.toContain("Codevo");
  });
});
