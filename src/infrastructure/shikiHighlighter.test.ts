import { describe, expect, it } from "vitest";
import {
  APP_SHIKI_THEMES,
  SHIKI_LANGS,
  buildShikiTheme,
  configureShikiLanguageFeatures,
  createAppHighlighter,
} from "./shikiHighlighter";
import { ayuMirage } from "../components/themePalettes";

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
    }

    const calls: Array<[string, TestLanguageConfiguration]> = [];

    configureShikiLanguageFeatures({
      languages: {
        register() {},
        getLanguages: () => [],
        setLanguageConfiguration: (languageId, configuration) => {
          calls.push([languageId, configuration]);
        },
      },
    });

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
  });
});
