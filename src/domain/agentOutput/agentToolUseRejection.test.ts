import { describe, expect, it } from "vitest";
import { isAgentToolUseRejection } from "./agentToolUseRejection";

describe("isAgentToolUseRejection", () => {
  it("recognizes the Claude CLI rejection tool result of an interrupted tool", () => {
    expect(
      isAgentToolUseRejection(
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
      ),
    ).toBe(true);
    expect(isAgentToolUseRejection("\n The user doesn't want to proceed with this tool use.")).toBe(
      true,
    );
  });

  it("rejects output that only mentions the rejection text", () => {
    expect(
      isAgentToolUseRejection("Exit code 1\nThe user doesn't want to proceed with this tool use."),
    ).toBe(false);
    expect(isAgentToolUseRejection("The user doesn't want to proceed")).toBe(false);
    expect(isAgentToolUseRejection("")).toBe(false);
  });
});
