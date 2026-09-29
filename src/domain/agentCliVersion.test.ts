import { describe, expect, it } from "vitest";
import {
  agentCliBinaryUnavailableMessage,
  compareAgentCliVersions,
  parseAgentCliVersion,
} from "./agentCliVersion";

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

describe("compareAgentCliVersions", () => {
  it("orders numeric segments by value, treating missing segments as zero", () => {
    expect(compareAgentCliVersions("0.157.1", "0.159.0")).toBe(-1);
    expect(compareAgentCliVersions("2.1.284", "2.1.284")).toBe(0);
    expect(compareAgentCliVersions("2.1.285", "2.1.284")).toBe(1);
    expect(compareAgentCliVersions("2.1.9", "2.1.10")).toBe(-1);
    expect(compareAgentCliVersions("1.2", "1.2.0")).toBe(0);
    expect(compareAgentCliVersions("1.2.0.1", "1.2")).toBe(1);
  });

  it("orders a prerelease below its release and compares identifiers like the backend", () => {
    expect(compareAgentCliVersions("0.104.0-alpha.1", "0.104.0")).toBe(-1);
    expect(compareAgentCliVersions("0.104.0", "0.104.0-alpha.1")).toBe(1);
    expect(compareAgentCliVersions("0.104.0-alpha.2", "0.104.0-alpha.10")).toBe(-1);
    expect(compareAgentCliVersions("0.104.0-1", "0.104.0-alpha")).toBe(-1);
    expect(compareAgentCliVersions("0.104.0-beta", "0.104.0-alpha")).toBe(1);
    expect(compareAgentCliVersions("0.104.0-alpha", "0.104.0-alpha.1")).toBe(-1);
    expect(compareAgentCliVersions("0.104.0-alpha.01", "0.104.0-alpha.1")).toBe(0);
  });

  it("fails closed with null when either side is not a canonical version", () => {
    expect(compareAgentCliVersions("v2.1", "2.1.0")).toBeNull();
    expect(compareAgentCliVersions("2.1.0", " 2.1.0 ")).toBeNull();
    expect(compareAgentCliVersions("2.1.0", null)).toBeNull();
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
      "compareAgentCliVersions",
      "parseAgentCliVersion",
    ]);
  });
});
