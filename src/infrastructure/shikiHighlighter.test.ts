import { EncodedTokenMetadata, INITIAL, type IToken } from "shiki/textmate";
import { describe, expect, it } from "vitest";
import { APP_SHIKI_THEMES, SHIKI_LANGS, buildShikiTheme, createAppHighlighter } from "./shikiHighlighter";
import { calmDark, customPalettes } from "../components/themePalettes";
import { contrastRatio } from "../test/themeContrast";
import { PALETTE_SYNTAX_THEMES } from "./paletteSyntaxThemes";
import { highlightWithShiki } from "./codeHighlight/shikiCodeTokens";
import type { CodeLanguageId } from "../domain/codeHighlight/codeLanguage";
import type { CodeToken } from "../domain/codeHighlight/highlightedCode";
import type { CodeTheme } from "../domain/appColorThemes";

describe("buildShikiTheme", () => {
  it("maps palette to a TextMate theme", () => {
    const theme = buildShikiTheme(calmDark);
    expect(theme.name).toBe("calm-dark");
    expect(theme.type).toBe("dark");
    expect(theme.colors["editor.background"]).toBe("#13151a");
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

  it("maps the optional editor extras into Monaco colours and omits them for classic themes", () => {
    const withExtras = buildShikiTheme({
      ...calmDark,
      findMatch: "#edbb4e61",
      findMatchHighlight: "#edbb4e29",
      peekBackground: "#151616",
      peekBorder: "#ffffff1f",
    });
    const classic = buildShikiTheme(calmDark);

    expect(withExtras.colors["editor.findMatchBackground"]).toBe("#edbb4e61");
    expect(withExtras.colors["editor.findMatchHighlightBackground"]).toBe("#edbb4e29");
    expect(withExtras.colors["peekViewEditor.background"]).toBe("#151616");
    expect(withExtras.colors["peekViewResult.background"]).toBe("#151616");
    expect(withExtras.colors["peekViewTitle.background"]).toBe("#151616");
    expect(withExtras.colors["peekView.border"]).toBe("#ffffff1f");
    expect(classic.colors["editor.findMatchBackground"]).toBeUndefined();
    expect(classic.colors["peekView.border"]).toBeUndefined();
  });
});

describe("APP_SHIKI_THEMES", () => {
  it("includes the bundled VS Code Dark Plus theme", () => {
    expect(APP_SHIKI_THEMES).toContain("dark-plus");
  });

  it("includes the bundled official Ayu Mirage theme", () => {
    expect(APP_SHIKI_THEMES).toContain("ayu-mirage");
  });

  it("includes a Match palette theme for every palette and scheme", () => {
    expect(APP_SHIKI_THEMES).toContain("cv-graphite-teal-dark");
    expect(APP_SHIKI_THEMES).toContain("cv-carbon-lime-light");
    expect(APP_SHIKI_THEMES.filter((theme) => theme.startsWith("cv-"))).toHaveLength(12);
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

  it("paints every Match palette theme with readable colours and tokens", async () => {
    const highlighter = await createAppHighlighter();
    const grammar = highlighter.getLanguage("typescript");
    for (const palette of PALETTE_SYNTAX_THEMES) {
      const { colorMap } = highlighter.setTheme(palette.name);
      const theme = highlighter.getTheme(palette.name);
      const background = (theme.colors?.["editor.background"] ?? "").toLowerCase();
      expect(theme.type, palette.name).toBe(palette.base === "vs-dark" ? "dark" : "light");
      expect(background, palette.name).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.settings.length, palette.name).toBeGreaterThan(0);
      const { tokens } = grammar.tokenizeLine2(
        'export function sum(a: number): string { return `${a}` + "x"; } // total',
        INITIAL,
      );
      for (let index = 1; index < tokens.length; index += 2) {
        const color = colorMap[EncodedTokenMetadata.getForeground(tokens[index] ?? 0)];
        expect(color, palette.name).toMatch(/^#[0-9A-F]{6}$/i);
        expect(
          contrastRatio(color ?? "", background),
          `${palette.name} ${color}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
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

  it("ships and registers the bundled dotenv grammar", async () => {
    const highlighter = await createAppHighlighter();

    expect(SHIKI_LANGS).toContain("dotenv");
    expect(highlighter.getLoadedLanguages()).toContain("dotenv");
  });

  it("loads the bundled official Ayu Mirage theme", async () => {
    const highlighter = await createAppHighlighter();
    expect(highlighter.getLoadedThemes()).toContain("ayu-mirage");
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

describe("markup, tag and key scope coverage", () => {
  const DEFAULT_THEME = "cv-graphite-teal-dark";

  interface Contrast {
    readonly language: CodeLanguageId;
    readonly text: string;
    readonly distinct: ReadonlyArray<readonly [string, string]>;
  }

  const CASES: readonly Contrast[] = [
    {
      language: "yaml",
      text: "services:\n  web:\n    image: nginx\n",
      distinct: [
        ["services", "nginx"],
        ["image", "nginx"],
      ],
    },
    {
      language: "json",
      text: '{\n  "name": "codevo"\n}\n',
      distinct: [["name", "codevo"]],
    },
    {
      language: "html",
      text: '<div class="box">Hello</div>\n',
      distinct: [
        ["div", "Hello"],
        ["class", "box"],
        ["class", "Hello"],
      ],
    },
    {
      language: "css",
      text: '.box {\n  content: "x";\n}\n',
      distinct: [["content", "x"]],
    },
    {
      language: "toml",
      text: '[package]\nname = "codevo"\n',
      distinct: [
        ["name", "codevo"],
        ["package", "codevo"],
      ],
    },
  ];

  async function tokensOf(theme: string, language: CodeLanguageId, text: string) {
    const outcome = await highlightWithShiki(await createAppHighlighter(), {
      language,
      text,
      theme: theme as CodeTheme,
    });
    expect(outcome.kind, `${theme} ${language}`).toBe("highlighted");
    return outcome.kind === "highlighted" ? outcome.lines.flat() : [];
  }

  function colorOf(tokens: readonly CodeToken[], needle: string, label: string) {
    const token =
      tokens.find((candidate) => candidate.text.trim().replace(/^"|"$/g, "") === needle) ??
      tokens.find((candidate) => candidate.text.includes(needle));
    expect(token, `${label}: no token "${needle}" in ${JSON.stringify(tokens)}`).toBeDefined();
    return token?.color ?? null;
  }

  it("colors keys, tags and attributes apart from values and text in the default palette theme", async () => {
    for (const { language, text, distinct } of CASES) {
      const tokens = await tokensOf(DEFAULT_THEME, language, text);
      for (const [key, value] of distinct) {
        const label = `${DEFAULT_THEME} ${language} ${key}/${value}`;
        const keyColor = colorOf(tokens, key, label);
        expect(keyColor, label).not.toBeNull();
        expect(keyColor, label).not.toBe(colorOf(tokens, value, label));
      }
    }
  });

  it("keeps keys, tags and attributes distinct in every app theme", async () => {
    for (const theme of APP_SHIKI_THEMES) {
      for (const { language, text, distinct } of CASES) {
        const tokens = await tokensOf(theme, language, text);
        for (const [key, value] of distinct) {
          const label = `${theme} ${language} ${key}/${value}`;
          expect(colorOf(tokens, key, label), label).not.toBe(colorOf(tokens, value, label));
        }
      }
    }
  });

  it("defines the markup, tag and key scopes in every generated app theme", async () => {
    const highlighter = await createAppHighlighter();
    const generated = [
      "material-deep-ocean",
      ...customPalettes.map((palette) => palette.name),
      ...PALETTE_SYNTAX_THEMES.map((palette) => palette.name),
    ];
    for (const theme of generated) {
      const rules = highlighter.getTheme(theme).settings;
      for (const scope of [
        "entity.name.tag",
        "punctuation.definition.tag",
        "entity.other.attribute-name",
        "support.type.property-name",
        "variable.other.key",
        "variable.key.dotenv",
        "entity.name.section",
        "markup.heading",
        "markup.inline.raw",
        "markup.inserted",
        "markup.deleted",
      ]) {
        const covered = rules.some((rule) =>
          Array.isArray(rule.scope) ? rule.scope.includes(scope) : rule.scope === scope,
        );
        expect(covered, `${theme} ${scope}`).toBe(true);
      }
    }
  });

  it("paints markup, tag and key tokens readably in every Match palette theme", async () => {
    const samples: ReadonlyArray<readonly [CodeLanguageId, string]> = [
      ["yaml", "services:\n  image: nginx\n"],
      ["html", '<div class="box">Hello</div>\n'],
      ["toml", '[package]\nname = "codevo"\n'],
      ["dotenv", "API_KEY=secret\n"],
      ["markdown", "# Title\n\nUse `code` and [docs](http://x).\n"],
      ["diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n"],
    ];
    for (const palette of PALETTE_SYNTAX_THEMES) {
      for (const [language, text] of samples) {
        for (const token of await tokensOf(palette.name, language, text)) {
          if (token.text.trim() === "") continue;
          const label = `${palette.name} ${language} ${JSON.stringify(token.text)} ${token.color}`;
          expect(token.color, label).not.toBeNull();
          expect(contrastRatio(token.color ?? "", palette.bg), label).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
