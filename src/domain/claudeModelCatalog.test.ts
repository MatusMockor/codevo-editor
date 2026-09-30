import { describe, expect, it } from "vitest";
import {
  parseAgentLaunchOptions,
  parseStoredAgentLaunchOptions,
  serializeAgentLaunchOptions,
} from "./agentLaunch";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  claudeModelDescription,
  parseClaudeModelManifest,
} from "./claudeModelCatalog";
import bundledManifest from "./claudeModelManifest.json";

const model = { ...bundledManifest.claudeCode[0], isDefault: true };
const manifest = (patch: Record<string, unknown> = {}) => ({
  version: 1,
  updatedAt: "2026-09-22T00:00:00Z",
  claudeCode: [model],
  ...patch,
});

describe("Claude model manifest", () => {
  it("validates the shared bundle into a deeply immutable snapshot", () => {
    expect(BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode).toHaveLength(12);
    const parsed = parseClaudeModelManifest(manifest());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.claudeCode)).toBe(true);
    expect(Object.isFrozen(parsed.claudeCode[0])).toBe(true);
    expect(Object.isFrozen(parsed.claudeCode[0].runtimeIds)).toBe(true);
    expect(parsed.claudeCode[0]).not.toBe(model);
  });

  it("round trips a remotely added model through launch and persisted settings", () => {
    const added = {
      ...model,
      choice: "claude-future-6",
      runtimeIds: ["claude-future-6"],
      minVersion: "2.1.0",
      maxVersionExclusive: "3.0.0",
    };
    expect(parseClaudeModelManifest(manifest({ claudeCode: [added] })).claudeCode[0]).toEqual(
      added,
    );
    const launch = {
      provider: "claudeCode",
      model: added.choice,
      mode: "default",
      effort: "default",
    };
    expect(parseAgentLaunchOptions(launch, "launch")).toEqual(launch);
    expect(
      parseStoredAgentLaunchOptions(
        serializeAgentLaunchOptions(parseAgentLaunchOptions(launch, "launch")),
        "launch",
      ),
    ).toEqual(launch);
  });

  it("preserves validated immutable effort remapping for newly discovered models", () => {
    const entry = {
      ...model,
      choice: "claude-future-6",
      runtimeIds: ["claude-future-6"],
      efforts: ["xhigh", "max", "ultracode", "ultrathink"],
      defaultEffort: "xhigh",
      effortMap: { xhigh: "max", max: "high", ultracode: "xhigh", ultrathink: null },
    };
    const parsed = parseClaudeModelManifest(manifest({ claudeCode: [entry] })).claudeCode[0];
    expect(parsed.effortMap).toEqual(entry.effortMap);
    expect(Object.isFrozen(parsed.effortMap)).toBe(true);
  });

  it.each([
    null,
    [],
    { default: "high" },
    { xhigh: "--help" },
    { xhigh: null },
    { ultracode: "max" },
    { ultrathink: "high" },
    { unknown: "high" },
    { high: "high" },
  ])("rejects unsafe or unreferenced effort mappings %j", (effortMap) => {
    expect(() =>
      parseClaudeModelManifest(
        manifest({
          claudeCode: [
            {
              ...model,
              efforts: ["xhigh", "ultracode", "ultrathink"],
              defaultEffort: "xhigh",
              effortMap,
            },
          ],
        }),
      ),
    ).toThrow(TypeError);
  });

  it.each([
    { version: 2 },
    { updatedAt: "2019-09-22T00:00:00Z" },
    { claudeCode: [{ ...model, isDefault: false }] },
    { extra: true },
    { updatedAt: "2026-02-30T00:00:00Z" },
    { updatedAt: "2026-09-22T00:00:00+00:00" },
    { updatedAt: "" },
    { claudeCode: [] },
    { claudeCode: Array.from({ length: 129 }, () => model) },
    { claudeCode: [model, model] },
    {
      claudeCode: [
        { ...model, isDefault: true },
        { ...model, choice: "claude-other", runtimeIds: ["claude-other"], isDefault: true },
      ],
    },
    {
      claudeCode: [
        model,
        { ...model, choice: "claude-other", runtimeIds: ["claude-other", model.choice] },
      ],
    },
  ])("rejects malformed and ambiguous manifests %j", (patch) => {
    expect(() => parseClaudeModelManifest(manifest(patch))).toThrow(TypeError);
  });

  it.each([
    { extra: true },
    { choice: "opus" },
    { choice: "claude-x--y" },
    { choice: `claude-${"x".repeat(96)}` },
    { label: "x".repeat(129) },
    { label: "é".repeat(65) },
    { description: "unsafe\u0085text" },
    { defaultEffort: "default" },
    { defaultContext: null },
    { description: "unsafe\ntext" },
    { runtimeIds: [] },
    { runtimeIds: ["fable"] },
    { label: " Claude Fable " },
    { minVersion: null },
    { maxVersionExclusive: null },
    { isDefault: null },
    { runtimeIds: ["foo", "foo"] },
    { runtimeIds: ["--model"] },
    { runtimeIds: Array.from({ length: 17 }, (_, i) => `model-${i}`) },
    { efforts: ["default"] },
    { efforts: ["high", "high"] },
    { efforts: [], defaultEffort: "high" },
    { contextWindows: ["2m"] },
    { contextWindows: [], defaultContext: "1m" },
    { contextWindows: ["1m", "1m"] },
    { fastMode: "true" },
    { thinkingMode: null },
    { isDefault: 1 },
    { status: "retired" },
    { minVersion: "2.01.0" },
    { minVersion: "2.1000000.0" },
    { minVersion: "2.0" },
    { minVersion: "3.0.0", maxVersionExclusive: "2.0.0" },
    { minVersion: "2.0.0", maxVersionExclusive: "2.0.0" },
  ])("rejects unsupported model fields %j", (patch) => {
    expect(() =>
      parseClaudeModelManifest(manifest({ claudeCode: [{ ...model, ...patch }] })),
    ).toThrow(TypeError);
  });

  it.each([
    "claude-",
    "claude-opus--6",
    "claude-X",
    "claude-foo --danger",
    "claude-foo\n",
    `claude-${"x".repeat(96)}`,
  ])("rejects unsafe launch identifiers %s", (model) => {
    expect(() =>
      parseStoredAgentLaunchOptions(
        { provider: "claudeCode", model, mode: "default", effort: "default" },
        "launch",
      ),
    ).toThrow(TypeError);
  });
});

describe("Claude model manifest schema", () => {
  it("accepts live newness, release date and a missing description as closed optional metadata", () => {
    const { description: _description, ...withoutDescription } = model;
    const parsed = parseClaudeModelManifest(
      manifest({
        source: "live",
        claudeCode: [{ ...withoutDescription, isNew: true, releaseDate: "2026-09-22" }],
      }),
    );
    expect(parsed.source).toBe("live");
    expect(parsed.claudeCode[0]).toMatchObject({ isNew: true, releaseDate: "2026-09-22" });
    expect(parsed.claudeCode[0].description).toBeUndefined();
  });

  it("rejects malformed newness metadata", () => {
    for (const patch of [
      { isNew: "yes" },
      { releaseDate: "2026-02-30" },
      { releaseDate: "22.09.2026" },
      { description: "" },
    ]) {
      expect(() =>
        parseClaudeModelManifest(manifest({ claudeCode: [{ ...model, ...patch }] })),
      ).toThrow(TypeError);
    }
    expect(() => parseClaudeModelManifest(manifest({ source: "bundled" }))).toThrow(TypeError);
  });

  it("dates every bundled model and never ships a label-echo description", () => {
    for (const entry of BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode) {
      expect(entry.releaseDate, entry.choice).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claudeModelDescription(entry) ?? "", entry.choice).not.toMatch(
        new RegExp(`^(Legacy )?${entry.label}( model)?\\.$`),
      );
    }
  });

  it("bundles Claude Sonnet 5.5 under its live catalog id with the official copy", () => {
    const sonnet = BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.find(
      (entry) => entry.choice === "claude-sonnet-5-5",
    );
    expect(sonnet).toMatchObject({
      label: "Claude Sonnet 5.5",
      description: "The best combination of speed and intelligence.",
      releaseDate: "2026-09-28",
      status: "current",
    });
    expect(sonnet?.runtimeIds).toEqual(["sonnet-5.5", "claude-sonnet-5.5", "claude-sonnet-5-5"]);
    const haiku = BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.find(
      (entry) => entry.choice === "claude-haiku-4-5",
    );
    expect(haiku?.description).toBe("The fastest model with near-frontier intelligence.");
  });

  it("falls back to the bundled description for a live model and to none otherwise", () => {
    const { description: _description, ...live } = model;
    const parsed = parseClaudeModelManifest(
      manifest({
        claudeCode: [
          live,
          { ...live, isDefault: false, choice: "claude-future-6", runtimeIds: ["claude-future-6"] },
        ],
      }),
    );
    expect(claudeModelDescription(parsed.claudeCode[0])).toBe(
      BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode[0].description,
    );
    expect(claudeModelDescription(parsed.claudeCode[1])).toBeNull();
  });
});
