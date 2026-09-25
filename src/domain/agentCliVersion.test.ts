import { describe, expect, it } from "vitest";
import { agentCliBinaryUnavailableMessage, parseAgentCliVersion } from "./agentCliVersion";

describe("parseAgentCliVersion", () => {
  it("accepts bounded canonical version strings", () => {
    expect(parseAgentCliVersion("2.1.245")).toBe("2.1.245");
    expect(parseAgentCliVersion("0.104.0-alpha.1")).toBe("0.104.0-alpha.1");
    expect(parseAgentCliVersion("1.2")).toBe("1.2");
    expect(parseAgentCliVersion("  2.1.245  ")).toBe("2.1.245");
  });

  it("rejects empty, partial, decorated, and oversized values", () => {
    const rejected: readonly unknown[] = [
      "",
      "   ",
      "v2.1",
      "2",
      "2.1.245 (Claude Code)",
      `1.2.3-${"a".repeat(70)}`,
      "1".repeat(70),
      "2.1.245.9.9",
      2.1,
      null,
      undefined,
      {},
    ];

    for (const value of rejected) {
      expect(parseAgentCliVersion(value)).toBeNull();
    }
  });
});

describe("agent CLI version messages", () => {
  it("explains a missing binary for both CLI kinds", () => {
    expect(agentCliBinaryUnavailableMessage("claudeCode")).toBe(
      "The Claude CLI binary is missing or not executable (it may be updating). Retry in a moment.",
    );
    expect(agentCliBinaryUnavailableMessage("codex")).toBe(
      "The Codex CLI binary is missing or not executable (it may be updating). Retry in a moment.",
    );
  });
});

describe("agentCliVersion module surface", () => {
  it("exports only what production code consumes", async () => {
    const module = await import("./agentCliVersion");

    expect(Object.keys(module).sort()).toEqual([
      "agentCliBinaryUnavailableMessage",
      "parseAgentCliVersion",
    ]);
  });
});
