import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
} from "../../domain/agentLaunch";
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
    expect(agentLaunchWithModel(claude, "opus")).toEqual({ ...claude, model: "opus" });
    expect(agentLaunchWithMode(claude, "plan")).toEqual({ ...claude, mode: "plan" });
  });

  it("offers exactly the closed domain choices per provider", () => {
    expect(agentLaunchModelChoices("claudeCode").map((choice) => choice.value)).toEqual([
      ...CLAUDE_MODEL_CHOICES,
    ]);
    expect(agentLaunchModeChoices("claudeCode").map((choice) => choice.value)).toEqual([
      ...CLAUDE_PERMISSION_MODES,
    ]);
    expect(agentLaunchModelChoices("codex").map((choice) => choice.value)).toEqual([
      ...CODEX_MODEL_CHOICES,
    ]);
    expect(agentLaunchModeChoices("codex").map((choice) => choice.value)).toEqual([
      ...CODEX_EXECUTION_MODES,
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

  it("names the provider default without inventing a model name", () => {
    expect(
      agentLaunchModelLabel({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBe("Auto (Claude Code)");
    expect(agentLaunchModelLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "Auto (Codex)",
    );
    expect(
      agentLaunchModelHint({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBe("No model override. Claude CLI chooses the model from its settings.");
    expect(
      agentLaunchModeLabel({
        provider: "claudeCode",
        model: "default",
        mode: "default",
        effort: "default",
      }),
    ).toBe("Default permissions");
    expect(agentLaunchModeLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "Default sandbox",
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

    expect(agentLaunchModelLabel(claude("fable"))).toBe("Claude Fable 5");
    expect(agentLaunchModelLabel(claude("opus"))).toBe("Claude Opus 5");
    expect(agentLaunchModelLabel(claude("sonnet"))).toBe("Claude Sonnet 5");
    expect(agentLaunchModelMeta(claude("opus"))).toBe("opus");
    expect(agentLaunchModeChoices("claudeCode").map((choice) => choice.label)).toEqual([
      "Default permissions",
      "Plan mode",
      "Accept edits",
      "Full access",
    ]);
    expect(agentLaunchModeChoices("codex").map((choice) => choice.label)).toEqual([
      "Default sandbox",
      "Read-only",
      "Workspace write",
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
    ).toBe("opus · accept edits");
    expect(
      agentLaunchMetaLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("gpt-5.5 · workspace write");
  });

  it("tones plan and dangerous modes apart from the ordinary ones", () => {
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
    ).toBe("danger");
    expect(agentLaunchTone({ provider: "codex", model: "default", mode: "dangerFullAccess" })).toBe(
      "danger",
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

    expect(effortChoices.map((choice) => choice.value)).toEqual([...CLAUDE_EFFORT_CHOICES]);
    expect(effortChoices.map((choice) => choice.label)).toEqual([
      "Default effort",
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
    ]);
    for (const choice of effortChoices) {
      expect(choice.tone).toBeNull();
      expect(choice.hint.length).toBeGreaterThan(0);
      expect(choice.hint).not.toContain("\n");
    }
    expect(new Set(effortChoices.map((choice) => choice.hint)).size).toBe(
      CLAUDE_EFFORT_CHOICES.length,
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
    ).toBe("opus · accept edits");
    expect(
      agentLaunchMetaLabel({
        provider: "claudeCode",
        model: "opus",
        mode: "acceptEdits",
        effort: "xhigh",
      }),
    ).toBe("opus · accept edits · xhigh");
    expect(
      agentLaunchMetaLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("gpt-5.5 · workspace write");
  });
});

describe("agent model rows", () => {
  it("lists the closed model choices per provider with a provider name and favorite key", () => {
    expect(agentModelRows("claudeCode").map((row) => row.value)).toEqual([
      "default",
      "fable",
      "opus",
      "sonnet",
    ]);
    expect(agentModelRows("codex").map((row) => row.value)).toEqual([
      "default",
      "gpt-5.6-sol",
      "gpt-5.5",
      "gpt-5.4",
    ]);
    const opus = agentModelRows("claudeCode")[2];
    expect(opus?.providerName).toBe("Claude Code");
    expect(opus?.favoriteKey).toBe(agentModelFavoriteKey("claudeCode", "opus"));
    expect(agentModelRows("codex")[0]?.providerName).toBe("Codex");
  });

  it("matches a literal case-folded query against the label and provider name only", () => {
    const rows = agentModelRows("claudeCode");
    expect(filterAgentModelRows(rows, "all", new Set(), "OPUS").map((r) => r.value)).toEqual([
      "opus",
    ]);
    expect(filterAgentModelRows(rows, "all", new Set(), "  claude code ").length).toBe(4);
    expect(filterAgentModelRows(rows, "all", new Set(), ".*").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "latest").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "").length).toBe(4);
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
