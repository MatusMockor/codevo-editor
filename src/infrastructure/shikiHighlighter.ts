import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { textmateThemeToMonacoTheme } from "@shikijs/monaco";
import { INITIAL, type StateStack } from "@shikijs/vscode-textmate";
import {
  customPalettes,
  materialDeepOcean,
  type ThemePalette,
} from "../components/themePalettes";

export interface ShikiThemeRegistration {
  name: string;
  type: "dark" | "light";
  /**
   * Opt-in flag consumed by VS Code-compatible theme readers. Monaco's
   * standalone theme service ignores it (it tracks semantic highlighting via
   * the editor option), so we keep it for correctness / round-tripping.
   */
  semanticHighlighting: boolean;
  /**
   * VS Code-style semantic token -> color map. Monaco's standalone theme
   * service does NOT read this field (it resolves semantic tokens through the
   * `rules`/`tokenColors` array via `_match([type, ...modifiers].join("."))`),
   * so the same colors are also emitted into `tokenColors`. This field is kept
   * so the generated theme stays a faithful VS Code theme object.
   */
  semanticTokenColors: Record<string, string>;
  colors: Record<string, string>;
  tokenColors: Array<{
    scope: string[];
    settings: { foreground?: string; fontStyle?: string };
  }>;
}

/**
 * Maps the Language Server semantic token *types* (the legend used by the
 * JS/TS Monaco providers) to palette colors. Functions/methods, parameters,
 * types and properties get their own colors so identifiers stop collapsing
 * into a single flat "variable" color (the VS Code Dark+ behaviour).
 */
function buildSemanticTokenColors(p: ThemePalette): Record<string, string> {
  return {
    function: p.func,
    method: p.func,
    "function.defaultLibrary": p.func,
    parameter: p.parameter,
    property: p.property,
    "property.declaration": p.property,
    variable: p.variable,
    "variable.readonly": p.constant,
    "variable.defaultLibrary": p.constant,
    type: p.type,
    class: p.type,
    interface: p.type,
    enum: p.type,
    enumMember: p.constant,
    struct: p.type,
    typeParameter: p.type,
    namespace: p.namespace,
    macro: p.decorator,
    decorator: p.decorator,
    keyword: p.keyword,
    string: p.string,
    number: p.number,
    regexp: p.regexp,
    operator: p.operator,
    comment: p.comment,
  };
}

/**
 * Maps Monaco's `symbolIcon.*Foreground` theme tokens (the colors it paints the
 * suggest-widget completion-kind codicons with) onto the same palette roles the
 * FileStructure palette uses for its `--symbol-*` chips. Method/function take the
 * function color, class/interface/enum/struct the type color, constant/enum
 * member the constant color, property/field the property color, so autocomplete
 * and the structure outline read with one consistent kind-color language.
 */
function buildSymbolIconColors(p: ThemePalette): Record<string, string> {
  return {
    "symbolIcon.methodForeground": p.func,
    "symbolIcon.functionForeground": p.func,
    "symbolIcon.constructorForeground": p.func,
    "symbolIcon.propertyForeground": p.property,
    "symbolIcon.fieldForeground": p.property,
    "symbolIcon.variableForeground": p.variable,
    "symbolIcon.constantForeground": p.constant,
    "symbolIcon.enumeratorMemberForeground": p.constant,
    "symbolIcon.classForeground": p.type,
    "symbolIcon.interfaceForeground": p.type,
    "symbolIcon.enumeratorForeground": p.type,
    "symbolIcon.structForeground": p.type,
    "symbolIcon.typeParameterForeground": p.type,
    "symbolIcon.keywordForeground": p.keyword,
    "symbolIcon.namespaceForeground": p.namespace,
    "symbolIcon.snippetForeground": p.accent,
  };
}

export function buildShikiTheme(p: ThemePalette): ShikiThemeRegistration {
  const tok = (scope: string[], foreground: string, italic = false) => ({
    scope,
    settings: italic ? { foreground, fontStyle: "italic" } : { foreground },
  });

  const semanticTokenColors = buildSemanticTokenColors(p);

  // Monaco's standalone theme service resolves semantic tokens through the
  // same `rules` array that TextMate scopes use (it calls
  // `_match([tokenType, ...modifiers].join("."))`). Emit the semantic map as
  // token rules so semantic highlighting actually picks up colors, since
  // `@shikijs/monaco` drops the dedicated `semanticTokenColors` field when it
  // converts the theme into Monaco's `IStandaloneThemeData`.
  const semanticTokenRules = Object.entries(semanticTokenColors).map(
    ([token, foreground]) => tok([token], foreground),
  );

  return {
    name: p.name,
    type: p.base === "vs" ? "light" : "dark",
    semanticHighlighting: true,
    semanticTokenColors,
    colors: {
      "editor.background": p.bg,
      "editor.foreground": p.fg,
      "editor.lineHighlightBackground": p.lineHighlight,
      "editor.selectionBackground": p.selection,
      "editorCursor.foreground": p.cursor,
      "editorLineNumber.foreground": p.lineNumber,
      "editorLineNumber.activeForeground": p.lineNumberActive,
      "editorWhitespace.foreground": p.whitespace,
      "editorSuggestWidget.background": p.widgetBg,
      "editorSuggestWidget.border": p.border,
      "editorSuggestWidget.foreground": p.fg,
      "editorSuggestWidget.selectedBackground": p.selectedBg,
      "editorSuggestWidget.selectedForeground": p.selectedFg,
      "editorSuggestWidget.highlightForeground": p.accent,
      "editorSuggestWidget.focusHighlightForeground": p.accent,
      "editorWidget.background": p.widgetBg,
      "editorWidget.border": p.border,
      "editorWidget.foreground": p.fg,
      "editorHoverWidget.background": p.widgetBg,
      "editorHoverWidget.border": p.border,
      "editorHoverWidget.foreground": p.fg,
      // Context menu + the Cmd+. code-action lightbulb list share Monaco's
      // `menu.*` chrome; tint them with the same widget palette so every popup
      // reads as one family with the FileStructure palette.
      "menu.background": p.widgetBg,
      "menu.foreground": p.fg,
      "menu.selectionBackground": p.selectedBg,
      "menu.selectionForeground": p.selectedFg,
      "menu.separatorBackground": p.border,
      "menu.border": p.border,
      "input.background": p.inputBg,
      "input.border": p.border,
      focusBorder: p.accent,
      "diffEditor.insertedTextBackground": p.diffInserted,
      "diffEditor.removedTextBackground": p.diffRemoved,
      // Completion kind icons. Monaco paints the suggest-widget codicons from
      // these tokens; mapping them onto the same palette roles the FileStructure
      // --symbol-* CSS uses keeps the autocomplete icons and the structure
      // palette telling the same color story (method = func, class = type, ...).
      ...buildSymbolIconColors(p),
    },
    tokenColors: [
      tok(
        [
          "comment",
          "punctuation.definition.comment",
          "comment.block.documentation",
        ],
        p.comment,
        p.commentItalic,
      ),
      tok(["string", "string.quoted", "string.template"], p.string),
      tok(["constant.character.escape", "string.regexp"], p.regexp),
      tok(
        [
          "keyword",
          "storage",
          "keyword.control",
          "storage.modifier",
          "storage.type",
        ],
        p.keyword,
        p.keywordItalic ?? false,
      ),
      tok(["constant.numeric"], p.number),
      tok(
        [
          "constant.language",
          "constant.other",
          "support.constant",
          "variable.other.constant",
          "variable.other.enummember",
        ],
        p.constant,
      ),
      tok(
        [
          "entity.name.function",
          "support.function",
          "meta.function-call",
          "entity.name.function.member",
          "variable.function",
        ],
        p.func,
      ),
      tok(
        [
          "entity.name.type",
          "entity.name.class",
          "entity.other.inherited-class",
          "support.type",
          "support.class",
          "entity.name.type.interface",
          "entity.name.type.enum",
        ],
        p.type,
      ),
      tok(["variable", "variable.other", "variable.other.readwrite"], p.variable),
      tok(["variable.parameter", "meta.parameter", "variable.parameter.function"], p.parameter),
      tok(
        [
          "variable.other.property",
          "variable.other.object.property",
          "meta.property",
          "support.variable.property",
          "variable.other.member",
        ],
        p.property,
      ),
      tok(
        [
          "entity.name.namespace",
          "support.other.namespace",
          "entity.name.scope-resolution",
        ],
        p.namespace,
      ),
      tok(
        [
          "meta.decorator",
          "entity.name.decorator",
          "punctuation.decorator",
          "meta.annotation",
          "support.macro",
        ],
        p.decorator,
      ),
      tok(["keyword.operator"], p.operator),
      // Semantic token rules: Monaco resolves LSP semantic tokens through this
      // same array, so they must be appended for semantic highlighting to color.
      ...semanticTokenRules,
    ],
  };
}

// Material Deep Ocean is matched to the PhpStorm Material Theme color scheme
// (Material Deep Ocean.icls) exactly, which maps PHP tokens differently from
// the canonical VS-Code Material palette: class references are green, brackets
// and operators are cyan, the phpdoc tag is purple, and class declarations are
// yellow. (Parameters render as variables — cream — because the TextMate
// grammar cannot distinguish a parameter from a local variable without semantic
// analysis; PhpStorm uses semantic highlighting for that.)
function materialDeepOceanTheme(): ShikiThemeRegistration {
  const tok = (
    scope: string[],
    foreground: string,
    italic = false,
  ) => ({
    scope,
    settings: italic ? { foreground, fontStyle: "italic" } : { foreground },
  });
  const base = buildShikiTheme(materialDeepOcean);
  return {
    ...base,
    tokenColors: [
      tok(["comment", "punctuation.definition.comment", "comment.block.documentation"], "#717cb4", true),
      tok(["keyword.other.phpdoc", "storage.type.phpdoc"], "#c792ea"),
      tok(["string", "string.quoted"], "#c3e88d"),
      tok(["constant.character.escape", "string.regexp"], "#89ddff"),
      tok(["keyword", "storage", "keyword.control", "storage.modifier", "storage.type"], "#c792ea", true),
      tok(["constant.numeric"], "#f78c6c"),
      tok(["constant.language", "constant.other", "support.constant"], "#f78c6c"),
      tok(["entity.name.function", "support.function", "meta.function-call"], "#82aaff"),
      tok(["entity.name.type", "entity.name.class"], "#ffcb6b"),
      tok(["support.class", "entity.other.inherited-class"], "#c3e88d"),
      tok(["variable", "variable.other", "variable.language"], "#eeffe3"),
      tok(["variable.other.property", "variable.other.object.property", "meta.property"], "#eeffff"),
      tok(["entity.name.namespace", "support.other.namespace"], "#c3d3de"),
      tok(["keyword.operator", "punctuation"], "#89ddff"),
      // Semantic token rules let JS/TS LSP semantic highlighting color
      // functions/parameters/types in this theme too (PHP keeps the bespoke
      // TextMate rules above).
      ...Object.entries(base.semanticTokenColors).map(([token, foreground]) =>
        tok([token], foreground),
      ),
    ],
  };
}

export const SHIKI_LANGS = [
  "php",
  "blade",
  "javascript",
  "typescript",
  "json",
  "css",
  "scss",
  "html",
  "yaml",
  "markdown",
  "sql",
  "vue",
  // Nette highlighting tier (runs in every mode, no framework gating). Both
  // grammars are self-authored (no Shiki bundle grammar exists for them) and
  // loaded via the same dynamic-import / code-split path as the bundled langs,
  // so ne-Nette users pay no extra startup bundle for them.
  "latte",
  "neon",
] as const;

export const APP_SHIKI_THEMES = [
  "dracula",
  "one-dark-pro",
  "catppuccin-mocha",
  "catppuccin-latte",
  "material-deep-ocean",
  "dark-plus",
  "ayu-mirage",
  ...customPalettes.map((palette) => palette.name),
] as const;

const MONACO_FALLBACK_SHIKI_THEMES: ShikiThemeRegistration[] = [
  {
    name: "vs-dark",
    type: "dark",
    semanticHighlighting: true,
    semanticTokenColors: {},
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
    },
    tokenColors: [
      {
        scope: ["source"],
        settings: { foreground: "#d4d4d4" },
      },
    ],
  },
  {
    name: "vs",
    type: "light",
    semanticHighlighting: true,
    semanticTokenColors: {},
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#000000",
    },
    tokenColors: [
      {
        scope: ["source"],
        settings: { foreground: "#000000" },
      },
    ],
  },
];

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function createAppHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) {
    return highlighterPromise;
  }

  highlighterPromise = createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    themes: [
      import("shiki/themes/dracula.mjs"),
      import("shiki/themes/one-dark-pro.mjs"),
      import("shiki/themes/catppuccin-mocha.mjs"),
      import("shiki/themes/catppuccin-latte.mjs"),
      // VS Code "Dark+" — bundled by Shiki with 50+ rich TextMate scopes, so it
      // renders the canonical VS Code colors (purple keywords, yellow functions,
      // teal types, orange strings) without going through buildShikiTheme.
      import("shiki/themes/dark-plus.mjs"),
      // Official VS Code "Ayu Mirage" — bundled by Shiki with the full TextMate
      // scope set, so it renders the canonical Ayu Mirage colors (func #ffcd66,
      // keyword #ffa659, comment #6e7c8f, number #dfbfff) 1:1 instead of going
      // through buildShikiTheme with a hand-rolled palette.
      import("shiki/themes/ayu-mirage.mjs"),
      materialDeepOceanTheme(),
      ...customPalettes.map((palette) => buildShikiTheme(palette)),
      ...MONACO_FALLBACK_SHIKI_THEMES,
    ],
    langs: [
      import("shiki/langs/php.mjs"),
      import("shiki/langs/blade.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/scss.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/sql.mjs"),
      // Vue SFC grammar — highlights <template>/<script>/<style> blocks. The
      // bundle is self-contained (it ships its embedded css/js/ts/html/markdown
      // sub-grammars), so no extra imports are needed. Highlighting only; .vue
      // does not get LSP/Volar completions or diagnostics in this slice.
      import("shiki/langs/vue.mjs"),
      // Self-authored Latte + NEON grammars (no Shiki bundle equivalent). The
      // Latte grammar layers its macros on top of the bundled `html` grammar via
      // a scope injection, so `html` must stay in this list. Dynamic imports keep
      // both grammars in their own code-split chunks (lazy, no startup cost).
      import("./grammars/latteGrammar"),
      import("./grammars/neonGrammar"),
    ],
  });

  return highlighterPromise;
}

interface MonacoLanguageConfiguration {
  autoClosingPairs?: Array<{
    open: string;
    close: string;
    notIn?: string[];
  }>;
  brackets?: Array<[string, string]>;
  comments?: {
    lineComment?: string;
    blockComment?: [string, string];
  };
  indentationRules?: {
    decreaseIndentPattern: RegExp;
    increaseIndentPattern: RegExp;
  };
  onEnterRules?: Array<{
    action: {
      appendText?: string;
      indentAction: number;
      removeText?: number;
    };
    afterText?: RegExp;
    beforeText: RegExp;
    previousLineText?: RegExp;
  }>;
  surroundingPairs?: Array<{
    open: string;
    close: string;
  }>;
}

interface MonacoLanguageHost {
  languages: {
    register(language: { id: string }): void;
    getLanguages(): Array<{ id: string }>;
    setLanguageConfiguration?(
      languageId: string,
      configuration: MonacoLanguageConfiguration,
    ): void;
  };
}

/** Opaque tokenizer state Monaco threads from one line to the next. */
interface MonacoTokenizerState {
  clone(): MonacoTokenizerState;
  equals(other: MonacoTokenizerState | null): boolean;
}

interface MonacoEncodedLineTokens {
  tokens: Uint32Array;
  endState: MonacoTokenizerState;
}

interface MonacoEncodedTokensProvider {
  getInitialState(): MonacoTokenizerState;
  tokenizeEncoded(
    line: string,
    state: MonacoTokenizerState,
  ): MonacoEncodedLineTokens;
}

interface MonacoStandaloneTheme {
  base: string;
  inherit: boolean;
  colors: Record<string, string>;
  rules: unknown[];
}

/**
 * Subset of the Monaco standalone API the encoded Shiki tokenizer drives.
 * Kept structural (not a hard dependency on the monaco-editor types) so the
 * unit tests can pass a lightweight stub.
 */
interface MonacoForShiki extends MonacoLanguageHost {
  languages: MonacoLanguageHost["languages"] & {
    // Monaco's single tokens-provider entry point. It accepts either a classic
    // scope-string provider or an EncodedTokensProvider (detected via the
    // presence of `tokenizeEncoded`); we always pass the encoded variant.
    setTokensProvider(
      languageId: string,
      provider: MonacoEncodedTokensProvider,
    ): { dispose(): void };
    // Installs the color map the encoded foreground ids index into. Lives under
    // `monaco.languages` (not `monaco.editor`) in the standalone API.
    setColorMap(colorMap: string[] | null): void;
  };
  editor: {
    defineTheme(name: string, theme: MonacoStandaloneTheme): void;
    setTheme(themeName: string): void;
  };
}

const MONACO_INDENT_ACTION = {
  Indent: 1,
  IndentOutdent: 2,
} as const;

const PHP_LIKE_LANGUAGE_CONFIGURATION: MonacoLanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string", "comment"] },
    { open: "`", close: "`", notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
    { open: "`", close: "`" },
  ],
  indentationRules: {
    increaseIndentPattern:
      /^.*(?:\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/,
    decreaseIndentPattern: /^\s*[\}\]\)].*$/,
  },
  onEnterRules: [
    {
      beforeText: /^.*\{\s*$/,
      afterText: /^\s*\}.*$/,
      action: { indentAction: MONACO_INDENT_ACTION.IndentOutdent },
    },
    {
      beforeText: /^.*\(\s*$/,
      afterText: /^\s*\).*$/,
      action: { indentAction: MONACO_INDENT_ACTION.IndentOutdent },
    },
    {
      beforeText: /^.*\[\s*$/,
      afterText: /^\s*\].*$/,
      action: { indentAction: MONACO_INDENT_ACTION.IndentOutdent },
    },
    {
      beforeText: /^.*\{\s*$/,
      action: { indentAction: MONACO_INDENT_ACTION.Indent },
    },
    {
      beforeText: /^.*(?:\(|\[)\s*$/,
      action: { indentAction: MONACO_INDENT_ACTION.Indent },
    },
  ],
};

/**
 * Latte is HTML with `{...}` macros, so it reuses HTML-style bracket / quote
 * pairs and swaps the comment style for Latte's `{* ... *}` block comment. It
 * intentionally omits the PHP indentation rules: a `.latte` file is markup, not
 * a braced C-like language, so bracket-driven auto-indent would misfire.
 */
const LATTE_LANGUAGE_CONFIGURATION: MonacoLanguageConfiguration = {
  comments: {
    blockComment: ["{*", "*}"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
    { open: "<", close: ">" },
  ],
};

/**
 * NEON is a YAML-like, indentation-based config format: `#` line comments, no
 * block comment, and bracket / quote pairs for its inline lists and maps. No
 * bracket indentation rules - indentation is significant and driven by the user.
 */
const NEON_LANGUAGE_CONFIGURATION: MonacoLanguageConfiguration = {
  comments: {
    lineComment: "#",
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
};

const SHIKI_LANGUAGE_CONFIGURATIONS: Array<
  [string, MonacoLanguageConfiguration]
> = [
  ["php", PHP_LIKE_LANGUAGE_CONFIGURATION],
  ["blade", PHP_LIKE_LANGUAGE_CONFIGURATION],
  ["latte", LATTE_LANGUAGE_CONFIGURATION],
  ["neon", NEON_LANGUAGE_CONFIGURATION],
];

export function configureShikiLanguageFeatures(
  monaco: MonacoLanguageHost,
): void {
  const registered = new Set(
    monaco.languages
      .getLanguages()
      .map((language: { id: string }) => language.id),
  );

  for (const [languageId, configuration] of SHIKI_LANGUAGE_CONFIGURATIONS) {
    if (!registered.has(languageId)) {
      monaco.languages.register({ id: languageId });
      registered.add(languageId);
    }

    monaco.languages.setLanguageConfiguration?.(languageId, configuration);
  }
}

/**
 * Light-mode Monaco theme ids. Used to pick the matching built-in fallback so
 * Monaco never paints a white background before the async Shiki themes load.
 */
const LIGHT_APP_THEMES = new Set([
  "calm-light",
  "one-light",
  "catppuccin-latte",
]);

interface MonacoThemeHost {
  editor: {
    setTheme(theme: string): void;
  };
}

/**
 * Synchronously applies a built-in Monaco theme (`vs` / `vs-dark`) matched to
 * the target app theme's light/dark mode. This runs in `beforeMount`, before
 * the async Shiki highlighter resolves and registers the real theme, so Monaco
 * paints the correct dark (or light) background on its very first frame instead
 * of flashing the default white `vs` theme. The real Shiki theme overrides this
 * once `setupShikiTokenization` finishes.
 */
export function applyImmediateFallbackTheme(
  monaco: MonacoThemeHost,
  theme: string,
): void {
  monaco.editor.setTheme(LIGHT_APP_THEMES.has(theme) ? "vs" : "vs-dark");
}

/**
 * Wraps a TextMate `ruleStack` as the immutable state object Monaco threads
 * between consecutive lines. Mirrors `@shikijs/monaco`'s internal
 * `TokenizerState` so the grammar state semantics stay identical.
 */
class ShikiTokenizerState {
  constructor(readonly ruleStack: StateStack) {}

  clone(): ShikiTokenizerState {
    return new ShikiTokenizerState(this.ruleStack);
  }

  equals(other: ShikiTokenizerState | null): boolean {
    if (!other || !(other instanceof ShikiTokenizerState)) {
      return false;
    }
    return other === this || other.ruleStack === this.ruleStack;
  }
}

/**
 * Default per-line regex budget (ms) handed to Shiki's `tokenizeLine2`. Matches
 * `@shikijs/monaco`'s default; a single line that blows past it falls back to
 * the partial result instead of stalling the frame indefinitely.
 */
const SHIKI_TOKENIZE_TIME_LIMIT = 500;

/**
 * Maximum line length that gets a full TextMate regex pass. Monaco tokenizes
 * the visible viewport synchronously on the reveal/scroll path; a single very
 * long PHP/Blade line (interpolation, long chains) costs ~0.8ms of regex work,
 * so a viewport full of them blows the 16ms frame budget and makes navigation
 * (Cmd+B open, Cmd+Up/Down jump) lag. Lines longer than this fall back to a
 * single plain token. Short lines (the overwhelming majority) tokenize
 * normally, so syntax highlighting is unaffected for real source.
 */
const SHIKI_TOKENIZE_MAX_LINE_LENGTH = 2000;

/**
 * Builds an EncodedTokensProvider that streams Shiki's binary tokens straight
 * into Monaco. This is the fast path: `tokenizeLine2` already emits Monaco's
 * encoded metadata layout (foreground color id + StandardTokenType + font
 * style bits), so the provider returns the `Uint32Array` verbatim. Compared to
 * the classic scope-string provider (`@shikijs/monaco`'s `shikiToMonaco`),
 * every visible line skips the per-token color->scope reverse lookup, the
 * scope-string join, and Monaco's `tokenTheme.match()` Trie re-parse, which is
 * the synchronous-per-line cost that made heavy viewports lag on reveal.
 *
 * Colors stay identical because the encoded foreground ids index the Shiki
 * color map installed via `monaco.editor.setColorMap`.
 */
export function createEncodedShikiProvider(
  highlighter: HighlighterCore,
  languageId: string,
): MonacoEncodedTokensProvider {
  return {
    getInitialState(): ShikiTokenizerState {
      return new ShikiTokenizerState(INITIAL);
    },
    tokenizeEncoded(
      line: string,
      state: ShikiTokenizerState,
    ): MonacoEncodedLineTokens {
      if (line.length >= SHIKI_TOKENIZE_MAX_LINE_LENGTH) {
        // One plain token spanning the line, with the grammar state preserved
        // so the lines after a skipped long line still tokenize correctly.
        return { tokens: new Uint32Array([0, 0]), endState: state };
      }
      // Monaco calls this synchronously while painting the viewport. If the
      // Shiki grammar for this language is somehow unavailable (load race,
      // version skew, an embedded grammar that failed to resolve), `getLanguage`
      // returns undefined and `tokenizeLine2` would throw. An exception here
      // propagates out of Monaco's render and unmounts the whole React tree
      // (blank screen), so degrade to a single plain token instead of throwing.
      const grammar = highlighter.getLanguage(languageId) as
        | {
            tokenizeLine2(
              line: string,
              ruleStack: StateStack,
              timeLimit: number,
            ): { tokens: Uint32Array; ruleStack: StateStack };
          }
        | undefined;
      if (!grammar) {
        return { tokens: new Uint32Array([0, 0]), endState: state };
      }
      try {
        const result = grammar.tokenizeLine2(
          line,
          state.ruleStack,
          SHIKI_TOKENIZE_TIME_LIMIT,
        );
        return {
          tokens: result.tokens,
          endState: new ShikiTokenizerState(result.ruleStack),
        };
      } catch (error) {
        // A grammar that throws mid-tokenization must not take the renderer down
        // with it; fall back to an uncolored line and keep the prior state.
        console.error("Shiki tokenize failed", languageId, error);
        return { tokens: new Uint32Array([0, 0]), endState: state };
      }
    },
  };
}

/**
 * Installs the resolved Shiki color map onto Monaco so the encoded foreground
 * ids resolve to the correct palette colors, then applies the theme. Forwards
 * future `setTheme` calls to Shiki and re-installs the matching color map so a
 * theme switch recolors already-tokenized lines without a re-tokenization.
 */
function installShikiThemes(
  highlighter: HighlighterCore,
  monaco: MonacoForShiki,
  initialTheme: string,
): void {
  for (const themeId of highlighter.getLoadedThemes()) {
    monaco.editor.defineTheme(
      themeId,
      textmateThemeToMonacoTheme(
        highlighter.getTheme(themeId),
      ) as unknown as MonacoStandaloneTheme,
    );
  }

  const applyShikiColorMap = (themeName: string): void => {
    const { colorMap } = highlighter.setTheme(themeName);
    // Shiki's color map is already 1-based (id 0 = the default/"no color"
    // placeholder), which is exactly the layout `setColorMap` expects (it
    // treats index 0 as null and reads from index 1). So a Shiki foreground id
    // N from tokenizeLine2 lines up 1:1 with Monaco color id N.
    monaco.languages.setColorMap(colorMap);
  };

  // Monaco's namespace is a process-wide singleton shared by every editor tab
  // (light editor + git diff). `setupShikiTokenization` can run more than once
  // against it, so guard the setTheme patch to wrap the native implementation
  // exactly once instead of stacking redundant wrappers on each call.
  const patchable = monaco.editor.setTheme as ((themeName: string) => void) & {
    __shikiColorMapPatched?: boolean;
  };
  if (!patchable.__shikiColorMapPatched) {
    const nativeSetTheme = monaco.editor.setTheme.bind(monaco.editor);
    const patched = ((themeName: string): void => {
      applyShikiColorMap(themeName);
      nativeSetTheme(themeName);
    }) as typeof patchable;
    patched.__shikiColorMapPatched = true;
    monaco.editor.setTheme = patched;
  }

  monaco.editor.setTheme(initialTheme);
}

export async function setupShikiTokenization(
  monaco: MonacoForShiki,
  theme: string,
  options?: { shouldApply?(): boolean },
): Promise<void> {
  const highlighter = await createAppHighlighter();

  if (options?.shouldApply && !options.shouldApply()) {
    return;
  }

  const registered = new Set(
    monaco.languages
      .getLanguages()
      .map((language: { id: string }) => language.id),
  );

  for (const id of SHIKI_LANGS) {
    if (!registered.has(id)) {
      monaco.languages.register({ id });
    }
  }

  configureShikiLanguageFeatures(monaco);
  installShikiThemes(highlighter, monaco, theme);

  const loadedLanguages = new Set(highlighter.getLoadedLanguages());
  const monacoLanguageIds = new Set(
    monaco.languages.getLanguages().map((language) => language.id),
  );
  for (const id of SHIKI_LANGS) {
    monacoLanguageIds.add(id);
  }
  for (const languageId of monacoLanguageIds) {
    if (!loadedLanguages.has(languageId)) {
      continue;
    }
    monaco.languages.setTokensProvider(
      languageId,
      createEncodedShikiProvider(highlighter, languageId),
    );
  }
}
