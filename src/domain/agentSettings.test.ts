import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_CLI_KIND,
  DEFAULT_AGENT_ISOLATION_POLICY,
  DEFAULT_MAX_CONCURRENT_AGENT_TASKS,
  MAX_AGENT_CLI_PATH_BYTES,
  MAX_CONCURRENT_AGENT_TASKS_LIMIT,
  MIN_CONCURRENT_AGENT_TASKS_LIMIT,
  activeAgentCliPath,
  agentCliPathValidation,
  defaultAgentAppSettings,
  normalizeAgentAppearanceVariant,
  normalizeAgentCliKind,
  normalizeAgentCliPaths,
  normalizeAgentCliPath,
  normalizeAgentModelFavoriteKeys,
  normalizeAgentModelFavoritesRevision,
  normalizeAgentModelFavoritesSnapshot,
  normalizeAgentIsolationPolicy,
  normalizeMaxConcurrentAgentTasks,
  nextAgentModelFavoritesRevision,
} from "./agentSettings";

describe("defaultAgentAppSettings", () => {
  it("defaults to no configured CLI, Claude Code, and four concurrent tasks", () => {
    expect(defaultAgentAppSettings()).toEqual({
      agentCliPaths: { claudeCode: null, codex: null },
      agentCliKind: "claudeCode",
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      maxConcurrentAgentTasks: 4,
    });
  });

  it("returns a fresh object on every call", () => {
    expect(defaultAgentAppSettings()).not.toBe(defaultAgentAppSettings());
  });

  it("exposes the pinned default constants", () => {
    expect(DEFAULT_AGENT_CLI_KIND).toBe("claudeCode");
    expect(DEFAULT_AGENT_ISOLATION_POLICY).toBe("auto");
    expect(DEFAULT_MAX_CONCURRENT_AGENT_TASKS).toBe(4);
    expect(MIN_CONCURRENT_AGENT_TASKS_LIMIT).toBe(1);
    expect(MAX_CONCURRENT_AGENT_TASKS_LIMIT).toBe(8);
  });
});

describe("normalizeAgentCliPath", () => {
  it("keeps a trimmed absolute path", () => {
    expect(normalizeAgentCliPath("  /usr/local/bin/claude  ")).toBe("/usr/local/bin/claude");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 12],
    ["an object", { path: "/usr/bin/claude" }],
    ["an array", ["/usr/bin/claude"]],
    ["an empty string", ""],
    ["a blank string", "   \t \n "],
  ])("rejects %s as unconfigured", (_label, value) => {
    expect(normalizeAgentCliPath(value)).toBeNull();
  });

  it("rejects a path containing a NUL byte", () => {
    expect(normalizeAgentCliPath("/usr/bin/cla\0ude")).toBeNull();
  });

  it("rejects relative paths before they can reach dispatch or a probe", () => {
    expect(normalizeAgentCliPath("bin/claude")).toBeNull();
    expect(normalizeAgentCliPath("./codex")).toBeNull();
    expect(agentCliPathValidation("bin/claude")).toBe("invalid");
    expect(agentCliPathValidation("C:\\Tools\\codex.exe")).toBe("valid");
  });

  it("accepts a path at the byte cap", () => {
    const path = `/${"a".repeat(MAX_AGENT_CLI_PATH_BYTES - 1)}`;

    expect(normalizeAgentCliPath(path)).toBe(path);
  });

  it("rejects a path above the byte cap", () => {
    expect(normalizeAgentCliPath(`/${"a".repeat(MAX_AGENT_CLI_PATH_BYTES)}`)).toBeNull();
  });

  it("measures the byte cap in UTF-8, not code units", () => {
    const path = "/é".repeat(1_400);

    expect(path.length).toBeLessThan(MAX_AGENT_CLI_PATH_BYTES);
    expect(normalizeAgentCliPath(path)).toBeNull();
  });
});

describe("agent CLI paths", () => {
  it("migrates the single legacy path only to its selected provider", () => {
    expect(normalizeAgentCliPaths(undefined, "/bin/claude", "claudeCode")).toEqual({
      claudeCode: "/bin/claude",
      codex: null,
    });
    expect(normalizeAgentCliPaths(undefined, "/bin/codex", "codex")).toEqual({
      claudeCode: null,
      codex: "/bin/codex",
    });
  });

  it("requires an exact valid two-provider record and fails the pair closed", () => {
    expect(
      normalizeAgentCliPaths(
        { claudeCode: "/bin/claude", codex: "/bin/codex" },
        null,
        "claudeCode",
      ),
    ).toEqual({ claudeCode: "/bin/claude", codex: "/bin/codex" });
    for (const malformed of [
      { claudeCode: "/bin/claude" },
      { claudeCode: "/bin/claude", codex: "/bin/codex", extra: true },
      { claudeCode: "bin/claude", codex: "/bin/codex" },
      { claudeCode: "/bin/claude", codex: 42 },
    ]) {
      expect(normalizeAgentCliPaths(malformed, "/legacy", "claudeCode")).toEqual({
        claudeCode: null,
        codex: null,
      });
    }
  });

  it("selects only the current provider path", () => {
    const paths = { claudeCode: "/bin/claude", codex: "/bin/codex" };
    expect(activeAgentCliPath(paths, "claudeCode")).toBe("/bin/claude");
    expect(activeAgentCliPath(paths, "codex")).toBe("/bin/codex");
  });
});

describe("agent preferences", () => {
  it("normalizes the closed appearance variants", () => {
    expect(normalizeAgentAppearanceVariant("graphite")).toBe("graphite");
    expect(normalizeAgentAppearanceVariant("paper")).toBe("paper");
    expect(normalizeAgentAppearanceVariant("studio")).toBe("studio");
    expect(normalizeAgentAppearanceVariant("signal")).toBe("current");
  });

  it("keeps only a bounded, unique, closed favorite model list", () => {
    expect(normalizeAgentModelFavoriteKeys(["claudeCode/opus", "codex/gpt-5.5"])).toEqual([
      "claudeCode/opus",
      "codex/gpt-5.5",
    ]);
    expect(normalizeAgentModelFavoriteKeys(["claudeCode/opus", "claudeCode/opus"])).toEqual([]);
    expect(normalizeAgentModelFavoriteKeys(["claudeCode/unknown"])).toEqual([]);
    expect(normalizeAgentModelFavoriteKeys("claudeCode/opus")).toEqual([]);
  });

  it("normalizes a bounded persisted favorite revision and handles exhaustion", () => {
    expect(normalizeAgentModelFavoritesRevision(17)).toBe(17);
    expect(normalizeAgentModelFavoritesRevision(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const malformed of [-1, 1.5, "17", Number.POSITIVE_INFINITY, undefined]) {
      expect(normalizeAgentModelFavoritesRevision(malformed)).toBe(0);
    }
    expect(nextAgentModelFavoritesRevision(17)).toBe(18);
    expect(nextAgentModelFavoritesRevision(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("normalizes favorite keys and revision as one fail-closed snapshot", () => {
    expect(normalizeAgentModelFavoritesSnapshot(["claudeCode/opus"], 7)).toEqual({
      keys: ["claudeCode/opus"],
      revision: 7,
    });
    expect(normalizeAgentModelFavoritesSnapshot(undefined, undefined)).toEqual({
      keys: [],
      revision: 0,
    });
    for (const [keys, revision] of [
      [["claudeCode/unknown"], Number.MAX_SAFE_INTEGER],
      [["claudeCode/opus"], "7"],
      [["claudeCode/opus"], Number.MAX_SAFE_INTEGER],
      [undefined, 7],
    ]) {
      expect(normalizeAgentModelFavoritesSnapshot(keys, revision)).toEqual({
        keys: [],
        revision: 0,
      });
    }
  });
});

describe("normalizeAgentCliKind", () => {
  it("keeps every supported kind", () => {
    expect(normalizeAgentCliKind("claudeCode")).toBe("claudeCode");
    expect(normalizeAgentCliKind("codex")).toBe("codex");
  });

  it.each([
    ["an unknown kind", "gemini"],
    ["a casing variant", "claudecode"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 1],
    ["an object", { kind: "codex" }],
  ])("falls back to Claude Code for %s", (_label, value) => {
    expect(normalizeAgentCliKind(value)).toBe("claudeCode");
  });
});

describe("normalizeMaxConcurrentAgentTasks", () => {
  it.each([
    [1, 1],
    [4, 4],
    [8, 8],
  ])("keeps %i inside the supported range", (value, expected) => {
    expect(normalizeMaxConcurrentAgentTasks(value)).toBe(expected);
  });

  it.each([
    ["below the minimum", 0, 1],
    ["negative", -7, 1],
    ["above the maximum", 9, 8],
    ["far above the maximum", 4_096, 8],
  ])("clamps a value %s", (_label, value, expected) => {
    expect(normalizeMaxConcurrentAgentTasks(value)).toBe(expected);
  });

  it("floors a fractional value before clamping", () => {
    expect(normalizeMaxConcurrentAgentTasks(3.9)).toBe(3);
    expect(normalizeMaxConcurrentAgentTasks(0.9)).toBe(1);
    expect(normalizeMaxConcurrentAgentTasks(8.9)).toBe(8);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a numeric string", "4"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("falls back to the default for %s", (_label, value) => {
    expect(normalizeMaxConcurrentAgentTasks(value)).toBe(4);
  });
});

describe("normalizeAgentIsolationPolicy", () => {
  it("keeps every supported policy", () => {
    expect(normalizeAgentIsolationPolicy("auto")).toBe("auto");
    expect(normalizeAgentIsolationPolicy("worktree")).toBe("worktree");
    expect(normalizeAgentIsolationPolicy("in-place")).toBe("in-place");
  });

  it.each([
    ["an unknown policy", "isolated"],
    ["a casing variant", "In-Place"],
    ["undefined", undefined],
    ["null", null],
    ["a boolean", true],
  ])("falls back to auto for %s", (_label, value) => {
    expect(normalizeAgentIsolationPolicy(value)).toBe("auto");
  });
});
