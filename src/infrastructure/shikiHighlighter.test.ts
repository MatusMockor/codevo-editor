import { EncodedTokenMetadata, INITIAL, type IToken } from "@shikijs/vscode-textmate";
import { describe, expect, it, vi } from "vitest";
import {
  APP_SHIKI_THEMES,
  SHIKI_LANGS,
  applyImmediateFallbackTheme,
  buildShikiTheme,
  configureShikiLanguageFeatures,
  createAppHighlighter,
  createEncodedShikiProvider as createEncodedShikiProviderForTest,
  setupShikiTokenization,
} from "./shikiHighlighter";
import { calmDark } from "../components/themePalettes";

/**
 * Minimal fake of the subset of the Monaco standalone API that
 * `setupShikiTokenization` touches. It captures the registered encoded tokens
 * providers and the installed color map so tests can drive the real Shiki
 * tokenizer through the provider and assert on the produced binary tokens.
 */
interface FakeEncodedTokensProvider {
  getInitialState(): unknown;
  tokenizeEncoded(
    line: string,
    state: unknown,
  ): { tokens: Uint32Array; endState: unknown };
  tokenize?(line: string, state: unknown): unknown;
}

function createMonacoStub() {
  const providers = new Map<string, FakeEncodedTokensProvider>();
  let colorMap: string[] = [];
  const definedThemes: string[] = [];
  const setThemeCalls: string[] = [];

  const classicProviderRegistrations: string[] = [];
  const monaco = {
    languages: {
      getLanguages: () => [] as Array<{ id: string }>,
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setTokensProvider: vi.fn(
        (languageId: string, provider: FakeEncodedTokensProvider) => {
          // Monaco routes both classic and encoded providers through this one
          // call; the encoded variant is the one exposing tokenizeEncoded.
          if (typeof provider?.tokenizeEncoded === "function") {
            providers.set(languageId, provider);
          } else {
            classicProviderRegistrations.push(languageId);
          }
          return { dispose: vi.fn() };
        },
      ),
      setColorMap: vi.fn((map: string[] | null) => {
        colorMap = map ?? [];
      }),
    },
    editor: {
      defineTheme: vi.fn((name: string) => {
        definedThemes.push(name);
      }),
      setTheme: vi.fn((name: string) => {
        setThemeCalls.push(name);
      }),
    },
  };

  return {
    monaco,
    providers,
    classicProviderRegistrations,
    definedThemes,
    setThemeCalls,
    getColorMap: () => colorMap,
  };
}

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

  it("themes the suggest, hover and editor widget chrome from the palette", () => {
    const theme = buildShikiTheme(calmDark);
    const colors = theme.colors;
    // Suggest widget chrome (autocomplete dropdown).
    expect(colors["editorSuggestWidget.background"]).toBe(calmDark.widgetBg);
    expect(colors["editorSuggestWidget.border"]).toBe(calmDark.border);
    expect(colors["editorSuggestWidget.foreground"]).toBe(calmDark.fg);
    expect(colors["editorSuggestWidget.selectedBackground"]).toBe(
      calmDark.selectedBg,
    );
    expect(colors["editorSuggestWidget.selectedForeground"]).toBe(
      calmDark.selectedFg,
    );
    expect(colors["editorSuggestWidget.highlightForeground"]).toBe(
      calmDark.accent,
    );
    expect(colors["editorSuggestWidget.focusHighlightForeground"]).toBe(
      calmDark.accent,
    );
    // Hover + generic editor widget chrome.
    expect(colors["editorHoverWidget.background"]).toBe(calmDark.widgetBg);
    expect(colors["editorHoverWidget.border"]).toBe(calmDark.border);
    expect(colors["editorHoverWidget.foreground"]).toBe(calmDark.fg);
    expect(colors["editorWidget.background"]).toBe(calmDark.widgetBg);
    expect(colors["editorWidget.border"]).toBe(calmDark.border);
  });

  it("themes the context / code-action menu chrome from the palette", () => {
    const theme = buildShikiTheme(calmDark);
    const colors = theme.colors;
    expect(colors["menu.background"]).toBe(calmDark.widgetBg);
    expect(colors["menu.foreground"]).toBe(calmDark.fg);
    expect(colors["menu.selectionBackground"]).toBe(calmDark.selectedBg);
    expect(colors["menu.selectionForeground"]).toBe(calmDark.selectedFg);
    expect(colors["menu.border"]).toBe(calmDark.border);
  });

  it("colors the suggest-widget kind icons to match the FileStructure palette", () => {
    const theme = buildShikiTheme(calmDark);
    const colors = theme.colors;
    // The suggest widget renders codicons whose color Monaco reads from these
    // symbolIcon.* theme tokens. They must line up with the FileStructure
    // --symbol-* roles so completion and the structure palette read alike.
    expect(colors["symbolIcon.methodForeground"]).toBe(calmDark.func);
    expect(colors["symbolIcon.functionForeground"]).toBe(calmDark.func);
    expect(colors["symbolIcon.propertyForeground"]).toBe(calmDark.property);
    expect(colors["symbolIcon.fieldForeground"]).toBe(calmDark.property);
    expect(colors["symbolIcon.constantForeground"]).toBe(calmDark.constant);
    expect(colors["symbolIcon.enumeratorMemberForeground"]).toBe(
      calmDark.constant,
    );
    expect(colors["symbolIcon.classForeground"]).toBe(calmDark.type);
    expect(colors["symbolIcon.interfaceForeground"]).toBe(calmDark.type);
    expect(colors["symbolIcon.enumeratorForeground"]).toBe(calmDark.type);
    expect(colors["symbolIcon.structForeground"]).toBe(calmDark.type);
    expect(colors["symbolIcon.variableForeground"]).toBe(calmDark.variable);
    expect(colors["symbolIcon.keywordForeground"]).toBe(calmDark.keyword);
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

  it("ships the Vue single-file-component grammar", async () => {
    const highlighter = await createAppHighlighter();
    expect(SHIKI_LANGS).toContain("vue");
    expect(highlighter.getLoadedLanguages()).toContain("vue");
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

/**
 * Regression coverage for the Latte / NEON grammar review findings. These run
 * the *real* TextMate tokenizer (`IGrammar.tokenizeLine`, not the encoded
 * Monaco path) so assertions can check exact scope names rather than only
 * "was something colored" - the leak/false-positive bugs here would still
 * produce *a* colored token, just the wrong one.
 */
describe("Latte / NEON grammar fixes (real TextMate scopes)", () => {
  async function tokenizeLatteLines(lines: string[]) {
    const highlighter = await createAppHighlighter();
    const grammar = highlighter.getLanguage("latte");
    let state = INITIAL;
    const results: Array<{ line: string; tokens: IToken[] }> = [];
    for (const line of lines) {
      const result = grammar.tokenizeLine(line, state);
      results.push({ line, tokens: result.tokens });
      state = result.ruleStack;
    }
    return results;
  }

  /** Union of every scope touching the given (exact) substring of `line`. */
  function scopesAtWord(tokens: IToken[], line: string, word: string): string[] {
    const start = line.indexOf(word);
    expect(start, `"${word}" not found in line: ${line}`).toBeGreaterThanOrEqual(0);
    const end = start + word.length;
    const scopes = new Set<string>();
    for (const token of tokens) {
      if (token.startIndex < end && token.endIndex > start) {
        for (const scope of token.scopes) {
          scopes.add(scope);
        }
      }
    }
    return [...scopes];
  }

  // Any scope other than the grammar's own always-present root scope counts as
  // "Latte lit this token up".
  const hasLatteScope = (scopes: string[]) =>
    scopes.some((scope) => scope.includes("latte") && scope !== "text.html.latte");

  it("does not leak an unclosed Latte tag scope onto the following line (#1 scope leak)", async () => {
    const [, second] = await tokenizeLatteLines([
      "{foreach $items as $item",
      "<p>Hello</p>",
    ]);

    const leaked = second.tokens.some((token) => hasLatteScope(token.scopes));
    expect(leaked).toBe(false);
  });

  it("still highlights the opening keyword on the line an unclosed tag was typed on", async () => {
    const [first] = await tokenizeLatteLines(["{foreach $items as $item"]);
    const scopes = scopesAtWord(first.tokens, first.line, "foreach");
    expect(scopes.some((scope) => scope.includes("keyword.control.latte"))).toBe(true);
  });

  it("does not highlight a plain JS object literal inside <script> as a Latte macro (#2 false positive)", async () => {
    const [result] = await tokenizeLatteLines([
      '<script>var config = {enabled: true, retries: 3};</script>',
    ]);

    for (const word of ["enabled", "retries"]) {
      const scopes = scopesAtWord(result.tokens, result.line, word);
      expect(hasLatteScope(scopes), `"${word}" scopes: ${scopes.join(", ")}`).toBe(false);
    }
  });

  it("does not highlight Latte tag syntax written inside a {* comment *} (#3 comment leak)", async () => {
    const [result] = await tokenizeLatteLines(["{* nieco {if $x} vnutri *}"]);
    const scopes = scopesAtWord(result.tokens, result.line, "if");

    expect(scopes).toContain("comment.block.latte");
    expect(
      scopes.some(
        (scope) => scope.includes("meta.tag.latte") || scope.includes("keyword.control.latte"),
      ),
    ).toBe(false);
  });

  it("keeps highlighting real Latte tags (allowlist does not regress known macros)", async () => {
    const cases: Array<{ line: string; word: string; scope: string }> = [
      { line: "{if $x}", word: "if", scope: "keyword.control.latte" },
      { line: "{foreach $a as $b}", word: "foreach", scope: "keyword.control.latte" },
      { line: "{$var|upper}", word: "var", scope: "variable.other.latte" },
      { line: "{/foreach}", word: "foreach", scope: "keyword.control.latte" },
      { line: "{include 'x.latte'}", word: "include", scope: "keyword.control.latte" },
    ];

    for (const { line, word, scope } of cases) {
      const [result] = await tokenizeLatteLines([line]);
      const scopes = scopesAtWord(result.tokens, result.line, word);
      expect(
        scopes.some((s) => s.includes(scope)),
        `${line}: expected "${word}" to include ${scope}, got [${scopes.join(", ")}]`,
      ).toBe(true);
      expect(scopes.some((s) => s.includes("meta.tag.latte"))).toBe(true);
    }
  });

  it("does not tag a method name after :: as a NEON class entity (#4)", async () => {
    const highlighter = await createAppHighlighter();
    const grammar = highlighter.getLanguage("neon");
    const line = "factory: App\\X::create()";
    const result = grammar.tokenizeLine(line, INITIAL);

    const methodScopes = scopesAtWord(result.tokens, line, "create");
    expect(methodScopes.some((scope) => scope.includes("entity.name.class.neon"))).toBe(false);

    const classScopes = scopesAtWord(result.tokens, line, "App\\X");
    expect(classScopes.some((scope) => scope.includes("entity.name.class.neon"))).toBe(true);
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

    expect(registrations).toEqual(["php", "blade", "latte", "neon"]);
    expect(calls.map(([languageId]) => languageId)).toEqual([
      "php",
      "blade",
      "latte",
      "neon",
    ]);

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
        getLanguages: () => [
          { id: "php" },
          { id: "blade" },
          { id: "latte" },
          { id: "neon" },
        ],
        setLanguageConfiguration() {},
      },
    });

    expect(registrations).toEqual([]);
  });

  it("registers Latte with HTML-style brackets and the Latte block comment", () => {
    interface TestLanguageConfiguration {
      autoClosingPairs?: Array<{ open: string; close: string }>;
      brackets?: Array<[string, string]>;
      comments?: { lineComment?: string; blockComment?: [string, string] };
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

    const latte = calls.find(([languageId]) => languageId === "latte")?.[1];
    expect(latte).toBeDefined();
    expect(latte?.brackets).toContainEqual(["{", "}"]);
    expect(latte?.autoClosingPairs).toContainEqual({ open: "{", close: "}" });
    // Latte's `{* ... *}` block comment, so Cmd+/ comments a Latte template.
    expect(latte?.comments?.blockComment).toEqual(["{*", "*}"]);
  });

  it("registers NEON with a hash line comment for its YAML-like syntax", () => {
    interface TestLanguageConfiguration {
      comments?: { lineComment?: string; blockComment?: [string, string] };
      brackets?: Array<[string, string]>;
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

    const neon = calls.find(([languageId]) => languageId === "neon")?.[1];
    expect(neon).toBeDefined();
    expect(neon?.comments?.lineComment).toBe("#");
  });
});

describe("setupShikiTokenization", () => {
  it("registers an encoded tokens provider for every Shiki language", async () => {
    const { monaco, providers, classicProviderRegistrations } =
      createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    for (const lang of SHIKI_LANGS) {
      const provider = providers.get(lang);
      expect(provider, `missing encoded provider for ${lang}`).toBeDefined();
      // The encoded path streams binary tokens straight from Shiki, so the
      // provider must expose tokenizeEncoded rather than the classic tokenize.
      expect(typeof provider?.tokenizeEncoded).toBe("function");
    }
    // No classic (scope-string) provider should be registered.
    expect(classicProviderRegistrations).toHaveLength(0);
  });

  it("installs the Shiki color map and applies the requested theme", async () => {
    const { monaco, getColorMap, setThemeCalls } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    // The encoded foreground ids index this color map, so it must be installed
    // for colors to render. shikiToMonaco never called setColorMap; we must.
    expect(monaco.languages.setColorMap).toHaveBeenCalled();
    expect(getColorMap().length).toBeGreaterThan(1);
    expect(setThemeCalls).toContain("calm-dark");
  });

  it("produces non-empty encoded tokens for PHP whose foreground ids index the color map", async () => {
    const { monaco, providers, getColorMap } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const php = providers.get("php");
    expect(php).toBeDefined();
    const result = php!.tokenizeEncoded(
      "<?php function greet(string $name) { return $name; }",
      php!.getInitialState(),
    );

    expect(result.tokens).toBeInstanceOf(Uint32Array);
    expect(result.tokens.length).toBeGreaterThan(0);
    // Even tokens are start offsets, odd tokens are encoded metadata.
    const colorMap = getColorMap();
    let sawColoredToken = false;
    for (let i = 0; i < result.tokens.length; i += 2) {
      const metadata = result.tokens[i + 1];
      const foreground = EncodedTokenMetadata.getForeground(metadata);
      expect(foreground).toBeLessThan(colorMap.length);
      if (foreground > 0) {
        sawColoredToken = true;
      }
    }
    // Keywords/functions must resolve to real palette colors, not the default.
    expect(sawColoredToken).toBe(true);
  });

  it("produces non-empty encoded tokens for a Vue single-file component", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const vue = providers.get("vue");
    expect(vue).toBeDefined();
    const result = vue!.tokenizeEncoded(
      "<template><div>{{ msg }}</div></template>\n" +
        "<script setup lang=\"ts\">const msg = \"hi\";</script>",
      vue!.getInitialState(),
    );
    expect(result.tokens).toBeInstanceOf(Uint32Array);
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it("produces encoded tokens for a Latte template, including inside HTML tags", async () => {
    const { monaco, providers, getColorMap } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const latte = providers.get("latte");
    expect(latte).toBeDefined();
    const colorMap = getColorMap();

    const sawColoredTokens = (line: string, state: unknown) => {
      const result = latte!.tokenizeEncoded(line, state);
      expect(result.tokens).toBeInstanceOf(Uint32Array);
      let colored = false;
      for (let i = 0; i < result.tokens.length; i += 2) {
        const foreground = EncodedTokenMetadata.getForeground(
          result.tokens[i + 1],
        );
        expect(foreground).toBeLessThan(colorMap.length);
        if (foreground > 0) {
          colored = true;
        }
      }
      return { colored, endState: result.endState };
    };

    let state = latte!.getInitialState();
    // A Latte macro echo inside HTML markup must resolve to a real palette color,
    // proving the macro injection layers on top of the embedded HTML grammar.
    const macroLine = sawColoredTokens(
      "    <a n:href=\"Product:show\">{$product->name|upper}</a>",
      state,
    );
    expect(macroLine.colored).toBe(true);
    state = macroLine.endState;

    // The rest of a realistic template must not throw as state threads across it.
    expect(() => {
      for (const line of [
        "{* greeting template *}",
        "{varType App\\Model\\Product $product}",
        "<ul n:if=\"$products\">",
        "  <li n:foreach=\"$products as $product\">{$product->title}</li>",
        "</ul>",
        "{if $total > 0}{$total}{/if}",
      ]) {
        state = sawColoredTokens(line, state).endState;
      }
    }).not.toThrow();
  });

  it("does not hang or throw on malformed Latte input", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const latte = providers.get("latte");
    expect(latte).toBeDefined();
    const lines = [
      "{foreach $items as $item",
      "{$unterminated 'string",
      "<div class=\"{ not a tag }\">",
      "<style>body { color: red }</style>",
      "{{{{{{",
      "}}}}}}",
    ];
    let state = latte!.getInitialState();
    expect(() => {
      for (const line of lines) {
        const result = latte!.tokenizeEncoded(line, state);
        state = result.endState;
      }
    }).not.toThrow();
  });

  it("produces encoded tokens for a NEON config file", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const neon = providers.get("neon");
    expect(neon).toBeDefined();
    const lines = [
      "# application services",
      "parameters:",
      "  appDir: %rootDir%/app",
      "services:",
      "  - App\\Model\\ProductRepository(@database.default)",
      "  router: App\\Router\\RouterFactory::createRouter()",
      "includes:",
      "  - services.neon",
    ];
    let state = neon!.getInitialState();
    let sawTokens = false;
    expect(() => {
      for (const line of lines) {
        const result = neon!.tokenizeEncoded(line, state);
        expect(result.tokens).toBeInstanceOf(Uint32Array);
        if (result.tokens.length > 0) {
          sawTokens = true;
        }
        state = result.endState;
      }
    }).not.toThrow();
    expect(sawTokens).toBe(true);
  });

  it("produces non-empty encoded tokens for TypeScript", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const ts = providers.get("typescript");
    expect(ts).toBeDefined();
    const result = ts!.tokenizeEncoded(
      "const greet = (name: string): void => {};",
      ts!.getInitialState(),
    );
    expect(result.tokens).toBeInstanceOf(Uint32Array);
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it("produces encoded tokens for Markdown (README diff) without throwing", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const markdown = providers.get("markdown");
    expect(markdown).toBeDefined();
    const lines = [
      "# Project",
      "",
      "Some **bold** text and `inline code`.",
      "```js",
      "const a = 1;",
      "```",
      "```unknown-lang-not-loaded",
      "x",
      "```",
    ];
    let state = markdown!.getInitialState();
    expect(() => {
      for (const line of lines) {
        const result = markdown!.tokenizeEncoded(line, state);
        expect(result.tokens).toBeInstanceOf(Uint32Array);
        state = result.endState;
      }
    }).not.toThrow();
  });

  it("falls back to a plain token instead of throwing when the grammar is unavailable", () => {
    // Monaco can call the registered tokenizer for a language whose Shiki
    // grammar resolves to undefined (load race / version skew). The encoded
    // provider must degrade to a plain token instead of throwing, otherwise the
    // exception unmounts the whole renderer (blank screen).
    const highlighterStub = {
      getLanguage: () => undefined,
    } as unknown as Parameters<typeof createEncodedShikiProviderForTest>[0];
    const provider = createEncodedShikiProviderForTest(
      highlighterStub,
      "markdown",
    );

    expect(() => {
      const result = provider.tokenizeEncoded(
        "# Heading",
        provider.getInitialState(),
      );
      expect(result.tokens).toBeInstanceOf(Uint32Array);
    }).not.toThrow();
  });

  it("carries grammar state across lines so multiline constructs stay highlighted", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const php = providers.get("php");
    expect(php).toBeDefined();
    // A block comment opened on line 1 must keep line 2 inside the comment
    // state, which only works if the end state is threaded between calls.
    const first = php!.tokenizeEncoded("<?php /* open", php!.getInitialState());
    const threaded = php!.tokenizeEncoded("still comment */", first.endState);
    const fresh = php!.tokenizeEncoded(
      "still comment */",
      php!.getInitialState(),
    );
    expect(threaded.tokens.length).toBeGreaterThan(0);
    // Token type 1 === Comment in Monaco's StandardTokenType encoding. With the
    // open comment state threaded in, the line's first token is a comment...
    const threadedType = EncodedTokenMetadata.getTokenType(threaded.tokens[1]);
    expect(threadedType).toBe(1);
    // ...whereas tokenizing the same line from the initial state does not see a
    // comment, proving the end state was actually carried across the boundary.
    const freshType = EncodedTokenMetadata.getTokenType(fresh.tokens[1]);
    expect(freshType).not.toBe(1);
  });

  it("falls back to a single plain token for lines beyond the 2000-char cap", async () => {
    const { monaco, providers } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const php = providers.get("php");
    expect(php).toBeDefined();
    const longLine = `<?php $x = '${"a".repeat(2100)}';`;
    const result = php!.tokenizeEncoded(longLine, php!.getInitialState());
    // One token, starting at index 0, with no regex pass performed.
    expect(result.tokens.length).toBe(2);
    expect(result.tokens[0]).toBe(0);
  });

  it("forwards later setTheme calls to Shiki and refreshes the color map", async () => {
    const { monaco, getColorMap } = createMonacoStub();

    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    const darkColorMap = [...getColorMap()];
    monaco.languages.setColorMap.mockClear();

    // Switching themes (light) must reinstall the matching color map so the
    // already-tokenized encoded foreground ids keep resolving to real colors.
    monaco.editor.setTheme("calm-light");
    expect(monaco.languages.setColorMap).toHaveBeenCalled();
    const lightColorMap = getColorMap();
    expect(lightColorMap).not.toEqual(darkColorMap);
  });

  it("does not stack setTheme wrappers when run twice on the shared Monaco namespace", async () => {
    const { monaco } = createMonacoStub();

    // Monaco's namespace is a singleton shared across editor tabs; running
    // setup twice (e.g. main editor + git diff) must wrap setTheme only once
    // so a later theme switch installs the color map exactly one time.
    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );
    await setupShikiTokenization(
      monaco as unknown as Parameters<typeof setupShikiTokenization>[0],
      "calm-dark",
    );

    monaco.languages.setColorMap.mockClear();
    monaco.editor.setTheme("calm-light");
    expect(monaco.languages.setColorMap).toHaveBeenCalledTimes(1);
  });
});
