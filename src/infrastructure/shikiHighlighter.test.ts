import { describe, expect, it } from "vitest";
import {
  APP_SHIKI_THEMES,
  SHIKI_LANGS,
  buildShikiTheme,
  configureShikiLanguageFeatures,
  createAppHighlighter,
} from "./shikiHighlighter";
import { ayuMirage, calmDark } from "../components/themePalettes";

describe("buildShikiTheme", () => {
  it("maps palette to a TextMate theme", () => {
    const theme = buildShikiTheme(ayuMirage);
    expect(theme.name).toBe("ayu-mirage");
    expect(theme.type).toBe("dark");
    expect(theme.colors["editor.background"]).toBe("#1f2430");
    const scopeColor = (scope: string) =>
      theme.tokenColors.find((t) => t.scope.includes(scope))?.settings.foreground;
    expect(scopeColor("entity.name.function")).toBe("#ffd173");
    expect(scopeColor("keyword")).toBe("#ffad66");
    expect(scopeColor("variable.parameter")).toBe("#dfbfff");
    expect(scopeColor("constant.numeric")).toBe("#ffcc66");
  });

  it("covers the common TextMate scopes that previously fell back to variable", () => {
    const theme = buildShikiTheme(calmDark);
    const hasScope = (scope: string) =>
      theme.tokenColors.some((t) => t.scope.includes(scope));
    for (const scope of [
      "support.function",
      "support.type",
      "support.class",
      "storage.type",
      "storage.modifier",
      "entity.name.class",
      "variable.other.constant",
      "entity.name.decorator",
      "meta.decorator",
    ]) {
      expect(hasScope(scope)).toBe(true);
    }
  });

  it("enables semantic highlighting on the generated theme", () => {
    const theme = buildShikiTheme(calmDark);
    expect(theme.semanticHighlighting).toBe(true);
  });

  it("maps semantic token types to distinct palette colors", () => {
    const theme = buildShikiTheme(calmDark);
    expect(theme.semanticTokenColors).toBeDefined();
    const colors = theme.semanticTokenColors as Record<
      string,
      string | { foreground?: string }
    >;
    const foreground = (key: string) => {
      const value = colors[key];
      return typeof value === "string" ? value : value?.foreground;
    };

    expect(foreground("function")).toBe(calmDark.func);
    expect(foreground("method")).toBe(calmDark.func);
    expect(foreground("parameter")).toBe(calmDark.parameter);
    expect(foreground("property")).toBe(calmDark.property);
    expect(foreground("variable")).toBe(calmDark.variable);
    expect(foreground("type")).toBe(calmDark.type);
    expect(foreground("class")).toBe(calmDark.type);
    expect(foreground("interface")).toBe(calmDark.type);
    expect(foreground("enum")).toBe(calmDark.type);
    expect(foreground("namespace")).toBe(calmDark.namespace);
    expect(foreground("macro")).toBe(calmDark.decorator);
    expect(foreground("decorator")).toBe(calmDark.decorator);

    // Functions and parameters must be visually distinct from plain variables
    // (this is the core "flat highlighting" problem the mapping solves).
    expect(foreground("function")).not.toBe(calmDark.variable);
    expect(foreground("parameter")).not.toBe(calmDark.variable);
    expect(foreground("type")).not.toBe(calmDark.variable);
  });

  it("emits semantic token rules into tokenColors so Monaco can match them", () => {
    const theme = buildShikiTheme(calmDark);
    const scopeColor = (scope: string) =>
      theme.tokenColors.find((t) => t.scope.includes(scope))?.settings.foreground;
    expect(scopeColor("function")).toBe(calmDark.func);
    expect(scopeColor("parameter")).toBe(calmDark.parameter);
    expect(scopeColor("type")).toBe(calmDark.type);
  });
});

describe("APP_SHIKI_THEMES", () => {
  it("includes the bundled VS Code Dark Plus theme", () => {
    expect(APP_SHIKI_THEMES).toContain("dark-plus");
  });
});

describe("createAppHighlighter", () => {
  it("loads all app themes and languages", async () => {
    const highlighter = await createAppHighlighter();
    for (const theme of APP_SHIKI_THEMES) {
      expect(highlighter.getLoadedThemes()).toContain(theme);
    }
    for (const lang of SHIKI_LANGS) {
      expect(highlighter.getLoadedLanguages()).toContain(lang);
    }
  });

  it("loads the bundled Dark Plus theme", async () => {
    const highlighter = await createAppHighlighter();
    expect(highlighter.getLoadedThemes()).toContain("dark-plus");
  });
});

describe("configureShikiLanguageFeatures", () => {
  it("keeps PHP-like indentation and bracket behavior after Shiki registration", () => {
    interface TestLanguageConfiguration {
      autoClosingPairs?: Array<{ open: string; close: string }>;
      brackets?: Array<[string, string]>;
      indentationRules?: {
        decreaseIndentPattern: RegExp;
        increaseIndentPattern: RegExp;
      };
      onEnterRules?: Array<{
        action: { indentAction: number };
        afterText?: RegExp;
        beforeText: RegExp;
      }>;
    }

    const calls: Array<[string, TestLanguageConfiguration]> = [];
    const registrations: string[] = [];

    configureShikiLanguageFeatures({
      languages: {
        register(language) {
          registrations.push(language.id);
        },
        getLanguages: () => [],
        setLanguageConfiguration: (languageId, configuration) => {
          calls.push([languageId, configuration]);
        },
      },
    });

    expect(registrations).toEqual(["php", "blade"]);
    expect(calls.map(([languageId]) => languageId)).toEqual(["php", "blade"]);

    const [, phpConfiguration] = calls[0];
    expect(phpConfiguration.brackets).toContainEqual(["{", "}"]);
    expect(phpConfiguration.autoClosingPairs).toContainEqual({
      open: "(",
      close: ")",
    });
    expect(
      phpConfiguration.indentationRules?.increaseIndentPattern.test(
        "    public function getOne() {",
      ),
    ).toBe(true);
    expect(
      phpConfiguration.indentationRules?.decreaseIndentPattern.test("    }"),
    ).toBe(true);
    expect(
      phpConfiguration.onEnterRules?.some(
        (rule) =>
          rule.beforeText.test("    public function getOne() {") &&
          rule.afterText?.test("    }") &&
          rule.action.indentAction === 2,
      ),
    ).toBe(true);
    expect(
      phpConfiguration.onEnterRules?.some(
        (rule) =>
          rule.beforeText.test("        $items = [") &&
          rule.afterText?.test("        ]") &&
          rule.action.indentAction === 2,
      ),
    ).toBe(true);
    expect(
      phpConfiguration.onEnterRules?.some(
        (rule) =>
          rule.beforeText.test("        $service->call(") &&
          rule.afterText?.test("        )") &&
          rule.action.indentAction === 2,
      ),
    ).toBe(true);
  });

  it("does not duplicate already registered PHP-like languages", () => {
    const registrations: string[] = [];

    configureShikiLanguageFeatures({
      languages: {
        register(language) {
          registrations.push(language.id);
        },
        getLanguages: () => [{ id: "php" }, { id: "blade" }],
        setLanguageConfiguration() {},
      },
    });

    expect(registrations).toEqual([]);
  });
});
