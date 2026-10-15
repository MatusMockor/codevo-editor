import type { HighlighterCore } from "shiki/core";
import { highlightBatchSequentially } from "../../application/codeHighlight/codeHighlightBatch";
import type { CodeHighlighter } from "../../application/codeHighlight/codeHighlighter";
import { highlightWithShiki } from "./shikiCodeTokens";

export type HighlighterCoreLoader = () => Promise<HighlighterCore>;

export function createInlineCodeHighlighter(
  loadHighlighter: HighlighterCoreLoader = loadAppHighlighter,
): CodeHighlighter {
  return {
    async highlight(request, signal) {
      throwIfAborted(signal);
      const highlighter = await loadHighlighter();
      throwIfAborted(signal);
      const outcome = await highlightWithShiki(highlighter, request);
      throwIfAborted(signal);
      return outcome;
    },
    async highlightBatch(request, signal) {
      throwIfAborted(signal);
      const highlighter = await loadHighlighter();
      throwIfAborted(signal);
      const outcome = await highlightBatchSequentially(
        request,
        (single) => highlightWithShiki(highlighter, single),
        () => signal?.aborted === true,
      );
      throwIfAborted(signal);
      if (outcome === null) throw abortError();
      return outcome;
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw abortError();
}

function abortError(): DOMException {
  return new DOMException("Code highlighting was cancelled.", "AbortError");
}

async function loadAppHighlighter(): Promise<HighlighterCore> {
  const { createAppHighlighter } = await import("../shikiHighlighter");
  return createAppHighlighter();
}
