import { describe, expect, it } from "vitest";
import {
  countSourceLines,
  countStructuralTokens,
  evaluateHotspotSizes,
  formatHotspotBaseline,
  isProductionSource,
  matchesGlob,
  reducedBaselineUpdate,
  trackedGroupSize,
} from "./check-hotspot-size-budget.mjs";

describe("hotspot size ratchet", () => {
  it("counts source lines with or without a trailing newline", () => {
    expect(countSourceLines("")).toBe(0);
    expect(countSourceLines("one\ntwo\n")).toBe(2);
    expect(countSourceLines("one\ntwo")).toBe(2);
  });

  it("keeps the architectural score stable across wrapping and comments", () => {
    const compact = "const result = load(userId, projectId);";
    const wrapped = `
      // The formatter may wrap this call without changing its architecture.
      const result = load(
        userId,
        projectId,
      );
    `;

    expect(countStructuralTokens(wrapped)).toBe(countStructuralTokens(compact));
  });

  it("ignores optional statement terminators", () => {
    expect(countStructuralTokens("const value = load()")).toBe(
      countStructuralTokens("const value = load();"),
    );
  });

  it("counts executable expressions inside template literals", () => {
    const staticTemplate = "const label = `User`;";
    const computedTemplate = "const label = `User ${loadProfile(userId).displayName}`;";

    expect(countStructuralTokens(computedTemplate)).toBeGreaterThan(
      countStructuralTokens(staticTemplate),
    );
  });

  it("counts nested template expressions while ignoring their literal text", () => {
    const compact = "const label = `outer ${format(`inner ${load(id)}`)}`;";
    const wrapped = `
      const label = \`outer \${
        // Formatting and comments must not change the score.
        format(\`inner \${load(id)}\`)
      }\`;
    `;

    expect(countStructuralTokens(wrapped)).toBe(countStructuralTokens(compact));
    expect(countStructuralTokens(compact)).toBeGreaterThan(
      countStructuralTokens("const label = `outer inner`;"),
    );
  });

  it("does not end a template expression on a brace inside a regex literal", () => {
    const regexOnly = "const valid = `${/}/.test(value)}`;";
    const withAdditionalWork = "const valid = `${/}/.test(value) && loadPolicy(value)}`;";

    expect(countStructuralTokens(withAdditionalWork)).toBeGreaterThan(
      countStructuralTokens(regexOnly),
    );
  });

  it("does not swallow Rust code between lifetime annotations", () => {
    const withoutField = "struct Borrowed<'a> { borrowed: &'a str }";
    const withField = "struct Borrowed<'a> { owned: String, borrowed: &'a str }";

    expect(countStructuralTokens(withField, "fixture.rs")).toBeGreaterThan(
      countStructuralTokens(withoutField, "fixture.rs"),
    );
  });

  it("keeps Rust character literals atomic", () => {
    const literal = "let delimiter = '\\n';";
    const equivalentLiteral = "let delimiter = 'x';";

    expect(countStructuralTokens(literal, "fixture.rs")).toBe(
      countStructuralTokens(equivalentLiteral, "fixture.rs"),
    );
  });

  it("distinguishes production sources from tests", () => {
    expect(isProductionSource("src/application/useFeature.ts")).toBe(true);
    expect(isProductionSource("src/application/useFeature.test.ts")).toBe(false);
    expect(isProductionSource("src-tauri/src/lib.rs")).toBe(true);
  });

  it("matches aggregate group globs across direct and nested files", () => {
    expect(matchesGlob("src/preview/a.test.tsx", "src/preview/**/*.tsx")).toBe(true);
    expect(matchesGlob("src/preview/nested/a.test.tsx", "src/preview/**/*.tsx")).toBe(true);
    expect(matchesGlob("src/preview/a.test.ts", "src/preview/**/*.tsx")).toBe(false);
  });

  it("aggregates raw lines and structural tokens for every matching member", () => {
    expect(
      trackedGroupSize(
        { patterns: ["src/preview.test.tsx", "src/preview/**/*.ts*"] },
        {
          "src/preview.test.tsx": { rawLines: 10, structuralTokens: 20 },
          "src/preview/a.test.tsx": { rawLines: 30, structuralTokens: 40 },
          "src/unrelated.test.tsx": { rawLines: 100, structuralTokens: 200 },
        },
      ),
    ).toEqual({
      members: ["src/preview.test.tsx", "src/preview/a.test.tsx"],
      rawLines: 40,
      structuralTokens: 60,
    });
  });

  it("ratchets aggregate raw lines and structural tokens independently", () => {
    const baseline = {
      files: {},
      groups: {
        preview: {
          patterns: ["src/preview/**/*.tsx"],
          members: ["src/preview/a.test.tsx", "src/preview/b.test.tsx"],
          rawLines: 30,
          structuralTokens: 40,
        },
      },
      productionLineLimit: 20,
      productionStructuralTokenLimit: 100,
    };
    const currentFiles = {
      "src/preview/a.test.tsx": { rawLines: 10, structuralTokens: 21 },
      "src/preview/b.test.tsx": { rawLines: 21, structuralTokens: 19 },
    };

    const result = evaluateHotspotSizes(baseline, currentFiles, new Set());

    expect(result.groupGrowth).toEqual([
      {
        actual: { rawLines: 31, structuralTokens: 40 },
        expected: { rawLines: 30, structuralTokens: 40 },
        path: "preview",
      },
    ]);
    expect(result.groupMembershipChanges).toEqual([]);
    expect(result.groupReductions).toEqual([]);
  });

  it.each([
    {
      label: "addition",
      files: {
        "src/preview/a.test.tsx": { rawLines: 10, structuralTokens: 10 },
        "src/preview/b.test.tsx": { rawLines: 10, structuralTokens: 10 },
      },
    },
    { label: "removal", files: {} },
    {
      label: "rename",
      files: { "src/preview/renamed.test.tsx": { rawLines: 10, structuralTokens: 10 } },
    },
  ])(
    "rejects aggregate membership $label instead of allowing a split-suite escape",
    ({ files }) => {
      const result = evaluateHotspotSizes(
        {
          files: {},
          groups: {
            preview: {
              patterns: ["src/preview/**/*.tsx"],
              members: ["src/preview/a.test.tsx"],
              rawLines: 10,
              structuralTokens: 10,
            },
          },
          productionLineLimit: 20,
          productionStructuralTokenLimit: 100,
        },
        files,
        new Set(),
      );

      expect(result.groupMembershipChanges).toHaveLength(1);
    },
  );

  it("rejects tracked growth and requires reductions to be recorded", () => {
    const result = evaluateHotspotSizes(
      {
        files: {
          "src/grown.ts": { rawLines: 10, structuralTokens: 10 },
          "src/reduced.ts": { rawLines: 10, structuralTokens: 10 },
        },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      {
        "src/grown.ts": { rawLines: 11, structuralTokens: 11 },
        "src/reduced.ts": { rawLines: 9, structuralTokens: 9 },
      },
      new Set(["src/grown.ts", "src/reduced.ts"]),
    );

    expect(result.growth).toEqual([{ actual: 11, expected: 10, path: "src/grown.ts" }]);
    expect(result.reductions).toEqual([{ actual: 9, expected: 10, path: "src/reduced.ts" }]);
  });

  it("rejects a new production file above the shared limit", () => {
    const result = evaluateHotspotSizes(
      {
        files: {},
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      { "src/newFeature.ts": { rawLines: 21, structuralTokens: 50 } },
      new Set(["src/newFeature.ts"]),
    );

    expect(result.oversizedUntracked).toEqual([
      {
        path: "src/newFeature.ts",
        rawLines: 21,
        rawLineLimit: 20,
        structuralTokens: 50,
        structuralTokenLimit: 100,
      },
    ]);
  });

  it("allows update to lower limits and remove deleted files", () => {
    const result = reducedBaselineUpdate(
      {
        files: {
          "src/deleted.ts": { rawLines: 8, structuralTokens: 8 },
          "src/reduced.ts": { rawLines: 10, structuralTokens: 10 },
        },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      { "src/reduced.ts": { rawLines: 9, structuralTokens: 9 } },
      new Set(["src/reduced.ts"]),
    );

    expect(result.violations).toEqual([]);
    expect(result.baseline.files).toEqual({
      "src/reduced.ts": { rawLines: 9, structuralTokens: 9 },
    });
  });

  it("serializes an updated baseline in the repository's Prettier format", async () => {
    const baseline = {
      files: {
        "src/reduced.ts": { rawLines: 9, structuralTokens: 9 },
      },
      groups: {
        preview: {
          patterns: ["src/preview/**/*.tsx"],
          members: ["src/preview/a.test.tsx"],
          rawLines: 10,
          structuralTokens: 20,
        },
      },
      productionLineLimit: 20,
      productionStructuralTokenLimit: 100,
    };

    const serialized = await formatHotspotBaseline(baseline);

    expect(serialized).toContain('"patterns": ["src/preview/**/*.tsx"]');
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("never raises a stored raw or structural limit during update", () => {
    const result = reducedBaselineUpdate(
      {
        files: { "src/wrapped.ts": { rawLines: 10, structuralTokens: 10 } },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      { "src/wrapped.ts": { rawLines: 20, structuralTokens: 10 } },
      new Set(["src/wrapped.ts"]),
    );

    expect(result.violations).toEqual([]);
    expect(result.baseline.files["src/wrapped.ts"]).toEqual({
      rawLines: 10,
      structuralTokens: 10,
    });
  });

  it("refuses update for tracked growth or a new oversized file", () => {
    const result = reducedBaselineUpdate(
      {
        files: { "src/grown.ts": { rawLines: 10, structuralTokens: 10 } },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      {
        "src/grown.ts": { rawLines: 11, structuralTokens: 11 },
        "src/new.ts": { rawLines: 21, structuralTokens: 101 },
      },
      new Set(["src/grown.ts", "src/new.ts"]),
    );

    expect(result.violations.map((violation) => violation.kind)).toEqual([
      "growth",
      "oversized-untracked",
    ]);
  });

  it("refuses aggregate membership changes and aggregate growth during update", () => {
    const result = reducedBaselineUpdate(
      {
        files: {},
        groups: {
          preview: {
            patterns: ["src/preview/**/*.tsx"],
            members: ["src/preview/a.test.tsx"],
            rawLines: 10,
            structuralTokens: 10,
          },
        },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      {
        "src/preview/a.test.tsx": { rawLines: 10, structuralTokens: 10 },
        "src/preview/b.test.tsx": { rawLines: 1, structuralTokens: 1 },
      },
      new Set(),
    );

    expect(result.violations.map((violation) => violation.kind)).toEqual([
      "group-growth",
      "group-membership-change",
    ]);
    expect(result.baseline.groups.preview.members).toEqual(["src/preview/a.test.tsx"]);
    expect(result.baseline.groups.preview.rawLines).toBe(10);
    expect(result.baseline.groups.preview.structuralTokens).toBe(10);
  });

  it("does not accept aggregate structural growth when raw lines decreased", () => {
    const result = reducedBaselineUpdate(
      {
        files: {},
        groups: {
          preview: {
            patterns: ["src/preview/**/*.tsx"],
            members: ["src/preview/a.test.tsx"],
            rawLines: 10,
            structuralTokens: 10,
          },
        },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      { "src/preview/a.test.tsx": { rawLines: 9, structuralTokens: 11 } },
      new Set(),
    );

    expect(result.violations.map((violation) => violation.kind)).toEqual(["group-growth"]);
    expect(result.baseline.groups.preview.structuralTokens).toBe(10);
  });

  it("only lowers aggregate raw and structural limits when membership is unchanged", () => {
    const result = reducedBaselineUpdate(
      {
        files: {},
        groups: {
          preview: {
            patterns: ["src/preview/**/*.tsx"],
            members: ["src/preview/a.test.tsx"],
            rawLines: 20,
            structuralTokens: 30,
          },
        },
        productionLineLimit: 20,
        productionStructuralTokenLimit: 100,
      },
      { "src/preview/a.test.tsx": { rawLines: 15, structuralTokens: 25 } },
      new Set(),
    );

    expect(result.violations).toEqual([]);
    expect(result.baseline.groups.preview).toEqual({
      patterns: ["src/preview/**/*.tsx"],
      members: ["src/preview/a.test.tsx"],
      rawLines: 15,
      structuralTokens: 25,
    });
  });
});
