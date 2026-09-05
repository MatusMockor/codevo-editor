import { describe, expect, it } from "vitest";
import { isAgentRawOutputNoise } from "./agentRawOutput";

describe("isAgentRawOutputNoise", () => {
  it("drops the Codex stdin notice printed on every piped turn", () => {
    expect(isAgentRawOutputNoise("codex", "stderr", "Reading additional input from stdin...")).toBe(
      true,
    );
  });

  it("keeps the notice when it arrives on stdout", () => {
    expect(isAgentRawOutputNoise("codex", "stdout", "Reading additional input from stdin...")).toBe(
      false,
    );
  });

  it("keeps provider output that is not the known notice", () => {
    expect(isAgentRawOutputNoise("codex", "stderr", "npm warn deprecated")).toBe(false);
    expect(
      isAgentRawOutputNoise("claudeCode", "stderr", "Reading additional input from stdin..."),
    ).toBe(false);
  });
});
