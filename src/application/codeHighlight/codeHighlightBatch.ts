import { useContext, useEffect, useState } from "react";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import {
  exceedsHighlightBatchBudget,
  type HighlightedLines,
} from "../../domain/codeHighlight/highlightedCode";
import type { MonacoAppTheme } from "../../domain/settings";
import {
  CodeHighlighterContext,
  CodeHighlightThemeContext,
  type CodeHighlightBatchOutcome,
  type CodeHighlightBatchRequest,
  type CodeHighlighter,
  type CodeHighlightOutcome,
  type CodeHighlightRequest,
  type UseHighlightedCodeOptions,
} from "./codeHighlighter";

export type CodeHighlightBatchState = { readonly kind: "pending" } | CodeHighlightBatchOutcome;

const PENDING: CodeHighlightBatchState = { kind: "pending" };
const UNAVAILABLE: CodeHighlightBatchOutcome = { kind: "plain", reason: "unavailable" };
const TOO_LARGE: CodeHighlightBatchOutcome = { kind: "plain", reason: "too-large" };

export type YieldToEventLoop = () => Promise<void>;

export const yieldToEventLoop: YieldToEventLoop = () =>
  new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

export async function highlightBatchSequentially(
  request: CodeHighlightBatchRequest,
  highlightOne: (request: CodeHighlightRequest) => Promise<CodeHighlightOutcome>,
  isCancelled: () => boolean,
  yieldBetween: YieldToEventLoop = yieldToEventLoop,
): Promise<CodeHighlightBatchOutcome | null> {
  if (exceedsHighlightBatchBudget(request.texts)) return TOO_LARGE;
  const texts: HighlightedLines[] = [];
  for (const [index, text] of request.texts.entries()) {
    if (index > 0) await yieldBetween();
    if (isCancelled()) return null;
    const outcome = await highlightOne({ text, language: request.language, theme: request.theme });
    if (outcome.kind === "plain") return outcome;
    texts.push(outcome.lines);
  }
  if (isCancelled()) return null;
  return { kind: "highlighted", texts };
}

export function highlightBatchWith(
  highlighter: CodeHighlighter,
  request: CodeHighlightBatchRequest,
  signal: AbortSignal,
): Promise<CodeHighlightBatchOutcome> {
  if (highlighter.highlightBatch !== undefined) return highlighter.highlightBatch(request, signal);
  return highlightBatchSequentially(
    request,
    (single) => highlighter.highlight(single, signal),
    () => signal.aborted,
  ).then((outcome) => outcome ?? Promise.reject(abortError()));
}

interface PublishedBatch {
  readonly highlighter: CodeHighlighter;
  readonly request: CodeHighlightBatchRequest;
  readonly outcome: CodeHighlightBatchOutcome;
}

export function useHighlightedCodeBatch(
  texts: readonly string[],
  language: CodeLanguageId,
  options?: UseHighlightedCodeOptions,
): CodeHighlightBatchState {
  const highlighter = useContext(CodeHighlighterContext);
  const theme = useContext(CodeHighlightThemeContext);
  const enabled = options?.enabled ?? true;
  const delayMs = Math.max(0, options?.delayMs ?? 0);
  const [published, setPublished] = useState<PublishedBatch | null>(null);

  useEffect(() => {
    if (!enabled || highlighter === null || theme === null) return undefined;
    const request: CodeHighlightBatchRequest = { texts: [...texts], language, theme };
    const controller = new AbortController();
    const run = () => {
      highlightBatchWith(highlighter, request, controller.signal).then(
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
  }, [enabled, highlighter, theme, texts, language, delayMs]);

  if (highlighter === null || theme === null) return UNAVAILABLE;
  if (!enabled || published === null) return PENDING;
  if (!batchMatches(published, highlighter, texts, language, theme)) return PENDING;
  return published.outcome;
}

function batchMatches(
  published: PublishedBatch,
  highlighter: CodeHighlighter,
  texts: readonly string[],
  language: CodeLanguageId,
  theme: MonacoAppTheme,
): boolean {
  const request = published.request;
  if (published.highlighter !== highlighter) return false;
  if (request.language !== language || request.theme !== theme) return false;
  if (request.texts.length !== texts.length) return false;
  return request.texts.every((text, index) => text === texts[index]);
}

function abortError(): DOMException {
  return new DOMException("Code highlighting was cancelled.", "AbortError");
}
