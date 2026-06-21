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
  colors: Record<string, string>;
  tokenColors: Array<{
    scope: string[];
    settings: { foreground?: string; fontStyle?: string };
  }>;
}

export function buildShikiTheme(p: ThemePalette): ShikiThemeRegistration {
  const tok = (scope: string[], foreground: string, italic = false) => ({
    scope,
    settings: italic ? { foreground, fontStyle: "italic" } : { foreground },
  });

  return {
    name: p.name,
    type: p.base === "vs" ? "light" : "dark",
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
      tok(["comment", "punctuation.definition.comment"], p.comment, p.commentItalic),
      tok(["string", "string.quoted"], p.string),
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
      tok(["constant.language", "constant.other", "support.constant"], p.constant),
      tok(["entity.name.function", "support.function", "meta.function-call"], p.func),
      tok(["entity.name.type", "entity.name.class", "support.class"], p.type),
      tok(["variable", "variable.other"], p.variable),
      tok(["variable.parameter"], p.parameter),
      tok(
        ["variable.other.property", "variable.other.object.property", "meta.property"],
        p.property,
      ),
      tok(["entity.name.namespace", "support.other.namespace"], p.namespace),
      tok(["keyword.operator"], p.operator),
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
  return {
    ...buildShikiTheme(materialDeepOcean),
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
  ...customPalettes.map((palette) => palette.name),
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
      materialDeepOceanTheme(),
      ...customPalettes.map((palette) => buildShikiTheme(palette)),
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
  shikiToMonaco(highlighter, monaco);
  monaco.editor.setTheme(theme);
}
