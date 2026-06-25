import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { shikiToMonaco } from "@shikijs/monaco";
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
      "editorHoverWidget.background": p.widgetBg,
      "editorHoverWidget.border": p.border,
      "input.background": p.inputBg,
      "input.border": p.border,
      focusBorder: p.accent,
      "diffEditor.insertedTextBackground": p.diffInserted,
      "diffEditor.removedTextBackground": p.diffRemoved,
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

interface MonacoForShiki extends MonacoLanguageHost {}

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

export function configureShikiLanguageFeatures(
  monaco: MonacoLanguageHost,
): void {
  const registered = new Set(
    monaco.languages
      .getLanguages()
      .map((language: { id: string }) => language.id),
  );

  for (const languageId of ["php", "blade"]) {
    if (!registered.has(languageId)) {
      monaco.languages.register({ id: languageId });
      registered.add(languageId);
    }

    monaco.languages.setLanguageConfiguration?.(
      languageId,
      PHP_LIKE_LANGUAGE_CONFIGURATION,
    );
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

export async function setupShikiTokenization(
  monaco: MonacoForShiki & Parameters<typeof shikiToMonaco>[1],
  theme: string,
): Promise<void> {
  const highlighter = await createAppHighlighter();
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
  // Cap synchronous TextMate tokenization to 2000 chars. Monaco tokenizes the
  // visible viewport on the scroll path; a single very long PHP/Blade line
  // (interpolation, long chains) costs ~0.8ms of regex work, so a viewport full
  // of them blows the 16ms frame budget and makes fast scrolling lag. Lines
  // longer than this fall back to one plain token instead of a regex pass.
  // Short lines (the overwhelming majority) tokenize normally, so syntax
  // highlighting is unaffected for real source.
  shikiToMonaco(highlighter, monaco, { tokenizeMaxLineLength: 2000 });
  monaco.editor.setTheme(theme);
}
