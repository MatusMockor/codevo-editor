import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  customPalettes,
  materialDeepOcean,
  type ThemePalette,
} from "../components/themePalettes";
import {
  OVERVIEW_RULER_ADDED,
  OVERVIEW_RULER_DELETED,
  OVERVIEW_RULER_MODIFIED,
} from "./editorOverviewRulerColors";
import { PALETTE_SYNTAX_THEMES } from "./paletteSyntaxThemes";

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

function optionalColor(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

type ShikiTokenRule = ShikiThemeRegistration["tokenColors"][number];

function tokenRule(scope: string[], foreground: string, fontStyle?: string): ShikiTokenRule {
  return { scope, settings: fontStyle === undefined ? { foreground } : { foreground, fontStyle } };
}

function buildMarkupAndKeyRules(p: ThemePalette): ShikiTokenRule[] {
  return [
    tokenRule(["entity.name.tag"], p.keyword),
    tokenRule(["punctuation.definition.tag"], p.operator),
    tokenRule(["entity.other.attribute-name"], p.func),
    tokenRule(["support.type.property-name"], p.type),
    tokenRule(["variable.other.key", "variable.key.dotenv"], p.keyword),
    tokenRule(["property.value.dotenv"], p.string),
    tokenRule(["entity.name.section"], p.type),
    tokenRule(["markup.heading", "entity.name.section.markdown"], p.keyword, "bold"),
    tokenRule(["markup.bold"], p.fg, "bold"),
    tokenRule(["markup.italic"], p.fg, "italic"),
    tokenRule(["markup.inline.raw", "markup.fenced_code.block"], p.string),
    tokenRule(["markup.underline.link"], p.func),
    tokenRule(["markup.quote"], p.comment, "italic"),
    tokenRule(["punctuation.definition.list.begin.markdown"], p.operator),
    tokenRule(["markup.inserted"], p.overviewAdded ?? p.string),
    tokenRule(["markup.deleted"], p.overviewDeleted ?? p.keyword),
    tokenRule(["meta.diff.header"], p.keyword),
    tokenRule(["meta.diff.range"], p.func),
  ];
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
      ...optionalColor("editor.findMatchBackground", p.findMatch),
      ...optionalColor("editor.findMatchHighlightBackground", p.findMatchHighlight),
      ...optionalColor("peekViewEditor.background", p.peekBackground),
      ...optionalColor("peekViewResult.background", p.peekBackground),
      ...optionalColor("peekViewTitle.background", p.peekBackground),
      ...optionalColor("peekView.border", p.peekBorder),
      ...optionalColor(OVERVIEW_RULER_ADDED, p.overviewAdded),
      ...optionalColor(OVERVIEW_RULER_MODIFIED, p.overviewModified),
      ...optionalColor(OVERVIEW_RULER_DELETED, p.overviewDeleted),
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
      ...buildMarkupAndKeyRules(p),
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
      ...buildMarkupAndKeyRules(materialDeepOcean),
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
  "dotenv",
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
  ...PALETTE_SYNTAX_THEMES.map((palette) => palette.name),
] as const;

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
      ...PALETTE_SYNTAX_THEMES.map((palette) => buildShikiTheme(palette)),
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
      import("shiki/langs/dotenv.mjs"),
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
