import { EncodedTokenMetadata } from "@shikijs/vscode-textmate";
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
