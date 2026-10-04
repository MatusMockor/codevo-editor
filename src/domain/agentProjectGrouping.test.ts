import { describe, expect, it } from "vitest";
import {
  AGENT_PROJECT_GROUPING_MODES,
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  MAX_AGENT_PROJECT_GROUPING_OVERRIDES,
  MAX_AGENT_PROJECT_GROUPING_ROOT_KEY_CHARS,
  encodeAgentProjectGroupingSettings,
  isAgentProjectGroupingMode,
  parseAgentProjectGroupingSettings,
  resolveGroupingMode,
  withAgentProjectGroupingMode,
  withAgentProjectGroupingOverride,
  withoutAgentProjectGroupingOverrides,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingSettings,
  type AgentProjectGroupingUpdate,
} from "./agentProjectGrouping";

const REMOTE = "remote:linux:runner:project";

function settingsOf(update: AgentProjectGroupingUpdate): AgentProjectGroupingSettings | null {
  return update.kind === "updated" ? update.settings : null;
}

function fullOverrides(): ReadonlyArray<readonly [string, AgentProjectGroupingMode]> {
  return Array.from({ length: MAX_AGENT_PROJECT_GROUPING_OVERRIDES }, (_, index) => [
    `/projects/p${index}`,
    "separate",
  ]);
}

describe("agent project grouping settings", () => {
  it("defaults to repository grouping without overrides", () => {
    expect(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS.mode).toBe("repository");
    expect(DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS.overrides.size).toBe(0);
    expect(AGENT_PROJECT_GROUPING_MODES).toEqual(["repository", "separate"]);
  });

  it("resolves a project override before the global mode", () => {
    const settings = {
      mode: "repository" as const,
      overrides: new Map([[REMOTE, "separate" as const]]),
    };
    expect(resolveGroupingMode(REMOTE, settings)).toBe("separate");
    expect(resolveGroupingMode("/workspace/app", settings)).toBe("repository");
    expect(resolveGroupingMode("remote:linux:runner:other", settings)).toBe("repository");
  });

  it("accepts only the closed set of modes", () => {
    expect(isAgentProjectGroupingMode("repository")).toBe(true);
    expect(isAgentProjectGroupingMode("separate")).toBe(true);
    for (const value of ["repository_path", "Repository", "", null, undefined, 1, ["separate"]])
      expect(isAgentProjectGroupingMode(value)).toBe(false);
  });

  it("round-trips encoded settings", () => {
    const settings = {
      mode: "separate" as const,
      overrides: new Map<string, AgentProjectGroupingMode>([
        ["/workspace/app", "repository"],
        [REMOTE, "separate"],
      ]),
    };
    const encoded: unknown = JSON.parse(
      JSON.stringify(encodeAgentProjectGroupingSettings(settings)),
    );
    const parsed = parseAgentProjectGroupingSettings(encoded);
    expect(parsed?.mode).toBe("separate");
    expect([...(parsed?.overrides ?? [])]).toEqual([...settings.overrides]);
  });

  it.each<readonly [string, unknown]>([
    ["null", null],
    ["an array", []],
    ["a string", "repository"],
    ["a missing mode", { overrides: [] }],
    ["missing overrides", { mode: "repository" }],
    ["an unknown field", { mode: "repository", overrides: [], extra: true }],
    ["the unimplemented repository_path mode", { mode: "repository_path", overrides: [] }],
    ["an unknown mode", { mode: "merged", overrides: [] }],
    ["object overrides", { mode: "repository", overrides: { "/a": "separate" } }],
    ["a repository_path override", { mode: "repository", overrides: [["/a", "repository_path"]] }],
    ["a malformed override", { mode: "repository", overrides: [["/a"]] }],
    ["an over-long override", { mode: "repository", overrides: [["/a", "separate", "x"]] }],
    ["an empty project key", { mode: "repository", overrides: [["", "separate"]] }],
    ["a control character key", { mode: "repository", overrides: [["/a\n", "separate"]] }],
    ["a non-string key", { mode: "repository", overrides: [[1, "separate"]] }],
    [
      "an oversized key",
      {
        mode: "repository",
        overrides: [["/".repeat(MAX_AGENT_PROJECT_GROUPING_ROOT_KEY_CHARS + 1), "separate"]],
      },
    ],
    [
      "a duplicate key",
      {
        mode: "repository",
        overrides: [
          ["/a", "separate"],
          ["/a", "repository"],
        ],
      },
    ],
    [
      "too many overrides",
      { mode: "repository", overrides: [...fullOverrides(), ["/projects/extra", "separate"]] },
    ],
  ])("rejects %s", (_name, value) => {
    expect(parseAgentProjectGroupingSettings(value)).toBeNull();
  });

  it("accepts exactly the maximum number of overrides", () => {
    const parsed = parseAgentProjectGroupingSettings({
      mode: "repository",
      overrides: fullOverrides(),
    });
    expect(parsed?.overrides.size).toBe(MAX_AGENT_PROJECT_GROUPING_OVERRIDES);
  });

  it("changes the global mode without touching overrides or the previous value", () => {
    const before = {
      mode: "repository" as const,
      overrides: new Map([[REMOTE, "separate" as const]]),
    };
    const after = settingsOf(withAgentProjectGroupingMode(before, "separate"));
    expect(after?.mode).toBe("separate");
    expect(after?.overrides).toBe(before.overrides);
    expect(before.mode).toBe("repository");
  });

  it("sets, replaces and clears one project override immutably", () => {
    const base = DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS;
    const set = settingsOf(withAgentProjectGroupingOverride(base, REMOTE, "separate"));
    expect([...(set?.overrides ?? [])]).toEqual([[REMOTE, "separate"]]);
    expect(base.overrides.size).toBe(0);
    const replaced = settingsOf(
      withAgentProjectGroupingOverride(set ?? base, REMOTE, "repository"),
    );
    expect([...(replaced?.overrides ?? [])]).toEqual([[REMOTE, "repository"]]);
    const cleared = settingsOf(withAgentProjectGroupingOverride(replaced ?? base, REMOTE, null));
    expect(cleared?.overrides.size).toBe(0);
    expect(replaced?.overrides.size).toBe(1);
  });

  it("rejects invalid projects and a new override at capacity", () => {
    const full = { mode: "repository" as const, overrides: new Map(fullOverrides()) };
    expect(withAgentProjectGroupingOverride(full, "", "separate")).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(withAgentProjectGroupingOverride(full, "/a\u0000", "separate")).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(withAgentProjectGroupingOverride(full, "/projects/extra", "separate")).toEqual({
      kind: "rejected",
      reason: "tooManyOverrides",
    });
    const replaced = settingsOf(
      withAgentProjectGroupingOverride(full, "/projects/p0", "repository"),
    );
    expect(replaced?.overrides.get("/projects/p0")).toBe("repository");
    expect(replaced?.overrides.size).toBe(MAX_AGENT_PROJECT_GROUPING_OVERRIDES);
    const cleared = settingsOf(withAgentProjectGroupingOverride(full, "/projects/p0", null));
    expect(cleared?.overrides.size).toBe(MAX_AGENT_PROJECT_GROUPING_OVERRIDES - 1);
  });

  it("returns the same settings for changes that change nothing", () => {
    const settings = {
      mode: "repository" as const,
      overrides: new Map([[REMOTE, "separate" as const]]),
    };
    expect(settingsOf(withAgentProjectGroupingMode(settings, "repository"))).toBe(settings);
    expect(settingsOf(withAgentProjectGroupingOverride(settings, REMOTE, "separate"))).toBe(
      settings,
    );
    expect(settingsOf(withAgentProjectGroupingOverride(settings, "/workspace/app", null))).toBe(
      settings,
    );
    expect(settingsOf(withoutAgentProjectGroupingOverrides(settings, []))).toBe(settings);
    expect(settingsOf(withoutAgentProjectGroupingOverrides(settings, ["/workspace/app"]))).toBe(
      settings,
    );
  });

  it("clears a bounded list of overrides in one update", () => {
    const settings = {
      mode: "separate" as const,
      overrides: new Map<string, AgentProjectGroupingMode>([
        ["/a", "repository"],
        ["/b", "repository"],
        [REMOTE, "repository"],
      ]),
    };
    const cleared = settingsOf(
      withoutAgentProjectGroupingOverrides(settings, ["/a", REMOTE, "/x"]),
    );
    expect(cleared?.mode).toBe("separate");
    expect([...(cleared?.overrides ?? [])]).toEqual([["/b", "repository"]]);
    expect(settings.overrides.size).toBe(3);
    expect(withoutAgentProjectGroupingOverrides(settings, ["/a", ""])).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    const tooMany = Array.from(
      { length: MAX_AGENT_PROJECT_GROUPING_OVERRIDES + 1 },
      (_, index) => `/p${index}`,
    );
    expect(withoutAgentProjectGroupingOverrides(settings, tooMany)).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
  });
});
