import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/codex-model-catalog-wire.json";
import {
  CODEX_EFFORT_CHOICES,
  parseAgentLaunchOptions,
  parseStoredAgentLaunchOptions,
  serializeAgentLaunchOptions,
} from "./agentLaunch";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  codexModelReleaseDate,
  parseCodexModelCatalog,
  resolveCodexCatalogModel,
  supersedesCodexModelCatalog,
} from "./codexModelCatalog";

const live = wireContract.catalogs[0].value;

describe("Codex model catalog", () => {
  it("accepts every catalog in the shared wire contract as a deeply immutable snapshot", () => {
    for (const { name, value } of wireContract.catalogs) {
      const parsed = parseCodexModelCatalog(value);
      expect(parsed, name).toEqual(value);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.models)).toBe(true);
      expect(Object.isFrozen(parsed.models[0])).toBe(true);
      expect(Object.isFrozen(parsed.models[0].efforts)).toBe(true);
    }
  });

  it("dates every bundled model with a verified release date", () => {
    for (const entry of BUNDLED_CODEX_MODEL_CATALOG.models) {
      expect(entry.releaseDate, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(codexModelReleaseDate({ id: "gpt-6.1-sol" })).toBe("2026-09-29");
    expect(codexModelReleaseDate({ id: "gpt-future" })).toBeUndefined();
    expect(codexModelReleaseDate({ id: "gpt-future", releaseDate: "2026-10-01" })).toBe(
      "2026-10-01",
    );
  });

  it("rejects every malformed catalog in the shared wire contract", () => {
    for (const { name, value } of wireContract.rejectedCatalogs) {
      expect(() => parseCodexModelCatalog(value), name).toThrow(TypeError);
    }
  });

  it("keeps the shared limits and effort set in sync with the launch contract", () => {
    expect(CODEX_EFFORT_CHOICES.filter((effort) => effort !== "default")).toEqual(
      wireContract.limits.efforts,
    );
    const models = Array.from({ length: wireContract.limits.maxModels + 1 }, (_, index) => ({
      ...live.models[1],
      id: `gpt-${index}`,
      isDefault: index === 0,
    }));
    expect(() => parseCodexModelCatalog({ ...live, models })).toThrow(TypeError);
    expect(() =>
      parseCodexModelCatalog({ ...live, models: models.slice(0, wireContract.limits.maxModels) }),
    ).not.toThrow();
  });

  it("validates the bundled fallback with one default and no hidden models", () => {
    expect(BUNDLED_CODEX_MODEL_CATALOG.source).toBe("bundled");
    expect(BUNDLED_CODEX_MODEL_CATALOG.revision).toBe(0);
    expect(BUNDLED_CODEX_MODEL_CATALOG.models.filter((model) => model.isDefault)).toHaveLength(1);
    const ids = BUNDLED_CODEX_MODEL_CATALOG.models.map((model) => model.id);
    expect(ids).not.toContain("codex-auto-review");
    expect(ids).not.toContain("gpt-reserve");
  });

  it("bundles the curated legacy statuses and keeps the only upstream upgrade target", () => {
    const legacy = BUNDLED_CODEX_MODEL_CATALOG.models.filter((model) => model.status === "legacy");
    expect(legacy.map((model) => [model.id, model.upgradeTo])).toEqual([
      ["gpt-6-sol", null],
      ["gpt-5.6-sol", null],
      ["gpt-5.6-terra", null],
      ["gpt-5.6-luna", null],
      ["gpt-5.5", "gpt-5.6-sol"],
    ]);
    expect(legacy.some((model) => model.isDefault)).toBe(false);
  });

  it("supersedes by revision and lets only a changed bundled fallback replace the bundle", () => {
    const bundle = BUNDLED_CODEX_MODEL_CATALOG;
    const restatused = parseCodexModelCatalog({
      ...bundle,
      models: bundle.models.map((model) =>
        model.id === "gpt-6-luna" ? { ...model, status: "legacy" } : model,
      ),
    });
    const sameBundle = parseCodexModelCatalog(JSON.parse(JSON.stringify(bundle)));
    const first = parseCodexModelCatalog(live);
    const sameRevision = parseCodexModelCatalog({ ...live, models: live.models.slice(0, 1) });
    const newer = parseCodexModelCatalog({ ...live, revision: live.revision + 1 });
    expect(supersedesCodexModelCatalog(restatused, bundle)).toBe(true);
    expect(supersedesCodexModelCatalog(bundle, restatused)).toBe(true);
    expect(supersedesCodexModelCatalog(sameBundle, bundle)).toBe(false);
    expect(supersedesCodexModelCatalog(first, restatused)).toBe(true);
    expect(supersedesCodexModelCatalog(restatused, first)).toBe(false);
    expect(supersedesCodexModelCatalog(sameRevision, first)).toBe(false);
    expect(supersedesCodexModelCatalog(newer, first)).toBe(true);
    expect(supersedesCodexModelCatalog(first, newer)).toBe(false);
  });

  it("resolves the default sentinel and explicit ids only through the catalog", () => {
    const catalog = parseCodexModelCatalog(live);
    expect(resolveCodexCatalogModel(catalog, "default")?.id).toBe("gpt-6.1-sol");
    expect(resolveCodexCatalogModel(catalog, "gpt-5.5")?.status).toBe("legacy");
    expect(resolveCodexCatalogModel(catalog, "gpt-5.4")).toBeNull();
  });
});

describe("Codex launch wire contract", () => {
  it("accepts every launch in the shared contract and round trips stored launches", () => {
    for (const { name, value } of wireContract.launches) {
      const parsed = parseAgentLaunchOptions(value, name);
      expect(parsed, name).toEqual(value);
      expect(
        parseStoredAgentLaunchOptions(serializeAgentLaunchOptions(parsed), name),
        name,
      ).toEqual(value);
    }
  });

  it("rejects every malformed launch in the shared contract", () => {
    for (const { name, value } of wireContract.rejectedLaunches) {
      expect(() => parseAgentLaunchOptions(value, name), name).toThrow(TypeError);
    }
  });

  it("omits the default effort so existing stored launches keep their exact shape", () => {
    const launch = parseAgentLaunchOptions(
      { provider: "codex", model: "gpt-6-astra", mode: "default", effort: "default" },
      "launch",
    );
    expect(serializeAgentLaunchOptions(launch)).toEqual({
      provider: "codex",
      model: "gpt-6-astra",
      mode: "default",
    });
  });
});
