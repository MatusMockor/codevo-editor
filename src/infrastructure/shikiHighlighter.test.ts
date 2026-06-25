import { describe, expect, it, vi } from "vitest";
import {
  APP_SHIKI_THEMES,
  SHIKI_LANGS,
  applyImmediateFallbackTheme,
  buildShikiTheme,
  configureShikiLanguageFeatures,
  createAppHighlighter,
} from "./shikiHighlighter";
import { calmDark } from "../components/themePalettes";

describe("buildShikiTheme", () => {
  it("maps palette to a TextMate theme", () => {
    const theme = buildShikiTheme(calmDark);
    expect(theme.name).toBe("calm-dark");
    expect(theme.type).toBe("dark");
    expect(theme.colors["editor.background"]).toBe("#16181d");
    const scopeColor = (scope: string) =>
      theme.tokenColors.find((t) => t.scope.includes(scope))?.settings.foreground;
    expect(scopeColor("entity.name.function")).toBe(calmDark.func);
    expect(scopeColor("keyword")).toBe(calmDark.keyword);
    expect(scopeColor("variable.parameter")).toBe(calmDark.parameter);
    expect(scopeColor("constant.numeric")).toBe(calmDark.number);
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

describe("applyImmediateFallbackTheme", () => {
  it("applies the built-in dark theme synchronously for dark app themes", () => {
    for (const theme of [
      "calm-dark",
      "one-dark-pro",
      "dracula",
      "catppuccin-mocha",
      "material-deep-ocean",
      "dark-plus",
      "ayu-mirage",
    ]) {
      const setTheme = vi.fn();
      applyImmediateFallbackTheme({ editor: { setTheme } }, theme);
      expect(setTheme).toHaveBeenCalledWith("vs-dark");
    }
  });

  it("applies the built-in light theme synchronously for light app themes", () => {
    for (const theme of ["calm-light", "one-light", "catppuccin-latte"]) {
      const setTheme = vi.fn();
      applyImmediateFallbackTheme({ editor: { setTheme } }, theme);
      expect(setTheme).toHaveBeenCalledWith("vs");
    }
  });
});

describe("APP_SHIKI_THEMES", () => {
  it("includes the bundled VS Code Dark Plus theme", () => {
    expect(APP_SHIKI_THEMES).toContain("dark-plus");
  });

  it("includes the bundled official Ayu Mirage theme", () => {
    expect(APP_SHIKI_THEMES).toContain("ayu-mirage");
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

  it("loads the bundled official Ayu Mirage theme", async () => {
    const highlighter = await createAppHighlighter();
    expect(highlighter.getLoadedThemes()).toContain("ayu-mirage");
  });

  it("loads Monaco fallback theme ids because shikiToMonaco forwards later setTheme calls to Shiki", async () => {
    const highlighter = await createAppHighlighter();
    expect(highlighter.getLoadedThemes()).toContain("vs-dark");
    expect(highlighter.getLoadedThemes()).toContain("vs");
    expect(() => highlighter.setTheme("vs-dark")).not.toThrow();
    expect(() => highlighter.setTheme("vs")).not.toThrow();
  });

  it("uses the official VS Code Ayu Mirage colors, not the legacy custom palette", async () => {
    const highlighter = await createAppHighlighter();
    const theme = highlighter.getTheme("ayu-mirage");
    // Shiki's resolved theme exposes its TextMate rules under `settings`.
    const rules = theme.settings as Array<{
      scope?: string | string[];
      settings: { foreground?: string };
    }>;
    const scopeColor = (scope: string) =>
      rules.find((rule) => {
        const ruleScope = rule.scope;
        if (Array.isArray(ruleScope)) {
          return ruleScope.includes(scope);
        }
        return ruleScope === scope;
      })?.settings.foreground;

    // Official Ayu Mirage values (https://github.com/ayu-theme) — these differ
    // from the previous hand-rolled palette (bg #1f2430, func #ffd173,
    // keyword #ffad66, number #ffcc66), proving the bundled theme is in use.
    expect(theme.colors?.["editor.background"]?.toLowerCase()).toBe("#242936");
    expect(scopeColor("entity.name.function")?.toLowerCase()).toBe("#ffcd66");
    expect(scopeColor("keyword")?.toLowerCase()).toBe("#ffa659");
    expect(scopeColor("constant.numeric")?.toLowerCase()).toBe("#dfbfff");
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
