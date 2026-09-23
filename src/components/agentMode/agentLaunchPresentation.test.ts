import { describe, expect, it } from "vitest";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
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
  agentLaunchEffectiveModel,
  agentLaunchForDispatch,
  agentLaunchMetaLabel,
  agentLaunchSummaryLabel,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelChoices,
  agentLaunchModelHint,
  agentLaunchModelLabel,
  agentLaunchModelMeta,
  agentLaunchSupportsEffort,
  agentClaudeLaunchTraits,
  agentLaunchTone,
  agentLaunchWithChrome,
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
      "claude-opus-5-5",
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
    ).toBe("Claude CLI settings");
    expect(agentLaunchModeLabel({ provider: "codex", model: "default", mode: "default" })).toBe(
      "Codex config",
    );
    expect(agentLaunchModeHint({ provider: "codex", model: "default", mode: "default" })).toContain(
      "configured",
    );
  });

  it("gives every access mode a distinct label and an approval-truthful hint", () => {
    const claudeLabels = CLAUDE_PERMISSION_MODES.map((mode) =>
      agentLaunchModeLabel({ provider: "claudeCode", model: "default", mode, effort: "default" }),
    );
    const codexLabels = CODEX_EXECUTION_MODES.map((mode) =>
      agentLaunchModeLabel({ provider: "codex", model: "default", mode }),
    );
    expect(new Set(claudeLabels).size).toBe(claudeLabels.length);
    expect(new Set(codexLabels).size).toBe(codexLabels.length);
    expect(agentLaunchModeHint({ provider: "codex", model: "default", mode: "default" })).toContain(
      "config.toml",
    );
    expect(
      agentLaunchModeHint({
        provider: "claudeCode",
        model: "default",
        mode: "plan",
        effort: "default",
      }),
    ).toContain("approve the plan");
    expect(
      agentLaunchModeHint({
        provider: "claudeCode",
        model: "default",
        mode: "bypassPermissions",
        effort: "default",
      }),
    ).toContain("without prompts");
  });

  it("does not promise in-editor approvals for remote runners", () => {
    const supervised: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "default",
      mode: "supervised",
      effort: "default",
    };
    expect(agentLaunchModeHint(supervised)).toContain("here");
    expect(agentLaunchModeHint(supervised, "server")).toContain("remote runners");
    expect(agentLaunchModeHint(supervised, "server")).not.toContain("here");
    const remoteCodex = agentLaunchModeChoices("codex", "server");
    for (const choice of remoteCodex) expect(choice.hint).not.toContain("here");
    expect(remoteCodex.find((choice) => choice.value === "auto")?.hint).toContain("remote runners");
    expect(agentLaunchModeChoices("codex", "server").map((choice) => choice.label)).toEqual(
      agentLaunchModeChoices("codex").map((choice) => choice.label),
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

  it("summarises the collapsed composer chip with the picker display labels", () => {
    expect(
      agentLaunchSummaryLabel({
        provider: "claudeCode",
        model: "claude-fable-5-1",
        mode: "bypassPermissions",
        effort: "high",
      }),
    ).toBe("Claude Fable 5.1 · Full access · High");
    expect(
      agentLaunchSummaryLabel({
        provider: "claudeCode",
        model: "claude-fable-5-1",
        mode: "acceptEdits",
        effort: "default",
      }),
    ).toBe("Claude Fable 5.1 · Auto-accept edits");
    expect(
      agentLaunchSummaryLabel({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }),
    ).toBe("GPT-5.5 · Workspace write");
  });
});

describe("agent model rows", () => {
  it("lists the closed model choices per provider with a provider name and favorite key", () => {
    expect(agentModelRows("claudeCode").map((row) => row.value)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
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
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
    ]);
    const opus = agentModelRows("claudeCode")[2];
    expect(opus?.providerName).toBe("Claude Code");
    expect(opus?.favoriteKey).toBe(agentModelFavoriteKey("claudeCode", "claude-opus-5"));
    expect(agentModelRows("claudeCode")[4]?.isLegacy).toBe(true);
    expect(agentModelRows("codex")[0]?.providerName).toBe("Codex");
  });

  it.each(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.5"])(
    "keeps model order and favorite identity stable with configured %s",
    (configured) => {
      const rows = agentModelRows("codex", configured);
      expect(rows.map((row) => row.value)).toEqual([
        "gpt-6-astra",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
      ]);
      expect(rows.find((row) => row.value === configured)?.favoriteKey).toBe(`codex/${configured}`);
      expect(
        agentLaunchForDispatch(
          { provider: "codex", model: "default", mode: "workspaceWrite" },
          configured,
        ).model,
      ).toBe(configured);
    },
  );

  it.each([null, "gpt-6-astra", "gpt-5.5"])(
    "retains a persisted default favorite for configured %s",
    (configured) => {
      const rows = agentModelRows("codex", configured);
      const favorites = filterAgentModelRows(rows, "favorites", new Set(["codex/default"]), "");
      expect(favorites.map((row) => row.value)).toEqual([configured ?? "gpt-5.6-sol"]);
    },
  );

  it("matches a literal case-folded query against the label and provider name only", () => {
    const rows = agentModelRows("claudeCode");
    expect(filterAgentModelRows(rows, "all", new Set(), "OPUS").map((r) => r.value)).toEqual([
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
    ]);
    expect(filterAgentModelRows(rows, "all", new Set(), "  claude code ").length).toBe(11);
    expect(filterAgentModelRows(rows, "all", new Set(), ".*").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "latest").length).toBe(0);
    expect(filterAgentModelRows(rows, "all", new Set(), "").length).toBe(11);
  });

  it("filters models that require a newer Claude CLI", () => {
    expect(agentModelRows("claudeCode", null, "2.1.200").map((row) => row.value)).not.toContain(
      "claude-fable-5-1",
    );
    expect(agentModelRows("claudeCode", null, "2.1.260").map((row) => row.value)).toContain(
      "claude-fable-5-1",
    );
  });

  it("offers browser integration on every Claude model and keeps it off Codex launches", () => {
    const claude = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    } as const;
    for (const model of CLAUDE_MODEL_CHOICES) {
      expect(agentClaudeLaunchTraits({ ...claude, model }, null, "local").chrome).toBe(true);
      expect(agentClaudeLaunchTraits({ ...claude, model }, null, "server").chrome).toBe(false);
    }
    expect(agentLaunchWithChrome(claude, false, null)).toEqual({ ...claude, chrome: false });
    expect(agentLaunchWithChrome({ ...claude, chrome: false }, true, null)).toEqual({
      ...claude,
      chrome: true,
    });
    expect(agentLaunchWithChrome({ ...claude, model: "default" }, false, "claude-opus-5")).toEqual({
      ...claude,
      model: "claude-opus-5",
      chrome: false,
    });
    const codex: AgentLaunchOptions = {
      provider: "codex",
      model: "gpt-5.5",
      mode: "workspaceWrite",
    };
    expect(agentLaunchWithChrome(codex, false, null)).toBe(codex);
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

describe("remote Claude model presentation", () => {
  const launch: AgentLaunchOptions = {
    provider: "claudeCode",
    model: "default",
    mode: "supervised",
    effort: "default",
  };
  const catalog: ClaudeModelManifest = {
    version: 1,
    updatedAt: "2026-09-22T00:00:00Z",
    claudeCode: [
      {
        ...BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode[0],
        choice: "claude-new-model-99",
        runtimeIds: ["opus", "claude-new-model-99"],
        label: "New model 99",
        description: "A newly published model.",
        isDefault: true,
        minVersion: "2.1.100",
        maxVersionExclusive: "3.0.0",
        efforts: ["low", "high"],
        defaultEffort: "low",
        contextWindows: ["200k"],
        defaultContext: "200k",
        fastMode: false,
      },
    ],
  };

  it("uses a new model consistently for rows, configured aliases, labels and dispatch", () => {
    expect(agentModelRows("claudeCode", null, "2.1.100", catalog)[0]).toMatchObject({
      value: "claude-new-model-99",
      label: "New model 99",
    });
    expect(agentLaunchModelChoices("claudeCode", catalog)[0].value).toBe("claude-new-model-99");
    expect(agentLaunchModelLabel(launch, "opus", catalog)).toBe("New model 99");
    expect(agentLaunchModelHint(launch, "opus", catalog)).toContain("A newly published model.");
    expect(agentLaunchEffectiveModel(launch, null, catalog)).toBe("claude-new-model-99");
    expect(agentLaunchForDispatch(launch, "opus", catalog).model).toBe("claude-new-model-99");
    const selected = agentLaunchWithModel(launch, "claude-new-model-99", null, catalog);
    expect(selected).toMatchObject({
      model: "claude-new-model-99",
      effort: "low",
      context: "200k",
      fastMode: false,
    });
    expect(agentLaunchWithModel(launch, "opus", null, catalog)).toEqual(selected);
    expect(
      agentClaudeLaunchTraits({ ...launch, model: "claude-new-model-99" }, null, "local", catalog),
    ).toMatchObject({ efforts: ["low", "high"], defaultEffort: "low", contextWindows: ["200k"] });
  });

  it("normalizes dispatch options to the active catalog and preserves supported choices", () => {
    const lowOnlyCatalog: ClaudeModelManifest = {
      ...catalog,
      claudeCode: [{ ...catalog.claudeCode[0], efforts: ["low"] }],
    };
    expect(
      agentLaunchForDispatch(
        { ...launch, effort: "high", context: "1m", fastMode: true, thinkingMode: true },
        null,
        lowOnlyCatalog,
      ),
    ).toMatchObject({
      model: "claude-new-model-99",
      effort: "low",
      context: "200k",
      fastMode: false,
      thinkingMode: false,
    });
    expect(agentLaunchForDispatch(launch, null, catalog)).toMatchObject({
      effort: "low",
      context: "200k",
    });
    expect(
      agentLaunchForDispatch(
        { ...launch, model: "claude-new-model-99", effort: "high", context: "200k" },
        null,
        catalog,
      ),
    ).toMatchObject({ effort: "high", context: "200k" });
    const removed = {
      ...launch,
      model: "claude-removed-99",
      effort: "max",
      context: "1m",
    } as const;
    expect(agentLaunchForDispatch(removed, null, catalog)).toBe(removed);
  });

  it("enforces both version bounds and retains catalogs independently", () => {
    expect(agentModelRows("claudeCode", null, "2.1.99", catalog)).toEqual([]);
    expect(agentModelRows("claudeCode", null, "3.0.0", catalog)).toEqual([]);
    expect(agentModelRows("claudeCode", null, "2.9.999", catalog)).toHaveLength(1);
    expect(agentModelRows("claudeCode").some((row) => row.value === "claude-new-model-99")).toBe(
      false,
    );
  });

  it("matches backend version bounds for prereleases and fourth components", () => {
    expect(agentModelRows("claudeCode", null, "2.1.100-beta.1", catalog)).toEqual([]);
    expect(agentModelRows("claudeCode", null, "3.0.0-beta.1", catalog)).toHaveLength(1);
    expect(agentModelRows("claudeCode", null, "2.1.100.1-beta.1", catalog)).toHaveLength(1);
    expect(agentModelRows("claudeCode", null, "3.0.0.1-beta.1", catalog)).toEqual([]);
    expect(agentModelRows("claudeCode", null, "invalid", catalog)).toEqual([]);
    expect(agentModelRows("claudeCode", null, null, catalog)).toHaveLength(1);
  });

  it("rejects absent selections and safely displays historical unknown models", () => {
    expect(agentLaunchWithModel(launch, "claude-unlisted-99", null, catalog)).toBe(launch);
    expect(agentLaunchModelLabel({ ...launch, model: "claude-unlisted-99" }, null, catalog)).toBe(
      "claude-unlisted-99",
    );
  });
});
