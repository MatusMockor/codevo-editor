import { describe, expect, it } from "vitest";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import {
  availableNewThreadDefaults,
  newThreadComposerLaunch,
} from "../agentMode/agentComposerLaunch";
import {
  agentLaunchForDispatch,
  agentLaunchModelLabel,
} from "../agentMode/agentLaunchPresentation";
import {
  agentProviderEnablement,
  newThreadArrowTarget,
  newThreadEffectiveEffort,
  newThreadEffortOptions,
  newThreadEffortValue,
  newThreadLaunchSourceDescription,
  newThreadModelContext,
  newThreadModelOptions,
  newThreadModelValue,
  newThreadPreview,
  newThreadProviderSelection,
  newThreadSelectionNote,
  newThreadTabStop,
  newThreadTileFootnote,
  newThreadTileState,
  withNewThreadEffort,
  withNewThreadLaunchSource,
  withNewThreadModel,
  type AgentNewThreadPreview,
} from "./agentNewThreadDefaultsPresentation";
import {
  NEW_THREAD_CLAUDE_CATALOG,
  NEW_THREAD_CODEX_CATALOG,
  NEW_THREAD_GATED_CLAUDE_CATALOG,
  newThreadManagementFixture,
  newThreadModelContextFixture,
} from "./agentNewThreadDefaultsTestSupport";

const context = newThreadModelContextFixture();
const BOTH_ENABLED = { claudeCode: true, codex: true } as const;
const CODEX_DISABLED = { claudeCode: true, codex: false } as const;
const NONE_ENABLED = { claudeCode: false, codex: false } as const;

function defaultsWith(overrides: Partial<AgentNewThreadDefaults>): AgentNewThreadDefaults {
  return { ...defaultAgentNewThreadDefaults(), ...overrides };
}

function gatedContext(claudeCliVersion: string | null) {
  return newThreadModelContextFixture({
    claudeCatalog: NEW_THREAD_GATED_CLAUDE_CATALOG,
    providerVersion: { claudeCode: claudeCliVersion, codex: null },
  });
}

function values(options: ReadonlyArray<{ readonly value: string }>): ReadonlyArray<string> {
  return options.map((option) => option.value);
}

function last<Item>(items: ReadonlyArray<Item>): Item | undefined {
  return items[items.length - 1];
}

function chipLabels(preview: AgentNewThreadPreview): ReadonlyArray<string> {
  return preview.chips.map((chip) => chip.label);
}

describe("new thread model options", () => {
  it("lists the provider default first, then current models in catalog order", () => {
    const defaults = defaultAgentNewThreadDefaults();

    expect(newThreadModelOptions("claudeCode", defaults, context)).toEqual([
      { label: "CLI default (Claude Sonnet 5)", value: "default" },
      { label: "Claude Opus 5.5", value: "claude-opus-5-5" },
      { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    ]);
    expect(newThreadModelOptions("codex", defaults, context)).toEqual([
      { label: "Config default (GPT-6.1-Sol)", value: "default" },
      { label: "GPT-6.1-Sol", value: "gpt-6.1-sol" },
      { label: "GPT-6-Luna", value: "gpt-6-luna" },
    ]);
  });

  it("labels the provider default with the model the CLI configuration resolves to", () => {
    const configured = newThreadModelContextFixture({
      configuredModel: { claudeCode: "claude-opus-5-5[1m]", codex: "gpt-6-luna" },
    });
    const defaults = defaultAgentNewThreadDefaults();

    expect(newThreadModelOptions("claudeCode", defaults, configured)[0]?.label).toBe(
      "CLI default (Claude Opus 5.5)",
    );
    expect(newThreadModelOptions("codex", defaults, configured)[0]?.label).toBe(
      "Config default (GPT-6-Luna)",
    );
  });

  it("does not name a model when the Codex configuration points outside the catalog", () => {
    const configured = newThreadModelContextFixture({
      configuredModel: { claudeCode: null, codex: "gpt-private" },
    });

    expect(
      newThreadModelOptions("codex", defaultAgentNewThreadDefaults(), configured)[0]?.label,
    ).toBe("Config default");
  });

  it("lists a legacy model only while it is the stored model", () => {
    const claude = defaultsWith({ claudeCode: { model: "claude-opus-4-5", effort: "high" } });
    const codex = defaultsWith({ codex: { model: "gpt-5.5", effort: "default" } });

    expect(values(newThreadModelOptions("claudeCode", claude, context))).toEqual([
      "default",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-opus-4-5",
    ]);
    expect(values(newThreadModelOptions("codex", codex, context))).toEqual([
      "default",
      "gpt-6.1-sol",
      "gpt-6-luna",
      "gpt-5.5",
    ]);
    expect(values(newThreadModelOptions("codex", claude, context))).not.toContain("gpt-5.5");
  });

  it("keeps a stored model that left the catalog as a disabled selected option", () => {
    const claude = defaultsWith({ claudeCode: { model: "claude-retired-1", effort: "high" } });
    const codex = defaultsWith({ codex: { model: "gpt-retired", effort: "default" } });

    expect(last(newThreadModelOptions("claudeCode", claude, context))).toEqual({
      disabled: true,
      label: "claude-retired-1 (unavailable)",
      value: "claude-retired-1",
    });
    expect(newThreadModelValue("claudeCode", claude, context)).toBe("claude-retired-1");
    expect(last(newThreadModelOptions("codex", codex, context))).toEqual({
      disabled: true,
      label: "gpt-retired (unavailable)",
      value: "gpt-retired",
    });
    expect(newThreadModelValue("codex", codex, context)).toBe("gpt-retired");
  });

  it("marks a model the installed CLI is too old for as unavailable and previews the fallback", () => {
    const gated = gatedContext("1.9.0");
    const defaults = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "max" } });

    expect(newThreadModelOptions("claudeCode", defaults, gated)).toEqual([
      { label: "CLI default (Claude Sonnet 5)", value: "default" },
      { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
      { disabled: true, label: "Claude Opus 5.5 (unavailable)", value: "claude-opus-5-5" },
    ]);
    expect(newThreadModelValue("claudeCode", defaults, gated)).toBe("claude-opus-5-5");
    expect(chipLabels(newThreadPreview("claudeCode", defaults, gated))).toEqual([
      "Claude Code",
      "Claude Sonnet 5",
      "Max",
      "1M context",
    ]);
    expect(values(newThreadEffortOptions("claudeCode", defaults, gated))).not.toContain(
      "ultracode",
    );
    expect(defaults.claudeCode).toEqual({ model: "claude-opus-5-5", effort: "max" });
  });

  it("keeps a version gated model when the installed CLI is new enough or unknown", () => {
    const defaults = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "max" } });

    for (const version of ["2.0.0", "2.4.1", null]) {
      const gated = gatedContext(version);

      expect(newThreadModelOptions("claudeCode", defaults, gated)).toEqual([
        { label: "CLI default (Claude Sonnet 5)", value: "default" },
        { label: "Claude Opus 5.5", value: "claude-opus-5-5" },
        { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
      ]);
      expect(chipLabels(newThreadPreview("claudeCode", defaults, gated))).toEqual([
        "Claude Code",
        "Claude Opus 5.5",
        "Max",
        "1M context",
      ]);
      expect(values(newThreadEffortOptions("claudeCode", defaults, gated))).toContain("ultracode");
    }
  });

  it("shows a stored Claude alias as its catalog model in the select and the preview", () => {
    const sonnet = defaultsWith({ claudeCode: { model: "sonnet", effort: "high" } });
    const opus = defaultsWith({ claudeCode: { model: "opus", effort: "ultracode" } });

    expect(newThreadModelValue("claudeCode", sonnet, context)).toBe("claude-sonnet-5");
    expect(newThreadModelOptions("claudeCode", sonnet, context)).toEqual([
      { label: "CLI default (Claude Sonnet 5)", value: "default" },
      { label: "Claude Opus 5.5", value: "claude-opus-5-5" },
      { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    ]);
    expect(chipLabels(newThreadPreview("claudeCode", sonnet, context))).toEqual([
      "Claude Code",
      "Claude Sonnet 5",
      "High",
      "1M context",
    ]);
    expect(newThreadModelValue("claudeCode", opus, context)).toBe("claude-opus-5-5");
    expect(chipLabels(newThreadPreview("claudeCode", opus, context))).toEqual([
      "Claude Code",
      "Claude Opus 5.5",
      "Ultracode",
      "1M context",
    ]);
    expect(newThreadEffortValue("claudeCode", opus, context)).toBe("ultracode");
    expect(sonnet.claudeCode.model).toBe("sonnet");
    expect(opus.claudeCode.model).toBe("opus");
  });

  it("treats a stored alias of a version gated model like the model itself", () => {
    const defaults = defaultsWith({ claudeCode: { model: "opus", effort: "high" } });
    const gated = gatedContext("1.9.0");

    expect(newThreadModelValue("claudeCode", defaults, gated)).toBe("claude-opus-5-5");
    expect(last(newThreadModelOptions("claudeCode", defaults, gated))).toEqual({
      disabled: true,
      label: "Claude Opus 5.5 (unavailable)",
      value: "claude-opus-5-5",
    });
    expect(chipLabels(newThreadPreview("claudeCode", defaults, gated))).toEqual([
      "Claude Code",
      "Claude Sonnet 5",
      "High",
      "1M context",
    ]);
  });

  it("reads the configured model and version from provider discovery", () => {
    const management = newThreadManagementFixture(
      {},
      {
        claudeCode: {
          kind: "detected",
          path: "/bin/claude",
          version: "2.1.300",
          configuredModel: "claude-opus-5-5",
        },
        codex: { kind: "notFound" },
      },
    );

    expect(
      newThreadModelContext(management, NEW_THREAD_CLAUDE_CATALOG, NEW_THREAD_CODEX_CATALOG),
    ).toEqual({
      claudeCatalog: NEW_THREAD_CLAUDE_CATALOG,
      codexCatalog: NEW_THREAD_CODEX_CATALOG,
      configuredModel: { claudeCode: "claude-opus-5-5", codex: null },
      providerVersion: { claudeCode: "2.1.300", codex: null },
    });
  });
});

describe("new thread effort options", () => {
  it("offers exactly the efforts of the selected Claude model and no model default", () => {
    const opus = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "high" } });

    expect(newThreadEffortOptions("claudeCode", opus, context)).toEqual([
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Extra high", value: "xhigh" },
      { label: "Max", value: "max" },
      { label: "Ultracode", value: "ultracode" },
      { label: "Ultrathink", value: "ultrathink" },
    ]);
    expect(
      values(newThreadEffortOptions("claudeCode", defaultAgentNewThreadDefaults(), context)),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultrathink"]);
  });

  it("shows the effort a stored Claude default really resolves to", () => {
    const stored = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "default" } });

    expect(newThreadEffectiveEffort("claudeCode", stored, context)).toEqual({
      value: "high",
      label: "High",
    });
    expect(newThreadEffortValue("claudeCode", stored, context)).toBe("high");
    expect(values(newThreadEffortOptions("claudeCode", stored, context))).not.toContain("default");
    expect(stored.claudeCode).toEqual({ model: "claude-opus-5-5", effort: "default" });
  });

  it("shows the model default effort while a stored Claude effort is unsupported", () => {
    const stale = defaultsWith({ claudeCode: { model: "claude-opus-4-5", effort: "xhigh" } });

    expect(newThreadEffectiveEffort("claudeCode", stale, context)).toEqual({
      value: "medium",
      label: "Medium",
    });
    expect(values(newThreadEffortOptions("claudeCode", stale, context))).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("lists the efforts of the fallback model while the stored Claude model is unavailable", () => {
    const retired = defaultsWith({ claudeCode: { model: "claude-retired-1", effort: "max" } });

    expect(values(newThreadEffortOptions("claudeCode", retired, context))).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultrathink",
    ]);
    expect(newThreadEffortValue("claudeCode", retired, context)).toBe("max");
  });

  it("keeps the model default for Codex because the dispatched launch carries no effort", () => {
    const defaults = defaultAgentNewThreadDefaults();
    const dispatched = agentLaunchForDispatch(
      newThreadComposerLaunch("codex", defaults),
      null,
      NEW_THREAD_CLAUDE_CATALOG,
      NEW_THREAD_CODEX_CATALOG,
    );

    expect("effort" in dispatched).toBe(false);
    expect(newThreadEffectiveEffort("codex", defaults, context)).toEqual({
      value: "default",
      label: "Model default",
    });
  });

  it("offers the model default plus exactly the efforts of the selected Codex model", () => {
    const luna = defaultsWith({ codex: { model: "gpt-6-luna", effort: "default" } });

    expect(newThreadEffortOptions("codex", luna, context)).toEqual([
      { label: "Model default", value: "default" },
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
    ]);
    expect(
      values(newThreadEffortOptions("codex", defaultAgentNewThreadDefaults(), context)),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  it("offers only the model default when the model supports no efforts", () => {
    const haiku = defaultsWith({ claudeCode: { model: "claude-haiku-4-5", effort: "default" } });
    const retired = defaultsWith({ codex: { model: "gpt-retired", effort: "default" } });

    expect(newThreadEffortOptions("claudeCode", haiku, context)).toEqual([
      { label: "Model default", value: "default" },
    ]);
    expect(newThreadEffortValue("claudeCode", haiku, context)).toBe("default");
    expect(values(newThreadEffortOptions("codex", retired, context))).toEqual(["default"]);
  });

  it("shows the model default while a stored Codex effort is not supported by the model", () => {
    const stale = defaultsWith({ codex: { model: "gpt-6-luna", effort: "ultra" } });
    const supported = defaultsWith({ codex: { model: "gpt-6-luna", effort: "high" } });

    expect(newThreadEffortValue("codex", stale, context)).toBe("default");
    expect(newThreadEffortValue("codex", supported, context)).toBe("high");
  });
});

describe("new thread default updaters", () => {
  const customized: AgentNewThreadDefaults = {
    source: "lastUsed",
    claudeCode: { model: "claude-opus-5-5", effort: "ultracode" },
    codex: { model: "gpt-6.1-sol", effort: "xhigh" },
  };

  it("resets an effort the new model does not support in the same update", () => {
    expect(withNewThreadModel(customized, "claudeCode", "claude-sonnet-5", context)).toEqual({
      source: "lastUsed",
      claudeCode: { model: "claude-sonnet-5", effort: "default" },
      codex: { model: "gpt-6.1-sol", effort: "xhigh" },
    });
    expect(withNewThreadModel(customized, "codex", "gpt-6-luna", context)).toEqual({
      source: "lastUsed",
      claudeCode: { model: "claude-opus-5-5", effort: "ultracode" },
      codex: { model: "gpt-6-luna", effort: "default" },
    });
  });

  it("keeps an effort the new model supports", () => {
    const high = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "high" } });
    const codexHigh = defaultsWith({ codex: { model: "gpt-6.1-sol", effort: "high" } });

    expect(withNewThreadModel(high, "claudeCode", "default", context)?.claudeCode).toEqual({
      model: "default",
      effort: "high",
    });
    expect(withNewThreadModel(codexHigh, "codex", "gpt-6-luna", context)?.codex).toEqual({
      model: "gpt-6-luna",
      effort: "high",
    });
  });

  it("rejects a model that is not offered or is marked unavailable", () => {
    const retired = defaultsWith({ codex: { model: "gpt-retired", effort: "default" } });

    expect(withNewThreadModel(customized, "claudeCode", "claude-unknown", context)).toBeNull();
    expect(withNewThreadModel(customized, "claudeCode", "claude-opus-4-5", context)).toBeNull();
    expect(withNewThreadModel(customized, "codex", "gpt-5.5", context)).toBeNull();
    expect(withNewThreadModel(retired, "codex", "gpt-retired", context)).toBeNull();
  });

  it("changes one provider effort without touching any other field", () => {
    expect(withNewThreadEffort(customized, "claudeCode", "max", context)).toEqual({
      source: "lastUsed",
      claudeCode: { model: "claude-opus-5-5", effort: "max" },
      codex: { model: "gpt-6.1-sol", effort: "xhigh" },
    });
    expect(withNewThreadEffort(customized, "codex", "default", context)).toEqual({
      source: "lastUsed",
      claudeCode: { model: "claude-opus-5-5", effort: "ultracode" },
      codex: { model: "gpt-6.1-sol", effort: "default" },
    });
  });

  it("rejects an effort the selected model does not offer", () => {
    const luna = defaultsWith({ codex: { model: "gpt-6-luna", effort: "default" } });

    expect(withNewThreadEffort(luna, "codex", "ultra", context)).toBeNull();
    expect(
      withNewThreadEffort(defaultAgentNewThreadDefaults(), "claudeCode", "default", context),
    ).toBeNull();
    expect(withNewThreadEffort(luna, "codex", "ultracode", context)).toBeNull();
    expect(
      withNewThreadEffort(defaultAgentNewThreadDefaults(), "claudeCode", "ultracode", context),
    ).toBeNull();
  });

  it("changes the launch source without touching the provider defaults", () => {
    expect(withNewThreadLaunchSource(customized, "defaults")).toEqual({
      ...customized,
      source: "defaults",
    });
    expect(withNewThreadLaunchSource(customized, "sometimes")).toBeNull();
  });

  it("never mutates the defaults it was given", () => {
    const frozen = Object.freeze({
      source: "defaults" as const,
      claudeCode: Object.freeze({ model: "claude-opus-5-5" as const, effort: "high" as const }),
      codex: Object.freeze({ model: "default" as const, effort: "default" as const }),
    });

    expect(withNewThreadModel(frozen, "claudeCode", "claude-sonnet-5", context)).not.toBe(frozen);
    expect(withNewThreadEffort(frozen, "claudeCode", "low", context)?.claudeCode.effort).toBe(
      "low",
    );
    expect(frozen.claudeCode).toEqual({ model: "claude-opus-5-5", effort: "high" });
  });

  it("describes each launch source", () => {
    expect(newThreadLaunchSourceDescription("defaults")).toBe(
      "Every new thread starts from the defaults above.",
    );
    expect(newThreadLaunchSourceDescription("lastUsed")).toBe(
      "A new thread reuses the model and effort of the last thread in that project.",
    );
  });
});

describe("new thread provider selection", () => {
  it("derives enablement from the provider preferences", () => {
    const preferences = defaultAgentProviderPreferences();

    expect(
      agentProviderEnablement({
        ...preferences,
        codex: { ...preferences.codex, enabled: false },
      }),
    ).toEqual(CODEX_DISABLED);
  });

  it("distinguishes a selected, a selected but disabled, and no enabled provider", () => {
    expect(newThreadProviderSelection("codex", BOTH_ENABLED)).toEqual({
      kind: "selected",
      provider: "codex",
    });
    expect(newThreadProviderSelection("codex", CODEX_DISABLED)).toEqual({
      kind: "selectedDisabled",
      provider: "codex",
    });
    expect(newThreadProviderSelection("codex", NONE_ENABLED)).toEqual({ kind: "noneEnabled" });
  });

  it("explains why no tile is checked", () => {
    expect(newThreadSelectionNote({ kind: "selected", provider: "codex" })).toBeNull();
    expect(newThreadSelectionNote({ kind: "selectedDisabled", provider: "codex" })).toBe(
      "Codex is the default provider but it is disabled. Choose another provider or enable Codex under Providers.",
    );
    expect(newThreadSelectionNote({ kind: "noneEnabled" })).toBe(
      "No provider is enabled. Enable one under Providers to start new threads.",
    );
  });

  it("never checks a tile while the stored provider is disabled", () => {
    const selection = newThreadProviderSelection("codex", CODEX_DISABLED);

    expect(newThreadTileState("codex", selection, CODEX_DISABLED)).toBe("disabled");
    expect(newThreadTileState("claudeCode", selection, CODEX_DISABLED)).toBe("available");
    expect(
      newThreadTileState("claudeCode", { kind: "selected", provider: "claudeCode" }, BOTH_ENABLED),
    ).toBe("checked");
  });

  it("words the tile footnote for each state", () => {
    expect(newThreadTileFootnote("claudeCode", "checked")).toBe("New threads start here");
    expect(newThreadTileFootnote("codex", "available")).toBe("Used when you switch to Codex");
    expect(newThreadTileFootnote("codex", "disabled")).toBe(
      "Enable Codex under Providers to use it",
    );
  });

  it("puts the tab stop on the checked tile, else on the first enabled one", () => {
    expect(newThreadTabStop({ kind: "selected", provider: "codex" }, BOTH_ENABLED)).toBe("codex");
    expect(newThreadTabStop({ kind: "selectedDisabled", provider: "codex" }, CODEX_DISABLED)).toBe(
      "claudeCode",
    );
    expect(newThreadTabStop({ kind: "noneEnabled" }, NONE_ENABLED)).toBeNull();
  });

  it("moves arrow keys to the other enabled provider and wraps", () => {
    expect(newThreadArrowTarget("claudeCode", 1, BOTH_ENABLED)).toBe("codex");
    expect(newThreadArrowTarget("claudeCode", -1, BOTH_ENABLED)).toBe("codex");
    expect(newThreadArrowTarget("codex", 1, BOTH_ENABLED)).toBe("claudeCode");
    expect(newThreadArrowTarget("claudeCode", 1, CODEX_DISABLED)).toBeNull();
  });
});

describe("new thread preview", () => {
  it("previews the default Claude Code launch with model, effort and context", () => {
    const preview = newThreadPreview("claudeCode", defaultAgentNewThreadDefaults(), context);

    expect(preview.provider).toBe("claudeCode");
    expect(preview.chips).toEqual([
      { kind: "provider", label: "Claude Code" },
      { kind: "model", label: "Claude Sonnet 5" },
      { kind: "effort", label: "High" },
      { kind: "context", label: "1M context" },
    ]);
    expect(preview.summary).toBe(
      "New thread preview: Claude Code, Claude Sonnet 5, High effort, 1M context",
    );
  });

  it("omits the effort chip when Codex runs on the model default", () => {
    const preview = newThreadPreview("codex", defaultAgentNewThreadDefaults(), context);

    expect(chipLabels(preview)).toEqual(["Codex", "GPT-6.1-Sol"]);
    expect(preview.summary).toBe("New thread preview: Codex, GPT-6.1-Sol");
  });

  it("previews an explicit Codex model and effort", () => {
    const defaults = defaultsWith({ codex: { model: "gpt-6-luna", effort: "high" } });

    expect(chipLabels(newThreadPreview("codex", defaults, context))).toEqual([
      "Codex",
      "GPT-6-Luna",
      "High",
    ]);
  });

  it("omits the context chip for a model without context windows", () => {
    const defaults = defaultsWith({ claudeCode: { model: "claude-opus-4-5", effort: "max" } });

    expect(chipLabels(newThreadPreview("claudeCode", defaults, context))).toEqual([
      "Claude Code",
      "Claude Opus 4.5",
      "Max",
    ]);
  });

  it("omits an effort the previewed model does not support", () => {
    const defaults = defaultsWith({ codex: { model: "gpt-6-luna", effort: "ultra" } });

    expect(chipLabels(newThreadPreview("codex", defaults, context))).toEqual([
      "Codex",
      "GPT-6-Luna",
    ]);
  });

  it("previews the model Codex really dispatches when the stored model left the catalog", () => {
    const defaults = defaultsWith({ codex: { model: "gpt-retired", effort: "high" } });
    const dispatched = agentLaunchForDispatch(
      newThreadComposerLaunch("codex", defaults),
      null,
      NEW_THREAD_CLAUDE_CATALOG,
      NEW_THREAD_CODEX_CATALOG,
    );
    const preview = newThreadPreview("codex", defaults, context);

    expect(dispatched.model).toBe("gpt-6.1-sol");
    expect(chipLabels(preview)).toEqual([
      "Codex",
      agentLaunchModelLabel(dispatched, null, NEW_THREAD_CLAUDE_CATALOG, NEW_THREAD_CODEX_CATALOG),
    ]);
    expect(preview.summary).toBe("New thread preview: Codex, GPT-6.1-Sol");
    expect(newThreadModelValue("codex", defaults, context)).toBe("gpt-retired");
    expect(last(newThreadModelOptions("codex", defaults, context))).toEqual({
      disabled: true,
      label: "gpt-retired (unavailable)",
      value: "gpt-retired",
    });
    expect(defaults.codex).toEqual({ model: "gpt-retired", effort: "high" });
  });

  it("previews the configured Codex model for the provider default and a retired model", () => {
    const configured = newThreadModelContextFixture({
      configuredModel: { claudeCode: null, codex: "gpt-6-luna" },
    });
    const retired = defaultsWith({ codex: { model: "gpt-retired", effort: "default" } });

    expect(
      chipLabels(newThreadPreview("codex", defaultAgentNewThreadDefaults(), configured)),
    ).toEqual(["Codex", "GPT-6-Luna"]);
    expect(chipLabels(newThreadPreview("codex", retired, configured))).toEqual([
      "Codex",
      "GPT-6-Luna",
    ]);
  });

  it("previews the configured Claude model for the provider default", () => {
    const configured = newThreadModelContextFixture({
      configuredModel: { claudeCode: "claude-opus-5-5[1m]", codex: null },
    });

    expect(
      chipLabels(newThreadPreview("claudeCode", defaultAgentNewThreadDefaults(), configured)),
    ).toEqual(["Claude Code", "Claude Opus 5.5", "High", "1M context"]);
  });

  it("previews the composer fallback for a Claude model that left the catalog", () => {
    const defaults = defaultsWith({ claudeCode: { model: "claude-retired-1", effort: "max" } });
    const composer = newThreadComposerLaunch(
      "claudeCode",
      availableNewThreadDefaults(defaults, NEW_THREAD_CLAUDE_CATALOG),
    );
    const preview = newThreadPreview("claudeCode", defaults, context);

    expect(composer.model).toBe("default");
    expect(chipLabels(preview)).toEqual([
      "Claude Code",
      agentLaunchModelLabel(composer, null, NEW_THREAD_CLAUDE_CATALOG, NEW_THREAD_CODEX_CATALOG),
      "Max",
      "1M context",
    ]);
    expect(chipLabels(preview)).toContain("Claude Sonnet 5");
    expect(newThreadModelValue("claudeCode", defaults, context)).toBe("claude-retired-1");
    expect(last(newThreadModelOptions("claudeCode", defaults, context))).toEqual({
      disabled: true,
      label: "claude-retired-1 (unavailable)",
      value: "claude-retired-1",
    });
  });

  it("previews the resolved Claude effort for a stored default and an unsupported effort", () => {
    const stored = defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "default" } });
    const stale = defaultsWith({ claudeCode: { model: "claude-opus-4-5", effort: "xhigh" } });
    const none = defaultsWith({ claudeCode: { model: "claude-haiku-4-5", effort: "default" } });

    expect(chipLabels(newThreadPreview("claudeCode", stored, context))).toEqual([
      "Claude Code",
      "Claude Opus 5.5",
      "High",
      "1M context",
    ]);
    expect(chipLabels(newThreadPreview("claudeCode", stale, context))).toEqual([
      "Claude Code",
      "Claude Opus 4.5",
      "Medium",
    ]);
    expect(chipLabels(newThreadPreview("claudeCode", none, context))).toEqual([
      "Claude Code",
      "Claude Haiku 4.5",
    ]);
  });

  it("never lets the effort chip disagree with the selected effort option", () => {
    const cases: ReadonlyArray<AgentNewThreadDefaults> = [
      defaultAgentNewThreadDefaults(),
      defaultsWith({ claudeCode: { model: "claude-opus-5-5", effort: "default" } }),
      defaultsWith({ claudeCode: { model: "claude-sonnet-5", effort: "ultracode" } }),
      defaultsWith({ claudeCode: { model: "claude-opus-4-5", effort: "xhigh" } }),
      defaultsWith({ claudeCode: { model: "claude-haiku-4-5", effort: "max" } }),
      defaultsWith({ claudeCode: { model: "claude-retired-1", effort: "ultracode" } }),
      defaultsWith({ codex: { model: "gpt-6-luna", effort: "ultra" } }),
      defaultsWith({ codex: { model: "gpt-6.1-sol", effort: "ultra" } }),
      defaultsWith({ codex: { model: "gpt-retired", effort: "high" } }),
    ];
    const providers = ["claudeCode", "codex"] as const;
    const observed = cases.flatMap((defaults) =>
      providers.map((provider) => {
        const value = newThreadEffortValue(provider, defaults, context);
        const selected = newThreadEffortOptions(provider, defaults, context).find(
          (option) => option.value === value,
        );
        const chip = newThreadPreview(provider, defaults, context).chips.find(
          (candidate) => candidate.kind === "effort",
        );

        return { selected: selected?.label, chip: chip?.label ?? "Model default" };
      }),
    );

    expect(observed.map((entry) => entry.selected)).toEqual(observed.map((entry) => entry.chip));
    expect(observed.map((entry) => entry.selected)).not.toContain(undefined);
  });
});
