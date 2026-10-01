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

  it("drops informational unsupported Claude frame notices", () => {
    for (const raw of [
      "Unsupported Claude stream frame: command_lifecycle",
      "Unsupported Claude stream frame: brand_new_frame",
      "Unsupported Claude stream frame: command_lifecycle.deferred",
      "Further unsupported Claude stream frame types omitted for this turn",
    ]) {
      expect(isAgentRawOutputNoise("claudeCode", "stdout", raw)).toBe(true);
    }
  });

  it("keeps malformed Claude frames and the same text from other sources", () => {
    for (const raw of [
      "Unsupported Claude stream frame: <missing type>",
      "Unsupported Claude stream frame: <invalid type>",
      "Unsupported Claude stream frame: ",
      "Malformed Claude stream frame: command_lifecycle",
      "Further malformed Claude stream frame types omitted for this turn",
      "Claude API request failed; retry 1/10 in 500ms",
      "{not json",
    ]) {
      expect(isAgentRawOutputNoise("claudeCode", "stdout", raw)).toBe(false);
    }
    const notice = "Unsupported Claude stream frame: command_lifecycle";
    expect(isAgentRawOutputNoise("claudeCode", "stderr", notice)).toBe(false);
    expect(isAgentRawOutputNoise("codex", "stdout", notice)).toBe(false);
  });
});
