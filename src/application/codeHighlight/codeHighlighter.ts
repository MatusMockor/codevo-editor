import { createContext, useContext, useEffect, useState } from "react";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import type { HighlightedLines } from "../../domain/codeHighlight/highlightedCode";
import type { CodeTheme } from "../../domain/settings";

export interface CodeHighlightRequest {
  readonly text: string;
  readonly language: CodeLanguageId;
  readonly theme: CodeTheme;
}

export type CodePlainReason = "unsupported-language" | "too-large" | "unavailable";

export type CodeHighlightOutcome =
  | { readonly kind: "highlighted"; readonly lines: HighlightedLines }
  | { readonly kind: "plain"; readonly reason: CodePlainReason };

export interface CodeHighlightBatchRequest {
  readonly texts: readonly string[];
  readonly language: CodeLanguageId;
  readonly theme: CodeTheme;
}

export type CodeHighlightBatchOutcome =
  | { readonly kind: "highlighted"; readonly texts: ReadonlyArray<HighlightedLines> }
  | { readonly kind: "plain"; readonly reason: CodePlainReason };

export interface CodeHighlighter {
  highlight(request: CodeHighlightRequest, signal?: AbortSignal): Promise<CodeHighlightOutcome>;
  highlightBatch?(
    request: CodeHighlightBatchRequest,
    signal?: AbortSignal,
  ): Promise<CodeHighlightBatchOutcome>;
}

export const CodeHighlighterContext = createContext<CodeHighlighter | null>(null);
export const CodeHighlightThemeContext = createContext<CodeTheme | null>(null);

export type CodeHighlightState = { readonly kind: "pending" } | CodeHighlightOutcome;

export interface UseHighlightedCodeOptions {
  readonly enabled?: boolean;
  readonly delayMs?: number;
}

const PENDING: CodeHighlightState = { kind: "pending" };
const UNAVAILABLE: CodeHighlightOutcome = { kind: "plain", reason: "unavailable" };

interface PublishedHighlight {
  readonly highlighter: CodeHighlighter;
  readonly request: CodeHighlightRequest;
  readonly outcome: CodeHighlightOutcome;
}

export function useHighlightedCode(
  text: string,
  language: CodeLanguageId,
  options?: UseHighlightedCodeOptions,
): CodeHighlightState {
  const highlighter = useContext(CodeHighlighterContext);
  const theme = useContext(CodeHighlightThemeContext);
  const enabled = options?.enabled ?? true;
  const delayMs = Math.max(0, options?.delayMs ?? 0);
  const [published, setPublished] = useState<PublishedHighlight | null>(null);

  useEffect(() => {
    if (!enabled || highlighter === null || theme === null) return undefined;
    const request: CodeHighlightRequest = { text, language, theme };
    const controller = new AbortController();
    const run = () => {
      highlighter.highlight(request, controller.signal).then(
        (outcome) => {
          if (controller.signal.aborted) return;
          setPublished({ highlighter, request, outcome });
        },
        () => {
          if (controller.signal.aborted) return;
          setPublished({ highlighter, request, outcome: UNAVAILABLE });
        },
      );
    };
    if (delayMs === 0) {
      run();
      return () => controller.abort();
    }
    const timer = setTimeout(run, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, highlighter, theme, text, language, delayMs]);

  if (highlighter === null || theme === null) return UNAVAILABLE;
  if (!enabled) return PENDING;
  if (published === null) return PENDING;
  if (!publishedMatches(published, highlighter, text, language, theme)) return PENDING;
  return published.outcome;
}

function publishedMatches(
  published: PublishedHighlight,
  highlighter: CodeHighlighter,
  text: string,
  language: CodeLanguageId,
  theme: CodeTheme,
): boolean {
  return (
    published.highlighter === highlighter &&
    published.request.text === text &&
    published.request.language === language &&
    published.request.theme === theme
  );
}
