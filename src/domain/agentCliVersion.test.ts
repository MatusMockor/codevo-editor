import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PATH_BYTES } from "./agentTask";
import {
  agentCliBinaryUnavailableMessage,
  agentCliVersionChangeMessage,
  agentCliVersionLabel,
  compareAgentCliVersions,
  parseAgentCliVersion,
  parseAgentCliVersionProbeResult,
  validateAgentCliVersionProbeRequest,
  type AgentCliVersionProbeRequest,
} from "./agentCliVersion";

const PROBE_RESULT = {
  version: "2.1.245",
  probedAtEpochMs: 1_700_000_000_000,
  binaryFingerprint: { sizeBytes: 1_024, modifiedEpochMs: 1_699_000_000_000 },
} as const;

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
  it("classifies same, changed, and unknown pairs", () => {
    expect(compareAgentCliVersions("2.1.245", "2.1.245")).toBe("same");
    expect(compareAgentCliVersions("2.1.245", "2.1.250")).toBe("changed");
    expect(compareAgentCliVersions(null, "2.1.245")).toBe("unknown");
    expect(compareAgentCliVersions("2.1.245", null)).toBe("unknown");
    expect(compareAgentCliVersions(null, null)).toBe("unknown");
  });
});

describe("agent CLI version messages", () => {
  it("labels a known version per CLI kind and drops an unknown one", () => {
    expect(agentCliVersionLabel("claudeCode", "2.1.245")).toBe("claude 2.1.245");
    expect(agentCliVersionLabel("codex", "0.104.0-alpha.1")).toBe("codex 0.104.0-alpha.1");
    expect(agentCliVersionLabel("claudeCode", null)).toBeNull();
    expect(agentCliVersionLabel("codex", null)).toBeNull();
  });

  it("announces an upgrade with the product label", () => {
    expect(agentCliVersionChangeMessage("claudeCode", "2.1.245", "2.1.250")).toBe(
      "Claude CLI updated 2.1.245 → 2.1.250. Turns now run on the new version.",
    );
    expect(agentCliVersionChangeMessage("codex", "0.104.0", "0.105.0")).toBe(
      "Codex CLI updated 0.104.0 → 0.105.0. Turns now run on the new version.",
    );
  });

  it("explains a missing binary for both CLI kinds", () => {
    expect(agentCliBinaryUnavailableMessage("claudeCode")).toBe(
      "The Claude CLI binary is missing or not executable (it may be updating). Retry in a moment.",
    );
    expect(agentCliBinaryUnavailableMessage("codex")).toBe(
      "The Codex CLI binary is missing or not executable (it may be updating). Retry in a moment.",
    );
  });
});

describe("validateAgentCliVersionProbeRequest", () => {
  it("returns a closed request for an absolute path and a known kind", () => {
    expect(
      validateAgentCliVersionProbeRequest({
        agentCliPath: "/usr/local/bin/claude",
        agentCliKind: "claudeCode",
      }),
    ).toEqual({ agentCliPath: "/usr/local/bin/claude", agentCliKind: "claudeCode" });
    expect(
      validateAgentCliVersionProbeRequest({
        agentCliPath: "C:\\Program Files\\codex\\codex.exe",
        agentCliKind: "codex",
      }),
    ).toEqual({ agentCliPath: "C:\\Program Files\\codex\\codex.exe", agentCliKind: "codex" });
  });

  it("rejects extra keys, relative paths, unknown kinds, and oversized paths", () => {
    const rejected: readonly unknown[] = [
      null,
      [],
      {},
      { agentCliPath: "/usr/local/bin/claude" },
      { agentCliKind: "claudeCode" },
      { agentCliPath: "/usr/local/bin/claude", agentCliKind: "claudeCode", extra: true },
      { agentCliPath: "bin/claude", agentCliKind: "claudeCode" },
      { agentCliPath: "./claude", agentCliKind: "claudeCode" },
      { agentCliPath: "", agentCliKind: "claudeCode" },
      { agentCliPath: 1, agentCliKind: "claudeCode" },
      { agentCliPath: `/${"a".repeat(MAX_AGENT_TASK_PATH_BYTES)}`, agentCliKind: "claudeCode" },
      { agentCliPath: "/usr/local/bin/gemini", agentCliKind: "gemini" },
      { agentCliPath: "/usr/local/bin/claude", agentCliKind: null },
    ];

    for (const request of rejected) {
      expect(() =>
        validateAgentCliVersionProbeRequest(request as AgentCliVersionProbeRequest),
      ).toThrow(TypeError);
    }
  });
});

describe("parseAgentCliVersionProbeResult", () => {
  it("accepts a probe that could not read a version", () => {
    const wire = { ...PROBE_RESULT, version: null };

    expect(parseAgentCliVersionProbeResult(wire)).toEqual(wire);
  });

  it("accepts a canonical version with a bounded fingerprint", () => {
    expect(parseAgentCliVersionProbeResult(PROBE_RESULT)).toEqual(PROBE_RESULT);
  });

  it("rejects extra keys, negative integers, and non-canonical versions", () => {
    const rejected: readonly unknown[] = [
      null,
      [],
      {},
      { ...PROBE_RESULT, extra: true },
      { version: "2.1.245", probedAtEpochMs: 1 },
      { ...PROBE_RESULT, probedAtEpochMs: -1 },
      { ...PROBE_RESULT, probedAtEpochMs: 1.5 },
      { ...PROBE_RESULT, binaryFingerprint: { sizeBytes: -1, modifiedEpochMs: 1 } },
      { ...PROBE_RESULT, binaryFingerprint: { sizeBytes: 1, modifiedEpochMs: -1 } },
      { ...PROBE_RESULT, binaryFingerprint: { sizeBytes: 1, modifiedEpochMs: 1, extra: 1 } },
      { ...PROBE_RESULT, binaryFingerprint: null },
      { ...PROBE_RESULT, version: " 2.1.245" },
      { ...PROBE_RESULT, version: "2.1.245 " },
      { ...PROBE_RESULT, version: "garbage" },
      { ...PROBE_RESULT, version: 2 },
    ];

    for (const value of rejected) {
      expect(() => parseAgentCliVersionProbeResult(value)).toThrow(TypeError);
    }
  });
});
