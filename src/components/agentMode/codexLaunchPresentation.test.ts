import { describe, expect, it } from "vitest";
import type { CodexLaunchOptions } from "../../domain/agentLaunch";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  parseCodexModelCatalog,
} from "../../domain/codexModelCatalog";
import {
  agentLaunchEffortLabel,
  agentLaunchForDispatch,
  agentLaunchModelHint,
  agentLaunchModelLabel,
  agentLaunchWithEffort,
  agentLaunchWithModel,
  agentModelRows,
} from "./agentLaunchPresentation";
import { codexLaunchTraits, codexUnavailableModelNotice } from "./codexLaunchPresentation";

const liveModel = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  label: id.toUpperCase(),
  description: `${id} description.`,
  status: "current",
  isDefault: false,
  efforts: ["low", "medium", "high"],
  defaultEffort: "medium",
  upgradeTo: null,
  ...patch,
});

const live = parseCodexModelCatalog({
  version: 1,
  source: "live",
  revision: 4,
  models: [
    liveModel("gpt-7-nova", { isDefault: true, efforts: ["low", "ultra"], defaultEffort: "low" }),
    liveModel("gpt-6-astra"),
    liveModel("gpt-5.5", {
      status: "legacy",
      upgradeTo: "gpt-7-nova",
      efforts: [],
      defaultEffort: null,
    }),
  ],
});

const codex = (patch: Partial<CodexLaunchOptions> = {}): CodexLaunchOptions => ({
  provider: "codex",
  model: "default",
  mode: "workspaceWrite",
  ...patch,
});

describe("Codex model picker rows", () => {
  it("lists live models in catalog order with every description as the subtitle", () => {
    const rows = agentModelRows("codex", null, null, undefined, live);
    expect(rows.map((row) => [row.value, row.label, row.hint])).toEqual([
      ["gpt-7-nova", "GPT-7-NOVA", "gpt-7-nova description."],
      ["gpt-6-astra", "GPT-6-ASTRA", "gpt-6-astra description."],
      ["gpt-5.5", "GPT-5.5", "gpt-5.5 description."],
    ]);
    expect(rows.find((row) => row.isDefault)?.value).toBe("gpt-7-nova");
    expect(rows.filter((row) => row.isLegacy).map((row) => row.value)).toEqual(["gpt-5.5"]);
  });

  it("adds the configuration hint only to the configured model", () => {
    const rows = agentModelRows("codex", "gpt-6-astra", null, undefined, live);
    const hinted = rows.filter((row) => row.hint?.includes("Selected by your Codex configuration"));
    expect(hinted.map((row) => row.value)).toEqual(["gpt-6-astra"]);
    expect(hinted[0].hint).toBe("gpt-6-astra description. Selected by your Codex configuration.");
    expect(rows.every((row) => !row.hint?.startsWith("Runs the session on"))).toBe(true);
  });

  it("falls back to the bundled catalog without hidden or internal models", () => {
    const rows = agentModelRows("codex");
    expect(rows.map((row) => row.value)).toEqual(
      BUNDLED_CODEX_MODEL_CATALOG.models.map((model) => model.id),
    );
    expect(rows.map((row) => row.value)).not.toContain("codex-auto-review");
    expect(
      rows.every((row) => row.hint !== null && row.hint.length > 0 && !row.hint.includes("\n")),
    ).toBe(true);
  });
});

describe("Codex effort follows the model", () => {
  it("offers only the efforts of the selected or effective default model", () => {
    expect(codexLaunchTraits(codex(), null, live)).toEqual({
      efforts: ["low", "ultra"],
      defaultEffort: "low",
    });
    expect(codexLaunchTraits(codex({ model: "gpt-6-astra" }), null, live).efforts).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(codexLaunchTraits(codex({ model: "gpt-5.5" }), null, live)).toEqual({
      efforts: [],
      defaultEffort: null,
    });
    expect(codexLaunchTraits(codex(), "gpt-6-astra", live).defaultEffort).toBe("medium");
  });

  it("resets the effort when the model changes and refuses models outside the catalog", () => {
    const chosen = agentLaunchWithEffort(codex(), "ultra", null, undefined, live);
    expect(chosen).toEqual(codex({ model: "gpt-7-nova", effort: "ultra" }));
    expect(agentLaunchEffortLabel(chosen)).toBe("Ultra");
    expect(agentLaunchWithModel(chosen, "gpt-6-astra", null, undefined, live)).toEqual(
      codex({ model: "gpt-6-astra" }),
    );
    expect(agentLaunchWithModel(chosen, "gpt-5.4", null, undefined, live)).toBe(chosen);
    expect(agentLaunchWithModel(chosen, "--help", null, undefined, live)).toBe(chosen);
  });

  it("drops an effort the model does not support before dispatch", () => {
    expect(
      agentLaunchForDispatch(
        codex({ model: "gpt-6-astra", effort: "ultra" }),
        null,
        undefined,
        live,
      ),
    ).toEqual(codex({ model: "gpt-6-astra" }));
    expect(
      agentLaunchForDispatch(
        codex({ model: "gpt-7-nova", effort: "ultra" }),
        null,
        undefined,
        live,
      ),
    ).toEqual(codex({ model: "gpt-7-nova", effort: "ultra" }));
  });
});

describe("Codex stored launches whose model disappeared", () => {
  it("dispatch the Codex default with a visible note and keep the stored choice", () => {
    const stored = codex({ model: "gpt-5.4", effort: "high" });
    expect(agentLaunchForDispatch(stored, null, undefined, live)).toEqual(
      codex({ model: "gpt-7-nova" }),
    );
    expect(agentLaunchForDispatch(stored, "gpt-6-astra", undefined, live)).toEqual(
      codex({ model: "gpt-6-astra" }),
    );
    expect(codexUnavailableModelNotice(stored, live)).toBe(
      "gpt-5.4 is no longer available in Codex. This turn uses your Codex default model instead.",
    );
    expect(stored.model).toBe("gpt-5.4");
  });

  it("does not override an unlisted model from the Codex configuration", () => {
    expect(agentLaunchForDispatch(codex({ model: "gpt-5.4" }), "o3", undefined, live)).toEqual(
      codex(),
    );
    expect(agentLaunchModelLabel(codex(), "o3", undefined, live)).toBe("Auto (Codex)");
    expect(agentLaunchModelHint(codex(), "o3", undefined, live)).toContain("Codex CLI chooses");
  });

  it("restores the stored model once the live catalog offers it again", () => {
    const stored = codex({ model: "gpt-7-nova", effort: "ultra" });
    expect(codexUnavailableModelNotice(stored, BUNDLED_CODEX_MODEL_CATALOG)).not.toBeNull();
    expect(codexUnavailableModelNotice(stored, live)).toBeNull();
    expect(agentLaunchForDispatch(stored, null, undefined, live)).toEqual(stored);
  });
});
