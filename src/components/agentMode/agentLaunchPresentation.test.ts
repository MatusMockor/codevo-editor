import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { CLAUDE_EFFORT_CHOICES, CODEX_MODEL_CHOICES } from "../../domain/agentLaunch";
import {
  MAX_AGENT_MODEL_QUERY_LENGTH,
  agentLaunchAccess,
  agentModelFavoriteKey,
  agentModelRows,
  boundAgentModelQuery,
  filterAgentModelRows,
  agentLaunchDangerConfirmLabel,
  agentLaunchDangerNotice,
  agentLaunchEffortChoices,
  agentLaunchEffortHint,
  agentLaunchEffortLabel,
  agentLaunchEffortMeta,
  agentLaunchEffortValue,
  agentLaunchEffectiveModel,
  agentLaunchForDispatch,
  agentLaunchMetaLabel,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelChoices,
  agentLaunchModelHint,
  agentLaunchModelLabel,
  agentLaunchModelMeta,
  agentLaunchSupportsEffort,
  agentLaunchTone,
  agentLaunchWithEffort,
  agentLaunchWithMode,
  agentLaunchWithModel,
} from "./agentLaunchPresentation";

describe("agentLaunchPresentation", () => {
  it("resolves configured Astra consistently for display, dispatch, search, and favorites", () => {
    const launch: AgentLaunchOptions = {
      provider: "codex",
      model: "default",
      mode: "workspaceWrite",
    };
    expect(agentLaunchModelLabel(launch, "gpt-6-astra")).toBe("GPT-6 Astra");
    expect(agentLaunchEffectiveModel(launch, "gpt-6-astra")).toBe("gpt-6-astra");
    expect(agentLaunchForDispatch(launch, "gpt-6-astra")).toEqual({
      ...launch,
      model: "gpt-6-astra",
    });
    const rows = agentModelRows("codex");
    const matches = filterAgentModelRows(rows, "all", new Set(), "astra");
    expect(matches.map((row) => row.value)).toEqual(["gpt-6-astra"]);
    expect(filterAgentModelRows(rows, "favorites", new Set(["codex/gpt-6-astra"]), "")).toEqual(
      matches,
    );
    expect(agentLaunchForDispatch({ ...launch, model: "gpt-5.5" }, "gpt-6-astra").model).toBe(
      "gpt-5.5",
    );
  });

  it("ignores a value that is not a choice of the current provider", () => {
    const codex: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
    const claude: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
    };

    expect(agentLaunchWithModel(codex, "opus")).toEqual(codex);
    expect(agentLaunchWithMode(codex, "bypassPermissions")).toEqual(codex);
    expect(agentLaunchWithModel(claude, "gpt-5.5")).toEqual(claude);
    expect(agentLaunchWithMode(claude, "dangerFullAccess")).toEqual(claude);
    expect(agentLaunchWithModel(codex, "")).toEqual(codex);
  });

  it("keeps a value that is a choice of the current provider", () => {
    const codex: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
    const claude: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
    };

    expect(agentLaunchWithModel(codex, "gpt-5.5")).toEqual({ ...codex, model: "gpt-5.5" });
    expect(agentLaunchWithMode(codex, "readOnly")).toEqual({ ...codex, mode: "readOnly" });
    expect(agentLaunchWithModel(claude, "claude-opus-5")).toEqual({
      ...claude,
      model: "claude-opus-5",
      effort: "high",
      context: "1m",
      fastMode: false,
      thinkingMode: false,
    });
    expect(agentLaunchWithMode(claude, "plan")).toEqual({ ...claude, mode: "plan" });
  });

  it("offers exactly the closed domain choices per provider", () => {
    expect(agentLaunchModelChoices("claudeCode").map((choice) => choice.value)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(agentLaunchModeChoices("claudeCode").map((choice) => choice.value)).toEqual([
      "supervised",
      "acceptEdits",
      "auto",
      "bypassPermissions",
    ]);
    expect(agentLaunchModelChoices("codex").map((choice) => choice.value)).toEqual([
      ...CODEX_MODEL_CHOICES.filter((model) => model !== "default"),
    ]);
    expect(agentLaunchModeChoices("codex").map((choice) => choice.value)).toEqual([
      "readOnly",
      "workspaceWrite",
      "auto",
      "dangerFullAccess",
    ]);
  });

  it("gives every choice a label and a one-line hint", () => {
    const choices = [
      ...agentLaunchModelChoices("claudeCode"),
      ...agentLaunchModeChoices("claudeCode"),
      ...agentLaunchModelChoices("codex"),
      ...agentLaunchModeChoices("codex"),
    ];

    for (const choice of choices) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.hint.length).toBeGreaterThan(0);
      expect(choice.hint).not.toContain("\n");
    }
  });

  it("resolves the Claude catalog default to a real model name", () => {
    expect(
      agentLaunchModelLabel({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBe("Claude Sonnet 5");
    expect(agentLaunchModelLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "GPT-5.6 Sol",
    );
    expect(
      agentLaunchModelHint({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toContain("Claude model catalog");
    expect(
      agentLaunchModeLabel({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBe("Auto");
    expect(agentLaunchModeLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "Auto",
    );
    expect(agentLaunchModeHint({ provider: "codex", model: "default", mode: "default" })).toContain(
      "configured",
    );
  });

  it("names models and modes in human form for the composer triggers", () => {
    const claude = (model: "fable" | "opus" | "sonnet"): AgentLaunchOptions => ({
      provider: "claudeCode",
      model,
      mode: "default",
      effort: "default",
    });

    expect(agentLaunchModelLabel(claude("fable"))).toBe("Claude Fable 5.1");
    expect(agentLaunchModelLabel(claude("opus"))).toBe("Claude Opus 5");
    expect(agentLaunchModelLabel(claude("sonnet"))).toBe("Claude Sonnet 5");
    expect(agentLaunchModelMeta(claude("opus"))).toBe("opus");
    expect(agentLaunchModeChoices("claudeCode").map((choice) => choice.label)).toEqual([
      "Supervised",
      "Auto-accept edits",
      "Auto",
      "Full access",
    ]);
    expect(agentLaunchModeChoices("codex").map((choice) => choice.label)).toEqual([
      "Read-only",
      "Workspace write",
      "Auto",
      "Full access",
    ]);
  });

  it("opens the lock only for the modes that bypass the safety checks", () => {
    expect(
      agentLaunchAccess({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toBe("open");
    expect(
      agentLaunchAccess({ provider: "codex", model: "default", mode: "dangerFullAccess" }),
    ).toBe("open");
    for (const mode of ["default", "plan", "acceptEdits"] as const) {
      expect(
        agentLaunchAccess({ provider: "claudeCode", model: "opus", mode, effort: "default" }),
      ).toBe("guarded");
    }
    expect(agentLaunchAccess({ provider: "codex", model: "default", mode: "readOnly" })).toBe(
      "guarded",
    );
  });

  it("renders a compact meta label for a turn record", () => {
    expect(
      agentLaunchMetaLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "default",
      }),
    ).toBe("opus · auto-accept edits");
    expect(
      agentLaunchMetaLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("gpt-5.5 · workspace write");
  });

  it("tones plan mode while keeping access choices visually neutral", () => {
    expect(
      agentLaunchTone({ provider: "claudeCode", model: "opus", mode: "plan", effort: "default" }),
    ).toBe("plan");
    expect(
      agentLaunchTone({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toBeNull();
    expect(agentLaunchTone({ provider: "codex", model: "default", mode: "dangerFullAccess" })).toBe(
      null,
    );
    expect(agentLaunchTone({ provider: "codex", model: "default", mode: "readOnly" })).toBeNull();
  });

  it("warns truthfully about each dangerous mode and stays silent otherwise", () => {
    expect(
      agentLaunchDangerNotice({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toContain("Bypasses permission checks");
    expect(
      agentLaunchDangerNotice({ provider: "codex", model: "default", mode: "dangerFullAccess" }),
    ).toContain("sandbox");
    expect(
      agentLaunchDangerNotice({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "default",
      }),
    ).toBeNull();
  });

  it("labels the confirmation per provider", () => {
    expect(
      agentLaunchDangerConfirmLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toContain("permission checks");
    expect(
      agentLaunchDangerConfirmLabel({
        provider: "codex",
        model: "default",
        mode: "dangerFullAccess",
      }),
    ).toContain("sandbox");
  });

  it("names every claude effort level exactly once with a one line hint", () => {
    const effortChoices = agentLaunchEffortChoices();

    expect(effortChoices.map((choice) => choice.value)).toEqual(
      CLAUDE_EFFORT_CHOICES.filter((effort) => effort !== "default"),
    );
    expect(effortChoices.map((choice) => choice.label)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
      "Ultracode",
      "Ultrathink",
    ]);
    for (const choice of effortChoices) {
      expect(choice.tone).toBeNull();
      expect(choice.hint.length).toBeGreaterThan(0);
      expect(choice.hint).not.toContain("\n");
    }
    expect(new Set(effortChoices.map((choice) => choice.hint)).size).toBe(
      CLAUDE_EFFORT_CHOICES.length - 1,
    );
  });

  it("reads the effort of a claude launch and falls back to the default for codex", () => {
    const claude: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "plan",
      effort: "xhigh",
    };
    const codex: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };

    expect(agentLaunchSupportsEffort(claude)).toBe(true);
    expect(agentLaunchSupportsEffort(codex)).toBe(false);
    expect(agentLaunchEffortValue(claude)).toBe("xhigh");
    expect(agentLaunchEffortValue(codex)).toBe("default");
    expect(agentLaunchEffortLabel(claude)).toBe("Extra high");
    expect(agentLaunchEffortLabel(codex)).toBe("Default effort");
    expect(agentLaunchEffortMeta(claude)).toBe("xhigh");
    expect(agentLaunchEffortHint(claude)).toBe(
      agentLaunchEffortChoices().find((choice) => choice.value === "xhigh")?.hint,
    );
  });

  it("changes the effort only for claude and only for a known level", () => {
    const claude: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "plan",
      effort: "default",
    };
    const codex: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };

    for (const effort of CLAUDE_EFFORT_CHOICES) {
      expect(agentLaunchWithEffort(claude, effort)).toEqual({ ...claude, effort });
    }
    expect(agentLaunchWithEffort(claude, "ultra")).toEqual(claude);
    expect(agentLaunchWithEffort(codex, "high")).toEqual(codex);
  });

  it("appends the effort to the meta label only when it is not the default", () => {
    expect(
      agentLaunchMetaLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "default",
      }),
    ).toBe("opus · auto-accept edits");
    expect(
      agentLaunchMetaLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "xhigh",
      }),
    ).toBe("opus · auto-accept edits · xhigh");
    expect(
      agentLaunchMetaLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("gpt-5.5 · workspace write");
  });
});

describe("agent model rows", () => {
  it("lists the closed model choices per provider with a provider name and favorite key", () => {
    expect(agentModelRows("claudeCode").map((row) => row.value)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(agentModelRows("codex").map((row) => row.value)).toEqual([
      "default",
      "gpt-6-astra",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
    ]);
    const opus = agentModelRows("claudeCode")[1];
    expect(opus?.providerName).toBe("Claude Code");
    expect(opus?.favoriteKey).toBe(agentModelFavoriteKey("claudeCode", "claude-opus-5"));
    expect(agentModelRows("claudeCode")[3]?.isLegacy).toBe(true);
    expect(agentModelRows("codex")[0]?.providerName).toBe("Codex");
  });

  it("matches a literal case-folded query against the label and provider name only", () => {
    const rows = agentModelRows("claudeCode");
    expect(filterAgentModelRows(rows, "all", new Set(), "OPUS").map((r) => r.value)).toEqual([
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
    ]);
    expect(filterAgentModelRows(rows, "all", new Set(), "  claude code ").length).toBe(10);
    expect(filterAgentModelRows(rows, "all", new Set(), ".*").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "latest").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "").length).toBe(10);
  });

  it("filters models that require a newer Claude CLI", () => {
    expect(agentModelRows("claudeCode", null, "2.1.200").map((row) => row.value)).not.toContain(
      "claude-fable-5-1",
    );
    expect(agentModelRows("claudeCode", null, "2.1.260").map((row) => row.value)).toContain(
      "claude-fable-5-1",
    );
  });

  it("bounds the query length and keeps only starred rows under the favorites filter", () => {
    const rows = agentModelRows("codex");
    expect(boundAgentModelQuery("x".repeat(500))).toHaveLength(MAX_AGENT_MODEL_QUERY_LENGTH);
    const favorites = new Set([agentModelFavoriteKey("codex", "gpt-5.5")]);
    expect(filterAgentModelRows(rows, "favorites", favorites, "").map((r) => r.value)).toEqual([
      "gpt-5.5",
    ]);
    expect(filterAgentModelRows(rows, "favorites", favorites, "sol")).toEqual([]);
    expect(filterAgentModelRows(rows, "favorites", new Set(), "")).toEqual([]);
  });
});
