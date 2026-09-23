import { isTauri } from "@tauri-apps/api/core";
import type { HighlighterCore } from "shiki/core";
import type { MonacoAppTheme } from "../../domain/settings";
import {
  agentCodeColorizable,
  type AgentCodeColorizer,
  type AgentCodeToken,
  type AgentColorizedLines,
} from "./agentCodeColorizer";

const MAX_CACHED_COLORIZATIONS = 64;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;

const LANGUAGE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["node", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["jsonc", "json"],
  ["json5", "json"],
  ["yml", "yaml"],
  ["md", "markdown"],
  ["htm", "html"],
  ["env", "dotenv"],
  ["sh", "shellscript"],
  ["bash", "shellscript"],
  ["zsh", "shellscript"],
  ["shell", "shellscript"],
  ["console", "shellscript"],
  ["shellsession", "shellscript"],
  ["py", "python"],
  ["python3", "python"],
  ["rs", "rust"],
]);

type LazyGrammar = () => Parameters<HighlighterCore["loadLanguage"]>[0];

const LAZY_GRAMMARS: ReadonlyMap<string, LazyGrammar> = new Map<string, LazyGrammar>([
  ["shellscript", () => import("shiki/langs/shellscript.mjs")],
  ["python", () => import("shiki/langs/python.mjs")],
  ["rust", () => import("shiki/langs/rust.mjs")],
]);

type HighlighterLoader = () => Promise<HighlighterCore>;

const pendingGrammars = new WeakMap<HighlighterCore, Map<string, Promise<boolean>>>();

export function createShikiAgentCodeColorizer(
  theme: MonacoAppTheme,
  loadHighlighter: HighlighterLoader = loadAppHighlighter,
): AgentCodeColorizer {
  const cache = new Map<string, AgentColorizedLines>();
  return {
    async colorize(code, language) {
      if (!agentCodeColorizable(code, language)) return null;
      const highlighter = await loadHighlighter();
      const languageId = await shikiLanguageId(highlighter, language);
      if (languageId === null) return null;
      if (!highlighter.getLoadedThemes().includes(theme)) return null;
      const key = `${theme}\u0000${languageId}\u0000${code}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const lines = highlighter
        .codeToTokensBase(code, { lang: languageId, theme })
        .map((line) => line.map(agentCodeToken));
      remember(cache, key, lines);
      return lines;
    },
  };
}

export function defaultAgentCodeColorizer(theme: MonacoAppTheme): AgentCodeColorizer | null {
  if (!isTauri()) return null;
  return createShikiAgentCodeColorizer(theme);
}

async function loadAppHighlighter(): Promise<HighlighterCore> {
  const { createAppHighlighter } = await import("../../infrastructure/shikiHighlighter");
  return createAppHighlighter();
}

async function shikiLanguageId(
  highlighter: HighlighterCore,
  language: string,
): Promise<string | null> {
  const requested = language.trim().toLowerCase();
  const id = LANGUAGE_ALIASES.get(requested) ?? requested;
  if (highlighter.getLoadedLanguages().includes(id)) return id;
  const loaded = await loadLazyGrammar(highlighter, id);
  return loaded ? id : null;
}

function loadLazyGrammar(highlighter: HighlighterCore, id: string): Promise<boolean> {
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

function agentCodeToken(token: {
  readonly content: string;
  readonly color?: string;
  readonly fontStyle?: number;
}): AgentCodeToken {
  const style = token.fontStyle ?? 0;
  return {
    text: token.content,
    color: token.color !== undefined && HEX_COLOR.test(token.color) ? token.color : null,
    italic: style > 0 && (style & FONT_STYLE_ITALIC) !== 0,
    bold: style > 0 && (style & FONT_STYLE_BOLD) !== 0,
  };
}

function remember(
  cache: Map<string, AgentColorizedLines>,
  key: string,
  lines: AgentColorizedLines,
): void {
  while (cache.size >= MAX_CACHED_COLORIZATIONS) {
    const oldest = cache.keys().next();
    if (oldest.done === true) return;
    cache.delete(oldest.value);
  }
  cache.set(key, lines);
}
