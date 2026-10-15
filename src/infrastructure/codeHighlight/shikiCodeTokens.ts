import type { HighlighterCore } from "shiki/core";
import type {
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import {
  exceedsHighlightBudget,
  MAX_TOKENIZED_LINE_CHARS,
  plainCodeToken,
  splitCodeLines,
  type CodeToken,
  type HighlightedLine,
} from "../../domain/codeHighlight/highlightedCode";

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const TOKENIZE_TIME_LIMIT_MS = 500;

type GrammarInput = Parameters<HighlighterCore["loadLanguage"]>[0];
type LazyGrammar = () => GrammarInput;

const SHIKI_LANGUAGE_IDS: Readonly<Record<CodeLanguageId, string | null>> = {
  plaintext: null,
  javascript: "javascript",
  jsx: "jsx",
  typescript: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  php: "php",
  blade: "blade",
  latte: "latte",
  neon: "neon",
  vue: "vue",
  markdown: "markdown",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  shellscript: "shellscript",
  python: "python",
  rust: "rust",
  go: "go",
  dotenv: "dotenv",
  dockerfile: "docker",
  ini: "ini",
  diff: "diff",
};

const LAZY_GRAMMARS: ReadonlyMap<string, LazyGrammar> = new Map<string, LazyGrammar>([
  ["jsx", () => import("shiki/langs/jsx.mjs")],
  ["tsx", () => import("shiki/langs/tsx.mjs")],
  ["jsonc", () => import("shiki/langs/jsonc.mjs")],
  ["less", () => import("shiki/langs/less.mjs")],
  ["toml", () => import("shiki/langs/toml.mjs")],
  ["xml", () => import("shiki/langs/xml.mjs")],
  ["sql", () => import("shiki/langs/sql.mjs")],
  ["shellscript", () => import("shiki/langs/shellscript.mjs")],
  ["python", () => import("shiki/langs/python.mjs")],
  ["rust", () => import("shiki/langs/rust.mjs")],
  ["go", () => import("shiki/langs/go.mjs")],
  ["docker", () => import("shiki/langs/docker.mjs")],
  ["ini", () => import("shiki/langs/ini.mjs")],
  ["diff", () => import("shiki/langs/diff.mjs")],
]);

const pendingGrammars = new WeakMap<HighlighterCore, Map<string, Promise<boolean>>>();

export function shikiLanguageFor(language: CodeLanguageId): string | null {
  return SHIKI_LANGUAGE_IDS[language];
}

export async function highlightWithShiki(
  highlighter: HighlighterCore,
  request: CodeHighlightRequest,
): Promise<CodeHighlightOutcome> {
  if (exceedsHighlightBudget(request.text)) return { kind: "plain", reason: "too-large" };
  const languageId = shikiLanguageFor(request.language);
  if (languageId === null) return { kind: "plain", reason: "unsupported-language" };
  const loaded = await ensureLanguage(highlighter, languageId);
  if (!loaded) return { kind: "plain", reason: "unsupported-language" };
  if (!highlighter.getLoadedThemes().includes(request.theme)) {
    return { kind: "plain", reason: "unavailable" };
  }
  const tokenized = highlighter.codeToTokensBase(request.text, {
    lang: languageId,
    theme: request.theme,
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE_CHARS,
    tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS,
  });
  const sourceLines = splitCodeLines(request.text);
  const lines = sourceLines.map((source, index) => highlightedLine(source, tokenized[index]));
  return { kind: "highlighted", lines };
}

function highlightedLine(
  source: string,
  tokens: ReadonlyArray<ShikiToken> | undefined,
): HighlightedLine {
  if (source.length === 0) return [];
  if (source.length > MAX_TOKENIZED_LINE_CHARS || tokens === undefined) {
    return [plainCodeToken(source)];
  }
  const mapped = tokens.map(codeToken);
  if (mapped.map((token) => token.text).join("") !== source) return [plainCodeToken(source)];
  return mapped;
}

interface ShikiToken {
  readonly content: string;
  readonly color?: string;
  readonly fontStyle?: number;
}

function codeToken(token: ShikiToken): CodeToken {
  const style = token.fontStyle ?? 0;
  return {
    text: token.content,
    color: token.color !== undefined && HEX_COLOR.test(token.color) ? token.color : null,
    italic: style > 0 && (style & FONT_STYLE_ITALIC) !== 0,
    bold: style > 0 && (style & FONT_STYLE_BOLD) !== 0,
  };
}

function ensureLanguage(highlighter: HighlighterCore, id: string): Promise<boolean> {
  if (highlighter.getLoadedLanguages().includes(id)) return Promise.resolve(true);
  const grammar = LAZY_GRAMMARS.get(id);
  if (grammar === undefined) return Promise.resolve(false);
  const owned = pendingGrammars.get(highlighter) ?? new Map<string, Promise<boolean>>();
  pendingGrammars.set(highlighter, owned);
  const pending = owned.get(id);
  if (pending !== undefined) return pending;
  const loading = highlighter.loadLanguage(grammar()).then(
    () => highlighter.getLoadedLanguages().includes(id),
    () => {
      owned.delete(id);
      return false;
    },
  );
  owned.set(id, loading);
  return loading;
}
